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
// Side-effect-free config mirror (audit M3) — see api/_config.js for why this
// is no longer imported from src/lib/data.js.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './_config.js';
import { sendEmail, inviteCodeEmail, waitlistInviteEmail, congratsEmail, countEmailUsage, EMAIL_CAPS } from './_email.js';

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
        // A snapshot for the console: codes, waitlist, ambassadors, members,
        // and admins — enriched with names/avatars/computed stats so the UI
        // can render rich cards without a second round trip.
        const [codes, waitlist, roles, admins, allowed] = await Promise.all([
          admin.from('invite_codes')
            .select('code, owner_id, created_at, redeemed_by, redeemed_email, redeemed_at, revoked_at, issued_by_admin, archived_at, bound_email')
            .order('created_at', { ascending: false }).limit(LIST_LIMIT),
          admin.from('waitlist')
            .select('user_id, email, reason, created_at, invited_at, invite_count, last_invited_at')
            .order('created_at', { ascending: false }).limit(LIST_LIMIT),
          admin.from('user_roles')
            .select('email, is_ambassador, quota_override, note, school, updated_by, updated_at')
            .order('updated_at', { ascending: false }).limit(LIST_LIMIT),
          admin.from('admins')
            .select('email, added_by, created_at')
            .order('created_at', { ascending: true }).limit(LIST_LIMIT),
          admin.from('allowed_emails')
            .select('email, note, invited_by, created_at')
            .order('created_at', { ascending: false }).limit(LIST_LIMIT),
        ]);
        const firstErr = codes.error || waitlist.error || roles.error || admins.error || allowed.error;
        if (firstErr) throw firstErr;

        // Resolve every known user's email → {id, name, avatar} once so the
        // console can show human names/pictures instead of raw uuids/bare
        // emails everywhere (owner, redeemer, waitlist, ambassador, member).
        // Best-effort: on any failure we omit the enrichment and the client
        // falls back to showing the raw email/id.
        let byEmail = {};
        let byId = {};
        try {
          const { data: usersPage } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
          for (const u of usersPage?.users || []) {
            const meta = u.user_metadata || {};
            const info = {
              id: u.id,
              email: (u.email || '').toLowerCase(),
              name: meta.full_name || meta.name || null,
              avatar: meta.avatar_url || meta.picture || null,
            };
            if (info.email) byEmail[info.email] = info;
            byId[u.id] = info;
          }
        } catch (e) {
          console.error('admin: listUsers for name/avatar enrichment failed', e?.message);
        }

        const codeRows = codes.data || [];
        const codesWithOwner = codeRows.map(c => {
          const owner = byId[c.owner_id];
          return {
            ...c,
            owner_email: owner?.email || null,
            owner_name: owner?.name || null,
            owner_avatar: owner?.avatar || null,
          };
        });

        const waitlistEnriched = (waitlist.data || []).map(w => {
          const u = byEmail[(w.email || '').toLowerCase()];
          return { ...w, name: u?.name || null, avatar: u?.avatar || null };
        });

        const adminsEnriched = (admins.data || []).map(a => {
          const u = byEmail[a.email];
          return { ...a, name: u?.name || null, avatar: u?.avatar || null };
        });

        // Per-owner code stats for the ambassador cards: PERSONAL codes only
        // (issued_by_admin = false) — console-minted bulk codes don't belong
        // to anyone's personal invite stats (audit H4 fix).
        const statsByEmail = {};
        for (const c of codeRows) {
          if (c.issued_by_admin) continue;
          const owner = byId[c.owner_id];
          const email = owner?.email;
          if (!email) continue;
          if (!statsByEmail[email]) statsByEmail[email] = { issued: 0, used: 0 };
          if (!c.revoked_at) statsByEmail[email].issued++;
          if (c.redeemed_at) statsByEmail[email].used++;
        }

        // Ambassadors: anyone with a user_roles row (ambassador flag and/or a
        // custom invite-limit override). "brought_in" = how many of their
        // personal codes were actually redeemed — the real measure of an
        // ambassador, not how many codes they hold.
        const ambassadors = (roles.data || []).map(r => {
          const u = byEmail[r.email];
          const stats = statsByEmail[r.email] || { issued: 0, used: 0 };
          const effectiveLimit = r.quota_override != null ? r.quota_override : (r.is_ambassador ? 15 : 5);
          return {
            email: r.email,
            name: u?.name || null,
            avatar: u?.avatar || null,
            joined: !!u,
            is_ambassador: r.is_ambassador,
            invite_limit: effectiveLimit,
            codes_issued: stats.issued,
            codes_used: stats.used,
            brought_in: stats.used,
            note: r.note || null,
            school: r.school || null,
            updated_by: r.updated_by,
            updated_at: r.updated_at,
          };
        });

        // Members: everyone with app access via allowed_emails (the gate
        // table). Admins/ambassadors get access without a row here (is_email_
        // allowed() also checks admins/user_roles) so they're flagged
        // separately rather than listed as "members" to avoid double-counting.
        // Real role signals for each member, cross-referenced from the roles/
        // admins data already fetched above (no extra queries). The frontend
        // renders proper badges from these — it must NOT infer role from the
        // free-text `note` field anymore (note is now only ever admin-typed).
        const ambassadorEmails = new Set(
          (roles.data || [])
            .filter(r => r.is_ambassador === true)
            .map(r => (r.email || '').toLowerCase())
        );
        const adminEmails = new Set(
          (admins.data || []).map(a => (a.email || '').toLowerCase())
        );
        const members = (allowed.data || []).map(m => {
          const u = byEmail[m.email];
          const inviter = m.invited_by ? byId[m.invited_by] : null;
          const emailLc = (m.email || '').toLowerCase();
          return {
            email: m.email,
            name: u?.name || null,
            avatar: u?.avatar || null,
            joined: !!u,
            note: m.note || null,
            is_ambassador: ambassadorEmails.has(emailLc),
            is_admin: adminEmails.has(emailLc),
            invited_by_email: inviter?.email || null,
            created_at: m.created_at,
          };
        });

        return res.status(200).json({
          ok: true,
          codes: codesWithOwner,
          waitlist: waitlistEnriched,
          roles: roles.data,
          admins: adminsEnriched,
          ambassadors,
          members,
        });
      }

      case 'generate_codes': {
        // Mint N codes attributed to the admin who created them, flagged
        // issued_by_admin so they don't eat the admin's PERSONAL referral
        // invites (audit H4 — these used to silently count against the
        // minting admin's own 5/15 limit).
        const count = Math.max(1, Math.min(MAX_GENERATE, parseInt(body.count, 10) || 1));
        const minted = [];
        // Insert one at a time so a collision on one code can't fail the batch;
        // the DB primary key guarantees uniqueness, we retry on conflict.
        for (let i = 0; i < count; i++) {
          for (let attempt = 0; attempt < 5; attempt++) {
            const code = randomCode(8);
            const { error } = await admin.from('invite_codes')
              .insert({ code, owner_id: callerId, issued_by_admin: true });
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
          .eq('code', code).is('redeemed_at', null).is('revoked_at', null)
          .select('code, owner_id, issued_by_admin');
        if (error) throw error;
        const revokedRow = data && data[0];
        if (revokedRow && !revokedRow.issued_by_admin) {
          const owner = await resolveEmail(admin, revokedRow.owner_id);
          if (owner) await notify(admin, owner, 'role', 'An invite code you created was revoked by an admin.', { code });
        }
        return res.status(200).json({ ok: true, revoked: !!revokedRow });
      }

      case 'archive_code': {
        // Hide ANY code (unused, used, or revoked) from the console's default
        // view — bug fix: this used to require revoked_at first, so a
        // used/redeemed code (the vast majority of old codes, over time)
        // could never be tidied away. Archiving is purely a console-visibility
        // flag (archived_at) — it never touches redeemed_at/revoked_at, so it
        // can't un-redeem a single-use code or resurrect a revoked one.
        const code = String(body.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (!code) return res.status(400).json({ error: 'Missing code' });
        const { data, error } = await admin.from('invite_codes')
          .update({ archived_at: new Date().toISOString() })
          .eq('code', code).is('archived_at', null)
          .select('code');
        if (error) throw error;
        return res.status(200).json({ ok: true, archived: (data && data.length) > 0 });
      }

      case 'unarchive_code': {
        // Reverse of archive_code — clears the visibility flag only, same
        // "purely cosmetic" scope (never touches redeemed_at/revoked_at).
        const code = String(body.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (!code) return res.status(400).json({ error: 'Missing code' });
        const { data, error } = await admin.from('invite_codes')
          .update({ archived_at: null })
          .eq('code', code).not('archived_at', 'is', null)
          .select('code');
        if (error) throw error;
        return res.status(200).json({ ok: true, unarchived: (data && data.length) > 0 });
      }

      case 'remove_from_waitlist': {
        const email = String(body.email || '').toLowerCase().trim();
        if (!email) return res.status(400).json({ error: 'Missing email' });
        const { error } = await admin.from('waitlist').delete().eq('email', email);
        if (error) throw error;
        return res.status(200).json({ ok: true });
      }

      case 'invite_from_waitlist': {
        // Mint one admin-issued code BOUND to this waitlisted person's email
        // (only they can redeem it) and email it to them. Keeps the waitlist
        // row (stamped with invite history) so the admin can see who's already
        // been reached; remove_from_waitlist is the separate "drop them".
        const email = String(body.email || '').toLowerCase().trim();
        if (!email) return res.status(400).json({ error: 'Missing email' });

        // Re-invite hygiene: revoke any still-outstanding code we previously
        // sent THIS person from THIS action, so they never accumulate multiple
        // live codes. Only unredeemed + unrevoked admin-bound codes are touched.
        let reinvite = false;
        {
          const { data: revokedRows, error: revokeErr } = await admin
            .from('invite_codes')
            .update({ revoked_at: new Date().toISOString() })
            .eq('bound_email', email)
            .eq('issued_by_admin', true)
            .is('redeemed_at', null)
            .is('revoked_at', null)
            .select('code');
          if (revokeErr) {
            // Non-critical cleanup — log and continue with the fresh mint.
            console.error('admin invite_from_waitlist: prior-code revoke failed', email, revokeErr.message);
          } else {
            reinvite = (revokedRows && revokedRows.length) > 0;
          }
        }

        let code;
        for (let attempt = 0; attempt < 5; attempt++) {
          const candidate = randomCode(8);
          const { error } = await admin.from('invite_codes')
            .insert({ code: candidate, owner_id: callerId, issued_by_admin: true, bound_email: email });
          if (!error) { code = candidate; break; }
          if (!/duplicate key|unique/i.test(error.message)) throw error;
        }
        if (!code) throw new Error('Could not mint a unique code');

        // Stamp invite history: first-invite timestamp is set once and never
        // clobbered; invite_count increments; last_invited_at tracks the most
        // recent send. Best-effort — the code is already minted/emailed either way.
        const nowIso = new Date().toISOString();
        const { data: wlRow, error: wlReadErr } = await admin.from('waitlist')
          .select('invited_at, invite_count').eq('email', email).maybeSingle();
        if (wlReadErr) {
          console.error('admin invite_from_waitlist: waitlist read failed', email, wlReadErr.message);
        }
        const { error: wlUpdErr } = await admin.from('waitlist')
          .update({
            invited_at: wlRow?.invited_at || nowIso,
            last_invited_at: nowIso,
            invite_count: (wlRow?.invite_count || 0) + 1,
          })
          .eq('email', email);
        if (wlUpdErr) console.error('admin invite_from_waitlist: waitlist update failed', email, wlUpdErr.message);

        const { ok: emailed, error: sendErr, rateLimited } = await sendEmail({
          to: email,
          subject: "You're off the waitlist — welcome to Marro",
          html: waitlistInviteEmail({ code }),
          type: 'waitlist_invite',
        });
        // Bug fix: a failed send used to be silently discarded (only `ok` was
        // destructured) — the console DID surface res.emailed===false to the
        // admin, but nothing ever logged WHY it failed, making the Resend-side
        // failure invisible outside a support conversation. Log it like every
        // other best-effort send in this file.
        if (!emailed) console.error('admin invite_from_waitlist: email send failed', email, sendErr);
        // No in-app notify() here: the recipient has no app access yet (they
        // haven't redeemed), so they can never sign in to see it. The email
        // (waitlistInviteEmail via Resend) IS the notification channel.

        // `email_error` lets the console say WHY the email was skipped (e.g.
        // the plan-level cap in _email.js) next to the mint-succeeded state,
        // instead of a generic "failed to send". The invite itself is intact:
        // the code is minted + bound, so re-inviting later just re-sends it.
        return res.status(200).json({ ok: true, code, emailed, reinvite, ...(emailed ? {} : { email_error: sendErr, rate_limited: !!rateLimited }) });
      }

      case 'grant_access': {
        // Directly allow an email in, bypassing the code flow (e.g. a manual
        // one-off invite from the Members section).
        const email = String(body.email || '').toLowerCase().trim();
        if (!email) return res.status(400).json({ error: 'Missing email' });
        const { error } = await admin.from('allowed_emails')
          .upsert({ email, note: body.note || 'admin granted', invited_by: callerId }, { onConflict: 'email' });
        if (error) throw error;
        // They have access now — clear any waitlist row so they don't still
        // show as "waiting". Best-effort: never fail the grant over this.
        const { error: wlErr } = await admin.from('waitlist').delete().eq('email', email);
        if (wlErr) console.error('admin grant_access: waitlist cleanup failed', email, wlErr.message);
        await notify(admin, email, 'access', "You're in! Welcome to Marro.");
        return res.status(200).json({ ok: true });
      }

      case 'set_member_note': {
        // Review fix: the Members section's note field is about a MEMBER
        // (an allowed_emails row) and must write there — it must NOT go
        // through set_role/user_roles like the Ambassador profile's note
        // does, or two bugs follow: (1) the note silently doesn't show up
        // (Members reads allowed_emails.note, not user_roles.note) and
        // (2) it creates a stray user_roles row that makes an ordinary
        // member spuriously appear in the Ambassadors list (which has no
        // is_ambassador filter — any user_roles row qualifies).
        const email = String(body.email || '').toLowerCase().trim();
        if (!email) return res.status(400).json({ error: 'Missing email' });
        const note = typeof body.note === 'string' ? (body.note.trim() || null) : null;
        const { error } = await admin.from('allowed_emails').update({ note }).eq('email', email);
        if (error) throw error;
        return res.status(200).json({ ok: true });
      }

      case 'revoke_access': {
        // Revoke a member's access. delete_data:false ("keep") just removes
        // their allowed_emails/user_roles/admins rows — their auth account and
        // app data (app_state/profiles) stay intact, so re-inviting them
        // (grant_access or a fresh code) restores everything exactly as it
        // was. delete_data:true is the full, irreversible wipe (mirrors
        // api/delete-account.js's own-account flow, but admin-triggered).
        const email = String(body.email || '').toLowerCase().trim();
        const deleteData = body.delete_data === true;
        if (!email) return res.status(400).json({ error: 'Missing email' });
        if (email === callerEmail) {
          return res.status(400).json({ error: "You can't revoke your own access." });
        }

        const { error: allowedErr } = await admin.from('allowed_emails').delete().eq('email', email);
        if (allowedErr) throw allowedErr;
        const { error: rolesErr } = await admin.from('user_roles').delete().eq('email', email);
        if (rolesErr) throw rolesErr;
        const { error: adminsErr } = await admin.from('admins').delete().eq('email', email);
        if (adminsErr) throw adminsErr;

        if (!deleteData) {
          return res.status(200).json({ ok: true, mode: 'kept' });
        }

        // Full delete: resolve their uid, wipe app data + auth user.
        const { data: usersPage } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
        const user = (usersPage?.users || []).find(u => (u.email || '').toLowerCase() === email);
        if (user) {
          const uid = user.id;
          const { error: stateErr } = await admin.from('app_state').delete().eq('user_id', uid);
          if (stateErr) console.error('admin revoke_access: app_state delete failed', uid, stateErr.message);
          const { error: profileErr } = await admin.from('profiles').delete().eq('user_id', uid);
          if (profileErr) console.error('admin revoke_access: profiles delete failed', uid, profileErr.message);
          const { error: waitlistErr } = await admin.from('waitlist').delete().eq('user_id', uid);
          if (waitlistErr) console.error('admin revoke_access: waitlist delete failed', uid, waitlistErr.message);
          const { error: notifDelErr } = await admin.from('user_notifications').delete().eq('email', email);
          if (notifDelErr) console.error('admin revoke_access: notifications delete failed', email, notifDelErr.message);
          const { error: deleteErr } = await admin.auth.admin.deleteUser(uid);
          if (deleteErr) {
            // access/role rows are already gone at this point (deleted above) —
            // report success with a warning rather than a hard error, so the
            // console still refreshes and shows them as revoked instead of
            // silently going stale (review fix: a 500 here used to make the
            // client skip onDone()/onChanged(), leaving a already-revoked
            // member looking untouched in the UI).
            console.error('admin revoke_access: deleteUser failed', uid, deleteErr.message);
            return res.status(200).json({ ok: true, mode: 'deleted', warning: "Access was revoked, but the account itself couldn't be fully deleted. Try again if this repeats." });
          }
        }
        return res.status(200).json({ ok: true, mode: 'deleted' });
      }

      case 'set_role': {
        const email = String(body.email || '').toLowerCase().trim();
        if (!email) return res.status(400).json({ error: 'Missing email' });
        const row = { email, updated_by: callerEmail, updated_at: new Date().toISOString() };
        let becameAmbassador = false;
        if (typeof body.is_ambassador === 'boolean') {
          row.is_ambassador = body.is_ambassador;
          becameAmbassador = body.is_ambassador;
        }
        let limitChanged = false;
        if (body.quota_override === null) { row.quota_override = null; limitChanged = true; }
        else if (body.quota_override !== undefined) {
          const q = parseInt(body.quota_override, 10);
          if (Number.isNaN(q) || q < 0) return res.status(400).json({ error: 'Invalid quota' });
          row.quota_override = q;
          limitChanged = true;
        }
        if (typeof body.note === 'string') row.note = body.note.trim() || null;
        if (typeof body.school === 'string') row.school = body.school.trim() || null;

        const { error } = await admin.from('user_roles').upsert(row, { onConflict: 'email' });
        if (error) throw error;

        // Review fix: an ambassador granted ONLY via user_roles (never having
        // redeemed a code or been separately granted access) has no
        // allowed_emails row — is_email_allowed() was giving them access
        // live off is_ambassador=true, but clear_role() (un-ambassador) then
        // deletes that row outright and silently locks them out of the whole
        // app, even though the UI frames "remove ambassador" as just losing
        // referral perks. Make ambassador status ALWAYS also grant durable
        // membership, so revoking the role later can never revoke app access
        // as a side effect (revoke_access is the explicit, intentional way
        // to do that).
        if (becameAmbassador) {
          // note:null — with ignoreDuplicates this only ever inserts a FRESH
          // row (never touches an existing manually-typed note). Role status is
          // exposed separately via list_overview's is_ambassador flag; it must
          // NOT be stashed as free-text in the note field (that leaked the
          // literal word "ambassador" into the Members note column and went
          // stale on role change).
          const { error: allowErr } = await admin.from('allowed_emails')
            .upsert({ email, note: null, invited_by: callerId }, { onConflict: 'email', ignoreDuplicates: true });
          if (allowErr) console.error('admin set_role: allowed_emails upsert failed', email, allowErr.message);
          // They have access now — clear any waitlist row (best-effort).
          const { error: wlErr } = await admin.from('waitlist').delete().eq('email', email);
          if (wlErr) console.error('admin set_role: waitlist cleanup failed', email, wlErr.message);
        }

        if (becameAmbassador) {
          await notify(admin, email, 'role', "You're now a Marro ambassador.");
          // Bug 5 fix: promotion used to only post the in-app notification
          // above, which someone can't see unless they're already signed in
          // — there was no actual email dispatch anywhere in this path. Send
          // the real "congratulations" email too, with the same
          // logged-not-swallowed error handling as every other sendEmail
          // call in this file.
          const { ok: emailed, error: sendErr } = await sendEmail({
            to: email,
            subject: "You're now a Marro ambassador",
            html: congratsEmail({ role: 'ambassador' }),
            type: 'congrats',
          });
          if (!emailed) console.error('admin set_role: ambassador congrats email failed', email, sendErr);
        } else if (limitChanged) {
          const effective = row.quota_override != null ? row.quota_override : (body.is_ambassador ? 15 : 5);
          await notify(admin, email, 'limit', `Your invite limit is now ${effective}.`);
        }
        return res.status(200).json({ ok: true });
      }

      case 'clear_role': {
        // Remove ambassador status / custom invite limit entirely (back to
        // the plain default of 5).
        const email = String(body.email || '').toLowerCase().trim();
        if (!email) return res.status(400).json({ error: 'Missing email' });
        const { error } = await admin.from('user_roles').delete().eq('email', email);
        if (error) throw error;
        await notify(admin, email, 'role', 'Your ambassador role was updated.');
        return res.status(200).json({ ok: true });
      }

      case 'add_admin': {
        const email = String(body.email || '').toLowerCase().trim();
        if (!email) return res.status(400).json({ error: 'Missing email' });
        const { error } = await admin.from('admins')
          .insert({ email, added_by: callerEmail });
        if (error && !/duplicate key|unique/i.test(error.message)) throw error;
        // Same durable-access fix as set_role's ambassador grant above: don't
        // let "remove admin" (demotion from the console) double as a silent
        // full app lockout for someone who only ever had access via the
        // admins table.
        // note:null — see set_role's ambassador grant: with ignoreDuplicates
        // this only inserts a FRESH row and never overwrites a manually-typed
        // note. Admin status is exposed via list_overview's is_admin flag, not
        // stashed as free-text.
        const { error: allowErr } = await admin.from('allowed_emails')
          .upsert({ email, note: null, invited_by: callerId }, { onConflict: 'email', ignoreDuplicates: true });
        if (allowErr) console.error('admin add_admin: allowed_emails upsert failed', email, allowErr.message);
        // They have access now — clear any waitlist row (best-effort).
        const { error: wlErr } = await admin.from('waitlist').delete().eq('email', email);
        if (wlErr) console.error('admin add_admin: waitlist cleanup failed', email, wlErr.message);
        await notify(admin, email, 'admin', 'You now have admin access to Marro.');
        // Bug 5 fix: same as set_role's ambassador branch — the in-app
        // notification alone is invisible to someone not already signed in.
        const { ok: emailed, error: sendErr } = await sendEmail({
          to: email,
          subject: "You're now a Marro admin",
          html: congratsEmail({ role: 'admin' }),
          type: 'congrats',
        });
        if (!emailed) console.error('admin add_admin: congrats email failed', email, sendErr);
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

      case 'email_usage': {
        // Founder visibility into the Resend plan quota without opening the
        // Resend dashboard: sends in the trailing 24h + current calendar
        // month (from email_send_log) vs our soft caps and the plan's real
        // limits. Read-only; feeds the AdminTab Insights tiles.
        const usage = await countEmailUsage(admin);
        if (!usage) return res.status(200).json({ ok: true, available: false });
        return res.status(200).json({
          ok: true,
          available: true,
          day: usage.day,
          month: usage.month,
          day_source: usage.daySource,     // 'resend' | 'internal' — for the AdminTab tile
          month_source: usage.monthSource,
          day_cap: EMAIL_CAPS.day,
          month_cap: EMAIL_CAPS.month,
          plan_day_limit: 100,
          plan_month_limit: 3000,
        });
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

// Best-effort in-app notification insert (mirrors public.notify() in
// supabase/notifications.sql, but from the service-role side since these
// actions aren't running as the notified user). Never throws — a failed
// notification shouldn't fail the admin action that triggered it.
async function notify(admin, email, kind, message, metadata) {
  if (!email) return;
  try {
    const { error } = await admin.from('user_notifications')
      .insert({ email: email.toLowerCase(), kind, message, metadata: metadata || null });
    if (error) console.error('admin: notify insert failed', email, error.message);
  } catch (e) {
    console.error('admin: notify failed', email, e?.message);
  }
}

// Resolve an auth uid to its email via the Admin API. Used sparingly (single
// lookups), unlike list_overview's bulk listUsers pass.
async function resolveEmail(admin, uid) {
  if (!uid) return null;
  try {
    const { data, error } = await admin.auth.admin.getUserById(uid);
    if (error) return null;
    return (data?.user?.email || '').toLowerCase() || null;
  } catch {
    return null;
  }
}
