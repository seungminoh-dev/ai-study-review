// 자료(PDF) 이름과 섹션 이름 다루기. 서버(섹션 순서)와 PWA(보여 주기)가 같이 쓴다.
// 섹션 이름은 저장할 때 받은 범위 그대로다 (예: "프로그램 기초 (p.3–21)"). 끝의 괄호 쪽수는 따로 보여 준다.

const PAGES = /^(.*?)\s*\((pp?\.?\s*\d[^)]*)\)\s*$/i;

/** "프로그램 기초 (p.3–21)" → { name: '프로그램 기초', pages: 'p.3–21' }. 쪽수가 없으면 pages는 null */
export function splitPart(part: string): { name: string; pages: string | null } {
  const match = PAGES.exec(part);
  if (!match || !match[1]) return { name: part, pages: null };
  return { name: match[1], pages: match[2]!.replace(/\s+/g, '') };
}

/** 섹션 순서를 정하는 첫 쪽 번호. 쪽수가 없으면 null */
export function firstPage(part: string): number | null {
  const pages = splitPart(part).pages;
  const number = pages ? /\d+/.exec(pages) : null;
  return number ? Number(number[0]) : null;
}

/** 섹션 순서: 둘 다 쪽수가 있으면 쪽 순서, 아니면 저장한 순서 */
export function comparePart(a: { name: string; created_at: number }, b: { name: string; created_at: number }): number {
  const pa = firstPage(a.name);
  const pb = firstPage(b.name);
  if (pa !== null && pb !== null && pa !== pb) return pa - pb;
  return a.created_at - b.created_at;
}

/** 화면에 보여 줄 자료 이름: 끝의 .pdf를 떼고 밑줄을 띄어쓰기로 바꾼다 */
export function materialLabel(title: string): string {
  return title.replace(/\.pdf$/i, '').replaceAll('_', ' ').replace(/\s+/g, ' ').trim() || title;
}

export const isPdf = (title: string): boolean => /\.pdf$/i.test(title.trim());
