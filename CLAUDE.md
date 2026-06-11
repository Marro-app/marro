# Marro (wcm-budget)

Budget planner for a WCM MD student. Single-file app: `index.html` (~3.4k lines, React 18 + Babel standalone + Recharts, no build step). Live at https://wcm-budget.vercel.app — **push to `main` deploys immediately; always ask before pushing.**

## Orientation
- `docs/PROJECT_INDEX.md` — stack, grep-key map of `index.html` (use it instead of scanning the file), docs list
- `docs/DATA_MODEL.md` — state schema, **savings↔weekly↔budget linkage (read before touching that logic)**, Gist sync
- `docs/DESIGN_SYSTEM.md` + `docs/MOTION_SYSTEM.md` — read before any UI/animation work
- `docs/ROADMAP.md` — phase status · `docs/FUTURE_WORK.md` — backlog

## Workflow rules
1. **Plan first** for multi-feature work — present the plan, wait for approval. Single obvious bug fixes: just do it.
2. **Visual verify** every UI change (`preview_screenshot` on localhost:3456) before declaring done. Glass effects don't render on `file://` — always use the server.
3. **Concise** — 1–2 sentence summaries, no over-explaining. Token-frugal: plain text/lists over widgets.
4. **Credentials** only in Vercel env vars (established pattern: `api/sync.js` reads `GIST_TOKEN`). This repo is public.
5. Ambiguous UX tradeoffs → ask (AskUserQuestion). Obvious calls (wording, ordering, colors) → just decide.
6. Ship a roadmap item → immediately mark it ✓ in `docs/ROADMAP.md`; log decisions in `docs/PRODUCT_DECISIONS.md` as they're made, not at session end.

## Local dev
`python3 -m http.server 3456 --directory .` then http://localhost:3456
