# UI Audit Log

Newest first. One line per finding: severity · what · fix.

## 2026-07-13 — Phase 2 commit 7: header tiles + flag flip (branch `mo/phase2-go-live`)
`App.jsx` now computes `debtProjection`/`runway`/`refundNudge` alongside the existing money-math block and wires the two hidden header `MetricTile`s (Debt, Runway) to real data, plus a header-level "did your refund land?" nudge. `SHOW_PHASE2_TILES` flips to `true` as its own final commit. Verified via an isolated mock mount (temporary `mockmount.html` + `src/mockmount-entry.jsx`, deleted before commit — same pattern as commits 4–6): all 7 `computeRunway()` states (`unanchored`, `growing`, `through_graduation`, `counting_down` incl. `basicallyOnTrack`, `gap`, `overdrawn` both with/without a savings cushion, `graduated`) plus both Debt-tile variants (estimate/exact), both themes.
- **New `refundNudgeState()`** (`src/lib/loans.js`) factored out of `LoansTab`'s `RefundPlaybook` so the header nudge and the Loans-tab Playbook card share one source of truth for "which refund term, and full card vs. just a nudge" — confirming "yes, it landed" from either surface (shared `refundNudgeConfirmed`/`setRefundNudgeConfirmed` in `AppContext`) feeds the same confirm-path hardening rule (never a bare balance-jump guess).
- **`MetricTile`** (`src/components/primitives.jsx`) gained optional `role`/`ariaLive` passthrough (both `undefined` by default — no change to any existing caller) so the `gap` and `overdrawn` runway states can carry `role="alert"`/`aria-live="assertive"`, per the plan's requirement that the gap warning be announced, not just colored.
- **Verified working**: contrast held in both themes (all colors reused existing AA-checked tokens — `C.green`/`C.amber`/`C.teal`/`C.text`/`C.gray`, no new colors introduced); every sub-line carries its own plain-language meaning ("lasts until ~Apr 10", "overdrawn — your savings covers it", "trim ~$75/mo closes it") — no bare numbers; the header nudge banner uses the existing `Banner`+`dismissed`/`dismiss` mechanism (same dismiss pattern as the renewal banners already audited) and its "Yes, it landed" control is a real `<button>`, keyboard-reachable and Tab-orderable, no focus trap; Debt tile's `sub` (`"estimate"`/`"at graduation"`) read correctly for both a fully-estimated and a fully-confirmed loan set.
- Copy read-through against the plan's banned-jargon table and the walkthrough §5/§9 copy: no "disbursement"/"principal"/"accrual"/"capitalization"/"origination fee"/"APY" in any new string; "Growing"/"On track ✓"/"basically on track ✓" match the walkthrough verbatim.

## 2026-07-13 — Phase 2 commit 6: Refund Playbook card (branch `mo/phase2-playbook`)
New `RefundPlaybook` component in `src/tabs/LoansTab.jsx` (walkthrough §7) — the one-time educational card that appears when a semester's aid refund lands, plus its "did your refund land?" nudge fallback. Verified via isolated mock mount (temporary harness, deleted before commit) with two scenarios (a balance jump big enough to auto-trigger, and one below the 50% threshold that shows the nudge instead), both themes.
- **Medium · a straddling-refund burn rate produced a negative/nonsensical "months × pace" number** — `computeRunway`'s measured burn between two readings that bracket the refund itself reads as a huge negative spend (the refund looks like a giant deposit), which isn't useful for "what does the rest of the semester cost." Caught while testing the auto-trigger scenario (semester-need line briefly showed a negative dollar figure). Fixed: the card now falls back to the student's planned monthly spend (`moSpend`) whenever the measured burn isn't a real positive number, rather than showing a straddling-window artifact as if it were a confirmed figure.
- **Verified working**: card is `role="region"` with `aria-labelledby` pointing at a real heading id (confirmed via the AX tree); dismiss (`XBtn`, labelled "Dismiss — I've seen this") writes `refundPlaybookSeen` and correctly advances to the *next* unseen term's refund (tested: dismissing the spring card revealed the still-unseen fall nudge for the same mock data) rather than hiding the feature outright; the "Yes, it landed" confirm button is real, keyboard-reachable, and shows a visible `:focus-visible` ring (confirmed via `document.activeElement.matches(':focus-visible')` after a Tab press) — it upgrades the nudge into the full card exactly as the confirm-path hardening rule requires (never a bare balance-jump guess); the "park the rest" bullet correctly omits a specific dollar amount when the computed park amount would be $0 or negative, rather than showing a wrong number; the 120-day return bullet correctly filtered out an already-expired disbursement window and showed only the one still open, with a hard day-count because its date was `dateConfirmed`.
- Copy read-through against both the banned-jargon table and the plan's content rules: no "disbursement" (→ "when it arrives"), no "APY" (→ "Many online banks currently pay roughly 3.5–4.5%"), "many students choose to…"/"many students keep…" framing throughout (never "you should"), no bank names, no suggestion to invest, FDIC line states the real per-bank/category coverage amount, a 1099-INT mention is paired with plain "small tax form" language, and the required "general education, not individualized financial advice" footer is present verbatim.

## 2026-07-13 — Phase 2 commit 5: setup money step (branch `mo/phase2-setup-step`)
New `OnboardingFlow` step 5 (money + "I have student loans") and the first real `ProgressiveSetup` entry (`SETUP_STEPS`, `sinceVersion:2`). Verified via isolated mock mount (temporary harness, deleted before commit): full click-path through `OnboardingFlow` (welcome→name→avatar→school→program→money) in both themes, plus a standalone `ProgressiveSetup` mount (no Supabase needed — pure local-state commit).
- **Medium · `ProgressiveSetup` had no keyboard focus trap** (pre-existing gap, not introduced by this commit — the sibling hard-gate modal `OnboardingFlow` has one, this one never did) → added the identical Tab-wrap pattern (WCAG 2.4.3). Confirmed live: Shift+Tab from the first field ("Available to spend") wraps to the last focusable element ("Skip"); Tab from "Skip" wraps back to the first field.
- **Verified working**: 5 progress dots render correctly across the extended `OnboardingFlow` (was 4), the program step's CTA correctly reads "Continue" (no longer "Finish" — the money step is now last), all new inputs have `aria-label`/`<label htmlFor>`, the "I have student loans" checkbox visibly reveals its helper text and is a real native `<input type="checkbox">` (keyboard-toggleable), contrast held in both themes (reused the existing `head`/`sub`/`input`/`ctaPrimary` tokens verbatim, no new colors), "I have student loans" correctly fires `setTab("loans")` in the `ProgressiveSetup` path (confirmed via a logged mock `setTab` call).
- Copy read-through: "Last one — so Marro can tell you how long your money will last" / "Available to spend" / "Set aside in savings (optional)" / "I have student loans" all match the plan's walkthrough §0 verbatim; no jargon introduced.

## 2026-07-13 — Phase 2 commit 4: LoansTab (branch `mo/phase2-loans-tab`)
New `src/tabs/LoansTab.jsx` — loan cards, annual-amount → auto-split disbursement rows, rate entry with sanity confirm, as-of-balance mode, progressive disclosure ("More options"), debt summary + Estimate badge, balance check-in with typo guard + reading history, reminder banner, new "Loans" tab in nav. No real signed-in session was available, so this was verified via an **isolated mock mount** (temporary `mockmount.html` + `src/mockmount-entry.jsx`, deleted before commit/PR — same pattern as the June 23 onboarding audit): `AppContext.Provider` fed mock loans/readings/years, `upd` was a local-state no-op (never touched real synced data). Verified live on localhost:3456, both themes:
- **Medium · Type toggle (Federal/Private) wasn't a real roving-tabindex radiogroup** — built as two independent `<button>`s (both in the natural Tab order), inconsistent with the app's own `ChoiceGroup`/`radioProps` convention (used by nav tabs, year pills). Fixed: wrapped in `ChoiceGroup role="radiogroup"`, `SegButton` now uses `radioProps(active)` — confirmed live: Tab lands once on the active option, arrow keys move + select, Tab advances past the group to the next field.
- **Low · As-of-balance mode's prefilled amount had float noise** (`40422.7999999999` from `loanPrincipal()`'s cent-level arithmetic) — rounded to cents at the UI boundary (`Math.round(...*100)/100`) when the toggle prefills it.
- **Verified working**: all inputs have accessible labels (`aria-label`/`<label htmlFor>`), delete buttons have descriptive `aria-label`s including the loan name, native `:focus-visible` ring visible on every control (inputs, DateField, segmented buttons, More-options toggle) with no custom override needed, typo-guard confirm renders `role="alert"` + two clearly-labelled actions (Cancel-left/primary-right per rule 9), empty state + reminder banner + "Don't show again" persistence all matched the plan's walkthrough exactly, contrast held in both themes (Banner `type="info"` uses the existing AA-verified `C.blue` tokens, no new colors introduced), 200%-equivalent reflow not regression-checked this pass (flagged as a follow-up, consistent with the existing FUTURE_WORK P1 tracking — not blocking, no new layout primitives were introduced beyond the existing `Card`/grid pattern already covered).
- Copy read-through against the plan's banned-jargon table: no "disbursement"/"principal"/"interest accrual"/"capitalization"/"origination fee"/"APY" anywhere in user-facing strings; status options use the plain-English labels verbatim from the table.

## 2026-07-09 — audit Track B: ConflictModal + InfoTip (branch `ethan/audit-experience-fixes`)
- **High · ConflictModal had no dialog semantics** (hand-rolled overlay: no `role="dialog"`/`aria-modal`, no focus trap/restore, invisible to SilentUpdater's open-dialog check) → rebuilt on the shared `Modal` primitive with new `dismissible={false}` (Escape/scrim/✕ disabled — conflict requires an explicit choice — semantics kept). Filled button text `#fff` → `C.bg`. Verified live on localhost:3456 via isolated mock mount: `[role="dialog"]` + `aria-modal` present, Tab trap wraps (6 tabs → back to first control), Escape leaves it open, visible focus ring, both-themes screenshots.
- **High · InfoTip was a `<span onClick>`** (keyboard/SR-invisible) → real `<button type="button">` with `aria-label`/`aria-expanded`/`aria-describedby` → `role="tooltip"`, native Enter/Space, close-on-blur, Escape-to-dismiss (WCAG 1.4.13), 44×44pt hit-slop via new `.infotip-btn::after` (visual 16px unchanged). Verified live: semantics + 44px hit area + focus ring confirmed; call sites unchanged.
- Known gap (pre-existing, all modals): the year-undo toast (`App.jsx`, z 1200) sits above `Modal`'s z 1000 — flagged in PR #20 for a z-index policy decision, not special-cased here.

## 2026-07-08 — auth/invite flow redesign (landing modal + InviteGate)
Verified live on localhost:3456 (signed-out surfaces): sign-up tab renders only Email/Password/Confirm (invite field removed); failed-credentials rescue link is inside the existing `role="alert"` error (announced with it), is a semantic `<button>`, and carries the email into the sign-up tab; `?invite=` deep link auto-opens the correct tab. InviteGate congrats state reuses audited theme tokens (`C.greenLight/greenMid/green` box) and keeps the dual-channel announcement (visible box + existing `role="status"` SR text). **Not yet verified in-browser: the signed-in InviteGate congrats/auto-redeem path** (needs a non-allowlisted session) — pending Vercel-preview click-test before merge.


## 2026-07-07 — invite codes + waitlist + admin console (new build)
Built to spec against the project a11y rules (rule 7). `<InviteGate>` verified in a standalone in-preview render (both code + waitlist modes, mobile 375px): labeled code input + textarea, generic-error path announced via `role="alert"`, ≥44px hit targets, Back-left/primary-right button order, semantic `<button>`s, uses the theme `C` object (contrast inherits the app's audited tokens both themes). `AdminTab` + `InviteFriendsModal` built to the same rules (labeled inputs, `role="alert"` messages, `<th scope>` on tables, ambassador toggle as `role="switch"` with `aria-checked`, copy buttons `aria-label`'d) but **not yet keyboard/axe-verified in-browser** — behind the admin/signed-in gates, pending the SQL apply + a real session in the owner's Chrome. Follow-up: full keyboard + axe pass on AdminTab and the referral modal once reachable.

## 2026-06-23 (chunk 2) — ADA P1: first-run onboarding + manual keyboard / AX-tree / 200%-zoom on the signed-in app

Method: axe-core 4.10 **plus** the manual passes axe can't do (programmatic selected-state, keyboard roving, focus-trap, accessible-name/AX-tree as a VoiceOver proxy). Onboarding audited via an **isolated mock mount** of `OnboardingFlow` (first-run props, no-op `upd`/`onDone`) so the owner's real synced data was never touched (verified: 0 `upd`/0 `onDone` calls). All steps scanned both themes (axe-clean throughout). Three real findings surfaced beyond axe — all remediated + re-verified in-browser. End state after fixes: **app axe-clean both themes, no console errors, no visual regression; arrow-key + focus-trap + selected-state all confirmed working.**

### Findings (things axe can't catch) + fixes
- **P1 · 4.1.2 · single-select controls announced no selected state app-wide** — main nav tabs (Budget…Categories) + year pills (Year 1–5) + onboarding avatar look/color + program track + year-count all showed the active item with a ring only (no `aria-*`). Screen-reader users couldn't tell what was active. Fixes (all in `index.html`):
  - New reusable `ChoiceGroup` (role wrapper + arrow-key roving: ←→↑↓/Home/End move **and** select per APG) + `radioProps(active)` / `tabProps(active,id,panelId)` helpers, inserted before `TabBtn`.
  - **Main nav → ARIA Tabs pattern:** tab bar `<div className="tabbar">`→`ChoiceGroup role="tablist"`; `TabBtn` spreads `tabProps` (`role=tab` + `aria-selected` + roving `tabindex` + `id="tab-<id>"` + `aria-controls="tab-panel"`); each of the 7 panel root divs tagged `role="tabpanel" id="tab-panel" aria-labelledby="tab-<id>" tabIndex={0}` (charts panel = the div returned by its IIFE).
  - **Year pills → `role="radiogroup"` aria-label "Academic year";** `YrBtn` spreads `radioProps` + `aria-label="Show Year N"`.
  - **Onboarding:** program track → `ChoiceGroup role="radiogroup"` "Dual degree"; year count → `radiogroup` "Number of years total" (+ `aria-label="N years"`); avatar look/color/google/upload buttons → `aria-pressed` (gallery is a 2-D grid → toggle-button semantics, each a Tab stop; look icons also gained `aria-label` alongside the `title`).
- **P1 (serious) · 4.1.2 · school-picker results `<div role="listbox">` had no accessible name** (`aria-input-field-name`) **and** held `<button role="option">` (invalid — options aren't buttons). 4 sites (ProfileModal/Settings ×2, onboarding ×2). Fix: dropped `role="listbox"`/`role="option"`; results are now a named group of action buttons — `role="group" aria-label="School results"` (campus lists `"Campuses"`). axe violation gone; buttons stay keyboard-operable.
- **P1 · 2.4.3 · onboarding didn't trap keyboard focus** — dialog was otherwise correct (`aria-modal="true"` + `aria-label`) but Tab escaped to the dashboard behind it (empirically reached "Year 1" after ~14 Tabs). Fix: focus-trap effect in `OnboardingFlow` (mirrors `Modal`'s; keyed on `step`, wraps Tab/Shift-Tab + pulls stray focus back). Re-verified: 25 Tabs, focus stayed inside.

### Passed (no change needed)
- **200%-zoom / reflow (1.4.4 / 1.4.10): PASS** — tested via half-width reflow: tiles wrap, two-column layout stacks, no page-level horizontal scroll; tab strip is `overflow-x:auto` (Categories reachable, not lost).
- Onboarding finish-error already uses `role="alert"`; global `:focus-visible` ring (line 179) covers all new controls; both themes axe-clean.

### Live VoiceOver listen-through — DONE (⌘F5, real macOS VO, via Zoom screen-share to read the caption panel)
The AX-tree proxy was confirmed by ear against the actual screen reader. Every fix announced correctly:
- Nav tab: *"Budget, selected, tab, 1 of 7"*; ArrowRight → *"selected tab, 2 of 7"* and the panel actually switched (arrow moves **and** activates, per APG).
- Year pill: *"Show Year 1, selected, radio button, 1 of 1, Academic year, radio group."*
- Onboarding dialog: *"…inside of a dialog"*; avatar swatch: *"…toggle button, inside of a dialog"*; school result: *"Weill Cornell Medical College, button, School results, group"* (no broken listbox); dual-degree radio: *"…MD only, selected, radio button, 1 of 4, Dual degree, radio group."*
- Focus trap: Tab past the last control wraps back to the first. Mock-mount writes stayed at 0 `upd`/0 `onDone`.

### Polish — tab-strip scroll affordance — DONE (HIG-correct edge fade, not a "more →" button)
The old `@media (max-width:600px)` mask was a **content-blind breakpoint** — at 700px the strip already overflowed (645px in 643px) but got no fade, while a future extra tab/badge would drift the true overflow point anyway. Replaced with `useEdgeFade(ref)`: measures `scrollWidth/clientWidth/scrollLeft` via `ResizeObserver` + scroll listener and toggles `.fade-l`/`.fade-r` only on the edge that genuinely has more content. Wired into `ChoiceGroup` (nav tabs + year pills) and a new `ScrollX` wrapper (5-year overview table, same breakpoint bug). Decorative only (no motion → reduced-motion-safe). Verified in-browser: 600px → `fade-r`; scrolled to end → flips to `fade-l`; 1400px (no overflow) → no fade class.

## 2026-06-23 (later) — ADA P1 part C: static pages + login screen (no-login-required surfaces)

Method: axe-core 4.10 per-view, login screen scanned in **both themes**, static pages on their solid dark bg. End state: **axe-clean on `/`, `/privacy.html`, `/terms.html` (login both themes)**. These three surfaces are reachable without auth so they could be audited this session; onboarding + signed-in 200%-zoom + VoiceOver still pending (need a logged-in session).

### Static pages (`privacy.html` + `terms.html`, identical CSS)
- **P1 · `--faint` (Last-updated date + footer, 13px) was 3.66:1 on `#101210`** (fails 4.5:1) → opacity `0.42`→**`0.52`** (≈5.1:1). axe now resolves contrast fully (solid bg), zero violations.
- **P1 · Inline links amber-only vs body text** (1.4.1; ~1.25:1 against surrounding `--dim`, no rest-state underline) → `a { text-decoration: underline }` by default.
- **Minor · no landmark** → content region `<div class="wrap">`→`<main class="wrap">`.

### Login screen (`index.html`, `LoginScreen`)
- **P1 · no heading on the page** → wordmark `<div>`Marro.`</div>`→`<h1 style={{margin:0,…}}>` (1.3.1/2.4.6).
- **P1 · logo `marroDotPulse` infinite animation not gated by reduced-motion** (2.2.2 — only the boot-ring set was covered) → added `.marro-logo-svg circle { animation: none !important; }` to the reduced-motion block + `className="marro-logo-svg"` on the svg.
- **Minor · decorative SVGs exposed to AT** → `aria-hidden="true"` on the MarroLogo tile div + the GoogleGlyph svg (button text "Continue with Google" carries the name).
- **Minor · offline message not announced** → `role="status"` on the "You're offline" div.
- **Verified-pass (no change):** tagline (`C.gray`) over the `.mm` glass hand-computes to ~6:1 dark / ~5.25:1 light (axe left it "incomplete" — couldn't resolve the blurred-blob backdrop); the global `:focus-visible` ring (line 179) applies to the `<button>`.

## 2026-06-23 — Full ADA / WCAG 2.1 AA audit + remediation (FUTURE_WORK P1, part A)

Method: axe-core 4.10 run per-view in **both themes** + per-modal, via Chrome MCP on the owner's logged-in session, plus keyboard-close checks. All 7 tabs (Budget/Weekly/Charts/Savings/Aid/Subscriptions/Categories), all reachable modals (Add goal, Log deposit, Add subscription, Import CSV, Add category, Program, Avatar), and the settings popover scanned. End state: **axe-clean across every view in both themes.** (Already-passing before this pass: global `:focus-visible` ring, icon-button `aria-label`s, reduced-motion, `lang`, Modal focus-trap+Esc — left intact.)

### Perceivable — contrast (both themes audited; tokens are theme-split)
- **P1 · Light muted text failed 4.5:1** — `gray`/`tabMuted` 0.55→**0.68**, `--text-dim`/`--text-faint` bumped; secondary labels/inactive tabs now ≥4.9:1.
- **P1 · Light positive-blue** (`teal`/`green` `#33689E`) was 4.49:1 on glass cards → **`#2F6196`**.
- **P1 · Light steel-blue "Auto" badge** (`blue` `#5C7282`) 3.92:1 → **`#4F6373`**.
- **P1 · Light "Remove"/danger text** (`danger` `#B05A38`) 3.64:1 → **`#964B2E`**.
- **P1 · Light gold milestone/warning** (`amber`/`purple`/`marigold` `#A87B12`) 2.7:1 on amber chips → **`#7A5A0D`**.
- **P1 · Light-theme modal labels** illegible (3.78:1) because the `.mm` glass panel was `rgba(255,255,255,0.22)` — too translucent → **0.45** (more opaque, still glass; the one change that touches the tuned Liquid Glass look).
- **P1 · Dark modal "Cancel"/secondary text** 4.27:1 on the cream-tinted translucent `.mm` panel — dark `gray` 0.58→**0.63** (panel is a light tint so opacifying it would *worsen* light-text contrast; fixed on the text side, kept distinct from `textMid` 0.65).

### Perceivable — non-text / charts
- **P1 · Recharts bar/pie segments** exposed 17 nameless `role="img"` paths per chart-heavy view (svg-img-alt) → effect marks every `.recharts-surface` `aria-hidden` + neutralizes the `tabindex="0"` pie layer (fixes companion aria-hidden-focus). Charts are decorative-redundant (figures shown as text + visible titles).

### Operable — keyboard
- **P1 · Popovers had no Esc** (MonthPicker, PeriodPicker, DateField, settings menu, pie range picker, category icon picker) — pointer-only backdrop scrim was the only dismiss → shared `useEscClose` hook added to all six. (Modal already had Esc — verified still working; the Recharts tooltip carries a hidden `role="dialog"`, a red herring in testing.)
- **P1 · "Add year" tile was a clickable `<div>`** (not Tab-reachable) → semantic `<button>` with `aria-label`. (MetricTile's optional `onClick` is never used in practice — left as-is.)

### Understandable / Robust — names & structure
- **P1 · 25 unlabeled year-config inputs** (Aid tab: Grant/Tuition/Health ins/Housing/Other × 5 years) → dynamic `aria-label` "{field} — {year}".
- **P1 · 5 unlabeled budget category inputs** + savings goal Monthly/Target + APY → `aria-label`s.
- **P1 · Weekly "Category" + Subscriptions "Billing cycle" `<select>`s** unnamed → `aria-label`s.
- **P1 · Banner dismiss ✕** had no name → `aria-label="Dismiss"`.
- **P1 · Settings popover was `role="menu"`** with non-menuitem children (profile block, theme toggle) → `aria-required-children` fail. It's a mixed-content popover, not a menu → `role="group" aria-label="Settings"`, dropped the 5 `role="menuitem"`.

### Tooling note
The app's service worker serves stale `index.html` on normal reloads — verification required unregistering the SW + clearing caches, then a fresh load, per pass. Reconfirm any future axe run is against fresh code (`navigator.serviceWorker.controller === null`).

## 2026-06-11 (fourth pass) — User feedback round 3 (8 items)

- **P1 · Native date-picker calendar popup can't be themed** → custom `DateField` (glass day grid, Monday-start, marigold today, "Today" shortcut) replaced all 9 native date inputs; dead `::-webkit-calendar-picker` CSS removed.
- **P1 · Tooltip trailed the cursor** → `isAnimationActive:false` in `tipProps()` (Recharts animates tooltip position 400ms by default).
- **P2 · Comparison still used native selects** → `PeriodPicker` glass popover (year pills + full-year + month grid).
- **P2 · Picker popovers painted under the next card** (cards are stacking contexts) → `useLiftCard` bumps the hosting card to z-50 while open. (First tried fixed-position anchoring — flaky under layout shift; reverted.)
- **P2 · Aid-card ✕ wrapped down beside the surplus pill** → pinned absolute top-right; XBtn default 28px / 14px icon (was 26/12).
- **P2 · Category icon chips too small/thin** → 26→30px chip, stroke 1.6→1.9, stronger tint.
- **P2 · "This week — Jun 8 – Jun 14" read as plain text** → caps whisper label + 20px serif date range (matches display-money language).
- **P3 · Flicker at top when scrolled to bottom** → blob layer pinned to its own compositor layer (`translateZ(0)` + `backface-visibility:hidden`).
- **Note**: "gray bar on hover" + "title confusion" on the live site were a stale deploy — the previous two passes were committed/pushed at the start of this round.

Verified: DateField popover + day selection (Weekly), PeriodPicker open/clamp/selection over sibling cards, week header, no console errors.

## 2026-06-11 (third pass) — User feedback round 2 (11 items)

- **P1 · Boot was a bare "Loading…" line** → full boot moment: staggered ring bloom, orbiting marigold dot, serif "Marro." fade-up; pure CSS so it runs before React/Babel; reduced-motion safe.
- **P1 · Bar-chart hover still showed a cursor box** → `cursor={false}` on all three bar charts; hovered month's bars stay full while siblings dim to 0.35 (`barHover`/`barDim`/`barMove`, same language as the donut).
- **P2 · Category icons frozen after creation** → click the icon chip in Categories tab → glass popover picker; saved to `cat.icon`.
- **P2 · Only 12 icon choices** → +10 new ring-language icons (coffee, health, fitness, travel, phone, music, gift, paw, shirt, game) = 20.
- **P2 · Icon grid always expanded in add flows** → collapsed behind a 36px icon-preview button beside the name field.
- **P2 · Aid year date inputs were a cramped one-off** (10px font / 2px padding) → standard field recipe (12px / 5px 8px) + row wraps.
- **P2 · Boxed ✕ buttons everywhere** → shared `XBtn` ghost circle (modal close, remove category, delete entry, undo deposit, delete goal [danger], remove year).
- **P2 · Calendar picker icon too dim in dark** → filter brightness 1.05→1.25, base opacity 0.5→0.75.
- **P2 · Native month `<select>` clashed with the glass UI** → shared `MonthPicker` popover grid (Monthly plan header).
- **P2 · Header cluttered with loose theme/reset buttons** → settings gear menu (theme toggle, clay Reset defaults).
- **P2 · "Monthly spendable vs budget — all years" title contradicted its year x-axis** → "Spendable vs budget by year" + explanatory sub; legend now "/mo"-suffixed.
- **P3 · EmptyState watermark still read as a misprint** → small crisp 34px ring mark above the copy, watermark removed.
- **P3 · Savings deposit log showed raw ISO dates** → `fmtDay`.

Verified: boot screen, settings menu, month grid, icon-edit popover, 20-icon set, aid dates, ghost ✕s, bar dim (cells render; donut re-verified — note: Recharts pie paints nothing while the tab is `visibilityState:hidden` (rAF paused), an environment artifact, not a bug). Zero console errors.

## 2026-06-11 (later) — User feedback polish pass (12 items)

- **P1 · Form controls rendered in system font, not Inter** (browsers don't inherit font into inputs) → `input, select, textarea, button { font-family: inherit }` incl. `::-webkit-datetime-edit`.
- **P1 · Light mode glare**: bg `#F5F4EF`→`#ECEAE2`, card glass white 0.55→0.42, `brightness(1.08)` dropped in light via `[data-theme="light"] .mc/.mm` overrides, light blobs deepened. (CSS vars + THEMES.light kept in sync.)
- **P1 · Bar-chart hover showed stock bright-grey cursor rect** → `tipProps()` now sets `cursor:{fill:C.selBg,stroke:C.borderDark}` everywhere.
- **P2 · Ambient blobs too subtle to register** → chroma + opacity raised both themes (dark 0.6→0.78, light 0.55→0.72); blob2 is now a deliberate slate-blue whisper; calm/low-tide/bloom states preserved.
- **P2 · Custom categories stuck with generic ring icon** → `CatIconPicker` (12 ring-set choices) in both add-category flows; stored as `cat.icon`, rendered via `cat.icon||cat.id`.
- **P2 · Card top accent bars (teal/amber) read as a rendering bug** → removed `accent` prop from Card + both call sites (Running balance, aid year cards); the colored figures already carry the signal.
- **P2 · Donut tooltip felt blocky** → removed; hover detail now lives in the donut center (name, serif amount, % of plan), non-hovered slices dim to 0.35, legend rows hover-link to slices.
- **P2 · EmptyState ring watermark clipped** by container height → 120px→86px + taller padding.
- **P2 · Year selector cluttered** (date range repeated under every button) → segmented glass pill (tab-bar language); active year's range shown once beside it.
- **P2 · Tab bar stretched full-width leaving dead space** → `width:fit-content`.
- **P2 · Wordmark whispered** → 17px→24px Newsreader w600 + marigold full stop ("Marro.").
- **P3 · Entries list showed raw ISO dates** → `fmtDay()` ("Jun 11").
- **P3 · Charts felt stiff/finance-y** → bar `radius [6,6,0,0]` + `maxBarSize 26`, donut `cornerRadius 5` + `paddingAngle 2.5`, area strokes 2→2.5.

Verified: dark + light, Budget/Weekly/Charts tabs, add-category modal, 375px (no overflow; year pill gets tab-bar edge fade), zero console errors.

## 2026-06-11 — Full interactive audit (all tabs, modals, mobile)

### Functional bugs
- **P0 · CSV import parsed 0 rows for every US-format date** (incl. the app's own placeholder example): `new Date("06/09/2026T12:00:00")` is invalid. Fixed: explicit ISO / m-d-y / 2-digit-year parsing with `-` `/` `.` separators.
- **P1 · CSV import turned deposits into expenses** (`Math.abs` on +500 PAYCHECK). Fixed: in signed exports, positives are skipped; all-positive files treated as debit-only.
- **P1 · Recharts Area selected-month dot always clay** even when balance positive (`p.value` is an array for areas). Fixed: read `p.payload.balance`.
- **P2 · Logo picker modal was unreachable dead code** (no trigger; pre-rebrand WCM logos; external img URL breaks offline PWA). Removed.

### UX / states
- **P1 · Silent-failure submits** — Confirm deposit, Add goal, Add subscription, Add category (×2) did nothing on click with empty fields. All now disabled-until-valid (matches Add entry pattern).
- **P1 · CSV column-detection error used native `alert()`**; 0-row parse showed "0 transactions found — review categories…" + "Import 0 entries". Both replaced with inline `role="alert"` guidance.
- **P2 · Renewal dialog date empty** — now prefilled with next cycle date from cycle length.
- **P2 · "← Current week" back-nav styled as danger** → neutral cream ghost, relabelled "← Back to current week".

### Consistency / visual
- **P1 · Rounding inconsistency in money app**: entry $42.50 vs tile "$43" vs "Week total $43". Actual money now uses `fmtA`/`fmtSA` (exact cents) in tiles, week total, entries, CSV review.
- **P1 · Danger hue used as selection**: year pills, week-picker current row. Now cream selection (matches active tab). Rule added to DESIGN_SYSTEM.
- **P1 · White-on-color filled buttons remained** in CSV modal + renewal dialog (missed by prior sweep). Now teal/clay + dark `C.bg` text.
- **P2 · Aid year-card accent was clay on all years** (decorative). Now teal if monthly surplus ≥0, clay if deficit — matches the card's own pill.
- **P2 · Aid card header overflow**: remove-✕ poked outside card at narrow widths → header rows wrap.
- **P2 · Mobile header**: right cluster wrapped into subtitle text → header wraps as rows.
- **P2 · Weekly entry amounts rendered in danger clay** for normal spending → cream.

### Copy
- Year pills "Aug 26 – Aug 27" read as days → "Aug '26 – Aug '27".
- "1 entries" (deposit history), "1 transactions found" (CSV) → pluralized.
- Tooltip "Total position : " stray space → `separator=": "` on all 8 Recharts tooltips.
- Key notes hardcoded stale "~$1,935/mo" → points at the live Monthly spendable tile.

### Verified working (no change needed)
Reset confirmation (Cancel-dominant, destructive ghost) · renewal banner/badge/Overdue pill pipeline · week auto-categorization (TRADER JOES→Food, MTA→Transportation) · subscription auto-reflection in budget ("incl. $15 subs") · empty states on all charts · 375px: zero horizontal overflow on all 7 tabs · COA + 5-year tables scroll within cards · CSV modal fits mobile.

### Known gaps (deliberate, see FUTURE_WORK)
Conflict modal untested live (needs a real sync conflict; code-reviewed only) · 🌙 toggle only subtly brightens (no true light theme — needs a product decision) · "Spending distribution" shows plan, not actuals (title ambiguity).

## Pre-2026-06-11 (summarized from memory)
Glass sweep all surfaces · semantic color split (was: surplus/deficit identical) · clay danger hue + steel-blue info · CHART_COLORS de-clustered · destructive modals Cancel-dominant · empty chart placeholder boxes · ✕ tap targets ≥28px · tab-bar mobile fade · InfoTip hover-intent + scale-in · date-field theming · real font weights · muted-text alpha 0.40→0.52 · progress track visibility · white-on-red primary buttons eliminated (main app) · one-click Reset wipe → confirmation · color-dot rings · mobile grid overflow fix.

## 2026-07-03 — Landing page redesign (branch `landing-redesign`, pre-merge audit)
New scrollytelling landing (`src/landing/`). Verified on localhost:3456 (dev):
- **axe-core 4.10.2**: 0 violations on the `.lp` root (desktop viewport).
- **Contrast**: body cream-on-dark ≥5:1 (agent spot-check: gold-on-bg 8.75:1, disabled cream 5.03:1). Mobile headline/ring collision found + fixed (stage raised to -28vh, 58vw cap, stronger bottom scrim).
- **Hit targets**: all buttons/nav ≥44px; footer links given `::after` hit-slop (46px effective). In-paragraph Privacy link left inline (WCAG 2.5.8 inline exception).
- **Keyboard**: `.lp` scroller uses `scroll-snap-type: y proximity` (no trap); first Tab lands on in-scroller nav link, arrows/PgDn scroll; all interactive elements are semantic `<a>`/`<button>` with `:focus-visible` outlines.
- **Reduced motion**: `@media (prefers-reduced-motion: reduce)` kills all transitions/animations, reveals all panels, disables snap (static review; not yet OS-toggle tested).
- **Console**: clean (no errors/warnings).
- **Known gaps to close before merge**: OS-level reduce-motion toggle test; prod-build pass with service worker (unregister SW first per rule 7); Lighthouse on `npm run preview`; VoiceOver spot-check.

## 2026-07-17 — Phase 2.6 Package A: loan-type picker, entry-mode framing, return card (amending mo/phase2-loans-tab / PR #27)

Verified via isolated mock-mount (temporary `mockmount.html` + `src/mockmount-entry.jsx`, deleted before commit; no real Supabase session, `upd` a local no-op). Mock: legacy federal loan (two disbursements, one within its 120-day return window), an HPSL loan, a Grad PLUS loan (past its return window — correctly absent from the return-card list), two balance readings.

- **Type picker**: native `<select>` with 6 options (`LOAN_TYPE_OPTIONS`), fully keyboard-operable by default (no custom widget needed — HIG/a11y win over a 6-way segmented control, matches the implementation plan's stated reasoning). Selected value stays in sync with `loanTypeKey`/`pickerKeyFor` resolution across legacy and fresh loans.
- **Entry-mode `ChoiceGroup`**: two `radio`-role buttons ("My award letter…" / "My current balance on studentaid.gov"), roving tabindex, `aria-checked` state correct, matches the existing `TabBtn`/`YrBtn` convention. Clicking "My current balance" correctly switched the loan into as-of mode, auto-filled the balance from `loanPrincipal()` rounded to cents, and the debt-tile total recomputed live (verified: $80,865 → $79,862 after the switch, matching the expected small reduction from losing ~15 months of not-yet-elapsed interest on the second undisbursed-until-January part).
- **HPSL banner**: `Banner type="info"` renders correctly under the type picker only when `subtype` is in the HPSL family; text passes the plain-language check (no "capitalization"/"deferment" jargon).
- **Return-window cards**: both open windows rendered (80 days left / 30 days left), correctly excluded the Grad PLUS loan (disbursed >120 days ago). No fabricated dollar-savings claim shown in this mock scenario since only 2 readings existed and the burn/next-refund path needs `data.years` refund estimation to resolve a next-refund date — confirmed this degrades gracefully to window-only copy rather than showing a wrong number, per design.
- **Contrast**: dark theme confirmed on first render. Light theme initially looked like a real contrast bug (cream/near-white text on a light card) — traced to the mock harness setting `data-theme="light"` directly without calling the app's `applyTheme()`, which is what actually mutates the live `C` token object the components read (`theme.js`: "C mutates in place via applyTheme so all imported refs stay live"). Re-verified correctly by seeding `localStorage` (`marro_theme_v2`, `marro_v8.darkMode:false`) before a fresh load so the pre-paint guard set `data-theme` and `applyTheme()` ran in the normal boot order — light theme renders with correct contrast throughout. **Not a real app bug** — a mock-harness-only artifact; noting it here so a future mock-mount pass doesn't waste time on the same false alarm.
- **Console**: clean, no errors, both themes.

## 2026-07-17 — Phase 2.6 Package A (A4): Runway tile "Growing" → cushion-source split (amending mo/phase2-go-live / PR #30)

The Runway header tile's `growing` state now reads "Building a cushion ✓" (green) only when the surplus traces to the student's own non-loan money; when it traces to unspent loan money (or is ambiguous) it reads "Extra loan money — you may be able to return some — see your Loans tab" (blue `C.blue`, info, never green). Blue/green are the app's existing colorblind-safe pair and the copy itself carries the distinction (never color alone), satisfying rule 7. Verified via mock-mount alongside the return-card check (see the A1–A3 entry above): drove a `growing`-state mock with (a) loan-only inflow → blue "Extra loan money" tile, and (b) a no-loans / own-income mock → green "Building a cushion ✓". No console errors, both themes.

## 2026-07-19 — Light-theme `neg` token contrast fix (branch `mo/light-neg-contrast`)

Pre-existing AA failure found during the mo/copy-clarity numeric contrast pass: light theme's `neg` (#9C6A00) used as text failed 4.5:1 against every background it actually sits on. Ratios computed with exact WCAG 2.1 relative-luminance math including alpha compositing of the real surface stack (negLight tint over glassCard over page bg), then confirmed against live rendered DOM (dev harness `?mock=1`, light theme).

**Before (#9C6A00)** → page bg 3.90 · card 4.22 · negLight-over-card 3.74 · negLight-over-page-bg 3.47 — all four contexts below AA.
**After (#805700)** → page bg 5.31 · card 5.75 · negLight-over-card 5.10 · negLight-over-page-bg 4.73 — all pass with margin. Dark theme's `neg` (#E5A23E) already passed (5.53 on its worst stack) and is unchanged; `negLight`/`negMid` tints unchanged in both themes.

- Bonus fix: WeeklyTab's over-budget "Got it" button (`background:C.neg, color:C.bg`) label was also failing in light (3.90) → now 5.31.
- Downstream check of every light-theme `C.neg` text usage (BudgetTab summary/deficit banner, AidTab table + 4-year net box, WeeklyTab week stats, SavingsTab recommendations, ChartsTab trend labels, SubscriptionsTab total, onboarding error, App sync-conflict chip): worst-case background is the negLight-over-page-bg banner, which now passes; all others sit on lighter surfaces (higher ratios). Chart bar/gradient fills using `C.neg` are graphical objects (3:1 floor) — darker fill only increases their contrast on light surfaces.
- Note: LoansTab's rate-too-high warning uses `C.amber` (#7A5A0D, ~4.7 worst case), not `neg` — unaffected, passing.
- Visual verify: Aid & Detail tab rendered in light theme via `?mock=1` (Year 2–4 deficit rows, 4-year overview table, "4-year net: -$102,040" negLight box) — legible, hue still reads amber vs the blue positives, signs/labels still carry meaning (color never sole signal). Dark theme screenshots unchanged.
- Known cosmetic gap (pre-existing, both before and after): `negMid` border on negLight banners is ~1.4:1 vs card — decorative border on a text-carrying banner, not a UI component boundary; logged here so it isn't re-flagged.
- Follow-up harness pass (2026-07-19, `?mock=1`, both themes): drove a real deficit (Personal 200→2000) — BudgetTab's `-$1,588/mo` surplus, over-budget banner (neg on negLight), "Negative" health Pill, and the Actual chart bar all render the new #805700 in light (computed styles confirmed) and the unchanged #E5A23E in dark; AidTab deficit table + 4-year net box re-verified in both themes; LoansTab private-loan 25% rate triggers the "seems high" `role="alert"` warning (amber, passes). Note: Weekly/Charts/Savings/Subscriptions/Categories tabs are currently feature-flagged off (`HIDDEN_TABS`), so their `neg` usages (incl. the WeeklyTab "Got it" button) are unreachable in-product today — they inherit the fixed token when revived. Onboarding save-error text and the App sync-conflict chip can't be triggered in the mock; both are math-verified ≥5:1.
