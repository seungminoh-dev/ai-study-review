import { estimateMinutes, type Reminder } from '@moai/shared';
import type { Env } from '../env';
import { nextKstTime } from '../lib/kst';
import { raiseAlert } from './alerts';
import { pushToUser } from './push';
import { lastWrong, loadTodayQueue } from './queue';

// 리마인드 (설계서 §10)

/** 한 번의 Cron 실행에서 처리하는 알림 시간 수. 같은 분에 몰려도 1분에 이만큼씩 나간다 (오늘 큐 계산이 있어 CPU 1초 안에 들게 둔다) */
export const PUSH_SLOTS_PER_TICK = 20;
/** 한 번에 나란히 보내는 수. 푸시 서버 응답을 기다리는 시간이 겹치게 한다 */
const PUSH_CONCURRENCY = 5;
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
  // 흔들리는 개념: 오늘 볼 카드 중 마지막에 틀린 것 (학습 단계를 끈 뒤로는 state로 알 수 없다)
  const wrong = await lastWrong(env, userId, queue.map((card) => card.id));
  const shaky = queue.find((card) => wrong.has(card.id));
  const body = `약 ${estimateMinutes(queue.length)}분이면 끝나요${shaky ? ` · 흔들리는 개념: ${shaky.concept_name}` : ''}`;
  return { title: `오늘 복습 ${queue.length}장`, body, url: '/review?from=push' };
}

interface SlotRow {
  id: string;
  user_id: string;
  local_time: string;
  next_fire_at: number;
}

/** 알림 시간 하나를 처리한다. 보낸 기기 수를 돌려준다 */
async function deliverSlot(env: Env, slot: SlotRow, now: number): Promise<number> {
  // 다음 시각으로 먼저 넘긴다. 바뀐 행이 없으면 다른 실행이 처리한 것이다 (최대 한 번 발송)
  const claimed = await env.DB.prepare('UPDATE reminder_slots SET next_fire_at = ?2 WHERE id = ?1 AND next_fire_at = ?3')
    .bind(slot.id, nextKstTime(slot.local_time, now), slot.next_fire_at)
    .run();
  if (claimed.meta.changes !== 1) return 0;
  const late = now - slot.next_fire_at;
  if (late > STALE_AFTER_MS) {
    console.log(JSON.stringify({ event: 'reminder_stale', user_id: slot.user_id, late_ms: late }));
    await raiseAlert(env, 'reminder_late');
    return 0;
  }
  try {
    const message = await dailyMessage(env, slot.user_id, now);
    if (!message) return 0;
    const result = await pushToUser(env, slot.user_id, { ...message, tag: 'daily' }, now);
    console.log(JSON.stringify({ event: 'reminder_sent', user_id: slot.user_id, late_ms: late, ...result }));
    return result.sent;
  } catch (error) {
    // 한 사람의 실패가 같은 실행의 다른 알림과 청소를 막지 않게 한다
    console.error(JSON.stringify({ event: 'reminder_failed', user_id: slot.user_id, message: (error as Error).message }));
    return 0;
  }
}

/**
 * 매분 Cron: 때가 된 알림 시간을 찾아 푸시를 보낸다. 같은 알림을 두 번 보내지 않는다.
 * 푸시 구독이 없는 사람은 차례를 차지하지 않게 뺀다 (구독하면 다음 때부터 나간다. 오래 밀린 시각은 늦은 알림으로 보고 넘긴다)
 */
export async function deliverDueReminders(env: Env, now: number): Promise<number> {
  const { results } = await env.DB.prepare(
    `SELECT id, user_id, local_time, next_fire_at FROM reminder_slots s
      WHERE enabled = 1 AND next_fire_at <= ?1 AND EXISTS (SELECT 1 FROM push_subscriptions p WHERE p.user_id = s.user_id)
      ORDER BY next_fire_at LIMIT ?2`,
  )
    .bind(now, PUSH_SLOTS_PER_TICK)
    .all<SlotRow>();
  let delivered = 0;
  for (let index = 0; index < results.length; index += PUSH_CONCURRENCY) {
    const sent = await Promise.all(results.slice(index, index + PUSH_CONCURRENCY).map((slot) => deliverSlot(env, slot, now)));
    delivered += sent.reduce((sum, count) => sum + count, 0);
  }
  return delivered;
}
