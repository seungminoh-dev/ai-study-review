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

const SYNCED = 'moai:push-synced';
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 하루 한 번, 이 기기에 남은 구독을 서버에 다시 보낸다 (서버는 같은 주소면 덮어쓴다).
 * 서버가 실패한 구독을 지웠거나 기기를 바꿨어도 알림이 다시 이어진다. 화면은 '알림 받음'인데 실제로는 끊긴 상태를 막는다
 */
export async function resyncPush(now = Date.now()): Promise<void> {
  if (inAppBrowser() || !('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;
  try {
    if (now - Number(localStorage.getItem(SYNCED) ?? 0) < DAY_MS) return;
  } catch {
    // 저장소를 못 쓰면 매번 보낸다 (덮어쓰기라 괜찮다)
  }
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return;
  const json = subscription.toJSON();
  await request('/push/subscriptions', { method: 'POST', json: { endpoint: json.endpoint, keys: json.keys } });
  try {
    localStorage.setItem(SYNCED, String(now));
  } catch {
    // 다음에 다시 보낸다
  }
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

/** 이 기기의 푸시 주소. 다른 기기에서 모두 로그아웃할 때 이 기기의 구독은 남긴다 */
export async function currentEndpoint(): Promise<string | null> {
  try {
    const registration = await navigator.serviceWorker?.getRegistration();
    return (await registration?.pushManager.getSubscription())?.endpoint ?? null;
  } catch {
    return null;
  }
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
