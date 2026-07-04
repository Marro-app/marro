import React, { useEffect, useRef, useState, useCallback } from 'react';
import { LazyMotion, domMin, useScroll, useTransform, useSpring, useMotionValue, useReducedMotion, animate } from 'motion/react';

// v5 "Split Stage". Ported structure from the approved marro-mockups/index.html
// mockup: a fixed ring canvas (right half on desktop, top band on mobile) next
// to REAL scrolling text panels (left half / below, on mobile) — not a
// scroll-scrubbed crossfade. An IntersectionObserver on the panels sets which
// scene is active; CSS per-[data-scene] rules pose the fixed canvas. This
// replaces the v4 "Fixed Theater" (scroll-progress-scrubbed invisible spacers)
// that the founder rejected as looking/feeling wrong.
import './landing.css';
import { RingCanvas } from './RingCanvas.jsx';
import { FixedLayerContent, SrArticle, StaticDocument, SCENE_TICKS } from './scenes.jsx';
import { SignInButton, OfflineNotice } from './SignInButton.jsx';

export default function LandingPage({ offline }){
  const reduceMotion = useReducedMotion();
  return reduceMotion
    ? <StaticLanding offline={offline} />
    : <StagedLanding offline={offline} />;
}

// Ambient blob background, reusing the signed-in app's exact global classes.
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

// ============ THE STAGED LANDING ============
function StagedLanding({ offline }){
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
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if(e.isIntersecting) setScene(e.target.dataset.scene);
      });
    }, { root: null, threshold: 0.55 });
    panels.forEach((p) => io.observe(p));
    return () => io.disconnect();
  }, []);

  const jumpTo = useCallback((i) => {
    panelRefs.current[i]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
                <FixedLayerContent index={i} scene={scene} SignInButton={WrappedSignIn} />
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

function SignInButtonWithNote({ offline, className, showGlyph, onHoverCore }){
  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start' }}>
      <SignInButton offline={offline} className={className} showGlyph={showGlyph} onHoverCore={onHoverCore} />
      <OfflineNotice offline={offline} />
    </span>
  );
}
