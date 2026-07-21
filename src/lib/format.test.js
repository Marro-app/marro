import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  fmt, fmtS, fmtD, fmtA, fmtSA, moTotal, subMonthlyTotal,
  generateYearConfigs, yr2, blankYearFields, BLANK_MONTHLY,
  getMonday, getSunday, fmtWeekLabel, daysUntil, getYearMonthStr, todayStr,
  sanitizeMoneyInput, MAX_QUICK_ADD_AMOUNT,
} from './format.js';

// ── Money input clamping ────────────────────────────────────────────────────
describe('sanitizeMoneyInput', () => {
  it('strips a leading minus so a value can never go negative', () => {
    expect(sanitizeMoneyInput('-500')).toBe('500');
    expect(sanitizeMoneyInput('--50')).toBe('50');
  });
  it('leaves a lone "-" or an in-progress decimal untouched (mid-type)', () => {
    expect(sanitizeMoneyInput('-')).toBe('');
    expect(sanitizeMoneyInput('12.')).toBe('12.');
  });
  it('passes non-negative values through unchanged when under max', () => {
    expect(sanitizeMoneyInput('1200')).toBe('1200');
    expect(sanitizeMoneyInput('0')).toBe('0');
    expect(sanitizeMoneyInput('')).toBe('');
  });
  it('clamps down to max once the value parses to a real number over it', () => {
    expect(sanitizeMoneyInput('999999999', MAX_QUICK_ADD_AMOUNT)).toBe(String(MAX_QUICK_ADD_AMOUNT));
    expect(sanitizeMoneyInput('999999', MAX_QUICK_ADD_AMOUNT)).toBe('999999');
  });
  it('has no max by default', () => {
    expect(sanitizeMoneyInput('123456789')).toBe('123456789');
  });
});

// ── Money formatting ─────────────────────────────────────────────────────────
describe('fmt (whole-dollar, absolute)', () => {
  it('rounds and adds thousands separators', () => {
    expect(fmt(1234.56)).toBe('$1,235');
    expect(fmt(1000000)).toBe('$1,000,000');
  });
  it('is absolute (drops sign)', () => {
    expect(fmt(-1234)).toBe('$1,234');
  });
  it('rounds sub-dollar toward zero display', () => {
    expect(fmt(0)).toBe('$0');
    expect(fmt(0.4)).toBe('$0');
    expect(fmt(-0.6)).toBe('$1');
  });
});

describe('fmtS (signed whole-dollar)', () => {
  it('shows a leading sign for non-zero', () => {
    expect(fmtS(5)).toBe('+$5');
    expect(fmtS(-5)).toBe('-$5');
    expect(fmtS(1234.5)).toBe('+$1,235');
  });
  it('collapses values that round to zero to a bare $0 (no sign)', () => {
    expect(fmtS(0)).toBe('$0');
    expect(fmtS(0.4)).toBe('$0');
    expect(fmtS(-0.4)).toBe('$0');
  });
});

describe('fmtD (two-decimal, absolute)', () => {
  it('always shows cents', () => {
    expect(fmtD(5)).toBe('$5.00');
    expect(fmtD(-3.5)).toBe('$3.50');
  });
  it('coerces non-numbers to $0.00', () => {
    expect(fmtD('abc')).toBe('$0.00');
    expect(fmtD(null)).toBe('$0.00');
    expect(fmtD(undefined)).toBe('$0.00');
  });
});

describe('fmtA (actual money — cents only when present)', () => {
  it('hides cents for whole amounts', () => {
    expect(fmtA(1234)).toBe('$1,234');
    expect(fmtA(0)).toBe('$0');
  });
  it('shows cents when they exist', () => {
    expect(fmtA(1234.5)).toBe('$1,234.50');
    expect(fmtA(-1234.56)).toBe('$1,234.56');
  });
  it('coerces junk to $0', () => {
    expect(fmtA('x')).toBe('$0');
  });
});

describe('fmtSA (signed actual money)', () => {
  it('signs non-zero and keeps cents when present', () => {
    expect(fmtSA(5)).toBe('+$5');
    expect(fmtSA(-5.25)).toBe('-$5.25');
  });
  it('collapses near-zero to $0', () => {
    expect(fmtSA(0)).toBe('$0');
    expect(fmtSA(0.004)).toBe('$0');
  });
});

// ── Aggregations ─────────────────────────────────────────────────────────────
describe('moTotal', () => {
  it('sums numeric values and treats non-numeric as 0', () => {
    expect(moTotal({ a: 1, b: 2, c: 'x' })).toBe(3);
    expect(moTotal(BLANK_MONTHLY)).toBe(0);
    expect(moTotal({})).toBe(0);
  });
});

describe('subMonthlyTotal (normalizes billing cycles to monthly)', () => {
  it('handles each cycle', () => {
    expect(subMonthlyTotal([{ cycle: 'monthly', amount: 10 }])).toBe(10);
    expect(subMonthlyTotal([{ cycle: 'annual', amount: 120 }])).toBe(10);
    expect(subMonthlyTotal([{ cycle: 'quarterly', amount: 30 }])).toBe(10);
  });
  it('ignores inactive subs and unknown cycles', () => {
    expect(subMonthlyTotal([{ cycle: 'monthly', amount: 10, active: false }])).toBe(0);
    expect(subMonthlyTotal([{ cycle: 'weekly', amount: 10 }])).toBe(0);
  });
  it('sums a mix', () => {
    expect(subMonthlyTotal([
      { cycle: 'monthly', amount: 10 },
      { cycle: 'annual', amount: 120 },
      { cycle: 'quarterly', amount: 30 },
      { cycle: 'monthly', amount: 5, active: false },
    ])).toBe(30);
  });
  it('defaults to an empty list', () => {
    expect(subMonthlyTotal()).toBe(0);
  });
});

// ── Year config generation ───────────────────────────────────────────────────
describe('generateYearConfigs', () => {
  it('builds N sequential academic years anchored near Aug 1', () => {
    const ys = generateYearConfigs(2024, 4);
    expect(ys).toHaveLength(4);
    expect(ys[0]).toMatchObject({
      id: 0, label: 'Year 1 — 2024-25', startDate: '2024-08-01', endDate: '2025-08-15',
    });
    expect(ys[3]).toMatchObject({ id: 3, label: 'Year 4 — 2027-28', startDate: '2027-08-01' });
    // financial fields all default to 0 for every school (no special-casing)
    expect(ys[0]).toMatchObject(blankYearFields());
  });
  it('clamps length to at least 1', () => {
    expect(generateYearConfigs(2024, 0)).toHaveLength(1);
    expect(generateYearConfigs(2024, -3)).toHaveLength(1);
  });
  it('truncates fractional lengths', () => {
    expect(generateYearConfigs(2024, 3.9)).toHaveLength(3);
  });
  it('handles the century rollover in the label suffix', () => {
    const ys = generateYearConfigs(2099, 1);
    expect(ys[0].label).toBe('Year 1 — 2099-00');
    expect(ys[0].endDate).toBe('2100-08-15');
  });
});

describe('yr2', () => {
  it('two-digit, zero-padded', () => {
    expect(yr2(2025)).toBe('25');
    expect(yr2(2100)).toBe('00');
    expect(yr2(2007)).toBe('07');
  });
});

// ── Date helpers (DST-safe via noon anchoring) ───────────────────────────────
describe('getMonday', () => {
  // 2024-01-01 is a Monday; 2024-01-07 is the Sunday of that same week.
  it('returns the Monday of the given date week', () => {
    expect(getMonday('2024-01-01')).toBe('2024-01-01'); // Monday itself
    expect(getMonday('2024-01-03')).toBe('2024-01-01'); // Wednesday
    expect(getMonday('2024-01-07')).toBe('2024-01-01'); // Sunday belongs to the prior Monday
    expect(getMonday('2024-01-08')).toBe('2024-01-08'); // next Monday
  });
  it('is idempotent', () => {
    const m = getMonday('2024-06-19');
    expect(getMonday(m)).toBe(m);
  });
  it('accepts a Date object', () => {
    expect(getMonday(new Date('2024-01-03T12:00:00'))).toBe('2024-01-01');
  });
});

describe('getSunday', () => {
  it('is the Monday + 6 days', () => {
    expect(getSunday('2024-01-01')).toBe('2024-01-07');
    expect(getSunday('2024-06-24')).toBe('2024-06-30');
  });
  it('crosses month boundaries', () => {
    expect(getSunday('2024-01-29')).toBe('2024-02-04');
  });
});

describe('fmtWeekLabel', () => {
  it('renders a "start – end" range', () => {
    expect(fmtWeekLabel('2024-01-01')).toBe('Jan 1 – Jan 7');
  });
});

describe('daysUntil', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Pick a mid-day, mid-year instant well clear of DST transitions.
    vi.setSystemTime(new Date('2026-06-15T09:30:00'));
  });
  afterEach(() => vi.useRealTimers());

  it('returns null for empty input', () => {
    expect(daysUntil(null)).toBe(null);
    expect(daysUntil('')).toBe(null);
  });
  it('counts today as 0, not 1 (regression: noon/midnight off-by-one)', () => {
    expect(daysUntil('2026-06-15')).toBe(0);
  });
  it('counts forward and backward exactly', () => {
    expect(daysUntil('2026-06-16')).toBe(1);
    expect(daysUntil('2026-06-22')).toBe(7);
    expect(daysUntil('2026-06-14')).toBe(-1);
  });
});

describe('getYearMonthStr', () => {
  it('extracts YYYY-MM, zero-padded', () => {
    expect(getYearMonthStr('2024-03-09')).toBe('2024-03');
    expect(getYearMonthStr('2024-11-30')).toBe('2024-11');
  });
});

describe('todayStr', () => {
  it('emits a zero-padded YYYY-MM-DD for the current local date', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-01T09:30:00'));
    expect(todayStr()).toBe('2026-07-01');
    vi.useRealTimers();
  });
});
