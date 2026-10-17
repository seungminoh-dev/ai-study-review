import {
  McpServer,
  createMcpHandler,
  preloadSchemas,
  type CallToolResult,
  type StandardSchemaWithJSON,
} from '@modelcontextprotocol/server';
import { SaveLearningInput, checkSaveLearning, countSaveLearning } from '@moai/shared';
import saveLearningExample from '@moai/shared/fixtures/immutable-object.json';
import { z } from 'zod';
import type { Env } from '../env';
import { PING_DESCRIPTION, SAVE_LEARNING_DESCRIPTION } from './descriptions.ko';

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

// 무료 플랜은 요청마다 CPU 10ms까지만 쓸 수 있고, 모듈 평가(isolate 시작) 시간은 여기에 들어가지 않는다.
// 그래서 요청마다 반복되는 준비 작업은 모듈 범위에서 미리 해 둔다. SDK도 엣지 런타임에 이렇게 하라고 안내한다.
preloadSchemas();
const PingInput = memoJsonSchema(z.object({}));
const SaveLearningSchema = memoJsonSchema(SaveLearningInput);
// SDK가 쓰는 target과 같다. 달라져도 isolate마다 첫 요청에서 한 번 더 변환할 뿐이다.
for (const schema of [PingInput, SaveLearningSchema]) schema['~standard'].jsonSchema.input({ target: 'draft-2020-12' });
// 처음 실행하는 함수는 V8이 그때 컴파일한다. 첫 tools/call이 그 비용을 내지 않도록 기획서 예시를 한 번 검사해 둔다.
const warmup = SaveLearningInput.safeParse(saveLearningExample);
if (warmup.success) checkSaveLearning(warmup.data);

function buildServer(deps: McpDeps): McpServer {
  const server = new McpServer({ name: 'moai', version: '0.1.0' });

  server.registerTool(
    'ping',
    { title: '연결 확인', description: PING_DESCRIPTION, inputSchema: PingInput, annotations: { readOnlyHint: true } },
    async () => ({ content: text(`모아이 서버가 응답했어요. 서버 시각 ${new Date().toISOString()}`) }),
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
      const problems = checkSaveLearning(input);
      if (problems.length > 0) {
        return { isError: true, content: text(`저장하지 않았어요. 아래를 고쳐서 다시 호출해 주세요.\n- ${problems.join('\n- ')}`) };
      }
      // MVP 0: 검증을 통과한 원본만 남긴다. MVP 1에서 설계서 §6.5의 저장 절차로 바꾼다.
      const counts = countSaveLearning(input);
      const id = crypto.randomUUID();
      await deps.env.DB.prepare('INSERT INTO spike_log (id, received_at, topic, counts, payload) VALUES (?1, ?2, ?3, ?4, ?5)')
        .bind(id, Date.now(), input.topic, JSON.stringify(counts), JSON.stringify(input))
        .run();
      return {
        content: text(
          `[MVP 0 테스트] 개념 ${counts.concepts}개, 카드 ${counts.cards}장, 판정 ${counts.judgments}개, 다음에 볼 질문 ${counts.followups}개를 받았어요. 아직 복습 화면은 없어서 원본만 저장했어요.`,
        ),
        structuredContent: { spike_id: id, counts },
      };
    },
  );

  return server;
}

export const mcpHandler = createMcpHandler((ctx) => buildServer(ctx.authInfo?.extra as unknown as McpDeps), {
  legacy: 'stateless',
  onerror: (error) => console.error(JSON.stringify({ event: 'mcp_error', message: error.message })),
});
