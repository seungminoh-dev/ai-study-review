import { normalizeCategory } from '@moai/shared';
import type { Env } from '../env';

// 분류 (설계서 §5.6): 저장할 때 대화 중인 Claude가 분류 경로를 정한다. 서버는 모양을 맞추고 기존 분류에 붙인다.

export interface CategoryCount {
  path: string;
  concepts: number;
}

/** 이 사용자의 분류와 개념 수. 많이 쓴 것부터 */
export function categoriesQuery(env: Env, userId: string, limit = 60): D1PreparedStatement {
  return env.DB.prepare(
    `SELECT domain AS path, count(*) AS concepts FROM concepts
      WHERE user_id = ?1 AND domain IS NOT NULL AND adopted_at IS NOT NULL
      GROUP BY domain ORDER BY concepts DESC, domain LIMIT ?2`,
  ).bind(userId, limit);
}

/** resolveCategories에 넘길 두 조회. 저장의 첫 batch에 함께 넣어 왕복을 늘리지 않는다 */
export function categoryLookupQueries(env: Env, userId: string): [D1PreparedStatement, D1PreparedStatement] {
  return [
    env.DB.prepare('SELECT DISTINCT domain FROM concepts WHERE user_id = ?1 AND domain IS NOT NULL LIMIT 2000').bind(userId),
    env.DB.prepare('SELECT alias, path FROM category_aliases WHERE user_id = ?1').bind(userId),
  ];
}

/**
 * 들어온 분류 경로를 저장할 경로로 바꾼다.
 * 1. 모양 맞추기 (구분자, 공백, 흔한 줄임말)  2. 합치면서 남긴 옛 이름  3. 대소문자만 다른 기존 분류
 * 기존 분류의 앞부분과 같으면 그 철자를 따른다: 기존 "인프라/DevOps"가 있으면 "인프라/devops/Helm"은 "인프라/DevOps/Helm"이 된다.
 */
export function resolveCategories(
  inputs: readonly (string | null | undefined)[],
  existing: readonly { domain: string }[],
  aliases: readonly { alias: string; path: string }[],
): Map<string, string> {
  const normalized = [...new Set(inputs.map(normalizeCategory).filter((path): path is string => path !== null))];
  const resolved = new Map<string, string>();
  const aliasOf = new Map(aliases.map((row) => [row.alias, row.path]));
  // 기존 경로의 모든 앞부분을 소문자 → 원래 철자로. 0006 전에 저장한 분류는 모양을 맞춘 뒤에 쓴다
  const spelling = new Map<string, string>();
  for (const row of existing) {
    const domain = normalizeCategory(row.domain);
    if (!domain) continue;
    const segments = domain.split('/');
    for (let depth = 1; depth <= segments.length; depth++) {
      const prefix = segments.slice(0, depth).join('/');
      if (!spelling.has(prefix.toLowerCase())) spelling.set(prefix.toLowerCase(), prefix);
    }
  }
  for (const path of normalized) {
    let target = path;
    // 옛 이름은 가장 긴 앞부분부터 바꾼다: "devops/k8s/helm"에서 "devops"가 옛 이름이면 그 부분만 바뀐다
    const segments = target.split('/');
    for (let depth = segments.length; depth >= 1; depth--) {
      const alias = aliasOf.get(segments.slice(0, depth).join('/').toLowerCase());
      // 이미 새 이름 아래에 있는 경로는 다시 바꾸지 않는다 ("Kubernetes" → "Kubernetes/기본"일 때 "Kubernetes/기본/기본"이 되지 않게)
      if (alias && isUnder(target, alias)) break;
      if (alias) {
        target = [alias, ...segments.slice(depth)].join('/');
        break;
      }
    }
    const parts = target.split('/');
    for (let depth = parts.length; depth >= 1; depth--) {
      const known = spelling.get(parts.slice(0, depth).join('/').toLowerCase());
      if (known) {
        target = [known, ...parts.slice(depth)].join('/');
        break;
      }
    }
    resolved.set(path, target.split('/').slice(0, 3).join('/'));
  }
  return resolved;
}

/** path가 parent이거나 그 아래면 true. 대소문자는 가리지 않는다 */
function isUnder(path: string, parent: string): boolean {
  const lower = path.toLowerCase();
  const prefix = parent.toLowerCase();
  return lower === prefix || lower.startsWith(`${prefix}/`);
}

export function resolvedCategory(resolved: Map<string, string>, input: string | null | undefined): string | null {
  const path = normalizeCategory(input);
  return path ? (resolved.get(path) ?? path) : null;
}

export interface CategoryOverview {
  categories: CategoryCount[];
  unclassified: { key: string; name: string }[];
  aliases: { alias: string; path: string }[];
}

/** 분류 정리용: 분류와 개념 수, 분류 없는 개념, 남겨 둔 옛 이름 */
export async function categoryOverview(env: Env, userId: string): Promise<CategoryOverview> {
  const [categories, unclassified, aliases] = await env.DB.batch([
    categoriesQuery(env, userId, 300),
    env.DB.prepare('SELECT key, name FROM concepts WHERE user_id = ?1 AND domain IS NULL AND adopted_at IS NOT NULL ORDER BY updated_at DESC LIMIT 150').bind(userId),
    env.DB.prepare('SELECT alias, path FROM category_aliases WHERE user_id = ?1 ORDER BY created_at DESC LIMIT 50').bind(userId),
  ]);
  return {
    categories: categories!.results as unknown as CategoryCount[],
    unclassified: unclassified!.results as { key: string; name: string }[],
    aliases: aliases!.results as { alias: string; path: string }[],
  };
}

export interface CategoryMove {
  from: string;
  to: string;
}

/**
 * 분류를 고친다. assign: 개념마다 분류를 정한다(null이면 지운다). rename: 분류(와 그 아래)를 새 이름으로 옮기고 옛 이름을 남긴다.
 * 옮긴 뒤에도 3단계를 넘지 않게 자른다. 무엇을 어디로 옮겼는지 돌려준다.
 */
export async function updateCategories(
  env: Env,
  userId: string,
  change: { assign: { concept_key: string; category: string | null }[]; rename: { from: string; to: string }[] },
  now: number,
): Promise<{ assigned: number; renamed: number; moves: CategoryMove[] }> {
  const [existing, aliasRows] = await env.DB.batch(categoryLookupQueries(env, userId));
  const domains = existing!.results as { domain: string }[];
  const aliases = aliasRows!.results as { alias: string; path: string }[];
  const resolved = resolveCategories(
    change.assign.map((item) => item.category),
    domains,
    aliases,
  );
  const statements: D1PreparedStatement[] = [];
  if (change.assign.length > 0) {
    const rows = change.assign.map((item) => ({ key: item.concept_key, category: resolvedCategory(resolved, item.category) }));
    statements.push(
      env.DB.prepare(
        `UPDATE concepts SET domain = json_extract(j.value, '$.category'), updated_at = ?3
           FROM json_each(?2) AS j WHERE concepts.user_id = ?1 AND concepts.key = json_extract(j.value, '$.key')`,
      ).bind(userId, JSON.stringify(rows), now),
    );
  }
  /** 저장된 분류(그대로의 철자) → 옮길 분류 */
  const moves = new Map<string, string>();
  for (const rename of change.rename) {
    const from = normalizeCategory(rename.from);
    const input = normalizeCategory(rename.to);
    if (!from || !input || from === input) continue;
    // 새 이름은 옮기는 분류 바깥의 기존 철자를 따른다 ("인프라/devops"로 옮기면 기존 "인프라/DevOps"로)
    const outside = domains.filter((row) => !isUnder(normalizeCategory(row.domain) ?? '', from));
    const to = resolveCategories([input], outside, []).get(input) ?? input;
    // 0006 전에 저장한 분류도 모양을 맞춰서 비교한다
    for (const { domain } of domains) {
      const shaped = normalizeCategory(domain);
      if (shaped && isUnder(shaped, from)) moves.set(domain, normalizeCategory(to + shaped.slice(from.length))!);
    }
    // 새 이름은 이제 살아 있는 분류다. 그 이름을 다른 곳으로 보내던 옛 이름은 지운다
    statements.push(env.DB.prepare('DELETE FROM category_aliases WHERE user_id = ?1 AND alias = ?2').bind(userId, to.toLowerCase()));
    // 옮기는 분류를 가리키던 옛 이름은 새 자리를 가리키게 한다
    for (const alias of aliases) {
      if (alias.alias !== to.toLowerCase() && isUnder(alias.path, from)) {
        statements.push(
          env.DB.prepare('UPDATE category_aliases SET path = ?3 WHERE user_id = ?1 AND alias = ?2').bind(
            userId,
            alias.alias,
            normalizeCategory(to + alias.path.slice(from.length))!,
          ),
        );
      }
    }
    // 대소문자만 바꿨으면 옛 이름은 필요 없다 (찾을 때 대소문자를 가리지 않는다)
    if (from.toLowerCase() !== to.toLowerCase()) {
      statements.push(
        env.DB.prepare(
          'INSERT INTO category_aliases (user_id, alias, path, created_at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT (user_id, alias) DO UPDATE SET path = excluded.path',
        ).bind(userId, from.toLowerCase(), to, now),
      );
    }
  }
  const moveRows = [...moves].filter(([from, to]) => from !== to).map(([from, to]) => ({ from, to }));
  if (moveRows.length > 0) {
    statements.push(
      env.DB.prepare(
        `UPDATE concepts SET domain = json_extract(m.value, '$.to'), updated_at = ?3
           FROM json_each(?2) AS m WHERE concepts.user_id = ?1 AND concepts.domain = json_extract(m.value, '$.from')`,
      ).bind(userId, JSON.stringify(moveRows), now),
    );
  }
  if (statements.length === 0) return { assigned: 0, renamed: 0, moves: [] };
  const results = await env.DB.batch(statements);
  const assigned = change.assign.length > 0 ? results[0]!.meta.changes : 0;
  const renamed = moveRows.length > 0 ? results.at(-1)!.meta.changes : 0;
  return { assigned, renamed, moves: moveRows };
}

/**
 * 매시 보정 (cron). 1. 0006 전에 저장해 모양이 안 맞는 분류를 맞춘다. 2. 0006을 적용한 뒤 새 코드가 배포되기 전에 저장된 개념을 내 지식에 넣는다.
 * 둘 다 한 번 맞추고 나면 바꿀 것이 없다. 공부해서 저장한 개념(카드나 판정이 있는 개념)만 넣는다. 판정은 자료 저장에서 받지 않는다.
 */
export async function repairLibrary(env: Env): Promise<{ normalized: number; adopted: number }> {
  const { results } = await env.DB.prepare('SELECT DISTINCT user_id, domain FROM concepts WHERE domain IS NOT NULL LIMIT 5000').all<{
    user_id: string;
    domain: string;
  }>();
  const fixes = results
    .map((row) => ({ user_id: row.user_id, from: row.domain, to: normalizeCategory(row.domain) }))
    .filter((row) => row.to !== row.from);
  const statements = [
    env.DB.prepare(
      `UPDATE concepts SET adopted_at = created_at
        WHERE adopted_at IS NULL
          AND (EXISTS (SELECT 1 FROM cards WHERE cards.concept_id = concepts.id AND cards.origin = 'study')
               OR EXISTS (SELECT 1 FROM judgments WHERE judgments.concept_id = concepts.id))`,
    ),
  ];
  if (fixes.length > 0) {
    statements.push(
      env.DB.prepare(
        `UPDATE concepts SET domain = json_extract(f.value, '$.to')
           FROM json_each(?1) AS f
          WHERE concepts.user_id = json_extract(f.value, '$.user_id') AND concepts.domain = json_extract(f.value, '$.from')`,
      ).bind(JSON.stringify(fixes)),
    );
  }
  const [adopted, normalized] = await env.DB.batch(statements);
  return { adopted: adopted!.meta.changes, normalized: normalized?.meta.changes ?? 0 };
}
