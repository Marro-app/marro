import { useState } from 'react';
import { C } from '../lib/theme.js';
import { fmt, fmtD, subMonthlyTotal, daysUntil } from '../lib/format.js';
import { Card, SectionTitle, EmptyState, Divider, Pill, Modal } from '../components/primitives.jsx';
import { BrandIcon } from '../components/icons.jsx';
import { DateField } from '../components/pickers.jsx';
import { RenewalDialog } from '../components/modals.jsx';
import { useApp } from '../context/AppContext.js';
import { logEvent } from '../lib/data.js';

// Dedicated edit modal — makes "you're editing X" unmistakable (vs. the old
// repopulate-the-add-form pattern, which users missed). Owns its own field state
// seeded from the subscription; Save/Delete/Cancel all close it.
function SubEditModal({sub, onSave, onDelete, onClose}) {
  const [name, setName]   = useState(sub.name);
  const [amt, setAmt]     = useState(String(sub.amount));
  const [cycle, setCycle] = useState(sub.cycle);
  const [renew, setRenew] = useState(sub.renewal||"");
  const canSave = name.trim() && parseFloat(amt)>0;
  return (
    <Modal title="Edit subscription" onClose={onClose} width={380}>
      <div style={{display:"flex",alignItems:"center",gap:10,padding:"10px 12px",background:C.surface,borderRadius:8,marginBottom:14,border:`1px solid ${C.border}`}}>
        <BrandIcon name={name} size={32}/>
        <span style={{fontSize:13,fontWeight:600,color:C.text}}>{name||"Subscription"}</span>
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:10}}>
        <div>
          <div style={{fontSize:11,color:C.gray,marginBottom:4,fontWeight:500}}>Service name</div>
          <input value={name} onChange={e=>setName(e.target.value)} aria-label="Service name"
            style={{width:"100%",fontSize:13,border:`1px solid ${C.border}`,borderRadius:8,padding:"8px 10px",background:C.bg,color:C.text,boxSizing:"border-box"}}/>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
          <div>
            <div style={{fontSize:11,color:C.gray,marginBottom:4,fontWeight:500}}>Amount ($)</div>
            <input type="number" value={amt} onChange={e=>setAmt(e.target.value)} aria-label="Amount"
              style={{width:"100%",fontSize:13,border:`1px solid ${C.border}`,borderRadius:8,padding:"8px 10px",background:C.bg,color:C.text,boxSizing:"border-box"}}/>
          </div>
          <div>
            <div style={{fontSize:11,color:C.gray,marginBottom:4,fontWeight:500}}>Billing cycle</div>
            <select value={cycle} onChange={e=>setCycle(e.target.value)} aria-label="Billing cycle"
              style={{width:"100%",fontSize:13,border:`1px solid ${C.border}`,borderRadius:8,padding:"8px 10px",background:C.bg,color:C.text,boxSizing:"border-box"}}>
              <option value="monthly">Monthly</option>
              <option value="annual">Annual</option>
              <option value="quarterly">Quarterly</option>
              <option value="one-time">One-time</option>
            </select>
          </div>
        </div>
        <div>
          <div style={{fontSize:11,color:C.gray,marginBottom:4,fontWeight:500}}>Next renewal date</div>
          <DateField value={renew} onChange={setRenew} ariaLabel="Next renewal date"/>
        </div>
        {/* Secondary/destructive left, primary right (CLAUDE.md rule 9) */}
        <div style={{display:"flex",gap:8,marginTop:2}}>
          <button className="btn-fill" onClick={()=>{onDelete(sub.id);onClose();}} style={{padding:"9px 14px",fontSize:13,fontWeight:600,border:`1px solid ${C.dangerMid}`,borderRadius:8,background:C.dangerLight,color:C.danger,cursor:"pointer"}}>Delete</button>
          <button className="btn-fill" onClick={()=>{if(canSave){onSave(sub.id,{name:name.trim(),amount:parseFloat(amt)||0,cycle,renewal:renew});onClose();}}} disabled={!canSave} style={{flex:1,padding:"9px",fontSize:13,fontWeight:600,border:"none",borderRadius:8,background:canSave?C.teal:C.surface,color:canSave?C.bg:C.gray,cursor:canSave?"pointer":"not-allowed"}}>Save changes</button>
        </div>
      </div>
    </Modal>
  );
}

// Subscriptions — an add-only inline form, summary, and full list. Editing and
// renewal both happen in dedicated modals rendered locally (so they stack above
// the "Fixed monthly costs" modal this tab is shown inside — an App-level dialog
// would paint behind it at equal z-index). Renewal state mutation is shared via
// applyRenewal() in context; the local dialog just drives it.
export function SubscriptionsTab(){
  const { data, subs, syncSubs, upd, applyRenewal } = useApp();
  const [subName, setSubName]   = useState("");
  const [subAmt, setSubAmt]     = useState("");
  const [subCycle, setSubCycle] = useState("monthly");
  const [subRenew, setSubRenew] = useState("");
  const [editSub, setEditSub]   = useState(null);   // subscription object being edited
  const [renewSub, setRenewSub] = useState(null);   // subscription object being renewed

  const addSub = () => {
    if(!subName.trim()||!(parseFloat(subAmt)>0)) return;
    let d = JSON.parse(JSON.stringify(data));
    d.subscriptions.push({id:"s_"+Date.now(),name:subName.trim(),amount:parseFloat(subAmt)||0,cycle:subCycle,renewal:subRenew,active:true,renewalPrompted:false});
    d=syncSubs(d); upd(d);
    setSubName("");setSubAmt("");setSubCycle("monthly");setSubRenew("");
    logEvent('subscription_added', {});
  };
  const saveEdit = (sid, fields) => {
    let d = JSON.parse(JSON.stringify(data));
    d.subscriptions=d.subscriptions.map(s=>s.id===sid?{...s,...fields,renewalPrompted:false}:s);
    d=syncSubs(d); upd(d);
  };
  const delSub = sid => { let d=JSON.parse(JSON.stringify(data));d.subscriptions=d.subscriptions.filter(s=>s.id!==sid);d=syncSubs(d);upd(d); };

  const canAdd = subName.trim() && parseFloat(subAmt)>0;

  return (
    <div role="tabpanel" id="tab-panel" aria-labelledby="tab-subscriptions" tabIndex={0} style={{display:"flex",flexDirection:"column",gap:16}}>
      {editSub && <SubEditModal sub={editSub} onSave={saveEdit} onDelete={delSub} onClose={()=>setEditSub(null)}/>}
      {renewSub && <RenewalDialog sub={renewSub} onClose={()=>setRenewSub(null)} onConfirm={(sub,renewed,newAmt,newDate)=>{applyRenewal(sub,renewed,newAmt,newDate);setRenewSub(null);}}/>}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(min(100%,300px),1fr))",gap:16}}>
        {/* Add form */}
        <Card>
          <SectionTitle>Add subscription</SectionTitle>
          {subName && (
            <div style={{display:"flex",alignItems:"center",gap:10,padding:"10px 12px",background:C.surface,borderRadius:8,marginBottom:14,border:`1px solid ${C.border}`}}>
              <BrandIcon name={subName} size={32}/>
              <span style={{fontSize:12,color:C.textMid,fontStyle:"italic"}}>Preview</span>
            </div>
          )}
          <div style={{display:"flex",flexDirection:"column",gap:10}}>
            <div>
              <div style={{fontSize:11,color:C.gray,marginBottom:4,fontWeight:500}}>Service name</div>
              <input placeholder="e.g. Spotify, UWorld, Netflix" value={subName} onChange={e=>setSubName(e.target.value)}
                style={{width:"100%",fontSize:13,border:`1px solid ${C.border}`,borderRadius:8,padding:"8px 10px",background:C.bg,color:C.text,boxSizing:"border-box"}}/>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
              <div>
                <div style={{fontSize:11,color:C.gray,marginBottom:4,fontWeight:500}}>Amount ($)</div>
                <input type="number" placeholder="9.99" value={subAmt} onChange={e=>setSubAmt(e.target.value)}
                  style={{width:"100%",fontSize:13,border:`1px solid ${C.border}`,borderRadius:8,padding:"8px 10px",background:C.bg,color:C.text,boxSizing:"border-box"}}/>
              </div>
              <div>
                <div style={{fontSize:11,color:C.gray,marginBottom:4,fontWeight:500}}>Billing cycle</div>
                <select value={subCycle} onChange={e=>setSubCycle(e.target.value)} aria-label="Billing cycle"
                  style={{width:"100%",fontSize:13,border:`1px solid ${C.border}`,borderRadius:8,padding:"8px 10px",background:C.bg,color:C.text,boxSizing:"border-box"}}>
                  <option value="monthly">Monthly</option>
                  <option value="annual">Annual</option>
                  <option value="quarterly">Quarterly</option>
                  <option value="one-time">One-time</option>
                </select>
              </div>
            </div>
            <div>
              <div style={{fontSize:11,color:C.gray,marginBottom:4,fontWeight:500}}>Next renewal date</div>
              <DateField value={subRenew} onChange={setSubRenew} ariaLabel="Next renewal date"/>
            </div>
            <button className="btn-fill" onClick={addSub} disabled={!canAdd} style={{padding:"9px",fontSize:13,fontWeight:600,border:"none",borderRadius:8,background:canAdd?C.teal:C.surface,color:canAdd?C.bg:C.gray,cursor:canAdd?"pointer":"not-allowed",marginTop:2}}>
              Add subscription
            </button>
          </div>
        </Card>

        {/* Summary */}
        <Card>
          <SectionTitle>Summary</SectionTitle>
          {subs.length===0
            ? <EmptyState>No subscriptions yet — add your first one on the left to track renewals automatically.</EmptyState>
            : (() => {
                const mo = subMonthlyTotal(subs);
                const upcoming = subs.filter(s=>{const d=daysUntil(s.renewal);return d!==null&&d>=0&&d<=30;});
                return <>
                  <div style={{display:"flex",gap:10,marginBottom:16,flexWrap:"wrap"}}>
                    {[{l:"Monthly",v:fmtD(mo)},{l:"Annual",v:fmt(mo*12)},{l:"Active",v:String(subs.filter(s=>s.active!==false).length)}].map(m=>(
                      <div key={m.l} style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:8,padding:"10px 14px",flex:1}}>
                        <div style={{fontSize:10,color:C.gray,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:3}}>{m.l}</div>
                        <div style={{fontSize:18,fontWeight:700,color:C.neg,fontFamily:"'Newsreader',Georgia,serif"}}>{m.v}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{fontSize:12,color:C.textMid,marginBottom:8}}>This {fmtD(mo)}/mo is auto-reflected in your budget.</div>
                  {upcoming.length>0 && <>
                    <Divider/>
                    <div style={{fontSize:12,fontWeight:600,color:C.text,marginBottom:8}}>Upcoming renewals</div>
                    {upcoming.map(s=>{
                      const d=daysUntil(s.renewal);
                      return <div key={s.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"5px 0",borderBottom:`1px solid ${C.border}`,fontSize:12}}>
                        <div style={{display:"flex",alignItems:"center",gap:8}}><BrandIcon name={s.name} size={20}/><span>{s.name}</span></div>
                        <Pill ok={d>7} warn={d<=7} sm>{d===0?"Today":d+"d"}</Pill>
                      </div>;
                    })}
                  </>}
                </>;
              })()
          }
        </Card>
      </div>

      {/* Full list */}
      <Card>
        <SectionTitle>{subs.length} subscription{subs.length!==1?"s":""}</SectionTitle>
        {subs.length===0
          ? <div style={{textAlign:"center",padding:"20px 0",color:C.gray,fontSize:13}}>Add your first subscription above.</div>
          : subs.map(s=>{
              const d=daysUntil(s.renewal);
              const due=d!==null&&d<=0;
              const soon=d!==null&&d>0&&d<=7;
              const mo=s.cycle==="monthly"?s.amount:s.cycle==="annual"?s.amount/12:s.cycle==="quarterly"?s.amount/3:null;
              return (
                <div key={s.id} style={{display:"flex",alignItems:"center",gap:12,padding:"10px 0",borderBottom:`1px solid ${C.border}`}}>
                  <BrandIcon name={s.name} size={38}/>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontWeight:600,fontSize:13,color:C.text}}>{s.name}</div>
                    <div style={{fontSize:11,color:C.gray,marginTop:2}}>
                      {fmtD(s.amount)}/{s.cycle}
                      {mo?` · ${fmtD(mo)}/mo`:""}{s.renewal?` · Renews ${s.renewal}`:""}
                    </div>
                  </div>
                  {due && <Pill warn sm>Overdue</Pill>}
                  {soon && <Pill warn sm>{d}d</Pill>}
                  {due && <button className="btn-fill" onClick={()=>setRenewSub(s)} style={{fontSize:11,padding:"4px 10px",borderRadius:8,border:"none",background:C.amber,color:"#fff",cursor:"pointer",fontWeight:600}}>Handle</button>}
                  <button className="btn-pop" onClick={()=>setEditSub(s)} style={{fontSize:11,padding:"4px 10px",borderRadius:8,border:`1px solid ${C.border}`,background:"transparent",cursor:"pointer",color:C.gray}}>Edit</button>
                  <button className="btn-fill" onClick={()=>delSub(s.id)} style={{fontSize:11,padding:"4px 10px",borderRadius:8,border:`1px solid ${C.dangerMid}`,background:C.dangerLight,cursor:"pointer",color:C.danger,fontWeight:600}}>Delete</button>
                </div>
              );
            })
        }
      </Card>
    </div>
  );
}
