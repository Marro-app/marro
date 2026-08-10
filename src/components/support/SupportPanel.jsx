import React, { useState, useEffect, useRef, useCallback, useId, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { C } from '../../lib/theme.js';
import { XBtn } from '../primitives.jsx';
import { Icon } from '../icons.jsx';
import {
  SUPPORT_CATEGORIES, categoryForType, fetchConversations, fetchMessages,
  startConversation, postMessage, markRead, archiveConversation, reopenConversation,
  subscribeToMessages, notifySupport, fetchAvailability, findActiveQuestion, findReopenableChats, ACTIVE_STATUSES,
} from '../../lib/support.js';
import { availabilityLine } from '../../lib/supportAvailability.js';
import { buildTechContext } from '../../lib/consoleBuffer.js';

// ── Category-themed background (plan §6) ─────────────────────────────────────
// Decorative, aria-hidden motif that changes with the conversation type:
//   bug  → little beetles crawling around on randomized headings
//   idea → soft bokeh "lights" drifting + twinkling in the background
//   question/other → clean surface (no motif)
// All motion is transform/opacity only (GPU) and FREEZES under
// prefers-reduced-motion (see the media query in the <style> below) — the crawl
// stops with the bugs scattered in place, the lights hold a static glow.
// Everything sits BEHIND the glass panel body at low opacity, so text contrast
// never drops below 4.5:1 in either theme. Layout is randomized per open.
const rand = (a, b) => a + Math.random() * (b - a);

// Is this open thread the user's active support chat (so it can be "ended")?
// Only Questions are single-active + user-endable; bugs/ideas are submissions.
function isActiveQuestion(convo) {
  return !!convo && convo.type === 'question' && ACTIVE_STATUSES.includes(convo.status);
}

// Short "ended 2d ago" relative label for the Recent-chats list.
function endedAgo(iso) {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// Top-down beetle drawn facing +x (its travel direction), on a 20×20 grid.
function Beetle({ size, color, seam }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true" style={{ display: 'block', color }}>
      <g stroke="currentColor" strokeWidth="0.9" strokeLinecap="round" opacity="0.9">
        {/* six legs (three per side) + antennae */}
        <path d="M8 7.4 L5.4 5.2 M6.6 10 L3.5 10 M8 12.6 L5.4 14.8" />
        <path d="M11.4 7.4 L14 5.2 M12.6 10 L15.7 10 M11.4 12.6 L14 14.8" />
        <path d="M15 9.1 L17.6 7.4 M15 10.9 L17.6 12.6" />
      </g>
      <ellipse cx="9.6" cy="10" rx="5.3" ry="3.6" fill="currentColor" />
      <circle cx="15" cy="10" r="1.7" fill="currentColor" />
      {/* carapace seam — panel-bg coloured so it reads as a split shell */}
      <path d="M9.7 6.7 L9.7 13.3" stroke={seam} strokeWidth="0.7" strokeLinecap="round" />
    </svg>
  );
}

function BugField() {
  const bugs = useMemo(() => {
    const tints = [C.danger, C.textMid, C.blue];
    return Array.from({ length: 7 }, (_, i) => ({
      id: i,
      top: rand(6, 84), left: rand(6, 84),
      heading: rand(0, 360),
      dist: rand(80, 200),
      dur: rand(15, 28),
      delay: -rand(0, 24),
      wig: rand(0.45, 0.9),
      size: rand(13, 21),
      tint: tints[i % tints.length],
    }));
  }, []);
  return (
    <div className="sup-bg" aria-hidden="true" style={{ '--sup-seam': C.bg }}>
      {bugs.map((b) => (
        <span key={b.id} className="sup-bug" style={{ top: `${b.top}%`, left: `${b.left}%`, transform: `rotate(${b.heading}deg)` }}>
          <span className="sup-bug-crawl" style={{ animationDuration: `${b.dur}s`, animationDelay: `${b.delay}s`, '--dist': `${b.dist}px` }}>
            <span className="sup-bug-wig" style={{ animationDuration: `${b.wig}s` }}>
              <Beetle size={b.size} color={b.tint} seam={C.bg} />
            </span>
          </span>
        </span>
      ))}
    </div>
  );
}

function LightField() {
  const lights = useMemo(() => {
    const tints = [C.marigold, C.amber, C.cream, C.blue];
    return Array.from({ length: 10 }, (_, i) => ({
      id: i,
      top: rand(-6, 100), left: rand(-6, 100),
      size: rand(18, 100),
      op: rand(0.25, 0.6),
      tw: rand(4.5, 9),
      dr: rand(9, 16),
      delay: -rand(0, 8),
      dx: rand(-16, 16), dy: rand(-16, 16),
      tint: tints[i % tints.length],
    }));
  }, []);
  return (
    <div className="sup-bg" aria-hidden="true">
      {lights.map((l) => (
        <span
          key={l.id}
          className="sup-light"
          style={{
            top: `${l.top}%`, left: `${l.left}%`, width: l.size, height: l.size,
            background: `radial-gradient(circle, ${l.tint} 0%, transparent 70%)`,
            animationDuration: `${l.tw}s, ${l.dr}s`, animationDelay: `${l.delay}s, ${l.delay}s`,
            '--op': l.op, '--dx': `${l.dx}px`, '--dy': `${l.dy}px`,
          }}
        />
      ))}
    </div>
  );
}

function CategoryBackdrop({ motif }) {
  if (motif === 'bug') return <BugField />;
  if (motif === 'idea') return <LightField />;
  return null;
}

// Bug + Idea are structured submissions, not conversations: instead of a chat
// composer they render a short form whose fields are composed into the first
// message body. Question stays a chat. `compose` produces plain text (bubbles
// don't render markdown) that the admin reads verbatim in the thread.
const SUPPORT_FORMS = {
  bug: {
    submitLabel: 'Submit bug report',
    sentLabel: 'bug report',
    fields: [
      { key: 'what', label: 'What went wrong?', placeholder: 'Describe the problem…', required: true, rows: 3 },
      { key: 'steps', label: 'What were you doing when it happened?', placeholder: 'Optional — the steps that led to it', required: false, rows: 2 },
    ],
    compose: (v) => `What went wrong:\n${v.what.trim()}`
      + (v.steps && v.steps.trim() ? `\n\nWhat I was doing:\n${v.steps.trim()}` : ''),
  },
  idea: {
    submitLabel: 'Submit idea',
    sentLabel: 'idea',
    fields: [
      { key: 'idea', label: "What's your idea?", placeholder: 'Describe your idea…', required: true, rows: 3 },
      { key: 'why', label: 'What would it help you do?', placeholder: 'Optional — the problem it would solve', required: false, rows: 2 },
    ],
    compose: (v) => `Idea:\n${v.idea.trim()}`
      + (v.why && v.why.trim() ? `\n\nWhy it would help:\n${v.why.trim()}` : ''),
  },
};

function Bubble({ msg }) {
  const mine = msg.sender === 'user';
  if (msg.sender === 'system') {
    return (
      <div style={{ alignSelf: 'center', maxWidth: '90%', textAlign: 'center', fontSize: 11.5, color: C.textMid, padding: '4px 10px', lineHeight: 1.5 }}>
        {msg.body}
      </div>
    );
  }
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
    </div>
  );
}

export default function SupportPanel({ onClose }) {
  const panelRef = useRef(null);
  const listRef = useRef(null);
  const [prevFocus] = useState(() => document.activeElement);
  const errId = useId();
  const fieldId = useId();

  const [loading, setLoading] = useState(true);
  const [conversations, setConversations] = useState([]); // all the user's threads
  const [convo, setConvo] = useState(null);       // the open thread (thread/sent/ended views)
  const [messages, setMessages] = useState([]);
  const [view, setView] = useState('hub');        // 'hub' | 'ask' | 'form' | 'thread' | 'sent' | 'ended'
  const [formKey, setFormKey] = useState('bug');  // which form on the 'form' screen ('bug' | 'idea')
  const [draft, setDraft] = useState('');
  const [form, setForm] = useState({});            // bug/idea form field values
  const [sentKind, setSentKind] = useState(null);  // 'bug report' | 'idea' — for the confirmation
  const [confirmingEnd, setConfirmingEnd] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const [availability, setAvailability] = useState(null); // resolved {online, reason} | null

  // Honest status line (Slice 6): resolved from support_settings on open.
  // Null (loading/failed) renders the neutral default copy.
  useEffect(() => {
    let alive = true;
    fetchAvailability().then((a) => { if (alive) setAvailability(a); });
    return () => { alive = false; };
  }, []);

  // The one open Question (if any) and every chat ended within the reopen window —
  // drive the hub's "Continue your chat" card and "Recent chats" list.
  const activeQuestion = findActiveQuestion(conversations);
  const pastChats = findReopenableChats(conversations);

  // The bug/idea form shown on the 'form' screen.
  const activeForm = view === 'form' ? SUPPORT_FORMS[formKey] : null;

  // Category drives the header label + background motif, and depends on the
  // screen: the form screen follows the picked kind; a thread follows its
  // conversation. The hub + ask (question) screens are neutral (no motif).
  const screenCat = view === 'form'
    ? (SUPPORT_CATEGORIES.find((c) => c.key === formKey) || SUPPORT_CATEGORIES[0])
    : categoryForType(convo ? convo.type : 'question');
  const motifKind = (view === 'hub' || view === 'ask') ? 'none' : screenCat.motif;

  // On open: land in a thread only when a reply is WAITING; otherwise open the
  // hub (home). An active chat with no new reply is one tap away via the hub's
  // "Continue your chat" row — we don't dump you straight into it every time.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const convos = await fetchConversations();
        if (!alive) return;
        setConversations(convos);
        const target = convos.find((c) => c.unread_user > 0);
        if (target) {
          const msgs = await fetchMessages(target.id);
          if (!alive) return;
          setConvo(target);
          setMessages(msgs);
          setView('thread');
          if (target.unread_user > 0) {
            markRead(target.id).catch(() => {});
            setConversations((cs) => cs.map((c) => (c.id === target.id ? { ...c, unread_user: 0 } : c)));
          }
        } else {
          setView('hub');
        }
      } catch {
        if (alive) setView('hub'); // fail soft — let them still start something
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  // Keep the transcript pinned to the newest message.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, loading, view]);

  // Live delivery (Slice 4): while a thread is open, new messages stream in
  // over Realtime (RLS-scoped to this user's own rows). Admin replies arriving
  // while we're looking are marked read immediately, so no stale badge. Dedup
  // by id — our own sends also come back through the channel after the refetch.
  useEffect(() => {
    if (view !== 'thread' || !convo?.id) return undefined;
    const convoId = convo.id;
    let dead = false, unsub = null;
    subscribeToMessages(convoId, (m) => {
      setMessages((ms) => (ms.some((x) => x.id === m.id) ? ms : [...ms, m]));
      if (m.sender === 'admin') {
        markRead(convoId).catch(() => {});
        setConversations((cs) => cs.map((c) => (c.id === convoId ? { ...c, unread_user: 0 } : c)));
      }
    }).then((u) => { if (dead) u(); else unsub = u; });
    return () => { dead = true; if (unsub) unsub(); };
  }, [view, convo?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Focus trap + Esc + focus restore (mirrors the Modal primitive's contract).
  useEffect(() => {
    const panel = panelRef.current;
    const focusables = () => panel ? [...panel.querySelectorAll('button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])')].filter((el) => !el.disabled && el.offsetParent !== null) : [];
    const first = focusables()[0];
    (first || panel)?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
      if (e.key === 'Tab') {
        const f = focusables(); if (!f.length) return;
        const a = f[0], b = f[f.length - 1];
        if (e.shiftKey && document.activeElement === a) { e.preventDefault(); b.focus(); }
        else if (!e.shiftKey && document.activeElement === b) { e.preventDefault(); a.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (prevFocus && prevFocus.focus) prevFocus.focus();
    };
  }, [onClose, prevFocus]);

  // Open an existing thread (continue an active chat, or reopen-then-open).
  const openThread = useCallback(async (target) => {
    setError(null); setConfirmingEnd(false);
    const msgs = await fetchMessages(target.id);
    setConvo(target);
    setMessages(msgs);
    setView('thread');
    if (target.unread_user > 0) {
      markRead(target.id).catch(() => {});
      setConversations((cs) => cs.map((c) => (c.id === target.id ? { ...c, unread_user: 0 } : c)));
    }
  }, []);

  // Send a chat message: starts the single Question (from the 'ask' screen) or
  // replies in the open thread. Bugs/ideas never go through here (submitForm).
  const send = useCallback(async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true); setError(null);
    try {
      if (view === 'ask') {
        const id = await startConversation({ type: 'question', body });
        notifySupport(id); // fire-and-forget: Discord ping + auto-reassurance (slice 5)
        const convos = await fetchConversations();
        setConversations(convos);
        const target = convos.find((c) => c.id === id) || null;
        setConvo(target);
        setMessages(target ? await fetchMessages(id) : []);
        setView('thread');
      } else {
        await postMessage({ conversationId: convo.id, body });
        notifySupport(convo.id); // fire-and-forget (slice 5)
        setMessages(await fetchMessages(convo.id));
        setConversations((cs) => cs.map((c) => (c.id === convo.id
          ? { ...c, last_message_at: new Date().toISOString(), status: (c.status === 'resolved' || c.status === 'archived') ? 'open' : c.status }
          : c)));
      }
      setDraft('');
    } catch {
      setError("Couldn't send your message. Please try again.");
    } finally {
      setSending(false);
    }
  }, [draft, sending, view, convo]);

  // Submit the bug/idea form → creates a conversation from the composed fields,
  // then shows a confirmation (not a chat). One-off; doesn't touch the active chat.
  const submitForm = useCallback(async () => {
    if (sending || !activeForm) return;
    const missing = activeForm.fields.some((f) => f.required && !(form[f.key] || '').trim());
    if (missing) { setError('Please fill in the required field.'); return; }
    setSending(true); setError(null);
    try {
      const cat = SUPPORT_CATEGORIES.find((c) => c.key === formKey) || SUPPORT_CATEGORIES[0];
      const body = activeForm.compose(form);
      // Bug reports auto-attach technical context (plan §7): environment +
      // recent console errors. Technical ONLY — never financial data (§4).
      const techContext = cat.type === 'bug' ? buildTechContext() : null;
      const id = await startConversation({ type: cat.type, body, techContext });
      notifySupport(id); // fire-and-forget: Discord ping (slice 5)
      const convos = await fetchConversations();
      setConversations(convos);
      setConvo(convos.find((c) => c.id === id) || null);
      setMessages([]);
      setForm({});
      setSentKind(activeForm.sentLabel);
      setView('sent');
    } catch {
      setError("Couldn't submit that. Please try again.");
    } finally {
      setSending(false);
    }
  }, [sending, activeForm, form, formKey]);

  // End (archive) the open chat — reached via the header + an inline confirm.
  const endChat = useCallback(async () => {
    if (!convo || sending) return;
    setSending(true); setError(null);
    try {
      await archiveConversation(convo.id);
      setConversations(await fetchConversations());
      setConfirmingEnd(false);
      setView('ended');
    } catch {
      setError("Couldn't end the chat. Please try again.");
    } finally {
      setSending(false);
    }
  }, [convo, sending]);

  // Reopen a recently-ended chat from the picker.
  const reopenChat = useCallback(async (target) => {
    if (sending) return;
    setSending(true); setError(null);
    try {
      await reopenConversation(target.id);
      const convos = await fetchConversations();
      setConversations(convos);
      await openThread(convos.find((c) => c.id === target.id) || target);
    } catch {
      setError("Couldn't reopen the chat. Please try again.");
    } finally {
      setSending(false);
    }
  }, [sending, openThread]);

  // Hub navigation. The hub shows all three options; each opens its own screen.
  const goHub = () => { setView('hub'); setForm({}); setDraft(''); setConfirmingEnd(false); setError(null); };
  const goAsk = () => { setDraft(''); setError(null); setView('ask'); };
  const goForm = (key) => { setFormKey(key); setForm({}); setError(null); setView('form'); };
  // "Ask a question": start fresh if no chat is open; otherwise ask whether to
  // continue the open one or close it and start a new one.
  const onQuestion = () => { setError(null); setView(activeQuestion ? 'askChoice' : 'ask'); };

  // Close (archive) the open chat, then start a fresh question.
  const closeAndStartNew = useCallback(async () => {
    if (!activeQuestion || sending) return;
    setSending(true); setError(null);
    try {
      await archiveConversation(activeQuestion.id);
      setConversations(await fetchConversations());
      setDraft('');
      setView('ask');
    } catch {
      setError("Couldn't close the chat. Please try again.");
    } finally {
      setSending(false);
    }
  }, [activeQuestion, sending]);

  const onKeyDownField = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  };


  return createPortal((
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: C.scrim, display: 'flex', alignItems: 'flex-end', justifyContent: 'flex-end', padding: 16, boxSizing: 'border-box' }}
    >
      <style>{`
        @keyframes supSheetIn { from { opacity: 0; transform: translateY(16px) scale(0.98); } to { opacity: 1; transform: none; } }
        /* bugs: outer orients to a random heading; crawl translates forward in that
           frame (fading in/out to hide the loop reset); wig is the leg-scuttle. */
        @keyframes supCrawl { 0% { transform: translateX(0); opacity: 0; } 12%,88% { opacity: 0.42; } 100% { transform: translateX(var(--dist)); opacity: 0; } }
        @keyframes supWig { from { transform: rotate(-5deg) translateY(-0.4px); } to { transform: rotate(5deg) translateY(0.4px); } }
        /* lights: twinkle (opacity) + a slow drift. */
        @keyframes supTwinkle { from { opacity: calc(var(--op) * 0.35); } to { opacity: var(--op); } }
        @keyframes supDrift { from { transform: translate(0,0); } to { transform: translate(var(--dx), var(--dy)); } }
        .sup-sheet { animation: supSheetIn 260ms cubic-bezier(0.23,1,0.32,1) both; }
        .sup-bg { position: absolute; inset: 0; overflow: hidden; pointer-events: none; border-radius: inherit; }
        .sup-bug { position: absolute; }
        .sup-bug-crawl { display: block; animation-name: supCrawl; animation-timing-function: linear; animation-iteration-count: infinite; opacity: 0.42; }
        .sup-bug-wig { display: block; transform-origin: center; animation-name: supWig; animation-timing-function: ease-in-out; animation-iteration-count: infinite; animation-direction: alternate; }
        .sup-light { position: absolute; border-radius: 50%; filter: blur(6px); opacity: var(--op); animation-name: supTwinkle, supDrift; animation-timing-function: ease-in-out; animation-iteration-count: infinite; animation-direction: alternate; }
        @media (prefers-reduced-motion: reduce) {
          .sup-sheet { animation: none; }
          .sup-bug-crawl { animation: none; opacity: 0.3; }
          .sup-bug-wig { animation: none; }
          .sup-light { animation: none; opacity: calc(var(--op) * 0.6); }
        }
      `}</style>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Support and feedback"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="mm sup-sheet"
        style={{ position: 'relative', width: 'min(400px, 100%)', height: 'min(560px, 82vh)', display: 'flex', flexDirection: 'column', overflow: 'hidden', outline: 'none', padding: 0 }}
      >
        <CategoryBackdrop motif={motifKind} />

        {/* Header */}
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 8, padding: '14px 14px 12px', borderBottom: `1px solid ${C.border}` }}>
          {(view === 'ask' || view === 'askChoice' || view === 'form' || view === 'thread') && (
            <button
              type="button"
              onClick={goHub}
              aria-label="Back to menu"
              style={{ flexShrink: 0, width: 32, height: 32, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 8, border: 'none', background: 'transparent', color: C.text, cursor: 'pointer' }}
            >
              <Icon name="chevron" size={16} color={C.text} style={{ transform: 'rotate(90deg)' }} />
            </button>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>Support &amp; feedback</div>
            <div style={{ fontSize: 11.5, color: C.textMid, marginTop: 1, display: 'flex', alignItems: 'center', gap: 5 }}>
              {view === 'hub' ? availabilityLine(availability)
                : (view === 'ask' || view === 'askChoice') ? 'Ask a question'
                : (<>
                    <Icon name={screenCat.icon} size={13} color={C.textMid} />
                    {view === 'form' ? (formKey === 'bug' ? 'Report a bug' : 'Share an idea') : screenCat.label}
                  </>)}
            </div>
          </div>
          {view === 'thread' && isActiveQuestion(convo) && !confirmingEnd && (
            <button
              type="button"
              onClick={() => setConfirmingEnd(true)}
              className="btn-pop"
              style={{ fontSize: 12, fontWeight: 600, color: C.text, background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 8, padding: '6px 10px', cursor: 'pointer', minHeight: 34 }}
            >
              End chat
            </button>
          )}
          <XBtn label="Close support" onClick={onClose} size={32} iconSize={14} />
        </div>

        {/* Body */}
        <div ref={listRef} className="themed-scroll" style={{ position: 'relative', flex: 1, overflowY: 'auto', padding: '14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {loading ? (
            <div role="status" aria-live="polite" style={{ margin: 'auto', color: C.textMid, fontSize: 13 }}>Loading…</div>
          ) : view === 'sent' ? (
            <div style={{ margin: 'auto', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: '8px 4px' }}>
              <span aria-hidden="true" style={{ width: 46, height: 46, borderRadius: 23, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: C.tealLight, border: `1px solid ${C.tealMid}` }}>
                <Icon name="check" size={24} color={C.teal} strokeWidth={1.9} />
              </span>
              <div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>Thanks — we got your {sentKind}.</div>
              <div style={{ fontSize: 12.5, color: C.textMid, lineHeight: 1.5, maxWidth: 270 }}>
                We read every one. If we need more detail we&apos;ll reply here — you&apos;ll see it next time you open support.
              </div>
              <button type="button" onClick={goHub} className="btn-fill" style={{ marginTop: 4, padding: '10px 22px', borderRadius: 10, border: 'none', background: C.teal, color: C.bg, fontSize: 13, fontWeight: 700, cursor: 'pointer', minHeight: 44 }}>
                Done
              </button>
            </div>
          ) : view === 'ended' ? (
            <div style={{ margin: 'auto', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: '8px 4px' }}>
              <span aria-hidden="true" style={{ width: 46, height: 46, borderRadius: 23, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: C.tealLight, border: `1px solid ${C.tealMid}` }}>
                <Icon name="check" size={24} color={C.teal} strokeWidth={1.9} />
              </span>
              <div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>Chat ended</div>
              <div style={{ fontSize: 12.5, color: C.textMid, lineHeight: 1.5, maxWidth: 270 }}>
                Thanks for reaching out. You can reopen this chat for the next 7 days if you need us again.
              </div>
              {/* CSAT slot: when the satisfaction slice lands, the 👍/👎 "How did we do?"
                  prompt goes here (writes csat/csat_comment on this conversation). */}
              <button type="button" onClick={goHub} className="btn-fill" style={{ marginTop: 4, padding: '10px 22px', borderRadius: 10, border: 'none', background: C.teal, color: C.bg, fontSize: 13, fontWeight: 700, cursor: 'pointer', minHeight: 44 }}>
                Done
              </button>
            </div>
          ) : view === 'hub' ? (
            <>
              {/* An open chat gets its own prominent "Continue" card above the menu. */}
              {activeQuestion && (
                <button
                  type="button"
                  onClick={() => openThread(activeQuestion)}
                  aria-label={`Continue your chat${activeQuestion.unread_user > 0 ? `, ${activeQuestion.unread_user} unread` : ''}`}
                  style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left', padding: '13px 12px', borderRadius: 12, cursor: 'pointer', minHeight: 58, background: C.selBg, border: `1px solid ${C.sel}`, color: C.text }}
                >
                  <span aria-hidden="true" style={{ width: 26, display: 'inline-flex', justifyContent: 'center', flexShrink: 0 }}><Icon name="chat" size={21} color={C.text} /></span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 14, fontWeight: 700 }}>Continue your chat</span>
                    <span style={{ display: 'block', fontSize: 11.5, color: C.textMid, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{activeQuestion.subject || 'Pick up where you left off'}</span>
                  </span>
                  {activeQuestion.unread_user > 0 && (
                    <span aria-hidden="true" style={{ flexShrink: 0, minWidth: 18, height: 18, padding: '0 5px', borderRadius: 9, background: C.danger, color: C.bg, fontSize: 10.5, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{activeQuestion.unread_user > 9 ? '9+' : activeQuestion.unread_user}</span>
                  )}
                  <Icon name="chevron" size={14} color={C.textMid} style={{ transform: 'rotate(-90deg)', flexShrink: 0 }} />
                </button>
              )}
              <div style={{ fontSize: 13, color: C.textMid, lineHeight: 1.5, marginBottom: 2, marginTop: activeQuestion ? 4 : 0 }}>
                How can we help?
              </div>
              {[
                { key: 'question', icon: 'help', onClick: onQuestion, title: 'Ask a question', sub: 'Chat with us', badge: 0 },
                { key: 'bug', icon: 'bug', onClick: () => goForm('bug'), title: 'Report a bug', sub: 'Something broke', badge: 0 },
                { key: 'idea', icon: 'idea', onClick: () => goForm('idea'), title: 'Share an idea', sub: 'Suggest an improvement', badge: 0 },
              ].map((row) => (
                <button
                  key={row.key}
                  type="button"
                  onClick={row.onClick}
                  aria-label={row.badge > 0 ? `${row.title}, ${row.badge} unread` : undefined}
                  style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left', padding: '13px 12px', borderRadius: 12, cursor: 'pointer', minHeight: 58, background: C.surface, border: `1px solid ${C.border}`, color: C.text, transition: 'background .15s' }}
                >
                  <span aria-hidden="true" style={{ width: 26, display: 'inline-flex', justifyContent: 'center', flexShrink: 0 }}><Icon name={row.icon} size={21} color={C.text} /></span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 14, fontWeight: 600 }}>{row.title}</span>
                    <span style={{ display: 'block', fontSize: 11.5, color: C.textMid, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.sub}</span>
                  </span>
                  {row.badge > 0 && (
                    <span aria-hidden="true" style={{ flexShrink: 0, minWidth: 18, height: 18, padding: '0 5px', borderRadius: 9, background: C.danger, color: C.bg, fontSize: 10.5, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{row.badge > 9 ? '9+' : row.badge}</span>
                  )}
                  <Icon name="chevron" size={14} color={C.textMid} style={{ transform: 'rotate(-90deg)', flexShrink: 0 }} />
                </button>
              ))}
              {/* Recent chats — every chat ended within the last 7 days, each
                  re-openable. Hidden while a chat is active (can't run two at once);
                  they reappear once the current chat is ended. */}
              {!activeQuestion && pastChats.length > 0 && (
                <>
                  <div style={{ fontSize: 12, color: C.textMid, lineHeight: 1.5, marginTop: 6 }}>
                    Recent chats
                  </div>
                  {pastChats.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => reopenChat(c)}
                      disabled={sending}
                      aria-label={`Reopen chat: ${c.subject || 'support chat'}, ended ${endedAgo(c.archived_at)}`}
                      style={{ display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left', padding: '11px 12px', borderRadius: 12, cursor: sending ? 'default' : 'pointer', background: 'transparent', border: `1px dashed ${C.border}`, color: C.text, minHeight: 52 }}
                    >
                      <span aria-hidden="true" style={{ width: 26, display: 'inline-flex', justifyContent: 'center', flexShrink: 0 }}><Icon name="reopen" size={17} color={C.textMid} /></span>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ display: 'block', fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.subject || 'Support chat'}</span>
                        <span style={{ display: 'block', fontSize: 11, color: C.textMid }}>Ended {endedAgo(c.archived_at)} · tap to reopen</span>
                      </span>
                      <Icon name="chevron" size={13} color={C.textMid} style={{ transform: 'rotate(-90deg)', flexShrink: 0 }} />
                    </button>
                  ))}
                </>
              )}
            </>
          ) : view === 'askChoice' ? (
            <div style={{ margin: 'auto', display: 'flex', flexDirection: 'column', gap: 12, padding: '8px 4px', maxWidth: 300 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: C.text, textAlign: 'center' }}>You have an open chat</div>
              <div style={{ fontSize: 12.5, color: C.textMid, lineHeight: 1.5, textAlign: 'center' }}>
                You can only have one chat going at a time. Continue your open chat, or close it and start a new one.
              </div>
              {error && <div id={errId} role="alert" style={{ fontSize: 12, color: C.danger, textAlign: 'center' }}>{error}</div>}
              <button
                type="button"
                onClick={() => activeQuestion && openThread(activeQuestion)}
                className="btn-fill"
                style={{ marginTop: 2, padding: '11px', borderRadius: 10, border: 'none', background: C.teal, color: C.bg, fontSize: 13.5, fontWeight: 700, cursor: 'pointer', minHeight: 44 }}
              >
                Continue that chat
              </button>
              <button
                type="button"
                onClick={closeAndStartNew}
                disabled={sending}
                className="btn-pop"
                style={{ padding: '11px', borderRadius: 10, border: `1px solid ${C.border}`, background: 'transparent', color: C.text, fontSize: 13.5, fontWeight: 600, cursor: 'pointer', minHeight: 44, opacity: sending ? 0.6 : 1 }}
              >
                {sending ? 'Closing…' : 'Close it & start a new one'}
              </button>
            </div>
          ) : view === 'form' && activeForm ? (
            // Fills the panel: fields flex to share the space evenly (scroll INSIDE
            // each box, no manual resize), Submit stays pinned at the bottom.
            <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
              {activeForm.fields.map((f) => (
                <div key={f.key} style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
                  <label htmlFor={`${fieldId}-${f.key}`} style={{ flexShrink: 0, display: 'block', fontSize: 12, fontWeight: 600, color: C.text, marginBottom: 5 }}>
                    {f.label}{!f.required && <span style={{ color: C.textMid, fontWeight: 500 }}> (optional)</span>}
                  </label>
                  <textarea
                    id={`${fieldId}-${f.key}`}
                    value={form[f.key] || ''}
                    onChange={(e) => setForm((s) => ({ ...s, [f.key]: e.target.value }))}
                    placeholder={f.placeholder}
                    required={f.required}
                    style={{ flex: 1, minHeight: 44, width: '100%', resize: 'none', overflowY: 'auto', padding: '9px 11px', fontSize: 13.5, lineHeight: 1.5, fontFamily: 'inherit', borderRadius: 10, border: `1px solid ${C.border}`, background: C.surface, color: C.text, boxSizing: 'border-box', outline: 'none' }}
                  />
                </div>
              ))}
              {error && <div id={errId} role="alert" style={{ flexShrink: 0, fontSize: 12, color: C.danger }}>{error}</div>}
              <button
                type="button"
                onClick={submitForm}
                disabled={sending || activeForm.fields.some((f) => f.required && !(form[f.key] || '').trim())}
                className="btn-fill"
                style={{ flexShrink: 0, padding: '12px', borderRadius: 10, border: 'none', background: C.teal, color: C.bg, fontSize: 13.5, fontWeight: 700, cursor: 'pointer', minHeight: 44, opacity: (sending || activeForm.fields.some((f) => f.required && !(form[f.key] || '').trim())) ? 0.5 : 1, transition: 'opacity .15s' }}
              >
                {sending ? 'Submitting…' : activeForm.submitLabel}
              </button>
            </div>
          ) : view === 'ask' ? (
            <div style={{ fontSize: 12.5, color: C.textMid, lineHeight: 1.5 }}>
              Ask us anything below — we usually reply within a day, right here.
            </div>
          ) : (
            messages.map((m) => <Bubble key={m.id} msg={m} />)
          )}
        </div>

        {/* End-chat confirmation — replaces the composer while confirming. */}
        {!loading && view === 'thread' && confirmingEnd && (
          <div style={{ position: 'relative', borderTop: `1px solid ${C.border}`, padding: '12px' }}>
            <div style={{ fontSize: 12.5, color: C.text, lineHeight: 1.5, marginBottom: 10 }}>
              End this chat? You can reopen it for the next 7 days.
            </div>
            {error && <div id={errId} role="alert" style={{ fontSize: 12, color: C.danger, marginBottom: 8 }}>{error}</div>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => { setConfirmingEnd(false); setError(null); }}
                disabled={sending}
                className="btn-pop"
                style={{ padding: '9px 16px', fontSize: 13, fontWeight: 600, borderRadius: 8, border: `1px solid ${C.border}`, background: 'transparent', color: C.text, cursor: 'pointer', minHeight: 40 }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={endChat}
                disabled={sending}
                className="btn-fill"
                style={{ padding: '9px 16px', fontSize: 13, fontWeight: 700, borderRadius: 8, border: 'none', background: C.danger, color: C.bg, cursor: 'pointer', minHeight: 40, opacity: sending ? 0.6 : 1 }}
              >
                {sending ? 'Ending…' : 'End chat'}
              </button>
            </div>
          </div>
        )}

        {/* Composer — chat only: thread replies, or the 'ask' screen (starting the
            one Question). Bug/Idea use the form; hub + confirmations show no composer. */}
        {!loading && !confirmingEnd && (view === 'thread' || view === 'ask') && (
          <div style={{ position: 'relative', borderTop: `1px solid ${C.border}`, padding: '10px 12px 12px' }}>
            {error && (
              <div id={errId} role="alert" style={{ fontSize: 12, color: C.danger, marginBottom: 8 }}>{error}</div>
            )}
            <label htmlFor={fieldId} className="sr-only" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' }}>
              Your message
            </label>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
              <textarea
                id={fieldId}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={onKeyDownField}
                placeholder={view === 'ask' ? 'Type your question…' : 'Reply…'}
                rows={1}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? errId : undefined}
                style={{ flex: 1, resize: 'none', maxHeight: 120, minHeight: 40, padding: '10px 12px', fontSize: 13.5, lineHeight: 1.5, fontFamily: 'inherit', borderRadius: 12, border: `1px solid ${C.border}`, background: C.surface, color: C.text, boxSizing: 'border-box', outline: 'none' }}
              />
              <button
                type="button"
                onClick={send}
                disabled={!draft.trim() || sending}
                aria-label="Send message"
                className="btn-fill"
                style={{ flexShrink: 0, width: 44, height: 44, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 12, border: 'none', background: C.teal, color: C.bg, cursor: draft.trim() && !sending ? 'pointer' : 'default', opacity: draft.trim() && !sending ? 1 : 0.5, transition: 'opacity .15s' }}
              >
                <Icon name="send" size={18} color={C.bg} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  ), document.body);
}
