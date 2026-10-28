import type { ApiError } from '@moai/shared';

/** 서버가 돌려준 오류. message는 사용자에게 그대로 보여 줄 한국어 문장이다 */
export class RequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** 네트워크가 끊겼을 때 */
export class OfflineError extends Error {
  constructor() {
    super('인터넷에 연결되지 않았어요.');
  }
}

/** 읽기 요청이 너무 오래 걸릴 때. 오프라인처럼 다룬다 (저장해 둔 카드로 복습하기 등) */
export class SlowError extends OfflineError {
  constructor() {
    super();
    this.message = '응답이 너무 늦어요. 연결이 약한 것 같아요. 잠시 뒤에 다시 해 주세요.';
  }
}

/** 읽기(GET)가 이보다 오래 걸리면 끊는다. 약한 연결에서 로딩이 끝나지 않는 것을 막는다. 쓰기는 서버가 이미 받았을 수 있어 끊지 않는다 */
const READ_TIMEOUT_MS = 20_000;

/** 쓰는 도중 세션이 끝나면(401) 부른다. 로그인한 동안 App이 정해 둔다 */
let unauthorized: (() => void) | null = null;

export function onUnauthorized(handler: (() => void) | null): void {
  unauthorized = handler;
}

export async function request<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, headers, ...rest } = init;
  const read = (rest.method ?? 'GET').toUpperCase() === 'GET';
  const signal = rest.signal ?? (read ? AbortSignal.timeout(READ_TIMEOUT_MS) : undefined);
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      ...rest,
      ...(signal ? { signal } : {}),
      credentials: 'same-origin',
      headers: { ...(json === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
      ...(json === undefined ? {} : { body: JSON.stringify(json) }),
    });
  } catch (error) {
    throw error instanceof DOMException && error.name === 'TimeoutError' ? new SlowError() : new OfflineError();
  }
  if (response.status === 204) return undefined as T;
  const body = (await response.json().catch(() => null)) as T | ApiError | null;
  if (!response.ok) {
    if (response.status === 401) unauthorized?.();
    const error = (body as ApiError | null)?.error;
    throw new RequestError(response.status, error?.code ?? 'unknown', error?.message ?? '잠시 뒤에 다시 해 주세요.');
  }
  return body as T;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '알 수 없는 문제가 생겼어요.';
}
