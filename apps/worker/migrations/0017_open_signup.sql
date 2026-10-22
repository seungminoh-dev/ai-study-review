-- 초대 코드 없이 가입 (2026-10-22). 열만 더한다.
-- 사람마다 월간 크레딧. 지금 회원과 초대 코드로 가입하는 사람은 500, 초대 없이 가입하는 사람은 0이다(자동 충전 없음)
ALTER TABLE users ADD COLUMN monthly_credits INTEGER NOT NULL DEFAULT 500;
-- GitHub 계정이 만들어진 때 (ms). 초대 없이 가입할 때 막 만든 계정을 거른다
ALTER TABLE pending_signups ADD COLUMN account_created_at INTEGER;
