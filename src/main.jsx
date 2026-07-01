import React from 'react';
import { createRoot } from 'react-dom/client';
import { App, SilentUpdater } from './App.jsx';

// localStorage shim — the app talks to `window.storage` (async KV) for its local
// cache; back it with localStorage. Set before render so the boot effect sees it.
window.storage={get:async(key)=>{try{const v=localStorage.getItem(key);return v?{key,value:v}:null}catch{return null}},set:async(key,value)=>{try{localStorage.setItem(key,value);return{key,value}}catch{return null}},delete:async(key)=>{try{localStorage.removeItem(key);return{key,deleted:true}}catch{return null}},list:async(prefix)=>{try{return{keys:Object.keys(localStorage).filter(k=>!prefix||k.startsWith(prefix))}}catch{return{keys:[]}}}};

const root=createRoot(document.getElementById('root'));
root.render(<React.Fragment><App/><SilentUpdater/></React.Fragment>);
