// Shared facts & thresholds — Marro's single home for numbers that were
// previously re-typed independently in 2+ files (a drift risk flagged by the
// 2026-07-17 hardcoded-values audit, docs/PRODUCT_DECISIONS.md "Phase 2.6
// Package A"). Follow the ⚠ MAINTENANCE comment style below when adding more.

// ── Calendar-math constants ──────────────────────────────────────────────────
// Average month length in days (365.25/12), used anywhere a measurement
// window needs to be normalized into a monthly rate. Previously redefined
// independently in src/lib/loans.js, src/tabs/LoansTab.jsx, and
// src/tabs/SavingsTab.jsx.
export const DAYS_PER_MONTH = 30.44;

// Average weeks per month (365.25/7/12), used to convert a monthly budget
// figure into a weekly one. Previously redefined independently (and, in one
// spot, mistyped to a different precision) in src/App.jsx and
// src/tabs/WeeklyTab.jsx.
export const WEEKS_PER_MONTH = 4.333;

// ── Loan-specific facts ──────────────────────────────────────────────────────
// Direct Loan Borrowers' Rights: federal loan money can be returned within
// this many days of disbursement for a clean cancellation of the interest
// and fee on the returned portion, as if it were never borrowed. Real
// regulatory fact, unlikely to change, but was a bare "120" literal in both
// src/lib/loans.js and copy in src/tabs/LoansTab.jsx.
export const LOAN_RETURN_WINDOW_DAYS = 120;

// Typical fall/spring federal-loan disbursement dates, used as a fallback
// when a student hasn't entered/confirmed a real date. A 4-entry rotating
// cycle so a loan with more than 2 disbursement rows (e.g. quarterly terms)
// still gets a sensible guess. ⚠ Previously loans.js and LoansTab.jsx each
// invented their OWN version of this fact and disagreed (Aug 15/Jan 15 vs.
// Aug 5/Jan 10) — same loan, two different assumed dates depending which
// code path touched it. This is now the one shared source; see
// `disbFallbackDate` below for the resolver both files call.
export const DISBURSEMENT_FALLBACK_CYCLE = [
  { month: 8, day: 5, yearOffset: 0 },  // fall
  { month: 1, day: 10, yearOffset: 1 }, // spring
  { month: 3, day: 1, yearOffset: 1 },  // (3rd/4th disbursement rows, e.g. quarter terms)
  { month: 5, day: 1, yearOffset: 1 },
];
const pad2 = (n) => String(n).padStart(2, '0');
/** The fallback disbursement date for the i-th row of a loan whose academic year starts `academicYear`. */
export function disbFallbackDate(academicYear, i) {
  const t = DISBURSEMENT_FALLBACK_CYCLE[i % DISBURSEMENT_FALLBACK_CYCLE.length];
  return `${academicYear + t.yearOffset}-${pad2(t.month)}-${pad2(t.day)}`;
}

// ── Money Plan / savings-rate facts ──────────────────────────────────────────
// The single assumed savings-account interest rate used wherever the app
// estimates "what parking money in savings could earn" (the Refund
// Playbook's earnings estimate, the future Money Plan projection). ⚠
// Previously the Playbook had its own private 4% constant while SavingsTab's
// Growth Projector had an independent, un-persisted 4.5% default — two
// disagreeing "assumed rate" values. This is now the one default; a future
// user-editable rate (`moneyPlanRateSeen`, Package B) overrides it.
export const DEFAULT_SAVINGS_APY = 0.04;

// Plain-language copy constant for the prevailing online-savings-rate range
// quoted in education copy (NOT used in any calculation — market fact that
// drifts with the Fed funds rate, unlike the annual/rare facts above).
// ⚠ MAINTENANCE: sanity-check this range every few months against a current
// HYSA rate roundup; update the copy string, not just the number.
export const HYSA_RATE_RANGE_COPY = 'roughly 3.5–4.5%';

// FDIC deposit insurance cap — copy-only fact (last changed by Congress in
// 2008), not used in any calculation.
export const FDIC_INSURANCE_CAP = 250000;

// ── USMLE / COMLEX exam-fee facts ────────────────────────────────────────────
// 2026 fees, verified against NBME/NBOME fee schedules (studentaid-adjacent
// research, 2026-07-13 — see docs/PRODUCT_DECISIONS.md "Phase 2.6 Package A").
// ⚠ MAINTENANCE: NBME/NBOME publish fee updates periodically — re-check
// annually and log the update here + in PRODUCT_DECISIONS.md.
export const USMLE_STEP_FEE_ESTIMATE = 695; // Step 1, Step 2 CK (2026)
export const COMLEX_LEVEL1_FEE_ESTIMATE = 745; // COMLEX Level 1 (2026, DO students)
export const COMLEX_LEVEL2CE_FEE_ESTIMATE = 730; // COMLEX Level 2-CE (2026, DO students)
