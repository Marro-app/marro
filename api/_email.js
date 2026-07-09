// Side-effect-free email helper for the api/ serverless routes.
//
// WHY fetch, not the `resend` package: we deliberately add NO npm dependency
// (repo/build constraint). Resend's REST API is a single POST, so a bare fetch
// is simpler than a client library and keeps the bundle/lockfile untouched.
//
// SECURITY: RESEND_API_KEY is a Vercel env var — read ONLY from process.env,
// never hardcoded, never logged, never echoed in a response. If it is missing
// we fail soft ({ok:false, error}) so a route can degrade gracefully (still mint
// the code, just report it wasn't emailed) instead of crashing.
//
// Every template is dark-first inline-CSS with explicit bgcolor on each cell —
// same rules as supabase/email_templates.md (dark-mode clients only invert
// unstyled regions), single-column table, 560px, no flex/grid (Outlook).

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

// Brand tokens (from src/landing/landing.css — mirrored in email_templates.md).
const C = {
  bg:    '#0C0E0C', // outer background (--lp-bg)
  stage: '#14150F', // card background (--lp-stage)
  cream: '#FBF6E8', // body text + button fill (--lp-cream)
  gold:  '#DDA528', // accent (--lp-gold)
  muted: 'rgba(248,242,226,.58)', // footer text (--lp-cream40)
};

// sendEmail({to, subject, html}) → {ok:boolean, error?:string}. Never throws.
export async function sendEmail({ to, subject, html, from }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, error: 'Email is not configured yet.' };
  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: from || 'Marro <invites@joinmarro.com>',
        to,
        subject,
        html,
      }),
    });
    if (!res.ok) {
      let detail = '';
      try { const b = await res.json(); detail = b?.message || b?.error || ''; } catch { /* non-JSON */ }
      console.error('sendEmail: Resend returned', res.status, detail);
      return { ok: false, error: 'Email could not be sent.' };
    }
    return { ok: true };
  } catch (e) {
    console.error('sendEmail: network error', e?.message);
    return { ok: false, error: 'Email could not be sent.' };
  }
}

// Shared shell so every template renders identically. `inner` is the body's
// inner table rows; `footer` overrides the default "someone invited you" line
// for templates sent to people who already have an account (waitlist
// confirmation, ambassador/admin congrats) — that copy would be confusing
// there since nobody "invited" them into anything new.
function shell(inner, footer) {
  const footerText = footer || "You're getting this because someone invited you to Marro, a financial companion for med students. If this wasn't meant for you, you can ignore it.";
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:${C.bg};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg};padding:32px 12px;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:${C.stage};border-radius:16px;">
        <tr><td style="padding:32px 32px 8px 32px;">
          <div style="font-family:Newsreader,Georgia,'Times New Roman',serif;font-size:26px;font-weight:700;color:${C.cream};">Marro<span style="color:${C.gold};">.</span></div>
        </td></tr>
        ${inner}
        <tr><td style="padding:24px 32px 32px 32px;">
          <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;line-height:1.6;color:${C.muted};">
            ${footerText}
          </div>
        </td></tr>
      </table>
    </td></tr>
  </table>
  </body></html>`;
}

function codeBlock(code) {
  return `<div style="font-family:'SF Mono',SFMono-Regular,Menlo,Consolas,monospace;font-size:30px;letter-spacing:4px;font-weight:700;color:${C.cream};background:${C.bg};border-radius:12px;padding:18px 20px;text-align:center;">${escapeHtml(code)}</div>`;
}

function ctaButton(code) {
  // Table-cell button (Outlook ignores flex/grid). Cream fill, dark text.
  // Deep-links straight to the sign-up screen (Nav's ?invite= handling in
  // landingShared.jsx auto-opens the modal) instead of the bare landing page.
  const href = `https://joinmarro.com/?invite=${encodeURIComponent(code)}`;
  return ctaLink('Open Marro', href);
}

// Plain CTA button with no invite code — for emails to people who already
// have access (congrats/status emails). Same table-cell markup as ctaButton.
function ctaLink(label, href) {
  return `<table role="presentation" cellpadding="0" cellspacing="0"><tr>
    <td bgcolor="${C.cream}" style="background:${C.cream};border-radius:12px;">
      <a href="${href}" style="display:inline-block;padding:12px 22px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;font-weight:700;color:${C.stage};text-decoration:none;">${escapeHtml(label)}</a>
    </td></tr></table>`;
}

// inviteCodeEmail({code, message}) — a member/ambassador sharing their code.
export function inviteCodeEmail({ code, message }) {
  const personal = message
    ? `<tr><td style="padding:8px 32px 0 32px;">
         <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:${C.cream};font-style:italic;">${escapeHtml(message)}</div>
       </td></tr>`
    : '';
  const inner = `
    <tr><td style="padding:8px 32px 0 32px;">
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:17px;line-height:1.5;color:${C.cream};">You're invited to Marro.</div>
    </td></tr>
    ${personal}
    <tr><td style="padding:16px 32px 0 32px;">
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.6;color:${C.muted};">Use this invite code when you sign in:</div>
    </td></tr>
    <tr><td style="padding:12px 32px 0 32px;">${codeBlock(code)}</td></tr>
    <tr><td style="padding:20px 32px 0 32px;">${ctaButton(code)}</td></tr>`;
  return shell(inner);
}

// waitlistInviteEmail({code}) — an admin pulling someone off the waitlist.
export function waitlistInviteEmail({ code }) {
  const inner = `
    <tr><td style="padding:8px 32px 0 32px;">
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:17px;line-height:1.5;color:${C.cream};">You're off the waitlist — welcome to Marro.</div>
    </td></tr>
    <tr><td style="padding:16px 32px 0 32px;">
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.6;color:${C.muted};">Here's your invite code — enter it when you sign in:</div>
    </td></tr>
    <tr><td style="padding:12px 32px 0 32px;">${codeBlock(code)}</td></tr>
    <tr><td style="padding:20px 32px 0 32px;">${ctaButton(code)}</td></tr>`;
  return shell(inner);
}

// waitlistConfirmEmail() — sent the moment someone JOINS the waitlist (bug 1:
// this used to never fire — joining only wrote a DB row, no email). Distinct
// from waitlistInviteEmail above, which fires later when an admin actually
// pulls them off the waitlist with a real code. No CTA/code here — there's
// nothing to redeem yet, just a confirmation that they're in the queue.
export function waitlistConfirmEmail() {
  const inner = `
    <tr><td style="padding:8px 32px 0 32px;">
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:17px;line-height:1.5;color:${C.cream};">You're on the waitlist.</div>
    </td></tr>
    <tr><td style="padding:16px 32px 0 32px;">
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.6;color:${C.muted};">We'll email you the moment a spot opens up — no need to do anything else in the meantime.</div>
    </td></tr>`;
  return shell(inner, "You're getting this because you joined the Marro waitlist. If this wasn't you, you can ignore it.");
}

// congratsEmail({role}) — sent when a member is promoted to ambassador or
// admin (bug 5: this used to only post an in-app notification, which a
// promoted member has no way to see if they're not actively signed in).
// role: 'ambassador' | 'admin'.
export function congratsEmail({ role }) {
  const isAdmin = role === 'admin';
  const heading = isAdmin ? "You're now a Marro admin." : "You're now a Marro ambassador.";
  const body = isAdmin
    ? "You now have full access to the Marro admin console — invite codes, waitlist, members, and roles."
    : "Your invite limit just went up to 15, and you've got a spot on the ambassador roster. Head to Settings → Invite friends to start sharing codes.";
  const inner = `
    <tr><td style="padding:8px 32px 0 32px;">
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:17px;line-height:1.5;color:${C.cream};">${escapeHtml(heading)}</div>
    </td></tr>
    <tr><td style="padding:16px 32px 0 32px;">
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.6;color:${C.muted};">${escapeHtml(body)}</div>
    </td></tr>
    <tr><td style="padding:20px 32px 0 32px;">${ctaLink('Open Marro', 'https://joinmarro.com/')}</td></tr>`;
  return shell(inner, "You're getting this because your role on Marro just changed. If this wasn't you, please let us know.");
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
