import type { QueueCard } from '@moai/shared';
import { AnimatePresence } from 'motion/react';
import * as m from 'motion/react-m';
import { useMemo, useState } from 'react';
import { Mascot } from '../Mascot';
import { LEAVE, Presence, SOFT } from '../motion';
import { QuestionCard, choicesOf, type Choice } from './QuestionCard';

// 체험 카드 (랜딩·시작 가이드): 실제 복습 카드와 같은 모양으로 3장을 풀어 본다. 기기 안에서만 돌고 아무것도 저장하지 않는다

type Sample = Partial<QueueCard> & Pick<QueueCard, 'id' | 'concept_name' | 'type' | 'prompt' | 'explain'>;

const sample = (card: Sample): QueueCard => ({
  concept_key: card.id,
  rung: 2,
  code: null,
  answer: null,
  options: null,
  choices: null,
  checklist: null,
  final_answer: null,
  intervals: null,
  state: 0,
  ...card,
});

const DEMO: QueueCard[] = [
  sample({
    id: 'demo-final',
    concept_name: '변수에 붙인 final',
    type: 'ox',
    prompt: 'final로 선언한 리스트에도 원소를 추가할 수 있다.',
    code: 'final List<String> names = new ArrayList<>();\nnames.add("kim");',
    answer: 'O',
    explain: 'final은 변수가 다른 리스트를 가리키지 못하게 막을 뿐이에요. 리스트 안의 값은 바꿀 수 있어요.',
  }),
  sample({
    id: 'demo-cache',
    concept_name: 'HTTP 캐시',
    type: 'mcq',
    prompt: '응답에 Cache-Control: no-cache가 있으면 브라우저는 어떻게 하나요?',
    options: [
      { text: '아예 저장하지 않는다', correct: false },
      { text: '저장하되 쓰기 전에 서버에 확인한다', correct: true },
      { text: '만료될 때까지 그대로 쓴다', correct: false },
    ],
    explain: 'no-cache는 "쓰기 전에 확인"이에요. 저장 자체를 막는 건 no-store예요.',
  }),
  sample({
    id: 'demo-amend',
    concept_name: 'Git 커밋 고치기',
    type: 'cloze',
    prompt: '마지막 커밋 메시지만 고치려면 git commit ____ 을 써요.',
    answer: '--amend',
    choices: ['--amend', '--fixup', '--squash'],
    explain: '--amend는 마지막 커밋을 새 커밋으로 바꿔요. 이미 push한 커밋이면 함께 쓰는 사람과 먼저 맞춰야 해요.',
  }),
];

export function DemoDeck() {
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<Choice | null>(null);
  const card = DEMO[index]!;
  const choices = useMemo(() => choicesOf(card), [card]);
  const last = index === DEMO.length - 1;
  const next = () => {
    setPicked(null);
    setIndex(last ? 0 : index + 1);
  };
  return (
    <div className="demo">
      <div className="demo-head">
        <span className="demo-count">
          체험 카드 {index + 1}/{DEMO.length}
        </span>
        <span className="muted small">여기서 푼 건 저장되지 않아요</span>
      </div>
      <AnimatePresence mode="wait" initial={false}>
        <Presence
          key={card.id}
          className="demo-stage"
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0, transition: SOFT }}
          exit={{ opacity: 0, x: -24, transition: LEAVE }}
        >
          <QuestionCard card={card} choices={choices} picked={picked} onPick={setPicked} />
          {picked ? (
            <m.div className="demo-answer" aria-live="polite" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0, transition: SOFT }}>
              <div className="answer-head">
                <Mascot mood={picked.correct ? 'cheer' : 'oops'} size={44} />
                <div>
                  <p className={picked.correct ? 'verdict right' : 'verdict wrong'}>{picked.correct ? '맞았어요!' : '아쉬워요'}</p>
                  <p className="small muted">{picked.correct ? '이런 카드가 잊을 때쯤 다시 와요.' : '틀린 카드는 내일 다시 나와요.'}</p>
                </div>
              </div>
              <p className="explain">{card.explain}</p>
              <button type="button" className="button primary" onClick={next}>
                {last ? '처음부터 다시' : '다음 카드'}
              </button>
            </m.div>
          ) : null}
        </Presence>
      </AnimatePresence>
    </div>
  );
}
