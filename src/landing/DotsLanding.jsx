import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import './landing.css';
import './dotsLanding.css';
import { SrArticle } from './scenes.jsx';
import { BlobLayer, Nav, GetStartedCTA } from './landingShared.jsx';
import { createDotsEngine } from './dotsEngine.js';

// ============================================================================
// DotsLanding — the production MOBILE landing (narrow viewport + motion OK).
//
// Recreates the approved marro-mockups/dot-dissolve-proto.html scroll-scrubbed
// dot-dissolve in React: as you scroll between sections the outgoing text/
// numbers dissolve into a gold-and-cream dot cloud that reconverges into the
// incoming section — the dots evoke the gold dotted core of the Marro logo.
//
// - Real, selectable text lives in the DOM (the fixed stage layers below).
// - The particle system is a single aria-hidden Canvas 2D (dotsEngine.js);
//   it samples the real glyphs and is idle while a section is held.
// - The SR-only linear article (scenes.jsx SrArticle) carries the whole story.
// - No motion/react import — this stays light for phones.
//
// prefers-reduced-motion never reaches here (LandingPage routes those to
// StaticLanding), but we guard anyway and render a plain readable stack.
// ============================================================================

const SEG_VH = 1.1; // scroll segment per section, in viewport heights

// The Marro ring mark — same rings as the desktop hero / static-doc figure
// (r 216/150/86 cream stroke + r26 gold core). Requested by the founder for
// screen 1, "like the computer version".
function HeroLogo(){
  return (
    <svg className="lpd-logo" viewBox="0 0 512 512" aria-hidden="true" focusable="false">
      <g transform="translate(256,256)" fill="none" stroke="#F6EFDD" strokeWidth="14">
        <circle r="216" />
        <circle r="150" />
        <circle r="86" opacity="0.72" />
        <circle className="lpd-core" r="26" fill="#DDA528" stroke="none" />
      </g>
    </svg>
  );
}

// Section layer content. Each visible headline/figure gets data-p so the engine
// samples its rendered glyphs; figures also get data-fig (occasional blue/clay
// data dots). Copy is verbatim from scenes.jsx; figures match the SR article
// ($125,950 / year, $2,150 / month, 61%). Interactive controls (GetStartedCTA,
// links) live only here — the SR article is text-only, so no duplicate tab stops.
function sectionContent(index, offline){
  switch(index){
    case 0: return (
      <>
        <HeroLogo />
        <h1 data-p>Your aid package, turned into <em className="lp-acc">a plan.</em></h1>
        <p className="lp-body">Enter your aid and school costs once. Marro shows what you actually have to live on, every month.</p>
        <div className="lp-cta">
          <GetStartedCTA offline={offline} note="Free for medical students." />
        </div>
      </>
    );
    case 1: return (
      <>
        <h2 data-p>It starts with <em className="lp-acc">one intimidating number.</em></h2>
        <div className="lpd-fig" data-p data-fig>$125,950<span className="lp-unit"> / year</span></div>
        <p className="lpd-figlabel">cost of attendance</p>
        <p className="lp-body">Your aid letter is a wall of figures written for the financial aid office, not for you. Type it into Marro once.</p>
        <p className="lp-mock-note">Example numbers.</p>
      </>
    );
    case 2: return (
      <>
        <h2 data-p>Marro hands you back <em className="lp-acc">one that matters.</em></h2>
        <div className="lpd-fig" data-p data-fig style={{ color: 'var(--lp-gold)' }}>$2,150<span className="lp-unit"> / month</span></div>
        <p className="lpd-figlabel">to live on</p>
        <p className="lp-body">The math happens once: aid in, school costs out, and what remains becomes your monthly number. No spreadsheet required.</p>
      </>
    );
    case 3: return (
      <>
        <h2 data-p>Always know <em className="lp-acc">where you stand.</em></h2>
        <div className="lpd-fig" data-p data-fig>61<span className="lp-unit">%</span></div>
        <p className="lpd-figlabel">of plan — $1,310 of $2,150 spent so far</p>
        <p className="lp-body">One glance: your plan against what you actually spent. Ahead, behind, or right on track.</p>
      </>
    );
    case 4: return (
      <>
        <h2 data-p>By us. <em className="lp-acc">For us.</em></h2>
        <blockquote>The aid office gives you a number. Nobody tells you what to do with it. I built Marro because I needed that answer myself.</blockquote>
        <div className="lp-sig">
          <svg width="40" height="40" viewBox="0 0 512 512" aria-hidden="true"><rect width="512" height="512" rx="120" fill="#14150F" /><g transform="translate(256,256)" fill="none" stroke="#F6EFDD" strokeWidth="26"><circle r="172" /><circle r="118" /><circle r="64" opacity="0.72" /><circle r="26" fill="#DDA528" stroke="none" /></g></svg>
          <div><div className="lp-nm">The med student behind Marro</div><div className="lp-rl">MD program</div></div>
        </div>
      </>
    );
    case 5: return (
      <>
        <h2 data-p>Your numbers <em className="lp-acc">stay yours.</em></h2>
        <p className="lp-body">We never sell your personal info. Your budget is private to your account. Details in our <a href="/privacy.html" style={{ color: 'var(--lp-cream63)' }}>Privacy Policy</a>.</p>
        <h2 data-p style={{ marginTop: 22, fontSize: 'clamp(1.35rem,5.5vw,1.9rem)' }}><em className="lp-acc">Free</em> for medical students.</h2>
        <div className="lp-cta">
          <GetStartedCTA offline={offline} />
        </div>
        <footer className="lp-footer">
          <a href="/privacy.html">Privacy Policy</a><span>·</span>
          <a href="/terms.html">Terms of Service</a><span>·</span>
          <span>Made for MD and DO students, at any school.</span>
        </footer>
      </>
    );
    default: return null;
  }
}

const SECTION_COUNT = 6;

export default function DotsLanding({ offline }){
  const stageRef = useRef(null);
  const canvasRef = useRef(null);
  const engineRef = useRef(null);
  const [active, setActive] = useState(0);
  const [showHint, setShowHint] = useState(true);

  // Reduced-motion guard (belt-and-suspenders — LandingPage already routes away).
  const reduced = typeof window !== 'undefined'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  useLayoutEffect(() => {
    if (reduced) return;
    const canvas = canvasRef.current;
    const stage = stageRef.current;
    if (!canvas || !stage) return;

    const getSections = () =>
      Array.prototype.slice.call(stage.querySelectorAll('.lpd-layer'));

    const engine = createDotsEngine({
      canvas,
      getSections,
      segVH: SEG_VH,
      onActiveSection: (i) => setActive(i),
    });
    engineRef.current = engine;
    engine.attach();
    return () => { engine.destroy(); engineRef.current = null; };
  }, [reduced]);

  // Hide the scroll hint after any scroll.
  useEffect(() => {
    if (reduced) return;
    const onScroll = () => {
      if (window.scrollY > 40){
        setShowHint(false);
        window.removeEventListener('scroll', onScroll);
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [reduced]);

  const spacerHeight = `calc(${(SECTION_COUNT - 1) * SEG_VH * 100}vh + 100vh)`;

  return (
    <div className="lp lpd" id="top" data-scene={`s${active + 1}`}>
      <BlobLayer />
      <Nav offline={offline} />

      {/* Decorative particle canvas (screen readers ignore it). */}
      <canvas ref={canvasRef} className="lpd-fx" aria-hidden="true" />

      {/* Visible, selectable text — the fixed stage of stacked section layers.
          Only the ACTIVE layer is exposed to AT + the tab order; the other five
          (visually hidden but present in the DOM) are `inert`, so there are no
          focus traps on off-screen CTAs and no duplicate reading. The active
          layer keeps its REAL interactive controls (GetStartedCTA, links). */}
      <div className="lpd-stage" ref={stageRef}>
        {Array.from({ length: SECTION_COUNT }, (_, i) => (
          <section
            key={i}
            className={`lpd-layer${i === active ? ' lpd-on' : ''}`}
            {...(i === active ? {} : { inert: '', 'aria-hidden': 'true' })}
          >
            <div className="lpd-inner">{sectionContent(i, offline)}</div>
          </section>
        ))}
      </div>

      {/* Linear, screen-reader-only version of the whole story (figures the
          canvas would otherwise carry visually). Parity with StagedLanding. */}
      <SrArticle />

      {/* Scroll driver. */}
      <div className="lpd-spacer" style={{ height: spacerHeight }} aria-hidden="true" />

      <p className={`lpd-hint${showHint ? ' lpd-hint-show' : ''}`} aria-hidden="true">Scroll</p>
    </div>
  );
}
