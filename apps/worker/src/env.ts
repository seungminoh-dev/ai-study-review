export interface Env {
  DB: D1Database;
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
}
