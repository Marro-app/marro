import { loanCashLanded, estimateRefunds, normalizeReadings, readingTotal } from './loans.js';

export { loanCashLanded };

// ── Aid + loans → spending money ────────────────────────────────────────────
//
// The single home for "how much does this student actually have to live on
// this year." Before this module existed the formula
//
//     Math.max(grant - tuitionFees - healthIns, 0) + otherIncome*12
//
// was copy-pasted in six places (App.jsx ×4, AidTab.jsx ×2) with no test
// coverage, so any change to it silently desynced the Aid tab, the Budget
// tab, the Charts bars and the header tiles from each other. Everything now
// routes through `yearAidBreakdown`.
//
// The substantive change this module introduced (2026-07-23): LOAN money
// counts toward spending money. It always did in reality — students were told
// to type loans into the "Total aid" box by hand (see the old field note "may
// include loans you'll repay") — but the Loans tab itself fed only the
// debt-at-graduation projection. That meant a student could enter $49,500 of
// loans and still be told they were "$2,788/mo short." Loans are now entered
// ONCE, on the Loans tab, and flow from there; `grant` means grants and
// scholarships only.

/**
 * Which academic year a year record belongs to, as the calendar year it
 * STARTS in — the same derivation `App.jsx` uses for `yrStartYear`, and the
 * only thing a loan's `academicYear` can be matched against. Returns null for
 * a missing/garbage start date so callers can treat the year as unmatchable
 * rather than silently bucketing loans into it.
 */
export function yearStartYearOf(year) {
  if (!year || !year.startDate) return null;
  const y = new Date(year.startDate + 'T12:00:00').getFullYear();
  return Number.isFinite(y) ? y : null;
}

/**
 * True when this loan's money should count toward a year's SPENDING money.
 * Three independent gates, each for a different reason:
 *
 *  - status: only `accepted`/`disbursed`. An `offered` loan is money the
 *    student hasn't committed to yet — the same rule the debt tile uses
 *    (DATA_MODEL.md "Only accepted or disbursed loans count").
 *  - current-balance mode (`asOfBalance`/`asOfDate`): that's a balance the
 *    student read off their servicer today, i.e. money that landed in some
 *    PAST year and has already been spent or absorbed. It is not incoming
 *    cash for the year being budgeted, so counting it would invent money.
 *  - academic year: the loan has to be for THIS year.
 *
 * `academicYear` is a calendar start year (2025 = the 2025–2026 year), never
 * an index or id into `data.years` — there is no stored linkage between the
 * two, so this comparison IS the join.
 */
export function loanCountsForYear(loan, yearStartYear) {
  if (!loan || yearStartYear == null) return false;
  if (loan.status !== 'accepted' && loan.status !== 'disbursed') return false;
  if (loan.asOfDate != null && loan.asOfBalance != null) return false;
  return Number(loan.academicYear) === Number(yearStartYear);
}

/**
 * Total loan cash landing in one academic year, net of fees.
 */
export function loanCashForYear(loans, yearStartYear) {
  return (loans || [])
    .filter((l) => loanCountsForYear(l, yearStartYear))
    .reduce((a, l) => a + loanCashLanded(l), 0);
}

/**
 * Loans that count as real, committed borrowing but match NO year record —
 * usually a typo'd academic year, or a loan entered before its year was added.
 * Their money would otherwise vanish from spending money with no trace, so the
 * Aid tab surfaces them rather than dropping them silently.
 *
 * Deliberately ignores current-balance-mode loans: those are correctly absent
 * from every year's incoming cash, so they are not "unmatched," just historical.
 */
export function unmatchedLoans(loans, years) {
  const known = new Set((years || []).map(yearStartYearOf).filter((y) => y != null));
  return (loans || []).filter((l) => {
    if (l.status !== 'accepted' && l.status !== 'disbursed') return false;
    if (l.asOfDate != null && l.asOfBalance != null) return false;
    if (loanCashLanded(l) <= 0) return false;
    return !known.has(Number(l.academicYear));
  });
}

/**
 * Everything the app needs to know about one year's money, in one place.
 *
 * Units, which differ by field and have bitten this code before:
 *   grant / tuitionFees / healthIns  → ANNUAL dollars
 *   otherIncome                      → MONTHLY dollars (hence ×12)
 *
 * `sentToYou` floors at zero: when school costs exceed aid, the student
 * receives nothing — they don't receive negative money. The UNFLOORED gap is
 * returned separately as `rawGap`, because the Aid tab needs it to say "your
 * costs exceed your aid by $X" (a real, distinct message that the floored
 * number can't express).
 *
 * `isLoanFunded` drives the "never green" rule: a surplus built mostly out of
 * borrowed money is not wealth — it's cash sitting at ~8% interest that could
 * often be returned within 120 days with the interest cancelled. Founder
 * decision, already enforced in `classifyCushionSource` for the Runway tile;
 * this flag extends it to the budget surfaces.
 */
export function yearAidBreakdown(year, loans, yearStartYear) {
  const y = year || {};
  const startYear = yearStartYear !== undefined ? yearStartYear : yearStartYearOf(y);
  const grants = Number(y.grant) || 0;
  const tuitionFees = Number(y.tuitionFees) || 0;
  const healthIns = Number(y.healthIns) || 0;
  const loanCash = loanCashForYear(loans, startYear);

  const totalAid = grants + loanCash;
  const schoolCosts = tuitionFees + healthIns;
  const rawGap = totalAid - schoolCosts;
  const sentToYou = Math.max(rawGap, 0);
  const otherIncomeAnnual = (Number(y.otherIncome) || 0) * 12;
  const moSpendable = (sentToYou + otherIncomeAnnual) / 12;

  // Share of the money the student can actually SPEND that came from borrowing.
  // Built from what reaches the account (sentToYou + other income), not from
  // total aid — tuition paid straight to the school was never spendable, so
  // including it would understate how borrowed the spending money really is.
  const spendableTotal = sentToYou + otherIncomeAnnual;
  const borrowedSpendable = Math.max(Math.min(loanCash, sentToYou), 0);
  const loanShare = spendableTotal > 0 ? borrowedSpendable / spendableTotal : 0;

  return {
    grants, loanCash, totalAid, schoolCosts, tuitionFees, healthIns,
    rawGap, sentToYou, otherIncomeAnnual, moSpendable,
    loanShare, isLoanFunded: loanShare > 0.5,
  };
}

// ── The one "how much can I spend" formula ──────────────────────────────────
//
// Marro used to answer this question with TWO numbers computed from different
// bases, which could tell contradictory stories on the same screen:
//
//   "Monthly spending money" = year's aid ÷ 12   — pure projection. Never looked
//        at the bank balance, so it stayed frozen all year even after half the
//        money was spent.
//   The runway tile               — anchored on the latest balance check-in.
//
// On Dec 1 a student could be told "$1,400/mo to spend" (as if a full year of
// money were still ahead) while the runway said her cash ran out in February.
//
// `availableMoney` is the single definition both now derive from:
//
//     Available = money on hand + money still to arrive before year end
//     PerMonth  = Available ÷ months remaining
//
// The old projection is this same formula's DEGENERATE CASE, which is why this
// unifies rather than adding a rival number: for a future year (or a user who
// hasn't entered a balance yet) there is nothing "on hand", everything is
// "still to arrive", and 12 months remain — giving back exactly `aid ÷ 12`.
//
// Crucially, past spending never has to be reconstructed: whatever was spent is
// simply no longer in the balance. That is what makes a mid-year signup — and
// months the student never tracked — work correctly for free.

/** Whole months from `today` to the year's end, floored at 1 (a 0 would divide by zero in the final month). */
function monthsRemaining(today, endDate) {
  const t = new Date(today + 'T12:00:00');
  const e = new Date(endDate + 'T12:00:00');
  const months = (e.getFullYear() - t.getFullYear()) * 12 + (e.getMonth() - t.getMonth());
  return Math.max(1, Math.min(12, months));
}

/**
 * How much this student actually has to live on, and what that works out to per
 * month. See the block comment above for why this replaced two rival numbers.
 *
 * `basis` tells the UI which story to tell, and must never be guessed at:
 *   - 'balance'    — anchored on a real check-in. `onHand` is money in the
 *                    account right now; `stillToArrive` is only what hasn't
 *                    landed yet, so nothing is double-counted.
 *   - 'projection' — no usable check-in for THIS year (a brand-new user, or a
 *                    future year being planned). Falls back to the full-year
 *                    figure, i.e. the app's original behaviour, unchanged.
 *
 * Anchoring is deliberately limited to the year containing `today`: a future
 * year has no "current balance", and a reading from BEFORE this year started is
 * stale (it describes a prior year's money) — either would invent money that
 * isn't there.
 */
export function availableMoney({ year, loans, readings, today }) {
  const y = year || {};
  const breakdown = yearAidBreakdown(y, loans);
  const fullYear = breakdown.sentToYou + breakdown.otherIncomeAnnual;

  // The projection fallback — also the answer for every year that isn't the
  // current one. Identical to the pre-2026-07-26 behaviour by construction.
  const projection = {
    onHand: 0,
    stillToArrive: fullYear,
    available: fullYear,
    monthsLeft: 12,
    perMonth: fullYear / 12,
    untilNextMoney: null,
    basis: 'projection',
    asOf: null,
    breakdown,
  };

  const isCurrentYear = !!(y.startDate && y.endDate && today >= y.startDate && today <= y.endDate);
  if (!isCurrentYear || !today) return projection;

  const sorted = normalizeReadings(readings, today);
  const latest = sorted[sorted.length - 1] || null;
  // A reading from before this year began describes a PRIOR year's money.
  if (!latest || latest.date < y.startDate) return projection;

  const onHand = readingTotal(latest);

  // Money that genuinely hasn't landed yet. estimateRefunds already models the
  // real dated inflows — grant halves at term start plus each loan disbursement
  // on the date the student entered — and scales them so a year's inflows sum
  // to exactly what reaches the account. Counting only those dated AFTER the
  // check-in is what keeps already-landed money from being counted twice (it's
  // already inside `onHand`).
  const stillToArrive = estimateRefunds([y], loans || [])
    .filter((r) => r.date && r.date > latest.date && r.date <= y.endDate)
    .reduce((a, r) => a + r.amount, 0);

  // Other income is earned month by month rather than landing in lumps, so only
  // the months still ahead can be counted.
  const monthsLeft = monthsRemaining(today, y.endDate);
  const otherIncomeAhead = (Number(y.otherIncome) || 0) * monthsLeft;

  const available = Math.max(0, onHand + stillToArrive + otherIncomeAhead);

  // ── What the money on hand supports until the NEXT lump arrives ────────────
  // `perMonth` averages across the whole year, which is exactly what produces a
  // dry spell: aid lands in lumps, so spending the annual average can leave a
  // student at $0 in November waiting on January. This second figure is the one
  // that PREVENTS that — what the cash actually in the account supports between
  // now and the next payment. Same shape as the Refund Playbook's `semesterNeed`
  // (LoansTab), so the two surfaces can never disagree.
  const nextInflow = estimateRefunds([y], loans || [])
    .filter((r) => r.date && r.date > latest.date && r.date <= y.endDate)
    .sort((a, b) => (a.date < b.date ? -1 : 1))[0] || null;
  let untilNextMoney = null;
  if (nextInflow) {
    const monthsToNext = Math.max(1, monthsRemaining(today, nextInflow.date));
    untilNextMoney = {
      perMonth: (onHand + (Number(y.otherIncome) || 0) * monthsToNext) / monthsToNext,
      date: nextInflow.date,
      monthsToNext,
      isEstimate: !!nextInflow.isEstimate,
    };
  }

  return {
    onHand,
    stillToArrive: stillToArrive + otherIncomeAhead,
    available,
    monthsLeft,
    perMonth: available / monthsLeft,
    untilNextMoney,
    basis: 'balance',
    asOf: latest.date,
    breakdown,
  };
}
