// 지식 지도 배치. 라이브러리 없이 힘 기반 배치(Fruchterman–Reingold)를 몇 백 번 돌린다.
// 같은 지도는 같은 모양이 나오도록 처음 자리를 이름 순 원 위에 둔다.

export interface Point {
  x: number;
  y: number;
}

export function layoutGraph(keys: readonly string[], edges: readonly (readonly [string, string])[], size: number, iterations = 220): Map<string, Point> {
  const n = keys.length;
  const center = size / 2;
  const sorted = [...keys].sort();
  const pos = new Map<string, Point>();
  sorted.forEach((key, i) => {
    const angle = (2 * Math.PI * i) / Math.max(1, n);
    pos.set(key, { x: center + size * 0.35 * Math.cos(angle), y: center + size * 0.35 * Math.sin(angle) });
  });
  if (n <= 1) {
    if (n === 1) pos.set(sorted[0]!, { x: center, y: center });
    return pos;
  }
  const k = Math.sqrt((size * size) / n) * 0.75;
  const links = edges.filter(([a, b]) => pos.has(a) && pos.has(b) && a !== b);
  const points = sorted.map((key) => pos.get(key)!);
  const index = new Map(sorted.map((key, i) => [key, i]));
  let temperature = size / 8;
  const margin = 24;
  for (let step = 0; step < iterations; step++) {
    const dx = new Float64Array(n);
    const dy = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let x = points[i]!.x - points[j]!.x;
        let y = points[i]!.y - points[j]!.y;
        let distance = Math.hypot(x, y);
        if (distance < 0.01) {
          x = 0.01 * (i - j);
          y = 0.01;
          distance = 0.02;
        }
        const force = (k * k) / distance;
        dx[i]! += (x / distance) * force;
        dy[i]! += (y / distance) * force;
        dx[j]! -= (x / distance) * force;
        dy[j]! -= (y / distance) * force;
      }
    }
    for (const [a, b] of links) {
      const i = index.get(a)!;
      const j = index.get(b)!;
      const x = points[i]!.x - points[j]!.x;
      const y = points[i]!.y - points[j]!.y;
      const distance = Math.max(0.01, Math.hypot(x, y));
      const force = (distance * distance) / k;
      dx[i]! -= (x / distance) * force;
      dy[i]! -= (y / distance) * force;
      dx[j]! += (x / distance) * force;
      dy[j]! += (y / distance) * force;
    }
    for (let i = 0; i < n; i++) {
      // 떨어진 개념이 멀리 가지 않게 가운데로 조금 당긴다
      dx[i]! += (center - points[i]!.x) * 0.05 * (k / 10);
      dy[i]! += (center - points[i]!.y) * 0.05 * (k / 10);
      const length = Math.max(0.01, Math.hypot(dx[i]!, dy[i]!));
      const move = Math.min(length, temperature);
      points[i]!.x = Math.min(size - margin, Math.max(margin, points[i]!.x + (dx[i]! / length) * move));
      points[i]!.y = Math.min(size - margin, Math.max(margin, points[i]!.y + (dy[i]! / length) * move));
    }
    temperature = Math.max(1, temperature * 0.97);
  }
  return pos;
}
