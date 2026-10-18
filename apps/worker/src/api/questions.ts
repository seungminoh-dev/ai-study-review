import { ShareQuestionBody, type SharedQuestion } from '@moai/shared';
import { Hono } from 'hono';
import type { AppEnv } from '../context';
import { errorJson, readJson } from '../lib/http';

// 질문 은행 (설계서 §2.4): 친구끼리 질문만 공유한다. 사용자가 고른 질문과 개념 이름만 저장하고, 답·판정·카드는 넣지 않는다.

export const questions = new Hono<AppEnv>();

/** 한 사람이 공유해 둘 수 있는 질문 수 */
const MAX_SHARED_PER_USER = 200;

const promptOf = (question: string) => `[질문 은행] ${question} 먼저 제 말로 답해 볼게요. 제 답을 듣고 꼬리질문해 주세요.`;

questions.get('/shared-questions', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT q.id, q.concept_name, q.question, q.created_at, q.user_id = ?1 AS mine, u.display_name AS by
       FROM shared_questions q JOIN users u ON u.id = q.user_id ORDER BY q.created_at DESC LIMIT 100`,
  )
    .bind(c.var.userId)
    .all<Omit<SharedQuestion, 'prompt' | 'mine'> & { mine: number }>();
  return c.json({ questions: results.map((row) => ({ ...row, mine: row.mine === 1, prompt: promptOf(row.question) })) satisfies SharedQuestion[] });
});

questions.post('/shared-questions', async (c) => {
  const body = await readJson(c, ShareQuestionBody);
  if (body instanceof Response) return body;
  // 같은 질문은 한 번만, 사람마다 상한까지. 세기와 넣기를 한 문장으로 한다
  const inserted = await c.env.DB.prepare(
    `INSERT INTO shared_questions (id, user_id, concept_name, question, created_at)
     SELECT ?1, ?2, ?3, ?4, ?5 WHERE (SELECT count(*) FROM shared_questions WHERE user_id = ?2) < ?6
     ON CONFLICT (user_id, question) DO NOTHING`,
  )
    .bind(crypto.randomUUID(), c.var.userId, body.concept_name, body.question, Date.now(), MAX_SHARED_PER_USER)
    .run();
  if (inserted.meta.changes === 0) {
    const exists = await c.env.DB.prepare('SELECT 1 FROM shared_questions WHERE user_id = ?1 AND question = ?2').bind(c.var.userId, body.question).first();
    if (!exists) return errorJson(429, 'too_many', `질문은 ${MAX_SHARED_PER_USER}개까지 공유할 수 있어요. 오래된 것을 지워 주세요.`);
  }
  return c.body(null, 204);
});

questions.delete('/shared-questions/:id', async (c) => {
  const removed = await c.env.DB.prepare('DELETE FROM shared_questions WHERE id = ?1 AND user_id = ?2').bind(c.req.param('id'), c.var.userId).run();
  return removed.meta.changes > 0 ? c.body(null, 204) : errorJson(404, 'not_found', '지울 수 있는 질문이 없어요.');
});
