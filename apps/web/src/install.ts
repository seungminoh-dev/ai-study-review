import { useEffect, useState } from 'react';
import { isStandalone } from './push';

// 홈 화면에 추가 버튼. Chrome·Edge는 설치할 수 있을 때 beforeinstallprompt를 한 번 보낸다.
// 그 이벤트를 앱이 뜰 때부터 잡아 두었다가, 버튼을 누르면 설치 창을 띄운다. iPhone Safari는 이 이벤트가 없어서 그림으로 안내한다.

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((listener) => listener());

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    // 브라우저가 스스로 띄우는 작은 배너 대신 우리 버튼으로 설치한다
    event.preventDefault();
    deferred = event as InstallPromptEvent;
    changed();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    changed();
  });
}

/** 설치 창을 띄운다. 설치했으면 true */
export async function installApp(): Promise<boolean> {
  const event = deferred;
  if (!event) return false;
  deferred = null;
  await event.prompt();
  const { outcome } = await event.userChoice;
  changed();
  return outcome === 'accepted';
}

/** 지금 설치 버튼을 보여 줄 수 있는지, 이미 홈 화면 앱으로 열었는지 */
export function useInstall(): { canInstall: boolean; installed: boolean } {
  const read = () => ({ canInstall: deferred !== null, installed: isStandalone() });
  const [state, setState] = useState(read);
  useEffect(() => {
    const update = () => setState(read());
    listeners.add(update);
    return () => {
      listeners.delete(update);
    };
  }, []);
  return state;
}
