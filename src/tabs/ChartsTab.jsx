import { useState } from 'react';
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, AreaChart, Area, Legend, ReferenceLine } from 'recharts';
import { C, CHART_COLORS, tipProps } from '../lib/theme.js';
import { fmt, fmtS, MONTH_NAMES } from '../lib/format.js';
import { useEscClose } from '../lib/hooks.js';
import { Card, SectionTitle } from '../components/primitives.jsx';
import { Icon } from '../components/icons.jsx';
import { PeriodPicker } from '../components/pickers.jsx';
import { useApp } from '../context/AppContext.js';

// Charts — running balance, budget vs actual, planned breakdown pie, monthly
// trend, and comparison. All view state (pie month/range, hover, trend + compare
// selections) is private to this tab; the underlying figures come from useApp().
// These chart-view selections reset when you leave Charts, which is fine — they
// are exploratory view config, not saved data.
export function ChartsTab(){
  const { data, ay, cats, yr, yrStartYear, subsMo, selMonth, monthNetFor,
          allEntriesFlat, priorYearsCarryover, totalAccumulatedBalance, barData } = useApp();
  const [pieMonthStart, setPieMonthStart] = useState((new Date().getMonth() - 7 + 12) % 12);
  const [pieHover, setPieHover] = useState(null);
  const [barHover, setBarHover] = useState(null);
  const barDim = (key,i) => barHover && barHover.startsWith(key+":") && barHover!==key+":"+i ? 0.35 : 1;
  const barMove = key => s => setBarHover(s && s.isTooltipActive && s.activeTooltipIndex!=null ? key+":"+s.activeTooltipIndex : null);
  const [pieMonthEnd, setPieMonthEnd] = useState(null);
  const [piePickerOpen, setPiePickerOpen] = useState(false);
  const [trendCats, setTrendCats] = useState(null);
  const [compareA, setCompareA] = useState(null);
  const [compareB, setCompareB] = useState(null);
  useEscClose(piePickerOpen, ()=>setPiePickerOpen(false));

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
                  <SectionTitle sub="if you stay on budget">Planned surplus — {yr.label.split("—")[0].trim()}</SectionTitle>
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
}
