import { useEffect, useRef, useState } from 'react';
import { C, CHART_COLORS } from '../lib/theme.js';
import { fmt, MONTH_NAMES, MONTH_FULL, cleanNumEvent, catColorIndex, yearMonthRange } from '../lib/format.js';
import { Card, SectionTitle, Divider, InfoTip, XBtn, Modal } from '../components/primitives.jsx';
import { BalanceCheckin } from '../components/BalanceCheckin.jsx';
import { Icon, CatIcon, CatIconPicker, ChangeIconButton } from '../components/icons.jsx';
import { MonthPicker } from '../components/pickers.jsx';
import { SubscriptionsTab } from './SubscriptionsTab.jsx';
import { useApp } from '../context/AppContext.js';
import { targetIndexFor, rowShift } from '../lib/reorder.js';
import { SHOW_GAP_FORECAST } from '../lib/featureFlags.js';

// Budget — the monthly plan (per-category budgets for the selected month), cash
// flow, health checks, running balance, and notes, plus the add-category and
// remove-category modals (previously hoisted to App). Private state: category
// drag-reorder + the two modal toggles. selMonth is shared (it also drives the
// header metrics) and the add-category form fields (newCat*) are shared with the
// Categories tab — both come from useApp().
export function BudgetTab(){
  const { data, cats, ay, yr, yrStartYear, selMonth, setSelMonth, subs, disabledCats,
          moSpend, moSpendable, moSurplus,
          aidBreakdown, runway, upd,
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
  // ── Budgeting through a dry spell ──────────────────────────────────────────
  // The academic months a dry spell spans — used to mark them in the month picker.
  const monthIdxOf = (iso) => { const d = new Date(iso+"T12:00:00"); return Number.isNaN(d.getTime()) ? null : (d.getMonth()-7+12)%12; };
  const leanMonths = (() => {
    const out = new Set();
    // Suspended behind SHOW_GAP_FORECAST (see featureFlags.js) — founder call,
    // 2026-08-02, the underlying dry-spell forecast felt unrealistic.
    if (!SHOW_GAP_FORECAST) return out;
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
              <MonthPicker value={selMonth} onChange={setSelMonth} startYear={yrStartYear} range={yearMonthRange(yr)} leanMonths={leanMonths}/>
            </div>
            <div style={{fontSize:11,color:C.gray,marginBottom:12}}>Set how much you <em>intend</em> to spend each month. Log what you actually spend with <strong>Quick add</strong>.</div>

            {/* Housing — read-only */}
            <div style={{display:"flex",alignItems:"center",gap:10,padding:"8px 10px",background:C.surface,borderRadius:8,marginBottom:10,border:`1px solid ${C.border}`}}>
              <div style={{flex:1}}>
                <div style={{fontSize:12,fontWeight:600,color:C.text}}>Housing</div>
                <div style={{fontSize:11,color:C.gray,marginTop:1,display:"flex",alignItems:"center",gap:4}}>Fixed by housing contract <InfoTip text="Housing is set by your housing contract. Edit the rate in the Aid & Plan tab."/></div>
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
            {/* Live "left to spend" (question 3): what's still unspent of this month's
                safe-to-spend as the student fills in the plan. Always shown so it reads as
                a running tally that updates with every edit. Never green when the spendable
                money is borrowed (founder rule) — colour AND words carry it.
                A few dollars over is rounding noise, NOT overspending (founder): reading
                "$2 over — trim a little" when you nudge a maxed month up by $2 is alarmist,
                so the warning only fires once you're meaningfully over (> $5); at or within
                a few dollars of the max it reads calmly as "planned it all". */}
            {(()=>{ const planOver = moSurplus < -5; const planOnTarget = !planOver && moSurplus <= 0; return (
            <div style={{marginTop:12,padding:"10px 12px",
              background:planOver?C.negLight:planOnTarget?C.surface:(surplusBorrowed?C.blueLight:C.greenLight),borderRadius:8,fontSize:12,
              color:planOver?C.neg:planOnTarget?C.textMid:(surplusBorrowed?C.blue:C.green),fontWeight:500,lineHeight:1.5}}>
              {planOver
                ? <><strong>{fmt(Math.abs(moSurplus))} over</strong> what’s safe to spend this month — trim a little, or it comes out of your cushion.</>
                : planOnTarget
                  ? <>You’ve planned just about every dollar that’s safe to spend this month.</>
                  : surplusBorrowed
                    ? <><strong>{fmt(moSurplus)} left to spend</strong> this month — but that money is borrowed, so returning what you don’t need within 120 days cancels its interest.</>
                    : <><strong>{fmt(moSurplus)} left to spend</strong> this month — a nice bit of room.</>}
            </div>
            );})()}
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

          {/* Check-in card sits in the right column, next to the Monthly plan
              (founder). The Plan-vs-actual chart and the Health-checks card were
              removed. The `yr.notes` field is still synced, just no longer shown. */}
          <BalanceCheckin data={data} upd={upd} />
        </div>
    </>
  );
}
