import type { MaterialDetail as Detail, MaterialPart } from '@moai/shared';
import { materialLabel } from '@moai/shared/client';
import { AnimatePresence } from 'motion/react';
import * as m from 'motion/react-m';
import { useEffect, useState } from 'react';
import { errorMessage, request } from '../api';
import { IconChevron, IconExternal } from '../icons';
import { Loading } from '../Loading';
import { Mascot } from '../Mascot';
import { materialReview, partView, rememberMaterial } from '../materials';
import { LEAVE, Presence, SNAPPY, SOFT } from '../motion';
import { Ring } from '../progress';
import { EditableTitle } from '../EditableTitle';
import { BackLink, Link, goBack } from '../router';
import { formatDate, useApi } from '../useApi';
import { BookTile, percentOf } from './Materials';
import { CARD_TYPE } from '../cards/QuestionCard';
import { ConceptChips } from './Learn';

// 자료 상세 (3단계 시안 "자료 상세 · 섹션"): 섹션마다 진행을 보고, 섹션 하나만 골라 푼다.
// 휴대폰은 섹션을 누르면 그 자리에서 펼치고, 컴퓨터(1024px 이상)는 왼쪽 섹션 목록 · 오른쪽 섹션 상세 두 칸이다.

type Kind = 'doing' | 'todo' | 'done';
type Filter = 'all' | Kind;

/** 안 풂: 한 장도 안 풀었다. 다 풂: 지금 풀 수 있는 새 카드가 없다. 그 사이는 푸는 중 */
const kindOf = (part: MaterialPart): Kind => (part.solved === 0 ? 'todo' : part.unsolved_open === 0 ? 'done' : 'doing');

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: '전체' },
  { key: 'doing', label: '푸는 중' },
  { key: 'todo', label: '안 풂' },
  { key: 'done', label: '다 풂' },
];


export function MaterialDetail({ title }: { title: string }) {
  const { data, error, reload } = useApi<Detail>(`/materials/detail?${new URLSearchParams({ title })}`);
  // 자료를 눌러 들어오면 그 자료를 기억한다. 학습 탭이 이 자료로 열린다
  useEffect(() => {
    rememberMaterial(title);
  }, [title]);
  const [filter, setFilter] = useState<Filter>('all');
  /** 휴대폰에서 펼친 섹션, 컴퓨터에서 고른 섹션 */
  const [open, setOpen] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; tone: 'good' | 'bad' } | null>(null);

  if (error) {
    return (
      <div className="screen">
        <BackLink href="/materials" className="back">
          ← 자료
        </BackLink>
        <p className="notice bad">{error}</p>
      </div>
    );
  }
  if (!data) return <Loading />;

  const parts = data.parts;
  const views = parts.map((part, index) => partView(part.name, index, data.part_labels[part.name]));
  const viewOf = (part: MaterialPart) => views[parts.indexOf(part)]!;
  const next = parts.find((part) => part.unsolved_open > 0) ?? null;
  const count = (kind: Filter) => (kind === 'all' ? parts.length : parts.filter((part) => kindOf(part) === kind).length);
  const shown = parts.map((part, index) => ({ part, index })).filter(({ part }) => filter === 'all' || kindOf(part) === filter);
  // 컴퓨터 오른쪽 칸: 고른 섹션, 없으면 이어서 풀 섹션, 그것도 없으면 첫 섹션
  const selected = parts.find((part) => part.name === open) ?? next ?? parts[0] ?? null;
  const started = parts.filter((part) => part.solved > 0).length;

  const suspend = async () => {
    if (!confirm(`"${data.name}"에서 아직 안 푼 카드를 모두 끌까요? 이미 푼 카드는 그대로예요. 섹션의 카드 보기에서 다시 켤 수 있어요.`)) return;
    try {
      const result = await request<{ suspended: number }>('/materials/suspend-unsolved', { method: 'POST', json: { title: data.title } });
      setMessage({ text: `${result.suspended}장을 껐어요.`, tone: 'good' });
      reload();
    } catch (reason) {
      setMessage({ text: errorMessage(reason), tone: 'bad' });
    }
  };

  const remove = async () => {
    if (!confirm(`"${data.name}" 자료를 통째로 지울까요? 모든 섹션의 카드와 그 복습 기록이 지워지고, 되돌릴 수 없어요. 다른 대화에도 나온 개념은 남아요.`)) return;
    try {
      await request('/materials/delete', { method: 'POST', json: { title: data.title } });
      goBack('/materials');
    } catch (reason) {
      setMessage({ text: errorMessage(reason), tone: 'bad' });
    }
  };

  return (
    <div className="screen material-detail">
      <BackLink href="/materials" className="back">
        ← 자료
      </BackLink>
      <header className="material-head">
        <BookTile title={data.title} sections={parts.length} done={next === null && data.solved > 0} />
        <div className="grow">
          <EditableTitle
            value={data.name}
            maxLength={80}
            allowEmpty
            hint="보여 줄 이름만 바뀌어요. Claude가 같은 PDF로 이어서 저장해도 이 자료로 모여요. 비우면 원래 이름으로 돌아가요."
            onSave={async (label) => (await request<{ name: string }>('/materials/label', { method: 'PUT', json: { title: data.title, label } })).name}
          />
          <p className="muted small">
            섹션 {parts.length}개 · {formatDate(data.created_at)}에 추가
          </p>
        </div>
      </header>

      <section className="material-stats" aria-label="진행">
        <Ring value={data.solved} max={data.cards} size={76} label={`카드 ${data.cards}장 중 ${data.solved}장 풂`}>
          <strong>{percentOf(data.solved, data.cards)}%</strong>
        </Ring>
        <dl>
          {(
            [
              ['푼 카드', data.solved, data.cards],
              ['내 지식', data.adopted, data.concepts],
              ['시작한 섹션', started, parts.length],
            ] as const
          ).map(([title, done, total]) => (
            <div key={title}>
              <dt>{title}</dt>
              <dd>
                {done}
                <small>/{total}</small>
              </dd>
            </div>
          ))}
        </dl>
      </section>

      {next ? (
        <Link className="button primary material-continue" href={materialReview(data.title, next.name)}>
          <span>이어서 풀기</span>
          <span className="material-continue-sub">
            {viewOf(next).no} {viewOf(next).name} · {next.unsolved_open}장 남음
          </span>
        </Link>
      ) : null}
      {message ? <p className={`notice ${message.tone}`}>{message.text}</p> : null}

      <div className="filter-chips" role="group" aria-label="섹션 거르기">
        {FILTERS.map(({ key, label }) => (
          <button key={key} type="button" className={filter === key ? 'filter-chip on' : 'filter-chip'} aria-pressed={filter === key} onClick={() => setFilter(key)}>
            {label} {count(key)}
          </button>
        ))}
      </div>

      <div className="material-layout">
        <ol className="section-list" aria-label="섹션">
          {/* 거르기를 바꾸면 빠진 섹션은 사라지고 남은 섹션이 제자리로 미끄러진다 */}
          <AnimatePresence mode="popLayout" initial={false}>
            {shown.map(({ part, index }) => {
              const kind = kindOf(part);
              const view = views[index]!;
              const expanded = open === part.name;
              return (
                <m.li
                  key={part.name}
                  layout="position"
                  transition={SNAPPY}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className={part === selected ? 'section-item selected' : 'section-item'}
                >
                  <button type="button" className="section-row" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : part.name)}>
                    <span className={`section-no ${kind}`}>{view.no}</span>
                    <span className="section-main">
                      <strong>{view.name}</strong>
                      <span className="muted small">
                        {view.pages ? `${view.pages} · ` : ''}카드 {part.cards}장
                      </span>
                      <span className="bar">
                        <span className={kind === 'done' ? 'good' : undefined} style={{ width: `${percentOf(part.solved, part.cards)}%` }} />
                      </span>
                    </span>
                    <span className={`section-status ${kind}`}>{kind === 'todo' ? '새 카드' : kind === 'done' ? '다 풂' : `${part.solved}/${part.cards}`}</span>
                    <span className={expanded ? 'section-chevron open narrow-only' : 'section-chevron narrow-only'}>
                      <IconChevron />
                    </span>
                  </button>
                  <AnimatePresence initial={false}>
                    {expanded ? (
                      <m.div
                        key="inline"
                        className="section-inline narrow-only"
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1, transition: SOFT }}
                        exit={{ height: 0, opacity: 0, transition: LEAVE }}
                      >
                        <SectionBody title={data.title} part={part} name={view.name} compact />
                      </m.div>
                    ) : null}
                  </AnimatePresence>
                </m.li>
              );
            })}
          </AnimatePresence>
        </ol>

        {selected ? (
          <aside className="section-pane wide-only" aria-label="섹션 상세">
            <AnimatePresence mode="wait" initial={false}>
              <Presence key={selected.name} initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0, transition: SOFT }} exit={{ opacity: 0, x: -16, transition: LEAVE }}>
                <span className="section-pane-no">SECTION {viewOf(selected).no}</span>
                <h2>{viewOf(selected).name}</h2>
                <p className="muted small">
                  {viewOf(selected).pages ? `${viewOf(selected).pages} · ` : ''}카드 {selected.cards}장 · {selected.solved}장 풂
                </p>
                <div className="bar thick">
                  <div className={kindOf(selected) === 'done' ? 'good' : undefined} style={{ width: `${percentOf(selected.solved, selected.cards)}%` }} />
                </div>
                <SectionBody title={data.title} part={selected} name={viewOf(selected).name} />
              </Presence>
            </AnimatePresence>
          </aside>
        ) : null}
      </div>

      {data.unsolved_open > 0 ? (
        <button type="button" className="text-button danger-text" onClick={() => void suspend()}>
          안 푼 카드 모두 끄기
        </button>
      ) : null}
      <button type="button" className="text-button danger-text" onClick={() => void remove()}>
        자료 지우기
      </button>
    </div>
  );
}

/** 섹션 하나: 개념, 풀기·카드 보기, (컴퓨터) 카드 미리보기, Claude에서 이어 공부하기 */
function SectionBody({ title, part, name, compact = false }: { title: string; part: MaterialPart; name: string; compact?: boolean }) {
  const ask = `${materialLabel(title)}의 "${name}" 부분을 공부하고 있어. 헷갈리는 개념을 물어볼게. 모아이에 저장된 내 기록도 참고해 줘.`;
  return (
    <div className="section-body">
      {part.concepts.length > 0 ? (
        <div className="section-block">
          {compact ? null : <strong className="small">이 섹션의 개념</strong>}
          <ConceptChips concepts={part.concepts} className="concept-chips" label="개념 (초록은 내 지식)" />
        </div>
      ) : null}
      <div className="section-actions">
        {part.unsolved_open > 0 ? (
          <Link className="button primary" href={materialReview(title, part.name)}>
            이 섹션 풀기 · {part.unsolved_open}장
          </Link>
        ) : (
          <span className="muted small grow">이 섹션은 다 풀었어요. 푼 카드는 평소 복습에 나와요.</span>
        )}
        {part.session_id ? (
          <Link className="button" href={`/sessions/${part.session_id}`}>
            카드 보기
          </Link>
        ) : null}
      </div>
      {compact || part.preview.length === 0 ? null : (
        <div className="section-block">
          <strong className="small">카드 미리보기</strong>
          <ul className="card-preview">
            {part.preview.map((card, index) => (
              <li key={index}>
                <span className={`type-tag ${card.type}`}>{CARD_TYPE[card.type]}</span>
                <span>{card.prompt}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <a className="claude-link" href={`https://claude.ai/new?${new URLSearchParams({ q: ask })}`} target="_blank" rel="noopener noreferrer">
        <Mascot mood="claude" size={40} />
        <span className="grow">
          <strong>Claude에서 이어 공부하기</strong>
          <span className="muted small">이 섹션에서 헷갈린 개념을 물어봐요</span>
        </span>
        <IconExternal />
      </a>
    </div>
  );
}
