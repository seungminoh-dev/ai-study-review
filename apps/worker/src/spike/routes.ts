import { Hono } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { z } from 'zod';
import type { Env } from '../env';
import { randomToken, safeEqual } from '../lib/crypto';
import { errorJson } from '../lib/http';
import { isHhmm, nextKstTime } from '../lib/kst';
import { deliverJob } from './jobs';

// MVP 0 확인 항목 5, 7을 폰에서 직접 확인하는 API (설계서 §2.1). MVP 1에서 지운다.

const COOKIE = '__Host-moai-spike';

const SubscriptionBody = z.object({
  endpoint: z.url({ protocol: /^https$/ }),
  keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
});

const ScheduleBody = z
  .object({
    subscription_id: z.uuid(),
    delay_minutes: z.number().int().min(0).max(180).optional(),
    at_kst: z.string().refine(isHhmm, 'HH:MM 형식이어야 해요').optional(),
  })
  .refine((body) => (body.delay_minutes === undefined) !== (body.at_kst === undefined), 'delay_minutes와 at_kst 중 하나만 보내 주세요');

const AckBody = z.object({ ack: z.string().min(1).max(100), device_received_at: z.number().int().optional() });

export const spike = new Hono<{ Bindings: Env }>();

spike.get('/config', (c) => c.json({ vapidPublicKey: c.env.VAPID_PUBLIC_KEY }));

// 서비스 워커가 푸시를 받았다고 알린다. 푸시에 실어 보낸 일회용 ack 값으로 확인한다.
spike.post('/pushes/:id/ack', async (c) => {
  const parsed = AckBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return errorJson(400, 'invalid_body', '요청 형식이 맞지 않아요.');
  const result = await c.env.DB.prepare(
    'UPDATE spike_push_jobs SET received_at = COALESCE(received_at, ?1), device_received_at = COALESCE(device_received_at, ?2) WHERE id = ?3 AND ack = ?4',
  )
    .bind(Date.now(), parsed.data.device_received_at ?? null, c.req.param('id'), parsed.data.ack)
    .run();
  return result.meta.changes === 1 ? c.body(null, 204) : errorJson(404, 'not_found', '알림을 찾지 못했어요.');
});

// 그 밖의 스파이크 API는 SPIKE_TOKEN을 x-spike-token 헤더로 받는다.
spike.use('*', async (c, next) => {
  const token = c.req.header('x-spike-token') ?? '';
  if (!c.env.SPIKE_TOKEN || !(await safeEqual(token, c.env.SPIKE_TOKEN))) {
    return errorJson(401, 'unauthorized', '스파이크 토큰이 맞지 않아요.');
  }
  await next();
});

spike.post('/subscriptions', async (c) => {
  const parsed = SubscriptionBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return errorJson(400, 'invalid_body', '푸시 구독 형식이 맞지 않아요.');
  const { endpoint, keys } = parsed.data;
  const row = await c.env.DB.prepare(
    `INSERT INTO spike_push_subscriptions (id, endpoint, p256dh, auth, user_agent, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6)
     ON CONFLICT (endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth, user_agent = excluded.user_agent
     RETURNING id`,
  )
    .bind(crypto.randomUUID(), endpoint, keys.p256dh, keys.auth, c.req.header('user-agent') ?? null, Date.now())
    .first<{ id: string }>();
  return c.json({ id: row?.id });
});

spike.post('/pushes', async (c) => {
  const parsed = ScheduleBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return errorJson(400, 'invalid_body', parsed.error.issues[0]?.message ?? '요청 형식이 맞지 않아요.');
  const now = Date.now();
  const { subscription_id, delay_minutes, at_kst } = parsed.data;
  const subscription = await c.env.DB.prepare('SELECT id, endpoint, p256dh, auth FROM spike_push_subscriptions WHERE id = ?1')
    .bind(subscription_id)
    .first<{ id: string; endpoint: string; p256dh: string; auth: string }>();
  if (!subscription) return errorJson(404, 'not_found', '구독을 찾지 못했어요. 알림을 다시 켜 주세요.');

  const fireAt = at_kst ? nextKstTime(at_kst, now) : now + (delay_minutes ?? 0) * 60_000;
  const job = { job_id: crypto.randomUUID(), ack: randomToken(16), fire_at: fireAt, subscription_id, ...subscription };
  await c.env.DB.prepare('INSERT INTO spike_push_jobs (id, subscription_id, ack, fire_at, created_at) VALUES (?1, ?2, ?3, ?4, ?5)')
    .bind(job.job_id, subscription_id, job.ack, fireAt, now)
    .run();
  if (delay_minutes === 0) await deliverJob(c.env, job, now);
  return c.json({ id: job.job_id, fire_at: fireAt }, 201);
});

spike.get('/pushes', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT id, fire_at, sent_at, status_code, error, received_at, device_received_at
       FROM spike_push_jobs ORDER BY created_at DESC LIMIT 20`,
  ).all();
  return c.json({ jobs: results });
});

spike.get('/requests', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT at, http_method, rpc_method, tool_name, protocol_header, protocol_body, user_agent, colo, status, duration_ms
       FROM spike_mcp_requests ORDER BY at DESC LIMIT 30`,
  ).all();
  return c.json({ requests: results });
});

spike.get('/saves', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT id, received_at, topic, counts FROM spike_log ORDER BY received_at DESC LIMIT 20').all();
  return c.json({ saves: results });
});

// 확인 항목 7: Safari에서 심은 쿠키가 홈 화면 앱에도 있는지 본다.
spike.get('/cookie', (c) => {
  const value = getCookie(c, COOKIE);
  return c.json({ present: value !== undefined, value: value ?? null });
});

spike.post('/cookie', (c) => {
  const value = `${new Date().toISOString()}_${randomToken(6)}`;
  setCookie(c, COOKIE, value, { path: '/', secure: true, httpOnly: true, sameSite: 'Lax', maxAge: 60 * 60 * 24 * 30 });
  return c.json({ value });
});
