import { describe, expect, it } from 'vitest';
import { formatKst, isHhmm, nextKstTime } from '../src/lib/kst';

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
    expect(formatKst(at('2026-10-17T13:30:05Z'))).toBe('22:30:05');
  });
});
