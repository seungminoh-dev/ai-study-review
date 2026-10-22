import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { SaveLearningInput } from '@moai/shared';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import example from '../../../packages/shared/fixtures/immutable-object.json';
import max from '../../../packages/shared/fixtures/save-learning-max.json';
import { chatQueue } from '../src/domain/chat-review';
import { ORIGIN, api, callTool, mcpUrl, newUser, readRpc, rpc, workerFetch, type TestUser } from './helpers';

const json = (value: unknown) => JSON.parse(JSON.stringify(value));
const count = async (table: string, userId: string) =>
  (await env.DB.prepare(`SELECT count(*) AS n FROM ${table} WHERE user_id = ?1`).bind(userId).first<{ n: number }>())!.n;

let user: TestUser;
let url: string;

beforeEach(async () => {
  user = await newUser();
  url = await mcpUrl(user);
});

describe('MCP endpoint, raw 2025-era requests', () => {
  it('answers initialize with the server info', async () => {
    const response = await rpc(url, 'initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'contract-test', version: '1.0.0' },
    });
    expect(response.status).toBe(200);
    const result = (await readRpc(response)).result;
    expect(result.serverInfo.name).toBe('moai');
    // 코치 지침이 없는 일반 대화에서도 언제 저장하는지 알 수 있도록 서버 공통 지침을 준다
    expect(result.instructions).toContain('find_concepts로 기존 개념을 찾은 뒤 save_learning으로 저장한다');
  });

  it('lists the tools with the schema zod produces, and cards have no rung field', async () => {
    const message = await readRpc(await rpc(url, 'tools/list', {}, { 'mcp-protocol-version': '2025-06-18' }));
    const tools = message.result.tools as { name: string; inputSchema: Record<string, any> }[];
    expect(tools.map((tool) => tool.name).sort()).toEqual(['find_concepts', 'get_categories', 'get_interview_chain', 'get_learner_context', 'get_review_queue', 'save_learning', 'submit_review', 'update_categories']);
    const save = tools.find((tool) => tool.name === 'save_learning')!;
    expect(save.inputSchema).toEqual({ type: 'object', ...json(SaveLearningInput['~standard'].jsonSchema.input({ target: 'draft-2020-12' })) });
    expect(JSON.stringify(save.inputSchema)).not.toContain('"rung"');
  });

  it('saves a session with concepts, edges, judgments, follow-ups and cards', async () => {
    const result = await callTool(url, 'save_learning', example);
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      duplicate: false,
      counts: { concepts: 5, new_concepts: 5, cards: 5, judgments: 2, followups: 2, edges: 4 },
      review_url: `${ORIGIN}/review`,
    });
    expect(result.content[0].text).toBe(
      '개념 5개(새 5·기존 0), 카드 5장, 다음에 볼 질문 2개를 저장했어요. 그중 1장은 앞 단계를 익히면 열려요. 앱 설정에서 알림 시간을 정하면 그 시각에 복습을 알려 드려요.',
    );
    expect(await count('concepts', user.id)).toBe(5);
    expect(await count('edges', user.id)).toBe(4);
    expect(await count('judgments', user.id)).toBe(2);
    expect(await count('followups', user.id)).toBe(2);

    const cards = await env.DB.prepare(
      'SELECT k.key, c.type, c.rung, c.status, c.state FROM cards c JOIN concepts k ON k.id = c.concept_id WHERE c.user_id = ?1 ORDER BY k.key, c.rung, c.type',
    )
      .bind(user.id)
      .all();
    // 개념마다 가장 낮은 단계만 열고, 설명하기는 잠근다 (설계서 §9.4)
    expect(cards.results).toEqual([
      { key: 'deep-copy', type: 'mcq', rung: 1, status: 'active', state: 0 },
      { key: 'final-variable', type: 'cloze', rung: 2, status: 'active', state: 0 },
      { key: 'final-variable', type: 'ox', rung: 2, status: 'active', state: 0 },
      { key: 'immutable-object', type: 'ox', rung: 1, status: 'active', state: 0 },
      { key: 'immutable-object', type: 'explain', rung: 3, status: 'locked', state: 0 },
    ]);
    // 설명하기 카드에 세션 final_answer를 썼으니 그 개념의 최종 버전으로도 저장한다
    const concept = await env.DB.prepare("SELECT final_answer, search_text FROM concepts WHERE user_id = ?1 AND key = 'immutable-object'")
      .bind(user.id)
      .first<{ final_answer: string; search_text: string }>();
    expect(concept).toEqual({ final_answer: example.final_answer, search_text: '|불변객체|immutableobject|' });
  });

  it('returns the earlier result when the same session is sent again', async () => {
    const first = await callTool(url, 'save_learning', example);
    const again = await callTool(url, 'save_learning', example);
    expect(again.structuredContent).toMatchObject({ duplicate: true, session_id: first.structuredContent.session_id });
    expect(again.content[0].text).toBe(first.content[0].text);
    expect(await count('learning_sessions', user.id)).toBe(1);
    expect(await count('cards', user.id)).toBe(5);
  });

  it('reuses existing concepts and opens new cards only up to the open rung', async () => {
    await callTool(url, 'save_learning', example);
    const second = {
      topic: '깊은 복사 다시 보기',
      concepts: [{ key: 'deep-copy', name: '깊은 복사', aliases: ['deep copy'] }],
      cards: [
        { type: 'cloze', concept: 'deep-copy', prompt: '깊은 복사는 참조가 가리키는 ____까지 새로 만든다.', answer: '객체', choices: ['객체', '변수', '메서드'], explain: '참조만 복사하면 얕은 복사다.' },
        { type: 'ox', concept: 'deep-copy', prompt: '깊은 복사는 원본과 복사본이 내부 객체를 공유한다.', answer: 'X', explain: '공유하면 얕은 복사다.' },
      ],
    };
    const result = await callTool(url, 'save_learning', second);
    expect(result.structuredContent.counts).toMatchObject({ concepts: 1, new_concepts: 0, cards: 2 });
    const cards = await env.DB.prepare(
      "SELECT c.type, c.status FROM cards c JOIN concepts k ON k.id = c.concept_id WHERE c.user_id = ?1 AND k.key = 'deep-copy' ORDER BY c.rung, c.type",
    )
      .bind(user.id)
      .all();
    // deep-copy는 1단계가 열려 있으니 새 1단계(ox)는 열고 2단계(cloze)는 잠근다
    expect(cards.results).toEqual([
      { type: 'mcq', status: 'active' },
      { type: 'ox', status: 'active' },
      { type: 'cloze', status: 'locked' },
    ]);
    const aliases = await env.DB.prepare("SELECT aliases FROM concepts WHERE user_id = ?1 AND key = 'deep-copy'").bind(user.id).first('aliases');
    expect(JSON.parse(aliases as string)).toEqual(['deep copy']);
  });

  it('keeps the old name searchable when a concept is renamed', async () => {
    await callTool(url, 'save_learning', example);
    await callTool(url, 'save_learning', {
      topic: '이름 바꾸기',
      concepts: [{ key: 'deep-copy', name: 'Deep copy' }],
      cards: [{ type: 'ox', concept: 'deep-copy', prompt: '깊은 복사는 내부 객체도 새로 만든다.', answer: 'O', explain: '참조만 복사하면 얕은 복사다.' }],
    });
    const result = await callTool(url, 'find_concepts', { query: '깊은 복사' });
    expect(result.structuredContent.concepts).toMatchObject([{ key: 'deep-copy', name: 'Deep copy', aliases: ['깊은 복사'] }]);
  });

  it('treats a change inside code as new content', async () => {
    await callTool(url, 'save_learning', example);
    const fixed = json(example);
    fixed.cards[0].code = fixed.cards[0].code.replace('\n', '\n    ');
    expect((await callTool(url, 'save_learning', fixed)).structuredContent.duplicate).toBe(false);
  });

  it('saves the largest fixture', async () => {
    const result = await callTool(url, 'save_learning', max);
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent.counts.cards).toBe(30);
  });

  it('returns a tool error Claude can act on and saves nothing when the domain check fails', async () => {
    const bad = json(example);
    bad.cards[2].options[2].correct = true;
    const result = await callTool(url, 'save_learning', bad);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('정답이 정확히 1개');
    expect(await count('learning_sessions', user.id)).toBe(0);
    expect(await count('concepts', user.id)).toBe(0);
  });

  it('still validates input with zod behind the cached JSON Schema', async () => {
    const bad = json(example);
    bad.cards[0].type = 'essay';
    const result = await callTool(url, 'save_learning', bad);
    expect(result.isError).toBe(true);
    expect(await count('learning_sessions', user.id)).toBe(0);
  });

  it('finds saved concepts by name, alias or key, with their neighbours', async () => {
    await callTool(url, 'save_learning', example);
    const result = await callTool(url, 'find_concepts', { query: '깊은복사, Immutable Object' });
    const found = result.structuredContent.concepts as { key: string; state: string; last_judgment: { label: string } | null }[];
    expect(found.map((concept) => concept.key).sort()).toEqual(['deep-copy', 'immutable-object']);
    expect(found.find((concept) => concept.key === 'deep-copy')).toMatchObject({ state: '흔들림', last_judgment: { label: '틀림' } });
    const related = (result.structuredContent.related as { key: string; state: string }[]).map((concept) => concept.key).sort();
    expect(related).toEqual(['defensive-copy', 'final-variable', 'shallow-copy']);
    expect(result.content[0].text).toContain('`deep-copy` 깊은 복사');

    const none = await callTool(url, 'find_concepts', { query: '가비지 컬렉션' });
    expect(none.content[0].text).toContain('새 개념으로 저장하면 돼요');
  });

  it('returns the learner context for concept keys or a topic', async () => {
    await callTool(url, 'save_learning', example);
    const byKey = await callTool(url, 'get_learner_context', { concept_keys: ['deep-copy'] });
    const text = byKey.content[0].text as string;
    expect(text).toContain('## 깊은 복사 (deep-copy) · 흔들림');
    expect(text).toContain('[틀림] "깊은 복사는 외부에서');
    expect(text).toContain('연결: 방어적 복사 (contrast, 아직 안 배움), 얕은 복사 (contrast, 아직 안 배움)');
    expect(text).toContain('열린 질문: "깊은 복사와 방어적 복사는 어떻게 다른가요?"');

    const byTopic = await callTool(url, 'get_learner_context', { topic: '불변 객체와 방어적 복사' });
    expect((byTopic.structuredContent.concepts as { key: string }[]).map((concept) => concept.key).sort()).toEqual(['defensive-copy', 'immutable-object']);

    const missing = await callTool(url, 'get_learner_context', {});
    expect(missing.isError).toBe(true);
  });

  it("keeps each user's concepts separate", async () => {
    await callTool(url, 'save_learning', example);
    const other = await newUser('다른 사람');
    const result = await callTool(await mcpUrl(other), 'find_concepts', { query: '깊은 복사' });
    expect(result.structuredContent.concepts).toEqual([]);
  });
});

describe('MCP endpoint, access rules', () => {
  it('stops saving after 100 saves in a day for one person', async () => {
    const user = await newUser();
    const url = await mcpUrl(user);
    const now = Date.now();
    await env.DB.batch(
      Array.from({ length: 100 }, () =>
        env.DB.prepare("INSERT INTO learning_sessions (id, user_id, source, topic, payload_hash, summary, created_at) VALUES (?1, ?2, 'claude.ai', '많이', ?3, '요약', ?4)").bind(
          crypto.randomUUID(),
          user.id,
          crypto.randomUUID(),
          now,
        ),
      ),
    );
    const result = await callTool(url, 'save_learning', example);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('24시간에 100번까지');
    // 다른 사람은 그대로 저장한다
    expect((await callTool(await mcpUrl(await newUser()), 'save_learning', example)).isError).toBeFalsy();
  });

  it('rejects an unknown token with 404', async () => {
    const response = await rpc(`${ORIGIN}/mcp/u/not-a-real-token`, 'tools/list');
    expect(response.status).toBe(404);
    expect(await response.text()).toBe('');
  });

  it('stops the old URL as soon as a new one is issued', async () => {
    const fresh = await mcpUrl(user);
    expect((await rpc(url, 'tools/list')).status).toBe(404);
    expect((await rpc(fresh, 'tools/list', {}, { 'mcp-protocol-version': '2025-06-18' })).status).toBe(200);
    await api(user, '/mcp-token', { method: 'DELETE' });
    expect((await rpc(fresh, 'tools/list')).status).toBe(404);
  });

  it('answers GET and DELETE with 405', async () => {
    expect((await workerFetch(url)).status).toBe(405);
    expect((await workerFetch(url, { method: 'DELETE' })).status).toBe(405);
  });

  it('rejects a foreign Origin', async () => {
    expect((await rpc(url, 'tools/list', {}, { origin: 'https://evil.example' })).status).toBe(403);
  });

  it('rejects a different host', async () => {
    expect((await rpc(url.replace(ORIGIN, 'https://other.test'), 'tools/list')).status).toBe(421);
  });

  it('rejects a body over 256KB', async () => {
    const response = await workerFetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'save_learning', arguments: { topic: 'x'.repeat(300 * 1024) } } }),
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
    it(`connects in ${label} mode, finds concepts and saves a session`, async () => {
      const client = new Client({ name: 'contract-test', version: '1.0.0' }, { versionNegotiation: { mode } });
      const transport = new StreamableHTTPClientTransport(new URL(url), { fetch: (input, init) => workerFetch(input, init) });
      await client.connect(transport);
      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name).sort()).toEqual(['find_concepts', 'get_categories', 'get_interview_chain', 'get_learner_context', 'get_review_queue', 'save_learning', 'submit_review', 'update_categories']);
      expect((await client.callTool({ name: 'find_concepts', arguments: { query: '불변 객체' } })).isError).toBeFalsy();
      const result = await client.callTool({ name: 'save_learning', arguments: example });
      expect(result.isError).toBeFalsy();
      await client.close();
    });
  }
});

describe('chat review tools', () => {
  it('quizzes without answers and grades the letter the user picked', async () => {
    const user = await newUser();
    const url = await mcpUrl(user);
    await callTool(url, 'save_learning', example);
    const queue = await callTool(url, 'get_review_queue', { size: 10 });
    const questions = queue.structuredContent.questions as { card_id: string; type: string; choices: { label: string; text: string }[] | null }[];
    expect(questions.length).toBeGreaterThan(0);
    expect(JSON.stringify(queue)).not.toMatch(/"correct"|"answer"|from_my_answer/);

    const mcq = questions.find((question) => question.type === 'mcq')!;
    const options = JSON.parse((await env.DB.prepare('SELECT options FROM cards WHERE id = ?1').bind(mcq.card_id).first<string>('options'))!) as { text: string; correct: boolean }[];
    const right = mcq.choices!.find((choice) => options.find((option) => option.text === choice.text)!.correct)!;
    const graded = await callTool(url, 'submit_review', { card_id: mcq.card_id, answer: right.label });
    expect(graded.structuredContent).toMatchObject({ recorded: true, correct: true, grade: 3 });
    // 같은 답을 곧바로 다시 보내면 두 번 기록하지 않는다
    expect((await callTool(url, 'submit_review', { card_id: mcq.card_id, answer: right.label })).structuredContent).toEqual({ duplicate: true });
    expect(await env.DB.prepare('SELECT count(*) AS n FROM review_logs WHERE card_id = ?1').bind(mcq.card_id).first('n')).toBe(1);

    const ox = questions.find((question) => question.type === 'ox')!;
    expect((await callTool(url, 'submit_review', { card_id: ox.card_id, answer: '모르겠어요' })).isError).toBe(true);
    // 남의 카드는 채점하지 않는다
    expect((await callTool(await mcpUrl(await newUser()), 'submit_review', { card_id: ox.card_id, answer: 'O' })).isError).toBe(true);

    // 앱에서 먼저 푼 카드는 채팅에서 다시 채점하지 않는다
    await api(user, '/reviews', { method: 'POST', json: { reviews: [{ id: crypto.randomUUID(), card_id: ox.card_id, grade: 3, reviewed_at: Date.now() }] } });
    // 1분 넘게 지난 뒤라고 친다 (1분 안이면 "방금 기록했어요"로 답한다)
    await env.DB.prepare('UPDATE review_logs SET reviewed_at = reviewed_at - 120000 WHERE card_id = ?1').bind(ox.card_id).run();
    expect((await callTool(url, 'submit_review', { card_id: ox.card_id, answer: 'O' })).content[0].text).toContain('오늘 복습할 카드가 아니에요');
    // 보기 글자는 날이 바뀌어도 같은 보기를 가리킨다 (04:00을 넘겨 답해도 된다)
    const later = await chatQueue(env, user.id, 10, Date.now() + 86_400_000);
    for (const question of later.questions) {
      const before = questions.find((item) => item.card_id === question.card_id);
      if (before?.choices) expect(question.choices).toEqual(before.choices);
    }

    // 모의면접: 연결선을 따라 개념을 고른다
    const chain = await callTool(url, 'get_interview_chain', { concept_key: 'immutable-object', length: 3 });
    expect(chain.structuredContent.order[0]).toBe('immutable-object');
    expect(chain.structuredContent.order.length).toBeGreaterThan(1);
  });
});
