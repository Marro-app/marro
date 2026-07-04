import React from 'react';
import { C } from '../lib/theme.js';
import { MarroLogo, GoogleGlyph, Icon } from './icons.jsx';
import { getSupabase } from '../lib/data.js';

// Public landing page — the logged-out view at the app root. It is intentionally
// viewable WITHOUT signing in and states what Marro is: Google's OAuth
// verification (and any first-time visitor) needs the home page to explain the
// app's purpose, not just present a login wall. Signing in still gates the app.
const FEATURES = [
  { icon:"savings",  title:"Know your monthly budget",
    body:"Enter your grant and school costs once. Marro shows exactly what you have to live on each month." },
  { icon:"live",     title:"Track where it goes",
    body:"Log expenses in seconds and see your plan versus what you've actually spent — no surprises." },
  { icon:"exams",    title:"Plan for big costs",
    body:"Board exams, interview season, and other one-off costs, mapped out before they hit." },
];

export const LoginScreen = ({offline}) => {
  const signIn = async () => {
    const sb = await getSupabase();
    sb.auth.signInWithOAuth({provider:"google",options:{redirectTo:location.origin+location.pathname}});
  };
  return (
    <main style={{minHeight:"100vh",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"48px 24px",gap:0}}>
      <div style={{width:"100%",maxWidth:560,display:"flex",flexDirection:"column",alignItems:"center"}}>

        {/* Hero — logo, name, and a plain statement of what Marro is */}
        <div style={{display:"flex",justifyContent:"center",marginBottom:20}}><MarroLogo size={64}/></div>
        <h1 style={{margin:0,fontSize:36,fontWeight:600,color:C.text,letterSpacing:"-0.02em",lineHeight:1.05,textAlign:"center",fontFamily:"'Newsreader', Georgia, serif"}}>
          Marro<span style={{color:C.marigold}}>.</span>
        </h1>
        <p style={{fontSize:16,color:C.textMid,marginTop:14,marginBottom:0,lineHeight:1.6,textAlign:"center",maxWidth:460}}>
          A budgeting tool made for medical students. Marro turns your financial aid into a simple
          monthly plan — so you can see what you have to spend, where it's going, and how to stay
          ahead of big costs like board exams.
        </p>

        {/* Primary call to action */}
        <div style={{marginTop:28,width:"100%",maxWidth:340,display:"flex",flexDirection:"column",alignItems:"center"}}>
          <button className="btn-pop"
            disabled={offline}
            onClick={signIn}
            style={{display:"inline-flex",alignItems:"center",justifyContent:"center",gap:10,width:"100%",padding:"13px 16px",borderRadius:12,border:`1px solid ${C.borderDark}`,background:offline?"transparent":C.selBg,color:C.text,fontSize:15,fontWeight:600,cursor:offline?"not-allowed":"pointer",opacity:offline?0.5:1,transition:"all .15s"}}>
            <GoogleGlyph/> Continue with Google
          </button>
          <div style={{fontSize:12,color:C.gray,marginTop:10,textAlign:"center"}}>Free for medical students.</div>
          {offline && <div role="status" style={{fontSize:12,color:C.amber,marginTop:10}}>You're offline — reconnect to sign in.</div>}
        </div>

        {/* How it works — plain explanation of the app's purpose, no login required to read */}
        <section aria-label="How Marro helps" style={{width:"100%",marginTop:44,display:"flex",flexDirection:"column",gap:18}}>
          {FEATURES.map(f=>(
            <div key={f.title} style={{display:"flex",alignItems:"flex-start",gap:14,textAlign:"left"}}>
              <div aria-hidden="true" style={{width:40,height:40,borderRadius:12,flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",background:C.surface,border:`1px solid ${C.border}`}}>
                <Icon name={f.icon} size={20} color={C.teal}/>
              </div>
              <div>
                <h2 style={{margin:0,fontSize:15,fontWeight:600,color:C.text,letterSpacing:"-0.01em"}}>{f.title}</h2>
                <p style={{margin:"3px 0 0",fontSize:13.5,color:C.gray,lineHeight:1.55}}>{f.body}</p>
              </div>
            </div>
          ))}
        </section>

        {/* Who it's for + trust */}
        <div style={{marginTop:36,textAlign:"center"}}>
          <div style={{fontSize:13,color:C.textMid,lineHeight:1.6}}>Made for U.S. MD and DO students, at any school.</div>
          <div style={{fontSize:12,color:C.gray,marginTop:6,lineHeight:1.6}}>Your data is yours — we never sell your personal information.</div>
        </div>

        {/* Footer — legal links live on this public page too */}
        <footer style={{marginTop:28,display:"flex",alignItems:"center",gap:8,fontSize:12}}>
          <a href="/privacy.html" style={{color:C.gray,textDecoration:"none",borderBottom:`1px solid ${C.border}`}}>Privacy Policy</a>
          <span style={{color:C.border}}>·</span>
          <a href="/terms.html" style={{color:C.gray,textDecoration:"none",borderBottom:`1px solid ${C.border}`}}>Terms of Service</a>
        </footer>

      </div>
    </main>
  );
};
