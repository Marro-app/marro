// ── Dev-only test harness: mock session + fake sample data ──────────────────
// Reached ONLY via dynamic import() from a branch already gated behind
// `isMockModeActive()` (see `getSupabase()` in `lib/data.js`) — never
// statically imported, so it can never land in a production bundle even by
// accident. Nothing in this file is a real credential: `access_token: 'mock'`
// is never sent anywhere, and no code path here calls the real Supabase
// client or any real auth endpoint.
//
// Reuses `DEFAULT_STATE`'s exact schema (no invented fields) and fills in
// representative values so every tab renders real content: a mix of
// federal + HPSL loans (so the interest model + Debt tile show), two
// balance readings 30+ days apart (so Runway computes a measured burn
// rate instead of "add your balance"), budget numbers for the current
// year, aid/grant figures, and one big one-off cost (USMLE Step 1
// registration) in the current week's entries.
import { DEFAULT_STATE, DEFAULT_CATS, BLANK_MONTHLY, SETUP_VERSION, generateYearConfigs, blankYearFields, getMonday, todayStr } from './format.js';

export const MOCK_USER_ID = '00000000-0000-4000-8000-000000000001';
export const MOCK_EMAIL = 'test@localhost';

// Minimal shape App.jsx actually reads off `session`: user.id, user.email.
export const MOCK_SESSION = {
  access_token: 'mock',
  refresh_token: 'mock',
  token_type: 'bearer',
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: {
    id: MOCK_USER_ID,
    email: MOCK_EMAIL,
    app_metadata: { provider: 'mock' },
    user_metadata: {},
    created_at: '2026-01-01T00:00:00.000Z',
  },
};

export const MOCK_PROFILE = { school: 'Weill Cornell Medicine' };

function isoDaysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// Builds a fresh deep clone each call so nothing shared/mutable leaks across
// re-seeds within a session (e.g. the invite-redemption gateNonce re-run).
export function buildMockState() {
  const years = generateYearConfigs(new Date().getFullYear() - 1, 4).map((cfg, i) => ({
    ...cfg,
    ...blankYearFields(),
    tuitionFees: 34000,
    healthIns: 4200,
    grant: 42000,       // total aid (incl. health ins) — realistic med-school scholarship
    otherIncome: i === 0 ? 3000 : 0,
    housing: 1800,
    housingNote: 'Studio near campus, shared utilities',
    livingAllowance: 2600,
    notes: '',
    monthly: { ...BLANK_MONTHLY, housing: 1800, food: 550, transport: 120, personal: 200, books: 90, exams: i === 1 ? 350 : 0, savings: 150, social: 180, subs: 0 },
    monthlyOverrides: {},
  }));

  const state = {
    ...JSON.parse(JSON.stringify(DEFAULT_STATE)),
    setupVersion: SETUP_VERSION, // skip onboarding/progressive-setup — land straight in the app
    categories: JSON.parse(JSON.stringify(DEFAULT_CATS)),
    years,
    preferredName: 'Test Student',
    program: { degree: 'MD', dual: null, phd: { field: '', institution: '' }, masters: { field: '', institution: '' }, other: { field: '', institution: '' } },
    darkMode: true,

    // ── Loans: one federal Direct Unsubsidized (interest accrues) + one HPSL
    // (interest-free through residency) — exercises both branches of the
    // interest model on the Loans/Debt tiles.
    loans: [
      {
        id: 'ln_mock_federal_1',
        name: 'Year 1 federal loan',
        type: 'federal',
        subtype: 'directUnsubGrad',
        academicYear: new Date().getFullYear() - 1,
        rate: null, // resolved from the federal rate table for that academic year
        status: 'disbursed',
        disbursements: [
          // Fall disbursement in the academic year's start calendar year, spring
          // disbursement in the FOLLOWING calendar year (academic years span two
          // calendar years, e.g. fall 2025 -> spring 2026) — a same-year date here
          // previously made every 120-day return window look permanently closed.
          { id: 'db_mock_1a', amount: 20500, date: `${new Date().getFullYear() - 1}-08-05`, dateConfirmed: true },
          { id: 'db_mock_1b', amount: 20500, date: `${new Date().getFullYear()}-01-10`, dateConfirmed: true },
        ],
        feePct: null,
        notes: '',
        asOfBalance: null,
        asOfDate: null,
      },
      {
        id: 'ln_mock_hpsl_1',
        name: 'Health Professions Student Loan',
        type: 'private',
        subtype: 'hpsl',
        academicYear: new Date().getFullYear() - 1,
        rate: null, // HPSL/PCL/LDS resolve to the fixed 5% HRSA rate
        status: 'disbursed',
        disbursements: [
          { id: 'db_mock_2a', amount: 8500, date: `${new Date().getFullYear() - 1}-08-05`, dateConfirmed: true },
        ],
        feePct: 0,
        notes: 'Interest-free through residency',
        asOfBalance: null,
        asOfDate: null,
      },
    ],

    // ── Balance readings: two points 30+ days apart with a realistic decline
    // so `computeRunway` measures a real burn rate instead of falling back to
    // the plan (see loans.js computeRunway — needs windowDays >= 14).
    balanceReadings: [
      { id: 'bal_mock_1', date: isoDaysAgo(35), spendable: 6800, savings: 3000 },
      { id: 'bal_mock_2', date: isoDaysAgo(2), spendable: 5950, savings: 3150 },
    ],

    loanReminderSnooze: null,
    refundPlaybookSeen: null,

    // ── Weekly: a normal week plus one big one-off cost (Step 1 registration)
    // so the Weekly/Budget tabs have something to look at beyond zeros.
    currentWeekEntries: [
      { id: 'we_mock_1', date: getMonday(new Date()), category: 'food', amount: 42.5, note: 'Groceries' },
      { id: 'we_mock_2', date: todayStr(), category: 'exams', amount: 745, note: 'USMLE Step 1 registration fee' },
      { id: 'we_mock_3', date: todayStr(), category: 'transport', amount: 18, note: 'Gas' },
    ],
    weeklyArchive: [],
    subscriptions: [
      { id: 'sub_mock_1', name: 'Streaming', amount: 15.49, cycle: 'monthly', active: true },
    ],

    stepGoals: [
      { id: 'step1', label: 'Step 1', targetAmount: 1550, targetDate: '2027-06-01', saved: 400, monthlyContribution: 50 },
      { id: 'step2', label: 'Step 2 CK', targetAmount: 1550, targetDate: '2028-09-01', saved: 0, monthlyContribution: 50 },
      { id: 'step3', label: 'Step 3', targetAmount: 1000, targetDate: '2030-06-01', saved: 0, monthlyContribution: 0 },
    ],
    savingsGoals: [],
    savingsLog: [],
  };
  return state;
}
