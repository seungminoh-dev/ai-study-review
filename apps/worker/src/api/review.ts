import { ReviewsBody, estimateMinutes, type Me, type OpenFollowup, type QueueResponse, type SessionSummary, type TodayResponse } from '@moai/shared';
import { Hono } from 'hono';
import type { AppEnv } from '../context';
import { countReviewedToday, loadTodayQueue } from '../domain/queue';
import { recordReviews } from '../domain/reviews';
import { readJson } from '../lib/http';
import { listSessions } from './sessions';

// 오늘 화면과 복습 (설계서 §7.2, §9)

export const review = new Hono<AppEnv>();

review.get('/me', async (c) => {
  const me = await c.env.DB.prepare('SELECT id, display_name, role, daily_new_limit, daily_review_limit FROM users WHERE id = ?1')
    .bind(c.var.userId)
    .first<Me>();
  return c.json(me);
});

review.get('/today', async (c) => {
  const now = Date.now();
  const userId = c.var.userId;
  const [queue, reviewedToday, sessions, rest] = await Promise.all([
    loadTodayQueue(c.env, userId, now),
    countReviewedToday(c.env, userId, now),
    listSessions(c.env, userId, 3),
    c.env.DB.batch([
      c.env.DB.prepare(
        `SELECT f.id, f.question, f.created_at, k.name AS concept_name
           FROM followups f JOIN concepts k ON k.id = f.concept_id
          WHERE f.user_id = ?1 AND f.resolved_at IS NULL ORDER BY f.created_at DESC LIMIT 5`,
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

review.get('/queue', async (c) => {
  const size = Math.min(Math.max(Number.parseInt(c.req.query('size') ?? '8', 10) || 8, 1), 20);
  const queue = await loadTodayQueue(c.env, c.var.userId, Date.now());
  const body: QueueResponse = { cards: queue.slice(0, size), remaining: queue.length };
  return c.json(body);
});

review.post('/reviews', async (c) => {
  const body = await readJson(c, ReviewsBody);
  if (body instanceof Response) return body;
  return c.json(await recordReviews(c.env, c.var.userId, body.reviews, Date.now()));
});
