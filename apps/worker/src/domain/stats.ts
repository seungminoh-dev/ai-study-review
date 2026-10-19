import { PERFECT_MIN_ANSWERS, PERFECT_XP, type StatsResponse } from '@moai/shared';
import type { Env } from '../env';
import { badgeReads, settleBadges } from './badges';
import { DAY_MS, STUDY_DAY_SHIFT, studyDayIndex, studyDayKey, studyDayStart, studyWeekday } from '../lib/kst';

// 스트릭·XP (설계서 §9.6). 따로 저장하지 않고 review_logs와 learning_sessions에서 센다. 프리즈만 저장한다.

/** XP: 정답 10, 오답 2, 설명하기 완료 20, 학습 세션 저장 30, 무실수 복습 보너스 PERFECT_XP */
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
  const [reviews, sessions, perfects, learned, freezes, user, ...badgeRows] = await env.DB.batch([
    env.DB.prepare(
      `SELECT CAST((r.reviewed_at + ?3) / ${DAY_MS} AS INTEGER) AS d, count(*) AS n, sum(${REVIEW_XP}) AS xp
         FROM review_logs r JOIN cards c ON c.id = r.card_id
        WHERE r.user_id = ?1 AND r.reviewed_at >= ?2
        GROUP BY d`,
    ).bind(userId, since, STUDY_DAY_SHIFT),
    env.DB.prepare(
      `SELECT CAST((created_at + ?3) / ${DAY_MS} AS INTEGER) AS d, count(*) AS n FROM learning_sessions WHERE user_id = ?1 AND created_at >= ?2 GROUP BY d`,
    ).bind(userId, since, STUDY_DAY_SHIFT),
    // 무실수 복습: 한 번에 PERFECT_MIN_ANSWERS장 이상 풀고 모두 맞힌 묶음. 마지막 답을 한 날에 센다.
    // 기록에서 세므로 답을 되돌리면 보너스도 같이 빠진다
    env.DB.prepare(
      `SELECT CAST((at + ?3) / ${DAY_MS} AS INTEGER) AS d, count(*) AS n
         FROM (SELECT max(reviewed_at) AS at FROM review_logs
                WHERE user_id = ?1 AND run_id IS NOT NULL AND reviewed_at >= ?2
                GROUP BY run_id HAVING count(*) >= ${PERFECT_MIN_ANSWERS} AND min(grade) >= 2)
        GROUP BY d`,
    ).bind(userId, since, STUDY_DAY_SHIFT),
    // 오늘 학습: 자료 카드를 처음 푼 답 (오늘 목표 링을 복습과 나눠 칠한다)
    env.DB.prepare(
      `SELECT count(*) AS n FROM review_logs r JOIN cards c ON c.id = r.card_id
        WHERE r.user_id = ?1 AND r.reviewed_at >= ?2 AND c.origin = 'material' AND json_extract(r.prev_card, '$.state') = 0`,
    ).bind(userId, studyDayStart(now)),
    env.DB.prepare('SELECT day FROM streak_freezes WHERE user_id = ?1').bind(userId),
    env.DB.prepare('SELECT daily_goal FROM users WHERE id = ?1').bind(userId),
    ...badgeReads(env, userId),
  ]);
  const goal = (user!.results[0] as { daily_goal: number } | undefined)?.daily_goal ?? 5;
  const reviewed = new Map((reviews!.results as unknown as DayRow[]).map((row) => [row.d, row]));
  const saved = new Map((sessions!.results as unknown as { d: number; n: number }[]).map((row) => [row.d, row.n]));
  const frozen = new Set((freezes!.results as { day: string }[]).map((row) => row.day));
  const perfect = new Map((perfects!.results as unknown as { d: number; n: number }[]).map((row) => [row.d, row.n]));
  const xpOf = (day: number) => (reviewed.get(day)?.xp ?? 0) + (saved.get(day) ?? 0) * SESSION_XP + (perfect.get(day) ?? 0) * PERFECT_XP;
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
  const writes: D1PreparedStatement[] = [];
  if (newFreezes.length > 0) {
    writes.push(env.DB.prepare('INSERT OR IGNORE INTO streak_freezes (user_id, day) SELECT ?1, value FROM json_each(?2)').bind(userId, JSON.stringify(newFreezes)));
  }

  // 가장 긴 연속: 스트릭과 같은 규칙으로 센다. 프리즈한 날은 끊지도 늘리지도 않고, 아직 안 채운 오늘은 끊지 않는다.
  // 연속 배지를 위해 처음 n일 이어진 날도 적어 둔다
  let best = 0;
  let run = 0;
  const reached = new Map<number, number>();
  for (let day = today - LOOKBACK_DAYS + 1; day <= today; day += 1) {
    if (met(day)) {
      best = Math.max(best, (run += 1));
      if (!reached.has(run)) reached.set(run, day * DAY_MS - STUDY_DAY_SHIFT);
    } else if (!frozen.has(studyDayKey(day)) && day !== today) {
      run = 0;
    }
  }
  const { badges, insert } = settleBadges(env, userId, now, badgeRows, { best: Math.max(best, streak), reached });
  if (insert) writes.push(insert);
  if (writes.length > 0) await env.DB.batch(writes);

  const dayOf = (day: number) => ({
    day: studyDayKey(day),
    reviewed: reviewed.get(day)?.n ?? 0,
    met: met(day),
    frozen: frozen.has(studyDayKey(day)),
    future: day > today,
  });
  const monday = weekOf(today);
  const days = Array.from({ length: 7 }, (_, i) => dayOf(monday + i));
  const weekXp = (start: number) => Array.from({ length: 7 }, (_, i) => xpOf(start + i)).reduce((sum, xp) => sum + xp, 0);
  return {
    goal,
    today: { reviewed: reviewed.get(today)?.n ?? 0, learned: (learned!.results[0] as { n: number } | undefined)?.n ?? 0, xp: xpOf(today) },
    streak,
    freeze_available: !usedFreezeWeeks.has(monday),
    week: { xp: weekXp(monday), days },
    best_streak: Math.max(best, streak),
    last_week_xp: weekXp(monday - 7),
    history: Array.from({ length: 84 }, (_, i) => dayOf(monday - 77 + i)),
    badges,
  };
}
