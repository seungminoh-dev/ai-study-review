import { DailyGoalBody, SurveyBody, type SurveyStatus } from '@moai/shared';
import { Hono } from 'hono';
import type { AppEnv } from '../context';
import { loadConcept, loadMap } from '../domain/map';
import { loadStats } from '../domain/stats';
import { errorJson, readJson } from '../lib/http';
import { DAY_MS, studyDayIndex, studyDayKey, studyWeekday } from '../lib/kst';

// 스트릭·XP, 지식 지도와 개념 상세 (설계서 §9.6, §9.7)

export const progress = new Hono<AppEnv>();

progress.get('/stats', async (c) => c.json(await loadStats(c.env, c.var.userId, Date.now())));

progress.put('/goal', async (c) => {
  const body = await readJson(c, DailyGoalBody);
  if (body instanceof Response) return body;
  await c.env.DB.prepare('UPDATE users SET daily_goal = ?2 WHERE id = ?1').bind(c.var.userId, body.daily_goal).run();
  return c.json({ daily_goal: body.daily_goal });
});

progress.get('/map', async (c) => c.json(await loadMap(c.env, c.var.userId, Date.now())));

/** 이번 주 월요일 (04:00 KST 경계의 학습일) */
function surveyWeek(now: number): string {
  const today = studyDayIndex(now);
  return studyDayKey(today - studyWeekday(today));
}

/** 주간 설문 (기획서 §13). 가입한 지 3일 넘었고 이번 주에 아직 답하지 않았으면 묻는다 */
progress.get('/survey', async (c) => {
  const now = Date.now();
  const week = surveyWeek(now);
  const row = await c.env.DB.prepare(
    `SELECT u.created_at AS joined_at, EXISTS (SELECT 1 FROM survey_answers s WHERE s.user_id = u.id AND s.week = ?2) AS answered
       FROM users u WHERE u.id = ?1`,
  )
    .bind(c.var.userId, week)
    .first<{ joined_at: number; answered: number }>();
  const body: SurveyStatus = { week, ask: row !== null && row.answered === 0 && now - row.joined_at >= 3 * DAY_MS };
  return c.json(body);
});

/** 이번 주 답. 다시 보내면 고친다 */
progress.put('/survey', async (c) => {
  const body = await readJson(c, SurveyBody);
  if (body instanceof Response) return body;
  const now = Date.now();
  await c.env.DB.prepare(
    `INSERT INTO survey_answers (user_id, week, used, note, created_at) VALUES (?1, ?2, ?3, ?4, ?5)
     ON CONFLICT (user_id, week) DO UPDATE SET used = excluded.used, note = excluded.note, created_at = excluded.created_at`,
  )
    .bind(c.var.userId, surveyWeek(now), body.used ? 1 : 0, body.note || null, now)
    .run();
  return c.body(null, 204);
});

progress.get('/concepts/:key', async (c) => {
  const concept = await loadConcept(c.env, c.var.userId, c.req.param('key'), Date.now());
  return concept ? c.json(concept) : errorJson(404, 'not_found', '개념을 찾지 못했어요.');
});
