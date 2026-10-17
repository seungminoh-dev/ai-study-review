import { checkSaveLearning, rungOf, searchText, type LearningCard, type SaveLearningInput } from '@moai/shared';
import type { Env } from '../env';
import { sha256Hex } from '../lib/crypto';
import { describeKstMoment } from '../lib/kst';
import { withObject } from '../lib/korean';
import { emptyFsrsFields } from './fsrs';
import { initialStatus } from './ladder';
import { parseAliases } from './concepts';

// save_learning 저장 절차 (설계서 §6.5)

export interface SaveCounts {
  concepts: number;
  new_concepts: number;
  cards: number;
  judgments: number;
  followups: number;
  edges: number;
}

export type SaveResult =
  | { ok: false; problems: string[] }
  | { ok: true; duplicate: boolean; session_id: string; summary: string; counts: SaveCounts | null };

/** 같은 내용이면 같은 해시가 나오도록 키를 정렬하고 앞뒤 공백을 지운다. 안쪽 공백은 코드 들여쓰기일 수 있어서 그대로 둔다 */
function canonical(value: unknown): unknown {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, item]) => [key, canonical(item)]),
    );
  }
  return value;
}

export async function payloadHash(input: SaveLearningInput): Promise<string> {
  return sha256Hex(JSON.stringify(canonical(input)));
}

interface ExistingRow {
  id: string;
  key: string;
  name: string;
  aliases: string;
  final_answer: string | null;
  open_rung: number | null;
  low_rung: number;
}

function referencedKeys(input: SaveLearningInput): string[] {
  const keys = new Set<string>(input.concepts.map((concept) => concept.key));
  for (const card of input.cards) keys.add(card.concept);
  for (const judgment of input.judgments) keys.add(judgment.concept);
  for (const followup of input.followups) keys.add(followup.concept);
  for (const edge of input.edges) {
    keys.add(edge.from);
    keys.add(edge.to);
  }
  return [...keys];
}

function cardColumns(card: LearningCard): { code: string | null; answer: string | null; options: string | null; explain: string | null; checklist: string | null } {
  switch (card.type) {
    case 'ox':
      return { code: card.code ?? null, answer: card.answer, options: null, explain: card.explain, checklist: null };
    case 'mcq':
      return { code: card.code ?? null, answer: null, options: JSON.stringify(card.options), explain: card.explain, checklist: null };
    case 'cloze':
      return { code: null, answer: card.answer, options: JSON.stringify(card.choices), explain: card.explain, checklist: null };
    case 'explain':
      return { code: null, answer: null, options: null, explain: null, checklist: JSON.stringify(card.checklist) };
  }
}

function isPayloadConflict(error: unknown): boolean {
  return error instanceof Error && /UNIQUE constraint failed: learning_sessions\.user_id, learning_sessions\.payload_hash/.test(error.message);
}

/** source는 붙여넣기 가져오기에서 'import'로 바꿔 넣는다. 도구 입력에는 'import'가 없다 */
export async function saveLearning(
  env: Env,
  userId: string,
  input: SaveLearningInput,
  now: number,
  source: SaveLearningInput['source'] | 'import' = input.source,
): Promise<SaveResult> {
  const hash = await payloadHash(input);
  const findDuplicate = env.DB.prepare('SELECT id, summary FROM learning_sessions WHERE user_id = ?1 AND payload_hash = ?2').bind(userId, hash);
  const [duplicate, existingRows, reminder] = await env.DB.batch([
    findDuplicate,
    env.DB.prepare(
      `SELECT k.id, k.key, k.name, k.aliases, k.final_answer,
              (SELECT max(c.rung) FROM cards c WHERE c.concept_id = k.id AND c.status = 'active') AS open_rung,
              (SELECT count(*) FROM cards c WHERE c.concept_id = k.id AND c.rung < 3) AS low_rung
         FROM concepts k
        WHERE k.user_id = ?1 AND k.key IN (SELECT value FROM json_each(?2))`,
    ).bind(userId, JSON.stringify(referencedKeys(input))),
    env.DB.prepare('SELECT min(next_fire_at) AS next FROM reminder_slots WHERE user_id = ?1 AND enabled = 1').bind(userId),
  ]);

  const previous = duplicate!.results[0] as { id: string; summary: string } | undefined;
  if (previous) return { ok: true, duplicate: true, session_id: previous.id, summary: previous.summary, counts: null };

  const existing = new Map((existingRows!.results as unknown as ExistingRow[]).map((row) => [row.key, row]));
  const problems = checkSaveLearning(input, {
    keys: new Set(existing.keys()),
    withFinalAnswer: new Set([...existing.values()].filter((row) => row.final_answer).map((row) => row.key)),
    withLowRungCards: new Set([...existing.values()].filter((row) => row.low_rung > 0).map((row) => row.key)),
  });
  if (problems.length > 0) return { ok: false, problems };

  const sessionId = crypto.randomUUID();
  const explainKeys = new Set(input.cards.filter((card) => card.type === 'explain').map((card) => card.concept));

  // 개념: 있으면 이름·별칭·최종 버전을 갱신하고, 없으면 만든다.
  // 설명하기 카드에 세션 final_answer를 썼으면 그 개념의 final_answer로도 저장한다 (설계서 §6.4).
  const conceptRows = new Map<string, Record<string, unknown>>();
  const upsertConcept = (key: string, name: string, aliases: string[], domain: string | null, finalAnswer: string | null) => {
    const old = existing.get(key);
    // 이름이 바뀌면 옛 이름을 별칭으로 남겨서, 옛 이름으로도 찾을 수 있게 한다
    const renamed = old && old.name !== name ? [old.name] : [];
    const mergedAliases = [...new Set([...renamed, ...(old ? parseAliases(old.aliases) : []), ...aliases])].filter((alias) => alias !== name).slice(0, 10);
    const sessionFinal = explainKeys.has(key) && !old?.final_answer ? (input.final_answer ?? null) : null;
    conceptRows.set(key, {
      id: old?.id ?? crypto.randomUUID(),
      key,
      name,
      aliases: JSON.stringify(mergedAliases),
      search_text: searchText([name, ...mergedAliases, key]),
      domain,
      final_answer: finalAnswer ?? sessionFinal,
    });
  };
  for (const concept of input.concepts) {
    upsertConcept(concept.key, concept.name, concept.aliases, concept.domain ?? null, concept.final_answer ?? null);
  }
  for (const key of explainKeys) {
    const old = existing.get(key);
    if (!conceptRows.has(key) && old && !old.final_answer && input.final_answer) upsertConcept(key, old.name, [], null, null);
  }

  // 카드: 개념에서 이미 열린 단계(없으면 이번 카드 중 가장 낮은 단계)까지만 active로 둔다 (설계서 §9.4)
  const lowestNew = new Map<string, number>();
  for (const card of input.cards) {
    const rung = rungOf(card);
    if (rung < 3) lowestNew.set(card.concept, Math.min(lowestNew.get(card.concept) ?? rung, rung));
  }
  const fsrs = emptyFsrsFields(now);
  const cards = input.cards.map((card) => {
    const rung = rungOf(card);
    const openRung = existing.get(card.concept)?.open_rung ?? lowestNew.get(card.concept) ?? 0;
    return {
      id: crypto.randomUUID(),
      concept: card.concept,
      rung,
      type: card.type,
      prompt: card.prompt,
      ...cardColumns(card),
      status: initialStatus(rung, openRung),
      ...fsrs,
    };
  });

  const newConcepts = input.concepts.filter((concept) => !existing.has(concept.key)).length;
  const counts: SaveCounts = {
    concepts: input.concepts.length,
    new_concepts: newConcepts,
    cards: cards.length,
    judgments: input.judgments.length,
    followups: input.followups.length,
    edges: input.edges.length,
  };
  const nextReminder = (reminder!.results[0] as { next: number | null } | undefined)?.next ?? null;
  const summary = summarize(counts, cards.filter((card) => card.status === 'active').length, nextReminder, now);

  const conceptId = (path: string) => `(SELECT id FROM concepts WHERE user_id = ?1 AND key = json_extract(value, '${path}'))`;
  const statements = [
    env.DB.prepare(
      `INSERT INTO learning_sessions (id, user_id, source, topic, final_answer, key_terms, payload_hash, summary, counts, created_at)
       VALUES (?2, ?1, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
    ).bind(userId, sessionId, source, input.topic, input.final_answer ?? null, JSON.stringify(input.key_terms), hash, summary, JSON.stringify(counts), now),
    // INSERT ... SELECT에 ON CONFLICT를 붙일 때는 SELECT에 WHERE가 있어야 한다 (SQLite 문법)
    env.DB.prepare(
      `INSERT INTO concepts (id, user_id, key, name, aliases, search_text, domain, final_answer, created_at, updated_at)
       SELECT json_extract(value, '$.id'), ?1, json_extract(value, '$.key'), json_extract(value, '$.name'),
              json_extract(value, '$.aliases'), json_extract(value, '$.search_text'), json_extract(value, '$.domain'),
              json_extract(value, '$.final_answer'), ?3, ?3
         FROM json_each(?2) WHERE true
       ON CONFLICT (user_id, key) DO UPDATE SET
         name = excluded.name, aliases = excluded.aliases, search_text = excluded.search_text,
         domain = coalesce(excluded.domain, concepts.domain), final_answer = coalesce(excluded.final_answer, concepts.final_answer),
         updated_at = excluded.updated_at`,
    ).bind(userId, JSON.stringify([...conceptRows.values()]), now),
  ];
  if (input.edges.length > 0) {
    statements.push(
      env.DB.prepare(
        `INSERT OR IGNORE INTO edges (user_id, from_id, to_id, type, created_at)
         SELECT ?1, ${conceptId('$.from')}, ${conceptId('$.to')}, json_extract(value, '$.type'), ?3 FROM json_each(?2)`,
      ).bind(userId, JSON.stringify(input.edges), now),
    );
  }
  if (input.judgments.length > 0) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO judgments (id, user_id, concept_id, session_id, label, said, note, created_at)
         SELECT json_extract(value, '$.id'), ?1, ${conceptId('$.concept')}, ?3, json_extract(value, '$.label'),
                json_extract(value, '$.said'), json_extract(value, '$.note'), ?4
           FROM json_each(?2)`,
      ).bind(userId, JSON.stringify(input.judgments.map((judgment) => ({ id: crypto.randomUUID(), ...judgment }))), sessionId, now),
    );
  }
  if (input.followups.length > 0) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO followups (id, user_id, concept_id, session_id, question, created_at)
         SELECT json_extract(value, '$.id'), ?1, ${conceptId('$.concept')}, ?3, json_extract(value, '$.question'), ?4 FROM json_each(?2)`,
      ).bind(userId, JSON.stringify(input.followups.map((followup) => ({ id: crypto.randomUUID(), ...followup }))), sessionId, now),
    );
  }
  statements.push(
    env.DB.prepare(
      `INSERT INTO cards (id, user_id, concept_id, session_id, rung, type, prompt, code, answer, options, explain, checklist, status,
                          due, stability, difficulty, elapsed_days, scheduled_days, learning_steps, reps, lapses, state, last_review, created_at)
       SELECT json_extract(value, '$.id'), ?1, ${conceptId('$.concept')}, ?3, json_extract(value, '$.rung'), json_extract(value, '$.type'),
              json_extract(value, '$.prompt'), json_extract(value, '$.code'), json_extract(value, '$.answer'), json_extract(value, '$.options'),
              json_extract(value, '$.explain'), json_extract(value, '$.checklist'), json_extract(value, '$.status'),
              json_extract(value, '$.due'), json_extract(value, '$.stability'), json_extract(value, '$.difficulty'),
              json_extract(value, '$.elapsed_days'), json_extract(value, '$.scheduled_days'), json_extract(value, '$.learning_steps'),
              json_extract(value, '$.reps'), json_extract(value, '$.lapses'), json_extract(value, '$.state'),
              json_extract(value, '$.last_review'), ?4
         FROM json_each(?2)`,
    ).bind(userId, JSON.stringify(cards), sessionId, now),
  );

  try {
    // batch는 하나의 트랜잭션이라 일부만 저장되지 않는다
    await env.DB.batch(statements);
  } catch (error) {
    // 같은 내용을 동시에 두 번 보냈다. 먼저 저장된 결과를 돌려준다
    if (!isPayloadConflict(error)) throw error;
    const row = await findDuplicate.first<{ id: string; summary: string }>();
    if (!row) throw error;
    return { ok: true, duplicate: true, session_id: row.id, summary: row.summary, counts: null };
  }
  return { ok: true, duplicate: false, session_id: sessionId, summary, counts };
}

function summarize(counts: SaveCounts, activeCards: number, nextReminder: number | null, now: number): string {
  const existing = counts.concepts - counts.new_concepts;
  const parts = [`개념 ${counts.concepts}개(새 ${counts.new_concepts}·기존 ${existing})`, `카드 ${counts.cards}장`];
  if (counts.followups > 0) parts.push(`다음에 볼 질문 ${counts.followups}개`);
  let text = `${withObject(parts.join(', '))} 저장했어요.`;
  if (activeCards < counts.cards) text += ` 그중 ${counts.cards - activeCards}장은 앞 단계를 익히면 열려요.`;
  text +=
    nextReminder === null
      ? ' 앱 설정에서 알림 시간을 정하면 그 시각에 복습을 알려 드려요.'
      : ` 첫 복습 알림은 ${describeKstMoment(nextReminder, now)}에 와요.`;
  return text;
}
