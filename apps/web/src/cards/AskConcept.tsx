import type { AskResponse, ImportResult, QueueCard } from '@moai/shared';
import { CREDIT_COST, creditsLeft } from '@moai/shared/client';
import { AnimatePresence } from 'motion/react';
import * as m from 'motion/react-m';
import { Fragment, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { JOB_ERROR, NO_CREDITS_HINT, aiStatus, forgetAiStatus, waitForJob } from '../ai';
import { RequestError, errorMessage, request } from '../api';
import { IconArrow } from '../icons';
import { Mascot } from '../Mascot';
import { Link } from '../router';
import { LEAVE, SOFT } from '../motion';

// AI 개념 채팅 (3단계 시안 "AI 개념 채팅"): 복습에서 답을 고른 카드(틀렸든 맞혔든)나 설명하기를 비교한 카드의 개념을 묻는다.
// 휴대폰은 답 아래 "이 개념 물어보기"로 여는 시트, 컴퓨터는 개념 패널의 "물어보기" 탭이다. 질문과 답은 기기에도 서버에도 남기지 않는다.

interface Turn {
  question: string;
  answer: string | null;
  error?: string;
}

/** 틀림, 맞혔지만 찍음·반반, 확실히 맞힘(확신도를 묻지 않는 연습·시험 포함), 설명하기 */
export type AskMode = 'wrong' | 'unsure' | 'right' | 'explain';

/** 고르면 그대로 질문이 된다 */
const SUGGESTIONS: Record<AskMode, string[]> = {
  wrong: ['내 답은 왜 틀렸어요?', '쉬운 예시로 설명해 줘요', '헷갈리기 쉬운 것과 뭐가 달라요?'],
  unsure: ['이게 왜 정답이에요?', '쉬운 예시로 설명해 줘요', '헷갈리기 쉬운 것과 뭐가 달라요?'],
  right: ['이게 왜 정답이에요?', '실제로는 어디에 쓰여요?', '헷갈리기 쉬운 것과 뭐가 달라요?'],
  explain: ['내 설명에서 빠진 게 뭐예요?', '더 짧게 말하려면요?', '쉬운 예시로 설명해 줘요'],
};

const INTRO: Record<AskMode, string> = {
  wrong: '어디가 헷갈렸어요? 아래에서 고르거나 직접 물어봐요.',
  unsure: '맞혔지만 확신은 없었죠? 아래에서 고르거나 직접 물어봐요.',
  right: '맞혔어요. 더 알고 싶은 게 있으면 고르거나 직접 물어봐요.',
  explain: '내 설명과 비교해서 궁금한 걸 물어봐요.',
};

const AI_NOTICE = 'moai:ai-notice';

/**
 * AI 기능을 처음 쓸 때 한 번만 보이는 안내 (크레딧, 틀릴 수 있음). "알겠어요"를 누르거나 처음 물어보면
 * 이 기기에서는 다시 보이지 않는다. 개념 물어보기, 모의면접, AI 채점이 같이 쓴다
 */
export function useAiNotice(): { show: boolean; dismiss: () => void } {
  const [show, setShow] = useState(() => {
    try {
      return localStorage.getItem(AI_NOTICE) === null;
    } catch {
      return false;
    }
  });
  const dismiss = () => {
    setShow(false);
    try {
      localStorage.setItem(AI_NOTICE, '1');
    } catch {
      // 못 적으면 다음에 한 번 더 보인다
    }
  };
  return { show, dismiss };
}

export function AiNotice({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className="notice warn ai-notice" role="note">
      <p>
        <strong>처음 한 번만 알려 드려요.</strong> AI에게 묻는 질문 하나(모의면접 질문, AI 채점도)에 크레딧 {CREDIT_COST.ask}을 써요. 남은 크레딧은 엽전 칩에서 볼 수 있고, AI 답은 틀릴 수 있어요.
      </p>
      <button type="button" className="text-button" onClick={onDismiss}>
        알겠어요
      </button>
    </div>
  );
}

/** 2차: 이 대화로 카드 만들기 */
type Making = { state: 'idle' } | { state: 'making' } | { state: 'done'; summary: string; sessionId: string } | { state: 'failed'; message: string };

export interface Ask {
  /** 서버 AI가 켜져 있고 이번 달 AI 한도가 남았다 */
  available: boolean;
  /** 남은 AI 크레딧 (월간 + 보유) */
  left: number;
  turns: Turn[];
  pending: boolean;
  ask: (question: string) => Promise<void>;
  making: Making;
  makeCards: () => Promise<void>;
}

/** 카드 자리(stageKey)마다 대화를 따로 둔다. 다음 카드로 가면 빈 대화가 된다 */
export function useAsk(stageKey: string, cardId: string | undefined, picked: string | null): Ask {
  const [status, setStatus] = useState({ available: false, left: 0 });
  const [log, setLog] = useState<{ key: string; turns: Turn[] }>({ key: stageKey, turns: [] });
  const [made, setMade] = useState<{ key: string; making: Making }>({ key: stageKey, making: { state: 'idle' } });

  useEffect(() => {
    void aiStatus().then((value) => setStatus({ available: value.available && !value.over_budget, left: creditsLeft(value.credits) }));
  }, []);

  const turns = log.key === stageKey ? log.turns : [];
  const last = turns.at(-1);
  const pending = last !== undefined && last.answer === null && !last.error;

  const ask = async (question: string) => {
    if (!cardId || pending || !question.trim()) return;
    const key = stageKey;
    // 앞서 주고받은 두 번까지 같이 보내서 "더 쉽게요" 같은 이어지는 질문도 알아듣게 한다
    const history = turns.flatMap((turn) => (turn.answer ? [{ question: turn.question, answer: turn.answer }] : [])).slice(-2);
    const settle = (patch: Partial<Turn>) =>
      setLog((current) => (current.key === key ? { key, turns: current.turns.map((turn, index) => (index === current.turns.length - 1 ? { ...turn, ...patch } : turn)) } : current));
    setLog({ key, turns: [...turns, { question: question.trim(), answer: null }] });
    try {
      const result = await request<AskResponse>(`/cards/${cardId}/ask`, { method: 'POST', json: { question: question.trim(), ...(picked ? { picked } : {}), history } });
      setStatus((value) => ({ ...value, left: creditsLeft(result.credits) }));
      forgetAiStatus();
      settle({ answer: result.answer });
    } catch (error) {
      if (error instanceof RequestError && error.status === 429) {
        forgetAiStatus();
        if (error.code === 'no_credits') setStatus((value) => ({ ...value, left: 0 }));
      }
      settle({ error: errorMessage(error) });
    }
  };

  const making = made.key === stageKey ? made.making : { state: 'idle' as const };
  const makeCards = async () => {
    const answered = turns.flatMap((turn) => (turn.answer ? [{ question: turn.question, answer: turn.answer }] : [])).slice(-6);
    if (!cardId || answered.length === 0 || making.state === 'making') return;
    const key = stageKey;
    const set = (next: Making) => setMade((current) => (current.key === key || next.state === 'making' ? { key, making: next } : current));
    set({ state: 'making' });
    try {
      const { job_id } = await request<{ job_id: string }>(`/cards/${cardId}/ask/cards`, { method: 'POST', json: { turns: answered, ...(picked ? { picked } : {}) } });
      forgetAiStatus();
      // 매분 작업이 만든다. 보통 1~2분이고, 다 되면 푸시로도 알린다
      const job = await waitForJob(job_id, 240_000);
      if (job.status === 'done') {
        const result = job.result as ImportResult;
        set({ state: 'done', summary: result.summary, sessionId: result.session_id });
      } else if (job.status === 'failed') {
        set({ state: 'failed', message: JOB_ERROR[job.error ?? ''] ?? '카드를 만들지 못했어요.' });
      } else {
        set({ state: 'failed', message: '아직 만드는 중이에요. 다 되면 알림으로 알려 드려요.' });
      }
    } catch (error) {
      if (error instanceof RequestError && error.status === 429) forgetAiStatus();
      set({ state: 'failed', message: errorMessage(error) });
    }
  };

  return { ...status, turns, pending, ask, making, makeCards };
}

/** 대화: 문제와 내 답, 추천 질문, 주고받은 말, 직접 묻는 칸 */
export function AskChat({ card, mode, picked, ask }: { card: QueueCard; mode: AskMode; picked: string; ask: Ask }) {
  const [text, setText] = useState('');
  const logRef = useRef<HTMLDivElement>(null);
  const asked = new Set(ask.turns.map((turn) => turn.question));

  useEffect(() => {
    const element = logRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [ask.turns.length, ask.pending]);

  const notice = useAiNotice();
  const send = (question: string) => {
    notice.dismiss();
    void ask.ask(question);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (ask.pending || ask.left < CREDIT_COST.ask || !text.trim()) return;
    send(text);
    setText('');
  };

  return (
    <div className="ask">
      <div className="ask-log" ref={logRef}>
        <p className="ask-context">
          <b>문제</b>
          <span>
            {card.prompt} · {mode === 'explain' ? `내 설명: ${picked || '(머릿속으로)'}` : `내 답: ${card.type === 'ox' ? picked : `“${picked}”`}`}
          </span>
        </p>
        {notice.show ? <AiNotice onDismiss={notice.dismiss} /> : null}
        <p className="bubble ai">{INTRO[mode]}</p>
        {ask.turns.map((turn, index) => (
          <Fragment key={index}>
            <p className="bubble me">{turn.question}</p>
            {turn.answer ? (
              <p className="bubble ai" aria-live="polite">
                {turn.answer}
              </p>
            ) : turn.error ? (
              <p className="notice bad" role="alert">
                {turn.error}
              </p>
            ) : (
              <div className="bubble ai typing" role="status" aria-label="답을 쓰는 중">
                <span />
                <span />
                <span />
              </div>
            )}
          </Fragment>
        ))}
        {ask.turns.some((turn) => turn.answer) && !ask.pending ? <MakeCards ask={ask} /> : null}
        {!ask.pending && ask.left >= CREDIT_COST.ask ? (
          <div className="ask-suggest">
            {SUGGESTIONS[mode].filter((question) => !asked.has(question)).map((question) => (
              <button key={question} type="button" className="ask-chip" onClick={() => send(question)}>
                {question}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <form className="ask-form" onSubmit={submit}>
        <div className="ask-row">
          <label className="sr-only" htmlFor={`ask-${card.id}`}>
            궁금한 것
          </label>
          <input
            id={`ask-${card.id}`}
            value={text}
            maxLength={300}
            enterKeyHint="send"
            autoComplete="off"
            placeholder={ask.left >= CREDIT_COST.ask ? '궁금한 걸 직접 물어봐요' : 'AI 크레딧을 다 썼어요'}
            disabled={ask.left < CREDIT_COST.ask}
            onChange={(event) => setText(event.target.value)}
          />
          <button type="submit" className="ask-send" aria-label="보내기" disabled={ask.pending || ask.left < CREDIT_COST.ask || !text.trim()}>
            <IconArrow />
          </button>
        </div>
        {ask.left < CREDIT_COST.ask ? <p className="muted small ask-out">{NO_CREDITS_HINT}</p> : null}
      </form>
    </div>
  );
}

/** 2차: 주고받은 대화로 카드 만들기. 붙여넣기 가져오기와 같은 작업이라 같은 예산 한도를 따르고, 크레딧은 CREDIT_COST.cards만큼 쓴다 */
function MakeCards({ ask }: { ask: Ask }) {
  const { making } = ask;
  if (making.state === 'making') return <p className="notice">이 대화로 카드를 만드는 중이에요. 1~2분 걸리고, 다 되면 알림으로도 알려 드려요.</p>;
  if (making.state === 'done') {
    return (
      <p className="notice good">
        {making.summary.split('\n')[0]}{' '}
        <Link href={`/sessions/${making.sessionId}`}>공부한 대화에서 보기</Link>
      </p>
    );
  }
  return (
    <>
      {making.state === 'failed' ? <p className="notice bad">{making.message}</p> : null}
      <button type="button" className="ask-chip make" onClick={() => void ask.makeCards()}>
        이 대화로 카드 만들기 · {CREDIT_COST.cards} 크레딧
      </button>
    </>
  );
}

/** 휴대폰: 아래에서 올라오는 시트. 닫아도 이 카드의 대화는 남는다 */
export function AskSheet({ open, pending, onClose, children }: { open: boolean; pending: boolean; onClose: () => void; children: ReactNode }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (open) closeRef.current?.focus();
  }, [open]);
  return (
    <AnimatePresence>
      {open ? (
        <Fragment key="ask">
          <m.div className="ask-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: LEAVE }} onClick={onClose} />
          <m.section
            className="ask-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ask-title"
            initial={{ y: '100%' }}
            animate={{ y: 0, transition: SOFT }}
            exit={{ y: '100%', transition: LEAVE }}
          >
            <span className="ask-grip" aria-hidden="true" />
            <header className="ask-head">
              <Mascot mood={pending ? 'think' : 'happy'} size={40} />
              <div className="grow">
                <strong id="ask-title">개념 물어보기</strong>
                <p>방금 문제와 내 답을 같이 보고 답해요</p>
              </div>
              <button ref={closeRef} type="button" className="icon-button" aria-label="닫기" onClick={onClose}>
                ✕
              </button>
            </header>
            {children}
          </m.section>
        </Fragment>
      ) : null}
    </AnimatePresence>
  );
}
