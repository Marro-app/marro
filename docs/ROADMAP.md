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
- **Smoke-test status (2026-06-28):** **profile-save → Supabase verified LIVE** (earlier session). **Year generation NOW verified LIVE (2026-06-28)** — ran the approved fresh-run on the owner's own account (`jawadhijazi7@gmail.com`) via Chrome console against the deployed new code: backed up `app_state`+`profiles`+local cache to a `FRESHRUN_BACKUP` localStorage key (round-trip verified), forced first-run (RLS denies `DELETE` on `app_state`, and a stripped `{setupVersion:null}` row CRASHES boot because the load-migration never backfills `categories` — so the working clear was **upsert the real state with `setupVersion` forced to null + `profiles.school=null` + clear local cache**), drove onboarding with a deliberately off-default **start year 2024 / length 5**, and confirmed Supabase received exactly `generateYearConfigs(2024,5)` (`Year 1 — 2024-25` @ `2024-08-01` … `Year 5 — 2028-29`, byte-exact match) — proving the new start-year picker feeds generation live. Then restored from backup **byte-identical** (`stateByteIdentical:true`, school + 1-year data back, dashboard renders "Welcome back, Mo") and removed the backup key. **Latent robustness note found during the test:** the boot load-migration backfills years/program/etc. but NOT `categories`, so any `app_state` row missing `categories` crashes render (`Cannot read properties of undefined (reading 'forEach')`). A real user can't hit this via normal flow (new users seed full `DEFAULT_STATE`), but a one-line defensive `if(!loaded.categories) loaded.categories = DEFAULT_CATS` would harden it — logged for separate cleanup.
- ✓ **Phase 3 polish (build-now, agreed 2026-06-28 — small, low-risk, on the current single-file app before the Vite migration) — BUILT + verified-local 2026-06-28, NOT yet deployed:** (1) ✓ MD-PhD suggested length **8 → 7** (`suggestLen`); (2) ✓ **year-count → stepper** — new reusable `Stepper` component (− / editable spinbutton / +, range 1–8, HIG idiom, 44px hit targets, roving-free `role=group`) replaced the `3–8` button row; (3) ✓ **"When did you start? → Fall [year]" stepper** (default current fall, range thisYear−10…+1) now feeds `generateYearConfigs(startYear,len)` — wired the picked year (was hardcoded `new Date().getFullYear()`); (4) ✓ **removed the dead `!firstRun` redo copy** in the program step (now a single first-run helper line "Your years run from Fall X to Y"); (5) ✓ **Aid-year delete → soft delete** — `removeYear` archives the year to `data.archivedYears` (deduped by `startDate`); restore paths: an immediate **Undo toast** (`role=status`), a **"Reinstate a removed year"** list in the Add-year modal, and **date-match auto-restore** when Add-year's start year equals an archived one. Round-trip is byte-identical (10/10 logic assertions pass). Remove-year modal copy de-"permanent"-ed. **Audit done:** the only date-driven current-year consumers (boot active-year auto-select effect ~line 3044, `addYear`) are all `startDate`-based → start-year picker is safe. **`currentYearIdx` (~line 1123) is DEAD CODE** that still hardcodes `[2026…2030]` — flagged for separate cleanup (no live consumer). **Still pending: the live fresh-run smoke test (below) + a prod deploy.**

## Phase 3.5 — Foundation (DECIDED: migrate before AI) — NOT STARTED
Reinforce the lightweight single-file foundation *before* the multi-surface AI work lands on it. See `STRATEGY.md` §2.
- **Build-system migration** — single `index.html` → Vite + components, incrementally (get existing file building first, then split out). Its own phase, nothing riding on it; prove the app behaves identically after.
- **Service-worker / cache fix** — version + force-update (auto-refresh at a safe moment, never mid-edit); fingerprinting makes it near-free during the migration.
- **Test harness + error monitoring** (Sentry) — prioritize sync/merge engine, money math, AI guardrails.
- **Minimal admin/observability dashboard (EARLY)** — errors, AI calls, costs, engagement. Start minimal; later becomes the webhook aggregator.
- **Company account hygiene** (can run in parallel, mostly non-engineering) — Marro-owned GitHub org / Vercel team / Supabase / domain / business email; Bitwarden shared vault (✅ done 2026-06-27); `.env.example`. See `STRATEGY.md` §6.

## Sequencing decision (2026-06-28) — loan DATA before loan-aware AI
Run-through outcome: "loans before AI" is half-right. Split each: **loan DATA layer** (capture/store) vs **loan FEATURES** (repayment simulator); and **4a** (budget-only AI machinery validation) vs **loan-aware AI advice**. The only hard dependency is **loan data layer → loan-aware AI** — NOT all-of-5 → all-of-4. So: **3.5 (Vite) first**, then the **loan data layer** built clean on the new foundation *with tests* (the loan snapshot is its front door — do NOT build the snapshot/Estimate-badge standalone before 3.5: nothing consumes loan numbers yet so the badge has nothing to guard, and it bloats the file we're about to migrate). **4a stays early** (budget-only, de-risks AI cost/UX cheaply; independent — can run parallel to the loan data layer). Loan-aware AI + the heavy repayment simulator come after both exist.

## Phase 4a — Budget-only AI (machinery validation) — NOT STARTED
Trigger-based (not a chatbot): passive monitoring, anomaly alerts, weekly digest, receipt scanning, goal-aware nudges — **all on existing budget/spending data, no loans needed.** Vercel AI proxy (holds key, model routing) + soft usage pool + BYOK; ship **anomaly-check + good-habit** end-to-end with the "Suggested" UI (CLAUDE.md rule 9); **retire the hard-coded suggestions it replaces**. Validates cost/UX/usage machinery on the smallest surface → friends' hands. **Still-open (defer to 4a start):** usage-pool size + reset period; BYOK transport (proxy vs client-direct); anomaly sensitivity; card placement. **Full guardrails/cost/monetization: `STRATEGY.md` §1–2,§4; cost strategy in memory `project_wcm_ai_cost.md`. Data rules: `docs/DATA_ETHICS.md`.**

## Loan data layer — NOT STARTED (built on the post-Vite foundation, with tests; before loan-aware AI)
The structured loan data the AI and the repayment simulator both consume. Design it **AI-ready from day one.**
- **Loan snapshot** (the onboarding ask, fused here — NOT a standalone pre-3.5 step): asked at setup, **skippable**. Total borrowed + a single toggle **"anything besides standard federal (Direct) loans?"** (catches school / institutional / private — the real line is "a rate we can look up" vs "a rate you give us"). Federal rates inferred from public per-year tables + the structured Unsub→Grad PLUS borrowing pattern; only non-federal needs balance + rate. One blended non-federal bucket by default, optional "+ add another."
- **Honesty system:** if the snapshot is incomplete, loan-dependent numbers carry a calm **"Estimate — add your loans to make this exact"** badge (NOT an alarming "inaccurate" warning — rule 9 + ADA). Post-first-run reminder with snooze (later / next time / never), persisted per-user in `app_state`. One-tap to open the snapshot anytime. Complete snapshot → no badge, no reminders. Accuracy tiers: total-only = *estimate*; +federal/private split = *good*; full per-loan = *precise* — always labeled honestly.
- **Loans tab:** lists every loan, **user-named**, editable; **feeds the Aid/Detail tab** (add/update a loan → flows to the Aid page).
- **Offered ≠ Accepted ≠ Disbursed (field in the model from v1):** an aid award letter lists *offered* amounts (eligibility), the student *accepts* some/all/none, only *disbursed* is real debt. Aid-letter scan (Phase 4) must treat every loan line as **offered** and confirm acceptance — never auto-add an offer to debt. Aid letter = plans one year's budget; loan snapshot / StudentAid.gov = the running real debt. Build the status field now so the scanner drops in cleanly.
- Loan math (federal-rate inference, offered/accepted/disbursed, projections) = money-math → **tests mandatory** (CLAUDE.md), which is why this waits for 3.5's test harness.

## Phase 4 (rest) — loan-aware AI + deeper intelligence — NOT STARTED
**Depends on the loan data layer above.** True-cost reframing, "should you take Grad PLUS," repayment strategy, disbursement-gap warnings, scheduler-driven digests, web-search local pricing/calendars/scholarships, forecasting. Also 4b data-quality (easier entry via voice/receipt, proactive check-ins, lite-APY projections, off-switch + voice guide).
**Full capability menu + hard guardrails + cost controls + monetization tie-in: see `STRATEGY.md` §1–2, §4. Data rules: `docs/DATA_ETHICS.md`.** No autonomous writes.

## Phase 5 — Student loans: repayment simulator + deeper tools
**The loan DATA layer is pulled forward (see above) — this phase is the heavy FEATURE work on top of it.** Repayment simulator (Standard/IBR/PAYE/SAVE/Extended), PSLF modeling, residency projections. **Research before implementing — do not build from memory.**

## Phase 5b — Interview season budget
Cost planner by type (flights/hotels/clothes), specialty-aware estimates, integrates with main budget.

## Phase 5c — Specialty-specific financial outlook
Specialty pick → residency pay, fellowship likelihood, attending salary range, repayment trajectory, PSLF viability.

## Phase 6 — Multi-user backend & school benchmarking
School benchmarking (10+ users/school min), peer tips. Feeds Phase 4 quality. Also: cohort/group-buying (needs per-school density), bank-linking via **Plaid**, monetization (partner offers — always shown + clearly labeled per `DATA_ETHICS.md` rule 3). **Benchmarking = reciprocity unlock ("add your numbers to see how you compare"), not a consent wall; only true aggregates leave the individual layer — see `docs/DATA_ETHICS.md` (the binding rules) + `STRATEGY.md` §6.** Each item = a real go/no-go.

## Pre-launch — legal / trust must-dos (gate public launch)
- **Account deletion + data export** (right-to-be-forgotten + portability): self-serve "delete everything" and "download my data." Legally expected (GDPR/CCPA) + an app-store requirement + the single biggest trust lever for skeptical med students. Build once the data model is stable.
- **`privacy.html` ↔ `docs/DATA_ETHICS.md` alignment:** the policy must match the in-app promises exactly (mismatch = the real exposure) and must disclose: sub-processors (Supabase, Vercel, Google, + Anthropic at Phase 4), aggregate/de-identified data use (in general terms), and retention. Clinic reviews the de-identification line before any data-sharing/partner feature ships.
- **Google OAuth consent verification** (already tracked) — leave Testing mode, custom auth domain, real logo, submit for verification.

## Phase 7 — Mobile & polish
Installable offline PWA, push notifications, PDF/CSV export, year-end summary, session timeout. **Native via Capacitor wrapper** (one codebase → App/Play Store + reliable push + Siri/voice path) + Jarvis voice control — see `STRATEGY.md` §3. (Deferred: terrarium mascot world — needs art pipeline.)

## Backlog
Residency transition planner, referral program, tax-relevant expense flagging.
