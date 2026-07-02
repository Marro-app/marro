import React, { useState, useEffect, useCallback } from 'react';
import { C } from '../lib/theme.js';
import { fmt, fmtA, fmtD, fmtDay, fmtWeekLabel, daysUntil, subMonthlyTotal, todayStr } from '../lib/format.js';
import { conflictLabel, fmtConflictVal, MONEY_KEYS } from '../lib/data.js';
import { Icon, BrandIcon } from './icons.jsx';
import { Pill, Card, Modal, Banner } from './primitives.jsx';
import { DateField } from './pickers.jsx';
import { useApp } from '../context/AppContext.js';

export function RenewalDialog({sub, onClose, onConfirm}) {
  const [renewed, setRenewed] = useState(null);
  const [samePrice, setSamePrice] = useState(true);
  const [newAmt, setNewAmt] = useState(String(sub.amount));
  // Prefill with the next cycle date so "Save" works without retyping a date
  const nextCycleDate = (() => {
    if(!sub.renewal) return "";
    const d = new Date(sub.renewal+"T12:00:00");
    if(isNaN(d)) return "";
    const months = sub.cycle==="annual"?12:sub.cycle==="quarterly"?3:sub.cycle==="monthly"?1:0;
    if(!months) return "";
    const today = new Date();
    while(d<=today) d.setMonth(d.getMonth()+months);
    return [d.getFullYear(),String(d.getMonth()+1).padStart(2,"0"),String(d.getDate()).padStart(2,"0")].join("-");
  })();
  const [newDate, setNewDate] = useState(nextCycleDate);
  return (
    <Modal title="Handle renewal" onClose={onClose}>
      <div style={{display:"flex",alignItems:"center",gap:12,padding:"12px 14px",background:C.surface,border:`1px solid ${C.border}`,borderRadius:8,marginBottom:20}}>
        <BrandIcon name={sub.name} size={40}/>
        <div>
          <div style={{fontWeight:600,fontSize:14}}>{sub.name}</div>
          <div style={{fontSize:12,color:C.gray}}>{fmtD(sub.amount)}/{sub.cycle} · was due {sub.renewal}</div>
        </div>
      </div>
      <div style={{fontSize:13,fontWeight:600,color:C.text,marginBottom:10}}>Did you renew?</div>
      <div style={{display:"flex",gap:8,marginBottom:20}}>
        {[{v:true,label:"Yes, keeping it"},{v:false,label:"No, cancelled"}].map(o=>(
          <button key={String(o.v)} onClick={()=>setRenewed(o.v)} style={{flex:1,padding:"10px",fontSize:13,fontWeight:600,border:`2px solid ${renewed===o.v?(o.v?C.teal:C.danger):C.border}`,borderRadius:8,background:renewed===o.v?(o.v?C.tealLight:C.dangerLight):"transparent",color:renewed===o.v?(o.v?C.teal:C.danger):C.gray,cursor:"pointer",transition:"all .15s"}}>
            {o.label}
          </button>
        ))}
      </div>
      {renewed===true && <>
        <div style={{fontSize:13,fontWeight:600,marginBottom:10}}>Same price?</div>
        <div style={{display:"flex",gap:8,marginBottom:14}}>
          {[{v:true,label:"Same price"},{v:false,label:"Price changed"}].map(o=>(
            <button key={String(o.v)} onClick={()=>setSamePrice(o.v)} style={{flex:1,padding:"8px",fontSize:12,fontWeight:600,border:`1.5px solid ${samePrice===o.v?C.blue:C.border}`,borderRadius:8,background:samePrice===o.v?C.blueLight:"transparent",color:samePrice===o.v?C.blue:C.gray,cursor:"pointer",transition:"all .15s"}}>
              {o.label}
            </button>
          ))}
        </div>
        {!samePrice && <div style={{marginBottom:12}}>
          <div style={{fontSize:11,color:C.gray,marginBottom:4}}>New amount ($)</div>
          <input type="number" value={newAmt} onChange={e=>setNewAmt(e.target.value)} style={{width:"100%",fontSize:13,border:`1px solid ${C.border}`,borderRadius:8,padding:"8px 10px",background:C.bg,boxSizing:"border-box"}}/>
        </div>}
        <div style={{marginBottom:20}}>
          <div style={{fontSize:11,color:C.gray,marginBottom:4}}>Next renewal date</div>
          <DateField value={newDate} onChange={setNewDate} ariaLabel="Renewal date"/>
        </div>
      </>}
      {renewed===false && <Banner type="warn" style={{marginBottom:16}}>This subscription will be removed and your budget updated automatically.</Banner>}
      {renewed !== null && (
        <button className="btn-fill" onClick={()=>onConfirm(sub,renewed,samePrice?sub.amount:newAmt,newDate)} style={{width:"100%",padding:"11px",fontSize:14,fontWeight:700,border:"none",borderRadius:8,background:renewed?C.teal:C.danger,color:C.bg,cursor:"pointer"}}>
          {renewed ? "Save subscription" : "Remove subscription"}
        </button>
      )}
    </Modal>
  );
}

// ── Quick add — log a one-off expense from anywhere, no tab required ──────────
// Phase 1 simplification: the Weekly tab is hidden from the tabbar, so this is
// now the primary entry point for logging actual spending. Writes through the
// same addWeeklyEntry mutator the (still-present, just hidden) Weekly tab uses.
export function QuickAddModal({onClose}) {
  const { cats, addWeeklyEntry } = useApp();
  const spendCats = cats.filter(c=>!c.locked && !c.autoCalc);
  const [catId, setCatId] = useState(spendCats[0]?.id||"");
  const [amt, setAmt]     = useState("");
  const [date, setDate]   = useState(todayStr());
  const [note, setNote]   = useState("");
  const [notice, setNotice] = useState(null);
  const canSave = catId && parseFloat(amt)>0;
  const save = () => {
    if(!canSave) return;
    const info = addWeeklyEntry(catId, amt, note, date);
    if(info && (info.deficit>0 || info.isUnbudgeted)){
      setNotice(info.isUnbudgeted ? `Added — ${info.catLabel} isn't in this month's budget.` : `Added — this puts you over budget for the month.`);
      setTimeout(onClose, 900);
    } else {
      onClose();
    }
  };
  return (
    <Modal title="Quick add" onClose={onClose} width={380}>
      <div style={{display:"flex",flexDirection:"column",gap:12}}>
        <div>
          <div style={{fontSize:11,color:C.gray,marginBottom:4,fontWeight:500}}>Category</div>
          <select value={catId} onChange={e=>setCatId(e.target.value)} aria-label="Category" autoFocus
            style={{width:"100%",fontSize:13,border:`1px solid ${C.border}`,borderRadius:8,padding:"8px 10px",background:C.bg,color:C.text,boxSizing:"border-box"}}>
            {spendCats.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
          <div>
            <div style={{fontSize:11,color:C.gray,marginBottom:4,fontWeight:500}}>Amount ($)</div>
            <input type="number" placeholder="0.00" value={amt} onChange={e=>setAmt(e.target.value)} aria-label="Amount"
              style={{width:"100%",fontSize:13,border:`1px solid ${C.border}`,borderRadius:8,padding:"8px 10px",background:C.bg,color:C.text,boxSizing:"border-box"}}/>
          </div>
          <div>
            <div style={{fontSize:11,color:C.gray,marginBottom:4,fontWeight:500}}>Date</div>
            <DateField value={date} onChange={setDate} ariaLabel="Expense date"/>
          </div>
        </div>
        <div>
          <div style={{fontSize:11,color:C.gray,marginBottom:4,fontWeight:500}}>Note (optional)</div>
          <input placeholder="e.g. Textbook, flight" value={note} onChange={e=>setNote(e.target.value)} aria-label="Note"
            style={{width:"100%",fontSize:13,border:`1px solid ${C.border}`,borderRadius:8,padding:"8px 10px",background:C.bg,color:C.text,boxSizing:"border-box"}}/>
        </div>
        {notice && <Banner type="info">{notice}</Banner>}
        <button className="btn-fill" onClick={save} disabled={!canSave} style={{padding:"11px",fontSize:14,fontWeight:700,border:"none",borderRadius:8,background:canSave?C.teal:C.surface,color:canSave?C.bg:C.gray,cursor:canSave?"pointer":"not-allowed"}}>Add expense</button>
      </div>
    </Modal>
  );
}

// ── Week selector modal ────────────────────────────────────────────────────────
export function WeekSelectorModal({archives, currentWeekStart, currentWeekEnd, selected, onSelect, onClose}) {
  const allWeeks = [
    {weekStart:currentWeekStart, weekEnd:currentWeekEnd, isCurrent:true},
    ...archives.filter(a=>a.entries&&a.entries.length>0).map(a=>({...a, isCurrent:false})),
  ];
  return (
    <Modal title="Select a week" onClose={onClose} width={380}>
      <div style={{display:"flex",flexDirection:"column",gap:6}}>
        {allWeeks.map(w=>(
          <button key={w.weekStart} onClick={()=>{onSelect(w.isCurrent?null:w.weekStart);onClose();}} style={{
            padding:"10px 14px",borderRadius:8,border:`1.5px solid ${(!selected&&w.isCurrent)||(selected===w.weekStart)?C.sel:C.border}`,
            background:(!selected&&w.isCurrent)||(selected===w.weekStart)?C.selBg:"transparent",
            color:(!selected&&w.isCurrent)||(selected===w.weekStart)?C.text:C.text,
            cursor:"pointer",textAlign:"left",display:"flex",justifyContent:"space-between",alignItems:"center",
            fontWeight:(!selected&&w.isCurrent)||(selected===w.weekStart)?600:400,fontSize:13,
          }}>
            <span>{fmtWeekLabel(w.weekStart)}</span>
            {w.isCurrent && <Pill ok neutral sm>Current</Pill>}
            {!w.isCurrent && w.total!=null && <span style={{fontSize:12,color:C.gray}}>{fmt(w.total)}</span>}
          </button>
        ))}
      </div>
    </Modal>
  );
}

// ── Conflict resolution modal ─────────────────────────────────────────────────
export function ConflictModal({pending, data, onResolve}) {
  const [choices, setChoices] = React.useState(()=>Object.fromEntries(pending.conflicts.map(c=>[c.key,'local'])));
  const choose=(key,side)=>setChoices(p=>({...p,[key]:side}));
  const resolve=()=>{
    const resolvedChanges=Object.fromEntries(pending.conflicts.map(c=>[c.key,{c: choices[c.key]==='local'?c.local:c.server}]));
    onResolve({...pending, resolvedChanges});
  };
  const autoCount=Object.keys(pending.mergeLocal).length+Object.keys(pending.mergeServer).length;
  return (
    <div style={{position:'fixed',inset:0,background:C.scrim,zIndex:9999,display:'flex',alignItems:'center',justifyContent:'center',padding:16,backdropFilter:'blur(14px)',WebkitBackdropFilter:'blur(14px)'}}>
      <div className="mm" style={{padding:24,width:'100%',maxWidth:480,maxHeight:'90vh',overflowY:'auto'}}>
        <div style={{fontSize:16,fontWeight:700,color:C.text,marginBottom:6}}>Sync conflict</div>
        <div style={{fontSize:13,color:C.textMid,marginBottom:18}}>
          The same {pending.conflicts.length===1?'item was':pending.conflicts.length+' items were'} changed on two devices. Pick which version to keep.
        </div>
        {pending.conflicts.map(c=>(
          <div key={c.key} style={{marginBottom:12,padding:12,borderRadius:8,background:C.surface,border:`1px solid ${C.border}`}}>
            <div style={{fontSize:12,fontWeight:600,color:C.text,marginBottom:10}}>{conflictLabel(c.key,data)}</div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
              {[['local','This device',c.local],['server','Other device',c.server]].map(([side,label,val])=>(
                <button key={side} onClick={()=>choose(c.key,side)} style={{padding:'10px 8px',borderRadius:8,border:`2px solid ${choices[c.key]===side?C.teal:C.border}`,background:choices[c.key]===side?C.tealLight:'transparent',cursor:'pointer',textAlign:'left',transition:'all .15s'}}>
                  <div style={{fontSize:10,color:C.gray,fontWeight:600,marginBottom:3,textTransform:'uppercase'}}>{label}</div>
                  <div style={{fontSize:13,color:C.text,fontWeight:500,wordBreak:'break-word'}}>{fmtConflictVal(c.key,val,data)}</div>
                </button>
              ))}
            </div>
          </div>
        ))}
        {autoCount>0&&<div style={{fontSize:11,color:C.gray,marginBottom:14,padding:'8px 12px',borderRadius:8,background:C.surface,border:`1px solid ${C.border}`}}>
          {autoCount} other change{autoCount>1?'s':''} on different items will be merged automatically — no action needed.
        </div>}
        <button className="btn-fill" onClick={resolve} style={{width:'100%',padding:'12px',fontSize:14,fontWeight:700,border:'none',borderRadius:8,background:C.teal,color:'#fff',cursor:'pointer',marginTop:4}}>
          Apply &amp; sync
        </button>
      </div>
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────
