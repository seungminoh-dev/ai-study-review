import { BADGES, type Badge, type BadgeKind } from '@moai/shared';
import type { Env } from '../env';

// 이정표 배지 (3단계 3-4). 받을 조건은 기록에서 세고, 처음 이룬 배지만 badges 테이블에 넣는다.
// 넣은 뒤에는 하루 목표를 바꾸거나 답을 되돌려도 남는다. 연속 배지는 stats.ts가 센 날짜를 받는다.
// 받은 시각은 이룬 순간(n번째 기록의 시각)이라, 이 기능 전에 이룬 배지도 그때 날짜로 채워진다. 축하는 PWA가 기기마다 한 번 한다.

type CountedKind = Exclude<BadgeKind, 'streak'>;

/** 종류마다 지금까지의 수 */
const COUNT: Record<CountedKind, string> = {
  saves: '(SELECT count(*) FROM learning_sessions WHERE user_id = ?1)',
  reviews: '(SELECT count(*) FROM review_logs WHERE user_id = ?1)',
  explains: "(SELECT count(*) FROM review_logs r JOIN cards c ON c.id = r.card_id WHERE r.user_id = ?1 AND c.type = 'explain' AND r.grade >= 2)",
  concepts: '(SELECT count(*) FROM concepts WHERE user_id = ?1 AND adopted_at IS NOT NULL)',
};

/** 종류마다 n번째(0부터) 기록의 시각. 그 배지를 이룬 순간이다 */
const NTH: Record<CountedKind, (offset: number) => string> = {
  saves: (n) => `(SELECT created_at FROM learning_sessions WHERE user_id = ?1 ORDER BY created_at LIMIT 1 OFFSET ${n})`,
  reviews: (n) => `(SELECT reviewed_at FROM review_logs WHERE user_id = ?1 ORDER BY reviewed_at LIMIT 1 OFFSET ${n})`,
  explains: (n) =>
    `(SELECT r.reviewed_at FROM review_logs r JOIN cards c ON c.id = r.card_id
       WHERE r.user_id = ?1 AND c.type = 'explain' AND r.grade >= 2 ORDER BY r.reviewed_at LIMIT 1 OFFSET ${n})`,
  concepts: (n) => `(SELECT adopted_at FROM concepts WHERE user_id = ?1 AND adopted_at IS NOT NULL ORDER BY adopted_at LIMIT 1 OFFSET ${n})`,
};

const PROGRESS_SQL = `SELECT ${[
  ...Object.entries(COUNT).map(([kind, sql]) => `${sql} AS count_${kind}`),
  ...BADGES.flatMap((badge) => (badge.kind === 'streak' ? [] : [`${NTH[badge.kind](badge.target - 1)} AS at_${badge.id}`])),
].join(',\n')}`;

/** stats.ts의 batch에 함께 넣는 읽기 두 개: 진행 정도, 이미 받은 배지 */
export function badgeReads(env: Env, userId: string): D1PreparedStatement[] {
  return [env.DB.prepare(PROGRESS_SQL).bind(userId), env.DB.prepare('SELECT badge, earned_at FROM badges WHERE user_id = ?1').bind(userId)];
}

export interface StreakProgress {
  /** 가장 길었던 연속 일수 */
  best: number;
  /** 연속 일수 → 처음 그만큼 이어진 날의 시각 */
  reached: ReadonlyMap<number, number>;
}

/**
 * 배지 목록과, 새로 이룬 배지를 넣는 문장(없으면 null).
 * 새로 이룬 배지는 이룬 순간(n번째 기록의 시각)을 받은 시각으로 쓴다.
 */
export function settleBadges(
  env: Env,
  userId: string,
  now: number,
  [progress, owned]: D1Result[],
  streak: StreakProgress,
): { badges: Badge[]; insert: D1PreparedStatement | null } {
  const row = (progress!.results[0] ?? {}) as Record<string, number | null>;
  const earned = new Map((owned!.results as { badge: string; earned_at: number }[]).map((item) => [item.badge, item.earned_at]));
  const added: { id: string; earned_at: number }[] = [];
  const badges = BADGES.map((badge): Badge => {
    const value = badge.kind === 'streak' ? streak.best : (row[`count_${badge.kind}`] ?? 0);
    const reached = badge.kind === 'streak' ? (streak.reached.get(badge.target) ?? null) : (row[`at_${badge.id}`] ?? null);
    const known = earned.get(badge.id);
    if (known !== undefined) return { id: badge.id, earned_at: known, value, target: badge.target };
    if (reached === null) return { id: badge.id, earned_at: null, value, target: badge.target };
    const at = Math.min(reached, now);
    added.push({ id: badge.id, earned_at: at });
    return { id: badge.id, earned_at: at, value, target: badge.target };
  });
  const insert =
    added.length === 0
      ? null
      : env.DB.prepare(
          "INSERT OR IGNORE INTO badges (user_id, badge, earned_at) SELECT ?1, json_extract(value, '$.id'), json_extract(value, '$.earned_at') FROM json_each(?2)",
        ).bind(userId, JSON.stringify(added));
  return { badges, insert };
}
