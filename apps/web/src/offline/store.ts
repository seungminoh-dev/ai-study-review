import { REVIEWS_PER_REQUEST } from '@moai/shared/client';
import type { LevelUp, QueueCard, ReviewItem, ReviewsResponse } from '@moai/shared';
import { clear, createStore, get, set, update } from 'idb-keyval';
import { RequestError, request } from '../api';

// 오프라인 답안 큐 (설계서 §9.5). 답은 먼저 IndexedDB에 넣고, 보내지면 지운다. 화면은 네트워크를 기다리지 않는다.

const store = createStore('moai', 'kv');
const OUTBOX = 'outbox';
const QUEUE = 'queue';
/** 이 기기의 답과 큐를 남긴 사람의 id */
const OWNER = 'owner';

/** 이번 실행에서 서버로 로그인을 확인한 사람. 확인하기 전에는 답을 보내지 않는다. 앞사람의 답이 새 사람 쿠키로 가지 않게 */
let confirmed: string | null = null;

/**
 * 로그인한 사람을 이 기기 데이터의 주인으로 적고 밀린 답을 보낸다.
 * 세션이 끝난 뒤 다른 사람이 로그인했으면 앞사람이 남긴 답과 큐를 지우고 true. 같은 사람이면 못 보낸 답을 이어서 보낸다.
 */
export async function claimDevice(userId: string): Promise<boolean> {
  const owner = await get<string>(OWNER, store);
  // 주인을 적기 전 버전이 남긴 데이터는 지금 사람의 것으로 본다
  const switched = owner !== undefined && owner !== userId;
  if (switched) await clear(store);
  if (owner !== userId) await set(OWNER, userId, store);
  confirmed = userId;
  void flushReviews();
  return switched;
}

export async function enqueueReview(review: ReviewItem): Promise<void> {
  await update<ReviewItem[]>(OUTBOX, (items) => [...(items ?? []), review], store);
  void flushReviews();
}

/** 아직 서버에 보내지 못한 답 수 */
export async function pendingCount(): Promise<number> {
  return ((await get<ReviewItem[]>(OUTBOX, store)) ?? []).length;
}

/** 세션이 끝났다(401). 다시 로그인을 확인할 때까지 답을 보내지 않고 기기에 남겨 둔다 */
export function releaseDevice(): void {
  confirmed = null;
}

/** 로그아웃할 때 이 기기에 남은 답과 큐를 지운다. 다음에 로그인한 사람에게 섞이지 않게 한다 */
export async function clearDeviceData(): Promise<void> {
  confirmed = null;
  await clear(store);
}

/**
 * 아직 보내지 않은 답이면 outbox에서 지우고 true. 이미 보냈으면 false.
 * 보내는 중인 묶음에 들어 있을 수 있으니, 진행 중인 전송이 끝난 뒤에 본다.
 */
export async function removeFromOutbox(id: string): Promise<boolean> {
  await flushing?.catch(() => undefined);
  let removed = false;
  await update<ReviewItem[]>(
    OUTBOX,
    (items) => {
      const rest = (items ?? []).filter((item) => item.id !== id);
      removed = rest.length !== (items ?? []).length;
      return rest;
    },
    store,
  );
  return removed;
}

/** 아직 서버에 보내지 못한 답의 카드 id */
export async function pendingCardIds(): Promise<Set<string>> {
  return new Set(((await get<ReviewItem[]>(OUTBOX, store)) ?? []).map((item) => item.card_id));
}

/** 다시 보내도 받아 주지 않을 응답. 이런 묶음은 버려야 뒤의 답이 막히지 않는다 */
const isPermanent = (error: unknown) => error instanceof RequestError && (error.status === 400 || error.status === 413);

let flushing: Promise<void> | null = null;

/** 보낸 답으로 다음 단계가 열린 개념. 복습 끝 화면이 가져간다 (앱을 다시 열면 사라진다) */
let levelUps: LevelUp[] = [];

/** 모아 둔 LEVEL UP을 꺼내고 비운다. 복습을 시작할 때도 불러서 지난 것을 버린다 */
export function takeLevelUps(): LevelUp[] {
  const taken = levelUps;
  levelUps = [];
  return taken;
}

/** outbox를 20건씩 보낸다. 실패하면 남겨 두고 다음 기회(online 이벤트, 다음 실행)에 다시 보낸다. */
export function flushReviews(): Promise<void> {
  if (!confirmed) return Promise.resolve();
  flushing ??= (async () => {
    try {
      for (;;) {
        const items = (await get<ReviewItem[]>(OUTBOX, store)) ?? [];
        if (items.length === 0) return;
        const batch = items.slice(0, REVIEWS_PER_REQUEST);
        try {
          const result = await request<ReviewsResponse>('/reviews', { method: 'POST', json: { reviews: batch } });
          levelUps.push(...(result.level_ups ?? []));
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
