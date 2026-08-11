// Vercel serverless function — support-inbox backend (Slice 3).
//
// WHY THIS EXISTS: admin reads/writes on the support tables deliberately have
// NO client RLS write policies (supabase/support_chat.sql) — status, unread
// counters, assignment, and the support_events audit log may only change
// server-side. This function is the admin lane: it runs with the SERVICE-ROLE
// key and mirrors api/admin.js's trust boundary exactly.
//
// TRUST BOUNDARY (identical to api/admin.js — read that header first):
//   1. Caller sends their own Supabase access token (Authorization: Bearer).
//   2. We verify it with an anon-key client's auth.getUser(token) — the email
//      that comes back is Supabase-authenticated, never trusted client input.
//   3. We re-check that email against the `admins` table with the service-role
//      client. The client-side is_admin() only shows/hides UI; THIS check is
//      the real border. Non-admin → 403.
//   4. Only then do we dispatch with the service-role client (bypasses RLS).
//
// AUDIT: every admin action that mutates a conversation writes a
// support_events row (who/what/when) — that table is the attribution record
// and the Slice-12 metrics source, so never skip the log on a new action.

import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './_config.js';
// Pure, side-effect-free (same rationale as the resolver import in
// api/support-notify.js) — the ONE definition of which status moves are legal.
import { canTransition, eventForTransition, sweep, resolveSnoozeUntil } from '../src/lib/supportLifecycle.js';

// Bounded list read so the inbox payload can't blow up as the beta grows.
const LIST_LIMIT = 200;

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
    console.error('support: missing SUPABASE_SERVICE_ROLE_KEY env var');
    return res.status(500).json({ error: 'Server misconfigured' });
  }

  // Step 1 — verify the token server-side.
  const verifier = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: userData, error: userErr } = await verifier.auth.getUser(token);
  if (userErr || !userData?.user) {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
  const callerEmail = (userData.user.email || '').toLowerCase();

  // Step 2 — service-role client + the REAL admin authorization check.
  const admin = createClient(SUPABASE_URL, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: adminRow, error: adminErr } = await admin
    .from('admins').select('email').eq('email', callerEmail).maybeSingle();
  if (adminErr) {
    console.error('support: admins lookup failed', adminErr.message);
    return res.status(500).json({ error: 'Server error' });
  }
  if (!adminRow) return res.status(403).json({ error: 'Not authorized' });

  // Step 3 — dispatch as an authenticated admin.
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const action = body.action;

  try {
    switch (action) {
      case 'list': {
        // Every conversation, most recently active first, enriched with the
        // user's name/email/avatar (identity + technical context only — a
        // thread never carries financial data, plan §4). Queue filtering
        // happens client-side (filterInbox) — volumes are small.
        const { data: convos, error } = await admin
          .from('support_conversations')
          .select('*')
          .order('last_message_at', { ascending: false })
          .limit(LIST_LIMIT);
        if (error) throw error;

        // Lazy maintenance sweep (Slice 7 — no cron infra yet): wake due
        // snoozes, auto-archive stale resolved threads. Applied before the
        // payload is shaped so the console always shows post-sweep truth.
        try {
          const due = sweep(convos || [], Date.now());
          for (const { id, patch, event } of due) {
            const { error: swErr } = await admin.from('support_conversations').update(patch).eq('id', id);
            if (swErr) { console.error('support: sweep update failed', id, swErr.message); continue; }
            const row = (convos || []).find((c) => c.id === id);
            if (row) Object.assign(row, patch);
            const { error: evSwErr } = await admin.from('support_events').insert({
              conversation_id: id, admin_email: 'system', action: event, meta: { via: 'sweep' },
            });
            if (evSwErr) console.error('support: sweep event failed', id, evSwErr.message);
          }
        } catch (e) {
          console.error('support: sweep failed', e?.message);
        }

        // Resolve user_id → {email, name, avatar} once (best-effort — on
        // failure the client falls back to showing a truncated user id).
        let byId = {};
        try {
          const { data: usersPage } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
          for (const u of usersPage?.users || []) {
            const meta = u.user_metadata || {};
            byId[u.id] = {
              email: (u.email || '').toLowerCase(),
              name: meta.full_name || meta.name || null,
              avatar: meta.avatar_url || meta.picture || null,
            };
          }
        } catch (e) {
          console.error('support: listUsers enrichment failed', e?.message);
        }

        const conversations = (convos || []).map((c) => {
          const u = byId[c.user_id];
          return {
            ...c,
            user_email: u?.email || null,
            user_name: u?.name || null,
            user_avatar: u?.avatar || null,
          };
        });
        return res.status(200).json({ ok: true, conversations, caller_email: callerEmail });
      }

      case 'thread': {
        // Full transcript for one conversation (internal notes included — the
        // admin lane sees everything). Opening a thread also zeroes
        // unread_admin: the "user messages since an admin last read" counter.
        // Peeking does NOT claim the thread (plan §9.5) — only replying does.
        const conversationId = String(body.conversation_id || '');
        if (!conversationId) return res.status(400).json({ error: 'Missing conversation_id' });
        const { data: messages, error } = await admin
          .from('support_messages')
          .select('*')
          .eq('conversation_id', conversationId)
          .order('created_at', { ascending: true });
        if (error) throw error;

        const { error: readErr } = await admin
          .from('support_conversations')
          .update({ unread_admin: 0 })
          .eq('id', conversationId);
        if (readErr) console.error('support: unread_admin reset failed', conversationId, readErr.message);

        // Identity summary for the user-context sidebar (Slice 9) — name /
        // email / school / joined. This is the identity context plan §4
        // explicitly allows on a conversation; the DEEPER account drill-down
        // stays unbuilt until the Terms/Privacy support-access language ships.
        let profile = null;
        try {
          const { data: convoRow } = await admin
            .from('support_conversations').select('user_id').eq('id', conversationId).maybeSingle();
          if (convoRow?.user_id) {
            const [{ data: userData }, { data: profRow }] = await Promise.all([
              admin.auth.admin.getUserById(convoRow.user_id),
              admin.from('profiles').select('school').eq('user_id', convoRow.user_id).maybeSingle(),
            ]);
            const u = userData?.user;
            profile = {
              name: u?.user_metadata?.full_name || u?.user_metadata?.name || null,
              email: (u?.email || '').toLowerCase() || null,
              school: profRow?.school || null,
              joined: u?.created_at || null,
            };
          }
        } catch (e) {
          console.error('support: profile summary failed', conversationId, e?.message);
        }

        return res.status(200).json({ ok: true, messages: messages || [], profile });
      }

      case 'reply': {
        // Insert an admin message. FIRST reply to an unassigned thread
        // auto-claims it for the caller (the locked §9.5 decision): sets
        // assigned_admin + claimed_at, flips a fresh thread new → open, and
        // logs a `claimed` event. Every reply logs a `replied` event, stamps
        // first_response_at once (the metrics anchor), and bumps the user's
        // unread counter. (The in-app "we replied" banner is Slice 6.)
        const conversationId = String(body.conversation_id || '');
        const text = typeof body.body === 'string' ? body.body.trim() : '';
        if (!conversationId) return res.status(400).json({ error: 'Missing conversation_id' });
        if (!text) return res.status(400).json({ error: 'Reply text required' });

        const { data: convo, error: convoErr } = await admin
          .from('support_conversations')
          .select('id, status, assigned_admin, first_response_at')
          .eq('id', conversationId)
          .maybeSingle();
        if (convoErr) throw convoErr;
        if (!convo) return res.status(404).json({ error: 'Conversation not found' });

        const { data: msgRows, error: msgErr } = await admin
          .from('support_messages')
          .insert({ conversation_id: conversationId, sender: 'admin', sender_email: callerEmail, body: text })
          .select('*');
        if (msgErr) throw msgErr;
        const message = msgRows && msgRows[0];

        const nowIso = new Date().toISOString();
        const claimed = !convo.assigned_admin;
        const patch = {
          last_message_at: nowIso,
          // unread_user counts admin msgs since the user last read — bumped
          // via a read-modify-write below (no atomic increment through the
          // JS client; two founders racing on one thread is not a real risk).
          first_response_at: convo.first_response_at || nowIso,
        };
        if (claimed) {
          patch.assigned_admin = callerEmail;
          patch.claimed_at = nowIso;
        }
        // We replied → the ball is in the user's court (Slice 7). Their next
        // message flips it back to 'open' server-side (see the user RPC).
        // Includes 'snoozed': replying is itself a decision to act on the
        // thread now, so it should wake it the same way the console's Reopen
        // button would — a reply shouldn't silently leave it parked.
        if (['new', 'open', 'snoozed'].includes(convo.status)) {
          patch.status = 'waiting_user';
          if (convo.status === 'snoozed') patch.snooze_until = null;
        }
        const { data: unreadRow, error: unreadReadErr } = await admin
          .from('support_conversations').select('unread_user').eq('id', conversationId).maybeSingle();
        if (unreadReadErr) throw unreadReadErr;
        patch.unread_user = (unreadRow?.unread_user || 0) + 1;

        const { error: updErr } = await admin
          .from('support_conversations').update(patch).eq('id', conversationId);
        if (updErr) throw updErr;

        // Audit log — claimed (if it just happened) then replied. Failures are
        // logged loudly but don't fail the reply (the message is already in).
        const events = [];
        if (claimed) events.push({ conversation_id: conversationId, admin_email: callerEmail, action: 'claimed', meta: { via: 'auto_claim_on_reply' } });
        events.push({ conversation_id: conversationId, admin_email: callerEmail, action: 'replied', meta: { message_id: message?.id || null } });
        const { error: evErr } = await admin.from('support_events').insert(events);
        if (evErr) console.error('support: events insert failed', conversationId, evErr.message);

        // Inbound "we replied" (Slice 6): reuse the existing in-app
        // notification pipeline (user_notifications → NotificationBanner) so
        // the user hears about the reply even with the panel closed. Best-
        // effort — the reply itself is already stored either way.
        try {
          const { data: ownerRow } = await admin
            .from('support_conversations').select('user_id').eq('id', conversationId).maybeSingle();
          if (ownerRow?.user_id) {
            const { data: ownerUser } = await admin.auth.admin.getUserById(ownerRow.user_id);
            const ownerEmail = (ownerUser?.user?.email || '').toLowerCase();
            if (ownerEmail) {
              const { error: notifErr } = await admin.from('user_notifications').insert({
                email: ownerEmail, kind: 'support',
                message: 'Marro replied to your support message — open Support to read it.',
                metadata: { conversation_id: conversationId },
              });
              if (notifErr) console.error('support: reply notification failed', conversationId, notifErr.message);
            }
          }
        } catch (e) {
          console.error('support: reply notification failed', conversationId, e?.message);
        }

        return res.status(200).json({ ok: true, message, claimed, assigned_admin: convo.assigned_admin || callerEmail });
      }

      case 'list_admins': {
        // Powers the Reassign quick-pick (Users & Invites has the FULL admin
        // management UI — add/remove — this is read-only, just for handing a
        // thread to someone by name instead of typing their email). Name
        // comes from their own Google profile when available.
        const { data: admins, error } = await admin
          .from('admins').select('email').order('email', { ascending: true });
        if (error) throw error;
        let byEmail = {};
        try {
          const { data: usersPage } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
          for (const u of usersPage?.users || []) {
            const meta = u.user_metadata || {};
            const email = (u.email || '').toLowerCase();
            if (email) byEmail[email] = meta.full_name || meta.name || null;
          }
        } catch (e) {
          console.error('support: list_admins name enrichment failed', e?.message);
        }
        const enriched = (admins || []).map((a) => ({ email: a.email, name: byEmail[a.email] || null }));
        return res.status(200).json({ ok: true, admins: enriched });
      }

      case 'heartbeat': {
        // Bumped while an admin has the Support console open — the availability
        // resolver treats a stale heartbeat as "not really here" (plan §3).
        const { data: settings, error } = await admin
          .from('support_settings')
          .upsert({ id: 1, last_admin_heartbeat: new Date().toISOString(), updated_at: new Date().toISOString() }, { onConflict: 'id' })
          .select('*');
        if (error) throw error;
        return res.status(200).json({ ok: true, settings: settings?.[0] || null });
      }

      case 'set_availability': {
        // The in-app manual toggle: 'auto' | 'on' | 'off'. Going 'on' also
        // stamps available_until (the §3 timeout window) and refreshes the
        // heartbeat so the flip is immediately honest.
        const override = String(body.override || '');
        if (!['auto', 'on', 'off'].includes(override)) {
          return res.status(400).json({ error: 'Invalid override' });
        }
        const nowIso = new Date().toISOString();
        const patch = { id: 1, online_override: override, updated_at: nowIso };
        if (override === 'on') {
          patch.available_until = new Date(Date.now() + 60 * 60000).toISOString(); // 1h window
          patch.last_admin_heartbeat = nowIso;
        }
        const { data: settings, error } = await admin
          .from('support_settings').upsert(patch, { onConflict: 'id' }).select('*');
        if (error) throw error;
        const { error: evErr } = await admin.from('support_events').insert({
          conversation_id: null, admin_email: callerEmail, action: 'availability_changed', meta: { override },
        });
        if (evErr) console.error('support: availability event log failed', evErr.message);
        return res.status(200).json({ ok: true, settings: settings?.[0] || null });
      }

      case 'set_status': {
        // Admin status moves (Slice 7): resolve / archive / snooze / reopen.
        // Legality comes from the shared pure state machine; every transition
        // stamps its lifecycle timestamp and logs a support_events row.
        const conversationId = String(body.conversation_id || '');
        const target = String(body.status || '');
        if (!conversationId) return res.status(400).json({ error: 'Missing conversation_id' });
        const { data: convo, error: convoErr } = await admin
          .from('support_conversations')
          .select('id, status, reopen_count')
          .eq('id', conversationId)
          .maybeSingle();
        if (convoErr) throw convoErr;
        if (!convo) return res.status(404).json({ error: 'Conversation not found' });
        if (!canTransition(convo.status, target)) {
          return res.status(400).json({ error: `Can't move a ${convo.status.replace('_', ' ')} thread to ${target.replace('_', ' ')}.` });
        }
        const nowIso = new Date().toISOString();
        const patch = { status: target };
        if (target === 'resolved') { patch.resolved_at = nowIso; patch.resolved_by = callerEmail; }
        if (target === 'archived') { patch.archived_at = nowIso; }
        // Either a quick preset (snooze_minutes) or a picked date/time
        // (snooze_until, an ISO string from the console's datetime-local
        // input) — resolveSnoozeUntil validates/clamps either shape.
        if (target === 'snoozed') {
          patch.snooze_until = resolveSnoozeUntil(Date.now(), { minutes: body.snooze_minutes, until: body.snooze_until });
        }
        if (target === 'open') {
          patch.archived_at = null;
          patch.snooze_until = null;
          if (['resolved', 'archived'].includes(convo.status)) patch.reopen_count = (convo.reopen_count || 0) + 1;
        }
        const { data: updated, error: updErr } = await admin
          .from('support_conversations').update(patch).eq('id', conversationId).select('*');
        if (updErr) throw updErr;
        const { error: evErr } = await admin.from('support_events').insert({
          conversation_id: conversationId, admin_email: callerEmail,
          action: eventForTransition(target, convo.status), meta: { from: convo.status, to: target },
        });
        if (evErr) console.error('support: status event log failed', conversationId, evErr.message);
        return res.status(200).json({ ok: true, conversation: updated?.[0] || null });
      }

      case 'set_priority': {
        // Triage (Slice 9): low / normal / urgent, admin-set.
        const conversationId = String(body.conversation_id || '');
        const priority = String(body.priority || '');
        if (!conversationId) return res.status(400).json({ error: 'Missing conversation_id' });
        if (!['low', 'normal', 'urgent'].includes(priority)) return res.status(400).json({ error: 'Invalid priority' });
        const { data: updated, error } = await admin
          .from('support_conversations').update({ priority }).eq('id', conversationId).select('*');
        if (error) throw error;
        if (!updated || !updated[0]) return res.status(404).json({ error: 'Conversation not found' });
        const { error: evErr } = await admin.from('support_events').insert({
          conversation_id: conversationId, admin_email: callerEmail, action: 'priority_changed', meta: { priority },
        });
        if (evErr) console.error('support: priority event failed', conversationId, evErr.message);
        return res.status(200).json({ ok: true, conversation: updated[0] });
      }

      case 'set_tags': {
        // Pattern-spotting labels (§9). Whole-array replace; sanitized hard.
        const conversationId = String(body.conversation_id || '');
        if (!conversationId) return res.status(400).json({ error: 'Missing conversation_id' });
        const tags = (Array.isArray(body.tags) ? body.tags : [])
          .map((t) => String(t).toLowerCase().trim().replace(/\s+/g, '-').slice(0, 30))
          .filter(Boolean)
          .filter((t, i, a) => a.indexOf(t) === i)
          .slice(0, 10);
        const { data: updated, error } = await admin
          .from('support_conversations').update({ tags: tags.length ? tags : null }).eq('id', conversationId).select('*');
        if (error) throw error;
        if (!updated || !updated[0]) return res.status(404).json({ error: 'Conversation not found' });
        const { error: evErr } = await admin.from('support_events').insert({
          conversation_id: conversationId, admin_email: callerEmail, action: 'tagged', meta: { tags },
        });
        if (evErr) console.error('support: tag event failed', conversationId, evErr.message);
        return res.status(200).json({ ok: true, conversation: updated[0] });
      }

      case 'add_note': {
        // Internal note (§9): admin-only commentary stored on the thread.
        // is_internal_note=true rows are EXCLUDED from the user's RLS lane
        // (supabase/support_chat.sql) — they never reach the user, and we
        // deliberately don't bump last_message_at/unread_user (a note isn't
        // user-visible activity).
        const conversationId = String(body.conversation_id || '');
        const text = typeof body.body === 'string' ? body.body.trim() : '';
        if (!conversationId) return res.status(400).json({ error: 'Missing conversation_id' });
        if (!text) return res.status(400).json({ error: 'Note text required' });
        const { data: msgRows, error } = await admin
          .from('support_messages')
          .insert({ conversation_id: conversationId, sender: 'admin', sender_email: callerEmail, body: text, is_internal_note: true })
          .select('*');
        if (error) throw error;
        const { error: evErr } = await admin.from('support_events').insert({
          conversation_id: conversationId, admin_email: callerEmail, action: 'note_added', meta: { message_id: msgRows?.[0]?.id || null },
        });
        if (evErr) console.error('support: note event failed', conversationId, evErr.message);
        return res.status(200).json({ ok: true, message: msgRows?.[0] || null });
      }

      case 'reassign':
      case 'release': {
        // Ownership moves (§9.5): hand a thread to the other founder, or put
        // it back in the shared pool. Reassigning to yourself = a claim.
        const conversationId = String(body.conversation_id || '');
        if (!conversationId) return res.status(400).json({ error: 'Missing conversation_id' });
        const toEmail = action === 'reassign' ? String(body.admin_email || '').toLowerCase().trim() : null;
        if (action === 'reassign') {
          if (!toEmail) return res.status(400).json({ error: 'Missing admin_email' });
          const { data: targetAdmin, error: taErr } = await admin
            .from('admins').select('email').eq('email', toEmail).maybeSingle();
          if (taErr) throw taErr;
          if (!targetAdmin) return res.status(400).json({ error: `${toEmail} isn't an admin.` });
        }
        const patch = action === 'reassign'
          ? { assigned_admin: toEmail, claimed_at: new Date().toISOString() }
          : { assigned_admin: null };
        const { data: updated, error: updErr } = await admin
          .from('support_conversations').update(patch).eq('id', conversationId).select('*');
        if (updErr) throw updErr;
        if (!updated || !updated[0]) return res.status(404).json({ error: 'Conversation not found' });
        const { error: evErr } = await admin.from('support_events').insert({
          conversation_id: conversationId, admin_email: callerEmail,
          action: action === 'reassign' ? 'reassigned' : 'released',
          meta: action === 'reassign' ? { to: toEmail } : null,
        });
        if (evErr) console.error('support: ownership event log failed', conversationId, evErr.message);
        return res.status(200).json({ ok: true, conversation: updated[0] });
      }

      default:
        return res.status(400).json({ error: 'Unknown action' });
    }
  } catch (e) {
    console.error('support: action failed', action, e?.message);
    return res.status(500).json({ error: 'Action failed. Please try again.' });
  }
}
