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

export async function request<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, headers, ...rest } = init;
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      ...rest,
      credentials: 'same-origin',
      headers: { ...(json === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
      ...(json === undefined ? {} : { body: JSON.stringify(json) }),
    });
  } catch {
    throw new OfflineError();
  }
  if (response.status === 204) return undefined as T;
  const body = (await response.json().catch(() => null)) as T | ApiError | null;
  if (!response.ok) {
    const error = (body as ApiError | null)?.error;
    throw new RequestError(response.status, error?.code ?? 'unknown', error?.message ?? '잠시 뒤에 다시 해 주세요.');
  }
  return body as T;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '알 수 없는 문제가 생겼어요.';
}
