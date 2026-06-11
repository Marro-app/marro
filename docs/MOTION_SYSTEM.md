# Motion System

Motion conveys state, never decoration (product register). 150–250ms, ease-out. No page-load choreography.

## Inventory
- Ambient blobs: 4 divs, blur(34px), 15–21s ease-in-out cycles. Budget-health signal: calm greens (on track) / low-tide `#7C8471` (over) / marigold bloom (milestone). Transitions are slow color interpolation.
- Logo rings: slow ping-pong scale.
- `tipIn` (InfoTip): scale+fade, origin bottom-center, after 140ms hover intent.
- ProgressBar width: .4s.
- Buttons/tabs: `all .15s`.
- Sync pulse: `wcmpulse` 1s on the syncing dot.

## Rules
- Animate transform/opacity (+ width on progress bars only). No layout-property animation.
- New keyframes need a `@media (prefers-reduced-motion: reduce)` fallback (crossfade or none). **Gap: blobs currently lack one — see FUTURE_WORK.**
- Modals: appear instantly (no entrance choreography); overlay blur is static.
- Charts: Recharts default entrance is acceptable; don't add more.

## Design-engineering rules (Emil Kowalski / Rauno Freiberg / Paco Coursey)
Check every new animation/transition against these — they caught real violations in Step 3 (box-shadow animation, wrong easing, mobile hover bug).

- **GPU only**: never animate `box-shadow`, `background`, `height`, `padding`.
- **No `ease-in` ever.** Entering elements: `ease-out` `cubic-bezier(0.23, 1, 0.32, 1)`; on-screen morphing: `ease-in-out`. Marro is a financial tool → crisp ease-out, no bouncy springs.
- **Never scale from 0** — entries start `scale(0.95–0.97) + opacity 0`.
- **Under 300ms for UI**: buttons 100–160ms, tooltips 125–200ms, modals 200–400ms.
- **Gate hover behind `@media (hover: hover) and (pointer: fine)`** — CSS hover fires on mobile tap.
- **Never animate keyboard-initiated actions** (feels laggy at daily repetition).
- **Stagger lists 30–80ms** — 50ms is Marro's sweet spot. Asymmetric timing: deliberate entry, fast exit.
- **Use transitions over keyframes for dynamic UI** — transitions retarget on interrupt; keyframes restart.
- **Guard blur**: `@supports (backdrop-filter: blur(1px))` with solid fallback first. View glass via server only (`localhost:3456`) — `backdrop-filter` breaks on `file://`.
- Philosophy: details compound (Rauno); polish in the final medium, not Figma; animation must never slow the user's path — all Marro motion is decorative, never a gatekeeper (Paco).

### Glass CSS classes
`.mc` cards (blur 22px sat 140%, cream 0.10, r22) · `.mm` modals (blur 28px sat 145%, cream 0.13, r20) · `.mc-p` primary (0.16, stronger border) · `.mc-e` entry (cardIn 260ms ease-out) · `.mc-sh` hover shimmer · `.mc-sp` 1px specular top edge.
