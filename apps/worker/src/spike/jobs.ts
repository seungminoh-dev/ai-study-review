import type { Env } from '../env';
import { formatKst } from '../lib/kst';
import { isGone, sendPush, type StoredSubscription } from './push';

/** 정한 시각보다 이만큼 늦으면 보내지 않는다 (설계서 §10.2). */
export const STALE_AFTER_MS = 30 * 60 * 1000;
/** 한 번의 Cron 실행에서 보내는 최대 건수. MVP 0에서 CPU를 재고 조정한다. */
export const PUSHES_PER_TICK = 2;

interface DueJob extends StoredSubscription {
  job_id: string;
  ack: string;
  fire_at: number;
  subscription_id: string;
}

export async function deliverJob(env: Env, job: DueJob, now: number): Promise<void> {
  // 먼저 발송 처리로 표시한다. 겹쳐 도는 Cron이 같은 알림을 두 번 보내지 않는다 (최대 한 번 발송).
  const claim = await env.DB.prepare('UPDATE spike_push_jobs SET sent_at = ?1 WHERE id = ?2 AND sent_at IS NULL')
    .bind(now, job.job_id)
    .run();
  if (claim.meta.changes !== 1) return;
  if (now - job.fire_at > STALE_AFTER_MS) {
    await env.DB.prepare('UPDATE spike_push_jobs SET error = ?1 WHERE id = ?2').bind('stale', job.job_id).run();
    return;
  }
  let status = 0;
  let error: string | null = null;
  try {
    status = await sendPush(env, job, {
      title: '모아이 테스트 알림',
      body: `${formatKst(job.fire_at)} KST에 예약한 알림이에요.`,
      url: '/spike',
      tag: `spike-${job.job_id}`,
      job_id: job.job_id,
      ack: job.ack,
    });
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  const statements = [
    env.DB.prepare('UPDATE spike_push_jobs SET status_code = ?1, error = ?2 WHERE id = ?3').bind(status || null, error, job.job_id),
  ];
  if (isGone(status)) statements.push(env.DB.prepare('DELETE FROM spike_push_subscriptions WHERE id = ?1').bind(job.subscription_id));
  await env.DB.batch(statements);
}

export async function deliverDueJobs(env: Env, now: number): Promise<number> {
  const { results } = await env.DB.prepare(
    `SELECT j.id AS job_id, j.ack, j.fire_at, j.subscription_id, s.id, s.endpoint, s.p256dh, s.auth
       FROM spike_push_jobs j JOIN spike_push_subscriptions s ON s.id = j.subscription_id
      WHERE j.sent_at IS NULL AND j.fire_at <= ?1
      ORDER BY j.fire_at LIMIT ?2`,
  )
    .bind(now, PUSHES_PER_TICK)
    .all<DueJob>();
  for (const job of results) await deliverJob(env, job, now);
  return results.length;
}
