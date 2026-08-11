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
        msgs.push({ id: mockId(), conversation_id: active.id, sender: 'user', sender_email: null, body, attachments: null, is_internal_note: false, created_at: now(), read_at: null });
        active.last_message_at = now();
        active.unread_admin += 1;
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
    msgs.push({ id: mockId(), conversation_id: id, sender: 'user', sender_email: null, body, attachments: null, is_internal_note: false, created_at: now(), read_at: null });
    return { data: id, error: null };
  }
  if (name === 'support_post_user_message') {
    const convo = convos.find((c) => c.id === params?.p_conversation_id && c.user_id === MOCK_USER_ID);
    if (!convo) return { data: null, error: { message: 'conversation not found' } };
    const body = (params?.p_body || '').trim();
    if (!body) return { data: null, error: { message: 'message body required' } };
    const mid = mockId();
    msgs.push({ id: mid, conversation_id: convo.id, sender: 'user', sender_email: null, body, attachments: params?.p_attachments ?? null, is_internal_note: false, created_at: now(), read_at: null });
    convo.last_message_at = now();
    convo.unread_admin += 1;
    if (convo.status === 'resolved' || convo.status === 'archived') {
      convo.status = 'open'; convo.reopen_count += 1; convo.archived_at = null;
    }
    return { data: mid, error: null };
  }
  if (name === 'support_mark_read') {
    const convo = convos.find((c) => c.id === params?.p_conversation_id && c.user_id === MOCK_USER_ID);
    if (convo) convo.unread_user = 0;
    return { data: null, error: null };
  }
  if (name === 'support_archive_conversation') {
    const convo = convos.find((c) => c.id === params?.p_conversation_id && c.user_id === MOCK_USER_ID);
    if (convo) { convo.status = 'archived'; convo.archived_at = now(); convo.resolved_at = convo.resolved_at || now(); }
    return { data: null, error: null };
  }
  if (name === 'support_reopen_conversation') {
    const convo = convos.find((c) => c.id === params?.p_conversation_id && c.user_id === MOCK_USER_ID);
    if (convo && (convo.status === 'resolved' || convo.status === 'archived')) {
      convo.status = 'open'; convo.archived_at = null; convo.reopen_count += 1;
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
  // kind === 'support'
  const convos = store.support_conversations || (store.support_conversations = []);
  const msgs = store.support_messages || (store.support_messages = []);
  const events = store.support_events || (store.support_events = []);
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
    const messages = msgs
      .filter((m) => m.conversation_id === convo.id)
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    return { ok: true, messages };
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
      if (convo.status === 'new') convo.status = 'open';
      events.push({ conversation_id: convo.id, admin_email: MOCK_EMAIL, action: 'claimed', meta: { via: 'auto_claim_on_reply' }, at: now() });
    }
    convo.first_response_at = convo.first_response_at || now();
    convo.last_message_at = now();
    convo.unread_user += 1;
    events.push({ conversation_id: convo.id, admin_email: MOCK_EMAIL, action: 'replied', meta: { message_id: message.id }, at: now() });
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
