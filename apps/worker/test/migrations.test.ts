import { SaveLearningInput } from '@moai/shared';
import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import example from '../../../packages/shared/fixtures/immutable-object.json';
import { recordReviews } from '../src/domain/reviews';
import { saveLearning } from '../src/domain/save-learning';

// 마이그레이션 업그레이드 (개선점 10). 다른 테스트는 빈 DB에 전부 적용한 뒤에 돌아서, 데이터가 있을 때만 깨지는 변경을 못 잡는다.
// 마지막 마이그레이션 직전까지 적용한 DB에 지금 코드로 데이터를 채우고, 마지막 것을 얹어 본다.
// 채우는 코드가 마지막 마이그레이션의 열·테이블을 쓰기 시작하면 여기서 깨진다. 그때는 채우는 단계를 그 직전 모양에 맞춘다.

/** 사용자 데이터가 들어 있는 테이블마다 행 수 */
async function rowCounts(db: D1Database): Promise<Record<string, number>> {
  const { results } = await db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name != 'd1_migrations'")
    .all<{ name: string }>();
  const counts: Record<string, number> = {};
  for (const { name } of results) counts[name] = (await db.prepare(`SELECT count(*) AS n FROM "${name}"`).first<number>('n')) ?? 0;
  return counts;
}

describe('migration upgrade', () => {
  it('applies the newest migration on a database that already has data', async () => {
    const db = env.UPGRADE_DB;
    const migrations = env.TEST_MIGRATIONS;
    await applyD1Migrations(db, migrations.slice(0, -1));

    const upgradeEnv = { ...env, DB: db };
    const now = Date.now();
    const userId = crypto.randomUUID();
    await db.prepare("INSERT INTO users (id, display_name, role, created_at) VALUES (?1, '업그레이드', 'owner', ?2)").bind(userId, now).run();
    await db
      .prepare("INSERT INTO invites (id, code_hash, label, created_by, created_at, expires_at) VALUES (?1, ?2, '친구', ?3, ?4, ?5)")
      .bind(crypto.randomUUID(), crypto.randomUUID(), userId, now, now + 86_400_000)
      .run();
    await db.prepare("INSERT INTO user_identities (provider, subject, user_id, login, created_at) VALUES ('github', '1', ?1, 'octo', ?2)").bind(userId, now).run();
    await db.prepare("INSERT INTO pending_signups (token_hash, provider, subject, login, expires_at) VALUES ('hash', 'github', '2', 'newbie', ?1)").bind(now + 60_000).run();
    const saved = await saveLearning(upgradeEnv, userId, SaveLearningInput.parse(example), now);
    expect(saved.ok).toBe(true);
    const { results: cards } = await db.prepare("SELECT id FROM cards WHERE user_id = ?1 AND status = 'active'").bind(userId).all<{ id: string }>();
    await recordReviews(
      upgradeEnv,
      userId,
      cards.map((card) => ({ id: crypto.randomUUID(), card_id: card.id, grade: 3, reviewed_at: now })),
      now,
    );

    const applied = () => db.prepare('SELECT count(*) AS n FROM d1_migrations').first<number>('n');
    const before = await rowCounts(db);
    expect(before.review_logs).toBeGreaterThan(0);
    expect(await applied()).toBe(migrations.length - 1);
    await applyD1Migrations(db, migrations);
    expect(await applied()).toBe(migrations.length);
    const after = await rowCounts(db);

    // 외래 키가 깨지지 않았고, 있던 테이블의 행은 그대로다
    expect((await db.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
    for (const [table, count] of Object.entries(before)) expect([table, after[table]]).toEqual([table, count]);
  });
});
