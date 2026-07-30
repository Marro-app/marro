import { describe, it, expect } from 'vitest';
import {
  FEDERAL_GRAD_UNSUB_RATES, FEDERAL_GRAD_PLUS_RATES, FEDERAL_ORIGINATION_FEE, FEDERAL_GRAD_PLUS_FEE, HRSA_RATE,
  effectiveRate, isRateEstimated, effectiveFeePct, statutoryRate, isInterestDeferred,
  loanPrincipal, cashReceived, loanOfferedAmount, accruedInterest, loanTypeKey,
  projectDebtAtGraduation, computeRunway, projectBalance, compareToPlan, estimateRefunds, loanReturnWindows,
  refundPlaybookTrigger, returnSavingsAtGraduation, classifyCushionSource,
} from './loans.js';
import { DAYS_PER_MONTH } from './constants.js';

// A minimal, valid loan — override fields per test.
const makeLoan = (over = {}) => ({
  id: 'l1', name: 'Year 1 federal loan', type: 'federal', academicYear: 2025,
  rate: null, status: 'disbursed',
  disbursements: [{ id: 'd1', date: '2025-08-05', amount: 20000 }],
  feePct: null, notes: '',
  ...over,
});

describe('effectiveRate', () => {
  it('looks up the federal table by academicYear', () => {
    expect(effectiveRate(makeLoan({ academicYear: 2025 }))).toBe(0.0794);
    expect(effectiveRate(makeLoan({ academicYear: 2026 }))).toBe(0.0807);
  });
  it('a student-entered rate always wins over the table', () => {
    expect(effectiveRate(makeLoan({ academicYear: 2025, rate: 0.05 }))).toBe(0.05);
  });
  it('clamps to the nearest known year when the academicYear predates or postdates the table', () => {
    // Table now runs 2013-14 → 2026-27 (Package A widened it) — a genuinely
    // out-of-range year needs to be before 2013 or after 2026.
    expect(effectiveRate(makeLoan({ academicYear: 2008 }))).toBe(FEDERAL_GRAD_UNSUB_RATES[2013]);
    expect(effectiveRate(makeLoan({ academicYear: 2031 }))).toBe(FEDERAL_GRAD_UNSUB_RATES[2026]);
  });
  it('a private loan with no rate entered reads as 0 (caller must check isRateEstimated)', () => {
    expect(effectiveRate(makeLoan({ type: 'private', rate: null }))).toBe(0);
  });
});

describe('isRateEstimated', () => {
  it('false once a rate is explicitly set, regardless of type', () => {
    expect(isRateEstimated(makeLoan({ rate: 0.05 }))).toBe(false);
    expect(isRateEstimated(makeLoan({ type: 'private', rate: 0.09 }))).toBe(false);
  });
  it('true for a private loan with no rate typed in', () => {
    expect(isRateEstimated(makeLoan({ type: 'private', rate: null }))).toBe(true);
  });
  it('true for a federal loan whose academicYear falls outside the published table (pre-2013)', () => {
    expect(isRateEstimated(makeLoan({ academicYear: 2008, rate: null }))).toBe(true);
  });
  it('false for a federal loan inside the table with no override', () => {
    expect(isRateEstimated(makeLoan({ academicYear: 2025, rate: null }))).toBe(false);
  });
});

describe('effectiveFeePct', () => {
  it('federal defaults to the government fee, private defaults to 0', () => {
    expect(effectiveFeePct(makeLoan({ type: 'federal', feePct: null }))).toBe(FEDERAL_ORIGINATION_FEE);
    expect(effectiveFeePct(makeLoan({ type: 'private', feePct: null }))).toBe(0);
  });
  it('an explicit feePct always wins', () => {
    expect(effectiveFeePct(makeLoan({ type: 'federal', feePct: 0.02 }))).toBe(0.02);
  });
});

describe('loanPrincipal', () => {
  it('sums disbursements to the accepted (face) amount — the fee does NOT inflate what you owe', () => {
    const loan = makeLoan({ academicYear: 2025, disbursements: [{ id: 'd1', date: '2025-08-05', amount: 20000 }, { id: 'd2', date: '2026-01-10', amount: 20000 }] });
    expect(loanPrincipal(loan)).toBe(40000); // owed = accepted amount, no fee gross-up
  });
  it('as-of-balance mode uses the entered balance as-is', () => {
    const loan = makeLoan({ asOfDate: '2027-01-01', asOfBalance: 22000 });
    expect(loanPrincipal(loan)).toBe(22000);
  });
  it('ignores offeredAmount entirely — principal is built from the ACCEPTED amount, not the award-letter offer', () => {
    const accepted = makeLoan({ academicYear: 2025, disbursements: [{ id: 'd1', date: '2025-08-05', amount: 20000 }] });
    const withBiggerOffer = { ...accepted, offeredAmount: 45000 };
    expect(loanPrincipal(withBiggerOffer)).toBe(loanPrincipal(accepted));
  });
});

describe('cashReceived — the fee reduces cash received, not what you owe', () => {
  it('federal award-letter mode: accepted × (1 − fee) reaches the account, while owed principal stays the full face amount', () => {
    const loan = makeLoan({ academicYear: 2025, disbursements: [{ id: 'd1', date: '2025-08-05', amount: 20000 }] });
    expect(cashReceived(loan)).toBeCloseTo(20000 * (1 - FEDERAL_ORIGINATION_FEE), 6);
    expect(loanPrincipal(loan)).toBe(20000); // owed is unchanged by the fee
  });
  it('Grad PLUS reflects its larger fee as less cash received', () => {
    const loan = makeLoan({ subtype: 'gradPLUS', type: 'federal', academicYear: 2026, disbursements: [{ id: 'd1', date: '2026-08-01', amount: 20000 }] });
    expect(cashReceived(loan)).toBeCloseTo(20000 * (1 - FEDERAL_GRAD_PLUS_FEE), 6);
  });
  it('returns null when there is no fee, no accepted amount, or in current-balance mode (so the UI hides the line)', () => {
    expect(cashReceived(makeLoan({ type: 'private', feePct: null, disbursements: [{ id: 'd1', date: '2025-08-05', amount: 20000 }] }))).toBe(null); // no fee
    expect(cashReceived(makeLoan({ disbursements: [] }))).toBe(null); // nothing accepted
    expect(cashReceived(makeLoan({ asOfDate: '2027-01-01', asOfBalance: 22000 }))).toBe(null); // current-balance mode
  });
});

describe('loanOfferedAmount', () => {
  it('returns the recorded offer when present', () => {
    expect(loanOfferedAmount(makeLoan({ offeredAmount: 45000 }))).toBe(45000);
  });
  it('returns null when no offer was recorded (or it is zero/negative/garbage), so the UI can hide the note', () => {
    expect(loanOfferedAmount(makeLoan())).toBe(null); // no offeredAmount field
    expect(loanOfferedAmount(makeLoan({ offeredAmount: null }))).toBe(null);
    expect(loanOfferedAmount(makeLoan({ offeredAmount: 0 }))).toBe(null);
    expect(loanOfferedAmount(makeLoan({ offeredAmount: -100 }))).toBe(null);
  });
});

describe('accruedInterest — hand-checked against the studentaid.gov simple-daily-interest formula', () => {
  // $20,000 @ 8.07% (2026-27 federal rate), disbursed 2026-08-01.
  // Interest accrues on the ACCEPTED (face) amount — the fee is NOT added to
  // what you owe (founder correction 2026-07-22). principal = 20000.
  // daily = 20000 * 0.0807 / 365 ≈ $4.421918/day
  const loan = makeLoan({
    academicYear: 2026,
    disbursements: [{ id: 'd1', date: '2026-08-01', amount: 20000 }],
  });

  it('one day of accrual ≈ $4.42', () => {
    const oneDay = accruedInterest(loan, '2026-08-02');
    expect(oneDay).toBeCloseTo(4.421918, 4);
    expect(Math.round(oneDay * 100) / 100).toBe(4.42);
  });

  it('1,383 days of accrual (2026-08-01 → 2030-05-15) to the cent', () => {
    const total = accruedInterest(loan, '2030-05-15');
    // principal(20000) * rate(.0807) / 365 * 1383 days, computed independently in node to verify:
    expect(Math.round(total * 100) / 100).toBe(6115.51);
  });

  it('a loan still in "offered" status has not disbursed, so it accrues nothing', () => {
    expect(accruedInterest(makeLoan({ status: 'offered', academicYear: 2026, disbursements: [{ id: 'd1', date: '2026-08-01', amount: 20000 }] }), '2030-05-15')).toBe(0);
  });

  it('a date before the disbursement floors days at 0 rather than going negative', () => {
    expect(accruedInterest(loan, '2026-07-01')).toBe(0);
  });

  it('two disbursements in one academic year accrue differently (each from its own date)', () => {
    const twoTranche = makeLoan({
      academicYear: 2025,
      disbursements: [{ id: 'd1', date: '2025-08-05', amount: 20000 }, { id: 'd2', date: '2026-01-10', amount: 20000 }],
    });
    const asOf = '2026-06-01';
    const fallOnly = accruedInterest(makeLoan({ academicYear: 2025, disbursements: [{ id: 'd1', date: '2025-08-05', amount: 20000 }] }), asOf);
    const springOnly = accruedInterest(makeLoan({ academicYear: 2025, disbursements: [{ id: 'd2', date: '2026-01-10', amount: 20000 }] }), asOf);
    expect(accruedInterest(twoTranche, asOf)).toBeCloseTo(fallOnly + springOnly, 6);
    expect(fallOnly).toBeGreaterThan(springOnly); // fall tranche has accrued longer by graduation-adjacent asOf date
  });

  it('as-of-balance mode accrues only from asOfDate — no double-counting interest studentaid.gov already baked into the current balance', () => {
    // A "today's balance" entry should NOT also accrue from some earlier disbursement date.
    const asOfLoan = makeLoan({ academicYear: 2025, rate: 0.07, asOfDate: '2027-01-01', asOfBalance: 25000, disbursements: [] });
    const zeroDays = accruedInterest(asOfLoan, '2027-01-01');
    expect(zeroDays).toBe(0); // nothing has accrued yet as of the anchor date itself
    const oneYear = accruedInterest(asOfLoan, '2028-01-01');
    expect(oneYear).toBeCloseTo(25000 * 0.07, 0); // ~1 year of simple interest on the anchor balance only
  });
});

describe('projectDebtAtGraduation', () => {
  const gradDate = '2029-05-15';

  it('excludes offered loans, counts accepted/disbursed', () => {
    const offered = makeLoan({ id: 'o1', status: 'offered' });
    const accepted = makeLoan({ id: 'a1', status: 'accepted' });
    const { byLoan, total } = projectDebtAtGraduation([offered, accepted], gradDate);
    expect(byLoan.map((l) => l.loanId)).toEqual(['a1']);
    expect(total).toBeGreaterThan(0);
  });

  it('owed principal is the accepted amount (fee does NOT inflate it); total = principal + interest', () => {
    const { total, byLoan } = projectDebtAtGraduation([makeLoan({ academicYear: 2025, disbursements: [{ id: 'd1', date: '2025-08-05', amount: 20000 }] })], gradDate);
    expect(byLoan[0].principal).toBe(20000); // no fee gross-up on what you owe
    expect(total).toBeGreaterThan(20000); // only interest pushes it above the face amount
    expect(total).toBeCloseTo(byLoan[0].principal + byLoan[0].interest, 6);
  });

  it('mixes federal and private loans and flags the total as an estimate because of the private one', () => {
    const federal = makeLoan({ id: 'f1', academicYear: 2025 });
    const priv = makeLoan({ id: 'p1', type: 'private', rate: 0.095, disbursements: [{ id: 'd1', date: '2025-09-01', amount: 10000 }] });
    const { isEstimate, byLoan } = projectDebtAtGraduation([federal, priv], gradDate);
    expect(isEstimate).toBe(true);
    expect(byLoan.find((l) => l.loanId === 'p1').isEstimate).toBe(true);
    expect(byLoan.find((l) => l.loanId === 'f1').isEstimate).toBe(false);
  });

  it('missing disbursement dates fall back to term midpoints and flag isEstimate', () => {
    const undated = makeLoan({ academicYear: 2025, disbursements: [{ id: 'd1', date: null, amount: 20000 }, { id: 'd2', date: null, amount: 20000 }] });
    const { isEstimate, byLoan } = projectDebtAtGraduation([undated], gradDate);
    expect(isEstimate).toBe(true);
    expect(byLoan[0].isEstimate).toBe(true);
    expect(byLoan[0].total).toBeGreaterThan(0); // still priced using the fallback dates, not silently zeroed
  });

  it('an empty loans list returns a zeroed, estimate-flagged result rather than crashing', () => {
    expect(projectDebtAtGraduation([], gradDate)).toEqual({ total: 0, byLoan: [], isEstimate: true, hasInferred: false });
  });

  it('basis: a federal loan with confirmed rate + dates is exact, not an estimate', () => {
    const { byLoan, hasInferred } = projectDebtAtGraduation([makeLoan({ academicYear: 2025 })], gradDate);
    expect(byLoan[0].basis).toBe('exact');
    expect(byLoan[0].isEstimate).toBe(false);
    expect(hasInferred).toBe(false);
  });

  it("basis: a fully-filled private loan is 'entered' (exact for the typed rate), not an inferred estimate", () => {
    const priv = makeLoan({ id: 'p1', type: 'private', rate: 0.095, disbursements: [{ id: 'd1', date: '2025-09-01', amount: 10000 }] });
    const { byLoan, isEstimate, hasInferred } = projectDebtAtGraduation([priv], gradDate);
    expect(byLoan[0].basis).toBe('entered');
    expect(byLoan[0].isEstimate).toBe(true);   // still not government-verified
    expect(hasInferred).toBe(false);           // ...but nothing was actually guessed
  });

  it("basis: a private loan with a guessed date is a real 'estimate'", () => {
    const priv = makeLoan({ id: 'p1', type: 'private', rate: 0.095, disbursements: [{ id: 'd1', date: null, amount: 10000 }] });
    const { byLoan, hasInferred } = projectDebtAtGraduation([priv], gradDate);
    expect(byLoan[0].basis).toBe('estimate');
    expect(hasInferred).toBe(true);
  });

  it('the award-letter offer never inflates what you owe — projection runs off the accepted amount only', () => {
    const accepted = makeLoan({ id: 'a1', academicYear: 2025, disbursements: [{ id: 'd1', date: '2025-08-05', amount: 20000 }] });
    const withOffer = { ...accepted, offeredAmount: 60000 };
    expect(projectDebtAtGraduation([withOffer], gradDate).total).toBeCloseTo(projectDebtAtGraduation([accepted], gradDate).total, 6);
  });

  it('reproduces the hand-checked studentaid.gov example end-to-end', () => {
    const loan = makeLoan({ academicYear: 2026, disbursements: [{ id: 'd1', date: '2026-08-01', amount: 20000 }] });
    const { total, byLoan } = projectDebtAtGraduation([loan], '2030-05-15');
    expect(byLoan[0].principal).toBe(20000); // owed = accepted face amount, no fee gross-up
    expect(Math.round(byLoan[0].interest * 100) / 100).toBe(6115.51);
    expect(Math.round(total * 100) / 100).toBe(Math.round((20000 + 6115.51) * 100) / 100);
  });
});

describe('computeRunway', () => {
  const gradDate = '2028-05-15';

  it('state: unanchored — no balance readings at all', () => {
    expect(computeRunway({ readings: [], plannedMonthlyBurn: 2000, upcomingRefunds: [], gradDate, today: '2026-10-01' })).toEqual({ state: 'unanchored', plannedMonthlyBurn: 2000 });
  });

  it('state: overdrawn — spendable at or below 0, notes when savings covers it', () => {
    const readings = [{ id: 'r1', date: '2026-10-01', spendable: -50, savings: 3000 }];
    const r = computeRunway({ readings, plannedMonthlyBurn: 2000, upcomingRefunds: [], gradDate, today: '2026-10-05' });
    expect(r.state).toBe('overdrawn');
    expect(r.coveredBySavings).toBe(true);
    const noSavings = computeRunway({ readings: [{ id: 'r1', date: '2026-10-01', spendable: 0, savings: null }], plannedMonthlyBurn: 2000, upcomingRefunds: [], gradDate, today: '2026-10-05' });
    expect(noSavings.coveredBySavings).toBe(false);
  });

  it('state: growing — burn at/below the epsilon (spending less than she brings in)', () => {
    const readings = [
      { id: 'r1', date: '2026-09-01', spendable: 5000, savings: 0 },
      { id: 'r2', date: '2026-10-01', spendable: 5200, savings: 0 }, // balance went UP
    ];
    const r = computeRunway({ readings, plannedMonthlyBurn: 2000, upcomingRefunds: [], gradDate, today: '2026-10-05' });
    expect(r.state).toBe('growing');
    // A rising balance still reports the plan comparison — it's the clearest
    // "you're ahead", and the tile must not go blank there. Spent ~$0 against a
    // $2000/mo plan → well ahead of plan (drift positive).
    expect(r.actualPace).not.toBeNull();
    expect(r.actualPace.perMonth).toBe(0);
    expect(r.actualPace.drift).toBeGreaterThan(0);
  });

  it('state: through_graduation — money (with savings cushion) comfortably outlasts gradDate', () => {
    const readings = [
      { id: 'r1', date: '2026-09-01', spendable: 20000, savings: 0 },
      { id: 'r2', date: '2026-10-01', spendable: 19700, savings: 0 }, // $300/mo burn
    ];
    const r = computeRunway({ readings, plannedMonthlyBurn: 300, upcomingRefunds: [], gradDate, today: '2026-10-05' });
    expect(r.state).toBe('through_graduation');
  });

  it('state: counting_down — runs out before graduation, no refund in the way', () => {
    const readings = [
      { id: 'r1', date: '2026-09-01', spendable: 3000, savings: 0 },
      { id: 'r2', date: '2026-10-01', spendable: 1000, savings: 0 }, // $2000/mo burn, runs out fast
    ];
    const r = computeRunway({ readings, plannedMonthlyBurn: 2000, upcomingRefunds: [], gradDate, today: '2026-10-05' });
    expect(r.state).toBe('counting_down');
    expect(r.runOutDate > '2026-10-01').toBe(true);
    expect(r.runOutDate < gradDate).toBe(true);
  });

  it('state: gap — runs out before graduation AND before the next known refund, with a trim suggestion', () => {
    // $8500 -> $6400 over 30 days ≈ $2130.80/mo burn → runs out 2026-12-31, 12 days before the 2027-01-12 refund.
    const readings = [
      { id: 'r1', date: '2026-09-01', spendable: 8500, savings: 0 },
      { id: 'r2', date: '2026-10-01', spendable: 6400, savings: 0 },
    ];
    const upcomingRefunds = [{ date: '2027-01-12', amount: 14200, term: '2027-spring' }];
    const r = computeRunway({ readings, plannedMonthlyBurn: 2130.8, upcomingRefunds, gradDate, today: '2026-10-05' });
    expect(r.state).toBe('gap');
    // The dry spell is still caught — cash runs out 2026-12-31, 12 days early.
    expect(r.gapDays).toBe(12);
    expect(r.shortfalls[0].date).toBe('2026-12-31');
    expect(r.trimPerMonthToClose).toBeGreaterThan(0);
    // ...but runOutDate now counts the $14,200 landing 2027-01-12, so it's the
    // date the money is ACTUALLY gone, not the date the current cash alone ran
    // dry. Reporting 2026-12-31 as "you run out" contradicted Safe to spend,
    // which had always counted that refund.
    expect(r.runOutDate > '2027-01-12').toBe(true);
  });

  it('trim math floors tiny gaps (<7 days) to "basically on track" instead of an alarming gap', () => {
    // $3100 -> $3000 over 30 days ≈ $101.47/mo measured burn → runs out 2029-03-19; refund set 3 days after that (<7-day gap floor).
    const tight = [
      { id: 'r1', date: '2026-09-01', spendable: 3100, savings: 0 },
      { id: 'r2', date: '2026-10-01', spendable: 3000, savings: 0 },
    ];
    // $3,000 at the planned $100/mo runs dry 2029-04-01; the money lands 4 days
    // later, so there IS a dip but it's under the 7-day alarm floor.
    const upcomingRefunds = [{ date: '2029-04-05', amount: 5000, term: '2029-spring' }];
    const r = computeRunway({ readings: tight, plannedMonthlyBurn: 100, upcomingRefunds, gradDate: '2030-01-01', today: '2026-10-05' });
    // A dip that short is noise, not a crisis, so it never becomes a 'gap'. With
    // the $5,000 counted the money then reaches graduation. Either way: calm.
    expect(r.state).not.toBe('gap');
    expect(r.shortfalls[0].daysShort).toBeLessThan(7);
  });

  it('measured burn requires a ≥14-day window between readings, else falls back to the plan', () => {
    const readings = [
      { id: 'r1', date: '2026-10-01', spendable: 5000, savings: 0 },
      { id: 'r2', date: '2026-10-05', spendable: 3000, savings: 0 }, // only 4 days apart — a $2000 swing shouldn't be trusted as "monthly pace"
    ];
    const r = computeRunway({ readings, plannedMonthlyBurn: 1500, upcomingRefunds: [], gradDate, today: '2026-10-06' });
    expect(r.burn.source).toBe('plan');
    expect(r.burn.amount).toBe(1500);
  });

  it('a single reading has no window to measure from — always uses the plan', () => {
    const readings = [{ id: 'r1', date: '2026-10-01', spendable: 5000, savings: 0 }];
    const r = computeRunway({ readings, plannedMonthlyBurn: 1200, upcomingRefunds: [], gradDate, today: '2026-10-05' });
    expect(r.burn.source).toBe('plan');
    expect(r.burn.windowDays).toBe(null);
  });

  it('gradDate at or before today suppresses runway entirely ("graduated")', () => {
    const readings = [{ id: 'r1', date: '2026-10-01', spendable: 5000, savings: 0 }];
    expect(computeRunway({ readings, plannedMonthlyBurn: 1200, upcomingRefunds: [], gradDate: '2026-10-01', today: '2026-10-01' }).state).toBe('graduated');
    expect(computeRunway({ readings, plannedMonthlyBurn: 1200, upcomingRefunds: [], gradDate: '2026-01-01', today: '2026-10-05' }).state).toBe('graduated');
  });

  it('future-dated readings are rejected rather than trusted', () => {
    const readings = [
      { id: 'r1', date: '2026-09-01', spendable: 5000, savings: 0 },
      { id: 'r2', date: '2099-01-01', spendable: 1, savings: 0 }, // clock-skew / typo — must not become "latest"
    ];
    const r = computeRunway({ readings, plannedMonthlyBurn: 1500, upcomingRefunds: [], gradDate, today: '2026-10-05' });
    expect(r.asOf).toBe('2026-09-01');
    expect(r.spendable).toBe(5000);
  });

  it('same-date readings from two devices coalesce to the later array entry, never NaN', () => {
    const readings = [
      { id: 'r1', date: '2026-09-01', spendable: 6000, savings: 0 },
      { id: 'r-phone', date: '2026-10-01', spendable: 4700, savings: 0 },
      { id: 'r-laptop', date: '2026-10-01', spendable: 4650, savings: 0 }, // same date, added after — should win
    ];
    const r = computeRunway({ readings, plannedMonthlyBurn: 1500, upcomingRefunds: [], gradDate, today: '2026-10-05' });
    expect(r.spendable).toBe(4650);
    expect(Number.isNaN(r.burn.amount)).toBe(false);
  });

  it('a checking→savings transfer between readings does NOT distort burn (burn is measured off the TOTAL)', () => {
    const readings = [
      { id: 'r1', date: '2026-09-01', spendable: 9000, savings: 5000 }, // total 14000
      { id: 'r2', date: '2026-10-01', spendable: 1000, savings: 13000 }, // total 14000 — moved $8000 into savings, spent $0
    ];
    const r = computeRunway({ readings, plannedMonthlyBurn: 2000, upcomingRefunds: [], gradDate, today: '2026-10-05' });
    expect(r.state).toBe('growing'); // true spend was ~$0, must not read as an $8000/mo burn
  });

  it('a null savings value coalesces to 0 rather than breaking the total', () => {
    const readings = [
      { id: 'r1', date: '2026-09-01', spendable: 5000, savings: null },
      { id: 'r2', date: '2026-10-01', spendable: 4500, savings: null },
    ];
    const r = computeRunway({ readings, plannedMonthlyBurn: 1500, upcomingRefunds: [], gradDate, today: '2026-10-05' });
    expect(r.savings).toBe(0);
    expect(r.total).toBe(4500);
    expect(Number.isNaN(r.burn.amount)).toBe(false);
  });

  it('the cushion-extension date (using spendable+savings) is later than the plain runOutDate (spendable-only)', () => {
    const readings = [
      { id: 'r1', date: '2026-09-01', spendable: 6900, savings: 10000 },
      { id: 'r2', date: '2026-10-01', spendable: 6400, savings: 10000 }, // $500/mo burn, only spendable moved
    ];
    const r = computeRunway({ readings, plannedMonthlyBurn: 500, upcomingRefunds: [], gradDate: '2035-01-01', today: '2026-10-05' });
    expect(r.cushionExtensionDate > r.runOutDate).toBe(true);
  });

  it('a wide-apart ("long-span") reading pair still normalizes correctly into a monthly rate', () => {
    const readings = [
      { id: 'r1', date: '2026-08-01', spendable: 15000, savings: 0 },
      { id: 'r2', date: '2027-02-01', spendable: 9000, savings: 0 }, // 184 days apart, $6000 spent
    ];
    const r = computeRunway({ readings, plannedMonthlyBurn: 999, upcomingRefunds: [], gradDate: '2028-01-01', today: '2027-02-05' });
    // The headline burn is the PLAN now; the measured rate lives on actualPace.
    expect(r.burn.source).toBe('plan');
    // $6000 over 184 days ≈ $990.87/mo
    expect(r.actualPace.perMonth).toBeCloseTo((6000 / 184) * 30.44, 1);
  });

  it('a known refund landing strictly between two readings is netted out of the delta (straddle case) — does not read as negative spending', () => {
    const readings = [
      { id: 'r1', date: '2026-12-20', spendable: 1000, savings: 0 },
      { id: 'r2', date: '2027-01-20', spendable: 12500, savings: 0 }, // balance jumped because a refund landed mid-window
    ];
    const upcomingRefunds = [{ date: '2027-01-12', amount: 14200, term: '2027-spring' }];
    const r = computeRunway({ readings, plannedMonthlyBurn: 2000, upcomingRefunds, gradDate: '2028-01-01', today: '2027-01-25' });
    // Without crediting the refund the balance jump reads as "growing" — the
    // student looks like they spent nothing, when really they spent $2,700.
    expect(r.state).not.toBe('growing');
    expect(r.actualPace.perMonth).toBeCloseTo((2700 / 31) * 30.44, 1);
  });

  it('a refund whose date falls OUTSIDE the reading window is not netted out (only straddling refunds count)', () => {
    const readings = [
      { id: 'r1', date: '2026-09-01', spendable: 6000, savings: 0 },
      { id: 'r2', date: '2026-10-01', spendable: 4000, savings: 0 }, // $2000 spent, no refund in this window
    ];
    const upcomingRefunds = [{ date: '2027-01-12', amount: 14200, term: '2027-spring' }]; // way outside the window
    const r = computeRunway({ readings, plannedMonthlyBurn: 2000, upcomingRefunds, gradDate: '2028-01-01', today: '2026-10-05' });
    expect(r.actualPace.perMonth).toBeCloseTo((2000 / 30) * 30.44, 1);
  });

  it('after a refund lands and a later reading absorbs it, runway recomputes to a healthier state ("clears" the gap)', () => {
    // Before the refund: the same tight gap as the dedicated gap test above.
    const before = computeRunway({
      readings: [{ id: 'r1', date: '2026-09-01', spendable: 8500, savings: 0 }, { id: 'r2', date: '2026-10-01', spendable: 6400, savings: 0 }],
      plannedMonthlyBurn: 2130.8, upcomingRefunds: [{ date: '2027-01-12', amount: 14200, term: '2027-spring' }], gradDate: '2028-05-01', today: '2026-10-05',
    });
    expect(before.state).toBe('gap');
    // After the refund lands and a new reading captures it (her mom's unrelated $100 gift the month before
    // is just absorbed into the balance too — nothing special needs to happen for that; it's the same math).
    const after = computeRunway({
      readings: [
        { id: 'r1', date: '2026-09-01', spendable: 8500, savings: 0 },
        { id: 'r2', date: '2026-10-01', spendable: 6400, savings: 0 },
        { id: 'r3', date: '2027-02-01', spendable: 18500, savings: 0 }, // refund landed, some spending since
      ],
      plannedMonthlyBurn: 2130.8, upcomingRefunds: [{ date: '2027-01-12', amount: 14200, term: '2027-spring' }], gradDate: '2028-05-01', today: '2027-02-05',
    });
    // The point is the gap clears. Which healthy state it lands in depends on
    // the plan burn now, so assert the meaningful thing rather than the label.
    expect(after.state).not.toBe('gap');
    expect(after.runOutDate > '2027-02-01').toBe(true);
  });
});

describe('estimateRefunds', () => {
  it('splits net aid (grant - tuition - health) into two half-sized term refunds', () => {
    const years = [{ label: 'Year 1', grant: 40000, tuitionFees: 10000, healthIns: 2000, startDate: '2026-08-01' }];
    const refunds = estimateRefunds(years);
    expect(refunds).toHaveLength(2);
    expect(refunds[0].amount).toBe(14000); // (40000-10000-2000)/2
    expect(refunds[1].amount).toBe(14000);
  });

  it('the fall refund lags the year start by ~10 days, spring by ~5 months', () => {
    const years = [{ label: 'Year 1', grant: 40000, tuitionFees: 10000, healthIns: 0, startDate: '2026-08-01' }];
    const [fall, spring] = estimateRefunds(years);
    expect(fall.date).toBe('2026-08-11');
    expect(spring.date).toBe('2027-01-01');
  });

  it('dates are returned as a ±7-day window, not a bare point date', () => {
    const years = [{ label: 'Year 1', grant: 40000, tuitionFees: 10000, healthIns: 0, startDate: '2026-08-01' }];
    const [fall] = estimateRefunds(years);
    expect(fall.windowStart).toBe('2026-08-04');
    expect(fall.windowEnd).toBe('2026-08-18');
  });

  it('a year with nothing left over after costs (floored at 0) yields no refund', () => {
    const years = [{ label: 'Free-tuition year', grant: 5000, tuitionFees: 8000, healthIns: 0, startDate: '2026-08-01' }];
    expect(estimateRefunds(years)).toEqual([]);
  });

  it('a missing or garbage startDate yields an undated, isEstimate refund instead of a confidently wrong date', () => {
    const years = [{ label: 'Bad data', grant: 40000, tuitionFees: 10000, healthIns: 0, startDate: '1926-01-01' }];
    const refunds = estimateRefunds(years);
    expect(refunds.every((r) => r.date === null && r.isEstimate === true)).toBe(true);
    const missing = estimateRefunds([{ label: 'No date', grant: 40000, tuitionFees: 10000, healthIns: 0, startDate: null }]);
    expect(missing.every((r) => r.date === null && r.isEstimate === true)).toBe(true);
  });
});

describe('estimateRefunds — loan money is incoming cash too', () => {
  const year = { id: 0, label: 'Year 1', grant: 5000, tuitionFees: 34000, healthIns: 4200, startDate: '2025-08-01' };
  const privateLoan = (over = {}) => makeLoan({
    type: 'private', subtype: 'private', academicYear: 2025, status: 'disbursed',
    disbursements: [
      { id: 'd1', date: '2025-08-05', amount: 25000, dateConfirmed: true },
      { id: 'd2', date: '2026-01-10', amount: 25000, dateConfirmed: true },
    ],
    ...over,
  });

  it('adds loan disbursements on their own real dates', () => {
    const refunds = estimateRefunds([year], [privateLoan()]);
    expect(refunds.map((r) => r.date)).toEqual(['2025-08-05', '2025-08-11', '2026-01-01', '2026-01-10']);
  });

  it('scales every inflow so the year sums to what actually reaches the student', () => {
    // Gross in = 5000 grant + 50000 loans = 55000; school takes 38200; so
    // 16800 reaches the account and the refunds must total exactly that.
    const refunds = estimateRefunds([year], [privateLoan()]);
    const total = refunds.reduce((a, r) => a + r.amount, 0);
    expect(total).toBeCloseTo(16800, 6);
  });

  it('does NOT model a disbursement as fully spendable — tuition comes out first', () => {
    // The regression this scaling exists to prevent: a naive implementation
    // would report the full 25000 disbursement as incoming spendable cash.
    const refunds = estimateRefunds([year], [privateLoan()]);
    const fallLoan = refunds.find((r) => r.date === '2025-08-05');
    expect(fallLoan.amount).toBeLessThan(25000);
    expect(fallLoan.amount).toBeCloseTo(25000 * (16800 / 55000), 6); // ≈7636
  });

  it('takes the origination fee off before counting loan cash as inflow', () => {
    const federal = makeLoan({
      academicYear: 2025, status: 'disbursed', subtype: 'directUnsubGrad',
      disbursements: [{ id: 'd1', date: '2025-08-05', amount: 50000, dateConfirmed: true }],
    });
    const noCosts = { ...year, grant: 0, tuitionFees: 0, healthIns: 0 };
    const [r] = estimateRefunds([noCosts], [federal]);
    expect(r.amount).toBeCloseTo(50000 * (1 - FEDERAL_ORIGINATION_FEE), 6);
  });

  it('marks a disbursement whose date was never confirmed as an estimate', () => {
    const loan = privateLoan({ disbursements: [{ id: 'd1', date: '2025-08-05', amount: 25000, dateConfirmed: false }] });
    const [r] = estimateRefunds([{ ...year, grant: 0, tuitionFees: 0, healthIns: 0 }], [loan]);
    expect(r.isEstimate).toBe(true);
  });

  it('ignores offered loans, other years, and current-balance loans', () => {
    const noCosts = { ...year, grant: 0, tuitionFees: 0, healthIns: 0 };
    expect(estimateRefunds([noCosts], [privateLoan({ status: 'offered' })])).toEqual([]);
    expect(estimateRefunds([noCosts], [privateLoan({ academicYear: 2031 })])).toEqual([]);
    expect(estimateRefunds([noCosts], [privateLoan({ asOfBalance: 100, asOfDate: '2026-01-01' })])).toEqual([]);
  });

  it('lets loans create a refund in a year where grants alone were swallowed by costs', () => {
    // Grants (5000) < costs (38200), so the grants-only model yielded nothing.
    expect(estimateRefunds([year], [])).toEqual([]);
    expect(estimateRefunds([year], [privateLoan()]).length).toBeGreaterThan(0);
  });
});

describe('computeRunway — a loan landing mid-window must not read as negative burn', () => {
  const gradDate = '2029-05-15';

  it('nets an expected loan disbursement out of the measured spending pace', () => {
    // Balance jumps 4000 → 22000 because 20000 landed on the 15th. Real
    // spending was 2000. Without netting, burn reads as -18000/mo ("growing").
    const readings = [
      { id: 'r1', date: '2026-09-01', spendable: 4000, savings: 0 },
      { id: 'r2', date: '2026-10-01', spendable: 22000, savings: 0 },
    ];
    const upcomingRefunds = [{ term: 'loan', amount: 20000, date: '2026-09-15', isEstimate: false }];
    const r = computeRunway({ readings, plannedMonthlyBurn: 3000, upcomingRefunds, gradDate, today: '2026-10-02' });
    expect(r.state).not.toBe('growing');                                   // spending, not growth
    expect(r.actualPace.perMonth).toBeCloseTo((2000 / 30) * DAYS_PER_MONTH, 6); // 30-day window → ~2029/mo
  });

  it('without the disbursement accounted for, the same readings look like growth', () => {
    // Documents exactly what breaks if loans stop reaching upcomingRefunds.
    const readings = [
      { id: 'r1', date: '2026-09-01', spendable: 4000, savings: 0 },
      { id: 'r2', date: '2026-10-01', spendable: 22000, savings: 0 },
    ];
    const r = computeRunway({ readings, plannedMonthlyBurn: 3000, upcomingRefunds: [], gradDate, today: '2026-10-02' });
    expect(r.state).toBe('growing');
  });
});

describe('loanReturnWindows', () => {
  it('computes a 120-day deadline and daysLeft per disbursement', () => {
    const loans = [makeLoan({ disbursements: [{ id: 'd1', date: '2026-08-05', amount: 20000, dateConfirmed: true }] })];
    const [w] = loanReturnWindows(loans, '2026-08-10');
    expect(w.deadline).toBe('2026-12-03');
    expect(w.daysLeft).toBe(115);
    expect(w.dateConfirmed).toBe(true);
  });

  it('filters out windows whose 120-day deadline has already passed', () => {
    const loans = [makeLoan({ disbursements: [{ id: 'd1', date: '2026-01-01', amount: 20000 }] })];
    expect(loanReturnWindows(loans, '2026-08-10')).toEqual([]);
  });

  it('an inferred (unconfirmed) disbursement date still returns a window, flagged so the UI can show soft copy', () => {
    const loans = [makeLoan({ disbursements: [{ id: 'd1', date: '2026-08-05', amount: 20000 }] })]; // dateConfirmed omitted
    const [w] = loanReturnWindows(loans, '2026-08-10');
    expect(w.dateConfirmed).toBe(false);
  });

  // A student who pre-enters a future year's loans must NOT see a live "N days
  // left to return money you didn't need" for cash that hasn't been disbursed
  // yet — you can't return money that never arrived. The window opens only once
  // the disbursement date is on or before today.
  it('does not open a window for a disbursement dated in the future', () => {
    const loans = [makeLoan({ disbursements: [{ id: 'd1', date: '2028-08-05', amount: 20000, dateConfirmed: true }] })];
    expect(loanReturnWindows(loans, '2026-07-28')).toEqual([]);
  });

  it('opens the window the day the money lands and not before', () => {
    const loans = [makeLoan({ disbursements: [{ id: 'd1', date: '2026-08-05', amount: 20000, dateConfirmed: true }] })];
    expect(loanReturnWindows(loans, '2026-08-04')).toEqual([]);          // day before disbursement
    expect(loanReturnWindows(loans, '2026-08-05')).toHaveLength(1);       // day it lands
  });

  // ⚠ REGRESSION (2026-07-18 hotfix, break-testing finding C1): break-testing
  // pinned the exact seeded scenario — a federal loan disbursed Aug 5 2025 +
  // Jan 10 2025, plus an HPSL loan disbursed Aug 5 2025 — and reported the UI
  // showing "138 days left" / "296 days left" on today=2026-07-18, which is
  // impossible: every 120-day window on these dates closed by May/Dec 2025.
  // `loanReturnWindows` itself was already correct (this pins that so it can
  // never regress); the return card (`ReturnWindowCard`/`RefundPlaybook` in
  // src/tabs/LoansTab.jsx) renders EXCLUSIVELY from this function's output —
  // an empty array means no card at all, never a fallback/derived date.
  it('pins the seeded break-testing scenario: Aug 5 2025 + Jan 10 2025 disbursements, today=2026-07-18 → no open windows at all', () => {
    const federal = makeLoan({
      id: 'ln_federal',
      disbursements: [
        { id: 'd1a', date: '2025-08-05', amount: 20500, dateConfirmed: true },
        { id: 'd1b', date: '2025-01-10', amount: 20500, dateConfirmed: true },
      ],
    });
    const hpsl = makeLoan({
      id: 'ln_hpsl',
      disbursements: [{ id: 'd2a', date: '2025-08-05', amount: 8500, dateConfirmed: true }],
    });
    expect(loanReturnWindows([federal, hpsl], '2026-07-18')).toEqual([]);
  });
});

describe('refundPlaybookTrigger', () => {
  const nextRefund = { date: '2027-01-12', amount: 14200, term: '2027-spring' };

  it('fires when the refund date has passed, the latest reading postdates it, and the balance jumped ≥50% of the expected amount', () => {
    const readings = [
      { id: 'r1', date: '2027-01-05', spendable: 6400, savings: 0 },
      { id: 'r2', date: '2027-01-13', spendable: 20600, savings: 0 }, // jumped $14,200
    ];
    expect(refundPlaybookTrigger({ readings, nextRefund, refundPlaybookSeen: null, today: '2027-01-14' })).toBe(true);
  });

  it('does not fire on a jump under the 50% threshold (e.g. an unrelated gift, not the refund)', () => {
    const readings = [
      { id: 'r1', date: '2027-01-05', spendable: 6400, savings: 0 },
      { id: 'r2', date: '2027-01-13', spendable: 6500, savings: 0 }, // $100 bump, not a refund
    ];
    expect(refundPlaybookTrigger({ readings, nextRefund, refundPlaybookSeen: null, today: '2027-01-14' })).toBe(false);
  });

  it('suppressed once already seen for that term', () => {
    const readings = [
      { id: 'r1', date: '2027-01-05', spendable: 6400, savings: 0 },
      { id: 'r2', date: '2027-01-13', spendable: 20600, savings: 0 },
    ];
    expect(refundPlaybookTrigger({ readings, nextRefund, refundPlaybookSeen: { term: '2027-spring', at: '2027-01-13T00:00:00Z' }, today: '2027-01-14' })).toBe(false);
  });

  it('the user-confirmed "did your refund land?" path fires immediately regardless of balance evidence', () => {
    expect(refundPlaybookTrigger({ readings: [], nextRefund, refundPlaybookSeen: null, today: '2027-01-14', confirmed: true })).toBe(true);
  });

  it('does not fire before the refund date has even passed', () => {
    const readings = [{ id: 'r1', date: '2027-01-05', spendable: 6400, savings: 0 }];
    expect(refundPlaybookTrigger({ readings, nextRefund, refundPlaybookSeen: null, today: '2027-01-10' })).toBe(false);
  });
});

// ── Package A: per-type loan interest model (2026-07-17) ─────────────────────
// Founder decision #1 — each loan type carries its own accrual profile
// instead of one global "always accrues" assumption. The mandatory guard
// here is the regression test: every loan that existed before this model
// (subtype:null) must price IDENTICALLY to pre-change behavior.

describe('loanTypeKey', () => {
  it('subtype always wins when set', () => {
    expect(loanTypeKey(makeLoan({ subtype: 'hpsl', type: 'private' }))).toBe('hpsl');
    expect(loanTypeKey(makeLoan({ subtype: 'gradPLUS', type: 'federal' }))).toBe('gradPLUS');
  });
  it('legacy resolution (subtype null/undefined): private type → "private", anything else → "directUnsubGrad"', () => {
    expect(loanTypeKey(makeLoan({ type: 'private', subtype: null }))).toBe('private');
    expect(loanTypeKey(makeLoan({ type: 'federal', subtype: null }))).toBe('directUnsubGrad');
    expect(loanTypeKey(makeLoan({ type: 'federal' }))).toBe('directUnsubGrad'); // subtype entirely absent (pre-Package-A synced loan)
  });
});

describe('MANDATORY REGRESSION — subtype:null loans resolve through the same path as a legacy loan', () => {
  it('the $20,000 @ 8.07% hand-check (2026-08-01 → 2030-05-15 ≈ $6,116, fee not grossed up) is unchanged with an explicit subtype:null', () => {
    const loan = makeLoan({
      subtype: null,
      academicYear: 2026,
      disbursements: [{ id: 'd1', date: '2026-08-01', amount: 20000 }],
    });
    const total = accruedInterest(loan, '2030-05-15');
    expect(Math.round(total * 100) / 100).toBe(6115.51); // accrues on the face amount, no fee gross-up
    expect(loanPrincipal(loan)).toBe(20000); // owed = accepted face amount
  });
  it('a fully legacy loan (no subtype field at all) resolves through the same path as an explicit null', () => {
    const withNull = makeLoan({ subtype: null, academicYear: 2025 });
    const withoutField = makeLoan({ academicYear: 2025 });
    delete withoutField.subtype;
    expect(effectiveRate(withoutField)).toBe(effectiveRate(withNull));
    expect(accruedInterest(withoutField, '2028-01-01')).toBeCloseTo(accruedInterest(withNull, '2028-01-01'), 8);
    expect(projectDebtAtGraduation([withoutField], '2029-05-15').total)
      .toBeCloseTo(projectDebtAtGraduation([withNull], '2029-05-15').total, 8);
  });
});

describe('HPSL / PCL / LDS — interest-free through school (founder decision #1)', () => {
  it('$20,000 @ 5% disbursed in the fall: zero accrued interest at graduation, no origination fee, debt tile = $20,000 flat', () => {
    const loan = makeLoan({
      subtype: 'hpsl', type: 'private', academicYear: 2026, rate: null,
      disbursements: [{ id: 'd1', date: '2026-08-05', amount: 20000 }],
    });
    expect(effectiveRate(loan)).toBe(HRSA_RATE); // fixed 5%, not a table lookup
    expect(effectiveFeePct(loan)).toBe(0); // HRSA loans carry no origination fee
    expect(accruedInterest(loan, '2030-05-15')).toBe(0); // accruesInSchool:false — the whole point of the fix
    expect(loanPrincipal(loan)).toBe(20000); // no fee inflation

    const { total, byLoan } = projectDebtAtGraduation([loan], '2030-05-15');
    expect(total).toBe(20000);
    expect(byLoan[0].interest).toBe(0);
    expect(byLoan[0].isEstimate).toBe(false); // a known statutory rate + confirmed dates is NOT an "estimate"
  });
  it('PCL and LDS share the identical profile (distinct keys, same behavior)', () => {
    const pcl = makeLoan({ subtype: 'pcl', type: 'private', disbursements: [{ id: 'd1', date: '2026-08-05', amount: 10000 }] });
    const lds = makeLoan({ subtype: 'lds', type: 'private', disbursements: [{ id: 'd1', date: '2026-08-05', amount: 10000 }] });
    expect(accruedInterest(pcl, '2030-01-01')).toBe(0);
    expect(accruedInterest(lds, '2030-01-01')).toBe(0);
    expect(effectiveRate(pcl)).toBe(HRSA_RATE);
    expect(effectiveRate(lds)).toBe(HRSA_RATE);
  });
});

describe('Direct Subsidized (undergrad) — interest-free in school', () => {
  it('accrues $0 toward the graduation number, same mechanism as HPSL', () => {
    const loan = makeLoan({ subtype: 'directSubUndergrad', type: 'federal', academicYear: 2025, disbursements: [{ id: 'd1', date: '2025-08-05', amount: 5000 }] });
    expect(accruedInterest(loan, '2029-05-15')).toBe(0);
  });
});

describe('Grad PLUS — own rate table + fee, but the fee no longer inflates what you owe', () => {
  it('the rate comes from the PLUS table (not grad-unsub); the larger 4.228% fee shows up as less cash received, not more debt', () => {
    const loan = makeLoan({ subtype: 'gradPLUS', type: 'federal', academicYear: 2026, rate: null, disbursements: [{ id: 'd1', date: '2026-08-01', amount: 20000 }] });
    expect(effectiveFeePct(loan)).toBe(FEDERAL_GRAD_PLUS_FEE);
    expect(effectiveRate(loan)).toBe(FEDERAL_GRAD_PLUS_RATES[2026]); // 9.07% — published FSA Partners 2026-27 rate, distinct from the 8.07% grad-unsub rate
    expect(effectiveRate(loan)).not.toBe(FEDERAL_GRAD_UNSUB_RATES[2026]);
    expect(loanPrincipal(loan)).toBe(20000); // owed = accepted face amount, fee not added
    // The bigger PLUS fee reaches the account as less cash — a lower cashReceived
    // than the standard Direct Loan fee would give, NOT a higher owed principal.
    expect(cashReceived(loan)).toBeCloseTo(20000 * (1 - FEDERAL_GRAD_PLUS_FEE), 6);
    expect(cashReceived(loan)).toBeLessThan(20000 * (1 - FEDERAL_ORIGINATION_FEE));
  });
});

describe('otherUserRate — behaves exactly like today\'s private path when the student enters a rate', () => {
  it('uses the entered rate, standard no-fee-unless-set behavior, accrues normally', () => {
    const loan = makeLoan({ subtype: 'otherUserRate', type: 'private', rate: 0.095, disbursements: [{ id: 'd1', date: '2026-08-01', amount: 15000 }] });
    expect(effectiveRate(loan)).toBe(0.095);
    expect(effectiveFeePct(loan)).toBe(0);
    expect(isRateEstimated(loan)).toBe(false); // rate was explicitly entered
    expect(accruedInterest(loan, '2027-08-01')).toBeCloseTo(15000 * 0.095, 0); // ~1 year simple interest
  });
  it('with no rate entered, reads as 0% and flags estimated (mirrors bare private-loan behavior)', () => {
    const loan = makeLoan({ subtype: 'otherUserRate', type: 'private', rate: null });
    expect(effectiveRate(loan)).toBe(0);
    expect(isRateEstimated(loan)).toBe(true);
  });
});

// ── statutoryRate (item 6) ────────────────────────────────────────────────────
describe('statutoryRate — the type\'s set rate, ignoring any student override', () => {
  it('returns the fixed/table rate even when the student typed a DIFFERENT rate (the item-6 bug)', () => {
    expect(statutoryRate(makeLoan({ subtype: 'hpsl', type: 'private', rate: 0.03 }))).toBe(HRSA_RATE);
    expect(statutoryRate(makeLoan({ subtype: 'directUnsubGrad', academicYear: 2025, rate: 0.02 }))).toBe(FEDERAL_GRAD_UNSUB_RATES[2025]);
    expect(statutoryRate(makeLoan({ subtype: 'gradPLUS', academicYear: 2026, rate: 0.11 }))).toBe(FEDERAL_GRAD_PLUS_RATES[2026]);
  });
  it('clamps out-of-table years to the nearest known year', () => {
    expect(statutoryRate(makeLoan({ subtype: 'directUnsubGrad', academicYear: 2008 }))).toBe(FEDERAL_GRAD_UNSUB_RATES[2013]);
    expect(statutoryRate(makeLoan({ subtype: 'directUnsubGrad', academicYear: 2031 }))).toBe(FEDERAL_GRAD_UNSUB_RATES[2026]);
  });
  it('returns null for private/other types, which have no set rate', () => {
    expect(statutoryRate(makeLoan({ subtype: 'private', type: 'private' }))).toBe(null);
    expect(statutoryRate(makeLoan({ subtype: 'otherUserRate', type: 'private' }))).toBe(null);
  });
});

// ── interest deferral (founder decision, 2026-07-22) ──────────────────────────
// Interest deferral is an explicit per-loan toggle: when on, no interest accrues
// before the "interest starts on" date. Defaults per type (HPSL/subsidized ON,
// unsubsidized/private OFF) and generalizes the old accruesInSchool short-circuit.
describe('isInterestDeferred — per-type default, overridable', () => {
  it('defaults OFF for unsubsidized/private, ON for HPSL family / subsidized undergrad', () => {
    expect(isInterestDeferred(makeLoan({ subtype: 'directUnsubGrad' }))).toBe(false);
    expect(isInterestDeferred(makeLoan({ subtype: 'gradPLUS' }))).toBe(false);
    expect(isInterestDeferred(makeLoan({ subtype: 'private', type: 'private' }))).toBe(false);
    expect(isInterestDeferred(makeLoan({ subtype: 'hpsl', type: 'private' }))).toBe(true);
    expect(isInterestDeferred(makeLoan({ subtype: 'lds', type: 'private' }))).toBe(true);
    expect(isInterestDeferred(makeLoan({ subtype: 'directSubUndergrad' }))).toBe(true);
  });
  it('an explicit interestDeferred flag overrides the per-type default', () => {
    expect(isInterestDeferred(makeLoan({ subtype: 'hpsl', type: 'private', interestDeferred: false }))).toBe(false);
    expect(isInterestDeferred(makeLoan({ subtype: 'directUnsubGrad', interestDeferred: true }))).toBe(true);
  });
});

describe('accruedInterest — interest deferral start date', () => {
  const base = makeLoan({ academicYear: 2026, rate: null, subtype: 'directUnsubGrad', disbursements: [{ id: 'd1', date: '2026-08-01', amount: 20000 }] });

  it('deferred: interest accrues only from the start date — same as a loan disbursed on that date', () => {
    const deferred = { ...base, interestDeferred: true, interestStartDate: '2027-01-01' };
    const fromStart = makeLoan({ academicYear: 2026, rate: null, subtype: 'directUnsubGrad', disbursements: [{ id: 'd1', date: '2027-01-01', amount: 20000 }] });
    expect(accruedInterest(deferred, '2027-07-01')).toBeCloseTo(accruedInterest(fromStart, '2027-07-01'), 6);
    expect(accruedInterest(deferred, '2027-07-01')).toBeGreaterThan(0);
    // ...and strictly less than the same loan with no deferral (which accrued from Aug 1)
    expect(accruedInterest(deferred, '2027-07-01')).toBeLessThan(accruedInterest(base, '2027-07-01'));
  });

  it('deferred: zero interest at any date before the start date is reached', () => {
    const deferred = { ...base, interestDeferred: true, interestStartDate: '2027-01-01' };
    expect(accruedInterest(deferred, '2026-12-01')).toBe(0);
    expect(accruedInterest(deferred, '2027-01-01')).toBe(0); // the start day itself has zero elapsed days
  });

  it('deferred with NO start date set accrues nothing within the horizon (the HPSL default, unchanged)', () => {
    const hpsl = makeLoan({ subtype: 'hpsl', type: 'private', disbursements: [{ id: 'd1', date: '2026-08-05', amount: 20000 }] });
    expect(accruedInterest(hpsl, '2030-05-15')).toBe(0);
  });

  it('turning deferral OFF on an HPSL makes it accrue from disbursement at the 5% HRSA rate', () => {
    const hpsl = makeLoan({ subtype: 'hpsl', type: 'private', rate: null, interestDeferred: false, feePct: 0, disbursements: [{ id: 'd1', date: '2026-08-01', amount: 20000 }] });
    expect(accruedInterest(hpsl, '2027-08-01')).toBeCloseTo(20000 * 0.05, 0); // ~1yr simple interest, no fee
  });

  it('a non-deferred loan ignores any stray interestStartDate', () => {
    const withStray = { ...base, interestDeferred: false, interestStartDate: '2027-01-01' };
    expect(accruedInterest(withStray, '2027-07-01')).toBeCloseTo(accruedInterest(base, '2027-07-01'), 6);
  });

  it('as-of-balance mode also honors a deferral start date', () => {
    const loan = makeLoan({ subtype: 'directUnsubGrad', rate: 0.08, asOfDate: '2027-01-01', asOfBalance: 25000, disbursements: [], interestDeferred: true, interestStartDate: '2027-07-01' });
    expect(accruedInterest(loan, '2027-04-01')).toBe(0); // before the start date
    // ~1yr of simple interest counted from the start date (2027-07-01), not the as-of date.
    const oneYearFromStart = 25000 * 0.08 * (366 / 365); // 2027-07-01 → 2028-07-01 spans leap day 2028-02-29
    expect(accruedInterest(loan, '2028-07-01')).toBeCloseTo(oneYearFromStart, 4);
  });

  it('projectDebtAtGraduation honors the deferral start date', () => {
    const deferred = { ...base, status: 'disbursed', interestDeferred: true, interestStartDate: '2029-06-01' };
    const grad = '2030-05-15';
    const fromStart = projectDebtAtGraduation([makeLoan({ academicYear: 2026, subtype: 'directUnsubGrad', disbursements: [{ id: 'd1', date: '2029-06-01', amount: 20000 }] })], grad);
    expect(projectDebtAtGraduation([deferred], grad).total).toBeCloseTo(fromStart.total, 6);
  });
});

// ── returnSavingsAtGraduation (A3) ────────────────────────────────────────────
// ⚠ FIX (2026-07-18 hotfix, break-testing finding C2): the pre-fix version of
// this function returned the FULL drop in debt-at-graduation (returned
// principal + fee + interest), which over-counted by including the returned
// principal itself — giving back money you never spent isn't a "saving," it's
// a wash. Real-world symptom: a $8,591 excess showed "saves ~$10,804" when
// hand math said ~$2,200–$2,300 (~4.7x over). These tests hand-derive the
// CORRECT figure (fee + interest only) independently of the implementation.
describe('returnSavingsAtGraduation', () => {
  it('hand-check: returning $3,000 from a 2026-08-01 disbursement (8.07%) ~3.46yrs before graduation', () => {
    // Independently derived (not from the implementation): days(2026-08-01 → 2030-01-15) = 1263.
    // The fee is not part of owed debt (founder correction 2026-07-22), so returning
    // $3,000 only cancels the interest that would have accrued on that $3,000:
    // 3000 × .0807/365 × 1263 ≈ 837.73. The returned principal itself is a wash
    // (the student had the cash, now they don't), so it is NOT counted as savings.
    const loan = makeLoan({
      id: 'l1', academicYear: 2026, subtype: null, type: 'federal',
      disbursements: [{ id: 'd1', date: '2026-08-01', amount: 20000 }],
    });
    const window = { loanId: 'l1', disbursementId: 'd1' };
    const delta = returnSavingsAtGraduation([loan], window, '2030-01-15', 3000);
    expect(Math.round(delta * 100) / 100).toBe(837.73);
  });

  it('hand-check against the break-testing repro: ~$8,591 excess on a 7.94% loan disbursed today saves ~$2,100 by graduation, not ~$10,804 (C2, ~4.7x overstated)', () => {
    // Mirrors the exact production repro: a disbursement dated "today"
    // (dateConfirmed=true, so its 120-day window is open), ~1,124 days before
    // graduation, at the 2025-26 federal rate (7.94%).
    const today = '2026-07-18';
    const gradDate = '2029-08-15'; // ~1124 days out, matching the repro's "~1,123 days to grad"
    const loan = makeLoan({
      id: 'l1', academicYear: 2025, subtype: 'directUnsubGrad', type: 'federal', rate: null, feePct: null,
      disbursements: [{ id: 'd1', date: today, amount: 20000, dateConfirmed: true }],
    });
    const window = { loanId: 'l1', disbursementId: 'd1' };
    const excess = 8591;
    const saved = returnSavingsAtGraduation([loan], window, gradDate, excess);

    // Independent hand calc: interest cancelled on the excess, simple daily
    // interest, NOT including the returned principal itself, and no fee (the fee
    // is not part of owed debt).
    const rate = 0.0794;
    const days = Math.round((new Date(gradDate + 'T12:00:00') - new Date(today + 'T12:00:00')) / (24 * 60 * 60 * 1000));
    const expected = excess * (rate / 365) * days; // interest only

    expect(saved).toBeCloseTo(expected, 6);
    expect(saved).toBeGreaterThan(1900);
    expect(saved).toBeLessThan(2300); // real "~$2,100" range, nowhere near the buggy ~$10,804
  });

  it('editing or adding an unrelated loan never changes another loan\'s "saves ~$Y" figure (C2 — was pooled/shared)', () => {
    const federal = makeLoan({
      id: 'ln_federal', academicYear: 2025, subtype: 'directUnsubGrad', type: 'federal',
      disbursements: [
        { id: 'd1a', date: '2025-08-05', amount: 20500, dateConfirmed: true },
        { id: 'd1b', date: '2026-01-10', amount: 20500, dateConfirmed: true },
      ],
    });
    const hpsl = makeLoan({
      id: 'ln_hpsl', academicYear: 2025, subtype: 'hpsl', type: 'private', feePct: 0,
      disbursements: [{ id: 'd2a', date: '2025-08-05', amount: 8500, dateConfirmed: true }],
    });
    const gradDate = '2029-05-15';
    const window = { loanId: 'ln_federal', disbursementId: 'd1a' };

    const baseline = returnSavingsAtGraduation([federal, hpsl], window, gradDate, 5000);

    // Adding a brand-new unrelated loan must not move the federal loan's figure.
    const thirdLoan = makeLoan({
      id: 'ln_third', academicYear: 2026, subtype: 'gradPLUS', type: 'federal',
      disbursements: [{ id: 'd3a', date: '2026-08-05', amount: 15000, dateConfirmed: true }],
    });
    const withThirdLoan = returnSavingsAtGraduation([federal, hpsl, thirdLoan], window, gradDate, 5000);
    expect(withThirdLoan).toBeCloseTo(baseline, 6);

    // Editing an unrelated loan's own rate/amount must not move it either.
    const editedHpsl = { ...hpsl, disbursements: [{ ...hpsl.disbursements[0], amount: 99999 }] };
    const withEditedOther = returnSavingsAtGraduation([federal, editedHpsl], window, gradDate, 5000);
    expect(withEditedOther).toBeCloseTo(baseline, 6);
  });

  it('caps the return at the disbursement\'s own amount — can\'t return more than arrived', () => {
    const loan = makeLoan({ id: 'l1', academicYear: 2026, disbursements: [{ id: 'd1', date: '2026-08-01', amount: 2000 }] });
    const window = { loanId: 'l1', disbursementId: 'd1' };
    const cappedAt2000 = returnSavingsAtGraduation([loan], window, '2030-01-15', 2000);
    const requestedMore = returnSavingsAtGraduation([loan], window, '2030-01-15', 50000);
    expect(requestedMore).toBeCloseTo(cappedAt2000, 6);
  });

  it('never negative, and 0 for a missing loan/disbursement or non-positive amount', () => {
    const loan = makeLoan({ id: 'l1', disbursements: [{ id: 'd1', date: '2026-08-01', amount: 5000 }] });
    expect(returnSavingsAtGraduation([loan], { loanId: 'nope', disbursementId: 'd1' }, '2030-01-15', 1000)).toBe(0);
    expect(returnSavingsAtGraduation([loan], { loanId: 'l1', disbursementId: 'nope' }, '2030-01-15', 1000)).toBe(0);
    expect(returnSavingsAtGraduation([loan], { loanId: 'l1', disbursementId: 'd1' }, '2030-01-15', 0)).toBe(0);
    expect(returnSavingsAtGraduation([loan], { loanId: 'l1', disbursementId: 'd1' }, '2030-01-15', -500)).toBe(0);
    expect(returnSavingsAtGraduation([loan], null, '2030-01-15', 1000)).toBe(0);
  });

  it('leaves other loans in the portfolio untouched (only the targeted disbursement shrinks)', () => {
    const targeted = makeLoan({ id: 'l1', academicYear: 2026, disbursements: [{ id: 'd1', date: '2026-08-01', amount: 20000 }] });
    const other = makeLoan({ id: 'l2', academicYear: 2025, disbursements: [{ id: 'd2', date: '2025-08-05', amount: 10000 }] });
    const window = { loanId: 'l1', disbursementId: 'd1' };
    const before = projectDebtAtGraduation([targeted, other], '2030-01-15');
    const otherRowBefore = before.byLoan.find((l) => l.loanId === 'l2');
    returnSavingsAtGraduation([targeted, other], window, '2030-01-15', 3000);
    // Re-derive "after" the same way the function does, to confirm l2's own total never moved.
    const after = projectDebtAtGraduation(
      [{ ...targeted, disbursements: [{ id: 'd1', date: '2026-08-01', amount: 17000 }] }, other],
      '2030-01-15',
    );
    const otherRowAfter = after.byLoan.find((l) => l.loanId === 'l2');
    expect(otherRowAfter.total).toBeCloseTo(otherRowBefore.total, 6);
  });
});

// ── classifyCushionSource (A4) ────────────────────────────────────────────────
describe('classifyCushionSource', () => {
  const today = '2027-01-15';

  it('"own" — no counted loans at all', () => {
    expect(classifyCushionSource({ readings: [], loans: [], otherIncome: 0, today })).toBe('own');
    // an offered-but-not-accepted loan doesn't count as a real loan either
    const offered = makeLoan({ status: 'offered' });
    expect(classifyCushionSource({ readings: [], loans: [offered], otherIncome: 0, today })).toBe('own');
  });

  it('"loan" — an open 120-day return window is the clearest possible signal', () => {
    const loan = makeLoan({ disbursements: [{ id: 'd1', date: '2026-12-01', amount: 10000 }] }); // well within 120 days of 2027-01-15
    expect(classifyCushionSource({ readings: [], loans: [loan], otherIncome: 50000, today })).toBe('loan');
  });

  it('"loan" — a loan disbursement landed inside the burn-measurement window and dominates non-loan income there', () => {
    const loan = makeLoan({ disbursements: [{ id: 'd1', date: '2025-09-10', amount: 8000 }] }); // window closed by "today" — isolates this from the return-window rule above
    const readings = [
      { id: 'r1', date: '2025-09-01', spendable: 3000, savings: 0 },
      { id: 'r2', date: '2025-10-01', spendable: 10500, savings: 0 }, // balance jumped — the loan landing inside this window
    ];
    // otherIncome annualized is tiny relative to the $8,000 that landed in this ~30-day window
    expect(classifyCushionSource({ readings, loans: [loan], otherIncome: 6000, today: '2025-10-05' })).toBe('loan');
  });

  it('"own" — non-loan income makes up more than a quarter of combined annual inflow (the design\'s >25% threshold)', () => {
    const loan = makeLoan({ academicYear: 2024, disbursements: [{ id: 'd1', date: '2024-08-05', amount: 10000 }] }); // long-closed return window, no readings to trip the window-inflow rule
    // loanInflowAnnual = 10000, otherIncome = 5000 → share = 5000/15000 = 33% > 25%
    expect(classifyCushionSource({ readings: [], loans: [loan], otherIncome: 5000, today })).toBe('own');
  });

  it('"mixed" — ambiguous: loans exist, no open window, no window-inflow evidence, non-loan share ≤ 25%', () => {
    const loan = makeLoan({ academicYear: 2024, disbursements: [{ id: 'd1', date: '2024-08-05', amount: 10000 }] });
    // loanInflowAnnual = 10000, otherIncome = 1000 → share = 1000/11000 ≈ 9%, well under 25%
    expect(classifyCushionSource({ readings: [], loans: [loan], otherIncome: 1000, today })).toBe('mixed');
  });
});

describe('projectBalance — money still coming, and the dry spells on the way', () => {
  const base = { startDate: '2026-08-01', startBalance: 6000, dailyBurn: 100, horizon: '2027-08-01' };

  it('with no inflows, it is just balance ÷ burn (the old behaviour)', () => {
    const { runOutDate, shortfalls } = projectBalance({ ...base, inflows: [] });
    expect(runOutDate).toBe('2026-09-30'); // 6000 / 100 = 60 days
    expect(shortfalls).toEqual([]);
  });

  it('an inflow pushes the run-out date later', () => {
    const withMoney = projectBalance({ ...base, inflows: [{ date: '2026-09-01', amount: 3000 }] });
    const without = projectBalance({ ...base, inflows: [] });
    expect(withMoney.runOutDate > without.runOutDate).toBe(true);
  });

  it('records a dry spell when the money runs out before the next inflow arrives', () => {
    // 6000 at 100/day lasts 60 days (to Sep 30); the money lands Nov 1.
    const { shortfalls } = projectBalance({ ...base, inflows: [{ date: '2026-11-01', amount: 9000 }] });
    expect(shortfalls).toHaveLength(1);
    expect(shortfalls[0].date).toBe('2026-09-30');
    expect(shortfalls[0].nextInflowDate).toBe('2026-11-01');
    expect(shortfalls[0].daysShort).toBe(32);
    expect(shortfalls[0].shortBy).toBeGreaterThan(0);
  });

  it('reports NO dry spell when the money lands before the cash runs out', () => {
    const { shortfalls } = projectBalance({ ...base, inflows: [{ date: '2026-09-01', amount: 9000 }] });
    expect(shortfalls).toEqual([]);
  });

  it('catches a dry spell that happens even though the money lasts overall (the regression risk)', () => {
    // This is the case that must never be silently swallowed: there IS a gap in
    // the autumn, but the January money means the year still ends solvent.
    const r = projectBalance({
      startDate: '2026-08-01', startBalance: 6000, dailyBurn: 64, horizon: '2027-08-01',
      inflows: [{ date: '2027-01-10', amount: 11611 }],
    });
    expect(r.shortfalls).toHaveLength(1);
    expect(r.runOutDate > '2027-01-10').toBe(true);  // solvent well past the gap
  });

  it('records a dry spell per gap when several inflows are spaced out', () => {
    const { shortfalls } = projectBalance({
      startDate: '2026-08-01', startBalance: 1000, dailyBurn: 100, horizon: '2028-01-01',
      inflows: [{ date: '2026-10-01', amount: 1000 }, { date: '2026-12-01', amount: 1000 }],
    });
    expect(shortfalls).toHaveLength(2);
  });

  it('ignores money landing after the horizon', () => {
    const inside = projectBalance({ ...base, inflows: [{ date: '2026-09-01', amount: 3000 }] });
    const beyond = projectBalance({ ...base, inflows: [{ date: '2030-01-01', amount: 3000 }] });
    expect(beyond.runOutDate).toBe('2026-09-30');
    expect(beyond.runOutDate < inside.runOutDate).toBe(true);
  });

  it('ignores money dated before the start, and zero/negative amounts', () => {
    expect(projectBalance({ ...base, inflows: [{ date: '2026-01-01', amount: 5000 }] }).runOutDate).toBe('2026-09-30');
    expect(projectBalance({ ...base, inflows: [{ date: '2026-09-01', amount: 0 }] }).runOutDate).toBe('2026-09-30');
  });

  it('carries the isEstimate flag through, so a guessed date is never shown as fact', () => {
    const { shortfalls } = projectBalance({ ...base, inflows: [{ date: '2026-11-01', amount: 9000, isEstimate: true }] });
    expect(shortfalls[0].isEstimate).toBe(true);
  });

  it('returns no run-out date when nothing is being spent', () => {
    expect(projectBalance({ ...base, dailyBurn: 0, inflows: [] }).runOutDate).toBe(null);
  });
});

describe('compareToPlan — is the plan actually working?', () => {
  // $6,000 on Oct 1, plan $1,935/mo. By Nov 1 (31 days) the plan expects
  // 6000 - 1935/30.44*31 = about $4,029 left.
  const base = { plannedMonthlyBurn: 1935, inflows: [], today: '2026-11-01' };
  const on = (date, spendable, savings = 0) => ({ id: `r_${date}`, date, spendable, savings });

  it('reports overspending as a negative drift', () => {
    const r = compareToPlan({ ...base, readings: [on('2026-10-01', 6000), on('2026-11-01', 3600)] });
    expect(r.meaningful).toBe(true);
    expect(r.expected).toBeCloseTo(6000 - (1935 / 30.44) * 31, 6);
    expect(r.actual).toBe(3600);
    expect(r.drift).toBeLessThan(0);                    // behind the plan
    expect(r.actualPerMonth).toBeGreaterThan(1935);     // spending faster than planned
  });

  it('reports underspending as a positive drift', () => {
    const r = compareToPlan({ ...base, readings: [on('2026-10-01', 6000), on('2026-11-01', 5200)] });
    expect(r.drift).toBeGreaterThan(0);
    expect(r.actualPerMonth).toBeLessThan(1935);
  });

  it('adds money that landed BETWEEN the check-ins, so a payment is not read as underspending', () => {
    const withInflow = compareToPlan({
      ...base, readings: [on('2026-10-01', 6000), on('2026-11-01', 14000)],
      inflows: [{ date: '2026-10-15', amount: 10000 }],
    });
    // Without crediting the $10,000 this would look like a huge windfall; with it
    // credited, they actually spent roughly the plan.
    expect(Math.abs(withInflow.drift)).toBeLessThan(500);
    expect(withInflow.actualPerMonth).toBeGreaterThan(0);
  });

  it('stays quiet when there is only one check-in', () => {
    expect(compareToPlan({ ...base, readings: [on('2026-10-01', 6000)] }).meaningful).toBe(false);
  });

  it('stays quiet over a window too short to judge', () => {
    const r = compareToPlan({ ...base, readings: [on('2026-10-29', 6000), on('2026-11-01', 3000)], today: '2026-11-01' });
    expect(r.meaningful).toBe(false); // 3 days: one big purchase would imply an absurd pace
  });

  it('stays quiet when the drift is small enough to be noise', () => {
    const expected = 6000 - (1935 / 30.44) * 31;
    const r = compareToPlan({ ...base, readings: [on('2026-10-01', 6000), on('2026-11-01', Math.round(expected - 20))] });
    expect(r.meaningful).toBe(false);
  });

  it('counts savings as part of the balance, not just checking', () => {
    const r = compareToPlan({ ...base, readings: [on('2026-10-01', 3000, 3000), on('2026-11-01', 1000, 2600)] });
    expect(r.actual).toBe(3600);
  });

  it('never reports a negative spending pace when the balance grew', () => {
    const r = compareToPlan({ ...base, readings: [on('2026-10-01', 6000), on('2026-11-01', 9000)] });
    expect(r.actualPerMonth).toBe(0);
  });
});

describe('computeRunway — plan drives the projection, check-ins judge the plan', () => {
  const gradDate = '2029-05-15';
  const on = (date, spendable, savings = 0) => ({ id: `r_${date}`, date, spendable, savings });

  it('projects on the PLAN, so the date does not move just because spending varied', () => {
    // Same plan, very different measured pace between the two check-ins.
    const steady = computeRunway({ readings: [on('2026-09-01', 6000), on('2026-10-01', 5800)], plannedMonthlyBurn: 1000, upcomingRefunds: [], gradDate, today: '2026-10-02' });
    const splurge = computeRunway({ readings: [on('2026-09-01', 6000), on('2026-10-01', 3000)], plannedMonthlyBurn: 1000, upcomingRefunds: [], gradDate, today: '2026-10-02' });
    expect(steady.burn.source).toBe('plan');
    expect(splurge.burn.amount).toBe(1000);
    // Dates differ only because the starting balances differ, not the pace.
    expect(steady.burn.amount).toBe(splurge.burn.amount);
  });

  it('gives a date from a SINGLE check-in (the old measured path needed two, 14 days apart)', () => {
    const r = computeRunway({ readings: [on('2026-10-01', 6000)], plannedMonthlyBurn: 1000, upcomingRefunds: [], gradDate, today: '2026-10-02' });
    expect(r.runOutDate).toBeTruthy();
    expect(r.burn.source).toBe('plan');
  });

  it('STILL reports growing when the balance is rising, even though the plan burn is positive', () => {
    // The regression this guards: `growing` used to mean "measured burn ~0". With
    // the plan always supplying a positive burn that could never fire again, and
    // the "Extra loan money, you may be able to return some" tile would have died
    // silently with it.
    const r = computeRunway({ readings: [on('2026-09-01', 6000), on('2026-10-01', 7500)], plannedMonthlyBurn: 2000, upcomingRefunds: [], gradDate, today: '2026-10-02' });
    expect(r.state).toBe('growing');
  });

  it('carries actualPace so the app can say what happens at the real rate', () => {
    const r = computeRunway({ readings: [on('2026-09-01', 6000), on('2026-10-01', 3000)], plannedMonthlyBurn: 1000, upcomingRefunds: [], gradDate, today: '2026-10-02' });
    expect(r.actualPace.perMonth).toBeGreaterThan(1000);      // outspending the plan
    expect(r.actualPace.drift).toBeLessThan(0);
    expect(r.actualPace.runOutDate < r.runOutDate).toBe(true); // reality is sooner than the plan
  });

  it('has no actualPace from a single check-in', () => {
    const r = computeRunway({ readings: [on('2026-10-01', 6000)], plannedMonthlyBurn: 1000, upcomingRefunds: [], gradDate, today: '2026-10-02' });
    expect(r.actualPace).toBe(null);
  });
});
