// Phase 1 simplification pass (2026-07): hide these tabs from the tabbar, never
// delete — code + data stay untouched. Revive a tab later by flipping its flag.
export const HIDDEN_TABS = { weekly: true, charts: true, savings: true, subscriptions: true, customize: true };
