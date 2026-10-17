import { z } from 'zod';
import type { JudgmentLabel } from './save-learning';

// REST API(PWA용) 요청 스키마와 응답 타입 (설계서 §7). Worker와 PWA가 같이 쓴다.

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isHhmm(value: string): boolean {
  return HHMM.test(value);
}

export const SetupBody = z.object({
  code: z.string().trim().min(1).max(200),
  display_name: z.string().trim().min(1).max(30),
});
export type SetupBody = z.infer<typeof SetupBody>;

export const ReviewGrade = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]);
export type ReviewGrade = z.infer<typeof ReviewGrade>;

export const ReviewItem = z.object({
  /** 기기에서 만든 UUID. 같은 답을 다시 보내도 한 번만 기록한다 */
  id: z.uuid(),
  card_id: z.uuid(),
  grade: ReviewGrade,
  /** 고른 보기 글자 그대로 (ox는 'O'·'X') */
  response: z.string().max(2000).optional(),
  elapsed_ms: z.int().min(0).max(60 * 60 * 1000).optional(),
  reviewed_at: z.int().positive(),
});
export type ReviewItem = z.infer<typeof ReviewItem>;

/** 답안은 한 번에 20건까지 보낸다 (설계서 §9.5) */
export const REVIEWS_PER_REQUEST = 20;
export const ReviewsBody = z.object({ reviews: z.array(ReviewItem).min(1).max(REVIEWS_PER_REQUEST) });
export type ReviewsBody = z.infer<typeof ReviewsBody>;

export const MAX_REMINDERS = 3;
export const RemindersBody = z.object({
  times: z
    .array(z.string().refine(isHhmm, 'HH:MM 형식이어야 해요'))
    .max(MAX_REMINDERS)
    .refine((times) => new Set(times).size === times.length, '같은 시각이 두 번 있어요'),
});
export type RemindersBody = z.infer<typeof RemindersBody>;

export const PushSubscriptionBody = z.object({
  endpoint: z.url({ protocol: /^https$/ }).max(2000),
  keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
});
export type PushSubscriptionBody = z.infer<typeof PushSubscriptionBody>;

export const PushEndpointBody = z.object({ endpoint: z.string().min(1).max(2000) });

export type CardType = 'ox' | 'mcq' | 'cloze' | 'explain';
export type CardStatus = 'active' | 'locked' | 'suspended';

export interface McqOption {
  text: string;
  correct: boolean;
  from_my_answer?: boolean;
}

export interface Me {
  id: string;
  display_name: string;
  role: 'owner' | 'member';
  daily_new_limit: number;
  daily_review_limit: number;
}

/** 복습 화면에서 한 장. 기기에서 채점하므로 정답이 함께 온다 */
export interface QueueCard {
  id: string;
  concept_key: string;
  concept_name: string;
  type: Exclude<CardType, 'explain'>;
  rung: number;
  prompt: string;
  code: string | null;
  /** ox: 'O'|'X', cloze: 정답 단어 */
  answer: string | null;
  /** mcq만 */
  options: McqOption[] | null;
  /** cloze만 */
  choices: string[] | null;
  explain: string | null;
  /** FSRS 상태: 0 새 카드, 1 학습, 2 복습, 3 재학습 */
  state: number;
}

export interface QueueResponse {
  cards: QueueCard[];
  /** 오늘 남은 전체 장수 (size와 상관없이) */
  remaining: number;
}

export interface SessionSummary {
  id: string;
  topic: string;
  source: string;
  created_at: number;
  concepts: number;
  cards: number;
}

export interface OpenFollowup {
  id: string;
  question: string;
  concept_name: string;
  created_at: number;
}

export interface TodayResponse {
  remaining: number;
  minutes: number;
  reviewed_today: number;
  sessions: SessionSummary[];
  followups: OpenFollowup[];
  reminders_set: boolean;
}

export interface SessionCard {
  id: string;
  concept_name: string;
  type: CardType;
  rung: number;
  status: CardStatus;
  prompt: string;
  code: string | null;
  answer: string | null;
  options: McqOption[] | null;
  choices: string[] | null;
  explain: string | null;
  checklist: string[] | null;
}

export interface SessionDetail {
  id: string;
  topic: string;
  source: string;
  created_at: number;
  final_answer: string | null;
  key_terms: string[];
  concepts: { key: string; name: string }[];
  judgments: { id: string; concept_name: string; label: JudgmentLabel; said: string | null; note: string }[];
  cards: SessionCard[];
  followups: { id: string; concept_name: string; question: string; resolved: boolean }[];
}

export interface ReviewsResponse {
  recorded: number;
  skipped: number;
  unlocked: number;
}

export interface Reminder {
  local_time: string;
  enabled: boolean;
  next_fire_at: number;
}

export interface McpTokenStatus {
  active: boolean;
  created_at: number | null;
}

export interface ApiError {
  error: { code: string; message: string };
}
