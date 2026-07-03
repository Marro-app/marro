import React, { useEffect, useRef, useState, useCallback } from 'react';
import { LazyMotion, domMin, m, useScroll, useTransform, useSpring, useReducedMotion, useMotionValue, useMotionValueEvent, animate } from 'motion/react';

// domMin (not domAnimation): this page only drives motion values via `style`
// (transform/opacity bound to scroll-linked values) — no variants, no
// hover/tap/drag gestures — so the gesture-animation feature bundle in
// domAnimation is dead weight here.
import './landing.css';
import { RingCanvas } from './RingCanvas.jsx';
import { FixedLayerContent, SrArticle, StaticDocument, SCENE_TICKS } from './scenes.jsx';
import { SignInButton, OfflineNotice } from './SignInButton.jsx';

// ============================================================================
// v4 "FIXED THEATER". Nothing visible ever scrolls.
//
// The v3.x layouts kept visible text in the scrolling document below a fixed
// stage — which meant that MID-SCROLL the text physically passed through the
// fixed stage band on its way up the viewport (rest-position measurements
// never caught it). v4 removes the failure mode structurally:
//
//   - The stage band (top 55dvh) and a text band (60dvh down) are BOTH
//     position:fixed. Neither ever moves. Their geometry is disjoint at every
//     viewport, and since no visible element lives in the scroll flow, there
//     is no scroll offset at which text can cross the stage.
//   - The scrolling column is 8 invisible aria-hidden spacers (100dvh each)
//     that exist only to give the page scroll length.
//   - Scroll progress (0..1) scrubs per-scene text layers in the fixed band:
//     continuous, reversible crossfades via useTransform windows — layer i
//     owns progress [i/8,(i+1)/8], fading through the window edges so
//     adjacent layers crossfade with no dead frames.
//   - The discrete data-scene state (stage poses, odometers, choreography)
//     derives from the same progress value (floor(p*8)), replacing the old
//     IntersectionObserver.
//   - Screen readers additionally get a visually-hidden, text-only <article>
//     with the full story in order (see scenes.jsx); interactive elements
//     exist only in the fixed layers so there are no duplicate tab stops.
//   - prefers-reduced-motion: the theater is skipped entirely — a normal
//     static, stacked, scrolling document renders instead (StaticDocument).
// ============================================================================

export default function LandingPage({ offline }){
  const reduceMotion = useReducedMotion();
  return reduceMotion
    ? <StaticLanding offline={offline} />
    : <TheaterLanding offline={offline} />;
}

// Ambient blob background, reusing the signed-in app's exact global classes
// and keyframes (.blob-layer/.blob-1..4, blobFloat1..4 — defined in
// index.html and already reduced-motion-gated there). Rendered INSIDE .lp so
// it sits in the landing's own stacking context (z-index:0, below the stage
// band at 1010). The dark --blob* tokens are re-pinned on .lp in landing.css
// because the landing is always dark while the app theme (documentElement
// data-theme) may be light.
function BlobLayer(){
  return (
    <div className="blob-layer" aria-hidden="true">
      <div className="blob blob-1"></div>
      <div className="blob blob-2"></div>
      <div className="blob blob-3"></div>
      <div className="blob blob-4"></div>
    </div>
  );
}

function Nav({ offline, onHoverCore }){
  return (
    <nav className="lp-nav" aria-label="Main">
      <a className="lp-navbrand" href="#top">
        <svg width="26" height="26" viewBox="0 0 512 512" aria-hidden="true">
          <g transform="translate(256,256)" fill="none" stroke="#F6EFDD" strokeWidth="26">
            <circle r="172" /><circle r="118" /><circle r="64" opacity="0.72" /><circle r="26" fill="#DDA528" stroke="none" />
          </g>
        </svg>
        <span>Marro<span className="lp-dot">.</span></span>
      </a>
      <SignInButton offline={offline} className="lp-btn lp-btn-ghost" style={{ minHeight: 44, padding: '8px 18px' }} onHoverCore={onHoverCore} />
    </nav>
  );
}

// ============ REDUCED MOTION: plain static document ============
function StaticLanding({ offline }){
  return (
    <div className="lp lp-static" data-scene="s1">
      <BlobLayer />
      <Nav offline={offline} />
      <StaticDocument SignInButton={(props) => <SignInButtonWithNote offline={offline} {...props} />} />
    </div>
  );
}

// ============ THE THEATER ============
function TheaterLanding({ offline }){
  const rootRef = useRef(null); // .lp — the actual scroll container
  const [scene, setScene] = useState('s1');
  const [loaded, setLoaded] = useState(false);
  const [drawn, setDrawn] = useState(false);

  // Shared "core pulse" channel (v3 feature 3b): CTA hover -> gold core pulse.
  const corePulse = useMotionValue(1);
  const pulseCore = useCallback(() => {
    animate(corePulse, [1, 1.12, 1], { type: 'spring', stiffness: 320, damping: 22 });
  }, [corePulse]);

  // Scroll progress over the spacer column drives EVERYTHING: text layer
  // crossfades (continuous) and the discrete scene state (thresholds).
  const { scrollYProgress } = useScroll({ container: rootRef });
  useMotionValueEvent(scrollYProgress, 'change', (v) => {
    const idx = Math.min(7, Math.max(0, Math.floor(v * 8)));
    const s = `s${idx + 1}`;
    setScene((prev) => (prev === s ? prev : s));
  });

  // Draw rings in on mount (double-rAF as in the mockup).
  useEffect(() => {
    let id2;
    const id1 = requestAnimationFrame(() => {
      id2 = requestAnimationFrame(() => setLoaded(true));
    });
    return () => { cancelAnimationFrame(id1); if(id2) cancelAnimationFrame(id2); };
  }, []);

  // Ring-close fix (see landing.css .lp-drawn): after the draw-in transition
  // ends, drop the dasharray so the stroke is a true closed circle.
  useEffect(() => {
    if(!loaded) return;
    const t = setTimeout(() => setDrawn(true), 1000);
    return () => clearTimeout(t);
  }, [loaded]);

  // Progress-tick navigation: scroll the driver to the middle of scene i's
  // progress window.
  const jumpTo = useCallback((i) => {
    const el = rootRef.current;
    if(!el) return;
    const max = el.scrollHeight - el.clientHeight;
    el.scrollTo({ top: ((i + 0.5) / 8) * max, behavior: 'smooth' });
  }, []);

  const WrappedSignIn = useCallback(
    (props) => <SignInButtonWithNote offline={offline} onHoverCore={pulseCore} {...props} />,
    [offline, pulseCore]
  );

  return (
    <LazyMotion features={domMin} strict>
      <div ref={rootRef} className={`lp${loaded ? ' lp-loaded' : ''}${drawn ? ' lp-drawn' : ''}`} data-scene={scene}>
        <BlobLayer />
        <Nav offline={offline} onHoverCore={pulseCore} />

        <ScrollLinkedCanvas scene={scene} rootRef={rootRef} corePulse={corePulse} />

        {/* Fixed text band: the canonical visible + interactive content. */}
        <div className="lp-textband">
          {SCENE_TICKS.map((_, i) => (
            <FixedLayer key={i} index={i} progress={scrollYProgress}>
              <FixedLayerContent index={i} scene={scene} SignInButton={WrappedSignIn} />
            </FixedLayer>
          ))}
        </div>

        {/* Progress rail: one tick per scene, real buttons. */}
        <nav className="lp-ticks" aria-label="Scenes">
          {SCENE_TICKS.map((label, i) => (
            <button
              key={i}
              type="button"
              className={`lp-tick${scene === `s${i + 1}` ? ' lp-tick-on' : ''}`}
              aria-label={label}
              aria-current={scene === `s${i + 1}` ? 'true' : undefined}
              onClick={() => jumpTo(i)}
            />
          ))}
        </nav>

        {/* Screen-reader narrative (visually hidden, text-only). */}
        <SrArticle />

        {/* The scroll driver: invisible spacers, one viewport each. */}
        <main className="lp-main" aria-hidden="true">
          <div className="lp-spacer" /><div className="lp-spacer" /><div className="lp-spacer" /><div className="lp-spacer" />
          <div className="lp-spacer" /><div className="lp-spacer" /><div className="lp-spacer" /><div className="lp-spacer" />
        </main>
      </div>
    </LazyMotion>
  );
}

// One fixed-band layer. Scroll progress scrubs opacity + a small y-translate
// through the scene's window; adjacent windows overlap by a quarter-window on
// each side so outgoing/incoming layers CROSSFADE (both at 50% exactly at the
// boundary — continuous, reversible, no dead frames at any scroll speed).
// visibility derives from opacity so inactive layers are visibility:hidden
// (out of tab order and hit testing), not merely transparent.
function FixedLayer({ index, progress, children }){
  const W = 1 / 8;
  const f = W * 0.25;
  const s = index * W;
  const e = s + W;
  let pts, ops, ys;
  if(index === 0){
    pts = [0, e - f, e + f]; ops = [1, 1, 0]; ys = [0, 0, -12];
  } else if(index === 7){
    pts = [s - f, s + f, 1]; ops = [0, 1, 1]; ys = [16, 0, 0];
  } else {
    pts = [s - f, s + f, e - f, e + f]; ops = [0, 1, 1, 0]; ys = [16, 0, 0, -12];
  }
  const opacity = useTransform(progress, pts, ops);
  const y = useTransform(progress, pts, ys);
  const visibility = useTransform(opacity, (o) => (o > 0.02 ? 'visible' : 'hidden'));
  return (
    <m.div className="lp-flayer" style={{ opacity, y, visibility }}>
      <div className="lp-flayer-inner lp-pt">{children}</div>
    </m.div>
  );
}

// Scroll-linked continuous stage motion (unchanged from v3: ring rotation,
// stage drift, glow drift, pointer lean) — now reading the .lp root as the
// scroll container. Reduced motion never reaches this component (the whole
// theater is skipped), so no per-value gating branches are needed here.
function ScrollLinkedCanvas({ scene, rootRef, corePulse }){
  const { scrollYProgress } = useScroll({ container: rootRef });

  // Ring group: slow ~35deg rotation across the full page scroll.
  const rotateRaw = useTransform(scrollYProgress, [0, 1], [0, 35]);
  const ringRotate = useSpring(rotateRaw, { stiffness: 100, damping: 30 });

  // Stage: subtle continuous scale/translate drift (max ~4% / 14px).
  const scaleRaw = useTransform(scrollYProgress, [0, 0.5, 1], [1, 1.04, 0.96]);
  const yRaw = useTransform(scrollYProgress, [0, 0.5, 1], [0, -14, 14]);
  const scale = useSpring(scaleRaw, { stiffness: 100, damping: 30 });
  const y = useSpring(yRaw, { stiffness: 100, damping: 30 });

  // Background gold glow drifts slightly with scroll progress.
  const glowRaw = useTransform(scrollYProgress, [0, 0.5, 1], [0.7, 1, 0.7]);
  const glowDrift = useSpring(glowRaw, { stiffness: 100, damping: 30 });

  // Pointer lean (v3 feature 6): desktop pointer only; motion values only,
  // never React state per move. Composes on its own .lp-lean wrapper.
  const leanX = useMotionValue(0);
  const leanY = useMotionValue(0);
  const leanRotate = useMotionValue(0);
  const leanXSpring = useSpring(leanX, { stiffness: 120, damping: 30 });
  const leanYSpring = useSpring(leanY, { stiffness: 120, damping: 30 });
  const leanRotateSpring = useSpring(leanRotate, { stiffness: 120, damping: 30 });

  useEffect(() => {
    const mq = window.matchMedia('(hover: hover) and (pointer: fine)');
    if(!mq.matches) return;
    const root = rootRef.current;
    if(!root) return;
    const onMove = (e) => {
      const w = window.innerWidth || 1;
      const h = window.innerHeight || 1;
      const nx = (e.clientX / w) * 2 - 1; // -1..1
      const ny = (e.clientY / h) * 2 - 1;
      leanX.set(nx * 8);
      leanY.set(ny * 8);
      leanRotate.set(nx * 1.5);
    };
    root.addEventListener('pointermove', onMove, { passive: true });
    return () => root.removeEventListener('pointermove', onMove);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <RingCanvas
      scene={scene}
      ringRotate={ringRotate}
      stageDrift={{ scale, y }}
      glowDrift={glowDrift}
      corePulse={corePulse}
      lean={{ x: leanXSpring, y: leanYSpring, rotate: leanRotateSpring }}
    />
  );
}

// Wraps SignInButton with the offline notice, kept local so scene content
// stays presentation-only and doesn't need to know about offline state.
function SignInButtonWithNote({ offline, className, showGlyph, onHoverCore }){
  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start' }}>
      <SignInButton offline={offline} className={className} showGlyph={showGlyph} onHoverCore={onHoverCore} />
      <OfflineNotice offline={offline} />
    </span>
  );
}
