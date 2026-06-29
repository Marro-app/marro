# Data Ethics & Monetization Rules

**This file is the single source of truth for what Marro does and doesn't do with user data, and how we talk about it.** Check it on **every** change that touches data collection, storage, sharing, monetization, or any user-facing copy about privacy. **UI copy and `privacy.html` must never contradict this file.**

Locked 2026-06-28. The rules below are the operative version; the long-form reasoning behind them lives in the design discussion that produced this file.

---

## 0. The one principle
Keep/ask only what we must, be precise about what we promise, and never make an absolute promise we'll later break. Treat **personal records** (about an identifiable person) and **true aggregates** (group math about no one) as opposites.

## 1. The two lanes of data

**Lane A — Individual records** (a user's own debt, budget, numbers — tied to them):
- **NEVER sold. NEVER shared in identifiable form.** Private to the user's account, RLS-gated, encrypted.
- Hard line, no exceptions.

**Lane B — True aggregates** (group statistics across many users — medians, ranges, counts — from which no individual can be recovered):
- May be stored and used freely to power features, benchmarking, and partner relationships.
- Not "personal data" → does **not** require per-user consent.
- **Silent in the product UX** (we don't interrupt or ask), **but disclosed in general terms in `privacy.html`.**
- "True aggregate" = only group math ever leaves the individual layer. An individual record with the name stripped off is **NOT** an aggregate and never leaves Lane A.

## 2. Language rules (what we say)
- **Never** "never sold" / "we never sell your data" (absolute → false the moment of any aggregate/partner deal). **Say: "we never sell your personal info."**
- **Never** "anonymized" in a promise (re-identifiable → weak). **Say: "aggregate."**
- **Never** put mechanism words — "group stats", "aggregate", "data pool", "de-identified" — in **user-facing** copy (it spooks people). Those words live in docs + policy only. To users, describe the **benefit** ("see how you compare to students at your school"), never the plumbing.

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

## 5. Consistency gates (what makes it real)
- **UI copy MUST match `privacy.html`.** A mismatch between what a screen promises and what the policy permits is the actual legal exposure.
- **"Consent-first" / opt-in must be real behavior**, not buried.
- The exact de-identification / aggregate line gets **legal review (UCI clinic)** before any data-sharing or partner feature ships.

## 6. Open questions — NOT yet decided (flag before building the relevant feature)
- **Account deletion + data export** (right to be forgotten / portability): what a delete removes, what (if anything) persists in already-pooled aggregates, and a self-serve export. Legally expected (GDPR/CCPA) and trust-critical for skeptical users.
- **Data retention**: how long individual records are kept, especially after graduation / inactivity.
- **Sub-processors**: Supabase, Vercel, Google (auth), and — Phase 4 — Anthropic (AI). Each receives user data to provide the service; all must be disclosed as processors in `privacy.html`.
- **AI as a data recipient (Phase 4)**: when the advisor sends a user's financial data to the model, be explicit it's processing *on the user's behalf*, disclosed, and not used to train third-party models (confirm the API provider's training stance). This is **processing, not Lane-B sharing** — keep that distinction clear.
- **Benchmarking withdrawal + field scope** (see rule 4).
- **Marketing/email consent**: separate opt-in for any non-transactional email.

## Related
- `CLAUDE.md` rule 10 (the gate that points here) · `STRATEGY.md` (§6 monetization/data vision) · `privacy.html` (the user-facing contract — must match this file) · `supabase/*.sql` (RLS = the Lane-A enforcement mechanism).
