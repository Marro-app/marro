# Roadmap

**Revised 2026-07-01** after a full strategic/technical audit (decision log: `PRODUCT_DECISIONS.md` 2026-07-01). Build phases only — vision/monetization/company layer lives in `STRATEGY.md`; backlog in `FUTURE_WORK.md`; **completed-phase detail + the old roadmap moved to `docs/HISTORY.md`** (archive — grep it, don't read it whole).

> **Product target (one line):** a 3-tab app a med student sets up in 5 minutes and touches ~1 minute a month, answering: *how long will my money last* and *what will my degree really cost me*.
>
> **Operating principle:** phases are ordered by what we **learn about real users soonest**, not by what's technically next. Ship to strangers, measure, respond. Hide features rather than delete them — everything hidden stays on the shelf.

## Done (detail in HISTORY.md)
✓ Phase 1 core app · ✓ Phase 2 savings & charts · ✓ Phase 2.5 Marro UI overhaul · ✓ Phase 2.5b auth + Supabase · ✓ Phase 3 school-agnostic generalization · ✓ Phase 3.5 foundation (Vite migration, component split, PWA cache fix, Vitest 62 tests, Sentry)

---

## Phase 1 — Simplify + open the doors (NOW, ~2–3 wks, two parallel tracks)

**Track A — simplification pass (build):**
- Hide 4 tabs — **Weekly, Savings, Subscriptions, Charts** — behind a single revivable flag (hide, never delete; code + data stay). Fold subscription totals into Budget as "fixed monthly costs"; keep ONE plan-vs-actual chart on Home; move category editing into settings.
- Slim the header to ≤3 numbers (runway placeholder · month plan · debt placeholder until Phase 2 fills them).
- Add a **"quick add"** affordance for one-off big expenses (a button, not a tab) — keeps surprises explainable under the monthly model.

**Track B — doors + trust (paperwork; start day 1, the queues are long):**
- **Submit Google OAuth verification** (custom auth domain, logo, out of Testing mode). Everything downstream waits on this review.
- Enable the **`allowed_emails` invite gate** at publish time (SQL ready: `supabase/allowed_emails.sql`).
- **Usage/event logging:** an `events` table (RLS write-own — policies or it reads empty, CLAUDE.md rule 4) + ~10 key events (login, setup finish, check-in done, tab views). No dashboard UI — SQL views only.
- **Account deletion + data export** (first serverless fn; also the privacy.html promise + GDPR/CCPA).
- Send `privacy.html`/`terms.html` to the **UCI clinic** for human review.

**Done when:** 3 visible tabs + settings; a stranger can join unaided (pending Google); usage is visible; users can leave with their data.

## Phase 2 — Money core: loans, runway, new onboarding (~2–3 wks)

One integrated build. Specs already locked — build as designed: loan-capture model + snapshot + Offered≠Accepted≠Disbursed (`PRODUCT_DECISIONS.md` 2026-06-28 entries).
- **Onboarding money step (5 questions):** total borrowed so far (skippable; the one federal/non-federal toggle) · next disbursement amount + rough date · rent + fixed monthly costs · **family/partner support (monthly)** · other income (monthly).
- **Payoff screen immediately after:** projected **debt at graduation with interest** + rough post-residency monthly payment + **runway** ("$X to last until ~date"). Loan math = money math → **tests mandatory**.
- **Loans tab:** editable, user-named loans; calm "Estimate — add your loans to make this exact" badge when incomplete; offered/accepted/disbursed status field in the model from v1.
- **Home centers on the runway line** (counts down by calendar — the app looks alive without input) + **"upcoming big costs"** (Step fees, interview season — replaces the Step savings-goal rings).

**Done when:** fresh account → debt + runway on screen in <5 min; numbers hand-checked against studentaid.gov examples.

## Phase 3 — The rhythm: monthly check-in + weekly digest (~1–2 wks)

Presence weekly, work monthly:
- **Weekly digest email — zero work required** (computed numbers, no AI yet; the future AI rides this exact rail): runway, plan position, upcoming costs.
- **Monthly check-in — one number:** "what's your checking balance right now?" → derive actual burn vs plan, update runway + projection. Optional "where did it go?" chips, skippable forever. **Ask the balance, not the expenses.**
- **Forgiving by design:** a missed month = the next reading covers a longer span, math unchanged. One nudge 3 days after the 1st, then silence (communication budget, STRATEGY §1).
- Product copy embraces it: *"Marro doesn't need you every day."*

**Done when:** the full loop survives one real month-end on the founder's account.

## Phase 4 — Closed beta: strangers + a verdict (~4 wks, mostly watching) 🚦

- **20–30 med students, 3+ schools, ≥half strangers-of-friends** (friends are too polite to churn honestly). Watch the event log weekly.
- Interview ~10. Pricing fake-door **as a statement**: "Marro will eventually be ~$5/mo; beta users stay free forever" — watch reactions.
- Fix only what they trip over; keep a written "not now" list and honor it.
- **The gate (written down now, before results exist):** if fewer than ~1/3 of non-friends complete the 2nd monthly check-in (or return in week 4) after two fix cycles → **STOP adding features** and rethink the core loop. Above ~40% → proceed.

## Phase 5 — First AI: the digest gets smart (~3–4 wks, only after the Phase-4 gate passes)

- **Safety rails FIRST, non-negotiable** (`AI_COST_MODEL.md` §7): account spending cap + billing alerts + per-user rate limits before the first AI call.
- AI writes the weekly digest (Haiku-default routing per `AI_COST_MODEL.md`); **thumbs up/down on every digest**; "Suggested" UI rule 9 applies to anything it proposes.
- **Answer key:** 20–30 fixed example situations with known-good outputs, re-run before any prompt/model change — the "never swap untested" rule as an actual tool.
- Measure 4 wks: cost/user vs the model doc, helpfulness ratio → keep/kill/reshape.
- *Demoted from old Phase 4a:* anomaly detection (needs data density monthly check-ins won't produce — later a digest ingredient, not a flagship), BYOK (cut), chat (still avoided).

## Phase 6 — Effortless capture (when users ask for detail)
Receipt photo → Haiku parse → "Suggested" one-tap confirm (rule 9) → voice entry later → Plaid only if the data demands it.

## Phase 7 — Grow school by school
Ambassador/founding-member per school → invite waves per school → benchmarking at ~10+ users/school (reciprocity unlock, `DATA_ETHICS.md` rule 4) → public r/medicalschool launch **only after the Phase-4 gate passes**. One public debut.

## Phase 8 — Heavy features, ordered by real user demand (no committed order today)
Repayment simulator + PSLF (research first — never build loan policy from memory) · interview-season budget · specialty financial outlook · reviving hidden tabs (Savings, Charts, Weekly detail) · native via Capacitor · admin dashboard UI (SQL views suffice until then).

---

## Parked / cut
Jarvis voice-operator mode (**cut**) · terrarium mascot (**cut**) · group-buying (parked — needs per-school density) · BYOK (cut from early AI scope) · polish-only projects (a11y rule 7 still gates all *new* work) · incorporation/equity machinery **until the cofounder commitment is real** (then execute STRATEGY §5–6 as written).

## Pre-launch legal/trust gates (all folded into Phase 1)
Account deletion + export · privacy.html ↔ DATA_ETHICS alignment + clinic review · Google OAuth verification.
