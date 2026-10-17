import { JoinBody, LoginCodeBody, LogoutBody, type AuthOptions, type PendingJoin } from '@moai/shared';
import { Hono, type Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { authorizeUrl, fetchGithubUser, githubConfigured, pkceChallenge, type GithubUser } from '../auth/github';
import { currentSession, endSession, startSession } from '../auth/session';
import type { AppEnv } from '../context';
import { loadMe } from '../domain/users';
import { INVITE_CODE_LENGTH, LOGIN_CODE_LENGTH, normalizeCode } from '../lib/codes';
import { hashToken, randomToken, safeEqual } from '../lib/crypto';
import { errorJson, readJson } from '../lib/http';
import { MINUTE_MS } from '../lib/kst';

// 로그인 전에 쓰는 API (설계서 §8.4, §8.5): GitHub 로그인, 초대 코드로 가입, 다른 기기 로그인 코드, 로그아웃.
// GitHub에서 돌아오는 콜백은 화면 이동(GET)이라 JSON 대신 앱 주소로 리다이렉트한다.

export const auth = new Hono<AppEnv>();

const STATE_COOKIE = '__Host-moai-oauth';
const JOIN_COOKIE = '__Host-moai-join';
const STATE_TTL_MS = 10 * MINUTE_MS;
const JOIN_TTL_MS = 30 * MINUTE_MS;
/** 한 번의 GitHub 확인으로 초대 코드를 틀릴 수 있는 횟수 */
const MAX_JOIN_ATTEMPTS = 5;

type Intent = 'login' | 'link';

function shortCookie(c: Context<AppEnv>, name: string, value: string, ttlMs: number): void {
  setCookie(c, name, value, { httpOnly: true, secure: true, sameSite: 'Lax', path: '/', maxAge: ttlMs / 1000 });
}

function dropCookie(c: Context<AppEnv>, name: string): void {
  deleteCookie(c, name, { path: '/', secure: true });
}

auth.get('/options', async (c) => {
  const owner = await c.env.DB.prepare("SELECT 1 FROM users WHERE role = 'owner' LIMIT 1").first();
  return c.json({ setup_available: owner === null, github: githubConfigured(c.env) } satisfies AuthOptions);
});

// 1. GitHub로 보낸다. intent=link는 로그인한 기기에서 내 계정에 GitHub를 잇는다
auth.get('/github/start', async (c) => {
  if (!githubConfigured(c.env) || !c.env.TOKEN_PEPPER) return c.redirect('/?auth=unavailable');
  const intent: Intent = c.req.query('intent') === 'link' ? 'link' : 'login';
  const state = randomToken();
  const verifier = randomToken();
  // 콜백에서 같은 브라우저인지 확인한다. 로그인 CSRF(남의 계정으로 로그인시키기)를 막는다
  shortCookie(c, STATE_COOKIE, `${intent}.${state}.${verifier}`, STATE_TTL_MS);
  return c.redirect(authorizeUrl(c.env, state, await pkceChallenge(verifier)));
});

// 2. GitHub에서 돌아온다
auth.get('/github/callback', async (c) => {
  const saved = getCookie(c, STATE_COOKIE)?.split('.');
  dropCookie(c, STATE_COOKIE);
  const [intent, state, verifier] = saved?.length === 3 ? (saved as [string, string, string]) : [];
  const back = intent === 'link' ? '/settings?github=' : '/?auth=';
  if (c.req.query('error')) return c.redirect(`${back}denied`);
  const code = c.req.query('code');
  const returned = c.req.query('state');
  if (!state || !verifier || !code || !returned || !(await safeEqual(returned, state))) return c.redirect(`${back}expired`);

  const github = await fetchGithubUser(c.env, code, verifier).catch(() => null);
  if (!github) {
    console.error(JSON.stringify({ event: 'github_login_failed' }));
    return c.redirect(`${back}failed`);
  }
  const now = Date.now();
  return intent === 'link' ? linkGithub(c, github, now) : loginWithGithub(c, github, now);
});

async function linkGithub(c: Context<AppEnv>, github: GithubUser, now: number): Promise<Response> {
  const session = await currentSession(c, now);
  if (!session) return c.redirect('/?auth=expired');
  const owner = await c.env.DB.prepare("SELECT user_id FROM user_identities WHERE provider = 'github' AND subject = ?1")
    .bind(github.id)
    .first<string>('user_id');
  if (owner && owner !== session.user_id) return c.redirect('/settings?github=taken');
  // 다른 GitHub 계정을 이어 두었으면 바꾼다. 그사이 다른 사람이 같은 GitHub를 이었으면 키 충돌로 batch 전체가 되돌아간다
  try {
    await c.env.DB.batch([
      c.env.DB.prepare("DELETE FROM user_identities WHERE user_id = ?1 AND provider = 'github'").bind(session.user_id),
      c.env.DB.prepare("INSERT INTO user_identities (provider, subject, user_id, login, created_at) VALUES ('github', ?1, ?2, ?3, ?4)").bind(
        github.id,
        session.user_id,
        github.login,
        now,
      ),
    ]);
  } catch {
    return c.redirect('/settings?github=taken');
  }
  return c.redirect('/settings?github=linked');
}

async function loginWithGithub(c: Context<AppEnv>, github: GithubUser, now: number): Promise<Response> {
  const identity = await c.env.DB.prepare("SELECT user_id, login FROM user_identities WHERE provider = 'github' AND subject = ?1")
    .bind(github.id)
    .first<{ user_id: string; login: string }>();
  if (identity) {
    if (identity.login !== github.login) {
      await c.env.DB.prepare("UPDATE user_identities SET login = ?2 WHERE provider = 'github' AND subject = ?1").bind(github.id, github.login).run();
    }
    await startSession(c, identity.user_id, now);
    return c.redirect('/');
  }
  // 처음 보는 GitHub 계정이면 초대 코드를 받는다. GitHub 정보는 서버에 두고 브라우저에는 토큰만 준다
  const token = randomToken();
  await c.env.DB.prepare(
    "INSERT INTO pending_signups (token_hash, provider, subject, login, name, expires_at) VALUES (?1, 'github', ?2, ?3, ?4, ?5)",
  )
    .bind(await hashToken(c.env.TOKEN_PEPPER, token), github.id, github.login, github.name, now + JOIN_TTL_MS)
    .run();
  shortCookie(c, JOIN_COOKIE, token, JOIN_TTL_MS);
  return c.redirect('/join');
}

interface PendingRow {
  token_hash: string;
  subject: string;
  login: string;
  name: string | null;
}

async function pendingSignup(c: Context<AppEnv>, now: number): Promise<PendingRow | null> {
  const token = getCookie(c, JOIN_COOKIE);
  if (!token || !c.env.TOKEN_PEPPER) return null;
  return c.env.DB.prepare('SELECT token_hash, subject, login, name FROM pending_signups WHERE token_hash = ?1 AND expires_at > ?2')
    .bind(await hashToken(c.env.TOKEN_PEPPER, token), now)
    .first<PendingRow>();
}

const JOIN_EXPIRED = () => errorJson(410, 'join_expired', 'GitHub 확인이 만료됐어요. 처음부터 다시 해 주세요.');

// 3. 초대 코드 화면이 GitHub 아이디와 이름을 미리 채운다
auth.get('/join', async (c) => {
  const pending = await pendingSignup(c, Date.now());
  if (!pending) return JOIN_EXPIRED();
  return c.json({ github_login: pending.login, suggested_name: (pending.name ?? pending.login).slice(0, 30) } satisfies PendingJoin);
});

// 4. 초대 코드를 확인하고 계정을 만든다
auth.post('/join', async (c) => {
  const body = await readJson(c, JoinBody);
  if (body instanceof Response) return body;
  const now = Date.now();
  const pending = await pendingSignup(c, now);
  if (!pending) return JOIN_EXPIRED();
  // 시도를 먼저 센다. 읽고 나서 나중에 올리면, 동시에 보낸 요청들이 모두 같은 횟수를 읽고 상한을 넘는다
  const attempts = await c.env.DB.prepare(
    'UPDATE pending_signups SET attempts = attempts + 1 WHERE token_hash = ?1 AND attempts < ?2 RETURNING attempts',
  )
    .bind(pending.token_hash, MAX_JOIN_ATTEMPTS)
    .first<number>('attempts');
  if (attempts === null) return errorJson(429, 'too_many_attempts', '코드를 너무 많이 틀렸어요. GitHub 로그인부터 다시 해 주세요.');

  // 그사이 같은 GitHub 계정으로 가입을 마쳤으면 그 계정으로 로그인한다
  const existing = await c.env.DB.prepare("SELECT user_id FROM user_identities WHERE provider = 'github' AND subject = ?1")
    .bind(pending.subject)
    .first<string>('user_id');
  if (existing) {
    await finishJoin(c, pending.token_hash, existing, now);
    return c.json(await loadMe(c.env, existing));
  }

  const code = normalizeCode(body.code, INVITE_CODE_LENGTH);
  const row = code
    ? await c.env.DB.prepare('SELECT id, bind_user_id FROM invites WHERE code_hash = ?1 AND used_at IS NULL AND expires_at > ?2')
        .bind(await hashToken(c.env.TOKEN_PEPPER, `invite:${code}`), now)
        .first<{ id: string; bind_user_id: string | null }>()
    : null;
  if (!row) return errorJson(403, 'wrong_code', `초대 코드가 맞지 않거나 만료됐어요. (남은 시도 ${MAX_JOIN_ATTEMPTS - attempts}번)`);
  const invite = row.id;
  if (row.bind_user_id) return recoverAccount(c, pending, invite, row.bind_user_id, now);

  // batch는 한 트랜잭션이라 중간에 끼어드는 요청이 없다. 초대가 아직 안 쓰였을 때만 계정이 생기고, 계정이 생겼을 때만 나머지를 쓴다.
  const userId = crypto.randomUUID();
  const [created] = await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO users (id, display_name, role, created_at) SELECT ?1, ?2, 'member', ?3 WHERE EXISTS (SELECT 1 FROM invites WHERE id = ?4 AND used_at IS NULL)",
    ).bind(userId, body.display_name, now, invite),
    c.env.DB.prepare(
      "INSERT INTO user_identities (provider, subject, user_id, login, created_at) SELECT 'github', ?2, ?1, ?3, ?4 WHERE EXISTS (SELECT 1 FROM users WHERE id = ?1)",
    ).bind(userId, pending.subject, pending.login, now),
    c.env.DB.prepare('UPDATE invites SET used_at = ?3, used_by = ?1 WHERE id = ?2 AND used_at IS NULL AND EXISTS (SELECT 1 FROM users WHERE id = ?1)').bind(
      userId,
      invite,
      now,
    ),
  ]);
  if (created!.meta.changes === 0) return errorJson(403, 'wrong_code', '방금 다른 사람이 이 초대 코드를 썼어요.');
  console.log(JSON.stringify({ event: 'user_joined', user_id: userId }));
  await finishJoin(c, pending.token_hash, userId, now);
  return c.json(await loadMe(c.env, userId), 201);
});

/**
 * 기기 복구 초대 (설계서 §8.5): 새 계정 대신 기존 계정에 이 GitHub를 잇고 로그인한다.
 * 잃어버린 기기가 다른 사람 손에 있을 수 있으니 그 계정의 다른 로그인은 모두 끝낸다.
 */
async function recoverAccount(c: Context<AppEnv>, pending: PendingRow, invite: string, userId: string, now: number): Promise<Response> {
  // 초대를 이 요청이 차지했을 때만 나머지를 쓴다 (used_at·used_by가 이 요청 값이면 차지한 것)
  const claimed = 'EXISTS (SELECT 1 FROM invites WHERE id = ?1 AND used_by = ?2 AND used_at = ?3)';
  let claim: D1Result | undefined;
  try {
    [claim] = await c.env.DB.batch([
    c.env.DB.prepare('UPDATE invites SET used_at = ?3, used_by = ?2 WHERE id = ?1 AND used_at IS NULL AND EXISTS (SELECT 1 FROM users WHERE id = ?2)').bind(invite, userId, now),
    c.env.DB.prepare(`DELETE FROM user_identities WHERE user_id = ?2 AND provider = 'github' AND ${claimed}`).bind(invite, userId, now),
    c.env.DB.prepare(`INSERT INTO user_identities (provider, subject, user_id, login, created_at) SELECT 'github', ?4, ?2, ?5, ?3 WHERE ${claimed}`).bind(
      invite,
      userId,
      now,
      pending.subject,
      pending.login,
    ),
    c.env.DB.prepare(`DELETE FROM auth_sessions WHERE user_id = ?2 AND ${claimed}`).bind(invite, userId, now),
    ]);
  } catch {
    // 그사이 이 GitHub가 다른 계정에 이어졌다. batch 전체가 되돌아갔다
    return errorJson(409, 'github_taken', '이 GitHub 계정은 이미 다른 모아이 계정에 이어져 있어요.');
  }
  if (claim!.meta.changes === 0) return errorJson(403, 'wrong_code', '방금 이 초대 코드를 누가 썼어요.');
  console.log(JSON.stringify({ event: 'account_recovered', user_id: userId }));
  await finishJoin(c, pending.token_hash, userId, now);
  return c.json(await loadMe(c.env, userId));
}

async function finishJoin(c: Context<AppEnv>, pendingHash: string, userId: string, now: number): Promise<void> {
  await c.env.DB.prepare('DELETE FROM pending_signups WHERE token_hash = ?1').bind(pendingHash).run();
  dropCookie(c, JOIN_COOKIE);
  await startSession(c, userId, now);
}

// 다른 기기에서 받은 코드로 로그인한다. 코드는 한 번 쓰면 지운다
auth.post('/login', async (c) => {
  const body = await readJson(c, LoginCodeBody);
  if (body instanceof Response) return body;
  if (!c.env.TOKEN_PEPPER) return errorJson(503, 'login_unavailable', '서버 설정이 끝나지 않았어요.');
  const now = Date.now();
  const code = normalizeCode(body.code, LOGIN_CODE_LENGTH);
  const userId = code
    ? await c.env.DB.prepare('DELETE FROM login_codes WHERE code_hash = ?1 AND expires_at > ?2 RETURNING user_id')
        .bind(await hashToken(c.env.TOKEN_PEPPER, `login:${code}`), now)
        .first<string>('user_id')
    : null;
  if (!userId) return errorJson(403, 'wrong_code', '코드가 맞지 않거나 10분이 지났어요. 로그인된 기기에서 새 코드를 만들어 주세요.');
  await startSession(c, userId, now);
  return c.json(await loadMe(c.env, userId));
});

/** 이 기기의 세션을 끝낸다. 이 기기의 푸시 구독(endpoint)을 함께 보내면 그것도 지운다. 다음에 이 기기를 쓰는 사람에게 내 알림이 가지 않는다 */
auth.post('/logout', async (c) => {
  const body = c.req.header('content-type')?.includes('application/json') ? await readJson(c, LogoutBody) : {};
  if (body instanceof Response) return body;
  const session = await currentSession(c, Date.now());
  if (session && body.endpoint) {
    await c.env.DB.prepare('DELETE FROM push_subscriptions WHERE user_id = ?1 AND endpoint = ?2').bind(session.user_id, body.endpoint).run();
  }
  await endSession(c);
  return c.body(null, 204);
});
