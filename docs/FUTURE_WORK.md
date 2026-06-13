# Future Work

Prioritized backlog. Check off + move to UI_AUDIT_LOG when done.
(June 11 2026 overhaul cleared: light theme, self-hosted fonts, modal a11y, table edge fade, blob reduced-motion, chip states, empty-state consolidation, subs rounding, pie retitle.)

## P1
- [ ] **Conflict modal live test** — never triggered with real sync data; exercise once Gist sync is reachable (two devices or two tabs with forced divergence). Note: `darkMode` now actually diverges across devices, so a real conflict is easier to force.
- [x] **Icon-picker popover clipped behind "Key Notes" for lower categories** (June 13) — FIXED: lift the Spending-categories `Card` (`zIndex:50` while `editIconCat||iconPickOpen`), same principle as `useLiftCard`. User-confirmed working on localhost. Ships with next deploy.

## New backlog (user requests, June 13)
- [ ] **Effortless expense capture (the make-or-break)** — CSV import is too much friction; nobody will do it. Two tracks: (a) **Voice / natural-language entry** — "I got a Starbucks latte today" → Claude parses merchant/amount/category → pre-fills a weekly entry for one-tap confirm. Fits **Phase 4** (Claude advisor); start here, higher leverage + cheaper. (b) **Bank connection (Plaid or similar)** — auto-import transactions. Heavier: recurring cost, OAuth/security, dedup against manual entries. Defer behind (a).
- [ ] **Hover affordance pass** — clickable elements (✕ buttons, text actions, esp. the grayish low-contrast ones) should signal clickability on hover: shimmer / liquid-glass sheen + cursor. Currently many read as static text. Systematize in `MOTION_SYSTEM` (reuse `.mc-sh` shimmer machinery) rather than ad-hoc per element.

## Admin backend (invites + analytics) — needs a server-side component
Both items below require the **Supabase service-role key behind a server function** (small Vercel serverless fn or Supabase Edge Function — the public client can't be trusted to read all users or manage an allowlist). This reintroduces a tiny backend (different from the deleted `api/sync.js`). Gated on the OAuth verification item below.
- [ ] **Invite / auto-add users** — NOT via Google's "test users" list (console-manual, 100 cap, no clean API — dead end). Instead: publish+verify the consent screen so any Google account *can* sign in, then gate access app-side with a Supabase `allowed_emails` (invite) table. Admin panel "Invite" = insert email → on that user's first Google login the app calls `is_email_allowed` RPC → grant or sign-out+deny. Google does identity; Supabase does gating. **SQL written & ready: `supabase/allowed_emails.sql`** (table + RLS + `is_email_allowed()` SECURITY DEFINER fn, owner seeded). NOT yet run/enforced — do not enable the app-side gate until the consent screen leaves Testing mode (lockout risk; Google test-user list already gates now). App-side hook documented in §4 of that file.
- [ ] **Legal pages** — `privacy.html` + `terms.html` drafted (June 13), on-brand, live at `/privacy.html` `/terms.html` once deployed. DRAFT quality — have a human review before submitting for Google verification; swap contact email if a dedicated support address is created; confirm NY governing law.
- [ ] **Admin analytics panel** — who signed up, login frequency, last-seen, feature usage. Raw data is largely free in `auth.users` (`last_sign_in_at`, `created_at`); richer usage needs lightweight event logging. Read via the Admin API behind the same server function. Same backend as invites — build together.

## P2 — quality
- [ ] **apple-touch-icon is an SVG** — iOS ignores SVG touch icons and screenshots the page instead. Export a 180×180 PNG of the rings icon and point `<link rel="apple-touch-icon">` at it.
- [ ] Dual `<meta name="theme-color">` with `media="(prefers-color-scheme)"` for pre-JS browser chrome (JS already updates it post-load); revisit `apple-mobile-web-app-status-bar-style` for light theme.
- [ ] Light-theme polish pass on `.mc-sp` specular and `.mc-sh` shimmer (white-on-white is currently invisible — harmless but wasted).
- [ ] Sweep remaining hardcoded cream rgba stragglers in JSX for light theme (e.g. MarroLogo tile ring shadow, week-pill border ~`rgba(246,239,221,0.45)`).

## P3 — opportunities (incl. deferred from Phase 2.5)
- [ ] Tab bar redesign: floating glass pill detached from content, cross-fade tab transitions.
- [ ] Charts: gradient fills + draw-on animation, themed `cursor` fills audit.
- [ ] Number-roll animation on MetricTile values.
- [ ] CSV import: remember per-merchant category corrections (extend `autoCategory` with learned map in state).
- [ ] Browse-weeks modal: show entry count next to each archived week's total.
- [ ] Bloom state currently triggers only from "Log deposit" — also trigger when a weekly exams entry overflows a goal to fully funded.

## Pre-public-launch (Phase 2.5b → before non-WCM testers)
- [ ] **Google OAuth consent shows raw Supabase domain** ("Sign in to <ref>.supabase.co") + "unverified app" warning. Harmless in testing, looks sketchy to new users. Fix at launch: (1) buy a domain, (2) add it as a Supabase **custom auth domain** (paid add-on, needs Pro plan) so the callback is on our domain, (3) add a real app logo, (4) submit the Google consent screen for **verification** (removes the warning + shows "Marro" + logo). Pairs with publishing the consent screen out of Testing mode (currently capped at 100 test users).
