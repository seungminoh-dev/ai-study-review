-- 주간 한 문항 설문 (기획서 §13 베타 지표): "이번 주 면접이나 공부에서 써먹은 개념이 있나요?"
-- 사람마다 한 주에 하나. week는 그 주 월요일(04:00 KST 경계의 학습일) 'YYYY-MM-DD'다.
CREATE TABLE survey_answers (
  user_id    TEXT NOT NULL REFERENCES users(id),
  week       TEXT NOT NULL,
  used       INTEGER NOT NULL CHECK (used IN (0, 1)),
  note       TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, week)
) STRICT;
