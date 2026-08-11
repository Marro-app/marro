# Support Chat — Handoff & Decisions Log

> **Read this before writing any support-chat code.** It's the authoritative record of what was
> decided while building it. Where it disagrees with `SUPPORT_CHAT_PLAN.md`, **this doc wins** — the plan
> was written first and several things were refined in practice.
>
> Read order for a fresh session: **`CLAUDE.md`** (project rules) → `SUPPORT_CHAT_PLAN.md` (what/why) →
> `SUPPORT_CHAT_BUILD.md` (per-slice spec; the PROGRESS block at the top is kept current) → **this doc**.

---

## 1. Status snapshot (2026-08-05)

- **Slice 0** (admin console → tabs) — ✅ merged to `main`.
- **Slice 1** (DB foundation: `supabase/support_chat.sql` — tables, RLS, user RPCs) — ✅ merged (PR #61),
  applied + verified on prod.
- **Slice 2** (user chat panel) — ✅ merged (PR #62).
- **Slice 3** (admin inbox + reply + auto-claim) — ✅ built on branch `feat/support-slice-3-admin-inbox`.
  `api/support.js` (service-role, admin-gated: list / thread / reply with auto-claim + `support_events`
  log), `src/tabs/admin/AdminSupportSection.jsx` (inbox list + filters + thread + composer),
  `src/lib/supportAdmin.js` (pure filter/label logic, Vitest-covered). The `?mock=1` harness now
  admin-flags the mock user and stands in for the admin backends (`__mockApi` in
  `mockSupabaseStub.js`), so the full user→admin→user loop is click-testable locally with no backend.
- **Slice 4** (Realtime) — ✅ built on branch `feat/support-slice-4-realtime` (stacked on slice 3).
  `subscribeToMessages`/`subscribeToConversations` in `src/lib/support.js` (postgres_changes,
  RLS-scoped both lanes); SupportPanel thread + SupportLauncher badge + AdminSupportSection
  inbox/thread all update live (refetch paths kept as fallback — Refresh button stays). The mock
  stub emulates channels in-memory and emits on every mutation, so the live loop is testable on
  `?mock=1`. **Prod SQL to run: `supabase/support_realtime.sql`** (idempotent; adds both tables to
  the `supabase_realtime` publication — RLS already scopes events, no new policies).
- **Slice 5** (alerts) — ✅ built on branch `feat/support-slice-5-alerts`. `api/support-notify.js`
  is called fire-and-forget by the client after every user send (`notifySupport()` in
  `src/lib/support.js`): verifies the caller owns the conversation, then (a) inserts a one-time
  `system` reassurance into an **unclaimed question** ("we'll get back to you soon" — questions
  only; bug/idea flows end on their own confirmation screen), and (b) posts a Discord ping
  (debounced 10 min/conversation via a `discord_ping` row in `support_events`; names the owner once
  claimed). **Ethan action: add `DISCORD_SUPPORT_WEBHOOK_URL` to Vercel env** (server-side only —
  never in the client); until then pings are silently skipped and everything else works.
- **Slice 6** (availability + "we replied") — ✅ built on branch `feat/support-slice-6-availability`.
  Single-row `support_settings` (**prod SQL to run: `supabase/support_settings.sql`** — readable by
  any signed-in user, written only via the backend). Pure `resolveAvailability()` in
  `src/lib/supportAvailability.js` — model: `off`→offline; `on`→online only while the signal is
  fresh (heartbeat <20 min or `available_until` future); `auto`→in-hours (9–21 ET) AND fresh
  signal — hours alone never claim online. The SAME resolver runs client-side (status line) and in
  `api/support-notify.js` (reassurance now keys off `online=false`, not "unclaimed"). Console
  heartbeats every 5 min while open; Auto/Available/Away override in the inbox header ('on' stamps
  a 1h `available_until`). Admin reply inserts a `user_notifications` row → existing
  NotificationBanner ("Marro replied…").
- **Slice 7** (lifecycle + queues + archive) — ✅ built on branch `feat/support-slice-7-lifecycle`.
  Pure `src/lib/supportLifecycle.js` (transition matrix, event verbs, sweep, waiting labels —
  Vitest) imported by BOTH `api/support.js` and the console UI, so the buttons offered are exactly
  the moves the backend allows. Semantics: admin reply flips new/open → `waiting_user`; a user
  reply wakes waiting/snoozed → `open` (**prod SQL: re-run `supabase/support_chat.sql`** — the
  `support_post_user_message` RPC changed; idempotent). `set_status` (resolve/archive/snooze N h/
  reopen) + `reassign`/`release` all log `support_events`. No cron yet: `list` runs a lazy sweep
  (due snoozes wake; resolved >30 days auto-archive, `admin_email='system'`, `via:'sweep'`).
  Archived threads are read-only until reopened. User side: admin-RESOLVED questions now count as
  "ended" for the hub's Recent-chats list (reopenable 7 days, `resolved_at`-based).
- **Next: Slice 8** (presence soft-lock) → then 9…14.

The DB (all Slice-1 + Slice-2 RPCs) is **already applied to prod**. The `supabase/support_chat.sql` file
is idempotent — re-running it is safe.

## 2. How to work (workflow + gotchas)

- **Branch per slice** → push → Vercel preview → optional `/code-review` (or `/code-review ultra`) →
  **founder self-merges**. No cross-founder approval gate (`CONTRIBUTING.md`). **Never push to `main`.**
- **Local UI testing:** `npm run dev` → `http://localhost:3456/?mock=1` boots the signed-in app with a
  seeded support state (1 active + 2 archived chats), no backend. Harness: `src/lib/mockSessionData.js`
  (`buildMockSupport`) + `src/lib/mockSupabaseStub.js` (in-memory support RPCs). **Re-run the prod-safety
  grep after touching the harness:** `npm run build && grep -rn "mockSupabase\|test@localhost" dist/` must
  be empty.
- **Prod SQL:** run it via the **Supabase Studio SQL editor** (your own login). ⚠️ **Always wrap test
  queries so they roll back** — a bare `do $$…$$` or statement auto-commits. To assert *and* roll back,
  `raise exception` at the end of a `do` block with the results in the message (it aborts the tx and the
  message comes back in the error). A committed test once created rows on a real user's account here.
- **Every slice must clear:** `npm run build`, `npx vitest run` (currently 358 green), prod-safety grep,
  and the a11y bar in `CLAUDE.md` rule 7 (log UI changes in `docs/UI_AUDIT_LOG.md`).

## 3. Decisions locked during the Slice-2 build

These are **final** and Slice 3+ must stay consistent with them.

**Model & data**
1. Three categories: **Question** (`type='question'`), **Bug** (`'bug'`), **Idea** (`'feedback'`).
2. **Bug & Idea are structured *forms*, not chat.** Fields are composed into the first message body (plain
   text) and show a confirmation. **Question is a chat.** (`SUPPORT_FORMS` in `SupportPanel.jsx`.)
3. **Single active Question at a time** — a user may have only one open `question`. Enforced *server-side*
   in `support_start_conversation` (a 2nd open question **appends** to the existing thread instead of
   duplicating). **Bugs/ideas are unlimited** one-off submissions.
4. **No financial data** is ever attached to a conversation/report (unchanged from plan §4). Bug
   tech-context (Slice 7/9) is **technical only** — no dollar values. The account-lookup affordance still
   needs the Terms/Privacy broadening (plan §4) before it ships.

**User-facing UX (the panel)**
5. **Hub-and-spoke.** The panel opens to a **hub** (home) with three rows — *Ask a question / Report a
   bug / Share an idea*. Each opens **its own screen** (chat composer / bug form / idea form) with a **back
   arrow**; the other options aren't shown on a sub-screen. (This replaced an earlier 3-card picker.)
6. **Opens to the hub by default**; it only jumps straight into a thread when a **reply is waiting**
   (`unread_user > 0`).
7. An open chat gets a distinct **"Continue your chat"** card atop the hub (with unread badge).
   **"Ask a question" while a chat is open** routes to an **askChoice** screen — *Continue that chat* /
   *Close it & start a new one* (closing archives the current chat, opens a fresh composer).
8. **End chat** = the *user* archives their own chat, behind a **confirmation** ("End this chat? You can
   reopen it for 7 days"). An admin can also close it (Slice 7). Ending shows a **"Chat ended"** screen —
   **that screen is the CSAT slot**: the 👍/👎 prompt drops in there when CSAT is built (Slice 11).
9. **Archived ≠ deleted.** Ended chats appear on the hub as a **"Recent chats"** list — *all* Questions
   ended within the **last 7 days**, each reopenable (`support_reopen_conversation`). After 7 days they
   drop off the user's view; admins keep the full record. Real DB cleanup is a **cron in Slice 7** (until
   then it's just hidden client-side). The list is hidden while a chat is active (can't run two at once).
10. **Icons:** custom **Marro line icons** in `src/components/icons.jsx` (`help`, `bug`, `idea`, `reopen`)
    — **no emoji** anywhere in the panel. Continue uses `chat`; new categories should reuse this system.
11. **Category motifs** (backgrounds): Bug → crawling beetles, Idea → bokeh lights; **reduced-motion-safe
    + contrast-safe both themes**; they live on the destination screens, the hub is neutral.

**Security / infra**
12. **Grant hardening (mandatory for every new support RPC):** `revoke all on function … from public, anon;`
    then `grant execute … to authenticated;`. Supabase's default privileges grant EXECUTE to `anon` on new
    functions, and `revoke … from public` does **not** remove that — you must name `anon`. Verify with
    `has_function_privilege('anon', p.oid, 'execute')` = false. RPCs also self-guard on `auth.uid()`.
13. **Realtime is deferred to Slice 4** (Slice 2 reads via fetch/refetch). **Admin alerts:** Discord
    first, configurable fan-out (plan §10). Admin backend = Vercel `api/support*.js`, service-role,
    authorization mirrored from `api/admin.js`.

## 4. What changed vs. the plan doc (reconciliation for later slices)

- The plan's **"picker" / "resume link"** language is superseded by the **hub + Continue card + Recent
  chats list** (decisions 5–9). Same intent, better shape.
- **User-side archive/reopen already exists** (built in Slice 2). So **Slice 7** is now: admin-side status
  machine + queues + **auto-archive cron** + the **7-day cleanup** of user-archived chats + wait-time
  badges — not the basic archive (that's done).
- **Slice 11 CSAT** has its UI home already (the "Chat ended" screen) — just wire the rating + storage.
- Everything else in `SUPPORT_CHAT_BUILD.md` slices 3–14 stands as written; follow that spec.

## 5. Remaining slices (from `SUPPORT_CHAT_BUILD.md`)

3 Admin inbox + reply + **auto-claim** (first end-to-end loop) · 4 Realtime · 5 Outbound alerts
(Discord) + auto-reassurance · 6 Availability resolver + inbound "we replied" · 7 Lifecycle + queues +
archive/auto-archive · 8 Presence soft-lock · 9 Triage depth (priority/tags/internal notes/tech-context)
· 10 Screenshot + annotate · 11 CSAT + reply-when-gone email · 12 Metrics dashboard · 13 Proactive nudges
+ "still-relevant" gate · 14 Polish (Web Push, Slack/email, rate limiting, canned replies).

## 6. Kickoff prompt (paste into the cofounder's Claude Code session)

> We're building Marro's in-app support chat, slice by slice. **Before doing anything, read `CLAUDE.md`,
> then `docs/SUPPORT_CHAT_PLAN.md`, `docs/SUPPORT_CHAT_BUILD.md` (the PROGRESS block is current), and
> `docs/SUPPORT_CHAT_HANDOFF.md` (the decisions log — it wins over the plan where they differ).**
>
> Slice 2 (the user panel) is PR #62 on branch `feat/support-slice-2-panel` — merge it first if it isn't
> merged. Then build **Slice 3** and continue through **Slice 14**, one branch + PR per slice, following
> the workflow and decisions in those docs. Verify each slice on `localhost:3456/?mock=1` and the Vercel
> preview, keep ADA (rule 7) + Apple HIG (rule 8), run the build + `vitest` + prod-safety grep, and log
> UI changes in `docs/UI_AUDIT_LOG.md`. Run prod SQL via Supabase Studio and **always wrap test queries so
> they roll back**. **Never push to `main`, and ask me before pushing** any branch.
