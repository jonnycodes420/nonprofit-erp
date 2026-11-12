import { T, Spin, fmtFull, interactive, fmt, quietPhrase } from "../shared";
import { Figure } from "../Figure";
import { countLabel } from "../../../../shared/countWords";
import { driftCounts, earlySignsPhrase, EARLY_SIGNS_MEANING } from "../../../../shared/driftWords";
import { periodWords } from "../../../../shared/periodWords.js";   // POLISH-8: a goal names its period

export function heroSection({ GoalStat, daysLeftInPeriod, deltaTxt, fgRollup, fundOverview, g0, goal, goalAmt, goalHeadSub, heroCtx, heroPace, heroPaceCol, isAdmin, isReadOnly, many, onNavigate, openEditGoal, openSetGoal, overAmt, paceLabel, paceSub, pct, period, raised, rawPct, reengStat, twStat }) {
  return (
      fundOverview===undefined?(
        <div className="dash-goal-banner" style={{background:T.white,border:"1px solid "+T.bg2,borderLeft:"4px solid "+T.gold500,borderRadius:16,padding:"16px 22px",color:T.ink3,fontSize:13,display:"flex",alignItems:"center",gap:8}}><Spin/>Loading goals…</div>
      ):heroCtx?(<>
          <div className="dash-goal-banner" style={{background:T.white,border:"1px solid "+T.bg2,borderLeft:"4px solid "+T.gold500,borderRadius:16,padding:"16px 22px",color:T.ink}}>
            <div className="dash-goal-cols" style={{display:"flex",gap:32,flexWrap:"wrap"}}>
              {/* LEFT — the roll-up (or the single goal) */}
              <div style={{flex:"2 1 300px",minWidth:260}}>
                <div style={{fontSize:10,fontWeight:800,color:T.ink3,marginBottom:4}}>{many?"Fundraising, All Active Goals":"Fundraising Goal"}</div>
                <div style={{fontSize:15,fontWeight:600,color:T.ink3,marginBottom:10,maxWidth:440,display:"flex",alignItems:"center",gap:8}}>
                  <span>{many?`${fgRollup.activeGoalCount} goals toward ${fmtFull(goalAmt)}`:g0.name}</span>
                  {isAdmin&&(
                    <button onClick={e=>{e.stopPropagation();onNavigate("fundraising");}} title="Edit goals in Fundraising"
                      style={{background:"transparent",border:"none",padding:3,margin:0,cursor:"pointer",color:T.ink3,display:"inline-flex",alignItems:"center",flexShrink:0}}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
                    </button>
                  )}
                </div>
                <div style={{display:"flex",alignItems:"baseline",gap:10,marginBottom:8}}>
                  <div style={{fontSize:44,fontWeight:400,fontFamily:"'DM Serif Display',Georgia,serif",color:T.gold700,lineHeight:1}}>{rawPct}%</div>
                  <div style={{fontSize:13,fontWeight:600,color:rawPct>100?T.gold700:T.ink3}}>{goalHeadSub(rawPct,overAmt)}</div>
                </div>
                <div style={{background:T.bg2,borderRadius:99,height:9,overflow:"hidden",marginBottom:8}}>
                  <div style={{height:"100%",width:`${pct}%`,background:T.gold500,borderRadius:99,transition:"width 0.6s ease"}}/>
                </div>
                <div style={{fontSize:13,color:T.ink3}}><strong style={{fontSize:15,color:T.gold700,fontFamily:"'DM Serif Display',serif",fontWeight:400}}>{fmtFull(raised)}</strong> of {fmtFull(goalAmt)}{many?` · ${fgRollup.activeGoalCount} active goals`:""}</div>
              </div>
              {/* RIGHT — real supporting stats. Pace + the FY comparison are kept;
                  this-week giving + money at risk are the two live
                  BUILD-32 figures (both move week to week). "Active Goals" (a
                  static count) was dropped — density here must be information. */}
              <div style={{flex:"1 1 260px",minWidth:230,display:"grid",gridTemplateColumns:"1fr 1fr",gap:"8px 18px",alignContent:"start"}}>
                <GoalStat label="Pace" value={heroPace} valueColor={heroPaceCol} sub={many?"across active goals":"vs the period elapsed"} onClick={()=>onNavigate("fundraising")}/>
                <GoalStat label={fundOverview.periodLabel?`Raised · ${fundOverview.periodLabel}`:"Raised this period"} value={fmtFull(period.raised||0)} sub={deltaTxt} onClick={()=>onNavigate("reports",{report:"giving-summary",preset:"thisFY",yearMode:"fiscal"})}/>
                <GoalStat {...twStat}/>
                <GoalStat {...reengStat}/>
              </div>
            </div>
          </div>
        </>
      ):(
      <div className="dash-goal-banner" style={{background:T.white,border:"1px solid "+T.bg2,borderLeft:"4px solid "+T.gold500,borderRadius:16,padding:"16px 22px",color:T.ink}}>
        {goal===undefined?(
          <div style={{display:"flex",alignItems:"center",gap:8,color:T.ink3,fontSize:13}}><Spin/>Loading goal…</div>
        ):goal?(
          <>
            <div className="dash-goal-cols" style={{display:"flex",gap:32,flexWrap:"wrap"}}>
              {/* LEFT — primary */}
              <div style={{flex:"2 1 300px",minWidth:260}}>
                <div style={{fontSize:10,fontWeight:800,color:T.ink3,marginBottom:4}}>Fundraising Goal</div>
                <div style={{fontSize:15,fontWeight:600,color:T.ink3,marginBottom:10,maxWidth:420,display:"flex",alignItems:"center",gap:8}}>
                  <span>{goal.label}</span>
                  {isAdmin&&(
                    <button onClick={openEditGoal} disabled={isReadOnly} title={isReadOnly?"Reactivate your subscription to make changes.":"Edit goal"}
                      style={{background:"transparent",border:"none",padding:3,margin:0,cursor:isReadOnly?"not-allowed":"pointer",color:T.ink3,opacity:isReadOnly?0.4:1,display:"inline-flex",alignItems:"center",flexShrink:0}}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
                    </button>
                  )}
                </div>

                <div style={{display:"flex",alignItems:"baseline",gap:10,marginBottom:8}}>
                  <div style={{fontSize:44,fontWeight:400,fontFamily:"'DM Serif Display',Georgia,serif",color:T.gold700,lineHeight:1}}>{goal.rawPercent??goal.percent}%</div>
                  <div style={{fontSize:13,fontWeight:600,color:(goal.rawPercent??goal.percent)>100?T.gold700:T.ink3}}>{goalHeadSub(goal.rawPercent??goal.percent,goal.over||0)}</div>
                </div>
                <div style={{background:T.bg2,borderRadius:99,height:9,overflow:"hidden",marginBottom:8}}>
                  <div style={{height:"100%",width:`${goal.percent}%`,background:T.gold500,borderRadius:99,transition:"width 0.6s ease"}}/>
                </div>
                <div style={{fontSize:13,color:T.ink3}}><strong style={{fontSize:15,color:T.gold700,fontFamily:"'DM Serif Display',serif",fontWeight:400}}>{fmtFull(goal.currentAmount)}</strong> of {fmtFull(goal.goalAmount)} <span data-testid="goal-period">· {periodWords(goal.periodStart,goal.periodEnd)}</span></div>
                {/* RECONCILE-1: what this goal is measured against. When Steward
                    has no gifts for last year, the old report she chose stands
                    in, and says so. */}
                {goal.lastYear&&<div data-testid="goal-last-year" style={{fontSize:12.5,color:T.ink3,marginTop:4}}>
                  Last year: <Figure variant="inline" kind="money" value={goal.lastYear.value} label={goal.lastYear.label} definition={goal.lastYear.note} source={goal.lastYear.source}/>{goal.lastYear.imported?", from your old system":""}
                </div>}
              </div>

              {/* RIGHT — supporting stats. Pace + Time Left kept; this-week giving
                  + money at risk (BUILD-73 Part 3) are the two live added figures,
                  replacing the vaguer "recent momentum" text line. */}
              <div style={{flex:"1 1 260px",minWidth:230,display:"grid",gridTemplateColumns:"1fr 1fr",gap:"8px 18px",alignContent:"start"}}>
                <GoalStat label="Pace" value={paceLabel} valueColor={paceLabel==="Ahead"?T.gold:T.bg} sub={paceSub} onClick={()=>onNavigate("fundraising")}/>
                <GoalStat label="Time Left" value={daysLeftInPeriod!=null?`${countLabel(daysLeftInPeriod, "day")}`:"Not set"} sub="left to reach this goal"/>
                <GoalStat {...twStat}/>
                <GoalStat {...reengStat}/>
              </div>
            </div>
          </>
        ):(
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:12}}>
            <div>
              <div style={{fontSize:15,fontWeight:600,color:T.ink,marginBottom:2}}>No goal set for this period.</div>
              <div style={{fontSize:12,color:T.ink3}}>Set a fundraising target to track progress here.</div>
            </div>
            {isAdmin&&<button onClick={openSetGoal} style={{background:T.gold,border:"none",borderRadius:10,padding:"9px 18px",color:T.ink,fontSize:13,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap"}}>Set a goal →</button>}
          </div>
        )}
      </div>
      )
  );
}

export function goalCardsSection({ activeTop, catMeta, catPaceColor, fgGoals, heroCtx, onNavigate, paceText }) {
  return (
  heroCtx&&(activeTop.length>=2||activeTop.some(g=>g.isOverarching))?(
            <div className="dash-goals-grid" style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))",gap:12}}>
              {activeTop.map(g=>{
                const over=g.isOverarching;
                const m=catMeta(g.goalCategory);
                const gp=g.rolledPercent||0;
                const kids=over?fgGoals.filter(x=>g.childIds.includes(x.id)):[];
                return(
                  <div key={g.id} {...interactive(()=>onNavigate("fundraising"),{label:`Open ${g.name}`})}
                    style={{background:T.white,border:"1px solid "+T.bg3,borderTop:`3px solid ${over?T.gold:m.color}`,borderRadius:14,padding:"14px 16px",boxShadow:T.shadow,display:"flex",flexDirection:"column",gap:7,minWidth:0}}>
                    {over
                      ?<span style={{alignSelf:"flex-start",fontSize:9,fontWeight:800,color:T.ink2,background:T.bg2,padding:"3px 8px",borderRadius:99}}>Overarching</span>
                      :<span style={{alignSelf:"flex-start",fontSize:9,fontWeight:800,color:m.color,background:m.color+"1e",padding:"3px 8px",borderRadius:99}}>{m.label}</span>}
                    <span style={{fontSize:13.5,fontWeight:700,color:T.ink,lineHeight:1.25,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{g.name}</span>
                    <span style={{fontSize:12,color:T.ink3}}><b style={{color:T.ink,fontSize:14}}>{fmtFull(g.rolledRaised)}</b> of {fmtFull(g.goalAmount)} <span data-testid="goal-card-period">· {periodWords(g.startDate,g.endDate)}</span></span>
                    <div style={{background:T.bg2,borderRadius:99,height:7,overflow:"hidden"}}>
                      <div style={{height:"100%",width:`${gp}%`,background:over?T.gold:m.color,borderRadius:99,transition:"width 0.5s ease"}}/>
                    </div>
                    <span style={{fontSize:11,fontWeight:700,color:catPaceColor(g.rolledPaceState)}}>{paceText(g.rolledPaceState)}{g.rolledOver>0?` · ${fmtFull(g.rolledOver)} over`:""}</span>
                    {over&&(
                      <div style={{borderTop:"1px solid "+T.bg2,marginTop:2,paddingTop:7,display:"flex",flexDirection:"column",gap:5}}>
                        <span style={{fontSize:10,fontWeight:800,color:T.ink3}}>Rolls up {countLabel(g.childCount, "goal")}</span>
                        {kids.map(c=>(
                          <div key={c.id} style={{display:"flex",justifyContent:"space-between",gap:8,fontSize:11.5,color:T.ink2}}>
                            <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.name}</span>
                            <span style={{color:T.ink3,flexShrink:0}}>{fmtFull(c.raised)} · {c.rawPercent??c.percent??0}%</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
  ):null
  );
}

export function scopeToggle({ homeData, scope, setScope }) {
  return (
      scope!==undefined&&homeData?.multiOfficer?(
        <div style={{display:"flex",justifyContent:"flex-end",alignItems:"center",gap:8}}>
          <span style={{fontSize:11,color:T.ink3}}>Showing:</span>
          <div style={{display:"flex",background:T.bg,borderRadius:99,padding:2,border:"1px solid "+T.bg3}}>
            {[["mine","My donors"],["all","Whole org"]].map(([v,l])=>(
              <button key={v} onClick={()=>setScope(v)} style={{background:scope===v?T.white:"transparent",border:"none",borderRadius:99,padding:"5px 14px",fontSize:12,fontWeight:700,color:scope===v?T.ink:T.ink3,cursor:"pointer",boxShadow:scope===v?T.shadow:"none",transition:"background 0.12s"}}>
                {l}
              </button>
            ))}
          </div>
        </div>
      ):null
  );
}

export function myPortfolioSection({ StatIcon, hoveredStat, myStats, onNavigate, openPortfolioBreakdown, portfolioOpen, setHoveredStat, setPortfolioOpen }) {
  return (
      myStats?(
        // De-emphasized wrapper (BUILD-31 Part 5.3): no colored left-accent box —
        // the "MY PORTFOLIO" heading + spacing define the group. A neutral hairline
        // only, so it reads as a quiet section, not a decorated template card.
        <div style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:14,overflow:"hidden"}}>
          <button onClick={()=>setPortfolioOpen(v=>!v)} style={{width:"100%",background:"none",border:"none",padding:"10px 16px",display:"flex",alignItems:"center",justifyContent:"space-between",cursor:"pointer",color:T.ink}}>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <span style={{fontSize:9,fontWeight:800,color:T.ink3,background:T.bg2,padding:"3px 8px",borderRadius:99}}>My portfolio</span>
              <span data-testid="home-year-range" style={{fontSize:12,color:T.ink3}}>{(myStats&&myStats.yearLabel)||"This year"}</span>
            </div>
            <span style={{fontSize:12,color:T.ink3}}>{portfolioOpen?"▲":"▼"}</span>
          </button>
          {portfolioOpen&&(() => {
            // Genuinely zero because nobody has logged a call/meeting yet is
            // expected first-day state, not a broken metric — but only once
            // there's real donor/gift history to have contacted in the first
            // place (an org with zero donors gets its own separate empty
            // state elsewhere, not this copy). Never fabricates interaction
            // data; this only changes how an honest zero is captioned.
            const noOutreachYet = myStats.orgHasGiftHistory && !myStats.orgHasInteractions;
            return (<>
              <div style={{display:"grid",gridTemplateColumns:"repeat(6,1fr)",borderTop:"1px solid "+T.bg3}} className="portfolio-grid">
                {[
                  {label:"Portfolio",icon:"portfolio",value:myStats.portfolioCount,unit:"donors",onClick:()=>onNavigate("pipeline")},
                  {label:"Visits YTD",icon:"visits",value:myStats.visitsYtd,unit:(noOutreachYet&&myStats.visitsYtd===0)?"not logged yet":"meetings",onClick:()=>openPortfolioBreakdown("visits")},
                  {label:"Moves Made",icon:"moves",value:myStats.madeYtd,unit:(noOutreachYet&&myStats.madeYtd===0)?"not logged yet":"interactions",onClick:()=>openPortfolioBreakdown("moves")},
                  {label:"Gifts YTD",icon:"gifts",value:fmt(myStats.giftsYtd),unit:"raised",onClick:()=>openPortfolioBreakdown("gifts")},
                  {label:"Pipeline",icon:"pipeline",value:fmt(myStats.pipelineValue),unit:"value",onClick:()=>openPortfolioBreakdown("pipeline")},
                  {label:"Lapsed",icon:"lapsed",value:myStats.lapsedCount,unit:"in portfolio",warn:myStats.lapsedCount>0,onClick:()=>openPortfolioBreakdown("lapsed")},
                ].map((m,i)=>(
                  <div key={m.label} onClick={m.onClick}
                    onMouseEnter={()=>setHoveredStat(i)} onMouseLeave={()=>setHoveredStat(h=>h===i?null:h)}
                    style={{padding:"12px 14px",borderRight:i<5?"1px solid "+T.bg3:"none",textAlign:"center",cursor:"pointer",background:hoveredStat===i?T.bg:"transparent",transition:"background 0.12s"}}>
                    <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:5,marginBottom:4}}>
                      <StatIcon name={m.icon} color={m.warn?T.terracotta:T.greenDk}/>
                      <span style={{fontSize:9,fontWeight:700,color:m.warn?T.terracotta:T.greenDk}}>{m.label}</span>
                    </div>
                    <div style={{fontSize:20,fontWeight:800,color:m.warn?T.terracotta:T.ink,fontFamily:"'DM Serif Display',serif",lineHeight:1}}>{m.value}</div>
                    <div style={{fontSize:10,color:T.ink3,marginTop:2}}>{m.unit}</div>
                  </div>
                ))}
              </div>
              {noOutreachYet&&(myStats.visitsYtd===0||myStats.madeYtd===0)&&(
                <div style={{padding:"8px 14px",borderTop:"1px solid "+T.bg3,fontSize:11,color:T.ink3,textAlign:"center",background:T.bg}}>
                  No outreach logged yet. This is normal right after import. Log your first call from a donor's profile to start tracking this.
                </div>
              )}
            </>);
          })()}
        </div>
      ):null
  );
}

export function reengStat({ atRiskAmt, driftData, impact, openEarlySigns, quietCount, setReengBreakdownOpen }) {
  return (
         atRiskAmt>0
    ? {label:"At risk",value:fmtFull(atRiskAmt),valueColor:T.gold,sub:`${countLabel(quietCount, "quiet donor")} · no gift in over ${quietPhrase(impact?.quietSinceDays)}`,onClick:()=>setReengBreakdownOpen(true)}
    : driftData&&driftData.counts.driftingHigh>0
      // Edge: a short-cadence drifter can exist before anyone crosses the
      // 180-day quiet line — never claim "no donors drifting" over them.
      ? {label:"At risk",value:fmtFull(driftData.atRiskAmount),valueColor:T.gold,sub:`${countLabel(driftData.counts.driftingHigh,"donor")} past their own pattern${driftData.importCaveat?`. ${driftData.importCaveat}`:""}`,onClick:()=>document.getElementById("dash-drifting")?.scrollIntoView({behavior:"smooth",block:"start"})}
      // FIX-10 Part A — a medium flag still means someone is drifting. This
      // chip said "No donors drifting" on a file where five donors were
      // drifting at medium confidence, which is the one sentence a customer
      // took at face value. The dollars stay high-confidence only; the early
      // signs are named as early signs and they open their own list.
      : driftCounts(driftData).medium>0
        ? {label:"At risk",value:earlySignsPhrase(driftCounts(driftData).medium),valueColor:T.gold,
           sub:`${EARLY_SIGNS_MEANING} · nothing confirmed yet`,
           onClick:()=>openEarlySigns()}
      : {label:"At risk",
         // BUILD-79 Part 6 — a pattern needs gifts. An org with donors but $0
         // of giving gets the truth, not "1,111 giving patterns checked".
         value:driftData&&driftData.evaluated>0&&(driftData.giftedDonorCount??0)===0?"No giving history yet":"No donors drifting",
         sub:driftData
           ?((driftData.giftedDonorCount??driftData.evaluated)===0
              ?"no giving history on file yet, so nothing to check"
              :`${countLabel(driftData.giftedDonorCount??driftData.evaluated,"giving pattern")} checked`)
           :"checking giving patterns",
         onClick:()=>setReengBreakdownOpen(true)}
  );
}

export function goalHeadSub() {
  const goalHeadSub=(rawPct,over)=>rawPct>100?(over>0?`Goal met · ${fmtFull(over)} over`:"Goal met · exceeded"):"of goal reached";
  return goalHeadSub;
}
