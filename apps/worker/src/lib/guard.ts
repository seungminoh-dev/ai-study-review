import type { Env } from '../env';
import { errorJson } from './http';

/** MCP 요청 본문 상한. 가장 큰 save_learning 요청(약 52KB)의 몇 배로 잡는다. */
export const MAX_BODY_BYTES = 256 * 1024;

/** 등록한 주소가 아닌 Host로 온 요청을 거절한다. */
export function checkHost(request: Request, env: Env): Response | null {
  const expected = new URL(env.APP_ORIGIN).host;
  if (new URL(request.url).host !== expected) return errorJson(421, 'wrong_host', '이 주소로는 요청할 수 없어요.');
  return null;
}

/** Origin 헤더가 있는데 우리 주소가 아니면 거절한다. 서버 간 호출에는 보통 Origin이 없다. */
export function checkOrigin(request: Request, env: Env): Response | null {
  const origin = request.headers.get('origin');
  if (origin !== null && origin !== env.APP_ORIGIN) return errorJson(403, 'wrong_origin', '허용되지 않은 출처예요.');
  return null;
}

export function tooLarge(): Response {
  return errorJson(413, 'too_large', '요청 본문이 너무 커요.');
}
