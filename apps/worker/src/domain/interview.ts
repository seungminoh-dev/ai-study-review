import { normalizeCategory, type InterviewTopicSuggestion } from '@moai/shared';
import type { Env } from '../env';
import { DAY_MS } from '../lib/kst';
import { pickTopicConcepts } from './learner-context';
import { categoryClause } from './queue';

// 꼬리물기 모의면접 (설계서 §2.4): 연결된 개념을 이어서 묻는다. 흔들리는 개념에서 시작해 연결선을 따라간다.

const DEFAULT_LENGTH = 3;
const RECENT_MS = 14 * DAY_MS;
/** 꼬리질문으로 잘 이어지는 연결부터 따라간다 */
const EDGE_ORDER: Record<string, number> = { follow_up: 0, contrast: 1, prerequisite: 2, part_of: 3 };

interface ConceptRow {
  id: string;
  key: string;
  name: string;
  search_text: string;
}

export interface InterviewChain {
  keys: string[];
  names: string[];
}

export async function interviewChain(
  env: Env,
  userId: string,
  request: { topic?: string | undefined; concept_key?: string | undefined; length?: number | undefined; category?: string | undefined },
  now: number,
): Promise<InterviewChain | null> {
  const category = normalizeCategory(request.category);
  const [concepts, edges, weak] = await env.DB.batch([
    // 내 지식(한 번이라도 풀었거나 공부한 개념)만 묻는다. 분류를 주면 그 분류 안에서만
    env.DB.prepare(
      `SELECT id, key, name, search_text FROM concepts
        WHERE user_id = ?1 AND adopted_at IS NOT NULL
          AND ${categoryClause('domain', '?2')} LIMIT 5000`,
    ).bind(userId, category),
    env.DB.prepare('SELECT from_id, to_id, type FROM edges WHERE user_id = ?1 LIMIT 5000').bind(userId),
    // 최근에 틀린 횟수가 많은 개념이 먼저다
    env.DB.prepare(
      `SELECT c.concept_id AS id, count(*) AS fails FROM review_logs r JOIN cards c ON c.id = r.card_id
        WHERE r.user_id = ?1 AND r.grade = 1 AND r.reviewed_at >= ?2 GROUP BY c.concept_id ORDER BY fails DESC LIMIT 50`,
    ).bind(userId, now - RECENT_MS),
  ]);
  const rows = concepts!.results as unknown as ConceptRow[];
  if (rows.length === 0) return null;
  const byId = new Map(rows.map((row) => [row.id, row]));
  const fails = new Map((weak!.results as { id: string; fails: number }[]).map((row) => [row.id, row.fails]));

  let start: ConceptRow | undefined;
  if (request.concept_key) start = rows.find((row) => row.key === request.concept_key);
  else if (request.topic) start = pickTopicConcepts(request.topic, rows, 1)[0];
  else start = byId.get((weak!.results as { id: string }[])[0]?.id ?? '') ?? rows[0];
  if (!start) return null;

  // 연결은 양쪽 끝에서 모두 이웃이다
  const links = (edges!.results as { from_id: string; to_id: string; type: string }[]).flatMap((edge) => [
    { at: edge.from_id, id: edge.to_id, type: edge.type },
    { at: edge.to_id, id: edge.from_id, type: edge.type },
  ]);
  const neighbors = Map.groupBy(links, (link) => link.at);
  // 지금 개념에서 아직 안 고른 이웃 중, 꼬리질문 연결 → 많이 틀린 개념 순으로 하나씩 고른다
  const length = Math.min(Math.max(request.length ?? DEFAULT_LENGTH, 1), 5);
  const chain = [start];
  const seen = new Set([start.id]);
  while (chain.length < length) {
    const options = chain
      .flatMap((concept) => neighbors.get(concept.id) ?? [])
      .filter((option) => !seen.has(option.id) && byId.has(option.id))
      .sort((a, b) => (EDGE_ORDER[a.type] ?? 9) - (EDGE_ORDER[b.type] ?? 9) || (fails.get(b.id) ?? 0) - (fails.get(a.id) ?? 0));
    const next = options[0];
    if (!next) break;
    seen.add(next.id);
    chain.push(byId.get(next.id)!);
  }
  return { keys: chain.map((concept) => concept.key), names: chain.map((concept) => concept.name) };
}

/**
 * 모의면접 시작 화면의 추천 주제 (2026-10-21): 고른 개념, 최근에 많이 틀린 개념, 최근에 공부한 개념, 오래 안 본 개념에서 시작하는 연결.
 * 시작 개념이 같으면 하나만 둔다. AI를 부르지 않는다
 */
export async function interviewTopics(
  env: Env,
  userId: string,
  request: { concept_key?: string | undefined; category?: string | undefined },
  now: number,
): Promise<InterviewTopicSuggestion[]> {
  const [weak, recent, stale] = await env.DB.batch([
    env.DB.prepare(
      `SELECT k.key FROM review_logs r JOIN cards c ON c.id = r.card_id JOIN concepts k ON k.id = c.concept_id
        WHERE r.user_id = ?1 AND r.grade = 1 AND r.reviewed_at >= ?2 AND k.adopted_at IS NOT NULL
        GROUP BY k.id ORDER BY count(*) DESC LIMIT 1`,
    ).bind(userId, now - RECENT_MS),
    env.DB.prepare('SELECT key FROM concepts WHERE user_id = ?1 AND adopted_at IS NOT NULL ORDER BY updated_at DESC LIMIT 1').bind(userId),
    env.DB.prepare(
      `SELECT k.key FROM concepts k JOIN cards c ON c.concept_id = k.id
        WHERE k.user_id = ?1 AND k.adopted_at IS NOT NULL AND c.last_review IS NOT NULL
        GROUP BY k.id ORDER BY max(c.last_review) LIMIT 1`,
    ).bind(userId),
  ]);
  const keyOf = (result: D1Result | undefined) => (result?.results[0] as { key: string } | undefined)?.key;
  const starts = [
    { key: request.concept_key, reason: '고른 개념에서' },
    { key: keyOf(weak), reason: '최근에 많이 틀린 개념부터' },
    { key: keyOf(recent), reason: '최근에 공부한 개념부터' },
    { key: keyOf(stale), reason: '오래 안 본 개념부터' },
  ];
  const topics: InterviewTopicSuggestion[] = [];
  for (const start of starts) {
    if (!start.key) continue;
    const chain = await interviewChain(env, userId, { concept_key: start.key, category: request.category }, now);
    if (!chain || topics.some((topic) => topic.concept_key === chain.keys[0])) continue;
    topics.push({ concept_key: chain.keys[0]!, names: chain.names, reason: start.reason });
  }
  return topics;
}
