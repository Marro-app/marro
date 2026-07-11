import React, { useState, useEffect, useCallback } from 'react';
import { C } from '../lib/theme.js';
import { getSupabase, logEvent } from '../lib/data.js';
import { generateYearConfigs, blankYearFields, DEFAULT_STATE, DEFAULT_CATS, SETUP_VERSION, BLANK_MONTHLY, MONTH_NAMES, MONTH_FULL, todayStr, yr2 } from '../lib/format.js';
import { US_MED_SCHOOLS, degreeForSchool, DO_DUAL, dualOptionsForSchool } from '../lib/schools.js';
import { radioProps } from '../lib/ui-helpers.js';
import { AV_PALETTE, avColor, AVATARS, AV_GROUPS } from '../lib/avatars.js';
import { Icon, CatIcon, BrandIcon, MarroLogo } from './icons.jsx';
import { Pill, Card, Banner, Modal, InfoTip, SectionTitle, ChoiceGroup, Stepper } from './primitives.jsx';
import { AvatarArt, Avatar, AvatarPicker } from './avatars.jsx';
import { DateField } from './pickers.jsx';

export const ProgramModal = ({data, upd, school, onClose}) => {
  const dp = data.program || {};
  const [dual, setDual]       = useState(dp.dual ?? null);
  const [phdField, setPhdField] = useState(dp.phd?.field||"");
  const [phdSame, setPhdSame]   = useState(!(dp.phd?.institution));
  const [phdInst, setPhdInst]   = useState(dp.phd?.institution||"");
  const [mastField, setMastField] = useState(dp.masters?.field||"");
  const [mastSame, setMastSame]   = useState(!(dp.masters?.institution));
  const [mastInst, setMastInst]   = useState(dp.masters?.institution||"");
  const [otherField, setOtherField] = useState(dp.other?.field||"");
  const [otherSame, setOtherSame]   = useState(!(dp.other?.institution));
  const [otherInst, setOtherInst]   = useState(dp.other?.institution||"");
  const degree = degreeForSchool(school);
  const dualOpts = dualOptionsForSchool(school);
  const tracks = [{v:null,label:`${degree} only`}];
  if(dualOpts.includes("phd"))     tracks.push({v:"phd",    label:`${degree}-PhD`});
  if(dualOpts.includes("masters")) tracks.push({v:"masters",label:`${degree} + Master's`});
  tracks.push({v:"other",label:"Other dual degree"});
  const fieldStyle = {width:"100%",fontSize:13,border:`1px solid ${C.border}`,borderRadius:10,padding:"9px 11px",background:C.bg,color:C.text,boxSizing:"border-box"};
  const instBlock = (same,setSame,inst,setInst,ph) => (
    <div style={{marginTop:8}}>
      <div style={{display:"flex",gap:6}}>
        {[{s:true,l:"Same as my school"},{s:false,l:"Different"}].map(o=>(
          <button key={String(o.s)} onClick={()=>setSame(o.s)} style={{flex:1,padding:"8px 0",borderRadius:9,border:`1px solid ${same===o.s?C.sel:C.border}`,background:same===o.s?C.selBg:"transparent",color:C.text,fontSize:12,fontWeight:same===o.s?700:500,cursor:"pointer"}}>{o.l}</button>
        ))}
      </div>
      {!same && <input value={inst} onChange={e=>setInst(e.target.value)} placeholder={ph} style={{...fieldStyle,marginTop:6}}/>}
    </div>
  );
  const save = () => {
    const d=JSON.parse(JSON.stringify(data));
    d.program = {
      degree, dual: dual||null,
      phd:     { field: dual==="phd"?phdField.trim():"",      institution: dual==="phd"&&!phdSame?phdInst.trim():"" },
      masters: { field: dual==="masters"?mastField.trim():"", institution: dual==="masters"&&!mastSame?mastInst.trim():"" },
      other:   { field: dual==="other"?otherField.trim():"",   institution: dual==="other"&&!otherSame?otherInst.trim():"" },
    };
    upd(d); onClose();
  };
  return (
    <Modal title="Program" onClose={onClose} width={420}>
      <div style={{fontSize:12.5,color:C.textMid,marginBottom:12}}>You&apos;re in a <strong style={{color:C.text}}>{degree}</strong> program (set by your school). Are you pursuing a dual degree?</div>
      <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
        {tracks.map(t=>{
          const on = dual===t.v;
          return <button key={String(t.v)} onClick={()=>setDual(t.v)} style={{flex:"1 1 45%",padding:"11px 10px",borderRadius:12,border:`1px solid ${on?C.sel:C.border}`,background:on?C.selBg:"transparent",color:C.text,fontSize:13.5,fontWeight:on?700:500,cursor:"pointer",transition:"all .15s"}}>{t.label}</button>;
        })}
      </div>
      {dual==="phd" && (
        <div style={{marginTop:14}}>
          <div style={{fontSize:12,color:C.textMid,marginBottom:5}}>PhD field <span style={{color:C.gray}}>(if you know it)</span></div>
          <input value={phdField} onChange={e=>setPhdField(e.target.value)} placeholder="e.g. Neuroscience, Immunology" style={fieldStyle}/>
          <div style={{fontSize:12,color:C.textMid,marginTop:10,marginBottom:1}}>PhD-granting institution</div>
          {instBlock(phdSame,setPhdSame,phdInst,setPhdInst,"Institution name")}
        </div>
      )}
      {dual==="masters" && (
        <div style={{marginTop:14}}>
          <div style={{fontSize:12,color:C.textMid,marginBottom:5}}>Master&apos;s field <span style={{color:C.gray}}>(if you know it)</span></div>
          <input value={mastField} onChange={e=>setMastField(e.target.value)} placeholder="e.g. MPH, MBA, MS Clinical Research" style={fieldStyle}/>
          <div style={{fontSize:12,color:C.textMid,marginTop:10,marginBottom:1}}>Master&apos;s-granting institution</div>
          {instBlock(mastSame,setMastSame,mastInst,setMastInst,"Institution name")}
        </div>
      )}
      {dual==="other" && (
        <div style={{marginTop:14}}>
          <div style={{fontSize:12,color:C.textMid,marginBottom:5}}>What dual degree?</div>
          <input value={otherField} onChange={e=>setOtherField(e.target.value)} placeholder="e.g. MD-JD, MD-MPP, DO-MBA" style={fieldStyle}/>
          <div style={{fontSize:12,color:C.textMid,marginTop:10,marginBottom:1}}>Granting institution</div>
          {instBlock(otherSame,setOtherSame,otherInst,setOtherInst,"Institution name")}
        </div>
      )}
      <div style={{fontSize:11,color:C.gray,marginTop:14}}>Changing your number of years? Add or remove years in the Aid tab — that keeps your budget data intact.</div>
      <div style={{display:"flex",gap:8,marginTop:16}}>
        <button className="btn-pop" onClick={onClose} style={{padding:"11px 16px",fontSize:13.5,border:`1px solid ${C.border}`,borderRadius:10,background:"transparent",color:C.gray,cursor:"pointer"}}>Cancel</button>
        <button className="btn-fill" onClick={save} style={{flex:1,padding:"11px",fontSize:13.5,fontWeight:600,border:"none",borderRadius:10,background:C.teal,color:C.bg,cursor:"pointer"}}>Save</button>
      </div>
    </Modal>
  );
};

// One-time profile completion after first login (required, no dismiss). Also reused from
// settings to change school later (dismissable when onClose is provided). Captures the
// user's school — which Phase 3 keys off. Searchable picker → campus step → "Other".
export const ProfileModal = ({uid, onSaved, onClose}) => {
  const [query, setQuery]   = useState("");
  const [picked, setPicked] = useState(null);   // school object
  const [campus, setCampus] = useState(null);   // chosen campus string (multi-campus schools)
  const [other, setOther]   = useState(false);
  const [otherText, setOtherText] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const dismissable = !!onClose;
  const matches = query.trim()
    ? US_MED_SCHOOLS.filter(s => s.name.toLowerCase().includes(query.trim().toLowerCase())).slice(0,8)
    : [];
  const needsCampus = picked && picked.campuses && !campus;
  const school = other ? otherText.trim()
    : (picked ? (picked.campuses ? (campus ? `${picked.name} — ${campus}` : null) : picked.name) : null);
  const canSave = !!school && !saving;
  const reset = () => { setPicked(null); setCampus(null); setQuery(""); };
  const save = async () => {
    if(!canSave) return;
    setSaving(true); setErr("");
    const sb = await getSupabase();
    // Update the existing row; if none yet (first-time), insert.
    let {data, error} = await sb.from("profiles").update({school}).eq("user_id", uid).select();
    if(!error && (!data || !data.length)){
      ({data, error} = await sb.from("profiles").insert({user_id:uid, school}).select());
    }
    if(error){ console.error("profile save failed:", error); setErr(error.message || "Couldn't save — please try again."); setSaving(false); return; }
    if(!data || !data.length){ setErr("Save didn't persist — please try again."); setSaving(false); return; }
    onSaved(school);
  };
  const inputStyle = {width:"100%",padding:"10px 12px",borderRadius:10,border:`1px solid ${C.border}`,background:"transparent",color:C.text,fontSize:13,outline:"none",boxSizing:"border-box"};
  const linkStyle = {marginTop:12,border:"none",background:"transparent",color:C.teal,cursor:"pointer",fontSize:12.5,padding:0};
  return (
    <Modal title={dismissable?"Change your school":"Welcome to Marro"} onClose={onClose||(()=>{})} width={420}>
      <div style={{fontSize:13,color:C.textMid,marginBottom:16,lineHeight:1.5}}>
        {dismissable ? "Pick your medical school below." : "One quick thing — which medical school do you attend? This personalizes Marro for your program."}
      </div>
      {other ? <>
        <input autoFocus value={otherText} onChange={e=>setOtherText(e.target.value)} placeholder="Type your school's full name" style={inputStyle}/>
        <button className="txt-act" onClick={()=>{setOther(false);setOtherText("");}} style={linkStyle}>← Back to the list</button>
      </> : needsCampus ? <>
        <div style={{fontSize:12.5,color:C.text,fontWeight:600,marginBottom:8}}>{picked.name}</div>
        <div style={{fontSize:12,color:C.gray,marginBottom:8}}>Which campus?</div>
        <div role="group" aria-label="Campuses" style={{border:`1px solid ${C.border}`,borderRadius:10,overflow:"hidden"}}>
          {picked.campuses.map(c=>(
            <button key={c} className="menu-row" onClick={()=>setCampus(c)}
              style={{display:"block",width:"100%",textAlign:"left",padding:"9px 12px",border:"none",borderBottom:`1px solid ${C.border}`,background:"transparent",color:C.text,fontSize:12.5,cursor:"pointer"}}>{c}</button>
          ))}
        </div>
        <button className="txt-act" onClick={reset} style={linkStyle}>← Choose a different school</button>
      </> : picked ? <>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,padding:"10px 12px",borderRadius:10,border:`1px solid ${C.sel}`,background:C.selBg}}>
          <span style={{fontSize:13,color:C.text,fontWeight:600}}>{campus ? `${picked.name} — ${campus}` : picked.name}</span>
          <button onClick={reset} className="txt-act" style={{border:"none",background:"transparent",color:C.gray,fontSize:12}}>Change</button>
        </div>
      </> : <>
        <input autoFocus value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search your school…" style={inputStyle}/>
        {matches.length>0 && (
          <div role="group" aria-label="School results" style={{marginTop:6,border:`1px solid ${C.border}`,borderRadius:10,overflow:"hidden",maxHeight:264,overflowY:"auto"}}>
            {matches.map(s=>(
              <button key={s.name} className="menu-row" onClick={()=>{setPicked(s);setCampus(null);}}
                style={{display:"block",width:"100%",textAlign:"left",padding:"9px 12px",border:"none",borderBottom:`1px solid ${C.border}`,background:"transparent",color:C.text,fontSize:12.5,cursor:"pointer"}}>{s.name}{s.campuses?" ›":""}</button>
            ))}
          </div>
        )}
        <button className="txt-act" onClick={()=>{reset();setOther(true);}} style={linkStyle}>My school isn&apos;t listed →</button>
      </>}
      {err && <div style={{marginTop:12,fontSize:12,color:C.neg}}>{err}</div>}
      <button className="btn-fill" onClick={save} disabled={!canSave}
        style={{marginTop:err?10:20,width:"100%",padding:"11px 16px",borderRadius:10,border:"none",background:canSave?C.teal:C.border,color:canSave?"#fff":C.gray,fontSize:14,fontWeight:600,cursor:canSave?"pointer":"not-allowed",transition:"all .15s"}}>
        {saving?"Saving…":"Save"}
      </button>
      {dismissable && <button className="txt-act" onClick={onClose} style={{...linkStyle,color:C.gray,display:"block",width:"100%",textAlign:"center",marginTop:10}}>Cancel</button>}
    </Modal>
  );
};

// ── Identity bits ────────────────────────────────────────────────────────────
// Avatars: 30 recolorable marks on a dark badge + photo (google/upload). The accent
// palette and AVATARS registry below drive the picker, the Avatar renderer, and the
// settings editor.
// Accent palette for avatars. Each accent (c) pairs with a dark feature color (d)
// for eyes/mouths so a recolored character still reads. Theme-independent (avatars
// always sit on a dark badge), so these are fixed hexes, not C tokens.
export const AvatarModal = ({data, upd, user, onClose}) => {
  const [avatar, setAvatar] = useState(data.avatar || {type:"art",style:"buddy",color:"marigold"});
  const googlePhoto = (user?.user_metadata?.avatar_url) || (user?.user_metadata?.picture) || null;
  const save = () => { const d=JSON.parse(JSON.stringify(data)); d.avatar=avatar; upd(d); onClose(); };
  return (
    <Modal title="Your avatar" onClose={onClose} width={420}>
      <AvatarPicker value={avatar} onChange={setAvatar} googlePhoto={googlePhoto}/>
      <button className="btn-fill" onClick={save} style={{marginTop:18,width:"100%",padding:"11px 16px",borderRadius:10,border:"none",background:C.teal,color:C.bg,fontSize:14,fontWeight:600,cursor:"pointer"}}>Save</button>
      <button className="txt-act" onClick={onClose} style={{marginTop:10,display:"block",width:"100%",textAlign:"center",border:"none",background:"transparent",color:C.textMid,fontSize:12.5,cursor:"pointer"}}>Cancel</button>
    </Modal>
  );
};

// Signature hero animation: a marigold dot drops in, orbits to draw the three
// growth rings (logo weight, inner ring at 0.72), then splits — filling the logo's
// center dot and pinching off a second blob that lands as the period in "Marro.",
// while the wordmark rises letter-by-letter from an invisible baseline. Deterministic
// (pure function of time) so it stays smooth; runs on its own rAF loop, scoped per
// instance. Honors prefers-reduced-motion (renders the settled final frame).
const MARRO_CREAM = "#F6EFDD", MARRO_GOLD = "#DDA528";
export const MarroIntro = ({size=360, loop=true, onComplete}) => {
  const ref = React.useRef(null);
  const doneRef = React.useRef(false);
  const dark = document.documentElement.dataset.theme !== "light";
  useEffect(()=>{
    const root = ref.current; if(!root) return;
    // Theme-aware ink: cream wordmark/rings on the dark stage, warm ink on the light stage.
    const CREAM = dark ? "#F6EFDD" : "#2B2920";
    const GOLD  = dark ? "#DDA528" : "#C8861A";
    const uid = "mi"+Math.random().toString(36).slice(2,8);
    root.innerHTML = `
      <svg viewBox="0 0 380 300" width="100%" style="overflow:visible;display:block" aria-hidden="true">
        <defs><clipPath id="${uid}"><rect class="mi-wrect" x="0" y="0" width="0" height="0"/></clipPath></defs>
        <circle class="mi-ring" cx="190" cy="116" r="16" transform="rotate(-90 190 116)" style="fill:none;stroke:${CREAM};stroke-width:3.4;stroke-linecap:round;opacity:0"/>
        <circle class="mi-ring" cx="190" cy="116" r="28" transform="rotate(-90 190 116)" style="fill:none;stroke:${CREAM};stroke-width:3.4;stroke-linecap:round;opacity:0"/>
        <circle class="mi-ring" cx="190" cy="116" r="40" transform="rotate(-90 190 116)" style="fill:none;stroke:${CREAM};stroke-width:3.4;stroke-linecap:round;opacity:0"/>
        <circle class="mi-comet" cx="190" cy="116" r="16" transform="rotate(-90 190 116)" style="fill:none;stroke:${GOLD};stroke-width:3.6;stroke-linecap:round;filter:drop-shadow(0 0 5px rgba(221,165,40,.85));opacity:0"/>
        <text class="mi-meas" x="190" y="262" text-anchor="middle" style="fill:${CREAM};font-family:'Newsreader',Georgia,serif;font-size:50px;font-weight:600;letter-spacing:-1px;opacity:0">Marro</text>
        <g class="mi-letters" clip-path="url(#${uid})"></g>
        <line class="mi-neck" x1="190" y1="116" x2="190" y2="116" stroke-width="0" style="stroke:${GOLD};stroke-linecap:round;opacity:0;filter:drop-shadow(0 0 4px rgba(221,165,40,.7))"/>
        <circle class="mi-lead" r="4.6" cx="0" cy="0" style="fill:${GOLD};filter:drop-shadow(0 0 8px rgba(221,165,40,.95))"/>
        <circle class="mi-cdot" r="3.6" cx="0" cy="0" style="fill:${GOLD};filter:drop-shadow(0 0 5px rgba(221,165,40,.9));opacity:0"/>
        <circle class="mi-pdot" r="4.6" cx="0" cy="0" style="fill:${GOLD};filter:drop-shadow(0 0 7px rgba(221,165,40,.95));opacity:0"/>
      </svg>`;
    const NS="http://www.w3.org/2000/svg", cx=190, cy=116, radii=[16,28,40], baseOp=[0.72,1,1], baseY=262;
    const q = s => root.querySelector(s);
    const rings=[...root.querySelectorAll(".mi-ring")];
    const meas=q(".mi-meas"), lettersG=q(".mi-letters"), wrect=q(".mi-wrect"), comet=q(".mi-comet");
    const lead=q(".mi-lead"), cdot=q(".mi-cdot"), pdot=q(".mi-pdot"), neck=q(".mi-neck");
    const ringC=radii.map(r=>2*Math.PI*r);
    rings.forEach((rg,k)=>{rg.style.strokeDasharray=ringC[k];rg.style.strokeDashoffset=ringC[k];});
    [lead,cdot,pdot].forEach(e=>{e.style.transformBox="fill-box";e.style.transformOrigin="center";});
    const WORD="Marro", total=meas.getComputedTextLength(), left=190-total/2, letterEls=[];
    for(let i=0;i<WORD.length;i++){const sx=left+meas.getSubStringLength(0,i);const el=document.createElementNS(NS,"text");el.setAttribute("x",sx);el.setAttribute("y",baseY);el.setAttribute("text-anchor","start");el.setAttribute("style","fill:"+CREAM+";font-family:'Newsreader',Georgia,serif;font-size:50px;font-weight:600;letter-spacing:-1px");el.textContent=WORD[i];letterEls.push(el);lettersG.appendChild(el);}
    wrect.setAttribute("x",left-14);wrect.setAttribute("y",baseY-72);wrect.setAttribute("width",total+28);wrect.setAttribute("height",76);
    const clamp=x=>x<0?0:x>1?1:x, lerp=(a,b,u)=>a+(b-a)*u;
    const eoB=u=>{const c1=1.70158,c3=c1+1;return 1+c3*Math.pow(u-1,3)+c1*Math.pow(u-1,2);};
    const eoC=u=>1-Math.pow(1-u,3), eioC=u=>u<.5?4*u*u*u:1-Math.pow(-2*u+2,3)/2, eioS=u=>-(Math.cos(Math.PI*u)-1)/2;
    const onRg=(r,p)=>{const a=(-90+360*p)*Math.PI/180;return{x:cx+r*Math.cos(a),y:cy+r*Math.sin(a)};};
    const pp=()=>({x:190+total/2+11,y:256});
    const ent=[0,820],hold=[820,1010],rw=[[1010,1760],[1850,2680],[2770,3640]],gap=[[1760,1850],[2680,2770]];
    const toC=[3640,3940],split=[3940,4760],wStart=4080,wStag=80,wDur=560,pop=[4760,5240],LOOP=7000;
    function frame(t){
      let dx,dy,ds=1,leadOn=1;
      neck.style.opacity=0;cdot.style.opacity=0;pdot.style.opacity=0;
      if(t<ent[1]){const u=clamp(t/(ent[1]-ent[0]));dx=cx;dy=(cy-radii[0])-150*(1-eoB(u));ds=lerp(.55,1,eoB(u));}
      else if(t<hold[1]){const p0=onRg(radii[0],0);dx=p0.x;dy=p0.y;}
      else if(t<rw[0][1]){const p=eioS(clamp((t-rw[0][0])/(rw[0][1]-rw[0][0])));const qp=onRg(radii[0],p);dx=qp.x;dy=qp.y;}
      else if(t<gap[0][1]){const u=clamp((t-gap[0][0])/(gap[0][1]-gap[0][0]));dx=cx;dy=cy-lerp(radii[0],radii[1],eioC(u));}
      else if(t<rw[1][1]){const p=eioS(clamp((t-rw[1][0])/(rw[1][1]-rw[1][0])));const qp=onRg(radii[1],p);dx=qp.x;dy=qp.y;}
      else if(t<gap[1][1]){const u=clamp((t-gap[1][0])/(gap[1][1]-gap[1][0]));dx=cx;dy=cy-lerp(radii[1],radii[2],eioC(u));}
      else if(t<rw[2][1]){const p=eioS(clamp((t-rw[2][0])/(rw[2][1]-rw[2][0])));const qp=onRg(radii[2],p);dx=qp.x;dy=qp.y;}
      else if(t<toC[1]){const u=eioC(clamp((t-toC[0])/(toC[1]-toC[0])));dx=cx;dy=lerp(cy-radii[2],cy,u);ds=lerp(1,1.3,u);}
      else { leadOn=0;dx=cx;dy=cy; }
      lead.style.opacity=leadOn;lead.style.transform="translate("+dx+"px,"+dy+"px) scale("+ds+")";
      if(t>=split[0]){const P=pp();const u=clamp((t-split[0])/(split[1]-split[0])),f=eioC(u);const px=lerp(cx,P.x,f),py=lerp(cy,P.y,f);
        cdot.style.opacity=1;cdot.setAttribute("r",lerp(5,3.6,clamp((t-split[0])/220)));cdot.style.transform="translate("+cx+"px,"+cy+"px)";
        let psc=1;if(t>=pop[0]&&t<pop[1]){const v=(t-pop[0])/(pop[1]-pop[0]);psc=v<.4?lerp(1,1.4,eoC(v/.4)):lerp(1.4,1,eioC((v-.4)/.6));}
        pdot.style.opacity=1;pdot.style.transform="translate("+px+"px,"+py+"px) scale("+psc+")";
        const sep=Math.hypot(px-cx,py-cy),w=9*(1-clamp(sep/30));
        if(w>0.3){neck.style.opacity=1;neck.setAttribute("x1",cx);neck.setAttribute("y1",cy);neck.setAttribute("x2",px);neck.setAttribute("y2",py);neck.setAttribute("stroke-width",w);}
      }
      for(let i=0;i<letterEls.length;i++){const li=clamp((t-(wStart+i*wStag))/wDur);letterEls[i].style.transform="translateY("+lerp(52,0,eoC(li))+"px)";}
      const prog=[0,0,0];for(let k=0;k<3;k++){if(t>=rw[k][0])prog[k]=eioS(clamp((t-rw[k][0])/(rw[k][1]-rw[k][0])));rings[k].style.strokeDashoffset=ringC[k]*(1-prog[k]);rings[k].style.opacity=prog[k]>0?baseOp[k]:0;}
      let act=-1;for(let k=0;k<3;k++){if(t>=rw[k][0]&&t<rw[k][1]){act=k;break;}}
      if(act>=0){const p=prog[act],C2=ringC[act],dash=20;comet.setAttribute("r",radii[act]);comet.style.strokeDasharray=dash+" "+C2;comet.style.strokeDashoffset=(dash-C2*p);comet.style.opacity=1;}else comet.style.opacity=0;
    }
    const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if(reduce){ frame(LOOP-1); if(onComplete) onComplete(); return; }
    let start=null, raf;
    const run=(ts)=>{ if(start===null)start=ts; let el=ts-start;
      if(!loop && el>=LOOP){ frame(LOOP-1); if(!doneRef.current){doneRef.current=true; onComplete&&onComplete();} return; }
      frame(loop?el%LOOP:Math.min(el,LOOP-1)); raf=requestAnimationFrame(run); };
    raf=requestAnimationFrame(run);
    return ()=>cancelAnimationFrame(raf);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[dark]);
  return <div ref={ref} style={{width:size,maxWidth:"100%",margin:"0 auto",borderRadius:18,overflow:"hidden",
    background: dark
      ? "radial-gradient(130% 120% at 50% 30%, #1c1d17 0%, #101210 72%)"
      : "radial-gradient(130% 120% at 50% 30%, #FBF7EC 0%, #ECE4D1 72%)",
    border: dark ? "1px solid rgba(246,239,221,0.09)" : "1px solid rgba(38,37,30,0.10)",
    padding:"6px 0",boxSizing:"border-box"}}/>;
};

// First-run welcome — a guided, branded setup: name → avatar → school. Replaces the
// bare school-only ProfileModal for new users. Saves name+avatar into app state (data)
// and school into the profiles table, then hands control back via onDone(school).
export const OnboardingFlow = ({uid, user, data, upd, onDone, onCancel}) => {
  const meta = user?.user_metadata || {};
  const googlePhoto = meta.avatar_url || meta.picture || null;
  const googleFirst = (meta.full_name || meta.name || meta.given_name || "").trim().split(/\s+/)[0] || "";
  const [step, setStep] = useState(0); // 0 welcome,1 name,2 avatar,3 school,4 program,5 finishing
  const firstRun = !data.setupVersion;  // redo-setup must not regenerate (and wipe) existing years
  // Prefill from existing identity when re-running setup; fall back to Google/defaults first-run.
  const [name, setName] = useState(data.preferredName || googleFirst);
  const [avatar, setAvatar] = useState(data.avatar || (googlePhoto ? {type:"google",url:googlePhoto} : {type:"art",style:"buddy",color:"marigold"}));
  // program shape + dual-degree track — prefill from existing data on redo
  const [progLen, setProgLen] = useState((data.years||[]).length || 4);
  // When did you start? → Fall [year]. Default to the current fall; feeds
  // generateYearConfigs(startYear, len) so a student joining partway through
  // med school gets correctly-dated years without any academic-calendar knowledge.
  const thisYear = new Date().getFullYear();
  const [startYear, setStartYear] = useState(thisYear);
  const [dual, setDual]       = useState(data.program?.dual ?? null);   // null|"phd"|"masters"|"other"
  const [phdField, setPhdField] = useState(data.program?.phd?.field || "");
  const [phdSame, setPhdSame]   = useState(!(data.program?.phd?.institution));   // true = same as med school
  const [phdInst, setPhdInst]   = useState(data.program?.phd?.institution || "");
  const [mastField, setMastField] = useState(data.program?.masters?.field || "");
  const [mastSame, setMastSame]   = useState(!(data.program?.masters?.institution));
  const [mastInst, setMastInst]   = useState(data.program?.masters?.institution || "");
  const [otherField, setOtherField] = useState(data.program?.other?.field || "");
  const [otherSame, setOtherSame]   = useState(!(data.program?.other?.institution));
  const [otherInst, setOtherInst]   = useState(data.program?.other?.institution || "");
  const [signingOut, setSigningOut] = useState(false);
  const suggestLen = d => d==="phd"?7:d==="masters"?5:4;
  // Escape hatch: this is a hard-gate modal (no Esc/close), so a user who signed in by
  // mistake or wants to switch accounts needs some way out. "Back to landing" doesn't
  // make sense as a distinct action here — LandingPage IS what renders once signed out,
  // so signing out already gets them there via App.jsx's onAuthStateChange listener.
  const signOut = async () => {
    if(signingOut) return;
    setSigningOut(true);
    const sb = await getSupabase();
    await sb.auth.signOut();
  };
  // school picker state (mirrors ProfileModal)
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState(null);
  const [campus, setCampus] = useState(null);
  const [other, setOther] = useState(false);
  const [otherText, setOtherText] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const matches = query.trim() ? US_MED_SCHOOLS.filter(s=>s.name.toLowerCase().includes(query.trim().toLowerCase())).slice(0,8) : [];
  const needsCampus = picked && picked.campuses && !campus;
  const school = other ? otherText.trim() : (picked ? (picked.campuses ? (campus ? `${picked.name} — ${campus}` : null) : picked.name) : null);
  const resetSchool = () => { setPicked(null); setCampus(null); setQuery(""); };
  const initial = (name || user?.email || "?").slice(0,1).toUpperCase();

  const finish = async () => {
    if(!school || saving) return;
    setSaving(true); setErr("");
    const sb = await getSupabase();
    let {data:pd, error} = await sb.from("profiles").update({school}).eq("user_id", uid).select();
    if(!error && (!pd || !pd.length)) ({data:pd, error} = await sb.from("profiles").insert({user_id:uid, school}).select());
    if(error || !pd || !pd.length){ setErr(error?.message || "Couldn't save — please try again."); setSaving(false); return; }
    // Persist name + avatar into app state
    const d = JSON.parse(JSON.stringify(data));
    d.preferredName = name.trim() || null;
    d.avatar = avatar;
    // Program track — captured on first-run AND redo (it doesn't touch year data). Degree is
    // derived from the school; institution "" means same as the med school.
    d.program = {
      degree: degreeForSchool(school),
      dual: dual || null,
      phd:     { field: dual==="phd"?phdField.trim():"",       institution: dual==="phd"&&!phdSame?phdInst.trim():"" },
      masters: { field: dual==="masters"?mastField.trim():"",  institution: dual==="masters"&&!mastSame?mastInst.trim():"" },
      other:   { field: dual==="other"?otherField.trim():"",   institution: dual==="other"&&!otherSame?otherInst.trim():"" },
    };
    // First-run only: generate the year configs from the chosen program length.
    // On redo we never touch years (would wipe the user's budget data).
    if(firstRun) d.years = generateYearConfigs(startYear, progLen).map(cfg=>({...cfg, monthly:{...BLANK_MONTHLY}, monthlyOverrides:{}}));
    d.setupVersion = SETUP_VERSION;
    upd(d);
    // First-run onboarding actually completing (not the grandfathered/progressive
    // catch-up path in ProgressiveSetup below) — fire once, here only.
    if(firstRun) logEvent('setup_finished', {});
    setStep(5);
    setSaving(false);
  };

  const cta = {width:"100%",padding:"13px 16px",borderRadius:12,border:"none",fontSize:14.5,fontWeight:600,cursor:"pointer",letterSpacing:"-0.01em"};
  const ctaPrimary = on => ({...cta,background:on?C.text:"rgba(38,37,30,0.10)",color:on?C.bg:C.textMid,cursor:on?"pointer":"not-allowed"});
  const input = {width:"100%",padding:"13px 14px",borderRadius:12,border:`1px solid ${C.border}`,background:"transparent",color:C.text,fontSize:15,outline:"none",boxSizing:"border-box"};
  const head = {fontFamily:"'Newsreader',Georgia,serif",fontSize:25,fontWeight:600,color:C.text,letterSpacing:"-0.02em",lineHeight:1.15};
  const sub  = {fontSize:13,color:C.textMid,marginTop:8,lineHeight:1.55};
  const dotsTotal = 4; // name, avatar, school, program
  const dotIdx = step-1; // welcome(0) shows none

  // Keyboard focus trap: this is a hard-gate modal (no Escape/cancel on first run),
  // so Tab must stay inside the dialog instead of escaping to the app behind it (WCAG 2.4.3).
  const dlgRef = React.useRef(null);
  useEffect(()=>{
    const panel = dlgRef.current; if(!panel) return;
    const focusables = () => [...panel.querySelectorAll('button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])')]
      .filter(el=>!el.disabled && el.offsetParent!==null);
    const onKey = (e) => {
      if(e.key!=="Tab") return;
      const f = focusables(); if(!f.length) return;
      const first=f[0], last=f[f.length-1];
      if(!panel.contains(document.activeElement)){ e.preventDefault(); first.focus(); }
      else if(e.shiftKey && document.activeElement===first){ e.preventDefault(); last.focus(); }
      else if(!e.shiftKey && document.activeElement===last){ e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return ()=>document.removeEventListener("keydown", onKey);
  },[step]);

  return (
    <div ref={dlgRef} role="dialog" aria-modal="true" aria-label="Welcome to Marro" style={{position:"fixed",inset:0,zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:20,background:C.scrim,backdropFilter:"blur(16px)",WebkitBackdropFilter:"blur(16px)"}}>
      <div className="mm" style={{position:"relative",width:"100%",maxWidth:420,padding:"36px 30px 30px",overflow:"hidden"}}>
        {onCancel && step!==5 && <button className="xbtn" onClick={onCancel} aria-label="Close setup" style={{position:"absolute",top:12,right:12,zIndex:2,width:28,height:28,borderRadius:8,border:`1px solid ${C.border}`,background:"transparent",color:C.gray,cursor:"pointer",fontSize:14,lineHeight:1,display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>}
        {/* Escape hatch: no Esc/close on this hard-gate modal, so a user who signed in
            by mistake (or wants to switch accounts) needs a way out. Low-emphasis text
            link (not a button) — the primary action on every step stays "Continue"/
            "Finish". Placed first in normal flow (not absolutely positioned) so it
            reads as part of the card instead of floating over the scrim backdrop,
            and so Tab reaches it before the step content without disrupting the
            step's own internal tab order. */}
        {step!==5 && (
          <div style={{display:"flex",justifyContent:"flex-start",marginBottom:14}}>
            <button
              className="txt-act"
              onClick={signOut}
              disabled={signingOut}
              style={{minHeight:44,padding:"0 8px",margin:"0 0 0 -8px",border:"none",background:"transparent",color:C.gray,cursor:signingOut?"default":"pointer",fontSize:12.5,fontWeight:500}}
            >
              {signingOut?"Signing out…":"Sign out"}
            </button>
          </div>
        )}
        {/* progress dots */}
        {step>=1 && step<=4 && (
          <div style={{display:"flex",gap:6,justifyContent:"center",marginBottom:26}}>
            {Array.from({length:dotsTotal}).map((_,i)=>(
              <div key={i} style={{height:5,borderRadius:5,transition:"all .3s cubic-bezier(0.23,1,0.32,1)",width:i===dotIdx?22:5,background:i<=dotIdx?C.marigold:C.border}}/>
            ))}
          </div>
        )}

        <div key={step} className="ob-step">
          {step===0 && (
            <div style={{textAlign:"center"}}>
              <div style={{marginBottom:18}}><MarroIntro size={324}/></div>
              <div style={{...sub,maxWidth:300,margin:"2px auto 0"}} className="ob-rise">A calmer way to handle money through medical school. Let&apos;s make it yours — it takes about thirty seconds.</div>
              <button className="ob-cta ob-rise" style={{...ctaPrimary(true),marginTop:26}} onClick={()=>setStep(1)}>Get started</button>
            </div>
          )}

          {step===1 && (
            <div>
              <div style={head}>What should we call you?</div>
              <div style={sub}>We&apos;ll greet you by this name. It&apos;s just for you — change it anytime.</div>
              <input autoFocus value={name} onChange={e=>setName(e.target.value)} maxLength={40}
                onKeyDown={e=>{if(e.key==="Enter"&&name.trim())setStep(2);}}
                placeholder="Your first name" style={{...input,marginTop:22}}/>
              <button className="ob-cta" style={{...ctaPrimary(!!name.trim()),marginTop:18}} disabled={!name.trim()} onClick={()=>setStep(2)}>Continue</button>
              <button onClick={()=>setStep(0)} className="txt-act" style={{display:"block",margin:"12px auto 0",border:"none",background:"transparent",color:C.textMid,fontSize:12.5}}>← Back</button>
            </div>
          )}

          {step===2 && (
            <div>
              <div style={head}>Make it yours.</div>
              <div style={sub}>Pick a look, then a color — or use a photo.</div>
              <div style={{marginTop:14}}><AvatarPicker value={avatar} onChange={setAvatar} googlePhoto={googlePhoto}/></div>
              <button className="ob-cta" style={{...ctaPrimary(true),marginTop:16}} onClick={()=>setStep(3)}>Continue</button>
              <button onClick={()=>setStep(1)} className="txt-act" style={{display:"block",margin:"12px auto 0",border:"none",background:"transparent",color:C.textMid,fontSize:12.5}}>← Back</button>
            </div>
          )}

          {step===3 && (
            <div>
              <div style={head}>Where are you training?</div>
              <div style={sub}>This tailors Marro to your program. We never share it.</div>
              <div style={{marginTop:20}}>
                {other ? <>
                  <input autoFocus value={otherText} onChange={e=>setOtherText(e.target.value)} placeholder="Type your school's full name" style={input}/>
                  <button className="txt-act" onClick={()=>{setOther(false);setOtherText("");}} style={{marginTop:12,border:"none",background:"transparent",color:C.teal,cursor:"pointer",fontSize:12.5,padding:0}}>← Back to the list</button>
                </> : needsCampus ? <>
                  <div style={{fontSize:13,color:C.text,fontWeight:600,marginBottom:8}}>{picked.name}</div>
                  <div style={{fontSize:12,color:C.textMid,marginBottom:8}}>Which campus?</div>
                  <div role="group" aria-label="Campuses" style={{border:`1px solid ${C.border}`,borderRadius:12,overflow:"hidden",maxHeight:230,overflowY:"auto"}}>
                    {picked.campuses.map(c=>(
                      <button key={c} className="menu-row" onClick={()=>setCampus(c)} style={{display:"block",width:"100%",textAlign:"left",padding:"10px 13px",border:"none",borderBottom:`1px solid ${C.border}`,background:"transparent",color:C.text,fontSize:13,cursor:"pointer"}}>{c}</button>
                    ))}
                  </div>
                  <button className="txt-act" onClick={resetSchool} style={{marginTop:12,border:"none",background:"transparent",color:C.teal,cursor:"pointer",fontSize:12.5,padding:0}}>← Choose a different school</button>
                </> : picked ? <>
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,padding:"12px 14px",borderRadius:12,border:`1px solid ${C.sel}`,background:C.selBg}}>
                    <span style={{fontSize:13.5,color:C.text,fontWeight:600}}>{campus?`${picked.name} — ${campus}`:picked.name}</span>
                    <button onClick={resetSchool} className="txt-act" style={{border:"none",background:"transparent",color:C.textMid,fontSize:12}}>Change</button>
                  </div>
                </> : <>
                  <input autoFocus value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search your school…" style={input}/>
                  {matches.length>0 && (
                    <div role="group" aria-label="School results" style={{marginTop:8,border:`1px solid ${C.border}`,borderRadius:12,overflow:"hidden",maxHeight:230,overflowY:"auto"}}>
                      {matches.map(s=>(
                        <button key={s.name} className="menu-row" onClick={()=>{setPicked(s);setCampus(null);}} style={{display:"block",width:"100%",textAlign:"left",padding:"10px 13px",border:"none",borderBottom:`1px solid ${C.border}`,background:"transparent",color:C.text,fontSize:13,cursor:"pointer"}}>{s.name}{s.campuses?" ›":""}</button>
                      ))}
                    </div>
                  )}
                  <button className="txt-act" onClick={()=>{resetSchool();setOther(true);}} style={{marginTop:12,border:"none",background:"transparent",color:C.teal,cursor:"pointer",fontSize:12.5,padding:0}}>My school isn&apos;t listed →</button>
                </>}
              </div>
              <button className="ob-cta" style={{...ctaPrimary(!!school),marginTop:20}} disabled={!school} onClick={()=>setStep(4)}>Continue</button>
              <button onClick={()=>setStep(2)} className="txt-act" style={{display:"block",margin:"12px auto 0",border:"none",background:"transparent",color:C.textMid,fontSize:12.5}}>← Back</button>
            </div>
          )}

          {step===4 && (()=>{
            const degree = degreeForSchool(school);
            const dualOpts = dualOptionsForSchool(school);
            const tracks = [{v:null,label:`${degree} only`}];
            if(dualOpts.includes("phd"))     tracks.push({v:"phd",    label:`${degree}-PhD`});
            if(dualOpts.includes("masters")) tracks.push({v:"masters",label:`${degree} + Master's`});
            tracks.push({v:"other",label:"Other dual degree"});
            const pickTrack = v => { setDual(v); if(firstRun) setProgLen(suggestLen(v)); };
            const fieldStyle = {width:"100%",fontSize:13,border:`1px solid ${C.border}`,borderRadius:10,padding:"9px 11px",background:C.bg,color:C.text,boxSizing:"border-box"};
            const instBlock = (same,setSame,inst,setInst,ph) => (
              <div style={{marginTop:8}}>
                <div style={{display:"flex",gap:6}}>
                  {[{s:true,l:"Same as my school"},{s:false,l:"Different"}].map(o=>(
                    <button key={String(o.s)} onClick={()=>setSame(o.s)} style={{flex:1,padding:"8px 0",borderRadius:9,border:`1px solid ${same===o.s?C.sel:C.border}`,background:same===o.s?C.selBg:"transparent",color:C.text,fontSize:12,fontWeight:same===o.s?700:500,cursor:"pointer"}}>{o.l}</button>
                  ))}
                </div>
                {!same && <input value={inst} onChange={e=>setInst(e.target.value)} placeholder={ph} style={{...fieldStyle,marginTop:6}}/>}
              </div>
            );
            return (
            <div>
              <div style={head}>Your program</div>
              <div style={sub}>This sets up your academic years and tailors Marro to your path. Don&apos;t know all of it yet? You can change any of this later in Settings.</div>

              <div style={{fontSize:11,fontWeight:700,letterSpacing:"0.05em",textTransform:"uppercase",color:C.textMid,marginTop:18,marginBottom:8}}>{degree} program — are you doing a dual degree?</div>
              <ChoiceGroup role="radiogroup" ariaLabel="Dual degree" style={{display:"flex",flexWrap:"wrap",gap:8}}>
                {tracks.map(t=>{
                  const on = dual===t.v;
                  return <button key={String(t.v)} {...radioProps(on)} onClick={()=>pickTrack(t.v)} style={{flex:"1 1 45%",padding:"12px 10px",borderRadius:12,border:`1px solid ${on?C.sel:C.border}`,background:on?C.selBg:"transparent",color:C.text,fontSize:13.5,fontWeight:on?700:500,cursor:"pointer",transition:"all .15s"}}>{t.label}</button>;
                })}
              </ChoiceGroup>

              {dual==="phd" && (
                <div style={{marginTop:14,padding:"12px 13px",borderRadius:12,border:`1px solid ${C.border}`,background:C.surface}}>
                  <div style={{fontSize:12,color:C.textMid,marginBottom:5}}>PhD field <span style={{color:C.gray}}>(if you know it)</span></div>
                  <input value={phdField} onChange={e=>setPhdField(e.target.value)} placeholder="e.g. Neuroscience, Immunology" style={fieldStyle}/>
                  <div style={{fontSize:12,color:C.textMid,marginTop:10,marginBottom:1}}>PhD-granting institution</div>
                  {instBlock(phdSame,setPhdSame,phdInst,setPhdInst,"Institution name")}
                </div>
              )}
              {dual==="masters" && (
                <div style={{marginTop:14,padding:"12px 13px",borderRadius:12,border:`1px solid ${C.border}`,background:C.surface}}>
                  <div style={{fontSize:12,color:C.textMid,marginBottom:5}}>Master&apos;s field <span style={{color:C.gray}}>(if you know it)</span></div>
                  <input value={mastField} onChange={e=>setMastField(e.target.value)} placeholder="e.g. MPH, MBA, MS Clinical Research" style={fieldStyle}/>
                  <div style={{fontSize:12,color:C.textMid,marginTop:10,marginBottom:1}}>Master&apos;s-granting institution</div>
                  {instBlock(mastSame,setMastSame,mastInst,setMastInst,"Institution name")}
                </div>
              )}
              {dual==="other" && (
                <div style={{marginTop:14,padding:"12px 13px",borderRadius:12,border:`1px solid ${C.border}`,background:C.surface}}>
                  <div style={{fontSize:12,color:C.textMid,marginBottom:5}}>What dual degree?</div>
                  <input value={otherField} onChange={e=>setOtherField(e.target.value)} placeholder="e.g. MD-JD, MD-MPP, DO-MBA" style={fieldStyle}/>
                  <div style={{fontSize:12,color:C.textMid,marginTop:10,marginBottom:1}}>Granting institution</div>
                  {instBlock(otherSame,setOtherSame,otherInst,setOtherInst,"Institution name")}
                </div>
              )}

              <div style={{display:"flex",gap:18,flexWrap:"wrap",marginTop:20}}>
                <div style={{flex:"1 1 150px",textAlign:"center"}}>
                  <div style={{fontSize:11,fontWeight:700,letterSpacing:"0.05em",textTransform:"uppercase",color:C.textMid,marginBottom:8}}>How many years total?</div>
                  <Stepper value={progLen} onChange={setProgLen} min={1} max={8} ariaLabel="Number of years total" suffix={progLen===1?"year":"years"} inputWidth={44}/>
                </div>
                <div style={{flex:"1 1 170px",textAlign:"center"}}>
                  <div style={{fontSize:11,fontWeight:700,letterSpacing:"0.05em",textTransform:"uppercase",color:C.textMid,marginBottom:8}}>When did you start?</div>
                  <Stepper value={startYear} onChange={setStartYear} min={thisYear-10} max={thisYear+1} ariaLabel="Start year, fall" prefix="Fall" inputWidth={64}/>
                </div>
              </div>
              <div style={{fontSize:11,color:C.gray,marginTop:12}}>Your years run from Fall {startYear} to {startYear+progLen}. You can change any dates later in the Aid tab.</div>
              {err && <div role="alert" style={{marginTop:12,fontSize:12,color:C.danger}}>{err}</div>}
              <button className="ob-cta" style={{...ctaPrimary(!saving),marginTop:err?12:18}} disabled={saving} onClick={finish}>{saving?"Setting up…":"Finish"}</button>
              <button onClick={()=>setStep(3)} className="txt-act" style={{display:"block",margin:"12px auto 0",border:"none",background:"transparent",color:C.textMid,fontSize:12.5}}>← Back</button>
            </div>
            );
          })()}

          {step===5 && (
            <div style={{textAlign:"center",padding:"10px 0"}}>
              <div style={{...head,fontSize:25}} className="ob-rise">You&apos;re all set{name.trim()?`, ${name.trim()}`:""}<span style={{color:C.marigold}}>.</span></div>
              <div style={{...sub,maxWidth:280,margin:"8px auto 0"}} className="ob-rise">Next: enter your aid on the Aid &amp; Detail tab to see your monthly number.</div>
              <button className="ob-cta ob-rise" style={{...ctaPrimary(true),marginTop:24}} onClick={()=>onDone(school)}>Go to my dashboard</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ── Progressive setup ─────────────────────────────────────────────────────────
// Single source of truth for onboarding questions added AFTER launch. When you add
// a new setup prompt: (1) append a step here with the SETUP_VERSION it ships in,
// (2) bump SETUP_VERSION. New users answer it inline in OnboardingFlow; existing
// users whose stored setupVersion is behind get the focused popup below for just
// the question(s) they're missing — no full re-onboarding.
//
// Each step: { key, sinceVersion, isPending(data)→bool, title, sub, Body }.
//   Body({data, commit}) renders the question UI and calls commit(patch) with a
//   shallow state patch (merged + advances). Reuse the glass `.mm` shell + tokens.
const SETUP_STEPS = [
  // v1 (program shape) is collected inline in OnboardingFlow for new users and
  // existing users are grandfathered, so nothing is pending here yet. Future
  // questions (e.g. term-date confirmation, aid-letter upload) go here.
];

export const ProgressiveSetup = ({data, upd}) => {
  const pending = React.useMemo(() => SETUP_STEPS.filter(s => (data.setupVersion||0) < s.sinceVersion && s.isPending(data)), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [i, setI] = useState(0);
  const bumpVersion = () => { const d = JSON.parse(JSON.stringify(data)); d.setupVersion = SETUP_VERSION; upd(d); };
  // Nothing actually missing (e.g. empty registry / grandfathered) → silently catch up.
  React.useEffect(() => { if(!pending.length) bumpVersion(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if(!pending.length) return null;

  const step = pending[i];
  const commit = patch => {
    const d = JSON.parse(JSON.stringify(data));
    Object.assign(d, patch || {});
    if(i+1 >= pending.length) d.setupVersion = SETUP_VERSION;  // last one → mark current
    upd(d);
    if(i+1 < pending.length) setI(i+1);
  };
  const head = {fontFamily:"'Newsreader',Georgia,serif",fontSize:25,fontWeight:600,color:C.text,letterSpacing:"-0.02em",lineHeight:1.15};
  const sub  = {fontSize:13,color:C.textMid,marginTop:8,lineHeight:1.55};

  return (
    <div role="dialog" aria-modal="true" aria-label="Finish setting up Marro" style={{position:"fixed",inset:0,zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:20,background:C.scrim,backdropFilter:"blur(16px)",WebkitBackdropFilter:"blur(16px)"}}>
      <div className="mm" style={{position:"relative",width:"100%",maxWidth:420,padding:"36px 30px 30px",overflow:"hidden"}}>
        {pending.length>1 && (
          <div style={{display:"flex",gap:6,justifyContent:"center",marginBottom:26}}>
            {pending.map((_,j)=>(
              <div key={j} style={{height:5,borderRadius:5,transition:"all .3s cubic-bezier(0.23,1,0.32,1)",width:j===i?22:5,background:j<=i?C.marigold:C.border}}/>
            ))}
          </div>
        )}
        <div style={{fontSize:11,color:C.gray,marginBottom:10,fontWeight:600,letterSpacing:"0.04em",textTransform:"uppercase"}}>One more thing</div>
        <div style={head}>{step.title}</div>
        {step.sub && <div style={sub}>{step.sub}</div>}
        <div key={step.key} className="ob-step" style={{marginTop:18}}>
          <step.Body data={data} commit={commit}/>
        </div>
      </div>
    </div>
  );
};

