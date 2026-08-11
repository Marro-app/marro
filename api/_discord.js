// Shared Discord webhook mechanics for the support pipeline. Two call sites:
// api/support-notify.js (post the initial alert) and api/support.js (edit it
// in place when a thread gets claimed). Slack's incoming-webhook API has no
// equivalent edit endpoint, so the Slack fan-out (Slice 14) stays post-only.

function parseWebhook(url) {
  const m = /\/webhooks\/(\d+)\/([^/?]+)/.exec(url || '');
  return m ? { id: m[1], token: m[2] } : null;
}

// `submitter` is a display name when available, falling back to email (most
// users have a Google full_name, but it's not guaranteed). `claimedBy`/
// `reassignedTo`/`snoozeWoke` are pre-resolved via mentionOrName() below —
// this function never looks up a Discord ID itself, callers own that. Each
// lifecycle moment gets its own leading glyph rather than just a routing-line
// text change — glanceable at channel-scroll speed, not just on a careful
// re-read. Exactly one of these should be set at a time.
export function buildSupportAlertContent({ typeLabel, subject, submitter, claimedBy, reassignedTo, released, snoozeWoke, conversationId }) {
  const link = `https://joinmarro.com/?support_convo=${conversationId}`;
  if (claimedBy) {
    return `✅ Claimed by ${claimedBy} · ${typeLabel} from ${submitter}\n> ${subject}\n${link}`;
  }
  if (reassignedTo) {
    return `↪️ Reassigned to ${reassignedTo} · ${typeLabel} from ${submitter}\n> ${subject}\n${link}`;
  }
  if (released) {
    // @here (not @everyone) — someone currently online should pick this back
    // up; it shouldn't page someone's phone the way @everyone would.
    return `🔓 Released — back in the queue · ${typeLabel} from ${submitter}\n> ${subject}\n@here — first reply claims it · ${link}`;
  }
  if (snoozeWoke) {
    return `⏰ Back from snooze — ${snoozeWoke} · ${typeLabel} from ${submitter}\n> ${subject}\n${link}`;
  }
  return `🆘 Support · new ${typeLabel} from ${submitter}\n> ${subject}\n→ unassigned — first reply claims it · ${link}`;
}

// Resolves an admin to the string that goes in the message: a real @-mention
// when they've set their Discord ID (Admin tab → click their profile), a
// plain display name otherwise — never blocks or throws on a missing ID,
// just degrades to text with no personal ping.
export function mentionOrName(discordUserId, displayName) {
  return discordUserId ? `<@${discordUserId}>` : (displayName || 'someone');
}

// Post a new alert message. Returns the new message id on success (needed
// later to edit it), or null if the webhook is misconfigured or the post
// failed — callers treat either as "no Discord ping happened."
export async function postDiscordAlert(webhookUrl, content) {
  if (!parseWebhook(webhookUrl)) return null;
  try {
    const resp = await fetch(`${webhookUrl}?wait=true`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
    if (!resp.ok) { console.error('discord: post failed', resp.status); return null; }
    const msg = await resp.json();
    return msg?.id || null;
  } catch (e) {
    console.error('discord: post threw', e?.message);
    return null;
  }
}

// Edit a previously posted alert (e.g. once a thread is claimed). Best-effort
// — a failed edit never blocks the reply that triggered it.
export async function editDiscordAlert(webhookUrl, messageId, content) {
  const parsed = parseWebhook(webhookUrl);
  if (!parsed || !messageId) return false;
  try {
    const resp = await fetch(
      `https://discord.com/api/webhooks/${parsed.id}/${parsed.token}/messages/${messageId}`,
      { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content }) },
    );
    if (!resp.ok) { console.error('discord: edit failed', resp.status); return false; }
    return true;
  } catch (e) {
    console.error('discord: edit threw', e?.message);
    return false;
  }
}
