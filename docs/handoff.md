# 인계: 클라우드 세션 → 로컬 세션

2026-10-18 작성. 기준은 이 문서가 들어간 `main` 커밋이다 (그 앞 배포 커밋은 `a6ea056`).
처음이면 이 문서 → [설계서](design.md)의 해당 절 → 코드 순으로 본다. 운영 절차는 [운영 가이드](runbook.md), 제품 기획은 [기획서](service-plan.md)에 있다.

---

## 1. 지금 상태

- **운영**: https://moai.smoh.dev. Cloudflare Workers Paid, D1 `moai`, 매분 Cron 1개.
- **배포된 마이그레이션**: `0001`~`0006` (0006: 자료·분류). 모두 운영과 비슷한 로컬 데이터로 미리 돌려 보고 올렸다.
- **끝난 기능**: MVP 0~2 전부. MVP 3은 Claude Code 플러그인, 채팅 복습, 확신도, 모의면접 체인, 질문 은행, 베타 지표, 자동 분류, PDF 자료까지다. 표는 [설계서 §2.4](design.md#24-mvp-3-확장-이후).
- **2026-10-18 방향 바꿈**: 친구와 함께하는 기능(리그, 질문 은행, 질문 공유)은 PWA 화면에서 뺐다. 내 성취를 높이는 쪽으로 디자인을 다시 짠다. 서버 API와 데이터는 그대로 두었다.
- **2단계 디자인 적용**: 마스코트 색(남색 주요 버튼, 주황 강조, 크림 선택), 마스코트 컴포넌트(`apps/web/src/Mascot.tsx`), 선 아이콘(`icons.tsx`), 휴대폰 아래 탭(오늘·지도·성장·기록, 설정은 오늘 화면 오른쪽 위)과 컴퓨터 사이드바, 새 "내 성장" 화면(`/growth`). 시안은 디자인 캔버스 "모아이 2단계 디자인 시안"에 있다. `/api/stats`에 `best_streak`, `last_week_xp`, `history`(84일)를 더했다. 설계서 §12의 화면 목록은 아직 예전 그대로다.
- **3단계 3-1 모션·마스코트**: 시안은 디자인 캔버스 "모아이 3단계 디자인 시안"에 있다.
  - Motion(`motion` 13.5.1, 정확한 버전 고정)을 CSS와 섞어 쓴다. 기능 묶음(`motion-features.ts`, domMax)은 첫 화면 뒤에 따로 받는다 (첫 JS +18KB, 뒤 묶음 28KB, gzip).
  - 마스코트 포즈 10가지(`Mascot.tsx`, 사용자 상황 시트 기준)와 깜빡임·숨쉬기 같은 움직임(`styles.css`의 `.mascot.alive`).
  - 누르는 버튼, 카드 hover, 탭 알약(`layoutId`), 화면 전환(`router.tsx`의 `show`, View Transitions).
  - 복습 카드 넘김·확신도·답 시트(`AnimatePresence`), 불러오는 중 뼈대(`Loading.tsx`), 끝 화면 꽃가루와 XP 세기(`Confetti.tsx`, `useCountUp`).
  - 동작 줄이기를 켜면 자리를 옮기는 움직임만 멈추고 투명도 변화와 깜빡임은 남는다.
  - 사라지는 카드는 `Presence`가 inert로 막고, 기록 함수는 지금 카드가 아니면 무시한다. 사라지는 카드의 "다음"을 또 누르면 같은 답이 다시 기록되던 문제를 막는다.
- **3단계 3-2 랜딩·로그인·가입·시작 가이드**:
  - 로그인하지 않으면 `/`가 공개 랜딩(`Landing.tsx`)이다. 체험 카드 3장(`cards/DemoDeck.tsx`)은 실제 카드 컴포넌트로 기기 안에서만 돈다.
  - 로그인은 `/login`이다. 서버가 GitHub 실패로 `/?auth=`에 돌려보내면 랜딩 대신 로그인 화면이 이유와 함께 뜬다. 가입(`/join`)을 마치면 시작 가이드(`/welcome`)로 간다.
  - 시작 가이드는 설치(`install.ts`가 `beforeinstallprompt`를 잡아 둔다), 연결 주소(이미 있으면 새로 만들지 않고, 주소는 가려서 보여 준다), 첫 저장(이 단계를 보는 동안만 5초마다 `/sessions` 확인), 알림(기존 시간은 두고 더한다)을 실제 기능으로 한다. 오늘 화면의 "시작하기" 항목은 `/welcome?step=`으로 그 단계를 연다.
  - 로그인 뒤에만 쓰는 큰 화면은 `App.tsx`의 `lazyScreen`으로 따로 받고, 로그인하면 쉬는 틈에 미리 받는다. 첫 화면 JS는 약 103KB(gzip)다.
- **3단계 3-3 자료**: 마이그레이션 없이 `learning_sessions.material`/`material_part`로 묶는다.
  - 섹션 순서는 이름 끝의 쪽수(`(p.3–21)`) 순, 없으면 저장한 순서다 (`packages/shared/src/material.ts`의 `comparePart`). 이름이 "5. 상속"처럼 번호로 시작하면 그 번호를 배지에 쓴다 (`apps/web/src/materials.ts`의 `partView`).
  - `GET /api/materials`에 `next`(이어서 풀 섹션)를 더했고, `GET /api/materials/detail?title=`이 섹션별 진행·개념(12개까지)·카드 미리보기(3장)를 준다. `GET /api/queue?material=&part=`는 그 섹션만 낸다.
  - 화면: 자료 목록(`Materials.tsx`), 자료 상세(`MaterialDetail.tsx`, 휴대폰은 펼침·컴퓨터는 두 칸). 휴대폰 기록 탭 위에 "공부한 대화 | 자료" 나누기(`RecordsNav.tsx`)가 있고, 저장 기록 목록은 같은 자료의 섹션 저장을 한 줄로 묶는다. 오늘 화면의 "이어서 풀 자료"는 다음 섹션을 푼다.
  - "Claude에서 이어 공부하기"는 섹션 이름을 넣은 질문으로 `claude.ai/new?q=`를 연다.
- **테스트**: worker 124개, shared 23개 통과. CI·Deploy 모두 초록.
- **브랜치**: 클라우드 작업 브랜치 `claude/elegant-galileo-iupy8p`는 `main`에 합치고 지웠다. 열린 PR은 없다. 앞으로는 `main`에서 시작한다.
- **확인 못 한 것**: 마지막 배포(`a6ea056`) 뒤 운영 화면은 직접 열어 보지 못했다 (클라우드 환경에서 moai.smoh.dev 접속이 막혀 있었다). 로컬에서 먼저 볼 것:
  1. 기록 탭 → 자료 화면이 열리는지, 분류 칩(지식 지도·오늘 화면)이 보이는지
  2. 지식 지도의 "아직 안 푼 자료 개념도 보기" 토글
  3. 다음 정시(:00) 뒤 Cloudflare 로그에 `cron_repair_failed`가 없는지 (`library_repaired`는 바꾼 것이 있을 때만 남는다)

---

## 2. 로컬에서 처음 할 일

```bash
git pull origin main
npm ci                                   # Node 22.12 이상 (Vite 8이 요구한다)
cp apps/worker/.dev.vars.example apps/worker/.dev.vars
npm run gen:token                        # 두 번 실행 → TOKEN_PEPPER, BOOTSTRAP_CODE
npm run gen:vapid                        # VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY
npm run typecheck && npm run build && npm test
```

- `.dev.vars`에는 **로컬용 새 값**만 넣는다. 운영 secret을 로컬에 두지 않는다.
- `npm test` 전에 `npm run build`가 있어야 한다. Worker 테스트가 `apps/web/dist`(정적 파일 폴더)를 읽는다.
- 로컬 실행: `npm run db:migrate:local` → `npm run dev` (http://localhost:8787) → `/setup`에 로컬 `BOOTSTRAP_CODE`. 화면만 고칠 때는 `npm run dev:web` (Vite가 `/api`, `/mcp`를 8787로 넘긴다).
- `wrangler` 명령은 **`apps/worker` 폴더에서** 실행한다. 레포 루트에서는 "Required Worker name missing"이 난다.

---

## 3. 사용자 방침 (꼭 지킨다)

- 답은 **한국어 해요체로 짧게**.
- **테스트는 되돌릴 수 없는 주요 작업만** 한다: 마이그레이션, 삭제, 비용·예산, 데이터 상태를 바꾸는 일. 전부 테스트하지 않는다.
- **운영 서비스라 배포 전에 항상 보안 점검**을 한다 (IDOR, 인증 우회, 비밀값 노출, 프롬프트 주입, 비용 폭주). 찾은 것은 고친 뒤 배포한다.
- **PR 없이 `main`에 바로 머지해도 된다** (fast-forward push). PR은 요청할 때만 만든다.
- 비밀값:
  - `TOKEN_PEPPER`, `BOOTSTRAP_CODE`, `VAPID_PRIVATE_KEY`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `ANTHROPIC_API_KEY`, `GRADER_MODEL`은 `wrangler secret put`으로만 넣는다. 레포·로그·채팅에 남기지 않는다.
  - `.dev.vars`는 gitignore돼 있다. 커밋하지 않는다.
  - 서버 Anthropic 키는 브라우저와 로그로 절대 보내지 않는다.
  - 토큰·코드는 `HMAC(TOKEN_PEPPER)` 해시로만 저장하고 로그에 남기지 않는다.
  - **커넥터 URL은 비밀번호다.** 레포나 공유 `.mcp.json`에 넣지 않는다. MCP URL에 토큰이 들어 있어서 `invocation_logs`는 꺼 둔다 (켜지 않는다).
- 커밋, 코드 주석, 문서에 **모델 ID를 쓰지 않는다**. 모델은 `GRADER_MODEL` secret으로만 정한다.
- 사용자 이메일을 외부 서비스로 보내지 않는다.

---

## 4. 저장소 지도

| 경로 | 내용 |
|---|---|
| `apps/worker/src/api/` | PWA용 REST (Hono). `app.ts`가 라우트를 모은다. 공개 경로는 `/api/auth/*`, `/api/health`, `/api/setup`뿐이다 |
| `apps/worker/src/domain/` | 도메인 로직: `save-learning`, `queue`(오늘 큐·자료 큐), `reviews`(기록·낙관적 잠금·사다리), `ladder`, `concepts`(상태), `categories`(분류·별칭·매시 보정), `chat-review`, `interview`, `map`, `stats` |
| `apps/worker/src/mcp/` | MCP 서버. 도구 8개는 `server.ts`, 서버 지침·도구 설명은 `descriptions.ko.ts` |
| `apps/worker/src/llm/` | 서버 AI 채점·가져오기, 단가·예산 가드, 작업 테이블 |
| `apps/worker/src/cron.ts` | 매분: 알림 → AI 작업. 매시 0분: 만료 정리, `repairLibrary` |
| `apps/worker/migrations/` | D1 마이그레이션 `0001`~`0006` |
| `apps/web/src/` | PWA (Vite·React). `screens/`, 오프라인 답안함 `offline/store` |
| `packages/shared/src/` | zod 스키마와 공용 규칙: `save-learning`, `api`, `grading`, `category`, `llm` |
| `plugins/moai/` | Claude Code 플러그인 (0.2.0): `/moai:coach`, `capture`, `review`, `pdf`. 마켓플레이스는 루트 `.claude-plugin/marketplace.json` |
| `docs/` | `design.md` 설계서, `runbook.md` 운영, `service-plan.md` 기획서, `adr/` |

---

## 5. 배포와 마이그레이션

- `main`에 push하면 **Deploy**가 `npm ci` → 빌드 → 테스트 → `wrangler d1 migrations apply moai --remote` → `wrangler deploy`를 한다. GitHub 저장소 secret(`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`)은 이미 들어 있다. **CI**는 `main`·`claude/**` push마다 돈다.
- 마이그레이션은 **열·테이블 추가만** 한다. 기존 행을 바꾸는 UPDATE가 필요하면 결과를 미리 확인한다.
- **운영 비슷한 데이터로 미리 돌려 보기** (마이그레이션이 있을 때마다):
  1. 지금 배포된 코드를 따로 꺼낸다: `git worktree add ../moai-deployed origin/main` (머지 전 기준). 거기서 `npm ci`와 `npm run build`를 하고, `apps/worker/.dev.vars`를 복사해 둔다.
  2. 빈 폴더를 정해 그 코드로 띄운다: `cd ../moai-deployed/apps/worker && npx wrangler d1 migrations apply moai --local --persist-to <폴더>` → `npx wrangler dev --persist-to <폴더>`.
  3. API로 데이터를 채운다:
     - `POST /api/setup`으로 오너를 만든다 (Origin 헤더 필요).
     - `POST /api/mcp-token`으로 커넥터 URL을 받는다.
     - MCP `tools/call`로 `save_learning`을 부른다. 견본은 `packages/shared/fixtures/immutable-object.json`이다.
     - `POST /api/reviews`, `PUT /api/reminders`, `POST /api/invites`도 부른다.
  4. 서버를 끄고, 새 코드 폴더(`apps/worker`)에서 같은 `<폴더>`로 `wrangler d1 migrations apply moai --local --persist-to <폴더>`.
  5. `npx wrangler d1 execute DB --local --persist-to <폴더> --command "PRAGMA foreign_key_check"`가 비어 있는지, 행 수가 그대로인지 보고, 새 코드로 띄워 화면을 한 번 본다.
  - 채운 데이터에서 나온 쿠키·커넥터 URL은 로컬 값이지만 레포 밖에 둔다.
- 되돌리기: D1 Time Travel(7일)과 주 1회 `wrangler d1 export moai --remote --output=<파일>` ([설계서 §13.2](design.md#132-백업)). 내보낸 파일에는 친구들 데이터가 들어 있으니 레포에 넣지 않는다.

---

## 6. 코드 읽기 전에 알아 둘 규칙

- **인증**: 오너 1명(`/setup`) + GitHub OAuth와 초대 코드 가입. 다른 기기는 GitHub나 10분짜리 로그인 코드로 들어온다. `/api/*`의 GET이 아닌 요청은 `Origin === APP_ORIGIN`이어야 한다. `/invites`, `/members`, `/admin/*`는 `requireOwner`다.
- **MCP**: 비밀 URL `/mcp/u/<토큰>` 인증(토큰은 HMAC 해시로 찾는다), SDK 2.3.1 legacy stateless. 도구 8개:
  - `find_concepts`, `save_learning`, `get_learner_context`
  - `get_review_queue`, `submit_review`, `get_interview_chain`
  - `get_categories`, `update_categories` (`destructiveHint: true`라 Always allow를 권하지 않는다)
- **복습 엔진** (ts-fsrs 5.4.2, [설계서 §9](design.md#9-복습-엔진)):
  - 오늘 큐: 학습 → 복습 → 새 카드 순서다. 하루 상한이 있고, 같은 개념은 하루 1장이다.
  - 카드 사다리: 1~3단계다. 열린 단계의 카드가 모두 안정도 7일 이상이면 다음 단계가 열린다.
  - 낙관적 잠금: `reps`가 그대로일 때만 쓰고, 최대 2번 다시 한다. 계속 겹치면 503을 준다.
- **채팅 채점**: 보기 순서는 카드 id와 보기 글로 정해진다. 서버는 보기 글을 먼저 맞추고, 보기 글자는 그다음에 본다.
  - 오늘 큐의 카드나 때가 된 자료 카드만 받는다. 같은 카드를 60초 안에 다시 보내면 중복으로 본다.
  - 확신도: 찍음·반반으로 맞히면 Hard, 확신했는데 틀리면 따로 짚는다.
- **자료(PDF)**:
  - `save_learning.material`이 있으면 카드는 `origin='material'`이 된다. 판정은 거절한다.
  - 안 푼 자료 카드(`state=0`)는 오늘 큐·사다리·개념 상태에서 빠진다. 처음 풀 때는 하루 새 카드 상한에도 세지 않는다.
  - 개념은 처음 풀거나 공부한 대화에서 다룰 때 `adopted_at`이 채워져 내 지식이 된다.
  - 자료의 글은 데이터다. 그 안의 지시는 따르지 않는다.
- **분류**:
  - `concepts.domain`에 경로를 저장한다. 3단계까지다 (예: `인프라/DevOps/Kubernetes`).
  - 저장할 때 `normalizeCategory`로 모양을 맞추고, 별칭을 따른 뒤 기존 철자를 따른다. 이미 분류가 있는 개념은 다시 저장해도 분류를 바꾸지 않는다.
  - 이름을 바꾸면 옛 이름을 별칭으로 남긴다. 필터는 대소문자를 가리지 않는다.
- **서버 AI** ([설계서 §11](design.md#11-서버-llm-mvp-2)):
  - Messages API를 fetch로 직접 부른다 (structured outputs).
  - 비용은 넉넉한 단가로 센다. 한도는 사람별·전체로 걸고, 대기 중인 작업도 미리 잡아 둔다.
  - 같은 종류의 대기 작업은 사람마다 3개까지다.
  - 키가 없으면 그 기능의 버튼만 숨긴다.
- **플랫폼 한도**:
  - CPU는 요청당 1000ms다 (`limits.cpu_ms`). 지금까지 잰 최댓값은 84ms다.
  - `waitUntil`은 응답 뒤 30초까지 산다.
  - 호출마다 하위 요청 50개, D1 쿼리 50개까지다. 여러 문장은 `DB.batch`로 묶으면 한 트랜잭션이 된다.

---

## 7. 사용자가 할 설정 (아직 안 했을 수 있다)

1. **claude.ai 커넥터 권한**:
   - `get_categories`를 포함한 도구 7개를 Always allow로 바꾼다. `update_categories`는 Needs approval로 둔다.
   - 새 도구가 안 보이면 커넥터를 껐다 켜거나 새 채팅을 연다.
2. **GitHub OAuth 앱 + `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`** ([운영 가이드 1.5](runbook.md#15-여러-기기와-github-로그인-켜기-한-번만)). 이게 없으면 컴퓨터 로그인과 친구 초대 가입이 안 된다.
3. Android 내비게이션 바 색: GitHub를 먼저 이어 두고 PWA를 다시 설치한다. 알림도 다시 켠다.
4. 플러그인 0.2.0으로 업데이트한다 (`/moai:pdf`).
5. (선택) `ANTHROPIC_API_KEY`, `GRADER_MODEL`. 콘솔에서 월 지출 한도도 건다.

---

## 8. 다음 작업 후보

| 작업 | 메모 |
|---|---|
| claude.ai 내보내기 zip 일괄 가져오기 | Batch API(50% 할인). 서버 AI 키가 필요하다. 기존 붙여넣기 가져오기(`llm/jobs.ts`의 import)와 예산 가드를 재사용한다 |
| 앱에서 PDF 올리기 | 서버 AI로 장별 카드를 만든다. 결과는 지금처럼 `material`로 저장해서 풀기 전까지 분리한다. 파일 크기·쪽 수·비용 한도를 먼저 정한다 |
| OAuth 커넥터 인증 | `@cloudflare/workers-oauth-provider` + KV. 비밀 URL을 대신한다. KV를 만드는 Cloudflare 계정 작업이 필요하다. B2C 전에 한다 |
| 한국 외 시간대 | 지금은 04:00 KST 경계로 고정이다 (`lib/kst.ts`). `users.timezone` 열은 있다 |
| 음성으로 설명하기 | 방법 미정 |

알려진 한계 (지금은 괜찮다고 본 것):
- `repairLibrary`는 (사용자, 분류) 조합을 5000개까지만 본다. 사용자가 크게 늘면 나눠 읽게 고친다.
- `update_categories` 한 번에 rename을 여러 개 주면 모두 호출 시작 때의 목록으로 계산한다.
- 자료 카드를 풀고 되돌리기를 해도 그 개념은 내 지식으로 남는다.
- SQLite `lower()`는 ASCII만 바꾼다. 한글에는 영향이 없다.

---

## 9. 함정

- 테스트 헬퍼의 `workerFetch`는 `redirect: 'manual'`이다. 리다이렉트를 따라가면 OAuth 테스트가 깨진다.
- `recordReviews`는 채점 시각을 카드 생성 시각과 서버 현재 시각 사이로 자른다. "때가 안 됨"을 시험하려면 기록을 DB에서 직접 옛날로 옮긴다.
- 스크립트로 API를 부를 때는 `origin` 헤더를 꼭 넣는다 (없으면 403).
- Playwright에 로그인 쿠키를 넣을 때는 `url` 대신 `domain: 'localhost', path: '/'`를 쓴다 (`__Host-` 쿠키라 `secure: true`).
- 로그에는 이벤트 이름, 사용자 ID, 숫자만 남긴다. URL, 본문, 토큰은 남기지 않는다.
- claude.ai 커넥터는 도구 목록과 서버 지침을 캐시한다. 도구를 바꾼 뒤에는 커넥터를 다시 켜야 반영된다.
