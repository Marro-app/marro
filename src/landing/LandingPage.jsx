import React, { Suspense, useEffect, useState } from 'react';

// v5 "Split Stage". Ported structure from the approved marro-mockups/index.html
// mockup: a fixed ring canvas (right half on desktop, top band on mobile) next
// to REAL scrolling text panels (left half / below, on mobile) — not a
// scroll-scrubbed crossfade. An IntersectionObserver on the panels sets which
// scene is active; CSS per-[data-scene] rules pose the fixed canvas. This
// replaces the v4 "Fixed Theater" (scroll-progress-scrubbed invisible spacers)
// that the founder rejected as looking/feeling wrong.
import './landing.css';
import { StaticDocument } from './scenes.jsx';
import { BlobLayer, Nav, GetStartedCTA } from './landingShared.jsx';

// Perf: the desktop-only animated theater (StagedLanding) is the ONLY landing
// code that needs `motion/react` (~the animation engine). It's lazy-imported
// here — not statically at the top of this file like before — so that mobile
// visitors and anyone with prefers-reduced-motion (who always render
// StaticLanding below) never download or parse motion/react at all. This file
// itself avoids importing from 'motion/react' entirely; reduced-motion is
// detected with a plain matchMedia hook instead of motion's useReducedMotion,
// so the decision of *which* branch to render never touches the animation lib.
const StagedLanding = React.lazy(() => import('./StagedLanding.jsx'));

// The mobile dot-dissolve experience. Lazy-loaded so its canvas particle code
// (dotsEngine.js + dotsLanding.css) is its own chunk — desktop visitors never
// download it, and it stays off the desktop critical path. Reduced-motion
// visitors get StaticLanding instead and never touch this either.
const DotsLanding = React.lazy(() => import('./DotsLanding.jsx'));

// The scroll-driven "theater" (a fixed ring canvas posed behind real scrolling
// text panels) only works where text and canvas can sit side-by-side — i.e. the
// wide desktop layout. On a narrow phone the two collapse into one column and
// the scaled-up ring poses sweep through the scrolling text, so headlines and
// stage figures overlap illegibly at almost every scroll offset. Rather than
// fight that, phones get the SAME clean stacked document used for reduced
// motion: rings sit inline above each section, nothing is position-fixed, so
// overlap is structurally impossible. Desktop keeps the full theater.
function useIsNarrow(){
  const query = '(max-width:900px)';
  const [narrow, setNarrow] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches
  );
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setNarrow(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return narrow;
}

// Plain matchMedia read of prefers-reduced-motion — deliberately NOT motion's
// own useReducedMotion(), so this top-level branch decision never imports
// anything from 'motion/react'.
function usePrefersReducedMotion(){
  const query = '(prefers-reduced-motion: reduce)';
  const [reduced, setReduced] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches
  );
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setReduced(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

export default function LandingPage({ offline }){
  const reduceMotion = usePrefersReducedMotion();
  const narrow = useIsNarrow();
  // Perf diagnostics (?perf overlay, see src/perf/): mark the moment the
  // landing dispatcher has mounted and produced its first DOM, regardless of
  // which branch (Static/Dots/Staged) it picks. performance.mark is safe
  // everywhere but guarded anyway since this runs on every visit.
  useEffect(() => {
    try { performance.mark('marro-landing-ready'); } catch { /* no-op */ }
  }, []);
  // Dispatch:
  //   prefers-reduced-motion        → StaticLanding (plain readable stack, a11y)
  //   narrow/mobile AND motion OK    → DotsLanding  (dot-dissolve, lazy chunk)
  //   desktop AND motion OK          → StagedLanding (theater, lazy chunk)
  // StaticLanding is the Suspense fallback for both lazy branches so nothing
  // ever flashes blank while a chunk resolves.
  if (reduceMotion){
    return <StaticLanding offline={offline} />;
  }
  return (
    <Suspense fallback={<StaticLanding offline={offline} />}>
      {narrow
        ? <DotsLanding offline={offline} />
        : <StagedLanding offline={offline} />}
    </Suspense>
  );
}

// ============ REDUCED MOTION: plain static document ============
function StaticLanding({ offline }){
  return (
    <div className="lp lp-static" data-scene="s1">
      <BlobLayer />
      <Nav offline={offline} />
      <StaticDocument GetStartedCTA={(props) => <GetStartedCTA offline={offline} {...props} />} />
    </div>
  );
}
