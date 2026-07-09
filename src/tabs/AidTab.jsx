import { useRef } from 'react';
import { C } from '../lib/theme.js';
import { fmt, fmtS, moTotal } from '../lib/format.js';
import { Card, SectionTitle, XBtn, Pill, Banner, ScrollX } from '../components/primitives.jsx';
import { DateField } from '../components/pickers.jsx';
import { useApp } from '../context/AppContext.js';
import { useEscClose } from '../lib/hooks.js';

// Aid & Detail — per-year grant/cost cards + the multi-year overview table.
// No private state: reads everything shared via useApp(). The add-year and
// remove-year modals stay App-level chrome (triggered here via setShowAddYear /
// setConfirmYearRemove).
export function AidTab(){
  const { data, subsMo, dismissed, dismiss, setYrF, upd,
          setConfirmYearRemove, setShowAddYear, totDisburse, totSpend } = useApp();

  // "How your grant works" note — was stuck showing every reload (dismissal
  // wasn't persisted, so it looked like it never actually closed) and had no
  // keyboard-dismiss path. dismiss() now persists this one specifically (see
  // App.jsx); this handles Esc + keeps focus from getting lost when the note
  // disappears out from under a focused Dismiss button.
  const aidNoteRef = useRef(null);
  const panelRef = useRef(null);
  const aidNoteOpen = !dismissed["aidnote"];
  const closeAidNote = () => {
    const active = document.activeElement;
    const hadFocus = !!(aidNoteRef.current && active && aidNoteRef.current.contains(active));
    dismiss("aidnote");
    if (hadFocus) requestAnimationFrame(() => panelRef.current?.focus());
  };
  useEscClose(aidNoteOpen, closeAidNote);

  return (
    <div role="tabpanel" id="tab-panel" aria-labelledby="tab-aid" tabIndex={0} ref={panelRef} style={{display:"flex",flexDirection:"column",gap:16}}>
      {aidNoteOpen && (
        <div ref={aidNoteRef}>
          <Banner type="info" onClose={closeAidNote}>
            <strong>How your grant works:</strong> Your grant (including health insurance) − tuition & fees − health insurance = disbursed to you for living costs.
          </Banner>
        </div>
      )}

      {/* Per-year cards */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(300px,1fr))",gap:14}}>
        {data.years.map((y,i)=>{
          const g=Number(y.grant)||0,tf=Number(y.tuitionFees)||0,hi=Number(y.healthIns)||0;
          const disb=Math.max(g-tf-hi,0),oth=(Number(y.otherIncome)||0)*12;
          const moD=(disb+oth)/12,moSp=moTotal({...y.monthly,subs:subsMo}),moS=moD-moSp;
          return (
            <Card key={y.id}>
              {/* Pinned top-right so it never wraps down beside the pill */}
              {data.years.length>1 && <div style={{position:"absolute",top:12,right:12,zIndex:1}}><XBtn label="Remove year" onClick={()=>setConfirmYearRemove(y.id)} size={30}/></div>}
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:14,flexWrap:"wrap",gap:8,rowGap:10,paddingRight:data.years.length>1?34:0}}>
                <div>
                  <div style={{fontWeight:700,fontSize:14,color:C.text}}>{y.label}</div>
                  <div style={{display:"flex",gap:6,marginTop:6,alignItems:"center",flexWrap:"wrap"}}>
                    <DateField value={y.startDate||""} onChange={v=>{const d=JSON.parse(JSON.stringify(data));d.years[i].startDate=v;upd(d);}} ariaLabel="Year start date" style={{width:"auto",fontSize:12,padding:"5px 8px"}}/>
                    <span style={{fontSize:11,color:C.gray}}>→</span>
                    <DateField value={y.endDate||""} onChange={v=>{const d=JSON.parse(JSON.stringify(data));d.years[i].endDate=v;upd(d);}} ariaLabel="Year end date" style={{width:"auto",fontSize:12,padding:"5px 8px"}}/>
                  </div>
                </div>
                <Pill ok={moS>=0} warn={moS<0}>{fmtS(moS)}/mo</Pill>
              </div>
              {[
                {label:"Grant (annual)",       field:"grant",       note:"includes health insurance"},
                {label:"Tuition & fees",            field:"tuitionFees", note:"paid directly to school"},
                {label:"Health insurance",          field:"healthIns",   note:"school-covered, deducted from grant"},
                {label:"Housing (monthly)",         field:null,          value:y.monthly.housing||0, note:"per month", isHousing:true},
                {label:"Other income (monthly)",    field:"otherIncome", note:"tutoring, work, etc."},
              ].map(({label,field,note,value,isHousing})=>(
                <div key={label} style={{padding:"5px 0",borderBottom:`1px solid ${C.border}`}}>
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                    <span style={{fontSize:12,color:C.textMid}}>{label}</span>
                    {isHousing
                      ? <input type="number" value={y.monthly.housing||0} aria-label={`${label} — ${y.label||'Year '+(i+1)}`} onChange={e=>{const d=JSON.parse(JSON.stringify(data));d.years[i].monthly.housing=Number(e.target.value)||0;upd(d);}}
                          style={{width:90,textAlign:"right",fontSize:12,border:`1px solid ${C.border}`,borderRadius:8,padding:"4px 7px",background:C.bg,color:C.text}}/>
                      : <input type="number" value={y[field]} aria-label={`${label} — ${y.label||'Year '+(i+1)}`} onChange={e=>setYrF(i,field,e.target.value)}
                          style={{width:90,textAlign:"right",fontSize:12,border:`1px solid ${C.border}`,borderRadius:8,padding:"4px 7px",background:C.bg,color:C.text}}/>
                    }
                  </div>
                  <div style={{fontSize:10,color:C.gray,marginTop:1}}>{note}</div>
                </div>
              ))}
              <div style={{marginTop:12,padding:"10px 12px",background:C.tealLight,backdropFilter:"blur(20px)",WebkitBackdropFilter:"blur(20px)",border:`1px solid ${C.tealMid}`,borderRadius:8,fontSize:12}}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}><span style={{color:C.textMid}}>Disbursed/yr</span><strong style={{color:C.teal}}>{fmt(disb)}</strong></div>
                <div style={{display:"flex",justifyContent:"space-between"}}><span style={{color:C.textMid}}>Monthly spendable</span><strong style={{color:C.teal}}>{fmt(moD)}/mo</strong></div>
              </div>
            </Card>
          );
        })}
        <button type="button" aria-label="Add year" onClick={()=>setShowAddYear(true)} style={{width:"100%",font:"inherit",background:"transparent",border:`2px dashed ${C.border}`,borderRadius:12,minHeight:120,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:8,cursor:"pointer",color:C.gray,transition:"border-color 0.15s, color 0.15s"}}
          onMouseEnter={e=>{e.currentTarget.style.borderColor=C.teal;e.currentTarget.style.color=C.teal;}}
          onMouseLeave={e=>{e.currentTarget.style.borderColor=C.border;e.currentTarget.style.color=C.gray;}}>
          <span style={{fontSize:24,fontWeight:300,lineHeight:1}}>+</span>
          <span style={{fontSize:12,fontWeight:600}}>Add year</span>
        </button>
      </div>

      {/* 5-year table */}
      <Card>
        <SectionTitle>{data.years.length}-year overview</SectionTitle>
        <ScrollX className="scrollx" style={{overflowX:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
            <thead><tr>
              {["Year","Grant","School costs","Disbursed/yr","Spendable/mo","Budget/mo","Surplus/mo","Cumulative"].map(h=>
                <th key={h} style={{textAlign:"left",fontSize:10,color:C.gray,padding:"6px 8px",borderBottom:`1px solid ${C.border}`,fontWeight:600,whiteSpace:"nowrap"}}>{h}</th>
              )}
            </tr></thead>
            <tbody>
              {(()=>{
                let cum=0;
                return data.years.map(y=>{
                  const g=Number(y.grant)||0,tf=Number(y.tuitionFees)||0,hi=Number(y.healthIns)||0;
                  const disb=Math.max(g-tf-hi,0),oth=(Number(y.otherIncome)||0)*12;
                  const moD=(disb+oth)/12,moSp=moTotal({...y.monthly,subs:subsMo}),moS=moD-moSp;
                  cum+=moS*12;
                  return <tr key={y.id}>
                    <td style={{padding:"8px",fontWeight:600,whiteSpace:"nowrap",fontSize:11,color:C.text}}>{y.label}</td>
                    <td style={{padding:"8px",color:C.neg,fontWeight:600}}>{g>0?fmt(g):"TBD"}</td>
                    <td style={{padding:"8px",color:C.gray}}>{fmt(tf+hi)}</td>
                    <td style={{padding:"8px",color:C.teal,fontWeight:600}}>{fmt(disb)}</td>
                    <td style={{padding:"8px",fontWeight:600,color:C.text}}>{fmt(moD)}</td>
                    <td style={{padding:"8px",color:C.text}}>{fmt(moSp)}</td>
                    <td style={{padding:"8px",fontWeight:600,color:moS>=0?C.teal:C.neg}}>{fmtS(moS)}</td>
                    <td style={{padding:"8px",fontWeight:700,color:cum>=0?C.teal:C.neg}}>{fmtS(cum)}</td>
                  </tr>;
                });
              })()}
            </tbody>
          </table>
        </ScrollX>
        <div style={{marginTop:10,padding:"8px 12px",background:totDisburse-totSpend>=0?C.tealLight:C.negLight,backdropFilter:"blur(20px)",WebkitBackdropFilter:"blur(20px)",border:`1px solid ${totDisburse-totSpend>=0?C.tealMid:C.negMid}`,borderRadius:8,fontSize:12,color:totDisburse-totSpend>=0?C.teal:C.neg,fontWeight:600}}>
          {data.years.length}-year net: {fmtS(totDisburse-totSpend)}
        </div>
      </Card>

    </div>
  );
}
