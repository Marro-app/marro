// Loans, interest, and runway math — Phase 2 ("Loans, Debt & Runway").
//
// Everything in this file is a PURE function: no React, no App state, no
// imports from anywhere else in the app. That's deliberate — these are the
// numbers a med student's Debt and Runway tiles are built on, so they need
// to be hand-checkable and unit-testable in total isolation. See
// docs/PRODUCT_DECISIONS.md "Phase 2 commit 3" for the worked example this
// was verified against.
//
// Plain-language summary of the model (see the plan's walkthrough for the
// full student-facing story):
//   - A loan is money borrowed for one school year. It arrives in 2+ chunks
//     ("disbursements" internally — never shown to the student, see the
//     jargon table in the plan). Each chunk starts accruing interest the day
//     it lands, every single day, at a simple (not compound) rate — that's
//     how federal loan servicers actually calculate it while a student is in
//     school.
//   - "Debt at graduation" = every dollar borrowed, plus the ~1% fee the
//     government takes off the top, plus all the interest that will have
//     quietly built up by the time she walks the stage.
//   - "Runway" = how long her actual bank balance will last at her current
//     spending pace, compared against her spending plan and her expected
//     financial-aid refund dates.

// ── Federal rate table ───────────────────────────────────────────────────────
// Direct Unsubsidized (grad/professional) rates, set every July 1 for loans
// first disbursed in that academic year. Keyed by the CALENDAR YEAR the
// academic year *starts* in (e.g. 2025 → the 2025-26 rate). Source:
// studentaid.gov "Interest Rates and Fees" (historical rate table).
//
// ⚠ MAINTENANCE: add the new year's rate here every July when the Dept. of
// Education publishes it, and log the update in docs/PRODUCT_DECISIONS.md
// (process note — see the Phase 2 commit 3 entry for the template). A loan
// whose academicYear isn't in this table falls back to the nearest known
// year and is flagged as an estimate (see `isRateEstimated`).
export const FEDERAL_GRAD_UNSUB_RATES = {
  2022: 0.0654, // 2022-23
  2023: 0.0705, // 2023-24
  2024: 0.0653, // 2024-25
  2025: 0.0794, // 2025-26
  2026: 0.0807, // 2026-27
};

// The government's origination fee on Direct Unsubsidized loans, deducted
// from the disbursement but still owed in full — i.e. it INFLATES what the
// student owes rather than reducing it. Source: studentaid.gov fee schedule.
export const FEDERAL_ORIGINATION_FEE = 0.01057;

const DAY_MS = 24 * 60 * 60 * 1000;
const DAYS_PER_MONTH = 30.44; // average month length, used to normalize any measurement window into a monthly rate
const GROWING_EPSILON = 1; // $/month burn at or below this reads as "not really spending down" rather than a near-infinite countdown

// ── Small date helpers (ISO "YYYY-MM-DD" strings throughout this file) ──────
// Anchored at noon to dodge DST-related off-by-one-day bugs, same pattern as
// `fmtDay` in src/lib/format.js.
const toDate = (iso) => new Date(iso + 'T12:00:00');
function daysBetween(fromIso, toIso) {
  return Math.round((toDate(toIso) - toDate(fromIso)) / DAY_MS);
}
function addDays(iso, n) {
  const d = toDate(iso);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
function addMonths(iso, n) {
  const d = toDate(iso);
  d.setMonth(d.getMonth() + n);
  return d.toISOString().slice(0, 10);
}
/** Guards against garbage/typo'd dates (e.g. a stray "1926-08-01") ever reaching the math. */
function isPlausibleDate(iso) {
  if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const year = Number(iso.slice(0, 4));
  if (year < 2015 || year > 2045) return false;
  return !Number.isNaN(toDate(iso).getTime());
}

// ── Loan rate & fee ───────────────────────────────────────────────────────────

/**
 * The interest rate this loan actually accrues at, as a decimal (0.0807, not
 * 8.07). A student-entered rate always wins. Otherwise: federal loans look up
 * their academic year in the government's published table, clamping to the
 * nearest known year if the loan predates or postdates the table. Private
 * loans have no government table, so an unset rate reads as 0% (callers
 * should treat a missing private rate as needing the student's input — see
 * `isRateEstimated`, which is what actually flags this case as unreliable).
 */
export function effectiveRate(loan) {
  if (loan.rate != null) return loan.rate;
  if (loan.type === 'private') return 0;
  const years = Object.keys(FEDERAL_GRAD_UNSUB_RATES).map(Number);
  const minYear = Math.min(...years);
  const maxYear = Math.max(...years);
  const y = Math.max(minYear, Math.min(maxYear, loan.academicYear));
  return FEDERAL_GRAD_UNSUB_RATES[y];
}

/**
 * True when the rate `effectiveRate` returned isn't a real, confirmed number
 * — either a private loan with no rate typed in yet, or a federal loan whose
 * academic year fell outside the published table (rare, but a pre-2022 loan
 * or a future year not yet published both land here). Drives the "estimate"
 * badge, never the math itself.
 */
export function isRateEstimated(loan) {
  if (loan.rate != null) return false;
  if (loan.type === 'private') return true;
  return !(loan.academicYear in FEDERAL_GRAD_UNSUB_RATES);
}

/** The origination fee this loan is charged, as a decimal. Explicit `feePct` always wins; otherwise federal loans default to the government's published fee and private loans default to 0 (most private lenders don't charge one; the student can enter one via `feePct` if theirs does). */
export function effectiveFeePct(loan) {
  if (loan.feePct != null) return loan.feePct;
  return loan.type === 'federal' ? FEDERAL_ORIGINATION_FEE : 0;
}

// ── Principal & accrued interest ─────────────────────────────────────────────

/**
 * How much of this loan is actually owed as principal (before any interest),
 * fee included — the fee is deducted from what the student receives but NOT
 * from what they owe, so it inflates this number rather than shrinking it.
 *
 * Two entry modes (see the plan's walkthrough §2 for why both exist):
 *   - "original amount" (default): sums the disbursement rows the student
 *     entered, each grossed up by the fee.
 *   - "balance as of [date]" (`asOfBalance`/`asOfDate` set): the student typed
 *     in a real balance from their servicer, which already has any fee baked
 *     in — so it's used as-is, with no fee re-applied on top of itself.
 */
export function loanPrincipal(loan) {
  if (loan.asOfDate != null && loan.asOfBalance != null) return Number(loan.asOfBalance) || 0;
  const fee = effectiveFeePct(loan);
  const gross = (loan.disbursements || []).reduce((a, d) => a + (Number(d.amount) || 0), 0);
  return gross * (1 + fee);
}

/**
 * Interest that has built up so far, as of `asOf` (an ISO date) — SIMPLE
 * daily interest (`principal × rate/365 × days`) per disbursement, summed.
 *
 * Deliberately NOT compound interest: federal Direct Loans accrue simple
 * daily interest while a student is enrolled and only capitalize (interest
 * gets folded into principal, so future interest computes on a bigger base)
 * at discrete events like the end of the grace period — not continuously.
 * Naively compounding daily/monthly would overstate a $20,000 loan at 8.07%
 * by roughly $963 over 4 years — a real, checkable error this function is
 * built specifically to avoid. Source: studentaid.gov / Nelnet & MOHELA
 * servicer interest formulas.
 *
 * A loan still in "offered" status hasn't actually disbursed money yet, so
 * it accrues nothing. A negative day count (interest asked for before the
 * money arrived) floors to 0 rather than going negative.
 */
export function accruedInterest(loan, asOf) {
  if (loan.status === 'offered') return 0;
  const rate = effectiveRate(loan);

  if (loan.asOfDate != null && loan.asOfBalance != null) {
    const days = Math.max(0, daysBetween(loan.asOfDate, asOf));
    return (Number(loan.asOfBalance) || 0) * (rate / 365) * days;
  }

  const fee = effectiveFeePct(loan);
  return (loan.disbursements || []).reduce((sum, d) => {
    if (!d.date) return sum; // undated rows are handled upstream (see fillMissingDisbursementDates) — never silently skip in the caller that matters
    const days = Math.max(0, daysBetween(d.date, asOf));
    const principal = (Number(d.amount) || 0) * (1 + fee);
    return sum + principal * (rate / 365) * days;
  }, 0);
}

// Undated disbursement rows can't accrue interest (no start date to count
// from), so before pricing a loan we fill in a reasonable default: the
// school-year's typical fall/spring disbursement dates, alternating per row.
// Anything filled this way flags the loan's total as an estimate — it's a
// safety net for incomplete data, not a substitute for the real dates.
function fillMissingDisbursementDates(loan) {
  if (loan.asOfDate != null) return { loan, usedFallback: false };
  const disb = loan.disbursements || [];
  if (disb.length === 0) return { loan, usedFallback: true }; // nothing to price — treated as $0, flagged as an estimate rather than silently omitted
  let usedFallback = false;
  const fallDate = `${loan.academicYear}-08-15`;
  const springDate = `${loan.academicYear + 1}-01-15`;
  const filled = disb.map((d, i) => {
    if (d.date) return d;
    usedFallback = true;
    return { ...d, date: i % 2 === 0 ? fallDate : springDate };
  });
  return { loan: { ...loan, disbursements: filled }, usedFallback };
}

/**
 * What the student will owe on graduation day, across every loan that's
 * actually real money (i.e. not merely "offered" — offered loans are excluded
 * entirely, since she may never accept them). Returns:
 *   - `total`: the number for the Debt tile.
 *   - `byLoan`: one row per counted loan, so the UI can show a breakdown.
 *   - `isEstimate`: true if ANY of the following holds, so the tile can show
 *     the calm "estimate" note instead of implying false precision: nothing
 *     counted yet, any counted loan is private (no government-verified
 *     formula for those), a loan's rate had to be inferred rather than
 *     confirmed, or a loan's disbursement dates had to be guessed.
 */
export function projectDebtAtGraduation(loans, gradDate) {
  const counted = (loans || []).filter((l) => l.status === 'accepted' || l.status === 'disbursed');
  let isEstimate = counted.length === 0;

  const byLoan = counted.map((loan) => {
    const { loan: filled, usedFallback } = fillMissingDisbursementDates(loan);
    const loanIsEstimate = filled.type === 'private' || usedFallback || isRateEstimated(filled);
    if (loanIsEstimate) isEstimate = true;
    const principal = loanPrincipal(filled);
    const interest = accruedInterest(filled, gradDate);
    return { loanId: loan.id, principal, interest, total: principal + interest, isEstimate: loanIsEstimate };
  });

  const total = byLoan.reduce((a, l) => a + l.total, 0);
  return { total, byLoan, isEstimate };
}

// ── Runway ────────────────────────────────────────────────────────────────────

// Drops readings from the future (shouldn't exist, but a clock-skew device or
// a fat-fingered date shouldn't be allowed to break the countdown) and
// collapses same-date duplicates (two devices checking in the same day) down
// to whichever one comes LAST in the input array — the freshest write wins,
// mirroring how the sync engine's own last-write-wins scalar fields behave.
function normalizeReadings(readings, today) {
  const kept = (readings || []).filter((r) => r && r.date && r.date <= today);
  const byDate = new Map();
  for (const r of kept) byDate.set(r.date, r); // later array entries overwrite earlier ones sharing a date
  return Array.from(byDate.values()).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

const readingTotal = (r) => (Number(r.spendable) || 0) + (Number(r.savings) || 0);

/**
 * "How long will my money last?" — the Runway tile's engine.
 *
 * @param {object} p
 * @param {Array}  p.readings - balance check-ins, `{date, spendable, savings|null}`, any order.
 * @param {number} p.plannedMonthlyBurn - the student's budgeted monthly spend, used until real balance history exists.
 * @param {Array}  p.upcomingRefunds - expected aid refunds ahead, `{date, amount, term}`, chronological. Only the first is used for v1's gap-vs-refund math (seeing further ahead is future work — see the hardening note below).
 * @param {string} p.gradDate - ISO date; runway is meaningless (and suppressed) after this.
 * @param {string} p.today - ISO date, injected so tests are deterministic.
 * @returns {{state:string, [key:string]:*}} one of 5 states — see inline comments below for what each means and carries.
 *
 * Hardening rules baked in here (adversarial review, 2026-07-12 — every one
 * of these is a specific way an earlier draft could have shown a student a
 * confidently wrong number):
 *  - readings are always sorted by date, never trusted in insertion order;
 *  - future-dated readings are rejected before anything else runs;
 *  - two readings sharing a date collapse to the later array entry;
 *  - a measured burn rate is only trusted once the two readings it's built
 *    from are ≥14 days apart — under that, a single bad day would swing the
 *    monthly-normalized number wildly, so the budgeted plan fills in instead
 *    (and the result says so via `burn.source`);
 *  - a burn at or below $1/mo reads as "growing", never a technically-correct
 *    but absurd "runs out in 500 years";
 *  - a refund that lands between two readings is subtracted back out of the
 *    delta before computing burn — otherwise a refund would look like the
 *    student suddenly spent negative money that month (the "straddle case");
 *  - a graduation date at or before today suppresses the whole tile rather
 *    than showing a countdown for money that no longer needs to last;
 *  - a spendable balance at or below $0 gets its own `overdrawn` state
 *    instead of a countdown running backwards;
 *  - a gap of under 7 days between "runs out" and "next refund" is floored to
 *    "basically on track" rather than alarming the student over pocket change.
 */
export function computeRunway({ readings, plannedMonthlyBurn, upcomingRefunds, gradDate, today }) {
  if (gradDate && gradDate <= today) return { state: 'graduated' };

  const sorted = normalizeReadings(readings, today);
  if (sorted.length === 0) return { state: 'unanchored', plannedMonthlyBurn: plannedMonthlyBurn ?? null };

  const latest = sorted[sorted.length - 1];
  const spendable = Number(latest.spendable) || 0;
  const savings = latest.savings != null ? Number(latest.savings) : 0;
  const total = spendable + savings;

  if (spendable <= 0) {
    return { state: 'overdrawn', spendable, savings, coveredBySavings: savings > 0, asOf: latest.date };
  }

  // ── Burn rate: measured from real balance history when we can trust it, the student's plan otherwise ──
  let burn;
  if (sorted.length >= 2) {
    const prev = sorted[sorted.length - 2];
    const windowDays = daysBetween(prev.date, latest.date);
    if (windowDays >= 14) {
      const refunds = upcomingRefunds || [];
      // Straddle case: only refunds that landed strictly between the two
      // readings count as "known inflow" to net back out — one dated before
      // `prev` was already reflected in `prev`'s balance, and one dated after
      // `latest` hasn't happened yet from this window's point of view.
      const knownInflowsBetween = refunds
        .filter((r) => r.date > prev.date && r.date <= latest.date)
        .reduce((a, r) => a + (Number(r.amount) || 0), 0);
      const delta = readingTotal(prev) - readingTotal(latest) + knownInflowsBetween;
      burn = { amount: (delta / windowDays) * DAYS_PER_MONTH, source: 'measured', windowDays };
    } else {
      burn = { amount: plannedMonthlyBurn ?? 0, source: 'plan', windowDays };
    }
  } else {
    burn = { amount: plannedMonthlyBurn ?? 0, source: 'plan', windowDays: null };
  }

  if (burn.amount <= GROWING_EPSILON) {
    return { state: 'growing', spendable, savings, total, burn, asOf: latest.date };
  }

  const dailyBurn = burn.amount / DAYS_PER_MONTH;
  const runOutDate = addDays(latest.date, Math.floor(spendable / dailyBurn));
  const cushionExtensionDate = addDays(latest.date, Math.floor(total / dailyBurn));

  if (!gradDate || cushionExtensionDate >= gradDate) {
    return { state: 'through_graduation', spendable, savings, total, burn, runOutDate, cushionExtensionDate, asOf: latest.date };
  }

  const nextRefund = (upcomingRefunds || []).find((r) => r.date > latest.date);
  if (nextRefund && runOutDate < nextRefund.date) {
    const gapDays = daysBetween(runOutDate, nextRefund.date);
    if (gapDays < 7) {
      return { state: 'counting_down', spendable, savings, total, burn, runOutDate, cushionExtensionDate, basicallyOnTrack: true, asOf: latest.date };
    }
    // Trim needed so `spendable` stretches exactly to the refund date instead
    // of running dry `gapDays` early: recompute the daily rate that would
    // make it last exactly that long, and the monthly difference from today's pace.
    const daysUntilRefund = daysBetween(latest.date, nextRefund.date);
    const neededMonthlyBurn = (spendable / daysUntilRefund) * DAYS_PER_MONTH;
    const trimPerMonthToClose = Math.max(0, burn.amount - neededMonthlyBurn);
    return { state: 'gap', spendable, savings, total, burn, runOutDate, cushionExtensionDate, gapDays, trimPerMonthToClose, nextRefund, asOf: latest.date };
  }

  return { state: 'counting_down', spendable, savings, total, burn, runOutDate, cushionExtensionDate, asOf: latest.date };
}

// ── Refund estimates ──────────────────────────────────────────────────────────

/**
 * Roughly when — and how much — each year's financial-aid refund (the money
 * left over after tuition/fees/insurance come out) is likely to land, split
 * into the usual fall/spring halves. Aid posts at the start of each term and
 * any leftover gets refunded to the student ~7-14 days later, so each date is
 * returned as a ±7-day WINDOW rather than a single point — direct deposit vs.
 * paper checks vs. verification holds genuinely vary that much in practice.
 *
 * A year with nothing left over after costs (aid ≤ costs) contributes no
 * refund at all — there's nothing to refund. A year with a missing or
 * garbage start date contributes a refund with a null date (`isEstimate:
 * true`) rather than a confidently wrong one.
 */
export function estimateRefunds(years) {
  const refunds = [];
  for (const y of years || []) {
    const net = Math.max((Number(y.grant) || 0) - (Number(y.tuitionFees) || 0) - (Number(y.healthIns) || 0), 0);
    if (net <= 0) continue;
    const half = net / 2;
    const term = y.label || `${y.startDate ? y.startDate.slice(0, 4) : 'unknown'}`;
    if (!isPlausibleDate(y.startDate)) {
      refunds.push({ term: `${term}-fall`, amount: half, date: null, windowStart: null, windowEnd: null, isEstimate: true });
      refunds.push({ term: `${term}-spring`, amount: half, date: null, windowStart: null, windowEnd: null, isEstimate: true });
      continue;
    }
    const fallDate = addDays(y.startDate, 10);
    const springDate = addMonths(y.startDate, 5);
    refunds.push({ term: `${term}-fall`, amount: half, date: fallDate, windowStart: addDays(fallDate, -7), windowEnd: addDays(fallDate, 7), isEstimate: false });
    refunds.push({ term: `${term}-spring`, amount: half, date: springDate, windowStart: addDays(springDate, -7), windowEnd: addDays(springDate, 7), isEstimate: false });
  }
  return refunds.sort((a, b) => (a.date || '9999') < (b.date || '9999') ? -1 : 1);
}

// ── 120-day return windows ──────────────────────────────────────────────────

/**
 * For each disbursement, the deadline to return unused federal loan money
 * for a clean cancellation of its interest and fee (studentaid.gov Direct
 * Loan Borrowers' Rights — 120 days from disbursement). Only OPEN windows are
 * returned (deadline still ahead of `today`) — this is recomputed from live
 * `loans` on every render rather than cached by loan id, so an edited
 * disbursement date is never stale.
 *
 * `dateConfirmed` mirrors the disbursement row: only a date the student
 * actually entered/confirmed should ever be shown as a hard "N days left" —
 * an inferred/fallback date should read as "roughly N days, confirm with
 * your aid office" instead. This function doesn't pick the copy (that's the
 * UI's job) but it does pass the flag through so the UI can.
 */
export function loanReturnWindows(loans, today) {
  const out = [];
  for (const loan of loans || []) {
    for (const d of loan.disbursements || []) {
      if (!d.date) continue;
      const deadline = addDays(d.date, 120);
      const daysLeft = daysBetween(today, deadline);
      if (daysLeft > 0) out.push({ loanId: loan.id, disbursementId: d.id, deadline, daysLeft, dateConfirmed: !!d.dateConfirmed });
    }
  }
  return out;
}

// ── Refund Playbook trigger ──────────────────────────────────────────────────

/**
 * Should the one-time "your refund landed" educational card show right now?
 * Fires on real evidence, never a guess: either the student herself confirmed
 * "yes, my refund landed" (the `confirmed` nudge-reply path), OR all of —
 * the expected refund date has passed, the latest balance reading is dated
 * after it, and the balance actually jumped by at least half the expected
 * refund amount (a parent's gift or an unrelated deposit shouldn't be
 * mistaken for a $14,000 aid refund). Never shows twice for the same term.
 */
export function refundPlaybookTrigger({ readings, nextRefund, refundPlaybookSeen, today, confirmed = false }) {
  if (!nextRefund || !nextRefund.date) return false;
  if (refundPlaybookSeen && refundPlaybookSeen.term === nextRefund.term) return false;
  if (confirmed) return true;
  if (today < nextRefund.date) return false;

  const sorted = normalizeReadings(readings, today);
  if (sorted.length < 2) return false;
  const latest = sorted[sorted.length - 1];
  if (!(latest.date > nextRefund.date)) return false; // the latest reading must postdate the refund

  const before = [...sorted].reverse().find((r) => r.date < nextRefund.date);
  if (!before) return false;

  const jump = (Number(latest.spendable) || 0) - (Number(before.spendable) || 0);
  return jump >= (Number(nextRefund.amount) || 0) * 0.5;
}
