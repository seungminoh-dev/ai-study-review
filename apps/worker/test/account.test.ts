import type { LoginSummary, MemberSummary } from '@moai/shared';
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import example from '../../../packages/shared/fixtures/immutable-object.json';
import { hashToken } from '../src/lib/crypto';
import { findMcpUser } from '../src/mcp/route';
import { api, callTool, fakeSubscription, mcpUrl, newUser, type TestUser } from './helpers';

// 계정 지우기는 되돌릴 수 없다. 그 사람의 행이 하나도 남지 않고, 다른 사람의 데이터는 그대로인지 확인한다.

async function fillAccount(user: TestUser): Promise<void> {
  const url = await mcpUrl(user);
  await callTool(url, 'save_learning', example);
  await callTool(url, 'update_categories', { assign: [], rename: [{ from: '옛 분류', to: '새 분류' }] });
  const card = await env.DB.prepare('SELECT id FROM cards WHERE user_id = ?1 LIMIT 1').bind(user.id).first<string>('id');
  await api(user, '/reviews', { method: 'POST', json: { reviews: [{ id: crypto.randomUUID(), card_id: card, grade: 3, reviewed_at: Date.now() }] } });
  await api(user, '/push/subscriptions', { method: 'POST', json: await fakeSubscription() });
  await api(user, '/reminders', { method: 'PUT', json: { times: ['08:10'] } });
  await api(user, '/login-codes', { method: 'POST' });
  await api(user, `/cards/${card}/report`, { method: 'POST', json: { reason: 'unclear' } });
  // 통계를 보면 첫 저장·첫 복습 배지가 생긴다
  await api(user, '/stats');
  expect(await env.DB.prepare('SELECT count(*) AS n FROM badges WHERE user_id = ?1').bind(user.id).first<number>('n')).toBeGreaterThan(0);
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO user_identities (provider, subject, user_id, login, created_at) VALUES ('github', ?1, ?2, 'gone', ?3)").bind(crypto.randomUUID(), user.id, now),
    env.DB.prepare("INSERT INTO streak_freezes (user_id, day) VALUES (?1, '2026-10-01')").bind(user.id),
    env.DB.prepare("INSERT INTO material_labels (user_id, material, label, updated_at) VALUES (?1, '책.pdf', '내 책', ?2)").bind(user.id, now),
    env.DB.prepare("INSERT INTO material_part_labels (user_id, material, part, label, updated_at) VALUES (?1, '책.pdf', '1장', '첫 장', ?2)").bind(user.id, now),
    env.DB.prepare("INSERT INTO survey_answers (user_id, week, used, note, created_at) VALUES (?1, '2026-10-12', 1, '깊은 복사', ?2)").bind(user.id, now),
    env.DB.prepare("INSERT INTO credit_ledger (id, user_id, amount, kind, ref, note, created_at) VALUES (?1, ?2, 100, 'grant', NULL, '베타', ?3)").bind(crypto.randomUUID(), user.id, now),
    env.DB.prepare("INSERT INTO achievements (user_id, achievement, earned_at) VALUES (?1, 'curious', ?2)").bind(user.id, now),
    // 질문 은행 API는 지웠지만 예전에 공유한 질문은 남아 있다
    env.DB.prepare("INSERT INTO shared_questions (id, user_id, concept_name, question, created_at) VALUES (?1, ?2, '깊은 복사', '깊은 복사는 언제 필요할까요?', ?3)").bind(crypto.randomUUID(), user.id, now),
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
    // 쓴 초대는 남지만 이름이 든 라벨은 지운다
    expect(await env.DB.prepare("SELECT count(*) AS n FROM invites WHERE label = '지울사람'").first<number>('n')).toBe(0);
    expect(await env.DB.prepare("SELECT count(*) AS n FROM invites WHERE label = '지운 회원' AND used_at = 0").first<number>('n')).toBe(1);
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
    expect(body).toMatchObject({ format: 'moai-export-v2', user: { display_name: '내보낼사람' }, github_login: 'gone' });
    expect(body.cards.length).toBeGreaterThan(0);
    expect(body.cards[0]).toHaveProperty('learning_steps');
    expect(body.review_logs).toMatchObject([{ prev_card: expect.any(String), run_id: null }]);
    expect(body.ai_jobs).toMatchObject([{ kind: 'grade', status: 'done' }]);
    expect(body.ai_usage).toMatchObject([{ kind: 'grade', calls: 1 }]);
    for (const secret of ['token_hash', 'code_hash', 'p256dh', 'endpoint', 'input_hash', 'cost_micro_usd']) expect(text).not.toContain(secret);
  });

  it('covers every table that holds a user_id, except the ones left out on purpose', async () => {
    const body = await (await api(await newUser(), '/export')).json();
    /** 테이블 → 내보내기 키 */
    const exported: Record<string, string> = {
      user_identities: 'github_login',
      learning_sessions: 'sessions',
      concepts: 'concepts',
      edges: 'edges',
      judgments: 'judgments',
      followups: 'followups',
      cards: 'cards',
      review_logs: 'review_logs',
      reminder_slots: 'reminders',
      streak_freezes: 'streak_freezes',
      card_reports: 'card_reports',
      shared_questions: 'shared_questions',
      category_aliases: 'category_aliases',
      badges: 'badges',
      material_labels: 'material_labels',
      material_part_labels: 'material_part_labels',
      survey_answers: 'survey_answers',
      credit_ledger: 'credit_ledger',
      achievements: 'achievements',
      llm_jobs: 'ai_jobs',
      llm_usage: 'ai_usage',
    };
    /** 로그인·기기에 쓰는 값. 백업해도 다시 쓸 수 없다 */
    const skipped = ['auth_sessions', 'login_codes', 'mcp_tokens', 'push_subscriptions'];
    const { results: tables } = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'").all<{ name: string }>();
    const withUser: string[] = [];
    for (const { name } of tables) if (await env.DB.prepare(`SELECT name FROM pragma_table_info('${name}') WHERE name = 'user_id'`).first()) withUser.push(name);
    expect(withUser.sort()).toEqual([...Object.keys(exported), ...skipped].sort());
    for (const key of Object.values(exported)) expect(body).toHaveProperty(key);
  });
});

/** 같은 사람의 다른 기기 로그인 */
async function anotherLogin(user: TestUser, createdAt = Date.now()): Promise<TestUser> {
  const token = crypto.randomUUID();
  await env.DB.prepare('INSERT INTO auth_sessions (token_hash, user_id, created_at, last_seen_at, expires_at) VALUES (?1, ?2, ?3, ?3, ?4)')
    .bind(await hashToken(env.TOKEN_PEPPER, token), user.id, createdAt, Date.now() + 86_400_000)
    .run();
  return { id: user.id, cookie: `__Host-sid=${token}` };
}

const endpoints = async (userId: string) =>
  (await env.DB.prepare('SELECT endpoint FROM push_subscriptions WHERE user_id = ?1').bind(userId).all<{ endpoint: string }>()).results.map((row) => row.endpoint);

describe('logins', () => {
  it('logs out every other device but this one and drops their push subscriptions', async () => {
    const phone = await newUser();
    const laptop = await anotherLogin(phone);
    const { logins } = (await (await api(phone, '/logins')).json()) as { logins: LoginSummary[] };
    expect(logins.map((login) => login.current).sort()).toEqual([false, true]);
    const mine = await fakeSubscription();
    await api(phone, '/push/subscriptions', { method: 'POST', json: mine });
    await api(laptop, '/push/subscriptions', { method: 'POST', json: await fakeSubscription() });

    expect(await (await api(phone, '/logins', { method: 'DELETE', json: { endpoint: mine.endpoint } })).json()).toEqual({ ended: 1 });
    expect((await api(laptop, '/me')).status).toBe(401);
    expect((await api(phone, '/me')).status).toBe(200);
    expect(await endpoints(phone.id)).toEqual([mine.endpoint]);
  });

  it('ends a login a year after it started even if it was used every day', async () => {
    const user = await newUser();
    expect((await api(await anotherLogin(user, Date.now() - 366 * 86_400_000), '/me')).status).toBe(401);
    expect((await api(user, '/me')).status).toBe(200);
  });
});

describe('suspension', () => {
  it('cuts every way in until the owner reopens it', async () => {
    const owner = await newUser('오너', 'owner');
    const member = await newUser('멈출사람');
    const token = new URL(await mcpUrl(member)).pathname.split('/').pop()!;
    await api(member, '/login-codes', { method: 'POST' });
    await api(member, '/push/subscriptions', { method: 'POST', json: await fakeSubscription() });

    expect((await api(member, `/admin/members/${owner.id}/disable`, { method: 'POST' })).status).toBe(403);
    expect((await api(owner, `/admin/members/${owner.id}/disable`, { method: 'POST' })).status).toBe(404);
    expect((await api(owner, `/admin/members/${member.id}/disable`, { method: 'POST' })).status).toBe(204);

    expect((await api(member, '/me')).status).toBe(401);
    // 멈춘 뒤에 생긴 로그인도 쓰지 못한다
    expect((await api(await anotherLogin(member), '/me')).status).toBe(401);
    expect(await findMcpUser(env, token)).toBeNull();
    expect(await env.DB.prepare('SELECT count(*) AS n FROM login_codes WHERE user_id = ?1').bind(member.id).first<number>('n')).toBe(0);
    expect(await endpoints(member.id)).toEqual([]);
    const { members } = (await (await api(owner, '/admin/members')).json()) as { members: MemberSummary[] };
    expect(members.find((item) => item.id === member.id)?.disabled_at).toEqual(expect.any(Number));

    expect((await api(owner, `/admin/members/${member.id}/enable`, { method: 'POST' })).status).toBe(204);
    expect((await api(await anotherLogin(member), '/me')).status).toBe(200);
    // 끊은 커넥터 주소는 다시 열리지 않는다
    expect(await findMcpUser(env, token)).toBeNull();
  });
});
