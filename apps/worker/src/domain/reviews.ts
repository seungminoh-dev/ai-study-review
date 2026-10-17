import type { ReviewItem, ReviewsResponse } from '@moai/shared';
import type { Env } from '../env';
import { nextFsrsFields, pickFsrsFields, type FsrsFields } from './fsrs';
import { cardsToUnlock, type LadderCard } from './ladder';

// 답안 기록 (설계서 §9.5)

interface CardRow extends FsrsFields, LadderCard {
  created_at: number;
}

/**
 * 답안 묶음을 기록한다.
 * 이미 기록한 id는 건너뛰고, 같은 카드의 답은 시각 순으로 이어서 채점한다.
 * 카드 갱신, 기록, 사다리 잠금 해제를 한 번의 batch(트랜잭션)로 쓴다.
 */
export async function recordReviews(env: Env, userId: string, reviews: readonly ReviewItem[], now: number): Promise<ReviewsResponse> {
  const ids = JSON.stringify(reviews.map((review) => review.id));
  const cardIds = JSON.stringify([...new Set(reviews.map((review) => review.card_id))]);
  const [existing, cards] = await env.DB.batch([
    env.DB.prepare('SELECT id FROM review_logs WHERE user_id = ?1 AND id IN (SELECT value FROM json_each(?2))').bind(userId, ids),
    // 답한 카드와 같은 개념의 카드를 모두 읽는다. 사다리 검사에 필요하다
    env.DB.prepare(
      `SELECT id, concept_id, rung, status, created_at, due, stability, difficulty, elapsed_days, scheduled_days,
              learning_steps, reps, lapses, state, last_review
         FROM cards
        WHERE user_id = ?1 AND concept_id IN (SELECT concept_id FROM cards WHERE user_id = ?1 AND id IN (SELECT value FROM json_each(?2)))`,
    ).bind(userId, cardIds),
  ]);

  const seen = new Set((existing!.results as { id: string }[]).map((row) => row.id));
  const rows = new Map((cards!.results as unknown as CardRow[]).map((row) => [row.id, { ...row }]));
  const fresh = reviews
    .filter((review) => !seen.has(review.id) && rows.has(review.card_id))
    .sort((a, b) => a.reviewed_at - b.reviewed_at);

  const logs: Record<string, unknown>[] = [];
  const touched = new Map<string, CardRow>();
  for (const review of fresh) {
    const row = rows.get(review.card_id)!;
    // 채점 시각은 기기 시각을 쓰되, 그 카드의 마지막 복습과 서버 현재 시각 사이로 자른다
    const lower = row.last_review ?? row.created_at;
    const reviewedAt = Math.min(Math.max(review.reviewed_at, lower), now);
    const prev = pickFsrsFields(row);
    Object.assign(row, nextFsrsFields(prev, reviewedAt, review.grade));
    touched.set(row.id, row);
    logs.push({
      id: review.id,
      card_id: row.id,
      grade: review.grade,
      response: review.response ?? null,
      elapsed_ms: review.elapsed_ms ?? null,
      reviewed_at: reviewedAt,
      prev_card: JSON.stringify(prev),
    });
  }

  const unlock = cardsToUnlock([...rows.values()]);
  if (logs.length > 0 || unlock.length > 0) {
    const statements = [];
    if (logs.length > 0) {
      statements.push(
        env.DB.prepare(
          `INSERT OR IGNORE INTO review_logs (id, user_id, card_id, grade, response, elapsed_ms, reviewed_at, prev_card)
           SELECT json_extract(value, '$.id'), ?1, json_extract(value, '$.card_id'), json_extract(value, '$.grade'),
                  json_extract(value, '$.response'), json_extract(value, '$.elapsed_ms'), json_extract(value, '$.reviewed_at'),
                  json_extract(value, '$.prev_card')
             FROM json_each(?2)`,
        ).bind(userId, JSON.stringify(logs)),
        env.DB.prepare(
          `UPDATE cards SET
             due = json_extract(j.value, '$.due'), stability = json_extract(j.value, '$.stability'),
             difficulty = json_extract(j.value, '$.difficulty'), elapsed_days = json_extract(j.value, '$.elapsed_days'),
             scheduled_days = json_extract(j.value, '$.scheduled_days'), learning_steps = json_extract(j.value, '$.learning_steps'),
             reps = json_extract(j.value, '$.reps'), lapses = json_extract(j.value, '$.lapses'),
             state = json_extract(j.value, '$.state'), last_review = json_extract(j.value, '$.last_review')
           FROM json_each(?2) AS j
           WHERE cards.user_id = ?1 AND cards.id = json_extract(j.value, '$.id')`,
        ).bind(userId, JSON.stringify([...touched.values()].map((row) => ({ id: row.id, ...pickFsrsFields(row) })))),
      );
    }
    if (unlock.length > 0) {
      statements.push(
        env.DB.prepare(
          "UPDATE cards SET status = 'active', due = ?3 WHERE user_id = ?1 AND status = 'locked' AND id IN (SELECT value FROM json_each(?2))",
        ).bind(userId, JSON.stringify(unlock), now),
      );
    }
    await env.DB.batch(statements);
  }
  return { recorded: logs.length, skipped: reviews.length - logs.length, unlocked: unlock.length };
}

/** 카드를 끄고, 그 개념의 사다리를 다시 검사한다. 맨 아래 카드를 끄면 다음 단계가 열린다. */
export async function setCardSuspended(env: Env, userId: string, cardId: string, suspended: boolean, now: number): Promise<boolean> {
  const update = suspended
    ? "UPDATE cards SET status = 'suspended' WHERE id = ?1 AND user_id = ?2"
    : "UPDATE cards SET status = CASE WHEN type = 'explain' THEN 'locked' ELSE 'active' END WHERE id = ?1 AND user_id = ?2 AND status = 'suspended'";
  const [changed, cards] = await env.DB.batch([
    env.DB.prepare(update).bind(cardId, userId),
    env.DB.prepare(
      'SELECT id, concept_id, rung, status, stability FROM cards WHERE user_id = ?2 AND concept_id = (SELECT concept_id FROM cards WHERE id = ?1 AND user_id = ?2)',
    ).bind(cardId, userId),
  ]);
  if (changed!.meta.changes === 0) {
    const exists = await env.DB.prepare('SELECT 1 FROM cards WHERE id = ?1 AND user_id = ?2').bind(cardId, userId).first();
    return exists !== null;
  }
  const unlock = cardsToUnlock(cards!.results as unknown as LadderCard[]);
  if (unlock.length > 0) {
    await env.DB.prepare(
      "UPDATE cards SET status = 'active', due = ?3 WHERE user_id = ?1 AND status = 'locked' AND id IN (SELECT value FROM json_each(?2))",
    )
      .bind(userId, JSON.stringify(unlock), now)
      .run();
  }
  return true;
}
