# 모아이 Claude Code 플러그인

Claude Code에서 공부한 내용을 [모아이](https://moai.smoh.dev) 복습 카드로 저장하고, 과거 기록으로 코칭·복습한다. MCP 서버는 넣지 않고 모아이 커넥터를 그대로 쓴다.

| 명령 | 하는 일 |
|---|---|
| `/moai:coach [주제]` | 예전에 틀렸던 지점부터 묻는 코칭 |
| `/moai:capture` | 이 대화의 학습을 세 줄로 정리하고 카드로 저장 (`source: claude-code`) |
| `/moai:review [문제 수]` | 오늘 복습 카드를 대화로 풀기 |

## 설치

```
/plugin marketplace add seungminoh-dev/ai-study-review
/plugin install moai@ai-study-review
```

## 모아이 커넥터 연결 (둘 중 하나)

1. **claude.ai 계정으로 Claude Code에 로그인했으면**: claude.ai에 추가한 모아이 커넥터가 자동으로 보인다. `/mcp`에서 확인한다. API 키로 로그인했으면 이 방법은 안 된다.
2. **직접 추가**: 모아이 앱 설정 → 커넥터 URL을 복사한다. 셸 기록에 남지 않게 붙여 넣기로 입력받아 추가한다 (bash·zsh):
   ```bash
   read -rs MOAI_URL && claude mcp add --transport http --scope user moai "$MOAI_URL"; unset MOAI_URL
   ```
   커넥터 URL은 비밀번호와 같다. 레포나 공유 설정 파일(`.mcp.json`)에 넣지 않는다. `--scope user`는 내 컴퓨터의 사용자 설정에만 저장한다. 새었으면 앱에서 다시 만들면 이전 URL은 바로 막힌다.

도구는 부를 때마다 승인을 묻는다. 자주 쓰면 `/permissions`에서 **읽기 도구만** 허용해 둔다: `mcp__moai__find_concepts`, `mcp__moai__get_learner_context`, `mcp__moai__get_review_queue`, `mcp__moai__get_interview_chain` (직접 추가한 경우 이름). 저장·채점(`save_learning`, `submit_review`)은 매번 확인하는 편이 안전하다.
