import type { ReviewGrade } from './api';

// 기기에서 채점한 결과를 FSRS 등급으로 바꾼다 (설계서 §9.3).

/** 맞혔어도 이보다 오래 걸리면 어려움(Hard)으로 매긴다 */
export const HARD_AFTER_MS = 15_000;

export interface AnswerResult {
  correct: boolean;
  elapsedMs: number;
  /** 사용자가 "너무 쉬웠어요"를 눌렀다 */
  easy?: boolean;
}

/**
 * 틀림 → Again(1), 맞음이지만 15초 넘게 걸림 → Hard(2), 맞음 → Good(3), 맞음 + "너무 쉬웠어요" → Easy(4).
 * 빨리 맞혔다고 Easy를 주지 않는다. 객관식은 찍어서 빨리 맞힐 수 있다.
 */
export function gradeAnswer({ correct, elapsedMs, easy = false }: AnswerResult): ReviewGrade {
  if (!correct) return 1;
  if (easy) return 4;
  return elapsedMs > HARD_AFTER_MS ? 2 : 3;
}

/** 한 장에 걸리는 평균 시간. 8장이 약 3분이다 */
export const SECONDS_PER_CARD = 22;

export function estimateMinutes(cards: number): number {
  return cards === 0 ? 0 : Math.max(1, Math.round((cards * SECONDS_PER_CARD) / 60));
}
