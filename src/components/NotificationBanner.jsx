import React, { useEffect, useState, useCallback } from 'react';
import { C } from '../lib/theme.js';
import { Icon } from './icons.jsx';
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
    <div role="status" style={{
      background:"rgba(134,178,204,0.12)", border:"1px solid rgba(134,178,204,0.30)",
      borderRadius:8, padding:"10px 14px", marginBottom:16,
      fontSize:12.5, color:C.blue, display:"flex", gap:10, alignItems:"flex-start",
      backdropFilter:"blur(20px)", WebkitBackdropFilter:"blur(20px)",
    }}>
      <div style={{flex:1, lineHeight:1.6, color:C.text}}>
        {current.message}
        {queue.length>1 && <span style={{color:C.gray, fontSize:11, marginLeft:8}}>+{queue.length-1} more</span>}
      </div>
      <button type="button" className="xbtn" aria-label="Dismiss" onClick={dismiss}
        style={{width:28,height:28,borderRadius:14,border:"none",background:"transparent",color:C.blue,cursor:"pointer",display:"inline-flex",alignItems:"center",justifyContent:"center",flexShrink:0,padding:0}}>
        <Icon name="close" size={13}/>
      </button>
    </div>
  );
}
