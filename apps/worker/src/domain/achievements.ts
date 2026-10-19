import { PERFECT_MIN_ANSWERS, type Achievement } from '@moai/shared';
import type { Env } from '../env';
import { DAY_MS, KST_OFFSET_MS, STUDY_DAY_SHIFT } from '../lib/kst';

// 숨은 업적 (4단계). 이정표 배지(badges.ts)와 달리 조건을 미리 알려 주지 않는다. 그래서 이름·조건은 서버에만 두고,
// 화면에는 이룬 업적만 보낸다. 이루면 achievements에 적고 보유 크레딧(reward)을 준다. 내 성장 통계(domain/stats.ts)를 볼 때 확인한다.

interface Definition {
  id: string;
  title: string;
  /** 이룬 뒤에 보여 주는 설명 (이게 곧 조건이다) */
  text: string;
  reward: number;
  target: number;
  /** 지금까지의 값을 세는 SQL (?1 = 사용자). 없으면 stats.ts가 센 값(extra)을 쓴다 */
  sql?: string;
  extra?: 'questDays' | 'bestStreak';
}

/** 한국 시간의 시(0~23) */
const KST_HOUR = `CAST(strftime('%H', (reviewed_at + ${KST_OFFSET_MS}) / 1000, 'unixepoch') AS INTEGER)`;
/** 04:00 KST 경계의 학습일 */
const STUDY_DAY = `CAST((reviewed_at + ${STUDY_DAY_SHIFT}) / ${DAY_MS} AS INTEGER)`;

const DEFINITIONS: Definition[] = [
  {
    id: 'night_owl',
    title: '올빼미',
    text: '자정부터 새벽 4시 사이에 카드 20장을 풀었어요.',
    reward: 30,
    target: 20,
    sql: `(SELECT count(*) FROM review_logs WHERE user_id = ?1 AND ${KST_HOUR} < 4)`,
  },
  {
    id: 'early_bird',
    title: '아침형 인간',
    text: '아침 5시에서 7시 사이에 복습한 날이 5일이에요.',
    reward: 30,
    target: 5,
    sql: `(SELECT count(DISTINCT ${STUDY_DAY}) FROM review_logs WHERE user_id = ?1 AND ${KST_HOUR} BETWEEN 5 AND 6)`,
  },
  {
    id: 'perfectionist',
    title: '완벽주의자',
    text: '한 번도 안 틀린 복습을 10번 했어요.',
    reward: 50,
    target: 10,
    sql: `(SELECT count(*) FROM (SELECT 1 FROM review_logs WHERE user_id = ?1 AND run_id IS NOT NULL GROUP BY run_id
            HAVING count(*) >= ${PERFECT_MIN_ANSWERS} AND min(grade) >= 2))`,
  },
  {
    id: 'comeback',
    title: '돌아온 복습러',
    text: '일주일 넘게 쉬었다가 다시 복습을 시작했어요.',
    reward: 30,
    target: 1,
    sql: `(SELECT count(*) FROM (SELECT d - lag(d) OVER (ORDER BY d) AS gap FROM (SELECT DISTINCT ${STUDY_DAY} AS d FROM review_logs WHERE user_id = ?1))
            WHERE gap > 7)`,
  },
  {
    id: 'marathon',
    title: '마라토너',
    text: '하루에 카드 100장을 풀었어요.',
    reward: 50,
    target: 100,
    sql: `(SELECT coalesce(max(n), 0) FROM (SELECT count(*) AS n FROM review_logs WHERE user_id = ?1 GROUP BY ${STUDY_DAY}))`,
  },
  {
    id: 'explorer',
    title: '탐험가',
    text: '큰 분류 다섯 곳에서 개념을 익혔어요.',
    reward: 30,
    target: 5,
    sql: `(SELECT count(DISTINCT substr(domain, 1, instr(domain || '/', '/') - 1)) FROM concepts
            WHERE user_id = ?1 AND adopted_at IS NOT NULL AND domain IS NOT NULL)`,
  },
  {
    id: 'finisher',
    title: '완독',
    text: '자료 하나의 새 카드를 끝까지 다 풀었어요.',
    reward: 50,
    target: 1,
    sql: `(SELECT count(*) FROM (SELECT 1 FROM learning_sessions s JOIN cards c ON c.session_id = s.id
            WHERE s.user_id = ?1 AND s.material IS NOT NULL GROUP BY s.material
            HAVING count(c.id) >= 10 AND sum(c.state = 0 AND c.status = 'active') = 0 AND sum(c.state != 0) > 0))`,
  },
  {
    id: 'redemption',
    title: '설욕전',
    text: '틀렸던 카드를 다시 맞힌 게 30번이에요.',
    reward: 40,
    target: 30,
    sql: `(SELECT count(*) FROM review_logs r WHERE r.user_id = ?1 AND r.grade >= 2
            AND EXISTS (SELECT 1 FROM review_logs p WHERE p.card_id = r.card_id AND p.reviewed_at < r.reviewed_at AND p.grade = 1))`,
  },
  {
    id: 'sharpshooter',
    title: '명사수',
    text: '확실하다고 하고 맞힌 답이 100번이에요.',
    reward: 40,
    target: 100,
    sql: "(SELECT count(*) FROM review_logs WHERE user_id = ?1 AND confidence = 'sure' AND grade >= 2)",
  },
  {
    id: 'lucky_guess',
    title: '찍기의 신',
    text: '찍었는데 맞힌 답이 20번이에요.',
    reward: 20,
    target: 20,
    sql: "(SELECT count(*) FROM review_logs WHERE user_id = ?1 AND confidence = 'guess' AND grade >= 2)",
  },
  {
    id: 'orator',
    title: '말하기 선수',
    text: '설명하기를 30번 통과했어요.',
    reward: 40,
    target: 30,
    sql: "(SELECT count(*) FROM review_logs r JOIN cards c ON c.id = r.card_id WHERE r.user_id = ?1 AND c.type = 'explain' AND r.grade >= 2)",
  },
  {
    id: 'curious',
    title: '호기심 대장',
    text: 'AI에게 개념을 30번 물어봤어요.',
    reward: 30,
    target: 30,
    sql: "(SELECT count(*) FROM llm_usage WHERE user_id = ?1 AND kind = 'ask')",
  },
  {
    id: 'interviewee',
    title: '면접 단골',
    text: '모의면접 질문에 50번 답했어요.',
    reward: 40,
    target: 50,
    sql: "(SELECT count(*) FROM llm_usage WHERE user_id = ?1 AND kind = 'interview')",
  },
  { id: 'quest_master', title: '퀘스트 장인', text: '오늘의 퀘스트를 모두 끝낸 날이 7일이에요.', reward: 50, target: 7, extra: 'questDays' },
  { id: 'devoted', title: '백일 동안', text: '100일 연속으로 하루 목표를 채웠어요.', reward: 100, target: 100, extra: 'bestStreak' },
];

// ponytail: 통계를 볼 때마다 모든 업적을 다시 센다 (한 사람 기록을 몇 번 훑는다). 기록이 아주 많아지면 이룬 업적은 빼고 세거나 하루 한 번만 센다
const PROGRESS_SQL = `SELECT ${DEFINITIONS.filter((item) => item.sql)
  .map((item) => `${item.sql} AS ${item.id}`)
  .join(',\n')}`;

/** stats.ts의 batch에 함께 넣는 읽기 두 개: 진행 정도, 이미 이룬 업적 */
export function achievementReads(env: Env, userId: string): D1PreparedStatement[] {
  return [env.DB.prepare(PROGRESS_SQL).bind(userId), env.DB.prepare('SELECT achievement, earned_at FROM achievements WHERE user_id = ?1').bind(userId)];
}

/**
 * 이룬 업적과 새로 이룬 업적을 적는 문장들. 새 업적은 achievements에 넣고 보유 크레딧을 준다.
 * 같은 업적의 크레딧은 한 번만 준다 (이미 받은 기록이 있으면 넣지 않는다). 받은 시각은 알아챈 지금이다.
 */
export function settleAchievements(
  env: Env,
  userId: string,
  now: number,
  [progress, owned]: D1Result[],
  extra: Record<NonNullable<Definition['extra']>, number>,
): { achievements: { earned: Achievement[]; total: number }; writes: D1PreparedStatement[] } {
  const row = (progress!.results[0] ?? {}) as Record<string, number | null>;
  const earnedAt = new Map((owned!.results as { achievement: string; earned_at: number }[]).map((item) => [item.achievement, item.earned_at]));
  const writes: D1PreparedStatement[] = [];
  const earned: Achievement[] = [];
  for (const item of DEFINITIONS) {
    const value = item.extra ? extra[item.extra] : (row[item.id] ?? 0);
    let at = earnedAt.get(item.id);
    if (at === undefined && value >= item.target) {
      at = now;
      writes.push(
        env.DB.prepare('INSERT OR IGNORE INTO achievements (user_id, achievement, earned_at) VALUES (?1, ?2, ?3)').bind(userId, item.id, now),
        // 크레딧은 업적마다 한 번. 동시에 두 번 확인해도 batch(트랜잭션) 안에서 이미 준 기록을 본다
        env.DB.prepare(
          `INSERT INTO credit_ledger (id, user_id, amount, kind, ref, note, created_at)
           SELECT ?1, ?2, ?3, 'achievement', ?4, ?5, ?6 WHERE NOT EXISTS (SELECT 1 FROM credit_ledger WHERE user_id = ?2 AND kind = 'achievement' AND ref = ?4)`,
        ).bind(crypto.randomUUID(), userId, item.reward, item.id, item.title, now),
      );
    }
    if (at !== undefined) earned.push({ id: item.id, title: item.title, text: item.text, reward: item.reward, earned_at: at });
  }
  return { achievements: { earned: earned.sort((a, b) => b.earned_at - a.earned_at), total: DEFINITIONS.length }, writes };
}
