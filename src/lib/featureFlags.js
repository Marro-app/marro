// Phase 1 simplification pass (2026-07): hide these tabs from the tabbar, never
// delete — code + data stay untouched. Revive a tab later by flipping its flag.
export const HIDDEN_TABS = { weekly: true, charts: true, savings: true, subscriptions: true, customize: true };

// Runway & Debt header tiles are live (Phase 2 commit 7, 2026-07-13) — real
// loans/balance-reading data backs both now. Flip back to false to instantly
// revert to the "—, coming in Phase 2" placeholders if anything looks wrong.
export const SHOW_PHASE2_TILES = true;

// Dry-spell / gap FORECAST surfaces — the "Heads up, spending gets tight
// around X" banner, the matching "$0, overdrawn" banner, and the Budget tab's
// month-picker "lean month" dot. Founder call (2026-08-02): the projection
// this drives from felt unrealistic, so all three are suspended together —
// code + data stay untouched, flip back to true to bring them back. Does NOT
// affect the "Compared to your plan" header tile, which uses a different,
// actual-check-in-pace calculation, not this forecast.
export const SHOW_GAP_FORECAST = false;
