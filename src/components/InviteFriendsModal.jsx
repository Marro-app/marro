import React, { useEffect, useState, useCallback } from 'react';
import { C } from '../lib/theme.js';
import { Modal } from './primitives.jsx';
import { myInviteQuota, myInviteCodes, generateInviteCode } from '../lib/data.js';

// "Invite friends" — the member-facing referral surface (Settings → Invite
// friends). Each code lets exactly one friend in; a member's quota is 5 (15 for
// ambassadors), enforced server-side by generate_invite_code(). Revoked codes
// free their slot back up, so "remaining" counts only non-revoked codes.
//
// All three data calls are RLS/SECURITY-DEFINER-gated to the current user — the
// browser can't mint beyond quota or read anyone else's codes.

function codeStatus(c){
  if(c.revoked_at) return {label:"Revoked", color:C.danger, bg:C.dangerLight};
  if(c.redeemed_by) return {label:"Used",    color:C.green,  bg:C.greenLight};
  return {label:"Unused", color:C.blue, bg:C.blueLight};
}

function CopyBtn({value}){
  const [copied, setCopied] = useState(false);
  return (
    <button type="button" className="btn-pop" aria-label={`Copy code ${value}`}
      onClick={async()=>{
        try{ await navigator.clipboard.writeText(value); setCopied(true); setTimeout(()=>setCopied(false),1400); }
        catch{ /* clipboard unavailable — code is still visible to copy by hand */ }
      }}
      style={{fontSize:11,fontWeight:600,padding:"6px 12px",minHeight:32,borderRadius:8,border:`1px solid ${C.border}`,background:"transparent",color:copied?C.green:C.text,cursor:"pointer",flexShrink:0}}>
      {copied ? "Copied ✓" : "Copy"}
    </button>
  );
}

export function InviteFriendsModal({onClose}){
  const [quota, setQuota]   = useState(null); // null while loading
  const [codes, setCodes]   = useState([]);
  const [busy, setBusy]     = useState(false);
  const [msg, setMsg]       = useState(null); // {text, tone:'error'|'info'}

  const load = useCallback(async()=>{
    const [q, cs] = await Promise.all([myInviteQuota(), myInviteCodes()]);
    setQuota(q);
    setCodes(cs);
  },[]);
  useEffect(()=>{ load(); },[load]);

  const active = codes.filter(c=>!c.revoked_at).length;    // used + unused count against quota
  const remaining = quota==null ? null : Math.max(0, quota - active);
  const atQuota = remaining!==null && remaining<=0;

  const generate = async()=>{
    if(busy || atQuota) return;
    setBusy(true); setMsg(null);
    const res = await generateInviteCode();
    if(res.status==='ok'){
      await load();
    } else if(res.status==='quota_exhausted'){
      setMsg({text:"You've used all your invites for now.", tone:"info"});
    } else {
      setMsg({text:"Couldn't create a code. Please try again.", tone:"error"});
    }
    setBusy(false);
  };

  return (
    <Modal title="Invite friends" onClose={onClose} width={440}>
      <p style={{fontSize:13,color:C.textMid,lineHeight:1.5,margin:"0 0 16px"}}>
        Each code lets one friend skip the waitlist and join Marro. Share a code — it works once.
      </p>

      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,marginBottom:16}}>
        <span role="status" style={{fontSize:13,color:C.text,fontWeight:600}}>
          {remaining==null ? "Loading your invites…" : `${remaining} invite${remaining===1?"":"s"} left`}
        </span>
        <button type="button" className="btn-fill" onClick={generate} disabled={busy||atQuota||quota==null}
          style={{padding:"10px 18px",fontSize:13,fontWeight:600,border:"none",borderRadius:8,minHeight:44,
            background:(busy||atQuota||quota==null)?C.surface:C.teal, color:(busy||atQuota||quota==null)?C.gray:C.bg,
            cursor:(busy||atQuota||quota==null)?"not-allowed":"pointer"}}>
          {busy ? "Creating…" : "Generate code"}
        </button>
      </div>

      {msg && <div role="alert" style={{fontSize:12,color:msg.tone==="error"?C.danger:C.textMid,marginBottom:12}}>{msg.text}</div>}

      {quota!=null && codes.length===0 && (
        <div style={{fontSize:13,color:C.gray,textAlign:"center",padding:"16px 0"}}>
          No codes yet — generate one to share.
        </div>
      )}

      {codes.length>0 && (
        <ul style={{listStyle:"none",margin:0,padding:0,display:"flex",flexDirection:"column",gap:8}}>
          {codes.map(c=>{
            const st = codeStatus(c);
            return (
              <li key={c.code} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 12px",borderRadius:10,border:`1px solid ${C.border}`}}>
                <span style={{fontFamily:"monospace",fontWeight:700,fontSize:14,letterSpacing:"0.06em",color:C.text}}>{c.code}</span>
                <span style={{fontSize:10,padding:"2px 9px",borderRadius:999,background:st.bg,color:st.color,fontWeight:600,whiteSpace:"nowrap"}}>{st.label}</span>
                <span style={{flex:1}}/>
                {!c.revoked_at && !c.redeemed_by && <CopyBtn value={c.code}/>}
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
  );
}
