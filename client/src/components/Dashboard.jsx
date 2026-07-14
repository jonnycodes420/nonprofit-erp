import { useState, useEffect } from "react";
import { apiFetch } from "../api";
import { useAuth } from "../main";
import { T, fmt, fmtFull, daysUntil, askClaude, buildContext, Spin, AIBtn } from "./shared";
import FunnelChart from "./FunnelChart";
import MetricBreakdownPanel from "./MetricBreakdownPanel";

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

  // "mine" vs "all" — undefined until my-stats loads and we can decide a
  // sensible default: a user with an actual assigned portfolio defaults to
  // "mine" (this is their job today), a user with no assignments at all
  // defaults to "all" (a "mine" view would just be perpetually empty).
  // Scopes the queue + Retention Rate + Stewardship Debt together, one
  // source of truth, not three toggles that could disagree.
  const [scope,setScope]=useState(undefined);

  const [queueItems,setQueueItems]=useState([]);
  const [queueLoading,setQueueLoading]=useState(true);
  const [busyDonorId,setBusyDonorId]=useState(null);

  const [goal,setGoal]=useState(undefined); // undefined = loading, null = none set
  const [showSetGoal,setShowSetGoal]=useState(false);
  const [goalForm,setGoalForm]=useState({label:"",goalAmount:"",goalType:"total_raised",periodStart:"",periodEnd:""});
  const [savingGoal,setSavingGoal]=useState(false);

  const [stageCounts,setStageCounts]=useState([]);
  const [stewardMetrics,setStewardMetrics]=useState(null);
  const [recurringHealth,setRecurringHealth]=useState(null);
  const [resentIds,setResentIds]=useState(()=>new Set());

  const [debtBreakdownOpen,setDebtBreakdownOpen]=useState(false);
  const [debtBreakdown,setDebtBreakdown]=useState(null);
  const [debtBreakdownLoading,setDebtBreakdownLoading]=useState(false);

  const openDebtBreakdown=()=>{
    setDebtBreakdownOpen(true);
    if(debtBreakdown)return;
    setDebtBreakdownLoading(true);
    apiFetch(`/dashboard/stewardship-debt/breakdown?scope=${scope||"mine"}`)
      .then(r=>setDebtBreakdown(r))
      .catch(()=>setDebtBreakdown({total:0,count:0,rows:[]}))
      .finally(()=>setDebtBreakdownLoading(false));
  };
  const [retentionBreakdownOpen,setRetentionBreakdownOpen]=useState(false);
  const [retentionBreakdown,setRetentionBreakdown]=useState(null);
  const [retentionBreakdownLoading,setRetentionBreakdownLoading]=useState(false);

  const openRetentionBreakdown=()=>{
    setRetentionBreakdownOpen(true);
    if(retentionBreakdown)return;
    setRetentionBreakdownLoading(true);
    apiFetch(`/dashboard/retention/breakdown?scope=${scope||"mine"}`)
      .then(r=>setRetentionBreakdown(r))
      .catch(()=>setRetentionBreakdown({retentionRate:null,sectorAverage:43,retained:0,prevYearCount:0,nonRetainedCount:0,rows:[]}))
      .finally(()=>setRetentionBreakdownLoading(false));
  };

  // Shared by both drill-downs — same donor-profile navigation already used
  // by the "Needs Your Attention" queue.
  const goToDonorFromBreakdown=row=>{
    setDebtBreakdownOpen(false);
    setRetentionBreakdownOpen(false);
    onNavigate("donors",{selectDonorId:row.donorId});
  };

  const loadGoal=()=>apiFetch("/goals/active").then(r=>setGoal(r)).catch(()=>setGoal(null));

  useEffect(()=>{
    apiFetch("/dashboard/my-stats").then(r=>{
      setMyStats(r||null);
      // Decide the initial scope once, from whether this user actually has
      // an assigned portfolio — never overrides a scope the user already
      // picked (guarded by the `prev===undefined` check).
      setScope(prev=>prev!==undefined?prev:((r?.portfolioCount||0)>0?"mine":"all"));
    }).catch(()=>{setMyStats(null);setScope(prev=>prev!==undefined?prev:"all");});
    apiFetch("/donors/stage-counts").then(r=>setStageCounts(r||[])).catch(()=>{});
    apiFetch("/recurring/health").then(r=>setRecurringHealth(r)).catch(()=>{});
    loadGoal();
  },[]);

  // Queue + hero metrics are re-fetched whenever scope changes (including
  // the initial "mine"/"all" decision above) — one shared scope, not three
  // independently-toggled views that could disagree.
  useEffect(()=>{
    if(scope===undefined)return;
    setQueueLoading(true);
    apiFetch(`/dashboard/today?scope=${scope}`).then(r=>setQueueItems(r||[])).catch(()=>{}).finally(()=>setQueueLoading(false));
    apiFetch(`/metrics/stewardship-summary?scope=${scope}`).then(r=>setStewardMetrics(r)).catch(()=>{});
    // Cached breakdown data is scope-specific — invalidate so the next
    // "see breakdown" click re-fetches under the new scope instead of
    // showing stale data from the other one.
    setDebtBreakdown(null);
    setRetentionBreakdown(null);
  },[scope]);

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

  // Resending doesn't resolve the failure (only the donor updating their
  // card, or Stripe's own retry, does that) — so unlike the other queue
  // actions, the row stays put; we just confirm the send.
  const resendCardLink=async(item)=>{
    setBusyDonorId(item.donorId);
    try{
      await apiFetch(`/recurring/${item.donorId}/resend`,{method:"POST"});
      setResentIds(prev=>new Set(prev).add(item.donorId));
    }catch(e){alert(e.message||"Could not resend the update link");}
    setBusyDonorId(null);
  };

  const handleQueueAction=(item)=>{
    if(item.action==="note")return markNoteSent(item);
    if(item.action==="milestone")return onNavigate("communications",{subtab:"milestones",highlightDraftId:item.draftId});
    if(item.action==="lapsed")return onNavigate("donors",{view:"reengage"});
    if(item.action==="recurring")return resendCardLink(item);
    if(item.taskId)return completeTask(item);
    return onNavigate("donors",{logDonorId:item.donorId});
  };

  const actionLabel=(item)=>{
    if(item.action==="note")return busyDonorId===item.donorId?"Saving…":"Mark sent ✓";
    if(item.action==="milestone")return "Review draft →";
    if(item.action==="lapsed")return "Re-engage →";
    if(item.action==="recurring")return resentIds.has(item.donorId)?"Sent ✓":(busyDonorId===item.donorId?"Sending…":"Resend update link");
    if(item.taskId)return busyDonorId===item.donorId?"Saving…":"Mark done ✓";
    if(item.action==="thank")return "Log thank-you →";
    if(item.action==="email")return "Log email →";
    return "Log call →";
  };

  const ROW_COLOR={note:"#8b6f47",milestone:T.gold,lapsed:T.terracotta,thank:T.green,email:"#3b82f6",recurring:T.red};
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

  const Sparkline=({trend,color,width=100,height=30})=>{
    if(!trend||trend.length<2)return null;
    const vals=trend.map(t=>t.value);
    const min=Math.min(...vals),max=Math.max(...vals);
    const range=max-min||1;
    const pts=trend.map((t,i)=>{
      const x=(i/(trend.length-1))*width;
      const y=height-((t.value-min)/range)*height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(" ");
    return <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{display:"block"}}><polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>;
  };

  const countsByStage=Object.fromEntries(stageCounts.map(s=>[s.stage,s]));

  // Above sector average reads positive; below reads amber, then red the
  // further under benchmark it falls — visually honest, not falsely
  // encouraging (see CLAUDE.md's "name the vague anxiety as a number" pattern).
  const retentionCurrent=stewardMetrics?.retentionRate?.current;
  const retentionSector=stewardMetrics?.retentionRate?.sectorAverage??43;
  const retentionColor=retentionCurrent==null?T.ink:retentionCurrent>=retentionSector?"#1a6b4a":retentionCurrent>=retentionSector-15?"#d97706":"#ef4444";

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

      {/* Scope toggle — controls the queue below AND the Retention Rate /
          Stewardship Debt cards together (one shared scope, not per-card
          toggles that could disagree). Hidden until my-stats resolves the
          initial default, so it never flashes the wrong state. */}
      {scope!==undefined&&(
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
      )}

      {/* Donor Retention Rate — the Home dashboard's primary hero metric.
          This is the number fundraisers already benchmark against (unlike
          Stewardship Debt's invented composite score, see the demoted strip
          below) — the nonprofit sector average line already lived in the
          onboarding drip email before this. */}
      {stewardMetrics&&(
        <div style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:16,padding:"20px 24px",display:"flex",flexDirection:"column",gap:14}}>
          <div style={{display:"flex",flexWrap:"wrap",gap:24,alignItems:"center"}}>
            <div onClick={openRetentionBreakdown} className="card-click" style={{flex:"1 1 220px",display:"flex",alignItems:"center",gap:20,cursor:"pointer",borderRadius:12,margin:-4,padding:4}}>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:10,fontWeight:800,letterSpacing:"0.1em",textTransform:"uppercase",color:T.ink3,marginBottom:6}}>Donor Retention Rate</div>
                <div style={{display:"flex",alignItems:"baseline",gap:10,flexWrap:"wrap"}}>
                  <div style={{fontSize:36,fontWeight:800,fontFamily:"'DM Serif Display',serif",color:retentionColor,lineHeight:1}}>
                    {retentionCurrent!=null?`${retentionCurrent}%`:"—"}
                  </div>
                  {stewardMetrics.retentionRate.deltaVsTrendStart!=null&&(
                    <span style={{fontSize:13,fontWeight:700,color:stewardMetrics.retentionRate.deltaVsTrendStart>=0?"#1a6b4a":"#ef4444"}}>
                      {stewardMetrics.retentionRate.deltaVsTrendStart>=0?"↑":"↓"} {Math.abs(stewardMetrics.retentionRate.deltaVsTrendStart)}pt vs 3 weeks ago
                    </span>
                  )}
                </div>
                <div style={{fontSize:11,color:T.ink3,marginTop:4}}>
                  vs. {retentionSector}% sector average — <span style={{fontWeight:700,color:T.greenDk}}>see who's not renewing →</span>
                </div>
              </div>
              {stewardMetrics.retentionRate.trend.length>=2&&(
                <Sparkline trend={stewardMetrics.retentionRate.trend} color={retentionColor} width={120} height={36}/>
              )}
            </div>
            <div style={{width:1,alignSelf:"stretch",background:T.bg3,minHeight:44}}/>
            <div style={{flex:"1 1 200px"}}>
              <div style={{fontSize:10,fontWeight:800,letterSpacing:"0.1em",textTransform:"uppercase",color:T.ink3,marginBottom:6}}>First-Touch Delay</div>
              <div style={{fontSize:24,fontWeight:800,fontFamily:"'DM Serif Display',serif",color:T.ink,lineHeight:1}}>
                {stewardMetrics.firstTouchDelay.current!=null?`${stewardMetrics.firstTouchDelay.current}d`:"—"}
              </div>
              <div style={{fontSize:11,color:T.ink3,marginTop:4}}>
                {/* A genuine zero (no logged outreach yet) reads as expected
                    first-day state when the org has real donor/gift history —
                    not as a broken metric — vs. the generic description once
                    there's actually something to describe. Never fabricates
                    interaction data; this only changes the caption. */}
                {stewardMetrics.firstTouchDelay.current==null && myStats?.orgHasGiftHistory && !myStats?.orgHasInteractions
                  ? "No outreach logged yet — this is normal right after import. Log your first call from a donor's profile to start tracking this."
                  : <>Avg days before a new donor gets a personal touch{stewardMetrics.firstTouchDelay.sampleSize?` (n=${stewardMetrics.firstTouchDelay.sampleSize})`:""}</>}
              </div>
            </div>
          </div>

          {/* Stewardship Debt — demoted from hero to a slim secondary strip.
              Still the same real, computed metric and drill-down; just no
              longer the first thing you see. */}
          <div onClick={openDebtBreakdown} className="card-click" style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,paddingTop:14,borderTop:"1px dashed "+T.bg3,cursor:"pointer",borderRadius:8,margin:"-4px -4px -8px",padding:"4px 4px 8px"}}>
            <div style={{fontSize:11,color:T.ink3,minWidth:0}}>
              <span style={{fontWeight:700,color:T.ink}}>Stewardship Debt: {stewardMetrics.stewardshipDebt.current.toLocaleString()}</span>
              {stewardMetrics.stewardshipDebt.deltaVsTrendStart!=null&&(
                <span style={{marginLeft:6,fontWeight:700,color:stewardMetrics.stewardshipDebt.deltaVsTrendStart>0?"#ef4444":"#1a6b4a"}}>
                  {stewardMetrics.stewardshipDebt.deltaVsTrendStart>0?"↑":"↓"} {Math.abs(stewardMetrics.stewardshipDebt.deltaVsTrendStart).toLocaleString()} vs 3 weeks ago
                </span>
              )}
              <span> — donors weighted by days since contact × giving significance</span>
            </div>
            <span style={{fontSize:11,fontWeight:700,color:T.greenDk,flexShrink:0,whiteSpace:"nowrap"}}>see breakdown →</span>
          </div>
        </div>
      )}

      {myStats&&(
        <div style={{background:T.white,border:"1px solid #3b82f630",borderLeft:"3px solid #3b82f6",borderRadius:14,overflow:"hidden"}}>
          <button onClick={()=>setPortfolioOpen(v=>!v)} style={{width:"100%",background:"none",border:"none",padding:"10px 16px",display:"flex",alignItems:"center",justifyContent:"space-between",cursor:"pointer",color:T.ink}}>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <span style={{fontSize:9,fontWeight:800,letterSpacing:"0.1em",textTransform:"uppercase",color:"#3b82f6",background:"#3b82f610",padding:"3px 8px",borderRadius:99}}>MY PORTFOLIO</span>
              <span style={{fontSize:12,color:T.ink3}}>FY Jul–Jun</span>
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
                  {label:"Portfolio",value:myStats.portfolioCount,unit:"donors"},
                  {label:"Visits YTD",value:myStats.visitsYtd,unit:(noOutreachYet&&myStats.visitsYtd===0)?"not logged yet":"meetings"},
                  {label:"Moves Made",value:myStats.madeYtd,unit:(noOutreachYet&&myStats.madeYtd===0)?"not logged yet":"interactions"},
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
              {noOutreachYet&&(myStats.visitsYtd===0||myStats.madeYtd===0)&&(
                <div style={{padding:"8px 14px",borderTop:"1px solid "+T.bg3,fontSize:11,color:T.ink3,textAlign:"center",background:T.bg}}>
                  No outreach logged yet — this is normal right after import. Log your first call from a donor's profile to start tracking this.
                </div>
              )}
            </>);
          })()}
        </div>
      )}

      <div className="dash-main-grid" style={{display:"grid",gridTemplateColumns:"minmax(0,1fr) 320px",gap:16,alignItems:"start"}}>
        {/* LEFT: the queue is the hero */}
        <div style={{display:"flex",flexDirection:"column",gap:14}}>
          <div style={{...cardWrap}}>
            <div className="dash-cpad" style={{...cPad,borderBottom:"1px solid "+T.bg3,...sHdr}}>
              <span style={{display:"flex",alignItems:"center",gap:8}}>
                <span style={sTitle}>Needs Your Attention</span>
                {scope==="mine"&&<span style={{fontSize:9,fontWeight:800,letterSpacing:"0.06em",textTransform:"uppercase",color:"#3b82f6",background:"#3b82f610",padding:"2px 7px",borderRadius:99}}>Mine</span>}
              </span>
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
            <div style={{padding:"16px 20px"}}>
              <FunnelChart counts={countsByStage} onStageClick={s=>onNavigate("donors",{stageFilter:s})}/>
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

          {/* Recurring gift recovery — revenue-at-risk, not buried in a report */}
          {recurringHealth&&recurringHealth.activeCount>0&&(
            <div style={{...cardWrap,borderColor:recurringHealth.atRiskCount>0?"#c0392b30":T.bg3}}>
              <div className="dash-cpad" style={{...cPad,borderBottom:"1px solid "+T.bg3}}>
                <span style={sTitle}>Recurring Gifts</span>
              </div>
              <div style={{padding:"14px 20px"}}>
                {recurringHealth.atRiskCount>0?(
                  <>
                    <div style={{fontSize:20,fontWeight:800,fontFamily:"'DM Serif Display',serif",color:T.red,lineHeight:1}}>
                      {fmt(recurringHealth.mrrAtRisk)}<span style={{fontSize:12,fontWeight:600,color:T.ink3}}>/mo at risk</span>
                    </div>
                    <div style={{fontSize:12,color:T.ink3,marginTop:4}}>
                      {recurringHealth.atRiskCount} donor{recurringHealth.atRiskCount===1?"":"s"} with a failed card
                      {recurringHealth.recoveryRate!=null&&` · ${recurringHealth.recoveryRate}% recovery rate`}
                    </div>
                  </>
                ):(
                  <div style={{fontSize:13,color:T.ink3}}>
                    All {recurringHealth.activeCount} recurring gift{recurringHealth.activeCount===1?"":"s"} are current
                    {recurringHealth.recoveryRate!=null&&` · ${recurringHealth.recoveryRate}% recovery rate`}
                  </div>
                )}
              </div>
            </div>
          )}
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

      <MetricBreakdownPanel
        open={debtBreakdownOpen}
        onClose={()=>setDebtBreakdownOpen(false)}
        title="Stewardship Debt"
        explanation="Donors weighted by how long it's been since a real conversation, multiplied by how much they've given. The list below is ranked by who's contributing most to that number right now."
        loading={debtBreakdownLoading}
        total={debtBreakdown?.total?.toLocaleString()}
        totalLabel="Debt score"
        totalCount={debtBreakdown?.count}
        rows={(debtBreakdown?.rows||[]).map(r=>({
          donorId:r.donorId,
          donorName:r.donorName,
          detail:`${fmtFull(r.totalGiving)} total · ${r.daysSinceContact}d since contact`,
          value:r.contribution.toLocaleString(),
          percentOfTotal:r.percentOfTotal,
        }))}
        onSelectDonor={goToDonorFromBreakdown}
      />

      <MetricBreakdownPanel
        open={retentionBreakdownOpen}
        onClose={()=>setRetentionBreakdownOpen(false)}
        title="Donor Retention Rate"
        explanation={`Donors who gave in ${retentionBreakdown?.prevYear??"the prior year"} but haven't given again in ${retentionBreakdown?.year??"the current year"} — the specific list dragging the rate down, not just the percentage.`}
        loading={retentionBreakdownLoading}
        total={retentionBreakdown?.retentionRate!=null?`${retentionBreakdown.retentionRate}%`:"—"}
        totalLabel="Retention rate"
        totalCount={retentionBreakdown?.nonRetainedCount}
        rows={(retentionBreakdown?.rows||[]).map(r=>({
          donorId:r.donorId,
          donorName:r.donorName,
          detail:r.lastGiftDate?`Last gave ${new Date(r.lastGiftDate).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})}`:"No gift date on file",
          value:fmtFull(r.lastGiftAmount),
        }))}
        onSelectDonor={goToDonorFromBreakdown}
      />
    </div>
  );
}
