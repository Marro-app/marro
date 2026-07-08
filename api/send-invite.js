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
      .select('code, owner_id, redeemed_at, revoked_at')
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
      return res.status(502).json({ error: sendErr || 'Email could not be sent. Please try again.' });
    }
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('send-invite: action failed', e?.message);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
}
