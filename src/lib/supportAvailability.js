// ── Support availability — pure resolver (Slice 6, extended) ────────────────
// Each admin has their OWN row (support_admin_availability, keyed by email):
// their own override, their own per-day/timezone business-hour blocks, their
// own heartbeat. The team is "online" if ANY admin currently resolves online
// — resolveTeamAvailability is what the user-facing status line and the
// server-side reassurance gate (api/support-notify.js) both call, so the
// "are we around?" answer can never diverge between them.
//
// Per-admin model (multi-signal, "never falsely advertise presence"):
//   override 'off'  → offline, always.
//   override 'on'   → online only while the signal is FRESH: a heartbeat
//                     within AVAILABLE_TIMEOUT_MINUTES or a future
//                     available_until. Signal gone stale → offline (the §3
//                     inactivity auto-flip).
//   'auto' (default)→ outside THIS admin's business hours: offline. Inside
//                     hours: online only with a fresh signal (this admin
//                     actually has the console open) — hours alone never
//                     claim "we're online".

export const AVAILABLE_TIMEOUT_MINUTES = 20;

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
// Every day, 9am-9pm — matches the single-schedule default this replaces, so
// an admin who hasn't customized anything behaves exactly as before.
export const DEFAULT_BUSINESS_HOURS = {
  tz: 'America/New_York',
  mon: [{ start: 9, end: 21 }], tue: [{ start: 9, end: 21 }], wed: [{ start: 9, end: 21 }],
  thu: [{ start: 9, end: 21 }], fri: [{ start: 9, end: 21 }], sat: [{ start: 9, end: 21 }],
  sun: [{ start: 9, end: 21 }],
};

// Local hour (0–23) in the given timezone. Falls back to UTC if the tz
// string is invalid — better a slightly-off hours check than a crash.
export function hourInTz(nowMs, tz) {
  try {
    return Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: tz })
      .format(new Date(nowMs))) % 24;
  } catch {
    return new Date(nowMs).getUTCHours();
  }
}

// Day-of-week key ('sun'..'sat') in the given timezone.
export function dayKeyInTz(nowMs, tz) {
  try {
    const short = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: tz }).format(new Date(nowMs));
    return DAY_KEYS.find((k) => short.toLowerCase().startsWith(k)) || DAY_KEYS[new Date(nowMs).getUTCDay()];
  } catch {
    return DAY_KEYS[new Date(nowMs).getUTCDay()];
  }
}

// `businessHours` = { tz, mon: [{start,end}], tue: [...], ... }. Each day's
// value is a list of [start,end) hour blocks (0-23, no overnight wrap — a
// block that should span midnight is just two entries, e.g. today's
// 22-24 doesn't exist; use two adjacent day schedules instead). An empty or
// missing day = not working that day. Missing days/tz fall back per-field to
// the default schedule, so a partially-customized schedule still behaves
// sensibly for the days the admin hasn't touched.
export function withinBusinessHours(nowMs, businessHours) {
  const h = businessHours || {};
  const tz = h.tz || DEFAULT_BUSINESS_HOURS.tz;
  const dayKey = dayKeyInTz(nowMs, tz);
  const blocks = h[dayKey] !== undefined ? h[dayKey] : DEFAULT_BUSINESS_HOURS[dayKey];
  const hour = hourInTz(nowMs, tz);
  return (blocks || []).some((b) => b && Number.isFinite(b.start) && Number.isFinite(b.end)
    && b.start < b.end && hour >= b.start && hour < b.end);
}

function signalFresh(nowMs, row) {
  const hb = row?.last_heartbeat ? new Date(row.last_heartbeat).getTime() : null;
  if (hb != null && nowMs - hb < AVAILABLE_TIMEOUT_MINUTES * 60000) return true;
  const until = row?.available_until ? new Date(row.available_until).getTime() : null;
  return until != null && nowMs < until;
}

// → { online: boolean, reason: string } for ONE admin's row. `reason` feeds
// the admin's own status pill/debugging; the user only ever sees the
// combined boolean's copy (availabilityLine).
export function resolveAvailability(nowMs, row) {
  const s = row || {};
  if (s.online_override === 'off') return { online: false, reason: 'override_off' };
  if (s.online_override === 'on') {
    return signalFresh(nowMs, s)
      ? { online: true, reason: 'override_on' }
      : { online: false, reason: 'timed_out' };
  }
  // 'auto' (or missing row)
  if (!withinBusinessHours(nowMs, s.business_hours)) return { online: false, reason: 'outside_hours' };
  return signalFresh(nowMs, s)
    ? { online: true, reason: 'active' }
    : { online: false, reason: 'in_hours_quiet' };
}

// Team-wide answer: online if ANY admin's row currently resolves online.
// → { online: boolean, onlineAdmins: string[] } (emails of whoever's up).
export function resolveTeamAvailability(nowMs, rows) {
  const onlineAdmins = (rows || [])
    .filter((r) => resolveAvailability(nowMs, r).online)
    .map((r) => r.admin_email);
  return { online: onlineAdmins.length > 0, onlineAdmins };
}

// Status-line copy for the user panel. Availability may be null while loading.
export function availabilityLine(availability) {
  return availability?.online
    ? "We're online — expect a quick reply"
    : 'We usually reply within a day';
}
