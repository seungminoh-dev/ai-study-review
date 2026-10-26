// AI 크레딧 (4단계): 앱 안에서 AI 기능에 쓰는 재화다. 돈으로 사거나 팔거나 다른 것으로 바꿀 수 없다.
// 월간 크레딧은 매달 1일(한국 시간)에 다시 채워지고, 남은 것은 다음 달로 넘어가지 않는다.
// 보유 크레딧은 운영자가 주거나 숨은 업적을 이루면 받고, 쓰기 전까지 남는다. 쓸 때는 월간 크레딧부터 쓴다.

/** 기능마다 드는 크레딧 */
export const CREDIT_COST = {
  /** 개념 물어보기 한 번 */
  ask: 1,
  /** 모의면접 질문 하나 (마지막 정리 포함) */
  interview: 1,
  /** 설명하기 AI 채점 */
  grade: 1,
  /** 대화로 카드 만들기 (개념 채팅, 모의면접 기록) */
  cards: 5,
  /** 붙여 넣은 대화 가져오기 */
  import: 10,
} as const;

export type CreditKind = keyof typeof CREDIT_COST;

/**
 * 모의면접 깊이 (2026-10-21): 질문 수와 이어 갈 개념 수. 크레딧은 질문마다 1, 마지막 정리 1이다.
 * 중간에 그만두면 물은 만큼만 쓴다
 */
export const INTERVIEW_DEPTHS = {
  light: { label: '가볍게', questions: 3, concepts: 2 },
  normal: { label: '보통', questions: 6, concepts: 3 },
  deep: { label: '깊게', questions: 10, concepts: 4 },
} as const;
export type InterviewDepth = keyof typeof INTERVIEW_DEPTHS;

/** 그 깊이를 끝까지 하면 드는 크레딧 (질문 + 마지막 정리) */
export const interviewCost = (depth: InterviewDepth): number => (INTERVIEW_DEPTHS[depth].questions + 1) * CREDIT_COST.interview;

/** 모의면접 난이도 */
export const INTERVIEW_LEVELS = { basic: '기초', practical: '실무', advanced: '심화' } as const;
export type InterviewLevel = keyof typeof INTERVIEW_LEVELS;

export interface CreditBalance {
  /** 이번 달 남은 월간 크레딧 */
  monthly: number;
  /** 한 달 월간 크레딧 */
  monthly_total: number;
  /** 보유 크레딧 (쓰기 전까지 남는다) */
  held: number;
  /** 월간 크레딧이 다시 채워지는 시각 (한국 시간 다음 달 1일 0시) */
  refill_at: number;
}

/** 지금 쓸 수 있는 크레딧 */
export const creditsLeft = (balance: CreditBalance): number => balance.monthly + balance.held;
