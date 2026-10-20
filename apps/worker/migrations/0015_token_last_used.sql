-- 예전 방식 비밀 URL 커넥터의 마지막 사용 시각 (2026-10-20, 개선점 23). 하루 한 번 적고, 90일 동안 안 쓰면 끊는다.
-- 열만 더한다. 지금 있는 주소는 비어 있어서 처음 쓸 때부터 센다
ALTER TABLE mcp_tokens ADD COLUMN last_used_at INTEGER;
