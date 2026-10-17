import type { McqOption, QueueCard } from '@moai/shared';
import type { Env } from '../env';
import { studyDayStart } from '../lib/kst';

// 오늘 큐 (설계서 §9.2)

export interface QueueCandidate {
  id: string;
  concept_id: string;
  state: number;
  due: number;
  created_at: number;
}

export interface QueueLimits {
  newLimit: number;
  reviewLimit: number;
  /** 오늘 이미 처음 본 새 카드 수 */
  newSeen: number;
  /** 오늘 이미 복습한 복습 카드(state 2) 수 */
  reviewsDone: number;
  /** 오늘 이미 복습한 개념 */
  reviewedConcepts: ReadonlySet<string>;
  /** 오늘 이미 복습한 카드 (학습 단계의 같은 카드가 다시 나오는 것은 괜찮다) */
  reviewedCards: ReadonlySet<string>;
}

/**
 * 학습·재학습 카드 → 복습 카드(하루 상한까지) → 새 카드(하루 상한까지) 순서로 고른다.
 * 같은 개념은 하루 1장이다.
 */
export function selectQueue<T extends QueueCandidate>(candidates: readonly T[], limits: QueueLimits): T[] {
  const byDue = (a: T, b: T) => a.due - b.due;
  const learning = candidates.filter((card) => card.state === 1 || card.state === 3).sort(byDue);
  const review = candidates
    .filter((card) => card.state === 2)
    .sort(byDue)
    .slice(0, Math.max(0, limits.reviewLimit - limits.reviewsDone));
  const fresh = candidates
    .filter((card) => card.state === 0)
    .sort((a, b) => a.created_at - b.created_at)
    .slice(0, Math.max(0, limits.newLimit - limits.newSeen));

  const picked: T[] = [];
  const concepts = new Set<string>();
  for (const card of [...learning, ...review, ...fresh]) {
    if (concepts.has(card.concept_id)) continue;
    if (limits.reviewedConcepts.has(card.concept_id) && !limits.reviewedCards.has(card.id)) continue;
    concepts.add(card.concept_id);
    picked.push(card);
  }
  return picked;
}

interface CandidateRow extends QueueCandidate {
  concept_key: string;
  concept_name: string;
  type: QueueCard['type'];
  rung: number;
  prompt: string;
  code: string | null;
  answer: string | null;
  options: string | null;
  explain: string | null;
}

/** 후보는 넉넉히 읽되 끝없이 읽지는 않는다 */
const CANDIDATE_LIMIT = 300;

/** 오늘 복습할 카드 전체를 순서대로 돌려준다. 앞에서 원하는 장수만 쓴다. */
export async function loadTodayQueue(env: Env, userId: string, now: number): Promise<QueueCard[]> {
  const dayStart = studyDayStart(now);
  const [candidates, today, user] = await env.DB.batch([
    env.DB.prepare(
      `SELECT c.id, c.concept_id, c.state, c.due, c.created_at, c.type, c.rung, c.prompt, c.code, c.answer, c.options, c.explain,
              k.key AS concept_key, k.name AS concept_name
         FROM cards c JOIN concepts k ON k.id = c.concept_id
        WHERE c.user_id = ?1 AND c.status = 'active' AND c.due <= ?2 AND c.type != 'explain'
        ORDER BY c.due LIMIT ${CANDIDATE_LIMIT}`,
    ).bind(userId, now),
    env.DB.prepare(
      `SELECT r.card_id, c.concept_id, json_extract(r.prev_card, '$.state') AS prev_state
         FROM review_logs r JOIN cards c ON c.id = r.card_id
        WHERE r.user_id = ?1 AND r.reviewed_at >= ?2`,
    ).bind(userId, dayStart),
    env.DB.prepare('SELECT daily_new_limit, daily_review_limit FROM users WHERE id = ?1').bind(userId),
  ]);

  const logs = today!.results as { card_id: string; concept_id: string; prev_state: number }[];
  const limitsRow = user!.results[0] as { daily_new_limit: number; daily_review_limit: number } | undefined;
  const newCards = new Set(logs.filter((log) => log.prev_state === 0).map((log) => log.card_id));
  const reviewCards = new Set(logs.filter((log) => log.prev_state === 2).map((log) => log.card_id));
  const picked = selectQueue(candidates!.results as unknown as CandidateRow[], {
    newLimit: limitsRow?.daily_new_limit ?? 10,
    reviewLimit: limitsRow?.daily_review_limit ?? 30,
    newSeen: newCards.size,
    reviewsDone: reviewCards.size,
    reviewedConcepts: new Set(logs.map((log) => log.concept_id)),
    reviewedCards: new Set(logs.map((log) => log.card_id)),
  });
  return picked.map(toQueueCard);
}

function toQueueCard(row: CandidateRow): QueueCard {
  const parsed = row.options ? (JSON.parse(row.options) as unknown) : null;
  return {
    id: row.id,
    concept_key: row.concept_key,
    concept_name: row.concept_name,
    type: row.type,
    rung: row.rung,
    prompt: row.prompt,
    code: row.code,
    answer: row.answer,
    options: row.type === 'mcq' ? (parsed as McqOption[]) : null,
    choices: row.type === 'cloze' ? (parsed as string[]) : null,
    explain: row.explain,
    state: row.state,
  };
}

/** 오늘 이미 복습한 장수 (04:00 KST 경계) */
export async function countReviewedToday(env: Env, userId: string, now: number): Promise<number> {
  const row = await env.DB.prepare('SELECT count(*) AS n FROM review_logs WHERE user_id = ?1 AND reviewed_at >= ?2')
    .bind(userId, studyDayStart(now))
    .first<{ n: number }>();
  return row?.n ?? 0;
}
