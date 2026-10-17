import { createEmptyCard, fsrs, generatorParameters, type Card, type Grade } from 'ts-fsrs';

// FSRS 설정 (설계서 §9.1)
export const scheduler = fsrs(
  generatorParameters({
    request_retention: 0.9,
    maximum_interval: 180,
    enable_fuzz: true,
    // 새 카드는 1분·10분 학습 단계, 복습 중 틀린 카드는 10분 재학습 단계를 거친다 (ts-fsrs 기본값)
    enable_short_term: true,
  }),
);

/** cards 테이블의 FSRS 열. 시각은 UTC epoch ms다. */
export interface FsrsFields {
  due: number;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  learning_steps: number;
  reps: number;
  lapses: number;
  state: number;
  last_review: number | null;
}

export function toFsrsCard(fields: FsrsFields): Card {
  return {
    due: new Date(fields.due),
    stability: fields.stability,
    difficulty: fields.difficulty,
    elapsed_days: fields.elapsed_days,
    scheduled_days: fields.scheduled_days,
    learning_steps: fields.learning_steps,
    reps: fields.reps,
    lapses: fields.lapses,
    state: fields.state,
    ...(fields.last_review === null ? {} : { last_review: new Date(fields.last_review) }),
  };
}

export function fromFsrsCard(card: Card): FsrsFields {
  return {
    due: card.due.getTime(),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.elapsed_days,
    scheduled_days: card.scheduled_days,
    learning_steps: card.learning_steps,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    last_review: card.last_review ? card.last_review.getTime() : null,
  };
}

export function emptyFsrsFields(now: number): FsrsFields {
  return fromFsrsCard(createEmptyCard(new Date(now)));
}

/** 채점 시각 reviewedAt에 grade로 답했을 때의 다음 FSRS 상태 */
export function nextFsrsFields(fields: FsrsFields, reviewedAt: number, grade: 1 | 2 | 3 | 4): FsrsFields {
  return fromFsrsCard(scheduler.next(toFsrsCard(fields), new Date(reviewedAt), grade as Grade).card);
}

export function pickFsrsFields(row: FsrsFields): FsrsFields {
  const { due, stability, difficulty, elapsed_days, scheduled_days, learning_steps, reps, lapses, state, last_review } = row;
  return { due, stability, difficulty, elapsed_days, scheduled_days, learning_steps, reps, lapses, state, last_review };
}
