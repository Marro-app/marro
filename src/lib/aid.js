import { loanCashLanded, estimateRefunds, normalizeReadings, effectiveFeePct } from './loans.js';
import { DAYS_PER_MONTH } from './constants.js';

export { loanCashLanded };

// ── School / summer month math (money-rework Phase 1) ────────────────────────
// A single low-level "how many whole months between two ISO dates" helper,
// day-based (round to nearest month via the shared DAYS_PER_MONTH) rather than
// a naive calendar getMonth() diff. Day-based rounding is what lets a normal
// academic year read as 12 months whether it ends July 31 (contiguous
// generation, post-B2) or Aug 15 (a hand-entered "safe" end): both span ~365
// days ≈ 12 months. Returns null for missing/garbage dates so callers can
// choose their own fallback.
const DAY_MS = 24 * 60 * 60 * 1000;
function parseISO(iso) {
  if (typeof iso !== 'string') return null;
  const d = new Date(iso + 'T12:00:00');
  return Number.isNaN(d.getTime()) ? null : d;
}
function roundedMonthsBetween(a, b) {
  const s = parseISO(a);
  const e = parseISO(b);
  if (!s || !e) return null;
  return Math.round((e - s) / DAY_MS / DAYS_PER_MONTH);
}

/**
 * The number of whole months in a year's SCHOOL period — from `startDate` to
 * the date its aid is meant to last through (`aidThroughDate` when the student
 * has set one, otherwise the year's `endDate`). This is the divisor for the
 * "planned per month" figure.
 *
 * ⚠ Backward compatibility: `aidThroughDate` defaults to null on every year, so
 * this falls through to `endDate` and a normal Aug→(Jul 31 | Aug 15) year lands
 * on exactly 12 — reproducing the old flat `/12` divisor bit-for-bit for all
 * existing/default data. It only diverges once a student deliberately enters an
 * earlier classes-end date (e.g. Cornell's ~May, giving ~9 school months).
 * Falls back to 12 whenever the dates are missing or nonsensical.
 */
export function schoolMonths(year) {
  const y = year || {};
  const through = y.aidThroughDate != null ? y.aidThroughDate : y.endDate;
  const m = roundedMonthsBetween(y.startDate, through);
  return m != null && m > 0 ? m : 12;
}

/**
 * Which academic-month indices (0 = August … 11 = July — the convention App.jsx's
 * month loops use) fall inside a year's aid-coverage window [startDate → the
 * aidThroughDate, or endDate]. The year-end net and running balance iterate these
 * instead of a flat 0–11, so they never credit a full month of income for the
 * UNFUNDED summer months past the coverage window (money-rework §4b: the summer
 * fund owns those, not the school-year plan). Without this, a 10-month-coverage
 * year still gets 12 × the monthly figure, inventing ~2 months of income that
 * never reaches the account.
 *
 * Returns all 12 whenever coverage spans the whole year or the dates are
 * missing/garbage — bit-for-bit the old behaviour for every normal Aug→Jul year.
 */
export function coveredMonthIndices(year, yearStartYear) {
  const all = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  const y = year || {};
  const through = y.aidThroughDate != null ? y.aidThroughDate : y.endDate;
  if (!parseISO(y.startDate) || !parseISO(through) || !Number.isFinite(yearStartYear)) return all;
  const covered = new Set();
  for (let mi = 0; mi < 12; mi++) {
    const calMonth = (mi + 7) % 12;                    // 0 = January … 7 = August
    const calYear = yearStartYear + (mi >= 5 ? 1 : 0);  // Jan (mi 5) onward is the next calendar year
    const mm = String(calMonth + 1).padStart(2, '0');
    const monthStart = `${calYear}-${mm}-01`;
    const monthEnd = `${calYear}-${mm}-31`;             // ISO string upper bound (any real day ≤ '-31')
    // Include the month if it overlaps the coverage window at all.
    if (monthStart <= through && monthEnd >= y.startDate) covered.add(mi);
  }
  return covered.size > 0 ? covered : all;
}

/**
 * The uncovered summer between one year's aid-coverage end and the next year's
 * start — the gap-detection the Plan tab's summer card keys off (money-rework
 * §4b). Returns null (no card) when there is no real gap:
 *   - `aidThroughDate` is null (aid covers the whole year — a 12-month school or
 *     a funded MD-PhD year);
 *   - there is no `nextYear` (the final/graduation year has no trailing summer);
 *   - aid coverage runs right up to or past the next year's start.
 * Otherwise returns { start, end, months } describing the gap.
 */
export function summerWindow(year, nextYear) {
  const through = year && year.aidThroughDate;
  if (!through) return null;
  if (!nextYear || !nextYear.startDate) return null;
  if (through >= nextYear.startDate) return null; // coverage reaches the next year — no gap
  const months = Math.max(1, roundedMonthsBetween(through, nextYear.startDate) || 0);
  return { start: through, end: nextYear.startDate, months };
}

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

  // ── School-months divisor (money-rework §4a) ───────────────────────────────
  // The spendable money is spread over the ACTUAL school months (start →
  // aidThroughDate), not a flat 12. `schoolMonths` is 12 for any year with a
  // null aidThroughDate (the default), so this is a no-op on existing data and
  // `moSpendable` keeps its exact old value; it only tightens once a student
  // says their aid stops earlier (Cornell ~9 months). moSpendable is
  // DELIBERATELY still the per-school-month PLAN figure that feeds the running
  // balance — it is not the balance-anchored "remaining months" figure (that
  // lives on availableMoney.perMonth). Keeping them separate is the
  // double-count guard (see docs/DATA_MODEL.md "The double-count trap").
  const months = schoolMonths(y);
  const moSpendable = (sentToYou + otherIncomeAnnual) / months;

  // Share of the money the student can actually SPEND that came from borrowing.
  // Built from what reaches the account (sentToYou + other income), not from
  // total aid — tuition paid straight to the school was never spendable, so
  // including it would understate how borrowed the spending money really is.
  const spendableTotal = sentToYou + otherIncomeAnnual;
  const borrowedSpendable = Math.max(Math.min(loanCash, sentToYou), 0);
  const loanShare = spendableTotal > 0 ? borrowedSpendable / spendableTotal : 0;

  // No-aid / self-funded degrade (money-rework §4e): a flag the UI can read to
  // switch to the balance-only framing when there is essentially no aid to
  // divide (career-changer on savings, full-ride with no loans). Purely a
  // surfaced boolean — it changes no numbers here. `hasAid` is about the aid
  // SCAFFOLDING (grants + committed loan cash); other income is tracked apart.
  const hasAid = totalAid > 0;

  return {
    grants, loanCash, totalAid, schoolCosts, tuitionFees, healthIns,
    rawGap, sentToYou, otherIncomeAnnual, moSpendable,
    // `schoolMonths` = the divisor used above; `plannedPerMonth` is an explicit
    // alias for moSpendable under the §5 name ("Planned per month").
    schoolMonths: months, plannedPerMonth: moSpendable,
    hasAid, selfFunded: !hasAid,
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
    savings: 0,
    stillToArrive: fullYear,
    available: fullYear,
    monthsLeft: 12,
    perMonth: fullYear / 12,
    untilNextMoney: null,
    basis: 'projection',
    // No-aid degrade flags (money-rework §4e), surfaced alongside `basis` so the
    // UI can lean on the check-in when the aid-projection scaffolding is empty.
    hasAid: breakdown.hasAid,
    selfFunded: breakdown.selfFunded,
    asOf: null,
    breakdown,
  };

  const isCurrentYear = !!(y.startDate && y.endDate && today >= y.startDate && today <= y.endDate);
  if (!isCurrentYear || !today) return projection;

  const sorted = normalizeReadings(readings, today);
  const latest = sorted[sorted.length - 1] || null;
  // A reading from before this year began describes a PRIOR year's money.
  if (!latest || latest.date < y.startDate) return projection;

  // "Safe to spend" is CHECKING money only — the cash you actually spend from.
  // Savings is deliberately NOT counted (founder call): the check-in calls it
  // "set aside", and counting it would tell a student it's safe to spend money
  // they've reserved. It's surfaced separately as `savings` so the UI can show it
  // as a cushion "on top" (matching the runway tile, which already excludes it).
  const onHand = Number(latest.spendable) || 0;
  const savings = Number(latest.savings) || 0;

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
    savings,
    stillToArrive: stillToArrive + otherIncomeAhead,
    available,
    monthsLeft,
    perMonth: available / monthsLeft,
    untilNextMoney,
    basis: 'balance',
    hasAid: breakdown.hasAid,
    selfFunded: breakdown.selfFunded,
    asOf: latest.date,
    breakdown,
  };
}

// ── Summer fund (money-rework §4b/§4c) ───────────────────────────────────────
// All of these are PURE calcs: they take the summer inputs as arguments and
// never read any persisted summer state — that data shape is designed later
// with the UI. Kept small and composable so each is independently testable.

/**
 * What the summer costs per month and in total, derived from the student's own
 * school-year monthly plan adjusted for a summer rent that usually differs
 * (go home → $0; away rotation → higher). The non-rent part of the plan carries
 * over; only the housing line swaps out.
 *
 * @param {object} p
 * @param {number} p.monthlyPlan  the school-year "Monthly plan" total (incl. school rent).
 * @param {number} p.schoolRent   the rent baked into that plan (the housing line).
 * @param {number|null} p.summerRent  the summer rent override; null = "same as school" (no change).
 * @param {object|null} p.window   a summerWindow() result; null → no summer, returns null.
 * @returns {{monthly:number, months:number, total:number}|null}
 */
export function summerFundNeed({ monthlyPlan, schoolRent = 0, summerRent = null, window }) {
  if (!window) return null;
  const plan = Number(monthlyPlan) || 0;
  const baseRent = Number(schoolRent) || 0;
  const rent = summerRent == null ? baseRent : Number(summerRent) || 0;
  const monthly = Math.max(0, plan - baseRent + rent); // swap the rent line, keep the rest
  const months = window.months;
  return { monthly, months, total: monthly * months };
}

/**
 * Money available to cover the summer, from either (or both) income shapes in
 * the design: dated lumps (a stipend landing on specific date(s), reusing the
 * loan-disbursement timing idea) and a steady monthly wage smoothed over the
 * window. Only lumps dated INSIDE the summer window count toward summer
 * resources — a July-1 stipend can't fund a June that already passed.
 *
 * @param {object} p
 * @param {object|null} p.window   a summerWindow() result; null → totals are 0.
 * @param {Array} p.lumps          [{amount, date}] dated one-off summer income.
 * @param {number} p.monthlyWage   steady take-home per month over the window.
 * @returns {{lumpTotal:number, wageTotal:number, total:number}}
 */
export function summerResources({ window, lumps = [], monthlyWage = 0 }) {
  if (!window) return { lumpTotal: 0, wageTotal: 0, total: 0 };
  const lumpTotal = (lumps || [])
    .filter((l) => l && l.date && l.date >= window.start && l.date <= window.end)
    .reduce((a, l) => a + (Number(l.amount) || 0), 0);
  const wageTotal = (Number(monthlyWage) || 0) * window.months;
  return { lumpTotal, wageTotal, total: lumpTotal + wageTotal };
}

/**
 * Need vs. resources for the summer: the shortfall (what's still uncovered) or
 * the surplus. Composed from summerFundNeed() + summerResources() outputs so
 * each piece stays independently testable.
 */
export function summerShortfall({ need, resources }) {
  const needTotal = need ? Number(need.total) || 0 : 0;
  const resTotal = resources ? Number(resources.total) || 0 : 0;
  return {
    need: needTotal,
    resources: resTotal,
    shortfall: Math.max(0, needTotal - resTotal),
    surplus: Math.max(0, resTotal - needTotal),
  };
}

/**
 * Date-based routing (money-rework §4c): split committed loan cash (net of fee)
 * into what lands in the SCHOOL window vs the SUMMER window, purely by each
 * disbursement's date. A disbursement dated inside the summer window feeds the
 * summer fund; everything else feeds the school-year fund. With a null window
 * (no summer), all cash routes to school. This is how "borrowed extra for
 * summer research" — a loan with a summer-dated disbursement — routes to summer
 * automatically with no new data field.
 *
 * Mirrors loanCashForYear's gates (accepted/disbursed only; current-balance
 * loans excluded — that money landed in a past year), so school+summer always
 * sums to exactly the year's landed loan cash.
 */
export function routeLoanCashBySummer(loans, window) {
  let school = 0;
  let summer = 0;
  for (const l of loans || []) {
    if (!l) continue;
    if (l.status !== 'accepted' && l.status !== 'disbursed') continue;
    if (l.asOfDate != null && l.asOfBalance != null) continue;
    const feeMult = 1 - effectiveFeePct(l);
    for (const d of l.disbursements || []) {
      const cash = (Number(d.amount) || 0) * feeMult;
      if (cash <= 0) continue;
      const inSummer = window && d.date && d.date >= window.start && d.date < window.end;
      if (inSummer) summer += cash;
      else school += cash;
    }
  }
  return { school, summer };
}
