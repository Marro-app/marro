// Vercel serverless function — admin console backend.
//
// WHY THIS EXISTS: the admin console needs to read/write tables that regular
// clients cannot touch (all invite_codes, the full waitlist, user_roles, admins)
// and to mint/revoke codes on other users' behalf. Those tables are RLS-locked
// or client-inaccessible by design (see supabase/invites_waitlist.sql), so the
// work must run with the SERVICE-ROLE key, which must never reach the browser
// bundle (repo is public — CLAUDE.md rule 4). This is the second admin-only
// backend after api/delete-account.js and follows the exact same trust boundary.
//
// TRUST BOUNDARY (read before touching this file):
//   - The caller sends their own Supabase access token in `Authorization: Bearer <token>`.
//   - We verify that token with an ANON-key client's `auth.getUser(token)` — the
//     email that comes back is authenticated by Supabase, NOT trusted client input.
//   - We then re-check that email against the `admins` table using the SERVICE-ROLE
//     client. is_admin() on the client is only for showing/hiding the console; THIS
//     server-side check is the real authorization border. A non-admin gets 403.
//   - Only after both checks do we dispatch the requested action with the
//     service-role client (which bypasses RLS).
//   - SUPABASE_SERVICE_ROLE_KEY is a Vercel env var (already set — reused from
//     api/delete-account.js); read only from process.env, never hardcoded/logged.

import { createClient } from '@supabase/supabase-js';
// Reuse the single source of truth for the publishable URL/key (safe to reuse —
// RLS-gated, not secret; see CLAUDE.md rule 4 and api/delete-account.js).
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../src/lib/data.js';

// Bounded reads so the overview payload can't blow up as the beta grows.
const LIST_LIMIT = 500;
const MAX_GENERATE = 100; // most codes a single generate_codes call may mint

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
    console.error('admin: missing SUPABASE_SERVICE_ROLE_KEY env var');
    return res.status(500).json({ error: 'Server misconfigured' });
  }

  // Step 1 — verify the token server-side. The email here is Supabase's own
  // verification of the token, never anything the client typed into the body.
  const verifier = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: userData, error: userErr } = await verifier.auth.getUser(token);
  if (userErr || !userData?.user) {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
  const callerEmail = (userData.user.email || '').toLowerCase();
  const callerId = userData.user.id;

  // Step 2 — service-role client + the REAL admin authorization check.
  const admin = createClient(SUPABASE_URL, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: adminRow, error: adminErr } = await admin
    .from('admins').select('email').eq('email', callerEmail).maybeSingle();
  if (adminErr) {
    console.error('admin: admins lookup failed', adminErr.message);
    return res.status(500).json({ error: 'Server error' });
  }
  if (!adminRow) return res.status(403).json({ error: 'Not authorized' });

  // Step 3 — dispatch. Everything below runs as an authenticated admin.
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const action = body.action;

  try {
    switch (action) {
      case 'list_overview': {
        // A snapshot for the console: codes (+ redemption status), waitlist,
        // roles, and the admin list. Bounded; newest first.
        const [codes, waitlist, roles, admins] = await Promise.all([
          admin.from('invite_codes')
            .select('code, owner_id, created_at, redeemed_by, redeemed_email, redeemed_at, revoked_at')
            .order('created_at', { ascending: false }).limit(LIST_LIMIT),
          admin.from('waitlist')
            .select('user_id, email, reason, created_at')
            .order('created_at', { ascending: false }).limit(LIST_LIMIT),
          admin.from('user_roles')
            .select('email, is_ambassador, quota_override, updated_at')
            .order('updated_at', { ascending: false }).limit(LIST_LIMIT),
          admin.from('admins')
            .select('email, added_by, created_at')
            .order('created_at', { ascending: true }).limit(LIST_LIMIT),
        ]);
        const firstErr = codes.error || waitlist.error || roles.error || admins.error;
        if (firstErr) throw firstErr;

        // Resolve each code's owner_id → email so the console shows a human name
        // instead of a raw uuid. Best-effort: one paged listUsers (fine for the
        // closed beta's user count); on any failure we just omit owner_email and
        // the client falls back to the truncated id.
        const codeRows = codes.data || [];
        let ownerEmailById = {};
        if (codeRows.length) {
          try {
            const { data: usersPage } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
            for (const u of usersPage?.users || []) ownerEmailById[u.id] = u.email;
          } catch (e) {
            console.error('admin: listUsers for owner emails failed', e?.message);
          }
        }
        const codesWithOwner = codeRows.map(c => ({ ...c, owner_email: ownerEmailById[c.owner_id] || null }));

        return res.status(200).json({
          ok: true,
          codes: codesWithOwner, waitlist: waitlist.data,
          roles: roles.data, admins: admins.data,
        });
      }

      case 'generate_codes': {
        // Mint N codes attributed to the admin who created them. These are
        // admin-issued (not counted against anyone's member quota).
        const count = Math.max(1, Math.min(MAX_GENERATE, parseInt(body.count, 10) || 1));
        const minted = [];
        // Insert one at a time so a collision on one code can't fail the batch;
        // the DB primary key guarantees uniqueness, we retry on conflict.
        for (let i = 0; i < count; i++) {
          for (let attempt = 0; attempt < 5; attempt++) {
            const code = randomCode(8);
            const { error } = await admin.from('invite_codes')
              .insert({ code, owner_id: callerId });
            if (!error) { minted.push(code); break; }
            if (!/duplicate key|unique/i.test(error.message)) throw error;
          }
        }
        return res.status(200).json({ ok: true, codes: minted });
      }

      case 'revoke_code': {
        const code = String(body.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (!code) return res.status(400).json({ error: 'Missing code' });
        // Only unredeemed codes can be revoked (revoking a used one is meaningless).
        const { data, error } = await admin.from('invite_codes')
          .update({ revoked_at: new Date().toISOString() })
          .eq('code', code).is('redeemed_by', null).is('revoked_at', null)
          .select('code');
        if (error) throw error;
        return res.status(200).json({ ok: true, revoked: (data && data.length) > 0 });
      }

      case 'set_role': {
        const email = String(body.email || '').toLowerCase().trim();
        if (!email) return res.status(400).json({ error: 'Missing email' });
        const row = { email, updated_by: callerEmail, updated_at: new Date().toISOString() };
        if (typeof body.is_ambassador === 'boolean') row.is_ambassador = body.is_ambassador;
        if (body.quota_override === null) row.quota_override = null;
        else if (body.quota_override !== undefined) {
          const q = parseInt(body.quota_override, 10);
          if (Number.isNaN(q) || q < 0) return res.status(400).json({ error: 'Invalid quota' });
          row.quota_override = q;
        }
        const { error } = await admin.from('user_roles').upsert(row, { onConflict: 'email' });
        if (error) throw error;
        return res.status(200).json({ ok: true });
      }

      case 'add_admin': {
        const email = String(body.email || '').toLowerCase().trim();
        if (!email) return res.status(400).json({ error: 'Missing email' });
        const { error } = await admin.from('admins')
          .insert({ email, added_by: callerEmail });
        if (error && !/duplicate key|unique/i.test(error.message)) throw error;
        return res.status(200).json({ ok: true });
      }

      case 'remove_admin': {
        const email = String(body.email || '').toLowerCase().trim();
        if (!email) return res.status(400).json({ error: 'Missing email' });
        // Guard against removing the last admin (would lock everyone out).
        if (email === callerEmail) {
          return res.status(400).json({ error: "You can't remove your own admin access." });
        }
        const { error } = await admin.from('admins').delete().eq('email', email);
        if (error) throw error;
        return res.status(200).json({ ok: true });
      }

      default:
        return res.status(400).json({ error: 'Unknown action' });
    }
  } catch (e) {
    console.error('admin: action failed', action, e?.message);
    return res.status(500).json({ error: 'Action failed. Please try again.' });
  }
}

// Same unambiguous alphabet as gen_code_string() in supabase/invites_waitlist.sql
// (no 0/O/1/I/L). Kept in sync intentionally — codes minted here and by the RPC
// must be indistinguishable to redeemers.
function randomCode(n) {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < n; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}
