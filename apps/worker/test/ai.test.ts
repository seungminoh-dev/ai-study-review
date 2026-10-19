import type { InterviewResponse, JobView } from '@moai/shared';
import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import example from '../../../packages/shared/fixtures/immutable-object.json';
import { runJob, runPendingJobs } from '../src/llm/jobs';
import { api, callTool, mcpUrl, newUser, type TestUser } from './helpers';

// 돈이 드는 부분만 확인한다: 한도, 사용량 기록, 끝나면 원문 지우기. Anthropic API는 fetch를 바꿔 흉내 낸다.

let user: TestUser;
beforeEach(async () => {
  user = await newUser();
});
afterEach(() => vi.restoreAllMocks());

function mockClaude(output: unknown, usage = { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 2000, cache_creation_input_tokens: 0 }) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url !== 'https://api.anthropic.com/v1/messages') throw new Error(`unexpected fetch ${url}`);
    return Response.json({ model: 'test-grader', stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(output) }], usage });
  });
}

const GRADE = {
  sentences: [{ quote: '불변 객체는 상태가 안 바뀐다.', label: '맞음', reason: '핵심이 맞다.' }],
  top_down: { ok: true, note: '첫 문장에 답이 있다.' },
  missing: ['방어적 복사'],
  coaching_question: '생성자에서 받은 리스트는 어떻게 다뤄야 할까요?',
  suggested_grade: 'hard',
};

async function explainCardId(): Promise<string> {
  await callTool(await mcpUrl(user), 'save_learning', example);
  return (await env.DB.prepare("SELECT id FROM cards WHERE user_id = ?1 AND type = 'explain'").bind(user.id).first<string>('id'))!;
}

describe('AI grading', () => {
  it('grades in the background, records the cost and keeps no copy of the answer', async () => {
    const cardId = await explainCardId();
    const fetch = mockClaude(GRADE);
    const response = await api(user, `/cards/${cardId}/grade-ai`, { method: 'POST', json: { answer: '불변 객체는 상태가 안 바뀐다.' } });
    expect(response.status).toBe(202);
    const { job_id } = (await response.json()) as { job_id: string };
    await runJob(env, job_id);
    await vi.waitFor(async () => expect(((await (await api(user, `/jobs/${job_id}`)).json()) as JobView).status).toBe('done'));
    const job = (await (await api(user, `/jobs/${job_id}`)).json()) as JobView;
    expect(job.result).toMatchObject({ suggested_grade: 'hard', missing: ['방어적 복사'] });

    const [call] = fetch.mock.calls;
    const init = call![1] as RequestInit & { headers: Record<string, string> };
    expect(init.headers['x-api-key']).toBe('test-anthropic-key');
    expect(JSON.parse(String(init.body))).toMatchObject({ model: 'test-grader', output_config: { effort: 'low', format: { type: 'json_schema' } }, fallbacks: 'default' });

    const stored = await env.DB.prepare('SELECT input FROM llm_jobs WHERE id = ?1').bind(job_id).first<string | null>('input');
    expect(stored).toBeNull();
    // 모르는 모델은 가장 비싼 단가(입력 10, 출력 50, 캐시 읽기 1)로 센다: 1000×10 + 500×50 + 2000×1
    const cost = await env.DB.prepare('SELECT cost_micro_usd FROM llm_usage WHERE job_id = ?1').bind(job_id).first<number>('cost_micro_usd');
    expect(cost).toBe(37_000);
    // 남의 작업은 볼 수 없다
    expect((await api(await newUser(), `/jobs/${job_id}`)).status).toBe(404);
  });

  it('refuses new work once the user spent this month’s cap', async () => {
    const cardId = await explainCardId();
    const fetch = mockClaude(GRADE);
    await env.DB.prepare("INSERT INTO llm_usage (id, user_id, job_id, kind, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_micro_usd, created_at) VALUES (?1, ?2, 'x', 'grade', 'm', 0, 0, 0, 0, 6000000, ?3)")
      .bind(crypto.randomUUID(), user.id, Date.now())
      .run();
    expect((await api(user, `/cards/${cardId}/grade-ai`, { method: 'POST', json: { answer: '설명' } })).status).toBe(429);
    expect(await (await api(user, '/ai/status')).json()).toEqual({ available: true, over_budget: true, ask_left: 50, interview_left: 80 });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('never has more than three grading jobs in flight, even with requests sent at once', async () => {
    const cardId = await explainCardId();
    // 응답이 오지 않는 API: 작업은 끝나지 않고 쌓인다
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise<Response>(() => undefined));
    const statuses = await Promise.all(
      Array.from({ length: 12 }, () => api(user, `/cards/${cardId}/grade-ai`, { method: 'POST', json: { answer: '설명' } }).then((response) => response.status)),
    );
    expect(statuses.filter((status) => status === 202)).toHaveLength(3);
    const jobs = await env.DB.prepare("SELECT count(*) AS n FROM llm_jobs WHERE user_id = ?1 AND kind = 'grade'").bind(user.id).first<number>('n');
    expect(jobs).toBe(3);
  });

  it('only grades my own explain cards', async () => {
    const cardId = await explainCardId();
    expect((await api(await newUser(), `/cards/${cardId}/grade-ai`, { method: 'POST', json: { answer: '설명' } })).status).toBe(404);
  });
});

describe('AI concept chat', () => {
  async function mcqCardId(): Promise<string> {
    await callTool(await mcpUrl(user), 'save_learning', example);
    return (await env.DB.prepare("SELECT id FROM cards WHERE user_id = ?1 AND type = 'mcq'").bind(user.id).first<string>('id'))!;
  }
  const askCount = () => env.DB.prepare("SELECT count(*) AS n FROM llm_usage WHERE user_id = ?1 AND kind = 'ask'").bind(user.id).first<number>('n');

  it('answers with the card as context, records the real cost and counts the question', async () => {
    const cardId = await mcqCardId();
    const fetch = mockClaude({ answer: '방어적 복사는 바깥과 나눠 쓰지 않으려고 복사하는 거예요.' });
    const response = await api(user, `/cards/${cardId}/ask`, { method: 'POST', json: { question: '내 답은 왜 틀렸어요?', picked: '얕은 복사' } });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ answer: '방어적 복사는 바깥과 나눠 쓰지 않으려고 복사하는 거예요.', left: 49 });
    const sent = JSON.parse(String((fetch.mock.calls[0]![1] as RequestInit).body)) as { messages: { content: string }[] };
    expect(sent.messages[0]!.content).toContain('<card>');
    expect(sent.messages[0]!.content).toContain('사용자가 고른 답: 얕은 복사');
    // 미리 적어 둔 비용이 실제 비용으로 바뀐다: 1000×10 + 500×50 + 2000×1
    const usage = await env.DB.prepare("SELECT model, cost_micro_usd FROM llm_usage WHERE user_id = ?1 AND kind = 'ask'").bind(user.id).first();
    expect(usage).toEqual({ model: 'test-grader', cost_micro_usd: 37_000 });
    // 남의 카드는 물을 수 없다
    expect((await api(await newUser(), `/cards/${cardId}/ask`, { method: 'POST', json: { question: '왜요?' } })).status).toBe(404);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('stops at the monthly limit without calling the API, even with requests sent at once', async () => {
    const cardId = await mcqCardId();
    const fetch = mockClaude({ answer: '답' });
    const now = Date.now();
    await env.DB.batch(
      Array.from({ length: 48 }, () =>
        env.DB.prepare("INSERT INTO llm_usage (id, user_id, job_id, kind, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_micro_usd, created_at) VALUES (?1, ?2, 'x', 'ask', 'm', 0, 0, 0, 0, 0, ?3)").bind(crypto.randomUUID(), user.id, now),
      ),
    );
    const statuses = await Promise.all(Array.from({ length: 5 }, () => api(user, `/cards/${cardId}/ask`, { method: 'POST', json: { question: '왜요?' } }).then((r) => r.status)));
    expect(statuses.filter((status) => status === 200)).toHaveLength(2);
    expect(statuses.filter((status) => status === 429)).toHaveLength(3);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(await askCount()).toBe(50);
  });

  it('turns the conversation into an import job for my own card only', async () => {
    const cardId = await mcqCardId();
    const turns = [{ question: '내 답은 왜 틀렸어요?', answer: '방어적 복사는 생성자와 getter 양쪽에서 해요.' }];
    expect((await api(await newUser(), `/cards/${cardId}/ask/cards`, { method: 'POST', json: { turns } })).status).toBe(404);
    const response = await api(user, `/cards/${cardId}/ask/cards`, { method: 'POST', json: { turns, picked: '얕은 복사' } });
    expect(response.status).toBe(202);
    const { job_id } = (await response.json()) as { job_id: string };
    const input = await env.DB.prepare("SELECT input FROM llm_jobs WHERE id = ?1 AND kind = 'import'").bind(job_id).first<string>('input');
    expect(input).toContain('방어적 복사는 생성자와 getter 양쪽에서 해요.');
    expect(input).toMatch(/이미 있는 개념: key `[a-z-]+`/);
    // 같은 대화를 다시 보내면 같은 작업이다
    expect(await (await api(user, `/cards/${cardId}/ask/cards`, { method: 'POST', json: { turns, picked: '얕은 복사' } })).json()).toEqual({ job_id, duplicate: true });
    // 기다리는 작업을 남기면 다음 테스트의 Cron이 이것부터 집는다
    await env.DB.prepare('DELETE FROM llm_jobs WHERE id = ?1').bind(job_id).run();
  });

  it('does not count a question the API never answered', async () => {
    const cardId = await mcqCardId();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('overloaded', { status: 529 }));
    expect((await api(user, `/cards/${cardId}/ask`, { method: 'POST', json: { question: '왜요?' } })).status).toBe(502);
    expect(await askCount()).toBe(0);
  });
});

describe('in-app mock interview', () => {
  it('asks along my own concepts, sums up at the end, counts each question and saves as an import', async () => {
    await callTool(await mcpUrl(user), 'save_learning', example);
    const fetch = mockClaude({ question: '불변 객체는 왜 스레드 안전한가요?', concept_key: 'immutable-object', good: ['핵심을 먼저 말했어요'], fix: ['방어적 복사를 빠뜨렸어요'] });
    const first = (await (await api(user, '/interview', { method: 'POST', json: { concept_key: 'immutable-object' } })).json()) as InterviewResponse;
    expect(first).toMatchObject({ question: { question: '불변 객체는 왜 스레드 안전한가요?' }, summary: null, left: 79 });
    expect(first.keys[0]).toBe('immutable-object');
    const turns = Array.from({ length: first.total }, () => ({ question: '불변 객체는 왜 스레드 안전한가요?', answer: '상태가 안 바뀌어서요.' }));
    const last = (await (await api(user, '/interview', { method: 'POST', json: { keys: first.keys, turns } })).json()) as InterviewResponse;
    expect(last).toMatchObject({ question: null, summary: { fix: ['방어적 복사를 빠뜨렸어요'] }, left: 78 });
    expect(fetch).toHaveBeenCalledTimes(2);
    // 남의 개념 key로는 면접할 수 없다
    expect((await api(await newUser(), '/interview', { method: 'POST', json: { keys: first.keys } })).status).toBe(404);
    const saved = await api(user, '/interview/save', { method: 'POST', json: { keys: first.keys, turns } });
    expect(saved.status).toBe(202);
    const { job_id } = (await saved.json()) as { job_id: string };
    expect(await env.DB.prepare("SELECT input FROM llm_jobs WHERE id = ?1 AND kind = 'import'").bind(job_id).first<string>('input')).toContain('사용자: 상태가 안 바뀌어서요.');
    await env.DB.prepare('DELETE FROM llm_jobs WHERE id = ?1').bind(job_id).run();
  });
});

describe('paste import', () => {
  it('turns a pasted conversation into a saved session in the cron, then forgets the text', async () => {
    const text = '사용자: 불변 객체가 뭐예요?\n코치: 먼저 설명해 볼래요?\n'.repeat(10);
    mockClaude({ ...example, source: undefined });
    const response = await api(user, '/import', { method: 'POST', json: { text } });
    expect(response.status).toBe(202);
    const { job_id } = (await response.json()) as { job_id: string };
    // 같은 대화를 다시 보내면 같은 작업이다
    expect(await (await api(user, '/import', { method: 'POST', json: { text } })).json()).toEqual({ job_id, duplicate: true });

    await runPendingJobs(env, Date.now());
    const job = (await (await api(user, `/jobs/${job_id}`)).json()) as JobView;
    expect(job).toMatchObject({ status: 'done', result: { duplicate: false } });
    const session = await env.DB.prepare('SELECT source FROM learning_sessions WHERE id = ?1 AND user_id = ?2')
      .bind((job.result as { session_id: string }).session_id, user.id)
      .first<string>('source');
    expect(session).toBe('import');
    expect(await env.DB.prepare('SELECT input FROM llm_jobs WHERE id = ?1').bind(job_id).first('input')).toBeNull();
  });

  it('gives up with invalid_output after one repair round and still forgets the text', async () => {
    const fetch = mockClaude({ topic: '빈 정리' });
    const { job_id } = (await (await api(user, '/import', { method: 'POST', json: { text: '대화 '.repeat(100) } })).json()) as { job_id: string };
    await runPendingJobs(env, Date.now());
    expect(((await (await api(user, `/jobs/${job_id}`)).json()) as JobView)).toMatchObject({ status: 'failed', error: 'invalid_output' });
    expect(fetch.mock.calls.filter(([url]) => String(url).includes('anthropic')).length).toBe(2);
    expect(await env.DB.prepare('SELECT input FROM llm_jobs WHERE id = ?1').bind(job_id).first('input')).toBeNull();
  });
});
