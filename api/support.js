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
        // thread never carries financial data, plan §4). Filtering by queue
        // (unassigned/mine/…) happens client-side for now; the Slice-7 queues
        // can push it into the query when the volume warrants it.
        const { data: convos, error } = await admin
          .from('support_conversations')
          .select('*')
          .order('last_message_at', { ascending: false })
          .limit(LIST_LIMIT);
        if (error) throw error;

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

        return res.status(200).json({ ok: true, messages: messages || [] });
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
          if (convo.status === 'new') patch.status = 'open';
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

      case 'settings': {
        // Current availability config for the admin toggle UI.
        const { data: settings, error } = await admin
          .from('support_settings').select('*').eq('id', 1).maybeSingle();
        if (error) throw error;
        return res.status(200).json({ ok: true, settings: settings || null });
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

      default:
        return res.status(400).json({ error: 'Unknown action' });
    }
  } catch (e) {
    console.error('support: action failed', action, e?.message);
    return res.status(500).json({ error: 'Action failed. Please try again.' });
  }
}
