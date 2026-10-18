import type { CardEditBody, SessionCard, SessionDetail as Detail, SessionSummary } from '@moai/shared';
import { useState, type FormEvent } from 'react';
import { errorMessage, request } from '../api';
import { CodeBlock } from '../cards/CodeBlock';
import { Loading } from '../Loading';
import { BackLink, Link } from '../router';
import { formatDate, formatDateTime, useApi } from '../useApi';

// 저장 기록 (설계서 §12.1): 세션별 개념·판정·카드, 카드 고치기·끄기

export function Sessions() {
  const { data, error } = useApi<{ sessions: SessionSummary[] }>('/sessions');
  if (error) return <div className="screen"><p className="notice bad">{error}</p></div>;
  if (!data) return <Loading />;
  return (
    <div className="screen">
      <h1>저장 기록</h1>
      <Link href="/materials" className="notice link">
        자료 (PDF로 만든 카드) →
      </Link>
      <Link href="/import" className="notice link">
        커넥터 없이 공부한 대화를 붙여 넣어 카드로 만들기 →
      </Link>
      {data.sessions.length === 0 ? <p className="muted">아직 저장한 세션이 없어요. claude.ai에서 공부하고 "정리해줘"라고 해 보세요.</p> : null}
      <ul className="list">
        {data.sessions.map((session) => (
          <li key={session.id}>
            <Link href={`/sessions/${session.id}`} className="row-link">
              <span>
                {session.material ? <span className="chip state-material">자료</span> : null} {session.topic}
              </span>
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

type Draft = CardEditBody;

function draftOf(card: SessionCard): Draft {
  switch (card.type) {
    case 'ox':
      return { type: 'ox', prompt: card.prompt, answer: card.answer === 'X' ? 'X' : 'O', explain: card.explain ?? '' };
    case 'mcq':
      return { type: 'mcq', prompt: card.prompt, options: (card.options ?? []).map((option) => ({ ...option })), explain: card.explain ?? '' };
    case 'cloze':
      return { type: 'cloze', prompt: card.prompt, answer: card.answer ?? '', choices: [...(card.choices ?? [])], explain: card.explain ?? '' };
    case 'explain':
      return { type: 'explain', prompt: card.prompt, checklist: [...(card.checklist ?? [])] };
  }
}

function applyDraft(card: SessionCard, draft: Draft): SessionCard {
  switch (draft.type) {
    case 'ox':
      return { ...card, prompt: draft.prompt, answer: draft.answer, explain: draft.explain };
    case 'mcq':
      return { ...card, prompt: draft.prompt, options: draft.options, explain: draft.explain };
    case 'cloze':
      return { ...card, prompt: draft.prompt, answer: draft.answer, choices: draft.choices, explain: draft.explain };
    case 'explain':
      return { ...card, prompt: draft.prompt, checklist: draft.checklist };
  }
}

/** 카드 고치기 (설계서 §2.3 7번). 종류는 그대로 두고 글자와 정답만 고친다 */
function EditForm({ card, onSaved, onCancel }: { card: SessionCard; onSaved: (card: SessionCard) => void; onCancel: () => void }) {
  const [draft, setDraft] = useState<Draft>(() => draftOf(card));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<Draft>) => setDraft((value) => ({ ...value, ...patch }) as Draft);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await request(`/cards/${card.id}`, { method: 'PATCH', json: draft });
      onSaved(applyDraft(card, draft));
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="edit-form" onSubmit={(event) => void save(event)}>
      <label className="field">
        <span>문제{draft.type === 'cloze' ? ' (빈칸은 ____)' : ''}</span>
        <textarea value={draft.prompt} onChange={(event) => set({ prompt: event.target.value })} rows={3} maxLength={500} required />
      </label>
      {draft.type === 'ox' ? (
        <div className="field">
          <span>정답</span>
          <div className="actions">
            {(['O', 'X'] as const).map((value) => (
              <label key={value} className="radio">
                <input type="radio" name={`ox-${card.id}`} checked={draft.answer === value} onChange={() => set({ answer: value })} /> {value}
              </label>
            ))}
          </div>
        </div>
      ) : null}
      {draft.type === 'mcq' ? (
        <div className="field">
          <span>보기 (정답 하나를 고르세요)</span>
          {draft.options.map((option, index) => (
            <div key={index} className="option-edit">
              <input
                type="radio"
                name={`mcq-${card.id}`}
                aria-label={`${index + 1}번을 정답으로`}
                checked={option.correct}
                onChange={() => set({ options: draft.options.map((item, i) => ({ ...item, correct: i === index })) })}
              />
              <input
                value={option.text}
                maxLength={300}
                required
                aria-label={`${index + 1}번 보기`}
                onChange={(event) => set({ options: draft.options.map((item, i) => (i === index ? { ...item, text: event.target.value } : item)) })}
              />
            </div>
          ))}
        </div>
      ) : null}
      {draft.type === 'cloze' ? (
        <>
          <label className="field">
            <span>정답</span>
            <input value={draft.answer} maxLength={40} required onChange={(event) => set({ answer: event.target.value })} />
          </label>
          <label className="field">
            <span>보기 (쉼표로 나눠요. 정답도 넣어요)</span>
            <input
              value={draft.choices.join(', ')}
              onChange={(event) => set({ choices: event.target.value.split(',').map((item) => item.trim()).filter(Boolean) })}
              required
            />
          </label>
        </>
      ) : null}
      {draft.type === 'explain' ? (
        <label className="field">
          <span>핵심 요소 (한 줄에 하나, 2~5개)</span>
          <textarea
            value={draft.checklist.join('\n')}
            rows={4}
            onChange={(event) => set({ checklist: event.target.value.split('\n').map((item) => item.trim()).filter(Boolean) })}
            required
          />
        </label>
      ) : (
        <label className="field">
          <span>해설</span>
          <textarea value={draft.explain} onChange={(event) => set({ explain: event.target.value })} rows={2} maxLength={400} required />
        </label>
      )}
      {error ? <p className="notice bad">{error}</p> : null}
      <div className="actions">
        <button type="button" className="button" onClick={onCancel}>
          취소
        </button>
        <button type="submit" className="button primary" disabled={busy}>
          저장
        </button>
      </div>
    </form>
  );
}

export function CardRow({ card: initial }: { card: SessionCard }) {
  const [card, setCard] = useState(initial);
  const [editing, setEditing] = useState(false);
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
      {editing ? (
        <EditForm
          card={card}
          onCancel={() => setEditing(false)}
          onSaved={(saved) => {
            setCard(saved);
            setEditing(false);
          }}
        />
      ) : (
        <>
          <p>{card.prompt}</p>
          {card.code ? <CodeBlock code={card.code} /> : null}
          <CardAnswer card={card} />
          {card.explain ? <p className="muted small">{card.explain}</p> : null}
          {error ? <p className="notice bad">{error}</p> : null}
          <div className="row-actions">
            <button type="button" className="text-button" onClick={() => setEditing(true)}>
              고치기
            </button>
            <button type="button" className="text-button" onClick={() => void toggle()}>
              {status === 'suspended' ? '다시 켜기' : '끄기'}
            </button>
          </div>
        </>
      )}
    </li>
  );
}

export function SessionDetail({ id }: { id: string }) {
  const { data, error } = useApi<Detail>(`/sessions/${id}`);
  if (error) return <div className="screen"><p className="notice bad">{error}</p></div>;
  if (!data) return <Loading />;
  return (
    <div className="screen">
      <BackLink href="/sessions" className="back">
        ← 저장 기록
      </BackLink>
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
