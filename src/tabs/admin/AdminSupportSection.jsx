import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { C } from '../../lib/theme.js';
import { Card, SectionTitle, EmptyState, Modal } from '../../components/primitives.jsx';
import { Icon } from '../../components/icons.jsx';
import { supportAdminCall } from '../../lib/data.js';
import { categoryForType, subscribeToMessages, subscribeToConversations } from '../../lib/support.js';
import { INBOX_FILTERS, filterInbox, agoLabel, handledByLabel } from '../../lib/supportAdmin.js';
import { resolveAvailability, DEFAULT_BUSINESS_HOURS } from '../../lib/supportAvailability.js';
import { canTransition, waitingLabel, SNOOZE_PRESETS } from '../../lib/supportLifecycle.js';
import { joinSupportPresence, presenceLabel } from '../../lib/supportPresence.js';
import AttachmentImg from '../../components/support/AttachmentImg.jsx';
import SupportMetricsView from './SupportMetricsView.jsx';
import SupportNudgesView from './SupportNudgesView.jsx';

// How often the open console re-affirms "an admin is actually here" — well
// inside the resolver's 20-minute staleness window.
const HEARTBEAT_MS = 5 * 60000;

const OVERRIDE_OPTIONS = [
  { key: 'auto', label: 'Auto' },
  { key: 'on', label: 'Available' },
  { key: 'off', label: 'Away' },
];

// Curated common zones — the caller's own saved tz is always included even
// if it's not in this list (e.g. set some other way), so the select never
// silently drops their choice.
const TIMEZONE_OPTIONS = [
  { value: 'America/New_York', label: 'Eastern' },
  { value: 'America/Chicago', label: 'Central' },
  { value: 'America/Denver', label: 'Mountain' },
  { value: 'America/Los_Angeles', label: 'Pacific' },
  { value: 'America/Anchorage', label: 'Alaska' },
  { value: 'Pacific/Honolulu', label: 'Hawaii' },
  { value: 'UTC', label: 'UTC' },
];

const DAY_ROWS = [
  { key: 'mon', label: 'Monday' }, { key: 'tue', label: 'Tuesday' }, { key: 'wed', label: 'Wednesday' },
  { key: 'thu', label: 'Thursday' }, { key: 'fri', label: 'Friday' }, { key: 'sat', label: 'Saturday' },
  { key: 'sun', label: 'Sunday' },
];

function formatHour(h) {
  const hour = h % 24;
  const period = hour < 12 ? 'AM' : 'PM';
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return h === 24 ? 'Midnight' : `${twelve}:00 ${period}`;
}
// Start options exclude 24 (a block can't start at midnight-the-end-marker);
// end options exclude 0 (a block can't end at midnight-the-start-marker) and
// include 24 (through midnight).
const START_HOURS = Array.from({ length: 24 }, (_, h) => h);
const END_HOURS = Array.from({ length: 24 }, (_, h) => h + 1);

// Pre-fills the editor with the EFFECTIVE schedule (falling back to the
// 9am-9pm default per day, same as the resolver does) rather than a blank
// slate — so opening the editor for the first time shows what's actually
// in effect, not "nothing set up."
function defaultDraftHours(current) {
  const base = current && typeof current === 'object' ? current : {};
  const tz = base.tz || DEFAULT_BUSINESS_HOURS.tz;
  const days = {};
  for (const { key } of DAY_ROWS) {
    days[key] = Array.isArray(base[key]) ? base[key] : DEFAULT_BUSINESS_HOURS[key];
  }
  return { tz, ...days };
}

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
  const note = !!msg.is_internal_note;
  return (
    <div style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '82%', display: 'flex', flexDirection: 'column', gap: 2 }}>
      <div style={{
        padding: '9px 12px', borderRadius: 14, fontSize: 13.5, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        // Internal notes are visually unmistakable (amber + dashed) — they
        // exist only in the admin lane; the user RLS lane excludes them.
        background: note ? C.amberLight : mine ? C.selBg : C.surface,
        border: note ? `1px dashed ${C.amber}` : `1px solid ${mine ? C.sel : C.border}`,
        color: C.text,
        borderBottomRightRadius: mine ? 4 : 14,
        borderBottomLeftRadius: mine ? 14 : 4,
      }}>
        {msg.body}
      </div>
      {Array.isArray(msg.attachments) && msg.attachments.map((a) => (
        <AttachmentImg key={a.path} refObj={a} />
      ))}
      <div style={{ fontSize: 10.5, color: C.textMid, alignSelf: mine ? 'flex-end' : 'flex-start', padding: '0 2px' }}>
        {note ? `Internal note — user never sees this · ${msg.sender_email || 'admin'} · ${agoLabel(msg.created_at)}`
          : mine ? `${msg.sender_email || 'admin'} · ${agoLabel(msg.created_at)}` : agoLabel(msg.created_at)}
      </div>
    </div>
  );
}

export default function AdminSupportSection({ initialConversationId, onInitialConversationConsumed } = {}) {
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
  const [profile, setProfile] = useState(null);   // identity summary (Slice 9)
  const [canned, setCanned] = useState([]);       // canned replies (Slice 14)
  const [noteMode, setNoteMode] = useState(false); // composer sends an internal note
  const [tagInput, setTagInput] = useState('');

  const listRef = useRef(null);
  const errId = useId();
  const fieldId = useId();

  const [settings, setSettings] = useState(null);
  const [showMetrics, setShowMetrics] = useState(false); // Metrics view (Slice 12)
  const [showNudges, setShowNudges] = useState(false);   // Nudges view (Slice 13)

  // Availability (Slice 6): heartbeat while the console is open (this is the
  // "an admin is actually here" signal the resolver requires), plus the
  // manual Auto/Available/Away override. First beat doubles as the fetch.
  useEffect(() => {
    let alive = true;
    const beat = async () => {
      const res = await supportAdminCall('heartbeat');
      if (alive && res?.ok && res.settings) setSettings(res.settings);
    };
    beat();
    const t = setInterval(beat, HEARTBEAT_MS);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const setOverride = useCallback(async (override) => {
    const res = await supportAdminCall('set_availability', { override });
    if (res?.ok && res.settings) setSettings(res.settings);
  }, []);

  // Business-hours editor (per-admin): opens with the EFFECTIVE current
  // schedule as its starting draft, saves the whole thing atomically.
  const [hoursOpen, setHoursOpen] = useState(false);
  const [draftHours, setDraftHours] = useState(null);
  const [savingHours, setSavingHours] = useState(false);
  const openHoursEditor = useCallback(() => {
    setDraftHours(defaultDraftHours(settings?.business_hours));
    setHoursOpen(true);
  }, [settings]);
  const saveBusinessHours = useCallback(async () => {
    setSavingHours(true);
    const res = await supportAdminCall('set_business_hours', { business_hours: draftHours });
    setSavingHours(false);
    if (res?.ok && res.settings) { setSettings(res.settings); setHoursOpen(false); }
  }, [draftHours]);

  // Canned replies (Slice 14): load once per console visit.
  useEffect(() => {
    let alive = true;
    supportAdminCall('canned_list').then((res) => { if (alive && res?.ok) setCanned(res.canned || []); });
    return () => { alive = false; };
  }, []);
  const saveCanned = useCallback(async () => {
    const text = draft.trim();
    if (!text) return;
    const res = await supportAdminCall('canned_save', { body: text });
    if (res?.ok && res.canned) setCanned((cs) => [...cs, res.canned]);
  }, [draft]);
  const deleteCanned = useCallback(async (id) => {
    const res = await supportAdminCall('canned_delete', { canned_id: id });
    if (res?.ok) setCanned((cs) => cs.filter((c) => c.id !== id));
  }, []);

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
    setProfile(null);
    setNoteMode(false);
    setTagInput('');
    setThreadLoading(true);
    const res = await supportAdminCall('thread', { conversation_id: convo.id });
    if (!res || res.ok === false || res.error) {
      setReplyError(res?.error || "Couldn't load this thread. Please try again.");
    } else {
      setMessages(res.messages || []);
      setProfile(res.profile || null);
      // Opening zeroed unread_admin server-side — mirror it locally.
      setConversations((cs) => cs.map((c) => (c.id === convo.id ? { ...c, unread_admin: 0 } : c)));
    }
    setThreadLoading(false);
  }, []);

  // Deep link from a Discord alert (?support_convo=<id>, see App.jsx): once
  // the inbox has loaded, jump straight into that thread. Guarded by a ref
  // (not just the prop) so it fires exactly once even if the parent's clear
  // callback lags a render behind.
  const deepLinkHandledRef = useRef(false);
  useEffect(() => {
    if (!initialConversationId || deepLinkHandledRef.current || loading) return;
    deepLinkHandledRef.current = true;
    const row = conversations.find((c) => c.id === initialConversationId);
    if (row) openThread(row);
    onInitialConversationConsumed?.();
  }, [initialConversationId, conversations, loading, openThread, onInitialConversationConsumed]);

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
    // Note mode (Slice 9): the composer writes an internal note instead of a
    // user-visible reply — no claim, no unread bump, user never sees it.
    if (noteMode) {
      const res = await supportAdminCall('add_note', { conversation_id: openConvo.id, body: text });
      if (!res || res.ok === false || res.error) {
        setReplyError(res?.error || "Couldn't save the note. Please try again.");
      } else {
        setDraft('');
        if (res.message) setMessages((ms) => (ms.some((x) => x.id === res.message.id) ? ms : [...ms, res.message]));
      }
      setSending(false);
      return;
    }
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
  }, [draft, sending, openConvo, callerEmail, noteMode]);

  const onComposerKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendReply(); }
  };

  // ── Presence soft-lock (Slice 8) ──────────────────────────────────────────
  // One shared presence channel: broadcast what I'm viewing/typing, render
  // what the other admin is up to. Awareness only — auto-claim still settles
  // ownership; this just stops the split-second double-reply.
  const [peers, setPeers] = useState([]);
  const presenceRef = useRef(null);
  const typingTimer = useRef(null);
  useEffect(() => {
    if (!callerEmail) return undefined;
    let dead = false;
    joinSupportPresence(callerEmail, setPeers).then((h) => {
      if (dead) h.leave(); else presenceRef.current = h;
    });
    return () => { dead = true; presenceRef.current?.leave(); presenceRef.current = null; };
  }, [callerEmail]);
  useEffect(() => {
    presenceRef.current?.update({ viewing: openConvo?.id || null, typing: false });
  }, [openConvo?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Composer keystrokes broadcast "typing" (debounced off after 2.5s idle).
  const onDraftChange = useCallback((value) => {
    setDraft(value);
    presenceRef.current?.update({ typing: true });
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => presenceRef.current?.update({ typing: false }), 2500);
  }, []);
  useEffect(() => () => { if (typingTimer.current) clearTimeout(typingTimer.current); }, []);

  // ── Lifecycle + ownership actions (Slice 7) ────────────────────────────────
  const [actionBusy, setActionBusy] = useState(false);
  const [reassignOpen, setReassignOpen] = useState(false);
  const [reassignTo, setReassignTo] = useState('');
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const [snoozeCustom, setSnoozeCustom] = useState(''); // datetime-local value, '' = presets only

  // Patch the acted-on conversation everywhere it lives (thread + list).
  const applyConvo = useCallback((row) => {
    if (!row) return;
    setOpenConvo((c) => (c && c.id === row.id ? { ...c, ...row } : c));
    setConversations((cs) => cs.map((c) => (c.id === row.id ? { ...c, ...row } : c)));
  }, []);

  const doAction = useCallback(async (action, params = {}) => {
    if (!openConvo || actionBusy) return;
    setActionBusy(true);
    setReplyError('');
    const res = await supportAdminCall(action, { conversation_id: openConvo.id, ...params });
    if (!res || res.ok === false || res.error) {
      setReplyError(res?.error || "That didn't go through. Please try again.");
    } else {
      applyConvo(res.conversation);
      setReassignOpen(false);
      setReassignTo('');
      setSnoozeOpen(false);
      setSnoozeCustom('');
    }
    setActionBusy(false);
  }, [openConvo, actionBusy, applyConvo]);

  const visible = filterInbox(conversations, filter, callerEmail);

  if (showMetrics && !openConvo) {
    return <SupportMetricsView onBack={() => setShowMetrics(false)} />;
  }
  if (showNudges && !openConvo) {
    return <SupportNudgesView onBack={() => setShowNudges(false)} />;
  }

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
              {profile?.school ? ` · ${profile.school}` : ''}
              {profile?.joined ? ` · joined ${new Date(profile.joined).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}` : ''}
            </div>
          </div>
          <span style={{ flexShrink: 0, fontSize: 11, fontWeight: 600, color: handledBy ? C.teal : C.textMid, background: handledBy ? C.tealLight : C.surface, border: `1px solid ${handledBy ? C.tealMid : C.border}`, borderRadius: 999, padding: '4px 10px' }}>
            {handledBy ? `Handled by ${handledBy}` : 'Unassigned'}
          </span>
        </div>

        {(() => {
          const here = presenceLabel(peers, openConvo.id);
          if (!here) return null;
          return (
            <div role="status" style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10, padding: '8px 11px', borderRadius: 10, background: C.blueLight, border: `1px solid ${C.border}`, fontSize: 12, color: C.text }}>
              <Icon name="live" size={13} color={C.blue} />
              <span>
                <strong>{here.email}</strong> is {here.kind === 'typing' ? 'typing in' : 'viewing'} this thread — first reply claims it.
              </span>
            </div>
          );
        })()}

        {/* Lifecycle + ownership controls (Slice 7). Which buttons show is
            driven by the same pure state machine the backend enforces, so the
            UI can never offer an illegal move. All ghost/outlined (rule 9 —
            no competing primaries; Send stays the one filled action). */}
        <div role="group" aria-label="Conversation actions" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
          {[
            canTransition(openConvo.status, 'resolved') && { label: 'Resolve', onClick: () => doAction('set_status', { status: 'resolved' }) },
            canTransition(openConvo.status, 'snoozed') && { label: snoozeOpen ? 'Cancel snooze' : 'Snooze', onClick: () => { setSnoozeOpen((v) => !v); setSnoozeCustom(''); } },
            ['resolved', 'archived', 'snoozed'].includes(openConvo.status) && { label: 'Reopen', onClick: () => doAction('set_status', { status: 'open' }) },
            openConvo.status === 'resolved' && { label: 'Archive', onClick: () => doAction('set_status', { status: 'archived' }) },
            !!openConvo.assigned_admin && { label: 'Release', onClick: () => doAction('release') },
            !!openConvo.assigned_admin && { label: reassignOpen ? 'Cancel reassign' : 'Reassign', onClick: () => { setReassignOpen((v) => !v); setReassignTo(''); } },
          ].filter(Boolean).map((b) => (
            <button key={b.label} type="button" onClick={b.onClick} disabled={actionBusy} className="btn-pop hit-slop"
              style={{ minHeight: 32, padding: '6px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: `1px solid ${C.border}`, background: 'transparent', color: C.text, opacity: actionBusy ? 0.6 : 1 }}>
              {b.label}
            </button>
          ))}
          {openConvo.status === 'snoozed' && openConvo.snooze_until && (
            <span style={{ alignSelf: 'center', fontSize: 11, color: C.textMid }}>
              Snoozed until {new Date(openConvo.snooze_until).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric' })}
            </span>
          )}
        </div>
        {snoozeOpen && (
          <div role="group" aria-label="Snooze duration" style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
            {SNOOZE_PRESETS.map((p) => (
              <button key={p.minutes} type="button" disabled={actionBusy}
                onClick={() => doAction('set_status', { status: 'snoozed', snooze_minutes: p.minutes })}
                className="btn-pop hit-slop"
                style={{ minHeight: 32, padding: '6px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: `1px solid ${C.border}`, background: 'transparent', color: C.text, opacity: actionBusy ? 0.6 : 1 }}>
                {p.label}
              </button>
            ))}
            <label htmlFor={`${fieldId}-snooze-until`} style={{ fontSize: 12, fontWeight: 600, color: C.text, marginLeft: 4 }}>or until</label>
            <input
              id={`${fieldId}-snooze-until`}
              type="datetime-local"
              value={snoozeCustom}
              onChange={(e) => setSnoozeCustom(e.target.value)}
              min={new Date(Date.now() + 5 * 60000).toISOString().slice(0, 16)}
              style={{ minHeight: 32, padding: '5px 9px', fontSize: 12, borderRadius: 8, border: `1px solid ${C.border}`, background: C.surface, color: C.text, boxSizing: 'border-box', outline: 'none' }}
            />
            <button type="button" disabled={!snoozeCustom || actionBusy}
              onClick={() => doAction('set_status', { status: 'snoozed', snooze_until: new Date(snoozeCustom).toISOString() })}
              className="btn-pop"
              style={{ minHeight: 32, padding: '6px 12px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', border: `1px solid ${C.border}`, background: 'transparent', color: C.text, opacity: (!snoozeCustom || actionBusy) ? 0.5 : 1 }}>
              Set
            </button>
          </div>
        )}
        {/* Triage (Slice 9): priority + tags. Priority is a small aria-pressed
            chip trio; tags are whole-array edits via a labeled input. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
          <span id={`${fieldId}-prio-label`} style={{ fontSize: 11.5, fontWeight: 600, color: C.textMid }}>Priority</span>
          <div role="group" aria-labelledby={`${fieldId}-prio-label`} style={{ display: 'flex', gap: 4 }}>
            {['low', 'normal', 'urgent'].map((p) => {
              const active = (openConvo.priority || 'normal') === p;
              return (
                <button key={p} type="button" aria-pressed={active} disabled={actionBusy}
                  onClick={() => doAction('set_priority', { priority: p })}
                  className="hit-slop"
                  style={{ minHeight: 28, padding: '4px 10px', borderRadius: 999, fontSize: 11, fontWeight: active ? 700 : 500, cursor: 'pointer',
                    border: `1px solid ${active ? (p === 'urgent' ? C.danger : C.sel) : C.border}`,
                    background: active ? (p === 'urgent' ? C.dangerLight : C.selBg) : 'transparent',
                    color: active && p === 'urgent' ? C.danger : C.text }}>
                  {p === 'urgent' ? 'Urgent' : p === 'low' ? 'Low' : 'Normal'}
                </button>
              );
            })}
          </div>
          <label htmlFor={`${fieldId}-tags`} style={{ fontSize: 11.5, fontWeight: 600, color: C.textMid, marginLeft: 4 }}>Tags</label>
          <input
            id={`${fieldId}-tags`}
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                const next = [...(openConvo.tags || []), ...tagInput.split(',')].map((t) => t.trim()).filter(Boolean);
                if (next.length) doAction('set_tags', { tags: next });
                setTagInput('');
              }
            }}
            placeholder="add tag ⏎"
            style={{ width: 110, minHeight: 30, padding: '5px 9px', fontSize: 11.5, borderRadius: 8, border: `1px solid ${C.border}`, background: C.surface, color: C.text, boxSizing: 'border-box', outline: 'none' }}
          />
          {(openConvo.tags || []).map((t) => (
            <span key={t} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, color: C.text, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 999, padding: '3px 4px 3px 9px' }}>
              {t}
              <button type="button" aria-label={`Remove tag ${t}`} disabled={actionBusy}
                onClick={() => doAction('set_tags', { tags: (openConvo.tags || []).filter((x) => x !== t) })}
                className="xbtn"
                style={{ width: 18, height: 18, borderRadius: 9, border: 'none', background: 'transparent', color: C.textMid, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, lineHeight: 1 }}>
                <span aria-hidden="true">✕</span>
              </button>
            </span>
          ))}
        </div>

        {/* Debug info (bug reports, plan §7): collapsible, technical-only. */}
        {openConvo.tech_context && (
          <details style={{ marginBottom: 10, border: `1px solid ${C.border}`, borderRadius: 10, padding: '8px 12px', background: C.surface }}>
            <summary style={{ fontSize: 12, fontWeight: 600, color: C.text, cursor: 'pointer' }}>Debug info</summary>
            <pre className="themed-scroll" style={{ margin: '8px 0 2px', fontSize: 11, lineHeight: 1.5, color: C.textMid, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 180, overflowY: 'auto' }}>
              {JSON.stringify(openConvo.tech_context, null, 2)}
            </pre>
          </details>
        )}

        {reassignOpen && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
            <label htmlFor={`${fieldId}-reassign`} style={{ fontSize: 12, fontWeight: 600, color: C.text }}>Hand to</label>
            <input
              id={`${fieldId}-reassign`}
              type="email"
              value={reassignTo}
              onChange={(e) => setReassignTo(e.target.value)}
              placeholder="other admin's email"
              style={{ flex: 1, minHeight: 36, padding: '7px 11px', fontSize: 12.5, borderRadius: 9, border: `1px solid ${C.border}`, background: C.surface, color: C.text, boxSizing: 'border-box', outline: 'none' }}
            />
            <button type="button" disabled={!reassignTo.trim() || actionBusy}
              onClick={() => doAction('reassign', { admin_email: reassignTo.trim() })}
              className="btn-pop"
              style={{ minHeight: 36, padding: '7px 14px', borderRadius: 9, fontSize: 12, fontWeight: 700, cursor: 'pointer', border: `1px solid ${C.border}`, background: 'transparent', color: C.text, opacity: (!reassignTo.trim() || actionBusy) ? 0.5 : 1 }}>
              Hand off
            </button>
          </div>
        )}

        <div ref={listRef} className="themed-scroll"
          style={{ maxHeight: 420, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10, padding: '4px 2px 10px' }}>
          {threadLoading
            ? <div role="status" aria-live="polite" style={{ margin: '24px auto', color: C.textMid, fontSize: 13 }}>Loading thread…</div>
            : messages.map((m) => <AdminBubble key={m.id} msg={m} />)}
        </div>

        {/* Archived threads are read-only until reopened (plan §9.5). */}
        {openConvo.status === 'archived' ? (
          <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 10, fontSize: 12, color: C.textMid }}>
            {replyError && <div id={errId} role="alert" style={{ fontSize: 12, color: C.danger, marginBottom: 8 }}>{replyError}</div>}
            This thread is archived — reopen it to reply.
          </div>
        ) : (
        <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 10 }}>
          {replyError && <div id={errId} role="alert" style={{ fontSize: 12, color: C.danger, marginBottom: 8 }}>{replyError}</div>}
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: noteMode ? C.amber : C.textMid, fontWeight: 600, marginBottom: 8, cursor: 'pointer' }}>
            <input type="checkbox" checked={noteMode} onChange={(e) => setNoteMode(e.target.checked)} style={{ width: 15, height: 15, accentColor: C.amber }} />
            Internal note — the user never sees this
          </label>
          {!noteMode && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
              <select
                aria-label="Insert a canned reply"
                value=""
                onChange={(e) => {
                  const c = canned.find((x) => x.id === e.target.value);
                  if (c) onDraftChange(draft ? `${draft}\n${c.body}` : c.body);
                }}
                style={{ minHeight: 34, padding: '6px 10px', fontSize: 12, borderRadius: 8, border: `1px solid ${C.border}`, background: C.surface, color: C.text, maxWidth: 220 }}>
                <option value="" disabled>Canned replies…</option>
                {canned.length === 0 && <option value="" disabled>None saved yet</option>}
                {canned.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
              </select>
              {draft.trim() && (
                <button type="button" onClick={saveCanned} className="btn-pop hit-slop"
                  style={{ minHeight: 30, padding: '5px 11px', borderRadius: 8, fontSize: 11.5, fontWeight: 600, cursor: 'pointer', border: `1px solid ${C.border}`, background: 'transparent', color: C.text }}>
                  Save draft as canned
                </button>
              )}
              {canned.length > 0 && (
                <details style={{ fontSize: 11.5, color: C.textMid }}>
                  <summary style={{ cursor: 'pointer' }}>Manage</summary>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 }}>
                    {canned.map((c) => (
                      <span key={c.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ color: C.text }}>{c.title}</span>
                        <button type="button" aria-label={`Delete canned reply ${c.title}`} onClick={() => deleteCanned(c.id)} className="xbtn"
                          style={{ width: 20, height: 20, borderRadius: 10, border: 'none', background: 'transparent', color: C.textMid, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, lineHeight: 1 }}>
                          <span aria-hidden="true">✕</span>
                        </button>
                      </span>
                    ))}
                  </div>
                </details>
              )}
            </div>
          )}
          <label htmlFor={fieldId} style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' }}>
            {noteMode ? 'Your internal note' : 'Your reply'}
          </label>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
            <textarea
              id={fieldId}
              value={draft}
              onChange={(e) => onDraftChange(e.target.value)}
              onKeyDown={onComposerKeyDown}
              placeholder={noteMode ? 'Internal note…' : openConvo.assigned_admin ? 'Reply…' : 'Reply (this claims the thread for you)…'}
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
        )}
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
        <button type="button" onClick={() => setShowNudges(true)} className="hit-slop"
          style={{ flexShrink: 0, minHeight: 36, padding: '8px 12px', borderRadius: 9, border: `1px solid ${C.border}`, background: 'transparent', color: C.text, fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
          Nudges
        </button>
        <button type="button" onClick={() => setShowMetrics(true)} className="hit-slop"
          style={{ flexShrink: 0, minHeight: 36, padding: '8px 12px', borderRadius: 9, border: `1px solid ${C.border}`, background: 'transparent', color: C.text, fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
          Metrics
        </button>
        <button type="button" onClick={() => { setLoading(true); load(); }} aria-label="Refresh inbox" className="hit-slop"
          style={{ flexShrink: 0, minHeight: 36, padding: '8px 12px', borderRadius: 9, border: `1px solid ${C.border}`, background: 'transparent', color: C.text, fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
          Refresh
        </button>
      </div>

      {/* Availability (Slice 6, per-admin): live pill (text + color, never
          color alone) + the manual override — both scoped to the CALLER's
          own row now, not a shared team toggle. The team-wide "we're online"
          the user sees is the OR of every admin's own pill (resolveTeamAvailability).
          Kept in its own bordered strip, separate from the inbox filter row
          below — two different concerns that were reading as one crowded line. */}
      {(() => {
        const avail = resolveAvailability(Date.now(), settings);
        const current = settings?.online_override || 'auto';
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', margin: '10px 0 14px', padding: '8px 10px', borderRadius: 12, border: `1px solid ${C.border}`, background: C.surface }}>
            <span role="status" style={{ fontSize: 11.5, fontWeight: 700, color: avail.online ? C.green : C.textMid, background: avail.online ? C.greenLight : 'transparent', border: `1px solid ${avail.online ? 'transparent' : C.border}`, borderRadius: 999, padding: '4px 10px' }}>
              {avail.online ? "You're online" : "You're away"}
            </span>
            <div role="group" aria-label="Your availability override" style={{ display: 'flex', gap: 4 }}>
              {OVERRIDE_OPTIONS.map((o) => {
                const active = current === o.key;
                return (
                  <button key={o.key} type="button" aria-pressed={active} onClick={() => setOverride(o.key)} className="hit-slop"
                    style={{ minHeight: 30, padding: '5px 11px', borderRadius: 999, fontSize: 11.5, fontWeight: active ? 700 : 500, cursor: 'pointer',
                      border: `1px solid ${active ? C.sel : C.border}`, background: active ? C.selBg : 'transparent', color: C.text }}>
                    {o.label}
                  </button>
                );
              })}
            </div>
            <button type="button" onClick={openHoursEditor} aria-label="Edit your business hours" title="Edit your business hours" className="hit-slop"
              style={{ marginLeft: 'auto', minWidth: 30, minHeight: 30, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                borderRadius: 999, border: `1px solid ${C.border}`, background: 'transparent', color: C.textMid, cursor: 'pointer' }}>
              <Icon name="settings" size={15} color={C.textMid} />
            </button>
          </div>
        );
      })()}

      {hoursOpen && draftHours && (
        <Modal title="Your business hours" onClose={() => setHoursOpen(false)} width={520}>
          <p style={{ fontSize: 12.5, color: C.textMid, margin: '0 0 14px' }}>
            Used by "Auto" to decide when you count as online. Each day can have its own hours, or none at all.
          </p>
          <label htmlFor="avail-tz" style={{ fontSize: 12.5, fontWeight: 600, display: 'block', marginBottom: 4 }}>Timezone</label>
          <select id="avail-tz" value={draftHours.tz}
            onChange={(e) => setDraftHours((d) => ({ ...d, tz: e.target.value }))}
            style={{ width: '100%', minHeight: 40, padding: '6px 10px', borderRadius: 8, border: `1px solid ${C.border}`, background: C.surface, color: C.text, marginBottom: 16 }}>
            {TIMEZONE_OPTIONS.some((t) => t.value === draftHours.tz) ? null
              : <option value={draftHours.tz}>{draftHours.tz}</option>}
            {TIMEZONE_OPTIONS.map((t) => <option key={t.value} value={t.value}>{t.label} ({t.value})</option>)}
          </select>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {DAY_ROWS.map(({ key, label }) => {
              const blocks = draftHours[key] || [];
              const working = blocks.length > 0;
              const dayLegendId = `avail-day-${key}`;
              return (
                <div key={key} style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: '10px 12px' }} role="group" aria-labelledby={dayLegendId}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <label id={dayLegendId} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, flex: 1 }}>
                      <input type="checkbox" checked={working} onChange={(e) => {
                        setDraftHours((d) => ({ ...d, [key]: e.target.checked ? [{ start: 9, end: 17 }] : [] }));
                      }} />
                      {label}
                    </label>
                    {working && (
                      <button type="button" onClick={() => setDraftHours((d) => ({ ...d, [key]: [...(d[key] || []), { start: 9, end: 17 }] }))}
                        className="hit-slop" style={{ fontSize: 11.5, fontWeight: 600, color: C.sel, background: 'transparent', border: 'none', cursor: 'pointer' }}>
                        + Add a range
                      </button>
                    )}
                  </div>
                  {working && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
                      {blocks.map((b, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <select value={b.start} aria-label={`${label} range ${i + 1} start time`}
                            onChange={(e) => setDraftHours((d) => {
                              const next = [...d[key]]; next[i] = { ...next[i], start: Number(e.target.value) };
                              return { ...d, [key]: next };
                            })}
                            style={{ minHeight: 34, padding: '4px 8px', borderRadius: 6, border: `1px solid ${C.border}`, background: C.surface, color: C.text }}>
                            {START_HOURS.map((h) => <option key={h} value={h}>{formatHour(h)}</option>)}
                          </select>
                          <span style={{ fontSize: 11.5, color: C.textMid }}>to</span>
                          <select value={b.end} aria-label={`${label} range ${i + 1} end time`}
                            onChange={(e) => setDraftHours((d) => {
                              const next = [...d[key]]; next[i] = { ...next[i], end: Number(e.target.value) };
                              return { ...d, [key]: next };
                            })}
                            style={{ minHeight: 34, padding: '4px 8px', borderRadius: 6, border: `1px solid ${C.border}`, background: C.surface, color: C.text }}>
                            {END_HOURS.map((h) => <option key={h} value={h}>{formatHour(h)}</option>)}
                          </select>
                          {blocks.length > 1 && (
                            <button type="button" aria-label={`Remove ${label} range ${i + 1}`}
                              onClick={() => setDraftHours((d) => ({ ...d, [key]: d[key].filter((_, j) => j !== i) }))}
                              className="hit-slop" style={{ fontSize: 11.5, color: C.danger, background: 'transparent', border: 'none', cursor: 'pointer' }}>
                              Remove
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
            <button type="button" onClick={() => setHoursOpen(false)} className="btn-pop" style={{ minHeight: 44, padding: '8px 16px', borderRadius: 10, border: `1px solid ${C.border}`, background: 'transparent', color: C.text, cursor: 'pointer' }}>
              Cancel
            </button>
            <button type="button" onClick={saveBusinessHours} disabled={savingHours} className="btn-fill"
              style={{ minHeight: 44, padding: '8px 16px', borderRadius: 10, border: 'none', background: C.teal, color: C.bg, cursor: savingHours ? 'default' : 'pointer', opacity: savingHours ? 0.7 : 1 }}>
              {savingHours ? 'Saving…' : 'Save hours'}
            </button>
          </div>
        </Modal>
      )}

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
                    {c.priority === 'urgent' ? ' · Urgent' : ''}
                    {handledBy ? ` · Handled by ${handledBy}` : c.status !== 'resolved' && c.status !== 'archived' ? ' · Unassigned' : ''}
                    {c.status === 'waiting_user' ? ' · Waiting on user' : ''}
                    {c.status === 'snoozed' ? ' · Snoozed' : ''}
                    {(c.status === 'resolved' || c.status === 'archived') ? ` · ${c.status === 'archived' ? 'Archived' : 'Resolved'}` : ''}
                  </span>
                </span>
                {(() => {
                  const here = presenceLabel(peers, c.id);
                  if (!here) return null;
                  return (
                    <span style={{ flexShrink: 0, fontSize: 10.5, fontWeight: 700, color: C.blue, background: C.blueLight, border: `1px solid ${C.border}`, borderRadius: 999, padding: '3px 8px' }}>
                      {here.email.split('@')[0]} {here.kind === 'typing' ? 'typing…' : 'viewing'}
                    </span>
                  );
                })()}
                {waitingLabel(c) && (
                  <span style={{ flexShrink: 0, fontSize: 10.5, fontWeight: 700, color: C.danger, background: C.dangerLight, border: `1px solid ${C.border}`, borderRadius: 999, padding: '3px 8px' }}>
                    {waitingLabel(c)}
                  </span>
                )}
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
