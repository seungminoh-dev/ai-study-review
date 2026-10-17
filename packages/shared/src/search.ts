// 개념 찾기용 정규화 (설계서 §6.6). D1은 LIKE 패턴을 50바이트로 제한해서, 저장할 때 정규화해 둔 값을 instr()로 찾는다.

/** 소문자로 바꾸고 글자·숫자가 아닌 것을 모두 지운다. "깊은 복사" → "깊은복사", "deep-copy" → "deepcopy" */
export function normalizeSearch(text: string): string {
  return text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

/** concepts.search_text. 이름·별칭·key를 정규화해 '|'로 잇는다. 앞뒤에도 '|'를 둔다. */
export function searchText(parts: readonly string[]): string {
  const normalized = [...new Set(parts.map(normalizeSearch).filter(Boolean))];
  return `|${normalized.join('|')}|`;
}

/** 쉼표·줄바꿈으로 나눈 검색어를 정규화한다. 빈 값과 중복은 뺀다. */
export function searchTerms(query: string, max = 10): string[] {
  const terms = query.split(/[,，、\n]/).map(normalizeSearch).filter(Boolean);
  return [...new Set(terms)].slice(0, max);
}
