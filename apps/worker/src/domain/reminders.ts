import { estimateMinutes, type Reminder } from '@moai/shared';
import type { Env } from '../env';
import { nextKstTime } from '../lib/kst';
import { pushToUser } from './push';
import { loadTodayQueue } from './queue';

// 리마인드 (설계서 §10)

/** 한 번의 Cron 실행에서 처리하는 알림 시간 수. 10명이 같은 분을 골라도 몇 분 안에 다 나간다 */
export const PUSH_SLOTS_PER_TICK = 2;
/** 이보다 늦은 알림은 보내지 않는다. 장애 뒤에 늦은 알림이 몰려 오는 것을 막는다 */
const STALE_AFTER_MS = 30 * 60 * 1000;

export async function listReminders(env: Env, userId: string): Promise<Reminder[]> {
  const { results } = await env.DB.prepare('SELECT local_time, enabled, next_fire_at FROM reminder_slots WHERE user_id = ?1 ORDER BY local_time')
    .bind(userId)
    .all<{ local_time: string; enabled: number; next_fire_at: number }>();
  return results.map((row) => ({ local_time: row.local_time, enabled: row.enabled === 1, next_fire_at: row.next_fire_at }));
}

/** 알림 시간을 통째로 바꾼다 (최대 3개) */
export async function replaceReminders(env: Env, userId: string, times: readonly string[], now: number): Promise<Reminder[]> {
  const rows = [...times].sort().map((time) => ({ id: crypto.randomUUID(), local_time: time, next_fire_at: nextKstTime(time, now) }));
  await env.DB.batch([
    env.DB.prepare('DELETE FROM reminder_slots WHERE user_id = ?1').bind(userId),
    env.DB.prepare(
      `INSERT INTO reminder_slots (id, user_id, local_time, enabled, next_fire_at)
       SELECT json_extract(value, '$.id'), ?1, json_extract(value, '$.local_time'), 1, json_extract(value, '$.next_fire_at') FROM json_each(?2)`,
    ).bind(userId, JSON.stringify(rows)),
  ]);
  return rows.map((row) => ({ local_time: row.local_time, enabled: true, next_fire_at: row.next_fire_at }));
}

/** 오늘 복습 알림 문구. 오늘 큐가 비었으면 null이다 */
export async function dailyMessage(env: Env, userId: string, now: number): Promise<{ title: string; body: string; url: string } | null> {
  const queue = await loadTodayQueue(env, userId, now);
  if (queue.length === 0) return null;
  const shaky = queue.find((card) => card.state === 3) ?? queue.find((card) => card.state === 1);
  const body = `약 ${estimateMinutes(queue.length)}분이면 끝나요${shaky ? ` · 흔들리는 개념: ${shaky.concept_name}` : ''}`;
  return { title: `오늘 복습 ${queue.length}장`, body, url: '/review?from=push' };
}

interface SlotRow {
  id: string;
  user_id: string;
  local_time: string;
  next_fire_at: number;
}

/** 매분 Cron: 때가 된 알림 시간을 찾아 푸시를 보낸다. 같은 알림을 두 번 보내지 않는다. */
export async function deliverDueReminders(env: Env, now: number): Promise<number> {
  const { results } = await env.DB.prepare(
    `SELECT id, user_id, local_time, next_fire_at FROM reminder_slots
      WHERE enabled = 1 AND next_fire_at <= ?1 ORDER BY next_fire_at LIMIT ?2`,
  )
    .bind(now, PUSH_SLOTS_PER_TICK)
    .all<SlotRow>();
  let delivered = 0;
  for (const slot of results) {
    // 다음 시각으로 먼저 넘긴다. 바뀐 행이 없으면 다른 실행이 처리한 것이다 (최대 한 번 발송)
    const claimed = await env.DB.prepare('UPDATE reminder_slots SET next_fire_at = ?2 WHERE id = ?1 AND next_fire_at = ?3')
      .bind(slot.id, nextKstTime(slot.local_time, now), slot.next_fire_at)
      .run();
    if (claimed.meta.changes !== 1) continue;
    if (now - slot.next_fire_at > STALE_AFTER_MS) {
      console.log(JSON.stringify({ event: 'reminder_stale', user_id: slot.user_id, late_ms: now - slot.next_fire_at }));
      continue;
    }
    try {
      const message = await dailyMessage(env, slot.user_id, now);
      if (!message) continue;
      const result = await pushToUser(env, slot.user_id, { ...message, tag: 'daily' }, now);
      console.log(JSON.stringify({ event: 'reminder_sent', user_id: slot.user_id, ...result }));
      delivered += result.sent;
    } catch (error) {
      // 한 사람의 실패가 같은 실행의 다른 알림과 청소를 막지 않게 한다
      console.error(JSON.stringify({ event: 'reminder_failed', user_id: slot.user_id, message: (error as Error).message }));
    }
  }
  return delivered;
}
