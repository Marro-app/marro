// ── Support availability — pure resolver (Slice 6, plan §3) ─────────────────
// Turns the single support_settings row into one honest online/offline answer
// for the chat panel's status line. Pure and injectable (nowMs) so the truth
// table is Vitest-covered; both the client status line and the server-side
// reassurance gate (api/support-notify.js) import THIS function, so the "are
// we around?" answer can never diverge between them.
//
// The model (multi-signal, "never falsely advertise presence"):
//   override 'off'  → offline, always.
//   override 'on'   → online only while the signal is FRESH: a heartbeat
//                     within AVAILABLE_TIMEOUT_MINUTES or a future
//                     available_until. Signal gone stale → offline (the §3
//                     inactivity auto-flip).
//   'auto' (default)→ outside business hours: offline. Inside hours: online
//                     only with a fresh signal (an admin actually has the
//                     console open) — hours alone never claim "we're online".

export const AVAILABLE_TIMEOUT_MINUTES = 20;
export const DEFAULT_BUSINESS_HOURS = { tz: 'America/New_York', start: 9, end: 21 };

// Local hour (0–23) in the settings' timezone. Falls back to UTC if the tz
// string is invalid — better a slightly-off hours check than a crash.
export function hourInTz(nowMs, tz) {
  try {
    return Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: tz })
      .format(new Date(nowMs))) % 24;
  } catch {
    return new Date(nowMs).getUTCHours();
  }
}

export function withinBusinessHours(nowMs, hours) {
  const h = { ...DEFAULT_BUSINESS_HOURS, ...(hours || {}) };
  const hour = hourInTz(nowMs, h.tz);
  if (h.start === h.end) return true;              // degenerate config = always in-hours
  if (h.start < h.end) return hour >= h.start && hour < h.end;
  return hour >= h.start || hour < h.end;          // wrap-around (e.g. 21 → 9)
}

function signalFresh(nowMs, settings) {
  const hb = settings?.last_admin_heartbeat ? new Date(settings.last_admin_heartbeat).getTime() : null;
  if (hb != null && nowMs - hb < AVAILABLE_TIMEOUT_MINUTES * 60000) return true;
  const until = settings?.available_until ? new Date(settings.available_until).getTime() : null;
  return until != null && nowMs < until;
}

// → { online: boolean, reason: string } — reason feeds the admin pill/debugging,
// the user only ever sees the boolean's copy.
export function resolveAvailability(nowMs, settings) {
  const s = settings || {};
  if (s.online_override === 'off') return { online: false, reason: 'override_off' };
  if (s.online_override === 'on') {
    return signalFresh(nowMs, s)
      ? { online: true, reason: 'override_on' }
      : { online: false, reason: 'timed_out' };
  }
  // 'auto' (or missing settings row)
  if (!withinBusinessHours(nowMs, s.business_hours)) return { online: false, reason: 'outside_hours' };
  return signalFresh(nowMs, s)
    ? { online: true, reason: 'active' }
    : { online: false, reason: 'in_hours_quiet' };
}

// Status-line copy for the user panel. Availability may be null while loading.
export function availabilityLine(availability) {
  return availability?.online
    ? "We're online — expect a quick reply"
    : 'We usually reply within a day';
}
