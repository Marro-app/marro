# Marro — Project Index

Budget planner for a WCM MD student (Class of 2030, extended curriculum). Tracks grant disbursement vs planned vs actual spending across 5 academic years.

## Stack & deploy
- Single file: `index.html` (~3.5k lines) — React 18 + Babel standalone + Recharts 2.5 + supabase-js 2 (all CDN), no build step
- Offline PWA (`sw.js`, `manifest.json`); **Supabase auth (Google) + per-user `app_state`/`profiles` tables** are the source of truth; `localStorage wcm_v8` is the offline cache + merge ancestor. (Old Gist sync `api/sync.js` deleted in Phase 2.5b.) See `DATA_MODEL.md`.
- Push to `main` → Vercel auto-deploy → https://wcm-budget.vercel.app
- Local dev: `python3 -m http.server 3456 --directory .` (see `launch.json`)

## index.html map — grep keys, not line numbers
Don't scan the file; `grep -n` the key for the section you need. Keys are stable code identifiers (verify with hit count if editing nearby).

| Area | Grep key |
|---|---|
| CSS (glass, tabbar fade, focus, date-field theming) | `<style>` (first hit) |
| Supabase client + transport (auth/data) | `const sb` / `const stateFetch` |
| Login gate / school picker (auth UI) | `const LoginScreen` / `const ProfileModal` / `US_MED_SCHOOLS` |
| First-run onboarding + identity (name/avatar/school) | `const OnboardingFlow` / `const AvatarPicker` / `const AvatarModal` |
| Avatar registry (30 styles, palette, renderer) | `const AVATARS` / `const AV_PALETTE` / `const AvatarArt` / `const Avatar` |
| Signature hero animation (welcome/finish/loading) | `const MarroIntro` |
| Auth session state + boot effect | `const [session` / `onAuthStateChange` |
| Sync merge engine (diff/conflict/apply utils) | `function diffStates` |
| Color tokens + chart palette | `const C = ` then `CHART_COLORS` |
| Year config generator (school-agnostic) / blank seeds | `generateYearConfigs` / `BLANK_MONTHLY` |
| Default state | `const DEFAULT_STATE` |
| Progressive setup (versioned post-launch onboarding Qs) | `SETUP_VERSION` / `SETUP_STEPS` / `const ProgressiveSetup` |
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
