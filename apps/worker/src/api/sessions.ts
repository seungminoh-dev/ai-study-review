import type { CardStatus, CardType, JudgmentLabel, McqOption, SessionCard, SessionDetail, SessionSummary } from '@moai/shared';
import { Hono } from 'hono';
import type { AppEnv } from '../context';
import { setCardSuspended } from '../domain/reviews';
import type { Env } from '../env';
import { errorJson } from '../lib/http';

// 저장 기록과 카드 끄기 (설계서 §7.2, §12.1)

export const sessions = new Hono<AppEnv>();

interface SessionRow {
  id: string;
  topic: string;
  source: string;
  created_at: number;
  counts: string;
}

export async function listSessions(env: Env, userId: string, limit: number): Promise<SessionSummary[]> {
  const { results } = await env.DB.prepare(
    'SELECT id, topic, source, created_at, counts FROM learning_sessions WHERE user_id = ?1 ORDER BY created_at DESC LIMIT ?2',
  )
    .bind(userId, limit)
    .all<SessionRow>();
  return results.map((row) => {
    const counts = JSON.parse(row.counts) as { concepts?: number; cards?: number };
    return { id: row.id, topic: row.topic, source: row.source, created_at: row.created_at, concepts: counts.concepts ?? 0, cards: counts.cards ?? 0 };
  });
}

sessions.get('/sessions', async (c) => c.json({ sessions: await listSessions(c.env, c.var.userId, 50) }));

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
  if (!row) return errorJson(404, 'not_found', '저장 기록을 찾지 못했어요.');

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
    return c.body(null, 204);
  });
}
