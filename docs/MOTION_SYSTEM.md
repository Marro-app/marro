# Motion System

Motion conveys state, never decoration (product register). 150–250ms, ease-out. **No page-load choreography *in the app*** — dashboard/tabs/modals appear without entrance animation. The **marketing landing is different**: it's allowed intentional brand moments (the `MarroIntro` ring-draw reveal, and the desktop hero's word-by-word headline rise on first paint). These are decorative-by-design, live only in the visible theater (never in the SR/reduced-motion trees), and are still held to the GPU/easing/duration rules below.

## Inventory
- **Ambient blobs**: 4 divs, blur(90px), 19–25s transform-only float cycles. Budget-health signal with three states driven by `<BlobHealth>`:
  - *calm* (default) — neutral charcoals (dark) / soft warm grays (light), one marigold whisper
  - *low-tide* (`.blobs-over`, month over budget) — muted cold grays
  - *bloom* (`.blobs-bloom`, goal newly fully funded) — marigold swell for ~9s (`triggerBloom`)
  - States are stacked gradient pseudo-layers crossfaded by **opacity only** (2.4s ease-in-out); gradients are never animated.
- Boot screen (`#loading`, pre-React, pure CSS): rings bloom in staggered (`bootRing`, 50/180/310ms delays), marigold core breathes (`bootBreathe`), a marigold dot orbits the middle ring (`bootSpin` 2.6s linear, radius ≈22px), "Marro." + sub fade up (`bootFade`). All have reduced-motion fallbacks (orbit hides entirely).
- **`MarroIntro`** (signature hero reveal — onboarding welcome/finish + loading gate): deterministic JS animation (pure function of time `t`, own rAF loop, scoped per instance, ~7s loop). A marigold dot drops in, orbits to draw each of the three logo rings (cream, logo weight, inner at 0.72) led by a glowing comet, then **splits** — a stretching neck pinches the dot into the logo's center dot + a second blob that lands as the period — while "Marro" rises letter-by-letter from a clip-masked baseline. Reduced-motion → renders the settled final frame, no loop. **Theme-aware:** dark stage + cream ink in dark mode, warm light stage + ink wordmark/rings in light mode (the gold dot stays gold, darkened to `#C8861A` on light for contrast); reads `data-theme` at mount. Distinct from the strict in-app motion rules below: this is an intentional brand moment, not interaction feedback.
- Logo rings: `marroRingPop` staggered entrance + `marroDotPulse`.
- `tipIn` (InfoTip): scale+fade, origin bottom-center, after 140ms hover intent.
- ProgressBar width .4s; RingProgress stroke-dasharray .4s ease-out.
- Buttons/tabs: `all .15s`. Sync ring: `marroPulse`.

## Rules (Emil Kowalski / Rauno Freiberg / Paco Coursey)
Check every new animation against these — they caught real violations in Step 3 (box-shadow animation, wrong easing, mobile hover bug).

- **GPU only**: animate transform/opacity (+ width on progress bars, dasharray on rings). Never `box-shadow`, `background`, `height`, `padding`.
- **No `ease-in` ever.** Entering: `cubic-bezier(0.23,1,0.32,1)`. Financial tool → crisp ease-out, no springs.
- **Never scale from 0** — entries start `scale(0.95–0.97) + opacity 0`.
- **Under 300ms for UI**: buttons 100–160ms, tooltips 125–200ms, modals 200–400ms. (Ambient layers like blob crossfades are exempt — they're environment, not interaction.)
- **Gate hover behind `@media (hover: hover) and (pointer: fine)`.**
- **Never animate keyboard-initiated actions.**
- **Stagger lists 30–80ms** (50ms sweet spot). Asymmetric timing: deliberate entry, fast exit.
- **Transitions over keyframes for dynamic UI** (retarget on interrupt).
- **Guard blur**: `@supports (backdrop-filter: blur(1px))` with solid fallback. Server only — blur breaks on `file://`.
- Every keyframe needs a `prefers-reduced-motion: reduce` fallback (blobs, cards, loading dot all have one).
- Modals: appear instantly; overlay blur static. Charts: Recharts default entrance only.

### Glass CSS classes
`.mc` cards (G1) · `.mm` modals (G2) · `.mc-p` primary · `.mc-e` entry (cardIn 260ms) · `.mc-sh` hover shimmer · `.mc-sp` specular edge. Recipes in DESIGN_SYSTEM.md.
