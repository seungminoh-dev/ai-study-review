import { buildPushPayload } from '@block65/webcrypto-web-push';
import type { Env } from '../env';

export interface StoredSubscription {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushData {
  title: string;
  body: string;
  url: string;
  tag?: string;
  job_id?: string;
  ack?: string;
}

/** 웹 푸시 1건을 보내고 푸시 서비스의 응답 코드를 돌려준다 (설계서 §10.2). */
export async function sendPush(env: Env, subscription: StoredSubscription, data: PushData): Promise<number> {
  const payload = await buildPushPayload(
    { data: { ...data }, options: { ttl: 4 * 60 * 60, urgency: 'normal' } },
    { endpoint: subscription.endpoint, expirationTime: null, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
    { subject: env.VAPID_SUBJECT, publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY },
  );
  const response = await fetch(subscription.endpoint, payload);
  return response.status;
}

/** 404·410은 구독이 사라졌다는 뜻이라 지운다. */
export function isGone(status: number): boolean {
  return status === 404 || status === 410;
}
