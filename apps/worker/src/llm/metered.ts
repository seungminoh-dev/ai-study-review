import { CREDIT_COST } from '@moai/shared';
import { noCreditsMessage, refundCredits, spendCredits } from '../domain/credits';
import type { Env } from '../env';
import { callClaude, type CallRequest } from './anthropic';
import { overBudget } from './budget';
import { costMicroUsd } from './pricing';

// 요청 안에서 바로 답하는 서버 AI 호출 (개념 채팅, 모의면접). 답은 몇 초면 와서 작업 테이블을 쓰지 않는다.
// 사람마다 AI 크레딧을 쓰고(domain/credits.ts), 서비스 전체 예산(§11.5)도 본다. 청구되지 않은 실패는 크레딧을 돌려준다.

export type MeteredKind = 'ask' | 'interview';

/** 답이 오기 전에 미리 적어 두는 비용(마이크로달러). 모르는 모델 단가로 입력 3천·출력 2048토큰쯤이다 */
const RESERVE_MICRO_USD = 150_000;

export type Failure = { ok: false; status: number; code: string; message: string };

export const fail = (status: number, code: string, message: string): Failure => ({ ok: false, status, code, message });

/** 크레딧을 쓰고, 비용을 미리 적고, 부르고, 실제 비용으로 고친다. 성공하면 모델이 쓴 글(JSON)을 돌려준다 */
export async function meteredCall(env: Env, userId: string, kind: MeteredKind, request: CallRequest, now: number): Promise<Failure | { ok: true; text: string }> {
  if (await overBudget(env, now, true)) return fail(429, 'budget', '이번 달 서비스 전체 AI 한도에 닿았어요.');
  // 크레딧은 세기와 쓰기를 한 문장으로 한다. 동시에 여러 번 보내도 가진 것보다 더 쓰지 못한다
  const id = crypto.randomUUID();
  if (!(await spendCredits(env, userId, kind, CREDIT_COST[kind], id, now))) return fail(429, 'no_credits', noCreditsMessage(CREDIT_COST[kind]));
  await env.DB.prepare(
    `INSERT INTO llm_usage (id, user_id, job_id, kind, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_micro_usd, created_at)
     VALUES (?1, ?2, ?1, ?3, 'reserved', 0, 0, 0, 0, ?4, ?5)`,
  )
    .bind(id, userId, kind, RESERVE_MICRO_USD, now)
    .run();

  const result = await callClaude(env, request);
  // 미리 적은 비용을 실제 비용으로 바꾼다. 기다리다 끊었으면 청구됐을 수 있어 그대로 두고, 청구되지 않은 실패는 횟수로 세지 않는다
  if (result.usage) {
    await env.DB.prepare('UPDATE llm_usage SET model = ?2, input_tokens = ?3, output_tokens = ?4, cache_read_tokens = ?5, cache_write_tokens = ?6, cost_micro_usd = ?7 WHERE id = ?1')
      .bind(
        id,
        result.model,
        result.usage.input_tokens,
        result.usage.output_tokens,
        result.usage.cache_read_input_tokens ?? 0,
        result.usage.cache_creation_input_tokens ?? 0,
        costMicroUsd(result.model, result.usage),
      )
      .run();
  } else if (result.error === 'api' && result.timedOut) {
    await env.DB.prepare('UPDATE llm_usage SET model = ?2 WHERE id = ?1').bind(id, `${env.GRADER_MODEL} (시간 초과, 예상)`).run();
  } else {
    await env.DB.prepare('DELETE FROM llm_usage WHERE id = ?1').bind(id).run();
    await refundCredits(env, id);
  }
  console.log(JSON.stringify({ event: kind, user_id: userId, ok: result.ok, ...(result.ok ? {} : { error: result.error }) }));

  if (!result.ok) {
    if (result.error === 'refusal') return fail(502, 'refusal', 'AI가 이 질문에는 답하지 않겠다고 했어요. 다르게 해 주세요.');
    if (result.error === 'truncated') return fail(502, 'truncated', 'AI 답이 너무 길어서 잘렸어요.');
    return fail(502, 'api', 'AI 서버에 연결하지 못했어요. 잠시 뒤에 다시 해 주세요.');
  }
  return { ok: true, text: result.text };
}
