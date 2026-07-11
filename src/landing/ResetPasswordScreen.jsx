import React, { useId, useState } from 'react';
import { getSupabase } from '../lib/data.js';

// The screen a user lands on after clicking the "Reset password" link in
// their email (see supabase/email_templates.md "Template 2" — its
// {{ .ConfirmationURL }} points at this app with a `?reset=1` marker,
// consumed by main.jsx's isRecoveryRedirect() to render ResetPasswordGate.jsx,
// which mounts this component). Completing Supabase's recovery flow signs the
// user in — by the time this renders, `sb.auth.getSession()` should already
// resolve to a real session if the link was valid, so the form just needs a
// new password and calls `updateUser`.
//
// Rendered standalone (NOT inside AuthModal — there is no "modal" chrome to
// open here, this IS the page) but reuses the same --lp-* / .lp-authportal
// dark-brand tokens and .lp-field/.lp-input/.lp-btn conventions so it doesn't
// look like a foreign screen bolted onto the app.
//
// Must render sensibly with NO valid session (expired/already-used link) —
// the caller passes `sessionValid` down after checking, and this component
// never assumes success.

const MIN_PASSWORD_LEN = 6;

export function ResetPasswordScreen({ sessionValid, onRequestNewLink, headingRef }){
  const uid = useId();
  const headingId = `${uid}-heading`;
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);

  const validationError = (() => {
    if (password && password.length < MIN_PASSWORD_LEN){
      return `Password must be at least ${MIN_PASSWORD_LEN} characters.`;
    }
    if (confirm && password !== confirm){
      return "Passwords don't match.";
    }
    return null;
  })();

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (pending) return;
    setError(null);
    if (!password || !confirm){
      setError('Enter and confirm your new password.');
      return;
    }
    if (validationError){
      setError(validationError);
      return;
    }
    setPending(true);
    try {
      const sb = await getSupabase();
      const { error: updateErr } = await sb.auth.updateUser({ password });
      if (updateErr){
        setError('Something went wrong updating your password. Please request a new reset link and try again.');
      } else {
        setDone(true);
      }
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setPending(false);
    }
  };

  const pwdId = `${uid}-pwd`;
  const confirmId = `${uid}-confirm`;

  // Link expired / already used — no valid recovery session to act on.
  if (!sessionValid){
    return (
      <div className="lp-authmodal lp-authstandalone" role="dialog" aria-modal="true" aria-labelledby={headingId}>
        <h1 id={headingId} ref={headingRef} tabIndex={-1} className="lp-authheading">This link doesn&apos;t work anymore</h1>
        <div role="alert" className="lp-eperr">
          Password reset links expire after a while, or can only be used once. Request a new one to continue.
        </div>
        <button type="button" className="lp-btn lp-btn-fill lp-epsubmit" onClick={onRequestNewLink}>
          Request a new link
        </button>
      </div>
    );
  }

  if (done){
    return (
      <div className="lp-authmodal lp-authstandalone" role="dialog" aria-modal="true" aria-labelledby={headingId}>
        <h1 id={headingId} ref={headingRef} tabIndex={-1} className="lp-authheading">Password updated</h1>
        <div role="status" className="lp-epnotice">
          Your password has been changed and you&apos;re signed in.
        </div>
        <button
          type="button"
          className="lp-btn lp-btn-fill lp-epsubmit"
          onClick={() => { window.location.assign('/'); }}
        >
          Continue to Marro
        </button>
      </div>
    );
  }

  return (
    <div className="lp-authmodal lp-authstandalone" role="dialog" aria-modal="true" aria-labelledby={headingId}>
      <h1 id={headingId} ref={headingRef} tabIndex={-1} className="lp-authheading">Reset your password</h1>
      <form onSubmit={handleSubmit} noValidate className="lp-epform-fields">
        <div className="lp-field">
          <label htmlFor={pwdId}>New password</label>
          <input
            id={pwdId}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            required
            disabled={pending}
            className="lp-input"
            aria-invalid={validationError ? 'true' : undefined}
          />
        </div>
        <div className="lp-field">
          <label htmlFor={confirmId}>Confirm new password</label>
          <input
            id={confirmId}
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            required
            disabled={pending}
            className="lp-input"
            aria-invalid={validationError ? 'true' : undefined}
          />
        </div>

        {validationError && (password || confirm) && (
          <div role="alert" className="lp-eperr">{validationError}</div>
        )}
        {error && <div role="alert" className="lp-eperr">{error}</div>}

        <button
          type="submit"
          className="lp-btn lp-btn-fill lp-epsubmit"
          disabled={pending || !!validationError}
          aria-busy={pending}
        >
          {pending ? 'Updating…' : 'Update password'}
        </button>
      </form>
    </div>
  );
}
