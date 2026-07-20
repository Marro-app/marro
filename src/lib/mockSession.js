// ── Dev-only test harness gate (FUTURE_WORK.md "Dev-mode test harness") ─────
//
// Lets an automated agent (no Google account, can't complete OAuth) drive the
// FULL signed-in app locally, with a mock session + fake sample data — NOT a
// deployable auth bypass. Two independent gates must BOTH be true:
//   1. `import.meta.env.DEV` — Vite hard-codes this to the literal `false` in
//      any production build (`npm run build`). Every reference to this
//      constant collapses at build time, so the `if` blocks guarded by it
//      become dead, unreachable code that the bundler strips — the harness
//      physically cannot exist in what ships to joinmarro.com. Verified by
//      grepping `dist/` after a build for harness strings (see PR body).
//   2. An explicit opt-in AND localhost — `?mock=1` in the URL (or the
//      `VITE_MOCK_SESSION` dev env var) *and* the page is being served from
//      localhost/127.0.0.1. Even in a dev build, visiting some other host
//      with `?mock=1` does nothing.
//
// This module is the ONLY statically-imported piece of the harness — it's a
// pure boolean check with no session object, no fake data, nothing sensitive.
// The actual mock session + seeded state live in `mockSessionData.js` and
// `mockSupabaseStub.js`, which are only ever reached via dynamic `import()`
// from inside a branch already gated on `isMockModeActive()` — see
// `getSupabase()` in `lib/data.js`. That keeps the real payload out of the
// production bundle even if tree-shaking of the boolean check itself were
// ever imperfect.
export function isMockModeActive() {
  if (!import.meta.env.DEV) return false; // gate 1: dev build only
  try {
    const host = window.location.hostname;
    const isLocalhost = host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
    if (!isLocalhost) return false; // gate 2a: localhost only
    const params = new URLSearchParams(window.location.search);
    const urlOptIn = params.get('mock') === '1';
    const envOptIn = import.meta.env.VITE_MOCK_SESSION === 'true';
    return urlOptIn || envOptIn; // gate 2b: explicit opt-in
  } catch {
    return false; // never let a harness check crash boot
  }
}
