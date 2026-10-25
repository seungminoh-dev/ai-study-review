import { CreditGrantBody, InviteBody, type BetaMetrics, type CreditAdminRow, type InviteSummary, type MemberSummary, type UsageReport } from '@moai/shared';
import { Hono } from 'hono';
import { revokeAccessStatements, revokeAllGrants } from '../auth/grants';
import type { AppEnv } from '../context';
import { creditBalance, creditsUsedThisMonth, grantStatement } from '../domain/credits';
import { INVITE_CODE_LENGTH, formatCode, randomCode } from '../lib/codes';
import { hashToken } from '../lib/crypto';
import { errorJson, readJson } from '../lib/http';
import { DAY_MS, studyDayIndex, studyDayKey, studyWeekday } from '../lib/kst';
import { caps, monthStart } from '../llm/budget';

// 오너 관리 API (/api/admin/*): 초대 코드, 회원 이용 멈추기, AI 사용량·크레딧 지급, 베타 지표.
// 오너 검사와 no-store는 app.ts가 /api/admin/* 전체에 건다. 여기서 따로 걸지 않는다.

export const admin = new Hono<AppEnv>();

const INVITE_TTL_MS = 7 * DAY_MS;
/** 기기 복구 초대는 그 계정으로 바로 로그인하는 코드라 짧게 둔다 */
const RECOVERY_TTL_MS = DAY_MS;

/** 회원 목록: 기기 복구 초대를 만들 때 고르고, 이용을 멈추거나 다시 연다 */
admin.get('/members', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT u.id, u.display_name, i.login AS github_login, u.created_at, u.disabled_at
       FROM users u LEFT JOIN user_identities i ON i.user_id = u.id AND i.provider = 'github'
      WHERE u.role = 'member' ORDER BY u.created_at`,
  ).all<MemberSummary>();
  return c.json({ members: results });
});

/** 초대 코드 (설계서 §8.4). 코드는 만들 때 한 번만 보여 주고 DB에는 해시만 둔다 */
admin.get('/invites', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT i.id, i.label, i.created_at, i.expires_at, i.used_at, u.display_name AS used_by_name, b.display_name AS bind_name
       FROM invites i LEFT JOIN users u ON u.id = i.used_by LEFT JOIN users b ON b.id = i.bind_user_id
      WHERE i.created_by = ?1 ORDER BY i.created_at DESC LIMIT 50`,
  )
    .bind(c.var.userId)
    .all<InviteSummary>();
  return c.json({ invites: results });
});

admin.post('/invites', async (c) => {
  const body = await readJson(c, InviteBody);
  if (body instanceof Response) return body;
  const now = Date.now();
  const code = randomCode(INVITE_CODE_LENGTH);
  // 기기 복구 초대는 오너가 아닌 기존 회원에게만 만든다
  let bindName: string | null = null;
  if (body.bind_user_id) {
    bindName = await c.env.DB.prepare("SELECT display_name FROM users WHERE id = ?1 AND role = 'member'").bind(body.bind_user_id).first<string>('display_name');
    if (!bindName) return errorJson(404, 'not_found', '복구할 회원을 찾지 못했어요.');
  }
  const invite: InviteSummary = {
    id: crypto.randomUUID(),
    label: body.label,
    bind_name: bindName,
    created_at: now,
    expires_at: now + (body.bind_user_id ? RECOVERY_TTL_MS : INVITE_TTL_MS),
    used_at: null,
    used_by_name: null,
  };
  await c.env.DB.prepare('INSERT INTO invites (id, code_hash, label, created_by, created_at, expires_at, bind_user_id) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)')
    .bind(invite.id, await hashToken(c.env.TOKEN_PEPPER, `invite:${code}`), invite.label, c.var.userId, now, invite.expires_at, body.bind_user_id ?? null)
    .run();
  return c.json({ invite, code: formatCode(code) }, 201);
});

/**
 * 회원 이용을 멈춘다 (이용약관의 이용 정지). 로그인·로그인 코드·커넥터 URL·푸시·OAuth 권한을 모두 끊고,
 * 다시 열 때까지 로그인과 커넥터를 받지 않는다 (세션·MCP 토큰·OAuth를 볼 때 disabled_at을 본다). 오너는 멈출 수 없다
 */
admin.post('/members/:id/disable', async (c) => {
  const id = c.req.param('id');
  const member = await c.env.DB.prepare("SELECT 1 FROM users WHERE id = ?1 AND role = 'member'").bind(id).first();
  if (!member) return errorJson(404, 'not_found', '회원을 찾지 못했어요.');
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE users SET disabled_at = coalesce(disabled_at, ?2) WHERE id = ?1').bind(id, Date.now()),
    ...revokeAccessStatements(c.env, id),
  ]);
  await revokeAllGrants(c.env, id);
  console.log(JSON.stringify({ event: 'member_disabled', user_id: id }));
  return c.body(null, 204);
});

/** 멈춘 이용을 다시 연다. 끊은 로그인과 커넥터는 그 사람이 다시 로그인하고 다시 이어야 한다 */
admin.post('/members/:id/enable', async (c) => {
  const { meta } = await c.env.DB.prepare("UPDATE users SET disabled_at = NULL WHERE id = ?1 AND role = 'member'").bind(c.req.param('id')).run();
  if (meta.changes === 0) return errorJson(404, 'not_found', '회원을 찾지 못했어요.');
  console.log(JSON.stringify({ event: 'member_enabled', user_id: c.req.param('id') }));
  return c.body(null, 204);
});

/** 아직 쓰지 않은 초대만 지운다. 쓴 초대는 누가 가입했는지 남겨 둔다 */
admin.delete('/invites/:id', async (c) => {
  const removed = await c.env.DB.prepare('DELETE FROM invites WHERE id = ?1 AND created_by = ?2 AND used_at IS NULL')
    .bind(c.req.param('id'), c.var.userId)
    .run();
  return removed.meta.changes > 0 ? c.body(null, 204) : errorJson(404, 'not_found', '지울 수 있는 초대가 없어요.');
});

/** 이번 달 서버 AI 사용량 (설계서 §11): 사람·종류·모델별 비용과 작업 상태 */
admin.get('/usage', async (c) => {
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

/** 사람마다 AI 크레딧 (운영자 화면) */
admin.get('/credits', async (c) => {
  const now = Date.now();
  const { results } = await c.env.DB.prepare('SELECT id, display_name AS name FROM users ORDER BY created_at').all<{ id: string; name: string }>();
  const people: CreditAdminRow[] = await Promise.all(
    results.map(async (person) => ({ ...person, credits: await creditBalance(c.env, person.id, now), used_month: await creditsUsedThisMonth(c.env, person.id, now) })),
  );
  return c.json({ people });
});

/** 보유 크레딧을 준다. 돈이 오가지 않는 앱 안 재화다 */
admin.post('/credits', async (c) => {
  const body = await readJson(c, CreditGrantBody);
  if (body instanceof Response) return body;
  const exists = await c.env.DB.prepare('SELECT 1 FROM users WHERE id = ?1').bind(body.user_id).first();
  if (!exists) return errorJson(404, 'not_found', '회원을 찾지 못했어요.');
  await grantStatement(c.env, body.user_id, body.amount, 'grant', null, body.note || null, Date.now()).run();
  console.log(JSON.stringify({ event: 'credits_granted', user_id: body.user_id, amount: body.amount }));
  return c.body(null, 204);
});

/** 베타 지표 (설계서 §2.3, 기획서 §13): 주간 복습자, 카드 신고율, AI 비용, 14일 유지율, 저장 → 첫 복습, 2·5회차 정답률, 주간 설문 */
admin.get('/metrics', async (c) => {
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
