import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { C } from '../../lib/theme.js';
import { Card, SectionTitle, EmptyState } from '../../components/primitives.jsx';
import { Icon } from '../../components/icons.jsx';
import { supportAdminCall } from '../../lib/data.js';
import { categoryForType, subscribeToMessages, subscribeToConversations } from '../../lib/support.js';
import { INBOX_FILTERS, filterInbox, agoLabel, handledByLabel } from '../../lib/supportAdmin.js';

// Support inbox (Slice 3) — list conversations, open a thread, reply.
// Every action goes through api/support.js (service-role, admin re-checked
// server-side — see that file's trust-boundary header); this component never
// touches the support tables directly. First admin reply AUTO-CLAIMS an
// unassigned thread to the replier (locked decision, plan §9.5) — opening a
// thread to peek does not. Manual refresh only for now; Realtime is Slice 4,
// lifecycle controls (resolve/snooze/queues) are Slice 7.

// Subject preview for a row: form submissions store multi-line bodies in
// `subject`, so collapse whitespace into one line and let CSS ellipsize.
function oneLine(text) {
  return (text || '').replace(/\s+/g, ' ').trim() || 'Support chat';
}

function AdminBubble({ msg }) {
  if (msg.sender === 'system') {
    return (
      <div style={{ alignSelf: 'center', maxWidth: '90%', textAlign: 'center', fontSize: 11.5, color: C.textMid, padding: '4px 10px', lineHeight: 1.5 }}>
        {msg.body}
      </div>
    );
  }
  // Admin console perspective: admin messages on the right, the user's on the left.
  const mine = msg.sender === 'admin';
  return (
    <div style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '82%', display: 'flex', flexDirection: 'column', gap: 2 }}>
      <div style={{
        padding: '9px 12px', borderRadius: 14, fontSize: 13.5, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        background: mine ? C.selBg : C.surface,
        border: `1px solid ${mine ? C.sel : C.border}`,
        color: C.text,
        borderBottomRightRadius: mine ? 4 : 14,
        borderBottomLeftRadius: mine ? 14 : 4,
      }}>
        {msg.body}
      </div>
      <div style={{ fontSize: 10.5, color: C.textMid, alignSelf: mine ? 'flex-end' : 'flex-start', padding: '0 2px' }}>
        {mine ? `${msg.sender_email || 'admin'} · ${agoLabel(msg.created_at)}` : agoLabel(msg.created_at)}
      </div>
    </div>
  );
}

export default function AdminSupportSection() {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [conversations, setConversations] = useState([]);
  const [callerEmail, setCallerEmail] = useState('');
  const [filter, setFilter] = useState('active');

  const [openConvo, setOpenConvo] = useState(null);   // null = inbox list view
  const [messages, setMessages] = useState([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [replyError, setReplyError] = useState('');

  const listRef = useRef(null);
  const errId = useId();
  const fieldId = useId();

  const load = useCallback(async () => {
    setLoadError('');
    const res = await supportAdminCall('list');
    if (!res || res.ok === false || res.error) {
      setLoadError(res?.error || "Couldn't load the support inbox. Please try again.");
    } else {
      setConversations(res.conversations || []);
      setCallerEmail((res.caller_email || '').toLowerCase());
    }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  // Keep the transcript pinned to the newest message.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, threadLoading]);

  // Live inbox (Slice 4): conversation changes stream in over the admin RLS
  // lane. Known rows are patched in place (preserving the user_name/email
  // enrichment the event payload doesn't carry) and re-sorted by activity; a
  // BRAND-NEW conversation triggers a full reload to pick up its enrichment.
  useEffect(() => {
    let dead = false, unsub = null;
    subscribeToConversations((row) => {
      setOpenConvo((c) => (c && c.id === row.id ? { ...c, ...row } : c));
      setConversations((cs) => {
        const idx = cs.findIndex((c) => c.id === row.id);
        if (idx < 0) { load(); return cs; }
        const next = [...cs];
        next[idx] = { ...next[idx], ...row };
        next.sort((a, b) => new Date(b.last_message_at) - new Date(a.last_message_at));
        return next;
      });
    }).then((u) => { if (dead) u(); else unsub = u; });
    return () => { dead = true; if (unsub) unsub(); };
  }, [load]);

  // Live thread: new messages on the open conversation append as they land
  // (dedup by id — our own replies also arrive back through the channel).
  useEffect(() => {
    if (!openConvo?.id) return undefined;
    let dead = false, unsub = null;
    subscribeToMessages(openConvo.id, (m) => {
      setMessages((ms) => (ms.some((x) => x.id === m.id) ? ms : [...ms, m]));
    }).then((u) => { if (dead) u(); else unsub = u; });
    return () => { dead = true; if (unsub) unsub(); };
  }, [openConvo?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const openThread = useCallback(async (convo) => {
    setOpenConvo(convo);
    setMessages([]);
    setReplyError('');
    setDraft('');
    setThreadLoading(true);
    const res = await supportAdminCall('thread', { conversation_id: convo.id });
    if (!res || res.ok === false || res.error) {
      setReplyError(res?.error || "Couldn't load this thread. Please try again.");
    } else {
      setMessages(res.messages || []);
      // Opening zeroed unread_admin server-side — mirror it locally.
      setConversations((cs) => cs.map((c) => (c.id === convo.id ? { ...c, unread_admin: 0 } : c)));
    }
    setThreadLoading(false);
  }, []);

  const backToInbox = useCallback(() => {
    setOpenConvo(null);
    setMessages([]);
    setReplyError('');
    setDraft('');
  }, []);

  const sendReply = useCallback(async () => {
    const text = draft.trim();
    if (!text || sending || !openConvo) return;
    setSending(true);
    setReplyError('');
    const res = await supportAdminCall('reply', { conversation_id: openConvo.id, body: text });
    if (!res || res.ok === false || res.error) {
      setReplyError(res?.error || "Couldn't send the reply. Please try again.");
    } else {
      setDraft('');
      if (res.message) setMessages((ms) => [...ms, res.message]);
      // Reflect the auto-claim + activity bump locally so the inbox row updates
      // without a refetch (the next manual refresh reconciles with the DB).
      const nowIso = new Date().toISOString();
      const assigned = res.assigned_admin || callerEmail;
      setOpenConvo((c) => (c ? { ...c, assigned_admin: assigned, status: c.status === 'new' ? 'open' : c.status, last_message_at: nowIso } : c));
      setConversations((cs) => cs.map((c) => (c.id === openConvo.id
        ? { ...c, assigned_admin: assigned, status: c.status === 'new' ? 'open' : c.status, last_message_at: nowIso, first_response_at: c.first_response_at || nowIso }
        : c)));
    }
    setSending(false);
  }, [draft, sending, openConvo, callerEmail]);

  const onComposerKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendReply(); }
  };

  const visible = filterInbox(conversations, filter, callerEmail);

  // ── Thread view ────────────────────────────────────────────────────────────
  if (openConvo) {
    const cat = categoryForType(openConvo.type);
    const handledBy = handledByLabel(openConvo.assigned_admin, callerEmail);
    return (
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <button type="button" onClick={backToInbox} aria-label="Back to inbox" className="hit-slop"
            style={{ flexShrink: 0, width: 36, height: 36, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 9, border: `1px solid ${C.border}`, background: 'transparent', color: C.text, cursor: 'pointer' }}>
            <Icon name="chevron" size={16} color={C.text} style={{ transform: 'rotate(90deg)' }} />
          </button>
          <span aria-hidden="true" style={{ flexShrink: 0, display: 'inline-flex' }}><Icon name={cat.icon} size={18} color={C.textMid} /></span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {oneLine(openConvo.subject)}
            </div>
            <div style={{ fontSize: 11.5, color: C.textMid, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {openConvo.user_name || openConvo.user_email || openConvo.user_id}
              {openConvo.user_name && openConvo.user_email ? ` · ${openConvo.user_email}` : ''}
              {' · '}{cat.label}
            </div>
          </div>
          <span style={{ flexShrink: 0, fontSize: 11, fontWeight: 600, color: handledBy ? C.teal : C.textMid, background: handledBy ? C.tealLight : C.surface, border: `1px solid ${handledBy ? C.tealMid : C.border}`, borderRadius: 999, padding: '4px 10px' }}>
            {handledBy ? `Handled by ${handledBy}` : 'Unassigned'}
          </span>
        </div>

        <div ref={listRef} className="themed-scroll"
          style={{ maxHeight: 420, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10, padding: '4px 2px 10px' }}>
          {threadLoading
            ? <div role="status" aria-live="polite" style={{ margin: '24px auto', color: C.textMid, fontSize: 13 }}>Loading thread…</div>
            : messages.map((m) => <AdminBubble key={m.id} msg={m} />)}
        </div>

        <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 10 }}>
          {replyError && <div id={errId} role="alert" style={{ fontSize: 12, color: C.danger, marginBottom: 8 }}>{replyError}</div>}
          <label htmlFor={fieldId} style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' }}>
            Your reply
          </label>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
            <textarea
              id={fieldId}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onComposerKeyDown}
              placeholder={openConvo.assigned_admin ? 'Reply…' : 'Reply (this claims the thread for you)…'}
              rows={1}
              aria-invalid={replyError ? true : undefined}
              aria-describedby={replyError ? errId : undefined}
              style={{ flex: 1, resize: 'none', maxHeight: 120, minHeight: 44, padding: '11px 12px', fontSize: 13.5, lineHeight: 1.5, fontFamily: 'inherit', borderRadius: 12, border: `1px solid ${C.border}`, background: C.surface, color: C.text, boxSizing: 'border-box', outline: 'none' }}
            />
            <button type="button" onClick={sendReply} disabled={!draft.trim() || sending} aria-label="Send reply" className="btn-fill"
              style={{ flexShrink: 0, width: 44, height: 44, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 12, border: 'none', background: C.teal, color: C.bg, cursor: draft.trim() && !sending ? 'pointer' : 'default', opacity: draft.trim() && !sending ? 1 : 0.5, transition: 'opacity .15s' }}>
              <Icon name="send" size={18} color={C.bg} />
            </button>
          </div>
        </div>
      </Card>
    );
  }

  // ── Inbox list view ────────────────────────────────────────────────────────
  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <SectionTitle sub="Questions, bug reports, and ideas from users. First reply claims the thread.">Support inbox</SectionTitle>
        </div>
        <button type="button" onClick={() => { setLoading(true); load(); }} aria-label="Refresh inbox" className="hit-slop"
          style={{ flexShrink: 0, minHeight: 36, padding: '8px 12px', borderRadius: 9, border: `1px solid ${C.border}`, background: 'transparent', color: C.text, fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
          Refresh
        </button>
      </div>

      <div role="group" aria-label="Inbox filters" style={{ display: 'flex', gap: 6, margin: '10px 0 12px', flexWrap: 'wrap' }}>
        {INBOX_FILTERS.map((f) => {
          const active = filter === f.key;
          return (
            <button key={f.key} type="button" aria-pressed={active} onClick={() => setFilter(f.key)} className="hit-slop"
              style={{ minHeight: 34, padding: '7px 13px', borderRadius: 999, fontSize: 12.5, fontWeight: active ? 700 : 500, cursor: 'pointer',
                border: `1px solid ${active ? C.sel : C.border}`, background: active ? C.selBg : 'transparent', color: C.text }}>
              {f.label}
            </button>
          );
        })}
      </div>

      {loadError && <div role="alert" style={{ fontSize: 12, color: C.danger, marginBottom: 10 }}>{loadError}</div>}

      {loading ? (
        <EmptyState>Loading support inbox…</EmptyState>
      ) : visible.length === 0 ? (
        <EmptyState>
          {filter === 'unassigned' ? 'No unassigned conversations — nothing is waiting for a first reply.'
            : filter === 'mine' ? "You haven't claimed any open conversations."
            : 'No conversations here yet. New messages from users will appear in this inbox.'}
        </EmptyState>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {visible.map((c) => {
            const cat = categoryForType(c.type);
            const handledBy = handledByLabel(c.assigned_admin, callerEmail);
            const who = c.user_name || c.user_email || c.user_id;
            return (
              <button key={c.id} type="button" onClick={() => openThread(c)}
                aria-label={`Open conversation: ${oneLine(c.subject)} from ${who}${c.unread_admin > 0 ? `, ${c.unread_admin} unread` : ''}`}
                style={{ display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left', padding: '12px', borderRadius: 12, cursor: 'pointer', minHeight: 58, background: c.unread_admin > 0 ? C.selBg : C.surface, border: `1px solid ${c.unread_admin > 0 ? C.sel : C.border}`, color: C.text }}>
                <span aria-hidden="true" style={{ width: 26, display: 'inline-flex', justifyContent: 'center', flexShrink: 0 }}>
                  <Icon name={cat.icon} size={20} color={C.text} />
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 13.5, fontWeight: c.unread_admin > 0 ? 700 : 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {oneLine(c.subject)}
                  </span>
                  <span style={{ display: 'block', fontSize: 11.5, color: C.textMid, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {who} · {cat.label} · {agoLabel(c.last_message_at)}
                    {handledBy ? ` · Handled by ${handledBy}` : c.status !== 'resolved' && c.status !== 'archived' ? ' · Unassigned' : ''}
                    {(c.status === 'resolved' || c.status === 'archived') ? ` · ${c.status === 'archived' ? 'Archived' : 'Resolved'}` : ''}
                  </span>
                </span>
                {c.unread_admin > 0 && (
                  <span aria-hidden="true" style={{ flexShrink: 0, minWidth: 18, height: 18, padding: '0 5px', borderRadius: 9, background: C.danger, color: C.bg, fontSize: 10.5, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                    {c.unread_admin > 9 ? '9+' : c.unread_admin}
                  </span>
                )}
                <Icon name="chevron" size={14} color={C.textMid} style={{ transform: 'rotate(-90deg)', flexShrink: 0 }} />
              </button>
            );
          })}
        </div>
      )}
    </Card>
  );
}
