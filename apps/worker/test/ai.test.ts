import type { JobView } from '@moai/shared';
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
    expect(await (await api(user, '/ai/status')).json()).toEqual({ available: true, over_budget: true });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('only grades my own explain cards', async () => {
    const cardId = await explainCardId();
    expect((await api(await newUser(), `/cards/${cardId}/grade-ai`, { method: 'POST', json: { answer: '설명' } })).status).toBe(404);
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
