# 인계: 집 컴퓨터 → 회사 컴퓨터

2026-10-19 작성. 기준은 이 문서가 들어간 `main` 커밋이고, 그 앞 배포는 `5d5621d`(3단계 3-4)다.
처음이면 §0 → §1 → 필요한 절 → [설계서](design.md) → 코드 순으로 본다. 운영 절차는 [운영 가이드](runbook.md), 제품 기획은 [기획서](service-plan.md)에 있다.

> 집 컴퓨터의 Claude 대화 기록과 자동 메모리는 회사 컴퓨터로 옮겨지지 않는다. 그 안에만 있던 사용자 방침과 디자인 결정은 §3, §4에 옮겨 적었다.

---

## 0. 회사 컴퓨터에서 바로 할 일

1. 받고 설치한다:

   ```bash
   git clone https://github.com/seungminoh-dev/ai-study-review.git   # 이미 있으면 git pull origin main
   npm ci                                   # Node 22.12 이상 (Vite 8이 요구한다)
   cp apps/worker/.dev.vars.example apps/worker/.dev.vars
   npm run gen:token                        # 두 번 실행 → TOKEN_PEPPER, BOOTSTRAP_CODE
   npm run gen:vapid                        # VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY
   npm run typecheck && npm run build && npm test
   ```

2. `.dev.vars`에는 **이 컴퓨터용 새 값**만 넣는다. 운영 secret을 회사 컴퓨터에 두지 않는다. 배포는 `main` push → GitHub Actions가 하므로 Cloudflare 로그인도 필요 없다. 운영 D1을 직접 봐야 할 때만 `wrangler login`을 한다.
3. 로컬 DB는 컴퓨터마다 따로다 (`apps/worker/.wrangler`, gitignore). 새 컴퓨터는 빈 DB다.
   - `npm run db:migrate:local`(`0001`~`0013`) → `npm run dev` → http://localhost:8787/setup 에서 로컬 `BOOTSTRAP_CODE`로 오너를 만든다.
   - 시험 데이터: 설정의 커넥터 주소(로컬)로 MCP `save_learning`을 부른다. 견본은 `packages/shared/fixtures/immutable-object.json`이다. §6의 리허설 순서를 그대로 써도 된다.
4. Claude Code 앱의 미리보기 설정 `.claude/launch.json`은 레포에 없다 (`.claude/`는 커밋하지 않는다). 아래 내용으로 다시 만든다:

   ```json
   { "version": "0.0.1", "configurations": [{ "name": "moai-local", "runtimeExecutable": "npm", "runtimeArgs": ["run", "dev"], "port": 8787 }] }
   ```

5. 다음 작업을 사용자와 정한다 (§9). 컴퓨터 화면 폭은 고쳤다 (§1).

---

## 1. 지금 상태

- **운영**: https://moai.smoh.dev. Cloudflare Workers Paid, D1 `moai`, 매분 Cron 1개.
- **배포된 마이그레이션**: `0001`~`0010` (0006: 자료·분류, 0007: 이정표 배지, 0008: 오너 알림, 0009: 복습 묶음 `review_logs.run_id`, 0010: 자료 보여 줄 이름 `material_labels`, 0011: 섹션 보여 줄 이름 `material_part_labels`, 0012: 주간 설문 `survey_answers`). 모두 운영과 비슷한 로컬 데이터로 미리 돌려 보고 올렸다.
- **끝난 기능**: MVP 0~2 전부. MVP 3은 Claude Code 플러그인, 채팅 복습, 확신도, 모의면접 체인, 질문 은행, 베타 지표, 자동 분류, PDF 자료, OAuth 커넥터, 학습·복습 나누기까지다. 표는 [설계서 §2.4](design.md#24-mvp-3-확장-이후).
- **2026-10-18 방향 바꿈**: 친구와 함께하는 기능(리그, 질문 은행, 질문 공유)은 PWA 화면에서 뺐다. 내 성취를 높이는 쪽으로 디자인을 다시 짰다. 2026-10-19에 서버 API(`/api/league`, `/api/shared-questions`)도 지웠다. `shared_questions` 테이블과 데이터는 남겨서 내보내기와 계정 지우기에 그대로 들어간다.
- **디자인 개편** (모두 배포, 원칙은 §4):
  - 2단계 (`f902930`): 마스코트 색, 마스코트 컴포넌트(`apps/web/src/Mascot.tsx`), 선 아이콘(`icons.tsx`), 휴대폰 아래 탭과 컴퓨터 사이드바, "내 성장"(`/growth`). `/api/stats`에 `best_streak`, `last_week_xp`, `history`(84일). 설계서 §12의 화면 목록은 2026-10-19에 지금 화면으로 고쳤다.
  - 아이콘 (`21de944`): 앱 아이콘·파비콘·알림 배지를 마스코트로 (`npm run gen:icons`). 다크 모드 마스코트 테두리는 먹색.
  - 3-1 모션·마스코트 (`371913d`):
    - Motion(`motion` 13.5.1, 정확한 버전 고정)을 CSS와 섞어 쓴다. 기능 묶음(`motion-features.ts`, domMax)은 첫 화면 뒤에 따로 받는다.
    - 마스코트 포즈 10가지와 깜빡임·숨쉬기 같은 움직임(`styles.css`의 `.mascot.alive`).
    - 누르는 버튼, 카드 hover, 탭 알약(`layoutId`), 화면 전환(`router.tsx`의 `show`, View Transitions).
    - 복습 카드 넘김·확신도·답 시트(`AnimatePresence`), 불러오는 중 뼈대(`Loading.tsx`), 끝 화면 꽃가루와 XP 세기(`Confetti.tsx`, `useCountUp`).
    - 사라지는 카드는 `Presence`가 inert로 막고, 기록 함수는 지금 카드가 아니면 무시한다 (같은 답이 두 번 기록되던 문제).
  - 3-2 랜딩·로그인·가입·시작 가이드 (`f754c3a`):
    - 로그인하지 않으면 `/`가 공개 랜딩(`Landing.tsx`)이다. 체험 카드 3장(`cards/DemoDeck.tsx`)은 기기 안에서만 돈다.
    - 로그인은 `/login`. 서버가 GitHub 실패로 `/?auth=`에 돌려보내면 로그인 화면이 이유와 함께 뜬다. 가입(`/join`)을 마치면 시작 가이드(`/welcome`).
    - 시작 가이드: 설치(`install.ts`가 `beforeinstallprompt`를 잡아 둔다), 연결 주소(있으면 새로 만들지 않고 가려서 보여 준다), 첫 저장(이 단계를 보는 동안만 5초마다 확인), 알림(기존 시간은 두고 더한다).
    - 로그인 뒤 큰 화면은 `App.tsx`의 `lazyScreen`으로 따로 받고, 로그인하면 쉬는 틈에 미리 받는다.
  - 3-3 자료 (`6338b81`): 마이그레이션 없이 `learning_sessions.material`/`material_part`로 묶는다.
    - 섹션 순서는 이름 끝 쪽수(`(p.3–21)`) 순, 없으면 저장한 순서 (`packages/shared/src/material.ts`의 `comparePart`). "5. 상속"처럼 번호로 시작하면 그 번호를 배지에 쓴다 (`apps/web/src/materials.ts`의 `partView`).
    - `GET /api/materials`의 `next`, `GET /api/materials/detail?title=`(섹션별 진행·개념·미리보기), `GET /api/queue?material=&part=`(섹션만).
    - 자료 목록(`Materials.tsx`), 자료 상세(`MaterialDetail.tsx`, 휴대폰은 펼침·컴퓨터는 두 칸), 휴대폰 기록 탭의 "공부한 대화 | 자료"(`RecordsNav.tsx`).
  - 3-4 승인한 추가 항목 (`5d5621d`):
    - 글꼴: Pretendard 1.3.9 가변 글꼴의 글자 범위별 조각(92개, 3.1MB)을 `apps/web/src/fonts/pretendard`에 넣었다 (OFL, `LICENSE.txt` 같이 둠). 화면에 나온 글자의 조각만 받고, 서비스 워커는 글꼴을 미리 받지 않는다. `_headers`가 `/assets/*`(해시가 붙은 파일)를 1년 캐시한다.
    - 링크 미리보기: `index.html`의 Open Graph·Twitter 태그와 `public/og.png`(1200×630, `npm run gen:icons`가 같이 만든다). 크롤러는 JS를 안 돌려서 모든 주소가 같은 미리보기다.
    - 개인정보 처리방침·약관: `/privacy`, `/terms` (`screens/Legal.tsx`, 로그인 전에도 열림). 랜딩 아래, 가입 화면, 설정 맨 아래에 링크. 책임자 seungminoh-dev, 문의 contact@smoh.dev, 시행일 2026-10-19 (`Legal.tsx` 맨 위 상수). 저장하는 정보나 외부 서비스가 바뀌면 같이 고친다.
    - LEVEL UP: `POST /api/reviews`가 `level_ups`(다음 단계가 열린 개념과 단계)를 준다. PWA는 답을 보낼 때 모아 두었다가(`offline/store.ts`의 `takeLevelUps`) 끝 화면에 보여 준다. 설명하기 통과도 같이 보인다. 2026-10-19부터 IndexedDB(`level-ups`)에 남겨서, 앱을 다시 열거나 오프라인 답을 나중에 보내도 다음 끝 화면이나 오늘 화면(LEVEL UP 카드)에 나온다.
    - 이정표 배지 11개: 설계서 §5.7. `/api/stats`의 `badges`, 내 성장의 이정표 선반, 오늘 화면과 끝 화면의 새 배지 축하 (`badges.tsx`, 기기마다 한 번).
    - 컴퓨터 개념 패널: 1024px 이상 복습 화면 오른쪽 (`cards/ConceptPanel.tsx`, 기존 `GET /api/concepts/:key`). 정답이 될 수 있는 내 정리·지난 설명은 답을 고른 뒤(설명하기는 비교를 펼친 뒤)에 연다.
  - AI 개념 채팅 1차 (2026-10-19, 3단계 캔버스 맨 아래 줄 시안):
    - 복습에서 답을 고른 문제의 개념을 AI에게 묻는다. 처음에는 틀린 문제만이었고, 반반·찍어서 맞힌 답, 2026-10-19부터 확실히 맞힌 답(해설 아래 작은 링크)과 연습·시험도 연다. 휴대폰은 답 아래 "이 개념 물어보기" → 아래에서 올라오는 시트, 컴퓨터는 개념 패널의 "개념 | 물어보기" 탭(A 키). 추천 질문 3개(왜 틀렸나·예시·차이)나 직접 질문.
    - `POST /api/cards/:id/ask` (`llm/ask.ts`)가 요청 안에서 바로 답한다. 카드·보기·정답·해설·내 정리는 서버가 DB에서 읽고, 앞서 주고받은 두 번까지 같이 보낸다. 질문과 답은 저장하지 않는다.
    - 한도: 질문 하나에 AI 크레딧 1 + 서비스 전체 예산 가드. 답이 오면 실제 비용으로 바꾸고, 청구되지 않은 실패는 비용 기록을 지우고 크레딧을 돌려준다.
    - 서버 AI 키(`ANTHROPIC_API_KEY`, `GRADER_MODEL`)가 없으면 버튼과 탭이 보이지 않는다.
  - 앱 안 모의면접 (2026-10-19, `/interview`, `llm/interview.ts`): 오늘 화면 카드와 개념 상세의 "이 개념으로 모의면접"에서 연다. 순서는 MCP `get_interview_chain`과 같고(흔들리는 개념 → 연결선), 개념마다 두 번쯤, 한 번에 8개까지 묻는다. 끝나면 잘한 점·고칠 점을 정리하고, "판정과 카드로 기록하기"는 대화를 가져오기 작업으로 넣는다(판정 said는 사용자 답 원문). 대화는 기기만 들고 있다. 한도: 질문 하나에 AI 크레딧 1, 기록하기는 5 + 예산. 머리(진행·제목)는 위에 붙고, 입력 칸은 면접이 끝날 때까지 아래에 둔다(보내는 동안 없애면 페이지가 짧아져 맨 위로 튀었다). 새 말이 오면 문서 끝까지 내린다.
  - 요청 안에서 바로 답하는 서버 AI(개념 채팅·모의면접)는 `llm/metered.ts`의 `meteredCall`을 같이 쓴다: 예산 → 크레딧 쓰기(세기와 한 문장) → 예상 비용 적기 → 호출 → 실제 비용으로 고치기.
  - AI 개념 채팅 2차 (2026-10-19): 대화 아래 "이 대화로 카드 만들기" → `POST /api/cards/:id/ask/cards`가 개념 key·원래 카드·주고받은 말(6번까지)을 붙여넣기 가져오기 작업(`llm_jobs` kind `import`)으로 넣는다. 매분 Cron이 만들고 끝나면 푸시로 알린다. 같은 대화는 같은 작업이고, 예산·대기 3개 한도도 가져오기와 같다.
  - 오너 알림 (2026-10-19, `0008_alerts.sql`): 처리하지 못한 서버 오류, 매분 작업 실패, AI 호출 실패를 `alerts`에 세어 두고, 매분 Cron이 종류마다 한 시간에 한 번 오너에게 푸시한다(`domain/alerts.ts`). 오너 기기에 알림이 켜져 있어야 받는다. 자세한 내용은 Cloudflare 로그에서 본다.
  - 개선 후보 묶음 (2026-10-19, 시안 없이 사용자 승인):
    - 오프라인이면 화면 위에 한 줄 안내(`App.tsx`의 `useOnline`, 복습 화면은 원래 안내가 있어 뺀다).
    - 되돌리기: 처음에는 다음 카드 위에 뜨는 토스트("답을 기록했어요 · 되돌리기")였는데, 매번 떠서 불편하다는 의견으로 2026-10-19에 복습 화면 위 막대 오른쪽의 ↶ 버튼으로 바꿨다. 다음 카드에서 고르기 전까지 누를 수 있고, 그 뒤에는 끝 화면에서 마지막 답을 되돌린다.
    - 설정 → 화면: 밝게·어둡게·기기 설정 따르기(`prefs.ts`, html `data-theme`, 주소창 색도 맞춘다). `styles.css`의 다크 토큰은 기기 설정용과 직접 고른 것용 두 벌이라 같이 고친다. 진동 켜기·끄기(휴대폰만, 맞음·틀림과 목표 달성·LEVEL UP).
    - 매니페스트 `shortcuts`(복습·지도·성장)와 설치 창 `screenshots`(`public/screenshots/*.webp`, 서비스 워커는 미리 받지 않는다). 다시 찍기: `node scripts/gen-screenshots.mjs` (로컬 서버·시험 데이터·Chrome 필요).
    - 전역 `.done`이 완료 표시(시작하기 체크리스트, 가입 단계, 자료 표지)에도 위 여백을 줘서 간격이 들쭉날쭉하던 것을 `.screen.done`으로 좁혔다.
  - 다듬기 (2026-10-19): AI 개념 채팅 답은 2~4문장으로 짧게. 물어보기는 찍음·반반으로 맞힌 문제(이때 "너무 쉬웠어요"는 등급을 못 바꿔서 숨긴다)와 설명하기 비교 뒤에도 열린다(내 설명을 같이 보낸다). 끝 화면의 얻은 XP·연속 +1은 시작과 끝의 `/api/stats` 차이로 낸다(못 보낸 답이 있으면 어림). 지식 지도 배치는 Web Worker(`map/layout.worker.ts`)에서 하고 창 비율이 바뀌면 다시 배치한다. 처음 설치되는 동안 연 화면도 다음 배포 때 새로고침된다(`main.tsx`).
  - 세션 만료와 빈 화면 (2026-10-19): 쓰는 도중 API가 401을 주면 `/login?auth=session`으로 보낸다(`api.ts`의 `onUnauthorized`, App이 로그인한 동안 정한다). 못 보낸 답은 기기에 남는다. 화면을 그리다 오류가 나면 그 화면 자리에 새로고침 안내를 보여 준다(`ErrorBoundary.tsx`, 화면 주소마다 따로).
  - OAuth 커넥터 (2026-10-19, 설계서 §8.7): 커넥터 주소가 모두 같은 `/mcp`이고, 추가하면 모아이 로그인·허용 화면(`auth/authorize.ts`)이 뜬다. 설정에 연결한 앱 목록과 끊기, 시작 가이드 2단계도 이 주소다. 비밀 URL은 설정의 "예전 방식"에 접어 두었다. KV `OAUTH_KV`가 있어야 배포된다.
  - 학습·복습 나누기 (2026-10-19, 4단계 시안 "모아이 4단계 디자인 시안", 설계서 §9.2·§9.6·§12.1):
    - 기준: 학습 = PDF 자료에서 아직 안 푼 카드, 복습 = 대화에서 온 카드와 한 번이라도 푼 카드. 서버의 오늘 큐는 원래 안 푼 자료 카드를 넣지 않았다.
    - 탭: 휴대폰 아래 탭과 컴퓨터 사이드바가 오늘·학습(`/learn`)·복습(`/reviews`)·지도·성장이다. 자료 화면은 학습, 공부한 대화는 복습에 속한다. 예전 기록 탭의 "공부한 대화 | 자료" 나누기(`RecordsNav`)는 지웠다.
    - 오늘: 복습 카드(틀린 것·다시 볼 때·대화 새 카드, `GET /api/today`의 `parts`)와 학습 카드(다음 섹션)를 나란히, 연속 카드에 다음 연속 목표(3·7·14·30·60·100·365일), 오늘 목표 링을 복습·학습으로 나눠 칠한다(`/api/stats`의 `today.learned`). 분류별 진행·내 성장 요약·최근 12주는 복습 탭과 내 성장으로 옮겼다.
    - 학습 탭(`screens/Learn.tsx`): 2026-10-19 5단계 시안으로 다시 짰다. 아래 "학습 탭 정보 위계와 언덕 머리".
    - 복습 탭: 오늘 복습, 틀린 것(`GET /api/queue?mode=mistakes`: 최근 30일 안에 마지막 답이 틀린 카드, 오늘 푼 것 빼고, 다시 푼 답은 기록), 분류별, 모의면접, 공부한 대화(`screens/Reviews.tsx`).
    - 무실수 보너스: 복습 화면마다 `run_id`를 답에 붙이고, 5장 이상 모두 맞힌 묶음에 +10 XP(`domain/stats.ts`, 기록에서 센다). 끝 화면에 PERFECT 배너, 다음 연속 목표, "학습도 이어서 할까요?".
  - 학습 탭 정보 위계와 언덕 머리 (2026-10-19, 디자인 캔버스 5단계 줄 시안 `LearnV2`, `LearnV2Desktop`, `Backgrounds` C):
    - 학습 탭: 제목이 자료 이름이고 "학습 · 자료 n개"는 머리말, 자료가 둘 이상이면 "자료 바꾸기". 섹션 진행 막대. 맨 위 남색 카드(`.hero`를 같이 쓴다)가 지금 할 섹션·개념·"이어서 학습". 섹션은 지그재그 길 대신 한 줄 타임라인(노드를 세로선으로 잇고 상태는 알약)이고, 누르면 그 자리에서 펼쳐 개념·학습하기·시험·이름 바꾸기(`EditableTitle`의 `bare`). 맨 아래 자료 전체 랜덤 시험·자료 관리. 컴퓨터(1024px~)는 두 칸 그리드이고 `/learn`도 넓은 화면(1120px)이다.
    - 배경 C "언덕 머리": 오늘 화면 머리에만 픽셀 하늘·언덕(`Today.tsx`의 `Hills`, 96×38 그림을 4배로 키워 SVG pattern으로 가로로 이어 붙임). 휴대폰은 화면 끝까지 붙이고, 그보다 넓으면 둥근 띠. 색은 `--sky`, `--hill-far`, `--hill-near` 등이고 다크 모드는 밤하늘·짙은 언덕이다. 다른 탭에는 아직 넣지 않았다.
  - 학습은 안 푼 카드만 (2026-10-19, 사용자 신고): 자료 학습 큐(`loadMaterialQueue`, 학습 탭·자료 풀기·채팅 `get_review_queue({ material })`)가 "그 자료에서 풀 때가 된 카드"를 먼저 줘서, 반반·찍음·틀림으로 답한 카드(몇 분 뒤 다시 풀 때가 됨)가 다음 학습에 또 나왔다. 이제 한 번도 안 푼 카드(`state = 0`)만 저장한 순서대로 주고, 한 번 푼 카드는 확신도와 상관없이 오늘 복습으로 간다.
  - 위 진행 막대 (2026-10-19): 복습과 모의면접의 막대가 "답한 수"로 차서 6/10일 때 50%였다. 숫자와 같은 "지금 번호"로 채운다.
  - 지금 이어서 볼 자료 (2026-10-19, 사용자 신고 "자료가 하나로 고정됨"): 오늘 화면의 학습 카드, 학습 탭의 기본 자료, 복습 끝 화면의 "학습도 이어서"가 모두 "새 카드가 남은 첫 자료"를 골라서 다른 자료를 고르거나 풀어도 돌아오면 첫 자료로 돌아갔다. 이제 `materials.ts`의 `currentMaterial`이 이 기기에서 마지막으로 고른 자료(학습 탭 자료 바꾸기, 자료 상세, 자료 풀기 시작: `localStorage` `moai:material`, 로그아웃하면 지움)와 어느 기기에서든 마지막으로 푼 자료(`/api/materials`의 `studied_at`) 중 더 최근 것을 고른다.
  - AI 첫 안내 (2026-10-19): 채팅·면접 아래의 "질문 한 번에 1 크레딧 · 남은 크레딧 · 틀릴 수 있어요" 줄을 빼고, 처음 한 번만 안내 카드를 띄운다(`AskConcept.tsx`의 `useAiNotice`, 개념 물어보기·모의면접·AI 채점이 같이 쓴다).
  - AI 크레딧과 숨은 업적 (2026-10-19, 설계서 §11.8, `0013_credits.sql`):
    - 기능별 횟수 한도(물어보기 월 50, 면접 월 80)와 사람별 달러 한도를 빼고 앱 안 재화로 바꿨다. 결제는 없다. 월간 500(매달 1일 KST에 다시 참, 안 넘어감) + 보유(숨은 업적·오너 지급, 계속 남음). 물어보기·면접 질문·AI 채점 1, 카드 만들기 5, 붙여넣기 10. 월간부터 쓴다. AI 비용이 들지 않은 실패만 돌려준다(비용이 든 실패는 그대로, 예산을 지키려고).
    - 서버: `domain/credits.ts`(원장 `credit_ledger`, 남은 양을 세는 식, 쓰기·돌려주기), `llm/jobs.ts`의 `createJob`이 작업과 크레딧을 같은 batch로, `llm/metered.ts`가 요청 안 호출. 서비스 전체 한도(`LLM_MONTHLY_CAP_USD`, 기본 90)는 운영자 지갑 안전장치로 남겼다.
    - 화면: 엽전 칩(휴대폰은 오늘 화면 머리 오른쪽 위, 컴퓨터는 사이드바 설정 위)과 크레딧 화면 `/credits`(`screens/Credits.tsx`, 도트 그림은 `credits.tsx`의 글자 지도, 색은 `.px-*`). 2026-10-19 사용자 요청으로 설정에서 꺼냈다(캔버스 6단계 줄 A안). 오너 설정의 "AI 크레딧 주기"(`GET/POST /api/admin/credits`)는 그대로.
    - 숨은 업적 15개(`domain/achievements.ts`): 조건은 서버에만 있고, 화면에는 이룬 것만 내려간다. `/api/stats`를 볼 때 확인해서 보상을 보유 크레딧으로 준다(업적마다 한 번). 내 성장의 "숨은 업적", 오늘·끝 화면의 발견 축하(기기마다 한 번).
    - 효과음(`sound.ts`, Web Audio로 만든 짧은 음, 파일 없음): 맞음·틀림, 끝 화면(무실수 > 레벨 업 > 목표 달성 중 하나), 숨은 업적. 설정 → 화면과 소리에서 끈다(기본 켬). iPhone은 무음 스위치를 따른다(`audioSession` ambient).
    - 작은 움직임(동작 줄이기면 멈춤): 정답 옆 +10 XP, 오늘 화면 카드가 차례로 올라옴, 퀘스트 막대 차오름·체크 튀기, 목표를 채운 날 불꽃 살랑임.
    - 약관 6조(AI 크레딧과 숨은 업적)와 처리방침 항목을 더했다.
  - 베타 지표와 주간 설문 (2026-10-19, 기획서 §13):
    - 오너 설정의 베타 지표 아래 "참고 지표": 14일 유지율(가입 14일 넘은 사람 중 14일째부터 복습한 사람), 저장 → 첫 복습(하루 넘게 지난 대화 저장 중 카드를 한 장이라도 푼 저장, 자료 저장은 뺀다), 카드마다 2회차·5회차 답의 정답률. 목표가 정해지지 않아 ✓/✗ 없이 보여 준다(`GET /api/admin/metrics`).
    - 주간 설문 "이번 주 면접이나 공부에서 써먹은 개념이 있나요?": 가입 3일이 넘었고 이번 주(월요일, 04:00 KST 경계)에 아직 답하지 않았으면 오늘 화면에 뜬다. "있어요"면 어떤 개념인지 적을 수 있다(선택). "다음에"는 그 주 동안 이 기기에서 숨긴다(`localStorage`). `GET/PUT /api/survey`, `survey_answers`(사람마다 한 주에 하나). 오너 화면에 최근 4주의 답 수, 써먹은 수, 적은 개념. 내보내기와 계정 지우기에 들어간다.
  - 기능 묶음 (2026-10-19, 시안 없이 사용자가 맡김):
    - 분류 관리(`/categories`, 지식 지도·복습 탭에서 연다): 큰 분류까지 트리로 보여 주고, 분류를 옮기거나 이름을 바꾼다. 이미 있는 이름이면 합쳐진다. 먼저 미리 보기(`POST /api/categories/rename`의 `dry_run`)로 옮길 분류와 단계가 합쳐지는 이동을 보여 준다. 채팅의 `update_categories`와 같은 함수다.
    - 오늘의 퀘스트(`packages/shared/src/quests.ts`): 카드 10장 풀기, 무실수 복습 1번, 새 카드 5장 학습 또는 설명하기 1장. 하나에 +10 XP. 매일 같은 세 가지라 기록에서 날마다 다시 센다(`domain/stats.ts`의 `questOf`). 오늘 화면 오른쪽 칸.
    - 랜덤 시험(`/review?mode=random`, 서버 `loadRandom`): 한 번이라도 푼 카드에서 10문제, 설명하기 빼고. 자료·섹션·분류로 좁힌다. 연습이라 기록하지 않고(확신도도 묻지 않는다) 끝 화면에 점수. 학습 탭(이 섹션·자료 전체)과 복습 탭에서 연다.
    - 오프라인 학습: 자료 섹션을 열면 그 카드를 IndexedDB(`material-queues`, 최근 6개, 일주일)에 남기고, 학습 탭은 이어서 할 섹션을 미리 받아 둔다. 오프라인이면 그 섹션을 이어서 풀고, 학습 탭에 "기기에 받아 둔 섹션"이 나온다.
  - 작은 묶음 (2026-10-19):
    - 섹션 이름 바꾸기: 학습 탭에서 섹션을 펼친 곳의 "이름 바꾸기". 자료 이름과 같은 방식으로 원래 섹션 이름(복습 주소의 `part`)은 두고 `material_part_labels`에 보여 줄 이름만 둔다(`PUT /api/materials/part-label`). API의 자료에 `part_labels`(원래 이름 → 바꾼 이름)가 있고, 화면은 `partView(name, index, label)`로 그린다.
    - 화면 글의 "claude.ai"는 "클로드"로 바꿨다. 커넥터를 추가·삭제하거나 주소를 붙여 넣는 것처럼 웹사이트에 들어가서 하는 안내와 실제 링크만 "claude.ai"로 둔다.
    - 랜딩에 "광고도, 다른 회사로 보내는 추적도 없어요". 태블릿(700~1023px) 오늘 화면은 복습·학습 카드를 나란히.
    - Deploy 마지막 단계 "Check production": 운영 화면 JS가 이번 빌드와 같은지(최대 1분 기다림), 그 파일·OAuth 메타데이터 200, `/api/me`·`/mcp` 401을 본다.
    - 운영 분류: `DevOps`를 `인프라/DevOps` 아래로 옮겼다(자료 개념 42개). 큰 분류는 백엔드·CS·인프라·AI다.
  - 이름 바꾸기와 정답 가리기 (2026-10-19):
    - 자료 상세와 저장한 대화 상세의 제목 옆 "이름 바꾸기"(`EditableTitle.tsx`). 대화는 `PATCH /api/sessions/:id`가 topic을 바꾼다. 자료는 원래 이름(`learning_sessions.material`)을 그대로 두고 보여 줄 이름만 `material_labels`에 둔다(`PUT /api/materials/label`, 비우면 원래 이름). 그래서 Claude가 같은 PDF의 다음 장을 원래 이름으로 저장해도 같은 자료로 모인다. API의 자료에 `name`, 저장 목록에 `material_name`이 있다.
    - 개념 이름이 곧 정답인 문제가 많아서, 복습 카드의 개념 칩과 컴퓨터 개념 패널의 이름은 답한 뒤에 보여 준다(설명하기는 문제에 이름이 있어 그대로). 복습 탭 "틀린 것" 목록도 문제만 보여 준다. 채팅 복습 안내(MCP)에도 개념 이름을 먼저 말하지 말라고 적었다.
    - 복습 탭의 "공부한 대화"는 대화만 보여 준다. 자료 섹션은 학습 탭에 있다.
  - 컴퓨터 화면 폭 (2026-10-19): `.app`이 `.shell` 그리드 칸에서 내용 폭으로 줄던 것을 `width: 100%`로 고쳤다. 이제 화면마다 760px(넓은 화면 1120px)까지 칸을 채운다. 내 성장은 오늘 화면처럼 두 칸(왼쪽 이정표·분류별 진행, 오른쪽 최근 12주)이고, 최근 12주 히트맵은 컴퓨터에서 칸 폭에 맞춰 날짜 칸을 키운다. 휴대폰은 그대로다.
- **테스트**: worker 159개, web 4개(`src/offline/store.test.ts`, fake-indexeddb), shared 23개 통과. CI·Deploy 모두 초록.
- **브랜치**: `main`만 쓴다. 열린 PR은 없다.
- **확인 못 한 것**:
  1. 실제 카톡 링크 미리보기. 주소를 한 번 보내 본다. 예전 미리보기가 캐시돼 있으면 카카오 개발자 사이트의 공유 디버거로 지운다.
  2. 움직임 자체. 확인용 브라우저 패널이 동작 줄이기 상태이거나 숨겨져 있었다. 보이는 브라우저에서 복습 한 번, 끝 화면 한 번을 본다.
  3. 실제 GitHub 초대 가입 흐름, iPhone 설치 안내, 운영의 실제 PDF 자료(섹션 15개) 화면.
  4. 휴대폰에서 효과음 크기와 느낌. 로컬 브라우저에서는 소리를 들어 볼 수 없었다.

---

## 2. 로컬 개발 메모

- `npm test` 전에 `npm run build`가 있어야 한다. Worker 테스트가 `apps/web/dist`를 읽는다.
- `wrangler` 명령은 **`apps/worker` 폴더에서** 실행한다. 레포 루트에서는 "Required Worker name missing"이 난다.
- 로컬 서버는 `npm run dev`(= `wrangler dev --local-upstream localhost:8787`). 화면만 고칠 때는 `npm run dev:web` (Vite가 `/api`, `/mcp`를 8787로 넘긴다).
- 로그아웃·로그인을 시험할 때: 로그인한 상태에서 `POST /api/login-codes`로 코드를 받고, 로그아웃(`POST /api/auth/logout`) 뒤 `/login`에 넣는다. 코드는 10분·한 번.
- 마스코트 그림을 바꾸면 `scripts/gen-icons.mjs`의 `ART`도 고치고 `npm run gen:icons`를 돌린다 (같은 입력이면 같은 파일이 나온다).

---

## 3. 사용자 방침 (꼭 지킨다)

- 답은 **한국어 해요체로 짧게**. 진행 상황, 요약, 질문, 버튼 글도 한국어다. 코드·명령·경로는 원래 표기 그대로.
- **테스트는 되돌릴 수 없는 주요 작업만** 한다: 마이그레이션, 삭제, 비용·예산, 데이터 상태를 바꾸는 일. 전부 테스트하지 않는다.
- **운영 서비스라 배포 전에 항상 보안 점검**을 한다 (IDOR, 인증 우회, 비밀값 노출, 프롬프트 주입, 비용 폭주). 찾은 것은 고친 뒤 배포한다.
- 커밋·push는 사용자가 요청할 때 한다. **PR 없이 `main`에 바로** 올린다 (PR은 요청할 때만). push 뒤에는 CI·Deploy 결과와 운영 확인 결과를 알려 준다.
- 디자인을 바꿀 때는 **시안부터** 보여 주고 승인받는다 (§4의 캔버스).
- 비밀값:
  - `TOKEN_PEPPER`, `BOOTSTRAP_CODE`, `VAPID_PRIVATE_KEY`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `ANTHROPIC_API_KEY`, `GRADER_MODEL`은 `wrangler secret put`으로만 넣는다. 레포·로그·채팅에 남기지 않는다.
  - `.dev.vars`는 gitignore돼 있다. 커밋하지 않는다.
  - 서버 Anthropic 키는 브라우저와 로그로 절대 보내지 않는다.
  - 토큰·코드는 `HMAC(TOKEN_PEPPER)` 해시로만 저장하고 로그에 남기지 않는다.
  - **커넥터 URL은 비밀번호다.** 레포나 공유 `.mcp.json`에 넣지 않는다. MCP URL에 토큰이 들어 있어서 `invocation_logs`는 꺼 둔다 (켜지 않는다).
- 커밋, 코드 주석, 문서에 **모델 ID를 쓰지 않는다**. 모델은 `GRADER_MODEL` secret으로만 정한다.
- 사용자 이메일을 외부 서비스로 보내지 않는다.

---

## 4. 디자인 원칙과 결정

- **색**: 마스코트에서 가져온다. 남색(#192849) 글자·주요 버튼, 주황(#ff914d) 진행·강조, 크림(#fff0c7) 선택·칩, 초록 익숙함. 다크 모드에서는 남색 버튼이 묻혀서 주요 버튼을 주황(남색 글자)으로 바꾼다. 토큰은 `styles.css` 맨 위.
- **마스코트**: 16×14 픽셀 격자의 주황 캐릭터, 포즈 10가지(`Mascot.tsx`). 다크 모드 테두리는 배경보다 어두운 먹색(#070b14)이다. **밝은·흰 테두리는 쓰지 않는다** (사용자가 "작위적"이라고 했다). `? ! … z` 같은 몸 밖 표시만 크림 토큰을 쓴다. 남색 바탕 위 마스코트도 먹색 테두리.
- **모션**: 사라짐·레이아웃·스프링만 Motion, 나머지는 CSS. 동작 줄이기를 켜면 자리를 옮기는 움직임만 멈추고 투명도와 깜빡임은 남긴다. 새 움직임 CSS는 `@media (prefers-reduced-motion: no-preference)` 안에 둔다.
- **글꼴**: 앱은 Pretendard. 캔버스 시안은 Google Fonts만 쓸 수 있어서 Noto Sans KR + 숫자 배지에 Silkscreen이다.
- **화면 구조**: 휴대폰 아래 탭(오늘·학습·복습·지도·성장, 설정은 오늘 화면 오른쪽 위, 자료는 학습 탭, 공부한 대화는 복습 탭 안), 컴퓨터(1024px 이상)는 왼쪽 사이드바. 복습과 시작 가이드는 메뉴 없이 집중한다.
- **시안**: claude.ai 아티팩트 "모아이 2단계 디자인 시안", "모아이 3단계 디자인 시안", "모아이 4단계 디자인 시안"(학습·복습 나누기, 디자인 캔버스). 같은 계정이면 어느 컴퓨터에서나 열리고, Claude Code의 아티팩트 목록으로 찾는다. 3단계 캔버스 맨 아래 줄이 AI 개념 채팅 시안(휴대폰·컴퓨터)이다.
- **개선 후보**: 오류·오프라인 화면, 되돌리기 토스트, 다크 모드 직접 고르기, 진동 피드백, 앱 바로가기·설치 미리보기는 2026-10-19에 모두 만들었다 (§1).
- 마스코트 원본(사용자가 만든 상황 시트 svg)은 집 컴퓨터에만 있다. 지금 그림의 기준은 `Mascot.tsx`다.

---

## 5. 저장소 지도

| 경로 | 내용 |
|---|---|
| `apps/worker/src/api/` | PWA용 REST (Hono). `app.ts`가 라우트를 모은다. 공개 경로는 `/api/auth/*`, `/api/health`, `/api/setup`뿐이다 |
| `apps/worker/src/domain/` | 도메인 로직: `save-learning`, `queue`(오늘 큐·자료 큐), `reviews`(기록·낙관적 잠금·사다리·LEVEL UP), `ladder`, `concepts`(상태), `categories`(분류·별칭·매시 보정), `chat-review`, `interview`, `map`, `stats`, `badges` |
| `apps/worker/src/mcp/` | MCP 서버. 도구 8개는 `server.ts`, 서버 지침·도구 설명은 `descriptions.ko.ts` |
| `apps/worker/src/llm/` | 서버 AI: `anthropic.ts`(`callClaude`), `budget.ts`(`overBudget`), 작업 테이블(`jobs.ts`), 단가, 프롬프트 |
| `apps/worker/src/cron.ts` | 매분: 알림 → AI 작업. 매시 0분: 만료 정리, `repairLibrary` |
| `apps/worker/migrations/` | D1 마이그레이션 `0001`~`0012` |
| `apps/web/src/` | PWA (Vite·React). `screens/`, `cards/`(문제·설명하기·체험·개념 패널), `badges.tsx`, `motion.tsx`, 오프라인 답안함 `offline/store`, 글꼴 `fonts/` |
| `packages/shared/src/` | zod 스키마와 공용 규칙: `save-learning`, `api`, `grading`, `category`, `material`, `badges`, `llm` |
| `plugins/moai/` | Claude Code 플러그인 (0.2.0): `/moai:coach`, `capture`, `review`, `pdf`. 마켓플레이스는 루트 `.claude-plugin/marketplace.json` |
| `scripts/` | 키 생성, 아이콘·미리보기 그림(`gen-icons.mjs`), 부하 재생 |
| `docs/` | `design.md` 설계서, `runbook.md` 운영, `service-plan.md` 기획서, `adr/` |

---

## 6. 배포와 마이그레이션

- `main`에 push하면 **Deploy**가 `npm ci` → 빌드 → 테스트 → `wrangler d1 migrations apply moai --remote` → `wrangler deploy` → 운영 확인(화면 JS 일치, 401 등)을 한다. GitHub 저장소 secret(`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`)은 이미 들어 있다. **CI**는 `main`·`claude/**` push마다 돈다. 결과는 `gh run list`, `gh run view <id> --log`로 본다.
- 마이그레이션은 **열·테이블 추가만** 한다. 기존 행을 바꾸는 UPDATE가 필요하면 결과를 미리 확인한다.
- **업그레이드 테스트 (🤖 자동, 2026-10-20)**: `test/migrations.test.ts`가 테스트용 두 번째 D1(`UPGRADE_DB`)에 마지막 마이그레이션 직전까지 적용하고, 지금 코드(`saveLearning`, `recordReviews`)로 데이터를 채운 뒤 마지막 마이그레이션을 얹는다. 외래 키 검사가 비어 있는지, 있던 테이블의 행 수가 그대로인지 본다. 채우는 코드가 새 마이그레이션의 열·테이블을 쓰기 시작하면 이 테스트가 깨지니, 그때는 채우는 단계를 직전 모양에 맞춘다.
- **운영 비슷한 데이터로 미리 돌려 보기** (기존 행을 바꾸는 마이그레이션이 있을 때. 열·테이블을 더하기만 하면 위 업그레이드 테스트로 충분하다):
  1. 지금 배포된 코드를 따로 꺼낸다: `git worktree add ../moai-deployed origin/main` (머지 전 기준). 거기서 `npm ci`와 `npm run build`를 하고, `apps/worker/.dev.vars`를 복사해 둔다.
  2. 빈 폴더를 정해 그 코드로 띄운다: `cd ../moai-deployed/apps/worker && npx wrangler d1 migrations apply moai --local --persist-to <폴더>` → `npx wrangler dev --local-upstream localhost:8787 --persist-to <폴더>`. `--local-upstream`이 없으면 wrangler가 Host와 Origin을 운영 주소로 바꿔서 API가 403(wrong_origin), MCP가 421을 준다.
  3. API로 데이터를 채운다:
     - `POST /api/setup`으로 오너를 만든다 (Origin 헤더 필요).
     - `POST /api/mcp-token`으로 커넥터 URL을 받는다.
     - MCP `tools/call`로 `save_learning`을 부른다. 견본은 `packages/shared/fixtures/immutable-object.json`이다.
     - `POST /api/reviews`, `PUT /api/reminders`, `POST /api/invites`도 부른다.
  4. 서버를 끄고, 새 코드 폴더(`apps/worker`)에서 같은 `<폴더>`로 `wrangler d1 migrations apply moai --local --persist-to <폴더>`.
  5. `npx wrangler d1 execute DB --local --persist-to <폴더> --command "PRAGMA foreign_key_check"`가 비어 있는지, 행 수가 그대로인지 보고, 새 코드로 띄워 화면을 한 번 본다.
  6. 끝나면 서버 프로세스를 모두 끄고 `git worktree remove --force ../moai-deployed`. Windows에서는 꺼진 줄 알았던 `workerd`가 파일을 잡고 있을 수 있다.
  - 채운 데이터에서 나온 쿠키·커넥터 URL은 로컬 값이지만 레포 밖에 둔다.
- 되돌리기: D1 Time Travel(Workers Paid 기준 30일까지)과 주 1회 `wrangler d1 export moai --remote --output=<파일>` ([설계서 §13.2](design.md#132-백업)). 내보낸 파일에는 친구들 데이터가 들어 있으니 레포에 넣지 않는다.

---

## 7. 코드 읽기 전에 알아 둘 규칙

- **인증**: 오너 1명(`/setup`) + GitHub OAuth와 초대 코드 가입. 다른 기기는 GitHub나 10분짜리 로그인 코드로 들어온다. `/api/*`의 GET이 아닌 요청은 `Origin === APP_ORIGIN`이어야 한다. `/invites`, `/members`, `/admin/*`는 `requireOwner`다.
- **MCP**: `/mcp`는 OAuth Bearer 토큰(`oauth.ts`, 설계서 §8.7), 예전 방식 `/mcp/u/<토큰>`은 비밀 URL(HMAC 해시로 찾는다). 둘 다 `mcp/route.ts`의 `serveMcp`로 간다. SDK 2.3.1 legacy stateless. 도구 8개:
  - `find_concepts`, `save_learning`, `get_learner_context`
  - `get_review_queue`, `submit_review`, `get_interview_chain`
  - `get_categories`, `update_categories` (`destructiveHint: true`라 Always allow를 권하지 않는다)
    - `get_categories`는 분류마다 공부한 수(`concepts`)와 자료 수(`material`)를 따로 준다. `update_categories`의 `dry_run`은 바꾸지 않고 옮길 내용을 주고, 3단계에서 잘려 합쳐지는 이동은 `merged`로 따로 준다. 옛 이름은 바뀌지 않을 때까지 5번까지 이어서 따른다 (2026-10-19)
- **복습 엔진** (ts-fsrs 5.4.2, [설계서 §9](design.md#9-복습-엔진)):
  - 오늘 큐: 학습 → 복습 → 새 카드 순서다. 하루 상한이 있고, 같은 개념은 하루 1장이다.
  - 카드 사다리: 1~3단계다 (1 떠올리기, 2 빈칸·코드, 3 설명하기). 열린 단계의 카드가 모두 안정도 7일 이상이면 다음 단계가 열린다. 열리면 `level_ups`에 실린다.
  - 낙관적 잠금: `reps`가 그대로일 때만 쓰고, 최대 2번 다시 한다. 계속 겹치면 503을 준다.
- **배지**: 조건은 기록에서 세고, 처음 이룬 배지만 `badges` 테이블에 넣는다 (`domain/badges.ts`, `/api/stats`가 넣는다). 한 번 넣으면 목표를 바꾸거나 답을 되돌려도 남는다. 계정을 지우면 같이 지운다.
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
  - Messages API를 fetch로 직접 부른다 (structured outputs). 실제 fetch는 미국 동부 위치의 Durable Object 중계(`llm/relay.ts`, 바인딩 `ANTHROPIC_RELAY`)가 한다. Worker가 Cloudflare 홍콩에서 돌면 Anthropic이 지원하지 않는 지역이라 403 "Request not allowed"로 거절하기 때문이다 (2026-10-19 장애, 2026-10-20 고침). 중계는 외부 주소가 없고 저장소도 쓰지 않는다.
  - 비용은 넉넉한 단가로 센다. 한도는 사람별·전체로 걸고, 대기 중인 작업도 미리 잡아 둔다.
  - 같은 종류의 대기 작업은 사람마다 3개까지다.
  - 키가 없으면 그 기능의 버튼만 숨긴다 (`GET /api/ai/status`).
- **플랫폼 한도**:
  - CPU는 요청당 1000ms다 (`limits.cpu_ms`). 지금까지 잰 최댓값은 84ms다.
  - `waitUntil`은 응답 뒤 30초까지 산다.
  - 호출마다 하위 요청 50개, D1 쿼리 50개까지다. 여러 문장은 `DB.batch`로 묶으면 한 트랜잭션이 된다.

---

## 8. 사용자가 할 설정 (아직 안 했을 수 있다)

1. **claude.ai 커넥터 권한**:
   - `get_categories`를 포함한 도구 7개를 Always allow로 바꾼다. `update_categories`는 Needs approval로 둔다.
   - 새 도구가 안 보이면 커넥터를 껐다 켜거나 새 채팅을 연다.
2. **GitHub OAuth 앱 + `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`** ([운영 가이드 1.5](runbook.md#15-여러-기기와-github-로그인-켜기-한-번만)). 운영 `/api/auth/options`가 `github: true`라 들어 있는 것으로 보인다.
3. Android 내비게이션 바 색: GitHub를 먼저 이어 두고 PWA를 다시 설치한다. 알림도 다시 켠다.
4. 플러그인 0.2.1로 업데이트한다 (`/moai:pdf`, 안내 문구가 "학습 탭"으로 바뀌었다).
5. (선택) `ANTHROPIC_API_KEY`, `GRADER_MODEL`. 콘솔에서 월 지출 한도도 건다. 운영에 들어 있는지는 확인하지 않았다 (로그인 뒤 `GET /api/ai/status`). AI 개념 채팅을 만들려면 필요하다.
6. **OAuth 커넥터** ([운영 가이드 3.5](runbook.md#35-oauth-커넥터-켜기-한-번만)): KV를 만들어 id를 `wrangler.jsonc`에 넣고, claude.ai 커넥터를 `/mcp`로 바꾼 뒤 비밀 주소를 지운다.
7. (선택) GitHub `production` environment로 Cloudflare secret을 옮긴다 ([운영 가이드 3 배포](runbook.md#배포)).

---

## 9. 다음 작업

2026-10-20에 레포 전체를 8개 관점으로 분석해 우선순위를 매긴 개선점 56개가 [Improvement.md](../Improvement.md)에 있다.
- 2026-10-20에 1~8번(P0과 작업량 S인 P1)을 고쳤다: OAuth 리디렉트 주소 제한, MCP 도구 실패·Hono 밖 오류 기록(`mcp_failed` 알림), 백업 파일 규칙·복구 절차·Deploy bookmark, 카톡 인앱 브라우저·iPhone 홈 화면 앱·iPad 안내(`InAppNotice.tsx`, 가입 뒤 커넥터 허용 화면으로 복귀), 푸시 구독 다시 맞추기(하루 한 번, `pushsubscriptionchange`, `/api/today`의 `push_lost`), 복습 알림 1분 20명·5명씩 병렬·구독 없는 사람 빼기(`reminder_late` 알림), Deploy 타입 검사·롤백 절차, 설명하기 카드 잠김(`stuckCards`).
- 그때 하지 않은 것: 4번 실제 카톡 Android·iPhone 확인, 2번 관리자 지표의 도구 실패 수, 5번 오너 지표의 구독 수·마지막 성공 시각, 6·8번 운영 D1 읽기 확인(이 컴퓨터 wrangler에 운영 D1 권한이 없다).
- 2026-10-20에 9~11번도 고쳤다: 다음에 볼 질문 닫기(판정이 새로 오면 그 개념의 예전 질문을 닫음, 오늘 화면 ✓, 코칭 문맥은 개념마다 최근 3개·60일), 마이그레이션 업그레이드 테스트(`test/migrations.test.ts`), Cron heartbeat와 `/api/health`(D1·Cron 5분, Deploy 확인과 3시간마다의 Actions **Health**). 운영에 이미 쌓인 열린 질문은 일괄로 닫지 않았다(운영 D1 권한 없음). 그 개념을 다시 공부하거나 오늘 화면에서 닫으면 줄어든다.
- 2026-10-20에 P2 중 작업량 S인 14·15·17·22·23·28·29·30·31번도 고쳤다: 가입 때 만 14세·약관 동의와 `users.terms_version`(0014, 기존 회원은 오늘 화면에서 다시 동의), 처리방침을 실제 동작에 맞춤, 계정을 지우면 쓴 초대의 라벨을 지움, Deploy는 `main`에서만·Cloudflare 토큰은 네 단계에만·Actions SHA 고정·Dependabot, 이번 달 AI 비용 50·80·100% 오너 알림과 Anthropic 결제 한도 알림(`llm_spend`), API 본문 256KB, 예전 커넥터 주소 90일 미사용 만료(0015 `last_used_at`), 저장된 글을 AI 프롬프트·MCP 결과에서 지시로 읽지 않게(`tagSafe`, `[저장된 기록]`), 기기 저장 실패 처리와 답안함 테스트(되돌리기·전송 경쟁 고침), 내보내기 v2와 완전성·남의 카드 수정 테스트, 없어진 기록 탭 안내·화면 이름(공부한 대화)·작업 완료 알림 제목.
- 그때 하지 않은 것: 15번 GitHub `production` environment(선택, §8의 7), 17번 Console 지출 한도 자체는 사용자 설정(§8의 5).
- 다음은 P2의 나머지(12, 13, 16, 18~21, 24~27번)와 P3에서 고른다.

| 작업 | 메모 |
|---|---|
| claude.ai 내보내기 zip 일괄 가져오기 | 보류 (2026-10-19 사용자: 필요 없음). 하게 되면 Batch API(50% 할인), 기존 붙여넣기 가져오기와 예산 가드를 재사용한다 |
| 한국 외 시간대 | 보류 (2026-10-19 사용자: 아직 필요 없음). 지금은 04:00 KST 경계로 고정이다 (`lib/kst.ts`). `users.timezone` 열은 있다 |
| 음성으로 설명하기 | 방법 미정 |

알려진 한계 (지금은 괜찮다고 본 것):
- `repairLibrary`는 (사용자, 분류) 조합을 5000개까지만 본다. 사용자가 크게 늘면 나눠 읽게 고친다.
- `update_categories` 한 번에 rename을 여러 개 주면 모두 호출 시작 때의 목록으로 계산한다.
- 자료 카드를 풀고 되돌리기를 해도 그 개념은 내 지식으로 남는다.
- SQLite `lower()`는 ASCII만 바꾼다. 한글에는 영향이 없다.

---

## 10. 함정

- Cloudflare는 한국 요청을 홍콩(HKG)이나 도쿄(NRT) 데이터센터로 자주 보낸다 (`https://moai.smoh.dev/cdn-cgi/trace`의 `colo`). Worker는 요청을 받은 곳에서 돌아서, 지역을 막는 외부 API(Anthropic 등)는 홍콩에서 나간 호출을 거절한다. 그런 API는 `llm/relay.ts`처럼 위치를 정한 Durable Object에서 부른다.

- 테스트 헬퍼의 `workerFetch`는 `redirect: 'manual'`이다. 리다이렉트를 따라가면 OAuth 테스트가 깨진다.
- `recordReviews`는 채점 시각을 카드 생성 시각과 서버 현재 시각 사이로 자른다. "때가 안 됨"을 시험하려면 기록을 DB에서 직접 옛날로 옮긴다.
- 스크립트로 API를 부를 때는 `origin` 헤더를 꼭 넣는다 (없으면 403). 서버는 `--local-upstream localhost:8787`로 띄운다 (§6).
- Playwright에 로그인 쿠키를 넣을 때는 `url` 대신 `domain: 'localhost', path: '/'`를 쓴다 (`__Host-` 쿠키라 `secure: true`).
- 로그에는 이벤트 이름, 사용자 ID, 숫자만 남긴다. URL, 본문, 토큰은 남기지 않는다.
- claude.ai 커넥터는 도구 목록과 서버 지침을 캐시한다. 도구를 바꾼 뒤에는 커넥터를 다시 켜야 반영된다.
- `wrangler dev`는 정적 파일을 캐시한다. `npm run build` 뒤에는 개발 서버를 다시 띄운다. 서버가 켜진 채로 빌드하면 파일 잠금으로 한 번 실패할 수 있다.
- Claude 앱의 브라우저 패널이 화면에 안 보이면 requestAnimationFrame이 멈춰 Motion 애니메이션이 끝나지 않는다 (`AnimatePresence mode="wait"`의 다음 화면이 안 뜬다). 패널을 띄우거나 DOM으로 확인한다. 패널이 동작 줄이기 상태면 미는 움직임은 원래 안 보인다.
- 배포 뒤 처음 열면 새 서비스 워커가 자리를 잡으며 한 번 다시 불러온다 (`main.tsx`). 한 번만 뜨는 화면(새 배지 축하 등)을 시험할 때 헷갈리지 않게 한다.
- Windows는 `core.autocrlf=true`라 작업 폴더 파일이 CRLF와 LF로 섞여 있다. 스크립트로 고칠 때 줄바꿈을 파일에 맞춘다.
