import type { ReviewItem, ReviewsResponse } from '@moai/shared';
import type { Env } from '../env';
import { nextFsrsFields, pickFsrsFields, type FsrsFields } from './fsrs';
import { cardsToUnlock, type LadderCard } from './ladder';

// 답안 기록 (설계서 §9.5)

interface CardRow extends FsrsFields, LadderCard {
  created_at: number;
}

/** 다른 기기가 같은 카드를 동시에 바꿨을 때 다시 채점하는 횟수 */
const MAX_RETRIES = 2;

/**
 * 답안 묶음을 기록한다.
 * 이미 기록한 id는 건너뛰고, 같은 카드의 답은 시각 순으로 이어서 채점한다.
 * 카드 갱신, 기록, 사다리 잠금 해제를 한 번의 batch(트랜잭션)로 쓴다.
 * 읽은 뒤에 다른 기기가 그 카드를 채점했으면(reps가 달라졌으면) 그 카드는 쓰지 않고 새 상태로 다시 채점한다 (낙관적 잠금).
 */
export async function recordReviews(
  env: Env,
  userId: string,
  items: readonly ReviewItem[],
  now: number,
  attempt = 0,
): Promise<Omit<ReviewsResponse, 'rejected'> & { conflicted: boolean }> {
  // 같은 요청 안에 같은 id가 두 번 있어도 한 번만 채점한다
  const reviews = [...new Map(items.map((review) => [review.id, review])).values()];
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
  /** 읽었을 때의 reps. 복습할 때마다 1씩 늘어서 버전으로 쓴다 */
  const readReps = new Map<string, number>();
  for (const review of fresh) {
    const row = rows.get(review.card_id)!;
    if (!readReps.has(row.id)) readReps.set(row.id, row.reps);
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
      confidence: review.confidence ?? null,
      elapsed_ms: review.elapsed_ms ?? null,
      reviewed_at: reviewedAt,
      prev_card: JSON.stringify(prev),
      read_reps: readReps.get(row.id),
    });
  }

  let recorded = 0;
  if (logs.length > 0) {
    // 기록과 카드 갱신은 둘 다 "읽은 뒤로 카드가 그대로일 때"만 쓴다. 같은 트랜잭션이라 둘의 판단이 같다
    const [inserted, updated] = await env.DB.batch([
      env.DB.prepare(
        `INSERT OR IGNORE INTO review_logs (id, user_id, card_id, grade, response, confidence, elapsed_ms, reviewed_at, prev_card)
         SELECT json_extract(j.value, '$.id'), ?1, c.id, json_extract(j.value, '$.grade'),
                json_extract(j.value, '$.response'), json_extract(j.value, '$.confidence'), json_extract(j.value, '$.elapsed_ms'),
                json_extract(j.value, '$.reviewed_at'), json_extract(j.value, '$.prev_card')
           FROM json_each(?2) AS j
           JOIN cards c ON c.id = json_extract(j.value, '$.card_id') AND c.user_id = ?1 AND c.reps = json_extract(j.value, '$.read_reps')`,
      ).bind(userId, JSON.stringify(logs)),
      env.DB.prepare(
        `UPDATE cards SET
           due = json_extract(j.value, '$.due'), stability = json_extract(j.value, '$.stability'),
           difficulty = json_extract(j.value, '$.difficulty'), elapsed_days = json_extract(j.value, '$.elapsed_days'),
           scheduled_days = json_extract(j.value, '$.scheduled_days'), learning_steps = json_extract(j.value, '$.learning_steps'),
           reps = json_extract(j.value, '$.reps'), lapses = json_extract(j.value, '$.lapses'),
           state = json_extract(j.value, '$.state'), last_review = json_extract(j.value, '$.last_review')
         FROM json_each(?2) AS j
         WHERE cards.user_id = ?1 AND cards.id = json_extract(j.value, '$.id') AND cards.reps = json_extract(j.value, '$.read_reps')`,
      ).bind(userId, JSON.stringify([...touched.values()].map((row) => ({ id: row.id, read_reps: readReps.get(row.id), ...pickFsrsFields(row) })))),
    ]);
    recorded = inserted!.meta.changes;
    if (updated!.meta.changes < touched.size) {
      // 못 쓴 카드의 답은 기록도 안 됐으니, 다시 읽으면 새 답으로 보인다. 사다리도 새 상태로 다시 본다
      if (attempt >= MAX_RETRIES) return { recorded, skipped: items.length - recorded, unlocked: 0, conflicted: true };
      const again = await recordReviews(env, userId, items, now, attempt + 1);
      return { ...again, recorded: recorded + again.recorded, skipped: items.length - recorded - again.recorded };
    }
  }

  // 사다리는 기록이 모두 들어간 뒤의 상태로만 연다. 기록이 밀린 답을 근거로 카드를 열지 않는다
  const unlock = cardsToUnlock([...rows.values()]);
  if (unlock.length > 0) {
    await env.DB.prepare(
      "UPDATE cards SET status = 'active', due = ?3 WHERE user_id = ?1 AND status = 'locked' AND id IN (SELECT value FROM json_each(?2))",
    )
      .bind(userId, JSON.stringify(unlock), now)
      .run();
  }
  return { recorded, skipped: items.length - recorded, unlocked: unlock.length, conflicted: false };
}

/**
 * 카드를 끄거나 다시 켠다.
 * 끄면 그 개념의 사다리를 다시 검사한다. 맨 아래 카드를 끄면 다음 단계가 열린다.
 * 다시 켜면 사다리를 따른다: 지금 열린 단계 이하면 active, 더 높으면 locked로 돌아간다. 설명하기는 언제나 locked다.
 */
export async function setCardSuspended(env: Env, userId: string, cardId: string, suspended: boolean, now: number): Promise<boolean> {
  const { results } = await env.DB.prepare(
    'SELECT id, concept_id, rung, status, stability, type FROM cards WHERE user_id = ?2 AND concept_id = (SELECT concept_id FROM cards WHERE id = ?1 AND user_id = ?2)',
  )
    .bind(cardId, userId)
    .all<LadderCard & { type: string }>();
  const target = results.find((card) => card.id === cardId);
  if (!target) return false;

  const others = results.filter((card) => card.id !== cardId);
  let status: string;
  if (suspended) {
    status = 'suspended';
  } else if (target.status !== 'suspended') {
    return true;
  } else if (target.type === 'explain') {
    status = 'locked';
  } else {
    const open = others.filter((card) => card.status === 'active').reduce((max, card) => Math.max(max, card.rung), 0);
    status = target.rung <= open ? 'active' : 'locked';
  }
  const cards = [...others, { ...target, status }];
  // 잠긴 채로 돌아왔거나 맨 아래 카드를 껐으면, 사다리 규칙으로 열 단계를 다시 고른다
  const unlock = cardsToUnlock(cards);
  const statements = [env.DB.prepare('UPDATE cards SET status = ?3 WHERE id = ?1 AND user_id = ?2').bind(cardId, userId, status)];
  if (unlock.length > 0) {
    statements.push(
      env.DB.prepare(
        "UPDATE cards SET status = 'active', due = ?3 WHERE user_id = ?1 AND status = 'locked' AND id IN (SELECT value FROM json_each(?2))",
      ).bind(userId, JSON.stringify(unlock), now),
    );
  }
  await env.DB.batch(statements);
  return true;
}
