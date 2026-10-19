import type { Context } from 'hono';
import type { AppEnv } from '../context';
import type { Env } from '../env';
import { byteLength, hashToken } from '../lib/crypto';
import { MAX_BODY_BYTES, checkHost, checkOrigin, tooLarge } from '../lib/guard';
import { mcpHandler, type McpDeps } from './server';

function summarize(body: unknown): { method: string | null; tool: string | null } {
  const first = (Array.isArray(body) ? body[0] : body) as { method?: unknown; params?: { name?: unknown } } | undefined;
  return {
    method: typeof first?.method === 'string' ? first.method : null,
    tool: typeof first?.params?.name === 'string' ? first.params.name : null,
  };
}

/** 커넥터 URL의 토큰으로 사용자를 찾는다. 모르거나 취소된 토큰이면 null이다 (설계서 §6.1). */
export async function findMcpUser(env: Env, token: string): Promise<string | null> {
  if (!token || !env.TOKEN_PEPPER) return null;
  const row = await env.DB.prepare('SELECT user_id FROM mcp_tokens WHERE token_hash = ?1 AND revoked_at IS NULL')
    .bind(await hashToken(env.TOKEN_PEPPER, token))
    .first<{ user_id: string }>();
  return row?.user_id ?? null;
}

/** 커넥터 URL로 온 MCP 요청 (설계서 §6.1, §6.2). 토큰으로 사용자를 찾고 serveMcp에 넘긴다 */
export async function handleMcp(c: Context<AppEnv>): Promise<Response> {
  const userId = await findMcpUser(c.env, c.req.param('token') ?? '');
  if (!userId) return new Response(null, { status: 404 });
  return serveMcp(c.req.raw, c.env, userId);
}

/** 사용자가 정해진 MCP 요청을 처리한다. 비밀 URL과 OAuth(/mcp) 둘 다 여기로 온다 */
export async function serveMcp(raw: Request, env: Env, userId: string): Promise<Response> {
  const rejected = checkHost(raw, env) ?? checkOrigin(raw, env);
  if (rejected) return rejected;
  let body: string | undefined;
  let parsed: unknown;
  if (raw.method === 'POST') {
    if (Number(raw.headers.get('content-length') ?? '0') > MAX_BODY_BYTES) return tooLarge();
    body = await raw.text();
    if (byteLength(body) > MAX_BODY_BYTES) return tooLarge();
    try {
      parsed = JSON.parse(body);
    } catch {
      parsed = undefined;
    }
  }

  const deps: McpDeps = { env, userId };
  const request = new Request(raw.url, { method: raw.method, headers: raw.headers, body: body ?? null });
  const response = await mcpHandler.fetch(request, {
    authInfo: { token: 'moai', clientId: 'moai', scopes: [], extra: deps as unknown as Record<string, unknown> },
    ...(parsed === undefined ? {} : { parsedBody: parsed }),
  });
  // 로그에는 URL(토큰)과 본문을 남기지 않는다 (설계서 §13.4)
  console.log(JSON.stringify({ event: 'mcp', user_id: userId, ...summarize(parsed), status: response.status }));
  return response;
}
