// Dot-dissolve particle engine for the mobile landing (DotsLanding.jsx).
//
// Framework-free, single HTML5 Canvas 2D system. Ported from the approved
// marro-mockups/dot-dissolve-proto.html. Deliberately does NOT import
// motion/react or any animation library — this is the MOBILE experience and
// must stay light. It runs one requestAnimationFrame loop, stays idle (canvas
// cleared once) while a section is "held" fully formed, and only paints during
// the scroll-scrubbed transition between two adjacent sections.
//
// Particle targets are sampled from the ACTUAL rendered glyphs of the real DOM
// text (each word measured with a Range, redrawn to an offscreen canvas at the
// exact rect/font, then alpha-sampled on a grid) so the cloud reforms the real
// headline/figure pixel-for-pixel — including the browser-synthesized italic of
// Newsreader, since we read each element's computed font.
//
// The canvas itself is decorative and aria-hidden; the real, selectable text
// lives in the DOM (DotsLanding renders it). This module never touches the DOM
// text except to read layout/computed style.

// Per-section particle budget. The WHOLE section dissolves now (logo + headline
// + figure + body + labels + log rows), so density is ADAPTIVE: big text/logo
// are sampled on a fine grid, small text on a coarse grid (reads as fine dust /
// shimmer, not literal letters). A per-section cap then downsamples so the live
// particle count stays mobile-friendly (~1500–2200 across a transition, not 10k).
const CAP = 2400;         // max particles per section (perf budget)
const STEP_FINE = 2;      // grid for big headline/figure/logo, CSS px
const STEP_MID = 3;       // grid for medium text
const STEP_COARSE = 5;    // grid for body / small labels / log rows (fine dust)
const BIG_FONT = 34;      // px: font-size at/above which text samples fine
const MID_FONT = 20;      // px: font-size at/above which text samples mid
const STAGGER = 0.30;     // per-particle start-time spread
// Fraction of each scroll segment the section stays fully formed + legible
// (particles idle, real DOM text shown). The rest of the segment is the
// dot-dissolve transition. This must NOT be too small: outside the HOLD band
// the cloud is a scattered mid-flight scatter, so if the user comes to rest
// anywhere in the transition band the dots freeze as unformed "dust" that
// never resolves (there's no scroll motion left to drive t forward). A prior
// pass shortened this to 0.20, which made ~80% of every segment dust-prone and
// caused the visible "stuck in dust" stalls. 0.36 restores a comfortable
// legible rest zone while keeping the shortened SEG_VH dead-zone reduction.
const HOLD = 0.36;        // fraction of a scroll segment the section stays still
const COLORS = ['#DDA528', '#FBF6E8', '#82AEDB', '#E08A6B']; // gold cream blue clay
const SPR = 12;           // dot sprite radius, px

function clamp(v, a, b){ return v < a ? a : (v > b ? b : v); }
function smooth(v){ v = clamp(v, 0, 1); return v * v * (3 - 2 * v); }
function easeC(v){ return v < 0.5 ? 4 * v * v * v : 1 - Math.pow(-2 * v + 2, 3) / 2; }
function g(sp){ return (Math.random() + Math.random() - 1) * sp; } // soft gaussian-ish

function makeSprites(){
  return COLORS.map(function(col){
    const c = document.createElement('canvas');
    c.width = c.height = SPR * 2;
    const x = c.getContext('2d');
    const grad = x.createRadialGradient(SPR, SPR, 0, SPR, SPR, SPR);
    grad.addColorStop(0, col); grad.addColorStop(0.55, col); grad.addColorStop(1, col + '00');
    x.fillStyle = grad; x.fillRect(0, 0, SPR * 2, SPR * 2);
    return c;
  });
}

// Measures 100svh directly via a throwaway probe element instead of trusting
// window.innerHeight at whatever moment size() first runs. innerHeight at
// that moment reflects WHATEVER chrome state the browser happens to be in
// (e.g. a mid-page reload/bfcache-restore, or an in-app browser, can already
// have the URL bar collapsed) — baking that transient value in as the
// "stable" baseVH would permanently disagree with the spacer's own 100svh
// CSS basis for the rest of the session, shifting every section boundary.
// Falls back to plain vh (then innerHeight) where svh isn't supported.
function measureSvh(){
  if (typeof document === 'undefined') return 0;
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;top:0;left:0;width:0;visibility:hidden;pointer-events:none;height:100vh;height:100svh;';
  document.documentElement.appendChild(probe);
  const h = probe.getBoundingClientRect().height;
  probe.remove();
  return h || (typeof window !== 'undefined' ? window.innerHeight : 0);
}

function pickColor(isFig){
  const r = Math.random();
  if (isFig){ // figures get occasional blue/clay data dots
    if (r < 0.06) return 2;
    if (r < 0.11) return 3;
    return r < 0.82 ? 0 : 1;
  }
  return r < 0.74 ? 0 : 1; // headings: mostly gold, some cream
}

// Creates a controller bound to a canvas element and a getter for the ordered
// list of section elements. Call attach() once mounted; destroy() on unmount.
export function createDotsEngine({ canvas, getSections, segVH, onActiveSection }){
  const ctx = canvas.getContext('2d');
  const off = document.createElement('canvas');
  const offCtx = off.getContext('2d', { willReadFrequently: true });
  const sprites = makeSprites();

  let vw = 0, vh = 0, dpr = 1, cx = 0, cy = 0;
  // STABLE segment-height basis for all scroll→progress math, in px.
  // iOS Safari collapses/expands its URL bar + bottom toolbar during scroll,
  // which changes window.innerHeight MID-GESTURE (and fires `resize`). If the
  // progress denominator (segPx) were derived from that live value, pTarget =
  // scrollY/segPx would jump discontinuously between two frames of a single
  // gesture (innerHeight swings ~660↔780px on an iPhone — >0.5 sections of
  // error deep into the page), making the engine briefly target the WRONG
  // section (ghost glyphs) or rest-resolve into the wrong HOLD band (stuck
  // dust). So we measure 100svh ONCE (small viewport height — assumes chrome
  // fully shown; never changes with chrome state) and reuse it. Re-measured
  // only on a real orientation/width change — chrome collapse never changes
  // width. The spacer in DotsLanding uses the same 100svh basis (CSS), so the
  // page length and the progress math can never disagree.
  let baseVH = 0;
  let targets = null;    // per-section point arrays
  let trans = [];        // cached transition particle sets
  let raf = 0;
  let ready = false, fontsLoaded = false;
  let canvasDirty = false;
  let lastActive = -1;
  let destroyed = false;
  // Smoothed scroll-progress: raw window.scrollY arrives in bursty, uneven
  // steps on mobile (touch momentum reports irregularly, rubber-banding,
  // OS-level scroll coalescing). Feeding that straight into particle math
  // makes the dots visibly hitch/step with each scroll event. Instead we
  // lerp a smoothed progress value toward the raw target every rAF frame —
  // framerate-independent via an exponential decay — so particle motion is
  // continuous even when the underlying scroll signal isn't.
  let pSmooth = 0, pSmoothInit = false;
  let lastNow = 0;
  // Rest-resolve LATCH: the raw scroll target captured at the moment scroll
  // came to rest (-1 = not resting). While latched, the lerp goal is pinned to
  // the nearest HOLD-band center and STAYS there until the user actually
  // scrolls again. This must be a one-shot latch, not a per-frame condition:
  // the old per-frame check included `|pTarget - pSmooth| < 0.5`, and when the
  // rest point sat 0.5–0.68 sections from its HOLD center (fractional scroll
  // position 0.5–0.68 of a segment), pSmooth easing TOWARD the hold center
  // crossed that 0.5 radius — flipping the condition off, snapping the goal
  // back to the raw target, pulling pSmooth back inside the radius, flipping
  // it on again… a permanent goal oscillation. At phone frame rates the swing
  // crossed the section boundary every few frames, visibly pumping the settled
  // text's opacity/translate — the continuous "jitter after the text forms"
  // bug (and the rAF loop never slept).
  let restLatch = -1;
  // How long since the last actual scroll EVENT before we treat the user as
  // truly at rest (ms). This must be keyed on scroll-event arrival, NOT a
  // per-frame position-delta threshold: a numeric delta threshold can't tell
  // "stopped" apart from "still scrolling, just very slowly" — sufficiently
  // slow continuous scrolling produces individual frames whose delta dips
  // below any fixed threshold, so a delta-based check falsely reports "at
  // rest" mid-scroll. That falsely engages the latch (pulling the goal to
  // the HOLD-band center), the next bit of real movement then breaks it
  // again (see the 0.02 unlatch threshold below), and repeating that
  // engage/disengage cycle every couple of frames is what reads as the text
  // JITTERING right as it lands, instead of settling once cleanly. Real
  // scroll events keep arriving as long as input is ongoing regardless of
  // speed, so gating on "no scroll event for REST_DELAY ms" is speed-
  // independent and only fires once input has genuinely stopped.
  const REST_DELAY = 90;
  let lastScrollEvent = 0;

  // Grid-sample the alpha channel of whatever was just drawn into offCtx, but
  // ONLY within the given rect, at the given step. `tag` decides particle color:
  //   'fig'  → figure (mostly gold, occasional blue/clay data dots)
  //   'core' → the logo's gold core (always gold)
  //   else   → heading/body (mostly gold, some cream)
  // Points are pushed into `out`.
  function gridSampleRect(img, rect, step, tag, out){
    const x0 = Math.max(0, rect.left | 0), x1 = Math.min(vw, Math.ceil(rect.right));
    const y0 = Math.max(0, rect.top | 0), y1 = Math.min(vh, Math.ceil(rect.bottom));
    for (let y = y0; y < y1; y += step){
      for (let x = x0; x < x1; x += step){
        if (img[(y * vw + x) * 4 + 3] > 90){
          const k = tag === 'core' ? 0 : pickColor(tag === 'fig');
          out.push({ x: x + g(1.2), y: y + g(1.2), k: k });
        }
      }
    }
  }

  // Draw one text node's words into offCtx at their real on-screen rects, using
  // the parent's computed font (captures the synthesized italic too).
  function paintTextNode(node){
    if (!node.parentElement) return;
    const st = getComputedStyle(node.parentElement);
    offCtx.font = st.fontStyle + ' ' + st.fontWeight + ' ' + st.fontSize + ' ' + st.fontFamily;
    offCtx.fillStyle = '#fff';
    offCtx.textBaseline = 'middle';
    const re = /\S+/g; let m;
    while ((m = re.exec(node.textContent))){
      const rng = document.createRange();
      rng.setStart(node, m.index); rng.setEnd(node, m.index + m[0].length);
      const rect = rng.getBoundingClientRect();
      offCtx.fillText(m[0], rect.left, rect.top + rect.height / 2);
    }
  }

  // Stroke a concentric Marro ring mark (default rings r 216/150/86, or the
  // caller-supplied `rings` — the founder-sig mark uses smaller 172/118/64
  // rings at the same 512 viewBox, so it can't share the hero logo's radii)
  // + gold core r26, into offCtx, scaled/positioned to the SVG's on-screen
  // rect. Sampled synchronously — no async image decode. Returns the core's
  // screen rect so the caller can sample it separately (always-gold).
  function paintRingLogo(svg, rings){
    rings = rings || [216, 150, 86];
    const r = svg.getBoundingClientRect();
    const s = r.width / 512;               // viewBox is 0..512
    const ccx = r.left + r.width / 2, ccy = r.top + r.height / 2;
    offCtx.save();
    offCtx.strokeStyle = '#fff'; offCtx.fillStyle = '#fff';
    offCtx.lineWidth = Math.max(1.5, 14 * s);
    for (let i = 0; i < rings.length; i++){
      offCtx.globalAlpha = i === 2 ? 0.72 : 1;
      offCtx.beginPath();
      offCtx.arc(ccx, ccy, rings[i] * s, 0, Math.PI * 2);
      offCtx.stroke();
    }
    offCtx.globalAlpha = 1;
    const coreR = 26 * s;
    offCtx.beginPath(); offCtx.arc(ccx, ccy, coreR, 0, Math.PI * 2); offCtx.fill();
    offCtx.restore();
    return { left: ccx - coreR, right: ccx + coreR, top: ccy - coreR, bottom: ccy + coreR };
  }

  // Should this element be EXCLUDED from the dissolve? The primary CTA (the
  // third-party-branded SignInButton) stays a plain opacity fade so it remains
  // clickable + keyboard-operable — never turned into particles.
  function isExcluded(el){
    return !!(el.closest && (el.closest('.lp-cta') || el.closest('button')));
  }

  function fontStep(px){
    return px >= BIG_FONT ? STEP_FINE : (px >= MID_FONT ? STEP_MID : STEP_COARSE);
  }

  // --- sample one WHOLE section's visible content into point targets ---
  // Everything readable dissolves: logo, headline, figure, body, labels, log
  // rows — sampled at adaptive density (fine for big/logo, coarse dust for
  // small text). The CTA is excluded (see isExcluded).
  function sampleSection(section){
    const inner = section.firstElementChild || section;
    // A resize-triggered rebuild can catch a layer mid-transition, still
    // carrying the residual translateY that setLayerStyle applies to a
    // freshly-incoming layer (frame()'s `(1 - inO) * 10`). Measuring rects
    // with that offset still applied would permanently bake the shifted
    // position into this section's particle targets. Reset to the rest pose
    // for the measurement, then restore — the engine's own per-frame
    // setLayerStyle owns the live value and isn't affected either way.
    const prevTransform = inner.style.transform;
    inner.style.transform = '';
    const pts = [];

    // 1) SVG marks (hero ring logo, founder-sig ring, log-row dots). Each is
    //    drawn on its own cleared offscreen pass so we can sample just its rect
    //    at the right density and color.
    const svgs = inner.querySelectorAll('svg');
    for (let i = 0; i < svgs.length; i++){
      const svg = svgs[i];
      if (isExcluded(svg)) continue;
      const rect = svg.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) continue;
      const isLogo = svg.classList.contains('lpd-logo');
      const isSig = svg.classList.contains('lpd-sig-mark');
      offCtx.clearRect(0, 0, vw, vh);
      const coreRect = paintRingLogo(svg, isSig ? [172, 118, 64] : [216, 150, 86]);
      const img = offCtx.getImageData(0, 0, vw, vh).data;
      const step = isLogo ? STEP_FINE : STEP_MID;
      gridSampleRect(img, rect, step, 'ring', pts);
      // resample the gold core denser + always-gold so it stays a clear point
      gridSampleRect(img, coreRect, STEP_FINE, 'core', pts);
    }

    // 2) Text — grouped by density bucket so each bucket is one offscreen pass.
    //    Walk text nodes once; bucket each by its parent's font size and whether
    //    it's a figure (data-fig ancestor). Excluded (CTA) nodes are skipped.
    const buckets = { fine: [], mid: [], coarse: [] };
    const figFlag = new Set();
    const walker = document.createTreeWalker(inner, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())){
      const parent = node.parentElement;
      if (!parent || isExcluded(parent)) continue;
      if (!node.textContent.trim()) continue;
      const px = parseFloat(getComputedStyle(parent).fontSize) || 16;
      const step = fontStep(px);
      const bucket = step === STEP_FINE ? 'fine' : (step === STEP_MID ? 'mid' : 'coarse');
      buckets[bucket].push(node);
      if (parent.closest('[data-fig]')) figFlag.add(node);
    }
    const passes = [
      ['fine', STEP_FINE], ['mid', STEP_MID], ['coarse', STEP_COARSE]
    ];
    for (let pi = 0; pi < passes.length; pi++){
      const [name, step] = passes[pi];
      const nodes = buckets[name];
      if (!nodes.length) continue;
      // split into figure vs non-figure sub-passes (one clear each) so color is
      // correct without per-pixel region tests.
      for (const isFig of [false, true]){
        const sub = nodes.filter(n => figFlag.has(n) === isFig);
        if (!sub.length) continue;
        offCtx.clearRect(0, 0, vw, vh);
        for (const n of sub) paintTextNode(n);
        const img = offCtx.getImageData(0, 0, vw, vh).data;
        gridSampleRect(img, { left: 0, top: 0, right: vw, bottom: vh }, step, isFig ? 'fig' : 'text', pts);
      }
    }

    // Shuffle, then cap to keep the live particle count bounded.
    for (let i = pts.length - 1; i > 0; i--){
      const j = (Math.random() * (i + 1)) | 0, t = pts[i]; pts[i] = pts[j]; pts[j] = t;
    }
    if (pts.length > CAP) pts.length = CAP;
    inner.style.transform = prevTransform;
    return pts;
  }

  function buildTargets(){
    const sections = getSections();
    targets = sections.map(sampleSection);
    trans = [];
  }

  // --- pair section k's points with section k+1's into a curved-path set ---
  function getTransition(k){
    if (trans[k]) return trans[k];
    const A = targets[k], B = targets[k + 1];
    const n = Math.max(A.length, B.length), parts = new Array(n);
    for (let i = 0; i < n; i++){
      const hasA = i < A.length, hasB = i < B.length;
      const ax = hasA ? A[i].x : cx + g(50), ay = hasA ? A[i].y : cy + g(50);
      const bx = hasB ? B[i].x : cx + g(26), by = hasB ? B[i].y : cy + g(26);
      const mx = (ax + bx) / 2, my = (ay + by) / 2;
      const pull = 0.40 + Math.random() * 0.30;
      parts[i] = {
        ax: ax, ay: ay, bx: bx, by: by,
        cx: mx + (cx - mx) * pull + g(vw * 0.14),
        cy: my + (cy - my) * pull + g(vh * 0.12),
        k: hasB ? B[i].k : A[i].k,
        s: Math.random(), ph: Math.random() * 6.283,
        die: !hasB, born: !hasA
      };
    }
    trans[k] = parts;
    return parts;
  }

  function drawTransition(k, t, now){
    ctx.clearRect(0, 0, vw, vh);
    canvasDirty = true;
    const parts = getTransition(k);
    // Global alpha envelope for the whole cloud. CRITICAL: the particle cloud
    // is a pixel-copy of the glyphs, so it MUST NOT be visible at the same time
    // as the real DOM text of the same section — otherwise you see the text
    // twice, offset (once as DOM text, once as its dot-sampled ghost). The DOM
    // outgoing layer is fully hidden by t=0.16 and the incoming layer only
    // starts appearing at t=0.84 (see the setLayerStyle loop in frame()). So
    // the dots must fade IN only after 0.16 and fade OUT before 0.84, leaving a
    // clean gap on each side where neither the DOM text nor its ghost overlap.
    const gA = Math.min(smooth((t - 0.18) / 0.14), smooth((0.82 - t) / 0.14));
    const bell = 4 * t * (1 - t);

    // breathing gold core — the heart of the Marro logo
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, 150 + bell * 70);
    glow.addColorStop(0, 'rgba(221,165,40,' + (0.11 * bell).toFixed(3) + ')');
    glow.addColorStop(1, 'rgba(221,165,40,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(cx - 260, cy - 260, 520, 520);
    ctx.globalAlpha = bell * 0.85;
    ctx.drawImage(sprites[0], cx - SPR * 0.75, cy - SPR * 0.75, SPR * 1.5, SPR * 1.5);

    const wob = now * 0.0016;
    for (let i = 0; i < parts.length; i++){
      const p = parts[i];
      const u = clamp((t - p.s * STAGGER) / (1 - STAGGER), 0, 1);
      const e = easeC(u), inv = 1 - e;
      let x = inv * inv * p.ax + 2 * inv * e * p.cx + e * e * p.bx;
      let y = inv * inv * p.ay + 2 * inv * e * p.cy + e * e * p.by;
      const loose = e * (1 - e) * 4;
      x += Math.sin(p.ph + wob) * loose * 5;
      y += Math.cos(p.ph * 1.31 + wob * 0.83) * loose * 4;
      let a = gA;
      if (p.die) a *= inv;
      if (p.born) a *= e;
      if (a < 0.02) continue;
      ctx.globalAlpha = a;
      const sz = 3.4 + loose * 2.6;
      ctx.drawImage(sprites[p.k], x - sz / 2, y - sz / 2, sz, sz);
    }
    ctx.globalAlpha = 1;
  }

  // Drive one section layer's visible opacity/translate DIRECTLY (change-guarded
  // so we only touch the DOM when a value actually changes — no per-frame
  // thrash). This is what makes the real DOM text turn INTO the dots: during a
  // transition the outgoing layer fades out fast (over the first 16% of t) and
  // the incoming layer fades in only in the last 16%, so mid-flight the ONLY
  // visible representation of the words is the glyph-sampled particle cloud.
  // The text stays in the DOM at all times (opacity/visibility only) for
  // selection + screen readers.
  function setLayerStyle(L, op, ty){
    if (L._op === op && L._ty === ty) return;
    L._op = op; L._ty = ty;
    L.style.opacity = op;
    L.style.visibility = op <= 0.001 ? 'hidden' : 'visible';
    const inner = L.firstElementChild;
    if (inner) inner.style.transform = ty ? 'translateY(' + ty + 'px)' : '';
  }

  // --- main loop ---
  // The loop SLEEPS while a section is held fully formed (no rAF armed at
  // all — not even a cheap no-op frame, so the page can truly idle and the
  // per-frame getSections() DOM query never runs at rest). A passive scroll
  // listener (plus resize/rebuild) re-arms it. While a transition is
  // mid-flight (0 < t < 1) it keeps itself armed so the dot wobble animates
  // even if the user stops scrolling mid-dissolve.
  function wake(){
    if (!destroyed && !raf) raf = requestAnimationFrame(frame);
  }
  function frame(now){
    if (destroyed) return;
    raf = 0;
    if (!vw || !vh){ size(); if (!vw || !vh){ wake(); return; } }
    if (!ready && fontsLoaded){ buildTargets(); ready = true; }

    const sections = getSections();
    const N = sections.length;
    if (N < 2){ wake(); return; }
    // Use baseVH (stable), NOT the live `vh` — see baseVH comment above size().
    const segPx = segVH * baseVH;
    let pTarget = clamp(window.scrollY / segPx, 0, N - 1);
    // Guard: the segPx math assumes the svh basis, but the browser's actual
    // scrollable range is documentHeight − the LIVE window.innerHeight. If
    // chrome has collapsed (innerHeight now taller than the svh basis), the
    // true max scrollY is shorter than segPx*(N-1) implies, so the user can
    // hit the physical bottom of the page while pTarget is still short of
    // N-1 — the final section gets stuck mid-dissolve with no scroll
    // distance left to finish resolving it. Once truly at the document's
    // bottom, force full resolution regardless of what the segPx math says.
    const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
    if (window.scrollY >= maxScroll - 1) pTarget = N - 1;

    // Lerp the smoothed progress toward the raw scroll target each frame
    // (exponential decay, framerate-independent via dt). This absorbs the
    // uneven/bursty delivery of scroll events on mobile so particle motion
    // reads as continuous instead of hitching in step with each scroll tick.
    const dt = lastNow ? Math.min(now - lastNow, 48) : 16.7;
    lastNow = now;
    if (!pSmoothInit){ pSmooth = pTarget; lastScrollEvent = now; pSmoothInit = true; }
    const rate = 0.018; // ms time-constant-ish factor; ~90% caught up in ~120ms
    const followed = 1 - Math.pow(1 - rate, dt);

    // Where should the smoothed progress be heading THIS frame?
    //  - While the user is actively scrolling, follow the raw scroll target so
    //    the dissolve is scroll-scrubbed exactly as before.
    //  - Once scroll comes to rest (the raw target stopped changing) but we're
    //    parked mid-transition, retarget to the nearest legible rest point (the
    //    middle of the nearer section's HOLD band). Otherwise the cloud hangs
    //    forever as an unformed scattered "dust" that never coalesces into text
    //    — there's no scroll motion left to drive t. These two goals are
    //    MUTUALLY EXCLUSIVE (one lerp target, never both) so they can't fight
    //    and stall the cloud halfway.
    // Break the latch only on REAL scrolling: a deliberate change of scroll
    // position (> ~2% of a segment, ≈11–14px), not sub-pixel scroll noise or
    // pSmooth's own easing (which must never be able to unlatch the goal —
    // see restLatch declaration for the oscillation this prevents).
    if (restLatch >= 0 && Math.abs(pTarget - restLatch) > 0.02) restLatch = -1;
    // Engage once: no scroll EVENT has arrived for REST_DELAY ms (speed-
    // independent — see lastScrollEvent/REST_DELAY declaration) AND the
    // smoothed progress has mostly caught up (while it's still far behind —
    // e.g. a long fling — keep scrubbing toward the raw target first, as
    // before).
    if (restLatch < 0 && now - lastScrollEvent >= REST_DELAY
        && Math.abs(pTarget - pSmooth) < 0.5) restLatch = pTarget;
    let goal = pTarget;
    if (restLatch >= 0){
      const seg = clamp(Math.round(restLatch), 0, N - 1);
      goal = seg >= N - 1 ? N - 1 : seg + HOLD * 0.5;   // inside the section's HOLD band
    }
    pSmooth += (goal - pSmooth) * followed;
    // Snap once close enough so we don't chase forever / never fully settle.
    if (Math.abs(goal - pSmooth) < 0.0008) pSmooth = goal;
    const p = pSmooth;

    let i = Math.min(Math.floor(p), N - 2);
    const f = p - i;
    let t = f <= HOLD ? 0 : (f - HOLD) / (1 - HOLD);
    if (p >= N - 1){ i = N - 2; t = 1; }

    // Per-layer visible opacity, INVERSE to particle activity (prototype timing).
    for (let s = 0; s < N; s++){
      if (s === i){
        setLayerStyle(sections[s], 1 - smooth(t / 0.16), 0);
      } else if (s === i + 1){
        const inO = smooth((t - 0.84) / 0.16);
        setLayerStyle(sections[s], inO, (1 - inO) * 10);
      } else {
        setLayerStyle(sections[s], 0, 0);
      }
    }

    // Report the "readable" section to React for the inert/aria a11y toggle only
    // (NOT the visual driver — visibility is driven directly above).
    const active = (t < 0.5) ? i : i + 1;
    if (active !== lastActive){ lastActive = active; onActiveSection && onActiveSection(active); }

    if (t > 0 && t < 1 && ready){
      drawTransition(i, t, now);
    } else if (canvasDirty){
      ctx.clearRect(0, 0, vw, vh);
      canvasDirty = false;
    }

    // Settled and sampled? Sleep (no re-arm) — scroll/resize/rebuild wakes us.
    // Before `ready` (fonts still loading) keep spinning so targets build.
    // Also keep spinning while the smoothed progress is still catching up to
    // the raw scroll target, OR while the rest-resolve ease is still pulling us
    // into a legible HOLD band — otherwise the lerp would freeze the instant the
    // user stops scrolling instead of easing the rest of the way into text.
    // Sleep only once the smoothed progress has reached its goal for this frame
    // (the raw scroll target while scrolling, or the resolved HOLD-band rest
    // point once scroll settled) AND we're not mid-transition. Until then keep
    // the loop armed so the ease — including the rest-resolve into readable
    // text — actually completes instead of freezing the moment scroll stops.
    const parked = pSmooth === goal;
    if (ready && parked && !(t > 0 && t < 1)) return;
    wake();
  }

  function size(){
    const newVW = window.innerWidth || document.documentElement.clientWidth;
    vh = window.innerHeight || document.documentElement.clientHeight;
    if (!newVW || !vh){ vw = vh = 0; return; }
    // Only re-baseline baseVH when the WIDTH changes (real rotation/resize) or
    // on first measurement. iOS Safari's chrome collapse/expand changes
    // window.innerHeight (and fires `resize`) without changing width — so a
    // width-unchanged resize is chrome movement, not a layout event, and must
    // NOT shift the progress-math denominator (segPx) or the scroll-driven
    // section boundaries would jump mid-gesture (see baseVH declaration above
    // for the full rationale / symptom mapping).
    if (!baseVH || newVW !== vw) baseVH = measureSvh();
    vw = newVW;
    cx = vw / 2; cy = vh / 2;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = vw * dpr; canvas.height = vh * dpr;
    canvas.style.width = vw + 'px'; canvas.style.height = vh + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    off.width = vw; off.height = vh;
  }

  function onScroll(){
    lastScrollEvent = performance.now();
    wake();
  }

  let resizeTimer = 0;
  function onResize(){
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function(){
      const prevW = vw;
      size();
      // Only rebuild particle targets (expensive: re-samples every glyph) on a
      // real width change. A chrome-driven height-only resize must not thrash
      // the whole particle system mid-scroll.
      if (ready && vw !== prevW) buildTargets();
      wake();
    }, 250);
  }

  let retryTimer = 0;

  return {
    attach(){
      size();
      // some embedded viewports report 0 briefly at load — retry a few times
      (function retrySize(n){
        if (destroyed || (vw && vh)) return;
        size();
        if ((!vw || !vh) && n > 0) retryTimer = setTimeout(function(){ retrySize(n - 1); }, 100);
      })(30);
      window.addEventListener('resize', onResize, { passive: true });
      window.addEventListener('scroll', onScroll, { passive: true });
      // Don't build particle targets until the hero logo's entrance animation
      // (lpDotsLogoIn, 1.1s scale+fade — dotsLanding.css) has actually
      // finished. buildTargets() samples each element's live rendered rect;
      // firing as soon as fonts resolve (often well inside that 1.1s window)
      // would sample the logo mid-animation — still scaled down/faded in —
      // and bake that smaller/offset pose into section 0's dot targets for
      // the rest of the session. Gated on the real animationend, with a
      // fixed-delay safety net in case it never fires.
      const armFontsReady = function(){
        const sections = getSections();
        const logo = sections[0] && sections[0].querySelector('.lpd-logo');
        if (!logo){ fontsLoaded = true; wake(); return; }
        let done = false;
        const finish = function(){ if (done) return; done = true; fontsLoaded = true; wake(); };
        logo.addEventListener('animationend', finish, { once: true });
        setTimeout(finish, 1200);
      };
      if (document.fonts && document.fonts.ready){
        document.fonts.ready.then(armFontsReady);
      } else {
        armFontsReady();
      }
      wake();
    },
    destroy(){
      destroyed = true;
      cancelAnimationFrame(raf);
      clearTimeout(resizeTimer);
      clearTimeout(retryTimer);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onScroll);
    }
  };
}
