// 마스코트 모아(moAI): 16×14 픽셀 격자의 주황 캐릭터. 색은 styles.css의 .mascot 규칙을 따른다 (다크에서는 테두리가 배경보다 어두운 먹색).
// 앱 아이콘은 scripts/gen-icons.mjs가 같은 격자(happy)로 만든다. 그림을 바꾸면 그쪽 ART도 고치고 `npm run gen:icons`를 돌린다.
// happy 기본·인사, think 생각 중(확신도), oops 틀림, cheer 목표 달성(팔을 들고 반짝임).

export type Mood = 'happy' | 'think' | 'oops' | 'cheer';

type Rect = readonly [x: number, y: number, w: number, h: number, part: string];

const HAT: Rect[] = [
  [5, 0, 6, 1, 'm-line'],
  [4, 1, 1, 2, 'm-line'],
  [11, 1, 1, 2, 'm-line'],
  [5, 1, 6, 1, 'm-cream'],
  [5, 2, 6, 1, 'm-green'],
  [3, 3, 10, 1, 'm-line'],
];
const BODY: Rect[] = [
  [2, 4, 12, 9, 'm-line'],
  [3, 4, 10, 8, 'm-body'],
  [4, 13, 3, 1, 'm-line'],
  [9, 13, 3, 1, 'm-line'],
  [3, 9, 2, 1, 'm-blush'],
  [11, 9, 2, 1, 'm-blush'],
];
const ARMS_DOWN: Rect[] = [
  [0, 6, 2, 5, 'm-line'],
  [1, 7, 1, 3, 'm-body'],
  [14, 6, 2, 5, 'm-line'],
  [14, 7, 1, 3, 'm-body'],
];
const ARMS_UP: Rect[] = [
  [0, 1, 2, 5, 'm-line'],
  [1, 2, 1, 3, 'm-body'],
  [14, 1, 2, 5, 'm-line'],
  [14, 2, 1, 3, 'm-body'],
];
const EYES_OPEN: Rect[] = [
  [5, 6, 2, 3, 'm-eye'],
  [9, 6, 2, 3, 'm-eye'],
];

const FACE: Record<Mood, Rect[]> = {
  happy: [
    ...EYES_OPEN,
    [5, 6, 1, 1, 'm-shine'],
    [9, 6, 1, 1, 'm-shine'],
    [6, 10, 1, 1, 'm-eye'],
    [7, 11, 2, 1, 'm-eye'],
    [9, 10, 1, 1, 'm-eye'],
  ],
  // 눈을 위로 굴리고 입은 일자
  think: [...EYES_OPEN, [6, 6, 1, 1, 'm-shine'], [10, 6, 1, 1, 'm-shine'], [7, 10, 2, 1, 'm-eye']],
  // 아래를 보는 눈, 삐죽한 입, 땀방울
  oops: [
    ...EYES_OPEN,
    [6, 8, 1, 1, 'm-shine'],
    [10, 8, 1, 1, 'm-shine'],
    [12, 5, 1, 2, 'm-sweat'],
    [7, 10, 2, 1, 'm-eye'],
    [6, 11, 1, 1, 'm-eye'],
    [9, 11, 1, 1, 'm-eye'],
  ],
  // 웃는 눈(^ ^)과 벌린 입
  cheer: [
    [5, 7, 1, 1, 'm-eye'],
    [6, 6, 1, 1, 'm-eye'],
    [7, 7, 1, 1, 'm-eye'],
    [9, 7, 1, 1, 'm-eye'],
    [10, 6, 1, 1, 'm-eye'],
    [11, 7, 1, 1, 'm-eye'],
    [6, 9, 1, 1, 'm-eye'],
    [9, 9, 1, 1, 'm-eye'],
    [7, 9, 2, 1, 'm-tongue'],
    [7, 10, 2, 1, 'm-eye'],
  ],
};

const SPARKS: Rect[] = [
  [-2, 0, 1, 3, 'm-spark'],
  [-3, 1, 3, 1, 'm-spark'],
  [17, -2, 1, 3, 'm-spark'],
  [16, -1, 3, 1, 'm-spark'],
  [18, 7, 1, 1, 'm-spark2'],
  [-2, 9, 1, 1, 'm-spark2'],
  [17, 11, 1, 1, 'm-body'],
];

/** size는 그림 너비(px). 16의 배수면 픽셀이 또렷하다. label이 없으면 장식으로 본다 */
export function Mascot({ mood = 'happy', size = 48, label }: { mood?: Mood; size?: number; label?: string }) {
  const cheer = mood === 'cheer';
  const rects = [...HAT, ...BODY, ...(cheer ? ARMS_UP : ARMS_DOWN), ...FACE[mood], ...(cheer ? SPARKS : [])];
  const [viewBox, ratio] = cheer ? ['-3 -3 22 18', 18 / 22] : ['0 0 16 14', 14 / 16];
  return (
    <svg
      className="mascot"
      width={size}
      height={Math.round(size * ratio)}
      viewBox={viewBox}
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
    >
      {rects.map(([x, y, w, h, part], index) => (
        <rect key={index} x={x} y={y} width={w} height={h} className={part} />
      ))}
    </svg>
  );
}
