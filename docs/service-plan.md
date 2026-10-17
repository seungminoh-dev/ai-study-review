# 되새김 (가칭) 서비스 기획서 v0.2

> AI와 공부한 대화를 **복습 카드와 지식 지도**로 바꿔서, 지하철이나 침대에서 2~3분씩 되새기게 하는 서비스.

- 작성일: 2026-10-17 (v0.2: 서버리스 구성, 초대 가입, 요금제 반영)
- 대상: 나 + 친구 10명 클로즈드 베타. 전원 Claude Pro($20) 또는 Max($100) 요금제
- 가입: 초대받은 사람만
- 제약: Claude API 월 $100 이하(내 Console API 키, 서버에서만 호출), 인프라 사실상 $0, 웹(모바일 우선)
- 런타임 결정: [ADR 0001](adr/0001-runtime.md)

---

## 1. 문제 정의

| # | 페인포인트 | 지금 모습 |
|---|---|---|
| P1 | **휘발** | AI한테 답을 들은 순간 이해한 기분이 들지만, 따로 정리하지 않으면 남지 않는다. 정리는 귀찮아서 안 한다. |
| P2 | **복습 부재** | 언제 무엇을 다시 봐야 하는지 아무도 관리하지 않는다. 망각 곡선대로 잊는다. |
| P3 | **연결 손실** | `불변 객체 → final → 방어적 복사 → 깊은/얕은 복사`처럼 꼬리질문으로 넓어진 지식이 대화 스레드 안에 묻힌다. |
| P4 | **학습 맥락** | 공부하는 시간이 이동 중이거나 누워 있을 때다. 폰, 한 손, 2~3분, 자주 끊긴다. |
| P5 | **면접 특수성** | 목표는 "알아보기"가 아니라 "내 말로 설명하기"다. 객관식만 풀면 아는 것 같은 착각이 생긴다. |

## 2. 핵심 인사이트 4가지

1. **재료는 대화 로그가 아니라 코칭의 판정 결과다.**
   지금 쓰는 코치 지침이 이미 `[맞음]/[애매]/[틀림]/[빠짐]` 판정, 막힌 지점, 핵심 용어, 다음에 볼 질문, 확정된 최종 버전을 만들어 낸다. 이걸 구조화해서 저장하기만 하면 된다.
2. **내가 했던 오답이 가장 좋은 오답 보기다.**
   "깊은 복사는 외부에서 받아올 때 새 객체로 복사하는 것"처럼 내가 실제로 했던 틀린 설명을 객관식 보기로 다시 보여 준다. 시중 문제집은 이걸 못 준다.
3. **카드는 대화 중인 Claude가 만든다.**
   맥락을 가장 많이 아는 시점은 대화 도중이다. 끝난 뒤 로그를 파싱하면 품질도 떨어지고 API 비용도 든다. 대화 중에 만들면 사용자의 Claude 구독으로 처리되니 **서버 API 비용이 0**이다.
4. **복습 스케줄링은 AI가 아니라 알고리즘이 한다.**
   간격 반복은 FSRS(Anki에 들어 있는 오픈소스 알고리즘)가 결정적으로, 무료로, 검증된 방식으로 처리한다. AI는 "무엇을, 어떤 형태로 물을지"와 "설명 채점"에만 쓴다.

## 3. 사용 시나리오 (하루)

1. **21:30 침대** — claude.ai 프로젝트 "면접 코치"에서 불변 객체를 코칭받는다. "정리해줘"라고 하면 Claude가 3줄 정리를 하고 `save_learning` 도구를 호출한다.
   → "개념 5개, 카드 7장, 다음에 볼 질문 2개를 저장했어요."
2. **다음 날 08:10 지하철** — 푸시 알림: "오늘 되새김 8장 · 약 3분". OX → 객관식 → 빈칸 순서로 푼다. 깊은 복사 객관식에서 또 예전 내 오답을 고른다. 해설과 함께 "이 개념은 아직 흔들려요. Claude에서 이어서 공부하기" 버튼이 뜬다.
3. **버튼 탭** — 이어서 공부할 프롬프트가 복사된다. 프로젝트에 붙여 넣으면 Claude가 `get_learner_context`로 내 기록을 읽고 "지난번엔 깊은 복사를 받아오는 시점으로 설명했죠"라며 시작한다.
4. **3일 뒤** — 불변 객체가 "설명하기" 카드로 승급한다. 30초 설명을 쓰고, 내가 확정했던 최종 버전과 핵심 용어 체크리스트로 자가 채점한다.
5. **주말** — 친구 리그에서 이번 주 XP 순위를 본다.

## 4. 학습 루프

```
 ┌──────────── 공부 (claude.ai / Claude Code) ◀──────────────┐
 │                                                            │
 ▼                                                            │
캡처: Claude가 save_learning 호출 (판정·오답·카드·연결)        │
 │                                                            │
 ▼                                                            │
지식 지도에 개념/연결 추가, 카드 생성                          │
 │                                                            │
 ▼                                                            │
되새김: FSRS가 정한 날에 카드 출제 (웹 PWA, 푸시)              │
 │                                                            │
 ▼                                                            │
약점 개념 / 다음에 볼 질문 → "이어서 공부하기" ────────────────┘
```

## 5. 지식을 어떻게 빼오나 (아키텍처 결정)

### 5.1 선택지 비교

| 방식 | 공부하는 곳 | 추출 비용 | 친구 온보딩 | 판정 |
|---|---|---|---|---|
| **A. Remote MCP 커넥터** (claude.ai 프로젝트에 우리 서버를 커넥터로 추가) | 지금처럼 폰 claude.ai 앱 | 0 (사용자 구독) | 커넥터 URL 1개 추가 | **주력** |
| B. Claude Code 플러그인 (skill + hook + 같은 MCP 서버) | 터미널, 또는 Claude Code 클라우드 세션 | 0 (사용자 구독) | 플러그인 설치 | 보조 |
| C. 웹에 대화 붙여넣기 → 서버가 추출 | 어디든 | API 사용 (건당 수 센트 이하) | 없음 | 폴백 |
| D. claude.ai 데이터 내보내기(zip) 일괄 가져오기 | 과거 대화 | API 사용 (Batch로 50% 할인) | 수동 | 초기 이관용 |

### 5.2 왜 "로컬 Claude Code에서 다 만들고 웹은 DB+UI만"이 아니라 A인가

방향은 맞다. **LLM 일은 사용자 쪽 Claude가 하고, 서버는 저장·스케줄·UI만 한다**는 원칙은 그대로 가져간다. 다만 그 "사용자 쪽"을 로컬 CLI가 아니라 **실제로 공부하는 곳**으로 옮긴다.

- 공부는 폰의 claude.ai 프로젝트에서 일어난다. Claude Code hook은 claude.ai 채팅 내용을 볼 수 없다. CLI만 쓰면 누워서 하던 공부를 책상으로 옮겨야 해서 P4와 충돌한다.
- 사후 파싱보다 대화 중 추출이 정확하다. Claude는 자기가 내린 판정과 사용자가 막힌 지점을 이미 알고 있다.
- 친구 온보딩이 쉽다. CLI 설치 대신 URL 하나만 추가하면 된다.
- 참고: Claude Code는 데스크톱 전용이 아니다. Claude 앱과 웹에서 클라우드 세션으로도 돌고, 레포의 `.claude/` hook과 skill도 거기서 실행된다. 다만 코딩용 환경이라 코칭 대화에는 claude.ai 채팅이 더 자연스럽다. 그래서 B는 "터미널에서 기술 공부할 때"용 보조 경로로 둔다.

### 5.3 시스템 구성 (서버리스, 제안)

자세한 비교와 근거는 [ADR 0001](adr/0001-runtime.md)에 있다.

```
[claude.ai 프로젝트 (폰/웹)] ──MCP (Streamable HTTP)──┐
[Claude Code 플러그인]       ──MCP────────────────────┤
[PWA (휴대폰)]               ──REST───────────────────┤
                                                      ▼
                  ┌──────────────────────────────────────────┐
                  │ Cloudflare Worker (내 도메인, 무료 플랜)   │
                  │  · PWA 정적 파일 제공                     │
                  │  · /api, /mcp 를 Lambda로 전달            │
                  │  · 토큰 경로 → 헤더, 엣지 비밀값 추가      │
                  └─────────────────────┬────────────────────┘
                                        ▼
                  ┌──────────────────────────────────────────┐
                  │ AWS Lambda (java25, SnapStart, VPC 없음)   │
                  │  Spring Boot 4.1 + Spring AI 2.0          │
                  │  · stateless MCP 서버 (도구 4개)          │
                  │  · REST API · FSRS · Web Push 발송         │
                  │  · LLM 호출 (채점 / 폴백 추출)             │
                  └───────┬───────────────────────▲──────────┘
                          ▼                       │ 1분마다 (푸시 + 웜 유지)
                Supabase Postgres (서울)   EventBridge Scheduler
```

claude.ai가 MCP 서버에 요구하는 것:

- 공개 HTTPS 주소와 IPv4 A 레코드. 호출은 폰 앱에서 쓸 때도 항상 Anthropic 클라우드(`160.79.104.0/21`)에서 온다.
- 다른 호스트로 리다이렉트하지 않는다 (인증 헤더가 사라진다).
- 도구 호출은 240초 안에 응답한다. OAuth를 붙이면 탐색·등록·토큰 엔드포인트는 10초 안에 응답해야 한다.
- 친구들은 커넥터를 웹에서 한 번 추가하고, `save_learning` 같은 도구를 "항상 허용"으로 바꿔 둔다. 그래야 폰에서 승인 버튼을 누르지 않아도 된다.

### 5.4 MCP 도구 설계

| 도구 | 언제 | 하는 일 |
|---|---|---|
| `find_concepts(query)` | 저장 직전 | 비슷한 기존 개념을 돌려준다. Claude가 같은 개념이면 기존 `key`를 재사용한다. 임베딩 없이 중복을 막는다. |
| `save_learning(payload)` | "정리" 요청 시 | 판정·오답·개념·연결·카드·다음 질문을 저장하고, 저장 요약과 웹 링크를 돌려준다. |
| `get_learner_context(topic)` | 코칭 시작 시 | 이 주제의 과거 오답, 확정 최종 버전, 연결 개념, 약한 카드를 돌려준다. 코칭이 개인화된다. |
| `get_review_queue` / `submit_review` (Phase 3) | 채팅으로 복습할 때 | "오늘 복습 퀴즈 내줘"를 채팅 안에서 처리한다. |

**카드 생성 규칙은 프로젝트 지침이 아니라 `save_learning`의 도구 설명(description)과 스키마에 둔다.** 서버에서 규칙을 고치면 친구 10명의 세션에 바로 반영되고, 각자 지침을 고칠 필요가 없다.

### 5.5 프로젝트 지침에 추가할 부분

기존 코치 지침의 `# 세션 정리` 섹션을 아래로 바꾼다.

```markdown
# 세션 정리
사용자가 정리를 요청하면 세 줄로: 막혔던 지점 / 새로 확보한 핵심 용어 / 다음에 다시 볼 질문.
그다음 되새김 커넥터에 저장한다.
- 먼저 find_concepts로 이번 세션 개념을 조회하고, 같은 개념이면 기존 key를 쓴다.
- save_learning을 호출한다. 판정은 사용자 원문 그대로 넣는다. 원문을 다듬지 않는다.
- 저장 결과를 한 줄로 알려 준다.
사용자가 "저장해줘"라고 하면 정리 요청이 없어도 같은 방식으로 저장한다.

# 시작
코칭을 시작할 때 get_learner_context로 이 주제의 과거 기록을 확인한다.
과거 오답이 있으면 그 지점을 먼저 확인하는 질문을 낸다. 정답은 말하지 않는다.
```

면접 코치가 아닌 일반 Q&A 세션에서도 "이거 저장해줘"라고 하면 카드로 만든다. 판정 데이터가 없으면 오답 보기는 Claude가 만든다.

### 5.6 Claude Code 플러그인 (Phase 3)

```
dwesaegim-plugin/
├── .claude-plugin/plugin.json
├── .mcp.json                 # 같은 remote MCP 서버
├── skills/
│   ├── coach/SKILL.md        # 지금 쓰는 코치 지침 이식 (/coach)
│   └── capture/SKILL.md      # 현재 세션을 save_learning으로 저장 (/capture)
└── hooks/hooks.json          # Stop hook: 저장 안 한 학습이 있으면 저장하라고 알림
```

- Stop hook은 입력의 `last_assistant_message`(문서 권장, `transcript_path`는 늦게 갱신될 수 있음)를 보고 코칭 흔적(`[틀림]` 등)은 있는데 저장한 적이 없으면 `{"decision": "block", "reason": "학습 내용을 /capture로 저장하라"}`를 돌려준다. `reason`은 사용자가 아니라 Claude에게 전달된다. 무한 반복을 막으려고 `stop_hook_active`가 true면 그냥 통과시킨다.
- 친구가 Claude Code에 구독 계정으로 로그인하면 claude.ai에 추가한 커넥터가 자동으로 보인다. 플러그인 `.mcp.json`에 같은 URL을 넣으면 그쪽이 우선해서 커넥터를 가리므로, 플러그인에는 skill과 hook만 넣는 방안도 Phase 3에서 검토한다.
- 친구 설치: `/plugin marketplace add seungminoh-dev/ai-study-review` → `/plugin install dwesaegim`.

## 6. 카드

### 6.1 카드 사다리

| 단계 | 카드 형태 | 측정하는 것 | 채점 |
|---|---|---|---|
| 1. 알아보기 | OX, 객관식 (내 오답이 보기로) | 구분할 수 있나 | 자동 |
| 2. 떠올리기 | 빈칸, 코드 읽기 ("이 코드 컴파일되나요?") | 단서 보고 꺼낼 수 있나 | 자동 |
| 3. 설명하기 | 30초 설명 (텍스트, 나중에 음성) | 내 말로 설명할 수 있나 | 자가 채점 (기본) / AI 채점 (선택, 쿼터) |
| 보너스 | 꼬리질문 체인 | 연결된 개념을 이어서 답할 수 있나 | 단계별 |

- 개념 안에서 아래 단계 카드의 FSRS 안정도(stability)가 7일을 넘으면 다음 단계 카드가 열린다. 틀리면 한 단계 내려간다.
- 설명하기 카드의 자가 채점: 내가 확정한 최종 버전 + 핵심 용어 체크리스트 + 두괄식 여부를 보고 4단계(다시/어려움/좋음/쉬움)로 매긴다. 무료다.
- AI 채점: 코치 지침과 같은 `[맞음]/[애매]/[틀림]/[빠짐]` 기준으로 판정만 하고 정답은 말하지 않는다.

### 6.2 카드 생성 규칙 (도구 설명에 들어갈 내용)

- 카드 1장에는 사실 1개만 (최소 정보 원칙).
- 정답은 그 세션에서 확정된 내용(`[맞음]` 판정 또는 코치가 설명한 부분)에서만 가져온다. 세션에 없던 사실을 새로 지어내지 않는다.
- 객관식 보기: 정답 1개 + 내 오답(있으면 반드시) + 그럴듯한 오답. 3~4지선다.
- 해설은 1~2문장. 왜 틀렸는지를 쓴다.
- 개념당 카드 2~4장, 서로 다른 단계로.

### 6.3 `save_learning` 페이로드 예시 (불변 객체 세션)

```json
{
  "topic": "불변 객체를 쓰는 이유와 만드는 방법",
  "source": "claude.ai",
  "final_answer": "(세션에서 확정한 사용자 문장 그대로)",
  "concepts": [
    { "key": "immutable-object", "name": "불변 객체" },
    { "key": "final-variable", "name": "변수에 붙인 final" },
    { "key": "defensive-copy", "name": "방어적 복사" },
    { "key": "deep-copy", "name": "깊은 복사" },
    { "key": "shallow-copy", "name": "얕은 복사" }
  ],
  "edges": [
    { "from": "immutable-object", "to": "final-variable", "type": "prerequisite" },
    { "from": "immutable-object", "to": "defensive-copy", "type": "follow_up" },
    { "from": "defensive-copy", "to": "deep-copy", "type": "contrast" },
    { "from": "deep-copy", "to": "shallow-copy", "type": "contrast" }
  ],
  "judgments": [
    {
      "concept": "deep-copy", "label": "틀림",
      "said": "깊은 복사는 외부에서 객체의 값을 받아올 때 새로운 객체를 만들어서 값을 복사해서 받아오는 것입니다.",
      "note": "받아오냐 내보내냐로 나누는 개념이 아님. 짝이 되는 개념은 얕은 복사."
    },
    {
      "concept": "defensive-copy", "label": "애매",
      "said": "방어적 복사는 내부 객체의 값을 전달할 때 새로운 객체를 만든 후 복사해서 전달하는 것",
      "note": "내보낼 때만 말함. 생성자에서 받아올 때도 방어적 복사."
    }
  ],
  "key_terms": ["재할당", "방어적 복사", "스레드 안전"],
  "followups": [
    { "concept": "deep-copy", "question": "깊은 복사와 방어적 복사는 어떻게 다른가요?" },
    { "concept": "defensive-copy", "question": "생성자에서 받은 리스트는 깊은 복사로 받아야 하나요?" }
  ],
  "cards": [
    {
      "concept": "final-variable", "type": "ox",
      "prompt": "final List<String> names = new ArrayList<>();\nnames.add(\"kim\");\n이 코드는 컴파일 에러가 난다.",
      "answer": "X",
      "explain": "변수에 붙인 final은 재할당만 막는다. 리스트 내부 변경은 막지 않는다."
    },
    {
      "concept": "deep-copy", "type": "mcq",
      "prompt": "깊은 복사를 가장 정확하게 설명한 것은?",
      "options": [
        { "text": "객체가 참조하는 내부 객체까지 새로 만들어, 원본과 공유하는 상태가 없게 복사하는 것", "correct": true },
        { "text": "외부에서 객체를 받아올 때 새 객체를 만들어 값을 복사해 받는 것", "from_my_answer": true },
        { "text": "새 객체를 만들되, 필드가 가리키는 객체는 원본과 함께 쓰는 것" }
      ],
      "explain": "세 번째는 얕은 복사. 깊은/얕은 복사는 '어디까지 복사하나'의 구분이고, 받는 시점과는 관계없다."
    },
    {
      "concept": "immutable-object", "type": "explain",
      "prompt": "불변 객체를 쓰는 이유와 만드는 방법을 30초 안에 설명해 보세요.",
      "checklist": ["첫 문장에 이유", "private final 필드 + setter 없음", "가변 필드는 방어적 복사", "스레드 안전"]
    }
  ]
}
```

개념의 상태(흔들림/익숙함/아직 안 배움)는 Claude가 정하지 않는다. 서버가 판정 기록과 복습 기록에서 계산한다.

## 7. 데이터 모델

| 테이블 | 주요 컬럼 |
|---|---|
| `users` | id, display_name, role(`owner`/`member`), timezone, mcp_token_hash |
| `invites` | id, code_hash, label(예: "민수"), expires_at, accepted_at |
| `auth_sessions` | id, user_id, token_hash, expires_at |
| `push_subscriptions` | id, user_id, endpoint, p256dh, auth |
| `reminder_slots` | id, user_id, local_time(예: 08:10), next_fire_at(UTC, 인덱스) |
| `import_jobs` | id, user_id, status, input, result, created_at |
| `concepts` | id, user_id, key, name, aliases[], domain(Java/Spring/DB/네트워크/AI…), final_answer, created_at |
| `edges` | from_concept_id, to_concept_id, type(`prerequisite`/`follow_up`/`contrast`/`part_of`) |
| `judgments` | id, concept_id, session_id, label(`맞음`/`애매`/`틀림`/`빠짐`), said, note |
| `cards` | id, concept_id, rung(1~3), type, prompt, answer, options(jsonb), explain, status(`active`/`suspended`), FSRS 필드(stability, difficulty, due, reps, lapses, state) |
| `review_logs` | id, card_id, grade(1~4), response, elapsed_ms, reviewed_at |
| `followups` | id, concept_id, question, resolved_at |
| `sessions` | id, user_id, source(`claude.ai`/`claude-code`/`import`), topic, created_at |

- 대화 원문은 저장하지 않는다. 구조화된 결과만 저장한다 (친구 데이터 신뢰 문제).
- "아직 안 배움(frontier)" 개념 = 카드는 없고 `followups`만 있는 개념. 지식 지도에서 점선으로 보인다.

## 8. 복습 스케줄링과 리마인드

- **알고리즘**: FSRS. Java 공식 구현 `io.github.open-spaced-repetition:fsrs` 1.0.0(Maven Central)을 쓴다. `ts-fsrs` 결과와 비교하는 테스트를 둔다.
- **자동 채점 → FSRS 등급**: 오답 = 다시(1), 정답이지만 15초 넘게 걸림 = 어려움(2), 정답 = 좋음(3), 5초 안에 정답 = 쉬움(4).
- **형제 카드 분산**: 같은 개념 카드는 하루에 1장만 낸다.
- **하루 상한**: 새 카드 10장, 복습 30장 (설정 가능). 밀렸을 때는 "가볍게 5장" 모드.
- **세션 길이**: 기본 8장, 약 3분. 지하철 한두 정거장.
- **리마인드**: 사용자가 정한 시간(예: 08:10, 22:30)에 Web Push. EventBridge Scheduler가 1분마다 Lambda를 부르고, `next_fire_at`이 지난 슬롯만 골라 보낸다. 몇 분 이상 늦은 알림은 버린다. iOS는 16.4 이상에서 홈 화면에 추가한 PWA만 웹 푸시를 받고, 암호화 방식은 aes128gcm이어야 한다 (`com.interaso:webpush` 1.3.0). 온보딩에서 "홈 화면에 추가"를 안내한다.
- **오프라인**: 오늘 큐를 미리 받아 두고, 답은 로컬(IndexedDB)에 쌓았다가 연결되면 동기화한다.

## 9. 재미 요소

- 스트릭 + 일일 목표 (기본 5장, 작게 시작해서 끊기지 않게)
- 스트릭 프리즈 (주 1회)
- XP: 카드 정답, 설명하기 완료, 새 개념 캡처
- **친구 리그**: 10명 주간 XP 순위. 딱 리그 하나 크기.
- **오늘의 꼬리물기**: 연결된 개념 3개를 이어서 묻는 체인 (`불변 객체 → 방어적 복사 → 깊은 복사`). 면접관 꼬리질문 연습.
- 지식 지도에서 개념이 회색(아직 안 배움) → 노랑(흔들림) → 초록(익숙함)으로 바뀌는 걸 본다.

## 10. 비용

### 10.1 LLM 비용 (월 $100 한도)

주력 경로(A, B)는 **서버 API 비용 0**이다. API는 아래 두 곳에서만 쓴다.

| 항목 | 가정 (1회) | Haiku 5.5 | Sonnet 5.5 | Opus 5.5 |
|---|---|---|---|---|
| 설명하기 AI 채점 | 입력 2K / 출력 0.4K 토큰 | $0.0004 | $0.008 | $0.016 |
| 월 3,000회 (10명 × 하루 10회) | | **$1.2** | **$24** | **$48** |
| 붙여넣기 추출 (폴백) | 입력 15K / 출력 3K 토큰 | $0.003 | $0.06 | $0.12 |
| 월 200건 (10명 × 주 5건) | | **$0.6** | **$12** | **$24** |
| **합계** | | **~$2** | **~$36** | **~$72** |

- 단가 기준: Haiku 5.5 $0.10/$0.50, Sonnet 5.5 $2/$10, Opus 5.5 $4/$20 (입력/출력, 100만 토큰당, 2026-10 기준).
- 토큰 수는 가정이다. Phase 1에서 실제 사용량을 재서 다시 계산한다.
- 어느 모델이든 한도 안에 들어간다. 다만 Opus 5.5는 여유가 적다. 그래서 같은 답변 20개로 채점 품질을 비교하기 전까지는 Haiku 5.5를 기본으로 쓴다 (결정 필요).
- 채점 결과 JSON은 structured outputs(`output_config.format`)로 받는다. 도구 호출을 강제하는 방식(`tool_choice`)은 Sonnet 5.5와 Opus 5.5에서 400 에러가 난다.
- 안전장치: 사용자별 월 한도(예: $5), 전체 한도($90에서 중단), Console 지출 한도, 채점 기준 프롬프트 캐싱. 과거 대화 일괄 가져오기는 Batch API(50% 할인)로 한다.
- 채점 화면에 "AI 판정이며 틀릴 수 있어요" 안내를 넣는다 (Commercial Terms 요구 사항).

### 10.2 인프라 (서버리스)

| 구성 | 선택 | 예상 |
|---|---|---|
| 프론트 PWA + 앞단 프록시 | Cloudflare Worker + Workers Static Assets (내 도메인) | 무료 (하루 요청 10만 건, 정적 파일 무제한) |
| 백엔드 | AWS Lambda java25 + SnapStart + Function URL | 무료 (매달 요청 100만 건, 40만 GB-초 계속 무료) |
| 푸시 시계 | EventBridge Scheduler, 1분 주기 (월 약 4.3만 회) | 무료 (월 1,400만 회 무료) |
| DB | Supabase 무료 Postgres (서울, 500MB) | 무료 |
| 비밀값 | SSM Parameter Store 표준 SecureString | 무료 |
| 배포 파일 | S3 (SAM 배포용, zip이 50MB를 넘음) | 몇 센트 |

- 계정 정리: 2025-07-15 이후 만든 AWS 계정은 Free 플랜으로 두면 6개월 뒤 만료된다. 첫 배포 전에 Paid 플랜으로 바꾸고 Budgets 알람을 $1로 건다. 계속 무료 혜택은 Paid 플랜에서도 유지된다.
- 피해야 할 것: VPC/NAT Gateway(월 약 $33), ALB(약 $16), RDS(약 $12), Secrets Manager, Provisioned Concurrency, 컨테이너 이미지에 SnapStart.
- Neon 대신 Supabase를 고른 이유: 1분 틱이 Neon 컴퓨트를 계속 깨워서 무료 100 CU-시간을 넘긴다. Supabase는 컴퓨트 시간 제한이 없고, 틱 덕분에 7일 무활동 일시정지도 피한다.

## 11. 기술 스택 제안

- **백엔드**: Java 25 + Spring Boot 4.1 + Spring AI 2.0 (`spring-ai-starter-mcp-server-webmvc`, `spring.ai.mcp.server.protocol=STATELESS`) + Spring Security + JPA/Flyway, AWS Lambda Web Adapter(zip 배포) + SnapStart
- **Claude API 호출**: 공식 Anthropic Java SDK. jar가 크고(압축 39MB) Spring AI와 Jackson 버전이 달라서 콜드 스타트에 영향이 있을 수 있다. Phase 0에서 측정하고, 문제가 되면 줄일 방법을 정한다.
- **FSRS**: `io.github.open-spaced-repetition:fsrs` 1.0.0
- **푸시**: Web Push(VAPID, aes128gcm), `com.interaso:webpush` 1.3.0
- **프론트**: React + Vite PWA(`vite-plugin-pwa`), 모바일 우선, 한 손 조작 (주요 버튼은 화면 아래쪽 1/3). Cloudflare Workers Static Assets로 배포
- **앞단**: Cloudflare Worker (TypeScript 약 50줄, Wrangler). Lambda Function URL로 전달한다. 재시도는 같은 요청을 여러 번 보내도 안전한 호출에만 한다.
- **IaC/CI**: AWS SAM + GitHub Actions(OIDC) → `sam deploy`, `wrangler deploy`
- **가입(초대 전용)**: 내가 1회용 초대 코드를 발급한다 (7일 유효, 해시로만 저장). 친구는 홈 화면에 추가한 PWA 안에서 코드를 입력해 가입한다. iOS에서는 Safari와 홈 화면 앱의 저장소가 따로라서, 앱 밖으로 나가는 Google 로그인 리다이렉트가 잘 깨진다. 그래서 MVP는 외부 로그인 없이 간다.
- **MCP 인증**: MVP는 사용자별 비밀 URL 토큰(`/mcp/u/{token}`, 256비트, 해시로만 저장, 재발급 가능). claude.ai에서는 "로그인 없음"으로 추가한다. Phase 3에서 OAuth(DCR/CIMD)로 바꾼다. 10초 OAuth 마감이 JVM 콜드 스타트에 걸리지 않게 OAuth는 Worker(`workers-oauth-provider`)에 둔다.

**Spring을 유지하는 이유**: 주 직무(Java/Spring 백엔드, AI 응용 서비스)와 그대로 겹친다. MCP 서버, 간격 반복, 서버리스 콜드 스타트 대응을 직접 설계한 경험이 포트폴리오가 된다.
**대안**: Spring을 쓰지 않을 거라면 Cloudflare Worker 하나에 TypeScript로 전부 넣는 구성(ADR 0001의 B안)이 가장 단순하고 빠르다.

## 12. 로드맵

| 단계 | 기간 | 범위 | 끝났다는 기준 |
|---|---|---|---|
| **Phase 0: 검증** | 주말 1~2회 | 도구 1개짜리 Spring MCP 서버를 Lambda에 올리고 Worker를 거쳐 claude.ai 커스텀 커넥터로 붙인다. ① 폰 앱 프로젝트 대화와 친구의 Pro 계정에서 도구가 호출되는지 ② SnapStart 복원 p99가 3초 미만인지 ③ 토큰에서 꺼낸 사용자 ID가 도구 메서드까지 오는지 ④ 홈 화면 PWA에서 초대 가입과 푸시가 되는지 ⑤ Claude Code에서도 붙는지 확인한다. | 다 확인되면 진행. MCP가 막히면 C(붙여넣기)를 주력으로, Lambda가 막히면 ADR 0001의 B안으로 바꾼다. |
| **Phase 1: 나 혼자** | 2주 | `find_concepts`/`save_learning`, 카드 3종(OX/객관식/빈칸), FSRS, 오늘의 복습 화면, 웹 푸시 | 14일 중 10일 이상 내가 복습함 |
| **Phase 2: 친구 10명** | 2~3주 | 로그인, 사용자별 커넥터 URL, 지식 지도, 스트릭/XP/리그, 설명하기 카드 + AI 채점(쿼터), 붙여넣기 가져오기, 카드 신고/수정 | 아래 지표 |
| **Phase 3: 확장** | 이후 | Claude Code 플러그인, 채팅 복습 도구, 꼬리물기 체인 / 모의면접 모드, 질문 은행 공유, 데이터 내보내기 가져오기, 음성 설명 | |

## 13. 베타 성공 지표 (10명)

- 주간 복습자 비율(WAU / 가입자) 60% 이상
- 가입 14일 뒤에도 복습하는 비율
- 캡처 → 첫 복습 전환율
- 같은 카드 2회차 대비 5회차 정답률
- 카드 신고율 5% 미만 (카드 품질)
- 주 1회 한 문항 설문: "이번 주 면접이나 공부에서 써먹은 개념이 있나요?"

## 14. 리스크와 대응

| 리스크 | 영향 | 대응 |
|---|---|---|
| 새 Projects 베타로 바뀐 프로젝트에서 커넥터를 못 씀 (보고가 있지만 확인 못 함) | 주력 경로가 막힘 | Phase 0에서 먼저 확인. 일반 대화에 코치 지침을 넣는 방법, 붙여넣기 폴백 |
| Lambda 콜드 스타트 | 첫 호출이 느림 | SnapStart + 사전 준비(priming), 1분 틱으로 웜 유지. 도구 호출 한도 240초보다 훨씬 짧음 |
| Cloudflare 봇 차단이 Anthropic 트래픽을 막음 | 커넥터 연결 실패 | `/mcp` 경로에서 Bot Fight Mode와 WAF 규칙의 예외로 `160.79.104.0/21` 지정 |
| 비밀 URL 토큰 유출 | 그 사람 학습 데이터가 노출됨 | 해시로만 저장, 로그에서 경로 가리기, 재발급 기능, Phase 3에 OAuth |
| iOS 홈 화면 PWA의 로그인이나 푸시가 안 됨 | 친구 온보딩 실패 | 앱 안에서 초대 코드로 가입, Phase 0에서 실제 iPhone으로 확인 |
| 틀린 카드가 반복 학습됨 | 오개념이 오히려 굳음 (가장 치명적) | 정답은 세션 확정 내용에서만, 신고하면 즉시 정지, 해설에 출처 세션 표시 |
| 객관식 착각 (알아보기 ≠ 설명하기) | 면접에서 막힘 | 카드 사다리, 설명하기 단계 필수 |
| 저장을 잊음 | 재료가 안 쌓임 | 지침에 "정리 = 저장" 고정, Claude Code는 Stop hook |
| 친구들의 대화 데이터 | 신뢰 문제 | 원문 미저장, 구조화 결과만. 내보내기/전체 삭제 기능 |
| 백엔드 콜드 스타트 | 도구 호출 실패 | 상시 구동 인스턴스 |
| 복습이 밀려서 쌓임 | 이탈 | 하루 상한, "가볍게 5장" 모드, 스트릭 프리즈 |

## 15. 결정이 필요한 것

1. 서비스 이름 (가칭 "되새김", 계속 고민 중)
2. 런타임: Spring on Lambda(A안, 제안) vs TypeScript on Cloudflare Worker(B안). [ADR 0001](adr/0001-runtime.md)
3. AI 채점 모델: Haiku 5.5 / Sonnet 5.5 / Opus 5.5 중 품질 비교 후 선택 (그 전까지 Haiku 5.5)
4. 친구끼리 질문 은행(질문만, 답은 제외) 공유를 기본값으로 할지

정해진 것:

- 친구 요금제: Pro($20) / Max($100). 둘 다 커스텀 커넥터를 쓸 수 있다.
- 서버 LLM 호출은 내 Console API 키로 한다. 가입은 초대받은 사람만 한다.
- 배포: Cloudflare(무료 플랜, 도메인 보유)를 앞단으로, AWS는 서버리스 무료 범위 안에서만 쓴다. Vercel은 쓰지 않는다.
