import { JoinBody, LoginCodeBody, LogoutBody, TERMS_VERSION, type AuthOptions, type LoginProvider, type PendingJoin } from '@moai/shared';
import { Hono, type Context } from 'hono';
import { getCookie } from 'hono/cookie';
import { authorizeUrl, fetchGithubUser, githubConfigured, pkceChallenge, type ProviderUser } from '../auth/github';
import { fetchGoogleSubject, googleAuthorizeUrl, googleConfigured } from '../auth/google';
import { revokeAccessStatements, revokeAllGrants } from '../auth/grants';
import { currentSession, dropCookie, endSession, shortCookie, startSession } from '../auth/session';
import type { AppEnv } from '../context';
import { loadMe } from '../domain/users';
import { INVITE_CODE_LENGTH, LOGIN_CODE_LENGTH, normalizeCode } from '../lib/codes';
import { hashToken, randomToken, safeEqual } from '../lib/crypto';
import { errorJson, readJson } from '../lib/http';
import { DAY_MS, MINUTE_MS } from '../lib/kst';

// 로그인 전에 쓰는 API (설계서 §8.4, §8.5): GitHub·Google 로그인, 가입, 다른 기기 로그인 코드, 로그아웃.
// GitHub·Google에서 돌아오는 콜백은 화면 이동(GET)이라 JSON 대신 앱 주소로 리다이렉트한다.

export const auth = new Hono<AppEnv>();

const STATE_COOKIE = '__Host-moai-oauth';
/** GitHub·Google 로그인 뒤 돌아갈 곳. 커넥터 허용 화면(/authorize?)만 받아서 남의 사이트로 보내지 못한다 */
const NEXT_COOKIE = '__Host-moai-next';
const safeNext = (value: string | undefined) => (value && /^\/authorize\?[^\s]*$/.test(value) && value.length <= 2048 ? value : null);
const JOIN_COOKIE = '__Host-moai-join';
const STATE_TTL_MS = 10 * MINUTE_MS;
const JOIN_TTL_MS = 30 * MINUTE_MS;
/** 한 번의 GitHub·Google 확인으로 초대 코드를 틀릴 수 있는 횟수 */
const MAX_JOIN_ATTEMPTS = 5;
/** 초대 없이 가입하려면 GitHub 계정이 이만큼 묵어야 한다. 업적 크레딧을 노리고 막 만든 계정을 거른다 (Google은 만든 때를 주지 않아 하루 한도만 쓴다) */
const OPEN_MIN_ACCOUNT_AGE_MS = 30 * DAY_MS;
/** 초대 없이 가입할 수 있는 수 (최근 24시간, 서비스 전체). 한꺼번에 몰리는 가입이 AI 예산을 다 쓰지 못하게 한다 */
const OPEN_JOINS_PER_DAY = 30;

type Intent = 'login' | 'link';

const PROVIDER_NAME: Record<LoginProvider, string> = { github: 'GitHub', google: 'Google' };
const isProvider = (value: string | undefined): value is LoginProvider => value === 'github' || value === 'google';
const configured = (c: Context<AppEnv>, provider: LoginProvider) => (provider === 'github' ? githubConfigured(c.env) : googleConfigured(c.env));

auth.get('/options', async (c) => {
  const owner = await c.env.DB.prepare("SELECT 1 FROM users WHERE role = 'owner' LIMIT 1").first();
  return c.json({ setup_available: owner === null, github: githubConfigured(c.env), google: googleConfigured(c.env) } satisfies AuthOptions);
});

// 1. GitHub나 Google로 보낸다. intent=link는 로그인한 기기에서 내 계정에 그 계정을 잇는다
auth.get('/:provider/start', async (c) => {
  const provider = c.req.param('provider');
  if (!isProvider(provider)) return c.notFound();
  if (!configured(c, provider) || !c.env.TOKEN_PEPPER) return c.redirect('/?auth=unavailable');
  const intent: Intent = c.req.query('intent') === 'link' ? 'link' : 'login';
  const state = randomToken();
  const verifier = randomToken();
  // 콜백에서 같은 브라우저, 같은 로그인 방법인지 확인한다. 로그인 CSRF(남의 계정으로 로그인시키기)를 막는다
  shortCookie(c, STATE_COOKIE, `${provider}.${intent}.${state}.${verifier}`, STATE_TTL_MS);
  const next = safeNext(c.req.query('next'));
  if (next) shortCookie(c, NEXT_COOKIE, encodeURIComponent(next), STATE_TTL_MS);
  else dropCookie(c, NEXT_COOKIE);
  const challenge = await pkceChallenge(verifier);
  // Google의 nonce는 state를 그대로 쓴다. 둘 다 이 브라우저 쿠키에 묶인 일회용 값이다
  return c.redirect(provider === 'github' ? authorizeUrl(c.env, state, challenge) : googleAuthorizeUrl(c.env, state, challenge, state));
});

// 2. GitHub나 Google에서 돌아온다
auth.get('/:provider/callback', async (c) => {
  const provider = c.req.param('provider');
  if (!isProvider(provider)) return c.notFound();
  const saved = getCookie(c, STATE_COOKIE)?.split('.');
  dropCookie(c, STATE_COOKIE);
  const [from, intent, state, verifier] = saved?.length === 4 ? (saved as [string, string, string, string]) : [];
  const back = intent === 'link' ? `/settings?${provider}=` : '/?auth=';
  if (c.req.query('error')) return c.redirect(`${back}denied`);
  const code = c.req.query('code');
  const returned = c.req.query('state');
  if (from !== provider || !state || !verifier || !code || !returned || !(await safeEqual(returned, state))) return c.redirect(`${back}expired`);

  const now = Date.now();
  const user: ProviderUser | null =
    provider === 'github'
      ? await fetchGithubUser(c.env, code, verifier).catch(() => null)
      : await fetchGoogleSubject(c.env, code, verifier, state, now)
          .then((sub) => (sub ? { id: sub, login: '', name: null, createdAt: null } : null))
          .catch(() => null);
  if (!user) {
    console.error(JSON.stringify({ event: `${provider}_login_failed` }));
    return c.redirect(`${back}failed`);
  }
  return intent === 'link' ? linkIdentity(c, provider, user, now) : loginWith(c, provider, user, now);
});

async function linkIdentity(c: Context<AppEnv>, provider: LoginProvider, user: ProviderUser, now: number): Promise<Response> {
  const session = await currentSession(c, now);
  if (!session) return c.redirect('/?auth=expired');
  const back = `/settings?${provider}=`;
  const owner = await c.env.DB.prepare('SELECT user_id FROM user_identities WHERE provider = ?1 AND subject = ?2')
    .bind(provider, user.id)
    .first<string>('user_id');
  if (owner && owner !== session.user_id) return c.redirect(`${back}taken`);
  // 같은 종류의 다른 계정을 이어 두었으면 바꾼다. 그사이 다른 사람이 같은 계정을 이었으면 키 충돌로 batch 전체가 되돌아간다
  try {
    await c.env.DB.batch([
      c.env.DB.prepare('DELETE FROM user_identities WHERE user_id = ?1 AND provider = ?2').bind(session.user_id, provider),
      c.env.DB.prepare('INSERT INTO user_identities (provider, subject, user_id, login, created_at) VALUES (?1, ?2, ?3, ?4, ?5)').bind(
        provider,
        user.id,
        session.user_id,
        user.login,
        now,
      ),
    ]);
  } catch {
    return c.redirect(`${back}taken`);
  }
  return c.redirect(`${back}linked`);
}

async function loginWith(c: Context<AppEnv>, provider: LoginProvider, user: ProviderUser, now: number): Promise<Response> {
  const identity = await c.env.DB.prepare(
    'SELECT i.user_id, i.login, u.disabled_at FROM user_identities i JOIN users u ON u.id = i.user_id WHERE i.provider = ?1 AND i.subject = ?2',
  )
    .bind(provider, user.id)
    .first<{ user_id: string; login: string; disabled_at: number | null }>();
  if (identity?.disabled_at) return c.redirect('/?auth=disabled');
  if (identity) {
    if (identity.login !== user.login) {
      await c.env.DB.prepare('UPDATE user_identities SET login = ?3 WHERE provider = ?1 AND subject = ?2').bind(provider, user.id, user.login).run();
    }
    await startSession(c, identity.user_id, now);
    const next = safeNext(decodeURIComponent(getCookie(c, NEXT_COOKIE) ?? ''));
    dropCookie(c, NEXT_COOKIE);
    return c.redirect(next ?? '/');
  }
  // 처음 보는 계정이면 가입 화면으로 보낸다. 받은 계정 정보는 서버에 두고 브라우저에는 토큰만 준다
  const token = randomToken();
  await c.env.DB.prepare(
    'INSERT INTO pending_signups (token_hash, provider, subject, login, name, expires_at, account_created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)',
  )
    .bind(await hashToken(c.env.TOKEN_PEPPER, token), provider, user.id, user.login, user.name, now + JOIN_TTL_MS, user.createdAt)
    .run();
  shortCookie(c, JOIN_COOKIE, token, JOIN_TTL_MS);
  // Claude 커넥터 허용 화면에서 왔으면 가입 화면이 이어받아, 가입한 뒤 허용 화면으로 돌아간다
  const next = safeNext(decodeURIComponent(getCookie(c, NEXT_COOKIE) ?? ''));
  dropCookie(c, NEXT_COOKIE);
  return c.redirect(next ? `/join?${new URLSearchParams({ next })}` : '/join');
}

interface PendingRow {
  token_hash: string;
  provider: LoginProvider;
  subject: string;
  login: string;
  name: string | null;
  account_created_at: number | null;
}

async function pendingSignup(c: Context<AppEnv>, now: number): Promise<PendingRow | null> {
  const token = getCookie(c, JOIN_COOKIE);
  if (!token || !c.env.TOKEN_PEPPER) return null;
  return c.env.DB.prepare('SELECT token_hash, provider, subject, login, name, account_created_at FROM pending_signups WHERE token_hash = ?1 AND expires_at > ?2')
    .bind(await hashToken(c.env.TOKEN_PEPPER, token), now)
    .first<PendingRow>();
}

const JOIN_EXPIRED = () => errorJson(410, 'join_expired', '로그인 확인이 만료됐어요. 처음부터 다시 해 주세요.');

// 3. 가입 화면이 GitHub 아이디와 이름을 미리 채운다 (Google은 이름을 받지 않아 비워 둔다)
auth.get('/join', async (c) => {
  const pending = await pendingSignup(c, Date.now());
  if (!pending) return JOIN_EXPIRED();
  return c.json({
    provider: pending.provider,
    github_login: pending.provider === 'github' ? pending.login : null,
    suggested_name: (pending.name ?? pending.login).slice(0, 30),
  } satisfies PendingJoin);
});

// 4. 초대 코드가 있으면 확인하고 계정을 만든다
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
  if (attempts === null) return errorJson(429, 'too_many_attempts', '코드를 너무 많이 틀렸어요. 로그인부터 다시 해 주세요.');

  // 그사이 같은 계정으로 가입을 마쳤으면 그 계정으로 로그인한다
  const existing = await c.env.DB.prepare('SELECT user_id FROM user_identities WHERE provider = ?1 AND subject = ?2')
    .bind(pending.provider, pending.subject)
    .first<string>('user_id');
  if (existing) return finishJoin(c, pending.token_hash, existing, now);

  // 초대 코드를 비우면 초대 없이 가입한다. 적었는데 틀리면 초대 없는 가입으로 넘기지 않고 알린다
  if (!body.code) return openJoin(c, pending, body.display_name, now);
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
      "INSERT INTO users (id, display_name, role, created_at, terms_version, terms_accepted_at) SELECT ?1, ?2, 'member', ?3, ?5, ?3 WHERE EXISTS (SELECT 1 FROM invites WHERE id = ?4 AND used_at IS NULL)",
    ).bind(userId, body.display_name, now, invite, TERMS_VERSION),
    c.env.DB.prepare(
      'INSERT INTO user_identities (provider, subject, user_id, login, created_at) SELECT ?5, ?2, ?1, ?3, ?4 WHERE EXISTS (SELECT 1 FROM users WHERE id = ?1)',
    ).bind(userId, pending.subject, pending.login, now, pending.provider),
    c.env.DB.prepare('UPDATE invites SET used_at = ?3, used_by = ?1 WHERE id = ?2 AND used_at IS NULL AND EXISTS (SELECT 1 FROM users WHERE id = ?1)').bind(
      userId,
      invite,
      now,
    ),
  ]);
  if (created!.meta.changes === 0) return errorJson(403, 'wrong_code', '방금 다른 사람이 이 초대 코드를 썼어요.');
  console.log(JSON.stringify({ event: 'user_joined', user_id: userId }));
  return finishJoin(c, pending.token_hash, userId, now, 201);
});

/**
 * 초대 코드 없이 가입 (2026-10-22): 월간 크레딧 없이(0, 자동 충전 없음) 만든다. 크레딧은 숨은 업적과 운영자 지급으로만 받는다.
 * 막 만든 GitHub 계정은 받지 않고, GitHub·Google을 합쳐 최근 24시간에 OPEN_JOINS_PER_DAY명까지만 받는다 (세기와 넣기를 한 문장으로)
 */
async function openJoin(c: Context<AppEnv>, pending: PendingRow, displayName: string, now: number): Promise<Response> {
  if (pending.provider === 'github' && (pending.account_created_at === null || now - pending.account_created_at < OPEN_MIN_ACCOUNT_AGE_MS)) {
    return errorJson(403, 'account_too_new', '만든 지 30일이 안 된 GitHub 계정은 초대 코드가 있어야 가입할 수 있어요.');
  }
  const userId = crypto.randomUUID();
  const [created] = await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO users (id, display_name, role, created_at, terms_version, terms_accepted_at, monthly_credits)
       SELECT ?1, ?2, 'member', ?3, ?4, ?3, 0 WHERE (SELECT count(*) FROM users WHERE monthly_credits = 0 AND created_at > ?5) < ?6`,
    ).bind(userId, displayName, now, TERMS_VERSION, now - DAY_MS, OPEN_JOINS_PER_DAY),
    c.env.DB.prepare(
      'INSERT INTO user_identities (provider, subject, user_id, login, created_at) SELECT ?5, ?2, ?1, ?3, ?4 WHERE EXISTS (SELECT 1 FROM users WHERE id = ?1)',
    ).bind(userId, pending.subject, pending.login, now, pending.provider),
  ]);
  if (created!.meta.changes === 0) return errorJson(429, 'join_full', '오늘은 초대 없이 가입할 수 있는 자리가 다 찼어요. 내일 다시 해 주세요.');
  console.log(JSON.stringify({ event: 'user_joined', user_id: userId, invite: false, provider: pending.provider }));
  return finishJoin(c, pending.token_hash, userId, now, 201);
}

/**
 * 기기 복구 초대 (설계서 §8.5): 새 계정 대신 기존 계정에 이 GitHub(또는 Google)를 잇고 로그인한다. 같은 종류의 예전 계정 연결만 바꾼다.
 * 잃어버린 기기가 다른 사람 손에 있을 수 있으니 그 계정의 다른 로그인, 커넥터 URL, 푸시 구독을 모두 끊는다.
 */
async function recoverAccount(c: Context<AppEnv>, pending: PendingRow, invite: string, userId: string, now: number): Promise<Response> {
  // 초대를 이 요청이 차지했을 때만 나머지를 쓴다 (used_at·used_by가 이 요청 값이면 차지한 것)
  const claimed = 'EXISTS (SELECT 1 FROM invites WHERE id = ?1 AND used_by = ?2 AND used_at = ?3)';
  const claimedFor = { sql: 'EXISTS (SELECT 1 FROM invites WHERE id = ?2 AND used_by = ?1 AND used_at = ?3)', values: [invite, now] };
  let claim: D1Result | undefined;
  try {
    [claim] = await c.env.DB.batch([
    c.env.DB.prepare('UPDATE invites SET used_at = ?3, used_by = ?2 WHERE id = ?1 AND used_at IS NULL AND EXISTS (SELECT 1 FROM users WHERE id = ?2)').bind(invite, userId, now),
    c.env.DB.prepare(`DELETE FROM user_identities WHERE user_id = ?2 AND provider = ?4 AND ${claimed}`).bind(invite, userId, now, pending.provider),
    c.env.DB.prepare(`INSERT INTO user_identities (provider, subject, user_id, login, created_at) SELECT ?6, ?4, ?2, ?5, ?3 WHERE ${claimed}`).bind(
      invite,
      userId,
      now,
      pending.subject,
      pending.login,
      pending.provider,
    ),
    // 잃어버린 기기에 남은 접근을 모두 끊는다: 로그인, 로그인 코드, 커넥터 URL, 푸시 구독
    ...revokeAccessStatements(c.env, userId, claimedFor),
    ]);
  } catch {
    // 그사이 이 계정이 다른 모아이 계정에 이어졌다. batch 전체가 되돌아갔다
    return errorJson(409, 'github_taken', `이 ${PROVIDER_NAME[pending.provider]} 계정은 이미 다른 모아이 계정에 이어져 있어요.`);
  }
  if (claim!.meta.changes === 0) return errorJson(403, 'wrong_code', '방금 이 초대 코드를 누가 썼어요.');
  await revokeAllGrants(c.env, userId);
  console.log(JSON.stringify({ event: 'account_recovered', user_id: userId }));
  return finishJoin(c, pending.token_hash, userId, now);
}

/** 가입을 마친다: 기다리던 가입을 지우고 로그인한 뒤 내 정보를 돌려준다 */
async function finishJoin(c: Context<AppEnv>, pendingHash: string, userId: string, now: number, status: 200 | 201 = 200): Promise<Response> {
  await c.env.DB.prepare('DELETE FROM pending_signups WHERE token_hash = ?1').bind(pendingHash).run();
  dropCookie(c, JOIN_COOKIE);
  await startSession(c, userId, now);
  return c.json(await loadMe(c.env, userId), status);
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
