// 설치 창에 보여 줄 화면(매니페스트 screenshots)을 찍는다: apps/web/public/screenshots/*.webp
// 필요한 것: 로컬 개발 서버(npm run dev, 8787), 시험 데이터가 든 로컬 D1(오너 계정), 설치된 Chrome(경로는 CHROME으로 바꿀 수 있다).
// 오너로 한 시간짜리 로그인 세션을 로컬 D1에 넣고, Chrome을 화면 없이 띄워 그 쿠키로 찍은 뒤 세션을 지운다. 운영 데이터는 쓰지 않는다.
import { execFileSync, spawn } from 'node:child_process';
import { createHmac, randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const worker = join(root, 'apps/worker');
const out = join(root, 'apps/web/public/screenshots');
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = 'http://localhost:8787';
const PORT = 9333;

const SHOTS = [
  { file: 'today.webp', path: '/', width: 390, height: 844, scale: 2, mobile: true },
  { file: 'review.webp', path: '/review', width: 390, height: 844, scale: 2, mobile: true },
  { file: 'map.webp', path: '/map', width: 390, height: 844, scale: 2, mobile: true },
  { file: 'wide.webp', path: '/', width: 1280, height: 800, scale: 1, mobile: false },
];

const pepper = /^TOKEN_PEPPER=(.+)$/m.exec(readFileSync(join(worker, '.dev.vars'), 'utf8'))?.[1];
if (!pepper) throw new Error('apps/worker/.dev.vars에 TOKEN_PEPPER가 없어요');
// 서버와 같은 방식으로 세션 토큰을 해시한다 (apps/worker/src/lib/crypto.ts의 hashToken)
const token = randomBytes(32).toString('base64url');
const hash = createHmac('sha256', pepper).update(token).digest('base64url');
const d1 = (sql) => execFileSync('npx', ['wrangler', 'd1', 'execute', 'DB', '--local', '--command', sql], { cwd: worker, stdio: 'ignore' });
const now = Date.now();
d1(`INSERT INTO auth_sessions (token_hash, user_id, created_at, last_seen_at, expires_at) SELECT '${hash}', id, ${now}, ${now}, ${now + 3_600_000} FROM users WHERE role = 'owner'`);

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const profile = mkdtempSync(join(tmpdir(), 'moai-shots-'));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', 'about:blank'], {
  stdio: 'ignore',
});
try {
  let target = null;
  for (let i = 0; i < 50 && !target; i++) {
    await wait(200);
    target = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })
      .then((response) => response.json())
      .catch(() => null);
  }
  if (!target) throw new Error('Chrome에 연결하지 못했어요');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve) => ws.addEventListener('open', resolve, { once: true }));
  let next = 0;
  const waiting = new Map();
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    waiting.get(message.id)?.(message);
    waiting.delete(message.id);
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++next;
      waiting.set(id, (message) => (message.error ? reject(new Error(`${method}: ${message.error.message}`)) : resolve(message.result)));
      ws.send(JSON.stringify({ id, method, params }));
    });

  await send('Network.setCookie', { name: '__Host-sid', value: token, url: BASE, path: '/', secure: true, httpOnly: true, sameSite: 'Lax' });
  // 움직임이 멈춘 모습으로, 밝은 화면으로 찍는다
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }, { name: 'prefers-color-scheme', value: 'light' }] });
  // 새 배지 축하는 처음 한 번만 뜨는 화면이라 이미 본 것으로 두고 찍는다 (apps/web/src/badges.tsx의 moai:badges-seen)
  await send('Page.navigate', { url: BASE });
  await wait(3000);
  await send('Runtime.evaluate', {
    expression: `fetch('/api/stats').then((r) => r.json()).then((s) => localStorage.setItem('moai:badges-seen', JSON.stringify(s.badges.filter((b) => b.earned_at).map((b) => b.id))))`,
    awaitPromise: true,
  });
  mkdirSync(out, { recursive: true });
  for (const shot of SHOTS) {
    await send('Emulation.setDeviceMetricsOverride', { width: shot.width, height: shot.height, deviceScaleFactor: shot.scale, mobile: shot.mobile });
    await send('Page.navigate', { url: BASE + shot.path });
    await wait(4000);
    const { data } = await send('Page.captureScreenshot', { format: 'webp', quality: 85 });
    writeFileSync(join(out, shot.file), Buffer.from(data, 'base64'));
    console.log(`${shot.file} ${shot.width * shot.scale}x${shot.height * shot.scale}`);
  }
  ws.close();
} finally {
  chrome.kill();
  d1(`DELETE FROM auth_sessions WHERE token_hash = '${hash}'`);
  rmSync(profile, { recursive: true, force: true });
}
