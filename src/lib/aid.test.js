import { describe, it, expect } from 'vitest';
import {
  yearStartYearOf, loanCountsForYear, loanCashLanded, loanCashForYear, availableMoney,
  unmatchedLoans, yearAidBreakdown, schoolMonths, summerWindow,
  summerFundNeed, summerResources, summerShortfall, routeLoanCashBySummer,
  summerWageTotal, coveredMonthIndices,
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

// ── School-months divisor (money-rework §4a) ─────────────────────────────────
describe('schoolMonths — the aid divisor', () => {
  it('is 12 for a normal Aug→Jul (post-B2 contiguous) year with no aidThroughDate', () => {
    expect(schoolMonths(makeYear({ startDate: '2025-08-01', endDate: '2026-07-31', aidThroughDate: null }))).toBe(12);
  });
  it('is 12 for the legacy Aug→Aug-15 end too (backward compatible)', () => {
    expect(schoolMonths(makeYear({ startDate: '2025-08-01', endDate: '2026-08-15' }))).toBe(12);
  });
  it('falls back to 12 when dates are missing or nonsensical', () => {
    expect(schoolMonths({})).toBe(12);
    expect(schoolMonths(makeYear({ startDate: 'nope', endDate: 'nope' }))).toBe(12);
    expect(schoolMonths(makeYear({ startDate: '2026-08-01', endDate: '2025-01-01' }))).toBe(12); // end before start
  });
  it('tightens to ~9 when aid stops in May (the Cornell correction)', () => {
    expect(schoolMonths(makeYear({ startDate: '2025-08-01', endDate: '2026-07-31', aidThroughDate: '2026-05-15' }))).toBe(9);
  });
  it('uses aidThroughDate over endDate when both are present', () => {
    const y = makeYear({ startDate: '2025-08-01', endDate: '2026-07-31', aidThroughDate: '2026-05-01' });
    expect(schoolMonths(y)).toBe(9);
  });
});

describe('coveredMonthIndices — funded academic months (the year-end / running-balance loop)', () => {
  const sorted = (set) => [...set].sort((a, b) => a - b);
  it('covers all 12 for a normal Aug→Jul year (backward compatible)', () => {
    const c = coveredMonthIndices(makeYear({ startDate: '2025-08-01', endDate: '2026-07-31', aidThroughDate: null }), 2025);
    expect(c.size).toBe(12);
  });
  it('covers only Aug→May when aid stops mid-May (the Cornell / 10-month case)', () => {
    const c = coveredMonthIndices(makeYear({ startDate: '2025-08-01', endDate: '2026-07-31', aidThroughDate: '2026-05-15' }), 2025);
    // academic indices 0=Aug … 9=May; Jun (10) and Jul (11) are the unfunded summer
    expect(sorted(c)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(c.has(10)).toBe(false);
    expect(c.has(11)).toBe(false);
  });
  it('excludes the unfunded summer for a Jul-start / May-end year (the reported bug)', () => {
    const c = coveredMonthIndices(makeYear({ startDate: '2026-07-29', endDate: '2027-05-22', aidThroughDate: null }), 2026);
    expect(c.has(10)).toBe(false); // Jun 2027
    expect(c.has(11)).toBe(false); // Jul 2027
    expect(c.has(0)).toBe(true);   // Aug 2026
    expect(c.has(9)).toBe(true);   // May 2027
  });
  it('falls back to all 12 when dates are missing or garbage', () => {
    expect(coveredMonthIndices({}, 2025).size).toBe(12);
    expect(coveredMonthIndices(makeYear({ startDate: 'nope', endDate: 'nope' }), 2025).size).toBe(12);
    expect(coveredMonthIndices(makeYear({ startDate: '2025-08-01', endDate: '2026-07-31' }), NaN).size).toBe(12);
  });
});

describe('yearAidBreakdown — school-months divisor is a no-op when aidThroughDate is null', () => {
  it('divides by 12 (unchanged) when aidThroughDate is absent', () => {
    const year = makeYear({ grant: 5000, tuitionFees: 34000, healthIns: 4200 });
    const loans = [makeLoan({ type: 'private', subtype: 'private', disbursements: [{ id: 'd', amount: 50000 }] })];
    const b = yearAidBreakdown(year, loans, 2025);
    expect(b.schoolMonths).toBe(12);
    expect(b.moSpendable).toBe(1400);            // 16800 / 12 — identical to the pre-rework number
    expect(b.plannedPerMonth).toBe(b.moSpendable);
  });
  it('divides by the school months once aid stops early — a higher monthly plan', () => {
    const year = makeYear({ startDate: '2025-08-01', endDate: '2026-07-31', aidThroughDate: '2026-05-15', grant: 5000, tuitionFees: 34000, healthIns: 4200 });
    const loans = [makeLoan({ type: 'private', subtype: 'private', disbursements: [{ id: 'd', amount: 50000 }] })];
    const b = yearAidBreakdown(year, loans, 2025);
    expect(b.schoolMonths).toBe(9);
    expect(b.moSpendable).toBeCloseTo(16800 / 9, 6);   // ~1867, higher than the flat-12 number
    expect(b.moSpendable).toBeGreaterThan(1400);
  });
  it('surfaces hasAid / selfFunded without changing any numbers', () => {
    expect(yearAidBreakdown(makeYear({ grant: 5000 }), [], 2025).hasAid).toBe(true);
    expect(yearAidBreakdown(makeYear({ grant: 0 }), [], 2025).hasAid).toBe(false);
    expect(yearAidBreakdown(makeYear({ grant: 0 }), [], 2025).selfFunded).toBe(true);
    // a committed loan is aid scaffolding too
    const loans = [makeLoan({ type: 'private', subtype: 'private' })];
    expect(yearAidBreakdown(makeYear({ grant: 0 }), loans, 2025).hasAid).toBe(true);
  });
});

// ── summerWindow (money-rework §4b) ──────────────────────────────────────────
describe('summerWindow — the gap-detection the summer card keys off', () => {
  const y = (aidThroughDate) => makeYear({ startDate: '2025-08-01', endDate: '2026-07-31', aidThroughDate });
  const next = makeYear({ id: 1, startDate: '2026-08-01', endDate: '2027-07-31' });

  it('returns null when aid covers the whole year (aidThroughDate null)', () => {
    expect(summerWindow(y(null), next)).toBe(null);
  });
  it('returns null when there is no next year (the final / graduation year)', () => {
    expect(summerWindow(y('2026-05-15'), null)).toBe(null);
    expect(summerWindow(y('2026-05-15'), undefined)).toBe(null);
  });
  it('returns null when coverage runs to or past the next year start (no real gap)', () => {
    expect(summerWindow(y('2026-08-01'), next)).toBe(null); // reaches next start exactly
    expect(summerWindow(y('2026-09-01'), next)).toBe(null); // overlaps past it
  });
  it('returns { start, end, months } for a real May→Aug gap', () => {
    const w = summerWindow(y('2026-05-15'), next);
    expect(w.start).toBe('2026-05-15');
    expect(w.end).toBe('2026-08-01');
    expect(w.months).toBe(3); // ~78 days
  });
  it('falls back to the year END DATE when aidThroughDate is unset (the UI default)', () => {
    // A year the student ended in May, no explicit aidThroughDate → summer still detected.
    const shortYear = makeYear({ startDate: '2027-08-01', endDate: '2028-05-22', aidThroughDate: null });
    const nextY = makeYear({ id: 1, startDate: '2028-08-01', endDate: '2029-07-31' });
    const w = summerWindow(shortYear, nextY);
    expect(w.start).toBe('2028-05-22');
    expect(w.end).toBe('2028-08-01');
    expect(w.months).toBe(2); // ~71 days
  });
  it('returns null for a contiguous full year — a sub-month gap is not a summer', () => {
    // endDate …-07-31 → next …-08-01 is one day; must not sprout a 1-month summer.
    expect(summerWindow(y(null), next)).toBe(null);
  });
});

// ── Summer fund need / resources / shortfall (pure calcs, §4b) ────────────────
describe('summerFundNeed', () => {
  const window = { start: '2026-05-15', end: '2026-08-01', months: 3 };

  it('returns null when there is no summer window', () => {
    expect(summerFundNeed({ monthlyPlan: 3000, schoolRent: 1500, window: null })).toBe(null);
  });
  it('keeps the plan unchanged when summer rent equals school rent (the default)', () => {
    const n = summerFundNeed({ monthlyPlan: 3000, schoolRent: 1500, summerRent: null, window });
    expect(n.monthly).toBe(3000);
    expect(n.months).toBe(3);
    expect(n.total).toBe(9000);
  });
  it('drops the rent line when the student goes home ($0 summer rent)', () => {
    const n = summerFundNeed({ monthlyPlan: 3000, schoolRent: 1500, summerRent: 0, window });
    expect(n.monthly).toBe(1500);   // 3000 - 1500 + 0
    expect(n.total).toBe(4500);
  });
  it('raises the cost for a pricier away-rotation rent', () => {
    const n = summerFundNeed({ monthlyPlan: 3000, schoolRent: 1500, summerRent: 2200, window });
    expect(n.monthly).toBe(3700);   // 3000 - 1500 + 2200
  });
  it('never goes negative', () => {
    expect(summerFundNeed({ monthlyPlan: 1000, schoolRent: 1500, summerRent: 0, window }).monthly).toBe(0);
  });
});

describe('summerWageTotal — steady paycheck without double-counting', () => {
  const window = { start: '2026-06-01', end: '2026-07-27', months: 2 };
  it('is zero for no amount, no cadence, or the "other" cadence', () => {
    expect(summerWageTotal({ cadence: 'biweekly', perPaycheck: 0, window })).toEqual({ periods: 0, total: 0 });
    expect(summerWageTotal({ cadence: '', perPaycheck: 1000, window })).toEqual({ periods: 0, total: 0 });
    expect(summerWageTotal({ cadence: 'other', perPaycheck: 1000, window })).toEqual({ periods: 0, total: 0 });
  });
  it('counts inclusive paydays across an explicit first→last span (biweekly)', () => {
    // Jun 1 → Jul 27 is 56 days; 56/14 = 4, +1 inclusive = 5 paychecks
    const r = summerWageTotal({ cadence: 'biweekly', perPaycheck: 1500, firstDate: '2026-06-01', lastDate: '2026-07-27' });
    expect(r.periods).toBe(5);
    expect(r.total).toBe(7500);
  });
  it('estimates from the window length when dates are blank (not inclusive)', () => {
    // window ~56 days; weekly → round(56/7)=8 periods
    const r = summerWageTotal({ cadence: 'weekly', perPaycheck: 400, window });
    expect(r.periods).toBe(8);
    expect(r.total).toBe(3200);
  });
  it('monthly cadence uses ~30.4-day periods', () => {
    const r = summerWageTotal({ cadence: 'monthly', perPaycheck: 2000, firstDate: '2026-06-01', lastDate: '2026-07-01' });
    expect(r.periods).toBe(2); // ~30 days /30.4 = 1, +1 inclusive = 2
    expect(r.total).toBe(4000);
  });
});

describe('summerResources', () => {
  const window = { start: '2026-05-15', end: '2026-08-01', months: 3 };

  it('is all zero with no window', () => {
    expect(summerResources({ window: null, income: { cadence: 'monthly', perPaycheck: 1000 } }))
      .toEqual({ lumpTotal: 0, wageTotal: 0, periods: 0, total: 0 });
  });
  it('sums a steady wage over the window when no dates are given', () => {
    // window ~78 days; monthly → round(78/30.4)=3 periods × 1200
    const r = summerResources({ window, income: { cadence: 'monthly', perPaycheck: 1200 } });
    expect(r.wageTotal).toBe(3600);
    expect(r.total).toBe(3600);
  });
  it('counts an "other"-cadence lump landing inside the window', () => {
    const r = summerResources({ window, income: { cadence: 'other', lumps: [{ amount: 5000, date: '2026-06-01' }] } });
    expect(r.lumpTotal).toBe(5000);
  });
  it('ignores a lump dated outside the window (a July-1 stipend cannot fund a passed May)', () => {
    const r = summerResources({ window, income: { cadence: 'other', lumps: [{ amount: 5000, date: '2026-05-01' }] } });
    expect(r.lumpTotal).toBe(0);
  });
  it('does not count lumps when a steady cadence is chosen (no double-dipping)', () => {
    const r = summerResources({ window, income: { cadence: 'monthly', perPaycheck: 500, lumps: [{ amount: 9999, date: '2026-06-15' }] } });
    expect(r.lumpTotal).toBe(0);
    expect(r.total).toBe(r.wageTotal);
  });
});

describe('summerShortfall', () => {
  it('reports the uncovered shortfall', () => {
    const s = summerShortfall({ need: { total: 9000 }, resources: { total: 3600 } });
    expect(s).toEqual({ need: 9000, resources: 3600, shortfall: 5400, surplus: 0 });
  });
  it('reports a surplus when resources exceed need', () => {
    const s = summerShortfall({ need: { total: 3000 }, resources: { total: 5000 } });
    expect(s.shortfall).toBe(0);
    expect(s.surplus).toBe(2000);
  });
  it('treats missing pieces as zero', () => {
    expect(summerShortfall({ need: null, resources: null })).toEqual({ need: 0, resources: 0, shortfall: 0, surplus: 0 });
  });
});

// ── routeLoanCashBySummer (date-based routing, §4c) ──────────────────────────
describe('routeLoanCashBySummer', () => {
  const window = { start: '2026-05-15', end: '2026-08-01', months: 3 };

  it('routes a summer-dated disbursement to summer, a school-dated one to school', () => {
    const loan = makeLoan({
      type: 'private', subtype: 'private',
      disbursements: [
        { id: 'd1', date: '2025-08-05', amount: 10000 }, // fall — school
        { id: 'd2', date: '2026-06-01', amount: 5000 },  // summer window
      ],
    });
    const { school, summer } = routeLoanCashBySummer([loan], window);
    expect(school).toBe(10000);
    expect(summer).toBe(5000);
  });
  it('routes everything to school when there is no summer window', () => {
    const loan = makeLoan({ type: 'private', subtype: 'private', disbursements: [{ id: 'd', date: '2026-06-01', amount: 8000 }] });
    const { school, summer } = routeLoanCashBySummer([loan], null);
    expect(summer).toBe(0);
    expect(school).toBe(8000);
  });
  it('school + summer sums to the year total landed loan cash (fee off the top)', () => {
    const loan = makeLoan({ // federal, standard origination fee
      disbursements: [
        { id: 'd1', date: '2025-08-05', amount: 20000 },
        { id: 'd2', date: '2026-06-10', amount: 6000 },
      ],
    });
    const { school, summer } = routeLoanCashBySummer([loan], window);
    expect(school + summer).toBeCloseTo(loanCashLanded(loan), 6);
    expect(summer).toBeCloseTo(6000 * (1 - 0.01057), 6);
  });
  it('ignores offered and current-balance loans', () => {
    const offered = makeLoan({ id: 'a', status: 'offered', disbursements: [{ id: 'd', date: '2026-06-01', amount: 9000 }] });
    const balMode = makeLoan({ id: 'b', asOfBalance: 1, asOfDate: '2026-01-01', disbursements: [{ id: 'd', date: '2026-06-01', amount: 9000 }] });
    expect(routeLoanCashBySummer([offered, balMode], window)).toEqual({ school: 0, summer: 0 });
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
    expect(a.onHand).toBe(3000);                    // CHECKING only — savings is a separate reserve
    expect(a.savings).toBe(500);                    // surfaced apart, not counted as spendable
    expect(a.stillToArrive).toBeCloseTo(16800 / 2, 6); // only the spring half (~8400)
    expect(a.available).toBeCloseTo(3000 + 8400, 6);
  });

  it('divides by the months REMAINING, not a flat 12', () => {
    const a = availableMoney({ year, loans, readings, today: '2025-12-01' });
    expect(a.monthsLeft).toBe(8);                    // Dec → Aug 15
    expect(a.perMonth).toBeCloseTo(11400 / 8, 6);    // (3000 checking + 8400 to arrive) / 8
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
    expect(a.available).toBeCloseTo(3000 + 8400 + 100 * 8, 6);
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

describe('availableMoney — "until your next money" (the dry-spell preventer)', () => {
  // grant 0 on purpose: a grant is ALSO a dated inflow (estimateRefunds splits
  // it into term halves), so a grant would land on Jan 1 and become "the next
  // money" ahead of the Jan 10 loan. Zeroing it isolates loan timing here; the
  // grant-counts-too case is asserted separately at the end of this block.
  const year = makeYear({ grant: 0, tuitionFees: 34000, healthIns: 4200, otherIncome: 0 });
  const loans = [makeLoan({
    type: 'private', subtype: 'private',
    disbursements: [
      { id: 'd1', date: '2025-08-05', amount: 25000, dateConfirmed: true },
      { id: 'd2', date: '2026-01-10', amount: 25000, dateConfirmed: true },
    ],
  })];
  const readings = [{ id: 'r1', date: '2025-12-01', spendable: 3000, savings: 500 }];

  it('is based on cash ON HAND and the months until the next payment, not the year', () => {
    const a = availableMoney({ year, loans, readings, today: '2025-12-01' });
    expect(a.untilNextMoney.date).toBe('2026-01-10');
    expect(a.untilNextMoney.monthsToNext).toBe(1);
    expect(a.untilNextMoney.perMonth).toBeCloseTo(3000, 6); // $3,000 checking on hand over 1 month
  });

  it('is TIGHTER than the year average when the next lump is far off', () => {
    // Same cash, but the spring money is months away — the annual average would
    // overspend the gap, which is the whole failure mode this figure prevents.
    const lateLoans = [makeLoan({
      type: 'private', subtype: 'private',
      disbursements: [
        { id: 'd1', date: '2025-08-05', amount: 25000, dateConfirmed: true },
        { id: 'd2', date: '2026-05-01', amount: 25000, dateConfirmed: true },
      ],
    })];
    const a = availableMoney({ year, loans: lateLoans, readings, today: '2025-12-01' });
    expect(a.untilNextMoney.monthsToNext).toBe(5);          // Dec -> May
    expect(a.untilNextMoney.perMonth).toBeCloseTo(600, 6);  // $3,000 checking stretched over 5 months
    expect(a.untilNextMoney.perMonth).toBeLessThan(a.perMonth);
  });

  it('counts a GRANT half as the next money too, not just loan disbursements', () => {
    // The spring grant half lands Jan 1, ahead of the Jan 10 loan — so it, not
    // the loan, is the next money the student actually sees.
    const withGrant = { ...year, grant: 5000 };
    const a = availableMoney({ year: withGrant, loans, readings, today: '2025-12-01' });
    expect(a.untilNextMoney.date).toBe('2026-01-01');
  });

  it('is null when no more money is coming this year', () => {
    const spent = [{ id: 'r1', date: '2026-02-01', spendable: 3000, savings: 0 }];
    const a = availableMoney({ year, loans, readings: spent, today: '2026-02-01' });
    expect(a.untilNextMoney).toBe(null);
  });

  it('is null on the projection fallback (no balance to reason from)', () => {
    expect(availableMoney({ year, loans, readings: [], today: '2025-12-01' }).untilNextMoney).toBe(null);
  });
});
