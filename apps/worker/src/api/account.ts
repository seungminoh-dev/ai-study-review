import { InviteBody, type InviteSummary, type LoginCode } from '@moai/shared';
import { Hono, type MiddlewareHandler } from 'hono';
import type { AppEnv } from '../context';
import { INVITE_CODE_LENGTH, LOGIN_CODE_LENGTH, formatCode, randomCode } from '../lib/codes';
import { hashToken } from '../lib/crypto';
import { errorJson, readJson } from '../lib/http';
import { DAY_MS, MINUTE_MS } from '../lib/kst';

// 계정 설정 (설계서 §8.4, §8.5): 다른 기기 로그인 코드, 오너의 초대 코드 관리. 코드는 만들 때 한 번만 보여 준다.

export const account = new Hono<AppEnv>();

const LOGIN_CODE_TTL_MS = 10 * MINUTE_MS;
const INVITE_TTL_MS = 7 * DAY_MS;

/** 새 코드를 만들면 이전 코드는 바로 무효다 */
account.post('/login-codes', async (c) => {
  const code = randomCode(LOGIN_CODE_LENGTH);
  const expiresAt = Date.now() + LOGIN_CODE_TTL_MS;
  await c.env.DB.prepare(
    `INSERT INTO login_codes (code_hash, user_id, expires_at) VALUES (?1, ?2, ?3)
     ON CONFLICT (user_id) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at`,
  )
    .bind(await hashToken(c.env.TOKEN_PEPPER, `login:${code}`), c.var.userId, expiresAt)
    .run();
  return c.json({ code: formatCode(code), expires_at: expiresAt } satisfies LoginCode, 201);
});

const requireOwner: MiddlewareHandler<AppEnv> = async (c, next) => {
  const role = await c.env.DB.prepare('SELECT role FROM users WHERE id = ?1').bind(c.var.userId).first<string>('role');
  if (role !== 'owner') return errorJson(403, 'owner_only', '오너만 초대할 수 있어요.');
  await next();
};
account.use('/invites', requireOwner);
account.use('/invites/*', requireOwner);

account.get('/invites', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT i.id, i.label, i.created_at, i.expires_at, i.used_at, u.display_name AS used_by_name
       FROM invites i LEFT JOIN users u ON u.id = i.used_by
      WHERE i.created_by = ?1 ORDER BY i.created_at DESC LIMIT 50`,
  )
    .bind(c.var.userId)
    .all<InviteSummary>();
  return c.json({ invites: results });
});

account.post('/invites', async (c) => {
  const body = await readJson(c, InviteBody);
  if (body instanceof Response) return body;
  const now = Date.now();
  const code = randomCode(INVITE_CODE_LENGTH);
  const invite: InviteSummary = { id: crypto.randomUUID(), label: body.label, created_at: now, expires_at: now + INVITE_TTL_MS, used_at: null, used_by_name: null };
  await c.env.DB.prepare('INSERT INTO invites (id, code_hash, label, created_by, created_at, expires_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)')
    .bind(invite.id, await hashToken(c.env.TOKEN_PEPPER, `invite:${code}`), invite.label, c.var.userId, now, invite.expires_at)
    .run();
  return c.json({ invite, code: formatCode(code) }, 201);
});

/** 아직 쓰지 않은 초대만 지운다. 쓴 초대는 누가 가입했는지 남겨 둔다 */
account.delete('/invites/:id', async (c) => {
  const removed = await c.env.DB.prepare('DELETE FROM invites WHERE id = ?1 AND created_by = ?2 AND used_at IS NULL')
    .bind(c.req.param('id'), c.var.userId)
    .run();
  return removed.meta.changes > 0 ? c.body(null, 204) : errorJson(404, 'not_found', '지울 수 있는 초대가 없어요.');
});
