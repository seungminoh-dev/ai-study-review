import { deliverDueReminders } from './domain/reminders';
import { runPendingJobs } from './llm/jobs';
import type { Env } from './env';

/** 매분 Cron (설계서 §10.4). 일은 이 순서대로 하고, CPU를 많이 쓰는 일은 한 실행에 하나만 한다. */
export async function runCron(env: Env, now: number): Promise<void> {
  try {
    await deliverDueReminders(env, now);
  } catch (error) {
    console.error(JSON.stringify({ event: 'cron_reminders_failed', message: (error as Error).message }));
  }
  // AI 채점 이어 받기와 붙여넣기 가져오기 (설계서 §11.3). 가져오기는 몇 분 걸릴 수 있어서 알림 뒤에 한다
  try {
    await runPendingJobs(env, now);
  } catch (error) {
    console.error(JSON.stringify({ event: 'cron_jobs_failed', message: (error as Error).message }));
  }
  // 매시 0분: 만료된 로그인 세션, 로그인 코드, 끝내지 않은 가입을 지운다
  if (new Date(now).getUTCMinutes() === 0) {
    const [sessions] = await env.DB.batch([
      env.DB.prepare('DELETE FROM auth_sessions WHERE expires_at <= ?1').bind(now),
      env.DB.prepare('DELETE FROM login_codes WHERE expires_at <= ?1').bind(now),
      env.DB.prepare('DELETE FROM pending_signups WHERE expires_at <= ?1').bind(now),
    ]);
    if (sessions!.meta.changes > 0) console.log(JSON.stringify({ event: 'sessions_expired', removed: sessions!.meta.changes }));
  }
}
