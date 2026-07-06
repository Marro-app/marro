# Contributing to Marro

## Git identity — use a per-person alias (the repo is public)

This repo is public, and we keep contributors' real names/emails out of the commit
history. Each collaborator commits under a **distinct alias**, not their real name.

When you clone, set your identity **for this repo only** (not `--global`):

```bash
git config user.name  "YourAlias"
git config user.email "<id>+<YourAlias>@users.noreply.github.com"
```

Rules:
- **Email must be your GitHub `noreply` address** — never a personal, school, or work
  email. Find it at GitHub → Settings → Emails → "Keep my email addresses private"
  (it looks like `12345678+YourAlias@users.noreply.github.com`).
- **Name is an alias**, not your legal name. Pick one and keep it consistent.
- For true public anonymity, the **GitHub account itself should be an alias account**
  too — the noreply email contains the GitHub username, so a real-name username would
  defeat the purpose. (The founder commits as `MarroGit`.)
- Repo ownership lives in the **`Marro-app`** GitHub org; personal accounts that are org
  members should set their org membership visibility to **Private**.

Internal attribution (who did what, by real name) lives in the private
`marro-ops/` records, never in the public repo.

## Before you push

- `main` auto-deploys to Vercel on push — **don't push to `main` without the team's OK.**
- Never commit secrets. `.gitignore` blocks `.env*` and key files, but double-check.
- New Supabase table? RLS is auto-enabled (deny-all) — add `auth.uid()` policies and
  commit them to `supabase/*.sql`, or the table silently reads empty. See `CLAUDE.md` §4.
- UI changes must meet WCAG 2.1 AA and follow Apple HIG — see `CLAUDE.md` rules 7–9.

## Two founders, two Claude sessions, working at the same time

See `docs/STRATEGY.md` §7 for the why (branch protection + mutual PR approval).
This is the concrete day-to-day routine.

- **Branch naming:** `yourname/short-feature-name` (e.g. `mohamad/loan-snapshot`,
  `ethan/csv-import`). Whoever starts a feature creates the branch off latest `main`,
  works there, and opens a PR when ready.
- **The PR is NOT a wait-for-the-other-founder review gate** (revised 2026-07-06).
  Neither of us reads raw diffs, so a "please approve my PR" step was just theater —
  we were rubber-stamping our own PRs anyway. What the PR is actually for, and why we
  still branch instead of pushing straight to `main`:
  1. **Preview deploy** — Vercel builds every branch to a temporary preview URL. That's
     how you click-test the *real running app* before it's live on joinmarro.com — the
     actual safety net for people who can't read code. Never skip it.
  2. **CI checks** — build/lint must pass before merge.
  3. **A `/code-review` pass by Claude** — the real correctness/security review, the
     substitute for reading the diff. Ask your Claude session to run it on anything
     non-trivial (`/code-review`, or `/code-review ultra` for bigger/backend changes).
  4. **No-clobber** — a branch keeps your parallel session from stepping on the other
     founder's work on `main`.

  Flow: branch → push → test the preview URL → (Claude `/code-review` if it matters) →
  **merge it yourself** the moment it looks good. No waiting on the other founder.
  Still **never push directly to `main`** — it auto-deploys to production with no
  preview-test buffer, and it's where parallel sessions collide.
- **Before starting work, check what the other founder is mid-flight on:** run
  `git branch -r` (or check GitHub's branch/PR list) and skim the last few entries in
  `docs/PRODUCT_DECISIONS.md`. Tell your Claude session to do this at the start of a
  session — "check what Ethan's been working on" only works if there's somewhere to
  look, and both of these already exist with zero new process.
- **Log the start/finish of a feature in `docs/PRODUCT_DECISIONS.md`**, same as every
  other decision already logged there (rule 6 in `CLAUDE.md`) — one line is enough
  ("started `ethan/csv-import`, touches `src/tabs/WeeklyTab.jsx`"). This is the one
  new habit; everything else reuses existing tools.
- **Avoid same-file collisions:** before touching a shared file (`AppContext.js`,
  `App.jsx`, `index.html`), do a quick check (git log / PRODUCT_DECISIONS.md) or a
  one-line Slack/text to the other founder. Keep PRs scoped to one feature/file area
  rather than sprawling edits — smaller PRs both avoid conflicts and are faster to
  review.
- **Merge conflicts** (when both people changed the same lines) are surfaced by git,
  not resolved silently — a human has to pick which version wins or combine them.
  Ask Claude to explain the conflicting hunks in plain language before resolving.
