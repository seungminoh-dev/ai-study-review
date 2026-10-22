import type { Env } from '../env';

// Google 로그인 (OpenID Connect). scope는 openid만 받아 계정 id(sub)만 읽는다. 이메일, 이름, 사진은 받지 않는다.
// ID 토큰은 토큰 엔드포인트에서 TLS로 바로 받으므로 서명 대신 발급자·대상·만료·nonce를 확인한다 (OIDC Core 3.1.3.7).

const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

export function googleConfigured(env: Env): boolean {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}

const callbackUrl = (env: Env) => `${env.APP_ORIGIN}/api/auth/google/callback`;

export function googleAuthorizeUrl(env: Env, state: string, challenge: string, nonce: string): string {
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID!,
    redirect_uri: callbackUrl(env),
    response_type: 'code',
    scope: 'openid',
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    // 같은 기기를 여러 사람이 쓰면 다른 계정으로 들어갈 수 있게 계정 고르기를 띄운다
    prompt: 'select_account',
  });
  return `${AUTHORIZE_URL}?${params}`;
}

/** 인가 코드를 ID 토큰으로 바꾸고 계정 id(sub)를 꺼낸다. 거절되거나 토큰이 이 앱·이 요청 것이 아니면 null */
export async function fetchGoogleSubject(env: Env, code: string, verifier: string, nonce: string, now: number): Promise<string | null> {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { accept: 'application/json' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID!,
      client_secret: env.GOOGLE_CLIENT_SECRET!,
      code,
      code_verifier: verifier,
      redirect_uri: callbackUrl(env),
      grant_type: 'authorization_code',
    }),
  });
  if (!response.ok) return null;
  const token = (await response.json().catch(() => null)) as { id_token?: unknown } | null;
  if (typeof token?.id_token !== 'string') return null;
  const claims = decodePayload(token.id_token);
  if (!claims) return null;
  const valid =
    typeof claims.iss === 'string' &&
    ISSUERS.includes(claims.iss) &&
    claims.aud === env.GOOGLE_CLIENT_ID &&
    typeof claims.exp === 'number' &&
    claims.exp * 1000 > now &&
    claims.nonce === nonce &&
    typeof claims.sub === 'string' &&
    /^[\x21-\x7e]{1,255}$/.test(claims.sub);
  return valid ? (claims.sub as string) : null;
}

function decodePayload(jwt: string): Record<string, unknown> | null {
  const part = jwt.split('.')[1];
  if (!part) return null;
  try {
    const bytes = Uint8Array.from(atob(part.replaceAll('-', '+').replaceAll('_', '/')), (char) => char.charCodeAt(0));
    const claims: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return claims && typeof claims === 'object' ? (claims as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
