# 모아이

AI와 공부한 대화를 복습 카드와 지식 지도로 바꿔서, 지하철이나 침대에서 2~3분씩 되새기게 하는 서비스.

claude.ai에서 공부하다 "정리해줘"라고 하면, 대화 중인 Claude가 MCP 도구로 학습 기록(개념, 판정, 내 오답, 카드)을 저장한다. Cloudflare Worker가 FSRS로 복습 날짜를 잡고, 휴대폰 홈 화면 앱(PWA)으로 알림을 보낸다.

## 지금 단계

**MVP 0 (연결 검증)**: 코드 완료. Cloudflare·claude.ai 설정과 점검 순서는 [MVP 0 실행 가이드](docs/mvp0-runbook.md).

## 문서

- [기획서](docs/service-plan.md)
- [설계서](docs/design.md) (MVP별 계획, 데이터 모델, API)
- [MVP 0 실행 가이드](docs/mvp0-runbook.md)
- [ADR 0001 런타임 결정](docs/adr/0001-runtime.md)
- [이름 후보](docs/names.md)

## 구조

```
apps/worker      Cloudflare Worker (MCP 서버, API, 매분 Cron)
apps/web/public  PWA 정적 파일 (MVP 0은 점검 페이지 /spike)
packages/shared  save_learning 스키마와 검사 규칙
scripts          키 생성, 부하 재생, 테스트 견본 생성
```

## 개발

```bash
npm ci
npm run typecheck
npm test

cd apps/worker
cp .dev.vars.example .dev.vars   # 값 채우기: npm run gen:token, npm run gen:vapid
npm run db:migrate:local
npm run dev                      # http://localhost:8787/spike
```
