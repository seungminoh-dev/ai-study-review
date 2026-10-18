import type { McqOption, QueueCard } from '@moai/shared';
import type { Env } from '../env';
import { studyDayStart } from '../lib/kst';
import { pickFsrsFields, previewIntervals, type FsrsFields } from './fsrs';

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
 * 같은 개념은 하루 1장이다. 개념을 먼저 거르고 나서 상한을 센다. 상한을 먼저 자르면, 같은 개념의 카드가 몰려 있을 때
 * 상한보다 적게 나온다.
 */
export function selectQueue<T extends QueueCandidate>(candidates: readonly T[], limits: QueueLimits): T[] {
  const byDue = (a: T, b: T) => a.due - b.due;
  const learning = candidates.filter((card) => card.state === 1 || card.state === 3).sort(byDue);
  const review = candidates.filter((card) => card.state === 2).sort(byDue);
  const fresh = candidates.filter((card) => card.state === 0).sort((a, b) => a.created_at - b.created_at);

  let reviewsLeft = Math.max(0, limits.reviewLimit - limits.reviewsDone);
  let newLeft = Math.max(0, limits.newLimit - limits.newSeen);
  const picked: T[] = [];
  const concepts = new Set<string>();
  for (const card of [...learning, ...review, ...fresh]) {
    if (concepts.has(card.concept_id)) continue;
    if (limits.reviewedConcepts.has(card.concept_id) && !limits.reviewedCards.has(card.id)) continue;
    if (card.state === 2) {
      if (reviewsLeft === 0) continue;
      reviewsLeft -= 1;
    }
    if (card.state === 0) {
      if (newLeft === 0) continue;
      newLeft -= 1;
    }
    concepts.add(card.concept_id);
    picked.push(card);
  }
  return picked;
}

interface CandidateRow extends QueueCandidate, FsrsFields {
  concept_key: string;
  concept_name: string;
  type: QueueCard['type'];
  rung: number;
  prompt: string;
  code: string | null;
  answer: string | null;
  options: string | null;
  explain: string | null;
  checklist: string | null;
  final_answer: string | null;
}

/**
 * 분류 필터: 그 분류와 그 아래 분류. 대소문자는 가리지 않는다 (0006 전에 저장한 분류는 정규화 전 표기일 수 있다).
 * param이 NULL이면 거르지 않는다.
 */
export function categoryClause(column: string, param: string): string {
  return `(${param} IS NULL OR lower(${column}) = lower(${param}) OR substr(lower(${column}), 1, length(${param}) + 1) = lower(${param}) || '/')`;
}

/** 후보는 넉넉히 읽되 끝없이 읽지는 않는다. 종류마다 따로 읽어서, 밀린 새 카드가 복습 카드를 밀어내지 않게 한다 */
const CANDIDATE_LIMIT = 200;

/**
 * 후보 카드. ?3은 분류 필터(없으면 NULL): 그 분류와 그 아래 분류의 개념만 고른다.
 * 자료에서 만든 카드는 한 번 풀기 전(state 0)에는 넣지 않는다. 자료 화면에서 "이 자료 풀기"로만 처음 푼다.
 */
const CANDIDATES = `SELECT c.id, c.concept_id, c.state, c.due, c.created_at, c.type, c.rung, c.prompt, c.code, c.answer, c.options, c.explain,
                          c.checklist, c.stability, c.difficulty, c.elapsed_days, c.scheduled_days, c.learning_steps, c.reps, c.lapses,
                          c.last_review, k.key AS concept_key, k.name AS concept_name, k.final_answer
                     FROM cards c JOIN concepts k ON k.id = c.concept_id
                    WHERE c.user_id = ?1 AND c.status = 'active' AND c.due <= ?2
                      AND NOT (c.origin = 'material' AND c.state = 0)
                      AND ${categoryClause('k.domain', '?3')}`;

export interface QueueFilter {
  /** 이 분류(와 그 아래)만 */
  category?: string | null | undefined;
}

/** 오늘 복습할 카드 전체를 순서대로 돌려준다. 앞에서 원하는 장수만 쓴다. */
export async function loadTodayQueue(env: Env, userId: string, now: number, filter: QueueFilter = {}): Promise<QueueCard[]> {
  const dayStart = studyDayStart(now);
  const category = filter.category ?? null;
  const [learning, review, fresh, today, user] = await env.DB.batch([
    env.DB.prepare(`${CANDIDATES} AND c.state IN (1, 3) ORDER BY c.due LIMIT ${CANDIDATE_LIMIT}`).bind(userId, now, category),
    env.DB.prepare(`${CANDIDATES} AND c.state = 2 ORDER BY c.due LIMIT ${CANDIDATE_LIMIT}`).bind(userId, now, category),
    env.DB.prepare(`${CANDIDATES} AND c.state = 0 ORDER BY c.created_at LIMIT ${CANDIDATE_LIMIT}`).bind(userId, now, category),
    env.DB.prepare(
      `SELECT r.card_id, c.concept_id, c.origin, json_extract(r.prev_card, '$.state') AS prev_state
         FROM review_logs r JOIN cards c ON c.id = r.card_id
        WHERE r.user_id = ?1 AND r.reviewed_at >= ?2`,
    ).bind(userId, dayStart),
    env.DB.prepare('SELECT daily_new_limit, daily_review_limit FROM users WHERE id = ?1').bind(userId),
  ]);
  const candidates = [...learning!.results, ...review!.results, ...fresh!.results] as unknown as CandidateRow[];

  const logs = today!.results as { card_id: string; concept_id: string; origin: string; prev_state: number }[];
  const limitsRow = user!.results[0] as { daily_new_limit: number; daily_review_limit: number } | undefined;
  // 자료를 처음 푼 카드는 하루 새 카드 상한에 넣지 않는다. 자료 풀기는 상한과 따로 간다
  const newCards = new Set(logs.filter((log) => log.prev_state === 0 && log.origin !== 'material').map((log) => log.card_id));
  const reviewCards = new Set(logs.filter((log) => log.prev_state === 2).map((log) => log.card_id));
  const picked = selectQueue(candidates, {
    newLimit: limitsRow?.daily_new_limit ?? 10,
    reviewLimit: limitsRow?.daily_review_limit ?? 30,
    newSeen: newCards.size,
    reviewsDone: reviewCards.size,
    reviewedConcepts: new Set(logs.map((log) => log.concept_id)),
    reviewedCards: new Set(logs.map((log) => log.card_id)),
  });
  return picked.map((row) => toQueueCard(row, now));
}

/**
 * 자료 하나를 푼다 ("이 자료 풀기"). 그 자료에서 만든 카드 중 지금 풀 수 있는 것을, 이미 푼 것(복습할 때가 된 것) → 아직 안 푼 것 순으로 준다.
 * 사용자가 직접 고른 학습이라 하루 새 카드 상한과 "같은 개념 하루 1장"은 적용하지 않는다. 사다리(잠긴 단계)는 그대로다.
 */
export async function loadMaterialQueue(
  env: Env,
  userId: string,
  material: string,
  now: number,
  size: number,
): Promise<{ cards: QueueCard[]; remaining: number }> {
  const from = `FROM cards c JOIN concepts k ON k.id = c.concept_id JOIN learning_sessions s ON s.id = c.session_id
      WHERE c.user_id = ?1 AND s.user_id = ?1 AND s.material = ?2 AND c.status = 'active' AND c.due <= ?3`;
  const [rows, count] = await env.DB.batch([
    env.DB.prepare(
      `SELECT c.id, c.concept_id, c.state, c.due, c.created_at, c.type, c.rung, c.prompt, c.code, c.answer, c.options, c.explain,
              c.checklist, c.stability, c.difficulty, c.elapsed_days, c.scheduled_days, c.learning_steps, c.reps, c.lapses,
              c.last_review, k.key AS concept_key, k.name AS concept_name, k.final_answer
         ${from}
        ORDER BY (c.state = 0), c.due, s.created_at, c.created_at
        LIMIT ?4`,
    ).bind(userId, material, now, size),
    env.DB.prepare(`SELECT count(*) AS n ${from}`).bind(userId, material, now),
  ]);
  return {
    cards: (rows!.results as unknown as CandidateRow[]).map((row) => toQueueCard(row, now)),
    remaining: (count!.results[0] as { n: number } | undefined)?.n ?? 0,
  };
}

function toQueueCard(row: CandidateRow, now: number): QueueCard {
  const parsed = row.options ? (JSON.parse(row.options) as unknown) : null;
  const explain = row.type === 'explain';
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
    checklist: explain && row.checklist ? (JSON.parse(row.checklist) as string[]) : null,
    final_answer: explain ? row.final_answer : null,
    intervals: explain ? previewIntervals(pickFsrsFields(row), now) : null,
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
