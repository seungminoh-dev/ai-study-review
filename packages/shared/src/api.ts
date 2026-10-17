import { z } from 'zod';
import type { JudgmentLabel } from './save-learning';

// REST API(PWA용) 요청 스키마와 응답 타입 (설계서 §7). Worker와 PWA가 같이 쓴다.

import { MAX_ELAPSED_MS, MAX_REMINDERS, REVIEWS_PER_REQUEST, isHhmm } from './limits';

export { MAX_ELAPSED_MS, MAX_REMINDERS, REVIEWS_PER_REQUEST, isHhmm };

export const SetupBody = z.object({
  code: z.string().trim().min(1).max(200),
  display_name: z.string().trim().min(1).max(30),
});
export type SetupBody = z.infer<typeof SetupBody>;

/** 초대 코드로 가입. GitHub 확인을 마친 브라우저에서만 쓸 수 있다 (설계서 §8.4) */
export const JoinBody = z.object({
  code: z.string().trim().min(1).max(40),
  display_name: z.string().trim().min(1).max(30),
});
export type JoinBody = z.infer<typeof JoinBody>;

/** 다른 기기에서 받은 로그인 코드 (설계서 §8.5) */
export const LoginCodeBody = z.object({ code: z.string().trim().min(1).max(40) });
export type LoginCodeBody = z.infer<typeof LoginCodeBody>;

/** 로그아웃할 때 이 기기의 푸시 구독도 지운다 */
export const LogoutBody = z.object({ endpoint: z.string().min(1).max(2000).optional() });
export type LogoutBody = z.infer<typeof LogoutBody>;

export const InviteBody = z.object({ label: z.string().trim().min(1).max(30) });
export type InviteBody = z.infer<typeof InviteBody>;

export const ReviewGrade = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]);
export type ReviewGrade = z.infer<typeof ReviewGrade>;

export const ReportReason = z.enum(['wrong', 'unclear', 'duplicate', 'other']);
export type ReportReason = z.infer<typeof ReportReason>;

/** 카드 신고. 신고하면 그 카드는 바로 꺼진다 */
export const ReportBody = z.object({ reason: ReportReason, note: z.string().trim().max(300).optional() });

const EditText = z.string().trim().min(1);
/** 카드 고치기. 카드 종류는 바꾸지 않고 글자와 정답만 고친다 */
export const CardEditBody = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ox'), prompt: EditText.max(500), answer: z.enum(['O', 'X']), explain: EditText.max(400) }),
  z.object({
    type: z.literal('mcq'),
    prompt: EditText.max(500),
    options: z
      .array(z.object({ text: EditText.max(300), correct: z.boolean(), from_my_answer: z.boolean().optional() }))
      .min(3)
      .max(4)
      .refine((options) => options.filter((option) => option.correct).length === 1, '정답은 하나여야 해요'),
    explain: EditText.max(400),
  }),
  z.object({
    type: z.literal('cloze'),
    prompt: EditText.max(500).refine((prompt) => prompt.split('____').length === 2, '빈칸(____)이 한 번 있어야 해요'),
    answer: EditText.max(40),
    choices: z.array(EditText.max(40)).min(3).max(5),
    explain: EditText.max(400),
  }).refine((card) => card.choices.includes(card.answer), '보기에 정답이 있어야 해요'),
  z.object({ type: z.literal('explain'), prompt: EditText.max(300), checklist: z.array(EditText.max(60)).min(2).max(5) }),
]);
export type CardEditBody = z.infer<typeof CardEditBody>;

export const DailyGoalBody = z.object({ daily_goal: z.int().min(1).max(50) });

export const ReviewItem = z.object({
  /** 기기에서 만든 UUID. 같은 답을 다시 보내도 한 번만 기록한다 */
  id: z.uuid(),
  card_id: z.uuid(),
  grade: ReviewGrade,
  /** 고른 보기 글자 그대로 (ox는 'O'·'X'). 설명하기는 사용자가 쓴 설명 */
  response: z.string().max(2000).optional(),
  /** 너무 크면 버리지 않고 MAX_ELAPSED_MS로 자른다 */
  elapsed_ms: z
    .number()
    .min(0)
    .transform((value) => Math.min(Math.round(value), MAX_ELAPSED_MS))
    .optional(),
  reviewed_at: z.int().positive(),
});
export type ReviewItem = z.infer<typeof ReviewItem>;

/**
 * 답안 묶음. 항목은 하나씩 검사해서 잘못된 것만 빼고 기록한다.
 * 한 항목 때문에 묶음 전체를 거절하면, 기기의 outbox가 그 묶음을 영영 보내지 못한다.
 */
export const ReviewsBody = z.object({ reviews: z.array(z.unknown()).min(1).max(REVIEWS_PER_REQUEST) });
export type ReviewsBody = z.infer<typeof ReviewsBody>;

export const RemindersBody = z.object({
  times: z
    .array(z.string().refine(isHhmm, 'HH:MM 형식이어야 해요'))
    .max(MAX_REMINDERS)
    .refine((times) => new Set(times).size === times.length, '같은 시각이 두 번 있어요'),
});
export type RemindersBody = z.infer<typeof RemindersBody>;

const Base64Url = /^[A-Za-z0-9_-]+={0,2}$/;

export const PushSubscriptionBody = z.object({
  endpoint: z.url({ protocol: /^https$/ }).max(2000),
  // p256dh는 P-256 공개 키 65바이트(base64url 87자), auth는 16바이트(22자)다
  keys: z.object({
    p256dh: z.string().regex(Base64Url).min(86).max(90),
    auth: z.string().regex(Base64Url).min(21).max(25),
  }),
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
  /** 연결한 GitHub 계정. 없으면 null */
  github_login: string | null;
}

/** 로그인 전 화면이 고를 수 있는 방법 */
export interface AuthOptions {
  /** 오너가 아직 없어 /setup을 쓸 수 있다 */
  setup_available: boolean;
  /** 서버에 GitHub OAuth 앱이 설정되어 있다 */
  github: boolean;
}

/** GitHub 확인은 끝났고 초대 코드를 기다리는 가입 */
export interface PendingJoin {
  github_login: string;
  suggested_name: string;
}

export interface LoginCode {
  /** 보여 주기용으로 4자씩 끊은 코드 (예: 'K7QM-4XPT') */
  code: string;
  expires_at: number;
}

export interface InviteSummary {
  id: string;
  label: string;
  created_at: number;
  expires_at: number;
  used_at: number | null;
  used_by_name: string | null;
}

/** 등급(1 다시, 2 어려움, 3 좋음, 4 쉬움)별로 다음 복습까지 남는 시간(ms). 설명하기 버튼에 보여 준다 */
export type GradeIntervals = Record<'1' | '2' | '3' | '4', number>;

/** 복습 화면에서 한 장. 기기에서 채점하므로 정답이 함께 온다 */
export interface QueueCard {
  id: string;
  concept_key: string;
  concept_name: string;
  type: CardType;
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
  /** 설명하기만: 면접관이 듣고 싶어 하는 핵심 요소 */
  checklist: string[] | null;
  /** 설명하기만: 내가 예전에 확정한 최종 버전 (개념의 final_answer) */
  final_answer: string | null;
  /** 설명하기만: 등급별 다음 간격 */
  intervals: GradeIntervals | null;
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
  /** 이미 기록했거나 내 카드가 아니어서 건너뛴 수 */
  skipped: number;
  /** 형식이 잘못돼서 버린 수 */
  rejected: number;
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
