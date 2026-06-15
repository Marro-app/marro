# Data Model & Sync

State schema, linkage system, and sync architecture. Read before touching data logic, and **always** read the linkage section before editing savings/weekly/entry code.

## State shape (`DEFAULT_STATE`, localStorage `wcm_v8`)
```
categories        [{id, label, locked?, autoCalc?}]
setupVersion      number|null  (null=run onboarding; SETUP_VERSION when complete — progressive setup)
years             [{id, label, type, grant, tuitionFees, healthIns, otherIncome,
                    housing, housingNote, livingAllowance, notes, startDate,
                    endDate, monthly:{catId→amount}, monthlyOverrides:{monthName→{catId→amount}}}]
weeklyArchive     [{weekStart, weekEnd, entries:[{id,catId,amount,note,date,depositId?}], total}]
currentWeekEntries [{id,catId,amount,note,date,depositId?}]
subscriptions     [{id,name,amount,cycle,renewal,active}]
monthlyRollover   {yyyy-mm: amount}
surplusBank       number
monthDisabled     {"ay-MonthName": [catIds]}
darkMode          bool
stepGoals / savingsGoals  [{id,label,targetAmount,targetDate,saved,monthlyContribution}]
savingsLog        [{id,goalId,amount,date,note,weeklyEntryId?,budgetAdded?}]
_savedAt          number (timestamp on every save — drives 3-way merge)
```

### savingsLog entry (key to linkage)
- `weeklyEntryId` — `"e_<ts>"` linked weekly entry (if auto-created)
- `budgetAdded` — `{ay, monthName, catId, amount} | null` — budget delta auto-added

## Year configs (school-agnostic — Phase 3, June 14)
No school is hardcoded. Years are produced by **`generateYearConfigs(startYear, lengthYears, extendedYear)`** — a tier-1 heuristic date provider that anchors each academic year near Aug 1 (start `${y}-08-01` → end `${y+1}-08-15`; extended year ends `06-30`). All financial fields default to **0** (`blankYearFields()`); monthly budgets seed from **`BLANK_MONTHLY`** (all 0). Users fill figures in the Aid tab (or, future, via aid-letter scan). `id` === array index at generation; `addYear` inherits the user's own prior year, never any school's numbers.

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
- Hard login gate. `session` state: `undefined`=restoring → Loading; `null`=signed out → `LoginScreen`; object → app. `getSession()` on boot + `onAuthStateChange`; `SIGNED_OUT` clears `wcm_v8`/`wcm_v8_base`/`wcm_uid`.
- `applyTheme(dataset!=="light")` runs at module load so pre-login screens (LoginScreen) theme correctly before app data loads.

### Supabase tables (RLS: each user reads/writes only their own row, `auth.uid() = user_id`)
- `app_state(user_id uuid PK, state jsonb, updated_at)` — the whole state blob, one row/user.
- `profiles(user_id uuid PK, school text, created_at)` — null/empty school → first-run `OnboardingFlow` (welcome → name → avatar → school; saves name+avatar into `app_state.state`, school into `profiles`). School-only re-edit from Settings reuses `ProfileModal` (dismissable). Picker (shared by both) searches `US_MED_SCHOOLS` (full Wikipedia MD+DO list; entries are `{name}` or `{name, campuses:[...]}`); multi-campus schools add a campus step, stored as `"Name — Campus"`; free-text Other. Save uses explicit `update().eq("user_id").select()` then `insert` if no row (upsert was a silent no-op).
- **Identity fields in `state` (not the DB):** `preferredName` (string|null — the name used in the header greeting + settings) and `avatar` (`{type:"art",style,color}` | `{type:"google",url}` | `{type:"upload",url}` | null; legacy `{type:"monogram",…}` falls back to an initial chip). Set during `OnboardingFlow`; both are editable later from the Settings menu (inline name field; avatar opens `AvatarModal`). Rendered everywhere via the `Avatar` component → `AvatarArt` for art styles. `avatar.style` is one of 30 ids in the `AVATARS` registry (groups: marks/chars/creatures); `avatar.color` is an `AV_PALETTE` key (9 accents incl. `ink`). **The badge is theme-aware** (`AvatarArt` reads `data-theme`): a near-black coin in dark mode, a warm paper coin + hairline ring in light mode. Each mark's `svg(c,d,bg,hi)` takes `bg` (badge colour, for cutouts like `phase`) and `hi` (on-badge detail colour — cream on dark, ink on light, e.g. `constellation` stars) so marks stay legible in both themes. `cream` reads as a deliberately soft avatar in light mode and `ink` as a soft one in dark mode (tonal extremes, by design). Uploads are canvas-downscaled to a 160px JPEG data URL stored inline in `state` (kept small to avoid bloating the synced blob). The shared `AvatarPicker` (preview + photo + color + grouped gallery) backs both onboarding and the settings editor. Header greeting picks from a daily-rotating message pool (brand voice, name-aware).
- **Hero animation (`MarroIntro`):** the signature reveal — a marigold dot draws the three logo rings then splits to fill the center dot + drop the period of "Marro." Deterministic (pure function of time, own rAF loop, reduced-motion aware). Shown on the onboarding welcome + finish steps and the full-screen loading gate (`loadingScreen`).

### Storage keys (localStorage = offline cache + merge ancestor; Supabase = source of truth)
| Key | Purpose |
|---|---|
| `wcm_v8` | Current local state (cache) |
| `wcm_v8_base` | Last synced state (3-way-merge ancestor) |
| `wcm_uid` | Last signed-in user id (shared-device guard: clears cache if a different user signs in) |

### Flow
- Every save stamps `_savedAt` (the merge clock, inside the blob). Load (gated on `session`): `stateFetch()` → server row becomes `wcm_v8` + `wcm_v8_base`. No row + online → **first-login migration**: upload local `wcm_v8`/`wcm_v7` (or DEFAULT_STATE) via `stateWrite`. Offline → local cache, `syncStatus:"offline"`.
- On save (debounced 2s): fetch server, compare `_savedAt` vs base — server not newer → write; newer without overlap → silent auto-merge; same field changed both sides → **ConflictModal**.
- `window online` → immediate save. `visibilitychange` + every 30s visible → `checkAndPull`.

### Merge engine (utility fns before App — transport-agnostic, reused unchanged from the Gist era)
`diffStates(base, cur)` → changed-key map `{b,c}` · `findConflicts(localCh, serverCh)` · `applyChanges(state, changes)` · `conflictLabel` / `fmtConflictVal` for display.

### Transport (`stateFetch` / `stateWrite`, before App)
- `stateFetch()` → `sb.from("app_state").select("state").maybeSingle()` → JSON string | null (null = no row or error/offline).
- `stateWrite(json)` → upsert `{user_id, state}` → boolean. Same string-in/string-out contract the old `gistFetch`/`gistWrite` had, so `save`/`checkAndPull`/`resolveConflict` only needed a name swap. (Old `api/sync.js` Gist proxy deleted.)

### Service worker (`sw.js`)
Cache `wcm-budget-v8`. Never caches `index.html` (navigations always network) — OAuth redirects safe. Caches `/manifest.json`, `/icon.svg`, fonts; network-first/cache-fallback otherwise (covers the supabase-js CDN script for offline). Registration: `updateViaCache:'none'`, `reg.update()` on load, auto-reload on `controllerchange`.
