// Vercel serverless function — a member/ambassador emails one of their OWN
// unused invite codes to someone (feature: "click a button by the code,
// generate an email popup, send it").
//
// TRUST BOUNDARY (same pattern as api/admin.js / api/delete-account.js):
//   - The caller sends their own Supabase access token in `Authorization: Bearer <token>`.
//   - We verify that token server-side (anon-key client's auth.getUser) — the
//     uid/email that comes back is Supabase's own verification, never trusted
//     client input.
//   - We then check, with the SERVICE-ROLE client, that the code being emailed
//     actually belongs to THAT uid and is still unused/unrevoked. A member can
//     only email codes they own — this is not a general "send anyone an email"
//     endpoint.
//   - SUPABASE_SERVICE_ROLE_KEY is read only from process.env.
//
// RATE LIMIT: every member (not just admins) can trigger this, so it's capped
// at 20 sends / sender / 24h via invite_email_log (supabase/notifications.sql)
// to bound abuse — a generous ceiling for legitimate referral sharing, well
// below anything that could be used to spam.

import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './_config.js';
import { sendEmail, inviteCodeEmail } from './_email.js';

const RATE_LIMIT = 20; // sends per sender per 24h
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'] || req.headers['Authorization'];
  const token = typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
    ? authHeader.slice(7).trim()
    : null;
  if (!token) return res.status(401).json({ error: 'Missing bearer token' });

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    console.error('send-invite: missing SUPABASE_SERVICE_ROLE_KEY env var');
    return res.status(500).json({ error: 'Server misconfigured' });
  }

  const verifier = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: userData, error: userErr } = await verifier.auth.getUser(token);
  if (userErr || !userData?.user) {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
  const callerId = userData.user.id;

  const admin = createClient(SUPABASE_URL, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const code = String(body.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const toEmail = String(body.to_email || '').trim().toLowerCase();
  const message = typeof body.message === 'string' ? body.message.slice(0, 500) : '';

  if (!code) return res.status(400).json({ error: 'Missing code' });
  if (!toEmail || !EMAIL_RE.test(toEmail)) {
    return res.status(400).json({ error: 'Enter a valid email address.' });
  }

  try {
    // Ownership + status check — a member may only email their OWN unused,
    // unrevoked code. This is what stops the endpoint from being a generic
    // "email anything to anyone" relay.
    const { data: codeRow, error: codeErr } = await admin
      .from('invite_codes')
      .select('code, owner_id, redeemed_at, revoked_at, bound_email, last_sent_at')
      .eq('code', code)
      .maybeSingle();
    if (codeErr) throw codeErr;
    if (!codeRow || codeRow.owner_id !== callerId) {
      return res.status(404).json({ error: "That code wasn't found in your account." });
    }
    if (codeRow.redeemed_at) {
      return res.status(400).json({ error: 'That code has already been used.' });
    }
    if (codeRow.revoked_at) {
      return res.status(400).json({ error: 'That code has been revoked.' });
    }

    // Bug fix: once a code has been emailed to someone, it stays assigned to
    // that person — the "email this code" button must not become a way to
    // send the same single-use code to a different recipient. The client UI
    // already locks the recipient field once bound_email is set (see
    // InviteFriendsModal's resend-confirmation dialog); this is the
    // server-side backstop in case of a stale client or a direct API call.
    if (codeRow.bound_email && codeRow.bound_email !== toEmail) {
      return res.status(409).json({
        error: `This code is already assigned to ${codeRow.bound_email}. Resend it to them instead of a different address.`,
      });
    }

    // Bug fix: don't let a code be emailed to someone who already has a
    // Marro account — they don't need an invite, and it's confusing to send
    // them one. Checked via a SECURITY DEFINER RPC (service-role only) since
    // auth.users isn't reachable through the normal client.
    const { data: alreadyHasAccount, error: acctErr } = await admin.rpc('email_has_account', { p_email: toEmail });
    if (acctErr) throw acctErr;
    if (alreadyHasAccount) {
      return res.status(409).json({ error: 'That email already has a Marro account — no invite needed.' });
    }

    // Rate limit.
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count, error: countErr } = await admin
      .from('invite_email_log')
      .select('id', { count: 'exact', head: true })
      .eq('sender_id', callerId)
      .gte('created_at', since);
    if (countErr) throw countErr;
    if ((count || 0) >= RATE_LIMIT) {
      return res.status(429).json({ error: "You've sent a lot of invite emails today — try again tomorrow." });
    }

    const { ok: emailed, error: sendErr } = await sendEmail({
      to: toEmail,
      subject: "You're invited to Marro",
      html: inviteCodeEmail({ code, message }),
    });

    await admin.from('invite_email_log').insert({ sender_id: callerId, to_email: toEmail, code });

    if (!emailed) {
      // The code itself is still fine here — the send failed before anything
      // about the code changed. Say so, and point at the copy-code fallback
      // that's already rendered right next to this button, so the user isn't
      // just told "try again" with no other option in view.
      const reason = sendErr || 'Email could not be sent.';
      return res.status(502).json({ error: `${reason} Your invite code is still good — try again, or copy the code and share it yourself.` });
    }

    // Bind the code to this recipient (first send) / refresh the last-sent
    // stamp (resend to the same person) — see the bound_email comment in
    // supabase/invites_waitlist.sql. Best-effort: the email already went out,
    // so a failure here shouldn't be reported as a send failure.
    const { error: bindErr } = await admin
      .from('invite_codes')
      .update({ bound_email: toEmail, last_sent_at: new Date().toISOString() })
      .eq('code', code);
    if (bindErr) console.error('send-invite: failed to bind code to recipient', bindErr.message);

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('send-invite: action failed', e?.message);
    return res.status(500).json({ error: 'Something went wrong. Your invite code is still good — try again, or copy the code and share it yourself.' });
  }
}
