import { DailyGoalBody } from '@moai/shared';
import { Hono } from 'hono';
import type { AppEnv } from '../context';
import { loadConcept, loadMap } from '../domain/map';
import { loadLeague, loadStats } from '../domain/stats';
import { errorJson, readJson } from '../lib/http';

// 스트릭·XP·리그, 지식 지도와 개념 상세 (설계서 §9.6, §9.7)

export const progress = new Hono<AppEnv>();

progress.get('/stats', async (c) => c.json(await loadStats(c.env, c.var.userId, Date.now())));

progress.get('/league', async (c) => c.json(await loadLeague(c.env, c.var.userId, Date.now())));

progress.put('/goal', async (c) => {
  const body = await readJson(c, DailyGoalBody);
  if (body instanceof Response) return body;
  await c.env.DB.prepare('UPDATE users SET daily_goal = ?2 WHERE id = ?1').bind(c.var.userId, body.daily_goal).run();
  return c.json({ daily_goal: body.daily_goal });
});

progress.get('/map', async (c) => c.json(await loadMap(c.env, c.var.userId, Date.now())));

progress.get('/concepts/:key', async (c) => {
  const concept = await loadConcept(c.env, c.var.userId, c.req.param('key'), Date.now());
  return concept ? c.json(concept) : errorJson(404, 'not_found', '개념을 찾지 못했어요.');
});
