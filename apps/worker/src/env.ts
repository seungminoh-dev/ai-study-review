import type { OAuthHelpers } from '@cloudflare/workers-oauth-provider';

export interface Env {
  DB: D1Database;
  /** OAuth 커넥터 인증의 클라이언트·권한·토큰 (토큰은 해시만, props는 암호화돼 들어간다) */
  OAUTH_KV: KVNamespace;
  /** OAuthProvider가 /api·/authorize 같은 기본 경로를 부를 때 넣어 준다. 비밀 URL MCP 경로에는 없다 */
  OAUTH_PROVIDER?: OAuthHelpers;
  /** 서비스 주소. Origin·Host 검사 기준 (예: https://moai.example.com) */
  APP_ORIGIN: string;
  VAPID_PUBLIC_KEY: string;
  VAPID_SUBJECT: string;
  /** secret. 푸시 서명 키 */
  VAPID_PRIVATE_KEY: string;
  /** secret. 세션·커넥터 토큰을 해시하는 HMAC 키 (설계서 §14) */
  TOKEN_PEPPER: string;
  /** secret. 오너 계정을 한 번 만들 때만 쓴다 (설계서 §8.3) */
  BOOTSTRAP_CODE: string;
  /** secret. GitHub OAuth 앱 (설계서 §8.4). 둘 다 없으면 GitHub 로그인을 감춘다 */
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  /** secret. 서버 LLM용 내 Console API 키 (설계서 §11.1). 없으면 AI 채점과 가져오기를 감춘다 */
  ANTHROPIC_API_KEY?: string;
  /** secret. 채점·가져오기에 쓸 모델 ID */
  GRADER_MODEL?: string;
  /** 사용자별·전체 이번 달 한도 (달러). 기본 6, 90 */
  LLM_USER_CAP_USD?: string;
  LLM_MONTHLY_CAP_USD?: string;
}
