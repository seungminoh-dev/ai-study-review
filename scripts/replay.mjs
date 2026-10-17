// 배포한 MCP 서버에 요청을 여러 번 보내 응답 시간을 잰다 (MVP 0 확인 항목 3, 8).
// 기본은 읽기만 한다 (tools/list, find_concepts). --save를 붙이면 가장 큰 save_learning도 보낸다.
// 주의: --save는 커넥터 주인의 실제 계정에 "최대 크기 측정용 세션"을 한 번 저장한다 (같은 내용은 다시 저장하지 않는다).
//
//   node scripts/replay.mjs https://moai.<도메인>/mcp/u/<커넥터 토큰> [횟수=30] [--save]
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const save = args.includes('--save');
const [url, countArg] = args.filter((arg) => arg !== '--save');
if (!url) {
  console.error('사용법: node scripts/replay.mjs <커넥터 URL> [횟수]');
  process.exit(1);
}
const count = Number(countArg ?? 30);
const payload = JSON.parse(readFileSync(new URL('../packages/shared/fixtures/save-learning-max.json', import.meta.url)));

async function call(id, method, params) {
  const started = performance.now();
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18' },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  });
  const text = await response.text();
  const ms = performance.now() - started;
  if (!response.ok) throw new Error(`${method}: HTTP ${response.status} ${text.slice(0, 200)}`);
  if (text.includes('"isError":true')) throw new Error(`${method}: tool error ${text.slice(0, 300)}`);
  return ms;
}

const percentile = (values, p) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
};

await call(0, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'moai-replay', version: '1.0.0' } });
const lists = [];
const calls = [];
for (let i = 1; i <= count; i++) {
  lists.push(await call(i * 2 - 1, 'tools/list', {}));
  calls.push(
    save
      ? await call(i * 2, 'tools/call', { name: 'save_learning', arguments: payload })
      : await call(i * 2, 'tools/call', { name: 'find_concepts', arguments: { query: '불변 객체, 깊은 복사' } }),
  );
}
const callName = save ? 'tools/call save_learning (최대 크기)' : 'tools/call find_concepts';
for (const [name, values] of [['tools/list', lists], [callName, calls]]) {
  console.log(`${name}: p50 ${percentile(values, 50).toFixed(0)}ms, p95 ${percentile(values, 95).toFixed(0)}ms, 최대 ${Math.max(...values).toFixed(0)}ms`);
}
console.log('CPU 시간은 Cloudflare 대시보드 → Workers → moai → Logs(또는 wrangler tail)에서 요청별 CPU Time으로 확인하세요.');
