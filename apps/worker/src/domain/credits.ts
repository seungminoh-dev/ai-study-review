import type { CreditBalance, CreditKind } from '@moai/shared';
import type { Env } from '../env';
import { KST_OFFSET_MS } from '../lib/kst';

// AI 크레딧 (4단계). 앱 안 재화다: 돈으로 사거나 바꿀 수 없다 (packages/shared/src/credits.ts).
// 원장(credit_ledger)에 받은 것(+)과 쓴 것(-)만 적고, 월간 크레딧은 사람마다(users.monthly_credits) 센다. 초대 없이 가입하면 0이다.
//   쓸 수 있는 크레딧 = 월간 + 받은 것 - 이번 달 쓴 것 - 지난달까지 월간을 넘겨 쓴 것
// 이번 달 쓴 것이 월간보다 적든 많든 이 식 하나로 맞는다(월간부터 쓰고 넘친 만큼 보유에서 빠진다).

/** 이번 달(한국 시간) 1일 0시 */
export function creditMonthStart(now: number): number {
  const kst = new Date(now + KST_OFFSET_MS);
  return Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), 1) - KST_OFFSET_MS;
}

/** 다음 달(한국 시간) 1일 0시. 월간 크레딧이 다시 채워진다 */
export function nextRefill(now: number): number {
  const kst = new Date(now + KST_OFFSET_MS);
  return Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth() + 1, 1) - KST_OFFSET_MS;
}

const MONTH_KEY = `strftime('%Y-%m', (created_at + ${KST_OFFSET_MS}) / 1000, 'unixepoch')`;

/** 그 사람의 월간 크레딧 SQL (2026-10-22, 초대 없이 가입하면 0). user는 매개변수 자리다 */
const monthlyOf = (user: string) => `coalesce((SELECT monthly_credits FROM users WHERE id = ${user}), 0)`;

/** 세 값을 구하는 SQL. user·since는 그 문장의 매개변수 자리(?1 같은)다 */
function parts(user: string, since: string) {
  const base = monthlyOf(user);
  return {
    granted: `(SELECT coalesce(sum(amount), 0) FROM credit_ledger WHERE user_id = ${user} AND amount > 0)`,
    usedThisMonth: `(SELECT coalesce(-sum(amount), 0) FROM credit_ledger WHERE user_id = ${user} AND amount < 0 AND created_at >= ${since})`,
    overflowBefore: `(SELECT coalesce(sum(max(used - ${base}, 0)), 0) FROM (SELECT -sum(amount) AS used FROM credit_ledger
                        WHERE user_id = ${user} AND amount < 0 AND created_at < ${since} GROUP BY ${MONTH_KEY}))`,
  };
}

/** 지금 쓸 수 있는 크레딧(월간 + 보유)을 SQL 식으로. 세기와 쓰기를 한 문장으로 할 때 쓴다 */
export function availableSql(user: string, since: string): string {
  const sql = parts(user, since);
  return `(${monthlyOf(user)} + ${sql.granted} - ${sql.usedThisMonth} - ${sql.overflowBefore})`;
}

export async function creditBalance(env: Env, userId: string, now: number): Promise<CreditBalance> {
  const sql = parts('?1', '?2');
  const row = await env.DB.prepare(`SELECT ${monthlyOf('?1')} AS base, ${sql.granted} AS granted, ${sql.usedThisMonth} AS used, ${sql.overflowBefore} AS overflow`)
    .bind(userId, creditMonthStart(now))
    .first<{ base: number; granted: number; used: number; overflow: number }>();
  const base = row?.base ?? 0;
  const used = row?.used ?? 0;
  const monthly = Math.max(0, base - used);
  const available = base + (row?.granted ?? 0) - used - (row?.overflow ?? 0);
  return { monthly, monthly_total: base, held: Math.max(0, available - monthly), refill_at: nextRefill(now) };
}

/** 이번 달 쓴 크레딧 (운영자 화면) */
export async function creditsUsedThisMonth(env: Env, userId: string, now: number): Promise<number> {
  const row = await env.DB.prepare('SELECT coalesce(-sum(amount), 0) AS n FROM credit_ledger WHERE user_id = ?1 AND amount < 0 AND created_at >= ?2')
    .bind(userId, creditMonthStart(now))
    .first<number>('n');
  return row ?? 0;
}

/**
 * 크레딧을 쓴다. 모자라면 쓰지 않고 false. 세기와 적기를 한 문장으로 해서, 동시에 여러 번 보내도 가진 것보다 더 쓰지 못한다.
 * ref는 그 호출이나 작업의 id다. 실패하면 refundCredits(ref)로 돌려준다.
 */
export async function spendCredits(env: Env, userId: string, kind: CreditKind, amount: number, ref: string, now: number): Promise<boolean> {
  const { meta } = await env.DB.prepare(
    `INSERT INTO credit_ledger (id, user_id, amount, kind, ref, note, created_at)
     SELECT ?3, ?1, 0 - ?4, ?5, ?6, NULL, ?7 WHERE ${availableSql('?1', '?2')} >= ?4`,
  )
    .bind(userId, creditMonthStart(now), crypto.randomUUID(), amount, kind, ref, now)
    .run();
  return meta.changes > 0;
}

/** 작업을 만들면서 크레딧을 쓰는 문장 (llm/jobs.ts의 createJob이 같은 batch로 묶는다). 그 작업이 실제로 들어갔을 때만 적는다 */
export function spendForJobStatement(env: Env, userId: string, kind: CreditKind, amount: number, jobId: string, now: number): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO credit_ledger (id, user_id, amount, kind, ref, note, created_at)
     SELECT ?1, ?2, 0 - ?3, ?4, ?5, NULL, ?6 WHERE EXISTS (SELECT 1 FROM llm_jobs WHERE id = ?5)`,
  ).bind(crypto.randomUUID(), userId, amount, kind, jobId, now);
}

/**
 * AI 비용이 들지 않은 실패만 돌려준다 (쓴 줄을 지운다). 비용 기록(llm_usage.job_id)이 남은 실패는 돌려주지 않는다:
 * 실패를 되풀이해 크레딧 없이 서비스 전체 예산을 쓰지 못하게 한다. 요청 안 호출은 비용 기록을 먼저 지우고 부른다
 */
const UNBILLED = 'NOT EXISTS (SELECT 1 FROM llm_usage WHERE llm_usage.job_id = credit_ledger.ref)';

/** 실패한 호출·작업의 크레딧을 돌려준다 */
export async function refundCredits(env: Env, ref: string): Promise<void> {
  await env.DB.prepare(`DELETE FROM credit_ledger WHERE ref = ?1 AND amount < 0 AND ${UNBILLED}`).bind(ref).run();
}

/** 실패로 끝난 작업의 크레딧을 돌려준다 (매분 Cron이 한꺼번에 실패시킨 작업까지) */
export function refundFailedJobsStatement(env: Env): D1PreparedStatement {
  return env.DB.prepare(`DELETE FROM credit_ledger WHERE amount < 0 AND ref IN (SELECT id FROM llm_jobs WHERE status = 'failed') AND ${UNBILLED}`);
}

/** 보유 크레딧을 준다 (운영자 지급, 숨은 업적) */
export function grantStatement(env: Env, userId: string, amount: number, kind: 'grant' | 'achievement', ref: string | null, note: string | null, now: number): D1PreparedStatement {
  return env.DB.prepare('INSERT INTO credit_ledger (id, user_id, amount, kind, ref, note, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)').bind(
    crypto.randomUUID(),
    userId,
    amount,
    kind,
    ref,
    note,
    now,
  );
}

/** 크레딧이 모자랄 때의 안내 */
export const noCreditsMessage = (cost: number) => `AI 크레딧이 모자라요 (${cost} 필요). 충전 기능은 준비 중이에요. 숨은 업적을 달성해 크레딧을 모아 보세요.`;
