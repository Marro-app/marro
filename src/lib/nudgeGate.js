// ── Nudge gate — pure "still relevant?" + frequency-cap logic (Slice 13) ────
// The key §12 requirement: a held nudge re-checks its condition at send time
// and cancels itself if the trigger no longer holds. Pure + injectable so the
// truth table is Vitest-covered; api/support.js (and the mock stub) run THIS.
//
// context (assembled by the caller from live data at evaluation time):
//   userActiveThread   — the target has an open/new/waiting support thread
//   userMessagedSince  — the target sent any support message after the nudge
//                        was created (they already reached out — don't nudge)
//   sentToTargetInWindow — nudges already SENT to this user inside the
//                          frequency window (cap = 1/user/window, plan §12)

export const NUDGE_FREQUENCY_WINDOW_DAYS = 7;

// → { action: 'send' | 'wait' | 'cancel', reason }
export function evaluateNudge(nudge, context, nowMs = Date.now()) {
  if (!nudge || nudge.state !== 'scheduled') return { action: 'wait', reason: 'not_scheduled' };
  if (nudge.send_after && new Date(nudge.send_after).getTime() > nowMs) {
    return { action: 'wait', reason: 'not_due' };
  }
  const ctx = context || {};
  // Frequency cap: never stack nudges on one person.
  if ((ctx.sentToTargetInWindow || 0) >= 1) return { action: 'cancel', reason: 'frequency_cap' };
  // The universal still-relevant check: they already came to us.
  if (ctx.userMessagedSince) return { action: 'cancel', reason: 'user_already_messaged' };
  const kind = nudge.recheck_condition?.type || 'always';
  switch (kind) {
    case 'always':
      return { action: 'send', reason: 'no_condition' };
    case 'no_open_support_thread':
      // Only relevant while they DON'T have a live thread with us.
      return ctx.userActiveThread
        ? { action: 'cancel', reason: 'thread_already_open' }
        : { action: 'send', reason: 'condition_holds' };
    default:
      // Unknown condition (a future detector this build doesn't know) —
      // fail SAFE: never auto-send on a condition we can't verify.
      return { action: 'cancel', reason: 'unknown_condition' };
  }
}

// The admin-composer preview line ("this user's trigger cleared — still
// send?"). Null = nothing to warn about.
export function composeWarning(context) {
  const ctx = context || {};
  if (ctx.userMessagedSince || ctx.userActiveThread) {
    return 'This user already has an open support thread — a nudge may be redundant.';
  }
  if ((ctx.sentToTargetInWindow || 0) >= 1) {
    return `They were already nudged in the last ${NUDGE_FREQUENCY_WINDOW_DAYS} days — this one will be auto-cancelled.`;
  }
  return null;
}
