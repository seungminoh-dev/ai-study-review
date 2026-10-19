import type { ImportResult, InterviewResponse, InterviewSummary } from '@moai/shared';
import { CREDIT_COST, creditsLeft } from '@moai/shared/client';
import * as m from 'motion/react-m';
import { Fragment, useEffect, useRef, useState, type FormEvent } from 'react';
import { JOB_ERROR, forgetAiStatus, waitForJob } from '../ai';
import { RequestError, errorMessage, request } from '../api';
import { Mascot } from '../Mascot';
import { SOFT } from '../motion';
import { Link, leave } from '../router';

// 앱 안 모의면접 (MCP 모의면접과 같은 순서): 흔들리는 개념에서 시작해 연결된 개념으로 꼬리질문을 이어 간다.
// 한 질문씩 답하고, 끝나면 잘한 점과 고칠 점을 정리한다. 원하면 판정과 카드로 기록에 남긴다. 대화는 기기에만 있다.

interface Turn {
  question: string;
  answer: string;
}

type Saving = { state: 'idle' } | { state: 'saving' } | { state: 'done'; summary: string; sessionId: string } | { state: 'failed'; message: string };

const DONT_KNOW = '잘 모르겠어요.';

export function Interview({ concept, category }: { concept: string | null; category: string | null }) {
  const [chain, setChain] = useState<{ keys: string[]; names: string[]; total: number } | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [question, setQuestion] = useState<string | null>(null);
  const [summary, setSummary] = useState<InterviewSummary | null>(null);
  const [left, setLeft] = useState<number | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [saving, setSaving] = useState<Saving>({ state: 'idle' });
  const started = useRef(false);
  const input = useRef<HTMLTextAreaElement>(null);

  const ask = async (sent: Turn[]) => {
    setWaiting(true);
    setError(null);
    try {
      const response = await request<InterviewResponse>('/interview', {
        method: 'POST',
        json: chain ? { keys: chain.keys, turns: sent } : { ...(concept ? { concept_key: concept } : {}), ...(category ? { category } : {}), turns: [] },
      });
      setChain({ keys: response.keys, names: response.names, total: response.total });
      setLeft(creditsLeft(response.credits));
      forgetAiStatus();
      setSummary(response.summary);
      setQuestion(response.question?.question ?? null);
    } catch (problem) {
      if (problem instanceof RequestError && problem.status === 429) forgetAiStatus();
      setError(errorMessage(problem));
    } finally {
      setWaiting(false);
    }
  };

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void ask([]);
  }, []);

  // 새 말이 오면 문서 끝까지 내린다. 입력 칸이 아래에 붙어 있어서, 마지막 말이 그 뒤에 가리지 않고 바로 위에 보인다
  useEffect(() => {
    window.scrollTo({ top: document.documentElement.scrollHeight });
    if (question) input.current?.focus({ preventScroll: true });
  }, [turns.length, question, waiting, summary, error]);

  const answer = (value: string) => {
    if (!question || waiting) return;
    const sent = [...turns, { question, answer: value.trim() }];
    setTurns(sent);
    setQuestion(null);
    setText('');
    void ask(sent);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (text.trim()) answer(text);
  };

  const quit = () => {
    if (turns.length > 0 && !summary && !confirm('면접을 그만둘까요? 지금까지 답은 남지 않아요.')) return;
    leave();
  };

  const save = async () => {
    if (!chain || saving.state === 'saving') return;
    setSaving({ state: 'saving' });
    try {
      const { job_id } = await request<{ job_id: string }>('/interview/save', { method: 'POST', json: { keys: chain.keys, turns } });
      const job = await waitForJob(job_id, 240_000);
      if (job.status === 'done') {
        const result = job.result as ImportResult;
        setSaving({ state: 'done', summary: result.summary.split('\n')[0]!, sessionId: result.session_id });
      } else {
        setSaving({ state: 'failed', message: job.status === 'failed' ? (JOB_ERROR[job.error ?? ''] ?? '기록하지 못했어요.') : '아직 정리하는 중이에요. 다 되면 알림으로 알려 드려요.' });
      }
    } catch (problem) {
      setSaving({ state: 'failed', message: errorMessage(problem) });
    }
  };

  const done = turns.length;
  const total = chain?.total ?? 0;
  return (
    <div className="interview">
      {/* 머리는 위에 붙어 있다. 대화가 길어져도 어디까지 왔는지 보인다 */}
      <div className="interview-top">
        <header className="review-top">
          <button type="button" className="icon-button" aria-label="그만하기" onClick={quit}>
            ✕
          </button>
          <div className="progress" role="progressbar" aria-label="진행" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}>
            <div style={{ width: total ? `${(done / total) * 100}%` : '0%' }} />
          </div>
          <span className="muted count">{total ? `${Math.min(done + (summary ? 0 : 1), total)}/${total}` : ''}</span>
        </header>
        <div className="interview-head">
          <Mascot mood={waiting ? 'think' : summary ? 'cheer' : 'study'} size={44} />
          <div className="grow">
            <h1>꼬리질문 모의면접</h1>
            <p className="muted small">{chain ? chain.names.join(' → ') : '물을 개념을 고르는 중이에요'}</p>
          </div>
        </div>
      </div>

      <div className="interview-log" aria-live="polite">
        {turns.map((turn, index) => (
          <Fragment key={index}>
            <p className="bubble ai">{turn.question}</p>
            <p className="bubble me">{turn.answer}</p>
          </Fragment>
        ))}
        {question ? (
          <m.p key={question} className="bubble ai" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0, transition: SOFT }}>
            {question}
          </m.p>
        ) : null}
        {waiting ? (
          <div className="bubble ai typing" role="status" aria-label="면접관이 생각하는 중">
            <span />
            <span />
            <span />
          </div>
        ) : null}
        {error ? (
          <div className="notice bad" role="alert">
            {error}{' '}
            <button type="button" className="text-button inline" onClick={() => void ask(turns)}>
              다시 시도
            </button>
          </div>
        ) : null}
        {summary ? <Summary summary={summary} saving={saving} onSave={() => void save()} /> : null}
      </div>

      {/* 면접이 끝날 때까지 입력 칸을 둔다. 답을 보내는 동안 없애면 페이지가 짧아져 맨 위로 튄다 */}
      {summary ? null : (
        <form className="interview-form" onSubmit={submit}>
          <label className="sr-only" htmlFor="interview-answer">
            내 답
          </label>
          <textarea
            id="interview-answer"
            ref={input}
            className="answer-input"
            rows={4}
            maxLength={2000}
            value={text}
            placeholder={waiting ? '면접관이 생각하는 중이에요. 먼저 적어 둬도 돼요.' : '면접관에게 말하듯 답해 보세요. 첫 문장에 답부터.'}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') submit(event);
            }}
          />
          <div className="actions">
            <button type="button" className="button" disabled={!question || waiting} onClick={() => answer(DONT_KNOW)}>
              모르겠어요
            </button>
            <button type="submit" className="button primary" disabled={!question || waiting || !text.trim()}>
              답하기
            </button>
          </div>
          <p className="ask-foot">{left !== null ? `질문 하나에 ${CREDIT_COST.interview} 크레딧 · 남은 크레딧 ${left} · ` : ''}AI가 묻고 정리해요. 틀릴 수 있어요</p>
          <p className="kbd-hint muted small">키보드: Ctrl+Enter 답하기</p>
        </form>
      )}
    </div>
  );
}

function Summary({ summary, saving, onSave }: { summary: InterviewSummary; saving: Saving; onSave: () => void }) {
  return (
    <m.section className="interview-summary" aria-labelledby="interview-summary-title" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0, transition: SOFT }}>
      <h2 id="interview-summary-title">면접을 마쳤어요</h2>
      {summary.good.length > 0 ? (
        <>
          <h3>잘한 점</h3>
          <ul>
            {summary.good.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </>
      ) : null}
      {summary.fix.length > 0 ? (
        <>
          <h3>고칠 점</h3>
          <ul>
            {summary.fix.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </>
      ) : null}
      {saving.state === 'saving' ? <p className="notice">판정과 카드로 정리하는 중이에요. 1~2분 걸리고, 다 되면 알림으로도 알려 드려요.</p> : null}
      {saving.state === 'done' ? (
        <p className="notice good">
          {saving.summary} <Link href={`/sessions/${saving.sessionId}`}>저장 기록에서 보기</Link>
        </p>
      ) : null}
      {saving.state === 'failed' ? <p className="notice bad">{saving.message}</p> : null}
      <div className="actions">
        {saving.state === 'idle' || saving.state === 'failed' ? (
          <button type="button" className="button" onClick={onSave}>
            판정과 카드로 기록하기 · {CREDIT_COST.cards} 크레딧
          </button>
        ) : null}
        <button type="button" className="button primary" onClick={leave}>
          끝내기
        </button>
      </div>
    </m.section>
  );
}
