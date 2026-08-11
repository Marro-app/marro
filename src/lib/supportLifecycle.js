// ── Support lifecycle — pure transition rules (Slice 7, plan §9.5) ──────────
// The status machine for support conversations, kept pure so the truth table
// is Vitest-covered and shared verbatim by the admin backend (api/support.js
// imports this) and the console UI (which buttons to show). No I/O here.
//
//   new → open (auto-claim) → waiting_user ⇄ open → resolved → archived
//   plus snoozed (returns at snooze_until) and auto-reopen (a user reply to a
//   resolved/archived thread flips it back to open — enforced in the user RPC).

export const STATUSES = ['new', 'open', 'waiting_user', 'snoozed', 'resolved', 'archived'];

// Where each status may go via an ADMIN action. (User-side auto-reopen is the
// RPC's job and intentionally not modeled here.)
const TRANSITIONS = {
  new: ['open', 'waiting_user', 'snoozed', 'resolved', 'archived'],
  open: ['waiting_user', 'snoozed', 'resolved', 'archived'],
  waiting_user: ['open', 'snoozed', 'resolved', 'archived'],
  snoozed: ['open', 'waiting_user', 'resolved', 'archived'],
  resolved: ['open', 'archived'],
  archived: ['open'],
};

export function canTransition(from, to) {
  if (!STATUSES.includes(to)) return false;
  return (TRANSITIONS[from] || []).includes(to);
}

// The support_events action name a transition logs (metrics read these).
export function eventForTransition(to, from) {
  if (to === 'resolved') return 'resolved';
  if (to === 'archived') return 'archived';
  if (to === 'snoozed') return 'snoozed';
  if (to === 'open' && (from === 'resolved' || from === 'archived' || from === 'snoozed')) return 'reopened';
  return 'status_changed';
}

// Lazy maintenance sweep run by the backend on every inbox list (no cron
// infra needed yet — plan allows computing this lazily):
//   • a snoozed thread whose snooze_until has passed wakes to 'open'
//   • a resolved thread older than archiveAfterDays is tucked into 'archived'
// Returns [{id, patch, event}] — the caller applies + logs each.
export const AUTO_ARCHIVE_DAYS = 30;
export function sweep(conversations, nowMs, { archiveAfterDays = AUTO_ARCHIVE_DAYS } = {}) {
  const out = [];
  for (const c of conversations || []) {
    if (c.status === 'snoozed' && c.snooze_until && new Date(c.snooze_until).getTime() <= nowMs) {
      // assigned_admin rides along so a caller (the cron) can notify the
      // right person on wake without a second lookup — sweep() over
      // conversations already has it in hand.
      out.push({ id: c.id, patch: { status: 'open', snooze_until: null }, event: 'reopened', assigned_admin: c.assigned_admin || null });
    } else if (c.status === 'resolved' && c.resolved_at
        && nowMs - new Date(c.resolved_at).getTime() > archiveAfterDays * 86400000) {
      out.push({ id: c.id, patch: { status: 'archived', archived_at: new Date(nowMs).toISOString() }, event: 'archived' });
    }
  }
  return out;
}

// ── Snooze duration (plan revision — quick presets + a custom date/time) ────
// Quick-pick chips the console offers, plus a "custom" datetime-local escape
// hatch. Kept as minutes (not hours) so the short presets are representable.
export const SNOOZE_PRESETS = [
  { minutes: 15, label: '15 min' },
  { minutes: 30, label: '30 min' },
  { minutes: 60, label: '1 hour' },
  { minutes: 60 * 24, label: '1 day' },
];
export const SNOOZE_MIN_MINUTES = 5;
export const SNOOZE_MAX_MINUTES = 90 * 24 * 60; // 90-day sanity cap on a custom date

// Turns either a preset (`minutes`) or a custom target (`until`, any
// Date-parseable value — the datetime-local input's value works directly)
// into the snooze_until timestamp to store. `until` wins when it parses to a
// real future time; otherwise falls back to `minutes` (defaulting to 1 day).
// Never throws — a bad/past custom date silently falls back rather than
// blocking the action.
export function resolveSnoozeUntil(nowMs, { minutes, until } = {}) {
  if (until) {
    const t = new Date(until).getTime();
    if (!Number.isNaN(t) && t > nowMs) {
      return new Date(Math.min(t, nowMs + SNOOZE_MAX_MINUTES * 60000)).toISOString();
    }
  }
  const m = Math.max(SNOOZE_MIN_MINUTES, Math.min(SNOOZE_MAX_MINUTES, parseInt(minutes, 10) || 60 * 24));
  return new Date(nowMs + m * 60000).toISOString();
}

// "unanswered 3h" chip for inbox rows: an active thread no admin has ever
// replied to, aged from its creation. Null when it doesn't apply.
export function waitingLabel(convo, nowMs = Date.now()) {
  if (!convo || convo.first_response_at) return null;
  if (!['new', 'open'].includes(convo.status)) return null;
  const mins = Math.floor((nowMs - new Date(convo.created_at).getTime()) / 60000);
  if (mins < 5) return null; // fresh — a chip would just be noise
  if (mins < 60) return `unanswered ${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `unanswered ${hrs}h`;
  return `unanswered ${Math.floor(hrs / 24)}d`;
}
