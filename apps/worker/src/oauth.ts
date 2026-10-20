import { OAuthProvider, getOAuthApi, type OAuthHelpers, type OAuthProviderOptions } from '@cloudflare/workers-oauth-provider';
import { app } from './app';
import { CLIENT_NOT_ALLOWED, OAUTH_SCOPE, allowedRedirect } from './auth/authorize';
import type { Env } from './env';
import { serveMcp } from './mcp/route';

// OAuth 커넥터 인증 (설계서 §8.7): claude.ai·Claude Code가 https://<주소>/mcp 만 넣으면 모아이 로그인과 허용을 거쳐 토큰을 받는다.
// 예전 비밀 URL(/mcp/u/:token)은 index.ts가 이 앞에서 따로 받아서 그대로 쓸 수 있다.
// 토큰·코드·클라이언트 비밀은 OAUTH_KV에 해시로만, props(사용자 id)는 토큰으로만 풀리게 암호화돼 들어간다.

const DAY = 24 * 60 * 60;

function options(env: Env): OAuthProviderOptions<Env> {
  return {
    apiRoute: '/mcp',
    apiHandler: {
      fetch: async (request, workerEnv, ctx) => {
        const { userId } = (ctx as ExecutionContext & { props: { userId: string } }).props;
        // 계정을 지우거나 이용을 멈출 때 권한도 끊지만, 남은 토큰이 있어도 없거나 멈춘 사용자로는 쓰지 않는다
        const user = await workerEnv.DB.prepare('SELECT 1 FROM users WHERE id = ?1 AND disabled_at IS NULL').bind(userId).first();
        if (!user) return new Response(null, { status: 401 });
        return serveMcp(request, workerEnv, userId);
      },
    },
    defaultHandler: { fetch: (request, workerEnv, ctx) => app.fetch(request, workerEnv, ctx) },
    authorizeEndpoint: '/authorize',
    tokenEndpoint: '/oauth/token',
    clientRegistrationEndpoint: '/oauth/register',
    clientIdMetadataDocumentEnabled: true,
    // 등록할 때부터 리디렉트 주소를 Claude와 이 컴퓨터로 묶는다 (허용 화면도 한 번 더 본다)
    clientRegistrationCallback: ({ clientMetadata }) => {
      const uris = clientMetadata.redirect_uris;
      const ok = Array.isArray(uris) && uris.length > 0 && uris.every((uri) => typeof uri === 'string' && allowedRedirect(uri));
      return ok ? undefined : { description: CLIENT_NOT_ALLOWED };
    },
    scopesSupported: [OAUTH_SCOPE],
    requiredScopes: [OAUTH_SCOPE],
    resourceMetadata: { resource: `${env.APP_ORIGIN}/mcp`, authorization_servers: [env.APP_ORIGIN], resource_name: '모아이' },
    // 쓰는 동안은 이어지고, 60일 동안 안 쓰면 끊긴다 (그때는 커넥터에서 다시 연결)
    accessTokenTTL: 60 * 60,
    refreshTokenTTL: 60 * DAY,
    refreshTokenIdleTTL: 60 * DAY,
  };
}

/** 주소(APP_ORIGIN)는 실행할 때 env로 알 수 있어서 처음 요청 때 만든다 */
const providers = new Map<string, OAuthProvider<Env>>();

/** 요청 밖(테스트)에서 쓰는 OAuth 도우미 */
export const oauthHelpers = (env: Env): OAuthHelpers => getOAuthApi(options(env), env);

export function oauthProvider(env: Env): OAuthProvider<Env> {
  let provider = providers.get(env.APP_ORIGIN);
  if (!provider) providers.set(env.APP_ORIGIN, (provider = new OAuthProvider(options(env))));
  return provider;
}
