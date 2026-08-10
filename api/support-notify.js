// Vercel serverless function — support outbound alerts + auto-reassurance (Slice 5).
//
// Called fire-and-forget by the CLIENT right after a user's support message
// lands (see notifySupport() in src/lib/support.js). Two jobs:
//   1. DISCORD PING — post to the founders' Discord webhook so someone knows a
//      user is waiting. Webhook URL lives ONLY in the DISCORD_SUPPORT_WEBHOOK_URL
//      Vercel env var (never client-side; repo is public — CLAUDE.md rule 4).
//      Debounced per conversation via the support_events log so a rapid burst
//      of messages = one ping. Once a thread is claimed, the ping names the
//      owner so the other founder can ignore it (per-admin channel prefs are
//      Slice 14).
//   2. AUTO-REASSURANCE — a QUESTION landing while we're OFFLINE (per the
//      shared availability resolver, Slice 6) gets a one-time `system`
//      message ("we'll get back to you soon") so the user never feels
//      ignored. Questions only: bug/idea submissions already end on an
//      explicit confirmation screen and aren't chats.
//
// TRUST BOUNDARY: unlike api/support.js this is called by REGULAR users — so
// the caller's token is verified and the conversation must be THEIR OWN
// (service-role ownership re-check). No admin check; nothing here returns
// conversation data. A forged conversation_id from another user → 403.

import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './_config.js';
// Pure, side-effect-free (unlike the src/lib/data.js import api/_config.js
// exists to avoid) — the SAME resolver the panel's status line uses, so the
// reassurance gate and the "We're online" line can never disagree.
import { resolveAvailability } from '../src/lib/supportAvailability.js';
import { buildSupportAlertContent, postDiscordAlert } from './_discord.js';

// One Discord ping per conversation per window — a burst of follow-up
// messages shouldn't buzz the founders repeatedly.
const PING_DEBOUNCE_MINUTES = 10;
const REASSURANCE_TEXT = "Thanks for reaching out — we're not at the desk right now, but we'll get back to you soon.";

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
    console.error('support-notify: missing SUPABASE_SERVICE_ROLE_KEY env var');
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
  const callerEmail = (userData.user.email || '').toLowerCase();

  const admin = createClient(SUPABASE_URL, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const conversationId = String(body.conversation_id || '');
  if (!conversationId) return res.status(400).json({ error: 'Missing conversation_id' });

  try {
    const { data: convo, error: convoErr } = await admin
      .from('support_conversations')
      .select('id, user_id, type, subject, status, assigned_admin')
      .eq('id', conversationId)
      .maybeSingle();
    if (convoErr) throw convoErr;
    if (!convo) return res.status(404).json({ error: 'Conversation not found' });
    if (convo.user_id !== callerId) return res.status(403).json({ error: 'Not authorized' });

    // ── 1. Auto-reassurance (questions only, once per conversation) ──────────
    // Slice 6: keyed off the availability resolver (was "unclaimed" in slice
    // 5) — if we're honestly offline, say so, even on a claimed thread.
    let online = false;
    try {
      const { data: settings } = await admin
        .from('support_settings').select('*').eq('id', 1).maybeSingle();
      online = resolveAvailability(Date.now(), settings).online;
    } catch { /* missing settings row resolves offline — safe default */ }
    let reassured = false;
    if (convo.type === 'question' && !online) {
      const { data: existingSystem, error: sysErr } = await admin
        .from('support_messages')
        .select('id')
        .eq('conversation_id', conversationId)
        .eq('sender', 'system')
        .limit(1);
      if (sysErr) throw sysErr;
      if (!existingSystem || existingSystem.length === 0) {
        const { error: insErr } = await admin
          .from('support_messages')
          .insert({ conversation_id: conversationId, sender: 'system', body: REASSURANCE_TEXT });
        if (insErr) throw insErr;
        reassured = true;
      }
    }

    // ── 2. Discord ping (debounced per conversation) ────────────────────────
    // Feature-flagged by the env var: absent → silently skipped, everything
    // else still works (lets the preview deploy run without the secret).
    let pinged = false;
    // Fan-out (Slice 14): Discord + Slack, each feature-flagged by its env
    // var; the shared per-conversation debounce covers both channels.
    const webhook = process.env.DISCORD_SUPPORT_WEBHOOK_URL;
    const slackWebhook = process.env.SLACK_SUPPORT_WEBHOOK_URL;
    if (webhook || slackWebhook) {
      const since = new Date(Date.now() - PING_DEBOUNCE_MINUTES * 60000).toISOString();
      const { data: recentPing, error: pingErr } = await admin
        .from('support_events')
        .select('id')
        .eq('conversation_id', conversationId)
        .eq('action', 'discord_ping')
        .gte('at', since)
        .limit(1);
      if (pingErr) throw pingErr;

      if (!recentPing || recentPing.length === 0) {
        const typeLabel = convo.type === 'feedback' ? 'idea' : convo.type;
        const subject = (convo.subject || '').replace(/\s+/g, ' ').slice(0, 120);
        const content = buildSupportAlertContent({
          typeLabel, subject, callerEmail, assignedAdmin: convo.assigned_admin, conversationId,
        });
        const channels = [];
        // Never fail the request over a webhook hiccup — the message itself
        // is already stored; the in-app inbox badge still works.
        if (webhook) {
          const messageId = await postDiscordAlert(webhook, content);
          if (messageId) {
            channels.push('discord');
            // Stored so api/support.js can edit this same message in place
            // when the thread gets claimed, instead of posting a second one.
            const { error: idErr } = await admin
              .from('support_conversations').update({ discord_message_id: messageId }).eq('id', conversationId);
            if (idErr) console.error('support-notify: storing discord_message_id failed', idErr.message);
          }
        }
        if (slackWebhook) {
          try {
            const resp = await fetch(slackWebhook, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ text: content }), // Slack wants `text`
            });
            if (resp.ok) channels.push('slack');
            else console.error('support-notify: Slack webhook returned', resp.status);
          } catch (e) { console.error('support-notify: Slack webhook failed', e?.message); }
        }
        pinged = channels.length > 0;
        if (pinged) {
          const { error: evErr } = await admin.from('support_events').insert({
            conversation_id: conversationId,
            admin_email: 'system',
            action: 'discord_ping', // legacy name; meta.channels says who actually got it
            meta: { type: convo.type, assigned_admin: convo.assigned_admin || null, channels },
          });
          if (evErr) console.error('support-notify: ping event log failed', evErr.message);
        }
      }
    }

    return res.status(200).json({ ok: true, reassured, pinged });
  } catch (e) {
    console.error('support-notify: failed', conversationId, e?.message);
    return res.status(500).json({ error: 'Notify failed' });
  }
}
