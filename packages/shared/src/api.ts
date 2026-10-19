import { z } from 'zod';
import type { BadgeId } from './badges';
import type { EdgeType, JudgmentLabel } from './save-learning';

// REST API(PWA용) 요청 스키마와 응답 타입 (설계서 §7). Worker와 PWA가 같이 쓴다.

import { MAX_ELAPSED_MS, MAX_REMINDERS, PERFECT_MIN_ANSWERS, PERFECT_XP, REVIEWS_PER_REQUEST, isHhmm } from './limits';

export { MAX_ELAPSED_MS, MAX_REMINDERS, PERFECT_MIN_ANSWERS, PERFECT_XP, REVIEWS_PER_REQUEST, isHhmm };

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

export const InviteBody = z.object({
  label: z.string().trim().min(1).max(30),
  /** 기기를 다 잃은 사람에게: 이 초대로 들어오면 새 계정 대신 이 계정으로 로그인한다 */
  bind_user_id: z.uuid().optional(),
});

/** 계정 지우기. 실수를 막으려고 내 이름을 그대로 다시 쓴다 */
export const DeleteAccountBody = z.object({ confirm: z.string().min(1).max(30) });
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
  /** 답을 보기 전에 스스로 매긴 확신도 */
  confidence: z.enum(['sure', 'unsure', 'guess']).optional(),
  /** 너무 크면 버리지 않고 MAX_ELAPSED_MS로 자른다 */
  elapsed_ms: z
    .number()
    .min(0)
    .transform((value) => Math.min(Math.round(value), MAX_ELAPSED_MS))
    .optional(),
  reviewed_at: z.int().positive(),
  /** 복습 화면을 한 번 열어 푼 답의 묶음 (기기에서 만든 UUID). 무실수 보너스를 센다 */
  run_id: z.uuid().optional(),
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
  /** 스트릭을 세는 하루 목표 (장) */
  daily_goal: number;
  /** 연결한 GitHub 계정. 없으면 null */
  github_login: string | null;
}

export interface StatsDay {
  /** 'YYYY-MM-DD' (04:00 KST 경계) */
  day: string;
  reviewed: number;
  met: boolean;
  frozen: boolean;
  future: boolean;
}

/** 스트릭·XP·하루 목표 (설계서 §9.6) */
export interface StatsResponse {
  goal: number;
  /** reviewed는 오늘 푼 카드 전체, learned는 그중 자료 카드를 처음 푼 수 (학습) */
  today: { reviewed: number; learned: number; xp: number };
  streak: number;
  /** 이번 주 프리즈를 아직 안 썼다 */
  freeze_available: boolean;
  /** 이번 주 (월요일부터) */
  week: { xp: number; days: StatsDay[] };
  /** 가장 길었던 연속 일수 (1년 안에서) */
  best_streak: number;
  /** 지난주(월~일) XP. "지난주의 나"와 비교한다 */
  last_week_xp: number;
  /** 최근 12주. 11주 전 월요일부터 이번 주 일요일까지 84일 */
  history: StatsDay[];
  /** 이정표 배지. packages/shared/src/badges.ts의 BADGES 순서 */
  badges: Badge[];
}

/** 이정표 배지 하나 (3단계 3-4). 한 번 받으면 하루 목표를 바꾸거나 답을 되돌려도 남는다 */
export interface Badge {
  id: BadgeId;
  /** 받은 시각. 아직이면 null */
  earned_at: number | null;
  /** 지금까지의 수와 목표. 연속은 가장 길었던 연속 일수다 */
  value: number;
  target: number;
}

/** 개념 상태 (설계서 §9.7): 아직 안 배움(점선) · 익숙함(초록) · 흔들림(노랑) · 자료(아직 안 푼 자료, 내 지식 아님) */
export type ConceptStateKey = 'unlearned' | 'familiar' | 'shaky' | 'material';

export interface MapNode {
  key: string;
  name: string;
  state: ConceptStateKey;
  cards: number;
  category: string | null;
}

export interface MapResponse {
  nodes: MapNode[];
  edges: { from: string; to: string; type: EdgeType }[];
}

export interface ConceptDetail {
  key: string;
  name: string;
  aliases: string[];
  category: string | null;
  state: ConceptStateKey;
  final_answer: string | null;
  judgments: { id: string; label: JudgmentLabel; said: string | null; note: string; created_at: number; topic: string }[];
  cards: (SessionCard & { due: number; stability: number; reps: number })[];
  followups: { id: string; question: string }[];
  neighbors: { key: string; name: string; state: ConceptStateKey; type: EdgeType; direction: 'out' | 'in' }[];
  /** claude.ai에 붙여 넣을 "이어서 공부하기" 프롬프트 */
  continue_prompt: string;
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

/** 자료 하나 (PDF 등). 같은 제목의 저장을 묶는다 */
export interface MaterialSummary {
  /** 원래 이름 (Claude가 저장할 때 쓴 PDF 이름). 자료를 묶는 열쇠라 바꾸지 않는다 */
  title: string;
  /** 보여 줄 이름: 사용자가 바꾼 이름, 없으면 원래 이름을 다듬은 것 */
  name: string;
  /** 섹션 이름. 쪽수 순서(없으면 저장한 순서) */
  parts: string[];
  cards: number;
  /** 한 번이라도 푼 카드 */
  solved: number;
  /** 지금 풀 수 있는(열린) 안 푼 카드 */
  unsolved_open: number;
  concepts: number;
  /** 풀어서 내 지식이 된 개념 */
  adopted: number;
  created_at: number;
  /** 이어서 풀 섹션: 안 푼 열린 카드가 남은 첫 섹션 */
  next: { part: string; unsolved_open: number } | null;
  /** 섹션 원래 이름 → 사용자가 바꾼 이름. 바꾼 섹션만 있다 */
  part_labels: Record<string, string>;
}

export interface MaterialConcept {
  key: string;
  name: string;
  /** 풀어서 내 지식이 됐다 */
  adopted: boolean;
}

export interface MaterialPart {
  /** 저장할 때 받은 범위 이름 (예: "프로그램 기초 (p.3–21)"). 없으면 빈 문자열 */
  name: string;
  /** 이 섹션의 가장 최근 저장. "카드 보기"가 연다 */
  session_id: string;
  cards: number;
  solved: number;
  unsolved_open: number;
  /** 이 섹션의 개념 (최대 12개) */
  concepts: MaterialConcept[];
  /** 카드 미리보기: 안 푼 카드부터 3장 */
  preview: { type: CardType; prompt: string }[];
}

/** 자료 하나의 섹션별 진행 (GET /api/materials/detail?title=) */
export interface MaterialDetail extends Omit<MaterialSummary, 'parts' | 'next'> {
  parts: MaterialPart[];
}

export interface CategoryNode {
  path: string;
  concepts: number;
}

export const ConceptCategoryBody = z.object({ category: z.string().trim().max(80).nullable() });
export const MaterialBody = z.object({ title: z.string().trim().min(1).max(120) });
/** 자료 이름 바꾸기. 비우면 원래 이름(PDF 이름)으로 돌아간다 */
export const MaterialLabelBody = z.object({ title: z.string().trim().min(1).max(120), label: z.string().trim().max(80) });
/** 자료 섹션 이름 바꾸기. part는 원래 섹션 이름(이름 없는 섹션은 빈 문자열), 비우면 원래 이름으로 돌아간다 */
export const MaterialPartLabelBody = z.object({ title: z.string().trim().min(1).max(120), part: z.string().max(80), label: z.string().trim().max(80) });
/** 저장한 대화 이름 바꾸기 */
export const SessionTopicBody = z.object({ topic: z.string().trim().min(1).max(200) });

/** 베타 지표 (설계서 §2.3 끝났다는 기준) */
export interface BetaMetrics {
  users: number;
  /** 최근 7일에 한 장이라도 복습한 사람 / 전체 (목표 60% 이상) */
  weekly_reviewers: number;
  /** 최근 30일 카드 신고 / 그 기간에 복습한 카드 수 (목표 5% 미만) */
  report_rate: number;
  reports_30d: number;
  reviewed_cards_30d: number;
  /** 이번 달 서버 AI 비용 (목표 월 $100 미만) */
  ai_usd_month: number;
  people: { name: string; reviews_7d: number; last_review_at: number | null; joined_at: number }[];
}

export interface MemberSummary {
  id: string;
  display_name: string;
  github_login: string | null;
  created_at: number;
}

export interface InviteSummary {
  id: string;
  label: string;
  /** 기기 복구 초대면 그 사람 이름 */
  bind_name?: string | null;
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
  /** 자료에서 만든 저장이면 자료 제목 */
  material: string | null;
  /** 자료의 보여 줄 이름 (바꾼 이름, 없으면 PDF 이름을 다듬은 것) */
  material_name: string | null;
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
  /** 남은 카드 나누기: 마지막 답이 틀린 카드, 대화에서 온 새 카드. 나머지는 다시 볼 때가 된 카드다 */
  parts: { wrong: number; fresh: number };
  /** 복습 탭의 "틀린 것": 최근 30일 안에 마지막 답이 틀린 카드 (오늘 푼 것 빼고) */
  mistakes: number;
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
  /** 이번 답으로 다음 단계가 열린 개념 (LEVEL UP). 끝 화면이 보여 준다 */
  level_ups: LevelUp[];
}

export interface LevelUp {
  concept_key: string;
  concept_name: string;
  /** 새로 열린 단계. 2: 빈칸·코드 문제, 3: 설명하기 */
  rung: number;
}

export interface Reminder {
  local_time: string;
  enabled: boolean;
  next_fire_at: number;
}

export interface McpTokenStatus {
  /** 예전 방식 비밀 주소가 살아 있다 */
  active: boolean;
  created_at: number | null;
  /** 비밀 주소든 로그인(OAuth)이든 claude.ai에 연결돼 있다 */
  connected: boolean;
}

export interface ApiError {
  error: { code: string; message: string };
}
