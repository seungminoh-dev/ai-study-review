import { CardEditBody, ReportBody } from '@moai/shared';
import { Hono } from 'hono';
import type { AppEnv } from '../context';
import { pickFsrsFields, type FsrsFields } from '../domain/fsrs';
import { setCardSuspended } from '../domain/reviews';
import { errorJson, readJson } from '../lib/http';
import { DAY_MS } from '../lib/kst';

// 카드 신고·고치기, 마지막 채점 되돌리기 (설계서 §2.3 7번)

export const cards = new Hono<AppEnv>();

/** 신고하면 그 카드는 바로 꺼진다. 신고는 카드 품질을 보려고 남긴다 */
cards.post('/cards/:id/report', async (c) => {
  const body = await readJson(c, ReportBody);
  if (body instanceof Response) return body;
  const now = Date.now();
  const cardId = c.req.param('id');
  const found = await setCardSuspended(c.env, c.var.userId, cardId, true, now);
  if (!found) return errorJson(404, 'not_found', '카드를 찾지 못했어요.');
  await c.env.DB.prepare('INSERT INTO card_reports (id, card_id, user_id, reason, note, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)')
    .bind(crypto.randomUUID(), cardId, c.var.userId, body.reason, body.note || null, now)
    .run();
  return c.body(null, 204);
});

/** 글자와 정답만 고친다. 종류가 다르면 거절한다. 복습 기록(FSRS 상태)은 그대로 둔다 */
cards.patch('/cards/:id', async (c) => {
  const body = await readJson(c, CardEditBody);
  if (body instanceof Response) return body;
  const columns =
    body.type === 'ox'
      ? { prompt: body.prompt, answer: body.answer, options: null, explain: body.explain, checklist: null }
      : body.type === 'mcq'
        ? { prompt: body.prompt, answer: null, options: JSON.stringify(body.options), explain: body.explain, checklist: null }
        : body.type === 'cloze'
          ? { prompt: body.prompt, answer: body.answer, options: JSON.stringify(body.choices), explain: body.explain, checklist: null }
          : { prompt: body.prompt, answer: null, options: null, explain: null, checklist: JSON.stringify(body.checklist) };
  const updated = await c.env.DB.prepare(
    `UPDATE cards SET prompt = ?3, answer = ?4, options = ?5, explain = ?6, checklist = ?7, edited_at = ?8
      WHERE id = ?1 AND user_id = ?2 AND type = ?9`,
  )
    .bind(c.req.param('id'), c.var.userId, columns.prompt, columns.answer, columns.options, columns.explain, columns.checklist, Date.now(), body.type)
    .run();
  if (updated.meta.changes === 0) return errorJson(404, 'not_found', '고칠 카드를 찾지 못했어요. 카드 종류는 바꿀 수 없어요.');
  return c.body(null, 204);
});

/** 되돌릴 수 있는 채점: 그 카드의 마지막 기록이고, 하루가 지나지 않았다 */
const UNDO_WINDOW_MS = DAY_MS;

/**
 * 방금 한 채점을 되돌린다. 기록을 지우고 카드를 채점 전 상태(prev_card)로 돌린다.
 * 그 사이 같은 카드를 다시 채점했으면(마지막 기록이 아니면) 되돌리지 않는다. 사다리로 열린 카드는 그대로 둔다.
 */
cards.post('/reviews/:id/undo', async (c) => {
  const userId = c.var.userId;
  const log = await c.env.DB.prepare(
    `SELECT r.id, r.card_id, r.reviewed_at, r.prev_card, c.reps
       FROM review_logs r JOIN cards c ON c.id = r.card_id
      WHERE r.id = ?1 AND r.user_id = ?2
        AND NOT EXISTS (SELECT 1 FROM review_logs later WHERE later.card_id = r.card_id AND later.reviewed_at > r.reviewed_at)
        -- 채점 시각은 같을 수 있다 (늦게 온 답은 마지막 복습 시각으로 자른다). 카드에 마지막으로 반영된 기록인지는 reps로 본다
        AND c.reps = json_extract(r.prev_card, '$.reps') + 1`,
  )
    .bind(c.req.param('id'), userId)
    .first<{ id: string; card_id: string; reviewed_at: number; prev_card: string; reps: number }>();
  if (!log) return errorJson(404, 'not_found', '되돌릴 채점이 없어요. 아직 보내지 않았거나 그 뒤에 다시 채점했어요.');
  if (Date.now() - log.reviewed_at > UNDO_WINDOW_MS) return errorJson(409, 'too_old', '하루가 지난 채점은 되돌릴 수 없어요.');

  const prev = pickFsrsFields(JSON.parse(log.prev_card) as FsrsFields);
  // 카드가 그 사이 바뀌지 않았을 때(reps가 같을 때)만 둘 다 쓴다
  const [restored] = await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE cards SET due = ?3, stability = ?4, difficulty = ?5, elapsed_days = ?6, scheduled_days = ?7, learning_steps = ?8,
              reps = ?9, lapses = ?10, state = ?11, last_review = ?12
        WHERE id = ?1 AND user_id = ?2 AND reps = ?13`,
    ).bind(
      log.card_id,
      userId,
      prev.due,
      prev.stability,
      prev.difficulty,
      prev.elapsed_days,
      prev.scheduled_days,
      prev.learning_steps,
      prev.reps,
      prev.lapses,
      prev.state,
      prev.last_review,
      log.reps,
    ),
    c.env.DB.prepare('DELETE FROM review_logs WHERE id = ?1 AND user_id = ?2 AND EXISTS (SELECT 1 FROM cards WHERE id = ?3 AND reps = ?4)').bind(
      log.id,
      userId,
      log.card_id,
      prev.reps,
    ),
  ]);
  if (restored!.meta.changes === 0) return errorJson(409, 'changed', '그 사이 카드가 바뀌어서 되돌리지 않았어요.');
  return c.body(null, 204);
});
