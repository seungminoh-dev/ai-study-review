// 지식 지도 배치. 라이브러리 없이 힘 기반 배치(Fruchterman–Reingold)를 돌린 뒤 이름표가 겹치지 않게 밀어낸다.
// 같은 지도는 같은 모양이 나오도록 처음 자리를 이름 순 원 위에 둔다.
// 영역 끝에 가두지 않는다. 가두면 점들이 테두리에 몰려 사각형이 된다. 대신 배치가 끝난 뒤 그 크기에 맞춰 그린다.

export interface Point {
  x: number;
  y: number;
}

export interface Layout {
  positions: Map<string, Point>;
  width: number;
  height: number;
}

/** 선 하나의 알맞은 길이 (px) */
const LINK = 76;
/** 점 위쪽과 이름표 아래쪽까지의 높이. 점 반지름 9, 이름표는 점 아래 22px에 붙는다 */
const ABOVE = 14;
const BELOW = 30;
/** 이름표 사이 최소 간격 */
const GAP = 6;
/** 그림 가장자리 여백 */
const MARGIN = 12;
const MIN_WIDTH = 320;
const MIN_HEIGHT = 160;

/** 12px 글자 기준 이름표 너비. 한글은 넓고 영문은 좁다 */
export function labelWidth(text: string): number {
  let width = 0;
  for (const char of text) width += char.charCodeAt(0) > 0x2e80 ? 12 : 7.2;
  return Math.max(28, width + 8);
}

/**
 * 가운데로 당기는 힘. 밀어내는 힘의 합(≈ n·LINK²/R)과 맞서 반지름이 LINK·√(n/GRAVITY) 근처에서 멈춘다.
 * 이 값이 작으면 점들이 수천 px까지 퍼진다
 */
const GRAVITY = 3;

/** aspect: 그릴 곳의 가로/세로 비율. 세로로 긴 휴대폰에서는 좌우로 더 당겨 지도를 세로로 길게 만든다 */
export function layoutGraph(keys: readonly string[], edges: readonly (readonly [string, string])[], widthOf: (key: string) => number, aspect = 1): Layout {
  const n = keys.length;
  const ratio = Math.min(2, Math.max(0.5, aspect));
  const gravityX = GRAVITY * Math.max(1, 1 / ratio);
  const gravityY = GRAVITY * Math.max(1, ratio);
  const sorted = [...keys].sort();
  if (n === 0) return { positions: new Map(), width: MIN_WIDTH, height: MIN_HEIGHT };

  const radius = Math.max(LINK, (n * LINK) / (2 * Math.PI));
  const points: Point[] = sorted.map((_, i) => {
    const angle = (2 * Math.PI * i) / n;
    return { x: radius * Math.cos(angle), y: radius * Math.sin(angle) };
  });
  const index = new Map(sorted.map((key, i) => [key, i]));
  const links = edges.filter(([a, b]) => index.has(a) && index.has(b) && a !== b).map(([a, b]) => [index.get(a)!, index.get(b)!] as const);

  // 1. 힘 기반 배치: 모든 점은 서로 밀고, 선으로 이어진 점은 당긴다. 떨어진 묶음이 멀리 가지 않게 가운데로도 당긴다
  const iterations = n > 150 ? 150 : 300;
  let temperature = LINK * 2;
  for (let step = 0; step < iterations && n > 1; step++) {
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
        const force = (LINK * LINK) / distance;
        dx[i]! += (x / distance) * force;
        dy[i]! += (y / distance) * force;
        dx[j]! -= (x / distance) * force;
        dy[j]! -= (y / distance) * force;
      }
    }
    for (const [i, j] of links) {
      const x = points[i]!.x - points[j]!.x;
      const y = points[i]!.y - points[j]!.y;
      const distance = Math.max(0.01, Math.hypot(x, y));
      const force = (distance * distance) / LINK;
      dx[i]! -= (x / distance) * force;
      dy[i]! -= (y / distance) * force;
      dx[j]! += (x / distance) * force;
      dy[j]! += (y / distance) * force;
    }
    for (let i = 0; i < n; i++) {
      dx[i]! -= points[i]!.x * gravityX;
      dy[i]! -= points[i]!.y * gravityY;
      const length = Math.max(0.01, Math.hypot(dx[i]!, dy[i]!));
      const move = Math.min(length, temperature);
      points[i]!.x += (dx[i]! / length) * move;
      points[i]!.y += (dy[i]! / length) * move;
    }
    temperature = Math.max(1, temperature * 0.97);
  }

  // 2. 이름표 겹침 없애기: 점과 이름표를 상자로 보고, 겹친 상자는 덜 겹친 방향으로 반씩 민다
  const half = sorted.map((key) => widthOf(key) / 2 + GAP / 2);
  for (let pass = 0; pass < 120; pass++) {
    let moved = false;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = points[i]!;
        const b = points[j]!;
        const overlapX = half[i]! + half[j]! - Math.abs(a.x - b.x);
        const overlapY = ABOVE + BELOW + GAP - Math.abs(a.y - b.y);
        if (overlapX <= 0 || overlapY <= 0) continue;
        moved = true;
        if (overlapX < overlapY) {
          const shift = overlapX / 2 + 0.5;
          const sign = a.x < b.x || (a.x === b.x && i < j) ? -1 : 1;
          a.x += sign * shift;
          b.x -= sign * shift;
        } else {
          const shift = overlapY / 2 + 0.5;
          const sign = a.y < b.y || (a.y === b.y && i < j) ? -1 : 1;
          a.y += sign * shift;
          b.y -= sign * shift;
        }
      }
    }
    if (!moved) break;
  }

  // 3. 그림 크기를 배치에 맞춘다
  let left = Infinity;
  let right = -Infinity;
  let top = Infinity;
  let bottom = -Infinity;
  points.forEach((point, i) => {
    left = Math.min(left, point.x - half[i]!);
    right = Math.max(right, point.x + half[i]!);
    top = Math.min(top, point.y - ABOVE);
    bottom = Math.max(bottom, point.y + BELOW);
  });
  const width = Math.max(MIN_WIDTH, Math.ceil(right - left + MARGIN * 2));
  const height = Math.max(MIN_HEIGHT, Math.ceil(bottom - top + MARGIN * 2));
  // 그림이 최소 크기보다 작으면 가운데에 둔다
  const offsetX = (width - (right - left)) / 2 - left;
  const offsetY = (height - (bottom - top)) / 2 - top;
  const positions = new Map<string, Point>();
  sorted.forEach((key, i) => positions.set(key, { x: points[i]!.x + offsetX, y: points[i]!.y + offsetY }));
  return { positions, width, height };
}
