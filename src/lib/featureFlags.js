// Phase 1 simplification pass (2026-07): hide these tabs from the tabbar, never
// delete — code + data stay untouched. Revive a tab later by flipping its flag.
export const HIDDEN_TABS = { weekly: true, charts: true, savings: true, subscriptions: true, customize: true };

// Runway & Debt header tiles are placeholders ("—", "coming in Phase 2") until
// Phase 2's loan model lands. Hidden pre-launch (2026-07 audit fix A3), never
// deleted — flip to true to bring them back once real data backs them.
export const SHOW_PHASE2_TILES = false;
