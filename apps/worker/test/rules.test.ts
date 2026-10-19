import { describe, expect, it } from 'vitest';
import { cardsToUnlock, initialStatus, stuckCards, type LadderCard } from '../src/domain/ladder';
import { pickTopicConcepts } from '../src/domain/learner-context';
import { selectQueue, type QueueCandidate, type QueueLimits } from '../src/domain/queue';

const limits = (overrides: Partial<QueueLimits> = {}): QueueLimits => ({
  newLimit: 10,
  reviewLimit: 30,
  newSeen: 0,
  reviewsDone: 0,
  reviewedConcepts: new Set(),
  reviewedCards: new Set(),
  ...overrides,
});

const card = (id: string, concept: string, state: number, due: number, created = 0): QueueCandidate => ({
  id,
  concept_id: concept,
  state,
  due,
  created_at: created,
});

describe('selectQueue (설계서 §9.2)', () => {
  it('orders learning, then review by due, then new cards by creation', () => {
    const picked = selectQueue(
      [card('new-b', 'n2', 0, 0, 2), card('rev-late', 'r2', 2, 50), card('learn', 'l', 1, 90), card('new-a', 'n1', 0, 0, 1), card('rev-early', 'r1', 2, 10)],
      limits(),
    );
    expect(picked.map((item) => item.id)).toEqual(['learn', 'rev-early', 'rev-late', 'new-a', 'new-b']);
  });

  it('keeps one card per concept and skips concepts already reviewed today, except the same learning card', () => {
    const picked = selectQueue([card('a1', 'a', 2, 1), card('a2', 'a', 0, 0), card('b1', 'b', 2, 2), card('c1', 'c', 1, 3)], limits({
      reviewedConcepts: new Set(['b', 'c']),
      reviewedCards: new Set(['c1']),
    }));
    expect(picked.map((item) => item.id)).toEqual(['c1', 'a1']);
  });

  it('filters by concept before counting the daily limits', () => {
    // 개념 5개에 카드가 3장씩 몰려 있어도, 새 카드 상한 10 안에서 5개념이 모두 나온다
    const candidates = ['a', 'b', 'c', 'd', 'e'].flatMap((concept, i) => [0, 1, 2].map((n) => card(`${concept}${n}`, concept, 0, 0, i * 3 + n)));
    expect(selectQueue(candidates, limits()).map((item) => item.id)).toEqual(['a0', 'b0', 'c0', 'd0', 'e0']);
  });

  it('applies the daily limits after what was already done today', () => {
    const candidates = [card('r1', 'a', 2, 1), card('r2', 'b', 2, 2), card('n1', 'c', 0, 0), card('n2', 'd', 0, 0)];
    expect(selectQueue(candidates, limits({ reviewLimit: 2, reviewsDone: 1, newLimit: 1 })).map((item) => item.id)).toEqual(['r1', 'n1']);
    expect(selectQueue(candidates, limits({ newLimit: 3, newSeen: 3 })).map((item) => item.id)).toEqual(['r1', 'r2']);
  });
});

const ladder = (id: string, concept: string, rung: number, status: string, stability: number, origin = 'study', state = 2): LadderCard => ({ id, concept_id: concept, rung, status, stability, origin, state });

describe('cardsToUnlock (설계서 §9.4)', () => {
  it('opens the lowest locked rung above the open one when every open card is stable', () => {
    expect(cardsToUnlock([ladder('a', 'x', 1, 'active', 8), ladder('b', 'x', 1, 'active', 7), ladder('c', 'x', 2, 'locked', 0), ladder('d', 'x', 2, 'locked', 0)])).toEqual(['c', 'd']);
  });

  it('waits while any open card is still fresh', () => {
    expect(cardsToUnlock([ladder('a', 'x', 1, 'active', 8), ladder('b', 'x', 1, 'active', 3), ladder('c', 'x', 2, 'locked', 0)])).toEqual([]);
  });

  it('can jump from rung 1 to 3, and respects a lower cap', () => {
    const cards = [ladder('a', 'x', 1, 'active', 9), ladder('e', 'x', 3, 'locked', 0)];
    expect(cardsToUnlock(cards)).toEqual(['e']);
    expect(cardsToUnlock(cards, 2)).toEqual([]);
  });

  it('does not let unsolved material cards hold the ladder, but does not open a rung nobody has solved', () => {
    expect(cardsToUnlock([ladder('a', 'x', 1, 'active', 8), ladder('m', 'x', 1, 'active', 0, 'material', 0), ladder('c', 'x', 2, 'locked', 0)])).toEqual(['c']);
    expect(cardsToUnlock([ladder('m', 'x', 1, 'active', 0, 'material', 0), ladder('c', 'x', 2, 'locked', 0)])).toEqual([]);
    expect(cardsToUnlock([ladder('a', 'x', 1, 'active', 8), ladder('m', 'x', 1, 'active', 2, 'material', 1), ladder('c', 'x', 2, 'locked', 0)])).toEqual([]);
  });

  it('opens the lowest locked rung when every card of a concept is turned off', () => {
    expect(cardsToUnlock([ladder('a', 'x', 1, 'suspended', 0), ladder('c', 'x', 2, 'locked', 0)])).toEqual(['c']);
  });

  it('decides the starting status of saved cards', () => {
    expect(initialStatus(1, 1)).toBe('active');
    expect(initialStatus(2, 1)).toBe('locked');
    expect(initialStatus(2, 2)).toBe('active');
    // 설명하기는 그 개념의 설명하기 단계가 이미 열렸을 때만 바로 연다
    expect(initialStatus(3, 2)).toBe('locked');
    expect(initialStatus(3, 3)).toBe('active');
  });

  it('frees cards locked at or below the open rung, which the ladder would never open', () => {
    expect(stuckCards([ladder('a', 'x', 3, 'active', 8), ladder('b', 'x', 3, 'locked', 0), ladder('c', 'y', 3, 'locked', 0), ladder('d', 'y', 2, 'active', 1)])).toEqual(['b']);
    expect(stuckCards([ladder('a', 'x', 1, 'active', 8), ladder('b', 'x', 2, 'suspended', 0), ladder('c', 'x', 2, 'locked', 0)])).toEqual([]);
  });
});

describe('pickTopicConcepts', () => {
  const concepts = [
    { key: 'immutable-object', search_text: '|불변객체|immutableobject|' },
    { key: 'defensive-copy', search_text: '|방어적복사|defensivecopy|' },
    { key: 'deep-copy', search_text: '|깊은복사|deepcopy|' },
    { key: 'hash-map', search_text: '|hashmap|해시맵|' },
  ];
  const keys = (topic: string) => pickTopicConcepts(topic, concepts, 5).map((concept) => concept.key);

  it('prefers concepts whose whole name appears in the topic', () => {
    expect(keys('불변 객체와 방어적 복사')).toEqual(['immutable-object', 'defensive-copy']);
    expect(keys('자바 HashMap 동작 원리')).toEqual(['hash-map']);
  });

  it('falls back to topic words inside concept names', () => {
    expect(keys('복사')).toEqual(['defensive-copy', 'deep-copy']);
    expect(keys('네트워크')).toEqual([]);
  });
});
