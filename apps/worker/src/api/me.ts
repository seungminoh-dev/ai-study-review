import { DeleteAccountBody, LogoutBody, TERMS_VERSION, type LoginSummary } from '@moai/shared';
import { Hono } from 'hono';
import { revokeAllGrants } from '../auth/grants';
import { SESSION_COOKIE, dropCookie } from '../auth/session';
import type { AppEnv } from '../context';
import type { Env } from '../env';
import { errorJson, readJson } from '../lib/http';

// 내 데이터 내보내기와 계정 지우기 (설계서 §14)

export const me = new Hono<AppEnv>();

/** 내 학습 기록 전체를 JSON으로. 토큰·해시·푸시 키처럼 로그인과 기기에 쓰는 값은 넣지 않는다 */
me.get('/export', async (c) => {
  const userId = c.var.userId;
  const query = (sql: string) => c.env.DB.prepare(sql).bind(userId);
  const results = await c.env.DB.batch([
    query('SELECT display_name, role, timezone, daily_new_limit, daily_review_limit, daily_goal, created_at FROM users WHERE id = ?1'),
    query("SELECT login FROM user_identities WHERE user_id = ?1 AND provider = 'github'"),
    query('SELECT id, source, topic, material, material_part, final_answer, key_terms, summary, created_at FROM learning_sessions WHERE user_id = ?1 ORDER BY created_at'),
    query('SELECT id, key, name, aliases, domain, final_answer, created_at, updated_at, adopted_at FROM concepts WHERE user_id = ?1 ORDER BY created_at'),
    query(
      `SELECT f.key AS from_key, t.key AS to_key, e.type, e.created_at FROM edges e
         JOIN concepts f ON f.id = e.from_id JOIN concepts t ON t.id = e.to_id WHERE e.user_id = ?1`,
    ),
    query('SELECT id, concept_id, session_id, label, said, note, created_at FROM judgments WHERE user_id = ?1 ORDER BY created_at'),
    query('SELECT id, concept_id, session_id, question, created_at, resolved_at FROM followups WHERE user_id = ?1 ORDER BY created_at'),
    query(
      `SELECT id, concept_id, session_id, rung, type, prompt, code, answer, options, explain, checklist, status, due, stability, difficulty,
              elapsed_days, scheduled_days, learning_steps, reps, lapses, state, last_review, created_at, edited_at, origin
         FROM cards WHERE user_id = ?1 ORDER BY created_at`,
    ),
    query('SELECT id, card_id, grade, response, confidence, elapsed_ms, reviewed_at, run_id, prev_card FROM review_logs WHERE user_id = ?1 ORDER BY reviewed_at'),
    query('SELECT local_time, enabled FROM reminder_slots WHERE user_id = ?1'),
    query('SELECT day FROM streak_freezes WHERE user_id = ?1 ORDER BY day'),
    query('SELECT card_id, reason, note, created_at FROM card_reports WHERE user_id = ?1 ORDER BY created_at'),
    query('SELECT concept_name, question, created_at FROM shared_questions WHERE user_id = ?1 ORDER BY created_at'),
    query('SELECT alias, path, created_at FROM category_aliases WHERE user_id = ?1 ORDER BY created_at'),
    query('SELECT badge, earned_at FROM badges WHERE user_id = ?1 ORDER BY earned_at'),
    query('SELECT material, label, updated_at FROM material_labels WHERE user_id = ?1'),
    query('SELECT material, part, label, updated_at FROM material_part_labels WHERE user_id = ?1'),
    query('SELECT week, used, note, created_at FROM survey_answers WHERE user_id = ?1 ORDER BY week'),
    query('SELECT amount, kind, note, created_at FROM credit_ledger WHERE user_id = ?1 ORDER BY created_at'),
    query('SELECT achievement, earned_at FROM achievements WHERE user_id = ?1 ORDER BY earned_at'),
    // AI 작업은 결과만, 사용량은 달·종류별 합계만 (입력 원문과 비용은 넣지 않는다)
    query('SELECT id, kind, status, card_id, result, error, created_at, updated_at FROM llm_jobs WHERE user_id = ?1 ORDER BY created_at'),
    query(
      `SELECT strftime('%Y-%m', created_at / 1000, 'unixepoch') AS month, kind, count(*) AS calls, sum(input_tokens) AS input_tokens, sum(output_tokens) AS output_tokens
         FROM llm_usage WHERE user_id = ?1 GROUP BY month, kind ORDER BY month, kind`,
    ),
  ]);
  const [user, identity, sessions, concepts, edges, judgments, followups, cards, reviews, reminders, freezes, reports, shared, categoryAliases, badges, materialLabels, partLabels, surveyAnswers, credits, achievements, aiJobs, aiUsage] = results.map(
    (result) => result.results,
  );
  const body = {
    format: 'moai-export-v2',
    exported_at: new Date().toISOString(),
    user: user![0] ?? null,
    github_login: (identity![0] as { login?: string } | undefined)?.login ?? null,
    sessions,
    concepts,
    edges,
    judgments,
    followups,
    cards,
    review_logs: reviews,
    reminders,
    streak_freezes: freezes,
    card_reports: reports,
    shared_questions: shared,
    category_aliases: categoryAliases,
    badges,
    material_labels: materialLabels,
    material_part_labels: partLabels,
    survey_answers: surveyAnswers,
    credit_ledger: credits,
    achievements,
    ai_jobs: aiJobs,
    ai_usage: aiUsage,
  };
  const day = new Date().toISOString().slice(0, 10);
  return new Response(JSON.stringify(body), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="moai-export-${day}.json"`,
      'cache-control': 'no-store',
    },
  });
});

/** 한 사용자의 행을 모두 지운다. 외래 키 순서대로, 한 batch(트랜잭션)로. 비용 기록은 이번 달 합계가 맞도록 익명으로 남긴다 */
export function deleteUserStatements(env: Env, userId: string): D1PreparedStatement[] {
  const run = (sql: string) => env.DB.prepare(sql).bind(userId);
  return [
    run('DELETE FROM review_logs WHERE user_id = ?1 OR card_id IN (SELECT id FROM cards WHERE user_id = ?1)'),
    run('DELETE FROM card_reports WHERE user_id = ?1 OR card_id IN (SELECT id FROM cards WHERE user_id = ?1)'),
    run('DELETE FROM cards WHERE user_id = ?1'),
    run('DELETE FROM judgments WHERE user_id = ?1'),
    run('DELETE FROM followups WHERE user_id = ?1'),
    run('DELETE FROM edges WHERE user_id = ?1'),
    run('DELETE FROM concepts WHERE user_id = ?1'),
    run('DELETE FROM material_labels WHERE user_id = ?1'),
    run('DELETE FROM material_part_labels WHERE user_id = ?1'),
    run('DELETE FROM survey_answers WHERE user_id = ?1'),
    run('DELETE FROM credit_ledger WHERE user_id = ?1'),
    run('DELETE FROM achievements WHERE user_id = ?1'),
    run('DELETE FROM learning_sessions WHERE user_id = ?1'),
    run('DELETE FROM push_subscriptions WHERE user_id = ?1'),
    run('DELETE FROM reminder_slots WHERE user_id = ?1'),
    run('DELETE FROM mcp_tokens WHERE user_id = ?1'),
    run('DELETE FROM auth_sessions WHERE user_id = ?1'),
    run('DELETE FROM login_codes WHERE user_id = ?1'),
    run('DELETE FROM user_identities WHERE user_id = ?1'),
    run('DELETE FROM streak_freezes WHERE user_id = ?1'),
    run('DELETE FROM badges WHERE user_id = ?1'),
    run('DELETE FROM shared_questions WHERE user_id = ?1'),
    run('DELETE FROM category_aliases WHERE user_id = ?1'),
    run('DELETE FROM llm_jobs WHERE user_id = ?1'),
    run("UPDATE llm_usage SET user_id = 'deleted' WHERE user_id = ?1"),
    // 쓴 초대는 남기되(초대한 사람의 목록), 이름이 든 라벨은 지운다
    run("UPDATE invites SET used_by = NULL, label = '지운 회원' WHERE used_by = ?1"),
    // 이 사람에게 묶인 안 쓴 복구 초대는 지운다. 남겨 두면 묶임이 풀린 채 새 가입 초대가 된다
    run('DELETE FROM invites WHERE bind_user_id = ?1 AND used_at IS NULL'),
    run('UPDATE invites SET bind_user_id = NULL WHERE bind_user_id = ?1'),
    run('DELETE FROM invites WHERE created_by = ?1'),
    run('DELETE FROM users WHERE id = ?1'),
  ];
}

/** 내 로그인 목록 (설정의 로그인한 기기). 기기 이름은 저장하지 않아서 시각만 보여 준다 */
me.get('/logins', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT token_hash = ?2 AS current, created_at, last_seen_at FROM auth_sessions WHERE user_id = ?1 AND expires_at > ?3 ORDER BY last_seen_at DESC',
  )
    .bind(c.var.userId, c.var.sessionHash, Date.now())
    .all<{ current: number; created_at: number; last_seen_at: number }>();
  const logins: LoginSummary[] = results.map((row) => ({ current: row.current === 1, created_at: row.created_at, last_seen_at: row.last_seen_at }));
  return c.json({ logins });
});

/**
 * 이 기기만 남기고 다른 기기에서 모두 로그아웃하고, 이 기기(보낸 endpoint) 말고는 알림 구독도 지운다.
 * 커넥터(claude.ai)는 그대로다. 끊으려면 설정의 커넥터에서 따로 끊는다
 */
me.delete('/logins', async (c) => {
  const body = c.req.header('content-type')?.includes('application/json') ? await readJson(c, LogoutBody) : {};
  if (body instanceof Response) return body;
  const [ended] = await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM auth_sessions WHERE user_id = ?1 AND token_hash != ?2').bind(c.var.userId, c.var.sessionHash),
    c.env.DB.prepare('DELETE FROM push_subscriptions WHERE user_id = ?1 AND endpoint != ?2').bind(c.var.userId, body.endpoint ?? ''),
  ]);
  return c.json({ ended: ended!.meta.changes });
});

/** 바뀐 약관·처리방침을 확인했다 (오늘 화면의 확인 카드). 지금 시행일을 적는다 */
me.put('/me/terms', async (c) => {
  await c.env.DB.prepare('UPDATE users SET terms_version = ?2, terms_accepted_at = ?3 WHERE id = ?1').bind(c.var.userId, TERMS_VERSION, Date.now()).run();
  return c.json({ terms_version: TERMS_VERSION });
});

me.delete('/me', async (c) => {
  const body = await readJson(c, DeleteAccountBody);
  if (body instanceof Response) return body;
  const user = await c.env.DB.prepare('SELECT display_name, role FROM users WHERE id = ?1').bind(c.var.userId).first<{ display_name: string; role: string }>();
  if (!user) return errorJson(404, 'not_found', '계정을 찾지 못했어요.');
  // 오너가 사라지면 초대와 관리를 할 사람이 없다
  if (user.role === 'owner') return errorJson(403, 'owner_cannot_delete', '오너 계정은 여기서 지울 수 없어요.');
  if (body.confirm.trim() !== user.display_name) return errorJson(400, 'confirm_mismatch', '이름이 맞지 않아요. 내 이름을 그대로 써 주세요.');
  await revokeAllGrants(c.env, c.var.userId);
  await c.env.DB.batch(deleteUserStatements(c.env, c.var.userId));
  console.log(JSON.stringify({ event: 'account_deleted', user_id: c.var.userId }));
  dropCookie(c, SESSION_COOKIE);
  return c.body(null, 204);
});
