// 앱 아이콘, 파비콘, 알림 배지, 링크 미리보기 그림을 마스코트 픽셀 격자로 만들어 apps/web/public에 쓴다.
// 그림은 apps/web/src/Mascot.tsx의 happy 표정과 같다. 마스코트를 고치면 ART도 고치고 다시 돌린다.
import { writeFileSync } from 'node:fs';
import { crc32, deflateSync } from 'node:zlib';

const OUT = new URL('../apps/web/public/', import.meta.url);

// [x, y, 너비, 높이, 부위] (16×14 격자). HAT, BODY, ARMS_DOWN, FACE.happy 순서로 덮어 그린다
const ART = [
  [5, 0, 6, 1, 'line'],
  [4, 1, 1, 2, 'line'],
  [11, 1, 1, 2, 'line'],
  [5, 1, 6, 1, 'cream'],
  [5, 2, 6, 1, 'green'],
  [3, 3, 10, 1, 'line'],
  [2, 4, 12, 9, 'line'],
  [3, 4, 10, 8, 'body'],
  [4, 13, 3, 1, 'line'],
  [9, 13, 3, 1, 'line'],
  [3, 9, 2, 1, 'blush'],
  [11, 9, 2, 1, 'blush'],
  [0, 6, 2, 5, 'line'],
  [1, 7, 1, 3, 'body'],
  [14, 6, 2, 5, 'line'],
  [14, 7, 1, 3, 'body'],
  [5, 6, 2, 3, 'eye'],
  [9, 6, 2, 3, 'eye'],
  [5, 6, 1, 1, 'shine'],
  [9, 6, 1, 1, 'shine'],
  [6, 10, 1, 1, 'eye'],
  [7, 11, 2, 1, 'eye'],
  [9, 10, 1, 1, 'eye'],
];
const COLOR = {
  line: '#192849',
  body: '#ff914d',
  cream: '#fff0c7',
  green: '#78c98c',
  eye: '#192849',
  shine: '#ffffff',
  blush: '#ffb17c',
  spark: '#ffbd4a',
};
const BACKGROUND = '#fff0c7';

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/** 둥근 모서리 안에 드는 비율 (4×4 표본) */
function coverage(x, y, size, radius) {
  if (radius === 0) return 1;
  let inside = 0;
  for (let sy = 0; sy < 4; sy += 1) {
    for (let sx = 0; sx < 4; sx += 1) {
      const px = x + (sx + 0.5) / 4;
      const py = y + (sy + 0.5) / 4;
      const cx = Math.min(Math.max(px, radius), size - radius);
      const cy = Math.min(Math.max(py, radius), size - radius);
      if ((px - cx) ** 2 + (py - cy) ** 2 <= radius ** 2) inside += 1;
    }
  }
  return inside / 16;
}

/**
 * size×size PNG. 마스코트 한 칸을 scale px로 키워 가운데 둔다.
 * background가 없으면 투명, radius는 크기에 대한 모서리 반지름 비율.
 * badge는 Android 상태 표시줄용 실루엣: 흰색으로 칠하고 눈과 입만 뚫는다 (시스템은 알파만 쓴다).
 */
function icon({ size, scale, background, radius = 0, badge = false }) {
  const pixels = Buffer.alloc(size * size * 4);
  if (background) {
    const [r, g, b] = rgb(background);
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        pixels.set([r, g, b, Math.round(255 * coverage(x, y, size, radius * size))], (y * size + x) * 4);
      }
    }
  }
  const left = (size - 16 * scale) / 2;
  const top = (size - 14 * scale) / 2;
  if (!Number.isInteger(left) || !Number.isInteger(top)) throw new Error(`${size}px에 ${scale}배는 가운데가 픽셀에 맞지 않는다`);
  for (const [x, y, w, h, part] of ART) {
    const color = badge ? [255, 255, 255, part === 'eye' || part === 'shine' ? 0 : 255] : [...rgb(COLOR[part]), 255];
    for (let py = top + y * scale; py < top + (y + h) * scale; py += 1) {
      for (let px = left + x * scale; px < left + (x + w) * scale; px += 1) pixels.set(color, (py * size + px) * 4);
    }
  }
  return png(size, size, pixels);
}

// 링크 미리보기에서 손 흔드는 마스코트: 오른팔을 든다 (Mascot.tsx의 ARM_RIGHT_UP). 몸 밖 반짝임은 SPARKS에서 골랐다
const WAVE = [
  ...ART.filter(([x, y]) => !(x === 14 && y >= 6)),
  [14, 1, 2, 5, 'line'],
  [14, 2, 1, 3, 'body'],
  [-2, 0, 1, 3, 'spark'],
  [-3, 1, 3, 1, 'spark'],
  [-2, 9, 1, 1, 'green'],
];

/** 픽셀 글씨 "모아이". 한 칸이 마스코트 한 칸과 같은 크기다 */
const WORDMARK = [
  ['.#######.', '.#.....#.', '.#.....#.', '.#.....#.', '.#######.', '.........', '....#....', '....#....', '#########'],
  ['......#.', '......#.', '.###..#.', '#...#.#.', '#...#.##', '#...#.#.', '.###..#.', '......#.', '......#.'],
  ['......#', '......#', '.###..#', '#...#.#', '#...#.#', '#...#.#', '.###..#', '......#', '......#'],
];

/** 링크 미리보기 그림 (og:image 1200×630). 크림 바탕에 손 흔드는 마스코트와 "모아이". 미리보기가 가운데를 잘라도 보이게 가운데에 모은다 */
function ogImage() {
  const width = 1200;
  const height = 630;
  const cell = 20;
  const pixels = Buffer.alloc(width * height * 4);
  const fill = (x, y, w, h, hex) => {
    const color = [...rgb(hex), 255];
    for (let py = y; py < y + h; py += 1) for (let px = x; px < x + w; px += 1) pixels.set(color, (py * width + px) * 4);
  };
  fill(0, 0, width, height, BACKGROUND);
  // 마스코트(16×14칸)와 글씨(9칸 높이)의 가운데를 맞춘다
  const top = (height - 14 * cell) / 2;
  for (const [x, y, w, h, part] of WAVE) fill(120 + x * cell, top + y * cell, w * cell, h * cell, COLOR[part]);
  let left = 520;
  for (const glyph of WORDMARK) {
    glyph.forEach((row, y) => {
      [...row].forEach((mark, x) => {
        if (mark === '#') fill(left + x * cell, top + 50 + y * cell, cell, cell, COLOR.line);
      });
    });
    left += (glyph[0].length + 2) * cell;
  }
  return png(width, height, pixels);
}

function png(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height); // 줄마다 필터 0
  for (let y = 0; y < height; y += 1) rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), body.length + 4);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 6, 0, 0, 0], 8); // 8비트 RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const files = {
  // 설치 아이콘 (컴퓨터, 알림의 큰 아이콘). 모서리를 둥글게 자른다
  'icons/icon-192.png': icon({ size: 192, scale: 8, background: BACKGROUND, radius: 0.22 }),
  'icons/icon-512.png': icon({ size: 512, scale: 21, background: BACKGROUND, radius: 0.22 }),
  // Android가 원·둥근 사각형으로 자른다. 가운데 지름 80% 안에 그림을 둔다
  'icons/icon-512-maskable.png': icon({ size: 512, scale: 18, background: BACKGROUND }),
  // iOS는 투명 부분을 검게 칠하고 모서리를 직접 자른다
  'icons/apple-touch-icon.png': icon({ size: 180, scale: 7, background: BACKGROUND }),
  // 24dp 배지의 안쪽 22dp에 맞춘다
  'icons/badge.png': icon({ size: 96, scale: 5, badge: true }),
  'icons/favicon-32.png': icon({ size: 32, scale: 2 }),
  'icons/favicon.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -1 16 16" shape-rendering="crispEdges">${ART.map(
    ([x, y, w, h, part]) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${COLOR[part]}"/>`,
  ).join('')}</svg>\n`,
  // 카톡·슬랙 등에 주소를 보냈을 때의 미리보기 (index.html의 og:image)
  'og.png': ogImage(),
};

for (const [name, content] of Object.entries(files)) {
  writeFileSync(new URL(name, OUT), content);
  console.log(`${name} ${content.length}B`);
}
