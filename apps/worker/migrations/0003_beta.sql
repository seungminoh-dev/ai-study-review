-- MVP 2 (설계서 §5.4): 설명하기 AI 채점과 붙여넣기 가져오기, 비용 기록, 카드 신고, 스트릭 프리즈, 하루 목표, 기기 복구 초대.
-- 이미 있는 행은 바꾸지 않는다. 열 추가와 새 테이블뿐이다.

-- 기기를 다 잃은 사람에게 기존 계정으로 다시 들어오게 하는 초대
ALTER TABLE invites ADD COLUMN bind_user_id TEXT REFERENCES users(id);

-- 스트릭을 세는 하루 목표 (장)
ALTER TABLE users ADD COLUMN daily_goal INTEGER NOT NULL DEFAULT 5;

-- 사용자가 고친 카드
ALTER TABLE cards ADD COLUMN edited_at INTEGER;

CREATE TABLE llm_jobs (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id),
  kind       TEXT NOT NULL CHECK (kind IN ('grade', 'import')),
  status     TEXT NOT NULL CHECK (status IN ('queued', 'running', 'done', 'failed')),
  card_id    TEXT,                                 -- 채점할 설명하기 카드
  input      TEXT,                                 -- 채점: 사용자 설명, 가져오기: 대화 원문. 끝나면 NULL로 지운다
  input_hash TEXT,                                 -- 같은 대화를 두 번 가져오지 않게 한다
  result     TEXT,
  error      TEXT,                                 -- 'budget', 'refusal', 'truncated', 'invalid_output', 'api' ...
  attempts   INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;
CREATE INDEX llm_jobs_pending ON llm_jobs (status, updated_at);
CREATE INDEX llm_jobs_user ON llm_jobs (user_id, kind, created_at);

-- 계정을 지워도 이번 달 비용 합계가 맞도록 user_id에 외래 키를 걸지 않는다 (지우면 'deleted'로 바꾼다)
CREATE TABLE llm_usage (
  id                 TEXT PRIMARY KEY,
  user_id            TEXT NOT NULL,
  job_id             TEXT NOT NULL,
  kind               TEXT NOT NULL,
  model              TEXT NOT NULL,                -- 실제로 응답한 모델 (fallback 포함)
  input_tokens       INTEGER NOT NULL,
  output_tokens      INTEGER NOT NULL,             -- thinking 토큰 포함
  cache_read_tokens  INTEGER NOT NULL,
  cache_write_tokens INTEGER NOT NULL,
  cost_micro_usd     INTEGER NOT NULL,
  created_at         INTEGER NOT NULL
) STRICT;
CREATE INDEX llm_usage_month ON llm_usage (created_at);
CREATE INDEX llm_usage_user ON llm_usage (user_id, created_at);

CREATE TABLE card_reports (
  id         TEXT PRIMARY KEY,
  card_id    TEXT NOT NULL REFERENCES cards(id),
  user_id    TEXT NOT NULL,
  reason     TEXT NOT NULL CHECK (reason IN ('wrong', 'unclear', 'duplicate', 'other')),
  note       TEXT,
  created_at INTEGER NOT NULL
) STRICT;
CREATE INDEX card_reports_card ON card_reports (card_id);
CREATE INDEX card_reports_user ON card_reports (user_id, created_at);

CREATE TABLE streak_freezes (
  user_id TEXT NOT NULL,
  day     TEXT NOT NULL,                           -- 'YYYY-MM-DD' (04:00 KST 경계)
  PRIMARY KEY (user_id, day)
) STRICT;
