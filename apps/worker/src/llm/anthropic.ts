import { raiseAlert } from '../domain/alerts';
import type { Env } from '../env';
import type { Usage } from './pricing';
import { anthropicRelay } from './relay';

// Claude Messages API를 부른다 (설계서 §11.1). SDK는 Worker 번들을 키우고, 쓰는 기능이 적어서 넣지 않는다.
// 키(ANTHROPIC_API_KEY)는 서버에만 있다. 브라우저로 보내거나 로그에 남기지 않는다.
// 실제 fetch는 미국 위치의 중계(relay.ts)가 한다. 홍콩 데이터센터에서 나간 호출은 Anthropic이 거절하기 때문이다.

export interface CallRequest {
  system: string;
  user: string;
  schema: Record<string, unknown>;
  maxTokens: number;
  timeoutMs: number;
}

export type CallResult =
  | { ok: true; text: string; model: string; usage: Usage }
  /** 돈은 들었지만 쓸 수 없는 응답 (거절, 잘림) */
  | { ok: false; error: 'refusal' | 'truncated' | 'empty'; model: string; usage: Usage }
  /** 요청이 실패했다. retry면 잠시 뒤에 다시 해 볼 만하다 */
  | { ok: false; error: 'api'; retry: boolean; status: number; timedOut?: boolean; model?: undefined; usage?: undefined };

export function llmConfigured(env: Env): boolean {
  return Boolean(env.ANTHROPIC_API_KEY && env.GRADER_MODEL);
}

interface MessageResponse {
  model?: string;
  stop_reason?: string;
  content?: { type: string; text?: string }[];
  usage?: Usage;
}

async function post(env: Env, body: Record<string, unknown>, beta: boolean, timeoutMs: number): Promise<Response> {
  const result = await anthropicRelay(env).post(JSON.stringify(body), beta, timeoutMs);
  // 중계에서 끊긴 요청은 여기서 던져, 직접 fetch하던 때와 같은 길(시간 초과·연결 실패)로 처리한다
  if (result.timedOut) throw new DOMException('Anthropic API를 기다리다 끊었어요', 'TimeoutError');
  if (result.networkError !== undefined) throw new Error(result.networkError);
  return new Response(result.body, { status: result.status });
}

export async function callClaude(env: Env, request: CallRequest): Promise<CallResult> {
  const base = {
    model: env.GRADER_MODEL,
    max_tokens: request.maxTokens,
    // 채점 기준은 고정 문자열이라 캐시 지점을 건다. 사용자 글은 그 뒤에 온다
    system: [{ type: 'text', text: request.system, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: request.user }],
  };
  // 안전 분류기가 거절하면 다른 모델로 다시 처리하는 server-side fallback, 생각을 줄이는 effort low, structured outputs
  const full = { ...base, fallbacks: 'default', output_config: { effort: 'low', format: { type: 'json_schema', schema: request.schema } } };
  let response: Response;
  try {
    response = await post(env, full, true, request.timeoutMs);
    // 모델이 effort나 fallback을 받지 않으면 400이 온다. 그때는 형식만 남기고 한 번 더 보낸다
    if (response.status === 400) {
      const reason = await response.text();
      console.warn(JSON.stringify({ event: 'llm_bad_request', retrying: true, message: reason.slice(0, 300) }));
      response = await post(env, { ...base, output_config: { format: { type: 'json_schema', schema: request.schema } } }, false, request.timeoutMs);
    }
  } catch (error) {
    // 기다리다 끊은 요청도 Anthropic 쪽에서는 끝까지 돌고 청구될 수 있다. 부르는 쪽이 비용을 넉넉히 적어 둔다
    const timedOut = (error as Error).name === 'TimeoutError' || (error as Error).name === 'AbortError';
    console.error(JSON.stringify({ event: timedOut ? 'llm_timeout' : 'llm_network_error', message: (error as Error).message }));
    await raiseAlert(env, 'llm_failed');
    return { ok: false, error: 'api', retry: true, status: 0, timedOut };
  }
  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 300);
    console.error(JSON.stringify({ event: 'llm_api_error', status: response.status, message: detail }));
    await raiseAlert(env, 'llm_failed');
    // 429 한도, 500대 서버 오류, 529 과부하는 다시 해 볼 만하다. 400·401·403·404는 설정 문제다
    return { ok: false, error: 'api', retry: response.status === 429 || response.status >= 500, status: response.status };
  }
  const message = (await response.json()) as MessageResponse;
  const model = message.model ?? env.GRADER_MODEL!;
  const usage: Usage = message.usage ?? { input_tokens: 0, output_tokens: 0 };
  if (message.stop_reason === 'refusal') return { ok: false, error: 'refusal', model, usage };
  if (message.stop_reason === 'max_tokens') return { ok: false, error: 'truncated', model, usage };
  const text = message.content?.find((block) => block.type === 'text')?.text ?? '';
  if (!text) return { ok: false, error: 'empty', model, usage };
  return { ok: true, text, model, usage };
}

export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    // structured outputs면 순수 JSON이지만, 혹시 코드 블록으로 감싸 오면 벗긴다
    const match = /\{[\s\S]*\}/.exec(text);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}
