import React, { useEffect, useId, useRef, useState } from 'react';
import { redeemInviteCode, joinWaitlist, myWaitlist } from '../lib/data.js';
import { MarroLogo } from '../components/icons.jsx';

const CODE_LEN = 8;

// Segmented invite-code field — one box per character (OTP style). Supports
// type-to-advance, backspace-to-previous, arrow-key nav, and paste that
// distributes across the boxes. Accessible: a labelled role="group" wraps the
// boxes and each box has its own "character N of 8" label, so it's fully
// keyboard- and screen-reader-operable. onComplete fires once all boxes are
// filled (used to auto-submit).
function CodeInput({ value, onChange, onComplete, disabled, invalid, describedById, C }){
  const refs = useRef([]);
  const chars = Array.from({ length: CODE_LEN }, (_, i) => value[i] || '');
  const focusBox = (i) => { const el = refs.current[i]; if (el) { el.focus(); el.select?.(); } };

  const commit = (arr, focusIdx) => {
    const joined = arr.join('').slice(0, CODE_LEN);
    onChange(joined);
    if (focusIdx != null) focusBox(Math.min(focusIdx, CODE_LEN - 1));
    if (joined.length === CODE_LEN) onComplete?.(joined);
  };

  const distribute = (i, raw) => {
    const cleaned = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!cleaned) { const a = chars.slice(); a[i] = ''; commit(a); return; }
    const a = chars.slice();
    let j = i;
    for (const c of cleaned) { if (j >= CODE_LEN) break; a[j] = c; j++; }
    commit(a, j);
  };

  const handleKeyDown = (i, e) => {
    if (e.key === 'Backspace') {
      const a = chars.slice();
      if (a[i]) { a[i] = ''; commit(a); }
      else if (i > 0) { e.preventDefault(); a[i - 1] = ''; commit(a, i - 1); }
    } else if (e.key === 'ArrowLeft' && i > 0) { e.preventDefault(); focusBox(i - 1); }
    else if (e.key === 'ArrowRight' && i < CODE_LEN - 1) { e.preventDefault(); focusBox(i + 1); }
  };

  const box = (filled, i) => ({
    flex: '1 1 0', minWidth: 0, height: 46, padding: 0, borderRadius: 9,
    background: C.bg, color: C.text, textAlign: 'center', textTransform: 'uppercase',
    fontFamily: "'SFMono-Regular',ui-monospace,Menlo,monospace", fontSize: 17, fontWeight: 700,
    border: `1.5px solid ${invalid ? C.dangerMid : filled ? C.teal : C.border}`,
    marginLeft: i === CODE_LEN / 2 ? 7 : 0,  // subtle 4+4 grouping
    outline: 'none', transition: 'border-color .15s',
  });

  return (
    <div role="group" aria-label="Invite code" aria-describedby={describedById} style={{ display: 'flex', gap: 5, width: '100%' }}>
      {chars.map((ch, i) => (
        <input
          key={i}
          ref={el => (refs.current[i] = el)}
          value={ch}
          onChange={e => distribute(i, e.target.value)}
          onKeyDown={e => handleKeyDown(i, e)}
          onPaste={e => { e.preventDefault(); distribute(i, e.clipboardData.getData('text') || ''); }}
          onFocus={e => e.target.select()}
          inputMode="text" autoCapitalize="characters" autoCorrect="off" spellCheck={false} autoComplete="off"
          maxLength={1} disabled={disabled}
          aria-label={`Invite code character ${i + 1} of ${CODE_LEN}`}
          aria-invalid={invalid || undefined}
          style={box(!!ch, i)}
        />
      ))}
    </div>
  );
}

// Rendered when a session exists but the account isn't on the invite allow-list
// (App.jsx's `accessDenied` state). Two modes — code entry (default) and "join
// the waitlist" — laid out in a single glass card so the screen reads as the
// same family as the login modal the user just came from (continuity). Uses the
// app's `C` theme object so it follows the light/dark toggle; the ambient
// ring-glow shows through the transparent stage.
//
// Props: C (theme colors), onRedeemed() — called after a successful redeem so
// App.jsx can re-check isEmailAllowed() and boot into the app with no reload;
// onBack() — signs out and returns to the landing page.
export function InviteGate({ C, onRedeemed, onBack }){
  const [mode, setMode] = useState('code'); // 'code' | 'waitlist'
  const [mounted, setMounted] = useState(false);
  const uid = useId();
  const codeErrId = `${uid}-code-err`;

  // Enhance-only entrance: a passive effect (runs after the first paint, and —
  // unlike requestAnimationFrame — is never throttled on a backgrounded tab)
  // flips the card to visible, so the content can never get stuck hidden.
  useEffect(()=>{ setMounted(true); },[]);

  // ── Code entry ──────────────────────────────────────────────────────────────
  const [code, setCode] = useState('');
  const [redeeming, setRedeeming] = useState(false);
  const [redeemError, setRedeemError] = useState(null); // {text}

  const doRedeem = async (raw) => {
    const trimmed = (raw ?? code).trim().toUpperCase();
    if (trimmed.length !== CODE_LEN || redeeming) return;
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
  // No fields to fill: the signed-in session already carries the user's email,
  // so joining is a single tap that records it (joinWaitlist reads auth.getUser).
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState(null);
  const [joined, setJoined] = useState(null); // null=unknown, true=joined, false=not joined

  useEffect(() => {
    let cancelled = false;
    (async () => { const row = await myWaitlist(); if (!cancelled) setJoined(!!row); })();
    return () => { cancelled = true; };
  }, []);

  const submitWaitlist = async () => {
    if (joining) return;
    setJoining(true);
    setJoinError(null);
    const { ok } = await joinWaitlist();
    setJoining(false);
    if (ok) setJoined(true);
    else setJoinError("Couldn't join the waitlist. Please try again.");
  };

  // ── Shared styles ─────────────────────────────────────────────────────────────
  const cardStyle = {
    width:"100%", boxSizing:"border-box", padding:"28px 26px 26px", borderRadius:20,
    background:C.glassCard, border:`1px solid ${C.border}`,
    backdropFilter:"blur(30px) saturate(140%)", WebkitBackdropFilter:"blur(30px) saturate(140%)",
    boxShadow:"0 14px 44px rgba(0,0,0,0.30)", textAlign:"left",
  };
  const heading = { fontSize:21, fontWeight:600, margin:"0 0 8", letterSpacing:"-0.02em", textAlign:"center", fontFamily:"'Newsreader', Georgia, serif" };
  const sub = { fontSize:14, color:C.textMid, lineHeight:1.5, margin:"0 0 22", textAlign:"center" };
  const label = { display:"block", fontSize:12.5, fontWeight:600, color:C.textMid, marginBottom:8 };
  const errorBox = { marginTop:12, padding:"10px 12px", borderRadius:10, background:C.dangerLight, border:`1px solid ${C.dangerMid}`, color:C.danger, fontSize:13, lineHeight:1.4 };
  const primaryBtn = (disabled) => ({
    width:"100%", minHeight:48, marginTop:16, border:"none", borderRadius:12,
    background:C.teal, color:C.bg, fontSize:14, fontWeight:600,
    cursor:disabled?"not-allowed":"pointer", opacity:disabled?0.5:1,
  });
  const ghostBtn = { width:"100%", minHeight:46, border:`1px solid ${C.border}`, borderRadius:12, background:"transparent", color:C.text, fontSize:14, fontWeight:600, cursor:"pointer" };
  const backLink = { display:"block", margin:"16px auto 0", minHeight:44, border:"none", background:"transparent", color:C.textMid, fontSize:13, cursor:"pointer" };
  const codeComplete = code.trim().length === CODE_LEN;

  return (
    <main style={{position:"fixed",inset:0,display:"flex",flexDirection:"column",alignItems:"center",background:"transparent",color:C.text,padding:24,overflowY:"auto",boxSizing:"border-box"}}>
      <style>{`
        .ig-rise{opacity:0;transform:translateY(10px);transition:opacity .5s cubic-bezier(.22,1,.36,1),transform .5s cubic-bezier(.22,1,.36,1)}
        .ig-rise.in{opacity:1;transform:none}
        .ig-primary:hover:not(:disabled){filter:brightness(1.06)}
        .ig-primary:active:not(:disabled){transform:translateY(.5px)}
        .ig-ghost:hover{background:${C.surface}}
        .ig-link:hover{color:${C.text};text-decoration:underline;text-underline-offset:3px}
        @media (prefers-reduced-motion: reduce){.ig-rise{transition:none;opacity:1;transform:none}}
      `}</style>

      <div className={`ig-rise${mounted?' in':''}`} style={{maxWidth:396,width:"100%",margin:"auto 0",display:"flex",flexDirection:"column",alignItems:"center"}}>
        <div style={{marginBottom:22}}><MarroLogo size={56}/></div>

        {mode === 'code' ? (
          <>
            <div style={cardStyle}>
              <h1 style={heading}>Marro is invite-only<span style={{color:C.marigold}}>.</span></h1>
              <p style={sub}>Enter your invite code to get in.</p>

              <form onSubmit={e=>{e.preventDefault(); doRedeem();}} noValidate>
                <span id={`${uid}-code-label`} style={label}>Invite code</span>
                <CodeInput
                  value={code}
                  onChange={setCode}
                  onComplete={(full)=>doRedeem(full)}
                  disabled={redeeming}
                  invalid={!!redeemError}
                  describedById={`${uid}-code-label${redeemError ? ' '+codeErrId : ''}`}
                  C={C}
                />
                {redeemError && <div id={codeErrId} role="alert" style={errorBox}>{redeemError.text}</div>}

                <button type="submit" className="ig-primary" disabled={!codeComplete || redeeming} aria-busy={redeeming} style={primaryBtn(!codeComplete || redeeming)}>
                  {redeeming ? "Checking…" : "Redeem code"}
                </button>
              </form>

              <div style={{display:"flex",alignItems:"center",gap:12,margin:"18px 0 14px"}}>
                <span style={{flex:1,height:1,background:C.border}}/>
                <span style={{fontSize:11,color:C.textMid}}>no code?</span>
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
            <div style={cardStyle}>
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
                  <p style={sub}>No code? Join the waitlist and we&apos;ll email you the moment a spot opens up.</p>
                  {joinError && <div role="alert" style={{...errorBox, marginTop:0, marginBottom:4}}>{joinError}</div>}
                  <button type="button" className="ig-primary" onClick={submitWaitlist} disabled={joining} aria-busy={joining} style={primaryBtn(joining)}>
                    {joining ? "Joining…" : "Join the waitlist"}
                  </button>
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
