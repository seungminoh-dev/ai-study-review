import type { MaterialSummary } from '@moai/shared';
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

const PICK = 'moai:material';

/** 이 기기에서 고르거나 풀기 시작한 자료를 적어 둔다. 학습 탭, 오늘 화면, 복습 끝 화면이 이 자료로 이어서 연다 */
export function rememberMaterial(title: string): void {
  try {
    localStorage.setItem(PICK, JSON.stringify({ title, at: Date.now() }));
  } catch {
    // 못 적으면 마지막으로 푼 자료를 따른다
  }
}

/** 로그아웃하면 지운다. 같은 기기의 다음 사람에게 남기지 않는다 */
export function forgetMaterial(): void {
  try {
    localStorage.removeItem(PICK);
  } catch {
    // 저장소를 못 쓰면 지울 것도 없다
  }
}

function readPick(): { title: string; at: number } | null {
  try {
    const value = JSON.parse(localStorage.getItem(PICK) ?? 'null') as { title?: unknown; at?: unknown } | null;
    return value && typeof value.title === 'string' && typeof value.at === 'number' ? { title: value.title, at: value.at } : null;
  } catch {
    return null;
  }
}

/**
 * 지금 이어서 볼 자료: 이 기기에서 마지막으로 고른 자료와 (어느 기기에서든) 마지막으로 푼 자료 중 더 최근 것.
 * 둘 다 없으면 새 카드가 남은 첫 자료. withNext면 새 카드가 남은 자료만 고른다 (오늘 화면, 복습 끝 화면)
 */
export function currentMaterial(materials: MaterialSummary[], withNext = false): MaterialSummary | undefined {
  const usable = withNext ? materials.filter((material) => material.next !== null) : materials;
  const pick = readPick();
  const picked = pick ? usable.find((material) => material.title === pick.title) : undefined;
  const studied = usable.reduce<MaterialSummary | undefined>(
    (best, material) => (material.studied_at !== null && material.studied_at > (best?.studied_at ?? 0) ? material : best),
    undefined,
  );
  if (picked && pick && pick.at >= (studied?.studied_at ?? 0)) return picked;
  return studied ?? materials.find((material) => material.next !== null) ?? (withNext ? undefined : materials[0]);
}
