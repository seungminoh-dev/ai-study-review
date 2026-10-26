import { raiseAlert, sendAlerts } from './domain/alerts';
import { deliverDueReminders } from './domain/reminders';
import { notifyBudget } from './llm/budget';
import { runPendingJobs } from './llm/jobs';
import { oauthProvider } from './oauth';
import type { Env } from './env';
import { DAY_MS } from './lib/kst';

/** 매분 Cron (설계서 §10.4). 일은 이 순서대로 하고, CPU를 많이 쓰는 일은 한 실행에 하나만 한다. */
export async function runCron(env: Env, now: number): Promise<void> {
  // 살아 있다는 표시. /api/health가 이 시각이 5분 넘게 묵었으면 503을 줘서 밖에서 알 수 있다 (알림도 이 Cron이 보내서, 죽으면 스스로는 못 알린다)
  await env.DB.prepare("INSERT INTO alerts (kind, pending, last_sent_at) VALUES ('cron_heartbeat', 0, ?1) ON CONFLICT (kind) DO UPDATE SET last_sent_at = ?1")
    .bind(now)
    .run()
    .catch(() => undefined);
  await step(env, 'cron_reminders_failed', () => deliverDueReminders(env, now));
  // AI 채점 이어 받기와 붙여넣기 가져오기 (설계서 §11.3). 가져오기는 몇 분 걸릴 수 있어서 알림 뒤에 한다
  await step(env, 'cron_jobs_failed', () => runPendingJobs(env, now));
  // 쌓인 서버 문제를 오너에게 알린다 (종류마다 한 시간에 한 번)
  await step(env, 'cron_alerts_failed', () => sendAlerts(env, now), false);
  // 매시 0분 정리. 실패해도 다른 일은 이미 끝났고, 오너에게 알린다
  if (new Date(now).getUTCMinutes() === 0) await step(env, 'cron_cleanup_failed', () => hourlyCleanup(env, now));
}

/** 일 하나를 한다. 실패하면 로그를 남기고(alert면 오너 알림도 쌓고) 다음 일로 넘어간다 */
async function step(env: Env, event: string, work: () => Promise<unknown>, alert = true): Promise<void> {
  try {
    await work();
  } catch (error) {
    console.error(JSON.stringify({ event, message: error instanceof Error ? error.message : '' }));
    if (alert) await raiseAlert(env, 'cron_failed');
  }
}

/** 매시 0분: 만료된 로그인 세션, 로그인 코드, 끝내지 않은 가입을 지운다 */
async function hourlyCleanup(env: Env, now: number): Promise<void> {
  const [sessions] = await env.DB.batch([
    env.DB.prepare('DELETE FROM auth_sessions WHERE expires_at <= ?1').bind(now),
    env.DB.prepare('DELETE FROM login_codes WHERE expires_at <= ?1').bind(now),
    env.DB.prepare('DELETE FROM pending_signups WHERE expires_at <= ?1').bind(now),
    // AI 작업 결과(채점 결과에는 사용자 문장이 들어 있다)는 30일 뒤 지운다. 비용 기록(llm_usage)은 남긴다
    env.DB.prepare("DELETE FROM llm_jobs WHERE created_at <= ?1 AND status IN ('done', 'failed')").bind(now - 30 * DAY_MS),
  ]);
  if (sessions!.meta.changes > 0) console.log(JSON.stringify({ event: 'sessions_expired', removed: sessions!.meta.changes }));
  // 만료됐거나 주인 잃은 OAuth 권한·토큰을 조금씩 지운다
  await step(env, 'cron_oauth_purge_failed', () => oauthProvider(env).purgeExpiredData(env), false);
  await step(env, 'cron_budget_failed', () => notifyBudget(env, now), false);
}
