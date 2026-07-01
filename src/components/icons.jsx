import React, { useState, useEffect, useCallback } from 'react';
import { C } from '../lib/theme.js';
import { getBrand, getBrandDomain } from '../lib/brands.js';

export const BrandIcon = ({name, size=36}) => {
  const domain = getBrandDomain(name);
  const b = getBrand(name);
  const bg = b?.bg || "#64748b";
  const fg = b?.fg || "#fff";
  const txt = b?.letter || (name||"?")[0].toUpperCase();
  const fontSize = txt.length > 2 ? size*0.28 : txt.length > 1 ? size*0.34 : size*0.44;
  const [imgErr, setImgErr] = useState(false);
  const faviconUrl = domain && !imgErr ? `https://www.google.com/s2/favicons?domain=${domain}&sz=128` : null;
  return faviconUrl ? (
    <div style={{width:size,height:size,borderRadius:size*0.22,overflow:"hidden",flexShrink:0,background:"#fff",display:"flex",alignItems:"center",justifyContent:"center"}}>
      <img src={faviconUrl} alt="" width={size*0.7} height={size*0.7} style={{objectFit:"contain",imageRendering:"-webkit-optimize-contrast"}} onError={()=>setImgErr(true)}/>
    </div>
  ) : (
    <div style={{
      width:size, height:size, borderRadius:size*0.22,
      background:bg, color:fg, display:"flex", alignItems:"center",
      justifyContent:"center", fontWeight:700, fontSize,
      flexShrink:0, fontFamily:"system-ui,sans-serif", letterSpacing:"-0.03em",
      userSelect:"none",
    }}>{txt}</div>
  );
};

// ── Marro icon system ─────────────────────────────────────────────────────────
// Ring-derived line icons drawn on a 20×20 grid: stroke 1.4, round caps/joins,
// currentColor — echoing the growth-rings logo. The marigold center dot appears
// only on `savings` and `live` (brand accent, used sparingly). Paths are
// functions so theme-dependent fills resolve at render time.
const ICONS = {
  close:    () => <path d="M6 6l8 8M14 6l-8 8"/>,
  plus:     () => <path d="M10 4.5v11M4.5 10h11"/>,
  check:    () => <path d="M5 10.5l3.2 3.2L15 6.8"/>,
  chevron:  () => <path d="M5.5 8l4.5 4.5L14.5 8"/>,
  sun:      () => <><circle cx="10" cy="10" r="3.4"/><path d="M10 2.8v2M10 15.2v2M2.8 10h2M15.2 10h2M4.9 4.9l1.4 1.4M13.7 13.7l1.4 1.4M15.1 4.9l-1.4 1.4M6.3 13.7l-1.4 1.4"/></>,
  moon:     () => <path d="M15.6 12.4A6.3 6.3 0 1 1 7.6 4.4a5.1 5.1 0 0 0 8 8Z"/>,
  star:     () => <path d="M10 3.2l1.5 5.3 5.3 1.5-5.3 1.5L10 16.8l-1.5-5.3L3.2 10l5.3-1.5Z"/>,
  info:     () => <><circle cx="10" cy="10" r="7"/><path d="M10 9.2v4"/><circle cx="10" cy="6.6" r="0.5" fill="currentColor" stroke="none"/></>,
  live:     () => <><circle cx="10" cy="10" r="6.5"/><circle cx="10" cy="10" r="1.8" fill="currentColor" stroke="none"/></>,
  dot:      () => <circle cx="10" cy="10" r="6.5"/>,
  housing:  () => <path d="M4 9.8L10 4.4l6 5.4M5.6 8.6v6.9h8.8V8.6"/>,
  food:     () => <><path d="M4.4 11.2h11.2a5.6 5.6 0 0 1-11.2 0Z"/><path d="M8.2 8.6c0-1 .9-1.2.9-2.2M11.1 8.6c0-1 .9-1.2.9-2.2"/></>,
  transport:() => <><circle cx="10" cy="10" r="6.5"/><circle cx="10" cy="10" r="2.1"/><path d="M10 3.5v4M10 12.5v4M3.5 10h4M12.5 10h4"/></>,
  personal: () => <path d="M10 16.2s-5.6-3.5-5.6-7.2A3.2 3.2 0 0 1 10 6.8a3.2 3.2 0 0 1 5.6 2.2c0 3.7-5.6 7.2-5.6 7.2Z"/>,
  books:    () => <path d="M10 5.6C8.4 4.2 6 4.2 4.2 4.7V15c1.8-.5 4.2-.4 5.8 1 1.6-1.4 4-1.5 5.8-1V4.7C14 4.2 11.6 4.2 10 5.6ZM10 5.6V16"/>,
  exams:    () => <><rect x="5" y="4.6" width="10" height="12" rx="1.4"/><path d="M7.6 3.4h4.8v2.4H7.6Z" fill="var(--bg)"/><path d="M7.6 11l1.7 1.7 3.1-3.6"/></>,
  savings:  (marigold) => <><circle cx="10" cy="10" r="6.6"/><path d="M10 6.4a3.6 3.6 0 1 0 3.6 3.6"/><circle cx="10" cy="10" r="1.3" fill={marigold} stroke="none"/></>,
  social:   () => <><circle cx="7.4" cy="10" r="4.6"/><circle cx="12.6" cy="10" r="4.6"/></>,
  subs:     () => <><path d="M15.9 10.6a6 6 0 1 1-1.7-4.8"/><path d="M16.2 3.6v2.6h-2.6"/></>,
  settings: () => <><path d="M4 6.6h12M4 13.4h12"/><circle cx="8" cy="6.6" r="1.7"/><circle cx="12.2" cy="13.4" r="1.7"/></>,
  calendar: () => <><rect x="3.6" y="5" width="12.8" height="11" rx="1.6"/><path d="M3.6 8.6h12.8M7 3.4v2.6M13 3.4v2.6"/></>,
  // Custom-category choices — same ring language (20×20, round caps)
  coffee:   () => <><path d="M4.6 8h8.8v4a3.6 3.6 0 0 1-3.6 3.6H8.2A3.6 3.6 0 0 1 4.6 12Z"/><path d="M13.4 9h1a1.7 1.7 0 0 1 0 3.4h-1"/><path d="M7.4 4.4c0 .9.8 1.1.8 2M10.4 4.4c0 .9.8 1.1.8 2"/></>,
  health:   () => <><circle cx="10" cy="10" r="6.5"/><path d="M10 7.2v5.6M7.2 10h5.6"/></>,
  fitness:  () => <><path d="M7.4 10h5.2"/><path d="M5.4 7.4v5.2M14.6 7.4v5.2M3.4 8.6v2.8M16.6 8.6v2.8"/></>,
  travel:   () => <><path d="M16.4 5.2L3.6 10.4l5.2 1.6 1.6 5.2 6-12.4Z"/><path d="M8.8 12l7.6-6.8"/></>,
  phone:    () => <><rect x="6.2" y="3.6" width="7.6" height="12.8" rx="1.8"/><path d="M9 14h2"/></>,
  music:    () => <><path d="M7.5 15.3V5.9l7-1.5v8.5"/><circle cx="5.8" cy="15.3" r="1.7"/><circle cx="12.8" cy="12.9" r="1.7"/></>,
  gift:     () => <><rect x="4.4" y="8.2" width="11.2" height="7.8" rx="1.2"/><path d="M10 8.2V16M4.4 11.2h11.2"/><path d="M10 8.2C8.5 5 5 6.2 6.4 8.2M10 8.2c1.5-3.2 5-2 3.6 0"/></>,
  paw:      () => <><circle cx="7.2" cy="7.4" r="1.3"/><circle cx="12.8" cy="7.4" r="1.3"/><circle cx="4.9" cy="10.4" r="1.2"/><circle cx="15.1" cy="10.4" r="1.2"/><path d="M10 10.2c-2.2 0-3.9 1.8-3.9 3.3 0 1.4 1.2 2.3 2.3 1.9.9-.3 1-.5 1.6-.5s.7.2 1.6.5c1.1.4 2.3-.5 2.3-1.9 0-1.5-1.7-3.3-3.9-3.3Z"/></>,
  shirt:    () => <path d="M7 4.5L4 7.4l1.8 1.8 1.1-.9v7.2h6.2V8.3l1.1.9L16 7.4l-3-2.9a3 3 0 0 1-6 0Z"/>,
  game:     () => <><rect x="3.8" y="7" width="12.4" height="6.4" rx="3.2"/><path d="M7 9.4v2M6 10.4h2"/><circle cx="12.4" cy="11.2" r="0.55" fill="currentColor" stroke="none"/><circle cx="13.8" cy="9.6" r="0.55" fill="currentColor" stroke="none"/></>,
};
export const Icon = ({name, size=16, color="currentColor", strokeWidth=1.4, style}) => {
  const draw = ICONS[name] || ICONS.dot;  // unknown ids (custom categories) → plain ring
  return <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke={color}
    strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"
    style={{flexShrink:0, ...style}} aria-hidden="true">{draw(C.marigold)}</svg>;
};

// ── Year configs ──────────────────────────────────────────────────────────────
// NOTE: Grant already includes health insurance ($8,100) — the school covers it
// So grant displayed = base grant + healthIns; school deducts tuitionFees + healthIns
// School-agnostic year config. Financial fields default to 0 for every school
// (no school is special-cased — see docs/FUTURE_WORK.md); users fill them in the
// Aid tab or, later, via aid-letter scan. Blank monthly mirrors DEFAULT_CATS ids.
export const CatIcon = ({name, color, size=30}) => {
  const hex = color && color.startsWith("#");
  return (
    <span aria-hidden="true" style={{width:size,height:size,borderRadius:9,display:"inline-flex",alignItems:"center",justifyContent:"center",flexShrink:0,
      background: hex ? color+"2E" : C.surfaceMid,
      border: `1px solid ${hex ? color+"4D" : C.border}`}}>
      <Icon name={name} size={Math.round(size*0.66)} color={hex?color:C.gray} strokeWidth={1.9}/>
    </span>
  );
};

// Icon choices for custom categories — reuses the ring-icon set (same stroke language)
const CAT_ICON_CHOICES = ["dot","food","coffee","transport","travel","personal","health","fitness","books","exams","social","savings","housing","phone","music","gift","paw","shirt","game","star"];
export const CatIconPicker = ({value, onChange}) => (
  <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
    {CAT_ICON_CHOICES.map(name=>{
      const active = value===name;
      return (
        <button key={name} type="button" onClick={()=>onChange(name)} aria-label={`Icon: ${name}`} aria-pressed={active} style={{
          width:32,height:32,borderRadius:8,display:"inline-flex",alignItems:"center",justifyContent:"center",
          border:`1.5px solid ${active?C.sel:C.border}`,
          background: active?C.selBg:"transparent",
          color: active?C.text:C.gray, cursor:"pointer", transition:"all .15s",
        }}>
          <Icon name={name} size={16} strokeWidth={1.5}/>
        </button>
      );
    })}
  </div>
);

// Glass month dropdown — replaces native <select> (same popover language as the pie range picker)
export const MarroLogo = ({size=54}) => {
  // Always-dark tile (like the avatar coins). In dark mode a faint cream hairline
  // defines it; on a light bg that cream blends in, so swap to a dark hairline +
  // lift shadow so the tile still reads as a distinct object.
  const light = typeof document!=="undefined" && document.documentElement.dataset.theme==="light";
  return (
  <div aria-hidden="true" style={{width:size,height:size,borderRadius:Math.round(size*0.24),background:"#14150F",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,boxShadow:light?"0 0 0 1px rgba(38,37,30,0.14), 0 6px 18px rgba(38,37,30,0.20)":"0 0 0 1.5px rgba(246,239,221,0.14), 0 4px 20px rgba(0,0,0,0.45)"}}>
    <svg className="marro-logo-svg" width={size*0.72} height={size*0.72} viewBox="0 0 26 26" style={{overflow:"visible"}}>
      <g transform="translate(13,13)">
        <circle r="1.5" fill="#DDA528"
          style={{transformBox:"fill-box",transformOrigin:"center",animation:"marroRingPop 1.1s ease-out 0s both, marroDotPulse 3s ease-in-out 1.5s infinite"}}/>
        <circle r="4" fill="none" stroke="#F6EFDD" strokeWidth="1.4" opacity="0.72"
          style={{transformBox:"fill-box",transformOrigin:"center",animation:"marroRingPop 1.1s ease-out 0.09s both"}}/>
        <circle r="7.5" fill="none" stroke="#F6EFDD" strokeWidth="1.4"
          style={{transformBox:"fill-box",transformOrigin:"center",animation:"marroRingPop 1.1s ease-out 0.18s both"}}/>
        <circle r="11" fill="none" stroke="#F6EFDD" strokeWidth="1.4"
          style={{transformBox:"fill-box",transformOrigin:"center",animation:"marroRingPop 1.1s ease-out 0.27s both"}}/>
      </g>
    </svg>
  </div>
  );
};

// ── Login gate ──────────────────────────────────────────────────────────────
// Shown when there is no Supabase session. Hard gate: no anonymous/local mode.
export const GoogleGlyph = ({size=18}) => (
  <svg aria-hidden="true" width={size} height={size} viewBox="0 0 48 48" style={{flexShrink:0}}>
    <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8a12 12 0 1 1 0-24c3.1 0 5.9 1.2 8 3.1l5.7-5.7A20 20 0 1 0 24 44c11 0 20-8 20-20 0-1.3-.1-2.3-.4-3.5z"/>
    <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8A12 12 0 0 1 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7A20 20 0 0 0 6.3 14.7z"/>
    <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2A12 12 0 0 1 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5A20 20 0 0 0 24 44z"/>
    <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3a12 12 0 0 1-4.1 5.6l6.2 5.2C40 35.7 44 30.3 44 24c0-1.3-.1-2.3-.4-3.5z"/>
  </svg>
);
