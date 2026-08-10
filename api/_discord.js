// Shared Discord webhook mechanics for the support pipeline. Two call sites:
// api/support-notify.js (post the initial alert) and api/support.js (edit it
// in place when a thread gets claimed). Slack's incoming-webhook API has no
// equivalent edit endpoint, so the Slack fan-out (Slice 14) stays post-only.

function parseWebhook(url) {
  const m = /\/webhooks\/(\d+)\/([^/?]+)/.exec(url || '');
  return m ? { id: m[1], token: m[2] } : null;
}

export function buildSupportAlertContent({ typeLabel, subject, callerEmail, assignedAdmin, conversationId }) {
  const routing = assignedAdmin
    ? `→ ${assignedAdmin} (their thread)`
    : '→ unassigned — first reply claims it';
  const link = `https://joinmarro.com/?support_convo=${conversationId}`;
  return `🆘 Support · new ${typeLabel} from ${callerEmail}\n> ${subject}\n${routing} · ${link}`;
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
