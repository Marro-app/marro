import React, { useState, useEffect, useRef, useCallback, Suspense } from 'react';
import { C } from '../../lib/theme.js';
import { Icon } from '../icons.jsx';
import { fetchConversations, totalUnread } from '../../lib/support.js';

// The panel is heavy-ish (transcript, composer, motif) and only needed once a
// user actually opens support — lazy-load it so it stays out of the initial
// bundle for everyone else.
const SupportPanel = React.lazy(() => import('./SupportPanel.jsx'));

// Floating support entry point for signed-in users. Sits above the (mobile)
// tab bar, bottom-right. Owns the open/closed state + the unread badge, and
// restores focus to itself when the panel closes (the panel calls onClose).
export default function SupportLauncher() {
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const btnRef = useRef(null);

  const refreshUnread = useCallback(() => {
    fetchConversations()
      .then((c) => setUnread(totalUnread(c)))
      .catch(() => {}); // badge is best-effort — a failed fetch just hides it
  }, []);

  // Prime the badge on mount; refresh whenever the panel closes (reading a
  // thread zeroes its unread count server-side).
  useEffect(() => { refreshUnread(); }, [refreshUnread]);

  const close = useCallback(() => {
    setOpen(false);
    refreshUnread();
    // Focus is restored by the panel's own cleanup (prevFocus), but re-assert
    // here in case the panel unmounts without running it.
    requestAnimationFrame(() => btnRef.current?.focus());
  }, [refreshUnread]);

  const label = unread > 0
    ? `Support and feedback, ${unread} unread ${unread === 1 ? 'reply' : 'replies'}`
    : 'Support and feedback';

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Support & feedback"
        style={{
          position: 'fixed', right: 20, bottom: 20, zIndex: 900,
          width: 52, height: 52, borderRadius: 26,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          background: C.tabActiveBg, color: C.ink, border: 'none', cursor: 'pointer',
          boxShadow: '0 6px 20px rgba(0,0,0,0.28)',
        }}
        className="sup-launch"
      >
        <style>{`
          .sup-launch { transition: transform .15s cubic-bezier(0.23,1,0.32,1); }
          @media (hover: hover) and (pointer: fine) { .sup-launch:hover { transform: translateY(-2px); } }
          @media (prefers-reduced-motion: reduce) { .sup-launch { transition: none; } .sup-launch:hover { transform: none; } }
        `}</style>
        <Icon name="chat" size={24} color={C.ink} strokeWidth={1.6} />
        {unread > 0 && (
          <span
            aria-hidden="true"
            style={{
              position: 'absolute', top: -2, right: -2, minWidth: 20, height: 20, padding: '0 5px',
              // C.bg (not white) as the numeral color — white on the soft-clay
              // danger token fails 4.5:1; near-bg-on-fill clears it in both
              // themes, matching the app's primary-button convention (rule 7).
              borderRadius: 10, background: C.danger, color: C.bg, fontSize: 11, fontWeight: 700,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              border: `2px solid ${C.bg}`, boxSizing: 'border-box',
            }}
          >
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
      {open && (
        <Suspense fallback={null}>
          <SupportPanel onClose={close} />
        </Suspense>
      )}
    </>
  );
}
