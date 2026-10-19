import { splitPart } from '@moai/shared/client';

// 자료 화면들이 같이 쓰는 주소와 표시 도우미

/** 자료(또는 그 섹션 하나)를 푸는 복습 주소. part가 null이면 자료 전체, 빈 문자열이면 이름 없는 섹션 */
export function materialReview(title: string, part: string | null, size = 10): string {
  const params = new URLSearchParams({ material: title, size: String(size) });
  if (part !== null) params.set('part', part);
  return `/review?${params}`;
}

/** 랜덤 시험 주소: 한 번이라도 푼 카드에서 10문제. 자료나 섹션으로 좁힐 수 있다 (기록하지 않는다) */
export function examHref(scope: { material?: string; part?: string } = {}): string {
  const params = new URLSearchParams({ mode: 'random', size: '10' });
  if (scope.material) params.set('material', scope.material);
  if (scope.part !== undefined) params.set('part', scope.part);
  return `/review?${params}`;
}

/** 자료 상세(섹션 목록) 주소 */
export const materialHref = (title: string) => `/materials/detail?${new URLSearchParams({ title })}`;

/**
 * 섹션을 보여 줄 모양: 번호 배지, 이름, 쪽수.
 * 이름이 "5. 상속"처럼 번호로 시작하면 그 번호를 배지에 쓰고 이름에서 뺀다 (일부 장만 저장해도 원래 장 번호가 남는다).
 * 번호가 없으면 순서(index)로 매긴다.
 */
export function partView(part: string, index: number, label?: string): { no: string; name: string; pages: string | null } {
  const { name, pages } = splitPart(part);
  const lead = /^(\d{1,3})[.)]\s+(\S.*)$/.exec(name);
  // 사용자가 바꾼 이름이 있으면 이름만 바꾸고 번호와 쪽수는 원래 것을 쓴다
  return { no: (lead ? lead[1]! : String(index + 1)).padStart(2, '0'), name: label || (lead ? lead[2]! : name || '이름 없는 섹션'), pages };
}
