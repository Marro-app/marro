import React, { useState, useEffect, useCallback } from 'react';
import { C, applyTheme, THEMES } from './lib/theme.js';
import { getSupabase, needsEagerSupabase, stateFetch, stateWrite, isEmailAllowed, logEvent, exportUserData, exportUserDataExcel, deleteAccount, diffStates, findConflicts, applyChanges, MONEY_KEYS, fmtConflictVal, conflictLabel, SYNC_BASE_KEY } from './lib/data.js';
import { fmt, fmtS, fmtD, fmtDay, fmtA, moTotal, todayStr, getMonday, getSunday, daysUntil, subMonthlyTotal, getYearMonthStr, yr2, BLANK_MONTHLY, blankYearFields, generateYearConfigs, DEFAULT_CATS, MONTH_NAMES, SETUP_VERSION, DEFAULT_STATE } from './lib/format.js';
import { BRANDS, BRAND_DOMAINS, getBrandDomain, getBrand } from './lib/brands.js';
import { US_MED_SCHOOLS, degreeForSchool, DO_DUAL, dualOptionsForSchool } from './lib/schools.js';
import { AV_PALETTE, avColor, AVATARS, AV_GROUPS } from './lib/avatars.js';
import { popoverStyle, wrapPop, edgeFadeClass, radioProps, tabProps, yrRangeLabel } from './lib/ui-helpers.js';
import { useLiftCard, useEscClose, useEdgeFade } from './lib/hooks.js';
import { Icon, MarroLogo, GoogleGlyph } from './components/icons.jsx';
import { XBtn, Card, SectionTitle, ChoiceGroup, Stepper, TabBtn, YrBtn, Banner, Modal, MetricTile, BlobHealth } from './components/primitives.jsx';
import { DateField } from './components/pickers.jsx';
import { AvatarArt, Avatar, AvatarPicker } from './components/avatars.jsx';
import { LoginScreen } from './components/LoginScreen.jsx'; // kept, no longer rendered — see LandingPage
// Boot-phase instrumentation (debug-only; guarded so it never throws and only
// marks once, on the first boot). See PerfOverlay.jsx for how these are read.
let markedLandingImportStart = false;
const LandingPage = React.lazy(() => {
  if (!markedLandingImportStart) {
    markedLandingImportStart = true;
    try { performance.mark('boot:landing-import-start'); } catch { /* diagnostic only */ }
  }
  return import('./landing/LandingPage.jsx').then(m => {
    try { performance.mark('boot:landing-import-done'); } catch { /* diagnostic only */ }
    return m;
  });
});
import { ProgramModal, ProfileModal, AvatarModal, MarroIntro, OnboardingFlow, ProgressiveSetup } from './components/onboarding.jsx';
import { RenewalDialog, ConflictModal, QuickAddModal } from './components/modals.jsx';
import { HIDDEN_TABS } from './lib/featureFlags.js';
import { AppContext } from './context/AppContext.js';
// Tabs are lazy-loaded so the heavy Recharts dependency (only used by Budget/
// Charts/Savings) and the other tab code stay OUT of the initial bundle. A
// logged-out visitor landing on the marketing page no longer downloads/parses
// the entire signed-in app + charting library just to see the landing page —
// that was the main mobile cold-load cost. Each tab is only ever mounted one at
// a time (mutually-exclusive `tab===...` guards), so code-splitting them is safe.
const AidTab = React.lazy(() => import('./tabs/AidTab.jsx').then(m => ({ default: m.AidTab })));
const SubscriptionsTab = React.lazy(() => import('./tabs/SubscriptionsTab.jsx').then(m => ({ default: m.SubscriptionsTab })));
const SavingsTab = React.lazy(() => import('./tabs/SavingsTab.jsx').then(m => ({ default: m.SavingsTab })));
const ChartsTab = React.lazy(() => import('./tabs/ChartsTab.jsx').then(m => ({ default: m.ChartsTab })));
const WeeklyTab = React.lazy(() => import('./tabs/WeeklyTab.jsx').then(m => ({ default: m.WeeklyTab })));
const BudgetTab = React.lazy(() => import('./tabs/BudgetTab.jsx').then(m => ({ default: m.BudgetTab })));
const CustomizeTab = React.lazy(() => import('./tabs/CustomizeTab.jsx').then(m => ({ default: m.CustomizeTab })));

let markedFirstRender = false;
let markedSessionDecided = false;

export function App() {
  if (!markedFirstRender) {
    markedFirstRender = true;
    try { performance.mark('boot:app-first-render'); } catch { /* diagnostic only */ }
  }
  const [tab, setTab]           = useState("budget");
  const [ay,  setAy]            = useState(0);
  const [data, setData]         = useState(null);
  const [ready, setReady]       = useState(false);
  const [flash, setFlash]       = useState(false);
  const [dismissed, setDismissed] = useState({});
  const [syncStatus, setSyncStatus] = useState(null); // null|"syncing"|"synced"|"offline"|"conflict"
  const [pendingConflict, setPendingConflict] = useState(null);
  const [session, setSession] = useState(undefined); // undefined=restoring, null=logged out, obj=logged in
  const [accessDenied, setAccessDenied] = useState(false); // closed-beta gate: signed in but not on allowed_emails
  const [profile, setProfile] = useState(null);      // {school} | null (no row yet → ProfileModal)
  const [editSchool, setEditSchool] = useState(false); // settings → reopen ProfileModal to change school
  const [editProgram, setEditProgram] = useState(false); // settings → edit program track (ProgramModal)
  const [editName, setEditName] = useState(false); // settings → inline name editor
  const [editAvatar, setEditAvatar] = useState(false); // settings → avatar editor modal
  const gistTimerRef = React.useRef(null);
  const dataRef = React.useRef(null);
  const lastFocusRef = React.useRef(0);
  useEffect(()=>{ dataRef.current=data; },[data]);

  // Subscription renewal dialog (App-level: opened from the header alert + the tab)
  const [renewDlg, setRenewDlg] = useState(null);

  // Weekly — viewWeek stays shared so browsing an archived week survives tab switches
  const [viewWeek, setViewWeek]     = useState(null);

  // Cat form
  const [newCatName, setNewCatName] = useState("");
  const [newCatIcon, setNewCatIcon] = useState("dot");
  const [iconPickOpen, setIconPickOpen] = useState(false);   // collapsed icon grid in add flows
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showCategories, setShowCategories] = useState(false); // settings → Categories modal (Phase 1: moved off the tabbar)
  const [showQuickAdd, setShowQuickAdd] = useState(false);      // header Quick add — one-off expense modal

  // Month selector (0=Aug, 11=Jul for academic year)
  const [selMonth, setSelMonth] = useState((new Date().getMonth() - 7 + 12) % 12);
  // Esc closes the chromeless popovers (settings menu, pie range picker, category icon picker)
  useEscClose(settingsOpen, ()=>setSettingsOpen(false));
  // Recharts paints role="img" bar/sector paths with no accessible name — pure decoration
  // (every figure is also shown as text + each chart has a visible title). Hide the chart
  // graphics from assistive tech so AT doesn't announce dozens of nameless images. (WCAG 1.1.1)
  useEffect(()=>{
    const hide=()=>document.querySelectorAll('.recharts-surface').forEach(s=>{
      if(s.getAttribute('aria-hidden')!=='true'){s.setAttribute('aria-hidden','true');s.setAttribute('focusable','false');}
      // an aria-hidden subtree must not contain anything focusable (Recharts tabindexes the pie)
      if(s.getAttribute('tabindex')!=null && s.getAttribute('tabindex')!=='-1') s.setAttribute('tabindex','-1');
      s.querySelectorAll('[tabindex]:not([tabindex="-1"])').forEach(e=>e.setAttribute('tabindex','-1'));
    });
    hide();
    const mo=new MutationObserver(hide);
    mo.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['tabindex']});
    return ()=>mo.disconnect();
  },[]);


  // Add category modal
  const [showAddYear, setShowAddYear] = useState(false);
  const [confirmYearRemove, setConfirmYearRemove] = useState(null);
  const [yearUndo, setYearUndo] = useState(null); // last soft-deleted year, for the Undo toast
  useEffect(()=>{ if(!yearUndo) return; const t=setTimeout(()=>setYearUndo(null),8000); return ()=>clearTimeout(t); },[yearUndo]);
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmDeleteAccount, setConfirmDeleteAccount] = useState(false); // settings → "Delete my account"
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [deleteAccountError, setDeleteAccountError] = useState(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [exportingData, setExportingData] = useState(false);
  const [exportDataError, setExportDataError] = useState(null);
  const [exportingRaw, setExportingRaw] = useState(false);
  const [nyStart, setNyStart] = useState("");
  const [nyEnd, setNyEnd] = useState("");


  // Auth: restore session on boot + listen for sign-in/out across tabs.
  //
  // supabase-js is lazy-loaded (see lib/data.js) so a first-time, logged-out
  // visitor to the marketing landing never downloads it. We only load it here
  // eagerly, before the landing renders, when needsEagerSupabase() says so —
  // a returning signed-in user (cached session token) or an OAuth/redirect
  // callback supabase must process. Otherwise `session` is set to null right
  // away and the landing renders with zero supabase-js bytes fetched; the
  // client only loads later, on demand, when the auth modal's "Continue with
  // Google" button is clicked (see src/landing/AuthModal.jsx).
  useEffect(()=>{
    if(!needsEagerSupabase()){
      if(!markedSessionDecided){ markedSessionDecided = true; try { performance.mark('boot:session-decided'); } catch { /* diagnostic only */ } }
      setSession(null); return;
    }
    let unsub;
    (async()=>{
      const sb = await getSupabase();
      sb.auth.getSession().then(({data})=>{
        if(!markedSessionDecided){ markedSessionDecided = true; try { performance.mark('boot:session-decided'); } catch { /* diagnostic only */ } }
        setSession(data.session ?? null);
      });
      const {data:{subscription}} = sb.auth.onAuthStateChange((evt, s)=>{
        setSession(s ?? null);
        if(evt==="SIGNED_IN"){
          logEvent('login', {});
        }
        if(evt==="SIGNED_OUT"){
          localStorage.removeItem("marro_v8");
          localStorage.removeItem(SYNC_BASE_KEY);
          localStorage.removeItem("marro_uid");
          setData(null); setProfile(null); setReady(false); setSyncStatus(null);
        }
      });
      unsub = () => subscription.unsubscribe();
    })();
    return ()=>unsub && unsub();
  },[]);

  // Load — gated on auth. Runs once a session is known; bails while restoring or
  // when signed out (LoginScreen handles that via the render gate).
  useEffect(()=>{
    if(session===undefined) return;   // still restoring
    if(!session){ return; }           // signed out → LoginScreen
    (async()=>{
      try{
        // Closed-beta invite gate (supabase/allowed_emails.sql). Checked once per
        // fresh session, before anything reads/writes the user's data.
        if(!(await isEmailAllowed())){
          const sb = await getSupabase();
          await sb.auth.signOut();
          setAccessDenied(true);
          return;
        }
        setAccessDenied(false);

        const uid = session.user.id;
        // Shared-device guard: if a different user's data is cached locally, drop it
        // before loading so the migration rule can't upload user A's data to user B.
        const storedUid = localStorage.getItem("marro_uid");
        if(storedUid && storedUid !== uid){
          localStorage.removeItem("marro_v8");
          localStorage.removeItem(SYNC_BASE_KEY);
        }
        localStorage.setItem("marro_uid", uid);

        let raw = null;
        // Supabase is the source of truth across devices.
        setSyncStatus("syncing");
        const serverContent = await stateFetch();
        if(serverContent){
          raw = serverContent;
          // Store as the agreed-upon base for 3-way merge
          localStorage.setItem(SYNC_BASE_KEY, raw);
          await window.storage.set("marro_v8", raw);
          setSyncStatus("synced");
        } else if(navigator.onLine){
          // No server row yet → first login. Migrate any local state up (or seed defaults).
          let r = await window.storage.get("marro_v8");
          if(!r?.value) r = await window.storage.get("marro_v7");
          raw = r?.value || JSON.stringify(DEFAULT_STATE);
          const ok = await stateWrite(raw);
          localStorage.setItem(SYNC_BASE_KEY, raw);
          await window.storage.set("marro_v8", raw);
          setSyncStatus(ok ? "synced" : "offline");
        } else {
          // Offline with a cached session → load local cache, sync on reconnect.
          let r = await window.storage.get("marro_v8");
          if(!r?.value) r = await window.storage.get("marro_v7");
          raw = r?.value || null;
          setSyncStatus(raw ? "offline" : null);
        }
        const loaded = raw ? JSON.parse(raw) : JSON.parse(JSON.stringify(DEFAULT_STATE));
        // Migrate: add new fields if missing
        if(loaded.surplusBank===undefined) loaded.surplusBank=0;
        if(!loaded.monthDisabled) loaded.monthDisabled={};
        if(loaded.darkMode===undefined) loaded.darkMode=!window.matchMedia("(prefers-color-scheme: light)").matches;
        // One-time migration: before the theme system existed the toggle was inert and
        // darkMode:false still rendered dark — preserve that experience for legacy states.
        if(raw && !localStorage.getItem("marro_theme_v2")) loaded.darkMode=true;
        localStorage.setItem("marro_theme_v2","1");
        if(loaded.logo===undefined) loaded.logo=null;
        if(!loaded.coverMonths) loaded.coverMonths={};
        if(!loaded.monthlyDeposits) loaded.monthlyDeposits={};
        if(!loaded.stepGoals) loaded.stepGoals=JSON.parse(JSON.stringify(DEFAULT_STATE.stepGoals));
        if(loaded.stepGoals && !loaded.stepGoals.find(g=>g.id==="step3")) loaded.stepGoals.push({id:"step3",label:"Step 3",targetAmount:1000,targetDate:"2031-06-01",saved:0,monthlyContribution:0});
        if(!loaded.savingsGoals) loaded.savingsGoals=[];
        if(!loaded.savingsLog) loaded.savingsLog=[];
        // Defensive: a row missing categories would crash render (cats.forEach) — reseed defaults.
        if(!Array.isArray(loaded.categories) || !loaded.categories.length) loaded.categories = JSON.parse(JSON.stringify(DEFAULT_CATS));
        // Grandfather existing users: a saved state without setupVersion predates
        // progressive setup — treat them as current so we don't nag them for v1 steps
        // (their years are already configured). Brand-new states keep null → onboarding.
        if(loaded.setupVersion===undefined) loaded.setupVersion = raw ? SETUP_VERSION : null;
        // Program track (dual-degree). Backfill the shape; degree is re-derived from the
        // school wherever it's used, so a missing/stale value here is harmless.
        if(!loaded.program || typeof loaded.program!=="object")
          loaded.program = JSON.parse(JSON.stringify(DEFAULT_STATE.program));
        else {
          const dp=DEFAULT_STATE.program;
          if(loaded.program.dual===undefined) loaded.program.dual=null;
          if(!loaded.program.phd) loaded.program.phd={...dp.phd};
          if(!loaded.program.masters) loaded.program.masters={...dp.masters};
          if(!loaded.program.other || typeof loaded.program.other!=="object")
            loaded.program.other={field: typeof loaded.program.other==="string"?loaded.program.other:"", institution:""};
          if(!loaded.program.degree) loaded.program.degree=dp.degree;
        }
        // Year migrations (school-agnostic — never inject any school's numbers).
        if(!Array.isArray(loaded.years) || !loaded.years.length)
          loaded.years = generateYearConfigs(new Date().getFullYear(), 4).map(cfg=>({...cfg, monthly:{...BLANK_MONTHLY}, monthlyOverrides:{}}));
        loaded.years.forEach(y=>{
          // Rename legacy WCM-named field → generic livingAllowance
          if(y.wcmLivingAllowance!==undefined){ if(y.livingAllowance===undefined) y.livingAllowance=y.wcmLivingAllowance; delete y.wcmLivingAllowance; }
          // Retire the extended/standard distinction — every year is just a numbered year now.
          if(y.type!==undefined) delete y.type;
          // Backfill any missing fields with safe zeros (no school defaults)
          for(const [k,v] of Object.entries(blankYearFields())) if(y[k]===undefined) y[k]=v;
          if(!y.monthly) y.monthly={...BLANK_MONTHLY};
          if(!y.monthlyOverrides) y.monthlyOverrides={};
        });
        // Relabel sequentially so a converted "Extended" year becomes the next "Year N"
        // (data is untouched — only the label/number changes).
        loaded.years.forEach((y,i)=>{
          const sy=y.startDate?new Date(y.startDate+"T12:00:00").getFullYear():new Date().getFullYear()+i;
          const ey=y.endDate?new Date(y.endDate+"T12:00:00").getFullYear():sy+1;
          y.label=`Year ${i+1} — ${sy}-${yr2(ey)}`;
        });
        setData(loaded);
        // Profile (school). No row → {school:null} triggers the one-time ProfileModal.
        // On error (e.g. offline) leave profile null so we don't block — re-check next boot.
        try{
          const sb = await getSupabase();
          const {data:prof, error} = await sb.from("profiles").select("school").maybeSingle();
          if(!error) setProfile(prof || {school:null});
        }catch{}
      }
      catch(e){console.error(e);setData(JSON.parse(JSON.stringify(DEFAULT_STATE)));setSyncStatus("offline");}
      setReady(true);
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[session]);

  // Theme follows data.darkMode from every path (toggle, sync pull, conflict resolution).
  // applyTheme mutates C outside React, so tick a render afterwards — the render that
  // changed darkMode painted with the previous theme's inline styles.
  const [,setThemeTick] = useState(0);
  // Milestone bloom: marigold blob state for a few breaths after a goal is fully funded
  const [bloom, setBloom] = useState(false);
  const bloomTimer = React.useRef();
  const triggerBloom = () => { setBloom(true); clearTimeout(bloomTimer.current); bloomTimer.current = setTimeout(()=>setBloom(false), 9000); };
  useEffect(()=>{ if(data){ applyTheme(data.darkMode); setThemeTick(t=>t+1); } },[data && data.darkMode]);

  // Usage logging: fire once per actual tab change (not on every render).
  useEffect(()=>{ logEvent('tab_view', {tab}); },[tab]);

  // Auto-select the correct academic year and month once data is loaded
  useEffect(()=>{
    if(!data||!ready) return;
    const now=new Date();
    for(let i=0;i<data.years.length;i++){
      const y=data.years[i];
      if(!y.startDate||!y.endDate) continue;
      const start=new Date(y.startDate+"T12:00:00");
      const end=new Date(y.endDate+"T12:00:00");
      if(now>=start&&now<=end){
        setAy(y.id);
        setSelMonth((now.getMonth()-7+12)%12);
        return;
      }
    }
    // Before first year starts: show Year 1, default to August
    setAy(data.years[0]?.id||0);
    setSelMonth(0);
  },[ready]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useCallback(async d => {
    const ts = Date.now();
    const json = JSON.stringify({...d, _savedAt: ts});
    try{await window.storage.set("marro_v8",json);setFlash(true);setTimeout(()=>setFlash(false),1400);}catch{}
    // If a conflict is awaiting resolution, don't overwrite cloud until resolved
    if(syncStatus==="conflict") return;
    clearTimeout(gistTimerRef.current);
    setSyncStatus("syncing");
    gistTimerRef.current = setTimeout(async()=>{
      const baseRaw = localStorage.getItem(SYNC_BASE_KEY);
      const base = baseRaw ? JSON.parse(baseRaw) : null;
      if(base){
        const serverContent = await stateFetch();
        if(serverContent){
          const server = JSON.parse(serverContent);
          if(server._savedAt && base._savedAt && server._savedAt > base._savedAt){
            const strip = o=>{const c={...o}; delete c._savedAt; return c;};
            const baseClean=strip(base), serverClean=strip(server);
            const localCh=diffStates(baseClean,d), serverCh=diffStates(baseClean,serverClean);
            const {conflicts,mergeLocal,mergeServer}=findConflicts(localCh,serverCh);
            if(conflicts.length>0){
              setPendingConflict({conflicts,base:baseClean,server:serverClean,local:d,mergeLocal,mergeServer});
              setSyncStatus("conflict");
              return;
            }
            // No conflicts — auto-merge: start from server, apply local-only changes
            let merged=applyChanges(serverClean,mergeLocal);
            const mergedJson=JSON.stringify({...merged,_savedAt:Date.now()});
            const ok=await stateWrite(mergedJson);
            if(ok){localStorage.setItem(SYNC_BASE_KEY,mergedJson);await window.storage.set("marro_v8",mergedJson);setData(merged);setSyncStatus("synced");}
            else setSyncStatus("offline");
            return;
          }
        }
      }
      const ok=await stateWrite(json);
      if(ok){localStorage.setItem(SYNC_BASE_KEY,json);setSyncStatus("synced");}
      else setSyncStatus("offline");
    }, 2000);
  },[syncStatus]);

  const resolveConflict = useCallback(async({base,server,mergeLocal,resolvedChanges})=>{
    // Apply local-only auto-merges then user's conflict choices on top of server
    let merged=applyChanges(server,mergeLocal);
    merged=applyChanges(merged,resolvedChanges);
    const mergedJson=JSON.stringify({...merged,_savedAt:Date.now()});
    const ok=await stateWrite(mergedJson);
    if(ok){localStorage.setItem(SYNC_BASE_KEY,mergedJson);await window.storage.set("marro_v8",mergedJson);setData(merged);setSyncStatus("synced");}
    else setSyncStatus("offline");
    setPendingConflict(null);
  },[]);

  // Shared: pull from cloud if server is newer and no local changes pending
  const syncStatusRef = React.useRef(syncStatus);
  useEffect(()=>{ syncStatusRef.current=syncStatus; },[syncStatus]);
  const checkAndPull = React.useCallback(async()=>{
    if(syncStatusRef.current==='conflict') return;
    const baseRaw=localStorage.getItem(SYNC_BASE_KEY);
    const base=baseRaw?JSON.parse(baseRaw):null;
    if(!base) return;
    const serverContent=await stateFetch();
    if(!serverContent) return;
    const server=JSON.parse(serverContent);
    if(!server._savedAt||!base._savedAt||server._savedAt<=base._savedAt) return;
    const strip=o=>{const c={...o};delete c._savedAt;return c;};
    const baseClean=strip(base), serverClean=strip(server);
    const localCh=diffStates(baseClean,dataRef.current||{});
    if(Object.keys(localCh).length===0){
      const sJson=JSON.stringify(server);
      localStorage.setItem(SYNC_BASE_KEY,sJson);
      await window.storage.set("marro_v8",sJson);
      setData(serverClean);
      setSyncStatus("synced");
    }
  },[]);

  // Pull on tab focus + poll every 30s while visible
  useEffect(()=>{
    if(!ready) return;
    const onViz=()=>{ if(document.visibilityState==='visible') checkAndPull(); };
    document.addEventListener('visibilitychange',onViz);
    const poll=setInterval(()=>{ if(document.visibilityState==='visible') checkAndPull(); },30000);
    return()=>{ document.removeEventListener('visibilitychange',onViz); clearInterval(poll); };
  },[ready,checkAndPull]);

  // Re-sync immediately when internet comes back
  const saveRef = React.useRef(save);
  useEffect(()=>{ saveRef.current=save; },[save]);
  useEffect(()=>{
    const onOnline=()=>{
      if(!dataRef.current) return;
      setSyncStatus("syncing");
      saveRef.current(dataRef.current);
    };
    window.addEventListener('online',onOnline);
    return()=>window.removeEventListener('online',onOnline);
  },[]);

  const upd = d => { setData(d); save(d); };
  const dismiss = k => setDismissed(p=>({...p,[k]:true}));

  // Archive stale entries on load
  useEffect(()=>{
    if(!data) return;
    const monday = getMonday(new Date());
    const d = JSON.parse(JSON.stringify(data));
    const entries = d.currentWeekEntries||[];
    const stale = entries.filter(e=>getMonday(e.date)<monday);
    if(stale.length===0) return;
    if(!d.weeklyArchive) d.weeklyArchive=[];
    const byWeek={};
    stale.forEach(e=>{const wk=getMonday(e.date);(byWeek[wk]=byWeek[wk]||[]).push(e);});
    Object.entries(byWeek).forEach(([wk,ents])=>{
      const ex=d.weeklyArchive.find(a=>a.weekStart===wk);
      if(ex){ex.entries.push(...ents);ex.total=ex.entries.reduce((a,e)=>a+Number(e.amount),0);}
      else d.weeklyArchive.push({weekStart:wk,weekEnd:getSunday(wk),entries:ents,total:ents.reduce((a,e)=>a+Number(e.amount),0)});
    });
    d.currentWeekEntries=entries.filter(e=>getMonday(e.date)>=monday);
    upd(d);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[ready]);


  const loadingScreen = <div style={{position:"fixed",inset:0,display:"flex",alignItems:"center",justifyContent:"center",background:"#101210",zIndex:2000}}><MarroIntro size={360}/></div>;
  if(session===undefined) return loadingScreen;
  if(accessDenied) return (
    <main style={{position:"fixed",inset:0,display:"flex",alignItems:"center",justifyContent:"center",background:"transparent",color:C.text,padding:24}}>
      <div style={{maxWidth:420,textAlign:"center",display:"flex",flexDirection:"column",alignItems:"center"}}>
        <div style={{marginBottom:20}}><MarroLogo size={64}/></div>
        <h1 style={{fontSize:22,fontWeight:600,margin:"0 0 10px",letterSpacing:"-0.02em",fontFamily:"'Newsreader', Georgia, serif"}}>Marro is invite-only<span style={{color:C.marigold}}>.</span></h1>
        <p style={{fontSize:14,color:C.sub,lineHeight:1.5,margin:"0 0 24px"}}>That account isn&apos;t on the beta invite list yet. Reach out to request access, or try again if you think this is a mistake.</p>
        <button className="btn-fill" onClick={()=>{setAccessDenied(false);}} style={{padding:"10px 24px",fontSize:13,fontWeight:600,border:"none",borderRadius:8,background:C.teal,color:C.bg,cursor:"pointer",minHeight:44}}>Back to sign in</button>
      </div>
    </main>
  );
  if(session===null) return (
    <React.Suspense fallback={loadingScreen}>
      <LandingPage offline={!navigator.onLine}/>
    </React.Suspense>
  );
  if(!ready) return loadingScreen;

  const yr   = data.years.find(y=>y.id===ay)||data.years[0];
  const yrStartYear = yr.startDate ? new Date(yr.startDate+"T12:00:00").getFullYear() : 2026;
  const cats = data.categories;
  const subs = data.subscriptions||[];
  const subsMo = Math.round(subMonthlyTotal(subs));

  // ── Financials ────────────────────────────────────────────────────────────
  const annGrant    = Number(yr.grant)||0;
  const annTuition  = Number(yr.tuitionFees)||0;
  const annHlth     = Number(yr.healthIns)||0;
  const annDisburse = Math.max(annGrant - annTuition - annHlth, 0);
  const annOther    = (Number(yr.otherIncome)||0)*12;
  const moSpendable = (annDisburse + annOther)/12;
  // Month-disabled categories
  const monthKey = ay+"-"+MONTH_NAMES[selMonth];
  const disabledCats = data.monthDisabled?.[monthKey]||[];
  const promoteToBudget = (catId) => {
    const d=JSON.parse(JSON.stringify(data));
    const mk=MONTH_NAMES[selMonth];
    // remove from disabled
    const dk=ay+"-"+mk;
    if(d.monthDisabled?.[dk]) d.monthDisabled[dk]=d.monthDisabled[dk].filter(c=>c!==catId);
    // set this month's budget to at least what's been spent
    const spent=spentInMonth(catId,selMonth);
    const dyr=d.years.find(y=>y.id===ay)||d.years[0];
    if(!dyr.monthlyOverrides) dyr.monthlyOverrides={};
    if(!dyr.monthlyOverrides[mk]) dyr.monthlyOverrides[mk]={};
    dyr.monthlyOverrides[mk][catId]=Math.ceil(spent);
    upd(d);
  };
  const toggleMonthCat = (catId) => {const d=JSON.parse(JSON.stringify(data));if(!d.monthDisabled)d.monthDisabled={};const mk=ay+"-"+MONTH_NAMES[selMonth];const cur=d.monthDisabled[mk]||[];d.monthDisabled[mk]=cur.includes(catId)?cur.filter(c=>c!==catId):[...cur,catId];upd(d);};

  // Effective monthly value for a specific academic month index
  const getMonthValIdx = (catId, mIdx) => {
    const mk = MONTH_NAMES[mIdx];
    const ov = yr.monthlyOverrides?.[mk];
    if(ov && ov[catId] !== undefined) return ov[catId];
    return catId==="subs" ? subsMo : (Number(yr.monthly[catId])||0);
  };
  // Get effective monthly values (base + month overrides)
  const getMonthVal = (catId) => {
    const mk = MONTH_NAMES[selMonth];
    const overrides = yr.monthlyOverrides?.[mk];
    if(overrides && overrides[catId] !== undefined) return overrides[catId];
    return catId==="subs" ? subsMo : (Number(yr.monthly[catId])||0);
  };
  const rawMonthly = {};
  cats.forEach(c => { rawMonthly[c.id] = disabledCats.includes(c.id) ? 0 : (c.id==="subs" ? subsMo : getMonthVal(c.id)); });
  const moSpend     = moTotal(rawMonthly);

  // Spent in a given academic month (sums all dated entries in that calendar month)
  const allEntriesFlat = [...(data.currentWeekEntries||[]), ...((data.weeklyArchive||[]).flatMap(a=>a.entries||[]))];
  const spentInMonth = (catId, mIdx) => {
    const calMonth = (mIdx + 7) % 12;
    const calYear = yrStartYear + (mIdx >= 5 ? 1 : 0);
    return allEntriesFlat.filter(e=>{
      const dt=new Date(e.date+"T12:00:00");
      return e.catId===catId && dt.getMonth()===calMonth && dt.getFullYear()===calYear;
    }).reduce((a,e)=>a+Number(e.amount),0);
  };
  // Unbudgeted categories for the selected month: removed from plan but have spending
  const unbudgetedCats = cats.filter(c=>!c.locked && !c.autoCalc && disabledCats.includes(c.id) && spentInMonth(c.id,selMonth)>0);
  const unbudgetedTotal = unbudgetedCats.reduce((a,c)=>a+spentInMonth(c.id,selMonth),0);

  const moSurplus = Math.round(moSpendable - moSpend - unbudgetedTotal);  // this month's net (auto)

  // Per-month net = spendable - planned budget - unbudgeted spending
  const monthNetFor = (mi) => {
    const mn=MONTH_NAMES[mi];
    const disM=data.monthDisabled?.[ay+"-"+mn]||[];
    let planned=0, unb=0;
    cats.forEach(c=>{
      if(c.id==="subs"){ if(!disM.includes("subs")) planned+=subsMo; return; }
      if(disM.includes(c.id)){ if(!c.locked&&!c.autoCalc) unb+=spentInMonth(c.id,mi); }
      else { const ov=yr.monthlyOverrides?.[mn]?.[c.id]; planned += (ov!==undefined?ov:(Number(yr.monthly[c.id])||0)); }
    });
    return moSpendable - planned - unb;
  };
  // Running balance: cumulative net Aug → selected month (auto carry-forward)
  let runningBalance = 0;
  for(let mi=0; mi<=selMonth; mi++) runningBalance += monthNetFor(mi);
  runningBalance = Math.round(runningBalance);
  // Year net: full 12-month cumulative
  let curYrNet = 0;
  for(let mi=0; mi<12; mi++) curYrNet += monthNetFor(mi);

  // Prior-year carryover: sum of all complete years before this one (for cross-year balance)
  const priorYearsCarryover = (() => {
    let total = 0;
    for(const y of data.years) {
      if(y.id === ay) break;
      const yMoSpendable = Math.max((Number(y.grant)||0)-(Number(y.tuitionFees)||0)-(Number(y.healthIns)||0),0)/12 + (Number(y.otherIncome)||0);
      const yDisabled = data.monthDisabled||{};
      MONTH_NAMES.forEach((mn,mi)=>{
        const disM = yDisabled[y.id+"-"+mn]||[];
        let planned=0, unb=0;
        cats.forEach(c=>{
          if(c.id==="subs"){if(!disM.includes("subs")) planned+=subsMo;return;}
          if(disM.includes(c.id)){if(!c.locked&&!c.autoCalc) unb+=spentInMonth(c.id,mi);}
          else{const ov=y.monthlyOverrides?.[mn]?.[c.id];planned+=(ov!==undefined?ov:(Number(y.monthly[c.id])||0));}
        });
        total += yMoSpendable - planned - unb;
      });
    }
    return Math.round(total);
  })();
  // Total balance = prior years + current year so far (used by Growth Projector)
  const totalAccumulatedBalance = priorYearsCarryover + runningBalance;


  // 5-yr
  const totDisburse = data.years.reduce((a,y)=>a+Math.max((Number(y.grant)||0)-(Number(y.tuitionFees)||0)-(Number(y.healthIns)||0),0)+(Number(y.otherIncome)||0)*12,0);
  const totSpend    = data.years.reduce((a,y)=>a+moTotal({...y.monthly,subs:subsMo})*12,0);

  // ── Weekly ────────────────────────────────────────────────────────────────
  const currentWeekStart = getMonday(new Date());
  const currentWeekEnd   = getSunday(currentWeekStart);
  const currentEntries   = data.currentWeekEntries||[];
  const weeklyBudget     = moSpendable/4.333;
  const archives         = [...(data.weeklyArchive||[])].sort((a,b)=>b.weekStart.localeCompare(a.weekStart));

  // Weekly rollover: check last week surplus
  const lastArchive      = archives[0];
  const lastWeekSurplus  = lastArchive ? Math.max(weeklyBudget - lastArchive.total, 0) : 0;
  const thisWeekBudget   = weeklyBudget + lastWeekSurplus;

  const viewEntries = viewWeek ? (archives.find(a=>a.weekStart===viewWeek)?.entries||[]) : currentEntries;
  const viewTotal   = viewWeek ? (archives.find(a=>a.weekStart===viewWeek)?.total||0) : currentEntries.reduce((a,e)=>a+Number(e.amount),0);
  const viewBudget  = viewWeek
    ? (() => {
        const idx = archives.findIndex(a=>a.weekStart===viewWeek);
        const prevArchive = archives[idx+1];
        const prevSurplus = prevArchive ? Math.max(weeklyBudget - prevArchive.total, 0) : 0;
        return weeklyBudget + prevSurplus;
      })()
    : thisWeekBudget;

  // Monthly rollover
  const today = todayStr();
  const currentMonth = getYearMonthStr(today);
  const lastMonthKey = (() => {
    const [y,m] = currentMonth.split("-").map(Number);
    const lm = m===1?12:m-1;
    const ly = m===1?y-1:y;
    return `${ly}-${String(lm).padStart(2,"0")}`;
  })();
  const monthRollovers = data.monthlyRollover||{};
  const lastMonthRollover = monthRollovers[lastMonthKey]||0;
  const moSpendableWithRollover = moSpendable + lastMonthRollover/30; // spread over 30 days

  // Renewal check
  const renewalsDue = subs.filter(s=>s.active!==false&&!s.renewalPrompted&&daysUntil(s.renewal)!==null&&daysUntil(s.renewal)<=0);
  const renewalsSoon = subs.filter(s=>s.active!==false&&daysUntil(s.renewal)!==null&&daysUntil(s.renewal)>0&&daysUntil(s.renewal)<=14);

  // ── Mutations ─────────────────────────────────────────────────────────────
  const setMo = (yi,cid,v) => {
    const d=JSON.parse(JSON.stringify(data));
    const mk=MONTH_NAMES[selMonth];
    if(!d.years[yi].monthlyOverrides) d.years[yi].monthlyOverrides={};
    if(!d.years[yi].monthlyOverrides[mk]) d.years[yi].monthlyOverrides[mk]={};
    const minV = Math.ceil(spentInMonth(cid,selMonth));  // can't budget below logged spending
    d.years[yi].monthlyOverrides[mk][cid]=Math.max(Number(v)||0, minV);
    upd(d);
  };
  const setYrF = (yi,f,v) => {const d=JSON.parse(JSON.stringify(data));d.years[yi][f]=v;upd(d);};

  const syncSubs = d => {
    const mo = Math.round(subMonthlyTotal(d.subscriptions));
    d.years.forEach(y=>{y.monthly.subs=mo;}); return d;
  };

  // Pure renewal mutation (shared via ctx so the in-modal Subscriptions "Handle"
  // button can drive its own local RenewalDialog — the App-level dialog below
  // would render behind the "Fixed monthly costs" modal at equal z-index).
  const applyRenewal = (sub,renewed,newAmt,newDate) => {
    let d=JSON.parse(JSON.stringify(data));
    if(!renewed) d.subscriptions=d.subscriptions.filter(s=>s.id!==sub.id);
    else d.subscriptions=d.subscriptions.map(s=>s.id===sub.id?{...s,amount:parseFloat(newAmt)||s.amount,renewal:newDate||"",renewalPrompted:true,active:true}:s);
    d=syncSubs(d);upd(d);
  };
  // App-level wrapper — used by the renewal banners' RenewalDialog.
  const handleRenewal = (sub,renewed,newAmt,newDate) => { applyRenewal(sub,renewed,newAmt,newDate); setRenewDlg(null); };

  // Remove a weekly entry by id from both current week and archive (mutates d)
  const removeWeeklyEntry = (d, eid) => {
    d.currentWeekEntries=(d.currentWeekEntries||[]).filter(e=>e.id!==eid);
    d.weeklyArchive=(d.weeklyArchive||[]).map(a=>{
      const ents=a.entries.filter(e=>e.id!==eid);
      return {...a,entries:ents,total:ents.reduce((s,e)=>s+Number(e.amount),0)};
    });
  };
  // Reverse all side-effects of a deposit: linked weekly entry, goal balance,
  // and the budget override we auto-added (only if still untouched). Mutates d.
  const reverseDeposit = (d, slEntry) => {
    if(!slEntry) return;
    // Remove the linked weekly entry
    if(slEntry.weeklyEntryId) removeWeeklyEntry(d, slEntry.weeklyEntryId);
    // Decrement the goal balance
    const inStep=(d.stepGoals||[]).findIndex(x=>x.id===slEntry.goalId);
    const inCustom=(d.savingsGoals||[]).findIndex(x=>x.id===slEntry.goalId);
    if(inStep>=0) d.stepGoals[inStep].saved=Math.max(0,(d.stepGoals[inStep].saved||0)-slEntry.amount);
    else if(inCustom>=0) d.savingsGoals[inCustom].saved=Math.max(0,(d.savingsGoals[inCustom].saved||0)-slEntry.amount);
    // Decrement the auto-managed budget override by the amount this deposit contributed.
    // Using subtraction (not exact-match) so multiple deposits in the same month each
    // remove only their own delta, leaving any remaining contributions intact.
    const ba=slEntry.budgetAdded;
    if(ba && d.years[ba.ay]?.monthlyOverrides?.[ba.monthName]){
      const cur=d.years[ba.ay].monthlyOverrides[ba.monthName][ba.catId]||0;
      const next=Math.max(0,cur-ba.amount);
      if(next===0) delete d.years[ba.ay].monthlyOverrides[ba.monthName][ba.catId];
      else d.years[ba.ay].monthlyOverrides[ba.monthName][ba.catId]=next;
    }
    // Remove the savings log entry itself
    d.savingsLog=(d.savingsLog||[]).filter(e=>e.id!==slEntry.id);
  };
  // Reverse a deposit AND any siblings derived from the same weekly entry
  // (one weekly exams entry can be split across multiple Step goals). Mutates d.
  const reverseDepositGroup = (d, slEntry) => {
    if(!slEntry) return;
    if(slEntry.weeklyEntryId){
      (d.savingsLog||[]).filter(s=>s.weeklyEntryId===slEntry.weeklyEntryId).forEach(s=>reverseDeposit(d, s));
    } else {
      reverseDeposit(d, slEntry);
    }
  };

  // Log a one-off actual expense (Weekly tab's log form + the header Quick add
  // button both call this). Files to the correct week/archive slot, credits any
  // exam spending toward Step goals, and returns info the caller can use to show
  // an over-budget/unbudgeted notice — it doesn't own any notice UI itself.
  const addWeeklyEntry = (catId, amount, note, date) => {
    const amtNum = parseFloat(amount)||0;
    if(!catId || !amtNum) return null;
    const entryWeek = getMonday(date);
    const thisWeek  = getMonday(new Date());
    const entry = {id:"e_"+Date.now(),catId,amount:amtNum,note,date};
    let d = JSON.parse(JSON.stringify(data));
    if(!d.currentWeekEntries) d.currentWeekEntries=[];
    if(!d.weeklyArchive) d.weeklyArchive=[];

    const eMonthIdx = (new Date(date+"T12:00:00").getMonth() - 7 + 12) % 12;
    const mk = ay+"-"+MONTH_NAMES[eMonthIdx];
    const catObj = cats.find(c=>c.id===catId);
    const isUnbudgeted = d.monthDisabled?.[mk]?.includes(catId) && catId!=="subs";

    if(entryWeek !== thisWeek) {
      const ex = d.weeklyArchive.find(a=>a.weekStart===entryWeek);
      if(ex){ex.entries.push(entry);ex.total=ex.entries.reduce((a,e)=>a+Number(e.amount),0);}
      else d.weeklyArchive.push({weekStart:entryWeek,weekEnd:getSunday(entryWeek),entries:[entry],total:entry.amount});
      setViewWeek(entryWeek);
    } else {
      d.currentWeekEntries.push(entry);
      setViewWeek(null);
    }
    // Exams spending is an actual contribution to the Step fund — credit the first
    // unfunded Step goal, overflowing into the next once one is full.
    if(catId==="exams"){
      if(!d.savingsLog) d.savingsLog=[];
      let remainingAmt=amtNum;
      (d.stepGoals||[]).forEach((g,gi)=>{
        if(remainingAmt<=0) return;
        const room=Math.max(0,(g.targetAmount||0)-(g.saved||0));
        const credit=Math.min(room,remainingAmt);
        if(credit<=0) return;
        d.stepGoals[gi].saved=(d.stepGoals[gi].saved||0)+credit;
        d.savingsLog.push({id:"sl_"+Date.now()+"_"+gi,goalId:g.id,amount:credit,date,note:(note||"From weekly log"),weeklyEntryId:entry.id,budgetAdded:null});
        remainingAmt-=credit;
      });
    }
    upd(d);

    // Recompute that month's net (spendable - planned - unbudgeted) to flag over-budget
    const allFlat=[...(d.currentWeekEntries||[]),...((d.weeklyArchive||[]).flatMap(a=>a.entries||[]))];
    const eCalYr=yrStartYear+(eMonthIdx>=5?1:0);
    const spentCat=(cid)=>allFlat.filter(e=>{const dt=new Date(e.date+"T12:00:00");return e.catId===cid&&dt.getMonth()===((eMonthIdx+7)%12)&&dt.getFullYear()===eCalYr;}).reduce((a,e)=>a+Number(e.amount),0);
    const disabledThisMonth=d.monthDisabled?.[mk]||[];
    let planned=0, unb=0;
    cats.forEach(c=>{
      if(c.id==="subs"){ if(!disabledThisMonth.includes("subs")) planned+=subsMo; return; }
      if(disabledThisMonth.includes(c.id)){ if(!c.locked&&!c.autoCalc) unb+=spentCat(c.id); }
      else { const dyr2=d.years.find(y=>y.id===ay)||d.years[0]; const ov=dyr2.monthlyOverrides?.[MONTH_NAMES[eMonthIdx]]?.[c.id]; planned += (ov!==undefined?ov:(Number(dyr2.monthly[c.id])||0)); }
    });
    const deficit=Math.round(planned+unb-moSpendable);
    logEvent('expense_logged', {});
    return {deficit, isUnbudgeted, catLabel:catObj?.label, monthIdx:eMonthIdx};
  };

  const addCat = () => {
    if(!newCatName.trim()) return;
    const id="cat_"+Date.now();
    const d=JSON.parse(JSON.stringify(data));
    d.categories.push({id,label:newCatName.trim(),...(newCatIcon&&newCatIcon!=="dot"?{icon:newCatIcon}:{})});
    d.years.forEach(y=>{y.monthly[id]=0;});
    upd(d);setNewCatName("");setNewCatIcon("dot");
    logEvent('category_added', {});
  };
  const reorderCats = (fromId, toId) => {
    if(fromId===toId) return;
    const d=JSON.parse(JSON.stringify(data));
    const arr=d.categories;
    const fromIdx=arr.findIndex(c=>c.id===fromId);
    const toIdx=arr.findIndex(c=>c.id===toId);
    if(fromIdx<0||toIdx<0) return;
    const [moved]=arr.splice(fromIdx,1);
    arr.splice(toIdx,0,moved);
    upd(d);
  };
  const delCat = cid => {
    const d=JSON.parse(JSON.stringify(data));
    d.categories=d.categories.filter(c=>c.id!==cid);
    d.years.forEach(y=>{delete y.monthly[cid];});
    upd(d);
  };
  // Restore a soft-deleted year, exact numbers intact, slotted back in by start date.
  const reinstateYear = (arch) => {
    const d=JSON.parse(JSON.stringify(data));
    d.archivedYears=(d.archivedYears||[]).filter(a=>a.startDate!==arch.startDate);
    const newId=Math.max(...d.years.map(y=>y.id),-1)+1;
    d.years.push({...arch, id:newId});
    d.years.sort((a,b)=>String(a.startDate||"").localeCompare(String(b.startDate||"")));
    d.years.forEach((y,i)=>{
      const sy=y.startDate?new Date(y.startDate+"T12:00:00").getFullYear():2025+i;
      const ey=y.endDate?new Date(y.endDate+"T12:00:00").getFullYear():sy+1;
      y.label=`Year ${i+1} — ${sy}-${String(ey).slice(2)}`;
    });
    upd(d); setAy(newId);
  };
  const addYear = (start,end) => {
    const d=JSON.parse(JSON.stringify(data));
    const newId=Math.max(...d.years.map(y=>y.id),-1)+1;
    const yrNum=d.years.length+1;
    const last=d.years[d.years.length-1]||{};
    const sy=start?new Date(start+"T12:00:00").getFullYear():new Date().getFullYear()+d.years.length;
    const ey=end?new Date(end+"T12:00:00").getFullYear():sy+1;
    // If a year with this same academic start was soft-deleted, restore it (exact numbers) instead of a blank one.
    const arch=(d.archivedYears||[]).find(a=>a.startDate&&new Date(a.startDate+"T12:00:00").getFullYear()===sy);
    if(arch){ setShowAddYear(false);setNyStart("");setNyEnd(""); reinstateYear(arch); return; }
    // Inherit the previous year's figures (the user's own data), not any school's defaults.
    d.years.push({
      id:newId, label:`Year ${yrNum} — ${sy}-${String(ey).slice(2)}`,
      tuitionFees:Number(last.tuitionFees)||0, healthIns:Number(last.healthIns)||0,
      grant:Number(last.grant)||0, otherIncome:Number(last.otherIncome)||0,
      housing:Number(last.housing)||0, housingNote:last.housingNote||"",
      livingAllowance:Number(last.livingAllowance)||0, notes:"",
      startDate:start||`${sy}-08-01`, endDate:end||`${ey}-08-15`,
      monthly:{...(last.monthly||BLANK_MONTHLY)}, monthlyOverrides:{},
    });
    upd(d);setShowAddYear(false);setNyStart("");setNyEnd("");
  };
  const removeYear = (yid) => {
    const d=JSON.parse(JSON.stringify(data));
    if(d.years.length<=1) return;
    // Soft delete: archive the year's data (deduped by start date) so reinstating
    // it later restores the exact numbers. Not discarded.
    const removed=d.years.find(y=>y.id===yid);
    if(removed){
      d.archivedYears=(d.archivedYears||[]).filter(a=>a.startDate!==removed.startDate);
      d.archivedYears.push(removed);
    }
    d.years=d.years.filter(y=>y.id!==yid);
    // Re-number remaining years sequentially
    d.years.forEach((y,i)=>{
      const sy=y.startDate?new Date(y.startDate+"T12:00:00").getFullYear():2025+i;
      const ey=y.endDate?new Date(y.endDate+"T12:00:00").getFullYear():sy+1;
      y.label=`Year ${i+1} — ${sy}-${String(ey).slice(2)}`;
    });
    upd(d);
    if(ay===yid) setAy(d.years[0].id);
    if(removed) setYearUndo(removed);
  };

  // Charts

  const barData = data.years.map(y=>{
    const sp=Math.round((Math.max((Number(y.grant)||0)-(Number(y.tuitionFees)||0)-(Number(y.healthIns)||0),0)+(Number(y.otherIncome)||0)*12)/12);
    return {name:y.label.split("—")[0].trim().replace("Year ","Y"),Spendable:sp,Spend:Math.round(moTotal({...y.monthly,subs:subsMo}))};
  });

  // Rollover recommendation
  const rolloverReco = (surplus) => {
    if(surplus<=0) return null;
    const recs = [];
    const yrData = data.years.find(y=>y.id===ay)||data.years[0];
    if(!(yrData.monthly.savings||0)) recs.push(`Consider building an emergency fund (goal: ${fmt(moSpend*3)})`);
    if(!(yrData.monthly.exams||0)) recs.push(`Set aside ${fmt(surplus)} for USMLE Step exams (~$850 each)`);
    if(subsMo < 50) recs.push(`Consider adding a study resource (UWorld, Amboss) for ${fmt(surplus)}/mo`);
    recs.push(`Add it to savings — even ${fmt(surplus)}/mo compounds significantly over your training`);
    return recs[0];
  };

  // Shared surface handed to the extracted tab panels via context. Same locals the
  // header + tabs always used — just passed down explicitly instead of via closure.
  const ctx = {
    // core state
    data, setData, upd, save, ay, setAy, cats, profile, session, syncStatus,
    flash, bloom, triggerBloom, dismissed, dismiss, selMonth, setSelMonth,
    // shared form/modal state (spans tabs or App-level chrome)
    renewDlg, setRenewDlg, newCatName, setNewCatName, newCatIcon, setNewCatIcon,
    iconPickOpen, setIconPickOpen, viewWeek, setViewWeek,
    confirmYearRemove, setConfirmYearRemove, showAddYear, setShowAddYear,
    nyStart, setNyStart, nyEnd, setNyEnd, yearUndo, setYearUndo,
    // derived financial memos
    yr, yrStartYear, subs, subsMo, annGrant, annTuition, annHlth, annDisburse,
    annOther, moSpendable, monthKey, disabledCats, moSpend, allEntriesFlat,
    spentInMonth, unbudgetedCats, unbudgetedTotal, moSurplus, monthNetFor,
    runningBalance, curYrNet, priorYearsCarryover, totalAccumulatedBalance,
    totDisburse, totSpend, getMonthValIdx, getMonthVal, weeklyBudget,
    currentWeekStart, currentWeekEnd, currentEntries, archives, lastArchive,
    lastWeekSurplus, thisWeekBudget, viewEntries, viewTotal, viewBudget,
    lastMonthRollover, moSpendableWithRollover,
    renewalsDue, renewalsSoon, barData, rolloverReco,
    // shared mutation helpers (don't close over any one tab's private form state)
    setMo, setYrF, syncSubs, promoteToBudget, toggleMonthCat, removeWeeklyEntry,
    reverseDeposit, reverseDepositGroup, addCat, reorderCats, delCat,
    reinstateYear, addYear, removeYear, addWeeklyEntry, applyRenewal,
  };

  return (
    <AppContext.Provider value={ctx}>
    <div style={{fontFamily:"'Inter',system-ui,sans-serif",maxWidth:940,margin:"0 auto",padding:"24px 20px",minHeight:"100vh",background:"transparent",color:C.text,transition:"color .3s"}}>
      <style>{`
        @keyframes marroPulse{0%,100%{opacity:1}50%{opacity:0.3}}
        @keyframes marroRingPop{
          0%  {transform:scale(0);opacity:0}
          15% {opacity:1}
          42% {transform:scale(1.45)}
          58% {transform:scale(0.75)}
          72% {transform:scale(1.18)}
          83% {transform:scale(0.92)}
          91% {transform:scale(1.05)}
          96% {transform:scale(0.98)}
          100%{transform:scale(1)}
        }
        @keyframes marroDotPulse{0%,100%{transform:scale(1)}50%{transform:scale(1.35)}}
      `}</style>
      {/* Modals */}
      {showQuickAdd && <QuickAddModal onClose={()=>setShowQuickAdd(false)}/>}
      {showCategories && <Modal title="Categories" onClose={()=>setShowCategories(false)} width={480}><React.Suspense fallback={<div role="status" aria-live="polite" style={{padding:24,textAlign:"center",color:"var(--text-dim)",fontSize:14}}>Loading…</div>}><CustomizeTab/></React.Suspense></Modal>}
      {renewDlg && <RenewalDialog sub={renewDlg} onClose={()=>setRenewDlg(null)} onConfirm={handleRenewal}/>}
      {confirmReset && <Modal title="Reset everything?" onClose={()=>setConfirmReset(false)} width={350}>
        <div style={{fontSize:13,color:C.textMid,marginBottom:16,lineHeight:1.6}}>This replaces <strong>all</strong> of your budget, weekly entries, savings, and subscriptions with the starting defaults. This cannot be undone.</div>
        <div style={{display:"flex",gap:8}}>
          <button className="btn-fill" onClick={()=>setConfirmReset(false)} style={{flex:1.4,padding:"10px",fontSize:13,fontWeight:600,border:"none",borderRadius:8,background:C.creamSoft,color:C.text,cursor:"pointer"}}>Cancel</button>
          <button className="btn-fill" onClick={()=>{upd(JSON.parse(JSON.stringify(DEFAULT_STATE)));setConfirmReset(false);}} style={{flex:1,padding:"10px",fontSize:13,fontWeight:600,border:`1px solid ${C.dangerMid}`,borderRadius:8,background:C.dangerLight,color:C.danger,cursor:"pointer"}}>Reset everything</button>
        </div>
      </Modal>}
      {confirmDeleteAccount && <Modal title="Delete your account?" onClose={()=>{if(!deletingAccount)setConfirmDeleteAccount(false);}} width={380}>
        <div style={{fontSize:13,color:C.textMid,marginBottom:12,lineHeight:1.6}}>This permanently deletes your account and <strong>all</strong> your Marro data — budget, weekly entries, savings, subscriptions, and profile. <strong>This cannot be undone.</strong></div>
        <div style={{fontSize:12,color:C.textMid,marginBottom:8}}>
          If you want a copy of your data first, close this and use <strong>Export my data</strong> in Settings.
        </div>
        <label style={{display:"block",fontSize:11,fontWeight:600,color:C.textMid,marginBottom:6}} htmlFor="delete-confirm-input">
          Type <strong>DELETE</strong> to confirm
        </label>
        <input
          id="delete-confirm-input"
          autoFocus
          value={deleteConfirmText}
          onChange={e=>setDeleteConfirmText(e.target.value)}
          disabled={deletingAccount}
          placeholder="DELETE"
          style={{width:"100%",boxSizing:"border-box",padding:"9px 10px",fontSize:13,borderRadius:8,border:`1px solid ${C.border}`,background:C.surface,color:C.text,marginBottom:14,outline:"none"}}
        />
        {deleteAccountError && <div role="alert" style={{fontSize:12,color:C.danger,marginBottom:12}}>{deleteAccountError}</div>}
        <div style={{display:"flex",gap:8}}>
          <button className="btn-fill" disabled={deletingAccount} onClick={()=>setConfirmDeleteAccount(false)} style={{flex:1.4,padding:"10px",fontSize:13,fontWeight:600,border:"none",borderRadius:8,background:C.creamSoft,color:C.text,cursor:deletingAccount?"default":"pointer",opacity:deletingAccount?0.6:1}}>Cancel</button>
          <button
            className="btn-fill"
            disabled={deleteConfirmText.trim().toUpperCase()!=="DELETE" || deletingAccount}
            onClick={async()=>{
              setDeletingAccount(true);setDeleteAccountError(null);
              const r = await deleteAccount();
              if(!r.ok){
                setDeletingAccount(false);
                setDeleteAccountError(r.error||"Failed to delete account. Please try again.");
                return;
              }
              // Mirror the SIGNED_OUT cleanup below, then sign out (which also
              // triggers that handler) — belt-and-suspenders in case sign-out
              // is slow/offline after the account row is already gone server-side.
              localStorage.removeItem("marro_v8");
              localStorage.removeItem(SYNC_BASE_KEY);
              localStorage.removeItem("marro_uid");
              const sb = await getSupabase();
              await sb.auth.signOut();
              setConfirmDeleteAccount(false);
              setDeletingAccount(false);
            }}
            style={{flex:1,padding:"10px",fontSize:13,fontWeight:600,border:`1px solid ${C.dangerMid}`,borderRadius:8,background:C.dangerLight,color:C.danger,cursor:(deleteConfirmText.trim().toUpperCase()!=="DELETE"||deletingAccount)?"not-allowed":"pointer",opacity:(deleteConfirmText.trim().toUpperCase()!=="DELETE"||deletingAccount)?0.5:1}}
          >
            {deletingAccount?"Deleting…":"Delete account"}
          </button>
        </div>
      </Modal>}
      {confirmYearRemove!==null && <Modal title="Remove year" onClose={()=>setConfirmYearRemove(null)} width={350}>
        <div style={{fontSize:13,color:C.textMid,marginBottom:16,lineHeight:1.6}}>Remove <strong>{data.years.find(y=>y.id===confirmYearRemove)?.label}</strong>? Its budget data is kept — you can reinstate this year anytime from <strong>Add year</strong>, and its numbers come right back.</div>
        <div style={{display:"flex",gap:8}}>
          <button className="btn-fill" onClick={()=>setConfirmYearRemove(null)} style={{flex:1.4,padding:"10px",fontSize:13,fontWeight:600,border:"none",borderRadius:8,background:C.creamSoft,color:C.text,cursor:"pointer"}}>Cancel</button>
          <button className="btn-fill" onClick={()=>{removeYear(confirmYearRemove);setConfirmYearRemove(null);}} style={{flex:1,padding:"10px",fontSize:13,fontWeight:600,border:`1px solid ${C.dangerMid}`,borderRadius:8,background:C.dangerLight,color:C.danger,cursor:"pointer"}}>Remove</button>
        </div>
      </Modal>}
      {showAddYear && <Modal title="Add academic year" onClose={()=>setShowAddYear(false)} width={360}>
        {(data.archivedYears||[]).length>0 && <div style={{marginBottom:16}}>
          <div style={{fontSize:11,fontWeight:600,color:C.textMid,marginBottom:8}}>Reinstate a removed year</div>
          <div style={{display:"flex",flexDirection:"column",gap:6}}>
            {data.archivedYears.slice().sort((a,b)=>String(a.startDate||"").localeCompare(String(b.startDate||""))).map(a=>(
              <button key={a.startDate||a.id} type="button" onClick={()=>{setShowAddYear(false);reinstateYear(a);}}
                className="menu-row" style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,width:"100%",textAlign:"left",padding:"10px 12px",border:`1px solid ${C.border}`,borderRadius:10,background:"transparent",color:C.text,fontSize:13,cursor:"pointer"}}>
                <span style={{fontWeight:600}}>{a.label}</span>
                <span style={{fontSize:12,color:C.teal,fontWeight:600,whiteSpace:"nowrap"}}>Reinstate →</span>
              </button>
            ))}
          </div>
          <div style={{textAlign:"center",fontSize:11,color:C.gray,margin:"14px 0 2px"}}>— or add a new year —</div>
        </div>}
        <div style={{fontSize:12,color:C.textMid,marginBottom:14}}>The year number is assigned automatically. Enter the start and end dates for this academic year (end of summer break).</div>
        <div style={{marginBottom:10}}>
          <div style={{fontSize:11,fontWeight:600,color:C.textMid,marginBottom:4}}>Start date</div>
          <DateField value={nyStart} onChange={setNyStart} ariaLabel="Year start date"/>
        </div>
        <div style={{marginBottom:16}}>
          <div style={{fontSize:11,fontWeight:600,color:C.textMid,marginBottom:4}}>End date</div>
          <DateField value={nyEnd} onChange={setNyEnd} ariaLabel="Year end date"/>
        </div>
        <button className="btn-fill" onClick={()=>addYear(nyStart,nyEnd)} style={{width:"100%",padding:"10px",fontSize:13,fontWeight:600,border:"none",borderRadius:8,background:C.teal,color:C.bg,cursor:"pointer"}}>Add year</button>
      </Modal>}
      {yearUndo && <div role="status" style={{position:"fixed",left:"50%",bottom:24,transform:"translateX(-50%)",zIndex:1200,display:"flex",alignItems:"center",gap:16,maxWidth:"calc(100vw - 32px)",padding:"11px 12px 11px 16px",borderRadius:12,background:C.surface,border:`1px solid ${C.border}`,boxShadow:"0 8px 30px rgba(0,0,0,0.28)",backdropFilter:"blur(20px)",WebkitBackdropFilter:"blur(20px)"}}>
        <span style={{fontSize:13,color:C.text}}>Removed <strong>{yearUndo.label.split("—")[0].trim()}</strong>. Its data is saved.</span>
        <button onClick={()=>{reinstateYear(yearUndo);setYearUndo(null);}} style={{flexShrink:0,padding:"7px 14px",fontSize:13,fontWeight:600,border:`1px solid ${C.border}`,borderRadius:9,background:"transparent",color:C.teal,cursor:"pointer"}}>Undo</button>
      </div>}
      {/* ── Header ── */}
      {(()=>{
        const n=data.preferredName;
        const withName=[
          `Back at it, ${n}.`,`Hey ${n} — let's see where things stand.`,
          `Your money's been patient, ${n}.`,`Welcome back, ${n}.`,
          `Ready when you are, ${n}.`,`Let's take stock, ${n}.`,
          `Good to see you, ${n}.`,`Here's the plan, ${n}.`,
          `Checking in, ${n}?`,`Budgets don't manage themselves, ${n}.`,
        ];
        const withoutName=[
          "Back at it.","Here's where things stand.",
          "Your money's been patient.","Let's take stock.",
          "Ready when you are.","Good to be back.",
          "Here's the plan.","Checking in.",
          "Budgets don't manage themselves.","Where were we?",
        ];
        const pool=n?withName:withoutName;
        // Changes daily, stable within a session
        const dayIdx=Math.floor(Date.now()/86400000)%pool.length;
        const greeting=pool[dayIdx];
        return (
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:20,paddingBottom:16,borderBottom:`1px solid ${C.border}`,flexWrap:"wrap",columnGap:12,rowGap:12}}>
          <div style={{display:"flex",alignItems:"center",gap:12,flex:"1 1 230px",minWidth:0}}>
            <MarroLogo/>
            <div>
              <div style={{fontSize:24,fontWeight:600,color:C.text,letterSpacing:"-0.02em",lineHeight:1.1,fontFamily:"'Newsreader', Georgia, serif"}}>Marro<span style={{color:C.marigold}}>.</span></div>
              <div key={greeting} style={{fontSize:13.5,color:C.textMid,marginTop:3,fontFamily:"'Newsreader', Georgia, serif",fontStyle:"italic",letterSpacing:"-0.01em",lineHeight:1.2,animation:"obRise 600ms cubic-bezier(0.23,1,0.32,1) both"}}>{greeting}</div>
            </div>
          </div>
          <div style={{display:"flex",gap:10,alignItems:"center"}}>
            {syncStatus==="syncing"  && <span style={{fontSize:11,color:C.gray,display:"flex",alignItems:"center",gap:4}}><Icon name="live" size={11} color={C.amber} style={{animation:"marroPulse 1s infinite"}}/>Syncing…</span>}
            {syncStatus==="synced"   && <span style={{fontSize:11,color:C.teal,display:"flex",alignItems:"center",gap:4}}><Icon name="live" size={11} color={C.teal}/>Synced</span>}
            {syncStatus==="offline"  && <span style={{fontSize:11,color:C.amber,display:"flex",alignItems:"center",gap:4}}><Icon name="live" size={11} color={C.amber}/>Offline</span>}
            {syncStatus==="conflict" && <span style={{fontSize:11,color:C.neg,display:"flex",alignItems:"center",gap:4}}><Icon name="live" size={11} color={C.neg}/>Conflict</span>}
            {flash && <span style={{fontSize:12,color:C.teal,fontWeight:600}}>Saved</span>}
            {/* Quick add — one-off expense, no tab required (Phase 1: Weekly tab is hidden) */}
            <button className="btn-pop" onClick={()=>setShowQuickAdd(true)} aria-label="Quick add expense" title="Quick add expense" style={{minWidth:44,minHeight:44,padding:"0 14px",borderRadius:22,border:`1px solid ${C.border}`,background:"transparent",cursor:"pointer",color:C.text,display:"inline-flex",alignItems:"center",gap:6,fontSize:13,fontWeight:600,transition:"all .15s"}}>
              <Icon name="plus" size={14}/> Quick add
            </button>
            {/* Settings menu */}
            <div style={{position:"relative"}}>
              <button className="btn-pop" onClick={()=>setSettingsOpen(o=>!o)} aria-label="Settings" aria-haspopup="true" aria-expanded={settingsOpen} title="Settings" style={{width:32,height:32,borderRadius:8,border:`1px solid ${settingsOpen?C.sel:C.border}`,background:settingsOpen?C.selBg:"transparent",cursor:"pointer",color:C.textMid,display:"inline-flex",alignItems:"center",justifyContent:"center",transition:"all .15s"}}>
                <Icon name="settings" size={15}/>
              </button>
              {settingsOpen && <>
                <div onClick={()=>setSettingsOpen(false)} style={{position:"fixed",inset:0,zIndex:99}}/>
                <div role="group" aria-label="Settings" style={{position:"absolute",right:0,top:"calc(100% + 6px)",zIndex:100,width:214,padding:6,background:C.glassTooltip,backdropFilter:"blur(50px) saturate(200%)",WebkitBackdropFilter:"blur(50px) saturate(200%)",border:`1px solid ${C.borderDark}`,borderRadius:12,boxShadow:"0 8px 32px rgba(0,0,0,0.40)"}}>
                  {/* Profile block */}
                  <div style={{padding:"8px 10px 10px",borderBottom:`1px solid ${C.border}`}}>
                    <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
                      <button onClick={()=>{setSettingsOpen(false);setEditAvatar(true);}} title="Change avatar" style={{padding:0,border:"none",background:"transparent",cursor:"pointer",borderRadius:"50%",lineHeight:0,flexShrink:0}}>
                        <Avatar avatar={data.avatar} name={data.preferredName} email={session?.user?.email} size={30}/>
                      </button>
                      <div style={{minWidth:0}}>
                        {editName ? (
                          <form onSubmit={e=>{e.preventDefault();const val=e.target.elements.n.value.trim();const d=JSON.parse(JSON.stringify(data));d.preferredName=val||null;upd(d);setEditName(false);}} style={{display:"flex",gap:4,alignItems:"center"}}>
                            <input name="n" autoFocus defaultValue={data.preferredName||""} placeholder="Your first name" style={{flex:1,minWidth:0,fontSize:11,padding:"2px 6px",borderRadius:6,border:`1px solid ${C.sel}`,background:C.selBg,color:C.text,outline:"none"}}/>
                            <button className="txt-act" type="submit" style={{border:"none",background:"transparent",color:C.teal,fontSize:11,cursor:"pointer",fontWeight:600,padding:"2px 4px"}}>Save</button>
                            <button className="xbtn" type="button" onClick={()=>setEditName(false)} style={{border:"none",background:"transparent",color:C.gray,fontSize:11,cursor:"pointer",padding:"2px 4px"}}>✕</button>
                          </form>
                        ) : (
                          <button className="txt-act" onClick={()=>setEditName(true)} style={{display:"flex",alignItems:"center",gap:4,border:"none",background:"transparent",cursor:"pointer",padding:0}}>
                            <span style={{fontSize:12,fontWeight:600,color:C.text}}>{data.preferredName||"Set your name"}</span>
                            <span style={{fontSize:10,color:C.teal}}>✎</span>
                          </button>
                        )}
                        <div style={{fontSize:10.5,color:C.gray,marginTop:1,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}} title={session?.user?.email}>{session?.user?.email}</div>
                      </div>
                    </div>
                    {profile?.school && (
                      <button className="menu-row" onClick={()=>{setSettingsOpen(false);setEditSchool(true);setEditName(false);}} title={profile.school}
                        style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,width:"100%",padding:"5px 8px",borderRadius:6,border:"none",background:C.surfaceMid,cursor:"pointer",textAlign:"left"}}>
                        <span style={{fontSize:10.5,color:C.gray,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{profile.school}</span>
                        <span style={{fontSize:10.5,color:C.teal,flexShrink:0}}>Change</span>
                      </button>
                    )}
                    {profile?.school && (()=>{
                      const deg=degreeForSchool(profile.school), dp=data.program||{};
                      const summary = dp.dual==="phd" ? `${deg}-PhD${dp.phd?.field?` · ${dp.phd.field}`:""}`
                        : dp.dual==="masters" ? `${deg} + Master's${dp.masters?.field?` · ${dp.masters.field}`:""}`
                        : dp.dual==="other" ? `${deg}${dp.other?.field?` · ${dp.other.field}`:" · dual degree"}` : `${deg} only`;
                      return (
                        <button className="menu-row" onClick={()=>{setSettingsOpen(false);setEditProgram(true);setEditName(false);}} title={summary}
                          style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,width:"100%",marginTop:4,padding:"5px 8px",borderRadius:6,border:"none",background:C.surfaceMid,cursor:"pointer",textAlign:"left"}}>
                          <span style={{fontSize:10.5,color:C.gray,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{summary}</span>
                          <span style={{fontSize:10.5,color:C.teal,flexShrink:0}}>Change</span>
                        </button>
                      );
                    })()}
                  </div>
                  {/* Actions */}
                  <div style={{padding:"4px 0"}}>
                    <button className="menu-row" onClick={()=>{setSettingsOpen(false);setShowCategories(true);}} style={{display:"flex",alignItems:"center",gap:9,width:"100%",padding:"8px 10px",borderRadius:8,border:"none",background:"transparent",color:C.text,fontSize:12,fontWeight:500,cursor:"pointer",textAlign:"left",transition:"background .15s"}}>
                      <Icon name="settings" size={14}/>
                      Categories
                    </button>
                    <button className="menu-row" onClick={()=>{const d=JSON.parse(JSON.stringify(data));d.darkMode=!d.darkMode;upd(d);}} style={{display:"flex",alignItems:"center",gap:9,width:"100%",padding:"8px 10px",borderRadius:8,border:"none",background:"transparent",color:C.text,fontSize:12,fontWeight:500,cursor:"pointer",textAlign:"left",transition:"background .15s"}}>
                      <span key={data.darkMode?"sun":"moon"} style={{display:"inline-flex",animation:"iconSwap 220ms cubic-bezier(0.23,1,0.32,1)"}}><Icon name={data.darkMode?"sun":"moon"} size={14}/></span>
                      {data.darkMode?"Light mode":"Dark mode"}
                    </button>
                    <button className="menu-row" onClick={()=>{setConfirmReset(true);setSettingsOpen(false);}} style={{display:"flex",alignItems:"center",gap:9,width:"100%",padding:"8px 10px",borderRadius:8,border:"none",background:"transparent",color:C.danger,fontSize:12,fontWeight:500,cursor:"pointer",textAlign:"left",transition:"background .15s"}}>
                      <Icon name="subs" size={14}/>
                      Reset defaults
                    </button>
                    <button className="menu-row" disabled={exportingData} onClick={async()=>{
                      setExportingData(true);setExportDataError(null);
                      const r = await exportUserDataExcel();
                      setExportingData(false);
                      if(!r.ok) setExportDataError(r.error||"Couldn't export your data. Please try again.");
                      else setSettingsOpen(false);
                    }} style={{display:"flex",alignItems:"center",gap:9,width:"100%",padding:"8px 10px",borderRadius:8,border:"none",background:"transparent",color:C.text,fontSize:12,fontWeight:500,cursor:exportingData?"default":"pointer",textAlign:"left",transition:"background .15s",opacity:exportingData?0.6:1}}>
                      <Icon name="live" size={14}/>
                      {exportingData?"Exporting…":"Export my data"}
                    </button>
                    {exportDataError && <div role="alert" style={{padding:"0 10px 6px",fontSize:11,color:C.danger}}>{exportDataError}</div>}
                    <button className="menu-row txt-act" disabled={exportingRaw} onClick={async()=>{
                      setExportingRaw(true);setExportDataError(null);
                      const r = await exportUserData();
                      setExportingRaw(false);
                      if(!r.ok) setExportDataError(r.error||"Couldn't export your data. Please try again.");
                      else setSettingsOpen(false);
                    }} style={{display:"block",width:"100%",padding:"0 10px 6px",border:"none",background:"transparent",color:C.gray,fontSize:10.5,fontWeight:500,cursor:exportingRaw?"default":"pointer",textAlign:"left",textDecoration:"underline",opacity:exportingRaw?0.6:1}}>
                      {exportingRaw?"Exporting…":"Download raw data (JSON)"}
                    </button>
                    <button className="menu-row" onClick={()=>{setSettingsOpen(false);setDeleteConfirmText("");setDeleteAccountError(null);setConfirmDeleteAccount(true);}} style={{display:"flex",alignItems:"center",gap:9,width:"100%",padding:"8px 10px",borderRadius:8,border:"none",background:"transparent",color:C.danger,fontSize:12,fontWeight:500,cursor:"pointer",textAlign:"left",transition:"background .15s"}}>
                      <Icon name="subs" size={14}/>
                      Delete my account
                    </button>
                  </div>
                  {/* Footer — legal + sign out */}
                  <div style={{borderTop:`1px solid ${C.border}`,padding:"4px 0 2px"}}>
                    <div style={{display:"flex",gap:0,padding:"4px 10px 6px"}}>
                      <a href="/terms.html" target="_blank" rel="noopener" style={{fontSize:10.5,color:C.gray,textDecoration:"none",borderBottom:`1px solid ${C.border}`}}>Terms</a>
                      <span style={{fontSize:10.5,color:C.border,padding:"0 5px"}}>·</span>
                      <a href="/privacy.html" target="_blank" rel="noopener" style={{fontSize:10.5,color:C.gray,textDecoration:"none",borderBottom:`1px solid ${C.border}`}}>Privacy</a>
                    </div>
                    <button className="menu-row" onClick={async()=>{setSettingsOpen(false);logEvent('sign_out', {});const sb=await getSupabase();sb.auth.signOut();}} style={{display:"flex",alignItems:"center",gap:9,width:"100%",padding:"8px 10px",borderRadius:8,border:"none",background:"transparent",color:C.text,fontSize:12,fontWeight:600,cursor:"pointer",textAlign:"left",transition:"background .15s"}}>
                      <Icon name="live" size={14}/>
                      Sign out
                    </button>
                  </div>
                </div>
              </>}
            </div>
          </div>
        </div>
        );
      })()}

      {/* ── Offline banner ── */}
      {syncStatus==="offline" && (
        <Banner type="warn">
          <strong>You're offline</strong> — your changes are saved on this device and will sync automatically when you reconnect.
        </Banner>
      )}

      {/* ── Conflict modal ── */}
      <BlobHealth over={moSurplus<0} bloom={bloom}/>
      {pendingConflict && <ConflictModal pending={pendingConflict} data={data} onResolve={resolveConflict}/>}
      {profile && !profile.school && <OnboardingFlow uid={session.user.id} user={session.user} data={data} upd={upd} onDone={s=>setProfile({school:s})}/>}
      {/* Existing users who finished onboarding but are behind on a newer setup question */}
      {profile && profile.school && (data.setupVersion||0) < SETUP_VERSION && <ProgressiveSetup data={data} upd={upd}/>}
      {editSchool && <ProfileModal uid={session.user.id} onSaved={s=>{setProfile({school:s});setEditSchool(false);}} onClose={()=>setEditSchool(false)}/>}
      {editProgram && <ProgramModal data={data} upd={upd} school={profile.school} onClose={()=>setEditProgram(false)}/>}
      {editAvatar && <AvatarModal data={data} upd={upd} user={session.user} onClose={()=>setEditAvatar(false)}/>}

      {/* ── Renewal alerts ── */}
      {renewalsDue.map(s=>(
        <Banner key={s.id} type="warn" onClose={()=>{let d=JSON.parse(JSON.stringify(data));d.subscriptions=d.subscriptions.map(x=>x.id===s.id?{...x,renewalPrompted:true}:x);upd(d);}}>
          <strong>{s.name}</strong> renewal date has passed.{" "}
          <button className="btn-fill" onClick={()=>setRenewDlg(s)} style={{background:C.amber,color:"#fff",border:"none",borderRadius:8,padding:"2px 10px",cursor:"pointer",fontSize:11,fontWeight:600,marginLeft:6}}>Handle renewal</button>
        </Banner>
      ))}
      {renewalsSoon.filter(s=>!dismissed["rsu_"+s.id]).map(s=>(
        <Banner key={s.id} type="info" onClose={()=>dismiss("rsu_"+s.id)}>
          <strong>{s.name}</strong> renews in {daysUntil(s.renewal)} days on {s.renewal} — {fmtD(s.amount)}/{s.cycle}
        </Banner>
      ))}

      {/* ── Year selector — one segmented glass pill; active year's range shown once ── */}
      <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:16,flexWrap:"wrap"}}>
        <ChoiceGroup role="radiogroup" ariaLabel="Academic year" className="tabbar" style={{
          display:"flex", gap:2, padding:"4px", overflowX:"auto", maxWidth:"100%",
          background:C.glassCard,
          backdropFilter:"blur(40px) saturate(180%)",
          WebkitBackdropFilter:"blur(24px) saturate(150%)",
          border:"1px solid rgba(255,255,255,0.14)",
          borderRadius:32,
          boxShadow:"0 2px 16px rgba(0,0,0,0.18), inset 0 1px 0 rgba(255,255,255,0.10)",
        }}>
          {data.years.map(y=><YrBtn key={y.id} yr={y} active={ay===y.id} onClick={()=>setAy(y.id)}/>)}
        </ChoiceGroup>
        <span style={{fontSize:11,color:C.gray,whiteSpace:"nowrap"}}>{yrRangeLabel(data.years.find(y=>y.id===ay))}</span>
      </div>

      {/* ── Top metrics — slimmed to 3 (Phase 1); runway & debt fill in with Phase 2's loan model ── */}
      <div style={{display:"flex",gap:10,marginBottom:20,flexWrap:"wrap"}}>
        <MetricTile label="Runway"        value="—" sub="coming in Phase 2" color={C.gray}/>
        <MetricTile label="Monthly plan"  value={fmt(moSpend)} sub={subsMo>0?`incl. ${fmtA(subsMo)} fixed costs`:"planned spending"}/>
        <MetricTile label="Debt"          value="—" sub="coming in Phase 2" color={C.gray}/>
      </div>

      {/* ── Tabs — Weekly/Charts/Savings/Subscriptions/Categories hidden behind featureFlags.HIDDEN_TABS
           (Phase 1 simplification: code + data stay, just no entry point). Categories moved into
           Settings; Subscriptions folded into Budget as a "Fixed monthly costs" line. ── */}
      <ChoiceGroup role="tablist" ariaLabel="Sections" className="tabbar" style={{
        display:"flex", marginBottom:24, overflowX:"auto", gap:2, padding:"4px",
        width:"fit-content", maxWidth:"100%",
        background:C.glassCard,
        backdropFilter:"blur(40px) saturate(180%)",
        WebkitBackdropFilter:"blur(24px) saturate(150%)",
        border:"1px solid rgba(255,255,255,0.14)",
        borderRadius:32,
        boxShadow:"0 2px 16px rgba(0,0,0,0.18), inset 0 1px 0 rgba(255,255,255,0.10)",
      }}>
        {[
          ["budget","Budget"],
          ["weekly","Weekly"],
          ["charts","Charts"],
          ["savings","Savings"],
          ["aid","Aid & Detail",0],
          ["subscriptions","Subscriptions",renewalsDue.length],
          ["customize","Categories"],
        ].filter(([id])=>!HIDDEN_TABS[id]).map(([id,lbl,badge])=><TabBtn key={id} id={id} label={lbl} active={tab===id} onClick={()=>setTab(id)} badge={badge||0}/>)}
      </ChoiceGroup>

      {/* Lazy tab chunks resolve near-instantly after first load (small, cached);
          a minimal inline fallback avoids a full-screen flash on tab switch and
          keeps layout stable. role=status announces the brief load to AT. */}
      <React.Suspense fallback={<div role="status" aria-live="polite" style={{minHeight:200,display:"flex",alignItems:"center",justifyContent:"center",color:"var(--text-dim)",fontSize:14}}>Loading…</div>}>
        {/* ══════════════ BUDGET ══════════════ */}
        {tab==="budget" && <BudgetTab/>}

        {/* ══════════════ WEEKLY ══════════════ */}
        {tab==="weekly" && <WeeklyTab/>}

        {/* ══════════════ CHARTS ══════════════ */}
        {tab==="charts" && <ChartsTab/>}

        {/* ══════════════ SAVINGS ══════════════ */}
        {tab==="savings" && <SavingsTab/>}

        {/* ══════════════ AID & DETAIL ══════════════ */}
        {tab==="aid" && <AidTab/>}

        {/* ══════════════ SUBSCRIPTIONS ══════════════ */}
        {tab==="subscriptions" && <SubscriptionsTab/>}

        {/* ══════════════ CUSTOMIZE ══════════════ */}
        {tab==="customize" && <CustomizeTab/>}
      </React.Suspense>
    </div>
    </AppContext.Provider>
  );
}

// SilentUpdater lives in its own module now — src/SilentUpdater.jsx — so that
// main.jsx can render it without dragging in App.jsx's full module graph on
// the logged-out landing path. Re-exported here for any internal callers.
export { SilentUpdater } from './SilentUpdater.jsx';
