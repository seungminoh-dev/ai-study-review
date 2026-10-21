import type { CreditsResponse, InterviewResponse, InterviewTopicSuggestion, JobView, StatsResponse } from '@moai/shared';
import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import example from '../../../packages/shared/fixtures/immutable-object.json';
import { creditBalance, creditMonthStart, spendCredits } from '../src/domain/credits';
import { notifyBudget } from '../src/llm/budget';
import { runJob, runPendingJobs } from '../src/llm/jobs';
import { api, callTool, mcpUrl, newUser, type TestUser } from './helpers';

// 돈이 드는 부분만 확인한다: 한도, 크레딧, 사용량 기록, 끝나면 원문 지우기. Anthropic API는 fetch를 바꿔 흉내 낸다.

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

const usageRow = (userId: string, kind: string, cost: number, at = Date.now()) =>
  env.DB.prepare(
    "INSERT INTO llm_usage (id, user_id, job_id, kind, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_micro_usd, created_at) VALUES (?1, ?2, 'x', ?3, 'm', 0, 0, 0, 0, ?4, ?5)",
  ).bind(crypto.randomUUID(), userId, kind, cost, at);
/** 이번 달 크레딧을 미리 써 둔다 */
const spent = (userId: string, amount: number, at = Date.now()) =>
  env.DB.prepare("INSERT INTO credit_ledger (id, user_id, amount, kind, ref, note, created_at) VALUES (?1, ?2, ?3, 'ask', NULL, NULL, ?4)").bind(crypto.randomUUID(), userId, -amount, at);
const monthlyLeft = async (who: TestUser) => ((await (await api(who, '/credits')).json()) as CreditsResponse).credits.monthly;

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

  it('refuses new work once the whole service hit this month’s cap, whatever credits I have', async () => {
    const cardId = await explainCardId();
    const fetch = mockClaude(GRADE);
    const row = usageRow('someone-else', 'grade', 90_000_000);
    await row.run();
    try {
      expect((await api(user, `/cards/${cardId}/grade-ai`, { method: 'POST', json: { answer: '설명' } })).status).toBe(429);
      expect(await (await api(user, '/ai/status')).json()).toMatchObject({ available: true, over_budget: true, credits: { monthly: 500, held: 0 } });
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      await env.DB.prepare("DELETE FROM llm_usage WHERE user_id = 'someone-else'").run();
    }
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
    expect(await response.json()).toMatchObject({ answer: '방어적 복사는 바깥과 나눠 쓰지 않으려고 복사하는 거예요.', credits: { monthly: 499, monthly_total: 500, held: 0 } });
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

  it('stops when credits run out without calling the API, even with requests sent at once', async () => {
    const cardId = await mcqCardId();
    const fetch = mockClaude({ answer: '답' });
    await spent(user.id, 498).run();
    const statuses = await Promise.all(Array.from({ length: 5 }, () => api(user, `/cards/${cardId}/ask`, { method: 'POST', json: { question: '왜요?' } }).then((r) => r.status)));
    expect(statuses.filter((status) => status === 200)).toHaveLength(2);
    expect(statuses.filter((status) => status === 429)).toHaveLength(3);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(await askCount()).toBe(2);
    expect(await monthlyLeft(user)).toBe(0);
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
    // 응답은 부를 때 만든다. 중계(Durable Object)는 다른 곳에서 만든 응답 본문을 읽지 못한다
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('overloaded', { status: 529 }));
    const errors = vi.spyOn(console, 'error');
    expect((await api(user, `/cards/${cardId}/ask`, { method: 'POST', json: { question: '왜요?' } })).status).toBe(502);
    // 연결 실패가 아니라 Anthropic의 529 응답으로 처리했다
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(errors.mock.calls.flat().join(' ')).toContain('"status":529');
    expect(await askCount()).toBe(0);
    // 쓴 크레딧도 돌려준다
    expect(await monthlyLeft(user)).toBe(500);
  });

  // Anthropic 호출은 미국 위치의 중계(llm/relay.ts)가 한다. 중계에서 끊긴 요청도 직접 부르던 때와 같이 셈한다
  it('keeps the cost of a call the relay gave up waiting on, and refunds one it could not even send', async () => {
    const cardId = await mcqCardId();
    vi.spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new DOMException('timed out', 'TimeoutError'))
      .mockRejectedValueOnce(new TypeError('Network connection lost'));
    // 기다리다 끊은 요청은 Anthropic 쪽에서 청구됐을 수 있어 비용 기록과 크레딧을 그대로 둔다
    expect((await api(user, `/cards/${cardId}/ask`, { method: 'POST', json: { question: '왜요?' } })).status).toBe(502);
    expect(await env.DB.prepare("SELECT model FROM llm_usage WHERE user_id = ?1 AND kind = 'ask'").bind(user.id).first<string>('model')).toMatch(/시간 초과/);
    // 보내지도 못한 요청은 기록을 지우고 크레딧을 돌려준다
    expect((await api(user, `/cards/${cardId}/ask`, { method: 'POST', json: { question: '왜요?' } })).status).toBe(502);
    expect(await askCount()).toBe(1);
    expect(await monthlyLeft(user)).toBe(499);
  });
});

describe('in-app mock interview', () => {
  it('asks along my own concepts, sums up at the end, counts each question and saves as an import', async () => {
    await callTool(await mcpUrl(user), 'save_learning', example);
    const fetch = mockClaude({ question: '불변 객체는 왜 스레드 안전한가요?', concept_key: 'immutable-object', good: ['핵심을 먼저 말했어요'], fix: ['방어적 복사를 빠뜨렸어요'] });
    const first = (await (await api(user, '/interview', { method: 'POST', json: { concept_key: 'immutable-object' } })).json()) as InterviewResponse;
    expect(first).toMatchObject({ question: { question: '불변 객체는 왜 스레드 안전한가요?' }, summary: null, credits: { monthly: 499 } });
    expect(first.keys[0]).toBe('immutable-object');
    const turns = Array.from({ length: first.total }, () => ({ question: '불변 객체는 왜 스레드 안전한가요?', answer: '상태가 안 바뀌어서요.' }));
    const last = (await (await api(user, '/interview', { method: 'POST', json: { keys: first.keys, turns } })).json()) as InterviewResponse;
    expect(last).toMatchObject({ question: null, summary: { fix: ['방어적 복사를 빠뜨렸어요'] }, credits: { monthly: 498 } });
    expect(fetch).toHaveBeenCalledTimes(2);
    // 남의 개념 key로는 면접할 수 없다
    expect((await api(await newUser(), '/interview', { method: 'POST', json: { keys: first.keys } })).status).toBe(404);
    const saved = await api(user, '/interview/save', { method: 'POST', json: { keys: first.keys, turns } });
    expect(saved.status).toBe(202);
    expect(await monthlyLeft(user)).toBe(493);
    const { job_id } = (await saved.json()) as { job_id: string };
    expect(await env.DB.prepare("SELECT input FROM llm_jobs WHERE id = ?1 AND kind = 'import'").bind(job_id).first<string>('input')).toContain('사용자: 상태가 안 바뀌어서요.');
    await env.DB.prepare('DELETE FROM llm_jobs WHERE id = ?1').bind(job_id).run();
  });

  it('suggests topics from my concepts without calling AI', async () => {
    await callTool(await mcpUrl(user), 'save_learning', example);
    const fetch = vi.spyOn(globalThis, 'fetch');
    const { topics } = (await (await api(user, '/interview/topics?concept=immutable-object')).json()) as { topics: InterviewTopicSuggestion[] };
    expect(topics[0]).toMatchObject({ concept_key: 'immutable-object', reason: '고른 개념에서' });
    expect(new Set(topics.map((topic) => topic.concept_key)).size).toBe(topics.length);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('asks as many questions as the depth says, on a free topic without my records, and saves it as a new topic', async () => {
    const fetch = mockClaude({ question: 'ETag는 언제 쓰나요?', concept_key: 'topic', good: ['예를 들었어요'], fix: [] });
    const plan = { topic: 'HTTP 캐시', depth: 'light', level: 'advanced' };
    const first = (await (await api(user, '/interview', { method: 'POST', json: plan })).json()) as InterviewResponse;
    expect(first).toMatchObject({ keys: [], names: ['HTTP 캐시'], total: 3, question: { question: 'ETag는 언제 쓰나요?' } });
    const prompt = String(fetch.mock.calls[0]![1]!.body);
    expect(prompt).toContain('<topic>HTTP 캐시</topic>');
    expect(prompt).toContain('난이도는 심화');
    const turns = Array.from({ length: 3 }, () => ({ question: 'ETag는 언제 쓰나요?', answer: '바뀌었는지 확인할 때요.' }));
    const last = (await (await api(user, '/interview', { method: 'POST', json: { ...plan, turns } })).json()) as InterviewResponse;
    // 질문마다 1크레딧: 여기서는 첫 질문과 마지막 정리만 불러서 2크레딧
    expect(last).toMatchObject({ question: null, summary: { good: ['예를 들었어요'] } });
    expect(await monthlyLeft(user)).toBe(498);
    expect((await api(user, '/interview/save', { method: 'POST', json: { turns } })).status).toBe(400);
    const saved = await api(user, '/interview/save', { method: 'POST', json: { topic: 'HTTP 캐시', turns } });
    expect(saved.status).toBe(202);
    const { job_id } = (await saved.json()) as { job_id: string };
    expect(await env.DB.prepare('SELECT input FROM llm_jobs WHERE id = ?1').bind(job_id).first<string>('input')).toContain('면접 주제: HTTP 캐시');
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
    // AI 비용이 든 실패라 크레딧은 돌려주지 않는다 (실패를 되풀이해 예산을 쓰지 못하게)
    expect(await monthlyLeft(user)).toBe(490);
  });

  it('gives the credits back when a job fails without reaching the AI', async () => {
    const { job_id } = (await (await api(user, '/import', { method: 'POST', json: { text: '대화 '.repeat(100) } })).json()) as { job_id: string };
    expect(await monthlyLeft(user)).toBe(490);
    // 서버 AI 설정을 지우면 매분 작업이 기다리던 작업을 실패로 끝낸다
    await runPendingJobs({ ...env, ANTHROPIC_API_KEY: '' }, Date.now());
    expect(((await (await api(user, `/jobs/${job_id}`)).json()) as JobView)).toMatchObject({ status: 'failed', error: 'unavailable' });
    expect(await monthlyLeft(user)).toBe(500);
  });

  it('does not make the job when credits are short', async () => {
    await spent(user.id, 495).run();
    const response = await api(user, '/import', { method: 'POST', json: { text: '대화 '.repeat(100) } });
    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({ error: { code: 'no_credits' } });
    expect(await env.DB.prepare('SELECT count(*) AS n FROM llm_jobs WHERE user_id = ?1').bind(user.id).first<number>('n')).toBe(0);
    expect(await monthlyLeft(user)).toBe(5);
  });
});

describe('AI credits', () => {
  const at = (month: number, day = 2) => Date.UTC(2026, month, day, 3);

  it('refills the monthly credits on the 1st (KST), keeps held credits and spends monthly first', async () => {
    expect(creditMonthStart(Date.UTC(2026, 9, 31, 15, 30))).toBe(Date.UTC(2026, 9, 31, 15)); // 11월 1일 0시 30분 KST는 11월
    await env.DB.prepare("INSERT INTO credit_ledger (id, user_id, amount, kind, ref, note, created_at) VALUES (?1, ?2, 100, 'grant', NULL, NULL, ?3)").bind(crypto.randomUUID(), user.id, at(8)).run();
    await spent(user.id, 550, at(8)).run();
    expect(await creditBalance(env, user.id, at(8))).toMatchObject({ monthly: 0, held: 50 });
    // 다음 달: 월간은 다시 500, 남은 보유 50은 그대로
    expect(await creditBalance(env, user.id, at(9))).toMatchObject({ monthly: 500, held: 50 });
    await spent(user.id, 120, at(9)).run();
    expect(await creditBalance(env, user.id, at(9))).toMatchObject({ monthly: 380, held: 50 });
    // 월간을 다 쓰면 보유에서 빠지고, 모자라면 쓰지 않는다
    expect(await spendCredits(env, user.id, 'import', 400, 'r1', at(9, 3))).toBe(true);
    expect(await creditBalance(env, user.id, at(9, 3))).toMatchObject({ monthly: 0, held: 30 });
    expect(await spendCredits(env, user.id, 'import', 31, 'r2', at(9, 3))).toBe(false);
    expect(await creditBalance(env, user.id, at(10))).toMatchObject({ monthly: 500, held: 30 });
  });

  it('lets only the owner grant held credits', async () => {
    const owner = await newUser('오너', 'owner');
    expect((await api(user, '/admin/credits', { method: 'POST', json: { user_id: user.id, amount: 1000 } })).status).toBe(403);
    expect((await api(owner, '/admin/credits', { method: 'POST', json: { user_id: user.id, amount: 300, note: '베타 감사' } })).status).toBe(204);
    const { credits, history } = (await (await api(user, '/credits')).json()) as CreditsResponse;
    expect(credits).toMatchObject({ monthly: 500, held: 300 });
    expect(history[0]).toMatchObject({ kind: 'grant', amount: 300, note: '베타 감사' });
  });

  it('gives a hidden achievement and its credits only once, even when stats load at once', async () => {
    await env.DB.batch(Array.from({ length: 30 }, () => usageRow(user.id, 'ask', 0)));
    const loads = await Promise.all([api(user, '/stats'), api(user, '/stats')]);
    for (const load of loads) expect(load.status).toBe(200);
    const stats = (await (await api(user, '/stats')).json()) as StatsResponse;
    expect(stats.achievements.earned.map((item) => item.id)).toEqual(['curious']);
    expect(stats.achievements.total).toBeGreaterThan(1);
    const grants = await env.DB.prepare("SELECT count(*) AS n, sum(amount) AS total FROM credit_ledger WHERE user_id = ?1 AND kind = 'achievement'").bind(user.id).first();
    expect(grants).toEqual({ n: 1, total: 30 });
    expect(((await (await api(user, '/credits')).json()) as CreditsResponse).credits.held).toBe(30);
  });
});

describe('budget alerts', () => {
  it('tells the owner once per step each month as the service-wide cost climbs', async () => {
    const now = Date.now();
    try {
      await usageRow('budget-test', 'grade', 50_000_000, now).run(); // $50 / 한도 $90 → 50%
      expect(await notifyBudget(env, now)).toBe(50);
      expect(await notifyBudget(env, now + 60_000)).toBeNull();
      await usageRow('budget-test', 'grade', 25_000_000, now).run(); // $75 → 80%
      expect(await notifyBudget(env, now + 120_000)).toBe(80);
      expect(await notifyBudget(env, now + 180_000)).toBeNull();
    } finally {
      await env.DB.batch([
        env.DB.prepare("DELETE FROM llm_usage WHERE user_id = 'budget-test'"),
        env.DB.prepare("DELETE FROM alerts WHERE kind LIKE 'budget_%'"),
      ]);
    }
  });
});
