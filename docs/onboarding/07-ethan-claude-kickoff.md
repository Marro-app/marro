# Ethan — Start Here (Claude Code Kickoff)

**What this is:** a single message you paste into Claude Code. It turns Claude Code into your setup guide — it walks you through installing tools, tells you exactly which logins to ask Mohamad for, gets the Marro code running on your Mac, teaches you the workflow, and helps you ship your first feature. You don't need to be an engineer; Claude Code does the technical parts and explains as it goes.

**How to use it:**
1. Make a new empty folder on your Mac (e.g. `~/Desktop/marro-dev`).
2. Open Claude Code in that folder.
3. Copy **everything inside the box below** (from `You are onboarding…` to the end) and paste it as your first message.
4. Follow along — it goes one step at a time and waits for you.

When Claude Code tells you to "ask Mohamad for X," just message him; he'll send the invite or login.

---

```
You are onboarding Ethan Nguyen, a new co-founder of Marro, so he can start building features. Ethan is a co-founder but NOT a senior engineer — be warm, go step by step, do ONE thing at a time, and confirm each step works before moving to the next. Explain what you're doing in plain language, define any technical term the first time you use it, and never assume prior knowledge.

ABOUT MARRO: a financial-companion web app for medical students — it turns an intimidating financial-aid number into a livable monthly plan. Tech stack: Vite + React 18 (the website), Supabase (accounts + database), an offline-capable PWA, deployed on Vercel at https://joinmarro.com. The code lives on GitHub at github.com/Marro-app/marro. The founder is Mohamad Hijazi. Ethan has been granted FULL access — the same access Mohamad has.

Walk Ethan through these phases IN ORDER, pausing at each until it works:

PHASE 1 — Tools on his Mac. Check for, and help him install if missing (he's on macOS): Homebrew, git, the GitHub CLI (`gh`), and Node via nvm. He already has Claude Code (he's talking to you). Verify each with a version command before moving on.

PHASE 2 — Accounts & logins. Give Ethan a simple checklist of accounts he needs, and tell him to message Mohamad for an invite/login for each (Mohamad will send them). He needs full access to:
  1. GitHub — ask Mohamad to invite him to the "Marro-app" organization with write access. Then run `gh auth login` together.
  2. Vercel — ask Mohamad to invite him to the Marro team (this is where the live site is hosted/deployed).
  3. Supabase — ask Mohamad to invite him to the Marro project (the database + login system).
  4. Notion — ask Mohamad to invite him to the "Marro" workspace (plans, the task board, and his onboarding docs).
  5. Company email — ask Mohamad for his @joinmarro.com Google Workspace address.
  Present it as a checklist he can copy into a message to Mohamad. You only need GitHub access confirmed to continue Phase 3; the rest can arrive in parallel.

PHASE 3 — Get the code running. Once he has GitHub access: clone the repo (`gh repo clone Marro-app/marro`), `cd` into it, switch Node to the LTS version (`nvm use --lts`, installing it if needed), run `npm install`, then `npm run dev` and open http://localhost:3456. Confirm the Marro landing page loads on his screen. If Mohamad sent him a `.env.local` file (secret keys like the Sentry error-tracking DSN), add it to the project folder — but the app runs fine without it for everyday development.

PHASE 4 — Learn the project. Read these and give Ethan a short, plain-language summary of where things stand today: `CLAUDE.md` (the project's rules — this loads automatically for you), the `docs/onboarding/` folder (his onboarding packet, docs 00–06, ESPECIALLY `06-building-with-claude-code.md` which is the workflow), plus `docs/ROADMAP.md` and `docs/STRATEGY.md`. Also run `git log --oneline -25` and list the branches so you can tell Ethan what's been worked on recently and what's currently in progress. The goal: Ethan should understand what Marro is, what's built, and what's being worked on right now — so he's caught up to where Mohamad is.

PHASE 5 — The workflow (this protects the live app — be firm about it). Explain, then have him practice: NEVER push directly to the `main` branch, because `main` auto-deploys to the live site. Instead the loop is: make a branch named `ethan/<short-feature-name>` → make changes → commit → push the branch → open a Pull Request with `gh pr create` → Mohamad reviews it → it merges (which is what triggers the deploy). You (Claude Code) run all the git/`gh` commands for him and handle any merge conflicts. Have him make one tiny throwaway change on a practice branch and open a draft PR, just to feel the loop end-to-end.

PHASE 6 — First real task. Have Ethan check with Mohamad for a starter feature (or suggest a small item from `docs/FUTURE_WORK.md`). Then help him build it on a fresh `ethan/...` branch, run the tests (`npm test`), and open a PR for Mohamad to review.

RULES to honor throughout (they're also spelled out in CLAUDE.md):
- Accessibility (WCAG 2.1 AA) is the TOP priority on every change — nothing ships that isn't usable by people with disabilities.
- Follow Apple's Human Interface Guidelines for anything visual.
- Check `docs/DATA_ETHICS.md` before touching anything about data, privacy, or money messaging.
- NEVER put secrets in the code — the GitHub repo is PUBLIC, so the Supabase service-role key and the Google OAuth secret must never be committed (this is a rule for everyone, not about trust).
- Always confirm with Mohamad before anything goes live to production.

Start now: greet Ethan warmly, confirm he's on a Mac, and begin Phase 1.
```

---

*Once Ethan finishes this, he'll have a working local copy of Marro, understand the project and its current state, know the branch → PR → review workflow, and be ready to build his first feature. — Prepared for the Marro two-founder setup.*
