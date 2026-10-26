import type { MaterialSummary } from '@moai/shared';
import { isPdf } from '@moai/shared/client';
import { Loading } from '../Loading';
import { Mascot } from '../Mascot';
import { materialHref, materialReview, partView } from '../materials';
import { Link } from '../router';
import { useApi } from '../useApi';

/** 푼 비율 (0~100) */
export const percentOf = (solved: number, cards: number) => (cards === 0 ? 0 : Math.round((solved / cards) * 100));

// 자료 목록 (설계서 §5.6, 3단계 시안): PDF 하나가 카드 하나다. 섹션별 진행은 자료 상세(MaterialDetail)에서 본다.
// 자료 카드는 풀기 전까지 내 지식이 아니고, 한 번 푼 카드는 평소 복습에 들어간다.

/** 책 모양 표지: PDF면 PDF, 아니면 자료라고 쓰고 섹션 수를 적는다 */
export function BookTile({ title, sections, done = false }: { title: string; sections: number; done?: boolean }) {
  return (
    <span className={done ? 'book-tile done' : 'book-tile'} aria-hidden="true">
      <span>{isPdf(title) ? 'PDF' : '자료'}</span>
      <strong>{sections}</strong>
    </span>
  );
}

function MaterialCard({ material }: { material: MaterialSummary }) {
  const sections = Math.max(material.parts.length, 1);
  const done = material.cards > 0 && material.unsolved_open === 0;
  const percent = percentOf(material.solved, material.cards);
  const next = material.next ? partView(material.next.part, Math.max(material.parts.indexOf(material.next.part), 0), material.part_labels[material.next.part]) : null;
  return (
    <article className="material-item">
      <div className="material-item-head">
        <BookTile title={material.title} sections={sections} done={done} />
        <div className="grow">
          <Link className="material-item-title" href={materialHref(material.title)}>
            {material.name}
          </Link>
          <span className="muted small">
            섹션 {sections}개 · 카드 {material.cards}장
          </span>
        </div>
        {done ? <span className="done-chip">다 풂</span> : null}
      </div>
      <div className="material-item-progress">
        <div className="material-item-numbers small">
          <strong>{material.solved}장 풂</strong>
          <span className="muted">
            개념 {material.concepts}개 중 {material.adopted}개가 내 지식
          </span>
        </div>
        <div className="bar thick" role="progressbar" aria-label="푼 카드" aria-valuemin={0} aria-valuemax={material.cards} aria-valuenow={material.solved}>
          <div className={done ? 'grow-in good' : 'grow-in'} style={{ width: `${Math.max(percent, material.solved > 0 ? 3 : 0)}%` }} />
        </div>
      </div>
      {material.next && next ? (
        <>
          <p className="material-next">
            <span className="material-next-label">다음</span>
            <span className="material-next-name">{material.next.part ? `${next.no} ${next.name}` : '안 푼 카드'}</span>
            <span className="muted">{material.next.unsolved_open}장</span>
          </p>
          <div className="material-item-actions">
            <Link className="button primary" href={materialReview(material.title, material.next.part)}>
              이어서 풀기
            </Link>
            <Link className="button" href={materialHref(material.title)}>
              섹션 보기
            </Link>
          </div>
        </>
      ) : (
        <div className="material-item-actions">
          <span className="muted small grow">푼 카드는 평소 복습에 나와요.</span>
          <Link className="button" href={materialHref(material.title)}>
            섹션 보기
          </Link>
        </div>
      )}
    </article>
  );
}

export function Materials() {
  const { data, error } = useApi<{ materials: MaterialSummary[] }>('/materials');
  if (error) return <div className="screen"><p className="notice bad">{error}</p></div>;
  if (!data) return <Loading />;
  return (
    <div className="screen materials">
      <h1>자료</h1>
      <p className="muted small">PDF로 만든 카드예요. 풀어 본 카드부터 내 지식이 되고, 그 개념이 지식 지도에 생겨요.</p>
      <div className="material-list">
        {data.materials.map((material) => (
          <MaterialCard key={material.title} material={material} />
        ))}
      </div>
      <div className="material-tip">
        <Mascot mood="study" size={56} />
        <p className="small">클로드에 PDF를 올리고 "이 PDF로 모아이 카드 만들어줘"라고 하면 여기에 생겨요.</p>
      </div>
    </div>
  );
}
