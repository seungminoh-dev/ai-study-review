import type { Env } from './env';
import { deliverDueJobs } from './spike/jobs';

/** 매분 Cron (설계서 §10.4). MVP 0은 예약한 테스트 푸시만 보낸다. */
export async function runCron(env: Env, now: number): Promise<void> {
  const sent = await deliverDueJobs(env, now);
  if (sent > 0) console.log(JSON.stringify({ event: 'cron_push', sent }));
}
