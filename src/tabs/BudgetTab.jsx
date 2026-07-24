import { useRef, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { C, CHART_COLORS, tipProps } from '../lib/theme.js';
import { fmt, fmtS, MONTH_NAMES, MONTH_FULL, sanitizeMoneyInput, cleanNumEvent } from '../lib/format.js';
import { USMLE_STEP_FEE_ESTIMATE } from '../lib/constants.js';
import { Card, SectionTitle, Divider, InfoTip, Pill, XBtn, Modal } from '../components/primitives.jsx';
import { Icon, CatIcon, CatIconPicker, ChangeIconButton } from '../components/icons.jsx';
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
          priorYearsCarryover, annDisburse, annOther, aidBreakdown, allEntriesFlat,
          getMonthVal, spentInMonth, unbudgetedCats, unbudgetedTotal, promoteToBudget,
          toggleMonthCat, setMo, reorderCats, addCat,
          newCatName, setNewCatName, newCatIcon, setNewCatIcon, iconPickOpen, setIconPickOpen } = useApp();
  // True when this year's spending money is mostly borrowed — gates every
  // "nice surplus!" affirmation below. See yearAidBreakdown in src/lib/aid.js.
  const surplusBorrowed = !!aidBreakdown?.isLoanFunded;
  // Category reorder is pointer-driven rather than HTML5 drag-and-drop: native
  // DnD can only use the dragged ELEMENT as its drag image, which meant the grip
  // button (all the `draggable` attribute could sit on) was the only thing that
  // appeared to lift. Tracking pointer deltas ourselves lets the whole row move
  // and the other rows slide out of the way, instead of a static drop-line.
  const [drag, setDrag] = useState(null);
  const dragRef = useRef(null);
  const rowRefs = useRef(new Map());
  const reduceMotion = typeof window!=="undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const [showAddCat, setShowAddCat] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(null);
  const [showSubscriptions, setShowSubscriptions] = useState(false);
  const [showHealthChecks, setShowHealthChecks] = useState(false);
  const [barHover, setBarHover] = useState(null);
  const barDim = i => barHover!=null && barHover!==i ? 0.35 : 1;
  const barMove = s => setBarHover(s && s.isTooltipActive && s.activeTooltipIndex!=null ? s.activeTooltipIndex : null);
  // Visible, reorderable categories for this month — shared by the plan list
  // and its drag/keyboard reorder logic (both mouse-drag drop targets and
  // ArrowUp/ArrowDown need the same ordered, filtered list).
  const reorderableCats = cats.filter(c=>!c.locked && !disabledCats.includes(c.id));

  // Where the dragged row would land, given how far it's travelled: walk outward
  // from its original slot, crossing a neighbour once we've passed that
  // neighbour's midpoint. Row heights vary (the subscriptions row carries a
  // subtitle), so they're measured at drag start rather than assumed uniform.
  const targetIndexFor = (fromIdx, dy, heights) => {
    let idx = fromIdx, acc = 0;
    if (dy > 0) {
      for (let i = fromIdx + 1; i < heights.length; i++) {
        acc += heights[i];
        if (dy > acc - heights[i] / 2) idx = i; else break;
      }
    } else if (dy < 0) {
      for (let i = fromIdx - 1; i >= 0; i--) {
        acc += heights[i];
        if (-dy > acc - heights[i] / 2) idx = i; else break;
      }
    }
    return idx;
  };

  // How far a NON-dragged row slides to open the gap. Only rows between the
  // dragged row's origin and its current target move, each by exactly the
  // dragged row's height, so the list reads as one continuous shift.
  const rowShift = (i) => {
    if (!drag || i === drag.fromIdx) return 0;
    const { fromIdx, toIdx, heights } = drag;
    if (fromIdx < toIdx && i > fromIdx && i <= toIdx) return -heights[fromIdx];
    if (fromIdx > toIdx && i >= toIdx && i < fromIdx) return heights[fromIdx];
    return 0;
  };

  const startDrag = (e, cat, idx) => {
    if (e.button != null && e.button !== 0) return;
    const heights = reorderableCats.map(c => rowRefs.current.get(c.id)?.offsetHeight || 0);
    const st = { id: cat.id, fromIdx: idx, toIdx: idx, dy: 0, startY: e.clientY, heights };
    dragRef.current = st;
    setDrag(st);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const moveDrag = (e) => {
    const st = dragRef.current;
    if (!st) return;
    const dy = e.clientY - st.startY;
    const next = { ...st, dy, toIdx: targetIndexFor(st.fromIdx, dy, st.heights) };
    dragRef.current = next;
    setDrag(next);
  };

  const endDrag = () => {
    const st = dragRef.current;
    if (!st) return;
    dragRef.current = null;
    setDrag(null);
    const target = reorderableCats[st.toIdx];
    if (target && st.toIdx !== st.fromIdx) reorderCats(st.id, target.id);
  };

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
            {/* Icon picker: the bordered plate reads as a button; a scrim + pencil
                surfaces the "change icon" affordance on hover/focus. */}
            <ChangeIconButton onClick={()=>setIconPickOpen(o=>!o)} ariaLabel="Change category icon" expanded={iconPickOpen}>
              <Icon name={newCatIcon} size={18} strokeWidth={1.5}/>
            </ChangeIconButton>
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
              <MonthPicker value={selMonth} onChange={setSelMonth} startYear={yrStartYear}/>
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

            {reorderableCats.map((cat,i)=>{
              const isAuto = cat.autoCalc===true;
              const isDragging = drag?.id===cat.id;
              const isDisabled = disabledCats.includes(cat.id);
              const amt = isDisabled ? 0 : getMonthVal(cat.id);
              const pct = moSpend>0?Math.round(amt/moSpend*100):0;
              const moveCat = dir => {
                const idx = reorderableCats.findIndex(c=>c.id===cat.id);
                const target = reorderableCats[idx+dir];
                if(target) reorderCats(cat.id, target.id);
              };
              return (
                <div key={cat.id}
                  ref={el=>{if(el)rowRefs.current.set(cat.id,el);else rowRefs.current.delete(cat.id);}}
                  style={{display:"flex",alignItems:"center",gap:10,padding:"7px 0",borderBottom:`1px solid ${C.border}`,
                    position:"relative",background:C.bg,
                    // The dragged row rides the pointer and lifts above the list;
                    // every other row slides to open the gap. Transitions are
                    // suppressed on the dragged row (it must track the pointer
                    // exactly, with no lag) and honor Reduce Motion elsewhere.
                    transform:isDragging?`translateY(${drag.dy}px) scale(1.02)`:`translateY(${rowShift(i)}px)`,
                    transition:isDragging||reduceMotion?"none":"transform .18s cubic-bezier(.2,.8,.2,1)",
                    zIndex:isDragging?20:1,
                    boxShadow:isDragging?"0 8px 24px rgba(0,0,0,0.28)":"none",
                    borderRadius:isDragging?10:0,
                    cursor:isDragging?"grabbing":undefined}}>
                  {!isAuto && (
                    <button type="button" className="xbtn"
                      onPointerDown={e=>startDrag(e,cat,i)}
                      onPointerMove={moveDrag}
                      onPointerUp={endDrag}
                      onPointerCancel={endDrag}
                      onKeyDown={e=>{
                        if(e.key==="ArrowUp"){e.preventDefault();moveCat(-1);}
                        else if(e.key==="ArrowDown"){e.preventDefault();moveCat(1);}
                      }}
                      aria-label={`Reorder ${cat.label}: use arrow keys`}
                      title="Drag to reorder, or use arrow keys"
                      style={{width:24,height:24,borderRadius:6,border:"none",background:"transparent",color:C.gray,fontSize:12,cursor:isDragging?"grabbing":"grab",display:"inline-flex",alignItems:"center",justifyContent:"center",flexShrink:0,padding:0,touchAction:"none"}}>
                      <span aria-hidden="true">⠿</span>
                    </button>
                  )}
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
                    : <input type="number" min="0" value={getMonthVal(cat.id)} onChange={e=>setMo(ay,cat.id,cleanNumEvent(e))}
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
<button className="btn-pop hit-slop" onClick={()=>setShowAddCat(true)} style={{padding:"3px 10px",borderRadius:8,border:`1px solid ${C.border}`,background:"transparent",cursor:"pointer",fontSize:11,color:C.gray,fontWeight:500,display:"flex",alignItems:"center",gap:4}}>
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
              
              {/* A surplus built mostly from borrowed money is not wealth — it's
                  cash sitting at ~8% that could often be returned. So when the
                  year is loan funded, a POSITIVE surplus reads blue, never green,
                  and the label says "borrowed" — the wording has to carry it too,
                  since colour alone would fail WCAG 1.4.1. Same rule the Runway
                  tile already applies via classifyCushionSource. */}
              {[
                {l:"Aid and loans sent to you", v:fmt(annDisburse)+"/yr",    c:C.teal},
                {l:"Other income",              v:fmt(annOther)+"/yr",       c:C.text},
                {l:"Monthly spending money",    v:fmt(moSpendable)+"/mo",    c:C.teal,bold:true},
                {l:"Monthly plan",              v:fmt(moSpend)+"/mo",        c:C.text},
                {l:surplusBorrowed?"Left over (borrowed)":"Monthly surplus",
                 v:fmtS(moSurplus)+"/mo",     c:moSurplus<0?C.neg:(surplusBorrowed?C.blue:C.green),bold:true},
              ].map(r=>(
                <div key={r.l} style={{display:"flex",justifyContent:"space-between",padding:"5px 0",borderBottom:`1px solid ${C.border}`,fontSize:12}}>
                  <span style={{color:C.gray}}>{r.l}</span>
                  <span style={{fontWeight:r.bold?700:500,color:r.c}}>{r.v}</span>
                </div>
              ))}
              <div style={{display:"flex",justifyContent:"space-between",padding:"8px 0 2px",fontSize:13,fontWeight:700}}>
                <span>Projected leftover <InfoTip text="What you'd have left if you stick to your budget — not your actual bank balance."/> <span style={{fontSize:10,color:C.gray,fontWeight:400}}>if you stay on budget · through {MONTH_FULL[selMonth]}</span></span>
                <span style={{color:runningBalance>=0?C.teal:C.neg}}>{fmtS(runningBalance)}</span>
              </div>
              {moSurplus!==0 && (
                <div style={{marginTop:8,padding:"10px 12px",
                  background:moSurplus<0?C.negLight:(surplusBorrowed?C.blueLight:C.greenLight),borderRadius:8,fontSize:12,
                  color:moSurplus<0?C.neg:(surplusBorrowed?C.blue:C.green),fontWeight:500}}>
                  {moSurplus<0
                    ? `${fmt(Math.abs(moSurplus))} over budget this month — this draws down your running balance and lowers your year-end net.`
                    : surplusBorrowed
                      // Swapped, not added: the old "surplus carries into your
                      // running balance" line is actively wrong advice when the
                      // money is borrowed at ~8%.
                      ? `${fmt(moSurplus)} left over this month — but this is borrowed money. Returning what you don't need within 120 days cancels its interest.`
                      : `${fmt(moSurplus)} surplus this month — it carries into your running balance and adds to your year-end net.`}
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
              {/* The ENTIRE header row toggles, not just the chevron. Negative
                  margins cancel the Card's 18px/20px padding so the button reaches
                  the card edges; the same padding is added back inside (box-sizing:
                  border-box) so the label sits where it did — clicking anywhere on
                  the row, including the whitespace beside the chevron, toggles. */}
              <button type="button" id="health-checks-btn" onClick={()=>setShowHealthChecks(s=>!s)} aria-expanded={showHealthChecks} aria-controls="health-checks-panel"
                style={{display:"flex",alignItems:"center",justifyContent:"flex-start",gap:8,width:"auto",boxSizing:"border-box",minHeight:44,margin:"-18px -20px 0",padding:"18px 20px 6px",background:"none",border:"none",cursor:"pointer",textAlign:"left",font:"inherit"}}>
                <Icon name="chevron" size={12} style={{transform:showHealthChecks?"rotate(180deg)":"none",transition:"transform .15s",color:C.gray,flexShrink:0}}/>
                <span style={{fontSize:13,fontWeight:600,color:C.text}}>Health checks</span>
              </button>
              {/* Always mounted (aria-controls target never dangles) and animated
                  open/closed via the .collapse-panel grid-rows transition — so a
                  rotated chevron always corresponds to a visibly-open panel. */}
              <div id="health-checks-panel" role="region" aria-labelledby="health-checks-btn" className={`collapse-panel${showHealthChecks?' open':''}`}>
                <div className="collapse-inner">
                  <div style={{paddingTop:14}}>
                  {[
                    ["Housing ratio",    moSpendable>0?Math.round((yr.monthly.housing||0)/moSpendable*100)+"%":"—", (yr.monthly.housing||0)/moSpendable<0.6,(yr.monthly.housing||0)/moSpendable<0.75,"Target <60% of spending money"],
                    ["Monthly balance",  moSurplus>=0?"Positive":"Negative", moSurplus>=0, false, ""],
                    ["Savings",          (yr.monthly.savings||0)>0?fmt(yr.monthly.savings||0)+"/mo":"None", (yr.monthly.savings||0)>0, false, "Even $50/mo adds up"],
                    ["Exam fund",        (yr.monthly.exams||0)>0?fmt(yr.monthly.exams||0)+"/mo":"$0/mo", ay<=1||(yr.monthly.exams||0)>0, ay>1, `Steps cost about ${fmt(USMLE_STEP_FEE_ESTIMATE)} each`],
                  ].map(([label,val,ok,warn,tip])=>(
                    <div key={label} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"6px 0",borderBottom:`1px solid ${C.border}`,fontSize:12}}>
                      <span style={{color:C.gray}}>{label}</span>
                      <div style={{display:"flex",alignItems:"center",gap:8}}>
                        <Pill ok={ok} warn={!ok&&warn}>{val}</Pill>
                        {tip && <span style={{fontSize:10,color:C.gray}}>{tip}</span>}
                      </div>
                    </div>
                  ))}
                  </div>
                </div>
              </div>
            </Card>

            <Card>
              <SectionTitle>Projected leftover <InfoTip text="What you'd have left if you stick to your budget — not your actual bank balance."/></SectionTitle>
              <div style={{fontSize:26,fontWeight:700,color:totalAccumulatedBalance>=0?C.teal:C.neg,margin:"6px 0",fontFamily:"'Newsreader',Georgia,serif"}}>{fmtS(totalAccumulatedBalance)}</div>
              <div style={{fontSize:11,color:C.gray,lineHeight:1.6}}>
                {priorYearsCarryover!==0
                  ? <>Prior years: <strong style={{color:priorYearsCarryover>=0?C.teal:C.neg}}>{fmtS(priorYearsCarryover)}</strong> · This year so far: <strong style={{color:runningBalance>=0?C.teal:C.neg}}>{fmtS(runningBalance)}</strong></>
                  : <>Cumulative surplus/deficit from {MONTH_FULL[0]} through {MONTH_FULL[selMonth]}, if you stay on budget.</>
                }
              </div>
              {/* "Healthy cushion → move it to a HYSA" must not fire on borrowed
                  money: a savings account pays ~4% while the loan charges ~8%, so
                  parking it loses money. Returning it is the better move. */}
              {totalAccumulatedBalance>moSpendable*2 && (surplusBorrowed
                ? <div style={{marginTop:8,padding:"6px 10px",background:C.blueLight,borderRadius:8,fontSize:11,color:C.blue}}>You&apos;re holding a large cushion of borrowed money. Returning what you don&apos;t need beats saving it — a savings account pays less than your loan charges.</div>
                : <div style={{marginTop:8,padding:"6px 10px",background:C.greenLight,borderRadius:8,fontSize:11,color:C.green}}>You&apos;re building a healthy cushion. Consider moving some into a high-yield savings account.</div>
              )}
              {totalAccumulatedBalance<0 && <div style={{marginTop:8,padding:"6px 10px",background:C.negLight,borderRadius:8,fontSize:11,color:C.neg}}>You&apos;re running a cumulative deficit. Review spending or adjust your budget.</div>}
            </Card>

            {/* The free-text "Notes" block was removed from the UI (founder
                call — looked cheap, rarely used). The underlying yr.notes data
                field is left intact so existing notes still sync and nothing
                breaks; it's simply no longer rendered here. */}
          </div>
        </div>
    </>
  );
}
