import type { CreditBalance } from './credits';
import { z } from 'zod';

// 서버 LLM (설계서 §11): 설명하기 AI 채점과 붙여넣기 가져오기의 입출력.

import { MAX_IMPORT_CHARS } from './llm-limits';
import { ConceptKey } from './save-learning';

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
  /** 내가 고른 답 (보기 글 그대로, OX는 O·X). 설명하기 카드면 내가 쓴 설명 */
  picked: z.string().trim().max(2000).optional(),
  /** 같은 카드에서 앞서 주고받은 질문과 답. 이어지는 질문에 쓴다 */
  history: z
    .array(z.object({ question: z.string().max(300), answer: z.string().max(2000) }))
    .max(2)
    .default([]),
});
export type AskBody = z.infer<typeof AskBody>;

export const AskResult = z.object({ answer: z.string().min(1).max(2000) });

/** AI 개념 채팅 2차: 주고받은 대화로 카드를 만든다 (붙여넣기 가져오기와 같은 작업으로 돈다) */
export const AskCardsBody = z.object({
  picked: z.string().trim().max(2000).optional(),
  turns: z
    .array(z.object({ question: z.string().trim().min(1).max(300), answer: z.string().trim().min(1).max(2000) }))
    .min(1)
    .max(6),
});
export type AskCardsBody = z.infer<typeof AskCardsBody>;

export interface AskResponse {
  answer: string;
  /** 쓰고 남은 AI 크레딧 */
  credits: CreditBalance;
}

/** 앱 안 모의면접 (MCP get_interview_chain과 같은 순서): 한 질문씩 주고받는다. 대화는 기기가 들고 있다가 함께 보낸다 */
const InterviewTurn = z.object({ question: z.string().trim().min(1).max(500), answer: z.string().trim().max(2000) });

/** 직접 고른 주제. 내 개념과 맞으면 그 개념에서, 없으면 기록 없이 그 주제로 묻는다 */
const InterviewTopic = z.string().trim().min(1).max(60);

export const InterviewBody = z.object({
  /** 첫 질문을 받을 때: 이 개념에서 시작한다 (없으면 최근에 많이 틀린 개념) */
  concept_key: ConceptKey.optional(),
  category: z.string().max(80).optional(),
  topic: InterviewTopic.optional(),
  /** 질문 수와 이어 갈 개념 수 (INTERVIEW_DEPTHS) */
  depth: z.enum(['light', 'normal', 'deep']).default('normal'),
  /** 난이도 (INTERVIEW_LEVELS) */
  level: z.enum(['basic', 'practical', 'advanced']).default('practical'),
  /** 첫 응답이 정한 개념 순서. 다음 질문부터 그대로 보낸다 (기록 없는 주제면 비어 있고 topic을 다시 보낸다) */
  keys: z.array(ConceptKey).min(1).max(5).optional(),
  turns: z.array(InterviewTurn).max(10).default([]),
});
export type InterviewBody = z.infer<typeof InterviewBody>;

export const InterviewSaveBody = z
  .object({ keys: z.array(ConceptKey).max(5).default([]), topic: InterviewTopic.optional(), turns: z.array(InterviewTurn).min(1).max(10) })
  .refine((body) => body.keys.length > 0 || body.topic !== undefined, '면접한 개념이나 주제가 있어야 해요');

export const InterviewQuestion = z.object({ question: z.string().min(1).max(500), concept_key: z.string().max(60) });
export const InterviewSummary = z.object({ good: z.array(z.string().max(200)).max(5), fix: z.array(z.string().max(200)).max(5) });
export type InterviewSummary = z.infer<typeof InterviewSummary>;

/** 모의면접 시작 화면의 추천 주제 */
export interface InterviewTopicSuggestion {
  /** 시작할 개념 */
  concept_key: string;
  /** 이어 갈 개념 이름 (미리 보기) */
  names: string[];
  /** 왜 추천했는지 */
  reason: string;
}

export interface InterviewResponse {
  /** 물을 개념 순서. 기록 없는 주제로 묻는 중이면 비어 있다 */
  keys: string[];
  names: string[];
  /** 이 면접에서 물을 질문 수 */
  total: number;
  /** 다음 질문. 마지막 답을 보냈으면 null이고 summary가 온다 */
  question: { question: string; concept_key: string } | null;
  summary: InterviewSummary | null;
  /** 쓰고 남은 AI 크레딧 */
  credits: CreditBalance;
}

export interface AiStatus {
  /** 서버에 API 키와 모델이 설정되어 있다 */
  available: boolean;
  /** 서비스 전체의 이번 달 AI 비용 한도에 닿았다 (운영자 안전장치) */
  over_budget: boolean;
  /** 내 AI 크레딧 */
  credits: CreditBalance;
}

export interface UsageReport {
  month_start: number;
  total_usd: number;
  monthly_cap_usd: number;
  by_user: { name: string; usd: number; calls: number }[];
  by_kind: { kind: string; usd: number; calls: number }[];
  by_model: { model: string; usd: number; calls: number; input_tokens: number; output_tokens: number }[];
  jobs: { status: string; kind: string; error: string | null; n: number }[];
}
