import React from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';

// ── PWA silent auto-update ─────────────────────────────────────────────────────
// vite-plugin-pwa precaches the fingerprinted build; when a new deploy is detected
// the service worker installs and *waits*. We never interrupt the user to apply it.
// Instead we swap to the new version silently, only at a provably safe moment:
//   • the tab is backgrounded (visibilityState === "hidden" → the user isn't looking), AND
//   • nothing is mid-flow — no open modal (role="dialog") and no focused text field.
// If that moment never arrives, the waiting worker still activates on its own the
// next time the app is fully closed and reopened. So the update always lands
// eventually, but can never reload the page out from under an in-progress action.
//
// Lives in its own tiny module (not App.jsx) so main.jsx can render it without
// pulling in App.jsx's full module graph — a logged-out landing-only load still
// needs SilentUpdater (for the SW update flow) but must not eval the whole app.
export function SilentUpdater(){
  const { needRefresh:[needRefresh], updateServiceWorker } = useRegisterSW({
    onRegisterError(err){ console.error('SW registration error', err); },
  });
  React.useEffect(() => {
    if(!needRefresh) return;
    const safeToReload = () => {
      if(document.visibilityState !== 'hidden') return false;      // user is watching
      if(document.querySelector('[role="dialog"]')) return false;  // a modal is open
      const ae = document.activeElement;                           // an inline edit is focused
      if(ae && ae.matches && ae.matches('input,textarea,[contenteditable="true"]')) return false;
      return true;
    };
    const attempt = () => { if(safeToReload()) updateServiceWorker(true); };
    document.addEventListener('visibilitychange', attempt);
    attempt(); // already backgrounded when the update landed? apply now.
    return () => document.removeEventListener('visibilitychange', attempt);
  }, [needRefresh, updateServiceWorker]);
  return null;
}
