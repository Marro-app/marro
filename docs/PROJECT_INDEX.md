# Marro — Project Index

Budget planner for a WCM MD student (Class of 2030, extended curriculum). Tracks grant disbursement vs planned vs actual spending across 5 academic years.

## Stack & deploy
- Single file: `index.html` (~3.4k lines) — React 18 + Babel standalone + Recharts 2.5, no build step
- Offline PWA (`sw.js`, `manifest.json`); storage `localStorage wcm_v8` + GitHub Gist sync via `api/sync.js` (Vercel serverless)
- Push to `main` → Vercel auto-deploy → https://wcm-budget.vercel.app
- Local dev: `python3 -m http.server 3456 --directory .` (see `launch.json`)

## index.html map — grep keys, not line numbers
Don't scan the file; `grep -n` the key for the section you need. Keys are stable code identifiers (verify with hit count if editing nearby).

| Area | Grep key |
|---|---|
| CSS (glass, tabbar fade, focus, date-field theming) | `<style>` (first hit) |
| Sync merge engine (diff/conflict/apply utils) | `function diffStates` |
| Color tokens + chart palette | `const C = ` then `CHART_COLORS` |
| Year configs / default state | `YEAR_CONFIGS` / `const DEFAULT_STATE` |
| Money formatters (fmt/fmtS/fmtD/fmtA/fmtSA) | `const fmt ` |
| Shared components (Pill, Card, MetricTile…) | `const Pill` / `const Card` / `MetricTile =` |
| RenewalDialog / WeekSelectorModal / ConflictModal | `function RenewalDialog` etc. |
| App state hooks | `function App()` |
| Subscriptions save / weekly entry add | `const saveSub` / `const addEntry` |
| Linkage logic (deposits ↔ weekly ↔ budget) | `reverseDeposit` |
| Reset / remove-year confirmations | `confirmReset` |
| Add category / deposit / goal modals | `showAddCat` (2nd hit = modal) |
| CSV import | `parseCSV` / `doImport` |
| Tab sections (budget, weekly, charts, savings, aid, subscriptions, customize) | `tab==="budget"` etc. |

## Docs
- `DATA_MODEL.md` — state schema, year configs, **linkage system**, sync architecture (read before data/logic work)
- `DESIGN_SYSTEM.md` — brand, tokens, semantic color rules, formatting rules (read before UI work)
- `MOTION_SYSTEM.md` — animation inventory + design-engineering rules (read before any animation work)
- `COMPONENT_LIBRARY.md` — shared components & state vocabulary
- `UI_AUDIT_LOG.md` — every audit finding/fix
- `PRODUCT_DECISIONS.md` — decisions + rationale
- `ROADMAP.md` — phase plan and status
- `FUTURE_WORK.md` — prioritized backlog

## Critical rules
1. Plan first for multi-feature work; visual-verify every UI change before declaring done
2. Credentials only in Vercel env vars — never in `index.html` (public repo; scanners revoke pushed tokens)
3. Read the linkage section in `DATA_MODEL.md` before touching savings/weekly/entry logic — deposits create linked weekly entries + budget overrides bidirectionally
4. Offline PWA: no new external resources (fonts, images) without self-hosting
