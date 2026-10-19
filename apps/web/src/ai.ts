import type { AiStatus, CreditKind, JobView } from '@moai/shared';
import { CREDIT_COST, MONTHLY_CREDITS, creditsLeft } from '@moai/shared/client';
import { request } from './api';

// 서버 LLM 작업 (설계서 §11.3): 요청하면 작업 id를 받고, 끝날 때까지 1.5초마다 확인한다.

let status: Promise<AiStatus> | null = null;

/** AI를 쓸 수 있는지. 한 번 물어보고 앱을 켜 둔 동안 기억한다 */
export function aiStatus(): Promise<AiStatus> {
  status ??= request<AiStatus>('/ai/status').catch(() => {
    status = null;
    return { available: false, over_budget: false, credits: { monthly: 0, monthly_total: MONTHLY_CREDITS, held: 0, refill_at: 0 } };
  });
  return status;
}

/** 크레딧을 쓰거나 받은 뒤에 부른다. 다음에 다시 물어본다 */
export function forgetAiStatus(): void {
  status = null;
}

/** AI가 켜져 있고 그 일에 쓸 크레딧이 남았다 */
export const canUseAi = (value: AiStatus, kind: CreditKind): boolean => value.available && !value.over_budget && creditsLeft(value.credits) >= CREDIT_COST[kind];

export async function waitForJob(id: string, timeoutMs = 60_000, signal?: AbortSignal): Promise<JobView> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const job = await request<JobView>(`/jobs/${id}`);
    if (job.status === 'done' || job.status === 'failed') return job;
    if (Date.now() > deadline || signal?.aborted) return job;
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
}

export const JOB_ERROR: Record<string, string> = {
  budget: '이번 달 AI 한도에 닿았어요. 자가 채점으로 진행해요.',
  refusal: 'AI가 이 글은 처리하지 않겠다고 했어요.',
  truncated: '결과가 너무 길어서 잘렸어요.',
  invalid_output: 'AI 결과를 읽지 못했어요.',
  api: 'AI 서버에 연결하지 못했어요. 잠시 뒤에 다시 해 주세요.',
  card_missing: '카드를 찾지 못했어요.',
  unavailable: '서버에 AI 설정이 없어요.',
};
