# Data Model & Sync

State schema, linkage system, and sync architecture. Read before touching data logic, and **always** read the linkage section before editing savings/weekly/entry code.

## State shape (`DEFAULT_STATE`, localStorage `wcm_v8`)
```
categories        [{id, label, locked?, autoCalc?}]
years             [{id, label, type, grant, tuitionFees, healthIns, otherIncome,
                    housing, housingNote, wcmLivingAllowance, notes, startDate,
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

## Year configs (`YEAR_CONFIGS`, index === y.id)
| idx | Label | Start | End | Grant | Tuition | Housing |
|---|---|---|---|---|---|---|
| 0 | Year 1 2026-27 | 2026-08-01 | 2027-08-15 | $109,848 | $76,648 | $996 Olin Hall |
| 1 | Year 2 2027-28 | 2027-08-01 | 2028-08-15 | $109,848 | $76,648 | $1,370 Lasdon |
| 2 | Year 3 2028-29 | 2028-08-01 | 2029-08-15 | — | — | — |
| 3 | Year 4 2029-30 | 2029-08-01 | 2030-08-15 | — | — | — |
| 4 | Extended 2030-31 | 2030-08-01 | 2031-06-30 | $0 | $5,232 (waived) | — |

Default monthly budgets (`DEFAULT_MONTHLY`): Y1 housing $996, food $380, transport $110, personal $150, books $80, exams $0, savings $150, social $80. Y2: exams $50, savings $100, housing $1,370. Y3: exams $150, savings $0. Y4: exams $100. Y5(ext): exams $50.

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

## Sync architecture (CRITICAL — read before touching sync)

### Storage keys
| Key | Purpose |
|---|---|
| `wcm_v8` | Current local state |
| `wcm_v8_base` | Last synced state (3-way-merge ancestor) |
| `wcm_gist_id` | Cached Gist ID |

### Flow
- Every save stamps `_savedAt`. On load, a successful Gist fetch becomes both `wcm_v8` and `wcm_v8_base`.
- On save (debounced 2s): fetch server, compare `_savedAt` vs base —
  server not newer → write; newer without overlap → silent auto-merge; same field changed both sides → **ConflictModal**.
- `window online` → immediate save. `visibilitychange` + every 30s visible → `checkAndPull`.

### Merge engine (utility fns before App)
`diffStates(base, cur)` → changed-key map `{b,c}` · `findConflicts(localCh, serverCh)` · `applyChanges(state, changes)` · `conflictLabel` / `fmtConflictVal` for display.

### Server side
- `/api/sync.js` (Vercel serverless) proxies the Gist API using the `GIST_TOKEN` env var — credentials never appear in `index.html`.
- Gist discovery: `GET /api/sync` without `id` scans for `wcm_budget_v1.json`; frontend clears a failed cached ID and re-discovers.

### Service worker (`sw.js`)
Cache `wcm-budget-v6`. Never caches `index.html` (navigations always network). Caches only `/manifest.json` + `/icon.svg`. Registration: `updateViaCache:'none'`, `reg.update()` on load, auto-reload on `controllerchange`.
