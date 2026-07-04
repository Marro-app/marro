import React, { Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { needsEagerSupabase } from './lib/data.js';
import { SilentUpdater } from './SilentUpdater.jsx';

// Both the full app and the marketing landing are lazy — a logged-out cold
// load must download/parse ONLY the landing's own module graph, never
// App.jsx's (onboarding, modals, schools/brands data, avatars, primitives,
// pickers, LoginScreen, etc). `needsEagerSupabase()` (lib/data.js — a tiny
// sync check with no heavy deps at eval time) decides which lazy branch to
// render below, so App.jsx is only ever imported for a returning signed-in
// user or an OAuth/PKCE sign-in callback.
const App = React.lazy(() => import('./App.jsx').then(m => ({ default: m.App })));
const LandingPage = React.lazy(() => import('./landing/LandingPage.jsx'));

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
// cache; back it with localStorage. Set before render so the boot effect sees it.
window.storage={get:async(key)=>{try{const v=localStorage.getItem(key);return v?{key,value:v}:null}catch{return null}},set:async(key,value)=>{try{localStorage.setItem(key,value);return{key,value}}catch{return null}},delete:async(key)=>{try{localStorage.removeItem(key);return{key,deleted:true}}catch{return null}},list:async(prefix)=>{try{return{keys:Object.keys(localStorage).filter(k=>!prefix||k.startsWith(prefix))}}catch{return{keys:[]}}}};

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
          replaysSessionSampleRate: 0,
          replaysOnErrorSampleRate: 0,
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

// Boot gate: decide ONCE, synchronously, before rendering — a returning
// signed-in user (cached session token) or an in-flight OAuth/PKCE callback
// takes the App path; everything else (the common cold, logged-out visitor)
// takes the landing-only path and never imports App.jsx at all.
const eager = needsEagerSupabase();

const root=createRoot(document.getElementById('root'));
root.render(
  <React.Fragment>
    <ErrorBoundary fallback={<CrashFallback/>}>
      <Suspense fallback={<BootFallback/>}>
        {eager ? <App/> : <LandingPage offline={!navigator.onLine}/>}
      </Suspense>
      <SilentUpdater/>
    </ErrorBoundary>
  </React.Fragment>
);

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
