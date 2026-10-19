import { z } from 'zod';

// 서버 LLM (설계서 §11): 설명하기 AI 채점과 붙여넣기 가져오기의 입출력.

import { MAX_IMPORT_CHARS } from './llm-limits';

export { MAX_IMPORT_CHARS };

export const GradeAiBody = z.object({ answer: z.string().trim().min(1).max(2000) });
export const ImportBody = z.object({ text: z.string().trim().min(200, '대화가 너무 짧아요').max(MAX_IMPORT_CHARS) });

/** AI 채점 결과 (설계서 §11.2). 모범답안은 넣지 않는다 */
export const GradeResult = z.object({
  sentences: z
    .array(z.object({ quote: z.string().max(600), label: z.enum(['맞음', '애매', '틀림', '빠짐']), reason: z.string().max(300) }))
    .max(30),
  top_down: z.object({ ok: z.boolean(), note: z.string().max(300) }),
  missing: z.array(z.string().max(120)).max(10),
  coaching_question: z.string().max(300),
  suggested_grade: z.enum(['again', 'hard', 'good', 'easy']),
});
export type GradeResult = z.infer<typeof GradeResult>;

export type JobStatus = 'queued' | 'running' | 'done' | 'failed';

export interface JobView {
  id: string;
  kind: 'grade' | 'import';
  status: JobStatus;
  /** 실패 이유: budget, refusal, truncated, invalid_output, api, card_missing, unavailable */
  error: string | null;
  created_at: number;
  /** 채점: GradeResult. 가져오기: { session_id, cards, summary } */
  result: unknown;
}

export interface ImportResult {
  session_id: string;
  summary: string;
  duplicate: boolean;
}

/** AI 개념 채팅 (3단계 시안): 복습에서 틀린 카드의 개념을 묻는다. 카드와 내 정리는 서버가 DB에서 읽는다 */
export const AskBody = z.object({
  question: z.string().trim().min(1).max(300),
  /** 내가 고른 답 (보기 글 그대로, OX는 O·X) */
  picked: z.string().trim().max(300).optional(),
  /** 같은 카드에서 앞서 주고받은 질문과 답. 이어지는 질문에 쓴다 */
  history: z
    .array(z.object({ question: z.string().max(300), answer: z.string().max(2000) }))
    .max(2)
    .default([]),
});
export type AskBody = z.infer<typeof AskBody>;

export const AskResult = z.object({ answer: z.string().min(1).max(2000) });

export interface AskResponse {
  answer: string;
  /** 이번 달 남은 질문 수 */
  left: number;
}

export interface AiStatus {
  /** 서버에 API 키와 모델이 설정되어 있다 */
  available: boolean;
  /** 이번 달 한도에 닿았다 */
  over_budget: boolean;
  /** 이번 달 남은 개념 질문 수 */
  ask_left: number;
}

export interface UsageReport {
  month_start: number;
  total_usd: number;
  monthly_cap_usd: number;
  user_cap_usd: number;
  by_user: { name: string; usd: number; calls: number }[];
  by_kind: { kind: string; usd: number; calls: number }[];
  by_model: { model: string; usd: number; calls: number; input_tokens: number; output_tokens: number }[];
  jobs: { status: string; kind: string; error: string | null; n: number }[];
}
