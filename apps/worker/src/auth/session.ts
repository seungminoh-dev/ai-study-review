import type { Context, MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { AppEnv } from '../context';
import { hashToken, randomToken } from '../lib/crypto';
import { DAY_MS } from '../lib/kst';
import { errorJson } from '../lib/http';

// 로그인 세션 (설계서 §8.2). 토큰은 쿠키에만 있고 DB에는 해시만 둔다.

export const SESSION_COOKIE = '__Host-sid';
const SESSION_TTL_MS = 180 * DAY_MS;
/** 계속 써도 처음 로그인한 때부터 이만큼 지나면 다시 로그인한다 (개선점 26) */
const SESSION_MAX_MS = 365 * DAY_MS;
/** 쓸 때마다 연장하되, DB 쓰기를 줄이려고 하루에 한 번만 갱신한다 */
const TOUCH_EVERY_MS = DAY_MS;

/** 이 사이트에서만 쓰는 쿠키 (자바스크립트로 읽지 못하고, https에서만 보낸다) */
export function shortCookie(c: Context, name: string, value: string, ttlMs: number): void {
  setCookie(c, name, value, { httpOnly: true, secure: true, sameSite: 'Lax', path: '/', maxAge: ttlMs / 1000 });
}

export function dropCookie(c: Context, name: string): void {
  deleteCookie(c, name, { path: '/', secure: true });
}

export async function startSession(c: Context<AppEnv>, userId: string, now: number): Promise<void> {
  const token = randomToken();
  await c.env.DB.prepare('INSERT INTO auth_sessions (token_hash, user_id, created_at, last_seen_at, expires_at) VALUES (?1, ?2, ?3, ?3, ?4)')
    .bind(await hashToken(c.env.TOKEN_PEPPER, token), userId, now, now + SESSION_TTL_MS)
    .run();
  shortCookie(c, SESSION_COOKIE, token, SESSION_TTL_MS);
}

interface SessionRow {
  user_id: string;
  created_at: number;
  last_seen_at: number;
  expires_at: number;
}

/** 쿠키의 세션이 살아 있으면 돌려준다. 로그인하지 않아도 되는 경로에서 "로그인했으면"을 볼 때 쓴다. */
export async function currentSession(c: Context<AppEnv>, now: number): Promise<(SessionRow & { token_hash: string; token: string }) | null> {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token || !c.env.TOKEN_PEPPER) return null;
  const tokenHash = await hashToken(c.env.TOKEN_PEPPER, token);
  // 이용을 멈춘 회원의 세션은 없는 것으로 본다
  const row = await c.env.DB.prepare(
    'SELECT s.user_id, s.created_at, s.last_seen_at, s.expires_at FROM auth_sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?1 AND u.disabled_at IS NULL',
  )
    .bind(tokenHash)
    .first<SessionRow>();
  return row && row.expires_at > now && now - row.created_at < SESSION_MAX_MS ? { ...row, token_hash: tokenHash, token } : null;
}

/** 이 기기의 세션만 끝낸다. 다른 기기의 로그인은 그대로다. */
export async function endSession(c: Context<AppEnv>): Promise<void> {
  const token = getCookie(c, SESSION_COOKIE);
  if (token && c.env.TOKEN_PEPPER) {
    await c.env.DB.prepare('DELETE FROM auth_sessions WHERE token_hash = ?1').bind(await hashToken(c.env.TOKEN_PEPPER, token)).run();
  }
  dropCookie(c, SESSION_COOKIE);
}

/** /api/*에서 로그인을 요구한다. 세션이 있으면 c.var.userId를 채운다. */
export const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  const now = Date.now();
  const session = await currentSession(c, now);
  if (!session) return errorJson(401, 'login_required', '로그인이 필요해요.');
  const token = session.token;
  c.set('userId', session.user_id);
  c.set('sessionHash', session.token_hash);
  await next();
  if (now - session.last_seen_at > TOUCH_EVERY_MS) {
    c.executionCtx.waitUntil(
      c.env.DB.prepare('UPDATE auth_sessions SET last_seen_at = ?2, expires_at = ?3 WHERE token_hash = ?1')
        .bind(session.token_hash, now, Math.min(now + SESSION_TTL_MS, session.created_at + SESSION_MAX_MS))
        .run(),
    );
    // 응답이 정해진 뒤라 setCookie가 c.res의 헤더에 바로 붙는다
    shortCookie(c, SESSION_COOKIE, token, SESSION_TTL_MS);
  }
};
