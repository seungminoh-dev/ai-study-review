import { describe, expect, it } from 'vitest';
import { describeKstMoment, formatKstDate, formatKstTime, isHhmm, nextKstTime, studyDayStart } from '../src/lib/kst';

const at = (iso: string) => Date.parse(iso);

describe('nextKstTime', () => {
  const now = at('2026-10-17T00:00:00Z'); // 09:00 KST

  it('returns the next morning for a time already past today', () => {
    expect(nextKstTime('08:10', now)).toBe(at('2026-10-17T23:10:00Z'));
  });

  it('returns later today for a time still ahead', () => {
    expect(nextKstTime('22:30', now)).toBe(at('2026-10-17T13:30:00Z'));
  });

  it('moves to the next day when the time is exactly now', () => {
    expect(nextKstTime('09:00', now)).toBe(at('2026-10-18T00:00:00Z'));
  });

  it('handles the KST date being one day ahead of UTC', () => {
    expect(nextKstTime('00:30', at('2026-10-17T15:10:00Z'))).toBe(at('2026-10-17T15:30:00Z')); // 00:10 KST on the 18th
  });

  it('validates and formats', () => {
    expect(isHhmm('08:10')).toBe(true);
    expect(isHhmm('24:00')).toBe(false);
    expect(formatKstTime(at('2026-10-17T13:30:05Z'))).toBe('22:30');
    expect(formatKstDate(at('2026-10-17T15:10:00Z'))).toBe('2026-10-18');
  });
});

describe('studyDayStart (04:00 KST boundary)', () => {
  const dayStart = at('2026-10-16T19:00:00Z'); // 2026-10-17 04:00 KST

  it('counts the early morning as the previous day', () => {
    expect(studyDayStart(at('2026-10-17T18:59:59Z'))).toBe(dayStart); // 03:59 KST on the 18th
    expect(studyDayStart(at('2026-10-17T19:00:00Z'))).toBe(at('2026-10-17T19:00:00Z')); // 04:00 KST on the 18th
  });

  it('keeps midnight KST in the same study day', () => {
    expect(studyDayStart(at('2026-10-17T15:00:00Z'))).toBe(dayStart); // 00:00 KST on the 18th
    expect(studyDayStart(at('2026-10-16T19:00:00Z'))).toBe(dayStart);
  });
});

describe('describeKstMoment', () => {
  const now = at('2026-10-17T12:00:00Z'); // 21:00 KST

  it('says today, tomorrow, or the date', () => {
    expect(describeKstMoment(at('2026-10-17T13:30:00Z'), now)).toBe('오늘 22:30');
    expect(describeKstMoment(at('2026-10-17T23:10:00Z'), now)).toBe('내일 08:10');
    expect(describeKstMoment(at('2026-10-19T23:10:00Z'), now)).toBe('10월 20일 08:10');
  });
});
