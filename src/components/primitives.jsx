import React, { useState, useEffect, useCallback, useId } from 'react';
import { createPortal } from 'react-dom';
import { C } from '../lib/theme.js';
import { Icon } from './icons.jsx';
import { edgeFadeClass, radioProps, tabProps, yrRangeLabel } from '../lib/ui-helpers.js';
import { useEdgeFade, useEscClose } from '../lib/hooks.js';

export const Pill = ({ok, warn, neutral, children, sm}) => {
  const bg = neutral ? C.bgDark : ok ? C.greenLight : warn ? C.amberLight : C.negLight;
  const color = neutral ? C.gray : ok ? C.green : warn ? C.amber : C.neg;
  return (
    <span style={{
      fontSize: sm?10:11, padding: sm?"1px 7px":"2px 9px",
      borderRadius:999, background:bg, color, fontWeight:600,
      display:"inline-block", whiteSpace:"nowrap",
    }}>{children}</span>
  );
};

// Shared ghost ✕ — remove/close affordances stay quiet (no border, no fill) until hovered
export const XBtn = ({onClick, label, title, size=28, danger=false, iconSize=14}) => (
  <button aria-label={label} title={title||label} onClick={onClick}
    className={`xbtn${danger?' xbtn-danger':''}`}
    style={{width:size,height:size,borderRadius:size/2,border:"none",background:"transparent",
      color:danger?C.danger:C.gray,cursor:"pointer",display:"inline-flex",alignItems:"center",
      justifyContent:"center",flexShrink:0,padding:0,transition:"background .15s, color .15s",
      ...(danger?{"--xbtn-danger":C.danger}:{})}}>
    <Icon name="close" size={iconSize}/>
  </button>
);

export const Card = ({children, style={}, primary=false}) => (
  <div className={`mc mc-e${primary?' mc-p':''}`} style={{
    padding:"18px 20px",
    ...style,
  }}>
    <div className="mc-sp"/>
    <div className="mc-sh"/>
    {children}
  </div>
);

// Category icon in a tinted chip — keeps the chart-color link, reads at a glance
export const SectionTitle = ({children, sub}) => (
  <div style={{marginBottom:14}}>
    <div style={{fontSize:13, fontWeight:600, color:C.text, letterSpacing:"-0.01em"}}>{children}</div>
    {sub && <div style={{fontSize:11, color:C.gray, marginTop:2}}>{sub}</div>}
  </div>
);

// Edge-fade affordance for horizontally-scrollable strips (tab bar, year
// pills, wide tables). A fixed CSS breakpoint can't track this reliably —
// overflow depends on content (badge counts, font metrics), not viewport
// width — so we measure the actual scrollWidth/clientWidth/scrollLeft and
// only show a fade on the edge that truly has more content past it. Purely
// decorative (no motion), so it doesn't interact with prefers-reduced-motion.
export const ChoiceGroup = ({role="radiogroup", ariaLabel, ariaLabelledby, className, style, children}) => {
  const ref = React.useRef(null);
  const fade = useEdgeFade(ref, [children]);
  const onKeyDown = e => {
    if(!["ArrowRight","ArrowLeft","ArrowUp","ArrowDown","Home","End"].includes(e.key)) return;
    const items = [...ref.current.querySelectorAll('[role="radio"]:not([disabled]),[role="tab"]:not([disabled])')]
      .filter(el=>el.offsetParent!==null);
    if(!items.length) return;
    const cur = items.indexOf(document.activeElement);
    let next;
    if(e.key==="Home") next=0;
    else if(e.key==="End") next=items.length-1;
    else { const dir=(e.key==="ArrowRight"||e.key==="ArrowDown")?1:-1; next=((cur<0?0:cur)+dir+items.length)%items.length; }
    e.preventDefault();
    items[next].focus();
    items[next].click(); // radio/tab: arrow moves AND selects (APG)
  };
  return <div ref={ref} role={role} aria-label={ariaLabel} aria-labelledby={ariaLabelledby}
    className={[className, edgeFadeClass(fade)].filter(Boolean).join(" ")} style={style} onKeyDown={onKeyDown}>{children}</div>;
};
// Spread onto each option button. Active item is the only one in the Tab order.
export const Stepper = ({value, onChange, min, max, ariaLabel, prefix, suffix, inputWidth=48}) => {
  const clamp = v => Math.min(max, Math.max(min, v));
  const [txt, setTxt] = useState(String(value));
  useEffect(()=>{ setTxt(String(value)); }, [value]);
  const btn = on => ({width:44,height:44,flexShrink:0,borderRadius:11,border:`1px solid ${C.border}`,
    background:"transparent",color:on?C.text:C.gray,fontSize:22,fontWeight:400,lineHeight:1,
    cursor:on?"pointer":"not-allowed",display:"flex",alignItems:"center",justifyContent:"center",transition:"all .15s"});
  return (
    <div role="group" aria-label={ariaLabel} style={{display:"inline-flex",alignItems:"center",gap:8}}>
      <button type="button" aria-label="Decrease" disabled={value<=min} onClick={()=>onChange(clamp(value-1))} style={btn(value>min)}>−</button>
      <div style={{flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",gap:6,padding:"0 2px"}}>
        {prefix && <span style={{fontSize:15,color:C.textMid,fontWeight:500}}>{prefix}</span>}
        <input type="number" inputMode="numeric" value={txt} min={min} max={max} aria-label={ariaLabel}
          onChange={e=>{ setTxt(e.target.value); const n=parseInt(e.target.value,10); if(!isNaN(n)&&n>=min&&n<=max) onChange(n); }}
          onBlur={()=>{ const n=parseInt(txt,10); const c=isNaN(n)?value:clamp(n); onChange(c); setTxt(String(c)); }}
          style={{width:inputWidth,textAlign:"center",fontSize:17,fontWeight:700,border:`1px solid ${C.border}`,borderRadius:10,padding:"9px 6px",background:C.bg,color:C.text,boxSizing:"border-box"}}/>
        {suffix && <span style={{fontSize:15,color:C.textMid,fontWeight:500}}>{suffix}</span>}
      </div>
      <button type="button" aria-label="Increase" disabled={value>=max} onClick={()=>onChange(clamp(value+1))} style={btn(value<max)}>+</button>
    </div>
  );
};
// Plain scrollable strip (not a choice group, e.g. wide tables) — same edge-fade affordance.
export const ScrollX = ({className, style, children}) => {
  const ref = React.useRef(null);
  const fade = useEdgeFade(ref, [children]);
  return <div ref={ref} className={[className, edgeFadeClass(fade)].filter(Boolean).join(" ")} style={style}>{children}</div>;
};

export const TabBtn = ({label, active, onClick, badge, id}) => (
  <button onClick={onClick} {...tabProps(active, "tab-"+id, "tab-panel")} className={active?undefined:"shimmer-text"} style={{
    padding:"7px 16px", border:"none",
    borderRadius:28,
    background: active ? C.tabActiveBg : "transparent",
    cursor:"pointer", fontSize:13,
    fontWeight: active ? 600 : 400,
    color: active ? C.ink : C.tabMuted,
    whiteSpace:"nowrap", position:"relative", flexShrink:0,
    transition:"all 220ms cubic-bezier(0.23,1,0.32,1)",
    boxShadow: active ? "0 1px 8px rgba(0,0,0,0.18), inset 0 1px 0 rgba(255,255,255,0.35)" : "none",
  }}>
    {label}
    {badge>0 && <span style={{position:"absolute",top:3,right:3,minWidth:14,height:14,borderRadius:8,background:C.marigold,color:C.ink,fontSize:8,fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center",padding:"0 2px"}}>{badge}</span>}
  </button>
);

export const YrBtn = ({yr, active, onClick}) => (
  <button onClick={onClick} {...radioProps(active)} aria-label={"Show "+yr.label.split("—")[0].trim()} className={active?undefined:"shimmer-text"} style={{
    padding:"6px 14px", border:"none", borderRadius:28,
    background: active ? C.tabActiveBg : "transparent",
    color: active ? C.ink : C.tabMuted,
    fontWeight: active?600:400, fontSize:12, cursor:"pointer",
    whiteSpace:"nowrap", flexShrink:0,
    transition:"all 220ms cubic-bezier(0.23,1,0.32,1)",
    boxShadow: active ? "0 1px 8px rgba(0,0,0,0.18), inset 0 1px 0 rgba(255,255,255,0.35)" : "none",
  }}>
    {yr.label.split("—")[0].trim()}
  </button>
);

// Active year's date range, shown once beside the year pill (was repeated under every button)
export const Banner = ({children, type="info", onClose}) => {
  const styles = {
    info:    {bg:"rgba(134,178,204,0.12)", color:C.blue, border:"rgba(134,178,204,0.30)"},
    warn:    {bg:C.amberLight, color:C.amber, border:C.amberMid},
    success: {bg:C.greenLight, color:C.green, border:C.greenMid},
    error:   {bg:C.dangerLight, color:C.danger, border:C.dangerMid},
  };
  const s = styles[type]||styles.info;
  return (
    <div style={{background:s.bg, border:`1px solid ${s.border}`, borderRadius:8, padding:"10px 14px", marginBottom:10, fontSize:12, color:s.color, display:"flex", gap:10, alignItems:"flex-start", backdropFilter:"blur(20px)", WebkitBackdropFilter:"blur(20px)"}}>
      <div style={{flex:1, lineHeight:1.6}}>{children}</div>
      {onClose && <button className="txt-act" aria-label="Dismiss" onClick={onClose} style={{background:"none",border:"none",cursor:"pointer",fontSize:18,color:s.color,lineHeight:1,padding:0,flexShrink:0,opacity:0.7}}><Icon name="close" size={13}/></button>}
    </div>
  );
};

// ── Shared: pagination ────────────────────────────────────────────────────────
// usePagination slices a SORTED/FILTERED array into pageSize-item pages; page
// state is local to whatever list uses it (not persisted). Clamps
// automatically if the underlying list shrinks (e.g. an item is removed) so
// `page` can never point past the new last page. Paginator renders nothing
// for a single-page list — no point showing "Page 1 of 1."
const DEFAULT_PAGE_SIZE = 20;
export function usePagination(items, pageSize = DEFAULT_PAGE_SIZE) {
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const clampedPage = Math.min(page, totalPages);
  useEffect(() => { if (page !== clampedPage) setPage(clampedPage); }, [clampedPage]); // eslint-disable-line react-hooks/exhaustive-deps
  const start = (clampedPage - 1) * pageSize;
  const pageItems = items.slice(start, start + pageSize);
  return { page: clampedPage, setPage, totalPages, pageItems, start };
}

export function Paginator({page, totalPages, onChange, idPrefix, totalCount, pageSize = DEFAULT_PAGE_SIZE}) {
  if (totalPages <= 1) return null;
  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, totalCount);
  return (
    <div role="navigation" aria-label="Pagination" style={{display:"flex", alignItems:"center", justifyContent:"space-between", gap:10, marginTop:12, paddingTop:12, borderTop:`1px solid ${C.border}`, flexWrap:"wrap"}}>
      <span style={{fontSize:11.5, color:C.gray}}>{start}–{end} of {totalCount}</span>
      <div style={{display:"flex", alignItems:"center", gap:8}}>
        <button type="button" className="xbtn" onClick={()=>onChange(page-1)} disabled={page<=1}
          aria-label={`${idPrefix}: previous page`}
          style={{minWidth:44, minHeight:32, padding:"0 12px", borderRadius:8, border:`1px solid ${C.border}`, background:"transparent", color: page<=1 ? C.gray : C.text, cursor: page<=1 ? "not-allowed" : "pointer", fontSize:12, fontWeight:600}}>
          Previous
        </button>
        <span style={{fontSize:11.5, color:C.gray, whiteSpace:"nowrap"}}>Page {page} of {totalPages}</span>
        <button type="button" className="xbtn" onClick={()=>onChange(page+1)} disabled={page>=totalPages}
          aria-label={`${idPrefix}: next page`}
          style={{minWidth:44, minHeight:32, padding:"0 12px", borderRadius:8, border:`1px solid ${C.border}`, background:"transparent", color: page>=totalPages ? C.gray : C.text, cursor: page>=totalPages ? "not-allowed" : "pointer", fontSize:12, fontWeight:600}}>
          Next
        </button>
      </div>
    </div>
  );
}

// panelClassName/scrimBg let a caller opt into a more opaque surface for a
// modal that's stacked ON TOP OF another modal (e.g. "email this code" inside
// Invite friends) — nesting two default `.mm` glass panels compounds their
// blur/saturate/brightness and washes out contrast against a busy blurred
// parent, so nested dialogs pass panelClassName="mm mm-solid" scrimBg={C.scrimStrong}
// (see index.html's .mm-solid rule + C.scrimStrong). Defaults preserve the
// existing look for every other (non-nested) modal in the app.
//
// modalStack: module-level stack of currently-open Modal instances (by a
// per-instance object identity, not id — cheaper and avoids a counter that
// could collide across fast mount/unmount). Nested modals each register a
// keydown listener on `document`, so with no coordination BOTH listeners fire
// on one Escape press: the inner modal closes (correct) AND the outer one
// closes too (wrong — the whole stack collapses instead of popping one level).
// Same problem for the Tab focus-trap. Gating every handler on "am I the
// topmost modal" fixes both.
const modalStack = [];

// NOTE: the mount effect below captures onClose/dismissible from the FIRST
// render ([] deps — re-running it would re-push the modal-stack token and
// re-grab focus). Callers must not change these props while a modal is open.
//
// dismissible=false is for dialogs that require an explicit in-dialog choice
// (e.g. ConflictModal) — it disables Escape-to-close, scrim-click-close, and
// hides the XBtn close button, while keeping role="dialog", aria-modal, the
// focus trap, and focus restore intact. Every other/default caller is
// unaffected (dismissible defaults to true = current behavior).
export const Modal = ({title, onClose, children, width=440, panelClassName="mm", scrimBg, dismissible=true}) => {
  const panelRef = React.useRef(null);
  useEffect(()=>{
    const token = {};
    modalStack.push(token);
    const isTopmost = () => modalStack[modalStack.length - 1] === token;

    const panel = panelRef.current;
    const prevFocus = document.activeElement;
    const focusables = () => panel ? [...panel.querySelectorAll('button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])')].filter(el=>!el.disabled) : [];
    (focusables()[0] || panel)?.focus();
    const onKey = (e) => {
      if(!isTopmost()) return; // a nested modal is open on top of this one — let IT handle the key
      if(e.key==="Escape"){ e.stopPropagation(); if(!dismissible) return; onClose && onClose(); } // topmost modal owns Escape even when non-dismissible (swallow, don't leak)
      if(e.key==="Tab"){
        const f = focusables(); if(!f.length) return;
        const first=f[0], last=f[f.length-1];
        if(e.shiftKey && document.activeElement===first){ e.preventDefault(); last.focus(); }
        else if(!e.shiftKey && document.activeElement===last){ e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", onKey);
    return ()=>{
      document.removeEventListener("keydown", onKey);
      const i = modalStack.indexOf(token);
      if (i !== -1) modalStack.splice(i, 1);
      // Only restore focus to what was focused before THIS modal opened if
      // nothing further up the stack still owns focus (avoids yanking focus
      // out from under a still-open parent modal when a nested one closes).
      if (!modalStack.length) prevFocus && prevFocus.focus && prevFocus.focus();
    };
  },[]);
  // Portaled to document.body — Card's entrance animation (.mc-e / cardIn)
  // leaves a lingering non-"none" transform on the card after it finishes
  // (animation-fill-mode:both holds the final keyframe indefinitely), and any
  // element with an active transform becomes a containing block for its
  // position:fixed descendants (CSS Transforms spec). Every Modal trigger
  // lives inside a Card, so without the portal this dialog's "fixed" overlay
  // was actually fixed to the CARD's box, not the viewport — the scrim/blur
  // only covered that box, letting page content above/around it show through
  // undimmed. Portaling to body sidesteps the containing-block chain entirely.
  return createPortal((
  <div onClick={dismissible?onClose:undefined} style={{position:"fixed",inset:0,background:scrimBg||C.scrim,display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,backdropFilter:"blur(14px)",WebkitBackdropFilter:"blur(14px)",padding:16,boxSizing:"border-box"}}>
    <div ref={panelRef} role="dialog" aria-modal="true" aria-label={typeof title==="string"?title:undefined} tabIndex={-1} onClick={e=>e.stopPropagation()} className={panelClassName} style={{padding:"24px",maxWidth:width,width:"100%",maxHeight:"90vh",overflowY:"auto",outline:"none",boxSizing:"border-box"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20,gap:16}}>

        <div style={{fontWeight:700,fontSize:16,color:C.text}}>{title}</div>
        {dismissible && <XBtn label="Close dialog" onClick={onClose} size={28} iconSize={14}/>}
      </div>
      {children}
    </div>
  </div>
  ), document.body);
};

export const InfoTip = ({text}) => {
  const [show,setShow] = useState(false);
  const timer = React.useRef();
  const tipId = useId();
  const open  = () => { clearTimeout(timer.current); timer.current = setTimeout(()=>setShow(true),140); };
  const close = () => { clearTimeout(timer.current); setShow(false); };
  return <span style={{position:"relative",display:"inline-flex"}}>
    <button type="button" aria-label="More info" aria-expanded={show} aria-describedby={show?tipId:undefined}
      className="infotip-btn"
      onMouseEnter={open} onMouseLeave={close} onClick={()=>setShow(s=>!s)} onBlur={close}
      onKeyDown={e=>{ if(e.key==="Escape"&&show){ e.stopPropagation(); close(); } }} // WCAG 1.4.13: tooltip dismissible without moving focus
      style={{width:16,height:16,borderRadius:8,background:C.surface,color:C.gray,fontSize:9,fontWeight:700,display:"inline-flex",alignItems:"center",justifyContent:"center",cursor:"help",border:`1px solid ${C.border}`,padding:0,margin:0,lineHeight:"normal",fontFamily:"inherit"}}>i</button>
    {show && <div id={tipId} role="tooltip" style={{position:"absolute",bottom:"calc(100% + 6px)",left:"50%",transform:"translateX(-50%)",transformOrigin:"bottom center",animation:"tipIn 140ms cubic-bezier(0.23,1,0.32,1)",background:C.glassTooltip,color:C.text,fontSize:11,padding:"6px 10px",borderRadius:8,whiteSpace:"normal",width:200,zIndex:999,lineHeight:1.5,boxShadow:"0 4px 16px rgba(0,0,0,0.32)",backdropFilter:"blur(20px)",WebkitBackdropFilter:"blur(20px)",border:`1px solid ${C.border}`}}>{text}</div>}
  </span>;
};

export const Divider = () => <div style={{height:1,background:C.border,margin:"10px 0"}}/>;

export const MetricTile = ({label, value, sub, color, onClick}) => (
  <div onClick={onClick} style={{
    background:"rgba(255,255,255,0.07)",
    backdropFilter:"blur(40px) saturate(180%)",
    WebkitBackdropFilter:"blur(30px) saturate(160%)",
    border:"1px solid rgba(255,255,255,0.14)",
    borderRadius:12, padding:"14px 16px", flex:1, minWidth:130,
    cursor:onClick?"pointer":"default",
    transition:"all 200ms cubic-bezier(0.23,1,0.32,1)",
    boxShadow:"0 4px 16px rgba(0,0,0,0.20), inset 0 1px 0 rgba(255,255,255,0.12)",
    position:"relative", overflow:"hidden",
  }}>
    <div style={{position:"absolute",left:"8%",right:"8%",top:0,height:1,background:"linear-gradient(90deg,transparent,rgba(255,255,255,0.40),transparent)",pointerEvents:"none"}}/>
    <div style={{fontSize:10,color:C.gray,marginBottom:4,textTransform:"uppercase",letterSpacing:"0.08em",fontWeight:600}}>{label}</div>
    <div style={{fontSize:21,fontWeight:700,color:color||C.text,letterSpacing:"-0.02em",fontFamily:"'Newsreader',Georgia,serif"}}>{value}</div>
    {sub && <div style={{fontSize:11,color:C.gray,marginTop:3}}>{sub}</div>}
  </div>
);

export const ProgressBar = ({value, max, color, height=6}) => {
  const pct = max>0 ? Math.min(Math.round(value/max*100),100) : 0;
  return (
    <div style={{height,background:C.surfaceMid,borderRadius:height,overflow:"hidden"}}>
      <div style={{width:pct+"%",height:"100%",background:color,borderRadius:height,transition:"width .4s"}}/>
    </div>
  );
};

// Circular goal progress — growth-ring metaphor; the marigold dot blooms at 100%
export const RingProgress = ({value, max, size=42, color}) => {
  const frac = max>0 ? Math.max(0, Math.min(1, value/max)) : 0;
  const [drawn, setDrawn] = useState(typeof window!=="undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(()=>{ const id=requestAnimationFrame(()=>setDrawn(true)); return ()=>cancelAnimationFrame(id); },[]);
  const shown = drawn ? frac : 0;
  const r = 8.5, circ = 2*Math.PI*r;
  return (
    <svg width={size} height={size} viewBox="0 0 22 22" style={{flexShrink:0}} aria-hidden="true">
      <g transform="rotate(-90 11 11)">
        <circle cx="11" cy="11" r={r} fill="none" stroke={C.surfaceMid} strokeWidth="1.7"/>
        <circle cx="11" cy="11" r={r} fill="none" stroke={color||C.teal} strokeWidth="1.7"
          strokeDasharray={`${circ*shown} ${circ}`} strokeLinecap={frac>0?"round":"butt"}
          style={{transition:"stroke-dasharray .7s cubic-bezier(0.23,1,0.32,1)"}}/>
      </g>
      {frac>=1 && <circle cx="11" cy="11" r="2.4" fill={C.marigold}/>}
    </svg>
  );
};

// Drives the ambient blob health state: calm (default) / low-tide (over budget) /
// marigold bloom (goal milestone). Crossfades via opacity on stacked gradient
// layers — the gradients themselves are never animated (GPU rule).
export const BlobHealth = ({over, bloom}) => {
  useEffect(()=>{
    const layer = document.querySelector(".blob-layer");
    if(!layer) return;
    layer.classList.toggle("blobs-over", !!over && !bloom);
    layer.classList.toggle("blobs-bloom", !!bloom);
  },[over, bloom]);
  return null;
};

// Shared empty state — small crisp ring mark above teach copy (watermark-behind-text read as a misprint)
export const EmptyState = ({children}) => (
  <div style={{textAlign:"center",padding:"26px 16px"}}>
    <svg width="34" height="34" viewBox="0 0 26 26" fill="none" stroke={C.gray} strokeWidth="1.2"
      style={{marginBottom:10}} aria-hidden="true">
      <g transform="translate(13,13)"><circle r="11"/><circle r="7.5"/><circle r="4" opacity="0.72"/><circle r="1.4" fill={C.marigold} stroke="none"/></g>
    </svg>
    <div style={{color:C.gray,fontSize:13,lineHeight:1.5,maxWidth:380,margin:"0 auto"}}>{children}</div>
  </div>
);

// ── Renewal Dialog ─────────────────────────────────────────────────────────────
