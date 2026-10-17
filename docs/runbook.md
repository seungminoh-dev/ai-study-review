# 모아이 운영 가이드

MVP 1(나 혼자 루프)부터 쓰는 가이드다. MVP 0 점검 기록은 [MVP 0 실행 가이드](mvp0-runbook.md)에 남겨 둔다.

| 표시 | 뜻 |
|---|---|
| 🙋 직접 | Cloudflare·claude.ai·휴대폰에서 내가(사용자) 해야 하는 일 |
| 🤖 자동 | `main`에 머지하면 GitHub Actions가 하는 일 |

---

## 1. MVP 1로 바꾸기 (한 번만)

### 1-1. secret 넣기 (🙋 직접, 로컬 터미널)

모두 `apps/worker` 폴더 안에서 **한 줄씩** 실행한다. wrangler는 지금 폴더의 `wrangler.jsonc`로 Worker를 찾는다. 레포 루트에서 실행하면 "Required Worker name missing" 오류가 난다. `secret put`은 값을 물어보므로 여러 줄을 한 번에 붙여 넣지 않는다.

```bash
cd apps/worker                          # Windows PowerShell: cd apps\worker
node ../../scripts/gen-token.mjs        # 출력값 1 → TOKEN_PEPPER
node ../../scripts/gen-token.mjs        # 출력값 2 → BOOTSTRAP_CODE. 1-3에서 한 번 입력하니 적어 둔다
npx wrangler secret put TOKEN_PEPPER    # "Enter a secret value"에 출력값 1을 붙여 넣는다
npx wrangler secret put BOOTSTRAP_CODE  # 출력값 2
npx wrangler secret delete SPIKE_TOKEN  # MVP 0 전용이라 지운다
npx wrangler secret list                # TOKEN_PEPPER, BOOTSTRAP_CODE, VAPID_PRIVATE_KEY가 보이면 된다
```

- `TOKEN_PEPPER`는 세션과 커넥터 토큰을 해시하는 키다. **바꾸면 모든 로그인과 커넥터 URL이 무효가 된다.** 한 번 넣고 그대로 둔다.
- secret은 넣는 즉시 반영된다. 다시 배포할 필요는 없다.

### 1-2. 배포 (🤖 자동)

`main`에 머지하면 Deploy 워크플로가 `0001_init.sql` 마이그레이션(MVP 0 점검 테이블 삭제, MVP 1 테이블 생성) → PWA 빌드 → 배포를 한다.

- 이 배포부터 MVP 0의 `/spike` 페이지와 SPIKE_TOKEN 커넥터 URL은 동작하지 않는다.
- 1-1을 하기 전에 배포됐으면 `/setup`이 "secret을 먼저 넣어 주세요"라고 알려 준다. 1-1을 하고 다시 열면 된다.

### 1-3. 오너 계정 만들기 (🙋 직접, 휴대폰에서)

**휴대폰에서 한다.** MVP 1에는 다른 기기 로그인이 없어서(MVP 2에서 생긴다), 처음 만든 기기에서만 로그인된다.

1. 휴대폰 Chrome에서 `https://moai.smoh.dev`를 연다.
2. 메뉴 → **홈 화면에 추가**(또는 "앱 설치")로 설치한다.
3. 홈 화면의 모아이 앱을 열고, 설정 코드(1-1의 `BOOTSTRAP_CODE`)와 이름을 넣는다.
4. 오너는 한 명만 만들 수 있다. 만든 뒤에는 `/setup`이 닫힌다.

Android는 브라우저에서 만든 로그인이 설치한 앱에도 이어진다 (MVP 0 확인 항목 7). iPhone은 홈 화면 앱 안에서 해야 한다.

### 1-4. 앱 설정 (🙋 직접, 모아이 앱의 설정 탭)

1. **이 기기에서 알림 켜기** → 권한 허용 → **테스트 알림**이 오는지 본다.
2. **알림 시간**을 1~3개 정하고 저장한다. 그 시각에 복습할 카드가 있을 때만 알림이 온다.
3. **커넥터 URL 만들기**를 누르고 URL을 복사한다. URL은 이때 한 번만 보인다.
   - 데스크톱으로 옮길 때는 카카오톡 "나와의 채팅"처럼 나만 보는 곳에 붙여 넣는다.

### 1-5. claude.ai 커넥터 바꾸기 (🙋 직접, 웹 claude.ai)

1. Customize → Connectors에서 **MVP 0의 모아이 커넥터(SPIKE_TOKEN URL)를 지운다.**
2. **Add custom connector** → 이름 `모아이`, URL은 1-4에서 복사한 주소, 인증은 **No sign in**.
3. 도구 3개(`find_concepts`, `save_learning`, `get_learner_context`)를 **Always allow**로 바꾼다. 그래야 폰에서 승인 버튼을 누르지 않는다.

### 1-6. 코치 지침 바꾸기 (🙋 직접)

면접 코치 프로젝트 지침에서
- MVP 0 때 넣은 임시 한 줄을 지운다.
- 기존 `# 세션 정리` 부분을 지운다.
- 모아이 앱 설정 탭의 **지침 복사**로 복사한 "# 모아이 연동" 블록을 붙인다.

### 1-7. 처음 돌려 보기 (🙋 직접)

1. 폰 앱의 코치 프로젝트에서 짧게 공부하고 "정리해줘"라고 한다.
2. Claude가 `find_concepts` → `save_learning`을 부르고 "개념 N개, 카드 N장을 저장했어요"라고 알린다.
3. 모아이 앱의 기록 탭에 세션이 생기고, 오늘 탭에 복습할 카드가 보인다.
4. 다음 날 정한 시각에 알림이 오고, 알림을 누르면 복습 화면이 열린다.

틀린 카드가 보이면 복습 화면의 **이 카드가 틀렸어요 · 끄기**로 바로 끈다. 기록 탭에서 다시 켤 수 있다.

---

## 2. 평소 운영

### 배포

- 작업 브랜치에서 CI(타입 검사, PWA 빌드, 테스트)가 통과하면 `main`에 머지한다. 🤖 Deploy가 마이그레이션 → 빌드 → 배포를 한다.
- 급할 때는 GitHub Actions → Deploy → Run workflow로 직접 돌린다.

### 비용

- Workers Paid(월 $5)를 쓴다. 이 규모면 포함량의 1% 남짓이라 추가 요금이 없다고 본다.
- 요청당 CPU는 `limits.cpu_ms`로 1초까지만 쓴다.
- 대시보드 → Manage Account → Billing → Billable Usage → Budget alerts에 $1 알림을 걸어 두면 사용량 요금이 생긴 다음 날 메일이 온다.

### 백업 (🙋 주 1회)

```bash
cd apps/worker
npx wrangler d1 export moai --remote --output=moai-$(date +%F).sql
```

- 파일은 레포나 공개 저장소에 올리지 않는다.
- D1 Time Travel로 7일 안의 시점으로 되돌릴 수도 있다.

### 로그

- 호출 로그(invocation logs)는 끈다. 요청 URL에 커넥터 토큰이 들어 있기 때문이다.
- 직접 남기는 로그는 이벤트 이름, 사용자 ID, 도구 이름, 상태만 남긴다.
- 실시간으로 보려면 `npx wrangler tail`을 쓴다.

### 커넥터 URL이 새었을 때

모아이 앱 설정 → **커넥터 URL 다시 만들기**. 이전 URL은 바로 막힌다. claude.ai에서 커넥터를 지우고 새 URL로 다시 추가한다.

---

## 3. 로컬 개발

```bash
npm ci
cp apps/worker/.dev.vars.example apps/worker/.dev.vars   # npm run gen:token, npm run gen:vapid로 값을 채운다
npm run db:migrate:local
npm run build        # PWA를 apps/web/dist로 빌드한다
npm run dev          # http://localhost:8787 (Worker가 PWA와 API를 함께 제공한다)
```

- 화면만 고칠 때는 `npm run dev:web`(Vite, http://localhost:5173)를 함께 띄운다. `/api`와 `/mcp`는 8787로 넘긴다.
- 검사: `npm run typecheck`, `npm test`
- 레포 루트의 `.npmrc`에 `legacy-peer-deps=true`가 있다. npm 10이 선택적 peer 의존성을 계산하다 멈추는 버그를 피하려는 설정이다.
- 로컬 D1을 비우려면 `apps/worker/.wrangler/state`를 지우고 `npm run db:migrate:local`을 다시 한다.

---

## 4. MVP 1이 끝났다는 기준 (설계서 §2.2)

- 14일 중 10일 이상 복습했다.
- 저장한 다음 날 첫 알림이 정한 시각 1분 안에 온다.
- 2주 동안 도구 호출 실패가 0건이다.
- 틀린 카드를 발견하면 그 자리에서 끌 수 있다.
