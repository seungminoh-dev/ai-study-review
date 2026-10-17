import type { GradeResult, ReviewGrade } from '@moai/shared';
import { useEffect, useRef, useState } from 'react';
import { JOB_ERROR, aiStatus, forgetAiStatus, waitForJob } from '../ai';
import { RequestError, errorMessage, request } from '../api';

// 설명하기 AI 채점 (설계서 §11.2): 문장별 판정, 빠진 항목, 두괄식, 질문 하나. 모범답안은 보여 주지 않는다.
// 등급은 AI가 제안만 하고, 사용자가 눌러야 기록된다.

const GRADE_OF: Record<GradeResult['suggested_grade'], ReviewGrade> = { again: 1, hard: 2, good: 3, easy: 4 };

type State = { step: 'idle' } | { step: 'waiting' } | { step: 'done'; result: GradeResult } | { step: 'error'; message: string };

export function AiGrade({ cardId, text, onSuggest }: { cardId: string; text: string; onSuggest: (grade: ReviewGrade) => void }) {
  const [available, setAvailable] = useState(false);
  const [state, setState] = useState<State>({ step: 'idle' });
  const abort = useRef(new AbortController());

  useEffect(() => {
    void aiStatus().then((status) => setAvailable(status.available && !status.over_budget));
    const controller = abort.current;
    return () => controller.abort();
  }, []);

  if (!available) return null;
  const grade = async () => {
    setState({ step: 'waiting' });
    try {
      const { job_id } = await request<{ job_id: string }>(`/cards/${cardId}/grade-ai`, { method: 'POST', json: { answer: text } });
      const job = await waitForJob(job_id, 60_000, abort.current.signal);
      if (job.status === 'done') {
        const result = job.result as GradeResult;
        setState({ step: 'done', result });
        onSuggest(GRADE_OF[result.suggested_grade]);
      } else if (job.status === 'failed') {
        if (job.error === 'budget') forgetAiStatus();
        setState({ step: 'error', message: JOB_ERROR[job.error ?? ''] ?? 'AI 채점에 실패했어요.' });
      } else {
        setState({ step: 'error', message: '채점이 오래 걸려요. 자가 채점으로 진행해 주세요.' });
      }
    } catch (error) {
      if (error instanceof RequestError && error.status === 429) forgetAiStatus();
      setState({ step: 'error', message: errorMessage(error) });
    }
  };

  if (state.step === 'idle') {
    return (
      <button type="button" className="button ai-button" disabled={!text.trim()} onClick={() => void grade()}>
        {text.trim() ? 'AI에게 채점 받기' : 'AI 채점은 설명을 써야 받을 수 있어요'}
      </button>
    );
  }
  if (state.step === 'waiting') return <p className="notice">AI가 채점하는 중이에요… (5~20초)</p>;
  if (state.step === 'error') return <p className="notice bad">{state.message}</p>;
  const { result } = state;
  return (
    <div className="ai-result">
      <p className="small muted">AI 판정이며 틀릴 수 있어요. 등급은 직접 골라 주세요.</p>
      <ul className="list">
        {result.sentences.map((sentence, index) => (
          <li key={index}>
            <span className={`label label-${sentence.label}`}>{sentence.label}</span> {sentence.quote ? <q>{sentence.quote}</q> : null}
            <p className="muted small">{sentence.reason}</p>
          </li>
        ))}
      </ul>
      <p className="small">
        {result.top_down.ok ? '✓ 두괄식이에요.' : '✗ 첫 문장에 답이 없어요.'} {result.top_down.note}
      </p>
      {result.missing.length > 0 ? <p className="small">빠진 요소: {result.missing.join(', ')}</p> : null}
      <p className="coach-question">💬 {result.coaching_question}</p>
    </div>
  );
}
