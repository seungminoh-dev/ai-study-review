import type { Env } from '../env';

// OAuth로 연결한 앱(커넥터) 목록과 끊기. env.OAUTH_PROVIDER는 OAuthProvider가 /api·/authorize 요청에 넣어 준다.

export interface ConnectedApp {
  id: string;
  name: string;
  created_at: number;
}

export async function listConnectedApps(env: Env, userId: string): Promise<ConnectedApp[]> {
  const helpers = env.OAUTH_PROVIDER;
  if (!helpers) return [];
  const apps: ConnectedApp[] = [];
  let cursor: string | undefined;
  do {
    const page = await helpers.listUserGrants(userId, cursor ? { cursor } : undefined);
    for (const grant of page.items) {
      const client = await helpers.lookupClient(grant.clientId).catch(() => null);
      apps.push({ id: grant.id, name: client?.clientName ?? grant.clientId, created_at: grant.createdAt * 1000 });
    }
    cursor = page.cursor;
  } while (cursor);
  return apps;
}

/**
 * 이 사람의 로그인과 접근을 모두 끊는 문장: 로그인 세션, 로그인 코드, 커넥터 URL, 푸시 구독 (기기 복구, 이용 정지).
 * OAuth 권한은 KV에 있어서 revokeAllGrants로 따로 끊는다. when을 주면 그 조건이 맞을 때만 끊는다 (?1은 사람, ?2부터 when.values)
 */
export function revokeAccessStatements(env: Env, userId: string, when?: { sql: string; values: unknown[] }): D1PreparedStatement[] {
  const run = (sql: string) => env.DB.prepare(when ? `${sql} AND ${when.sql}` : sql).bind(userId, ...(when?.values ?? []));
  return [
    run('DELETE FROM auth_sessions WHERE user_id = ?1'),
    run('DELETE FROM login_codes WHERE user_id = ?1'),
    run('UPDATE mcp_tokens SET revoked_at = unixepoch() * 1000 WHERE user_id = ?1 AND revoked_at IS NULL'),
    run('DELETE FROM push_subscriptions WHERE user_id = ?1'),
  ];
}

/** 이 사람의 연결을 모두 끊는다 (계정 지우기, 기기 복구, 이용 정지) */
export async function revokeAllGrants(env: Env, userId: string): Promise<void> {
  const helpers = env.OAUTH_PROVIDER;
  if (!helpers) return;
  // 지우면 다음 쪽이 당겨지므로 매번 첫 쪽부터 다시 읽는다. 한 사람의 연결은 많아야 몇 개다
  for (let round = 0; round < 20; round++) {
    const page = await helpers.listUserGrants(userId);
    if (page.items.length === 0) break;
    for (const grant of page.items) await helpers.revokeGrant(grant.id, userId);
  }
}
