-- 자료 섹션 이름 바꾸기 (4단계). 섹션은 learning_sessions.material_part(저장할 때 받은 범위 이름)로 묶고 복습 주소에도 쓴다.
-- 그 이름은 두고 보여 줄 이름만 따로 둔다. 자료 이름(material_labels)과 같은 방식이다.
CREATE TABLE material_part_labels (
  user_id    TEXT NOT NULL REFERENCES users(id),
  material   TEXT NOT NULL,
  part       TEXT NOT NULL,
  label      TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, material, part)
) STRICT;
