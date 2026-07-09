import React, { useId, useRef, useState } from 'react';
import { getSupabase } from '../lib/data.js';

// Email + password sign-in/sign-up form fields — rendered inside AuthModal.jsx
// (see that file for the modal shell: tabs live one level up there so the
// modal heading can react to the active tab). No allowlist gating here,
// matching the app's current open-signup posture (Google has none either).
// "Forgot password?" (signin tab only) hands off to AuthModal's
// 'reset-request' mode via the `onForgotPassword` callback — see
// RequestResetForm.jsx for that screen and ResetPasswordScreen.jsx/
// ResetPasswordGate.jsx for the standalone page the emailed link lands on.
//
// Same lazy-import discipline as SignInButton.jsx: supabase-js is only
// pulled in on submit, never at module scope, so a cold logged-out visit
// that never touches this form doesn't pay for it.

const MIN_PASSWORD_LEN = 6; // Supabase's own default minimum

function PasswordField({ id, label, value, onChange, autoComplete, error, disabled, onEnter }){
  const [show, setShow] = useState(false);
  return (
    <div className="lp-field">
      <label htmlFor={id}>{label}</label>
      <div className="lp-pwdwrap">
        <input
          id={id}
          type={show ? 'text' : 'password'}
          value={value}
          onChange={onChange}
          onKeyDown={(e) => {
            // Belt-and-suspenders: native Enter-submits-form is unreliable in
            // some mobile/PWA keyboard contexts, so explicitly request a
            // submit rather than relying solely on the browser default.
            if (e.key === 'Enter' && onEnter){
              e.preventDefault();
              onEnter();
            }
          }}
          enterKeyHint="go"
          autoComplete={autoComplete}
          disabled={disabled}
          className="lp-input"
          aria-invalid={error ? 'true' : undefined}
        />
        <button
          type="button"
          className="lp-pwdtoggle"
          aria-pressed={show}
          aria-label={show ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
          onClick={() => setShow(s => !s)}
          disabled={disabled}
        >
          {show ? 'Hide' : 'Show'}
        </button>
      </div>
    </div>
  );
}

// Core form logic, reusable inside the AuthModal shell. `mode` and
// `onModeChange` are lifted to the caller (AuthModal owns the tab control so
// it can also drive the modal's heading text) — this component only renders
// the fields, validation, and submit/resend logic for whichever mode is
// active.
export function EmailPasswordFields({ mode, offline, autoFocusRef, onForgotPassword, initialEmail, onSwitchToSignup }){
  const uid = useId();
  const [email, setEmail] = useState(initialEmail || '');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null); // neutral, non-error confirmations
  const [needsConfirm, setNeedsConfirm] = useState(false); // unconfirmed-email state
  const [resending, setResending] = useState(false);
  // Failed-credentials rescue: Supabase deliberately returns the same error
  // for "no such account" and "wrong password" (prevents email enumeration),
  // so we can't auto-switch a new user to sign-up — instead, offer the switch
  // as a link alongside the error and carry the typed email across.
  const [showSignupNudge, setShowSignupNudge] = useState(false);

  // Inline pre-submit validation — kept minimal; Supabase's own errors after
  // submit remain the primary source of truth.
  const validationError = (() => {
    if (mode === 'signup' && password && password.length < MIN_PASSWORD_LEN){
      return `Password must be at least ${MIN_PASSWORD_LEN} characters.`;
    }
    if (mode === 'signup' && confirm && password !== confirm){
      return "Passwords don't match.";
    }
    return null;
  })();

  const friendlyError = (err) => {
    const msg = (err && (err.message || err.error_description)) || '';
    const status = err && err.status;
    if (status === 429 || /rate limit|too many/i.test(msg)){
      return { kind: 'rate', text: 'Too many attempts — please wait a bit and try again.' };
    }
    if (/email not confirmed|confirm/i.test(msg) && mode === 'signin'){
      return { kind: 'unconfirmed', text: 'Please confirm your email before signing in.' };
    }
    if (/invalid login credentials/i.test(msg)){
      return { kind: 'creds', text: 'Incorrect email or password.' };
    }
    // Generic fallback — still plain-language, never raw Supabase text.
    return { kind: 'other', text: 'Something went wrong. Please try again.' };
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (offline || pending) return;
    setError(null);
    setNotice(null);
    setNeedsConfirm(false);
    setShowSignupNudge(false);

    if (validationError){
      setError(validationError);
      return;
    }

    setPending(true);
    try {
      const sb = await getSupabase();
      if (mode === 'signin'){
        const { error: signInErr } = await sb.auth.signInWithPassword({ email, password });
        if (signInErr){
          const f = friendlyError(signInErr);
          if (f.kind === 'unconfirmed') setNeedsConfirm(true);
          if (f.kind === 'creds') setShowSignupNudge(true);
          setError(f.text);
          setPending(false);
          return;
        }
        // On success: unlike Google OAuth (a full-page redirect that re-runs
        // main.jsx's boot decision fresh and picks up the new session),
        // signInWithPassword creates a session in place with no navigation —
        // the user is still sitting on the already-rendered LandingPage/
        // AuthModal, which has no listener to promote the view to the signed-
        // in App (App.jsx's own onAuthStateChange listener only exists once
        // App has mounted, which is exactly the problem). A hard reload
        // mirrors what OAuth already does naturally: main.jsx re-runs
        // needsEagerSupabase(), now sees the freshly-written session token in
        // localStorage, and renders <App/>. Also drops the URL back to a bare
        // path so no stray query params linger.
        window.location.href = window.location.pathname;
        return; // page is navigating away — leave `pending` true, no further UI updates needed
      } else {
        const { error: signUpErr } = await sb.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: location.origin + location.pathname },
        });
        if (signUpErr){
          setError(friendlyError(signUpErr).text);
        } else {
          // Same neutral message whether or not the email was already
          // registered — Supabase already obfuscates that server-side.
          setNotice('Check your email to confirm your account.');
        }
      }
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setPending(false);
    }
  };

  const handleResend = async () => {
    if (offline || resending) return;
    setResending(true);
    try {
      const sb = await getSupabase();
      const { error: resendErr } = await sb.auth.resend({ type: 'signup', email });
      if (resendErr){
        setError(friendlyError(resendErr).text);
      } else {
        setNeedsConfirm(false);
        setNotice('Confirmation email sent — check your inbox.');
      }
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setResending(false);
    }
  };

  const emailId = `${uid}-email`;
  const pwdId = `${uid}-pwd`;
  const confirmId = `${uid}-confirm`;
  const disabled = offline || pending;
  const formRef = useRef(null);
  const submitForm = () => formRef.current?.requestSubmit();

  return (
    <form ref={formRef} onSubmit={handleSubmit} noValidate className="lp-epform-fields">
      <div className="lp-field">
        <label htmlFor={emailId}>Email</label>
        <input
          ref={autoFocusRef}
          id={emailId}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          required
          disabled={disabled}
          className="lp-input"
        />
      </div>

      <PasswordField
        id={pwdId}
        label="Password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        onEnter={mode === 'signin' ? submitForm : undefined}
        autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
        disabled={disabled}
        error={validationError}
      />

      {mode === 'signin' && (
        <button type="button" className="txt-act lp-forgotpwd" onClick={onForgotPassword}>
          Forgot password?
        </button>
      )}

      {mode === 'signup' && (
        <PasswordField
          id={confirmId}
          label="Confirm password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          onEnter={submitForm}
          autoComplete="new-password"
          disabled={disabled}
          error={validationError}
        />
      )}

      {validationError && (password || confirm) && (
        <div role="alert" className="lp-eperr">{validationError}</div>
      )}

      {error && (
        <div role="alert" className="lp-eperr">
          {error}
          {needsConfirm && (
            <>
              {' '}
              <button type="button" className="txt-act lp-epresend" onClick={handleResend} disabled={offline || resending}>
                {resending ? 'Sending…' : 'Resend confirmation email'}
              </button>
            </>
          )}
          {showSignupNudge && onSwitchToSignup && (
            <>
              {' '}New to Marro?{' '}
              <button type="button" className="txt-act lp-epresend" onClick={() => onSwitchToSignup(email)}>
                Create an account
              </button>
            </>
          )}
        </div>
      )}

      {notice && <div role="status" className="lp-epnotice">{notice}</div>}

      {offline && <div role="status" className="lp-note" style={{ color: '#DDA528' }}>You're offline. Reconnect to continue.</div>}

      <button
        type="submit"
        className="lp-btn lp-btn-fill lp-epsubmit"
        disabled={disabled || !!validationError}
        aria-busy={pending}
      >
        {pending ? 'Please wait…' : (mode === 'signin' ? 'Log in' : 'Create account')}
      </button>
    </form>
  );
}
