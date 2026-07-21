import React, { Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { needsEagerSupabase, isRecoveryRedirect } from './lib/data.js';
import { appStorage } from './lib/mockStorage.js';
// Eager, statically-imported landing stylesheet — NOT because the landing
// page itself needs to render eagerly (it's still lazy below), but because
// this CSS is what actually styles AuthModal/EmailPasswordForm (.lp-input,
// .lp-authportal, etc). Those live in landingShared.jsx, which is imported
// by LandingPage.jsx, DotsLanding.jsx, and StagedLanding.jsx — all separately
// lazy-loaded — so Vite splits this CSS into its own chunk that's only
// fetched (via a dynamically-injected <link rel="stylesheet">) once one of
// those JS chunks is dynamically imported. That created a real FOUC race in
// production (never in `vite dev`, which injects CSS synchronously as part
// of ES module evaluation): on a fresh page load, clicking "Get Started" /
// "Log in" could open AuthModal and paint its inputs before this stylesheet
// finished loading over the network, rendering them with no visible
// background/border. Importing it here — from `main.jsx`, the one entry
// point that's synchronously loaded on every single visit — guarantees the
// browser has fully fetched and applied it before any lazy landing component
// (or its modal) ever gets a chance to mount, eliminating the race entirely.
import './landing/landing.css';

// Both the full app and the marketing landing are lazy — a logged-out cold
// load must download/parse ONLY the landing's own module graph, never
// App.jsx's (onboarding, modals, schools/brands data, avatars, primitives,
// pickers, LoginScreen, etc). `needsEagerSupabase()` (lib/data.js — a tiny
// sync check with no heavy deps at eval time) decides which lazy branch to
// render below, so App.jsx is only ever imported for a returning signed-in
// user or an OAuth/PKCE sign-in callback.
const App = React.lazy(() => import('./App.jsx').then(m => ({ default: m.App })));
const LandingPage = React.lazy(() => import('./landing/LandingPage.jsx'));

// Password-recovery emails redirect back here with a `?reset=1` marker (see
// `resetPasswordForEmail`'s redirectTo in EmailPasswordForm.jsx) ALONGSIDE the
// normal PKCE `?code=...` param Supabase also appends. Without this check,
// `needsEagerSupabase()` would see that `code` param, decide "OAuth/sign-in
// callback", and eagerly render the full signed-in App — silently completing
// the recovery sign-in and dropping the user straight into their real data
// instead of a "set a new password" screen. This check runs synchronously,
// BEFORE `needsEagerSupabase()` / the App-vs-Landing decision, and short-
// circuits straight to a dedicated ResetPasswordGate — so there is no frame
// where the real App can flash on screen. Checked here (not deferred to a
// PASSWORD_RECOVERY auth-event listener) precisely because that event only
// fires AFTER supabase-js exchanges the code client-side, which is already
// too late to prevent App.jsx from having been chosen as the render target.
const ResetPasswordGate = React.lazy(() => import('./landing/ResetPasswordGate.jsx'));

// Minimal, dependency-free fallback — must not import anything heavy (no
// MarroIntro, no theme helpers). Just enough to avoid a blank screen while
// the chosen lazy chunk downloads.
const BootFallback = () => (
  <div style={{minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center'}} aria-hidden="true">
    <div style={{
      width:28,height:28,borderRadius:'50%',
      border:'2px solid rgba(128,128,128,0.25)',borderTopColor:'rgba(128,128,128,0.7)',
      animation:'marro-boot-spin 0.8s linear infinite',
    }}/>
    <style>{'@keyframes marro-boot-spin{to{transform:rotate(360deg)}}'}</style>
  </div>
);

// localStorage shim — the app talks to `window.storage` (async KV) for its local
// cache; back it with localStorage (or, in mock mode, an isolated in-memory
// store — see lib/mockStorage.js — so mock sessions never touch a real user's
// cached data and always start from a fresh seed on reload). Set before
// render so the boot effect sees it.
window.storage={get:async(key)=>{try{const v=appStorage.getItem(key);return v?{key,value:v}:null}catch{return null}},set:async(key,value)=>{try{appStorage.setItem(key,value);return{key,value}}catch{return null}},delete:async(key)=>{try{appStorage.removeItem(key);return{key,deleted:true}}catch{return null}},list:async(prefix)=>{try{const keys=appStorage===window.localStorage?Object.keys(localStorage):[];return{keys:keys.filter(k=>!prefix||k.startsWith(prefix))}}catch{return{keys:[]}}}};

const CrashFallback = () => (
  <div role="alert" style={{
    minHeight:'100vh',display:'flex',flexDirection:'column',alignItems:'center',
    justifyContent:'center',gap:16,padding:24,textAlign:'center',
    background:'var(--bg)',color:'var(--text)',
  }}>
    <svg width="40" height="40" viewBox="0 0 26 26" fill="none" stroke="var(--text-dim)" strokeWidth="1.2" aria-hidden="true">
      <g transform="translate(13,13)"><circle r="11"/><circle r="7.5"/><circle r="4" opacity="0.72"/></g>
    </svg>
    <div style={{fontSize:15,color:'var(--text-dim)',maxWidth:340}}>
      Something went wrong. Your data is safe — reloading should fix it.
    </div>
    <button
      onClick={()=>window.location.reload()}
      style={{
        minHeight:44,minWidth:44,padding:'10px 20px',borderRadius:12,
        border:'1px solid var(--text-dim)',background:'transparent',color:'var(--text)',
        fontSize:15,cursor:'pointer',
      }}
    >
      Reload
    </button>
    {/* Dead-end escape hatch: if reload doesn't fix it, a crashed app must
        never leave the user with no way forward. Real mailto <a> (not a
        button+window.open) so it's keyboard-reachable, works with Cmd/Ctrl-
        click, and survives even if this boundary caught the error because
        JS itself is in a bad state. --text/--text-dim are the same themed
        vars the rest of this screen uses, so contrast holds in both themes;
        underline substitutes for the app's global a:focus-visible ring in
        case that CSS never loaded (the failure mode this screen exists for). */}
    <div style={{fontSize:13,color:'var(--text-dim)'}}>
      Still stuck? Email{' '}
      <a href="mailto:hello@joinmarro.com?subject=Marro%20crash" style={{color:'var(--text)',textDecoration:'underline'}}>
        hello@joinmarro.com
      </a>
    </div>
  </div>
);

// Plain React error boundary — no Sentry import here. Sentry is loaded lazily
// (see below) well after first paint, so the boundary must work fully without
// it. If Sentry has finished loading by the time an error is caught, we
// forward it via a module-level ref (`sentryRef`) set once init resolves;
// otherwise the error is simply left to Sentry's own global handlers (or
// swallowed if Sentry hasn't loaded yet — the fallback UI still renders).
let sentryRef = null;
class ErrorBoundary extends React.Component {
  constructor(props){
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError(){
    return { hasError: true };
  }
  componentDidCatch(error, info){
    try { sentryRef?.captureException?.(error, { extra: info }); } catch { /* no-op */ }
  }
  render(){
    if (this.state.hasError) return this.props.fallback;
    return this.props.children;
  }
}

// Error monitoring — DSN is safe to expose client-side (write-only, same trust
// model as the Supabase anon key). Deferred: @sentry/react is NOT statically
// imported, so it never lands in the initial bundle and its init never runs
// on first paint — including on the logged-out marketing landing, which is
// the highest-traffic, most performance-sensitive page in the app. Instead we
// dynamically import it after the window 'load' event plus a short delay, off
// the critical path. (No requestIdleCallback — iOS Safari doesn't have it.)
if (import.meta.env.PROD && import.meta.env.VITE_SENTRY_DSN) {
  const initSentryDeferred = () => {
    setTimeout(() => {
      import('@sentry/react').then((Sentry) => {
        Sentry.init({
          dsn: import.meta.env.VITE_SENTRY_DSN,
          environment: import.meta.env.MODE,
          tracesSampleRate: 0.1,
          // Crash-only replay: never record healthy sessions
          // (replaysSessionSampleRate: 0), only the session that just
          // crashed (replaysOnErrorSampleRate: 1.0) — keeps volume far
          // under the free-tier 50-replays/month cap while still giving us
          // a replay for every crash we'd want to debug.
          replaysSessionSampleRate: 0,
          replaysOnErrorSampleRate: 1.0,
          integrations: [
            // privacy: mask all financial data — never send real amounts/PII
            // to Sentry, per DATA_ETHICS. This is a financial app (loan
            // balances, aid amounts, budgets, names, emails) — replay must
            // only ever capture screen STRUCTURE/layout (which screen, what
            // broke), never actual values. All three flags below are set
            // explicitly (even where they match current defaults) so a
            // future dev/SDK upgrade can't silently unmask real data.
            Sentry.replayIntegration({
              maskAllText: true,
              maskAllInputs: true,
              blockAllMedia: true,
            }),
          ],
        });
        // Sentry's own global handlers (window.onerror / unhandledrejection)
        // are installed by init() and keep working after this point — the
        // ref below is only for errors caught by our React boundary.
        sentryRef = Sentry;
      }).catch(() => { /* Sentry failed to load — app still works fine */ });
    }, 2000);
  };
  if (document.readyState === 'complete') {
    initSentryDeferred();
  } else {
    window.addEventListener('load', initSentryDeferred, { once: true });
  }
}

try { performance.mark('boot:render-call'); } catch { /* diagnostic only */ }

// Boot gate: decide ONCE, synchronously, before rendering. Recovery-redirect
// links are checked FIRST (see comment above) so they can never fall through
// to the App path. Otherwise: a returning signed-in user (cached session
// token) or an in-flight OAuth/PKCE callback takes the App path; everything
// else (the common cold, logged-out visitor) takes the landing-only path and
// never imports App.jsx at all.
const recovery = isRecoveryRedirect();
const eager = !recovery && needsEagerSupabase();

const root=createRoot(document.getElementById('root'));
root.render(
  <React.Fragment>
    <ErrorBoundary fallback={<CrashFallback/>}>
      <Suspense fallback={<BootFallback/>}>
        {recovery
          ? <ResetPasswordGate/>
          : (eager ? <App/> : <LandingPage offline={!navigator.onLine}/>)}
      </Suspense>
    </ErrorBoundary>
  </React.Fragment>
);

// PWA silent-update registration — SilentUpdater (and the virtual:pwa-register
// / workbox-window module graph it drags in) must NOT block first paint. It's
// dynamically imported and mounted into its own small root after the window
// 'load' event plus a short delay, same deferred pattern as Sentry above.
// (No requestIdleCallback — iOS Safari doesn't have it.)
const mountSilentUpdaterDeferred = () => {
  setTimeout(() => {
    import('./SilentUpdater.jsx').then(({ SilentUpdater }) => {
      const suRoot = document.createElement('div');
      suRoot.id = 'marro-silent-updater-root';
      document.body.appendChild(suRoot);
      createRoot(suRoot).render(<SilentUpdater/>);
    }).catch(() => { /* SW update flow only — fail silently */ });
  }, 1500);
};
if (document.readyState === 'complete') {
  mountSilentUpdaterDeferred();
} else {
  window.addEventListener('load', mountSilentUpdaterDeferred, { once: true });
}

// On-device performance overlay — dependency-free, mounted only when the URL
// has ?perf (e.g. https://joinmarro.com/?perf on the founder's phone). Never
// shown to normal visitors. Lazy-imported so it costs nothing when absent.
if (new URLSearchParams(location.search).has('perf')) {
  import('./perf/PerfOverlay.jsx').then(({ default: PerfOverlay }) => {
    const perfRoot = document.createElement('div');
    perfRoot.id = 'marro-perf-overlay-root';
    document.body.appendChild(perfRoot);
    createRoot(perfRoot).render(<PerfOverlay />);
  }).catch(() => { /* diagnostic tool only — fail silently */ });
}
