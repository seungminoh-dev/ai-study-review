import { DeleteAccountBody } from '@moai/shared';
import { Hono } from 'hono';
import { deleteCookie } from 'hono/cookie';
import { SESSION_COOKIE } from '../auth/session';
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
    query('SELECT id, source, topic, final_answer, key_terms, summary, created_at FROM learning_sessions WHERE user_id = ?1 ORDER BY created_at'),
    query('SELECT id, key, name, aliases, domain, final_answer, created_at, updated_at FROM concepts WHERE user_id = ?1 ORDER BY created_at'),
    query(
      `SELECT f.key AS from_key, t.key AS to_key, e.type, e.created_at FROM edges e
         JOIN concepts f ON f.id = e.from_id JOIN concepts t ON t.id = e.to_id WHERE e.user_id = ?1`,
    ),
    query('SELECT id, concept_id, session_id, label, said, note, created_at FROM judgments WHERE user_id = ?1 ORDER BY created_at'),
    query('SELECT id, concept_id, session_id, question, created_at, resolved_at FROM followups WHERE user_id = ?1 ORDER BY created_at'),
    query(
      `SELECT id, concept_id, session_id, rung, type, prompt, code, answer, options, explain, checklist, status, due, stability, difficulty,
              reps, lapses, state, last_review, created_at, edited_at FROM cards WHERE user_id = ?1 ORDER BY created_at`,
    ),
    query('SELECT id, card_id, grade, response, elapsed_ms, reviewed_at FROM review_logs WHERE user_id = ?1 ORDER BY reviewed_at'),
    query('SELECT local_time, enabled FROM reminder_slots WHERE user_id = ?1'),
    query('SELECT day FROM streak_freezes WHERE user_id = ?1 ORDER BY day'),
    query('SELECT card_id, reason, note, created_at FROM card_reports WHERE user_id = ?1 ORDER BY created_at'),
  ]);
  const [user, identity, sessions, concepts, edges, judgments, followups, cards, reviews, reminders, freezes, reports] = results.map((result) => result.results);
  const body = {
    format: 'moai-export-v1',
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
  };
  const day = new Date().toISOString().slice(0, 10);
  return new Response(JSON.stringify(body, null, 2), {
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
    run('DELETE FROM learning_sessions WHERE user_id = ?1'),
    run('DELETE FROM push_subscriptions WHERE user_id = ?1'),
    run('DELETE FROM reminder_slots WHERE user_id = ?1'),
    run('DELETE FROM mcp_tokens WHERE user_id = ?1'),
    run('DELETE FROM auth_sessions WHERE user_id = ?1'),
    run('DELETE FROM login_codes WHERE user_id = ?1'),
    run('DELETE FROM user_identities WHERE user_id = ?1'),
    run('DELETE FROM streak_freezes WHERE user_id = ?1'),
    run('DELETE FROM llm_jobs WHERE user_id = ?1'),
    run("UPDATE llm_usage SET user_id = 'deleted' WHERE user_id = ?1"),
    run('UPDATE invites SET used_by = NULL WHERE used_by = ?1'),
    run('UPDATE invites SET bind_user_id = NULL WHERE bind_user_id = ?1'),
    run('DELETE FROM invites WHERE created_by = ?1'),
    run('DELETE FROM users WHERE id = ?1'),
  ];
}

me.delete('/me', async (c) => {
  const body = await readJson(c, DeleteAccountBody);
  if (body instanceof Response) return body;
  const user = await c.env.DB.prepare('SELECT display_name, role FROM users WHERE id = ?1').bind(c.var.userId).first<{ display_name: string; role: string }>();
  if (!user) return errorJson(404, 'not_found', '계정을 찾지 못했어요.');
  // 오너가 사라지면 초대와 관리를 할 사람이 없다
  if (user.role === 'owner') return errorJson(403, 'owner_cannot_delete', '오너 계정은 여기서 지울 수 없어요.');
  if (body.confirm.trim() !== user.display_name) return errorJson(400, 'confirm_mismatch', '이름이 맞지 않아요. 내 이름을 그대로 써 주세요.');
  await c.env.DB.batch(deleteUserStatements(c.env, c.var.userId));
  console.log(JSON.stringify({ event: 'account_deleted', user_id: c.var.userId }));
  deleteCookie(c, SESSION_COOKIE, { path: '/', secure: true });
  return c.body(null, 204);
});
