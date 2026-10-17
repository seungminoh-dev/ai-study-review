/** 한국 표준시는 UTC+9이고 일광 절약 시간이 없다 (설계서 §10.1). */
export const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isHhmm(value: string): boolean {
  return HHMM.test(value);
}

/** now 이후 처음 오는 KST hh:mm의 UTC epoch ms. */
export function nextKstTime(hhmm: string, now: number): number {
  const match = HHMM.exec(hhmm);
  if (!match) throw new Error(`invalid time: ${hhmm}`);
  const wall = new Date(now + KST_OFFSET_MS);
  const today = Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate(), Number(match[1]), Number(match[2])) - KST_OFFSET_MS;
  return today > now ? today : today + DAY_MS;
}

/** UTC epoch ms를 'HH:MM:SS' (KST)로 보여 준다. */
export function formatKst(ms: number): string {
  return new Date(ms + KST_OFFSET_MS).toISOString().slice(11, 19);
}
