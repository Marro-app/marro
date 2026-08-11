// Vercel serverless function — support lifecycle sweep, run on a schedule.
//
// WHY THIS EXISTS: sweep() (src/lib/supportLifecycle.js) wakes due snoozes
// and auto-archives stale resolved threads, but api/support.js only runs it
// LAZILY inside the 'list' action — whenever an admin happens to have the
// inbox open. Fine for correctness (nothing is ever stuck for good), useless
// for TIMELY snooze-wake pings: a 15-minute snooze meant "remind me soon,"
// not "remind me next time either of us opens the app."
//
// This endpoint runs the EXACT SAME sweep — see api/_supportSweep.js, the
// one shared implementation both this file and api/support.js's 'list'
// action call — so the two paths can never drift apart.
//
// TRIGGER: a GitHub Actions scheduled workflow (.github/workflows/
// support-cron.yml), NOT Vercel's own cron. Vercel's Hobby plan caps native
// cron at once/day, which defeats a 15-30 minute snooze entirely. GitHub
// Actions cron is free with no such cap.
//
// AUTH: a shared secret (CRON_SECRET env var — set the SAME value in Vercel
// and as a GitHub Actions repo secret), not a user token — nobody is signed
// in when this fires. The sweep itself is idempotent (safe to run twice), so
// this isn't guarding data integrity — just keeping the endpoint off the
// open internet.

import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL } from './_config.js';
import { runSweep } from './_supportSweep.js';

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error('support-cron: missing CRON_SECRET env var');
    return res.status(500).json({ error: 'Server misconfigured' });
  }
  const authHeader = req.headers['authorization'] || req.headers['Authorization'];
  if (authHeader !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    console.error('support-cron: missing SUPABASE_SERVICE_ROLE_KEY env var');
    return res.status(500).json({ error: 'Server misconfigured' });
  }
  const admin = createClient(SUPABASE_URL, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    // Only the statuses sweep() ever acts on — no reason to pull every
    // conversation just to check two fields on most of them.
    const { data: convos, error } = await admin
      .from('support_conversations')
      .select('id, status, snooze_until, resolved_at, assigned_admin, discord_message_id, subject, type, user_id')
      .in('status', ['snoozed', 'resolved']);
    if (error) throw error;

    const results = await runSweep(admin, convos || []);
    return res.status(200).json({ ok: true, swept: results.length });
  } catch (e) {
    console.error('support-cron: sweep failed', e?.message);
    return res.status(500).json({ error: 'Sweep failed' });
  }
}
