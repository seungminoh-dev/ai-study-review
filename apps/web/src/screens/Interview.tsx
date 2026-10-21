import type { ImportResult, InterviewDepth, InterviewLevel, InterviewResponse, InterviewSummary, InterviewTopicSuggestion } from '@moai/shared';
import { CREDIT_COST, INTERVIEW_DEPTHS, INTERVIEW_LEVELS, interviewCost } from '@moai/shared/client';
import * as m from 'motion/react-m';
import { Fragment, useEffect, useRef, useState, type FormEvent } from 'react';
import { JOB_ERROR, forgetAiStatus, waitForJob } from '../ai';
import { AiNotice, useAiNotice } from '../cards/AskConcept';
import { RequestError, errorMessage, request } from '../api';
import { Coin } from '../credits';
import { Loading } from '../Loading';
import { Mascot } from '../Mascot';
import { SOFT } from '../motion';
import { Link, leave } from '../router';
import { useApi } from '../useApi';

// 앱 안 모의면접 (MCP 모의면접과 같은 순서): 흔들리는 개념에서 시작해 연결된 개념으로 꼬리질문을 이어 간다.
// 시작 화면에서 추천 주제나 직접 적은 주제, 난이도, 깊이(질문 수와 크레딧)를 고른다 (2026-10-21).
// 한 질문씩 답하고, 끝나면 잘한 점과 고칠 점을 정리한다. 원하면 판정과 카드로 기록에 남긴다. 대화는 기기에만 있다.

/** 시작 화면에서 고른 것. topic은 직접 적은 주제 */
interface Plan {
  concept_key?: string;
  topic?: string;
  depth: InterviewDepth;
  level: InterviewLevel;
}

interface Turn {
  question: string;
  answer: string;
}

type Saving = { state: 'idle' } | { state: 'saving' } | { state: 'done'; summary: string; sessionId: string } | { state: 'failed'; message: string };

const DONT_KNOW = '잘 모르겠어요.';

export function Interview({ concept, category }: { concept: string | null; category: string | null }) {
  const [plan, setPlan] = useState<Plan | null>(null);
  if (!plan) return <InterviewStart concept={concept} category={category} onStart={setPlan} />;
  return <InterviewSession plan={plan} category={category} />;
}

const DEPTH_KEYS = Object.keys(INTERVIEW_DEPTHS) as InterviewDepth[];
const LEVEL_KEYS = Object.keys(INTERVIEW_LEVELS) as InterviewLevel[];

/** 시작 화면: 추천 주제 또는 직접 적은 주제, 난이도, 깊이를 고른다. 추천은 AI를 부르지 않아서 크레딧이 들지 않는다 */
function InterviewStart({ concept, category, onStart }: { concept: string | null; category: string | null; onStart: (plan: Plan) => void }) {
  const params = new URLSearchParams({ ...(concept ? { concept } : {}), ...(category ? { category } : {}) });
  const { data, error } = useApi<{ topics: InterviewTopicSuggestion[] }>(`/interview/topics?${params}`);
  /** 고른 추천 주제의 시작 개념. null이면 직접 적은 주제 */
  const [picked, setPicked] = useState<string | null | undefined>(undefined);
  const [topic, setTopic] = useState('');
  const [level, setLevel] = useState<InterviewLevel>('practical');
  const [depth, setDepth] = useState<InterviewDepth>('normal');
  const topics = data?.topics ?? [];
  // 아직 아무것도 안 골랐으면 첫 추천 주제 (없으면 직접 적기)
  const choice = picked === undefined ? (topics[0]?.concept_key ?? null) : picked;
  const custom = choice === null;
  const ready = custom ? topic.trim().length > 0 : true;
  const start = () => {
    if (!ready) return;
    onStart(custom ? { topic: topic.trim(), depth, level } : { concept_key: choice, depth, level });
  };

  return (
    <div className="screen interview-start">
      <header className="review-top">
        <button type="button" className="icon-button" aria-label="닫기" onClick={leave}>
          ✕
        </button>
      </header>
      <div className="interview-head">
        <Mascot mood="study" size={44} />
        <div className="grow">
          <h1>꼬리질문 모의면접</h1>
          <p className="muted small">면접관이 한 질문씩 묻고, 답의 약한 곳을 파고들어요.</p>
        </div>
      </div>

      <section aria-labelledby="interview-topics-title">
        <h2 id="interview-topics-title">추천 주제</h2>
        {error ? <p className="notice bad">{error}</p> : null}
        {!data && !error ? <Loading label="주제를 고르는 중" /> : null}
        {data && topics.length === 0 ? <p className="muted small">아직 면접할 내 개념이 없어요. 아래에 주제를 직접 적어 보세요.</p> : null}
        {topics.length > 0 ? (
          <div className="interview-topics" role="radiogroup" aria-label="추천 주제">
            {topics.map((item) => (
              <button key={item.concept_key} type="button" role="radio" aria-checked={choice === item.concept_key} className={choice === item.concept_key ? 'topic-card on' : 'topic-card'} onClick={() => setPicked(item.concept_key)}>
                <span className="muted small">{item.reason}</span>
                <strong>{item.names.join(' → ')}</strong>
              </button>
            ))}
          </div>
        ) : null}
      </section>

      <section aria-labelledby="interview-custom-title">
        <h2 id="interview-custom-title">직접 고르기</h2>
        <label className="field">
          <span className="sr-only">면접 주제</span>
          <input
            value={topic}
            maxLength={60}
            placeholder="예: HTTP 캐시, 트랜잭션 격리 수준"
            onFocus={() => setPicked(null)}
            onChange={(event) => {
              setTopic(event.target.value);
              setPicked(null);
            }}
          />
        </label>
        <p className="muted small">내 개념과 맞으면 그 기록으로, 없으면 그 주제의 일반적인 면접 질문으로 물어요.</p>
      </section>

      <section aria-labelledby="interview-level-title">
        <h2 id="interview-level-title">난이도</h2>
        <div className="segmented" role="group" aria-labelledby="interview-level-title">
          {LEVEL_KEYS.map((key) => (
            <button key={key} type="button" className={level === key ? 'current' : ''} aria-pressed={level === key} onClick={() => setLevel(key)}>
              {INTERVIEW_LEVELS[key]}
            </button>
          ))}
        </div>
      </section>

      <section aria-labelledby="interview-depth-title">
        <h2 id="interview-depth-title">깊이</h2>
        <div className="segmented" role="group" aria-labelledby="interview-depth-title">
          {DEPTH_KEYS.map((key) => (
            <button key={key} type="button" className={depth === key ? 'current' : ''} aria-pressed={depth === key} onClick={() => setDepth(key)}>
              {INTERVIEW_DEPTHS[key].label} · {INTERVIEW_DEPTHS[key].questions}문
            </button>
          ))}
        </div>
        <p className="muted small">
          질문 {INTERVIEW_DEPTHS[depth].questions}개와 마지막 정리, 최대 {interviewCost(depth)} 크레딧이에요. 중간에 그만두면 물은 만큼만 써요.
        </p>
      </section>

      <div className="bottom-actions">
        <button type="button" className="button primary grow" disabled={!ready} onClick={start}>
          시작하기 · <Coin px={2} /> {interviewCost(depth)}
        </button>
      </div>
    </div>
  );
}

function InterviewSession({ plan, category }: { plan: Plan; category: string | null }) {
  const [chain, setChain] = useState<{ keys: string[]; names: string[]; total: number } | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [question, setQuestion] = useState<string | null>(null);
  const [summary, setSummary] = useState<InterviewSummary | null>(null);
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
        // 개념 순서가 정해지면 그대로 보낸다. 기록 없는 주제로 묻는 중이면 순서가 비어 있어 주제를 다시 보낸다
        json: {
          ...(chain && chain.keys.length > 0 ? { keys: chain.keys } : { ...(plan.concept_key ? { concept_key: plan.concept_key } : {}), ...(plan.topic ? { topic: plan.topic } : {}), ...(category ? { category } : {}) }),
          depth: plan.depth,
          level: plan.level,
          turns: sent,
        },
      });
      setChain({ keys: response.keys, names: response.names, total: response.total });
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

  const notice = useAiNotice();
  const answer = (value: string) => {
    if (!question || waiting) return;
    notice.dismiss();
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
      const { job_id } = await request<{ job_id: string }>('/interview/save', { method: 'POST', json: { keys: chain.keys, ...(chain.keys.length === 0 && plan.topic ? { topic: plan.topic } : {}), turns } });
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
  /** 지금 묻는 질문 번호(끝나면 전체). 위 막대와 숫자가 같은 값을 쓴다 */
  const position = Math.min(done + (summary ? 0 : 1), total);
  return (
    <div className="interview">
      {/* 머리는 위에 붙어 있다. 대화가 길어져도 어디까지 왔는지 보인다 */}
      <div className="interview-top">
        <header className="review-top">
          <button type="button" className="icon-button" aria-label="그만하기" onClick={quit}>
            ✕
          </button>
          <div className="progress" role="progressbar" aria-label="진행" aria-valuemin={0} aria-valuemax={total} aria-valuenow={position}>
            <div style={{ width: total ? `${(position / total) * 100}%` : '0%' }} />
          </div>
          <span className="muted count">{total ? `${position}/${total}` : ''}</span>
        </header>
        <div className="interview-head">
          <Mascot mood={waiting ? 'think' : summary ? 'cheer' : 'study'} size={44} />
          <div className="grow">
            <h1>꼬리질문 모의면접</h1>
            <p className="muted small">
              {chain ? chain.names.join(' → ') : '물을 개념을 고르는 중이에요'} · {INTERVIEW_LEVELS[plan.level]} · {INTERVIEW_DEPTHS[plan.depth].label}
            </p>
          </div>
        </div>
      </div>

      <div className="interview-log" aria-live="polite">
        {notice.show ? <AiNotice onDismiss={notice.dismiss} /> : null}
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
          {saving.summary} <Link href={`/sessions/${saving.sessionId}`}>공부한 대화에서 보기</Link>
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
