import React, { useEffect, useRef, useState, useCallback } from 'react';
import { LazyMotion, domMin, useScroll, useTransform, useSpring, useMotionValue, animate } from 'motion/react';

// Split out of LandingPage.jsx (perf fix): this is the desktop-only animated
// "theater" — the only piece of the landing page that needs `motion/react`.
// Mobile (and prefers-reduced-motion) render StaticLanding instead, which has
// zero dependency on this file or on motion/react, so those visitors never
// download/parse the animation engine. LandingPage.jsx lazy-imports this
// module only when it decides to render the staged (desktop) experience.
import { RingCanvas } from './RingCanvas.jsx';
import { FixedLayerContent, SrArticle, SCENE_TICKS } from './scenes.jsx';
import { BlobLayer, Nav, GetStartedCTA } from './landingShared.jsx';

// ============ THE STAGED LANDING ============
export default function StagedLanding({ offline }){
  const rootRef = useRef(null);
  const panelRefs = useRef([]);
  const [scene, setScene] = useState('s1');
  const [loaded, setLoaded] = useState(false);
  const [drawn, setDrawn] = useState(false);

  const corePulse = useMotionValue(1);
  const pulseCore = useCallback(() => {
    animate(corePulse, [1, 1.12, 1], { type: 'spring', stiffness: 320, damping: 22 });
  }, [corePulse]);

  // Draw rings in on mount (double-rAF, as in the mockup).
  useEffect(() => {
    let id2;
    const id1 = requestAnimationFrame(() => {
      id2 = requestAnimationFrame(() => setLoaded(true));
    });
    return () => { cancelAnimationFrame(id1); if(id2) cancelAnimationFrame(id2); };
  }, []);

  useEffect(() => {
    if(!loaded) return;
    const t = setTimeout(() => setDrawn(true), 1000);
    return () => clearTimeout(t);
  }, [loaded]);

  // Real IntersectionObserver over the real scrolling panels — same mechanism
  // as the approved mockup. Whichever panel crosses the 55% threshold becomes
  // the active scene, which poses the fixed canvas via [data-scene] CSS.
  useEffect(() => {
    const panels = panelRefs.current.filter(Boolean);
    if(!panels.length) return;
    // Detect whichever panel crosses the viewport's vertical MIDLINE. A plain
    // threshold:0.55 can never be reached by a panel that is exactly 100vh tall
    // (it tops out at ~0.5 visible), so scene changes used to stick/lag —
    // especially on mobile, where that lag left a panel's text overlapping the
    // wrong scene's ring pose. A symmetric rootMargin shrinks the effective
    // root to a thin band at the screen's middle so exactly one panel is
    // "intersecting" at any scroll offset. It's -45%, deliberately NOT the
    // exact -50%/-50% that would collapse the root to a literal 0px-tall
    // line: with zero root height the intersection area is structurally
    // zero for every entry, so intersectionRatio can never exceed 0 and
    // isIntersecting may never fire at all in some browsers — the observer
    // would silently stop updating the scene. -45% keeps a small (~10vh)
    // but non-zero band so the ratio is always a real, comparable number.
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if(e.isIntersecting) setScene(e.target.dataset.scene);
      });
    }, { root: null, rootMargin: '-45% 0px -45% 0px', threshold: 0 });
    panels.forEach((p) => io.observe(p));
    return () => io.disconnect();
  }, []);

  const jumpTo = useCallback((i) => {
    panelRefs.current[i]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const WrappedGetStartedCTA = useCallback(
    (props) => <GetStartedCTA offline={offline} onHoverCore={pulseCore} {...props} />,
    [offline, pulseCore]
  );

  return (
    <LazyMotion features={domMin} strict>
      <div ref={rootRef} className={`lp${loaded ? ' lp-loaded' : ''}${drawn ? ' lp-drawn' : ''}`} data-scene={scene}>
        <BlobLayer />
        <Nav offline={offline} onHoverCore={pulseCore} />

        <StageCanvas scene={scene} corePulse={corePulse} />

        {/* Real scrolling content — one panel per scene. This IS the page's
            scroll flow (unlike v4's invisible spacers): normal document,
            normal scrollbar, normal browser find-in-page / reader mode. */}
        <main className="lp-scroller">
          {SCENE_TICKS.map((label, i) => (
            <section
              key={i}
              ref={(el) => { panelRefs.current[i] = el; }}
              data-scene={`s${i + 1}`}
              className="lp-panel"
              aria-label={label}
            >
              <div className="lp-pt">
                <FixedLayerContent index={i} scene={scene} GetStartedCTA={WrappedGetStartedCTA} />
              </div>
            </section>
          ))}
        </main>

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

        {/* Screen-reader narrative retained for parity with the visible stage
            figures (aid letter number, odometers, etc.) that live only in the
            decorative canvas. */}
        <SrArticle />
      </div>
    </LazyMotion>
  );
}

// Fixed decorative ring canvas + its scroll-linked continuous motion
// (rotation/drift/glow/pointer-lean) — reads document scroll now, since the
// scroller is the real page, not a nested container.
function StageCanvas({ scene, corePulse }){
  const { scrollYProgress } = useScroll();

  const ringRotate = useSpring(useTransform(scrollYProgress, [0, 1], [0, 35]), { stiffness: 100, damping: 30 });
  const scale = useSpring(useTransform(scrollYProgress, [0, 0.5, 1], [1, 1.04, 0.96]), { stiffness: 100, damping: 30 });
  const y = useSpring(useTransform(scrollYProgress, [0, 0.5, 1], [0, -14, 14]), { stiffness: 100, damping: 30 });
  const glowDrift = useSpring(useTransform(scrollYProgress, [0, 0.5, 1], [0.7, 1, 0.7]), { stiffness: 100, damping: 30 });

  const leanX = useMotionValue(0);
  const leanY = useMotionValue(0);
  const leanRotate = useMotionValue(0);
  const leanXSpring = useSpring(leanX, { stiffness: 120, damping: 30 });
  const leanYSpring = useSpring(leanY, { stiffness: 120, damping: 30 });
  const leanRotateSpring = useSpring(leanRotate, { stiffness: 120, damping: 30 });

  useEffect(() => {
    const mq = window.matchMedia('(hover: hover) and (pointer: fine)');
    if(!mq.matches) return;
    const onMove = (e) => {
      const w = window.innerWidth || 1;
      const h = window.innerHeight || 1;
      const nx = (e.clientX / w) * 2 - 1;
      const ny = (e.clientY / h) * 2 - 1;
      leanX.set(nx * 8);
      leanY.set(ny * 8);
      leanRotate.set(nx * 1.5);
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => window.removeEventListener('pointermove', onMove);
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
