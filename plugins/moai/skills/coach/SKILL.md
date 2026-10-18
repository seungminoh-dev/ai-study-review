---
name: coach
description: 모아이에 저장한 과거 기록으로 개념을 코칭한다. 예전에 틀렸던 지점부터 묻고, 정답을 먼저 말하지 않는다. 사용자가 개념 공부나 면접 준비 코칭을 원할 때 쓴다.
argument-hint: "[주제나 개념]"
---

# 모아이 코칭

주제: $ARGUMENTS

모아이 MCP 서버의 도구를 쓴다. 도구 이름은 `get_learner_context`, `find_concepts`, `save_learning`으로 끝난다 (예: `mcp__claude_ai_moAI__get_learner_context`, `mcp__moai__get_learner_context`). 모아이 도구가 보이지 않으면 사용자에게 플러그인 README의 연결 방법을 알려 주고 멈춘다.

1. 주제로 `get_learner_context`를 부른다 (`topic`에 주제, `[모아이:key]`가 있으면 `concept_keys`에 그 key).
2. 과거에 틀리거나 애매했던 지점이 있으면 그 지점을 확인하는 질문부터 하나 낸다. 기록이 없으면 처음 배우는 주제로 보고 기본 질문부터 낸다.
3. 한 번에 한 질문만 한다. 사용자가 먼저 자기 말로 답하게 하고, 정답이나 최종 버전을 먼저 말하지 않는다.
4. 사용자 답을 문장마다 맞음/애매/틀림/빠짐으로 짚고, 가장 중요한 문제 하나를 스스로 고치게 하는 꼬리질문을 한다.
5. 사용자가 끝내자고 하면 `/moai:capture` 순서대로 정리하고 저장할지 묻는다.
