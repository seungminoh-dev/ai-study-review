import { ReviewItem, ReviewsBody, estimateMinutes, normalizeCategory, type OpenFollowup, type QueueResponse, type SessionSummary, type TodayResponse } from '@moai/shared';
import { Hono } from 'hono';
import type { AppEnv } from '../context';
import { countReviewedToday, loadMaterialQueue, loadTodayQueue } from '../domain/queue';
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
  const [queue, reviewedToday, sessions, rest] = await Promise.all([
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
    ]),
  ]);
  const [followups, reminders] = rest;
  const body: TodayResponse = {
    remaining: queue.length,
    minutes: estimateMinutes(queue.length),
    reviewed_today: reviewedToday,
    sessions: sessions satisfies SessionSummary[],
    followups: followups!.results as unknown as OpenFollowup[],
    reminders_set: ((reminders!.results[0] as { n: number } | undefined)?.n ?? 0) > 0,
  };
  return c.json(body);
});

/** ?category=분류 경로: 그 분류만 복습. ?material=자료 제목: 그 자료 풀기 (아직 안 푼 자료 카드 포함), &part=섹션 이름이면 그 섹션만 */
review.get('/queue', async (c) => {
  const size = Math.min(Math.max(Number.parseInt(c.req.query('size') ?? '8', 10) || 8, 1), 20);
  const now = Date.now();
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
