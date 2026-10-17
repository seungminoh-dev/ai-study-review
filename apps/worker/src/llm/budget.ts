import type { Env } from '../env';

// 예산 가드 (설계서 §11.5): 이번 달(UTC) 사용자 합계와 전체 합계가 한도를 넘으면 새 작업을 받지 않는다.

const DEFAULT_USER_CAP_USD = 6;
const DEFAULT_MONTHLY_CAP_USD = 90;

export function caps(env: Env): { user: number; monthly: number } {
  const read = (value: string | undefined, fallback: number) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
  };
  return { user: read(env.LLM_USER_CAP_USD, DEFAULT_USER_CAP_USD), monthly: read(env.LLM_MONTHLY_CAP_USD, DEFAULT_MONTHLY_CAP_USD) };
}

export function monthStart(now: number): number {
  const date = new Date(now);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
}

/** 한도를 넘었으면 true */
export async function overBudget(env: Env, userId: string, now: number): Promise<boolean> {
  const since = monthStart(now);
  const [mine, all] = await env.DB.batch([
    env.DB.prepare('SELECT coalesce(sum(cost_micro_usd), 0) AS cost FROM llm_usage WHERE user_id = ?1 AND created_at >= ?2').bind(userId, since),
    env.DB.prepare('SELECT coalesce(sum(cost_micro_usd), 0) AS cost FROM llm_usage WHERE created_at >= ?1').bind(since),
  ]);
  const limit = caps(env);
  const user = (mine!.results[0] as { cost: number }).cost / 1e6;
  const total = (all!.results[0] as { cost: number }).cost / 1e6;
  return user >= limit.user || total >= limit.monthly;
}
