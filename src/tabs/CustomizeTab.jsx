import { useState } from 'react';
import { C, CHART_COLORS } from '../lib/theme.js';
import { useEscClose } from '../lib/hooks.js';
import { Card, SectionTitle } from '../components/primitives.jsx';
import { Icon, CatIcon, CatIconPicker } from '../components/icons.jsx';
import { useApp } from '../context/AppContext.js';

// Small pencil badge overlaid on a category icon, signalling the icon is
// editable (not just decorative). Decorative-only — the parent button carries
// the accessible label.
const EditBadge = () => (
  <span aria-hidden="true" style={{position:"absolute",right:-4,bottom:-4,width:15,height:15,borderRadius:8,background:C.teal,color:C.bg,display:"inline-flex",alignItems:"center",justifyContent:"center",border:`1.5px solid ${C.bg}`}}>
    <svg width="8" height="8" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M13.5 4.5l2 2M4 16l1-3 8.5-8.5 2 2L7 15z"/></svg>
  </span>
);

// Categories — manage the spending-category list (rename via icon, add, remove).
// Private state: the per-category icon popover. The add-category form fields
// (newCat*/iconPickOpen) are shared with the Budget tab's add-category modal;
// addCat/delCat come from useApp().
export function CustomizeTab(){
  const { data, upd, cats, addCat, delCat,
          newCatName, setNewCatName, newCatIcon, setNewCatIcon, iconPickOpen, setIconPickOpen } = useApp();
  const [editIconCat, setEditIconCat] = useState(null);
  useEscClose(editIconCat!==null, ()=>setEditIconCat(null));
  return (
        <div role="tabpanel" id="tab-panel" aria-labelledby="tab-customize" tabIndex={0} style={{display:"flex",flexDirection:"column",gap:16}}>
          {/* Lift this card while an icon popover is open — glass cards are stacking contexts,
              so an overflowing absolute popover would otherwise paint under whatever sits below. */}
          <Card style={editIconCat||iconPickOpen?{position:"relative",zIndex:50}:undefined}>
            <SectionTitle>Spending categories</SectionTitle>
            {cats.map(cat=>(
              <div key={cat.id} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 0",borderBottom:`1px solid ${C.border}`}}>
                {/* Icon is editable after creation — the pencil badge makes that obvious; click to swap */}
                <div style={{position:"relative",flexShrink:0}}>
                  <button className="xbtn" type="button" onClick={()=>setEditIconCat(editIconCat===cat.id?null:cat.id)} aria-label={"Change icon for "+cat.label} aria-expanded={editIconCat===cat.id} title="Change icon" style={{position:"relative",background:"none",border:"none",padding:0,cursor:"pointer",display:"inline-flex",borderRadius:8}}>
                    <CatIcon name={cat.icon||cat.id} color={CHART_COLORS[cats.findIndex(c=>c.id===cat.id)%CHART_COLORS.length]}/>
                    <EditBadge/>
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
                <button className="btn-pop" type="button" onClick={()=>setIconPickOpen(o=>!o)} title="Change icon" aria-label="Change category icon" aria-expanded={iconPickOpen} style={{position:"relative",width:36,height:36,borderRadius:8,display:"inline-flex",alignItems:"center",justifyContent:"center",flexShrink:0,border:`1px solid ${iconPickOpen?C.sel:C.border}`,background:iconPickOpen?C.selBg:"transparent",color:C.text,cursor:"pointer",transition:"all .15s"}}>
                  <Icon name={newCatIcon} size={16} strokeWidth={1.5}/>
                  <EditBadge/>
                </button>
                <input placeholder="New category name" value={newCatName} onChange={e=>setNewCatName(e.target.value)}
                  style={{flex:1,fontSize:13,border:`1px solid ${C.border}`,borderRadius:8,padding:"8px 10px",background:C.bg}}/>
                <button className="btn-fill" onClick={()=>{addCat();setIconPickOpen(false);}} disabled={!newCatName.trim()} style={{padding:"8px 18px",fontSize:13,fontWeight:600,border:"none",borderRadius:8,background:!newCatName.trim()?C.surface:C.teal,color:!newCatName.trim()?C.gray:C.bg,cursor:!newCatName.trim()?"not-allowed":"pointer"}}>Add</button>
              </div>
              {iconPickOpen && <CatIconPicker value={newCatIcon} onChange={v=>{setNewCatIcon(v);setIconPickOpen(false);}}/>}
            </div>
          </Card>
          {/* The "Key notes" summary card was removed from this screen — the
              Categories screen is for managing the category list, and the
              derived spendable/housing/exam summaries belong with the budget
              figures, not here (founder call). The same numbers are already
              shown on the Budget tab's Cash flow panel, so nothing is lost. */}
        </div>
  );
}
