import {
  CategoryRenameBody,
  ConceptCategoryBody,
  MaterialBody,
  MaterialLabelBody,
  MaterialPartLabelBody,
  comparePart,
  materialLabel,
  type CardType,
  type CategoryManage,
  type CategoryNode,
  type CategoryRenameResult,
  type MaterialConcept,
  type MaterialDetail,
  type MaterialSummary,
} from '@moai/shared';
import { Hono } from 'hono';
import type { AppEnv } from '../context';
import { categoryLookupQueries, categoryOverview, resolveCategories, resolvedCategory, updateCategories } from '../domain/categories';
import { errorJson, readJson } from '../lib/http';
import { deleteSessions } from './sessions';

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
  studied_at: number | null;
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
            count(DISTINCT CASE WHEN k.adopted_at IS NOT NULL THEN c.concept_id END) AS adopted,
            max((SELECT max(r.reviewed_at) FROM review_logs r WHERE r.card_id = c.id)) AS studied_at
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

/** 사용자가 바꾼 자료 이름 */
const LABELS = 'SELECT material, label FROM material_labels WHERE user_id = ?1';

/** 사용자가 바꾼 섹션 이름 */
const PART_LABELS = 'SELECT material, part, label FROM material_part_labels WHERE user_id = ?1';

const partLabelsOf = (rows: D1Result, title: string): Record<string, string> =>
  Object.fromEntries((rows.results as { material: string; part: string; label: string }[]).filter((row) => row.material === title).map((row) => [row.part, row.label]));

const nameOf = (labels: D1Result, title: string) =>
  (labels.results as { material: string; label: string }[]).find((row) => row.material === title)?.label ?? materialLabel(title);

library.get('/materials', async (c) => {
  const [totals, parts, labels, partLabels] = await c.env.DB.batch([
    c.env.DB.prepare(`${TOTALS} GROUP BY s.material ORDER BY created_at DESC LIMIT 100`).bind(c.var.userId),
    c.env.DB.prepare(`${PARTS} GROUP BY s.material, coalesce(s.material_part, '')`).bind(c.var.userId),
    c.env.DB.prepare(LABELS).bind(c.var.userId),
    c.env.DB.prepare(PART_LABELS).bind(c.var.userId),
  ]);
  const partsOf = Map.groupBy(parts!.results as unknown as PartRow[], (row) => row.title);
  const materials: MaterialSummary[] = (totals!.results as unknown as TotalsRow[]).map((row) => {
    const ordered = [...(partsOf.get(row.title) ?? [])].sort(comparePart);
    // 이름 없는 섹션('')도 한 섹션으로 센다. 자료 상세와 같아야 섹션 수와 번호가 맞는다 (#18)
    return { ...row, name: nameOf(labels!, row.title), parts: ordered.map((part) => part.name), next: nextPart(ordered), part_labels: partLabelsOf(partLabels!, row.title) };
  });
  return c.json({ materials });
});

/** 자료 하나의 섹션별 진행, 개념, 카드 미리보기 */
library.get('/materials/detail', async (c) => {
  const title = c.req.query('title')?.slice(0, 120);
  if (!title) return errorJson(400, 'bad_request', '자료 제목이 없어요.');
  const user = c.var.userId;
  const [totals, parts, sessions, concepts, previews, labels, partLabels] = await c.env.DB.batch([
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
    c.env.DB.prepare(`${LABELS} AND material = ?2`).bind(user, title),
    c.env.DB.prepare(`${PART_LABELS} AND material = ?2`).bind(user, title),
  ]);
  const total = totals!.results[0] as unknown as TotalsRow | undefined;
  if (!total) return errorJson(404, 'not_found', '이 자료를 찾지 못했어요.');
  // 같은 섹션을 여러 번 저장했으면 저장마다 카드 보기를 둔다. 하나만 열면 앞 저장에서 끈 카드를 다시 켤 수 없다 (#19)
  const sessionsOf = Map.groupBy(sessions!.results as unknown as { id: string; name: string }[], (row) => row.name);
  const conceptRows = concepts!.results as unknown as { part: string; key: string; name: string; adopted: number }[];
  const conceptsOf = Map.groupBy(conceptRows, (row) => row.part);
  const previewsOf = Map.groupBy(previews!.results as unknown as { part: string; type: CardType; prompt: string }[], (row) => row.part);
  const detail: MaterialDetail = {
    ...total,
    name: nameOf(labels!, total.title),
    part_labels: partLabelsOf(partLabels!, total.title),
    parts: [...(parts!.results as unknown as PartRow[])].sort(comparePart).map((part) => ({
      name: part.name,
      session_id: sessionsOf.get(part.name)?.at(-1)?.id ?? '',
      session_ids: (sessionsOf.get(part.name) ?? []).map((row) => row.id),
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

/**
 * 자료 이름 바꾸기. 원래 이름(learning_sessions.material)은 두고 보여 줄 이름만 바꾼다.
 * Claude가 같은 PDF의 다음 장을 원래 이름으로 저장해도 같은 자료로 이어진다. 비우면 원래 이름으로 돌아간다
 */
library.put('/materials/label', async (c) => {
  const body = await readJson(c, MaterialLabelBody);
  if (body instanceof Response) return body;
  const user = c.var.userId;
  const owned = await c.env.DB.prepare('SELECT 1 FROM learning_sessions WHERE user_id = ?1 AND material = ?2 LIMIT 1').bind(user, body.title).first();
  if (!owned) return errorJson(404, 'not_found', '이 자료를 찾지 못했어요.');
  if (body.label) {
    await c.env.DB.prepare(
      `INSERT INTO material_labels (user_id, material, label, updated_at) VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT (user_id, material) DO UPDATE SET label = excluded.label, updated_at = excluded.updated_at`,
    )
      .bind(user, body.title, body.label, Date.now())
      .run();
  } else {
    await c.env.DB.prepare('DELETE FROM material_labels WHERE user_id = ?1 AND material = ?2').bind(user, body.title).run();
  }
  return c.json({ name: body.label || materialLabel(body.title) });
});

/** 자료 섹션 이름 바꾸기. 원래 섹션 이름(복습 주소에도 쓴다)은 두고 보여 줄 이름만 바꾼다. 비우면 원래 이름으로 돌아간다 */
library.put('/materials/part-label', async (c) => {
  const body = await readJson(c, MaterialPartLabelBody);
  if (body instanceof Response) return body;
  const user = c.var.userId;
  const owned = await c.env.DB.prepare("SELECT 1 FROM learning_sessions WHERE user_id = ?1 AND material = ?2 AND coalesce(material_part, '') = ?3 LIMIT 1")
    .bind(user, body.title, body.part)
    .first();
  if (!owned) return errorJson(404, 'not_found', '이 섹션을 찾지 못했어요.');
  if (body.label) {
    await c.env.DB.prepare(
      `INSERT INTO material_part_labels (user_id, material, part, label, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT (user_id, material, part) DO UPDATE SET label = excluded.label, updated_at = excluded.updated_at`,
    )
      .bind(user, body.title, body.part, body.label, Date.now())
      .run();
  } else {
    await c.env.DB.prepare('DELETE FROM material_part_labels WHERE user_id = ?1 AND material = ?2 AND part = ?3').bind(user, body.title, body.part).run();
  }
  return c.json({ label: body.label || null });
});

/** 자료에서 아직 안 푼 카드를 모두 끈다. 잘못 가져온 자료를 치울 때 쓴다. 자료 상세의 섹션 카드 보기에서 다시 켤 수 있다 */
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

/** 자료를 모든 섹션째 지운다. 되돌릴 수 없다 (개선점 18) */
library.post('/materials/delete', async (c) => {
  const body = await readJson(c, MaterialBody);
  if (body instanceof Response) return body;
  const { results } = await c.env.DB.prepare('SELECT id FROM learning_sessions WHERE user_id = ?1 AND material = ?2').bind(c.var.userId, body.title).all<{ id: string }>();
  if (results.length === 0) return errorJson(404, 'not_found', '자료를 찾지 못했어요.');
  await deleteSessions(c.env, c.var.userId, results.map((row) => row.id), Date.now());
  return c.json({ deleted: results.length });
});

/** 내 지식의 분류와 개념 수. 분류 필터에 쓴다 */
/** 분류 관리: 분류마다 공부한 개념과 자료 개념 수 (옮기면 둘 다 옮겨진다) */
library.get('/categories/manage', async (c) => {
  const { categories } = await categoryOverview(c.env, c.var.userId);
  const body: CategoryManage = { categories: [...categories].sort((a, b) => a.path.localeCompare(b.path, 'ko')) };
  return c.json(body);
});

/** 분류 옮기기·이름 바꾸기. 채팅의 update_categories와 같은 규칙이다 (옛 이름을 남기고, 3단계를 넘으면 잘라서 합친다) */
library.post('/categories/rename', async (c) => {
  const body = await readJson(c, CategoryRenameBody);
  if (body instanceof Response) return body;
  const result = await updateCategories(c.env, c.var.userId, { assign: [], rename: [{ from: body.from, to: body.to }], dry_run: body.dry_run }, Date.now());
  const response: CategoryRenameResult = { renamed: result.renamed, moves: result.moves, merged: result.merged, ...(result.dry_run ? { dry_run: true as const } : {}) };
  return c.json(response);
});

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
    path = resolvedCategory(resolveCategories([body.category], existing!.results as { domain: string }[], aliases!.results as { alias: string; path: string }[]), body.category);
  }
  const updated = await c.env.DB.prepare('UPDATE concepts SET domain = ?3, updated_at = ?4 WHERE user_id = ?1 AND key = ?2')
    .bind(c.var.userId, c.req.param('key'), path, Date.now())
    .run();
  return updated.meta.changes > 0 ? c.json({ category: path }) : errorJson(404, 'not_found', '개념을 찾지 못했어요.');
});
