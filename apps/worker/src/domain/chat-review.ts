import { gradeAnswer, type Confidence, type McqOption, type QueueCard, type ReviewGrade } from '@moai/shared';
import type { Env } from '../env';
import { describeKstMoment, studyDayIndex } from '../lib/kst';
import { loadTodayQueue } from './queue';
import { recordReviews } from './reviews';

// 채팅 복습 (설계서 §2.4): claude.ai 채팅에서 "오늘 복습 퀴즈 내줘"를 처리한다.
// 문제에는 정답을 넣지 않는다. Claude가 사용자 답을 넘기면 서버가 채점한다. 기록은 앱 복습과 같은 review_logs·FSRS로 간다.

const LABELS = ['A', 'B', 'C', 'D', 'E'];
/** 같은 카드에 이 시간 안에 다시 들어온 답은 다시 기록하지 않는다 (Claude가 같은 호출을 되풀이할 때) */
const RETRY_WINDOW_MS = 60_000;

export interface ChatQuestion {
  card_id: string;
  concept: string;
  type: QueueCard['type'];
  prompt: string;
  code: string | null;
  /** 객관식·빈칸 보기. 답은 label로 받는다 */
  choices: { label: string; text: string }[] | null;
}

/** 보기 순서는 카드와 날마다 정해진다. 문제를 낼 때와 채점할 때 같은 순서가 나와야 한다 */
function shuffled<T>(items: readonly T[], seed: string): T[] {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) hash = Math.imul(hash ^ seed.charCodeAt(i), 16777619);
  const random = () => {
    hash = (hash + 0x6d2b79f5) | 0;
    let t = Math.imul(hash ^ (hash >>> 15), 1 | hash);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

const seedOf = (cardId: string, now: number) => `${cardId}:${studyDayIndex(now)}`;

function choicesOf(card: { id: string; type: QueueCard['type']; options: McqOption[] | null; choices: string[] | null }, now: number): string[] | null {
  if (card.type === 'mcq') return shuffled((card.options ?? []).map((option) => option.text), seedOf(card.id, now));
  if (card.type === 'cloze') return shuffled(card.choices ?? [], seedOf(card.id, now));
  return null;
}

export async function chatQueue(env: Env, userId: string, size: number, now: number): Promise<{ questions: ChatQuestion[]; remaining: number }> {
  const queue = await loadTodayQueue(env, userId, now);
  return {
    remaining: queue.length,
    questions: queue.slice(0, size).map((card) => ({
      card_id: card.id,
      concept: card.concept_name,
      type: card.type,
      prompt: card.prompt,
      code: card.code,
      choices: choicesOf(card, now)?.map((text, index) => ({ label: LABELS[index]!, text })) ?? null,
    })),
  };
}

interface CardRow {
  id: string;
  type: QueueCard['type'];
  prompt: string;
  answer: string | null;
  options: string | null;
  explain: string | null;
  checklist: string | null;
  status: string;
  final_answer: string | null;
  concept_name: string;
}

export type ChatSubmitResult =
  | { kind: 'not_found' }
  | { kind: 'unreadable'; hint: string }
  | { kind: 'duplicate' }
  /** 설명하기: 등급 없이 오면 기준(내 최종 버전, 체크리스트)만 주고 기록하지 않는다 */
  | { kind: 'reference'; final_answer: string | null; checklist: string[] }
  | {
      kind: 'recorded';
      correct: boolean | null;
      /** 확신했는데 틀렸다. 바로잡으면 특히 오래 남는다 */
      confident_miss: boolean;
      grade: ReviewGrade;
      correct_answer: string | null;
      explain: string | null;
      from_my_answer: boolean;
      next: string;
      remaining: number;
    };

function normalizeOx(answer: string): 'O' | 'X' | null {
  const value = answer.trim().toUpperCase();
  if (['O', '○', 'TRUE', '맞다', '맞음', '맞아요', '네', '예'].includes(value)) return 'O';
  if (['X', '×', 'FALSE', '틀리다', '틀림', '틀려요', '아니요', '아니오'].includes(value)) return 'X';
  return null;
}

/** 보기 글자(A~E)나 보기 글자 그대로를 받아 보기 글을 돌려준다 */
function resolveChoice(answer: string, choices: readonly string[]): string | null {
  const trimmed = answer.trim();
  const letter = /^[A-Ea-e]$/.test(trimmed) ? LABELS.indexOf(trimmed.toUpperCase()) : -1;
  if (letter >= 0) return choices[letter] ?? null;
  return choices.find((choice) => choice.trim() === trimmed) ?? null;
}

export async function chatSubmit(
  env: Env,
  userId: string,
  input: { card_id: string; answer: string; grade?: ReviewGrade | undefined; easy?: boolean | undefined; confidence?: Confidence | undefined },
  now: number,
): Promise<ChatSubmitResult> {
  const card = await env.DB.prepare(
    `SELECT c.id, c.type, c.prompt, c.answer, c.options, c.explain, c.checklist, c.status, k.final_answer, k.name AS concept_name
       FROM cards c JOIN concepts k ON k.id = c.concept_id WHERE c.id = ?1 AND c.user_id = ?2`,
  )
    .bind(input.card_id, userId)
    .first<CardRow>();
  if (!card || card.status !== 'active') return { kind: 'not_found' };

  let grade: ReviewGrade;
  let correct: boolean | null = null;
  let response = input.answer.trim();
  let correctAnswer: string | null = null;
  let fromMyAnswer = false;
  if (card.type === 'explain') {
    if (!input.grade) return { kind: 'reference', final_answer: card.final_answer, checklist: card.checklist ? (JSON.parse(card.checklist) as string[]) : [] };
    grade = input.grade;
  } else if (card.type === 'ox') {
    const picked = normalizeOx(input.answer);
    if (!picked) return { kind: 'unreadable', hint: 'OX 문제는 answer에 "O"나 "X"를 넣어 주세요.' };
    correct = picked === card.answer;
    response = picked;
    correctAnswer = card.answer;
    grade = gradeAnswer({ correct, elapsedMs: 0, easy: input.easy, confidence: input.confidence });
  } else {
    const options = card.type === 'mcq' ? (JSON.parse(card.options ?? '[]') as McqOption[]) : null;
    const choices = choicesOf({ id: card.id, type: card.type, options, choices: card.type === 'cloze' ? (JSON.parse(card.options ?? '[]') as string[]) : null }, now) ?? [];
    const picked = resolveChoice(input.answer, choices);
    if (!picked) return { kind: 'unreadable', hint: `보기 글자(${LABELS.slice(0, choices.length).join(', ')})를 answer에 넣어 주세요.` };
    correctAnswer = card.type === 'mcq' ? (options!.find((option) => option.correct)?.text ?? null) : card.answer;
    correct = picked === correctAnswer;
    fromMyAnswer = card.type === 'mcq' && options!.some((option) => option.text === picked && option.from_my_answer === true);
    response = picked;
    grade = gradeAnswer({ correct, elapsedMs: 0, easy: input.easy, confidence: input.confidence });
  }

  const recent = await env.DB.prepare('SELECT 1 FROM review_logs WHERE card_id = ?1 AND user_id = ?2 AND reviewed_at > ?3 LIMIT 1')
    .bind(card.id, userId, now - RETRY_WINDOW_MS)
    .first();
  if (recent) return { kind: 'duplicate' };

  const review = { id: crypto.randomUUID(), card_id: card.id, grade, response: response.slice(0, 2000), reviewed_at: now };
  const recorded = await recordReviews(env, userId, [card.type !== 'explain' && input.confidence ? { ...review, confidence: input.confidence } : review], now);
  if (recorded.conflicted) return { kind: 'duplicate' };
  const [due, queue] = await Promise.all([
    env.DB.prepare('SELECT due FROM cards WHERE id = ?1').bind(card.id).first<number>('due'),
    loadTodayQueue(env, userId, now),
  ]);
  return {
    kind: 'recorded',
    correct,
    confident_miss: correct === false && input.confidence === 'sure',
    grade,
    correct_answer: correctAnswer,
    explain: card.explain,
    from_my_answer: fromMyAnswer,
    next: due ? describeKstMoment(due, now) : '',
    remaining: queue.length,
  };
}
