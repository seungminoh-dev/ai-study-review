import { deliverDueReminders } from './domain/reminders';
import type { Env } from './env';

/** 매분 Cron (설계서 §10.4). 일은 이 순서대로 하고, CPU를 많이 쓰는 일은 한 실행에 하나만 한다. */
export async function runCron(env: Env, now: number): Promise<void> {
  try {
    await deliverDueReminders(env, now);
  } catch (error) {
    console.error(JSON.stringify({ event: 'cron_reminders_failed', message: (error as Error).message }));
  }
  // 매시 0분: 만료된 로그인 세션을 지운다
  if (new Date(now).getUTCMinutes() === 0) {
    const removed = await env.DB.prepare('DELETE FROM auth_sessions WHERE expires_at <= ?1').bind(now).run();
    if (removed.meta.changes > 0) console.log(JSON.stringify({ event: 'sessions_expired', removed: removed.meta.changes }));
  }
}
