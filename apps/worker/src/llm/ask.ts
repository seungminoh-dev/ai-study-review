import { AskResult, type AskBody, type AskCardsBody, type McqOption } from '@moai/shared';
import { z } from 'zod';
import type { Env } from '../env';
import { sha256Hex } from '../lib/crypto';
import { callClaude, parseJson } from './anthropic';
import { monthStart, overBudget } from './budget';
import { createJob } from './jobs';
import { costMicroUsd } from './pricing';
import { ASK_SYSTEM, askInput } from './prompts';
import { toOutputSchema } from './schema';

// AI 개념 채팅 (3단계 시안): 복습에서 틀린 카드의 개념을 묻는다. 답은 몇 초면 와서 작업 테이블 없이 요청 안에서 받는다.
// 질문과 답은 저장하지 않는다. 비용 기록(llm_usage, kind 'ask')이 이번 달 질문 수도 센다.

/** 사람마다 한 달(UTC)에 물을 수 있는 수 */
export const ASK_PER_MONTH = 50;
/** 답이 오기 전에 미리 적어 두는 비용(마이크로달러). 모르는 모델 단가로 입력 3천·출력 2048토큰쯤이다 */
const RESERVE_MICRO_USD = 150_000;
const MAX_TOKENS = 2048;
const TIMEOUT_MS = 45_000;

let schema: Record<string, unknown> | null = null;

export async function askLeft(env: Env, userId: string, now: number): Promise<number> {
  const used = await env.DB.prepare("SELECT count(*) AS n FROM llm_usage WHERE user_id = ?1 AND kind = 'ask' AND created_at >= ?2")
    .bind(userId, monthStart(now))
    .first<number>('n');
  return Math.max(0, ASK_PER_MONTH - (used ?? 0));
}

export type AskOutcome = { ok: true; answer: string; left: number } | { ok: false; status: number; code: string; message: string };

type Failure = Extract<AskOutcome, { ok: false }>;

const fail = (status: number, code: string, message: string): Failure => ({ ok: false, status, code, message });

interface CardRow {
  type: string;
  prompt: string;
  code: string | null;
  answer: string | null;
  options: string | null;
  explain: string | null;
  checklist: string | null;
  concept_name: string;
  final_answer: string | null;
}

export async function askConcept(env: Env, userId: string, cardId: string, body: AskBody, now: number): Promise<AskOutcome> {
  const card = await env.DB.prepare(
    `SELECT c.type, c.prompt, c.code, c.answer, c.options, c.explain, c.checklist, k.name AS concept_name, k.final_answer
       FROM cards c JOIN concepts k ON k.id = c.concept_id WHERE c.id = ?1 AND c.user_id = ?2`,
  )
    .bind(cardId, userId)
    .first<CardRow>();
  if (!card) return fail(404, 'not_found', '카드를 찾지 못했어요.');
  if (await overBudget(env, userId, now, true)) return fail(429, 'budget', '이번 달 AI 한도에 닿았어요.');

  // 이번 달 질문 수를 세고 비용을 미리 적어 두는 것을 한 문장으로 한다. 동시에 여러 번 보내도 상한과 예산을 넘지 않는다
  const id = crypto.randomUUID();
  const reserved = await env.DB.prepare(
    `INSERT INTO llm_usage (id, user_id, job_id, kind, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_micro_usd, created_at)
     SELECT ?1, ?2, ?1, 'ask', 'reserved', 0, 0, 0, 0, ?3, ?4
      WHERE (SELECT count(*) FROM llm_usage WHERE user_id = ?2 AND kind = 'ask' AND created_at >= ?5) < ?6`,
  )
    .bind(id, userId, RESERVE_MICRO_USD, now, monthStart(now), ASK_PER_MONTH)
    .run();
  if (reserved.meta.changes === 0) return fail(429, 'ask_limit', `이번 달 질문 ${ASK_PER_MONTH}번을 다 썼어요. 다음 달에 다시 물어볼 수 있어요.`);

  const options = card.options ? (JSON.parse(card.options) as unknown) : null;
  const request = {
    system: ASK_SYSTEM,
    user: askInput({
      concept: card.concept_name,
      prompt: card.prompt,
      code: card.code,
      choices:
        card.type === 'mcq'
          ? (options as McqOption[]).map((option) => ({ text: option.text, correct: option.correct }))
          : card.type === 'cloze'
            ? (options as string[]).map((text) => ({ text, correct: text === card.answer }))
            : null,
      answer: card.type === 'ox' ? card.answer : null,
      explain: card.explain,
      checklist: card.type === 'explain' && card.checklist ? (JSON.parse(card.checklist) as string[]) : null,
      picked: body.picked ?? null,
      notes: card.final_answer,
      history: body.history,
      question: body.question,
    }),
    schema: (schema ??= toOutputSchema(z.toJSONSchema(AskResult, { target: 'draft-2020-12' }) as Record<string, unknown>)),
    maxTokens: MAX_TOKENS,
    timeoutMs: TIMEOUT_MS,
  };
  const result = await callClaude(env, request);

  // 미리 적은 비용을 실제 비용으로 바꾼다. 기다리다 끊었으면 청구됐을 수 있어 그대로 두고, 청구되지 않은 실패는 질문으로 세지 않는다
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
  }
  console.log(JSON.stringify({ event: 'ask', user_id: userId, ok: result.ok, ...(result.ok ? {} : { error: result.error }) }));

  if (!result.ok) {
    if (result.error === 'refusal') return fail(502, 'refusal', 'AI가 이 질문에는 답하지 않겠다고 했어요. 다르게 물어봐 주세요.');
    if (result.error === 'truncated') return fail(502, 'truncated', 'AI 답이 너무 길어서 잘렸어요. 질문을 좁혀 주세요.');
    return fail(502, 'api', 'AI 서버에 연결하지 못했어요. 잠시 뒤에 다시 물어봐 주세요.');
  }
  const parsed = AskResult.safeParse(parseJson(result.text));
  if (!parsed.success) return fail(502, 'invalid_output', 'AI 답을 읽지 못했어요. 다시 물어봐 주세요.');
  return { ok: true, answer: parsed.data.answer.trim(), left: await askLeft(env, userId, now) };
}

/**
 * 2차: 이 카드를 두고 주고받은 대화로 카드를 만든다. 대화를 가져오기 작업(llm_jobs kind 'import')에 넣어 매분 Cron이 만든다.
 * 같은 개념에 붙도록 개념 key와 카드 내용을 대화 앞에 적는다. 작업이 끝나면 원문은 지운다 (가져오기와 같다).
 */
export async function askToCards(env: Env, userId: string, cardId: string, body: AskCardsBody, now: number): Promise<Failure | { ok: true; job_id: string; duplicate: boolean }> {
  const card = await env.DB.prepare(
    `SELECT c.type, c.prompt, c.answer, c.options, c.explain, k.key AS concept_key, k.name AS concept_name, k.domain
       FROM cards c JOIN concepts k ON k.id = c.concept_id WHERE c.id = ?1 AND c.user_id = ?2`,
  )
    .bind(cardId, userId)
    .first<{ type: string; prompt: string; answer: string | null; options: string | null; explain: string | null; concept_key: string; concept_name: string; domain: string | null }>();
  if (!card) return fail(404, 'not_found', '카드를 찾지 못했어요.');
  const options = card.options ? (JSON.parse(card.options) as unknown) : null;
  const correct = card.type === 'mcq' ? (options as McqOption[]).find((option) => option.correct)?.text : card.answer;
  const text = [
    '아래는 사용자가 복습하다 막힌 카드를 두고 AI 코치에게 물어본 대화다. 사용자는 질문만 했으니 judgments는 비운다.',
    `이미 있는 개념: key \`${card.concept_key}\` (${card.concept_name})${card.domain ? `, 분류 ${card.domain}` : ''}. 같은 개념의 카드는 이 key를 그대로 쓴다.`,
    `원래 카드: ${card.prompt}${correct ? ` / 정답: ${correct}` : ''}${card.explain ? ` / 해설: ${card.explain}` : ''}`,
    ...(body.picked ? [`사용자가 고른 답(또는 쓴 설명): ${body.picked}`] : []),
    '',
    ...body.turns.flatMap((turn) => [`사용자: ${turn.question}`, `코치: ${turn.answer}`, '']),
  ].join('\n');
  const hash = await sha256Hex(`ask:${cardId}:${text}`);
  // 같은 대화를 다시 보내면 이전 작업을 돌려준다 (실패한 것은 다시 할 수 있다)
  const existing = await env.DB.prepare("SELECT id FROM llm_jobs WHERE user_id = ?1 AND kind = 'import' AND input_hash = ?2 AND status != 'failed' LIMIT 1")
    .bind(userId, hash)
    .first<string>('id');
  if (existing) return { ok: true, job_id: existing, duplicate: true };
  if (await overBudget(env, userId, now, true)) return fail(429, 'budget', '이번 달 AI 한도에 닿았어요.');
  const id = await createJob(env, userId, 'import', text, { inputHash: hash }, now);
  if (!id) return fail(429, 'too_many', '카드를 만드는 작업이 이미 3개 기다리고 있어요. 끝나면 다시 해 주세요.');
  return { ok: true, job_id: id, duplicate: false };
}
