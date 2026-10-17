import { PROTOCOL_VERSION_META_KEY } from '@modelcontextprotocol/server';
import type { Context } from 'hono';
import type { Env } from '../env';
import { byteLength, safeEqual } from '../lib/crypto';
import { MAX_BODY_BYTES, checkHost, checkOrigin, tooLarge } from '../lib/guard';
import { mcpHandler, type McpDeps } from './server';

interface RpcSummary {
  rpcMethod: string | null;
  toolName: string | null;
  protocolBody: string | null;
}

function summarize(body: unknown): RpcSummary {
  const messages = Array.isArray(body) ? body : [body];
  const first = messages[0] as { method?: unknown; params?: Record<string, unknown> } | undefined;
  const params = first?.params ?? {};
  const meta = (params._meta ?? {}) as Record<string, unknown>;
  const version = params.protocolVersion ?? meta[PROTOCOL_VERSION_META_KEY];
  return {
    rpcMethod: messages.map((m) => (m as { method?: unknown })?.method).filter((m) => typeof m === 'string').join(',') || null,
    toolName: typeof params.name === 'string' ? params.name : null,
    protocolBody: typeof version === 'string' ? version : null,
  };
}

/** POST /mcp/u/:token (설계서 §6.1, §6.2). MVP 0은 SPIKE_TOKEN 하나로만 연다. */
export async function handleMcp(c: Context<{ Bindings: Env }>): Promise<Response> {
  const started = Date.now();
  const rejected = checkHost(c.req.raw, c.env) ?? checkOrigin(c.req.raw, c.env);
  if (rejected) return rejected;
  if (!c.env.SPIKE_TOKEN || !(await safeEqual(c.req.param('token') ?? '', c.env.SPIKE_TOKEN))) {
    return new Response(null, { status: 404 });
  }

  let body: string | undefined;
  let parsed: unknown;
  if (c.req.method === 'POST') {
    if (Number(c.req.header('content-length') ?? '0') > MAX_BODY_BYTES) return tooLarge();
    body = await c.req.text();
    if (byteLength(body) > MAX_BODY_BYTES) return tooLarge();
    try {
      parsed = JSON.parse(body);
    } catch {
      parsed = undefined;
    }
  }

  const deps: McpDeps = { env: c.env, userId: 'spike-owner' };
  const request = new Request(c.req.url, { method: c.req.method, headers: c.req.raw.headers, body: body ?? null });
  const response = await mcpHandler.fetch(request, {
    authInfo: { token: 'url-token', clientId: 'url-token', scopes: [], extra: deps as unknown as Record<string, unknown> },
    ...(parsed === undefined ? {} : { parsedBody: parsed }),
  });

  const summary = summarize(parsed);
  // Workers는 I/O를 기다릴 때만 시계가 움직이고 SSE 응답은 도구가 끝나기 전에 돌아오므로, duration_ms는 거의 늘 0이다.
  // 화면에는 보여 주지 않는다. 응답 시간은 scripts/replay.mjs로 잰다.
  const cf = (c.req.raw as Request & { cf?: { colo?: string } }).cf;
  c.executionCtx.waitUntil(
    c.env.DB.prepare(
      `INSERT INTO spike_mcp_requests (id, at, http_method, rpc_method, tool_name, protocol_header, protocol_body, user_agent, colo, status, duration_ms)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`,
    )
      .bind(
        crypto.randomUUID(), started, c.req.method, summary.rpcMethod, summary.toolName,
        c.req.header('mcp-protocol-version') ?? null, summary.protocolBody,
        c.req.header('user-agent') ?? null, cf?.colo ?? null, response.status, Date.now() - started,
      )
      .run()
      .catch((error: Error) => console.error(JSON.stringify({ event: 'spike_log_failed', message: error.message }))),
  );
  return response;
}
