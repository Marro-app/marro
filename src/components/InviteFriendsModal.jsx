import React, { useEffect, useRef, useState, useCallback } from 'react';
import { C } from '../lib/theme.js';
import { Modal, ChoiceGroup, Paginator, usePagination } from './primitives.jsx';
import { Icon } from './icons.jsx';
import { radioProps } from '../lib/ui-helpers.js';
import { myInviteQuota, myInviteCodes, generateInviteCode, revokeOwnCode, sendInviteEmail } from '../lib/data.js';
import { useApp } from '../context/AppContext.js';

// "Invite friends" — the member-facing referral surface (Settings → Invite
// friends). Each code lets exactly one friend in; a member's invite limit is 5
// (15 for ambassadors), enforced server-side by generate_invite_code(). Revoked
// codes free their slot back up, so "remaining" counts only non-revoked codes.
//
// All data calls are RLS/SECURITY-DEFINER-gated to the current user — the
// browser can't mint beyond the limit or read/act on anyone else's codes.

// Status is driven by redeemed_at (durable "used" marker), never redeemed_by —
// an account deletion can null redeemed_by but redeemed_at never changes.
// `key` doubles as the filter-chip value below, so the visible badge and the
// filter always agree on what counts as what (e.g. an emailed-but-not-yet-
// redeemed code is "Assigned", not lumped into plain "Unused").
function codeStatus(c){
  if(c.revoked_at) return {key:"revoked",  label:"Revoked",  color:C.danger, bg:C.dangerLight};
  if(c.redeemed_at) return {key:"used",     label:"Used",     color:C.green,  bg:C.greenLight};
  if(c.bound_email) return {key:"assigned", label:"Assigned", color:C.amber,  bg:C.amberLight};
  return {key:"unused", label:"Unused", color:C.blue, bg:C.blueLight};
}

// Filter chips shown once the list is long enough to paginate (see
// PAGINATE_THRESHOLD below). "all" isn't a real codeStatus key — handled
// separately in the filter predicate.
const CODE_FILTER_OPTIONS = [
  {key:"all",      label:"All"},
  {key:"used",     label:"Used"},
  {key:"unused",   label:"Unused"},
  {key:"assigned", label:"Assigned, not used"},
  {key:"revoked",  label:"Revoked"},
];
const PAGINATE_THRESHOLD = 10;

// Small archive-box glyph (no matching entry in the shared Icon set).
const ArchiveIcon = () => (
  <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="4" width="14" height="3.4" rx="1"/><path d="M4.4 7.4v7.1a1 1 0 0 0 1 1h9.2a1 1 0 0 0 1-1V7.4M8.2 10.6h3.6"/>
  </svg>
);

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

// Formats a timestamptz for the resend-confirmation copy ("last sent Jul 3, 2026").
function fmtSent(iso){
  if(!iso) return null;
  try{ return new Date(iso).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}); }
  catch{ return null; }
}

// Small icon button that expands into an inline "email this code" popover.
// First send: friend's email + optional note, sent via sendInviteEmail
// (rate-limited, ownership-checked, and existing-account-checked server-side,
// so this is purely a transport UI). Once a code has been emailed once, it's
// assigned to that recipient (server-stored bound_email) — re-opening this
// button no longer offers a free-text "to" field; it shows a confirmation
// asking to resend to that SAME person (bug fix: a code could previously be
// re-sent to a different person than the one it was first promised to, which
// would leave the original recipient's promised access dangling and let a
// single-use code effectively be shared with two people).
// Opens a small nested <Modal> (a DOM child of the outer Invite-friends modal,
// so it stacks above everything and is immune to the scroll-clipping that an
// absolutely-positioned popover suffers inside the outer modal's overflow:auto
// panel — see docs/PRODUCT_DECISIONS.md "Nested modals"). Uses the "solid"
// nested-modal surface (panelClassName + scrimBg) since two stacked default
// glass panels wash out contrast — see index.html's .mm-solid rule.
function EmailCodeBtn({codeRow, onSent}){
  const code = codeRow.code;
  const assignedEmail = codeRow.bound_email || null;
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null); // {text, tone}
  const closeTimer = useRef(null);

  useEffect(()=>()=>{ if(closeTimer.current) clearTimeout(closeTimer.current); },[]);

  const openModal = () => { setMsg(null); setOpen(true); };
  const close = () => {
    if(busy) return;
    if(closeTimer.current){ clearTimeout(closeTimer.current); closeTimer.current = null; }
    setOpen(false); setMsg(null); setTo(""); setNote("");
  };

  const doSend = async (destination) => {
    setBusy(true); setMsg(null);
    const res = await sendInviteEmail(code, destination, note.trim() || undefined);
    setBusy(false);
    if(res.ok){
      // Confirm briefly, then auto-close so the user isn't left staring at a
      // form that already did its job (matches the auto-clear success pattern).
      setMsg({text:"Sent!", tone:"success"});
      setTo(""); setNote("");
      onSent?.();
      closeTimer.current = setTimeout(()=>{ setOpen(false); setMsg(null); closeTimer.current = null; }, 1500);
    } else {
      setMsg({text: res.error || "We couldn't send that email. Your invite code is still good — try again, or copy the code and share it yourself.", tone:"error"});
    }
  };

  const sendFirst = () => { if(!busy && to.trim()) doSend(to.trim()); };
  const confirmResend = () => { if(!busy) doSend(assignedEmail); };

  const lastSent = fmtSent(codeRow.last_sent_at);

  return (
    <>
      <button type="button" className="xbtn"
        aria-label={assignedEmail ? `Resend code ${code}, already sent to ${assignedEmail}` : `Email code ${code}`}
        title={assignedEmail ? `Already sent to ${assignedEmail} — resend` : "Email this code"} aria-haspopup="dialog"
        onClick={openModal}
        style={{width:32,height:32,borderRadius:16,border:`1px solid ${open?C.sel:(assignedEmail?C.greenMid:C.border)}`,background:open?C.selBg:(assignedEmail?C.greenLight:"transparent"),color:assignedEmail?C.green:C.text,cursor:"pointer",display:"inline-flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
        {assignedEmail
          ? <Icon name="check" size={15}/>
          : <span aria-hidden="true" style={{fontSize:18,lineHeight:1}}>✉</span>}
      </button>
      {open && assignedEmail && (
        // Already sent once — lock the recipient, ask to confirm a resend to
        // the SAME person rather than offering a free-text "to" field.
        <Modal title="Resend this code?" onClose={close} width={380} panelClassName="mm mm-solid" scrimBg={C.scrimStrong}>
          <p style={{fontSize:12.5,color:C.textMid,lineHeight:1.5,margin:"0 0 14"}}>
            This code is assigned to <span style={{fontWeight:700,color:C.text}}>{assignedEmail}</span>
            {lastSent ? <> — last sent <span style={{fontWeight:600,color:C.text}}>{lastSent}</span>.</> : "."}
            {" "}Resending will email <span style={{fontFamily:"monospace",fontWeight:700,color:C.text}}>{code}</span> to them again.
          </p>
          <label htmlFor={`invite-resend-note-${code}`} style={{display:"block",fontSize:11,color:C.gray,marginBottom:4,fontWeight:500}}>Note (optional)</label>
          <textarea id={`invite-resend-note-${code}`} placeholder="Hey — following up on this" value={note} disabled={busy} rows={2}
            onChange={e=>setNote(e.target.value)}
            style={{width:"100%",fontSize:13,border:`1px solid ${C.border}`,borderRadius:8,padding:"9px 10px",background:C.bg,color:C.text,boxSizing:"border-box",marginBottom:12,resize:"vertical",fontFamily:"inherit"}}/>
          {msg && <div role={msg.tone==="error"?"alert":"status"} style={{fontSize:12,color:msg.tone==="error"?C.danger:C.green,marginBottom:12}}>{msg.text}</div>}
          <div style={{display:"flex",gap:8}}>
            <button type="button" className="btn-fill" disabled={busy} onClick={close}
              style={{flex:1,padding:"10px",fontSize:13,fontWeight:600,border:"none",borderRadius:8,minHeight:44,background:C.creamSoft,color:C.text,cursor:busy?"default":"pointer",opacity:busy?0.6:1}}>
              Cancel
            </button>
            <button type="button" className="btn-fill" disabled={busy} onClick={confirmResend}
              style={{flex:1,padding:"10px",fontSize:13,fontWeight:600,border:"none",borderRadius:8,minHeight:44,
                background:busy?C.surface:C.teal, color:busy?C.gray:C.bg,
                cursor:busy?"not-allowed":"pointer"}}>
              {busy ? "Sending…" : "Resend"}
            </button>
          </div>
        </Modal>
      )}
      {open && !assignedEmail && (
        <Modal title="Email this code" onClose={close} width={380} panelClassName="mm mm-solid" scrimBg={C.scrimStrong}>
          <p style={{fontSize:12.5,color:C.textMid,lineHeight:1.5,margin:"0 0 14"}}>
            We&apos;ll email <span style={{fontFamily:"monospace",fontWeight:700,color:C.text}}>{code}</span> straight to your friend.
          </p>
          <label htmlFor={`invite-email-${code}`} style={{display:"block",fontSize:11,color:C.gray,marginBottom:4,fontWeight:500}}>Friend&apos;s email</label>
          <input id={`invite-email-${code}`} type="email" placeholder="friend@school.edu" value={to} disabled={busy} autoFocus
            onChange={e=>setTo(e.target.value)}
            style={{width:"100%",fontSize:13,border:`1px solid ${C.border}`,borderRadius:8,padding:"9px 10px",background:C.bg,color:C.text,boxSizing:"border-box",marginBottom:12,minHeight:44}}/>
          <label htmlFor={`invite-note-${code}`} style={{display:"block",fontSize:11,color:C.gray,marginBottom:4,fontWeight:500}}>Note (optional)</label>
          <textarea id={`invite-note-${code}`} placeholder="Hey — thought you'd like this" value={note} disabled={busy} rows={2}
            onChange={e=>setNote(e.target.value)}
            style={{width:"100%",fontSize:13,border:`1px solid ${C.border}`,borderRadius:8,padding:"9px 10px",background:C.bg,color:C.text,boxSizing:"border-box",marginBottom:12,resize:"vertical",fontFamily:"inherit"}}/>
          {msg && <div role={msg.tone==="error"?"alert":"status"} style={{fontSize:12,color:msg.tone==="error"?C.danger:C.green,marginBottom:12}}>{msg.text}</div>}
          <div style={{display:"flex",gap:8}}>
            <button type="button" className="btn-fill" disabled={busy} onClick={close}
              style={{flex:1,padding:"10px",fontSize:13,fontWeight:600,border:"none",borderRadius:8,minHeight:44,background:C.creamSoft,color:C.text,cursor:busy?"default":"pointer",opacity:busy?0.6:1}}>
              Cancel
            </button>
            <button type="button" className="btn-fill" disabled={busy || !to.trim()} onClick={sendFirst}
              style={{flex:1,padding:"10px",fontSize:13,fontWeight:600,border:"none",borderRadius:8,minHeight:44,
                background:(busy||!to.trim())?C.surface:C.teal, color:(busy||!to.trim())?C.gray:C.bg,
                cursor:(busy||!to.trim())?"not-allowed":"pointer"}}>
              {busy ? "Sending…" : "Send"}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

export function InviteFriendsModal({onClose}){
  const [quota, setQuota]   = useState(null); // null while loading
  const [codes, setCodes]   = useState([]);
  const [busy, setBusy]     = useState(false);
  const [msg, setMsg]       = useState(null); // {text, tone:'error'|'info'}
  const [revokingCode, setRevokingCode] = useState(null);
  const [filter, setFilter] = useState("all");
  const [showArchived, setShowArchived] = useState(false);

  // Archiving is a purely client-side view preference: it hides a code from the
  // main list without touching the server (the code still exists in the RLS-
  // gated invite_codes table and still counts against quota). The archived-code
  // list is persisted in the user's synced app_state (data.archivedInviteCodes),
  // so it follows them across devices. See data.js diffStates whitelist.
  const { data, upd } = useApp();
  const archivedSet = new Set(data.archivedInviteCodes || []);
  const setArchivedCodes = (next) => { const d=JSON.parse(JSON.stringify(data)); d.archivedInviteCodes=[...next]; upd(d); };
  const archiveCode   = (code) => { const s=new Set(archivedSet); s.add(code);    setArchivedCodes(s); };
  const unarchiveCode = (code) => { const s=new Set(archivedSet); s.delete(code); setArchivedCodes(s); };

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
  // Admins get an absurdly large sentinel quota (≥1,000,000) meaning "no real
  // ceiling" — showing the raw number ("9999995 invites left") is meaningless,
  // so for admins we hide the counter line entirely (founder directive).
  const unlimited = quota!=null && quota >= 1000000;
  const remaining = quota==null ? null : Math.max(0, quota - active);
  const atQuota = !unlimited && remaining!==null && remaining<=0;

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

  // Flat list until it's long enough to be a scroll problem — matches the
  // admin console's own posture (see AdminTab.jsx's usePagination comment).
  // Below the threshold, filtering chips would just be one more control to
  // scan for a list you can already see in full, so they only appear once
  // pagination kicks in.
  // Archived codes are pulled out of the main list (and its filter/pagination);
  // they get their own collapsible "Archived" section below.
  const liveCodes = personalCodes.filter(c=>!archivedSet.has(c.code));
  const archivedList = personalCodes.filter(c=>archivedSet.has(c.code));
  const paginate = liveCodes.length > PAGINATE_THRESHOLD;
  const changeFilter = (key) => { setFilter(key); setPage(1); };
  const filtered = filter==="all" ? liveCodes : liveCodes.filter(c=>codeStatus(c).key===filter);
  const {page, setPage, totalPages, pageItems} = usePagination(filtered, PAGINATE_THRESHOLD);
  const visibleCodes = paginate ? pageItems : liveCodes;

  return (
    <Modal title="Invite friends" onClose={onClose} width={440}>
      <p style={{fontSize:13,color:C.textMid,lineHeight:1.5,margin:"0 0 16px"}}>
        Each code lets one friend skip the waitlist and join Marro. Share a code — it works once.
      </p>

      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,marginBottom:16}}>
        {unlimited
          ? <span/>
          : <span role="status" style={{fontSize:13,color:C.text,fontWeight:600}}>
              {remaining==null ? "Loading your invites…" : `${remaining} invite${remaining===1?"":"s"} left`}
            </span>}
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
        <>
          {paginate && (
            <ChoiceGroup role="radiogroup" ariaLabel="Filter codes by status" style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:10}}>
              {CODE_FILTER_OPTIONS.map(opt=>{
                const on = filter===opt.key;
                return (
                  <button key={opt.key} type="button" {...radioProps(on)} onClick={()=>changeFilter(opt.key)}
                    style={{fontSize:11,fontWeight:600,padding:"5px 11px",minHeight:28,borderRadius:999,border:`1px solid ${on?C.sel:C.border}`,background:on?C.selBg:"transparent",color:C.text,cursor:"pointer",whiteSpace:"nowrap"}}>
                    {opt.label}
                  </button>
                );
              })}
            </ChoiceGroup>
          )}

          {visibleCodes.length===0
            ? <div style={{fontSize:12.5,color:C.gray,textAlign:"center",padding:"16px 0"}}>{filter==="all" ? "All your codes are archived — see below." : "No codes match this filter."}</div>
            : (
              <ul style={{listStyle:"none",margin:0,padding:0,display:"flex",flexDirection:"column",gap:8}}>
                {visibleCodes.map(c=>{
                  const st = codeStatus(c);
                  return (
                    <li key={c.code} style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",padding:"8px 12px",borderRadius:10,border:`1px solid ${C.border}`}}>
                      <span style={{fontFamily:"monospace",fontWeight:700,fontSize:14,letterSpacing:"0.06em",color:C.text}}>{c.code}</span>
                      <span style={{fontSize:10,padding:"2px 9px",borderRadius:999,background:st.bg,color:st.color,fontWeight:600,whiteSpace:"nowrap"}}>{st.label}</span>
                      <span style={{flex:1}}/>
                      <span style={{display:"flex",alignItems:"center",gap:6,flexShrink:0}}>
                        {!c.revoked_at && !c.redeemed_at && (
                          <>
                            <EmailCodeBtn codeRow={c} onSent={load}/>
                            <CopyBtn value={c.code}/>
                            <button type="button" className="xbtn" aria-label={`Revoke code ${c.code}`} title="Revoke code"
                              onClick={()=>revoke(c.code)} disabled={revokingCode===c.code}
                              style={{width:32,height:32,borderRadius:16,border:`1px solid ${C.dangerMid}`,background:"transparent",color:C.danger,cursor:revokingCode===c.code?"not-allowed":"pointer",display:"inline-flex",alignItems:"center",justifyContent:"center",flexShrink:0,fontSize:11,fontWeight:600}}>
                              {revokingCode===c.code ? "…" : "✕"}
                            </button>
                          </>
                        )}
                        {/* Archive is available on every code (including used/revoked
                            ones, which otherwise have no actions) — it just hides
                            the code from this list; nothing is deleted. */}
                        <button type="button" className="xbtn" aria-label={`Archive code ${c.code}`} title="Archive"
                          onClick={()=>archiveCode(c.code)}
                          style={{width:32,height:32,borderRadius:16,border:`1px solid ${C.border}`,background:"transparent",color:C.textMid,cursor:"pointer",display:"inline-flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                          <ArchiveIcon/>
                        </button>
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}

          {paginate && <Paginator idPrefix="Invite codes" page={page} totalPages={totalPages} onChange={setPage} totalCount={filtered.length} pageSize={PAGINATE_THRESHOLD}/>}
        </>
      )}

      {archivedList.length>0 && (
        <div style={{marginTop:16,paddingTop:16,borderTop:`1px solid ${C.border}`}}>
          <button type="button" onClick={()=>setShowArchived(s=>!s)} aria-expanded={showArchived} aria-controls="invite-archived-list"
            style={{display:"flex",alignItems:"center",gap:8,width:"100%",minHeight:32,background:"none",border:"none",padding:0,cursor:"pointer",textAlign:"left",font:"inherit"}}>
            <Icon name="chevron" size={12} style={{transform:showArchived?"rotate(180deg)":"none",transition:"transform .15s",color:C.gray,flexShrink:0}}/>
            <span style={{fontSize:13,fontWeight:600,color:C.text}}>Archived ({archivedList.length})</span>
          </button>
          {/* Interactive content (Unarchive buttons) is conditionally rendered
              rather than always-mounted-then-hidden, so collapsed controls never
              sit in the keyboard tab order; aria-expanded conveys the state. */}
          {showArchived && (
            <ul id="invite-archived-list" style={{listStyle:"none",margin:"10px 0 0",padding:0,display:"flex",flexDirection:"column",gap:8}}>
              {archivedList.map(c=>{
                const st = codeStatus(c);
                return (
                  <li key={c.code} style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",padding:"8px 12px",borderRadius:10,border:`1px solid ${C.border}`,opacity:0.85}}>
                    <span style={{fontFamily:"monospace",fontWeight:700,fontSize:14,letterSpacing:"0.06em",color:C.text}}>{c.code}</span>
                    <span style={{fontSize:10,padding:"2px 9px",borderRadius:999,background:st.bg,color:st.color,fontWeight:600,whiteSpace:"nowrap"}}>{st.label}</span>
                    <span style={{flex:1}}/>
                    <button type="button" className="btn-pop" aria-label={`Unarchive code ${c.code}`} onClick={()=>unarchiveCode(c.code)}
                      style={{fontSize:11,fontWeight:600,padding:"6px 12px",minHeight:32,borderRadius:8,border:`1px solid ${C.border}`,background:"transparent",color:C.text,cursor:"pointer",flexShrink:0}}>
                      Unarchive
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </Modal>
  );
}
