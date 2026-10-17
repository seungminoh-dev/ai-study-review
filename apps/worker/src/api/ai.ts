import { GradeAiBody, ImportBody, type AiStatus, type JobView, type UsageReport } from '@moai/shared';
import { Hono } from 'hono';
import type { AppEnv } from '../context';
import { sha256Hex } from '../lib/crypto';
import { errorJson, readJson } from '../lib/http';
import { llmConfigured } from '../llm/anthropic';
import { caps, monthStart, overBudget } from '../llm/budget';
import { createJob, runJob } from '../llm/jobs';
import { requireOwner } from './account';

// 서버 LLM API (설계서 §11): 설명하기 AI 채점, 붙여넣기 가져오기, 작업 상태, 관리자 사용량

export const ai = new Hono<AppEnv>();

const UNAVAILABLE = () => errorJson(503, 'ai_unavailable', '서버에 AI 설정이 없어요. 자가 채점으로 진행해요.');
const OVER_BUDGET = () => errorJson(429, 'budget', '이번 달 AI 한도에 닿았어요. 자가 채점으로 진행해요.');
/** 한 사람이 동시에 기다리게 할 수 있는 가져오기 수 */
const MAX_PENDING_IMPORTS = 3;
const MAX_PENDING_GRADES = 3;

ai.get('/ai/status', async (c) => {
  const available = llmConfigured(c.env);
  const body: AiStatus = { available, over_budget: available ? await overBudget(c.env, c.var.userId, Date.now()) : false };
  return c.json(body);
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
  // 비용은 응답이 와야 기록된다. 동시에 많이 보내 한도를 넘기지 않게, 끝나지 않은 채점은 사람마다 3개까지만 둔다
  const inflight = await c.env.DB.prepare("SELECT count(*) AS n FROM llm_jobs WHERE user_id = ?1 AND kind = 'grade' AND status IN ('queued', 'running')")
    .bind(c.var.userId)
    .first<number>('n');
  if ((inflight ?? 0) >= MAX_PENDING_GRADES) return errorJson(429, 'too_many', '채점이 이미 진행 중이에요. 끝나면 다시 해 주세요.');
  if (await overBudget(c.env, c.var.userId, now)) return OVER_BUDGET();
  const id = await createJob(c.env, c.var.userId, 'grade', body.answer, { cardId: card }, now);
  // 응답을 보낸 뒤에도 돌린다. 끊기면 매분 Cron이 이어 받는다
  c.executionCtx.waitUntil(runJob(c.env, id));
  return c.json({ job_id: id }, 202);
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
  const [same, pending] = await c.env.DB.batch([
    c.env.DB.prepare("SELECT id FROM llm_jobs WHERE user_id = ?1 AND kind = 'import' AND input_hash = ?2 AND status != 'failed' LIMIT 1").bind(userId, hash),
    c.env.DB.prepare("SELECT count(*) AS n FROM llm_jobs WHERE user_id = ?1 AND kind = 'import' AND status IN ('queued', 'running')").bind(userId),
  ]);
  const existing = (same!.results[0] as { id: string } | undefined)?.id;
  if (existing) return c.json({ job_id: existing, duplicate: true });
  if ((pending!.results[0] as { n: number }).n >= MAX_PENDING_IMPORTS) return errorJson(429, 'too_many', '가져오기가 이미 3개 기다리고 있어요. 끝나면 다시 해 주세요.');
  if (await overBudget(c.env, userId, now)) return OVER_BUDGET();
  const id = await createJob(c.env, userId, 'import', body.text, { inputHash: hash }, now);
  return c.json({ job_id: id, duplicate: false }, 202);
});

ai.get('/imports', async (c) => {
  const { results } = await c.env.DB.prepare(`SELECT ${JOB_COLUMNS} FROM llm_jobs WHERE user_id = ?1 AND kind = 'import' ORDER BY created_at DESC LIMIT 20`)
    .bind(c.var.userId)
    .all<Parameters<typeof toView>[0]>();
  return c.json({ jobs: results.map(toView) });
});

ai.use('/admin/*', requireOwner);

ai.get('/admin/usage', async (c) => {
  const since = monthStart(Date.now());
  const [byUser, byKind, byModel, jobs] = await c.env.DB.batch([
    c.env.DB.prepare(
      `SELECT coalesce(u.display_name, '(지운 계정)') AS name, sum(l.cost_micro_usd) AS cost, count(*) AS calls
         FROM llm_usage l LEFT JOIN users u ON u.id = l.user_id WHERE l.created_at >= ?1 GROUP BY l.user_id ORDER BY cost DESC`,
    ).bind(since),
    c.env.DB.prepare('SELECT kind, sum(cost_micro_usd) AS cost, count(*) AS calls FROM llm_usage WHERE created_at >= ?1 GROUP BY kind').bind(since),
    c.env.DB.prepare(
      `SELECT model, sum(cost_micro_usd) AS cost, count(*) AS calls, sum(input_tokens) AS input_tokens, sum(output_tokens) AS output_tokens
         FROM llm_usage WHERE created_at >= ?1 GROUP BY model ORDER BY cost DESC`,
    ).bind(since),
    c.env.DB.prepare('SELECT status, kind, error, count(*) AS n FROM llm_jobs WHERE created_at >= ?1 GROUP BY status, kind, error').bind(since),
  ]);
  const usd = (micro: number) => Math.round(micro) / 1e6;
  const limit = caps(c.env);
  const users = byUser!.results as { name: string; cost: number; calls: number }[];
  const body: UsageReport = {
    month_start: since,
    total_usd: usd(users.reduce((sum, row) => sum + row.cost, 0)),
    monthly_cap_usd: limit.monthly,
    user_cap_usd: limit.user,
    by_user: users.map((row) => ({ name: row.name, usd: usd(row.cost), calls: row.calls })),
    by_kind: (byKind!.results as { kind: string; cost: number; calls: number }[]).map((row) => ({ kind: row.kind, usd: usd(row.cost), calls: row.calls })),
    by_model: (byModel!.results as { model: string; cost: number; calls: number; input_tokens: number; output_tokens: number }[]).map((row) => ({
      model: row.model,
      usd: usd(row.cost),
      calls: row.calls,
      input_tokens: row.input_tokens,
      output_tokens: row.output_tokens,
    })),
    jobs: jobs!.results as UsageReport['jobs'],
  };
  return c.json(body);
});
