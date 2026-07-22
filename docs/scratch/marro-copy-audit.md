# Marro — UX Copy & Clarity Audit

**Auditor persona:** first-year med student, never had a loan, doesn't know what interest / principal / disbursement / APY mean, anxious about money, skimming on a phone between classes. Every string is read in her head, asking: "do I understand this instantly, without feeling stupid — and do I need it right now?"

**Standards audited against:** the two banned-jargon tables in `money-plan-phase2.6-design.md`; "every number carries its meaning in the same breath"; no overwhelm (≤~3 visible fields per card, one idea per screen, one primary action, teaching empty states); DATA_ETHICS benefit language; calm, never alarmist, never shame.

**Method:** branch `mo/dev-test-harness`, dev server on `localhost:3457/?mock=1` (3456 was already in use), driven with the Claude Browser. Walked header + tiles, Budget, Aid & Detail, Loans (incl. empty state, pickers, entry-mode toggle, More-options disclosure, HPSL banner, reminder banner), balance check-in, Settings menu, Categories modal, Quick add modal.

**Severity key:** **HIGH** = jargon-table violation or comprehension blocker · **MEDIUM** = unclear/cluttered but guessable · **LOW** = polish.

**Scope note — what was NOT reachable in this mock/branch:** the whole Phase 2.6 "Money Plan" surface (savings park-vs-checking chart, the paycheck read-out, the persistent 120-day return card, the Playbook "See my Money Plan" card, the loan-vs-own-money Runway split, the big-costs/COA-increase tip) is **not built on this branch** — those specific items in the brief could not be audited because they don't render. Only one Runway state (positive, "lasts until ~Apr 22") was reachable. The onboarding / setup-money step is not reachable in `?mock=1` (boots straight into the signed-in app).

---

## The headline finding

**The single banned word "disbursed / disbursement" appears in 5 distinct places** across three surfaces. The jargon table's very first row is *never "disbursement" → say "when the money arrives."* This was an explicit acceptance criterion, so every instance is a miss from the earlier copy pass. Notably, the loan **Status dropdown got it right** ("Money received", even though the internal value is `disbursed`) — so the fix is just making the rest of the app match that one good decision.

---

## Screen 1 — Header + tiles

_Verdict: **needs work** (mostly clean; one metaphor + one alarm risk)_

| # | Location | Current text (verbatim) | Problem | Proposed rewrite | Severity |
|---|---|---|---|---|---|
| 1.1 | Runway tile label | `RUNWAY` | "Runway" is a startup/aviation metaphor. A scared M1 doesn't know it means "how long your money lasts." The subtext ("lasts until ~Apr 22") rescues it, but the headline word is opaque. | Keep the tile, rename the label to `MONEY LASTS` (or `HOW LONG IT LASTS`). Leave the "lasts until ~Apr 22" subtext. | MEDIUM |
| 1.2 | Runway subtext | `+$3,150 set aside in savings` | Good — but "set aside in savings" reads like the app is holding it. Minor. | Fine as-is; optionally `+$3,150 you've set aside` | LOW |
| 1.3 | Monthly plan tile | `incl. $15 fixed costs` | "fixed costs" is mild jargon; guessable. | `includes $15 in subscriptions` (matches the "Subscriptions" category the $15 comes from) | LOW |
| 1.4 | Greeting | `Your money's been patient, Test Student.` | Warm but slightly opaque — "patient" money is an odd image on first read. Not harmful. | Leave it (it's voice, see GOOD list) | LOW |

---

## Screen 2 — Budget tab

_Verdict: **needs work** (one HIGH jargon hit; recurring "surplus"; right column is dense)_

| # | Location | Current text (verbatim) | Problem | Proposed rewrite | Severity |
|---|---|---|---|---|---|
| 2.1 | Cash flow card | `Total aid disbursed to you` | **Jargon-table violation** ("disbursed"). The #1 banned word. | `Money sent to you for living costs` | **HIGH** |
| 2.2 | Cash flow card | `Monthly spendable` `$3,317/mo` | "Spendable" is a coined word; carries a number so it's guessable, but the persona pauses. | `Money you can spend each month` (or keep "spendable" but only if defined once) | MEDIUM |
| 2.3 | Cash flow card | `Monthly surplus` `+$212/mo` | "Surplus" is an accounting word. It recurs 4× in the app (see 2.4, 3.x). The persona doesn't reliably know surplus = leftover. | `Left over each month` `+$212/mo` | MEDIUM |
| 2.4 | Cash flow banner | `Planned surplus if you stay on budget · through July` `+$2,540` … `$212 surplus this month — it carries into your running balance and adds to your year-end net.` | Good instinct (qualifier is present), but "surplus", "running balance", and "year-end net" stack three finance terms in two lines. | `Money left over if you stay on budget · through July` … `$212 left over this month — it adds to your total for the year.` | MEDIUM |
| 2.5 | Health checks | `Housing ratio` `54%` `Target <60% of spendable` | "ratio" + "<60% of spendable" is mathy for a phone skim. | `Rent share` `54%` `Aim to keep rent under 60% of your monthly money` | MEDIUM |
| 2.6 | Health checks | `Exam fund` `$0/mo` `Steps cost ~$695 each` | "Steps" (Step exams) reads oddly plural/unclear to an M1 who hasn't hit boards. | `Step exams cost about $695 each` | LOW |
| 2.7 | Monthly plan card | `Set how much you intend to spend each month — log actual spending with Quick add.` | Good and plain. Keep. | — | — |

---

## Screen 3 — Aid & Detail tab

_Verdict: **needs work** (multiple HIGH jargon hits + a genuinely alarming un-reframed number + the densest screen in the app)_

| # | Location | Current text (verbatim) | Problem | Proposed rewrite | Severity |
|---|---|---|---|---|---|
| 3.1 | Info banner | `How your total aid works: Your total aid (including health insurance) − tuition & fees − health insurance = disbursed to you for living costs.` | **Jargon violation** ("disbursed") **and** an equation with a term that cancels itself (adds then subtracts health insurance) — confusing to read as a formula on a phone. | `How your aid works: your school takes tuition, fees, and health insurance out of your total aid first. What's left is sent to you for living costs.` | **HIGH** |
| 3.2 | Each year card, summary row | `Disbursed/yr` `$3,800` | **Jargon violation** ("Disbursed"), appears on all 4 year cards. | `Sent to you /yr` `$3,800` | **HIGH** |
| 3.3 | 4-year overview table header | `Disbursed/yr` | **Jargon violation** ("Disbursed") in a column header. | `Sent to you /yr` | **HIGH** |
| 3.4 | 4-year overview footer | `4-year net: -$102,040` | A **huge red negative number with zero reframing** — violates "calm, never alarmist." The persona skimming on a phone sees "-$102,040" and panics. "net" is also jargon. This is exactly where the design doc's COA-increase / "here's the legitimate lever" reframe belongs — but there's no calming sentence at all. | Reframe: `Over 4 years, you're projected to spend about $102,040 more than your aid covers — most students borrow to bridge this, and your aid office can help you plan for it.` (and drop "net") | **HIGH** |
| 3.5 | Overview table headers | `Spendable/mo` `Budget/mo` `Surplus/mo` `Cumulative` | "Surplus", "Cumulative" (and "net" above) are stacked jargon in one header row. "Cumulative" especially. | `Can spend /mo` · `Plan /mo` · `Left over /mo` · `Running total` | MEDIUM |
| 3.6 | Year-card badge | `-$3,138/mo` (top-right of card) | A bare number floating with no label — the persona can't tell if it's good/bad or what it measures. Violates "every number carries its meaning." | Add a tiny label: `$3,138/mo short` (or `over by $3,138/mo`) | MEDIUM |
| 3.7 | Total aid field helper | `Includes health insurance. May include loans you'll repay — loan tracking is coming soon.` | Fine and honest. Keep. | — | — |
| 3.8 | Health insurance helper | `school-covered, deducted from grant` | "deducted" + "grant" — mildly technical; the Categories "Key notes" version says it better ("comes out of your grant before it reaches you"). | `taken out before the money reaches you` | LOW |

---

## Screen 4 — Loans tab

_Verdict: **mostly clean** — strong plain-language work here; two issues (one duplicate banner, one dense stack). No jargon-table violations in the loan editor itself._

| # | Location | Current text (verbatim) | Problem | Proposed rewrite | Severity |
|---|---|---|---|---|---|
| 4.1 | Refund banners | Top: `Did your spring refund land? Update your balance to see the full picture.` — AND inside Loans: `Did your spring refund land? Update your balance below to see the full picture.` | **Two near-identical refund banners visible at once** on the Loans tab — redundant clutter, and both compete with the actual loan task. | Show only one (the tab-level one, since it says "below"); suppress the global banner while its tab-level twin is on screen. | MEDIUM |
| 4.2 | Graduation card | `What you'll owe at graduation, interest included` `$62,480` | Excellent — plain, and the number carries its meaning. Keep. | — | — |
| 4.3 | HPSL banner | `Interest-free while you're in school and during residency — this loan doesn't start growing until you begin paying it back.` | Excellent — reassuring, plain, correct. Keep. | — | — |
| 4.4 | Type picker | `School health-professions loan (HPSL / Primary Care / LDS — often 5%)` | Leads with a plain phrase; acronyms are parenthetical clarifiers. Acceptable, but "HPSL / LDS" is noise to the persona. | Optionally trim to `School health-professions loan (often around 5%)` | LOW |
| 4.5 | Entry-mode toggle | `What are you looking at?` / `My award letter (amount offered/borrowed)` / `My current balance on studentaid.gov` | Clear and well-scoped. Keep. | — | — |
| 4.6 | Amount helper | `Amount you borrowed that year — the original amount, not today's balance` | Good — heads off the exact confusion the persona would have. Keep. | — | — |
| 4.7 | "Don't have your numbers?" helper | `Log into studentaid.gov → Dashboard → click a loan for its exact amounts, dates, and rate. Private loans: check your lender's site.` | Genuinely helpful, correctly folded as helper text. Keep. | — | — |
| 4.8 | Money-arrives helper | `Money usually arrives in two parts — fall and spring:` | Plain-language win (this is the approved replacement for "disbursement"). Keep. | — | — |
| 4.9 | More-options fee field | `Fee, as a percent (leave blank to use the ~1% fee the government takes off the top — we've included it)` | "takes off the top" is nicely plain, and it's correctly folded behind "More options." Keep. | — | — |
| 4.10 | Status dropdown | `Offered to me (haven't accepted yet)` / `Accepted (money on the way)` / `Money received` | **This is the model to copy.** Internal value is `disbursed`, but the label says "Money received." Every other "disbursed" in the app should match this. Keep. | — | — |
| 4.11 | Empty state | `Loans are money you'll pay back after school. Most students take one per school year — add yours and Marro tracks what they'll really cost.` | Textbook good empty state — teaches in one sentence, no shame, "most students" framing. Keep. | — | — |
| 4.12 | Reminder banner | `Add your loans so Marro can show what you'll really owe at graduation — interest included.` `[Remind me later] [Don't show again]` | Clear, calm, dismissible. Keep. | — | — |

---

## Screen 5 — Balance check-in

_Verdict: **clean**_

| # | Location | Current text (verbatim) | Problem | Proposed rewrite | Severity |
|---|---|---|---|---|---|
| 5.1 | Prompt | `About how much do you have available for living costs right now?` | Plain, low-pressure ("about how much"). Keep. | — | — |
| 5.2 | Reassurance | `No bank login, no linking accounts — just the number you see when you check your balance.` | Excellent — directly answers the anxious "do I have to connect my bank?" fear. Keep. | — | — |
| 5.3 | Fields | `Available to spend` / `Set aside in savings (optional)` | Clear, and "optional" is honest. Keep. | — | — |
| 5.4 | Past check-ins | `Jul 16, 2026 — $5,950 + $3,150 savings` | Clear. Keep. | — | — |

---

## Screen 6 — Settings menu, Categories modal, Quick add modal

_Verdict: **clean**, with one jargon leak in Categories → Key notes_

| # | Location | Current text (verbatim) | Problem | Proposed rewrite | Severity |
|---|---|---|---|---|---|
| 6.1 | Categories → Key notes | `Your grant this year is $42,000. After $34,000 tuition & fees and $4,200 health insurance, $3,800 is disbursed to you — about $3,317/mo…` | **Jargon violation** ("disbursed"). | `…$3,800 is sent to you — about $3,317/mo for rent, food, transport, and everything else.` | **HIGH** |
| 6.2 | Categories → Key notes (health) | `Your health insurance ($4,200/yr) comes out of your grant before it reaches you — it's already accounted for, not part of your living budget.` | Excellent plain explanation — this is the phrasing 3.8 should borrow. Keep. | — | — |
| 6.3 | Categories → Key notes (exams) | `Your Step exams will run about $4,100 total and aren't auto-covered. Add an exam budget line so you're ready when they come.` | Clear and calm. Keep. | — | — |
| 6.4 | Settings menu | `Categories · Light mode · Reset defaults · Export my data · Send feedback · Delete my account · Sign out` | Clean; destructive items are visually separated. Keep. | — | — |
| 6.5 | Quick add modal | `Category · Amount ($) · Date · Note (optional) "e.g. Textbook, flight" · [Add expense]` | Clean, one primary action, ≤4 fields. Keep. | — | — |

---

## (1) The 5 changes that matter most

1. **Kill every "disbursed."** Replace all 5 instances with "sent to you" / "money sent to you for living costs" (2.1, 3.1, 3.2, 3.3, 6.1). This clears the single biggest acceptance-criterion miss and makes the app consistent with its own good Status dropdown.
2. **Reframe the `-$102,040` "4-year net."** (3.4) A giant un-explained red number is the most alarmist thing in the app and directly violates "calm, never alarmist." Add the "most students borrow to bridge this; your aid office can help" lever the design doc already calls for.
3. **Rename "Runway" → "Money lasts" (or similar).** (1.1) It's the first tile the anxious persona sees and the metaphor doesn't land.
4. **De-jargon the recurring "surplus / net / cumulative / spendable" family** to "left over / can spend / running total." (2.3, 2.4, 3.5) These repeat across three screens, so one glossary decision fixes many spots.
5. **Drop the duplicate refund banner on the Loans tab.** (4.1) Two identical prompts on one screen is the clearest visual-clutter fix in the app.

## (2) Clutter verdict per screen (what to FOLD / REMOVE, not just reword)

- **Header:** Clean. 3 tiles + 1 banner. No change.
- **Budget:** The **right-hand Cash flow column is overloaded** — 6 cash-flow rows + a banner + a "Plan vs actual" chart + 4 Health checks + a Planned-surplus block + Notes, all stacked and all full of numbers. **Fold the 4 Health checks behind a "Show health checks" disclosure** (they're diagnostics, not the main task). The left Monthly-plan card shows 8 category rows — acceptable for an editor, but that's the ceiling.
- **Aid & Detail:** **Densest screen in the app.** Each of 4 year cards exposes 6 editable fields (double the ~3 target), and then the **4-year overview table repeats the same data** in an 8-column grid. **Recommend: collapse each year card to a summary by default (expand to edit), and treat the overview table as the primary view** — right now the two compete and bury the persona in ~24 inputs + a 32-cell table.
- **Loans:** Each loan card is inherently long but well-organized (advanced stuff is correctly folded under "More options"). The only real clutter is the **duplicate refund banner** (remove one). Otherwise fine.
- **Empty loans / Balance check-in / Quick add / Settings:** Clean. Leave alone.
- **Mobile (375px):** could not force a true 375-wide render in this harness (the window resized but the page kept its desktop viewport), so this is reasoned, not visually confirmed: the **two-column Aid year cards and the two-column Budget layout will stack**, turning the already-dense Aid tab into a very long scroll of number inputs — the fold-to-summary recommendation above matters most on mobile.

## (3) Genuinely GOOD — do not flatten in a later fix pass

- Loan **Status dropdown** "Money received" (the correct handling of "disbursed").
- **Money-arrives** helper "arrives in two parts — fall and spring."
- **HPSL banner** "Interest-free while you're in school and during residency — doesn't start growing until you begin paying it back."
- Loans **empty state** "Loans are money you'll pay back after school…" — model empty-state copy.
- **Balance check-in** "No bank login, no linking accounts…" — nails the anxiety.
- **Graduation card** "What you'll owe at graduation, interest included $62,480."
- Categories **Key notes** health-insurance + Step-exam explanations.
- The **"most students…"** framing and dismissible, calm reminder banners throughout — DATA_ETHICS-compliant voice. Keep this register when rewording anything above.

## (4) Jargon-table violations found: **5**

All 5 are the same banned word, **"disbursed / disbursement"** (jargon table's first row), in these locations:
1. Budget → Cash flow: "Total aid **disbursed** to you"
2. Aid & Detail → info banner: "= **disbursed** to you for living costs"
3. Aid & Detail → each year card row: "**Disbursed**/yr" (×4 cards)
4. Aid & Detail → 4-year overview column header: "**Disbursed**/yr"
5. Categories → Key notes: "$3,800 is **disbursed** to you"

No APY, principal, or amount-borrowed=principal violations were found (the Money Plan/savings surface that would introduce APY is not built on this branch). "interest rate" / "interest-free" are the table's *approved* replacements, not violations.
