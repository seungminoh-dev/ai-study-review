import { exports } from 'cloudflare:workers';

export const ORIGIN = 'https://moai.test';
export const TOKEN = 'test-spike-token';
export const MCP_URL = `${ORIGIN}/mcp/u/${TOKEN}`;

export function workerFetch(input: string | URL, init?: RequestInit): Promise<Response> {
  return exports.default.fetch(new Request(input, init));
}

let nextId = 1;

/** 2025년 방식 JSON-RPC 요청 하나를 보낸다. */
export function rpc(method: string, params: Record<string, unknown> = {}, headers: Record<string, string> = {}): Promise<Response> {
  return workerFetch(MCP_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
    body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params }),
  });
}

/** JSON 본문이든 SSE 스트림이든 마지막 JSON-RPC 메시지를 꺼낸다. 2025년 방식 응답은 SSE일 수 있다 (설계서 §6.2). */
export async function readRpc(response: Response): Promise<any> {
  const body = await response.text();
  if ((response.headers.get('content-type') ?? '').includes('text/event-stream')) {
    const messages = body
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => JSON.parse(line.slice(5)));
    return messages.at(-1);
  }
  return JSON.parse(body);
}

export async function waitFor<T>(read: () => Promise<T | null | undefined>, timeoutMs = 2000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error('timed out');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
