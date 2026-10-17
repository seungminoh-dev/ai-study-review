-- MVP 0 전용 테이블. MVP 1의 0001_init.sql에서 지운다 (설계서 §2.1).

CREATE TABLE spike_log (
  id          TEXT PRIMARY KEY,
  received_at INTEGER NOT NULL,
  topic       TEXT NOT NULL,
  counts      TEXT NOT NULL,                 -- JSON: 개념·카드·판정·질문·연결 수
  payload     TEXT NOT NULL                  -- 검증을 통과한 save_learning 입력 원본
) STRICT;

CREATE TABLE spike_mcp_requests (
  id              TEXT PRIMARY KEY,
  at              INTEGER NOT NULL,
  http_method     TEXT NOT NULL,
  rpc_method      TEXT,                      -- JSON-RPC 메서드 (initialize, tools/list, tools/call ...)
  tool_name       TEXT,
  protocol_header TEXT,                      -- MCP-Protocol-Version 헤더
  protocol_body   TEXT,                      -- initialize의 protocolVersion 또는 요청 _meta의 버전
  user_agent      TEXT,
  colo            TEXT,                      -- 요청을 받은 Cloudflare 데이터센터
  status          INTEGER NOT NULL,
  duration_ms     INTEGER NOT NULL
) STRICT;
CREATE INDEX spike_mcp_requests_at ON spike_mcp_requests (at);

CREATE TABLE spike_push_subscriptions (
  id         TEXT PRIMARY KEY,
  endpoint   TEXT NOT NULL UNIQUE,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  user_agent TEXT,
  created_at INTEGER NOT NULL
) STRICT;

CREATE TABLE spike_push_jobs (
  id                 TEXT PRIMARY KEY,
  subscription_id    TEXT NOT NULL,          -- 구독이 지워져도 기록은 남긴다
  ack                TEXT NOT NULL,          -- 서비스 워커가 도착을 알릴 때 쓰는 일회용 값
  fire_at            INTEGER NOT NULL,
  created_at         INTEGER NOT NULL,
  sent_at            INTEGER,
  status_code        INTEGER,
  error              TEXT,
  received_at        INTEGER,                -- 서버가 도착 알림을 받은 시각
  device_received_at INTEGER                 -- 기기가 푸시를 받은 시각 (기기 시계)
) STRICT;
CREATE INDEX spike_push_jobs_due ON spike_push_jobs (sent_at, fire_at);
