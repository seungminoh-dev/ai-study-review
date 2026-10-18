# 모아이

AI와 공부한 대화를 복습 카드와 지식 지도로 바꿔서, 지하철이나 침대에서 2~3분씩 되새기게 하는 서비스.

claude.ai에서 공부하다 "정리해줘"라고 하면, 대화 중인 Claude가 MCP 도구로 학습 기록(개념, 판정, 내 오답, 카드)을 저장한다. Cloudflare Worker가 FSRS로 복습 날짜를 잡고, 휴대폰 홈 화면 앱(PWA)으로 알림을 보낸다.

## 지금 단계

**MVP 2 (친구 베타)**: 코드 완료. 켜는 순서와 평소 운영은 [운영 가이드](docs/runbook.md).

- MCP 도구: `find_concepts`, `save_learning`, `get_learner_context`, `get_review_queue`, `submit_review`, `get_interview_chain`, `get_categories`, `update_categories`. 코치 지침 없이 어느 채팅에서나 "모아이에 저장해줘"로 저장하고, "복습 퀴즈 내줘", "모의면접 해줘"도 채팅에서 한다
- Claude Code 플러그인: [`plugins/moai`](plugins/moai) (`/moai:coach`, `/moai:capture`, `/moai:review`, `/moai:pdf`)
- 자동 분류(저장할 때), PDF 자료(풀기 전까지 내 지식과 분리, 자료 하나에 섹션 여러 개, 섹션만 골라 풀기)
- 가입·로그인: GitHub + 초대 코드, 다른 기기 로그인 코드, 기기 복구 초대
- PWA: 처음 온 사람을 위한 랜딩(체험 카드)과 가입 뒤 시작 가이드(설치·연결·첫 저장·알림), 오늘(목표 링·이번 주·이어서 풀 자료), 복습(OX·객관식·빈칸·설명하기, 확신도, 키보드), 내 성장(최근 12주·지난주 비교·최고 연속), 지식 지도와 개념 상세, 저장 기록(카드 고치기·끄기), 대화 붙여넣기, 설정(오너는 관리: 초대·베타 지표). 휴대폰은 아래 탭, 컴퓨터(1024px 이상)는 왼쪽 사이드바다. 색과 마스코트는 2단계 디자인 시안을, 움직임은 3단계 시안을 따른다 (Motion + CSS, 기기의 동작 줄이기 설정을 따른다). 친구와 함께하는 리그·질문 은행은 내 성취에 집중하려고 화면에서 뺐다 (서버 API는 남아 있다)
- 서버 AI(선택): 설명하기 AI 채점, 대화 가져오기, 월 예산 가드
- 매분 Cron 알림과 AI 작업, 오프라인 답안 큐, 내 데이터 내보내기와 계정 지우기

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
