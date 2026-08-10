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
import { canTransition, eventForTransition, sweep } from '../src/lib/supportLifecycle.js';
import { sendEmail } from './_email.js';
import { evaluateNudge, NUDGE_FREQUENCY_WINDOW_DAYS } from '../src/lib/nudgeGate.js';
import { buildSupportAlertContent, editDiscordAlert } from './_discord.js';

// Reply-when-gone email (Slice 11): only when the user looks gone (their last
// message is older than this), and at most once per conversation per window.
const AWAY_AFTER_MINUTES = 15;
const REPLY_EMAIL_DEBOUNCE_HOURS = 6;

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
  const callerMeta = userData.user.user_metadata || {};
  const callerName = callerMeta.full_name || callerMeta.name || callerEmail;

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
          .select('id, status, assigned_admin, first_response_at, type, subject, user_id, discord_message_id')
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
        if (['new', 'open'].includes(convo.status)) patch.status = 'waiting_user';
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

        // Edit the original Discord alert in place on claim, rather than
        // posting a second message — so the channel always reflects current
        // ownership instead of accumulating duplicate "unassigned" pings.
        // Best-effort: a failed edit never blocks the reply itself.
        if (claimed && convo.discord_message_id) {
          const webhook = process.env.DISCORD_SUPPORT_WEBHOOK_URL;
          if (webhook) {
            try {
              const { data: ownerUser } = await admin.auth.admin.getUserById(convo.user_id);
              const ownerMeta = ownerUser?.user?.user_metadata || {};
              const ownerName = ownerMeta.full_name || ownerMeta.name
                || (ownerUser?.user?.email || '').toLowerCase() || 'a user';
              const typeLabel = convo.type === 'feedback' ? 'idea' : convo.type;
              const subject = (convo.subject || '').replace(/\s+/g, ' ').slice(0, 120);
              const content = buildSupportAlertContent({
                typeLabel, subject, submitter: ownerName, claimedBy: callerName, conversationId,
              });
              const edited = await editDiscordAlert(webhook, convo.discord_message_id, content);
              if (!edited) console.error('support: discord alert edit failed', conversationId);
            } catch (e) {
              console.error('support: discord alert edit threw', conversationId, e?.message);
            }
          }
        }

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

              // Reply-when-gone email (Slice 11): if the user's last message
              // is old enough that they've likely left the app, the in-app
              // banner won't reach them — send an email too. Debounced per
              // conversation via a support_events row so a burst of replies
              // is one email; the plan-level caps in _email.js still apply.
              try {
                const { data: lastUserMsg } = await admin
                  .from('support_messages').select('created_at')
                  .eq('conversation_id', conversationId).eq('sender', 'user')
                  .order('created_at', { ascending: false }).limit(1);
                const lastAt = lastUserMsg?.[0]?.created_at ? new Date(lastUserMsg[0].created_at).getTime() : null;
                const away = lastAt != null && Date.now() - lastAt > AWAY_AFTER_MINUTES * 60000;
                if (away) {
                  const since = new Date(Date.now() - REPLY_EMAIL_DEBOUNCE_HOURS * 3600000).toISOString();
                  const { data: recentEmail } = await admin
                    .from('support_events').select('id')
                    .eq('conversation_id', conversationId).eq('action', 'reply_emailed')
                    .gte('at', since).limit(1);
                  if (!recentEmail || recentEmail.length === 0) {
                    const { ok: emailed, error: sendErr } = await sendEmail({
                      to: ownerEmail,
                      subject: 'Marro replied to your support message',
                      html: `<p>Hi — we replied to your support message.</p>
<p>Open Marro and tap the chat bubble in the corner to read it:</p>
<p><a href="https://joinmarro.com">joinmarro.com</a></p>
<p style="color:#888;font-size:12px">You're getting this because you contacted Marro support and weren't in the app when we answered.</p>`,
                      type: 'support_reply',
                    });
                    if (!emailed) console.error('support: reply email failed', conversationId, sendErr);
                    else {
                      const { error: evEmErr } = await admin.from('support_events').insert({
                        conversation_id: conversationId, admin_email: 'system', action: 'reply_emailed', meta: { to: ownerEmail },
                      });
                      if (evEmErr) console.error('support: reply_emailed event failed', conversationId, evEmErr.message);
                    }
                  }
                }
              } catch (e) {
                console.error('support: reply-when-gone email failed', conversationId, e?.message);
              }
            }
          }
        } catch (e) {
          console.error('support: reply notification failed', conversationId, e?.message);
        }

        return res.status(200).json({ ok: true, message, claimed, assigned_admin: convo.assigned_admin || callerEmail });
      }

      case 'settings': {
        // The caller's OWN availability row for the "Your availability" UI
        // (per-admin, not shared — see support_admin_availability.sql).
        const { data: settings, error } = await admin
          .from('support_admin_availability').select('*').eq('admin_email', callerEmail).maybeSingle();
        if (error) throw error;
        return res.status(200).json({ ok: true, settings: settings || null });
      }

      case 'heartbeat': {
        // Bumped while THIS admin has the Support console open — the
        // availability resolver treats a stale heartbeat as "not really
        // here" (plan §3). Scoped to the caller's own row.
        const nowIso = new Date().toISOString();
        const { data: settings, error } = await admin
          .from('support_admin_availability')
          .upsert({ admin_email: callerEmail, last_heartbeat: nowIso, updated_at: nowIso }, { onConflict: 'admin_email' })
          .select('*');
        if (error) throw error;
        return res.status(200).json({ ok: true, settings: settings?.[0] || null });
      }

      case 'set_availability': {
        // The in-app manual toggle: 'auto' | 'on' | 'off', scoped to the
        // caller's own row. Going 'on' also stamps available_until (the §3
        // timeout window) and refreshes the heartbeat so the flip is
        // immediately honest.
        const override = String(body.override || '');
        if (!['auto', 'on', 'off'].includes(override)) {
          return res.status(400).json({ error: 'Invalid override' });
        }
        const nowIso = new Date().toISOString();
        const patch = { admin_email: callerEmail, online_override: override, updated_at: nowIso };
        if (override === 'on') {
          patch.available_until = new Date(Date.now() + 60 * 60000).toISOString(); // 1h window
          patch.last_heartbeat = nowIso;
        }
        const { data: settings, error } = await admin
          .from('support_admin_availability').upsert(patch, { onConflict: 'admin_email' }).select('*');
        if (error) throw error;
        const { error: evErr } = await admin.from('support_events').insert({
          conversation_id: null, admin_email: callerEmail, action: 'availability_changed', meta: { override },
        });
        if (evErr) console.error('support: availability event log failed', evErr.message);
        return res.status(200).json({ ok: true, settings: settings?.[0] || null });
      }

      case 'set_business_hours': {
        // Per-day/timezone schedule for the caller's own row — see the
        // withinBusinessHours shape doc in supportAvailability.js. Light
        // validation only (shape, not exhaustive) since this never gates
        // anything security-sensitive, just the "are we online" copy.
        const businessHours = body.business_hours;
        if (!businessHours || typeof businessHours !== 'object' || typeof businessHours.tz !== 'string') {
          return res.status(400).json({ error: 'Invalid business_hours' });
        }
        const nowIso = new Date().toISOString();
        const { data: settings, error } = await admin
          .from('support_admin_availability')
          .upsert({ admin_email: callerEmail, business_hours: businessHours, updated_at: nowIso }, { onConflict: 'admin_email' })
          .select('*');
        if (error) throw error;
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
        if (target === 'snoozed') {
          const hours = Math.max(1, Math.min(24 * 14, parseInt(body.snooze_hours, 10) || 24));
          patch.snooze_until = new Date(Date.now() + hours * 3600000).toISOString();
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

      case 'canned_list': {
        const { data, error } = await admin
          .from('support_canned_replies').select('*').order('created_at', { ascending: true }).limit(50);
        if (error) throw error;
        return res.status(200).json({ ok: true, canned: data || [] });
      }

      case 'canned_save': {
        // Save a reusable reply (Slice 14). Title defaults to the first words.
        const text = typeof body.body === 'string' ? body.body.trim() : '';
        if (!text) return res.status(400).json({ error: 'Reply text required' });
        const title = (typeof body.title === 'string' && body.title.trim())
          ? body.title.trim().slice(0, 60)
          : text.replace(/\s+/g, ' ').slice(0, 40);
        const { data, error } = await admin
          .from('support_canned_replies')
          .insert({ title, body: text.slice(0, 2000), created_by: callerEmail })
          .select('*');
        if (error) throw error;
        return res.status(200).json({ ok: true, canned: data?.[0] || null });
      }

      case 'canned_delete': {
        const id = String(body.canned_id || '');
        if (!id) return res.status(400).json({ error: 'Missing canned_id' });
        const { error } = await admin.from('support_canned_replies').delete().eq('id', id);
        if (error) throw error;
        return res.status(200).json({ ok: true });
      }

      case 'nudge_create': {
        // Manual proactive nudge (Slice 13). Held until send_after, then the
        // still-relevant gate re-checks before anything actually goes out.
        const target = String(body.target_email || '').toLowerCase().trim();
        const text = typeof body.body === 'string' ? body.body.trim() : '';
        if (!target || !/.+@.+/.test(target)) return res.status(400).json({ error: 'Valid target email required' });
        if (!text) return res.status(400).json({ error: 'Nudge text required' });
        const delayHours = Math.max(0, Math.min(24 * 14, Number(body.delay_hours) || 0));
        const { data: rows, error } = await admin.from('support_nudges').insert({
          created_by: callerEmail,
          target_email: target,
          body: text.slice(0, 500),
          trigger_kind: 'manual',
          recheck_condition: { type: 'no_open_support_thread' },
          send_after: new Date(Date.now() + delayHours * 3600000).toISOString(),
        }).select('*');
        if (error) throw error;
        return res.status(200).json({ ok: true, nudge: rows?.[0] || null });
      }

      case 'nudge_list': {
        // Evaluate due nudges first (lazy — no cron), then return the recent set.
        await evaluateDueNudges(admin);
        const { data: nudges, error } = await admin
          .from('support_nudges').select('*')
          .order('created_at', { ascending: false }).limit(50);
        if (error) throw error;
        return res.status(200).json({ ok: true, nudges: nudges || [] });
      }

      case 'nudge_cancel': {
        const id = String(body.nudge_id || '');
        if (!id) return res.status(400).json({ error: 'Missing nudge_id' });
        const { data: rows, error } = await admin
          .from('support_nudges')
          .update({ state: 'cancelled', cancelled_reason: 'admin_cancelled' })
          .eq('id', id).eq('state', 'scheduled')
          .select('*');
        if (error) throw error;
        return res.status(200).json({ ok: true, cancelled: (rows || []).length > 0 });
      }

      case 'nudge_context': {
        // Live state for the composer's "still relevant?" preview.
        const target = String(body.target_email || '').toLowerCase().trim();
        if (!target) return res.status(400).json({ error: 'Missing target_email' });
        const ctx = await nudgeContextFor(admin, target, new Date(0).toISOString());
        return res.status(200).json({ ok: true, context: ctx });
      }

      default:
        return res.status(400).json({ error: 'Unknown action' });
    }
  } catch (e) {
    console.error('support: action failed', action, e?.message);
    return res.status(500).json({ error: 'Action failed. Please try again.' });
  }
}

// ── Nudge evaluation (Slice 13) ─────────────────────────────────────────────
// Live context for one target at evaluation/compose time. Email → uid via the
// Admin API (fine at beta scale), then their support activity.
async function nudgeContextFor(admin, targetEmail, sinceIso) {
  const ctx = { userActiveThread: false, userMessagedSince: false, sentToTargetInWindow: 0 };
  try {
    const { data: usersPage } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const user = (usersPage?.users || []).find((u) => (u.email || '').toLowerCase() === targetEmail);
    if (user) {
      const { data: convos } = await admin
        .from('support_conversations').select('id, status, last_message_at').eq('user_id', user.id);
      ctx.userActiveThread = (convos || []).some((c) => ['new', 'open', 'waiting_user'].includes(c.status));
      if ((convos || []).length) {
        const ids = convos.map((c) => c.id);
        const { data: msgs } = await admin
          .from('support_messages').select('id').in('conversation_id', ids)
          .eq('sender', 'user').gte('created_at', sinceIso).limit(1);
        ctx.userMessagedSince = (msgs || []).length > 0;
      }
    }
    const windowStart = new Date(Date.now() - NUDGE_FREQUENCY_WINDOW_DAYS * 86400000).toISOString();
    const { data: recent } = await admin
      .from('support_nudges').select('id').eq('target_email', targetEmail)
      .eq('state', 'sent').gte('sent_at', windowStart).limit(1);
    ctx.sentToTargetInWindow = (recent || []).length;
  } catch (e) {
    console.error('support: nudge context failed', targetEmail, e?.message);
  }
  return ctx;
}

// Run the still-relevant gate over every due nudge: send via the in-app
// notification pipeline, or auto-cancel with the reason recorded. Lazy (no
// cron) — invoked from nudge_list; the pure gate itself is Vitest-covered.
async function evaluateDueNudges(admin) {
  try {
    const { data: due, error } = await admin
      .from('support_nudges').select('*')
      .eq('state', 'scheduled')
      .lte('send_after', new Date().toISOString())
      .limit(25);
    if (error) throw error;
    for (const nudge of due || []) {
      const ctx = await nudgeContextFor(admin, nudge.target_email, nudge.created_at);
      const verdict = evaluateNudge(nudge, ctx);
      if (verdict.action === 'send') {
        const { error: notifErr } = await admin.from('user_notifications').insert({
          email: nudge.target_email, kind: 'nudge', message: nudge.body, metadata: { nudge_id: nudge.id },
        });
        if (notifErr) { console.error('support: nudge delivery failed', nudge.id, notifErr.message); continue; }
        await admin.from('support_nudges')
          .update({ state: 'sent', sent_at: new Date().toISOString() }).eq('id', nudge.id);
        const { error: evErr } = await admin.from('support_events').insert({
          conversation_id: null, admin_email: 'system', action: 'nudge_sent', meta: { nudge_id: nudge.id, target: nudge.target_email },
        });
        if (evErr) console.error('support: nudge event failed', nudge.id, evErr.message);
      } else if (verdict.action === 'cancel') {
        await admin.from('support_nudges')
          .update({ state: 'cancelled', cancelled_reason: verdict.reason }).eq('id', nudge.id);
        const { error: evErr } = await admin.from('support_events').insert({
          conversation_id: null, admin_email: 'system', action: 'nudge_cancelled', meta: { nudge_id: nudge.id, reason: verdict.reason },
        });
        if (evErr) console.error('support: nudge event failed', nudge.id, evErr.message);
      }
      // 'wait' → leave it scheduled.
    }
  } catch (e) {
    console.error('support: nudge evaluation failed', e?.message);
  }
}
