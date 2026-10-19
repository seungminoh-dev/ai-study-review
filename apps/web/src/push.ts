import { request } from './api';

// 웹 푸시 구독 (설계서 §10.1). 알림 권한은 사용자가 버튼을 눌렀을 때만 묻는다.

export type PushState = 'unsupported' | 'in-app' | 'needs-install' | 'denied' | 'off' | 'on';

/** iPhone·iPad. iPadOS의 Safari는 Mac처럼 알려서 터치 지원으로 가려낸다 */
export const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/** 카톡·네이버·인스타그램 같은 앱 안의 브라우저. 초대가 카톡으로 가서 새 친구는 거의 여기로 들어온다. 홈 화면 설치와 웹 푸시가 안 된다 */
export function inAppBrowser(): 'kakao' | 'other' | null {
  const ua = navigator.userAgent;
  if (/KAKAOTALK/i.test(ua)) return 'kakao';
  if (/NAVER\(inapp|Instagram|FBAN|FBAV|FB_IAB|Line\/|DaumApps|everytimeApp|; wv\)/i.test(ua)) return 'other';
  return null;
}

/** 지금 주소를 기본 브라우저로 연다. 카톡은 자체 주소로, Android는 Chrome intent로 연다. 열 수 없으면(iPhone의 다른 앱) false */
export function openInBrowser(): boolean {
  const here = new URL(location.href);
  if (inAppBrowser() === 'kakao') {
    location.href = `kakaotalk://web/openExternal?url=${encodeURIComponent(here.href)}`;
    return true;
  }
  if (/Android/i.test(navigator.userAgent)) {
    location.href = `intent://${here.host}${here.pathname}${here.search}#Intent;scheme=https;package=com.android.chrome;end`;
    return true;
  }
  return false;
}
export const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

export async function pushState(): Promise<PushState> {
  if (inAppBrowser()) return 'in-app';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    // iOS는 홈 화면에 추가한 앱에서만 웹 푸시를 쓸 수 있다
    return isIos() && !isStandalone() ? 'needs-install' : 'unsupported';
  }
  if (Notification.permission === 'denied') return 'denied';
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  return subscription ? 'on' : 'off';
}

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const padded = base64url.replaceAll('-', '+').replaceAll('_', '/').padEnd(Math.ceil(base64url.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function enablePush(): Promise<PushState> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'off';
  const { vapid_public_key } = await request<{ vapid_public_key: string }>('/push/config');
  const registration = await navigator.serviceWorker.ready;
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(vapid_public_key) }));
  const json = subscription.toJSON();
  await request('/push/subscriptions', { method: 'POST', json: { endpoint: json.endpoint, keys: json.keys } });
  return 'on';
}

export async function disablePush(): Promise<PushState> {
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  if (subscription) {
    await request('/push/subscriptions', { method: 'DELETE', json: { endpoint: subscription.endpoint } });
    await subscription.unsubscribe();
  }
  return 'off';
}

/** 로그아웃용: 이 기기의 구독을 브라우저에서 끊고, 서버에서 지울 수 있게 endpoint를 돌려준다. 실패해도 로그아웃은 막지 않는다 */
export async function dropLocalPush(): Promise<string | null> {
  try {
    const registration = await navigator.serviceWorker?.getRegistration();
    const subscription = await registration?.pushManager.getSubscription();
    if (!subscription) return null;
    const endpoint = subscription.endpoint;
    await subscription.unsubscribe().catch(() => false);
    return endpoint;
  } catch {
    return null;
  }
}
