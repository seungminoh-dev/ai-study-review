import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { InAppNotice } from './InAppNotice';
// 설치 이벤트는 앱이 뜰 때 한 번만 와서 가장 먼저 잡아 둔다
import './install';
import { MotionProvider } from './motion';
import { flushReviews } from './offline/store';
import { applyTheme } from './prefs';
import { onNavigate } from './router';
// 윈도우에서도 맑은 고딕 대신 같은 글꼴로 보이게 Pretendard를 직접 올린다
import './fonts/pretendard/pretendard.css';
import './styles.css';

// 설정에서 고른 밝게·어둡게를 첫 화면을 그리기 전에 맞춘다
applyTheme();

// 커넥터 허용 화면은 서버가 그린다. 예전 서비스 워커가 앱 셸을 줬으면 그 워커를 내리고 서버에서 다시 받는다
const staleShell = location.pathname === '/authorize';
if (staleShell) void navigator.serviceWorker?.getRegistration().then((registration) => registration?.unregister()).finally(() => location.reload());

if (!staleShell) createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MotionProvider>
      <InAppNotice />
      <App />
    </MotionProvider>
  </StrictMode>,
);

// 밀린 답안은 앱을 열어 로그인을 확인했을 때(App의 claim), 다시 연결될 때, 앱으로 돌아올 때 보낸다 (설계서 §9.5)
window.addEventListener('online', () => void flushReviews());
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') void flushReviews();
});

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  // 배포하면 새 서비스 워커가 바로 자리를 잡지만, 열려 있던 화면은 예전 코드 그대로다.
  // 그래서 새 버전으로 바뀌면 다시 불러온다. 처음 설치될 때(전에 서비스 워커가 없을 때)는 다시 불러오지 않고,
  // 그 뒤에 오는 업데이트부터 다시 불러온다. 처음 설치되는 동안 연 화면도 다음 배포를 놓치지 않게 한다.
  let hadWorker = navigator.serviceWorker.controller !== null;
  let reloading = false;
  const reload = () => {
    if (reloading) return;
    reloading = true;
    location.reload();
  };
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadWorker) {
      hadWorker = true;
      return;
    }
    // 복습 중이면 답을 잃지 않게 복습 화면을 나갈 때까지 기다린다
    if (location.pathname !== '/review') return reload();
    const stop = onNavigate(() => {
      if (location.pathname === '/review') return;
      stop();
      reload();
    });
  });
  void navigator.serviceWorker.register('/sw.js', { scope: '/' }).then((registration) => {
    // 앱으로 돌아올 때마다 새 버전이 있는지 본다. 홈 화면 앱은 며칠씩 다시 열리지 않을 수 있다
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void registration.update().catch(() => undefined);
    });
  });
}
