import { useRef, useState } from 'react';
import { C } from '../lib/theme.js';
import { fmt, fmtS, moTotal, todayStr, sanitizeMoneyInput } from '../lib/format.js';
import { Card, SectionTitle, XBtn, Pill, ScrollX, InfoTip } from '../components/primitives.jsx';
import { Icon } from '../components/icons.jsx';
import { DateField } from '../components/pickers.jsx';
import { useApp } from '../context/AppContext.js';
import { useEscClose } from '../lib/hooks.js';

// Aid & Detail — per-year grant/cost cards + the multi-year overview table.
// No private state besides the collapse/expand set for the year cards (item 4,
// mo/copy-clarity): everything else reads shared via useApp(). The add-year and
// remove-year modals stay App-level chrome (triggered here via setShowAddYear /
// setConfirmYearRemove).
export function AidTab(){
  const { data, subsMo, dismissed, dismiss, setYrF, upd, ay,
          annGrant, annTuition, annHlth, annDisburse,
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

  // Year cards default collapsed to a summary row — except the year that
  // actually contains today, so the student isn't stuck opening the right one
  // every visit. Falls back to the active tab year, then the first year, if no
  // year's date range covers today (e.g. dates not filled in yet). Computed
  // once on mount (lazy initializer) — the user's own expand/collapse choices
  // afterward are never overridden by a re-render.
  const today = todayStr();
  const [expandedYears, setExpandedYears] = useState(() => {
    const current = data.years.find(y => y.startDate && y.endDate && today >= y.startDate && today <= y.endDate);
    const fallback = data.years.find(y => y.id === ay) || data.years[0];
    const initial = current || fallback;
    return new Set(initial ? [initial.id] : []);
  });
  const toggleYear = (id) => setExpandedYears(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  // Item 8 — friendly full date for overlap messages. ISO "YYYY-MM-DD" strings
  // sort/compare correctly as plain strings, so the overlap checks below just
  // use </<=/>= on them; this is only for the human-readable message text.
  const friendlyDate = iso => iso ? new Date(iso+"T12:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}) : "";
  const shortLabel = y => (y?.label||"").split("—")[0].trim();

  return (
    <div role="tabpanel" id="tab-panel" aria-labelledby="tab-aid" tabIndex={0} ref={panelRef} style={{display:"flex",flexDirection:"column",gap:16}}>
      {aidNoteOpen && (
        // Explanatory note (item 7 redesign): the old version stacked a bold
        // banner title over a second filled teal box — two competing surfaces
        // that read busy. This is a single quiet raised panel (G3 inline glass):
        // a calm header, a clean right-aligned ledger with tabular numerals so
        // the amounts line up, one hairline divider, then a single emphasized
        // result row. Dismiss + Esc behavior is unchanged (closeAidNote).
        <div ref={aidNoteRef} style={{position:"relative",borderRadius:12,padding:16,background:C.surface,border:`1px solid ${C.border}`,backdropFilter:"blur(20px)",WebkitBackdropFilter:"blur(20px)"}}>
          <div style={{position:"absolute",top:8,right:8}}>
            <XBtn label="Dismiss" onClick={closeAidNote} size={28}/>
          </div>
          <div style={{marginBottom:12,paddingRight:32}}>
            <div style={{fontSize:13,fontWeight:600,color:C.text,letterSpacing:"-0.01em"}}>How your aid works</div>
            <div style={{fontSize:11,color:C.gray,marginTop:4,lineHeight:1.5}}>Where this year&apos;s aid goes, and what&apos;s left for you to live on.</div>
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:8,fontVariantNumeric:"tabular-nums"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",gap:16,fontSize:12}}>
              <span style={{color:C.textMid}}>Total aid</span>
              <span style={{color:C.text,fontWeight:600}}>{fmt(annGrant)}</span>
            </div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",gap:16,fontSize:12}}>
              <span style={{color:C.textMid}}>Tuition &amp; fees</span>
              <span style={{color:C.textMid}}>− {fmt(annTuition)}</span>
            </div>
            {annHlth>0 && (
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",gap:16,fontSize:12}}>
                <span style={{color:C.textMid}}>Health insurance</span>
                <span style={{color:C.textMid}}>− {fmt(annHlth)}</span>
              </div>
            )}
            <div style={{height:1,background:C.border,margin:"4px 0"}}/>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",gap:16}}>
              <span style={{fontSize:12,fontWeight:600,color:C.text}}>You keep for living costs</span>
              <span style={{fontSize:14,fontWeight:700,color:C.teal}}>{fmt(annDisburse)}</span>
            </div>
          </div>
        </div>
      )}

      {/* Per-year cards — each collapses to a summary row (label, Total aid,
          Sent to you, the surplus Pill); click/Enter/Space expands the full
          field set. Real <button> for the toggle: native focus + keyboard
          activation, no custom key handling needed. */}
      {/* alignItems:"start" is load-bearing: grid items default to align-items:stretch,
          which forces every card in a row to the height of its tallest sibling. So
          expanding ONE card stretched its collapsed row-neighbors to match — they grew
          tall and blank (summary row up top, empty space below) even though their detail
          panel wasn't rendered. "start" lets each card size to its own content, so a
          collapsed card stays a summary row no matter how tall its neighbor gets.
          minmax(min(100%,300px),1fr) (per DESIGN_SYSTEM "Layout") also stops a hard 300px
          track from overflowing viewports narrower than 300px. */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(min(100%,300px),1fr))",gap:16,alignItems:"start"}}>
        {data.years.map((y,i)=>{
          const g=Number(y.grant)||0,tf=Number(y.tuitionFees)||0,hi=Number(y.healthIns)||0;
          const rawGap=g-tf-hi; // unfloored — negative means costs exceed aid
          const disb=Math.max(g-tf-hi,0),oth=(Number(y.otherIncome)||0)*12;
          const moD=(disb+oth)/12,moSp=moTotal({...y.monthly,subs:subsMo}),moS=moD-moSp;
          const expanded = expandedYears.has(y.id);
          // Item 8 — flag overlapping year ranges. Years are stored in order, so
          // the only neighbors that can overlap are i-1 (ends after this one
          // starts) and i+1 (starts before this one ends). We flag rather than
          // silently clamp so the student sees exactly what's wrong and fixes it.
          const prevYr = data.years[i-1], nextYr = data.years[i+1];
          const startOverlap = prevYr?.endDate && y.startDate && y.startDate <= prevYr.endDate;
          const endOverlap   = nextYr?.startDate && y.endDate && y.endDate >= nextYr.startDate;
          const invertedRange = y.startDate && y.endDate && y.endDate < y.startDate;
          return (
            // Item 10 — an expanded card spans the whole grid (grid-column:1/-1)
            // so its collapsed row-neighbors reflow below/around it instead of
            // being stretched blank beside it; collapsed cards keep their normal
            // single track. At mobile width the grid is already one column, so
            // 1/-1 is a no-op there.
            <Card key={y.id} style={{gridColumn:expanded?"1 / -1":"auto"}}>
              {/* Pinned top-right so it never wraps down beside the pill */}
              {data.years.length>1 && <div style={{position:"absolute",top:12,right:12,zIndex:1}}><XBtn label="Remove year" onClick={()=>setConfirmYearRemove(y.id)} size={30}/></div>}

              {/* Item 9 — the ENTIRE header row is one full-width button. Negative
                  margins pull it out to the card's edges and the padding is added
                  back inside, so the whole header (including the empty space beside
                  the chevron that used to be dead card-padding) toggles the card.
                  box-sizing:border-box keeps the padded-back button within bounds.
                  Extra right padding clears the absolutely-positioned Remove ✕. */}
              <button type="button" onClick={()=>toggleYear(y.id)} aria-expanded={expanded} aria-controls={`aid-year-detail-${y.id}`}
                style={{display:"flex",boxSizing:"border-box",width:"auto",minHeight:44,justifyContent:"space-between",alignItems:"center",gap:8,flexWrap:"wrap",rowGap:6,margin:"-18px -20px 0",padding:"18px 20px",paddingRight:data.years.length>1?54:20,background:"transparent",border:"none",cursor:"pointer",textAlign:"left",font:"inherit",color:"inherit"}}>
                <span style={{display:"flex",alignItems:"center",gap:8,minWidth:0}}>
                  <Icon name="chevron" size={12} style={{transform:expanded?"rotate(180deg)":"none",transition:"transform .15s",color:C.gray,flexShrink:0}}/>
                  <span style={{fontWeight:700,fontSize:14,color:C.text,whiteSpace:"nowrap"}}>{y.label}</span>
                </span>
                <span style={{display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
                  <span style={{fontSize:11.5,color:C.textMid,whiteSpace:"nowrap"}}>Total aid <strong style={{color:C.text}}>{fmt(g)}</strong></span>
                  <span style={{fontSize:11.5,color:C.textMid,whiteSpace:"nowrap"}}>Sent to you <strong style={{color:C.teal}}>{fmt(disb)}</strong></span>
                  <Pill ok={moS>=0} warn={moS<0}>{fmtS(moS)}/mo{moS<0?" short":" left over"}</Pill>
                </span>
              </button>

              {expanded && (
                <div id={`aid-year-detail-${y.id}`} style={{marginTop:14}}>
                  <div style={{display:"flex",gap:8,marginBottom:invertedRange||startOverlap||endOverlap?8:10,alignItems:"center",flexWrap:"wrap"}}>
                    <DateField value={y.startDate||""} onChange={v=>{const d=JSON.parse(JSON.stringify(data));d.years[i].startDate=v;upd(d);}} ariaLabel="Year start date" style={{width:"auto",fontSize:12,padding:"5px 8px"}}/>
                    <span style={{fontSize:11,color:C.gray}}>→</span>
                    <DateField value={y.endDate||""} onChange={v=>{const d=JSON.parse(JSON.stringify(data));d.years[i].endDate=v;upd(d);}} ariaLabel="Year end date" style={{width:"auto",fontSize:12,padding:"5px 8px"}}/>
                  </div>
                  {(invertedRange||startOverlap||endOverlap) && (
                    <div role="alert" style={{marginBottom:10,padding:"8px 12px",background:C.dangerLight,border:`1px solid ${C.dangerMid}`,borderRadius:8,fontSize:12,color:C.danger,lineHeight:1.5}}>
                      {invertedRange
                        ? "This year's end date is before its start date. Pick an end date that comes after the start date."
                        : startOverlap
                          ? `These dates overlap ${shortLabel(prevYr)}, which ends ${friendlyDate(prevYr.endDate)}. Pick a start date after that.`
                          : `These dates overlap ${shortLabel(nextYr)}, which starts ${friendlyDate(nextYr.startDate)}. Pick an end date before that.`}
                    </div>
                  )}
                  {[
                    {label:"Total aid (annual)",   field:"grant",       note:"Includes health insurance. May include loans you'll repay — loan tracking is coming soon."},
                    {label:"Tuition & fees",            field:"tuitionFees", note:"paid directly to school"},
                    {label:"Health insurance",          field:"healthIns",   note:"school-covered, deducted from grant"},
                    {label:"Housing (monthly)",         field:null,          value:y.monthly.housing||0, note:"per month", isHousing:true},
                    {label:"Other income (monthly)",    field:"otherIncome", note:"tutoring, work, etc."},
                  ].map(({label,field,note,value,isHousing})=>(
                    <div key={label} style={{padding:"5px 0",borderBottom:`1px solid ${C.border}`}}>
                      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                        <span style={{fontSize:12,color:C.textMid}}>{label}</span>
                        {isHousing
                          ? <input type="number" min="0" value={y.monthly.housing||0} aria-label={`${label} — ${y.label||'Year '+(i+1)}`} onChange={e=>{const d=JSON.parse(JSON.stringify(data));d.years[i].monthly.housing=Number(sanitizeMoneyInput(e.target.value))||0;upd(d);}}
                              style={{width:90,textAlign:"right",fontSize:12,border:`1px solid ${C.border}`,borderRadius:8,padding:"4px 7px",background:C.bg,color:C.text}}/>
                          : <input type="number" min="0" value={y[field]} aria-label={`${label} — ${y.label||'Year '+(i+1)}`} onChange={e=>setYrF(i,field,sanitizeMoneyInput(e.target.value))}
                              style={{width:90,textAlign:"right",fontSize:12,border:`1px solid ${C.border}`,borderRadius:8,padding:"4px 7px",background:C.bg,color:C.text}}/>
                        }
                      </div>
                      <div style={{fontSize:10,color:C.gray,marginTop:1}}>{note}</div>
                    </div>
                  ))}
                  <div style={{marginTop:12,padding:"10px 12px",background:C.tealLight,backdropFilter:"blur(20px)",WebkitBackdropFilter:"blur(20px)",border:`1px solid ${C.tealMid}`,borderRadius:8,fontSize:12}}>
                    <div style={{display:"flex",justifyContent:"space-between",marginBottom:3,alignItems:"center"}}><span style={{color:C.textMid,display:"flex",alignItems:"center",gap:4}}>Sent to you/yr <InfoTip text="Aid left over after tuition and fees — the part that hits your bank account for living costs."/></span><strong style={{color:C.teal}}>{fmt(disb)}</strong></div>
                    <div style={{display:"flex",justifyContent:"space-between"}}><span style={{color:C.textMid}}>Monthly spendable</span><strong style={{color:C.teal}}>{fmt(moD)}/mo</strong></div>
                  </div>
                  {rawGap<0 && (
                    <div role="alert" style={{marginTop:8,padding:"10px 12px",background:C.dangerLight,border:`1px solid ${C.dangerMid}`,borderRadius:8,fontSize:12,color:C.danger,fontWeight:600}}>
                      Your costs exceed your aid by {fmt(Math.abs(rawGap))} this year.
                    </div>
                  )}
                </div>
              )}
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

      {/* 5-year table — untouched (per scope: the overview table stays as-is
          except the "Disbursed/yr" → "Sent to you/yr" header, same as item 1). */}
      <Card>
        <SectionTitle>{data.years.length}-year overview</SectionTitle>
        <ScrollX className="scrollx" style={{overflowX:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
            <thead><tr>
              {["Year","Total aid","School costs","Sent to you/yr","Spendable/mo","Budget/mo","Surplus/mo","Cumulative"].map(h=>
                <th key={h} style={{textAlign:"left",fontSize:10,color:C.gray,padding:"6px 8px",borderBottom:`1px solid ${C.border}`,fontWeight:600,whiteSpace:"nowrap"}}>{h}</th>
              )}
            </tr></thead>
            <tbody>
              {(()=>{
                let cum=0;
                return data.years.map(y=>{
                  const g=Number(y.grant)||0,tf=Number(y.tuitionFees)||0,hi=Number(y.healthIns)||0;
                  const rawGap=g-tf-hi; // unfloored — negative means costs exceed aid
                  const disb=Math.max(g-tf-hi,0),oth=(Number(y.otherIncome)||0)*12;
                  const moD=(disb+oth)/12,moSp=moTotal({...y.monthly,subs:subsMo}),moS=moD-moSp;
                  cum+=moS*12;
                  return <tr key={y.id}>
                    <td style={{padding:"8px",fontWeight:600,whiteSpace:"nowrap",fontSize:11,color:C.text}}>{y.label}</td>
                    <td style={{padding:"8px",color:C.neg,fontWeight:600}}>
                      {g>0?fmt(g):"TBD"}
                      {rawGap<0 && <span title={`Costs exceed aid by ${fmt(Math.abs(rawGap))} this year`} style={{marginLeft:4,color:C.danger}} aria-label={`Warning: costs exceed aid by ${fmt(Math.abs(rawGap))} this year`}>⚠</span>}
                    </td>
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
          {totDisburse-totSpend<0 && (
            <div style={{marginTop:6,fontSize:11.5,fontWeight:400,color:C.textMid,lineHeight:1.5}}>
              Most med students borrow to bridge this — that&apos;s what the loans are for. Your aid office can help you plan it.
            </div>
          )}
        </div>
      </Card>

    </div>
  );
}
