import React, { useState, useEffect, useCallback } from 'react';
import { C, CHART_COLORS } from '../lib/theme.js';
import { fmt, fmtA, fmtD, fmtDay, fmtWeekLabel, catColorIndex, daysUntil, subMonthlyTotal, todayStr, sanitizeMoneyInput, MAX_QUICK_ADD_AMOUNT } from '../lib/format.js';
import { conflictLabel, fmtConflictVal, MONEY_KEYS } from '../lib/data.js';
import { tabProps } from '../lib/ui-helpers.js';
import { Icon, BrandIcon, CatIcon } from './icons.jsx';
import { Pill, Card, Modal, Banner, ChoiceGroup } from './primitives.jsx';
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
// A "History" view sits alongside "Add expense" (segmented control) so a
// logged entry can still be found and removed even with the Weekly tab
// hidden — deleteWeeklyEntry is the same shared mutator Weekly's own list uses.
const segBtnStyle = active => ({
  flex:1, border:"none", background: active?C.tabActiveBg:"transparent", padding:"7px 10px", borderRadius:8,
  fontSize:12.5, fontWeight:600, color: active?C.ink:C.tabMuted, cursor:"pointer", transition:"all .15s",
});

export function QuickAddModal({onClose}) {
  const { cats, addWeeklyEntry, deleteWeeklyEntry, currentEntries, archives, currentWeekStart } = useApp();
  const spendCats = cats.filter(c=>!c.locked && !c.autoCalc);
  const [view, setView] = useState("add"); // "add" | "history"
  const switchView = v => { setView(v); setArmedId(null); };
  const [catId, setCatId] = useState(spendCats[0]?.id||"");
  const [amt, setAmt]     = useState("");
  const [date, setDate]   = useState(todayStr());
  const [note, setNote]   = useState("");
  const [notice, setNotice] = useState(null);
  const [amtCapped, setAmtCapped] = useState(false);
  // "Tap to arm, tap again to confirm" delete — a full confirm modal is overkill
  // for a list you might clear several stray entries from in a row; the auto-reset
  // guards against a stray second tap days later deleting the wrong thing.
  const [armedId, setArmedId] = useState(null);
  useEffect(()=>{
    if(!armedId) return;
    const t = setTimeout(()=>setArmedId(null), 2500);
    return ()=>clearTimeout(t);
  }, [armedId]);

  const onAmtChange = v => {
    const n = Number(v);
    setAmtCapped(v!=="" && isFinite(n) && n>MAX_QUICK_ADD_AMOUNT);
    setAmt(sanitizeMoneyInput(v, MAX_QUICK_ADD_AMOUNT));
  };
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

  // History: current week + every archived week, newest first, grouped by
  // calendar month then by week within it.
  const weeks = [{weekStart:currentWeekStart, entries:currentEntries, isCurrent:true}, ...archives]
    .filter(w=>w.entries && w.entries.length>0);
  const flatEntries = weeks.flatMap(w=>(w.entries||[]).map(e=>({...e, weekStart:w.weekStart, isCurrent:!!w.isCurrent})));
  const monthGroups = {};
  flatEntries.forEach(e=>{ (monthGroups[e.date.slice(0,7)] ||= []).push(e); });
  const monthKeys = Object.keys(monthGroups).sort().reverse();

  return (
    <Modal title="Quick add" onClose={onClose} width={400}>
      <ChoiceGroup role="tablist" ariaLabel="Quick add view" style={{display:"flex",gap:2,padding:3,marginBottom:14,background:C.surface,border:`1px solid ${C.border}`,borderRadius:11}}>
        <button type="button" {...tabProps(view==="add","qa-tab-add","qa-panel-add")} onClick={()=>switchView("add")} style={segBtnStyle(view==="add")}>Add expense</button>
        <button type="button" {...tabProps(view==="history","qa-tab-history","qa-panel-history")} onClick={()=>switchView("history")} style={segBtnStyle(view==="history")}>History{flatEntries.length>0?` (${flatEntries.length})`:""}</button>
      </ChoiceGroup>

      {view==="add" && (
        <div id="qa-panel-add" role="tabpanel" aria-labelledby="qa-tab-add" style={{display:"flex",flexDirection:"column",gap:12}}>
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
              <input type="number" min="0" placeholder="0.00" value={amt} onChange={e=>onAmtChange(e.target.value)} aria-label="Amount"
                style={{width:"100%",fontSize:13,border:`1px solid ${C.border}`,borderRadius:8,padding:"8px 10px",background:C.bg,color:C.text,boxSizing:"border-box"}}/>
              {amtCapped && <div style={{fontSize:10.5,color:C.gray,marginTop:3}}>Capped at {fmt(MAX_QUICK_ADD_AMOUNT)}.</div>}
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
      )}

      {view==="history" && (
        <div id="qa-panel-history" role="tabpanel" aria-labelledby="qa-tab-history" className="themed-scroll" style={{maxHeight:360,overflowY:"auto",paddingRight:4}}>
          {monthKeys.length===0
            ? <div style={{padding:"28px 8px",textAlign:"center",fontSize:12.5,color:C.gray,lineHeight:1.6}}>No logged expenses yet.<br/>Switch to "Add expense" to log your first one.</div>
            : monthKeys.map(mk=>{
                const monthEntries = monthGroups[mk];
                const monthTotal = monthEntries.reduce((a,e)=>a+Number(e.amount),0);
                const monthLabel = new Date(mk+"-01T12:00:00").toLocaleDateString("en-US",{month:"long",year:"numeric"});
                const weekGroupsInMonth = {};
                monthEntries.forEach(e=>{ (weekGroupsInMonth[e.weekStart] ||= []).push(e); });
                const weekKeys = Object.keys(weekGroupsInMonth).sort().reverse();
                return (
                  <div key={mk} style={{marginBottom:16}}>
                    <div style={{display:"flex",alignItems:"baseline",justifyContent:"space-between",padding:"2px 2px 8px"}}>
                      <span style={{fontSize:12.5,fontWeight:700,color:C.text}}>{monthLabel}</span>
                      <span style={{fontSize:11.5,color:C.gray}}>{fmt(monthTotal)} logged</span>
                    </div>
                    {weekKeys.map(wk=>{
                      const weekEntries=[...weekGroupsInMonth[wk]].sort((a,b)=>b.date.localeCompare(a.date)||b.id.localeCompare(a.id));
                      const weekTotal=weekEntries.reduce((a,e)=>a+Number(e.amount),0);
                      return (
                        <div key={wk} style={{marginBottom:10}}>
                          <div style={{fontSize:10.5,fontWeight:600,color:C.gray,textTransform:"uppercase",letterSpacing:"0.04em",padding:"6px 8px 6px",display:"flex",justifyContent:"space-between"}}>
                            <span>Week of {fmtWeekLabel(wk)}</span>
                            <span style={{textTransform:"none",letterSpacing:0}}>{fmt(weekTotal)}</span>
                          </div>
                          {weekEntries.map(e=>{
                            const cat=cats.find(c=>c.id===e.catId)||{label:"Other"};
                            const armed=armedId===e.id;
                            return (
                              <div key={e.id} style={{display:"flex",alignItems:"center",gap:10,padding:8,borderRadius:9}}>
                                <CatIcon name={cat.icon||e.catId} color={CHART_COLORS[catColorIndex(e.catId,cats)%CHART_COLORS.length]||C.gray} size={28}/>
                                <div style={{flex:1,minWidth:0}}>
                                  <div style={{fontSize:12.5,fontWeight:600,color:C.text}}>{cat.label}</div>
                                  <div style={{fontSize:11,color:C.gray,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{fmtDay(e.date)}{e.note?" · "+e.note:""}</div>
                                </div>
                                <span style={{fontSize:13,fontWeight:700,color:C.text}}>{fmt(e.amount)}</span>
                                <button type="button"
                                  className={`xbtn${armed?" xbtn-danger":""}`}
                                  aria-label={armed?`Confirm delete — ${cat.label}, ${fmt(e.amount)} on ${fmtDay(e.date)}`:`Delete — ${cat.label}, ${fmt(e.amount)} on ${fmtDay(e.date)}`}
                                  title={armed?"Click again to confirm":"Delete entry"}
                                  onClick={()=>{ if(armed){ deleteWeeklyEntry(e.id, !e.isCurrent); setArmedId(null); } else setArmedId(e.id); }}
                                  style={{width:26,height:26,borderRadius:13,border:"none",background:armed?C.dangerLight:"transparent",color:armed?C.danger:C.gray,cursor:"pointer",display:"inline-flex",alignItems:"center",justifyContent:"center",flexShrink:0,fontSize:13}}>
                                  {armed ? <span aria-hidden="true">⚠</span> : <Icon name="close" size={13}/>}
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
        </div>
      )}
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
// Built on the shared Modal primitive with dismissible=false: a conflict
// requires an explicit local/server choice per item, so Escape and
// scrim-click must NOT dismiss it, and there's no ✕ close button — but it
// still gets Modal's role="dialog"/aria-modal, focus trap, and focus restore
// (SilentUpdater.jsx looks for `[role="dialog"]` to avoid reloading mid-flow).
export function ConflictModal({pending, data, onResolve}) {
  const [choices, setChoices] = React.useState(()=>Object.fromEntries(pending.conflicts.map(c=>[c.key,'local'])));
  const choose=(key,side)=>setChoices(p=>({...p,[key]:side}));
  const resolve=()=>{
    const resolvedChanges=Object.fromEntries(pending.conflicts.map(c=>[c.key,{c: choices[c.key]==='local'?c.local:c.server}]));
    onResolve({...pending, resolvedChanges});
  };
  const autoCount=Object.keys(pending.mergeLocal).length+Object.keys(pending.mergeServer).length;
  return (
    <Modal title="Sync conflict" dismissible={false} width={480}>
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
      <button className="btn-fill" onClick={resolve} style={{width:'100%',padding:'12px',fontSize:14,fontWeight:700,border:'none',borderRadius:8,background:C.teal,color:C.bg,cursor:'pointer',marginTop:4}}>
        Apply &amp; sync
      </button>
    </Modal>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────
