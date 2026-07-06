import { useState } from 'react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, ReferenceLine } from 'recharts';
import { C, CHART_COLORS, tipProps } from '../lib/theme.js';
import { fmt, fmtS, fmtDay, todayStr, MONTH_NAMES, getMonday, getSunday } from '../lib/format.js';
import { Card, SectionTitle, EmptyState, Pill, RingProgress, XBtn, Modal } from '../components/primitives.jsx';
import { DateField } from '../components/pickers.jsx';
import { useApp } from '../context/AppContext.js';
import { logEvent } from '../lib/data.js';

// Savings — STEP exam goals, deposit history, custom goals, growth projector,
// recommendations. Private state: the log-deposit modal, the add-goal modal, and
// the projector APY input (all reset when you leave Savings, which is fine — they
// are transient forms). Shared data/upd + the derived balances come from useApp().
export function SavingsTab(){
  const { data, upd, yr, ay, totalAccumulatedBalance, moSurplus, triggerBloom, reverseDepositGroup } = useApp();
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
  return (
    <>
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
              logEvent('savings_goal_added', {});
            }} disabled={!newGoalLabel.trim()||!(parseFloat(newGoalTarget)>0)} style={{padding:"10px",fontSize:13,fontWeight:600,border:"none",borderRadius:8,background:(!newGoalLabel.trim()||!(parseFloat(newGoalTarget)>0))?C.surface:C.teal,color:(!newGoalLabel.trim()||!(parseFloat(newGoalTarget)>0))?C.gray:C.bg,cursor:(!newGoalLabel.trim()||!(parseFloat(newGoalTarget)>0))?"not-allowed":"pointer",marginTop:4}}>
              Add goal
            </button>
          </div>
        </Modal>
      )}
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
    </>
  );
}
