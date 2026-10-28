import { SessionTopicBody, materialLabel, type CardStatus, type CardType, type JudgmentLabel, type McqOption, type SessionCard, type SessionDetail, type SessionSummary } from '@moai/shared';
import { Hono } from 'hono';
import type { AppEnv } from '../context';
import { cardsToUnlock, stuckCards, type LadderCard } from '../domain/ladder';
import { openLocked, setCardSuspended } from '../domain/reviews';
import type { Env } from '../env';
import { errorJson, readJson } from '../lib/http';

// 공부한 대화와 카드 끄기 (설계서 §7.2, §12.1)

export const sessions = new Hono<AppEnv>();

interface SessionRow {
  id: string;
  topic: string;
  source: string;
  material: string | null;
  material_label: string | null;
  created_at: number;
  counts: string;
}

export async function listSessions(env: Env, userId: string, limit: number): Promise<SessionSummary[]> {
  const { results } = await env.DB.prepare(
    `SELECT s.id, s.topic, s.source, s.material, l.label AS material_label, s.created_at, s.counts
       FROM learning_sessions s LEFT JOIN material_labels l ON l.user_id = s.user_id AND l.material = s.material
      WHERE s.user_id = ?1 ORDER BY s.created_at DESC LIMIT ?2`,
  )
    .bind(userId, limit)
    .all<SessionRow>();
  return results.map((row) => {
    const counts = JSON.parse(row.counts) as { concepts?: number; cards?: number };
    return {
      id: row.id,
      topic: row.topic,
      source: row.source,
      material: row.material,
      material_name: row.material ? (row.material_label ?? materialLabel(row.material)) : null,
      created_at: row.created_at,
      concepts: counts.concepts ?? 0,
      cards: counts.cards ?? 0,
    };
  });
}

sessions.get('/sessions', async (c) => c.json({ sessions: await listSessions(c.env, c.var.userId, 50) }));

/** 저장한 대화 이름 바꾸기 */
sessions.patch('/sessions/:id', async (c) => {
  const body = await readJson(c, SessionTopicBody);
  if (body instanceof Response) return body;
  const { meta } = await c.env.DB.prepare('UPDATE learning_sessions SET topic = ?3 WHERE id = ?1 AND user_id = ?2')
    .bind(c.req.param('id'), c.var.userId, body.topic)
    .run();
  if (meta.changes === 0) return errorJson(404, 'not_found', '이 기록을 찾지 못했어요.');
  return c.json({ topic: body.topic });
});

/**
 * 공부한 대화(자료는 섹션)를 지운다. 되돌릴 수 없어서 한 batch(트랜잭션)로 한다 (개선점 18).
 * 대화의 카드와 그 복습 기록·신고·끝난 AI 작업, 판정, 다음에 볼 질문을 지운다. 그 대화가 다룬 개념(과 연결로 이어진 개념) 중
 * 다른 대화에 카드·판정·질문이 남지 않은 것은 연결과 함께 지운다. 개념이 남으면 사다리를 다시 맞춘다 (아래 단계가 지워져 잠긴 채 남는 카드를 연다)
 */
export async function deleteSessions(env: Env, userId: string, ids: readonly string[], now: number): Promise<void> {
  const list = JSON.stringify(ids);
  const inList = 'SELECT value FROM json_each(?2)';
  const [candidates, ladder] = await env.DB.batch([
    env.DB.prepare(
      `WITH touched AS (
         SELECT concept_id AS id FROM cards WHERE user_id = ?1 AND session_id IN (${inList})
         UNION SELECT concept_id FROM judgments WHERE user_id = ?1 AND session_id IN (${inList})
         UNION SELECT concept_id FROM followups WHERE user_id = ?1 AND session_id IN (${inList}))
       SELECT id FROM touched
       UNION SELECT to_id FROM edges WHERE user_id = ?1 AND from_id IN (SELECT id FROM touched)
       UNION SELECT from_id FROM edges WHERE user_id = ?1 AND to_id IN (SELECT id FROM touched)`,
    ).bind(userId, list),
    env.DB.prepare(
      `SELECT id, concept_id, session_id, rung, status, stability, origin, state FROM cards
        WHERE user_id = ?1 AND concept_id IN (SELECT concept_id FROM cards WHERE user_id = ?1 AND session_id IN (${inList}))`,
    ).bind(userId, list),
  ]);
  const concepts = JSON.stringify((candidates!.results as { id: string }[]).map((row) => row.id));
  const gone = new Set(ids);
  const left = (ladder!.results as (LadderCard & { session_id: string })[]).filter((card) => !gone.has(card.session_id));
  const unlock = [...cardsToUnlock(left), ...stuckCards(left)];

  const sessionCards = `SELECT id FROM cards WHERE user_id = ?1 AND session_id IN (${inList})`;
  const orphans = `SELECT t.value FROM json_each(?2) t
      WHERE NOT EXISTS (SELECT 1 FROM cards WHERE concept_id = t.value) AND NOT EXISTS (SELECT 1 FROM judgments WHERE concept_id = t.value)
        AND NOT EXISTS (SELECT 1 FROM followups WHERE concept_id = t.value)`;
  const run = (sql: string, values = list) => env.DB.prepare(sql).bind(userId, values);
  await env.DB.batch([
    // 그 카드의 AI 채점과 그 대화를 만든 가져오기 (결과에 요약이 남는다). 진행 중인 작업은 끝난 뒤 30일 정리가 지운다
    run(
      `DELETE FROM llm_jobs WHERE user_id = ?1 AND status IN ('done', 'failed')
         AND (card_id IN (${sessionCards}) OR CASE WHEN json_valid(result) THEN json_extract(result, '$.session_id') END IN (${inList}))`,
    ),
    run(`DELETE FROM review_logs WHERE card_id IN (${sessionCards})`),
    run(`DELETE FROM card_reports WHERE card_id IN (${sessionCards})`),
    run(`DELETE FROM cards WHERE user_id = ?1 AND session_id IN (${inList})`),
    run(`DELETE FROM judgments WHERE user_id = ?1 AND session_id IN (${inList})`),
    run(`DELETE FROM followups WHERE user_id = ?1 AND session_id IN (${inList})`),
    run(`DELETE FROM edges WHERE user_id = ?1 AND (from_id IN (${orphans}) OR to_id IN (${orphans}))`, concepts),
    run(`DELETE FROM concepts WHERE user_id = ?1 AND id IN (${orphans})`, concepts),
    run(`DELETE FROM learning_sessions WHERE user_id = ?1 AND id IN (${inList})`),
    // 섹션이 하나도 남지 않은 자료의 바꾼 이름
    env.DB.prepare('DELETE FROM material_labels WHERE user_id = ?1 AND NOT EXISTS (SELECT 1 FROM learning_sessions s WHERE s.user_id = ?1 AND s.material = material_labels.material)').bind(userId),
    env.DB.prepare(
      `DELETE FROM material_part_labels WHERE user_id = ?1
          AND NOT EXISTS (SELECT 1 FROM learning_sessions s WHERE s.user_id = ?1 AND s.material = material_part_labels.material AND coalesce(s.material_part, '') = material_part_labels.part)`,
    ).bind(userId),
    ...(unlock.length > 0
      ? [openLocked(env, userId, unlock, now)]
      : []),
  ]);
}

/** 공부한 대화 하나를 지운다. 자료 섹션이면 그 섹션만 (자료 전체는 POST /materials/delete) */
sessions.delete('/sessions/:id', async (c) => {
  const id = c.req.param('id');
  const found = await c.env.DB.prepare('SELECT id FROM learning_sessions WHERE id = ?1 AND user_id = ?2').bind(id, c.var.userId).first();
  if (!found) return errorJson(404, 'not_found', '공부한 대화를 찾지 못했어요.');
  await deleteSessions(c.env, c.var.userId, [id], Date.now());
  return c.body(null, 204);
});

interface CardRow {
  id: string;
  concept_key: string;
  concept_name: string;
  type: CardType;
  rung: number;
  status: CardStatus;
  prompt: string;
  code: string | null;
  answer: string | null;
  options: string | null;
  explain: string | null;
  checklist: string | null;
}

sessions.get('/sessions/:id', async (c) => {
  const id = c.req.param('id');
  const userId = c.var.userId;
  const [session, cards, judgments, followups] = await c.env.DB.batch([
    c.env.DB.prepare('SELECT id, topic, source, final_answer, key_terms, created_at FROM learning_sessions WHERE id = ?1 AND user_id = ?2').bind(id, userId),
    c.env.DB.prepare(
      `SELECT c.id, k.key AS concept_key, k.name AS concept_name, c.type, c.rung, c.status, c.prompt, c.code, c.answer, c.options, c.explain, c.checklist
         FROM cards c JOIN concepts k ON k.id = c.concept_id
        WHERE c.session_id = ?1 AND c.user_id = ?2 ORDER BY c.created_at, c.rung`,
    ).bind(id, userId),
    c.env.DB.prepare(
      `SELECT j.id, k.key AS concept_key, k.name AS concept_name, j.label, j.said, j.note
         FROM judgments j JOIN concepts k ON k.id = j.concept_id
        WHERE j.session_id = ?1 AND j.user_id = ?2 ORDER BY j.created_at`,
    ).bind(id, userId),
    c.env.DB.prepare(
      `SELECT f.id, k.key AS concept_key, k.name AS concept_name, f.question, f.resolved_at
         FROM followups f JOIN concepts k ON k.id = f.concept_id
        WHERE f.session_id = ?1 AND f.user_id = ?2 ORDER BY f.created_at`,
    ).bind(id, userId),
  ]);
  const row = session!.results[0] as { id: string; topic: string; source: string; final_answer: string | null; key_terms: string; created_at: number } | undefined;
  if (!row) return errorJson(404, 'not_found', '공부한 대화를 찾지 못했어요.');

  const cardRows = cards!.results as unknown as CardRow[];
  const judgmentRows = judgments!.results as unknown as { id: string; concept_key: string; concept_name: string; label: JudgmentLabel; said: string | null; note: string }[];
  const followupRows = followups!.results as unknown as { id: string; concept_key: string; concept_name: string; question: string; resolved_at: number | null }[];
  const concepts = new Map<string, string>();
  for (const item of [...judgmentRows, ...cardRows, ...followupRows]) concepts.set(item.concept_key, item.concept_name);

  const body: SessionDetail = {
    id: row.id,
    topic: row.topic,
    source: row.source,
    created_at: row.created_at,
    final_answer: row.final_answer,
    key_terms: JSON.parse(row.key_terms) as string[],
    concepts: [...concepts].map(([key, name]) => ({ key, name })),
    judgments: judgmentRows.map(({ id: judgmentId, concept_name, label, said, note }) => ({ id: judgmentId, concept_name, label, said, note })),
    cards: cardRows.map(toSessionCard),
    followups: followupRows.map((item) => ({ id: item.id, concept_name: item.concept_name, question: item.question, resolved: item.resolved_at !== null })),
  };
  return c.json(body);
});

function toSessionCard(row: CardRow): SessionCard {
  const parsed = row.options ? (JSON.parse(row.options) as unknown) : null;
  return {
    id: row.id,
    concept_name: row.concept_name,
    type: row.type,
    rung: row.rung,
    status: row.status,
    prompt: row.prompt,
    code: row.code,
    answer: row.answer,
    options: row.type === 'mcq' ? (parsed as McqOption[]) : null,
    choices: row.type === 'cloze' ? (parsed as string[]) : null,
    explain: row.explain,
    checklist: row.checklist ? (JSON.parse(row.checklist) as string[]) : null,
  };
}

for (const [action, suspended] of [
  ['suspend', true],
  ['unsuspend', false],
] as const) {
  sessions.post(`/cards/:id/${action}`, async (c) => {
    const found = await setCardSuspended(c.env, c.var.userId, c.req.param('id'), suspended, Date.now());
    if (!found) return errorJson(404, 'not_found', '카드를 찾지 못했어요.');
    // 사다리 규칙으로 정해진 상태를 돌려준다. 화면이 짐작하면 잠김·복습 중이 서버와 달라진다 (#23)
    const status = await c.env.DB.prepare('SELECT status FROM cards WHERE id = ?1 AND user_id = ?2').bind(c.req.param('id'), c.var.userId).first<CardStatus>('status');
    return c.json({ status });
  });
}
