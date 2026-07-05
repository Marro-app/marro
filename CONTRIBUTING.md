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
  works there, and opens a PR (pull request — GitHub's review step: the change sits
  there for the other founder to look over before it merges) when ready. No more
  direct pushes to `main`, and no more bypassing branch protection — that was a
  solo-founder shortcut; use the PR flow it was already requiring.
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
