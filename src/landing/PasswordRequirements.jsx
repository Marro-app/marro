import React from 'react';
import { passwordChecks } from '../lib/passwordRules.js';

// Live password-requirements checklist for the signup + reset-password forms.
// Each rule shows a red ✗ that flips to a green ✓ as it's met, mirroring the
// Supabase "Password requirements" setting (see lib/passwordRules.js).
//
// Accessibility (CLAUDE.md rule 7):
// - state is conveyed by icon SHAPE (✗ vs ✓) and sr-only "met/not met" text,
//   never by color alone (WCAG 1.4.1);
// - the list is an aria-live polite region so a screen reader announces a rule
//   the moment it flips;
// - the SVGs are aria-hidden; the visible label + sr-only status carry meaning.
export function PasswordRequirements({ password, id }){
  const checks = passwordChecks(password);
  return (
    <ul className="lp-pwreq" id={id} aria-label="Password requirements" aria-live="polite">
      {checks.map((c) => (
        <li key={c.id} className={`lp-pwreq-item${c.met ? ' is-met' : ''}`}>
          <span className="lp-pwreq-icon" aria-hidden="true">
            {c.met ? (
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M13.5 4.5 6.5 11.5 3 8" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <path d="M4 4l8 8M12 4l-8 8" />
              </svg>
            )}
          </span>
          <span className="lp-pwreq-label">{c.label}</span>
          <span className="lp-sr-only">{c.met ? '— met' : '— not met'}</span>
        </li>
      ))}
    </ul>
  );
}
