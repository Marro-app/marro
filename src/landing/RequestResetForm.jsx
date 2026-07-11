import React, { useId, useState } from 'react';
import { getSupabase } from '../lib/data.js';

// "Forgot your password?" request screen — rendered inside AuthModal.jsx when
// mode === 'reset-request' (see AuthModal.jsx for the mode switch). Just an
// email field; on submit calls resetPasswordForEmail with a redirectTo that
// carries a `?reset=1` marker so main.jsx's isRecoveryRedirect() can detect
// the return trip (see src/lib/data.js + src/main.jsx comments) instead of
// silently completing sign-in into the full app.
//
// Same obfuscation posture as EmailPasswordFields' signup notice: Supabase
// doesn't distinguish "sent" vs "no account with that email" server-side, and
// neither do we — always show the same neutral message on any non-error
// response, so this can't be used to enumerate registered emails.
export function RequestResetForm({ offline, autoFocusRef, onBack }){
  const uid = useId();
  const emailId = `${uid}-reset-email`;
  const [email, setEmail] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (offline || pending) return;
    setError(null);
    if (!email){
      setError('Enter your email address.');
      return;
    }
    setPending(true);
    try {
      const sb = await getSupabase();
      const redirectTo = `${location.origin}${location.pathname}?reset=1`;
      const { error: resetErr } = await sb.auth.resetPasswordForEmail(email, { redirectTo });
      if (resetErr && resetErr.status !== 429 && !/rate limit|too many/i.test(resetErr.message || '')){
        // Only surface an error for genuine failures (offline, 5xx) — never
        // differentiate "no such account" from success.
        setError('Something went wrong. Please try again.');
      } else if (resetErr){
        setError('Too many attempts — please wait a bit and try again.');
      } else {
        setSent(true);
      }
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setPending(false);
    }
  };

  return (
    <div>
      <button type="button" className="txt-act lp-authback" onClick={onBack}>
        <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 4l-6 6 6 6" />
        </svg>
        Back to log in
      </button>

      {sent ? (
        <div role="status" className="lp-epnotice">
          If an account exists for that email, we&apos;ve sent a reset link.
        </div>
      ) : (
        <form onSubmit={handleSubmit} noValidate className="lp-epform-fields">
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
              disabled={offline || pending}
              className="lp-input"
            />
          </div>

          {error && <div role="alert" className="lp-eperr">{error}</div>}
          {offline && <div role="status" className="lp-note" style={{ color: '#DDA528' }}>You&apos;re offline. Reconnect to continue.</div>}

          <button
            type="submit"
            className="lp-btn lp-btn-fill lp-epsubmit"
            disabled={offline || pending}
            aria-busy={pending}
          >
            {pending ? 'Sending…' : 'Send reset link'}
          </button>
        </form>
      )}
    </div>
  );
}
