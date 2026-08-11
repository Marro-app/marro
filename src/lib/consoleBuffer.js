// ── Console error ring buffer (Slice 9, plan §7) ────────────────────────────
// A tiny in-memory record of the last few console.error calls, installed at
// boot (main.jsx, alongside analytics). Read ONLY when a user submits a bug
// report, where it rides along in tech_context — technical data only, never
// financial (plan §4): messages are stringified, truncated, and never include
// app state. Nothing is sent anywhere on its own.
const MAX_ERRORS = 10;
const MAX_LEN = 300;
const buffer = [];
let installed = false;

function toLine(args) {
  try {
    return args.map((a) => {
      if (typeof a === 'string') return a;
      if (a instanceof Error) return `${a.name}: ${a.message}`;
      try { return JSON.stringify(a); } catch { return String(a); }
    }).join(' ').slice(0, MAX_LEN);
  } catch {
    return '[unserializable console.error]';
  }
}

export function installConsoleBuffer() {
  if (installed || typeof console === 'undefined') return;
  installed = true;
  const original = console.error;
  console.error = (...args) => {
    try {
      buffer.push({ at: new Date().toISOString(), msg: toLine(args) });
      if (buffer.length > MAX_ERRORS) buffer.shift();
    } catch { /* the buffer must never break console.error itself */ }
    original.apply(console, args);
  };
}

// Snapshot for a bug report's tech_context.
export function recentErrors() {
  return buffer.map((e) => ({ ...e }));
}

// Everything a bug report attaches (plan §7): environment + the error tail.
// Deliberately excludes any app/user/financial state.
export function buildTechContext() {
  try {
    return {
      url: `${window.location.pathname}${window.location.hash || ''}`,
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      ua: navigator.userAgent,
      online: navigator.onLine,
      reduced_motion: window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches || false,
      color_scheme: window.matchMedia?.('(prefers-color-scheme: dark)')?.matches ? 'dark' : 'light',
      errors: recentErrors(),
    };
  } catch {
    return { errors: recentErrors() };
  }
}
