import type { Env } from '../env';
import { MINUTE_MS } from '../lib/kst';
import { pushToUser } from './push';

// 오너에게 보내는 서버 문제 알림. 생길 때마다 수만 올리고, 매분 Cron이 종류마다 한 시간에 한 번만 모아서 푸시한다.
// 로그처럼 내용은 남기지 않는다. 자세한 것은 Cloudflare 로그에서 본다.

export type AlertKind = 'server_error' | 'cron_failed' | 'llm_failed' | 'mcp_failed' | 'reminder_late' | 'llm_spend';

const LABEL: Record<AlertKind, string> = { server_error: '서버 오류', cron_failed: '매분 작업 실패', llm_failed: 'AI 호출 실패', mcp_failed: 'MCP 도구 실패', reminder_late: '복습 알림 지연', llm_spend: 'Anthropic 결제 한도' };
/** 같은 종류는 이만큼 지나야 다시 알린다 */
export const ALERT_QUIET_MS = 60 * MINUTE_MS;

/** 문제가 하나 생겼다. 알림을 못 남겨도 원래 일은 계속한다 */
export async function raiseAlert(env: Env, kind: AlertKind): Promise<void> {
  await env.DB.prepare('INSERT INTO alerts (kind, pending) VALUES (?1, 1) ON CONFLICT (kind) DO UPDATE SET pending = pending + 1')
    .bind(kind)
    .run()
    .catch(() => undefined);
}

/** 매분 Cron: 쌓인 알림 중 조용히 지낼 시간이 지난 종류를 오너에게 보낸다. 읽기와 비우기를 한 batch(트랜잭션)로 해서 두 번 보내지 않는다 */
export async function sendAlerts(env: Env, now: number): Promise<number> {
  const [due] = await env.DB.batch([
    env.DB.prepare('SELECT kind, pending FROM alerts WHERE pending > 0 AND last_sent_at <= ?1').bind(now - ALERT_QUIET_MS),
    env.DB.prepare('UPDATE alerts SET pending = 0, last_sent_at = ?2 WHERE pending > 0 AND last_sent_at <= ?1').bind(now - ALERT_QUIET_MS, now),
  ]);
  const rows = due!.results as { kind: AlertKind; pending: number }[];
  if (rows.length === 0) return 0;
  const { results: owners } = await env.DB.prepare("SELECT id FROM users WHERE role = 'owner'").all<{ id: string }>();
  const body = rows.map((row) => `${LABEL[row.kind] ?? row.kind} ${row.pending}건`).join(', ');
  for (const owner of owners) {
    await pushToUser(env, owner.id, { title: '모아이 서버에 문제가 있어요', body: `${body} · Cloudflare 로그를 확인해 주세요`, url: '/admin', tag: 'alert' }, now);
  }
  console.log(JSON.stringify({ event: 'alerts_sent', kinds: rows.map((row) => row.kind) }));
  return rows.length;
}
