import { describe, it, expect } from 'vitest';
import { fmtDuration, shareOfLoad, sparklinePoints } from './supportMetrics.js';

describe('fmtDuration', () => {
  it('picks sensible units', () => {
    expect(fmtDuration(null)).toBe('—');
    expect(fmtDuration(42)).toBe('42s');
    expect(fmtDuration(8 * 60)).toBe('8m');
    expect(fmtDuration(3.2 * 3600)).toBe('3.2h');
    expect(fmtDuration(11 * 3600)).toBe('11h');
    expect(fmtDuration(1.4 * 86400)).toBe('1.4d');
  });
});

describe('shareOfLoad', () => {
  it('integers that always sum to 100', () => {
    const rows = [{ handled: 2 }, { handled: 1 }];
    const shares = shareOfLoad(rows);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(100);
    expect(shares[0]).toBe(67);
    expect(shares[1]).toBe(33);
  });
  it('all-zero and empty input', () => {
    expect(shareOfLoad([{ handled: 0 }, { handled: 0 }])).toEqual([0, 0]);
    expect(shareOfLoad([])).toEqual([]);
  });
});

describe('sparklinePoints', () => {
  const now = Date.parse('2026-08-07T12:00:00');
  it('pads missing days with zeros over the trailing window', () => {
    const { series } = sparklinePoints([{ day: '2026-08-07', total: 5 }], 7, 120, 28, now);
    expect(series).toHaveLength(7);
    expect(series[6]).toBe(5);
    expect(series.slice(0, 6)).toEqual([0, 0, 0, 0, 0, 0]);
  });
  it('emits one svg point per day and scales to the max', () => {
    const { points, max } = sparklinePoints([{ day: '2026-08-07', total: 4 }, { day: '2026-08-06', total: 2 }], 3, 100, 30, now);
    expect(points.split(' ')).toHaveLength(3);
    expect(max).toBe(4);
  });
});
