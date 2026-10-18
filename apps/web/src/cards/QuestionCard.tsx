import type { QueueCard } from '@moai/shared';
import { useMemo } from 'react';
import { CodeBlock } from './CodeBlock';

// 카드 한 장: 문제와 보기. 카드 내용은 React 텍스트로만 그린다 (설계서 §14).

export interface Choice {
  /** 서버에 보낼 응답 (보기 글자 그대로) */
  value: string;
  label: string;
  correct: boolean;
  /** 예전에 내가 한 오답 */
  mine: boolean;
}

function shuffle<T>(items: readonly T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

/** 객관식·빈칸 보기 순서는 매번 섞는다 */
export function choicesOf(card: QueueCard): Choice[] {
  switch (card.type) {
    case 'ox':
      return [
        { value: 'O', label: 'O 맞아요', correct: card.answer === 'O', mine: false },
        { value: 'X', label: 'X 틀려요', correct: card.answer === 'X', mine: false },
      ];
    case 'mcq':
      return shuffle(card.options ?? []).map((option) => ({ value: option.text, label: option.text, correct: option.correct, mine: option.from_my_answer === true }));
    case 'cloze':
      return shuffle(card.choices ?? []).map((choice) => ({ value: choice, label: choice, correct: choice === card.answer, mine: false }));
    case 'explain':
      return [];
  }
}

const KIND: Record<QueueCard['type'], string> = { ox: 'OX', mcq: '객관식', cloze: '빈칸', explain: '설명하기' };

function ClozePrompt({ prompt, filled }: { prompt: string; filled: string | null }) {
  const [before, after] = prompt.split('____');
  return (
    <p className="prompt">
      {before}
      <span className={filled ? 'blank filled' : 'blank'}>{filled ?? '      '}</span>
      {after}
    </p>
  );
}

export function QuestionCard({
  card,
  choices,
  picked,
  chosen = null,
  onPick,
}: {
  card: QueueCard;
  choices: Choice[];
  /** 정답을 보여 줄 답. 있으면 보기를 잠근다 */
  picked: Choice | null;
  /** 골랐지만 아직 확신도를 기다리는 답 */
  chosen?: Choice | null;
  onPick: (choice: Choice) => void;
}) {
  const answered = picked !== null;
  const correctLabel = useMemo(() => choices.find((choice) => choice.correct)?.label ?? null, [choices]);
  return (
    <div className="question">
      <div className="question-meta">
        <span className="chip">{card.concept_name}</span>
        <span className="muted">
          {KIND[card.type]} · {card.rung === 1 ? '알아보기' : '떠올리기'}
        </span>
      </div>
      {card.type === 'cloze' ? (
        <ClozePrompt prompt={card.prompt} filled={answered ? correctLabel : null} />
      ) : (
        <p className="prompt">{card.prompt}</p>
      )}
      {card.code ? <CodeBlock code={card.code} /> : null}
      <div className={card.type === 'ox' ? 'choices ox' : 'choices'} role="group" aria-label="보기">
        {choices.map((choice) => {
          const state = !answered ? (choice === chosen ? 'chosen' : '') : choice.correct ? 'right' : choice === picked ? 'wrong' : 'dim';
          return (
            <button key={choice.value} type="button" className={`choice ${state}`} disabled={answered} onClick={() => onPick(choice)}>
              <span>{choice.label}</span>
              {answered && choice.mine ? <span className="mine">예전에 내가 한 설명</span> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
