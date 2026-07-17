import { useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { C, CHART_COLORS, tipProps } from '../lib/theme.js';
import { fmt, fmtS, MONTH_NAMES, MONTH_FULL } from '../lib/format.js';
import { USMLE_STEP_FEE_ESTIMATE } from '../lib/constants.js';
import { Card, SectionTitle, Divider, InfoTip, Pill, XBtn, Modal } from '../components/primitives.jsx';
import { Icon, CatIcon, CatIconPicker } from '../components/icons.jsx';
import { MonthPicker } from '../components/pickers.jsx';
import { SubscriptionsTab } from './SubscriptionsTab.jsx';
import { useApp } from '../context/AppContext.js';

// Budget — the monthly plan (per-category budgets for the selected month), cash
// flow, health checks, running balance, and notes, plus the add-category and
// remove-category modals (previously hoisted to App). Private state: category
// drag-reorder + the two modal toggles. selMonth is shared (it also drives the
// header metrics) and the add-category form fields (newCat*) are shared with the
// Categories tab — both come from useApp().
export function BudgetTab(){
  const { data, cats, ay, yr, yrStartYear, selMonth, setSelMonth, subs, subsMo, disabledCats,
          moSpend, moSpendable, moSurplus, runningBalance, totalAccumulatedBalance,
          priorYearsCarryover, annDisburse, annOther, allEntriesFlat,
          getMonthVal, spentInMonth, unbudgetedCats, unbudgetedTotal, promoteToBudget,
          toggleMonthCat, setMo, setYrF, reorderCats, addCat,
          newCatName, setNewCatName, newCatIcon, setNewCatIcon, iconPickOpen, setIconPickOpen } = useApp();
  const [dragCat, setDragCat] = useState(null);
  const [dragOverCat, setDragOverCat] = useState(null);
  const [showAddCat, setShowAddCat] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(null);
  const [showSubscriptions, setShowSubscriptions] = useState(false);
  const [barHover, setBarHover] = useState(null);
  const barDim = i => barHover!=null && barHover!==i ? 0.35 : 1;
  const barMove = s => setBarHover(s && s.isTooltipActive && s.activeTooltipIndex!=null ? s.activeTooltipIndex : null);

  // Plan vs actual — the one chart Phase 1 keeps on Home (ported from the hidden Charts tab)
  const budgetVsActual = MONTH_NAMES.map((m,mi)=>{
    const mk=ay+"-"+m;
    const disM=data.monthDisabled?.[mk]||[];
    let budgeted=0;
    cats.forEach(c=>{
      if(disM.includes(c.id)) return;
      if(c.id==="subs"){budgeted+=subsMo;return;}
      const ov=yr.monthlyOverrides?.[m]?.[c.id];
      budgeted+=(ov!==undefined?ov:(Number(yr.monthly[c.id])||0));
    });
    const calMo=(mi+7)%12;
    const calYr=yrStartYear+(mi>=5?1:0);
    const actual=allEntriesFlat.filter(e=>{const dt=new Date(e.date+"T12:00:00");return dt.getMonth()===calMo&&dt.getFullYear()===calYr;}).reduce((a,e)=>a+Number(e.amount),0);
    return {name:m, Budgeted:Math.round(budgeted), Actual:Math.round(actual)};
  }).filter(d=>d.Actual>0);
  return (
    <>
      {showSubscriptions && <Modal title="Fixed monthly costs" onClose={()=>setShowSubscriptions(false)} width={640}><SubscriptionsTab/></Modal>}
      {confirmRemove && <Modal title="Remove category" onClose={()=>setConfirmRemove(null)} width={340}>
        <div style={{fontSize:13,color:C.textMid,marginBottom:16}}>Remove <strong>{cats.find(c=>c.id===confirmRemove)?.label}</strong> from {MONTH_FULL[selMonth]}? You can add it back anytime.</div>
        <div style={{display:"flex",gap:8}}>
          <button className="btn-pop" onClick={()=>setConfirmRemove(null)} style={{flex:1,padding:"10px",fontSize:13,fontWeight:500,border:`1px solid ${C.border}`,borderRadius:8,background:"transparent",color:C.gray,cursor:"pointer"}}>Cancel</button>
          <button className="btn-fill" onClick={()=>{toggleMonthCat(confirmRemove);setConfirmRemove(null);}} style={{flex:1,padding:"10px",fontSize:13,fontWeight:600,border:"none",borderRadius:8,background:C.danger,color:C.bg,cursor:"pointer"}}>Remove</button>
        </div>
      </Modal>}
      {showAddCat && <Modal title={"Add category — "+MONTH_FULL[selMonth]} onClose={()=>setShowAddCat(false)} width={380}>
        {disabledCats.length>0 && <>
          <div style={{fontSize:12,fontWeight:600,color:C.textMid,marginBottom:8}}>Removed from this month</div>
          <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:16}}>
            {disabledCats.map(cid=>{const c=cats.find(x=>x.id===cid);return c?<button key={cid} onClick={()=>{toggleMonthCat(cid);setShowAddCat(false);}} style={{padding:"10px 14px",fontSize:13,fontWeight:500,border:`1px solid ${C.border}`,borderRadius:8,background:C.bg,color:C.text,cursor:"pointer",textAlign:"left"}}>{c.label}</button>:null;})}
          </div>
        </>}
        <div style={{fontSize:12,fontWeight:600,color:C.textMid,marginBottom:8}}>Create new category</div>
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          <div style={{display:"flex",gap:8}}>
            <button className="btn-pop" type="button" onClick={()=>setIconPickOpen(o=>!o)} title="Choose icon" aria-expanded={iconPickOpen} style={{width:36,height:36,borderRadius:8,display:"inline-flex",alignItems:"center",justifyContent:"center",flexShrink:0,border:`1px solid ${iconPickOpen?C.sel:C.border}`,background:iconPickOpen?C.selBg:"transparent",color:C.text,cursor:"pointer",transition:"all .15s"}}>
              <Icon name={newCatIcon} size={16} strokeWidth={1.5}/>
            </button>
            <input placeholder="Category name" value={newCatName} onChange={e=>setNewCatName(e.target.value)} style={{flex:1,fontSize:13,border:`1px solid ${C.border}`,borderRadius:8,padding:"8px 12px",background:C.bg,color:C.text}}/>
            <button className="btn-fill" onClick={()=>{if(newCatName.trim()){addCat();setShowAddCat(false);setIconPickOpen(false);}}} disabled={!newCatName.trim()} style={{padding:"8px 16px",fontSize:13,fontWeight:600,border:"none",borderRadius:8,background:!newCatName.trim()?C.surface:C.teal,color:!newCatName.trim()?C.gray:C.bg,cursor:!newCatName.trim()?"not-allowed":"pointer"}}>Add</button>
          </div>
          {iconPickOpen && <CatIconPicker value={newCatIcon} onChange={v=>{setNewCatIcon(v);setIconPickOpen(false);}}/>}
        </div>
      </Modal>}
        <div role="tabpanel" id="tab-panel" aria-labelledby="tab-budget" tabIndex={0} style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(min(100%,300px),1fr))",gap:16}}>
          <Card>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
              <SectionTitle>Monthly plan</SectionTitle>
              <MonthPicker value={selMonth} onChange={setSelMonth}/>
            </div>
            <div style={{fontSize:11,color:C.gray,marginBottom:12}}>Set how much you <em>intend</em> to spend each month — log actual spending with <strong>Quick add</strong>.</div>

            {/* Housing — read-only */}
            <div style={{display:"flex",alignItems:"center",gap:10,padding:"8px 10px",background:C.surface,borderRadius:8,marginBottom:10,border:`1px solid ${C.border}`}}>
              <div style={{flex:1}}>
                <div style={{fontSize:12,fontWeight:600,color:C.text}}>Housing</div>
                <div style={{fontSize:11,color:C.gray,marginTop:1,display:"flex",alignItems:"center",gap:4}}>Fixed by housing contract <InfoTip text="Housing is set by your housing contract. Edit the rate in the Aid & Detail tab."/></div>
              </div>
              <div style={{fontWeight:700,fontSize:14,color:C.text}}>{fmt(yr.monthly.housing||0)}<span style={{fontSize:11,fontWeight:400,color:C.gray}}>/mo</span></div>
            </div>

            {cats.filter(c=>!c.locked && !disabledCats.includes(c.id)).map((cat,i)=>{
              const isAuto = cat.autoCalc===true;
              const isDisabled = disabledCats.includes(cat.id);
              const amt = isDisabled ? 0 : getMonthVal(cat.id);
              const pct = moSpend>0?Math.round(amt/moSpend*100):0;
              return (
                <div key={cat.id} draggable={!isAuto}
                  onDragStart={()=>setDragCat(cat.id)}
                  onDragEnd={()=>{setDragCat(null);setDragOverCat(null);}}
                  onDragOver={e=>{e.preventDefault();if(dragCat&&dragCat!==cat.id)setDragOverCat(cat.id);}}
                  onDrop={e=>{e.preventDefault();if(dragCat)reorderCats(dragCat,cat.id);setDragCat(null);setDragOverCat(null);}}
                  style={{display:"flex",alignItems:"center",gap:10,padding:"7px 0",borderBottom:`1px solid ${C.border}`,opacity:dragCat===cat.id?0.4:1,borderTop:dragOverCat===cat.id?`2px solid ${C.sel}`:"2px solid transparent",cursor:isAuto?"default":"grab",background:dragOverCat===cat.id?C.bgDark:"transparent"}}>
                  {!isAuto && <span style={{color:C.gray,fontSize:12,cursor:"grab",userSelect:"none"}} title="Drag to reorder">⠿</span>}
                  <CatIcon name={cat.icon||cat.id} color={CHART_COLORS[i%CHART_COLORS.length]}/>
                  <div style={{flex:1,minWidth:0}}>
                    <span style={{fontSize:13,color:C.text}}>{cat.id==="subs"?"Fixed monthly costs":cat.label}</span>
                    {cat.id==="subs" && (
                      <div style={{fontSize:11,color:C.gray,marginTop:1}}>
                        {subs.filter(s=>s.active!==false).length} active subscription{subs.filter(s=>s.active!==false).length!==1?"s":""}{" · "}
                        <button className="txt-act" onClick={()=>setShowSubscriptions(true)} style={{border:"none",background:"transparent",color:C.teal,fontSize:11,fontWeight:600,cursor:"pointer",padding:0}}>Manage</button>
                      </div>
                    )}
                  </div>
                  {isAuto
                    ? <span style={{fontSize:13,fontWeight:600,color:C.blue,minWidth:72,textAlign:"right"}}>{fmt(amt)}<span style={{fontSize:10,color:C.gray,fontWeight:400}}> auto</span></span>
                    : <input type="number" value={getMonthVal(cat.id)} onChange={e=>setMo(ay,cat.id,e.target.value)}
                        aria-label={`Monthly budget for ${cat.label}`}
                        style={{width:80,textAlign:"right",fontSize:13,border:`1px solid ${C.border}`,borderRadius:8,padding:"4px 8px",background:C.bg,color:C.text,fontWeight:600}}/>
                  }
                  <span style={{fontSize:10,color:C.gray,width:28,textAlign:"right"}}>{pct}%</span>
                  {!isAuto && <XBtn label={"Remove "+cat.label} title={"Remove for "+MONTH_NAMES[selMonth]} onClick={()=>setConfirmRemove(cat.id)} size={28}/>}
                </div>
              );
            })}

            <Divider/>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",fontSize:13,fontWeight:700}}>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <span>Total</span>
<button className="btn-pop" onClick={()=>setShowAddCat(true)} style={{padding:"3px 10px",borderRadius:8,border:`1px solid ${C.border}`,background:"transparent",cursor:"pointer",fontSize:11,color:C.gray,fontWeight:500,display:"flex",alignItems:"center",gap:4}}>
                  <span style={{fontSize:13,lineHeight:1}}>+</span> Add category
                </button>
              </div>
              <span style={{color:moSpend>moSpendable?C.neg:C.text}}>{fmt(moSpend)}/mo</span>
            </div>
            {unbudgetedCats.length>0 && <div style={{marginTop:16,paddingTop:14,borderTop:`2px dashed ${C.border}`}}>
              <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:4}}>
                <span style={{fontSize:12,fontWeight:700,color:C.amber}}>Unbudgeted spending</span>
                <InfoTip text={"Spending logged in "+MONTH_FULL[selMonth]+" for categories not in your plan. These show actual amounts spent. Add one to your budget to start planning for it."}/>
              </div>
              {unbudgetedCats.map((cat,i)=>{
                const spent=spentInMonth(cat.id,selMonth);
                return (
                  <div key={cat.id} style={{display:"flex",alignItems:"center",gap:10,padding:"7px 0",borderBottom:`1px solid ${C.border}`}}>
                    <div style={{width:6,height:6,borderRadius:99,background:C.amber,flexShrink:0}}/>
                    <span style={{flex:1,fontSize:13,color:C.text}}>{cat.label}</span>
                    <span style={{fontSize:13,fontWeight:600,color:C.amber,minWidth:64,textAlign:"right"}}>{fmt(spent)}<span style={{fontSize:10,color:C.gray,fontWeight:400}}> spent</span></span>
                    <button className="btn-fill" onClick={()=>promoteToBudget(cat.id)} style={{padding:"3px 10px",fontSize:11,fontWeight:600,border:`1px solid ${C.amberMid}`,borderRadius:8,background:C.amberLight,color:C.amber,cursor:"pointer",whiteSpace:"nowrap"}}>Add to budget</button>
                  </div>
                );
              })}
              <div style={{display:"flex",justifyContent:"space-between",fontSize:12,fontWeight:600,marginTop:8,color:C.amber}}>
                <span>Unbudgeted total</span><span>{fmt(unbudgetedTotal)}/mo</span>
              </div>
            </div>}
          </Card>

          <div style={{display:"flex",flexDirection:"column",gap:14}}>
            <Card>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:2}}>
                <SectionTitle>Cash flow</SectionTitle>
                <span style={{display:"inline-flex",alignItems:"center",gap:5,fontSize:10,color:C.gray}}><Icon name="live" size={11} color={C.green} style={{animation:"marroPulse 2s infinite"}}/>Live</span>
              </div>
              
              {[
                {l:"Total aid disbursed to you", v:fmt(annDisburse)+"/yr",    c:C.teal},
                {l:"Other income",              v:fmt(annOther)+"/yr",       c:C.text},
                {l:"Monthly spendable",         v:fmt(moSpendable)+"/mo",    c:C.teal,bold:true},
                {l:"Monthly plan",              v:fmt(moSpend)+"/mo",        c:C.text},
                {l:"Monthly surplus",           v:fmtS(moSurplus)+"/mo",     c:moSurplus>=0?C.green:C.neg,bold:true},
              ].map(r=>(
                <div key={r.l} style={{display:"flex",justifyContent:"space-between",padding:"5px 0",borderBottom:`1px solid ${C.border}`,fontSize:12}}>
                  <span style={{color:C.gray}}>{r.l}</span>
                  <span style={{fontWeight:r.bold?700:500,color:r.c}}>{r.v}</span>
                </div>
              ))}
              <div style={{display:"flex",justifyContent:"space-between",padding:"8px 0 2px",fontSize:13,fontWeight:700}}>
                <span>Planned surplus <span style={{fontSize:10,color:C.gray,fontWeight:400}}>if you stay on budget · through {MONTH_FULL[selMonth]}</span></span>
                <span style={{color:runningBalance>=0?C.teal:C.neg}}>{fmtS(runningBalance)}</span>
              </div>
              {moSurplus!==0 && (
                <div style={{marginTop:8,padding:"10px 12px",background:moSurplus>=0?C.greenLight:C.negLight,borderRadius:8,fontSize:12,color:moSurplus>=0?C.green:C.neg,fontWeight:500}}>
                  {moSurplus>=0
                    ? `${fmt(moSurplus)} surplus this month — it carries into your running balance and adds to your year-end net.`
                    : `${fmt(Math.abs(moSurplus))} over budget this month — this draws down your running balance and lowers your year-end net.`}
                </div>
              )}
            </Card>

            {/* Plan vs actual — Phase 1's one chart, ported from the hidden Charts tab */}
            <Card>
              <SectionTitle>Plan vs actual</SectionTitle>
              <div style={{display:"flex",gap:20,marginBottom:10}}>
                {[["Budgeted",C.teal],["Actual",C.neg]].map(([l,c])=>(
                  <div key={l} style={{display:"flex",alignItems:"center",gap:6,fontSize:12,color:C.gray}}>
                    <div style={{width:10,height:10,borderRadius:3,background:c}}/>{l}
                  </div>
                ))}
              </div>
              {budgetVsActual.length===0
                ? <div style={{textAlign:"center",padding:"28px 16px",fontSize:12,color:C.textMid,border:`1px dashed ${C.borderDark}`,borderRadius:12,background:C.surface}}>No spending logged yet — use <strong>Quick add</strong> to log an expense and it&apos;ll show up here.</div>
                : <ResponsiveContainer width="100%" height={200}>
                <BarChart data={budgetVsActual} barGap={3} barCategoryGap="32%" onMouseMove={barMove} onMouseLeave={()=>setBarHover(null)}>
                  <XAxis dataKey="name" tick={{fontSize:11,fill:C.gray}} axisLine={false} tickLine={false}/>
                  <YAxis tick={{fontSize:11,fill:C.gray}} tickFormatter={v=>"$"+v} axisLine={false} tickLine={false} width={44}/>
                  <Tooltip separator=": " formatter={v=>fmt(v)} {...tipProps()} cursor={false}/>
                  <Bar dataKey="Budgeted" fill={C.teal} radius={[6,6,0,0]} maxBarSize={26}>
                    {budgetVsActual.map((d,i)=><Cell key={i} fill={C.teal} opacity={0.85*barDim(i)} style={{transition:"opacity 150ms ease"}}/>)}
                  </Bar>
                  <Bar dataKey="Actual" fill={C.neg} radius={[6,6,0,0]} maxBarSize={26}>
                    {budgetVsActual.map((d,i)=><Cell key={i} fill={C.neg} opacity={barDim(i)} style={{transition:"opacity 150ms ease"}}/>)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>}
            </Card>

            <Card>
              <SectionTitle>Health checks</SectionTitle>
              {[
                ["Housing ratio",    moSpendable>0?Math.round((yr.monthly.housing||0)/moSpendable*100)+"%":"—", (yr.monthly.housing||0)/moSpendable<0.6,(yr.monthly.housing||0)/moSpendable<0.75,"Target <60% of spendable"],
                ["Monthly balance",  moSurplus>=0?"Positive":"Negative", moSurplus>=0, false, ""],
                ["Savings",          (yr.monthly.savings||0)>0?fmt(yr.monthly.savings||0)+"/mo":"None", (yr.monthly.savings||0)>0, false, "Even $50/mo adds up"],
                ["Exam fund",        (yr.monthly.exams||0)>0?fmt(yr.monthly.exams||0)+"/mo":"$0/mo", ay<=1||(yr.monthly.exams||0)>0, ay>1, `Steps cost ~${fmt(USMLE_STEP_FEE_ESTIMATE)} each`],
              ].map(([label,val,ok,warn,tip])=>(
                <div key={label} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"6px 0",borderBottom:`1px solid ${C.border}`,fontSize:12}}>
                  <span style={{color:C.gray}}>{label}</span>
                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                    <Pill ok={ok} warn={!ok&&warn}>{val}</Pill>
                    {tip && <span style={{fontSize:10,color:C.gray}}>{tip}</span>}
                  </div>
                </div>
              ))}
            </Card>

            <Card>
              <SectionTitle sub="if you stay on budget">Planned surplus</SectionTitle>
              <div style={{fontSize:26,fontWeight:700,color:totalAccumulatedBalance>=0?C.teal:C.neg,margin:"6px 0",fontFamily:"'Newsreader',Georgia,serif"}}>{fmtS(totalAccumulatedBalance)}</div>
              <div style={{fontSize:11,color:C.gray,lineHeight:1.6}}>
                {priorYearsCarryover!==0
                  ? <>Prior years: <strong style={{color:priorYearsCarryover>=0?C.teal:C.neg}}>{fmtS(priorYearsCarryover)}</strong> · This year so far: <strong style={{color:runningBalance>=0?C.teal:C.neg}}>{fmtS(runningBalance)}</strong></>
                  : <>Cumulative surplus/deficit from {MONTH_FULL[0]} through {MONTH_FULL[selMonth]}, if you stay on budget.</>
                }
              </div>
              {totalAccumulatedBalance>moSpendable*2 && <div style={{marginTop:8,padding:"6px 10px",background:C.greenLight,borderRadius:8,fontSize:11,color:C.green}}>You&apos;re building a healthy cushion. Consider moving some into a high-yield savings account.</div>}
              {totalAccumulatedBalance<0 && <div style={{marginTop:8,padding:"6px 10px",background:C.negLight,borderRadius:8,fontSize:11,color:C.neg}}>You&apos;re running a cumulative deficit. Review spending or adjust your budget.</div>}
            </Card>

            <Card>
              <SectionTitle>Notes</SectionTitle>
              <textarea value={yr.notes||""} onChange={e=>setYrF(ay,"notes",e.target.value)} placeholder="Reminders, upcoming costs..."
                style={{width:"100%",fontSize:12,border:`1px solid ${C.border}`,borderRadius:8,padding:"8px 10px",resize:"vertical",minHeight:64,fontFamily:"inherit",color:C.text,background:C.bg,boxSizing:"border-box"}}/>
            </Card>
          </div>
        </div>
    </>
  );
}
