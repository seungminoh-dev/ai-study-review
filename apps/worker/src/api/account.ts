import { InviteBody, type InviteSummary, type LoginCode, type MemberSummary } from '@moai/shared';
import { revokeAccessStatements, revokeAllGrants } from '../auth/grants';
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
/** 기기 복구 초대는 그 계정으로 바로 로그인하는 코드라 짧게 둔다 */
const RECOVERY_TTL_MS = DAY_MS;

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

export const requireOwner: MiddlewareHandler<AppEnv> = async (c, next) => {
  const role = await c.env.DB.prepare('SELECT role FROM users WHERE id = ?1').bind(c.var.userId).first<string>('role');
  if (role !== 'owner') return errorJson(403, 'owner_only', '오너만 할 수 있어요.');
  await next();
};
account.use('/invites', requireOwner);
account.use('/invites/*', requireOwner);
account.use('/members', requireOwner);
account.use('/members/*', requireOwner);

/** 회원 목록: 기기 복구 초대를 만들 때 고르고, 이용을 멈추거나 다시 연다 */
account.get('/members', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT u.id, u.display_name, i.login AS github_login, u.created_at, u.disabled_at
       FROM users u LEFT JOIN user_identities i ON i.user_id = u.id AND i.provider = 'github'
      WHERE u.role = 'member' ORDER BY u.created_at`,
  ).all<MemberSummary>();
  return c.json({ members: results });
});

account.get('/invites', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT i.id, i.label, i.created_at, i.expires_at, i.used_at, u.display_name AS used_by_name, b.display_name AS bind_name
       FROM invites i LEFT JOIN users u ON u.id = i.used_by LEFT JOIN users b ON b.id = i.bind_user_id
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
account.post('/members/:id/disable', async (c) => {
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
account.post('/members/:id/enable', async (c) => {
  const { meta } = await c.env.DB.prepare("UPDATE users SET disabled_at = NULL WHERE id = ?1 AND role = 'member'").bind(c.req.param('id')).run();
  if (meta.changes === 0) return errorJson(404, 'not_found', '회원을 찾지 못했어요.');
  console.log(JSON.stringify({ event: 'member_enabled', user_id: c.req.param('id') }));
  return c.body(null, 204);
});

/** 아직 쓰지 않은 초대만 지운다. 쓴 초대는 누가 가입했는지 남겨 둔다 */
account.delete('/invites/:id', async (c) => {
  const removed = await c.env.DB.prepare('DELETE FROM invites WHERE id = ?1 AND created_by = ?2 AND used_at IS NULL')
    .bind(c.req.param('id'), c.var.userId)
    .run();
  return removed.meta.changes > 0 ? c.body(null, 204) : errorJson(404, 'not_found', '지울 수 있는 초대가 없어요.');
});
