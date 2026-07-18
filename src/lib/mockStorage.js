// ── Dev-only test harness: storage isolation for mock mode ──────────────────
// The app's normal local-cache code (App.jsx's sync engine, main.jsx's
// `window.storage` shim) reads/writes a handful of real localStorage keys —
// "marro_v8", SYNC_BASE_KEY ("marro_v8_base"), "marro_uid", "marro_theme_v2",
// "marro_aidnote_dismissed" — completely independent of mock mode. Left
// unguarded, a mock session would (a) persist edits into those SAME keys
// across reloads, breaking the "reload = fresh seed" test contract, and (b)
// be able to read or clobber a REAL signed-in user's cached data on the same
// browser/origin. Neither is acceptable for a dev harness.
//
// `appStorage` is a drop-in localStorage-shaped object (getItem/setItem/
// removeItem):
//   - in real mode, it IS `window.localStorage` — zero behavior change.
//   - in mock mode, it's a plain in-memory Map, private to this module
//     instance. It never touches window.localStorage at all, so mock writes
//     can never land in a real key, and a real key's contents (if any exist
//     on this browser) can never be read by mock code. Because it's created
//     fresh at module-evaluation time, a genuine page reload (a new JS
//     realm, not just a React remount) always starts it empty — every
//     `?mock=1` boot begins from the exact seed, never a previous mock run's
//     edits.
import { isMockModeActive } from './mockSession.js';

function createMemoryStorage() {
  const mem = new Map();
  return {
    getItem: (key) => (mem.has(key) ? mem.get(key) : null),
    setItem: (key, value) => { mem.set(key, String(value)); },
    removeItem: (key) => { mem.delete(key); },
  };
}

const useMemoryStorage = import.meta.env.DEV && isMockModeActive();

export const appStorage = useMemoryStorage ? createMemoryStorage() : window.localStorage;
