import React, { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getSupabase } from '../lib/data.js';
import { GoogleGlyph } from '../components/icons.jsx';
import { EmailPasswordFields } from './EmailPasswordForm.jsx';

// Shared auth dialog — replaces the old "Continue with Google (primary) +
// hidden 'or use email instead' toggle" pattern with two entry-point buttons
// (Log in / Sign up) that both open this ONE modal, defaulting to whichever
// tab matches the button that opened it.
//
// Accessible dialog per CLAUDE.md rule 7 (ADA/WCAG AA is top priority):
// role="dialog" + aria-modal + aria-labelledby, focus moves in on open and
// is trapped inside while open, Escape + backdrop click both close it, focus
// returns to the trigger on close, and the page behind is scroll-locked.
//
// Apple sign-in is out of scope (see docs/FUTURE_WORK.md) — not rendered
// here, not even disabled. "Forgot password?" is also omitted this pass
// (Phase B, not built yet) to avoid a dead link.

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function AuthModal({ open, initialMode = 'signin', offline, onClose, triggerRef }){
  const [mode, setMode] = useState(initialMode);
  const [googlePending, setGooglePending] = useState(false);
  const dialogRef = useRef(null);
  const firstFieldRef = useRef(null);
  const headingId = useId();

  // Reset to whichever tab the trigger asked for each time the modal opens.
  useEffect(() => {
    if (open) setMode(initialMode);
  }, [open, initialMode]);

  // Focus the first field on open; return focus to the trigger on close.
  useEffect(() => {
    if (!open) return;
    const toFocus = firstFieldRef.current || dialogRef.current;
    const raf = requestAnimationFrame(() => toFocus?.focus());
    return () => {
      cancelAnimationFrame(raf);
      triggerRef?.current?.focus?.();
    };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Lock page scroll behind the modal while open.
  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prevOverflow; };
  }, [open]);

  // Escape closes; Tab/Shift+Tab trap focus inside the dialog.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e) => {
      if (e.key === 'Escape'){
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const nodes = dialogRef.current?.querySelectorAll(FOCUSABLE_SELECTOR);
      if (!nodes || !nodes.length) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first){
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last){
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [open, onClose]);

  if (!open) return null;

  const signInGoogle = async () => {
    setGooglePending(true);
    const sb = await getSupabase();
    sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin + location.pathname } });
    // Intentionally leave `googlePending` true — the browser is about to
    // navigate away for the OAuth redirect, so there's no "done" state.
  };

  const heading = mode === 'signin' ? 'Log in to Marro' : 'Create your account';

  // Portaled to document.body: .lp-nav (a common trigger ancestor) has its
  // own backdrop-filter, which creates a containing block for descendant
  // `position:fixed` elements in most browsers — without the portal the
  // backdrop/modal would be clipped/mispositioned relative to the nav bar
  // instead of the viewport.
  return createPortal(
    <div className="lp-authportal">
      <div className="lp-authbackdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        <div
          ref={dialogRef}
          className="lp-authmodal"
          role="dialog"
          aria-modal="true"
          aria-labelledby={headingId}
        >
          <button type="button" className="lp-authclose" aria-label="Close" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l8 8M14 6l-8 8" />
            </svg>
          </button>

          <h2 id={headingId} className="lp-authheading">{heading}</h2>

          <div className="lp-eptabs" role="tablist" aria-label="Log in or create an account">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'signin'}
              className={`lp-eptab${mode === 'signin' ? ' lp-eptab-on' : ''}`}
              onClick={() => setMode('signin')}
            >
              Log in
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'signup'}
              className={`lp-eptab${mode === 'signup' ? ' lp-eptab-on' : ''}`}
              onClick={() => setMode('signup')}
            >
              Sign up
            </button>
          </div>

          <EmailPasswordFields mode={mode} offline={offline} autoFocusRef={firstFieldRef} key={mode} />

          <div className="lp-authdivider" role="separator"><span>or</span></div>

          <button
            type="button"
            className="lp-btn lp-btn-ghost lp-authgoogle"
            disabled={offline || googlePending}
            aria-busy={googlePending}
            onClick={signInGoogle}
          >
            <GoogleGlyph size={17} />
            {googlePending ? 'Connecting…' : 'Continue with Google'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
