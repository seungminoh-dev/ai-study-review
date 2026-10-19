-- 오너에게 보내는 서버 문제 알림 (2026-10-19). 종류마다 아직 안 알린 수와 마지막으로 알린 시각만 둔다. 새 테이블 하나다.
CREATE TABLE alerts (
  kind         TEXT PRIMARY KEY,              -- server_error, cron_failed, llm_failed
  pending      INTEGER NOT NULL DEFAULT 0,    -- 마지막 알림 뒤로 생긴 수
  last_sent_at INTEGER NOT NULL DEFAULT 0
) STRICT;
