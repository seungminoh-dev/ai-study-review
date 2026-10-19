import type { MaterialConcept, MaterialDetail, MaterialPart, MaterialSummary, QueueResponse } from '@moai/shared';
import { useEffect, useState } from 'react';
import { OfflineError, request } from '../api';
import { cacheMaterialQueue, cachedMaterialQueues } from '../offline/store';
import { EditableTitle } from '../EditableTitle';
import { IconArrow, IconBook, IconCheck, IconChevron } from '../icons';
import { Loading } from '../Loading';
import { Mascot } from '../Mascot';
import { currentMaterial, examHref, materialHref, materialReview, partView, rememberMaterial } from '../materials';
import { Link } from '../router';
import { useApi } from '../useApi';

// 학습 탭 (5단계 시안 "학습 탭 다시 짜기"): PDF 자료에서 아직 안 푼 카드를 섹션 순서대로 푼다.
// 제목은 자료 이름, 맨 위 큰 카드가 지금 할 섹션, 그 아래 섹션 타임라인. 섹션을 누르면 그 자리에서 펼쳐 개념·학습하기·시험·이름 바꾸기.
// 한 번 푼 카드는 복습으로 넘어간다 (오늘 큐는 안 푼 자료 카드를 넣지 않는다, worker의 domain/queue.ts).

/** 다 풂: 지금 풀 수 있는 새 카드가 없다 */
const doneOf = (part: MaterialPart) => part.unsolved_open === 0 && part.solved > 0;
/** 새 카드 몇 장을 푸는 데 드는 대강의 분 */
const minutesOf = (cards: number) => Math.max(1, Math.round(cards / 3));
const two = (n: number) => String(n).padStart(2, '0');

export function Learn({ title }: { title: string | null }) {
  const { data, error } = useApi<{ materials: MaterialSummary[] }>('/materials');
  // 고른 자료를 기억해 둔다. 아래 탭으로 다시 와도 이 자료가 열린다
  useEffect(() => {
    if (title) rememberMaterial(title);
  }, [title]);
  if (error) {
    return (
      <div className="screen learn-screen">
        <h1>학습</h1>
        <p className="notice bad">{error}</p>
        <OfflineSections />
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
            아직 자료가 없어요. 클로드에 PDF를 올리고 "모아이 카드로 만들어줘"라고 하거나, Claude Code에서 <code>/moai:pdf</code>를 쓰면 여기에 생겨요.
          </p>
        </div>
      </div>
    );
  }
  // 고른 자료, 없으면 마지막으로 고르거나 푼 자료, 그것도 없으면 이어서 풀 자료나 첫 자료
  const material = data.materials.find((item) => item.title === title) ?? currentMaterial(data.materials) ?? data.materials[0]!;
  return <MaterialPath key={material.title} material={material} materials={data.materials} />;
}

/** 오프라인: 기기에 받아 둔 자료 섹션을 이어서 학습한다 */
function OfflineSections() {
  const [sections, setSections] = useState<{ material: string; part: string | null; count: number }[] | null>(null);
  useEffect(() => {
    void cachedMaterialQueues().then(setSections);
  }, []);
  if (!sections || sections.length === 0) return null;
  return (
    <section className="card" aria-labelledby="offline-sections-title">
      <h2 id="offline-sections-title">기기에 받아 둔 섹션</h2>
      <ul className="list">
        {sections.map((section) => (
          <li key={`${section.material}|${section.part ?? ''}`}>
            <Link className="row-link" href={materialReview(section.material, section.part)}>
              <span>{section.part !== null ? partView(section.part, 0).name : '자료 전체'}</span>
              <span className="muted small">새 카드 {section.count}장</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function MaterialPath({ material, materials }: { material: MaterialSummary; materials: MaterialSummary[] }) {
  const { data, reload } = useApi<MaterialDetail>(`/materials/detail?${new URLSearchParams({ title: material.title })}`);
  const [switching, setSwitching] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const parts = data?.parts ?? [];
  const current = parts.findIndex((part) => part.unsolved_open > 0);
  const sections = Math.max(material.parts.length, 1);
  const finished = parts.filter(doneOf).length;
  const nextPart = current >= 0 ? parts[current]!.name : null;

  // 이어서 할 섹션을 기기에 받아 둔다. 연결이 끊겨도 그 섹션은 학습할 수 있다
  useEffect(() => {
    if (nextPart === null || !navigator.onLine) return;
    const params = new URLSearchParams({ material: material.title, part: nextPart, size: '10' });
    void request<QueueResponse>(`/queue?${params}`)
      .then((queue) => cacheMaterialQueue(material.title, nextPart, queue.cards))
      .catch((reason) => {
        if (!(reason instanceof OfflineError)) console.warn('섹션을 받아 두지 못했어요', reason);
      });
  }, [material.title, nextPart]);

  return (
    <div className="screen learn-screen learn-path">
      <header className="learn-head">
        <div className="learn-head-top">
          <span className="learn-eyebrow">
            <IconBook size={16} />
            학습 · 자료 {materials.length}개
          </span>
          {materials.length > 1 ? (
            <button type="button" className="learn-switch" aria-expanded={switching} onClick={() => setSwitching(!switching)}>
              자료 바꾸기
              <span className={switching ? 'chev open' : 'chev'}>
                <IconChevron size={14} />
              </span>
            </button>
          ) : null}
        </div>
        {switching ? (
          <ul className="material-picks">
            {materials.map((item) => (
              <li key={item.title}>
                <Link href={`/learn?${new URLSearchParams({ title: item.title })}`} className={item.title === material.title ? 'on' : undefined} onClick={() => setSwitching(false)}>
                  <strong>{item.name}</strong>
                  <span className="muted small">
                    카드 {item.solved}/{item.cards}장 풂
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
        <h1>{material.name}</h1>
        <div className="learn-progress">
          <span className="bar" aria-hidden="true">
            <span style={{ width: `${(finished / sections) * 100}%` }} />
          </span>
          <span className="small muted">
            <strong>{finished}</strong>/{sections} 섹션 끝
          </span>
        </div>
      </header>

      {!data ? (
        <Loading />
      ) : (
        <>
          <NowCard title={material.title} parts={parts} current={current} labels={data.part_labels} />
          <section className="learn-sections" aria-labelledby="learn-sections-title">
            <div className="learn-sections-head">
              <h2 id="learn-sections-title">섹션 {parts.length}개</h2>
              <span className="muted small">눌러서 펼쳐요</span>
            </div>
            <ol className="timeline">
              {parts.map((part, index) => (
                <SectionRow
                  key={part.name || index}
                  title={material.title}
                  part={part}
                  index={index}
                  current={index === current}
                  open={index === open}
                  label={data.part_labels[part.name]}
                  onToggle={() => setOpen(index === open ? null : index)}
                  onRenamed={reload}
                />
              ))}
            </ol>
          </section>
        </>
      )}

      <div className="learn-more">
        {material.solved > 0 ? (
          <Link className="button" href={examHref({ material: material.title })}>
            자료 전체 랜덤 시험
          </Link>
        ) : null}
        <Link className="button" href={materialHref(material.title)}>
          자료 관리
        </Link>
      </div>
      <div className="claude-tip">
        <Mascot mood="claude" size={44} />
        <span>새 자료는 클로드에 PDF를 올리고 "모아이 카드로 만들어줘"라고 하면 여기에 생겨요. 한 번 푼 카드는 복습으로 넘어가요.</span>
      </div>
    </div>
  );
}

function ConceptChips({ concepts, className }: { concepts: MaterialConcept[]; className: string }) {
  return (
    <ul className={className}>
      {concepts.map((concept) => (
        <li key={concept.key} className={concept.adopted ? 'known' : undefined}>
          {concept.name}
        </li>
      ))}
    </ul>
  );
}

/** 맨 위 큰 카드: 지금 할 섹션과 "이어서 학습". 새 카드를 다 풀었으면 그렇다고 */
function NowCard({ title, parts, current, labels }: { title: string; parts: MaterialPart[]; current: number; labels: Record<string, string> }) {
  const part = parts[current];
  if (!part) {
    return (
      <section className="hero learn-hero" aria-label="지금 할 섹션">
        <span className="hero-chip">다 풀었어요</span>
        <div>
          <strong className="learn-hero-title">이 자료의 새 카드를 다 풀었어요</strong>
          <p className="hero-sub">푼 카드는 복습에서 때가 되면 다시 나와요.</p>
        </div>
      </section>
    );
  }
  const view = partView(part.name, current, labels[part.name]);
  return (
    <section className="hero learn-hero" aria-label="지금 할 섹션">
      <div className="hero-top">
        <span className="hero-chip">지금 할 섹션</span>
        <span className="learn-hero-no">
          {two(current + 1)} / {two(parts.length)}
        </span>
      </div>
      <div>
        <strong className="learn-hero-title">{view.name}</strong>
        <p className="hero-sub">
          {view.pages ? `${view.pages} · ` : ''}새 카드 {part.unsolved_open}장 · 약 {minutesOf(part.unsolved_open)}분
        </p>
      </div>
      {part.concepts.length > 0 ? <ConceptChips concepts={part.concepts} className="hero-parts learn-hero-concepts" /> : null}
      <Link className="button accent" href={materialReview(title, part.name)}>
        {current > 0 || part.solved > 0 ? '이어서 학습' : '학습 시작'} · {part.unsolved_open}장
        <IconArrow />
      </Link>
    </section>
  );
}

/** 타임라인의 섹션 한 줄. 누르면 그 자리에서 펼친다 */
function SectionRow({
  title,
  part,
  index,
  current,
  open,
  label,
  onToggle,
  onRenamed,
}: {
  title: string;
  part: MaterialPart;
  index: number;
  current: boolean;
  open: boolean;
  label: string | undefined;
  onToggle: () => void;
  onRenamed: () => void;
}) {
  const view = partView(part.name, index, label);
  const done = doneOf(part);
  const state = done ? 'done' : current ? 'current' : part.solved > 0 ? 'started' : 'new';
  return (
    <li className={`timeline-item ${state}`}>
      <button type="button" className="timeline-row" aria-expanded={open} onClick={onToggle}>
        <span className="timeline-node" aria-hidden="true">
          {done ? <IconCheck size={18} /> : view.no}
        </span>
        <span className="grow">
          <strong>{view.name}</strong>
          <span className="muted small">
            {view.pages ? `${view.pages} · ` : ''}
            {done ? `${part.cards}장 다 풂` : part.solved > 0 ? `${part.solved}/${part.cards}장 풂` : `새 카드 ${part.unsolved_open}장`}
          </span>
        </span>
        <span className="timeline-pill">{done ? '다 풂' : current ? '지금' : part.solved > 0 ? `${part.solved}/${part.cards}` : `${part.unsolved_open}장`}</span>
      </button>
      {open ? (
        <div className="timeline-detail">
          {part.concepts.length > 0 ? <ConceptChips concepts={part.concepts} className="part-concepts" /> : null}
          <div className="timeline-actions">
            {part.unsolved_open > 0 ? (
              <Link className="button primary" href={materialReview(title, part.name)}>
                {part.solved > 0 ? '이어서 학습' : '이 섹션 학습하기'} · {part.unsolved_open}장
              </Link>
            ) : (
              <p className="muted small">{done ? '다 풀었어요. 이 섹션 카드는 이제 복습에서 때가 되면 나와요.' : '지금 풀 수 있는 새 카드가 없어요.'}</p>
            )}
            {part.solved > 0 ? (
              <Link className="button" href={examHref({ material: title, part: part.name })}>
                시험
              </Link>
            ) : null}
          </div>
          <EditableTitle
            bare
            as="strong"
            value={view.name}
            maxLength={80}
            allowEmpty
            hint="보여 줄 이름만 바뀌어요. 비우면 원래 이름으로 돌아가요."
            onSave={async (next) => {
              await request('/materials/part-label', { method: 'PUT', json: { title, part: part.name, label: next } });
              onRenamed();
              return partView(part.name, index, next).name;
            }}
          />
        </div>
      ) : null}
    </li>
  );
}
