import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { account } from './api/account';
import { admin } from './api/admin';
import { ai } from './api/ai';
import { auth } from './api/auth';
import { cards } from './api/cards';
import { library } from './api/library';
import { me } from './api/me';
import { progress } from './api/progress';
import { review } from './api/review';
import { sessions } from './api/sessions';
import { settings } from './api/settings';
import { setup } from './api/setup';
import { authorize } from './auth/authorize';
import { requireOwner } from './auth/owner';
import { requireUser } from './auth/session';
import { raiseAlert } from './domain/alerts';
import type { AppEnv } from './context';
import { requireSameOrigin } from './lib/guard';
import { errorJson } from './lib/http';
import { MINUTE_MS } from './lib/kst';
import { handleMcp } from './mcp/route';

export const app = new Hono<AppEnv>();

app.all('/mcp/u/:token', handleMcp);
// OAuth 커넥터의 허용 화면. 토큰·등록·메타데이터는 OAuthProvider가 이 앱 앞에서 받는다 (oauth.ts)
app.route('/authorize', authorize);

// 로그인 없이 부를 수 있는 곳(/api/auth, /api/setup)도 있어서, 큰 본문을 보내 요청마다 CPU를 쓰게 하지 못하게 막는다.
// 가장 큰 요청(대화 붙여넣기 6만 자, 한글이면 약 180KB)도 넉넉히 들어간다
app.use('/api/*', bodyLimit({ maxSize: 256 * 1024, onError: () => errorJson(413, 'too_large', '보낸 내용이 너무 커요.') }));

// 상태를 바꾸는 API 요청은 우리 Origin에서만 받는다 (설계서 §7.1).
app.use('/api/*', async (c, next) => {
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
    const rejected = requireSameOrigin(c.req.raw, c.env);
    if (rejected) return rejected;
  }
  await next();
});

// 로그인 전에 쓰는 경로를 빼고는 모두 로그인이 필요하다
const PUBLIC_API = new Set(['/api/health', '/api/setup']);
const isPublic = (path: string) => PUBLIC_API.has(path) || path.startsWith('/api/auth/');
app.use('/api/*', async (c, next) => (isPublic(c.req.path) ? next() : requireUser(c, next)));

// 관리 API는 /api/admin/* 한 곳에 모으고, 어느 라우터에 있든 여기서 오너만 통과시킨다 (라우터마다 따로 걸지 않는다).
// Hono는 미들웨어와 라우트를 한 라우터에서 같은 경로로 고르니, 대소문자·끝 슬래시·%인코딩을 바꿔 라우트에 닿아도 이 검사를 탄다 (test/admin.test.ts).
// 이름·설문 메모가 들어 있어 응답(403 포함)을 어디에도 캐시하지 않는다
app.use(
  '/api/admin/*',
  async (c, next) => {
    await next();
    c.header('Cache-Control', 'no-store');
  },
  requireOwner,
);

/** 매분 Cron 표시가 이만큼 묵으면 멈춘 것으로 본다 */
const HEARTBEAT_STALE_MS = 5 * MINUTE_MS;

/**
 * 밖에서 보는 상태 확인 (Deploy의 운영 확인, Actions의 Health 일정). D1이 응답하고 매분 Cron이 5분 안에 돌았으면 200, 아니면 503.
 * 막 배포했거나 새 DB라 Cron 표시가 아직 없으면 Cron은 따지지 않는다
 */
app.get('/api/health', async (c) => {
  const now = Date.now();
  const beat = await c.env.DB.prepare("SELECT last_sent_at FROM alerts WHERE kind = 'cron_heartbeat'")
    .first<number>('last_sent_at')
    .then(
      (at) => ({ db: true, at }),
      () => ({ db: false, at: null }),
    );
  const cron = beat.at === null || now - beat.at < HEARTBEAT_STALE_MS;
  const ok = beat.db && cron;
  return c.json({ ok, db: beat.db, cron, time: new Date(now).toISOString() }, ok ? 200 : 503);
});
app.route('/api/setup', setup);
app.route('/api/auth', auth);
app.route('/api/admin', admin);
app.route('/api', account);
app.route('/api', ai);
app.route('/api', cards);
app.route('/api', library);
app.route('/api', me);
app.route('/api', progress);
app.route('/api', review);
app.route('/api', sessions);
app.route('/api', settings);

app.notFound((c) => errorJson(404, 'not_found', `${c.req.path.startsWith('/mcp/') ? '/mcp/u/:token' : c.req.path}을(를) 찾지 못했어요.`));
app.onError((error, c) => {
  // 주소에 든 개념 key·카드 id 같은 값은 남기지 않게 라우트 모양(/api/cards/:id)으로 적는다
  console.error(JSON.stringify({ event: 'unhandled_error', path: c.req.routePath || '(unknown)', message: error.message }));
  c.executionCtx.waitUntil(raiseAlert(c.env, 'server_error'));
  return errorJson(500, 'internal', '서버에서 문제가 생겼어요.');
});
