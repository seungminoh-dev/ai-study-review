import type { Env } from '../env';
import { base64url, sha256 } from '../lib/crypto';

// GitHub OAuth (설계서 §8.4). GitHub에서는 사용자 id·아이디·이름만 받는다.
// scope를 비워 공개 프로필만 읽고, 받은 access token은 저장하지 않는다.

const AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
const TOKEN_URL = 'https://github.com/login/oauth/access_token';
const USER_URL = 'https://api.github.com/user';

export interface GithubUser {
  /** 숫자 id를 문자열로. 아이디(login)는 바뀔 수 있어서 이것으로 찾는다 */
  id: string;
  login: string;
  name: string | null;
  /** GitHub 계정이 만들어진 때 (ms). 초대 없이 가입할 때 막 만든 계정을 거른다 */
  createdAt: number | null;
}

export function githubConfigured(env: Env): boolean {
  return Boolean(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET);
}

export function callbackUrl(env: Env): string {
  return `${env.APP_ORIGIN}/api/auth/github/callback`;
}

/** PKCE(S256) challenge. verifier는 state 쿠키에만 둔다 */
export async function pkceChallenge(verifier: string): Promise<string> {
  return base64url(await sha256(verifier));
}

export function authorizeUrl(env: Env, state: string, challenge: string): string {
  const params = new URLSearchParams({
    client_id: env.GITHUB_CLIENT_ID!,
    redirect_uri: callbackUrl(env),
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    allow_signup: 'true',
  });
  return `${AUTHORIZE_URL}?${params}`;
}

/** 인가 코드를 토큰으로 바꾸고 사용자 정보를 읽는다. GitHub가 거절하거나 응답이 이상하면 null */
export async function fetchGithubUser(env: Env, code: string, verifier: string): Promise<GithubUser | null> {
  // OAuth 표준대로 폼으로 보낸다. 응답은 accept 헤더로 JSON을 받는다
  const tokenResponse = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { accept: 'application/json', 'user-agent': 'moai' },
    body: new URLSearchParams({
      client_id: env.GITHUB_CLIENT_ID!,
      client_secret: env.GITHUB_CLIENT_SECRET!,
      code,
      redirect_uri: callbackUrl(env),
      code_verifier: verifier,
    }),
  });
  if (!tokenResponse.ok) return null;
  // 실패해도 200에 { error }로 온다
  const token = (await tokenResponse.json().catch(() => null)) as { access_token?: unknown } | null;
  if (typeof token?.access_token !== 'string') return null;

  const userResponse = await fetch(USER_URL, {
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token.access_token}`,
      'user-agent': 'moai',
      'x-github-api-version': '2022-11-28',
    },
  });
  if (!userResponse.ok) return null;
  const user = (await userResponse.json().catch(() => null)) as { id?: unknown; login?: unknown; name?: unknown; created_at?: unknown } | null;
  if (typeof user?.id !== 'number' || typeof user.login !== 'string') return null;
  const createdAt = typeof user.created_at === 'string' ? Date.parse(user.created_at) : Number.NaN;
  return {
    id: String(user.id),
    login: user.login,
    name: typeof user.name === 'string' && user.name.trim() ? user.name.trim() : null,
    createdAt: Number.isFinite(createdAt) ? createdAt : null,
  };
}
