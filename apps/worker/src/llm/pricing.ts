// 비용 계산 (설계서 §11.5). 단가표는 등급(이름에 든 낱말)으로 고른다. 모르는 모델은 가장 비싼 단가로 센다.
// 단가는 보수적으로 잡는다: 실제보다 높게 세면 예산 한도에 조금 일찍 닿을 뿐 돈이 더 나가지는 않는다.
// 실제 청구는 Anthropic Console에서 확인한다.

export interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  /** server-side fallback이 돌면 모델마다(거절한 모델 포함) 한 줄씩 온다 */
  iterations?: (Usage & { model?: string | null; type?: string })[] | null;
}

/** 100만 토큰당 달러 = 토큰당 마이크로달러 */
const PRICES: { match: string; input: number; output: number }[] = [
  { match: 'haiku', input: 1, output: 5 },
  { match: 'sonnet', input: 3, output: 15 },
  { match: 'opus', input: 5, output: 25 },
];
const UNKNOWN = { input: 10, output: 50 };

/** 응답 전체의 비용. 모델별 줄이 있으면 줄마다 그 모델 단가로 더하고, 맨 위 합계로 센 값과 비교해 큰 쪽을 쓴다 */
export function costMicroUsd(model: string, usage: Usage): number {
  const total = hopCost(model, usage);
  const hops = (usage.iterations ?? []).filter((hop) => hop.type !== 'compaction');
  if (hops.length === 0) return total;
  return Math.max(total, hops.reduce((sum, hop) => sum + hopCost(hop.model ?? model, hop), 0));
}

function hopCost(model: string, usage: Usage): number {
  const price = PRICES.find((entry) => model.toLowerCase().includes(entry.match)) ?? UNKNOWN;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  return Math.ceil(
    usage.input_tokens * price.input + usage.output_tokens * price.output + cacheRead * price.input * 0.1 + cacheWrite * price.input * 1.25,
  );
}
