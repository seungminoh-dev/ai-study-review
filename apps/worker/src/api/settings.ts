import { PushEndpointBody, PushSubscriptionBody, RemindersBody, type McpTokenStatus } from '@moai/shared';
import { Hono } from 'hono';
import { listConnectedApps } from '../auth/grants';
import type { AppEnv } from '../context';
import { pushToUser } from '../domain/push';
import { listReminders, replaceReminders } from '../domain/reminders';
import { hashToken, randomToken } from '../lib/crypto';
import { errorJson, readJson } from '../lib/http';

// 설정 화면: 알림 시간, 푸시 구독, 커넥터 URL (설계서 §7.2, §8.6, §10.1)

export const settings = new Hono<AppEnv>();

settings.get('/reminders', async (c) => c.json({ reminders: await listReminders(c.env, c.var.userId) }));

settings.put('/reminders', async (c) => {
  const body = await readJson(c, RemindersBody);
  if (body instanceof Response) return body;
  return c.json({ reminders: await replaceReminders(c.env, c.var.userId, body.times, Date.now()) });
});

settings.get('/push/config', (c) => c.json({ vapid_public_key: c.env.VAPID_PUBLIC_KEY }));

settings.post('/push/subscriptions', async (c) => {
  const body = await readJson(c, PushSubscriptionBody);
  if (body instanceof Response) return body;
  // 같은 기기(endpoint)가 다시 구독하면 키와 주인을 바꾼다
  await c.env.DB.prepare(
    `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
     ON CONFLICT (endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, fail_count = 0`,
  )
    .bind(crypto.randomUUID(), c.var.userId, body.endpoint, body.keys.p256dh, body.keys.auth, Date.now())
    .run();
  return c.body(null, 204);
});

settings.delete('/push/subscriptions', async (c) => {
  const body = await readJson(c, PushEndpointBody);
  if (body instanceof Response) return body;
  await c.env.DB.prepare('DELETE FROM push_subscriptions WHERE user_id = ?1 AND endpoint = ?2').bind(c.var.userId, body.endpoint).run();
  return c.body(null, 204);
});

settings.post('/push/test', async (c) => {
  const result = await pushToUser(
    c.env,
    c.var.userId,
    { title: '모아이 테스트 알림', body: '알림이 잘 와요. 정한 시각에 이렇게 복습을 알려 드려요.', url: '/settings', tag: 'test' },
    Date.now(),
  );
  if (result.sent + result.failed === 0) return errorJson(409, 'no_subscription', '이 기기에서 알림을 먼저 켜 주세요.');
  return c.json(result);
});

/** OAuth로 연결한 앱 (claude.ai, Claude Code 등) */
settings.get('/oauth/apps', async (c) => c.json({ apps: await listConnectedApps(c.env, c.var.userId) }));

/** 연결을 끊는다. 그 앱의 토큰은 바로 쓸 수 없다. 권한은 사용자 id로 묶여 있어 남의 것은 끊지 못한다 */
settings.delete('/oauth/apps/:id', async (c) => {
  const helpers = c.env.OAUTH_PROVIDER;
  if (!helpers) return errorJson(503, 'oauth_unavailable', 'OAuth 설정이 없어요.');
  await helpers.revokeGrant(c.req.param('id'), c.var.userId);
  return c.body(null, 204);
});

settings.get('/mcp-token', async (c) => {
  const row = await c.env.DB.prepare('SELECT created_at, last_used_at FROM mcp_tokens WHERE user_id = ?1 AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1')
    .bind(c.var.userId)
    .first<{ created_at: number; last_used_at: number | null }>();
  const grants = row ? null : await c.env.OAUTH_PROVIDER?.listUserGrants(c.var.userId, { limit: 1 });
  const body: McpTokenStatus = {
    active: row !== null,
    created_at: row?.created_at ?? null,
    last_used_at: row?.last_used_at ?? null,
    connected: row !== null || (grants?.items.length ?? 0) > 0,
  };
  return c.json(body);
});

/** 커넥터 URL을 새로 만든다. 이전 URL은 바로 막힌다. URL은 이 응답에서 한 번만 보여 준다 (설계서 §8.6). */
settings.post('/mcp-token', async (c) => {
  const now = Date.now();
  const token = randomToken();
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE mcp_tokens SET revoked_at = ?2 WHERE user_id = ?1 AND revoked_at IS NULL').bind(c.var.userId, now),
    c.env.DB.prepare('INSERT INTO mcp_tokens (token_hash, user_id, created_at) VALUES (?1, ?2, ?3)').bind(
      await hashToken(c.env.TOKEN_PEPPER, token),
      c.var.userId,
      now,
    ),
  ]);
  return c.json({ url: `${c.env.APP_ORIGIN}/mcp/u/${token}`, created_at: now }, 201);
});

settings.delete('/mcp-token', async (c) => {
  await c.env.DB.prepare('UPDATE mcp_tokens SET revoked_at = ?2 WHERE user_id = ?1 AND revoked_at IS NULL').bind(c.var.userId, Date.now()).run();
  return c.body(null, 204);
});
