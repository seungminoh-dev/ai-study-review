import { TERMS_VERSION, type AiStatus, type InviteSummary, type LoginCode, type Me, type PendingJoin } from '@moai/shared';
import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { spendCredits } from '../src/domain/credits';
import { formatCode, normalizeCode } from '../src/lib/codes';
import { ORIGIN, api, newUser, workerFetch, type TestUser } from './helpers';

// GitHub·Google 로그인, 초대 코드 가입, 다른 기기 로그인 코드 (설계서 §8.4, §8.5). GitHub와 Google은 fetch를 바꿔 흉내 낸다.

interface FakeGithubUser {
  id: number;
  login: string;
  name: string | null;
  created_at: string;
}

const githubUser = (login = 'octo', createdAt = '2020-01-01T00:00:00Z'): FakeGithubUser => ({ id: Math.floor(Math.random() * 1e9), login, name: '옥토캣', created_at: createdAt });

function mockGithub(user: FakeGithubUser, token: unknown = { access_token: 'gho_test', token_type: 'bearer', scope: '' }) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url === 'https://github.com/login/oauth/access_token') return Response.json(token);
    if (url === 'https://api.github.com/user') return Response.json(user);
    throw new Error(`unexpected fetch ${url}`);
  });
}

/** 응답의 Set-Cookie에서 이름=값만 꺼낸다 */
function cookieOf(response: Response, name: string): string | null {
  const line = response.headers.getSetCookie().find((cookie) => cookie.startsWith(`${name}=`));
  const pair = line?.split(';')[0];
  return pair && pair !== `${name}=` ? pair : null;
}

const jar = (...cookies: (string | null | undefined)[]) => cookies.filter(Boolean).join('; ');

/** GitHub로 보냈다가 돌아오기까지. 돌아온 응답(리다이렉트)을 준다 */
async function viaGithub(user: FakeGithubUser, options: { intent?: 'login' | 'link'; cookie?: string; next?: string } = {}): Promise<Response> {
  const query = new URLSearchParams({ intent: options.intent ?? 'login', ...(options.next ? { next: options.next } : {}) });
  const start = await workerFetch(`${ORIGIN}/api/auth/github/start?${query}`, {
    headers: options.cookie ? { cookie: options.cookie } : {},
  });
  const state = new URL(start.headers.get('location')!).searchParams.get('state')!;
  mockGithub(user);
  return workerFetch(`${ORIGIN}/api/auth/github/callback?code=gh-code&state=${state}`, {
    headers: { cookie: jar(options.cookie, cookieOf(start, '__Host-moai-oauth'), cookieOf(start, '__Host-moai-next')) },
  });
}

/** Google로 보냈다가 돌아오기까지. ID 토큰의 값은 claims로 바꿔 볼 수 있다 */
async function viaGoogle(sub: string, options: { intent?: 'login' | 'link'; cookie?: string; claims?: Record<string, unknown> } = {}): Promise<Response> {
  const start = await workerFetch(`${ORIGIN}/api/auth/google/start?${new URLSearchParams({ intent: options.intent ?? 'login' })}`, {
    headers: options.cookie ? { cookie: options.cookie } : {},
  });
  const location = new URL(start.headers.get('location')!);
  const claims = {
    iss: 'https://accounts.google.com',
    aud: 'test-google-client',
    exp: Math.floor(Date.now() / 1000) + 3600,
    nonce: location.searchParams.get('nonce'),
    sub,
    ...options.claims,
  };
  const payload = btoa(JSON.stringify(claims)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url === 'https://oauth2.googleapis.com/token') return Response.json({ id_token: `e30.${payload}.sig`, access_token: 'ya29.test' });
    throw new Error(`unexpected fetch ${url}`);
  });
  return workerFetch(`${ORIGIN}/api/auth/google/callback?code=g-code&state=${location.searchParams.get('state')}`, {
    headers: { cookie: jar(options.cookie, cookieOf(start, '__Host-moai-oauth')) },
  });
}

const asUser = (cookie: string): TestUser => ({ id: '', cookie });

async function newInvite(owner: TestUser, label = '민수'): Promise<{ invite: InviteSummary; code: string }> {
  const response = await api(owner, '/invites', { method: 'POST', json: { label } });
  expect(response.status).toBe(201);
  return response.json();
}

let owner: TestUser;

beforeEach(async () => {
  owner = await newUser('오너', 'owner');
});
afterEach(() => vi.restoreAllMocks());

describe('codes', () => {
  it('reads look-alike letters and separators as the same code', () => {
    expect(normalizeCode('k7qm-4xpt', 8)).toBe('K7QM4XPT');
    expect(normalizeCode('ab1o lI0x', 8)).toBe('AB10110X');
    expect(normalizeCode('K7QM4XP', 8)).toBeNull();
    expect(normalizeCode('K7QM4XPU', 8)).toBeNull();
    expect(formatCode('K7QM4XPT')).toBe('K7QM-4XPT');
    expect(formatCode('K7QM4XPTA9')).toBe('K7QM4-XPTA9');
  });
});

describe('GitHub login', () => {
  it('tells the login screen that GitHub is set up', async () => {
    expect(await (await api(null, '/auth/options')).json()).toMatchObject({ github: true, google: true });
  });

  it('sends the browser to GitHub with a state cookie and a PKCE challenge', async () => {
    const response = await workerFetch(`${ORIGIN}/api/auth/github/start`);
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get('location')!);
    expect(location.origin + location.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(location.searchParams.get('client_id')).toBe('test-github-client');
    expect(location.searchParams.get('redirect_uri')).toBe(`${ORIGIN}/api/auth/github/callback`);
    expect(location.searchParams.get('code_challenge_method')).toBe('S256');
    expect(location.searchParams.get('scope')).toBeNull();
    const cookie = response.headers.getSetCookie()[0]!;
    expect(cookie).toMatch(/^__Host-moai-oauth=github\.login\.[\w-]{43}\.[\w-]{43};/);
    expect(cookie).toContain('Max-Age=600');
    expect(cookie).toContain('HttpOnly');
    // state 쿠키에 있는 값이 그대로 GitHub로 가지는 않는다 (verifier는 challenge로만)
    expect(cookie).toContain(`.${location.searchParams.get('state')}.`);
  });

  it('refuses a callback whose state does not match this browser', async () => {
    const fetch = mockGithub(githubUser());
    const forged = await workerFetch(`${ORIGIN}/api/auth/github/callback?code=x&state=forged`, { headers: { cookie: '__Host-moai-oauth=github.login.real.verifier' } });
    expect(forged.headers.get('location')).toBe('/?auth=expired');
    const noCookie = await workerFetch(`${ORIGIN}/api/auth/github/callback?code=x&state=real`);
    expect(noCookie.headers.get('location')).toBe('/?auth=expired');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('goes back to the login screen when the user cancels on GitHub', async () => {
    const response = await workerFetch(`${ORIGIN}/api/auth/github/callback?error=access_denied&state=x`, { headers: { cookie: '__Host-moai-oauth=login.x.y' } });
    expect(response.headers.get('location')).toBe('/?auth=denied');
  });

  it('exchanges the code with the PKCE verifier and never stores the GitHub token', async () => {
    const start = await workerFetch(`${ORIGIN}/api/auth/github/start`);
    const location = new URL(start.headers.get('location')!);
    const fetch = mockGithub(githubUser());
    await workerFetch(`${ORIGIN}/api/auth/github/callback?code=gh-code&state=${location.searchParams.get('state')}`, {
      headers: { cookie: cookieOf(start, '__Host-moai-oauth')! },
    });
    const body = new URLSearchParams(String((fetch.mock.calls[0]![1] as RequestInit).body));
    expect(body.get('code')).toBe('gh-code');
    expect(body.get('client_secret')).toBe('test-github-secret');
    // verifier를 해시하면 처음에 보낸 challenge가 된다
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body.get('code_verifier')!));
    const challenge = btoa(String.fromCharCode(...new Uint8Array(digest))).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
    expect(challenge).toBe(location.searchParams.get('code_challenge'));
    const { results } = await env.DB.prepare('SELECT * FROM pending_signups').all();
    expect(JSON.stringify(results)).not.toContain('gho_test');
  });

  it('reports a failed token exchange', async () => {
    const start = await workerFetch(`${ORIGIN}/api/auth/github/start`);
    const state = new URL(start.headers.get('location')!).searchParams.get('state')!;
    mockGithub(githubUser(), { error: 'bad_verification_code' });
    const response = await workerFetch(`${ORIGIN}/api/auth/github/callback?code=x&state=${state}`, { headers: { cookie: cookieOf(start, '__Host-moai-oauth')! } });
    expect(response.headers.get('location')).toBe('/?auth=failed');
  });

  it('logs a linked GitHub account straight in and keeps its new login name', async () => {
    const github = githubUser('old-name');
    const me = await newUser('기존');
    expect((await viaGithub(github, { intent: 'link', cookie: me.cookie })).headers.get('location')).toBe('/settings?github=linked');
    expect(((await (await api(me, '/me')).json()) as Me).github_login).toBe('old-name');

    // 다른 기기(PC)에서 GitHub로 로그인한다. 그사이 GitHub 아이디를 바꿨다
    const response = await viaGithub({ ...github, login: 'new-name' });
    expect(response.headers.get('location')).toBe('/');
    const session = cookieOf(response, '__Host-sid')!;
    expect(session).toMatch(/^__Host-sid=[\w-]{43}$/);
    expect(await (await api(asUser(session), '/me')).json()).toMatchObject({ display_name: '기존', github_login: 'new-name' });
  });

  it('does not link a GitHub account that belongs to someone else', async () => {
    const github = githubUser();
    const first = await newUser('첫째');
    const second = await newUser('둘째');
    await viaGithub(github, { intent: 'link', cookie: first.cookie });
    expect((await viaGithub(github, { intent: 'link', cookie: second.cookie })).headers.get('location')).toBe('/settings?github=taken');
    expect(((await (await api(second, '/me')).json()) as Me).github_login).toBeNull();
  });

  it('needs a login to link', async () => {
    expect((await viaGithub(githubUser(), { intent: 'link' })).headers.get('location')).toBe('/?auth=expired');
  });
});

// Google 로그인 (2026-10-22): openid만 받아 sub로 찾는다. 초대 없이 가입할 때 계정 나이는 보지 않고 하루 한도만 쓴다
describe('Google login', () => {
  it('asks Google for openid only, with PKCE and a nonce tied to this browser', async () => {
    const response = await workerFetch(`${ORIGIN}/api/auth/google/start`);
    const location = new URL(response.headers.get('location')!);
    expect(location.origin + location.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(location.searchParams.get('client_id')).toBe('test-google-client');
    expect(location.searchParams.get('redirect_uri')).toBe(`${ORIGIN}/api/auth/google/callback`);
    expect(location.searchParams.get('scope')).toBe('openid');
    expect(location.searchParams.get('code_challenge_method')).toBe('S256');
    expect(location.searchParams.get('nonce')).toBe(location.searchParams.get('state'));
    expect(response.headers.getSetCookie()[0]).toMatch(/^__Host-moai-oauth=google\.login\./);
  });

  it('joins without an invite, then logs the same Google account straight in', async () => {
    const sub = String(Math.floor(Math.random() * 1e15));
    const arrived = await viaGoogle(sub);
    expect(arrived.headers.get('location')).toBe('/join');
    const join = asUser(cookieOf(arrived, '__Host-moai-join')!);
    expect(await (await api(join, '/auth/join')).json()).toEqual({ provider: 'google', github_login: null, suggested_name: '' } satisfies PendingJoin);
    const joined = await api(join, '/auth/join', { method: 'POST', json: { agree: true, display_name: '구글' } });
    expect(joined.status).toBe(201);
    expect(await joined.json()).toMatchObject({ display_name: '구글', github_login: null, google_linked: true });
    const session = asUser(cookieOf(joined, '__Host-sid')!);
    expect(((await (await api(session, '/ai/status')).json()) as AiStatus).credits).toMatchObject({ monthly_total: 0 });

    const again = await viaGoogle(sub);
    expect(again.headers.get('location')).toBe('/');
    expect(await (await api(asUser(cookieOf(again, '__Host-sid')!), '/me')).json()).toMatchObject({ display_name: '구글' });
  });

  it('refuses an ID token for another app, another login, another issuer or one that ran out', async () => {
    for (const claims of [{ aud: 'someone-else' }, { nonce: 'replayed' }, { iss: 'https://evil.example' }, { exp: Math.floor(Date.now() / 1000) - 60 }]) {
      const sub = String(Math.floor(Math.random() * 1e15));
      expect([claims, (await viaGoogle(sub, { claims })).headers.get('location')]).toEqual([claims, '/?auth=failed']);
      expect(await env.DB.prepare('SELECT count(*) AS n FROM pending_signups WHERE subject = ?1').bind(sub).first<number>('n')).toBe(0);
    }
  });

  it('does not take a GitHub login state at the Google callback', async () => {
    const start = await workerFetch(`${ORIGIN}/api/auth/github/start`);
    const state = new URL(start.headers.get('location')!).searchParams.get('state')!;
    const fetch = vi.spyOn(globalThis, 'fetch');
    const response = await workerFetch(`${ORIGIN}/api/auth/google/callback?code=x&state=${state}`, { headers: { cookie: cookieOf(start, '__Host-moai-oauth')! } });
    expect(response.headers.get('location')).toBe('/?auth=expired');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('links Google to a signed-in account once', async () => {
    const sub = String(Math.floor(Math.random() * 1e15));
    const first = await newUser('첫째');
    const second = await newUser('둘째');
    expect((await viaGoogle(sub, { intent: 'link', cookie: first.cookie })).headers.get('location')).toBe('/settings?google=linked');
    expect(await (await api(first, '/me')).json()).toMatchObject({ google_linked: true });
    expect((await viaGoogle(sub, { intent: 'link', cookie: second.cookie })).headers.get('location')).toBe('/settings?google=taken');
    expect(await (await api(second, '/me')).json()).toMatchObject({ google_linked: false });
  });
});

describe('joining with an invite', () => {
  async function arriveAtJoin(github = githubUser('newbie')): Promise<string> {
    const response = await viaGithub(github);
    expect(response.headers.get('location')).toBe('/join');
    expect(cookieOf(response, '__Host-sid')).toBeNull();
    return cookieOf(response, '__Host-moai-join')!;
  }

  it('sends a new account that came from the Claude connector back to it after joining', async () => {
    const next = '/authorize?response_type=code&client_id=abc';
    const response = await viaGithub(githubUser('connector-newbie'), { next });
    expect(response.headers.get('location')).toBe(`/join?${new URLSearchParams({ next })}`);
    // 남의 사이트로는 보내지 않는다
    const outside = await viaGithub(githubUser('outside-newbie'), { next: 'https://evil.example/' });
    expect(outside.headers.get('location')).toBe('/join');
  });

  it('asks a new GitHub account for an invite code, then creates the account once', async () => {
    const join = await arriveAtJoin();
    expect(await (await api(asUser(join), '/auth/join')).json()).toEqual({ provider: 'github', github_login: 'newbie', suggested_name: '옥토캣' } satisfies PendingJoin);

    const wrong = await api(asUser(join), '/auth/join', { method: 'POST', json: { agree: true, code: 'AAAAA-AAAAA', display_name: '민수' } });
    expect(wrong.status).toBe(403);
    expect(((await wrong.json()) as { error: { message: string } }).error.message).toContain('남은 시도 4번');

    const { code } = await newInvite(owner);
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/);
    // 만 14세 이상·약관 동의 없이는 가입하지 않는다 (틀린 횟수에도 넣지 않는다)
    expect((await api(asUser(join), '/auth/join', { method: 'POST', json: { code, display_name: '민수' } })).status).toBe(400);
    const joined = await api(asUser(join), '/auth/join', { method: 'POST', json: { agree: true, code: code.toLowerCase().replace('-', ' '), display_name: ' 민수 ' } });
    expect(joined.status).toBe(201);
    // 가입할 때 지금 약관을 확인한 것으로 적는다
    expect(await joined.json()).toMatchObject({ display_name: '민수', role: 'member', github_login: 'newbie', terms_version: TERMS_VERSION });
    const session = cookieOf(joined, '__Host-sid')!;
    expect(((await (await api(asUser(session), '/me')).json()) as Me).display_name).toBe('민수');
    // 가입 쿠키는 지운다
    expect(joined.headers.getSetCookie().some((cookie) => cookie.startsWith('__Host-moai-join=;'))).toBe(true);

    const { invites } = (await (await api(owner, '/invites')).json()) as { invites: InviteSummary[] };
    expect(invites[0]).toMatchObject({ label: '민수', used_by_name: '민수' });

    // 같은 코드는 한 번만 쓴다
    const another = await arriveAtJoin(githubUser('late'));
    expect((await api(asUser(another), '/auth/join', { method: 'POST', json: { agree: true, code, display_name: '늦은' } })).status).toBe(403);
  });

  it('does not take an expired invite', async () => {
    const join = await arriveAtJoin();
    const { invite, code } = await newInvite(owner);
    await env.DB.prepare('UPDATE invites SET expires_at = 1 WHERE id = ?1').bind(invite.id).run();
    expect((await api(asUser(join), '/auth/join', { method: 'POST', json: { agree: true, code, display_name: '민수' } })).status).toBe(403);
  });

  it('stops after five wrong codes', async () => {
    const join = await arriveAtJoin();
    for (let i = 0; i < 5; i += 1) {
      expect((await api(asUser(join), '/auth/join', { method: 'POST', json: { agree: true, code: 'AAAAAAAAAA', display_name: '민수' } })).status).toBe(403);
    }
    const { code } = await newInvite(owner);
    expect((await api(asUser(join), '/auth/join', { method: 'POST', json: { agree: true, code, display_name: '민수' } })).status).toBe(429);
  });

  it('needs a GitHub check first', async () => {
    expect((await api(null, '/auth/join')).status).toBe(410);
    const { code } = await newInvite(owner);
    expect((await api(null, '/auth/join', { method: 'POST', json: { agree: true, code, display_name: '민수' } })).status).toBe(410);
  });
});

// 초대 없이 가입 (2026-10-22): 월간 크레딧 0, 막 만든 GitHub 계정과 하루에 몰리는 가입은 받지 않는다
describe('joining without an invite', () => {
  const arrive = async (github: FakeGithubUser) => cookieOf(await viaGithub(github), '__Host-moai-join')!;
  const joinError = async (response: Response) => [response.status, ((await response.json()) as { error: { code: string } }).error.code];

  it('creates an account with no monthly credits, and a wrong code is not taken as joining without one', async () => {
    const join = await arrive(githubUser('open'));
    expect(await joinError(await api(asUser(join), '/auth/join', { method: 'POST', json: { agree: true, code: 'AAAAA-AAAAA', display_name: '열린' } }))).toEqual([403, 'wrong_code']);
    const joined = await api(asUser(join), '/auth/join', { method: 'POST', json: { agree: true, display_name: '열린' } });
    expect(joined.status).toBe(201);
    const me = (await joined.json()) as Me;
    const session = asUser(cookieOf(joined, '__Host-sid')!);
    expect(((await (await api(session, '/ai/status')).json()) as AiStatus).credits).toMatchObject({ monthly: 0, monthly_total: 0, held: 0 });
    expect(await spendCredits(env, me.id, 'ask', 1, crypto.randomUUID(), Date.now())).toBe(false);
    // 숨은 업적 같은 보유 크레딧은 쓸 수 있다
    await env.DB.prepare("INSERT INTO credit_ledger (id, user_id, amount, kind, ref, note, created_at) VALUES (?1, ?2, 30, 'achievement', NULL, NULL, ?3)")
      .bind(crypto.randomUUID(), me.id, Date.now())
      .run();
    expect(await spendCredits(env, me.id, 'ask', 1, crypto.randomUUID(), Date.now())).toBe(true);
    expect(((await (await api(session, '/ai/status')).json()) as AiStatus).credits).toMatchObject({ monthly: 0, held: 29 });
  });

  it('refuses a GitHub account made less than 30 days ago', async () => {
    const join = await arrive(githubUser('fresh', new Date(Date.now() - 3 * 86_400_000).toISOString()));
    expect(await joinError(await api(asUser(join), '/auth/join', { method: 'POST', json: { agree: true, display_name: '새' } }))).toEqual([403, 'account_too_new']);
  });

  it('takes at most 30 accounts a day', async () => {
    const ids = Array.from({ length: 30 }, () => crypto.randomUUID());
    await env.DB.batch(
      ids.map((id) => env.DB.prepare("INSERT INTO users (id, display_name, role, created_at, monthly_credits) VALUES (?1, '먼저', 'member', ?2, 0)").bind(id, Date.now())),
    );
    const join = await arrive(githubUser('crowd'));
    expect(await joinError(await api(asUser(join), '/auth/join', { method: 'POST', json: { agree: true, display_name: '늦은' } }))).toEqual([429, 'join_full']);
    await env.DB.prepare('DELETE FROM users WHERE id IN (SELECT value FROM json_each(?1))').bind(JSON.stringify(ids)).run();
  });
});

describe('recovery invites', () => {
  it('log a new GitHub into the bound member, replace the old GitHub and end the lost devices', async () => {
    const member = await newUser('민수');
    await viaGithub(githubUser('lost-account'), { intent: 'link', cookie: member.cookie });
    expect((await api(owner, '/invites', { method: 'POST', json: { label: '민수 복구', bind_user_id: owner.id } })).status).toBe(404);
    const { members } = (await (await api(owner, '/members')).json()) as { members: { id: string }[] };
    expect(members.map((item) => item.id)).toContain(member.id);
    const { code } = (await (await api(owner, '/invites', { method: 'POST', json: { label: '민수 복구', bind_user_id: member.id } })).json()) as { code: string };

    const response = await viaGithub(githubUser('new-account'));
    const join = cookieOf(response, '__Host-moai-join')!;
    const joined = await api(asUser(join), '/auth/join', { method: 'POST', json: { agree: true, code, display_name: '무시되는 이름' } });
    expect(await joined.json()).toMatchObject({ id: member.id, display_name: '민수', github_login: 'new-account' });
    expect((await api(member, '/me')).status).toBe(401);
    expect((await api(asUser(cookieOf(joined, '__Host-sid')!), '/me')).status).toBe(200);
  });

  it('are for the owner only', async () => {
    const member = await newUser();
    expect((await api(member, '/members')).status).toBe(403);
    expect((await api(member, '/admin/metrics')).status).toBe(403);
    expect((await api(member, '/admin/usage')).status).toBe(403);
    expect(await (await api(owner, '/admin/metrics')).json()).toMatchObject({ users: expect.any(Number), weekly_reviewers: expect.any(Number) });
  });
});

describe('invites', () => {
  it('are for the owner only', async () => {
    const member = await newUser();
    expect((await api(member, '/invites')).status).toBe(403);
    expect((await api(member, '/invites', { method: 'POST', json: { label: '친구' } })).status).toBe(403);
  });

  it('can be deleted until someone uses them', async () => {
    const { invite } = await newInvite(owner, '지울 초대');
    expect((await api(owner, `/invites/${invite.id}`, { method: 'DELETE' })).status).toBe(204);
    expect((await api(owner, `/invites/${invite.id}`, { method: 'DELETE' })).status).toBe(404);
    const { invites } = (await (await api(owner, '/invites')).json()) as { invites: InviteSummary[] };
    expect(invites.map((item) => item.id)).not.toContain(invite.id);
  });

  it('keeps only the hash of the code', async () => {
    const { invite, code } = await newInvite(owner);
    const stored = await env.DB.prepare('SELECT code_hash FROM invites WHERE id = ?1').bind(invite.id).first<string>('code_hash');
    expect(stored).not.toContain(code.replace('-', ''));
  });
});

describe('login codes for another device', () => {
  it('logs a new device in once', async () => {
    const me = await newUser('나');
    const response = await api(me, '/login-codes', { method: 'POST' });
    const { code, expires_at } = (await response.json()) as LoginCode;
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
    expect(expires_at - Date.now()).toBeGreaterThan(9 * 60_000);

    const login = await api(null, '/auth/login', { method: 'POST', json: { code: code.toLowerCase() } });
    expect(login.status).toBe(200);
    expect(await login.json()).toMatchObject({ display_name: '나' });
    const session = cookieOf(login, '__Host-sid')!;
    expect(((await (await api(asUser(session), '/me')).json()) as Me).display_name).toBe('나');

    expect((await api(null, '/auth/login', { method: 'POST', json: { code } })).status).toBe(403);
  });

  it('forgets the previous code when a new one is made, and refuses an old one', async () => {
    const me = await newUser();
    const first = ((await (await api(me, '/login-codes', { method: 'POST' })).json()) as LoginCode).code;
    const second = ((await (await api(me, '/login-codes', { method: 'POST' })).json()) as LoginCode).code;
    expect((await api(null, '/auth/login', { method: 'POST', json: { code: first } })).status).toBe(403);
    await env.DB.prepare('UPDATE login_codes SET expires_at = 1 WHERE user_id = ?1').bind(me.id).run();
    expect((await api(null, '/auth/login', { method: 'POST', json: { code: second } })).status).toBe(403);
  });

  it('needs our Origin', async () => {
    const response = await workerFetch(`${ORIGIN}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: 'AAAA-AAAA' }),
    });
    expect(response.status).toBe(403);
  });
});

describe('logout', () => {
  it('ends only this device', async () => {
    const phone = await newUser();
    const code = ((await (await api(phone, '/login-codes', { method: 'POST' })).json()) as LoginCode).code;
    const pc = asUser(cookieOf(await api(null, '/auth/login', { method: 'POST', json: { code } }), '__Host-sid')!);

    const response = await api(pc, '/auth/logout', { method: 'POST' });
    expect(response.status).toBe(204);
    expect(response.headers.getSetCookie()[0]).toMatch(/^__Host-sid=;/);
    expect((await api(pc, '/me')).status).toBe(401);
    expect((await api(phone, '/me')).status).toBe(200);
  });
});

describe('request size', () => {
  it('refuses a huge body before reading it, even where no login is needed', async () => {
    const response = await workerFetch(`${ORIGIN}/api/auth/login`, {
      method: 'POST',
      headers: { origin: ORIGIN, 'content-type': 'application/json' },
      body: JSON.stringify({ code: 'x'.repeat(300 * 1024) }),
    });
    expect(response.status).toBe(413);
  });
});
