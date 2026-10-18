import { ConceptCategoryBody, MaterialBody, normalizeCategory, type CategoryNode, type MaterialSummary } from '@moai/shared';
import { Hono } from 'hono';
import type { AppEnv } from '../context';
import { categoryLookupQueries, resolveCategories } from '../domain/categories';
import { errorJson, readJson } from '../lib/http';

// 자료(PDF 등)와 분류 (설계서 §5.6). 자료 카드는 풀기 전까지 내 지식이 아니다. 분류는 저장할 때 정하고 여기서 고친다.

export const library = new Hono<AppEnv>();

interface MaterialRow {
  title: string;
  parts: string | null;
  cards: number;
  solved: number;
  unsolved_open: number;
  concepts: number;
  adopted: number;
  created_at: number;
}

library.get('/materials', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT s.material AS title, group_concat(DISTINCT s.material_part) AS parts, min(s.created_at) AS created_at,
            count(c.id) AS cards,
            sum(EXISTS (SELECT 1 FROM review_logs r WHERE r.card_id = c.id)) AS solved,
            sum(c.state = 0 AND c.status = 'active') AS unsolved_open,
            count(DISTINCT c.concept_id) AS concepts,
            count(DISTINCT CASE WHEN k.adopted_at IS NOT NULL THEN c.concept_id END) AS adopted
       FROM learning_sessions s JOIN cards c ON c.session_id = s.id JOIN concepts k ON k.id = c.concept_id
      WHERE s.user_id = ?1 AND s.material IS NOT NULL
      GROUP BY s.material ORDER BY created_at DESC LIMIT 100`,
  )
    .bind(c.var.userId)
    .all<MaterialRow>();
  const materials: MaterialSummary[] = results.map((row) => ({ ...row, parts: row.parts ? row.parts.split(',').filter(Boolean) : [] }));
  return c.json({ materials });
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
