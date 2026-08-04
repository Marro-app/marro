# Support & Feedback Chat — Planning Doc

> Status: **PLANNING** (no code yet). Decisions locked with founders 2026-08-04.
> Owner: Mo. Read alongside `DATA_ETHICS.md` (rule 10), `DESIGN_SYSTEM.md` + `MOTION_SYSTEM.md`
> (rules 8/9), and CLAUDE.md rule 4 (RLS) + rule 7 (ADA).
>
> This is the **detailed** version — each feature has: what it is · how it works · use cases ·
> UX · privacy/accessibility guardrails · phase.

---

## 0. Summary & locked decisions

Build an **in-app support / feedback / bug-report chat**, custom on Supabase (not a vendor widget).
Live chat when a founder is available; async "leave it, we'll get back to you" when not. Every
conversation stored. Doubles as the bug-report and user-research pipeline.

| Decision | Choice |
|---|---|
| Build vs. buy | **Build on Supabase** — conversations never leave our infra; reuses our design system (ADA/HIG by construction); lets us attach rich context. |
| Admin alerts | **Configurable multi-channel fan-out**, Discord first (cofounder's server). |
| Availability | **Hours + push-action toggle + inactivity timeout + in-app toggle** (see §3). |
| User data in bugs | **Do NOT attach the user's financial data.** Attach identity + technical context only; admins look up the account in Supabase on-demand if truly needed. **Broaden Terms/Privacy to cover support access** (see §4). |
| Category-themed chat UI | **Yes** — bug / feedback / question each get a distinct background treatment (see §6). |
| Screenshot | **Real screen capture via permission is primary; render-from-code is the fallback** (see §8). |
| Admin coordination | **Auto-claim on first reply** + presence soft-lock; queues, archive, and full metrics (see §9.5 + §13). |
| AI features | **Deferred** until Marro's AI layer exists (Phase 4+). Designed-for, not built now (see §14). |

## 1. What already exists (reuse, don't rebuild)

- **Auth border:** `admins` table + `is_admin()` client gate; real check is a service-role re-check
  in `api/admin.js`. → Support inbox reuses this exact border.
- **Admin console:** `src/tabs/AdminTab.jsx` exists → gets **restructured into sub-tabs** (§2); Support is the first new tenant.
- **In-app notifications:** `public.notify(text,text,text,jsonb)` → `user_notifications` →
  `NotificationBanner.jsx` + `myNotifications()`/`dismissNotification()` in `src/lib/data.js`.
  → "An admin replied" reuses this verbatim.
- **Serverless + service role:** `api/*.js` Vercel functions w/ `SUPABASE_SERVICE_ROLE_KEY`
  (`api/admin.js`, `api/_email.js` for email). → Discord ping + email fallback are new `api/*.js`
  in the same pattern. (We use **Vercel functions, not Supabase Edge Functions** — stay consistent.)
- **RLS hygiene:** `ensure_rls` trigger enables RLS on new tables (deny-all until policies written).
  → New tables MUST ship `auth.uid()` policies in `supabase/*.sql`.

**Greenfield:** Supabase Realtime (first use), Web Push, screen-capture, screenshot annotation.

## 2. Admin panel → tabbed (prerequisite)

`AdminTab.jsx` today is one long page. Restructure into a **tabbed admin console**:
`Users/Invites` · `Usage` (existing analytics) · **`Support`** (new) · room for more. Segmented-control
style (HIG), keyboard-navigable (arrow keys + `:focus-visible`), each tab lazy-loaded. This is a small
refactor that ships first so Support has a home.

---

## 3. Admin availability (multi-signal)

**Goal:** the "We're online / Back later today" line is *always truthful*, whether you're at the
console or reacting from your phone via Discord.

**How it's computed** — availability = the combination of:
1. **Business hours** — a baseline schedule (e.g. 9am–9pm ET). Outside it → default "not available."
2. **Push-action toggle** — when an admin gets a push/Discord alert about a waiting user, the alert
   carries quick actions **"I've got it / Available"** and **"Not available."** Tapping sets status
   without opening the app.
3. **Inactivity timeout** — if `available` was set but no admin activity/heartbeat for N minutes,
   it **auto-flips to "not available"** so we never falsely advertise presence.
4. **In-app manual toggle** — an explicit Available / Not-available switch in the Support tab; if the
   console is open, that wins.

**Data:** a single `support_settings` row holds `online_override` (`auto`/`on`/`off`),
`business_hours`, `available_until` (timestamp the timeout counts against), `last_admin_heartbeat`.
A tiny helper resolves these into one boolean the chat panel reads.

**Use cases:**
- *Evening, phone only:* Discord ping arrives → you tap "Available" → status flips to online for the
  next N min → auto-reverts if you go quiet. User sees an honest "We're online."
- *Asleep / outside hours:* baseline says not available → user gets the async reassurance message.
- *At the desk:* console open + toggle "Available" → live chat, presence forced on.

**Accessibility:** the availability pill is text + color (never color alone); the toggle is a real
labeled switch, ≥44pt, `:focus-visible`.

---

## 4. User data & access (privacy decision)

**Decision:** we **do not** attach a user's financial data to conversations or bug reports. Instead:
- Each conversation carries the user's **identity** (account id, name, email, school/year) and
  **technical context** (see §7) — no dollar figures.
- If debugging genuinely requires their data, an admin **looks it up in Supabase / an admin tool
  on-demand**, as a deliberate act — not an automatic silent dump into the chat log.

**Terms/Privacy — must broaden coverage (action item):** update `privacy.html` / `terms.html` and
the `.docx` legal set so **internal access to a user's account for support, debugging, and safety**
is clearly and broadly disclosed as a purpose of processing. Keep it consistent with `DATA_ETHICS.md`
(Lane A stays private + never sold; this is *processing to provide/support the service*, not sharing).
Flag for the UCI clinic review with the rest of the legal pages. **Do not ship the debug-lookup
affordance until this language is live.**

**Why this shape:** it preserves the "founders can't casually browse individuals" posture the Usage
dashboard already embodies, keeps minors' sensitive data out of chat logs by default, and is trivially
defensible — while still letting you fix real bugs. (Optional hardening later: log admin data-lookups
to an internal audit trail.)

---

## 5. Data model

New tables in `supabase/support_chat.sql`, all RLS-gated (`(select auth.uid())` wrapper per the
initplan perf convention, commit 8f6dec5).

**`support_conversations`** — `id` · `user_id` ·
`status` (`new`/`open`/`waiting_user`/`snoozed`/`resolved`/`archived`) ·
`type` (`bug`/`feedback`/`question`/`billing`/`other`) · `priority` (`low`/`normal`/`urgent`) ·
`subject` · `created_at` · `last_message_at` · `unread_admin` · `unread_user` ·
`assigned_admin` (owner; set by auto-claim §9.5) · `tech_context` jsonb (§7) · `linked_issue_url` ·
`csat` (§11) · `csat_comment` ·
**lifecycle timestamps** `claimed_at` · `first_response_at` · `resolved_at` · `resolved_by` ·
`archived_at` · `snooze_until` · `reopen_count`. (These timestamps are what the metrics in §13 read —
capture them at the moment each transition happens, server-side.)

**`support_messages`** — `id` · `conversation_id` · `sender` (`user`/`admin`/`system`) ·
`sender_email` · `body` · `attachments` jsonb (§8) · `is_internal_note` (admin-only; §9) ·
`created_at` · `read_at`.

**`support_settings`** (single admin row) — availability (§3) + notification channels (§10) + proactive-nudge config (§12).

**`support_events`** (§9.5) — the audit + attribution log. One row per admin action:
`conversation_id` · `admin_email` · `action` (`claimed`/`replied`/`reassigned`/`released`/`resolved`/
`reopened`/`archived`/`snoozed`/`priority_changed`/`tagged`/`viewed_user_data`) · `meta` jsonb · `at`.
This is both the "who helped" record and the source data for per-admin metrics + the §4 data-lookup trail.

**`support_nudges`** (§12) — scheduled/triggered proactive messages.

**`push_subscriptions`** (Phase 2) — per-user Web Push endpoints.

**RLS:** users read/insert only their own threads + `user` messages (`WITH CHECK sender='user'`,
and `is_internal_note` must be false for user-visible reads — internal notes never leave the backend).
Admin reads/writes go through the **service-role backend** (`api/support.js`) — no blanket "admins see
all" client policy, so a leaked anon key can't read everyone's threads. Status/unread/assignment
mutate only via SECURITY DEFINER RPCs or the backend.

---

## 6. Category-themed chat UI (the Marro signature)

The chat panel's **background changes with the conversation type** — a subtle, branded touch that also
signals "we understood what kind of message this is." Borrows the launcher/slide-up *pattern* from
Admit, none of its look — this is pure Marro.

- **🐛 Bug** → a faint, slow "bugs/glitch" motif in the background (think subtle scanlines or drifting
  specks, very low contrast).
- **💡 Feedback / Idea** → soft "lights" — gentle floating glows (a calmer cousin of the landing blobs).
- **❓ Question / Help** → the **regular** clean Marro surface (no motif) — help should feel neutral.
- **💳 Billing / Other** → regular surface.

**Guardrails (non-negotiable, rules 7 & 8):**
- All motifs are **background decoration only** — never reduce text contrast below 4.5:1 in either theme.
- **Honor `prefers-reduced-motion`:** any drift/animation freezes to a static, near-invisible texture
  (same discipline as the existing blobs + `.shimmer-text`).
- Purely additive/`aria-hidden` — screen readers ignore it; keyboard flow unaffected.
- The theme switches smoothly when the user changes the category mid-thread.

**Use case:** a student picks "Report a bug," the panel subtly shifts to the bug motif — playful,
reassuring, and unmistakably Marro; switch to "Feedback" and it warms into soft lights.

---

## 7. Bug reports & technical context capture

A "Report a bug" entry (and any `type='bug'`) auto-attaches to `tech_context` jsonb — **technical
only, no financial figures** (§4): app version/build, active tab + route/modal state, viewport,
device/OS/browser, `prefers-*` settings, online/offline, and **recent console errors** (captured via a
lightweight in-memory ring buffer of the last N console errors, attached only on a bug report).

**Admin inbox** renders this as a collapsible "Debug info" panel on the thread. Turns "it's broken"
into something reproducible. A **"Create GitHub issue"** button (§13) copies the context into a new
issue and stores the link on `linked_issue_url`.

**Use case:** user reports the savings tab won't save → the report already contains the tab, the last
JS error, and their browser → you reproduce in minutes without a back-and-forth.

---

## 8. Built-in screenshot + annotation

**Primary path — real screen capture (ask permission):** use the browser's screen-capture so we get a
*true* pixel-accurate image (charts, glass, everything). The user taps 📷 → browser asks permission →
they capture the app → annotation overlay opens.

**Fallback — render-from-code:** if permission is denied/unsupported (esp. some mobile browsers), fall
back to rendering the current view from the DOM. Good enough for most bugs; may simplify heavy visuals.
Last resort: plain "upload a photo/file."

**Annotation overlay (on either path):** draw a **highlight box**, **arrow**, freehand **scribble**,
**text note**, and a **blur/redact** brush (so users can hide numbers before sending). Save → attaches
to the message as an image in `attachments`. Built from Marro's own UI components (on-brand), lazy-loaded
so it never bloats the app for people who don't use it.

**Privacy tie-in:** the blur tool doubles as the user's own redaction control — supports the §4 stance
(they can scrub their figures before sending rather than us harvesting them).

**Use cases:** "this chart looks wrong" → screenshot + arrow at the bad bar → instantly clear. Feedback:
"love this screen but this label's confusing" → box + note.

**Accessibility:** every annotation tool is a labeled, keyboard-reachable control; the flow is operable
without a mouse where the platform allows; provides a non-visual path (skip straight to text + file upload).

---

## 9. Triage system (feedback vs. support vs. bugs)

Three axes, surfaced as filters in the Support tab:
- **Type** — 🐛 Bug · 💡 Feedback · ❓ Question · 💳 Billing (user-chosen, admin-refinable).
- **Status** — New → Open → Waiting-on-user → Resolved (+ Snoozed).
- **Priority** — Low / Normal / Urgent (admin-set).

**Admin tools:** saved filter views ("Unanswered," "Bugs," "Urgent," "Waiting on me"), **tags** for
pattern-spotting, **internal notes** (`is_internal_note`, invisible to users), assign-to-founder, and
per-type routing (bug → GitHub issue §13; feedback → feature board §13).

**Use case:** Monday triage — filter "Unanswered," sort Urgent first, tag three lookalikes
"savings-confusion" → you instantly see an emerging UX problem, not just individual tickets.

---

## 9.5. Admin coordination, lifecycle & archive

**The problem:** two founders (later, more) share one inbox — they must not both work the same chat,
and every action needs a record.

**Ownership = assignment (auto-claim).** A conversation is either **Unassigned** (shared pool) or
**owned by one admin** (`assigned_admin`).
- Opening a thread does **not** claim it (you may be peeking).
- **First reply auto-claims** it to the replier (set `assigned_admin` + `claimed_at`, log a `claimed`
  event) — the locked decision. There's also an explicit **Claim** button to grab it without replying.
- Owned threads leave the other admin's Unassigned queue and show **"Handled by {admin}."**
- **Reassign** (hand off, with a note → notify new owner), **Release** (back to pool).

**Live awareness = presence soft-lock.** Realtime presence on the open thread: other admins see a live
**"👁 {admin} viewing"** → **"✍️ {admin} typing"** chip on the conversation row + a banner if they open
it too. Stops the split-second double-reply *before* assignment resolves. Presence handles the race;
assignment settles ownership. First-to-claim wins — no round-robin needed for two people, but the model
scales to it.

**Notification routing (ties to §10):** a *new/unassigned* message pings the shared Discord channel;
once claimed, follow-ups ping **only the owner** — no buzzing both founders about a handled chat.

**Lifecycle:** `new` → `open` (auto-claimed) → `waiting_user` → `resolved` → `archived`; plus `snoozed`
(returns at `snooze_until`) and **auto-reopen** (a user reply to a resolved/archived thread flips it back
to the owner's queue and bumps `reopen_count`).

**Archive:** resolved threads are tucked out of the active queues but stay **fully searchable + readable**
(the support history + bug-report record). Manual **Archive**, plus **auto-archive after N days resolved**
(N = the retention setting, §17 open q). Archived threads are read-only until reopened.

**Queues (assignment filter layered on the §9 triage filters):** `Unassigned` (shared to-do you both
watch) · `Mine · needs reply` · `Waiting on user` · `Snoozed` · `Resolved` · `Archived`. Wait-time
badges ("unanswered 3h") + sort-by-oldest so nothing rots.

**Attribution/audit:** three levels — `sender_email` on each message (who said what), `resolved_by` on
the conversation (who closed it), and the `support_events` log (every action, who, when). Powers the
per-admin metrics in §13 and the §4 data-lookup trail.

## 10. Notifications

**Admin ← user (someone's waiting):** one backend entry point `api/support-notify.js` reads
`support_settings.channels` and fans out; adding/removing a channel is a config toggle.
- **Discord webhook (channel #1)** — "🆘 New · {type} · {name}" + inbox deep link + the
  **Available / Not-available** quick actions (§3). Debounced so one thread ≠ many pings.
- **Slack webhook / Email (Resend via `api/_email.js`)** — same mechanism, later.
- **In-app inbox badge** — always on.

**User ← admin (we replied):**
- **In-app** — reuse `public.notify()` → `NotificationBanner` (zero new infra).
- **Sound** — a soft chime while the tab is open (mutable; never autoplay-noisy).
- **Web Push (Phase 2)** — reply reaches them with the tab closed; needs VAPID + a SW push handler +
  `push_subscriptions`; opt-in, permission-gated.

**Auto reassurance:** sending into an unattended thread (per §3) inserts a `system` message
("Thanks — we'll get back to you soon") and sets `status`. Triggered on send, no cron.

---

## 11. Satisfaction rating (CSAT)

When an admin marks a thread **Resolved**, the user sees a lightweight **👍 / 👎** (or 3-face) prompt with
an optional one-line comment → stored on `csat`/`csat_comment`. Rolls up into analytics (§13).

**Guardrails:** never blocking, one-tap, dismissible, fully labeled for screen readers. **Use case:**
a 👎 with "still confused" flags a resolution that didn't land, so you can circle back.

---

## 12. Proactive nudges

**Goal:** reach out *before* users churn — but make it easy to launch and make sure we never nudge
about something already fixed.

**Two ways a nudge starts:**
1. **Admin-initiated (manual):** from the Support tab (or a user's profile), compose a message to a
   specific user or a segment ("everyone who hit an error in Savings this week"). One-click send.
2. **App-detected (triggered):** rules watch for signals — repeated JS errors, abandoned onboarding,
   stuck on a step, first time on a new feature. A matching signal **proposes** a nudge.

**The "still relevant?" gate (your key requirement):** a triggered nudge is **held, not sent
instantly.** Before it goes out, the system **re-checks the condition** — did the user complete the
step, did the error stop, did they already message us, was the bug fixed/deployed? If the trigger no
longer holds, the nudge is **auto-cancelled**. Admin-initiated nudges show the admin the current state
("this user's error cleared 2h ago — still send?") before sending.

**Data:** `support_nudges` — `trigger`, `target` (user/segment), `body`, `state`
(`proposed`/`scheduled`/`cancelled`/`sent`), `recheck_condition`, `send_after`. Delivered via the same
notify pipeline; a nudge reply opens a normal conversation.

**Use cases:**
- *Onboarding abandon:* user drops at "add loans" → 24h later, if still not done, "Need a hand
  finishing setup?" — but if they finished at hour 20, it silently cancels.
- *Error cluster:* three JS errors on Charts → proposes "Noticed Charts misbehaving — want us to look?"
  → if that bug ships a fix first, the queued nudge cancels itself.
- *Manual delight:* you spot great feedback → one-click "thank you, we shipped your idea."

**Guardrails:** frequency-capped (no nudge spam), user can turn nudges off, honors quiet hours, and —
per rule 9 — anything the *detector* infers is a *suggestion to the admin*, not an auto-send, until the
re-check passes.

---

## 13. Admin workspace details

- **User-context sidebar** on every thread: name, avatar, school, year, plan, joined date, recent
  activity summary. **Click the name/avatar → full profile view** (their complete account overview in
  the admin tool) for deeper context. Data-lookups gated by §4's Terms coverage.
- **Reply-when-they're-gone:** if a user hasn't returned when you reply, the reply can also go out by
  **email** (via `api/_email.js`); their email reply threads back into the same conversation.
- **GitHub issue link** for bugs; **feature-request board** (submit + upvote) for ideas, feeding the
  roadmap.
- **Canned replies** (saved responses) for FAQs.
- **Support analytics — full metric catalog (see §13.5).**

---

## 13.5. Metrics catalog (the tracking dashboard)

A **Support Metrics** view in the admin console. Built **like the Usage dashboard** —
`is_admin()`-gated `SECURITY DEFINER` RPCs returning aggregates, computed from the lifecycle
timestamps (§5) + `support_events` (§9.5). Adjustable date range. Individual conversations stay in the
operational inbox; this view is reporting, not a per-user activity feed.

**A · Speed / "are we leaving anyone hanging" (headline):**
- **First-response time** (first user msg → first admin reply): median + p90.
- **Time-to-claim** (how long it sat Unassigned).
- **Resolution time** (open → resolved): median + p90.
- **Aging watchlist** — count + list of threads waiting > X hours *right now* (live, not historical).

**B · Volume & flow:**
- New conversations / day / week; current backlog (open / waiting / snoozed).
- **Responded vs. deferred** — got a live answer vs. hit the async "we'll get back to you" path and
  still unanswered (your explicit ask).
- **Reopen rate** — resolved threads that came back (resolution-quality signal).
- Deflection (if a FAQ/help layer is shown pre-message, Phase 3).

**C · Per-admin ("who's responding"):**
- Conversations handled · replies sent · **share of load** (e.g. Mo 60% / cofounder 40%).
- First-response & resolution time per admin.
- CSAT per admin · handoff/reassign count.
- **Active response hours** — when each admin actually covers.

**D · By type / topic:**
- Volume + resolution time by `type` and `priority`.
- **Trending tags** — emerging issues week-over-week.
- Bugs → GitHub issues opened/closed · ideas → top-upvoted.

**E · Satisfaction:** overall CSAT + trend; CSAT by type and by admin.

**F · Users & proactive:** distinct users who contacted support (% of active); repeat contacters;
nudges **sent vs. auto-cancelled by the "still relevant?" gate (§12) vs. converted**.

**G · Operational:** busiest hours/days (staffing insight); backlog burn-down over time.

## 14. Deferred: AI layer (Phase 4+)

Designed-for, **not built until Marro's AI exists.** When it does: auto-triage (suggest type/priority/
tags), **draft replies** you approve/edit (rendered as a "Suggested" pending state, never sent silently
— rule 9), thread summaries, auto-FAQ from recurring questions, and eventually an AI first-responder for
simple questions with human handoff. Schema leaves room (types/tags/notes) so this bolts on cleanly.

---

## 15. Cross-cutting: ADA/HIG, privacy, security

- **ADA (rule 7):** every control keyboard-reachable + `:focus-visible`; icon buttons get `aria-label`;
  errors `role="alert"`; contrast ≥4.5:1 both themes; category motifs decorative + reduced-motion-safe;
  screenshot flow has a non-visual path. Keyboard + axe pass before "done"; log in `UI_AUDIT_LOG.md`.
- **HIG (rule 8):** card-sheet modal, segmented pickers, iOS-style toggles, ≥44pt targets, spring motion.
- **Privacy/ethics (rules 4 & 10):** conversations are Lane A — RLS-gated, never sold, minors excluded
  from aggregates. **Broaden Terms/Privacy for support access (§4) before shipping the lookup.** UI copy
  must match the policy pages. Webhook URLs + VAPID private key = Vercel env vars only.
- **Rate limiting:** cap messages/user (reuse the invite-email-log pattern) to prevent abuse.

---

## 16. Phased rollout

**Phase 0 — Admin tabs refactor (§2).** Prereq; small.

**Phase 1 — MVP.** `support_chat.sql` (tables + RLS + RPCs) · launcher + chat panel · Realtime delivery
· user send / admin reply · **auto-claim on first reply + `support_events` log (§9.5)** · lifecycle
states + Unassigned/Mine queues · Support inbox in the tabbed console · `api/support.js` (service-role
admin ops) · `api/support-notify.js` → **Discord ping w/ availability quick-actions, routed to owner
once claimed** · availability model (§3) · auto reassurance · reuse `public.notify()` for "admin
replied" · **Terms/Privacy support-access language (§4)** · privacy.html disclosure.

**Phase 2 — Depth.** Category-themed UI (§6) · screenshot + annotate (§8) · Web Push + reply sound ·
triage filters/tags/internal notes (§9) · **presence soft-lock (§9.5)** · reassign/release · archive +
auto-archive · CSAT (§11) · user-context sidebar + profile drill-down (§13) · reply-when-gone email ·
Slack/email channels · rate limiting.

**Phase 3 — Ops & growth.** Proactive nudges + "still relevant?" gate (§12) · GitHub-issue + feature
board (§13) · canned replies · **Support Metrics dashboard (§13.5)** · per-admin notification prefs.

**Phase 4+ — AI layer (§14).**

## 18. Build sequence — small, testable, shippable slices

> **Full per-slice build spec (DB, API, files, tests, done-when, risk) → `SUPPORT_CHAT_BUILD.md`.**
> The table below is the overview.

**Philosophy:** thin **vertical slices**, each its own branch → PR → Vercel preview → optional
`/code-review` → self-merge (per CONTRIBUTING). Every slice is independently shippable and reversible,
does one thing, and has a concrete way to prove it works before the next slice builds on it. Get an
end-to-end "walking skeleton" (a user message reaching an admin and back) working in the first few
slices, then layer depth on a working spine.

**Three testing seams we lean on the whole way:**
1. **Pure logic → Vitest.** Extract every decision function into `src/lib/` and unit-test it in
   isolation — the **availability resolver** (§3), **SLA/metric math** (§13.5), the **nudge
   "still-relevant" re-check** (§12), status-transition rules. Mirrors how the merge engine + money
   math are already covered. Fast, no backend.
2. **UI/interaction → the `?mock=1` harness.** Extend the mock Supabase stub
   (`src/lib/mockSupabaseStub.js` / `mockSessionData.js`) to seed sample conversations so the chat
   panel + admin inbox render with fake data on `localhost:3456/?mock=1` — click-test UI with zero
   backend. (Re-run the prod-safety grep after touching the harness — CLAUDE.md.)
3. **Integration (RLS, Realtime, notify) → real Supabase + preview deploy.** Two test accounts to
   prove RLS isolation; the PR's Vercel preview for real-app click-testing.

| # | Slice | Delivers | How you test it | Safe alone? |
|---|---|---|---|---|
| 0 | **Admin panel → tabs** | Refactor `AdminTab.jsx` into segmented tabs (Users · Usage · Support-placeholder). No new behavior. | Existing admin funcs still work; tabs switch by keyboard. | Pure refactor, revertible. |
| 1 | **DB foundation** | `supabase/support_chat.sql`: tables + RLS + RPCs. No UI. | Run in Studio; user A can't read user B's threads; anon key denied; owner-only writes. | DB-only; nothing consumes it yet. |
| 2 | **User chat panel (send/read)** | Launcher + panel + category picker; send a message, read own thread (simple fetch, no Realtime). | `?mock=1` for UI; real dev user round-trips a row. | Feature hidden behind launcher; no admin path yet. |
| 3 | **Admin inbox (read/reply) + auto-claim** | Support tab lists convos via `api/support.js`; open, reply; **auto-claim + `support_events` on first reply**. | **End-to-end milestone:** as admin, answer slice-2's message; user sees it on refetch. | First useful loop; manual refresh ok. |
| 4 | **Realtime** | Swap polling for live subscriptions both sides + `last_message` updates. | Two browsers; message appears instantly. | Isolated swap; revert = back to fetch. |
| 5 | **Outbound alerts + auto-reassurance** | `api/support-notify.js` → **Discord webhook** on new/unassigned (owner-routed after claim); `system` "we'll get back to you" when unattended. | Send as user → Discord message fires; claim → routing narrows. | Additive; webhook URL = env var. |
| 6 | **Availability + inbound "we replied"** | Availability resolver (hours + toggle + timeout + push actions, §3) drives the status line; reply → reuse `public.notify()` → `NotificationBanner`. | Vitest the resolver; toggle status → chat line flips; reply → user banner. | Reuses existing notify pipeline. |
| 7 | **Lifecycle + queues + archive** | Full status machine, snooze, **archive + auto-archive**, queue filters, wait-time badges, auto-reopen. | Vitest transition rules; move a thread through states; queues filter right; `events` logged. | UI + state only. |
| 8 | **Presence soft-lock** | "👁 viewing / ✍️ typing" indicators admin-side (§9.5). | Two admin browsers on one thread. | Purely additive awareness layer. |
| 9 | **Triage depth** | Priority, tags, internal notes, user-context sidebar + **profile drill-down**, bug **tech-context capture** (§7). | `?mock=1` UI; verify internal notes never reach user reads (RLS). | Additive fields/UI. |
| 10 | **Screenshot + annotate** | Lazy-loaded capture (permission-first, code fallback) + annotate/blur → attachment (§8). | Attach an image to a bug; denied-permission fallback path. | Lazy module; zero impact if unused. |
| 11 | **CSAT + reply-when-gone email** | Resolve → rating prompt; email fallback via `api/_email.js`; email replies thread back. | Resolve a thread → prompt; offline user → email sent. | Additive. |
| 12 | **Metrics dashboard** | `is_admin()` RPCs over timestamps + `events`; the §13.5 view. | Vitest the math; seed data → numbers render; non-admin gets nothing. | Read-only reporting. |
| 13 | **Proactive nudges** | Manual + triggered nudges with the **"still-relevant?" re-check gate** (§12). | Vitest the gate; simulate a trigger that resolves itself → auto-cancel. | Gated + frequency-capped. |
| 14 | **Polish** | Web Push · Slack/email channels · rate limiting · canned replies. | Per-item; reuse invite-log rate-limit test. | Independent add-ons. |

**Roughly:** slices 0–6 = the doc's Phase 1 (a genuinely usable support loop); 7–11 = Phase 2 depth;
12–14 = Phase 3 ops/growth. Each row is a PR you can preview, test, and merge on its own — stop at any
point and what shipped still works.

## 17. Open questions

1. **Business-hours defaults** + timeout length N for the availability model (§3).
2. **Retention:** keep support history indefinitely, or auto-archive resolved threads after N months?
3. **Signed-in only?** Hard sign-in gate today → launcher on landing page or not?
4. **Screenshot capture** mobile-browser coverage — confirm acceptable fallback behavior per platform.
5. **Nudge frequency caps** + quiet-hours defaults (§12).
