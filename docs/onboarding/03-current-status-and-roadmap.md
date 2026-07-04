# Current Status & Roadmap

*Snapshot as of the plan revised 2026-07-01. This translates the team's internal roadmap out of jargon. When in doubt, the live source is `docs/ROADMAP.md`.*

## Where things stand today, in one paragraph

The app is **built and live** at joinmarro.com. The core budgeting experience works, users can sign in with Google, and their data is saved securely and privately to their own account. The team has just finished a big **"simplify and strengthen the foundation"** phase — trimming the app down to a few clear tabs and shoring up the engineering so future features (especially AI) can be added safely. The next major push is the **money core**: turning loan and aid numbers into a real "here's your debt and how long your money lasts" answer. The app is **not yet open to the public at scale** — a few trust and sign-up pieces come first.

## Already shipped (done and working)

- **The core budgeting app** — monthly plan, spending by category, charts.
- **Savings goals and charts** (now hidden but built).
- **A full visual redesign** — the calm, Apple-style "growth rings" look, light and dark modes, custom icons.
- **Sign-in and private cloud saving** — Google login; each user's data stored privately and synced across their devices, protected so no user can ever see another's data.
- **School-agnostic setup** — works for any US med school, with the full MD/DO school list and support for dual-degree programs and variable program lengths.
- **A strengthened technical foundation** — the app was re-organized under the hood so it's faster to work on, plus automated tests on the most important math (the money calculations and the data-syncing engine) and automatic error monitoring so crashes are caught quickly.
- **A new scrolling landing page** — the public "front door" that tells Marro's story (replacing the old plain login screen).
- **The simplification pass** — cut down to a few visible tabs, folded subscriptions into the budget, added the "quick add" expense button, moved category editing into settings.

## In progress right now (the "open the doors" phase)

This phase is about making it safe and possible for a stranger to join on their own. Most of it is trust and paperwork rather than flashy features:

- **Google sign-in verification** — getting Google's official approval so new users don't see a scary "unverified app" warning. Almost everything else is waiting on this review.
- **An invite gate** — the ability to control who can join at launch.
- **Usage tracking** — quietly recording key actions (sign-ups, setup completions, check-ins) so the team can see how real people use the app. No numbers are invented here — it's about being able to measure at all.
- **Account deletion and data export** — letting users delete everything or download their own data. This is both a trust promise and a legal expectation.
- **Legal/privacy review** — having the privacy policy and terms reviewed (by a free university legal clinic).

## Near-term priorities (what's next, roughly in order)

1. **The money core** — the flagship next build. A short "loan snapshot" at setup, then a screen that shows: projected **debt at graduation** (with interest), a rough post-training monthly loan payment, and **runway** ("you have $X to last until about [date]"). This is what fills in the two placeholder numbers (Runway and Debt) at the top of the app. Because this is money math, it must be carefully tested and checked against official government examples.

2. **The monthly rhythm** — a **once-a-month check-in** asking only *"what's your checking balance right now?"*, plus an optional **weekly email digest** that requires zero effort from the user (just the computed numbers). Designed to be forgiving if a month is skipped.

3. **A closed beta with real strangers** — inviting roughly 20–30 med students across several schools, watching how they use it, and interviewing some. There's a **pre-agreed honesty checkpoint**: if too few non-friends stick around after a couple of rounds of fixes, the team pauses adding features and rethinks the core, rather than plowing ahead. This discipline is deliberate.

## Later (planned, not started)

- **AI features**, added carefully and only after the beta proves the core works. The first AI job is writing the weekly digest. Strict safety and cost limits are required *before* any AI feature turns on. Everything the AI suggests is shown as an unconfirmed "Suggested" item the user must approve — it never silently changes data, never moves money, and never invents financial/loan policy.
- **Effortless expense capture** — snap a photo of a receipt, or speak an expense, and have it filled in for you to confirm.
- **Growing school by school** — an ambassador/founding-member program per school, benchmarking ("see how you compare to students at your school") once a school has enough users, and eventually a public launch.
- **Heavier tools** — a loan repayment simulator, interview-season budgeting, specialty-specific financial outlooks, and a true phone-app version.

## A few things intentionally *not* being done (so you don't propose them as new)
- A chatbot / "ask it anything" assistant — deliberately avoided for now.
- Bank-account linking — only if users clearly demand the detail, much later.
- A voice "operator" assistant and a mascot character — both cut.
- Formal company incorporation and equity paperwork — parked until a cofounder commitment is real (see doc 04 — this is where you come in).

## How to read the team's own docs (optional)
If you ever want the primary sources: `docs/ROADMAP.md` is the current build plan, `docs/STRATEGY.md` is the "why" behind it (business, money, people), `docs/HISTORY.md` is the archive of what's already done, and `docs/DATA_ETHICS.md` is the binding set of rules for how user data is handled. These are written for the team and are more technical than this packet.
