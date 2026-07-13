# Data Model & Sync

State schema, linkage system, and sync architecture. Read before touching data logic, and **always** read the linkage section before editing savings/weekly/entry code.

## State shape (`DEFAULT_STATE`, localStorage `marro_v8`)
```
categories        [{id, label, locked?, autoCalc?}]
setupVersion      number|null  (null=run onboarding; SETUP_VERSION when complete — progressive setup)
years             [{id, label, type, grant, tuitionFees, healthIns, otherIncome,
                    housing, housingNote, livingAllowance, notes, startDate,
                    endDate, monthly:{catId→amount}, monthlyOverrides:{monthName→{catId→amount}}}]
weeklyArchive     [{weekStart, weekEnd, entries:[{id,catId,amount,note,date,depositId?}], total}]
currentWeekEntries [{id,catId,amount,note,date,depositId?}]
subscriptions     [{id,name,amount,cycle,renewal,active}]
monthDisabled     {"ay-MonthName": [catIds]}
darkMode          bool
stepGoals / savingsGoals  [{id,label,targetAmount,targetDate,saved,monthlyContribution}]
savingsLog        [{id,goalId,amount,date,note,weeklyEntryId?,budgetAdded?}]
loans             [{id,name,type:"federal"|"private",academicYear,rate,status,disbursements,feePct,notes,asOfBalance,asOfDate}]
balanceReadings   [{id,date,spendable,savings}]   // append-only; see "Phase 2" section below
loanReminderSnooze  null | {choice:"never", at:iso}
refundPlaybookSeen  null | {term:"2027-spring", at:iso}
_savedAt          number (timestamp on every save — drives 3-way merge)
```
**Removed 2026-07-13 (Phase 2 commit 1 — dead-field cleanup):** `monthlyRollover` and `surplusBank` used to live here. Both were dead code — the app promised in Settings copy that "leftover monthly money rolls into next month," but nothing ever actually wrote a value into either field, so the promise was false. Removed along with the UI that referenced them; the real, working weekly rollover (`lastWeekSurplus`/`thisWeekBudget`, unrelated despite the similar name) was untouched. Detail: `PRODUCT_DECISIONS.md` "Phase 2 commit 1."

### savingsLog entry (key to linkage)
- `weeklyEntryId` — `"e_<ts>"` linked weekly entry (if auto-created)
- `budgetAdded` — `{ay, monthName, catId, amount} | null` — budget delta auto-added

## Year configs (school-agnostic — Phase 3, June 14)
No school is hardcoded. Years are produced by **`generateYearConfigs(startYear, lengthYears)`** — a tier-1 heuristic date provider that anchors each academic year near Aug 1 (start `${y}-08-01` → end `${y+1}-08-15`). All financial fields default to **0** (`blankYearFields()`); monthly budgets seed from **`BLANK_MONTHLY`** (all 0). Users fill figures in the Aid tab (or, future, via aid-letter scan). `id` === array index at generation; `addYear` inherits the user's own prior year, never any school's numbers. **Years are plain numbered years — no `type` field** (the old `type:"extended"`/`"standard"` distinction was removed June 15; legacy extended years migrate to numbered on load).

**`data.program`** — dual-degree track: `{ degree:"MD"|"DO" (derived from school via degreeForSchool), dual: null|"phd"|"masters"|"other", phd:{field,institution}, masters:{field,institution}, other:{field,institution} }` (each dual sub-object: `field` = degree/area, `institution` "" = same as med school). Institution `""` = same as the med school. Captured in onboarding step 4, editable in Settings → Program (`ProgramModal`). DO dual options gated by the curated `DO_DUAL` map; MD schools offer PhD+Master's to all.

`generateYearConfigs` is the **swappable seam** for future date sources (user-corrected → fetched-calendar tiers) — see FUTURE_WORK Phase 3 vision. Onboarding's program step calls it on first-run only.

`DEFAULT_STATE.years` = `generateYearConfigs(currentYear, 4, false)`. **Migration:** boot renames legacy `wcmLivingAllowance`→`livingAllowance`, backfills missing fields with zeros, regenerates a default if `years` is empty — and never injects any school's figures.

## Academic calendar
```js
MONTH_NAMES = ["Aug",...,"Jul"]   // index 0=Aug, 11=Jul
// calendar month → academic index: (calMonth - 7 + 12) % 12
// monthKey format: "ay-MonthName" e.g. "0-Aug"
```

## Key computed values (in render)
```js
yr          = data.years[ay]
moSpendable = (annGrant - tuition - healthIns + otherIncome*12) / 12
moSurplus   = moSpendable - moSpend - unbudgetedTotal   // rounded
weeklyBudget= moSpendable / 4.333 (+ last week's rollover)
```

---

## Phase 2: Loans, Debt & Runway (2026-07-13)

All the math here lives in **`src/lib/loans.js`** — a pure, fully-tested file with no React/App dependencies, built specifically so the numbers behind the Debt and Runway header tiles are hand-checkable and unit-testable in total isolation. Read that file's header comment + `docs/PRODUCT_DECISIONS.md` "Phase 2 commit 3" for the worked studentaid.gov example it was verified against, and the "Phase 2 commit 7" entry for how the header tiles consume it. This section covers the **data shapes**, not the formulas.

### `loan` shape
```
{ id, name, type:"federal"|"private", academicYear:2026,
  rate: null|decimal,             // null = infer from the federal rate table (private loans: 0 until entered)
  status: "offered"|"accepted"|"disbursed",   // manual entries default "disbursed"
  disbursements: [{id, date, amount, dateConfirmed}],  // the chunks the money actually arrives in (fall/spring, or 3-4x for some schools)
  feePct: null|decimal,            // null = 1.057% for federal, 0 for private
  notes,
  asOfBalance: null|number, asOfDate: null|iso }  // alternate entry mode — see below
```
**Two entry modes, never mixed:** the default mode sums `disbursements` (the *original amount borrowed*, grossed up by the fee); the alternate "balance as of [date]" mode (`asOfBalance`/`asOfDate` both set) uses that number as-is and accrues interest only from `asOfDate` forward. The second mode exists because studentaid.gov's own "current balance" already has years of interest baked in — typing that number into the default mode would double-count the interest already accrued (interest-on-interest). Only one mode is active per loan (`asOfDate != null` short-circuits the disbursement-based math everywhere in `loans.js`).

Only `status: "accepted"` or `"disbursed"` loans count toward the Debt tile — an `"offered"` loan is money the student hasn't committed to yet.

### `balanceReadings` — append-only, id-keyed
```
{ id, date:"2026-10-01", spendable:6400, savings:12000|null }
```
One entry per check-in ("about how much do you have available for living costs right now?"). `savings` is optional and, when the student leaves it blank, the check-in UI pre-fills the input with the *last known* savings value so a reading is never accidentally recorded as "$0 in savings" — but the stored value itself can genuinely be `null` (never asked/answered). Readings are never edited or deleted after the fact, only appended to — the full history is what lets `computeRunway` measure real spending pace between any two dates.

**Burn-from-total rule:** the monthly spending pace `computeRunway` measures is derived from the **total** of `spendable + savings` between two readings, never from `spendable` alone. This is deliberate: if a student moves $8,000 from checking into savings, that's a transfer, not $8,000 of spending — measuring `spendable` alone would read it as a giant spending spree that month. The countdown itself still anchors on `spendable` (that's the number that actually runs out day to day); the total is only used to compute the underlying pace.

**Balance-anchor design rationale (why ask for a balance instead of tracking transactions):** real life can't break it. A parent's gift, cash spending, a forgotten subscription, a refund — everything nets into the next balance reading automatically, with no receipts and no bank login. The trade-off is resolution (a monthly number, not a live feed) and the "≥14 days apart" rule below.

### `loanReminderSnooze` / `refundPlaybookSeen` — scalar, last-write-wins
`loanReminderSnooze: null | {choice:"never", at:iso}` — dismissing the empty-Loans-tab reminder banner. `refundPlaybookSeen: null | {term:"2027-spring", at:iso}` — one Refund Playbook card per refund cycle; a new term always gets a fresh card even after a prior term was dismissed.

### Runway's state machine (`computeRunway`, `src/lib/loans.js`)
Returns one of 7 states, each carrying only the fields relevant to it: `unanchored` (no balance readings yet), `growing` (spending less than she brings in), `through_graduation` (comfortably lasts), `counting_down` (a real countdown to a run-out date, incl. a `basicallyOnTrack` sub-case when the gap to the next refund is under 7 days), `gap` (runs out before the next refund — carries a trim-per-month suggestion), `overdrawn` (spendable ≤ $0 — carries whether savings covers it), and `graduated` (suppressed — money no longer needs to "last"). A measured burn rate is only trusted once two readings are ≥14 days apart; under that, the student's budgeted plan fills in instead (labeled `burn.source:"plan"`) rather than trusting a single noisy day.

### Merge engine (`src/lib/data.js`)
`loans` and `balanceReadings` are id-keyed buckets (each item diffs/merges independently — two devices adding different loans, or checking in on the same day, both survive a merge). `loanReminderSnooze` and `refundPlaybookSeen` are plain scalar fields (last-write-wins, same as `darkMode`/`preferredName`).

---

## ⚡ Savings ↔ Weekly ↔ Budget linkage (CRITICAL)

### How money flows
1. **"Log deposit" (Savings tab)** → creates savingsLog entry + weekly entry (catId=`exams` for Step, `savings` for custom) + increments `goal.saved`. If base `monthly[catId]===0`, auto-manages `monthlyOverrides` (below).
2. **Weekly "exams" entry** → credits first unfunded Step goal, overflowing to the next once full. One weekly entry can create multiple savingsLog rows. The budget line is NOT credited — it's a plan only.
3. **Budget line (`monthly.exams`)** → drives the Savings-tab callout. Never auto-credits `saved`. (Deliberate UX decision, June 2026 — weekly entries and Log deposit are the only things that move real money.)

### Auto-managed budget override (deposit → budget tab)
- Only when `monthly[catId] === 0` (no manual base budget)
- Create: `override += depositAmt` (increments — handles multiple deposits/month)
- Delete: `override -= budgetAdded.amount`, floor 0; delete key at 0
- Manual base budget > 0 → `budgetAdded = null`, override untouched

### Helpers (grep these)
| Function | Does |
|---|---|
| `removeWeeklyEntry(d, eid)` | Removes entry from currentWeekEntries + all archives |
| `reverseDeposit(d, slEntry)` | Removes weekly entry, decrements goal.saved + override, removes savingsLog row |
| `reverseDepositGroup(d, slEntry)` | Reverses all savingsLog rows sharing `weeklyEntryId` (overflow splits) |

### Delete paths
- Savings tab × → savingsLog by `entry.id` → `reverseDepositGroup`
- Weekly tab × → savingsLog rows by `weeklyEntryId === eid` → reverse all; none found → plain delete

### USMLE callout (Savings tab)
Shows when `yr.monthly.exams > 0` AND any Step goal has `saved < targetAmount && !monthlyContribution`. Apply sets `monthlyContribution` (projection only); callout then hides.

---

## Auth + Sync architecture (CRITICAL — read before touching sync)

### Auth (Phase 2.5b)
- supabase-js v2 UMD via CDN; client `const sb` (the UMD global is `supabase` — don't shadow it). URL + **publishable** key hardcoded in `index.html` (safe; RLS-gated). PKCE flow.
- Hard login gate. `session` state: `undefined`=restoring → Loading; `null`=signed out → `LoginScreen`; object → app. `getSession()` on boot + `onAuthStateChange`; `SIGNED_OUT` clears `marro_v8`/`marro_v8_base`/`marro_uid`.
- `applyTheme(dataset!=="light")` runs at module load so pre-login screens (LoginScreen) theme correctly before app data loads.

### Supabase tables (RLS: each user reads/writes only their own row, `auth.uid() = user_id`)
- `app_state(user_id uuid PK, state jsonb, updated_at)` — the whole state blob, one row/user.
- `profiles(user_id uuid PK, school text, created_at)` — null/empty school → first-run `OnboardingFlow` (welcome → name → avatar → school; saves name+avatar into `app_state.state`, school into `profiles`). School-only re-edit from Settings reuses `ProfileModal` (dismissable). Picker (shared by both) searches `US_MED_SCHOOLS` (full Wikipedia MD+DO list; entries are `{name}` or `{name, campuses:[...]}`); multi-campus schools add a campus step, stored as `"Name — Campus"`; free-text Other. Save uses explicit `update().eq("user_id").select()` then `insert` if no row (upsert was a silent no-op).
- **Identity fields in `state` (not the DB):** `preferredName` (string|null — the name used in the header greeting + settings) and `avatar` (`{type:"art",style,color}` | `{type:"google",url}` | `{type:"upload",url}` | null; legacy `{type:"monogram",…}` falls back to an initial chip). Set during `OnboardingFlow`; both are editable later from the Settings menu (inline name field; avatar opens `AvatarModal`). Rendered everywhere via the `Avatar` component → `AvatarArt` for art styles. `avatar.style` is one of 30 ids in the `AVATARS` registry (groups: marks/chars/creatures); `avatar.color` is an `AV_PALETTE` key (9 accents incl. `ink`). **The badge is theme-aware** (`AvatarArt` reads `data-theme`): a near-black coin in dark mode, a warm paper coin + hairline ring in light mode. Each mark's `svg(c,d,bg,hi)` takes `bg` (badge colour, for cutouts like `phase`) and `hi` (on-badge detail colour — cream on dark, ink on light, e.g. `constellation` stars) so marks stay legible in both themes. `cream` reads as a deliberately soft avatar in light mode and `ink` as a soft one in dark mode (tonal extremes, by design). Uploads are canvas-downscaled to a 160px JPEG data URL stored inline in `state` (kept small to avoid bloating the synced blob). The shared `AvatarPicker` (preview + photo + color + grouped gallery) backs both onboarding and the settings editor. Header greeting picks from a daily-rotating message pool (brand voice, name-aware).
- **Hero animation (`MarroIntro`):** the signature reveal — a marigold dot draws the three logo rings then splits to fill the center dot + drop the period of "Marro." Deterministic (pure function of time, own rAF loop, reduced-motion aware). Shown on the onboarding welcome + finish steps and the full-screen loading gate (`loadingScreen`).

### Invite codes + waitlist + admin (`supabase/invites_waitlist.sql`, 2026-07-07)
The growth layer on top of the `allowed_emails` gate. **Not user-editable directly** — generation, redemption, and quota all run through SECURITY DEFINER RPCs (or the `api/admin.js` service-role backend) so the DB, not the browser, enforces quota/single-use/atomicity. Tables:
- `invite_codes(code text PK [upper, unambiguous alphabet], owner_id uuid, created_at, redeemed_by uuid, redeemed_email, redeemed_at, revoked_at)` — single-use. RLS: owner SELECTs own only; no client writes. `revoked_at` cancels an unused code and frees the owner's quota.
- `waitlist(user_id uuid PK, email, reason, created_at)` — one row/user (idempotent join). RLS: insert/select own.
- `user_roles(email text PK, is_ambassador bool, quota_override int, updated_by, updated_at)` — ambassador flag + quota override, keyed by email, admin-managed. RLS: **select own only, no client writes** (so a user can't inflate their own quota).
- `admins(email text PK, added_by, created_at)` — the admin allowlist. **No client RLS policies** (private); read via `is_admin()` + service role. Seeded with owner `jawadhijazi7@gmail.com`; admins add/remove others via the console.
- `invite_attempts(id, user_id, code_tried, outcome, created_at)` — failed-redemption log for the brute-force lockout. No client policies.

RPCs (grant execute → authenticated): `is_admin()→bool` (console visibility only — `api/admin.js` re-checks server-side), `my_invite_quota()→int` (override, else 15 ambassador / 5), `generate_invite_code()→jsonb` (`{status:'ok',code}`|`{status:'quota_exhausted',quota}`), **`redeem_invite_code(p_code)→jsonb`** (`ok`|`already_used`|`revoked`|`invalid`|`locked`; atomic single-use claim `UPDATE…WHERE redeemed_by IS NULL AND revoked_at IS NULL RETURNING`; ≥10 fails/hr → `locked`; success inserts into `allowed_emails`). Backend `api/admin.js` (service-role, verifies caller's token then re-checks `admins`): `list_overview`, `generate_codes`, `revoke_code`, `set_role`, `add_admin`, `remove_admin`. Client wrappers in `src/lib/data.js`; UI in `src/landing/InviteGate.jsx`, `src/tabs/AdminTab.jsx`, `src/components/InviteFriendsModal.jsx`.

### Storage keys (localStorage = offline cache + merge ancestor; Supabase = source of truth)
| Key | Purpose |
|---|---|
| `marro_v8` | Current local state (cache) |
| `marro_v8_base` | Last synced state (3-way-merge ancestor) |
| `marro_uid` | Last signed-in user id (shared-device guard: clears cache if a different user signs in) |

### Flow
- Every save stamps `_savedAt` (the merge clock, inside the blob). Load (gated on `session`): `stateFetch()` → server row becomes `marro_v8` + `marro_v8_base`. No row + online → **first-login migration**: upload local `marro_v8`/`marro_v7` (or DEFAULT_STATE) via `stateWrite`. Offline → local cache, `syncStatus:"offline"`.
- On save (debounced 2s): fetch server, compare `_savedAt` vs base — server not newer → write; newer without overlap → silent auto-merge; same field changed both sides → **ConflictModal**.
- `window online` → immediate save. `visibilitychange` + every 30s visible → `checkAndPull`.

### Merge engine (utility fns before App — transport-agnostic, reused unchanged from the Gist era)
`diffStates(base, cur)` → changed-key map `{b,c}` · `findConflicts(localCh, serverCh)` · `applyChanges(state, changes)` · `conflictLabel` / `fmtConflictVal` for display.

### Transport (`stateFetch` / `stateWrite`, before App)
- `stateFetch()` → `sb.from("app_state").select("state").maybeSingle()` → JSON string | null (null = no row or error/offline).
- `stateWrite(json)` → upsert `{user_id, state}` → boolean. Same string-in/string-out contract the old `gistFetch`/`gistWrite` had, so `save`/`checkAndPull`/`resolveConflict` only needed a name swap. (Old `api/sync.js` Gist proxy deleted.)

### Service worker (`sw.js`)
Cache `marro-v8`. Never caches `index.html` (navigations always network) — OAuth redirects safe. Caches `/manifest.json`, `/icon.svg`, fonts; network-first/cache-fallback otherwise (covers the supabase-js CDN script for offline). Registration: `updateViaCache:'none'`, `reg.update()` on load, auto-reload on `controllerchange`.
