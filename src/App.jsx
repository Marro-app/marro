import React, { useState, useEffect, useCallback } from 'react';
import * as Recharts from 'recharts';
const{PieChart,Pie,Cell,BarChart,Bar,XAxis,YAxis,Tooltip,ResponsiveContainer,LineChart,Line,AreaChart,Area,Legend,ReferenceLine,ComposedChart}=Recharts;
import { useRegisterSW } from 'virtual:pwa-register/react';
import { C, CHART_COLORS, applyTheme, tipProps, THEMES } from './lib/theme.js';
import { sb, stateFetch, stateWrite, diffStates, findConflicts, applyChanges, MONEY_KEYS, fmtConflictVal, conflictLabel, SYNC_BASE_KEY } from './lib/data.js';
import { fmt, fmtS, fmtD, fmtDay, fmtA, fmtSA, moTotal, todayStr, getMonday, getSunday, fmtWeekLabel, daysUntil, subMonthlyTotal, getYearMonthStr, yr2, BLANK_MONTHLY, blankYearFields, generateYearConfigs, DEFAULT_CATS, MONTH_NAMES, MONTH_FULL, SETUP_VERSION, DEFAULT_STATE } from './lib/format.js';
import { BRANDS, BRAND_DOMAINS, getBrandDomain, getBrand } from './lib/brands.js';
import { US_MED_SCHOOLS, degreeForSchool, DO_DUAL, dualOptionsForSchool } from './lib/schools.js';
import { AV_PALETTE, avColor, AVATARS, AV_GROUPS } from './lib/avatars.js';
import { popoverStyle, wrapPop, edgeFadeClass, radioProps, tabProps, yrRangeLabel } from './lib/ui-helpers.js';
import { useLiftCard, useEscClose, useEdgeFade } from './lib/hooks.js';
import { BrandIcon, Icon, CatIcon, CatIconPicker, MarroLogo, GoogleGlyph } from './components/icons.jsx';
import { Pill, XBtn, Card, SectionTitle, ChoiceGroup, Stepper, ScrollX, TabBtn, YrBtn, Banner, Modal, InfoTip, Divider, MetricTile, ProgressBar, RingProgress, BlobHealth, EmptyState } from './components/primitives.jsx';
import { MonthPicker, PeriodPicker, DateField } from './components/pickers.jsx';
import { AvatarArt, Avatar, AvatarPicker } from './components/avatars.jsx';
import { LoginScreen } from './components/LoginScreen.jsx';
import { ProgramModal, ProfileModal, AvatarModal, MarroIntro, OnboardingFlow, ProgressiveSetup } from './components/onboarding.jsx';
import { RenewalDialog, WeekSelectorModal, ConflictModal } from './components/modals.jsx';

export function App() {
  const [tab, setTab]           = useState("budget");
  const [ay,  setAy]            = useState(0);
  const [data, setData]         = useState(null);
  const [ready, setReady]       = useState(false);
  const [flash, setFlash]       = useState(false);
  const [dismissed, setDismissed] = useState({});
  const [syncStatus, setSyncStatus] = useState(null); // null|"syncing"|"synced"|"offline"|"conflict"
  const [pendingConflict, setPendingConflict] = useState(null);
  const [session, setSession] = useState(undefined); // undefined=restoring, null=logged out, obj=logged in
  const [profile, setProfile] = useState(null);      // {school} | null (no row yet → ProfileModal)
  const [editSchool, setEditSchool] = useState(false); // settings → reopen ProfileModal to change school
  const [editProgram, setEditProgram] = useState(false); // settings → edit program track (ProgramModal)
  const [editName, setEditName] = useState(false); // settings → inline name editor
  const [editAvatar, setEditAvatar] = useState(false); // settings → avatar editor modal
  const gistTimerRef = React.useRef(null);
  const dataRef = React.useRef(null);
  const lastFocusRef = React.useRef(0);
  useEffect(()=>{ dataRef.current=data; },[data]);

  // Subscription form
  const [subName, setSubName]   = useState("");
  const [subAmt, setSubAmt]     = useState("");
  const [subCycle, setSubCycle] = useState("monthly");
  const [subRenew, setSubRenew] = useState("");
  const [subEdit, setSubEdit]   = useState(null);
  const [renewDlg, setRenewDlg] = useState(null);

  // Weekly
  const [wCat, setWCat]     = useState("");
  const [wAmt, setWAmt]     = useState("");
  const [wNote, setWNote]   = useState("");
  const [wDate, setWDate]   = useState(todayStr());
  const [viewWeek, setViewWeek]     = useState(null);
  const [showWeekPicker, setShowWeekPicker] = useState(false);

  // Cat form
  const [newCatName, setNewCatName] = useState("");
  const [newCatIcon, setNewCatIcon] = useState("dot");
  const [iconPickOpen, setIconPickOpen] = useState(false);   // collapsed icon grid in add flows
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [editIconCat, setEditIconCat] = useState(null);      // category id whose icon popover is open

  // Month selector (0=Aug, 11=Jul for academic year)
  const [selMonth, setSelMonth] = useState((new Date().getMonth() - 7 + 12) % 12);
  const [pieMonthStart, setPieMonthStart] = useState((new Date().getMonth() - 7 + 12) % 12);
  const [pieHover, setPieHover] = useState(null);
  // Bar-chart hover: "<chartKey>:<index>" — hovered group stays full, siblings soften (no cursor box)
  const [barHover, setBarHover] = useState(null);
  const barDim = (key,i) => barHover && barHover.startsWith(key+":") && barHover!==key+":"+i ? 0.35 : 1;
  const barMove = key => s => setBarHover(s && s.isTooltipActive && s.activeTooltipIndex!=null ? key+":"+s.activeTooltipIndex : null);
  const [pieMonthEnd, setPieMonthEnd] = useState(null);
  const [piePickerOpen, setPiePickerOpen] = useState(false);
  const [showCsvImport, setShowCsvImport] = useState(false);
  // Esc closes the chromeless popovers (settings menu, pie range picker, category icon picker)
  useEscClose(settingsOpen, ()=>setSettingsOpen(false));
  useEscClose(piePickerOpen, ()=>setPiePickerOpen(false));
  useEscClose(editIconCat!==null, ()=>setEditIconCat(null));
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
  const [csvText, setCsvText] = useState("");
  const [csvRows, setCsvRows] = useState(null);
  const [csvError, setCsvError] = useState(null);


  // Add category modal
  const [showAddCat, setShowAddCat] = useState(false);
  const [showAddYear, setShowAddYear] = useState(false);
  const [confirmYearRemove, setConfirmYearRemove] = useState(null);
  const [yearUndo, setYearUndo] = useState(null); // last soft-deleted year, for the Undo toast
  useEffect(()=>{ if(!yearUndo) return; const t=setTimeout(()=>setYearUndo(null),8000); return ()=>clearTimeout(t); },[yearUndo]);
  const [confirmReset, setConfirmReset] = useState(false);
  const [dragCat, setDragCat] = useState(null);
  const [dragOverCat, setDragOverCat] = useState(null);
  const [weeklyNotice, setWeeklyNotice] = useState(null);
  const [nyStart, setNyStart] = useState("");
  const [nyEnd, setNyEnd] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(null);  // catId to confirm removal

  // Savings tab state
  const [savingsDepositGoal, setSavingsDepositGoal] = useState(null);
  const [savingsDepositAmt,  setSavingsDepositAmt]  = useState("");
  const [savingsDepositNote, setSavingsDepositNote] = useState("");
  const [savingsDepositDate, setSavingsDepositDate] = useState(todayStr());
  const [showAddSavingsGoal, setShowAddSavingsGoal] = useState(false);
  const [newGoalLabel,       setNewGoalLabel]       = useState("");
  const [newGoalTarget,      setNewGoalTarget]      = useState("");
  const [newGoalDate,        setNewGoalDate]        = useState("");
  const [newGoalMonthly,     setNewGoalMonthly]     = useState("");
  const [savingsApy,         setSavingsApy]         = useState("4.5");
  const [trendCats,          setTrendCats]          = useState(null); // null = use default top-4
  const [compareA,           setCompareA]           = useState(null); // {type:"month"|"year", ay, mi}
  const [compareB,           setCompareB]           = useState(null);

  // Auth: restore session on boot + listen for sign-in/out across tabs.
  useEffect(()=>{
    sb.auth.getSession().then(({data})=>setSession(data.session ?? null));
    const {data:{subscription}} = sb.auth.onAuthStateChange((evt, s)=>{
      setSession(s ?? null);
      if(evt==="SIGNED_OUT"){
        localStorage.removeItem("marro_v8");
        localStorage.removeItem(SYNC_BASE_KEY);
        localStorage.removeItem("marro_uid");
        setData(null); setProfile(null); setReady(false); setSyncStatus(null);
      }
    });
    return ()=>subscription.unsubscribe();
  },[]);

  // Load — gated on auth. Runs once a session is known; bails while restoring or
  // when signed out (LoginScreen handles that via the render gate).
  useEffect(()=>{
    if(session===undefined) return;   // still restoring
    if(!session){ return; }           // signed out → LoginScreen
    (async()=>{
      try{
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
  if(session===null) return <LoginScreen offline={!navigator.onLine}/>;
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

  const saveSub = () => {
    if(!subName.trim()||!subAmt) return;
    let d = JSON.parse(JSON.stringify(data));
    if(subEdit){
      d.subscriptions=d.subscriptions.map(s=>s.id===subEdit?{...s,name:subName,amount:parseFloat(subAmt)||0,cycle:subCycle,renewal:subRenew,renewalPrompted:false}:s);
      setSubEdit(null);
    } else {
      d.subscriptions.push({id:"s_"+Date.now(),name:subName.trim(),amount:parseFloat(subAmt)||0,cycle:subCycle,renewal:subRenew,active:true,renewalPrompted:false});
    }
    d=syncSubs(d); upd(d);
    setSubName("");setSubAmt("");setSubCycle("monthly");setSubRenew("");
  };

  const delSub = sid => { let d=JSON.parse(JSON.stringify(data));d.subscriptions=d.subscriptions.filter(s=>s.id!==sid);d=syncSubs(d);upd(d); };
  const editSub = s => { setSubEdit(s.id);setSubName(s.name);setSubAmt(String(s.amount));setSubCycle(s.cycle);setSubRenew(s.renewal||""); };

  const handleRenewal = (sub,renewed,newAmt,newDate) => {
    let d=JSON.parse(JSON.stringify(data));
    if(!renewed) d.subscriptions=d.subscriptions.filter(s=>s.id!==sub.id);
    else d.subscriptions=d.subscriptions.map(s=>s.id===sub.id?{...s,amount:parseFloat(newAmt)||s.amount,renewal:newDate||"",renewalPrompted:true,active:true}:s);
    d=syncSubs(d);upd(d);setRenewDlg(null);
  };

  const addEntry = () => {
    if(!wCat||!wAmt) return;
    const entryWeek = getMonday(wDate);
    const thisWeek  = getMonday(new Date());
    const amtNum = parseFloat(wAmt)||0;
    const entry = {id:"e_"+Date.now(),catId:wCat,amount:amtNum,note:wNote,date:wDate};
    let d = JSON.parse(JSON.stringify(data));
    if(!d.currentWeekEntries) d.currentWeekEntries=[];
    if(!d.weeklyArchive) d.weeklyArchive=[];

    const eMonthIdx = (new Date(wDate+"T12:00:00").getMonth() - 7 + 12) % 12;
    const mk = ay+"-"+MONTH_NAMES[eMonthIdx];
    const catObj = cats.find(c=>c.id===wCat);
    const isUnbudgeted = d.monthDisabled?.[mk]?.includes(wCat) && wCat!=="subs";

    if(entryWeek !== thisWeek) {
      // past OR future week — file to correct archive slot
      const ex = d.weeklyArchive.find(a=>a.weekStart===entryWeek);
      if(ex){ex.entries.push(entry);ex.total=ex.entries.reduce((a,e)=>a+Number(e.amount),0);}
      else d.weeklyArchive.push({weekStart:entryWeek,weekEnd:getSunday(entryWeek),entries:[entry],total:entry.amount});
      setViewWeek(entryWeek);
    } else {
      d.currentWeekEntries.push(entry);
      setViewWeek(null);
    }
    // Exams spending is an actual contribution to the Step fund — credit the first
    // unfunded Step goal, overflowing into the next once one is full. Links each
    // credit to this weekly entry so deleting either side stays in sync.
    if(wCat==="exams"){
      if(!d.savingsLog) d.savingsLog=[];
      let remainingAmt=amtNum;
      (d.stepGoals||[]).forEach((g,gi)=>{
        if(remainingAmt<=0) return;
        const room=Math.max(0,(g.targetAmount||0)-(g.saved||0));
        const credit=Math.min(room,remainingAmt);
        if(credit<=0) return;
        d.stepGoals[gi].saved=(d.stepGoals[gi].saved||0)+credit;
        d.savingsLog.push({id:"sl_"+Date.now()+"_"+gi,goalId:g.id,amount:credit,date:wDate,note:(wNote||"From weekly log"),weeklyEntryId:entry.id,budgetAdded:null});
        remainingAmt-=credit;
      });
    }
    upd(d);setWAmt("");setWNote("");

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
    if(deficit>0){
      setWeeklyNotice({type:"warn", cat:isUnbudgeted?(catObj?.label):null, month:MONTH_FULL[eMonthIdx], deficit});
    } else if(isUnbudgeted){
      setWeeklyNotice({type:"info", cat:catObj?.label, month:MONTH_FULL[eMonthIdx]});
    }
  };
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

  const delEntry = (eid, isArchived) => {
    let d = JSON.parse(JSON.stringify(data));
    // If this weekly entry is linked to savings deposits/contributions, reverse them all
    const linkedSls=(d.savingsLog||[]).filter(s=>s.weeklyEntryId===eid);
    if(linkedSls.length){
      linkedSls.forEach(sl=>reverseDeposit(d, sl));
      upd(d); return;
    }
    if(isArchived){
      d.weeklyArchive=d.weeklyArchive.map(a=>{
        const ents=a.entries.filter(e=>e.id!==eid);
        return {...a,entries:ents,total:ents.reduce((s,e)=>s+Number(e.amount),0)};
      });
    } else {
      d.currentWeekEntries=d.currentWeekEntries.filter(e=>e.id!==eid);
    }
    upd(d);
  };

  const addCat = () => {
    if(!newCatName.trim()) return;
    const id="cat_"+Date.now();
    const d=JSON.parse(JSON.stringify(data));
    d.categories.push({id,label:newCatName.trim(),...(newCatIcon&&newCatIcon!=="dot"?{icon:newCatIcon}:{})});
    d.years.forEach(y=>{y.monthly[id]=0;});
    upd(d);setNewCatName("");setNewCatIcon("dot");
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

  const isPastWeekDate = wDate && getMonday(wDate) < getMonday(new Date());
  const isFutureWeekDate = wDate && getMonday(wDate) > getMonday(new Date());
  const isOtherWeekDate = isPastWeekDate || isFutureWeekDate;

  return (
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
      {renewDlg && <RenewalDialog sub={renewDlg} onClose={()=>setRenewDlg(null)} onConfirm={handleRenewal}/>}
      {weeklyNotice && weeklyNotice.type==="warn" && <Modal title={weeklyNotice.month+" is over budget"} onClose={()=>setWeeklyNotice(null)} width={360}>
        <div style={{fontSize:13,color:C.textMid,marginBottom:16,lineHeight:1.6}}>
          {weeklyNotice.month} is now <strong style={{color:C.neg}}>{fmt(weeklyNotice.deficit)}</strong> over your monthly income{weeklyNotice.cat?<>, after logging <strong>{weeklyNotice.cat}</strong></>:""}. This lowers your running balance and year-end net. Consider trimming a category or adjusting your budget.
        </div>
        <button className="btn-fill" onClick={()=>setWeeklyNotice(null)} style={{width:"100%",padding:"10px",fontSize:13,fontWeight:600,border:"none",borderRadius:8,background:C.neg,color:C.bg,cursor:"pointer"}}>Got it</button>
      </Modal>}
      {confirmReset && <Modal title="Reset everything?" onClose={()=>setConfirmReset(false)} width={350}>
        <div style={{fontSize:13,color:C.textMid,marginBottom:16,lineHeight:1.6}}>This replaces <strong>all</strong> of your budget, weekly entries, savings, and subscriptions with the starting defaults. This cannot be undone.</div>
        <div style={{display:"flex",gap:8}}>
          <button className="btn-fill" onClick={()=>setConfirmReset(false)} style={{flex:1.4,padding:"10px",fontSize:13,fontWeight:600,border:"none",borderRadius:8,background:C.creamSoft,color:C.text,cursor:"pointer"}}>Cancel</button>
          <button className="btn-fill" onClick={()=>{upd(JSON.parse(JSON.stringify(DEFAULT_STATE)));setConfirmReset(false);}} style={{flex:1,padding:"10px",fontSize:13,fontWeight:600,border:`1px solid ${C.dangerMid}`,borderRadius:8,background:C.dangerLight,color:C.danger,cursor:"pointer"}}>Reset everything</button>
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
      {confirmRemove && <Modal title="Remove category" onClose={()=>setConfirmRemove(null)} width={340}>
        <div style={{fontSize:13,color:C.textMid,marginBottom:16}}>Remove <strong>{cats.find(c=>c.id===confirmRemove)?.label}</strong> from {MONTH_FULL[selMonth]}? You can add it back anytime.</div>
        <div style={{display:"flex",gap:8}}>
          <button className="btn-pop" onClick={()=>setConfirmRemove(null)} style={{flex:1,padding:"10px",fontSize:13,fontWeight:500,border:`1px solid ${C.border}`,borderRadius:8,background:"transparent",color:C.gray,cursor:"pointer"}}>Cancel</button>
          <button className="btn-fill" onClick={()=>{toggleMonthCat(confirmRemove);setConfirmRemove(null);}} style={{flex:1,padding:"10px",fontSize:13,fontWeight:600,border:"none",borderRadius:8,background:C.danger,color:C.bg,cursor:"pointer"}}>Remove</button>
        </div>
      </Modal>}
      {showAddCat && <Modal title={"Add category — "+MONTH_FULL[selMonth]} onClose={()=>setShowAddCat(false)} width={380}>
        {disabledCats.length>0 && <>
          <div style={{fontSize:12,fontWeight:600,color:C.textMid,marginBottom:8}}>Removed from this month</div>
          <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:16}}>
            {disabledCats.map(cid=>{const c=cats.find(x=>x.id===cid);return c?<button key={cid} onClick={()=>{toggleMonthCat(cid);setShowAddCat(false);}} style={{padding:"10px 14px",fontSize:13,fontWeight:500,border:`1px solid ${C.border}`,borderRadius:8,background:C.bg,color:C.text,cursor:"pointer",textAlign:"left"}}>{c.label}</button>:null;})}
          </div>
        </>}
        <div style={{fontSize:12,fontWeight:600,color:C.textMid,marginBottom:8}}>Create new category</div>
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          <div style={{display:"flex",gap:8}}>
            <button className="btn-pop" type="button" onClick={()=>setIconPickOpen(o=>!o)} title="Choose icon" aria-expanded={iconPickOpen} style={{width:36,height:36,borderRadius:8,display:"inline-flex",alignItems:"center",justifyContent:"center",flexShrink:0,border:`1px solid ${iconPickOpen?C.sel:C.border}`,background:iconPickOpen?C.selBg:"transparent",color:C.text,cursor:"pointer",transition:"all .15s"}}>
              <Icon name={newCatIcon} size={16} strokeWidth={1.5}/>
            </button>
            <input placeholder="Category name" value={newCatName} onChange={e=>setNewCatName(e.target.value)} style={{flex:1,fontSize:13,border:`1px solid ${C.border}`,borderRadius:8,padding:"8px 12px",background:C.bg,color:C.text}}/>
            <button className="btn-fill" onClick={()=>{if(newCatName.trim()){addCat();setShowAddCat(false);setIconPickOpen(false);}}} disabled={!newCatName.trim()} style={{padding:"8px 16px",fontSize:13,fontWeight:600,border:"none",borderRadius:8,background:!newCatName.trim()?C.surface:C.teal,color:!newCatName.trim()?C.gray:C.bg,cursor:!newCatName.trim()?"not-allowed":"pointer"}}>Add</button>
          </div>
          {iconPickOpen && <CatIconPicker value={newCatIcon} onChange={v=>{setNewCatIcon(v);setIconPickOpen(false);}}/>}
        </div>
      </Modal>}
      {showWeekPicker && <WeekSelectorModal archives={archives} currentWeekStart={currentWeekStart} currentWeekEnd={currentWeekEnd} selected={viewWeek} onSelect={setViewWeek} onClose={()=>setShowWeekPicker(false)}/>}

      {savingsDepositGoal && (()=>{
        const allGoals=[...(data.stepGoals||[]),...(data.savingsGoals||[])];
        const g=allGoals.find(x=>x.id===savingsDepositGoal);
        return g ? (
          <Modal title={"Log deposit — "+g.label} onClose={()=>{setSavingsDepositGoal(null);setSavingsDepositAmt("");setSavingsDepositNote("");setSavingsDepositDate(todayStr());}} width={340}>
            <div style={{display:"flex",flexDirection:"column",gap:10}}>
              <div>
                <div style={{fontSize:11,color:C.gray,marginBottom:4,fontWeight:500}}>Amount ($)</div>
                <input type="number" placeholder="50.00" value={savingsDepositAmt} onChange={e=>setSavingsDepositAmt(e.target.value)} style={{width:"100%",fontSize:13,border:`1px solid ${C.border}`,borderRadius:8,padding:"8px 10px",background:C.bg,color:C.text,boxSizing:"border-box"}}/>
              </div>
              <div>
                <div style={{fontSize:11,color:C.gray,marginBottom:4,fontWeight:500}}>Date</div>
                <DateField value={savingsDepositDate} onChange={setSavingsDepositDate} ariaLabel="Deposit date"/>
              </div>
              <div>
                <div style={{fontSize:11,color:C.gray,marginBottom:4,fontWeight:500}}>Note (optional)</div>
                <input type="text" placeholder="e.g. August savings" value={savingsDepositNote} onChange={e=>setSavingsDepositNote(e.target.value)} style={{width:"100%",fontSize:13,border:`1px solid ${C.border}`,borderRadius:8,padding:"8px 10px",background:C.bg,color:C.text,boxSizing:"border-box"}}/>
              </div>
              <button className="btn-fill" onClick={()=>{
                const amt=parseFloat(savingsDepositAmt)||0;
                if(!amt) return;
                const d=JSON.parse(JSON.stringify(data));
                const inStep=d.stepGoals.findIndex(x=>x.id===savingsDepositGoal);
                const inCustom=d.savingsGoals.findIndex(x=>x.id===savingsDepositGoal);
                const depGoal = inStep>=0 ? d.stepGoals[inStep] : inCustom>=0 ? d.savingsGoals[inCustom] : null;
                const wasFunded = depGoal ? (depGoal.saved||0) >= depGoal.targetAmount : false;
                if(inStep>=0) d.stepGoals[inStep].saved=Math.max(0,(d.stepGoals[inStep].saved||0)+amt);
                else if(inCustom>=0) d.savingsGoals[inCustom].saved=Math.max(0,(d.savingsGoals[inCustom].saved||0)+amt);
                // Milestone bloom: this deposit just fully funded the goal
                if(depGoal && !wasFunded && (depGoal.saved||0) >= depGoal.targetAmount) triggerBloom();

                // Wire deposit into weekly + budget, with a bidirectional link
                const stamp=Date.now();
                const slId="sl_"+stamp;
                const weeklyEntryId="e_"+stamp;
                const catId = inStep>=0 ? "exams" : "savings";
                const depDate = new Date(savingsDepositDate+"T12:00:00");
                const depAcadMonth = (depDate.getMonth()-7+12)%12;
                const depMonthName = MONTH_NAMES[depAcadMonth];
                // Find which year config covers the deposit date
                const depYrIdx = d.years.findIndex(y=>{
                  if(!y.startDate||!y.endDate) return false;
                  return savingsDepositDate>=y.startDate && savingsDepositDate<=y.endDate;
                });
                const depAy = depYrIdx>=0 ? depYrIdx : ay;
                const depYr = d.years[depAy];
                // Always add a weekly entry so deposit appears in Budget/Weekly actuals
                const entry={id:weeklyEntryId,catId,amount:amt,note:(savingsDepositNote||"Savings deposit"),date:savingsDepositDate,depositId:slId};
                if(!d.currentWeekEntries) d.currentWeekEntries=[];
                if(!d.weeklyArchive) d.weeklyArchive=[];
                const entryWeek=getMonday(savingsDepositDate);
                const thisWeek=getMonday(new Date());
                if(entryWeek<thisWeek){
                  const ex=d.weeklyArchive.find(a=>a.weekStart===entryWeek);
                  if(ex){ex.entries.push(entry);ex.total=ex.entries.reduce((a,e)=>a+Number(e.amount),0);}
                  else d.weeklyArchive.push({weekStart:entryWeek,weekEnd:getSunday(entryWeek),entries:[entry],total:entry.amount});
                } else {
                  d.currentWeekEntries.push(entry);
                }
                // Auto-manage the budget override only when there is no manual base budget.
                // If there IS a base monthly rate the user set it intentionally — leave it alone.
                // When auto-managing, always increment so multiple deposits in the same month
                // stack correctly; deletions then decrement by the same delta.
                if(!depYr.monthlyOverrides) depYr.monthlyOverrides={};
                if(!depYr.monthlyOverrides[depMonthName]) depYr.monthlyOverrides[depMonthName]={};
                const baseBudget = Number(depYr.monthly[catId])||0;
                let budgetAdded=null;
                if(!baseBudget) {
                  const curOverride = depYr.monthlyOverrides[depMonthName][catId]||0;
                  depYr.monthlyOverrides[depMonthName][catId] = curOverride + amt;
                  budgetAdded={ay:depAy,monthName:depMonthName,catId,amount:amt};
                  // Remove from disabled cats for that month if present (first deposit enables it)
                  const mk=depAy+"-"+depMonthName;
                  if(d.monthDisabled?.[mk]) d.monthDisabled[mk]=d.monthDisabled[mk].filter(c=>c!==catId);
                }

                if(!d.savingsLog) d.savingsLog=[];
                d.savingsLog.push({id:slId,goalId:savingsDepositGoal,amount:amt,date:savingsDepositDate,note:savingsDepositNote,weeklyEntryId,budgetAdded});

                upd(d);
                setSavingsDepositGoal(null);setSavingsDepositAmt("");setSavingsDepositNote("");setSavingsDepositDate(todayStr());
              }} disabled={!(parseFloat(savingsDepositAmt)>0)} style={{padding:"10px",fontSize:13,fontWeight:600,border:"none",borderRadius:8,background:!(parseFloat(savingsDepositAmt)>0)?C.surface:C.teal,color:!(parseFloat(savingsDepositAmt)>0)?C.gray:C.bg,cursor:!(parseFloat(savingsDepositAmt)>0)?"not-allowed":"pointer",marginTop:4}}>
                Confirm deposit
              </button>
            </div>
          </Modal>
        ) : null;
      })()}

      {showAddSavingsGoal && (
        <Modal title="Add savings goal" onClose={()=>{setShowAddSavingsGoal(false);setNewGoalLabel("");setNewGoalTarget("");setNewGoalDate("");setNewGoalMonthly("");}} width={360}>
          <div style={{display:"flex",flexDirection:"column",gap:10}}>
            <div>
              <div style={{fontSize:11,color:C.gray,marginBottom:4,fontWeight:500}}>Goal name</div>
              <input placeholder="e.g. Emergency fund, Laptop" value={newGoalLabel} onChange={e=>setNewGoalLabel(e.target.value)} style={{width:"100%",fontSize:13,border:`1px solid ${C.border}`,borderRadius:8,padding:"8px 10px",background:C.bg,color:C.text,boxSizing:"border-box"}}/>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
              <div>
                <div style={{fontSize:11,color:C.gray,marginBottom:4,fontWeight:500}}>Target amount ($)</div>
                <input type="number" placeholder="1000" value={newGoalTarget} onChange={e=>setNewGoalTarget(e.target.value)} style={{width:"100%",fontSize:13,border:`1px solid ${C.border}`,borderRadius:8,padding:"8px 10px",background:C.bg,color:C.text,boxSizing:"border-box"}}/>
              </div>
              <div>
                <div style={{fontSize:11,color:C.gray,marginBottom:4,fontWeight:500}}>Monthly contribution ($)</div>
                <input type="number" placeholder="50" value={newGoalMonthly} onChange={e=>setNewGoalMonthly(e.target.value)} style={{width:"100%",fontSize:13,border:`1px solid ${C.border}`,borderRadius:8,padding:"8px 10px",background:C.bg,color:C.text,boxSizing:"border-box"}}/>
              </div>
            </div>
            <div>
              <div style={{fontSize:11,color:C.gray,marginBottom:4,fontWeight:500}}>Target date (optional)</div>
              <DateField value={newGoalDate} onChange={setNewGoalDate} ariaLabel="Goal target date"/>
            </div>
            <button className="btn-fill" onClick={()=>{
              if(!newGoalLabel.trim()||!newGoalTarget) return;
              const d=JSON.parse(JSON.stringify(data));
              d.savingsGoals.push({id:"sg_"+Date.now(),label:newGoalLabel.trim(),targetAmount:parseFloat(newGoalTarget)||0,saved:0,monthlyContribution:parseFloat(newGoalMonthly)||0,targetDate:newGoalDate});
              upd(d);setShowAddSavingsGoal(false);setNewGoalLabel("");setNewGoalTarget("");setNewGoalDate("");setNewGoalMonthly("");
            }} disabled={!newGoalLabel.trim()||!(parseFloat(newGoalTarget)>0)} style={{padding:"10px",fontSize:13,fontWeight:600,border:"none",borderRadius:8,background:(!newGoalLabel.trim()||!(parseFloat(newGoalTarget)>0))?C.surface:C.teal,color:(!newGoalLabel.trim()||!(parseFloat(newGoalTarget)>0))?C.gray:C.bg,cursor:(!newGoalLabel.trim()||!(parseFloat(newGoalTarget)>0))?"not-allowed":"pointer",marginTop:4}}>
              Add goal
            </button>
          </div>
        </Modal>
      )}

      {showCsvImport && (()=>{
        const catOptions = cats.filter(c=>!c.autoCalc&&!c.locked);
        const CSV_KEYWORDS = [
          {id:"food",      words:["grubhub","doordash","uber eats","ubereats","chipotle","mcdonald","burger","pizza","restaurant","dining","starbucks","dunkin","panera","chick-fil","subway","whole foods","trader joe","kroger","safeway","instacart","fresh direct","freshdirect","supermarket","grocery","diner","cafe","sushi","thai","chinese","indian","taco"]},
          {id:"transport", words:["uber","lyft","mta","metro","transit","bus","train","amtrak","subway fare","parking","garage","gas station","exxon","bp gas","shell","citgo","zipcar","citi bike","lime","bird"]},
          {id:"personal",  words:["amazon","target","walmart","costco","walgreens","cvs","rite aid","duane reade","pharmacy","clothing","zara","h&m","uniqlo","gap","nike","apple store","best buy","home depot","ikea","bed bath"]},
          {id:"exams",     words:["uworld","amboss","anki","kaplan","nbme","usmle","step 1","step 2","step 3","board","prometric","examity","lecturio","sketchy","pathoma","first aid","boards"]},
          {id:"social",    words:["bar","nightclub","concert","ticket","eventbrite","ticketmaster","bowling","movie","amc","regal","theater","theatre","escape room","dave &"]},
          {id:"books",     words:["book","textbook","barnes","amazon books","kindle","chegg","library fine"]},
          {id:"savings",   words:["transfer to savings","zelle to","venmo to","deposit"]},
          {id:"subs",      words:["netflix","spotify","hulu","apple one","apple tv","disney","hbo","youtube premium","google one","dropbox","icloud","adobe","notion","zoom","slack"]},
        ];
        const autoCategory = (desc="") => {
          const d = desc.toLowerCase();
          for(const {id,words} of CSV_KEYWORDS){
            if(words.some(w=>d.includes(w))) return catOptions.find(c=>c.id===id)?id:"";
          }
          return "";
        };
        const parseCSV = () => {
          const lines = csvText.trim().split(/\r?\n/).filter(l=>l.trim());
          if(lines.length < 2) return;
          const sep = lines[0].includes("\t") ? "\t" : ",";
          const splitLine = (l) => {
            if(sep==="\t") return l.split("\t").map(s=>s.trim());
            const cols=[]; let cur="", inQ=false;
            for(const ch of l){
              if(ch==='"'){inQ=!inQ;}
              else if(ch===","&&!inQ){cols.push(cur.trim());cur="";}
              else cur+=ch;
            }
            cols.push(cur.trim()); return cols;
          };
          const headers = splitLine(lines[0]).map(h=>h.toLowerCase().replace(/"/g,""));
          const findCol = (...names) => names.reduce((found,n)=>{
            if(found>=0) return found;
            const idx=headers.findIndex(h=>h.includes(n));
            return idx>=0?idx:-1;
          }, -1);
          const dateCol   = findCol("date","posted","trans");
          const amtCol    = findCol("amount","debit","charge","withdrawal");
          const descCol   = findCol("description","merchant","memo","payee","name");
          if(dateCol<0||amtCol<0) { setCsvError("Couldn't find Date and Amount columns. Make sure the first line of your CSV has headers like “Date, Description, Amount”."); return; }
          // Signed amounts: negatives are spending, positives are deposits (skipped).
          // All-positive amounts: debit-only export — keep everything.
          const signedVals = lines.slice(1).map(l=>parseFloat((splitLine(l)[amtCol]||"").replace(/[$,"]/g,"").trim()));
          const hasNegatives = signedVals.some(v=>v<0);
          const rows = lines.slice(1).map((line,i)=>{
            const cols = splitLine(line);
            const rawAmt = (cols[amtCol]||"").replace(/[$,"]/g,"").trim();
            const signed = parseFloat(rawAmt)||0;
            const amt = (hasNegatives && signed>0) ? 0 : Math.abs(signed);
            const desc = descCol>=0 ? (cols[descCol]||"").replace(/"/g,"").trim() : "";
            const dateRaw = (cols[dateCol]||"").replace(/"/g,"").trim();
            // Accept ISO (2026-06-09), US (6/9/2026, 06-09-26), with -, / or . separators
            let dateObj = null, m;
            if ((m = dateRaw.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})$/))) {
              dateObj = new Date(+m[1], +m[2]-1, +m[3], 12);
            } else if ((m = dateRaw.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})$/))) {
              const yr = m[3].length===2 ? 2000+ +m[3] : +m[3];
              dateObj = new Date(yr, +m[1]-1, +m[2], 12);
            } else {
              const t = new Date(dateRaw); if(!isNaN(t)) dateObj = t;
            }
            const dateStr = (!dateObj||isNaN(dateObj))?null:[dateObj.getFullYear(),String(dateObj.getMonth()+1).padStart(2,"0"),String(dateObj.getDate()).padStart(2,"0")].join("-");
            return {id:i, date:dateStr, desc, amt, catId:autoCategory(desc), include:amt>0&&dateStr!==null};
          }).filter(r=>r.amt>0&&r.date);
          if(!rows.length){ setCsvError("No transactions recognized. Check that each line has a date and a dollar amount — deposits and $0 rows are skipped automatically."); return; }
          setCsvError(null);
          setCsvRows(rows);
        };
        const doImport = () => {
          if(!csvRows) return;
          const toImport = csvRows.filter(r=>r.include&&r.catId&&r.date);
          if(!toImport.length) return;
          const d = JSON.parse(JSON.stringify(data));
          if(!d.weeklyArchive) d.weeklyArchive=[];
          if(!d.currentWeekEntries) d.currentWeekEntries=[];
          if(!d.savingsLog) d.savingsLog=[];
          const thisWeek = getMonday(new Date());
          toImport.forEach(r=>{
            const entry={id:"e_"+Date.now()+"_"+r.id, catId:r.catId, amount:r.amt, note:r.desc, date:r.date};
            const entryWeek=getMonday(r.date);
            if(entryWeek===thisWeek){
              d.currentWeekEntries.push(entry);
            } else {
              const ex=d.weeklyArchive.find(a=>a.weekStart===entryWeek);
              if(ex){ex.entries.push(entry);ex.total=ex.entries.reduce((a,e)=>a+Number(e.amount),0);}
              else d.weeklyArchive.push({weekStart:entryWeek,weekEnd:getSunday(entryWeek),entries:[entry],total:entry.amount});
            }
            if(r.catId==="exams"){
              let rem=r.amt;
              (d.stepGoals||[]).forEach((g,gi)=>{
                if(rem<=0) return;
                const room=Math.max(0,(g.targetAmount||0)-(g.saved||0));
                const credit=Math.min(room,rem);
                if(credit<=0) return;
                d.stepGoals[gi].saved=(d.stepGoals[gi].saved||0)+credit;
                d.savingsLog.push({id:"sl_"+Date.now()+"_"+r.id+"_"+gi,goalId:g.id,amount:credit,date:r.date,note:r.desc||"CSV import",weeklyEntryId:entry.id,budgetAdded:null});
                rem-=credit;
              });
            }
          });
          upd(d);
          setShowCsvImport(false);setCsvText("");setCsvRows(null);setCsvError(null);
        };
        const total=csvRows?csvRows.filter(r=>r.include&&r.catId).length:0;
        return (
          <Modal title="Import from bank CSV" onClose={()=>{setShowCsvImport(false);setCsvText("");setCsvRows(null);setCsvError(null);}} width={680}>
            {!csvRows ? (
              <div style={{display:"flex",flexDirection:"column",gap:12}}>
                <div style={{fontSize:12,color:C.gray,lineHeight:1.6}}>
                  Export a CSV from your bank (Chase, BofA, etc.) and paste it below. Needs at least a <strong>Date</strong> and <strong>Amount</strong> column. A description column helps with auto-categorization.
                </div>
                <textarea value={csvText} onChange={e=>{setCsvText(e.target.value);setCsvError(null);}} placeholder={"Date,Description,Amount\n06/01/2026,GRUBHUB,-12.50\n06/02/2026,MTA TRANSIT,-2.90"} rows={10} style={{width:"100%",fontSize:12,border:`1px solid ${csvError?C.negMid:C.border}`,borderRadius:8,padding:"10px",background:C.bg,color:C.text,boxSizing:"border-box",fontFamily:"monospace",resize:"vertical"}}/>
                {csvError && <div role="alert" style={{fontSize:12,lineHeight:1.5,color:C.danger,background:C.dangerLight,border:`1px solid ${C.dangerMid}`,borderRadius:8,padding:"8px 12px"}}>{csvError}</div>}
                <button className="btn-fill" onClick={parseCSV} disabled={!csvText.trim()} style={{padding:"10px",fontSize:13,fontWeight:600,border:"none",borderRadius:8,background:!csvText.trim()?C.surface:C.teal,color:!csvText.trim()?C.gray:C.bg,cursor:!csvText.trim()?"not-allowed":"pointer"}}>Parse transactions</button>
              </div>
            ) : (
              <div style={{display:"flex",flexDirection:"column",gap:12}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <span style={{fontSize:12,color:C.gray}}>{csvRows.length} {csvRows.length===1?"transaction":"transactions"} found — review categories and uncheck any to skip</span>
                  <button className="txt-act" onClick={()=>setCsvRows(null)} style={{background:"none",border:"none",color:C.gray,cursor:"pointer",fontSize:12}}>← Paste again</button>
                </div>
                <div style={{maxHeight:360,overflowY:"auto",border:`1px solid ${C.border}`,borderRadius:8}}>
                  <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                    <thead>
                      <tr style={{background:C.glassTooltip,backdropFilter:"blur(20px)",position:"sticky",top:0}}>
                        <th style={{padding:"8px 10px",textAlign:"left",color:C.gray,fontWeight:600,borderBottom:`1px solid ${C.border}`}}>✓</th>
                        <th style={{padding:"8px 10px",textAlign:"left",color:C.gray,fontWeight:600,borderBottom:`1px solid ${C.border}`}}>Date</th>
                        <th style={{padding:"8px 10px",textAlign:"left",color:C.gray,fontWeight:600,borderBottom:`1px solid ${C.border}`}}>Description</th>
                        <th style={{padding:"8px 10px",textAlign:"right",color:C.gray,fontWeight:600,borderBottom:`1px solid ${C.border}`}}>Amount</th>
                        <th style={{padding:"8px 10px",textAlign:"left",color:C.gray,fontWeight:600,borderBottom:`1px solid ${C.border}`}}>Category</th>
                      </tr>
                    </thead>
                    <tbody>
                      {csvRows.map((row,i)=>(
                        <tr key={row.id} style={{background:row.include?"transparent":"rgba(255,255,255,0.03)",opacity:row.include?1:0.45}}>
                          <td style={{padding:"6px 10px",borderBottom:`1px solid ${C.border}`}}>
                            <input type="checkbox" checked={row.include} onChange={e=>{const r=[...csvRows];r[i]={...r[i],include:e.target.checked};setCsvRows(r);}}/>
                          </td>
                          <td style={{padding:"6px 10px",borderBottom:`1px solid ${C.border}`,color:C.text,whiteSpace:"nowrap"}}>{row.date}</td>
                          <td style={{padding:"6px 10px",borderBottom:`1px solid ${C.border}`,color:C.text,maxWidth:220,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{row.desc}</td>
                          <td style={{padding:"6px 10px",borderBottom:`1px solid ${C.border}`,color:C.text,textAlign:"right",fontWeight:600}}>{fmtA(row.amt)}</td>
                          <td style={{padding:"6px 10px",borderBottom:`1px solid ${C.border}`}}>
                            <select value={row.catId} onChange={e=>{const r=[...csvRows];r[i]={...r[i],catId:e.target.value};setCsvRows(r);}} style={{fontSize:11,border:`1px solid ${row.catId?C.border:C.amber}`,borderRadius:8,padding:"3px 6px",background:C.bg,color:row.catId?C.text:C.amber,cursor:"pointer"}}>
                              <option value="">— pick —</option>
                              {catOptions.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}
                            </select>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <span style={{fontSize:12,color:C.gray}}>{total} entries will be imported</span>
                  <button className="btn-fill" onClick={doImport} disabled={total===0} style={{padding:"10px 24px",fontSize:13,fontWeight:600,border:"none",borderRadius:8,background:total===0?C.surface:C.teal,color:total===0?C.gray:C.bg,cursor:total===0?"not-allowed":"pointer"}}>
                    Import {total} {total===1?"entry":"entries"}
                  </button>
                </div>
              </div>
            )}
          </Modal>
        );
      })()}

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
                    <button className="menu-row" onClick={()=>{const d=JSON.parse(JSON.stringify(data));d.darkMode=!d.darkMode;upd(d);}} style={{display:"flex",alignItems:"center",gap:9,width:"100%",padding:"8px 10px",borderRadius:8,border:"none",background:"transparent",color:C.text,fontSize:12,fontWeight:500,cursor:"pointer",textAlign:"left",transition:"background .15s"}}>
                      <span key={data.darkMode?"sun":"moon"} style={{display:"inline-flex",animation:"iconSwap 220ms cubic-bezier(0.23,1,0.32,1)"}}><Icon name={data.darkMode?"sun":"moon"} size={14}/></span>
                      {data.darkMode?"Light mode":"Dark mode"}
                    </button>
                    <button className="menu-row" onClick={()=>{setConfirmReset(true);setSettingsOpen(false);}} style={{display:"flex",alignItems:"center",gap:9,width:"100%",padding:"8px 10px",borderRadius:8,border:"none",background:"transparent",color:C.danger,fontSize:12,fontWeight:500,cursor:"pointer",textAlign:"left",transition:"background .15s"}}>
                      <Icon name="subs" size={14}/>
                      Reset defaults
                    </button>
                  </div>
                  {/* Footer — legal + sign out */}
                  <div style={{borderTop:`1px solid ${C.border}`,padding:"4px 0 2px"}}>
                    <div style={{display:"flex",gap:0,padding:"4px 10px 6px"}}>
                      <a href="/terms.html" target="_blank" rel="noopener" style={{fontSize:10.5,color:C.gray,textDecoration:"none",borderBottom:`1px solid ${C.border}`}}>Terms</a>
                      <span style={{fontSize:10.5,color:C.border,padding:"0 5px"}}>·</span>
                      <a href="/privacy.html" target="_blank" rel="noopener" style={{fontSize:10.5,color:C.gray,textDecoration:"none",borderBottom:`1px solid ${C.border}`}}>Privacy</a>
                    </div>
                    <button className="menu-row" onClick={()=>{setSettingsOpen(false);sb.auth.signOut();}} style={{display:"flex",alignItems:"center",gap:9,width:"100%",padding:"8px 10px",borderRadius:8,border:"none",background:"transparent",color:C.text,fontSize:12,fontWeight:600,cursor:"pointer",textAlign:"left",transition:"background .15s"}}>
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

      {/* ── Top metrics ── */}
      <div style={{display:"flex",gap:10,marginBottom:20,flexWrap:"wrap"}}>
        <MetricTile label="Monthly spendable"  value={fmt(moSpendable)} sub="after tuition & fees" color={C.teal}/>
        <MetricTile label="Monthly plan"        value={fmt(moSpend)}     sub={subsMo>0?`incl. ${fmtA(subsMo)} subs`:"planned spending"}/>
        <MetricTile label="Monthly surplus"    value={fmtS(moSurplus)}  sub={moSurplus>0?"available to save":moSurplus<0?"over budget":"balanced"} color={moSurplus>0?C.green:moSurplus<0?C.neg:C.gray}/>
        <MetricTile label="Year net"           value={fmtS(curYrNet)}   sub="full 12 months" color={curYrNet>=0?C.green:C.neg}/>
        <MetricTile label="Total balance"    value={fmtS(totalAccumulatedBalance)} sub={"thru "+MONTH_NAMES[selMonth]+(priorYearsCarryover!==0?" · incl. prior yrs":"")} color={totalAccumulatedBalance>=0?C.teal:C.neg}/>
      </div>

      {/* ── Tabs ── */}
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
        ].map(([id,lbl,badge])=><TabBtn key={id} id={id} label={lbl} active={tab===id} onClick={()=>setTab(id)} badge={badge||0}/>)}
      </ChoiceGroup>

      {/* ══════════════ BUDGET ══════════════ */}
      {tab==="budget" && (
        <div role="tabpanel" id="tab-panel" aria-labelledby="tab-budget" tabIndex={0} style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(min(100%,300px),1fr))",gap:16}}>
          <Card>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
              <SectionTitle>Monthly plan</SectionTitle>
              <MonthPicker value={selMonth} onChange={setSelMonth}/>
            </div>
            <div style={{fontSize:11,color:C.gray,marginBottom:12}}>Set how much you <em>intend</em> to spend each month — actual spending is tracked in the <strong>Weekly</strong> tab.</div>

            {/* Housing — read-only */}
            <div style={{display:"flex",alignItems:"center",gap:10,padding:"8px 10px",background:C.surface,borderRadius:8,marginBottom:10,border:`1px solid ${C.border}`}}>
              <div style={{flex:1}}>
                <div style={{fontSize:12,fontWeight:600,color:C.text}}>Housing</div>
                <div style={{fontSize:11,color:C.gray,marginTop:1,display:"flex",alignItems:"center",gap:4}}>Fixed by housing contract <InfoTip text="Housing is set by your housing contract. Edit the rate in the Aid & Detail tab."/></div>
              </div>
              <div style={{fontWeight:700,fontSize:14,color:C.text}}>{fmt(yr.monthly.housing||0)}<span style={{fontSize:11,fontWeight:400,color:C.gray}}>/mo</span></div>
            </div>

            {cats.filter(c=>!c.locked && !disabledCats.includes(c.id)).map((cat,i)=>{
              const isAuto = cat.autoCalc===true;
              const isDisabled = disabledCats.includes(cat.id);
              const amt = isDisabled ? 0 : getMonthVal(cat.id);
              const pct = moSpend>0?Math.round(amt/moSpend*100):0;
              return (
                <div key={cat.id} draggable={!isAuto}
                  onDragStart={()=>setDragCat(cat.id)}
                  onDragEnd={()=>{setDragCat(null);setDragOverCat(null);}}
                  onDragOver={e=>{e.preventDefault();if(dragCat&&dragCat!==cat.id)setDragOverCat(cat.id);}}
                  onDrop={e=>{e.preventDefault();if(dragCat)reorderCats(dragCat,cat.id);setDragCat(null);setDragOverCat(null);}}
                  style={{display:"flex",alignItems:"center",gap:10,padding:"7px 0",borderBottom:`1px solid ${C.border}`,opacity:dragCat===cat.id?0.4:1,borderTop:dragOverCat===cat.id?`2px solid ${C.sel}`:"2px solid transparent",cursor:isAuto?"default":"grab",background:dragOverCat===cat.id?C.bgDark:"transparent"}}>
                  {!isAuto && <span style={{color:C.gray,fontSize:12,cursor:"grab",userSelect:"none"}} title="Drag to reorder">⠿</span>}
                  <CatIcon name={cat.icon||cat.id} color={CHART_COLORS[i%CHART_COLORS.length]}/>
                  <span style={{flex:1,fontSize:13,color:C.text}}>{cat.label}</span>
                  {isAuto
                    ? <span style={{fontSize:13,fontWeight:600,color:C.blue,minWidth:72,textAlign:"right"}}>{fmt(amt)}<span style={{fontSize:10,color:C.gray,fontWeight:400}}> auto</span></span>
                    : <input type="number" value={getMonthVal(cat.id)} onChange={e=>setMo(ay,cat.id,e.target.value)}
                        aria-label={`Monthly budget for ${cat.label}`}
                        style={{width:80,textAlign:"right",fontSize:13,border:`1px solid ${C.border}`,borderRadius:8,padding:"4px 8px",background:C.bg,color:C.text,fontWeight:600}}/>
                  }
                  <span style={{fontSize:10,color:C.gray,width:28,textAlign:"right"}}>{pct}%</span>
                  {!isAuto && <XBtn label={"Remove "+cat.label} title={"Remove for "+MONTH_NAMES[selMonth]} onClick={()=>setConfirmRemove(cat.id)} size={28}/>}
                </div>
              );
            })}

            <Divider/>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",fontSize:13,fontWeight:700}}>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <span>Total</span>
<button className="btn-pop" onClick={()=>setShowAddCat(true)} style={{padding:"3px 10px",borderRadius:8,border:`1px solid ${C.border}`,background:"transparent",cursor:"pointer",fontSize:11,color:C.gray,fontWeight:500,display:"flex",alignItems:"center",gap:4}}>
                  <span style={{fontSize:13,lineHeight:1}}>+</span> Add category
                </button>
              </div>
              <span style={{color:moSpend>moSpendable?C.neg:C.text}}>{fmt(moSpend)}/mo</span>
            </div>
            {subsMo>0 && <div style={{fontSize:11,color:C.blue,marginTop:6}}>{subs.filter(s=>s.active!==false).length} active subscription{subs.length!==1?"s":""} totalling {fmt(subsMo)}/mo — auto-calculated</div>}

            {unbudgetedCats.length>0 && <div style={{marginTop:16,paddingTop:14,borderTop:`2px dashed ${C.border}`}}>
              <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:4}}>
                <span style={{fontSize:12,fontWeight:700,color:C.amber}}>Unbudgeted spending</span>
                <InfoTip text={"Spending logged in "+MONTH_FULL[selMonth]+" for categories not in your plan. These show actual amounts spent. Add one to your budget to start planning for it."}/>
              </div>
              {unbudgetedCats.map((cat,i)=>{
                const spent=spentInMonth(cat.id,selMonth);
                return (
                  <div key={cat.id} style={{display:"flex",alignItems:"center",gap:10,padding:"7px 0",borderBottom:`1px solid ${C.border}`}}>
                    <div style={{width:6,height:6,borderRadius:99,background:C.amber,flexShrink:0}}/>
                    <span style={{flex:1,fontSize:13,color:C.text}}>{cat.label}</span>
                    <span style={{fontSize:13,fontWeight:600,color:C.amber,minWidth:64,textAlign:"right"}}>{fmt(spent)}<span style={{fontSize:10,color:C.gray,fontWeight:400}}> spent</span></span>
                    <button className="btn-fill" onClick={()=>promoteToBudget(cat.id)} style={{padding:"3px 10px",fontSize:11,fontWeight:600,border:`1px solid ${C.amberMid}`,borderRadius:8,background:C.amberLight,color:C.amber,cursor:"pointer",whiteSpace:"nowrap"}}>Add to budget</button>
                  </div>
                );
              })}
              <div style={{display:"flex",justifyContent:"space-between",fontSize:12,fontWeight:600,marginTop:8,color:C.amber}}>
                <span>Unbudgeted total</span><span>{fmt(unbudgetedTotal)}/mo</span>
              </div>
            </div>}
          </Card>

          <div style={{display:"flex",flexDirection:"column",gap:14}}>
            <Card>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:2}}>
                <SectionTitle>Cash flow</SectionTitle>
                <span style={{display:"inline-flex",alignItems:"center",gap:5,fontSize:10,color:C.gray}}><Icon name="live" size={11} color={C.green} style={{animation:"marroPulse 2s infinite"}}/>Live</span>
              </div>
              
              {[
                {l:"Grant disbursed to you",    v:fmt(annDisburse)+"/yr",    c:C.teal},
                {l:"Other income",              v:fmt(annOther)+"/yr",       c:C.text},
                {l:"Monthly spendable",         v:fmt(moSpendable)+"/mo",    c:C.teal,bold:true},
                {l:"Monthly plan",              v:fmt(moSpend)+"/mo",        c:C.text},
                {l:"Monthly surplus",           v:fmtS(moSurplus)+"/mo",     c:moSurplus>=0?C.green:C.neg,bold:true},
              ].map(r=>(
                <div key={r.l} style={{display:"flex",justifyContent:"space-between",padding:"5px 0",borderBottom:`1px solid ${C.border}`,fontSize:12}}>
                  <span style={{color:C.gray}}>{r.l}</span>
                  <span style={{fontWeight:r.bold?700:500,color:r.c}}>{r.v}</span>
                </div>
              ))}
              <div style={{display:"flex",justifyContent:"space-between",padding:"8px 0 2px",fontSize:13,fontWeight:700}}>
                <span>Running balance <span style={{fontSize:10,color:C.gray,fontWeight:400}}>through {MONTH_FULL[selMonth]}</span></span>
                <span style={{color:runningBalance>=0?C.teal:C.neg}}>{fmtS(runningBalance)}</span>
              </div>
              {moSurplus!==0 && (
                <div style={{marginTop:8,padding:"10px 12px",background:moSurplus>=0?C.greenLight:C.negLight,borderRadius:8,fontSize:12,color:moSurplus>=0?C.green:C.neg,fontWeight:500}}>
                  {moSurplus>=0
                    ? `${fmt(moSurplus)} surplus this month — it carries into your running balance and adds to your year-end net.`
                    : `${fmt(Math.abs(moSurplus))} over budget this month — this draws down your running balance and lowers your year-end net.`}
                </div>
              )}
            </Card>

            {lastMonthRollover>0 && (
              <Card>
                <SectionTitle>Last month rollover</SectionTitle>
                <div style={{fontSize:13,color:C.text,marginBottom:8}}>You had <strong style={{color:C.green}}>{fmt(lastMonthRollover)}</strong> left over last month.</div>
                <div style={{fontSize:12,color:C.gray,lineHeight:1.6}}>
                  Recommendation: {rolloverReco(lastMonthRollover)||"Move to savings."}
                </div>
              </Card>
            )}

            <Card>
              <SectionTitle>Health checks</SectionTitle>
              {[
                ["Housing ratio",    moSpendable>0?Math.round((yr.monthly.housing||0)/moSpendable*100)+"%":"—", (yr.monthly.housing||0)/moSpendable<0.6,(yr.monthly.housing||0)/moSpendable<0.75,"Target <60% of spendable"],
                ["Monthly balance",  moSurplus>=0?"Positive":"Negative", moSurplus>=0, false, ""],
                ["Savings",          (yr.monthly.savings||0)>0?fmt(yr.monthly.savings||0)+"/mo":"None", (yr.monthly.savings||0)>0, false, "Even $50/mo adds up"],
                ["Exam fund",        (yr.monthly.exams||0)>0?fmt(yr.monthly.exams||0)+"/mo":"$0/mo", ay<=1||(yr.monthly.exams||0)>0, ay>1, "Steps cost ~$850 each"],
              ].map(([label,val,ok,warn,tip])=>(
                <div key={label} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"6px 0",borderBottom:`1px solid ${C.border}`,fontSize:12}}>
                  <span style={{color:C.gray}}>{label}</span>
                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                    <Pill ok={ok} warn={!ok&&warn}>{val}</Pill>
                    {tip && <span style={{fontSize:10,color:C.gray}}>{tip}</span>}
                  </div>
                </div>
              ))}
            </Card>

            <Card>
              <SectionTitle>Running balance</SectionTitle>
              <div style={{fontSize:26,fontWeight:700,color:totalAccumulatedBalance>=0?C.teal:C.neg,margin:"6px 0",fontFamily:"'Newsreader',Georgia,serif"}}>{fmtS(totalAccumulatedBalance)}</div>
              <div style={{fontSize:11,color:C.gray,lineHeight:1.6}}>
                {priorYearsCarryover!==0
                  ? <>Prior years: <strong style={{color:priorYearsCarryover>=0?C.teal:C.neg}}>{fmtS(priorYearsCarryover)}</strong> · This year so far: <strong style={{color:runningBalance>=0?C.teal:C.neg}}>{fmtS(runningBalance)}</strong></>
                  : <>Cumulative surplus/deficit from {MONTH_FULL[0]} through {MONTH_FULL[selMonth]}.</>
                }
              </div>
              {totalAccumulatedBalance>moSpendable*2 && <div style={{marginTop:8,padding:"6px 10px",background:C.greenLight,borderRadius:8,fontSize:11,color:C.green}}>You're building a healthy cushion. Consider moving some into a high-yield savings account.</div>}
              {totalAccumulatedBalance<0 && <div style={{marginTop:8,padding:"6px 10px",background:C.negLight,borderRadius:8,fontSize:11,color:C.neg}}>You're running a cumulative deficit. Review spending or adjust your budget.</div>}
            </Card>

            <Card>
              <SectionTitle>Notes</SectionTitle>
              <textarea value={yr.notes||""} onChange={e=>setYrF(ay,"notes",e.target.value)} placeholder="Reminders, upcoming costs..."
                style={{width:"100%",fontSize:12,border:`1px solid ${C.border}`,borderRadius:8,padding:"8px 10px",resize:"vertical",minHeight:64,fontFamily:"inherit",color:C.text,background:C.bg,boxSizing:"border-box"}}/>
            </Card>
          </div>
        </div>
      )}

      {/* ══════════════ WEEKLY ══════════════ */}
      {tab==="weekly" && (
        <div role="tabpanel" id="tab-panel" aria-labelledby="tab-weekly" tabIndex={0} style={{display:"flex",flexDirection:"column",gap:16}}>
          {weeklyNotice && weeklyNotice.type==="info" && (
            <Banner type="info" onClose={()=>setWeeklyNotice(null)}>
              <strong>{weeklyNotice.cat}</strong> wasn't in your {weeklyNotice.month} budget, so it's now tracked under <strong>Unbudgeted spending</strong> in the Budget tab. Tap "Add to budget" there if you want to plan for it.
            </Banner>
          )}

          {/* Week bar — label whispers, the serif date range is the headline (matches display money) */}
          <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
            <div style={{flex:"1 1 200px",display:"flex",alignItems:"baseline",gap:9,minWidth:0}}>
              <span style={{fontSize:10,fontWeight:600,color:C.gray,textTransform:"uppercase",letterSpacing:"0.08em",whiteSpace:"nowrap"}}>{viewWeek?"Archived week":"This week"}</span>
              <span style={{fontSize:20,fontWeight:600,color:C.text,letterSpacing:"-0.01em",fontFamily:"'Newsreader',Georgia,serif",whiteSpace:"nowrap"}}>{fmtWeekLabel(viewWeek||currentWeekStart)}</span>
            </div>
            <button onClick={()=>setShowWeekPicker(true)} className="btn-pop" style={{padding:"6px 14px",borderRadius:8,border:`1px solid ${C.border}`,background:"transparent",cursor:"pointer",fontSize:12,color:C.gray,fontWeight:500,display:"flex",alignItems:"center",gap:6}}>
              Browse weeks {archives.length>0&&`(${archives.length} archived)`}
            </button>
            {viewWeek && <button className="btn-pop" onClick={()=>setViewWeek(null)} style={{padding:"6px 12px",borderRadius:8,border:`1px solid ${C.sel}`,background:C.selBg,cursor:"pointer",fontSize:12,color:C.text,fontWeight:600}}>← Back to current week</button>}
          </div>

          {/* Week metrics */}
          {lastWeekSurplus>0 && !viewWeek && !dismissed["wkrollover"] && (
            <Banner type="success" onClose={()=>dismiss("wkrollover")}>
              <strong>{fmt(lastWeekSurplus)}</strong> rolled over from last week. Your budget this week is <strong>{fmt(thisWeekBudget)}</strong>.{" "}
              <span style={{color:C.gray}}>Tip: {rolloverReco(lastWeekSurplus)||"Consider adding to savings."}</span>
            </Banner>
          )}

          <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
            {[
              {label:"Weekly plan",      val:fmt(viewBudget),             sub:lastWeekSurplus>0&&!viewWeek?`base ${fmt(weeklyBudget)} + ${fmt(lastWeekSurplus)} rollover`:"spendable ÷ 4.33", color:C.teal},
              {label:"Actually spent",  val:fmtA(viewTotal),             sub:viewWeek?"archived":"this week",      color:viewTotal>viewBudget?C.neg:C.text},
              {label:"Remaining",        val:fmtSA(viewBudget-viewTotal), sub:"this week",                          color:viewBudget-viewTotal>=0?C.green:C.neg},
              {label:"Entries",          val:String(viewEntries.length),  sub:"logged",                             color:C.gray},
            ].map(m=><MetricTile key={m.label} label={m.label} value={m.val} sub={m.sub} color={m.color}/>)}
          </div>

          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(min(100%,300px),1fr))",gap:16}}>
            {/* Log entry */}
            <Card>
              <SectionTitle>Log actual expense</SectionTitle>
              <div style={{fontSize:11,color:C.gray,marginBottom:10}}>Record money you <em>actually</em> spent — this is your real spending, not a plan.</div>
              <div style={{display:"flex",flexDirection:"column",gap:10}}>
                <div>
                  <div style={{fontSize:11,color:C.gray,marginBottom:4,fontWeight:500}}>Date</div>
                  <DateField value={wDate} onChange={setWDate} ariaLabel="Expense date" style={isOtherWeekDate?{border:`1px solid ${C.amber}`}:{}}/>
                  {isOtherWeekDate && <div style={{fontSize:11,color:C.amber,marginTop:4,fontWeight:500}}>{isFutureWeekDate?"Future date —":"Past date —"} will be filed to week of {getMonday(wDate)}</div>}
                </div>
                <div>
                  <div style={{fontSize:11,color:C.gray,marginBottom:4,fontWeight:500}}>Category</div>
                  <select value={wCat} onChange={e=>setWCat(e.target.value)} aria-label="Category"
                    style={{width:"100%",fontSize:13,border:`1px solid ${C.border}`,borderRadius:8,padding:"7px 10px",background:C.bg,color:C.text,boxSizing:"border-box"}}>
                    <option value="">Select category…</option>
                    {cats.filter(c=>!c.autoCalc&&!c.locked).map(c=><option key={c.id} value={c.id}>{c.label}</option>)}
                  </select>
                </div>
                <div>
                  <div style={{fontSize:11,color:C.gray,marginBottom:4,fontWeight:500}}>Amount</div>
                  <input type="number" placeholder="0.00" value={wAmt} onChange={e=>setWAmt(e.target.value)}
                    style={{width:"100%",fontSize:13,border:`1px solid ${C.border}`,borderRadius:8,padding:"7px 10px",background:C.bg,color:C.text,boxSizing:"border-box"}}/>
                </div>
                <div>
                  <div style={{fontSize:11,color:C.gray,marginBottom:4,fontWeight:500}}>Note (optional)</div>
                  <input type="text" placeholder="e.g. Trader Joe's" value={wNote} onChange={e=>setWNote(e.target.value)}
                    style={{width:"100%",fontSize:13,border:`1px solid ${C.border}`,borderRadius:8,padding:"7px 10px",background:C.bg,color:C.text,boxSizing:"border-box"}}/>
                </div>
                <button className="btn-fill" onClick={addEntry} disabled={!wCat||!wAmt} style={{padding:"9px",fontSize:13,fontWeight:600,border:"none",borderRadius:8,background:(!wCat||!wAmt)?C.surface:C.teal,color:(!wCat||!wAmt)?C.gray:C.bg,cursor:(!wCat||!wAmt)?"not-allowed":"pointer",marginTop:2,transition:"all .15s"}}>
                  Add entry
                </button>
                <button onClick={()=>{setShowCsvImport(true);setCsvText("");setCsvRows(null);}} className="btn-pop" style={{padding:"7px",fontSize:12,fontWeight:500,border:`1px solid ${C.border}`,borderRadius:8,background:"transparent",color:C.gray,cursor:"pointer",marginTop:2}}>
                  Import from bank CSV
                </button>
              </div>
            </Card>

            {/* Category breakdown */}
            <Card>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:10}}>
                <SectionTitle style={{marginBottom:0}}>Category breakdown</SectionTitle>
                <span style={{fontSize:11,color:C.gray}}>actual <span style={{color:C.border}}>/ planned</span></span>
              </div>
              {(()=>{
                const wkRef = viewWeek ? new Date(viewWeek+"T12:00:00") : new Date();
                const wkMonthIdx = (wkRef.getMonth() - 7 + 12) % 12;
                const wkDisabled = data.monthDisabled?.[ay+"-"+MONTH_NAMES[wkMonthIdx]]||[];
                return cats.filter(c=>!c.autoCalc&&!c.locked&&!wkDisabled.includes(c.id));
              })().map((cat,i)=>{
                const wkRef = viewWeek ? new Date(viewWeek+"T12:00:00") : new Date();
                const wkMonthIdx = (wkRef.getMonth() - 7 + 12) % 12;
                const moB = Number(getMonthValIdx(cat.id, wkMonthIdx))||0;
                const wkB = moB / 4.333;
                const spent = viewEntries.filter(e=>e.catId===cat.id).reduce((a,e)=>a+Number(e.amount),0);
                const over = spent > wkB;
                return (
                  <div key={cat.id} style={{padding:"8px 0",borderBottom:`1px solid ${C.border}`}}>
                    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:5}}>
                      <span style={{fontSize:12,color:C.text,fontWeight:500}}>{cat.label}</span>
                      <div style={{display:"flex",alignItems:"center",gap:8}}>
                        <span style={{fontSize:12,fontWeight:600,color:over?C.neg:C.text}}>{fmtD(spent)}</span>
                        <span style={{fontSize:11,color:C.gray}}>/ {fmtD(wkB)}</span>
                        {spent>0 && <Pill ok={!over} warn={over} sm>{over?`+${fmtD(spent-wkB)} over`:`${fmtD(wkB-spent)} left`}</Pill>}
                      </div>
                    </div>
                    <ProgressBar value={spent} max={wkB} color={over?C.neg:CHART_COLORS[i%CHART_COLORS.length]}/>
                  </div>
                );
              })}
            </Card>
          </div>

          {/* Entries list */}
          <Card>
            <SectionTitle>{viewWeek ? `Archived — ${fmtWeekLabel(viewWeek)}` : "This week's entries"}</SectionTitle>
            {viewEntries.length===0
              ? <EmptyState>No entries {viewWeek?"for this week":"yet — log your first expense above"}.</EmptyState>
              : [...viewEntries].sort((a,b)=>b.date.localeCompare(a.date)).map(e=>{
                  const cat=cats.find(c=>c.id===e.catId)||{label:"Other"};
                  return (
                    <div key={e.id} style={{display:"flex",alignItems:"center",gap:12,padding:"9px 0",borderBottom:`1px solid ${C.border}`}}>
                      <CatIcon name={cat.icon||e.catId} color={CHART_COLORS[cats.findIndex(c=>c.id===e.catId)%CHART_COLORS.length]||C.gray}/>
                      <div style={{flex:1}}>
                        <div style={{fontSize:13,fontWeight:500,color:C.text}}>{cat.label}</div>
                        <div style={{fontSize:11,color:C.gray,marginTop:1}}>{fmtDay(e.date)}{e.note?" · "+e.note:""}</div>
                      </div>
                      <span style={{fontWeight:700,fontSize:13,color:C.text}}>{fmtA(e.amount)}</span>
                      <XBtn label="Delete entry" onClick={()=>delEntry(e.id,!!viewWeek)}/>
                    </div>
                  );
                })
            }
            {viewEntries.length>0 && (
              <div style={{display:"flex",justifyContent:"space-between",padding:"10px 0 0",fontSize:14,fontWeight:700}}>
                <span>Week total</span>
                <span style={{color:viewTotal>viewBudget?C.neg:C.teal}}>{fmtA(viewTotal)}</span>
              </div>
            )}
            {viewWeek && <div style={{fontSize:11,color:C.gray,marginTop:8,fontStyle:"italic"}}>Archived week — entries can still be added or deleted.</div>}
          </Card>

          <div style={{fontSize:11,color:C.gray,padding:"6px 12px",background:C.surface,borderRadius:8,border:`1px solid ${C.border}`}}>
            Entries auto-archive each Sunday. Past-dated entries are filed to the correct week. Unspent balance rolls forward.
          </div>
        </div>
      )}

      {/* ══════════════ CHARTS ══════════════ */}
      {tab==="charts" && (()=>{
        // Running balance: offset by prior-year carryover so line starts where you actually stand
        const runBalData = MONTH_NAMES.map((m,mi)=>{
          let yearNet=0; for(let i=0;i<=mi;i++) yearNet+=monthNetFor(i);
          return {name:m, balance:Math.round(priorYearsCarryover+yearNet), yearNet:Math.round(yearNet)};
        });
        // Budget vs actual per month for selected year
        const budgetVsActual = MONTH_NAMES.map((m,mi)=>{
          const mk=ay+"-"+m;
          const disM=data.monthDisabled?.[mk]||[];
          let budgeted=0;
          cats.forEach(c=>{
            if(disM.includes(c.id)) return;
            if(c.id==="subs"){budgeted+=subsMo;return;}
            const ov=yr.monthlyOverrides?.[m]?.[c.id];
            budgeted+=(ov!==undefined?ov:(Number(yr.monthly[c.id])||0));
          });
          const calMo=(mi+7)%12;
          const calYr=yrStartYear+(mi>=5?1:0);
          const actual=allEntriesFlat.filter(e=>{const dt=new Date(e.date+"T12:00:00");return dt.getMonth()===calMo&&dt.getFullYear()===calYr;}).reduce((a,e)=>a+Number(e.amount),0);
          return {name:m, Budgeted:Math.round(budgeted), Actual:Math.round(actual)};
        });
        return (
          <div role="tabpanel" id="tab-panel" aria-labelledby="tab-charts" tabIndex={0} style={{display:"flex",flexDirection:"column",gap:16}}>
            {/* Running balance */}
            {(()=>{
              const balVals = runBalData.map(d=>d.balance);
              const maxBal = Math.max(...balVals);
              const minBal = Math.min(...balVals);
              const crossesZero = maxBal > 0 && minBal < 0;
              const allNeg = maxBal <= 0;
              // Explicit domain so gradient zero-fraction aligns exactly with ReferenceLine y=0
              const absExtreme = Math.max(Math.abs(maxBal), Math.abs(minBal));
              const nicePad = Math.max(300, absExtreme * 0.18);
              const yDomMax = (priorYearsCarryover !== 0 && priorYearsCarryover > maxBal)
                ? Math.ceil(priorYearsCarryover / 200) * 200
                : Math.ceil((maxBal + nicePad) / 200) * 200;
              const yDomMin = Math.floor((minBal - nicePad) / 200) * 200;
              const yRange = yDomMax - yDomMin;
              // Fraction (0=top, 1=bottom in SVG) where y=0 sits inside [yDomMin, yDomMax]
              const zeroFrac = crossesZero
                ? Math.max(0.02, Math.min(0.98, yDomMax / yRange))
                : (allNeg ? 0.01 : 0.99);
              const strokeColor = crossesZero ? "url(#balStrokeGrad)" : (allNeg ? C.neg : C.teal);
              const fillColor   = crossesZero ? "url(#balFillGrad)"   : (allNeg ? "url(#balGradNeg)" : "url(#balGrad)");
              const monthLabel  = MONTH_NAMES[selMonth];
              const totalLabel  = totalAccumulatedBalance >= 0
                ? `Total gain in ${monthLabel}`
                : `Debt in ${monthLabel}`;
              const priorColor  = priorYearsCarryover >= 0 ? C.teal : C.neg;
              return (
                <Card>
                  <SectionTitle>Running balance — {yr.label.split("—")[0].trim()}</SectionTitle>
                  <div style={{display:"flex",gap:14,marginBottom:10,flexWrap:"wrap",alignItems:"center"}}>
                    {priorYearsCarryover!==0 && (
                      <div style={{display:"flex",alignItems:"center",gap:6,fontSize:11,color:C.gray}}>
                        <svg width="20" height="8" style={{flexShrink:0}}><line x1="0" y1="4" x2="20" y2="4" stroke={priorColor} strokeWidth="2.5" strokeDasharray="8,3"/></svg>
                        <span>Entering {yr.label.split("—")[0].trim()}: <strong style={{color:priorColor}}>{fmtS(priorYearsCarryover)}</strong></span>
                      </div>
                    )}
                    {crossesZero && (
                      <div style={{display:"flex",alignItems:"center",gap:6,fontSize:11,color:C.gray}}>
                        <svg width="20" height="8" style={{flexShrink:0}}><line x1="0" y1="4" x2="20" y2="4" stroke={C.gray} strokeWidth="1" strokeDasharray="4,3"/></svg>
                        <span style={{color:C.gray}}>Break-even ($0)</span>
                      </div>
                    )}
                    <div style={{fontSize:11,marginLeft:"auto"}}>
                      <strong style={{color:totalAccumulatedBalance>=0?C.teal:C.neg}}>{totalLabel}: {fmtS(totalAccumulatedBalance)}</strong>
                    </div>
                  </div>
                  <ResponsiveContainer width="100%" height={200}>
                    <AreaChart data={runBalData} margin={{top:4,right:4,bottom:0,left:0}}>
                      <defs>
                        <linearGradient id="balGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={C.teal} stopOpacity={0.3}/>
                          <stop offset="95%" stopColor={C.teal} stopOpacity={0.02}/>
                        </linearGradient>
                        <linearGradient id="balGradNeg" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={C.neg} stopOpacity={0.3}/>
                          <stop offset="95%" stopColor={C.neg} stopOpacity={0.02}/>
                        </linearGradient>
                        {crossesZero && <>
                          <linearGradient id="balStrokeGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset={`${Math.max(0,zeroFrac*100-4)}%`} stopColor={C.teal} stopOpacity={1}/>
                            <stop offset={`${Math.min(100,zeroFrac*100+4)}%`} stopColor={C.neg} stopOpacity={1}/>
                          </linearGradient>
                          <linearGradient id="balFillGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%"                        stopColor={C.teal} stopOpacity={0.28}/>
                            <stop offset={`${zeroFrac*100*0.88}%`}   stopColor={C.teal} stopOpacity={0.04}/>
                            <stop offset={`${zeroFrac*100}%`}        stopColor={C.neg}  stopOpacity={0.04}/>
                            <stop offset="100%"                      stopColor={C.neg}  stopOpacity={0.28}/>
                          </linearGradient>
                        </>}
                      </defs>
                      <XAxis dataKey="name" tick={{fontSize:11,fill:C.gray}} axisLine={false} tickLine={false}/>
                      <YAxis domain={[yDomMin, yDomMax]} tick={{fontSize:11,fill:C.gray}} tickFormatter={v=>v===0?"$0":v>0?"+"+fmt(v):fmtS(v)} axisLine={false} tickLine={false} width={60}/>
                      <Tooltip separator=": " formatter={v=>[fmtS(v),"Total position"]} {...tipProps()}/>
                      {crossesZero && <ReferenceLine y={0} stroke={C.gray} strokeOpacity={0.45} strokeDasharray="4 3"/>}
                      {priorYearsCarryover!==0 && <ReferenceLine y={priorYearsCarryover} stroke={priorColor} strokeWidth={2} strokeOpacity={0.8} strokeDasharray="8 3"/>}
                      <Area type="monotone" dataKey="balance" stroke={strokeColor} fill={fillColor} strokeWidth={2.5}
                        dot={(p)=>p.index===selMonth?<circle key={p.index} cx={p.cx} cy={p.cy} r={4} fill={(p.payload?.balance??0)>=0?C.teal:C.neg}/>:<circle key={p.index} r={0}/>}/>
                    </AreaChart>
                  </ResponsiveContainer>
                </Card>
              );
            })()}

            {/* Budget vs Actual */}
            <Card>
              <SectionTitle>Budget vs actual</SectionTitle>
              <div style={{display:"flex",gap:20,marginBottom:10}}>
                {[["Budgeted",C.teal],["Actual",C.neg]].map(([l,c])=>(
                  <div key={l} style={{display:"flex",alignItems:"center",gap:6,fontSize:12,color:C.gray}}>
                    <div style={{width:10,height:10,borderRadius:3,background:c}}/>{l}
                  </div>
                ))}
                <div style={{fontSize:11,color:C.gray,marginLeft:"auto",alignSelf:"center"}}>Actual = logged weekly entries only</div>
              </div>
              {budgetVsActual.every(d=>d.Actual===0)
                ? <div style={{textAlign:"center",padding:"28px 16px",fontSize:12,color:C.textMid,border:`1px dashed ${C.borderDark}`,borderRadius:12,background:C.surface}}>No spending logged yet — months will appear here as you log entries.</div>
                : <ResponsiveContainer width="100%" height={200}>
                <BarChart data={budgetVsActual.filter(d=>d.Actual>0)} barGap={3} barCategoryGap="32%" onMouseMove={barMove("bva")} onMouseLeave={()=>setBarHover(null)}>
                  <XAxis dataKey="name" tick={{fontSize:11,fill:C.gray}} axisLine={false} tickLine={false}/>
                  <YAxis tick={{fontSize:11,fill:C.gray}} tickFormatter={v=>"$"+v} axisLine={false} tickLine={false} width={44}/>
                  <Tooltip separator=": " formatter={v=>fmt(v)} {...tipProps()} cursor={false}/>
                  <Bar dataKey="Budgeted" fill={C.teal} radius={[6,6,0,0]} maxBarSize={26}>
                    {budgetVsActual.filter(d=>d.Actual>0).map((d,i)=><Cell key={i} fill={C.teal} opacity={0.85*barDim("bva",i)} style={{transition:"opacity 150ms ease"}}/>)}
                  </Bar>
                  <Bar dataKey="Actual" fill={C.neg} radius={[6,6,0,0]} maxBarSize={26}>
                    {budgetVsActual.filter(d=>d.Actual>0).map((d,i)=><Cell key={i} fill={C.neg} opacity={barDim("bva",i)} style={{transition:"opacity 150ms ease"}}/>)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>}
            </Card>

            {/* Pie + breakdown — merged */}
            {(()=>{
              const pStart = Math.min(pieMonthStart, pieMonthEnd??pieMonthStart);
              const pEnd   = Math.max(pieMonthStart, pieMonthEnd??pieMonthStart);
              const isRange = pieMonthEnd !== null;
              const pieLabel = isRange ? `${MONTH_NAMES[pStart]} – ${MONTH_NAMES[pEnd]}` : MONTH_NAMES[pStart];
              // Aggregate budgeted amounts over selected range
              const pieYr = data.years.find(y=>y.id===ay)||data.years[0];
              const getBudgetVal = (catId, mIdx) => {
                if(catId==="subs") return subsMo;
                const mk = MONTH_NAMES[mIdx];
                const ov = pieYr.monthlyOverrides?.[mk]?.[catId];
                return ov !== undefined ? ov : (Number(pieYr.monthly[catId])||0);
              };
              const pieBudget = {};
              cats.forEach(c => {
                let tot = 0;
                for(let m=pStart; m<=pEnd; m++) tot += getBudgetVal(c.id, m);
                pieBudget[c.id] = tot;
              });
              const pieTotal = Object.values(pieBudget).reduce((a,v)=>a+v, 0);
              const pieSeries = cats.map((c,i)=>({name:c.label,value:Math.round(pieBudget[c.id]||0),color:CHART_COLORS[i%CHART_COLORS.length]})).filter(d=>d.value>0);
              return (
                <Card>
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
                    <SectionTitle style={{margin:0}}>Planned breakdown</SectionTitle>
                    <div style={{position:"relative"}}>
                      <button className="btn-pop" onClick={()=>setPiePickerOpen(o=>!o)} style={{display:"flex",alignItems:"center",gap:5,padding:"4px 10px",borderRadius:8,border:`1px solid ${C.border}`,background:isRange?C.teal+"22":"transparent",color:isRange?C.teal:C.text,fontSize:12,fontWeight:600,cursor:"pointer"}}>
                        {pieLabel} <Icon name="chevron" size={11} style={{opacity:0.6}}/>
                      </button>
                      {piePickerOpen && <>
                        <div onClick={()=>setPiePickerOpen(false)} style={{position:"fixed",inset:0,zIndex:99}}/>
                        <div style={{position:"absolute",right:0,top:"calc(100% + 4px)",background:C.glassTooltip,backdropFilter:"blur(50px) saturate(200%)",WebkitBackdropFilter:"blur(50px) saturate(200%)",border:`1px solid ${C.borderDark}`,borderRadius:12,padding:12,zIndex:100,width:220,boxShadow:"0 8px 32px rgba(0,0,0,0.40)"}}>
                          <div style={{fontSize:10,color:C.gray,fontWeight:600,letterSpacing:"0.06em",textTransform:"uppercase",marginBottom:8}}>
                            {pieMonthEnd===null ? "Select month or drag a range" : "Range selected — click to start over"}
                          </div>
                          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:3}}>
                            {MONTH_NAMES.map((m,mi)=>{
                              const inRange = mi>=pStart && mi<=pEnd;
                              const isEdge  = mi===pStart || mi===pEnd;
                              return (
                                <button key={mi} onClick={()=>{
                                  if(pieMonthEnd!==null){
                                    // range exists — reset to new single month
                                    setPieMonthStart(mi); setPieMonthEnd(null);
                                  } else if(mi===pieMonthStart){
                                    setPiePickerOpen(false);
                                  } else {
                                    setPieMonthEnd(mi); setPiePickerOpen(false);
                                  }
                                }} style={{padding:"5px 2px",borderRadius:8,border:"none",fontSize:11,fontWeight:isEdge?700:400,background:inRange?C.teal+"44":"transparent",color:inRange?C.teal:C.text,cursor:"pointer",transition:"background 0.1s"}}>
                                  {m}
                                </button>
                              );
                            })}
                          </div>
                          <div style={{marginTop:8,paddingTop:8,borderTop:`1px solid ${C.border}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                            <button className="txt-act" onClick={()=>{setPieMonthStart((new Date().getMonth()-7+12)%12);setPieMonthEnd(null);setPiePickerOpen(false);}} style={{background:"none",border:"none",color:C.gray,cursor:"pointer",fontSize:11,padding:0}}>Reset</button>
                            {pieMonthEnd===null && <span style={{fontSize:10,color:C.gray}}>Click another for range</span>}
                          </div>
                        </div>
                      </>}
                    </div>
                  </div>
                  {pieTotal===0
                    ? <div style={{textAlign:"center",padding:"28px 16px",fontSize:12,color:C.textMid,border:`1px dashed ${C.borderDark}`,borderRadius:12,background:C.surface}}>No spending logged for this period yet.</div>
                    : <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(min(100%,300px),1fr))",gap:16,alignItems:"start"}}>
                        {/* Hover detail lives in the donut's center — no floating tooltip box */}
                        <div style={{position:"relative"}} onMouseLeave={()=>setPieHover(null)}>
                          <ResponsiveContainer width="100%" height={220}>
                            <PieChart><Pie data={pieSeries} dataKey="value" cx="50%" cy="50%" innerRadius={62} outerRadius={94} paddingAngle={2.5} cornerRadius={5}
                              onMouseEnter={(_,i)=>setPieHover(i)} onMouseLeave={()=>setPieHover(null)}>
                              {pieSeries.map((e,i)=><Cell key={i} fill={e.color} opacity={pieHover===null||pieHover===i?1:0.35} style={{transition:"opacity 180ms ease",outline:"none"}}/>)}
                            </Pie></PieChart>
                          </ResponsiveContainer>
                          {(()=>{
                            const h = pieHover!==null ? pieSeries[pieHover] : null;
                            const pct = h && pieTotal>0 ? Math.round(h.value/pieTotal*100) : null;
                            return (
                              <div style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",textAlign:"center",pointerEvents:"none"}}>
                                <div style={{fontSize:11,color:h?h.color:C.gray,fontWeight:600,maxWidth:110,lineHeight:1.3}}>{h?h.name:"Total planned"}</div>
                                <div style={{fontSize:24,fontWeight:600,color:C.text,letterSpacing:"-0.02em",fontFamily:"'Newsreader',Georgia,serif",marginTop:2}}>{fmt(h?h.value:pieTotal)}</div>
                                {pct!==null && <div style={{fontSize:11,color:C.gray,marginTop:1}}>{pct}% of plan</div>}
                              </div>
                            );
                          })()}
                        </div>
                        <div style={{paddingTop:8}}>
                          {cats.map((cat,i)=>{
                            const amt=Math.round(pieBudget[cat.id]||0);
                            const pct=pieTotal>0?Math.round(amt/pieTotal*100):0;
                            if(amt===0) return null;
                            const sliceIdx = pieSeries.findIndex(s=>s.name===cat.label);
                            return <div key={cat.id} onMouseEnter={()=>setPieHover(sliceIdx>=0?sliceIdx:null)} onMouseLeave={()=>setPieHover(null)} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"6px 0",borderBottom:`1px solid ${C.border}`,fontSize:12,background:pieHover===sliceIdx&&sliceIdx>=0?C.selBg:"transparent",borderRadius:6,transition:"background 150ms ease"}}>
                              <div style={{display:"flex",alignItems:"center",gap:8}}>
                                <div style={{width:10,height:10,borderRadius:3,background:CHART_COLORS[i%CHART_COLORS.length],flexShrink:0}}/>
                                <span style={{color:C.text}}>{cat.label}</span>
                              </div>
                              <div style={{display:"flex",gap:10}}>
                                <span style={{fontWeight:600}}>{fmt(amt)}</span>
                                <span style={{color:C.gray,minWidth:28,textAlign:"right"}}>{pct}%</span>
                              </div>
                            </div>;
                          })}
                        </div>
                      </div>
                  }
                </Card>
              );
            })()}

            {/* Monthly trend per category */}
            {(()=>{
              const catTotals=cats.map(c=>({
                id:c.id,label:c.label,
                total:MONTH_NAMES.reduce((sum,m,mi)=>{
                  const calMo=(mi+7)%12;
                  const calYr=yrStartYear+(mi>=5?1:0);
                  return sum+allEntriesFlat.filter(e=>{const dt=new Date(e.date+"T12:00:00");return dt.getMonth()===calMo&&dt.getFullYear()===calYr&&e.catId===c.id;}).reduce((a,e)=>a+Number(e.amount),0);
                },0)
              })).filter(c=>c.total>0).sort((a,b)=>b.total-a.total);
              const defaultTop4=catTotals.slice(0,4).map(c=>c.id);
              const activeTrend=trendCats||defaultTop4;
              const trendData=MONTH_NAMES.map((m,mi)=>{
                const calMo=(mi+7)%12;
                const calYr=yrStartYear+(mi>=5?1:0);
                const row={name:m};
                cats.forEach(c=>{
                  if(!activeTrend.includes(c.id)) return;
                  row[c.label]=Math.round(allEntriesFlat.filter(e=>{const dt=new Date(e.date+"T12:00:00");return dt.getMonth()===calMo&&dt.getFullYear()===calYr&&e.catId===c.id;}).reduce((a,e)=>a+Number(e.amount),0));
                });
                return row;
              });
              const activeCats=cats.filter(c=>activeTrend.includes(c.id));
              // Find the range: first → last month that has ANY spending across active cats
              const hasSpend=trendData.map(row=>activeCats.some(c=>(row[c.label]||0)>0));
              const firstIdx=hasSpend.indexOf(true);
              const lastIdx=hasSpend.lastIndexOf(true);
              const filteredTrend=firstIdx===-1?[]:trendData.slice(firstIdx,lastIdx+1);
              return (
                <Card>
                  <SectionTitle>Monthly spending trend</SectionTitle>
                  <div style={{fontSize:11,color:C.gray,marginBottom:10}}>Actual spending per category across the year. Toggle categories below.</div>
                  <div style={{display:"flex",flexWrap:"wrap",gap:8,marginBottom:14}}>
                    {catTotals.map((c,i)=>{
                      const on=activeTrend.includes(c.id);
                      const color=CHART_COLORS[cats.findIndex(x=>x.id===c.id)%CHART_COLORS.length];
                      return (
                        <button key={c.id} onClick={()=>{
                          const cur=trendCats||defaultTop4;
                          setTrendCats(cur.includes(c.id)?cur.filter(x=>x!==c.id):[...cur,c.id]);
                        }} style={{display:"flex",alignItems:"center",gap:5,padding:"4px 10px",borderRadius:99,fontSize:11,fontWeight:500,cursor:"pointer",border:`1px solid ${on?color:C.border}`,background:on?color+"22":"transparent",color:on?color:C.gray}}>
                          <div style={{width:7,height:7,borderRadius:99,background:on?color:C.border}}/>
                          {c.label}
                        </button>
                      );
                    })}
                  </div>
                  {filteredTrend.length===0
                    ? <div style={{textAlign:"center",padding:"28px 16px",fontSize:12,color:C.textMid,border:`1px dashed ${C.borderDark}`,borderRadius:12,background:C.surface}}>No spending logged yet — entries will appear here as you log them.</div>
                    : <ResponsiveContainer width="100%" height={200}>
                    <LineChart data={(()=>{
                      if(filteredTrend.length>1) return filteredTrend;
                      const idx=MONTH_NAMES.indexOf(filteredTrend[0].name);
                      const blank=(mi)=>({name:MONTH_NAMES[(mi+12)%12],...Object.fromEntries(activeCats.map(c=>[c.label,0]))});
                      return [
                        blank(idx-1),
                        filteredTrend[0],
                        ...(idx<11?[blank(idx+1)]:[]),
                      ];
                    })()} margin={{top:4,right:4,bottom:0,left:0}}>
                      <XAxis dataKey="name" tick={{fontSize:11,fill:C.gray}} axisLine={false} tickLine={false}/>
                      <YAxis tick={{fontSize:11,fill:C.gray}} tickFormatter={v=>"$"+v} axisLine={false} tickLine={false} width={44}/>
                      <Tooltip separator=": " formatter={v=>fmt(v)} {...tipProps()}/>
                      <Legend wrapperStyle={{fontSize:11,paddingTop:8}}/>
                      {activeCats.map((c,i)=>(
                        <Line key={c.id} type="monotone" dataKey={c.label} stroke={CHART_COLORS[cats.findIndex(x=>x.id===c.id)%CHART_COLORS.length]} strokeWidth={2} dot={false} activeDot={{r:4}}/>
                      ))}
                    </LineChart>
                  </ResponsiveContainer>}
                </Card>
              );
            })()}

            {/* Comparison mode */}
            {(()=>{
              // Build period options: individual months for each year + full years
              const periodOptions=[];
              data.years.forEach(y=>{
                periodOptions.push({label:y.label.split("—")[0].trim(),type:"year",ayId:y.id});
                MONTH_NAMES.forEach((m,mi)=>periodOptions.push({label:`${m} (${y.label.split("—")[0].trim()})`,type:"month",ayId:y.id,mi}));
              });
              const defaultA=compareA||(periodOptions.find(p=>p.type==="month"&&p.ayId===ay&&p.mi===((selMonth-1+12)%12))||periodOptions[1]||periodOptions[0]);
              const defaultB=compareB||(periodOptions.find(p=>p.type==="month"&&p.ayId===ay&&p.mi===selMonth)||periodOptions[0]);

              const getActualForCat=(catId,period)=>{
                const pYr=data.years.find(y=>y.id===period.ayId);
                const pStartYr=pYr?.startDate?new Date(pYr.startDate+"T12:00:00").getFullYear():2026;
                if(period.type==="month"){
                  const calMo=(period.mi+7)%12;
                  const calYr=pStartYr+(period.mi>=5?1:0);
                  return allEntriesFlat.filter(e=>{const dt=new Date(e.date+"T12:00:00");return dt.getMonth()===calMo&&dt.getFullYear()===calYr&&e.catId===catId;}).reduce((a,e)=>a+Number(e.amount),0);
                } else {
                  return MONTH_NAMES.reduce((sum,m,mi)=>{
                    const calMo=(mi+7)%12;
                    const calYr=pStartYr+(mi>=5?1:0);
                    return sum+allEntriesFlat.filter(e=>{const dt=new Date(e.date+"T12:00:00");return dt.getMonth()===calMo&&dt.getFullYear()===calYr&&e.catId===catId;}).reduce((a,e)=>a+Number(e.amount),0);
                  },0);
                }
              };

              const cmpData=cats.map((c,i)=>{
                const a=Math.round(getActualForCat(c.id,defaultA));
                const b=Math.round(getActualForCat(c.id,defaultB));
                return {name:c.label,A:a,B:b,delta:b-a,color:CHART_COLORS[i%CHART_COLORS.length]};
              }).filter(r=>r.A>0||r.B>0);

              return (
                <Card>
                  <SectionTitle>Comparison</SectionTitle>
                  <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14,flexWrap:"wrap"}}>
                    <PeriodPicker value={compareA||defaultA} onChange={setCompareA} yearsList={data.years}/>
                    <span style={{fontSize:13,color:C.gray}}>vs</span>
                    <PeriodPicker value={compareB||defaultB} onChange={setCompareB} yearsList={data.years}/>
                  </div>
                  {cmpData.length===0
                    ? <div style={{textAlign:"center",padding:"28px 16px",fontSize:12,color:C.textMid,border:`1px dashed ${C.borderDark}`,borderRadius:12,background:C.surface}}>No spending logged for either period — entries will appear here once you log them.</div>
                    : <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={cmpData} barGap={3} barCategoryGap="28%" onMouseMove={barMove("cmp")} onMouseLeave={()=>setBarHover(null)}>
                      <XAxis dataKey="name" tick={{fontSize:10,fill:C.gray}} axisLine={false} tickLine={false}/>
                      <YAxis tick={{fontSize:11,fill:C.gray}} tickFormatter={v=>"$"+v} axisLine={false} tickLine={false} width={44}/>
                      <Tooltip separator=": " formatter={(v,name)=>[fmt(v), name==="A"?defaultA.label:defaultB.label]} {...tipProps()} cursor={false}/>
                      <Legend formatter={(v)=>v==="A"?defaultA.label:defaultB.label} wrapperStyle={{fontSize:11,paddingTop:8}}/>
                      <Bar dataKey="A" fill={C.teal} radius={[6,6,0,0]} maxBarSize={26}>
                        {cmpData.map((d,i)=><Cell key={i} fill={C.teal} opacity={0.85*barDim("cmp",i)} style={{transition:"opacity 150ms ease"}}/>)}
                      </Bar>
                      <Bar dataKey="B" fill={C.amber} radius={[6,6,0,0]} maxBarSize={26}>
                        {cmpData.map((d,i)=><Cell key={i} fill={C.amber} opacity={barDim("cmp",i)} style={{transition:"opacity 150ms ease"}}/>)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>}
                  {cmpData.length>0 && (
                    <div style={{marginTop:14}}>
                      {/* Column headers */}
                      <div style={{display:"grid",gridTemplateColumns:"1fr 80px 80px 100px",gap:4,padding:"0 0 6px",borderBottom:`1px solid ${C.border}`,marginBottom:2}}>
                        <span style={{fontSize:10,fontWeight:600,color:C.gray,textTransform:"uppercase",letterSpacing:"0.04em"}}>Category</span>
                        <span style={{fontSize:10,fontWeight:600,color:C.teal,textAlign:"right",textTransform:"uppercase",letterSpacing:"0.04em"}}>{defaultA.label}</span>
                        <span style={{fontSize:10,fontWeight:600,color:C.amber,textAlign:"right",textTransform:"uppercase",letterSpacing:"0.04em"}}>{defaultB.label}</span>
                        <span style={{fontSize:10,fontWeight:600,color:C.gray,textAlign:"right",textTransform:"uppercase",letterSpacing:"0.04em"}}>Change</span>
                      </div>
                      {cmpData.sort((a,b)=>Math.abs(b.delta)-Math.abs(a.delta)).map((r,i)=>{
                        const pct=r.A>0?Math.round(Math.abs(r.delta)/r.A*100):null;
                        const up=r.delta>0, down=r.delta<0;
                        return (
                          <div key={i} style={{display:"grid",gridTemplateColumns:"1fr 80px 80px 100px",gap:4,padding:"7px 0",borderBottom:`1px solid ${C.border}`,alignItems:"center"}}>
                            <span style={{fontSize:12,color:C.text}}>{r.name}</span>
                            <span style={{fontSize:12,color:C.gray,textAlign:"right"}}>{fmt(r.A)}</span>
                            <span style={{fontSize:12,color:C.gray,textAlign:"right"}}>{fmt(r.B)}</span>
                            <div style={{display:"flex",justifyContent:"flex-end"}}>
                              {r.delta===0
                                ? <span style={{fontSize:11,color:C.gray}}>—</span>
                                : <span style={{fontSize:11,fontWeight:600,color:up?C.neg:C.green,display:"flex",alignItems:"center",gap:3}}>
                                    <span style={{fontSize:13}}>{up?"↑":"↓"}</span>
                                    {fmt(Math.abs(r.delta))}{pct!==null?` (${pct}%)`:""}
                                  </span>
                              }
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </Card>
              );
            })()}

            {/* Multi-year comparison */}
            <Card>
              <SectionTitle sub="Average month in each academic year — what you can spend vs what you've planned">Spendable vs budget by year</SectionTitle>
              <div style={{display:"flex",gap:20,marginBottom:12}}>
                {[["Spendable /mo",C.teal],["Budget /mo",C.neg]].map(([l,c])=>(
                  <div key={l} style={{display:"flex",alignItems:"center",gap:6,fontSize:12,color:C.gray}}>
                    <div style={{width:10,height:10,borderRadius:3,background:c}}/>{l}
                  </div>
                ))}
              </div>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={barData} barGap={3} onMouseMove={barMove("yr")} onMouseLeave={()=>setBarHover(null)}>
                  <XAxis dataKey="name" tick={{fontSize:12,fill:C.gray}} axisLine={false} tickLine={false}/>
                  <YAxis tick={{fontSize:11,fill:C.gray}} tickFormatter={v=>"$"+v} axisLine={false} tickLine={false} width={44}/>
                  <Tooltip separator=": " formatter={v=>fmt(v)+"/mo"} {...tipProps()} cursor={false}/>
                  <Bar dataKey="Spendable" name="Spendable" fill={C.teal} radius={[6,6,0,0]} maxBarSize={26}>
                    {barData.map((d,i)=><Cell key={i} fill={C.teal} opacity={barDim("yr",i)} style={{transition:"opacity 150ms ease"}}/>)}
                  </Bar>
                  <Bar dataKey="Spend" name="Budget" fill={C.neg} radius={[6,6,0,0]} maxBarSize={26}>
                    {barData.map((d,i)=><Cell key={i} fill={C.neg} opacity={barDim("yr",i)} style={{transition:"opacity 150ms ease"}}/>)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </Card>
          </div>
        );
      })()}

      {/* ══════════════ SAVINGS ══════════════ */}
      {tab==="savings" && (
        <div role="tabpanel" id="tab-panel" aria-labelledby="tab-savings" tabIndex={0} style={{display:"flex",flexDirection:"column",gap:16}}>

          {/* STEP Exam Goals */}
          <Card>
            <SectionTitle>STEP Exam Fund</SectionTitle>
            <div style={{fontSize:11,color:C.gray,marginBottom:14}}>Each Step exam costs ~$670–950. Track your savings here and stop contributing once fully funded.</div>
            {(()=>{
              const examBudget=yr.monthly.exams||0;
              if(examBudget<=0) return null;
              const unfunded=(data.stepGoals||[]).filter(g=>(g.saved||0)<g.targetAmount && !(g.monthlyContribution));
              if(unfunded.length===0) return null;
              const suggested=Math.round(examBudget/unfunded.length);
              return (
                <div style={{display:"flex",alignItems:"flex-start",gap:10,padding:"10px 12px",background:C.tealLight,backdropFilter:"blur(20px)",WebkitBackdropFilter:"blur(20px)",border:`1px solid ${C.tealMid}`,borderRadius:8,marginBottom:14,fontSize:12}}>
                  <span style={{color:C.teal,fontSize:15,flexShrink:0}}>◎</span>
                  <div style={{flex:1,color:C.teal,lineHeight:1.6}}>
                    Your USMLE/Exams budget has <strong>{fmt(examBudget)}/mo</strong> allocated.
                    Apply {unfunded.length>1?`${fmt(suggested)}/mo to each unfunded goal`:`it to ${unfunded[0].label}`} to track progress here.
                    <button className="btn-fill" onClick={()=>{
                      const d=JSON.parse(JSON.stringify(data));
                      unfunded.forEach(g=>{
                        const i=d.stepGoals.findIndex(x=>x.id===g.id);
                        if(i>=0) d.stepGoals[i].monthlyContribution=suggested;
                      });
                      upd(d);
                    }} style={{marginLeft:10,fontSize:11,padding:"3px 10px",borderRadius:8,border:"none",background:C.teal,color:C.bg,cursor:"pointer",fontWeight:600}}>Apply</button>
                  </div>
                </div>
              );
            })()}
            <div style={{display:"flex",flexDirection:"column",gap:14}}>
              {(data.stepGoals||[]).map(g=>{
                const pct=g.targetAmount>0?Math.min(100,Math.round((g.saved||0)/g.targetAmount*100)):0;
                const remaining=Math.max(0,g.targetAmount-(g.saved||0));
                const funded=remaining===0;
                const monthsToFund=(!funded&&(g.monthlyContribution||0)>0)?Math.ceil(remaining/g.monthlyContribution):null;
                const projDateObj=monthsToFund!=null?(()=>{const d=new Date();d.setMonth(d.getMonth()+monthsToFund);return d;})():null;
                const projDateStr=projDateObj?projDateObj.toLocaleDateString("en-US",{month:"short",year:"numeric"}):null;
                const examDateObj=g.targetDate?new Date(g.targetDate+"T12:00:00"):null;
                const onTrack=projDateObj&&examDateObj?projDateObj<=examDateObj:null;
                const monthsUntilExam=examDateObj?Math.max(1,Math.ceil((examDateObj-new Date())/2628000000)):null;
                const neededMonthly=(!funded&&monthsUntilExam)?Math.ceil(remaining/monthsUntilExam):null;
                return (
                  <div key={g.id} style={{padding:"14px",border:`1px solid ${funded?C.green:C.border}`,borderRadius:8,background:C.surface,backdropFilter:"blur(20px)",WebkitBackdropFilter:"blur(20px)"}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
                      <div style={{display:"flex",gap:12,alignItems:"center"}}>
                        <RingProgress value={g.saved||0} max={g.targetAmount} color={funded?C.green:C.teal}/>
                        <div>
                          <div style={{fontWeight:700,fontSize:14,color:C.text}}>{g.label}</div>
                          <div style={{fontSize:11,color:C.gray,marginTop:2}}>
                            {funded?"Fully funded":`${fmt(g.saved||0)} saved · ${fmt(remaining)} to go · target ${fmt(g.targetAmount)}`}
                          </div>
                        </div>
                      </div>
                      <div style={{display:"flex",gap:6,alignItems:"center"}}>
                        {!funded&&onTrack===true&&<Pill ok>On track</Pill>}
                        {!funded&&onTrack===false&&<Pill warn>Behind</Pill>}
                        {!funded&&onTrack==null&&<Pill neutral>No monthly plan</Pill>}
                        <Pill ok={funded} warn={!funded&&pct<50} neutral={!funded&&pct>=50}>{pct}%</Pill>
                      </div>
                    </div>

                    {/* Date comparison row */}
                    {!funded&&(
                      <div style={{display:"flex",gap:16,marginTop:10,flexWrap:"wrap"}}>
                        <div>
                          <div style={{fontSize:10,color:C.gray,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:2}}>Exam date</div>
                          <DateField value={g.targetDate||""} onChange={v=>{const d=JSON.parse(JSON.stringify(data));const i=d.stepGoals.findIndex(x=>x.id===g.id);if(i>=0)d.stepGoals[i].targetDate=v;upd(d);}} ariaLabel={"Target date for "+g.label} style={{width:"auto",fontSize:12,padding:"4px 8px"}}/>
                        </div>
                        <div>
                          <div style={{fontSize:10,color:C.gray,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:2}}>Funded by (projected)</div>
                          <div style={{fontSize:13,fontWeight:600,color:onTrack===false?C.neg:onTrack===true?C.green:C.text,padding:"4px 0"}}>
                            {projDateStr||"—"}
                            {onTrack===false&&neededMonthly&&<span style={{fontSize:11,color:C.amber,marginLeft:8}}>needs {fmt(neededMonthly)}/mo to hit deadline</span>}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Controls row */}
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:10,paddingTop:10,borderTop:`1px solid ${C.border}`,flexWrap:"wrap",gap:8}}>
                      <div style={{display:"flex",alignItems:"center",gap:8,fontSize:12}}>
                        <span style={{color:C.gray}}>Monthly:</span>
                        <input type="number" value={g.monthlyContribution||0} aria-label={`Monthly contribution for ${g.label}`} onChange={e=>{const d=JSON.parse(JSON.stringify(data));const i=d.stepGoals.findIndex(x=>x.id===g.id);if(i>=0)d.stepGoals[i].monthlyContribution=Number(e.target.value)||0;upd(d);}} style={{width:68,textAlign:"right",fontSize:12,border:`1px solid ${C.border}`,borderRadius:8,padding:"3px 7px",background:C.bg,color:C.text}}/>
                        <span style={{color:C.gray}}>/mo</span>
                        <span style={{color:C.gray,marginLeft:8}}>Target:</span>
                        <input type="number" value={g.targetAmount} aria-label={`Target amount for ${g.label}`} onChange={e=>{const d=JSON.parse(JSON.stringify(data));const i=d.stepGoals.findIndex(x=>x.id===g.id);if(i>=0)d.stepGoals[i].targetAmount=Number(e.target.value)||0;upd(d);}} style={{width:68,textAlign:"right",fontSize:12,border:`1px solid ${C.border}`,borderRadius:8,padding:"3px 7px",background:C.bg,color:C.text}}/>
                      </div>
                      {!funded&&<button className="btn-fill" onClick={()=>{setSavingsDepositGoal(g.id);setSavingsDepositDate(todayStr());}} style={{fontSize:12,padding:"6px 16px",borderRadius:8,border:"none",background:C.teal,color:C.bg,cursor:"pointer",fontWeight:600}}>Log deposit</button>}
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>

          {/* Deposit History */}
          <Card>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
              <SectionTitle>Deposit History</SectionTitle>
              <span style={{fontSize:11,color:C.gray}}>{(data.savingsLog||[]).length} {(data.savingsLog||[]).length===1?"entry":"entries"}</span>
            </div>
            {(data.savingsLog||[]).length===0
              ?<EmptyState>No deposits logged yet — use "Log deposit" above.</EmptyState>
              :[...(data.savingsLog||[])].sort((a,b)=>b.date.localeCompare(a.date)).map((entry,i)=>{
                  const allGoals=[...(data.stepGoals||[]),...(data.savingsGoals||[])];
                  const goal=allGoals.find(g=>g.id===entry.goalId);
                  return (
                    <div key={i} style={{display:"flex",alignItems:"center",gap:12,padding:"8px 0",borderBottom:`1px solid ${C.border}`,fontSize:12}}>
                      <div style={{width:8,height:8,borderRadius:99,background:C.teal,flexShrink:0}}/>
                      <div style={{flex:1}}>
                        <span style={{fontWeight:600,color:C.text}}>{goal?.label||"Unknown goal"}</span>
                        {entry.note&&<span style={{color:C.gray}}> · {entry.note}</span>}
                        <div style={{fontSize:11,color:C.gray,marginTop:2}}>{fmtDay(entry.date)}</div>
                      </div>
                      <span style={{fontWeight:700,color:C.teal}}>{fmt(entry.amount)}</span>
                      <XBtn label="Undo deposit" onClick={()=>{
                        const d=JSON.parse(JSON.stringify(data));
                        const slEntry=(d.savingsLog||[]).find(s=>s.id===entry.id);
                        reverseDepositGroup(d, slEntry);
                        upd(d);
                      }}/>
                    </div>
                  );
                })
            }
          </Card>

          {/* Custom Goals */}
          <Card>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
              <SectionTitle>Custom Goals</SectionTitle>
              <button className="btn-pop" onClick={()=>setShowAddSavingsGoal(true)} style={{fontSize:12,padding:"5px 14px",borderRadius:8,border:`1px solid ${C.border}`,background:"transparent",color:C.gray,cursor:"pointer",fontWeight:500}}>+ Add goal</button>
            </div>
            {(data.savingsGoals||[]).length===0
              ?<EmptyState>No custom goals yet — add one above.</EmptyState>
              :(data.savingsGoals||[]).map((g,gi)=>{
                const pct=g.targetAmount>0?Math.min(100,Math.round((g.saved||0)/g.targetAmount*100)):0;
                const remaining=Math.max(0,g.targetAmount-(g.saved||0));
                const funded=remaining===0;
                const monthsToFund=(!funded&&g.monthlyContribution>0)?Math.ceil(remaining/g.monthlyContribution):null;
                const projDate=monthsToFund!=null?(()=>{const d=new Date();d.setMonth(d.getMonth()+monthsToFund);return d.toLocaleDateString("en-US",{month:"short",year:"numeric"});})():null;
                return (
                  <div key={g.id} style={{padding:"12px 0",borderBottom:`1px solid ${C.border}`}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                      <span style={{display:"flex",alignItems:"center",gap:10,fontWeight:600,fontSize:13,color:C.text}}><RingProgress value={g.saved||0} max={g.targetAmount} size={34} color={funded?C.green:CHART_COLORS[(gi+2)%CHART_COLORS.length]}/>{g.label}</span>
                      <div style={{display:"flex",alignItems:"center",gap:8}}>
                        <Pill ok={funded} warn={!funded&&pct<50}>{pct}%</Pill>
                        {!funded&&<button className="btn-fill" onClick={()=>{setSavingsDepositGoal(g.id);setSavingsDepositDate(todayStr());}} style={{fontSize:11,padding:"4px 10px",borderRadius:8,border:"none",background:C.teal,color:C.bg,cursor:"pointer",fontWeight:600}}>+</button>}
                        <XBtn label={"Delete goal "+g.label} danger onClick={()=>{const d=JSON.parse(JSON.stringify(data));d.savingsGoals=d.savingsGoals.filter(x=>x.id!==g.id);upd(d);}}/>
                      </div>
                    </div>
                    <div style={{fontSize:11,color:C.gray,marginTop:4}}>{fmt(g.saved||0)} / {fmt(g.targetAmount)}{projDate&&!funded?` · funded by ${projDate}`:""}</div>
                  </div>
                );
              })
            }
          </Card>

          {/* Growth Projector */}
          <Card>
            <SectionTitle>Growth Projector</SectionTitle>
            <div style={{fontSize:11,color:C.gray,marginBottom:12}}>How your running balance + monthly savings could grow over 60 months at a given APY (e.g. a HYSA).</div>
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16,flexWrap:"wrap"}}>
              <span style={{fontSize:13,color:C.textMid,fontWeight:500}}>APY</span>
              <input type="number" step="0.1" value={savingsApy} onChange={e=>setSavingsApy(e.target.value)} aria-label="Savings APY percent" style={{width:68,fontSize:13,border:`1px solid ${C.border}`,borderRadius:8,padding:"5px 8px",background:C.bg,color:C.text,textAlign:"center"}}/>
              <span style={{fontSize:12,color:C.gray}}>%</span>
              <span style={{fontSize:12,color:C.gray,marginLeft:4}}>Starting balance: <strong style={{color:totalAccumulatedBalance>=0?C.teal:C.neg}}>{fmtS(totalAccumulatedBalance)}</strong></span>
              <span style={{fontSize:12,color:C.gray}}>+ {fmt(yr.monthly.savings||0)}/mo savings</span>
            </div>
            {(()=>{
              const apy=parseFloat(savingsApy)||0;
              const r=apy/100/12;
              const mSav=Number(yr.monthly.savings)||0;
              const projData=Array.from({length:60}).map((_,i)=>{
                const mo=i+1;
                const compBal=totalAccumulatedBalance*Math.pow(1+r,mo);
                const savGrowth=r>0?mSav*(Math.pow(1+r,mo)-1)/r:mSav*mo;
                return {name:mo%12===0?`Yr ${mo/12}`:(mo===1?"Now":""),month:mo,balance:Math.round(compBal+savGrowth)};
              });
              // Months to graduation = months from now to last year's end date
              const lastYearEnd = new Date(data.years[data.years.length-1].endDate||"2031-06-30");
              const now = new Date();
              const moToGrad = Math.max(1, Math.round((lastYearEnd - now) / (1000*60*60*24*30.44)));
              const gradIdx = Math.min(moToGrad, 60) - 1;
              const gradBal = projData[gradIdx]?.balance ?? projData[projData.length-1]?.balance;
              const hysa4pct = totalAccumulatedBalance * 0.045;
              const checkingEst = 0;
              const hysaGain = Math.round(hysa4pct - checkingEst);
              return (
                <>
                  <ResponsiveContainer width="100%" height={180}>
                    <AreaChart data={projData} margin={{top:4,right:4,bottom:0,left:0}}>
                      <defs>
                        <linearGradient id="projGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={C.teal} stopOpacity={0.3}/>
                          <stop offset="95%" stopColor={C.teal} stopOpacity={0.02}/>
                        </linearGradient>
                      </defs>
                      <XAxis dataKey="name" tick={{fontSize:11,fill:C.gray}} axisLine={false} tickLine={false}/>
                      <YAxis tick={{fontSize:11,fill:C.gray}} tickFormatter={v=>v>=1000?"$"+Math.round(v/1000)+"k":("$"+v)} axisLine={false} tickLine={false} width={44}/>
                      <Tooltip separator=": " formatter={v=>[fmt(v),"Projected balance"]} {...tipProps()}/>
                      <ReferenceLine y={0} stroke={C.border} strokeDasharray="4 2"/>
                      <Area type="monotone" dataKey="balance" stroke={C.teal} fill="url(#projGrad)" strokeWidth={2.5}/>
                    </AreaChart>
                  </ResponsiveContainer>
                  <div style={{display:"flex",gap:12,marginTop:14,flexWrap:"wrap"}}>
                    <div style={{flex:1,minWidth:160,background:C.surface,backdropFilter:"blur(20px)",WebkitBackdropFilter:"blur(20px)",borderRadius:8,padding:"12px 14px",border:`1px solid ${C.border}`}}>
                      <div style={{fontSize:11,color:C.gray,marginBottom:4}}>Projected graduation balance</div>
                      <div style={{fontSize:20,fontWeight:700,color:gradBal>=0?C.teal:C.neg,fontFamily:"'Newsreader',Georgia,serif"}}>{gradBal>=0?"+":""}{fmt(gradBal)}</div>
                      <div style={{fontSize:10,color:C.gray,marginTop:2}}>in ~{moToGrad} months at {apy||0}% APY</div>
                    </div>
                    {totalAccumulatedBalance>500 && hysaGain>0 && (
                      <div style={{flex:1,minWidth:160,background:C.surface,backdropFilter:"blur(20px)",WebkitBackdropFilter:"blur(20px)",borderRadius:8,padding:"12px 14px",border:`1px solid ${C.border}`}}>
                        <div style={{fontSize:11,color:C.gray,marginBottom:4}}>HYSA interest / year</div>
                        <div style={{fontSize:20,fontWeight:700,color:C.green,fontFamily:"'Newsreader',Georgia,serif"}}>+{fmt(hysaGain)}</div>
                        <div style={{fontSize:10,color:C.gray,marginTop:2}}>on your {fmt(totalAccumulatedBalance)} total balance at 4.5% APY</div>
                      </div>
                    )}
                  </div>
                </>
              );
            })()}
          </Card>

          {/* Recommendations */}
          <Card>
            <SectionTitle>Recommendations</SectionTitle>
            {(()=>{
              const recs=[];
              const apy=parseFloat(savingsApy)||0;
              const mSav=Number(yr.monthly.savings)||0;

              // STEP goals
              const stepGoals=data.stepGoals||[];
              const stepSaved=stepGoals.reduce((a,g)=>a+(g.saved||0),0);
              const stepNeeded=stepGoals.reduce((a,g)=>a+g.targetAmount,0);
              const stepGap=Math.max(0,stepNeeded-stepSaved);
              const examBudget=yr.monthly.exams||0;
              if(stepGap>0){
                if(examBudget>0){
                  const moToFund=Math.ceil(stepGap/examBudget);
                  const fundDate=new Date(); fundDate.setMonth(fundDate.getMonth()+moToFund);
                  const fundLabel=fundDate.toLocaleString("default",{month:"short",year:"numeric"});
                  recs.push({color:C.amber,text:`STEP fund gap: ${fmt(stepGap)} remaining. At your current ${fmt(examBudget)}/mo exam budget, fully funded by ${fundLabel}.`});
                } else {
                  recs.push({color:C.neg,text:`STEP fund gap: ${fmt(stepGap)} still needed. Add an Exams budget line — even ${fmt(Math.ceil(stepGap/24))}/mo gets you there by Year 3.`});
                }
              } else if(stepGoals.length>0){
                recs.push({color:C.green,text:"All STEP exam goals are fully funded — excellent! You're set for board exams."});
              }

              // Savings line
              if(!mSav){
                recs.push({color:C.neg,text:"No savings line in your budget. Even $50–100/mo builds a 3-month emergency fund before residency."});
              } else {
                const annualSav=mSav*12;
                const r=apy/100/12;
                const lastYearEnd=new Date(data.years[data.years.length-1].endDate||"2031-06-30");
                const moLeft=Math.max(1,Math.round((lastYearEnd-new Date())/(1000*60*60*24*30.44)));
                const savGrowth=r>0?mSav*(Math.pow(1+r,moLeft)-1)/r:mSav*moLeft;
                recs.push({color:C.teal,text:`You're saving ${fmt(mSav)}/mo (${fmt(annualSav)}/yr). Over your remaining ~${moLeft} months of school, that compounds to ${fmt(Math.round(savGrowth))} at ${apy||0}% APY.`});
              }

              // HYSA recommendation
              if(totalAccumulatedBalance>500){
                const hysaEarn=Math.round(totalAccumulatedBalance*0.045);
                recs.push({color:C.green,text:`Your ${fmt(totalAccumulatedBalance)} total balance earns ~${fmt(hysaEarn)}/yr in a 4.5% HYSA vs ~$0 sitting in a checking account.`});
              } else if(totalAccumulatedBalance<0){
                recs.push({color:C.neg,text:`Total balance is ${fmtS(totalAccumulatedBalance)} — you're drawing down your buffer. Review your largest spending categories.`});
              }

              // Monthly surplus routing
              if(moSurplus>50){
                const unroutedGoals=(data.savingsGoals||[]).filter(g=>(g.saved||0)<g.targetAmount);
                if(unroutedGoals.length>0){
                  recs.push({color:C.teal,text:`${fmt(moSurplus)}/mo surplus unrouted. Adding it to "${unroutedGoals[0].label}" funds it ${fmt(moSurplus*12)} faster per year.`});
                } else {
                  recs.push({color:C.teal,text:`${fmt(moSurplus)}/mo surplus available. Consider routing it to a new goal — residency interview travel costs $3–5k on average.`});
                }
              }

              // All goals funded
              const allCustomFunded=(data.savingsGoals||[]).every(g=>(g.saved||0)>=g.targetAmount);
              if(allCustomFunded&&stepGap===0&&(data.savingsGoals||[]).length===0&&stepGoals.length>0){
                recs.push({color:C.blue,text:"All goals funded! Consider adding a custom goal — laptop upgrade, interview travel, or a 6-month emergency fund."});
              }

              if(recs.length===0) recs.push({color:C.gray,text:"Add budget lines and savings goals to get personalized recommendations here."});

              return recs.map((r,i)=>(
                <div key={i} style={{display:"flex",alignItems:"flex-start",gap:10,padding:"10px 0",borderBottom:i<recs.length-1?`1px solid ${C.border}`:"none",fontSize:12}}>
                  <div style={{width:8,height:8,borderRadius:99,background:r.color,flexShrink:0,marginTop:4}}/>
                  <span style={{color:C.textMid,lineHeight:1.7}}>{r.text}</span>
                </div>
              ));
            })()}
          </Card>

        </div>
      )}

      {/* ══════════════ AID & DETAIL ══════════════ */}
      {tab==="aid" && (
        <div role="tabpanel" id="tab-panel" aria-labelledby="tab-aid" tabIndex={0} style={{display:"flex",flexDirection:"column",gap:16}}>
          {!dismissed["aidnote"] && (
            <Banner type="info" onClose={()=>dismiss("aidnote")}>
              <strong>How your grant works:</strong> Your grant (including health insurance) − tuition & fees − health insurance = disbursed to you for living costs.
            </Banner>
          )}

          {/* Per-year cards */}
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(300px,1fr))",gap:14}}>
            {data.years.map((y,i)=>{
              const g=Number(y.grant)||0,tf=Number(y.tuitionFees)||0,hi=Number(y.healthIns)||0;
              const disb=Math.max(g-tf-hi,0),oth=(Number(y.otherIncome)||0)*12;
              const moD=(disb+oth)/12,moSp=moTotal({...y.monthly,subs:subsMo}),moS=moD-moSp;
              return (
                <Card key={y.id}>
                  {/* Pinned top-right so it never wraps down beside the pill */}
                  {data.years.length>1 && <div style={{position:"absolute",top:12,right:12,zIndex:1}}><XBtn label="Remove year" onClick={()=>setConfirmYearRemove(y.id)} size={30}/></div>}
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:14,flexWrap:"wrap",gap:8,rowGap:10,paddingRight:data.years.length>1?34:0}}>
                    <div>
                      <div style={{fontWeight:700,fontSize:14,color:C.text}}>{y.label}</div>
                      <div style={{display:"flex",gap:6,marginTop:6,alignItems:"center",flexWrap:"wrap"}}>
                        <DateField value={y.startDate||""} onChange={v=>{const d=JSON.parse(JSON.stringify(data));d.years[i].startDate=v;upd(d);}} ariaLabel="Year start date" style={{width:"auto",fontSize:12,padding:"5px 8px"}}/>
                        <span style={{fontSize:11,color:C.gray}}>→</span>
                        <DateField value={y.endDate||""} onChange={v=>{const d=JSON.parse(JSON.stringify(data));d.years[i].endDate=v;upd(d);}} ariaLabel="Year end date" style={{width:"auto",fontSize:12,padding:"5px 8px"}}/>
                      </div>
                    </div>
                    <Pill ok={moS>=0} warn={moS<0}>{fmtS(moS)}/mo</Pill>
                  </div>
                  {[
                    {label:"Grant (annual)",       field:"grant",       note:"includes health insurance"},
                    {label:"Tuition & fees",            field:"tuitionFees", note:"paid directly to school"},
                    {label:"Health insurance",          field:"healthIns",   note:"school-covered, deducted from grant"},
                    {label:"Housing (monthly)",         field:null,          value:y.monthly.housing||0, note:"per month", isHousing:true},
                    {label:"Other income (monthly)",    field:"otherIncome", note:"tutoring, work, etc."},
                  ].map(({label,field,note,value,isHousing})=>(
                    <div key={label} style={{padding:"5px 0",borderBottom:`1px solid ${C.border}`}}>
                      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                        <span style={{fontSize:12,color:C.textMid}}>{label}</span>
                        {isHousing
                          ? <input type="number" value={y.monthly.housing||0} aria-label={`${label} — ${y.label||'Year '+(i+1)}`} onChange={e=>{const d=JSON.parse(JSON.stringify(data));d.years[i].monthly.housing=Number(e.target.value)||0;upd(d);}}
                              style={{width:90,textAlign:"right",fontSize:12,border:`1px solid ${C.border}`,borderRadius:8,padding:"4px 7px",background:C.bg,color:C.text}}/>
                          : <input type="number" value={y[field]} aria-label={`${label} — ${y.label||'Year '+(i+1)}`} onChange={e=>setYrF(i,field,e.target.value)}
                              style={{width:90,textAlign:"right",fontSize:12,border:`1px solid ${C.border}`,borderRadius:8,padding:"4px 7px",background:C.bg,color:C.text}}/>
                        }
                      </div>
                      <div style={{fontSize:10,color:C.gray,marginTop:1}}>{note}</div>
                    </div>
                  ))}
                  <div style={{marginTop:12,padding:"10px 12px",background:C.tealLight,backdropFilter:"blur(20px)",WebkitBackdropFilter:"blur(20px)",border:`1px solid ${C.tealMid}`,borderRadius:8,fontSize:12}}>
                    <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}><span style={{color:C.textMid}}>Disbursed/yr</span><strong style={{color:C.teal}}>{fmt(disb)}</strong></div>
                    <div style={{display:"flex",justifyContent:"space-between"}}><span style={{color:C.textMid}}>Monthly spendable</span><strong style={{color:C.teal}}>{fmt(moD)}/mo</strong></div>
                  </div>
                </Card>
              );
            })}
            <button type="button" aria-label="Add year" onClick={()=>setShowAddYear(true)} style={{width:"100%",font:"inherit",background:"transparent",border:`2px dashed ${C.border}`,borderRadius:12,minHeight:120,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:8,cursor:"pointer",color:C.gray,transition:"border-color 0.15s, color 0.15s"}}
              onMouseEnter={e=>{e.currentTarget.style.borderColor=C.teal;e.currentTarget.style.color=C.teal;}}
              onMouseLeave={e=>{e.currentTarget.style.borderColor=C.border;e.currentTarget.style.color=C.gray;}}>
              <span style={{fontSize:24,fontWeight:300,lineHeight:1}}>+</span>
              <span style={{fontSize:12,fontWeight:600}}>Add year</span>
            </button>
          </div>

          {/* 5-year table */}
          <Card>
            <SectionTitle>{data.years.length}-year overview</SectionTitle>
            <ScrollX className="scrollx" style={{overflowX:"auto"}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                <thead><tr>
                  {["Year","Grant","School costs","Disbursed/yr","Spendable/mo","Budget/mo","Surplus/mo","Cumulative"].map(h=>
                    <th key={h} style={{textAlign:"left",fontSize:10,color:C.gray,padding:"6px 8px",borderBottom:`1px solid ${C.border}`,fontWeight:600,whiteSpace:"nowrap"}}>{h}</th>
                  )}
                </tr></thead>
                <tbody>
                  {(()=>{
                    let cum=0;
                    return data.years.map(y=>{
                      const g=Number(y.grant)||0,tf=Number(y.tuitionFees)||0,hi=Number(y.healthIns)||0;
                      const disb=Math.max(g-tf-hi,0),oth=(Number(y.otherIncome)||0)*12;
                      const moD=(disb+oth)/12,moSp=moTotal({...y.monthly,subs:subsMo}),moS=moD-moSp;
                      cum+=moS*12;
                      return <tr key={y.id}>
                        <td style={{padding:"8px",fontWeight:600,whiteSpace:"nowrap",fontSize:11,color:C.text}}>{y.label}</td>
                        <td style={{padding:"8px",color:C.neg,fontWeight:600}}>{g>0?fmt(g):"TBD"}</td>
                        <td style={{padding:"8px",color:C.gray}}>{fmt(tf+hi)}</td>
                        <td style={{padding:"8px",color:C.teal,fontWeight:600}}>{fmt(disb)}</td>
                        <td style={{padding:"8px",fontWeight:600,color:C.text}}>{fmt(moD)}</td>
                        <td style={{padding:"8px",color:C.text}}>{fmt(moSp)}</td>
                        <td style={{padding:"8px",fontWeight:600,color:moS>=0?C.teal:C.neg}}>{fmtS(moS)}</td>
                        <td style={{padding:"8px",fontWeight:700,color:cum>=0?C.teal:C.neg}}>{fmtS(cum)}</td>
                      </tr>;
                    });
                  })()}
                </tbody>
              </table>
            </ScrollX>
            <div style={{marginTop:10,padding:"8px 12px",background:totDisburse-totSpend>=0?C.tealLight:C.negLight,backdropFilter:"blur(20px)",WebkitBackdropFilter:"blur(20px)",border:`1px solid ${totDisburse-totSpend>=0?C.tealMid:C.negMid}`,borderRadius:8,fontSize:12,color:totDisburse-totSpend>=0?C.teal:C.neg,fontWeight:600}}>
              {data.years.length}-year net: {fmtS(totDisburse-totSpend)}
            </div>
          </Card>

        </div>
      )}

      {/* ══════════════ SUBSCRIPTIONS ══════════════ */}
      {tab==="subscriptions" && (
        <div role="tabpanel" id="tab-panel" aria-labelledby="tab-subscriptions" tabIndex={0} style={{display:"flex",flexDirection:"column",gap:16}}>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(min(100%,300px),1fr))",gap:16}}>
            {/* Form */}
            <Card>
              <SectionTitle>{subEdit?"Edit subscription":"Add subscription"}</SectionTitle>
              {subName && (
                <div style={{display:"flex",alignItems:"center",gap:10,padding:"10px 12px",background:C.surface,borderRadius:8,marginBottom:14,border:`1px solid ${C.border}`}}>
                  <BrandIcon name={subName} size={32}/>
                  <span style={{fontSize:12,color:C.textMid,fontStyle:"italic"}}>Preview</span>
                </div>
              )}
              <div style={{display:"flex",flexDirection:"column",gap:10}}>
                <div>
                  <div style={{fontSize:11,color:C.gray,marginBottom:4,fontWeight:500}}>Service name</div>
                  <input placeholder="e.g. Spotify, UWorld, Netflix" value={subName} onChange={e=>setSubName(e.target.value)}
                    style={{width:"100%",fontSize:13,border:`1px solid ${C.border}`,borderRadius:8,padding:"8px 10px",background:C.bg,boxSizing:"border-box"}}/>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                  <div>
                    <div style={{fontSize:11,color:C.gray,marginBottom:4,fontWeight:500}}>Amount ($)</div>
                    <input type="number" placeholder="9.99" value={subAmt} onChange={e=>setSubAmt(e.target.value)}
                      style={{width:"100%",fontSize:13,border:`1px solid ${C.border}`,borderRadius:8,padding:"8px 10px",background:C.bg,boxSizing:"border-box"}}/>
                  </div>
                  <div>
                    <div style={{fontSize:11,color:C.gray,marginBottom:4,fontWeight:500}}>Billing cycle</div>
                    <select value={subCycle} onChange={e=>setSubCycle(e.target.value)} aria-label="Billing cycle"
                      style={{width:"100%",fontSize:13,border:`1px solid ${C.border}`,borderRadius:8,padding:"8px 10px",background:C.bg,boxSizing:"border-box"}}>
                      <option value="monthly">Monthly</option>
                      <option value="annual">Annual</option>
                      <option value="quarterly">Quarterly</option>
                      <option value="one-time">One-time</option>
                    </select>
                  </div>
                </div>
                <div>
                  <div style={{fontSize:11,color:C.gray,marginBottom:4,fontWeight:500}}>Next renewal date</div>
                  <DateField value={subRenew} onChange={setSubRenew} ariaLabel="Next renewal date"/>
                </div>
                <div style={{display:"flex",gap:8,marginTop:2}}>
                  {subEdit && <button className="btn-pop" onClick={()=>{setSubEdit(null);setSubName("");setSubAmt("");setSubCycle("monthly");setSubRenew("");}} style={{padding:"9px 14px",fontSize:13,border:`1px solid ${C.border}`,borderRadius:8,background:"transparent",cursor:"pointer",color:C.gray}}>Cancel</button>}
                  <button className="btn-fill" onClick={saveSub} disabled={!subName.trim()||!(parseFloat(subAmt)>0)} style={{flex:1,padding:"9px",fontSize:13,fontWeight:600,border:"none",borderRadius:8,background:(!subName.trim()||!(parseFloat(subAmt)>0))?C.surface:C.teal,color:(!subName.trim()||!(parseFloat(subAmt)>0))?C.gray:C.bg,cursor:(!subName.trim()||!(parseFloat(subAmt)>0))?"not-allowed":"pointer"}}>
                    {subEdit?"Save changes":"Add subscription"}
                  </button>
                </div>
              </div>
            </Card>

            {/* Summary */}
            <Card>
              <SectionTitle>Summary</SectionTitle>
              {subs.length===0
                ? <EmptyState>No subscriptions yet — add your first one on the left to track renewals automatically.</EmptyState>
                : (() => {
                    const mo = subMonthlyTotal(subs);
                    const upcoming = subs.filter(s=>{const d=daysUntil(s.renewal);return d!==null&&d>=0&&d<=30;});
                    return <>
                      <div style={{display:"flex",gap:10,marginBottom:16,flexWrap:"wrap"}}>
                        {[{l:"Monthly",v:fmtD(mo)},{l:"Annual",v:fmt(mo*12)},{l:"Active",v:String(subs.filter(s=>s.active!==false).length)}].map(m=>(
                          <div key={m.l} style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:8,padding:"10px 14px",flex:1}}>
                            <div style={{fontSize:10,color:C.gray,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:3}}>{m.l}</div>
                            <div style={{fontSize:18,fontWeight:700,color:C.neg,fontFamily:"'Newsreader',Georgia,serif"}}>{m.v}</div>
                          </div>
                        ))}
                      </div>
                      <div style={{fontSize:12,color:C.textMid,marginBottom:8}}>This {fmtD(mo)}/mo is auto-reflected in your budget.</div>
                      {upcoming.length>0 && <>
                        <Divider/>
                        <div style={{fontSize:12,fontWeight:600,color:C.text,marginBottom:8}}>Upcoming renewals</div>
                        {upcoming.map(s=>{
                          const d=daysUntil(s.renewal);
                          return <div key={s.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"5px 0",borderBottom:`1px solid ${C.border}`,fontSize:12}}>
                            <div style={{display:"flex",alignItems:"center",gap:8}}><BrandIcon name={s.name} size={20}/><span>{s.name}</span></div>
                            <Pill ok={d>7} warn={d<=7} sm>{d===0?"Today":d+"d"}</Pill>
                          </div>;
                        })}
                      </>}
                    </>;
                  })()
              }
            </Card>
          </div>

          {/* Full list */}
          <Card>
            <SectionTitle>{subs.length} subscription{subs.length!==1?"s":""}</SectionTitle>
            {subs.length===0
              ? <div style={{textAlign:"center",padding:"20px 0",color:C.gray,fontSize:13}}>Add your first subscription above.</div>
              : subs.map(s=>{
                  const d=daysUntil(s.renewal);
                  const due=d!==null&&d<=0;
                  const soon=d!==null&&d>0&&d<=7;
                  const mo=s.cycle==="monthly"?s.amount:s.cycle==="annual"?s.amount/12:s.cycle==="quarterly"?s.amount/3:null;
                  return (
                    <div key={s.id} style={{display:"flex",alignItems:"center",gap:12,padding:"10px 0",borderBottom:`1px solid ${C.border}`}}>
                      <BrandIcon name={s.name} size={38}/>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontWeight:600,fontSize:13,color:C.text}}>{s.name}</div>
                        <div style={{fontSize:11,color:C.gray,marginTop:2}}>
                          {fmtD(s.amount)}/{s.cycle}
                          {mo?` · ${fmtD(mo)}/mo`:""}{s.renewal?` · Renews ${s.renewal}`:""}
                        </div>
                      </div>
                      {due && <Pill warn sm>Overdue</Pill>}
                      {soon && <Pill warn sm>{d}d</Pill>}
                      {due && <button className="btn-fill" onClick={()=>setRenewDlg(s)} style={{fontSize:11,padding:"4px 10px",borderRadius:8,border:"none",background:C.amber,color:"#fff",cursor:"pointer",fontWeight:600}}>Handle</button>}
                      <button className="btn-pop" onClick={()=>editSub(s)} style={{fontSize:11,padding:"4px 10px",borderRadius:8,border:`1px solid ${C.border}`,background:"transparent",cursor:"pointer",color:C.gray}}>Edit</button>
                      <button className="btn-fill" onClick={()=>delSub(s.id)} style={{fontSize:11,padding:"4px 10px",borderRadius:8,border:`1px solid ${C.dangerMid}`,background:C.dangerLight,cursor:"pointer",color:C.danger,fontWeight:600}}>Delete</button>
                    </div>
                  );
                })
            }
          </Card>
        </div>
      )}

      {/* ══════════════ CUSTOMIZE ══════════════ */}
      {tab==="customize" && (
        <div role="tabpanel" id="tab-panel" aria-labelledby="tab-customize" tabIndex={0} style={{display:"flex",flexDirection:"column",gap:16}}>
          {/* Lift this card while an icon popover is open — glass cards are stacking contexts,
              so an overflowing absolute popover would otherwise paint under the next card (Key notes). */}
          <Card style={editIconCat||iconPickOpen?{position:"relative",zIndex:50}:undefined}>
            <SectionTitle>Spending categories</SectionTitle>
            {cats.map(cat=>(
              <div key={cat.id} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 0",borderBottom:`1px solid ${C.border}`}}>
                {/* Icon is editable after creation — click to swap */}
                <div style={{position:"relative",flexShrink:0}}>
                  <button className="xbtn" type="button" onClick={()=>setEditIconCat(editIconCat===cat.id?null:cat.id)} aria-label={"Change icon for "+cat.label} title="Change icon" style={{background:"none",border:"none",padding:0,cursor:"pointer",display:"inline-flex",borderRadius:8}}>
                    <CatIcon name={cat.icon||cat.id} color={CHART_COLORS[cats.findIndex(c=>c.id===cat.id)%CHART_COLORS.length]}/>
                  </button>
                  {editIconCat===cat.id && <>
                    <div onClick={()=>setEditIconCat(null)} style={{position:"fixed",inset:0,zIndex:99}}/>
                    <div style={{position:"absolute",left:0,top:"calc(100% + 6px)",zIndex:100,width:236,padding:10,background:C.glassTooltip,backdropFilter:"blur(50px) saturate(200%)",WebkitBackdropFilter:"blur(50px) saturate(200%)",border:`1px solid ${C.borderDark}`,borderRadius:12,boxShadow:"0 8px 32px rgba(0,0,0,0.40)"}}>
                      <CatIconPicker value={cat.icon||cat.id} onChange={v=>{const d=JSON.parse(JSON.stringify(data));d.categories=d.categories.map(c=>c.id===cat.id?{...c,icon:v}:c);upd(d);setEditIconCat(null);}}/>
                    </div>
                  </>}
                </div>
                <span style={{flex:1,fontSize:13,color:C.text}}>{cat.label}</span>
                {cat.locked && <span style={{fontSize:11,color:C.gray,background:C.surface,border:`1px solid ${C.border}`,padding:"2px 8px",borderRadius:8}}>Fixed</span>}
                {cat.autoCalc && <span style={{fontSize:11,color:C.blue,background:C.blueLight,padding:"2px 8px",borderRadius:8}}>Auto</span>}
                {!cat.locked && !cat.autoCalc && <button className="btn-fill" onClick={()=>delCat(cat.id)} style={{fontSize:11,padding:"3px 10px",borderRadius:8,border:`1px solid ${C.dangerMid}`,background:C.dangerLight,color:C.danger,cursor:"pointer",fontWeight:500}}>Remove</button>}
              </div>
            ))}
            <div style={{marginTop:14,display:"flex",flexDirection:"column",gap:10}}>
              <div style={{display:"flex",gap:8,alignItems:"center"}}>
                <button className="btn-pop" type="button" onClick={()=>setIconPickOpen(o=>!o)} title="Choose icon" aria-expanded={iconPickOpen} style={{width:36,height:36,borderRadius:8,display:"inline-flex",alignItems:"center",justifyContent:"center",flexShrink:0,border:`1px solid ${iconPickOpen?C.sel:C.border}`,background:iconPickOpen?C.selBg:"transparent",color:C.text,cursor:"pointer",transition:"all .15s"}}>
                  <Icon name={newCatIcon} size={16} strokeWidth={1.5}/>
                </button>
                <input placeholder="New category name" value={newCatName} onChange={e=>setNewCatName(e.target.value)}
                  style={{flex:1,fontSize:13,border:`1px solid ${C.border}`,borderRadius:8,padding:"8px 10px",background:C.bg}}/>
                <button className="btn-fill" onClick={()=>{addCat();setIconPickOpen(false);}} disabled={!newCatName.trim()} style={{padding:"8px 18px",fontSize:13,fontWeight:600,border:"none",borderRadius:8,background:!newCatName.trim()?C.surface:C.teal,color:!newCatName.trim()?C.gray:C.bg,cursor:!newCatName.trim()?"not-allowed":"pointer"}}>Add</button>
              </div>
              {iconPickOpen && <CatIconPicker value={newCatIcon} onChange={v=>{setNewCatIcon(v);setIconPickOpen(false);}}/>}
            </div>
          </Card>

          <Card>
            <SectionTitle>Key notes</SectionTitle>
            {/* Notes are derived from the user's own numbers (active year + goals), not hardcoded —
                they update as the user fills in the Aid tab, budget, and savings goals. */}
            {(()=>{
              const notes=[];
              const g=Number(yr.grant)||0, tf=Number(yr.tuitionFees)||0, hi=Number(yr.healthIns)||0;
              const housing=Number(yr.monthly.housing)||0;

              // 1. Monthly spendable — from this year's real grant/costs
              if(g>0){
                notes.push({title:`Monthly spendable · ${yr.label}`,
                  body:`Your grant this year is ${fmt(g)}. After ${fmt(tf)} tuition & fees${hi>0?` and ${fmt(hi)} health insurance`:""}, ${fmt(annDisburse)} is disbursed to you — about ${fmt(moSpendable)}/mo for rent, food, transport, and everything else.`});
              } else {
                notes.push({title:"Monthly spendable",
                  body:"Add your grant and school costs in the Aid tab — Marro will then show exactly what you have to spend each month."});
              }

              // 2. Housing ratio — only once rent is entered
              if(housing>0 && moSpendable>0){
                const pct=Math.round(housing/moSpendable*100);
                notes.push({title:"Housing",
                  body:`Your rent is ${fmt(housing)}/mo — ${pct}% of your spendable. ${pct<60?"That's a healthy share (under 60%).":pct<75?"That's on the high side; under 60% leaves more breathing room.":"That's a large share; getting under 60% would free up a lot elsewhere."}`});
              }

              // 3. Health insurance — only if the grant covers it
              if(hi>0){
                notes.push({title:"Health insurance",
                  body:`Your health insurance (${fmt(hi)}/yr) comes out of your grant before it reaches you — it's already accounted for, not part of your living budget.`});
              }

              // 4. USMLE / Step exams — from the user's own goals + exam budget
              const steps=data.stepGoals||[];
              if(steps.length){
                const target=steps.reduce((a,s)=>a+(Number(s.targetAmount)||0),0);
                const saved=steps.reduce((a,s)=>a+(Number(s.saved)||0),0);
                const exB=Number(yr.monthly.exams)||0;
                notes.push({title:"USMLE / Step exams",
                  body:exB>0
                    ? `Your Step exams total about ${fmt(target)}. You've saved ${fmt(saved)} so far at ${fmt(exB)}/mo from your exam budget.`
                    : `Your Step exams will run about ${fmt(target)} total and aren't auto-covered. Add an exam budget line so you're ready when they come.`});
              }

              // 5. Rollover — universal app behavior, not school-specific
              notes.push({title:"Rollover",
                body:"Unspent weekly money rolls into next week automatically. Leftover monthly money rolls into the next month with a suggestion for what to do with it."});

              return notes.map((n,i)=>(
                <div key={i} style={{padding:"10px 0",borderBottom:i<notes.length-1?`1px solid ${C.border}`:"none"}}>
                  <div style={{fontWeight:600,fontSize:12,color:C.text,marginBottom:3}}>{n.title}</div>
                  <div style={{fontSize:12,color:C.gray,lineHeight:1.6}}>{n.body}</div>
                </div>
              ));
            })()}
          </Card>
        </div>
      )}
    </div>
  );
}

// ── PWA silent auto-update ─────────────────────────────────────────────────────
// vite-plugin-pwa precaches the fingerprinted build; when a new deploy is detected
// the service worker installs and *waits*. We never interrupt the user to apply it.
// Instead we swap to the new version silently, only at a provably safe moment:
//   • the tab is backgrounded (visibilityState === "hidden" → the user isn't looking), AND
//   • nothing is mid-flow — no open modal (role="dialog") and no focused text field.
// If that moment never arrives, the waiting worker still activates on its own the
// next time the app is fully closed and reopened. So the update always lands
// eventually, but can never reload the page out from under an in-progress action.
export function SilentUpdater(){
  const { needRefresh:[needRefresh], updateServiceWorker } = useRegisterSW({
    onRegisterError(err){ console.error('SW registration error', err); },
  });
  React.useEffect(() => {
    if(!needRefresh) return;
    const safeToReload = () => {
      if(document.visibilityState !== 'hidden') return false;      // user is watching
      if(document.querySelector('[role="dialog"]')) return false;  // a modal is open
      const ae = document.activeElement;                           // an inline edit is focused
      if(ae && ae.matches && ae.matches('input,textarea,[contenteditable="true"]')) return false;
      return true;
    };
    const attempt = () => { if(safeToReload()) updateServiceWorker(true); };
    document.addEventListener('visibilitychange', attempt);
    attempt(); // already backgrounded when the update landed? apply now.
    return () => document.removeEventListener('visibilitychange', attempt);
  }, [needRefresh, updateServiceWorker]);
  return null;
}
