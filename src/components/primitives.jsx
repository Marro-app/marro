import React, { useState, useEffect, useCallback } from 'react';
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

export const Modal = ({title, onClose, children, width=440}) => {
  const panelRef = React.useRef(null);
  useEffect(()=>{
    const panel = panelRef.current;
    const prevFocus = document.activeElement;
    const focusables = () => panel ? [...panel.querySelectorAll('button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])')].filter(el=>!el.disabled) : [];
    (focusables()[0] || panel)?.focus();
    const onKey = (e) => {
      if(e.key==="Escape"){ e.stopPropagation(); onClose && onClose(); }
      if(e.key==="Tab"){
        const f = focusables(); if(!f.length) return;
        const first=f[0], last=f[f.length-1];
        if(e.shiftKey && document.activeElement===first){ e.preventDefault(); last.focus(); }
        else if(!e.shiftKey && document.activeElement===last){ e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", onKey);
    return ()=>{ document.removeEventListener("keydown", onKey); prevFocus && prevFocus.focus && prevFocus.focus(); };
  },[]);
  return (
  <div onClick={onClose} style={{position:"fixed",inset:0,background:C.scrim,display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,backdropFilter:"blur(14px)",WebkitBackdropFilter:"blur(14px)"}}>
    <div ref={panelRef} role="dialog" aria-modal="true" aria-label={typeof title==="string"?title:undefined} tabIndex={-1} onClick={e=>e.stopPropagation()} className="mm" style={{padding:"24px",maxWidth:width,width:"calc(100% - 32px)",maxHeight:"90vh",overflowY:"auto",outline:"none"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
        <div style={{fontWeight:700,fontSize:16,color:C.text}}>{title}</div>
        <XBtn label="Close dialog" onClick={onClose} size={28} iconSize={14}/>
      </div>
      {children}
    </div>
  </div>
  );
};

export const InfoTip = ({text}) => {
  const [show,setShow] = useState(false);
  const timer = React.useRef();
  const open  = () => { clearTimeout(timer.current); timer.current = setTimeout(()=>setShow(true),140); };
  const close = () => { clearTimeout(timer.current); setShow(false); };
  return <span style={{position:"relative",display:"inline-flex"}} onMouseEnter={open} onMouseLeave={close} onClick={()=>setShow(s=>!s)}>
    <span style={{width:16,height:16,borderRadius:8,background:C.surface,color:C.gray,fontSize:9,fontWeight:700,display:"inline-flex",alignItems:"center",justifyContent:"center",cursor:"help",border:`1px solid ${C.border}`}}>i</span>
    {show && <div style={{position:"absolute",bottom:"calc(100% + 6px)",left:"50%",transform:"translateX(-50%)",transformOrigin:"bottom center",animation:"tipIn 140ms cubic-bezier(0.23,1,0.32,1)",background:C.glassTooltip,color:C.text,fontSize:11,padding:"6px 10px",borderRadius:8,whiteSpace:"normal",width:200,zIndex:999,lineHeight:1.5,boxShadow:"0 4px 16px rgba(0,0,0,0.32)",backdropFilter:"blur(20px)",WebkitBackdropFilter:"blur(20px)",border:`1px solid ${C.border}`}}>{text}</div>}
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
