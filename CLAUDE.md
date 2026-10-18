# 모아이

AI와 공부한 대화를 간격 반복 복습 카드로 바꾸는 서비스. Cloudflare Worker(TypeScript, Hono, D1) + MCP 서버 + PWA. 운영은 https://moai.smoh.dev.

작업을 시작하기 전에 [docs/handoff.md](docs/handoff.md)를 읽는다. 지금 상태, 로컬 준비, 배포·마이그레이션 절차, 다음 작업이 있다.

## 사용자 방침

- 답은 한국어 해요체로 짧게.
- 테스트는 되돌릴 수 없는 주요 작업(마이그레이션, 삭제, 비용·예산, 데이터 상태 변경)만 한다. 전부 테스트하지 않는다.
- 운영 서비스라 배포 전에 항상 보안 점검을 한다.
- PR 없이 `main`에 바로 머지해도 된다. PR은 요청할 때만 만든다. `main`에 push하면 Deploy가 마이그레이션과 배포를 한다.
- 비밀값은 `wrangler secret put`으로만 넣고 레포·로그에 남기지 않는다. 커넥터 URL은 비밀번호와 같다.
- 커밋, 코드 주석, 문서에 모델 ID를 쓰지 않는다.

## 명령

- `npm run typecheck && npm run build && npm test` (테스트 전에 빌드가 필요하다)
- `wrangler` 명령은 `apps/worker`에서 실행한다.
