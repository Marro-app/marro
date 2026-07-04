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

const CAP = 1000;      // max particles per section shape (perf budget)
const STEP = 4;        // glyph sampling grid, CSS px
const STAGGER = 0.30;  // per-particle start-time spread
const HOLD = 0.52;     // fraction of a scroll segment the section stays still
const COLORS = ['#DDA528', '#FBF6E8', '#82AEDB', '#E08A6B']; // gold cream blue clay
const SPR = 12;        // dot sprite radius, px

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
  let targets = null;    // per-section point arrays
  let trans = [];        // cached transition particle sets
  let raf = 0;
  let ready = false, fontsLoaded = false;
  let canvasDirty = false;
  let lastActive = -1;
  let destroyed = false;

  // --- sample one section's glyphs into point targets ---
  function sampleSection(section){
    offCtx.clearRect(0, 0, vw, vh);
    const figRegions = [];
    const els = section.querySelectorAll('[data-p]');
    for (let e = 0; e < els.length; e++){
      const el = els[e], isFig = el.hasAttribute('data-fig');
      if (isFig) figRegions.push(el.getBoundingClientRect());
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())){
        if (!node.parentElement) continue;
        const st = getComputedStyle(node.parentElement);
        offCtx.font = st.fontStyle + ' ' + st.fontWeight + ' ' + st.fontSize + ' ' + st.fontFamily;
        offCtx.fillStyle = '#fff';
        offCtx.textBaseline = 'middle';
        const text = node.textContent, re = /\S+/g;
        let m;
        while ((m = re.exec(text))){
          const rng = document.createRange();
          rng.setStart(node, m.index); rng.setEnd(node, m.index + m[0].length);
          const rect = rng.getBoundingClientRect();
          offCtx.fillText(m[0], rect.left, rect.top + rect.height / 2);
        }
      }
    }
    const img = offCtx.getImageData(0, 0, vw, vh).data;
    const pts = [];
    for (let y = 0; y < vh; y += STEP){
      for (let x = 0; x < vw; x += STEP){
        if (img[(y * vw + x) * 4 + 3] > 110){
          let inFig = false;
          for (let f = 0; f < figRegions.length; f++){
            const fr = figRegions[f];
            if (x >= fr.left && x <= fr.right && y >= fr.top && y <= fr.bottom){ inFig = true; break; }
          }
          pts.push({ x: x + g(1.6), y: y + g(1.6), k: pickColor(inFig) });
        }
      }
    }
    for (let i = pts.length - 1; i > 0; i--){ // shuffle then cap
      const j = (Math.random() * (i + 1)) | 0, t = pts[i]; pts[i] = pts[j]; pts[j] = t;
    }
    if (pts.length > CAP) pts.length = CAP;
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
    const gA = Math.min(smooth(t / 0.13), smooth((1 - t) / 0.13));
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

  // --- main loop ---
  function frame(now){
    if (destroyed) return;
    raf = requestAnimationFrame(frame);
    if (!vw || !vh){ size(); if (!vw || !vh) return; }
    if (!ready && fontsLoaded){ buildTargets(); ready = true; }

    const sections = getSections();
    const N = sections.length;
    if (N < 2){ return; }
    const segPx = segVH * vh;
    const p = clamp(window.scrollY / segPx, 0, N - 1);
    let i = Math.min(Math.floor(p), N - 2);
    const f = p - i;
    let t = f <= HOLD ? 0 : (f - HOLD) / (1 - HOLD);
    if (p >= N - 1){ i = N - 2; t = 1; }

    // report the "readable" section to React so it can toggle DOM visibility
    const active = (t < 0.5) ? i : i + 1;
    if (active !== lastActive){ lastActive = active; onActiveSection && onActiveSection(active); }

    if (t > 0 && t < 1 && ready){
      drawTransition(i, t, now);
    } else if (canvasDirty){
      ctx.clearRect(0, 0, vw, vh);
      canvasDirty = false;
    }
  }

  function size(){
    vw = window.innerWidth || document.documentElement.clientWidth;
    vh = window.innerHeight || document.documentElement.clientHeight;
    if (!vw || !vh){ vw = vh = 0; return; }
    cx = vw / 2; cy = vh / 2;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = vw * dpr; canvas.height = vh * dpr;
    canvas.style.width = vw + 'px'; canvas.style.height = vh + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    off.width = vw; off.height = vh;
  }

  let resizeTimer = 0;
  function onResize(){
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function(){ size(); if (ready) buildTargets(); }, 250);
  }

  return {
    attach(){
      size();
      // some embedded viewports report 0 briefly at load — retry a few times
      (function retrySize(n){
        if (vw && vh) return;
        size();
        if ((!vw || !vh) && n > 0) setTimeout(function(){ retrySize(n - 1); }, 100);
      })(30);
      window.addEventListener('resize', onResize, { passive: true });
      if (document.fonts && document.fonts.ready){
        document.fonts.ready.then(function(){ fontsLoaded = true; });
      } else {
        fontsLoaded = true;
      }
      raf = requestAnimationFrame(frame);
    },
    // segment height in px, for DotsLanding to size the scroll spacer
    segPx(){ return segVH * (window.innerHeight || 1); },
    rebuild(){ if (ready) buildTargets(); },
    destroy(){
      destroyed = true;
      cancelAnimationFrame(raf);
      clearTimeout(resizeTimer);
      window.removeEventListener('resize', onResize);
    }
  };
}

export { HOLD };
