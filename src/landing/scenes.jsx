import React from 'react';

// v4 "Fixed Theater" scene content. All copy ported verbatim from
// marro-mockups/index.html (headlines, body copy, placeholder figures, the
// legally reviewed "we never sell your personal info" line) — do not reword
// any of it.
//
// The same copy renders in three places, so headings/bodies are defined ONCE
// below and shared to prevent drift:
//   1. FixedLayerContent — the visible per-scene layers inside the fixed
//      text band (real headings, real buttons/links; scrubbed by scroll).
//   2. SrArticle — a visually-hidden, text-only <article> so screen readers
//      can read the whole story linearly (scenes replace each other in place
//      visually, which reads as a single mutating region otherwise).
//      Interactive elements live ONLY in the fixed layers to avoid duplicate
//      tab stops.
//   3. StaticDocument — the prefers-reduced-motion experience: a normal
//      stacked, scrolling, fully readable page with no theater at all.

// Tick labels (progress rail buttons) — one per scene.
export const SCENE_TICKS = [
  'Scene 1 of 8: your aid package, turned into a plan',
  'Scene 2 of 8: start with your aid letter',
  'Scene 3 of 8: your monthly number',
  'Scene 4 of 8: log expenses in seconds',
  'Scene 5 of 8: plan versus actual',
  'Scene 6 of 8: medical school milestones',
  'Scene 7 of 8: from the founder',
  'Scene 8 of 8: get started',
];

// Shared headline fragments (JSX values are safely reusable across trees).
const HEAD = {
  s1: <>Your aid package, turned into <em className="lp-serif lp-acc">a plan.</em></>,
  s2: <>It starts with <em className="lp-serif lp-acc">one intimidating number.</em></>,
  s3: <>Marro hands you back <em className="lp-serif lp-acc">one that matters.</em></>,
  s4: <>Log it in <em className="lp-serif lp-acc">seconds.</em></>,
  s5: <>Always know <em className="lp-serif lp-acc">where you stand.</em></>,
  s6: <>Board exams. Rotation season. Marro <em className="lp-serif lp-acc">sees them coming.</em></>,
  s7: <>Made <em className="lp-serif lp-acc">between lectures.</em></>,
};

const BODY = {
  s1: 'Enter your aid and school costs once. Marro shows what you actually have to live on, every month.',
  s2: 'Your aid letter is a wall of figures written for the financial aid office, not for you. Type it into Marro once.',
  s3: 'The math happens once: aid in, school costs out, and what remains becomes your monthly number. No spreadsheet required.',
  s4: 'Quick entry between lectures. Every expense finds its place in the ring.',
  s5: 'One glance: your plan against what you actually spent. Ahead, behind, or right on track.',
  s6: 'Med school has expensive milestones on a known calendar. Plan for them before they land on a credit card.',
};

const QUOTE = 'Most of us start med school with big loans and almost no financial training. You sign on day one without a clear picture of what it all means long term. I am building Marro to make the picture clear from the start: what you have, where it goes, and no surprises creeping up later. Med school is stressful enough. Money should be one less thing on your plate.';

// Shared s4 log list. Ripples + newest-row landing choreography key off the
// lp-loglist-in class (active only while s4 is the current scene in the
// theater; always on in the static document).
function LogList({ active }){
  return (
    <div className={`lp-loglist${active ? ' lp-loglist-in' : ''}`}>
      <div className="lp-logrow" style={{ '--lp-row-i': 0 }}><div><span className="lp-dot8 lp-dot-ripple" style={{ background: 'var(--lp-blue)', color: 'var(--lp-blue)' }} aria-hidden="true"></span>Gas</div><div className="lp-amt lp-serif">$38.50</div></div>
      <div className="lp-logrow" style={{ '--lp-row-i': 1 }}><div><span className="lp-dot8 lp-dot-ripple" style={{ background: 'rgba(246,239,221,.5)', color: 'rgba(246,239,221,.5)' }} aria-hidden="true"></span>Coffee with study group</div><div className="lp-amt lp-serif">$6.75</div></div>
      <div className="lp-logrow lp-logrow-newest" style={{ '--lp-row-i': 2 }}><div><span className="lp-dot8 lp-dot-ripple" style={{ background: 'var(--lp-gold)', color: 'var(--lp-gold)' }} aria-hidden="true"></span>Groceries</div><div className="lp-amt lp-serif">$62.40</div></div>
    </div>
  );
}

// Founder signature block (s7) — shared between fixed layer and static doc.
function FounderSig(){
  return (
    <div className="lp-sig">
      <svg width="40" height="40" viewBox="0 0 512 512" aria-hidden="true"><rect width="512" height="512" rx="120" fill="#14150F" /><g transform="translate(256,256)" fill="none" stroke="#F6EFDD" strokeWidth="26"><circle r="172" /><circle r="118" /><circle r="64" opacity="0.72" /><circle r="26" fill="#DDA528" stroke="none" /></g></svg>
      <div><div className="lp-nm">The med student behind Marro</div><div className="lp-rl">U.S. MD program</div></div>
    </div>
  );
}

// Footer links (s8) — shared between fixed layer and static doc.
function FooterLinks(){
  return (
    <footer className="lp-footer" style={{ padding: '28px 0 0' }}>
      <a href="/privacy.html">Privacy Policy</a><span>·</span><a href="/terms.html">Terms of Service</a><span>·</span><span>Made for U.S. MD and DO students, at any school.</span>
    </footer>
  );
}

// s8 content — identical in fixed layer and static doc.
function GetStarted({ SignInButton }){
  return (
    <>
      <h2>Your numbers stay yours.</h2>
      <p className="lp-body">We never sell your personal info. Your budget is private to your account. Details in our <a href="/privacy.html" style={{ color: 'var(--lp-cream63)' }}>Privacy Policy</a>.</p>
      <h2 style={{ marginTop: 28 }}><em className="lp-serif lp-acc">Free</em> for medical students.</h2>
      <div className="lp-cta">
        <SignInButton className="lp-btn lp-btn-fill" showGlyph />
      </div>
      <FooterLinks />
    </>
  );
}

// ============ 1. FIXED-BAND LAYER CONTENT (visible, interactive) ============
// One entry per scene index (0-7). `scene` drives the s4 loglist choreography.
export function FixedLayerContent({ index, scene, SignInButton }){
  switch(index){
    case 0: return (
      <>
        <h1>{HEAD.s1}</h1>
        <p className="lp-body">{BODY.s1}</p>
        <div className="lp-cta">
          <SignInButton className="lp-btn lp-btn-fill" />
          <span className="lp-note">Free for medical students.</span>
        </div>
      </>
    );
    case 1: return (
      <>
        <h2>{HEAD.s2}</h2>
        <p className="lp-body">{BODY.s2}</p>
        <p className="lp-mock-note">Example numbers.</p>
      </>
    );
    case 2: return (
      <>
        <h2>{HEAD.s3}</h2>
        <p className="lp-body">{BODY.s3}</p>
      </>
    );
    case 3: return (
      <>
        <h2>{HEAD.s4}</h2>
        <p className="lp-body">{BODY.s4}</p>
        <LogList active={scene === 's4'} />
      </>
    );
    case 4: return (
      <>
        <h2>{HEAD.s5}</h2>
        <p className="lp-body">{BODY.s5}</p>
      </>
    );
    case 5: return (
      <>
        <h2>{HEAD.s6}</h2>
        <p className="lp-body">{BODY.s6}</p>
      </>
    );
    case 6: return (
      <>
        <h2>{HEAD.s7}</h2>
        <blockquote>{QUOTE}</blockquote>
        <FounderSig />
      </>
    );
    case 7: return <GetStarted SignInButton={SignInButton} />;
    default: return null;
  }
}

// ============ 2. SCREEN-READER ARTICLE (visually hidden, text-only) ============
// The linear version of the whole story, including the stage-only figures
// (aid letter number, monthly number, plan-vs-actual, the s6 adjusted-plan
// beat) that are otherwise decorative canvas content. No links or buttons —
// interactive elements live only in the fixed layers, so there are no
// duplicate tab stops. Headings are h2 to keep the page's single h1 in the
// fixed band.
export function SrArticle(){
  return (
    <article className="lp-sr-article">
      <h2>{HEAD.s1}</h2>
      <p>{BODY.s1}</p>
      <p>Free for medical students.</p>
      <h2>{HEAD.s2}</h2>
      <p>{BODY.s2}</p>
      <p>Your aid letter says: cost of attendance $84,000 per year. Example numbers.</p>
      <h2>{HEAD.s3}</h2>
      <p>{BODY.s3}</p>
      <p>Marro says: $2,150 per month to live on.</p>
      <h2>{HEAD.s4}</h2>
      <p>{BODY.s4}</p>
      <p>This week: $107.65. Gas $38.50. Coffee with study group $6.75. Groceries $62.40.</p>
      <h2>{HEAD.s5}</h2>
      <p>{BODY.s5}</p>
      <p>Spent so far: 61% of plan, $1,310 of $2,150.</p>
      <h2>{HEAD.s6}</h2>
      <p>{BODY.s6}</p>
      <p>Milestones: disbursement, Step 1, rotations, Step 2 CK. Plan adjusted. Step 1 covered. $2,094 per month.</p>
      <h2>{HEAD.s7}</h2>
      <p>{QUOTE}</p>
      <p>The med student behind Marro. U.S. MD program.</p>
      <h2>Your numbers stay yours.</h2>
      <p>We never sell your personal info. Your budget is private to your account. Details in our Privacy Policy.</p>
      <p>Free for medical students. Made for U.S. MD and DO students, at any school.</p>
    </article>
  );
}

// ============ 3. STATIC DOCUMENT (prefers-reduced-motion) ============
// No theater: a normal stacked, scrolling, fully readable page. One static
// ring figure at the top stands in for the stage; each scene's stage-only
// figure appears as plain text inside its section.
export function StaticDocument({ SignInButton }){
  return (
    <main className="lp-static-main">
      <div className="lp-static-fig" aria-hidden="true">
        <svg width="180" height="180" viewBox="0 0 512 512">
          <g transform="translate(256,256)" fill="none" stroke="#F6EFDD" strokeWidth="14">
            <circle r="216" /><circle r="150" /><circle r="86" opacity="0.72" />
            <circle r="26" fill="#DDA528" stroke="none" />
          </g>
        </svg>
      </div>
      <section aria-label="Marro">
        <h1>{HEAD.s1}</h1>
        <p className="lp-body">{BODY.s1}</p>
        <div className="lp-cta">
          <SignInButton className="lp-btn lp-btn-fill" />
          <span className="lp-note">Free for medical students.</span>
        </div>
      </section>
      <section aria-label="Start with your aid letter">
        <h2>{HEAD.s2}</h2>
        <p className="lp-body">{BODY.s2}</p>
        <p className="lp-figline">Your aid letter says: cost of attendance $84,000 / year.</p>
        <p className="lp-mock-note">Example numbers.</p>
      </section>
      <section aria-label="Marro turns it into a monthly budget">
        <h2>{HEAD.s3}</h2>
        <p className="lp-body">{BODY.s3}</p>
        <p className="lp-figline">Marro says: $2,150 / month to live on.</p>
      </section>
      <section aria-label="Log expenses in seconds">
        <h2>{HEAD.s4}</h2>
        <p className="lp-body">{BODY.s4}</p>
        <LogList active />
      </section>
      <section aria-label="Plan versus actual">
        <h2>{HEAD.s5}</h2>
        <p className="lp-body">{BODY.s5}</p>
        <p className="lp-figline">Spent so far: 61% of plan = $1,310 of $2,150.</p>
      </section>
      <section aria-label="Medical school milestones">
        <h2>{HEAD.s6}</h2>
        <p className="lp-body">{BODY.s6}</p>
        <p className="lp-figline">Plan adjusted. Step 1 covered. $2,094 / month.</p>
      </section>
      <section aria-label="From the founder">
        <h2>{HEAD.s7}</h2>
        <blockquote>{QUOTE}</blockquote>
        <FounderSig />
      </section>
      <section aria-label="Get started">
        <GetStarted SignInButton={SignInButton} />
      </section>
    </main>
  );
}
