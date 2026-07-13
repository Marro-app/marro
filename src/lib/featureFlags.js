// Phase 1 simplification pass (2026-07): hide these tabs from the tabbar, never
// delete — code + data stay untouched. Revive a tab later by flipping its flag.
export const HIDDEN_TABS = { weekly: true, charts: true, savings: true, subscriptions: true, customize: true };

// Runway & Debt header tiles are live (Phase 2 commit 7, 2026-07-13) — real
// loans/balance-reading data backs both now. Flip back to false to instantly
// revert to the "—, coming in Phase 2" placeholders if anything looks wrong.
export const SHOW_PHASE2_TILES = true;
