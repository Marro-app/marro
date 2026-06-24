# Roadmap

Phase order and rationale. Backlog items live in `FUTURE_WORK.md`. Mark items ✓ here the moment they ship. **Company/business/AI vision + monetization + people/legal/infra lives in `STRATEGY.md`** — this file is build phases only.

> **Vision:** grow beyond Cornell to all med students nationally.
> **Sequencing rationale:** 2.5 (UI) moved up from Phase 7 — polish before building more features. 2.5b (Auth) pulled forward from Phase 6 because Phase 3 needs real user profiles; building school-generalization on localStorage then migrating would be risky for existing users.

## Phase 1 ✓ — Core app
## Phase 2 ✓ — Savings & Charts (June 2026)
Projected graduation balance, recommendations, comparison mode, Step 3 goal + migration, pie chart month/range picker, CSV import (auto-detect columns, keyword categorization, review + bulk import).

## Phase 2.5 — Marro UI overhaul ✓ COMPLETE (June 11, 2026)
- ✓ Steps 1–3: palette/fonts/rename, growth-rings logo, glass cards site-wide + full UI audit
- ✓ Step 4 — Theme-ready tokens, neg/danger split, 3-tier glass, radius scale
- ✓ Step 5 — Neutral near-black dark theme; colorblind-safe blue/amber data pair
- ✓ Step 6 — Light theme + working toggle (prefers-color-scheme default, FOUC guard, sync-aware)
- ✓ Step 7 — Ring-derived custom icon system (categories + UI chrome)
- ✓ Step 8 — Identity embedding: rings app icon/favicon/manifest, ring loading screen, ring sync states, RingProgress goals, ring EmptyState
- ✓ Step 9 — De-Cornell visible copy + manifest (YEAR_CONFIGS data kept)
- ✓ Step 10 — Modal a11y (focus trap/Esc/aria), self-hosted fonts (offline-safe), mobile table edge fade, Step-fund chip states
- ✓ Step 11 — Blob health states (calm/low-tide/marigold bloom), docs rewritten
- Deferred from this phase → FUTURE_WORK: tab-pill redesign + cross-fades, chart gradient/draw-on animations, number-roll, apple-touch-icon PNG

## Phase 2.5b — Auth + Supabase ✓ COMPLETE & DEPLOYED (June 13, 2026 — live at commit 8df8837)
- ✓ Google login via Supabase Auth; hard login gate (no anonymous mode), LoginScreen
- ✓ Supabase `app_state` table (one jsonb blob/user, RLS) replaces Gist as the sync transport; localStorage kept as offline cache + merge ancestor; 3-way merge engine reused unchanged (gistFetch/gistWrite → stateFetch/stateWrite); `api/sync.js` deleted
- ✓ First-login migration: uploads local state to Supabase if server row empty; `wcm_uid` shared-device guard
- ✓ `profiles` table + one-time ProfileModal: searchable picker over full Wikipedia-sourced US MD (LCME) + DO (COCA) lists (`US_MED_SCHOOLS`); multi-campus schools (LECOM, VCOM, PCOM, RVU, Indiana, Illinois, MSU, etc.) prompt a campus step, stored as "Name — Campus"; free-text Other; school shown in settings with a "Change" action that reopens the picker (editable/cancelable)
- Deferred to pre-public-launch (see FUTURE_WORK): custom auth domain + Google verification (consent screen currently shows raw Supabase domain + unverified warning; Testing mode capped at 100 users); remove unused `GIST_TOKEN` Vercel env var after a prod deploy.

## Phase 3 — School-agnostic generalization (in progress)
First-run onboarding wizard, user-defined year configs, remove WCM hardcoding, variable program lengths. Required before any non-WCM users.
- ✓ **De-WCM the data layer (June 14):** retired hardcoded `YEAR_CONFIGS`/`DEFAULT_MONTHLY`; added `generateYearConfigs(startYear,len,extended)` (tier-1 heuristic date provider — swappable seam for future calendar-fetch) + `BLANK_MONTHLY`/`blankYearFields()`. All financial fields default to 0 for **every** school (no special-casing). Renamed `wcmLivingAllowance`→`livingAllowance` (migrated on load). Boot migration no longer injects any school's numbers; `addYear` inherits the user's own prior year, not WCM defaults. Removed the hardcoded WCM cost-of-attendance reference table from the Aid tab.
- ✓ **Onboarding program step (June 14):** new step 4 "How long is your program?" (3/4/5/6 yrs + extended-year toggle) generates the year configs on finish. First-run only — redo-setup never regenerates (would wipe data).
- ✓ **Program model rework (June 15):** removed the "extended year" special-case (years are now plain numbered; legacy extended years migrate to numbered, data preserved). Added dual-degree support — step 4 "Your program" asks track (`MD/DO only` · `-PhD` · `+ Master's` · `Other`) with optional PhD/Master's field + granting institution; length widened to 3–8 yrs. Degree (MD/DO) derived from school name; DO duals gated by curated `DO_DUAL` map (free-text fallback). Stored in `data.program`; editable in **Settings → Program** (`ProgramModal`). See PRODUCT_DECISIONS 2026-06-15.
- ✓ **Progressive setup (June 14):** `SETUP_VERSION` + `SETUP_STEPS` registry + `ProgressiveSetup` popup. New users answer everything inline; existing users behind on a newly-added question get a focused glass popup for just that step. v1 grandfathers existing users (registry currently empty — infra ready for v2+ questions like term-date confirmation / aid-letter upload).
- Untested live (auth-gated, needs Google smoke test): new-user onboarding finish (years generation + Supabase profile save). MD/DO-from-school-name derivation deferred (no consumer until Phase 4) — see FUTURE_WORK.

## Phase 3.5 — Foundation (DECIDED: migrate before AI) — NOT STARTED
Reinforce the lightweight single-file foundation *before* the multi-surface AI work lands on it. See `STRATEGY.md` §2.
- **Build-system migration** — single `index.html` → Vite + components, incrementally (get existing file building first, then split out). Its own phase, nothing riding on it; prove the app behaves identically after.
- **Service-worker / cache fix** — version + force-update (auto-refresh at a safe moment, never mid-edit); fingerprinting makes it near-free during the migration.
- **Test harness + error monitoring** (Sentry) — prioritize sync/merge engine, money math, AI guardrails.
- **Minimal admin/observability dashboard (EARLY)** — errors, AI calls, costs, engagement. Start minimal; later becomes the webhook aggregator.
- **Company account hygiene** (can run in parallel, mostly non-engineering) — Marro-owned GitHub org / Vercel team / Supabase / domain / business email; Bitwarden shared vault; `.env.example`. See `STRATEGY.md` §6.

## Phase 4 — Claude AI financial advisor — NOT STARTED
Trigger-based (not a chatbot): passive monitoring, anomaly alerts, weekly digest, receipt scanning, goal-aware nudges. No autonomous writes. **Full capability menu + hard guardrails + cost controls + monetization tie-in: see `STRATEGY.md` §1–2, §4.** Cost strategy also in memory (`project_wcm_ai_cost.md`). Sub-phased:
- **4a — Backend seed + first feature:** Vercel AI proxy (holds key, model routing) + soft usage pool + BYOK; ship **anomaly-check + good-habit** end-to-end with the "Suggested" UI (CLAUDE.md rule 9); **retire the hard-coded suggestions it replaces**. Validates cost/UX/usage machinery on the smallest surface. → friends' hands.
- **4b — Data-quality & trust layer:** easier entry (voice/receipt), proactive check-ins, lite-APY savings projections, off-switch + voice guide + communication budget. Makes downstream features *work* (smart suggestions need real data).
- **4c — Backend-heavy intelligence:** scheduler-driven digests + disbursement-gap warnings, web-search local pricing/calendars/scholarships, forecasting, true-cost reframing (opt-in).
- **Still-open product decisions (defer to 4a start):** usage-pool size + reset period; BYOK transport (proxy vs client-direct); anomaly sensitivity; card placement (Budget vs Weekly).

## Phase 5 — Student loans tab
Loan entry by type, repayment simulator (Standard/IBR/PAYE/SAVE/Extended), PSLF modeling, residency projections. **Research before implementing — do not build from memory.**

## Phase 5b — Interview season budget
Cost planner by type (flights/hotels/clothes), specialty-aware estimates, integrates with main budget.

## Phase 5c — Specialty-specific financial outlook
Specialty pick → residency pay, fellowship likelihood, attending salary range, repayment trajectory, PSLF viability.

## Phase 6 — Multi-user backend & school benchmarking
School benchmarking (10+ users/school min), opt-in anonymized sharing, peer tips. Feeds Phase 4 quality. Also: cohort/group-buying (needs per-school density), bank-linking via **Plaid**, monetization (referrals + licensed financial-product partner). **Anonymized-data must be consent-first / true-aggregation / separate aggregate layer — see `STRATEGY.md` §6.** Each item = a real go/no-go.

## Phase 7 — Mobile & polish
Installable offline PWA, push notifications, PDF/CSV export, year-end summary, session timeout. **Native via Capacitor wrapper** (one codebase → App/Play Store + reliable push + Siri/voice path) + Jarvis voice control — see `STRATEGY.md` §3. (Deferred: terrarium mascot world — needs art pipeline.)

## Backlog
Residency transition planner, referral program, tax-relevant expense flagging.
