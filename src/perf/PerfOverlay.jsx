import React, { useEffect, useState } from 'react';

// On-device performance overlay — mounted from main.jsx ONLY when the URL
// has ?perf. Dependency-free (raw browser Performance APIs) so it never
// touches the production bundle's weight or behavior. This is read on a
// phone screen while standing next to the founder, so: big text, high
// contrast, one glance = one number. Every API call is guarded — iOS Safari
// has partial/no support for several of these (longtask, connection, First
// Paint timing quirks) and this must never throw or break the real app.
//
// aria-hidden: this is a debug tool for the founder, not part of the product
// UI, so it's intentionally excluded from the accessibility tree rather than
// held to the same a11y bar as real app surfaces.

const row = { display: 'flex', justifyContent: 'space-between', gap: 12, padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.12)' };
const label = { color: '#9fd8ff', fontWeight: 600 };
const value = { color: '#fff', fontWeight: 700, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };

function fmt(ms){
  if (ms == null || Number.isNaN(ms)) return 'n/a';
  return `${Math.round(ms)} ms`;
}

function safeNav(){
  try {
    const [nav] = performance.getEntriesByType('navigation');
    return nav || null;
  } catch { return null; }
}

function computeNavMetrics(){
  const nav = safeNav();
  if (!nav) return null;
  try {
    return {
      ttfb: nav.responseStart - nav.requestStart,
      dns: nav.domainLookupEnd - nav.domainLookupStart,
      tcp: nav.connectEnd - nav.connectStart,
      tls: nav.secureConnectionStart > 0 ? nav.connectEnd - nav.secureConnectionStart : null,
      download: nav.responseEnd - nav.responseStart,
      dcl: nav.domContentLoadedEventEnd - nav.startTime,
      load: nav.loadEventEnd > 0 ? nav.loadEventEnd - nav.startTime : null,
    };
  } catch { return null; }
}

function computePaintMetrics(){
  try {
    const entries = performance.getEntriesByType('paint') || [];
    const fp = entries.find(e => e.name === 'first-paint');
    const fcp = entries.find(e => e.name === 'first-contentful-paint');
    return {
      fp: fp ? fp.startTime : null,
      fcp: fcp ? fcp.startTime : null,
    };
  } catch { return { fp: null, fcp: null }; }
}

function computeLandingReady(){
  try {
    const marks = performance.getEntriesByName('marro-landing-ready');
    if (marks && marks.length) return marks[0].startTime;
  } catch { /* no-op */ }
  return null;
}

function getMarkTime(name){
  try {
    const marks = performance.getEntriesByName(name, 'mark');
    if (marks && marks.length) return marks[0].startTime;
  } catch { /* no-op */ }
  return null;
}

// Boot-phase marks set once (first boot only) in main.jsx / App.jsx. Each is
// an absolute timestamp (ms from navigation start, same clock as performance.now()).
function computeBootPhases(){
  try {
    const renderCall = getMarkTime('boot:render-call');
    const appFirstRender = getMarkTime('boot:app-first-render');
    const sessionDecided = getMarkTime('boot:session-decided');
    const landingImportStart = getMarkTime('boot:landing-import-start');
    const landingImportDone = getMarkTime('boot:landing-import-done');
    const landingReady = computeLandingReady();
    const delta = (a, b) => (a != null && b != null) ? (b - a) : null;
    return {
      toRenderCall: renderCall,
      renderToAppRender: delta(renderCall, appFirstRender),
      appRenderToSessionDecided: delta(appFirstRender, sessionDecided),
      sessionToLandingImportStart: delta(sessionDecided, landingImportStart),
      landingImportDuration: delta(landingImportStart, landingImportDone),
      importDoneToLandingReady: delta(landingImportDone, landingReady),
    };
  } catch {
    return {
      toRenderCall: null, renderToAppRender: null, appRenderToSessionDecided: null,
      sessionToLandingImportStart: null, landingImportDuration: null, importDoneToLandingReady: null,
    };
  }
}

function computeJsAndTransfer(){
  try {
    const resources = performance.getEntriesByType('resource') || [];
    let jsFromCache = 0, jsFromNetwork = 0, jsTransferred = 0;
    let totalTransferred = 0;
    for (const r of resources) {
      const size = typeof r.transferSize === 'number' ? r.transferSize : 0;
      totalTransferred += size;
      const isJs = r.initiatorType === 'script' || /\.js(\?|$)/.test(r.name);
      if (isJs) {
        if (size === 0) jsFromCache += 1;
        else { jsFromNetwork += 1; jsTransferred += size; }
      }
    }
    return {
      jsFromCache, jsFromNetwork, jsTransferredKB: jsTransferred / 1024,
      totalTransferredKB: totalTransferred / 1024,
      resourceCount: resources.length,
    };
  } catch {
    return { jsFromCache: null, jsFromNetwork: null, jsTransferredKB: null, totalTransferredKB: null, resourceCount: null };
  }
}

// The KEY bisection: is the pre-render time spent DOWNLOADING the JS or
// PARSING/EXECUTING it? `entryFinishedAt` = when the first-loaded script
// finished downloading (ms from nav start). Compare it to boot:render-call:
// if entryFinishedAt ≈ render-call, the time was network (download/CDN); if
// entryFinishedAt is small but render-call is large, the time was CPU (parse/exec).
function computeScriptTiming(){
  try {
    const resources = performance.getEntriesByType('resource') || [];
    const scripts = resources.filter(r => r.initiatorType === 'script' || /\.js(\?|$)/.test(r.name));
    if (!scripts.length) return { entryName: null, entryFinishedAt: null, entryFetchDur: null, slowestName: null, slowestDur: null };
    const nameOf = r => { try { return r.name.split('/').pop().split('?')[0]; } catch { return r.name; } };
    const entry = scripts.reduce((a, b) => (b.startTime < a.startTime ? b : a));
    let slowest = null;
    for (const r of scripts) {
      const dur = r.responseEnd - r.startTime;
      if ((r.transferSize > 0 || dur > 0) && (!slowest || dur > (slowest.responseEnd - slowest.startTime))) slowest = r;
    }
    return {
      entryName: nameOf(entry),
      entryFinishedAt: entry.responseEnd,
      entryFetchDur: entry.responseEnd - entry.startTime,
      slowestName: slowest ? nameOf(slowest) : null,
      slowestDur: slowest ? (slowest.responseEnd - slowest.startTime) : null,
    };
  } catch {
    return { entryName: null, entryFinishedAt: null, entryFetchDur: null, slowestName: null, slowestDur: null };
  }
}

export default function PerfOverlay(){
  const [visible, setVisible] = useState(true);
  const [nav, setNav] = useState(() => computeNavMetrics());
  const [paint, setPaint] = useState(() => computePaintMetrics());
  const [landingReady, setLandingReady] = useState(() => computeLandingReady());
  const [bootPhases, setBootPhases] = useState(() => computeBootPhases());
  const [lcp, setLcp] = useState(null);
  const [longTask, setLongTask] = useState(null);
  const [longTaskSupported, setLongTaskSupported] = useState(true);
  const [resources, setResources] = useState(() => computeJsAndTransfer());
  const [scriptTiming, setScriptTiming] = useState(() => computeScriptTiming());
  const [connType, setConnType] = useState(() => {
    try { return navigator.connection?.effectiveType || null; } catch { return null; }
  });

  useEffect(() => {
    // Poll for values that aren't ready yet at mount (nav timing completes
    // after load, paint entries can lag slightly, landing-ready mark fires
    // on the landing's first effect). Cheap — low-frequency, short-lived.
    const id = setInterval(() => {
      setNav(prev => prev && prev.load != null ? prev : (computeNavMetrics() || prev));
      setPaint(prev => (prev && prev.fp != null && prev.fcp != null) ? prev : computePaintMetrics());
      setLandingReady(prev => prev != null ? prev : computeLandingReady());
      setResources(computeJsAndTransfer());
      setScriptTiming(computeScriptTiming());
      setBootPhases(computeBootPhases());
    }, 500);
    // Stop polling after 15s — this is a diagnostic snapshot, not a live monitor.
    const stop = setTimeout(() => clearInterval(id), 15000);
    return () => { clearInterval(id); clearTimeout(stop); };
  }, []);

  useEffect(() => {
    let po;
    try {
      po = new PerformanceObserver((list) => {
        const entries = list.getEntries();
        const last = entries[entries.length - 1];
        if (last) setLcp(last.renderTime || last.loadTime || last.startTime);
      });
      po.observe({ type: 'largest-contentful-paint', buffered: true });
    } catch { /* unsupported */ }
    return () => { try { po?.disconnect(); } catch { /* no-op */ } };
  }, []);

  useEffect(() => {
    let po;
    try {
      po = new PerformanceObserver((list) => {
        const entries = list.getEntries();
        for (const e of entries) {
          setLongTask(prev => (prev == null || e.duration > prev) ? e.duration : prev);
        }
      });
      po.observe({ type: 'longtask', buffered: true });
    } catch {
      setLongTaskSupported(false);
    }
    return () => { try { po?.disconnect(); } catch { /* no-op */ } };
  }, []);

  if (!visible) return null;

  const ua = (() => { try { return navigator.userAgent; } catch { return 'n/a'; } })();

  return (
    <div
      aria-hidden="true"
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 2147483647,
        background: 'rgba(10,10,14,0.96)', color: '#fff',
        fontFamily: '-apple-system, system-ui, sans-serif',
        fontSize: 15, lineHeight: 1.4, padding: '12px 14px 16px',
        maxHeight: '70vh', overflowY: 'auto',
        boxShadow: '0 4px 24px rgba(0,0,0,0.5)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ fontSize: 17, fontWeight: 800, color: '#ffd479' }}>Marro Perf</div>
        <button
          onClick={() => setVisible(false)}
          style={{
            minWidth: 44, minHeight: 44, background: 'transparent', color: '#fff',
            border: '1px solid rgba(255,255,255,0.4)', borderRadius: 10,
            fontSize: 20, lineHeight: 1, cursor: 'pointer',
          }}
        >
          ✕
        </button>
      </div>

      <div style={row}><span style={label}>TTFB</span><span style={value}>{fmt(nav?.ttfb)}</span></div>
      <div style={row}><span style={label}>DNS</span><span style={value}>{fmt(nav?.dns)}</span></div>
      <div style={row}><span style={label}>TCP connect</span><span style={value}>{fmt(nav?.tcp)}</span></div>
      <div style={row}><span style={label}>TLS</span><span style={value}>{fmt(nav?.tls)}</span></div>
      <div style={row}><span style={label}>Response download</span><span style={value}>{fmt(nav?.download)}</span></div>
      <div style={row}><span style={label}>DOMContentLoaded</span><span style={value}>{fmt(nav?.dcl)}</span></div>
      <div style={row}><span style={label}>Load event</span><span style={value}>{fmt(nav?.load)}</span></div>
      <div style={row}><span style={label}>First Paint</span><span style={value}>{fmt(paint?.fp)}</span></div>
      <div style={row}><span style={label}>First Contentful Paint</span><span style={value}>{fmt(paint?.fcp)}</span></div>
      <div style={row}><span style={label}>LCP</span><span style={value}>{fmt(lcp)}</span></div>
      <div style={row}><span style={label}>App interactive (landing ready)</span><span style={value}>{fmt(landingReady)}</span></div>

      <div style={{ marginTop: 10, marginBottom: 2, fontSize: 13, fontWeight: 800, color: '#ffd479', textTransform: 'uppercase', letterSpacing: 0.4 }}>Boot phases (ms)</div>
      <div style={row}><span style={label}>→ render() call</span><span style={value}>{fmt(bootPhases.toRenderCall)}</span></div>
      <div style={row}><span style={label}>render → App render</span><span style={value}>{fmt(bootPhases.renderToAppRender)}</span></div>
      <div style={row}><span style={label}>App render → session decided</span><span style={value}>{fmt(bootPhases.appRenderToSessionDecided)}</span></div>
      <div style={row}><span style={label}>session → landing import start</span><span style={value}>{fmt(bootPhases.sessionToLandingImportStart)}</span></div>
      <div style={row}><span style={label}>landing import (fetch+parse)</span><span style={value}>{fmt(bootPhases.landingImportDuration)}</span></div>
      <div style={row}><span style={label}>import done → landing ready</span><span style={value}>{fmt(bootPhases.importDoneToLandingReady)}</span></div>

      <div style={row}><span style={label}>Longest task</span><span style={value}>{longTaskSupported ? fmt(longTask) : 'n/a (unsupported)'}</span></div>
      <div style={{ ...row, background: 'rgba(255,212,121,0.12)', borderRadius: 8, padding: '8px 6px' }}>
        <span style={{ ...label, color: '#ffd479' }}>JS cache/network</span>
        <span style={value}>
          {resources.jsFromCache == null
            ? 'n/a'
            : `${resources.jsFromCache} from cache / ${resources.jsFromNetwork} from network (${Math.round(resources.jsTransferredKB)} KB)`}
        </span>
      </div>
      <div style={row}><span style={label}>Total transferred</span><span style={value}>{resources.totalTransferredKB == null ? 'n/a' : `${Math.round(resources.totalTransferredKB)} KB`}</span></div>
      <div style={row}><span style={label}>Resource count</span><span style={value}>{resources.resourceCount ?? 'n/a'}</span></div>

      <div style={{ marginTop: 10, marginBottom: 2, fontSize: 13, fontWeight: 800, color: '#ffd479', textTransform: 'uppercase', letterSpacing: 0.4 }}>Download vs CPU (the key bisection)</div>
      <div style={{ ...row, background: 'rgba(255,212,121,0.12)', borderRadius: 8, padding: '8px 6px' }}><span style={{ ...label, color: '#ffd479' }}>Entry JS finished @</span><span style={value}>{fmt(scriptTiming.entryFinishedAt)}</span></div>
      <div style={row}><span style={label}>Entry JS fetch ({scriptTiming.entryName || '?'})</span><span style={value}>{fmt(scriptTiming.entryFetchDur)}</span></div>
      <div style={row}><span style={label}>Slowest JS fetch</span><span style={value}>{scriptTiming.slowestDur == null ? 'n/a' : `${Math.round(scriptTiming.slowestDur)} ms (${scriptTiming.slowestName})`}</span></div>
      <div style={row}><span style={label}>Connection</span><span style={value}>{connType || 'n/a (iOS)'}</span></div>
      <div style={{ marginTop: 6, fontSize: 11, color: 'rgba(255,255,255,0.55)', wordBreak: 'break-all' }}>{ua}</div>
    </div>
  );
}
