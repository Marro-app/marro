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

function ctaButton(code, from) {
  // Table-cell button (Outlook ignores flex/grid). Cream fill, dark text.
  // Deep-links straight to the sign-up screen (Nav's ?invite= handling in
  // landingShared.jsx auto-opens the modal) instead of the bare landing page.
  // `from` ('waitlist' | undefined) tags which email template the click came
  // from so InviteGate can pick congrats copy ("off the waitlist" vs "you've
  // been invited") — it carries no identity, just the template name.
  const href = `https://joinmarro.com/?invite=${encodeURIComponent(code)}${from ? `&from=${encodeURIComponent(from)}` : ''}`;
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
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:17px;line-height:1.5;color:${C.cream};">You're off the waitlist — welcome to Marro!</div>
    </td></tr>
    <tr><td style="padding:16px 32px 0 32px;">
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.6;color:${C.muted};">We're excited to have you join us. Here's your invite code — enter it when you sign in:</div>
    </td></tr>
    <tr><td style="padding:12px 32px 0 32px;">${codeBlock(code)}</td></tr>
    <tr><td style="padding:20px 32px 0 32px;">${ctaButton(code, 'waitlist')}</td></tr>`;
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

// Small uppercase role pill — "Ambassador" / "Admin" — matching the badge
// style already used in the admin console UI (AdminTab.jsx role badges).
// Table-cell based (not a styled <span>) so the rounded pill survives Outlook,
// same pattern as ctaLink's button.
function rolePill(label) {
  return `<table role="presentation" cellpadding="0" cellspacing="0"><tr>
    <td bgcolor="${C.gold}" style="background:${C.gold};border-radius:999px;padding:5px 12px;">
      <span style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:${C.stage};">${escapeHtml(label)}</span>
    </td></tr></table>`;
}

// Ambassador-only "5 → 15" invite-limit upgrade moment — the celebratory
// stat from the approved design (mocked up + iterated with the founder:
// simplified to one clear number jump rather than two overlapping stats,
// no "we need you" framing — just their own impact).
function upgradeStat() {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg};border-radius:10px;">
    <tr><td align="center" style="padding:20px 16px;">
      <div style="font-family:Newsreader,Georgia,'Times New Roman',serif;line-height:1;">
        <span style="font-size:20px;color:${C.muted};text-decoration:line-through;">5</span>
        <span style="font-size:18px;color:${C.muted};padding:0 10px;">&rarr;</span>
        <span style="font-size:32px;font-weight:700;color:${C.gold};">15</span>
      </div>
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:11.5px;letter-spacing:.05em;text-transform:uppercase;color:${C.muted};margin-top:8px;">Your invite limit just tripled</div>
    </td></tr>
  </table>`;
}

// congratsEmail({role}) — sent when a member is promoted to ambassador or
// admin (bug 5: this used to only post an in-app notification, which a
// promoted member has no way to see if they're not actively signed in).
// role: 'ambassador' | 'admin'. Ambassador leans into belonging + their own
// impact (the invite-limit jump is the concrete, exciting part); admin leans
// into stewardship/responsibility — a different kind of trust, not a party.
// Design approved by the founder via mockup iteration before this shipped.
export function congratsEmail({ role }) {
  const isAdmin = role === 'admin';
  const heading = isAdmin ? "You've got a hand on the wheel now." : "Welcome to the inner circle.";
  const bodyMain = isAdmin
    ? "You can review the waitlist, grant access, and manage ambassadors — the decisions that shape who's part of Marro from the very start."
    : "Marro doesn't grow without people like you — students who think med school shouldn't feel like a financial black box, and are willing to bring their friends along.";
  const bodySecondary = isAdmin
    ? "Marro is early. That's exactly why this matters: the choices made now about who gets in, and how it feels to join, are the ones that define what this becomes. Thank you for building it with us."
    : "Every person you invite makes the picture clearer for the one after them — that's what actually moves this forward.";
  const cta = isAdmin ? 'Open the admin console' : 'Invite your first friend';
  const inner = `
    <tr><td style="padding:16px 32px 0 32px;">${rolePill(isAdmin ? 'Admin' : 'Ambassador')}</td></tr>
    <tr><td style="padding:14px 32px 0 32px;">
      <div style="font-family:Newsreader,Georgia,'Times New Roman',serif;font-size:20px;line-height:1.35;color:${C.cream};">${escapeHtml(heading)}</div>
    </td></tr>
    <tr><td style="padding:12px 32px 0 32px;">
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14.5px;line-height:1.65;color:${C.cream};">${escapeHtml(bodyMain)}</div>
    </td></tr>
    <tr><td style="padding:10px 32px 0 32px;">
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13.5px;line-height:1.6;color:${C.muted};">${escapeHtml(bodySecondary)}</div>
    </td></tr>
    ${isAdmin ? '' : `<tr><td style="padding:16px 32px 0 32px;">${upgradeStat()}</td></tr>`}
    <tr><td style="padding:22px 32px 0 32px;">${ctaLink(cta, 'https://joinmarro.com/')}</td></tr>`;
  return shell(inner, "You're getting this because your role on Marro just changed. If this wasn't you, please let us know.");
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
