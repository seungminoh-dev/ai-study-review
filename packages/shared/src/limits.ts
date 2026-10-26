// zod 없이 쓰는 상수와 검사. PWA 번들이 zod를 끌어오지 않도록 따로 둔다.

/** 답안은 한 번에 20건까지 보낸다 (설계서 §9.5) */
export const REVIEWS_PER_REQUEST = 20;
/** 답 하나에 걸린 시간은 이 값으로 자른다. 앱을 열어 둔 채 자리를 비운 시간까지 세지 않게 한다 */
export const MAX_ELAPSED_MS = 60 * 60 * 1000;
/** 무실수 보너스: 한 번 복습에서 이만큼 이상 풀고 하나도 틀리지 않으면 보너스 XP를 준다 */
export const PERFECT_MIN_ANSWERS = 5;
export const PERFECT_XP = 10;
/** 붙여넣기 가져오기: 대화 텍스트 6만 자까지 (설계서 §11.4) */
export const MAX_IMPORT_CHARS = 60_000;
/** 알림 시간은 사용자당 3개까지다 (설계서 §10.1) */
export const MAX_REMINDERS = 3;
/**
 * 이용약관·개인정보 처리방침의 시행일. 문서를 바꾸면 이 값도 바꾼다.
 * 회원이 확인한 값(users.terms_version)과 다르면 오늘 화면에 바뀐 것을 알리는 카드가 뜬다
 */
export const TERMS_VERSION = '2026-10-22';

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isHhmm(value: string): boolean {
  return HHMM.test(value);
}
