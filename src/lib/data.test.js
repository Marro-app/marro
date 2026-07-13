import { describe, it, expect } from 'vitest';
import {
  diffStates, findConflicts, applyChanges, fmtConflictVal, conflictLabel,
} from './data.js';

// A state that exercises every family the diff engine tracks. Kept small but
// with at least one representative of each shape so round-trips are meaningful.
const baseState = () => ({
  darkMode: false,
  logo: null,
  preferredName: 'Alex',
  avatar: { type: 'art', style: 'buddy', color: 'marigold' },
  program: { degree: 'MD', dual: null, phd: { field: '', institution: '' }, masters: { field: '', institution: '' }, other: { field: '', institution: '' } },
  setupVersion: 1,
  archivedYears: [],
  monthDisabled: { '0-Aug': ['exams'] },
  years: [{
    grant: 1000, tuitionFees: 0, healthIns: 0, otherIncome: 0,
    housing: 0, housingNote: '', livingAllowance: 0, notes: '',
    startDate: '2024-08-01', endDate: '2025-08-15',
    monthly: { food: 300 },
    monthlyOverrides: { Sep: { food: 350 } },
  }],
  categories: [{ id: 'food', label: 'Food' }, { id: 'rent', label: 'Rent' }],
  subscriptions: [{ id: 's1', name: 'Netflix', amount: 15 }],
  stepGoals: [{ id: 'step1', label: 'Step 1', targetAmount: 850 }],
  savingsGoals: [],
  savingsLog: [],
  currentWeekEntries: [],
  weeklyArchive: [{ weekStart: '2024-01-01', entries: [{ id: 'e1', amount: 20 }] }],
  loans: [{
    id: 'loan1', name: 'Year 1 federal loan', type: 'federal', academicYear: 2025,
    rate: null, status: 'disbursed',
    disbursements: [{ id: 'd1', date: '2025-08-05', amount: 20000 }, { id: 'd2', date: '2026-01-10', amount: 20000 }],
    feePct: null, notes: '',
  }],
  balanceReadings: [{ id: 'b1', date: '2026-10-01', spendable: 6400, savings: 12000 }],
  loanReminderSnooze: null,
  refundPlaybookSeen: null,
});

const clone = (o) => JSON.parse(JSON.stringify(o));

// ── diffStates: detects nothing when unchanged ───────────────────────────────
describe('diffStates', () => {
  it('is empty for identical states', () => {
    const b = baseState();
    expect(diffStates(b, clone(b))).toEqual({});
  });

  it('flags a scalar edit', () => {
    const b = baseState(); const c = clone(b); c.darkMode = true;
    expect(diffStates(b, c)).toEqual({ darkMode: { b: false, c: true } });
  });

  it('flags identity/setup scalar edits (preferredName, avatar, program, setupVersion)', () => {
    const b = baseState(); const c = clone(b);
    c.preferredName = 'Sam';
    c.avatar = { type: 'art', style: 'phase', color: 'ink' };
    c.program = { ...c.program, dual: 'phd' };
    c.setupVersion = 2;
    expect(diffStates(b, c)).toEqual({
      preferredName: { b: 'Alex', c: 'Sam' },
      avatar: { b: { type: 'art', style: 'buddy', color: 'marigold' }, c: { type: 'art', style: 'phase', color: 'ink' } },
      program: { b: b.program, c: c.program },
      setupVersion: { b: 1, c: 2 },
    });
  });

  it('flags archivedYears as a whole-array replace when a year is soft-deleted', () => {
    const b = baseState(); const c = clone(b);
    const removed = { id: 0, startDate: '2023-08-01', endDate: '2024-08-15' };
    c.archivedYears = [removed];
    expect(diffStates(b, c)).toEqual({ archivedYears: { b: [], c: [removed] } });
  });

  it('flags nested-map additions with a dotted key', () => {
    const b = baseState(); const c = clone(b); c.monthDisabled['0-Sep'] = ['books'];
    expect(diffStates(b, c)).toEqual({ 'monthDisabled.0-Sep': { b: undefined, c: ['books'] } });
  });

  it('flags a year field, a monthly budget, and an override independently', () => {
    const b = baseState(); const c = clone(b);
    c.years[0].grant = 1200;
    c.years[0].monthly.food = 320;
    c.years[0].monthlyOverrides.Sep.food = 360;
    expect(diffStates(b, c)).toEqual({
      'years[0].grant': { b: 1000, c: 1200 },
      'years[0].monthly.food': { b: 300, c: 320 },
      'years[0].monthlyOverrides.Sep.food': { b: 350, c: 360 },
    });
  });

  it('keys id-arrays by item id for add and remove', () => {
    const b = baseState(); const c = clone(b);
    c.categories.push({ id: 'gym', label: 'Gym' });   // add
    c.subscriptions = [];                              // remove s1
    const d = diffStates(b, c);
    expect(d['categories[gym]']).toEqual({ b: undefined, c: { id: 'gym', label: 'Gym' } });
    expect(d['subscriptions[s1]']).toEqual({ b: { id: 's1', name: 'Netflix', amount: 15 }, c: undefined });
  });

  it('tracks weekly-archive entry edits and whole-week adds', () => {
    const b = baseState(); const c = clone(b);
    c.weeklyArchive[0].entries.push({ id: 'e2', amount: 5 });
    c.weeklyArchive.push({ weekStart: '2024-01-08', entries: [] });
    const d = diffStates(b, c);
    expect(d['weeklyArchive[2024-01-01].entries[e2]']).toEqual({ b: undefined, c: { id: 'e2', amount: 5 } });
    expect(d['weeklyArchive[2024-01-08]']).toEqual({ b: undefined, c: { weekStart: '2024-01-08', entries: [] } });
  });

  it('keys loans and balanceReadings by item id for add and edit (Phase 2)', () => {
    const b = baseState(); const c = clone(b);
    c.loans.push({ id: 'loan2', name: 'Year 2 federal loan', type: 'federal', academicYear: 2026, rate: null, status: 'accepted', disbursements: [], feePct: null, notes: '' });
    c.balanceReadings[0].spendable = 4650;
    const d = diffStates(b, c);
    expect(d['loans[loan2]']).toEqual({ b: undefined, c: c.loans[1] });
    expect(d['balanceReadings[b1]']).toEqual({ b: b.balanceReadings[0], c: c.balanceReadings[0] });
  });

  it('flags loanReminderSnooze and refundPlaybookSeen scalar edits (Phase 2)', () => {
    const b = baseState(); const c = clone(b);
    c.loanReminderSnooze = { choice: 'never', at: '2026-10-01T00:00:00.000Z' };
    c.refundPlaybookSeen = { term: '2027-spring', at: '2027-01-13T00:00:00.000Z' };
    expect(diffStates(b, c)).toEqual({
      loanReminderSnooze: { b: null, c: c.loanReminderSnooze },
      refundPlaybookSeen: { b: null, c: c.refundPlaybookSeen },
    });
  });
});

// ── Round-trip: applyChanges(base, diff(base,cur)) reproduces cur ────────────
describe('applyChanges round-trips every diff family', () => {
  const cases = {
    'scalar edit': (c) => { c.darkMode = true; c.logo = 'https://x/logo.png'; },
    'identity/setup scalar edit': (c) => {
      c.preferredName = 'Sam'; c.avatar = { type: 'google', url: 'https://x/y.png' };
      c.program = { ...c.program, dual: 'masters' }; c.setupVersion = 2;
    },
    'archivedYears replace': (c) => { c.archivedYears = [{ id: 0, startDate: '2023-08-01', endDate: '2024-08-15' }]; },
    'nested-map add + edit': (c) => { c.monthDisabled['0-Sep'] = ['books']; c.monthDisabled['0-Aug'] = ['exams','books']; },
    'year field / monthly / override': (c) => {
      c.years[0].grant = 1200; c.years[0].monthly.food = 320; c.years[0].monthlyOverrides.Sep.food = 360;
    },
    'array append': (c) => { c.categories.push({ id: 'gym', label: 'Gym' }); },
    'array item edit': (c) => { c.subscriptions[0].amount = 22; },
    'array remove': (c) => { c.stepGoals = []; },
    'weekly entry add': (c) => { c.weeklyArchive[0].entries.push({ id: 'e2', amount: 5 }); },
    'weekly entry edit': (c) => { c.weeklyArchive[0].entries[0].amount = 99; },
    'whole week add': (c) => { c.weeklyArchive.push({ weekStart: '2024-01-08', entries: [{ id: 'x', amount: 1 }] }); },
    'loan append + edit': (c) => {
      c.loans[0].rate = 0.0794;
      c.loans.push({ id: 'loan2', name: 'Year 2 federal loan', type: 'federal', academicYear: 2026, rate: null, status: 'accepted', disbursements: [], feePct: null, notes: '' });
    },
    'balanceReading append + edit': (c) => {
      c.balanceReadings[0].savings = 13000;
      c.balanceReadings.push({ id: 'b2', date: '2026-11-01', spendable: 4650, savings: 13000 });
    },
    'loanReminderSnooze + refundPlaybookSeen scalar edit': (c) => {
      c.loanReminderSnooze = { choice: 'never', at: '2026-10-01T00:00:00.000Z' };
      c.refundPlaybookSeen = { term: '2027-spring', at: '2027-01-13T00:00:00.000Z' };
    },
    'everything at once': (c) => {
      c.darkMode = true; c.monthDisabled['0-Sep'] = ['books']; c.years[0].monthly.food = 400;
      c.categories.push({ id: 'gym', label: 'Gym' }); c.subscriptions = [];
      c.weeklyArchive[0].entries.push({ id: 'e2', amount: 5 });
      c.loans.push({ id: 'loan2', name: 'Year 2 federal loan', type: 'federal', academicYear: 2026, rate: null, status: 'accepted', disbursements: [], feePct: null, notes: '' });
      c.balanceReadings.push({ id: 'b2', date: '2026-11-01', spendable: 4650, savings: 13000 });
      c.loanReminderSnooze = { choice: 'never', at: '2026-10-01T00:00:00.000Z' };
    },
  };
  for (const [name, mutate] of Object.entries(cases)) {
    it(name, () => {
      const b = baseState(); const c = clone(b); mutate(c);
      const rebuilt = applyChanges(b, diffStates(b, c));
      expect(rebuilt).toEqual(c);
    });
  }

  it('does not mutate the input state', () => {
    const b = baseState(); const snapshot = clone(b);
    const c = clone(b); c.darkMode = true;
    applyChanges(b, diffStates(b, c));
    expect(b).toEqual(snapshot);
  });

  it('removing a monthly budget key deletes it rather than setting undefined', () => {
    const b = baseState(); const c = clone(b); delete c.years[0].monthly.food;
    const d = diffStates(b, c);
    expect(d).toEqual({ 'years[0].monthly.food': { b: 300, c: undefined } });
    const rebuilt = applyChanges(b, d);
    expect('food' in rebuilt.years[0].monthly).toBe(false);
  });

  it('skips changes to a year index that no longer exists', () => {
    const b = baseState();
    const rebuilt = applyChanges(b, { 'years[5].grant': { b: 0, c: 500 } });
    expect(rebuilt.years).toHaveLength(1); // no phantom year created
  });
});

// ── findConflicts: overlapping edits conflict, disjoint edits auto-merge ─────
describe('findConflicts', () => {
  it('reports a conflict when both sides changed the same key', () => {
    const b = baseState();
    const local = clone(b); local.preferredName = 'Sam';
    const server = clone(b); server.preferredName = 'Jamie';
    const { conflicts, mergeLocal, mergeServer } = findConflicts(diffStates(b, local), diffStates(b, server));
    expect(conflicts).toEqual([{ key: 'preferredName', local: 'Sam', server: 'Jamie' }]);
    expect(mergeLocal).toEqual({});
    expect(mergeServer).toEqual({});
  });

  it('auto-merges disjoint edits from each side', () => {
    const b = baseState();
    const local = clone(b); local.preferredName = 'Sam';          // only local
    const server = clone(b); server.years[0].grant = 1500;        // only server
    const { conflicts, mergeLocal, mergeServer } = findConflicts(diffStates(b, local), diffStates(b, server));
    expect(conflicts).toEqual([]);
    expect(mergeLocal).toHaveProperty('preferredName');
    expect(mergeServer).toHaveProperty('years[0].grant');
  });

  it('separates conflicting from non-conflicting keys in one pass', () => {
    const b = baseState();
    const local = clone(b); local.preferredName = 'Sam'; local.darkMode = true;
    const server = clone(b); server.preferredName = 'Jamie'; server.years[0].grant = 1500;
    const { conflicts, mergeLocal, mergeServer } = findConflicts(diffStates(b, local), diffStates(b, server));
    expect(conflicts.map(c => c.key)).toEqual(['preferredName']);
    expect(mergeLocal).toHaveProperty('darkMode');       // local-only survives
    expect(mergeServer).toHaveProperty('years[0].grant'); // server-only survives
  });
});

// ── Real-world two-device sync scenarios (regression coverage for the fields
// that used to be silently dropped by the merge engine). Mirrors the actual
// production merge call in App.jsx `save()`: on a no-conflict auto-merge it
// does `applyChanges(serverClean, mergeLocal)` — start from the server's
// current state (which already reflects any server-only edits) and layer the
// device's local-only changes on top. That's the pattern used below, rather
// than a symmetric two-step merge nothing in the app actually performs. ─────
describe('two-device merges preserve disjoint edits to the newly-tracked fields', () => {
  it('preferredName change on device A + a budget edit on device B both survive the merge', () => {
    const base = baseState();
    const local = clone(base); local.preferredName = 'Sam';        // device A (this device): identity edit
    const server = clone(base); server.years[0].monthly.food = 500; // device B: already-synced budget edit
    const { conflicts, mergeLocal } = findConflicts(diffStates(base, local), diffStates(base, server));
    expect(conflicts).toEqual([]);
    const merged = applyChanges(server, mergeLocal);
    expect(merged.preferredName).toBe('Sam');          // device A's edit survived
    expect(merged.years[0].monthly.food).toBe(500);    // device B's edit survived
  });

  it('a year removed (archived) on device A stays recorded as removed after merging with an unrelated edit on device B', () => {
    const base = baseState();
    const local = clone(base);
    const removedYear = { ...local.years[0] };
    local.archivedYears = [removedYear];
    local.years = [];                                   // device A: soft-deleted (archived) the only year
    const server = clone(base); server.darkMode = true; // device B: unrelated edit, already on the server
    const { conflicts, mergeLocal } = findConflicts(diffStates(base, local), diffStates(base, server));
    expect(conflicts).toEqual([]);
    const merged = applyChanges(server, mergeLocal);
    // The authoritative "this year was removed" record — archivedYears — is
    // now tracked as a scalar and merges correctly: device A's removal wins.
    expect(merged.archivedYears).toEqual([removedYear]);
    expect(merged.darkMode).toBe(true);                 // device B's edit survived too
    expect(merged.years).toEqual([]);                   // the year itself is actually gone, not a ghost entry
  });

  // Loans/balanceReadings are id-keyed exactly like categories/subscriptions, so an
  // edit on one device and a delete on the other race the same way those already do —
  // this pins down which side wins so the behavior is deterministic and documented,
  // not just "whatever applyChanges happens to do."
  it('a loan edited on device A and deleted on device B: the merge is deterministic (edit loses to delete, since the base state no longer knows the loan existed once server-then-local is applied)', () => {
    const base = baseState();
    const local = clone(base); local.loans[0].rate = 0.0794;   // device A: edited the loan
    const server = clone(base); server.loans = [];              // device B: deleted the loan (already on the server)
    const { conflicts, mergeLocal } = findConflicts(diffStates(base, local), diffStates(base, server));
    // Both sides touched loans[loan1] (edit vs. delete) — findConflicts treats any
    // key present on both sides as a genuine conflict, same as any other field.
    expect(conflicts).toEqual([{ key: 'loans[loan1]', local: local.loans[0], server: undefined }]);
    expect(mergeLocal).toEqual({});
    // Production behavior on a real conflict: the UI surfaces it for the user to
    // pick a side (App.jsx conflict resolver) rather than silently choosing one —
    // applying neither side's mergeLocal/mergeServer here reflects that the merge
    // engine itself takes no action until the conflict is resolved.
    const merged = applyChanges(server, mergeLocal);
    expect(merged.loans).toEqual([]); // server's delete stands until the conflict is explicitly resolved
  });

  it('two devices add a balanceReading on the same date: both rows survive the merge (id-keyed, not date-keyed)', () => {
    const base = baseState();
    const local = clone(base);
    local.balanceReadings.push({ id: 'b-phone', date: '2026-11-01', spendable: 4650, savings: 13000 });
    const server = clone(base);
    server.balanceReadings.push({ id: 'b-laptop', date: '2026-11-01', spendable: 4700, savings: 13000 });
    const { conflicts, mergeLocal } = findConflicts(diffStates(base, local), diffStates(base, server));
    expect(conflicts).toEqual([]); // different ids, same date — not a conflict, both survive
    const merged = applyChanges(server, mergeLocal);
    const nov1 = merged.balanceReadings.filter(r => r.date === '2026-11-01');
    expect(nov1).toHaveLength(2);
    expect(nov1.map(r => r.id).sort()).toEqual(['b-laptop', 'b-phone']);
  });
});

// ── Conflict-display helpers (the conflict-resolution UI) ────────────────────
describe('fmtConflictVal', () => {
  const data = { categories: [{ id: 'food', label: 'Food' }] };
  it('labels removed and boolean values', () => {
    expect(fmtConflictVal('darkMode', null, data)).toBe('(removed)');
    expect(fmtConflictVal('darkMode', true, data)).toBe('On');
    expect(fmtConflictVal('darkMode', false, data)).toBe('Off');
  });
  it('money-formats numbers under money-ish keys, plain otherwise', () => {
    expect(fmtConflictVal('years[0].monthly.food', 500, data)).toBe('$500');
    expect(fmtConflictVal('someCount', 3, data)).toBe('3');
  });
  it('summarizes objects by name/label', () => {
    expect(fmtConflictVal('subscriptions[s1]', { name: 'Netflix', amount: 15 }, data)).toBe('Netflix — $15');
    expect(fmtConflictVal('stepGoals[step1]', { label: 'Step 1', targetAmount: 850 }, data)).toBe('Step 1 — $850');
  });
  it('summarizes a loan by name + total borrowed, and a balance reading by date + amounts', () => {
    const loan = { name: 'Year 1 federal loan', disbursements: [{ amount: 20000 }, { amount: 20000 }] };
    expect(fmtConflictVal('loans[loan1]', loan, data)).toBe('Year 1 federal loan — $40,000');
    const reading = { date: '2026-10-01', spendable: 6400, savings: 12000 };
    expect(fmtConflictVal('balanceReadings[b1]', reading, data)).toBe('2026-10-01 — $6,400 (+ $12,000 savings)');
  });
});

describe('conflictLabel', () => {
  const data = {
    categories: [{ id: 'food', label: 'Food' }],
    subscriptions: [{ id: 's1', name: 'Netflix' }],
  };
  it('describes year monthly, override, and field keys in plain language', () => {
    expect(conflictLabel('years[0].monthly.food', data)).toBe('Year 1 — Food budget');
    expect(conflictLabel('years[1].monthlyOverrides.Sep.food', data)).toBe('Year 2 — Food override (Sep)');
    expect(conflictLabel('years[0].grant', data)).toBe('Year 1 — Grant');
  });
  it('falls back to "Year N" beyond the hardcoded labels', () => {
    expect(conflictLabel('years[4].grant', data)).toBe('Year 5 — Grant');
  });
  it('names subscriptions and categories from data', () => {
    expect(conflictLabel('subscriptions[s1]', data)).toBe('Subscription: Netflix');
    expect(conflictLabel('categories[food]', data)).toBe('Category: Food');
  });
  it('maps known top-level keys', () => {
    expect(conflictLabel('darkMode', data)).toBe('Dark mode');
    expect(conflictLabel('loanReminderSnooze', data)).toBe('Loan reminder');
    expect(conflictLabel('refundPlaybookSeen', data)).toBe('Refund playbook seen');
  });
  it('names loans and balance check-ins from data', () => {
    const d2 = { ...data, loans: [{ id: 'loan1', name: 'Year 1 federal loan' }], balanceReadings: [{ id: 'b1', date: '2026-10-01' }] };
    expect(conflictLabel('loans[loan1]', d2)).toBe('Loan: Year 1 federal loan');
    expect(conflictLabel('balanceReadings[b1]', d2)).toBe('Balance check-in (2026-10-01)');
  });
});
