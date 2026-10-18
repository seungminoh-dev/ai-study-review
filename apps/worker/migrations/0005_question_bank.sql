-- 질문 은행 (설계서 §2.4): 친구끼리 질문만 공유한다. 답, 판정, 내 설명은 공유하지 않는다.
-- 사용자가 직접 고른 질문만 들어간다. 새 테이블 하나다.
CREATE TABLE shared_questions (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id),
  concept_name TEXT NOT NULL,
  question     TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  UNIQUE (user_id, question)
) STRICT;
CREATE INDEX shared_questions_recent ON shared_questions (created_at);
