import { useEffect, useRef, useState, useCallback } from 'react';
import { C } from '../lib/theme.js';
import { Card, SectionTitle, EmptyState, Divider, Modal, ChoiceGroup, ProgressBar } from '../components/primitives.jsx';
import { radioProps } from '../lib/ui-helpers.js';
import { adminCall } from '../lib/data.js';

// Admin console — invite codes, waitlist, ambassador roster, members, and the
// admin list itself. Visibility is gated by App.jsx (is_admin() client check);
// every action here is re-checked server-side by api/admin.js against the
// `admins` table using the caller's own bearer token, so this component never
// needs to guard — a non-admin request would just come back 403 from the
// backend and we'd show that as an inline error like any other failure.
//
// Data flow: one list_overview() fetch on mount populates every section; every
// mutation re-fetches the overview afterward rather than hand-patching local
// state, so the console never drifts from the DB (this table is small — a few
// hundred rows tops — so a full refetch is cheap and simpler than reconciling
// diffs).
//
// Status semantics (security-relevant — do not regress): a code is USED iff
// `redeemed_at` is non-null, never `redeemed_by` (which can be nulled by an
// account deletion but redeemed_at is the durable marker). A code is ARCHIVED
// iff `archived_at` is non-null.
function fmtDate(iso) {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleDateString(undefined, {month:"short", day:"numeric", year:"numeric"}); }
  catch { return "—"; }
}
function truncId(id) {
  if (!id) return "—";
  return id.length > 10 ? id.slice(0,8)+"…" : id;
}
function codeStatus(c) {
  if (c.archived_at) return {label:"Archived", color:C.gray, bg:C.surface};
  if (c.revoked_at) return {label:"Revoked", color:C.danger, bg:C.dangerLight};
  if (c.redeemed_at) return {label:"Used", color:C.green, bg:C.greenLight};
  return {label:"Unused", color:C.blue, bg:C.blueLight};
}
// The admin-unlimited sentinel is an absurdly large number server-side —
// anything in the thousands+ reads as "no real ceiling" to a human.
// Threshold matches the admin-unlimited sentinel from my_invite_quota() (SQL) —
// keep in sync so a legitimately large human-entered override (e.g. 1000 for a
// top ambassador) never gets mislabeled "Unlimited".
function fmtLimit(n) {
  if (n == null) return "Default";
  if (n >= 1000000) return "Unlimited";
  return String(n);
}

// Message state that auto-clears SUCCESS-toned messages after a few seconds so
// they don't sit on screen forever (error-toned messages persist until the next
// action, which is expected — the user needs time to read a failure). The timer
// is cleared on unmount and reset on every new message so timers never stack or
// fire after a message was already replaced. Shape: {text, tone}.
function useFlashMsg(delay = 3500) {
  const [msg, setMsgRaw] = useState(null);
  const timer = useRef(null);
  const clear = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } };
  const setMsg = useCallback((m) => {
    clear();
    setMsgRaw(m);
    if (m && m.tone === "success") {
      timer.current = setTimeout(() => { setMsgRaw(null); timer.current = null; }, delay);
    }
  }, [delay]);
  useEffect(() => clear, []);
  return [msg, setMsg];
}

// Small inline status/announcement line — mirrors the role="alert" pattern used
// across App.jsx/WeeklyTab.jsx for form errors, but also used here for success
// text (visually distinguished by color, always programmatically announced via
// role="status" so it doesn't interrupt like a genuine error).
function InlineMsg({text, tone="error"}) {
  if (!text) return null;
  const color = tone === "error" ? C.danger : C.green;
  return <div role={tone==="error"?"alert":"status"} style={{fontSize:12, color, marginTop:8}}>{text}</div>;
}

function CopyBtn({value}) {
  const [copied, setCopied] = useState(false);
  return (
    <button type="button" className="xbtn" aria-label={"Copy code "+value} title="Copy code"
      onClick={async ()=>{
        try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(()=>setCopied(false), 1200); }
        catch { /* clipboard unavailable — silently no-op, code is still visible/selectable */ }
      }}
      style={{width:28, height:28, borderRadius:14, border:"none", background:"transparent", color: copied?C.green:C.gray, cursor:"pointer", display:"inline-flex", alignItems:"center", justifyContent:"center", flexShrink:0}}>
      <span aria-hidden="true" style={{fontSize:13, lineHeight:1}}>{copied ? "✓" : "⧉"}</span>
    </button>
  );
}

// Small circular avatar — image if we have one, else initials on a tinted
// disc drawn from the existing semantic palette (no new color tokens).
const AVATAR_HUES = ["teal", "amber", "blue", "green"];
function hashHue(key) {
  const s = key || "?";
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return AVATAR_HUES[h % AVATAR_HUES.length];
}
function Avatar({avatar, name, email, size=36, decorative=true}) {
  const label = name || email || "";
  if (avatar) {
    return <img src={avatar} alt={decorative ? "" : label} style={{width:size, height:size, borderRadius:"50%", objectFit:"cover", flexShrink:0}}/>;
  }
  const hue = hashHue(email || name || "?");
  const bg = C[hue+"Light"] || C.surfaceMid;
  const fg = C[hue] || C.text;
  const initials = label.split(/[\s@.]+/).filter(Boolean).slice(0,2).map(s=>s[0].toUpperCase()).join("") || "?";
  return (
    <div aria-hidden={decorative} role={decorative?undefined:"img"} aria-label={decorative?undefined:label}
      style={{width:size, height:size, borderRadius:"50%", background:bg, color:fg,
        display:"flex", alignItems:"center", justifyContent:"center", fontSize:Math.round(size*0.38), fontWeight:700, flexShrink:0}}>
      {initials}
    </div>
  );
}

export default function AdminTab({callerEmail}){
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [overview, setOverview] = useState({codes:[], waitlist:[], roles:[], admins:[], ambassadors:[], members:[]});

  const load = useCallback(async () => {
    setLoadError("");
    const res = await adminCall('list_overview');
    if (!res || res.ok === false || res.error) {
      setLoadError(res?.error || "Couldn't load the admin console. Please try again.");
    } else {
      setOverview({
        codes: res.codes||[], waitlist: res.waitlist||[],
        roles: res.roles||[], admins: res.admins||[],
        ambassadors: res.ambassadors||[], members: res.members||[],
      });
    }
    setLoading(false);
  }, []);

  useEffect(()=>{ load(); }, [load]);

  return (
    <div role="tabpanel" id="tab-panel" aria-labelledby="tab-admin" tabIndex={0} style={{display:"flex", flexDirection:"column", gap:16}}>
      {loadError && <Card><InlineMsg text={loadError} tone="error"/></Card>}
      {loading
        ? <Card><EmptyState>Loading admin console…</EmptyState></Card>
        : <>
            <AmbassadorsSection ambassadors={overview.ambassadors} codes={overview.codes} callerEmail={callerEmail} onChanged={load}/>
            <MembersSection members={overview.members} callerEmail={callerEmail} onChanged={load}/>
            <InviteCodesSection codes={overview.codes} onChanged={load}/>
            <WaitlistSection waitlist={overview.waitlist} onChanged={load}/>
            <AdminsSection admins={overview.admins} onChanged={load}/>
          </>
      }
    </div>
  );
}

// ── Shared: per-section sort control ─────────────────────────────────────────
// A small labeled <select> for the sort field plus an optional asc/desc
// toggle, meant to sit next to each section's SectionTitle. Sort state is
// local (useState) per section — this is a lightweight console, not
// something that needs to survive a reload. Every option shows the direction
// toggle by default, including categorical groupings like "Status" — "asc"
// just reverses the group order (e.g. Archived→Revoked→Used→Unused) rather
// than being a no-op. An option can still opt out entirely (dir:false) for a
// sort where reversing truly has no meaning. The toggle reuses the .xbtn
// hit-slop pattern (::after inset:-8px) so the 28px visible circle still
// meets the 44×44 tap-target rule.
function SortBar({idPrefix, value, dir, onChangeValue, onToggleDir, options}) {
  const opt = options.find(o=>o.key===value) || options[0];
  const showDir = opt.dir !== false;
  return (
    <div style={{display:"flex", alignItems:"center", gap:6, flexShrink:0}}>
      <label htmlFor={`${idPrefix}-sort`} style={{fontSize:11, color:C.gray, fontWeight:500, whiteSpace:"nowrap"}}>Sort</label>
      <select id={`${idPrefix}-sort`} value={value} onChange={e=>onChangeValue(e.target.value)}
        style={{fontSize:12, border:`1px solid ${C.border}`, borderRadius:8, padding:"6px 8px", background:C.bg, color:C.text, minHeight:32, cursor:"pointer"}}>
        {options.map(o=><option key={o.key} value={o.key}>{o.label}</option>)}
      </select>
      {showDir && (
        <button type="button" className="xbtn" onClick={onToggleDir}
          aria-label={dir==="asc" ? "Sort ascending — activate to sort descending" : "Sort descending — activate to sort ascending"}
          title={dir==="asc" ? "Ascending" : "Descending"}
          style={{width:28, height:28, borderRadius:14, border:`1px solid ${C.border}`, background:"transparent", color:C.text, cursor:"pointer", display:"inline-flex", alignItems:"center", justifyContent:"center", flexShrink:0}}>
          <span aria-hidden="true" style={{fontSize:13, lineHeight:1, display:"inline-block", transform: dir==="asc" ? "scaleY(-1)" : "none"}}>↓</span>
        </button>
      )}
    </div>
  );
}

// ── Shared: revoke-access confirm modal ──────────────────────────────────────
// Feature #1 — "revoke access to an account, choose whether to delete their
// data." Mirrors the type-DELETE-to-confirm weight of App.jsx's own "Delete my
// account" flow (same destructive-primary-fill-only-when-required convention)
// since the delete_data:true path here is equally irreversible.
function RevokeAccessModal({email, onClose, onDone}) {
  const [deleteData, setDeleteData] = useState(false); // false="kept" (safer default), true="deleted"
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const canConfirm = !busy && (!deleteData || confirmText.trim().toUpperCase() === "DELETE");

  const confirm = async () => {
    setBusy(true); setErr(null);
    const res = await adminCall('revoke_access', {email, delete_data: deleteData});
    if (!res || res.ok === false || res.error) {
      setErr(res?.error || "Couldn't revoke access. Please try again.");
      setBusy(false);
      return;
    }
    onDone(res.mode);
  };

  return (
    <Modal title={`Revoke access for ${email}?`} onClose={()=>{ if(!busy) onClose(); }} width={420}>
      <div style={{fontSize:13, color:C.textMid, marginBottom:14, lineHeight:1.6}}>
        Choose what happens to their account.
      </div>
      <ChoiceGroup role="radiogroup" ariaLabel="Revoke method" style={{display:"flex", flexDirection:"column", gap:8, marginBottom:14}}>
        {[
          {v:false, label:"Keep their data", desc:"They lose access now, but re-inviting them restores everything as it was."},
          {v:true,  label:"Delete everything", desc:"Their account and all their data are permanently erased. This can't be undone."},
        ].map(opt=>{
          const on = deleteData === opt.v;
          return (
            <button key={String(opt.v)} type="button" {...radioProps(on)} disabled={busy}
              onClick={()=>{ setDeleteData(opt.v); setConfirmText(""); setErr(null); }}
              style={{textAlign:"left", padding:"12px 13px", borderRadius:12,
                border:`1px solid ${on ? (opt.v ? C.dangerMid : C.sel) : C.border}`,
                background: on ? (opt.v ? C.dangerLight : C.selBg) : "transparent",
                cursor: busy ? "default" : "pointer", transition:"all .15s"}}>
              <div style={{fontSize:13.5, fontWeight:on?700:600, color: on && opt.v ? C.danger : C.text}}>{opt.label}</div>
              <div style={{fontSize:11.5, color:C.textMid, marginTop:2, lineHeight:1.4}}>{opt.desc}</div>
            </button>
          );
        })}
      </ChoiceGroup>

      {deleteData && (
        <div style={{marginBottom:14}}>
          <label htmlFor="revoke-confirm-input" style={{display:"block", fontSize:11, fontWeight:600, color:C.textMid, marginBottom:6}}>
            Type <strong>DELETE</strong> to confirm
          </label>
          <input id="revoke-confirm-input" autoFocus value={confirmText} disabled={busy} placeholder="DELETE"
            onChange={e=>setConfirmText(e.target.value)}
            onKeyDown={e=>{ if(e.key==="Enter" && canConfirm){ e.preventDefault(); confirm(); } }}
            style={{width:"100%", boxSizing:"border-box", padding:"9px 10px", fontSize:13, borderRadius:8, border:`1px solid ${C.border}`, background:C.surface, color:C.text, outline:"none"}}/>
        </div>
      )}

      <InlineMsg text={err} tone="error"/>

      <div style={{display:"flex", gap:8, marginTop:14}}>
        <button type="button" className="btn-pop" disabled={busy} onClick={onClose}
          style={{flex:1.4, padding:"10px", fontSize:13, fontWeight:600, border:`1px solid ${C.border}`, borderRadius:8, background:"transparent", color:C.text, cursor:busy?"default":"pointer", opacity:busy?0.6:1, minHeight:44}}>
          Cancel
        </button>
        <button type="button" className="btn-fill" disabled={!canConfirm} onClick={confirm}
          style={{flex:1, padding:"10px", fontSize:13, fontWeight:600, borderRadius:8, minHeight:44,
            border: deleteData ? `1px solid ${C.dangerMid}` : `1px solid ${C.border}`,
            background: deleteData ? C.dangerLight : C.surface,
            color: deleteData ? C.danger : C.text,
            cursor: canConfirm ? "pointer" : "not-allowed", opacity: canConfirm ? 1 : 0.6}}>
          {busy ? "Revoking…" : "Revoke access"}
        </button>
      </div>
    </Modal>
  );
}

// Ambassadors sort options — default matches the section's original fixed
// behavior (brought-in, descending) so nothing changes until the founder
// actively picks something else.
const AMB_SORT_OPTIONS = [
  {key:"brought_in", label:"Brought in", defaultDir:"desc"},
  {key:"name", label:"Name/email (A–Z)", defaultDir:"asc"},
  {key:"invite_limit", label:"Invite limit", defaultDir:"desc"},
  {key:"updated_at", label:"Recently updated", defaultDir:"desc"},
];
function cmpAmbassadors(a, b, sortBy, dir) {
  const m = dir === "asc" ? 1 : -1;
  switch (sortBy) {
    case "name": {
      const an = (a.name || a.email || "").toLowerCase(), bn = (b.name || b.email || "").toLowerCase();
      return an.localeCompare(bn) * (dir === "asc" ? 1 : -1);
    }
    case "invite_limit": return ((a.invite_limit || 0) - (b.invite_limit || 0)) * m;
    case "updated_at": return (new Date(a.updated_at || 0) - new Date(b.updated_at || 0)) * m;
    case "brought_in":
    default: return ((a.brought_in || 0) - (b.brought_in || 0)) * m;
  }
}

// ── 1. Ambassadors ────────────────────────────────────────────────────────────
function AmbassadorsSection({ambassadors, codes, callerEmail, onChanged}) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useFlashMsg();
  const [profileEmail, setProfileEmail] = useState(null);
  const [revokeEmail, setRevokeEmail] = useState(null);
  const [sortBy, setSortBy] = useState("brought_in");
  const [sortDir, setSortDir] = useState("desc");
  const changeSort = (key) => { setSortBy(key); setSortDir(AMB_SORT_OPTIONS.find(o=>o.key===key)?.defaultDir || "desc"); };

  const canAdd = email.trim() && !busy;

  const add = async () => {
    setBusy(true); setMsg(null);
    const res = await adminCall('set_role', {email: email.trim(), is_ambassador: true});
    if (!res || res.ok === false || res.error) {
      setMsg({text: res?.error || "Couldn't add that ambassador. Please try again.", tone:"error"});
    } else {
      setMsg({text: `${email.trim()} is now an ambassador.`, tone:"success"});
      setEmail("");
      onChanged();
    }
    setBusy(false);
  };

  const sorted = [...ambassadors].sort((a,b)=> cmpAmbassadors(a, b, sortBy, sortDir));
  const profile = profileEmail ? ambassadors.find(a=>a.email===profileEmail) : null;

  return (
    <Card>
      <div style={{display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:12, flexWrap:"wrap"}}>
        <SectionTitle sub="Grant ambassador status, raise invite limits, and see who each ambassador has brought in.">Ambassadors</SectionTitle>
        <SortBar idPrefix="amb" value={sortBy} dir={sortDir} onChangeValue={changeSort}
          onToggleDir={()=>setSortDir(d=>d==="asc"?"desc":"asc")} options={AMB_SORT_OPTIONS}/>
      </div>

      <div style={{display:"flex", alignItems:"flex-end", gap:8, flexWrap:"wrap", marginBottom:14}}>
        <div style={{flex:1, minWidth:200}}>
          <label htmlFor="amb-add-email" style={{display:"block", fontSize:11, color:C.gray, marginBottom:4, fontWeight:500}}>Email</label>
          <input id="amb-add-email" type="email" placeholder="name@school.edu" value={email} onChange={e=>setEmail(e.target.value)}
            style={{width:"100%", fontSize:13, border:`1px solid ${C.border}`, borderRadius:8, padding:"8px 10px", background:C.bg, color:C.text, boxSizing:"border-box", minHeight:44}}/>
        </div>
        <button type="button" className="btn-fill" onClick={add} disabled={!canAdd}
          style={{padding:"10px 18px", fontSize:13, fontWeight:600, border:"none", borderRadius:8, minHeight:44,
            background: canAdd ? C.teal : C.surface, color: canAdd ? C.bg : C.gray, cursor: canAdd ? "pointer" : "not-allowed"}}>
          {busy ? "Adding…" : "Add as ambassador"}
        </button>
      </div>
      <InlineMsg text={msg?.text} tone={msg?.tone}/>

      <Divider/>

      {sorted.length === 0
        ? <EmptyState>No ambassadors yet — add one above to get started.</EmptyState>
        : (
          <div style={{display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(min(100%,300px),1fr))", gap:12}}>
            {sorted.map((a, i)=>(
              <AmbassadorCard key={a.email} a={a} rank={(sortBy==="brought_in" && i<3) ? i+1 : null} isSelf={callerEmail && a.email===callerEmail}
                onChanged={onChanged} onViewProfile={()=>setProfileEmail(a.email)} onRevoke={()=>setRevokeEmail(a.email)}/>
            ))}
          </div>
        )
      }

      {profile && (
        <AmbassadorProfileModal key={profile.email} ambassador={profile} codes={codes.filter(c=>c.owner_email===profile.email)}
          onClose={()=>setProfileEmail(null)} onChanged={onChanged}/>
      )}
      {revokeEmail && (
        <RevokeAccessModal key={revokeEmail} email={revokeEmail} onClose={()=>setRevokeEmail(null)}
          onDone={()=>{ setRevokeEmail(null); onChanged(); }}/>
      )}
    </Card>
  );
}

const RANK_LABEL = {1:"#1", 2:"#2", 3:"#3"};

function AmbassadorCard({a, rank, isSelf, onChanged, onViewProfile, onRevoke}) {
  const [stepOpen, setStepOpen] = useState(false);
  const [custom, setCustom] = useState("");
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [err, setErr] = useState(null);

  const limit = a.invite_limit;
  const used = a.codes_used || 0;
  const meterMax = limit >= 1000 ? Math.max(used, 1) : limit; // unlimited: just show usage, no false ceiling

  const setLimit = async (newLimit) => {
    setBusy(true); setErr(null);
    const res = await adminCall('set_role', {email: a.email, quota_override: newLimit});
    if (!res || res.ok === false || res.error) setErr(res?.error || "Couldn't update their invite limit.");
    else { setStepOpen(false); setCustom(""); onChanged(); }
    setBusy(false);
  };

  const removeAmbassador = async () => {
    setRemoving(true); setErr(null);
    const res = await adminCall('clear_role', {email: a.email});
    if (!res || res.ok === false || res.error) { setErr(res?.error || "Couldn't remove ambassador status."); setRemoving(false); return; }
    onChanged();
  };

  return (
    <div style={{border:`1px solid ${C.border}`, borderRadius:12, padding:14, display:"flex", flexDirection:"column", gap:10, position:"relative"}}>
      {rank && (
        <span style={{position:"absolute", top:10, right:10, fontSize:10, fontWeight:700, color:C.amber, background:C.amberLight, borderRadius:999, padding:"2px 8px"}}>
          {RANK_LABEL[rank]}
        </span>
      )}
      <div style={{display:"flex", alignItems:"center", gap:10}}>
        <Avatar avatar={a.avatar} name={a.name} email={a.email} size={40}/>
        <div style={{minWidth:0, flex:1}}>
          <div style={{fontSize:13.5, fontWeight:700, color:C.text, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis"}}>{a.name || a.email}</div>
          {a.name && <div style={{fontSize:11, color:C.gray, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis"}}>{a.email}</div>}
        </div>
      </div>

      {!a.joined
        ? <span style={{fontSize:10, padding:"2px 9px", borderRadius:999, background:C.amberLight, color:C.amber, fontWeight:600, alignSelf:"flex-start"}}>Invited — hasn&apos;t joined</span>
        : (
          <>
            <div>
              <div style={{display:"flex", justifyContent:"space-between", fontSize:11.5, color:C.textMid, marginBottom:4}}>
                <span>Invites</span>
                <span style={{fontWeight:600, color:C.text}}>{used} of {fmtLimit(limit)} used</span>
              </div>
              <ProgressBar value={used} max={meterMax || 1} color={C.teal}/>
            </div>
            <div style={{fontSize:12, color:C.textMid}}>
              Brought in: <strong style={{color:C.text}}>{a.brought_in || 0}</strong>
            </div>
          </>
        )
      }

      <InlineMsg text={err} tone="error"/>

      <div style={{display:"flex", gap:8, flexWrap:"wrap", position:"relative"}}>
        <button type="button" className="btn-pop" onClick={()=>{ setErr(null); setStepOpen(true); }} aria-haspopup="dialog"
          style={{fontSize:11, padding:"6px 12px", minHeight:32, borderRadius:8, border:`1px solid ${C.border}`, background:"transparent", color:C.text, cursor:"pointer", fontWeight:600}}>
          Increase invites
        </button>
        <button type="button" className="btn-pop" onClick={onViewProfile}
          style={{fontSize:11, padding:"6px 12px", minHeight:32, borderRadius:8, border:`1px solid ${C.border}`, background:"transparent", color:C.text, cursor:"pointer", fontWeight:600}}>
          View profile
        </button>
        <button type="button" className="btn-pop" onClick={removeAmbassador} disabled={removing}
          style={{fontSize:11, padding:"6px 12px", minHeight:32, borderRadius:8, border:`1px solid ${C.border}`, background:"transparent", color:C.textMid, cursor:removing?"not-allowed":"pointer", fontWeight:600}}>
          {removing ? "Removing…" : "Remove ambassador"}
        </button>
        {!isSelf && (
          <button type="button" className="btn-pop" onClick={onRevoke}
            style={{fontSize:11, padding:"6px 12px", minHeight:32, borderRadius:8, border:`1px solid ${C.dangerMid}`, background:"transparent", color:C.danger, cursor:"pointer", fontWeight:600}}>
            Revoke access
          </button>
        )}

        {stepOpen && (
          <Modal title={`Increase invites for ${a.name || a.email}`} onClose={()=>{ if(!busy){ setStepOpen(false); setCustom(""); } }} width={360}>
            <div style={{fontSize:13, color:C.textMid, marginBottom:14, lineHeight:1.5}}>
              Currently <strong style={{color:C.text}}>{fmtLimit(limit)}</strong>. Bump it up or set an exact number.
            </div>
            <div style={{display:"flex", gap:8, marginBottom:16}}>
              {[5,10].map(step=>(
                <button key={step} type="button" className="btn-pop" disabled={busy} onClick={()=>setLimit((limit||0)+step)}
                  style={{flex:1, fontSize:13, padding:"10px 0", minHeight:44, borderRadius:8, border:`1px solid ${C.border}`, background:"transparent", color:C.text, cursor:busy?"not-allowed":"pointer", fontWeight:600}}>
                  +{step}
                </button>
              ))}
            </div>
            <label htmlFor={`amb-custom-${a.email}`} style={{display:"block", fontSize:11, color:C.gray, marginBottom:4, fontWeight:500}}>Set exact limit</label>
            <div style={{display:"flex", gap:8}}>
              <input id={`amb-custom-${a.email}`} type="number" inputMode="numeric" min={0} autoFocus placeholder={String(limit ?? "")} value={custom}
                onChange={e=>setCustom(e.target.value)}
                onKeyDown={e=>{ if(e.key==="Enter" && !busy && custom.trim()!==""){ e.preventDefault(); setLimit(parseInt(custom,10)); } }}
                style={{flex:1, minWidth:0, fontSize:13, border:`1px solid ${C.border}`, borderRadius:8, padding:"10px", background:C.bg, color:C.text, boxSizing:"border-box", minHeight:44}}/>
              <button type="button" className="btn-fill" disabled={busy || custom.trim()===""} onClick={()=>setLimit(parseInt(custom,10))}
                style={{fontSize:13, padding:"10px 18px", minHeight:44, borderRadius:8, border:"none",
                  background: (busy||custom.trim()==="") ? C.surface : C.teal, color:(busy||custom.trim()==="") ? C.gray : C.bg, cursor:(busy||custom.trim()==="")?"not-allowed":"pointer", fontWeight:600}}>
                Set
              </button>
            </div>
            <InlineMsg text={err} tone="error"/>
          </Modal>
        )}
      </div>
    </div>
  );
}

function AmbassadorProfileModal({ambassador, codes, onClose, onChanged}) {
  const [note, setNote] = useState(ambassador.note || "");
  const [school, setSchool] = useState(ambassador.school || "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useFlashMsg();
  const [actingCode, setActingCode] = useState(null);

  // Belt-and-suspenders against stale state leaking between ambassadors: even
  // though this modal is remounted per-open at the call site (and given a
  // key={ambassador.email}), reset the editable fields if the ambassador prop
  // ever changes under a reused instance.
  useEffect(()=>{ setNote(ambassador.note || ""); setSchool(ambassador.school || ""); }, [ambassador.email]);

  const save = async () => {
    setBusy(true); setMsg(null);
    const res = await adminCall('set_role', {email: ambassador.email, note: note.trim() || null, school: school.trim() || null});
    if (!res || res.ok === false || res.error) setMsg({text: res?.error || "Couldn't save. Please try again.", tone:"error"});
    else { setMsg({text:"Saved.", tone:"success"}); onChanged(); }
    setBusy(false);
  };

  const revokeCode = async (code) => {
    setActingCode(code);
    const res = await adminCall('revoke_code', {code});
    if (!res || res.ok === false || res.error) setMsg({text: res?.error || "Couldn't revoke that code. Please try again.", tone:"error"});
    else if (!res.revoked) setMsg({text: "That code is already used or revoked.", tone:"error"});
    else { setMsg(null); onChanged(); }
    setActingCode(null);
  };
  const archiveCode = async (code) => {
    setActingCode(code);
    const res = await adminCall('archive_code', {code});
    if (!res || res.ok === false || res.error) setMsg({text: res?.error || "Couldn't archive that code. Please try again.", tone:"error"});
    else if (!res.archived) setMsg({text: "That code can't be archived (only revoked codes can be).", tone:"error"});
    else { setMsg(null); onChanged(); }
    setActingCode(null);
  };

  const sortedCodes = [...codes].sort((a,b)=> new Date(b.created_at) - new Date(a.created_at));

  return (
    <Modal title="Ambassador profile" onClose={onClose} width={520}>
      <div style={{display:"flex", alignItems:"center", gap:12, marginBottom:18}}>
        <Avatar avatar={ambassador.avatar} name={ambassador.name} email={ambassador.email} size={56}/>
        <div style={{minWidth:0}}>
          <div style={{fontSize:16, fontWeight:700, color:C.text}}>{ambassador.name || ambassador.email}</div>
          {ambassador.name && <div style={{fontSize:12, color:C.gray}}>{ambassador.email}</div>}
        </div>
      </div>

      <div style={{display:"flex", gap:10, flexWrap:"wrap", marginBottom:16}}>
        <div style={{flex:1, minWidth:160}}>
          <label htmlFor="amb-note" style={{display:"block", fontSize:11, color:C.gray, marginBottom:4, fontWeight:500}}>Note</label>
          <input id="amb-note" type="text" placeholder="e.g. runs the Cornell class GroupMe" value={note} onChange={e=>setNote(e.target.value)}
            style={{width:"100%", fontSize:13, border:`1px solid ${C.border}`, borderRadius:8, padding:"8px 10px", background:C.bg, color:C.text, boxSizing:"border-box", minHeight:44}}/>
        </div>
        <div style={{flex:1, minWidth:140}}>
          <label htmlFor="amb-school" style={{display:"block", fontSize:11, color:C.gray, marginBottom:4, fontWeight:500}}>School</label>
          <input id="amb-school" type="text" placeholder="e.g. Weill Cornell" value={school} onChange={e=>setSchool(e.target.value)}
            style={{width:"100%", fontSize:13, border:`1px solid ${C.border}`, borderRadius:8, padding:"8px 10px", background:C.bg, color:C.text, boxSizing:"border-box", minHeight:44}}/>
        </div>
        <button type="button" className="btn-fill" disabled={busy} onClick={save}
          style={{padding:"10px 18px", fontSize:13, fontWeight:600, border:"none", borderRadius:8, minHeight:44, alignSelf:"flex-end",
            background: busy ? C.surface : C.teal, color: busy ? C.gray : C.bg, cursor: busy ? "not-allowed" : "pointer"}}>
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
      <InlineMsg text={msg?.text} tone={msg?.tone}/>

      <Divider/>

      <SectionTitle>Codes</SectionTitle>
      {sortedCodes.length === 0
        ? <EmptyState>No codes issued yet.</EmptyState>
        : (
          <ul style={{listStyle:"none", margin:0, padding:0, display:"flex", flexDirection:"column", gap:8, maxHeight:280, overflowY:"auto"}}>
            {sortedCodes.map(c=>{
              const st = codeStatus(c);
              return (
                <li key={c.code} style={{display:"flex", alignItems:"center", gap:8, flexWrap:"wrap", padding:"8px 10px", borderRadius:10, border:`1px solid ${C.border}`}}>
                  <span style={{fontFamily:"monospace", fontWeight:700, fontSize:12.5, color:C.text}}>{c.code}</span>
                  <span style={{fontSize:10, padding:"2px 9px", borderRadius:999, background:st.bg, color:st.color, fontWeight:600, whiteSpace:"nowrap"}}>{st.label}</span>
                  {c.redeemed_at && <span style={{fontSize:11, color:C.textMid}}>Redeemed by {c.redeemed_email || "—"} · {fmtDate(c.redeemed_at)}</span>}
                  <span style={{flex:1}}/>
                  {!c.revoked_at && !c.redeemed_at && (
                    <button type="button" className="btn-pop" onClick={()=>revokeCode(c.code)} disabled={actingCode===c.code}
                      style={{fontSize:10.5, padding:"5px 10px", minHeight:28, borderRadius:8, border:`1px solid ${C.dangerMid}`, background:"transparent", color:C.danger, cursor:actingCode===c.code?"not-allowed":"pointer", fontWeight:600}}>
                      {actingCode===c.code ? "Revoking…" : "Revoke"}
                    </button>
                  )}
                  {c.revoked_at && !c.archived_at && (
                    <button type="button" className="btn-pop" onClick={()=>archiveCode(c.code)} disabled={actingCode===c.code}
                      style={{fontSize:10.5, padding:"5px 10px", minHeight:28, borderRadius:8, border:`1px solid ${C.border}`, background:"transparent", color:C.textMid, cursor:actingCode===c.code?"not-allowed":"pointer", fontWeight:600}}>
                      {actingCode===c.code ? "Archiving…" : "Archive"}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )
      }
    </Modal>
  );
}

// Members sort options — default matches the section's original fixed
// behavior (joined/created_at, descending). "Not-yet-joined first" is a
// one-way grouping (reversing it would defeat the point of the option — it
// exists to surface people who need a nudge), so it opts out of the
// direction toggle like the invite-codes Status sort does.
const MEMBER_SORT_OPTIONS = [
  {key:"created_at", label:"Joined date", defaultDir:"desc"},
  {key:"name", label:"Name/email (A–Z)", defaultDir:"asc"},
  {key:"not_joined", label:"Not-yet-joined first", defaultDir:"desc"},
];
function cmpMembers(a, b, sortBy, dir) {
  const m = dir === "asc" ? 1 : -1;
  switch (sortBy) {
    case "name": {
      const an = (a.name || a.email || "").toLowerCase(), bn = (b.name || b.email || "").toLowerCase();
      return an.localeCompare(bn) * (dir === "asc" ? 1 : -1);
    }
    case "not_joined": {
      const aj = a.joined ? 1 : 0, bj = b.joined ? 1 : 0;
      // Default (desc): not-joined first. "asc" reverses to joined-first.
      if (aj !== bj) return (bj - aj) * m;
      return new Date(b.created_at || 0) - new Date(a.created_at || 0);
    }
    case "created_at":
    default: return (new Date(a.created_at || 0) - new Date(b.created_at || 0)) * m;
  }
}

// ── 2. Members ────────────────────────────────────────────────────────────────
function MembersSection({members, callerEmail, onChanged}) {
  const [grantEmail, setGrantEmail] = useState("");
  const [grantNote, setGrantNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useFlashMsg();
  const [revokeEmail, setRevokeEmail] = useState(null);
  const [editingNote, setEditingNote] = useState(null); // email currently being edited
  const [noteText, setNoteText] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [sortBy, setSortBy] = useState("created_at");
  const [sortDir, setSortDir] = useState("desc");
  const changeSort = (key) => { setSortBy(key); setSortDir(MEMBER_SORT_OPTIONS.find(o=>o.key===key)?.defaultDir || "desc"); };

  const canGrant = grantEmail.trim() && !busy;

  const grant = async () => {
    setBusy(true); setMsg(null);
    const res = await adminCall('grant_access', {email: grantEmail.trim(), note: grantNote.trim() || undefined});
    if (!res || res.ok === false || res.error) {
      setMsg({text: res?.error || "Couldn't grant access. Please try again.", tone:"error"});
    } else {
      setMsg({text: `Granted access to ${grantEmail.trim()}.`, tone:"success"});
      setGrantEmail(""); setGrantNote("");
      onChanged();
    }
    setBusy(false);
  };

  const saveNote = async (email) => {
    setSavingNote(true);
    const res = await adminCall('set_member_note', {email, note: noteText.trim() || null});
    if (res && res.ok !== false) { setEditingNote(null); onChanged(); }
    setSavingNote(false);
  };

  const sorted = [...members].sort((a,b)=> cmpMembers(a, b, sortBy, sortDir));

  return (
    <Card>
      <div style={{display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:12, flexWrap:"wrap"}}>
        <SectionTitle sub="Everyone with access to Marro. Revoke access to remove someone — you choose whether to keep or delete their data.">Members</SectionTitle>
        <SortBar idPrefix="member" value={sortBy} dir={sortDir} onChangeValue={changeSort}
          onToggleDir={()=>setSortDir(d=>d==="asc"?"desc":"asc")} options={MEMBER_SORT_OPTIONS}/>
      </div>

      <div style={{display:"flex", alignItems:"flex-end", gap:8, flexWrap:"wrap", marginBottom:14}}>
        <div style={{flex:1, minWidth:180}}>
          <label htmlFor="member-grant-email" style={{display:"block", fontSize:11, color:C.gray, marginBottom:4, fontWeight:500}}>Email</label>
          <input id="member-grant-email" type="email" placeholder="name@school.edu" value={grantEmail} onChange={e=>setGrantEmail(e.target.value)}
            style={{width:"100%", fontSize:13, border:`1px solid ${C.border}`, borderRadius:8, padding:"8px 10px", background:C.bg, color:C.text, boxSizing:"border-box", minHeight:44}}/>
        </div>
        <div style={{flex:1, minWidth:180}}>
          <label htmlFor="member-grant-note" style={{display:"block", fontSize:11, color:C.gray, marginBottom:4, fontWeight:500}}>Note (optional)</label>
          <input id="member-grant-note" type="text" placeholder="Why they're being let in" value={grantNote} onChange={e=>setGrantNote(e.target.value)}
            style={{width:"100%", fontSize:13, border:`1px solid ${C.border}`, borderRadius:8, padding:"8px 10px", background:C.bg, color:C.text, boxSizing:"border-box", minHeight:44}}/>
        </div>
        <button type="button" className="btn-fill" onClick={grant} disabled={!canGrant}
          style={{padding:"10px 18px", fontSize:13, fontWeight:600, border:"none", borderRadius:8, minHeight:44,
            background: canGrant ? C.teal : C.surface, color: canGrant ? C.bg : C.gray, cursor: canGrant ? "pointer" : "not-allowed"}}>
          {busy ? "Granting…" : "Grant access"}
        </button>
      </div>
      <InlineMsg text={msg?.text} tone={msg?.tone}/>

      <Divider/>

      {sorted.length === 0
        ? <EmptyState>No members yet.</EmptyState>
        : (
          <div className="av-scroll" style={{overflowX:"auto"}}>
            <table style={{width:"100%", borderCollapse:"collapse", fontSize:12}}>
              <thead>
                <tr>
                  <th scope="col" style={{textAlign:"left", padding:"6px 8px", color:C.gray, fontWeight:600, fontSize:11, borderBottom:`1px solid ${C.border}`}}>Member</th>
                  <th scope="col" style={{textAlign:"left", padding:"6px 8px", color:C.gray, fontWeight:600, fontSize:11, borderBottom:`1px solid ${C.border}`, width:150}}>Role</th>
                  <th scope="col" style={{textAlign:"left", padding:"6px 8px", color:C.gray, fontWeight:600, fontSize:11, borderBottom:`1px solid ${C.border}`, width:200}}>Note</th>
                  <th scope="col" style={{textAlign:"right", padding:"6px 8px", color:C.gray, fontWeight:600, fontSize:11, borderBottom:`1px solid ${C.border}`, width:130}}><span className="sr-only" style={{position:"absolute",width:1,height:1,overflow:"hidden",clip:"rect(0,0,0,0)"}}>Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {sorted.map(m=>(
                  <tr key={m.email}>
                    <td style={{padding:"8px", borderBottom:`1px solid ${C.border}`}}>
                      <div style={{display:"flex", alignItems:"center", gap:10, minWidth:0}}>
                        <Avatar avatar={m.avatar} name={m.name} email={m.email} size={32}/>
                        <div style={{minWidth:0}}>
                          <div style={{fontSize:13, fontWeight:600, color:C.text, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis"}}>{m.name || m.email}</div>
                          {m.name && <div style={{fontSize:11, color:C.gray, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis"}}>{m.email}</div>}
                        </div>
                      </div>
                    </td>
                    <td style={{padding:"8px", borderBottom:`1px solid ${C.border}`}}>
                      <span style={{display:"inline-flex", gap:4, flexWrap:"wrap"}}>
                        {m.is_admin && <span style={{fontSize:10, padding:"2px 9px", borderRadius:999, background:C.blueLight, color:C.blue, fontWeight:600, whiteSpace:"nowrap"}}>Admin</span>}
                        {m.is_ambassador && <span style={{fontSize:10, padding:"2px 9px", borderRadius:999, background:C.amberLight, color:C.amber, fontWeight:600, whiteSpace:"nowrap"}}>Ambassador</span>}
                        {!m.joined && <span style={{fontSize:10, padding:"2px 9px", borderRadius:999, background:C.surface, color:C.textMid, fontWeight:600, whiteSpace:"nowrap"}}>Not joined</span>}
                      </span>
                    </td>
                    <td style={{padding:"8px", borderBottom:`1px solid ${C.border}`}}>
                      {editingNote === m.email ? (
                        <div style={{display:"flex", gap:4, alignItems:"center"}}>
                          <label htmlFor={`member-note-${m.email}`} style={{position:"absolute", width:1, height:1, overflow:"hidden", clip:"rect(0,0,0,0)"}}>Note for {m.email}</label>
                          <input id={`member-note-${m.email}`} autoFocus value={noteText} onChange={e=>setNoteText(e.target.value)} placeholder="Note"
                            onKeyDown={e=>{ if(e.key==="Enter" && !savingNote){ e.preventDefault(); saveNote(m.email); } }}
                            style={{flex:1, minWidth:0, fontSize:12, border:`1px solid ${C.sel}`, borderRadius:6, padding:"5px 8px", background:C.selBg, color:C.text}}/>
                          <button type="button" className="txt-act" disabled={savingNote} onClick={()=>saveNote(m.email)} style={{border:"none", background:"transparent", color:C.teal, fontSize:11, fontWeight:600, cursor:"pointer"}}>Save</button>
                          <button type="button" className="xbtn" aria-label="Cancel editing note" onClick={()=>setEditingNote(null)} style={{border:"none", background:"transparent", color:C.gray, fontSize:11, cursor:"pointer"}}>✕</button>
                        </div>
                      ) : (
                        <button type="button" className="txt-act" onClick={()=>{ setEditingNote(m.email); setNoteText(m.note || ""); }}
                          style={{border:"none", background:"transparent", padding:0, cursor:"pointer", textAlign:"left", fontSize:11.5, color: m.note ? C.textMid : C.gray, fontStyle: m.note ? "normal" : "italic"}}>
                          {m.note || "Add note"}
                        </button>
                      )}
                    </td>
                    <td style={{padding:"8px", borderBottom:`1px solid ${C.border}`, textAlign:"right"}}>
                      {(!callerEmail || m.email !== callerEmail) && (
                        <button type="button" className="btn-pop" onClick={()=>setRevokeEmail(m.email)}
                          style={{fontSize:11, padding:"6px 12px", minHeight:32, borderRadius:8, border:`1px solid ${C.dangerMid}`, background:"transparent", color:C.danger, cursor:"pointer", fontWeight:600, whiteSpace:"nowrap"}}>
                          Revoke access
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      }

      {revokeEmail && (
        <RevokeAccessModal key={revokeEmail} email={revokeEmail} onClose={()=>setRevokeEmail(null)}
          onDone={()=>{ setRevokeEmail(null); onChanged(); }}/>
      )}
    </Card>
  );
}

// Invite-codes sort options — default matches the section's original fixed
// behavior (created_at, descending = "Newest first"). "Newest/Oldest first"
// is expressed as one field (Date created) with the shared asc/desc toggle
// rather than two separate menu entries, per the reusable-toggle allowance.
// Status is a grouping sort (Unused → Used → Revoked → Archived), which
// doesn't have a meaningful reverse, so it opts out of the toggle — same
// judgment as the Members "Not-yet-joined first" option.
const CODE_SORT_OPTIONS = [
  {key:"created_at", label:"Date created", defaultDir:"desc"},
  {key:"status", label:"Status", defaultDir:"desc"},
  {key:"owner", label:"Owner (A–Z)", defaultDir:"asc"},
];
const CODE_STATUS_RANK = {Unused:0, Used:1, Revoked:2, Archived:3};
function cmpCodes(a, b, sortBy, dir) {
  const m = dir === "asc" ? 1 : -1;
  switch (sortBy) {
    case "status": {
      const ra = CODE_STATUS_RANK[codeStatus(a).label] ?? 0;
      const rb = CODE_STATUS_RANK[codeStatus(b).label] ?? 0;
      // Default (desc): Unused → Used → Revoked → Archived. "asc" reverses the
      // whole group order (Archived → Revoked → Used → Unused) rather than
      // being disabled — a plain grouping still has a meaningful reverse.
      if (ra !== rb) return (ra - rb) * (dir === "asc" ? -1 : 1);
      return new Date(b.created_at) - new Date(a.created_at);
    }
    case "owner": {
      const ao = (a.owner_email || a.owner_id || "").toLowerCase(), bo = (b.owner_email || b.owner_id || "").toLowerCase();
      return ao.localeCompare(bo) * (dir === "asc" ? 1 : -1);
    }
    case "created_at":
    default: return (new Date(a.created_at) - new Date(b.created_at)) * m;
  }
}

// ── 3. Invite codes ──────────────────────────────────────────────────────────
function InviteCodesSection({codes, onChanged}) {
  const [count, setCount] = useState("5");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useFlashMsg(); // {text, tone}
  const [revokingCode, setRevokingCode] = useState(null);
  const [archivingCode, setArchivingCode] = useState(null);
  const [showArchived, setShowArchived] = useState(false);
  const [sortBy, setSortBy] = useState("created_at");
  const [sortDir, setSortDir] = useState("desc");
  const changeSort = (key) => { setSortBy(key); setSortDir(CODE_SORT_OPTIONS.find(o=>o.key===key)?.defaultDir || "desc"); };

  // canGenerate must check the RAW parsed value, not a pre-clamped one — clamping
  // first (e.g. min(100, 1000) -> 100) made the button stay enabled and silently
  // mint far fewer codes than typed, with the "Generate N codes" label the only
  // (easy-to-miss) hint anything was capped. Now an out-of-range count just
  // disables the button and the caption below explains why.
  const raw = parseInt(count, 10);
  const n = Math.max(1, Math.min(100, raw || 0));
  const canGenerate = /^\d+$/.test(count.trim()) && raw >= 1 && raw <= 100 && !busy;

  const generate = async () => {
    setBusy(true); setMsg(null);
    const res = await adminCall('generate_codes', {count: n});
    if (!res || res.ok === false || res.error) {
      setMsg({text: res?.error || "Couldn't generate codes. Please try again.", tone:"error"});
    } else {
      setMsg({text: `Generated ${res.codes?.length || n} code${(res.codes?.length||n)===1?"":"s"}.`, tone:"success"});
      onChanged();
    }
    setBusy(false);
  };

  const revoke = async (code) => {
    setRevokingCode(code); setMsg(null);
    const res = await adminCall('revoke_code', {code});
    if (!res || res.ok === false || res.error) {
      setMsg({text: res?.error || "Couldn't revoke that code. Please try again.", tone:"error"});
    } else if (!res.revoked) {
      setMsg({text: "That code is already used or revoked.", tone:"error"});
    } else {
      onChanged();
    }
    setRevokingCode(null);
  };

  const archive = async (code) => {
    setArchivingCode(code); setMsg(null);
    const res = await adminCall('archive_code', {code});
    if (!res || res.ok === false || res.error) {
      setMsg({text: res?.error || "Couldn't archive that code. Please try again.", tone:"error"});
    } else {
      onChanged();
    }
    setArchivingCode(null);
  };

  const archivedCount = codes.filter(c=>c.archived_at).length;
  const visible = showArchived ? codes : codes.filter(c=>!c.archived_at);
  const sorted = [...visible].sort((a,b)=> cmpCodes(a, b, sortBy, sortDir));

  return (
    <Card>
      <div style={{display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:12, flexWrap:"wrap"}}>
        <SectionTitle sub="Mint invite codes and keep track of who's used them.">Invite codes</SectionTitle>
        <SortBar idPrefix="codes" value={sortBy} dir={sortDir} onChangeValue={changeSort}
          onToggleDir={()=>setSortDir(d=>d==="asc"?"desc":"asc")} options={CODE_SORT_OPTIONS}/>
      </div>

      <div style={{marginBottom:14}}>
        {/* Caption sits BELOW the row (not inside the input's own column) so
            adding it doesn't grow that column's height and throw off the
            flex-end alignment between the input box and the button next to it. */}
        <div style={{display:"flex", alignItems:"flex-end", gap:8, flexWrap:"wrap"}}>
          <div>
            <label htmlFor="admin-gen-count" style={{display:"block", fontSize:11, color:C.gray, marginBottom:4, fontWeight:500}}>Number of codes</label>
            <input id="admin-gen-count" type="number" inputMode="numeric" min={1} max={100} value={count}
              aria-describedby="admin-gen-count-hint"
              onChange={e=>setCount(e.target.value)}
              style={{width:90, fontSize:13, border:`1px solid ${raw>100 ? C.dangerMid : C.border}`, borderRadius:8, padding:"8px 10px", background:C.bg, color:C.text, boxSizing:"border-box", minHeight:44}}/>
          </div>
          <button type="button" className="btn-fill" onClick={generate} disabled={!canGenerate}
            style={{padding:"10px 18px", fontSize:13, fontWeight:600, border:"none", borderRadius:8, minHeight:44,
              background: canGenerate ? C.teal : C.surface, color: canGenerate ? C.bg : C.gray, cursor: canGenerate ? "pointer" : "not-allowed"}}>
            {busy ? "Generating…" : `Generate ${n||""} code${n===1?"":"s"}`}
          </button>
        </div>
        <div id="admin-gen-count-hint" style={{fontSize:10.5, color: raw>100 ? C.danger : C.gray, marginTop:6}}>
          {raw>100 ? "Max 100 per batch." : "Up to 100 per batch."}
        </div>
      </div>
      <InlineMsg text={msg?.text} tone={msg?.tone}/>

      <Divider/>

      {archivedCount > 0 && (
        <button type="button" className="txt-act" onClick={()=>setShowArchived(s=>!s)}
          style={{border:"none", background:"transparent", padding:"0 0 10px", cursor:"pointer", fontSize:12, fontWeight:600, color:C.teal, display:"block"}}>
          {showArchived ? "Hide archived" : `Show archived (${archivedCount})`}
        </button>
      )}

      {sorted.length === 0
        ? <EmptyState>No invite codes yet — generate your first batch above.</EmptyState>
        : (
          <div className="av-scroll" style={{overflowX:"auto"}}>
            <table style={{width:"100%", borderCollapse:"collapse", fontSize:12}}>
              <thead>
                <tr>
                  <th scope="col" style={{textAlign:"left", padding:"6px 8px", color:C.gray, fontWeight:600, fontSize:11, borderBottom:`1px solid ${C.border}`}}>Code</th>
                  <th scope="col" style={{textAlign:"left", padding:"6px 8px", color:C.gray, fontWeight:600, fontSize:11, borderBottom:`1px solid ${C.border}`}}>Status</th>
                  <th scope="col" style={{textAlign:"left", padding:"6px 8px", color:C.gray, fontWeight:600, fontSize:11, borderBottom:`1px solid ${C.border}`}}>Owner</th>
                  <th scope="col" style={{textAlign:"left", padding:"6px 8px", color:C.gray, fontWeight:600, fontSize:11, borderBottom:`1px solid ${C.border}`}}>Redeemed by</th>
                  <th scope="col" style={{textAlign:"left", padding:"6px 8px", color:C.gray, fontWeight:600, fontSize:11, borderBottom:`1px solid ${C.border}`}}>Created</th>
                  <th scope="col" style={{textAlign:"left", padding:"6px 8px", color:C.gray, fontWeight:600, fontSize:11, borderBottom:`1px solid ${C.border}`}}><span className="sr-only" style={{position:"absolute",width:1,height:1,overflow:"hidden",clip:"rect(0,0,0,0)"}}>Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {sorted.map(c=>{
                  const st = codeStatus(c);
                  return (
                    <tr key={c.code}>
                      <td style={{padding:"8px", borderBottom:`1px solid ${C.border}`, whiteSpace:"nowrap"}}>
                        <span style={{display:"inline-flex", alignItems:"center", gap:4, fontFamily:"monospace", color:C.text, fontWeight:600}}>
                          {c.code}
                          <CopyBtn value={c.code}/>
                        </span>
                        {c.bound_email && <div style={{fontSize:10.5, color:C.gray, marginTop:2}}>for {c.bound_email}</div>}
                      </td>
                      <td style={{padding:"8px", borderBottom:`1px solid ${C.border}`}}>
                        <span style={{display:"inline-flex", gap:4, alignItems:"center", flexWrap:"wrap"}}>
                          <span style={{fontSize:10, padding:"2px 9px", borderRadius:999, background:st.bg, color:st.color, fontWeight:600, whiteSpace:"nowrap"}}>{st.label}</span>
                          {c.issued_by_admin && <span style={{fontSize:10, padding:"2px 9px", borderRadius:999, background:C.surface, color:C.textMid, fontWeight:600, whiteSpace:"nowrap"}}>Admin-issued</span>}
                        </span>
                      </td>
                      <td style={{padding:"8px", borderBottom:`1px solid ${C.border}`, color:C.textMid}} title={c.owner_email || c.owner_id || ""}>{c.owner_email || truncId(c.owner_id)}</td>
                      <td style={{padding:"8px", borderBottom:`1px solid ${C.border}`, color:C.textMid}}>{c.redeemed_email || "—"}</td>
                      <td style={{padding:"8px", borderBottom:`1px solid ${C.border}`, color:C.textMid, whiteSpace:"nowrap"}}>{fmtDate(c.created_at)}</td>
                      <td style={{padding:"8px", borderBottom:`1px solid ${C.border}`, textAlign:"right"}}>
                        <div style={{display:"inline-flex", gap:6}}>
                          {!c.revoked_at && !c.redeemed_at && (
                            <button type="button" className="btn-pop" onClick={()=>revoke(c.code)} disabled={revokingCode===c.code}
                              style={{fontSize:11, padding:"6px 12px", minHeight:32, borderRadius:8, border:`1px solid ${C.dangerMid}`, background:"transparent", color:C.danger, cursor: revokingCode===c.code ? "not-allowed" : "pointer", fontWeight:600}}>
                              {revokingCode===c.code ? "Revoking…" : "Revoke"}
                            </button>
                          )}
                          {c.revoked_at && !c.archived_at && (
                            <button type="button" className="btn-pop" onClick={()=>archive(c.code)} disabled={archivingCode===c.code}
                              style={{fontSize:11, padding:"6px 12px", minHeight:32, borderRadius:8, border:`1px solid ${C.border}`, background:"transparent", color:C.textMid, cursor: archivingCode===c.code ? "not-allowed" : "pointer", fontWeight:600}}>
                              {archivingCode===c.code ? "Archiving…" : "Archive"}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      }
    </Card>
  );
}

// Waitlist sort options — default matches the section's original fixed
// behavior (created_at, descending = "Newest first"); toggle flips to
// "Oldest first". Waitlist rows carry no name field, so "Name/email (A–Z)"
// sorts on email.
const WAITLIST_SORT_OPTIONS = [
  {key:"created_at", label:"Date added", defaultDir:"desc"},
  {key:"invite_count", label:"Most re-invited", defaultDir:"desc"},
  {key:"name", label:"Name/email (A–Z)", defaultDir:"asc"},
];
function cmpWaitlist(a, b, sortBy, dir) {
  const m = dir === "asc" ? 1 : -1;
  switch (sortBy) {
    case "invite_count": return ((a.invite_count || 0) - (b.invite_count || 0)) * m;
    case "name": return (a.email || "").toLowerCase().localeCompare((b.email || "").toLowerCase()) * (dir === "asc" ? 1 : -1);
    case "created_at":
    default: return (new Date(a.created_at) - new Date(b.created_at)) * m;
  }
}

// ── 4. Waitlist ───────────────────────────────────────────────────────────────
function WaitlistSection({waitlist, onChanged}) {
  const [busyEmail, setBusyEmail] = useState(null);
  const [rowMsg, setRowMsg] = useState({}); // email -> {text, tone}
  const timers = useRef({});
  const [sortBy, setSortBy] = useState("created_at");
  const [sortDir, setSortDir] = useState("desc");
  const changeSort = (key) => { setSortBy(key); setSortDir(WAITLIST_SORT_OPTIONS.find(o=>o.key===key)?.defaultDir || "desc"); };

  // Set a per-row message; success-toned ones auto-clear after a few seconds
  // (errors persist). Any pending timer for that row is cleared first so they
  // never stack or fire after the message was replaced.
  const setRow = (email, m) => {
    if (timers.current[email]) { clearTimeout(timers.current[email]); delete timers.current[email]; }
    setRowMsg(prev=>({...prev, [email]: m}));
    if (m && m.tone === "success") {
      timers.current[email] = setTimeout(()=>{ setRowMsg(p=>({...p, [email]: null})); delete timers.current[email]; }, 3500);
    }
  };
  useEffect(()=>()=>{ Object.values(timers.current).forEach(clearTimeout); }, []);

  const invite = async (email) => {
    setBusyEmail(email);
    setRow(email, null);
    const res = await adminCall('invite_from_waitlist', {email});
    if (!res || res.ok === false || res.error) {
      setRow(email, {text: res?.error || "Couldn't send an invite. Please try again.", tone:"error"});
    } else if (res.emailed === false) {
      setRow(email, {text: `Code minted but the email failed to send — share this code manually: ${res.code}`, tone:"error"});
      onChanged();
    } else if (res.reinvite) {
      setRow(email, {text: "Re-invited — a new code was emailed to them (their old code was revoked).", tone:"success"});
      onChanged();
    } else {
      setRow(email, {text: "Invited — the code was emailed to them.", tone:"success"});
      onChanged();
    }
    setBusyEmail(null);
  };

  const remove = async (email) => {
    if (!window.confirm(`Remove ${email} from the waitlist?`)) return;
    setBusyEmail(email);
    setRow(email, null);
    const res = await adminCall('remove_from_waitlist', {email});
    if (!res || res.ok === false || res.error) {
      setRow(email, {text: res?.error || "Couldn't remove them. Please try again.", tone:"error"});
    } else {
      onChanged();
    }
    setBusyEmail(null);
  };

  // Compact invite history: "Invited Jul 8" for a single send, or
  // "First invited Jul 8 · Re-invited 2× · Last: Jul 9" once re-invited.
  const inviteHistory = (w) => {
    const count = w.invite_count || 0;
    if (count <= 0) return null;
    if (count === 1) return `Invited ${fmtDate(w.invited_at)}`;
    const parts = [`First invited ${fmtDate(w.invited_at)}`, `Re-invited ${count-1}×`];
    if (w.last_invited_at) parts.push(`Last: ${fmtDate(w.last_invited_at)}`);
    return parts.join(" · ");
  };

  const sorted = [...waitlist].sort((a,b)=> cmpWaitlist(a, b, sortBy, sortDir));
  return (
    <Card>
      <div style={{display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:12, flexWrap:"wrap"}}>
        <SectionTitle sub="People waiting for an invite.">Waitlist · {waitlist.length}</SectionTitle>
        <SortBar idPrefix="waitlist" value={sortBy} dir={sortDir} onChangeValue={changeSort}
          onToggleDir={()=>setSortDir(d=>d==="asc"?"desc":"asc")} options={WAITLIST_SORT_OPTIONS}/>
      </div>
      {sorted.length === 0
        ? <EmptyState>No one&apos;s on the waitlist right now.</EmptyState>
        : sorted.map((w,i)=>(
          <div key={w.user_id || w.email + i} style={{display:"flex", flexDirection:"column", gap:4, padding:"9px 0", borderBottom: i<sorted.length-1 ? `1px solid ${C.border}` : "none"}}>
            <div style={{display:"flex", justifyContent:"space-between", gap:10, alignItems:"center", flexWrap:"wrap"}}>
              <span style={{fontSize:13, color:C.text, fontWeight:600}}>{w.email}</span>
              <div style={{display:"flex", alignItems:"center", gap:8, flexWrap:"wrap"}}>
                {(w.invite_count > 0 || w.invited_at) && <span style={{fontSize:10, padding:"2px 9px", borderRadius:999, background:C.blueLight, color:C.blue, fontWeight:600, whiteSpace:"nowrap"}}>Invited</span>}
                <span style={{color:C.gray, fontWeight:400, fontSize:11, whiteSpace:"nowrap"}}>{fmtDate(w.created_at)}</span>
                <button type="button" className="btn-pop" onClick={()=>invite(w.email)} disabled={busyEmail===w.email}
                  style={{fontSize:11, padding:"6px 12px", minHeight:32, borderRadius:8, border:`1px solid ${C.border}`, background:"transparent", color:C.text, cursor: busyEmail===w.email ? "not-allowed" : "pointer", fontWeight:600}}>
                  {busyEmail===w.email ? "Working…" : ((w.invite_count > 0 || w.invited_at) ? "Invite again" : "Invite")}
                </button>
                <button type="button" className="btn-pop" onClick={()=>remove(w.email)} disabled={busyEmail===w.email}
                  style={{fontSize:11, padding:"6px 12px", minHeight:32, borderRadius:8, border:`1px solid ${C.dangerMid}`, background:"transparent", color:C.danger, cursor: busyEmail===w.email ? "not-allowed" : "pointer", fontWeight:600}}>
                  Remove
                </button>
              </div>
            </div>
            {inviteHistory(w) && <div style={{fontSize:11, color:C.gray}}>{inviteHistory(w)}</div>}
            {w.reason && <div style={{fontSize:12, color:C.textMid}}>{w.reason}</div>}
            <InlineMsg text={rowMsg[w.email]?.text} tone={rowMsg[w.email]?.tone}/>
          </div>
        ))
      }
    </Card>
  );
}

// Admins sort options — default matches the section's original fixed
// behavior (created_at, ascending = "Oldest first").
const ADMIN_SORT_OPTIONS = [
  {key:"created_at", label:"Date added", defaultDir:"asc"},
  {key:"name", label:"Name/email (A–Z)", defaultDir:"asc"},
];
function cmpAdmins(a, b, sortBy, dir) {
  const m = dir === "asc" ? 1 : -1;
  switch (sortBy) {
    case "name": return (a.email || "").toLowerCase().localeCompare((b.email || "").toLowerCase()) * (dir === "asc" ? 1 : -1);
    case "created_at":
    default: return (new Date(a.created_at) - new Date(b.created_at)) * m;
  }
}

// ── 5. Admins ─────────────────────────────────────────────────────────────────
function AdminsSection({admins, onChanged}) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useFlashMsg();
  const [removingEmail, setRemovingEmail] = useState(null);
  const [sortBy, setSortBy] = useState("created_at");
  const [sortDir, setSortDir] = useState("asc");
  const changeSort = (key) => { setSortBy(key); setSortDir(ADMIN_SORT_OPTIONS.find(o=>o.key===key)?.defaultDir || "asc"); };

  const canAdd = email.trim() && !busy;

  const add = async () => {
    setBusy(true); setMsg(null);
    const res = await adminCall('add_admin', {email: email.trim()});
    if (!res || res.ok === false || res.error) {
      setMsg({text: res?.error || "Couldn't add that admin. Please try again.", tone:"error"});
    } else {
      setMsg({text: `Added ${email.trim()} as an admin.`, tone:"success"});
      setEmail("");
      onChanged();
    }
    setBusy(false);
  };

  const remove = async (adminEmail) => {
    setRemovingEmail(adminEmail); setMsg(null);
    const res = await adminCall('remove_admin', {email: adminEmail});
    if (!res || res.ok === false || res.error) {
      // Backend returns a friendly 400 if you try to remove yourself — surface it as-is.
      setMsg({text: res?.error || "Couldn't remove that admin. Please try again.", tone:"error"});
    } else {
      onChanged();
    }
    setRemovingEmail(null);
  };

  const sorted = [...admins].sort((a,b)=> cmpAdmins(a, b, sortBy, sortDir));

  return (
    <Card>
      <div style={{display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:12, flexWrap:"wrap"}}>
        <SectionTitle sub="Grant console access to other accounts.">Admins</SectionTitle>
        <SortBar idPrefix="admins" value={sortBy} dir={sortDir} onChangeValue={changeSort}
          onToggleDir={()=>setSortDir(d=>d==="asc"?"desc":"asc")} options={ADMIN_SORT_OPTIONS}/>
      </div>

      <div style={{display:"flex", alignItems:"flex-end", gap:8, flexWrap:"wrap", marginBottom:14}}>
        <div style={{flex:1, minWidth:200}}>
          <label htmlFor="admin-add-email" style={{display:"block", fontSize:11, color:C.gray, marginBottom:4, fontWeight:500}}>Email</label>
          <input id="admin-add-email" type="email" placeholder="name@school.edu" value={email} onChange={e=>setEmail(e.target.value)}
            style={{width:"100%", fontSize:13, border:`1px solid ${C.border}`, borderRadius:8, padding:"8px 10px", background:C.bg, color:C.text, boxSizing:"border-box", minHeight:44}}/>
        </div>
        <button type="button" className="btn-fill" onClick={add} disabled={!canAdd}
          style={{padding:"10px 18px", fontSize:13, fontWeight:600, border:"none", borderRadius:8, minHeight:44,
            background: canAdd ? C.teal : C.surface, color: canAdd ? C.bg : C.gray, cursor: canAdd ? "pointer" : "not-allowed"}}>
          {busy ? "Adding…" : "Add admin"}
        </button>
      </div>
      <InlineMsg text={msg?.text} tone={msg?.tone}/>

      <Divider/>

      {sorted.length === 0
        ? <EmptyState>No admins yet.</EmptyState>
        : sorted.map((a,i)=>(
          <div key={a.email} style={{display:"flex", alignItems:"center", justifyContent:"space-between", gap:10, padding:"8px 0", borderBottom: i<sorted.length-1 ? `1px solid ${C.border}` : "none"}}>
            <div>
              <div style={{fontSize:13, color:C.text, fontWeight:600}}>{a.email}</div>
              <div style={{fontSize:11, color:C.gray}}>Added {fmtDate(a.created_at)}{a.added_by ? ` by ${a.added_by}` : ""}</div>
            </div>
            <button type="button" className="btn-pop" onClick={()=>remove(a.email)} disabled={removingEmail===a.email}
              style={{fontSize:11, padding:"6px 12px", minHeight:32, borderRadius:8, border:`1px solid ${C.dangerMid}`, background:"transparent", color:C.danger, cursor: removingEmail===a.email ? "not-allowed" : "pointer", fontWeight:600, flexShrink:0}}>
              {removingEmail===a.email ? "Removing…" : "Remove"}
            </button>
          </div>
        ))
      }
    </Card>
  );
}
