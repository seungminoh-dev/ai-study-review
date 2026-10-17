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

/** 아직 끝나지 않은 작업 하나가 쓸 수 있는 비용(마이크로달러). 새 작업을 받을 때 이미 쓴 것처럼 센다 */
const RESERVE_SQL = "sum(CASE kind WHEN 'import' THEN 1000000 ELSE 100000 END)";

/**
 * 한도를 넘었으면 true.
 * withPending이면(새 작업을 받을 때) 끝나지 않은 작업도 넉넉한 예상 비용으로 더한다. 비용은 응답이 와야 기록되므로,
 * 한꺼번에 여러 작업을 넣어 한도를 넘기지 못하게 한다. 작업을 돌릴 때는 자기 자신을 세지 않도록 빼고 본다.
 */
export async function overBudget(env: Env, userId: string, now: number, withPending = false): Promise<boolean> {
  const since = monthStart(now);
  const pending = withPending ? `+ (SELECT coalesce(${RESERVE_SQL}, 0) FROM llm_jobs WHERE status IN ('queued', 'running')` : '';
  const [mine, all] = await env.DB.batch([
    env.DB.prepare(
      `SELECT coalesce(sum(cost_micro_usd), 0) ${pending ? `${pending} AND user_id = ?1)` : ''} AS cost FROM llm_usage WHERE user_id = ?1 AND created_at >= ?2`,
    ).bind(userId, since),
    env.DB.prepare(`SELECT coalesce(sum(cost_micro_usd), 0) ${pending ? `${pending})` : ''} AS cost FROM llm_usage WHERE created_at >= ?1`).bind(since),
  ]);
  const limit = caps(env);
  const user = (mine!.results[0] as { cost: number }).cost / 1e6;
  const total = (all!.results[0] as { cost: number }).cost / 1e6;
  return user >= limit.user || total >= limit.monthly;
}
