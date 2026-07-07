import React, { useEffect, useId, useState } from 'react';
import { redeemInviteCode, joinWaitlist, myWaitlist } from '../lib/data.js';
import { MarroLogo } from '../components/icons.jsx';

// Rendered when a session exists but the account isn't on the invite allow-list
// (App.jsx's `accessDenied` state — see App.jsx's gate effect). Two modes:
// code entry (default) and "join the waitlist", toggled by local state. Mirrors
// the visual shell of the previous dead-end invite-only screen (serif heading,
// centered column, `C` theme colors so it follows the app's light/dark toggle)
// but adds a real path forward instead of just "try again."
//
// Props: C (theme colors), onRedeemed() — called after a successful redeem so
// App.jsx can re-check isEmailAllowed() and boot straight into the app with no
// full page reload; onBack() — signs out and returns to the landing page.
export function InviteGate({ C, onRedeemed, onBack }){
  const [mode, setMode] = useState('code'); // 'code' | 'waitlist'
  const uid = useId();
  const codeId = `${uid}-code`;

  // ── Code entry ──────────────────────────────────────────────────────────────
  const [code, setCode] = useState('');
  const [redeeming, setRedeeming] = useState(false);
  const [redeemError, setRedeemError] = useState(null); // {kind:'used'|'generic'|'locked', text}

  const submitCode = async (e) => {
    e.preventDefault();
    const trimmed = code.trim().toUpperCase();
    if (!trimmed || redeeming) return;
    setRedeeming(true);
    setRedeemError(null);
    const { status } = await redeemInviteCode(trimmed);
    if (status === 'ok'){
      onRedeemed();
      return; // leave `redeeming` true — the view is about to change
    }
    if (status === 'already_used'){
      setRedeemError({ kind:'used', text:"That code's already been used. Ask whoever invited you for a fresh one." });
    } else if (status === 'locked'){
      setRedeemError({ kind:'locked', text:"Too many tries. Please wait a bit before trying again." });
    } else {
      // 'revoked' | 'invalid' | anything unexpected — stay generic on purpose.
      setRedeemError({ kind:'generic', text:"That code isn't valid. Double-check it and try again." });
    }
    setRedeeming(false);
  };

  // ── Waitlist ────────────────────────────────────────────────────────────────
  const [reason, setReason] = useState('');
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState(null);
  const [joined, setJoined] = useState(null); // null=unknown, {} row-ish once confirmed, false=not joined
  const reasonId = `${uid}-reason`;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const row = await myWaitlist();
      if (!cancelled) setJoined(row ? row : false);
    })();
    return () => { cancelled = true; };
  }, []);

  const submitWaitlist = async (e) => {
    e.preventDefault();
    if (joining) return;
    setJoining(true);
    setJoinError(null);
    const { ok } = await joinWaitlist(reason.trim());
    setJoining(false);
    if (ok) setJoined({ reason: reason.trim() || null });
    else setJoinError("Couldn't join the waitlist. Please try again.");
  };

  const inputStyle = {
    width:"100%", fontSize:14, padding:"10px 12px", borderRadius:10,
    border:`1px solid ${C.border}`, background:C.bg, color:C.text, boxSizing:"border-box",
  };
  const labelStyle = { display:"block", fontSize:12.5, fontWeight:600, color:C.sub, marginBottom:5, textAlign:"left" };

  return (
    <main style={{position:"fixed",inset:0,display:"flex",alignItems:"center",justifyContent:"center",background:"transparent",color:C.text,padding:24,overflowY:"auto"}}>
      <div style={{maxWidth:400,width:"100%",textAlign:"center",display:"flex",flexDirection:"column",alignItems:"center"}}>
        <div style={{marginBottom:20}}><MarroLogo size={64}/></div>

        {mode === 'code' ? (
          <>
            <h1 style={{fontSize:22,fontWeight:600,margin:"0 0 10px",letterSpacing:"-0.02em",fontFamily:"'Newsreader', Georgia, serif"}}>
              Marro is invite-only<span style={{color:C.marigold}}>.</span>
            </h1>
            <p style={{fontSize:14,color:C.sub,lineHeight:1.5,margin:"0 0 24px"}}>
              Enter your invite code to get in — or join the waitlist if you don&apos;t have one yet.
            </p>

            <form onSubmit={submitCode} style={{width:"100%",textAlign:"left"}} noValidate>
              <label htmlFor={codeId} style={labelStyle}>Invite code</label>
              <input
                id={codeId}
                value={code}
                onChange={e=>setCode(e.target.value.toUpperCase().replace(/\s/g,''))}
                inputMode="text"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                maxLength={8}
                placeholder="ABCD1234"
                disabled={redeeming}
                aria-invalid={redeemError ? 'true' : undefined}
                style={{...inputStyle, letterSpacing:"0.08em", fontWeight:600, textAlign:"center", marginBottom:14}}
              />

              {redeemError && (
                <div role="alert" style={{marginBottom:14,padding:"10px 12px",borderRadius:10,background:C.dangerLight,border:`1px solid ${C.dangerMid}`,color:C.danger,fontSize:13,lineHeight:1.4}}>
                  {redeemError.text}
                </div>
              )}

              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:12}}>
                <button type="button" className="txt-act" onClick={onBack} style={{border:"none",background:"transparent",color:C.sub,fontSize:13,cursor:"pointer",padding:"10px 4px",minHeight:44}}>
                  Back to sign in
                </button>
                <button type="submit" className="btn-fill" disabled={!code.trim() || redeeming} aria-busy={redeeming}
                  style={{padding:"10px 24px",fontSize:13,fontWeight:600,border:"none",borderRadius:8,background:C.teal,color:C.bg,cursor:(!code.trim()||redeeming)?"not-allowed":"pointer",minHeight:44,opacity:(!code.trim()||redeeming)?0.6:1}}>
                  {redeeming ? "Checking…" : "Redeem"}
                </button>
              </div>
            </form>

            <button type="button" className="txt-act" onClick={()=>setMode('waitlist')}
              style={{marginTop:22,border:"none",background:"transparent",color:C.teal,fontSize:13,fontWeight:600,cursor:"pointer",padding:"10px 4px",minHeight:44}}>
              Don&apos;t have a code? Join the waitlist
            </button>
          </>
        ) : (
          <>
            <h1 style={{fontSize:22,fontWeight:600,margin:"0 0 10px",letterSpacing:"-0.02em",fontFamily:"'Newsreader', Georgia, serif"}}>
              Join the waitlist<span style={{color:C.marigold}}>.</span>
            </h1>

            {joined ? (
              <>
                <p role="status" style={{fontSize:14,color:C.sub,lineHeight:1.5,margin:"0 0 24px"}}>
                  You&apos;re on the list — we&apos;ll email you when a spot opens.
                </p>
                <button type="button" className="txt-act" onClick={()=>setMode('code')}
                  style={{border:"none",background:"transparent",color:C.teal,fontSize:13,fontWeight:600,cursor:"pointer",padding:"10px 4px",minHeight:44}}>
                  Have an invite code instead?
                </button>
              </>
            ) : joined === false ? (
              <>
                <p style={{fontSize:14,color:C.sub,lineHeight:1.5,margin:"0 0 20px"}}>
                  We&apos;ll email you when a spot opens up.
                </p>
                <form onSubmit={submitWaitlist} style={{width:"100%",textAlign:"left"}} noValidate>
                  <label htmlFor={reasonId} style={labelStyle}>What brings you to Marro? (optional)</label>
                  <textarea
                    id={reasonId}
                    value={reason}
                    onChange={e=>setReason(e.target.value)}
                    rows={3}
                    disabled={joining}
                    placeholder="e.g. I'm a med student trying to plan my budget for the year"
                    style={{...inputStyle, resize:"vertical", fontFamily:"inherit", marginBottom:14}}
                  />

                  {joinError && <div role="alert" style={{marginBottom:14,padding:"10px 12px",borderRadius:10,background:C.dangerLight,border:`1px solid ${C.dangerMid}`,color:C.danger,fontSize:13,lineHeight:1.4}}>{joinError}</div>}

                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:12}}>
                    <button type="button" className="txt-act" onClick={()=>setMode('code')} style={{border:"none",background:"transparent",color:C.sub,fontSize:13,cursor:"pointer",padding:"10px 4px",minHeight:44}}>
                      Back
                    </button>
                    <button type="submit" className="btn-fill" disabled={joining} aria-busy={joining}
                      style={{padding:"10px 24px",fontSize:13,fontWeight:600,border:"none",borderRadius:8,background:C.teal,color:C.bg,cursor:joining?"not-allowed":"pointer",minHeight:44,opacity:joining?0.6:1}}>
                      {joining ? "Joining…" : "Join the waitlist"}
                    </button>
                  </div>
                </form>
              </>
            ) : (
              <p role="status" style={{fontSize:14,color:C.sub,lineHeight:1.5,margin:0}}>Checking…</p>
            )}
          </>
        )}
      </div>
    </main>
  );
}
