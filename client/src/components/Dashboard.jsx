import { useState, useRef, useEffect } from "react";
import { apiFetch } from "../api";
import { T, fmt, fmtFull, daysDiff, daysUntil, SC, askClaude, buildContext, STAGES, donorScore, Spin, Pill, Card, AIBtn, AIPanel, PageTitle, EmptyState } from "./shared";

// ── Global Chat ────────────────────────────────────────────────────────────
export function AIChat({data,onClose}) {
  const [msgs,setMsgs]=useState([{role:"assistant",content:`Hi! I'm your development intelligence assistant for ${data.org.name}. I have full context on your donors, grants, financials, board, and tasks.\n\nTry asking:\n• "Who should I call this week?"\n• "How's our grant pipeline?"\n• "Draft a script for my Margaret Chen call"\n• "What's our biggest financial risk right now?"\n• "Which volunteers should we convert to donors?"`}]);
  const [input,setInput]=useState(""); const [loading,setLoading]=useState(false); const bottomRef=useRef(null);
  const QUICK = ["Who should I call today?","Biggest risks this month?","Draft board update email","Upgrade path for William Park","Which grants need attention?"];

  const send = async (text) => {
    const msg = text||input; if(!msg.trim()||loading) return;
    setInput("");
    const history = [...msgs,{role:"user",content:msg}];
    setMsgs([...history,{role:"assistant",content:""}]);
    setLoading(true);
    const sys = `You are an expert nonprofit development strategist and AI assistant for ${data.org.name}. You have deep expertise in major gifts, grant writing, volunteer management, and nonprofit finance. Be specific, strategic, and reference actual names/numbers from the org data. Never be generic.\n\n${buildContext(data)}`;
    const apiMsgs = history.filter(m=>m.content).map(m=>({role:m.role,content:m.content}));
    try {
      await askClaude(sys, apiMsgs.map(m=>`${m.role==="user"?"User":"Assistant"}: ${m.content}`).join("\n\n"), chunk=>{
        setMsgs(prev=>prev.map((m,i)=>i===prev.length-1?{...m,content:chunk}:m));
      });
    } catch { setMsgs(prev=>prev.map((m,i)=>i===prev.length-1?{...m,content:"Connection error. Try again."}:m)); }
    setLoading(false);
  };

  return <div style={{position:"fixed",inset:0,background:"#000c",zIndex:1000,display:"flex",alignItems:"flex-end",justifyContent:"flex-end",padding:20}}>
    <div style={{background:"#0a0f1e",border:"1px solid #1a6b4a44",borderRadius:20,width:"100%",maxWidth:540,height:640,display:"flex",flexDirection:"column",overflow:"hidden",boxShadow:"0 25px 80px #1a6b4a22"}}>
      <div style={{padding:"14px 18px",borderBottom:"1px solid #1f2937",display:"flex",alignItems:"center",justifyContent:"space-between",background:"linear-gradient(135deg,#1a0f3c,#0f172a)"}}>
        <div><div style={{fontSize:14,fontWeight:800,color:"#f3f4f6"}}>✦ Development Intelligence</div><div style={{fontSize:11,color:"#1a6b4a"}}>Knows your full org in real time</div></div>
        <button onClick={onClose} style={{background:"#1f2937",border:"none",borderRadius:8,padding:"6px 12px",color:"#9ca3af",cursor:"pointer",fontSize:12}}>Close</button>
      </div>
      <div style={{display:"flex",gap:6,padding:"10px 14px",borderBottom:"1px solid #1f2937",overflowX:"auto",flexShrink:0}}>
        {QUICK.map(q=><button key={q} onClick={()=>send(q)} style={{background:"#1f2937",border:"1px solid #374151",borderRadius:20,padding:"5px 12px",color:"#9ca3af",fontSize:11,cursor:"pointer",whiteSpace:"nowrap",flexShrink:0}}>{q}</button>)}
      </div>
      <div style={{flex:1,overflowY:"auto",padding:14,display:"flex",flexDirection:"column",gap:10}}>
        {msgs.map((m,i)=><div key={i} style={{display:"flex",justifyContent:m.role==="user"?"flex-end":"flex-start"}}>
          <div style={{maxWidth:"88%",background:m.role==="user"?"#1a6b4a":"#1e293b",borderRadius:m.role==="user"?"14px 14px 4px 14px":"14px 14px 14px 4px",padding:"10px 14px",fontSize:13,color:"#f3f4f6",lineHeight:1.65,whiteSpace:"pre-wrap"}}>
            {m.content||(loading&&i===msgs.length-1?<span style={{color:"#1a6b4a"}}>▋</span>:"")}
          </div>
        </div>)}
        <div ref={bottomRef}/>
      </div>
      <div style={{padding:12,borderTop:"1px solid #1f2937",display:"flex",gap:8}}>
        <input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&send()} placeholder="Ask anything about your org…" style={{flex:1,background:"#1e293b",border:"1px solid #374151",borderRadius:10,padding:"10px 14px",color:"#f3f4f6",fontSize:13,outline:"none"}}/>
        <button onClick={()=>send()} disabled={loading||!input.trim()} style={{background:"#10b981",border:"none",borderRadius:10,padding:"10px 16px",color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer",opacity:loading||!input.trim()?0.5:1}}>↑</button>
      </div>
    </div>
  </div>;
}

// ── Dashboard ──────────────────────────────────────────────────────────────
export function Dashboard({data,setData,onNavigate}) {
  const todayStr=new Date().toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric"});
  const currentYear=new Date().getFullYear();

  const [briefing,setBriefing]=useState("");
  const [briefLoading,setBriefLoading]=useState(false);
  const [briefOpen,setBriefOpen]=useState(false);
  const [showAddDonor,setShowAddDonor]=useState(false);
  const [newDonor,setNewDonor]=useState({name:"",email:"",phone:"",stage:"prospect"});
  const [onlineGifts,setOnlineGifts]=useState([]);

  useEffect(()=>{
    apiFetch("/stripe/online-gifts").then(r=>setOnlineGifts(r||[])).catch(()=>{});
  },[]);

  const totalDonors=data.donors.length;
  const newDonorsThisYear=data.donors.filter(d=>d.lastGift&&new Date(d.lastGift).getFullYear()===currentYear).length;
  const activeGrantCount=data.grants.filter(g=>g.status==="active").length;
  const pipelineValue=data.grants.filter(g=>["active","pending","prospecting"].includes(g.status)).reduce((s,g)=>s+g.amount,0);
  const activeVolunteers=data.volunteers.filter(v=>v.lastActive&&daysDiff(v.lastActive)<=30).length;
  const openTasks=data.tasks.filter(t=>!t.done).length;
  const highPriorityTasks=data.tasks.filter(t=>!t.done&&t.priority==="high").length;
  const lapsedDonors=data.donors.filter(d=>d.stage==="lapsed");
  const lapsedValue=lapsedDonors.reduce((s,d)=>s+d.total,0);

  const stageSnap=STAGES.map(s=>({
    ...s,
    count:data.donors.filter(d=>(d.stage||"cultivate")===s.id).length,
    total:data.donors.filter(d=>(d.stage||"cultivate")===s.id).reduce((sum,d)=>sum+d.total,0),
  }));

  const upcomingGrants=[...data.grants]
    .filter(g=>g.status!=="closed"&&daysUntil(g.deadline)>=-7)
    .sort((a,b)=>new Date(a.deadline)-new Date(b.deadline))
    .slice(0,3);

  const recentGifts=[...data.donors]
    .filter(d=>d.lastGift&&d.lastAmount>0)
    .sort((a,b)=>new Date(b.lastGift)-new Date(a.lastGift))
    .slice(0,5);

  const activityFeed=data.donors
    .flatMap(d=>(d.interactions||[]).map(i=>({...i,donorName:d.name,donorId:d.id})))
    .sort((a,b)=>new Date(b.date)-new Date(a.date))
    .slice(0,10);

  const todayIso=new Date().toISOString().split("T")[0];
  const weekEndIso=new Date(Date.now()+7*86400000).toISOString().split("T")[0];
  const todayTasks=data.tasks.filter(t=>!t.done&&t.due===todayIso).sort((a,b)=>({high:0,medium:1,low:2}[a.priority]-{high:0,medium:1,low:2}[b.priority]));
  const weekTasks=data.tasks.filter(t=>!t.done&&t.due>todayIso&&t.due<=weekEndIso).sort((a,b)=>new Date(a.due)-new Date(b.due));

  const generateBriefing=async()=>{
    setBriefLoading(true);setBriefing("");setBriefOpen(true);
    await askClaude(
      `You are a chief development officer. Write a crisp daily briefing. Use bullet points. Be specific with names and numbers. Max 250 words.`,
      `Generate today's development briefing for ${data.org.name}.\nToday: ${todayStr}\n\n${buildContext(data)}\n\nFormat:\n**TODAY'S PRIORITY CALLS** (top 2-3 donors to contact with specific reason)\n**GRANT ALERTS** (anything urgent in next 30 days)\n**FINANCIAL PULSE** (1-2 sentences on cash/revenue)\n**ONE THING** (the single most important action today)\n\nBe sharp and specific.`,
      chunk=>setBriefing(chunk)
    );
    setBriefLoading(false);
  };

  const addDonorQuick=async()=>{
    if(!newDonor.name.trim())return;
    try{
      await apiFetch("/donors",{method:"POST",body:JSON.stringify({...newDonor})});
      const donors=await apiFetch("/donors");
      setData(prev=>({...prev,donors:donors.map(d=>{
        const ints=(d.interactions||[]).map(i=>({date:i.date||i.created_at?.split("T")[0],type:i.type,note:i.note||""}));
        const lastTouchpoint=ints.length>0?ints.slice().sort((a,b)=>new Date(b.date)-new Date(a.date))[0].date:null;
        return{id:d.id,name:d.name,email:d.email||"",phone:d.phone||"",total:d.total_giving||0,
          lastGift:d.last_gift_date||"",lastAmount:d.last_gift_amount||0,gifts:d.gift_count||0,
          status:d.status,stage:d.stage||"cultivate",lastTouchpoint,
          tags:Array.isArray(d.tags)?d.tags:JSON.parse(d.tags||"[]"),notes:d.notes||"",interactions:ints};
      })}));
    }catch(e){console.error(e);}
    setShowAddDonor(false);setNewDonor({name:"",email:"",phone:"",stage:"prospect"});
    onNavigate("donors");
  };

  const toggleTask=id=>setData(prev=>({...prev,tasks:prev.tasks.map(t=>t.id===id?{...t,done:!t.done}:t)}));

  const bLines=briefing.split("\n").filter(l=>l.trim()&&!l.startsWith("**")&&l.trim().length>15);
  const pullQuote=bLines.length?bLines[0].replace(/^[•\-\*\s]+/,"").slice(0,160):"";
  const briefRest=pullQuote?briefing.slice(briefing.indexOf(pullQuote)+pullQuote.length).trim():"";

  const sHdr={display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:0};
  const sTitle={fontSize:10,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color:T.ink3};
  const sLink={background:"transparent",border:"none",padding:0,color:T.greenDk,fontSize:12,fontWeight:700,cursor:"pointer"};
  const cardWrap={background:T.white,border:"1px solid "+T.bg3,borderRadius:14,overflow:"hidden"};
  const cPad={padding:"14px 20px"};
  const typeColor={call:"#3b82f6",email:"#8b5cf6",meeting:"#1a6b4a",gift:"#f59e0b",event:"#ec4899",note:"#6b7280"};

  const QUICK=[
    {icon:<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" width="18" height="18"><circle cx="10" cy="7" r="3.5"/><path d="M3 17c0-3.3 3.1-6 7-6s7 2.7 7 6" strokeLinecap="round"/><line x1="14" y1="4" x2="18" y2="4" strokeLinecap="round"/><line x1="16" y1="2" x2="16" y2="6" strokeLinecap="round"/></svg>,label:"Add Donor",action:()=>setShowAddDonor(true)},
    {icon:<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" width="18" height="18"><rect x="3" y="5" width="14" height="11" rx="2"/><path d="M7 5V4a1 1 0 011-1h4a1 1 0 011 1v1" strokeLinecap="round"/><line x1="7" y1="10" x2="13" y2="10" strokeLinecap="round"/><line x1="10" y1="7.5" x2="10" y2="12.5" strokeLinecap="round"/></svg>,label:"Log Gift",action:()=>onNavigate("donors")},
    {icon:<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" width="18" height="18"><path d="M10 3l1.8 5.4H17l-4.5 3.3 1.7 5.3L10 14l-4.2 3 1.7-5.3L3 8.4h5.2z" strokeLinejoin="round"/></svg>,label:"New Grant",action:()=>onNavigate("grants")},
    {icon:<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" width="18" height="18"><circle cx="10" cy="7" r="3.5"/><path d="M3 17c0-3.3 3.1-6 7-6s7 2.7 7 6" strokeLinecap="round"/></svg>,label:"Add Volunteer",action:()=>onNavigate("volunteers")},
    {icon:<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" width="18" height="18"><rect x="3" y="3" width="14" height="14" rx="2"/><line x1="7" y1="9" x2="13" y2="9" strokeLinecap="round"/><line x1="7" y1="12" x2="11" y2="12" strokeLinecap="round"/><line x1="10" y1="5.5" x2="10" y2="3" strokeLinecap="round"/></svg>,label:"New Task",action:()=>onNavigate("tasks")},
    {icon:<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" width="18" height="18"><rect x="2" y="5" width="16" height="11" rx="2"/><path d="M2 8l8 5 8-5" strokeLinecap="round"/></svg>,label:"Send Email",action:()=>onNavigate("communications")},
  ];

  return(
    <div style={{display:"flex",flexDirection:"column",gap:16}} className="fade-in">
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10}}>
        {[
          {label:"Total Donors",value:totalDonors,sub:`${newDonorsThisYear} gave this year`,tab:"donors"},
          {label:"Active Grants",value:activeGrantCount,sub:fmt(pipelineValue)+" pipeline",tab:"grants"},
          {label:"Active Volunteers",value:activeVolunteers,sub:"in last 30 days",tab:"volunteers"},
          {label:"Open Tasks",value:openTasks,sub:highPriorityTasks>0?`${highPriorityTasks} high priority`:"all on track",tab:"tasks"},
        ].map(s=>(
          <div key={s.label} onClick={()=>onNavigate(s.tab)} className="card-click" style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:14,padding:"16px 20px",cursor:"pointer",borderLeft:"3px solid #1a6b4a"}}>
            <div style={{fontSize:10,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color:T.ink3,marginBottom:4}}>{s.label}</div>
            <div style={{fontSize:28,fontWeight:800,color:"#1a6b4a",fontFamily:"'DM Serif Display',serif",lineHeight:1.05,letterSpacing:"-0.02em"}}>{s.value}</div>
            <div style={{fontSize:11,color:T.ink3,marginTop:4}}>{s.sub}</div>
          </div>
        ))}
      </div>

      <div style={{display:"grid",gridTemplateColumns:"minmax(0,1fr) 320px",gap:16,alignItems:"start"}}>
        <div style={{display:"flex",flexDirection:"column",gap:14}}>
          {/* AI Briefing */}
          <div style={{...cardWrap}}>
            <div style={{...cPad,borderBottom:"1px solid "+T.bg3,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div style={{display:"flex",alignItems:"center",gap:10}}>
                <span style={{background:"#1a6b4a",color:"#fff",fontSize:9,fontWeight:800,padding:"3px 8px",borderRadius:99,letterSpacing:"0.1em",textTransform:"uppercase"}}>AI</span>
                <span style={{fontSize:11,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.08em",fontWeight:600}}>{todayStr}</span>
              </div>
              {!briefing&&!briefLoading&&<AIBtn onClick={generateBriefing} label="✦ Generate briefing" small/>}
              {briefLoading&&<div style={{display:"flex",alignItems:"center",gap:6,fontSize:12,color:T.ink3}}><Spin/>Thinking…</div>}
            </div>
            <div style={{padding:"18px 24px"}}>
              {!briefing&&!briefLoading&&(
                <div style={{fontSize:13,color:T.ink3,fontStyle:"italic",lineHeight:1.7}}>
                  Get your personalized daily development briefing — who to call, what's urgent, one priority action.
                </div>
              )}
              {briefLoading&&!briefing&&(
                <div style={{fontSize:13,color:T.ink3,fontStyle:"italic"}}>Reading your org context…</div>
              )}
              {(briefing||briefLoading)&&pullQuote&&(
                <>
                  <blockquote style={{fontFamily:"'DM Serif Display',Georgia,serif",fontSize:17,fontStyle:"italic",color:T.ink,lineHeight:1.55,margin:"0 0 14px 0",paddingLeft:16,borderLeft:"3px solid #1a6b4a"}}>
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

          {/* Donor pipeline snapshot */}
          <div style={{...cardWrap}}>
            <div style={{...cPad,borderBottom:"1px solid "+T.bg3,...sHdr}}>
              <span style={sTitle}>Donor Pipeline</span>
              <button onClick={()=>onNavigate("donors")} style={sLink}>View all →</button>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(6,1fr)"}}>
              {stageSnap.map((s,i)=>(
                <div key={s.id} onClick={()=>onNavigate("donors")} className="dash-row" style={{
                  padding:"14px 12px",borderRight:i<5?"1px solid "+T.bg3:"none",
                  cursor:"pointer",borderTop:`3px solid ${s.color}`,
                }}>
                  <div style={{fontSize:9,fontWeight:800,textTransform:"uppercase",letterSpacing:"0.08em",color:s.color,marginBottom:6}}>{s.label}</div>
                  <div style={{fontSize:20,fontWeight:800,color:s.count>0?T.ink:T.ink3,fontFamily:"'DM Serif Display',serif",lineHeight:1}}>{s.count}</div>
                  <div style={{fontSize:11,color:T.ink3,marginTop:3}}>{s.total>0?fmt(s.total):"—"}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Lapsed alert */}
          {lapsedDonors.length>0&&(
            <div style={{background:"#fff8f0",border:"1px solid #f59e0b40",borderRadius:14,padding:"16px 20px",display:"flex",alignItems:"center",justifyContent:"space-between",gap:12}}>
              <div>
                <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:4}}>
                  <div style={{width:7,height:7,borderRadius:"50%",background:"#ef4444",flexShrink:0,boxShadow:"0 0 6px #ef444460"}}/>
                  <span style={{fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.1em",color:"#dc2626"}}>Lapsed Donors</span>
                </div>
                <div style={{fontSize:26,fontWeight:800,fontFamily:"'DM Serif Display',serif",color:T.ink,lineHeight:1}}>{lapsedDonors.length}</div>
                <div style={{fontSize:12,color:T.ink3,marginTop:4}}>{fmtFull(lapsedValue)} lifetime value at risk</div>
              </div>
              <button onClick={()=>onNavigate("donors")} style={{background:"#ef4444",border:"none",borderRadius:10,padding:"10px 18px",color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap",flexShrink:0}}>
                Re-engage →
              </button>
            </div>
          )}

          {/* Upcoming grant deadlines */}
          <div style={{...cardWrap}}>
            <div style={{...cPad,borderBottom:"1px solid "+T.bg3,...sHdr}}>
              <span style={sTitle}>Grant Deadlines</span>
              <button onClick={()=>onNavigate("grants")} style={sLink}>All grants →</button>
            </div>
            {upcomingGrants.length===0&&<div style={{...cPad,fontSize:13,color:T.ink3,fontStyle:"italic"}}>No upcoming deadlines</div>}
            {upcomingGrants.map((g,i)=>{
              const d=daysUntil(g.deadline);
              const urgColor=d<14?"#ef4444":d<30?"#f59e0b":"#1a6b4a";
              return(
                <div key={g.id} className="dash-row" onClick={()=>onNavigate("grants")} style={{
                  display:"flex",alignItems:"center",gap:12,padding:"12px 20px",
                  borderBottom:i<upcomingGrants.length-1?"1px solid "+T.bg3:"none",cursor:"pointer",
                }}>
                  <div style={{background:urgColor+"15",border:"1px solid "+urgColor+"30",borderRadius:8,padding:"6px 10px",minWidth:46,textAlign:"center",flexShrink:0}}>
                    <div style={{fontSize:12,fontWeight:800,color:urgColor,lineHeight:1}}>{d<0?"past":d+"d"}</div>
                  </div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:13,fontWeight:600,color:T.ink,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{g.funder}</div>
                    <div style={{fontSize:11,color:T.ink3,marginTop:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{g.program}</div>
                  </div>
                  <div style={{textAlign:"right",flexShrink:0}}>
                    <div style={{fontSize:13,fontWeight:700,color:T.ink}}>{fmt(g.amount)}</div>
                    <div style={{marginTop:4}}><Pill label={g.status} color={SC[g.status]}/></div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Recent giving */}
          <div style={{...cardWrap}}>
            <div style={{...cPad,borderBottom:"1px solid "+T.bg3,...sHdr}}>
              <span style={sTitle}>Recent Giving</span>
              <button onClick={()=>onNavigate("donors")} style={sLink}>All donors →</button>
            </div>
            {recentGifts.length===0&&<div style={{...cPad,fontSize:13,color:T.ink3,fontStyle:"italic"}}>No gift history yet</div>}
            {recentGifts.map((d,i)=>{
              const dAgo=daysDiff(d.lastGift);
              const when=dAgo===0?"Today":dAgo===1?"Yesterday":`${dAgo}d ago`;
              const sc=donorScore(d);const scColor=sc>70?"#1a6b4a":sc>45?"#f59e0b":"#ef4444";
              return(
                <div key={d.id} className="dash-row" onClick={()=>onNavigate("donors")} style={{
                  display:"flex",alignItems:"center",gap:12,padding:"11px 20px",
                  borderBottom:i<recentGifts.length-1?"1px solid "+T.bg3:"none",cursor:"pointer",
                }}>
                  <div style={{width:34,height:34,borderRadius:"50%",background:scColor+"20",display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,fontWeight:700,color:scColor,flexShrink:0}}>{d.name[0]}</div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:13,fontWeight:600,color:T.ink,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{d.name}</div>
                    <div style={{fontSize:11,color:T.ink3,marginTop:1}}>{when}</div>
                  </div>
                  <div style={{textAlign:"right",flexShrink:0}}>
                    <div style={{fontSize:14,fontWeight:800,color:"#1a6b4a"}}>{fmtFull(d.lastAmount)}</div>
                    <div style={{fontSize:10,color:T.ink3,marginTop:2}}>{fmtFull(d.total)} lifetime</div>
                  </div>
                </div>
              );
            })}
          </div>

          {onlineGifts.length>0&&<div style={{...cardWrap}}>
            <div style={{...cPad,borderBottom:"1px solid "+T.bg3,...sHdr}}>
              <span style={sTitle}>Recent Online Gifts</span>
              <span style={{fontSize:11,color:T.ink3}}>via Stripe</span>
            </div>
            {onlineGifts.slice(0,5).map((g,i)=>{
              const dAgo=daysDiff(g.date);
              const when=dAgo===0?"Today":dAgo===1?"Yesterday":`${dAgo}d ago`;
              return(
                <div key={g.id} style={{
                  display:"flex",alignItems:"center",gap:12,padding:"11px 20px",
                  borderBottom:i<Math.min(onlineGifts.length,5)-1?"1px solid "+T.bg3:"none",
                }}>
                  <div style={{width:34,height:34,borderRadius:"50%",background:"#ede9fe",display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,flexShrink:0}}>💳</div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:13,fontWeight:600,color:T.ink,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{g.donorName||g.donorEmail}</div>
                    <div style={{fontSize:11,color:T.ink3,marginTop:1}}>{when}</div>
                  </div>
                  <div style={{textAlign:"right",flexShrink:0}}>
                    <div style={{fontSize:14,fontWeight:800,color:"#1a6b4a"}}>{fmtFull(g.amount)}</div>
                    <div style={{fontSize:10,background:"#ede9fe",color:"#7c3aed",borderRadius:4,padding:"1px 5px",marginTop:2,fontWeight:600}}>Online</div>
                  </div>
                </div>
              );
            })}
          </div>}
        </div>

        {/* RIGHT COLUMN */}
        <div style={{display:"flex",flexDirection:"column",gap:14}}>
          {/* Quick actions */}
          <div style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:14,overflow:"hidden",padding:"14px 20px"}}>
            <div style={sTitle}>Quick Actions</div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginTop:12}}>
              {QUICK.map(a=>(
                <button key={a.label} onClick={a.action} className="dash-action" style={{
                  background:T.bg,border:"1px solid "+T.bg3,borderRadius:10,
                  padding:"12px 8px",display:"flex",flexDirection:"column",alignItems:"center",gap:6,cursor:"pointer",
                }}>
                  <div style={{width:32,height:32,borderRadius:8,background:"#1a6b4a18",display:"flex",alignItems:"center",justifyContent:"center",color:"#1a6b4a"}}>
                    {a.icon}
                  </div>
                  <span style={{fontSize:10,fontWeight:700,color:T.ink3,textAlign:"center",lineHeight:1.3,letterSpacing:"0.02em"}}>{a.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Tasks this week */}
          <div style={{...cardWrap}}>
            <div style={{...cPad,borderBottom:"1px solid "+T.bg3,...sHdr}}>
              <span style={sTitle}>Tasks This Week</span>
              <button onClick={()=>onNavigate("tasks")} style={sLink}>All →</button>
            </div>
            {todayTasks.length===0&&weekTasks.length===0&&(
              <div style={{...cPad,fontSize:13,color:T.ink3,fontStyle:"italic"}}>No tasks due today or this week</div>
            )}
            {todayTasks.length>0&&(
              <>
                <div style={{padding:"6px 20px 4px",fontSize:9,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.1em",color:T.ink3,background:T.bg,borderBottom:"1px solid "+T.bg3}}>Today</div>
                {todayTasks.map((t)=>(
                  <div key={t.id} className="dash-row" onClick={()=>toggleTask(t.id)} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 20px",borderBottom:"1px solid "+T.bg3,cursor:"pointer"}}>
                    <div style={{width:16,height:16,borderRadius:4,border:`2px solid ${SC[t.priority]}`,flexShrink:0}}/>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:12,color:T.ink,fontWeight:500,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.title}</div>
                    </div>
                    <Pill label={t.priority} color={SC[t.priority]}/>
                  </div>
                ))}
              </>
            )}
            {weekTasks.length>0&&(
              <>
                <div style={{padding:"6px 20px 4px",fontSize:9,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.1em",color:T.ink3,background:T.bg,borderBottom:"1px solid "+T.bg3}}>This week</div>
                {weekTasks.map((t,i)=>(
                  <div key={t.id} className="dash-row" onClick={()=>toggleTask(t.id)} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 20px",borderBottom:i<weekTasks.length-1?"1px solid "+T.bg3:"none",cursor:"pointer"}}>
                    <div style={{width:16,height:16,borderRadius:4,border:`2px solid ${SC[t.priority]}`,flexShrink:0}}/>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:12,color:T.ink,fontWeight:500,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.title}</div>
                      {t.due&&<div style={{fontSize:10,color:T.ink3,marginTop:2}}>{new Date(t.due).toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric"})}</div>}
                    </div>
                    <Pill label={t.priority} color={SC[t.priority]}/>
                  </div>
                ))}
              </>
            )}
          </div>

          {/* Activity feed */}
          <div style={{...cardWrap}}>
            <div style={{...cPad,borderBottom:"1px solid "+T.bg3}}>
              <span style={sTitle}>Recent Activity</span>
            </div>
            {activityFeed.length===0&&<div style={{...cPad,fontSize:13,color:T.ink3,fontStyle:"italic"}}>No activity logged yet</div>}
            {activityFeed.map((item,i)=>{
              const tc=typeColor[item.type]||"#6b7280";
              const dAgo=daysDiff(item.date);
              const when=dAgo===0?"Today":dAgo===1?"Yesterday":`${dAgo}d ago`;
              return(
                <div key={i} className="dash-row" onClick={()=>onNavigate("donors")} style={{
                  display:"flex",alignItems:"flex-start",gap:10,padding:"10px 20px",
                  borderBottom:i<activityFeed.length-1?"1px solid "+T.bg3:"none",cursor:"pointer",
                }}>
                  <div style={{width:7,height:7,borderRadius:"50%",background:tc,marginTop:4,flexShrink:0}}/>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:12,color:T.ink,lineHeight:1.4}}>
                      <span style={{fontWeight:600}}>{item.donorName}</span>
                      {" · "}<span style={{color:tc,fontWeight:600,textTransform:"capitalize"}}>{item.type}</span>
                    </div>
                    {item.note&&<div style={{fontSize:11,color:T.ink3,marginTop:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{item.note}</div>}
                  </div>
                  <div style={{fontSize:10,color:T.ink3,flexShrink:0,marginTop:2,whiteSpace:"nowrap"}}>{when}</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Quick-add donor modal */}
      {showAddDonor&&(
        <div style={{position:"fixed",inset:0,background:"#000000cc",backdropFilter:"blur(4px)",zIndex:300,display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
          <div className="fade-in" style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:18,width:"100%",maxWidth:420,padding:24,boxShadow:"0 4px 32px rgba(15,15,15,0.12)"}}>
            <div style={{fontSize:16,fontWeight:800,color:T.ink,marginBottom:16}}>Add Donor</div>
            {[["name","Full Name"],["email","Email"],["phone","Phone"]].map(([k,pl])=>(
              <input key={k} value={newDonor[k]||""} onChange={e=>setNewDonor(p=>({...p,[k]:e.target.value}))} placeholder={pl}
                style={{width:"100%",boxSizing:"border-box",background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"9px 12px",color:T.ink,fontSize:13,outline:"none",marginBottom:10}}/>
            ))}
            <div style={{fontSize:11,fontWeight:700,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:8}}>Stage</div>
            <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:16}}>
              {STAGES.map(s=>(
                <button key={s.id} onClick={()=>setNewDonor(p=>({...p,stage:s.id}))}
                  style={{background:newDonor.stage===s.id?s.color+"22":T.bg,border:`1px solid ${newDonor.stage===s.id?s.color:T.bg3}`,borderRadius:7,padding:"5px 11px",color:newDonor.stage===s.id?s.color:T.ink3,fontSize:12,fontWeight:600,cursor:"pointer"}}>
                  {s.label}
                </button>
              ))}
            </div>
            <div style={{display:"flex",gap:8}}>
              <button onClick={addDonorQuick} disabled={!newDonor.name.trim()} style={{flex:1,background:newDonor.name.trim()?"#10b981":T.bg2,border:"none",borderRadius:10,padding:"11px",color:"#fff",fontSize:14,fontWeight:700,cursor:newDonor.name.trim()?"pointer":"not-allowed"}}>
                Save Donor
              </button>
              <button onClick={()=>setShowAddDonor(false)} style={{background:T.bg,border:"none",borderRadius:10,padding:"11px 14px",color:T.ink3,fontSize:13,cursor:"pointer"}}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
