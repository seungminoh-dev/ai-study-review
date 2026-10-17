// 모아이 MVP 0 점검 페이지 (설계서 §2.1). MVP 1에서 지운다.
const TOKEN_KEY = 'moai-spike-token';
const SUB_KEY = 'moai-spike-subscription';
const $ = (id) => document.getElementById(id);

const store = {
  get(key) {
    try { return localStorage.getItem(key) ?? ''; } catch { return ''; }
  },
  set(key, value) {
    try { localStorage.setItem(key, value); } catch { /* 저장소를 못 쓰는 브라우저 */ }
  },
};

const kst = (ms) => (ms ? new Date(ms + 9 * 3600 * 1000).toISOString().slice(11, 19) : '—');
const seconds = (from, to) => (from && to ? `${((to - from) / 1000).toFixed(1)}초` : '—');

async function api(path, init = {}) {
  const response = await fetch(`/api/spike${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', 'x-spike-token': store.get(TOKEN_KEY), ...(init.headers || {}) },
  });
  if (response.status === 204) return null;
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error?.message || `요청 실패 (${response.status})`);
  return body;
}

function show(id, message, tone = '') {
  const el = $(id);
  el.textContent = message;
  el.className = tone;
}

function row(cells) {
  const tr = document.createElement('tr');
  for (const cell of cells) {
    const td = document.createElement('td');
    td.textContent = cell ?? '—';
    tr.append(td);
  }
  return tr;
}

function fill(tbodyId, rows, columns) {
  const tbody = $(tbodyId);
  tbody.replaceChildren(...(rows.length ? rows.map(row) : [row(['아직 없어요.', ...Array(columns - 1).fill('')])]));
}

async function renderStatus() {
  const standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const registration = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : undefined;
  const subscription = registration && 'pushManager' in registration ? await registration.pushManager.getSubscription() : null;
  const items = [
    ['실행 방식', standalone ? '홈 화면 앱' : '브라우저 탭', standalone ? 'good' : 'warn'],
    ['알림 권한', 'Notification' in window ? Notification.permission : '지원 안 함', 'Notification' in window && Notification.permission === 'granted' ? 'good' : 'warn'],
    ['서비스 워커', registration ? '등록됨' : '없음', registration ? 'good' : 'bad'],
    ['푸시 구독', subscription ? '있음' : '없음', subscription ? 'good' : 'warn'],
    ['토큰', store.get(TOKEN_KEY) ? '저장됨' : '없음', store.get(TOKEN_KEY) ? 'good' : 'bad'],
    ['브라우저', navigator.userAgent, ''],
  ];
  $('status').replaceChildren(
    ...items.flatMap(([label, value, tone]) => {
      const dt = document.createElement('dt');
      dt.textContent = label;
      const dd = document.createElement('dd');
      dd.textContent = value;
      dd.className = tone;
      return [dt, dd];
    }),
  );
}

function decodeKey(base64url) {
  const padded = base64url.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - (base64url.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

async function enablePush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    show('push-result', '이 브라우저는 웹 푸시를 지원하지 않아요. iPhone은 iOS 16.4 이상에서 홈 화면 앱으로 열어야 해요.', 'bad');
    return;
  }
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    show('push-result', `알림 권한이 "${permission}"이에요. 설정에서 알림을 허용해 주세요.`, 'bad');
    return;
  }
  const registration = await navigator.serviceWorker.ready;
  const { vapidPublicKey } = await (await fetch('/api/spike/config')).json();
  if (!vapidPublicKey) {
    show('push-result', '서버에 VAPID_PUBLIC_KEY가 없어요. wrangler.jsonc를 확인해 주세요.', 'bad');
    return;
  }
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: decodeKey(vapidPublicKey) }));
  const { id } = await api('/subscriptions', { method: 'POST', body: JSON.stringify(subscription.toJSON()) });
  store.set(SUB_KEY, id);
  show('push-result', '알림을 켰어요. 이제 예약 버튼을 눌러 보세요.', 'good');
  await renderStatus();
}

async function schedule(body) {
  const subscriptionId = store.get(SUB_KEY);
  if (!subscriptionId) {
    show('push-result', '먼저 "알림 켜기"를 눌러 주세요.', 'bad');
    return;
  }
  const { fire_at } = await api('/pushes', { method: 'POST', body: JSON.stringify({ subscription_id: subscriptionId, ...body }) });
  show('push-result', `${kst(fire_at)} KST에 보낼게요. 앱을 닫고 기다려 보세요.`, 'good');
  await refreshJobs();
}

async function refreshJobs() {
  const { jobs } = await api('/pushes');
  fill(
    'jobs',
    jobs.map((job) => [
      kst(job.fire_at),
      job.error === 'stale' ? '늦어서 건너뜀' : kst(job.sent_at),
      kst(job.received_at),
      seconds(job.fire_at, job.received_at),
      job.error && job.error !== 'stale' ? job.error : job.status_code,
    ]),
    5,
  );
}

async function refreshMcp() {
  const [{ requests }, { saves }] = await Promise.all([api('/requests'), api('/saves')]);
  fill(
    'requests',
    requests.map((r) => [kst(r.at), `${r.http_method} ${r.rpc_method ?? ''}`.trim(), r.tool_name, r.protocol_header ?? r.protocol_body, r.colo, r.status]),
    6,
  );
  fill(
    'saves',
    saves.map((s) => {
      const counts = JSON.parse(s.counts);
      return [kst(s.received_at), s.topic, counts.concepts, counts.cards];
    }),
    4,
  );
}

function guard(id, task) {
  return async () => {
    try {
      await task();
    } catch (error) {
      show(id, error instanceof Error ? error.message : String(error), 'bad');
    }
  };
}

$('token').value = store.get(TOKEN_KEY);
$('save-token').addEventListener('click', guard('token-result', async () => {
  store.set(TOKEN_KEY, $('token').value.trim());
  await api('/pushes');
  show('token-result', '토큰이 맞아요.', 'good');
  await renderStatus();
}));
$('enable-push').addEventListener('click', guard('push-result', enablePush));
for (const button of document.querySelectorAll('[data-delay]')) {
  button.addEventListener('click', guard('push-result', () => schedule({ delay_minutes: Number(button.dataset.delay) })));
}
$('schedule-at').addEventListener('click', guard('push-result', () => {
  if (!$('at').value) throw new Error('시각을 먼저 골라 주세요.');
  return schedule({ at_kst: $('at').value });
}));
$('refresh-jobs').addEventListener('click', guard('push-result', refreshJobs));
$('set-cookie').addEventListener('click', guard('cookie-result', async () => {
  const { value } = await api('/cookie', { method: 'POST' });
  show('cookie-result', `심었어요: ${value}`, 'good');
}));
$('check-cookie').addEventListener('click', guard('cookie-result', async () => {
  const { present, value } = await api('/cookie');
  show('cookie-result', present ? `있음: ${value}` : '없음 (Safari 쿠키가 이 앱으로 이어지지 않아요)', present ? 'good' : 'warn');
}));
$('refresh-mcp').addEventListener('click', guard('mcp-result', refreshMcp));

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').then(renderStatus, renderStatus);
} else {
  renderStatus();
}
if (store.get(TOKEN_KEY)) {
  refreshJobs().catch(() => undefined);
  refreshMcp().catch(() => undefined);
}
