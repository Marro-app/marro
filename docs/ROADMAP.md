# Roadmap

Phase order and rationale. Backlog items live in `FUTURE_WORK.md`. Mark items ✓ here the moment they ship.

> **Vision:** grow beyond Cornell to all med students nationally.
> **Sequencing rationale:** 2.5 (UI) moved up from Phase 7 — polish before building more features. 2.5b (Auth) pulled forward from Phase 6 because Phase 3 needs real user profiles; building school-generalization on localStorage then migrating would be risky for existing users.

## Phase 1 ✓ — Core app
## Phase 2 ✓ — Savings & Charts (June 2026)
Projected graduation balance, recommendations, comparison mode, Step 3 goal + migration, pie chart month/range picker, CSV import (auto-detect columns, keyword categorization, review + bulk import).

## Phase 2.5 — Marro UI overhaul — IN PROGRESS
- ✓ Step 1 — Foundation: palette, Inter+Newsreader, dark base, rename to Marro
- ✓ Step 2 — Logo + header: growth rings SVG, ping-pong animation
- ✓ Step 3 (+3b/3c/3d) — Glass cards site-wide, semantic color fix, legacy controls removed
- ✓ Full UI/UX audit (June 11 2026 — see `UI_AUDIT_LOG.md`)
- **→ Step 4 — Typography pass**: Newsreader on all numbers, Inter weights on labels, number roll animation
- Step 5 — Tab bar: floating glass pill, active cream pill, cross-fade transitions
- Step 6 — Charts overhaul: Marro palette, glass tooltips, gradient fills, draw-on animation
- Step 7 — Lava lamp background: 4 animated blobs, calm state
- Step 8 — Budget health wiring: blob states tied to real data (calm/low-tide/milestone)
- Step 9 — Animation pass + polish: remove dark-mode toggle, micro-interactions, timing

## Phase 2.5b — Auth + Supabase (NEXT after 2.5)
Google login via Supabase Auth; Supabase DB replaces localStorage + Gist sync; per-user isolated data; school as required signup field (feeds Phase 3); clean migration of existing WCM data on first login. Required before onboarding any non-WCM testers.

## Phase 3 — School-agnostic generalization
First-run onboarding wizard, user-defined year configs, remove WCM hardcoding, variable program lengths. Required before any non-WCM users.

## Phase 4 — Claude AI financial advisor
Trigger-based (not a chatbot): passive monitoring, anomaly alerts, weekly digest, receipt scanning, goal-aware nudges. No autonomous writes. Cost strategy lives in memory (`project_wcm_ai_cost.md`).

## Phase 5 — Student loans tab
Loan entry by type, repayment simulator (Standard/IBR/PAYE/SAVE/Extended), PSLF modeling, residency projections. **Research before implementing — do not build from memory.**

## Phase 5b — Interview season budget
Cost planner by type (flights/hotels/clothes), specialty-aware estimates, integrates with main budget.

## Phase 5c — Specialty-specific financial outlook
Specialty pick → residency pay, fellowship likelihood, attending salary range, repayment trajectory, PSLF viability.

## Phase 6 — Multi-user backend & school benchmarking
School benchmarking (10+ users/school min), opt-in anonymized sharing, peer tips. Feeds Phase 4 quality.

## Phase 7 — Mobile & polish
Installable offline PWA, push notifications, PDF/CSV export, year-end summary, session timeout. (Deferred: terrarium mascot world — needs art pipeline.)

## Backlog
Residency transition planner, referral program, tax-relevant expense flagging.
