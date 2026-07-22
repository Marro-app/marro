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

import { DAYS_PER_MONTH, LOAN_RETURN_WINDOW_DAYS, disbFallbackDate } from './constants.js';

// ── Federal rate tables ──────────────────────────────────────────────────────
// Direct Unsubsidized (grad/professional) rates, set every July 1 for loans
// first disbursed in that academic year. Keyed by the CALENDAR YEAR the
// academic year *starts* in (e.g. 2025 → the 2025-26 rate). Source:
// studentaid.gov "Interest Rates and Fees" (historical rate table), verified
// against savingforcollege.com's reproduction of the same table and an FSA
// Partners electronic announcement for 2026-27, 2026-07-17.
//
// ⚠ CORRECTION (2026-07-17, Phase 2.6 Package A build): the 2024 entry was
// previously 0.0653 — that is the UNDERGRADUATE rate for 2024-25, not the
// grad/professional rate (verified 8.08% via FSA Partners electronic
// announcement "Interest Rates for Direct Loans First Disbursed Between
// July 1, 2024 and June 30, 2025"). This under-projected debt for anyone
// holding a 2024-disbursed grad loan by ~1.55 points of accrued interest.
// Fixed here; logged in docs/PRODUCT_DECISIONS.md.
//
// ⚠ MAINTENANCE: add the new year's rate here every July when the Dept. of
// Education publishes it, and log the update in docs/PRODUCT_DECISIONS.md
// (process note — see the Phase 2 commit 3 entry for the template). A loan
// whose academicYear isn't in this table falls back to the nearest known
// year and is flagged as an estimate (see `isRateEstimated`).
export const FEDERAL_GRAD_UNSUB_RATES = {
  2013: 0.0541, // 2013-14
  2014: 0.0621, // 2014-15
  2015: 0.0584, // 2015-16
  2016: 0.0531, // 2016-17
  2017: 0.0600, // 2017-18
  2018: 0.0660, // 2018-19
  2019: 0.0608, // 2019-20
  2020: 0.0430, // 2020-21
  2021: 0.0528, // 2021-22
  2022: 0.0654, // 2022-23
  2023: 0.0705, // 2023-24
  2024: 0.0808, // 2024-25 (corrected — see note above)
  2025: 0.0794, // 2025-26
  2026: 0.0807, // 2026-27
};

// Direct PLUS (Grad PLUS / Parent PLUS — same rate) historical rates, same
// source and verification pass as the table above.
export const FEDERAL_GRAD_PLUS_RATES = {
  2013: 0.0641,
  2014: 0.0721,
  2015: 0.0684,
  2016: 0.0631,
  2017: 0.0700,
  2018: 0.0760,
  2019: 0.0708,
  2020: 0.0530,
  2021: 0.0628,
  2022: 0.0754,
  2023: 0.0805,
  2024: 0.0908,
  2025: 0.0894,
  2026: 0.0907,
};

// Direct Subsidized/Unsubsidized (undergraduate) historical rates — same
// statutory rate for both sub and unsub at the undergrad level, same source.
export const FEDERAL_UNDERGRAD_UNSUB_RATES = {
  2013: 0.0386,
  2014: 0.0466,
  2015: 0.0429,
  2016: 0.0376,
  2017: 0.0445,
  2018: 0.0505,
  2019: 0.0453,
  2020: 0.0275,
  2021: 0.0373,
  2022: 0.0499,
  2023: 0.0550,
  2024: 0.0653,
  2025: 0.0639,
  2026: 0.0652,
};

// Health-professions loans (HPSL/PCL) and Loans for Disadvantaged Students
// (LDS) carry a statutory FIXED 5% rate, not a table — set by the Health
// Resources & Services Administration (HRSA) program rules, unrelated to the
// Dept. of Education's annual Direct Loan formula. Perkins Loans (program
// ended 2017, still held by some borrowers) were also a fixed 5%.
export const HRSA_RATE = 0.05;
export const PERKINS_RATE = 0.05;

// The government's origination fee on Direct Unsubsidized/Subsidized loans,
// deducted from the disbursement but still owed in full — i.e. it INFLATES
// what the student owes rather than reducing it. Source: studentaid.gov fee
// schedule (current year; the fee drifts slightly year to year but this app
// doesn't year-key it, matching the existing simplification).
export const FEDERAL_ORIGINATION_FEE = 0.01057;
// Direct PLUS loans carry a materially higher origination fee.
export const FEDERAL_GRAD_PLUS_FEE = 0.04228;

// ── Per-type loan interest/accrual profile ───────────────────────────────────
// Founder decision #1 (2026-07-13): interest timing is per-TYPE, not a single
// global switch. Most loans (Direct Unsub, Grad PLUS, private) accrue from
// disbursement through school, grace, AND residency. Health-professions loans
// (HPSL/PCL/LDS) are interest-free through school, a 12-month grace, AND
// residency deferment — interest doesn't start until repayment. Direct
// Subsidized (undergrad) is interest-free in school but resumes accruing in
// residency forbearance. Verified 2026-07-13 (design doc appendix); stored
// here verbatim.
//
// Only `accruesInSchool` bites for today's headline number (debt AT
// GRADUATION) — the full profile (grace/residency flags) is stored now so a
// future post-grad/residency projection drops in without another migration.
export const LOAN_INTEREST_PROFILE = {
  directUnsubGrad:      { accruesInSchool: true,  accruesInGrace: true,  graceMonths: 6,  accruesInResidency: true  },
  gradPLUS:             { accruesInSchool: true,  accruesInGrace: true,  graceMonths: 6,  accruesInResidency: true  },
  directUnsubUndergrad: { accruesInSchool: true,  accruesInGrace: true,  graceMonths: 6,  accruesInResidency: true  },
  directSubUndergrad:   { accruesInSchool: false, accruesInGrace: false, graceMonths: 6,  accruesInResidency: true  }, // subsidy ends at residency forbearance
  hpsl:                 { accruesInSchool: false, accruesInGrace: false, graceMonths: 12, accruesInResidency: false }, // interest-free THROUGH residency
  pcl:                  { accruesInSchool: false, accruesInGrace: false, graceMonths: 12, accruesInResidency: false },
  lds:                  { accruesInSchool: false, accruesInGrace: false, graceMonths: 12, accruesInResidency: false },
  perkins:              { accruesInSchool: false, accruesInGrace: false, graceMonths: 9,  accruesInResidency: false },
  private:              { accruesInSchool: true,  accruesInGrace: true,  graceMonths: 0,  accruesInResidency: true  },
  otherUserRate:        { accruesInSchool: true,  accruesInGrace: true,  graceMonths: 6,  accruesInResidency: true  }, // conservative default; user can override via `rate`
};

/**
 * Is interest deferred (not accruing yet) for this loan? Founder decision
 * (2026-07-22): interest deferral is an explicit per-loan TOGGLE. When the
 * student has set `interestDeferred` (true/false), that wins. Otherwise it
 * defaults per type from `LOAN_INTEREST_PROFILE.accruesInSchool`: HPSL/PCL/LDS
 * and Direct Subsidized default ON (interest-free for now); Direct
 * Unsubsidized, Grad PLUS, and private default OFF (accruing from day one).
 */
export function isInterestDeferred(loan) {
  if (loan && typeof loan.interestDeferred === 'boolean') return loan.interestDeferred;
  const key = loanTypeKey(loan);
  const profile = LOAN_INTEREST_PROFILE[key] || LOAN_INTEREST_PROFILE.directUnsubGrad;
  return !profile.accruesInSchool;
}

const DAY_MS = 24 * 60 * 60 * 1000;
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

// ── Loan type resolution ─────────────────────────────────────────────────────

// Rate tables keyed by the profile keys that consult a Dept.-of-Education
// year table (as opposed to a fixed statutory rate or a student-entered one).
const YEAR_TABLE_BY_KEY = {
  directUnsubGrad: FEDERAL_GRAD_UNSUB_RATES,
  gradPLUS: FEDERAL_GRAD_PLUS_RATES,
  directUnsubUndergrad: FEDERAL_UNDERGRAD_UNSUB_RATES,
  directSubUndergrad: FEDERAL_UNDERGRAD_UNSUB_RATES,
};
const FIXED_RATE_BY_KEY = { hpsl: HRSA_RATE, pcl: HRSA_RATE, lds: HRSA_RATE, perkins: PERKINS_RATE };

/**
 * Resolves a loan to its `LOAN_INTEREST_PROFILE` key. `subtype` always wins
 * when set (the 5-first-class-type picker + "Other" writes this). A loan with
 * no subtype (every loan that existed before this model, and any synced from
 * an older client) falls back to today's IMPLICIT model: `type:"private"` →
 * `"private"`, anything else → `"directUnsubGrad"` — this is what makes
 * `subtype:null` bit-identical to pre-Package-A behavior; every math function
 * below routes through this resolver rather than checking `type` directly.
 */
export function loanTypeKey(loan) {
  if (loan.subtype) return loan.subtype;
  if (loan.type === 'private') return 'private';
  return 'directUnsubGrad';
}

// ── Loan rate & fee ───────────────────────────────────────────────────────────

/**
 * The interest rate this loan actually accrues at, as a decimal (0.0807, not
 * 8.07). A student-entered rate always wins. Otherwise, resolved by
 * `loanTypeKey`: HRSA/Perkins types use their fixed statutory rate; the three
 * Direct Loan types look up their own year table (clamping to the nearest
 * known year if the loan predates or postdates it); private/otherUserRate
 * have no table, so an unset rate reads as 0% (callers should treat this as
 * needing the student's input — see `isRateEstimated`).
 */
export function effectiveRate(loan) {
  if (loan.rate != null) return loan.rate;
  const key = loanTypeKey(loan);
  if (key in FIXED_RATE_BY_KEY) return FIXED_RATE_BY_KEY[key];
  const table = YEAR_TABLE_BY_KEY[key];
  if (!table) return 0; // private / otherUserRate — no table, needs the student's own rate
  const years = Object.keys(table).map(Number);
  const minYear = Math.min(...years);
  const maxYear = Math.max(...years);
  const y = Math.max(minYear, Math.min(maxYear, loan.academicYear));
  return table[y];
}

/**
 * The government/statutory rate for this loan's TYPE, as a decimal, IGNORING
 * any student-entered override — i.e. the number the type "normally uses."
 * HRSA/Perkins types return their fixed statutory rate; the Direct Loan types
 * return their year-table rate (clamped to the nearest known year). Returns
 * `null` for private/otherUserRate, which have no set rate at all.
 *
 * This exists specifically so the UI can tell the student "this type's set
 * rate is X%" using the TRUE statutory number even after they've typed a
 * different rate into the field — `effectiveRate` can't, because a student
 * override always wins there (that was the item-6 bug: the heads-up echoed
 * whatever the student typed instead of the real statutory rate).
 */
export function statutoryRate(loan) {
  const key = loanTypeKey(loan);
  if (key in FIXED_RATE_BY_KEY) return FIXED_RATE_BY_KEY[key];
  const table = YEAR_TABLE_BY_KEY[key];
  if (!table) return null;
  const years = Object.keys(table).map(Number);
  const y = Math.max(Math.min(...years), Math.min(Math.max(...years), loan.academicYear));
  return table[y];
}

/**
 * True when the rate `effectiveRate` returned isn't a real, confirmed number
 * — either a private/otherUserRate loan with no rate typed in yet, or a
 * Direct Loan whose academic year fell outside its published table (rare,
 * but a pre-2013 loan or a future year not yet published both land here).
 * Fixed-rate types (HRSA/Perkins) are never an estimate — the rate is a
 * known statutory fact. Drives the "estimate" badge, never the math itself.
 */
export function isRateEstimated(loan) {
  if (loan.rate != null) return false;
  const key = loanTypeKey(loan);
  if (key in FIXED_RATE_BY_KEY) return false;
  const table = YEAR_TABLE_BY_KEY[key];
  if (!table) return true; // private / otherUserRate
  return !(loan.academicYear in table);
}

/**
 * The origination fee this loan is charged, as a decimal. Explicit `feePct`
 * always wins. Otherwise resolved by `loanTypeKey`: Grad PLUS gets the
 * (materially higher) PLUS fee, the three Direct Sub/Unsub types get the
 * standard origination fee, and HRSA/Perkins/private/otherUserRate default
 * to 0 (no origination fee on those; the student can enter one via `feePct`
 * if theirs actually charges one).
 */
export function effectiveFeePct(loan) {
  if (loan.feePct != null) return loan.feePct;
  const key = loanTypeKey(loan);
  if (key === 'gradPLUS') return FEDERAL_GRAD_PLUS_FEE;
  if (key === 'directUnsubGrad' || key === 'directUnsubUndergrad' || key === 'directSubUndergrad') return FEDERAL_ORIGINATION_FEE;
  return 0;
}

// ── Principal & accrued interest ─────────────────────────────────────────────

/**
 * The full amount the award letter OFFERED for this loan, if the student
 * recorded it — the sticker figure on the aid letter, which is often MORE than
 * they actually took. Purely informational: it is never fed into principal,
 * interest, or the debt projection (those all run off the ACCEPTED amount —
 * the disbursement rows below). Returns `null` when no offer was recorded, so
 * the UI can hide the "you accepted X of Y offered" note entirely rather than
 * showing a $0 offer. Founder decision (2026-07-21): a loan captures BOTH the
 * award-letter offer and the (often smaller) amount actually borrowed; only
 * the borrowed amount costs money, so only the borrowed amount drives the math.
 */
export function loanOfferedAmount(loan) {
  if (loan == null || loan.offeredAmount == null) return null;
  const n = Number(loan.offeredAmount);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * How much of this loan is actually owed as principal (before any interest),
 * fee included — the fee is deducted from what the student receives but NOT
 * from what they owe, so it inflates this number rather than shrinking it.
 *
 * Built from the ACCEPTED amount (the disbursement rows, or the entered
 * balance) — NEVER from `offeredAmount`, the award-letter sticker figure. A
 * student offered $45k who accepted $30k owes on the $30k; the $45k offer is
 * kept for reference only (see `loanOfferedAmount`).
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
 * Per-type accrual (founder decision #1): a loan whose `LOAN_INTEREST_PROFILE`
 * says `accruesInSchool:false` (Direct Sub undergrad; the HRSA family;
 * Perkins) accrues NOTHING toward the graduation-horizon number — for those
 * types, `asOf` never postdates the in-school/interest-free window in this
 * model, so zero is the correct answer, not an approximation. This is the
 * fix for the debt tile overstating an HPSL/PCL/LDS borrower's balance.
 * `subtype:null` legacy loans resolve to `directUnsubGrad` (accrues), so this
 * branch is a no-op for every loan that existed before this model.
 *
 * A loan still in "offered" status hasn't actually disbursed money yet, so
 * it accrues nothing. A negative day count (interest asked for before the
 * money arrived) floors to 0 rather than going negative.
 */
export function accruedInterest(loan, asOf) {
  if (loan.status === 'offered') return 0;

  const rate = effectiveRate(loan);

  // Interest deferral (founder decision, 2026-07-22): when interest is
  // deferred, nothing accrues before the student's "interest starts on" date.
  // A deferred loan with no start date set hasn't begun accruing at all within
  // this horizon (the HPSL/subsidized default — interest-free through school),
  // so it contributes zero — bit-identical to the old `accruesInSchool:false`
  // short-circuit this replaced. A non-deferred loan accrues from each
  // disbursement date exactly as before.
  const deferred = isInterestDeferred(loan);
  const start = deferred && loan.interestStartDate && isPlausibleDate(loan.interestStartDate) ? loan.interestStartDate : null;
  if (deferred && !start) return 0;
  const accrueFrom = (date) => (start && start > date ? start : date);

  if (loan.asOfDate != null && loan.asOfBalance != null) {
    const days = Math.max(0, daysBetween(accrueFrom(loan.asOfDate), asOf));
    return (Number(loan.asOfBalance) || 0) * (rate / 365) * days;
  }

  const fee = effectiveFeePct(loan);
  return (loan.disbursements || []).reduce((sum, d) => {
    if (!d.date) return sum; // undated rows are handled upstream (see fillMissingDisbursementDates) — never silently skip in the caller that matters
    const days = Math.max(0, daysBetween(accrueFrom(d.date), asOf));
    const principal = (Number(d.amount) || 0) * (1 + fee);
    return sum + principal * (rate / 365) * days;
  }, 0);
}

// Undated disbursement rows can't accrue interest (no start date to count
// from), so before pricing a loan we fill in a reasonable default: the
// shared `DISBURSEMENT_FALLBACK_CYCLE` from constants.js (the same fallback
// dates LoansTab.jsx uses when creating a new loan's rows — ⚠ these two call
// sites used to disagree; see constants.js for the note). Anything filled
// this way flags the loan's total as an estimate — it's a safety net for
// incomplete data, not a substitute for the real dates.
function fillMissingDisbursementDates(loan) {
  if (loan.asOfDate != null) return { loan, usedFallback: false };
  const disb = loan.disbursements || [];
  if (disb.length === 0) return { loan, usedFallback: true }; // nothing to price — treated as $0, flagged as an estimate rather than silently omitted
  let usedFallback = false;
  const filled = disb.map((d, i) => {
    if (d.date) return d;
    usedFallback = true;
    return { ...d, date: disbFallbackDate(loan.academicYear, i) };
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
    // A loan whose RESOLVED type key is "private"/"otherUserRate" has no
    // government-verified formula behind it, so it's always an estimate even
    // if the student typed in a confirmed rate (`isRateEstimated` alone
    // wouldn't catch that case). Deliberately keyed off `loanTypeKey`, not
    // the raw `type` field: HPSL/PCL/LDS store `type:"private"` for legacy
    // math-fallback purposes only (§A2) but carry a known, federally-fixed
    // statutory rate — they must NOT inherit "always an estimate" from that
    // storage detail the way a genuine private loan does.
    const key = loanTypeKey(filled);
    const loanIsEstimate = key === 'private' || key === 'otherUserRate' || usedFallback || isRateEstimated(filled);
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
      const deadline = addDays(d.date, LOAN_RETURN_WINDOW_DAYS);
      const daysLeft = daysBetween(today, deadline);
      if (daysLeft > 0) out.push({ loanId: loan.id, disbursementId: d.id, deadline, daysLeft, dateConfirmed: !!d.dateConfirmed });
    }
  }
  return out;
}

// ── Return-savings quantification (A3) ───────────────────────────────────────

/**
 * "Returning this money saves about $X by graduation" — quantifies the
 * persistent Loans-tab return-window card (walkthrough §5) instead of
 * leaving it a vague tip. Clones the loan that owns `window`'s disbursement,
 * reduces THAT disbursement's amount by `returnAmount` (capped at the
 * disbursement's own amount — can't return more than arrived), and diffs
 * `projectDebtAtGraduation` with vs. without the reduction. The fee shrinks
 * proportionally (it's charged on the disbursed amount), so the delta
 * captures both the cancelled fee and the cancelled future interest — exactly
 * what federal Return of Title IV actually cancels.
 *
 * Returns `0` (never negative, never a guess bigger than what's returnable)
 * if the window's loan/disbursement can't be found or `returnAmount` isn't a
 * positive number.
 *
 * ⚠ FIX (2026-07-18 hotfix, break-testing finding C2): computed strictly from
 * THIS loan alone — `projectDebtAtGraduation` is only ever called with a
 * single-loan array, so no other loan's principal/rate/dates can enter the
 * math. (Previously this diffed `[...otherLoans, loan]` vs `[...otherLoans,
 * withReturn]`; mathematically the other loans cancel out of that subtraction
 * too, but it read as pooled and invited exactly this kind of bug — tightening
 * to a single-loan computation removes the possibility entirely.)
 *
 * Also fixes the ~4.7x overstatement: `before - after` is the full drop in
 * debt-at-graduation, which cancels the returned PRINCIPAL itself as well as
 * the fee and interest on it. But giving back money you never spent isn't a
 * "saving" — you had that cash and now you don't, a wash. Only the fee and
 * interest that would otherwise have piled up on it is the real benefit, so
 * the raw returned principal (`capped`) is subtracted back out.
 */
export function returnSavingsAtGraduation(loans, window, gradDate, returnAmount) {
  const amt = Number(returnAmount) || 0;
  if (amt <= 0 || !window) return 0;
  const loan = (loans || []).find((l) => l.id === window.loanId);
  if (!loan) return 0;
  const disb = (loan.disbursements || []).find((d) => d.id === window.disbursementId);
  if (!disb) return 0;

  const capped = Math.min(amt, Number(disb.amount) || 0);
  if (capped <= 0) return 0;

  const withReturn = {
    ...loan,
    disbursements: (loan.disbursements || []).map((d) => (d.id === disb.id ? { ...d, amount: (Number(d.amount) || 0) - capped } : d)),
  };

  const before = projectDebtAtGraduation([loan], gradDate).total;
  const after = projectDebtAtGraduation([withReturn], gradDate).total;
  const debtReduction = before - after; // returned principal (fee-grossed) + fee + interest cancelled
  return Math.max(0, debtReduction - capped);
}

// ── Cushion-source classification (A4) ────────────────────────────────────────

/**
 * "Surplus loan money isn't wealth" (walkthrough §5) — the Runway tile's
 * `growing` state is a lie when the "growth" is just unspent LOAN money at
 * ~8% interest, not real savings. This classifies where a growing cushion is
 * actually coming from, so `runwayTileDisplay` can split the copy:
 *   - `"loan"`: a return window is currently open (the clearest possible
 *     evidence — literal surplus loan money, still returnable), OR a loan
 *     disbursement landed within the most recent burn-measurement window and
 *     that loan inflow was at least as large as the (pro-rated) non-loan
 *     income over the same window.
 *   - `"own"`: no counted loans at all, OR non-loan income makes up more than
 *     a quarter of the student's combined annual inflow (loan + non-loan) —
 *     the design's own >25% threshold.
 *   - `"mixed"`: ambiguous — some loans exist and non-loan income doesn't
 *     clearly dominate. Treated as loan-side (blue, not green) copy by the
 *     caller, the conservative choice per the plan.
 *
 * `otherIncome` is the student's ANNUAL non-loan income figure (job, family
 * gifts, etc. — whatever the caller already tracks as "other income" for the
 * year); this function makes no assumption about where that number comes
 * from beyond treating it as an annual rate for the window pro-ration below.
 */
export function classifyCushionSource({ readings, loans, otherIncome, today }) {
  const allLoans = loans || [];
  if (loanReturnWindows(allLoans, today).length > 0) return 'loan';

  const counted = allLoans.filter((l) => l.status === 'accepted' || l.status === 'disbursed');
  if (counted.length === 0) return 'own';

  const sorted = normalizeReadings(readings, today);
  if (sorted.length >= 2) {
    const prev = sorted[sorted.length - 2];
    const latest = sorted[sorted.length - 1];
    const windowDays = Math.max(1, daysBetween(prev.date, latest.date));
    const loanInflowInWindow = counted.reduce((sum, loan) => sum + (loan.disbursements || [])
      .filter((d) => d.date && d.date > prev.date && d.date <= latest.date)
      .reduce((a, d) => a + (Number(d.amount) || 0), 0), 0);
    const nonLoanInWindow = (Number(otherIncome) || 0) * (windowDays / 365);
    if (loanInflowInWindow > 0 && loanInflowInWindow >= nonLoanInWindow) return 'loan';
  }

  const loanInflowAnnual = counted.reduce((sum, loan) => sum + (loan.disbursements || []).reduce((a, d) => a + (Number(d.amount) || 0), 0), 0);
  const otherIncomeAnnual = Number(otherIncome) || 0;
  const combined = otherIncomeAnnual + loanInflowAnnual;
  const nonLoanShare = combined > 0 ? otherIncomeAnnual / combined : 0;
  return nonLoanShare > 0.25 ? 'own' : 'mixed';
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

/**
 * Single source of truth for "which refund cycle are we talking about right
 * now, and should the UI show the full Refund Playbook card or just a light
 * 'did it land?' nudge?" — shared by the Loans tab's Playbook card and the
 * header nudge (walkthrough §7/§9) so the two surfaces can never disagree
 * about the term or double-trigger on different candidates.
 *
 * `confirmedTerm` is whatever term the student most recently clicked "yes,
 * it landed" for (from either surface) — it only counts as a confirmation
 * for the CURRENT candidate, so confirming an old term never leaks forward.
 */
export function refundNudgeState({ years, readings, refundPlaybookSeen, today, confirmedTerm = null }) {
  const refunds = estimateRefunds(years || []);
  const candidate = [...refunds]
    .filter((r) => r.date && r.date <= today && (!refundPlaybookSeen || refundPlaybookSeen.term !== r.term))
    .sort((a, b) => (a.date < b.date ? 1 : -1))[0] || null;
  if (!candidate) return { candidate: null, showPlaybook: false, showNudge: false };

  const confirmed = confirmedTerm != null && confirmedTerm === candidate.term;
  const showPlaybook = refundPlaybookTrigger({ readings, nextRefund: candidate, refundPlaybookSeen, today, confirmed });
  return { candidate, showPlaybook, showNudge: !showPlaybook };
}
