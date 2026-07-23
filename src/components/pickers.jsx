import React, { useState, useEffect, useCallback } from 'react';
import { C } from '../lib/theme.js';
import { MONTH_NAMES, MONTH_FULL, todayStr } from '../lib/format.js';
import { popoverStyle, wrapPop } from '../lib/ui-helpers.js';
import { useLiftCard, useEscClose } from '../lib/hooks.js';
import { Icon } from './icons.jsx';

// Academic-year months (MONTH_NAMES) run Aug→Jul, so a single year's month list
// spans TWO calendar years — the rollover is at index 5 (Jan). When a startYear
// is known, we split the month grid under year headings (Aug–Dec under the start
// year, Jan–Jul under the next) so a month is never ambiguous about which
// calendar year it belongs to. Without a startYear it falls back to one flat grid.
const MONTH_YEAR_SPLIT = 5; // MONTH_NAMES index where the calendar year rolls over (Jan)
const monthGroups = (startYear) => {
  const y = Number(startYear);
  // Only split when we have a real 4-digit year; otherwise show one flat grid.
  if (!Number.isFinite(y) || y < 1900) return [{year:null, from:0, to:12}];
  return [{year:y, from:0, to:MONTH_YEAR_SPLIT}, {year:y+1, from:MONTH_YEAR_SPLIT, to:12}];
};
const MonthGrid = ({startYear, selectedMi, onPick}) => (
  <>
    {monthGroups(startYear).map((g,gi)=>(
      <div key={gi} style={gi>0?{marginTop:8}:undefined}>
        {g.year!=null && <div style={{fontSize:10,fontWeight:700,letterSpacing:"0.06em",color:C.gray,textTransform:"uppercase",margin:"0 2px 4px"}}>{g.year}</div>}
        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:3}}>
          {MONTH_NAMES.slice(g.from,g.to).map((m,idx)=>{
            const mi=g.from+idx, sel=mi===selectedMi;
            return (
              <button key={mi} type="button" onClick={()=>onPick(mi)} aria-pressed={sel} style={{padding:"5px 2px",borderRadius:8,border:"none",fontSize:11,fontWeight:sel?700:400,background:sel?C.selBg:"transparent",color:sel?C.text:C.gray,cursor:"pointer",transition:"background 0.1s"}}>
                {m}
              </button>
            );
          })}
        </div>
      </div>
    ))}
  </>
);

export const MonthPicker = ({value, onChange, startYear}) => {
  const [open, setOpen] = useState(false);
  const btnRef = React.useRef(null);
  useLiftCard(open, btnRef);
  useEscClose(open, ()=>setOpen(false));
  return (
    <div style={{position:"relative"}}>
      <button className="btn-pop" ref={btnRef} onClick={()=>setOpen(o=>!o)} aria-haspopup="true" aria-expanded={open} style={{display:"flex",alignItems:"center",gap:5,padding:"4px 10px",borderRadius:8,border:`1px solid ${C.border}`,background:open?C.selBg:"transparent",color:C.text,fontSize:12,fontWeight:600,cursor:"pointer",transition:"all .15s"}}>
        {MONTH_FULL[value]} <Icon name="chevron" size={11} style={{opacity:0.6,transform:open?"rotate(180deg)":"none",transition:"transform .15s"}}/>
      </button>
      {open && <>
        <div onClick={()=>setOpen(false)} style={{position:"fixed",inset:0,zIndex:99}}/>
        <div style={popoverStyle(220, "right")}>
          <MonthGrid startYear={startYear} selectedMi={value} onPick={mi=>{onChange(mi);setOpen(false);}}/>
        </div>
      </>}
    </div>
  );
};

// Shared glass popover chrome for the picker family (MonthPicker / PeriodPicker / DateField).
export const PeriodPicker = ({value, onChange, yearsList}) => {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const btnRef = React.useRef(null);
  const [browseYr, setBrowseYr] = useState(value.ayId);
  useEffect(()=>{ if(open) setBrowseYr(value.ayId); },[open]);
  useLiftCard(open, btnRef);
  useEscClose(open, ()=>setOpen(false));
  const yLabel = id => { const y=yearsList.find(y=>y.id===id); return y ? y.label.split("—")[0].trim() : ""; };
  const label = value.type==="year" ? yLabel(value.ayId) : `${MONTH_NAMES[value.mi]} · ${yLabel(value.ayId)}`;
  return (
    <div style={{position:"relative"}}>
      <button className="btn-pop" ref={btnRef} onClick={()=>setOpen(o=>!o)} aria-haspopup="true" aria-expanded={open} style={{display:"flex",alignItems:"center",gap:5,padding:"4px 10px",borderRadius:8,border:`1px solid ${C.border}`,background:open?C.selBg:"transparent",color:C.text,fontSize:12,fontWeight:600,cursor:"pointer",transition:"all .15s"}}>
        {label} <Icon name="chevron" size={11} style={{opacity:0.6,transform:open?"rotate(180deg)":"none",transition:"transform .15s"}}/>
      </button>
      {open && <>
        <div onClick={()=>setOpen(false)} style={{position:"fixed",inset:0,zIndex:99}}/>
        <div style={popoverStyle(238)}>
          <div style={{display:"flex",gap:3,flexWrap:"wrap",marginBottom:8}}>
            {yearsList.map(y=>(
              <button key={y.id} onClick={()=>setBrowseYr(y.id)} style={{padding:"4px 9px",borderRadius:8,border:"none",fontSize:11,fontWeight:browseYr===y.id?700:400,background:browseYr===y.id?C.selBg:"transparent",color:browseYr===y.id?C.text:C.gray,cursor:"pointer",transition:"background .1s"}}>
                {y.label.split("—")[0].trim()}
              </button>
            ))}
          </div>
          <button onClick={()=>{onChange({type:"year",ayId:browseYr,label:yLabel(browseYr)});setOpen(false);}} style={{width:"100%",padding:"6px 8px",borderRadius:8,border:`1px solid ${value.type==="year"&&value.ayId===browseYr?C.sel:C.border}`,background:value.type==="year"&&value.ayId===browseYr?C.selBg:"transparent",color:C.text,fontSize:11,fontWeight:600,cursor:"pointer",marginBottom:8,transition:"all .1s"}}>
            Full year — {yLabel(browseYr)}
          </button>
          <MonthGrid startYear={yLabel(browseYr)}
            selectedMi={value.type==="month" && value.ayId===browseYr ? value.mi : -1}
            onPick={mi=>{onChange({type:"month",ayId:browseYr,mi,label:`${MONTH_NAMES[mi]} (${yLabel(browseYr)})`});setOpen(false);}}/>
        </div>
      </>}
    </div>
  );
};

// Custom date field — native calendar popups can't be themed, so the glass day grid replaces them
export const DateField = ({value, onChange, style={}, ariaLabel="Date"}) => {
  const [open, setOpen] = useState(false);
  const btnRef = React.useRef(null);
  const today = new Date(); const pad = n => String(n).padStart(2,"0");
  const todayIso = `${today.getFullYear()}-${pad(today.getMonth()+1)}-${pad(today.getDate())}`;
  const [view, setView] = useState(()=> (value||todayIso).slice(0,7));
  useEffect(()=>{ if(open) setView((value||todayIso).slice(0,7)); },[open]);
  useLiftCard(open, btnRef);
  useEscClose(open, ()=>setOpen(false));
  // Modal panels (.mm) scroll-clip absolute popovers — anchor fixed to the button instead, flipping up when cramped.
  const [fixedPos, setFixedPos] = useState(null);
  useEffect(()=>{
    if(!open || !btnRef.current || !btnRef.current.closest(".mm")) { setFixedPos(null); return; }
    const r = btnRef.current.getBoundingClientRect(), W = 248, H = 296;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - W - 8));
    const top = r.bottom + 4 + H > window.innerHeight - 8 ? Math.max(8, r.top - H - 4) : r.bottom + 4;
    setFixedPos({top, left});
  },[open]);
  const [vy, vm] = view.split("-").map(Number);
  const startOffset = (new Date(vy, vm-1, 1).getDay()+6)%7;   // Monday-start, matches app weeks
  const daysInMonth = new Date(vy, vm, 0).getDate();
  const nav = d => { const dt=new Date(vy, vm-1+d, 1); setView(`${dt.getFullYear()}-${pad(dt.getMonth()+1)}`); };
  const shown = value ? new Date(value+"T12:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}) : "Pick a date";
  return (
    <div style={{position:"relative"}}>
      <button className="btn-pop" ref={btnRef} type="button" onClick={()=>setOpen(o=>!o)} aria-label={ariaLabel} aria-haspopup="true" aria-expanded={open} style={{display:"flex",alignItems:"center",gap:8,width:"100%",fontSize:13,border:`1px solid ${open?C.sel:C.border}`,borderRadius:8,padding:"7px 10px",background:C.bg,color:value?C.text:C.gray,cursor:"pointer",boxSizing:"border-box",textAlign:"left",transition:"border-color .15s",...style}}>
        <Icon name="calendar" size={14} color={C.gray}/>
        <span style={{flex:1}}>{shown}</span>
      </button>
      {open && wrapPop(fixedPos, <>
        <div onClick={()=>setOpen(false)} style={{position:"fixed",inset:0,zIndex:fixedPos?1001:99}}/>
        <div style={fixedPos?{...popoverStyle(248),position:"fixed",top:fixedPos.top,left:fixedPos.left,right:"auto",zIndex:1002}:popoverStyle(248)}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
            <button onClick={()=>nav(-1)} aria-label="Previous month" style={{width:26,height:26,borderRadius:8,border:"none",background:"transparent",color:C.gray,cursor:"pointer",display:"inline-flex",alignItems:"center",justifyContent:"center"}} className="xbtn"><Icon name="chevron" size={13} style={{transform:"rotate(90deg)"}}/></button>
            <span style={{fontSize:12,fontWeight:600,color:C.text}}>{new Date(vy,vm-1,1).toLocaleDateString("en-US",{month:"long",year:"numeric"})}</span>
            <button onClick={()=>nav(1)} aria-label="Next month" style={{width:26,height:26,borderRadius:8,border:"none",background:"transparent",color:C.gray,cursor:"pointer",display:"inline-flex",alignItems:"center",justifyContent:"center"}} className="xbtn"><Icon name="chevron" size={13} style={{transform:"rotate(-90deg)"}}/></button>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:2,marginBottom:2}}>
            {["M","T","W","T","F","S","S"].map((d,i)=><span key={i} style={{fontSize:9,fontWeight:600,color:C.gray,textAlign:"center",letterSpacing:"0.04em"}}>{d}</span>)}
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:2}}>
            {Array.from({length:startOffset}).map((_,i)=><span key={"b"+i}/>)}
            {Array.from({length:daysInMonth}).map((_,i)=>{
              const iso = `${vy}-${pad(vm)}-${pad(i+1)}`;
              const sel = iso===value, isToday = iso===todayIso;
              return (
                <button key={iso} onClick={()=>{onChange(iso);setOpen(false);}} style={{padding:"4px 0",borderRadius:8,border:"none",fontSize:11,fontWeight:sel?700:400,background:sel?C.selBg:"transparent",color:sel?C.text:isToday?C.marigold:C.gray,cursor:"pointer",transition:"background .1s"}}>
                  {i+1}
                </button>
              );
            })}
          </div>
          <div style={{marginTop:8,paddingTop:8,borderTop:`1px solid ${C.border}`,display:"flex",justifyContent:"flex-end"}}>
            <button className="txt-act" onClick={()=>{onChange(todayIso);setOpen(false);}} style={{background:"none",border:"none",color:C.marigold,cursor:"pointer",fontSize:11,fontWeight:600,padding:0}}>Today</button>
          </div>
        </div>
      </>)}
    </div>
  );
};

