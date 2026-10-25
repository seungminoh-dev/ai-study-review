import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../context';
import { errorJson } from '../lib/http';

// 오너 권한 (설계서 §8). app.ts가 /api/admin/* 전체에 건다. 역할은 요청마다 D1에서 다시 본다.

/** requireUser 뒤에 둔다. 로그인하지 않았으면 401, 오너가 아니면 403 */
export const requireOwner: MiddlewareHandler<AppEnv> = async (c, next) => {
  const userId = c.get('userId');
  if (!userId) return errorJson(401, 'login_required', '로그인이 필요해요.');
  const role = await c.env.DB.prepare('SELECT role FROM users WHERE id = ?1').bind(userId).first<string>('role');
  if (role !== 'owner') return errorJson(403, 'owner_only', '오너만 할 수 있어요.');
  await next();
};
