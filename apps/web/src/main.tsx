import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { MotionProvider } from './motion';
import { flushReviews } from './offline/store';
import { onNavigate } from './router';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MotionProvider>
      <App />
    </MotionProvider>
  </StrictMode>,
);

// 밀린 답안은 앱을 열 때, 다시 연결될 때, 앱으로 돌아올 때 보낸다 (설계서 §9.5)
void flushReviews();
window.addEventListener('online', () => void flushReviews());
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') void flushReviews();
});

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  // 배포하면 새 서비스 워커가 바로 자리를 잡지만, 열려 있던 화면은 예전 코드 그대로다.
  // 그래서 새 버전으로 바뀌면 다시 불러온다. 처음 설치될 때(전에 서비스 워커가 없을 때)는 다시 불러오지 않는다.
  const hadWorker = navigator.serviceWorker.controller !== null;
  let reloading = false;
  const reload = () => {
    if (reloading) return;
    reloading = true;
    location.reload();
  };
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadWorker) return;
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
