# UI Audit Log

Newest first. One line per finding: severity · what · fix.

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
