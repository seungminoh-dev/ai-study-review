import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { flushReviews } from './offline/store';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// 밀린 답안은 앱을 열 때, 다시 연결될 때, 앱으로 돌아올 때 보낸다 (설계서 §9.5)
void flushReviews();
window.addEventListener('online', () => void flushReviews());
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') void flushReviews();
});

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  void navigator.serviceWorker.register('/sw.js', { scope: '/' });
}
