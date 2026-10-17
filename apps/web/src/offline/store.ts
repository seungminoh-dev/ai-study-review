import { REVIEWS_PER_REQUEST } from '@moai/shared/client';
import type { QueueCard, ReviewItem } from '@moai/shared';
import { clear, createStore, get, set, update } from 'idb-keyval';
import { RequestError, request } from '../api';

// 오프라인 답안 큐 (설계서 §9.5). 답은 먼저 IndexedDB에 넣고, 보내지면 지운다. 화면은 네트워크를 기다리지 않는다.

const store = createStore('moai', 'kv');
const OUTBOX = 'outbox';
const QUEUE = 'queue';

export async function enqueueReview(review: ReviewItem): Promise<void> {
  await update<ReviewItem[]>(OUTBOX, (items) => [...(items ?? []), review], store);
  void flushReviews();
}

/** 아직 서버에 보내지 못한 답 수 */
export async function pendingCount(): Promise<number> {
  return ((await get<ReviewItem[]>(OUTBOX, store)) ?? []).length;
}

/** 로그아웃할 때 이 기기에 남은 답과 큐를 지운다. 다음에 로그인한 사람에게 섞이지 않게 한다 */
export async function clearDeviceData(): Promise<void> {
  await clear(store);
}

/** 아직 서버에 보내지 못한 답의 카드 id */
export async function pendingCardIds(): Promise<Set<string>> {
  return new Set(((await get<ReviewItem[]>(OUTBOX, store)) ?? []).map((item) => item.card_id));
}

/** 다시 보내도 받아 주지 않을 응답. 이런 묶음은 버려야 뒤의 답이 막히지 않는다 */
const isPermanent = (error: unknown) => error instanceof RequestError && (error.status === 400 || error.status === 413);

let flushing: Promise<void> | null = null;

/** outbox를 20건씩 보낸다. 실패하면 남겨 두고 다음 기회(online 이벤트, 다음 실행)에 다시 보낸다. */
export function flushReviews(): Promise<void> {
  flushing ??= (async () => {
    try {
      for (;;) {
        const items = (await get<ReviewItem[]>(OUTBOX, store)) ?? [];
        if (items.length === 0) return;
        const batch = items.slice(0, REVIEWS_PER_REQUEST);
        try {
          await request('/reviews', { method: 'POST', json: { reviews: batch } });
        } catch (error) {
          if (!isPermanent(error)) throw error;
          console.warn('답안 묶음을 서버가 받지 않아서 버렸어요', error);
        }
        const sent = new Set(batch.map((item) => item.id));
        await update<ReviewItem[]>(OUTBOX, (current) => (current ?? []).filter((item) => !sent.has(item.id)), store);
      }
    } catch {
      // 오프라인이거나 서버 오류다. 답은 outbox에 남아 있다
    } finally {
      flushing = null;
    }
  })();
  return flushing;
}

interface CachedQueue {
  cards: QueueCard[];
  saved_at: number;
}

/** 받은 큐를 저장해 둔다. 지하철에서 연결이 끊겨도 이어서 풀 수 있다 */
export async function cacheQueue(cards: QueueCard[]): Promise<void> {
  await set(QUEUE, { cards, saved_at: Date.now() } satisfies CachedQueue, store);
}

/** 저장해 둔 큐에서 이미 답한(outbox에 있는) 카드를 뺀다. 오늘(12시간 안) 받은 것만 쓴다 */
export async function cachedQueue(): Promise<QueueCard[]> {
  const cached = await get<CachedQueue>(QUEUE, store);
  if (!cached || Date.now() - cached.saved_at > 12 * 60 * 60 * 1000) return [];
  const answered = await pendingCardIds();
  return cached.cards.filter((card) => !answered.has(card.id));
}

export async function forgetAnswered(cardIds: readonly string[]): Promise<void> {
  const done = new Set(cardIds);
  await update<CachedQueue | undefined>(QUEUE, (cached) => (cached ? { ...cached, cards: cached.cards.filter((card) => !done.has(card.id)) } : cached), store);
}
