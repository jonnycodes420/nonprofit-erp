import { useState, useEffect } from "react";
import { apiFetch } from "../api";
import { useAuth } from "../main";
import { T, fmt, fmtFull, daysUntil, askClaude, buildContext, STAGES, Spin, AIBtn } from "./shared";

// ── Dashboard / Home ─────────────────────────────────────────────────────────
export function Dashboard({data,setData,onNavigate,isReadOnly=false}) {
  const {auth}=useAuth();
  const isAdmin=auth?.user?.role==="admin";
  const todayStr=new Date().toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric"});

  const [briefing,setBriefing]=useState("");
  const [briefLoading,setBriefLoading]=useState(false);
  const [briefOpen,setBriefOpen]=useState(false);
  const [myStats,setMyStats]=useState(null);
  const [portfolioOpen,setPortfolioOpen]=useState(false);

  const [queueItems,setQueueItems]=useState([]);
  const [queueLoading,setQueueLoading]=useState(true);
  const [busyDonorId,setBusyDonorId]=useState(null);

  const [goal,setGoal]=useState(undefined); // undefined = loading, null = none set
  const [showSetGoal,setShowSetGoal]=useState(false);
  const [goalForm,setGoalForm]=useState({label:"",goalAmount:"",goalType:"total_raised",periodStart:"",periodEnd:""});
  const [savingGoal,setSavingGoal]=useState(false);

  const [stageCounts,setStageCounts]=useState([]);

  const loadGoal=()=>apiFetch("/goals/active").then(r=>setGoal(r)).catch(()=>setGoal(null));

  useEffect(()=>{
    apiFetch("/dashboard/my-stats").then(r=>setMyStats(r||null)).catch(()=>{});
    apiFetch("/dashboard/today").then(r=>setQueueItems(r||[])).catch(()=>{}).finally(()=>setQueueLoading(false));
    apiFetch("/donors/stage-counts").then(r=>setStageCounts(r||[])).catch(()=>{});
    loadGoal();
  },[]);

  // Guards against a pre-existing /dashboard/today quirk (task rows aren't
  // filtered by donor deleted_at) — if the donor isn't in the live donor
  // list anymore, don't show a queue row nothing can act on.
  const visibleQueue=queueItems
    .filter(item=>data.donors.some(d=>d.id===item.donorId))
    .slice(0,6);
  const milestoneCount=queueItems.filter(i=>i.action==="milestone").length;

  const nextGrant=[...data.grants]
    .filter(g=>g.status!=="closed"&&g.deadline&&daysUntil(g.deadline)>=-7)
    .sort((a,b)=>new Date(a.deadline)-new Date(b.deadline))[0]||null;

  const generateBriefing=async()=>{
    setBriefLoading(true);setBriefing("");setBriefOpen(true);
    const milestoneLine=milestoneCount>0
      ?`\nMilestone emails pending review: ${milestoneCount} AI-drafted thank-you email(s) awaiting staff approval (donors who just crossed a giving milestone or anniversary).`
      :"";
    await askClaude(
      `You are a chief development officer. Write a crisp daily briefing. Use bullet points. Be specific with names and numbers. Max 250 words.`,
      `Generate today's development briefing for ${data.org.name}.\nToday: ${todayStr}\n\n${buildContext(data)}${milestoneLine}\n\nFormat:\n**TODAY'S PRIORITY CALLS** (top 2-3 donors to contact with specific reason)\n**GRANT ALERTS** (anything urgent in next 30 days)\n**MILESTONE EMAILS** (if any are pending review, mention how many and nudge toward reviewing them — omit this section entirely if none are pending)\n**FINANCIAL PULSE** (1-2 sentences on cash/revenue)\n**ONE THING** (the single most important action today)\n\nBe sharp and specific.`,
      chunk=>setBriefing(chunk)
    );
    setBriefLoading(false);
  };

  const completeTask=async(item)=>{
    setBusyDonorId(item.donorId);
    try{
      await apiFetch(`/tasks/${item.taskId}`,{method:"PUT",body:JSON.stringify({
        title:item.taskTitle,due:item.taskDue,priority:item.taskPriority,type:item.taskType,done:1,
      })});
      setQueueItems(prev=>prev.filter(i=>i.taskId!==item.taskId));
    }catch(e){alert(e.message||"Could not mark task done");}
    setBusyDonorId(null);
  };

  const markNoteSent=async(item)=>{
    setBusyDonorId(item.donorId);
    try{
      await apiFetch(`/note-reminders/${item.reminderId}/send`,{method:"POST"});
      setQueueItems(prev=>prev.filter(i=>i.reminderId!==item.reminderId));
    }catch(e){alert(e.message||"Could not mark note sent");}
    setBusyDonorId(null);
  };

  const handleQueueAction=(item)=>{
    if(item.action==="note")return markNoteSent(item);
    if(item.action==="milestone")return onNavigate("communications",{subtab:"milestones",highlightDraftId:item.draftId});
    if(item.action==="lapsed")return onNavigate("donors",{view:"reengage"});
    if(item.taskId)return completeTask(item);
    return onNavigate("donors",{logDonorId:item.donorId});
  };

  const actionLabel=(item)=>{
    if(item.action==="note")return busyDonorId===item.donorId?"Saving…":"Mark sent ✓";
    if(item.action==="milestone")return "Review draft →";
    if(item.action==="lapsed")return "Re-engage →";
    if(item.taskId)return busyDonorId===item.donorId?"Saving…":"Mark done ✓";
    if(item.action==="thank")return "Log thank-you →";
    if(item.action==="email")return "Log email →";
    return "Log call →";
  };

  const ROW_COLOR={note:"#8b6f47",milestone:T.gold,lapsed:T.terracotta,thank:T.green,email:"#3b82f6"};
  const rowColor=(item)=>item.taskId?"#8b5cf6":(ROW_COLOR[item.action]||T.greenMid);

  const openSetGoal=()=>{
    const today=new Date();
    const in90=new Date(today);in90.setDate(in90.getDate()+90);
    setGoalForm({label:"",goalAmount:"",goalType:"total_raised",periodStart:today.toISOString().split("T")[0],periodEnd:in90.toISOString().split("T")[0]});
    setShowSetGoal(true);
  };

  const saveGoal=async()=>{
    if(!goalForm.label.trim()||!goalForm.goalAmount||!goalForm.periodStart||!goalForm.periodEnd)return;
    setSavingGoal(true);
    try{
      await apiFetch("/goals",{method:"POST",body:JSON.stringify(goalForm)});
      await loadGoal();
      setShowSetGoal(false);
    }catch(e){alert(e.message||"Could not save goal");}
    setSavingGoal(false);
  };

  const bLines=briefing.split("\n").filter(l=>l.trim()&&!l.startsWith("**")&&l.trim().length>15);
  const pullQuote=bLines.length?bLines[0].replace(/^[•\-\*\s]+/,"").slice(0,160):"";
  const briefRest=pullQuote?briefing.slice(briefing.indexOf(pullQuote)+pullQuote.length).trim():"";

  const sHdr={display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:0};
  const sTitle={fontSize:10,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color:T.ink3};
  const sLink={background:"transparent",border:"none",padding:0,color:T.greenDk,fontSize:12,fontWeight:700,cursor:"pointer"};
  const cardWrap={background:T.white,border:"1px solid "+T.bg3,borderRadius:14,overflow:"hidden"};
  const cPad={padding:"14px 20px"};
  const inp={width:"100%",boxSizing:"border-box",background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"9px 12px",color:T.ink,fontSize:13,outline:"none",marginBottom:10};

  const MiniEmpty=({icon,text,cta,onCta})=>(
    <div style={{...cPad,display:"flex",alignItems:"center",gap:12}}>
      <div style={{fontSize:20,opacity:0.3,color:T.greenDk,flexShrink:0,lineHeight:1}}>{icon}</div>
      <div style={{flex:1,minWidth:0}}>
        <div style={{fontSize:13,color:T.ink3,lineHeight:1.5}}>{text}</div>
        {cta&&<button onClick={onCta} style={{...sLink,marginTop:3,fontSize:12}}>{cta}</button>}
      </div>
    </div>
  );

  const FUNNEL_STAGES=STAGES.filter(s=>s.id!=="lapsed");
  const lapsedStageInfo=STAGES.find(s=>s.id==="lapsed");
  const countsByStage=Object.fromEntries(stageCounts.map(s=>[s.stage,s]));
  const maxFunnelCount=Math.max(1,...FUNNEL_STAGES.map(s=>countsByStage[s.id]?.count||0));
  const lapsedCountVal=countsByStage.lapsed?.count||0;
  const lapsedTotalVal=countsByStage.lapsed?.total||0;

  return(
    <div className="dash-root dash-bleed fade-in" style={{background:T.bgDeep,margin:"-20px -24px -28px -24px",padding:"20px 24px 28px 24px",display:"flex",flexDirection:"column",gap:16,minHeight:"calc(100vh - 92px)"}}>

      {/* Goal banner */}
      <div className="dash-goal-banner" style={{background:"linear-gradient(135deg,#0f1a12,#152420)",border:"1px solid #1a2e1f",borderRadius:16,padding:"20px 24px",color:"#f0ede6"}}>
        {goal===undefined?(
          <div style={{display:"flex",alignItems:"center",gap:8,color:"#8fa896",fontSize:13}}><Spin/>Loading goal…</div>
        ):goal?(
          <>
            <div style={{fontSize:10,fontWeight:800,letterSpacing:"0.12em",textTransform:"uppercase",color:"#8fa896",marginBottom:6}}>Fundraising Goal</div>
            <div style={{fontSize:21,fontWeight:400,fontFamily:"'DM Serif Display',Georgia,serif",marginBottom:14,color:"#f8f6f0"}}>{goal.label}</div>
            <div style={{background:"#0a120c",borderRadius:99,height:11,overflow:"hidden",marginBottom:10}}>
              <div style={{height:"100%",width:`${goal.percent}%`,background:`linear-gradient(90deg,${T.gold},${T.terracotta})`,borderRadius:99,transition:"width 0.6s ease"}}/>
            </div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",flexWrap:"wrap",gap:8}}>
              <div style={{fontSize:13,color:"#c9c2b4"}}><strong style={{fontSize:19,color:T.gold,fontFamily:"'DM Serif Display',serif",fontWeight:400}}>{fmtFull(goal.currentAmount)}</strong> of {fmtFull(goal.goalAmount)}</div>
              <div style={{fontSize:13,fontWeight:700,color:"#8fa896"}}>{goal.percent}% there</div>
            </div>
          </>
        ):(
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:12}}>
            <div>
              <div style={{fontSize:15,fontWeight:600,color:"#f0ede6",marginBottom:2}}>No goal set for this period.</div>
              <div style={{fontSize:12,color:"#8fa896"}}>Set a fundraising target to track progress here.</div>
            </div>
            {isAdmin&&<button onClick={openSetGoal} style={{background:T.gold,border:"none",borderRadius:10,padding:"9px 18px",color:"#1a1206",fontSize:13,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap"}}>Set a goal →</button>}
          </div>
        )}
      </div>

      {myStats&&(
        <div style={{background:T.white,border:"1px solid #3b82f630",borderLeft:"3px solid #3b82f6",borderRadius:14,overflow:"hidden"}}>
          <button onClick={()=>setPortfolioOpen(v=>!v)} style={{width:"100%",background:"none",border:"none",padding:"10px 16px",display:"flex",alignItems:"center",justifyContent:"space-between",cursor:"pointer",color:T.ink}}>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <span style={{fontSize:9,fontWeight:800,letterSpacing:"0.1em",textTransform:"uppercase",color:"#3b82f6",background:"#3b82f610",padding:"3px 8px",borderRadius:99}}>MY PORTFOLIO</span>
              <span style={{fontSize:12,color:T.ink3}}>FY Jul–Jun</span>
            </div>
            <span style={{fontSize:12,color:T.ink3}}>{portfolioOpen?"▲":"▼"}</span>
          </button>
          {portfolioOpen&&(
            <div style={{display:"grid",gridTemplateColumns:"repeat(6,1fr)",borderTop:"1px solid "+T.bg3}} className="portfolio-grid">
              {[
                {label:"Portfolio",value:myStats.portfolioCount,unit:"donors"},
                {label:"Visits YTD",value:myStats.visitsYtd,unit:"meetings"},
                {label:"Moves Made",value:myStats.madeYtd,unit:"interactions"},
                {label:"Gifts YTD",value:fmt(myStats.giftsYtd),unit:"raised"},
                {label:"Pipeline",value:fmt(myStats.pipelineValue),unit:"value"},
                {label:"Lapsed",value:myStats.lapsedCount,unit:"in portfolio",warn:myStats.lapsedCount>0},
              ].map((m,i)=>(
                <div key={m.label} style={{padding:"12px 14px",borderRight:i<5?"1px solid "+T.bg3:"none",textAlign:"center"}}>
                  <div style={{fontSize:9,fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",color:m.warn?"#ef4444":"#3b82f6",marginBottom:4}}>{m.label}</div>
                  <div style={{fontSize:20,fontWeight:800,color:m.warn?"#ef4444":T.ink,fontFamily:"'DM Serif Display',serif",lineHeight:1}}>{m.value}</div>
                  <div style={{fontSize:10,color:T.ink3,marginTop:2}}>{m.unit}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="dash-main-grid" style={{display:"grid",gridTemplateColumns:"minmax(0,1fr) 320px",gap:16,alignItems:"start"}}>
        {/* LEFT: the queue is the hero */}
        <div style={{display:"flex",flexDirection:"column",gap:14}}>
          <div style={{...cardWrap}}>
            <div className="dash-cpad" style={{...cPad,borderBottom:"1px solid "+T.bg3,...sHdr}}>
              <span style={sTitle}>Needs Your Attention</span>
              {!queueLoading&&<span style={{fontSize:11,color:T.ink3}}>{visibleQueue.length} {visibleQueue.length===1?"item":"items"}</span>}
            </div>
            {queueLoading&&<div style={{...cPad}}><Spin/></div>}
            {!queueLoading&&visibleQueue.length===0&&<MiniEmpty icon="✓" text="You're all caught up — nothing needs attention right now."/>}
            {!queueLoading&&visibleQueue.map((item,i)=>{
              const color=rowColor(item);
              const busy=busyDonorId===item.donorId;
              return(
                <div key={item.donorId+"_"+item.action} className="dash-row dash-queue-row" style={{
                  display:"flex",alignItems:"flex-start",gap:14,padding:"14px 20px",
                  borderBottom:i<visibleQueue.length-1?"1px solid "+T.bg3:"none",
                  borderLeft:"3px solid "+color,
                }}>
                  <div style={{width:38,height:38,borderRadius:"50%",background:color+"22",display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,fontWeight:800,color,flexShrink:0}}>
                    {(item.donorName||"?")[0]}
                  </div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:13,fontWeight:700,color:T.ink}}>{item.donorName}</div>
                    {item.action==="note"&&Array.isArray(item.talkingPoints)?(
                      <ul style={{margin:"4px 0 0",padding:"0 0 0 16px",fontSize:12,color:T.ink3,lineHeight:1.5}}>
                        {item.talkingPoints.map((p,pi)=><li key={pi} style={{marginBottom:2}}>{p}</li>)}
                      </ul>
                    ):(
                      <div style={{fontSize:12,color:T.ink3,marginTop:2,lineHeight:1.4}}>{item.reason}</div>
                    )}
                  </div>
                  <button onClick={()=>handleQueueAction(item)} disabled={busy||(item.taskId&&isReadOnly)}
                    title={item.taskId&&isReadOnly?"Reactivate your subscription to make changes.":undefined}
                    className="dash-queue-action" style={{
                      background:color,border:"none",borderRadius:8,padding:"8px 14px",color:"#fff",fontSize:12,fontWeight:700,
                      cursor:(busy||(item.taskId&&isReadOnly))?"not-allowed":"pointer",whiteSpace:"nowrap",flexShrink:0,
                      opacity:(busy||(item.taskId&&isReadOnly))?0.45:1,
                    }}>{actionLabel(item)}</button>
                </div>
              );
            })}
          </div>

          {/* Today's Suggested Outreach */}
          <div style={{...cardWrap}}>
            <div className="dash-briefing-hdr dash-cpad" style={{...cPad,borderBottom:"1px solid "+T.bg3,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div style={{display:"flex",alignItems:"center",gap:10}}>
                <span style={{fontSize:11,color:T.ink,textTransform:"uppercase",letterSpacing:"0.08em",fontWeight:700}}>Today's Suggested Outreach</span>
                <span style={{fontSize:11,color:T.ink3}}>· {todayStr}</span>
              </div>
              {!briefing&&!briefLoading&&<AIBtn onClick={generateBriefing} label="✦ Suggest today's outreach" small/>}
              {briefLoading&&<div style={{display:"flex",alignItems:"center",gap:6,fontSize:12,color:T.ink3}}><Spin/>Thinking…</div>}
            </div>
            <div className="dash-briefing-body" style={{padding:"18px 24px"}}>
              {!briefing&&!briefLoading&&(
                <div style={{fontSize:13,color:T.ink3,fontStyle:"italic",lineHeight:1.7}}>
                  See who to call, what's urgent, milestone thank-yous ready to review, and one priority action for today.
                </div>
              )}
              {briefLoading&&!briefing&&(
                <div style={{fontSize:13,color:T.ink3,fontStyle:"italic"}}>Reading your org context…</div>
              )}
              {(briefing||briefLoading)&&pullQuote&&(
                <>
                  <blockquote style={{fontFamily:"'DM Serif Display',Georgia,serif",fontSize:19,fontStyle:"italic",color:T.ink,lineHeight:1.55,margin:"0 0 14px 0",paddingLeft:16,borderLeft:"3px solid #c9a84c"}}>
                    "{pullQuote}"
                  </blockquote>
                  {briefOpen&&briefRest&&(
                    <div style={{fontSize:13,color:T.ink2,lineHeight:1.85,whiteSpace:"pre-wrap",marginBottom:14}}>
                      {briefRest}
                    </div>
                  )}
                  {briefRest&&<button onClick={()=>setBriefOpen(!briefOpen)} style={{background:"transparent",border:"none",padding:0,color:T.greenDk,fontSize:12,fontWeight:700,cursor:"pointer"}}>
                    {briefOpen?"▲ Collapse":"▼ Read full briefing"}
                  </button>}
                </>
              )}
            </div>
          </div>
        </div>

        {/* RIGHT: funnel + next grant deadline */}
        <div style={{display:"flex",flexDirection:"column",gap:14}}>
          <div style={{...cardWrap}}>
            <div className="dash-cpad" style={{...cPad,borderBottom:"1px solid "+T.bg3,...sHdr}}>
              <span style={sTitle}>Pipeline Funnel</span>
              <button onClick={()=>onNavigate("donors")} style={sLink}>View all →</button>
            </div>
            <div style={{padding:"16px 20px",display:"flex",flexDirection:"column",gap:10}}>
              {FUNNEL_STAGES.map(s=>{
                const c=countsByStage[s.id]?.count||0;
                const t=countsByStage[s.id]?.total||0;
                const widthPct=Math.max(8,(c/maxFunnelCount)*100);
                return(
                  <div key={s.id} onClick={()=>onNavigate("donors",{stageFilter:s.id})} style={{cursor:"pointer"}}>
                    <div style={{display:"flex",justifyContent:"space-between",fontSize:10,marginBottom:3}}>
                      <span style={{fontWeight:800,color:s.color,textTransform:"uppercase",letterSpacing:"0.06em"}}>{s.label}</span>
                      <span style={{color:T.ink3}}>{c} · {t>0?fmt(t):"—"}</span>
                    </div>
                    <div style={{background:T.bg,borderRadius:6,height:16,overflow:"hidden"}}>
                      <div style={{height:"100%",width:`${widthPct}%`,background:s.color,borderRadius:6,transition:"width 0.4s ease"}}/>
                    </div>
                  </div>
                );
              })}
              <div onClick={()=>onNavigate("donors",{stageFilter:"lapsed"})} style={{cursor:"pointer",marginTop:4,paddingTop:12,borderTop:"1px dashed "+T.bg3}}>
                <div style={{display:"flex",justifyContent:"space-between",fontSize:10,marginBottom:3}}>
                  <span style={{fontWeight:800,color:lapsedStageInfo.color,textTransform:"uppercase",letterSpacing:"0.06em"}}>↘ Leaking Out — Lapsed</span>
                  <span style={{color:T.ink3}}>{lapsedCountVal} · {lapsedTotalVal>0?fmt(lapsedTotalVal):"—"}</span>
                </div>
                <div style={{background:T.bg,borderRadius:6,height:16,overflow:"hidden"}}>
                  <div style={{height:"100%",width:`${Math.max(8,(lapsedCountVal/maxFunnelCount)*100)}%`,background:lapsedStageInfo.color,borderRadius:6}}/>
                </div>
              </div>
            </div>
          </div>

          <div onClick={nextGrant?()=>onNavigate("grants",{grantId:nextGrant.id}):undefined} className={nextGrant?"card-click":""} style={{...cardWrap,cursor:nextGrant?"pointer":"default"}}>
            <div className="dash-cpad" style={{...cPad,borderBottom:"1px solid "+T.bg3}}>
              <span style={sTitle}>Next Grant Deadline</span>
            </div>
            {!nextGrant&&<div style={{...cPad,fontSize:13,color:T.ink3,fontStyle:"italic"}}>No upcoming deadlines.</div>}
            {nextGrant&&(()=>{
              const d=daysUntil(nextGrant.deadline);
              const urgColor=d<14?"#ef4444":d<30?"#f59e0b":"#1a6b4a";
              return(
                <div style={{padding:"14px 20px"}}>
                  <div style={{fontSize:13,fontWeight:700,color:T.ink,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{nextGrant.funder}</div>
                  <div style={{fontSize:11,color:T.ink3,marginTop:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{nextGrant.program}</div>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:10}}>
                    <span style={{background:urgColor+"15",border:"1px solid "+urgColor+"30",borderRadius:8,padding:"4px 10px",fontSize:12,fontWeight:800,color:urgColor}}>{d<0?"past due":d+"d"}</span>
                    <span style={{fontSize:14,fontWeight:800,color:T.ink}}>{fmt(nextGrant.amount)}</span>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      </div>

      {/* Set-goal modal */}
      {showSetGoal&&(
        <div style={{position:"fixed",inset:0,background:"#0f1a12cc",backdropFilter:"blur(4px)",zIndex:300,display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
          <div className="fade-in" style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:18,width:"100%",maxWidth:420,padding:24,boxShadow:"0 4px 32px rgba(15,15,15,0.12)"}}>
            <div style={{fontSize:16,fontWeight:800,color:T.ink,marginBottom:16}}>Set a fundraising goal</div>
            <div style={{fontSize:11,fontWeight:700,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:4}}>Label</div>
            <input value={goalForm.label} onChange={e=>setGoalForm(f=>({...f,label:e.target.value}))} placeholder="e.g. Win back $50,000 in lapsed giving" style={inp}/>
            <div style={{fontSize:11,fontWeight:700,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:4}}>Target amount ($)</div>
            <input type="number" value={goalForm.goalAmount} onChange={e=>setGoalForm(f=>({...f,goalAmount:e.target.value}))} placeholder="25000" style={inp}/>
            <div style={{fontSize:11,fontWeight:700,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:4}}>Goal type</div>
            <div style={{display:"flex",gap:6,marginBottom:10}}>
              {[["total_raised","Total raised"],["lapsed_recovery","Lapsed recovery"]].map(([v,l])=>(
                <button key={v} onClick={()=>setGoalForm(f=>({...f,goalType:v}))} style={{flex:1,background:goalForm.goalType===v?T.greenDk+"18":T.bg,border:`1px solid ${goalForm.goalType===v?T.greenDk:T.bg3}`,borderRadius:8,padding:"8px",color:goalForm.goalType===v?T.greenDk:T.ink3,fontSize:12,fontWeight:600,cursor:"pointer"}}>{l}</button>
              ))}
            </div>
            <div style={{display:"flex",gap:8,marginBottom:10}}>
              <div style={{flex:1}}>
                <div style={{fontSize:11,fontWeight:700,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:4}}>Period start</div>
                <input type="date" value={goalForm.periodStart} onChange={e=>setGoalForm(f=>({...f,periodStart:e.target.value}))} style={{...inp,marginBottom:0}}/>
              </div>
              <div style={{flex:1}}>
                <div style={{fontSize:11,fontWeight:700,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:4}}>Period end</div>
                <input type="date" value={goalForm.periodEnd} onChange={e=>setGoalForm(f=>({...f,periodEnd:e.target.value}))} style={{...inp,marginBottom:0}}/>
              </div>
            </div>
            <div style={{display:"flex",gap:8,marginTop:6}}>
              <button onClick={saveGoal} disabled={savingGoal||!goalForm.label.trim()||!goalForm.goalAmount} style={{flex:1,background:(savingGoal||!goalForm.label.trim()||!goalForm.goalAmount)?T.bg2:T.gold,border:"none",borderRadius:10,padding:"11px",color:"#1a1206",fontSize:14,fontWeight:700,cursor:(savingGoal||!goalForm.label.trim()||!goalForm.goalAmount)?"not-allowed":"pointer"}}>
                {savingGoal?"Saving…":"Set goal"}
              </button>
              <button onClick={()=>setShowSetGoal(false)} style={{background:T.bg,border:"none",borderRadius:10,padding:"11px 14px",color:T.ink3,fontSize:13,cursor:"pointer"}}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
