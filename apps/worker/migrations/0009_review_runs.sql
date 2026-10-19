-- 무실수 보너스 (4단계 1). 한 번 복습할 때의 답을 묶는다. PWA가 복습 화면을 열 때 만든 UUID다.
-- 예전 기록과 채팅 채점은 비어 있고, 보너스는 기록에서 센다 (domain/stats.ts).
ALTER TABLE review_logs ADD COLUMN run_id TEXT;
