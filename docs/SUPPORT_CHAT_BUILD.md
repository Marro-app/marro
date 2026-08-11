# Support Chat — Build Spec (Slices 0–14)

> Companion to `SUPPORT_CHAT_PLAN.md` (the *what/why*). This is the *how* — each slice specced to be
> built, tested, and merged on its own. Section numbers in refs (§n) point at the plan doc.
>
> **Before starting Slice 3 or later, read `docs/SUPPORT_CHAT_HANDOFF.md`** — the locked decisions from
> the Slice 2 build (it wins over this doc / the plan doc where they differ) and the current workflow
> gotchas (prod SQL, the `?mock=1` harness, grant hardening).
>
> **PROGRESS (2026-08-05):** ✅ Slice 0 (admin tabs, PR #60) · ✅ Slice 1 (DB foundation, PR #61) ·
> ✅ Slice 2 (user chat panel, PR #62) — all merged to `main`, DB live · ✅ Slice 3 (admin inbox +
> reply + auto-claim) — built on branch `feat/support-slice-3-admin-inbox`: `api/support.js`
> (list/thread/reply, admin-gated like `api/admin.js`), `src/tabs/admin/AdminSupportSection.jsx`,
> pure inbox logic in `src/lib/supportAdmin.js` (Vitest), and the `?mock=1` harness now covers the
> admin side (mock user is admin-flagged; in-memory `__mockApi` stands in for the admin backends).
> No new SQL — Slice 1's tables/RLS already cover it. Full detail + locked decisions in
> `docs/SUPPORT_CHAT_HANDOFF.md` §1–3. · ✅ Slice 4 (Realtime) — branch
> `feat/support-slice-4-realtime` (stacked on slice 3): subscribe helpers in `src/lib/support.js`,
> live thread/badge/inbox in SupportPanel + SupportLauncher + AdminSupportSection, in-memory
> channel emulation in the mock stub. **⚠️ RUN `supabase/support_realtime.sql` in Studio** (adds the
> two support tables to the `supabase_realtime` publication) or delivery stays fetch-only.
> · ✅ Slice 5 (alerts) — branch `feat/support-slice-5-alerts`: `api/support-notify.js` (Discord
> webhook ping, 10-min debounce per convo via `support_events`, owner named once claimed;
> one-time system reassurance on unattended **questions**), fired client-side after each user
> send. **⚠️ Discord needs the `DISCORD_SUPPORT_WEBHOOK_URL` Vercel env var** — absent = pings
> silently off, everything else works. · ✅ Slice 6 (availability) — branch `feat/support-slice-6-availability`:
> `supabase/support_settings.sql` (**run in Studio**), pure resolver `src/lib/supportAvailability.js`
> (Vitest ×10; shared by the panel status line AND the server reassurance gate), heartbeat +
> Auto/Available/Away override in the admin console, honest status line in the panel, admin reply →
> `user_notifications` banner. · ✅ Slice 7 (lifecycle) — branch `feat/support-slice-7-lifecycle`: pure state machine
> `src/lib/supportLifecycle.js` (Vitest ×12; shared by API + UI), `set_status`/`reassign`/`release`
> actions, admin reply → `waiting_user`, user reply wakes waiting/snoozed threads (**⚠️ re-run
> `supabase/support_chat.sql`** — the user RPC changed), lazy sweep on list (due snoozes wake,
> resolved >30d auto-archives), full queue chips + "unanswered Xh" badges, archived = read-only.
> **▶ NEXT: Slice 8** (presence soft-lock).
>
> **Per-slice template:** Goal · Depends on · Backend/DB · API · Frontend · Tests · **Done when** · Risk.
> **Workflow (every slice):** branch → push → Vercel preview → optional `/code-review` → self-merge
> (CONTRIBUTING). Never push to `main`.

## Conventions used throughout
- **New client code** lives under `src/components/support/`, `src/tabs/admin/`, and pure logic in
  `src/lib/support*.js` (so it's Vitest-covered like the merge engine / money math).
- **New SQL** is idempotent, committed to `supabase/support_chat.sql` (+ later `supabase/support_*.sql`),
  run via Studio. RLS is mandatory on every table (rule 4); `ensure_rls` enables it, we add policies.
- **Admin backend** = Vercel `api/support*.js`, service-role, authorization mirrored from `api/admin.js`
  (verify caller bearer → re-check `admins` table with the service-role client → else 403).
- **Two RLS lanes on support tables** (decided here, reconciles §5): **users** get `SELECT` on their own
  rows (needed for Realtime); **admins** get an `is_admin()`-gated `SELECT` (support convos are not
  financial data — admins legitimately read all of them; the §4 concern was *financial snapshots*, which
  we still never attach). **All writes go through SECURITY DEFINER RPCs / the service-role backend** — no
  raw INSERT/UPDATE policies. Internal notes (`is_internal_note=true`) are excluded from the user SELECT.

---

## Slice 0 — Admin panel → tabs
**Goal:** turn `src/tabs/AdminTab.jsx` (one long page) into an internal tabbed console so Support has a
home. No new behavior.
**Depends on:** nothing.
**Frontend:**
- Split `AdminTab.jsx` into `src/tabs/admin/{AdminUsersSection,AdminUsageSection}.jsx` (move existing
  invites/users/roles + `UsageSection` verbatim) and add a placeholder `AdminSupportSection.jsx`.
- Add a segmented control (reuse the existing segmented picker idiom from `src/components/pickers`) with
  a `tab` state; **arrow-key nav + roving `tabindex` + `:focus-visible`** (rule 7); lazy-load each section.
**Tests:** `?mock=1` as an admin (confirm the mock session is admin-flagged in `mockSessionData.js`, or
test with a real admin account) — every existing admin function still reachable under Users/Usage;
Support tab shows the placeholder; keyboard-only pass.
**Done when:** no admin regressions, tabs switch by mouse + keyboard, axe clean, logged in `UI_AUDIT_LOG.md`.
**Risk:** low — pure refactor, fully revertible.

## Slice 1 — Database foundation
**Goal:** tables + RLS + user RPCs. No UI consumes it yet.
**Depends on:** nothing.
**Backend/DB (`supabase/support_chat.sql`):**
- Tables: `support_conversations`, `support_messages`, `support_events` (schemas in plan §5 / §9.5).
- **RLS policies:**
  - `support_conversations`: user `SELECT` `WHERE user_id = (select auth.uid())`; admin `SELECT` `USING (is_admin())`.
  - `support_messages`: user `SELECT` where parent conversation is theirs **and** `is_internal_note = false`;
    admin `SELECT` `USING (is_admin())`.
  - `support_events`: **no client policies** (service-role only).
- **User RPCs (SECURITY DEFINER, granted to `authenticated`, revoked from `anon`/`public`):**
  `support_start_conversation(p_type, p_subject, p_tech_context)` → returns id (creates convo + first
  `user` message atomically, sets `last_message_at`, `unread_admin=1`, `status='new'`);
  `support_post_user_message(p_conversation_id, p_body, p_attachments)` (asserts ownership; bumps
  `last_message_at`/`unread_admin`; **auto-reopen** if status was resolved/archived — refined in slice 7);
  `support_mark_read(p_conversation_id)` (zeroes `unread_user`).
- Follow the grant-hardening pattern in `harden_admin_analytics_grants.sql`.
**Tests (Studio, two test accounts):** user A cannot `SELECT` user B's conversation/messages; anon key
denied everything; an `is_internal_note=true` row is invisible to the owning user; RPCs reject a
conversation the caller doesn't own.
**Done when:** all four checks pass; SQL committed.
**Risk:** **high — RLS is the only protection.** The two-account isolation test is non-negotiable.

## Slice 2 — User chat panel (send + read, no Realtime)
**Goal:** launcher + panel; start/continue a thread; read own messages via fetch (refetch after send).
**Depends on:** 1.
**Frontend:**
- `src/lib/support.js` — data layer wrapping the RPCs + `getSupabase()`: `startConversation`,
  `postMessage`, `fetchConversation`, `markRead`.
- `src/components/support/SupportLauncher.jsx` — floating `<button>` above the tab bar, `aria-label`,
  ≥44pt, `:focus-visible`, unread badge; honors `prefers-reduced-motion`.
- `src/components/support/SupportPanel.jsx` — glass card-sheet (G2 modal tier), category picker
  (Question/Bug/Idea), message list (user/them/system bubbles), composer with a labeled field +
  `role="alert"` errors; focus returns to launcher on close, no focus trap.
- **Category-themed background (§6)** basic version here: swap a decorative, `aria-hidden` motif layer by
  type; **freeze to static under `prefers-reduced-motion`**; never drop text contrast below 4.5:1 (both themes).
- Mount `SupportLauncher` in `src/App.jsx` for signed-in users.
**Mock harness:** extend `src/lib/mockSupabaseStub.js` to implement the support RPCs against an in-memory
store; seed a sample thread in `src/lib/mockSessionData.js`. **Re-run the prod-safety grep** after
touching the harness (CLAUDE.md).
**Tests:** `?mock=1` — open, pick category, send, see the bubble; keyboard-only + axe both themes; reduced-motion
freezes the motif. Real dev user: a sent message persists to the DB.
**Done when:** a signed-in user can start and continue a thread; a11y pass logged.
**Risk:** medium (accessible modal + motion) — lean on `DESIGN_SYSTEM.md`/`MOTION_SYSTEM.md`.

## Slice 3 — Admin inbox + reply + auto-claim  ← first end-to-end milestone
**Goal:** answer a user from the Support tab; **auto-claim on first reply** + audit log.
**Depends on:** 0, 1, 2.
**API (`api/support.js`, service-role, admin-gated like `api/admin.js`):**
- `list` (conversations, filterable) · `thread` (messages for one) · `reply` — inserts an `admin` message
  (`sender_email`=caller); **if `assigned_admin` is null: set it to caller, set `claimed_at` +
  `first_response_at`, log a `claimed` event**; always log a `replied` event; bump `unread_user`.
**Frontend:** `src/tabs/admin/AdminSupportSection.jsx` — inbox list (unread badge, type dot) + thread
view + reply composer; calls `api/support.js` with the caller's bearer token.
**Tests (preview/dev, end-to-end):** user (slice 2) sends → admin sees it → replies → user refetch shows
it; second admin sees the thread now says *Handled by …*; auto-claim fields set; **non-admin → 403**.
**Done when:** the full loop works with a manual refresh; auto-claim + events verified.
**Risk:** the authorization border — mirror `api/admin.js` exactly; unit-test the 403 path.

## Slice 4 — Realtime
**Goal:** live message delivery both directions (replace refetch).
**Depends on:** 3.
**Backend/DB:** enable Realtime replication on `support_messages` + `support_conversations`. RLS applies
to Realtime, so both lanes from slice 1 already scope it (user → own rows; admin → `is_admin()`).
**Frontend:** add `subscribeConversation(id, cb)` (user) and an admin inbox subscription to
`src/lib/support.js`; `SupportPanel` + `AdminSupportSection` subscribe on mount, unsubscribe on unmount;
drop the polling.
**Tests:** two browsers — a message appears on the other side within ~1s without refresh; unsubscribe on close.
**Done when:** live both ways; no leaked channels.
**Risk:** low/medium — isolated swap; revert = polling.

## Slice 5 — Outbound alerts (Discord) + auto-reassurance
**Goal:** founders get pinged when someone's waiting; users never feel ignored.
**Depends on:** 3.
**API (`api/support-notify.js`, service-role):** given a conversation id + caller auth, post to the
**Discord webhook** (URL from a Vercel env var — never client-side): "🆘 New · {type} · {name}" + inbox
deep link + the availability quick-actions (§3). **Debounce** per conversation. Routing: unassigned →
shared channel; once `assigned_admin` set → owner only (owner prefs land in slice 14).
**Trigger path:** the client calls `api/support-notify.js` (fire-and-forget) right after
`support_post_user_message` succeeds — keeps the secret server-side and matches the Vercel pattern (no
Supabase Edge Functions).
**Auto-reassurance:** on a user message to an *unclaimed* conversation, insert a one-time `system`
message ("Thanks — we'll get back to you soon") and set `status='waiting'` (availability-aware in slice 6).
**Tests:** send as user → Discord message fires once; reassurance appears once; after claim, routing narrows.
**Done when:** ping + reassurance verified; webhook URL in env only.
**Risk:** low — additive.

## Slice 6 — Availability resolver + inbound "we replied"
**Goal:** an honest status line; users notified in-app when we reply.
**Depends on:** 3 (5 for the status semantics).
**Backend/DB:** `support_settings` (single admin row): `online_override` (`auto`/`on`/`off`),
`business_hours`, `available_until`, `last_admin_heartbeat`. Admin-only writes via RPC/backend.
**Frontend:**
- `src/lib/supportAvailability.js` — **pure** `resolveAvailability(now, settings) → {online, reason}`
  combining hours + override + timeout + console-presence (§3). **Vitest** the truth table.
- Heartbeat: bump `last_admin_heartbeat` while the Support console is open + on the manual toggle.
- `SupportPanel` status line reads the resolver; the async path (slice 5) keys off `online=false`.
- Inbound: `api/support.js reply` calls the existing `public.notify()` → `user_notifications` →
  `NotificationBanner` ("Marro replied"). Zero new notification infra.
**Tests:** Vitest the resolver (in-hours+available, timed-out, override off, console-open); toggle → line
flips; admin reply → user sees the existing banner.
**Done when:** status line matches the resolver in every case; reply banner works.
**Risk:** low — reuses the notify pipeline.

## Slice 7 — Lifecycle + queues + archive
**Goal:** the full status machine, snooze, archive, auto-reopen, and the admin queues.
**Depends on:** 3.
**Backend/DB:** add `snooze_until`, `archived_at`, `resolved_at`, `resolved_by`, `reopen_count` handling
to the admin RPCs/backend; **auto-archive** resolved threads older than N days (a small Vercel cron
`api/support-cron.js`, or compute lazily if cron isn't wired). **Auto-reopen** already stubbed in slice 1
— finalize: a user message to resolved/archived → `status='open'`, `reopen_count++`, re-notify owner.
Every transition logs a `support_events` row.
**Frontend:**
- `src/lib/supportLifecycle.js` — **pure** transition rules (which status can go where). **Vitest.**
- Admin UI: status controls (Resolve/Archive/Snooze/Reassign/Release), queue filter tabs
  (`Unassigned` · `Mine` · `Waiting` · `Snoozed` · `Resolved` · `Archived`), wait-time badges, sort-by-oldest.
**Tests:** Vitest transitions; drive a thread New→Resolved→Archived; user reply auto-reopens; queues filter right; events logged.
**Done when:** state machine + queues + archive behave; audit complete.
**Risk:** medium — most moving parts; the pure-logic split keeps it testable.

## Slice 8 — Presence soft-lock
**Goal:** stop two admins double-replying.
**Depends on:** 3, 4.
**Frontend:** a Supabase Realtime **Presence** channel per open thread (admin side) tracking
`viewing`/`typing` + admin identity; render "👁 {admin} viewing" / "✍️ {admin} typing" chips on the
conversation row and a banner in the thread. Debounce typing.
**Tests:** two admin browsers on one thread — indicators appear/clear correctly.
**Done when:** live awareness works; clears on leave.
**Risk:** low — additive.

## Slice 9 — Triage depth
**Goal:** priority, tags, internal notes, user-context sidebar + profile drill-down, bug tech-context.
**Depends on:** 3, 7.
**Backend/DB:** `priority` + `tags` (text[]) on conversations (admin writes); `is_internal_note` already
in schema — surface it. `api/support.js thread` enriches with a **profile summary** (name/school/year/
joined/plan) via service-role.
**Frontend:**
- `src/lib/consoleBuffer.js` — a tiny ring buffer of the last N `console.error`s (installed early like
  `analytics.js`), attached to `tech_context` **only on a bug report** (technical only, no financial data — §4/§7).
- Admin thread: priority selector, tag input, **internal-note composer** (visually distinct; §9), a
  **Debug info** panel rendering `tech_context`, and a **user-context sidebar** whose name/avatar links to
  the full profile view (gated by the §4 Terms language + a logged `viewed_user_data` event).
**Tests:** `?mock=1` UI; **RLS check: an internal note never appears in the user SELECT** (extends slice 1
test); bug report carries context, no dollar values.
**Done when:** triage tools work; internal notes provably user-invisible; context capture is technical-only.
**Risk:** medium — the internal-note RLS boundary must be re-verified.

## Slice 10 — Screenshot + annotate
**Goal:** point-at-the-problem attachments.
**Depends on:** 2.
**Backend/DB:** a Supabase **Storage** bucket `support-attachments` with RLS (owner + `is_admin()` read;
writes via signed path). Attachment refs stored on `support_messages.attachments`.
**Frontend:** **lazy-loaded** `src/components/support/ScreenshotStudio.jsx` — **primary:**
`getDisplayMedia` (real capture, ask permission); **fallback:** `html2canvas` (npm dep, code-render);
**last resort:** file upload. Annotate on a canvas: highlight box, arrow, freehand, text, **blur/redact**
brush; save → upload → attach. Every tool is a labeled, keyboard-reachable control with a non-visual
(upload) path.
**Tests:** attach an image to a bug (both capture paths + denied-permission fallback); attachment renders
in the admin thread; bundle stays lazy (screenshot code absent from the main chunk).
**Done when:** capture→annotate→attach→admin-view works; lazy-loaded; accessible.
**Risk:** medium — `getDisplayMedia` UX varies; `html2canvas` weight (mitigated by lazy load).

## Slice 11 — CSAT + reply-when-gone email
**Goal:** learn if we actually helped; reach users who've left.
**Depends on:** 6, 7.
**Frontend/Backend:** on **Resolve**, `SupportPanel` shows a 👍/👎 (+ optional line) when `csat` is null →
store `csat`/`csat_comment`. `api/support.js reply`: if the user has no recent presence, send a "you have
a reply" email via `api/_email.js` with a link back to the thread.
**Scope note:** outbound notify-email only this slice; **inbound email→thread** (parsing replies back into
the conversation) needs a mailbox webhook — deferred, noted in plan §13.
**Tests:** resolve → prompt appears once; offline user → email sent with correct link.
**Done when:** CSAT stored + rolled into slice 12; away-user email works.
**Risk:** low.

## Slice 12 — Metrics dashboard
**Goal:** the §13.5 tracking view.
**Depends on:** 3, 6, 7 (needs the lifecycle timestamps + events).
**Backend/DB:** `is_admin()`-gated **SECURITY DEFINER** RPCs returning **aggregates only** (like the Usage
dashboard): `support_metrics_overview(range)` (first-response median/p90, time-to-claim, resolution,
responded-vs-deferred, backlog), `support_metrics_by_admin`, `support_aging` (live watchlist),
`support_volume_by_type`, `support_csat`. Percentiles computed in SQL.
**Frontend:** a Metrics view in `AdminSupportSection`: stat tiles, per-admin bars, aging watchlist, volume
bars, a 14-day sparkline. `src/lib/supportMetrics.js` for any client-side derivation — **Vitest** it.
**Tests:** seed data → numbers match hand calcs; **non-admin gets nothing** from the RPCs.
**Done when:** dashboard renders true aggregates; no per-user activity leaks.
**Risk:** low — read-only; reuses the proven RPC pattern.

## Slice 13 — Proactive nudges + "still-relevant" gate
**Goal:** reach out before churn, never about something already fixed.
**Depends on:** 6, 7.
**Backend/DB:** `support_nudges` (plan §12). Manual nudges (admin composes → target user/segment) and
triggered proposals (rules over signals: repeated errors, abandoned onboarding, stuck step, new feature).
A Vercel cron (`api/support-cron.js`, shared with slice 7) evaluates due nudges: **re-check
`recheck_condition`** → still true = deliver (via `public.notify()` + optional push), resolved-itself =
**auto-cancel** and log. Frequency caps + quiet hours + user opt-out.
**Frontend:** `src/lib/nudgeGate.js` — **pure** re-check + cap logic. **Vitest.** Admin composer + a "this
user's trigger cleared 2h ago — still send?" confirm on manual sends.
**Tests:** Vitest the gate (still-true delivers; resolved cancels; cap blocks); simulate a trigger that
resolves before send → auto-cancel.
**Done when:** nudges send/cancel correctly under the gate; caps enforced.
**Risk:** medium — logic-heavy; isolated in pure functions to de-risk.

## Slice 14 — Polish
**Goal:** the remaining reach/scale add-ons, each independent.
**Depends on:** varies.
- **Web Push:** VAPID keys (env), a push handler in the service worker (via `vite-plugin-pwa`
  `injectManifest` or a custom SW partial), `push_subscriptions` table (RLS: own rows), `api/support-push.js`.
  Opt-in, permission-gated. Test: closed-tab reply reaches the device.
- **Slack / email channels:** extend the `api/support-notify.js` fan-out + `support_settings.channels`.
- **Rate limiting:** cap messages/user/window in the user RPC (reuse the `invite_email_log` pattern +
  its test).
- **Canned replies:** `support_canned_replies` (admin) + composer picker.
**Done when:** each add-on ships + tests independently.
**Risk:** low, isolated — Web Push (SW surgery) is the only fiddly one; do it last.

---

## Dependency map
```
0 ─┐
1 ─┼─ 3 ─┬─ 4 ─ 8
2 ─┘     ├─ 5 ─ 6 ─┬─ 11 ─ 12
         └─ 7 ──────┴─ 13
2 ─ 10                 14 (independent add-ons)
```
Critical path to a **usable support loop:** 0 → 1 → 2 → 3 (then 4/5/6 make it good).
