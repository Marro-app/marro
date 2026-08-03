// ── Automatic usage analytics (global click capture, supabase/analytics.sql) ─
// Goal: every button/feature click gets recorded with ZERO per-feature
// instrumentation, so newly added features are tracked automatically without
// anyone adding a logEvent() call site for them. This is separate from the
// existing hand-instrumented events (`logEvent()` in src/lib/data.js, e.g.
// 'login'/'tab_view'/'setup_finished') — those stay untouched.
//
// How it works: one delegated, capture-phase click listener on `document`
// (installed once, idempotent — see installAnalytics()). On every click it
// walks up from event.target to the nearest interactive element, derives a
// SAFE identifier for it, and queues a `ui_click` event. Queued events are
// batched and flushed as a single multi-row insert (see flush()) rather than
// one row per click.
//
// DATA ETHICS (docs/DATA_ETHICS.md) — this module must never capture:
//   - dollar amounts / balances (digits + currency symbols are stripped from
//     whatever text is used as the identifier — button labels routinely
//     contain live $ figures, e.g. "Pay $1,234.56")
//   - free-typed user text: we NEVER read the value of any input/textarea/
//     select or contenteditable element. The one narrow exception is
//     <input type="submit"|"button">, whose `value` is a static label the
//     developer wrote (the HTML equivalent of a <button>'s text content),
//     not something the user typed — see deriveIdentifier().
//   - anything beyond minimal structural context: metadata is just
//     {el, tag, tab} (+ an optional dedup count `n`).
//
// Fails silently everywhere — analytics must never break the app.

import { getSupabase } from './data.js';

const FLUSH_INTERVAL_MS = 15000;
const MAX_IDENTIFIER_LEN = 40;

// Walk up to the nearest thing a user would call a "button" or "link",
// including anything an engineer explicitly opts in with data-analytics.
const INTERACTIVE_SELECTOR =
  'button, a, [role="button"], input[type="submit"], input[type="button"], summary, label, [data-analytics]';

let installed = false;
let context = { tab: 'landing' };
let queue = new Map(); // key (event_name + JSON metadata sans count) -> {event_name, metadata, count}
let flushTimer = null;

// Called by App.jsx whenever the active tab changes (piggybacks the existing
// tab_view useEffect) so subsequent clicks carry the right tab. Defaults to
// "landing" for the logged-out marketing page, where App.jsx never mounts.
export function setAnalyticsContext(next) {
  context = { ...context, ...next };
}

// ── Identifier sanitization ───────────────────────────────────────────────
// Strips digits/currency symbols (button text routinely contains live $
// amounts), collapses whitespace, lowercases, slugifies, and caps length.
// Exported for testing.
export function sanitizeIdentifier(raw) {
  if (raw == null) return '';
  let s = String(raw);
  s = s.replace(/[0-9]/g, '');                 // strip all digits
  s = s.replace(/[$€£¥₹¢]/g, '');               // strip currency symbols
  s = s.toLowerCase();
  s = s.replace(/[^a-z\s-]/g, ' ');             // drop remaining punctuation/symbols
  s = s.trim().replace(/\s+/g, ' ');
  s = s.replace(/\s+/g, '-');
  if (s.length > MAX_IDENTIFIER_LEN) {
    s = s.slice(0, MAX_IDENTIFIER_LEN).replace(/-+$/, '');
  }
  return s;
}

// Priority: data-analytics attribute → aria-label → name/id → visible text.
// Exported for testing.
export function deriveIdentifier(el) {
  if (!el || !el.getAttribute) return '';
  const dataAttr = el.getAttribute('data-analytics');
  if (dataAttr) return sanitizeIdentifier(dataAttr);

  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel) return sanitizeIdentifier(ariaLabel);

  const nameOrId = el.getAttribute('name') || el.id || '';
  if (nameOrId) return sanitizeIdentifier(nameOrId);

  const tag = (el.tagName || '').toLowerCase();
  if (tag === 'input') {
    // Text/textarea-like inputs never reach here for identification — the
    // only inputs matched by INTERACTIVE_SELECTOR are submit/button, whose
    // `value` is a static developer-set label, not free-typed user data.
    const type = (el.getAttribute('type') || '').toLowerCase();
    if (type === 'submit' || type === 'button') {
      return sanitizeIdentifier(el.value || '');
    }
    return '';
  }

  return sanitizeIdentifier(el.textContent || '');
}

function queueEvent(eventName, metadata) {
  const key = eventName + '|' + JSON.stringify(metadata);
  const existing = queue.get(key);
  if (existing) existing.count += 1;
  else queue.set(key, { event_name: eventName, metadata, count: 1 });
}

function handleClick(e) {
  try {
    const target = e.target;
    if (!target || typeof target.closest !== 'function') return;
    if (target.closest('[data-analytics-off]')) return;

    const el = target.closest(INTERACTIVE_SELECTOR);
    if (!el) return;
    if (el.closest('[data-analytics-off]')) return;

    const identifier = deriveIdentifier(el);
    if (!identifier) return;

    const tag = (el.tagName || '').toLowerCase();
    queueEvent('ui_click', { el: identifier, tag, tab: context.tab });
  } catch {
    /* analytics must never break the app */
  }
}

// Flushes the queue as a single multi-row insert. Best-effort: any failure
// (offline, RLS, network) is swallowed — analytics must never surface an
// error to the user or affect the feature they were using.
async function flush() {
  if (queue.size === 0) return;
  const batch = Array.from(queue.values());
  queue = new Map();
  try {
    const sb = await getSupabase();
    const { data: { user } = {} } = await sb.auth.getUser();
    const rows = batch.map(({ event_name, metadata, count }) => ({
      user_id: user ? user.id : null, // null = anonymous (logged-out landing) click — see supabase/analytics.sql
      event_name,
      metadata: count > 1 ? { ...metadata, n: count } : metadata,
    }));
    await sb.from('events').insert(rows);
  } catch {
    /* best-effort only */
  }
}

// Installs the global delegated click listener + batch flush timers. Safe to
// call more than once (idempotent) — main.jsx calls it once after boot.
export function installAnalytics() {
  if (installed) return;
  installed = true;

  document.addEventListener('click', handleClick, true); // capture phase

  flushTimer = setInterval(flush, FLUSH_INTERVAL_MS);

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) flush();
  });
  window.addEventListener('pagehide', () => { flush(); });
}

// Test-only escape hatch — resets module singleton state between tests.
export function _resetForTests() {
  installed = false;
  context = { tab: 'landing' };
  queue = new Map();
  if (flushTimer) clearInterval(flushTimer);
  flushTimer = null;
}
