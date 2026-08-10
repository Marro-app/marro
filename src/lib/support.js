// ── Support chat — user-side data layer (Slice 2) ───────────────────────────
// Thin wrapper over the Slice-1 SECURITY DEFINER RPCs (writes) + RLS-scoped
// SELECTs (reads), all through `getSupabase()` so the mock harness
// (`?mock=1`) transparently swaps in its in-memory stub. Nothing here bypasses
// RLS: reads return only the caller's own conversations/messages (internal
// notes are filtered server-side), and every write goes through an RPC that
// re-checks ownership against auth.uid(). See supabase/support_chat.sql.
import { getSupabase } from './data.js';

// The three categories a user can pick when starting a thread. `type` is the
// value stored on support_conversations.type (the DB check constraint allows
// bug/feedback/question/billing/other); "Idea" maps to 'feedback'. `motif`
// drives the category-themed background in SupportPanel (plan §6).
export const SUPPORT_CATEGORIES = [
  { key: 'question', type: 'question', label: 'Question', icon: 'help', blurb: 'Ask us anything', motif: 'none' },
  { key: 'bug',      type: 'bug',      label: 'Bug',      icon: 'bug',  blurb: 'Something broke',  motif: 'bug'  },
  { key: 'idea',     type: 'feedback', label: 'Idea',     icon: 'idea', blurb: 'Suggest an idea',  motif: 'idea' },
];

export function categoryForType(type) {
  return SUPPORT_CATEGORIES.find((c) => c.type === type) || SUPPORT_CATEGORIES[0];
}

// The caller's conversations, most-recently-active first. RLS returns only
// rows where user_id = auth.uid().
export async function fetchConversations() {
  const sb = await getSupabase();
  const { data, error } = await sb
    .from('support_conversations')
    .select('*')
    .order('last_message_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

// Messages for one thread, oldest-first. RLS excludes internal notes and any
// conversation the caller doesn't own, so an id that isn't theirs returns [].
export async function fetchMessages(conversationId) {
  const sb = await getSupabase();
  const { data, error } = await sb
    .from('support_messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

// Open a new thread with its first message (atomic, server-side). Returns the
// new conversation id.
export async function startConversation({ type, body, techContext = null }) {
  const sb = await getSupabase();
  const { data, error } = await sb.rpc('support_start_conversation', {
    p_type: type, p_body: body, p_tech_context: techContext,
  });
  if (error) throw error;
  return data;
}

// Append a user message to one of the caller's own threads. Returns the new
// message id. Auto-reopen of a resolved/archived thread happens server-side.
export async function postMessage({ conversationId, body }) {
  const sb = await getSupabase();
  const { data, error } = await sb.rpc('support_post_user_message', {
    p_conversation_id: conversationId, p_body: body, p_attachments: null,
  });
  if (error) throw error;
  return data;
}

// Mark admin replies on the caller's thread as seen (zeroes unread_user).
// Best-effort: a failure here only means the unread badge lingers.
export async function markRead(conversationId) {
  const sb = await getSupabase();
  const { error } = await sb.rpc('support_mark_read', { p_conversation_id: conversationId });
  if (error) throw error;
}

// End (archive) the caller's own support chat. Archived ≠ deleted: it stays
// re-openable for REOPEN_WINDOW_MS, then the client stops surfacing it.
export async function archiveConversation(conversationId) {
  const sb = await getSupabase();
  const { error } = await sb.rpc('support_archive_conversation', { p_conversation_id: conversationId });
  if (error) throw error;
}

// Reopen a resolved/archived chat (flips it back to open).
export async function reopenConversation(conversationId) {
  const sb = await getSupabase();
  const { error } = await sb.rpc('support_reopen_conversation', { p_conversation_id: conversationId });
  if (error) throw error;
}

// ── Availability (Slice 6) ──────────────────────────────────────────────────
// The panel's status line: read the single settings row (RLS: any signed-in
// user) and resolve it client-side. Null on any failure → callers fall back
// to the neutral "we usually reply within a day" copy.
export async function fetchAvailability() {
  try {
    const sb = await getSupabase();
    const { data, error } = await sb.from('support_settings').select('*').eq('id', 1).maybeSingle();
    if (error) return null;
    const { resolveAvailability } = await import('./supportAvailability.js');
    return resolveAvailability(Date.now(), data);
  } catch {
    return null;
  }
}

// Live updates to the single settings row — an admin's heartbeat going stale
// or an override flip should update an already-open panel's status line, not
// just the next cold fetch. Resolves each change before calling back so the
// caller never has to re-import the resolver.
export async function subscribeToAvailability(onChange) {
  const sb = await getSupabase();
  if (typeof sb.channel !== 'function') return () => {};
  const { resolveAvailability } = await import('./supportAvailability.js');
  const ch = sb.channel('support-availability')
    .on('postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'support_settings', filter: 'id=eq.1' },
      (payload) => { if (payload?.new) onChange(resolveAvailability(Date.now(), payload.new)); })
    .subscribe();
  return () => { try { sb.removeChannel(ch); } catch { /* already gone */ } };
}

// ── Outbound alerts (Slice 5) ───────────────────────────────────────────────
// Fire-and-forget nudge to api/support-notify.js after a user message lands:
// pings the founders' Discord (debounced server-side) and drops the one-time
// "we'll get back to you" system message into an unattended question. Never
// throws and never blocks the send path — a failed notify only means no ping.
export async function notifySupport(conversationId) {
  try {
    const sb = await getSupabase();
    // Dev harness: the stub simulates the reassurance path in-memory.
    if (import.meta.env.DEV && sb.__mockApi) { sb.__mockApi('notify', 'notify', { conversation_id: conversationId }); return; }
    const { data: { session } } = await sb.auth.getSession();
    const token = session?.access_token;
    if (!token) return;
    fetch('/api/support-notify', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversation_id: conversationId }),
    }).catch(() => {});
  } catch { /* best-effort */ }
}

// ── Realtime (Slice 4) ──────────────────────────────────────────────────────
// Live delivery via postgres_changes. RLS scopes what each side receives:
// users only get events for their own rows (internal notes excluded by the
// user-lane policy); admins get everything via the is_admin() lane. Each
// helper resolves to an UNSUBSCRIBE function — callers must run it on unmount
// or the channel leaks. Fail-soft: if the client has no channel support
// (defensive), the unsubscribe is a no-op and callers fall back to refetch.

// New messages on one conversation (both directions).
export async function subscribeToMessages(conversationId, onInsert) {
  const sb = await getSupabase();
  if (typeof sb.channel !== 'function') return () => {};
  const ch = sb.channel(`support-msgs-${conversationId}`)
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'support_messages', filter: `conversation_id=eq.${conversationId}` },
      (payload) => { if (payload?.new) onInsert(payload.new); })
    .subscribe();
  return () => { try { sb.removeChannel(ch); } catch { /* already gone */ } };
}

// Conversation-level changes (new threads, unread/status/last_message bumps).
// Fires with the changed row; callers usually just refetch or patch state.
export async function subscribeToConversations(onChange) {
  const sb = await getSupabase();
  if (typeof sb.channel !== 'function') return () => {};
  const ch = sb.channel('support-convos')
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'support_conversations' },
      (payload) => { if (payload?.new) onChange(payload.new); })
    .subscribe();
  return () => { try { sb.removeChannel(ch); } catch { /* already gone */ } };
}

// Total unread admin replies across all of the user's threads — drives the
// launcher badge.
export function totalUnread(conversations) {
  return (conversations || []).reduce((n, c) => n + (c.unread_user || 0), 0);
}

// ── Single-active-chat model (product rule) ─────────────────────────────────
// A user may have only one open *Question* at a time; bugs/ideas are unlimited
// one-off submissions. An ended chat is archived and stays re-openable for a
// week, then drops off the user's view.
export const ACTIVE_STATUSES = ['new', 'open', 'waiting_user'];
export const REOPEN_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

// The caller's one open Question chat, if any (null otherwise).
export function findActiveQuestion(conversations) {
  return (conversations || []).find(
    (c) => c.type === 'question' && ACTIVE_STATUSES.includes(c.status),
  ) || null;
}

// Every Question the user ended within the reopen window (newest first) —
// surfaced as the hub's "Recent chats" list. Older archived chats fall out of view.
export function findReopenableChats(conversations) {
  const now = Date.now();
  return (conversations || [])
    .filter((c) => c.type === 'question' && c.status === 'archived' && c.archived_at
      && (now - new Date(c.archived_at).getTime()) < REOPEN_WINDOW_MS)
    .sort((a, b) => new Date(b.archived_at) - new Date(a.archived_at));
}
