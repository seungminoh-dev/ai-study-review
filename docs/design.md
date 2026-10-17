# 모아이 설계서 v1.1

- 상태: MVP 0 코드 완료 (실행은 [MVP 0 실행 가이드](mvp0-runbook.md)), MVP 1~3은 설계
- 날짜: 2026-10-17
- 런타임: TypeScript, Cloudflare Worker 하나 (Free 플랜). [ADR 0001](adr/0001-runtime.md)에서 결정
- 관련 문서: [기획서](service-plan.md), [이름 후보](names.md), [MVP 0 실행 가이드](mvp0-runbook.md)
- 패키지 버전은 2026-10-17 npm 기준이고, API 이름은 각 패키지의 타입 정의로 확인했다.

서비스 이름은 **모아이**로 정했다. 코드 식별자는 `moai`다 (Worker 이름, D1 이름, 패키지 이름 `@moai/*`).

v1.1 변경: 검증 리뷰 15건 반영, MVP 0을 만들면서 바뀐 점 반영 (npm 워크스페이스, `@cloudflare/vitest-plugin`, 카드 단계는 서버가 정함, 본문 상한 256KB, MVP 0의 호출 로그).

---

## 1. 한눈에 보기

claude.ai에서 공부하다가 "정리해줘"라고 하면, 대화 중인 Claude가 MCP 도구로 학습 기록(개념, 판정, 내 오답, 카드, 다음에 볼 질문)을 저장한다. Worker가 그것을 D1에 넣고 FSRS로 복습 날짜를 잡는다. 매분 도는 Cron이 정한 시각에 웹 푸시를 보내고, 휴대폰 홈 화면에 설치한 PWA에서 2~3분씩 복습한다.

### 1.1 설계 원칙

1. **LLM 일은 사용자의 Claude 구독이 한다.** 카드 생성은 대화 중인 Claude가 하고, 서버는 저장·일정·화면만 맡는다. 서버의 Claude API 호출은 MVP 2의 설명 채점과 붙여넣기 가져오기뿐이다.
2. **Worker 하나로 끝낸다.** MCP 서버, REST API, PWA 정적 파일, Cron이 같은 Worker에 있다. 다른 서비스는 D1과 브라우저 푸시 서비스뿐이다.
3. **월 $5 안에서 설계한다.** 처음에는 무료 플랜(호출당 CPU 10ms)을 목표로 했지만, MVP 0에서 실제 claude.ai 경로가 넘어서 Workers Paid(월 $5)로 바꿨다 (2026-10-18). 포함량(요청 월 1천만 건, CPU 월 3천만 ms, D1 쓰기 월 5천만 행)의 1% 남짓만 쓰는 규모라 추가 요금은 없다고 본다. 요청당 CPU는 `limits.cpu_ms`로 1초까지만 쓰게 한다.
4. **틀린 카드를 가장 위험하게 본다.** 카드의 정답은 세션에서 확정된 내용에서만 가져오고, 사용자가 언제든 카드를 끌 수 있게 한다.

### 1.2 구성도

```
 [claude.ai 프로젝트 (폰·웹)]   [Claude Code]          [PWA (휴대폰 홈 화면)]
          │ MCP (Streamable HTTP)  │ MCP                    │ REST + 세션 쿠키
          └────────────┬───────────┘                        │
                       ▼                                    ▼
 ┌─────────────────────────────────────────────────────────────────────┐
 │ Cloudflare Worker `moai`   (app.<도메인>, Free 플랜)                   │
 │  ├─ POST /mcp/u/:token   MCP 서버 (@modelcontextprotocol/server)      │
 │  ├─ /api/*               REST API (Hono)                              │
 │  ├─ 그 밖의 경로          PWA 정적 파일 (Workers Static Assets)         │
 │  └─ scheduled()          매분 Cron: 푸시 · LLM 작업 · 청소              │
 └──────────┬────────────────────────────────┬─────────────────────────┘
            ▼                                ▼
   D1 (SQLite, apac 위치)          외부 호출: 브라우저 푸시 서비스(FCM·Apple·Mozilla),
                                   Anthropic API (MVP 2부터)
```

### 1.3 MVP 단계

| MVP | 목표 | 사용자 | 기간 | 끝났다는 기준 |
|---|---|---|---|---|
| **0. 연결 검증** | 가장 불확실한 가정을 코드 몇백 줄로 먼저 확인 | 나 | 주말 1회 | §2.1의 필수 확인 항목 통과 |
| **1. 나 혼자 루프** | 공부 → 저장 → 다음 날 푸시 → 복습이 손대지 않아도 돈다 | 나 | 2주 | 14일 중 10일 이상 복습 |
| **2. 친구 베타** | 친구가 초대 코드 하나로 5분 안에 첫 복습까지 간다. 설명하기 단계와 재미 요소가 들어간다 | 10명 | 3주 | 주간 복습자 60% 이상, 카드 신고율 5% 미만 |
| **3. 확장** | 공부하는 곳과 복습 방식을 넓힌다 | 10명 | 이후 | 기능별로 정함 |

### 1.4 기능별 MVP

●는 그 MVP에서 만든다는 뜻이다. 한 번 만든 기능은 다음 MVP에도 계속 있다.

| 기능 | 0 | 1 | 2 | 3 |
|---|---|---|---|---|
| MCP 커넥터 연결 (비밀 URL) | ● | | | |
| `save_learning` (MVP 0은 검증만 하고 원본 저장) | ● | ● | | |
| `find_concepts`, `get_learner_context` | | ● | | |
| OX·객관식·빈칸 카드, FSRS 복습 세션 | | ● | | |
| 카드 사다리 (1→2단계) | | ● | | |
| 설명하기 카드(3단계) + 자가 채점 | | | ● | |
| 오프라인 답안 큐 | | ● | | |
| 웹 푸시 리마인드 | ● (테스트) | ● | | |
| 카드 끄기 | | ● | | |
| 카드 신고·수정, 채점 되돌리기 | | | ● | |
| 오너 계정 (부트스트랩 코드) | | ● | | |
| 초대 가입, 기기 로그인 코드, 온보딩 | | | ● | |
| 지식 지도, 개념 상세 | | | ● | |
| 스트릭·XP·친구 리그 | | | ● | |
| AI 채점 (예산 가드) | | | ● | |
| 붙여넣기 가져오기 | | | ● | |
| 내보내기·계정 삭제, 관리자 화면 | | | ● | |
| Claude Code 플러그인 | | | | ● |
| 채팅 복습 도구 (`get_review_queue`, `submit_review`) | | | | ● |
| 꼬리물기 체인·모의면접 모드 | | | | ● |
| 질문 은행 공유 | | | | ● |
| claude.ai 데이터 내보내기 zip 가져오기 | | | | ● |
| OAuth 커넥터 인증 | | | | ● |

---

## 2. MVP별 계획

### 2.1 MVP 0: 연결 검증 (주말 1회)

**목표**: 설계 전체가 기대는 가정을 실제 폰과 실제 claude.ai로 먼저 확인한다. 여기서 막히는 것이 있으면 MVP 1 범위를 바꾼다.

**상태**: 코드와 테스트는 레포에 있다 (`apps/worker`, `apps/web/public`, `packages/shared`). Cloudflare·claude.ai 쪽 설정과 점검 순서는 [MVP 0 실행 가이드](mvp0-runbook.md)에 있다.

**만드는 것**

- Worker 뼈대: Hono, 커스텀 도메인 `app.<도메인>`, `workers_dev: false`, D1 생성 (`wrangler d1 create moai --location apac`).
- `POST /mcp/u/:token`: 비밀값 `SPIKE_TOKEN` 하나로만 연다. 도구는 두 개다.
  - `ping`: 서버 시각을 돌려준다.
  - `save_learning`: 실제 스키마(§6.4)로 검증만 하고, 원본 JSON을 `spike_log` 테이블에 넣는다.
- `/spike` 페이지(`apps/web/public`의 정적 파일): 홈 화면 추가 안내, "알림 켜기", 푸시 예약과 도착 확인, 쿠키 확인, MCP 요청 기록 보기.
- Cron(매분): 예약해 둔 테스트 푸시 1건을 보낸다.
- 계약 테스트: 2025년 방식(initialize → tools/list → tools/call)과 2026-07-28 방식 요청을 공식 MCP 클라이언트(`@modelcontextprotocol/client`)로 모두 보내 본다.
- MVP 0에서만 호출 로그(`invocation_logs`)를 켜서 요청별 CPU 시간을 본다 (§4.3).

**확인 항목**

| # | 확인 | 통과 기준 | 막히면 |
|---|---|---|---|
| 1 | 웹 claude.ai에 커넥터 추가 | "로그인 없음"으로 추가되고 도구 2개가 보인다 | Host, 리다이렉트, 응답 형식 점검 |
| 2 | 폰 앱(iOS·Android)의 프로젝트 대화에서 "정리해줘" | `save_learning`이 호출되어 `spike_log`에 행이 생긴다. 친구의 Pro 계정에서도 같다. 그 프로젝트가 새 Projects 베타인지 기록한다 | 일반 대화에 코치 지침을 넣어 본다. 그래도 안 되면 붙여넣기 가져오기를 MVP 1로 당겨 주력으로 쓴다 |
| 3 | CPU 시간 | 가장 큰 페이로드(개념 20개, 카드 30장, 약 52KB)로 tools/list와 tools/call의 CPU p99가 7ms 미만이다. 푸시 1건의 CPU도 잰다. 요청별 CPU는 호출 로그에서 본다 | Workers Paid($5/월)로 바꾼다. 코드는 그대로 |
| 4 | 프로토콜 | claude.ai가 보내는 `MCP-Protocol-Version`을 기록하고, 두 방식 계약 테스트가 통과한다 | SDK 옵션과 응답 형식을 조정한다 |
| 5 | iPhone 홈 화면 PWA 푸시 | 정한 시각 1분 안에 도착한다 | iOS 버전, 홈 화면 설치, 권한을 확인한다. 그래도 안 되면 MVP 1은 휴대폰 기본 알람으로 대신한다 |
| 6 | Cloudflare 존 설정 | Bot Fight Mode가 꺼져 있고, AI 봇 차단 설정이 `/mcp`를 막지 않는다. 로그에 403이나 챌린지가 없다 | 설정을 고친다 (§13.3) |
| 7 | Safari → 홈 화면 앱 쿠키 | Safari에서 받은 쿠키가 홈 화면 앱에도 있는지 기록만 한다 | MVP 2 로그인 흐름에 반영한다 |
| 8 | 응답 시간 | 도구 호출 p95가 1.5초 미만이다. Smart Placement를 켠 경우와 끈 경우를 비교한다 | 읽기를 `DB.batch()` 하나로 묶는다 |
| 9 | Claude Code | 구독으로 로그인한 Claude Code에 claude.ai 커넥터가 보이고 호출된다 | MVP 3 범위라 기록만 한다 |

**실측 기록 (2026-10-17, 첫 배포)**

- 8번 통과: p95 tools/list 94ms, tools/call 276ms. 데이터센터는 HKG.
- 3번 넘음: 가장 큰 페이로드로 tools/list 중간값 13ms·최대 21ms, tools/call 중간값 13ms·최대 84ms. Error 1102는 0건.
- 원인: MCP SDK가 tools/list마다 `save_learning` 스키마를 JSON Schema로 다시 변환했다 (요청 CPU의 40%쯤). 그리고 요청 대부분이 막 뜬 isolate에서 처리되어, 함수를 처음 컴파일하는 비용이 요청마다 들어갔다.
- 조치: JSON Schema는 모듈 범위에서 한 번만 만들고, SDK의 `preloadSchemas()`와 예시 1건 검증도 모듈 범위에서 미리 한다. Node에서 막 뜬 프로세스로 10~12번씩 잰 중간값은 다음과 같다 (측정 묶음마다 조금씩 달라서 범위로 적는다). 다시 배포해서 3번을 다시 잰다.
  - tools/list: 13~17ms → 5~6ms
  - tools/call, 가장 큰 페이로드: 16ms → 11ms
  - tools/call, 실제 크기 예시(약 2KB): 14~16ms → 8~10ms
  - 이미 데워진 isolate에서는 둘 다 1~2ms다. 막 뜬 isolate의 첫 요청(보통 initialize)은 여전히 20ms 넘게 쓴다.

**실측 기록 (2026-10-18, 폰·웹 점검)**

| # | 결과 |
|---|---|
| 1 | 통과. 웹 claude.ai에서 ping 응답 |
| 2 | Android 앱 프로젝트 대화에서 통과 (개념 6개, 카드 15장 저장). 친구 Pro 계정과 새 Projects 베타 여부는 아직 |
| 3 | **실제 경로에서 넘는다.** 커넥터를 거친 IAD·2026-07-28 요청(예시 크기)은 `tools/call save_learning` 중간값 16ms·최대 32ms(5건), `server/discover` 중간값 5ms·최대 25ms, `ping` 4~5ms. replay(2025-06-18, 가장 큰 페이로드, 몰아서 보냄)는 `tools/list` 중간값 2ms·최대 14ms, `save_learning` 중간값 4ms·최대 12ms. 1102는 없었다. 실제 호출은 띄엄띄엄 와서 거의 매번 막 뜬 isolate가 받고, replay는 몰아서 보내 데워진 isolate가 받는다. `save_learning`의 벽시계 시간은 약 0.6초(IAD → APAC D1) |
| 4 | claude.ai(웹·폰)는 **2026-07-28** 방식이다. 도구 호출 한 번이 `server/discover` → `tools/call` 두 요청이고, tools/list는 매번 보내지 않는다. 요청은 **IAD**(미국 동부) 데이터센터로 들어온다. replay(로컬, 2025-06-18 방식)는 NRT로 들어온다 |
| 5 | Android 푸시 도착. 지연 57초는 거의 다 Cron 대기다. "1분 뒤"는 초 단위 시각이라 다음 매분 Cron까지 최대 60초를 기다린다. 실제 복습 알림은 HH:MM에 맞춰 예약하므로 몇 초 안에 간다. 사용자가 iPhone을 쓰지 않아 iPhone은 친구 기기로 MVP 2 전에 확인한다 |
| 6 | 통과. 존 설정을 마친 뒤 1, 2가 됐다 |
| 7 | Android: 브라우저에서 심은 쿠키가 설치한 앱에도 있다. 브라우저에서 로그인하면 앱도 로그인된 상태로 열린다. iPhone(Safari → 홈 화면 앱)은 따로 저장할 수 있어서 MVP 2 전에 친구 기기로 확인한다 |
| 8 | 통과. replay p95 tools/list 144ms, tools/call(가장 큰 페이로드) 341ms |
| 9 | 통과. 로컬 Claude Code에서 ping 응답 |

- 설계에 주는 영향: claude.ai 요청은 IAD에서 처리되는데 D1은 APAC에 있다. 그래서 MCP 경로의 D1 왕복은 태평양을 건넌다. MVP 1의 `save_learning`은 읽기 한 번, 쓰기 한 번(`DB.batch`)으로 왕복을 줄이고, Smart Placement를 켠 경우와 비교한다. PWA 요청은 한국에서 오므로 APAC D1이 맞다.

**끝났다는 기준**: 1~6 통과. 7~9는 기록만 하면 된다.

### 2.2 MVP 1: 나 혼자 루프 (2주)

**목표**: 공부 → 저장 → 다음 날 푸시 → 복습이 내가 손대지 않아도 돈다. 사용자는 나 한 명이다.

**만드는 것**

1. D1 스키마 `0001_init.sql` (§5.2). MVP 0의 `spike_*` 테이블, `/spike` 페이지, `SPIKE_TOKEN`을 지우고 호출 로그를 끈다.
2. PWA를 Vite 프로젝트로 바꾸고 `assets.directory`를 `../web/dist`로 옮긴다.
3. MCP 도구 3개 `find_concepts`, `save_learning`, `get_learner_context`와 도구 설명문 (§6, 부록 A).
4. 오너 계정: `/setup` 화면에서 비밀값 `BOOTSTRAP_CODE`로 한 번만 만든다. 세션 쿠키로 로그인 상태를 유지한다.
5. 설정 화면: 커넥터 URL 발급·재발급, 코치 지침 템플릿 복사 (부록 B), 알림 시간(최대 3개), 푸시 테스트.
6. 복습: 오늘 화면, 복습 세션(OX·객관식·빈칸, 코드 조각 표시), 결과 화면, "틀린 카드 다시 보기".
7. 복습 엔진: ts-fsrs 일정, 하루 상한, 같은 개념 하루 1장, 카드 사다리 1→2단계 (§9).
8. 오프라인 답안 큐 (§9.5).
9. 저장 기록 화면: 세션별 개념·판정·카드 목록, 카드 끄기.
10. 리마인드: 푸시 구독, 매분 Cron 발송 (§10).
11. CI(타입 검사, 테스트)와 배포(마이그레이션 → `wrangler deploy`)는 MVP 0에서 만든 워크플로를 그대로 쓴다.

**하지 않는 것**: 초대와 친구 계정, 설명하기 카드 출제(저장은 하고 잠가 둔다), 지식 지도, 스트릭·XP·리그, AI 채점, 붙여넣기 가져오기, 카드 수정.

**끝났다는 기준**

- 14일 중 10일 이상 복습했다.
- 저장한 다음 날 첫 알림이 정한 시각 1분 안에 온다.
- 2주 동안 도구 호출 실패가 0건이고, CPU p99가 7ms 미만을 유지한다.
- 틀린 카드를 발견하면 그 자리에서 끌 수 있다.

### 2.3 MVP 2: 친구 베타 (3주)

**목표**: 친구가 초대 코드 하나로 5분 안에 가입부터 첫 복습까지 마친다. 설명하기 단계와 재미 요소가 들어간다.

**만드는 것**

1. 초대와 로그인 (§8): 관리자 화면에서 초대 코드 발급, 홈 화면 앱 안에서 코드 입력으로 가입, 기기 로그인 코드, 로그아웃.
2. 온보딩 4단계: 홈 화면에 추가 → 알림 켜기 → 웹 claude.ai에서 커넥터 추가("로그인 없음", 도구는 "항상 허용") → 코치 지침 붙여넣기.
3. 설명하기 카드와 자가 채점 (§9.3): 내 최종 버전, 체크리스트, 두괄식 여부를 보고 4단계 버튼으로 매긴다. 버튼마다 다음 복습 간격을 미리 보여 준다.
4. 카드 사다리 2→3단계 잠금 해제.
5. 지식 지도와 개념 상세 (§9.7): 상태 3색, 연결선, 점선 노드를 누르면 "Claude에서 이어서 공부하기" 프롬프트를 복사한다.
6. 스트릭, 일일 목표, XP, 주간 친구 리그, 스트릭 프리즈 (§9.6).
7. 카드 신고(즉시 정지)와 수정, 마지막 채점 되돌리기.
8. AI 채점 (§11): 작업 테이블, 예산 가드, "AI 판정은 틀릴 수 있어요" 안내.
9. 붙여넣기 가져오기 (§11.4): Cron이 처리하고, 끝나면 푸시로 알린다.
10. 내 데이터 내보내기(JSON), 계정 삭제, 관리자 사용량 화면.

**끝났다는 기준** (기획서 §13)

- 주간 복습자 비율 60% 이상
- 카드 신고율 5% 미만
- 실측 API 지출 월 $100 미만
- 친구 한 명이 도움 없이 5분 안에 첫 복습까지 마친다

### 2.4 MVP 3: 확장 (이후)

| 기능 | 내용 |
|---|---|
| Claude Code 플러그인 | `/coach`, `/capture` skill과 Stop hook. MCP 서버는 넣지 않고 claude.ai 커넥터를 그대로 쓴다 (기획서 §5.6) |
| 채팅 복습 도구 | `get_review_queue`, `submit_review`로 "오늘 복습 퀴즈 내줘"를 채팅에서 처리한다 |
| 꼬리물기 체인·모의면접 | 연결된 개념 3개를 이어서 묻는다. 면접관 꼬리질문 연습 |
| 질문 은행 공유 | 친구끼리 질문만 공유한다. 답과 판정은 공유하지 않는다 |
| 데이터 내보내기 zip 가져오기 | claude.ai에서 내보낸 과거 대화를 Batch API(50% 할인)로 한꺼번에 카드로 만든다 |
| OAuth 커넥터 인증 | `@cloudflare/workers-oauth-provider` 1.2.3 + KV. 비밀 URL 대신 쓴다 |
| 그 밖 | 한국 외 시간대, 음성으로 설명하기 (방법 미정) |

---

## 3. 플랫폼 제약 (Cloudflare Free 플랜)

| 제약 | 값 | 설계에 미치는 영향 |
|---|---|---|
| 요청 수 | 하루 10만 건. 무료 할당량은 00:00 UTC(= 09:00 KST)에 초기화 | 10명 규모면 1% 미만 |
| CPU 시간 | 무료는 호출당 10ms, Paid는 기본 30초 (Cron 포함). D1이나 fetch를 기다리는 시간은 세지 않는다. 넘으면 Error 1102 | MVP 0에서 무료 한도를 넘어 Workers Paid로 바꿨다. `limits.cpu_ms`를 1000으로 둔다. 큰 스키마는 모듈 범위에서 한 번만 만든다. 푸시는 한 틱에 몇 건만 보낸다 |
| 하위 요청 | 호출당 50개 | 한 틱의 푸시·Anthropic 호출 수를 제한한다 |
| D1 쿼리 | 호출당 50개 | `save_learning`은 테이블마다 한 문장으로 묶어 `DB.batch()`로 실행한다 |
| D1 용량·처리량 | DB당 500MB, 하루 읽기 500만 행·쓰기 10만 행. 읽기는 스캔한 행 수로 센다 | 모든 조회에 인덱스를 탄다 (§5.2) |
| 시작 시간 | 전역 범위 실행은 1초 안에 끝나야 한다 | Anthropic 클라이언트 같은 무거운 것은 첫 사용 때 만든다 |
| Cron Trigger | 계정당 5개, UTC 기준, 최소 1분 | 매분 1개로 모든 주기 작업을 처리한다 |
| 정적 파일 | 무료, 무제한 | PWA 전부를 Worker가 직접 제공한다 |
| KV (MVP 3 OAuth) | 하루 쓰기 1,000건 | 10명이면 충분하다 |
| 백업 | D1 Time Travel 7일 | 주 1회 수동 export를 더한다 (§13.2) |

---

## 4. 저장소 구조와 스택

### 4.1 저장소 구조 (npm 워크스페이스)

```
apps/
  worker/                      # Cloudflare Worker
    src/
      index.ts                 # fetch()와 scheduled() 진입점
      app.ts                   # Hono 앱: /api/*, /mcp/u/:token
      mcp/
        server.ts              # createMcpHandler + 서버 팩토리
        tools/                 # find-concepts.ts, save-learning.ts, get-learner-context.ts
        descriptions.ko.ts     # 도구 설명문 (부록 A)
      api/                     # REST 라우트 (today, queue, reviews, sessions, settings, ...)
      domain/
        fsrs.ts                # ts-fsrs 설정, 등급 매핑
        queue.ts               # 오늘 큐 규칙
        ladder.ts              # 카드 사다리 잠금 해제
        concepts.ts            # 개념 찾기, 상태 계산
        reminders.ts           # 다음 발송 시각 계산 (KST)
        push.ts                # 웹 푸시 발송
        llm/                   # MVP 2: 채점, 가져오기, 예산
      db/                      # SQL과 행 변환 (ORM 없음)
      auth/                    # 토큰 해시, 세션, 초대
      cron.ts                  # 매분 작업 순서
    migrations/                # 0000_spike.sql(MVP 0), 0001_init.sql, 0002_beta.sql, ...
    test/
    wrangler.jsonc
  web/                         # React PWA
    public/                    # 정적 파일. MVP 0은 여기 있는 spike.html·sw.js·manifest를 그대로 배포한다
    src/                       # MVP 1부터
      screens/                 # Today, Review, Sessions, Settings, Setup, (MVP 2) Join, Map, League, ...
      cards/                   # OxCard, McqCard, ClozeCard, (MVP 2) ExplainCard
      offline/                 # 큐 캐시, 답안 outbox
      sw.ts                    # 서비스 워커 (푸시, 캐시)
packages/
  shared/                      # zod 스키마와 타입 (save_learning 입력, API 요청·응답)
scripts/                       # gen-vapid.mjs, gen-token.mjs, replay.mjs, make-max-fixture.mjs
.github/workflows/             # ci.yml, deploy.yml
docs/
```

- 패키지 관리는 npm 워크스페이스다. 루트 `.npmrc`의 `legacy-peer-deps=true`는 npm 10이 선택적 peer 의존성을 계산하다 멈추는 버그를 피하려는 설정이다.
- 내부 패키지(`@moai/shared`)는 빌드하지 않고 TypeScript 소스를 그대로 가져다 쓴다. wrangler(esbuild)와 vitest가 직접 읽는다.

`packages/shared`의 zod 스키마 하나를 MCP 도구 입력, REST 요청 검증, PWA 타입이 같이 쓴다. 스키마가 한 곳에만 있어서 서로 어긋나지 않는다.

### 4.2 스택과 버전

| 역할 | 패키지 | 버전 |
|---|---|---|
| 배포·로컬 실행 | `wrangler` | 4.151.1 |
| 라우팅 | `hono` | 4.13.13 |
| 스키마 검증 | `zod` | 4.6.7 |
| MCP 서버 | `@modelcontextprotocol/server` | 2.3.1 |
| 간격 반복 | `ts-fsrs` | 5.4.2 |
| 웹 푸시 (aes128gcm, VAPID) | `@block65/webcrypto-web-push` | 2.0.0 |
| Claude API (MVP 2) | `@anthropic-ai/sdk` | 0.135.0 (README에 Cloudflare Workers 지원 명시) |
| 테스트 | `vitest` | 4.1.12 (`@cloudflare/vitest-plugin`의 peer 범위) |
| Workers 테스트 통합 | `@cloudflare/vitest-plugin` | 1.4.4 (`@cloudflare/vitest-pool-workers`가 이름을 바꾼 것. 옛 이름은 지원 종료) |
| MCP 계약 테스트 | `@modelcontextprotocol/client` | 2.3.1 |
| 타입 | `typescript`, `@cloudflare/workers-types` | 5.9.3, 5.20261016.1 |
| PWA (MVP 1) | `vite-plugin-pwa` | 2.0.0. `vite`, `react` 버전은 MVP 1 착수 때 정한다 |
| 오프라인 저장 | `idb-keyval` | 6.3.0 |
| 지식 지도 (MVP 2) | `d3-force` | 3.0.0 |
| OAuth (MVP 3) | `@cloudflare/workers-oauth-provider` | 1.2.3 |

- `nodejs_compat` 플래그는 필요해질 때만 켠다. 위 패키지들은 Web 표준 API로 동작한다.
- `compatibility_date`는 고정하고, 올릴 때는 CI의 테스트 배포로 먼저 확인한다.
- 버전은 `package.json`에 정확히 고정한다. 범위로 두면 peer 범위 밖의 새 메이저(예: vitest 5)가 들어올 수 있다.

### 4.3 `wrangler.jsonc` 핵심 설정

아래 키 이름은 wrangler 4.151.1의 설정 스키마로 확인했다.

```jsonc
{
  "name": "moai",
  "main": "src/index.ts",
  "compatibility_date": "2026-10-01",
  "workers_dev": false,
  "routes": [{ "pattern": "app.<도메인>", "custom_domain": true }],
  "assets": {
    "directory": "../web/dist",          // MVP 0은 "../web/public"
    "not_found_handling": "single-page-application",
    "run_worker_first": ["/api/*", "/mcp/*"]
  },
  "d1_databases": [
    { "binding": "DB", "database_name": "moai", "database_id": "<id>", "migrations_dir": "migrations" }
  ],
  "triggers": { "crons": ["* * * * *"] },
  "observability": { "enabled": true, "logs": { "invocation_logs": false } },   // MVP 0만 true
  // "placement": { "mode": "smart" },   // MVP 0에서 응답 시간을 비교하고 정한다
  "vars": {
    "APP_ORIGIN": "https://app.<도메인>",
    "VAPID_PUBLIC_KEY": "<공개 키>",
    "VAPID_SUBJECT": "mailto:<연락처>"
  }
}
```

- `invocation_logs`: 호출 로그는 요청 URL을 남기는데, MCP URL에는 비밀 토큰이 들어 있다.
  - MVP 0은 SPIKE_TOKEN 하나만 쓰고 끝나면 버리므로 켜 둔다. 대시보드 지표는 Worker 전체(Cron 포함)를 합친 값이라, tools/list와 tools/call을 따로 보려면 요청별 CPU가 남는 호출 로그가 필요하다.
  - MVP 1부터는 사용자 토큰을 발급하기 전에 끈다. 직접 남기는 로그에도 경로를 넣지 않는다.
- 로컬 실행은 `wrangler dev --local-upstream localhost:8787`이다. 이 옵션이 없으면 wrangler가 요청 주소를 `routes`의 도메인으로 바꿔서 Host 검사(§6.1)에 걸린다.

### 4.4 비밀값과 변수

| 이름 | 종류 | 시작 MVP | 용도 |
|---|---|---|---|
| `VAPID_PRIVATE_KEY` | secret | 0 | 푸시 서명 |
| `VAPID_PUBLIC_KEY`, `VAPID_SUBJECT` | var | 0 | 브라우저 구독, 푸시 서비스 연락처 |
| `APP_ORIGIN` | var | 0 | Origin·Host 검사 기준 |
| `SPIKE_TOKEN` | secret | 0 | MVP 0 전용. MVP 1에서 지운다 |
| `TOKEN_PEPPER` | secret | 1 | 토큰 해시용 HMAC 키 |
| `BOOTSTRAP_CODE` | secret | 1 | 오너 계정을 한 번 만들 때만 쓴다 |
| `ANTHROPIC_API_KEY` | secret | 2 | 내 Console API 키 |
| `GRADER_MODEL` | var | 2 | 기본 `claude-opus-5-5` (§11.1) |
| `LLM_USER_CAP_USD`, `LLM_MONTHLY_CAP_USD` | var | 2 | 기본 6, 90 |

비밀값은 `wrangler secret put`으로 넣고, 로컬 개발용 `.dev.vars`는 git에 올리지 않는다.

---

## 5. 데이터 모델 (D1, SQLite)

### 5.1 규칙

- 모든 테이블은 `STRICT`.
- 시각은 UTC epoch 밀리초 `INTEGER`.
- 배열과 객체는 JSON 문자열 `TEXT`로 두고 `json_extract`, `json_each`로 읽는다.
- 자주 읽는 테이블에는 모두 `user_id`를 두고, 모든 조회를 `user_id`로 시작하는 인덱스로 한다. D1은 읽은 행이 아니라 스캔한 행으로 세기 때문이다.
- ID는 `crypto.randomUUID()`.
- D1은 외래 키(`REFERENCES`)를 기본으로 검사한다. 그래서 지울 때는 자식부터 지운다. 계정 삭제는 `review_logs`, `card_reports` → `cards` → `judgments`, `followups` → `edges` → `concepts`, `learning_sessions` → 나머지 사용자 테이블 → `users` 순서로 한 batch에서 한다. 테이블을 다시 만드는 마이그레이션에는 `PRAGMA defer_foreign_keys = on`을 쓴다.
- **하루의 경계는 04:00 KST**다. 새벽에 한 복습은 전날로 센다. SQL에서는 `date(ts/1000 + 5*3600, 'unixepoch')`다 (+9시간 −4시간).

### 5.2 MVP 1 스키마 (`migrations/0001_init.sql`)

```sql
CREATE TABLE users (
  id                 TEXT PRIMARY KEY,
  display_name       TEXT NOT NULL,
  role               TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  timezone           TEXT NOT NULL DEFAULT 'Asia/Seoul',   -- MVP 1~2는 이 값만 지원
  daily_new_limit    INTEGER NOT NULL DEFAULT 10,
  daily_review_limit INTEGER NOT NULL DEFAULT 30,
  created_at         INTEGER NOT NULL
) STRICT;

CREATE TABLE auth_sessions (
  token_hash   TEXT PRIMARY KEY,                 -- HMAC-SHA256(TOKEN_PEPPER, 토큰)
  user_id      TEXT NOT NULL REFERENCES users(id),
  created_at   INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL
) STRICT;

CREATE TABLE mcp_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  revoked_at INTEGER
) STRICT;

CREATE TABLE learning_sessions (                   -- 기획서의 sessions. 로그인 세션과 헷갈리지 않게 이름을 바꿨다
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id),
  source       TEXT NOT NULL CHECK (source IN ('claude.ai', 'claude-code', 'import')),
  topic        TEXT NOT NULL,
  final_answer TEXT,
  key_terms    TEXT NOT NULL DEFAULT '[]',
  payload_hash TEXT NOT NULL,                      -- 같은 내용을 다시 보내면 중복 저장하지 않는다
  summary      TEXT NOT NULL,                      -- 도구 응답으로 돌려준 요약. 재시도 때 그대로 돌려준다
  created_at   INTEGER NOT NULL,
  UNIQUE (user_id, payload_hash)
) STRICT;

CREATE TABLE concepts (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id),
  key          TEXT NOT NULL,                      -- 영어 kebab-case. 예: deep-copy
  name         TEXT NOT NULL,
  aliases      TEXT NOT NULL DEFAULT '[]',
  search_text  TEXT NOT NULL,                      -- 이름·별칭·key를 소문자로 바꾸고 공백·기호를 지워 '|'로 이은 값 (§6.6)
  domain       TEXT,                               -- java, spring, db, network, os, ai ...
  final_answer TEXT,                               -- 가장 최근에 확정한 내 설명
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  UNIQUE (user_id, key)
) STRICT;

CREATE TABLE edges (
  user_id    TEXT NOT NULL,
  from_id    TEXT NOT NULL REFERENCES concepts(id),
  to_id      TEXT NOT NULL REFERENCES concepts(id),
  type       TEXT NOT NULL CHECK (type IN ('prerequisite', 'follow_up', 'contrast', 'part_of')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (from_id, to_id, type)
) STRICT;
CREATE INDEX edges_to ON edges (to_id);

CREATE TABLE judgments (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  concept_id TEXT NOT NULL REFERENCES concepts(id),
  session_id TEXT NOT NULL REFERENCES learning_sessions(id),
  label      TEXT NOT NULL CHECK (label IN ('맞음', '애매', '틀림', '빠짐')),
  said       TEXT,                                 -- 사용자 원문 그대로. 빠짐은 비어 있을 수 있다
  note       TEXT NOT NULL,
  created_at INTEGER NOT NULL
) STRICT;
CREATE INDEX judgments_concept ON judgments (concept_id, created_at);

CREATE TABLE followups (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  concept_id  TEXT NOT NULL REFERENCES concepts(id),
  session_id  TEXT NOT NULL REFERENCES learning_sessions(id),
  question    TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  resolved_at INTEGER
) STRICT;
CREATE INDEX followups_open ON followups (user_id, resolved_at);

CREATE TABLE cards (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL,
  concept_id     TEXT NOT NULL REFERENCES concepts(id),
  session_id     TEXT NOT NULL REFERENCES learning_sessions(id),
  rung           INTEGER NOT NULL CHECK (rung BETWEEN 1 AND 3),   -- 서버가 카드 종류로 정한다 (§9.4)
  type           TEXT NOT NULL CHECK (type IN ('ox', 'mcq', 'cloze', 'explain')),
  prompt         TEXT NOT NULL,
  code           TEXT,                             -- 코드 읽기 카드의 코드 조각
  answer         TEXT,                             -- ox: 'O'|'X', cloze: 정답 단어
  options        TEXT,                             -- mcq: [{text, correct, from_my_answer}], cloze: 보기 단어 배열
  explain        TEXT,                             -- 1~2문장 해설
  checklist      TEXT,                             -- explain 카드의 핵심 요소 배열
  status         TEXT NOT NULL CHECK (status IN ('active', 'locked', 'suspended')),
  -- ts-fsrs 5.x Card 필드
  due            INTEGER NOT NULL,
  stability      REAL NOT NULL,
  difficulty     REAL NOT NULL,
  elapsed_days   INTEGER NOT NULL,
  scheduled_days INTEGER NOT NULL,
  learning_steps INTEGER NOT NULL,
  reps           INTEGER NOT NULL,
  lapses         INTEGER NOT NULL,
  state          INTEGER NOT NULL,                 -- 0 New, 1 Learning, 2 Review, 3 Relearning
  last_review    INTEGER,
  created_at     INTEGER NOT NULL
) STRICT;
CREATE INDEX cards_queue ON cards (user_id, status, due);
CREATE INDEX cards_concept ON cards (concept_id, rung);

CREATE TABLE review_logs (
  id          TEXT PRIMARY KEY,                    -- 클라이언트가 만든 UUID. 같은 답을 다시 보내도 무시한다
  user_id     TEXT NOT NULL,
  card_id     TEXT NOT NULL REFERENCES cards(id),
  grade       INTEGER NOT NULL CHECK (grade BETWEEN 1 AND 4),
  response    TEXT,                                -- 고른 보기나 입력한 설명
  elapsed_ms  INTEGER,
  reviewed_at INTEGER NOT NULL,
  prev_card   TEXT NOT NULL                        -- 채점 전 FSRS 상태(JSON). 되돌리기용
) STRICT;
CREATE INDEX review_logs_user_time ON review_logs (user_id, reviewed_at);

CREATE TABLE push_subscriptions (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id),
  endpoint   TEXT NOT NULL UNIQUE,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_ok_at INTEGER,
  fail_count INTEGER NOT NULL DEFAULT 0
) STRICT;
CREATE INDEX push_subscriptions_user ON push_subscriptions (user_id);

CREATE TABLE reminder_slots (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id),
  local_time   TEXT NOT NULL,                      -- 'HH:MM' (KST)
  enabled      INTEGER NOT NULL DEFAULT 1,
  next_fire_at INTEGER NOT NULL                    -- 다음 발송 시각 (UTC ms)
) STRICT;
CREATE INDEX reminder_due ON reminder_slots (enabled, next_fire_at);
```

### 5.3 MVP 2에서 더하는 것 (`migrations/0002_beta.sql`)

```sql
CREATE TABLE invites (
  id           TEXT PRIMARY KEY,
  code_hash    TEXT NOT NULL UNIQUE,
  label        TEXT NOT NULL,                      -- 예: "민수"
  bind_user_id TEXT REFERENCES users(id),          -- 기기를 다 잃은 사람에게 기존 계정으로 다시 초대할 때
  created_by   TEXT NOT NULL REFERENCES users(id),
  expires_at   INTEGER NOT NULL,
  used_at      INTEGER,
  used_by      TEXT
) STRICT;

CREATE TABLE login_codes (
  code_hash  TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id),
  expires_at INTEGER NOT NULL,
  attempts   INTEGER NOT NULL DEFAULT 0
) STRICT;

CREATE TABLE llm_jobs (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id),
  kind       TEXT NOT NULL CHECK (kind IN ('grade', 'import')),
  status     TEXT NOT NULL CHECK (status IN ('queued', 'running', 'done', 'failed')),
  input      TEXT,                                 -- 가져오기 원문은 끝나면 NULL로 지운다
  result     TEXT,
  error      TEXT,                                 -- 'budget', 'refusal', 'invalid_output' ...
  attempts   INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;
CREATE INDEX llm_jobs_pending ON llm_jobs (status, updated_at);

CREATE TABLE llm_usage (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL,
  job_id            TEXT NOT NULL,
  model             TEXT NOT NULL,                 -- 실제로 응답한 모델 (fallback 포함)
  input_tokens      INTEGER NOT NULL,
  output_tokens     INTEGER NOT NULL,              -- thinking 토큰 포함
  cache_read_tokens INTEGER NOT NULL,
  cache_write_tokens INTEGER NOT NULL,
  cost_micro_usd    INTEGER NOT NULL,
  created_at        INTEGER NOT NULL
) STRICT;
CREATE INDEX llm_usage_month ON llm_usage (created_at);
CREATE INDEX llm_usage_user ON llm_usage (user_id, created_at);

CREATE TABLE card_reports (
  id         TEXT PRIMARY KEY,
  card_id    TEXT NOT NULL REFERENCES cards(id),
  user_id    TEXT NOT NULL,
  reason     TEXT NOT NULL,
  created_at INTEGER NOT NULL
) STRICT;

CREATE TABLE streak_freezes (
  user_id TEXT NOT NULL,
  day     TEXT NOT NULL,                           -- 'YYYY-MM-DD' (04:00 KST 경계)
  PRIMARY KEY (user_id, day)
) STRICT;

ALTER TABLE users ADD COLUMN daily_goal INTEGER NOT NULL DEFAULT 5;
```

XP, 스트릭, 리그는 따로 저장하지 않고 `review_logs`와 `learning_sessions`에서 계산한다 (§9.6).

### 5.4 용량 감각

10명이 각자 카드 수천 장을 쌓아도 몇 MB다. 저장 한 번에 약 20행, 복습 한 장에 약 2행을 쓴다. 하루 쓰기 10만 행, DB 500MB 한도와 비교하면 여유가 크다.

---

## 6. MCP 서버

### 6.1 엔드포인트와 인증

- 주소: `POST https://app.<도메인>/mcp/u/<토큰>`. 라우트는 모든 메서드를 받아 핸들러로 넘기고, 핸들러가 GET과 DELETE에 405를 돌려준다.
- 토큰: 256비트 무작위 값(base64url). DB에는 `HMAC-SHA256(TOKEN_PEPPER, 토큰)`만 저장한다. 설정 화면에서 발급하면 주소를 한 번만 보여 주고, 재발급하면 이전 토큰은 바로 무효가 된다. 재발급한 뒤에는 claude.ai에서 커넥터를 지우고 다시 추가해야 한다.
- 모르는 토큰이나 취소된 토큰은 본문 없이 404를 돌려준다.
- claude.ai에는 "로그인 없음(No sign in)"으로 추가한다. 개인 Pro·Max 요금제에서는 고정 헤더 인증이 일부 조직만 쓰는 베타라서 기대하지 않는다. OAuth는 MVP 3에서 붙인다.
- 요청 앞단 검사:
  - `Host`가 `app.<도메인>`이 아니면 421로 거절한다.
  - `Origin` 헤더가 있는데 `APP_ORIGIN`이 아니면 403이다. Anthropic 클라우드의 서버 간 호출에는 보통 `Origin`이 없다.
  - 본문이 256KB를 넘으면 413이다. 가장 큰 정상 요청(개념 20개, 카드 30장)이 약 52KB라서 여유를 크게 뒀다. 413은 도구 오류(`isError`)가 아니라서 Claude가 고쳐서 다시 보낼 수 없으므로, 정상 요청이 닿지 않을 만큼 넉넉하게 둔다.
- claude.ai 쪽 조건 (기획서 §5.3):
  - 공개 HTTPS와 IPv4 A 레코드가 필요하다. 호출은 폰 앱에서 쓸 때도 항상 Anthropic 클라우드(`160.79.104.0/21`)에서 온다.
  - 다른 호스트로 리다이렉트하지 않는다.
  - 도구 호출 하나는 240초 안에 끝나야 하고, 결과는 약 15만 자 이하여야 한다.

### 6.2 처리 흐름

```ts
// apps/worker/src/mcp/server.ts (요지)
import { McpServer, createMcpHandler } from '@modelcontextprotocol/server';

export const mcpHandler = createMcpHandler(
  (ctx) => {
    const deps = ctx.authInfo?.extra as unknown as McpDeps;   // 라우트가 넣은 { env, userId }
    const server = new McpServer({ name: 'moai', version: '0.1.0' });
    server.registerTool('save_learning', { description, inputSchema: SaveLearningInput, annotations }, async (input) => { /* ... */ });
    // find_concepts, get_learner_context도 같은 방식 (MVP 1)
    return server;
  },
  { legacy: 'stateless' },
);

// apps/worker/src/mcp/route.ts (요지)
app.all('/mcp/u/:token', async (c) => {
  // Host·Origin 검사 → 토큰 확인 → 본문 크기 확인(256KB) → JSON 파싱
  const user = await findUserByMcpToken(c.env, c.req.param('token'));   // MVP 0은 SPIKE_TOKEN과 비교
  if (!user) return new Response(null, { status: 404 });
  return mcpHandler.fetch(new Request(c.req.url, { method: c.req.method, headers: c.req.raw.headers, body }), {
    authInfo: { token: 'url-token', clientId: 'url-token', scopes: [], extra: { env: c.env, userId: user.id } },
    parsedBody,
  });
});
```

- `createMcpHandler`는 요청마다 팩토리로 새 서버를 만들고, 세션 없이 처리한다.
  - 2026-07-28 방식 요청은 새 경로로 처리한다.
  - 2025년 방식 요청은 `legacy: 'stateless'`(기본값)로 처리한다.
  - 그래서 claude.ai가 어느 버전으로 협상하든 같은 도구가 응답한다.
- `responseMode`는 2026-07-28 방식에만 적용된다. 2025년 방식 응답은 실제로 SSE(`event: message`) 형태로 나온다 (MVP 0 로컬 실행에서 확인). 계약 테스트는 두 방식을 다 검사하고 `text/event-stream` 응답도 받아들인다.
- `authInfo`에는 `token`, `clientId`, `scopes`가 필수다. 사용자 ID와 `env`(D1 바인딩)는 `extra`로 넘긴다. 핸들러는 모듈 범위에서 한 번만 만들고, 요청마다 다른 값은 이렇게 전달한다.
- 라우트가 본문을 먼저 읽어 크기를 확인하므로, 읽은 본문으로 `Request`를 다시 만들고 파싱한 값은 `parsedBody`로 넘긴다.
- 핸들러 자체는 Origin·Host 검사를 하지 않으므로 §6.1의 앞단 검사를 라우트에서 한다.
- 도구에서는 샘플링, elicitation, 진행 알림을 쓰지 않는다.

### 6.3 도구 목록

| 도구 | MVP | 힌트 | 하는 일 |
|---|---|---|---|
| `find_concepts` | 1 | `readOnlyHint` | 이름·별칭·key로 기존 개념을 찾는다. 저장 전에 같은 개념의 key를 재사용하게 한다 |
| `save_learning` | 0(검증), 1 | `idempotentHint` | 세션 기록 전체를 한 번에 저장한다 |
| `get_learner_context` | 1 | `readOnlyHint` | 주제나 개념 key로 과거 기록을 돌려준다. 코칭을 개인화한다 |
| `get_review_queue` | 3 | `readOnlyHint` | 채팅 복습용으로 오늘 카드를 돌려준다 |
| `submit_review` | 3 | `idempotentHint` | 채팅에서 푼 결과를 기록한다 |

도구 설명문 초안은 부록 A에 있다. 카드 생성 규칙은 프로젝트 지침이 아니라 도구 설명에 둔다. 서버에서 고치면 친구 모두의 세션에 바로 반영된다.

### 6.4 `save_learning` 입력 스키마

`packages/shared/src/save-learning.ts`에 둔다 (요지).

```ts
const Key = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).max(60);
const Label = z.enum(['맞음', '애매', '틀림', '빠짐']);

// 카드에는 rung(단계)이 없다. 서버가 rungOf(card)로 정한다 (§9.4). 보내면 버려진다.
const Card = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ox'), concept: Key, prompt: z.string().max(500),
             code: z.string().max(1500).optional(), answer: z.enum(['O', 'X']), explain: z.string().max(400) }),
  z.object({ type: z.literal('mcq'), concept: Key, prompt: z.string().max(500),
             code: z.string().max(1500).optional(),
             options: z.array(z.object({ text: z.string().max(300), correct: z.boolean(),
                                         from_my_answer: z.boolean().optional() })).min(3).max(4),
             explain: z.string().max(400) }),
  z.object({ type: z.literal('cloze'), concept: Key, prompt: z.string().max(500),
             answer: z.string().max(40), choices: z.array(z.string().max(40)).min(3).max(5),
             explain: z.string().max(400) }),
  z.object({ type: z.literal('explain'), concept: Key, prompt: z.string().max(300),
             checklist: z.array(z.string().max(60)).min(2).max(5) }),
]);

export const SaveLearningInput = z.object({
  topic: z.string().min(1).max(200),
  source: z.enum(['claude.ai', 'claude-code']).default('claude.ai'),
  final_answer: z.string().max(2000).optional(),
  key_terms: z.array(z.string().max(40)).max(10).default([]),
  concepts: z.array(z.object({
    key: Key, name: z.string().max(60), aliases: z.array(z.string().max(60)).max(5).default([]),
    domain: z.string().max(20).optional(), final_answer: z.string().max(2000).optional(),
  })).min(1).max(20),
  edges: z.array(z.object({ from: Key, to: Key,
    type: z.enum(['prerequisite', 'follow_up', 'contrast', 'part_of']) })).max(40).default([]),
  judgments: z.array(z.object({ concept: Key, label: Label,
    said: z.string().max(1000).optional(), note: z.string().max(500) })).max(40).default([]),
  followups: z.array(z.object({ concept: Key, question: z.string().max(300) })).max(10).default([]),
  cards: z.array(Card).min(1).max(30),
});
```

스키마만으로 못 거르는 것은 도메인 검사에서 거른다.

- 카드·판정·연결·질문이 가리키는 key는 `concepts`에 있거나, 이 사용자의 기존 개념이어야 한다.
- 객관식은 정답이 정확히 1개다.
- 빈칸은 `prompt`에 `____`가 정확히 한 번 있고, `choices`에 `answer`가 들어 있다.
- 연결은 `from`과 `to`가 달라야 한다.
- 설명하기 카드는 그 개념의 최종 버전이 있을 때만 받는다. 최종 버전은 이번 입력의 개념 `final_answer`, 세션 `final_answer`, 기존 값 중 하나다. 세션 `final_answer`를 썼으면 그 개념의 `final_answer`로도 저장한다.
- 설명하기 카드가 있는 개념에는 1·2단계 카드(이번 입력 또는 기존 카드)도 있어야 한다. 그래야 사다리로 설명하기까지 올라갈 수 있다.
- `from_my_answer` 보기는 오답이어야 하고, 개념 key는 한 번만 선언한다.

카드 단계(rung)는 Claude가 정하지 않는다. `rungOf(card)`가 카드 종류로 정한다.

| 카드 | 단계 |
|---|---|
| 코드 없는 ox, mcq | 1 알아보기 |
| cloze, 코드가 있는 ox·mcq | 2 떠올리기 |
| explain | 3 설명하기 |

단계를 입력으로 받으면 "코드 OX인데 1단계"처럼 서로 어긋나는 값이 생기고, 그때마다 도구 오류가 나서 Claude가 다시 보내야 한다. 종류에서 정하면 그런 오류가 없다. 스키마 상한의 최악값(카드 30장 × 긴 보기)은 256KB 본문 상한보다 커질 수 있지만, 실제 Claude 요청은 최대 크기 견본이 약 52KB라 닿지 않는다.

검사에 걸리면 `isError: true`와 함께 고칠 점을 한국어 목록으로 돌려준다. Claude가 읽고 고쳐서 다시 부를 수 있다.

### 6.5 `save_learning` 저장 절차

1. 입력을 정규화(키 정렬, 공백 정리)해서 SHA-256을 구한다. 같은 사용자에게 같은 `payload_hash`가 있으면, 그때의 `summary`를 그대로 돌려주고 끝낸다. Claude가 재시도해도 중복이 생기지 않는다.
2. 개념 key를 기존 개념과 맞춘다. 있으면 이름·별칭·`final_answer`를 갱신하고, 없으면 새로 만든다.
3. 카드마다 `rungOf(card)`로 단계를 정하고, FSRS 초기 상태를 `createEmptyCard(now)`로 만든다. 상태는 사다리 규칙(§9.4)을 따른다: 개념의 가장 낮은 단계 카드만 `active`, 나머지는 `locked`. 설명하기 카드는 언제나 `locked`로 저장한다.
4. 아래를 **`DB.batch()` 한 번**으로 쓴다. batch는 하나의 트랜잭션이라 일부만 저장되지 않는다.
   - 테이블마다 `INSERT ... SELECT ... FROM json_each(?1)` 한 문장으로 쓴다. 모든 행을 JSON 하나로 묶어 바인딩 1개로 보내므로, 문장당 바인딩 개수 제한과 호출당 쿼리 50개 제한에 걸리지 않는다.
   - 대상: 세션, 개념 upsert, 연결, 판정, 다음 질문, 카드. 약 8문장이다.
5. 응답:
   - 텍스트 예: "개념 5개(새 3·기존 2), 카드 7장, 다음에 볼 질문 2개를 저장했어요. 첫 복습은 내일 08:10 알림으로 와요."
   - `structuredContent`: `{ session_id, counts, review_url }`.

### 6.6 `find_concepts`

- 입력: `{ query: string (≤200), limit?: number (≤20, 기본 10) }`. `query`에는 주제나 쉼표로 나눈 개념 이름을 넣는다.
- 방법: `query`를 쉼표로 나눠 이름마다 따로 찾는다. 각 이름을 소문자로 바꾸고 공백·기호를 지운 뒤, 저장해 둔 `concepts.search_text`에 `instr(search_text, ?) > 0`으로 찾는다. 맞은 개념과 바로 연결된 개념(1단계)도 함께 돌려준다.
  - `LIKE`를 쓰지 않는 이유: D1은 LIKE 패턴을 50바이트로 제한한다. 한글은 UTF-8로 3바이트라 17자 정도면 넘는다.
  - 저장할 때 같은 방식으로 정규화해 두므로 "깊은복사"로 찾아도 "깊은 복사"가 걸린다.
- 출력: `[{ key, name, aliases, state, last_judgment }]`. 결과가 없으면 "새 개념으로 저장하면 돼요"라고 알린다.

### 6.7 `get_learner_context`

- 입력: `{ topic?: string, concept_keys?: string[] (≤10) }`. 둘 중 하나는 있어야 한다.
- 출력: 개념마다 이름, 상태, 확정 최종 버전, 최근 판정 5개(원문과 메모), 약한 카드(최근 틀린 카드, 내 옛 오답을 다시 고른 카드), 연결 개념, 열린 질문. 한국어 마크다운이고 8천 자 이하다. 예시는 부록 D에 있다.
- 읽기 쿼리는 `DB.batch()` 하나로 묶어 왕복 횟수를 줄인다.

### 6.8 성능 예산

| 항목 | 목표 | 방법 |
|---|---|---|
| CPU (tools/list, tools/call) | p99 7ms 미만 | 큰 스키마의 JSON Schema는 모듈 범위에서 한 번만 만든다. 행 단위 반복 대신 `json_each` 일괄 쓰기 |
| 응답 시간 | p95 1.5초 미만 | 읽기 batch. 필요하면 Smart Placement |
| 결과 크기 | 8천 자 이하 | 출력 상한 |
| LLM 호출 | 없음 | MCP 도구 안에서는 서버 LLM을 부르지 않는다 |

---

## 7. REST API (PWA용)

### 7.1 공통 규칙

- 인증: `__Host-sid` 쿠키 (§8.2). 로그인 전 엔드포인트는 따로 표시한다.
- 상태를 바꾸는 요청(POST·PUT·PATCH·DELETE)은 `Origin`이 `APP_ORIGIN`과 같아야 한다 (CSRF 방어).
- 요청 본문은 `packages/shared`의 zod 스키마로 검증한다.
- 오류는 `{ "error": { "code": "...", "message": "사용자에게 보여 줄 한국어 문장" } }` 형식이다.
- 모든 쿼리는 세션의 `user_id`로 범위를 제한한다.

### 7.2 엔드포인트

| MVP | 메서드·경로 | 하는 일 |
|---|---|---|
| 1 | `POST /api/setup` (로그인 전) | `BOOTSTRAP_CODE`와 이름으로 오너 계정을 만든다. 오너가 이미 있으면 410 |
| 1 | `GET /api/me` | 내 정보, 설정 |
| 1 | `GET /api/today` | 오늘 남은 카드 수, 예상 시간, 최근 저장 세션, 열린 질문 |
| 1 | `GET /api/queue?size=8` | 오늘 복습할 카드 (§9.2). 기기에서 채점할 수 있게 정답도 함께 준다 |
| 1 | `POST /api/reviews` | 답안 묶음 기록, 최대 20건 (§9.5) |
| 1 | `GET /api/sessions`, `GET /api/sessions/:id` | 저장 기록과 그 안의 개념·판정·카드 |
| 1 | `POST /api/cards/:id/suspend`, `/unsuspend` | 카드 끄기와 다시 켜기 |
| 1 | `GET /api/reminders`, `PUT /api/reminders` | 알림 시간 (최대 3개) |
| 1 | `POST /api/push/subscriptions`, `DELETE /api/push/subscriptions` | 푸시 구독 저장과 해제 (endpoint 기준) |
| 1 | `POST /api/push/test` | 지금 테스트 알림 보내기 |
| 1 | `POST /api/mcp-token`, `DELETE /api/mcp-token` | 커넥터 URL 발급·재발급, 취소 |
| 2 | `POST /api/join` (로그인 전) | 초대 코드와 이름으로 가입 |
| 2 | `POST /api/login-codes`, `POST /api/login` (로그인 전) | 기기 로그인 코드 만들기와 쓰기 |
| 2 | `POST /api/logout` | 현재 세션 끝내기 |
| 2 | `GET /api/map`, `GET /api/concepts/:key` | 지식 지도, 개념 상세 |
| 2 | `GET /api/stats`, `GET /api/league` | 스트릭·XP·목표, 이번 주 친구 리그 |
| 2 | `POST /api/cards/:id/report`, `PATCH /api/cards/:id` | 카드 신고(즉시 정지), 카드 수정 |
| 2 | `POST /api/reviews/:id/undo` | 마지막 채점 되돌리기 |
| 2 | `POST /api/cards/:id/grade-ai`, `GET /api/jobs/:id` | AI 채점 요청(202)과 결과 확인 |
| 2 | `POST /api/import` | 붙여넣기 가져오기 요청(202) |
| 2 | `GET /api/export`, `DELETE /api/me` | 내 데이터 내보내기(JSON), 계정 삭제 |
| 2 | `POST /api/admin/invites`, `GET /api/admin/invites`, `GET /api/admin/usage` | 초대 발급과 목록, LLM 사용량 (오너만) |

---

## 8. 인증과 초대

### 8.1 목표

- 초대받은 사람만 가입한다.
- 비밀번호, 이메일 발송, 외부 로그인(OAuth 앱)이 없다.
- 홈 화면 앱 밖으로 나가는 리다이렉트가 없다. iOS에서는 Safari와 홈 화면 앱의 저장소가 따로라서 외부 로그인 리다이렉트가 잘 깨진다.

### 8.2 세션

- 세션 토큰은 256비트 무작위 값이고, DB에는 해시만 저장한다.
- 쿠키: `__Host-sid`, `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`. 180일이고 쓸 때마다 연장한다.
- 기기마다 세션이 따로다.

### 8.3 MVP 1: 오너 계정

- 처음 배포한 뒤 `/setup`에서 `BOOTSTRAP_CODE`와 이름을 넣으면 오너 계정과 세션이 생긴다. 오너가 생긴 뒤에는 `/api/setup`이 410을 돌려준다.
- 홈 화면에 추가한 앱 안에서 `/setup`을 하면 쿠키 문제가 생기지 않는다.

### 8.4 MVP 2: 초대 코드로 가입

1. 오너가 관리자 화면에서 초대를 만든다.
   - 10자 코드(Crockford Base32, 약 50비트), 1회용, 7일 유효, 해시로만 저장한다.
   - 라벨(예: "민수")을 붙인다.
2. 카카오톡으로 코드와 안내 링크(`https://app.<도메인>`)를 보낸다. 코드는 링크에 넣지 않는다. 그래야 로그에 남지 않고, 사용자가 홈 화면 앱 안에서 직접 입력하게 된다.
3. 친구는 Safari나 Chrome에서 주소를 열고, 안내에 따라 홈 화면에 추가한다.
4. 홈 화면 앱을 열고 코드와 이름을 입력한다. `POST /api/join`이 계정과 세션을 만들고 초대를 사용 처리한다.
5. 코드 입력은 같은 코드로 5번 틀리면 막고, IP별 시도 횟수도 제한한다.

### 8.5 MVP 2: 다른 기기 로그인

- 로그인된 기기의 설정 화면에서 "다른 기기 로그인 코드"를 누르면 8자리 숫자가 나온다. 10분 유효, 1회용, 5번 시도할 수 있다.
- 새 기기(또는 홈 화면 앱)에서 그 코드를 입력하면 그 기기의 세션이 생긴다.
- 기기를 다 잃었으면 오너가 `bind_user_id`를 넣은 초대를 새로 만든다. 그 초대로 기존 계정에 다시 로그인한다.

### 8.6 커넥터 URL (MVP 1부터)

- 설정 화면의 "커넥터 URL 만들기"가 토큰을 발급하고 주소를 한 번만 보여 준다. 복사 버튼과 안내를 함께 둔다.
  1. 웹 claude.ai → Customize → Connectors → Add custom connector
  2. 이름을 정하고 주소를 넣은 뒤 "No sign in"을 고른다.
  3. 도구 3개를 "Always allow"로 바꾼다. 그래야 폰에서 승인 버튼을 누르지 않는다.
  4. 폰 앱에서는 자동으로 쓸 수 있다.
- 재발급하면 이전 주소는 바로 막힌다.

---

## 9. 복습 엔진

### 9.1 FSRS 설정

```ts
import { fsrs, generatorParameters, createEmptyCard, Rating } from 'ts-fsrs';

export const scheduler = fsrs(generatorParameters({
  request_retention: 0.9,    // 목표 기억률 90%
  maximum_interval: 180,     // 면접 준비 기간에 맞춰 최대 180일
  enable_fuzz: true,
  enable_short_term: true,   // 새 카드는 1분·10분 학습 단계, 복습 중 틀린 카드는 10분 재학습 단계를 거친다 (ts-fsrs 기본값)
}));
// 채점: scheduler.next(card, reviewedAt, grade) → { card, log }
// 미리보기: scheduler.repeat(card, now) → 등급별 다음 상태 (설명하기 버튼의 간격 표시)
```

### 9.2 오늘 큐

`GET /api/queue?size=8`의 규칙:

1. 후보는 `status = 'active'`이고 `due <= now`인 카드다. 새 카드(`state = 0`)는 오늘 처음 본 새 카드 수가 `daily_new_limit`보다 적을 때만 넣는다.
2. 순서:
   1. 학습·재학습 중인 카드(state 1, 3)를 `due` 순으로
   2. 복습 카드(state 2)를 `due` 순으로, 하루 `daily_review_limit`까지
   3. 새 카드를 만든 순서대로
3. **같은 개념은 하루 1장**이다. 오늘 이미 복습한 개념의 다른 카드는 뺀다. 학습 단계의 같은 카드가 다시 나오는 것은 괜찮다.
4. 앞에서 `size`장을 돌려준다. 설명하기 카드는 등급별 다음 간격을 함께 준다.

### 9.3 채점과 FSRS 등급

| 카드 | 결과 | 등급 |
|---|---|---|
| OX·객관식·빈칸 (기기에서 채점) | 틀림 | Again (1) |
| | 맞음, 15초 넘게 걸림 | Hard (2) |
| | 맞음 | Good (3) |
| | 맞음 + "너무 쉬웠어요"를 누름 | Easy (4) |
| 설명하기 (MVP 2) | 자가 채점 버튼 4개 | 누른 등급 |
| | AI 채점 | AI가 등급을 제안하고, 사용자가 확정한다 |

기획서 v0.2에 있던 "5초 안에 정답이면 쉬움"은 뺐다. 객관식은 찍어서 빨리 맞힐 수도 있는데, 그러면 간격이 지나치게 늘어난다. 그래서 쉬움은 사용자가 직접 누를 때만 준다.

### 9.4 카드 사다리

- 카드 단계는 `rungOf(card)`가 카드 종류로 정한다 (§6.4 표).
- 저장할 때 개념마다 가장 낮은 단계의 카드만 `active`, 더 높은 단계는 `locked`다. 설명하기 카드는 그 개념에 다른 카드가 없어도 언제나 `locked`로 저장한다 (도메인 검사가 1·2단계 카드를 함께 요구한다).
- 복습을 기록한 뒤 그 개념을 검사한다. 지금 열린 가장 높은 단계 r의 활성 카드가 모두 `stability >= 7`(일)이면, **r보다 높은 잠긴 단계 중 가장 낮은 단계**의 카드를 `active`로 바꾸고 `due = now`로 둔다. 2단계 카드가 없는 개념도 1단계에서 3단계로 올라갈 수 있다.
- MVP 1은 2단계까지만 연다. 3단계(설명하기)는 MVP 2에서 화면이 생길 때 열기 시작한다.
- 틀렸을 때 단계를 내리는 규칙은 넣지 않는다. FSRS가 간격을 줄이는 것으로 충분한지 MVP 2 데이터를 보고 정한다.

### 9.5 답안 기록과 오프라인 큐

PWA 쪽:

- 세션을 시작하면 받은 큐를 IndexedDB에 저장한다.
- 답할 때마다 `{ id: crypto.randomUUID(), card_id, grade, response, elapsed_ms, reviewed_at }`를 outbox에 넣고 바로 보내 본다.
- 실패하면 `online` 이벤트나 다음 실행 때 다시 보낸다. 한 번에 20건씩 나눠 보낸다. 화면은 네트워크를 기다리지 않는다.

서버 쪽 (`POST /api/reviews`):

1. 이미 기록된 `id`는 건너뛴다. 같은 답을 여러 번 보내도 안전하다.
2. 같은 카드의 답이 여러 개면 `reviewed_at` 순으로 처리한다.
3. 채점 시각은 `reviewed_at`을 쓰되, 그 카드의 `last_review`와 서버 현재 시각 사이로 자른다.
4. `scheduler.next()`로 새 상태를 구한다. 카드 갱신과 `review_logs` 기록(`prev_card`에 채점 전 상태)을 한 번의 `DB.batch()`로 쓴다.
5. 해당 개념의 사다리 잠금 해제를 검사한다.

### 9.6 스트릭·XP·리그 (MVP 2)

- XP: 복습 정답 10, 오답 2, 설명하기 완료 20, 학습 세션 저장 30. `review_logs`와 `learning_sessions`에서 계산한다.
- 스트릭: 하루(04:00 KST 경계)에 `daily_goal`(기본 5장) 이상 복습한 날이 이어진 수. 빠진 날이 있으면 그 주의 프리즈 1회를 자동으로 쓴다 (`streak_freezes`).
- 주간 리그: 월요일 04:00 KST에 시작해서 친구 전체를 XP 순으로 보여 준다.

### 9.7 개념 상태와 지식 지도 (MVP 2)

| 상태 | 색 | 조건 |
|---|---|---|
| 아직 안 배움 | 회색 점선 | 카드가 없다 (다음에 볼 질문으로만 생긴 개념) |
| 익숙함 | 초록 | 활성 카드가 있고, 모두 `stability >= 7`이며, 최근 14일 동안 틀린 적이 없다 |
| 흔들림 | 노랑 | 그 밖 전부 (방금 배운 개념, 틀렸거나 애매했던 개념 포함) |

- 상태는 Claude가 정하지 않고 서버가 계산한다. 판정 이력은 개념 상세에서 보여 준다.
- "이어서 공부하기"는 아래 형식의 프롬프트를 복사한다. 코치 지침(부록 B)이 `[모아이:key]`를 보면 `get_learner_context`를 먼저 부른다.

```
[모아이:deep-copy] 깊은 복사와 방어적 복사는 어떻게 다른가요? 먼저 제 말로 답해 볼게요.
```

---

## 10. 리마인드 (웹 푸시)

### 10.1 구독과 알림 시간

- 알림 권한은 사용자가 버튼을 눌렀을 때만 요청한다. 그다음 `pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: VAPID_PUBLIC_KEY })`의 결과를 `POST /api/push/subscriptions`로 저장한다.
- iOS는 16.4 이상이고 홈 화면에 추가한 PWA만 웹 푸시를 받는다. 온보딩에서 안내한다.
- 알림 시간은 사용자당 최대 3개이고 `'HH:MM'`(KST)으로 저장한다. `next_fire_at`에는 다음 발송 시각을 UTC로 계산해 넣는다.
  - KST는 UTC+9이고 일광 절약 시간이 없어서 고정 오프셋으로 계산한다.
  - 예: 08:10 KST는 전날 23:10 UTC, 22:30 KST는 13:30 UTC다.

### 10.2 매분 Cron의 푸시 처리

```
1. SELECT * FROM reminder_slots
   WHERE enabled = 1 AND next_fire_at <= :now
   ORDER BY next_fire_at LIMIT :PUSH_SLOTS_PER_TICK        -- 기본 2
2. 슬롯마다:
   a. 다음 날 같은 시각을 계산해서 먼저 넘긴다
      UPDATE reminder_slots SET next_fire_at = :next WHERE id = :id AND next_fire_at = :old
      바뀐 행이 없으면 다른 실행이 처리한 것이니 건너뛴다. (최대 한 번 발송)
   b. :now - :old 가 30분을 넘으면 보내지 않는다. 장애 뒤에 늦은 알림이 몰려 오는 것을 막는다.
   c. 오늘 큐 개수를 센다. 0이면 보내지 않는다.
   d. 메시지를 만든다. 예: 제목 "오늘 복습 8장", 본문 "약 3분 · 깊은 복사가 흔들려요", url "/review?from=push"
   e. 구독마다 buildPushPayload({ data: { title, body, url }, options: { ttl: 14400 } },
      { endpoint, expirationTime: null, keys: { p256dh, auth } }, vapid)로 암호화하고, fetch(endpoint, payload)로 보낸다.
      ttl을 빼면 이 라이브러리는 60초로 보낸다.
   f. 201·200이면 last_ok_at을 갱신하고, 404·410이면 구독을 지운다. 그 밖이면 fail_count를 올리고, 5번 연속이면 지운다.
```

- 한 틱에 보내는 슬롯 수는 MVP 0에서 잰 푸시 1건의 CPU로 정한다. 10명이 모두 같은 분을 골라도 몇 분 안에 다 나간다.
- CPU가 빠듯하면 VAPID 헤더를 푸시 서비스별로 캐시한다. 이 라이브러리는 `vapidHeaders`와 `encryptNotification`도 따로 내보낸다.
- `data`의 JSON은 3,993바이트 이하여야 한다 (이 라이브러리의 평문 상한).

### 10.3 서비스 워커

- `push`: 받은 데이터로 항상 `showNotification(title, { body, tag: 'daily', data: { url } })`를 부른다. iOS는 푸시마다 눈에 보이는 알림을 요구한다.
- `notificationclick`: 열린 창이 있으면 그 창으로 가고, 없으면 `url`을 연다.

### 10.4 같은 Cron의 다른 일

| 주기 | 일 | MVP |
|---|---|---|
| 매분 | 푸시 처리 (§10.2) | 1 |
| 매분 | 밀린 LLM 작업 1건 처리 (§11.3) | 2 |
| 매시 0분 | 만료된 세션·로그인 코드 삭제, 끝난 가져오기 작업의 원문 삭제 | 1 |

한 실행에서 하는 일은 이 순서대로 하고, CPU를 많이 쓰는 일은 한 실행에 하나만 한다.

---

## 11. 서버 LLM (MVP 2)

서버의 Claude API는 **설명하기 AI 채점**과 **붙여넣기 가져오기**에만 쓴다. 캡처는 사용자 구독에서 일어나므로 서버 비용이 없다.

### 11.1 모델과 호출 공통

- 키는 내 Console API 키(`ANTHROPIC_API_KEY`)다. 브라우저로 보내지 않고, 내 Max 구독 인증으로 대신하지 않는다.
- 모델은 설정값 `GRADER_MODEL`이고 기본값은 `claude-opus-5-5`다.
  - Opus 5.5는 thinking을 끌 수 없어서 `effort`를 `low`로 명시한다 (기본값은 `medium`).
  - 관리자 사용량 화면에서 실제 1회 비용(thinking 포함)을 본 뒤, 오너가 Sonnet 5.5나 Haiku 5.5로 바꿀 수 있다. 바꾸는 것은 설정 하나다.
- 거절 대비: 서버 측 fallback(`fallbacks: 'default'`, 베타 헤더 `server-side-fallback-2026-07-01`)을 켠다. 안전 분류기가 거절하면 Anthropic이 권장하는 다른 모델로 같은 요청을 다시 처리한다.
- 결과 JSON은 structured outputs로 받는다. 강제 `tool_choice`는 Sonnet 5.5와 Opus 5.5에서 400 에러가 나므로 쓰지 않는다.

```ts
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';

// parse()는 JSON이 잘리거나 스키마에 안 맞으면 예외를 던져 stop_reason을 볼 수 없다.
// 그래서 create()에 같은 output_config.format을 넘기고, stop_reason을 먼저 본 뒤 직접 검증한다.
const res = await client.beta.messages.create({
  model: env.GRADER_MODEL,                         // 기본 'claude-opus-5-5'
  max_tokens: 4096,                                // 가져오기는 16000
  betas: ['server-side-fallback-2026-07-01'],
  fallbacks: 'default',
  output_config: { effort: 'low', format: betaZodOutputFormat(GradeResult) },
  system: [{ type: 'text', text: GRADER_SYSTEM, cache_control: { type: 'ephemeral' } }],
  messages: [{ role: 'user', content: gradingInput }],
});
if (res.stop_reason === 'refusal') { /* 작업 실패: error = 'refusal' */ }
if (res.stop_reason === 'max_tokens') { /* 작업 실패: error = 'truncated' */ }
const text = res.content.find((block) => block.type === 'text')?.text ?? '';
const parsed = GradeResult.safeParse(safeJsonParse(text));
if (!parsed.success) { /* 작업 실패: error = 'invalid_output' */ }
```

- 클라이언트는 첫 사용 때 만들고 재사용한다. `maxRetries`는 1이다.
- structured outputs가 지원하는 JSON Schema는 범위가 제한될 수 있다. 그래서 응답은 서버에서 zod로 검증한다 (위 코드의 `safeParse`).
- 채점 기준(시스템 프롬프트, 부록 C)은 고정 문자열로 두고 캐시 지점을 건다. Opus 5.5는 512토큰 이상의 앞부분을 캐시한다. 카드의 최종 버전, 체크리스트, 사용자 답은 캐시 지점 뒤에 둔다.

### 11.2 설명하기 AI 채점

- 입력: 질문, 내가 확정한 최종 버전, 체크리스트, 사용자가 쓴 설명.
- 출력 스키마:

```ts
const GradeResult = z.object({
  sentences: z.array(z.object({ quote: z.string(), label: z.enum(['맞음', '애매', '틀림', '빠짐']), reason: z.string() })),
  top_down: z.object({ ok: z.boolean(), note: z.string() }),      // 두괄식
  missing: z.array(z.string()),                                    // 빠진 체크리스트 항목
  coaching_question: z.string(),                                   // 정답 대신 던질 질문 하나
  suggested_grade: z.enum(['again', 'hard', 'good', 'easy']),
});
```

- 화면은 문장별 판정, 빠진 항목, 질문 하나를 보여 준다. 모범답안은 보여 주지 않는다.
- 사용자가 등급을 확정해야 FSRS에 들어간다.
- 화면에 "AI 판정이며 틀릴 수 있어요"를 표시한다 (Commercial Terms의 안내 의무).

### 11.3 작업 테이블 처리

채점은 5~20초 걸린다. 폰에서 PWA가 백그라운드로 가면 요청이 끊길 수 있다. 그래서 요청과 실행을 나눈다.

```
POST /api/cards/:id/grade-ai
  → llm_jobs(status='queued') 생성 → ctx.waitUntil(runJob(id)) → 202 { job_id }
  → PWA는 GET /api/jobs/:id 를 1.5초마다 확인 (최대 60초)

runJob(id):
  1. UPDATE llm_jobs SET status='running', attempts=attempts+1, updated_at=:now
     WHERE id=:id AND status='queued'          -- 바뀐 행이 1개일 때만 진행 (중복 실행 방지)
  2. 예산 확인 (§11.5). 넘었으면 failed, error='budget'
  3. API 호출 → 결과 검증 → result, llm_usage 저장 → done
  4. 실패하면 attempts < 3이면 queued로 되돌리고, 아니면 failed

매분 Cron:
  1. 오래 멈춘 작업을 되돌린다
     UPDATE llm_jobs SET status='queued' WHERE status='running' AND updated_at < :stale
     :stale은 채점 3분 전, 가져오기 15분 전 (가져오기는 정상이어도 몇 분 걸릴 수 있다)
  2. queued 상태로 1분 넘게 남은 작업을 1건 집어 runJob 실행
```

- `waitUntil`은 응답을 보낸 뒤 최대 30초까지 돈다고 알려져 있다. 그 안에 못 끝나도 Cron이 이어 받는다. MVP 2 착수 때 이 시간을 확인한다.
- 가져오기는 오래 걸릴 수 있어서 `waitUntil` 없이 Cron만 처리한다. Cron의 대기 시간(벽시계)은 CPU 한도와 따로 세고, Anthropic 응답을 기다리는 시간은 CPU에 들어가지 않는다.

### 11.4 붙여넣기 가져오기

- 입력은 대화 텍스트 6만 자 이하다. 같은 텍스트의 해시가 이미 있으면 그 결과를 돌려준다.
- 프롬프트:
  - 대화에 있는 내용만 쓴다.
  - 사용자가 틀린 설명은 원문 그대로 `judgments`에 넣는다.
  - 카드 규칙은 부록 A와 같다.
- 출력 스키마는 `SaveLearningInput`과 같다. 검증을 통과하면 `save_learning`과 같은 저장 함수를 쓴다 (`source = 'import'`).
- 끝나면 원문(`llm_jobs.input`)을 지우고 "가져오기 완료: 카드 9장" 푸시를 보낸다.

### 11.5 예산 가드

- 비용 = 토큰 수 × 코드에 둔 단가표(모델별 입력·출력·캐시 읽기·캐시 쓰기). `usage`의 출력 토큰에는 thinking이 들어 있다.
- 사용자별 이번 달(UTC 기준) 합계가 `LLM_USER_CAP_USD`(6)를 넘거나, 전체 합계가 `LLM_MONTHLY_CAP_USD`(90)를 넘으면 새 작업을 받지 않는다. 화면에는 "이번 달 AI 채점 한도에 닿았어요. 자가 채점으로 진행해요."를 보여 준다.
- Console에서도 지출 한도를 걸 수 있으면 건다.
- 기획서 §10.1의 비용 추정은 가정이다. 관리자 사용량 화면의 실측값으로 바꾼다.

---

## 12. PWA

### 12.1 화면

| MVP | 화면 | 내용 |
|---|---|---|
| 1 | 설정 (`/setup`) | 오너 계정 만들기 |
| 1 | 오늘 (`/`) | 남은 카드 수와 예상 시간, "시작" 버튼, 최근 저장 세션, 열린 질문 |
| 1 | 복습 (`/review`) | 카드 한 장씩. 정답 확인 → 해설 → 다음. 끝나면 결과와 "틀린 카드 다시 보기" |
| 1 | 저장 기록 (`/sessions`, `/sessions/:id`) | 세션별 개념·판정·카드, 카드 끄기 |
| 1 | 설정 (`/settings`) | 알림 시간, 알림 켜기·테스트, 커넥터 URL, 코치 지침 복사 |
| 2 | 가입·로그인 (`/join`, `/login`) | 초대 코드, 기기 로그인 코드 |
| 2 | 온보딩 (`/welcome`) | 4단계 체크리스트 |
| 2 | 지식 지도 (`/map`), 개념 (`/concepts/:key`) | 상태 3색 지도, 판정 이력, 이어서 공부하기 |
| 2 | 리그 (`/league`) | 스트릭, XP, 이번 주 순위 |
| 2 | 가져오기 (`/import`) | 붙여넣기, 진행 상태 |
| 2 | 관리자 (`/admin`) | 초대, 사용량 |

### 12.2 복습 화면 규칙

- 누워서나 지하철에서 한 손으로 쓴다고 보고 만든다. 주요 버튼은 화면 아래쪽 1/3에 두고, 터치 영역은 48px 이상이다.
- 카드는 한 화면에 한 장이다. 답을 고르면 바로 맞음·틀림과 해설이 나온다.
- 객관식 보기 순서는 매번 섞는다. 내가 예전에 했던 오답을 고르면 "어젯밤 내가 한 설명이에요" 표시를 붙인다.
- 빈칸은 입력 대신 보기를 누른다. 지하철에서 타이핑하기 어렵기 때문이다.
- 코드는 고정폭 글꼴로, 줄바꿈 없이 가로 스크롤로 보여 준다.
- 기본 세션은 8장, 약 3분이다. 밀렸을 때는 "가볍게 5장"을 고를 수 있다.
- 다크 모드를 지원하고, 동작 줄이기 설정을 따른다.

### 12.3 오프라인과 캐시

- 서비스 워커(`vite-plugin-pwa`의 `injectManifest`)가 앱 셸을 캐시한다.
- 오늘 큐는 IndexedDB에 저장하고, 답안 outbox는 §9.5를 따른다.
- API 응답은 캐시하지 않는다. 큐만 따로 저장한다.

---

## 13. 운영

### 13.1 배포

- GitHub Actions:
  - `.github/workflows/ci.yml`: main·`claude/**` 브랜치 push와 PR마다 `npm ci` → 타입 검사 → 테스트. (MVP 1부터 웹 빌드를 더한다.)
  - `.github/workflows/deploy.yml`: main에 머지되거나 직접 실행하면 테스트 → `wrangler d1 migrations apply moai --remote` → `wrangler deploy`.
    - 저장소 비밀값 `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`가 없으면 경고만 남기고 건너뛴다.
    - `wrangler.jsonc`에 자리표시자(예시 도메인, 0으로 된 database_id)가 남아 있으면 실패하고 이유를 알린다.
  - 앱 비밀값(`SPIKE_TOKEN`, `VAPID_PRIVATE_KEY`, 이후 `TOKEN_PEPPER` 등)은 GitHub에 두지 않고 `wrangler secret put`으로 Cloudflare에 한 번 넣는다.
- 환경은 로컬(`wrangler dev`, 로컬 D1)과 운영 두 개다. 10명 규모라 스테이징은 두지 않는다.
- 마이그레이션은 항상 로컬 D1에 먼저 적용해서 테스트하고 올린다.

### 13.2 백업

- D1 Time Travel이 7일 안의 시점으로 되돌려 준다.
- 주 1회 `wrangler d1 export moai --remote --output=<파일>`로 내보낸다. 친구들 데이터가 들어 있으므로 레포나 공개 저장소에 올리지 않는다.

### 13.3 Cloudflare 존 설정 체크리스트

| 항목 | 설정 | 이유 |
|---|---|---|
| DNS | `app.<도메인>`은 프록시된 레코드, IPv4 A 레코드 있음 | claude.ai 커넥터는 IPv4만 쓴다 |
| 리다이렉트 | `app.<도메인>`에 리다이렉트 규칙 없음, 끝 슬래시 리다이렉트 없음 | 리다이렉트하면 커넥터가 깨진다 |
| Bot Fight Mode | 존 전체에서 끈다 | Free 플랜은 경로별 예외가 안 된다 |
| AI 봇 차단 설정 | Security의 Bots / AI Crawl Control에서 `/mcp`로 오는 Anthropic 에이전트 트래픽을 막지 않는지 확인 | MCP 호출이 막힐 수 있다 (MVP 0 확인 항목 6) |
| WAF·속도 제한 규칙 | `/mcp/*`에는 걸지 않는다. 걸어야 하면 Anthropic IP 대역을 Skip 예외로 둔다 | 403·429가 나면 연결이 끊긴다 |
| `workers.dev` | 끈다 (`workers_dev: false`) | 주소가 하나여야 한다 |

### 13.4 로그와 지표

- 호출 로그는 MVP 1부터 끈다 (§4.3). 직접 남기는 로그는 이벤트 이름, 사용자 ID, 도구 이름, 걸린 시간만 남긴다. URL과 본문은 남기지 않는다.
- 대시보드 지표에서 CPU 시간 p50·p99, 오류율, D1 읽기·쓰기 행 수를 주 1회 본다.
- MVP 2 관리자 화면에 최근 7일 도구 호출 실패 수, 푸시 실패 수, LLM 지출을 보여 준다.

### 13.5 테스트

| 종류 | 대상 |
|---|---|
| 단위 | zod 스키마(실제 Claude 페이로드 견본), 도메인 검사, 등급 매핑, 큐 규칙, 사다리, 다음 발송 시각 계산(자정·04:00 경계), 푸시 응답 처리 |
| 통합 (`@cloudflare/vitest-plugin`, 로컬 D1, Workers 런타임) | MCP 계약 테스트(원시 JSON-RPC와 공식 클라이언트로 2025 방식·2026-07-28 방식), `save_learning` 중복 방지와 원자성, 복습 기록 재전송, Cron 처리(fetch 모의) |
| 실기기 | MVP마다 iPhone·Android에서 커넥터 저장 → 다음 날 푸시 → 복습 흐름 |

---

## 14. 보안과 개인정보

- 토큰(세션, MCP, 초대, 로그인 코드)은 모두 `HMAC-SHA256(TOKEN_PEPPER, 값)`으로만 저장하고 로그에 남기지 않는다.
- 모든 쿼리는 `user_id`로 범위를 제한한다. MCP 도구도 토큰의 사용자만 다룬다.
- 상태를 바꾸는 API는 Origin을 검사한다. MCP는 Host를 검사하고, Origin이 있으면 검사한다.
- 카드 내용은 React 텍스트로만 그린다. HTML로 넣지 않는다.
- CSP: `default-src 'self'`를 기본으로 한다.
- 대화 원문은 붙여넣기 가져오기가 끝날 때까지만 두고 지운다. 그 밖에는 구조화된 결과만 저장한다.
- MVP 2에서 내 데이터 내보내기와 계정 삭제를 제공한다. 삭제하면 그 사용자의 모든 행을 지운다.
- AI가 쓰인다는 것과 판정이 틀릴 수 있다는 것을 채점 화면과 온보딩에서 알린다.

---

## 15. 미확인 사항과 리스크

| 항목 | 상태 | 확인하는 곳 | 안 되면 |
|---|---|---|---|
| CPU 10ms 안에 MCP 처리·푸시 암호화가 들어가는지 | 추정만 있음 (도구 호출 1~5ms, 푸시 1건 1ms 안팎) | MVP 0 #3 | Workers Paid $5/월 |
| 새 Projects 베타 프로젝트에서 커넥터를 쓸 수 있는지 | 쓸 수 없다는 보고가 있으나 확인 못 함 | MVP 0 #2 | 일반 대화에 지침 넣기, 붙여넣기 주력 |
| claude.ai가 쓰는 MCP 프로토콜 버전 | 모름. 두 방식 모두 지원하도록 만든다 | MVP 0 #4 | SDK 옵션 조정 |
| Cloudflare AI 봇 차단 설정이 Anthropic 트래픽을 막는지 | 모름 | MVP 0 #6 | 설정 조정 |
| 미국에서 오는 MCP 호출이 apac D1까지 왕복하는 시간 | 모름 | MVP 0 #8 | 읽기 batch, Smart Placement |
| iOS 홈 화면 앱이 Safari 쿠키를 받는지 | 모름. 앱 안에서 코드를 입력하는 흐름이라 영향이 적다 | MVP 0 #7 | 이미 대비함 |
| `waitUntil`의 응답 후 실행 시간 | 30초로 알려짐 | MVP 2 착수 | Cron 재시도가 받는다 |
| Opus 5.5의 채점 1회 실제 비용 (thinking 포함) | 모름 | MVP 2 관리자 화면 | 오너가 모델을 바꾼다 |
| structured outputs가 받는 스키마 범위 | 일부 제약이 있을 수 있음 | MVP 2 착수 | 스키마 단순화, 서버 재검증 |
| Free 플랜 한도 변경, 플랫폼 장애 | 바뀔 수 있음 | 상시 | `compatibility_date` 고정, 주간 백업, SQL은 이식 가능하게 |

---

## 부록 A. 도구 설명문 (초안)

### `save_learning`

```
이번 학습 세션에서 확인한 개념, 판정, 카드, 다음에 볼 질문을 사용자의 복습 앱(모아이)에 저장한다.
find_concepts 도구가 있으면 호출하기 전에 그것으로 기존 개념을 찾고, 같은 개념이면 그 key를 그대로 쓴다.
새 개념의 key는 영어 kebab-case로 짓는다 (예: deep-copy).

[판정]
- judgments의 said에는 사용자 원문을 다듬지 않고 그대로 넣는다. [빠짐]은 said를 비운다.
- note에는 왜 그 판정인지 한 문장으로 쓴다. 정답 문장을 그대로 쓰지 않는다.

[카드]
- 카드 1장에는 사실 1개만 담는다.
- 정답과 해설은 이번 세션에서 확정된 내용([맞음] 판정을 받은 사용자 설명, 또는 코치가 직접 설명한 부분)에서만 가져온다.
  세션에 없던 사실을 새로 만들지 않는다.
- 사용자가 [틀림] 또는 [애매] 판정을 받은 설명이 있으면, 그 개념의 객관식 카드에 그 원문을 오답 보기로 넣고 from_my_answer를 true로 한다.
- 개념마다 카드 2~4장을 서로 다른 단계로 만든다. 단계는 카드 종류로 정해진다.
  1단계: code 없는 ox, mcq / 2단계: cloze, 또는 code가 있는 ox·mcq / 3단계: explain (그 개념의 최종 버전이 확정됐을 때만, 1·2단계 카드와 함께)
- mcq는 보기 3~4개에 정답 1개다. cloze는 prompt에 "____"를 한 번 넣고, choices에 정답과 헷갈릴 만한 오답을 함께 넣는다.
- explain의 checklist에는 면접관이 듣고 싶어 하는 핵심 요소 2~5개를 짧게 쓴다 (예: "첫 문장에 이유", "방어적 복사").
- explain(해설)은 1~2문장으로, 왜 맞고 왜 틀렸는지 쓴다.

[연결]
- edges의 type: prerequisite(먼저 알아야 함), follow_up(꼬리질문으로 이어짐), contrast(헷갈리기 쉬운 비교 대상), part_of(상위 개념의 일부).
- 이번에 다루지 못한 꼬리질문은 followups에 넣는다. 그 개념이 처음 나온 것이면 concepts에도 넣고 카드는 만들지 않는다.

같은 내용을 다시 보내면 중복 저장하지 않고 이전 결과를 돌려준다.
검사에 걸리면 고칠 점 목록이 오니, 고쳐서 다시 호출한다.
```

### `find_concepts`

```
사용자가 예전에 저장한 개념 중 이름, 별칭, key가 비슷한 것을 찾는다.
save_learning 전에 이번 세션의 개념 이름들을 쉼표로 이어서 query에 넣는다.
결과에 같은 개념이 있으면 그 key를 쓴다. 없으면 새 개념으로 저장한다.
```

### `get_learner_context`

```
사용자가 이 주제나 개념에 대해 예전에 확정한 설명, 판정 기록(틀렸던 원문 포함), 약한 카드, 연결된 개념, 열린 질문을 돌려준다.
코칭을 시작할 때, 또는 사용자 메시지에 [모아이:key]가 있을 때 먼저 호출한다.
결과의 정답이나 최종 버전을 사용자에게 먼저 말하지 않는다. 과거에 틀린 지점을 확인하는 질문을 만드는 데 쓴다.
```

## 부록 B. 코치 지침 추가분 (설정 화면에서 복사)

기존 코치 지침의 `# 세션 정리` 섹션을 지우고 아래를 붙인다.

```markdown
# 모아이 연동
## 시작
- 새 주제로 코칭을 시작하거나 사용자 메시지에 [모아이:key]가 있으면, 먼저 get_learner_context로 과거 기록을 확인한다.
- 과거 [틀림]/[애매] 기록이 있으면 그 지점을 확인하는 질문부터 낸다. 정답은 말하지 않는다.

## 세션 정리
사용자가 정리를 요청하면 세 줄로 정리한다: 막혔던 지점 / 새로 확보한 핵심 용어 / 다음에 다시 볼 질문.
이 턴에서는 정리와 저장을 함께 한다.
- find_concepts로 이번 세션의 개념을 찾고, 같은 개념이면 기존 key를 쓴다.
- save_learning을 호출한다. 판정의 said에는 사용자 원문을 그대로 넣는다.
- 저장 결과를 한 줄로 알린다.
사용자가 "저장해줘"라고 하면 정리 요청이 없어도 같은 방식으로 저장한다.
```

## 부록 C. 설명 채점 시스템 프롬프트 (초안)

```
너는 기술 면접 개념 코치의 채점 보조다. 사용자가 개념을 30초 분량으로 설명한 글을 채점한다.
기준 자료로 사용자가 예전에 확정한 최종 버전과 핵심 요소 체크리스트가 함께 온다.

1. 사용자 글을 문장 단위로 나눠 [맞음]/[애매]/[틀림]/[빠짐] 중 하나로 판정하고, 이유를 한 문장으로 쓴다.
   - [맞음]: 의미가 맞다. 표현이 어색해도 고치지 않는다.
   - [애매]: 방향은 맞지만 범위가 너무 넓거나 좁다. 또는 듣는 사람이 다르게 이해할 수 있다.
   - [틀림]: 사실관계가 틀렸다.
   - [빠짐]: 이 질문에 답하려면 꼭 있어야 하는 내용이 없다.
2. 체크리스트 중 빠진 항목을 적는다.
3. 첫 문장에 질문의 답이 있는지(두괄식) 판정한다.
4. 정답이나 모범답안은 쓰지 않는다. 가장 중요한 문제를 사용자가 스스로 고치게 할 질문을 하나 쓴다.
5. 등급을 제안한다: [틀림]이 있으면 again, [애매]나 [빠짐]만 있으면 hard, 모두 맞고 체크리스트를 거의 채웠으면 good, 거기에 두괄식이고 짧으면 easy.
확신이 없으면 [애매]로 두고, 이유에 확신이 없다고 쓴다. 기준 자료에 없는 사실로 [틀림]을 주지 않는다.
```

## 부록 D. `get_learner_context` 출력 예시

```markdown
## 깊은 복사 (deep-copy) · 흔들림
- 확정 최종 버전: 없음
- 판정 기록
  - 2026-10-16 [틀림] "깊은 복사는 외부에서 객체의 값을 받아올 때 새로운 객체를 만들어서 값을 복사해서 받아오는 것입니다."
    → 받아오냐 내보내냐로 나누는 개념이 아님. 짝은 얕은 복사.
- 약한 카드: "깊은 복사를 가장 정확하게 설명한 것은?" (최근 2번 모두 틀림, 예전 내 오답을 다시 고름)
- 연결: 방어적 복사 (contrast, 흔들림), 얕은 복사 (contrast, 아직 안 배움)
- 열린 질문: "깊은 복사와 방어적 복사는 어떻게 다른가요?"
```
