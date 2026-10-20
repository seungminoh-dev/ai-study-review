-- 약관·처리방침 동의 기록 (2026-10-20, 개선점 14). 가입할 때와 오늘 화면에서 바뀐 문서를 확인할 때 적는다.
-- 열만 더한다. 지금 회원은 비어 있어서 다음에 오늘 화면을 열면 확인 카드가 한 번 뜬다
ALTER TABLE users ADD COLUMN terms_version TEXT;
ALTER TABLE users ADD COLUMN terms_accepted_at INTEGER;
