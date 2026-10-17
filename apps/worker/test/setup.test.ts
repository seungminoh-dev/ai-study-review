import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { hashToken, randomToken } from '../src/lib/crypto';
import { BOOTSTRAP_CODE, ORIGIN, api, newUser, workerFetch } from './helpers';

// 오너는 한 번만 생기므로 이 파일의 테스트는 순서대로 이어진다.
describe('owner setup', () => {
  it('is open before the owner exists', async () => {
    expect(await (await api(null, '/setup')).json()).toEqual({ available: true });
  });

  it('rejects a wrong code', async () => {
    const response = await api(null, '/setup', { method: 'POST', json: { code: 'nope', display_name: '나' } });
    expect(response.status).toBe(403);
  });

  it('rejects a request without our Origin', async () => {
    const response = await workerFetch(`${ORIGIN}/api/setup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: BOOTSTRAP_CODE, display_name: '나' }),
    });
    expect(response.status).toBe(403);
  });

  it('creates the owner once and logs in with a host-only cookie', async () => {
    const response = await api(null, '/setup', { method: 'POST', json: { code: BOOTSTRAP_CODE, display_name: '  승민 ' } });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ display_name: '승민', role: 'owner' });
    const cookie = response.headers.get('set-cookie')!;
    expect(cookie).toMatch(/^__Host-sid=[\w-]{43};/);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Path=/');

    const me = await api({ id: '', cookie: cookie.split(';')[0]! }, '/me');
    expect(await me.json()).toMatchObject({ display_name: '승민', role: 'owner', daily_new_limit: 10 });

    const again = await api(null, '/setup', { method: 'POST', json: { code: BOOTSTRAP_CODE, display_name: '또' } });
    expect(again.status).toBe(410);
    expect(await (await api(null, '/setup')).json()).toEqual({ available: false });
  });
});

describe('sessions', () => {
  it('requires a login for the rest of the API', async () => {
    expect((await api(null, '/me')).status).toBe(401);
    expect((await api({ id: '', cookie: '__Host-sid=unknown' }, '/today')).status).toBe(401);
  });

  it('rejects an expired session', async () => {
    const user = await newUser();
    const token = randomToken();
    await env.DB.prepare('INSERT INTO auth_sessions (token_hash, user_id, created_at, last_seen_at, expires_at) VALUES (?1, ?2, 0, 0, 1)')
      .bind(await hashToken(env.TOKEN_PEPPER, token), user.id)
      .run();
    expect((await api({ id: user.id, cookie: `__Host-sid=${token}` }, '/me')).status).toBe(401);
  });

  it('extends a session that has not been seen for a day', async () => {
    const user = await newUser();
    const token = user.cookie.split('=')[1]!;
    const hash = await hashToken(env.TOKEN_PEPPER, token);
    await env.DB.prepare('UPDATE auth_sessions SET last_seen_at = ?2 WHERE token_hash = ?1').bind(hash, Date.now() - 2 * 86_400_000).run();
    const response = await api(user, '/me');
    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toMatch(/^__Host-sid=/);
  });
});
