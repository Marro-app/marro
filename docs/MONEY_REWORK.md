# Money Rework — Design & Build Plan

**Branch:** `mo/ux-batch-preview` · **Status:** design locked (2026-07-28), building.

Founders drove this in a long design session. The money side of the app was confusing:
the same dollar figure showed up on several screens under different names, and a student
couldn't tell which number was "the answer," what to do first, or what to do after
entering something. This doc is the single source of truth for the rework. **All money
math is isolated in `src/lib/aid.js` and `src/lib/loans.js` under Vitest**, so the screens
can be rearranged and the divisor changed without touching untested arithmetic.

---

## 1. The organizing idea

A student has **three questions** and gives us **two recurring inputs**. Everything on
screen should be one of these five things, shown once:

| | |
|---|---|
| Q1 | How much can I spend this month? |
| Q2 | Will my money last — and until when? |
| Q3 | What will I owe when I'm done? |
| In 1 | My plan (set once a term) |
| In 2 | My balance (checked once a month) |

Today the app answers Q1 in four places under three names, and buries In 2 at the bottom
of the Loans tab. The rework gives each of the five exactly one home.

---

## 2. Header — always *today*, two tiles

- **Two tiles only:**
  1. **Safe to spend** — this month, balance-anchored, sub = "as of your Jun 26 check-in."
  2. **Lasts until** — a date (or "Graduation"), sub = "$X in your accounts."
- **Debt tile moves to the Loans tab.** It's already the headline there, it's a lifetime
  figure, and it never changes month to month — it doesn't belong in a row about *this month*.
- **Year selector stays where it is, and now controls the whole screen** (both tiles and the
  tab content below). Pick a year, everything on screen is that year — the tiles can never
  disagree with the selector.
  - Current year → real, balance-anchored numbers.
  - A future year you're peeking at → that year's **planned** figures, clearly labeled
    "planned" (you have no real balance for a year that hasn't happened).
- **Final-month guard (fixes bug B3):** when there is ≤ 1 month left in the year, "Safe to
  spend" reframes to **"Left for the rest of the year"** with no misleading `/mo` and no
  meter maxed against a whole-year lump. The Budget *row* already does this; the header tile
  and the "Monthly plan" ceiling must too.

---

## 3. Tabs — renamed and reordered

Order and names: **Budget · Plan · Loans** ("Aid & Detail" → **Plan**).

### 3a. Budget tab — do-this-first order

1. **Check-in** (promoted from the bottom of the Loans tab). When a check-in is due, the
   full card is first. When it isn't, it shrinks to one line: *"Balance Jun 26 · $5,950 · Update."*
2. **Safe to spend** — the answer, with a "How is this worked out?" disclosure
   (money on hand + still to arrive ÷ months left) and the year-end "Projected leftover" line.
3. **Monthly plan** — the editable category card (unchanged), with the gap line directly
   beneath it: *"Your plan uses $3,105 of $9,400. Left over: $273 — this is borrowed."*
4. **Plan vs actual**
5. **Health checks**

- **The "Cash flow" card is deleted.** Its six rows were two duplicates, one header-repeat,
  and figures that belong next to the plan or on the Plan tab.
- **Saving a check-in gives feedback:** *"Saved. Your money now lasts to May 12 — 6 weeks
  earlier than your plan."* — instead of silently rewriting a tile up top.

### 3b. Plan tab (was "Aid & Detail")

Where per-year money is entered and the multi-year picture lives.

- Per-year card: grants, tuition, health insurance, other income, housing, dates; a
  read-only Loans line linking to the Loans tab.
- **Two-fund display per year** (§4): the school-year fund, and — only when there's an
  uncovered summer — a **summer card**.
- Naming pass (§5).
- Date fixes: non-overlapping year generation (B2); the final year ends at graduation with
  no trailing summer.

### 3c. Loans tab — debt only, collapsed rows

- **Debt-at-graduation is the headline here** (the header tile is gone).
- **Each loan collapses to one line** — *"Year 1 federal — $41,000 borrowed · $53,415 at
  graduation ⌄"* — expanding to the existing full form on tap. A loan missing a rate or date
  auto-expands so nothing incomplete hides.
- **Return-window guard (fixes bug B1):** only show "N days left to return" for
  disbursements dated **on or before today** — never for money that hasn't landed.
- The balance check-in card moves out (now on the Budget tab).

---

## 4. The two-fund school-year / summer model

The core money change. Lives in `src/lib/aid.js`.

### 4a. School-year fund

Each year's aid (`grants + loan cash − tuition − health`) is divided over the **actual
school months** — from the year's start to the date its aid is meant to last through
(classes-end / "aid covers through," user-editable, sensibly pre-filled) — **not a flat 12.**

This is the correction that makes Cornell right: Cornell aid covers ~Aug–May, so dividing
over ~9 months gives the true monthly figure during school, instead of a too-low number that
also pretends the summer is funded.

### 4b. Summer fund — separate, and *conditional*

- **The summer card appears only when there's a real gap** — i.e. when a year's covered
  period ends before the next year starts. If coverage runs the full 12 months to the next
  year (a 12-month school, or an MD-PhD funded year), **no gap, no card.** The final year
  ends at graduation, so it has no trailing summer either.
- **The card is guidance-on-demand, not a warning.** We do **not** tell a student they're
  "not funding summer" or how much to save. Instead, once they enter their summer details,
  the card computes **"about $X/month for the summer"** from their own school-year monthly
  plan (adjusted for summer rent). No nag; the summer's funding status is not surfaced as an
  alert anywhere in the main flow.
- **Inputs on the card:**
  - **Summer rent** — pre-filled with school-year rent, editable (go home → $0; away
    rotation → higher / two rents). This is the cost line that swings most.
  - **Your summer** — paid research / job / unpaid / off, etc. (friendly framing).
  - **Summer income, with timing:**
    - a **stipend** → amount + the date(s) it lands (1–2 lumps; reuses the loan-disbursement
      mechanism, so a July-1 stipend correctly can't cover June rent);
    - a **wage/job** → "about $X a month" over the summer window (a steady rate; biweekly is
      smoothed to monthly — a few days' error, not worth entering each payday).
    - Ask for **take-home pay**, not gross.
  - **Extra one-off summer costs** (move-in deposit, first month in a new city) → the
    existing extra-expenses/fees mechanism, not a new concept.

### 4c. Routing rule

Money is assigned to a fund by its **date**: a disbursement or stipend dated in the school
window feeds the **school-year fund**; one dated in the summer window feeds the **summer
fund**. So "borrowed extra for summer research" is just a loan entered on the Loans tab with
a summer date — it routes to summer automatically, no new UI.

### 4d. Checking & savings

- **Checking** ("spendable" on the check-in) = the money you live off in the period you're
  in. Drives day-to-day "safe to spend" and "lasts until."
- **Savings** = the student's own reserve/cushion (emergency, Step fund, whatever they set
  aside). It is **NOT** the summer fund. The summer fund is computed independently (§4b)
  from summer income + summer loans entered in Aid & Plan / Loans — never carved out of
  savings. Savings is shown as a cushion "on top" (as the runway tile already does), and we
  don't build a savings tracker or raiding alarm around it.
- Moving checking → savings is a transfer, not spending — already handled (pace uses the
  total of both).

### 4e. No-aid / self-funded degrade

When little/no aid is entered (career-changer on savings, full-ride with no loans), the plan
math (aid ÷ months) is meaningless. Instead of a hollow "$0/mo" or a scary "you're $3,000/mo
short," the app leans entirely on the check-in: safe-to-spend = actual balance ÷ months left,
lasts-until = real pace. The aid-projection scaffolding recedes; the check-in becomes the main
event. (This is the existing `basis: 'projection' | 'balance'` switch, made to pick the
graceful branch when aid ≈ 0.)

### 4f. Missed check-in across the school→summer seam

Primary fix: **prompt a check-in right at the school→summer handoff** (this *is* the
summer-entry check-in). A clean reading on the seam splits any long gap that spans it. If the
student skips even that, we **don't guess the split** (no shaky numbers) — we show the honest
blended pace and note it covers both. The headline "how long does it last" stays correct
regardless, because it's anchored on the real balance.

---

## 5. One name per number

| The number | Name everywhere | Retire |
|---|---|---|
| Aid reaching the account | **Sent to you** | "You keep", "Aid and loans sent to you" |
| Spendable this month, balance-anchored | **Safe to spend** | "you can spend"; keep "Left for the rest of the year" *only* as the final-month relabel |
| A year's aid ÷ school months, for a year you aren't living in | **Planned per month** | **"Safe to spend" on the Plan tab** (the collision) |
| Plan total | **Monthly plan** | "Budget/mo" |
| Plan-vs-money gap | **Left over** / **Short** | "Surplus/mo" |
| Cash in the account | **Money on hand** *(currently unnamed)* | — |
| Summer cost per month | **Summer costs** | — |

---

## 6. Bugs fixed in this pass (verified end-to-end in the audit)

- **B1** — `loanReturnWindows` (`loans.js`) shows "N days left to return" for future-dated
  disbursements. Add a `date ≤ today` guard.
- **B2** — `generateYearConfigs` (`format.js`) emits overlapping years (`…-08-01 → …-08-15`,
  next starts `-08-01`), tripping the Aid tab's own overlap error on generated data. End each
  year the day before the next starts.
- **B3** — final-month "Monthly plan" ceiling (`planBase`) presents a whole-year lump as a
  monthly figure on the header tile + Budget row. Apply the same final-month reframing the
  "Safe to spend" row already uses.
- **C1** — header tiles following the selected year is now *intentional* (whole screen follows
  the selector); verify the "planned" labeling covers every future-year case.

---

## 7. Build sequence

Foundation and bug fixes first (safe, isolated, testable), visible UI surgery after — each
phase ADA-checked (both themes, keyboard, contrast ≥ 4.5:1) and visually verified on
localhost:3456 before moving on.

1. **Math foundation** (`aid.js` / `loans.js` + tests): school-months divisor, summer-fund
   calc, date-based routing, summer-gap detection, no-aid degrade. No UI.
2. **Independent bug fixes**: B1 return-window guard, B2 non-overlapping generation, final
   year ends at graduation. Small and shippable.
3. **Header**: two tiles, selector controls the whole screen, final-month guard (B3), debt
   tile removed.
4. **Budget tab**: check-in promoted, Cash flow deleted, reorder, save-feedback.
5. **Plan tab**: rename, two-fund display, conditional summer card, naming pass.
6. **Loans tab**: collapse loan cards, debt headline, remove check-in.
7. **Naming sweep** across all surfaces (§5).
8. **Full ADA + visual pass**, both themes, keyboard-only, axe.

## 8. Explicitly out of scope (named, not forgotten)

- Post-graduation / residency (the M4→residency move, the final summer). Final year ends at
  graduation; nothing beyond.
- M4 interview-season cost spikes.
- Reviving the full Savings-goals system for the summer fund (could connect later).
- Leave-of-absence / dedicated research years (the add-a-year stepper covers the structure).

---

## 9. Build status & handoff (updated 2026-07-29, branch `mo/ux-batch-preview`, all UNCOMMITTED)

Everything below is done on disk (not committed/pushed). `npm run build` clean, mock stripped
from `dist/`, **327 tests green**, lint 0 errors (pre-existing warnings only). Verify anything
in-browser at `http://localhost:3456/?mock=1` (resize the pane to ~1280px wide to see the real
2-column desktop layout — the pane defaults narrow).

### DONE & verified
- **B1** — `loanReturnWindows` future-dated guard (`d.date <= today`) + tests.
- **Math foundation** (`src/lib/aid.js`, `src/lib/format.js` + tests): new per-year
  `aidThroughDate` (null = full-year, backward-compatible ÷12); `schoolMonths`,
  `summerWindow`, `summerFundNeed`, `summerResources`, `summerShortfall`,
  `routeLoanCashBySummer`, `hasAid`/`selfFunded`. **B2** (non-overlapping `generateYearConfigs`,
  years now `…-08-01 → …-07-31`) + final-year-ends-at-graduation.
- **Tab rename** "Aid & Detail" → **"Aid & Plan"**.
- **Header → three tiles** (replaced Monthly-plan + Debt tiles; debt lives on Loans tab).
  `HeaderTile` component at module scope in `src/App.jsx`. The three answer the founder's
  three questions: **Safe to spend** (this month, checking-anchored), **By end of year**
  (plan surplus/short, `curYrNet`), **Compared to your plan** (on-track, `runway.actualPace`).
  Follows the year selector (future years labeled "planned"). Dry-spell/overdrawn warning is a
  current-year-only banner below the tiles. Copy made first-timer-clear.
- **Savings excluded from Safe to spend** — `availableMoney` `onHand` is now CHECKING only;
  `savings` surfaced separately as a cushion (aid.test.js updated).
- **Budget reorg** — check-in moved to the BOTTOM of the tab (founder call), Cash-flow card
  deleted, per-month "left over / over plan" note folded under the Monthly-plan card.
  `BalanceCheckin` extracted to `src/components/BalanceCheckin.jsx`.
- **Loans tab** — every loan card collapses to a one-line summary with a chevron
  (per-card local `open` state; incomplete/estimate loans default open but stay collapsible,
  showing inline amber "· estimate / · needs details", no extra height). Grid replaced with a
  **CSS multi-column masonry** (`columnWidth:320`) so cards pack and reposition — no dead gap
  beside a tall expanded card. Add-loan button is full-width below.

### DONE (2026-07-29) — Option-3 header (calm tap-to-expand tiles)
`HeaderTile` in `src/App.jsx` rebuilt: collapsed = 11px label + big number + ONE glance
(Safe to spend → wallet + "from checking"/"planned figure"; By end of year → ↑/↓ + "left
over"/"short on your plan"; Compared to plan → ↑/↓ + "money lasts longer"/"spending faster",
or "on your plan"/"check in to compare"/"for your current year"). Chevron on each, no "i".
Tapped open = the full panel (replaces the glance): tile 1 → checking-vs-savings split bar +
`TileRow` figures (checking / aid still to arrive / savings kept aside) + check-in date +
school-year note; tile 2 → "finish with $X to spare / $X short" + borrowed·returnable chip +
"forecast not bank balance" caveat; tile 3 → `MiniRing` (actual÷expected) + "plan expected
~$X, you checked in $Y" + lasts-longer/spending-faster line. Independent expand; each face is
a real `<button>` (`aria-expanded`/`aria-controls`, ≥44px, global `:focus-visible` ring);
reveal uses the shared `.collapse-panel` grid-rows animation (snaps under reduced-motion).
Tile bg/border now use glass tokens (`C.glassCard`/`C.borderDark`) — light theme fixed.
Row `alignItems:flex-start` so an open tile doesn't stretch its neighbours. New icons
`wallet`/`arrowUp`/`arrowDown` + `TileRow`/`MiniRing` helpers. Verified both themes at 1280px.
327 tests green, build clean, lint 0 errors.

### DONE (2026-07-29) — B4: phantom summer income in year-end net / running balance
Found while double-checking the header math. §4a made `moSpendable` = year money ÷
**school months** (e.g. ÷10 for a Jul→May year), but `curYrNet` ("By end of year") and
`runningBalance` still summed it over a flat **12** months — crediting a full month of income
for the ~2 unfunded summer months the aid never covers. For a $23,222/10-month year that
invented **+$4,644** of fake surplus (headline read +$6,354 instead of ~+$1,710); the Charts
bars inherited it too. Fix: new tested `coveredMonthIndices(year, yearStartYear)` in `aid.js`
(which academic months fall in the coverage window; all 12 for a normal Aug→Jul year, so it's a
no-op on existing/mock data). `monthNetFor` in `src/App.jsx` now spreads the **true annual**
`sentToYou + otherIncome` over the funded months only and returns 0 for unfunded summer months
— summer belongs to the summer fund (§4b), founder chose "school year only". +4 tests (331 green).

### DONE (2026-07-29) — rent clarity across the three surfaces (founder ask)
Rent was counted every month in the Budget but invisible on the aid summary, and the
aid card annualised "Other income (monthly)" into Safe-to-spend while ignoring "Housing
(monthly)" — so it read as if rent wasn't counted. Not an arithmetic bug; a clarity gap.
Fixes: (1) **Aid & Plan year card** — new **"Left after rent"** line under Safe-to-spend
(= moSpendable − housing/mo), with an InfoTip spelling out rent × school months.
(2) **Safe-to-spend header tile** — collapsed glance now says **"before rent"**; expanded
panel adds "This is your whole month's money — rent and everything else come out of it."
(3) **Budget** — the Total note is now always-shown and leads with the live **"$X left to
spend"** running tally (verified it moves as categories are edited).

### DONE (2026-07-29) — "Compared to your plan" empty-state copy
Founder saw "—" after checking in five times — all on the same day, which `normalizeReadings`
collapses to one reading, so there was no spaced-out history to measure a pace from (needs two
check-ins ≥7 days apart). Not a bug; the old copy ("check in a couple of times") just misread as
broken to someone who had. Copy now branches on `safeToSpend.basis==="balance"`: if they've
checked in, it says "need two check-ins on different days, about a week apart — several on the
same day count as one; check in again in a few days." (Separately noted: the ≥14-day 'growing'
early-return in `computeRunway` skips `actualPace`, so a rising balance also blanks the tile —
left as-is for now; revisit if it bites.)

### DONE (2026-07-29) — "Compared to your plan" tile hardening (3 fixes)
- **Growing balance now reads "ahead"**: `computeRunway` (`loans.js`) built `actualPace` AFTER
  its two `growing` early-returns, so a rising balance blanked the tile. Hoisted the calc above
  those returns and included it in both — a rising balance is the clearest "ahead". +test.
- **Non-empty empty-state** (founder ask): no-pace tile no longer shows a lonely "—". It now
  shows **"Check in"** (teal) + a glance ("to see if you're on track" / "again in about a week")
  and a panel pointing to the check-in at the bottom of the Budget tab.
- **De-duped check-in history**: `BalanceCheckin` "Past check-ins" now renders via
  `normalizeReadings` (one row per date, latest wins) — five same-day check-ins showed five
  identical rows but count as one for the math.

### THEN (remaining, in order)
1. **Summer card** on Aid & Plan (§4) — the last new feature. Needs a persisted per-year summer
   shape (rent, situation, income lumps/wage) + merge-engine entry; the pure calcs already exist.
   Card appears ONLY when `summerWindow` returns non-null (a real gap).
2. **Cleanup**: dead `runwayTileDisplay` + `cushionSource` in `src/App.jsx`; `leanPlan`/
   `yearEndMonth` unused in `src/tabs/BudgetTab.jsx`.
3. **Naming sweep** (§5) across all surfaces.
4. **Commit + push** `mo/ux-batch-preview` for a Vercel preview (ask founder first).
