import React from 'react';
import { SignInButton, OfflineNotice } from './SignInButton.jsx';

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

export function Nav({ offline, onHoverCore }){
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
      <SignInButton offline={offline} className="lp-btn lp-btn-ghost" style={{ minHeight: 44, padding: '8px 18px' }} onHoverCore={onHoverCore} />
    </nav>
  );
}

export function SignInButtonWithNote({ offline, className, showGlyph, onHoverCore }){
  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start' }}>
      <SignInButton offline={offline} className={className} showGlyph={showGlyph} onHoverCore={onHoverCore} />
      <OfflineNotice offline={offline} />
    </span>
  );
}
