import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runCron } from '../src/cron';
import { nextKstTime } from '../src/lib/kst';
import { ORIGIN, TOKEN, workerFetch } from './helpers';

const b64url = (bytes: ArrayBuffer | Uint8Array) => {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return btoa(String.fromCharCode(...view)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
};

/** 브라우저가 만드는 것과 같은 모양의 푸시 구독 (P-256 공개 키, 16바이트 auth). */
async function fakeSubscription(endpoint = `https://push.example/${crypto.randomUUID()}`) {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
  const raw = (await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer;
  return { endpoint, keys: { p256dh: b64url(raw), auth: b64url(crypto.getRandomValues(new Uint8Array(16))) } };
}

const api = (path: string, init: RequestInit = {}) =>
  workerFetch(`${ORIGIN}/api/spike${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', 'x-spike-token': TOKEN, ...(init.headers ?? {}) },
  });

async function subscribe(endpoint?: string): Promise<{ id: string; endpoint: string }> {
  const subscription = await fakeSubscription(endpoint);
  const response = await api('/subscriptions', { method: 'POST', body: JSON.stringify(subscription) });
  expect(response.status).toBe(200);
  const { id } = (await response.json()) as { id: string };
  return { id, endpoint: subscription.endpoint };
}

async function schedule(body: Record<string, unknown>): Promise<{ id: string; fire_at: number }> {
  const response = await api('/pushes', { method: 'POST', body: JSON.stringify(body) });
  expect(response.status).toBe(201);
  return response.json();
}

const job = (id: string) => env.DB.prepare('SELECT * FROM spike_push_jobs WHERE id = ?1').bind(id).first<Record<string, unknown>>();

afterEach(() => vi.restoreAllMocks());

describe('spike push', () => {
  it('requires the spike token', async () => {
    const response = await workerFetch(`${ORIGIN}/api/spike/pushes`);
    expect(response.status).toBe(401);
  });

  it('sends a scheduled push once, after its time', async () => {
    const push = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 201 }));
    const subscription = await subscribe();
    const scheduled = await schedule({ subscription_id: subscription.id, delay_minutes: 1 });

    await runCron(env, scheduled.fire_at - 1);
    expect(push).not.toHaveBeenCalled();

    await runCron(env, scheduled.fire_at + 1_000);
    await runCron(env, scheduled.fire_at + 61_000);
    expect(push).toHaveBeenCalledTimes(1);
    const [url, init] = push.mock.calls[0]!;
    expect(url).toBe(subscription.endpoint);
    expect((init as RequestInit & { headers: Record<string, string> }).headers['content-encoding']).toBe('aes128gcm');
    expect(await job(scheduled.id)).toMatchObject({ status_code: 201, error: null });
  });

  it('skips a push that is more than 30 minutes late', async () => {
    const push = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 201 }));
    const subscription = await subscribe();
    const scheduled = await schedule({ subscription_id: subscription.id, delay_minutes: 1 });
    await runCron(env, scheduled.fire_at + 31 * 60_000);
    expect(push).not.toHaveBeenCalled();
    expect(await job(scheduled.id)).toMatchObject({ error: 'stale' });
  });

  it('deletes a subscription the push service says is gone', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 410 }));
    const subscription = await subscribe();
    const scheduled = await schedule({ subscription_id: subscription.id, delay_minutes: 0 });
    expect(await job(scheduled.id)).toMatchObject({ status_code: 410 });
    const row = await env.DB.prepare('SELECT id FROM spike_push_subscriptions WHERE id = ?1').bind(subscription.id).first();
    expect(row).toBeNull();
  });

  it('schedules by KST wall-clock time', async () => {
    const subscription = await subscribe();
    const before = Date.now();
    const scheduled = await schedule({ subscription_id: subscription.id, at_kst: '08:10' });
    const expected = nextKstTime('08:10', before);
    expect(Math.abs(scheduled.fire_at - expected)).toBeLessThanOrEqual(60_000);
  });

  it('records the delivery ack from the service worker', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 201 }));
    const subscription = await subscribe();
    const scheduled = await schedule({ subscription_id: subscription.id, delay_minutes: 1 });
    const { ack } = (await job(scheduled.id)) as { ack: string };

    const wrong = await workerFetch(`${ORIGIN}/api/spike/pushes/${scheduled.id}/ack`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ack: 'nope' }),
    });
    expect(wrong.status).toBe(404);
    const right = await workerFetch(`${ORIGIN}/api/spike/pushes/${scheduled.id}/ack`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ack, device_received_at: 123 }),
    });
    expect(right.status).toBe(204);
    expect(await job(scheduled.id)).toMatchObject({ device_received_at: 123 });
  });

  it('rejects a state change from a foreign Origin', async () => {
    const response = await api('/cookie', { method: 'POST', headers: { origin: 'https://evil.example' } });
    expect(response.status).toBe(403);
  });
});

describe('spike cookie', () => {
  it('sets a cookie and reads it back', async () => {
    const set = await api('/cookie', { method: 'POST' });
    const cookie = set.headers.get('set-cookie') ?? '';
    expect(cookie).toContain('__Host-moai-spike=');
    expect(cookie).toContain('HttpOnly');
    const read = await api('/cookie', { headers: { cookie: cookie.split(';')[0]! } });
    expect(await read.json()).toMatchObject({ present: true });
  });
});
