# Supabase Auth email templates (branded)

These are NOT wired up automatically — Supabase Auth email templates live in the
Supabase dashboard, not in this repo. Paste them in manually:

**Supabase dashboard → Authentication → Emails → Templates → pick the template → replace
Subject + Message body → Save.**

Two templates below: **Confirm signup** and **Reset Password**. Both use inline CSS only
(no `<style>` blocks — many email clients strip them) and explicit background colors on
every container so dark-mode email clients can't invert them into something unreadable.

## Design notes (why it looks like this)

- **Wordmark, not inline SVG.** Marro's real logo is an inline SVG ring mark (see
  `src/landing/scenes.jsx`'s `FounderSig`). Inline SVG support is inconsistent across email
  clients (Outlook in particular), so instead of gambling on that rendering broken, I used
  a text wordmark: **"Marro."** in Newsreader (with Georgia/serif fallback for clients that
  don't load web fonts), gold-colored period — same trick as `.lp-navbrand .lp-dot` on the
  landing page (`color:var(--lp-gold)` on the dot/period). This is the safer bet for a
  transactional email that has to render correctly everywhere, first try, no re-send.
- **Colors** pulled directly from `src/landing/landing.css`: `--lp-stage:#14150F` (card
  background), `--lp-cream:#FBF6E8` (body text + button fill), `--lp-gold:#DDA528` (accent),
  `rgba(248,242,226,.58)` (muted footer text, same as `--lp-cream40`). Outer background is
  `#0C0E0C` (`--lp-bg`), matching the landing page's darkest layer.
  Because dark-mode email clients only invert *transparent* or unstyled regions, every
  table cell below has an explicit `bgcolor` and inline `background`, so the layout can't
  flip into a broken half-inverted state.
- **Button** mirrors `.lp-btn-fill`: cream fill (`#FBF6E8`), dark text (`#14150F`), `12px`
  border-radius, bold, padded — built as a table cell (not a flex/grid div) since Outlook's
  Word rendering engine ignores those.
- **Voice**: short, plain-language, no jargon — matching the landing copy's register (e.g.
  "It starts with one intimidating number," "No spreadsheet required"). The confirm email
  says plainly why you're getting it and what the button does; no marketing filler.
- **Layout**: single-column table, `560px` max width, generous padding, works in Outlook /
  Gmail / Apple Mail because it avoids flexbox, grid, and background-image tricks entirely.

---

## Template 1: Confirm signup

**Subject:**
```
Confirm your email for Marro
```

**Message body (HTML):**
```html
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0C0E0C;padding:40px 16px;">
  <tr>
    <td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%;background:#14150F;border-radius:16px;overflow:hidden;">
        <tr>
          <td style="padding:40px 40px 24px 40px;" bgcolor="#14150F">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="font-family:'Newsreader',Georgia,'Times New Roman',serif;font-size:22px;font-weight:600;color:#FBF6E8;letter-spacing:-0.3px;">
                  Marro<span style="color:#DDA528;">.</span>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:8px 40px 0 40px;" bgcolor="#14150F">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
              <tr>
                <td style="font-family:'Newsreader',Georgia,'Times New Roman',serif;font-size:26px;line-height:1.3;color:#FBF6E8;font-weight:600;padding-bottom:16px;">
                  Confirm your email
                </td>
              </tr>
              <tr>
                <td style="font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:rgba(248,242,226,0.82);padding-bottom:32px;">
                  Tap the button below to confirm <strong style="color:#FBF6E8;">{{ .Email }}</strong> and finish setting up your Marro account.
                </td>
              </tr>
              <tr>
                <td style="padding-bottom:32px;">
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                    <tr>
                      <td align="center" bgcolor="#FBF6E8" style="border-radius:12px;">
                        <a href="{{ .ConfirmationURL }}" style="display:inline-block;padding:14px 28px;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;font-weight:600;color:#14150F;text-decoration:none;border-radius:12px;">
                          Confirm email
                        </a>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
              <tr>
                <td style="font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:13px;line-height:1.6;color:rgba(248,242,226,0.58);padding-bottom:8px;">
                  If the button doesn't work, copy and paste this link into your browser:
                </td>
              </tr>
              <tr>
                <td style="font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:13px;line-height:1.6;word-break:break-all;padding-bottom:32px;">
                  <a href="{{ .ConfirmationURL }}" style="color:#82AEDB;text-decoration:underline;">{{ .ConfirmationURL }}</a>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:20px 40px 32px 40px;border-top:1px solid rgba(246,239,221,0.12);" bgcolor="#14150F">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
              <tr>
                <td style="font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:13px;line-height:1.6;color:rgba(248,242,226,0.58);padding-top:16px;">
                  If you didn't request this, you can safely ignore this email.
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
```

---

## Template 2: Reset Password

Not wired up in the app yet (no reset-password flow built), but the template is ready to
paste in whenever that ships — same `{{ .ConfirmationURL }}` variable, Supabase's recovery
template just points it at the reset-password page instead of the confirm endpoint.

**Subject:**
```
Reset your Marro password
```

**Message body (HTML):**
```html
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0C0E0C;padding:40px 16px;">
  <tr>
    <td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%;background:#14150F;border-radius:16px;overflow:hidden;">
        <tr>
          <td style="padding:40px 40px 24px 40px;" bgcolor="#14150F">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="font-family:'Newsreader',Georgia,'Times New Roman',serif;font-size:22px;font-weight:600;color:#FBF6E8;letter-spacing:-0.3px;">
                  Marro<span style="color:#DDA528;">.</span>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:8px 40px 0 40px;" bgcolor="#14150F">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
              <tr>
                <td style="font-family:'Newsreader',Georgia,'Times New Roman',serif;font-size:26px;line-height:1.3;color:#FBF6E8;font-weight:600;padding-bottom:16px;">
                  Reset your password
                </td>
              </tr>
              <tr>
                <td style="font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:rgba(248,242,226,0.82);padding-bottom:32px;">
                  Someone requested a password reset for <strong style="color:#FBF6E8;">{{ .Email }}</strong>. Tap the button below to choose a new one. The link expires soon, so don't wait too long.
                </td>
              </tr>
              <tr>
                <td style="padding-bottom:32px;">
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                    <tr>
                      <td align="center" bgcolor="#FBF6E8" style="border-radius:12px;">
                        <a href="{{ .ConfirmationURL }}" style="display:inline-block;padding:14px 28px;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;font-weight:600;color:#14150F;text-decoration:none;border-radius:12px;">
                          Reset password
                        </a>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
              <tr>
                <td style="font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:13px;line-height:1.6;color:rgba(248,242,226,0.58);padding-bottom:8px;">
                  If the button doesn't work, copy and paste this link into your browser:
                </td>
              </tr>
              <tr>
                <td style="font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:13px;line-height:1.6;word-break:break-all;padding-bottom:32px;">
                  <a href="{{ .ConfirmationURL }}" style="color:#82AEDB;text-decoration:underline;">{{ .ConfirmationURL }}</a>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:20px 40px 32px 40px;border-top:1px solid rgba(246,239,221,0.12);" bgcolor="#14150F">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
              <tr>
                <td style="font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:13px;line-height:1.6;color:rgba(248,242,226,0.58);padding-top:16px;">
                  If you didn't request this, you can safely ignore this email — your password won't change.
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
```

---

## How to apply

1. Go to your Supabase project → **Authentication → Emails → Templates**.
2. Select **Confirm signup**. Replace the **Subject** field with the subject above, and
   replace the **Message body** with the "Confirm signup" HTML block above. Save.
3. Select **Reset Password**. Repeat with the "Reset Password" subject + HTML block. Save.
4. Send yourself a test signup (and later, once the reset-password flow exists, a test
   reset) to confirm both render correctly in your own inbox.
