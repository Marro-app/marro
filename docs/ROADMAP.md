# Roadmap

**Revised 2026-07-01** after a full strategic/technical audit (decision log: `PRODUCT_DECISIONS.md` 2026-07-01). Build phases only — vision/monetization/company layer lives in `STRATEGY.md`; backlog in `FUTURE_WORK.md`; **completed-phase detail + the old roadmap moved to `docs/HISTORY.md`** (archive — grep it, don't read it whole).

> **Product target (one line):** a 3-tab app a med student sets up in 5 minutes and touches ~1 minute a month, answering: *how long will my money last* and *what will my degree really cost me*.
>
> **Operating principle:** phases are ordered by what we **learn about real users soonest**, not by what's technically next. Ship to strangers, measure, respond. Hide features rather than delete them — everything hidden stays on the shelf.

## Done (detail in HISTORY.md)
✓ Phase 1 core app · ✓ Phase 2 savings & charts · ✓ Phase 2.5 Marro UI overhaul · ✓ Phase 2.5b auth + Supabase · ✓ Phase 3 school-agnostic generalization · ✓ Phase 3.5 foundation (Vite migration, component split, PWA cache fix, Vitest 62 tests, Sentry) · ✓ Phase 2 money core — loans, debt, runway (2026-07-13, detail below)

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
- ✓ **Ambassador roster, members management, self-serve invites, in-app notifications — 2026-07-08** (branch `claude/ambassador-admin-overhaul`), extends the item above. Console gets an **Ambassadors** roster (name/avatar/school/note, invite-limit meter, brought-in leaderboard, per-code revoke/archive) and a **Members** section (grant/revoke access — revoke offers keep-data vs. delete-everything). Waitlist gets **Invite** (mints + emails a code via Resend) and **Remove**. Members/ambassadors self-serve: revoke their own unused code (auto-refunds), email a code to a friend (`api/send-invite.js`, rate-limited). New dismissible **in-app notification banner** (someone you invited joined, your invite limit changed, you're now an ambassador/admin, your access changed). Also fixed two real security bugs from an audit: a deleted redeemer's single-use code was silently re-claimable (now keys off `redeemed_at`, not the nullable `redeemed_by`), and a deleted admin/ambassador's privilege used to silently survive + reactivate on re-signup (now always wiped on delete). Decisions + the exact fixes in `docs/PRODUCT_DECISIONS.md` 2026-07-08. **Before it works: run `supabase/notifications.sql` in Supabase Studio BEFORE `supabase/invites_waitlist.sql`** (the latter calls a function the former defines), plus a `RESEND_API_KEY` Vercel env var for the email features.
- ✓ **Usage/event logging** (2026-07-06) — `events` table (RLS write-own, `supabase/events.sql`) + 8 key events (login, setup finish, tab views, category/subscription/savings-goal added, expense logged, sign out; no check-in flow exists yet to hook). No dashboard UI — SQL views only. Details in `PRODUCT_DECISIONS.md` 2026-07-06.
- ✓ **Account deletion + data export** (2026-07-06) — first serverless fn (`api/delete-account.js`, service-role, verifies the caller's own access token server-side — never trusts a client-supplied uid); export is client-side only (own `app_state`/`profiles` rows, already RLS-readable → JSON download). Settings menu: "Export my data" + "Delete my account" (type-DELETE-to-confirm modal). Fulfills the privacy.html promise + GDPR/CCPA. Details in `PRODUCT_DECISIONS.md` 2026-07-06.
- Send `privacy.html`/`terms.html` to the **UCI clinic** for human review.

**Done when:** 3 visible tabs + settings; a stranger can join unaided (pending Google); usage is visible; users can leave with their data.

## Phase 2 — Money core: loans, runway, new onboarding — ✓ shipped 2026-07-13

**Built exactly as scoped in the Phase 2 plan (`PRODUCT_DECISIONS.md` "Phase 2 commit 1–7" entries; full walkthrough archived alongside the plan). Scope was corrected in a few places from the original lines below — each correction is called out, with the reason and where the cut item moved to.**

- ✓ **Onboarding money step — 2 questions, not 5.** Original scope below promised 5 (total borrowed, next disbursement, rent/fixed costs, family/partner support, other income). What shipped: one skippable screen asking **available to spend** + **savings (optional)**, plus an "I have student loans" checkbox that routes to the Loans tab. Rent/fixed costs and other income were already collected elsewhere in existing Budget/Aid setup — repeating them in a second screen would have violated the plan's own "one idea per screen, no screen asks more than two things" rule. Family/partner support as a distinct field was cut; it flows through the existing "other income" field.
- ✓ **Debt at graduation, with real daily-simple interest** (`src/lib/loans.js`) — calculated the same way federal servicers do, hand-checked against a studentaid.gov worked example (`PRODUCT_DECISIONS.md` "Phase 2 commit 3"). Shows as a calm "estimate" badge whenever any counted loan is private, rate-inferred, or date-inferred.
- ✓ **Runway** ("$X lasts until ~date," or "Growing," "On track ✓," a gap warning with a trim suggestion, "overdrawn," or "all done" after graduation) — a 7-state machine (`computeRunway`) built on balance check-ins, not transaction tracking, so gifts/cash spending/forgotten subscriptions never break it.
- ✓ **Loans tab** — editable, user-named loans; calm "Estimate — add your loans to make this exact" badge when incomplete; offered/accepted/disbursed status field in the model from v1 (built specifically so the future aid-letter scanner can drop in without a redesign).
- ✓ **Refund Playbook** — a one-time educational card when a semester's aid refund lands (how much to keep in checking, a savings-parking range with FDIC/tax notes, and a per-loan 120-day return-window countdown) — not in the original scope below, added during design because it's the single highest-leverage moment in a med student's financial year.
- **Scope correction — no "rough post-residency monthly payment."** The original line below promised this on the payoff screen. **Deliberately not built**: the federal government eliminated the old repayment plans in July 2026 and the replacement rules aren't finalized — guessing at the biggest number in a student's post-grad life isn't something this app will do. Revisit once the rules settle (tracked in Phase 8, "Repayment simulator + PSLF").
- **Scope correction — no Home-screen runway redesign.** The original line below described the Home tab centering on a countdown + "upcoming big costs" replacing the Step-savings rings. **What shipped instead: the existing header Debt/Runway tiles went live** (commit 7) — a smaller, lower-risk change than redesigning Home. The bigger Home-screen redesign is still a real idea, just not this phase's — see the new Phase 2.6 line below.
- **Scope correction — no retroactive Grant/Loans split.** The original line below promised splitting old single-scalar "Total aid" entries into separate Grant and Loans fields after the fact. **Deliberately not built** (see "What we're deliberately NOT building" in the Phase 2 plan): there's no reliable way to know, after the fact, how much of a past "Total aid" number was grants versus loans, and guessing would silently corrupt real historical numbers. What shipped instead is **additive**: real loan tracking starts fresh in the new Loans tab; existing Aid/Budget "Total aid" entries are untouched.

**Done when:** ✓ fresh account → debt + runway on screen in <5 min; numbers hand-checked against a studentaid.gov example (`PRODUCT_DECISIONS.md` "Phase 2 commit 3").

### Phase 2 follow-ups (moved out of this phase, not forgotten)
- **Repayment simulator (post-residency monthly payment)** — moved to Phase 8, gated on the federal government finalizing the post-OBBBA repayment-plan rules. Research the actual rules first; never build loan policy from memory.
- **Aid-letter scanner (Phase 4 AI)** — photograph an award letter, auto-fill loan amounts/dates/rate as a "Suggested" (unconfirmed) entry the student confirms. The Loans tab's offered/accepted/disbursed status field exists specifically so this can drop in without a data-model change.
- **Known v1 limitations, documented not hidden** (full list in the Phase 2 plan's "Who this works for" section): no dedicated MD/PhD-style monthly-stipend mode (approximated via "other income"); international/DACA students use the Private loan type (covers the math, not cosigner nuances); quarter-system schools' refund timing shows as a wider estimate than semester schools.

## Phase 2.6 — "Money Plan" (DESIGNED, not yet built)

Builds directly on Phase 2's loan/debt/runway engine. Where Phase 2 answers "how long will my money last," Money Plan answers the next question a scared M2 asks: "so what should I actually *do* with this refund?" Supersedes the earlier one-line "Home-screen runway redesign" note above — that idea is now the fuller design below. Full design record: `PRODUCT_DECISIONS.md` "2026-07-13 — Phase 2.6 'Money Plan' design locked." **Package A (the per-type loan interest model, 5-type loan picker, persistent 120-day return card, and Runway tile's loan-vs-own-money split) has already shipped**, amended into the still-unmerged Phase 2 PR stack — see `PRODUCT_DECISIONS.md` "Phase 2.6 Package A" entries. Everything below is Package B: the still-unbuilt "Money Plan" tab itself.

- **The picture.** One chart: the same refund shown two ways — flat in checking (earns nothing) vs. parked in savings with a fixed monthly "paycheck" auto-transferring into checking (earns interest on the declining balance as it draws down). The gap between the two lines is real, quantified, honestly small — no flat-balance overstatement.
- **The read-out.** Plain-English paycheck number ("many students in your spot pay themselves about $X a month"), sourced from a real aid-office formula (refund ÷ months to next refund), never phrased as advice.
- **Dated big costs.** Step 1/2, COMLEX Level 1/2-CE, ERAS, interviews, relocation — surfaced as year-aware "Suggested" cards a student confirms/edits/dismisses, each with a payment date (default: exam date − 4 months) distinct from the exam date itself, and an "already in my financial aid?" toggle so a school that bakes exam fees into cost-of-attendance never gets double-counted.
- **Reserves, not jars.** A dated cost is a claim against the one real reported balance, never a pot the app pretends to hold — status shows as a word ("on track," "not there yet," "dipped in"), never a fill-up ring or progress bar. "Safe to spend" = checking + savings − reserves − upcoming costs.
- **The return-window truth.** Surplus federal loan money can be returned within 120 days with interest and fees cancelled — quantified in real dollars saved at graduation, not just a vague tip.
- **Emergency cushion is optional and adjustable**, never a gate — no upfront question, defaults to leaning on the school's own emergency aid, and a shortfall response points to that aid or a cost-of-attendance increase instead of a "you failed" state.
- **v1 scope: dated costs + an optional emergency floor only** — free-form savings goals (e.g. "save for a laptop") are deferred to a fast-follow, not v1.

**Done when:** a student with a fresh refund can see the checking-vs-parked picture, confirm their real upcoming big costs, and get an honest "safe to spend" number — all without the app ever claiming to hold money it can't see.

<details>
<summary>Original Phase 2 scope (2026-07-01 revision) — kept for history, superseded by the shipped scope above</summary>

One integrated build. Specs already locked — build as designed: loan-capture model + snapshot + Offered≠Accepted≠Disbursed (`PRODUCT_DECISIONS.md` 2026-06-28 entries).
- **Onboarding money step (5 questions):** total borrowed so far (skippable; the one federal/non-federal toggle) · next disbursement amount + rough date · rent + fixed monthly costs · **family/partner support (monthly)** · other income (monthly).
- **Payoff screen immediately after:** projected **debt at graduation with interest** + rough post-residency monthly payment + **runway** ("$X to last until ~date"). Loan math = money math → **tests mandatory**.
- **Loans tab:** editable, user-named loans; calm "Estimate — add your loans to make this exact" badge when incomplete; offered/accepted/disbursed status field in the model from v1.
- **Home centers on the runway line** (counts down by calendar — the app looks alive without input) + **"upcoming big costs"** (Step fees, interview season — replaces the Step savings-goal rings).
- ✅ **Split "Total aid" into real Grant + Loans sections (done 2026-07-23, `PRODUCT_DECISIONS.md`).** Shipped a *cleaner* realization than this item originally proposed: rather than adding a second scalar `loans` field beside `grant` (with its own migration), the Loans tab's existing loan objects became the single source of truth and now feed spending money directly via `src/lib/aid.js` (`yearAidBreakdown`). `grant` reverts to grants/scholarships only; the Aid tab shows a read-only "Loans" line derived from the Loans tab. **No new persisted field, no schema migration, no merge-engine change** — only the *meaning* of `grant` changed. The old formula (copy-pasted in six spots, untested) is now one tested function. Runway/refunds are loan-aware (real disbursement dates), and a majority-borrowed surplus renders "borrowed" (blue, never green). Migration caveat: existing state that lumped loans into "Total aid" double-counts until `grant` is re-entered as grants-only — acceptable pre-launch (no users).

**Done when:** fresh account → debt + runway on screen in <5 min; numbers hand-checked against studentaid.gov examples.
</details>

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
