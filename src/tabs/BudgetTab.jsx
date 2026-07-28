import { useEffect, useRef, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { C, CHART_COLORS, tipProps } from '../lib/theme.js';
import { fmt, fmtS, fmtDay, MONTH_NAMES, MONTH_FULL, sanitizeMoneyInput, cleanNumEvent, catColorIndex, yearMonthRange } from '../lib/format.js';
import { USMLE_STEP_FEE_ESTIMATE } from '../lib/constants.js';
import { Card, SectionTitle, Divider, InfoTip, Pill, XBtn, Modal } from '../components/primitives.jsx';
import { Icon, CatIcon, CatIconPicker, ChangeIconButton } from '../components/icons.jsx';
import { MonthPicker } from '../components/pickers.jsx';
import { SubscriptionsTab } from './SubscriptionsTab.jsx';
import { useApp } from '../context/AppContext.js';
import { targetIndexFor, rowShift } from '../lib/reorder.js';

// Budget — the monthly plan (per-category budgets for the selected month), cash
// flow, health checks, running balance, and notes, plus the add-category and
// remove-category modals (previously hoisted to App). Private state: category
// drag-reorder + the two modal toggles. selMonth is shared (it also drives the
// header metrics) and the add-category form fields (newCat*) are shared with the
// Categories tab — both come from useApp().
export function BudgetTab(){
  const { data, cats, ay, yr, yrStartYear, selMonth, setSelMonth, subs, subsMo, disabledCats,
          moSpend, moSpendable, moSurplus, runningBalance, totalAccumulatedBalance,
          priorYearsCarryover, annDisburse, annOther, aidBreakdown, safeToSpend, safeToSpendMo, planBase, runway, upd, allEntriesFlat,
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
  // True for the couple of frames right after a drop, while the reordered rows
  // paint at their final positions — see endDrag for why transitions must be off
  // during that window.
  const [settling, setSettling] = useState(false);
  const dragRef = useRef(null);
  const rowRefs = useRef(new Map());
  const reduceMotion = typeof window!=="undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const [showAddCat, setShowAddCat] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(null);
  const [showSubscriptions, setShowSubscriptions] = useState(false);
  const [showHealthChecks, setShowHealthChecks] = useState(false);
  const [confirmLean, setConfirmLean] = useState(null);
  // What the cash on hand supports until the next payment lands (src/lib/aid.js).
  const untilNext = safeToSpend?.untilNextMoney || null;

  // ── Budgeting through a dry spell ──────────────────────────────────────────
  // The months between now and the next payment. Scaling these to `untilNext`
  // is what turns the warning into a fix, so the student isn't just told they
  // have a problem in November.
  const monthIdxOf = (iso) => { const d = new Date(iso+"T12:00:00"); return Number.isNaN(d.getTime()) ? null : (d.getMonth()-7+12)%12; };
  const leanMonths = (() => {
    const out = new Set();
    for (const s of runway?.shortfalls || []) {
      // Only THIS year's dry spells. computeRunway projects across every year
      // through graduation, so without this a shortfall two years out would mark
      // months in the plan you're editing now — and the one-tap fix would write
      // overrides for months that aren't even in that stretch.
      if (yr?.startDate && s.date < yr.startDate) continue;
      if (yr?.endDate && s.date > yr.endDate) continue;
      const from = monthIdxOf(s.date), to = monthIdxOf(s.nextInflowDate);
      if (from == null || to == null) continue;
      // Academic months wrap (Aug=0 … Jul=11), so walk forward with modulo
      // rather than assuming from <= to. Bounded at 12 so a bad pair can't spin.
      for (let i = from, n = 0; n < 12; i = (i+1)%12, n++) { out.add(i); if (i === to) break; }
    }
    return out;
  })();
  // Scale the DISCRETIONARY categories to hit the target. Housing is locked by
  // a contract and Fixed monthly costs is a derived total — neither is
  // something a student can decide to spend less on, so neither is touched.
  const buildLeanPlan = (target) => {
    const flexible = cats.filter(c => !c.locked && !c.autoCalc);
    const fixedTotal = cats.filter(c => c.locked).reduce((a,c)=>a+(Number(yr.monthly[c.id])||0),0) + subsMo;
    const flexTotal = flexible.reduce((a,c)=>a+(Number(yr.monthly[c.id])||0),0);
    const room = target - fixedTotal;
    if (flexTotal <= 0) return null;
    const factor = room / flexTotal;
    // `possible` is false when rent and fixed costs ALONE already exceed the
    // target — no amount of trimming groceries closes that, and applying the
    // scale would zero out every discretionary category. Offering a "fix" that
    // wipes the plan and still doesn't work is worse than offering none, so the
    // action is withheld and the tooltip explains instead.
    // factor >= 1 means the plan already fits; nothing to do either.
    return { flexible, factor, fixedTotal, flexTotal, newFlexTotal: flexTotal*Math.max(0,factor), target,
             possible: room > 0 && factor < 1 };
  };
  const leanPlan = untilNext ? buildLeanPlan(untilNext.perMonth) : null;
  const applyLeanPlan = (plan, months) => {
    const d = JSON.parse(JSON.stringify(data));
    const y = d.years.find(x=>x.id===ay) || d.years[0];
    y.monthlyOverrides = y.monthlyOverrides || {};
    for (const mi of months) {
      const mk = MONTH_NAMES[mi];
      y.monthlyOverrides[mk] = { ...(y.monthlyOverrides[mk]||{}) };
      for (const c of plan.flexible) {
        y.monthlyOverrides[mk][c.id] = Math.round((Number(y.monthly[c.id])||0) * plan.factor);
      }
    }
    upd(d);
  };
  // Month the current school year ends in — labels the "to last through X" row.
  const yearEndMonth = yr?.endDate ? new Date(yr.endDate+"T12:00:00").toLocaleDateString("en-US",{month:"long"}) : "the year";
  const [barHover, setBarHover] = useState(null);
  const barDim = i => barHover!=null && barHover!==i ? 0.35 : 1;
  const barMove = s => setBarHover(s && s.isTooltipActive && s.activeTooltipIndex!=null ? s.activeTooltipIndex : null);
  // Visible, reorderable categories for this month — shared by the plan list
  // and its drag/keyboard reorder logic (both mouse-drag drop targets and
  // ArrowUp/ArrowDown need the same ordered, filtered list).
  // Rows that can actually be dragged. `autoCalc` categories (Fixed monthly
  // costs) are excluded on purpose: they're a derived total, not a budget line
  // you set, so they're pinned to the bottom of the list. Leaving them in here
  // was enough to break that — they had no grip so they couldn't be PICKED UP,
  // but they still occupied a slot, so other rows could be dropped BELOW them.
  const reorderableCats = cats.filter(c=>!c.locked && !c.autoCalc && !disabledCats.includes(c.id));
  const pinnedCats = cats.filter(c=>!c.locked && c.autoCalc && !disabledCats.includes(c.id));
  // Pinned rows render last, so a reorderable row's display index still equals
  // its index in `reorderableCats` — which is what all the drag math indexes by.
  const displayCats = [...reorderableCats, ...pinnedCats];

  // Reorder geometry (target row + how far the others slide) lives in
  // src/lib/reorder.js so it can be unit-tested — it has caused two visual bugs
  // already (a spike on drop, then rubber-banding neighbours) and this file
  // can't be exercised by the test suite.
  const shiftFor = (i) => rowShift(i, drag);

  // Pointer tracking lives on WINDOW, not on the grip button. The button-plus-
  // setPointerCapture version could strand a drag: if the capture call threw on
  // a stale pointer id, or the pointerup landed on another element (easy when
  // picking rows up and dropping them quickly), `endDrag` never ran — so `drag`
  // stayed set and every row kept its offset permanently, leaving rows visibly
  // overlapping and one stranded at the bottom of the card. Window listeners
  // can't miss the release, and the effect's cleanup is a second guarantee.
  // Window listeners are attached SYNCHRONOUSLY in startDrag, not from an
  // effect. An effect only runs after React re-renders, so a fast press-and-
  // release fired before the listeners existed and nothing caught the release —
  // the drag was stranded and every row kept its offset. They call through a ref
  // so the handlers are always the current render's (never a stale `reorderCats`).
  const handlersRef = useRef({});
  const listenersRef = useRef(null);
  const attachDragListeners = () => {
    if (listenersRef.current) return;
    const onMove = (e) => handlersRef.current.moveDrag(e);
    const onEnd = () => handlersRef.current.endDrag();
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onEnd);
    window.addEventListener('pointercancel', onEnd);
    listenersRef.current = { onMove, onEnd };
  };
  const detachDragListeners = () => {
    const l = listenersRef.current;
    if (!l) return;
    window.removeEventListener('pointermove', l.onMove);
    window.removeEventListener('pointerup', l.onEnd);
    window.removeEventListener('pointercancel', l.onEnd);
    listenersRef.current = null;
  };

  const startDrag = (e, cat, idx) => {
    if (e.button != null && e.button !== 0) return;
    if (dragRef.current) return;                       // ignore a second press mid-drag
    const heights = reorderableCats.map(c => rowRefs.current.get(c.id)?.offsetHeight || 0);
    // Snapshot the id order too, so endDrag never has to read a `reorderableCats`
    // that may have been re-derived since the drag began.
    const order = reorderableCats.map(c => c.id);
    const st = { id: cat.id, fromIdx: idx, toIdx: idx, dy: 0, startY: e.clientY, heights, order };
    dragRef.current = st;
    attachDragListeners();
    setDrag(st);
  };

  const moveDrag = (e) => {
    const st = dragRef.current;
    if (!st) return;
    const dy = e.clientY - st.startY;
    const next = { ...st, dy, toIdx: targetIndexFor(st.fromIdx, dy, st.heights, st.toIdx) };
    dragRef.current = next;
    setDrag(next);
  };

  const endDrag = () => {
    const st = dragRef.current;
    if (!st) return;
    dragRef.current = null;
    detachDragListeners();
    const targetId = st.order[st.toIdx];
    // On release two things land in the same frame: the list REORDERS (so the
    // row is already at its new slot in the DOM) and every transform resets to
    // 0. With transitions live, the row animates from its dragged offset on top
    // of a position it has already moved to — it travels twice and reads as a
    // spike. `settling` kills transitions for the frames where that reset
    // paints, so rows simply land where they belong; normal sliding resumes
    // straight after. Two rAFs because the first only guarantees the style is
    // committed, not that the browser has painted it.
    setSettling(true);
    setDrag(null);
    if (targetId && st.toIdx !== st.fromIdx) reorderCats(st.id, targetId);
    // rAF is throttled to zero in a backgrounded tab, which would leave
    // `settling` stuck on and silently disable the slide animation for the rest
    // of the session — so a timer backstops it.
    let done = false;
    const clear = () => { if (!done) { done = true; setSettling(false); } };
    requestAnimationFrame(() => requestAnimationFrame(clear));
    setTimeout(clear, 120);
  };

  // Point the window listeners at THIS render's handlers. Must sit below their
  // declarations (they're `const` — reading them earlier hits the temporal dead
  // zone and crashes the tab on first paint).
  handlersRef.current = { moveDrag, endDrag };

  // Last-resort safety: if this tab unmounts mid-drag (tab switch, navigation),
  // drop the listeners and the half-finished drag rather than leaving both behind.
  useEffect(() => () => {
    detachDragListeners();
    dragRef.current = null;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      {/* Overwrites budget numbers the student typed, across several months —
          never fires straight off the tap. Shows exactly which months change
          and the before → after, so it's a decision rather than a surprise. */}
      {confirmLean && <Modal title="Use this for the lean months" onClose={()=>setConfirmLean(null)} width={380}>
        <div style={{fontSize:13,color:C.textMid,marginBottom:12,lineHeight:1.6}}>
          Sets your plan to about <strong style={{color:C.text}}>{fmt(confirmLean.target)}/mo</strong> for{" "}
          <strong style={{color:C.text}}>{[...leanMonths].sort((a,b)=>a-b).map(mi=>MONTH_FULL[mi]).join(", ")}</strong>,
          the months before your next payment.
        </div>
        <div style={{fontSize:12,color:C.gray,marginBottom:16,lineHeight:1.6}}>
          Housing and fixed monthly costs stay as they are ({fmt(confirmLean.fixedTotal)}/mo), since those aren&apos;t yours to change.
          Everything else scales from {fmt(confirmLean.flexTotal)} to about {fmt(confirmLean.newFlexTotal)}/mo.
        </div>
        <div style={{display:"flex",gap:8}}>
          <button className="btn-pop" onClick={()=>setConfirmLean(null)} style={{flex:1,padding:"10px",fontSize:13,fontWeight:500,border:`1px solid ${C.border}`,borderRadius:8,background:"transparent",color:C.gray,cursor:"pointer"}}>Cancel</button>
          <button className="btn-fill" onClick={()=>{applyLeanPlan(confirmLean,[...leanMonths]);setConfirmLean(null);}} style={{flex:1,padding:"10px",fontSize:13,fontWeight:600,border:"none",borderRadius:8,background:C.teal,color:C.bg,cursor:"pointer"}}>Use it</button>
        </div>
      </Modal>}
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
              <MonthPicker value={selMonth} onChange={setSelMonth} startYear={yrStartYear} range={yearMonthRange(yr)} leanMonths={leanMonths}/>
            </div>
            <div style={{fontSize:11,color:C.gray,marginBottom:12}}>Set how much you <em>intend</em> to spend each month. Log what you actually spend with <strong>Quick add</strong>.</div>

            {/* Housing — read-only */}
            <div style={{display:"flex",alignItems:"center",gap:10,padding:"8px 10px",background:C.surface,borderRadius:8,marginBottom:10,border:`1px solid ${C.border}`}}>
              <div style={{flex:1}}>
                <div style={{fontSize:12,fontWeight:600,color:C.text}}>Housing</div>
                <div style={{fontSize:11,color:C.gray,marginTop:1,display:"flex",alignItems:"center",gap:4}}>Fixed by housing contract <InfoTip text="Housing is set by your housing contract. Edit the rate in the Aid & Detail tab."/></div>
              </div>
              <div style={{fontWeight:700,fontSize:14,color:C.text}}>{fmt(yr.monthly.housing||0)}<span style={{fontSize:11,fontWeight:400,color:C.gray}}>/mo</span></div>
            </div>

            {displayCats.map((cat,i)=>{
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
                    position:"relative",
                    // Resting rows stay TRANSPARENT so the card's glass material
                    // shows through. (Painting every row solid flattened the list
                    // to black — the "lost the glass look" regression.) The dragged
                    // row still has to hide the rows it slides over, but filling it
                    // with the PAGE background made it a flat black slab sitting on
                    // the glass card. A blurred elevated surface occludes just as
                    // well and reads as a lifted row, matching the material the
                    // rest of the app uses.
                    background:isDragging?C.surfaceMid:"transparent",
                    backdropFilter:isDragging?"blur(24px) saturate(160%)":undefined,
                    WebkitBackdropFilter:isDragging?"blur(24px) saturate(160%)":undefined,
                    // The dragged row rides the pointer and lifts above the list;
                    // every other row slides to open the gap. Transitions are
                    // suppressed on the dragged row (it must track the pointer
                    // exactly, with no lag) and honor Reduce Motion elsewhere.
                    transform:isDragging?`translateY(${drag.dy}px) scale(1.02)`:`translateY(${shiftFor(i)}px)`,
                    transition:isDragging||reduceMotion||settling?"none":"transform .18s cubic-bezier(.2,.8,.2,1)",
                    zIndex:isDragging?20:1,
                    boxShadow:isDragging?"0 8px 24px rgba(0,0,0,0.28)":"none",
                    borderRadius:isDragging?10:0,
                    cursor:isDragging?"grabbing":undefined}}>
                  {/* Only the PRESS is handled on the grip — move/release are
                      tracked on window for the life of the drag (see the effect
                      above), so a release outside it can't strand the drag. */}
                  {!isAuto && (
                    <button type="button" className="xbtn"
                      onPointerDown={e=>startDrag(e,cat,i)}
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
                  <CatIcon name={cat.icon||cat.id} color={CHART_COLORS[catColorIndex(cat.id,cats)%CHART_COLORS.length]}/>
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
                {l:"Aid and loans sent to you", v:fmt(annDisburse)+"/yr",    c:C.teal,
                 tip:"What's left of your grants and loans after tuition, fees, and health insurance come out — the money that actually reaches your account for living costs."},
                ...(annOther>0 ? [{l:"Other income", v:fmt(annOther)+"/yr", c:C.text}] : []),
                // The one "how much can I spend" number (src/lib/aid.js →
                // availableMoney). Balance-anchored once a check-in exists, so it
                // MOVES as the balance moves — which is exactly why it needs the
                // disclosure below it: a number that changes on its own reads as
                // arbitrary without the arithmetic behind it.
                // In the final month a "/mo" rate is misleading — it reads as a
                // sustainable monthly pace when it's really the whole remaining
                // balance for a few weeks. Say what it actually is instead.
                {id:"safe",
                 l:safeToSpend.monthsLeft<=1 && safeToSpend.basis==="balance" ? "Left for the rest of the year" : "Safe to spend",
                 v:safeToSpend.monthsLeft<=1 && safeToSpend.basis==="balance" ? fmt(safeToSpend.available) : fmt(safeToSpendMo)+"/mo",
                 c:C.teal,bold:true,
                 tip: safeToSpend.basis==="balance"
                   ? `You have ${fmt(safeToSpend.onHand)} in your accounts and ${fmt(safeToSpend.stillToArrive)} still coming, which is ${fmt(safeToSpend.available)} to cover ${safeToSpend.monthsLeft} month${safeToSpend.monthsLeft===1?"":"s"} until your school year ends. Update your balance on the Loans tab to keep this accurate.`
                   : "This is your full year's aid and loans spread over 12 months. Add your current balance on the Loans tab and Marro will use what you actually have instead."},
                // "Safe to spend" averages the whole year, which is what CREATES a
                // dry spell — aid lands in lumps, so spending the average can leave
                // you at $0 waiting on the next payment. This is the figure that
                // prevents it: what the cash actually in your account supports
                // between now and that payment. Only shown when it's tighter than
                // the average, i.e. when there's genuinely something to watch.
                ...(untilNext && untilNext.perMonth < safeToSpendMo ? [{
                  id:"untilnext", l:"Until your next money", v:fmt(untilNext.perMonth)+"/mo", c:C.amber,
                  tip:`What's in your account now, spread over the ${untilNext.monthsToNext} month${untilNext.monthsToNext===1?"":"s"} until your next payment${untilNext.isEstimate?" (that date is an estimate — confirm it with your aid office)":""} on ${fmtDay(untilNext.date)}. Spending at the year average instead would run you dry before then.${leanMonths.size>0 && leanPlan && !leanPlan.possible ? " Your rent and fixed costs alone come to " + fmt(leanPlan.fixedTotal) + "/mo, which is already more than this — trimming day-to-day spending can\u2019t close that on its own." : ""}`,
                  action: (leanMonths.size>0 && leanPlan?.possible) ? "lean" : null,
                }] : []),
                {id:"plan", l:"Monthly plan", v:`${fmt(moSpend)} of ${fmt(planBase)}`, c:C.text},
                {l:surplusBorrowed?"Left over (borrowed)":"Monthly surplus",
                 v:fmtS(moSurplus)+"/mo",     c:moSurplus<0?C.neg:(surplusBorrowed?C.blue:C.green),bold:true},
              ].map(r=>(
                <div key={r.id||r.l}>
                  <div style={{display:"flex",justifyContent:"space-between",padding:"5px 0",borderBottom:r.id==="safe"?"none":`1px solid ${C.border}`,fontSize:12}}>
                    <span style={{color:C.gray,display:"inline-flex",alignItems:"center",gap:4,flexWrap:"wrap"}}>
                      {r.l}{r.tip && <InfoTip text={r.tip} />}
                      {r.action==="lean" && (
                        <button type="button" className="txt-act" onClick={()=>setConfirmLean(leanPlan)}
                          style={{border:"none",background:"transparent",color:C.teal,fontSize:11,fontWeight:600,cursor:"pointer",padding:0}}>
                          use for the lean months
                        </button>
                      )}
                    </span>
                    <span style={{fontWeight:r.bold?700:500,color:r.c}}>{r.v}</span>
                  </div>
                  {/* How much of what you can spend this plan uses. The number
                      alone did not answer "is that a lot?", so the bar gives it
                      a scale. Turns amber once the plan exceeds what is safe. */}
                  {r.id==="plan" && planBase>0 && (
                    <div style={{padding:"0 0 6px"}}>
                      <div style={{height:4,borderRadius:99,background:C.surface,overflow:"hidden"}}>
                        <div style={{height:"100%",width:`${Math.min(100,(moSpend/planBase)*100)}%`,borderRadius:99,background:moSpend>planBase?C.neg:C.teal,transition:"width .2s"}}/>
                      </div>
                    </div>
                  )}
                </div>
              ))}
              <div style={{display:"flex",justifyContent:"space-between",padding:"8px 0 2px",fontSize:13,fontWeight:700}}>
                <span>Projected leftover <InfoTip text={`This is what you'd have left by the end of ${MONTH_FULL[selMonth]} if you stick to your monthly plan. It's a forecast from your plan, not the balance in your bank account.`}/> <span style={{fontSize:10,color:C.gray,fontWeight:400}}>through {MONTH_FULL[selMonth]}</span></span>
                <span style={{color:runningBalance>=0?C.teal:C.neg}}>{fmtS(runningBalance)}</span>
              </div>
              {/* Moved here when the duplicate "Projected leftover" card was
                  removed. The cushion nudge must never fire on borrowed money: a
                  savings account pays about 4% while the loan charges about 8%,
                  so parking it loses money. Returning it is the better move. */}
              {totalAccumulatedBalance>moSpendable*2 && (surplusBorrowed
                ? <div style={{marginTop:8,padding:"6px 10px",background:C.blueLight,borderRadius:8,fontSize:11,color:C.blue}}>You&apos;re holding a large cushion of borrowed money. Returning what you don&apos;t need beats saving it, because a savings account pays less than your loan charges.</div>
                : <div style={{marginTop:8,padding:"6px 10px",background:C.greenLight,borderRadius:8,fontSize:11,color:C.green}}>You&apos;re building a healthy cushion. Consider moving some into a high-yield savings account.</div>
              )}
              {totalAccumulatedBalance<0 && <div style={{marginTop:8,padding:"6px 10px",background:C.negLight,borderRadius:8,fontSize:11,color:C.neg}}>Your plan spends more than you have coming in. Review your largest categories or lower a few.</div>}
              {moSurplus!==0 && (
                <div style={{marginTop:8,padding:"10px 12px",
                  background:moSurplus<0?C.negLight:(surplusBorrowed?C.blueLight:C.greenLight),borderRadius:8,fontSize:12,
                  color:moSurplus<0?C.neg:(surplusBorrowed?C.blue:C.green),fontWeight:500}}>
                  {moSurplus<0
                    ? `${fmt(Math.abs(moSurplus))} over your plan this month. That comes out of your projected leftover.`
                    : surplusBorrowed
                      // Swapped, not added: the old "surplus carries into your
                      // running balance" line is actively wrong advice when the
                      // money is borrowed at ~8%.
                      ? `${fmt(moSurplus)} left over this month, but this is borrowed money. You can return what you don't need within 120 days of a loan being paid out to cancel its interest.`
                      : `${fmt(moSurplus)} left over this month. If you stick to your plan it carries forward into your projected leftover.`}
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
                ? <div style={{textAlign:"center",padding:"28px 16px",fontSize:12,color:C.textMid,border:`1px dashed ${C.borderDark}`,borderRadius:12,background:C.surface}}>No spending logged yet. Use <strong>Quick add</strong> to log an expense and it&apos;ll show up here.</div>
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
              {/* The shared .collapse-panel grid trick (0fr -> 1fr) never resolves
                  in this app, so this panel silently opened to zero height for as
                  long as it has shipped. Plain `hidden` toggle instead, same as
                  the "How is this worked out?" disclosure. */}
              <div id="health-checks-panel" role="region" aria-labelledby="health-checks-btn" hidden={!showHealthChecks}>
                <div>
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

            {/* The free-text "Notes" block was removed from the UI (founder
                call — looked cheap, rarely used). The underlying yr.notes data
                field is left intact so existing notes still sync and nothing
                breaks; it's simply no longer rendered here. */}
          </div>
        </div>
    </>
  );
}
