import type { AuthOptions, Me } from '@moai/shared';
import * as m from 'motion/react-m';
import { Suspense, lazy, useEffect, useState, type ComponentType, type ReactNode } from 'react';
import { OfflineError, RequestError, errorMessage, onUnauthorized, request } from './api';
import { forgetSeenBadges } from './badges';
import { CreditChip } from './credits';
import { forgetMaterial } from './materials';
import { IconBook, IconGrowth, IconHistory, IconHome, IconMap, IconOffline, IconSettings } from './icons';
import { Loading, Splash } from './Loading';
import { Mascot } from './Mascot';
import { SNAPPY } from './motion';
import { ErrorBoundary } from './ErrorBoundary';
import { claimDevice, releaseDevice } from './offline/store';
import { dropLocalPush, resyncPush } from './push';
import { TabLink, navigate, useLocation } from './router';
import { Join } from './screens/Join';
import { Landing } from './screens/Landing';
import { Login } from './screens/Login';
import { Setup } from './screens/Setup';
import { Today } from './screens/Today';

/**
 * 로그인한 뒤에만 쓰는 큰 화면은 따로 받는다. 처음 오는 사람의 랜딩과 매일 여는 오늘 화면을 가볍게 하려고.
 * 로그인하면 쉬는 틈에 미리 받아 두어 화면을 옮길 때 기다리지 않게 한다.
 */
function lazyScreen<P extends object>(load: () => Promise<ComponentType<P>>) {
  let loaded: ComponentType<P> | null = null;
  const preload = () =>
    load().then((component) => {
      loaded = component;
      return component;
    });
  const Lazy = lazy(() => preload().then((component) => ({ default: component })));
  function Screen(props: P) {
    // 처음 그릴 때 정한 것을 끝까지 쓴다. 도중에 바꾸면 화면을 새로 그려 복습하던 상태를 잃는다
    const [Component] = useState<ComponentType<P>>(() => loaded ?? (Lazy as unknown as ComponentType<P>));
    return <Component {...props} />;
  }
  return Object.assign(Screen, { preload });
}

const Review = lazyScreen(() => import('./screens/Review').then((module) => module.Review));
const Sessions = lazyScreen(() => import('./screens/Sessions').then((module) => module.Sessions));
const SessionDetail = lazyScreen(() => import('./screens/Sessions').then((module) => module.SessionDetail));
const MapScreen = lazyScreen(() => import('./screens/MapScreen').then((module) => module.MapScreen));
const Concept = lazyScreen(() => import('./screens/Concept').then((module) => module.Concept));
const Growth = lazyScreen(() => import('./screens/Growth').then((module) => module.Growth));
const Import = lazyScreen(() => import('./screens/Import').then((module) => module.Import));
const Materials = lazyScreen(() => import('./screens/Materials').then((module) => module.Materials));
const MaterialDetail = lazyScreen(() => import('./screens/MaterialDetail').then((module) => module.MaterialDetail));
const Settings = lazyScreen(() => import('./screens/Settings').then((module) => module.Settings));
const Welcome = lazyScreen(() => import('./screens/Welcome').then((module) => module.Welcome));
const Interview = lazyScreen(() => import('./screens/Interview').then((module) => module.Interview));
const Learn = lazyScreen(() => import('./screens/Learn').then((module) => module.Learn));
const Reviews = lazyScreen(() => import('./screens/Reviews').then((module) => module.Reviews));
const Categories = lazyScreen(() => import('./screens/Categories').then((module) => module.Categories));
const Credits = lazyScreen(() => import('./screens/Credits').then((module) => module.Credits));
const LATER = [Review, Sessions, SessionDetail, MapScreen, Concept, Growth, Import, Materials, MaterialDetail, Settings, Welcome, Interview, Learn, Reviews, Categories, Credits];
// 개인정보 처리방침·약관은 로그인 전에도 열고, 가끔만 보니 미리 받지 않는다
const Legal = lazyScreen(() => import('./screens/Legal').then((module) => module.Legal));
const legalDoc = (path: string) => (path === '/privacy' ? 'privacy' : path === '/terms' ? 'terms' : null);

type Auth = { state: 'loading' } | { state: 'in'; me: Me } | { state: 'setup' } | { state: 'out'; github: boolean } | { state: 'error'; message: string };

const ME_KEY = 'moai:me';

function rememberMe(me: Me | null): void {
  try {
    if (me) localStorage.setItem(ME_KEY, JSON.stringify(me));
    else localStorage.removeItem(ME_KEY);
  } catch {
    // 저장소를 못 쓰면 오프라인 시작만 안 된다
  }
}

function rememberedMe(): Me | null {
  try {
    const raw = localStorage.getItem(ME_KEY);
    return raw ? (JSON.parse(raw) as Me) : null;
  } catch {
    return null;
  }
}

type Section = 'today' | 'learn' | 'reviews' | 'map' | 'growth' | 'settings';

/** 지금 화면이 어느 메뉴에 속하는지. 상세 화면은 부모 메뉴를 밝힌다. 자료는 학습, 공부한 대화는 복습에 속한다 */
function sectionOf(path: string): Section | null {
  if (path === '/' || path === '/credits') return 'today';
  if (path === '/learn' || path === '/materials' || path.startsWith('/materials/')) return 'learn';
  if (path === '/reviews' || path.startsWith('/sessions') || path === '/import') return 'reviews';
  if (path === '/map' || path.startsWith('/concepts/') || path === '/categories') return 'map';
  if (path === '/growth') return 'growth';
  if (path === '/settings') return 'settings';
  return null;
}

const ICONS: Record<Section, () => ReactNode> = {
  today: () => <IconHome />,
  learn: () => <IconBook />,
  reviews: () => <IconHistory />,
  map: () => <IconMap />,
  growth: () => <IconGrowth />,
  settings: () => <IconSettings />,
};

/** 휴대폰 아래 탭. 설정은 오늘 화면 오른쪽 위에 있다 */
const TABS: { href: string; label: string; section: Section }[] = [
  { href: '/', label: '오늘', section: 'today' },
  { href: '/learn', label: '학습', section: 'learn' },
  { href: '/reviews', label: '복습', section: 'reviews' },
  { href: '/map', label: '지도', section: 'map' },
  { href: '/growth', label: '성장', section: 'growth' },
];

/** 컴퓨터 왼쪽 메뉴 */
const SIDE: { href: string; label: string; section: Section }[] = [
  { href: '/', label: '오늘', section: 'today' },
  { href: '/learn', label: '학습', section: 'learn' },
  { href: '/reviews', label: '복습', section: 'reviews' },
  { href: '/map', label: '지식 지도', section: 'map' },
  { href: '/growth', label: '내 성장', section: 'growth' },
];

function Sidebar({ current }: { current: Section | null }) {
  const link = (item: { href: string; label: string; section: Section }) => (
    <TabLink key={item.href} href={item.href} className={current === item.section ? 'side-link current' : 'side-link'} aria-current={current === item.section ? 'page' : undefined}>
      {current === item.section ? <m.span layoutId="side-pill" className="side-pill" transition={SNAPPY} /> : null}
      {ICONS[item.section]()}
      {item.label}
    </TabLink>
  );
  return (
    <aside className="sidebar">
      <TabLink href="/" className="brand" aria-label="모아이 오늘 화면">
        <Mascot size={36} />
        <strong>모아이</strong>
      </TabLink>
      <nav className="side-nav" aria-label="메뉴">
        {SIDE.map(link)}
      </nav>
      <nav className="side-nav side-bottom" aria-label="설정">
        <CreditChip className="side-credit" unit />
        {link({ href: '/settings', label: '설정', section: 'settings' })}
      </nav>
    </aside>
  );
}

/** 로그인 전 화면. 아래 탭이 없다 */
const Bare = ({ children }: { children: ReactNode }) => <main className="app no-tabs">{children}</main>;

/** 이 기기를 로그인한 사람의 것으로 정한다. 앞사람이 남긴 것이면 답·큐를 지우고, 앞사람 알림이 오던 구독도 끊는다 */
async function claim(me: Me): Promise<void> {
  try {
    if (await claimDevice(me.id)) await dropLocalPush();
  } catch {
    // 기기 저장소를 못 쓰면 남은 데이터도 없다
  }
}

/** 세션이 끝나도(401) 기기의 답·큐는 남긴다. 같은 사람이 다시 로그인하면 이어서 보내고, 다른 사람이면 claim이 지운다 */
async function loggedOut(): Promise<Auth> {
  rememberMe(null);
  forgetSeenBadges();
  forgetMaterial();
  const options = await request<AuthOptions>('/auth/options').catch((): AuthOptions => ({ setup_available: false, github: false }));
  return options.setup_available ? { state: 'setup' } : { state: 'out', github: options.github };
}

/** 인터넷에 연결되어 있는지. 기기가 알려 주는 값이라 연결은 됐는데 서버가 안 되는 경우는 모른다 */
function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  return online;
}

export function App() {
  const [auth, setAuth] = useState<Auth>({ state: 'loading' });
  const online = useOnline();
  const { path, query } = useLocation();

  const signedIn = async (me: Me, to = '/') => {
    await claim(me);
    rememberMe(me);
    setAuth({ state: 'in', me });
    navigate(to, { replace: true, direction: 'tab' });
  };

  useEffect(() => {
    (async () => {
      try {
        const me = await request<Me>('/me');
        await claim(me);
        rememberMe(me);
        setAuth({ state: 'in', me });
        // 이 기기의 푸시 구독을 하루 한 번 서버와 다시 맞춘다 (끊긴 알림 되살리기)
        void resyncPush().catch(() => undefined);
      } catch (error) {
        if (error instanceof RequestError && error.status === 401) {
          setAuth(await loggedOut());
        } else if (error instanceof OfflineError && rememberedMe()) {
          // 오프라인이어도 저장해 둔 큐로 복습할 수 있다
          const me = rememberedMe()!;
          await claim(me);
          setAuth({ state: 'in', me });
        } else {
          setAuth({ state: 'error', message: errorMessage(error) });
        }
      }
    })();
  }, []);

  // 쓰는 도중 세션이 끝나면(401) 로그인 화면으로 보낸다. 못 보낸 답은 기기에 남아 있다가 같은 사람이 다시 로그인하면 간다
  useEffect(() => {
    if (auth.state !== 'in') return;
    let ended = false;
    onUnauthorized(() => {
      if (ended) return;
      ended = true;
      releaseDevice();
      void loggedOut().then(setAuth);
      navigate('/login?auth=session', { replace: true, direction: 'tab' });
    });
    return () => onUnauthorized(null);
  }, [auth.state]);

  useEffect(() => {
    if (auth.state !== 'in') return;
    // 로그인하면 쉬는 틈에 나머지 화면을 받아 둔다 (오프라인이면 다음 기회에)
    const run = () => LATER.forEach((screen) => void screen.preload().catch(() => undefined));
    if ('requestIdleCallback' in window) {
      const id = requestIdleCallback(run, { timeout: 3000 });
      return () => cancelIdleCallback(id);
    }
    const timer = setTimeout(run, 1200);
    return () => clearTimeout(timer);
  }, [auth.state]);

  if (auth.state === 'loading') return <Splash />;
  if (auth.state === 'error') {
    return (
      <Bare>
        <p className="notice bad">{auth.message}</p>
      </Bare>
    );
  }
  if (auth.state === 'setup') {
    return (
      <Bare>
        <Setup onDone={(me) => signedIn(me, '/settings')} />
      </Bare>
    );
  }
  if (auth.state === 'out') {
    const doc = legalDoc(path);
    if (doc) {
      return (
        <Bare>
          <Suspense fallback={<Loading />}>
            <Legal doc={doc} />
          </Suspense>
        </Bare>
      );
    }
    // 가입하면 시작 가이드로 간다
    if (path === '/join') {
      return (
        <Bare>
          <Join onDone={(me) => signedIn(me, '/welcome')} />
        </Bare>
      );
    }
    // 서버는 GitHub 로그인이 실패하면 첫 화면(?auth=)으로 돌려보낸다. 그때는 이유와 함께 로그인 화면을 보여 준다
    if (path === '/' && !query.has('auth')) {
      return (
        <main className="app landing-main">
          <Landing github={auth.github} />
        </main>
      );
    }
    return (
      <Bare>
        <Login github={auth.github} onDone={(me) => signedIn(me)} />
      </Bare>
    );
  }

  const sessionMatch = /^\/sessions\/([\w-]+)$/.exec(path);
  const conceptMatch = /^\/concepts\/([a-z0-9-]+)$/.exec(path);
  let screen;
  if (path === '/review') {
    const size = Math.min(Math.max(Number(query.get('size')) || 8, 1), 20);
    screen = <Review key={location.search} size={size} category={query.get('category')} material={query.get('material')} part={query.get('part')} mistakes={query.get('mode') === 'mistakes'} exam={query.get('mode') === 'random'} />;
  }
  else if (path === '/learn') screen = <Learn key={query.get('title') ?? ''} title={query.get('title')} />;
  else if (path === '/reviews') screen = <Reviews />;
  else if (path === '/categories') screen = <Categories />;
  else if (path === '/credits') screen = <Credits />;
  else if (path === '/sessions') screen = <Sessions />;
  else if (sessionMatch) screen = <SessionDetail id={sessionMatch[1]!} />;
  else if (path === '/map') screen = <MapScreen />;
  else if (conceptMatch) screen = <Concept key={conceptMatch[1]} conceptKey={conceptMatch[1]!} />;
  else if (path === '/growth') screen = <Growth />;
  else if (path === '/import') screen = <Import />;
  else if (path === '/materials') screen = <Materials />;
  else if (path === '/materials/detail') screen = <MaterialDetail key={query.get('title') ?? ''} title={query.get('title') ?? ''} />;
  else if (path === '/welcome') screen = <Welcome name={auth.me.display_name} />;
  else if (path === '/interview') screen = <Interview key={location.search} concept={query.get('concept')} category={query.get('category')} />;
  else if (legalDoc(path)) screen = <Legal doc={legalDoc(path)!} />;
  else if (path === '/settings') {
    screen = (
      <Settings
        me={auth.me}
        onLogout={async () => {
          setAuth(await loggedOut());
          navigate('/', { replace: true, direction: 'tab' });
        }}
      />
    );
  }
  else screen = <Today name={auth.me.display_name} />;

  // 복습, 모의면접, 시작 가이드는 메뉴 없이 집중한다. 오늘·성장·지도는 컴퓨터에서 넓게 쓴다
  const focus = path === '/review' || path === '/interview' || path === '/welcome';
  const wide = path === '/' || path === '/learn' || path === '/credits' || path === '/growth' || path === '/map' || path === '/materials/detail';
  const section = sectionOf(path);
  return (
    <div className={focus ? 'shell focus' : 'shell'}>
      {focus ? null : <Sidebar current={section} />}
      <main className={focus ? 'app review-mode' : wide ? 'app wide' : 'app'}>
        {/* 복습 화면은 따로 알린다 */}
        {!online && !focus ? (
          <p className="offline-bar" role="status">
            <IconOffline size={18} />
            오프라인이에요. 저장해 둔 카드로 복습할 수 있고, 답은 연결되면 보내요.
          </p>
        ) : null}
        {/* 화면마다 따로 잡는다. 한 화면이 깨져도 메뉴는 남고, 다른 화면으로 가면 풀린다 */}
        <ErrorBoundary key={path}>
          <Suspense fallback={<Loading />}>{screen}</Suspense>
        </ErrorBoundary>
      </main>
      {focus ? null : (
        <nav className="tabs" aria-label="화면">
          {TABS.map((tab) => {
            const current = section === tab.section;
            return (
              <TabLink key={tab.href} href={tab.href} className={current ? 'tab current' : 'tab'} aria-current={current ? 'page' : undefined}>
                {current ? <m.span layoutId="tab-pill" className="tab-pill" transition={SNAPPY} /> : null}
                {ICONS[tab.section]()}
                {tab.label}
              </TabLink>
            );
          })}
        </nav>
      )}
    </div>
  );
}
