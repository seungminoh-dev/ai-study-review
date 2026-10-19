import { AuthorizationError, CimdFetchError, type AuthRequest, type ConsentDescription } from '@cloudflare/workers-oauth-provider';
import { Hono, type Context } from 'hono';
import type { AppEnv } from '../context';
import { requireSameOrigin } from '../lib/guard';
import { currentSession } from './session';

// OAuth 커넥터 허용 화면 (설계서 §8.7). 라이브러리가 요청을 검사하고, 여기서는 모아이 로그인을 확인한 뒤 허용을 묻는다.
// 클라이언트 이름 같은 값은 등록한 쪽이 정하므로 모두 이스케이프한다. 폼은 이 화면에서만, 한 번, 10분 동안 쓸 수 있는 handle을 가진다.

export const authorize = new Hono<AppEnv>();

/** 권한은 하나다: 이 사람의 모아이를 읽고 쓴다 */
export const OAUTH_SCOPE = 'moai';

const escape = (value: string) => value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

/** 허용 화면은 남의 사이트 안에 넣지 못하게 하고, 스크립트 없이 인라인 스타일만 쓴다 */
const PAGE_CSP = "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'";

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escape(title)} · 모아이</title>
<style>
:root{color-scheme:light dark;--bg:#fbf7f0;--surface:#fff;--text:#192849;--muted:#5a6378;--border:#e9e1d3;--pen:#192849;--pen-text:#fff;--soft:#fff0c7;--warn:#8a5a00;--warn-soft:#fdf3e1}
@media (prefers-color-scheme:dark){:root{--bg:#0f1626;--surface:#182238;--text:#f4efe4;--muted:#a7b0c4;--border:#2a3754;--pen:#ff914d;--pen-text:#192849;--soft:#33281f;--warn:#f0c060;--warn-soft:#33270f}}
*{box-sizing:border-box}
body{margin:0;min-height:100dvh;display:grid;place-items:center;padding:24px 16px;background:var(--bg);color:var(--text);font:16px/1.6 system-ui,-apple-system,'Apple SD Gothic Neo','Noto Sans KR',sans-serif}
main{width:100%;max-width:440px;padding:28px 24px;border:1px solid var(--border);border-radius:24px;background:var(--surface)}
h1{margin:0 0 12px;font-size:1.375rem;line-height:1.35}
p{margin:0 0 12px}
.muted{color:var(--muted);font-size:.875rem}
.box{padding:12px 14px;border-radius:14px;background:var(--soft);font-size:.9375rem}
.warn{padding:12px 14px;border-radius:14px;background:var(--warn-soft);color:var(--warn);font-size:.9375rem}
ul{margin:0 0 16px;padding-left:1.2em}
.actions{display:flex;gap:10px;margin-top:20px}
button,.button{flex:1;display:inline-flex;align-items:center;justify-content:center;min-height:52px;padding:0 18px;border-radius:16px;border:1px solid var(--border);background:var(--surface);color:var(--text);font:inherit;font-weight:700;text-decoration:none;cursor:pointer}
.primary{background:var(--pen);border-color:var(--pen);color:var(--pen-text)}
</style>
</head>
<body><main>${body}</main></body>
</html>`;
}

function html(c: Context<AppEnv>, markup: string, status: 200 | 400 | 401 = 200, headers = new Headers()): Response {
  headers.set('Content-Type', 'text/html; charset=utf-8');
  headers.set('Cache-Control', 'no-store');
  headers.set('Content-Security-Policy', PAGE_CSP);
  headers.set('X-Frame-Options', 'DENY');
  return new Response(markup, { status, headers });
}

function errorPage(c: Context<AppEnv>, message: string): Response {
  return html(c, page('연결하지 못했어요', `<h1>연결하지 못했어요</h1><p>${escape(message)}</p><p class="muted">창을 닫고 Claude에서 다시 연결해 주세요.</p>`), 400);
}

function consentPage(details: ConsentDescription, handle: string, displayName: string): string {
  const name = escape(details.clientName);
  const origin = details.clientDomain
    ? `<p class="muted"><strong>${escape(details.clientDomain)}</strong>에서 만든 앱이에요.</p>`
    : '<p class="muted">이 앱은 스스로 이름을 등록했어요. 이름이 진짜인지는 확인되지 않아요.</p>';
  const loopback = details.redirectIsLoopback
    ? '<p class="warn">권한이 이 컴퓨터의 프로그램으로 가요. 방금 그 프로그램에서 연결을 시작했을 때만 허용하세요.</p>'
    : '';
  return page(
    '모아이 연결',
    `<h1>${name}이(가) 모아이에 연결하려고 해요</h1>
${origin}
<p class="box"><strong>${escape(displayName)}</strong> 계정으로 연결해요. 허용하면 권한이 <strong>${escape(details.redirectHost)}</strong>로 가요.</p>
${loopback}
<p>허용하면 이 앱이 할 수 있는 일:</p>
<ul>
<li>공부한 내용을 복습 카드로 저장하기</li>
<li>내 개념, 분류, 지난 판정 읽기</li>
<li>채팅에서 복습 문제를 내고 채점하기, 모의면접하기</li>
</ul>
<form method="post" action="/authorize">
<input type="hidden" name="handle" value="${escape(handle)}">
<div class="actions">
<button type="submit" name="decision" value="deny">거절</button>
<button type="submit" name="decision" value="approve" class="primary">허용</button>
</div>
</form>
<p class="muted" style="margin-top:16px">연결한 앱은 모아이 설정 → claude.ai 커넥터에서 언제든 끊을 수 있어요.</p>`,
  );
}

/** 라이브러리가 낸 오류: 클라이언트가 확인됐으면 그쪽으로 돌려보내고, 아니면 이 화면에 보여 준다 */
function handleError(c: Context<AppEnv>, error: unknown): Response {
  if (error instanceof AuthorizationError && error.redirectTo) return Response.redirect(error.redirectTo, 302);
  if (error instanceof AuthorizationError) return errorPage(c, error.description || '연결 요청이 올바르지 않거나 시간이 지났어요.');
  if (error instanceof CimdFetchError) return errorPage(c, '이 앱의 정보를 확인하지 못했어요.');
  throw error;
}

authorize.get('/', async (c) => {
  const oauth = c.env.OAUTH_PROVIDER;
  if (!oauth) return errorPage(c, '서버 설정이 끝나지 않았어요.');
  let request: AuthRequest;
  try {
    request = await oauth.parseAuthRequest(c.req.raw);
  } catch (error) {
    return handleError(c, error);
  }
  const session = await currentSession(c, Date.now());
  if (!session) {
    // 로그인하고 나면 이 주소로 돌아온다 (Login 화면이 /authorize?로 시작하는 next만 따른다)
    const back = new URL(c.req.url);
    const login = `/login?${new URLSearchParams({ next: back.pathname + back.search })}`;
    return html(
      c,
      page(
        '모아이 로그인',
        `<h1>먼저 모아이에 로그인해 주세요</h1><p>이 브라우저에서 모아이에 로그인하면 바로 연결을 허용할 수 있어요.</p><div class="actions"><a class="button primary" href="${escape(login)}">로그인하러 가기</a></div>`,
      ),
      401,
    );
  }
  const user = await c.env.DB.prepare('SELECT display_name FROM users WHERE id = ?1').bind(session.user_id).first<string>('display_name');
  try {
    const details = await oauth.describeConsent(request);
    const consent = await oauth.beginConsent(request);
    return html(c, consentPage(details, consent.handle, user ?? ''), 200, consent.headers);
  } catch (error) {
    return handleError(c, error);
  }
});

authorize.post('/', async (c) => {
  // 다른 사이트가 몰래 보낸 폼을 막는다 (브라우저는 POST에 Origin을 붙인다)
  const rejected = requireSameOrigin(c.req.raw, c.env);
  if (rejected) return rejected;
  const oauth = c.env.OAUTH_PROVIDER;
  if (!oauth) return errorPage(c, '서버 설정이 끝나지 않았어요.');
  const session = await currentSession(c, Date.now());
  if (!session) return errorPage(c, '로그인이 끝났어요. Claude에서 다시 연결해 주세요.');
  const form = await c.req.raw.formData();
  const handle = String(form.get('handle') ?? '');
  try {
    if (form.get('decision') !== 'approve') {
      const denied = await oauth.denyConsent(c.req.raw, handle);
      return new Response(null, { status: 302, headers: denied.headers });
    }
    const approved = await oauth.approveConsent(c.req.raw, handle, { scope: [OAUTH_SCOPE] });
    const { redirectTo } = await oauth.completeAuthorization({
      request: approved.request,
      userId: session.user_id,
      metadata: {},
      scope: approved.request.scope,
      props: { userId: session.user_id },
    });
    approved.headers.set('Location', redirectTo);
    console.log(JSON.stringify({ event: 'oauth_authorized', user_id: session.user_id }));
    return new Response(null, { status: 302, headers: approved.headers });
  } catch (error) {
    return handleError(c, error);
  }
});
