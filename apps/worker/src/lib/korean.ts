/** 마지막 글자에 받침이 있으면 true. 한글이 아니면 받침이 없다고 본다. */
export function hasFinalConsonant(text: string): boolean {
  const code = text.charCodeAt(text.length - 1);
  return code >= 0xac00 && code <= 0xd7a3 && (code - 0xac00) % 28 !== 0;
}

/** 목적격 조사 을/를을 붙인다. "카드 7장" → "카드 7장을", "질문 2개" → "질문 2개를" */
export function withObject(text: string): string {
  return `${text}${hasFinalConsonant(text) ? '을' : '를'}`;
}
