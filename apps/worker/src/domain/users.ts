import type { Me } from '@moai/shared';
import type { Env } from '../env';

/** 화면이 쓰는 내 정보. 연결한 GitHub 아이디와 Google 연결 여부도 함께 준다. */
export async function loadMe(env: Env, userId: string): Promise<Me | null> {
  const row = await env.DB.prepare(
    `SELECT u.id, u.display_name, u.role, u.daily_new_limit, u.daily_review_limit, u.daily_goal, i.login AS github_login, u.terms_version,
            EXISTS (SELECT 1 FROM user_identities g WHERE g.user_id = u.id AND g.provider = 'google') AS google_linked
       FROM users u LEFT JOIN user_identities i ON i.user_id = u.id AND i.provider = 'github'
      WHERE u.id = ?1`,
  )
    .bind(userId)
    .first<Omit<Me, 'google_linked'> & { google_linked: number }>();
  return row && { ...row, google_linked: row.google_linked === 1 };
}
