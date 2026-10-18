import type { CSSProperties } from 'react';

// 목표를 채웠을 때 마스코트 뒤에서 터지는 픽셀 꽃가루. CSS 애니메이션만 쓰고, 동작 줄이기면 보이지 않는다

const COLORS = ['var(--accent)', 'var(--good-fill)', '#ffbd4a', '#ffb17c', 'var(--text)'];
const PIECES = 16;

/** 조각마다 퍼지는 방향, 거리, 회전. 그릴 때마다 같은 모양이 되도록 계산으로 정한다 */
const pieces = Array.from({ length: PIECES }, (_, index) => {
  const angle = (index / PIECES) * Math.PI * 2 + (index % 2) * 0.2;
  const distance = 84 + (index % 3) * 30;
  return {
    '--x': `${Math.round(Math.cos(angle) * distance)}px`,
    // 아래로 조금 떨어지며 사라진다
    '--y': `${Math.round(Math.sin(angle) * distance * 0.8 + 36)}px`,
    '--r': `${(index % 2 ? -1 : 1) * (160 + index * 12)}deg`,
    '--c': COLORS[index % COLORS.length],
    animationDelay: `${(index % 4) * 30}ms`,
  } as CSSProperties;
});

export function Confetti() {
  return (
    <div className="confetti" aria-hidden="true">
      {pieces.map((style, index) => (
        <span key={index} style={style} />
      ))}
    </div>
  );
}
