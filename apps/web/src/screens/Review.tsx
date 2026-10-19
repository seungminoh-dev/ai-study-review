import type { LevelUp, MaterialSummary, QueueCard, QueueResponse, ReportReason, ReviewGrade, StatsResponse } from '@moai/shared';
import type { Confidence } from '@moai/shared/client';
import { MAX_ELAPSED_MS, PERFECT_MIN_ANSWERS, PERFECT_XP, gradeAnswer } from '@moai/shared/client';
import { AnimatePresence } from 'motion/react';
import * as m from 'motion/react-m';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { OfflineError, errorMessage, request } from '../api';
import { NewAchievements, NewBadges } from '../badges';
import { AiGrade } from '../cards/AiGrade';
import { AskChat, AskSheet, useAsk, type AskMode } from '../cards/AskConcept';
import { ConceptPanel, forgetConcepts } from '../cards/ConceptPanel';
import { ExplainCard } from '../cards/ExplainCard';
import { QuestionCard, choicesOf, type Choice } from '../cards/QuestionCard';
import { Confetti } from '../Confetti';
import { IconArrow, IconChat, IconFlame, IconStar } from '../icons';
import { Loading } from '../Loading';
import { Mascot } from '../Mascot';
import { LEAVE, Presence, SOFT, useCountUp } from '../motion';
import {
  cacheMaterialQueue,
  cacheQueue,
  cachedMaterialQueue,
  cachedQueue,
  enqueueReview,
  flushReviews,
  forgetAnswered,
  pendingCardIds,
  pendingCount,
  removeFromOutbox,
  takeLevelUps,
} from '../offline/store';
import { buzz } from '../prefs';
import { play, type Sound } from '../sound';
import { StreakGoal } from '../progress';
import { materialReview, partView } from '../materials';
import { Link, goTab, leave } from '../router';

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

/** 이 너비부터 복습 화면 오른쪽에 개념 패널을 둔다 (styles.css의 .review-body와 같다) */
const WIDE = '(min-width: 1024px)';

function useWide(): boolean {
  const [wide, setWide] = useState(() => matchMedia(WIDE).matches);
  useEffect(() => {
    const query = matchMedia(WIDE);
    const update = () => setWide(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return wide;
}

/** 끝 화면의 LEVEL UP: 새로 열린 단계에서 나오는 카드 */
const RUNG_NEXT: Record<number, string> = { 2: '이제 빈칸·코드 문제가 나와요', 3: '이제 직접 설명하는 카드가 나와요' };

/** 복습을 시작할 때 서버가 센 오늘 XP와 장수 */
interface TodayBefore {
  xp: number;
  reviewed: number;
}

type Load = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ready'; cards: QueueCard[]; offline: boolean; before?: TodayBefore | null };

export function Review({
  size,
  category,
  material,
  part,
  mistakes = false,
  exam = false,
}: {
  size: number;
  category?: string | null;
  material?: string | null;
  part?: string | null;
  /** 복습 탭의 "틀린 것만 풀기" */
  mistakes?: boolean;
  /** 랜덤 시험: 푼 카드에서 뽑고, 연습이라 기록하지 않는다 */
  exam?: boolean;
}) {
  const [load, setLoad] = useState<Load>({ state: 'loading' });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // 밀린 답을 먼저 보낸다. 못 보낸 답의 카드는 서버가 아직 모르니 큐에서 뺀다
        await flushReviews();
        // 지난 복습의 개념 정보는 버린다. LEVEL UP은 아직 못 본 것이면 이번 끝 화면에서 함께 보여 준다
        forgetConcepts();
        const pending = await pendingCardIds();
        const params = new URLSearchParams({ size: String(Math.min(size + pending.size, MAX_QUEUE)) });
        if (mistakes) params.set('mode', 'mistakes');
        if (exam) params.set('mode', 'random');
        if (category) params.set('category', category);
        if (material) params.set('material', material);
        // 자료의 섹션 하나만 풀 때
        if (material && part !== null && part !== undefined) params.set('part', part);
        // 끝 화면의 얻은 XP와 연속 +1은 시작할 때와 끝날 때의 서버 숫자를 비교해서 낸다
        const [queue, before] = await Promise.all([
          request<QueueResponse>(`/queue?${params}`),
          request<StatsResponse>('/stats').catch(() => null),
        ]);
        const cards = queue.cards.filter((card) => !pending.has(card.id)).slice(0, size);
        // 오프라인용으로는 오늘 큐 전체만 남긴다. 분류·자료로 거른 큐를 남기면 다음 오프라인 복습이 그 카드만 낸다
        if (!category && !material && !mistakes && !exam) await cacheQueue(cards);
        // 자료 섹션은 따로 남겨 둔다. 지하철에서 연결이 끊겨도 이어서 학습한다
        if (material && !exam) await cacheMaterialQueue(material, part ?? null, queue.cards.filter((card) => !pending.has(card.id)));
        if (!cancelled) setLoad({ state: 'ready', cards, offline: false, before: before && { xp: before.today.xp, reviewed: before.today.reviewed } });
      } catch (error) {
        if (error instanceof OfflineError && material && !exam) {
          const cards = (await cachedMaterialQueue(material, part ?? null)).slice(0, size);
          if (!cancelled) setLoad(cards.length > 0 ? { state: 'ready', cards, offline: true } : { state: 'error', message: '인터넷에 연결되지 않았고, 이 섹션은 기기에 받아 두지 않았어요. 연결된 곳에서 한 번 열면 다음부터 오프라인으로도 풀 수 있어요.' });
        } else if (error instanceof OfflineError && (category || material || mistakes || exam)) {
          if (!cancelled) setLoad({ state: 'error', message: '인터넷에 연결되지 않았어요. 분류별 복습, 틀린 것, 랜덤 시험은 연결된 뒤에 할 수 있어요.' });
        } else if (error instanceof OfflineError) {
          const cards = (await cachedQueue()).slice(0, size);
          if (!cancelled) setLoad(cards.length > 0 ? { state: 'ready', cards, offline: true } : { state: 'error', message: '인터넷에 연결되지 않았고, 저장해 둔 카드도 없어요.' });
        } else if (!cancelled) setLoad({ state: 'error', message: errorMessage(error) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [size, category, material, part, mistakes, exam]);

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
        <p className="big">{exam ? '시험 낼 카드가 없어요' : mistakes ? '다시 풀 틀린 카드가 없어요' : '오늘 복습할 카드가 없어요'}</p>
        <p className="muted">
          {exam ? '시험은 한 번이라도 푼 카드에서 내요.' : mistakes ? '최근 30일 안에 틀린 카드는 오늘 다 풀었어요.' : '다 했거나, 아직 저장한 카드가 없어요.'}
        </p>
        <HomeButton primary />
      </div>
    );
  }
  return <Session initial={load.cards} offline={load.offline} before={load.before ?? null} exam={exam} />;
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

function Session({ initial, offline, before, exam }: { initial: QueueCard[]; offline: boolean; before: TodayBefore | null; exam: boolean }) {
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
  const [practice, setPractice] = useState(exam);
  const [notice, setNotice] = useState<string | null>(null);
  /** 방금 기록한 답. 잘못 눌렀으면 다음 카드에서 되돌릴 수 있다 */
  const [last, setLast] = useState<Recorded | null>(null);
  const [reporting, setReporting] = useState(false);
  /** 설명하기 카드에서 내 최종 버전을 펼친 카드 자리 (개념 패널을 연다) */
  const [explainShown, setExplainShown] = useState<string | null>(null);
  /** 설명하기 카드에서 내가 쓴 설명 (개념 물어보기에 같이 보낸다) */
  const [explainText, setExplainText] = useState('');
  /** 휴대폰에서 연 개념 물어보기 시트 */
  const [askOpen, setAskOpen] = useState(false);
  /** 컴퓨터 개념 패널에서 보고 있는 탭 */
  const [panelTab, setPanelTab] = useState<'concept' | 'ask'>('concept');
  const askButton = useRef<HTMLButtonElement>(null);
  /** 되돌리기 토스트를 보여 줄 답 */
  const [toast, setToast] = useState<string | null>(null);
  const wide = useWide();
  /** 두 번 탭해도 한 번만 기록한다 */
  const moving = useRef(false);
  const shownAt = useRef(Date.now());
  const answeredAt = useRef(0);
  /** 이번 복습의 답 묶음. 서버가 무실수 보너스를 센다 */
  const runId = useRef(crypto.randomUUID());

  const card = cards[index];
  /** 지금 보이는 카드 자리. 사라지는 중인 카드의 버튼은 예전 렌더의 함수라 이 값과 달라서 무시한다 */
  const stageKey = card ? `${card.id}-${index}` : 'end';
  const liveKey = useRef(stageKey);
  useLayoutEffect(() => {
    liveKey.current = stageKey;
  });
  const stale = () => liveKey.current !== stageKey;
  /** 맞혔어도 찍었거나 반반이었다. "너무 쉬웠어요"는 등급을 바꾸지 못해 숨기고, 대신 물어보기를 연다 */
  const unsure = picked?.correct === true && (confidence === 'guess' || confidence === 'unsure');
  /** 개념을 AI에게 물을 수 있는 때: 답을 고른 뒤(틀림·반반·찍음·맞음 모두), 설명하기를 비교한 뒤. 오프라인이거나 서버 AI가 없으면 숨긴다 */
  const askMode: AskMode | null =
    card?.type === 'explain' ? (explainShown === stageKey ? 'explain' : null) : picked === null ? null : !picked.correct ? 'wrong' : unsure ? 'unsure' : 'right';
  const askPicked = card?.type === 'explain' ? explainText : (picked?.value ?? '');
  const ask = useAsk(stageKey, card?.id, askPicked || null);
  const canAsk = askMode !== null && !offline && ask.available;
  const canEasy = picked?.correct === true && !practice && !unsure;
  const openAsk = () => (wide ? setPanelTab('ask') : setAskOpen(true));
  const closeAsk = () => {
    setAskOpen(false);
    askButton.current?.focus();
  };
  const choices = useMemo(() => (card ? choicesOf(card) : []), [card]);
  /** 답을 본 카드 수. 지금 카드도 답을 봤으면 센다 */
  const done = index + (picked ? 1 : 0);

  useEffect(() => {
    shownAt.current = Date.now();
  }, [index, cards]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(timer);
  }, [toast]);

  const advance = () => {
    setPicked(null);
    setChosen(null);
    setConfidence(null);
    setNotice(null);
    setReporting(false);
    setAskOpen(false);
    setPanelTab('concept');
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
    buzz(choice.correct ? 10 : [30, 40, 30]);
    play(choice.correct ? 'right' : 'wrong');
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
        run_id: runId.current,
      });
      await forgetAnswered([current.id]);
      setLast({ reviewId: id, card: current });
      setToast(id);
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
    play(grade >= 2 ? 'right' : 'wrong');
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
      setAskOpen(false);
      setPanelTab('concept');
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
      // 물어보기 시트가 열려 있으면 Esc는 시트만 닫고, 다른 키는 시트 안의 글쓰기에 맡긴다
      if (askOpen) {
        if (event.key === 'Escape') closeAsk();
        return;
      }
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select')) return;
      const key = event.key.toLowerCase();
      if (key === 'escape') {
        leave();
      } else if (card.type === 'explain') {
        // 설명하기는 카드가 직접 키를 받는다. 비교한 뒤의 A(물어보기)만 여기서 본다
        if (key === 'a' && canAsk) {
          event.preventDefault();
          openAsk();
        }
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
      } else if (key === 'e' && canEasy) {
        event.preventDefault();
        void next(true);
      } else if (key === 'a' && canAsk) {
        event.preventDefault();
        openAsk();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!card) return <Summary results={results} practice={practice} exam={exam} before={before} onRetry={retry} onUndo={last ? () => void undo() : null} notice={notice} />;

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
      <div className="review-body">
        <div className="review-main">
          {offline ? <p className="notice">오프라인이에요. 답은 저장해 두었다가 연결되면 보내요.</p> : null}
          {practice ? <p className="notice">{exam ? '랜덤 시험이에요. 기록하지 않아서 복습 일정은 그대로예요.' : '다시 보기는 연습이라 기록하지 않아요. 틀린 카드는 곧 다시 나와요.'}</p> : null}
          {/* 방금 기록한 답은 다음 카드에서 고르기 전까지, 길어야 6초 동안 되돌릴 수 있다. 그 뒤에는 끝 화면에서 되돌린다 */}
          <AnimatePresence>
            {last && toast === last.reviewId && !picked && !chosen ? (
              <m.div
                key={last.reviewId}
                className="toast"
                role="status"
                initial={{ opacity: 0, y: -12 }}
                animate={{ opacity: 1, y: 0, transition: SOFT }}
                exit={{ opacity: 0, y: -8, transition: LEAVE }}
              >
                <span>답을 기록했어요</span>
                <button type="button" disabled={busy} onClick={() => void undo()}>
                  되돌리기
                </button>
              </m.div>
            ) : null}
          </AnimatePresence>
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
                    onReveal={(text) => {
                      setExplainShown(stageKey);
                      setExplainText(text);
                    }}
                    aiPanel={(text, suggest) => (
                      <>
                        {practice || offline ? null : <AiGrade cardId={card.id} text={text} onSuggest={suggest} />}
                        {canAsk && !wide ? (
                          <button ref={askButton} type="button" className="button soft ask-explain" onClick={() => setAskOpen(true)}>
                            <IconChat />이 개념 물어보기
                          </button>
                        ) : null}
                      </>
                    )}
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
                          <p className={picked.correct ? 'verdict right' : 'verdict wrong'}>
                            {picked.correct ? '맞았어요' : '틀렸어요'}
                            {picked.correct && !practice ? (
                              <span className="xp-float" aria-hidden="true">
                                +10 XP
                              </span>
                            ) : null}
                          </p>
                          {picked.correct && confidence === 'guess' ? <p className="small muted">찍어서 맞혔으니 조금 일찍 다시 볼게요.</p> : null}
                          {/* 확신했는데 틀린 답은 따로 짚는다. 바로잡은 기억이 오래 남는다 */}
                          {!picked.correct && confidence === 'sure' ? <p className="small muted">확신했던 문제예요. 왜 그렇게 생각했는지 떠올려 보고 해설과 비교해 봐요.</p> : null}
                        </div>
                      </div>
                      {card.explain ? <p className="explain">{card.explain}</p> : null}
                      {/* 확실히 맞힌 답은 버튼 줄을 늘리지 않고 해설 아래 작은 링크로 연다 */}
                      {canAsk && !wide && askMode === 'right' ? (
                        <button ref={askButton} type="button" className="text-button ask-more" onClick={() => setAskOpen(true)}>
                          <IconChat />더 궁금하면 AI에게 물어보기
                        </button>
                      ) : null}
                      {notice ? <p className="notice bad">{notice}</p> : null}
                      <div className="actions">
                        {canEasy ? (
                          <button type="button" className="button" onClick={() => void next(true)}>
                            너무 쉬웠어요
                          </button>
                        ) : null}
                        {canAsk && !wide && askMode !== 'right' ? (
                          <button ref={askButton} type="button" className="button soft" onClick={() => setAskOpen(true)}>
                            <IconChat />
                            이 개념 물어보기
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
                      : `키보드: ${card.type === 'ox' ? 'O·X' : `1~${choices.length}`} 고르기 · Enter 다음${canEasy ? ' · E 너무 쉬웠어요' : ''}${canAsk ? ' · A 물어보기' : ''} · Esc 그만하기`}
                  </p>
                </>
              )}
            </Presence>
          </AnimatePresence>
        </div>
        {/* 컴퓨터에서는 오른쪽에 이 카드의 개념을 둔다. 정답이 될 수 있는 내용은 답을 본 뒤에 연다 */}
        {wide ? (
          <ConceptPanel
            card={card}
            next={cards[index + 1]}
            revealed={picked !== null || explainShown === stageKey}
            ask={
              canAsk && askMode
                ? { tab: panelTab, onTab: setPanelTab, fresh: askMode !== 'right' && ask.turns.length === 0, pending: ask.pending, chat: <AskChat card={card} mode={askMode} picked={askPicked} ask={ask} /> }
                : undefined
            }
          />
        ) : null}
      </div>
      <AskSheet open={askOpen && canAsk && !wide} pending={ask.pending} onClose={closeAsk}>
        {askMode ? <AskChat card={card} mode={askMode} picked={askPicked} ask={ask} /> : null}
      </AskSheet>
    </div>
  );
}

function Summary({
  results,
  practice,
  exam,
  before,
  onRetry,
  onUndo,
  notice,
}: {
  results: Result[];
  practice: boolean;
  /** 랜덤 시험이었다 (점수를 보여 준다) */
  exam: boolean;
  /** 시작할 때 서버가 센 오늘 숫자. 없으면(오프라인으로 시작) 화면에서 어림한다 */
  before: TodayBefore | null;
  onRetry: (cards: QueueCard[]) => void;
  onUndo: (() => void) | null;
  notice: string | null;
}) {
  const wrong = results.filter((result) => !result.correct).map((result) => result.card);
  const right = results.length - wrong.length;
  /** 무실수 보너스: 서버(domain/stats.ts)와 같은 규칙. 연습은 기록하지 않아서 받지 않는다 */
  const perfect = !practice && wrong.length === 0 && results.length >= PERFECT_MIN_ANSWERS;
  const misses = results.filter((result) => result.confidentMiss).map((result) => result.card.id);
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [levelUps, setLevelUps] = useState<LevelUp[]>([]);
  /** 이어서 학습할 자료 섹션 (끝 화면에서 학습을 권한다) */
  const [learnNext, setLearnNext] = useState<MaterialSummary | null>(null);
  /** 이번 복습의 답이 모두 서버에 들어갔다. 그래야 서버 숫자의 차이가 이번 복습의 몫이다 */
  const [allSent, setAllSent] = useState(false);
  useEffect(() => {
    if (practice) return;
    let cancelled = false;
    void (async () => {
      try {
        // 밀린 답을 먼저 보내야 오늘 목표와 연속, LEVEL UP이 맞게 나온다
        await flushReviews();
        if (cancelled) return;
        setLevelUps(await takeLevelUps());
        setAllSent((await pendingCount()) === 0);
        const [next, materials] = await Promise.all([request<StatsResponse>('/stats'), request<{ materials: MaterialSummary[] }>('/materials').catch(() => null)]);
        if (cancelled) return;
        setStats(next);
        setLearnNext(materials?.materials.find((material) => material.next !== null) ?? null);
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
  const streakUp = goalMet && !practice && (before ? before.reviewed : stats.today.reviewed - results.length) < stats.goal;
  // 얻은 XP는 서버가 센 오늘 XP의 차이다. 시작 숫자가 없거나, 못 보낸 답이 있거나, 그사이 하루가 바뀌었으면 화면에서 어림한다
  const gained = stats && before && allSent ? stats.today.xp - before.xp : -1;
  const xp = useCountUp(practice ? 0 : gained >= 0 ? gained : sessionXp(results) + (perfect ? PERFECT_XP : 0));
  const toGoal = stats && !goalMet ? stats.goal - stats.today.reviewed : 0;
  const celebrate = !practice && (streakUp || levelUps.length > 0);
  useEffect(() => {
    if (celebrate) buzz([20, 60, 20, 60, 40]);
  }, [celebrate]);
  // 끝 화면 소리는 하나만: 무실수 > 레벨 업 > 오늘 목표 달성
  const fanfare: Sound | null = practice ? null : perfect ? 'perfect' : levelUps.length > 0 ? 'levelup' : streakUp ? 'finish' : null;
  useEffect(() => {
    if (fanfare) play(fanfare);
  }, [fanfare]);
  /** 설명하기를 스스로 통과로 매긴 개념 */
  const passed = practice ? [] : [...new Set(results.filter((result) => result.card.type === 'explain' && result.correct).map((result) => result.card.concept_name))];
  const title = exam ? `시험 끝! ${right}/${results.length}` : practice ? '다시 보기를 마쳤어요' : goalMet ? '오늘 목표 달성!' : wrong.length === 0 ? '다 맞혔어요!' : `${results.length}장을 끝냈어요`;
  return (
    <div className="summary">
      <div className="summary-head">
        {goalMet && !practice ? <Confetti /> : null}
        <Mascot mood={goalMet ? 'cheer' : levelUps.length > 0 ? 'levelup' : wrong.length === 0 ? 'happy' : 'think'} size={goalMet ? 112 : 96} />
        <h1>{title}</h1>
        <p className="muted">
          {exam
            ? `${results.length}문제 중 ${right}개 맞혔어요 · ${Math.round((right / Math.max(results.length, 1)) * 100)}점`
            : `${results.length}장 중 ${right}장 맞혔어요${toGoal > 0 ? ` · 오늘 목표까지 ${toGoal}장` : ''}`}
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
      {perfect ? (
        <section className="perfect" aria-label="무실수 보너스">
          <span className="perfect-mark" aria-hidden="true">
            <IconStar size={26} />
          </span>
          <span className="grow">
            <span className="perfect-kicker">
              PERFECT {right}/{results.length}
            </span>
            <strong>한 번도 안 틀렸어요</strong>
          </span>
          <strong className="perfect-xp">+{PERFECT_XP} XP</strong>
        </section>
      ) : null}
      {stats && !practice ? <StreakGoal streak={stats.streak} /> : null}
      {stats && !practice ? <NewBadges badges={stats.badges} /> : null}
      {stats && !practice ? <NewAchievements achievements={stats.achievements.earned} /> : null}
      {levelUps.length > 0 || passed.length > 0 ? (
        <section className="levelup" aria-labelledby="levelup-title">
          <div className="levelup-head">
            <Mascot mood="levelup" size={56} />
            <div>
              <p className="levelup-kicker">LEVEL UP</p>
              <h2 id="levelup-title">{levelUps.length > 0 ? `${levelUps.length}개 개념이 한 단계 올라갔어요` : '내 말로 설명해 냈어요'}</h2>
            </div>
          </div>
          <ul className="levelup-list">
            {levelUps.map((up, i) => (
              <li key={up.concept_key} style={{ '--i': i } as CSSProperties}>
                <span className="levelup-step">
                  {up.rung - 1}→{up.rung}단계
                </span>
                <span className="grow">
                  <strong>{up.concept_name}</strong>
                  <span className="muted small">{RUNG_NEXT[up.rung] ?? '다음 단계 카드가 나와요'}</span>
                </span>
              </li>
            ))}
            {passed.map((name, i) => (
              <li key={`explain-${name}`} style={{ '--i': levelUps.length + i } as CSSProperties}>
                <span className="levelup-step pass">설명 통과</span>
                <span className="grow">
                  <strong>{name}</strong>
                  <span className="muted small">설명하기 카드를 통과했어요</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
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
          {exam ? '다 맞혔어요! 시험은 기록하지 않아서 복습 일정은 그대로예요.' : practice ? '다시 보기에서 다 맞혔어요.' : '다음 복습은 알림으로 알려 드릴게요.'}
        </p>
      )}
      {onUndo ? (
        <button type="button" className="text-button" onClick={onUndo}>
          ↶ 마지막 답 되돌리기
        </button>
      ) : null}
      {notice ? <p className="notice bad">{notice}</p> : null}
      {learnNext?.next ? (
        <Link className="learn-suggest" href={materialReview(learnNext.title, learnNext.next.part)}>
          <span className="grow">
            <span className="learn-suggest-kicker">학습도 이어서 할까요?</span>
            <strong>{learnNext.next.part ? partView(learnNext.next.part, Math.max(learnNext.parts.indexOf(learnNext.next.part), 0), learnNext.part_labels[learnNext.next.part]).name : '안 푼 카드'}</strong>
            <span className="muted small">새 카드 {learnNext.next.unsolved_open}장</span>
          </span>
          <IconArrow />
        </Link>
      ) : null}
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

/** 서버 숫자가 없을 때 어림하는 이번 복습 XP. 서버 규칙(worker의 domain/stats.ts REVIEW_XP)과 같다: 설명하기 20, 정답 10, 오답 2 */
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
