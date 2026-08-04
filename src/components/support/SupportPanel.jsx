import React, { useState, useEffect, useRef, useCallback, useId, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { C } from '../../lib/theme.js';
import { XBtn } from '../primitives.jsx';
import { Icon } from '../icons.jsx';
import {
  SUPPORT_CATEGORIES, categoryForType, fetchConversations, fetchMessages,
  startConversation, postMessage, markRead,
} from '../../lib/support.js';

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

// The panel opens straight into a thread only when a reply is WAITING (unread) —
// for any type, so a reply is never missed. Otherwise it opens to the category
// picker. Separately, a recent, still-open *Question* is offered as a "resume"
// link (for up to a week): bugs/ideas are one-and-done submissions so they never
// get a resume link, and questions that are resolved or have gone quiet for a
// week drop off rather than lingering there forever.
const ACTIVE_STATUSES = new Set(['new', 'open', 'waiting_user']);
const RESUMABLE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
function hasUnreadReply(convo) {
  return !!convo && convo.unread_user > 0;
}
function isResumableQuestion(convo) {
  return !!convo
    && convo.type === 'question'
    && ACTIVE_STATUSES.has(convo.status)
    && (Date.now() - new Date(convo.last_message_at).getTime()) < RESUMABLE_WINDOW_MS;
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
  const [convo, setConvo] = useState(null);       // the active conversation row (or null → "new")
  const [messages, setMessages] = useState([]);
  const [view, setView] = useState('thread');     // 'thread' | 'new' | 'sent'
  const [category, setCategory] = useState('question');
  const [draft, setDraft] = useState('');
  const [form, setForm] = useState({});            // bug/idea form field values
  const [sentKind, setSentKind] = useState(null);  // 'bug report' | 'idea' — for the confirmation
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);

  // In "new" view, whether the picked category is a form (bug/idea) or the chat
  // (question). Drives which composer the footer/body shows.
  const activeForm = view === 'new' ? SUPPORT_FORMS[category] : null;

  // The active category drives both the header label and the background motif.
  // In "new" view it's the picked KEY (question/bug/idea); in a thread it's
  // resolved from the stored conversation TYPE (question/bug/feedback/…).
  const activeCat = view === 'new'
    ? (SUPPORT_CATEGORIES.find((c) => c.key === category) || SUPPORT_CATEGORIES[0])
    : categoryForType(convo ? convo.type : 'question');
  const motifKind = activeCat.motif;

  // On open, load the latest thread (so "resume" is instant) but only land IN it
  // when a reply is waiting — otherwise open to the category picker.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const convos = await fetchConversations();
        if (!alive) return;
        const latest = convos[0] || null;
        if (latest) {
          const msgs = await fetchMessages(latest.id);
          if (!alive) return;
          setConvo(latest);
          setMessages(msgs);
          const unread = hasUnreadReply(latest);
          setView(unread ? 'thread' : 'new');
          if (unread) markRead(latest.id).catch(() => {});
        } else {
          setView('new');
        }
      } catch {
        if (alive) setView('new'); // fail soft — let them still start a thread
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

  const send = useCallback(async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true); setError(null);
    try {
      if (view === 'new') {
        const type = (SUPPORT_CATEGORIES.find((c) => c.key === category) || SUPPORT_CATEGORIES[0]).type;
        const id = await startConversation({ type, body });
        const [convos, msgs] = await Promise.all([fetchConversations(), fetchMessages(id)]);
        setConvo(convos.find((c) => c.id === id) || null);
        setMessages(msgs);
        setView('thread');
      } else {
        await postMessage({ conversationId: convo.id, body });
        setMessages(await fetchMessages(convo.id));
      }
      setDraft('');
    } catch {
      setError("Couldn't send your message. Please try again.");
    } finally {
      setSending(false);
    }
  }, [draft, sending, view, category, convo]);

  // Submit the bug/idea form → creates a conversation from the composed fields,
  // then shows a confirmation (not the chat). A later admin reply surfaces the
  // thread via the mid-conversation / resume path.
  const submitForm = useCallback(async () => {
    if (sending || !activeForm) return;
    const missing = activeForm.fields.some((f) => f.required && !(form[f.key] || '').trim());
    if (missing) { setError('Please fill in the required field.'); return; }
    setSending(true); setError(null);
    try {
      const cat = SUPPORT_CATEGORIES.find((c) => c.key === category) || SUPPORT_CATEGORIES[0];
      const body = activeForm.compose(form);
      const id = await startConversation({ type: cat.type, body });
      const convos = await fetchConversations();
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
  }, [sending, activeForm, form, category]);

  const pickCategory = (key) => { setCategory(key); setForm({}); setError(null); };

  const onKeyDownField = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  };

  const startNewTopic = () => { setView('new'); setCategory('question'); setForm({}); setDraft(''); setError(null); };

  // Jump back into the loaded thread from the picker (marks any waiting reply read).
  const resumeThread = useCallback(() => {
    if (!convo) return;
    setView('thread');
    setError(null);
    if (convo.unread_user > 0) markRead(convo.id).catch(() => {});
  }, [convo]);


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
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 10, padding: '14px 14px 12px', borderBottom: `1px solid ${C.border}` }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>Support &amp; feedback</div>
            <div style={{ fontSize: 11.5, color: C.textMid, marginTop: 1 }}>
              {view === 'new' ? 'We usually reply within a day' : `${activeCat.emoji} ${activeCat.label}`}
            </div>
          </div>
          {view === 'thread' && convo && (
            <button
              type="button"
              onClick={startNewTopic}
              className="btn-pop"
              style={{ fontSize: 12, fontWeight: 600, color: C.text, background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 8, padding: '6px 10px', cursor: 'pointer', minHeight: 34 }}
            >
              New topic
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
              <button type="button" onClick={onClose} className="btn-fill" style={{ marginTop: 4, padding: '10px 22px', borderRadius: 10, border: 'none', background: C.teal, color: C.bg, fontSize: 13, fontWeight: 700, cursor: 'pointer', minHeight: 44 }}>
                Done
              </button>
            </div>
          ) : view === 'new' ? (
            <>
              <div style={{ fontSize: 13, color: C.textMid, lineHeight: 1.5 }}>
                What can we help with?
              </div>
              <div role="radiogroup" aria-label="What's this about?" style={{ display: 'flex', gap: 8 }}>
                {SUPPORT_CATEGORIES.map((c) => {
                  const on = category === c.key;
                  return (
                    <button
                      key={c.key}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      onClick={() => pickCategory(c.key)}
                      style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '12px 6px', borderRadius: 12, cursor: 'pointer', minHeight: 44, background: on ? C.selBg : 'transparent', border: `1px solid ${on ? C.sel : C.border}`, color: C.text, transition: 'background .15s, border-color .15s' }}
                    >
                      <span aria-hidden="true" style={{ fontSize: 20, lineHeight: 1 }}>{c.emoji}</span>
                      <span style={{ fontSize: 12.5, fontWeight: on ? 700 : 600 }}>{c.label}</span>
                      <span style={{ fontSize: 10.5, color: C.textMid }}>{c.blurb}</span>
                    </button>
                  );
                })}
              </div>
              {activeForm ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 2 }}>
                  {activeForm.fields.map((f) => (
                    <div key={f.key}>
                      <label htmlFor={`${fieldId}-${f.key}`} style={{ display: 'block', fontSize: 12, fontWeight: 600, color: C.text, marginBottom: 5 }}>
                        {f.label}{!f.required && <span style={{ color: C.textMid, fontWeight: 500 }}> (optional)</span>}
                      </label>
                      <textarea
                        id={`${fieldId}-${f.key}`}
                        value={form[f.key] || ''}
                        onChange={(e) => setForm((s) => ({ ...s, [f.key]: e.target.value }))}
                        placeholder={f.placeholder}
                        rows={f.rows}
                        required={f.required}
                        style={{ width: '100%', resize: 'vertical', minHeight: f.rows * 24, padding: '9px 11px', fontSize: 13.5, lineHeight: 1.5, fontFamily: 'inherit', borderRadius: 10, border: `1px solid ${C.border}`, background: C.surface, color: C.text, boxSizing: 'border-box', outline: 'none' }}
                      />
                    </div>
                  ))}
                  {error && <div id={errId} role="alert" style={{ fontSize: 12, color: C.danger }}>{error}</div>}
                  <button
                    type="button"
                    onClick={submitForm}
                    disabled={sending || activeForm.fields.some((f) => f.required && !(form[f.key] || '').trim())}
                    className="btn-fill"
                    style={{ padding: '12px', borderRadius: 10, border: 'none', background: C.teal, color: C.bg, fontSize: 13.5, fontWeight: 700, cursor: 'pointer', minHeight: 44, opacity: (sending || activeForm.fields.some((f) => f.required && !(form[f.key] || '').trim())) ? 0.5 : 1, transition: 'opacity .15s' }}
                  >
                    {sending ? 'Submitting…' : activeForm.submitLabel}
                  </button>
                </div>
              ) : (
                <div style={{ fontSize: 12.5, color: C.textMid, lineHeight: 1.5 }}>
                  Ask us anything below — we&apos;ll reply right here.
                </div>
              )}
              {isResumableQuestion(convo) && (
                <button
                  type="button"
                  onClick={resumeThread}
                  aria-label={`Back to your conversation${convo.unread_user > 0 ? `, ${convo.unread_user} unread ${convo.unread_user === 1 ? 'reply' : 'replies'}` : ''}`}
                  style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left', padding: '11px 12px', borderRadius: 12, cursor: 'pointer', background: C.surface, border: `1px solid ${C.border}`, color: C.text, minHeight: 44 }}
                >
                  <span aria-hidden="true" style={{ fontSize: 17, lineHeight: 1 }}>{categoryForType(convo.type).emoji}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600 }}>Back to your conversation</span>
                    <span style={{ display: 'block', fontSize: 11, color: C.textMid, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{convo.subject || categoryForType(convo.type).label}</span>
                  </span>
                  {convo.unread_user > 0 && (
                    <span aria-hidden="true" style={{ flexShrink: 0, minWidth: 18, height: 18, padding: '0 5px', borderRadius: 9, background: C.danger, color: C.bg, fontSize: 10.5, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{convo.unread_user > 9 ? '9+' : convo.unread_user}</span>
                  )}
                  <Icon name="chevron" size={12} color={C.textMid} style={{ transform: 'rotate(-90deg)', flexShrink: 0 }} />
                </button>
              )}
            </>
          ) : (
            messages.map((m) => <Bubble key={m.id} msg={m} />)
          )}
        </div>

        {/* Composer — chat only (thread replies + starting a Question). Bug/Idea
            use the in-body form and 'sent' shows a confirmation, so no composer. */}
        {!loading && (view === 'thread' || (view === 'new' && !activeForm)) && (
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
                placeholder={view === 'new' ? 'Type your question…' : 'Reply…'}
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
