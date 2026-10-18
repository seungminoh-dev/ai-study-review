import {
  McpServer,
  createMcpHandler,
  preloadSchemas,
  type CallToolResult,
  type StandardSchemaWithJSON,
} from '@modelcontextprotocol/server';
import { ConceptKey, ReviewGrade, SaveLearningInput, checkSaveLearning } from '@moai/shared';
import saveLearningExample from '@moai/shared/fixtures/immutable-object.json';
import { z } from 'zod';
import { chatQueue, chatSubmit } from '../domain/chat-review';
import { findConcepts, type FoundConcept } from '../domain/concepts';
import { interviewChain } from '../domain/interview';
import { learnerContext } from '../domain/learner-context';
import { saveLearning } from '../domain/save-learning';
import type { Env } from '../env';
import { formatKstDate } from '../lib/kst';
import {
  FIND_CONCEPTS_DESCRIPTION,
  GET_INTERVIEW_CHAIN_DESCRIPTION,
  GET_LEARNER_CONTEXT_DESCRIPTION,
  GET_REVIEW_QUEUE_DESCRIPTION,
  SAVE_LEARNING_DESCRIPTION,
  SERVER_INSTRUCTIONS,
  SUBMIT_REVIEW_DESCRIPTION,
} from './descriptions.ko';

/** 요청마다 라우트가 authInfo.extra로 넘기는 값. 핸들러는 모듈 범위에서 한 번만 만든다. */
export interface McpDeps {
  env: Env;
  userId: string;
}

function text(message: string): CallToolResult['content'] {
  return [{ type: 'text', text: message }];
}

/**
 * 검증은 원래 스키마에 맡기고 JSON Schema 변환 결과만 기억한다.
 * SDK는 tools/list(와 2026-07-28 방식의 tools/call)마다 inputSchema를 JSON Schema로 다시 바꾸는데,
 * save_learning 스키마는 이 변환이 tools/list CPU의 40%쯤을 쓴다. SDK는 target만 넘기므로 target으로만 구분한다.
 */
function memoJsonSchema<S extends StandardSchemaWithJSON>(schema: S): S {
  const std = schema['~standard'];
  const memo = new Map<string, Record<string, unknown>>();
  const converter =
    (io: 'input' | 'output') =>
    (options: Parameters<typeof std.jsonSchema.input>[0]): Record<string, unknown> => {
      const key = `${io}:${options.target}`;
      let json = memo.get(key);
      if (!json) memo.set(key, (json = std.jsonSchema[io](options)));
      return json;
    };
  return { '~standard': { ...std, jsonSchema: { input: converter('input'), output: converter('output') } } } as S;
}

const FindConceptsInput = z.object({
  query: z.string().min(1).max(200).describe('이번 세션의 개념 이름들을 쉼표로 이은 것'),
  limit: z.int().min(1).max(20).optional(),
});

const LearnerContextInput = z.object({
  topic: z.string().min(1).max(200).optional(),
  concept_keys: z.array(ConceptKey).min(1).max(10).optional(),
});

const ReviewQueueInput = z.object({ size: z.int().min(1).max(10).optional().describe('가져올 문제 수 (기본 5)') });

const SubmitReviewInput = z.object({
  card_id: z.uuid(),
  answer: z.string().min(1).max(2000).describe('ox는 O/X, mcq·cloze는 사용자가 고른 보기 글 그대로(보기 글자도 받는다), explain은 사용자 설명 원문'),
  grade: ReviewGrade.optional().describe('explain만: 1 다시, 2 어려움, 3 좋음, 4 쉬움'),
  easy: z.boolean().optional().describe('맞혔고 사용자가 너무 쉬웠다고 할 때'),
  confidence: z.enum(['sure', 'unsure', 'guess']).optional().describe('ox·mcq·cloze: 답하기 전에 물어본 확신도 (확실, 반반, 찍음)'),
});

const InterviewChainInput = z.object({
  topic: z.string().min(1).max(200).optional(),
  concept_key: ConceptKey.optional(),
  length: z.int().min(2).max(5).optional().describe('이어서 물을 개념 수 (기본 3)'),
});

// 요청마다 CPU를 쓰는 준비 작업은 모듈 범위(isolate 시작)에서 미리 해 둔다. 이 시간은 요청 CPU에 들어가지 않는다.
// SDK도 엣지 런타임에서 preloadSchemas()를 모듈 범위에서 부르라고 안내한다.
preloadSchemas();
const SaveLearningSchema = memoJsonSchema(SaveLearningInput);
const FindConceptsSchema = memoJsonSchema(FindConceptsInput);
const LearnerContextSchema = memoJsonSchema(LearnerContextInput);
const ReviewQueueSchema = memoJsonSchema(ReviewQueueInput);
const SubmitReviewSchema = memoJsonSchema(SubmitReviewInput);
const InterviewChainSchema = memoJsonSchema(InterviewChainInput);
// SDK가 쓰는 target과 같다. 달라져도 isolate마다 첫 요청에서 한 번 더 변환할 뿐이다.
for (const schema of [SaveLearningSchema, FindConceptsSchema, LearnerContextSchema, ReviewQueueSchema, SubmitReviewSchema, InterviewChainSchema]) {
  schema['~standard'].jsonSchema.input({ target: 'draft-2020-12' });
}
// 처음 실행하는 함수는 V8이 그때 컴파일한다. 첫 tools/call이 그 비용을 내지 않도록 기획서 예시를 한 번 검사해 둔다.
const warmup = SaveLearningInput.safeParse(saveLearningExample);
if (warmup.success) checkSaveLearning(warmup.data);

function describeConcept(concept: FoundConcept): string {
  const aliases = concept.aliases.length > 0 ? ` (별칭: ${concept.aliases.join(', ')})` : '';
  const last = concept.last_judgment ? ` · 마지막 판정 [${concept.last_judgment.label}] ${formatKstDate(concept.last_judgment.created_at)}` : '';
  return `- \`${concept.key}\` ${concept.name}${aliases} · ${concept.state}${last}`;
}

function buildServer(deps: McpDeps): McpServer {
  const server = new McpServer({ name: 'moai', version: '1.1.0' }, { instructions: SERVER_INSTRUCTIONS });

  server.registerTool(
    'find_concepts',
    {
      title: '기존 개념 찾기',
      description: FIND_CONCEPTS_DESCRIPTION,
      inputSchema: FindConceptsSchema,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ query, limit }) => {
      const { found, related } = await findConcepts(deps.env, deps.userId, query, limit ?? 10, Date.now());
      if (found.length === 0) {
        return { content: text('찾은 기존 개념이 없어요. 새 개념으로 저장하면 돼요.'), structuredContent: { concepts: [], related: [] } };
      }
      const lines = [`기존 개념 ${found.length}개를 찾았어요. 같은 개념이면 이 key를 그대로 쓰세요.`, ...found.map(describeConcept)];
      if (related.length > 0) {
        lines.push('', '연결된 개념:');
        for (const concept of related) lines.push(`${describeConcept(concept)} (${concept.via.key}와 ${concept.via.type})`);
      }
      const strip = ({ id: _id, ...rest }: FoundConcept) => rest;
      return {
        content: text(lines.join('\n')),
        structuredContent: { concepts: found.map(strip), related: related.map(({ via, ...rest }) => ({ ...strip(rest), via })) },
      };
    },
  );

  server.registerTool(
    'save_learning',
    {
      title: '학습 기록 저장',
      description: SAVE_LEARNING_DESCRIPTION,
      inputSchema: SaveLearningSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (input) => {
      const result = await saveLearning(deps.env, deps.userId, input, Date.now());
      if (!result.ok) {
        return { isError: true, content: text(`저장하지 않았어요. 아래를 고쳐서 다시 호출해 주세요.\n- ${result.problems.join('\n- ')}`) };
      }
      return {
        content: text(result.summary),
        structuredContent: {
          session_id: result.session_id,
          duplicate: result.duplicate,
          counts: result.counts,
          review_url: `${deps.env.APP_ORIGIN}/review`,
        },
      };
    },
  );

  server.registerTool(
    'get_learner_context',
    {
      title: '과거 학습 기록',
      description: GET_LEARNER_CONTEXT_DESCRIPTION,
      inputSchema: LearnerContextSchema,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ topic, concept_keys }) => {
      if (!topic && !concept_keys) return { isError: true, content: text('topic이나 concept_keys 중 하나를 넣어 주세요.') };
      const context = await learnerContext(
        deps.env,
        deps.userId,
        { ...(topic ? { topic } : {}), ...(concept_keys ? { concept_keys } : {}) },
        Date.now(),
      );
      return { content: text(context.text), structuredContent: { concepts: context.concepts } };
    },
  );

  server.registerTool(
    'get_review_queue',
    {
      title: '오늘 복습 문제',
      description: GET_REVIEW_QUEUE_DESCRIPTION,
      inputSchema: ReviewQueueSchema,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ size }) => {
      const { questions, remaining } = await chatQueue(deps.env, deps.userId, size ?? 5, Date.now());
      if (questions.length === 0) return { content: text('오늘 복습할 카드가 없어요.'), structuredContent: { questions: [], remaining: 0 } };
      const lines = [`오늘 남은 ${remaining}장 중 ${questions.length}장이에요. 한 문제씩 내고 정답은 먼저 말하지 마세요.`];
      questions.forEach((question, index) => {
        lines.push('', `${index + 1}. [${question.type}] ${question.concept} · card_id ${question.card_id}`, question.prompt);
        if (question.code) lines.push('```', question.code, '```');
        for (const choice of question.choices ?? []) lines.push(`${choice.label}. ${choice.text}`);
      });
      return { content: text(lines.join('\n')), structuredContent: { questions, remaining } };
    },
  );

  server.registerTool(
    'submit_review',
    {
      title: '복습 답 채점',
      description: SUBMIT_REVIEW_DESCRIPTION,
      inputSchema: SubmitReviewSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (input) => {
      const result = await chatSubmit(deps.env, deps.userId, input, Date.now());
      switch (result.kind) {
        case 'not_found':
          return { isError: true, content: text('복습 중인 카드가 아니에요. get_review_queue로 받은 card_id를 넣어 주세요.') };
        case 'not_due':
          return { isError: true, content: text('오늘 복습할 카드가 아니에요. 앱에서 이미 풀었거나 아직 때가 안 됐어요. get_review_queue로 새 목록을 받아 주세요.') };
        case 'busy':
          return { isError: true, content: text('다른 기기의 답과 겹쳐 기록하지 못했어요. 같은 답으로 한 번 더 불러 주세요.') };
        case 'unreadable':
          return { isError: true, content: text(result.hint) };
        case 'duplicate':
          return { content: text('방금 이 카드의 답을 기록했어요. 다음 문제로 넘어가 주세요.'), structuredContent: { duplicate: true } };
        case 'reference': {
          const lines = ['아직 기록하지 않았어요. 아래와 비교해 사용자와 등급을 정한 뒤 grade를 넣어 다시 불러 주세요.'];
          if (result.final_answer) lines.push('', `내 최종 버전: ${result.final_answer}`);
          if (result.checklist.length > 0) lines.push('', `핵심 요소: ${result.checklist.join(', ')}`);
          return { content: text(lines.join('\n')), structuredContent: { recorded: false, final_answer: result.final_answer, checklist: result.checklist } };
        }
        case 'recorded': {
          const verdict = result.correct === null ? `등급 ${result.grade}로 기록했어요.` : result.correct ? '맞았어요.' : `틀렸어요. 정답: ${result.correct_answer}`;
          const lines = [verdict];
          if (result.from_my_answer) lines.push('고른 보기는 예전에 사용자가 직접 했던 설명이에요. 그 점을 짚어 주세요.');
          if (result.confident_miss) lines.push('확신했는데 틀렸어요. 왜 그렇게 생각했는지 묻고 바로잡아 주세요. 이렇게 고친 기억이 오래 남아요.');
          if (result.explain) lines.push(`해설: ${result.explain}`);
          lines.push(`다음 복습: ${result.next} · 오늘 남은 ${result.remaining}장`);
          const { kind: _kind, ...rest } = result;
          return { content: text(lines.join('\n')), structuredContent: { recorded: true, ...rest } };
        }
      }
    },
  );

  server.registerTool(
    'get_interview_chain',
    {
      title: '꼬리물기 모의면접',
      description: GET_INTERVIEW_CHAIN_DESCRIPTION,
      inputSchema: InterviewChainSchema,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (input) => {
      const now = Date.now();
      const chain = await interviewChain(deps.env, deps.userId, input, now);
      if (!chain) return { content: text('아직 저장한 개념이 없어요. 공부한 내용을 먼저 저장해 주세요.'), structuredContent: { concepts: [] } };
      const context = await learnerContext(deps.env, deps.userId, { concept_keys: chain.keys }, now);
      const header = `물을 순서: ${chain.names.join(' → ')}\n첫 개념부터 한 질문씩 묻고, 답의 약한 곳을 파고드는 꼬리질문으로 다음 개념으로 넘어가세요. 정답은 먼저 말하지 마세요.`;
      return { content: text(`${header}\n\n${context.text}`), structuredContent: { order: chain.keys, concepts: context.concepts } };
    },
  );

  return server;
}

export const mcpHandler = createMcpHandler((ctx) => buildServer(ctx.authInfo?.extra as unknown as McpDeps), {
  legacy: 'stateless',
  onerror: (error) => console.error(JSON.stringify({ event: 'mcp_error', message: error.message })),
});
