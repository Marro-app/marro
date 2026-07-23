import { isMockModeActive } from './mockSession.js';

export const SUPABASE_URL      = "https://rjowpekykqlounnaegwn.supabase.co";
export const SUPABASE_ANON_KEY = "sb_publishable_Kp89EOIm88PDospinCz-eA_wDs09kjq"; // publishable key — safe in client (RLS-gated)

// ── Lazy Supabase client ──────────────────────────────────────────────────────
// supabase-js is ~150-200KB and was previously imported at module-eval time here,
// which pulled it into the main bundle for EVERY visitor — including a first-time,
// logged-out visitor who only ever sees the marketing landing page. It's now
// dynamic-imported and memoized on first use, so it becomes its own lazy chunk
// that a logged-out cold load never fetches.
//
// Every consumer (auth gate, sign-in button, profile/onboarding writes, the
// app_state sync engine) MUST go through `await getSupabase()` — nothing may
// import/use the client at module-eval time, or it defeats the whole point.
let _sbPromise = null;
export function getSupabase(){
  if(!_sbPromise){
    // ── Dev-only test harness (FUTURE_WORK.md "Dev-mode test harness") ──
    // In mock mode (dev build + localhost + ?mock=1 / VITE_MOCK_SESSION —
    // see isMockModeActive) hand back an in-memory stub instead of the real
    // client, so EVERY downstream caller (auth gate, sync, profile, logging)
    // runs unmodified against fake data and never touches real Supabase. The
    // stub module is dynamic-imported ONLY inside this DEV-gated branch, so it
    // is dead/unreachable code that Vite strips from any production build.
    if(import.meta.env.DEV && isMockModeActive()){
      _sbPromise = import('./mockSupabaseStub.js').then(({createMockSupabaseStub}) => createMockSupabaseStub());
      return _sbPromise;
    }
    _sbPromise = import('@supabase/supabase-js').then(({createClient}) =>
      createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {auth:{flowType:"pkce"}})
    );
  }
  return _sbPromise;
}

// Synchronous boot check — must run BEFORE any import of supabase-js, so it
// can decide whether to eagerly kick off getSupabase() at all. Two cases need
// supabase loaded immediately, before render:
//   (a) a returning signed-in user (their session token is cached locally), or
//   (b) an OAuth/redirect callback that supabase itself must process — e.g. a
//       first-time visitor who just completed Google sign-in and lands back
//       with #access_token=... (or an error/type param) in the URL, with an
//       EMPTY localStorage. Missing this case would silently break first-time
//       sign-in, since nothing else would ever call getSupabase() to consume
//       the callback.
// Everything else (cold, logged-out, no callback) → render the landing page
// immediately with zero supabase-js bytes downloaded.
export const SESSION_STORAGE_KEY = "sb-rjowpekykqlounnaegwn-auth-token";
export function needsEagerSupabase(){
  // Dev-only test harness: force the App path (not the landing page) so the
  // mock session boots straight into the signed-in app. DEV-gated + opt-in
  // (see isMockModeActive) → compiled out of any production build.
  if(import.meta.env.DEV && isMockModeActive()) return true;
  try{
    if(localStorage.getItem(SESSION_STORAGE_KEY)) return true;
  }catch{ /* localStorage unavailable — fall through to URL check */ }
  const hash = window.location.hash || "";
  const search = window.location.search || "";
  if(/access_token|error|type=/.test(hash)) return true;
  if(/[?&](code|error)=/.test(search)) return true;
  return false;
}

// Password-reset redirect marker — appended by `resetPasswordForEmail`'s
// `redirectTo` (see EmailPasswordForm.jsx) as `?reset=1`, alongside whatever
// PKCE `?code=...`/hash params Supabase itself adds on top. Checked
// synchronously at boot, BEFORE needsEagerSupabase()'s App-vs-landing
// decision, so a recovery link can never be mistaken for a normal signed-in
// return visit or OAuth callback and silently complete into the full App.
export function isRecoveryRedirect(){
  const search = window.location.search || "";
  const hash = window.location.hash || "";
  return /[?&]reset=1\b/.test(search) || /[?&]reset=1\b/.test(hash);
}

// Strips the recovery marker (and any Supabase code/hash params riding along
// with it) from the visible URL once the reset flow has been handled —
// otherwise a refresh or bookmark would re-trigger ResetPasswordGate forever,
// and/or resubmit a now-consumed PKCE code.
export function clearRecoveryUrlParams(){
  try{
    const url = new URL(window.location.href);
    url.search = "";
    url.hash = "";
    window.history.replaceState({}, "", url.pathname);
  }catch{ /* best-effort cleanup only */ }
}

// ── Supabase sync (per-user row in app_state, RLS-gated) ─────────────────────────
// Transport-only replacement for the old Gist proxy: same string-in / string-out,
// null-on-failure contract, so the 3-way merge engine below is untouched.
export const stateFetch = async () => {           // → JSON string | null  (null = no row OR error/offline)
  try {
    const sb = await getSupabase();
    const {data, error} = await sb.from("app_state").select("state").maybeSingle();
    if(error || !data) return null;
    return JSON.stringify(data.state);
  } catch { return null; }
};

// Closed-beta invite gate (supabase/allowed_emails.sql §3). Fails closed:
// any RPC error (network hiccup, cold start) is treated as "not allowed" —
// worst case a legitimate user retries, which beats an invite-only gate that
// silently lets strangers through during an outage.
export const isEmailAllowed = async () => {       // → boolean
  try {
    const sb = await getSupabase();
    const {data, error} = await sb.rpc('is_email_allowed');
    return !error && data === true;
  } catch { return false; }
};

export const stateWrite = async (content) => {    // → boolean (true = persisted)
  try {
    const sb = await getSupabase();
    const {data:{user}} = await sb.auth.getUser();
    if(!user) return false;
    const {error} = await sb.from("app_state").upsert({user_id:user.id, state:JSON.parse(content)});
    return !error;
  } catch { return false; }
};

// ── Usage/event logging (Phase 1 Track B, supabase/events.sql) ──────────────────
// Fire-and-forget: NEVER throws, NEVER awaited by the caller for its result, and
// safe with no session/offline/any Supabase error — logging must never affect
// the actual feature it's attached to. Looks up the current user id itself so
// call sites don't need to thread one through. `metadata` must stay minimal,
// non-sensitive structural context only (e.g. {tab:"budget"}) — never dollar
// amounts, balances, or other financial/personal details (docs/DATA_ETHICS.md).
// Table is insert-only from the client (RLS — see supabase/events.sql); no read
// path exists here or anywhere else in the app.
export const logEvent = async (eventName, metadata) => {
  try {
    const sb = await getSupabase();
    const {data:{user}} = await sb.auth.getUser();
    if(!user) return;
    await sb.from("events").insert({user_id:user.id, event_name:eventName, metadata:metadata ?? null});
  } catch { /* best-effort only — logging must never surface an error to the caller */ }
};

// ── Data export (Settings → "Export my data") ────────────────────────────────
// Entirely client-side: the signed-in user's own `app_state` + `profiles` rows
// are already readable by them under existing RLS (the same rows stateFetch/
// stateWrite already read/write) — no backend needed here. Excel is the
// primary format (readable by non-technical users); raw JSON is kept as a
// secondary "technical/complete" download. Both trigger a browser download
// and return {ok:boolean, error?:string} so the caller can show a UI failure
// state rather than fail silently.
const fetchExportData = async () => {
  const sb = await getSupabase();
  const {data:{user}} = await sb.auth.getUser();
  if (!user) return {error:"Not signed in."};

  const [{data:stateRow, error:stateErr}, {data:profileRow, error:profileErr}] = await Promise.all([
    sb.from("app_state").select("state, updated_at").maybeSingle(),
    sb.from("profiles").select("school, created_at").maybeSingle(),
  ]);
  if (stateErr || profileErr) return {error:"Couldn't read your data. Please try again."};
  return {user, stateRow, profileRow};
};

const downloadBlob = (blob, filename) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};

const exportStamp = () => new Date().toISOString().slice(0,10);

export const exportUserData = async () => {
  try {
    const {user, stateRow, profileRow, error} = await fetchExportData();
    if (error) return {ok:false, error};

    const payload = {
      exportedAt: new Date().toISOString(),
      account: {id:user.id, email:user.email, createdAt:user.created_at},
      profile: profileRow || null,
      appState: stateRow?.state || null,
    };
    const json = JSON.stringify(payload, null, 2);
    downloadBlob(new Blob([json], {type:"application/json"}), `marro-export-${exportStamp()}.json`);
    return {ok:true};
  } catch {
    return {ok:false, error:"Couldn't export your data. Please try again."};
  }
};

// Primary export: a multi-sheet workbook so non-technical users can open
// their data straight in Excel/Numbers/Sheets instead of reading raw JSON.
// One sheet per top-level data area; granular per-month budget overrides and
// per-goal linkage bookkeeping are left out of the readable sheets (still
// fully present in the JSON export) to keep each sheet skimmable.
export const exportUserDataExcel = async () => {
  try {
    const {user, stateRow, profileRow, error} = await fetchExportData();
    if (error) return {ok:false, error};

    const state = stateRow?.state || {};
    const categories = state.categories || [];
    const catLabel = (id) => categories.find(c => c.id === id)?.label || id;

    const XLSX = await import("xlsx");
    const wb = XLSX.utils.book_new();
    const addSheet = (name, rows) => {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), name.slice(0,31));
    };

    addSheet("Account", [{
      Email: user.email,
      "Account created": user.created_at,
      School: profileRow?.school || "",
    }]);

    const program = state.program || {};
    const dualInfo = program.dual ? program[program.dual] : null;
    addSheet("Profile & Program", [{
      Degree: program.degree || "",
      "Dual degree": program.dual || "None",
      Field: dualInfo?.field || "",
      Institution: dualInfo?.institution || (program.dual ? "Same as med school" : ""),
    }]);

    addSheet("Years & Budget", (state.years || []).map(y => {
      const row = {
        Year: y.label || `Year ${y.id + 1}`,
        "Start date": y.startDate || "",
        "End date": y.endDate || "",
        Grant: y.grant || 0,
        "Tuition & fees": y.tuitionFees || 0,
        "Health insurance": y.healthIns || 0,
        "Other income": y.otherIncome || 0,
        Housing: y.housing || 0,
        "Housing note": y.housingNote || "",
        "Living allowance": y.livingAllowance || 0,
        Notes: y.notes || "",
      };
      categories.forEach(c => { row[`Monthly: ${c.label}`] = y.monthly?.[c.id] ?? 0; });
      return row;
    }));

    addSheet("Savings Goals", [...(state.stepGoals || []), ...(state.savingsGoals || [])].map(g => ({
      Goal: g.label,
      "Target amount": g.targetAmount,
      "Target date": g.targetDate,
      Saved: g.saved,
      "Monthly contribution": g.monthlyContribution || 0,
    })));

    addSheet("Savings Log", (state.savingsLog || []).map(s => ({
      Date: s.date,
      Amount: s.amount,
      Note: s.note || "",
    })));

    addSheet("Subscriptions", (state.subscriptions || []).map(s => ({
      Name: s.name,
      Amount: s.amount,
      Cycle: s.cycle,
      "Renewal date": s.renewal,
      Active: s.active ? "Yes" : "No",
    })));

    const weeklyRows = [];
    (state.weeklyArchive || []).forEach(w => (w.entries || []).forEach(e => weeklyRows.push({
      "Week start": w.weekStart, "Week end": w.weekEnd,
      Category: catLabel(e.catId), Amount: e.amount, Note: e.note || "", Date: e.date,
    })));
    (state.currentWeekEntries || []).forEach(e => weeklyRows.push({
      "Week start": "Current week", "Week end": "",
      Category: catLabel(e.catId), Amount: e.amount, Note: e.note || "", Date: e.date,
    }));
    addSheet("Weekly Entries", weeklyRows);

    const buf = XLSX.write(wb, {bookType:"xlsx", type:"array"});
    downloadBlob(
      new Blob([buf], {type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}),
      `marro-export-${exportStamp()}.xlsx`
    );
    return {ok:true};
  } catch {
    return {ok:false, error:"Couldn't export your data. Please try again."};
  }
};

// ── Account deletion (Settings → "Delete my account") ────────────────────────
// A public/anon Supabase client can never delete its own auth.users row (needs
// the Admin API + service-role key — never shipped to the browser). This calls
// the Vercel serverless function (api/delete-account.js), which verifies the
// caller's access token server-side and derives the uid itself — the client
// never asserts its own user id to the backend, it just proves who it is via
// the bearer token. Returns {ok:boolean, error?:string}.
export const deleteAccount = async () => {
  try {
    const sb = await getSupabase();
    const {data:{session}} = await sb.auth.getSession();
    const token = session?.access_token;
    if (!token) return {ok:false, error:"Not signed in."};

    const res = await fetch("/api/delete-account", {
      method: "POST",
      headers: {Authorization: `Bearer ${token}`},
    });
    if (!res.ok) {
      let msg = "Failed to delete account. Please try again.";
      try { const body = await res.json(); if (body?.error) msg = body.error; } catch { /* non-JSON error body */ }
      return {ok:false, error:msg};
    }
    return {ok:true};
  } catch {
    return {ok:false, error:"Network error — please check your connection and try again."};
  }
};

// ── Invite codes + waitlist (supabase/invites_waitlist.sql) ──────────────────────
// Same fail-closed / never-throw posture as isEmailAllowed above: any RPC error
// (network hiccup, cold start) resolves to the safest "nothing happened" value
// rather than surfacing a raw exception to the caller.

// Redeems an invite code for the current session. → the rpc's {status} object,
// where status is one of 'ok'|'already_used'|'revoked'|'invalid'|'locked'.
// On a genuine network/client error (not a real server response) we fall back
// to {status:'invalid'} so InviteGate can show its generic error copy.
export const redeemInviteCode = async (code) => {
  try {
    const sb = await getSupabase();
    const {data, error} = await sb.rpc('redeem_invite_code', {p_code: code});
    if (error || !data) return {status:'invalid'};
    return data;
  } catch { return {status:'invalid'}; }
};

// Pending-invite-code stash (localStorage only, no Supabase) — bridges the gap
// between "user clicks an ?invite= email link" and "user actually has a
// session at the InviteGate" for paths where those two moments aren't the
// same tick: email/password signup requires email confirmation before a
// session exists, Google OAuth is a full-page redirect that drops query
// params, and password sign-in hard-reloads to a bare path. AuthModal stashes
// the URL code on mount; InviteGate (the single redemption point) takes it.
// `src` ('waitlist' | null) tags which email the code came from so the gate
// can pick its congrats copy. Stored as "CODE" or "CODE|src".
// Synchronous, best-effort — never throws.
const PENDING_INVITE_KEY = "marro_pending_invite";
export function stashPendingInviteCode(code, src){
  const trimmed = (code || "").trim().toUpperCase();
  if (!trimmed) return;
  try { localStorage.setItem(PENDING_INVITE_KEY, src ? `${trimmed}|${src}` : trimmed); } catch { /* best-effort only */ }
}
export function takePendingInviteCode(){
  try {
    const v = localStorage.getItem(PENDING_INVITE_KEY);
    if (v) localStorage.removeItem(PENDING_INVITE_KEY);
    if (!v) return null;
    const [code, src] = v.split("|");
    return code ? { code, src: src || null } : null;
  } catch { return null; }
}

// Effective invite quota for the current user (5, 15, or an admin override). → number.
export const myInviteQuota = async () => {
  try {
    const sb = await getSupabase();
    const {data, error} = await sb.rpc('my_invite_quota');
    if (error || typeof data !== 'number') return 0;
    return data;
  } catch { return 0; }
};

// Generates a new invite code owned by the current user. → the rpc object:
// {status:'ok', code} | {status:'quota_exhausted', quota}.
export const generateInviteCode = async () => {
  try {
    const sb = await getSupabase();
    const {data, error} = await sb.rpc('generate_invite_code');
    if (error || !data) return {status:'quota_exhausted'};
    return data;
  } catch { return {status:'quota_exhausted'}; }
};

// The current user's own invite codes (RLS: own rows only), newest first. → array.
// Includes admin-issued codes if any happen to be owned by this user (an admin
// viewing their own referral list) — the UI is expected to filter those out
// via issued_by_admin if it only wants to show PERSONAL codes.
export const myInviteCodes = async () => {
  try {
    const sb = await getSupabase();
    const {data, error} = await sb.from('invite_codes').select('*').order('created_at', {ascending:false});
    if (error || !data) return [];
    return data;
  } catch { return []; }
};

// Revokes one of the current user's OWN unused codes (feature: revoking an
// unused code refunds the invite — automatic, since generate_invite_code()
// only counts non-revoked codes). → {status:'ok'|'not_found'}.
export const revokeOwnCode = async (code) => {
  try {
    const sb = await getSupabase();
    const {data, error} = await sb.rpc('revoke_own_code', {p_code: code});
    if (error || !data) return {status:'not_found'};
    return data;
  } catch { return {status:'not_found'}; }
};

// Emails one of the current user's own unused codes to someone, via the
// server (api/send-invite.js — verifies ownership + rate-limits server-side).
// → {ok:boolean, error?}.
export const sendInviteEmail = async (code, toEmail, message) => {
  try {
    const sb = await getSupabase();
    const {data:{session}} = await sb.auth.getSession();
    const token = session?.access_token;
    if (!token) return {ok:false, error:"Not signed in."};
    const res = await fetch("/api/send-invite", {
      method: "POST",
      headers: {Authorization: `Bearer ${token}`, "Content-Type": "application/json"},
      body: JSON.stringify({code, to_email: toEmail, message}),
    });
    let body = null;
    try { body = await res.json(); } catch { /* non-JSON error body */ }
    if (!res.ok) return {ok:false, error: body?.error || "Request failed. Please try again."};
    return {ok:true, ...body};
  } catch {
    return {ok:false, error:"Network error — please check your connection and try again."};
  }
};

// Joins (or updates) the waitlist for the current user — upsert on user_id (PK),
// so re-submitting is idempotent. Goes through api/join-waitlist.js (not a
// direct client insert) so the confirmation email can actually be sent — the
// browser never holds RESEND_API_KEY. → {ok:boolean, emailed?:boolean, error?}.
export const joinWaitlist = async (reason) => {
  try {
    const sb = await getSupabase();
    const {data:{session}} = await sb.auth.getSession();
    const token = session?.access_token;
    if (!token) return {ok:false};
    const res = await fetch("/api/join-waitlist", {
      method: "POST",
      headers: {Authorization: `Bearer ${token}`, "Content-Type": "application/json"},
      body: JSON.stringify({reason: reason || null}),
    });
    let body = null;
    try { body = await res.json(); } catch { /* non-JSON error body */ }
    if (!res.ok) return {ok:false, error: body?.error || "Couldn't join the waitlist. Please try again."};
    return {ok:true, ...body};
  } catch { return {ok:false}; }
};

// The current user's own waitlist row, if any. → row object | null.
export const myWaitlist = async () => {
  try {
    const sb = await getSupabase();
    const {data, error} = await sb.from('waitlist').select('*').maybeSingle();
    if (error || !data) return null;
    return data;
  } catch { return null; }
};

// Whether the current user is an admin (server re-checks on every admin action —
// this is only used client-side to decide whether to show the Admin tab). → boolean.
export const isAdmin = async () => {
  try {
    const sb = await getSupabase();
    const {data, error} = await sb.rpc('is_admin');
    return !error && data === true;
  } catch { return false; }
};

// Founder-readable usage metrics for the Admin tab's "Insights" section
// (supabase/events.sql / a future admin_usage_metrics() RPC — see AdminTab.jsx
// InsightsSection for the exact SQL this expects). The `events` table itself
// is INSERT-only from the client (no SELECT policy — see events.sql), so this
// goes through a SECURITY DEFINER RPC that checks the caller is in
// public.admins and only then returns the aggregate counts; a non-admin or a
// signed-out caller gets no rows back. → {signups_this_week, return_users} or
// null if the RPC doesn't exist yet / errors / caller isn't an admin.
export const adminUsageMetrics = async () => {
  try {
    const sb = await getSupabase();
    const {data, error} = await sb.rpc('admin_usage_metrics');
    if (error || !data) return null;
    return Array.isArray(data) ? (data[0] || null) : data;
  } catch { return null; }
};

// ── In-app notifications (supabase/notifications.sql) ────────────────────────
// The "something changed" banner: when an admin action affects a user (invite
// limit raised, ambassador granted, code revoked, someone they invited
// joined...), a row lands here for them to see next time they open the app.

// The current user's own undismissed notifications, newest first. → array.
export const myNotifications = async () => {
  try {
    const sb = await getSupabase();
    const {data, error} = await sb.from('user_notifications')
      .select('*').is('dismissed_at', null).order('created_at', {ascending:false});
    if (error || !data) return [];
    return data;
  } catch { return []; }
};

// Dismisses one of the current user's own notifications. → {status:'ok'|'not_found'}.
export const dismissNotification = async (id) => {
  try {
    const sb = await getSupabase();
    const {data, error} = await sb.rpc('dismiss_notification', {p_id: id});
    if (error || !data) return {status:'not_found'};
    return data;
  } catch { return {status:'not_found'}; }
};

// Shared helper for the admin backend (api/admin.js). Bearer-auth'd, same
// pattern as deleteAccount above. `action` + any extra params are forwarded
// as-is in the JSON body; the server re-validates admin status itself, so
// this is just transport — never trust the client's isAdmin() as a gate.
// → parsed JSON {ok, ...} on any response, or {ok:false, error} on failure.
export const adminCall = async (action, params = {}) => {
  try {
    const sb = await getSupabase();
    const {data:{session}} = await sb.auth.getSession();
    const token = session?.access_token;
    if (!token) return {ok:false, error:"Not signed in."};

    const res = await fetch("/api/admin", {
      method: "POST",
      headers: {Authorization: `Bearer ${token}`, "Content-Type": "application/json"},
      body: JSON.stringify({action, ...params}),
    });
    let body = null;
    try { body = await res.json(); } catch { /* non-JSON error body */ }
    if (!res.ok) return {ok:false, error: body?.error || "Request failed. Please try again."};
    return body || {ok:true};
  } catch {
    return {ok:false, error:"Network error — please check your connection and try again."};
  }
};

// ── 3-way merge engine ─────────────────────────────────────────────────────────
export const SYNC_BASE_KEY = "marro_v8_base";

export function diffStates(base, cur) {
  const ch = {}, js = JSON.stringify;
  // Scalars (including object-shaped ones like `program`/`avatar`): whole-value
  // replace + conflict detection, same as every other entry in this list.
  // `archivedYears` (the soft-deleted-year shelf, App.jsx removeYear/reinstateYear)
  // is included here as a REPLACE-WHOLE-ARRAY scalar rather than diffed
  // item-by-item like `years`/`categories`/etc: archiving/restoring a year is a
  // rare, single-device action (not concurrent per-field editing like budgets),
  // so a plain last-write-wins-with-conflict-flag on the whole array is simpler
  // and safe — it only loses data if BOTH devices archive/restore in the same
  // sync window, which `findConflicts` will surface as a conflict rather than
  // silently dropping either side.
  // `archivedInviteCodes` is a plain list of invite-code strings the user has
  // hidden from their invite list — a purely client-side view preference (the
  // codes themselves live in the RLS-gated `invite_codes` table; archiving does
  // NOT touch the server). Same replace-whole-array treatment as `archivedYears`.
  for (const k of ['darkMode','logo','preferredName','avatar','program','setupVersion','archivedYears','archivedInviteCodes','loanReminderSnooze','refundPlaybookSeen']) {
    if (js(base[k]) !== js(cur[k])) ch[k] = {b:base[k], c:cur[k]};
  }
  for (const k of ['monthDisabled']) {
    const bk=base[k]||{}, ck=cur[k]||{};
    for (const sk of new Set([...Object.keys(bk),...Object.keys(ck)]))
      if (js(bk[sk])!==js(ck[sk])) ch[`${k}.${sk}`]={b:bk[sk],c:ck[sk]};
  }
  // Track the years array LENGTH explicitly: per-index field diffs alone can
  // null out a removed year's fields but never delete the slot itself, leaving
  // a ghost `{monthly:{},…}` year behind after an archive/remove on another
  // device. Emitted BEFORE the per-index keys so applyChanges (which walks
  // keys in insertion order) truncates/pads first, then field diffs fill in.
  const blen=(base.years||[]).length, clen=(cur.years||[]).length;
  if (blen!==clen) ch['years.length']={b:blen, c:clen};
  const ylen=Math.max(blen,clen);
  for (let i=0;i<ylen;i++) {
    const by=(base.years||[])[i]||{}, cy=(cur.years||[])[i]||{};
    for (const f of ['grant','tuitionFees','healthIns','otherIncome','housing','housingNote','livingAllowance','notes','startDate','endDate'])
      if (js(by[f])!==js(cy[f])) ch[`years[${i}].${f}`]={b:by[f],c:cy[f]};
    const bm=by.monthly||{}, cm=cy.monthly||{};
    for (const c of new Set([...Object.keys(bm),...Object.keys(cm)]))
      if (js(bm[c])!==js(cm[c])) ch[`years[${i}].monthly.${c}`]={b:bm[c],c:cm[c]};
    const bo=by.monthlyOverrides||{}, co=cy.monthlyOverrides||{};
    for (const mn of new Set([...Object.keys(bo),...Object.keys(co)])) {
      const bmo=bo[mn]||{}, cmo=co[mn]||{};
      for (const c of new Set([...Object.keys(bmo),...Object.keys(cmo)]))
        if (js(bmo[c])!==js(cmo[c])) ch[`years[${i}].monthlyOverrides.${mn}.${c}`]={b:bmo[c],c:cmo[c]};
    }
  }
  for (const k of ['categories','subscriptions','stepGoals','savingsGoals','savingsLog','currentWeekEntries','loans','balanceReadings']) {
    const ba=base[k]||[], ca=cur[k]||[];
    const bById=Object.fromEntries(ba.map(x=>[x.id,x])), cById=Object.fromEntries(ca.map(x=>[x.id,x]));
    for (const id of new Set([...ba.map(x=>x.id),...ca.map(x=>x.id)]))
      if (js(bById[id])!==js(cById[id])) ch[`${k}[${id}]`]={b:bById[id],c:cById[id]};
  }
  const bwa=base.weeklyArchive||[], cwa=cur.weeklyArchive||[];
  const bwaMap=Object.fromEntries(bwa.map(w=>[w.weekStart,w])), cwaMap=Object.fromEntries(cwa.map(w=>[w.weekStart,w]));
  for (const ws of new Set([...bwa.map(w=>w.weekStart),...cwa.map(w=>w.weekStart)])) {
    const bw=bwaMap[ws], cw=cwaMap[ws];
    if (!bw||!cw) { ch[`weeklyArchive[${ws}]`]={b:bw,c:cw}; continue; }
    const beMap=Object.fromEntries((bw.entries||[]).map(e=>[e.id,e])), ceMap=Object.fromEntries((cw.entries||[]).map(e=>[e.id,e]));
    for (const eid of new Set([...Object.keys(beMap),...Object.keys(ceMap)]))
      if (js(beMap[eid])!==js(ceMap[eid])) ch[`weeklyArchive[${ws}].entries[${eid}]`]={b:beMap[eid],c:ceMap[eid]};
  }
  return ch;
}

export function findConflicts(localCh, serverCh) {
  const conflicts=[], mergeLocal={}, mergeServer={};
  for (const k of Object.keys(localCh)) {
    if (serverCh[k]) conflicts.push({key:k, local:localCh[k].c, server:serverCh[k].c});
    else mergeLocal[k]=localCh[k];
  }
  for (const k of Object.keys(serverCh)) if (!localCh[k]) mergeServer[k]=serverCh[k];
  return {conflicts, mergeLocal, mergeServer};
}

export function applyChanges(state, changes) {
  const s=JSON.parse(JSON.stringify(state));
  for (const [key, ch] of Object.entries(changes)) {
    const val=ch.c;
    let m;
    if (key==='years.length') {
      s.years=s.years||[];
      if (val<s.years.length) s.years.length=val;
      else while (s.years.length<val) s.years.push({monthly:{},monthlyOverrides:{}});
      continue;
    }
    m=key.match(/^years\[(\d+)\]\.(.+)$/);
    if (m) {
      const idx=+m[1], rest=m[2];
      if (!s.years[idx]) continue;
      if (rest.startsWith('monthly.')) {
        const cid=rest.slice(8); s.years[idx].monthly=s.years[idx].monthly||{};
        if (val==null) delete s.years[idx].monthly[cid]; else s.years[idx].monthly[cid]=val;
      } else if (rest.startsWith('monthlyOverrides.')) {
        const [mn,cid]=rest.slice(17).split('.');
        s.years[idx].monthlyOverrides=s.years[idx].monthlyOverrides||{};
        s.years[idx].monthlyOverrides[mn]=s.years[idx].monthlyOverrides[mn]||{};
        if (val==null) delete s.years[idx].monthlyOverrides[mn][cid]; else s.years[idx].monthlyOverrides[mn][cid]=val;
      } else { s.years[idx][rest]=val; }
      continue;
    }
    m=key.match(/^(monthDisabled)\.(.+)$/);
    if (m) { s[m[1]]=s[m[1]]||{}; if (val==null) delete s[m[1]][m[2]]; else s[m[1]][m[2]]=val; continue; }
    m=key.match(/^(categories|subscriptions|stepGoals|savingsGoals|savingsLog|currentWeekEntries|loans|balanceReadings)\[(.+)\]$/);
    if (m) {
      const [,arrKey,id]=m; s[arrKey]=s[arrKey]||[];
      const idx=s[arrKey].findIndex(x=>x.id===id);
      if (val==null) { if (idx>=0) s[arrKey].splice(idx,1); }
      else { if (idx>=0) s[arrKey][idx]=val; else s[arrKey].push(val); }
      continue;
    }
    m=key.match(/^weeklyArchive\[(.+)\]\.entries\[(.+)\]$/);
    if (m) {
      const wi=s.weeklyArchive.findIndex(w=>w.weekStart===m[1]); if (wi<0) continue;
      const ei=s.weeklyArchive[wi].entries.findIndex(e=>e.id===m[2]);
      if (val==null) { if (ei>=0) s.weeklyArchive[wi].entries.splice(ei,1); }
      else { if (ei>=0) s.weeklyArchive[wi].entries[ei]=val; else s.weeklyArchive[wi].entries.push(val); }
      continue;
    }
    m=key.match(/^weeklyArchive\[(.+)\]$/);
    if (m) {
      const wi=s.weeklyArchive.findIndex(w=>w.weekStart===m[1]);
      if (val==null) { if (wi>=0) s.weeklyArchive.splice(wi,1); }
      else { if (wi>=0) s.weeklyArchive[wi]=val; else s.weeklyArchive.push(val); }
      continue;
    }
    if (val==null) delete s[key]; else s[key]=val;
  }
  return s;
}

export const MONEY_KEYS=['monthly','budget','housing','amount','grant','tuition','health','income','allowance','target','saved','fee','spendable','savings'];
export function fmtConflictVal(key, val, data) {
  if (val==null) return '(removed)';
  if (typeof val==='boolean') return val?'On':'Off';
  if (typeof val==='number') return MONEY_KEYS.some(mk=>key.toLowerCase().includes(mk))?`$${val.toLocaleString()}`:String(val);
  if (typeof val==='object') {
    // Loan: no top-level `amount`, so total what was actually borrowed from its
    // disbursement rows (mirrors the `name`+`amount` pattern above).
    if (val.name&&val.disbursements) return val.name+` — $${val.disbursements.reduce((a,d)=>a+(Number(d.amount)||0),0).toLocaleString()}`;
    if (val.name) return val.name+(val.amount?` — $${val.amount}`:'');
    if (val.label) return val.label+(val.targetAmount?` — $${val.targetAmount}`:'');
    if (val.catId&&val.amount) { const cat=(data?.categories||[]).find(c=>c.id===val.catId); return `${cat?.label||val.catId}: $${val.amount}`; }
    // Balance reading: {date, spendable, savings} — show the date plus both amounts.
    if (val.date&&val.spendable!=null) return `${val.date} — $${val.spendable.toLocaleString()}${val.savings!=null?` (+ $${val.savings.toLocaleString()} savings)`:''}`;
    return JSON.stringify(val);
  }
  return String(val);
}
export function conflictLabel(key, data) {
  const cats=data?.categories||[], catLabel=id=>cats.find(c=>c.id===id)?.label||id;
  const YN=['Year 1','Year 2','Year 3','Year 4'];  // beyond this, the +1 fallback labels "Year N"
  let m;
  m=key.match(/^years\[(\d+)\]\.monthly\.(.+)$/);         if (m) return `${YN[+m[1]]||'Year '+(+m[1]+1)} — ${catLabel(m[2])} budget`;
  m=key.match(/^years\[(\d+)\]\.monthlyOverrides\.(\w+)\.(.+)$/); if (m) return `${YN[+m[1]]||'Year '+(+m[1]+1)} — ${catLabel(m[3])} override (${m[2]})`;
  m=key.match(/^years\[(\d+)\]\.(.+)$/);                  if (m) return `${YN[+m[1]]||'Year '+(+m[1]+1)} — ${({grant:'Grant',tuitionFees:'Tuition',healthIns:'Health ins.',otherIncome:'Other income',housing:'Housing',housingNote:'Housing note',notes:'Notes',startDate:'Start date',endDate:'End date'})[m[2]]||m[2]}`;
  m=key.match(/^stepGoals\[(.+)\]$/);                      if (m) { const g=(data?.stepGoals||[]).find(g=>g.id===m[1]); return `Step goal: ${g?.label||m[1]}`; }
  m=key.match(/^savingsGoals\[(.+)\]$/);                   if (m) { const g=(data?.savingsGoals||[]).find(g=>g.id===m[1]); return `Savings goal: ${g?.label||m[1]}`; }
  m=key.match(/^subscriptions\[(.+)\]$/);                  if (m) { const s=(data?.subscriptions||[]).find(s=>s.id===m[1]); return `Subscription: ${s?.name||m[1]}`; }
  m=key.match(/^categories\[(.+)\]$/);                     if (m) return `Category: ${catLabel(m[1])}`;
  m=key.match(/^loans\[(.+)\]$/);                          if (m) { const l=(data?.loans||[]).find(l=>l.id===m[1]); return `Loan: ${l?.name||m[1]}`; }
  m=key.match(/^balanceReadings\[(.+)\]$/);                if (m) { const r=(data?.balanceReadings||[]).find(r=>r.id===m[1]); return `Balance check-in (${r?.date||m[1]})`; }
  return ({darkMode:'Dark mode',logo:'App logo',loanReminderSnooze:'Loan reminder',refundPlaybookSeen:'Refund playbook seen'})[key]||key;
}
(function(){setInterval(()=>{const now=new Date();if(now.getDay()===0&&now.getHours()===23&&now.getMinutes()===59)window._triggerArchive&&window._triggerArchive()},60000)})();
