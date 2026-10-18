import type { ReactNode } from 'react';

// 마스코트 모아(moAI): 16×14 픽셀 격자의 주황 캐릭터. 색은 styles.css의 .mascot 규칙을 따른다
// (다크에서는 테두리가 배경보다 어두운 먹색이고, ? ! … z 표시는 크림이다).
// 앱 아이콘은 scripts/gen-icons.mjs가 같은 격자(happy)로 만든다. 그림을 바꾸면 그쪽 ART도 고치고 `npm run gen:icons`를 돌린다.
// 사용자가 만든 상황 시트(인사, 공부 중, 복습 알림, 오답, 생각 중, Claude로 이어서, LEVEL UP, 휴식)에 기본과 축하를 더했다.
// 깜빡임, 숨쉬기, 손 흔들기 같은 움직임은 styles.css의 .mascot.alive 규칙이다. 동작 줄이기를 켜면 깜빡임 같은 투명도 변화만 남는다.

export type Mood = 'happy' | 'wave' | 'think' | 'oops' | 'cheer' | 'levelup' | 'study' | 'alarm' | 'claude' | 'sleep';

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
const ARM_LEFT: Rect[] = [
  [0, 6, 2, 5, 'm-line'],
  [1, 7, 1, 3, 'm-body'],
];
const ARM_RIGHT: Rect[] = [
  [14, 6, 2, 5, 'm-line'],
  [14, 7, 1, 3, 'm-body'],
];
const ARM_LEFT_UP: Rect[] = [
  [0, 1, 2, 5, 'm-line'],
  [1, 2, 1, 3, 'm-body'],
];
const ARM_RIGHT_UP: Rect[] = [
  [14, 1, 2, 5, 'm-line'],
  [14, 2, 1, 3, 'm-body'],
];
const EYES: Rect[] = [
  [5, 6, 2, 3, 'm-eye'],
  [9, 6, 2, 3, 'm-eye'],
];
/** 눈의 반짝임 자리로 보는 곳을 바꾼다: 앞, 위(생각 중), 아래(틀림·책 읽기) */
const SHINE = {
  front: [
    [5, 6, 1, 1, 'm-shine'],
    [9, 6, 1, 1, 'm-shine'],
  ],
  up: [
    [6, 6, 1, 1, 'm-shine'],
    [10, 6, 1, 1, 'm-shine'],
  ],
  down: [
    [6, 8, 1, 1, 'm-shine'],
    [10, 8, 1, 1, 'm-shine'],
  ],
} satisfies Record<string, Rect[]>;
const EYES_CLOSED: Rect[] = [
  [5, 8, 2, 1, 'm-eye'],
  [9, 8, 2, 1, 'm-eye'],
];
/** 웃는 눈 (^ ^) */
const EYES_JOY: Rect[] = [
  [5, 7, 1, 1, 'm-eye'],
  [6, 6, 1, 1, 'm-eye'],
  [7, 7, 1, 1, 'm-eye'],
  [9, 7, 1, 1, 'm-eye'],
  [10, 6, 1, 1, 'm-eye'],
  [11, 7, 1, 1, 'm-eye'],
];
const MOUTH = {
  smile: [
    [6, 10, 1, 1, 'm-eye'],
    [7, 11, 2, 1, 'm-eye'],
    [9, 10, 1, 1, 'm-eye'],
  ],
  flat: [[7, 10, 2, 1, 'm-eye']],
  wobble: [
    [7, 10, 2, 1, 'm-eye'],
    [6, 11, 1, 1, 'm-eye'],
    [9, 11, 1, 1, 'm-eye'],
  ],
  open: [
    [6, 9, 1, 1, 'm-eye'],
    [9, 9, 1, 1, 'm-eye'],
    [7, 9, 2, 1, 'm-tongue'],
    [7, 10, 2, 1, 'm-eye'],
  ],
} satisfies Record<string, Rect[]>;
const BOOK: Rect[] = [
  [3, 9, 10, 5, 'm-line'],
  [4, 10, 4, 3, 'm-page'],
  [8, 10, 4, 3, 'm-page2'],
  [5, 11, 2, 1, 'm-text'],
  [9, 11, 2, 1, 'm-text'],
];
const phone = (screen: string): Rect[] => [
  [12, 6, 4, 6, 'm-line'],
  [13, 7, 2, 4, screen],
];

// 몸 밖의 표시. 그림 상자(16×14) 밖으로 나가도 보이게 svg는 overflow: visible이다
const QUESTION: Rect[] = [
  [16, -3, 3, 1, 'm-mark'],
  [18, -2, 1, 1, 'm-mark'],
  [17, -1, 1, 1, 'm-mark'],
  [17, 1, 1, 1, 'm-mark'],
];
const DOTS: Rect[] = [
  [14, -2, 1, 1, 'm-mark m-dot1'],
  [16, -2, 1, 1, 'm-mark m-dot2'],
  [18, -2, 1, 1, 'm-mark m-dot3'],
];
const SPARKS: Rect[] = [
  [-2, 0, 1, 3, 'm-spark'],
  [-3, 1, 3, 1, 'm-spark'],
  [18, 7, 1, 1, 'm-spark2'],
  [-2, 9, 1, 1, 'm-spark2'],
  [17, 11, 1, 1, 'm-body'],
];
const SPARK_RIGHT: Rect[] = [
  [17, -2, 1, 3, 'm-spark'],
  [16, -1, 3, 1, 'm-spark'],
];
const ARROW_UP: Rect[] = [
  [17, -3, 1, 1, 'm-up'],
  [16, -2, 3, 1, 'm-up'],
  [17, -1, 1, 3, 'm-up'],
];
const BANG: Rect[] = [
  [17, -3, 1, 3, 'm-mark'],
  [17, 1, 1, 1, 'm-mark'],
];
/** 오른쪽 위를 가리키는 화살표 (Claude로 이어서) */
const ARROW_OUT: Rect[] = [
  [16, -3, 3, 1, 'm-claude'],
  [17, -2, 2, 1, 'm-claude'],
  [16, -1, 1, 1, 'm-claude'],
  [18, -1, 1, 1, 'm-claude'],
  [15, 0, 1, 1, 'm-claude'],
];
const Z_SMALL: Rect[] = [
  [14, -1, 3, 1, 'm-mark'],
  [15, 0, 1, 1, 'm-mark'],
  [14, 1, 3, 1, 'm-mark'],
];
const Z_BIG: Rect[] = [
  [16, -4, 3, 1, 'm-mark'],
  [17, -3, 1, 1, 'm-mark'],
  [16, -2, 3, 1, 'm-mark'],
];

interface Pose {
  /** wave: 오른팔을 흔든다. hold: 오른손에 휴대폰을 든다 */
  arms: 'down' | 'up' | 'wave' | 'hold';
  eyes: 'open' | 'joy' | 'closed';
  look?: keyof typeof SHINE;
  mouth: keyof typeof MOUTH;
  /** 몸 전체의 움직임 */
  move: 'bob' | 'hop' | 'breathe';
}

const POSES: Record<Mood, Pose> = {
  happy: { arms: 'down', eyes: 'open', look: 'front', mouth: 'smile', move: 'bob' },
  wave: { arms: 'wave', eyes: 'open', look: 'front', mouth: 'smile', move: 'bob' },
  think: { arms: 'down', eyes: 'open', look: 'up', mouth: 'flat', move: 'bob' },
  oops: { arms: 'down', eyes: 'open', look: 'down', mouth: 'wobble', move: 'bob' },
  cheer: { arms: 'up', eyes: 'joy', mouth: 'open', move: 'hop' },
  levelup: { arms: 'up', eyes: 'joy', mouth: 'open', move: 'hop' },
  study: { arms: 'down', eyes: 'open', look: 'down', mouth: 'flat', move: 'bob' },
  alarm: { arms: 'hold', eyes: 'open', look: 'front', mouth: 'smile', move: 'bob' },
  claude: { arms: 'hold', eyes: 'open', look: 'front', mouth: 'smile', move: 'bob' },
  sleep: { arms: 'down', eyes: 'closed', mouth: 'flat', move: 'breathe' },
};

function Rects({ list }: { list: readonly Rect[] }) {
  return (
    <>
      {list.map(([x, y, w, h, part], index) => (
        <rect key={index} x={x} y={y} width={w} height={h} className={part} />
      ))}
    </>
  );
}

/** 몸에 붙은 소품: 책, 휴대폰, 땀방울 */
const PROPS: Partial<Record<Mood, ReactNode>> = {
  study: <Rects list={BOOK} />,
  alarm: (
    <g className="m-ring">
      <Rects list={phone('m-screen')} />
    </g>
  ),
  claude: <Rects list={phone('m-screen2')} />,
  oops: (
    <g className="m-drop">
      <Rects list={[[12, 5, 1, 2, 'm-sweat']]} />
    </g>
  ),
};

/** 몸 밖의 표시: 생각 점, 물음표, 반짝임, 화살표, 느낌표, z */
const MARKS: Partial<Record<Mood, ReactNode>> = {
  think: <Rects list={DOTS} />,
  oops: <Rects list={QUESTION} />,
  cheer: (
    <g className="m-twinkle">
      <Rects list={[...SPARKS, ...SPARK_RIGHT]} />
    </g>
  ),
  levelup: (
    <>
      <g className="m-twinkle">
        <Rects list={SPARKS} />
      </g>
      <g className="m-float">
        <Rects list={ARROW_UP} />
      </g>
    </>
  ),
  alarm: (
    <g className="m-float">
      <Rects list={BANG} />
    </g>
  ),
  claude: (
    <g className="m-float">
      <Rects list={ARROW_OUT} />
    </g>
  ),
  sleep: (
    <>
      <g className="m-z1">
        <Rects list={Z_SMALL} />
      </g>
      <g className="m-z2">
        <Rects list={Z_BIG} />
      </g>
    </>
  ),
};

/**
 * size는 캐릭터 너비(px). 16의 배수면 픽셀이 또렷하다. 표시(? z 반짝임)는 그 상자 밖으로 조금 나간다.
 * label이 없으면 장식으로 본다. still이면 움직이지 않는다 (작은 로고 등)
 */
export function Mascot({ mood = 'happy', size = 48, label, still = false }: { mood?: Mood; size?: number; label?: string; still?: boolean }) {
  const pose = POSES[mood];
  return (
    <svg
      className={still ? 'mascot' : 'mascot alive'}
      width={size}
      height={Math.round((size * 14) / 16)}
      viewBox="0 0 16 14"
      overflow="visible"
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
    >
      <g className={`m-${pose.move}`}>
        {pose.arms === 'up' ? <Rects list={[...ARM_LEFT_UP, ...ARM_RIGHT_UP]} /> : <Rects list={ARM_LEFT} />}
        {pose.arms === 'down' ? <Rects list={ARM_RIGHT} /> : null}
        {pose.arms === 'wave' ? (
          <>
            <g className="m-wave-a">
              <Rects list={ARM_RIGHT_UP} />
            </g>
            <g className="m-wave-b">
              <Rects list={ARM_RIGHT} />
            </g>
          </>
        ) : null}
        <Rects list={HAT} />
        <Rects list={BODY} />
        {pose.eyes === 'open' ? (
          <>
            <g className="m-eyes-open">
              <Rects list={[...EYES, ...SHINE[pose.look ?? 'front']]} />
            </g>
            <g className="m-eyes-closed">
              <Rects list={EYES_CLOSED} />
            </g>
          </>
        ) : (
          <Rects list={pose.eyes === 'joy' ? EYES_JOY : EYES_CLOSED} />
        )}
        <Rects list={MOUTH[pose.mouth]} />
        {PROPS[mood]}
      </g>
      {MARKS[mood]}
    </svg>
  );
}
