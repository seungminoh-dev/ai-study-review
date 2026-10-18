-- 이정표 배지 (3단계 3-4). 받을 조건은 기록에서 세고, 처음 이룬 배지만 여기에 넣는다.
-- 넣은 뒤에는 하루 목표를 바꾸거나 답을 되돌려도 남는다. 받을 수 있는 배지는 packages/shared/src/badges.ts에 있다.
CREATE TABLE badges (
  user_id   TEXT NOT NULL REFERENCES users(id),
  badge     TEXT NOT NULL,
  earned_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, badge)
) STRICT;
