# Marro Phase 2 Break-Testing Findings — 2026-07-18

Harness: `mo/dev-test-harness` branch, dev server on http://localhost:3456, mock mode `?mock=1` (in-memory; reload = fresh seeded state).
Seeded state observed at boot: Test Student · RUNWAY $5,950 lasts until ~Apr 22 · +$3,150 set aside in savings · MONTHLY PLAN $3,105 · DEBT $64,125 at graduation · spring-refund banner showing.

Severity: CRITICAL (wrong money number, crash, data loss) / HIGH (broken interaction, a11y blocker, misleading state) / MEDIUM (confusing copy, layout break, contrast) / LOW (polish). HARNESS-GAP = stub missing a call, not an app bug.

---
## Pass 1 — Loans tab torture (browser)

1. **CRITICAL — Return-card figures pooled/shared across loans.** Both loans' return cards show identical "excess" figures; adding/editing an unrelated 3rd loan changes BOTH existing cards' "saves ~$Y by graduation" numbers (baseline $6,223/$6,048 → $19,393/$17,337 after touching a 3rd loan). Deleting the federal loan removed HPSL's own return notice. Expected: per-loan computation from that loan's own principal/rate/date.
2. **CRITICAL — "Remove part" silently deletes principal.** Seeded federal loan $41,000 (2 parts) → add 3rd part (correctly re-splits 3×$13,666.67, total intact) → Remove part 3 → borrowed amount silently drops to $27,333.34; loan-at-grad $55,625→$37,083; header Debt $64,125→$45,583. No warning/confirm. $13,666.66 of real principal vanishes.
3. **CRITICAL — Return-window countdown contradicts the dates it's based on (confirmed by independent math, see Pass 5).** Disbursements are Aug 5 2025 / Jan 10 2025; all 120-day windows closed by Dec 2025. UI still shows "138 days left" (federal) and "296 days left" (HPSL). 138 days from today = ~Dec 3 2026 = 120 days after Aug 5 **2026** — countdown appears to use the wrong year (+1). Independent run of `loanReturnWindows(loans,'2026-07-18')` returns an EMPTY array — **no return card should render at all today.**
4. **MEDIUM — No rate sanity check.** 95% accepted silently ($10K → $36,730 at grad, straight into Debt tile); 0.0807 (decimal-typo for 8.07) accepted silently ($20,000→$20,045, near-zero growth, no hint).
5. **MEDIUM — Date picker has no year-jump or typed entry** (custom calendar, month arrows only). Far-past (1926)/far-future dates are practically unreachable — untestable via UI, and a usability defect in its own right. No clamping observed in the reachable range.
6. **LOW — "Add loan" defaults School Year to the NEXT academic year** (Year 2 / 2026–27 @ 8.07%) even while viewing Year 1 (7.94%).
7. **LOW — Debt tile reads "$0 / estimate" with zero loans** — nothing to estimate; mismatched with empty-state copy.
8. **PASS** — HPSL shows $8,500 = $8,500 at grad everywhere ($0 in-school interest, correct).
9. **PASS** — Editing loan principal $41K→$50K updates loan card ($55,625→$67,835) and Debt tile ($64,125→$76,335) immediately and proportionally.
10. **PASS** — Delete flows don't crash; clean empty state; Runway unaffected.
11. **PASS** — More options disclosure (Status / Fee % / Notes) all functional.
12. No console errors during the entire pass.

**UI numbers (baseline):** federal $55,625 at grad (borrowed $41,000, 7.94%); HPSL $8,500; Debt $64,125; return cards: excess $5,000 both, saves $6,223 / $6,048, days left 138 / 296.
**Guards:** rate sanity FAILED (absent); date clamps UNTESTABLE at extremes (picker limitation); no confirm on destructive Remove-part.

## Pass 5 — Independent math verification (non-browser, ran real loans.js against seed)

- Federal (directUnsubGrad, 2025 table 7.94%, fee 1.057% → principal $41,433.37): interest to grad (2029-08-15) $14,191.25 → **$55,624.62 at grad** — matches UI $55,625. Simple daily interest, leap year handled correctly.
- HPSL: $8,500 flat, accruesInSchool=false → **$8,500** — matches UI.
- **Debt at graduation: $64,124.62 → $64,125 — MATCHES UI.** isEstimate=false.
- **Runway:** anchored on latest reading (Jul 16: $5,950 spendable / $3,150 savings). Window Jun 13→Jul 16 = 33 days ≥ 14-day threshold → burn MEASURED: $645.70/mo ($21.21/day). Run-out = Jul 16 + 280d = **2027-04-22 — matches UI "~Apr 22."** Savings shown separately, not burned. Next refund Aug 11 2026 precedes run-out → no gap warning → state `counting_down`. All consistent with UI.
- **Return card: `loanReturnWindows` returns EMPTY for today — UI showing cards at all is a bug** (see Pass 1 finding 3). Seed data quirk: spring disbursement dated Jan 2025 (before fall Aug 2025), so all windows permanently closed by mid-2025.
- Edge notes: as-of-balance mode does simple interest on the as-of base (base may embed servicer capitalization — acceptable, not interest-on-interest within the app); 2027+ loans silently reuse the 2026 rate table flagged only by isRateEstimated; no rounding inside loans.js (display layer rounds).

**Cross-check verdict: all header/loan money numbers MATCH the independent math. The one math-vs-UI divergence is the return card rendering when the library says no window is open — CRITICAL.**

## Pass 2 — Balance check-in + Runway (browser)

1. **MEDIUM — "Yes, it landed" doesn't lead to the balance check-in it advertises.** Banner says "Update your balance to see the full picture," but the button just flips to the Loans tab and shows a static 3-point advisory card; the actual check-in form is further down the tab, unscrolled/unhighlighted. Broken affordance chain (App.jsx:1344, LoansTab.jsx).
2. **MEDIUM — Past check-ins duplicates same-day entries.** Two submits on the same day → two rows ("Jul 18 — $5,800" and "Jul 18 — $5,900"). Storage is append-only (LoansTab.jsx:312), no dedup on write. The MATH coalesces correctly (normalizeReadings, loans.js:392) — display layer doesn't.
3. **LOW — Runway "lasts until ~Apr 22" never shows a year.** $60,000 balance → "~Feb 26" which is actually Feb 2028. Ambiguous across a 4-year program.
4. **LOW/by-design — No date field on check-in; always stamps today** (LoansTab.jsx:314). Future/backdated/pre-previous-date abuse structurally untestable via UI (likely intentional hardening).
5. **HARNESS-GAP — "growing"/measured-burn states unreachable today by construction:** any new reading pairs with Jul 16 for a 2-day window (<14d) so burn always falls back to plan. Correct per the 14-day rule, not a bug.

**Runway states reached:** counting_down (baseline, $5,950 → ~Apr 22, matches hand-calc); recomputed counting_down ($5,500 → ~Sep 9, plan burn $3,105 correctly used for 2-day window); **gap** ($1,000 → "⚠ 15d before your ~Aug 11 refund / trim ~$1,837/mo closes it" — hand-verified exact); **overdrawn no cushion** ($0, blank savings); **overdrawn covered** ($0 + $5,000 savings → "your savings covers it"); **through_graduation** ($500,000 → "On track ✓ / lasts through graduation"). NOT reached: growing (blocked by 14-day rule + no backdating), unanchored (no delete-reading affordance exists — append-only).

**Guards verdict:** typo guard **HELD** ($500 and $60,000 both triggered "Big change from last time — just checking?"; $5,900 saved silently; cancel works, no phantom write). 14-day burn rule **HELD** (no wild 2-day extrapolation). Same-date coalescing **PARTIAL FAIL** (math yes, display list no — finding 2). Future-date clamp untestable via UI (code filters r.date <= today). Negative balance **HELD** (HTML5 min=0 + computeRunway treats ≤0 as overdrawn, defense in depth). Savings > spendable **HELD** ($50K savings vs $1K spendable — countdown runs on spendable only). No console errors, no crashes all pass.

## Pass 3 — Refund Playbook + return card + setup step (browser)

1. **HIGH — Duplicate refund-land banners stack.** After dismissing the Playbook, BOTH the header nudge (App.jsx:1342, X-dismissible) and a near-identical embedded nudge in the Loans tab (LoansTab.jsx:517-527, NO dismiss control) render simultaneously for the next term, each with its own "Yes, it landed" button. One data source, two independent renderers.
2. **MEDIUM — Inconsistent dismiss affordance** between those two banners (header has X + session-persisted dismissed map; embedded twin can't be dismissed at all).
3. **PASS — Playbook dismissal + term chaining works:** "Dismiss — I've seen this" writes refundPlaybookSeen for spring, persists across tab switches, correctly advances to fall; reload resets cleanly.
4. **CRITICAL — Return-card "saves ~$Y" is ~4.7x overstated.** With a disbursement date moved to today (dateConfirmed=true), card read: excess "$8,591 … returning it saves about $10,804 by graduation." Simple interest on $8,591 @7.94% (+~1% fee) over ~1,123 days to grad ≈ $2,100–$2,300. $10,804 is ~4.7x that — confirms the pooling/cross-loan bug in returnSavingsAtGraduation (loans.js:583). The 120-day countdown DISPLAY rule itself works: hard "120 days left" only with confirmed date.
5. **NOTE / needs recheck — Pass 1 vs Pass 3 discrepancy on baseline return cards.** Pass 3 observed NO return card at fresh seed (matches loanReturnWindows returning empty); Pass 1 reported cards with "138/296 days left" at baseline. Possible the Pass-1 cards appeared only after clicking "Yes, it landed" or a loan edit. Either way the countdown was observed rendering with impossible positive day counts at least once — the wrong-year countdown finding stands but the exact trigger needs pinning down during the fix.
6. **MEDIUM — Empty-state "Remind me later" doesn't survive a tab switch.** snoozedThisSession is local useState in ReminderBanner (LoansTab.jsx:454-456); LoansTab unmounts on tab switch so the banner reappears seconds later. "Don't show again" (writes data.loanReminderSnooze) persists correctly.
7. **HARNESS-GAP — Setup money step unreachable under mock:** mockSessionData.js:64 stamps setupVersion=SETUP_VERSION by design; ProgressiveSetup never renders under ?mock=1; no manual reopen entry in Settings.
8. **LOW (incidental) — "Delete loan" has no confirm/undo** — one click, instant, irreversible.

No console errors during the entire pass.

## Pass 4 — Cross-cutting: themes, keyboard, mobile, persistence, console (browser)

1. **HIGH — Date-picker popup drops focus to <body> on Esc-close** instead of returning it to the trigger button. Esc does close it (aria-expanded flips false), but keyboard users lose their place. WCAG focus-management failure on a new Phase 2 surface.
2. **MEDIUM — Date-picker grid has no arrow-key navigation** — Tab-only, up to 31 stops per month. Violates the ARIA APG date-picker grid pattern; inefficient for keyboard/switch users.
3. **MEDIUM — Delete-loan (×) has no confirmation** (corroborates Pass 3 #8) — instant irreversible removal, inconsistent with the app's own typo-guard pattern.
4. **MEDIUM — Refund-banner dismiss × is 13×18px at 375px width** — fails WCAG 2.5.8 (24×24 min) and the repo's own 44×44 HIG rule. Loan Delete (28×28) / Remove part (26×26) clear WCAG but miss the 44px house rule (no ::after hit-slop found on these).
5. **LOW — Typo-guard confirm is role="alert" inline, not alertdialog; focus doesn't move to its buttons.** Acceptable (announced, no trap) but not focus-managed.
6. **HIGH (HARNESS CAVEAT, affects all passes) — Mock state persists in localStorage (marro_v8, marro_v8_base, marro_theme_v2, marro_uid) across full reloads.** "Reload = fresh seed" is NOT true — only a localStorage clear resets. This retroactively explains the Pass 1 vs Pass 3 baseline discrepancy (Pass 1 likely observed return cards on a state polluted by earlier edits/leftovers). Also worth checking during fix work whether mock-mode writes could ever contaminate a real session's local cache.
7. **HARNESS-GAP — browser-tool paint/stale-ref glitches** (black screenshots after scroll/resize, stale refs) — tool artifacts, not app bugs; behavior re-verified via DOM.

**Positives:** loan Type picker is a native select (fully AT-operable); contrast PASSES both themes (dark 6.3–13.9:1; light 4.83–4.96:1 on the tightest text — compliant but near the floor); visible focus rings both themes; Esc closes settings menu + date picker; NO horizontal overflow at 375px on Budget/Loans/Aid tabs (cost table correctly in its own .scrollx container); tiles reflow correctly; in-session edits + theme survive tab switches; console 100% clean all pass.

**Keyboard verdict:** mostly operable, no traps; date-picker focus-return + arrow-nav are the gaps. **Contrast verdict:** pass, both themes (light theme margins tight). **Mobile verdict:** no overflow; one tap-target failure (banner ×). **Console:** clean.

---

# FINAL SUMMARY (severity-ranked)

## CRITICAL — must fix before ambassadors onboard
- **C1. Return card renders when no return window is open, with impossible countdowns** (Pass 1 #3 + Pass 5): loanReturnWindows(today) returns empty (all 120-day windows closed 2025) yet cards showed "138/296 days left" — countdown consistent with using disbursement year +1. (Trigger conditions muddied by the localStorage-persistence caveat, Pass 4 #6 — pin down during fix.)
- **C2. Return-card dollar figures are pooled across loans and ~4.7x overstated** (Pass 1 #1 + Pass 3 #4): editing an unrelated loan changes every card's "saves ~$Y"; measured $10,804 vs ~$2,200 expected simple interest on the stated $8,591 excess. Wrong money number on the feature's headline claim. returnSavingsAtGraduation, loans.js:583.
- **C3. "Remove part" silently deletes principal** (Pass 1 #2): removing a disbursement part drops total borrowed by that part's amount ($41,000 → $27,333) with no warning; Debt tile follows. Data loss + wrong money number.

## HIGH
- H1. Duplicate refund banners stack (header + undismissable Loans-tab twin) after Playbook dismissal (Pass 3 #1/#2).
- H2. Date-picker Esc-close drops focus to <body> (Pass 4 #1) — a11y blocker-adjacent on a new surface.
- H3. Harness caveat: localStorage persistence breaks the "reload = fresh seed" testing contract (Pass 4 #6) — fix in the harness before it's merged, or every future automated pass inherits polluted baselines.

## MEDIUM
- M1. No interest-rate sanity check (95% and 0.0807 both accepted silently, straight into Debt) (Pass 1 #4).
- M2. Date picker: no year-jump/typed entry (far dates unreachable; also blocks testing date clamps) + no arrow-key grid nav (Pass 1 #5, Pass 4 #2).
- M3. "Yes, it landed" doesn't lead to the balance check-in it advertises (Pass 2 #1).
- M4. Past check-ins list shows same-day duplicates (math coalesces, display doesn't) (Pass 2 #2).
- M5. Empty-state "Remind me later" resets on tab switch (local useState in a component that unmounts) (Pass 3 #6).
- M6. Delete-loan has no confirm/undo (Pass 3 #8, Pass 4 #3).
- M7. Refund-banner dismiss × 13×18px at mobile width (WCAG 2.5.8 fail; house rule is 44×44) (Pass 4 #4).

## LOW
- L1. "Add loan" defaults to next academic year while viewing Year 1 (Pass 1 #6).
- L2. Debt tile "$0 / estimate" with zero loans (Pass 1 #7).
- L3. Runway date shows no year ("~Feb 26" = Feb 2028) (Pass 2 #3).
- L4. Typo-guard confirm not focus-managed (Pass 4 #5).

## Guards scorecard (adversarial-review guards, in practice)
- Balance typo guard (>3x/$20K): **HELD** — both directions, cancel clean.
- 14-day burn window rule: **HELD** — 2-day window correctly falls back to plan, no wild extrapolation.
- Same-date coalescing: **PARTIAL** — calculation layer yes, display list no (M4).
- Rate sanity: **ABSENT** (M1).
- Date clamps: untestable at extremes via UI (M2); code filters future reading dates; no clamping issues in reachable range.
- 120-day countdown only-when-confirmed display rule: **HELD** — but the number it displays can be wrong (C1) and the dollar figure attached is wrong (C2).

## Math verification
Every header/loan number matched independent recomputation from loans.js + seed: federal $55,625 at grad, HPSL $8,500 flat, Debt $64,125, Runway anchor Jul 16 + measured burn $645.70/mo → ~Apr 22 2027, savings cushion $3,150 separate. The ONLY math-vs-UI divergences are the return card (C1/C2) and the Remove-part mutation (C3).

## Verdict
**Not ship-quality for the return-card feature; the rest of Phase 2 is solid.** Core loan math, Debt tile, Runway engine, and all its states are correct and matched independent math exactly; guards on balance entry held; contrast, mobile reflow, and console hygiene are clean. But all three CRITICALs sit on the refund/return flow — the exact surface ambassadors will be shown — and two of them are wrong-money-number bugs. Fix C1–C3 (+ H1, which is the same surface) before ambassador onboarding; H2/M7 next per the ADA-first rule; the rest can batch.

## Cleanup
- Dev server: STOPPED after the run.
- Working tree: returned to `main` (harness branch mo/dev-test-harness untouched, no code changes made anywhere; untracked `marro-mockups/` was pre-existing).
- No commits, no pushes, no merges. Test-and-report only.
