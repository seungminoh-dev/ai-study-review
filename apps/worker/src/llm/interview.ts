import { CREDIT_COST, INTERVIEW_DEPTHS, INTERVIEW_LEVELS, InterviewQuestion, InterviewSummary, type InterviewBody, type InterviewResponse } from '@moai/shared';
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
import { outputSchema } from './schema';

// 앱 안 모의면접: MCP의 get_interview_chain처럼 흔들리는 개념에서 시작해 연결선을 따라 묻는다.
// 서버는 대화를 저장하지 않는다. 기기가 지금까지의 질문과 답을 들고 있다가 매번 같이 보낸다.

const MAX_TOKENS = 2048;
/** 저장한 개념이 없는 주제로 물을 때 order에 넣는 자리 */
const FREE_TOPIC_KEY = 'topic';
const TIMEOUT_MS = 45_000;

let questionSchema: Record<string, unknown> | null = null;
let summarySchema: Record<string, unknown> | null = null;
const schemaOf = (final: boolean) =>
  final
    ? (summarySchema ??= outputSchema(InterviewSummary))
    : (questionSchema ??= outputSchema(InterviewQuestion));


/** 받은 key 중 내 개념인 것만 그 순서대로 */
async function myConcepts(env: Env, userId: string, keys: readonly string[]): Promise<{ key: string; name: string }[]> {
  const { results } = await env.DB.prepare('SELECT key, name FROM concepts WHERE user_id = ?1 AND key IN (SELECT value FROM json_each(?2))')
    .bind(userId, JSON.stringify(keys))
    .all<{ key: string; name: string }>();
  const names = new Map(results.map((row) => [row.key, row.name]));
  return keys.flatMap((key) => (names.has(key) ? [{ key, name: names.get(key)! }] : []));
}

/**
 * 물을 개념 순서. 처음이면 정하고, 다음부터는 받은 key가 내 개념인지만 확인한다.
 * 직접 고른 주제가 내 개념과 맞지 않으면 기록 없이 그 주제로 묻는다(free)
 */
async function orderOf(env: Env, userId: string, body: InterviewBody, now: number): Promise<{ order: { key: string; name: string }[]; free: boolean }> {
  if (body.keys) return { order: await myConcepts(env, userId, body.keys), free: false };
  const length = INTERVIEW_DEPTHS[body.depth].concepts;
  const chain = await interviewChain(env, userId, { concept_key: body.concept_key, category: body.category, topic: body.topic, length }, now);
  if (chain) return { order: chain.keys.map((key, index) => ({ key, name: chain.names[index]! })), free: false };
  if (body.topic) return { order: [{ key: FREE_TOPIC_KEY, name: body.topic }], free: true };
  return { order: [], free: false };
}

export async function interviewTurn(env: Env, userId: string, body: InterviewBody, now: number): Promise<Failure | ({ ok: true } & InterviewResponse)> {
  const { order, free } = await orderOf(env, userId, body, now);
  if (order.length === 0) return fail(404, 'no_concepts', '면접할 개념이 없어요. 공부한 내용을 먼저 저장하거나, 주제를 직접 적어 주세요.');
  const total = INTERVIEW_DEPTHS[body.depth].questions;
  const final = body.turns.length >= total;
  const plan = { total, perConcept: Math.max(1, Math.round(total / order.length)), level: INTERVIEW_LEVELS[body.level], topic: body.topic };
  const context = free
    ? { text: '(저장한 기록이 없는 주제다. 그 주제의 대표적인 면접 질문에서 시작한다)' }
    : await learnerContext(env, userId, { concept_keys: order.map((item) => item.key) }, now);
  const result = await meteredCall(
    env,
    userId,
    'interview',
    { system: INTERVIEW_SYSTEM, user: interviewInput(order, context.text, body.turns.slice(0, total), final, plan), schema: schemaOf(final), maxTokens: MAX_TOKENS, timeoutMs: TIMEOUT_MS },
    now,
  );
  if (!result.ok) return result;
  const base = { ok: true as const, keys: free ? [] : order.map((item) => item.key), names: order.map((item) => item.name), total, credits: await creditBalance(env, userId, now) };
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
export async function saveInterview(
  env: Env,
  userId: string,
  body: { keys: string[]; topic?: string | undefined; turns: { question: string; answer: string }[] },
  now: number,
): Promise<Failure | { ok: true; job_id: string; duplicate: boolean }> {
  const order = body.keys.length > 0 ? await myConcepts(env, userId, body.keys) : [];
  if (order.length === 0 && !body.topic) return fail(404, 'no_concepts', '면접한 개념을 찾지 못했어요.');
  const text = [
    '아래는 사용자가 모아이 앱에서 한 꼬리질문 모의면접이다. 면접관이 묻고 사용자가 답했다.',
    '사용자 답마다 맞음·애매·틀림·빠짐을 judgments에 넣고 said에는 사용자 답을 다듬지 않고 그대로 넣는다. 틀리거나 빠진 부분은 다음에 복습할 카드로 만든다.',
    order.length > 0
      ? `면접한 개념(이미 있으니 key를 그대로 쓴다): ${order.map((item) => `\`${item.key}\` ${item.name}`).join(', ')}`
      : `면접 주제: ${body.topic} (저장한 개념이 아니다. 대화에서 다룬 개념을 새로 만든다)`,
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
