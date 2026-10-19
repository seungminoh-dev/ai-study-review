/// <reference lib="webworker" />
import { clientsClaim } from 'workbox-core';
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute, type PrecacheEntry } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';

// 서비스 워커 (설계서 §10.3, §12.3): 앱 셸 캐시, 푸시 알림. API 응답은 캐시하지 않는다.

declare let self: ServiceWorkerGlobalScope & { __WB_MANIFEST: (string | PrecacheEntry)[] };

void self.skipWaiting();
clientsClaim();
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);
// 오프라인에서도 어느 주소로 열든 앱 셸을 준다. API, MCP, 커넥터 허용 화면(OAuth)은 서버가 직접 준다
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html'), { denylist: [/^\/api\//, /^\/mcp(\/|$)/, /^\/authorize/, /^\/oauth\//, /^\/\.well-known\//] }));

interface PushData {
  title?: string;
  body?: string;
  url?: string;
  tag?: string;
}

self.addEventListener('push', (event) => {
  let data: PushData = {};
  try {
    data = (event.data?.json() ?? {}) as PushData;
  } catch {
    data = { body: event.data?.text() ?? '' };
  }
  // iOS는 푸시마다 눈에 보이는 알림을 요구한다. 그래서 항상 알림을 띄운다
  event.waitUntil(
    self.registration.showNotification(data.title ?? '모아이', {
      body: data.body ?? '',
      tag: data.tag ?? 'daily',
      icon: '/icons/icon-192.png',
      // Android 상태 표시줄은 배지의 알파만 쓴다. 색 있는 사각형을 주면 흰 네모가 된다
      badge: '/icons/badge.png',
      data: { url: data.url ?? '/' },
    }),
  );
});

/** 브라우저가 구독을 바꾸면 새 구독을 서버에 알린다. 그러지 않으면 알림이 조용히 끊긴다 (로그인 쿠키가 같이 간다) */
const keyBytes = (base64url: string) => Uint8Array.from(atob(base64url.replaceAll('-', '+').replaceAll('_', '/').padEnd(Math.ceil(base64url.length / 4) * 4, '=')), (char) => char.charCodeAt(0));

self.addEventListener('pushsubscriptionchange', (event) => {
  const change = event as ExtendableEvent & { oldSubscription?: PushSubscription | null; newSubscription?: PushSubscription | null };
  change.waitUntil(
    (async () => {
      let subscription = change.newSubscription ?? null;
      if (!subscription) {
        const key = change.oldSubscription?.options.applicationServerKey ?? keyBytes(((await (await fetch('/api/push/config')).json()) as { vapid_public_key: string }).vapid_public_key);
        subscription = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      }
      const json = subscription.toJSON();
      await fetch('/api/push/subscriptions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }) });
    })().catch(() => undefined),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL((event.notification.data as { url?: string } | null)?.url ?? '/', self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const open = windows[0];
      if (open) {
        await open.focus();
        await open.navigate(target).catch(() => undefined);
        return;
      }
      await self.clients.openWindow(target);
    })(),
  );
});
