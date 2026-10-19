import type { MapResponse, StatsResponse } from '@moai/shared';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import example from '../../../packages/shared/fixtures/immutable-object.json';
import { loadStats } from '../src/domain/stats';
import { DAY_MS, studyDayStart } from '../src/lib/kst';
import { api, callTool, mcpUrl, newUser, type TestUser } from './helpers';

// 스트릭 프리즈는 DB에 쓰므로(되돌리지 않는다) 규칙을 확인해 둔다.

let user: TestUser;
beforeEach(async () => {
  user = await newUser();
});

/** day일 전 하루에 n장 복습한 기록을 넣는다 */
async function reviewedOn(cardId: string, daysAgo: number, n: number, now: number) {
  const at = studyDayStart(now) - daysAgo * DAY_MS + 3_600_000;
  for (let i = 0; i < n; i++) {
    await env.DB.prepare("INSERT INTO review_logs (id, user_id, card_id, grade, reviewed_at, prev_card) VALUES (?1, ?2, ?3, 3, ?4, '{}')")
      .bind(crypto.randomUUID(), user.id, cardId, at + i)
      .run();
  }
}

describe('streak', () => {
  it('counts goal days, bridges one missed day a week with a freeze, and stops at a second miss', async () => {
    await callTool(await mcpUrl(user), 'save_learning', example);
    const card = await env.DB.prepare('SELECT id FROM cards WHERE user_id = ?1 LIMIT 1').bind(user.id).first<string>('id');
    await env.DB.prepare('UPDATE users SET daily_goal = 2 WHERE id = ?1').bind(user.id).run();
    // 2026-10-14(수) 기준: 오늘 아직 안 함, 어제 함, 그제 빠짐(프리즈), 3일 전 함, 4·5일 전 빠짐 (프리즈를 이미 썼거나 앞날이 없음)
    const now = Date.UTC(2026, 9, 14, 3, 0); // 12:00 KST
    await reviewedOn(card!, 1, 2, now);
    await reviewedOn(card!, 3, 2, now);
    await reviewedOn(card!, 6, 2, now);
    const stats = await loadStats(env, user.id, now);
    expect(stats.streak).toBe(2);
    const freezes = await env.DB.prepare('SELECT day FROM streak_freezes WHERE user_id = ?1').bind(user.id).all<{ day: string }>();
    expect(freezes.results.map((row) => row.day)).toEqual(['2026-10-12']);
    // 다시 세도 프리즈는 하나다
    expect((await loadStats(env, user.id, now)).streak).toBe(2);
    expect((await env.DB.prepare('SELECT count(*) AS n FROM streak_freezes WHERE user_id = ?1').bind(user.id).first('n'))).toBe(1);
  });

  it('gives XP for answers and saved sessions, and lets me change the goal', async () => {
    await callTool(await mcpUrl(user), 'save_learning', example);
    const stats = (await (await api(user, '/stats')).json()) as StatsResponse;
    expect(stats.today.xp).toBe(30);
    expect((await api(user, '/goal', { method: 'PUT', json: { daily_goal: 0 } })).status).toBe(400);
    expect(await (await api(user, '/goal', { method: 'PUT', json: { daily_goal: 10 } })).json()).toEqual({ daily_goal: 10 });
  });

  it('gives a perfect bonus only to a run of 5 or more answers with no miss', async () => {
    await callTool(await mcpUrl(user), 'save_learning', example);
    const card = await env.DB.prepare("SELECT id FROM cards WHERE user_id = ?1 AND type != 'explain' LIMIT 1").bind(user.id).first<string>('id');
    const now = Date.now();
    const run = async (grades: number[]) => {
      const runId = crypto.randomUUID();
      for (const [i, grade] of grades.entries()) {
        await env.DB.prepare("INSERT INTO review_logs (id, user_id, card_id, grade, reviewed_at, prev_card, run_id) VALUES (?1, ?2, ?3, ?4, ?5, '{}', ?6)")
          .bind(crypto.randomUUID(), user.id, card, grade, studyDayStart(now) + 1000 + i, runId)
          .run();
      }
    };
    await run([3, 3, 2, 3, 3]); // 무실수: 50 + 보너스 10
    await run([3, 3, 1, 3, 3]); // 하나 틀림: 42
    await run([3, 3, 3, 3]); // 4장뿐: 40
    // 저장 30
    expect((await loadStats(env, user.id, now)).today.xp).toBe(30 + 60 + 42 + 40);
  });
});

// 배지는 처음 이룬 것만 DB에 넣는다 (되돌리지 않는다)
describe('badges', () => {
  const byId = (stats: StatsResponse) => new Map(stats.badges.map((badge) => [badge.id, badge]));
  const firstCard = () => env.DB.prepare('SELECT id FROM cards WHERE user_id = ?1 LIMIT 1').bind(user.id).first<string>('id');

  it('records a badge once at the moment it was reached, including ones reached before', async () => {
    await callTool(await mcpUrl(user), 'save_learning', example);
    const now = Date.now();
    // 열흘 전의 첫 복습은 그날로 채운다
    await reviewedOn((await firstCard())!, 10, 1, now);
    const first = byId(await loadStats(env, user.id, now));
    expect(first.get('first_save')).toMatchObject({ earned_at: expect.any(Number), value: 1, target: 1 });
    expect(first.get('first_review')).toMatchObject({ earned_at: studyDayStart(now) - 10 * DAY_MS + 3_600_000 });
    expect(first.get('reviews_100')).toEqual({ id: 'reviews_100', earned_at: null, value: 1, target: 100 });

    const again = byId(await loadStats(env, user.id, now));
    expect(again.get('first_save')!.earned_at).toBe(first.get('first_save')!.earned_at);
    expect(await env.DB.prepare('SELECT count(*) AS n FROM badges WHERE user_id = ?1').bind(user.id).first('n')).toBe(2);
  });

  it('keeps a streak badge after the daily goal goes up', async () => {
    await callTool(await mcpUrl(user), 'save_learning', example);
    const card = (await firstCard())!;
    await env.DB.prepare('UPDATE users SET daily_goal = 1 WHERE id = ?1').bind(user.id).run();
    const now = Date.UTC(2026, 9, 14, 3, 0); // 12:00 KST
    for (const daysAgo of [2, 1, 0]) await reviewedOn(card, daysAgo, 1, now);
    expect(byId(await loadStats(env, user.id, now)).get('streak_3')).toMatchObject({ earned_at: studyDayStart(now), value: 3 });

    await env.DB.prepare('UPDATE users SET daily_goal = 10 WHERE id = ?1').bind(user.id).run();
    // 목표를 올리면 지난날은 목표를 못 채운 날이 되지만, 받은 배지는 남는다
    expect(byId(await loadStats(env, user.id, now)).get('streak_3')).toMatchObject({ earned_at: studyDayStart(now), value: 0 });
  });
});

describe('map', () => {
  it('shows my concepts with states and edges, and a continue prompt for each concept', async () => {
    await callTool(await mcpUrl(user), 'save_learning', example);
    const map = (await (await api(user, '/map')).json()) as MapResponse;
    expect(map.nodes.length).toBeGreaterThan(0);
    expect(new Set(map.nodes.map((node) => node.state)).has('shaky')).toBe(true);
    const detail = await (await api(user, '/concepts/deep-copy')).json();
    expect(detail).toMatchObject({ key: 'deep-copy', continue_prompt: expect.stringMatching(/^\[모아이:deep-copy\] /) });
    expect((await api(await newUser(), '/concepts/deep-copy')).status).toBe(404);
  });
});
