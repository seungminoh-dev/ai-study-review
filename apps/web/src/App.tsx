import type { AuthOptions, Me } from '@moai/shared';
import * as m from 'motion/react-m';
import { useEffect, useState, type ReactNode } from 'react';
import { OfflineError, RequestError, errorMessage, request } from './api';
import { IconBook, IconGrowth, IconHome, IconMap, IconRecords, IconSettings } from './icons';
import { Splash } from './Loading';
import { Mascot } from './Mascot';
import { SNAPPY } from './motion';
import { TabLink, navigate, useLocation } from './router';
import { Concept } from './screens/Concept';
import { Growth } from './screens/Growth';
import { Import } from './screens/Import';
import { Join } from './screens/Join';
import { Login } from './screens/Login';
import { Materials } from './screens/Materials';
import { MapScreen } from './screens/MapScreen';
import { Review } from './screens/Review';
import { SessionDetail, Sessions } from './screens/Sessions';
import { Settings } from './screens/Settings';
import { Setup } from './screens/Setup';
import { Today } from './screens/Today';

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

type Section = 'today' | 'map' | 'growth' | 'records' | 'materials' | 'settings';

/** 지금 화면이 어느 메뉴에 속하는지. 상세 화면은 부모 메뉴를 밝힌다 */
function sectionOf(path: string): Section | null {
  if (path === '/') return 'today';
  if (path === '/map' || path.startsWith('/concepts/')) return 'map';
  if (path === '/growth') return 'growth';
  if (path === '/materials') return 'materials';
  if (path.startsWith('/sessions') || path === '/import') return 'records';
  if (path === '/settings') return 'settings';
  return null;
}

const ICONS: Record<Section, () => ReactNode> = {
  today: () => <IconHome />,
  map: () => <IconMap />,
  growth: () => <IconGrowth />,
  records: () => <IconRecords />,
  materials: () => <IconBook />,
  settings: () => <IconSettings />,
};

/** 휴대폰 아래 탭. 설정은 오늘 화면 오른쪽 위에 있다 */
const TABS: { href: string; label: string; section: Section }[] = [
  { href: '/', label: '오늘', section: 'today' },
  { href: '/map', label: '지도', section: 'map' },
  { href: '/growth', label: '성장', section: 'growth' },
  { href: '/sessions', label: '기록', section: 'records' },
];

/** 컴퓨터 왼쪽 메뉴. 자료는 휴대폰에서는 기록 탭 안에 있다 */
const SIDE: { href: string; label: string; section: Section }[] = [
  { href: '/', label: '오늘', section: 'today' },
  { href: '/map', label: '지식 지도', section: 'map' },
  { href: '/growth', label: '내 성장', section: 'growth' },
  { href: '/sessions', label: '저장 기록', section: 'records' },
  { href: '/materials', label: '자료', section: 'materials' },
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
        {link({ href: '/settings', label: '설정', section: 'settings' })}
      </nav>
    </aside>
  );
}

/** 로그인 전 화면. 아래 탭이 없다 */
const Bare = ({ children }: { children: ReactNode }) => <main className="app no-tabs">{children}</main>;

async function loggedOut(): Promise<Auth> {
  rememberMe(null);
  const options = await request<AuthOptions>('/auth/options').catch((): AuthOptions => ({ setup_available: false, github: false }));
  return options.setup_available ? { state: 'setup' } : { state: 'out', github: options.github };
}

export function App() {
  const [auth, setAuth] = useState<Auth>({ state: 'loading' });
  const { path, query } = useLocation();

  const signedIn = (me: Me, to = '/') => {
    rememberMe(me);
    setAuth({ state: 'in', me });
    navigate(to, { replace: true, direction: 'tab' });
  };

  useEffect(() => {
    (async () => {
      try {
        const me = await request<Me>('/me');
        rememberMe(me);
        setAuth({ state: 'in', me });
      } catch (error) {
        if (error instanceof RequestError && error.status === 401) {
          setAuth(await loggedOut());
        } else if (error instanceof OfflineError && rememberedMe()) {
          // 오프라인이어도 저장해 둔 큐로 복습할 수 있다
          setAuth({ state: 'in', me: rememberedMe()! });
        } else {
          setAuth({ state: 'error', message: errorMessage(error) });
        }
      }
    })();
  }, []);

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
    return <Bare>{path === '/join' ? <Join onDone={(me) => signedIn(me, '/')} /> : <Login github={auth.github} onDone={(me) => signedIn(me)} />}</Bare>;
  }

  const sessionMatch = /^\/sessions\/([\w-]+)$/.exec(path);
  const conceptMatch = /^\/concepts\/([a-z0-9-]+)$/.exec(path);
  let screen;
  if (path === '/review') {
    const size = Math.min(Math.max(Number(query.get('size')) || 8, 1), 20);
    screen = <Review key={location.search} size={size} category={query.get('category')} material={query.get('material')} />;
  }
  else if (path === '/sessions') screen = <Sessions />;
  else if (sessionMatch) screen = <SessionDetail id={sessionMatch[1]!} />;
  else if (path === '/map') screen = <MapScreen />;
  else if (conceptMatch) screen = <Concept key={conceptMatch[1]} conceptKey={conceptMatch[1]!} />;
  else if (path === '/growth') screen = <Growth />;
  else if (path === '/import') screen = <Import />;
  else if (path === '/materials') screen = <Materials />;
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

  // 복습은 메뉴 없이 집중한다. 오늘·성장·지도는 컴퓨터에서 넓게 쓴다
  const focus = path === '/review';
  const wide = path === '/' || path === '/growth' || path === '/map';
  const section = sectionOf(path);
  // 휴대폰 탭에는 자료가 없어서 자료 화면에서는 기록 탭을 밝힌다
  const tabSection = section === 'materials' ? 'records' : section;
  return (
    <div className={focus ? 'shell focus' : 'shell'}>
      {focus ? null : <Sidebar current={section} />}
      <main className={focus ? 'app review-mode' : wide ? 'app wide' : 'app'}>{screen}</main>
      {focus ? null : (
        <nav className="tabs" aria-label="화면">
          {TABS.map((tab) => {
            const current = tabSection === tab.section;
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
