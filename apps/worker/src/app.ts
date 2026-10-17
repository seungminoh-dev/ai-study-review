import { Hono } from 'hono';
import { review } from './api/review';
import { sessions } from './api/sessions';
import { settings } from './api/settings';
import { setup } from './api/setup';
import { requireUser } from './auth/session';
import type { AppEnv } from './context';
import { requireSameOrigin } from './lib/guard';
import { errorJson } from './lib/http';
import { handleMcp } from './mcp/route';

export const app = new Hono<AppEnv>();

app.all('/mcp/u/:token', handleMcp);

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
app.use('/api/*', async (c, next) => (PUBLIC_API.has(c.req.path) ? next() : requireUser(c, next)));

app.get('/api/health', (c) => c.json({ ok: true, time: new Date().toISOString() }));
app.route('/api/setup', setup);
app.route('/api', review);
app.route('/api', sessions);
app.route('/api', settings);

app.notFound((c) => errorJson(404, 'not_found', `${c.req.path.startsWith('/mcp/') ? '/mcp/u/:token' : c.req.path}을(를) 찾지 못했어요.`));
app.onError((error, c) => {
  console.error(JSON.stringify({ event: 'unhandled_error', path: c.req.path.startsWith('/mcp/') ? '/mcp/u/:token' : c.req.path, message: error.message }));
  return errorJson(500, 'internal', '서버에서 문제가 생겼어요.');
});
