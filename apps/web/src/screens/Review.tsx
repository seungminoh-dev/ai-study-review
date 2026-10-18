import type { QueueCard, QueueResponse, ReportReason, ReviewGrade, StatsResponse } from '@moai/shared';
import type { Confidence } from '@moai/shared/client';
import { MAX_ELAPSED_MS, gradeAnswer } from '@moai/shared/client';
import { AnimatePresence } from 'motion/react';
import * as m from 'motion/react-m';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { OfflineError, errorMessage, request } from '../api';
import { AiGrade } from '../cards/AiGrade';
import { ExplainCard } from '../cards/ExplainCard';
import { QuestionCard, choicesOf, type Choice } from '../cards/QuestionCard';
import { Confetti } from '../Confetti';
import { IconFlame } from '../icons';
import { Loading } from '../Loading';
import { Mascot } from '../Mascot';
import { LEAVE, Presence, SOFT, useCountUp } from '../motion';
import { cacheQueue, cachedQueue, enqueueReview, flushReviews, forgetAnswered, pendingCardIds, removeFromOutbox } from '../offline/store';
import { goTab, leave } from '../router';

// 복습 세션 (설계서 §12.1, §12.2). 카드 한 장씩: 답 고르기 → 맞음·틀림과 해설 → 다음.

interface Result {
  card: QueueCard;
  correct: boolean;
  /** 확신했는데 틀렸다 */
  confidentMiss?: boolean;
}

const ASK_CONFIDENCE = 'moai:ask-confidence';

/** 답을 고른 뒤 확신도를 물을지. 기기마다 설정에서 끌 수 있다 (기본 켬) */
export function askConfidence(): boolean {
  try {
    return localStorage.getItem(ASK_CONFIDENCE) !== 'off';
  } catch {
    return true;
  }
}

export function setAskConfidence(on: boolean): void {
  try {
    localStorage.setItem(ASK_CONFIDENCE, on ? 'on' : 'off');
  } catch {
    // 저장소를 못 쓰면 기본값(켬)으로 둔다
  }
}

const CONFIDENCE_LABEL: Record<Confidence, string> = { sure: '확실해요', unsure: '반반이에요', guess: '찍었어요' };

/** 큐는 한 번에 20장까지 받는다 */
const MAX_QUEUE = 20;

type Load = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ready'; cards: QueueCard[]; offline: boolean };

export function Review({ size, category, material, part }: { size: number; category?: string | null; material?: string | null; part?: string | null }) {
  const [load, setLoad] = useState<Load>({ state: 'loading' });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // 밀린 답을 먼저 보낸다. 못 보낸 답의 카드는 서버가 아직 모르니 큐에서 뺀다
        await flushReviews();
        const pending = await pendingCardIds();
        const params = new URLSearchParams({ size: String(Math.min(size + pending.size, MAX_QUEUE)) });
        if (category) params.set('category', category);
        if (material) params.set('material', material);
        // 자료의 섹션 하나만 풀 때
        if (material && part !== null && part !== undefined) params.set('part', part);
        const queue = await request<QueueResponse>(`/queue?${params}`);
        const cards = queue.cards.filter((card) => !pending.has(card.id)).slice(0, size);
        // 오프라인용으로는 오늘 큐 전체만 남긴다. 분류·자료로 거른 큐를 남기면 다음 오프라인 복습이 그 카드만 낸다
        if (!category && !material) await cacheQueue(cards);
        if (!cancelled) setLoad({ state: 'ready', cards, offline: false });
      } catch (error) {
        if (error instanceof OfflineError && (category || material)) {
          if (!cancelled) setLoad({ state: 'error', message: '인터넷에 연결되지 않았어요. 분류·자료별 복습은 연결된 뒤에 할 수 있어요.' });
        } else if (error instanceof OfflineError) {
          const cards = (await cachedQueue()).slice(0, size);
          if (!cancelled) setLoad(cards.length > 0 ? { state: 'ready', cards, offline: true } : { state: 'error', message: '인터넷에 연결되지 않았고, 저장해 둔 카드도 없어요.' });
        } else if (!cancelled) setLoad({ state: 'error', message: errorMessage(error) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [size, category, material, part]);

  if (load.state === 'loading') return <Loading label="카드를 가져오는 중" />;
  if (load.state === 'error') {
    return (
      <div className="screen">
        <p className="notice bad">{load.message}</p>
        <HomeButton />
      </div>
    );
  }
  if (load.cards.length === 0) {
    return (
      <div className="screen done">
        <Mascot mood="sleep" size={96} />
        <p className="big">오늘 복습할 카드가 없어요</p>
        <p className="muted">다 했거나, 아직 저장한 카드가 없어요.</p>
        <HomeButton primary />
      </div>
    );
  }
  return <Session initial={load.cards} offline={load.offline} />;
}

interface Recorded {
  reviewId: string;
  card: QueueCard;
}

const REPORT_REASONS: { reason: ReportReason; label: string }[] = [
  { reason: 'wrong', label: '정답이나 해설이 틀렸어요' },
  { reason: 'unclear', label: '문제가 애매해요' },
  { reason: 'duplicate', label: '다른 카드와 같아요' },
  { reason: 'other', label: '그 밖의 문제' },
];

function Session({ initial, offline }: { initial: QueueCard[]; offline: boolean }) {
  const [cards, setCards] = useState(initial);
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<Choice | null>(null);
  /** 골랐지만 확신도를 기다리는 답 (확신도를 물을 때만) */
  const [chosen, setChosen] = useState<Choice | null>(null);
  const [confidence, setConfidence] = useState<Confidence | null>(null);
  const [asking] = useState(askConfidence);
  const [results, setResults] = useState<Result[]>([]);
  const [busy, setBusy] = useState(false);
  /** "틀린 카드 다시 보기"는 연습이라 기록하지 않는다. 방금 정답을 봤으니 기록하면 재학습 단계를 건너뛰게 된다 */
  const [practice, setPractice] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  /** 방금 기록한 답. 잘못 눌렀으면 다음 카드에서 되돌릴 수 있다 */
  const [last, setLast] = useState<Recorded | null>(null);
  const [reporting, setReporting] = useState(false);
  /** 두 번 탭해도 한 번만 기록한다 */
  const moving = useRef(false);
  const shownAt = useRef(Date.now());
  const answeredAt = useRef(0);

  const card = cards[index];
  /** 지금 보이는 카드 자리. 사라지는 중인 카드의 버튼은 예전 렌더의 함수라 이 값과 달라서 무시한다 */
  const stageKey = card ? `${card.id}-${index}` : 'end';
  const liveKey = useRef(stageKey);
  useLayoutEffect(() => {
    liveKey.current = stageKey;
  });
  const stale = () => liveKey.current !== stageKey;
  const choices = useMemo(() => (card ? choicesOf(card) : []), [card]);
  /** 답을 본 카드 수. 지금 카드도 답을 봤으면 센다 */
  const done = index + (picked ? 1 : 0);

  useEffect(() => {
    shownAt.current = Date.now();
  }, [index, cards]);

  const advance = () => {
    setPicked(null);
    setChosen(null);
    setConfidence(null);
    setNotice(null);
    setReporting(false);
    setIndex((value) => value + 1);
    moving.current = false;
  };

  const retry = (wrong: QueueCard[]) => {
    setPicked(null);
    setResults([]);
    setPractice(true);
    setLast(null);
    setCards(wrong);
    setIndex(0);
  };

  const reveal = (choice: Choice, level: Confidence | null) => {
    setConfidence(level);
    setChosen(null);
    setPicked(choice);
    navigator.vibrate?.(choice.correct ? 10 : [30, 40, 30]);
  };

  /** 보기를 고른다. 확신도를 물을 때는 정답을 보여 주기 전에 확신도를 먼저 받는다 (연습은 묻지 않는다) */
  const pick = (choice: Choice) => {
    if (stale()) return;
    answeredAt.current = Date.now();
    if (asking && !practice) setChosen(choice);
    else reveal(choice, null);
  };

  const rate = (level: Confidence) => {
    if (chosen && !stale()) reveal(chosen, level);
  };

  /** 답 하나를 outbox에 넣고 다음 카드로 간다 */
  const record = async (current: QueueCard, grade: ReviewGrade, response: string, correct: boolean, level: Confidence | null = null) => {
    // 앱을 켜 둔 채 자리를 비운 시간까지 세지 않도록 자른다
    const elapsed = Math.min(Math.max(0, Math.round(answeredAt.current - shownAt.current)), MAX_ELAPSED_MS);
    if (!practice) {
      const id = crypto.randomUUID();
      await enqueueReview({
        id,
        card_id: current.id,
        grade,
        ...(response ? { response } : {}),
        ...(level ? { confidence: level } : {}),
        elapsed_ms: elapsed,
        reviewed_at: answeredAt.current,
      });
      await forgetAnswered([current.id]);
      setLast({ reviewId: id, card: current });
    }
    setResults((list) => [...list, { card: current, correct, confidentMiss: !correct && level === 'sure' }]);
    advance();
  };

  const next = async (easy = false) => {
    if (!card || !picked || moving.current || stale()) return;
    moving.current = true;
    const elapsed = answeredAt.current - shownAt.current;
    await record(card, gradeAnswer({ correct: picked.correct, elapsedMs: elapsed, easy, confidence: confidence ?? undefined }), picked.value, picked.correct, confidence);
  };

  const gradeExplain = async (grade: ReviewGrade, text: string) => {
    if (!card || moving.current || stale()) return;
    moving.current = true;
    answeredAt.current = Date.now();
    await record(card, grade, text.trim(), grade >= 2);
  };

  /** 방금 기록한 답을 지우고 그 카드를 다시 보여 준다. 아직 안 보냈으면 기기에서만 지운다 */
  const undo = async () => {
    if (!last || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      // 보내는 중이던 답은 전송이 끝난 뒤에 판단한다. 기기에 남아 있으면 서버는 모르는 답이라 기기에서만 지운다
      const removedLocally = await removeFromOutbox(last.reviewId);
      if (!removedLocally) await request(`/reviews/${last.reviewId}/undo`, { method: 'POST' });
      setCards((list) => [...list.slice(0, index), last.card, ...list.slice(index)]);
      setResults((list) => list.slice(0, -1));
      setLast(null);
      // 지금 카드에서 고르던 답과 확신도는 버린다. 남기면 되돌아온 카드에 그 답이 기록된다
      setChosen(null);
      setConfidence(null);
      setPicked(null);
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  // 컴퓨터에서는 키보드로 푼다: 1~9 고르기(OX는 O·X도), Enter·Space 다음, E 너무 쉬웠어요, Esc 그만하기
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!card || event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select')) return;
      const key = event.key.toLowerCase();
      if (key === 'escape') {
        leave();
      } else if (card.type === 'explain') {
        // 설명하기는 카드가 직접 키를 받는다
      } else if (chosen) {
        // 고른 뒤에는 1 확실 · 2 반반 · 3 찍음
        const level = ({ '1': 'sure', '2': 'unsure', '3': 'guess' } as Record<string, Confidence>)[key];
        if (level) {
          event.preventDefault();
          rate(level);
        }
      } else if (!picked) {
        const index = /^[1-9]$/.test(key) ? Number(key) - 1 : card.type === 'ox' ? ['o', 'x'].indexOf(key) : -1;
        const choice = choices[index];
        if (choice) {
          event.preventDefault();
          pick(choice);
        }
      } else if (key === 'enter' || key === ' ') {
        // 버튼에 포커스가 있으면 버튼이 알아서 눌린다
        if (target?.closest('button, a')) return;
        event.preventDefault();
        void next(false);
      } else if (key === 'e' && picked.correct && !practice) {
        event.preventDefault();
        void next(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!card) return <Summary results={results} practice={practice} onRetry={retry} onUndo={last ? () => void undo() : null} notice={notice} />;

  const report = async (reason: ReportReason) => {
    if (stale()) return;
    setBusy(true);
    try {
      await request(`/cards/${card.id}/report`, { method: 'POST', json: { reason } });
      await forgetAnswered([card.id]);
      advance();
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const reportArea = reporting ? (
    <div className="report-panel">
      <p className="small">무엇이 문제인가요? 신고하면 이 카드는 바로 꺼져요. 기록 탭에서 고치거나 다시 켤 수 있어요.</p>
      {REPORT_REASONS.map((item) => (
        <button key={item.reason} type="button" className="button" disabled={busy} onClick={() => void report(item.reason)}>
          {item.label}
        </button>
      ))}
      <button type="button" className="text-button" onClick={() => setReporting(false)}>
        취소
      </button>
    </div>
  ) : (
    <button type="button" className="text-button" onClick={() => setReporting(true)}>
      이 카드가 이상해요 · 신고하고 끄기
    </button>
  );

  return (
    <div className="review">
      <header className="review-top">
        <button type="button" className="icon-button" aria-label="그만하기" onClick={leave}>
          ✕
        </button>
        <div className="progress" role="progressbar" aria-label="진행" aria-valuemin={0} aria-valuemax={cards.length} aria-valuenow={done}>
          <div style={{ width: `${(done / cards.length) * 100}%` }} />
        </div>
        <span className="muted count">
          {index + 1}/{cards.length}
        </span>
      </header>
      {offline ? <p className="notice">오프라인이에요. 답은 저장해 두었다가 연결되면 보내요.</p> : null}
      {practice ? <p className="notice">다시 보기는 연습이라 기록하지 않아요. 틀린 카드는 곧 다시 나와요.</p> : null}
      {last && !picked && !chosen ? (
        <button type="button" className="text-button undo" disabled={busy} onClick={() => void undo()}>
          ↶ 방금 답 되돌리기
        </button>
      ) : null}
      {/* 다음 카드로 넘어갈 때 앞 카드가 왼쪽으로 빠지고 새 카드가 오른쪽에서 들어온다 */}
      <AnimatePresence mode="wait" initial={false}>
        <Presence
          key={stageKey}
          className="card-stage"
          initial={{ opacity: 0, x: 28 }}
          animate={{ opacity: 1, x: 0, transition: SOFT }}
          exit={{ opacity: 0, x: -28, transition: LEAVE }}
        >
          {card.type === 'explain' ? (
            <>
              <ExplainCard
                card={card}
                onGrade={(grade, text) => void gradeExplain(grade, text)}
                aiPanel={practice || offline ? undefined : (text, suggest) => <AiGrade cardId={card.id} text={text} onSuggest={suggest} />}
              />
              {notice ? <p className="notice bad">{notice}</p> : null}
              {reportArea}
            </>
          ) : (
            <>
              <QuestionCard card={card} choices={choices} picked={picked} chosen={chosen} onPick={pick} />
              <AnimatePresence mode="popLayout">
                {chosen ? (
                  <Presence
                    key="confidence"
                    className="confidence"
                    role="group"
                    aria-label="확신도"
                    initial={{ opacity: 0, y: 14 }}
                    animate={{ opacity: 1, y: 0, transition: SOFT }}
                    exit={{ opacity: 0, y: 8, transition: LEAVE }}
                  >
                    <div className="confidence-head">
                      <Mascot mood="think" size={32} />
                      <p className="small muted">정답을 보기 전에, 얼마나 확신해요?</p>
                    </div>
                    <div className="actions">
                      {(['sure', 'unsure', 'guess'] as const).map((level) => (
                        <button key={level} type="button" className={`button confidence-${level}`} onClick={() => rate(level)}>
                          {CONFIDENCE_LABEL[level]}
                        </button>
                      ))}
                    </div>
                  </Presence>
                ) : null}
              </AnimatePresence>
              {!picked && notice ? <p className="notice bad">{notice}</p> : null}
              {picked ? (
                <m.div className="answer-panel" aria-live="polite" initial={{ opacity: 0, y: 56 }} animate={{ opacity: 1, y: 0, transition: SOFT }}>
                  <div className="answer-head">
                    <Mascot mood={picked.correct ? 'cheer' : 'oops'} size={48} />
                    <div>
                      <p className={picked.correct ? 'verdict right' : 'verdict wrong'}>{picked.correct ? '맞았어요' : '틀렸어요'}</p>
                      {picked.correct && confidence === 'guess' ? <p className="small muted">찍어서 맞혔으니 조금 일찍 다시 볼게요.</p> : null}
                      {/* 확신했는데 틀린 답은 따로 짚는다. 바로잡은 기억이 오래 남는다 */}
                      {!picked.correct && confidence === 'sure' ? <p className="small muted">확신했던 문제예요. 왜 그렇게 생각했는지 떠올려 보고 해설과 비교해 봐요.</p> : null}
                    </div>
                  </div>
                  {card.explain ? <p className="explain">{card.explain}</p> : null}
                  {notice ? <p className="notice bad">{notice}</p> : null}
                  <div className="actions">
                    {picked.correct && !practice ? (
                      <button type="button" className="button" onClick={() => void next(true)}>
                        너무 쉬웠어요
                      </button>
                    ) : null}
                    <button type="button" className="button primary" onClick={() => void next(false)}>
                      다음
                    </button>
                  </div>
                  {reportArea}
                </m.div>
              ) : null}
              <p className="kbd-hint muted small">
                {chosen
                  ? '키보드: 1 확실 · 2 반반 · 3 찍음'
                  : `키보드: ${card.type === 'ox' ? 'O·X' : `1~${choices.length}`} 고르기 · Enter 다음${picked?.correct && !practice ? ' · E 너무 쉬웠어요' : ''} · Esc 그만하기`}
              </p>
            </>
          )}
        </Presence>
      </AnimatePresence>
    </div>
  );
}

function Summary({
  results,
  practice,
  onRetry,
  onUndo,
  notice,
}: {
  results: Result[];
  practice: boolean;
  onRetry: (cards: QueueCard[]) => void;
  onUndo: (() => void) | null;
  notice: string | null;
}) {
  const wrong = results.filter((result) => !result.correct).map((result) => result.card);
  const right = results.length - wrong.length;
  const misses = results.filter((result) => result.confidentMiss).map((result) => result.card.id);
  const [stats, setStats] = useState<StatsResponse | null>(null);
  useEffect(() => {
    if (practice) return;
    let cancelled = false;
    void (async () => {
      try {
        // 밀린 답을 먼저 보내야 오늘 목표와 연속이 맞게 나온다
        await flushReviews();
        const next = await request<StatsResponse>('/stats');
        if (!cancelled) setStats(next);
      } catch {
        // 오프라인이면 숫자 없이 보여 준다
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [practice]);
  const goalMet = stats !== null && stats.today.reviewed >= stats.goal;
  // 이번 복습으로 오늘 목표를 처음 채웠으면 연속 학습이 하루 늘었다
  const streakUp = goalMet && !practice && stats.today.reviewed - results.length < stats.goal;
  const xp = useCountUp(practice ? 0 : sessionXp(results));
  const toGoal = stats && !goalMet ? stats.goal - stats.today.reviewed : 0;
  const title = practice ? '다시 보기를 마쳤어요' : goalMet ? '오늘 목표 달성!' : wrong.length === 0 ? '다 맞혔어요!' : `${results.length}장을 끝냈어요`;
  return (
    <div className="summary">
      <div className="summary-head">
        {goalMet && !practice ? <Confetti /> : null}
        <Mascot mood={goalMet ? 'cheer' : wrong.length === 0 ? 'happy' : 'think'} size={goalMet ? 112 : 96} />
        <h1>{title}</h1>
        <p className="muted">
          {results.length}장 중 {right}장 맞혔어요{toGoal > 0 ? ` · 오늘 목표까지 ${toGoal}장` : ''}
        </p>
      </div>
      {practice ? null : (
        <div className="summary-stats">
          <div className="summary-stat">
            <strong className="xp">+{xp}</strong>
            <span>얻은 XP</span>
          </div>
          <div className="summary-stat">
            <strong>
              <IconFlame size={18} />
              {stats ? `${stats.streak}일` : '–'}
            </strong>
            <span>연속 학습</span>
            {streakUp ? (
              <span className="plus-one" aria-hidden="true">
                +1
              </span>
            ) : null}
          </div>
          <div className="summary-stat">
            <strong>{stats ? `${Math.min(stats.today.reviewed, stats.goal)}/${stats.goal}` : '–'}</strong>
            <span>오늘 목표</span>
          </div>
        </div>
      )}
      {wrong.length > 0 ? (
        <section aria-labelledby="miss-title">
          <h2 id="miss-title">다시 볼 카드 {wrong.length}장</h2>
          <ul className="list">
            {[...wrong].sort((a, b) => Number(misses.includes(b.id)) - Number(misses.includes(a.id))).map((card) => (
              <li key={card.id}>
                <span className="chip">{card.concept_name}</span> {misses.includes(card.id) ? <span className="miss-tag">확신했는데 틀림</span> : null}
                <p style={{ margin: '6px 0 0' }}>{card.prompt}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <p className="muted" style={{ textAlign: 'center', margin: 0 }}>
          {practice ? '다시 보기에서 다 맞혔어요.' : '다음 복습은 알림으로 알려 드릴게요.'}
        </p>
      )}
      {onUndo ? (
        <button type="button" className="text-button" onClick={onUndo}>
          ↶ 마지막 답 되돌리기
        </button>
      ) : null}
      {notice ? <p className="notice bad">{notice}</p> : null}
      <div className="summary-actions">
        {wrong.length > 0 ? (
          <button type="button" className="button" onClick={() => onRetry(wrong)}>
            틀린 {wrong.length}장 다시 보기
          </button>
        ) : null}
        <HomeButton primary />
      </div>
    </div>
  );
}

/** 이번 복습으로 얻은 XP. 서버 규칙(worker의 domain/stats.ts REVIEW_XP)과 같다: 설명하기 20, 정답 10, 오답 2 */
function sessionXp(results: Result[]): number {
  return results.reduce((sum, result) => sum + (result.card.type === 'explain' ? 20 : result.correct ? 10 : 2), 0);
}

/** 쌓인 기록 없이 오늘 화면으로 간다. 그다음 뒤로가기는 앱을 닫는다 */
function HomeButton({ primary = false }: { primary?: boolean }) {
  return (
    <button type="button" className={primary ? 'button primary' : 'button'} onClick={() => void goTab('/')}>
      오늘 화면으로
    </button>
  );
}
