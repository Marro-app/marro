import React, { useState, useEffect, useRef, useCallback, useId } from 'react';
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
//   bug  → faint drifting specks     idea → soft floating glows
//   question/other → clean surface (no motif)
// All motion is transform/opacity only and FREEZES under prefers-reduced-motion
// (see the media query in the <style> below). Opacities are low enough that the
// glass surface + text above never drop below 4.5:1 in either theme — the motif
// sits behind an opaque-ish panel body, purely ambient.
function CategoryBackdrop({ motif }) {
  if (motif === 'bug') {
    return (
      <div className="sup-bg" aria-hidden="true">
        <span className="sup-speck" style={{ top: '18%', left: '22%' }} />
        <span className="sup-speck" style={{ top: '46%', left: '68%', animationDelay: '-3s' }} />
        <span className="sup-speck" style={{ top: '72%', left: '38%', animationDelay: '-6s' }} />
        <span className="sup-speck" style={{ top: '30%', left: '82%', animationDelay: '-9s' }} />
        <span className="sup-speck" style={{ top: '84%', left: '76%', animationDelay: '-4.5s' }} />
      </div>
    );
  }
  if (motif === 'idea') {
    return (
      <div className="sup-bg" aria-hidden="true">
        <span className="sup-glow" style={{ top: '-8%', left: '-6%' }} />
        <span className="sup-glow" style={{ bottom: '-10%', right: '-8%', animationDelay: '-7s' }} />
      </div>
    );
  }
  return null;
}

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
  const [view, setView] = useState('thread');     // 'thread' | 'new'
  const [category, setCategory] = useState('question');
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);

  const motif = view === 'new' ? categoryForType(category).type
    : (convo ? convo.type : 'question');
  const motifKind = categoryForType(motif).motif;

  // Load the user's most recent thread on open. No thread → start in "new" view.
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
          setView('thread');
          if (latest.unread_user > 0) markRead(latest.id).catch(() => {});
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
        const type = categoryForType(category).type;
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

  const onKeyDownField = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  };

  const startNewTopic = () => { setView('new'); setConvo(null); setMessages([]); setDraft(''); setError(null); };

  const cat = categoryForType(convo ? convo.type : category);

  return createPortal((
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: C.scrim, display: 'flex', alignItems: 'flex-end', justifyContent: 'flex-end', padding: 16, boxSizing: 'border-box' }}
    >
      <style>{`
        @keyframes supSheetIn { from { opacity: 0; transform: translateY(16px) scale(0.98); } to { opacity: 1; transform: none; } }
        @keyframes supSpeck { 0% { transform: translateY(0); opacity: 0; } 20%,80% { opacity: 0.5; } 100% { transform: translateY(-40px); opacity: 0; } }
        @keyframes supGlow { 0%,100% { transform: translate(0,0); } 50% { transform: translate(14px,-12px); } }
        .sup-sheet { animation: supSheetIn 260ms cubic-bezier(0.23,1,0.32,1) both; }
        .sup-bg { position: absolute; inset: 0; overflow: hidden; pointer-events: none; border-radius: inherit; }
        .sup-speck { position: absolute; width: 4px; height: 4px; border-radius: 99px; background: ${C.textMid}; opacity: 0.3; animation: supSpeck 12s linear infinite; }
        .sup-glow { position: absolute; width: 200px; height: 200px; border-radius: 99px; background: radial-gradient(circle, ${C.amberMid} 0%, transparent 70%); opacity: 0.5; filter: blur(8px); animation: supGlow 16s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) {
          .sup-sheet { animation: none; }
          .sup-speck, .sup-glow { animation: none; }
          .sup-speck { opacity: 0.18; }
          .sup-glow { opacity: 0.28; }
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
              {view === 'new' ? 'We usually reply within a day' : `${cat.emoji} ${cat.label}`}
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
          ) : view === 'new' ? (
            <>
              <div style={{ fontSize: 13, color: C.textMid, lineHeight: 1.5 }}>
                What can we help with? Pick one, then tell us what&apos;s on your mind.
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
                      onClick={() => setCategory(c.key)}
                      style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '12px 6px', borderRadius: 12, cursor: 'pointer', minHeight: 44, background: on ? C.selBg : 'transparent', border: `1px solid ${on ? C.sel : C.border}`, color: C.text, transition: 'background .15s, border-color .15s' }}
                    >
                      <span aria-hidden="true" style={{ fontSize: 20, lineHeight: 1 }}>{c.emoji}</span>
                      <span style={{ fontSize: 12.5, fontWeight: on ? 700 : 600 }}>{c.label}</span>
                      <span style={{ fontSize: 10.5, color: C.textMid }}>{c.blurb}</span>
                    </button>
                  );
                })}
              </div>
            </>
          ) : (
            messages.map((m) => <Bubble key={m.id} msg={m} />)
          )}
        </div>

        {/* Composer */}
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
              placeholder={view === 'new' ? 'Type your message…' : 'Reply…'}
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
      </div>
    </div>
  ), document.body);
}
