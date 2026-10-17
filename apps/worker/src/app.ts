import { Hono } from 'hono';
import type { Env } from './env';
import { checkOrigin } from './lib/guard';
import { errorJson } from './lib/http';
import { handleMcp } from './mcp/route';
import { spike } from './spike/routes';

export const app = new Hono<{ Bindings: Env }>();

app.all('/mcp/u/:token', handleMcp);

// 상태를 바꾸는 API 요청은 우리 Origin에서만 받는다 (설계서 §7.1).
app.use('/api/*', async (c, next) => {
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
    const rejected = checkOrigin(c.req.raw, c.env);
    if (rejected) return rejected;
  }
  await next();
});

app.get('/api/health', (c) => c.json({ ok: true, time: new Date().toISOString() }));
app.route('/api/spike', spike);

app.notFound((c) => errorJson(404, 'not_found', `${c.req.path}을(를) 찾지 못했어요.`));
app.onError((error, c) => {
  console.error(JSON.stringify({ event: 'unhandled_error', path: c.req.path.startsWith('/mcp/') ? '/mcp/u/:token' : c.req.path, message: error.message }));
  return errorJson(500, 'internal', '서버에서 문제가 생겼어요.');
});
