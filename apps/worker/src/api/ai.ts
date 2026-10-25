import {
  AskBody,
  AskCardsBody,
  CREDIT_COST,
  GradeAiBody,
  ImportBody,
  InterviewBody,
  InterviewSaveBody,
  type AiStatus,
  type AskResponse,
  type CreditsResponse,
  type InterviewResponse,
  type JobView,
} from '@moai/shared';
import { Hono } from 'hono';
import type { AppEnv } from '../context';
import { creditBalance, noCreditsMessage } from '../domain/credits';
import { sha256Hex } from '../lib/crypto';
import { errorJson, readJson } from '../lib/http';
import { llmConfigured } from '../llm/anthropic';
import { askConcept, askToCards } from '../llm/ask';
import { interviewTopics } from '../domain/interview';
import { interviewTurn, saveInterview } from '../llm/interview';
import { overBudget } from '../llm/budget';
import { createJob, runJob } from '../llm/jobs';

// 서버 LLM API (설계서 §11): 설명하기 AI 채점, 개념 물어보기, 붙여넣기 가져오기, 작업 상태. 관리자 사용량·크레딧 지급은 admin.ts

export const ai = new Hono<AppEnv>();

const UNAVAILABLE = () => errorJson(503, 'ai_unavailable', '서버에 AI 설정이 없어요. 자가 채점으로 진행해요.');
const OVER_BUDGET = () => errorJson(429, 'budget', '이번 달 서비스 전체 AI 한도에 닿았어요. 자가 채점으로 진행해요.');
const NO_CREDITS = (cost: number) => errorJson(429, 'no_credits', noCreditsMessage(cost));

ai.get('/ai/status', async (c) => {
  const available = llmConfigured(c.env);
  const now = Date.now();
  const [over, credits] = await Promise.all([available ? overBudget(c.env, now) : false, creditBalance(c.env, c.var.userId, now)]);
  const body: AiStatus = { available, over_budget: over, credits };
  return c.json(body);
});

/** 내 AI 크레딧과 최근 내역 (설정 화면) */
ai.get('/credits', async (c) => {
  const now = Date.now();
  const [credits, history] = await Promise.all([
    creditBalance(c.env, c.var.userId, now),
    c.env.DB.prepare('SELECT kind, amount, note, created_at FROM credit_ledger WHERE user_id = ?1 ORDER BY created_at DESC LIMIT 20')
      .bind(c.var.userId)
      .all<CreditsResponse['history'][number]>(),
  ]);
  return c.json({ credits, history: history.results } satisfies CreditsResponse);
});

/** AI 개념 채팅: 틀린 카드의 개념을 묻는다. 답은 바로 돌려준다 */
ai.post('/cards/:id/ask', async (c) => {
  if (!llmConfigured(c.env)) return errorJson(503, 'ai_unavailable', '서버에 AI 설정이 없어요.');
  const body = await readJson(c, AskBody);
  if (body instanceof Response) return body;
  const outcome = await askConcept(c.env, c.var.userId, c.req.param('id'), body, Date.now());
  return outcome.ok ? c.json({ answer: outcome.answer, credits: outcome.credits } satisfies AskResponse) : errorJson(outcome.status, outcome.code, outcome.message);
});

/** AI 개념 채팅 2차: 그 대화로 카드를 만든다. 가져오기 작업으로 돌고, 끝나면 푸시로 알린다 */
ai.post('/cards/:id/ask/cards', async (c) => {
  if (!llmConfigured(c.env)) return errorJson(503, 'ai_unavailable', '서버에 AI 설정이 없어요.');
  const body = await readJson(c, AskCardsBody);
  if (body instanceof Response) return body;
  const outcome = await askToCards(c.env, c.var.userId, c.req.param('id'), body, Date.now());
  if (!outcome.ok) return errorJson(outcome.status, outcome.code, outcome.message);
  return c.json({ job_id: outcome.job_id, duplicate: outcome.duplicate }, outcome.duplicate ? 200 : 202);
});

ai.post('/cards/:id/grade-ai', async (c) => {
  if (!llmConfigured(c.env)) return UNAVAILABLE();
  const body = await readJson(c, GradeAiBody);
  if (body instanceof Response) return body;
  const now = Date.now();
  const card = await c.env.DB.prepare("SELECT id FROM cards WHERE id = ?1 AND user_id = ?2 AND type = 'explain'")
    .bind(c.req.param('id'), c.var.userId)
    .first<string>('id');
  if (!card) return errorJson(404, 'not_found', '설명하기 카드를 찾지 못했어요.');
  // 비용은 응답이 와야 기록된다. 끝나지 않은 작업은 예상 비용으로 더해서 한도를 본다
  if (await overBudget(c.env, now, true)) return OVER_BUDGET();
  // 끝나지 않은 채점은 사람마다 3개까지, 크레딧을 쓴다 (세기·넣기·쓰기를 한 batch로 한다)
  const job = await createJob(c.env, c.var.userId, 'grade', body.answer, { cardId: card }, now, { kind: 'grade', amount: CREDIT_COST.grade });
  if ('error' in job) return job.error === 'no_credits' ? NO_CREDITS(CREDIT_COST.grade) : errorJson(429, 'too_many', '채점이 이미 진행 중이에요. 끝나면 다시 해 주세요.');
  // 응답을 보낸 뒤에도 돌린다 (30초까지). 끊기면 매분 Cron이 이어 받는다
  c.executionCtx.waitUntil(runJob(c.env, job.id, 'request'));
  return c.json({ job_id: job.id }, 202);
});

/** 모의면접 시작 화면의 추천 주제. AI를 부르지 않는다 */
ai.get('/interview/topics', async (c) => {
  const concept = c.req.query('concept');
  const topics = await interviewTopics(c.env, c.var.userId, { concept_key: concept?.slice(0, 60), category: c.req.query('category')?.slice(0, 80) }, Date.now());
  return c.json({ topics });
});

/** 앱 안 모의면접: 다음 질문 하나, 마지막이면 정리. 대화는 기기가 들고 있다가 같이 보낸다 */
ai.post('/interview', async (c) => {
  if (!llmConfigured(c.env)) return errorJson(503, 'ai_unavailable', '서버에 AI 설정이 없어요.');
  const body = await readJson(c, InterviewBody);
  if (body instanceof Response) return body;
  const outcome = await interviewTurn(c.env, c.var.userId, body, Date.now());
  if (!outcome.ok) return errorJson(outcome.status, outcome.code, outcome.message);
  const { ok: _ok, ...response } = outcome;
  return c.json(response satisfies InterviewResponse);
});

/** 면접을 기록으로 남긴다 (판정과 카드). 가져오기 작업으로 돌고, 끝나면 푸시로 알린다 */
ai.post('/interview/save', async (c) => {
  if (!llmConfigured(c.env)) return errorJson(503, 'ai_unavailable', '서버에 AI 설정이 없어요.');
  const body = await readJson(c, InterviewSaveBody);
  if (body instanceof Response) return body;
  const outcome = await saveInterview(c.env, c.var.userId, body, Date.now());
  if (!outcome.ok) return errorJson(outcome.status, outcome.code, outcome.message);
  return c.json({ job_id: outcome.job_id, duplicate: outcome.duplicate }, outcome.duplicate ? 200 : 202);
});

const JOB_COLUMNS = 'id, kind, status, error, created_at, result';

function toView(row: { id: string; kind: 'grade' | 'import'; status: JobView['status']; error: string | null; created_at: number; result: string | null }): JobView {
  return { ...row, result: row.result ? (JSON.parse(row.result) as unknown) : null };
}

ai.get('/jobs/:id', async (c) => {
  const row = await c.env.DB.prepare(`SELECT ${JOB_COLUMNS} FROM llm_jobs WHERE id = ?1 AND user_id = ?2`).bind(c.req.param('id'), c.var.userId).first<Parameters<typeof toView>[0]>();
  return row ? c.json(toView(row)) : errorJson(404, 'not_found', '작업을 찾지 못했어요.');
});

ai.post('/import', async (c) => {
  if (!llmConfigured(c.env)) return UNAVAILABLE();
  const body = await readJson(c, ImportBody);
  if (body instanceof Response) return body;
  const now = Date.now();
  const userId = c.var.userId;
  // 같은 대화를 다시 보내면 이전 작업을 돌려준다 (실패한 것은 다시 할 수 있다)
  const hash = await sha256Hex(body.text.replace(/\s+/g, ' '));
  const existing = await c.env.DB.prepare("SELECT id FROM llm_jobs WHERE user_id = ?1 AND kind = 'import' AND input_hash = ?2 AND status != 'failed' LIMIT 1")
    .bind(userId, hash)
    .first<string>('id');
  if (existing) return c.json({ job_id: existing, duplicate: true });
  if (await overBudget(c.env, now, true)) return OVER_BUDGET();
  const job = await createJob(c.env, userId, 'import', body.text, { inputHash: hash }, now, { kind: 'import', amount: CREDIT_COST.import });
  if ('error' in job) return job.error === 'no_credits' ? NO_CREDITS(CREDIT_COST.import) : errorJson(429, 'too_many', '가져오기가 이미 3개 기다리고 있어요. 끝나면 다시 해 주세요.');
  return c.json({ job_id: job.id, duplicate: false }, 202);
});

ai.get('/imports', async (c) => {
  const { results } = await c.env.DB.prepare(`SELECT ${JOB_COLUMNS} FROM llm_jobs WHERE user_id = ?1 AND kind = 'import' ORDER BY created_at DESC LIMIT 20`)
    .bind(c.var.userId)
    .all<Parameters<typeof toView>[0]>();
  return c.json({ jobs: results.map(toView) });
});
