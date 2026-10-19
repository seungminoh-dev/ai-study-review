// 오늘의 퀘스트 (4단계). 매일 같은 세 가지라 지난날의 XP도 기록에서 다시 셀 수 있다 (worker의 domain/stats.ts).
// 이름은 PWA가 붙인다.

export const QUESTS = [
  /** 카드 10장 풀기 (학습·복습 모두) */
  { id: 'cards', target: 10 },
  /** 무실수 복습 1번 (한 번에 5장 이상 모두 맞히기) */
  { id: 'perfect', target: 1 },
  /** 새 카드 5장 학습, 또는 설명하기 1장 통과 */
  { id: 'learn', target: 5 },
] as const;

export type QuestId = (typeof QUESTS)[number]['id'];

/** 퀘스트 하나를 마치면 받는 XP */
export const QUEST_XP = 10;
