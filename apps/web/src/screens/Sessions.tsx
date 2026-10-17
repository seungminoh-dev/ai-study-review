import type { SessionCard, SessionDetail as Detail, SessionSummary } from '@moai/shared';
import { useState } from 'react';
import { errorMessage, request } from '../api';
import { CodeBlock } from '../cards/CodeBlock';
import { Link } from '../router';
import { formatDate, formatDateTime, useApi } from '../useApi';

// 저장 기록 (설계서 §12.1): 세션별 개념·판정·카드, 카드 끄기

export function Sessions() {
  const { data, error } = useApi<{ sessions: SessionSummary[] }>('/sessions');
  if (error) return <div className="screen"><p className="notice bad">{error}</p></div>;
  if (!data) return <div className="center muted">불러오는 중…</div>;
  return (
    <div className="screen">
      <h1>저장 기록</h1>
      {data.sessions.length === 0 ? <p className="muted">아직 저장한 세션이 없어요. claude.ai에서 공부하고 "정리해줘"라고 해 보세요.</p> : null}
      <ul className="list">
        {data.sessions.map((session) => (
          <li key={session.id}>
            <Link href={`/sessions/${session.id}`} className="row-link">
              <span>{session.topic}</span>
              <span className="muted small">
                {formatDate(session.created_at)} · 개념 {session.concepts}개 · 카드 {session.cards}장
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

const STATUS: Record<SessionCard['status'], string> = { active: '복습 중', locked: '잠김', suspended: '꺼짐' };
const TYPE: Record<SessionCard['type'], string> = { ox: 'OX', mcq: '객관식', cloze: '빈칸', explain: '설명하기' };

function CardAnswer({ card }: { card: SessionCard }) {
  switch (card.type) {
    case 'ox':
    case 'cloze':
      return <p className="small">정답: {card.answer}</p>;
    case 'mcq':
      return (
        <ul className="options small">
          {card.options?.map((option) => (
            <li key={option.text} className={option.correct ? 'right' : ''}>
              {option.correct ? '✓ ' : ''}
              {option.text}
              {option.from_my_answer ? <span className="mine">내가 한 설명</span> : null}
            </li>
          ))}
        </ul>
      );
    case 'explain':
      return <p className="small">핵심 요소: {card.checklist?.join(', ')}</p>;
  }
}

function CardRow({ card }: { card: SessionCard }) {
  const [status, setStatus] = useState(card.status);
  const [error, setError] = useState<string | null>(null);
  const toggle = async () => {
    const suspend = status !== 'suspended';
    if (suspend && !confirm('이 카드를 끌까요? 복습에 다시 나오지 않아요.')) return;
    try {
      await request(`/cards/${card.id}/${suspend ? 'suspend' : 'unsuspend'}`, { method: 'POST' });
      setStatus(suspend ? 'suspended' : card.type === 'explain' ? 'locked' : 'active');
      setError(null);
    } catch (reason) {
      setError(errorMessage(reason));
    }
  };
  return (
    <li className={`card-row ${status}`}>
      <div className="card-row-head">
        <span className="chip">{card.concept_name}</span>
        <span className="muted small">
          {TYPE[card.type]} · {card.rung}단계 · {STATUS[status]}
        </span>
      </div>
      <p>{card.prompt}</p>
      {card.code ? <CodeBlock code={card.code} /> : null}
      <CardAnswer card={card} />
      {card.explain ? <p className="muted small">{card.explain}</p> : null}
      {error ? <p className="notice bad">{error}</p> : null}
      <button type="button" className="text-button" onClick={() => void toggle()}>
        {status === 'suspended' ? '다시 켜기' : '끄기'}
      </button>
    </li>
  );
}

export function SessionDetail({ id }: { id: string }) {
  const { data, error } = useApi<Detail>(`/sessions/${id}`);
  if (error) return <div className="screen"><p className="notice bad">{error}</p></div>;
  if (!data) return <div className="center muted">불러오는 중…</div>;
  return (
    <div className="screen">
      <Link href="/sessions" className="back">
        ← 저장 기록
      </Link>
      <h1>{data.topic}</h1>
      <p className="muted small">
        {formatDateTime(data.created_at)} · {data.source}
      </p>
      {data.final_answer ? (
        <section>
          <h2>내 최종 버전</h2>
          <blockquote>{data.final_answer}</blockquote>
        </section>
      ) : null}
      <section>
        <h2>개념</h2>
        <p className="chips">
          {data.concepts.map((concept) => (
            <span key={concept.key} className="chip">
              {concept.name}
            </span>
          ))}
        </p>
      </section>
      {data.judgments.length > 0 ? (
        <section>
          <h2>판정</h2>
          <ul className="list">
            {data.judgments.map((judgment) => (
              <li key={judgment.id}>
                <span className={`label label-${judgment.label}`}>{judgment.label}</span> <span className="chip">{judgment.concept_name}</span>
                {judgment.said ? <blockquote>{judgment.said}</blockquote> : null}
                <p className="muted small">{judgment.note}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <section>
        <h2>카드 {data.cards.length}장</h2>
        <ul className="list">
          {data.cards.map((card) => (
            <CardRow key={card.id} card={card} />
          ))}
        </ul>
      </section>
      {data.followups.length > 0 ? (
        <section>
          <h2>다음에 볼 질문</h2>
          <ul className="list">
            {data.followups.map((followup) => (
              <li key={followup.id}>
                <span className="chip">{followup.concept_name}</span> {followup.question}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
