import { ReviewItem, ReviewsBody, estimateMinutes, normalizeCategory, type OpenFollowup, type QueueResponse, type SessionSummary, type TodayResponse } from '@moai/shared';
import { Hono } from 'hono';
import type { AppEnv } from '../context';
import { countLastWrong, countReviewedToday, loadMaterialQueue, loadMistakes, loadRandom, loadTodayQueue } from '../domain/queue';
import { recordReviews } from '../domain/reviews';
import { loadMe } from '../domain/users';
import { errorJson, readJson } from '../lib/http';
import { listSessions } from './sessions';

// 오늘 화면과 복습 (설계서 §7.2, §9)

export const review = new Hono<AppEnv>();

review.get('/me', async (c) => c.json(await loadMe(c.env, c.var.userId)));

review.get('/today', async (c) => {
  const now = Date.now();
  const userId = c.var.userId;
  const [queue, reviewedToday, sessions, rest, mistakes] = await Promise.all([
    loadTodayQueue(c.env, userId, now),
    countReviewedToday(c.env, userId, now),
    listSessions(c.env, userId, 3),
    c.env.DB.batch([
      // 같은 질문을 여러 세션에서 저장했으면 한 번만 보여 준다
      c.env.DB.prepare(
        `SELECT max(f.id) AS id, f.question, max(f.created_at) AS created_at, k.name AS concept_name
           FROM followups f JOIN concepts k ON k.id = f.concept_id
          WHERE f.user_id = ?1 AND f.resolved_at IS NULL
          GROUP BY f.concept_id, f.question ORDER BY created_at DESC LIMIT 5`,
      ).bind(userId),
      c.env.DB.prepare('SELECT count(*) AS n FROM reminder_slots WHERE user_id = ?1 AND enabled = 1').bind(userId),
      c.env.DB.prepare('SELECT count(*) AS n FROM push_subscriptions WHERE user_id = ?1').bind(userId),
    ]),
    loadMistakes(c.env, userId, now, 0),
  ]);
  const [followups, reminders, subscriptions] = rest;
  const remindersSet = ((reminders!.results[0] as { n: number } | undefined)?.n ?? 0) > 0;
  const body: TodayResponse = {
    remaining: queue.length,
    minutes: estimateMinutes(queue.length),
    parts: {
      wrong: await countLastWrong(c.env, userId, queue.map((card) => card.id)),
      fresh: queue.filter((card) => card.state === 0).length,
    },
    mistakes: mistakes.remaining,
    reviewed_today: reviewedToday,
    sessions: sessions satisfies SessionSummary[],
    followups: followups!.results as unknown as OpenFollowup[],
    reminders_set: remindersSet,
    // 알림 시간은 있는데 어느 기기에도 구독이 없다: 서버가 끊긴 구독을 지웠거나 기기를 바꿨다
    push_lost: remindersSet && ((subscriptions!.results[0] as { n: number } | undefined)?.n ?? 0) === 0,
  };
  return c.json(body);
});

/**
 * ?category=분류 경로: 그 분류만 복습. ?material=자료 제목: 그 자료 풀기 (아직 안 푼 자료 카드 포함), &part=섹션 이름이면 그 섹션만.
 * ?mode=mistakes: 틀린 것만 (domain/queue.ts의 loadMistakes). ?mode=random: 랜덤 시험 (푼 카드에서, category·material·part로 좁힌다)
 */
/** 다음에 볼 질문을 닫는다 (오늘 화면의 ✓). 내 질문만 */
review.patch('/followups/:id', async (c) => {
  const { meta } = await c.env.DB.prepare('UPDATE followups SET resolved_at = ?3 WHERE id = ?1 AND user_id = ?2 AND resolved_at IS NULL')
    .bind(c.req.param('id'), c.var.userId, Date.now())
    .run();
  return meta.changes > 0 ? c.body(null, 204) : errorJson(404, 'not_found', '질문을 찾지 못했어요.');
});

review.get('/queue', async (c) => {
  const size = Math.min(Math.max(Number.parseInt(c.req.query('size') ?? '8', 10) || 8, 1), 20);
  const now = Date.now();
  if (c.req.query('mode') === 'mistakes') return c.json((await loadMistakes(c.env, c.var.userId, now, size)) satisfies QueueResponse);
  if (c.req.query('mode') === 'random') {
    const scope = {
      category: normalizeCategory(c.req.query('category')),
      material: c.req.query('material')?.slice(0, 120) ?? null,
      part: c.req.query('part')?.slice(0, 80) ?? null,
    };
    return c.json((await loadRandom(c.env, c.var.userId, now, size, scope)) satisfies QueueResponse);
  }
  const material = c.req.query('material')?.slice(0, 120);
  if (material) {
    const part = c.req.query('part');
    return c.json((await loadMaterialQueue(c.env, c.var.userId, material, now, size, part === undefined ? null : part.slice(0, 80))) satisfies QueueResponse);
  }
  const queue = await loadTodayQueue(c.env, c.var.userId, now, { category: normalizeCategory(c.req.query('category')) });
  const body: QueueResponse = { cards: queue.slice(0, size), remaining: queue.length };
  return c.json(body);
});

review.post('/reviews', async (c) => {
  const body = await readJson(c, ReviewsBody);
  if (body instanceof Response) return body;
  const valid: ReviewItem[] = [];
  for (const item of body.reviews) {
    const parsed = ReviewItem.safeParse(item);
    if (parsed.success) valid.push(parsed.data);
  }
  const rejected = body.reviews.length - valid.length;
  if (rejected > 0) console.log(JSON.stringify({ event: 'reviews_rejected', user_id: c.var.userId, rejected }));
  const { conflicted, ...result } =
    valid.length > 0 ? await recordReviews(c.env, c.var.userId, valid, Date.now()) : { recorded: 0, skipped: 0, unlocked: 0, level_ups: [], conflicted: false };
  // 다른 기기와 계속 부딪혀 일부를 못 썼다. 기기는 이 묶음을 outbox에 두고 다시 보낸다 (이미 쓴 답은 건너뛴다)
  if (conflicted) return errorJson(503, 'busy', '다른 기기의 답과 겹쳤어요. 잠시 뒤에 다시 보낼게요.');
  return c.json({ ...result, rejected });
});
