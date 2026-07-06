// Vercel serverless function — self-serve account deletion.
//
// WHY THIS EXISTS: a normal (anon-key) Supabase client can never delete its own
// auth.users row — that requires the Admin API (`auth.admin.deleteUser`) with the
// SERVICE-ROLE key, which must never reach the browser bundle (repo is public —
// see CLAUDE.md rule 4). This is the first backend reintroduced since the old
// `api/sync.js` was deleted (see docs/HISTORY.md); it exists ONLY for this one
// admin-only operation, not as a general API surface.
//
// TRUST BOUNDARY (read this before touching the file):
//   - The caller sends their own Supabase access token in `Authorization: Bearer <token>`.
//   - We verify that token server-side, using an ANON-key client's `auth.getUser(token)`.
//     This returns the uid Supabase itself has authenticated for that token — it is
//     NOT trusted client input. We never read a user id out of the request body.
//   - Only after that verification do we use the SERVICE-ROLE client (which bypasses
//     RLS) to delete rows for that verified uid, then delete the auth.users row itself.
//   - SUPABASE_SERVICE_ROLE_KEY is a Vercel environment variable, read only from
//     process.env — never hardcoded, never logged, never echoed in a response.
//
// Deletes, in order: `app_state` row, `profiles` row, `allowed_emails` row (by the
// user's verified email), then the `auth.users` row via the Admin API. Best-effort
// on the data-table deletes (log + continue) so a transient error on one table can't
// leave an orphaned auth user with no way to ever re-delete their remaining rows —
// but the final admin.deleteUser call's result IS the thing we report to the caller.

import { createClient } from '@supabase/supabase-js';
// Reuse the single source of truth for the publishable URL/key (src/lib/data.js)
// instead of duplicating the literal here — same value already hardcoded in
// index.html / src/lib/data.js, safe to reuse (RLS-gated, not secret; see
// CLAUDE.md rule 4). This import only pulls the two string constants, not the
// lazy getSupabase()/client-only helpers in that file.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../src/lib/data.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'] || req.headers['Authorization'];
  const token = typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
    ? authHeader.slice(7).trim()
    : null;
  if (!token) {
    return res.status(401).json({ error: 'Missing bearer token' });
  }

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    console.error('delete-account: missing SUPABASE_SERVICE_ROLE_KEY env var');
    return res.status(500).json({ error: 'Server misconfigured' });
  }

  // Step 1 — verify the token server-side. This is the ONLY source of truth for
  // "who is making this request." The uid/email below come from Supabase's own
  // verification of the token, never from anything the client typed into the body.
  const verifier = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: userData, error: userErr } = await verifier.auth.getUser(token);
  if (userErr || !userData?.user) {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
  const uid = userData.user.id;
  const email = (userData.user.email || '').toLowerCase();

  // Step 2 — service-role client, used ONLY from here on, ONLY for this verified uid.
  const admin = createClient(SUPABASE_URL, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Best-effort cleanup of app data first (each independently logged, none blocks
  // the others) — then the irreversible auth.users deletion last.
  const { error: stateErr } = await admin.from('app_state').delete().eq('user_id', uid);
  if (stateErr) console.error('delete-account: app_state delete failed', uid, stateErr.message);

  const { error: profileErr } = await admin.from('profiles').delete().eq('user_id', uid);
  if (profileErr) console.error('delete-account: profiles delete failed', uid, profileErr.message);

  if (email) {
    const { error: allowedErr } = await admin.from('allowed_emails').delete().eq('email', email);
    if (allowedErr) console.error('delete-account: allowed_emails delete failed', email, allowedErr.message);
  }

  const { error: adminDeleteErr } = await admin.auth.admin.deleteUser(uid);
  if (adminDeleteErr) {
    console.error('delete-account: auth.admin.deleteUser failed', uid, adminDeleteErr.message);
    return res.status(500).json({ error: 'Failed to delete account. Please try again.' });
  }

  return res.status(200).json({ ok: true });
}
