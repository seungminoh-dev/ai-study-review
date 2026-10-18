-- 확신도 (설계서 §9.3): 객관식·OX를 고른 뒤 "확실 / 반반 / 찍음"을 남긴다. 확신했는데 틀린 답을 따로 볼 수 있다.
-- 열 하나만 더한다. 이전 기록은 NULL(묻지 않음)이다.
ALTER TABLE review_logs ADD COLUMN confidence TEXT CHECK (confidence IN ('sure', 'unsure', 'guess'));
