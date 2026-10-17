-- 계정 (설계서 §8.4~§8.6): GitHub 로그인, 초대 코드 가입, 다른 기기 로그인 코드.
-- 코드와 토큰은 모두 HMAC(TOKEN_PEPPER) 해시로만 저장한다.

CREATE TABLE user_identities (
  provider   TEXT NOT NULL CHECK (provider IN ('github')),
  subject    TEXT NOT NULL,                    -- GitHub 사용자 id. login(아이디)은 바뀔 수 있어서 id로 찾는다
  user_id    TEXT NOT NULL REFERENCES users(id),
  login      TEXT NOT NULL,                    -- 화면에 보여 줄 GitHub 아이디. 로그인할 때마다 갱신한다
  created_at INTEGER NOT NULL,
  PRIMARY KEY (provider, subject)
) STRICT;
-- 한 사람에 GitHub 계정 하나
CREATE UNIQUE INDEX user_identities_user ON user_identities (user_id, provider);

CREATE TABLE invites (
  id         TEXT PRIMARY KEY,
  code_hash  TEXT NOT NULL UNIQUE,
  label      TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at    INTEGER,
  used_by    TEXT REFERENCES users(id)
) STRICT;
CREATE INDEX invites_creator ON invites (created_by, created_at);

-- 사람마다 살아 있는 코드는 하나다. 새로 만들면 이전 코드는 바로 무효다
CREATE TABLE login_codes (
  code_hash  TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL UNIQUE REFERENCES users(id),
  expires_at INTEGER NOT NULL
) STRICT;
CREATE INDEX login_codes_expiry ON login_codes (expires_at);

-- GitHub 확인은 끝났지만 아직 초대 코드를 넣지 않은 가입. 브라우저에는 토큰 쿠키만 둔다
CREATE TABLE pending_signups (
  token_hash TEXT PRIMARY KEY,
  provider   TEXT NOT NULL CHECK (provider IN ('github')),
  subject    TEXT NOT NULL,
  login      TEXT NOT NULL,
  name       TEXT,
  attempts   INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL
) STRICT;
CREATE INDEX pending_signups_expiry ON pending_signups (expires_at);
