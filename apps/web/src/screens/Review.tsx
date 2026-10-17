import type { QueueCard, QueueResponse } from '@moai/shared';
import { gradeAnswer } from '@moai/shared/client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { OfflineError, errorMessage, request } from '../api';
import { QuestionCard, choicesOf, type Choice } from '../cards/QuestionCard';
import { cacheQueue, cachedQueue, enqueueReview, forgetAnswered } from '../offline/store';
import { Link, navigate } from '../router';

// 복습 세션 (설계서 §12.1, §12.2). 카드 한 장씩: 답 고르기 → 맞음·틀림과 해설 → 다음.

interface Result {
  card: QueueCard;
  correct: boolean;
}

type Load = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ready'; cards: QueueCard[]; offline: boolean };

export function Review({ size }: { size: number }) {
  const [load, setLoad] = useState<Load>({ state: 'loading' });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const queue = await request<QueueResponse>(`/queue?size=${size}`);
        await cacheQueue(queue.cards);
        if (!cancelled) setLoad({ state: 'ready', cards: queue.cards, offline: false });
      } catch (error) {
        if (error instanceof OfflineError) {
          const cards = (await cachedQueue()).slice(0, size);
          if (!cancelled) setLoad(cards.length > 0 ? { state: 'ready', cards, offline: true } : { state: 'error', message: '인터넷에 연결되지 않았고, 저장해 둔 카드도 없어요.' });
        } else if (!cancelled) setLoad({ state: 'error', message: errorMessage(error) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [size]);

  if (load.state === 'loading') return <div className="center muted">카드를 가져오는 중…</div>;
  if (load.state === 'error') {
    return (
      <div className="screen">
        <p className="notice bad">{load.message}</p>
        <Link className="button" href="/">
          오늘 화면으로
        </Link>
      </div>
    );
  }
  if (load.cards.length === 0) {
    return (
      <div className="screen done">
        <p className="big">오늘 복습할 카드가 없어요</p>
        <p className="muted">다 했거나, 아직 저장한 카드가 없어요.</p>
        <Link className="button primary" href="/">
          오늘 화면으로
        </Link>
      </div>
    );
  }
  return <Session initial={load.cards} offline={load.offline} />;
}

function Session({ initial, offline }: { initial: QueueCard[]; offline: boolean }) {
  const [cards, setCards] = useState(initial);
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<Choice | null>(null);
  const [results, setResults] = useState<Result[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const shownAt = useRef(Date.now());
  const answeredAt = useRef(0);

  const card = cards[index];
  const choices = useMemo(() => (card ? choicesOf(card) : []), [card]);

  useEffect(() => {
    shownAt.current = Date.now();
  }, [index, cards]);

  const advance = () => {
    setPicked(null);
    setNotice(null);
    setIndex((value) => value + 1);
  };

  const retry = (wrong: QueueCard[]) => {
    setPicked(null);
    setResults([]);
    setCards(wrong);
    setIndex(0);
  };

  if (!card) return <Summary results={results} onRetry={retry} />;

  const pick = (choice: Choice) => {
    answeredAt.current = Date.now();
    setPicked(choice);
    navigator.vibrate?.(choice.correct ? 10 : [30, 40, 30]);
  };

  const next = async (easy = false) => {
    if (!picked) return;
    const elapsed = answeredAt.current - shownAt.current;
    await enqueueReview({
      id: crypto.randomUUID(),
      card_id: card.id,
      grade: gradeAnswer({ correct: picked.correct, elapsedMs: elapsed, easy }),
      response: picked.value,
      elapsed_ms: Math.max(0, Math.round(elapsed)),
      reviewed_at: answeredAt.current,
    });
    await forgetAnswered([card.id]);
    setResults((list) => [...list, { card, correct: picked.correct }]);
    advance();
  };

  const suspend = async () => {
    if (!confirm('이 카드를 끌까요? 다시 나오지 않아요. 저장 기록 화면에서 다시 켤 수 있어요.')) return;
    setBusy(true);
    try {
      await request(`/cards/${card.id}/suspend`, { method: 'POST' });
      await forgetAnswered([card.id]);
      advance();
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="review">
      <header className="review-top">
        <button type="button" className="icon-button" aria-label="그만하기" onClick={() => navigate('/')}>
          ✕
        </button>
        <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={cards.length} aria-valuenow={index}>
          <div style={{ width: `${(index / cards.length) * 100}%` }} />
        </div>
        <span className="muted count">
          {index + 1}/{cards.length}
        </span>
      </header>
      {offline ? <p className="notice">오프라인이에요. 답은 저장해 두었다가 연결되면 보내요.</p> : null}
      <QuestionCard key={`${card.id}-${index}`} card={card} choices={choices} picked={picked} onPick={pick} />
      {picked ? (
        <div className="answer-panel" aria-live="polite">
          <p className={picked.correct ? 'verdict right' : 'verdict wrong'}>{picked.correct ? '맞았어요' : '틀렸어요'}</p>
          {!picked.correct && card.type !== 'ox' ? <p className="correct">정답: {choices.find((choice) => choice.correct)?.label}</p> : null}
          {card.explain ? <p className="explain">{card.explain}</p> : null}
          {notice ? <p className="notice bad">{notice}</p> : null}
          <div className="actions">
            {picked.correct ? (
              <button type="button" className="button" onClick={() => void next(true)}>
                너무 쉬웠어요
              </button>
            ) : null}
            <button type="button" className="button primary" onClick={() => void next(false)}>
              다음
            </button>
          </div>
          <button type="button" className="text-button" disabled={busy} onClick={() => void suspend()}>
            이 카드가 틀렸어요 · 끄기
          </button>
        </div>
      ) : null}
    </div>
  );
}

function Summary({ results, onRetry }: { results: Result[]; onRetry: (cards: QueueCard[]) => void }) {
  const wrong = results.filter((result) => !result.correct).map((result) => result.card);
  const right = results.length - wrong.length;
  return (
    <div className="screen done">
      <p className="big">
        {results.length}장 중 {right}장 맞혔어요
      </p>
      {wrong.length > 0 ? (
        <>
          <ul className="list">
            {wrong.map((card) => (
              <li key={card.id}>
                <span className="chip">{card.concept_name}</span> {card.prompt}
              </li>
            ))}
          </ul>
          <button type="button" className="button primary" onClick={() => onRetry(wrong)}>
            틀린 카드 다시 보기
          </button>
        </>
      ) : (
        <p className="muted">다 맞혔어요. 다음 복습은 알림으로 알려 드릴게요.</p>
      )}
      <Link className="button" href="/">
        오늘 화면으로
      </Link>
    </div>
  );
}
