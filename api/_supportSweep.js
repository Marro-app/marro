// Shared sweep-application: turns the pure sweep() output (src/lib/
// supportLifecycle.js) into actual DB writes, an audit-log row per change,
// and — for a snooze waking up — a Discord ping to whoever the thread is
// assigned to. Two callers need this identical behavior:
//   • api/support.js's 'list' action — runs it LAZILY whenever an admin
//     opens the inbox, no guaranteed timing.
//   • api/support-cron.js — a real scheduled sweep (see that file for why
//     it's triggered by GitHub Actions rather than Vercel's own cron).
// Kept in one place so the two paths can't drift into different behavior.

import { buildSupportAlertContent, postDiscordAlert, mentionOrName } from './_discord.js';
import { sweep } from '../src/lib/supportLifecycle.js';

export async function runSweep(admin, conversations, nowMs = Date.now()) {
  const due = sweep(conversations || [], nowMs);
  const results = [];
  for (const { id, patch, event, assigned_admin } of due) {
    const { error: swErr } = await admin.from('support_conversations').update(patch).eq('id', id);
    if (swErr) { console.error('support: sweep update failed', id, swErr.message); continue; }
    const row = (conversations || []).find((c) => c.id === id);
    if (row) Object.assign(row, patch);
    const { error: evSwErr } = await admin.from('support_events').insert({
      conversation_id: id, admin_email: 'system', action: event, meta: { via: 'sweep' },
    });
    if (evSwErr) console.error('support: sweep event failed', id, evSwErr.message);
    results.push({ id, event });

    // A snooze waking up (event === 'reopened' from sweep()'s SNOOZED branch
    // — the resolved→archived branch never uses this event name, so this
    // check alone tells the two apart) pings whoever it's assigned to.
    // Unassigned threads stay quiet — nobody to notify, and re-pinging the
    // whole channel for every expired snooze would be noisy. POSTS A FRESH
    // MESSAGE rather than editing the old alert — real-world testing
    // (2026-08-11) showed editing a message to add a mention does NOT
    // reliably fire a notification/sound, only a genuinely new message does.
    if (event === 'reopened' && assigned_admin) {
      const webhook = process.env.DISCORD_SUPPORT_WEBHOOK_URL;
      if (webhook) {
        try {
          const { data: adminRow } = await admin
            .from('admins').select('discord_user_id').eq('email', assigned_admin).maybeSingle();
          const { data: ownerUser } = await admin.auth.admin.getUserById(row.user_id);
          const ownerMeta = ownerUser?.user?.user_metadata || {};
          const ownerName = ownerMeta.full_name || ownerMeta.name
            || (ownerUser?.user?.email || '').toLowerCase() || 'a user';
          const typeLabel = row.type === 'feedback' ? 'idea' : row.type;
          const subject = (row.subject || '').replace(/\s+/g, ' ').slice(0, 120);
          const content = buildSupportAlertContent({
            typeLabel, subject, submitter: ownerName, conversationId: id,
            snoozeWoke: mentionOrName(adminRow?.discord_user_id, assigned_admin),
          });
          const newMessageId = await postDiscordAlert(webhook, content);
          if (newMessageId) {
            const { error: msgIdErr } = await admin
              .from('support_conversations').update({ discord_message_id: newMessageId }).eq('id', id);
            if (msgIdErr) console.error('support: discord_message_id update failed', id, msgIdErr.message);
          } else {
            console.error('support: discord snooze-wake post failed', id);
          }
        } catch (e) {
          console.error('support: discord snooze-wake alert threw', id, e?.message);
        }
      }
    }
  }
  return results;
}
