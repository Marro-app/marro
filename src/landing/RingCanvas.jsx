import React, { useEffect, useRef } from 'react';
import { m, useReducedMotion, animate, useMotionValue } from 'motion/react';

// The fixed "media canvas" — ring/arc/progress/timeline SVGs ported 1:1 from
// marro-mockups/index.html. Purely decorative in v4 (the editable input was
// removed per founder decision; the screen-reader story lives in scenes.jsx's
// SrArticle), so the whole canvas root is blanket aria-hidden again.
//
// `ringRotate`/`stageDrift`/`glowDrift` are Motion.dev MotionValues (already
// scroll-linked + spring-smoothed by LandingPage, or `null` when reduced
// motion is on) — this component just wires them onto transform/opacity via
// the `m.*` primitives so the continuous motion lives in the same
// LazyMotion(domMin) tree as the rest of the landing chunk.
//
// `corePulse` is a MotionValue (scale, 1 at rest) driven by SignInButton's
// hover callback via LandingPage — a shared "give the core life" channel so
// hovering the CTA visibly reaches into the fixed stage.
//
// Six "chaos" dots (feature 1: scattered money → shape) wander loosely around
// the stage on s1, then spring onto the three ring radii the moment s2
// activates — each dot's `data-scene` list controls when it's "captured".
// Positions are plain percentages of the SVG viewBox so no per-frame JS is
// needed for the resting states; only the wander itself uses CSS keyframes
// (cheap, GPU transform-only, no React state per frame).
const CHAOS_DOTS = [
  // angle in degrees, target ring radius (matches lp-r1/r2/r3), wander seed
  { angle: 18, ring: 216, size: 5, op: 0.62, wander: 0 },
  { angle: 96, ring: 150, size: 4, op: 0.5, wander: 1 },
  { angle: 154, ring: 86, size: 3, op: 0.7, wander: 2 },
  { angle: 208, ring: 216, size: 4, op: 0.4, wander: 3 },
  { angle: 267, ring: 150, size: 3, op: 0.55, wander: 4 },
  { angle: 322, ring: 86, size: 5, op: 0.35, wander: 5 },
];

function dotXY(angleDeg, r){
  const rad = (angleDeg - 90) * (Math.PI / 180);
  return { x: 256 + r * Math.cos(rad), y: 256 + r * Math.sin(rad) };
}

// Feature 2: odometer count-up. Animates a MotionValue from `from` to `to`
// over ~0.9s and writes the formatted string straight into the span's text
// node (bypassing React re-renders — this is a decorative, aria-hidden
// number, the real value lives in the sibling .lp-sr-only span for screen
// readers so they never hear intermediate values). `active` gates the run:
// only fires the count-up the instant the scene becomes active, and jumps
// straight to the final value otherwise (including reduced motion, and the
// very first paint before the scene has ever been active).
function Odometer({ active, from, to, format, className, delay = 0 }){
  const ref = useRef(null);
  const reduceMotion = useReducedMotion();
  const hasPlayed = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if(!el) return;
    if(!active){
      // Scene not active (yet, or scrolled past) — always show the settled
      // final value, never a mid-count frame, and allow a replay next time
      // the scene re-activates.
      el.textContent = format(to);
      hasPlayed.current = false;
      return;
    }
    if(reduceMotion){
      el.textContent = format(to);
      return;
    }
    if(hasPlayed.current) return; // already counted up for this activation
    hasPlayed.current = true;
    const controls = animate(from, to, {
      duration: 1,
      delay,
      // Ease-IN (founder request: "start slow then go fast") — the count
      // crawls at first, accelerates, and snaps onto the final value; the
      // tiny scale settle below sells the landing.
      ease: [0.6, 0, 0.9, 0.4],
      onUpdate(v){ el.textContent = format(Math.round(v)); },
      onComplete(){
        el.textContent = format(to);
        // tiny settle: scale 1.02 -> 1
        animate(el, { scale: [1.02, 1] }, { duration: 0.22, ease: 'easeOut' });
      },
    });
    return () => controls.stop();
  }, [active, from, to, format, reduceMotion, delay]);

  return <span aria-hidden="true" ref={ref} className={className} style={{ display: 'inline-block' }}>{format(to)}</span>;
}

export function RingCanvas({ scene, ringRotate, stageDrift, glowDrift, corePulse, lean }){
  const reduceMotion = useReducedMotion();
  const motionOn = !reduceMotion && ringRotate && stageDrift;
  const captured = scene !== 's1';

  // Feature 4: core-drop morph. On s4 activation the gold core detaches from
  // ring center and drops in a springy arc down toward where the log list
  // reveals (below the stage, in document flow), then fades back in at
  // center ~1s later once the "log row" has landed. Driven imperatively via
  // motion values + animate() (not CSS) because it's a one-shot sequence
  // tied to scene changes, not a continuous/scroll-linked value.
  const dropY = useMotionValue(0);
  const dropOpacity = useMotionValue(0);
  const coreOpacity = useMotionValue(1);
  const prevScene = useRef(scene);
  useEffect(() => {
    const entering4 = scene === 's4' && prevScene.current !== 's4';
    const leaving4 = scene !== 's4' && prevScene.current === 's4';
    prevScene.current = scene;
    if(reduceMotion) return;
    if(entering4){
      coreOpacity.set(0); // ring-center core hides; drop core takes over
      dropOpacity.set(1);
      dropY.set(0);
      animate(dropY, 210, { type: 'spring', stiffness: 260, damping: 22 });
      const t = setTimeout(() => {
        // land: drop core fades, ring core quietly returns
        animate(dropOpacity, 0, { duration: 0.35, ease: 'easeOut' });
        animate(coreOpacity, 1, { duration: 0.5, ease: 'easeOut' });
      }, 480);
      return () => clearTimeout(t);
    }
    if(leaving4){
      dropY.set(0);
      dropOpacity.set(0);
      coreOpacity.set(1);
    }
  }, [scene, reduceMotion, dropY, dropOpacity, coreOpacity]);
  // .lp-stagewrap keeps its plain CSS per-scene transform (rotate/scale —
  // see the [data-scene] rules in landing.css). The continuous scroll drift
  // lives on a separate inner .lp-drift wrapper instead of stagewrap itself,
  // because an element can only have one `transform`: if Motion set scale/y
  // via inline style on .lp-stagewrap directly, that inline style would win
  // over (and silently break) every scene's CSS transform. Nesting composes
  // both instead — CSS scene transform on the outer wrap, spring drift on
  // the inner one.
  const leanOn = !reduceMotion && lean;
  const fmtUsd = (v) => `$${v.toLocaleString('en-US')}`;
  return (
    <div className="lp-canvas" aria-hidden="true">
      <div className="lp-stagewrap">
        {/* Feature 6: pointer lean lives on its own wrapper, one level out
            from .lp-drift, so its x/y/rotate transform never collides with
            .lp-drift's scale/y scroll drift — same "each motion source gets
            its own wrapper" rule as the stagewrap/drift split above. */}
        <m.div
          className="lp-lean"
          data-motion={leanOn ? 'true' : undefined}
          style={leanOn ? { x: lean.x, y: lean.y, rotate: lean.rotate } : undefined}
        >
          <m.div
            className="lp-drift"
            data-motion={motionOn ? 'true' : undefined}
            style={motionOn ? { scale: stageDrift.scale, y: stageDrift.y } : undefined}
          >
          {motionOn && (
            <m.div
              className="lp-glow-drift"
              aria-hidden="true"
              style={{ opacity: glowDrift }}
            />
          )}

          {/* Feature 5: icon collapse (s8). A rounded-square recreating
              public/icon.svg's rect (rx ~19% of size, #14150F) fades in behind
              the rings as they shrink to sit inside it — lives *before* .lp-rings
              in DOM order (and z-indexed under it in CSS) so it composes as a
              backdrop, not an overlay. Static except for the opacity/scale
              transition the [data-scene="s8"] CSS rule below applies. */}
          <svg className="lp-iconbox" viewBox="0 0 512 512" aria-hidden="true">
            <rect x="0" y="0" width="512" height="512" rx="96" fill="#14150F" />
          </svg>

          <m.svg
            className="lp-rings"
            viewBox="0 0 512 512"
            aria-hidden="true"
            style={motionOn ? { rotate: ringRotate } : undefined}
          >
            <g transform="translate(256,256)" fill="none" stroke="#F6EFDD" strokeWidth="14">
              <circle className="lp-r3 lp-drawable" r="216" pathLength="1" />
              <circle className="lp-r2 lp-drawable" r="150" pathLength="1" />
              <circle className="lp-r1 lp-drawable" r="86" opacity="0.72" pathLength="1" />
              {/* Feature 4: core-drop morph. The static core (scene rest state,
                  CSS-driven opacity/scale per data-scene) only takes its
                  opacity from the drop motion value while s4's drop sequence
                  is actually running — every other scene keeps the plain CSS
                  per-data-scene opacity rule untouched (an inline style would
                  otherwise permanently win over those rules once set). The
                  drop core itself is a separate element so its spring
                  transform never fights .lp-core's own CSS transform. */}
              <m.circle
                className="lp-core"
                r="26" fill="#DDA528" stroke="none"
                style={!reduceMotion && scene === 's4' ? { opacity: coreOpacity } : undefined}
              />
              {!reduceMotion && (
                <m.circle
                  className="lp-core-drop"
                  r="20" fill="#DDA528" stroke="none"
                  style={{ y: dropY, opacity: dropOpacity }}
                />
              )}
              {/* Feature 3b: CTA hover pulse ring, centered on the core so the
                  hover feedback visibly radiates from it. */}
              {motionOn && corePulse && (
                <m.circle
                  className="lp-core-pulse-ring"
                  r="26" fill="none" stroke="#DDA528" strokeWidth="2"
                  style={{ scale: corePulse }}
                />
              )}
            </g>
          </m.svg>

          {/* Feature 1: chaos dots. Wander freely pre-capture (s1), spring onto
              a ring radius once any later scene activates. Every dot is drawn
              at a fixed cx/cy=256,256 (SVG center) and positioned purely via
              a GPU `transform: translate()` custom-property pair (--dot-x/
              --dot-y) — never via animating the cx/cy attributes themselves,
              so the capture "spring" is a transform transition, not a layout-
              triggering attribute animation. Reduced motion: CSS renders them
              already settled on their ring, no wander keyframes run (see the
              reduced-motion block in landing.css). */}
          <svg className="lp-dots" viewBox="0 0 512 512" aria-hidden="true">
            {CHAOS_DOTS.map((d, i) => {
              const { x, y } = dotXY(d.angle, d.ring);
              const dx = captured ? x - 256 : 0;
              const dy = captured ? y - 256 : 0;
              return (
                <circle
                  key={i}
                  className={`lp-chaosdot${captured ? ' lp-captured' : ''}`}
                  data-wander={d.wander}
                  cx="256"
                  cy="256"
                  r={d.size}
                  fill="#FBF6E8"
                  style={{ '--dot-x': `${dx}px`, '--dot-y': `${dy}px`, '--dot-op': d.op }}
                />
              );
            })}
          </svg>

          {/* donut arcs (scene 4): inner-ring radius splits into 4 category arcs.
              Partial segments by design — dasharray stays forever, only opacity
              toggles per scene, so there's no "ring-close" concern here. */}
          <svg className="lp-arcs" viewBox="0 0 512 512" aria-hidden="true">
            <g transform="translate(256,256) rotate(-90)" fill="none" strokeWidth="16" strokeLinecap="butt">
              <circle r="150" pathLength="1" stroke="#DDA528" strokeDasharray=".34 .66" strokeDashoffset="0" style={{ opacity: 0 }} />
              <circle r="150" pathLength="1" stroke="#82AEDB" strokeDasharray=".24 .76" strokeDashoffset="-.34" style={{ opacity: 0 }} />
              <circle r="150" pathLength="1" stroke="#E08A6B" strokeDasharray=".2 .8" strokeDashoffset="-.58" style={{ opacity: 0 }} />
              <circle r="150" pathLength="1" stroke="rgba(246,239,221,.55)" strokeDasharray=".2 .8" strokeDashoffset="-.78" style={{ opacity: 0 }} />
            </g>
          </svg>

          {/* progress arc (scene 5): fills to 61%. r=183 sits BETWEEN the
              middle (150) and outer (216) base rings — its own radius, so it
              can never draw on top of a base ring or the s2/s3 gold capture
              ring (v4 arc-overlap fix). */}
          <svg className="lp-progarc" viewBox="0 0 512 512" aria-hidden="true">
            <g transform="translate(256,256) rotate(-90)" fill="none" strokeLinecap="round">
              <circle className="lp-fill" r="183" pathLength="1" stroke="#DDA528" strokeWidth="15" strokeDasharray="1 1" strokeDashoffset="1" style={{ opacity: 0 }} />
            </g>
          </svg>

          {/* timeline (scene 6): the ring unrolled */}
          <svg className="lp-tline" viewBox="0 0 512 512" aria-hidden="true">
            <line className="lp-track" x1="30" y1="256" x2="482" y2="256" stroke="rgba(246,239,221,.35)" strokeWidth="3" pathLength="1" strokeDasharray="1" strokeDashoffset="1" />
            <circle cx="80" cy="256" r="9" fill="rgba(246,239,221,.5)" style={{ opacity: 0 }} />
            <circle cx="215" cy="256" r="9" fill="#DDA528" style={{ opacity: 0 }} />
            <circle cx="350" cy="256" r="9" fill="#DDA528" style={{ opacity: 0 }} />
            <circle cx="465" cy="256" r="9" fill="#DDA528" style={{ opacity: 0 }} />
          </svg>

          {/* HTML overlay layers. Inactive layers are visibility:hidden via
              CSS (see .lp-layer in landing.css). All decorative: the whole
              canvas is aria-hidden, and the SR story lives in SrArticle. */}
          <div className={`lp-layer${scene === 's2' ? ' lp-on' : ''}`}>
            <div className="lp-stagelbl">Your aid letter says</div>
            <div className="lp-aidfig lp-serif">Cost of attendance<br />$84,000 / year</div>
          </div>
          <div className={`lp-layer${scene === 's3' ? ' lp-on' : ''}`}>
            <div className="lp-stagecard">
              <div className="lp-stagelbl">Marro says</div>
              <div className="lp-stagefig">
                <Odometer active={scene === 's3'} from={1700} to={2150} format={fmtUsd} className="lp-odometer" />
                <small> / month to live on</small>
              </div>
            </div>
          </div>
          <div className={`lp-layer${scene === 's4' ? ' lp-on' : ''}`}>
            <div className="lp-stagelbl">This week</div>
            <div className="lp-stagefig">$107<small>.65</small></div>
          </div>
          <div className={`lp-layer${scene === 's5' ? ' lp-on' : ''}`}>
            <div className="lp-stagelbl">Spent so far</div>
            <div className="lp-stagefig">
              <Odometer active={scene === 's5'} from={0} to={61} format={(v) => `${v}%`} className="lp-odometer" />
              <small> of plan</small>
            </div>
            <div className="lp-stagelbl" style={{ marginTop: 8 }}>= $1,310 of $2,150</div>
          </div>
          <div className={`lp-layer${scene === 's6' ? ' lp-on' : ''}`} style={{ justifyContent: 'flex-start', paddingTop: '58%' }}>
            <div className="lp-tline-caps" style={{ display: 'flex', gap: 34, fontSize: 12.5 }}>
              <span>Disbursement</span><span>Step 1</span><span>Rotations</span><span>Step 2 CK</span>
            </div>
            {/* Adaptive-plan beat (v3.1): when Step 1's dot lights (sequential
                stagger, see the s6 CSS delays), the monthly number visibly
                absorbs it — ticking $2,150 down to $2,094. The emotional
                read: expensive thing appears, plan adjusts, no surprise. */}
            <div className="lp-stagecard lp-stagecard-sm">
              <div className="lp-stagelbl">Plan adjusted. Step 1 covered.</div>
              <div className="lp-stagefig lp-stagefig-sm">
                <Odometer active={scene === 's6'} from={2150} to={2094} delay={0.6} format={fmtUsd} className="lp-odometer" />
                <small> / month</small>
              </div>
            </div>
          </div>
          </m.div>
        </m.div>
      </div>
    </div>
  );
}
