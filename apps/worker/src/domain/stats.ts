import type { LeagueEntry, StatsResponse } from '@moai/shared';
import type { Env } from '../env';
import { DAY_MS, STUDY_DAY_SHIFT, studyDayIndex, studyDayKey, studyWeekStart, studyWeekday } from '../lib/kst';

// 스트릭·XP·리그 (설계서 §9.6). 따로 저장하지 않고 review_logs와 learning_sessions에서 센다. 프리즈만 저장한다.

/** XP: 정답 10, 오답 2, 설명하기 완료 20, 학습 세션 저장 30 */
const REVIEW_XP = `CASE WHEN c.type = 'explain' THEN 20 WHEN r.grade >= 2 THEN 10 ELSE 2 END`;
const SESSION_XP = 30;
/** 스트릭은 1년까지만 거슬러 센다 */
const LOOKBACK_DAYS = 400;

interface DayRow {
  d: number;
  n: number;
  xp: number;
}

export async function loadStats(env: Env, userId: string, now: number): Promise<StatsResponse> {
  const today = studyDayIndex(now);
  const since = (today - LOOKBACK_DAYS) * DAY_MS - STUDY_DAY_SHIFT;
  const [reviews, sessions, freezes, user] = await env.DB.batch([
    env.DB.prepare(
      `SELECT CAST((r.reviewed_at + ?3) / ${DAY_MS} AS INTEGER) AS d, count(*) AS n, sum(${REVIEW_XP}) AS xp
         FROM review_logs r JOIN cards c ON c.id = r.card_id
        WHERE r.user_id = ?1 AND r.reviewed_at >= ?2
        GROUP BY d`,
    ).bind(userId, since, STUDY_DAY_SHIFT),
    env.DB.prepare(
      `SELECT CAST((created_at + ?3) / ${DAY_MS} AS INTEGER) AS d, count(*) AS n FROM learning_sessions WHERE user_id = ?1 AND created_at >= ?2 GROUP BY d`,
    ).bind(userId, since, STUDY_DAY_SHIFT),
    env.DB.prepare('SELECT day FROM streak_freezes WHERE user_id = ?1').bind(userId),
    env.DB.prepare('SELECT daily_goal FROM users WHERE id = ?1').bind(userId),
  ]);
  const goal = (user!.results[0] as { daily_goal: number } | undefined)?.daily_goal ?? 5;
  const reviewed = new Map((reviews!.results as unknown as DayRow[]).map((row) => [row.d, row]));
  const saved = new Map((sessions!.results as unknown as { d: number; n: number }[]).map((row) => [row.d, row.n]));
  const frozen = new Set((freezes!.results as { day: string }[]).map((row) => row.day));
  const xpOf = (day: number) => (reviewed.get(day)?.xp ?? 0) + (saved.get(day) ?? 0) * SESSION_XP;
  const met = (day: number) => (reviewed.get(day)?.n ?? 0) >= goal;
  const weekOf = (day: number) => day - studyWeekday(day);
  const usedFreezeWeeks = new Set([...frozen].map((key) => weekOf(Math.round(Date.parse(key) / DAY_MS))));

  // 스트릭: 목표를 채운 날이 이어진 수. 오늘은 아직 안 채웠어도 끊기지 않는다.
  // 하루를 빠졌고 그 앞날은 채웠다면, 그 주에 프리즈를 아직 안 썼을 때 자동으로 한 번 쓴다.
  let streak = met(today) ? 1 : 0;
  const newFreezes: string[] = [];
  for (let day = today - 1; day > today - LOOKBACK_DAYS; day -= 1) {
    if (met(day)) {
      streak += 1;
    } else if (frozen.has(studyDayKey(day))) {
      continue;
    } else if (met(day - 1) && !usedFreezeWeeks.has(weekOf(day))) {
      usedFreezeWeeks.add(weekOf(day));
      frozen.add(studyDayKey(day));
      newFreezes.push(studyDayKey(day));
    } else {
      break;
    }
  }
  if (newFreezes.length > 0) {
    await env.DB.prepare('INSERT OR IGNORE INTO streak_freezes (user_id, day) SELECT ?1, value FROM json_each(?2)')
      .bind(userId, JSON.stringify(newFreezes))
      .run();
  }

  const monday = weekOf(today);
  const days = Array.from({ length: 7 }, (_, i) => monday + i).map((day) => ({
    day: studyDayKey(day),
    reviewed: reviewed.get(day)?.n ?? 0,
    met: met(day),
    frozen: frozen.has(studyDayKey(day)),
    future: day > today,
  }));
  return {
    goal,
    today: { reviewed: reviewed.get(today)?.n ?? 0, xp: xpOf(today) },
    streak,
    freeze_available: !usedFreezeWeeks.has(monday),
    week: { xp: days.reduce((sum, _, i) => sum + xpOf(monday + i), 0), days },
  };
}

/** 이번 주 XP 순위. 친구끼리만 쓰는 서비스라 모든 사용자의 이름과 XP를 보여 준다 */
export async function loadLeague(env: Env, userId: string, now: number): Promise<{ week_start: number; entries: LeagueEntry[] }> {
  const start = studyWeekStart(now);
  const [users, reviews, sessions] = await env.DB.batch([
    env.DB.prepare('SELECT id, display_name FROM users'),
    env.DB.prepare(
      `SELECT r.user_id, sum(${REVIEW_XP}) AS xp FROM review_logs r JOIN cards c ON c.id = r.card_id WHERE r.reviewed_at >= ?1 GROUP BY r.user_id`,
    ).bind(start),
    env.DB.prepare('SELECT user_id, count(*) AS n FROM learning_sessions WHERE created_at >= ?1 GROUP BY user_id').bind(start),
  ]);
  const xp = new Map<string, number>();
  for (const row of reviews!.results as { user_id: string; xp: number }[]) xp.set(row.user_id, row.xp);
  for (const row of sessions!.results as { user_id: string; n: number }[]) xp.set(row.user_id, (xp.get(row.user_id) ?? 0) + row.n * SESSION_XP);
  const entries = (users!.results as { id: string; display_name: string }[])
    .map((row) => ({ name: row.display_name, xp: xp.get(row.id) ?? 0, me: row.id === userId }))
    .sort((a, b) => b.xp - a.xp || a.name.localeCompare(b.name, 'ko'));
  return { week_start: start, entries };
}
