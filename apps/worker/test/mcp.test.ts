import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import example from '../../../packages/shared/fixtures/immutable-object.json';
import max from '../../../packages/shared/fixtures/save-learning-max.json';
import { MCP_URL, ORIGIN, readRpc, rpc, waitFor, workerFetch } from './helpers';

const json = (value: unknown) => JSON.parse(JSON.stringify(value));

describe('MCP endpoint, raw 2025-era requests', () => {
  it('answers initialize with the server info', async () => {
    const response = await rpc('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'contract-test', version: '1.0.0' },
    });
    expect(response.status).toBe(200);
    const message = await readRpc(response);
    expect(message.result.serverInfo.name).toBe('moai');
  });

  it('lists ping and save_learning, and the card schema has no rung field', async () => {
    const message = await readRpc(await rpc('tools/list', {}, { 'mcp-protocol-version': '2025-06-18' }));
    const tools = message.result.tools as { name: string; inputSchema: Record<string, any> }[];
    expect(tools.map((tool) => tool.name).sort()).toEqual(['ping', 'save_learning']);
    const save = tools.find((tool) => tool.name === 'save_learning')!;
    expect(Object.keys(save.inputSchema.properties)).toEqual(expect.arrayContaining(['topic', 'concepts', 'cards']));
    expect(JSON.stringify(save.inputSchema)).not.toContain('"rung"');
  });

  it('saves a valid session and logs the request', async () => {
    const message = await readRpc(
      await rpc('tools/call', { name: 'save_learning', arguments: example }, { 'mcp-protocol-version': '2025-06-18' }),
    );
    expect(message.result.isError).toBeFalsy();
    expect(message.result.structuredContent.counts).toEqual({ concepts: 5, cards: 5, judgments: 2, followups: 2, edges: 4 });
    const saved = await env.DB.prepare('SELECT topic FROM spike_log WHERE id = ?1').bind(message.result.structuredContent.spike_id).first();
    expect(saved).toEqual({ topic: example.topic });
    const logged = await waitFor(() =>
      env.DB.prepare("SELECT rpc_method, tool_name, protocol_header FROM spike_mcp_requests WHERE tool_name = 'save_learning'").first(),
    );
    expect(logged).toEqual({ rpc_method: 'tools/call', tool_name: 'save_learning', protocol_header: '2025-06-18' });
  });

  it('saves the largest fixture', async () => {
    const message = await readRpc(await rpc('tools/call', { name: 'save_learning', arguments: max }));
    expect(message.result.isError).toBeFalsy();
    expect(message.result.structuredContent.counts.cards).toBe(30);
  });

  it('returns a tool error Claude can act on when the domain check fails', async () => {
    const bad = json(example);
    bad.cards[2].options[2].correct = true;
    const message = await readRpc(await rpc('tools/call', { name: 'save_learning', arguments: bad }));
    expect(message.result.isError).toBe(true);
    expect(message.result.content[0].text).toContain('정답이 정확히 1개');
  });

  it('answers ping', async () => {
    const message = await readRpc(await rpc('tools/call', { name: 'ping', arguments: {} }));
    expect(message.result.content[0].text).toContain('모아이 서버가 응답했어요');
  });
});

describe('MCP endpoint, access rules', () => {
  it('rejects an unknown token with 404', async () => {
    const response = await workerFetch(`${ORIGIN}/mcp/u/wrong-token`, { method: 'POST', body: '{}' });
    expect(response.status).toBe(404);
  });

  it('answers GET and DELETE with 405', async () => {
    expect((await workerFetch(MCP_URL, { method: 'GET', headers: { accept: 'text/event-stream' } })).status).toBe(405);
    expect((await workerFetch(MCP_URL, { method: 'DELETE' })).status).toBe(405);
  });

  it('rejects a foreign Origin', async () => {
    const response = await rpc('tools/list', {}, { origin: 'https://evil.example' });
    expect(response.status).toBe(403);
  });

  it('rejects a different host', async () => {
    const response = await workerFetch(`https://other.test/mcp/u/test-spike-token`, { method: 'POST', body: '{}' });
    expect(response.status).toBe(421);
  });

  it('rejects a body over 256KB', async () => {
    const response = await workerFetch(MCP_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ padding: 'x'.repeat(300 * 1024) }),
    });
    expect(response.status).toBe(413);
  });
});

describe('MCP endpoint, official SDK client', () => {
  const modes = [
    { label: '2025-era (legacy)', mode: 'legacy' as const },
    { label: '2026-07-28 (modern)', mode: { pin: '2026-07-28' } },
  ];
  for (const { label, mode } of modes) {
    it(`connects in ${label} mode and saves a session`, async () => {
      const client = new Client({ name: 'contract-test', version: '1.0.0' }, { versionNegotiation: { mode } });
      const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), { fetch: (url, init) => workerFetch(url, init) });
      await client.connect(transport);
      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name).sort()).toEqual(['ping', 'save_learning']);
      const result = await client.callTool({ name: 'save_learning', arguments: example });
      expect(result.isError).toBeFalsy();
      await client.close();
    });
  }
});
