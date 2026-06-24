# Marro — Strategy (company / business / AI vision)

The founding strategy doc. `ROADMAP.md` = build phases; this = the *why* and the company layer (product vision, monetization, people/equity, legal, infra hygiene, go-to-market). Captured from a June 2026 strategy session. Decisions logged in `PRODUCT_DECISIONS.md` as they firm up.

> **Guiding principle:** at ~zero users the scarce resources are *founder time, equity, and trust* — not AI capability (anyone can call the same API). The moat is **trust + med-student specificity + per-school density**. Sequence everything to protect those. The AI layer sits on a lightweight foundation that must be reinforced *just ahead of* each feature that leans on it.

---

## 1. AI capability menu (the product vision)

Grouped by build difficulty. See ROADMAP Phase 4 for sequencing.

**Tier 1 — uses data the user already has (no new infra beyond the AI backend):**
- Spending anomaly detection (first feature) + trend spotting
- **Good-habit recognition / praise** — weighted as heavily as warnings so the app never feels like surveillance (fixes "don't make users dread it")
- Habit-pattern → cheaper-alternative suggestions, with the cost breakdown shown
- Time-pressure inference from spending shape (delivery↑/grocery↓ ⇒ swamped) — adjusts advice without asking
- Forecasting / "what if" (shortfall prediction, goal-pace projections)
- Budget-breakdown recommendations; goal auto-fill (Step-exam targets from program data)
- **Proactive check-ins** ("did you actually move that $100 to savings?") — keeps data current + nudges follow-through; carefully timed, capped frequency, one-tap response
- Savings-growth projections via self-reported balance + **publicly-looked-up APY** (the "lite" bank feature — no account linking, big trust win)
- On-demand Q&A chat
- True-cost-of-borrowing reframing — **opt-in, framed as "future-you gains" not "you lose," never per-transaction nagging**

**Tier 2 — needs a new input type (still the user's own data):**
- Receipt scanning, aid-letter scanning (multimodal)
- Voice / natural-language expense entry
- "Jarvis" operator mode — voice/text commands that navigate/reconfigure the UI (instant for reversible UI actions; confirm-first for anything touching money). Doubles as an accessibility win.

**Tier 3 — needs external/live data (hardest, highest differentiation):**
- Local pricing & deal awareness (Claude web-search tool + user's zip/school)
- Calendar/term-date & disbursement-date lookup (web search; ask the user only when confidence is low)
- **Disbursement-gap warnings** (highest-value loan-aware feature)
- Scholarship/grant search + deadline tracking; student-discount audit
- Tax-timing education for low/no-income years (Roth-IRA-while-low-bracket) — must teach in plain language
- Cohort features (group-buying, benchmarking) — proactive/predicted from program-stage, opt-in, anonymized; needs per-school density

**Loan-aware differentiators (the real moat — only possible because med-student-specific):** true-cost reframing; borrow-less-at-decision calculator (⚠️ never let AI invent loan policy — math only on user-entered terms + cite authoritative sources + "confirm with your aid office"); disbursement-gap warnings; time-aware side-income matching (respect school work restrictions + time pressure).

**Dropped for now:** residency-transition planning (already in ROADMAP backlog).

### AI hard guardrails (apply to ALL AI work)
- Never silently writes data — renders as pending "Suggested" (blue token) per CLAUDE.md rule 9; user confirms; confirmation goes through the normal `upd()` path (charts update for free).
- Never invents loan/tax/financial policy — confirmed numbers or cited sources only.
- Never moves money / initiates transfers — read-and-advise only.
- Investment guidance stays **general education**, never personalized "buy X" (⚠️ regulatory line — clinic/lawyer before going beyond education; consider referral to a licensed partner).
- Written **"never make the user feel judged"** voice guide + a **communication budget** (cap proactive touchpoints; back off on non-response; batch into high-info questions).
- An **off switch** to disable all AI.

---

## 2. Foundation work (infra the vision requires — mostly precedes the AI features)

- **Build-system migration** (single file → Vite + components). Incremental (get existing file building first, then split out), its own phase, nothing riding on it. Enables: native path, tests, cache fix, sane multi-surface AI. **DECIDED: migrate first.**
- **App/compute backend** (Supabase already covers data/auth): Vercel serverless fns for the AI proxy (holds keys, model routing), secrets, usage-tracking + rate-limiting, web search, future bank integration, and a **scheduler/cron** for digests/check-ins/disbursement warnings (genuinely new — app has no "act when user isn't here" today).
- **Service-worker / cache fix** — version + force-update so users reliably get fresh code; auto-refresh at a *safe moment* (never mid-edit). Best done during the build migration (fingerprinting makes it near-free). Recurring pain today; becomes a real bug class once client/server contracts exist.
- **Automated tests + monitoring** — prioritize the sync/merge engine, money math, AI guardrails; error tracking (Sentry) + cost/usage dashboard (spikes surface in hours).
- **Minimal admin/observability dashboard — EARLY (Phase 1).** Build *as* you build so you're never flying blind: errors, AI calls, costs, engagement/response-to-suggestions. Start minimal. Later becomes an **aggregator** (GitHub/deploy/error/cost → webhooks → one in-app feed) rather than reinventing GitHub's review/deploy gates.
- **Retire hard-coded suggestions when AI lands** — the "Key notes" block etc. Two competing advice systems feel inconsistent; track removal as an explicit AI-phase task.
- **Cost controls (day one, non-negotiable):** trigger-based (not polling), summarized/diffed payloads (not raw dumps), caching (client + server fingerprint), model routing (Haiku cheap checks / Sonnet complex). Soft usage pool (free) + optional BYOK. Stay on Anthropic for now (data-sensitivity + reliability + first-party web search > cheaper third-party; revisit with real usage data).

## 3. Platform
- **Web first** (works everywhere, instant updates, friends get a link today).
- **Native later via wrapper (Capacitor)** — one codebase, App/Play Store + reliable push + Siri/voice path. The lever for OS-level voice control and reliable rich push. Not day one.
- **Notifications:** mixed — try push, fall back to in-app if ignored; iOS web-push is weak (another reason native eventually matters).

---

## 4. Monetization
- **Free first, no barrier** → grow + validate + build trust BEFORE monetizing. When paid launches, avoid backlash: **grandfather early users** (founding-members free/discounted forever) + make paid tier mostly *new* value. Payments via **Stripe**.
- **AI in EVERY tier (core/the hook), differentiated by DEPTH not presence.** Free = bounded AI (soft pool + Haiku + caching cap cost = acquisition cost). Paid = unlimited + *expensive* AI (web-search local suggestions, frequent checks, agents, forecasting, bank/APY). Resolves "everyone gets AI" vs "free users shouldn't burn money."
- **ROI "make your money back" dashboard (HEADLINE feature) — MUST be concrete, never BS.** Hard rule: separate **EARNED** (actual dollars that arrived — scholarships won, gigs paid, bonuses received, real interest earned) from **SAVED** (money not spent — discounts, cheaper alternatives). Never blend or call savings "money made." Only count what actually happened + is attributable (no hypotheticals). Lead with EARNED; SAVED is an honest secondary line. Conservatism = trust asset.
- **Third-party revenue where the STUDENT also wins** (not attention-ads): sponsored opportunities (companies reach students / students get gigs), financial-product referrals via *licensed* partners, deals/discounts marketplace. Med-student → future-physician audience is valuable to partners.
- **Unbreakable rule:** monetization NEVER contaminates the trusted advisor — sponsored content clearly labeled, separate space; advice is never for sale.

## 5. People & equity
- **Founding-member / ambassador program** (the growth engine, near-zero cost): badge, free premium for life, *visibly* let feedback shape the product (real ownership driver), public credit, referral rewards. NOT co-founder equity. Use friends across schools as multi-school design partners.
- **Real (vested) equity for the committed coding cofounder.** Recommendation: **~65/35 founder-favor** (range 60/40–70/30) — founder's idea + large chunk already built (originator premium) + driving force; 35% keeps cofounder substantial/motivated (under ~30% erodes ownership feeling).
- **Operations = equal/peer** (full app transparency, mutual deploy approval — §7). **Equity ≠ 50/50** (avoid deadlock).
- **Vesting (his share; consider founder's too):** 4yr / 1yr cliff (nothing until 1yr, then 25% at once, rest monthly over yrs 2–4; leave early → keep only vested). Matches equity to who shows up; investors require it.
- **Funding — BOTH put in cash (founder more, sometimes equal). Cofounder is sweat AND investor — keep separate.** Equity = for work. Cash = **shared contributions ledger** (who/how much/when, in Notion), treated as **documented loans repaid from future revenue.** Don't let cash inflate equity (double-counting).
- **SAFE** (Simple Agreement for Future Equity, YC) = for *external investors* later; not needed between the two cofounders — tracked loans are cleaner.

## 6. Legal / compliance / infra hygiene
- **Incorporation — Delaware C-corp** (right long-term home given equity + funding + buyout ambitions; LLC→C-corp conversion is annoying). *Why:* liability shield (big for a financial app) + required to grant equity/take cash/investment + legitimacy + tax. *When:* SOON — before granting cofounder equity / both putting cash in / public launch. *How:* Stripe Atlas (~$500) or free clinic below.
- **Free legal resource (founder in 92807, Orange County CA):** **UC Irvine Law Startup & Small Business Clinic** — free; covers formation/incorporation, contracts, hiring (law students + supervising attorney; walk-in office hours via UCI ANTrepreneur Center). Contact: Debi Gloria, dgloria@law.uci.edu, (949) 824-9646. Backup: Western State College of Law Entrepreneurship Clinic. (Claude preps founder; not a lawyer.)
- **Liability:** real ToS + "educational, not professional advice" disclaimers BEFORE launch (domain touches loans/taxes/money).
- **Privacy:** California ⇒ **CCPA/CPRA applies** (data rights; sharing/selling needs disclosure + opt-out/opt-in). Privacy policy must cover "summaries sent to a third-party AI provider"; account-deletion wipes AI tables too. SOC 2 eventually (premature now).
- **Anonymized-data-as-asset (consent-first, privacy-by-design):** valuable revenue + benefits users (benchmarking) + relevant to acquisition, BUT highest-risk-to-trust. (1) opt-in + transparent (CCPA-required); (2) **true aggregation, not de-naming** — only expose aggregate stats, only when buckets are large enough no individual is identifiable; individual records NEVER shared; (3) architecture: locked-down raw layer + *separate* aggregation layer; third parties touch only the aggregate layer; (4) acquisition value is really the live user relationships + data pipeline, not historical data.
- **Company identity & account hygiene (do now, before cofounder):** migrate OFF personal email → register a domain (~$12/yr) + business email (free forwarding/Zoho now → Google Workspace later), role addresses (founder@/support@/admin@). All infra on **Marro-owned accounts** (GitHub org, Vercel team, Supabase, domain, Anthropic billing) under the company email. Claude stays personal. Entity formally owns these at incorporation.
- **Backups + bus-factor** ("bus factor" = how many people must vanish before the project collapses; raise it). **FREE now:** password manager (Bitwarden) w/ shared company vault for cofounder emergency access, 2FA + backup codes, recovery email/phone per account, secure break-glass doc. **CHEAP soon:** domain. **DEFER until real users:** Supabase Pro backups (~$25/mo — MANDATORY once real financial data exists; free tier fine for test data), Vercel Pro (~$20/mo — free Hobby fine pre-commercial). Real costs (~$45/mo + incorporation) kick in ≈ when real users + cofounder-equity arrive.

## 7. Two-founder collaboration & access model (founder + 1 coding cofounder, each via own Claude Code)
**Intent: full app transparency + equal/peer operations.** Only private layer = founder's *personal owner-level business strategy* (lives in founder's own notes, not the repo).
- **Mechanics:** one shared GitHub repo; each runs their own Claude Code on their own clone; collaborate via branches + PRs.
- **Mutual deploy approval (both agree to ship — native tooling, don't build custom):** branch protection w/ required review (with 2 people, the other must approve); GitHub **Environments** deploy-approval listing both → prod won't deploy until both sign off.
- **In the loop without meetings:** shared **Notion hub** NOW (roadmap + task board + auto-updated progress log + funding ledger) → graduates into the admin-panel aggregator later; PRs as the progress unit; **Claude drafts the end-of-session progress log** automatically.
- **Git/GitHub handled by Claude Code (the "agent that helps")** — neither founder needs Git expertise; founders keep only the approve/ship judgment calls.
- **Secrets safe by mechanism:** keys in env vars / Vercel, never in the public repo; cofounder builds against own/dev keys; separate Supabase dev/staging project so cofounder tests on fake data; commit `.env.example` (names, no values); confirm no secret ever hit git history.

## 8. Open considerations (act on the early ones soon)
1. **Validate willingness to PAY (biggest risk)** — ask friends "would you pay $X/mo?", watch behavior. Cheapest insurance against building the wrong thing.
2. **Pricing** — broke audience ⇒ price-sensitive (~$5–10/mo, student discount, annual). Needs testing.
3. **Liability disclaimers** before launch (above).
4. **Success metrics** — pick 2–3: **retention** (weekly return — THE habit-app signal), engagement depth, willingness-to-pay/conversion, organic referrals, the ROI metric. *Working rhythm:* async-first + one short weekly sync + loosely-defined area ownership.
5. **Acquisition (outcome, not a plan)** — acquirer buys the entity; shareholders paid in proportion to ownership (why the cap table matters). Attractive because med students → physicians = highest-income/highest-debt, hard-to-reach demographic; owning the relationship early is valuable to banks/fintechs/physician-finance/loan companies. Build users + retention + defensible niche; interest follows. Don't optimize for it.

## 9. Still-open product decisions (defer to when AI Phase 2 starts)
Usage-pool size + reset period; BYOK transport (proxy vs. client-direct); anomaly sensitivity; first AI feature's card placement (Budget vs Weekly tab).
