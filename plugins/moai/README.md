# 모아이 Claude Code 플러그인

Claude Code에서 공부한 내용을 [모아이](https://moai.smoh.dev) 복습 카드로 저장하고, 과거 기록으로 코칭·복습한다. MCP 서버는 넣지 않고 모아이 커넥터를 그대로 쓴다.

| 명령 | 하는 일 |
|---|---|
| `/moai:coach [주제]` | 예전에 틀렸던 지점부터 묻는 코칭 |
| `/moai:capture` | 이 대화의 학습을 세 줄로 정리하고 카드로 저장 (`source: claude-code`) |
| `/moai:review [문제 수]` | 오늘 복습 카드를 대화로 풀기 (분류·자료로 거를 수 있다) |
| `/moai:pdf <PDF 경로> [쪽 범위]` | PDF를 장별로 읽어 "자료" 카드로 만들기. 풀기 전까지 내 지식에 들어가지 않는다 |

## 설치

```
/plugin marketplace add seungminoh-dev/ai-study-review
/plugin install moai@ai-study-review
```

## 모아이 커넥터 연결 (둘 중 하나)

1. **claude.ai 계정으로 Claude Code에 로그인했으면**: claude.ai에 추가한 모아이 커넥터가 자동으로 보인다. `/mcp`에서 확인한다. API 키로 로그인했으면 이 방법은 안 된다.
2. **직접 추가**: 주소는 모두 같다. 추가한 뒤 `/mcp`에서 moai를 골라 로그인하면 브라우저에 모아이 허용 화면이 뜬다.
   ```bash
   claude mcp add --transport http --scope user moai https://moai.smoh.dev/mcp
   ```
   연결은 모아이 앱 설정 → claude.ai 커넥터 → 연결한 앱에서 끊을 수 있다. 예전 방식 비밀 URL을 쓴다면 그 URL은 비밀번호와 같으니 레포나 `.mcp.json`에 넣지 않는다.

도구는 부를 때마다 승인을 묻는다. 자주 쓰면 `/permissions`에서 **읽기 도구만** 허용해 둔다: `mcp__moai__find_concepts`, `mcp__moai__get_learner_context`, `mcp__moai__get_review_queue`, `mcp__moai__get_interview_chain`, `mcp__moai__get_categories` (직접 추가한 경우 이름). 저장·채점(`save_learning`, `submit_review`)은 매번 확인하는 편이 안전하다.
