// 모아이 서비스 워커. MVP 0은 푸시 표시와 도착 확인만 한다 (설계서 §10.3).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: '모아이', body: event.data ? event.data.text() : '' };
  }
  // iOS는 푸시마다 눈에 보이는 알림을 요구한다.
  const shown = self.registration.showNotification(data.title || '모아이', {
    body: data.body || '',
    tag: data.tag || 'moai',
    icon: '/icons/icon-192.png',
    data: { url: data.url || '/' },
  });
  const acked = data.job_id
    ? fetch(`/api/spike/pushes/${data.job_id}/ack`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ack: data.ack, device_received_at: Date.now() }),
      }).catch(() => undefined)
    : Promise.resolve();
  event.waitUntil(Promise.all([shown, acked]));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of windows) {
        if ('focus' in client) {
          if ('navigate' in client) await client.navigate(url).catch(() => undefined);
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    })(),
  );
});
