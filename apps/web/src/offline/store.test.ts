import 'fake-indexeddb/auto';
import type { ReviewItem } from '@moai/shared';
import { beforeEach, expect, it, vi } from 'vitest';
import { claimDevice, clearDeviceData, enqueueReview, flushReviews, pendingCount, releaseDevice, removeFromOutbox } from './store';

const review = (id: string): ReviewItem => ({ id, card_id: `card-${id}`, grade: 3, elapsed_ms: 1000, reviewed_at: 1, run_id: 'run' });

/** 서버에 닿은 요청의 답 id 묶음 */
let batches: string[][] = [];
/** 다음 요청들이 받을 응답. 비면 200 */
let replies: (number | 'offline')[] = [];
const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
  const reply = replies.shift() ?? 200;
  if (reply === 'offline') throw new TypeError('Failed to fetch');
  batches.push((JSON.parse(String(init?.body)) as { reviews: ReviewItem[] }).reviews.map((item) => item.id));
  return reply === 200 ? Response.json({}) : Response.json({ error: { code: 'invalid_input', message: '잘못된 답' } }, { status: reply });
});
vi.stubGlobal('fetch', fetchMock);

beforeEach(async () => {
  await clearDeviceData();
  batches = [];
  replies = [];
  await claimDevice('u1');
  await flushReviews();
});

it('오프라인이면 답을 남기고, 되돌리면 기기에서만 지운다', async () => {
  replies = ['offline', 'offline', 'offline'];
  await enqueueReview(review('a'));
  await enqueueReview(review('b'));
  await flushReviews();
  expect(await pendingCount()).toBe(2);
  expect(await removeFromOutbox('a')).toBe(true);
  expect(await pendingCount()).toBe(1);
  expect(batches).toEqual([]);
});

it('20건씩 나눠 보내고, 서버가 받지 않는 묶음(400)만 버린다', async () => {
  // 로그인을 확인하기 전에는 보내지 않으니 한꺼번에 쌓인다
  releaseDevice();
  for (let i = 0; i < 45; i++) await enqueueReview(review(`r${i}`));
  replies = [400];
  await claimDevice('u1');
  await flushReviews();
  expect(batches.map((ids) => ids.length)).toEqual([20, 20, 5]);
  expect(await pendingCount()).toBe(0);
});

it('다른 사람이 로그인하면 앞사람의 답을 보내지 않고 지운다', async () => {
  replies = ['offline'];
  await enqueueReview(review('a'));
  await flushReviews();
  expect(await claimDevice('u2')).toBe(true);
  await flushReviews();
  expect(await pendingCount()).toBe(0);
  expect(batches).toEqual([]);
});

it('보내는 중에 되돌려도, 서버가 받은 답을 기기에서만 지웠다고 답하지 않는다', async () => {
  // 첫 전송은 끊기고, 끝나자마자 다시 보낸다 (online 이벤트처럼)
  replies = ['offline'];
  await enqueueReview(review('x'));
  const again = flushReviews().then(() => flushReviews());
  const removedLocally = await removeFromOutbox('x');
  await again;
  const reached = batches.flat().includes('x');
  expect(removedLocally).toBe(!reached);
  expect(reached).toBe(true);
});
