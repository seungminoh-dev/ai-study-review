import { pushToUser } from '../domain/push';
import type { Env } from '../env';

// 예산 가드 (설계서 §11.5): 이번 달(UTC) 서비스 전체 AI 비용이 한도를 넘으면 새 작업을 받지 않는다.
// 사람마다 쓰는 양은 AI 크레딧(domain/credits.ts)이 정한다. 이 한도는 운영자 지갑을 지키는 안전장치다.

const DEFAULT_MONTHLY_CAP_USD = 90;

export function caps(env: Env): { monthly: number } {
  const parsed = Number(env.LLM_MONTHLY_CAP_USD);
  return { monthly: Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_MONTHLY_CAP_USD };
}

export function monthStart(now: number): number {
  const date = new Date(now);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
}

/** 아직 끝나지 않은 작업 하나가 쓸 수 있는 비용(마이크로달러). 새 작업을 받을 때 이미 쓴 것처럼 센다 */
const RESERVE_SQL = "sum(CASE kind WHEN 'import' THEN 1000000 ELSE 100000 END)";

/**
 * 서비스 전체 한도를 넘었으면 true.
 * withPending이면(새 작업을 받을 때) 끝나지 않은 작업도 넉넉한 예상 비용으로 더한다. 비용은 응답이 와야 기록되므로,
 * 한꺼번에 여러 작업을 넣어 한도를 넘기지 못하게 한다. 작업을 돌릴 때는 자기 자신을 세지 않도록 빼고 본다.
 */
export async function overBudget(env: Env, now: number, withPending = false): Promise<boolean> {
  const pending = withPending ? `+ (SELECT coalesce(${RESERVE_SQL}, 0) FROM llm_jobs WHERE status IN ('queued', 'running'))` : '';
  const all = await env.DB.prepare(`SELECT coalesce(sum(cost_micro_usd), 0) ${pending} AS cost FROM llm_usage WHERE created_at >= ?1`)
    .bind(monthStart(now))
    .first<number>('cost');
  return (all ?? 0) / 1e6 >= caps(env).monthly;
}

/**
 * 매시: 이번 달 비용이 서비스 한도의 50·80·100%를 넘었으면 단계마다 한 달에 한 번 오너에게 알린다.
 * 한도에 닿으면 사용자는 안내를 보지만 AI 버튼이 숨어서 아무도 오너에게 말해 주지 않을 수 있다.
 * 알렸는지는 alerts의 budget_<단계> 행 시각으로 본다 (이번 달 1일 뒤면 이미 알렸다). 고르기와 적기를 한 문장으로 해서 두 번 보내지 않는다
 */
export async function notifyBudget(env: Env, now: number): Promise<number | null> {
  const cap = caps(env).monthly;
  if (cap <= 0) return null;
  const since = monthStart(now);
  const spent = ((await env.DB.prepare('SELECT coalesce(sum(cost_micro_usd), 0) AS cost FROM llm_usage WHERE created_at >= ?1').bind(since).first<number>('cost')) ?? 0) / 1e6;
  const step = [100, 80, 50].find((percent) => spent >= (cap * percent) / 100);
  if (step === undefined) return null;
  const claimed = await env.DB.prepare(
    'INSERT INTO alerts (kind, pending, last_sent_at) VALUES (?1, 0, ?2) ON CONFLICT (kind) DO UPDATE SET last_sent_at = ?2 WHERE alerts.last_sent_at < ?3',
  )
    .bind(`budget_${step}`, now, since)
    .run();
  if (claimed.meta.changes === 0) return null;
  const { results: owners } = await env.DB.prepare("SELECT id FROM users WHERE role = 'owner'").all<{ id: string }>();
  const body = `이번 달 $${spent.toFixed(2)} / 한도 $${cap}${step === 100 ? ' · 새 AI 요청을 받지 않아요' : ''}`;
  for (const owner of owners) {
    await pushToUser(env, owner.id, { title: `AI 예산 ${step}%에 닿았어요`, body, url: '/admin', tag: 'budget' }, now);
  }
  console.log(JSON.stringify({ event: 'budget_notified', step, spent_usd: Number(spent.toFixed(2)) }));
  return step;
}
