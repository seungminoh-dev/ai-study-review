// 이정표 배지 (3단계 3-4). 무엇을 몇 번 하면 받는지만 둔다.
// 이름과 그림은 PWA(apps/web/src/badges.tsx)가, 받은 기록은 서버(badges 테이블)가 갖는다. 순서는 화면에 보이는 순서다.

export type BadgeKind = 'saves' | 'reviews' | 'explains' | 'streak' | 'concepts';

export const BADGES = [
  { id: 'first_save', kind: 'saves', target: 1 },
  { id: 'first_review', kind: 'reviews', target: 1 },
  { id: 'streak_3', kind: 'streak', target: 3 },
  { id: 'first_explain', kind: 'explains', target: 1 },
  { id: 'streak_7', kind: 'streak', target: 7 },
  { id: 'concepts_10', kind: 'concepts', target: 10 },
  { id: 'reviews_100', kind: 'reviews', target: 100 },
  { id: 'streak_30', kind: 'streak', target: 30 },
  { id: 'concepts_50', kind: 'concepts', target: 50 },
  { id: 'reviews_500', kind: 'reviews', target: 500 },
  { id: 'reviews_1000', kind: 'reviews', target: 1000 },
] as const satisfies readonly { id: string; kind: BadgeKind; target: number }[];

export type BadgeId = (typeof BADGES)[number]['id'];
