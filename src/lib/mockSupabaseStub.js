// ── Dev-only test harness: in-memory Supabase stand-in ──────────────────────
// Reached ONLY via dynamic import() from `getSupabase()` in `lib/data.js`,
// itself gated on `isMockModeActive()`. This object implements just enough
// of the supabase-js surface (auth.*, from().*, rpc()) that the REAL app
// code paths — stateFetch/stateWrite/isEmailAllowed/isAdmin/logEvent, the
// profile fetch, sign-out — all run completely unmodified against it. It
// never opens a network connection, never imports @supabase/supabase-js,
// and never sees a real credential. All "tables" are plain in-memory arrays
// that live for the lifetime of the tab and reset on reload.
import { MOCK_SESSION, MOCK_PROFILE, MOCK_USER_ID, MOCK_EMAIL, buildMockState, buildMockSupport } from './mockSessionData.js';
import { resolveSnoozeUntil } from './supportLifecycle.js';

function makeQueryBuilder(table, store) {
  let op = { kind: 'select' };
  const filters = [];
  let orderSpec = null;
  const builder = {
    select: () => builder,
    insert: (payload) => { op = { kind: 'insert', payload }; return builder; },
    upsert: (payload) => { op = { kind: 'upsert', payload }; return builder; },
    update: (payload) => { op = { kind: 'update', payload }; return builder; },
    eq: (col, val) => { filters.push([col, val]); return builder; },
    // Records the sort so support reads (messages oldest-first, convos newest-
    // first) come back ordered the way the real DB would return them.
    order: (col, opts) => { orderSpec = { col, ascending: opts?.ascending !== false }; return builder; },
    limit: () => builder,
    resolve() {
      const rows = store[table] || (store[table] = []);
      if (op.kind === 'insert') {
        const row = { ...op.payload };
        rows.push(row);
        return { data: [row], error: null };
      }
      if (op.kind === 'upsert') {
        const row = { ...op.payload };
        const key = row.user_id ?? MOCK_USER_ID;
        const idx = rows.findIndex((r) => (r.user_id ?? MOCK_USER_ID) === key);
        if (idx >= 0) rows[idx] = { ...rows[idx], ...row };
        else rows.push(row);
        return { data: [row], error: null };
      }
      let matched = rows;
      filters.forEach(([col, val]) => { matched = matched.filter((r) => r[col] === val); });
      // RLS parity (Slice 9): the USER lane never sees internal notes — the
      // real policy excludes them; user-side reads here go through from(),
      // while the admin lane (mockApi 'thread') reads the store directly.
      if (table === 'support_messages' && op.kind === 'select') {
        matched = matched.filter((r) => !r.is_internal_note);
      }
      if (op.kind === 'update') {
        matched.forEach((r) => Object.assign(r, op.payload));
        return { data: matched, error: null };
      }
      if (orderSpec) {
        const { col, ascending } = orderSpec;
        matched = [...matched].sort((a, b) => {
          if (a[col] === b[col]) return 0;
          const cmp = a[col] > b[col] ? 1 : -1;
          return ascending ? cmp : -cmp;
        });
      }
      return { data: matched, error: null }; // select
    },
    maybeSingle: async () => { const { data, error } = builder.resolve(); return { data: data?.[0] ?? null, error }; },
    single: async () => { const { data, error } = builder.resolve(); return { data: data?.[0] ?? null, error }; },
    then: (onFulfilled, onRejected) => Promise.resolve(builder.resolve()).then(onFulfilled, onRejected),
  };
  return builder;
}

// Cheap unique id for mock rows — crypto.randomUUID in modern browsers, with a
// deterministic-enough fallback. Only ever runs in the dev harness.
function mockId() {
  try { return crypto.randomUUID(); } catch { return 'mock-' + Math.random().toString(16).slice(2) + Date.now().toString(16); }
}

// ── In-memory Realtime emulation (Slice 4) ──────────────────────────────────
// Just enough of supabase-js's channel API (channel().on('postgres_changes',
// spec, cb).subscribe() / removeChannel()) that the real subscribe helpers in
// src/lib/support.js run unmodified. Mutations in supportRpc/mockApi call
// emitRealtime() so a user message lights up the admin inbox live (and vice
// versa) with zero backend. Registry is module-scope: one page = one bus.
const rtChannels = new Set();
function emitRealtime(table, eventType, row) {
  // Async like the real thing — never re-enters React mid-update.
  setTimeout(() => { rtChannels.forEach((ch) => ch._dispatch(table, eventType, row)); }, 0);
}
function makeChannel() {
  const ch = {
    _handlers: [],
    on(_type, spec, cb) { ch._handlers.push({ spec, cb }); return ch; },
    subscribe(cb) { rtChannels.add(ch); if (cb) cb('SUBSCRIBED'); return ch; },
    unsubscribe() { rtChannels.delete(ch); },
    // Presence (Slice 8) is not emulated — joinSupportPresence() detects the
    // missing methods... except they exist here as inert stubs so any direct
    // caller degrades gracefully. presenceState() is always empty: a one-tab
    // harness has no second admin to show anyway.
    track() {},
    presenceState() { return {}; },
    _dispatch(table, eventType, row) {
      ch._handlers.forEach(({ spec, cb }) => {
        if (spec.table !== table) return;
        if (spec.event !== '*' && spec.event !== eventType) return;
        if (spec.filter) {
          const m = /^(\w+)=eq\.(.+)$/.exec(spec.filter);
          if (m && String(row[m[1]]) !== m[2]) return;
        }
        cb({ eventType, new: { ...row } });
      });
    },
  };
  return ch;
}

// In-memory implementation of the Slice-1 support RPCs, mirroring the SQL
// semantics in supabase/support_chat.sql closely enough that the real
// src/lib/support.js code paths behave identically against the harness:
// start creates a convo + first user message (unread_admin=1); post appends,
// bumps unread_admin/last_message_at, and auto-reopens a closed thread; mark
// zeroes unread_user. All scoped to the mock user.
function supportRpc(name, params, store) {
  const convos = store.support_conversations || (store.support_conversations = []);
  const msgs = store.support_messages || (store.support_messages = []);
  const now = () => new Date().toISOString();
  if (name === 'support_start_conversation') {
    const validType = ['bug', 'feedback', 'question', 'billing', 'other'];
    const type = validType.includes(params?.p_type) ? params.p_type : 'question';
    const body = (params?.p_body || '').trim();
    if (!body) return { data: null, error: { message: 'message body required' } };
    // Single active Question: continue the existing open chat instead of a dupe.
    if (type === 'question') {
      const active = convos
        .filter((c) => c.user_id === MOCK_USER_ID && c.type === 'question' && ['new', 'open', 'waiting_user'].includes(c.status))
        .sort((a, b) => new Date(b.last_message_at) - new Date(a.last_message_at))[0];
      if (active) {
        const m = { id: mockId(), conversation_id: active.id, sender: 'user', sender_email: null, body, attachments: params?.p_attachments ?? null, is_internal_note: false, created_at: now(), read_at: null };
        msgs.push(m);
        active.last_message_at = now();
        active.unread_admin += 1;
        emitRealtime('support_messages', 'INSERT', m);
        emitRealtime('support_conversations', 'UPDATE', active);
        return { data: active.id, error: null };
      }
    }
    const id = mockId();
    convos.push({
      id, user_id: MOCK_USER_ID, status: 'new', type, priority: 'normal',
      subject: body.slice(0, 80), tags: null, tech_context: params?.p_tech_context ?? null,
      assigned_admin: null, linked_issue_url: null, csat: null, csat_comment: null,
      unread_admin: 1, unread_user: 0, reopen_count: 0,
      created_at: now(), last_message_at: now(), claimed_at: null, first_response_at: null,
      resolved_at: null, resolved_by: null, archived_at: null, snooze_until: null,
    });
    const first = { id: mockId(), conversation_id: id, sender: 'user', sender_email: null, body, attachments: params?.p_attachments ?? null, is_internal_note: false, created_at: now(), read_at: null };
    msgs.push(first);
    emitRealtime('support_conversations', 'INSERT', convos[convos.length - 1]);
    emitRealtime('support_messages', 'INSERT', first);
    return { data: id, error: null };
  }
  if (name === 'support_post_user_message') {
    const convo = convos.find((c) => c.id === params?.p_conversation_id && c.user_id === MOCK_USER_ID);
    if (!convo) return { data: null, error: { message: 'conversation not found' } };
    const body = (params?.p_body || '').trim();
    if (!body) return { data: null, error: { message: 'message body required' } };
    const mid = mockId();
    const m = { id: mid, conversation_id: convo.id, sender: 'user', sender_email: null, body, attachments: params?.p_attachments ?? null, is_internal_note: false, created_at: now(), read_at: null };
    msgs.push(m);
    convo.last_message_at = now();
    convo.unread_admin += 1;
    if (convo.status === 'resolved' || convo.status === 'archived') {
      convo.status = 'open'; convo.reopen_count += 1; convo.archived_at = null;
    } else if (convo.status === 'waiting_user' || convo.status === 'snoozed') {
      convo.status = 'open'; convo.snooze_until = null;
    }
    emitRealtime('support_messages', 'INSERT', m);
    emitRealtime('support_conversations', 'UPDATE', convo);
    return { data: mid, error: null };
  }
  if (name === 'support_mark_read') {
    const convo = convos.find((c) => c.id === params?.p_conversation_id && c.user_id === MOCK_USER_ID);
    if (convo) { convo.unread_user = 0; emitRealtime('support_conversations', 'UPDATE', convo); }
    return { data: null, error: null };
  }
  if (name === 'support_archive_conversation') {
    const convo = convos.find((c) => c.id === params?.p_conversation_id && c.user_id === MOCK_USER_ID);
    if (convo) {
      convo.status = 'archived'; convo.archived_at = now(); convo.resolved_at = convo.resolved_at || now();
      emitRealtime('support_conversations', 'UPDATE', convo);
    }
    return { data: null, error: null };
  }
  if (name === 'support_reopen_conversation') {
    const convo = convos.find((c) => c.id === params?.p_conversation_id && c.user_id === MOCK_USER_ID);
    if (convo && (convo.status === 'resolved' || convo.status === 'archived')) {
      convo.status = 'open'; convo.archived_at = null; convo.reopen_count += 1;
      emitRealtime('support_conversations', 'UPDATE', convo);
    }
    return { data: null, error: null };
  }
  if (name === 'support_metrics_overview') {
    const winMs = (params?.p_days || 30) * 86400000;
    const inWin = convos.filter((c) => Date.now() - new Date(c.created_at) < winMs);
    const secs = (a, b) => (new Date(a) - new Date(b)) / 1000;
    const percentile = (arr, p) => {
      if (!arr.length) return null;
      const sorted = [...arr].sort((x, y) => x - y);
      return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
    };
    const fr = inWin.filter((c) => c.first_response_at).map((c) => secs(c.first_response_at, c.created_at));
    const rs = inWin.filter((c) => c.resolved_at).map((c) => secs(c.resolved_at, c.created_at));
    const cl = inWin.filter((c) => c.claimed_at).map((c) => secs(c.claimed_at, c.created_at));
    return { data: [{
      new_conversations: inWin.length,
      open_backlog: convos.filter((c) => ['new', 'open', 'waiting_user', 'snoozed'].includes(c.status)).length,
      deferred_unanswered: convos.filter((c) => ['new', 'open'].includes(c.status) && !c.first_response_at).length,
      reopened: inWin.filter((c) => c.reopen_count > 0).length,
      median_first_response_s: percentile(fr, 0.5), p90_first_response_s: percentile(fr, 0.9),
      median_resolution_s: percentile(rs, 0.5), p90_resolution_s: percentile(rs, 0.9),
      median_claim_s: percentile(cl, 0.5),
    }], error: null };
  }
  if (name === 'support_metrics_by_admin') {
    const byAdmin = {};
    convos.filter((c) => c.assigned_admin).forEach((c) => {
      const a = byAdmin[c.assigned_admin] || (byAdmin[c.assigned_admin] = { admin_email: c.assigned_admin, handled: 0, replies: 0, resolved: 0, csat_up: 0, csat_down: 0 });
      a.handled += 1;
      if (c.resolved_by === c.assigned_admin) a.resolved += 1;
      if (c.csat === 'up') a.csat_up += 1;
      if (c.csat === 'down') a.csat_down += 1;
    });
    (store.support_events || []).filter((e) => e.action === 'replied').forEach((e) => { if (byAdmin[e.admin_email]) byAdmin[e.admin_email].replies += 1; });
    return { data: Object.values(byAdmin).sort((a, b) => b.handled - a.handled), error: null };
  }
  if (name === 'support_aging') {
    return { data: convos
      .filter((c) => ['new', 'open'].includes(c.status) && !c.first_response_at)
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
      .slice(0, 20)
      .map((c) => ({ conversation_id: c.id, subject: c.subject, type: c.type, status: c.status, assigned_admin: c.assigned_admin, waiting_since: c.created_at })), error: null };
  }
  if (name === 'support_volume_by_type') {
    const byType = {};
    convos.forEach((c) => {
      const t = byType[c.type] || (byType[c.type] = { type: c.type, total: 0, resolved: 0 });
      t.total += 1; if (c.resolved_at) t.resolved += 1;
    });
    return { data: Object.values(byType).sort((a, b) => b.total - a.total), error: null };
  }
  if (name === 'support_daily_volume') {
    const byDay = {};
    convos.forEach((c) => {
      const d = new Date(c.created_at);
      const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      byDay[key] = (byDay[key] || 0) + 1;
    });
    return { data: Object.entries(byDay).map(([day, total]) => ({ day, total })).sort((a, b) => a.day.localeCompare(b.day)), error: null };
  }
  if (name === 'support_csat_summary') {
    return { data: [{ up_count: convos.filter((c) => c.csat === 'up').length, down_count: convos.filter((c) => c.csat === 'down').length }], error: null };
  }
  if (name === 'support_rate_conversation') {
    const convo = convos.find((c) => c.id === params?.p_conversation_id && c.user_id === MOCK_USER_ID);
    if (convo && ['resolved', 'archived'].includes(convo.status) && ['up', 'down'].includes(params?.p_csat)) {
      convo.csat = params.p_csat;
      convo.csat_comment = (params?.p_comment || '').trim().slice(0, 300) || null;
      emitRealtime('support_conversations', 'UPDATE', convo);
    }
    return { data: null, error: null };
  }
  return null; // not a support RPC
}

// In-memory stand-in for the admin backends (api/admin.js + api/support.js) —
// there are no Vercel functions on the Vite dev server, so admin UI would be
// untestable in the harness without this. Reached only via the __mockApi hook
// that adminApiCall() in data.js checks for (the real supabase-js client never
// has that property). Support ops mirror api/support.js semantics: list
// enriches with the mock identity, thread zeroes unread_admin, reply inserts
// an admin message + auto-claims an unassigned thread + logs support_events.
function mockApi(kind, action, params, store) {
  const now = () => new Date().toISOString();
  if (kind === 'admin') {
    // Just enough for the Users/Insights tabs to render their empty states
    // instead of a network error; mutations are not simulated.
    if (action === 'list_overview') return { ok: true, codes: [], waitlist: [], roles: [], admins: [], ambassadors: [], members: [] };
    if (action === 'email_usage') return { ok: true, available: false };
    return { ok: false, error: 'Not available in the dev harness.' };
  }
  const convos = store.support_conversations || (store.support_conversations = []);
  const msgs = store.support_messages || (store.support_messages = []);
  const events = store.support_events || (store.support_events = []);
  if (kind === 'notify') {
    // Slice 5 stand-in for api/support-notify.js: reassure an unattended
    // question once (no Discord in the harness — logged as skipped).
    const convo = convos.find((c) => c.id === params?.conversation_id);
    if (!convo) return { ok: false, error: 'Conversation not found' };
    let reassured = false;
    if (convo.type === 'question' && !convo.assigned_admin
        && !msgs.some((m) => m.conversation_id === convo.id && m.sender === 'system')) {
      const m = { id: mockId(), conversation_id: convo.id, sender: 'system', sender_email: null, body: "Thanks for reaching out — we're not at the desk right now, but we'll get back to you soon.", attachments: null, is_internal_note: false, created_at: now(), read_at: null };
      msgs.push(m);
      emitRealtime('support_messages', 'INSERT', m);
      reassured = true;
    }
    return { ok: true, reassured, pinged: false };
  }
  // kind === 'support'
  if (action === 'list') {
    const conversations = [...convos]
      .sort((a, b) => new Date(b.last_message_at) - new Date(a.last_message_at))
      .map((c) => ({ ...c, user_email: MOCK_EMAIL, user_name: 'Test Student', user_avatar: null }));
    return { ok: true, conversations, caller_email: MOCK_EMAIL };
  }
  if (action === 'thread') {
    const convo = convos.find((c) => c.id === params?.conversation_id);
    if (!convo) return { ok: false, error: 'Conversation not found' };
    convo.unread_admin = 0;
    emitRealtime('support_conversations', 'UPDATE', convo);
    const messages = msgs
      .filter((m) => m.conversation_id === convo.id)
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    return { ok: true, messages, profile: { name: 'Test Student', email: MOCK_EMAIL, school: 'Weill Cornell Medicine', joined: '2026-01-01T00:00:00.000Z' } };
  }
  if (action === 'set_priority') {
    const convo = convos.find((c) => c.id === params?.conversation_id);
    if (!convo) return { ok: false, error: 'Conversation not found' };
    convo.priority = params?.priority || 'normal';
    emitRealtime('support_conversations', 'UPDATE', convo);
    return { ok: true, conversation: { ...convo, user_email: MOCK_EMAIL, user_name: 'Test Student' } };
  }
  if (action === 'set_tags') {
    const convo = convos.find((c) => c.id === params?.conversation_id);
    if (!convo) return { ok: false, error: 'Conversation not found' };
    const tags = (Array.isArray(params?.tags) ? params.tags : [])
      .map((t) => String(t).toLowerCase().trim().replace(/\s+/g, '-').slice(0, 30))
      .filter(Boolean).filter((t, i, a) => a.indexOf(t) === i).slice(0, 10);
    convo.tags = tags.length ? tags : null;
    emitRealtime('support_conversations', 'UPDATE', convo);
    return { ok: true, conversation: { ...convo, user_email: MOCK_EMAIL, user_name: 'Test Student' } };
  }
  if (action === 'add_note') {
    const convo = convos.find((c) => c.id === params?.conversation_id);
    if (!convo) return { ok: false, error: 'Conversation not found' };
    const text = (params?.body || '').trim();
    if (!text) return { ok: false, error: 'Note text required' };
    const message = { id: mockId(), conversation_id: convo.id, sender: 'admin', sender_email: MOCK_EMAIL, body: text, attachments: null, is_internal_note: true, created_at: now(), read_at: null };
    msgs.push(message);
    return { ok: true, message };
  }
  if (action === 'set_status') {
    const convo = convos.find((c) => c.id === params?.conversation_id);
    if (!convo) return { ok: false, error: 'Conversation not found' };
    const target = params?.status;
    if (target === 'resolved') { convo.resolved_at = now(); convo.resolved_by = MOCK_EMAIL; }
    if (target === 'archived') { convo.archived_at = now(); }
    if (target === 'snoozed') { convo.snooze_until = resolveSnoozeUntil(Date.now(), { minutes: params?.snooze_minutes, until: params?.snooze_until }); }
    if (target === 'open') {
      convo.archived_at = null; convo.snooze_until = null;
      if (['resolved', 'archived'].includes(convo.status)) convo.reopen_count += 1;
    }
    convo.status = target;
    events.push({ conversation_id: convo.id, admin_email: MOCK_EMAIL, action: 'status_changed', meta: { to: target }, at: now() });
    emitRealtime('support_conversations', 'UPDATE', convo);
    return { ok: true, conversation: { ...convo, user_email: MOCK_EMAIL, user_name: 'Test Student' } };
  }
  if (action === 'reassign' || action === 'release') {
    const convo = convos.find((c) => c.id === params?.conversation_id);
    if (!convo) return { ok: false, error: 'Conversation not found' };
    if (action === 'reassign') { convo.assigned_admin = (params?.admin_email || '').toLowerCase(); convo.claimed_at = now(); }
    else convo.assigned_admin = null;
    events.push({ conversation_id: convo.id, admin_email: MOCK_EMAIL, action: action === 'reassign' ? 'reassigned' : 'released', meta: null, at: now() });
    emitRealtime('support_conversations', 'UPDATE', convo);
    return { ok: true, conversation: { ...convo, user_email: MOCK_EMAIL, user_name: 'Test Student' } };
  }
  if (action === 'canned_list' || action === 'canned_save' || action === 'canned_delete') {
    const canned = store.support_canned || (store.support_canned = []);
    if (action === 'canned_save') {
      const text = (params?.body || '').trim();
      if (!text) return { ok: false, error: 'Reply text required' };
      const row = { id: mockId(), title: (params?.title || text.replace(/\s+/g, ' ').slice(0, 40)), body: text.slice(0, 2000), created_by: MOCK_EMAIL, created_at: now() };
      canned.push(row);
      return { ok: true, canned: row };
    }
    if (action === 'canned_delete') {
      const i = canned.findIndex((c) => c.id === params?.canned_id);
      if (i >= 0) canned.splice(i, 1);
      return { ok: true };
    }
    return { ok: true, canned: [...canned] };
  }
  if (action === 'nudge_create' || action === 'nudge_list' || action === 'nudge_cancel' || action === 'nudge_context') {
    const nudges = store.support_nudges || (store.support_nudges = []);
    const ctxFor = () => ({
      userActiveThread: convos.some((c) => ['new', 'open', 'waiting_user'].includes(c.status)),
      userMessagedSince: false,
      sentToTargetInWindow: nudges.filter((n) => n.state === 'sent').length,
    });
    if (action === 'nudge_create') {
      const n = { id: mockId(), created_by: MOCK_EMAIL, target_email: (params?.target_email || '').toLowerCase(), body: (params?.body || '').slice(0, 500), trigger_kind: 'manual', state: 'scheduled', recheck_condition: { type: 'no_open_support_thread' }, send_after: new Date(Date.now() + (params?.delay_hours || 0) * 3600000).toISOString(), created_at: now(), sent_at: null, cancelled_reason: null };
      nudges.unshift(n);
      return { ok: true, nudge: n };
    }
    if (action === 'nudge_cancel') {
      const n = nudges.find((x) => x.id === params?.nudge_id && x.state === 'scheduled');
      if (n) { n.state = 'cancelled'; n.cancelled_reason = 'admin_cancelled'; }
      return { ok: true, cancelled: !!n };
    }
    if (action === 'nudge_context') return { ok: true, context: ctxFor() };
    // nudge_list: lazily evaluate due ones with the REAL pure gate.
    return import('./nudgeGate.js').then(({ evaluateNudge }) => {
      nudges.filter((n) => n.state === 'scheduled').forEach((n) => {
        const verdict = evaluateNudge(n, ctxFor());
        if (verdict.action === 'send') {
          n.state = 'sent'; n.sent_at = now();
          (store.user_notifications || (store.user_notifications = [])).push({ id: Date.now(), email: n.target_email, kind: 'nudge', message: n.body, metadata: { nudge_id: n.id }, created_at: now(), dismissed_at: null });
        } else if (verdict.action === 'cancel') {
          n.state = 'cancelled'; n.cancelled_reason = verdict.reason;
        }
      });
      return { ok: true, nudges: [...nudges] };
    });
  }
  if (action === 'heartbeat' || action === 'set_availability' || action === 'set_business_hours') {
    // Per-admin table, but the mock harness only ever has one admin (MOCK_EMAIL).
    const rows = store.support_admin_availability || (store.support_admin_availability = []);
    let st = rows.find((r) => r.admin_email === MOCK_EMAIL);
    if (!st) { st = { admin_email: MOCK_EMAIL, online_override: 'auto', business_hours: { tz: 'America/New_York' }, available_until: null, last_heartbeat: null }; rows.push(st); }
    if (action === 'heartbeat') st.last_heartbeat = now();
    if (action === 'set_availability') {
      st.online_override = ['auto', 'on', 'off'].includes(params?.override) ? params.override : 'auto';
      if (st.online_override === 'on') { st.available_until = new Date(Date.now() + 3600000).toISOString(); st.last_heartbeat = now(); }
    }
    if (action === 'set_business_hours' && params?.business_hours) st.business_hours = params.business_hours;
    st.updated_at = now();
    emitRealtime('support_admin_availability', 'UPDATE', st);
    return { ok: true, settings: { ...st } };
  }
  if (action === 'reply') {
    const convo = convos.find((c) => c.id === params?.conversation_id);
    if (!convo) return { ok: false, error: 'Conversation not found' };
    const text = (params?.body || '').trim();
    if (!text) return { ok: false, error: 'Reply text required' };
    const message = { id: mockId(), conversation_id: convo.id, sender: 'admin', sender_email: MOCK_EMAIL, body: text, attachments: null, is_internal_note: false, created_at: now(), read_at: null };
    msgs.push(message);
    const claimed = !convo.assigned_admin;
    if (claimed) {
      convo.assigned_admin = MOCK_EMAIL;
      convo.claimed_at = now();
      events.push({ conversation_id: convo.id, admin_email: MOCK_EMAIL, action: 'claimed', meta: { via: 'auto_claim_on_reply' }, at: now() });
    }
    if (['new', 'open', 'snoozed'].includes(convo.status)) {
      if (convo.status === 'snoozed') convo.snooze_until = null;
      convo.status = 'waiting_user';
    }
    convo.first_response_at = convo.first_response_at || now();
    convo.last_message_at = now();
    convo.unread_user += 1;
    events.push({ conversation_id: convo.id, admin_email: MOCK_EMAIL, action: 'replied', meta: { message_id: message.id }, at: now() });
    emitRealtime('support_messages', 'INSERT', message);
    emitRealtime('support_conversations', 'UPDATE', convo);
    (store.user_notifications || (store.user_notifications = [])).push({
      id: Date.now(), email: MOCK_EMAIL, kind: 'support',
      message: 'Marro replied to your support message — open Support to read it.',
      metadata: { conversation_id: convo.id }, created_at: now(), dismissed_at: null,
    });
    return { ok: true, message, claimed, assigned_admin: convo.assigned_admin };
  }
  return { ok: false, error: 'Unknown action' };
}

export function createMockSupabaseStub() {
  const seed = buildMockSupport();
  const store = {
    app_state: [{ user_id: MOCK_USER_ID, state: buildMockState() }],
    profiles: [{ user_id: MOCK_USER_ID, ...MOCK_PROFILE }],
    events: [],
    support_conversations: seed.conversations,
    support_messages: seed.messages,
    support_events: [],
    support_admin_availability: [{ admin_email: MOCK_EMAIL, online_override: 'auto', business_hours: { tz: 'America/New_York' }, available_until: null, last_heartbeat: null, updated_at: new Date().toISOString() }],
    user_notifications: [],
  };
  const subscribers = new Set();

  const stub = {
    auth: {
      getSession: async () => ({ data: { session: MOCK_SESSION }, error: null }),
      getUser: async () => ({ data: { user: MOCK_SESSION.user }, error: null }),
      onAuthStateChange: (cb) => {
        subscribers.add(cb);
        return { data: { subscription: { unsubscribe: () => subscribers.delete(cb) } } };
      },
      signOut: async () => {
        subscribers.forEach((cb) => { try { cb('SIGNED_OUT', null); } catch { /* dev harness only */ } });
        return { error: null };
      },
      // Not reachable in mock mode (LandingPage never renders while a
      // session exists), kept only so an accidental call fails softly
      // instead of throwing and crashing the tab.
      signInWithOAuth: async () => ({ data: null, error: { message: 'mock mode: sign-in is disabled' } }),
      signInWithPassword: async () => ({ data: null, error: { message: 'mock mode: sign-in is disabled' } }),
    },
    from: (table) => makeQueryBuilder(table, store),
    // Dev-harness stand-in for the admin backends — see adminApiCall() in
    // data.js, which routes here instead of fetch() when this hook exists.
    __mockApi: (kind, action, params) => mockApi(kind, action, params, store),
    // Realtime emulation (Slice 4): same channel API shape as supabase-js.
    channel: () => makeChannel(),
    removeChannel: (ch) => { rtChannels.delete(ch); },
    // Storage emulation (Slice 10): uploads live as object URLs in-memory; a
    // "signed URL" is just that object URL. Enough for the attach → render
    // loop to run visually on ?mock=1 with zero backend.
    storage: {
      from: () => ({
        upload: async (path, blob) => {
          (store.__files || (store.__files = new Map())).set(path, URL.createObjectURL(blob));
          return { data: { path }, error: null };
        },
        createSignedUrl: async (path) => {
          const url = store.__files?.get(path);
          return url ? { data: { signedUrl: url }, error: null } : { data: null, error: { message: 'not found' } };
        },
      }),
    },
    rpc: async (name, params) => {
      if (name === 'is_email_allowed') return { data: true, error: null }; // dev-harness user always passes the invite gate, localhost-only
      // Admin-flagged since Slice 3 so the Admin tab (and its Support inbox)
      // is click-testable in the harness — the client is_admin() only shows
      // UI; every real admin action still 403s server-side for non-admins.
      if (name === 'is_admin') return { data: true, error: null };
      const support = supportRpc(name, params, store);
      if (support) return support;
      return { data: null, error: null };
    },
  };
  return stub;
}
