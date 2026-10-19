import type { McpTokenStatus, Reminder } from '@moai/shared';
import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextKstTime } from '../src/lib/kst';
import { api, fakeSubscription, newUser, type TestUser } from './helpers';

let user: TestUser;

beforeEach(async () => {
  user = await newUser();
});
afterEach(() => vi.restoreAllMocks());

describe('reminders', () => {
  it('replaces the reminder times and computes the next fire time in KST', async () => {
    const before = Date.now();
    const response = await api(user, '/reminders', { method: 'PUT', json: { times: ['22:30', '08:10'] } });
    const { reminders } = (await response.json()) as { reminders: Reminder[] };
    expect(reminders.map((reminder) => reminder.local_time)).toEqual(['08:10', '22:30']);
    for (const reminder of reminders) {
      expect([nextKstTime(reminder.local_time, before), nextKstTime(reminder.local_time, Date.now())]).toContain(reminder.next_fire_at);
    }
    await api(user, '/reminders', { method: 'PUT', json: { times: ['07:00'] } });
    const listed = (await (await api(user, '/reminders')).json()) as { reminders: Reminder[] };
    expect(listed.reminders.map((reminder) => reminder.local_time)).toEqual(['07:00']);
  });

  it('rejects bad times, duplicates and more than three', async () => {
    for (const times of [['24:00'], ['08:10', '08:10'], ['07:00', '08:00', '09:00', '10:00']]) {
      expect((await api(user, '/reminders', { method: 'PUT', json: { times } })).status).toBe(400);
    }
  });
});

describe('push subscriptions', () => {
  it('stores a subscription, sends a test push and forgets a gone one', async () => {
    expect((await api(user, '/push/test', { method: 'POST' })).status).toBe(409);
    const subscription = await fakeSubscription();
    expect((await api(user, '/push/subscriptions', { method: 'POST', json: subscription })).status).toBe(204);
    // 같은 기기가 다시 구독해도 한 줄이다
    expect((await api(user, '/push/subscriptions', { method: 'POST', json: subscription })).status).toBe(204);

    const push = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 201 }));
    expect(await (await api(user, '/push/test', { method: 'POST' })).json()).toEqual({ sent: 1, failed: 0 });
    const [url, init] = push.mock.calls[0]!;
    expect(url).toBe(subscription.endpoint);
    expect((init as RequestInit & { headers: Record<string, string> }).headers['content-encoding']).toBe('aes128gcm');

    push.mockResolvedValue(new Response(null, { status: 410 }));
    expect(await (await api(user, '/push/test', { method: 'POST' })).json()).toEqual({ sent: 0, failed: 1 });
    const rows = await env.DB.prepare('SELECT count(*) AS n FROM push_subscriptions WHERE user_id = ?1').bind(user.id).first('n');
    expect(rows).toBe(0);
  });

  it('removes a subscription on request', async () => {
    const subscription = await fakeSubscription();
    await api(user, '/push/subscriptions', { method: 'POST', json: subscription });
    expect((await api(user, '/push/subscriptions', { method: 'DELETE', json: { endpoint: subscription.endpoint } })).status).toBe(204);
    expect((await api(user, '/push/test', { method: 'POST' })).status).toBe(409);
  });

  it('counts a subscription it cannot encrypt for as a failure instead of crashing', async () => {
    await env.DB.prepare("INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, created_at) VALUES (?1, ?2, 'https://push.example/bad', 'AAAA', 'BBBB', 0)")
      .bind(crypto.randomUUID(), user.id)
      .run();
    expect(await (await api(user, '/push/test', { method: 'POST' })).json()).toEqual({ sent: 0, failed: 1 });
    expect(await env.DB.prepare('SELECT fail_count FROM push_subscriptions WHERE user_id = ?1').bind(user.id).first('fail_count')).toBe(1);
  });

  it('rejects push keys of the wrong size', async () => {
    const subscription = await fakeSubscription();
    expect((await api(user, '/push/subscriptions', { method: 'POST', json: { ...subscription, keys: { ...subscription.keys, p256dh: 'AAAA' } } })).status).toBe(400);
  });

  it('only accepts https push endpoints', async () => {
    const subscription = await fakeSubscription('http://push.example/x');
    expect((await api(user, '/push/subscriptions', { method: 'POST', json: subscription })).status).toBe(400);
  });

  it('gives the VAPID public key to the app', async () => {
    expect(await (await api(user, '/push/config')).json()).toEqual({ vapid_public_key: env.VAPID_PUBLIC_KEY });
  });
});

describe('connector URL', () => {
  it('issues, reissues and revokes the URL', async () => {
    expect(await (await api(user, '/mcp-token')).json()).toEqual({ active: false, created_at: null, connected: false });
    const issued = (await (await api(user, '/mcp-token', { method: 'POST' })).json()) as { url: string };
    expect(issued.url).toMatch(/^https:\/\/moai\.test\/mcp\/u\/[\w-]{43}$/);
    expect(((await (await api(user, '/mcp-token')).json()) as McpTokenStatus).active).toBe(true);
    // 토큰 원문은 DB에 없다
    const stored = await env.DB.prepare('SELECT token_hash FROM mcp_tokens WHERE user_id = ?1').bind(user.id).first<{ token_hash: string }>();
    expect(issued.url.endsWith(stored!.token_hash)).toBe(false);

    await api(user, '/mcp-token', { method: 'DELETE' });
    expect(((await (await api(user, '/mcp-token')).json()) as McpTokenStatus).active).toBe(false);
  });
});

// 주간 설문은 답을 저장한다 (기획서 §13)
describe('weekly survey', () => {
  it('asks people who joined 3+ days ago once a week and shows answers to the owner', async () => {
    expect(await (await api(user, '/survey')).json()).toMatchObject({ ask: false });
    await env.DB.prepare('UPDATE users SET created_at = ?2 WHERE id = ?1').bind(user.id, Date.now() - 4 * 86_400_000).run();
    const status = (await (await api(user, '/survey')).json()) as { week: string; ask: boolean };
    expect(status.ask).toBe(true);
    expect(status.week).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect((await api(user, '/survey', { method: 'PUT', json: { used: 'yes' } })).status).toBe(400);
    expect((await api(user, '/survey', { method: 'PUT', json: { used: true, note: '트랜잭션 전파' } })).status).toBe(204);
    expect(await (await api(user, '/survey')).json()).toMatchObject({ ask: false });

    const owner = await newUser('오너', 'owner');
    const metrics = (await (await api(owner, '/admin/metrics')).json()) as {
      survey: { week: string; answered: number; used: number; notes: string[] }[];
      retention_14d: { eligible: number; retained: number };
      first_review: { saved: number; reviewed: number };
      accuracy: { second: number | null; fifth: number | null };
    };
    expect(metrics.survey[0]).toMatchObject({ week: status.week, answered: 1, used: 1, notes: ['트랜잭션 전파'] });
    expect(metrics.survey).toHaveLength(4);
    expect(metrics.retention_14d).toEqual({ eligible: expect.any(Number), retained: expect.any(Number) });
    expect(metrics.first_review).toEqual({ saved: expect.any(Number), reviewed: expect.any(Number) });
  });
});
