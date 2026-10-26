import { useEffect, useState, type AnchorHTMLAttributes, type MouseEvent } from 'react';
import { flushSync } from 'react-dom';

// 화면이 몇 개뿐이라 라이브러리 없이 History API로 옮겨 다닌다. 화면이 바뀔 때는 View Transitions로 밀어 넘긴다 (show).
// 뒤로가기 규칙 (Android 앱과 같게):
// - 오늘 탭이 맨 아래 한 칸(depth 0)이고, 다른 탭은 그 위 한 칸(depth 1)이다. 탭끼리는 기록을 쌓지 않는다.
// - 상세 화면(개념, 기록 상세, 자료, 복습)만 기록을 쌓는다.
// - "← 돌아가기"와 복습 끝내기는 새로 쌓지 않고 실제로 뒤로 간다.
// 그래서 어느 화면에서든 뒤로가기를 몇 번만 누르면 오늘 화면을 거쳐 앱이 닫힌다.

interface NavState {
  moai: 1;
  /** 이 앱에서 쌓은 기록 깊이. 처음 연 화면이 0이다 */
  depth: number;
  /** 바로 앞 화면의 주소 */
  from: string | null;
}

const listeners = new Set<() => void>();
/** 여러 칸을 한 번에 되돌리는 동안에는 중간 화면을 그리지 않는다 */
let rewinding = false;

function current(): NavState {
  const state = history.state as Partial<NavState> | null;
  return state?.moai === 1 && typeof state.depth === 'number' ? (state as NavState) : { moai: 1, depth: 0, from: null };
}

const here = () => location.pathname + location.search;

function notify(): void {
  for (const listener of listeners) listener();
}

/** 화면 전환 방향. styles.css의 ::view-transition 규칙이 html[data-nav]로 고른다 */
type Direction = 'forward' | 'back' | 'tab';

/**
 * 새 화면을 그린다. 브라우저가 View Transitions를 지원하면 이전 화면에서 새 화면으로 밀어 넘긴다
 * (동작 줄이기면 밀지 않고 겹쳐 바꾼다). 보이지 않는 탭과 지원하지 않는 브라우저에서는 바로 바꾼다.
 */
function show(direction: Direction, toTop: boolean): void {
  const update = () => {
    if (toTop) window.scrollTo(0, 0);
    notify();
  };
  const doc = document as Document & {
    startViewTransition?: (callback: () => void) => { skipTransition(): void; ready: Promise<void>; finished: Promise<void> };
  };
  if (!doc.startViewTransition || document.visibilityState !== 'visible') return update();
  document.documentElement.dataset.nav = direction;
  let shown = false;
  const once = () => {
    if (shown) return;
    shown = true;
    update();
  };
  // 새 화면을 찍기 전에 React가 다 그리도록 동기로 그린다
  const transition = doc.startViewTransition(() => flushSync(once));
  // 전환이 건너뛰어지거나 다음 전환에 밀리면 약속이 거부된다. 화면은 이미 바뀌었으니 무시한다
  transition.ready.catch(() => undefined);
  transition.finished.catch(() => undefined);
  // 브라우저가 화면을 그리지 않는 동안(가려진 창 등)에는 전환이 시작되지 않는다. 오래 걸리면 그냥 바꾼다
  setTimeout(() => {
    if (shown) return;
    transition.skipTransition();
    once();
  }, 400);
}

// 처음 연 화면을 맨 아래 칸으로 표시한다. 새로고침해도 브라우저가 이 값을 그대로 돌려준다
if ((history.state as Partial<NavState> | null)?.moai !== 1) history.replaceState({ moai: 1, depth: 0, from: null } satisfies NavState, '', here());
window.addEventListener('popstate', () => {
  if (!rewinding) show('back', false);
});

/** replace는 보통 돌아가기라 뒤로 가는 방향으로 넘긴다. 로그인 뒤처럼 다르면 direction을 준다 */
export function navigate(path: string, options: { replace?: boolean; direction?: Direction } = {}): void {
  const state = current();
  if (options.replace) history.replaceState(state, '', path);
  else history.pushState({ moai: 1, depth: state.depth + 1, from: here() } satisfies NavState, '', path);
  show(options.direction ?? (options.replace ? 'back' : 'forward'), true);
}

/** history.go(-steps)가 끝날 때까지 기다린다 */
function rewind(steps: number): Promise<void> {
  if (steps <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      window.removeEventListener('popstate', done);
      clearTimeout(timer);
      resolve();
    };
    // popstate가 오지 않는 브라우저가 있어도 멈추지 않게 한다
    const timer = setTimeout(done, 600);
    window.addEventListener('popstate', done);
    history.go(-steps);
  });
}

/** 아래 탭으로 옮긴다. 오늘은 맨 아래 칸으로 되돌아가고, 다른 탭은 그 위 한 칸을 바꿔 쓴다 */
export async function goTab(path: string): Promise<void> {
  const { depth } = current();
  rewinding = true;
  try {
    if (path === '/') {
      await rewind(depth);
      history.replaceState({ moai: 1, depth: 0, from: null } satisfies NavState, '', '/');
    } else if (depth === 0) {
      // 알림이나 주소로 다른 화면부터 열었어도 뒤로가기는 오늘 화면을 거치게 한다
      history.replaceState({ moai: 1, depth: 0, from: null } satisfies NavState, '', '/');
      history.pushState({ moai: 1, depth: 1, from: '/' } satisfies NavState, '', path);
    } else {
      await rewind(depth - 1);
      history.replaceState({ moai: 1, depth: 1, from: '/' } satisfies NavState, '', path);
    }
  } finally {
    rewinding = false;
  }
  show('tab', true);
}

const pathOf = (url: string) => url.split('?')[0];

/** "← 지식 지도" 같은 돌아가기. 바로 앞 화면이 그 화면이면 실제로 뒤로 가고, 아니면 그 화면으로 바꿔 쓴다 */
export function goBack(parent: string): void {
  const state = current();
  if (state.depth > 0 && state.from !== null && pathOf(state.from) === pathOf(parent)) history.back();
  else navigate(parent, { replace: true });
}

/** 복습처럼 들어갔다 나오는 화면을 닫는다. 들어오기 전 화면으로 돌아가고, 처음 연 화면이었으면 오늘로 간다 */
export function leave(): void {
  if (current().depth > 0) history.back();
  else void goTab('/');
}

export function useLocation(): { path: string; query: URLSearchParams } {
  const read = () => ({ path: location.pathname, query: new URLSearchParams(location.search) });
  const [value, setValue] = useState(read);
  useEffect(() => onNavigate(() => setValue(read())), []);
  return value;
}

/** 지금 화면이 바뀔 때마다 부른다. 해제 함수를 돌려준다 */
export function onNavigate(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

type LinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & { href: string };

function clickTo(go: () => void, onClick: LinkProps['onClick']) {
  return (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    go();
  };
}

/** 상세 화면으로 들어가는 링크. 기록을 한 칸 쌓는다 */
export function Link({ href, onClick, ...rest }: LinkProps) {
  return <a href={href} onClick={clickTo(() => navigate(href), onClick)} {...rest} />;
}

/** 아래 탭 링크. 기록을 쌓지 않는다 */
export function TabLink({ href, onClick, ...rest }: LinkProps) {
  return <a href={href} onClick={clickTo(() => void goTab(href), onClick)} {...rest} />;
}

/** "← 돌아가기" 링크 */
export function BackLink({ href, onClick, ...rest }: LinkProps) {
  return <a href={href} onClick={clickTo(() => goBack(href), onClick)} {...rest} />;
}
