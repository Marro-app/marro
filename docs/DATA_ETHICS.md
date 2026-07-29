# Data Ethics & Monetization Rules

**This file is the single source of truth for what Marro does and doesn't do with user data, and how we talk about it.** Check it on **every** change that touches data collection, storage, sharing, monetization, or any user-facing copy about privacy. **UI copy and `privacy.html` must never contradict this file.**

Locked 2026-06-28. **Revised 2026-08-02** (founder decision, during the legal-docs overhaul → PR #52 + the `.docx` EULA/Privacy/clinic-prep set): moved to a **broad aggregate posture** (aggregate/de-identified data may be *sold or licensed*, not just "used"), dropped the "no advertising" absolute from `privacy.html`, and **lowered the minimum age to 13** with parental consent for minors (see rules 1, 2, and the new rule 4.5). The rules below are the operative version; the long-form reasoning behind them lives in the design discussion that produced this file.

---

## 0. The one principle
Keep/ask only what we must, be precise about what we promise, and never make an absolute promise we'll later break. Treat **personal records** (about an identifiable person) and **true aggregates** (group math about no one) as opposites.

## 1. The two lanes of data

**Lane A — Individual records** (a user's own debt, budget, numbers — tied to them):
- **NEVER sold. NEVER shared in identifiable form.** Private to the user's account, RLS-gated, encrypted.
- Hard line, no exceptions.

**Lane B — True aggregates** (group statistics across many users — medians, ranges, counts — from which no individual can be recovered):
- **Marro owns Lane B and may store, use, license, *and sell* it freely** — to power features and benchmarking, and in relationships with partners, sponsors, and advertisers (broad posture, 2026-08-02). This is the revenue/asset lane.
- Not "personal data" → does **not** require per-user consent.
- **Silent in the product UX** (we don't interrupt or ask), **but disclosed in general terms in `privacy.html`/`terms.html`.** The legal basis (Marro's ownership + right to sell aggregate) lives in `terms.html` §7 and `privacy.html` §4–5.
- To stay outside "personal information" (and keep the sale lawful), the three CCPA de-identification safeguards are mandatory: (a) reasonable measures so it can't be linked to anyone, (b) a public commitment not to re-identify, (c) recipients contractually bound to the same. These are in the live docs — do not sell aggregate that doesn't meet them.
- "True aggregate" = only group math ever leaves the individual layer. An individual record with the name stripped off is **NOT** an aggregate and never leaves Lane A.
- **Minor data is excluded from any aggregate we sell/license** — see rule 4.5.

## 2. Language rules (what we say)
- **Never** "never sold" / "we never sell your data" (absolute → false the moment of any aggregate/partner deal). **Say: "we never sell your personal info."** (This one is unchanged and is the load-bearing promise — the live docs say it verbatim.)
- **Never** the absolute "we do not use your data for advertising" — that was the old `privacy.html` line that blocked the whole partner/aggregate-sale model; **removed 2026-08-02.** We may share/sell *aggregate* (non-personal) data with advertisers/partners. What we still don't do: show third-party ad trackers in-app, or sell/share *personal* info.
- **Never** "anonymized" in a promise (re-identifiable → weak). **Say: "aggregate."**
- **Mechanism words in user-facing copy:** still prefer benefit language in *app UI* ("see how you compare to students at your school"). But the policy pages (`privacy.html`/`terms.html`) are the exception — they now define "aggregated/de-identified data" plainly because CCPA compliance requires it. Keep the benefit framing on marketing/app screens; keep the precise legal terms in the policies.

## 3. Partner offers
- **Always shown** to users (not optional to display).
- **Always clearly labeled "Partner / Sponsored"** — clear and conspicuous (FTC), never fine print.
- **Never framed as Marro's own recommendation or personalized advice** (crosses into regulated financial advice + breaks "never BS"). Format: "here's an option from a partner," not "we recommend you do this."
- Marro may earn from them; that's fine and disclosed.

## 4. Benchmarking = reciprocity, not a consent wall
- The only place "consent" surfaces. Framed as a feature unlock: **contribute your numbers → unlock how you compare.**
- Opt-in by *using the feature*. No scary data-collection dialog.
- Copy is benefit-framed (rule 2).
- **[OPEN]** Define exactly which fields feed the benchmark pool, the de-identification step, and whether a user can withdraw their contribution from future aggregates.

## 4.5 Minors (added 2026-08-02 — min age lowered to 13 for premed expansion)
- **Hard floor: 13.** No accounts for anyone under 13 (avoids COPPA's verifiable-parental-consent regime). Do not build any flow that knowingly collects data from under-13s.
- **13–17 need a parent/guardian** to have read and agreed to the Terms (contract capacity). The signup consent flow must capture this for minors — see the account-consent work.
- **Minor data is walled off from Lane B sales:** we do **not** knowingly include the data of users under 18 in any aggregate we sell or license, and we do not knowingly sell/share minors' personal info. (California also requires opt-in to sell/share the PI of teens 13–15; the exclusion sidesteps this.)
- Sensitive financial data from minors is a heightened-scrutiny area — flag anything minor-specific for the UCI clinic.

## 5. Consistency gates (what makes it real)
- **UI copy MUST match `privacy.html`/`terms.html`.** A mismatch between what a screen promises and what the policy permits is the actual legal exposure. (The live legal pages are now the comprehensive versions in PR #52 — CA governing law, Orange County venue, broad aggregate posture, 13+.)
- **"Consent-first" / opt-in must be real behavior**, not buried. **Account registration must capture affirmative agreement to the Terms + Privacy Policy (clickwrap) and record it** — this is what makes the arbitration clause and the minor parental-consent enforceable.
- The exact de-identification / aggregate line, the arbitration/minors clauses, and the broad-sale posture get **legal review (UCI clinic)** before the pages go live or any partner feature ships. The clinic package = the `.docx` EULA + Privacy Policy + the prep sheet.
- **Governing law is California / Orange County; the entity is intended as a Delaware C-corp** (STRATEGY §6). Keep that consistent across all legal docs.

## 6. Open questions — NOT yet decided (flag before building the relevant feature)
- **Account deletion + data export** (right to be forgotten / portability): what a delete removes, what (if anything) persists in already-pooled aggregates, and a self-serve export. Legally expected (GDPR/CCPA) and trust-critical for skeptical users.
- **Data retention**: how long individual records are kept, especially after graduation / inactivity.
- **Sub-processors**: Supabase, Vercel, Google (auth), and — Phase 4 — Anthropic (AI). Each receives user data to provide the service; all must be disclosed as processors in `privacy.html`.
- **AI as a data recipient (Phase 4)**: when the advisor sends a user's financial data to the model, be explicit it's processing *on the user's behalf*, disclosed, and not used to train third-party models (confirm the API provider's training stance). This is **processing, not Lane-B sharing** — keep that distinction clear.
- **Benchmarking withdrawal + field scope** (see rule 4).
- **Marketing/email consent**: separate opt-in for any non-transactional email.

## 7. Automatic usage analytics (`ui_click`, `src/lib/analytics.js`)
A global click listener records a `ui_click` event (Lane A, same `events` table/RLS as `logEvent()`) for every button/link/interactive-element click app-wide, with **zero per-feature instrumentation** — so newly added buttons are tracked automatically without anyone deciding to wire them up. Because nothing gets manually reviewed per call site the way hand-written `logEvent()` calls are, the sanitization guarantees below are enforced in code, not by author discipline:
- **Metadata is exactly `{el, tag, tab}`** (plus an optional `n` batch-dedup count) — a slugified identifier for the clicked element, its tag name, and the current app tab. Nothing else.
- **Never dollar amounts or other digits.** All digits and currency symbols (`$€£¥₹¢`) are stripped from whatever text is used as the identifier before it's sent, since button labels routinely contain live figures (e.g. "Pay $1,234.56").
- **Never free-typed user text.** The listener never reads the value of any `input`/`textarea`/`select`/`contenteditable` element. The one exception is `<input type="submit"|"button">`, whose `value` is a static developer-written label (the input equivalent of a `<button>`'s text), not something the user typed.
- **Capped length** (~40 chars) and slugified (lowercase, hyphenated) — can't smuggle a long free-text string through as an "identifier."
- **First-party only.** Inserted straight into Supabase's `events` table via the same client already used for `app_state`/`profiles` — no third-party analytics SDK, keeping the "no third parties beyond Google/Supabase/Vercel" promise in `privacy.html` intact.
- **Opt-out**: `data-analytics-off` on an element (or ancestor) excludes it and its subtree. `data-analytics="label"` lets a feature override the auto-derived identifier.
- Anonymous (logged-out landing page) clicks are recorded with `user_id = NULL` (`supabase/analytics.sql` adds a dedicated anon-role insert policy scoped to `user_id IS NULL` — it cannot be used to write a row claiming another user's id). Aggregate-only dashboard views (daily click counts per element/tab, daily event counts, 30-day rollups) live in `supabase/analytics.sql`, read via service-role only — same write-only-from-the-client pattern as `events.sql`.

## Related
- `CLAUDE.md` rule 10 (the gate that points here) · `STRATEGY.md` (§6 monetization/data vision) · `privacy.html` (the user-facing contract — must match this file) · `supabase/*.sql` (RLS = the Lane-A enforcement mechanism).
