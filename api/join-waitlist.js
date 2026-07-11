// Vercel serverless function — joins the current user to the waitlist AND
// sends the confirmation email (bug 1 fix).
//
// WHY THIS EXISTS: joinWaitlist() used to be a pure client-side
// `sb.from('waitlist').upsert(...)` — it wrote the row via RLS but had no way
// to trigger a transactional email (the browser can't hold RESEND_API_KEY —
// CLAUDE.md rule 4). That's the actual root cause of "waitlist confirmation
// email not working": nothing in the codebase ever called sendEmail() for
// this event. Moving the write server-side (service role) lets us send the
// confirmation in the same request, with real error visibility (logged, not
// swallowed) instead of a client insert that "succeeds" while email quietly
// never happens.
//
// TRUST BOUNDARY (same pattern as api/send-invite.js / api/admin.js):
//   - The caller sends their own Supabase access token in `Authorization: Bearer <token>`.
//   - We verify that token server-side (anon-key client's auth.getUser) — the
//     uid/email that comes back is Supabase's own verification, never trusted
//     client input. A user can only ever join THEMSELVES onto the waitlist.
//   - SUPABASE_SERVICE_ROLE_KEY is read only from process.env.
//
// IDEMPOTENT: re-submitting (e.g. a duplicate tap) upserts the row again but
// only sends the confirmation email on a genuinely NEW row, so resubmitting
// never spams the person with repeat "you're on the waitlist" emails.

import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './_config.js';
import { sendEmail, waitlistConfirmEmail } from './_email.js';

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
    console.error('join-waitlist: missing SUPABASE_SERVICE_ROLE_KEY env var');
    return res.status(500).json({ error: 'Server misconfigured' });
  }

  const verifier = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: userData, error: userErr } = await verifier.auth.getUser(token);
  if (userErr || !userData?.user) {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
  const userId = userData.user.id;
  const email = (userData.user.email || '').toLowerCase();
  if (!email) return res.status(400).json({ error: 'No email on this account' });

  const admin = createClient(SUPABASE_URL, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const reason = typeof body.reason === 'string' ? (body.reason.trim().slice(0, 500) || null) : null;

  try {
    const { data: existing, error: readErr } = await admin
      .from('waitlist').select('user_id').eq('user_id', userId).maybeSingle();
    if (readErr) throw readErr;
    const isNew = !existing;

    const { error: upsertErr } = await admin
      .from('waitlist')
      .upsert({ user_id: userId, email, reason }, { onConflict: 'user_id' });
    if (upsertErr) throw upsertErr;

    if (!isNew) {
      // Already on the waitlist (e.g. a duplicate submit, or updating their
      // reason) — don't re-send the confirmation.
      return res.status(200).json({ ok: true, emailed: false });
    }

    const { ok: emailed, error: sendErr } = await sendEmail({
      to: email,
      subject: "You're on the Marro waitlist",
      html: waitlistConfirmEmail(),
      type: 'waitlist_confirm',
    });
    if (!emailed) {
      // Non-fatal — they're on the waitlist either way — but this MUST be
      // visible in logs (the whole point of the bug 1 fix is that failures
      // used to vanish silently).
      console.error('join-waitlist: confirmation email failed', email, sendErr);
    }

    return res.status(200).json({ ok: true, emailed: !!emailed });
  } catch (e) {
    console.error('join-waitlist: action failed', e?.message);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
}
