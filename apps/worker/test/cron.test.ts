import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import example from '../../../packages/shared/fixtures/immutable-object.json';
import { runCron } from '../src/cron';
import { ALERT_QUIET_MS, raiseAlert } from '../src/domain/alerts';
import { hashToken, randomToken } from '../src/lib/crypto';
import { nextKstTime } from '../src/lib/kst';
import { ORIGIN, api, callTool, fakeSubscription, mcpUrl, newUser, workerFetch, type TestUser } from './helpers';

let user: TestUser;

/** 매분 Cron은 정각에 돈다. 테스트에서도 분 단위 시각을 쓴다 */
const minute = (ms: number) => Math.floor(ms / 60_000) * 60_000;

async function slotAt(fireAt: number, localTime = '08:10'): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare('INSERT INTO reminder_slots (id, user_id, local_time, enabled, next_fire_at) VALUES (?1, ?2, ?3, 1, ?4)')
    .bind(id, user.id, localTime, fireAt)
    .run();
  return id;
}

const slot = (id: string) => env.DB.prepare('SELECT next_fire_at FROM reminder_slots WHERE id = ?1').bind(id).first<{ next_fire_at: number }>();

beforeEach(async () => {
  user = await newUser();
  await api(user, '/push/subscriptions', { method: 'POST', json: await fakeSubscription() });
});
afterEach(() => vi.restoreAllMocks());

describe('reminder cron', () => {
  it('sends the daily reminder once and moves the slot to the next day', async () => {
    await callTool(await mcpUrl(user), 'save_learning', example);
    const push = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 201 }));
    const now = minute(Date.now()) + 60_000;
    const id = await slotAt(now - 1_000);

    await runCron(env, now);
    await runCron(env, now);
    expect(push).toHaveBeenCalledTimes(1);
    expect((await slot(id))!.next_fire_at).toBe(nextKstTime('08:10', now));
    const ok = await env.DB.prepare('SELECT last_ok_at, fail_count FROM push_subscriptions WHERE user_id = ?1').bind(user.id).first();
    expect(ok).toEqual({ last_ok_at: now, fail_count: 0 });
  });

  it('skips a reminder that is more than 30 minutes late, and one with nothing to review', async () => {
    const push = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 201 }));
    const now = minute(Date.now()) + 60_000;
    const empty = await slotAt(now - 1_000);
    await runCron(env, now);
    expect(push).not.toHaveBeenCalled();
    expect((await slot(empty))!.next_fire_at).toBeGreaterThan(now);

    await callTool(await mcpUrl(user), 'save_learning', example);
    const stale = await slotAt(now - 31 * 60_000, '07:30');
    await runCron(env, now);
    expect(push).not.toHaveBeenCalled();
    expect((await slot(stale))!.next_fire_at).toBe(nextKstTime('07:30', now));
  });

  it('drops a subscription after five failures in a row', async () => {
    await callTool(await mcpUrl(user), 'save_learning', example);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 500 }));
    const now = minute(Date.now()) + 60_000;
    for (let i = 0; i < 5; i++) {
      await slotAt(now - 1_000 - i);
      await runCron(env, now);
    }
    const rows = await env.DB.prepare('SELECT count(*) AS n FROM push_subscriptions WHERE user_id = ?1').bind(user.id).first('n');
    expect(rows).toBe(0);
  });
});

describe('hourly cleanup', () => {
  it('removes expired login sessions at the top of the hour', async () => {
    const hash = await hashToken(env.TOKEN_PEPPER, randomToken());
    await env.DB.prepare('INSERT INTO auth_sessions (token_hash, user_id, created_at, last_seen_at, expires_at) VALUES (?1, ?2, 0, 0, 1)')
      .bind(hash, user.id)
      .run();
    const exists = () => env.DB.prepare('SELECT 1 AS ok FROM auth_sessions WHERE token_hash = ?1').bind(hash).first();
    await runCron(env, Date.parse('2026-10-18T03:05:00Z'));
    expect(await exists()).not.toBeNull();
    await runCron(env, Date.parse('2026-10-18T04:00:00Z'));
    expect(await exists()).toBeNull();
  });
});

describe('owner alerts', () => {
  it('pushes each kind to the owner at most once an hour', async () => {
    await env.DB.prepare('DELETE FROM alerts').run();
    const owner = await newUser('오너', 'owner');
    const subscription = await fakeSubscription();
    await api(owner, '/push/subscriptions', { method: 'POST', json: subscription });
    const push = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 201 }));
    const toOwner = () => push.mock.calls.filter(([input]) => String(input) === subscription.endpoint).length;

    for (let i = 0; i < 3; i++) await raiseAlert(env, 'server_error');
    const now = minute(Date.now()) + 60_000;
    await runCron(env, now);
    expect(toOwner()).toBe(1);
    // 한 시간 안에 또 생기면 모아 두었다가 한 시간이 지나야 보낸다
    await raiseAlert(env, 'server_error');
    await runCron(env, now + 60_000);
    expect(toOwner()).toBe(1);
    await runCron(env, now + ALERT_QUIET_MS);
    expect(toOwner()).toBe(2);
    // 보낼 것이 없으면 보내지 않는다
    await runCron(env, now + 2 * ALERT_QUIET_MS);
    expect(toOwner()).toBe(2);
  });
});

describe('health', () => {
  it('answers 503 when D1 is fine but the minute cron stopped', async () => {
    const health = () => workerFetch(`${ORIGIN}/api/health`);
    const setBeat = (at: number) => env.DB.prepare("UPDATE alerts SET last_sent_at = ?1 WHERE kind = 'cron_heartbeat'").bind(at).run();
    await env.DB.prepare("DELETE FROM alerts WHERE kind = 'cron_heartbeat'").run();
    // 막 배포해서 표시가 아직 없으면 Cron은 따지지 않는다
    expect((await health()).status).toBe(200);
    await runCron(env, Date.now());
    expect(await (await health()).json()).toMatchObject({ ok: true, db: true, cron: true });
    await setBeat(Date.now() - 10 * 60_000);
    const stale = await health();
    expect(stale.status).toBe(503);
    expect(await stale.json()).toMatchObject({ ok: false, db: true, cron: false });
    await env.DB.prepare("DELETE FROM alerts WHERE kind = 'cron_heartbeat'").run();
  });
});
