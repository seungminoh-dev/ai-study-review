import { LazyMotion, MotionConfig, useIsPresent, type HTMLMotionProps, type Transition } from 'motion/react';
import * as m from 'motion/react-m';
import { useEffect, useRef, useState, type ReactNode } from 'react';

// 움직임 (3단계): 사라지는 움직임, 자리 옮김, 스프링은 Motion으로 하고 나머지는 styles.css의 CSS 애니메이션으로 한다.
// Motion 기능 묶음은 첫 화면을 그린 뒤 따로 받는다. 그전에는 움직임 없이 그대로 그린다.
// 기기에서 '동작 줄이기'를 켜면 자리를 옮기는 움직임은 멈추고 투명도·색 변화만 남는다 (CSS도 같은 규칙).

const loadFeatures = () => import('./motion-features').then((module) => module.default);

export function MotionProvider({ children }: { children: ReactNode }) {
  return (
    <MotionConfig reducedMotion="user">
      <LazyMotion features={loadFeatures} strict>
        {children}
      </LazyMotion>
    </MotionConfig>
  );
}

/**
 * AnimatePresence 안에서 쓰는 상자. 사라지는 중에는 누를 수 없게(inert) 한다.
 * 사라지는 카드의 "다음"을 한 번 더 누르면 앞 카드의 답이 또 기록되기 때문이다.
 */
export function Presence(props: HTMLMotionProps<'div'>) {
  const present = useIsPresent();
  return <m.div {...props} inert={!present} />;
}

/** 탭 강조처럼 짧게 옮겨 가는 움직임 */
export const SNAPPY: Transition = { type: 'spring', stiffness: 520, damping: 40, mass: 0.8 };
/** 카드와 답이 들어오는 움직임. 살짝 튕긴다 */
export const SOFT: Transition = { type: 'spring', stiffness: 380, damping: 30 };
/** 사라질 때는 짧게 */
export const LEAVE: Transition = { duration: 0.14, ease: [0.4, 0, 1, 1] };

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** 숫자를 이전 값(처음엔 0)에서 목표까지 세어 올린다. 동작 줄이기면 바로 목표를 보여 준다 */
export function useCountUp(target: number, duration = 700): number {
  const [value, setValue] = useState(0);
  const shown = useRef(0);
  useEffect(() => {
    if (reduced()) {
      shown.current = target;
      setValue(target);
      return;
    }
    const from = shown.current;
    const start = performance.now();
    let frame = requestAnimationFrame(function step(now) {
      const t = Math.min(1, (now - start) / duration);
      const next = Math.round(from + (target - from) * (1 - (1 - t) ** 3));
      shown.current = next;
      setValue(next);
      if (t < 1) frame = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(frame);
  }, [target, duration]);
  return value;
}
