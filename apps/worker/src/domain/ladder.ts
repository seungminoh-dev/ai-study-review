// 카드 사다리 (설계서 §9.4)

/** 이 안정도(일)를 넘으면 그 단계는 익혔다고 본다 */
export const LADDER_STABILITY_DAYS = 7;
/** 3단계(설명하기)까지 연다. MVP 1은 설명하기 화면이 없어서 2단계까지만 열었다 */
export const MAX_OPEN_RUNG = 3;

export interface LadderCard {
  id: string;
  concept_id: string;
  rung: number;
  status: string;
  stability: number;
}

/**
 * 개념마다, 지금 열린 가장 높은 단계 r의 활성 카드가 모두 익었으면
 * r보다 높은 잠긴 단계 중 가장 낮은 단계의 카드를 연다. 활성 카드가 하나도 없으면(모두 꺼짐) 가장 낮은 잠긴 단계를 연다.
 */
export function cardsToUnlock(cards: readonly LadderCard[], maxRung = MAX_OPEN_RUNG): string[] {
  const byConcept = new Map<string, LadderCard[]>();
  for (const card of cards) {
    const list = byConcept.get(card.concept_id) ?? [];
    list.push(card);
    byConcept.set(card.concept_id, list);
  }
  const unlock: string[] = [];
  for (const list of byConcept.values()) {
    const active = list.filter((card) => card.status === 'active');
    const open = active.reduce((max, card) => Math.max(max, card.rung), 0);
    const ripe = active.filter((card) => card.rung === open).every((card) => card.stability >= LADDER_STABILITY_DAYS);
    if (!ripe) continue;
    const locked = list.filter((card) => card.status === 'locked' && card.rung > open && card.rung <= maxRung);
    if (locked.length === 0) continue;
    const next = Math.min(...locked.map((card) => card.rung));
    for (const card of locked) if (card.rung === next) unlock.push(card.id);
  }
  return unlock;
}

/**
 * 저장할 때 새 카드의 상태를 정한다. 그 개념에서 이미 열린 단계(없으면 새 카드 중 가장 낮은 단계)까지만 active다.
 * 설명하기 카드는 언제나 locked다.
 */
export function initialStatus(rung: number, openRung: number): 'active' | 'locked' {
  return rung <= openRung && rung <= MAX_OPEN_RUNG && rung < 3 ? 'active' : 'locked';
}
