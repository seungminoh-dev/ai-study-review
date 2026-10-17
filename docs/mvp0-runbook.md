# 모아이 MVP 0 실행 가이드

MVP 0은 설계 전체가 기대는 가정을 실제 폰과 실제 claude.ai로 먼저 확인하는 단계다 ([설계서 §2.1](design.md)). 코드는 레포에 다 있다. 아래 표시한 단계만 직접 하면 된다.

| 표시 | 뜻 |
|---|---|
| 🙋 직접 | Cloudflare·GitHub·claude.ai 계정이 필요해서 내가(사용자) 해야 하는 일 |
| 🤖 이미 됨 | 코드와 설정 파일에 이미 들어 있는 것 |

## 무엇이 만들어져 있나 (🤖 이미 됨)

- `apps/worker`: Cloudflare Worker `moai`
  - `POST /mcp/u/<SPIKE_TOKEN>`: MCP 서버. 도구는 `ping`, `save_learning`(검사하고 원본만 저장)
  - `/api/spike/*`: 점검 페이지용 API (푸시 예약, 쿠키 확인, MCP 기록 보기)
  - 매분 Cron: 예약한 테스트 푸시 발송
- `apps/web/public`: 점검 페이지 `/spike`, 서비스 워커, 매니페스트, 아이콘
- `packages/shared`: `save_learning` 입력 스키마와 검사 규칙
- 테스트 40개: 스키마, MCP 계약(2025년 방식과 2026-07-28 방식을 공식 MCP 클라이언트로 확인), 푸시 Cron, 쿠키
- GitHub Actions: `CI`(모든 push·PR에서 타입 검사와 테스트), `Deploy`(main에 머지되면 배포)

---

## 1단계. Cloudflare 리소스 만들기 (🙋 직접, 한 번만)

로컬 터미널에서 레포를 받은 뒤 실행한다.

```bash
npm ci
cd apps/worker
npx wrangler login
npx wrangler d1 create moai --location apac
```

`apps/worker/wrangler.jsonc`에서 "직접 바꿀 곳" 주석이 달린 네 군데를 채운다.

| # | 항목 | 넣을 값 |
|---|---|---|
| 1 | `routes[0].pattern` | 쓸 서브도메인. 예: `moai.<내 도메인>` (도메인은 Cloudflare에 있어야 한다) |
| 2 | `database_id` | 위 `d1 create`가 출력한 값 |
| 3 | `vars.APP_ORIGIN` | `https://` + 1번 주소 |
| 4 | `vars.VAPID_PUBLIC_KEY`, `vars.VAPID_SUBJECT` | `npm run gen:vapid`(레포 루트에서)가 출력한 공개 키, 3번 주소 (공개 레포라 메일 주소 대신 https 주소를 쓴다. RFC 8292가 둘 다 허용한다) |

- `npm run gen:vapid`가 함께 출력한 **개인 키는 2단계에서 secret으로 넣는다.** 파일에 쓰거나 커밋하지 않는다.
- 위 네 값은 비밀이 아니라서 커밋해도 된다. 값을 알려 주면 내가(Claude) 넣어서 커밋해도 된다.
- 같은 이름의 DNS 레코드가 이미 있으면 커스텀 도메인 연결이 실패한다. 그 레코드를 먼저 지운다.

## 2단계. 첫 배포와 비밀값 (🙋 직접, 한 번만)

```bash
# apps/worker에서
npm run db:migrate:remote
npm run deploy

node ../../scripts/gen-token.mjs          # 출력값이 SPIKE_TOKEN. 어딘가 안전한 곳에 적어 둔다
npx wrangler secret put SPIKE_TOKEN       # 위 값을 붙여 넣는다
npx wrangler secret put VAPID_PRIVATE_KEY # 1단계에서 나온 개인 키를 붙여 넣는다
```

- `https://moai.<내 도메인>/api/health`가 `{"ok":true,...}`를 돌려주면 성공이다.
- secret은 넣는 즉시 반영된다. 다시 배포할 필요는 없다.

## 3단계. Cloudflare 존 설정 확인 (🙋 직접)

Cloudflare 대시보드에서 내 도메인(존)을 열고 확인한다 ([설계서 §13.3](design.md)).

| 항목 | 할 일 | 이유 |
|---|---|---|
| Security → Bots → **Bot Fight Mode** | 끈다 | Free 플랜은 경로별 예외가 안 돼서, 켜 두면 Anthropic 서버의 MCP 호출이 막힐 수 있다 |
| AI 봇·크롤러 차단 설정 (Security / AI Crawl Control) | `/mcp`로 오는 Claude 에이전트 트래픽을 막지 않는지 본다. 막으면 허용으로 바꾼다 | 같은 이유 |
| WAF 커스텀 규칙, 속도 제한 규칙 | `/mcp/*`에 걸리는 규칙이 없게 한다 | 403·429가 나면 연결이 끊긴다 |
| 리다이렉트 규칙 | `moai.<내 도메인>`에 걸리는 리다이렉트가 없게 한다 | 리다이렉트하면 커넥터가 깨진다 |

## 4단계. GitHub Actions 자동 배포 연결 (🙋 직접, 권장)

1. Cloudflare 대시보드 → My Profile → API Tokens → **Create Token** → 템플릿 **"Edit Cloudflare Workers"**
   - Permissions에 **Account → D1 → Edit**를 더한다 (마이그레이션 적용용).
   - Account Resources는 내 계정, Zone Resources는 내 도메인 존으로 고른다.
   - 배포 때 커스텀 도메인 권한 오류가 나면 **Zone → DNS → Edit**도 더한다.
2. 계정 ID 확인: `npx wrangler whoami` 또는 대시보드 Workers & Pages 화면 오른쪽.
3. GitHub 저장소 → Settings → Secrets and variables → Actions → **New repository secret**
   - `CLOUDFLARE_API_TOKEN`: 1에서 만든 토큰
   - `CLOUDFLARE_ACCOUNT_ID`: 2의 값

그다음부터는 main에 머지할 때마다 `Deploy` 워크플로가 마이그레이션 적용 → 배포를 한다. Actions 탭 → Deploy → Run workflow로 직접 돌릴 수도 있다.

- 저장소에 아직 `main` 브랜치가 없으면 자동 배포는 시작되지 않는다. 그동안은 Run workflow에서 배포할 브랜치를 골라 직접 돌린다.

- 비밀값이 없으면 배포 단계는 경고만 남기고 건너뛴다.
- `wrangler.jsonc`에 자리표시자(`moai.example.com`, 0으로 된 database_id)가 남아 있으면 실패하고 이유를 알려 준다.
- `SPIKE_TOKEN`, `VAPID_PRIVATE_KEY`는 GitHub에 넣지 않는다. 2단계에서 Cloudflare에 한 번 넣으면 배포해도 유지된다.

## 5단계. claude.ai 커넥터 추가 (🙋 직접)

1. **웹** claude.ai → Customize(설정) → Connectors → **Add custom connector**
   - 이름: `모아이`
   - URL: `https://moai.<내 도메인>/mcp/u/<SPIKE_TOKEN>`
   - 인증: **No sign in**
2. 추가된 커넥터에서 도구 `ping`, `save_learning`을 **Always allow**로 바꾼다. 그래야 폰에서 승인 버튼을 누르지 않는다.
3. 면접 코치 프로젝트 지침 끝에 임시로 한 줄을 더한다. MVP 1에서 [설계서 부록 B](design.md)의 전체 블록으로 바꾼다.

```markdown
사용자가 정리를 요청하면 세 줄 정리를 한 뒤 모아이 커넥터의 save_learning을 호출해 이번 세션을 저장한다. 판정의 said에는 사용자 원문을 그대로 넣는다.
```

## 6단계. 확인 항목 점검 (🙋 직접)

폰에서 `https://moai.<내 도메인>/spike`를 열어 둔다. 토큰을 넣으면 푸시·쿠키·MCP 기록을 그 화면에서 볼 수 있다.

| # | 확인 | 방법 | 통과 기준 |
|---|---|---|---|
| 1 | 웹 커넥터 | 새 대화에서 "+ → Connectors"에 모아이가 있는지 보고, "모아이 ping 해줘"라고 한다 | 응답에 서버 시각이 나온다 |
| 2 | 폰 앱 프로젝트 대화 | iPhone·Android 앱의 면접 코치 프로젝트에서 짧게 코칭받고 "정리해줘"라고 한다. 친구의 Pro 계정으로도 한 번 한다 | `/spike`의 저장 기록에 행이 생긴다. 그 프로젝트가 새 Projects 베타인지도 적는다 |
| 3 | CPU 시간 | 레포 루트에서 `npm run replay -- https://moai.<내 도메인>/mcp/u/<SPIKE_TOKEN> 30`을 실행한 뒤, 대시보드 → Workers & Pages → moai → **Logs**에서 tools/call 요청의 CPU Time을 본다. 테스트 푸시를 보낸 Cron 실행의 CPU Time도 본다 | tools/list·tools/call의 p99(30건 중 거의 최댓값)가 7ms 미만 |
| 4 | 프로토콜 | `/spike` MCP 기록의 "프로토콜" 열 | 값을 적는다 (claude.ai가 쓰는 버전) |
| 5 | iPhone 푸시 | `/spike`의 안내대로 홈 화면에 추가 → 알림 켜기 → "1분 뒤" 예약 → 앱 닫기 | 정한 시각 1분 안에 알림이 오고, 표의 지연이 60초 이하 |
| 6 | 존 설정 | 3단계를 마친 뒤 1, 2를 다시 해 본다 | 연결 실패가 없다 |
| 7 | 쿠키 | `/spike`의 쿠키 순서대로 | 결과(있음/없음)만 적는다 |
| 8 | 응답 시간 | replay 결과의 p95, `/spike` MCP 기록의 데이터센터 열 | 도구 호출 p95 1.5초 미만 |
| 9 | Claude Code | 구독으로 로그인한 Claude Code에서 `/mcp`를 열어 모아이가 보이는지 보고, "모아이 ping 해줘"라고 한다 | 기록만 한다 |

측정하느라 남은 기록은 지우고 시작하면 2번을 보기 쉽다.

```bash
# apps/worker에서
npx wrangler d1 execute moai --remote --command "DELETE FROM spike_log; DELETE FROM spike_mcp_requests;"
```

결과는 아래 표를 채워서 알려 주면 된다. 그 결과로 MVP 1 범위를 확정한다.

```
1 웹 커넥터:            통과 / 실패 (메모)
2 폰 프로젝트 대화:      iOS 통과/실패, Android 통과/실패, 친구 Pro 통과/실패, 새 Projects 베타 여부
3 CPU p99:              tools/list __ms, tools/call __ms, Cron 푸시 __ms
4 프로토콜:             ____
5 iPhone 푸시 지연:      __초
6 존 설정:              Bot Fight Mode 끔 / AI 봇 차단 확인
7 쿠키:                 있음 / 없음
8 응답 시간 p95:         __ms (데이터센터 __)
9 Claude Code:          보임 / 안 보임
```

막혔을 때의 대안은 [설계서 §2.1](design.md) 표의 "막히면" 열에 있다.

## 로컬에서 돌려 보기 (선택)

```bash
cd apps/worker
cp .dev.vars.example .dev.vars    # SPIKE_TOKEN과 VAPID 키를 채운다 (npm run gen:token, npm run gen:vapid)
npm run db:migrate:local
npm run dev                       # http://localhost:8787/spike
npm test                          # 레포 루트에서 npm test면 전체
```

- 레포 루트의 `.npmrc`에 `legacy-peer-deps=true`가 있다. npm 10이 선택적 peer 의존성을 계산하다 멈추는 버그를 피하려는 설정이다.
- 로컬 푸시는 브라우저 정책 때문에 잘 안 될 수 있다. 푸시는 배포한 주소에서 확인한다.

## MVP 0이 끝나면

- claude.ai에서 SPIKE_TOKEN이 든 커넥터를 지운다. MVP 1에서 사용자별 커넥터 URL로 새로 추가한다.
- `wrangler.jsonc`의 `invocation_logs`를 `false`로 바꾸고 `SPIKE_TOKEN` secret을 지운다 (`npx wrangler secret delete SPIKE_TOKEN`).
- `migrations/0001_init.sql`에서 `spike_*` 테이블을 지우고, `apps/web/public/spike.*`를 지운다.
