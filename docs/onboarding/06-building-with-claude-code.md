# 06 — Building With Claude Code (Two-Founder Workflow)

This doc is for **Ethan** (and for Mohamad, so both are on the same page). It covers how the two
of you build Marro features at the same time using Claude Code, without breaking each other's
work or accidentally breaking production (joinmarro.com).

Read this once fully before your first PR. It extends `00-welcome.md` through `05-glossary.md` in
this folder.

---

## Why this doc exists

Today, `main` auto-deploys straight to joinmarro.com the moment someone pushes to it (see
`CLAUDE.md`: *"push to `main` deploys immediately"*). That's fine with one person. With two
people pushing directly to `main`, it's dangerous:

- Ethan's half-finished change could go live and break the app for real users.
- Mohamad's and Ethan's changes could overwrite each other.
- Neither of you would get a chance to catch the other's mistakes before they ship.

`docs/STRATEGY.md` section 7 already calls for **mutual deploy approval** — both founders agree
before anything ships. This doc makes that concrete.

---

## 1. The concurrent-dev workflow (the core loop)

**Golden rule: nobody pushes to `main` directly. Everybody works on a branch, opens a Pull
Request (PR), gets it reviewed, then merges.** Merging to `main` is what deploys — so "merge"
and "deploy" become the same moment, and the review step is your deploy approval gate.

### The everyday loop

```bash
# 1. Make sure your main is up to date before starting anything new
git checkout main
git pull origin main

# 2. Create a short-lived branch for ONE feature or fix
git checkout -b ethan/add-expense-filter

# 3. Do the work (with Claude Code). Commit as you go.
git add -A
git commit -m "Add category filter to expense list"

# 4. Before opening a PR, sync with any changes that landed on main while you worked
git checkout main
git pull origin main
git checkout ethan/add-expense-filter
git rebase main
# (fix any conflicts — see below — then:)
git push origin ethan/add-expense-filter

# 5. Open the PR
gh pr create --title "Add category filter to expense list" --body "What it does + how you tested it"

# 6. Mohamad (or Ethan, for Mohamad's PRs) reviews on GitHub, leaves comments or approves
gh pr view --web   # opens it in the browser to review/comment

# 7. Once approved, merge — THIS is what triggers the Vercel deploy
gh pr merge --squash

# 8. Clean up
git checkout main
git pull origin main
git branch -d ethan/add-expense-filter
```

Branch naming: prefix with your name, e.g. `ethan/...` or `mohamad/...`, so it's obvious at a
glance whose work is whose.

### Rules of thumb

- **Keep branches short-lived** (hours to a couple days, not weeks). Long-lived branches drift
  from `main` and cause painful conflicts.
- **Keep PRs small** — one feature or fix per PR. Small PRs get reviewed faster and are safer to
  revert if something's wrong.
- **Pull/rebase onto `main` often** — at minimum right before opening a PR, and again if `main`
  moves while your PR is open. This is how you "stay in sync" with the other person.
- **Never merge your own PR without the other person's approval** (this is the "mutual deploy
  approval" from STRATEGY.md, made real via GitHub's review requirement — see Open Decisions
  below for making this enforced rather than just a norm).
- **Deploys = merges to `main`.** There's no separate "deploy button" — Vercel is already wired to
  auto-deploy on push to `main` (that's the existing setup; it doesn't change, it just now only
  happens *after* a reviewed merge instead of on every direct push).

### Handling merge conflicts (simple version)

Conflicts happen when you and Mohamad both changed the same lines. To resolve:

```bash
git checkout main && git pull origin main
git checkout ethan/your-branch
git rebase main
```

Git will pause on any file with a conflict and mark it like this:

```
<<<<<<< HEAD
(the version from main)
=======
(your version)
>>>>>>> ethan/your-branch
```

Open the file, decide what the final version should look like (often it's "keep both changes"),
delete the `<<<<<<<` / `=======` / `>>>>>>>` marker lines, save, then:

```bash
git add <the file you fixed>
git rebase --continue
git push origin ethan/your-branch --force-with-lease   # rebase rewrites history, so force-push your OWN branch
```

If a conflict looks confusing or risky (e.g. it's in `supabase/*.sql`, auth code, or money-math
logic), **stop and ask Mohamad rather than guessing** — some files are worth a second pair of eyes
even just for the conflict resolution.

**Tip: tell your Claude Code to do the git mechanics.** Per STRATEGY.md, you're not expected to
be a git expert — you can literally ask your Claude Code "rebase my branch on main and resolve
any simple conflicts, ask me about anything unclear" and it will run these commands for you.

### Who can merge / deploy

Both of you can **open** PRs any time. A PR should only be **merged** (which deploys) after the
*other* founder has reviewed and approved it. See Open Decision #2 below on making this a hard
requirement instead of an honor system.

---

## 2. Access checklist

What Mohamad needs to **grant** Ethan, and what Ethan sets up **himself**. For each: why, and the
risk if skipped.

### Mohamad grants Ethan

| # | What | Why | Risk if skipped / done wrong |
|---|------|-----|-------------------------------|
| 1 | **GitHub org membership** — invite `Ethan` to the `Marro-app` org with **write** access to the `marro` repo (not admin) | Write access lets him push branches and open PRs; not admin means he can't change repo settings or branch protection alone | Admin access would let one person quietly disable the safety rails this doc sets up |
| 2 | **Vercel team access** — DECISION NEEDED (see Open Decisions #1) | Determines whether Ethan can trigger deploys/see prod env vars, or only see build logs | Full Vercel access exposes env vars/secrets in the Vercel dashboard, not just deploy ability |
| 3 | **Supabase dashboard access — read-only / limited**, e.g. Table Editor read access to non-sensitive tables, or just the SQL migration files in the repo | Lets Ethan understand the data model without needing to touch production data or auth config directly | Full Supabase project access exposes the **service-role key** (bypasses RLS entirely) and project settings — never give this |
| 4 | **Company email** (e.g. `ethan@joinmarro.com` or similar) | Professional identity, used for GitHub/Vercel/Notion/Supabase invites | N/A — just provisioning |
| 5 | **Notion HQ access** — invite to the shared 📌 Marro page | Keeps him in the loop on roadmap/tasks/progress log without meetings, per STRATEGY.md | N/A |
| 6 | **A `.env.local` with DEV-ONLY values** (see Ethan's setup, step 5) — never the production `.env` | Lets him run the app locally against safe test data | Sharing prod secrets in a Slack DM / email defeats the whole point of env-var-based secrecy |

### Ethan sets up himself

| # | What | Why |
|---|------|-----|
| 1 | **His own Claude Code install + Anthropic account/billing** | Each founder runs Claude Code independently (STRATEGY.md: "each via own Claude Code") — not shared logins |
| 2 | **`gh auth login`** (GitHub CLI) | Needed for the `gh pr create` / `gh pr merge` commands in the workflow above |
| 3 | **Node via `nvm`** | See setup steps below |
| 4 | **His own local clone of the repo** | Standard — never work in Mohamad's clone/machine |

### Secrets Ethan must NEVER receive, under any circumstance

- **Supabase service-role key** — this bypasses Row Level Security (RLS) entirely; it's the one
  key that can read/write *any* user's data, no restrictions. RLS is the app's entire security
  model (`CLAUDE.md`, rule 4) — this key defeats it completely.
- **Google OAuth client secret** — used for the login flow; leaking it risks impersonation of the
  app's identity to Google.
- Any production `.env` value beyond the Supabase **publishable/anon** key + URL (those two are
  intentionally safe to have — see below).

**Safe to share freely:** the Supabase **project URL** and **publishable (anon) key** — these are
already hardcoded in `index.html` in the public repo. They're meant to be public; RLS is what
actually protects data, not hiding this key.

---

## 3. Ethan's first-time setup (step by step)

Run these in order. Copy-paste as-is except where a placeholder is shown in `<angle brackets>`.

1. **Install Claude Code** (if not already): follow Anthropic's install instructions for your
   Anthropic account. This is separate from Mohamad's — you'll have your own login/billing.

2. **Install the GitHub CLI and log in**
   ```bash
   brew install gh          # if you don't have it
   gh auth login
   ```

3. **Clone the repo**
   ```bash
   git clone https://github.com/Marro-app/marro.git
   cd marro
   ```

4. **Set up Node via nvm**
   ```bash
   nvm use --lts
   ```
   (If `nvm` isn't installed yet, install it first — https://github.com/nvm-sh/nvm — then re-run
   the above. Every *new* terminal session needs `nvm use --lts` run again before `npm` commands
   will work.)

5. **Install dependencies**
   ```bash
   npm install
   ```

6. **Get your dev environment values from Mohamad** (the Supabase URL + publishable key needed
   locally — these are the same safe values already in `index.html`, nothing sensitive). Follow
   whatever local env-file setup `CLAUDE.md` / `docs/DATA_MODEL.md` currently documents for
   Supabase config.

7. **Run the app locally**
   ```bash
   npm run dev
   ```
   Open **http://localhost:3456** (the port is pinned to match the Google OAuth redirect — don't
   change it).

8. **Open the repo in Claude Code.** `CLAUDE.md` auto-loads every session — it already contains
   the workflow rules, ADA/accessibility rules, Apple HIG design rules, and data-ethics rules.
   You don't need to re-explain these to your Claude Code; just start working and it will follow
   them.

9. **Run the tests**
   ```bash
   npm test
   ```

10. **Do your first feature using the loop from Section 1** — branch, work, commit, pull/rebase,
    push, open PR, get Mohamad's review, merge.

---

## 4. Guardrails — what Ethan (and his Claude Code) must NOT do

- **Never push directly to `main`.** Always branch + PR, even for tiny changes.
- **Never merge your own PR without Mohamad's approval** — that approval *is* the deploy decision.
- **Never touch auth, RLS policies, or Supabase security config** without flagging it to Mohamad
  first — a mistake here can expose every user's data.
- **Never commit or paste a secret** — no service-role key, no OAuth client secret, no `.env`
  values beyond the publishable Supabase key. If you're ever unsure whether something is a
  "safe" key or a real secret, ask before committing.
- **Never deploy unilaterally** — there is no separate deploy step to worry about; just don't
  merge to `main` alone (see above).
- **Follow the existing project rules already baked into `CLAUDE.md`** — your Claude Code will
  see these automatically, but as a human heads-up:
  - **ADA / WCAG 2.1 AA accessibility is the top priority**, above features or polish, on every
    UI change.
  - **Apple's Human Interface Guidelines** are the design north star for all UI.
  - **`docs/DATA_ETHICS.md`** governs anything touching data collection, storage, sharing, or
    privacy copy — check it before touching that surface.
- **When in doubt, ask Mohamad** rather than guessing on anything security-, auth-, or
  money-math-related.

---

## Open decisions for Mohamad

1. **Vercel deploy access for Ethan — grant it, or route all deploys through Mohamad?**
   Since deploys now happen automatically on merge-to-`main` (not a separate manual step), this
   mostly determines whether Ethan can see/manage the Vercel project dashboard (env vars, domains,
   build logs) — not whether he can "deploy" in the old direct-push sense. Recommendation: give
   Ethan a Vercel **Member** (not Owner) role so he can see build logs and debug failed builds,
   but env vars stay restricted to Mohamad initially.

2. **Should branch protection on `main` be turned ON (enforced), or stay an honor-system norm?**
   As of today, `main` has **no branch protection configured** on GitHub — the workflow above is
   currently a *convention*, not something GitHub enforces. Recommendation: turn on branch
   protection now — require at least 1 approving review before merge, and disable direct pushes
   to `main` for everyone (including Mohamad). This makes "mutual deploy approval" from
   STRATEGY.md actually unbreakable instead of relying on discipline. Command to do this once
   decided:
   ```bash
   gh api repos/Marro-app/marro/branches/main/protection -X PUT --input - <<'EOF'
   {
     "required_status_checks": null,
     "enforce_admins": true,
     "required_pull_request_reviews": {"required_approving_review_count": 1},
     "restrictions": null
   }
   EOF
   ```

3. **Separate Supabase dev/staging project for Ethan**, as STRATEGY.md section 7 suggests, so he
   never needs any access to the production database at all — even read-only. Worth doing before
   he starts touching data-model-adjacent features.

4. **GitHub Environments deploy-approval gate** (STRATEGY.md's stronger suggestion, beyond basic
   branch protection) — listing both founders as required approvers on a "production" Environment
   before Vercel deploys. This is a heavier setup than #2; decide if it's worth it now vs. later.
