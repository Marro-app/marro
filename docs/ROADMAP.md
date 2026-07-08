# Roadmap

**Revised 2026-07-01** after a full strategic/technical audit (decision log: `PRODUCT_DECISIONS.md` 2026-07-01). Build phases only — vision/monetization/company layer lives in `STRATEGY.md`; backlog in `FUTURE_WORK.md`; **completed-phase detail + the old roadmap moved to `docs/HISTORY.md`** (archive — grep it, don't read it whole).

> **Product target (one line):** a 3-tab app a med student sets up in 5 minutes and touches ~1 minute a month, answering: *how long will my money last* and *what will my degree really cost me*.
>
> **Operating principle:** phases are ordered by what we **learn about real users soonest**, not by what's technically next. Ship to strangers, measure, respond. Hide features rather than delete them — everything hidden stays on the shelf.

## Done (detail in HISTORY.md)
✓ Phase 1 core app · ✓ Phase 2 savings & charts · ✓ Phase 2.5 Marro UI overhaul · ✓ Phase 2.5b auth + Supabase · ✓ Phase 3 school-agnostic generalization · ✓ Phase 3.5 foundation (Vite migration, component split, PWA cache fix, Vitest 62 tests, Sentry)

---

## Phase 1 — Simplify + open the doors (NOW, ~2–3 wks, two parallel tracks)

**Track A — simplification pass (build):** ✓ done 2026-07-02
- ✓ Hide 4 tabs — **Weekly, Savings, Subscriptions, Charts** — behind a single revivable flag (`src/lib/featureFlags.js` → `HIDDEN_TABS`; hide, never delete — code + data stay). ✓ Fold subscription totals into Budget as "fixed monthly costs" (the existing auto-calc "Subscriptions" row, relabeled, gets a "Manage" link opening the Subscriptions form in a modal). ✓ Keep ONE plan-vs-actual chart on Home (ported from Charts tab into Budget). ✓ Move category editing into settings (Settings dropdown → "Categories" modal).
- ✓ Slim the header to 3 numbers (Runway placeholder · Monthly plan (real) · Debt placeholder — both placeholders fill in with Phase 2's loan model).
- ✓ Add a **"quick add"** header button + modal for one-off expenses — writes through a new shared `addWeeklyEntry` mutator (also used by the now-hidden Weekly tab) so Budget's chart/unbudgeted-spending stay in sync.

**Track B — doors + trust (paperwork; start day 1, the queues are long):**
- ✓ **Landing redesign** (2026-07-03, branch `landing-redesign`) — scrollytelling "Growth Rings" public landing page (`src/landing/`), replacing the old plain login screen for signed-out visitors. Feeds directly into the OAuth verification requirement below (Google needs a real public home page, not a login wall). Details in `PRODUCT_DECISIONS.md` 2026-07-03.
- ✓ **Google OAuth verification** — approved 2026-07-05 (custom auth domain, logo, out of Testing mode; Publishing status confirmed In production, not capped at 100 test users).
- ✓ **`allowed_emails` invite gate** — enabled 2026-07-06. SQL sections 1–3 run in Supabase Studio (table + RLS + `is_email_allowed()`, owner seeded); app-side check wired in `src/App.jsx` (calls `isEmailAllowed()` from `src/lib/data.js` right after session established — fails closed, signs out + shows an invite-only screen if the email isn't on the list). To invite someone directly: `insert into allowed_emails (email, note) values ('their@email.com', 'note') on conflict do nothing;` in Supabase SQL Editor.
- ✓ **Invite codes + waitlist + admin console** — built 2026-07-07 (branch `claude/invite-codes-waitlist-admin`). Turns the dead-end invite screen into a growth loop: members share single-use codes (quota **5** / **15** ambassador), no-code visitors join an in-app **waitlist**, and admins run a console (generate/revoke codes, set quotas/ambassadors, view the waitlist, **grant admin to other accounts**). Redeeming a code adds the email to `allowed_emails` (unlocking the app). Gate flow changed: a non-allowlisted user now **stays signed in** on `<InviteGate>` (redemption RPCs need the session) instead of being signed out. New: `supabase/invites_waitlist.sql` (5 tables + RLS + 5 RPCs — atomic single-use redemption, 10/hr brute-force lockout, `revoked_at`), `api/admin.js` (service-role backend, mirrors `api/delete-account.js`), `src/landing/InviteGate.jsx`, `src/tabs/AdminTab.jsx`, `src/components/InviteFriendsModal.jsx`, wrappers in `src/lib/data.js`. **Before it works: run `supabase/invites_waitlist.sql` in Supabase Studio** (creates tables/RLS/RPCs, seeds owner `jawadhijazi7@gmail.com` as first admin). Owner adds the co-founder as admin from the console. Schema in `docs/DATA_MODEL.md`; design calls in `docs/PRODUCT_DECISIONS.md`.
- ✓ **Usage/event logging** (2026-07-06) — `events` table (RLS write-own, `supabase/events.sql`) + 8 key events (login, setup finish, tab views, category/subscription/savings-goal added, expense logged, sign out; no check-in flow exists yet to hook). No dashboard UI — SQL views only. Details in `PRODUCT_DECISIONS.md` 2026-07-06.
- ✓ **Account deletion + data export** (2026-07-06) — first serverless fn (`api/delete-account.js`, service-role, verifies the caller's own access token server-side — never trusts a client-supplied uid); export is client-side only (own `app_state`/`profiles` rows, already RLS-readable → JSON download). Settings menu: "Export my data" + "Delete my account" (type-DELETE-to-confirm modal). Fulfills the privacy.html promise + GDPR/CCPA. Details in `PRODUCT_DECISIONS.md` 2026-07-06.
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
