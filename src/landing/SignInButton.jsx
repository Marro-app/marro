import React from 'react';
import { sb } from '../lib/data.js';
import { GoogleGlyph } from '../components/icons.jsx';

// Shared OAuth entry point for the landing page — same call as LoginScreen.jsx,
// same offline handling/messaging (role="status").
//
// `onHoverCore` (feature 3b, optional) fires on pointer enter for the primary
// filled CTA only — LandingPage wires it to a shared MotionValue that gives
// the stage's gold core one gentle pulse, so hovering the button visibly
// reaches into the fixed ring canvas. Desktop pointer only in practice: touch
// devices don't fire pointerenter on tap the same way, so this never fights
// the existing :active press-scale.
export function SignInButton({ offline, className, showGlyph, children, style, onHoverCore }){
  const signIn = () => sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin + location.pathname } });
  return (
    <button
      type="button"
      className={className}
      disabled={offline}
      onClick={signIn}
      onPointerEnter={onHoverCore}
      style={style}
    >
      {showGlyph && <GoogleGlyph size={17} />}
      {children || 'Continue with Google'}
    </button>
  );
}

// Small helper shown near a sign-in CTA when offline — same message as LoginScreen.
export function OfflineNotice({ offline }){
  if(!offline) return null;
  return <div role="status" className="lp-note" style={{ color: '#DDA528' }}>You're offline. Reconnect to sign in.</div>;
}
