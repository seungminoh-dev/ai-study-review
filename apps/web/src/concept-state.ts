import type { ConceptStateKey } from '@moai/shared';

/** 개념 상태 이름 (설계서 §9.7). 지식 지도, 개념 상세, 복습의 개념 패널이 같이 쓴다 */
export const STATE_LABEL: Record<ConceptStateKey, string> = { familiar: '익숙함', shaky: '흔들림', unlearned: '아직 안 배움', material: '자료 (아직 안 풂)' };
