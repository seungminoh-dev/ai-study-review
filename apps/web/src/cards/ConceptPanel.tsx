import type { ConceptDetail, QueueCard } from '@moai/shared';
import { AnimatePresence } from 'motion/react';
import * as m from 'motion/react-m';
import { useEffect, useState } from 'react';
import { request } from '../api';
import { STATE_LABEL } from '../concept-state';
import { copyText } from '../copy';
import { IconExternal } from '../icons';
import { Mascot } from '../Mascot';
import { LEAVE, SOFT } from '../motion';
import { formatDate } from '../useApi';

// 컴퓨터 복습 화면 오른쪽의 개념 패널 (3단계 3-4, 2단계 시안의 컴퓨터 복습).
// 답을 고르기 전에는 개념 이름과 단계만 보인다. 내가 정리한 답과 지난 설명은 정답이 될 수 있어서 답을 본 뒤에 연다.

const RUNG_LABEL: Record<number, string> = { 1: '1단계 · 떠올리기', 2: '2단계 · 빈칸·코드', 3: '3단계 · 설명하기' };

/** 한 번 받은 개념은 이번 복습이 끝날 때까지 다시 받지 않는다 */
const cache = new Map<string, Promise<ConceptDetail>>();

/** 복습을 새로 시작할 때 지난 복습에서 받은 개념을 버린다. 그사이 상태가 바뀌었을 수 있다 */
export function forgetConcepts(): void {
  cache.clear();
}

function loadConcept(key: string): Promise<ConceptDetail> {
  let pending = cache.get(key);
  if (!pending) {
    pending = request<ConceptDetail>(`/concepts/${encodeURIComponent(key)}`);
    // 실패하면 다음 카드에서 다시 받는다
    pending.catch(() => cache.delete(key));
    cache.set(key, pending);
  }
  return pending;
}

type Loaded = { key: string; data: ConceptDetail | null; failed: boolean };

export function ConceptPanel({ card, next, revealed }: { card: QueueCard; next: QueueCard | undefined; revealed: boolean }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  useEffect(() => {
    let cancelled = false;
    const key = card.concept_key;
    loadConcept(key)
      .then((data) => !cancelled && setLoaded({ key, data, failed: false }))
      .catch(() => !cancelled && setLoaded({ key, data: null, failed: true }));
    // 다음 카드의 개념도 미리 받아 둔다
    if (next) void loadConcept(next.concept_key).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [card.concept_key, next?.concept_key]);
  const current = loaded?.key === card.concept_key ? loaded : null;
  const data = current?.data ?? null;

  return (
    <aside className="concept-panel" aria-label="이 개념">
      <section className="panel-card">
        <div className="panel-top">
          <p className="panel-label">이 개념</p>
          {data ? <span className={`chip state-${data.state}`}>{STATE_LABEL[data.state]}</span> : null}
        </div>
        <h2>{card.concept_name}</h2>
        <p className="muted small">{[data?.category, RUNG_LABEL[card.rung]].filter(Boolean).join(' · ')}</p>
        <AnimatePresence mode="wait" initial={false}>
          {revealed ? (
            <m.div key={`open-${card.id}`} className="panel-open" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0, transition: SOFT }} exit={{ opacity: 0, transition: LEAVE }}>
              {data ? (
                <Notes data={data} />
              ) : current?.failed ? (
                <p className="small muted">연결이 끊겨 개념 정보를 불러오지 못했어요.</p>
              ) : (
                <>
                  <span className="skeleton" />
                  <span className="skeleton short" />
                </>
              )}
            </m.div>
          ) : (
            <m.div key={`locked-${card.id}`} className="panel-locked" initial={{ opacity: 0 }} animate={{ opacity: 1, transition: SOFT }} exit={{ opacity: 0, transition: LEAVE }}>
              <Mascot mood="think" size={40} />
              <p className="small">{card.type === 'explain' ? '내 말로 설명하고 비교하면' : '답을 고르면'} 내가 정리한 답과 지난번 설명이 열려요.</p>
            </m.div>
          )}
        </AnimatePresence>
      </section>
      {revealed && data ? <More key={card.id} data={data} /> : null}
    </aside>
  );
}

/** 내가 정리한 답과 가장 최근 판정 */
function Notes({ data }: { data: ConceptDetail }) {
  const last = [...data.judgments].sort((a, b) => b.created_at - a.created_at)[0];
  if (!data.final_answer && !last) return <p className="small muted">아직 정리한 답이나 판정이 없어요. 공부한 대화에서 이 개념을 다루면 여기에 쌓여요.</p>;
  return (
    <>
      {data.final_answer ? (
        <div className="panel-block">
          <p className="panel-sub">내가 정리한 답</p>
          <p className="panel-quote">{data.final_answer}</p>
        </div>
      ) : null}
      {last ? (
        <div className="panel-block">
          <p className="panel-sub">
            지난번 내 설명 · <span className={`label label-${last.label}`}>{last.label}</span> · {formatDate(last.created_at)}
          </p>
          {last.said ? <p className="panel-quote">{last.said}</p> : null}
          <p className="small muted">{last.note}</p>
        </div>
      ) : null}
    </>
  );
}

/** 헷갈리기 쉬운 개념, 다음에 볼 질문, Claude로 이어 공부하기 */
function More({ data }: { data: ConceptDetail }) {
  const [copied, setCopied] = useState<boolean | null>(null);
  // 같은 개념이 방향만 달리 두 번 나올 수 있다
  const unique = [...new Map(data.neighbors.map((neighbor) => [neighbor.key, neighbor])).values()];
  const contrast = unique.filter((neighbor) => neighbor.type === 'contrast');
  const linked = unique.filter((neighbor) => neighbor.type !== 'contrast');
  return (
    <m.div className="panel-more" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0, transition: { ...SOFT, delay: 0.06 } }}>
      {unique.length > 0 ? (
        <section className="panel-card">
          {contrast.length > 0 ? (
            <>
              <h3>헷갈리기 쉬운 개념</h3>
              <div className="panel-chips">
                {contrast.map((neighbor) => (
                  <span key={neighbor.key} className={`chip state-${neighbor.state}`}>
                    {neighbor.name}
                  </span>
                ))}
              </div>
            </>
          ) : null}
          {linked.length > 0 ? (
            <>
              <h3>이어지는 개념</h3>
              <div className="panel-chips">
                {linked.slice(0, 6).map((neighbor) => (
                  <span key={neighbor.key} className={`chip state-${neighbor.state}`}>
                    {neighbor.name}
                  </span>
                ))}
              </div>
            </>
          ) : null}
        </section>
      ) : null}
      {data.followups.length > 0 ? (
        <section className="panel-card">
          <h3>다음에 볼 질문</h3>
          <ul className="panel-questions">
            {data.followups.slice(0, 3).map((followup) => (
              <li key={followup.id}>{followup.question}</li>
            ))}
          </ul>
        </section>
      ) : null}
      <section className="panel-card">
        <a className="claude-link" href={`https://claude.ai/new?${new URLSearchParams({ q: data.continue_prompt })}`} target="_blank" rel="noopener noreferrer">
          <Mascot mood="claude" size={40} />
          <span className="grow">
            <strong>Claude에서 이어 공부하기</strong>
            <span className="muted small">이 개념을 다시 묻는 새 채팅을 열어요</span>
          </span>
          <IconExternal />
        </a>
        <button type="button" className="text-button" onClick={() => void copyText(data.continue_prompt).then(setCopied)}>
          {copied === null ? '질문만 복사하기' : copied ? '복사했어요' : '복사하지 못했어요'}
        </button>
      </section>
    </m.div>
  );
}
