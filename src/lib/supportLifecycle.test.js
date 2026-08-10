import { describe, it, expect } from 'vitest';
import { canTransition, eventForTransition, sweep, waitingLabel, AUTO_ARCHIVE_DAYS } from './supportLifecycle.js';

describe('canTransition', () => {
  it('allows the documented forward moves', () => {
    expect(canTransition('new', 'open')).toBe(true);
    expect(canTransition('open', 'waiting_user')).toBe(true);
    expect(canTransition('waiting_user', 'open')).toBe(true);
    expect(canTransition('open', 'resolved')).toBe(true);
    expect(canTransition('resolved', 'archived')).toBe(true);
    expect(canTransition('snoozed', 'open')).toBe(true);
  });
  it('allows reopening closed threads', () => {
    expect(canTransition('resolved', 'open')).toBe(true);
    expect(canTransition('archived', 'open')).toBe(true);
  });
  it('blocks nonsense moves', () => {
    expect(canTransition('archived', 'snoozed')).toBe(false);
    expect(canTransition('archived', 'waiting_user')).toBe(false);
    expect(canTransition('resolved', 'waiting_user')).toBe(false);
    expect(canTransition('open', 'open')).toBe(false);
    expect(canTransition('open', 'bogus')).toBe(false);
  });
});

describe('eventForTransition', () => {
  it('maps transitions to the audit-log verbs the metrics read', () => {
    expect(eventForTransition('resolved', 'open')).toBe('resolved');
    expect(eventForTransition('archived', 'resolved')).toBe('archived');
    expect(eventForTransition('snoozed', 'open')).toBe('snoozed');
    expect(eventForTransition('open', 'resolved')).toBe('reopened');
    expect(eventForTransition('open', 'snoozed')).toBe('reopened');
    expect(eventForTransition('waiting_user', 'open')).toBe('status_changed');
  });
});

describe('sweep', () => {
  const now = Date.parse('2026-08-07T12:00:00Z');
  const daysAgo = (d) => new Date(now - d * 86400000).toISOString();

  it('wakes snoozed threads whose snooze_until passed', () => {
    const due = { id: 'a', status: 'snoozed', snooze_until: daysAgo(1) };
    const notDue = { id: 'b', status: 'snoozed', snooze_until: new Date(now + 3600000).toISOString() };
    const out = sweep([due, notDue], now);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: 'a', patch: { status: 'open', snooze_until: null }, event: 'reopened' });
  });

  it('auto-archives resolved threads past the retention window', () => {
    const old = { id: 'c', status: 'resolved', resolved_at: daysAgo(AUTO_ARCHIVE_DAYS + 1) };
    const fresh = { id: 'd', status: 'resolved', resolved_at: daysAgo(2) };
    const out = sweep([old, fresh], now);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('c');
    expect(out[0].patch.status).toBe('archived');
    expect(out[0].event).toBe('archived');
  });

  it('leaves everything else alone', () => {
    expect(sweep([{ id: 'e', status: 'open' }, { id: 'f', status: 'archived' }], now)).toEqual([]);
    expect(sweep(null, now)).toEqual([]);
  });
});

describe('waitingLabel', () => {
  const now = Date.parse('2026-08-07T12:00:00Z');
  const minsAgo = (m) => new Date(now - m * 60000).toISOString();

  it('labels never-answered active threads by age', () => {
    expect(waitingLabel({ status: 'new', first_response_at: null, created_at: minsAgo(30) }, now)).toBe('unanswered 30m');
    expect(waitingLabel({ status: 'open', first_response_at: null, created_at: minsAgo(200) }, now)).toBe('unanswered 3h');
    expect(waitingLabel({ status: 'new', first_response_at: null, created_at: minsAgo(3000) }, now)).toBe('unanswered 2d');
  });
  it('stays quiet when answered, fresh, or not active', () => {
    expect(waitingLabel({ status: 'open', first_response_at: minsAgo(5), created_at: minsAgo(60) }, now)).toBe(null);
    expect(waitingLabel({ status: 'new', first_response_at: null, created_at: minsAgo(2) }, now)).toBe(null);
    expect(waitingLabel({ status: 'snoozed', first_response_at: null, created_at: minsAgo(600) }, now)).toBe(null);
    expect(waitingLabel(null, now)).toBe(null);
  });
});
