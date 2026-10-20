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

const DAY_MS = 24 * 60 * 60 * 1000;
/** 이만큼 안 쓴 비밀 주소는 끊는다. 주소가 새어도 모르는 채로 영원히 남지 않게 */
export const MCP_TOKEN_IDLE_MS = 90 * DAY_MS;

/**
 * 커넥터 URL의 토큰으로 사용자를 찾는다. 모르거나 취소된 토큰이면 null이다 (설계서 §6.1).
 * 마지막 사용 시각을 하루 한 번 적고, 90일 동안 안 쓴 토큰은 그 자리에서 끊는다 (처음 보는 빈 값은 지금부터 센다)
 */
export async function findMcpUser(env: Env, token: string, now = Date.now()): Promise<string | null> {
  if (!token || !env.TOKEN_PEPPER) return null;
  const hash = await hashToken(env.TOKEN_PEPPER, token);
  const row = await env.DB.prepare(
    'SELECT t.user_id, t.last_used_at FROM mcp_tokens t JOIN users u ON u.id = t.user_id WHERE t.token_hash = ?1 AND t.revoked_at IS NULL AND u.disabled_at IS NULL',
  )
    .bind(hash)
    .first<{ user_id: string; last_used_at: number | null }>();
  if (!row) return null;
  if (row.last_used_at !== null && now - row.last_used_at > MCP_TOKEN_IDLE_MS) {
    await env.DB.prepare('UPDATE mcp_tokens SET revoked_at = ?2 WHERE token_hash = ?1 AND revoked_at IS NULL').bind(hash, now).run();
    console.log(JSON.stringify({ event: 'mcp_token_expired', user_id: row.user_id }));
    return null;
  }
  if (row.last_used_at === null || now - row.last_used_at > DAY_MS) {
    await env.DB.prepare('UPDATE mcp_tokens SET last_used_at = ?2 WHERE token_hash = ?1').bind(hash, now).run();
  }
  return row.user_id;
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
