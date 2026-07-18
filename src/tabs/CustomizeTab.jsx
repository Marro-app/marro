import { useState } from 'react';
import { C, CHART_COLORS } from '../lib/theme.js';
import { fmt } from '../lib/format.js';
import { useEscClose } from '../lib/hooks.js';
import { Card, SectionTitle } from '../components/primitives.jsx';
import { Icon, CatIcon, CatIconPicker } from '../components/icons.jsx';
import { useApp } from '../context/AppContext.js';

// Categories — manage the spending-category list (rename via icon, add, remove)
// plus the derived "Key notes". Private state: the per-category icon popover.
// The add-category form fields (newCat*/iconPickOpen) are shared with the Budget
// tab's add-category modal; addCat/delCat + the figures come from useApp().
export function CustomizeTab(){
  const { data, upd, cats, yr, annDisburse, moSpendable, addCat, delCat,
          newCatName, setNewCatName, newCatIcon, setNewCatIcon, iconPickOpen, setIconPickOpen } = useApp();
  const [editIconCat, setEditIconCat] = useState(null);
  useEscClose(editIconCat!==null, ()=>setEditIconCat(null));
  return (
        <div role="tabpanel" id="tab-panel" aria-labelledby="tab-customize" tabIndex={0} style={{display:"flex",flexDirection:"column",gap:16}}>
          {/* Lift this card while an icon popover is open — glass cards are stacking contexts,
              so an overflowing absolute popover would otherwise paint under the next card (Key notes). */}
          <Card style={editIconCat||iconPickOpen?{position:"relative",zIndex:50}:undefined}>
            <SectionTitle>Spending categories</SectionTitle>
            {cats.map(cat=>(
              <div key={cat.id} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 0",borderBottom:`1px solid ${C.border}`}}>
                {/* Icon is editable after creation — click to swap */}
                <div style={{position:"relative",flexShrink:0}}>
                  <button className="xbtn" type="button" onClick={()=>setEditIconCat(editIconCat===cat.id?null:cat.id)} aria-label={"Change icon for "+cat.label} title="Change icon" style={{background:"none",border:"none",padding:0,cursor:"pointer",display:"inline-flex",borderRadius:8}}>
                    <CatIcon name={cat.icon||cat.id} color={CHART_COLORS[cats.findIndex(c=>c.id===cat.id)%CHART_COLORS.length]}/>
                  </button>
                  {editIconCat===cat.id && <>
                    <div onClick={()=>setEditIconCat(null)} style={{position:"fixed",inset:0,zIndex:99}}/>
                    <div style={{position:"absolute",left:0,top:"calc(100% + 6px)",zIndex:100,width:236,padding:10,background:C.glassTooltip,backdropFilter:"blur(50px) saturate(200%)",WebkitBackdropFilter:"blur(50px) saturate(200%)",border:`1px solid ${C.borderDark}`,borderRadius:12,boxShadow:"0 8px 32px rgba(0,0,0,0.40)"}}>
                      <CatIconPicker value={cat.icon||cat.id} onChange={v=>{const d=JSON.parse(JSON.stringify(data));d.categories=d.categories.map(c=>c.id===cat.id?{...c,icon:v}:c);upd(d);setEditIconCat(null);}}/>
                    </div>
                  </>}
                </div>
                <span style={{flex:1,fontSize:13,color:C.text}}>{cat.label}</span>
                {cat.locked && <span style={{fontSize:11,color:C.gray,background:C.surface,border:`1px solid ${C.border}`,padding:"2px 8px",borderRadius:8}}>Fixed</span>}
                {cat.autoCalc && <span style={{fontSize:11,color:C.blue,background:C.blueLight,padding:"2px 8px",borderRadius:8}}>Auto</span>}
                {!cat.locked && !cat.autoCalc && <button className="btn-fill" onClick={()=>delCat(cat.id)} style={{fontSize:11,padding:"3px 10px",borderRadius:8,border:`1px solid ${C.dangerMid}`,background:C.dangerLight,color:C.danger,cursor:"pointer",fontWeight:500}}>Remove</button>}
              </div>
            ))}
            <div style={{marginTop:14,display:"flex",flexDirection:"column",gap:10}}>
              <div style={{display:"flex",gap:8,alignItems:"center"}}>
                <button className="btn-pop" type="button" onClick={()=>setIconPickOpen(o=>!o)} title="Choose icon" aria-expanded={iconPickOpen} style={{width:36,height:36,borderRadius:8,display:"inline-flex",alignItems:"center",justifyContent:"center",flexShrink:0,border:`1px solid ${iconPickOpen?C.sel:C.border}`,background:iconPickOpen?C.selBg:"transparent",color:C.text,cursor:"pointer",transition:"all .15s"}}>
                  <Icon name={newCatIcon} size={16} strokeWidth={1.5}/>
                </button>
                <input placeholder="New category name" value={newCatName} onChange={e=>setNewCatName(e.target.value)}
                  style={{flex:1,fontSize:13,border:`1px solid ${C.border}`,borderRadius:8,padding:"8px 10px",background:C.bg}}/>
                <button className="btn-fill" onClick={()=>{addCat();setIconPickOpen(false);}} disabled={!newCatName.trim()} style={{padding:"8px 18px",fontSize:13,fontWeight:600,border:"none",borderRadius:8,background:!newCatName.trim()?C.surface:C.teal,color:!newCatName.trim()?C.gray:C.bg,cursor:!newCatName.trim()?"not-allowed":"pointer"}}>Add</button>
              </div>
              {iconPickOpen && <CatIconPicker value={newCatIcon} onChange={v=>{setNewCatIcon(v);setIconPickOpen(false);}}/>}
            </div>
          </Card>

          <Card>
            <SectionTitle>Key notes</SectionTitle>
            {/* Notes are derived from the user's own numbers (active year + goals), not hardcoded —
                they update as the user fills in the Aid tab, budget, and savings goals. */}
            {(()=>{
              const notes=[];
              const g=Number(yr.grant)||0, tf=Number(yr.tuitionFees)||0, hi=Number(yr.healthIns)||0;
              const housing=Number(yr.monthly.housing)||0;

              // 1. Monthly spendable — from this year's real grant/costs
              if(g>0){
                notes.push({title:`Monthly spendable · ${yr.label}`,
                  body:`Your grant this year is ${fmt(g)}. After ${fmt(tf)} tuition & fees${hi>0?` and ${fmt(hi)} health insurance`:""}, ${fmt(annDisburse)} is sent to you — about ${fmt(moSpendable)}/mo for rent, food, transport, and everything else.`});
              } else {
                notes.push({title:"Monthly spendable",
                  body:"Add your grant and school costs in the Aid tab — Marro will then show exactly what you have to spend each month."});
              }

              // 2. Housing ratio — only once rent is entered
              if(housing>0 && moSpendable>0){
                const pct=Math.round(housing/moSpendable*100);
                notes.push({title:"Housing",
                  body:`Your rent is ${fmt(housing)}/mo — ${pct}% of your spendable. ${pct<60?"That's a healthy share (under 60%).":pct<75?"That's on the high side; under 60% leaves more breathing room.":"That's a large share; getting under 60% would free up a lot elsewhere."}`});
              }

              // 3. Health insurance — only if the grant covers it
              if(hi>0){
                notes.push({title:"Health insurance",
                  body:`Your health insurance (${fmt(hi)}/yr) comes out of your grant before it reaches you — it's already accounted for, not part of your living budget.`});
              }

              // 4. USMLE / Step exams — from the user's own goals + exam budget
              const steps=data.stepGoals||[];
              if(steps.length){
                const target=steps.reduce((a,s)=>a+(Number(s.targetAmount)||0),0);
                const saved=steps.reduce((a,s)=>a+(Number(s.saved)||0),0);
                const exB=Number(yr.monthly.exams)||0;
                notes.push({title:"USMLE / Step exams",
                  body:exB>0
                    ? `Your Step exams total about ${fmt(target)}. You've saved ${fmt(saved)} so far at ${fmt(exB)}/mo from your exam budget.`
                    : `Your Step exams will run about ${fmt(target)} total and aren't auto-covered. Add an exam budget line so you're ready when they come.`});
              }

              // 5. Rollover — universal app behavior, not school-specific
              notes.push({title:"Rollover",
                body:"Unspent weekly money rolls into next week automatically."});

              return notes.map((n,i)=>(
                <div key={i} style={{padding:"10px 0",borderBottom:i<notes.length-1?`1px solid ${C.border}`:"none"}}>
                  <div style={{fontWeight:600,fontSize:12,color:C.text,marginBottom:3}}>{n.title}</div>
                  <div style={{fontSize:12,color:C.gray,lineHeight:1.6}}>{n.body}</div>
                </div>
              ));
            })()}
          </Card>
        </div>
  );
}
