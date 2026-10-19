import type { CategoryManage, CategoryRenameResult } from '@moai/shared';
import { useId, useState, type CSSProperties, type FormEvent } from 'react';
import { errorMessage, request } from '../api';
import { Loading } from '../Loading';
import { BackLink } from '../router';
import { useApi } from '../useApi';

// 분류 관리: 분류를 옮기거나 이름을 바꾼다. 이미 있는 분류 이름을 쓰면 합쳐진다.
// 채팅의 update_categories와 같은 규칙이다: 그 아래 분류와 자료 개념도 같이 옮기고, 옛 이름을 남기고, 3단계를 넘으면 잘라서 합친다.

interface Node {
  path: string;
  depth: number;
  /** 이 분류와 그 아래의 공부한 개념 수 */
  concepts: number;
  /** 이 분류와 그 아래의 자료 개념 수 */
  material: number;
}

/** 저장된 분류에서 큰 분류까지 모두 꺼내 트리로 늘어놓는다. 수는 그 아래까지 합친 것 */
function treeOf(categories: CategoryManage['categories']): Node[] {
  const nodes = new Map<string, Node>();
  for (const category of categories) {
    const segments = category.path.split('/');
    for (let depth = 1; depth <= segments.length; depth++) {
      const path = segments.slice(0, depth).join('/');
      const node = nodes.get(path) ?? { path, depth: depth - 1, concepts: 0, material: 0 };
      node.concepts += category.concepts;
      node.material += category.material;
      nodes.set(path, node);
    }
  }
  return [...nodes.values()].sort((a, b) => a.path.localeCompare(b.path, 'ko'));
}

export function Categories() {
  const { data, error, reload } = useApi<CategoryManage>('/categories/manage');
  const [editing, setEditing] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  if (error) {
    return (
      <div className="screen">
        <p className="notice bad">{error}</p>
      </div>
    );
  }
  if (!data) return <Loading />;
  const nodes = treeOf(data.categories);
  return (
    <div className="screen categories-screen">
      <BackLink href="/map" className="back">
        ← 지식 지도
      </BackLink>
      <h1>분류 관리</h1>
      <p className="muted small">분류를 옮기거나 이름을 바꿔요. 이미 있는 분류 이름을 쓰면 합쳐져요. 그 아래 분류와 아직 안 푼 자료 개념도 같이 옮겨지고, 옛 이름은 남아서 다음에 옛 이름으로 저장해도 새 분류로 가요.</p>
      {message ? <p className="notice good">{message}</p> : null}
      {nodes.length === 0 ? <p className="muted">아직 분류가 없어요.</p> : null}
      <ul className="category-tree">
        {nodes.map((node) => (
          <li key={node.path} style={{ '--depth': node.depth } as CSSProperties}>
            <div className="category-row">
              <span className="grow">
                <strong>{node.path.split('/').at(-1)}</strong>
                <span className="muted small">
                  공부함 {node.concepts} · 자료 {node.material}
                </span>
              </span>
              <button
                type="button"
                className="text-button"
                aria-expanded={editing === node.path}
                onClick={() => {
                  setMessage(null);
                  setEditing(editing === node.path ? null : node.path);
                }}
              >
                옮기기
              </button>
            </div>
            {editing === node.path ? (
              <MoveForm
                from={node.path}
                nodes={nodes}
                direct={new Map(data.categories.map((category) => [category.path, category.concepts + category.material]))}
                onCancel={() => setEditing(null)}
                onDone={(text) => {
                  setEditing(null);
                  setMessage(text);
                  reload();
                }}
              />
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** 새 경로를 받고, 먼저 미리 보기로 옮길 내용을 보여 준 뒤 바꾼다 */
function MoveForm({
  from,
  nodes,
  direct,
  onCancel,
  onDone,
}: {
  from: string;
  nodes: Node[];
  /** 분류마다 바로 그 분류에 있는 개념 수 */
  direct: Map<string, number>;
  onCancel: () => void;
  onDone: (message: string) => void;
}) {
  const [to, setTo] = useState(from);
  const [preview, setPreview] = useState<CategoryRenameResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  const send = async (dryRun: boolean) => request<CategoryRenameResult>('/categories/rename', { method: 'POST', json: { from, to: to.trim(), dry_run: dryRun } });

  const check = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !to.trim() || to.trim() === from) return;
    setBusy(true);
    setError(null);
    try {
      setPreview(await send(true));
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await send(false);
      onDone(`${result.renamed}개 개념을 옮겼어요.`);
    } catch (reason) {
      setError(errorMessage(reason));
      setBusy(false);
    }
  };

  const merging = nodes.some((node) => node.path === to.trim() && to.trim() !== from);
  return (
    <form className="move-form" onSubmit={(event) => void check(event)}>
      <label htmlFor={id} className="small">
        새 경로 (큰 분류부터 "/"로, 3단계까지)
      </label>
      <input
        id={id}
        value={to}
        maxLength={80}
        list={`${id}-paths`}
        autoFocus
        onChange={(event) => {
          setTo(event.target.value);
          setPreview(null);
        }}
      />
      <datalist id={`${id}-paths`}>
        {nodes.map((node) => (
          <option key={node.path} value={node.path} />
        ))}
      </datalist>
      {merging ? <p className="notice">이미 있는 분류예요. 두 분류가 합쳐져요.</p> : null}
      {preview ? (
        preview.moves.length === 0 ? (
          <p className="muted small">옮길 개념이 없어요.</p>
        ) : (
          <div className="move-preview">
            <p className="small">이렇게 옮겨요:</p>
            <ul>
              {preview.moves.map((move) => (
                <li key={move.from} className="small">
                  {move.from} → <strong>{move.to}</strong>
                  <span className="muted"> · {direct.get(move.from) ?? 0}개</span>
                </li>
              ))}
            </ul>
            {preview.merged.length > 0 ? (
              <p className="notice bad">
                3단계를 넘어서 단계가 합쳐지는 분류가 있어요: {preview.merged.map((move) => `${move.from} → ${move.to}`).join(', ')}. 원하지 않으면 더 짧은 경로로 바꿔 주세요.
              </p>
            ) : null}
          </div>
        )
      ) : null}
      {error ? <p className="notice bad">{error}</p> : null}
      <div className="actions">
        <button type="button" className="button" onClick={onCancel}>
          취소
        </button>
        {preview && preview.moves.length > 0 ? (
          <button type="button" className="button primary" disabled={busy} onClick={() => void apply()}>
            바꾸기
          </button>
        ) : (
          <button type="submit" className="button primary" disabled={busy || !to.trim() || to.trim() === from}>
            미리 보기
          </button>
        )}
      </div>
    </form>
  );
}
