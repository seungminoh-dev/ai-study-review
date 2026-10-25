import { describe, expect, it } from 'vitest';
import { app } from '../src/app';
import { api, newUser } from './helpers';

// 관리 API(/api/admin/*)는 app.ts 한 곳에서 오너만 통과시키고 no-store를 붙인다.
// 경로를 손으로 적지 않고 앱에 등록된 라우트에서 모아서, 어느 라우터에 관리 API를 더해도 이 검사에 들어간다.

const SOME_ID = '00000000-0000-4000-8000-000000000000';
const ADMIN_ROUTES = app.routes
  .filter((route) => route.method !== 'ALL' && route.path.startsWith('/api/admin/'))
  .map((route) => ({ method: route.method, path: route.path.slice('/api'.length).replace(/:\w+/g, SOME_ID) }));

const errorCode = async (response: Response) => ((await response.json()) as { error: { code: string } }).error.code;

describe('admin API', () => {
  it('finds every admin route', () => {
    expect(ADMIN_ROUTES.map((route) => `${route.method} ${route.path}`)).toEqual(
      expect.arrayContaining([
        'GET /admin/invites',
        'POST /admin/invites',
        `DELETE /admin/invites/${SOME_ID}`,
        'GET /admin/members',
        `POST /admin/members/${SOME_ID}/disable`,
        `POST /admin/members/${SOME_ID}/enable`,
        'GET /admin/usage',
        'GET /admin/credits',
        'POST /admin/credits',
        'GET /admin/metrics',
      ]),
    );
  });

  it('lets only the owner through, and is never cached', async () => {
    const owner = await newUser('오너', 'owner');
    const member = await newUser();
    for (const { method, path } of ADMIN_ROUTES) {
      const where = `${method} ${path}`;
      expect((await api(null, path, { method })).status, where).toBe(401);

      const asMember = await api(member, path, { method });
      expect(asMember.status, where).toBe(403);
      expect(await errorCode(asMember), where).toBe('owner_only');
      expect(asMember.headers.get('cache-control'), where).toBe('no-store');

      // 오너는 검사를 지나 라우트에 닿는다 (본문이 없거나 없는 id라 400·404일 수 있다)
      const asOwner = await api(owner, path, { method });
      expect([401, 403], where).not.toContain(asOwner.status);
      expect(asOwner.headers.get('cache-control'), where).toBe('no-store');
    }
  });

  it('does not let another spelling of the path skip the check', async () => {
    const owner = await newUser('오너', 'owner');
    const member = await newUser();
    const spellings = [
      '/admin/usage/',
      '/ADMIN/usage',
      '/admin/USAGE',
      '/%61dmin/usage',
      '/admin/%75sage',
      '/admin%2Fusage',
      '//admin/usage',
      '/admin//usage',
      '/./admin/usage',
      '/auth/../admin/usage',
      '/auth/%2e%2e/admin/usage',
      '/auth/..%2Fadmin/usage',
    ];
    for (const path of spellings) {
      const [anonymous, asMember, asOwner] = await Promise.all([api(null, path), api(member, path), api(owner, path)]);
      expect(anonymous.status, path).not.toBe(200);
      expect(asMember.status, path).not.toBe(200);
      // 오너가 라우트에 닿는 표기라면 회원은 반드시 오너 검사에 막힌다
      if (asOwner.status === 200) expect(asMember.status, path).toBe(403);
    }
  });

  it('no longer answers at the old paths', async () => {
    const owner = await newUser('오너', 'owner');
    expect((await api(owner, '/invites')).status).toBe(404);
    expect((await api(owner, '/members')).status).toBe(404);
  });
});
