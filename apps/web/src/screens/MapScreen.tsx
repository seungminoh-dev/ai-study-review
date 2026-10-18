import type { ConceptStateKey, MapResponse } from '@moai/shared';
import { useMemo, useState } from 'react';
import { STATE_LABEL } from '../concept-state';
import { Loading } from '../Loading';
import { labelWidth, layoutGraph } from '../map/layout';
import { Link, navigate } from '../router';
import { useApi } from '../useApi';

// 지식 지도 (설계서 §9.7): 초록 익숙함, 노랑 흔들림, 회색 점선 아직 안 배움. 점을 누르면 개념 상세로 간다.

const ORDER: ConceptStateKey[] = ['shaky', 'unlearned', 'familiar', 'material'];

const topOf = (category: string | null) => (category ? category.split('/')[0]! : null);

function shortName(name: string): string {
  return name.length > 9 ? `${name.slice(0, 8)}…` : name;
}

export function MapScreen() {
  const { data: raw, error } = useApi<MapResponse>('/map');
  /** 큰 분류 하나만 보기 (null이면 전체) */
  const [top, setTop] = useState<string | null>(null);
  /** 아직 안 푼 자료 개념도 보기. 기본은 내 지식만 */
  const [withMaterials, setWithMaterials] = useState(false);
  const tops = useMemo(() => [...new Set((raw?.nodes ?? []).filter((node) => node.state !== 'material').map((node) => topOf(node.category)).filter((value): value is string => value !== null))].sort(), [raw]);
  const data = useMemo(() => {
    if (!raw) return null;
    const nodes = raw.nodes.filter((node) => (withMaterials || node.state !== 'material') && (top === null || topOf(node.category) === top));
    const keys = new Set(nodes.map((node) => node.key));
    return { nodes, edges: raw.edges.filter((edge) => keys.has(edge.from) && keys.has(edge.to)) };
  }, [raw, top, withMaterials]);
  const layout = useMemo(() => {
    if (!data) return null;
    const names = new Map(data.nodes.map((node) => [node.key, shortName(node.name)]));
    return layoutGraph(
      data.nodes.map((node) => node.key),
      data.edges.map((edge) => [edge.from, edge.to] as const),
      (key) => labelWidth(names.get(key) ?? key),
      window.innerWidth / window.innerHeight,
    );
  }, [data]);
  const positions = layout?.positions ?? new Map<string, { x: number; y: number }>();
  const materialCount = raw?.nodes.filter((node) => node.state === 'material').length ?? 0;
  if (error) return <div className="screen"><p className="notice bad">{error}</p></div>;
  if (!data || !raw || !layout) return <Loading />;
  if (raw && raw.nodes.length === 0) {
    return (
      <div className="screen">
        <h1>지식 지도</h1>
        <p className="muted">아직 저장한 개념이 없어요. claude.ai에서 공부하고 "모아이에 저장해줘"라고 해 보세요.</p>
      </div>
    );
  }
  const counts = Object.fromEntries(ORDER.map((state) => [state, data.nodes.filter((node) => node.state === state).length])) as Record<ConceptStateKey, number>;
  return (
    <div className="screen">
      <h1>지식 지도</h1>
      {tops.length > 0 ? (
        <div className="segmented" role="group" aria-label="분류">
          <button type="button" className={top === null ? 'current' : ''} aria-pressed={top === null} onClick={() => setTop(null)}>
            전체
          </button>
          {tops.map((name) => (
            <button key={name} type="button" className={top === name ? 'current' : ''} aria-pressed={top === name} onClick={() => setTop(name)}>
              {name}
            </button>
          ))}
        </div>
      ) : null}
      <p className="legend small">
        <span className="dot familiar" /> 익숙함 {counts.familiar} · <span className="dot shaky" /> 흔들림 {counts.shaky} · <span className="dot unlearned" /> 아직 안 배움{' '}
        {counts.unlearned}
      </p>
      {materialCount > 0 ? (
        <label className="toggle small">
          <input type="checkbox" checked={withMaterials} onChange={(event) => setWithMaterials(event.target.checked)} /> 아직 안 푼 자료 개념도 보기 ({materialCount}) ·{' '}
          <Link href="/materials">자료 화면</Link>
        </label>
      ) : null}
      {data.nodes.length === 0 ? <p className="muted">이 분류에는 아직 내 지식이 없어요.</p> : null}
      <div className="map-scroll">
        <svg className="map" width={layout.width} height={layout.height} viewBox={`0 0 ${layout.width} ${layout.height}`} role="img" aria-label="개념 지도">
          {data.edges.map((edge) => {
            const a = positions.get(edge.from);
            const b = positions.get(edge.to);
            if (!a || !b) return null;
            return <line key={`${edge.from}-${edge.to}-${edge.type}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className={`edge ${edge.type}`} />;
          })}
          {data.nodes.map((node) => {
            const point = positions.get(node.key);
            if (!point) return null;
            return (
              <g
                key={node.key}
                className={`node ${node.state}`}
                transform={`translate(${point.x} ${point.y})`}
                role="link"
                tabIndex={0}
                aria-label={`${node.name}, ${STATE_LABEL[node.state]}`}
                onClick={() => navigate(`/concepts/${node.key}`)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') navigate(`/concepts/${node.key}`);
                }}
              >
                <rect className="hit" x={-24} y={-14} width={48} height={44} />
                <circle r={9} />
                <text y={22} textAnchor="middle">
                  {shortName(node.name)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      {ORDER.filter((state) => counts[state] > 0).map((state) => (
        <section key={state}>
          <h2>
            {STATE_LABEL[state]} {counts[state]}
          </h2>
          <p className="chips">
            {data.nodes
              .filter((node) => node.state === state)
              .map((node) => (
                <Link key={node.key} href={`/concepts/${node.key}`} className={`chip state-${state}`}>
                  {node.name}
                </Link>
              ))}
          </p>
        </section>
      ))}
    </div>
  );
}
