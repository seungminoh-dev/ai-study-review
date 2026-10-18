import type { ConceptDetail } from '@moai/shared';
import { useState } from 'react';
import { errorMessage, request } from '../api';
import { copyText } from '../copy';
import { BackLink, Link } from '../router';
import { formatDate, useApi } from '../useApi';
import { STATE_LABEL } from './MapScreen';
import { CardRow } from './Sessions';

// 개념 상세 (설계서 §9.7): 상태, 내 최종 버전, 판정 이력, 카드, 연결된 개념, "Claude에서 이어서 공부하기"

const EDGE_LABEL: Record<string, { out: string; in: string }> = {
  prerequisite: { out: '먼저 알아야 함', in: '이걸 알면 배울 수 있음' },
  follow_up: { out: '꼬리질문', in: '이 질문의 앞 질문' },
  contrast: { out: '헷갈리기 쉬움', in: '헷갈리기 쉬움' },
  part_of: { out: '상위 개념', in: '하위 개념' },
};

export function Concept({ conceptKey }: { conceptKey: string }) {
  const { data, error } = useApi<ConceptDetail>(`/concepts/${encodeURIComponent(conceptKey)}`);
  const [copied, setCopied] = useState<boolean | null>(null);
  if (error) return <div className="screen"><p className="notice bad">{error}</p></div>;
  if (!data) return <div className="center muted">불러오는 중…</div>;
  return (
    <div className="screen">
      <BackLink href="/map" className="back">
        ← 지식 지도
      </BackLink>
      <h1>{data.name}</h1>
      <p className="small">
        <span className={`chip state-${data.state}`}>{STATE_LABEL[data.state]}</span>
        {data.aliases.length > 0 ? <span className="muted"> · 별칭 {data.aliases.join(', ')}</span> : null}
      </p>
      <CategoryEditor conceptKey={data.key} initial={data.category} />
      {data.state === 'material' ? <p className="notice">자료에서만 나온 개념이에요. 카드를 한 번 풀면 내 지식이 돼요.</p> : null}

      <section>
        <h2>Claude에서 이어서 공부하기</h2>
        <p className="muted small">아래 글을 claude.ai 채팅에 붙여 넣으면, Claude가 예전 기록부터 확인하고 틀렸던 지점을 먼저 물어봐요.</p>
        <code className="secret-url">{data.continue_prompt}</code>
        <div className="actions">
          <button type="button" className="button primary" onClick={() => void copyText(data.continue_prompt).then(setCopied)}>
            복사하기
          </button>
        </div>
        {copied === null ? null : <p className={`notice ${copied ? 'good' : 'bad'}`}>{copied ? '복사했어요.' : '복사하지 못했어요. 길게 눌러 복사해 주세요.'}</p>}
      </section>

      {data.final_answer ? (
        <section>
          <h2>내 최종 버전</h2>
          <blockquote>{data.final_answer}</blockquote>
        </section>
      ) : null}

      {data.neighbors.length > 0 ? (
        <section>
          <h2>연결된 개념</h2>
          <ul className="list">
            {data.neighbors.map((neighbor) => (
              <li key={`${neighbor.key}-${neighbor.type}-${neighbor.direction}`}>
                <Link href={`/concepts/${neighbor.key}`} className="row-link">
                  <span>
                    <span className={`chip state-${neighbor.state}`}>{neighbor.name}</span>
                  </span>
                  <span className="muted small">{EDGE_LABEL[neighbor.type]?.[neighbor.direction] ?? neighbor.type}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {data.followups.length > 0 ? (
        <section>
          <h2>다음에 볼 질문</h2>
          <ul className="list">
            {data.followups.map((followup) => (
              <li key={followup.id}>{followup.question}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {data.judgments.length > 0 ? (
        <section>
          <h2>판정 이력</h2>
          <ul className="list">
            {data.judgments.map((judgment) => (
              <li key={judgment.id}>
                <span className={`label label-${judgment.label}`}>{judgment.label}</span>{' '}
                <span className="muted small">
                  {formatDate(judgment.created_at)} · {judgment.topic}
                </span>
                {judgment.said ? <blockquote>{judgment.said}</blockquote> : null}
                <p className="muted small">{judgment.note}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {data.cards.length > 0 ? (
        <section>
          <h2>카드 {data.cards.length}장</h2>
          <ul className="list">
            {data.cards.map((card) => (
              <CardRow key={card.id} card={card} />
            ))}
          </ul>
        </section>
      ) : (
        <p className="muted">아직 이 개념의 카드가 없어요. 위 프롬프트로 공부하고 저장하면 카드가 생겨요.</p>
      )}
    </div>
  );
}

/** 분류 고치기. 저장할 때 Claude가 정한 분류를 손으로 바꾼다 */
function CategoryEditor({ conceptKey, initial }: { conceptKey: string; initial: string | null }) {
  const [category, setCategory] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initial ?? '');
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    try {
      const result = await request<{ category: string | null }>(`/concepts/${conceptKey}/category`, { method: 'PATCH', json: { category: draft.trim() || null } });
      setCategory(result.category);
      setEditing(false);
      setError(null);
    } catch (reason) {
      setError(errorMessage(reason));
    }
  };
  if (!editing) {
    return (
      <p className="small muted">
        분류: {category ?? '없음'}{' '}
        <button type="button" className="text-button" onClick={() => setEditing(true)}>
          고치기
        </button>
      </p>
    );
  }
  return (
    <div className="field">
      <span className="small">분류 (큰 분류부터 / 로 잇기, 예: 인프라/Kubernetes)</span>
      <input value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={80} />
      {error ? <p className="notice bad">{error}</p> : null}
      <div className="actions">
        <button type="button" className="button" onClick={() => setEditing(false)}>
          취소
        </button>
        <button type="button" className="button primary" onClick={() => void save()}>
          저장
        </button>
      </div>
    </div>
  );
}
