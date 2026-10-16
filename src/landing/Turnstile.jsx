import React, { useEffect, useId, useRef } from 'react';

// Cloudflare Turnstile — invisible-by-default human check on the auth forms
// (sign-in, sign-up, password reset request). `appearance:'interaction-only'`
// keeps the widget silent and invisible unless Cloudflare's risk signals
// actually call for a challenge, so real users almost never see anything.
// Not used on the Google button — OAuth has no password to brute-force.
//
// Renders nothing when no site key is configured (VITE_TURNSTILE_SITE_KEY),
// so this ships safely dormant. Activating it for real needs two things only
// the project owner can do: (1) create a free Cloudflare account and a
// Turnstile site to get a real site key + secret key, (2) paste the secret
// key into Supabase's dashboard (Authentication → Attack Protection) and turn
// CAPTCHA protection on there — Supabase is what actually verifies the token
// server-side. Once BOTH the real site key is set here and that dashboard
// toggle is on, this becomes load-bearing: Supabase will reject signin/
// signup/reset requests with no captchaToken, so don't flip the dashboard
// toggle on until this widget is confirmed rendering/loading correctly.
export const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY || '';

let scriptPromise = null;
function loadTurnstileScript(){
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    if (window.turnstile){ resolve(window.turnstile); return; }
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
    script.async = true;
    script.defer = true;
    script.onload = () => resolve(window.turnstile);
    script.onerror = () => reject(new Error('Turnstile failed to load'));
    document.head.appendChild(script);
  });
  return scriptPromise;
}

// `ref.current.reset()` must be called after every submit attempt (success or
// failure) — a Turnstile token is single-use.
export const Turnstile = React.forwardRef(function Turnstile({ onVerify }, ref){
  const uid = useId();
  const containerRef = useRef(null);
  const widgetIdRef = useRef(null);

  useEffect(() => {
    if (!TURNSTILE_SITE_KEY) return;
    let cancelled = false;
    loadTurnstileScript().then((turnstile) => {
      if (cancelled || !containerRef.current) return;
      widgetIdRef.current = turnstile.render(containerRef.current, {
        sitekey: TURNSTILE_SITE_KEY,
        appearance: 'interaction-only',
        callback: (token) => onVerify?.(token),
        'expired-callback': () => onVerify?.(''),
        // Fails open client-side (widget just disappears) rather than
        // blocking the form — see the activation note above for why this is
        // still safe: Supabase only enforces the token once its own dashboard
        // toggle is on, and that shouldn't be flipped on until this is
        // verified working.
        'error-callback': () => onVerify?.(''),
      });
    }).catch(() => onVerify?.(''));
    return () => {
      cancelled = true;
      if (widgetIdRef.current && window.turnstile){
        try { window.turnstile.remove(widgetIdRef.current); } catch { /* best-effort cleanup only */ }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useImperativeHandle(ref, () => ({
    reset(){
      if (widgetIdRef.current && window.turnstile){
        try { window.turnstile.reset(widgetIdRef.current); } catch { /* best-effort only */ }
      }
    },
  }));

  if (!TURNSTILE_SITE_KEY) return null;
  return <div ref={containerRef} id={`${uid}-turnstile`} style={{ margin: '4px 0' }} />;
});
