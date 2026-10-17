import type { Me } from '@moai/shared';
import type { Env } from '../env';

/** 화면이 쓰는 내 정보. 연결한 GitHub 아이디도 함께 준다. */
export async function loadMe(env: Env, userId: string): Promise<Me | null> {
  return env.DB.prepare(
    `SELECT u.id, u.display_name, u.role, u.daily_new_limit, u.daily_review_limit, i.login AS github_login
       FROM users u LEFT JOIN user_identities i ON i.user_id = u.id AND i.provider = 'github'
      WHERE u.id = ?1`,
  )
    .bind(userId)
    .first<Me>();
}
