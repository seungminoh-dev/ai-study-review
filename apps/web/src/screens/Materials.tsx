import type { MaterialSummary } from '@moai/shared';
import { useState } from 'react';
import { errorMessage, request } from '../api';
import { BackLink, Link } from '../router';
import { formatDate, useApi } from '../useApi';

// 자료 (설계서 §5.6): PDF 같은 자료에서 만든 카드. 풀기 전에는 내 지식이 아니다.
// 한 번 푼 카드는 평소 복습으로 들어가고, 그 개념은 지식 지도에 생긴다.

export function Materials() {
  const { data, error, reload } = useApi<{ materials: MaterialSummary[] }>('/materials');
  const [message, setMessage] = useState<{ text: string; tone: 'good' | 'bad' } | null>(null);
  if (error) return <div className="screen"><p className="notice bad">{error}</p></div>;
  if (!data) return <div className="center muted">불러오는 중…</div>;

  const suspend = async (material: MaterialSummary) => {
    if (!confirm(`"${material.title}"에서 아직 안 푼 카드를 모두 끌까요? 이미 푼 카드는 그대로예요. 기록 탭에서 다시 켤 수 있어요.`)) return;
    try {
      const result = await request<{ suspended: number }>('/materials/suspend-unsolved', { method: 'POST', json: { title: material.title } });
      setMessage({ text: `${result.suspended}장을 껐어요.`, tone: 'good' });
      reload();
    } catch (reason) {
      setMessage({ text: errorMessage(reason), tone: 'bad' });
    }
  };

  return (
    <div className="screen">
      <BackLink href="/sessions" className="back">
        ← 저장 기록
      </BackLink>
      <h1>자료</h1>
      <p className="muted small">
        PDF나 문서로 만든 카드예요. 아직은 내 지식이 아니에요. 풀어 본 카드는 평소 복습에 들어가고, 그 개념은 지식 지도에 생겨요.
      </p>
      <p className="muted small">claude.ai 채팅에 PDF를 올리고 "이 PDF로 모아이 카드 만들어줘"라고 하면 여기에 생겨요.</p>
      {message ? <p className={`notice ${message.tone}`}>{message.text}</p> : null}
      {data.materials.length === 0 ? <p className="muted">아직 자료가 없어요.</p> : null}
      <ul className="list">
        {data.materials.map((material) => {
          const progress = material.cards === 0 ? 0 : material.solved / material.cards;
          return (
            <li key={material.title}>
              <p>
                <strong>{material.title}</strong>
              </p>
              <p className="muted small">
                {formatDate(material.created_at)} · {material.parts.length > 0 ? `${material.parts.join(', ')} · ` : ''}카드 {material.cards}장 중 {material.solved}장 풂 · 개념{' '}
                {material.concepts}개 중 {material.adopted}개가 내 지식
              </p>
              <div className="goal" role="progressbar" aria-valuemin={0} aria-valuemax={material.cards} aria-valuenow={material.solved}>
                <div style={{ width: `${progress * 100}%` }} />
              </div>
              <div className="material-actions">
                {material.unsolved_open > 0 ? (
                  <Link className="button primary" href={`/review?material=${encodeURIComponent(material.title)}&size=10`}>
                    이 자료 풀기 ({material.unsolved_open}장 남음)
                  </Link>
                ) : (
                  <span className="muted small">지금 풀 카드가 없어요. 푼 카드는 평소 복습에 나와요.</span>
                )}
                {material.unsolved_open > 0 ? (
                  <button type="button" className="text-button" onClick={() => void suspend(material)}>
                    안 푼 카드 끄기
                  </button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
