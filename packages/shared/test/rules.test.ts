import { describe, expect, it } from 'vitest';
import { PushSubscriptionBody, RemindersBody, ReviewItem, ReviewsBody, estimateMinutes, gradeAnswer, normalizeSearch, searchTerms, searchText } from '../src';

describe('gradeAnswer with confidence', () => {
  it('treats a lucky guess and an unsure hit as hard, never as a miss', () => {
    expect(gradeAnswer({ correct: true, elapsedMs: 2_000, confidence: 'guess' })).toBe(2);
    expect(gradeAnswer({ correct: true, elapsedMs: 2_000, confidence: 'unsure', easy: true })).toBe(2);
    expect(gradeAnswer({ correct: true, elapsedMs: 2_000, confidence: 'sure' })).toBe(3);
    expect(gradeAnswer({ correct: false, elapsedMs: 2_000, confidence: 'sure' })).toBe(1);
  });
});

describe('gradeAnswer (설계서 §9.3)', () => {
  it('maps on-device results to FSRS grades', () => {
    expect(gradeAnswer({ correct: false, elapsedMs: 2_000 })).toBe(1);
    expect(gradeAnswer({ correct: false, elapsedMs: 2_000, easy: true })).toBe(1);
    expect(gradeAnswer({ correct: true, elapsedMs: 16_000 })).toBe(2);
    expect(gradeAnswer({ correct: true, elapsedMs: 15_000 })).toBe(3);
    // 빨리 맞혔다고 쉬움을 주지 않는다. 쉬움은 사용자가 누를 때만이다
    expect(gradeAnswer({ correct: true, elapsedMs: 900 })).toBe(3);
    expect(gradeAnswer({ correct: true, elapsedMs: 30_000, easy: true })).toBe(4);
  });

  it('estimates minutes at about 3 minutes per 8 cards', () => {
    expect(estimateMinutes(0)).toBe(0);
    expect(estimateMinutes(1)).toBe(1);
    expect(estimateMinutes(8)).toBe(3);
  });
});

describe('concept search normalization (설계서 §6.6)', () => {
  it('drops spaces, symbols and case', () => {
    expect(normalizeSearch('깊은 복사')).toBe('깊은복사');
    expect(normalizeSearch('Deep-Copy!')).toBe('deepcopy');
    expect(normalizeSearch('ＨａｓｈＭａｐ')).toBe('hashmap');
  });

  it('joins names with pipes and splits queries by commas', () => {
    expect(searchText(['깊은 복사', '깊은복사', 'deep-copy'])).toBe('|깊은복사|deepcopy|');
    expect(searchTerms('깊은 복사, 얕은복사,, 깊은복사\nHashMap')).toEqual(['깊은복사', '얕은복사', 'hashmap']);
  });
});

describe('API bodies', () => {
  const review = { id: '3b241101-e2bb-4255-8caf-4136c566a962', card_id: '1f0e5b1a-7c3d-4e2f-9a8b-6c5d4e3f2a1b', grade: 3, reviewed_at: 1_760_000_000_000 };

  it('accepts up to 20 answers per request', () => {
    expect(ReviewsBody.safeParse({ reviews: [review] }).success).toBe(true);
    expect(ReviewsBody.safeParse({ reviews: Array(21).fill(review) }).success).toBe(false);
  });

  it('checks each answer, clamping a long think time instead of rejecting it', () => {
    expect(ReviewItem.safeParse({ ...review, grade: 5 }).success).toBe(false);
    expect(ReviewItem.parse({ ...review, elapsed_ms: 5 * 60 * 60 * 1000 }).elapsed_ms).toBe(60 * 60 * 1000);
    expect(ReviewItem.parse({ ...review, elapsed_ms: 1234.6 }).elapsed_ms).toBe(1235);
  });

  it('only accepts push keys of the right size', () => {
    const endpoint = 'https://push.example/x';
    expect(PushSubscriptionBody.safeParse({ endpoint, keys: { p256dh: 'A'.repeat(87), auth: 'B'.repeat(22) } }).success).toBe(true);
    expect(PushSubscriptionBody.safeParse({ endpoint, keys: { p256dh: 'AAAA', auth: 'B'.repeat(22) } }).success).toBe(false);
  });

  it('accepts up to three distinct HH:MM reminder times', () => {
    expect(RemindersBody.safeParse({ times: ['08:10', '22:30'] }).success).toBe(true);
    expect(RemindersBody.safeParse({ times: ['8:10'] }).success).toBe(false);
    expect(RemindersBody.safeParse({ times: ['08:10', '08:10'] }).success).toBe(false);
  });
});
