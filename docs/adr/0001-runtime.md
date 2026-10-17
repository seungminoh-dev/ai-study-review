# ADR 0001: 백엔드 런타임과 배포 위치

- 상태: 결정 (B안, 2026-10-17)
- 날짜: 2026-10-17
- 관련 문서: [service-plan.md](../service-plan.md), [design.md](../design.md)

## 배경

처음 기획안은 Spring Boot를 상시 구동 VM에 올리는 구성이었다. 그런데 비용과 운영 부담을 줄이려면 서버리스(Lambda 같은 서비스)로 가야 한다. 그래서 "Spring으로 서버리스가 되나"를 확인해야 했다.

제약:

- 인프라 비용은 사실상 $0. Claude API 비용은 월 $100 이하이고 내 Console API 키로 서버에서만 호출한다.
- 사용자는 초대받은 10명이고, 전원 Claude Pro($20) 또는 Max($100) 요금제다.
- 배포 후보: Cloudflare(무료 플랜, Wrangler 사용, 도메인 보유), Vercel, AWS.
- 처음에는 주 직무(Java/Spring 백엔드)와 맞춰 Spring 포트폴리오 가치를 크게 봤다. 나중에 이 서비스는 포트폴리오 용도가 아니라고 정했다 (아래 결정).

## 확인한 사실 (2026-10 기준)

### claude.ai가 MCP 서버에 요구하는 것

| 항목 | 내용 |
|---|---|
| 커스텀 커넥터 | Pro/Max에서 사용 가능. 개수 제한은 문서에 없다 (Free만 1개). 각자 자기 계정에 추가해야 한다. |
| 모바일 | 웹이나 데스크톱에서 추가하면 iOS/Android 앱에서 쓸 수 있다. 모바일에서 추가하는 건 베타다. |
| 호출 위치 | 항상 Anthropic 클라우드에서 호출한다 (`160.79.104.0/21`). 서버는 공개 HTTPS + IPv4 A 레코드가 필요하다. |
| 전송 방식 | Streamable HTTP. 세션 없이 POST마다 JSON으로 응답하는 stateless 서버도 스펙상 허용된다. |
| 타임아웃 | 도구 호출 240초. OAuth 탐색·등록·토큰 엔드포인트는 10초, 토큰 갱신은 30초. |
| 인증 | OAuth(DCR/CIMD) 또는 인증 없음. 고정 헤더(API 키)는 일부 조직만 쓰는 베타라서 개인 Pro/Max에서는 기대하지 않는다. |
| 주의 | 다른 호스트로 리다이렉트하면 인증이 깨진다. Cloudflare Bot Fight Mode나 WAF가 Anthropic 트래픽을 막을 수 있다. |
| 정책 | 내 API 키로 내 사용자에게 서비스하는 것은 Commercial Terms상 허용된다. 서버에는 Console API 키만 쓰고 구독 계정 인증은 쓰지 않는다. AI 출력이 틀릴 수 있다는 안내가 필요하다. |

### 런타임별 사실

| 런타임 | Java/Spring | 콜드 스타트 | 무료 한도 | 걸리는 점 |
|---|---|---|---|---|
| **AWS Lambda** | 된다. java25 런타임 + Spring Boot 4.1 + Spring AI 2.0 stateless MCP + Lambda Web Adapter | SnapStart 없이 5~14초. 있으면 AWS 샘플 기준 약 1초, 최악 2~7초 | 매달 요청 100만 건, 40만 GB-초 (계속 무료) | 계정을 Paid 플랜으로 바꿔야 6개월 뒤 만료되지 않는다. VPC/NAT/ALB/RDS를 쓰면 비싸진다. |
| **Cloudflare Workers** | 안 된다 (JVM 없음). Spring은 Cloudflare Containers로만 되는데 Workers Paid($5/월~) 전용이다. | 사실상 없음 (V8 isolate) | 하루 요청 10만 건, 요청당 CPU 10ms | CPU 10ms가 MCP 처리와 푸시 암호화에 충분한지 측정해야 한다. 넘으면 $5/월. |
| **Vercel** | 공식 Java 런타임 없음. Dockerfile 실행은 2026-06 시작된 베타 | 문서 없음 | Hobby는 비상업용, 크론은 하루 1회(±59분) | 원하는 시각에 푸시를 못 보낸다. 백엔드로는 부적합하다. |

"AWS가 비싸다"는 아래를 쓸 때 생긴다. 이번 구성은 하나도 쓰지 않는다.

| 항목 | 대략 월 비용 | 대신 쓰는 것 |
|---|---|---|
| NAT Gateway (Lambda를 VPC에 넣는 순간 필요) | 약 $33 | VPC에 넣지 않음 |
| ALB | 약 $16 + 사용량 | Lambda Function URL (무료) |
| RDS db.t4g.micro | 약 $12 | Supabase 무료 Postgres |
| 공인 IPv4 | 주소당 $3.65 | 쓰지 않음 |
| Secrets Manager | 비밀값당 $0.40 | SSM Parameter Store 표준 (무료) |
| API Gateway | 무료 기간 이후 과금 | Function URL |

## 선택지

### A. Spring Boot on AWS Lambda + Cloudflare Worker 앞단 (버림)

```
[claude.ai / Claude Code] ─MCP─┐
[PWA (휴대폰)] ─────REST───────┤
                               ▼
        Cloudflare Worker (내 도메인, 무료)
        · PWA 정적 파일 제공
        · /api, /mcp 를 Lambda로 전달 (토큰 경로 → 헤더, 엣지 비밀값 추가)
                               │
                               ▼
        AWS Lambda (java25, SnapStart, Function URL, VPC 없음)
        · Spring Boot 4.1 + Spring AI 2.0 stateless MCP
        · REST API, FSRS, 푸시 발송, LLM 채점
            │            ▲
            ▼            │ 1분마다 호출 (푸시 발송 + 웜 유지)
   Supabase Postgres    EventBridge Scheduler
   (서울, 무료)
```

- 인프라 비용: 약 $0 (배포 파일을 올리는 S3 비용 몇 센트)
- 장점: Spring 포트폴리오를 그대로 가져간다. 1분 틱 하나로 정시 푸시와 웜 유지를 같이 한다. 도구 호출 타임아웃(240초)보다 콜드 스타트가 훨씬 짧다.
- 단점: 제공자가 셋(AWS, Cloudflare, Supabase)이다. SnapStart, Lambda Web Adapter, 커넥션 풀 설정처럼 처음 다뤄 보는 것이 많다. 첫 단계까지 2.5주 정도 걸린다.
- 버린 이유: 이 서비스는 포트폴리오 용도가 아니어서 Spring을 쓸 이유가 사라졌다. 남는 것은 제공자 셋과 콜드 스타트 대응 같은 비용뿐이다.

### B. Cloudflare Worker 하나로 전부 (TypeScript, 채택)

```
Cloudflare Worker (무료)
· MCP 서버 (@modelcontextprotocol/server, stateless)
· REST API + PWA 정적 파일
· D1 (SQLite) · 1분 Cron Trigger로 푸시 · ts-fsrs
```

- 인프라 비용: $0. CPU 10ms를 넘으면 월 $5.
- 장점: 움직이는 부분이 가장 적다. 콜드 스타트가 없다. 첫 단계까지 가장 빠르다.
- 단점: Java/Spring 코드가 하나도 없다. TypeScript, workerd, D1을 새로 배워야 한다.

### 버린 선택지

- 상시 구동 VM에 Spring: 서버리스 요구와 맞지 않는다.
- Vercel 백엔드: Java가 베타이고 Hobby 크론이 하루 1회라 정시 푸시가 안 된다. 프론트는 이미 Cloudflare로 해결된다.
- Cloudflare Containers에 Spring: 유료($5/월~)이고, 컨테이너 시작(1~3초)에 JVM 시작까지 더해진다.
- Neon Postgres: 1분 틱이 컴퓨트를 계속 깨워서 무료 100 CU-시간을 넘긴다 (월 약 180 CU-시간).

## 결정

**B로 간다.** TypeScript로 Cloudflare Worker 하나에 MCP 서버, REST API, PWA, Cron을 모두 넣는다.

- 이 서비스는 포트폴리오 용도가 아니다. 그래서 Spring의 장점(직무 일치)이 없고, 단순함·속도·비용이 가장 중요하다.
- B는 제공자가 Cloudflare 하나이고, 이미 가진 도메인과 무료 플랜을 그대로 쓴다. 콜드 스타트도 없다.
- 남는 위험은 호출당 CPU 10ms다. 설계서 MVP 0에서 실측하고, 넘으면 Workers Paid(월 $5)로 바꾼다. 코드는 바꾸지 않는다.

구현 설계는 [design.md](../design.md)에 있다. 확인 항목은 설계서 §2.1(MVP 0)로 옮겼다.

## 참고: A안을 다시 볼 때 지켜야 할 것

지금은 쓰지 않는다. 나중에 Java로 다시 만들 일이 생기면 참고하려고 남겨 둔다.

- AWS 계정을 첫 배포 전에 Paid 플랜으로 바꾸고, Budgets 알람을 $1로 건다.
- Lambda를 VPC에 넣지 않는다.
- Function URL과 스케줄은 `$LATEST`가 아니라 게시된 별칭(alias)을 가리키게 한다. SnapStart는 게시된 버전에만 적용된다.
- Lambda Web Adapter의 SnapStart 훅은 기본값이 없다. `AWS_LWA_SNAPSTART_BEFORE_CHECKPOINT_PATH=/_lwa/before-checkpoint`, `AWS_LWA_SNAPSTART_AFTER_RESTORE_PATH=/_lwa/after-restore`처럼 직접 지정하고, 이 경로(`/_lwa/**`)는 인증 필터에서 뺀다. 훅이 2xx가 아닌 응답을 주면 스냅샷 생성이나 복원이 실패한다.
- 스냅샷에 DB 연결이나 비밀값이 들어가지 않게 한다. 비밀값은 복원 후 처음 쓸 때 읽는다.
- Supabase는 Supavisor transaction pooler(포트 6543)로 연결하고 `prepareThreshold=0`을 설정한다. Flyway 마이그레이션은 CI에서 돌린다.
- 1분 틱의 비동기 호출 재시도는 0회로 둔다. 다음 틱이 재시도 역할을 한다.
- LLM 응답 JSON은 structured outputs(`output_config.format`)로 받는다. 강제 `tool_choice`는 Sonnet 5.5와 Opus 5.5에서 400 에러가 난다.
- 채점 비용은 thinking 토큰까지 넣어 잰다. Opus 5.5는 thinking을 끌 수 없어서 월 $100 한도를 넘을 수 있다.
- 오래 걸리는 LLM 작업(붙여넣기 가져오기)은 작업 테이블에 넣고 틱이 처리한다. iPhone에서 PWA가 백그라운드로 가면 요청이 끊기기 때문이다.
- Cloudflare Free 플랜의 Bot Fight Mode는 경로별 예외가 안 되므로 존 전체에서 끈다. 아니면 IP Access 허용 규칙을 `160.79.104.0/24`~`160.79.111.0/24` 8개로 넣는다 (존 전체 적용). `/mcp` 경로는 WAF 커스텀 규칙에서 Anthropic IP 대역을 Skip 예외로 둔다. Worker 호출 로그에 토큰이 든 URL이 남지 않게 한다.
