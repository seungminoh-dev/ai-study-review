import { GradeResult, SaveLearningInput, checkSaveLearning, type ImportResult } from '@moai/shared';
import { z } from 'zod';
import { pushToUser } from '../domain/push';
import { saveLearning } from '../domain/save-learning';
import type { Env } from '../env';
import { MINUTE_MS } from '../lib/kst';
import { callClaude, llmConfigured, parseJson, type CallResult } from './anthropic';
import { overBudget } from './budget';
import { costMicroUsd, type Usage } from './pricing';
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
/** 한 사람이 동시에 기다리게 할 수 있는 작업 수 (종류마다) */
export const MAX_PENDING = 3;
/** 이만큼 running으로 멈춰 있으면 실행이 죽었다고 보고 되돌린다. 아래 시간 제한(가져오기는 2번)보다 길어야 한다 */
const STALE_MS: Record<JobKind, number> = { grade: 3 * MINUTE_MS, import: 15 * MINUTE_MS };
/**
 * API 한 번을 기다리는 시간. 요청 뒤 waitUntil은 30초까지만 살아 있어서 채점은 25초에 끊고 Cron이 이어 받는다.
 * Cron은 15분까지 돌 수 있다. 가져오기는 고치는 한 번까지 2번 부르므로 6분씩이다.
 */
const TIMEOUT_MS = { request: 25_000, grade: 90_000, import: 6 * MINUTE_MS };
const MAX_TOKENS: Record<JobKind, number> = { grade: 4096, import: 16000 };

let gradeSchema: Record<string, unknown> | null = null;
let importSchema: Record<string, unknown> | null = null;
const schemaFor = (kind: JobKind) =>
  kind === 'grade'
    ? (gradeSchema ??= toOutputSchema(z.toJSONSchema(GradeResult, { target: 'draft-2020-12' }) as Record<string, unknown>))
    : (importSchema ??= toOutputSchema(z.toJSONSchema(SaveLearningInput, { target: 'draft-2020-12', io: 'input' }) as Record<string, unknown>));

/**
 * 작업을 만든다. 끝나지 않은 같은 종류 작업이 이미 MAX_PENDING개면 만들지 않고 null.
 * 세기와 넣기를 한 문장으로 해서, 동시에 여러 번 보내도 상한을 넘지 않는다.
 */
export async function createJob(
  env: Env,
  userId: string,
  kind: JobKind,
  input: string,
  extra: { cardId?: string; inputHash?: string },
  now: number,
): Promise<string | null> {
  const id = crypto.randomUUID();
  const inserted = await env.DB.prepare(
    `INSERT INTO llm_jobs (id, user_id, kind, status, card_id, input, input_hash, created_at, updated_at)
     SELECT ?1, ?2, ?3, 'queued', ?4, ?5, ?6, ?7, ?7
      WHERE (SELECT count(*) FROM llm_jobs WHERE user_id = ?2 AND kind = ?3 AND status IN ('queued', 'running')) < ?8`,
  )
    .bind(id, userId, kind, extra.cardId ?? null, input, extra.inputHash ?? null, now, MAX_PENDING)
    .run();
  return inserted.meta.changes > 0 ? id : null;
}

/** 비용 기록. 그사이 계정이 지워졌으면 'deleted'로 남긴다 (이번 달 합계는 맞아야 한다) */
async function insertUsage(env: Env, job: JobRow, model: string, usage: Usage, now: number): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO llm_usage (id, user_id, job_id, kind, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_micro_usd, created_at)
     SELECT ?1, coalesce((SELECT id FROM users WHERE id = ?2), 'deleted'), ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11`,
  )
    .bind(
      crypto.randomUUID(),
      job.user_id,
      job.id,
      job.kind,
      model,
      usage.input_tokens,
      usage.output_tokens,
      usage.cache_read_input_tokens ?? 0,
      usage.cache_creation_input_tokens ?? 0,
      costMicroUsd(model, usage),
      now,
    )
    .run();
}

async function recordUsage(env: Env, job: JobRow, result: CallResult, request: { user: string; maxTokens: number }, now: number): Promise<void> {
  if (result.usage) return insertUsage(env, job, result.model, result.usage, now);
  // 기다리다 끊었으면 응답은 못 받았어도 청구됐을 수 있다. 입력은 글자 수로, 출력은 최대치로 넉넉히 적는다
  if (result.error === 'api' && result.timedOut) {
    await insertUsage(env, job, `${env.GRADER_MODEL} (시간 초과, 예상)`, { input_tokens: Math.ceil(request.user.length / 2) + 2000, output_tokens: request.maxTokens }, now);
  }
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

/**
 * queued인 작업 하나를 맡아서 끝까지 돌린다. 이미 다른 실행이 맡았으면 아무것도 하지 않는다.
 * from: 'request'는 요청 뒤 waitUntil(30초까지), 'cron'은 매분 Cron(15분까지)에서 부른다.
 */
export async function runJob(env: Env, id: string, from: 'request' | 'cron' = 'cron'): Promise<void> {
  const job = await env.DB.prepare(
    "UPDATE llm_jobs SET status = 'running', attempts = attempts + 1, updated_at = ?2 WHERE id = ?1 AND status = 'queued' RETURNING id, user_id, kind, card_id, input, attempts",
  )
    .bind(id, Date.now())
    .first<JobRow>();
  if (!job) return;
  try {
    if (!llmConfigured(env) || !job.input) return await finish(env, job.id, { error: 'unavailable' }, Date.now());
    if (await overBudget(env, job.user_id, Date.now())) return await finish(env, job.id, { error: 'budget' }, Date.now());
    if (job.kind === 'grade') await runGrade(env, job, from === 'request' ? TIMEOUT_MS.request : TIMEOUT_MS.grade);
    else await runImport(env, job);
  } catch (error) {
    console.error(JSON.stringify({ event: 'llm_job_crashed', job_id: job.id, kind: job.kind, message: (error as Error).message }));
    await requeue(env, job, Date.now()).catch(() => undefined);
  }
}

async function runGrade(env: Env, job: JobRow, timeoutMs: number): Promise<void> {
  const card = await env.DB.prepare(
    `SELECT c.prompt, c.checklist, k.final_answer FROM cards c JOIN concepts k ON k.id = c.concept_id
      WHERE c.id = ?1 AND c.user_id = ?2 AND c.type = 'explain'`,
  )
    .bind(job.card_id, job.user_id)
    .first<{ prompt: string; checklist: string | null; final_answer: string | null }>();
  if (!card) return finish(env, job.id, { error: 'card_missing' }, Date.now());
  const request = {
    system: GRADER_SYSTEM,
    user: gradingInput({ prompt: card.prompt, final_answer: card.final_answer, checklist: card.checklist ? (JSON.parse(card.checklist) as string[]) : [] }, job.input!),
    schema: schemaFor('grade'),
    maxTokens: MAX_TOKENS.grade,
    timeoutMs,
  };
  const result = await callClaude(env, request);
  await recordUsage(env, job, result, request, Date.now());
  if (!result.ok) return result.error === 'api' && result.retry ? requeue(env, job, Date.now()) : finish(env, job.id, { error: result.error }, Date.now());
  const parsed = GradeResult.safeParse(parseJson(result.text));
  return finish(env, job.id, parsed.success ? { result: parsed.data } : { error: 'invalid_output' }, Date.now());
}

/** 대화에서 save_learning 입력을 만든다. 도메인 검사에 걸리면 고칠 점을 주고 한 번 더 만든다 */
async function runImport(env: Env, job: JobRow): Promise<void> {
  let user = importInput(job.input!);
  for (let round = 0; round < 2; round++) {
    const request = { system: IMPORT_SYSTEM, user, schema: schemaFor('import'), maxTokens: MAX_TOKENS.import, timeoutMs: TIMEOUT_MS.import };
    const result = await callClaude(env, request);
    await recordUsage(env, job, result, request, Date.now());
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
  if (!llmConfigured(env)) {
    // 설정을 지웠으면 기다리던 작업은 끝내고 원문을 지운다
    await env.DB.prepare("UPDATE llm_jobs SET status = 'failed', error = 'unavailable', input = NULL, updated_at = ?1 WHERE status IN ('queued', 'running')")
      .bind(now)
      .run();
    return;
  }
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
