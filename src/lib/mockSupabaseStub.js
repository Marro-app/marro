// ── Dev-only test harness: in-memory Supabase stand-in ──────────────────────
// Reached ONLY via dynamic import() from `getSupabase()` in `lib/data.js`,
// itself gated on `isMockModeActive()`. This object implements just enough
// of the supabase-js surface (auth.*, from().*, rpc()) that the REAL app
// code paths — stateFetch/stateWrite/isEmailAllowed/isAdmin/logEvent, the
// profile fetch, sign-out — all run completely unmodified against it. It
// never opens a network connection, never imports @supabase/supabase-js,
// and never sees a real credential. All "tables" are plain in-memory arrays
// that live for the lifetime of the tab and reset on reload.
import { MOCK_SESSION, MOCK_PROFILE, MOCK_USER_ID, buildMockState } from './mockSessionData.js';

function makeQueryBuilder(table, store) {
  let op = { kind: 'select' };
  const filters = [];
  const builder = {
    select: () => builder,
    insert: (payload) => { op = { kind: 'insert', payload }; return builder; },
    upsert: (payload) => { op = { kind: 'upsert', payload }; return builder; },
    update: (payload) => { op = { kind: 'update', payload }; return builder; },
    eq: (col, val) => { filters.push([col, val]); return builder; },
    order: () => builder,
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
      return { data: matched, error: null }; // select
    },
    maybeSingle: async () => { const { data, error } = builder.resolve(); return { data: data?.[0] ?? null, error }; },
    single: async () => { const { data, error } = builder.resolve(); return { data: data?.[0] ?? null, error }; },
    then: (onFulfilled, onRejected) => Promise.resolve(builder.resolve()).then(onFulfilled, onRejected),
  };
  return builder;
}

export function createMockSupabaseStub() {
  const store = {
    app_state: [{ user_id: MOCK_USER_ID, state: buildMockState() }],
    profiles: [{ user_id: MOCK_USER_ID, ...MOCK_PROFILE }],
    events: [],
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
    rpc: async (name) => {
      if (name === 'is_email_allowed') return { data: true, error: null }; // dev-harness user always passes the invite gate, localhost-only
      if (name === 'is_admin') return { data: false, error: null }; // mock user is never an admin
      return { data: null, error: null };
    },
  };
  return stub;
}
