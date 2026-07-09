import React, { useEffect, useState, useCallback } from 'react';
import { C } from '../lib/theme.js';
import { Icon, MarroLogo } from './icons.jsx';
import { myNotifications, dismissNotification } from '../lib/data.js';

// Global "something changed" banner — renders for ANY signed-in user (not just
// admins), since regular members get notified too (someone they invited
// joined, their invite limit changed, etc). Shown once per app boot; refetches
// are cheap so a fresh session always sees the current queue. Announced via
// role="status" (not "alert" — these are informational, not errors) so screen
// readers pick them up without interrupting whatever the user is doing.
//
// Multiple queued notifications are shown one at a time — dismissing advances
// to the next — to stay non-intrusive rather than stacking several banners.
export function NotificationBanner(){
  const [queue, setQueue] = useState([]); // undismissed rows, oldest-dismissed-first order kept as returned

  const load = useCallback(async()=>{
    const rows = await myNotifications();
    setQueue(rows);
  },[]);
  useEffect(()=>{ load(); },[load]);

  if(queue.length===0) return null;
  const current = queue[0];

  const dismiss = async()=>{
    // Optimistic — pop it locally right away, reconcile silently after.
    setQueue(q=>q.slice(1));
    await dismissNotification(current.id);
  };

  return (
    <div role="status" className="notif-banner" style={{
      position:"relative", overflow:"hidden",
      display:"flex", gap:12, alignItems:"center",
      padding:"14px 16px", marginBottom:16, borderRadius:12,
      background:C.glassTooltip, border:`1px solid ${C.border}`,
      backdropFilter:"blur(20px) saturate(180%)", WebkitBackdropFilter:"blur(20px) saturate(180%)",
      boxShadow:"0 4px 16px rgba(0,0,0,0.18), inset 0 1px 0 rgba(255,255,255,0.10)",
    }}>
      <style>{`
        .notif-banner{animation:notifIn 320ms cubic-bezier(0.23,1,0.32,1)}
        @media (prefers-reduced-motion: reduce){.notif-banner{animation:none}}
        @keyframes notifIn{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:none}}
      `}</style>
      {/* top highlight — glass depth, mirrors MetricTile */}
      <div style={{position:"absolute", left:"6%", right:"6%", top:0, height:1, background:"linear-gradient(90deg,transparent,rgba(255,255,255,0.35),transparent)", pointerEvents:"none"}}/>
      {/* Brand mark — same MarroLogo used on the login screen + invite gate (decorative;
          the message text carries the actual information, so aria-hidden is correct here). */}
      <MarroLogo size={30}/>
      <div style={{flex:1, minWidth:0, textAlign:"center"}}>
        <div style={{fontSize:13, lineHeight:1.5, color:C.text, fontWeight:500}}>{current.message}</div>
        {queue.length>1 && <div style={{color:C.gray, fontSize:11, marginTop:3}}>+{queue.length-1} more</div>}
      </div>
      <button type="button" className="xbtn" aria-label="Dismiss" onClick={dismiss}
        style={{width:28,height:28,borderRadius:14,border:"none",background:"transparent",color:C.gray,cursor:"pointer",display:"inline-flex",alignItems:"center",justifyContent:"center",flexShrink:0,padding:0}}>
        <Icon name="close" size={13}/>
      </button>
    </div>
  );
}
