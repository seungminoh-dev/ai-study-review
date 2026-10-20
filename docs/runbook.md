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

**휴대폰에서 한다.** 다른 기기(컴퓨터)는 1.5장에서 GitHub나 로그인 코드로 로그인한다.

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
3. 도구 7개를 **Always allow**로 바꾼다 (`find_concepts`, `save_learning`, `get_learner_context`, `get_review_queue`, `submit_review`, `get_interview_chain`, `get_categories`). 그래야 폰에서 승인 버튼을 누르지 않는다.
   `update_categories`는 여러 개념의 분류를 한꺼번에 바꾸니 **Needs approval**로 둔다. 자료(PDF) 안에 숨은 지시가 있어도 묻지 않고 바뀌지 않는다.

### 1-6. 코치 지침 바꾸기 (🙋 직접, 선택)

지침이 없어도 커넥터를 켠 채팅이면 어디서든 "모아이에 저장해줘"로 저장된다. 서버가 언제 저장하는지 Claude에게 직접 알려 준다.
면접 코치 프로젝트에서 과거에 틀린 지점부터 묻게 하고 싶을 때만, 프로젝트 지침에서
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

## 1.5. 여러 기기와 GitHub 로그인 켜기 (한 번만)

`0002_accounts.sql` 마이그레이션은 배포할 때 🤖 자동으로 들어간다. GitHub OAuth 앱만 직접 만든다.

### 1.5-1. GitHub OAuth 앱 만들기 (🙋 직접, github.com)

1. GitHub → Settings → Developer settings → **OAuth Apps** → **New OAuth App**
2. 값:
   - Application name: `모아이` (로그인 화면에 보인다)
   - Homepage URL: `https://moai.smoh.dev`
   - Authorization callback URL: `https://moai.smoh.dev/api/auth/github/callback`
   - Enable Device Flow: 끈다
3. **Register application** → 화면의 **Client ID**를 복사한다.
4. **Generate a new client secret** → 값을 복사한다. 이 화면을 벗어나면 다시 볼 수 없다.

### 1.5-2. secret 넣기 (🙋 직접, 로컬 터미널)

```bash
cd apps/worker                                # Windows PowerShell: cd apps\worker
npx wrangler secret put GITHUB_CLIENT_ID      # Client ID
npx wrangler secret put GITHUB_CLIENT_SECRET  # client secret
```

넣는 즉시 반영된다. 둘 다 넣기 전에는 로그인 화면에 GitHub 버튼이 나오지 않는다.

### 1.5-3. 폰에서 GitHub 잇기 → 컴퓨터에서 로그인 (🙋 직접)

1. 폰의 모아이 앱 → 설정 → 계정 · 다른 기기 → **GitHub 연결** → GitHub에서 승인. "GitHub를 연결했어요"가 나오면 된다.
2. 컴퓨터 브라우저에서 `https://moai.smoh.dev` → **GitHub로 계속하기**. 같은 계정으로 열린다.
3. GitHub가 안 될 때: 폰 설정 → **다른 기기 로그인 코드 만들기** → 컴퓨터 로그인 화면의 "로그인 코드로"에 넣는다 (10분, 한 번).

### 1.5-4. 친구 초대 (🙋 직접, 필요할 때)

1. 폰 설정 → 초대 → 이름을 넣고 **초대 코드 만들기** → **안내와 함께 복사** → 카카오톡으로 보낸다. 코드는 이때만 보인다.
2. 친구는 `https://moai.smoh.dev`를 열어 홈 화면에 추가하고, **GitHub로 계속하기** → 초대 코드와 이름을 넣는다.
3. 친구도 자기 설정에서 커넥터 URL을 만들어 자기 claude.ai에 추가한다. 커넥터 URL은 사람마다 따로다.

### 1.5-5. 내비게이션 바 색 (🙋 직접, Android)

3버튼 내비게이션을 쓰면 아래 바 색이 앱 매니페스트의 `background_color`를 따른다. 다크 모드 탭 색(`#1A1F2A`)으로 바꿨는데, 이미 설치한 앱은 Chrome이 매니페스트를 다시 읽어야 바뀐다.

- 바로 바꾸려면: **1.5-3에서 GitHub를 먼저 이어 둔다.** 그다음 홈 화면의 모아이 앱을 길게 눌러 제거 → Chrome에서 `https://moai.smoh.dev` → 앱 설치. 보통 로그인은 Chrome에 남아 있고, 로그아웃됐으면 GitHub로 다시 로그인한다.
- 알림 권한은 앱을 지우면 같이 사라진다. 설정 → **이 기기에서 알림 켜기**를 다시 누른다.
- 제스처 내비게이션(설정 → 디스플레이 → 내비게이션 바 → 스와이프 제스처)은 바가 투명해서 이 문제가 없다.

---

## 2. MVP 2 켜기 (한 번만)

`0003_beta.sql` 마이그레이션(새 테이블과 열만 더한다)은 배포할 때 🤖 자동으로 들어간다. 설명하기 카드, 신고·고치기·되돌리기, 스트릭·리그, 지식 지도, 내보내기·계정 지우기는 설정 없이 바로 쓴다.

### 2-1. 서버 AI 켜기 (🙋 직접, 선택)

AI 채점과 대화 붙여넣기 가져오기만 서버 AI를 쓴다. 넣지 않으면 그 버튼만 감춰지고 자가 채점으로 쓴다.

1. [Anthropic Console](https://console.anthropic.com)에서 API 키를 만든다. Billing → Spend limits에 월 한도(예: $20)를 걸어 둔다. 앱의 예산 가드와 별개로 마지막 안전장치다.
2. `apps/worker`에서:
   ```bash
   npx wrangler secret put ANTHROPIC_API_KEY   # Console의 API 키
   npx wrangler secret put GRADER_MODEL        # 쓸 모델 ID (기획서 §10.1에서 고른 것)
   ```
3. 서비스 전체 한도를 바꾸려면 `wrangler.jsonc`의 `vars`에 `"LLM_MONTHLY_CAP_USD": "90"`처럼 넣는다 (없으면 이 값). Anthropic Console의 지출 한도와 같은 값으로 맞춘다. 이번 달 비용이 이 한도의 50·80·100%를 넘으면 매시 Cron이 단계마다 한 달에 한 번 오너에게 푸시한다. Console 쪽 결제 한도에 먼저 닿으면 다시 보내지 않고 "Anthropic 결제 한도" 알림이 온다.
   - 매달 초 Anthropic Console의 지난달 청구액과 설정 → 관리 → AI 사용량 합계를 비교한다. 차이가 크면 `llm/pricing.ts`의 단가를 고친다. 비용은 넉넉한 단가로 세서, 싼 모델이면 실제 청구보다 한도에 일찍 닿는다. 사람마다 쓰는 양은 AI 크레딧이 정한다 (월 500, 설계서 §11.8).
4. 크레딧을 더 주려면 설정 → 관리 → AI 크레딧 주기에서 사람과 양을 고른다. 보유 크레딧으로 들어가서 다음 달에도 남는다. 돈이 오가지 않는 앱 안 재화라 되돌릴 때는 운영 D1에서 그 지급 줄(`credit_ledger`, kind `grant`)을 지운다.
4. 설정 탭 맨 아래 **AI 사용량**에서 1회 평균 비용을 보고 모델과 한도를 정한다.

### 2-2. 확인 (🙋 직접)

- 설명하기 카드는 그 개념의 1·2단계 카드가 7일 넘게 안정되면 열린다. 바로 보고 싶으면 기록 탭에서 그 개념의 1단계 카드를 끄면 된다.
- 설명을 쓰고 **AI에게 채점 받기** → 5~20초 뒤 문장별 판정과 질문이 나온다. 등급은 직접 누른다.
- 기록 탭 → **대화를 붙여 넣어 카드로 만들기** → 1~3분 뒤 알림이 온다.

### 2-3. Claude Code 플러그인 (🙋 직접, 선택)

터미널(Claude Code)에서 공부할 때도 같은 커넥터로 저장·복습한다. 순서는 [플러그인 README](../plugins/moai/README.md).

```
/plugin marketplace add seungminoh-dev/ai-study-review
/plugin install moai@ai-study-review
```

claude.ai 계정으로 로그인한 Claude Code면 claude.ai의 모아이 커넥터가 그대로 보인다. 아니면 `claude mcp add --transport http --scope user moai https://moai.smoh.dev/mcp` 뒤 `/mcp`에서 로그인한다.

### 2-4. 채팅으로 복습·모의면접 (설정 없음)

커넥터를 켠 claude.ai 채팅에서 "오늘 복습 퀴즈 내줘", "꼬리질문으로 모의면접 해줘"라고 하면 된다. 도구가 3개에서 6개로 늘었으니 claude.ai 커넥터 설정에서 새 도구(`get_review_queue`, `submit_review`, `get_interview_chain`)도 **Always allow**로 바꾼다.

### 2-5. PDF로 카드 만들기 (설정 없음)

- **claude.ai**: 채팅에 PDF를 올리고 "이 PDF로 모아이 카드 만들어줘". Claude가 장별로 나눠 저장한다.
- **Claude Code**: `/moai:pdf ~/Downloads/책.pdf` (범위를 주려면 `/moai:pdf 책.pdf 1-40쪽`).
- 만든 카드는 **자료**로 따로 있다 (기록 탭 → 자료). "이 자료 풀기"로 한 번 풀면 평소 복습과 지식 지도에 들어간다. 잘못 가져왔으면 "안 푼 카드 끄기".

### 2-6. 분류 (설정 없음)

저장할 때 Claude가 분류를 정한다 (예: `인프라/Kubernetes`). 분류가 흩어졌으면 claude.ai에서 "모아이 분류 정리해줘" → 제안을 확인하면 합쳐진다. 개념 화면에서 손으로 고칠 수도 있다.

---

## 3. 평소 운영

### 배포

- `main`에 push하면 🤖 Deploy가 타입 검사 → 빌드 → 테스트 → D1 bookmark 기록 → 마이그레이션 → 배포 → 운영 확인을 한다. CI(타입 검사, 빌드, 테스트)는 따로 돌고, Deploy는 CI를 기다리지 않아서 같은 검사를 스스로 한다.
- 급할 때는 GitHub Actions → Deploy → Run workflow로 직접 돌린다.
- Deploy는 `main`에서만 돈다(다른 브랜치를 골라 손으로 돌려도 건너뛴다). Cloudflare 토큰은 bookmark·마이그레이션·배포 세 단계에만 들어간다. 액션은 커밋 SHA로 고정했고, Dependabot이 주 1회 npm(한 PR로 묶음)과 액션 갱신 PR을 연다.
- 더 막으려면 (🙋 선택): GitHub → Settings → Environments에서 `production`을 만들고 Deployment branches를 `main`만 허용한 뒤, Cloudflare secret 두 개를 그 환경으로 옮기고 deploy 잡에 `environment: production`을 넣는다. 그러면 다른 워크플로에서는 토큰을 읽을 수 없다.

### 배포가 잘못 나갔을 때

"Check production"이 실패했거나 배포 뒤 화면·API가 깨졌으면 Worker를 앞 버전으로 되돌린다 (모두 `apps/worker`에서):

1. `npx wrangler deployments list`로 앞 버전 id를 확인한다.
2. `npx wrangler rollback <앞 버전 id>` (id를 빼면 바로 앞 버전). 몇 초 안에 바뀐다.
3. 원인을 고쳐 `main`에 다시 push한다. 롤백한 상태는 다음 배포가 덮어쓴다.

- 마이그레이션은 열·테이블을 **더하기만** 해서, DB는 그대로 두고 코드만 되돌려도 안전하다. 데이터가 잘못 바뀐 경우만 위 "되돌리기 (D1 Time Travel)"를 쓴다.
- 롤백은 Worker 코드와 정적 파일을 같이 되돌린다. 열려 있던 앱은 다음에 새로 받을 때 앞 버전이 된다.

### 비용

- Workers Paid(월 $5)를 쓴다. 이 규모면 포함량의 1% 남짓이라 추가 요금이 없다고 본다.
- 요청당 CPU는 `limits.cpu_ms`로 1초까지만 쓴다.
- 대시보드 → Manage Account → Billing → Billable Usage → Budget alerts에 $1 알림을 걸어 두면 사용량 요금이 생긴 다음 날 메일이 온다.

### 백업 (🙋 주 1회)

내보낸 파일에는 모든 회원의 학습 기록이 평문으로 들어 있다. **레포 밖**에 만들고 바로 암호화한다.

```bash
cd apps/worker
mkdir -p ~/moai-backups
npx wrangler d1 export moai --remote --output="$HOME/moai-backups/moai-$(date +%F).sql"
# 바로 암호화하고 평문은 지운다 (비밀번호는 비밀번호 관리자에)
openssl enc -aes-256-cbc -pbkdf2 -salt -in ~/moai-backups/moai-$(date +%F).sql -out ~/moai-backups/moai-$(date +%F).sql.enc && rm ~/moai-backups/moai-$(date +%F).sql
```

- 암호화한 파일은 한 곳(개인 컴퓨터의 암호화된 디스크나 비밀번호 관리자 첨부)에만 둔다. 회사 컴퓨터에는 받지 않는다.
- **28일이 지나면 지운다.** 처리방침이 "백업에는 지운 정보가 최대 30일 남는다"고 약속한다.
- 레포 안에서 실수로 만들어도 `.gitignore`의 `moai-*.sql`, `/apps/worker/*.sql`이 막는다. 그래도 레포나 공개 저장소에 올리지 않는다.
- 풀 때: `openssl enc -d -aes-256-cbc -pbkdf2 -in <파일>.sql.enc -out <파일>.sql`

### 되돌리기 (D1 Time Travel)

- Workers Paid라 **30일** 안의 어느 시점으로든 되돌릴 수 있다. Deploy는 마이그레이션 직전에 그때의 bookmark를 로그에 남긴다("Note D1 bookmark" 단계).
- 순서 (모두 `apps/worker`에서):
  1. 되돌릴 시점의 bookmark 확인: `npx wrangler d1 time-travel info moai --timestamp=2026-10-20T09:00:00+09:00` (또는 Deploy 로그의 bookmark)
  2. 지금 상태를 먼저 남긴다: 위 "백업" 순서로 export
  3. 되돌린다: `npx wrangler d1 time-travel restore moai --bookmark=<bookmark>`
- **제자리 복원**이다. 그 시점 뒤의 모든 쓰기(복습, 저장, 가입)가 사라진다. 복원 결과에 나오는 이전 bookmark로 복원 자체를 되돌릴 수 있다.
- 코드만 잘못 나간 것이면 DB는 두고 Worker만 되돌린다 (아래 "배포가 잘못 나갔을 때").

### 상태 확인 (🤖 자동)

- `GET /api/health`는 D1이 응답하고 매분 Cron이 5분 안에 돌았으면 200, 아니면 503이다. Cron은 돌 때마다 `alerts`의 `cron_heartbeat` 행에 시각을 남긴다.
- Deploy의 "Check production"이 배포 직후 200인지 본다. Actions의 **Health** 워크플로가 3시간마다 밖에서 본다(한 달 약 250분). 실패하면 GitHub가 메일을 보낸다.
- 503이면:
  1. 응답의 `db`가 false면 D1 문제다. Cloudflare 대시보드 → D1 → moai 상태와 오류를 본다.
  2. `cron`이 false면 매분 Cron이 멈췄거나 매번 죽는다. 대시보드 → Workers → moai → Triggers에 Cron이 있는지, Logs에서 `cron_failed`·CPU 초과가 나는지 본다. `npx wrangler tail`로 실시간으로 본다.
  3. 코드 문제면 "배포가 잘못 나갔을 때" 순서로 앞 버전으로 되돌린다.
- 알림은 모두 이 Cron이 보내므로, Cron이 멈추면 오너 알림도 오지 않는다. 그래서 밖에서 따로 본다.

### 로그

- 호출 로그(invocation logs)는 끈다. 요청 URL에 커넥터 토큰이 들어 있기 때문이다.
- 직접 남기는 로그는 이벤트 이름, 사용자 ID, 도구 이름, 상태만 남긴다.
- 실시간으로 보려면 `npx wrangler tail`을 쓴다.

### 친구가 기기를 다 잃었을 때

설정 → 초대 → 종류에서 **기기 복구: 이름**을 고르고 코드를 만들어 보낸다. 친구가 GitHub로 계속한 뒤 그 코드를 넣으면 원래 계정으로 들어가고, 잃어버린 기기의 로그인은 끝난다.

### 커넥터 URL이 새었을 때

모아이 앱 설정 → claude.ai 커넥터 → **예전 방식** → **비밀 주소 다시 만들기**(또는 지우기). 이전 URL은 바로 막힌다. 로그인 연결(`/mcp`)로 바꾸는 편이 낫다.

### 모르는 앱이 연결돼 있을 때

모아이 앱 설정 → claude.ai 커넥터 → **연결한 앱**에서 **끊기**. 그 앱의 토큰은 바로 막힌다.

---

## 3.5. OAuth 커넥터 켜기 (한 번만)

### 3.5-1. KV 만들기 (🙋 직접, 로컬 터미널, Cloudflare 로그인 필요)

```bash
cd apps/worker
npx wrangler kv namespace create OAUTH_KV
```

나온 `id`(비밀 아님)를 `wrangler.jsonc`의 `kv_namespaces`에 넣고 `main`에 push한다. 자리 표시 id(`0000…`)가 남아 있으면 Deploy가 멈춘다.

### 3.5-2. claude.ai 커넥터 바꾸기 (🙋 직접, 웹 claude.ai)

1. Customize → Connectors에서 기존 모아이 커넥터(비밀 URL)를 지운다.
2. **Add custom connector** → 이름 `모아이`, URL `https://moai.smoh.dev/mcp`. 연결하면 뜨는 창에서 모아이에 로그인하고 **허용**.
3. 도구 권한은 1-5와 같다 (7개 Always allow, `update_categories`는 Needs approval).
4. 잘 되면 모아이 설정 → **예전 방식** → **비밀 주소 지우기**.

## 4. 로컬 개발

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

## 5. MVP 1이 끝났다는 기준 (설계서 §2.2)

- 14일 중 10일 이상 복습했다.
- 저장한 다음 날 첫 알림이 정한 시각 1분 안에 온다.
- 2주 동안 도구 호출 실패가 0건이다.
- 틀린 카드를 발견하면 그 자리에서 끌 수 있다.
