# Marro Design System

Single source of truth for visual decisions. Code lives in `index.html` (C token object ~line 400, CSS ~17–185).

## Concept
Warm financial almanac under iOS-26-style liquid glass. "Frosted glass over candlelight." Hero detail: **serif numerals (Newsreader) for all money**; Inter for UI chrome.

## Brand
- **Name "Marro"**: from "marrow" — vital core. Medical-adjacent without clinical feel; frames budgeting as protecting what's essential. Replaced "Ration"/"WCM Budget Planner" June 2026 (repo/URL rename deferred, no functional impact).
- **Logo — growth rings**: concentric circles (r 11/7.5/4, stroke 1.3, innermost at 0.7 opacity), marigold `#DDA528` dot at center (r 1.4), in a 26×26 viewBox. Metaphor: tree cross-section + histology slide. Header 28×28 in `currentColor`; app icon 56×56 rounded square, `#1E3A2F` bg, `#F6EFDD` strokes.
- **Wordmark**: "Marro" in Newsreader 500, 22px, letter-spacing 0.01em, cream on dark, right of the mark.
- **Red does not exist in this UI** as alarm: over-budget is signalled by warmth draining (low-tide `#7C8471`), never red. (Warm clay `#E08A6B` is reserved for destructive/danger affordances — see tokens.)

## Color tokens (C object)
| Token | Value | Use |
|---|---|---|
| `bg` | `#0b1611` | App background, dark text on filled teal/red buttons |
| `text` | `#F6EFDD` cream | Primary text |
| `gray` | `rgba(246,239,221,0.52)` | Muted text (min legible alpha — do not lower) |
| `teal`/`green` | `#62B58A` | Positive, surplus, additive primary actions |
| `red` | `#E08A6B` warm clay | **Danger only**: over-budget, destructive, errors. Never selection/active/decoration |
| `blue` | `#86B2CC` | Info banners/chips |
| `amber`/`marigold` | `#DDA528` | Wins, milestones, warnings. Never general chrome |
| `border` | `rgba(255,255,255,0.12)` | Hairlines |

Each hue has `*Light` (~0.16α bg) and `*Mid` (~0.35α border) variants.

### Semantic rules (hard-won — do not regress)
1. **Selection ≠ danger.** Active/selected state = cream: border `rgba(246,239,221,0.75)`, bg `rgba(246,239,221,0.14)`, text cream. (Year pills, week picker, active tab.)
2. **Filled buttons use dark text** (`C.bg`), never `#fff` (fails contrast on teal/clay).
3. Additive actions (Add/Log/Import/Save) = filled `C.teal`. Destructive (Remove/Reset/Delete) = clay ghost (`redLight` bg, `redMid` border, `red` text) in confirmations; filled clay only for low-stakes reversible removes.
4. Disabled = `C.surface` bg + `C.gray` text + `cursor:not-allowed`. Every submit is disabled-until-valid — no silent `return` on click.
5. Color is never the only signal: pair with labels, chips (`Pill`), +/− signs, % values.

## Charts
`CHART_COLORS` ordered so no two neighbours share a hue family:
`#62B58A, #DDA528, #86B2CC, #7C8471, #B6C7AE, #C8A84B, #4A9068, #F6EFDD, #5A9A72, #8FB89A`.
All Recharts `<Tooltip>` use `separator=": "` + `glassTooltip` background. Area-chart `dot` renderers must read `p.payload.<key>` (Recharts passes `value` as an array for areas).

## Money formatting
- `fmt` — whole dollars, **plans/budgets only** (integers by construction)
- `fmtA` / `fmtSA` — actual money (entries, totals, imports): shows cents when present, never rounds real transactions
- `fmtD` — always 2 decimals
Rule: a number the user typed or a bank reported must never display rounded.

## Typography
- Newsreader 400/500 (real 600/700 loaded): money, wordmark, MetricTile values
- Inter 200–500: everything else
- Offline PWA: fonts must be self-hosted before adding any new family

## Glass surface recipe
`backdrop-filter: blur(22px) saturate(1.35); background: rgba(246,239,221,0.13); border: 1px solid rgba(255,255,255,0.22); border-radius: 24px`. Card top accent (`accent` prop, 3px) must encode meaning (e.g. surplus teal / deficit clay on Aid year cards) — never decoration.

## Layout
- Page-level grids: `repeat(auto-fit, minmax(min(100%,300px),1fr))` — never hard `1fr 1fr`
- Card header rows that hold pills/buttons: `flexWrap:"wrap"` so controls never overflow the card
- Tab bar `<600px`: scrolls with right-edge mask fade, hidden scrollbar (`.tabbar`)

## UX copy
- Sentence case everywhere; em-dash asides; second person ("your grant")
- Pluralize all counts (`n===1?"entry":"entries"`)
- Year ranges with apostrophes: `Aug '26 – Aug '27`
- Empty states teach the next action ("No entries yet — log your first expense above.")
- Errors: inline `role="alert"` boxes (clay tint), never `alert()`; say what to fix
