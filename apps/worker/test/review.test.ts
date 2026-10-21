import type { QueueResponse, ReviewItem, SessionDetail, TodayResponse } from '@moai/shared';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import example from '../../../packages/shared/fixtures/immutable-object.json';
import { loadTodayQueue } from '../src/domain/queue';
import { recordReviews } from '../src/domain/reviews';
import { api, callTool, mcpUrl, newUser, type TestUser } from './helpers';

let user: TestUser;

async function saveExample(): Promise<string> {
  const result = await callTool(await mcpUrl(user), 'save_learning', example);
  return result.structuredContent.session_id as string;
}

const answer = (cardId: string, grade: ReviewItem['grade'], reviewedAt = Date.now()): ReviewItem => ({
  id: crypto.randomUUID(),
  card_id: cardId,
  grade,
  reviewed_at: reviewedAt,
});

const cardOf = async (key: string, type: string) =>
  (await env.DB.prepare('SELECT c.* FROM cards c JOIN concepts k ON k.id = c.concept_id WHERE c.user_id = ?1 AND k.key = ?2 AND c.type = ?3')
    .bind(user.id, key, type)
    .first<Record<string, any>>())!;

beforeEach(async () => {
  user = await newUser();
});

describe('today and queue', () => {
  it('starts empty', async () => {
    const today = (await (await api(user, '/today')).json()) as TodayResponse;
    expect(today).toEqual({ remaining: 0, minutes: 0, parts: { wrong: 0, fresh: 0 }, mistakes: 0, reviewed_today: 0, sessions: [], followups: [], reminders_set: false, push_lost: false });
  });

  it('serves one card per concept with answers for on-device grading', async () => {
    await saveExample();
    const queue = (await (await api(user, '/queue?size=8')).json()) as QueueResponse;
    expect(queue.remaining).toBe(3);
    // 대화에서 온 새 카드라 틀린 것은 없다
    expect(((await (await api(user, '/today')).json()) as TodayResponse).parts).toEqual({ wrong: 0, fresh: 3 });
    expect(queue.cards.map((card) => card.concept_key).sort()).toEqual(['deep-copy', 'final-variable', 'immutable-object']);
    const mcq = queue.cards.find((card) => card.type === 'mcq')!;
    expect(mcq.options!.filter((option) => option.correct)).toHaveLength(1);
    expect(mcq.options!.some((option) => option.from_my_answer)).toBe(true);

    const today = (await (await api(user, '/today')).json()) as TodayResponse;
    expect(today).toMatchObject({ remaining: 3, minutes: 1, sessions: [{ topic: example.topic, concepts: 5, cards: 5 }] });
    expect(today.followups.map((followup) => followup.concept_name).sort()).toEqual(['깊은 복사', '방어적 복사']);
  });

  it('closes old questions when the concept is judged again, and lets me close one myself', async () => {
    await saveExample();
    const openFor = async () => ((await (await api(user, '/today')).json()) as TodayResponse).followups;
    expect((await openFor()).map((followup) => followup.concept_name).sort()).toEqual(['깊은 복사', '방어적 복사']);

    // 깊은 복사를 다시 공부해 판정이 새로 들어오면 그 개념의 예전 질문은 닫힌다. 다른 개념의 질문과 이번 새 질문은 남는다
    await callTool(await mcpUrl(user), 'save_learning', {
      topic: '깊은 복사 다시',
      concepts: [{ key: 'deep-copy', name: '깊은 복사' }],
      judgments: [{ concept: 'deep-copy', label: '맞음', note: '이번에는 중첩 객체까지 복사했다.' }],
      followups: [{ concept: 'deep-copy', question: '순환 참조가 있으면 깊은 복사는 어떻게 하나요?' }],
      cards: [{ type: 'ox', concept: 'deep-copy', prompt: '깊은 복사는 중첩 객체도 새로 만든다.', answer: 'O', explain: '안쪽까지 새로 만든다.' }],
    });
    const open = await openFor();
    expect(open.map((followup) => followup.question).sort()).toEqual(['생성자에서 받은 리스트는 깊은 복사로 받아야 하나요?', '순환 참조가 있으면 깊은 복사는 어떻게 하나요?'].sort());

    // 직접 닫기: 남의 질문은 닫지 못한다
    const target = open[0]!;
    expect((await api(await newUser(), `/followups/${target.id}`, { method: 'PATCH' })).status).toBe(404);
    expect((await api(user, `/followups/${target.id}`, { method: 'PATCH' })).status).toBe(204);
    expect((await api(user, `/followups/${target.id}`, { method: 'PATCH' })).status).toBe(404);
    expect((await openFor()).map((followup) => followup.id)).not.toContain(target.id);
  });

  it('records answers once and keeps the rest of a reviewed concept for another day', async () => {
    await saveExample();
    const { cards } = (await (await api(user, '/queue')).json()) as QueueResponse;
    const runId = crypto.randomUUID();
    const reviews = cards.map((card) => ({ ...answer(card.id, 3), run_id: runId }));
    const first = await api(user, '/reviews', { method: 'POST', json: { reviews } });
    expect(await first.json()).toEqual({ recorded: 3, skipped: 0, rejected: 0, unlocked: 0, level_ups: [] });
    // 무실수 보너스를 세는 복습 묶음이 기록에 남는다
    expect(await env.DB.prepare('SELECT count(*) AS n FROM review_logs WHERE user_id = ?1 AND run_id = ?2').bind(user.id, runId).first('n')).toBe(3);
    const again = await api(user, '/reviews', { method: 'POST', json: { reviews } });
    expect(await again.json()).toEqual({ recorded: 0, skipped: 3, rejected: 0, unlocked: 0, level_ups: [] });

    const today = (await (await api(user, '/today')).json()) as TodayResponse;
    expect(today).toMatchObject({ remaining: 0, reviewed_today: 3 });
  });

  it('brings a failed card back the next day, not minutes later, and not other cards of the concept', async () => {
    await saveExample();
    const now = Date.now();
    const ox = await cardOf('final-variable', 'ox');
    await recordReviews(env, user.id, [answer(ox.id, 1, now)], now);
    // 분 단위 학습 단계가 없어서 같은 날에는 다시 나오지 않는다
    expect((await loadTodayQueue(env, user.id, now + 60 * 60_000)).map((card) => card.id)).not.toContain(ox.id);
    const tomorrow = await loadTodayQueue(env, user.id, now + 25 * 60 * 60_000);
    expect(tomorrow.filter((card) => card.concept_key === 'final-variable').map((card) => card.id)).toEqual([ox.id]);
  });

  it('limits new cards per day', async () => {
    await env.DB.prepare('UPDATE users SET daily_new_limit = 1 WHERE id = ?1').bind(user.id).run();
    await saveExample();
    expect(await loadTodayQueue(env, user.id, Date.now())).toHaveLength(1);
  });

  it('keeps overdue reviews in the queue even with hundreds of old new cards', async () => {
    const sessionId = await saveExample();
    const now = Date.now();
    const mcq = await cardOf('deep-copy', 'mcq');
    await env.DB.prepare('UPDATE cards SET state = 2, stability = 3, difficulty = 5, reps = 3, last_review = ?2, due = ?3 WHERE id = ?1')
      .bind(mcq.id, now - 4 * 86_400_000, now - 3_600_000)
      .run();
    const old = now - 20 * 86_400_000;
    const statements = [];
    for (let i = 0; i < 300; i++) {
      const conceptId = crypto.randomUUID();
      statements.push(
        env.DB.prepare('INSERT INTO concepts (id, user_id, key, name, search_text, created_at, updated_at) VALUES (?1, ?2, ?3, ?3, ?3, ?4, ?4)').bind(conceptId, user.id, `k${i}`, old),
        env.DB.prepare(
          `INSERT INTO cards (id, user_id, concept_id, session_id, rung, type, prompt, answer, explain, status, due, stability, difficulty,
                              elapsed_days, scheduled_days, learning_steps, reps, lapses, state, last_review, created_at)
           VALUES (?1, ?2, ?3, ?4, 1, 'ox', 'p', 'O', 'e', 'active', ?5, 0, 0, 0, 0, 0, 0, 0, 0, NULL, ?5)`,
        ).bind(crypto.randomUUID(), user.id, conceptId, sessionId, old + i),
      );
    }
    for (let i = 0; i < statements.length; i += 50) await env.DB.batch(statements.slice(i, i + 50));
    expect((await loadTodayQueue(env, user.id, now)).map((card) => card.id)).toContain(mcq.id);
    await env.DB.prepare('UPDATE users SET daily_new_limit = 0 WHERE id = ?1').bind(user.id).run();
    expect((await loadTodayQueue(env, user.id, now)).map((card) => card.id)).toEqual([mcq.id]);
  });

  it('records the good answers in a batch and drops only the malformed ones', async () => {
    await saveExample();
    const mcq = await cardOf('deep-copy', 'mcq');
    const reviews = [{ ...answer(mcq.id, 3), elapsed_ms: 5 * 3_600_000 }, { ...answer(mcq.id, 3), grade: 9 }, 'not an answer'];
    const response = await api(user, '/reviews', { method: 'POST', json: { reviews } });
    expect(await response.json()).toEqual({ recorded: 1, skipped: 0, rejected: 2, unlocked: 0, level_ups: [] });
    const log = await env.DB.prepare('SELECT elapsed_ms FROM review_logs WHERE card_id = ?1').bind(mcq.id).first('elapsed_ms');
    expect(log).toBe(3_600_000);
  });

  it('grades a card once when the same answer id appears twice in one request', async () => {
    await saveExample();
    const mcq = await cardOf('deep-copy', 'mcq');
    const once = answer(mcq.id, 3);
    expect(await recordReviews(env, user.id, [once, once], Date.now())).toMatchObject({ recorded: 1, skipped: 1 });
    expect((await cardOf('deep-copy', 'mcq')).reps).toBe(1);
  });

  it('grades again on the fresh card when another device answered it in between', async () => {
    await saveExample();
    const mcq = await cardOf('deep-copy', 'mcq');
    const now = Date.now();
    // 이 기기가 카드를 읽은 직후, 다른 기기(폰)의 답이 먼저 기록된다
    let raced = false;
    const db = new Proxy(env.DB, {
      get(target, prop) {
        if (prop === 'batch') {
          return async (statements: D1PreparedStatement[]) => {
            const results = await target.batch(statements);
            if (!raced) {
              raced = true;
              await recordReviews(env, user.id, [answer(mcq.id, 3, now - 1000)], now);
            }
            return results;
          };
        }
        const value = Reflect.get(target, prop);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    expect(await recordReviews({ ...env, DB: db }, user.id, [answer(mcq.id, 1, now)], now)).toMatchObject({ recorded: 1, skipped: 0 });
    const card = await cardOf('deep-copy', 'mcq');
    // 두 답이 모두 반영됐다. 나중 답(틀림)이 앞의 답을 덮어쓰지 않고 이어서 채점됐다
    expect(card.reps).toBe(2);
    // 앞의 맞음으로 복습 단계가 된 카드를 틀렸다
    expect(card.lapses).toBe(1);
    const logs = await env.DB.prepare('SELECT grade FROM review_logs WHERE card_id = ?1 ORDER BY reviewed_at').bind(mcq.id).all<{ grade: number }>();
    expect(logs.results.map((log) => log.grade)).toEqual([3, 1]);
  });

  it('rejects more than 20 answers at once', async () => {
    const reviews = Array.from({ length: 21 }, () => answer(crypto.randomUUID(), 3));
    expect((await api(user, '/reviews', { method: 'POST', json: { reviews } })).status).toBe(400);
  });

  it("ignores answers for another user's card", async () => {
    await saveExample();
    const card = await cardOf('deep-copy', 'mcq');
    const other = await newUser();
    const response = await api(other, '/reviews', { method: 'POST', json: { reviews: [answer(card.id, 3)] } });
    expect(await response.json()).toEqual({ recorded: 0, skipped: 1, rejected: 0, unlocked: 0, level_ups: [] });
  });
});

describe('card ladder', () => {
  async function addLockedCloze() {
    await callTool(await mcpUrl(user), 'save_learning', {
      topic: '깊은 복사',
      concepts: [{ key: 'deep-copy', name: '깊은 복사' }],
      cards: [{ type: 'cloze', concept: 'deep-copy', prompt: '깊은 복사는 ____까지 새로 만든다.', answer: '내부 객체', choices: ['내부 객체', '참조', '변수'], explain: '참조만 복사하면 얕은 복사다.' }],
    });
    expect((await cardOf('deep-copy', 'cloze')).status).toBe('locked');
  }

  it('opens the next rung once every card of the open rung is stable for 7 days', async () => {
    await saveExample();
    await addLockedCloze();
    const mcq = await cardOf('deep-copy', 'mcq');
    const now = Date.now();
    await env.DB.prepare('UPDATE cards SET state = 2, stability = 30, difficulty = 5, reps = 3, last_review = ?2, due = ?2 WHERE id = ?1')
      .bind(mcq.id, now - 20 * 86_400_000)
      .run();
    // 끝 화면의 LEVEL UP에 쓰는 개념 이름과 새로 열린 단계
    expect(await recordReviews(env, user.id, [answer(mcq.id, 3, now)], now)).toMatchObject({
      recorded: 1,
      unlocked: 1,
      level_ups: [{ concept_key: 'deep-copy', concept_name: '깊은 복사', rung: 2 }],
    });
    expect(await cardOf('deep-copy', 'cloze')).toMatchObject({ status: 'active', due: now });
  });

  it('keeps the next rung locked while the open rung is still fresh', async () => {
    await saveExample();
    await addLockedCloze();
    const mcq = await cardOf('deep-copy', 'mcq');
    expect(await recordReviews(env, user.id, [answer(mcq.id, 3)], Date.now())).toMatchObject({ unlocked: 0 });
    expect((await cardOf('deep-copy', 'cloze')).status).toBe('locked');
  });

  it('opens the next rung when the only open card is turned off, and turns it back on', async () => {
    await saveExample();
    await addLockedCloze();
    const mcq = await cardOf('deep-copy', 'mcq');
    expect((await api(user, `/cards/${mcq.id}/suspend`, { method: 'POST' })).status).toBe(204);
    expect((await cardOf('deep-copy', 'mcq')).status).toBe('suspended');
    expect((await cardOf('deep-copy', 'cloze')).status).toBe('active');
    expect((await loadTodayQueue(env, user.id, Date.now())).map((card) => card.id)).not.toContain(mcq.id);

    expect((await api(user, `/cards/${mcq.id}/unsuspend`, { method: 'POST' })).status).toBe(204);
    expect((await cardOf('deep-copy', 'mcq')).status).toBe('active');
  });

  it('puts a locked card back to locked when it is turned on again', async () => {
    await saveExample();
    await addLockedCloze();
    const cloze = await cardOf('deep-copy', 'cloze');
    await api(user, `/cards/${cloze.id}/suspend`, { method: 'POST' });
    await api(user, `/cards/${cloze.id}/unsuspend`, { method: 'POST' });
    expect((await cardOf('deep-copy', 'cloze')).status).toBe('locked');
    expect((await cardOf('deep-copy', 'mcq')).status).toBe('active');
  });

  it('opens the explain card when the lower rungs are done, and serves it with interval previews', async () => {
    await saveExample();
    expect((await cardOf('immutable-object', 'explain')).status).toBe('locked');
    const ox = await cardOf('immutable-object', 'ox');
    await api(user, `/cards/${ox.id}/suspend`, { method: 'POST' });
    const explain = await cardOf('immutable-object', 'explain');
    expect(explain.status).toBe('active');
    const queued = (await loadTodayQueue(env, user.id, Date.now())).find((card) => card.id === explain.id)!;
    expect(queued).toMatchObject({ type: 'explain', checklist: expect.any(Array), final_answer: expect.any(String) });
    expect(queued.intervals!['1']).toBeLessThan(queued.intervals!['3']);
  });

  it('undoes only the latest grade of a card and restores its state', async () => {
    await saveExample();
    const mcq = await cardOf('deep-copy', 'mcq');
    const first = answer(mcq.id, 3, Date.now() - 1000);
    const second = answer(mcq.id, 1);
    await api(user, '/reviews', { method: 'POST', json: { reviews: [first, second] } });
    expect((await api(user, `/reviews/${first.id}/undo`, { method: 'POST' })).status).toBe(404);
    expect((await api(user, `/reviews/${second.id}/undo`, { method: 'POST' })).status).toBe(204);
    const card = await cardOf('deep-copy', 'mcq');
    expect(card).toMatchObject({ reps: 1, lapses: 0 });
    const logs = await env.DB.prepare('SELECT id FROM review_logs WHERE card_id = ?1').bind(mcq.id).all<{ id: string }>();
    expect(logs.results.map((log) => log.id)).toEqual([first.id]);
    // 남의 기록은 되돌릴 수 없다
    expect((await api(await newUser(), `/reviews/${first.id}/undo`, { method: 'POST' })).status).toBe(404);
  });

  it('undoes only the answer applied last when two answers share a time', async () => {
    await saveExample();
    const mcq = await cardOf('deep-copy', 'mcq');
    const now = Date.now();
    const phone = answer(mcq.id, 3, now);
    await api(user, '/reviews', { method: 'POST', json: { reviews: [phone] } });
    // 오프라인이던 PC의 더 오래된 답은 마지막 복습 시각으로 잘려 같은 시각이 된다
    const pc = answer(mcq.id, 1, now - 60_000);
    await api(user, '/reviews', { method: 'POST', json: { reviews: [pc] } });
    expect((await api(user, `/reviews/${phone.id}/undo`, { method: 'POST' })).status).toBe(404);
    expect((await api(user, `/reviews/${pc.id}/undo`, { method: 'POST' })).status).toBe(204);
    expect((await cardOf('deep-copy', 'mcq')).reps).toBe(1);
  });

  it("returns 404 for another user's card and leaves it as it was", async () => {
    await saveExample();
    const card = await cardOf('final-variable', 'ox');
    const edit = { type: 'ox', prompt: '남이 바꾼 문제', answer: 'O', explain: '남이 바꾼 해설' };
    const stranger = await newUser();
    expect((await api(stranger, `/cards/${card.id}/suspend`, { method: 'POST' })).status).toBe(404);
    expect((await api(stranger, `/cards/${card.id}`, { method: 'PATCH', json: edit })).status).toBe(404);
    expect(await cardOf('final-variable', 'ox')).toEqual(card);
    // 같은 내용을 주인이 보내면 고쳐진다
    expect((await api(user, `/cards/${card.id}`, { method: 'PATCH', json: edit })).status).toBe(204);
    expect((await cardOf('final-variable', 'ox')).prompt).toBe('남이 바꾼 문제');
  });
});

describe('saved sessions', () => {
  it('lists sessions and shows concepts, judgments, cards and follow-ups', async () => {
    const id = await saveExample();
    const list = (await (await api(user, '/sessions')).json()) as { sessions: { id: string }[] };
    expect(list.sessions.map((session) => session.id)).toEqual([id]);

    const detail = (await (await api(user, `/sessions/${id}`)).json()) as SessionDetail;
    expect(detail).toMatchObject({ topic: example.topic, final_answer: example.final_answer, key_terms: example.key_terms });
    expect(detail.concepts.map((concept) => concept.key).sort()).toEqual(['deep-copy', 'defensive-copy', 'final-variable', 'immutable-object']);
    expect(detail.judgments.map((judgment) => judgment.label)).toEqual(['틀림', '애매']);
    expect(detail.cards).toHaveLength(5);
    expect(detail.cards.find((card) => card.type === 'cloze')!.choices).toHaveLength(4);
    expect(detail.cards.find((card) => card.type === 'explain')).toMatchObject({ status: 'locked', checklist: expect.any(Array) });
    expect(detail.followups).toHaveLength(2);

    expect((await api(await newUser(), `/sessions/${id}`)).status).toBe(404);
  });
});

// 틀린 것: 다시 푼 답이 일정에 들어가므로(되돌리지 않는다) 고르는 규칙을 확인해 둔다
describe('mistakes', () => {
  it('lists cards whose last answer in 30 days was wrong, except ones answered today', async () => {
    await saveExample();
    const cards = (await env.DB.prepare("SELECT id FROM cards WHERE user_id = ?1 AND status = 'active' ORDER BY id LIMIT 4").bind(user.id).all<{ id: string }>())
      .results.map((row) => row.id);
    const now = Date.now();
    const log = (cardId: string, grade: number, daysAgo: number) =>
      env.DB.prepare("INSERT INTO review_logs (id, user_id, card_id, grade, reviewed_at, prev_card) VALUES (?1, ?2, ?3, ?4, ?5, '{}')")
        .bind(crypto.randomUUID(), user.id, cardId, grade, now - daysAgo * 86_400_000)
        .run();
    await log(cards[0]!, 1, 2); // 이틀 전에 틀림 → 나온다
    await log(cards[1]!, 1, 3); // 틀렸다가
    await log(cards[1]!, 3, 1); // 어제 맞힘 → 안 나온다
    await log(cards[2]!, 1, 40); // 30일보다 전 → 안 나온다
    await log(cards[3]!, 1, 0); // 오늘 틀림 → 안 나온다 (방금 정답을 봤다)

    const mistakes = (await (await api(user, '/queue?mode=mistakes')).json()) as QueueResponse;
    expect(mistakes.cards.map((card) => card.id)).toEqual([cards[0]]);
    expect(mistakes.remaining).toBe(1);
    const today = (await (await api(user, '/today')).json()) as TodayResponse;
    expect(today.mistakes).toBe(1);
    expect((await (await api(await newUser(), '/queue?mode=mistakes')).json()) as QueueResponse).toEqual({ cards: [], remaining: 0 });
  });
});

describe('random exam', () => {
  it('draws only cards I have answered, never explain cards, and never anyone else\'s', async () => {
    await saveExample();
    expect(((await (await api(user, '/queue?mode=random')).json()) as QueueResponse).remaining).toBe(0);
    const { cards } = (await (await api(user, '/queue')).json()) as QueueResponse;
    await api(user, '/reviews', { method: 'POST', json: { reviews: cards.map((card) => answer(card.id, 3)) } });
    const exam = (await (await api(user, '/queue?mode=random&size=20')).json()) as QueueResponse;
    expect(exam.remaining).toBe(cards.filter((card) => card.type !== 'explain').length);
    expect(exam.cards.every((card) => card.type !== 'explain' && cards.some((answered) => answered.id === card.id))).toBe(true);
    expect(((await (await api(await newUser(), '/queue?mode=random')).json()) as QueueResponse).remaining).toBe(0);
  });
});
