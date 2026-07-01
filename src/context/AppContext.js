import { createContext, useContext } from 'react';

// Shared app surface for the tab panels. App.jsx builds the value object once per
// render (from the same locals it always computed) and provides it here; each tab
// reads what it needs via useApp() instead of receiving a long prop list.
//
// What lives here vs. in a tab:
//   • Here (shared): data/upd/save, the academic-year + month selection, the derived
//     financial memos the header and multiple tabs read, and mutation helpers that
//     don't close over any single tab's private form state.
//   • In a tab: that tab's private form/UI useState (and the helpers/modals that
//     close over it) — moved into the tab component so it's self-contained.
export const AppContext = createContext(null);

export function useApp(){
  const ctx = useContext(AppContext);
  if(ctx===null) throw new Error('useApp must be used within <AppContext.Provider>');
  return ctx;
}
