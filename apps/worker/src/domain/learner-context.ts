import { normalizeSearch, type EdgeType, type JudgmentLabel, type McqOption } from '@moai/shared';
import type { Env } from '../env';
import { DAY_MS, formatKstDate } from '../lib/kst';
import { conceptState, statesFrom, statsQuery, type ConceptRow, type ConceptState, type StatsRow } from './concepts';

// get_learner_context (설계서 §6.7, 부록 D)

export const MAX_CONTEXT_CHARS = 8000;
const MAX_CONCEPTS = 10;
const TOPIC_CONCEPTS = 5;
const JUDGMENTS_PER_CONCEPT = 5;
const WEAK_CARDS_PER_CONCEPT = 3;
/** 열린 질문은 개념마다 최근 이만큼만, 이 기간 안의 것만 넣는다. 오래 쌓인 질문이 다른 개념을 밀어내지 않게 */
const FOLLOWUPS_PER_CONCEPT = 3;
const FOLLOWUP_WINDOW_MS = 60 * 24 * 60 * 60 * 1000;
const WEAK_WINDOW_MS = 30 * DAY_MS;

/** 조사가 붙은 낱말에서 조사를 떼어 본다. "객체와" → "객체" */
const PARTICLES = /(와|과|의|을|를|은|는|이|가|도|로|으로|에|에서|랑)$/;

/**
 * 주제 문장으로 개념을 고른다.
 * 1. 주제에 개념 이름·별칭·key가 통째로 들어 있는 개념 ("불변 객체와 방어적 복사" → 불변 객체, 방어적 복사)
 * 2. 그런 개념이 없으면, 주제 낱말이 이름에 들어 있는 개념 ("복사" → 깊은 복사, 얕은 복사)
 */
export function pickTopicConcepts<T extends { search_text: string }>(topic: string, concepts: readonly T[], limit: number): T[] {
  const whole = normalizeSearch(topic);
  if (!whole) return [];
  const parts = (concept: T) => concept.search_text.split('|').filter((part) => part.length >= 2);
  const contained = concepts.filter((concept) => parts(concept).some((part) => whole.includes(part)));
  if (contained.length > 0) return contained.slice(0, limit);
  const words = new Set<string>();
  for (const word of topic.split(/[\s,.;:!?()[\]{}"'“”‘’/·]+/)) {
    for (const candidate of [word, word.replace(PARTICLES, '')]) {
      const normalized = normalizeSearch(candidate);
      if (normalized.length >= 2) words.add(normalized);
    }
  }
  return concepts.filter((concept) => [...words].some((word) => concept.search_text.includes(word))).slice(0, limit);
}

interface JudgmentRow {
  concept_id: string;
  label: JudgmentLabel;
  said: string | null;
  note: string;
  created_at: number;
}

interface WeakLogRow {
  card_id: string;
  concept_id: string;
  prompt: string;
  options: string | null;
  type: string;
  grade: number;
  response: string | null;
  reviewed_at: number;
}

interface NeighborRow {
  from_id: string;
  to_id: string;
  type: EdgeType;
  other_id: string;
  other_name: string;
  cards: number;
  active: number;
  unstable: number;
  recent_fails: number;
}

interface FollowupRow {
  concept_id: string;
  question: string;
}

export async function learnerContext(
  env: Env,
  userId: string,
  request: { topic?: string; concept_keys?: string[] },
  now: number,
): Promise<{ text: string; concepts: { key: string; name: string; state: ConceptState }[] }> {
  const [byKey, byTopic] = await env.DB.batch([
    env.DB.prepare('SELECT id, key, name, aliases, final_answer FROM concepts WHERE user_id = ?1 AND key IN (SELECT value FROM json_each(?2))').bind(
      userId,
      JSON.stringify(request.concept_keys ?? []),
    ),
    // 주제로 찾을 때는 이 사용자의 개념을 모두 읽어 JS에서 고른다. 개념은 많아야 수백 개다
    env.DB.prepare(`SELECT id, key, name, aliases, final_answer, search_text FROM concepts WHERE user_id = ?1 AND ?2 LIMIT 5000`).bind(
      userId,
      request.topic ? 1 : 0,
    ),
  ]);
  const topicMatches = request.topic
    ? pickTopicConcepts(request.topic, byTopic!.results as unknown as (ConceptRow & { search_text: string })[], TOPIC_CONCEPTS)
    : [];
  const concepts = new Map<string, ConceptRow>();
  for (const row of [...(byKey!.results as unknown as ConceptRow[]), ...topicMatches]) {
    if (concepts.size < MAX_CONCEPTS) concepts.set(row.id, row);
  }
  if (concepts.size === 0) {
    return { text: '이 주제로 저장된 기록이 없어요. 처음 배우는 주제로 코칭하면 돼요.', concepts: [] };
  }

  const ids = JSON.stringify([...concepts.keys()]);
  const [stats, judgments, weak, neighbors, followups] = await env.DB.batch([
    statsQuery(env, [...concepts.keys()], now),
    env.DB.prepare(
      'SELECT concept_id, label, said, note, created_at FROM judgments WHERE concept_id IN (SELECT value FROM json_each(?1)) ORDER BY created_at DESC LIMIT 200',
    ).bind(ids),
    env.DB.prepare(
      `SELECT c.id AS card_id, c.concept_id, c.prompt, c.options, c.type, r.grade, r.response, r.reviewed_at
         FROM cards c JOIN review_logs r ON r.card_id = c.id
        WHERE c.concept_id IN (SELECT value FROM json_each(?1)) AND r.reviewed_at >= ?2
        ORDER BY r.reviewed_at DESC LIMIT 300`,
    ).bind(ids, now - WEAK_WINDOW_MS),
    env.DB.prepare(
      `SELECT e.from_id, e.to_id, e.type, o.id AS other_id, o.name AS other_name,
              (SELECT count(*) FROM cards c WHERE c.concept_id = o.id) AS cards,
              (SELECT count(*) FROM cards c WHERE c.concept_id = o.id AND c.status = 'active') AS active,
              (SELECT count(*) FROM cards c WHERE c.concept_id = o.id AND c.status = 'active' AND c.stability < 7) AS unstable,
              (SELECT count(*) FROM cards c JOIN review_logs r ON r.card_id = c.id
                WHERE c.concept_id = o.id AND r.grade = 1 AND r.reviewed_at >= ?3) AS recent_fails
         FROM edges e
         JOIN concepts o ON o.id = CASE WHEN e.from_id IN (SELECT value FROM json_each(?2)) THEN e.to_id ELSE e.from_id END
        WHERE e.user_id = ?1 AND (e.from_id IN (SELECT value FROM json_each(?2)) OR e.to_id IN (SELECT value FROM json_each(?2)))
        ORDER BY o.name LIMIT 100`,
    ).bind(userId, ids, now - 14 * DAY_MS),
    env.DB.prepare(
      'SELECT concept_id, question FROM followups WHERE user_id = ?1 AND resolved_at IS NULL AND created_at >= ?3 AND concept_id IN (SELECT value FROM json_each(?2)) ORDER BY created_at DESC',
    ).bind(userId, ids, now - FOLLOWUP_WINDOW_MS),
  ]);

  const states = statesFrom(stats!.results as unknown as StatsRow[]);
  const group = <T extends { concept_id: string }>(rows: readonly T[]) => {
    const map = new Map<string, T[]>();
    for (const row of rows) map.set(row.concept_id, [...(map.get(row.concept_id) ?? []), row]);
    return map;
  };
  const judgmentsBy = group(judgments!.results as unknown as JudgmentRow[]);
  const weakBy = group(weak!.results as unknown as WeakLogRow[]);
  const followupsBy = group(followups!.results as unknown as FollowupRow[]);
  const neighborRows = neighbors!.results as unknown as NeighborRow[];

  const blocks: string[] = [];
  const summary: { key: string; name: string; state: ConceptState }[] = [];
  for (const concept of concepts.values()) {
    const state = states.get(concept.id) ?? '아직 안 배움';
    summary.push({ key: concept.key, name: concept.name, state });
    const lines = [`## ${concept.name} (${concept.key}) · ${state}`];
    lines.push(`- 확정 최종 버전: ${concept.final_answer ? `"${concept.final_answer}"` : '없음'}`);

    const history = (judgmentsBy.get(concept.id) ?? []).slice(0, JUDGMENTS_PER_CONCEPT);
    if (history.length > 0) {
      lines.push('- 판정 기록');
      for (const judgment of history) {
        const said = judgment.said ? ` "${judgment.said}"` : '';
        lines.push(`  - ${formatKstDate(judgment.created_at)} [${judgment.label}]${said}`, `    → ${judgment.note}`);
      }
    }

    for (const card of weakCards(weakBy.get(concept.id) ?? []).slice(0, WEAK_CARDS_PER_CONCEPT)) {
      lines.push(`- 약한 카드: "${card.prompt}" (${card.reasons.join(', ')})`);
    }

    const links = neighborRows
      .filter((row) => row.from_id === concept.id || row.to_id === concept.id)
      .map((row) => `${row.other_name} (${row.type}, ${conceptState(row)})`);
    if (links.length > 0) lines.push(`- 연결: ${[...new Set(links)].join(', ')}`);

    for (const followup of (followupsBy.get(concept.id) ?? []).slice(0, FOLLOWUPS_PER_CONCEPT)) lines.push(`- 열린 질문: "${followup.question}"`);
    blocks.push(lines.join('\n'));
  }

  return { text: fitBlocks(blocks), concepts: summary };
}

/** 최근 30일 안에 틀린 카드. 예전 내 오답을 다시 골랐는지도 본다 */
function weakCards(logs: readonly WeakLogRow[]): { prompt: string; reasons: string[] }[] {
  const byCard = new Map<string, WeakLogRow[]>();
  for (const log of logs) byCard.set(log.card_id, [...(byCard.get(log.card_id) ?? []), log]);
  const result: { prompt: string; reasons: string[]; fails: number }[] = [];
  for (const cardLogs of byCard.values()) {
    const fails = cardLogs.filter((log) => log.grade === 1);
    if (fails.length === 0) continue;
    const first = cardLogs[0]!;
    const recent = cardLogs.slice(0, 2);
    const reasons = [recent.length === 2 && recent.every((log) => log.grade === 1) ? '최근 2번 모두 틀림' : `최근 30일 ${fails.length}번 틀림`];
    if (first.type === 'mcq' && first.options) {
      const mine = new Set((JSON.parse(first.options) as McqOption[]).filter((option) => option.from_my_answer).map((option) => option.text));
      if (fails.some((log) => log.response !== null && mine.has(log.response))) reasons.push('예전 내 오답을 다시 고름');
    }
    result.push({ prompt: first.prompt, reasons, fails: fails.length });
  }
  return result.sort((a, b) => b.fails - a.fails);
}

function fitBlocks(blocks: readonly string[]): string {
  let text = '';
  for (const [index, block] of blocks.entries()) {
    if (!text && block.length > MAX_CONTEXT_CHARS) {
      text = `${block.slice(0, MAX_CONTEXT_CHARS - 100)}…`;
      continue;
    }
    const next = text ? `${text}\n\n${block}` : block;
    if (next.length > MAX_CONTEXT_CHARS) {
      const rest = blocks.length - index;
      return `${text}\n\n(길이 제한으로 개념 ${rest}개는 생략했어요. concept_keys로 따로 물어보세요.)`;
    }
    text = next;
  }
  return text;
}
