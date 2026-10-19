import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../env';

// Anthropic API 호출을 미국에서 내보내는 중계 (2026-10-20).
// Worker는 요청을 받은 Cloudflare 데이터센터에서 돈다. 한국 요청은 홍콩(HKG)으로 자주 가는데, 그러면 Anthropic 호출도 홍콩에서 나가고
// Anthropic은 지원하지 않는 지역이라 403 "Request not allowed"로 거절한다. 그래서 호출만 미국 동부 위치를 지정한 Durable Object에서 한다.
// 이 객체는 외부 주소가 없고 바인딩(ANTHROPIC_RELAY)으로만 부른다. 보내는 곳은 Messages API 하나로 고정이고, 본문과 키는 로그에 남기지 않는다.

const API_URL = 'https://api.anthropic.com/v1/messages';
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

export interface RelayResult {
  status: number;
  body: string;
  /** 기다리다 끊었다. 청구됐을 수 있다 */
  timedOut?: boolean;
  /** 연결하지 못했다 */
  networkError?: string;
}

export class AnthropicRelay extends DurableObject<Env> {
  /** 이 인스턴스가 깨어난 뒤 위치를 로그에 남겼는지 */
  private located = false;

  /** Messages API에 본문(JSON 문자열)을 그대로 보내고 상태와 응답 글을 돌려준다. 저장소는 쓰지 않는다 */
  async post(body: string, beta: boolean, timeoutMs: number): Promise<RelayResult> {
    try {
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'x-api-key': this.env.ANTHROPIC_API_KEY!,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
          ...(beta ? { 'anthropic-beta': FALLBACK_BETA } : {}),
        },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!this.located) {
        this.located = true;
        // 깨어날 때 한 번, 이 중계가 도는 데이터센터를 남긴다. Anthropic 앞단(Cloudflare)이 붙이는 cf-ray의 끝(IAD 같은 코드)이 그곳이다
        const ray = response.headers.get('cf-ray');
        console.log(JSON.stringify({ event: 'llm_relay_location', colo: ray?.split('-').pop() ?? '-', status: response.status }));
      }
      return { status: response.status, body: await response.text() };
    } catch (error) {
      const { name, message } = error as Error;
      if (name === 'TimeoutError' || name === 'AbortError') return { status: 0, body: '', timedOut: true };
      return { status: 0, body: '', networkError: message.slice(0, 200) };
    }
  }
}

/** 미국 동부(enam)에 둔 중계 하나. 위치 힌트는 처음 만들 때 쓰이고, 그 뒤로는 그 자리에서 돈다 */
export function anthropicRelay(env: Env): DurableObjectStub<AnthropicRelay> {
  return env.ANTHROPIC_RELAY.get(env.ANTHROPIC_RELAY.idFromName('anthropic-enam'), { locationHint: 'enam' });
}
