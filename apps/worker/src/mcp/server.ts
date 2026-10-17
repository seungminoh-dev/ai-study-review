import {
  McpServer,
  createMcpHandler,
  preloadSchemas,
  type CallToolResult,
  type StandardSchemaWithJSON,
} from '@modelcontextprotocol/server';
import { ConceptKey, SaveLearningInput, checkSaveLearning } from '@moai/shared';
import saveLearningExample from '@moai/shared/fixtures/immutable-object.json';
import { z } from 'zod';
import { findConcepts, type FoundConcept } from '../domain/concepts';
import { learnerContext } from '../domain/learner-context';
import { saveLearning } from '../domain/save-learning';
import type { Env } from '../env';
import { formatKstDate } from '../lib/kst';
import { FIND_CONCEPTS_DESCRIPTION, GET_LEARNER_CONTEXT_DESCRIPTION, SAVE_LEARNING_DESCRIPTION, SERVER_INSTRUCTIONS } from './descriptions.ko';

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

// 요청마다 CPU를 쓰는 준비 작업은 모듈 범위(isolate 시작)에서 미리 해 둔다. 이 시간은 요청 CPU에 들어가지 않는다.
// SDK도 엣지 런타임에서 preloadSchemas()를 모듈 범위에서 부르라고 안내한다.
preloadSchemas();
const SaveLearningSchema = memoJsonSchema(SaveLearningInput);
const FindConceptsSchema = memoJsonSchema(FindConceptsInput);
const LearnerContextSchema = memoJsonSchema(LearnerContextInput);
// SDK가 쓰는 target과 같다. 달라져도 isolate마다 첫 요청에서 한 번 더 변환할 뿐이다.
for (const schema of [SaveLearningSchema, FindConceptsSchema, LearnerContextSchema]) {
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

  return server;
}

export const mcpHandler = createMcpHandler((ctx) => buildServer(ctx.authInfo?.extra as unknown as McpDeps), {
  legacy: 'stateless',
  onerror: (error) => console.error(JSON.stringify({ event: 'mcp_error', message: error.message })),
});
