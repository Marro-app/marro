import { describe, it, expect } from 'vitest';
import { installConsoleBuffer, recentErrors, buildTechContext } from './consoleBuffer.js';

// Silence the underlying console.error for the whole file BEFORE installing,
// so the wrapper forwards into the silencer (install is once-only — a spy
// restore after install would strip the wrapper and break later tests).
let forwarded = 0;
console.error = () => { forwarded++; };
installConsoleBuffer();

describe('consoleBuffer', () => {
  it('records console.error calls after install, capped at 10, and still forwards them', () => {
    for (let i = 0; i < 13; i++) console.error(`boom ${i}`);
    const errs = recentErrors();
    expect(errs.length).toBe(10);
    expect(errs[errs.length - 1].msg).toBe('boom 12');
    expect(errs[0].msg).toBe('boom 3'); // oldest three rolled off
    expect(forwarded).toBe(13);         // original console.error still ran
  });

  it('serializes Errors and objects, truncated', () => {
    console.error(new Error('kaput'), { detail: 'x'.repeat(500) });
    const last = recentErrors().at(-1);
    expect(last.msg).toContain('Error: kaput');
    expect(last.msg.length).toBeLessThanOrEqual(300);
  });

  it('buildTechContext is technical-only (no app/user state keys)', () => {
    const ctx = buildTechContext();
    expect(Object.keys(ctx).sort()).toEqual(['color_scheme', 'errors', 'online', 'reduced_motion', 'ua', 'url', 'viewport']);
    expect(JSON.stringify(ctx)).not.toMatch(/loan|balance|budget|\$\d/i);
  });
});
