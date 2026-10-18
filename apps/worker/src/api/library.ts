import {
  ConceptCategoryBody,
  MaterialBody,
  comparePart,
  normalizeCategory,
  type CardType,
  type CategoryNode,
  type MaterialConcept,
  type MaterialDetail,
  type MaterialSummary,
} from '@moai/shared';
import { Hono } from 'hono';
import type { AppEnv } from '../context';
import { categoryLookupQueries, resolveCategories } from '../domain/categories';
import { errorJson, readJson } from '../lib/http';

// 자료(PDF 등)와 분류 (설계서 §5.6). 자료 카드는 풀기 전까지 내 지식이 아니다. 분류는 저장할 때 정하고 여기서 고친다.
// 자료 하나는 섹션(저장 하나 = learning_sessions.material_part)이 여러 개다. 섹션은 이름 끝의 쪽수 순서로 늘어놓는다.

export const library = new Hono<AppEnv>();

interface TotalsRow {
  title: string;
  cards: number;
  solved: number;
  unsolved_open: number;
  concepts: number;
  adopted: number;
  created_at: number;
}

interface PartRow {
  title: string;
  /** 섹션 이름. 없으면 빈 문자열 */
  name: string;
  created_at: number;
  cards: number;
  solved: number;
  unsolved_open: number;
}

/** 자료 전체 숫자. 개념은 섹션끼리 겹칠 수 있어 자료 단위로 따로 센다 */
const TOTALS = `SELECT s.material AS title, min(s.created_at) AS created_at,
            count(c.id) AS cards,
            sum(EXISTS (SELECT 1 FROM review_logs r WHERE r.card_id = c.id)) AS solved,
            sum(c.state = 0 AND c.status = 'active') AS unsolved_open,
            count(DISTINCT c.concept_id) AS concepts,
            count(DISTINCT CASE WHEN k.adopted_at IS NOT NULL THEN c.concept_id END) AS adopted
       FROM learning_sessions s JOIN cards c ON c.session_id = s.id JOIN concepts k ON k.id = c.concept_id
      WHERE s.user_id = ?1 AND s.material IS NOT NULL`;

/** 섹션별 숫자 */
const PARTS = `SELECT s.material AS title, coalesce(s.material_part, '') AS name, min(s.created_at) AS created_at,
            count(c.id) AS cards,
            sum(EXISTS (SELECT 1 FROM review_logs r WHERE r.card_id = c.id)) AS solved,
            sum(c.state = 0 AND c.status = 'active') AS unsolved_open
       FROM learning_sessions s JOIN cards c ON c.session_id = s.id
      WHERE s.user_id = ?1 AND s.material IS NOT NULL`;

/** 이어서 풀 섹션: 순서대로 봤을 때 안 푼 열린 카드가 남은 첫 섹션 */
function nextPart(parts: PartRow[]): MaterialSummary['next'] {
  const part = parts.find((item) => item.unsolved_open > 0);
  return part ? { part: part.name, unsolved_open: part.unsolved_open } : null;
}

function groupBy<T, K>(rows: T[], key: (row: T) => K): Map<K, T[]> {
  const groups = new Map<K, T[]>();
  for (const row of rows) groups.set(key(row), [...(groups.get(key(row)) ?? []), row]);
  return groups;
}

library.get('/materials', async (c) => {
  const [totals, parts] = await c.env.DB.batch([
    c.env.DB.prepare(`${TOTALS} GROUP BY s.material ORDER BY created_at DESC LIMIT 100`).bind(c.var.userId),
    c.env.DB.prepare(`${PARTS} GROUP BY s.material, coalesce(s.material_part, '')`).bind(c.var.userId),
  ]);
  const partsOf = groupBy(parts!.results as unknown as PartRow[], (row) => row.title);
  const materials: MaterialSummary[] = (totals!.results as unknown as TotalsRow[]).map((row) => {
    const ordered = [...(partsOf.get(row.title) ?? [])].sort(comparePart);
    return { ...row, parts: ordered.map((part) => part.name).filter(Boolean), next: nextPart(ordered) };
  });
  return c.json({ materials });
});

/** 자료 하나의 섹션별 진행, 개념, 카드 미리보기 */
library.get('/materials/detail', async (c) => {
  const title = c.req.query('title')?.slice(0, 120);
  if (!title) return errorJson(400, 'bad_request', '자료 제목이 없어요.');
  const user = c.var.userId;
  const [totals, parts, sessions, concepts, previews] = await c.env.DB.batch([
    c.env.DB.prepare(`${TOTALS} AND s.material = ?2 GROUP BY s.material`).bind(user, title),
    c.env.DB.prepare(`${PARTS} AND s.material = ?2 GROUP BY coalesce(s.material_part, '')`).bind(user, title),
    c.env.DB.prepare(`SELECT id, coalesce(material_part, '') AS name FROM learning_sessions WHERE user_id = ?1 AND material = ?2 ORDER BY created_at`).bind(user, title),
    c.env.DB.prepare(
      `SELECT DISTINCT coalesce(s.material_part, '') AS part, k.key, k.name, k.adopted_at IS NOT NULL AS adopted
         FROM learning_sessions s JOIN cards c ON c.session_id = s.id JOIN concepts k ON k.id = c.concept_id
        WHERE s.user_id = ?1 AND s.material = ?2`,
    ).bind(user, title),
    // 섹션마다 안 푼 카드부터 3장
    c.env.DB.prepare(
      `SELECT part, type, prompt FROM (
         SELECT coalesce(s.material_part, '') AS part, c.type, c.prompt,
                row_number() OVER (PARTITION BY coalesce(s.material_part, '') ORDER BY (c.state != 0), c.created_at) AS n
           FROM learning_sessions s JOIN cards c ON c.session_id = s.id
          WHERE s.user_id = ?1 AND s.material = ?2 AND c.status != 'suspended')
        WHERE n <= 3`,
    ).bind(user, title),
  ]);
  const total = totals!.results[0] as unknown as TotalsRow | undefined;
  if (!total) return errorJson(404, 'not_found', '이 자료를 찾지 못했어요.');
  // 같은 섹션을 여러 번 저장했으면 가장 최근 저장을 연다 (만든 순서로 받아 뒤의 것이 남는다)
  const latest = new Map((sessions!.results as unknown as { id: string; name: string }[]).map((row) => [row.name, row.id]));
  const conceptRows = concepts!.results as unknown as { part: string; key: string; name: string; adopted: number }[];
  const conceptsOf = groupBy(conceptRows, (row) => row.part);
  const previewsOf = groupBy(previews!.results as unknown as { part: string; type: CardType; prompt: string }[], (row) => row.part);
  const detail: MaterialDetail = {
    ...total,
    parts: [...(parts!.results as unknown as PartRow[])].sort(comparePart).map((part) => ({
      name: part.name,
      session_id: latest.get(part.name) ?? '',
      cards: part.cards,
      solved: part.solved,
      unsolved_open: part.unsolved_open,
      // 내 지식이 된 개념을 앞에 둔다
      concepts: (conceptsOf.get(part.name) ?? [])
        .map((row): MaterialConcept => ({ key: row.key, name: row.name, adopted: row.adopted === 1 }))
        .sort((a, b) => Number(b.adopted) - Number(a.adopted))
        .slice(0, 12),
      preview: (previewsOf.get(part.name) ?? []).map((row) => ({ type: row.type, prompt: row.prompt })),
    })),
  };
  return c.json(detail);
});

/** 자료에서 아직 안 푼 카드를 모두 끈다. 잘못 가져온 자료를 치울 때 쓴다. 기록 탭에서 다시 켤 수 있다 */
library.post('/materials/suspend-unsolved', async (c) => {
  const body = await readJson(c, MaterialBody);
  if (body instanceof Response) return body;
  const result = await c.env.DB.prepare(
    `UPDATE cards SET status = 'suspended'
      WHERE user_id = ?1 AND origin = 'material' AND state = 0 AND status != 'suspended'
        AND session_id IN (SELECT id FROM learning_sessions WHERE user_id = ?1 AND material = ?2)
        AND NOT EXISTS (SELECT 1 FROM review_logs r WHERE r.card_id = cards.id)`,
  )
    .bind(c.var.userId, body.title)
    .run();
  return c.json({ suspended: result.meta.changes });
});

/** 내 지식의 분류와 개념 수. 분류 필터에 쓴다 */
library.get('/categories', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT domain AS path, count(*) AS concepts FROM concepts
      WHERE user_id = ?1 AND domain IS NOT NULL AND adopted_at IS NOT NULL GROUP BY domain ORDER BY domain LIMIT 300`,
  )
    .bind(c.var.userId)
    .all<CategoryNode>();
  const unclassified = await c.env.DB.prepare('SELECT count(*) AS n FROM concepts WHERE user_id = ?1 AND domain IS NULL AND adopted_at IS NOT NULL')
    .bind(c.var.userId)
    .first<number>('n');
  return c.json({ categories: results, unclassified: unclassified ?? 0 });
});

/** 개념 하나의 분류를 고친다. null이면 분류를 지운다 */
library.patch('/concepts/:key/category', async (c) => {
  const body = await readJson(c, ConceptCategoryBody);
  if (body instanceof Response) return body;
  let path: string | null = null;
  if (body.category) {
    const [existing, aliases] = await c.env.DB.batch(categoryLookupQueries(c.env, c.var.userId));
    const normalized = normalizeCategory(body.category);
    path = normalized
      ? (resolveCategories([normalized], existing!.results as { domain: string }[], aliases!.results as { alias: string; path: string }[]).get(normalized) ?? normalized)
      : null;
  }
  const updated = await c.env.DB.prepare('UPDATE concepts SET domain = ?3, updated_at = ?4 WHERE user_id = ?1 AND key = ?2')
    .bind(c.var.userId, c.req.param('key'), path, Date.now())
    .run();
  return updated.meta.changes > 0 ? c.json({ category: path }) : errorJson(404, 'not_found', '개념을 찾지 못했어요.');
});
