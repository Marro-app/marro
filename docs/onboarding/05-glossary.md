# Glossary

Plain-language definitions of terms you'll hear around Marro. Grouped so you can skim.

## Med-school & money terms

- **MD / DO** — the two kinds of doctor degrees in the US. Both make you a physician. Marro serves students in either kind of program.
- **Financial aid letter / aid package** — the document a school sends telling a student how much aid (loans, grants) they're eligible for and what school will cost. It's notoriously hard to read. Turning it into a usable plan is Marro's core job.
- **Student loans** — borrowed money that pays for school and living costs, repaid later (with interest). Med students borrow a lot.
- **Federal vs. private/institutional loans** — federal (government) loans have publicly known interest rates Marro can look up automatically; private or school loans have rates the user must provide. Marro's "loan snapshot" only needs details for the non-federal ones.
- **Interest** — the extra cost of borrowing; a loan grows over time until it's paid off. "Debt at graduation with interest" means what you'll actually owe, not just what you borrowed.
- **Offered ≠ Accepted ≠ Disbursed** — three different loan amounts. *Offered* = what you're allowed to borrow; *Accepted* = what you agree to take; *Disbursed* = what's actually paid out and becomes real debt. Marro is careful never to treat an offer as debt you owe.
- **Runway** — how long your money will last before it runs out (e.g. "$X to last until about [date]"). One of Marro's two headline numbers.
- **Board exams / Step exams** — expensive, high-stakes medical licensing exams on a known schedule. Marro plans for these "big upcoming costs" in advance.
- **Rotation / interview season** — later phases of med school with their own predictable expenses (e.g. travel), which Marro also plans for.
- **Burn** — how fast money is being spent. "Actual burn vs. plan" = how your real spending compares to your budget.

## Product & company terms

- **PWA (Progressive Web App)** — a website that behaves like an installed app: works offline, feels app-like, but needs no app store. Marro is one today.
- **Tab** — a labeled section of the app you switch between (like browser tabs). Marro was simplified to a few visible tabs; others are hidden but still built.
- **Hidden (feature) flag** — a switch that turns a feature off without deleting it, so it can be brought back later. Several tabs (Weekly, Savings, Charts, Subscriptions) are hidden this way.
- **Onboarding** — the short setup a new user goes through the first time (school, program, money basics).
- **Check-in** — Marro's planned monthly touchpoint: one question, "what's your checking balance right now?", from which it updates everything.
- **Digest** — a short summary (planned as a weekly email) of your numbers, requiring no effort from you.
- **Growth rings** — Marro's tree-ring visual, used as the logo and throughout the app to show progress.
- **Closed beta** — a small, invite-only test with real users before a public launch.
- **Grandfathering** — keeping early users on their original (free/cheaper) terms when paid pricing later arrives, as a thank-you.
- **Ambassador / founding-member program** — the growth plan: give engaged students at each school perks (a badge, free premium, real input) in exchange for helping spread the word.
- **Benchmarking** — a planned feature: "see how you compare to students at your school," built only from group statistics, never any individual's data.

## Trust, data & legal terms

- **Personal info / individual records (Lane A)** — a specific person's own numbers (their debt, budget). **Never sold, never shared.** A hard line.
- **True aggregates (Lane B)** — group statistics (medians, ranges, counts) where no single person can be identified. The *only* kind of data that may ever be used more broadly, and even then it's disclosed in the privacy policy.
- **"We never sell your personal info"** — the exact promise Marro makes. (It deliberately avoids the absolute "we never sell your data," which would be false the moment any aggregate is ever used.)
- **Privacy policy / Terms of Service (ToS)** — the legal documents (`privacy.html`, `terms.html`) stating what Marro does with data and the rules of using it. They must always match the app's actual behavior.
- **CCPA / CPRA** — California privacy laws that give users rights over their data (since the founder is in California). They require disclosures and opt-outs.
- **GDPR** — the European equivalent; the reason "delete my data" and "download my data" features are expected.
- **Account deletion & data export** — letting a user erase everything or download their own data. A trust and legal must-have.
- **Delaware C-corp** — the standard type of US company startups form; the plan for officially incorporating Marro. ("C-corp" is a corporation type; "Delaware" is the usual state to register in.)
- **Vesting** — earning your ownership stake gradually over time (e.g. 4 years) instead of all at once. Standard for founders.
- **Equity / cap table** — equity = ownership of the company; the cap table is the list of who owns what.
- **Sponsored / partner offer** — content from a third party, always clearly labeled as such, never disguised as Marro's own advice.

## Technical terms (you won't need to *do* any of this — just recognize the words)

- **Repo (repository)** — the central folder, on GitHub, holding all the app's code and planning docs.
- **GitHub** — the online service where the code lives and changes are reviewed/approved.
- **PR (pull request)** — a proposed change to the app, reviewed and approved before it goes live. The team's "unit of progress."
- **Deploy / push to main / ship** — publishing changes so they go live on the real website. Marro requires both founders to agree before shipping.
- **Supabase** — the outside service that stores each user's data and handles Google sign-in.
- **RLS (Row-Level Security)** — the security mechanism ensuring each user can only ever see their own data. It's what makes "your numbers stay yours" technically true.
- **Vercel** — the service that runs the website and (later) the behind-the-scenes AI features.
- **Vite / React** — the technical toolkit the app is built with. Just names of the tools.
- **Sentry** — an error-monitoring service that alerts the team when the app crashes for someone.
- **OAuth** — the technical name for "sign in with Google." Getting it "verified" removes the scary unverified-app warning for new users.
- **API** — a way for software to talk to other software; here, mostly relevant to the future AI features that call an outside AI provider.
- **Model routing / Haiku, Sonnet, Opus** — for the future AI: these are different AI models with different costs; "routing" means using the cheap one by default and the expensive one only when truly needed, to control costs.
- **Accessibility / WCAG / ADA / a11y** — making the app usable by people with disabilities (screen readers, keyboard-only, high-contrast needs). Treated as the top priority on every change. ("a11y" is just shorthand for "accessibility.")
