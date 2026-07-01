import React, { useState, useEffect, useCallback } from 'react';
import { C } from '../lib/theme.js';
import { MarroLogo, GoogleGlyph } from './icons.jsx';
import { sb } from '../lib/data.js';

export const LoginScreen = ({offline}) => (
  <div style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",padding:24}}>
    <div className="mm" style={{maxWidth:380,width:"100%",padding:"36px 32px",borderRadius:20,textAlign:"center",boxShadow:"0 12px 48px rgba(0,0,0,0.30)"}}>
      <div style={{display:"flex",justifyContent:"center",marginBottom:18}}><MarroLogo size={64}/></div>
      <h1 style={{margin:0,fontSize:30,fontWeight:600,color:C.text,letterSpacing:"-0.02em",lineHeight:1.1,fontFamily:"'Newsreader', Georgia, serif"}}>Marro<span style={{color:C.marigold}}>.</span></h1>
      <div style={{fontSize:13,color:C.gray,marginTop:8,marginBottom:26,lineHeight:1.5}}>Your medical school budget companion. Sign in to sync across your devices.</div>
      <button className="btn-pop"
        disabled={offline}
        onClick={()=>sb.auth.signInWithOAuth({provider:"google",options:{redirectTo:location.origin+location.pathname}})}
        style={{display:"inline-flex",alignItems:"center",justifyContent:"center",gap:10,width:"100%",padding:"12px 16px",borderRadius:10,border:`1px solid ${C.borderDark}`,background:offline?"transparent":C.selBg,color:C.text,fontSize:14,fontWeight:600,cursor:offline?"not-allowed":"pointer",opacity:offline?0.5:1,transition:"all .15s"}}>
        <GoogleGlyph/> Continue with Google
      </button>
      {offline && <div role="status" style={{fontSize:12,color:C.amber,marginTop:14}}>You're offline — reconnect to sign in.</div>}
    </div>
  </div>
);
