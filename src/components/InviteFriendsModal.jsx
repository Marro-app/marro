import React, { useEffect, useState, useCallback } from 'react';
import { C } from '../lib/theme.js';
import { Modal } from './primitives.jsx';
import { myInviteQuota, myInviteCodes, generateInviteCode, revokeOwnCode, sendInviteEmail } from '../lib/data.js';

// "Invite friends" — the member-facing referral surface (Settings → Invite
// friends). Each code lets exactly one friend in; a member's invite limit is 5
// (15 for ambassadors), enforced server-side by generate_invite_code(). Revoked
// codes free their slot back up, so "remaining" counts only non-revoked codes.
//
// All data calls are RLS/SECURITY-DEFINER-gated to the current user — the
// browser can't mint beyond the limit or read/act on anyone else's codes.

// Status is driven by redeemed_at (durable "used" marker), never redeemed_by —
// an account deletion can null redeemed_by but redeemed_at never changes.
function codeStatus(c){
  if(c.revoked_at) return {label:"Revoked", color:C.danger, bg:C.dangerLight};
  if(c.redeemed_at) return {label:"Used",    color:C.green,  bg:C.greenLight};
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

// Small icon button that expands into an inline "email this code" popover —
// friend's email + optional note, sent via sendInviteEmail (rate-limited and
// ownership-checked server-side, so this is purely a transport UI).
function EmailCodeBtn({code}){
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null); // {text, tone}

  const send = async () => {
    if(busy || !to.trim()) return;
    setBusy(true); setMsg(null);
    const res = await sendInviteEmail(code, to.trim(), note.trim() || undefined);
    if(res.ok){
      setMsg({text:"Sent!", tone:"success"});
      setTo(""); setNote("");
    } else {
      setMsg({text: res.error || "Couldn't send that email. Please try again.", tone:"error"});
    }
    setBusy(false);
  };

  return (
    <span style={{position:"relative", display:"inline-flex"}}>
      <button type="button" className="xbtn" aria-label={`Email code ${code}`} title="Email this code" aria-expanded={open}
        onClick={()=>setOpen(o=>!o)}
        style={{width:32,height:32,borderRadius:16,border:`1px solid ${open?C.sel:C.border}`,background:open?C.selBg:"transparent",color:C.text,cursor:"pointer",display:"inline-flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
        <span aria-hidden="true" style={{fontSize:13,lineHeight:1}}>✉</span>
      </button>
      {open && (
        <div role="group" aria-label={`Email code ${code}`} style={{position:"absolute",top:"calc(100% + 6px)",right:0,zIndex:50,width:240,padding:12,background:C.glassTooltip,backdropFilter:"blur(50px) saturate(200%)",WebkitBackdropFilter:"blur(50px) saturate(200%)",border:`1px solid ${C.borderDark}`,borderRadius:12,boxShadow:"0 8px 32px rgba(0,0,0,0.40)"}}>
          <label htmlFor={`invite-email-${code}`} style={{display:"block",fontSize:10.5,color:C.gray,marginBottom:4,fontWeight:500}}>Friend&apos;s email</label>
          <input id={`invite-email-${code}`} type="email" placeholder="friend@school.edu" value={to} disabled={busy}
            onChange={e=>setTo(e.target.value)}
            style={{width:"100%",fontSize:12.5,border:`1px solid ${C.border}`,borderRadius:8,padding:"7px 8px",background:C.bg,color:C.text,boxSizing:"border-box",marginBottom:8,minHeight:32}}/>
          <label htmlFor={`invite-note-${code}`} style={{display:"block",fontSize:10.5,color:C.gray,marginBottom:4,fontWeight:500}}>Note (optional)</label>
          <textarea id={`invite-note-${code}`} placeholder="Hey — thought you'd like this" value={note} disabled={busy} rows={2}
            onChange={e=>setNote(e.target.value)}
            style={{width:"100%",fontSize:12.5,border:`1px solid ${C.border}`,borderRadius:8,padding:"7px 8px",background:C.bg,color:C.text,boxSizing:"border-box",marginBottom:8,resize:"vertical",fontFamily:"inherit"}}/>
          {msg && <div role={msg.tone==="error"?"alert":"status"} style={{fontSize:11,color:msg.tone==="error"?C.danger:C.green,marginBottom:8}}>{msg.text}</div>}
          <button type="button" className="btn-fill" disabled={busy || !to.trim()} onClick={send}
            style={{width:"100%",padding:"8px 0",fontSize:12,fontWeight:600,border:"none",borderRadius:8,minHeight:36,
              background:(busy||!to.trim())?C.surface:C.teal, color:(busy||!to.trim())?C.gray:C.bg,
              cursor:(busy||!to.trim())?"not-allowed":"pointer"}}>
            {busy ? "Sending…" : "Send"}
          </button>
        </div>
      )}
    </span>
  );
}

export function InviteFriendsModal({onClose}){
  const [quota, setQuota]   = useState(null); // null while loading
  const [codes, setCodes]   = useState([]);
  const [busy, setBusy]     = useState(false);
  const [msg, setMsg]       = useState(null); // {text, tone:'error'|'info'}
  const [revokingCode, setRevokingCode] = useState(null);

  const load = useCallback(async()=>{
    const [q, cs] = await Promise.all([myInviteQuota(), myInviteCodes()]);
    setQuota(q);
    setCodes(cs);
  },[]);
  useEffect(()=>{ load(); },[load]);

  // Admin-console-minted bulk codes (issued_by_admin) are excluded from the
  // server's own limit math (generate_invite_code() only counts personal
  // codes) — mirror that here, or an admin who's minted console codes sees
  // their personal "invites left" undercounted / the button disabled early
  // even though the server would still happily generate one.
  const personalCodes = codes.filter(c=>!c.issued_by_admin);
  const active = personalCodes.filter(c=>!c.revoked_at).length;    // used + unused count against limit
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

  const revoke = async(code)=>{
    if(revokingCode) return;
    setRevokingCode(code); setMsg(null);
    const res = await revokeOwnCode(code);
    if(res.status==='ok'){
      await load();
    } else {
      setMsg({text:"Couldn't revoke that code. Please try again.", tone:"error"});
    }
    setRevokingCode(null);
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

      {quota!=null && personalCodes.length===0 && (
        <div style={{fontSize:13,color:C.gray,textAlign:"center",padding:"16px 0"}}>
          No codes yet — generate one to share.
        </div>
      )}

      {personalCodes.length>0 && (
        <ul style={{listStyle:"none",margin:0,padding:0,display:"flex",flexDirection:"column",gap:8}}>
          {personalCodes.map(c=>{
            const st = codeStatus(c);
            return (
              <li key={c.code} style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",padding:"8px 12px",borderRadius:10,border:`1px solid ${C.border}`}}>
                <span style={{fontFamily:"monospace",fontWeight:700,fontSize:14,letterSpacing:"0.06em",color:C.text}}>{c.code}</span>
                <span style={{fontSize:10,padding:"2px 9px",borderRadius:999,background:st.bg,color:st.color,fontWeight:600,whiteSpace:"nowrap"}}>{st.label}</span>
                <span style={{flex:1}}/>
                {!c.revoked_at && !c.redeemed_at && (
                  <span style={{display:"flex",alignItems:"center",gap:6,flexShrink:0}}>
                    <EmailCodeBtn code={c.code}/>
                    <CopyBtn value={c.code}/>
                    <button type="button" className="xbtn" aria-label={`Revoke code ${c.code}`} title="Revoke code"
                      onClick={()=>revoke(c.code)} disabled={revokingCode===c.code}
                      style={{width:32,height:32,borderRadius:16,border:`1px solid ${C.dangerMid}`,background:"transparent",color:C.danger,cursor:revokingCode===c.code?"not-allowed":"pointer",display:"inline-flex",alignItems:"center",justifyContent:"center",flexShrink:0,fontSize:11,fontWeight:600}}>
                      {revokingCode===c.code ? "…" : "✕"}
                    </button>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
  );
}
