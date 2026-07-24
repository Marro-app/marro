import { useState } from 'react';
import { C, CHART_COLORS } from '../lib/theme.js';
import { fmt, fmtS, fmtD, fmtA, fmtSA, fmtDay, fmtWeekLabel, todayStr, getMonday, getSunday, MONTH_NAMES, MONTH_FULL, catColorIndex } from '../lib/format.js';
import { WEEKS_PER_MONTH } from '../lib/constants.js';
import { Card, SectionTitle, Banner, MetricTile, ProgressBar, Pill, EmptyState, XBtn, Modal } from '../components/primitives.jsx';
import { CatIcon } from '../components/icons.jsx';
import { DateField } from '../components/pickers.jsx';
import { WeekSelectorModal } from '../components/modals.jsx';
import { useApp } from '../context/AppContext.js';

// Weekly — log actual expenses, category breakdown, and the entries list, plus
// the over-budget warning / week-selector / CSV-import modals (all previously
// hoisted to App). Private state: the log-expense form, the week picker, the
// weekly notice, and CSV import. viewWeek stays shared (via useApp) so browsing
// an archived week survives a tab switch. addEntry/delEntry live here now;
// reverseDeposit (shared with Savings undo) comes from context.
export function WeeklyTab(){
  const { data, upd, cats, ay, subsMo, moSpendable, yrStartYear,
          viewWeek, setViewWeek, archives, currentWeekStart, currentWeekEnd, currentEntries,
          weeklyBudget, lastWeekSurplus, thisWeekBudget, viewEntries, viewTotal, viewBudget,
          getMonthValIdx, dismissed, dismiss, reverseDeposit, rolloverReco, addWeeklyEntry } = useApp();
  const [wCat, setWCat]     = useState("");
  const [wAmt, setWAmt]     = useState("");
  const [wNote, setWNote]   = useState("");
  const [wDate, setWDate]   = useState(todayStr());
  const [showWeekPicker, setShowWeekPicker] = useState(false);
  const [weeklyNotice, setWeeklyNotice] = useState(null);
  const [csvText, setCsvText] = useState("");
  const [csvRows, setCsvRows] = useState(null);
  const [csvError, setCsvError] = useState(null);
  const [showCsvImport, setShowCsvImport] = useState(false);

  const addEntry = () => {
    if(!wCat||!wAmt) return;
    const info = addWeeklyEntry(wCat, wAmt, wNote, wDate);
    setWAmt("");setWNote("");
    if(!info) return;
    if(info.deficit>0){
      setWeeklyNotice({type:"warn", cat:info.isUnbudgeted?info.catLabel:null, month:MONTH_FULL[info.monthIdx], deficit:info.deficit});
    } else if(info.isUnbudgeted){
      setWeeklyNotice({type:"info", cat:info.catLabel, month:MONTH_FULL[info.monthIdx]});
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
  const isPastWeekDate = wDate && getMonday(wDate) < getMonday(new Date());
  const isFutureWeekDate = wDate && getMonday(wDate) > getMonday(new Date());
  const isOtherWeekDate = isPastWeekDate || isFutureWeekDate;

  return (
    <>
      {weeklyNotice && weeklyNotice.type==="warn" && <Modal title={weeklyNotice.month+" is over budget"} onClose={()=>setWeeklyNotice(null)} width={360}>
        <div style={{fontSize:13,color:C.textMid,marginBottom:16,lineHeight:1.6}}>
          {weeklyNotice.month} is now <strong style={{color:C.neg}}>{fmt(weeklyNotice.deficit)}</strong> over your monthly income{weeklyNotice.cat?<>, after logging <strong>{weeklyNotice.cat}</strong></>:""}. This lowers your running balance and year-end net. Consider trimming a category or adjusting your budget.
        </div>
        <button className="btn-fill" onClick={()=>setWeeklyNotice(null)} style={{width:"100%",padding:"10px",fontSize:13,fontWeight:600,border:"none",borderRadius:8,background:C.neg,color:C.bg,cursor:"pointer"}}>Got it</button>
      </Modal>}
      {showWeekPicker && <WeekSelectorModal archives={archives} currentWeekStart={currentWeekStart} currentWeekEnd={currentWeekEnd} selected={viewWeek} onSelect={setViewWeek} onClose={()=>setShowWeekPicker(false)}/>}
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
            if ((m = dateRaw.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/))) {
              dateObj = new Date(+m[1], +m[2]-1, +m[3], 12);
            } else if ((m = dateRaw.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/))) {
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
        <div role="tabpanel" id="tab-panel" aria-labelledby="tab-weekly" tabIndex={0} style={{display:"flex",flexDirection:"column",gap:16}}>
          {weeklyNotice && weeklyNotice.type==="info" && (
            <Banner type="info" onClose={()=>setWeeklyNotice(null)}>
              <strong>{weeklyNotice.cat}</strong> wasn&apos;t in your {weeklyNotice.month} budget, so it&apos;s now tracked under <strong>Unbudgeted spending</strong> in the Budget tab. Tap &quot;Add to budget&quot; there if you want to plan for it.
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
              {label:"Weekly plan",      val:fmt(viewBudget),             sub:lastWeekSurplus>0&&!viewWeek?`base ${fmt(weeklyBudget)} + ${fmt(lastWeekSurplus)} rollover`:`spendable ÷ ${WEEKS_PER_MONTH}`, color:C.teal},
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
                const wkB = moB / WEEKS_PER_MONTH;
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
                    <ProgressBar value={spent} max={wkB} color={over?C.neg:CHART_COLORS[catColorIndex(cat.id,cats)%CHART_COLORS.length]}/>
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
                      <CatIcon name={cat.icon||e.catId} color={CHART_COLORS[catColorIndex(e.catId,cats)%CHART_COLORS.length]||C.gray}/>
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
    </>
  );
}
