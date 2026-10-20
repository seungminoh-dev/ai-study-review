import type { Env } from './env';

/** Hono 앱의 타입. 로그인한 요청에는 userId가 들어 있다. */
export interface AppEnv {
  Bindings: Env;
  /** sessionHash는 이 요청의 로그인 세션 (다른 기기 로그아웃에서 이 기기를 남긴다) */
  Variables: { userId: string; sessionHash: string };
}
