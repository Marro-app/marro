import { useState } from 'react';
import { C } from '../lib/theme.js';
import { fmt, fmtD, subMonthlyTotal, daysUntil } from '../lib/format.js';
import { Card, SectionTitle, EmptyState, Divider, Pill } from '../components/primitives.jsx';
import { BrandIcon } from '../components/icons.jsx';
import { DateField } from '../components/pickers.jsx';
import { useApp } from '../context/AppContext.js';

// Subscriptions — add/edit form + summary + full list. The add/edit form state is
// private to this tab (it resets when you leave Subscriptions — an in-progress add
// or edit doesn't survive a tab switch, which is the expected/cleaner behavior).
// The renewal dialog (renewDlg) is App-level chrome shared with the header alert,
// so "Handle" just sets it via context.
export function SubscriptionsTab(){
  const { data, subs, syncSubs, upd, setRenewDlg } = useApp();
  const [subName, setSubName]   = useState("");
  const [subAmt, setSubAmt]     = useState("");
  const [subCycle, setSubCycle] = useState("monthly");
  const [subRenew, setSubRenew] = useState("");
  const [subEdit, setSubEdit]   = useState(null);

  const saveSub = () => {
    if(!subName.trim()||!subAmt) return;
    let d = JSON.parse(JSON.stringify(data));
    if(subEdit){
      d.subscriptions=d.subscriptions.map(s=>s.id===subEdit?{...s,name:subName,amount:parseFloat(subAmt)||0,cycle:subCycle,renewal:subRenew,renewalPrompted:false}:s);
      setSubEdit(null);
    } else {
      d.subscriptions.push({id:"s_"+Date.now(),name:subName.trim(),amount:parseFloat(subAmt)||0,cycle:subCycle,renewal:subRenew,active:true,renewalPrompted:false});
    }
    d=syncSubs(d); upd(d);
    setSubName("");setSubAmt("");setSubCycle("monthly");setSubRenew("");
  };
  const delSub = sid => { let d=JSON.parse(JSON.stringify(data));d.subscriptions=d.subscriptions.filter(s=>s.id!==sid);d=syncSubs(d);upd(d); };
  const editSub = s => { setSubEdit(s.id);setSubName(s.name);setSubAmt(String(s.amount));setSubCycle(s.cycle);setSubRenew(s.renewal||""); };

  return (
    <div role="tabpanel" id="tab-panel" aria-labelledby="tab-subscriptions" tabIndex={0} style={{display:"flex",flexDirection:"column",gap:16}}>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(min(100%,300px),1fr))",gap:16}}>
        {/* Form */}
        <Card>
          <SectionTitle>{subEdit?"Edit subscription":"Add subscription"}</SectionTitle>
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
                style={{width:"100%",fontSize:13,border:`1px solid ${C.border}`,borderRadius:8,padding:"8px 10px",background:C.bg,boxSizing:"border-box"}}/>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
              <div>
                <div style={{fontSize:11,color:C.gray,marginBottom:4,fontWeight:500}}>Amount ($)</div>
                <input type="number" placeholder="9.99" value={subAmt} onChange={e=>setSubAmt(e.target.value)}
                  style={{width:"100%",fontSize:13,border:`1px solid ${C.border}`,borderRadius:8,padding:"8px 10px",background:C.bg,boxSizing:"border-box"}}/>
              </div>
              <div>
                <div style={{fontSize:11,color:C.gray,marginBottom:4,fontWeight:500}}>Billing cycle</div>
                <select value={subCycle} onChange={e=>setSubCycle(e.target.value)} aria-label="Billing cycle"
                  style={{width:"100%",fontSize:13,border:`1px solid ${C.border}`,borderRadius:8,padding:"8px 10px",background:C.bg,boxSizing:"border-box"}}>
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
            <div style={{display:"flex",gap:8,marginTop:2}}>
              {subEdit && <button className="btn-pop" onClick={()=>{setSubEdit(null);setSubName("");setSubAmt("");setSubCycle("monthly");setSubRenew("");}} style={{padding:"9px 14px",fontSize:13,border:`1px solid ${C.border}`,borderRadius:8,background:"transparent",cursor:"pointer",color:C.gray}}>Cancel</button>}
              <button className="btn-fill" onClick={saveSub} disabled={!subName.trim()||!(parseFloat(subAmt)>0)} style={{flex:1,padding:"9px",fontSize:13,fontWeight:600,border:"none",borderRadius:8,background:(!subName.trim()||!(parseFloat(subAmt)>0))?C.surface:C.teal,color:(!subName.trim()||!(parseFloat(subAmt)>0))?C.gray:C.bg,cursor:(!subName.trim()||!(parseFloat(subAmt)>0))?"not-allowed":"pointer"}}>
                {subEdit?"Save changes":"Add subscription"}
              </button>
            </div>
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
                  {due && <button className="btn-fill" onClick={()=>setRenewDlg(s)} style={{fontSize:11,padding:"4px 10px",borderRadius:8,border:"none",background:C.amber,color:"#fff",cursor:"pointer",fontWeight:600}}>Handle</button>}
                  <button className="btn-pop" onClick={()=>editSub(s)} style={{fontSize:11,padding:"4px 10px",borderRadius:8,border:`1px solid ${C.border}`,background:"transparent",cursor:"pointer",color:C.gray}}>Edit</button>
                  <button className="btn-fill" onClick={()=>delSub(s.id)} style={{fontSize:11,padding:"4px 10px",borderRadius:8,border:`1px solid ${C.dangerMid}`,background:C.dangerLight,cursor:"pointer",color:C.danger,fontWeight:600}}>Delete</button>
                </div>
              );
            })
        }
      </Card>
    </div>
  );
}
