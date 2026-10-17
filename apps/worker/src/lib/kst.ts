import { isHhmm } from '@moai/shared';

/** 한국 표준시는 UTC+9이고 일광 절약 시간이 없다 (설계서 §10.1). */
export const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
export const DAY_MS = 24 * 60 * 60 * 1000;
/** 하루의 경계는 04:00 KST다. 새벽 복습은 전날로 센다 (설계서 §5.1) */
const STUDY_DAY_SHIFT_MS = KST_OFFSET_MS - 4 * 60 * 60 * 1000;

export { isHhmm };

/** now 이후 처음 오는 KST hh:mm의 UTC epoch ms. */
export function nextKstTime(hhmm: string, now: number): number {
  if (!isHhmm(hhmm)) throw new Error(`invalid time: ${hhmm}`);
  const [hours, minutes] = hhmm.split(':').map(Number) as [number, number];
  const wall = new Date(now + KST_OFFSET_MS);
  const today = Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate(), hours, minutes) - KST_OFFSET_MS;
  return today > now ? today : today + DAY_MS;
}

/** now가 속한 복습 하루(04:00 KST부터 24시간)의 시작 시각 (UTC epoch ms). */
export function studyDayStart(now: number): number {
  return Math.floor((now + STUDY_DAY_SHIFT_MS) / DAY_MS) * DAY_MS - STUDY_DAY_SHIFT_MS;
}

/** UTC epoch ms를 'HH:MM' (KST)로 보여 준다. */
export function formatKstTime(ms: number): string {
  return new Date(ms + KST_OFFSET_MS).toISOString().slice(11, 16);
}

/** UTC epoch ms를 'YYYY-MM-DD' (KST 달력 날짜)로 보여 준다. */
export function formatKstDate(ms: number): string {
  return new Date(ms + KST_OFFSET_MS).toISOString().slice(0, 10);
}

/** 알림 시각을 "오늘 08:10", "내일 08:10", "10월 20일 08:10"처럼 말한다. */
export function describeKstMoment(ms: number, now: number): string {
  const day = (t: number) => Math.floor((t + KST_OFFSET_MS) / DAY_MS);
  const diff = day(ms) - day(now);
  const time = formatKstTime(ms);
  if (diff === 0) return `오늘 ${time}`;
  if (diff === 1) return `내일 ${time}`;
  const date = new Date(ms + KST_OFFSET_MS);
  return `${date.getUTCMonth() + 1}월 ${date.getUTCDate()}일 ${time}`;
}
