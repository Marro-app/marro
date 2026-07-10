import { describe, it, expect } from 'vitest';
import {
  diffStates, findConflicts, applyChanges, fmtConflictVal, conflictLabel,
} from './data.js';

// A state that exercises every family the diff engine tracks. Kept small but
// with at least one representative of each shape so round-trips are meaningful.
const baseState = () => ({
  darkMode: false,
  logo: null,
  surplusBank: 100,
  preferredName: 'Alex',
  avatar: { type: 'art', style: 'buddy', color: 'marigold' },
  program: { degree: 'MD', dual: null, phd: { field: '', institution: '' }, masters: { field: '', institution: '' }, other: { field: '', institution: '' } },
  setupVersion: 1,
  archivedYears: [],
  monthlyRollover: { '0-Aug': 50 },
  monthDisabled: {},
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
});

const clone = (o) => JSON.parse(JSON.stringify(o));

// ── diffStates: detects nothing when unchanged ───────────────────────────────
describe('diffStates', () => {
  it('is empty for identical states', () => {
    const b = baseState();
    expect(diffStates(b, clone(b))).toEqual({});
  });

  it('flags a scalar edit', () => {
    const b = baseState(); const c = clone(b); c.surplusBank = 200;
    expect(diffStates(b, c)).toEqual({ surplusBank: { b: 100, c: 200 } });
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
    const b = baseState(); const c = clone(b); c.monthlyRollover['0-Sep'] = 25;
    expect(diffStates(b, c)).toEqual({ 'monthlyRollover.0-Sep': { b: undefined, c: 25 } });
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
});

// ── Round-trip: applyChanges(base, diff(base,cur)) reproduces cur ────────────
describe('applyChanges round-trips every diff family', () => {
  const cases = {
    'scalar edit': (c) => { c.surplusBank = 200; c.darkMode = true; },
    'identity/setup scalar edit': (c) => {
      c.preferredName = 'Sam'; c.avatar = { type: 'google', url: 'https://x/y.png' };
      c.program = { ...c.program, dual: 'masters' }; c.setupVersion = 2;
    },
    'archivedYears replace': (c) => { c.archivedYears = [{ id: 0, startDate: '2023-08-01', endDate: '2024-08-15' }]; },
    'nested-map add + edit': (c) => { c.monthlyRollover['0-Sep'] = 25; c.monthlyRollover['0-Aug'] = 60; },
    'year field / monthly / override': (c) => {
      c.years[0].grant = 1200; c.years[0].monthly.food = 320; c.years[0].monthlyOverrides.Sep.food = 360;
    },
    'array append': (c) => { c.categories.push({ id: 'gym', label: 'Gym' }); },
    'array item edit': (c) => { c.subscriptions[0].amount = 22; },
    'array remove': (c) => { c.stepGoals = []; },
    'weekly entry add': (c) => { c.weeklyArchive[0].entries.push({ id: 'e2', amount: 5 }); },
    'weekly entry edit': (c) => { c.weeklyArchive[0].entries[0].amount = 99; },
    'whole week add': (c) => { c.weeklyArchive.push({ weekStart: '2024-01-08', entries: [{ id: 'x', amount: 1 }] }); },
    'everything at once': (c) => {
      c.surplusBank = 999; c.monthlyRollover['0-Sep'] = 25; c.years[0].monthly.food = 400;
      c.categories.push({ id: 'gym', label: 'Gym' }); c.subscriptions = [];
      c.weeklyArchive[0].entries.push({ id: 'e2', amount: 5 });
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
    const c = clone(b); c.surplusBank = 500;
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
    const local = clone(b); local.surplusBank = 300;
    const server = clone(b); server.surplusBank = 400;
    const { conflicts, mergeLocal, mergeServer } = findConflicts(diffStates(b, local), diffStates(b, server));
    expect(conflicts).toEqual([{ key: 'surplusBank', local: 300, server: 400 }]);
    expect(mergeLocal).toEqual({});
    expect(mergeServer).toEqual({});
  });

  it('auto-merges disjoint edits from each side', () => {
    const b = baseState();
    const local = clone(b); local.surplusBank = 300;             // only local
    const server = clone(b); server.years[0].grant = 1500;       // only server
    const { conflicts, mergeLocal, mergeServer } = findConflicts(diffStates(b, local), diffStates(b, server));
    expect(conflicts).toEqual([]);
    expect(mergeLocal).toHaveProperty('surplusBank');
    expect(mergeServer).toHaveProperty('years[0].grant');
  });

  it('separates conflicting from non-conflicting keys in one pass', () => {
    const b = baseState();
    const local = clone(b); local.surplusBank = 300; local.darkMode = true;
    const server = clone(b); server.surplusBank = 400; server.years[0].grant = 1500;
    const { conflicts, mergeLocal, mergeServer } = findConflicts(diffStates(b, local), diffStates(b, server));
    expect(conflicts.map(c => c.key)).toEqual(['surplusBank']);
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
    const server = clone(base); server.surplusBank = 250; // device B: unrelated edit, already on the server
    const { conflicts, mergeLocal } = findConflicts(diffStates(base, local), diffStates(base, server));
    expect(conflicts).toEqual([]);
    const merged = applyChanges(server, mergeLocal);
    // The authoritative "this year was removed" record — archivedYears — is
    // now tracked as a scalar and merges correctly: device A's removal wins.
    expect(merged.archivedYears).toEqual([removedYear]);
    expect(merged.surplusBank).toBe(250);               // device B's edit survived too
    expect(merged.years).toEqual([]);                   // the year itself is actually gone, not a ghost entry
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
    expect(conflictLabel('surplusBank', data)).toBe('Surplus bank');
  });
});
