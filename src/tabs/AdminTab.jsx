import { useEffect, useState, useCallback } from 'react';
import { C } from '../lib/theme.js';
import { Card, SectionTitle, EmptyState, Divider } from '../components/primitives.jsx';
import { adminCall } from '../lib/data.js';

// Admin console — invite codes, waitlist, ambassador/quota overrides, and the
// admin list itself. Visibility is gated by App.jsx (is_admin() client check);
// every action here is re-checked server-side by api/admin.js against the
// `admins` table using the caller's own bearer token, so this component never
// needs to guard — a non-admin request would just come back 403 from the
// backend and we'd show that as an inline error like any other failure.
//
// Data flow: one list_overview() fetch on mount populates all four sections;
// every mutation (generate/revoke/set_role/add_admin/remove_admin) re-fetches
// the overview afterward rather than hand-patching local state, so the console
// never drifts from the DB (this table is small — a few hundred rows tops —
// so a full refetch is cheap and simpler than reconciling diffs).
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
  if (c.revoked_at) return {label:"Revoked", color:C.danger, bg:C.dangerLight};
  if (c.redeemed_by) return {label:"Used", color:C.green, bg:C.greenLight};
  return {label:"Unused", color:C.blue, bg:C.blueLight};
}

// Small inline status/announcement line — mirrors the role="alert" pattern used
// across App.jsx/WeeklyTab.jsx for form errors, but also used here for success
// text (visually distinguished by color, always programmatically announced).
function InlineMsg({text, tone="error"}) {
  if (!text) return null;
  const color = tone === "error" ? C.danger : C.green;
  return <div role="alert" style={{fontSize:12, color, marginTop:8}}>{text}</div>;
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

export default function AdminTab(){
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [overview, setOverview] = useState({codes:[], waitlist:[], roles:[], admins:[]});

  const load = useCallback(async () => {
    setLoadError("");
    const res = await adminCall('list_overview');
    if (!res || res.ok === false || res.error) {
      setLoadError(res?.error || "Couldn't load the admin console. Please try again.");
    } else {
      setOverview({
        codes: res.codes||[], waitlist: res.waitlist||[],
        roles: res.roles||[], admins: res.admins||[],
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
            <InviteCodesSection codes={overview.codes} onChanged={load}/>
            <WaitlistSection waitlist={overview.waitlist}/>
            <QuotasSection roles={overview.roles} onChanged={load}/>
            <AdminsSection admins={overview.admins} onChanged={load}/>
          </>
      }
    </div>
  );
}

// ── 1. Invite codes ──────────────────────────────────────────────────────────
function InviteCodesSection({codes, onChanged}) {
  const [count, setCount] = useState("5");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null); // {text, tone}
  const [revokingCode, setRevokingCode] = useState(null);

  const n = Math.max(1, Math.min(100, parseInt(count, 10) || 0));
  const canGenerate = /^\d+$/.test(count.trim()) && n >= 1 && n <= 100 && !busy;

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

  const sorted = [...codes].sort((a,b)=> new Date(b.created_at) - new Date(a.created_at));

  return (
    <Card>
      <SectionTitle sub="Mint invite codes and keep track of who's used them.">Invite codes</SectionTitle>

      <div style={{display:"flex", alignItems:"flex-end", gap:8, flexWrap:"wrap", marginBottom:14}}>
        <div>
          <label htmlFor="admin-gen-count" style={{display:"block", fontSize:11, color:C.gray, marginBottom:4, fontWeight:500}}>Number of codes</label>
          <input id="admin-gen-count" type="number" inputMode="numeric" min={1} max={100} value={count}
            onChange={e=>setCount(e.target.value)}
            style={{width:90, fontSize:13, border:`1px solid ${C.border}`, borderRadius:8, padding:"8px 10px", background:C.bg, color:C.text, boxSizing:"border-box", minHeight:44}}/>
        </div>
        <button type="button" className="btn-fill" onClick={generate} disabled={!canGenerate}
          style={{padding:"10px 18px", fontSize:13, fontWeight:600, border:"none", borderRadius:8, minHeight:44,
            background: canGenerate ? C.teal : C.surface, color: canGenerate ? C.bg : C.gray, cursor: canGenerate ? "pointer" : "not-allowed"}}>
          {busy ? "Generating…" : `Generate ${n||""} code${n===1?"":"s"}`}
        </button>
      </div>
      <InlineMsg text={msg?.text} tone={msg?.tone}/>

      <Divider/>

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
                      </td>
                      <td style={{padding:"8px", borderBottom:`1px solid ${C.border}`}}>
                        <span style={{fontSize:10, padding:"2px 9px", borderRadius:999, background:st.bg, color:st.color, fontWeight:600, whiteSpace:"nowrap"}}>{st.label}</span>
                      </td>
                      <td style={{padding:"8px", borderBottom:`1px solid ${C.border}`, color:C.textMid}} title={c.owner_email || c.owner_id || ""}>{c.owner_email || truncId(c.owner_id)}</td>
                      <td style={{padding:"8px", borderBottom:`1px solid ${C.border}`, color:C.textMid}}>{c.redeemed_email || "—"}</td>
                      <td style={{padding:"8px", borderBottom:`1px solid ${C.border}`, color:C.textMid, whiteSpace:"nowrap"}}>{fmtDate(c.created_at)}</td>
                      <td style={{padding:"8px", borderBottom:`1px solid ${C.border}`, textAlign:"right"}}>
                        {!c.revoked_at && !c.redeemed_by && (
                          <button type="button" className="btn-pop" onClick={()=>revoke(c.code)} disabled={revokingCode===c.code}
                            style={{fontSize:11, padding:"6px 12px", minHeight:32, borderRadius:8, border:`1px solid ${C.dangerMid}`, background:"transparent", color:C.danger, cursor: revokingCode===c.code ? "not-allowed" : "pointer", fontWeight:600}}>
                            {revokingCode===c.code ? "Revoking…" : "Revoke"}
                          </button>
                        )}
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

// ── 2. Waitlist ───────────────────────────────────────────────────────────────
function WaitlistSection({waitlist}) {
  const sorted = [...waitlist].sort((a,b)=> new Date(b.created_at) - new Date(a.created_at));
  return (
    <Card>
      <SectionTitle sub="Read-only — people waiting for an invite.">Waitlist · {waitlist.length}</SectionTitle>
      {sorted.length === 0
        ? <EmptyState>No one&apos;s on the waitlist right now.</EmptyState>
        : sorted.map((w,i)=>(
          <div key={w.user_id || w.email + i} style={{display:"flex", flexDirection:"column", gap:2, padding:"9px 0", borderBottom: i<sorted.length-1 ? `1px solid ${C.border}` : "none"}}>
            <div style={{display:"flex", justifyContent:"space-between", gap:10, fontSize:13, color:C.text, fontWeight:600}}>
              <span>{w.email}</span>
              <span style={{color:C.gray, fontWeight:400, fontSize:11, whiteSpace:"nowrap"}}>{fmtDate(w.created_at)}</span>
            </div>
            {w.reason && <div style={{fontSize:12, color:C.textMid}}>{w.reason}</div>}
          </div>
        ))
      }
    </Card>
  );
}

// ── 3. Quotas & ambassadors ───────────────────────────────────────────────────
function QuotasSection({roles, onChanged}) {
  const [email, setEmail] = useState("");
  const [isAmbassador, setIsAmbassador] = useState(false);
  const [quota, setQuota] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const canSave = email.trim() && !busy;

  const save = async () => {
    setBusy(true); setMsg(null);
    const params = { email: email.trim(), is_ambassador: isAmbassador };
    if (quota.trim() === "") params.quota_override = null;
    else params.quota_override = parseInt(quota, 10);
    const res = await adminCall('set_role', params);
    if (!res || res.ok === false || res.error) {
      setMsg({text: res?.error || "Couldn't save that. Please try again.", tone:"error"});
    } else {
      setMsg({text: `Saved role for ${email.trim()}.`, tone:"success"});
      setEmail(""); setIsAmbassador(false); setQuota("");
      onChanged();
    }
    setBusy(false);
  };

  const sorted = [...roles].sort((a,b)=> new Date(b.updated_at) - new Date(a.updated_at));

  return (
    <Card>
      <SectionTitle sub="Grant ambassador status or override someone's code quota.">Quotas &amp; ambassadors</SectionTitle>

      <div style={{display:"flex", flexDirection:"column", gap:10, marginBottom:14}}>
        <div>
          <label htmlFor="admin-role-email" style={{display:"block", fontSize:11, color:C.gray, marginBottom:4, fontWeight:500}}>Email</label>
          <input id="admin-role-email" type="email" placeholder="name@school.edu" value={email} onChange={e=>setEmail(e.target.value)}
            style={{width:"100%", fontSize:13, border:`1px solid ${C.border}`, borderRadius:8, padding:"8px 10px", background:C.bg, color:C.text, boxSizing:"border-box", minHeight:44}}/>
        </div>
        <div style={{display:"flex", gap:10, alignItems:"flex-end", flexWrap:"wrap"}}>
          <button type="button" role="switch" aria-checked={isAmbassador} onClick={()=>setIsAmbassador(v=>!v)}
            style={{display:"inline-flex", alignItems:"center", gap:8, padding:"8px 12px", minHeight:44, borderRadius:8, border:`1px solid ${isAmbassador?C.sel:C.border}`, background: isAmbassador ? C.selBg : "transparent", color:C.text, cursor:"pointer", fontSize:13}}>
            <span aria-hidden="true" style={{width:32, height:18, borderRadius:9, background: isAmbassador ? C.teal : C.surfaceMid, position:"relative", transition:"background .15s", flexShrink:0}}>
              <span style={{position:"absolute", top:2, left: isAmbassador ? 16 : 2, width:14, height:14, borderRadius:7, background:C.bg, transition:"left .15s"}}/>
            </span>
            Ambassador
          </button>
          <div>
            <label htmlFor="admin-quota" style={{display:"block", fontSize:11, color:C.gray, marginBottom:4, fontWeight:500}}>Quota override (blank = default)</label>
            <input id="admin-quota" type="number" inputMode="numeric" min={0} placeholder="Default" value={quota} onChange={e=>setQuota(e.target.value)}
              style={{width:120, fontSize:13, border:`1px solid ${C.border}`, borderRadius:8, padding:"8px 10px", background:C.bg, color:C.text, boxSizing:"border-box", minHeight:44}}/>
          </div>
          <button type="button" className="btn-fill" onClick={save} disabled={!canSave}
            style={{padding:"10px 18px", fontSize:13, fontWeight:600, border:"none", borderRadius:8, minHeight:44,
              background: canSave ? C.teal : C.surface, color: canSave ? C.bg : C.gray, cursor: canSave ? "pointer" : "not-allowed"}}>
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
      <InlineMsg text={msg?.text} tone={msg?.tone}/>

      <Divider/>

      {sorted.length === 0
        ? <EmptyState>No custom roles yet — everyone&apos;s on the default quota.</EmptyState>
        : sorted.map((r,i)=>(
          <div key={r.email} style={{display:"flex", alignItems:"center", justifyContent:"space-between", gap:10, padding:"8px 0", borderBottom: i<sorted.length-1 ? `1px solid ${C.border}` : "none"}}>
            <span style={{fontSize:13, color:C.text}}>{r.email}</span>
            <div style={{display:"flex", gap:8, alignItems:"center", flexShrink:0}}>
              {r.is_ambassador && <span style={{fontSize:10, padding:"2px 9px", borderRadius:999, background:C.blueLight, color:C.blue, fontWeight:600}}>Ambassador</span>}
              {r.quota_override != null && <span style={{fontSize:10, padding:"2px 9px", borderRadius:999, background:C.amberLight, color:C.amber, fontWeight:600}}>Quota {r.quota_override}</span>}
            </div>
          </div>
        ))
      }
    </Card>
  );
}

// ── 4. Admins ─────────────────────────────────────────────────────────────────
function AdminsSection({admins, onChanged}) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [removingEmail, setRemovingEmail] = useState(null);

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

  const sorted = [...admins].sort((a,b)=> new Date(a.created_at) - new Date(b.created_at));

  return (
    <Card>
      <SectionTitle sub="Grant console access to other accounts.">Admins</SectionTitle>

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
