// ── Support inbox — pure admin-side logic (Slice 3) ─────────────────────────
// Decision functions for the admin Support inbox, kept out of the component so
// they're Vitest-covered like the merge engine / money math (the build doc's
// "pure logic → Vitest" seam). No I/O here — AdminSupportSection.jsx owns the
// fetching (via supportAdminCall in data.js) and passes plain data in.

// The full §9.5 queue set (Slice 7). 'Active' = needs attention now (not
// snoozed, not closed); the status queues slice the rest of the lifecycle.
export const INBOX_FILTERS = [
  { key: 'active', label: 'Active' },
  { key: 'unassigned', label: 'Unassigned' },
  { key: 'mine', label: 'Mine' },
  { key: 'waiting', label: 'Waiting' },     // waiting on the user
  { key: 'snoozed', label: 'Snoozed' },
  { key: 'resolved', label: 'Resolved' },
  { key: 'archived', label: 'Archived' },
  { key: 'all', label: 'All' },
];

const CLOSED_STATUSES = ['resolved', 'archived'];
const PARKED_STATUSES = ['resolved', 'archived', 'snoozed']; // out of the active queues

// Which conversations a filter shows. `adminEmail` is the caller (for 'mine').
// Rows are assumed pre-sorted newest-activity-first by the backend; filtering
// never re-orders.
export function filterInbox(conversations, filter, adminEmail) {
  const rows = conversations || [];
  const email = (adminEmail || '').toLowerCase();
  switch (filter) {
    case 'unassigned':
      return rows.filter((c) => !c.assigned_admin && !PARKED_STATUSES.includes(c.status));
    case 'mine':
      return rows.filter((c) => (c.assigned_admin || '').toLowerCase() === email && !CLOSED_STATUSES.includes(c.status));
    case 'waiting':
      return rows.filter((c) => c.status === 'waiting_user');
    case 'snoozed':
      return rows.filter((c) => c.status === 'snoozed');
    case 'resolved':
      return rows.filter((c) => c.status === 'resolved');
    case 'archived':
      return rows.filter((c) => c.status === 'archived');
    case 'all':
      return rows;
    case 'active':
    default:
      return rows.filter((c) => !PARKED_STATUSES.includes(c.status));
  }
}

// Count for the filter chips' badges (unread lives on the active set only).
export function unreadAdminCount(conversations) {
  return (conversations || []).reduce((n, c) => n + (c.unread_admin || 0), 0);
}

// Short relative label ("just now" / "12m" / "3h" / "2d") for inbox rows and
// wait-time hints. `nowMs` injectable for tests.
export function timeAgo(iso, nowMs = Date.now()) {
  if (!iso) return '';
  const mins = Math.floor((nowMs - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

// timeAgo with the "ago" suffix, skipping it for "just now" (which already
// reads as a complete phrase — "just now ago" was shipping otherwise).
export function agoLabel(iso, nowMs = Date.now()) {
  const t = timeAgo(iso, nowMs);
  return t === 'just now' || t === '' ? t : `${t} ago`;
}

// Who a thread is "Handled by" — the caller sees "you" instead of their own
// email so the inbox reads naturally with two founders sharing it.
export function handledByLabel(assignedAdmin, callerEmail) {
  if (!assignedAdmin) return null;
  return assignedAdmin.toLowerCase() === (callerEmail || '').toLowerCase() ? 'you' : assignedAdmin;
}
