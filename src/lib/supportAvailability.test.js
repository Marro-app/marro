import { describe, it, expect } from 'vitest';
import { resolveAvailability, withinBusinessHours, availabilityLine, AVAILABLE_TIMEOUT_MINUTES } from './supportAvailability.js';

// 2026-08-05 17:00 UTC = 13:00 (1pm) in America/New_York (EDT) — inside 9–21.
const NOON_ET = Date.parse('2026-08-05T17:00:00Z');
// 2026-08-05 07:00 UTC = 3am ET — outside 9–21.
const NIGHT_ET = Date.parse('2026-08-05T07:00:00Z');
const HOURS = { tz: 'America/New_York', start: 9, end: 21 };

const minsAgo = (now, m) => new Date(now - m * 60000).toISOString();
const minsAhead = (now, m) => new Date(now + m * 60000).toISOString();

describe('withinBusinessHours', () => {
  it('detects in/out of hours in the configured tz', () => {
    expect(withinBusinessHours(NOON_ET, HOURS)).toBe(true);
    expect(withinBusinessHours(NIGHT_ET, HOURS)).toBe(false);
  });
  it('handles wrap-around windows (21 → 9)', () => {
    const wrap = { tz: 'America/New_York', start: 21, end: 9 };
    expect(withinBusinessHours(NIGHT_ET, wrap)).toBe(true);   // 3am ET
    expect(withinBusinessHours(NOON_ET, wrap)).toBe(false);   // 1pm ET
  });
});

describe('resolveAvailability', () => {
  it("override 'off' is always offline", () => {
    expect(resolveAvailability(NOON_ET, {
      online_override: 'off', business_hours: HOURS, last_admin_heartbeat: minsAgo(NOON_ET, 1),
    })).toEqual({ online: false, reason: 'override_off' });
  });

  it("override 'on' + fresh heartbeat = online", () => {
    expect(resolveAvailability(NIGHT_ET, {
      online_override: 'on', business_hours: HOURS, last_admin_heartbeat: minsAgo(NIGHT_ET, 5),
    })).toEqual({ online: true, reason: 'override_on' });
  });

  it("override 'on' with a stale signal auto-flips offline (the §3 timeout)", () => {
    expect(resolveAvailability(NOON_ET, {
      online_override: 'on', business_hours: HOURS,
      last_admin_heartbeat: minsAgo(NOON_ET, AVAILABLE_TIMEOUT_MINUTES + 5),
    })).toEqual({ online: false, reason: 'timed_out' });
  });

  it("override 'on' stays online through a future available_until (push quick-action)", () => {
    expect(resolveAvailability(NOON_ET, {
      online_override: 'on', business_hours: HOURS, available_until: minsAhead(NOON_ET, 30),
    })).toEqual({ online: true, reason: 'override_on' });
  });

  it('auto: outside hours is offline even with a fresh heartbeat', () => {
    expect(resolveAvailability(NIGHT_ET, {
      online_override: 'auto', business_hours: HOURS, last_admin_heartbeat: minsAgo(NIGHT_ET, 1),
    })).toEqual({ online: false, reason: 'outside_hours' });
  });

  it('auto: inside hours needs a fresh signal — hours alone never claim online', () => {
    expect(resolveAvailability(NOON_ET, {
      online_override: 'auto', business_hours: HOURS,
    })).toEqual({ online: false, reason: 'in_hours_quiet' });
    expect(resolveAvailability(NOON_ET, {
      online_override: 'auto', business_hours: HOURS, last_admin_heartbeat: minsAgo(NOON_ET, 3),
    })).toEqual({ online: true, reason: 'active' });
  });

  it('missing settings row resolves like auto with defaults (never throws)', () => {
    const r = resolveAvailability(NOON_ET, null);
    expect(typeof r.online).toBe('boolean');
  });
});

describe('availabilityLine', () => {
  it('maps online/offline/loading to the right copy', () => {
    expect(availabilityLine({ online: true, reason: 'active' })).toMatch(/online/);
    expect(availabilityLine({ online: false, reason: 'timed_out' })).toBe('We usually reply within a day');
    expect(availabilityLine(null)).toBe('We usually reply within a day');
  });
});
