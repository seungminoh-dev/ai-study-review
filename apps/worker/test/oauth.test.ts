import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import example from '../../../packages/shared/fixtures/immutable-object.json';
import { base64url, sha256 } from '../src/lib/crypto';
import { ORIGIN, api, newUser, readRpc, workerFetch } from './helpers';

// OAuth 커넥터 인증은 로그인과 같은 무게라 흐름 전체를 본다: 등록 → (로그인 확인) → 허용 → 토큰 → MCP → 끊기

const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';

const cookiesOf = (response: Response) => response.headers.getSetCookie().map((cookie) => cookie.split(';')[0]!);

async function register(): Promise<string> {
  const response = await workerFetch(`${ORIGIN}/oauth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_name: 'Claude', redirect_uris: [REDIRECT], token_endpoint_auth_method: 'none' }),
  });
  expect(response.status).toBe(201);
  return ((await response.json()) as { client_id: string }).client_id;
}

async function authorizeUrl(clientId: string, verifier: string): Promise<string> {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: REDIRECT,
    state: 'state-1',
    code_challenge: base64url(await sha256(verifier)),
    code_challenge_method: 'S256',
    scope: 'moai',
    resource: `${ORIGIN}/mcp`,
  });
  return `${ORIGIN}/authorize?${params}`;
}

const mcpCall = (token: string) =>
  workerFetch(`${ORIGIN}/mcp`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
  });

describe('OAuth connector', () => {
  it('points an unauthenticated MCP client at the authorization server', async () => {
    const response = await workerFetch(`${ORIGIN}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toContain('/.well-known/oauth-protected-resource/mcp');
    const metadata = (await (await workerFetch(`${ORIGIN}/.well-known/oauth-authorization-server`)).json()) as Record<string, string>;
    expect(metadata).toMatchObject({ authorization_endpoint: `${ORIGIN}/authorize`, token_endpoint: `${ORIGIN}/oauth/token`, registration_endpoint: `${ORIGIN}/oauth/register` });
  });

  it('asks a signed-in user, issues a token for their own MCP, and stops it when disconnected', async () => {
    const clientId = await register();
    const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
    const url = await authorizeUrl(clientId, verifier);

    // 로그인하지 않았으면 허용 화면 대신 로그인으로 보낸다
    const anonymous = await workerFetch(url);
    expect(anonymous.status).toBe(401);
    expect(await anonymous.text()).toContain('/login?next=%2Fauthorize%3F');

    const user = await newUser('연결하는 사람');
    const page = await workerFetch(url, { headers: { cookie: user.cookie } });
    expect(page.status).toBe(200);
    const markup = await page.text();
    expect(markup).toContain('Claude');
    expect(markup).toContain('claude.ai');
    const handle = /name="handle" value="([^"]+)"/.exec(markup)![1]!;
    const cookie = [user.cookie, ...cookiesOf(page)].join('; ');
    const form = new URLSearchParams({ handle, decision: 'approve' });

    // 다른 사이트에서 보낸 허용은 받지 않는다
    const forged = await workerFetch(`${ORIGIN}/authorize`, { method: 'POST', headers: { cookie, origin: 'https://evil.example', 'content-type': 'application/x-www-form-urlencoded' }, body: form });
    expect(forged.status).toBe(403);

    const approved = await workerFetch(`${ORIGIN}/authorize`, { method: 'POST', headers: { cookie, origin: ORIGIN, 'content-type': 'application/x-www-form-urlencoded' }, body: form });
    expect(approved.status).toBe(302);
    const location = new URL(approved.headers.get('location')!);
    expect(`${location.origin}${location.pathname}`).toBe(REDIRECT);
    expect(location.searchParams.get('state')).toBe('state-1');

    const tokenResponse = await workerFetch(`${ORIGIN}/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code: location.searchParams.get('code')!, code_verifier: verifier, client_id: clientId, redirect_uri: REDIRECT, resource: `${ORIGIN}/mcp` }),
    });
    expect(tokenResponse.status).toBe(200);
    const { access_token } = (await tokenResponse.json()) as { access_token: string };

    const tools = await readRpc(await mcpCall(access_token));
    expect(tools.result.tools.map((tool: { name: string }) => tool.name)).toContain('save_learning');
    // 토큰으로 저장한 것은 허용한 사람의 기록이 된다
    const save = await workerFetch(`${ORIGIN}/mcp`, {
      method: 'POST',
      headers: { authorization: `Bearer ${access_token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'save_learning', arguments: example } }),
    });
    expect((await readRpc(save)).result.isError).toBeFalsy();
    expect(await env.DB.prepare('SELECT count(*) AS n FROM learning_sessions WHERE user_id = ?1').bind(user.id).first<number>('n')).toBe(1);

    const apps = (await (await api(user, '/oauth/apps')).json()) as { apps: { id: string; name: string }[] };
    expect(apps.apps.map((app) => app.name)).toEqual(['Claude']);
    // 비밀 주소 없이도 연결됨으로 본다 (시작하기 체크리스트)
    expect(await (await api(user, '/mcp-token')).json()).toMatchObject({ active: false, connected: true });
    // 남의 연결은 끊지 못한다
    await api(await newUser(), `/oauth/apps/${apps.apps[0]!.id}`, { method: 'DELETE' });
    expect((await mcpCall(access_token)).status).toBe(200);
    expect((await api(user, `/oauth/apps/${apps.apps[0]!.id}`, { method: 'DELETE' })).status).toBe(204);
    expect((await mcpCall(access_token)).status).toBe(401);
    expect(await (await api(user, '/mcp-token')).json()).toMatchObject({ connected: false });
  });
});
