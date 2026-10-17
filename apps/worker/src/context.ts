import type { Env } from './env';

/** Hono 앱의 타입. 로그인한 요청에는 userId가 들어 있다. */
export interface AppEnv {
  Bindings: Env;
  Variables: { userId: string };
}
