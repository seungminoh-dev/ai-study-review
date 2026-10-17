import type { Me } from '@moai/shared';
import { useEffect, useState } from 'react';
import { OfflineError, RequestError, errorMessage, request } from './api';
import { Link, navigate, useLocation } from './router';
import { Review } from './screens/Review';
import { SessionDetail, Sessions } from './screens/Sessions';
import { Settings } from './screens/Settings';
import { Setup } from './screens/Setup';
import { Today } from './screens/Today';

type Auth = { state: 'loading' } | { state: 'in'; me: Me } | { state: 'setup' } | { state: 'closed' } | { state: 'error'; message: string };

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
  { href: '/sessions', label: '기록' },
  { href: '/settings', label: '설정' },
];

export function App() {
  const [auth, setAuth] = useState<Auth>({ state: 'loading' });
  const { path, query } = useLocation();

  useEffect(() => {
    (async () => {
      try {
        const me = await request<Me>('/me');
        rememberMe(me);
        setAuth({ state: 'in', me });
      } catch (error) {
        if (error instanceof RequestError && error.status === 401) {
          rememberMe(null);
          const { available } = await request<{ available: boolean }>('/setup').catch(() => ({ available: false }));
          setAuth({ state: available ? 'setup' : 'closed' });
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
  if (auth.state === 'error') return <div className="screen"><p className="notice bad">{auth.message}</p></div>;
  if (auth.state === 'setup') {
    return (
      <Setup
        onDone={(me) => {
          rememberMe(me);
          setAuth({ state: 'in', me });
          navigate('/settings', { replace: true });
        }}
      />
    );
  }
  if (auth.state === 'closed') {
    return (
      <div className="screen">
        <h1>모아이</h1>
        <p className="muted">초대받은 사람만 쓸 수 있어요. 이 기기는 아직 로그인되어 있지 않아요.</p>
      </div>
    );
  }

  const sessionMatch = /^\/sessions\/([\w-]+)$/.exec(path);
  let screen;
  if (path === '/review') screen = <Review key={location.search} size={query.get('size') === '5' ? 5 : 8} />;
  else if (path === '/sessions') screen = <Sessions />;
  else if (sessionMatch) screen = <SessionDetail id={sessionMatch[1]!} />;
  else if (path === '/settings') screen = <Settings />;
  else screen = <Today name={auth.me.display_name} />;

  return (
    <>
      <main className={path === '/review' ? 'app review-mode' : 'app'}>{screen}</main>
      {path === '/review' ? null : (
        <nav className="tabs" aria-label="화면">
          {TABS.map((tab) => {
            const current = tab.href === '/' ? path === '/' : path.startsWith(tab.href);
            return (
              <Link key={tab.href} href={tab.href} className={current ? 'tab current' : 'tab'} aria-current={current ? 'page' : undefined}>
                {tab.label}
              </Link>
            );
          })}
        </nav>
      )}
    </>
  );
}
