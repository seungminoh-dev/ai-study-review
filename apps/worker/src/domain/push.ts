import { buildPushPayload } from '@block65/webcrypto-web-push';
import type { Env } from '../env';

// 웹 푸시 발송 (설계서 §10.2)

export interface PushData {
  title: string;
  body: string;
  url: string;
  tag?: string;
}

interface SubscriptionRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  fail_count: number;
}

/** 이만큼 연속으로 실패하면 구독을 지운다 */
const MAX_FAILURES = 5;
/** 폰이 꺼져 있어도 4시간 안에 켜지면 받는다. 빼면 라이브러리 기본값 60초로 보낸다 */
const TTL_SECONDS = 4 * 60 * 60;

/** 푸시 서비스의 응답 코드. 암호화나 네트워크에서 실패하면 0이다 (실패 한 번으로 센다) */
async function send(env: Env, subscription: SubscriptionRow, data: PushData): Promise<number> {
  try {
    const payload = await buildPushPayload(
      { data: { ...data }, options: { ttl: TTL_SECONDS, urgency: 'normal' } },
      { endpoint: subscription.endpoint, expirationTime: null, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
      { subject: env.VAPID_SUBJECT, publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY },
    );
    return (await fetch(subscription.endpoint, payload)).status;
  } catch (error) {
    console.error(JSON.stringify({ event: 'push_failed', subscription_id: subscription.id, message: (error as Error).message }));
    return 0;
  }
}

/**
 * 사용자의 모든 구독(기기)에 보낸다. 201·200이면 성공, 404·410이면 구독이 사라진 것이라 지운다.
 * 그 밖의 실패는 횟수를 세고 5번 연속이면 지운다.
 */
export async function pushToUser(env: Env, userId: string, data: PushData, now: number): Promise<{ sent: number; failed: number }> {
  const { results } = await env.DB.prepare('SELECT id, endpoint, p256dh, auth, fail_count FROM push_subscriptions WHERE user_id = ?1')
    .bind(userId)
    .all<SubscriptionRow>();
  const statuses = await Promise.all(results.map((subscription) => send(env, subscription, data)));
  const updates: D1PreparedStatement[] = [];
  let sent = 0;
  results.forEach((subscription, index) => {
    const status = statuses[index]!;
    if (status >= 200 && status < 300) {
      sent += 1;
      updates.push(env.DB.prepare('UPDATE push_subscriptions SET last_ok_at = ?2, fail_count = 0 WHERE id = ?1').bind(subscription.id, now));
    } else if (status === 404 || status === 410 || subscription.fail_count + 1 >= MAX_FAILURES) {
      updates.push(env.DB.prepare('DELETE FROM push_subscriptions WHERE id = ?1').bind(subscription.id));
    } else {
      updates.push(env.DB.prepare('UPDATE push_subscriptions SET fail_count = fail_count + 1 WHERE id = ?1').bind(subscription.id));
    }
  });
  if (updates.length > 0) await env.DB.batch(updates);
  return { sent, failed: results.length - sent };
}
