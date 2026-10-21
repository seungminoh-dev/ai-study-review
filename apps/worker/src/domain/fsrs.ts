import type { GradeIntervals } from '@moai/shared';
import { createEmptyCard, fsrs, generatorParameters, type Card, type Grade } from 'ts-fsrs';

// FSRS 설정 (설계서 §9.1)
export const scheduler = fsrs(
  generatorParameters({
    request_retention: 0.9,
    maximum_interval: 180,
    enable_fuzz: true,
    // 분 단위 학습 단계(1분·10분)는 쓰지 않는다. 하루 한두 번 몇 장씩 푸는 앱이라, 10분 뒤가 곧 "다음 복습의 맨 앞"이 되어
    // 방금 맞힌 카드만 계속 나왔다 (2026-10-21). 맞히면 며칠 뒤, 틀리면 다음 날 나온다. 바로 다시 풀기는 복습 끝의 "틀린 카드 다시 보기"가 한다
    enable_short_term: false,
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

/** 지금 등급마다 답하면 다음 복습까지 얼마나 남는지 (설명하기 버튼의 간격 표시, 설계서 §9.1) */
export function previewIntervals(fields: FsrsFields, now: number): GradeIntervals {
  const preview = scheduler.repeat(toFsrsCard(fields), new Date(now));
  const after = (grade: Grade) => Math.max(0, preview[grade].card.due.getTime() - now);
  return { '1': after(1 as Grade), '2': after(2 as Grade), '3': after(3 as Grade), '4': after(4 as Grade) };
}
