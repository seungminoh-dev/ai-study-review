import type { CardStatus, CardType, ConceptDetail, ConceptStateKey, EdgeType, MapResponse, McqOption } from '@moai/shared';
import type { Env } from '../env';
import { withObject } from '../lib/korean';
import { conceptState, parseAliases, statsQuery, type ConceptState } from './concepts';

// 지식 지도와 개념 상세 (설계서 §9.7). 상태는 Claude가 아니라 서버가 카드와 복습 기록으로 정한다.

const STATE_KEY: Record<ConceptState, ConceptStateKey> = { '아직 안 배움': 'unlearned', 익숙함: 'familiar', 흔들림: 'shaky' };

/** 지도에 그리는 개념 수 상한. 넘으면 최근에 바뀐 개념부터 보여 준다 */
const MAP_LIMIT = 300;

export async function loadMap(env: Env, userId: string, now: number): Promise<MapResponse> {
  const { results: concepts } = await env.DB.prepare(
    'SELECT id, key, name FROM concepts WHERE user_id = ?1 ORDER BY updated_at DESC LIMIT ?2',
  )
    .bind(userId, MAP_LIMIT)
    .all<{ id: string; key: string; name: string }>();
  if (concepts.length === 0) return { nodes: [], edges: [] };
  const ids = concepts.map((concept) => concept.id);
  const [stats, edges] = await env.DB.batch([
    statsQuery(env, ids, now),
    env.DB.prepare(
      `SELECT f.key AS from_key, t.key AS to_key, e.type
         FROM edges e JOIN concepts f ON f.id = e.from_id JOIN concepts t ON t.id = e.to_id
        WHERE e.user_id = ?1 AND e.from_id IN (SELECT value FROM json_each(?2)) AND e.to_id IN (SELECT value FROM json_each(?2))`,
    ).bind(userId, JSON.stringify(ids)),
  ]);
  const byId = new Map((stats!.results as { id: string; cards: number; active: number; unstable: number; recent_fails: number }[]).map((row) => [row.id, row]));
  return {
    nodes: concepts.map((concept) => {
      const row = byId.get(concept.id) ?? { cards: 0, active: 0, unstable: 0, recent_fails: 0 };
      return { key: concept.key, name: concept.name, state: STATE_KEY[conceptState(row)], cards: row.cards };
    }),
    edges: (edges!.results as { from_key: string; to_key: string; type: EdgeType }[]).map((edge) => ({ from: edge.from_key, to: edge.to_key, type: edge.type })),
  };
}

interface CardRow {
  id: string;
  type: CardType;
  rung: number;
  status: CardStatus;
  prompt: string;
  code: string | null;
  answer: string | null;
  options: string | null;
  explain: string | null;
  checklist: string | null;
  due: number;
  stability: number;
  reps: number;
}

export async function loadConcept(env: Env, userId: string, key: string, now: number): Promise<ConceptDetail | null> {
  const concept = await env.DB.prepare('SELECT id, key, name, aliases, final_answer FROM concepts WHERE user_id = ?1 AND key = ?2')
    .bind(userId, key)
    .first<{ id: string; key: string; name: string; aliases: string; final_answer: string | null }>();
  if (!concept) return null;
  const [judgments, cards, followups, neighbors] = await env.DB.batch([
    env.DB.prepare(
      `SELECT j.id, j.label, j.said, j.note, j.created_at, s.topic
         FROM judgments j JOIN learning_sessions s ON s.id = j.session_id
        WHERE j.concept_id = ?1 AND j.user_id = ?2 ORDER BY j.created_at DESC LIMIT 30`,
    ).bind(concept.id, userId),
    env.DB.prepare(
      `SELECT id, type, rung, status, prompt, code, answer, options, explain, checklist, due, stability, reps
         FROM cards WHERE concept_id = ?1 AND user_id = ?2 ORDER BY rung, created_at`,
    ).bind(concept.id, userId),
    env.DB.prepare('SELECT id, question FROM followups WHERE concept_id = ?1 AND user_id = ?2 AND resolved_at IS NULL ORDER BY created_at DESC').bind(
      concept.id,
      userId,
    ),
    env.DB.prepare(
      `SELECT k.id, k.key, k.name, e.type, 'out' AS direction FROM edges e JOIN concepts k ON k.id = e.to_id WHERE e.from_id = ?1 AND e.user_id = ?2
       UNION ALL
       SELECT k.id, k.key, k.name, e.type, 'in' AS direction FROM edges e JOIN concepts k ON k.id = e.from_id WHERE e.to_id = ?1 AND e.user_id = ?2`,
    ).bind(concept.id, userId),
  ]);
  const neighborRows = neighbors!.results as { id: string; key: string; name: string; type: EdgeType; direction: 'out' | 'in' }[];
  const { results: stats } = await statsQuery(env, [concept.id, ...neighborRows.map((row) => row.id)], now).all<{
    id: string;
    cards: number;
    active: number;
    unstable: number;
    recent_fails: number;
  }>();
  const stateOf = new Map(stats.map((row) => [row.id, STATE_KEY[conceptState(row)]]));
  const openFollowups = followups!.results as { id: string; question: string }[];
  const question = openFollowups[0]?.question;
  return {
    key: concept.key,
    name: concept.name,
    aliases: parseAliases(concept.aliases),
    state: stateOf.get(concept.id) ?? 'unlearned',
    final_answer: concept.final_answer,
    judgments: judgments!.results as unknown as ConceptDetail['judgments'],
    cards: (cards!.results as unknown as CardRow[]).map((row) => {
      const parsed = row.options ? (JSON.parse(row.options) as unknown) : null;
      return {
        id: row.id,
        concept_name: concept.name,
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
        due: row.due,
        stability: row.stability,
        reps: row.reps,
      };
    }),
    followups: openFollowups,
    neighbors: neighborRows.map((row) => ({ key: row.key, name: row.name, type: row.type, direction: row.direction, state: stateOf.get(row.id) ?? 'unlearned' })),
    // 코치 지침이나 서버 공통 지침이 [모아이:key]를 보면 get_learner_context를 먼저 부른다
    continue_prompt: `[모아이:${concept.key}] ${question ?? `${withObject(concept.name)} 다시 공부하고 싶어요.`} 먼저 제 말로 답해 볼게요.`,
  };
}

