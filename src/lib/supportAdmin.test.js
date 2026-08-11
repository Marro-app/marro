import { describe, it, expect } from 'vitest';
import { filterInbox, unreadAdminCount, timeAgo, handledByLabel } from './supportAdmin.js';

const ME = 'ethan@joinmarro.com';
const CO = 'mo@joinmarro.com';

const convos = [
  { id: 'a', status: 'new', assigned_admin: null, unread_admin: 1 },
  { id: 'b', status: 'open', assigned_admin: ME, unread_admin: 2 },
  { id: 'c', status: 'open', assigned_admin: CO, unread_admin: 0 },
  { id: 'd', status: 'resolved', assigned_admin: ME, unread_admin: 0 },
  { id: 'e', status: 'archived', assigned_admin: null, unread_admin: 0 },
  { id: 'f', status: 'waiting_user', assigned_admin: 'MO@JOINMARRO.COM', unread_admin: 0 },
];
const ids = (rows) => rows.map((r) => r.id);

describe('filterInbox', () => {
  it('active = needs attention now (not snoozed, not closed)', () => {
    expect(ids(filterInbox(convos, 'active', ME))).toEqual(['a', 'b', 'c', 'f']);
    const withSnooze = [...convos, { id: 'g', status: 'snoozed', assigned_admin: ME, unread_admin: 0 }];
    expect(ids(filterInbox(withSnooze, 'active', ME))).toEqual(['a', 'b', 'c', 'f']);
  });
  it('unassigned = no owner, not parked', () => {
    expect(ids(filterInbox(convos, 'unassigned', ME))).toEqual(['a']);
  });
  it('mine = owned by the caller (case-insensitive) and not closed', () => {
    expect(ids(filterInbox(convos, 'mine', ME))).toEqual(['b']);
    expect(ids(filterInbox(convos, 'mine', 'mo@joinmarro.com'))).toEqual(['c', 'f']);
  });
  it('status queues slice by exact status', () => {
    expect(ids(filterInbox(convos, 'waiting', ME))).toEqual(['f']);
    expect(ids(filterInbox(convos, 'resolved', ME))).toEqual(['d']);
    expect(ids(filterInbox(convos, 'archived', ME))).toEqual(['e']);
    expect(ids(filterInbox([{ id: 'g', status: 'snoozed' }], 'snoozed', ME))).toEqual(['g']);
  });
  it('all returns everything including history, order preserved', () => {
    expect(ids(filterInbox(convos, 'all', ME))).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
  });
  it('handles empty/undefined input', () => {
    expect(filterInbox(null, 'active', ME)).toEqual([]);
    expect(filterInbox([], 'mine', ME)).toEqual([]);
  });
});

describe('unreadAdminCount', () => {
  it('sums unread_admin across threads', () => {
    expect(unreadAdminCount(convos)).toBe(3);
    expect(unreadAdminCount([])).toBe(0);
    expect(unreadAdminCount(null)).toBe(0);
  });
});

describe('timeAgo', () => {
  const now = Date.parse('2026-08-05T12:00:00Z');
  it('buckets minutes/hours/days', () => {
    expect(timeAgo('2026-08-05T11:59:40Z', now)).toBe('just now');
    expect(timeAgo('2026-08-05T11:48:00Z', now)).toBe('12m');
    expect(timeAgo('2026-08-05T09:00:00Z', now)).toBe('3h');
    expect(timeAgo('2026-08-03T11:00:00Z', now)).toBe('2d');
  });
  it('empty input → empty label', () => {
    expect(timeAgo(null, now)).toBe('');
  });
});

describe('handledByLabel', () => {
  it('unassigned → null; assigned → their email, no "you" special-case', () => {
    expect(handledByLabel(null)).toBe(null);
    expect(handledByLabel(ME)).toBe(ME);
    expect(handledByLabel(CO)).toBe(CO);
  });
});
