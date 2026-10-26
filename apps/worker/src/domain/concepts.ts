import { searchTerms, type EdgeType, type JudgmentLabel } from '@moai/shared';
import type { Env } from '../env';
import { DAY_MS } from '../lib/kst';
import { categoriesQuery, type CategoryCount } from './categories';
import { LADDER_STABILITY_DAYS } from './ladder';

// 개념 찾기와 상태 (설계서 §6.6, §9.7)

/** 자료: PDF 같은 자료에서만 나왔고 아직 한 번도 풀지 않은 개념 (내 지식이 아니다) */
export type ConceptState = '아직 안 배움' | '익숙함' | '흔들림' | '자료';

/** 최근 이 기간에 틀린 적이 없어야 익숙함이다 */
const FAMILIAR_WINDOW_MS = 14 * DAY_MS;

export interface ConceptRow {
  id: string;
  key: string;
  name: string;
  aliases: string;
  final_answer: string | null;
  domain?: string | null;
}

export interface LastJudgment {
  label: JudgmentLabel;
  said: string | null;
  note: string;
  created_at: number;
}

export interface FoundConcept {
  id: string;
  key: string;
  name: string;
  aliases: string[];
  category: string | null;
  state: ConceptState;
  last_judgment: LastJudgment | null;
}

export interface RelatedConcept extends FoundConcept {
  /** 찾은 개념 쪽에서 본 연결 */
  via: { key: string; type: EdgeType; direction: 'to' | 'from' };
}

/** 카드가 없으면 아직 안 배움, 활성 카드가 모두 익었고 최근 14일 동안 틀린 적이 없으면 익숙함, 나머지는 흔들림 */
export function conceptState(stats: { cards: number; active: number; unstable: number; recent_fails: number; adopted?: number }): ConceptState {
  if (stats.adopted === 0) return '자료';
  if (stats.cards === 0) return '아직 안 배움';
  if (stats.active > 0 && stats.unstable === 0 && stats.recent_fails === 0) return '익숙함';
  return '흔들림';
}

/** statsQuery가 돌려주는 개념마다의 카드 집계 */
export interface StatsRow {
  id: string;
  cards: number;
  active: number;
  unstable: number;
  recent_fails: number;
  adopted: number;
}

/** 아직 안 푼 자료 카드는 개념 상태에 넣지 않는다. 풀기 전에는 익숙함을 흔들림으로 바꾸지 않는다 */
const SOLVABLE = "NOT (c.origin = 'material' AND c.state = 0)";

export function statsQuery(env: Env, ids: readonly string[], now: number): D1PreparedStatement {
  return env.DB.prepare(
    `SELECT k.value AS id,
            (SELECT count(*) FROM cards c WHERE c.concept_id = k.value) AS cards,
            (SELECT count(*) FROM cards c WHERE c.concept_id = k.value AND c.status = 'active' AND ${SOLVABLE}) AS active,
            (SELECT count(*) FROM cards c WHERE c.concept_id = k.value AND c.status = 'active' AND ${SOLVABLE} AND c.stability < ${LADDER_STABILITY_DAYS}) AS unstable,
            (SELECT count(*) FROM cards c JOIN review_logs r ON r.card_id = c.id
              WHERE c.concept_id = k.value AND r.grade = 1 AND r.reviewed_at >= ?2) AS recent_fails,
            (SELECT adopted_at IS NOT NULL FROM concepts WHERE id = k.value) AS adopted
       FROM json_each(?1) AS k`,
  ).bind(JSON.stringify(ids), now - FAMILIAR_WINDOW_MS);
}

export function statesFrom(rows: readonly StatsRow[]): Map<string, ConceptState> {
  return new Map(rows.map((row) => [row.id, conceptState(row)]));
}

export function lastJudgmentsQuery(env: Env, ids: readonly string[]): D1PreparedStatement {
  return env.DB.prepare(
    `SELECT j.concept_id, j.label, j.said, j.note, j.created_at
       FROM judgments j
      WHERE j.concept_id IN (SELECT value FROM json_each(?1))
        AND j.created_at = (SELECT max(created_at) FROM judgments WHERE concept_id = j.concept_id)`,
  ).bind(JSON.stringify(ids));
}

function parseAliases(aliases: string): string[] {
  try {
    const parsed = JSON.parse(aliases) as unknown;
    return Array.isArray(parsed) ? parsed.filter((alias): alias is string => typeof alias === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * query를 쉼표로 나눠 이름마다 search_text에서 찾는다. 찾은 개념과 바로 연결된 개념도 돌려준다.
 */
export async function findConcepts(
  env: Env,
  userId: string,
  query: string,
  limit: number,
  now: number,
): Promise<{ found: FoundConcept[]; related: RelatedConcept[]; categories: CategoryCount[] }> {
  const terms = searchTerms(query);
  const match = `SELECT DISTINCT k.id, k.key, k.name, k.aliases, k.final_answer, k.domain
       FROM concepts k, json_each(?2) AS t
      WHERE k.user_id = ?1 AND instr(k.search_text, t.value) > 0
      LIMIT ?3`;
  // 찾기와 연결 읽기를 한 번의 왕복으로 한다. MCP 요청은 미국에서, D1은 APAC에 있다
  // 기존 분류 목록도 함께 준다. Claude가 새 개념에 같은 분류 이름을 고르게 한다
  const [matched, edgeRows, categoryRows] = await env.DB.batch([
    env.DB.prepare(match).bind(userId, JSON.stringify(terms), limit),
    env.DB.prepare(
      `WITH m AS (SELECT id FROM (${match}))
       SELECT e.from_id, e.to_id, e.type, f.key AS from_key, t.key AS to_key
         FROM edges e JOIN concepts f ON f.id = e.from_id JOIN concepts t ON t.id = e.to_id
        WHERE e.user_id = ?1 AND (e.from_id IN (SELECT id FROM m) OR e.to_id IN (SELECT id FROM m))
        LIMIT 60`,
    ).bind(userId, JSON.stringify(terms), limit),
    categoriesQuery(env, userId),
  ]);
  const categories = categoryRows!.results as unknown as CategoryCount[];
  const found = matched!.results as unknown as ConceptRow[];
  if (found.length === 0) return { found: [], related: [], categories };
  const foundIds = found.map((concept) => concept.id);
  const edges = { results: edgeRows!.results as unknown as { from_id: string; to_id: string; type: EdgeType; from_key: string; to_key: string }[] };

  const foundSet = new Set(foundIds);
  const via = new Map<string, RelatedConcept['via']>();
  for (const edge of edges.results) {
    if (foundSet.has(edge.from_id) && !foundSet.has(edge.to_id) && !via.has(edge.to_id)) {
      via.set(edge.to_id, { key: edge.from_key, type: edge.type, direction: 'to' });
    }
    if (foundSet.has(edge.to_id) && !foundSet.has(edge.from_id) && !via.has(edge.from_id)) {
      via.set(edge.from_id, { key: edge.to_key, type: edge.type, direction: 'from' });
    }
  }
  const relatedIds = [...via.keys()];
  const allIds = [...foundIds, ...relatedIds];
  const [relatedRows, stats, judgments] = await env.DB.batch([
    env.DB.prepare('SELECT id, key, name, aliases, final_answer, domain FROM concepts WHERE user_id = ?1 AND id IN (SELECT value FROM json_each(?2))').bind(
      userId,
      JSON.stringify(relatedIds),
    ),
    statsQuery(env, allIds, now),
    lastJudgmentsQuery(env, allIds),
  ]);
  const states = statesFrom(stats!.results as unknown as StatsRow[]);
  const lastByConcept = new Map((judgments!.results as unknown as (LastJudgment & { concept_id: string })[]).map((row) => [row.concept_id, row]));
  const describe = (row: ConceptRow): FoundConcept => {
    const last = lastByConcept.get(row.id);
    return {
      id: row.id,
      key: row.key,
      name: row.name,
      aliases: parseAliases(row.aliases),
      category: row.domain ?? null,
      state: states.get(row.id) ?? '아직 안 배움',
      last_judgment: last ? { label: last.label, said: last.said, note: last.note, created_at: last.created_at } : null,
    };
  };
  return {
    found: found.map(describe),
    related: (relatedRows!.results as unknown as ConceptRow[]).map((row) => ({ ...describe(row), via: via.get(row.id)! })),
    categories,
  };
}

export { parseAliases };
