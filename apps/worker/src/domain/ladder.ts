// 카드 사다리 (설계서 §9.4)

/** 이 안정도(일)를 넘으면 그 단계는 익혔다고 본다 (지식 지도의 익힘) */
export const LADDER_STABILITY_DAYS = 7;
/**
 * 다음 단계를 여는 안정도(일). 새 카드를 한 번 '맞음'(2.3일)이나 '쉬움'(8.3일)으로 맞히면 넘고, '어려움'(1.3일)이나 틀림은 넘지 못한다.
 * 7일일 때는 아래 단계를 며칠 간격으로 두 번 맞혀야 해서, 설명하기를 만나기까지 열흘 넘게 걸렸다 (2026-10-21)
 */
export const RUNG_OPEN_STABILITY_DAYS = 2;
/** 3단계(설명하기)까지 연다. MVP 1은 설명하기 화면이 없어서 2단계까지만 열었다 */
export const MAX_OPEN_RUNG = 3;

export interface LadderCard {
  id: string;
  concept_id: string;
  rung: number;
  status: string;
  stability: number;
  origin: string;
  state: number;
}

/** 자료에서 나와 아직 한 번도 안 푼 카드. 오늘 복습에 안 나오니 사다리를 막지 않는다 */
const unsolvedMaterial = (card: LadderCard) => card.origin === 'material' && card.state === 0;

/**
 * 개념마다, 지금 열린 가장 높은 단계 r의 활성 카드가 모두 익었으면
 * r보다 높은 잠긴 단계 중 가장 낮은 단계의 카드를 연다. 활성 카드가 하나도 없으면(모두 꺼짐) 가장 낮은 잠긴 단계를 연다.
 * 아직 안 푼 자료 카드는 익었는지 따지지 않는다. 그 단계에 그런 카드만 있으면 아직 열지 않는다.
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
    const atOpen = active.filter((card) => card.rung === open);
    const solved = atOpen.filter((card) => !unsolvedMaterial(card));
    if (atOpen.length > 0 && solved.length === 0) continue;
    if (!solved.every((card) => card.stability >= RUNG_OPEN_STABILITY_DAYS)) continue;
    const locked = list.filter((card) => card.status === 'locked' && card.rung > open && card.rung <= maxRung);
    if (locked.length === 0) continue;
    const next = Math.min(...locked.map((card) => card.rung));
    for (const card of locked) if (card.rung === next) unlock.push(card.id);
  }
  return unlock;
}

/**
 * 열린 단계 이하인데 잠긴 카드. 사다리는 열린 단계보다 높은 카드만 열어서, 이런 카드는 스스로 풀리지 않는다.
 * 예전에는 설명하기 단계가 이미 열린 개념에 새 설명하기 카드를 저장하면 이렇게 갇혔다(개선점 8).
 * 사다리를 볼 때 같이 연다. 새 단계가 열린 것은 아니라 LEVEL UP으로 치지 않는다
 */
export function stuckCards(cards: readonly LadderCard[]): string[] {
  const open = new Map<string, number>();
  for (const card of cards) if (card.status === 'active') open.set(card.concept_id, Math.max(open.get(card.concept_id) ?? 0, card.rung));
  return cards.filter((card) => card.status === 'locked' && card.rung <= (open.get(card.concept_id) ?? 0)).map((card) => card.id);
}

/**
 * 저장할 때 새 카드의 상태를 정한다. 그 개념에서 이미 열린 단계(없으면 새 카드 중 가장 낮은 단계)까지만 active다.
 * 설명하기 카드는 그 개념의 설명하기 단계가 이미 열렸을 때만 active다 (새 개념이면 아래 단계를 익힌 뒤 열린다).
 */
export function initialStatus(rung: number, openRung: number): 'active' | 'locked' {
  return rung <= openRung && rung <= MAX_OPEN_RUNG ? 'active' : 'locked';
}
