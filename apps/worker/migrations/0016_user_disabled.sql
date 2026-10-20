-- 오너가 회원 이용을 멈춘 때 (2026-10-20, 개선점 26). 비어 있으면 쓸 수 있다.
-- 멈추면 로그인·로그인 코드·커넥터·푸시·OAuth 권한을 모두 끊고, 다시 열 때까지 로그인과 커넥터를 받지 않는다. 열만 더한다
ALTER TABLE users ADD COLUMN disabled_at INTEGER;
