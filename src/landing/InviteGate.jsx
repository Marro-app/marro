import React, { useEffect, useId, useState } from 'react';
import { redeemInviteCode, joinWaitlist, myWaitlist } from '../lib/data.js';
import { MarroLogo } from '../components/icons.jsx';

// Rendered when a session exists but the account isn't on the invite allow-list
// (App.jsx's `accessDenied` state). Two modes — code entry (default) and "join
// the waitlist" — laid out in a single glass card so the screen reads as the
// same family as the login modal the user just came from (continuity), rather
// than as loose floating text. Uses the app's `C` theme object so it follows the
// light/dark toggle; the ambient ring-glow shows through the transparent stage.
//
// Props: C (theme colors), onRedeemed() — called after a successful redeem so
// App.jsx can re-check isEmailAllowed() and boot into the app with no reload;
// onBack() — signs out and returns to the landing page.
export function InviteGate({ C, onRedeemed, onBack }){
  const [mode, setMode] = useState('code'); // 'code' | 'waitlist'
  const [mounted, setMounted] = useState(false);
  const uid = useId();
  const codeId = `${uid}-code`;
  const reasonId = `${uid}-reason`;

  // Enhance-only entrance: a passive effect (runs after the first paint, and —
  // unlike requestAnimationFrame — is never throttled on a backgrounded tab) flips
  // the card to its visible resting state, so the content can never get stuck hidden.
  useEffect(()=>{ setMounted(true); },[]);

  // ── Code entry ──────────────────────────────────────────────────────────────
  const [code, setCode] = useState('');
  const [codeFocus, setCodeFocus] = useState(false);
  const [redeeming, setRedeeming] = useState(false);
  const [redeemError, setRedeemError] = useState(null); // {text}

  const submitCode = async (e) => {
    e.preventDefault();
    const trimmed = code.trim().toUpperCase();
    if (!trimmed || redeeming) return;
    setRedeeming(true);
    setRedeemError(null);
    const { status } = await redeemInviteCode(trimmed);
    if (status === 'ok'){ onRedeemed(); return; } // leave `redeeming` true — the view is about to change
    if (status === 'already_used'){
      setRedeemError({ text:"That code's already been used. Ask whoever invited you for a fresh one." });
    } else if (status === 'locked'){
      setRedeemError({ text:"Too many tries. Please wait a bit before trying again." });
    } else {
      setRedeemError({ text:"That code isn't valid. Double-check it and try again." });
    }
    setRedeeming(false);
  };

  // ── Waitlist ────────────────────────────────────────────────────────────────
  const [reason, setReason] = useState('');
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState(null);
  const [joined, setJoined] = useState(null); // null=unknown, obj=joined, false=not joined

  useEffect(() => {
    let cancelled = false;
    (async () => { const row = await myWaitlist(); if (!cancelled) setJoined(row || false); })();
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

  // ── Shared styles ─────────────────────────────────────────────────────────────
  const card = {
    width:"100%", boxSizing:"border-box", padding:"28px 26px 26px", borderRadius:20,
    background:C.glassCard, border:`1px solid ${C.border}`,
    backdropFilter:"blur(30px) saturate(140%)", WebkitBackdropFilter:"blur(30px) saturate(140%)",
    boxShadow:"0 14px 44px rgba(0,0,0,0.30)", textAlign:"left",
  };
  const heading = { fontSize:21, fontWeight:600, margin:"0 0 8", letterSpacing:"-0.02em", textAlign:"center", fontFamily:"'Newsreader', Georgia, serif" };
  const sub = { fontSize:14, color:C.sub, lineHeight:1.5, margin:"0 0 22", textAlign:"center" };
  const label = { display:"block", fontSize:12.5, fontWeight:600, color:C.sub, marginBottom:8 };
  const errorBox = { marginTop:12, padding:"10px 12px", borderRadius:10, background:C.dangerLight, border:`1px solid ${C.dangerMid}`, color:C.danger, fontSize:13, lineHeight:1.4 };
  const primaryBtn = (disabled) => ({
    width:"100%", minHeight:48, marginTop:16, border:"none", borderRadius:12,
    background:C.teal, color:C.bg, fontSize:14, fontWeight:600,
    cursor:disabled?"not-allowed":"pointer", opacity:disabled?0.5:1,
  });
  const ghostBtn = { width:"100%", minHeight:46, border:`1px solid ${C.border}`, borderRadius:12, background:"transparent", color:C.text, fontSize:14, fontWeight:600, cursor:"pointer" };
  const backLink = { display:"block", margin:"16px auto 0", minHeight:44, border:"none", background:"transparent", color:C.sub, fontSize:13, cursor:"pointer" };

  return (
    <main style={{position:"fixed",inset:0,display:"flex",alignItems:"center",justifyContent:"center",background:"transparent",color:C.text,padding:24,overflowY:"auto"}}>
      <style>{`
        .ig-rise{opacity:0;transform:translateY(10px);transition:opacity .5s cubic-bezier(.22,1,.36,1),transform .5s cubic-bezier(.22,1,.36,1)}
        .ig-rise.in{opacity:1;transform:none}
        .ig-primary:hover:not(:disabled){filter:brightness(1.06)}
        .ig-primary:active:not(:disabled){transform:translateY(.5px)}
        .ig-ghost:hover{background:${C.surface}}
        .ig-link:hover{color:${C.text};text-decoration:underline;text-underline-offset:3px}
        @media (prefers-reduced-motion: reduce){.ig-rise{transition:none;opacity:1;transform:none}}
      `}</style>

      <div className={`ig-rise${mounted?' in':''}`} style={{maxWidth:396,width:"100%",display:"flex",flexDirection:"column",alignItems:"center"}}>
        <div style={{marginBottom:22}}><MarroLogo size={56}/></div>

        {mode === 'code' ? (
          <>
            <div style={card}>
              <h1 style={heading}>Marro is invite-only<span style={{color:C.marigold}}>.</span></h1>
              <p style={sub}>Enter your invite code to get in.</p>

              <form onSubmit={submitCode} noValidate>
                <label htmlFor={codeId} style={label}>Invite code</label>
                <input
                  id={codeId}
                  value={code}
                  onChange={e=>setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,''))}
                  onFocus={()=>setCodeFocus(true)}
                  onBlur={()=>setCodeFocus(false)}
                  inputMode="text" autoCapitalize="characters" autoCorrect="off" spellCheck={false} autoComplete="off"
                  maxLength={8}
                  placeholder="ABCD1234"
                  disabled={redeeming}
                  aria-invalid={redeemError ? 'true' : undefined}
                  aria-describedby={redeemError ? `${codeId}-err` : undefined}
                  style={{
                    width:"100%", boxSizing:"border-box", height:54, padding:"0 14px", borderRadius:12,
                    background:C.bg, color:C.text, fontFamily:"'SFMono-Regular',ui-monospace,Menlo,monospace",
                    fontSize:20, fontWeight:600, letterSpacing:"0.24em", textAlign:"center", textTransform:"uppercase",
                    border:`1.5px solid ${codeFocus?C.teal:C.border}`,
                    boxShadow:codeFocus?`0 0 0 4px ${C.teal}22`:"none",
                    transition:"border-color .15s, box-shadow .15s", outline:"none",
                  }}
                />
                {redeemError && <div id={`${codeId}-err`} role="alert" style={errorBox}>{redeemError.text}</div>}

                <button type="submit" className="ig-primary" disabled={!code.trim() || redeeming} aria-busy={redeeming} style={primaryBtn(!code.trim() || redeeming)}>
                  {redeeming ? "Checking…" : "Redeem code"}
                </button>
              </form>

              <div style={{display:"flex",alignItems:"center",gap:12,margin:"18px 0 14px"}}>
                <span style={{flex:1,height:1,background:C.border}}/>
                <span style={{fontSize:11,color:C.sub}}>no code?</span>
                <span style={{flex:1,height:1,background:C.border}}/>
              </div>

              <button type="button" className="ig-ghost" onClick={()=>setMode('waitlist')} style={ghostBtn}>
                Join the waitlist
              </button>
            </div>

            <button type="button" className="ig-link" onClick={onBack} style={backLink}>Back to sign in</button>
          </>
        ) : (
          <>
            <div style={card}>
              <h1 style={heading}>Join the waitlist<span style={{color:C.marigold}}>.</span></h1>

              {joined ? (
                <>
                  <p role="status" style={{...sub, margin:"0 0 4"}}>You&apos;re on the list.</p>
                  <p style={{...sub, margin:"0 0 20", fontSize:13}}>We&apos;ll email you the moment a spot opens up.</p>
                  <button type="button" className="ig-ghost" onClick={()=>setMode('code')} style={ghostBtn}>
                    I have a code
                  </button>
                </>
              ) : joined === false ? (
                <>
                  <p style={sub}>We&apos;ll email you when a spot opens up.</p>
                  <form onSubmit={submitWaitlist} noValidate>
                    <label htmlFor={reasonId} style={label}>What brings you to Marro? <span style={{fontWeight:400,color:C.sub}}>(optional)</span></label>
                    <textarea
                      id={reasonId}
                      value={reason}
                      onChange={e=>setReason(e.target.value)}
                      rows={3}
                      disabled={joining}
                      placeholder="e.g. planning my budget for the year"
                      style={{
                        width:"100%", boxSizing:"border-box", padding:"12px 14px", borderRadius:12,
                        background:C.bg, color:C.text, fontSize:14, fontFamily:"inherit", lineHeight:1.5,
                        border:`1.5px solid ${C.border}`, resize:"vertical", minHeight:84, outline:"none",
                      }}
                    />
                    {joinError && <div role="alert" style={errorBox}>{joinError}</div>}
                    <button type="submit" className="ig-primary" disabled={joining} aria-busy={joining} style={primaryBtn(joining)}>
                      {joining ? "Joining…" : "Join the waitlist"}
                    </button>
                  </form>
                  <button type="button" className="ig-link" onClick={()=>setMode('code')} style={{...backLink, color:C.teal, fontWeight:600}}>
                    I have a code
                  </button>
                </>
              ) : (
                <p role="status" style={{...sub, margin:0}}>Checking…</p>
              )}
            </div>

            <button type="button" className="ig-link" onClick={onBack} style={backLink}>Back to sign in</button>
          </>
        )}
      </div>
    </main>
  );
}
