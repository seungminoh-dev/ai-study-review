import { GradeResult, SaveLearningInput, checkSaveLearning, type ImportResult } from '@moai/shared';
import { z } from 'zod';
import { pushToUser } from '../domain/push';
import { saveLearning } from '../domain/save-learning';
import type { Env } from '../env';
import { MINUTE_MS } from '../lib/kst';
import { callClaude, llmConfigured, parseJson, type CallResult } from './anthropic';
import { overBudget } from './budget';
import { costMicroUsd } from './pricing';
import { GRADER_SYSTEM, IMPORT_SYSTEM, gradingInput, importInput, repairInput } from './prompts';
import { toOutputSchema } from './schema';

// 작업 테이블 (설계서 §11.3). 요청은 작업만 만들고, 실행은 waitUntil(채점)이나 매분 Cron(가져오기, 채점 이어 받기)이 한다.

export type JobKind = 'grade' | 'import';

interface JobRow {
  id: string;
  user_id: string;
  kind: JobKind;
  card_id: string | null;
  input: string | null;
  attempts: number;
}

const MAX_ATTEMPTS = 3;
/** 이만큼 running으로 멈춰 있으면 실행이 죽었다고 보고 되돌린다 */
const STALE_MS: Record<JobKind, number> = { grade: 3 * MINUTE_MS, import: 15 * MINUTE_MS };
const TIMEOUT_MS: Record<JobKind, number> = { grade: 90_000, import: 10 * MINUTE_MS };
const MAX_TOKENS: Record<JobKind, number> = { grade: 4096, import: 16000 };

let gradeSchema: Record<string, unknown> | null = null;
let importSchema: Record<string, unknown> | null = null;
const schemaFor = (kind: JobKind) =>
  kind === 'grade'
    ? (gradeSchema ??= toOutputSchema(z.toJSONSchema(GradeResult, { target: 'draft-2020-12' }) as Record<string, unknown>))
    : (importSchema ??= toOutputSchema(z.toJSONSchema(SaveLearningInput, { target: 'draft-2020-12', io: 'input' }) as Record<string, unknown>));

export async function createJob(env: Env, userId: string, kind: JobKind, input: string, extra: { cardId?: string; inputHash?: string }, now: number): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO llm_jobs (id, user_id, kind, status, card_id, input, input_hash, created_at, updated_at) VALUES (?1, ?2, ?3, 'queued', ?4, ?5, ?6, ?7, ?7)",
  )
    .bind(id, userId, kind, extra.cardId ?? null, input, extra.inputHash ?? null, now)
    .run();
  return id;
}

async function recordUsage(env: Env, job: JobRow, result: CallResult, now: number): Promise<void> {
  if (!result.usage) return;
  await env.DB.prepare(
    `INSERT INTO llm_usage (id, user_id, job_id, kind, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_micro_usd, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`,
  )
    .bind(
      crypto.randomUUID(),
      job.user_id,
      job.id,
      job.kind,
      result.model,
      result.usage.input_tokens,
      result.usage.output_tokens,
      result.usage.cache_read_input_tokens ?? 0,
      result.usage.cache_creation_input_tokens ?? 0,
      costMicroUsd(result.model, result.usage),
      now,
    )
    .run();
}

/** 끝난 작업은 원문(input)을 지운다. 대화 원문과 설명은 결과를 만들 때까지만 둔다 (설계서 §14) */
async function finish(env: Env, id: string, outcome: { result: unknown } | { error: string }, now: number): Promise<void> {
  if ('result' in outcome) {
    await env.DB.prepare("UPDATE llm_jobs SET status = 'done', result = ?2, input = NULL, updated_at = ?3 WHERE id = ?1")
      .bind(id, JSON.stringify(outcome.result), now)
      .run();
  } else {
    await env.DB.prepare("UPDATE llm_jobs SET status = 'failed', error = ?2, input = NULL, updated_at = ?3 WHERE id = ?1").bind(id, outcome.error, now).run();
  }
}

async function requeue(env: Env, job: JobRow, now: number): Promise<void> {
  if (job.attempts >= MAX_ATTEMPTS) return finish(env, job.id, { error: 'api' }, now);
  await env.DB.prepare("UPDATE llm_jobs SET status = 'queued', updated_at = ?2 WHERE id = ?1").bind(job.id, now).run();
}

/** queued인 작업 하나를 맡아서 끝까지 돌린다. 이미 다른 실행이 맡았으면 아무것도 하지 않는다 */
export async function runJob(env: Env, id: string): Promise<void> {
  const job = await env.DB.prepare(
    "UPDATE llm_jobs SET status = 'running', attempts = attempts + 1, updated_at = ?2 WHERE id = ?1 AND status = 'queued' RETURNING id, user_id, kind, card_id, input, attempts",
  )
    .bind(id, Date.now())
    .first<JobRow>();
  if (!job) return;
  try {
    if (!llmConfigured(env) || !job.input) return await finish(env, job.id, { error: 'unavailable' }, Date.now());
    if (await overBudget(env, job.user_id, Date.now())) return await finish(env, job.id, { error: 'budget' }, Date.now());
    if (job.kind === 'grade') await runGrade(env, job);
    else await runImport(env, job);
  } catch (error) {
    console.error(JSON.stringify({ event: 'llm_job_crashed', job_id: job.id, kind: job.kind, message: (error as Error).message }));
    await requeue(env, job, Date.now()).catch(() => undefined);
  }
}

async function runGrade(env: Env, job: JobRow): Promise<void> {
  const card = await env.DB.prepare(
    `SELECT c.prompt, c.checklist, k.final_answer FROM cards c JOIN concepts k ON k.id = c.concept_id
      WHERE c.id = ?1 AND c.user_id = ?2 AND c.type = 'explain'`,
  )
    .bind(job.card_id, job.user_id)
    .first<{ prompt: string; checklist: string | null; final_answer: string | null }>();
  if (!card) return finish(env, job.id, { error: 'card_missing' }, Date.now());
  const result = await callClaude(env, {
    system: GRADER_SYSTEM,
    user: gradingInput({ prompt: card.prompt, final_answer: card.final_answer, checklist: card.checklist ? (JSON.parse(card.checklist) as string[]) : [] }, job.input!),
    schema: schemaFor('grade'),
    maxTokens: MAX_TOKENS.grade,
    timeoutMs: TIMEOUT_MS.grade,
  });
  await recordUsage(env, job, result, Date.now());
  if (!result.ok) return result.error === 'api' && result.retry ? requeue(env, job, Date.now()) : finish(env, job.id, { error: result.error }, Date.now());
  const parsed = GradeResult.safeParse(parseJson(result.text));
  return finish(env, job.id, parsed.success ? { result: parsed.data } : { error: 'invalid_output' }, Date.now());
}

/** 대화에서 save_learning 입력을 만든다. 도메인 검사에 걸리면 고칠 점을 주고 한 번 더 만든다 */
async function runImport(env: Env, job: JobRow): Promise<void> {
  let user = importInput(job.input!);
  for (let round = 0; round < 2; round++) {
    const result = await callClaude(env, { system: IMPORT_SYSTEM, user, schema: schemaFor('import'), maxTokens: MAX_TOKENS.import, timeoutMs: TIMEOUT_MS.import });
    await recordUsage(env, job, result, Date.now());
    if (!result.ok) return result.error === 'api' && result.retry ? requeue(env, job, Date.now()) : finish(env, job.id, { error: result.error }, Date.now());
    const parsed = SaveLearningInput.safeParse(parseJson(result.text));
    const problems = parsed.success
      ? checkSaveLearning(parsed.data)
      : parsed.error.issues.slice(0, 10).map((issue) => `${issue.path.join('.')}: ${issue.message}`);
    if (parsed.success && problems.length === 0) {
      const saved = await saveLearning(env, job.user_id, parsed.data, Date.now(), 'import');
      if (!saved.ok) return finish(env, job.id, { error: 'invalid_output' }, Date.now());
      const body: ImportResult = { session_id: saved.session_id, summary: saved.summary, duplicate: saved.duplicate };
      await finish(env, job.id, { result: body }, Date.now());
      await pushToUser(env, job.user_id, { title: '가져오기 완료', body: saved.summary.split('\n')[0]!.slice(0, 120), url: `/sessions/${saved.session_id}`, tag: 'import' }, Date.now()).catch(
        () => undefined,
      );
      return;
    }
    if (round === 1 || (await overBudget(env, job.user_id, Date.now()))) break;
    user = repairInput(job.input!, result.text.slice(0, 40_000), problems);
  }
  await finish(env, job.id, { error: 'invalid_output' }, Date.now());
  await pushToUser(env, job.user_id, { title: '가져오기 실패', body: '대화에서 카드를 만들지 못했어요. 앱에서 확인해 주세요.', url: '/import', tag: 'import' }, Date.now()).catch(
    () => undefined,
  );
}

/** 매분 Cron: 멈춘 작업을 되돌리고, 기다리는 작업 하나를 돌린다 (설계서 §11.3) */
export async function runPendingJobs(env: Env, now: number): Promise<void> {
  if (!llmConfigured(env)) return;
  await env.DB.batch([
    env.DB.prepare("UPDATE llm_jobs SET status = 'queued', updated_at = ?2 WHERE status = 'running' AND kind = 'grade' AND updated_at < ?1").bind(now - STALE_MS.grade, now),
    env.DB.prepare("UPDATE llm_jobs SET status = 'queued', updated_at = ?2 WHERE status = 'running' AND kind = 'import' AND updated_at < ?1").bind(now - STALE_MS.import, now),
    // 되돌렸는데 이미 3번 했으면 실패로 끝낸다
    env.DB.prepare("UPDATE llm_jobs SET status = 'failed', error = 'api', input = NULL WHERE status = 'queued' AND attempts >= ?1").bind(MAX_ATTEMPTS),
  ]);
  // 채점은 요청이 바로 waitUntil로 돌리므로, 1분 넘게 남은 것만 이어 받는다. 가져오기는 Cron만 돌린다
  const next = await env.DB.prepare(
    "SELECT id FROM llm_jobs WHERE status = 'queued' AND (kind = 'import' OR updated_at < ?1) ORDER BY updated_at LIMIT 1",
  )
    .bind(now - MINUTE_MS)
    .first<string>('id');
  if (next) await runJob(env, next);
}
