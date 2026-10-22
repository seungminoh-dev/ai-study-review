import { env, exports } from 'cloudflare:workers';
import { hashToken, randomToken } from '../src/lib/crypto';

export const ORIGIN = 'https://moai.test';
export const BOOTSTRAP_CODE = 'test-bootstrap-code';

/** 브라우저처럼 Worker를 부른다. 리다이렉트는 따라가지 않고 그대로 돌려준다 (GitHub 로그인 검사용). */
export function workerFetch(input: string | URL, init?: RequestInit): Promise<Response> {
  return exports.default.fetch(new Request(input, { redirect: 'manual', ...init }));
}

export interface TestUser {
  id: string;
  cookie: string;
}

/** 테스트끼리 데이터가 섞이지 않게 테스트마다 새 사용자(기본은 일반 회원)와 세션을 DB에 바로 만든다. */
export async function newUser(name = '테스터', role: 'member' | 'owner' = 'member'): Promise<TestUser> {
  const id = crypto.randomUUID();
  const token = randomToken();
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare('INSERT INTO users (id, display_name, role, created_at) VALUES (?1, ?2, ?4, ?3)').bind(id, name, now, role),
    env.DB.prepare('INSERT INTO auth_sessions (token_hash, user_id, created_at, last_seen_at, expires_at) VALUES (?1, ?2, ?3, ?3, ?4)').bind(
      await hashToken(env.TOKEN_PEPPER, token),
      id,
      now,
      now + 86_400_000,
    ),
  ]);
  return { id, cookie: `__Host-sid=${token}` };
}

/** 로그인한 사용자로 /api를 부른다. 상태를 바꾸는 요청이라 Origin도 붙인다. */
export function api(user: TestUser | null, path: string, init: RequestInit & { json?: unknown } = {}): Promise<Response> {
  const { json, headers, ...rest } = init;
  return workerFetch(`${ORIGIN}/api${path}`, {
    ...rest,
    ...(json === undefined ? {} : { body: JSON.stringify(json) }),
    headers: {
      origin: ORIGIN,
      ...(json === undefined ? {} : { 'content-type': 'application/json' }),
      ...(user ? { cookie: user.cookie } : {}),
      ...(headers as Record<string, string> | undefined),
    },
  });
}

/** 설정 화면처럼 커넥터 URL을 발급받는다. */
export async function mcpUrl(user: TestUser): Promise<string> {
  const response = await api(user, '/mcp-token', { method: 'POST' });
  if (response.status !== 201) throw new Error(`mcp-token ${response.status}`);
  return ((await response.json()) as { url: string }).url;
}

let nextId = 1;

/** 2025년 방식 JSON-RPC 요청 하나를 보낸다. */
export function rpc(url: string, method: string, params: Record<string, unknown> = {}, headers: Record<string, string> = {}): Promise<Response> {
  return workerFetch(url, {
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

/** tools/call 한 번. 결과(result)만 돌려준다. */
export async function callTool(url: string, name: string, args: unknown): Promise<any> {
  const message = await readRpc(await rpc(url, 'tools/call', { name, arguments: args }, { 'mcp-protocol-version': '2025-06-18' }));
  if (message.error) throw new Error(JSON.stringify(message.error));
  return message.result;
}

const b64url = (bytes: ArrayBuffer | Uint8Array) => {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return btoa(String.fromCharCode(...view)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
};

/** 브라우저가 만드는 것과 같은 모양의 푸시 구독 (P-256 공개 키, 16바이트 auth). */
export async function fakeSubscription(endpoint = `https://fcm.googleapis.com/fcm/send/${crypto.randomUUID()}`) {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
  const raw = (await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer;
  return { endpoint, keys: { p256dh: b64url(raw), auth: b64url(crypto.getRandomValues(new Uint8Array(16))) } };
}
