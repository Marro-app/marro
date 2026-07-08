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
// Deletes, in order: `app_state` row, `profiles` row, `waitlist` row,
// `user_notifications` rows, then the `auth.users` row via the Admin API.
//
// PRODUCT CHOICE (owner decision, ambassador/admin overhaul): `allowed_emails`
// is deliberately KEPT, not deleted. If this person signs back in later with the
// same email, they skip the invite gate — deleting your account isn't supposed
// to cost you your spot. (Their app data does NOT come back, though: app_state/
// profiles are gone and a fresh signup gets a brand-new auth uid with no link
// back to the old one — "keep the gate open, not the data.")
//
// C2 SECURITY FIX (audit): `admins` and `user_roles` (ambassador flag / invite
// overrides) ARE deleted here, unlike allowed_emails. Both are keyed by email
// with no FK to auth.users, so previously a deleted admin's or ambassador's
// privilege silently persisted and reactivated the moment that email signed up
// again — a privilege-persistence hole. Access surviving deletion is a product
// choice; ADMIN/AMBASSADOR RIGHTS surviving deletion is a security bug, so
// those two always get wiped regardless of the allowed_emails choice above.
//
// Best-effort on all pre-auth-delete steps (log + continue) so a transient error
// on one table can't leave an orphaned auth user with no way to ever re-delete
// their remaining rows — but the final admin.deleteUser call's result IS the
// thing we report to the caller.

import { createClient } from '@supabase/supabase-js';
// Side-effect-free config mirror (audit M3) — see api/_config.js for why this
// is no longer imported from src/lib/data.js (that module's bottom IIFE runs a
// window-referencing setInterval at import time, which throws in the Node
// serverless runtime).
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './_config.js';

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

  const { error: waitlistErr } = await admin.from('waitlist').delete().eq('user_id', uid);
  if (waitlistErr) console.error('delete-account: waitlist delete failed', uid, waitlistErr.message);

  // allowed_emails is INTENTIONALLY NOT deleted — see the product-choice note
  // at the top of this file. admins/user_roles/user_notifications ARE deleted
  // regardless (C2 fix — privilege must never silently survive deletion).
  if (email) {
    const { error: rolesErr } = await admin.from('user_roles').delete().eq('email', email);
    if (rolesErr) console.error('delete-account: user_roles delete failed', email, rolesErr.message);

    const { error: adminsErr } = await admin.from('admins').delete().eq('email', email);
    if (adminsErr) console.error('delete-account: admins delete failed', email, adminsErr.message);

    const { error: notifErr } = await admin.from('user_notifications').delete().eq('email', email);
    if (notifErr) console.error('delete-account: user_notifications delete failed', email, notifErr.message);
  }

  const { error: adminDeleteErr } = await admin.auth.admin.deleteUser(uid);
  if (adminDeleteErr) {
    console.error('delete-account: auth.admin.deleteUser failed', uid, adminDeleteErr.message);
    return res.status(500).json({ error: 'Failed to delete account. Please try again.' });
  }

  return res.status(200).json({ ok: true });
}
