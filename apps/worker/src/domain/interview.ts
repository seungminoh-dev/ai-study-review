import { normalizeCategory } from '@moai/shared';
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

  const neighbors = new Map<string, { id: string; type: string }[]>();
  for (const edge of edges!.results as { from_id: string; to_id: string; type: string }[]) {
    for (const [a, b] of [
      [edge.from_id, edge.to_id],
      [edge.to_id, edge.from_id],
    ] as const) {
      const list = neighbors.get(a) ?? [];
      list.push({ id: b, type: edge.type });
      neighbors.set(a, list);
    }
  }
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
