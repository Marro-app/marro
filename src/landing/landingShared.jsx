import React, { useEffect, useRef, useState } from 'react';
import { AuthModal } from './AuthModal.jsx';

// Shared, motion-free pieces used by both StaticLanding (mobile /
// prefers-reduced-motion, rendered eagerly) and StagedLanding (desktop
// theater, lazy-loaded). Keeping these in their own module — instead of
// LandingPage.jsx, which used to import `motion/react` at the top — means
// StaticLanding's import graph never touches the animation engine.

// Ambient blob background, reusing the signed-in app's exact global classes.
export function BlobLayer(){
  return (
    <div className="blob-layer" aria-hidden="true">
      <div className="blob blob-1"></div>
      <div className="blob blob-2"></div>
      <div className="blob blob-3"></div>
      <div className="blob blob-4"></div>
    </div>
  );
}

// Shared open/close state + trigger-ref plumbing for AuthModal. Returns the
// modal element to render plus an `open(mode)` callback that also stashes
// which element triggered it, so focus returns there on close.
function useAuthModal(offline){
  const [state, setState] = useState({ open: false, mode: 'signin' });
  const triggerRef = useRef(null);

  const open = (mode) => (e) => {
    triggerRef.current = e?.currentTarget || null;
    setState({ open: true, mode });
  };
  const close = () => setState((s) => ({ ...s, open: false }));

  const modal = (
    <AuthModal
      key={state.mode}
      open={state.open}
      initialMode={state.mode}
      offline={offline}
      onClose={close}
      triggerRef={triggerRef}
    />
  );

  return { modal, open };
}

export function Nav({ offline, onHoverCore }){
  const { modal, open } = useAuthModal(offline);

  // Deep-linked invite emails (api/_email.js's ctaButton) land on
  // /?invite=CODE(&from=waitlist) — auto-open the auth modal instead of
  // making the user find the button themselves. Waitlist-approval links open
  // the LOG IN tab (those users already created an account before joining
  // the waitlist); friend/ambassador invites open SIGN UP (usually brand-new
  // people — and the tabs are one tap away either way). Nav is the one mount
  // point common to every landing variant (StagedLanding/DotsLanding/
  // LandingPage), so this is the single place to handle it. The code itself
  // is stashed by AuthModal on mount (see AuthModal.jsx) and redeemed at the
  // InviteGate — this effect only needs to trigger the open.
  useEffect(() => {
    try {
      const params = new URLSearchParams(location.search);
      if (params.get('invite')) open(params.get('from') === 'waitlist' ? 'signin' : 'signup')();
    } catch { /* URL parsing best-effort only */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <nav className="lp-nav" aria-label="Main">
      <a className="lp-navbrand" href="#top">
        <svg width="26" height="26" viewBox="0 0 512 512" aria-hidden="true">
          <g transform="translate(256,256)" fill="none" stroke="#F6EFDD" strokeWidth="26">
            <circle r="172" /><circle r="118" /><circle r="64" opacity="0.72" /><circle r="26" fill="#DDA528" stroke="none" />
          </g>
        </svg>
        <span>Marro<span className="lp-dot">.</span></span>
      </a>
      <span style={{ display: 'inline-flex', gap: 10 }}>
        <button
          type="button"
          className="lp-btn lp-btn-ghost"
          style={{ minHeight: 44, padding: '8px 18px' }}
          onClick={open('signin')}
          onPointerEnter={onHoverCore}
        >
          Log in
        </button>
        <button
          type="button"
          className="lp-btn lp-btn-fill"
          style={{ minHeight: 44, padding: '8px 18px' }}
          onClick={open('signup')}
          onPointerEnter={onHoverCore}
        >
          Sign up
        </button>
      </span>
      {modal}
    </nav>
  );
}

// Hero/closing CTA: one primary "Get started free" button (opens the modal in
// signup mode) plus a low-emphasis "Already have an account? Log in" text
// link (signin mode) — satisfies the one-primary-button-per-screen rule
// (docs/DESIGN_SYSTEM.md → "Buttons"), replacing the old single
// "Continue with Google" + hidden email-toggle pattern.
export function GetStartedCTA({ offline, onHoverCore, note, align = 'flex-start' }){
  const { modal, open } = useAuthModal(offline);
  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 12, alignItems: align }}>
      <button
        type="button"
        className="lp-btn lp-btn-fill"
        onClick={open('signup')}
        onPointerEnter={onHoverCore}
      >
        Get started free
      </button>
      {note && <span className="lp-note">{note}</span>}
      <button type="button" className="lp-cta-signin" onClick={open('signin')}>
        Already have an account? Log in
      </button>
      {modal}
    </span>
  );
}
