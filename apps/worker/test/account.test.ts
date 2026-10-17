import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import example from '../../../packages/shared/fixtures/immutable-object.json';
import { api, callTool, fakeSubscription, mcpUrl, newUser, type TestUser } from './helpers';

// 계정 지우기는 되돌릴 수 없다. 그 사람의 행이 하나도 남지 않고, 다른 사람의 데이터는 그대로인지 확인한다.

async function fillAccount(user: TestUser): Promise<void> {
  await callTool(await mcpUrl(user), 'save_learning', example);
  const card = await env.DB.prepare('SELECT id FROM cards WHERE user_id = ?1 LIMIT 1').bind(user.id).first<string>('id');
  await api(user, '/reviews', { method: 'POST', json: { reviews: [{ id: crypto.randomUUID(), card_id: card, grade: 3, reviewed_at: Date.now() }] } });
  await api(user, '/push/subscriptions', { method: 'POST', json: await fakeSubscription() });
  await api(user, '/reminders', { method: 'PUT', json: { times: ['08:10'] } });
  await api(user, '/login-codes', { method: 'POST' });
  await api(user, `/cards/${card}/report`, { method: 'POST', json: { reason: 'unclear' } });
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO user_identities (provider, subject, user_id, login, created_at) VALUES ('github', ?1, ?2, 'gone', ?3)").bind(crypto.randomUUID(), user.id, now),
    env.DB.prepare("INSERT INTO streak_freezes (user_id, day) VALUES (?1, '2026-10-01')").bind(user.id),
    env.DB.prepare("INSERT INTO llm_jobs (id, user_id, kind, status, created_at, updated_at) VALUES (?1, ?2, 'grade', 'done', ?3, ?3)").bind(crypto.randomUUID(), user.id, now),
    env.DB.prepare(
      "INSERT INTO llm_usage (id, user_id, job_id, kind, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_micro_usd, created_at) VALUES (?1, ?2, 'j', 'grade', 'm', 1, 1, 0, 0, 1234, ?3)",
    ).bind(crypto.randomUUID(), user.id, now),
  ]);
}

/** user_id(또는 used_by·bind_user_id) 열이 있는 모든 테이블에서 그 사람의 행 수 */
async function rowsOf(userId: string): Promise<Record<string, number>> {
  const { results: tables } = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name != 'd1_migrations'").all<{ name: string }>();
  const counts: Record<string, number> = {};
  for (const { name } of tables) {
    const { results: columns } = await env.DB.prepare(`SELECT name FROM pragma_table_info('${name}')`).all<{ name: string }>();
    const keys = columns.map((column) => column.name).filter((column) => ['user_id', 'used_by', 'bind_user_id', 'created_by'].includes(column));
    if (name === 'users') keys.push('id');
    for (const key of keys) {
      const n = await env.DB.prepare(`SELECT count(*) AS n FROM ${name} WHERE ${key} = ?1`).bind(userId).first<number>('n');
      if (n) counts[`${name}.${key}`] = n;
    }
  }
  return counts;
}

describe('account deletion', () => {
  it('removes every row of the user, keeps cost totals anonymous, and leaves other users alone', async () => {
    const owner = await newUser('오너', 'owner');
    const user = await newUser('지울사람');
    const other = await newUser('남을사람');
    await fillAccount(user);
    await fillAccount(other);
    // 이 사람이 쓴 초대
    await env.DB.prepare("INSERT INTO invites (id, code_hash, label, created_by, created_at, expires_at, used_at, used_by) VALUES (?1, ?2, '지울사람', ?3, 0, 1, 0, ?4)")
      .bind(crypto.randomUUID(), crypto.randomUUID(), owner.id, user.id)
      .run();
    const before = await rowsOf(other.id);

    expect((await api(user, '/me', { method: 'DELETE', json: { confirm: '다른 이름' } })).status).toBe(400);
    const response = await api(user, '/me', { method: 'DELETE', json: { confirm: '지울사람' } });
    expect(response.status).toBe(204);
    expect(response.headers.getSetCookie()[0]).toMatch(/^__Host-sid=;/);

    expect(await rowsOf(user.id)).toEqual({});
    expect(await rowsOf(other.id)).toEqual(before);
    expect(await env.DB.prepare("SELECT sum(cost_micro_usd) AS n FROM llm_usage WHERE user_id = 'deleted'").first<number>('n')).toBeGreaterThanOrEqual(1234);
    expect(await env.DB.prepare("SELECT count(*) AS n FROM invites WHERE label = '지울사람' AND used_at = 0").first<number>('n')).toBe(1);
    expect((await api(user, '/me')).status).toBe(401);
  });

  it('does not delete the owner', async () => {
    const owner = await newUser('오너', 'owner');
    expect((await api(owner, '/me', { method: 'DELETE', json: { confirm: '오너' } })).status).toBe(403);
    expect((await api(owner, '/me')).status).toBe(200);
  });
});

describe('export', () => {
  it('gives my learning data without tokens or push keys', async () => {
    const user = await newUser('내보낼사람');
    await fillAccount(user);
    const response = await api(user, '/export');
    expect(response.headers.get('content-disposition')).toMatch(/^attachment; filename="moai-export-\d{4}-\d{2}-\d{2}\.json"$/);
    const text = await response.text();
    const body = JSON.parse(text);
    expect(body).toMatchObject({ format: 'moai-export-v1', user: { display_name: '내보낼사람' }, github_login: 'gone' });
    expect(body.cards.length).toBeGreaterThan(0);
    expect(body.review_logs).toHaveLength(1);
    for (const secret of ['token_hash', 'code_hash', 'p256dh', 'endpoint', 'prev_card']) expect(text).not.toContain(secret);
  });
});
