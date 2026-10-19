import { layoutGraph } from './layout';

// 지식 지도 배치는 개념 수의 제곱만큼 계산한다 (300개면 휴대폰에서 수백 ms). 화면이 멈추지 않게 따로 돌린다.

export interface LayoutRequest {
  id: number;
  keys: string[];
  edges: [string, string][];
  /** 개념 key → 이름표 너비 */
  widths: Record<string, number>;
  aspect: number;
}

self.onmessage = (event: MessageEvent<LayoutRequest>) => {
  const { id, keys, edges, widths, aspect } = event.data;
  const layout = layoutGraph(keys, edges, (key) => widths[key] ?? 0, aspect);
  self.postMessage({ id, layout });
};
