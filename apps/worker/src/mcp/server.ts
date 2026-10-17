import { McpServer, createMcpHandler, type CallToolResult } from '@modelcontextprotocol/server';
import { SaveLearningInput, checkSaveLearning, countSaveLearning } from '@moai/shared';
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

function buildServer(deps: McpDeps): McpServer {
  const server = new McpServer({ name: 'moai', version: '0.1.0' });

  server.registerTool(
    'ping',
    { title: '연결 확인', description: PING_DESCRIPTION, inputSchema: z.object({}), annotations: { readOnlyHint: true } },
    async () => ({ content: text(`모아이 서버가 응답했어요. 서버 시각 ${new Date().toISOString()}`) }),
  );

  server.registerTool(
    'save_learning',
    {
      title: '학습 기록 저장',
      description: SAVE_LEARNING_DESCRIPTION,
      inputSchema: SaveLearningInput,
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
