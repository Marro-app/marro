import { describe, it, expect } from 'vitest';
import {
  yearStartYearOf, loanCountsForYear, loanCashLanded, loanCashForYear, availableMoney,
  unmatchedLoans, yearAidBreakdown,
} from './aid.js';

// A minimal, valid loan for the 2025–26 year — override fields per test.
// Mirrors the factory style in loans.test.js.
const makeLoan = (over = {}) => ({
  id: 'l1', name: 'Year 1 federal loan', type: 'federal', subtype: 'directUnsubGrad',
  academicYear: 2025, rate: null, status: 'disbursed',
  disbursements: [
    { id: 'd1', date: '2025-08-05', amount: 10000 },
    { id: 'd2', date: '2026-01-10', amount: 10000 },
  ],
  feePct: null, notes: '', asOfBalance: null, asOfDate: null,
  ...over,
});

const makeYear = (over = {}) => ({
  id: 0, label: 'Year 1 — 2025-26', startDate: '2025-08-01', endDate: '2026-08-15',
  grant: 0, tuitionFees: 0, healthIns: 0, otherIncome: 0, monthly: {},
  ...over,
});

describe('yearStartYearOf', () => {
  it('reads the calendar year a year record starts in', () => {
    expect(yearStartYearOf(makeYear({ startDate: '2025-08-01' }))).toBe(2025);
  });
  it('returns null for a missing or unparseable start date, so loans cannot be bucketed into it', () => {
    expect(yearStartYearOf(makeYear({ startDate: null }))).toBe(null);
    expect(yearStartYearOf(makeYear({ startDate: 'not-a-date' }))).toBe(null);
    expect(yearStartYearOf(null)).toBe(null);
  });
  it('does not drift across the new year — a spring-heavy year still reports its START year', () => {
    // Aug 2025 start means every spring 2026 disbursement still belongs to 2025.
    expect(yearStartYearOf(makeYear({ startDate: '2025-08-01', endDate: '2026-08-15' }))).toBe(2025);
  });
});

describe('loanCountsForYear — status gate', () => {
  it('counts accepted and disbursed loans', () => {
    expect(loanCountsForYear(makeLoan({ status: 'accepted' }), 2025)).toBe(true);
    expect(loanCountsForYear(makeLoan({ status: 'disbursed' }), 2025)).toBe(true);
  });
  it('excludes an offered loan — money the student has not committed to yet', () => {
    expect(loanCountsForYear(makeLoan({ status: 'offered' }), 2025)).toBe(false);
  });
});

describe('loanCountsForYear — current-balance mode', () => {
  it('excludes a loan entered as a current balance: that money landed in a past year', () => {
    const loan = makeLoan({ asOfBalance: 30000, asOfDate: '2026-07-01' });
    expect(loanCountsForYear(loan, 2025)).toBe(false);
  });
  it('still counts the loan when only one half of the balance-mode pair is set', () => {
    // Mode is only truly "current balance" when BOTH fields are present —
    // matches loanPrincipal/cashReceived in loans.js.
    expect(loanCountsForYear(makeLoan({ asOfBalance: 30000 }), 2025)).toBe(true);
    expect(loanCountsForYear(makeLoan({ asOfDate: '2026-07-01' }), 2025)).toBe(true);
  });
});

describe('loanCountsForYear — year matching', () => {
  it('matches only its own academic year', () => {
    expect(loanCountsForYear(makeLoan({ academicYear: 2025 }), 2025)).toBe(true);
    expect(loanCountsForYear(makeLoan({ academicYear: 2026 }), 2025)).toBe(false);
  });
  it('tolerates a string academicYear (number input can round-trip as a string)', () => {
    expect(loanCountsForYear(makeLoan({ academicYear: '2025' }), 2025)).toBe(true);
  });
  it('never matches when the year has no resolvable start year', () => {
    expect(loanCountsForYear(makeLoan(), null)).toBe(false);
  });
});

describe('loanCashLanded — the fee comes off the top', () => {
  it('subtracts the standard federal origination fee', () => {
    expect(loanCashLanded(makeLoan())).toBeCloseTo(20000 * (1 - 0.01057), 6); // 19788.60
  });
  it('subtracts the (much larger) Grad PLUS fee', () => {
    const loan = makeLoan({ subtype: 'gradPLUS' });
    expect(loanCashLanded(loan)).toBeCloseTo(20000 * (1 - 0.04228), 6); // 19154.40
  });
  it('takes no fee on a private loan — the full amount lands', () => {
    const loan = makeLoan({ type: 'private', subtype: 'private' });
    expect(loanCashLanded(loan)).toBe(20000);
  });
  it('honours an explicit feePct override', () => {
    const loan = makeLoan({ feePct: 0.05 });
    expect(loanCashLanded(loan)).toBeCloseTo(19000, 6); // 20000 * 0.95
  });
  it('returns 0 for a loan with no amounts entered yet', () => {
    expect(loanCashLanded(makeLoan({ disbursements: [] }))).toBe(0);
    expect(loanCashLanded(makeLoan({ disbursements: [{ id: 'd1', amount: 0 }] }))).toBe(0);
    expect(loanCashLanded(makeLoan({ disbursements: undefined }))).toBe(0);
  });
  it('uses the accepted amount, never the award-letter offer', () => {
    const loan = makeLoan({ offeredAmount: 45000, type: 'private', subtype: 'private' });
    expect(loanCashLanded(loan)).toBe(20000); // the disbursements, not the 45000 offered
  });
});

describe('loanCashForYear', () => {
  it('sums every qualifying loan for the year', () => {
    const loans = [
      makeLoan({ id: 'a', type: 'private', subtype: 'private' }),          // 20000, no fee
      makeLoan({ id: 'b', type: 'private', subtype: 'private', disbursements: [{ id: 'x', amount: 5000 }] }),
    ];
    expect(loanCashForYear(loans, 2025)).toBe(25000);
  });
  it('ignores loans from other years, offered loans, and balance-mode loans', () => {
    const loans = [
      makeLoan({ id: 'a', type: 'private', subtype: 'private' }),                                  // counts: 20000
      makeLoan({ id: 'b', type: 'private', subtype: 'private', academicYear: 2026 }),              // wrong year
      makeLoan({ id: 'c', type: 'private', subtype: 'private', status: 'offered' }),               // not committed
      makeLoan({ id: 'd', type: 'private', subtype: 'private', asOfBalance: 1, asOfDate: '2026-01-01' }), // historical
    ];
    expect(loanCashForYear(loans, 2025)).toBe(20000);
  });
  it('returns 0 for empty, null or undefined loan lists', () => {
    expect(loanCashForYear([], 2025)).toBe(0);
    expect(loanCashForYear(null, 2025)).toBe(0);
    expect(loanCashForYear(undefined, 2025)).toBe(0);
  });
});

describe('unmatchedLoans — money must never vanish silently', () => {
  it('flags a committed loan whose academic year matches no year record', () => {
    const years = [makeYear({ startDate: '2025-08-01' })];
    const loans = [makeLoan({ id: 'stray', academicYear: 2031 })];
    expect(unmatchedLoans(loans, years).map((l) => l.id)).toEqual(['stray']);
  });
  it('does not flag a loan that matches a year', () => {
    const years = [makeYear({ startDate: '2025-08-01' })];
    expect(unmatchedLoans([makeLoan()], years)).toEqual([]);
  });
  it('does not flag offered, balance-mode, or empty loans — those are correctly absent', () => {
    const years = [makeYear({ startDate: '2025-08-01' })];
    const loans = [
      makeLoan({ id: 'a', academicYear: 2031, status: 'offered' }),
      makeLoan({ id: 'b', academicYear: 2031, asOfBalance: 100, asOfDate: '2026-01-01' }),
      makeLoan({ id: 'c', academicYear: 2031, disbursements: [] }),
    ];
    expect(unmatchedLoans(loans, years)).toEqual([]);
  });
});

describe('yearAidBreakdown — the headline arithmetic', () => {
  it('matches the founder walkthrough: $5k grants + $50k loans - $34k tuition - $4.2k health = $1,400/mo', () => {
    const year = makeYear({ grant: 5000, tuitionFees: 34000, healthIns: 4200 });
    const loans = [makeLoan({ type: 'private', subtype: 'private', disbursements: [{ id: 'd', amount: 50000 }] })];
    const b = yearAidBreakdown(year, loans, 2025);
    expect(b.loanCash).toBe(50000);
    expect(b.totalAid).toBe(55000);          // 5000 + 50000
    expect(b.schoolCosts).toBe(38200);       // 34000 + 4200
    expect(b.sentToYou).toBe(16800);         // 55000 - 38200
    expect(b.moSpendable).toBe(1400);        // 16800 / 12
  });

  it('reproduces the old grants-only behaviour when there are no loans', () => {
    const year = makeYear({ grant: 42000, tuitionFees: 34000, healthIns: 4200, otherIncome: 3000 });
    const b = yearAidBreakdown(year, [], 2025);
    expect(b.sentToYou).toBe(3800);                    // 42000 - 38200
    expect(b.otherIncomeAnnual).toBe(36000);           // 3000/mo * 12
    expect(b.moSpendable).toBeCloseTo(3316.667, 3);    // (3800 + 36000) / 12
  });

  it('treats otherIncome as MONTHLY and everything else as ANNUAL', () => {
    const b = yearAidBreakdown(makeYear({ grant: 12000, otherIncome: 100 }), [], 2025);
    expect(b.otherIncomeAnnual).toBe(1200);
    expect(b.moSpendable).toBe(1100); // (12000 + 1200) / 12
  });

  it('floors money-to-you at zero when school costs exceed aid, but keeps the real gap', () => {
    const year = makeYear({ grant: 10000, tuitionFees: 34000 });
    const b = yearAidBreakdown(year, [], 2025);
    expect(b.sentToYou).toBe(0);        // you do not receive negative money
    expect(b.rawGap).toBe(-24000);      // ...but the shortfall is still reported
    expect(b.moSpendable).toBe(0);
  });

  it('lets loans close a gap that grants alone could not', () => {
    const year = makeYear({ grant: 10000, tuitionFees: 34000, healthIns: 4200 });
    const loans = [makeLoan({ type: 'private', subtype: 'private', disbursements: [{ id: 'd', amount: 40000 }] })];
    const b = yearAidBreakdown(year, loans, 2025);
    expect(b.rawGap).toBe(11800);   // 50000 - 38200
    expect(b.sentToYou).toBe(11800);
  });

  it('handles a completely empty year without producing NaN', () => {
    const b = yearAidBreakdown({}, [], 2025);
    expect(b.sentToYou).toBe(0);
    expect(b.moSpendable).toBe(0);
    expect(b.loanShare).toBe(0);
    expect(b.isLoanFunded).toBe(false);
    expect(Number.isNaN(b.moSpendable)).toBe(false);
  });

  it('derives the year from the record when no explicit start year is passed', () => {
    const year = makeYear({ startDate: '2025-08-01', grant: 0, tuitionFees: 0 });
    const loans = [makeLoan({ type: 'private', subtype: 'private' })];
    expect(yearAidBreakdown(year, loans).loanCash).toBe(20000);
  });
});

describe('yearAidBreakdown — loanShare drives the "never green" rule', () => {
  it('is zero when nothing is borrowed', () => {
    const b = yearAidBreakdown(makeYear({ grant: 50000, tuitionFees: 10000 }), [], 2025);
    expect(b.loanShare).toBe(0);
    expect(b.isLoanFunded).toBe(false);
  });

  it('is 1 when every dollar reaching the account is borrowed', () => {
    // Grants ($5k) are entirely consumed by school costs ($38.2k), so all
    // $16.8k landing in the account is loan money.
    const year = makeYear({ grant: 5000, tuitionFees: 34000, healthIns: 4200 });
    const loans = [makeLoan({ type: 'private', subtype: 'private', disbursements: [{ id: 'd', amount: 50000 }] })];
    const b = yearAidBreakdown(year, loans, 2025);
    expect(b.loanShare).toBe(1);
    expect(b.isLoanFunded).toBe(true);
  });

  it('never exceeds 1 even when loans dwarf what actually reaches the account', () => {
    const year = makeYear({ grant: 0, tuitionFees: 90000 });
    const loans = [makeLoan({ type: 'private', subtype: 'private', disbursements: [{ id: 'd', amount: 100000 }] })];
    const b = yearAidBreakdown(year, loans, 2025);
    expect(b.loanShare).toBeLessThanOrEqual(1);
    expect(b.sentToYou).toBe(10000);
    expect(b.loanShare).toBe(1);
  });

  it('counts earned income as un-borrowed, so a well-paid student is not flagged', () => {
    // $16.8k borrowed vs $36k earned → borrowed is a minority of spending money.
    const year = makeYear({ grant: 5000, tuitionFees: 34000, healthIns: 4200, otherIncome: 3000 });
    const loans = [makeLoan({ type: 'private', subtype: 'private', disbursements: [{ id: 'd', amount: 50000 }] })];
    const b = yearAidBreakdown(year, loans, 2025);
    expect(b.loanShare).toBeCloseTo(16800 / 52800, 6); // ≈0.318
    expect(b.isLoanFunded).toBe(false);
  });

  it('does not flag a student whose spending money is exactly half borrowed', () => {
    // Ties go to "not loan funded" — the flag is for a MAJORITY-borrowed year.
    const year = makeYear({ grant: 20000, tuitionFees: 10000 });        // 10000 grant reaches account
    const loans = [makeLoan({ type: 'private', subtype: 'private', disbursements: [{ id: 'd', amount: 10000 }] })];
    const b = yearAidBreakdown(year, loans, 2025);
    expect(b.sentToYou).toBe(20000);
    expect(b.loanShare).toBe(0.5);
    expect(b.isLoanFunded).toBe(false);
  });

  it('ignores an offered loan when judging whether the year is loan funded', () => {
    const year = makeYear({ grant: 50000, tuitionFees: 10000 });
    const loans = [makeLoan({ status: 'offered', disbursements: [{ id: 'd', amount: 100000 }] })];
    const b = yearAidBreakdown(year, loans, 2025);
    expect(b.loanCash).toBe(0);
    expect(b.isLoanFunded).toBe(false);
  });
});

// ── The one formula: availableMoney ─────────────────────────────────────────
describe('availableMoney — projection fallback (the degenerate case)', () => {
  const year = makeYear({ grant: 42000, tuitionFees: 34000, healthIns: 4200, otherIncome: 300 });

  it('with no readings, reproduces the old aid ÷ 12 behaviour exactly', () => {
    const a = availableMoney({ year, loans: [], readings: [], today: '2025-12-01' });
    expect(a.basis).toBe('projection');
    expect(a.monthsLeft).toBe(12);
    expect(a.onHand).toBe(0);
    // sentToYou 3800 + otherIncome 3600 = 7400/yr
    expect(a.perMonth).toBeCloseTo(7400 / 12, 6);
    expect(a.perMonth).toBeCloseTo(yearAidBreakdown(year, []).moSpendable, 6);
  });

  it('falls back to projection for a year that is NOT the current one, even with readings', () => {
    const future = makeYear({ startDate: '2030-08-01', endDate: '2031-08-15', grant: 12000 });
    const readings = [{ id: 'r', date: '2025-12-01', spendable: 9999, savings: 9999 }];
    const a = availableMoney({ year: future, loans: [], readings, today: '2025-12-01' });
    expect(a.basis).toBe('projection');
    expect(a.onHand).toBe(0); // a future year has no "current balance"
  });

  it('ignores a stale reading from before this year started', () => {
    const readings = [{ id: 'r', date: '2025-06-01', spendable: 5000, savings: 0 }]; // year starts 2025-08-01
    const a = availableMoney({ year, loans: [], readings, today: '2025-12-01' });
    expect(a.basis).toBe('projection');
  });
});

describe('availableMoney — balance-anchored (the corrected mid-year number)', () => {
  // The founder walkthrough scenario, hand-checked:
  //   grants 5000 + loans 50000 - tuition 34000 - health 4200 = 16800 reaches her
  //   arriving in two halves; on Dec 1 the fall half has landed and been partly spent
  const year = makeYear({ grant: 5000, tuitionFees: 34000, healthIns: 4200, otherIncome: 0 });
  const loans = [makeLoan({
    type: 'private', subtype: 'private',
    disbursements: [
      { id: 'd1', date: '2025-08-05', amount: 25000, dateConfirmed: true },
      { id: 'd2', date: '2026-01-10', amount: 25000, dateConfirmed: true },
    ],
  })];
  const readings = [{ id: 'r1', date: '2025-12-01', spendable: 3000, savings: 500 }];

  it('anchors on the real balance and counts only money that has NOT landed yet', () => {
    const a = availableMoney({ year, loans, readings, today: '2025-12-01' });
    expect(a.basis).toBe('balance');
    expect(a.onHand).toBe(3500);                    // 3000 checking + 500 savings
    expect(a.stillToArrive).toBeCloseTo(16800 / 2, 6); // only the spring half (~8400)
    expect(a.available).toBeCloseTo(3500 + 8400, 6);
  });

  it('divides by the months REMAINING, not a flat 12', () => {
    const a = availableMoney({ year, loans, readings, today: '2025-12-01' });
    expect(a.monthsLeft).toBe(8);                    // Dec → Aug 15
    expect(a.perMonth).toBeCloseTo(11900 / 8, 6);    // $1,487.50 — the plan's hand-check
  });

  it('does NOT double-count the money that already landed', () => {
    // The fall half (8400) is inside the 3500 that's left of it — counting it
    // again would report 20300 available when only 16800 ever existed.
    const a = availableMoney({ year, loans, readings, today: '2025-12-01' });
    expect(a.available).toBeLessThan(16800);
  });

  it('self-corrects downward when the student has overspent', () => {
    const broke = [{ id: 'r1', date: '2025-12-01', spendable: 1200, savings: 0 }];
    const a = availableMoney({ year, loans, readings: broke, today: '2025-12-01' });
    expect(a.perMonth).toBeCloseTo((1200 + 8400) / 8, 6); // $1,200/mo, tighter
    expect(a.perMonth).toBeLessThan(11900 / 8);
  });

  it('counts other income only for the months still ahead', () => {
    const withIncome = { ...year, otherIncome: 100 };
    const a = availableMoney({ year: withIncome, loans, readings, today: '2025-12-01' });
    expect(a.available).toBeCloseTo(3500 + 8400 + 100 * 8, 6);
  });
});

describe('availableMoney — monthsLeft guards', () => {
  const year = makeYear({ grant: 12000 });
  const readings = [{ id: 'r', date: '2026-08-01', spendable: 1000, savings: 0 }];

  it('never returns 0 months in the final month (no divide-by-zero)', () => {
    // Year ends 2026-08-15; today is inside the last month.
    const a = availableMoney({ year, loans: [], readings, today: '2026-08-10' });
    expect(a.monthsLeft).toBe(1);
    expect(Number.isFinite(a.perMonth)).toBe(true);
  });

  it('caps at 12 months even at the very start of the year', () => {
    const start = [{ id: 'r', date: '2025-08-01', spendable: 1000, savings: 0 }];
    const a = availableMoney({ year, loans: [], readings: start, today: '2025-08-01' });
    expect(a.monthsLeft).toBeLessThanOrEqual(12);
  });
});
