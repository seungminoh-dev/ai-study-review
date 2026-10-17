// zod 없이 쓰는 상수와 검사. PWA 번들이 zod를 끌어오지 않도록 따로 둔다.

/** 답안은 한 번에 20건까지 보낸다 (설계서 §9.5) */
export const REVIEWS_PER_REQUEST = 20;
/** 답 하나에 걸린 시간은 이 값으로 자른다. 앱을 열어 둔 채 자리를 비운 시간까지 세지 않게 한다 */
export const MAX_ELAPSED_MS = 60 * 60 * 1000;
/** 알림 시간은 사용자당 3개까지다 (설계서 §10.1) */
export const MAX_REMINDERS = 3;

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isHhmm(value: string): boolean {
  return HHMM.test(value);
}
