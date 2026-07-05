import React, { useEffect, useRef, useState } from 'react';
import { getSupabase, clearRecoveryUrlParams } from '../lib/data.js';
import { BlobLayer } from './landingShared.jsx';
import { ResetPasswordScreen } from './ResetPasswordScreen.jsx';
import './landing.css';

// Standalone full-page entry point, rendered directly by main.jsx (in place
// of App/LandingPage) whenever isRecoveryRedirect() sees the `?reset=1`
// marker from the password-reset email link — see main.jsx for why this
// check has to happen synchronously before the App-vs-landing decision
// rather than reacting to Supabase's PASSWORD_RECOVERY auth event (that
// event fires AFTER the client-side PKCE code exchange completes, which is
// too late to stop App.jsx from having already been chosen).
//
// This component owns the actual code exchange + session check: it awaits
// getSupabase() (which processes the `?code=...` param via detectSessionInUrl
// the moment the client is constructed), then confirms a real session exists
// before treating the link as valid — an expired/already-used link fails the
// exchange and getSession() comes back empty, so ResetPasswordScreen renders
// its "link doesn't work anymore" state instead of assuming success.
//
// The `onAuthStateChange` PASSWORD_RECOVERY listener is kept as a secondary
// signal only (per the task's "belt and suspenders" guidance) — it re-checks
// session validity if the event arrives after our initial check, but the
// URL-marker gate in main.jsx is the primary mechanism preventing the flash.
export default function ResetPasswordGate(){
  const [checking, setChecking] = useState(true);
  const [sessionValid, setSessionValid] = useState(false);
  const cleanedUp = useRef(false);
  const headingRef = useRef(null);

  // Focus management: no dialog trigger to return focus to (this is a full
  // page, not a modal opened from a button) — move focus to the heading once
  // the checking/valid/invalid state settles, consistent with AuthModal's
  // focus-on-open convention elsewhere in the landing flow.
  useEffect(() => {
    if (checking) return;
    const raf = requestAnimationFrame(() => headingRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, [checking, sessionValid]);

  useEffect(() => {
    let cancelled = false;
    let unsub;

    (async () => {
      const sb = await getSupabase();

      // Belt-and-suspenders: Supabase's documented recovery-specific event.
      const { data: { subscription } } = sb.auth.onAuthStateChange((evt, session) => {
        if (evt === 'PASSWORD_RECOVERY' || evt === 'SIGNED_IN'){
          if (!cancelled) setSessionValid(!!session);
        }
      });
      unsub = () => subscription.unsubscribe();

      // Primary check: after getSupabase() has had a chance to exchange the
      // PKCE code in the URL, ask directly whether a session now exists.
      const { data } = await sb.auth.getSession();
      if (cancelled) return;
      setSessionValid(!!data.session);
      setChecking(false);

      // Clean the URL now that the code (valid or not) has been consumed —
      // prevents a refresh/bookmark from re-triggering this gate or
      // resubmitting an already-used code.
      if (!cleanedUp.current){
        cleanedUp.current = true;
        clearRecoveryUrlParams();
      }
    })();

    return () => { cancelled = true; unsub?.(); };
  }, []);

  const handleRequestNewLink = () => {
    // No reset-request UI exists on this standalone page (that lives inside
    // AuthModal on the landing page) — send the user back to the landing
    // page's normal sign-in entry point, where "Forgot password?" is one
    // click away.
    window.location.assign('/');
  };

  return (
    <div className="lp lp-authportal lp-resetgate" data-scene="s1">
      <BlobLayer />
      <div className="lp-authbackdrop" style={{ position: 'fixed' }}>
        {checking ? (
          <div className="lp-authmodal lp-authstandalone" role="status" aria-live="polite">
            <h1 className="lp-authheading">Checking your link…</h1>
          </div>
        ) : (
          <ResetPasswordScreen sessionValid={sessionValid} onRequestNewLink={handleRequestNewLink} headingRef={headingRef} />
        )}
      </div>
    </div>
  );
}
