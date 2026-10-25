import type { LoginCode } from '@moai/shared';
import { Hono } from 'hono';
import type { AppEnv } from '../context';
import { LOGIN_CODE_LENGTH, formatCode, randomCode } from '../lib/codes';
import { hashToken } from '../lib/crypto';
import { MINUTE_MS } from '../lib/kst';

// 계정 설정 (설계서 §8.5): 다른 기기 로그인 코드. 코드는 만들 때 한 번만 보여 준다. 오너의 초대·회원 관리는 admin.ts.

export const account = new Hono<AppEnv>();

const LOGIN_CODE_TTL_MS = 10 * MINUTE_MS;

/** 새 코드를 만들면 이전 코드는 바로 무효다 */
account.post('/login-codes', async (c) => {
  const code = randomCode(LOGIN_CODE_LENGTH);
  const expiresAt = Date.now() + LOGIN_CODE_TTL_MS;
  await c.env.DB.prepare(
    `INSERT INTO login_codes (code_hash, user_id, expires_at) VALUES (?1, ?2, ?3)
     ON CONFLICT (user_id) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at`,
  )
    .bind(await hashToken(c.env.TOKEN_PEPPER, `login:${code}`), c.var.userId, expiresAt)
    .run();
  return c.json({ code: formatCode(code), expires_at: expiresAt } satisfies LoginCode, 201);
});
