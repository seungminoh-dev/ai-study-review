import { CREDIT_COST, InterviewQuestion, InterviewSummary, type InterviewBody, type InterviewResponse } from '@moai/shared';
import { z } from 'zod';
import { creditBalance, noCreditsMessage } from '../domain/credits';
import { interviewChain } from '../domain/interview';
import { learnerContext } from '../domain/learner-context';
import type { Env } from '../env';
import { sha256Hex } from '../lib/crypto';
import { parseJson } from './anthropic';
import { overBudget } from './budget';
import { createJob } from './jobs';
import { fail, meteredCall, type Failure } from './metered';
import { INTERVIEW_SYSTEM, interviewInput } from './prompts';
import { toOutputSchema } from './schema';

// 앱 안 모의면접: MCP의 get_interview_chain처럼 흔들리는 개념에서 시작해 연결선을 따라 묻는다.
// 서버는 대화를 저장하지 않는다. 기기가 지금까지의 질문과 답을 들고 있다가 매번 같이 보낸다.

/** 개념 하나에 묻는 질문 수와 면접 한 번의 상한 */
const QUESTIONS_PER_CONCEPT = 2;
const MAX_QUESTIONS = 8;
const MAX_TOKENS = 2048;
const TIMEOUT_MS = 45_000;

let questionSchema: Record<string, unknown> | null = null;
let summarySchema: Record<string, unknown> | null = null;
const schemaOf = (final: boolean) =>
  final
    ? (summarySchema ??= toOutputSchema(z.toJSONSchema(InterviewSummary, { target: 'draft-2020-12' }) as Record<string, unknown>))
    : (questionSchema ??= toOutputSchema(z.toJSONSchema(InterviewQuestion, { target: 'draft-2020-12' }) as Record<string, unknown>));


/** 물을 개념 순서. 처음이면 정하고, 다음부터는 받은 key가 내 개념인지만 확인한다 */
async function orderOf(env: Env, userId: string, body: InterviewBody, now: number): Promise<{ key: string; name: string }[]> {
  if (body.keys) {
    const { results } = await env.DB.prepare('SELECT key, name FROM concepts WHERE user_id = ?1 AND key IN (SELECT value FROM json_each(?2))')
      .bind(userId, JSON.stringify(body.keys))
      .all<{ key: string; name: string }>();
    const names = new Map(results.map((row) => [row.key, row.name]));
    return body.keys.flatMap((key) => (names.has(key) ? [{ key, name: names.get(key)! }] : []));
  }
  const chain = await interviewChain(env, userId, { concept_key: body.concept_key, category: body.category }, now);
  return chain ? chain.keys.map((key, index) => ({ key, name: chain.names[index]! })) : [];
}

export async function interviewTurn(env: Env, userId: string, body: InterviewBody, now: number): Promise<Failure | ({ ok: true } & InterviewResponse)> {
  const order = await orderOf(env, userId, body, now);
  if (order.length === 0) return fail(404, 'no_concepts', '면접할 개념이 없어요. 공부한 내용을 먼저 저장하거나 한 번 풀어 주세요.');
  const total = Math.min(order.length * QUESTIONS_PER_CONCEPT, MAX_QUESTIONS);
  const final = body.turns.length >= total;
  const context = await learnerContext(env, userId, { concept_keys: order.map((item) => item.key) }, now);
  const result = await meteredCall(
    env,
    userId,
    'interview',
    { system: INTERVIEW_SYSTEM, user: interviewInput(order, context.text, body.turns.slice(0, total), final), schema: schemaOf(final), maxTokens: MAX_TOKENS, timeoutMs: TIMEOUT_MS },
    now,
  );
  if (!result.ok) return result;
  const base = { ok: true as const, keys: order.map((item) => item.key), names: order.map((item) => item.name), total, credits: await creditBalance(env, userId, now) };
  if (final) {
    const parsed = InterviewSummary.safeParse(parseJson(result.text));
    if (!parsed.success) return fail(502, 'invalid_output', 'AI 정리를 읽지 못했어요. 다시 해 주세요.');
    return { ...base, question: null, summary: parsed.data };
  }
  const parsed = InterviewQuestion.safeParse(parseJson(result.text));
  if (!parsed.success) return fail(502, 'invalid_output', 'AI 질문을 읽지 못했어요. 다시 해 주세요.');
  return { ...base, question: { question: parsed.data.question.trim(), concept_key: parsed.data.concept_key }, summary: null };
}

/**
 * 면접을 기록으로 남긴다: 대화를 가져오기 작업(llm_jobs kind 'import')에 넣는다. 가져오기 프롬프트가 사용자 답으로 판정(said는 원문)을 넣고,
 * 틀리거나 빠진 곳을 카드로 만든다. 같은 면접은 같은 작업이다. 끝나면 원문은 지운다.
 */
export async function saveInterview(env: Env, userId: string, body: { keys: string[]; turns: { question: string; answer: string }[] }, now: number): Promise<Failure | { ok: true; job_id: string; duplicate: boolean }> {
  const order = await orderOf(env, userId, { keys: body.keys, turns: [] }, now);
  if (order.length === 0) return fail(404, 'no_concepts', '면접한 개념을 찾지 못했어요.');
  const text = [
    '아래는 사용자가 모아이 앱에서 한 꼬리질문 모의면접이다. 면접관이 묻고 사용자가 답했다.',
    '사용자 답마다 맞음·애매·틀림·빠짐을 judgments에 넣고 said에는 사용자 답을 다듬지 않고 그대로 넣는다. 틀리거나 빠진 부분은 다음에 복습할 카드로 만든다.',
    `면접한 개념(이미 있으니 key를 그대로 쓴다): ${order.map((item) => `\`${item.key}\` ${item.name}`).join(', ')}`,
    '',
    ...body.turns.flatMap((turn) => [`면접관: ${turn.question}`, `사용자: ${turn.answer || '(답하지 않음)'}`, '']),
  ].join('\n');
  const hash = await sha256Hex(`interview:${text}`);
  const existing = await env.DB.prepare("SELECT id FROM llm_jobs WHERE user_id = ?1 AND kind = 'import' AND input_hash = ?2 AND status != 'failed' LIMIT 1")
    .bind(userId, hash)
    .first<string>('id');
  if (existing) return { ok: true, job_id: existing, duplicate: true };
  if (await overBudget(env, now, true)) return fail(429, 'budget', '이번 달 서비스 전체 AI 한도에 닿았어요.');
  const job = await createJob(env, userId, 'import', text, { inputHash: hash }, now, { kind: 'cards', amount: CREDIT_COST.cards });
  if ('error' in job) {
    return job.error === 'no_credits'
      ? fail(429, 'no_credits', noCreditsMessage(CREDIT_COST.cards))
      : fail(429, 'too_many', '정리하는 작업이 이미 3개 기다리고 있어요. 끝나면 다시 해 주세요.');
  }
  return { ok: true, job_id: job.id, duplicate: false };
}
