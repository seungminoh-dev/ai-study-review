import type { CreditBalance } from '@moai/shared';
import { creditsLeft } from '@moai/shared/client';
import { useEffect, useState, type ReactElement } from 'react';
import { CREDITS_CHANGED, aiStatus } from './ai';
import { Link } from './router';

// AI 크레딧 도트 (6단계 시안 "AI 크레딧 도트"): 엽전(가운데 네모 구멍)과 보석 그림, 오늘 화면·사이드바의 엽전 칩.
// 그림은 글자 지도다. 한 줄에서 같은 글자가 이어지면 사각형 하나로 그리고, 색은 styles.css의 .px-* 가 정한다.

type Art = readonly string[];

/** o 테두리, y 금색, w 빛, d 그늘. 가운데 o 네모가 엽전 구멍이다 */
const COIN: Art = ['..oooooo..', '.oyyyyyyo.', 'oywwyyyydo', 'oywyyyyydo', 'oyyyooyydo', 'oyyyooyydo', 'oyyyyyyydo', 'oyyyyyyddo', '.oddddddo.', '..oooooo..'];
/** 다 쓴 엽전 */
const COIN_EMPTY: Art = ['..ssssss..', '.seeeeees.', 'seeeeeeees', 'seeeeeeees', 'seeesseees', 'seeesseees', 'seeeeeeees', 'seeeeeeees', '.seeeeees.', '..ssssss..'];
/** o 테두리, w 빛, l 연두, g 초록, k 짙은 초록 */
const GEM: Art = ['..oooooo..', '.owlgggko.', 'owlggggkko', 'oggggggkko', '.oggggkko.', '..oggkko..', '...okko...', '....oo....'];
const GEM_EMPTY: Art = ['..ssssss..', '.seeeeees.', 'seeeeeeees', 'seeeeeeees', '.seeeeees.', '..seeees..', '...sees...', '....ss....'];

function Sprite({ art, px }: { art: Art; px: number }) {
  const width = Math.max(...art.map((row) => row.length));
  const rects = art.flatMap((row, y) => {
    const runs: ReactElement[] = [];
    for (let x = 0; x < row.length; ) {
      let end = x + 1;
      while (end < row.length && row[end] === row[x]) end += 1;
      if (row[x] !== '.') runs.push(<rect key={`${x}-${y}`} className={`px-${row[x]}`} x={x} y={y} width={end - x} height={1} />);
      x = end;
    }
    return runs;
  });
  return (
    <svg className="pixel" width={width * px} height={art.length * px} viewBox={`0 0 ${width} ${art.length}`} shapeRendering="crispEdges" aria-hidden="true">
      {rects}
    </svg>
  );
}

export const Coin = ({ px = 2, empty = false }: { px?: number; empty?: boolean }) => <Sprite art={empty ? COIN_EMPTY : COIN} px={px} />;
export const Gem = ({ px = 2, empty = false }: { px?: number; empty?: boolean }) => <Sprite art={empty ? GEM_EMPTY : GEM} px={px} />;

/** 내 크레딧. AI 상태와 같이 받아 기억하고, 크레딧을 쓰거나 받으면(forgetAiStatus) 다시 묻는다. 못 받았으면 null */
export function useCredits(): CreditBalance | null {
  const [credits, setCredits] = useState<CreditBalance | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      void aiStatus().then((status) => {
        // 서버에 닿지 못한 대신 값(refill_at 0)은 보여 주지 않는다
        if (alive) setCredits(status.credits.refill_at > 0 ? status.credits : null);
      });
    load();
    window.addEventListener(CREDITS_CHANGED, load);
    return () => {
      alive = false;
      window.removeEventListener(CREDITS_CHANGED, load);
    };
  }, []);
  return credits;
}

/** 엽전 칩: 지금 쓸 수 있는 크레딧(월간 + 보유). 누르면 크레딧 화면 */
export function CreditChip({ className, unit = false }: { className?: string; unit?: boolean }) {
  const credits = useCredits();
  if (!credits) return null;
  const total = creditsLeft(credits);
  return (
    <Link className={className ? `credit-chip ${className}` : 'credit-chip'} href="/credits" aria-label={`AI 크레딧 ${total}`}>
      <Coin px={2} />
      {total.toLocaleString()}
      {unit ? ' 크레딧' : ''}
    </Link>
  );
}
