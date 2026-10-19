import { app } from './app';
import { runCron } from './cron';
import { raiseAlert } from './domain/alerts';
import type { Env } from './env';
import { oauthProvider } from './oauth';

// Durable Object 클래스는 Worker 입구에서 내보내야 한다 (wrangler.jsonc의 durable_objects)
export { AnthropicRelay } from './llm/relay';

export default {
  async fetch(request, env, ctx) {
    try {
      // 예전 비밀 URL 커넥터(/mcp/u/:token)는 OAuth 보호 경로(/mcp) 아래에 있어서 OAuthProvider보다 먼저 받는다
      if (new URL(request.url).pathname.startsWith('/mcp/u/')) return await app.fetch(request, env, ctx);
      return await oauthProvider(env).fetch(request, env, ctx);
    } catch (error) {
      // Hono 밖(OAuthProvider, OAuth MCP 처리)에서 난 오류. Hono 안은 app.onError가 받는다
      console.error(JSON.stringify({ event: 'unhandled_error', where: 'entry', error: error instanceof Error ? error.name : 'unknown', message: error instanceof Error ? error.message : '' }));
      ctx.waitUntil(raiseAlert(env, 'server_error'));
      return new Response(null, { status: 500 });
    }
  },
  async scheduled(controller, env, _ctx) {
    try {
      // 예정 시각을 기준으로 한다. 실행이 몇 초 늦어도 같은 분으로 본다
      await runCron(env, controller.scheduledTime);
    } catch (error) {
      console.error(JSON.stringify({ event: 'cron_failed', message: error instanceof Error ? error.message : '' }));
      await raiseAlert(env, 'cron_failed');
    }
  },
} satisfies ExportedHandler<Env>;
