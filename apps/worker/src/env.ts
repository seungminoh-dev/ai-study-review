export interface Env {
  DB: D1Database;
  /** 서비스 주소. Origin·Host 검사 기준 (예: https://moai.example.com) */
  APP_ORIGIN: string;
  VAPID_PUBLIC_KEY: string;
  VAPID_SUBJECT: string;
  /** secret */
  VAPID_PRIVATE_KEY: string;
  /** secret. MVP 0 전용 MCP·스파이크 API 토큰. MVP 1에서 지운다 */
  SPIKE_TOKEN: string;
}
