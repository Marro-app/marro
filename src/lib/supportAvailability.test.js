import { describe, it, expect } from 'vitest';
import {
  resolveAvailability, resolveTeamAvailability, withinBusinessHours, dayKeyInTz,
  availabilityLine, AVAILABLE_TIMEOUT_MINUTES,
} from './supportAvailability.js';

// 2026-08-05 is a Wednesday.
// 2026-08-05 17:00 UTC = 13:00 (1pm) in America/New_York (EDT) — inside 9–21.
const NOON_ET = Date.parse('2026-08-05T17:00:00Z');
// 2026-08-05 07:00 UTC = 3am ET — outside 9–21.
const NIGHT_ET = Date.parse('2026-08-05T07:00:00Z');
const WED_HOURS = { tz: 'America/New_York', wed: [{ start: 9, end: 21 }] };

const minsAgo = (now, m) => new Date(now - m * 60000).toISOString();
const minsAhead = (now, m) => new Date(now + m * 60000).toISOString();

describe('dayKeyInTz', () => {
  it('resolves the day-of-week key in the given timezone', () => {
    expect(dayKeyInTz(NOON_ET, 'America/New_York')).toBe('wed');
  });
});

describe('withinBusinessHours', () => {
  it('detects in/out of hours for the current day in the configured tz', () => {
    expect(withinBusinessHours(NOON_ET, WED_HOURS)).toBe(true);
    expect(withinBusinessHours(NIGHT_ET, WED_HOURS)).toBe(false);
  });

  it('a day with no blocks is fully offline that day, even during the "usual" window', () => {
    expect(withinBusinessHours(NOON_ET, { tz: 'America/New_York', wed: [] })).toBe(false);
  });

  it('supports multiple blocks in one day (split shift)', () => {
    const split = { tz: 'America/New_York', wed: [{ start: 9, end: 12 }, { start: 14, end: 18 }] };
    const NINE_AM_ET = Date.parse('2026-08-05T13:30:00Z');  // 9:30am ET
    const ONE_PM_ET = Date.parse('2026-08-05T17:30:00Z');   // 1:30pm ET — the gap
    const THREE_PM_ET = Date.parse('2026-08-05T19:00:00Z'); // 3pm ET
    expect(withinBusinessHours(NINE_AM_ET, split)).toBe(true);
    expect(withinBusinessHours(ONE_PM_ET, split)).toBe(false);
    expect(withinBusinessHours(THREE_PM_ET, split)).toBe(true);
  });

  it('different days can have entirely different schedules', () => {
    // 2026-08-08 is a Saturday, same wall-clock hour as NOON_ET.
    const SAT_NOON_ET = Date.parse('2026-08-08T17:00:00Z');
    const weekdaysOnly = { tz: 'America/New_York', wed: [{ start: 9, end: 21 }], sat: [] };
    expect(withinBusinessHours(NOON_ET, weekdaysOnly)).toBe(true);
    expect(withinBusinessHours(SAT_NOON_ET, weekdaysOnly)).toBe(false);
  });

  it('missing day falls back to the sensible 9-21 default for that day', () => {
    expect(withinBusinessHours(NOON_ET, { tz: 'America/New_York' })).toBe(true);
  });
});

describe('resolveAvailability (per-admin row)', () => {
  it("override 'off' is always offline", () => {
    expect(resolveAvailability(NOON_ET, {
      online_override: 'off', business_hours: WED_HOURS, last_heartbeat: minsAgo(NOON_ET, 1),
    })).toEqual({ online: false, reason: 'override_off' });
  });

  it("override 'on' + fresh heartbeat = online", () => {
    expect(resolveAvailability(NIGHT_ET, {
      online_override: 'on', business_hours: WED_HOURS, last_heartbeat: minsAgo(NIGHT_ET, 5),
    })).toEqual({ online: true, reason: 'override_on' });
  });

  it("override 'on' with a stale signal auto-flips offline (the §3 timeout)", () => {
    expect(resolveAvailability(NOON_ET, {
      online_override: 'on', business_hours: WED_HOURS,
      last_heartbeat: minsAgo(NOON_ET, AVAILABLE_TIMEOUT_MINUTES + 5),
    })).toEqual({ online: false, reason: 'timed_out' });
  });

  it("override 'on' stays online through a future available_until (push quick-action)", () => {
    expect(resolveAvailability(NOON_ET, {
      online_override: 'on', business_hours: WED_HOURS, available_until: minsAhead(NOON_ET, 30),
    })).toEqual({ online: true, reason: 'override_on' });
  });

  it('auto: outside hours is offline even with a fresh heartbeat', () => {
    expect(resolveAvailability(NIGHT_ET, {
      online_override: 'auto', business_hours: WED_HOURS, last_heartbeat: minsAgo(NIGHT_ET, 1),
    })).toEqual({ online: false, reason: 'outside_hours' });
  });

  it('auto: inside hours needs a fresh signal — hours alone never claim online', () => {
    expect(resolveAvailability(NOON_ET, {
      online_override: 'auto', business_hours: WED_HOURS,
    })).toEqual({ online: false, reason: 'in_hours_quiet' });
    expect(resolveAvailability(NOON_ET, {
      online_override: 'auto', business_hours: WED_HOURS, last_heartbeat: minsAgo(NOON_ET, 3),
    })).toEqual({ online: true, reason: 'active' });
  });

  it('missing row resolves like auto with defaults (never throws)', () => {
    const r = resolveAvailability(NOON_ET, null);
    expect(typeof r.online).toBe('boolean');
  });
});

describe('resolveTeamAvailability', () => {
  it('online if ANY admin is currently online, offline only if all are', () => {
    const rows = [
      { admin_email: 'away@marro.app', online_override: 'off' },
      { admin_email: 'here@marro.app', online_override: 'on', last_heartbeat: minsAgo(NOON_ET, 1) },
    ];
    expect(resolveTeamAvailability(NOON_ET, rows)).toEqual({ online: true, onlineAdmins: ['here@marro.app'] });
  });

  it('offline when every admin is offline', () => {
    const rows = [
      { admin_email: 'a@marro.app', online_override: 'off' },
      { admin_email: 'b@marro.app', online_override: 'off' },
    ];
    expect(resolveTeamAvailability(NOON_ET, rows)).toEqual({ online: false, onlineAdmins: [] });
  });

  it('no rows at all resolves offline, not a crash', () => {
    expect(resolveTeamAvailability(NOON_ET, [])).toEqual({ online: false, onlineAdmins: [] });
    expect(resolveTeamAvailability(NOON_ET, null)).toEqual({ online: false, onlineAdmins: [] });
  });
});

describe('availabilityLine', () => {
  it('maps online/offline/loading to the right copy', () => {
    expect(availabilityLine({ online: true, reason: 'active' })).toMatch(/online/);
    expect(availabilityLine({ online: false, reason: 'timed_out' })).toBe('We usually reply within a day');
    expect(availabilityLine(null)).toBe('We usually reply within a day');
  });
});
