-- Google 로그인 (2026-10-22). provider CHECK에 'google'을 더한다. SQLite는 CHECK를 바꾸지 못해서 두 테이블을 다시 만든다.
-- user_identities를 가리키는 외래 키는 없고, user_identities는 users만 가리킨다. 행은 그대로 옮긴다.
-- Google에서는 계정 id(sub)만 받는다. 보여 줄 아이디가 없어서 login은 ''로 둔다.

CREATE TABLE user_identities_next (
  provider   TEXT NOT NULL CHECK (provider IN ('github', 'google')),
  subject    TEXT NOT NULL,                    -- GitHub 사용자 id 또는 Google 계정 id(sub). 바뀌지 않는 값으로 찾는다
  user_id    TEXT NOT NULL REFERENCES users(id),
  login      TEXT NOT NULL,                    -- 화면에 보여 줄 GitHub 아이디. Google은 ''
  created_at INTEGER NOT NULL,
  PRIMARY KEY (provider, subject)
) STRICT;
INSERT INTO user_identities_next (provider, subject, user_id, login, created_at)
  SELECT provider, subject, user_id, login, created_at FROM user_identities;
DROP TABLE user_identities;
ALTER TABLE user_identities_next RENAME TO user_identities;
-- 한 사람에 계정 종류마다 하나
CREATE UNIQUE INDEX user_identities_user ON user_identities (user_id, provider);

CREATE TABLE pending_signups_next (
  token_hash         TEXT PRIMARY KEY,
  provider           TEXT NOT NULL CHECK (provider IN ('github', 'google')),
  subject            TEXT NOT NULL,
  login              TEXT NOT NULL,
  name               TEXT,
  attempts           INTEGER NOT NULL DEFAULT 0,
  expires_at         INTEGER NOT NULL,
  account_created_at INTEGER
) STRICT;
INSERT INTO pending_signups_next (token_hash, provider, subject, login, name, attempts, expires_at, account_created_at)
  SELECT token_hash, provider, subject, login, name, attempts, expires_at, account_created_at FROM pending_signups;
DROP TABLE pending_signups;
ALTER TABLE pending_signups_next RENAME TO pending_signups;
CREATE INDEX pending_signups_expiry ON pending_signups (expires_at);
