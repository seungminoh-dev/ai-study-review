import type { AuthOptions, Me } from '@moai/shared';
import { useEffect, useState, type ReactNode } from 'react';
import { OfflineError, RequestError, errorMessage, request } from './api';
import { TabLink, navigate, useLocation } from './router';
import { Concept } from './screens/Concept';
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

const TABS = [
  { href: '/', label: '오늘' },
  { href: '/map', label: '지도' },
  { href: '/sessions', label: '기록' },
  { href: '/settings', label: '설정' },
];

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
    navigate(to, { replace: true });
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

  if (auth.state === 'loading') return <div className="center muted">모아이</div>;
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
  else if (path === '/import') screen = <Import />;
  else if (path === '/materials') screen = <Materials />;
  else if (path === '/settings') {
    screen = (
      <Settings
        me={auth.me}
        onLogout={async () => {
          setAuth(await loggedOut());
          navigate('/', { replace: true });
        }}
      />
    );
  }
  else screen = <Today name={auth.me.display_name} />;

  return (
    <>
      <main className={path === '/review' ? 'app review-mode' : 'app'}>{screen}</main>
      {path === '/review' ? null : (
        <nav className="tabs" aria-label="화면">
          {TABS.map((tab) => {
            const current = tab.href === '/' ? path === '/' : tab.href === '/map' ? path === '/map' || path.startsWith('/concepts/') : path.startsWith(tab.href) || (tab.href === '/sessions' && (path === '/import' || path === '/materials'));
            return (
              <TabLink key={tab.href} href={tab.href} className={current ? 'tab current' : 'tab'} aria-current={current ? 'page' : undefined}>
                {tab.label}
              </TabLink>
            );
          })}
        </nav>
      )}
    </>
  );
}
