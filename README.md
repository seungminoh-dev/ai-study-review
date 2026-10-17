# 모아이

AI와 공부한 대화를 복습 카드와 지식 지도로 바꿔서, 지하철이나 침대에서 2~3분씩 되새기게 하는 서비스.

claude.ai에서 공부하다 "정리해줘"라고 하면, 대화 중인 Claude가 MCP 도구로 학습 기록(개념, 판정, 내 오답, 카드)을 저장한다. Cloudflare Worker가 FSRS로 복습 날짜를 잡고, 휴대폰 홈 화면 앱(PWA)으로 알림을 보낸다.

## 지금 단계

**MVP 1 (나 혼자 루프)**: 코드 완료. 전환 순서와 평소 운영은 [운영 가이드](docs/runbook.md).

- MCP 도구: `find_concepts`, `save_learning`, `get_learner_context`
- PWA: 오늘, 복습(OX·객관식·빈칸), 저장 기록과 카드 끄기, 설정(알림, 커넥터 URL, 코치 지침)
- 매분 Cron 알림, 오프라인 답안 큐

## 문서

- [기획서](docs/service-plan.md)
- [설계서](docs/design.md) (MVP별 계획, 데이터 모델, API)
- [운영 가이드](docs/runbook.md)
- [MVP 0 실행 가이드](docs/mvp0-runbook.md) (끝난 단계의 기록)
- [ADR 0001 런타임 결정](docs/adr/0001-runtime.md)
- [이름 후보](docs/names.md)

## 구조

```
apps/worker      Cloudflare Worker (MCP 서버, REST API, 매분 Cron)
apps/web         PWA (Vite + React). 빌드 결과 apps/web/dist를 Worker가 정적 파일로 제공한다
packages/shared  zod 스키마와 규칙 (save_learning 입력, API 요청, 채점)
scripts          키 생성, 부하 재생, 테스트 견본 생성
```

## 개발

```bash
npm ci
npm run typecheck
npm run build        # PWA
npm test

cp apps/worker/.dev.vars.example apps/worker/.dev.vars   # 값 채우기: npm run gen:token, npm run gen:vapid
npm run db:migrate:local
npm run dev                                              # http://localhost:8787
```
