import { AskBody, AskCardsBody, GradeAiBody, ImportBody, InterviewBody, InterviewSaveBody, type AiStatus, type AskResponse, type BetaMetrics, type InterviewResponse, type JobView, type UsageReport } from '@moai/shared';
import { Hono } from 'hono';
import type { AppEnv } from '../context';
import { sha256Hex } from '../lib/crypto';
import { errorJson, readJson } from '../lib/http';
import { DAY_MS, studyDayIndex, studyDayKey, studyWeekday } from '../lib/kst';
import { llmConfigured } from '../llm/anthropic';
import { askConcept, askLeft, askToCards } from '../llm/ask';
import { interviewLeft, interviewTurn, saveInterview } from '../llm/interview';
import { caps, monthStart, overBudget } from '../llm/budget';
import { createJob, runJob } from '../llm/jobs';
import { requireOwner } from './account';

// 서버 LLM API (설계서 §11): 설명하기 AI 채점, 개념 물어보기, 붙여넣기 가져오기, 작업 상태, 관리자 사용량

export const ai = new Hono<AppEnv>();

const UNAVAILABLE = () => errorJson(503, 'ai_unavailable', '서버에 AI 설정이 없어요. 자가 채점으로 진행해요.');
const OVER_BUDGET = () => errorJson(429, 'budget', '이번 달 AI 한도에 닿았어요. 자가 채점으로 진행해요.');

ai.get('/ai/status', async (c) => {
  const available = llmConfigured(c.env);
  const now = Date.now();
  const [over, left, interview] = available
    ? await Promise.all([overBudget(c.env, c.var.userId, now), askLeft(c.env, c.var.userId, now), interviewLeft(c.env, c.var.userId, now)])
    : [false, 0, 0];
  const body: AiStatus = { available, over_budget: over, ask_left: left, interview_left: interview };
  return c.json(body);
});

/** AI 개념 채팅: 틀린 카드의 개념을 묻는다. 답은 바로 돌려준다 */
ai.post('/cards/:id/ask', async (c) => {
  if (!llmConfigured(c.env)) return errorJson(503, 'ai_unavailable', '서버에 AI 설정이 없어요.');
  const body = await readJson(c, AskBody);
  if (body instanceof Response) return body;
  const outcome = await askConcept(c.env, c.var.userId, c.req.param('id'), body, Date.now());
  return outcome.ok ? c.json({ answer: outcome.answer, left: outcome.left } satisfies AskResponse) : errorJson(outcome.status, outcome.code, outcome.message);
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
  if (await overBudget(c.env, c.var.userId, now, true)) return OVER_BUDGET();
  // 끝나지 않은 채점은 사람마다 3개까지 (세기와 넣기를 한 문장으로 한다)
  const id = await createJob(c.env, c.var.userId, 'grade', body.answer, { cardId: card }, now);
  if (!id) return errorJson(429, 'too_many', '채점이 이미 진행 중이에요. 끝나면 다시 해 주세요.');
  // 응답을 보낸 뒤에도 돌린다 (30초까지). 끊기면 매분 Cron이 이어 받는다
  c.executionCtx.waitUntil(runJob(c.env, id, 'request'));
  return c.json({ job_id: id }, 202);
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
  if (await overBudget(c.env, userId, now, true)) return OVER_BUDGET();
  const id = await createJob(c.env, userId, 'import', body.text, { inputHash: hash }, now);
  if (!id) return errorJson(429, 'too_many', '가져오기가 이미 3개 기다리고 있어요. 끝나면 다시 해 주세요.');
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

/** 베타 지표 (설계서 §2.3, 기획서 §13): 주간 복습자, 카드 신고율, AI 비용, 14일 유지율, 저장 → 첫 복습, 2·5회차 정답률, 주간 설문 */
ai.get('/admin/metrics', async (c) => {
  const now = Date.now();
  const week = now - 7 * DAY_MS;
  const month = now - 30 * DAY_MS;
  const weekKey = (offset: number) => {
    const today = studyDayIndex(now);
    return studyDayKey(today - studyWeekday(today) - offset * 7);
  };
  const [people, reports, reviewed, cost, retention, firstReview, accuracy, survey] = await c.env.DB.batch([
    c.env.DB.prepare(
      `SELECT u.display_name AS name, u.created_at AS joined_at,
              (SELECT count(*) FROM review_logs r WHERE r.user_id = u.id AND r.reviewed_at >= ?1) AS reviews_7d,
              (SELECT max(reviewed_at) FROM review_logs r WHERE r.user_id = u.id) AS last_review_at
         FROM users u ORDER BY u.created_at`,
    ).bind(week),
    c.env.DB.prepare('SELECT count(*) AS n FROM card_reports WHERE created_at >= ?1').bind(month),
    c.env.DB.prepare('SELECT count(DISTINCT card_id) AS n FROM review_logs WHERE reviewed_at >= ?1').bind(month),
    c.env.DB.prepare('SELECT coalesce(sum(cost_micro_usd), 0) AS n FROM llm_usage WHERE created_at >= ?1').bind(monthStart(now)),
    // 14일 유지율: 가입한 지 14일 넘은 사람 중 14일째부터 한 번이라도 복습한 사람
    c.env.DB.prepare(
      `SELECT count(*) AS eligible,
              coalesce(sum(EXISTS (SELECT 1 FROM review_logs r WHERE r.user_id = u.id AND r.reviewed_at >= u.created_at + ?2)), 0) AS retained
         FROM users u WHERE u.created_at <= ?1`,
    ).bind(now - 14 * DAY_MS, 14 * DAY_MS),
    // 저장 → 첫 복습: 하루 넘게 지난 대화 저장 중 그 저장의 카드를 한 장이라도 푼 것 (자료는 학습이라 뺀다)
    c.env.DB.prepare(
      `SELECT count(*) AS saved,
              coalesce(sum(EXISTS (SELECT 1 FROM cards c JOIN review_logs r ON r.card_id = c.id WHERE c.session_id = s.id)), 0) AS reviewed
         FROM learning_sessions s WHERE s.material IS NULL AND s.created_at <= ?1`,
    ).bind(now - DAY_MS),
    // 카드마다 n번째 답의 정답률 (2회차와 5회차)
    c.env.DB.prepare(
      `SELECT n, count(*) AS total, sum(grade >= 2) AS correct
         FROM (SELECT grade, row_number() OVER (PARTITION BY card_id ORDER BY reviewed_at) AS n FROM review_logs)
        WHERE n IN (2, 5) GROUP BY n`,
    ),
    c.env.DB.prepare('SELECT week, used, note FROM survey_answers WHERE week >= ?1 ORDER BY created_at DESC').bind(weekKey(3)),
  ]);
  const rate = (n: number) => {
    const row = (accuracy!.results as { n: number; total: number; correct: number }[]).find((item) => item.n === n);
    return { value: row && row.total > 0 ? row.correct / row.total : null, total: row?.total ?? 0 };
  };
  const answers = survey!.results as { week: string; used: number; note: string | null }[];
  const rows = people!.results as BetaMetrics['people'];
  const reportCount = (reports!.results[0] as { n: number }).n;
  const reviewedCount = (reviewed!.results[0] as { n: number }).n;
  const body: BetaMetrics = {
    users: rows.length,
    weekly_reviewers: rows.length === 0 ? 0 : rows.filter((row) => row.reviews_7d > 0).length / rows.length,
    report_rate: reviewedCount === 0 ? 0 : reportCount / reviewedCount,
    reports_30d: reportCount,
    reviewed_cards_30d: reviewedCount,
    ai_usd_month: Math.round((cost!.results[0] as { n: number }).n) / 1e6,
    people: rows,
    retention_14d: retention!.results[0] as BetaMetrics['retention_14d'],
    first_review: firstReview!.results[0] as BetaMetrics['first_review'],
    accuracy: { second: rate(2).value, second_n: rate(2).total, fifth: rate(5).value, fifth_n: rate(5).total },
    survey: [0, 1, 2, 3].map((offset) => {
      const week = weekKey(offset);
      const rows = answers.filter((answer) => answer.week === week);
      return {
        week,
        answered: rows.length,
        used: rows.filter((answer) => answer.used === 1).length,
        notes: rows.map((answer) => answer.note).filter((note): note is string => Boolean(note)),
      };
    }),
  };
  return c.json(body);
});
