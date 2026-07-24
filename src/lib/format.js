import { USMLE_STEP_FEE_ESTIMATE } from './constants.js';

export const BLANK_MONTHLY = {housing:0,food:0,transport:0,personal:0,books:0,exams:0,savings:0,social:0,subs:0};
export const blankYearFields = () => ({ tuitionFees:0, healthIns:0, grant:0, otherIncome:0, housing:0, housingNote:"", livingAllowance:0, notes:"" });

// Tier-1 heuristic academic-year date provider. Budgeting needs the ~12-month
// financial boundary, not day-precision, so we anchor each year near Aug 1.
// This is the swappable seam for the future user-corrected / fetched-calendar
// tiers (LLM-extracted school calendars) — see docs/FUTURE_WORK.md Phase 3 vision.
export const yr2 = y => String(y % 100).padStart(2,"0");
export function generateYearConfigs(startYear, lengthYears){
  const n = Math.max(1, lengthYears|0);
  const out = [];
  for(let i=0;i<n;i++){
    const sy = startYear + i;
    out.push({ id:i, label:`Year ${i+1} — ${sy}-${yr2(sy+1)}`, ...blankYearFields(), startDate:`${sy}-08-01`, endDate:`${sy+1}-08-15` });
  }
  return out;
}

export const DEFAULT_CATS = [
  {id:"housing",  label:"Housing",        locked:true},
  {id:"food",     label:"Food & groceries"},
  {id:"transport",label:"Transportation"},
  {id:"personal", label:"Personal"},
  {id:"books",    label:"Books & supplies"},
  {id:"exams",    label:"USMLE / Exams"},
  {id:"savings",  label:"Savings"},
  {id:"social",   label:"Social & leisure"},
  {id:"subs",     label:"Subscriptions",  autoCalc:true},
];

// A category's color slot, keyed to its IDENTITY, not its position in the list.
// Colours used to be `CHART_COLORS[listIndex]`, so dragging a category to a new
// slot made it adopt that slot's colour — a category's colour visibly jumped on
// every reorder. Now each default category owns its DEFAULT_CATS slot forever,
// and custom categories get stable slots after the defaults ordered by id (the
// `cat_<timestamp>` ids are monotonic, so creation order is stable and adding a
// new one never recolours the existing ones). Every surface that colours a
// category — the budget list, the pie, the legend, the line chart, weekly bars —
// must use THIS, or the list and the charts will disagree.
export function catColorIndex(catId, cats) {
  const di = DEFAULT_CATS.findIndex(c => c.id === catId);
  if (di >= 0) return di;
  const customs = (cats || []).map(c => c.id)
    .filter(id => !DEFAULT_CATS.some(d => d.id === id)).sort();
  const ci = customs.indexOf(catId);
  return DEFAULT_CATS.length + (ci < 0 ? 0 : ci);
}

export const MONTH_NAMES = ["Aug","Sep","Oct","Nov","Dec","Jan","Feb","Mar","Apr","May","Jun","Jul"];
export const MONTH_FULL = ["August","September","October","November","December","January","February","March","April","May","June","July"];

// Progressive setup: bump SETUP_VERSION whenever a NEW onboarding question is added.
// New users answer everything in OnboardingFlow; existing users whose stored
// setupVersion is behind get a focused popup for just the missing step(s).
export const SETUP_VERSION = 2; // v2: added the money step (Phase 2, walkthrough §0) — see onboarding.jsx SETUP_STEPS

export const DEFAULT_STATE = {
  setupVersion: null,  // null = brand new (run onboarding); set to SETUP_VERSION when complete
  categories: DEFAULT_CATS,
  years: generateYearConfigs(new Date().getFullYear(), 4).map(cfg=>({...cfg, monthly:{...BLANK_MONTHLY}, monthlyOverrides:{}})),
  weeklyArchive: [],
  currentWeekEntries: [],
  subscriptions: [],
  logo: null,  // legacy field (kept for sync compatibility)
  monthDisabled: {},  // {"0-Aug":["exams"], "0-Sep":["books"]} — yearId-month: disabled cat ids
  preferredName: null,
  avatar: null,  // {type:"art",style,color} | {type:"google",url} | {type:"upload",url} | null
  // Program track. degree derived from school; dual = null|"phd"|"masters"|"other".
  // phd/masters institution "" = same as the med school. All editable later in Settings.
  program: { degree:"MD", dual:null, phd:{field:"",institution:""}, masters:{field:"",institution:""}, other:{field:"",institution:""} },
  darkMode: false,
  stepGoals: [
    { id:"step1", label:"Step 1", targetAmount:USMLE_STEP_FEE_ESTIMATE, targetDate:"2028-06-01", saved:0, monthlyContribution:50 },
    { id:"step2", label:"Step 2 CK", targetAmount:USMLE_STEP_FEE_ESTIMATE, targetDate:"2029-09-01", saved:0, monthlyContribution:50 },
    { id:"step3", label:"Step 3", targetAmount:1000, targetDate:"2031-06-01", saved:0, monthlyContribution:0 },
  ],
  savingsGoals: [],
  savingsLog: [],
  loans: [],                 // flat top-level, id-keyed — see src/lib/loans.js for the loan shape
  balanceReadings: [],       // [{id, date:"2026-10-01", spendable:6400, savings:12000|null}] append-only, id-keyed
  loanReminderSnooze: null,  // null | {choice:"never", at:iso}
  refundPlaybookSeen: null,  // null | {term:"2027-spring", at:iso} — one card per refund cycle
};

// ── Helpers ───────────────────────────────────────────────────────────────────
export const fmt  = n => "$"+Math.abs(Math.round(n)).toLocaleString();
export const fmtS = n => { const r=Math.round(n); if(r===0) return "$0"; return (r>0?"+":"-")+"$"+Math.abs(r).toLocaleString(); };
export const fmtD = n => "$"+Math.abs(Number(n)||0).toFixed(2);
// Short human date for entry lists ("Jun 8") — raw ISO strings read like database output
export const fmtDay = d => d ? new Date(d+"T12:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric"}) : "";
// Actual money (logged/imported spending): show cents only when they exist — never round real transactions
export const fmtA = n => { const v=Math.abs(Number(n)||0); const cents=Math.round(v*100)%100!==0; return "$"+v.toLocaleString(undefined,cents?{minimumFractionDigits:2,maximumFractionDigits:2}:{maximumFractionDigits:0}); };
export const fmtSA = n => { const v=Number(n)||0; if(Math.round(v*100)===0) return "$0"; return (v>0?"+":"-")+fmtA(v); };
export const moTotal = m => Object.values(m).reduce((a,b)=>a+(Number(b)||0),0);

export const todayStr = () => {
  const d = new Date();
  return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
};

export const getMonday = date => {
  const d = new Date(typeof date === "string" ? date+"T12:00:00" : date);
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1 - day);
  d.setDate(d.getDate() + diff);
  return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
};

export const getSunday = mondayStr => {
  const d = new Date(mondayStr+"T12:00:00");
  d.setDate(d.getDate()+6);
  return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
};

export const fmtWeekLabel = wk => {
  const sun = getSunday(wk);
  const m1 = new Date(wk+"T12:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric"});
  const m2 = new Date(sun+"T12:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric"});
  return `${m1} – ${m2}`;
};

export const daysUntil = dateStr => {
  if(!dateStr) return null;
  // Anchor BOTH ends at local noon: the target uses T12:00:00 to stay DST-safe,
  // so `now` must match it — flooring to midnight added a spurious +0.5 that
  // rounded every future date up by one (today→1, tomorrow→2). See format.test.js.
  const now = new Date(); now.setHours(12,0,0,0);
  const t = new Date(dateStr+"T12:00:00");
  return Math.round((t-now)/86400000);
};

export const subMonthlyTotal = (subs=[]) => subs.filter(s=>s.active!==false).reduce((a,s)=>{
  if(s.cycle==="monthly")   return a+Number(s.amount);
  if(s.cycle==="annual")    return a+Number(s.amount)/12;
  if(s.cycle==="quarterly") return a+Number(s.amount)/3;
  return a;
},0);


// Sanitizes a money <input type="number"> onChange value at the input layer.
// Strips any leading minus (so a user literally can't type their way to a
// negative dollar figure — a negative "Housing (monthly)" used to flip the
// sign of the whole Monthly Plan tile) and, once given a `max`, clamps down
// to it only after the value parses to a real number — so "12." or a lone
// "-" mid-type pass through untouched instead of getting reformatted out
// from under the user's cursor. Returns a string, ready to hold in state.
export const MAX_QUICK_ADD_AMOUNT = 999999;
export const sanitizeMoneyInput = (raw, max = Infinity) => {
  // Strip a leading minus (no negative dollars) AND any leading zeros before
  // the integer part — so a fat-fingered "050" reads back as "50" and "007.5"
  // as "7.5", never the "050" leading-zero display flagged in testing. The
  // lookahead keeps a lone "0" and the "0" in "0.5"/"0.99" intact (only zeros
  // that precede another digit are dropped).
  const s = String(raw).replace(/^-+/, '').replace(/^0+(?=\d)/, '');
  const n = Number(s);
  if (s !== '' && isFinite(n) && n > max) return String(max);
  return s;
};

// Shared onChange helper for money/number inputs. sanitizeMoneyInput strips
// leading zeros in the RETURNED string, but a type="number" controlled input
// bound to a numeric value won't re-render its text when the number is
// unchanged (typing "050" → sanitizes to "50", but 50===50 so React skips the
// DOM update and the field keeps showing "050"). Writing the cleaned string
// back onto the node forces the display to update. Route every money input's
// onChange through this so they all behave; returns the cleaned string.
export const cleanNumEvent = (e, max = Infinity) => {
  const clean = sanitizeMoneyInput(e.target.value, max);
  if (e.target.value !== clean) e.target.value = clean;
  return clean;
};

export const getYearMonthStr = (date) => {
  const d = new Date(date+"T12:00:00");
  return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0");
};

