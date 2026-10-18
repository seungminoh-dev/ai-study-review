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
  // 기존 경로의 모든 앞부분을 소문자 → 원래 철자로
  const spelling = new Map<string, string>();
  for (const { domain } of existing) {
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

export function resolvedCategory(resolved: Map<string, string>, input: string | null | undefined): string | null {
  const path = normalizeCategory(input);
  return path ? (resolved.get(path) ?? path) : null;
}
