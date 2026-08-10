import { describe, it, expect } from 'vitest';
import { evaluateNudge, composeWarning } from './nudgeGate.js';

const now = Date.parse('2026-08-07T12:00:00Z');
const base = { state: 'scheduled', send_after: '2026-08-07T11:00:00Z', recheck_condition: { type: 'no_open_support_thread' } };

describe('evaluateNudge', () => {
  it('waits until due', () => {
    expect(evaluateNudge({ ...base, send_after: '2026-08-07T13:00:00Z' }, {}, now).action).toBe('wait');
  });
  it('sends when due and the condition still holds', () => {
    expect(evaluateNudge(base, { userActiveThread: false }, now)).toEqual({ action: 'send', reason: 'condition_holds' });
  });
  it('auto-cancels when the trigger resolved itself (thread already open)', () => {
    expect(evaluateNudge(base, { userActiveThread: true }, now)).toEqual({ action: 'cancel', reason: 'thread_already_open' });
  });
  it('auto-cancels when the user already messaged us since', () => {
    expect(evaluateNudge(base, { userMessagedSince: true }, now).action).toBe('cancel');
  });
  it('enforces the frequency cap', () => {
    expect(evaluateNudge(base, { sentToTargetInWindow: 1 }, now)).toEqual({ action: 'cancel', reason: 'frequency_cap' });
  });
  it("fails safe on a condition it can't verify", () => {
    expect(evaluateNudge({ ...base, recheck_condition: { type: 'mystery_signal' } }, {}, now).action).toBe('cancel');
  });
  it("'always' nudges send once due (manual send-now)", () => {
    expect(evaluateNudge({ ...base, recheck_condition: null }, {}, now).action).toBe('send');
  });
  it('non-scheduled states never re-send', () => {
    expect(evaluateNudge({ ...base, state: 'sent' }, {}, now).action).toBe('wait');
    expect(evaluateNudge({ ...base, state: 'cancelled' }, {}, now).action).toBe('wait');
  });
});

describe('composeWarning', () => {
  it('warns about open threads and prior nudges, quiet otherwise', () => {
    expect(composeWarning({ userActiveThread: true })).toMatch(/open support thread/);
    expect(composeWarning({ sentToTargetInWindow: 1 })).toMatch(/already nudged/);
    expect(composeWarning({})).toBe(null);
  });
});
