-- 자료 이름 바꾸기 (4단계). 자료는 learning_sessions.material(원래 PDF 이름)로 묶는다. 그 이름은 두고, 보여 줄 이름만 따로 둔다.
-- 그래야 Claude가 같은 PDF의 다음 장을 원래 이름으로 저장해도 같은 자료로 이어진다.
CREATE TABLE material_labels (
  user_id    TEXT NOT NULL REFERENCES users(id),
  material   TEXT NOT NULL,
  label      TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, material)
) STRICT;
