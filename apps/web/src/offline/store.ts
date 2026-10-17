import { REVIEWS_PER_REQUEST } from '@moai/shared/client';
import type { QueueCard, ReviewItem } from '@moai/shared';
import { createStore, get, set, update } from 'idb-keyval';
import { request } from '../api';

// 오프라인 답안 큐 (설계서 §9.5). 답은 먼저 IndexedDB에 넣고, 보내지면 지운다. 화면은 네트워크를 기다리지 않는다.

const store = createStore('moai', 'kv');
const OUTBOX = 'outbox';
const QUEUE = 'queue';

export async function enqueueReview(review: ReviewItem): Promise<void> {
  await update<ReviewItem[]>(OUTBOX, (items) => [...(items ?? []), review], store);
  void flushReviews();
}

export async function pendingReviews(): Promise<number> {
  return ((await get<ReviewItem[]>(OUTBOX, store)) ?? []).length;
}

let flushing: Promise<void> | null = null;

/** outbox를 20건씩 보낸다. 실패하면 남겨 두고 다음 기회(online 이벤트, 다음 실행)에 다시 보낸다. */
export function flushReviews(): Promise<void> {
  flushing ??= (async () => {
    try {
      for (;;) {
        const items = (await get<ReviewItem[]>(OUTBOX, store)) ?? [];
        if (items.length === 0) return;
        const batch = items.slice(0, REVIEWS_PER_REQUEST);
        await request('/reviews', { method: 'POST', json: { reviews: batch } });
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
  const answered = new Set(((await get<ReviewItem[]>(OUTBOX, store)) ?? []).map((item) => item.card_id));
  return cached.cards.filter((card) => !answered.has(card.id));
}

export async function forgetAnswered(cardIds: readonly string[]): Promise<void> {
  const done = new Set(cardIds);
  await update<CachedQueue | undefined>(QUEUE, (cached) => (cached ? { ...cached, cards: cached.cards.filter((card) => !done.has(card.id)) } : cached), store);
}
