-- AI 크레딧과 숨은 업적 (4단계). 크레딧은 앱 안 재화다: 돈으로 사거나 바꿀 수 없다.
-- 원장: 받으면 +, 쓰면 -. 월간 크레딧(매달 1일 한국 시간에 다시 채움, 넘어가지 않음)은 상수라 원장에 적지 않는다.
-- 남은 크레딧 = 월간 + 받은 것 - 이번 달 쓴 것 - 지난달까지 월간을 넘겨 쓴 것 (domain/credits.ts)
CREATE TABLE credit_ledger (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id),
  amount     INTEGER NOT NULL,
  kind       TEXT NOT NULL,   -- grant(운영자), achievement(숨은 업적), ask, interview, grade, cards, import
  ref        TEXT,            -- 쓴 호출·작업의 id나 업적 id. AI 비용이 들지 않은 실패면 쓴 줄을 지워 돌려준다
  note       TEXT,
  created_at INTEGER NOT NULL
) STRICT;
CREATE INDEX credit_ledger_user ON credit_ledger (user_id, created_at);
CREATE INDEX credit_ledger_ref ON credit_ledger (ref);
-- 실패한 작업에 AI 비용이 들었는지 본다 (비용이 든 실패는 크레딧을 돌려주지 않는다)
CREATE INDEX llm_usage_job ON llm_usage (job_id);

-- 숨은 업적: 조건은 서버에만 있다. 이루면 여기에 적고 보유 크레딧을 준다
CREATE TABLE achievements (
  user_id     TEXT NOT NULL REFERENCES users(id),
  achievement TEXT NOT NULL,
  earned_at   INTEGER NOT NULL,
  PRIMARY KEY (user_id, achievement)
) STRICT;
