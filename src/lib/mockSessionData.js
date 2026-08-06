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

// ── Seed support thread (Slice 2) ───────────────────────────────────────────
// One existing conversation with a user question + an admin reply, so the
// launcher badge (unread_user: 1) and the transcript both render with zero
// backend on `?mock=1`. Rebuilt fresh each call (like buildMockState) so
// re-seeds never share mutable rows. Shapes mirror support_conversations /
// support_messages in supabase/support_chat.sql exactly (no invented fields).
function isoMinsAgo(mins) {
  return new Date(Date.now() - mins * 60000).toISOString();
}
export function buildMockSupport() {
  const convoId = 'c0ffee00-0000-4000-8000-000000000001';
  return {
    // A settled, already-read thread from a couple days ago: reply seen
    // (unread_user: 0) and last active outside the 24h "mid-conversation" window,
    // so the panel opens to the category picker by default and offers a "resume"
    // link back to this thread. (A waiting reply — unread_user > 0 — would instead
    // auto-open the thread and light the launcher badge.)
    conversations: [
      {
        id: convoId, user_id: MOCK_USER_ID, status: 'open', type: 'question',
        priority: 'normal', subject: 'How do I add a loan?', tags: null, tech_context: null,
        assigned_admin: 'mo@joinmarro.com', linked_issue_url: null, csat: null, csat_comment: null,
        unread_admin: 0, unread_user: 0, reopen_count: 0,
        created_at: isoMinsAgo(3000), last_message_at: isoMinsAgo(2880),
        claimed_at: isoMinsAgo(2940), first_response_at: isoMinsAgo(2880),
        resolved_at: null, resolved_by: null, archived_at: null, snooze_until: null,
      },
      // Two chats the user already ended (archived) within the last 7 days — they
      // populate the hub's "Recent chats" list once no chat is active.
      {
        id: 'c0ffee00-0000-4000-8000-000000000002', user_id: MOCK_USER_ID, status: 'archived', type: 'question',
        priority: 'normal', subject: 'Is my Grad PLUS fee normal?', tags: null, tech_context: null,
        assigned_admin: 'mo@joinmarro.com', linked_issue_url: null, csat: null, csat_comment: null,
        unread_admin: 0, unread_user: 0, reopen_count: 0,
        created_at: isoMinsAgo(1600), last_message_at: isoMinsAgo(1500),
        claimed_at: isoMinsAgo(1560), first_response_at: isoMinsAgo(1500),
        resolved_at: isoMinsAgo(1490), resolved_by: null, archived_at: isoMinsAgo(1490), snooze_until: null,
      },
      {
        id: 'c0ffee00-0000-4000-8000-000000000003', user_id: MOCK_USER_ID, status: 'archived', type: 'question',
        priority: 'normal', subject: 'Refund timing for spring', tags: null, tech_context: null,
        assigned_admin: 'mo@joinmarro.com', linked_issue_url: null, csat: null, csat_comment: null,
        unread_admin: 0, unread_user: 0, reopen_count: 0,
        created_at: isoMinsAgo(5600), last_message_at: isoMinsAgo(5400),
        claimed_at: isoMinsAgo(5550), first_response_at: isoMinsAgo(5400),
        resolved_at: isoMinsAgo(5300), resolved_by: null, archived_at: isoMinsAgo(5300), snooze_until: null,
      },
      // An UNASSIGNED bug report with an unread user message (unread_admin: 1)
      // — gives the Slice-3 admin inbox an "Unassigned · unread" row so the
      // auto-claim-on-reply flow is testable in the harness. Invisible to the
      // user-side hub (only Questions surface there) and unread_user is 0, so
      // it never auto-opens the user panel.
      {
        id: 'c0ffee00-0000-4000-8000-000000000004', user_id: MOCK_USER_ID, status: 'new', type: 'bug',
        priority: 'normal', subject: 'What went wrong:\nCharts tab shows a blank card', tags: null, tech_context: null,
        assigned_admin: null, linked_issue_url: null, csat: null, csat_comment: null,
        unread_admin: 1, unread_user: 0, reopen_count: 0,
        created_at: isoMinsAgo(90), last_message_at: isoMinsAgo(90),
        claimed_at: null, first_response_at: null,
        resolved_at: null, resolved_by: null, archived_at: null, snooze_until: null,
      },
    ],
    messages: [
      {
        id: 'a0000000-0000-4000-8000-000000000005', conversation_id: 'c0ffee00-0000-4000-8000-000000000004',
        sender: 'user', sender_email: null,
        body: 'What went wrong:\nCharts tab shows a blank card\n\nWhat I was doing:\nOpened Charts right after adding a loan',
        attachments: null, is_internal_note: false, created_at: isoMinsAgo(90), read_at: null,
      },
      {
        id: 'a0000000-0000-4000-8000-000000000001', conversation_id: convoId,
        sender: 'user', sender_email: null, body: 'How do I add a loan to my account?',
        attachments: null, is_internal_note: false, created_at: isoMinsAgo(3000), read_at: null,
      },
      {
        id: 'a0000000-0000-4000-8000-000000000002', conversation_id: convoId,
        sender: 'admin', sender_email: 'mo@joinmarro.com',
        body: 'Head to the Loans tab and tap “Add loan” — I can walk you through it if you get stuck!',
        attachments: null, is_internal_note: false, created_at: isoMinsAgo(2880), read_at: isoMinsAgo(2870),
      },
      {
        id: 'a0000000-0000-4000-8000-000000000003', conversation_id: 'c0ffee00-0000-4000-8000-000000000002',
        sender: 'user', sender_email: null, body: 'Is the 4.2% Grad PLUS origination fee normal?',
        attachments: null, is_internal_note: false, created_at: isoMinsAgo(1600), read_at: null,
      },
      {
        id: 'a0000000-0000-4000-8000-000000000004', conversation_id: 'c0ffee00-0000-4000-8000-000000000003',
        sender: 'user', sender_email: null, body: 'When does my spring refund usually land?',
        attachments: null, is_internal_note: false, created_at: isoMinsAgo(5600), read_at: null,
      },
    ],
  };
}

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
    // Grants and scholarships ONLY — money that isn't repaid. Loan money is no
    // longer typed in here: it comes from `loans` below (see src/lib/aid.js), so
    // leaving the old combined $42,000 "total aid" figure here would double-count
    // the loans and roughly double this student's spendable.
    grant: 5000,
    // A few hundred a month of tutoring is realistic while in med school; the
    // old $3,000/mo made earned income dwarf the loans, which hid the
    // borrowed-money states entirely.
    otherIncome: i === 0 ? 300 : 0,
    housing: 1800,
    housingNote: 'Studio near campus, shared utilities',
    livingAllowance: 2600,
    notes: '',
    monthly: { ...BLANK_MONTHLY, housing: 1800, food: 550, transport: 120, personal: 200, books: 90, exams: i === 1 ? 350 : 0, savings: 150, social: 180, subs: 0 },
    monthlyOverrides: {},
  }));

  // Years 2–4 borrow the same way real med students do: a Direct Unsubsidized
  // loan at the annual grad cap plus a Grad PLUS to cover the rest. Generated
  // rather than hand-written so the 4-year overview is coherent (each year has
  // spending money) instead of showing $0 and a runaway cumulative deficit.
  // Year 1's loans stay hand-authored above — they demo the offer/accepted
  // split, the HPSL interest-free path, and the Grad PLUS fee.
  const baseYear = new Date().getFullYear() - 1;
  const laterYearLoans = [1, 2, 3].flatMap((offset) => {
    const ay = baseYear + offset;
    return [
      {
        id: `ln_mock_unsub_y${offset + 1}`, name: `Year ${offset + 1} federal loan`,
        type: 'federal', subtype: 'directUnsubGrad', academicYear: ay, rate: null, status: 'disbursed',
        offeredAmount: 40500,
        disbursements: [
          { id: `db_mock_u${offset}a`, amount: 20250, date: `${ay}-08-05`, dateConfirmed: true },
          { id: `db_mock_u${offset}b`, amount: 20250, date: `${ay + 1}-01-10`, dateConfirmed: true },
        ],
        feePct: null, notes: '', asOfBalance: null, asOfDate: null,
      },
      {
        id: `ln_mock_plus_y${offset + 1}`, name: `Year ${offset + 1} Grad PLUS loan`,
        type: 'federal', subtype: 'gradPLUS', academicYear: ay, rate: null, status: 'disbursed',
        offeredAmount: 30000,
        disbursements: [
          { id: `db_mock_p${offset}a`, amount: 15000, date: `${ay}-08-05`, dateConfirmed: true },
          { id: `db_mock_p${offset}b`, amount: 15000, date: `${ay + 1}-01-10`, dateConfirmed: true },
        ],
        feePct: null, notes: '', asOfBalance: null, asOfDate: null,
      },
    ];
  });

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
        // Award letter offered 45k; the student accepted only 41k (2 × 20,500).
        // Exercises the offer-vs-accepted split — only the 41k drives the math.
        offeredAmount: 45000,
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
        offeredAmount: 8500, // accepted the full offer here
        disbursements: [
          { id: 'db_mock_2a', amount: 8500, date: `${new Date().getFullYear() - 1}-08-05`, dateConfirmed: true },
        ],
        feePct: 0,
        notes: 'Interest-free through residency',
        asOfBalance: null,
        asOfDate: null,
      },
      {
        // Grad PLUS covers the gap between the grant + Direct Unsub cap and the
        // real cost of attendance — the common med-school reality. Its higher
        // 4.228% fee also exercises the fee-reduction path in the aid math, and
        // together the loans make this year's spending money ~90% borrowed, so
        // the "surplus is borrowed, not green" states have something to show.
        id: 'ln_mock_gradplus_1',
        name: 'Grad PLUS loan',
        type: 'federal',
        subtype: 'gradPLUS',
        academicYear: new Date().getFullYear() - 1,
        rate: null, // resolved from the Grad PLUS rate table for that year
        status: 'disbursed',
        offeredAmount: 22000,
        disbursements: [
          { id: 'db_mock_3a', amount: 11000, date: `${new Date().getFullYear() - 1}-08-05`, dateConfirmed: true },
          { id: 'db_mock_3b', amount: 11000, date: `${new Date().getFullYear()}-01-10`, dateConfirmed: true },
        ],
        feePct: null,
        notes: '',
        asOfBalance: null,
        asOfDate: null,
      },
      ...laterYearLoans,
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
      { id: 'we_mock_1', date: getMonday(new Date()), catId: 'food', amount: 42.5, note: 'Groceries' },
      { id: 'we_mock_2', date: todayStr(), catId: 'exams', amount: 745, note: 'USMLE Step 1 registration fee' },
      { id: 'we_mock_3', date: todayStr(), catId: 'transport', amount: 18, note: 'Gas' },
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
