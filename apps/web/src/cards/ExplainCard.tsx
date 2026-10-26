import type { QueueCard, ReviewGrade } from '@moai/shared';
import { useEffect, useState, type ReactNode } from 'react';
import { formatInterval } from '../useApi';

// 설명하기 카드 (설계서 §9.3): 먼저 내 말로 설명한다 → 내 최종 버전과 체크리스트를 보고 → 등급 4개 중 하나를 누른다.
// 답을 보기 전에 스스로 떠올려 쓰는 것이 기억에 가장 크게 남는다(생성 효과). 그래서 보기 전에 쓰는 칸을 먼저 둔다.

export const GRADE_LABEL: Record<ReviewGrade, string> = { 1: '다시', 2: '어려움', 3: '좋음', 4: '쉬움' };
const GRADE_HINT: Record<ReviewGrade, string> = {
  1: '떠올리지 못했거나 틀렸어요',
  2: '빠진 게 있거나 애매했어요',
  3: '핵심을 거의 다 말했어요',
  4: '두괄식으로 짧고 정확했어요',
};

export function ExplainCard({
  card,
  onGrade,
  aiPanel,
  onReveal,
}: {
  card: QueueCard;
  onGrade: (grade: ReviewGrade, text: string) => void;
  /** 답을 본 뒤에 보여 줄 AI 채점 영역 (없으면 자가 채점만) */
  aiPanel?: (text: string, suggest: (grade: ReviewGrade) => void) => ReactNode;
  /** 내 최종 버전을 펼쳤을 때 내가 쓴 설명과 함께. 컴퓨터의 개념 패널이 이때 열린다 */
  onReveal?: (text: string) => void;
}) {
  const [text, setText] = useState('');
  const [revealed, setRevealed] = useState(false);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [suggested, setSuggested] = useState<ReviewGrade | null>(null);

  useEffect(() => {
    // 펼친 순간에 한 번만 알린다
    if (revealed) onReveal?.(text);
  }, [revealed]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey || event.metaKey || event.repeat) return;
      if (!revealed && event.ctrlKey && event.key === 'Enter') {
        event.preventDefault();
        setRevealed(true);
      } else if (revealed && !event.ctrlKey && /^[1-4]$/.test(event.key) && !(event.target as HTMLElement | null)?.closest('input, textarea')) {
        event.preventDefault();
        onGrade(Number(event.key) as ReviewGrade, text);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const toggle = (index: number) => {
    const next = new Set(checked);
    if (next.has(index)) next.delete(index);
    else next.add(index);
    setChecked(next);
  };

  return (
    <div className="question explain-card">
      <div className="question-meta">
        <span className="chip">{card.concept_name}</span>
        <span className="muted">설명하기</span>
      </div>
      <p className="prompt">{card.prompt}</p>
      <label className="field">
        <span className="muted small">면접관에게 말하듯 30초 분량으로. 첫 문장에 답부터 써 보세요. 머릿속으로만 해도 돼요.</span>
        <textarea
          className="answer-input"
          value={text}
          onChange={(event) => setText(event.target.value)}
          maxLength={2000}
          rows={6}
          readOnly={revealed}
          aria-label="내 설명"
        />
      </label>
      {!revealed ? (
        <div className="choices">
          <button type="button" className="button primary" onClick={() => setRevealed(true)}>
            {text.trim() ? '내 최종 버전과 비교하기' : '머릿속으로 설명했어요 · 비교하기'}
          </button>
          <p className="kbd-hint muted small">키보드: Ctrl+Enter 비교하기</p>
        </div>
      ) : (
        <div className="answer-panel" aria-live="polite">
          {card.final_answer ? (
            <>
              <p className="small muted">내가 예전에 확정한 최종 버전</p>
              <blockquote>{card.final_answer}</blockquote>
            </>
          ) : null}
          {card.checklist ? (
            <>
              <p className="small muted">핵심 요소: 말한 것에 체크해 보세요</p>
              <ul className="checklist">
                {card.checklist.map((item, index) => (
                  <li key={item}>
                    <label>
                      <input type="checkbox" checked={checked.has(index)} onChange={() => toggle(index)} /> {item}
                    </label>
                  </li>
                ))}
              </ul>
              <p className="small muted">첫 문장에 질문의 답이 있었나요? (두괄식)</p>
            </>
          ) : null}
          {aiPanel ? aiPanel(text, setSuggested) : null}
          <div className="grades" role="group" aria-label="자가 채점">
            {([1, 2, 3, 4] as const).map((grade) => (
              <button
                key={grade}
                type="button"
                className={`grade grade-${grade}${suggested === grade ? ' suggested' : ''}`}
                title={GRADE_HINT[grade]}
                onClick={() => onGrade(grade, text)}
              >
                <strong>{GRADE_LABEL[grade]}</strong>
                <span className="small">{card.intervals ? formatInterval(card.intervals[grade]) : ''}</span>
              </button>
            ))}
          </div>
          <p className="kbd-hint muted small">키보드: 1 다시 · 2 어려움 · 3 좋음 · 4 쉬움</p>
        </div>
      )}
    </div>
  );
}
