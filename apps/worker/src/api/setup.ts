import { SetupBody, type Me } from '@moai/shared';
import { Hono } from 'hono';
import { startSession } from '../auth/session';
import type { AppEnv } from '../context';
import { safeEqual } from '../lib/crypto';
import { errorJson, readJson } from '../lib/http';

// 오너 계정 만들기 (설계서 §8.3). 로그인 전에 쓰는 유일한 API다.

export const setup = new Hono<AppEnv>();

const ownerExists = (c: { env: AppEnv['Bindings'] }) => c.env.DB.prepare("SELECT 1 FROM users WHERE role = 'owner' LIMIT 1").first();

setup.get('/', async (c) => c.json({ available: (await ownerExists(c)) === null }));

setup.post('/', async (c) => {
  const body = await readJson(c, SetupBody);
  if (body instanceof Response) return body;
  if (await ownerExists(c)) return errorJson(410, 'already_set_up', '이미 오너 계정이 있어요.');
  if (!c.env.BOOTSTRAP_CODE || !c.env.TOKEN_PEPPER) {
    return errorJson(503, 'setup_unavailable', '서버에 BOOTSTRAP_CODE와 TOKEN_PEPPER secret을 먼저 넣어 주세요.');
  }
  if (!(await safeEqual(body.code, c.env.BOOTSTRAP_CODE))) return errorJson(403, 'wrong_code', '설정 코드가 맞지 않아요.');

  const now = Date.now();
  const me: Me = { id: crypto.randomUUID(), display_name: body.display_name, role: 'owner', daily_new_limit: 10, daily_review_limit: 30, github_login: null };
  // 동시에 두 번 눌러도 오너는 한 명만 생긴다
  const inserted = await c.env.DB.prepare(
    "INSERT INTO users (id, display_name, role, created_at) SELECT ?1, ?2, 'owner', ?3 WHERE NOT EXISTS (SELECT 1 FROM users WHERE role = 'owner')",
  )
    .bind(me.id, me.display_name, now)
    .run();
  if (inserted.meta.changes === 0) return errorJson(410, 'already_set_up', '이미 오너 계정이 있어요.');
  await startSession(c, me.id, now);
  return c.json(me, 201);
});
