import { AskResult, CREDIT_COST, type AskBody, type AskCardsBody, type CreditBalance, type McqOption } from '@moai/shared';
import { creditBalance, noCreditsMessage } from '../domain/credits';
import type { Env } from '../env';
import { sha256Hex } from '../lib/crypto';
import { parseJson } from './anthropic';
import { overBudget } from './budget';
import { createJob } from './jobs';
import { fail, meteredCall, type Failure } from './metered';
import { ASK_SYSTEM, askInput } from './prompts';
import { outputSchema } from './schema';

// AI 개념 채팅 (3단계 시안): 복습에서 답을 고른 카드(틀렸든 맞혔든)나 설명하기를 비교한 카드의 개념을 묻는다.
// 질문과 답은 저장하지 않는다. 크레딧과 예산은 metered.ts가 본다.

const MAX_TOKENS = 2048;
const TIMEOUT_MS = 45_000;

let schema: Record<string, unknown> | null = null;


export type AskOutcome = Failure | { ok: true; answer: string; credits: CreditBalance };

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
    schema: (schema ??= outputSchema(AskResult)),
    maxTokens: MAX_TOKENS,
    timeoutMs: TIMEOUT_MS,
  };
  const result = await meteredCall(env, userId, 'ask', request, now);
  if (!result.ok) return result;
  const parsed = AskResult.safeParse(parseJson(result.text));
  if (!parsed.success) return fail(502, 'invalid_output', 'AI 답을 읽지 못했어요. 다시 물어봐 주세요.');
  return { ok: true, answer: parsed.data.answer.trim(), credits: await creditBalance(env, userId, now) };
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
  if (await overBudget(env, now, true)) return fail(429, 'budget', '이번 달 서비스 전체 AI 한도에 닿았어요.');
  const job = await createJob(env, userId, 'import', text, { inputHash: hash }, now, { kind: 'cards', amount: CREDIT_COST.cards });
  if ('error' in job) {
    return job.error === 'no_credits'
      ? fail(429, 'no_credits', noCreditsMessage(CREDIT_COST.cards))
      : fail(429, 'too_many', '카드를 만드는 작업이 이미 3개 기다리고 있어요. 끝나면 다시 해 주세요.');
  }
  return { ok: true, job_id: job.id, duplicate: false };
}
