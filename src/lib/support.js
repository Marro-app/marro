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
  { key: 'question', type: 'question', label: 'Question', emoji: '❓', blurb: 'Ask us anything', motif: 'none' },
  { key: 'bug',      type: 'bug',      label: 'Bug',      emoji: '🐛', blurb: 'Something broke',  motif: 'bug'  },
  { key: 'idea',     type: 'feedback', label: 'Idea',     emoji: '💡', blurb: 'Suggest an idea',  motif: 'idea' },
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

// Total unread admin replies across all of the user's threads — drives the
// launcher badge.
export function totalUnread(conversations) {
  return (conversations || []).reduce((n, c) => n + (c.unread_user || 0), 0);
}
