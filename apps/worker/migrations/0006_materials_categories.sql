-- 자료(PDF 등)와 분류 (설계서 §5.6).
-- 자료에서 만든 카드와 개념은 사용자가 풀기 전까지 "내 지식"에 넣지 않는다. 개념의 adopted_at이 그 표시다.

-- 내 지식이 된 시각. NULL이면 아직 자료에만 있는 개념이다
ALTER TABLE concepts ADD COLUMN adopted_at INTEGER;
-- 지금까지의 개념은 모두 공부한 대화에서 저장한 것이다
UPDATE concepts SET adopted_at = created_at;
CREATE INDEX concepts_domain ON concepts (user_id, domain);

-- study: 공부한 대화에서, material: 자료에서 만든 카드. 자료 카드는 한 번 풀기 전까지 오늘 복습에 넣지 않는다
ALTER TABLE cards ADD COLUMN origin TEXT NOT NULL DEFAULT 'study' CHECK (origin IN ('study', 'material'));

-- 자료 제목과 범위(장·쪽). NULL이면 공부한 대화다
ALTER TABLE learning_sessions ADD COLUMN material TEXT;
ALTER TABLE learning_sessions ADD COLUMN material_part TEXT;
CREATE INDEX learning_sessions_material ON learning_sessions (user_id, material);

-- 분류를 합치거나 이름을 바꾸면 옛 이름을 남겨, 다음에 옛 이름으로 저장해도 새 분류로 간다
CREATE TABLE category_aliases (
  user_id    TEXT NOT NULL REFERENCES users(id),
  alias      TEXT NOT NULL,                        -- 소문자로 맞춘 옛 경로
  path       TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, alias)
) STRICT;
