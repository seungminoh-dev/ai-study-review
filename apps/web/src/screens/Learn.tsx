import type { MaterialDetail, MaterialPart, MaterialSummary } from '@moai/shared';
import { materialLabel } from '@moai/shared/client';
import { useState, type CSSProperties } from 'react';
import { IconCheck, IconChevron } from '../icons';
import { Loading } from '../Loading';
import { Mascot } from '../Mascot';
import { materialHref, materialReview, partView } from '../materials';
import { Link } from '../router';
import { useApi } from '../useApi';
import { BookTile } from './Materials';

// 학습 탭 (4단계 시안 "학습 탭 · 자료 길"): PDF 자료에서 아직 안 푼 카드를 섹션 순서대로 푼다.
// 한 번 푼 카드는 복습으로 넘어간다 (오늘 큐는 안 푼 자료 카드를 넣지 않는다, worker의 domain/queue.ts).

/** 섹션 노드를 좌우로 흔드는 거리(px). 길처럼 보이게 한다 */
const ZIG = [0, 34, 56, 34, 0, 34, 56, 34];

/** 다 풂: 지금 풀 수 있는 새 카드가 없다 */
const doneOf = (part: MaterialPart) => part.unsolved_open === 0 && part.solved > 0;

export function Learn({ title }: { title: string | null }) {
  const { data, error } = useApi<{ materials: MaterialSummary[] }>('/materials');
  if (error) {
    return (
      <div className="screen">
        <h1>학습</h1>
        <p className="notice bad">{error}</p>
      </div>
    );
  }
  if (!data) return <Loading />;
  if (data.materials.length === 0) {
    return (
      <div className="screen learn-screen">
        <h1>학습</h1>
        <div className="empty-state">
          <Mascot mood="claude" size={96} />
          <p>
            아직 자료가 없어요. claude.ai에 PDF를 올리고 "모아이 카드로 만들어줘"라고 하거나, Claude Code에서 <code>/moai:pdf</code>를 쓰면 여기에 생겨요.
          </p>
        </div>
      </div>
    );
  }
  // 고른 자료, 없으면 이어서 풀 자료, 그것도 없으면 첫 자료
  const material = data.materials.find((item) => item.title === title) ?? data.materials.find((item) => item.next) ?? data.materials[0]!;
  return <MaterialPath key={material.title} material={material} materials={data.materials} />;
}

function MaterialPath({ material, materials }: { material: MaterialSummary; materials: MaterialSummary[] }) {
  const { data } = useApi<MaterialDetail>(`/materials/detail?${new URLSearchParams({ title: material.title })}`);
  const [switching, setSwitching] = useState(false);
  const [picked, setPicked] = useState<number | null>(null);
  const parts = data?.parts ?? [];
  const current = parts.findIndex((part) => part.unsolved_open > 0);
  const selected = picked ?? Math.max(current, 0);
  const sections = Math.max(material.parts.length, 1);
  const finished = parts.filter(doneOf).length;

  return (
    <div className="screen learn-screen">
      <h1>학습</h1>
      <button type="button" className="material-switch" aria-expanded={switching} onClick={() => setSwitching(!switching)}>
        <BookTile title={material.title} sections={sections} done={material.cards > 0 && material.unsolved_open === 0} />
        <span className="grow">
          <strong>{materialLabel(material.title)}</strong>
          <span className="muted small">
            섹션 {finished}/{sections} 끝 · 새 카드 {material.unsolved_open}장 남음
          </span>
        </span>
        <span className={switching ? 'chev open' : 'chev'}>
          <IconChevron />
        </span>
      </button>
      {switching ? (
        <ul className="material-picks">
          {materials.map((item) => (
            <li key={item.title}>
              <Link href={`/learn?${new URLSearchParams({ title: item.title })}`} className={item.title === material.title ? 'on' : undefined} onClick={() => setSwitching(false)}>
                <strong>{materialLabel(item.title)}</strong>
                <span className="muted small">
                  카드 {item.solved}/{item.cards}장 풂
                </span>
              </Link>
            </li>
          ))}
          <li>
            <Link href={materialHref(material.title)} className="muted small">
              이 자료 관리 (카드 보기·끄기)
            </Link>
          </li>
        </ul>
      ) : null}

      {!data ? (
        <Loading />
      ) : (
        <>
          {parts[selected] ? <PartCard title={material.title} part={parts[selected]} index={selected} current={selected === current} /> : null}
          <ol className="path" aria-label="섹션 길">
            {parts.map((part, index) => {
              const view = partView(part.name, index);
              const done = doneOf(part);
              const isCurrent = index === current;
              const className = ['path-step', done ? 'done' : isCurrent ? 'current' : '', index === selected ? 'selected' : ''].filter(Boolean).join(' ');
              return (
                <li key={part.name || index} className={className} style={{ '--zig': `${ZIG[index % ZIG.length]}px` } as CSSProperties}>
                  <span className="path-lane">
                    {isCurrent ? <span className="path-now">지금</span> : null}
                    <button
                      type="button"
                      className="path-node"
                      aria-pressed={index === selected}
                      aria-label={`${view.no} ${view.name}, ${done ? '다 풂' : isCurrent ? '지금 할 섹션' : part.solved > 0 ? '푸는 중' : '안 풂'}`}
                      onClick={() => setPicked(index)}
                    >
                      {done ? <IconCheck size={24} /> : view.no}
                    </button>
                  </span>
                  <span className="path-text">
                    <span className="path-name">{view.name}</span>
                    <span className="muted small">{done ? `다 풂 · ${part.cards}장` : part.solved > 0 ? `${part.solved}/${part.cards}장 풂` : `새 카드 ${part.unsolved_open}장`}</span>
                  </span>
                </li>
              );
            })}
          </ol>
        </>
      )}

      <div className="claude-tip">
        <Mascot mood="claude" size={48} />
        <span>새 자료는 claude.ai에 PDF를 올리고 "모아이 카드로 만들어줘"라고 하면 여기에 생겨요. 한 번 푼 카드는 복습으로 넘어가요.</span>
      </div>
    </div>
  );
}

/** 고른 섹션: 개념과 풀기 버튼 */
function PartCard({ title, part, index, current }: { title: string; part: MaterialPart; index: number; current: boolean }) {
  const view = partView(part.name, index);
  const done = doneOf(part);
  const minutes = Math.max(1, Math.round(part.unsolved_open / 3));
  return (
    <section className={done ? 'part-card done' : current ? 'part-card current' : 'part-card'} aria-live="polite" aria-label="고른 섹션">
      <div className="part-card-head">
        <span className="part-no">{view.no}</span>
        <div className="grow">
          <strong>{view.name}</strong>
          <span className="muted small">
            {view.pages ? `${view.pages} · ` : ''}
            {done ? `${part.cards}장 다 풂` : `새 카드 ${part.unsolved_open}장${part.solved > 0 ? ` · 푼 카드 ${part.solved}장` : ''} · 약 ${minutes}분`}
          </span>
        </div>
      </div>
      {part.concepts.length > 0 ? (
        <ul className="part-concepts">
          {part.concepts.map((concept) => (
            <li key={concept.key} className={concept.adopted ? 'known' : undefined}>
              {concept.name}
            </li>
          ))}
        </ul>
      ) : null}
      {done ? (
        <p className="notice good">다 풀었어요. 이 섹션 카드는 이제 복습에서 때가 되면 나와요.</p>
      ) : (
        <Link className="button primary" href={materialReview(title, part.name)}>
          {part.solved > 0 ? '이어서 학습' : '이 섹션 학습하기'} · {part.unsolved_open}장
        </Link>
      )}
    </section>
  );
}
