-- MVP 1 스키마 (설계서 §5.2). MVP 0 점검용 테이블은 지운다.

DROP TABLE IF EXISTS spike_push_jobs;
DROP TABLE IF EXISTS spike_push_subscriptions;
DROP TABLE IF EXISTS spike_mcp_requests;
DROP TABLE IF EXISTS spike_log;

CREATE TABLE users (
  id                 TEXT PRIMARY KEY,
  display_name       TEXT NOT NULL,
  role               TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  timezone           TEXT NOT NULL DEFAULT 'Asia/Seoul',
  daily_new_limit    INTEGER NOT NULL DEFAULT 10,
  daily_review_limit INTEGER NOT NULL DEFAULT 30,
  created_at         INTEGER NOT NULL
) STRICT;

CREATE TABLE auth_sessions (
  token_hash   TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id),
  created_at   INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL
) STRICT;
CREATE INDEX auth_sessions_expiry ON auth_sessions (expires_at);

CREATE TABLE mcp_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  revoked_at INTEGER
) STRICT;
CREATE INDEX mcp_tokens_user ON mcp_tokens (user_id, revoked_at);

CREATE TABLE learning_sessions (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id),
  source       TEXT NOT NULL CHECK (source IN ('claude.ai', 'claude-code', 'import')),
  topic        TEXT NOT NULL,
  final_answer TEXT,
  key_terms    TEXT NOT NULL DEFAULT '[]',
  payload_hash TEXT NOT NULL,
  summary      TEXT NOT NULL,
  counts       TEXT NOT NULL DEFAULT '{}',          -- 저장 기록 목록에 보여 줄 개수 (JSON)
  created_at   INTEGER NOT NULL,
  UNIQUE (user_id, payload_hash)
) STRICT;
CREATE INDEX learning_sessions_user ON learning_sessions (user_id, created_at);

CREATE TABLE concepts (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id),
  key          TEXT NOT NULL,
  name         TEXT NOT NULL,
  aliases      TEXT NOT NULL DEFAULT '[]',
  search_text  TEXT NOT NULL,
  domain       TEXT,
  final_answer TEXT,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  UNIQUE (user_id, key)
) STRICT;

CREATE TABLE edges (
  user_id    TEXT NOT NULL,
  from_id    TEXT NOT NULL REFERENCES concepts(id),
  to_id      TEXT NOT NULL REFERENCES concepts(id),
  type       TEXT NOT NULL CHECK (type IN ('prerequisite', 'follow_up', 'contrast', 'part_of')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (from_id, to_id, type)
) STRICT;
CREATE INDEX edges_to ON edges (to_id);

CREATE TABLE judgments (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  concept_id TEXT NOT NULL REFERENCES concepts(id),
  session_id TEXT NOT NULL REFERENCES learning_sessions(id),
  label      TEXT NOT NULL CHECK (label IN ('맞음', '애매', '틀림', '빠짐')),
  said       TEXT,
  note       TEXT NOT NULL,
  created_at INTEGER NOT NULL
) STRICT;
CREATE INDEX judgments_concept ON judgments (concept_id, created_at);
CREATE INDEX judgments_session ON judgments (session_id);

CREATE TABLE followups (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  concept_id  TEXT NOT NULL REFERENCES concepts(id),
  session_id  TEXT NOT NULL REFERENCES learning_sessions(id),
  question    TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  resolved_at INTEGER
) STRICT;
CREATE INDEX followups_open ON followups (user_id, resolved_at);
CREATE INDEX followups_session ON followups (session_id);

CREATE TABLE cards (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL,
  concept_id     TEXT NOT NULL REFERENCES concepts(id),
  session_id     TEXT NOT NULL REFERENCES learning_sessions(id),
  rung           INTEGER NOT NULL CHECK (rung BETWEEN 1 AND 3),
  type           TEXT NOT NULL CHECK (type IN ('ox', 'mcq', 'cloze', 'explain')),
  prompt         TEXT NOT NULL,
  code           TEXT,
  answer         TEXT,
  options        TEXT,
  explain        TEXT,
  checklist      TEXT,
  status         TEXT NOT NULL CHECK (status IN ('active', 'locked', 'suspended')),
  due            INTEGER NOT NULL,
  stability      REAL NOT NULL,
  difficulty     REAL NOT NULL,
  elapsed_days   INTEGER NOT NULL,
  scheduled_days INTEGER NOT NULL,
  learning_steps INTEGER NOT NULL,
  reps           INTEGER NOT NULL,
  lapses         INTEGER NOT NULL,
  state          INTEGER NOT NULL,
  last_review    INTEGER,
  created_at     INTEGER NOT NULL
) STRICT;
CREATE INDEX cards_queue ON cards (user_id, status, due);
CREATE INDEX cards_concept ON cards (concept_id, rung);
CREATE INDEX cards_session ON cards (session_id);

CREATE TABLE review_logs (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  card_id     TEXT NOT NULL REFERENCES cards(id),
  grade       INTEGER NOT NULL CHECK (grade BETWEEN 1 AND 4),
  response    TEXT,
  elapsed_ms  INTEGER,
  reviewed_at INTEGER NOT NULL,
  prev_card   TEXT NOT NULL
) STRICT;
CREATE INDEX review_logs_user_time ON review_logs (user_id, reviewed_at);
CREATE INDEX review_logs_card ON review_logs (card_id, reviewed_at);

CREATE TABLE push_subscriptions (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id),
  endpoint   TEXT NOT NULL UNIQUE,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_ok_at INTEGER,
  fail_count INTEGER NOT NULL DEFAULT 0
) STRICT;
CREATE INDEX push_subscriptions_user ON push_subscriptions (user_id);

CREATE TABLE reminder_slots (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id),
  local_time   TEXT NOT NULL,
  enabled      INTEGER NOT NULL DEFAULT 1,
  next_fire_at INTEGER NOT NULL
) STRICT;
CREATE INDEX reminder_due ON reminder_slots (enabled, next_fire_at);
CREATE INDEX reminder_user ON reminder_slots (user_id);
