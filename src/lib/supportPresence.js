// ── Support admin presence (Slice 8, plan §9.5) ─────────────────────────────
// One shared Realtime Presence channel for the whole admin console: each
// admin tracks { viewing: <conversationId|null>, typing: <bool> } keyed by
// their email. Peers' states power the "viewing / typing" chips on inbox rows
// and the soft-lock banner inside a thread — awareness only, no locking:
// assignment (auto-claim) still settles ownership.
//
// Fail-soft everywhere: no channel support (or the mock stub) → a no-op
// handle, and the console simply shows no presence chips.
import { getSupabase } from './data.js';

export async function joinSupportPresence(email, onPeers) {
  const noop = { update: () => {}, leave: () => {} };
  if (!email) return noop;
  const sb = await getSupabase();
  if (typeof sb.channel !== 'function') return noop;

  const ch = sb.channel('support-admin-presence', { config: { presence: { key: email } } });
  if (typeof ch.track !== 'function' || typeof ch.presenceState !== 'function') {
    // Mock stub / older client — presence not emulated; stay silent.
    try { sb.removeChannel(ch); } catch { /* never joined */ }
    return noop;
  }

  let current = { viewing: null, typing: false };
  ch.on('presence', { event: 'sync' }, () => {
    const state = ch.presenceState() || {};
    const peers = [];
    for (const [key, metas] of Object.entries(state)) {
      if (key === email) continue; // never show yourself to yourself
      const meta = Array.isArray(metas) ? metas[metas.length - 1] : metas;
      peers.push({ email: key, viewing: meta?.viewing ?? null, typing: !!meta?.typing });
    }
    onPeers(peers);
  }).subscribe((status) => {
    if (status === 'SUBSCRIBED') ch.track(current);
  });

  return {
    // Patch what this admin broadcasts ({viewing} and/or {typing}).
    update(patch) {
      current = { ...current, ...patch };
      try { ch.track(current); } catch { /* channel gone — harmless */ }
    },
    leave() { try { sb.removeChannel(ch); } catch { /* already gone */ } },
  };
}

// Peers on one conversation → the strongest signal to surface (typing beats
// viewing). Pure; null when nobody else is there.
export function presenceLabel(peers, conversationId) {
  const here = (peers || []).filter((p) => p.viewing === conversationId);
  if (!here.length) return null;
  const typing = here.find((p) => p.typing);
  if (typing) return { email: typing.email, kind: 'typing' };
  return { email: here[0].email, kind: 'viewing' };
}
