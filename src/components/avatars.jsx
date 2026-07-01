import React, { useState, useEffect, useCallback } from 'react';
import { C } from '../lib/theme.js';
import { AV_PALETTE, avColor, AVATARS, AV_GROUPS } from '../lib/avatars.js';
import { Icon } from './icons.jsx';

export const AvatarArt = ({style, color, size=40}) => {
  const av = AVATARS.find(a=>a.id===style) || AVATARS[0];
  const pal = avColor(color);
  // The coin badge is always dark — it's a design signature (dark canvas, accent mark).
  // In light mode we lift it off the page with a drop-shadow instead of recolouring.
  // bg = disc colour passed to marks that punch a hole (e.g. phase);
  // hi = badge-level detail colour (cream on dark coin — always readable).
  const dark = document.documentElement.dataset.theme !== "light";
  const bg = "#14150F";
  const hi = "#F6EFDD";
  const shadowStyle = dark ? {} : {filter:"drop-shadow(0 2px 10px rgba(38,37,30,0.28))"};
  return <svg width={size} height={size} viewBox="0 0 68 68"
    style={{flexShrink:0,display:"block",borderRadius:"50%",...shadowStyle}} aria-hidden="true"
    dangerouslySetInnerHTML={{__html:`<circle cx="34" cy="34" r="34" fill="${bg}"/>`+av.svg(pal.c, pal.d, bg, hi)}}/>;
};

// Renders the user's chosen avatar anywhere (header, settings). Handles photo
// (google/upload), an art style, and a plain initial-chip fallback (incl. legacy
// monogram avatars from before the gallery existed).
export const Avatar = ({avatar, name, email, size=28}) => {
  const initial = (name||email||"?").slice(0,1).toUpperCase();
  if(avatar){
    if((avatar.type==="google"||avatar.type==="upload") && avatar.url)
      return <img src={avatar.url} alt="" width={size} height={size} referrerPolicy="no-referrer" style={{borderRadius:"50%",objectFit:"cover",flexShrink:0,display:"block"}}/>;
    if(avatar.type==="art" && avatar.style)
      return <AvatarArt style={avatar.style} color={avatar.color||"marigold"} size={size}/>;
  }
  return <div style={{width:size,height:size,borderRadius:"50%",background:C.selBg,border:`1px solid ${C.sel}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:Math.round(size*0.42),fontWeight:700,color:C.text,flexShrink:0}}>{initial}</div>;
};

// Reusable avatar picker: live preview, photo (google/upload), color picker, and the
// grouped style gallery. Used in first-run onboarding and the settings avatar editor.
export const AvatarPicker = ({value, onChange, googlePhoto}) => {
  const [color, setColor] = useState(value && value.type==="art" ? (value.color||"marigold") : "marigold");
  const fileRef = React.useRef(null);
  const onUpload = e => {
    const file = e.target.files && e.target.files[0]; if(!file) return;
    const rd = new FileReader();
    rd.onload = () => { const img = new Image(); img.onload = () => {
      const s=160, cv=document.createElement("canvas"); cv.width=s; cv.height=s;
      const ctx=cv.getContext("2d"); const scale=Math.max(s/img.width,s/img.height);
      const w=img.width*scale, h=img.height*scale; ctx.drawImage(img,(s-w)/2,(s-h)/2,w,h);
      onChange({type:"upload",url:cv.toDataURL("image/jpeg",0.85)});
    }; img.src=rd.result; };
    rd.readAsDataURL(file); e.target.value="";
  };
  return (
    <div>
      <div style={{display:"flex",justifyContent:"center",margin:"4px 0 14px"}}>
        <Avatar avatar={value} size={86}/>
      </div>
      <div style={{display:"flex",gap:10,justifyContent:"center",alignItems:"center",marginBottom:13,flexWrap:"wrap"}}>
        {googlePhoto && (
          <button className="ob-swatch" onClick={()=>onChange({type:"google",url:googlePhoto})} aria-label="Use Google photo" aria-pressed={!!(value&&value.type==="google")}
            style={{padding:0,border:`2px solid ${value&&value.type==="google"?C.marigold:"transparent"}`,borderRadius:"50%",background:"transparent",cursor:"pointer",lineHeight:0}}>
            <img src={googlePhoto} alt="" width={40} height={40} referrerPolicy="no-referrer" style={{borderRadius:"50%",objectFit:"cover",display:"block"}}/>
          </button>
        )}
        <button className="btn-pop" onClick={()=>fileRef.current&&fileRef.current.click()} aria-pressed={!!(value&&value.type==="upload")}
          style={{display:"inline-flex",alignItems:"center",gap:6,padding:"8px 12px",borderRadius:10,border:`1px solid ${value&&value.type==="upload"?C.sel:C.border}`,background:value&&value.type==="upload"?C.selBg:"transparent",color:C.text,fontSize:12.5,cursor:"pointer"}}>
          <Icon name="plus" size={13}/>{value&&value.type==="upload"?"Photo added":"Upload photo"}
        </button>
        <input ref={fileRef} type="file" accept="image/*" onChange={onUpload} style={{display:"none"}}/>
      </div>
      <div style={{display:"flex",gap:8,justifyContent:"center",marginBottom:14,flexWrap:"wrap"}}>
        {AV_PALETTE.map(p=>{
          const sel = value && value.type==="art" && (value.color||"marigold")===p.key;
          return <button key={p.key} aria-label={p.label} aria-pressed={!!sel}
            onClick={()=>{setColor(p.key); onChange(value&&value.type==="art"?{...value,color:p.key}:{type:"art",style:"buddy",color:p.key});}}
            style={{width:22,height:22,borderRadius:"50%",background:p.c,border:`2px solid ${sel?C.text:"transparent"}`,boxShadow:sel?`0 0 0 1px ${C.text}`:"none",cursor:"pointer",padding:0}}/>;
        })}
      </div>
      <div className="av-scroll" style={{maxHeight:196,overflowY:"auto",margin:"0 -4px",padding:"0 4px"}}>
        {AV_GROUPS.map(g=>(
          <div key={g.key} style={{marginBottom:8}}>
            <div style={{fontSize:10,color:C.textMid,textTransform:"uppercase",letterSpacing:".06em",margin:"2px 2px 6px"}}>{g.label}</div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(46px,1fr))",gap:7}}>
              {AVATARS.filter(a=>a.group===g.key).map(a=>{
                const sel = value && value.type==="art" && value.style===a.id;
                return <button key={a.id} title={a.label} aria-label={a.label} aria-pressed={!!sel} onClick={()=>onChange({type:"art",style:a.id,color})}
                  style={{padding:2,borderRadius:"50%",border:`2px solid ${sel?C.marigold:"transparent"}`,background:"transparent",cursor:"pointer",lineHeight:0,display:"flex",justifyContent:"center"}}>
                  <AvatarArt style={a.id} color={color} size={42}/>
                </button>;
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// Settings: change your avatar later. Saves into app state.
