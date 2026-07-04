# Marro — Project Index

Budget planner for medical students (any US MD/DO program; started WCM-specific, now school-agnostic). Tracks grant disbursement vs planned vs actual spending across each user's academic years.

## Stack & deploy
- **Vite app** (Phase 3.5): React 18 + Recharts 2.5 + supabase-js 2 as npm deps (versions pinned to what the old CDN served); `index.html` = thin entry; static assets in `public/`. **Component split done (Step 2):** `src/main.jsx` = thin entry (`window.storage` shim + `createRoot`); **`src/App.jsx`** (~1k lines) = the shared shell — auth/sync/save, header, year selector, top metrics, App-level modals (conflict/renewal/reset/add-year/onboarding), `SilentUpdater`, and the `AppContext` Provider; **`src/context/AppContext.js`** = the shared surface + `useApp()`; **`src/tabs/{Budget,Weekly,Charts,Savings,Aid,Subscriptions,Customize}Tab.jsx`** = the 7 tab panels (each owns its private form state, reads shared via `useApp()`); pure **`src/lib/`** (`data`/`theme`/`brands`/`format`/`schools`/`avatars`/`ui-helpers`/`hooks`) + **`src/components/`** (`icons`/`primitives`/`pickers`/`avatars`/`LoginScreen`/`onboarding`/`modals`). **`src/landing/`** = the public, signed-out landing page (`LandingPage.jsx` + `RingCanvas.jsx` + `scenes.jsx` + `landing.css`), lazy-loaded from `App.jsx` as its own chunk so it doesn't add to the signed-in bundle. **Node via nvm (`nvm use --lts`).**
- Offline PWA via `vite-plugin-pwa` (Workbox generates `sw.js` + precache from the fingerprinted build; `registerType:'prompt'` hands control to the app; `SilentUpdater` in `src/App.jsx` applies the new build **silently** only when the tab is backgrounded AND nothing is mid-flow — no toast, and the waiting worker also activates on the next cold start as a fallback, so it can never reload mid-edit). `manifest.json` is hand-authored in `public/`. **Supabase auth (Google) + per-user `app_state`/`profiles` tables** are the source of truth; `localStorage marro_v8` is the offline cache + merge ancestor. (Old Gist sync `api/sync.js` deleted in Phase 2.5b.) See `DATA_MODEL.md`.
- Push to `main` → Vercel auto-deploy → https://joinmarro.com. **⚠️ Before the first Vite deploy, Vercel must be set to Framework=Vite (build `npm run build`, output `dist/`) — it previously served the repo as static files. Untested against prod yet.**
- Local dev: `npm run dev` → http://localhost:3456 (`npm run build` / `npm run preview` for the production bundle). See `launch.json`.

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
- `STRATEGY.md` — company/business/AI vision, monetization, people & equity, legal, infra hygiene, two-founder collaboration model
- `AI_COST_MODEL.md` — plain-language AI cost model: per-feature/user/scale cost, Haiku/Sonnet/Opus routing, cost-control levers, launch safeguards, staged pricing (read before Phase 4 AI work)
- `FUTURE_WORK.md` — prioritized backlog

## Critical rules
1. Plan first for multi-feature work; visual-verify every UI change before declaring done
2. Credentials only in Vercel env vars — never in `index.html` (public repo; scanners revoke pushed tokens)
3. Read the linkage section in `DATA_MODEL.md` before touching savings/weekly/entry logic — deposits create linked weekly entries + budget overrides bidirectionally
4. Offline PWA: no new external resources (fonts, images) without self-hosting
