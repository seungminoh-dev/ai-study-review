import type { ConceptStateKey, MapResponse } from '@moai/shared';
import { useMemo } from 'react';
import { layoutGraph } from '../map/layout';
import { Link, navigate } from '../router';
import { useApi } from '../useApi';

// 지식 지도 (설계서 §9.7): 초록 익숙함, 노랑 흔들림, 회색 점선 아직 안 배움. 점을 누르면 개념 상세로 간다.

export const STATE_LABEL: Record<ConceptStateKey, string> = { familiar: '익숙함', shaky: '흔들림', unlearned: '아직 안 배움' };
const ORDER: ConceptStateKey[] = ['shaky', 'unlearned', 'familiar'];

function shortName(name: string): string {
  return name.length > 9 ? `${name.slice(0, 8)}…` : name;
}

export function MapScreen() {
  const { data, error } = useApi<MapResponse>('/map');
  const size = data ? Math.max(340, Math.round(Math.sqrt(data.nodes.length) * 80)) : 340;
  const positions = useMemo(
    () => (data ? layoutGraph(data.nodes.map((node) => node.key), data.edges.map((edge) => [edge.from, edge.to] as const), size) : new Map()),
    [data, size],
  );
  if (error) return <div className="screen"><p className="notice bad">{error}</p></div>;
  if (!data) return <div className="center muted">불러오는 중…</div>;
  if (data.nodes.length === 0) {
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
      <Link href="/questions" className="notice link">
        친구들이 공유한 질문 은행 →
      </Link>
      <p className="legend small">
        <span className="dot familiar" /> 익숙함 {counts.familiar} · <span className="dot shaky" /> 흔들림 {counts.shaky} · <span className="dot unlearned" /> 아직 안 배움{' '}
        {counts.unlearned}
      </p>
      <div className="map-scroll">
        <svg className="map" width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="개념 지도">
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
