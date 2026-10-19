import { app } from './app';
import { runCron } from './cron';
import type { Env } from './env';
import { oauthProvider } from './oauth';

// Durable Object 클래스는 Worker 입구에서 내보내야 한다 (wrangler.jsonc의 durable_objects)
export { AnthropicRelay } from './llm/relay';

export default {
  fetch(request, env, ctx) {
    // 예전 비밀 URL 커넥터(/mcp/u/:token)는 OAuth 보호 경로(/mcp) 아래에 있어서 OAuthProvider보다 먼저 받는다
    if (new URL(request.url).pathname.startsWith('/mcp/u/')) return app.fetch(request, env, ctx);
    return oauthProvider(env).fetch(request, env, ctx);
  },
  async scheduled(controller, env, _ctx) {
    // 예정 시각을 기준으로 한다. 실행이 몇 초 늦어도 같은 분으로 본다
    await runCron(env, controller.scheduledTime);
  },
} satisfies ExportedHandler<Env>;
