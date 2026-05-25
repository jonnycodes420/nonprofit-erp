import { useState, useEffect } from "react";
import { apiFetch, adaptData } from "./api";
import { useAuth } from "./main";
import { T, GlobalStyles } from "./components/shared";
import { AIChat, Dashboard } from "./components/Dashboard";
import { Donors } from "./components/Donors";
import { Grants } from "./components/Grants";
import { Communications } from "./components/Communications";
import { Volunteers } from "./components/Volunteers";
import { Board } from "./components/Board";
import { Finance } from "./components/Finance";
import { Tasks } from "./components/Tasks";
import { Settings } from "./components/Settings";

// ── Tabs ───────────────────────────────────────────────────────────────────
const TABS=[
  {id:"dashboard",label:"Dashboard",icon:"◈"},
  {id:"donors",label:"Donors",icon:"♦"},
  {id:"grants",label:"Grants",icon:"◉"},
  {id:"communications",label:"Communications",icon:"◑"},
  {id:"finance",label:"Finance",icon:"◇"},
  {id:"volunteers",label:"Volunteers",icon:"◎",earlyAccess:true},
  {id:"board",label:"Board",icon:"◆",earlyAccess:true},
  {id:"tasks",label:"Tasks",icon:"◻"},
  {id:"settings",label:"Settings",icon:"⚙"},
];
const BOTTOM_TABS=[
  {id:"dashboard",label:"Dashboard",icon:"◈"},
  {id:"donors",label:"Donors",icon:"♦"},
  {id:"grants",label:"Grants",icon:"◉"},
  {id:"finance",label:"Finance",icon:"◇"},
];
const MORE_TABS=[
  {id:"communications",label:"Communications",icon:"◑"},
  {id:"volunteers",label:"Volunteers",icon:"◎",earlyAccess:true},
  {id:"board",label:"Board",icon:"◆",earlyAccess:true},
  {id:"tasks",label:"Tasks",icon:"◻"},
  {id:"settings",label:"Settings",icon:"⚙"},
];

// ── App Shell ──────────────────────────────────────────────────────────────
function AppShell() {
  const { auth, logout } = useAuth();
  const [tab,setTab]=useState("dashboard");
  const [data,setData]=useState(null);
  const [loading,setLoading]=useState(true);
  const [loadErr,setLoadErr]=useState("");
  const [showChat,setShowChat]=useState(false);
  const [stripeToast,setStripeToast]=useState(false);
  const [moreOpen,setMoreOpen]=useState(false);

  useEffect(()=>{
    const params=new URLSearchParams(window.location.search);
    if(params.get("stripe_connected")==="true"){
      setStripeToast(true);
      window.history.replaceState({},"","/dashboard");
      setTimeout(()=>setStripeToast(false),6000);
    }
  },[]);

  useEffect(()=>{
    (async()=>{
      try {
        const [org,donors,grants,volunteers,tasks,board,financials] = await Promise.all([
          apiFetch("/org"),
          apiFetch("/donors"),
          apiFetch("/grants"),
          apiFetch("/volunteers"),
          apiFetch("/tasks"),
          apiFetch("/board"),
          apiFetch("/financials"),
        ]);
        setData(adaptData({org,donors,grants,volunteers,tasks,board,financials}));
      } catch(e) { setLoadErr(e.message); }
      setLoading(false);
    })();
  },[]);

  const BASE = {minHeight:"100vh",background:T.bg,fontFamily:"'DM Sans',system-ui,sans-serif",overflowX:"hidden",maxWidth:"100vw"};

  if(loading) return <div style={{...BASE,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:16}}>
    <GlobalStyles/>
    <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=DM+Serif+Display&display=swap" rel="stylesheet"/>
    <div style={{width:40,height:40,background:T.green,borderRadius:14,display:"flex",alignItems:"center",justifyContent:"center"}}>
      <svg width="20" height="20" viewBox="0 0 16 16" fill="none"><path d="M8 2L13 5v6L8 14 3 11V5L8 2z" stroke="#fff" strokeWidth="1.5" fill="none"/><circle cx="8" cy="8" r="2" fill="#fff"/></svg>
    </div>
    <div style={{display:"flex",alignItems:"center",gap:10,color:T.ink3,fontSize:13}}><span style={{display:"inline-block",width:14,height:14,border:"2px solid "+T.bg3,borderTopColor:T.green,borderRadius:"50%",animation:"sp 0.7s linear infinite"}}/>Loading your workspace…</div>
  </div>;

  if(loadErr||!data) return <div style={{...BASE,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:12}}>
    <GlobalStyles/>
    <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=DM+Serif+Display&display=swap" rel="stylesheet"/>
    <div style={{fontSize:32,opacity:0.2,color:T.ink}}>◈</div>
    <div style={{fontSize:15,fontWeight:700,color:"#dc2626"}}>Failed to connect</div>
    <div style={{fontSize:13,color:T.ink3,maxWidth:300,textAlign:"center"}}>{loadErr||"Could not load your workspace. Check your connection and try again."}</div>
    <button onClick={()=>window.location.reload()} style={{marginTop:4,background:T.green,border:"none",borderRadius:10,padding:"9px 20px",color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer"}}>Retry</button>
  </div>;

  const tasksDue=data.tasks.filter(t=>!t.done&&t.priority==="high").length;
  const orgName=auth?.org?.name||data.org?.name||"Steward";

  return <div className="app-root" style={{...BASE,color:T.ink,display:"flex",flexDirection:"column"}}>
    <GlobalStyles/>
    <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=DM+Serif+Display&display=swap" rel="stylesheet"/>

    {/* Header */}
    <div style={{borderBottom:"1px solid "+T.bg3,padding:"0 24px",display:"flex",alignItems:"center",justifyContent:"space-between",background:T.bg,position:"sticky",top:0,zIndex:100,height:56}}>
      <div style={{display:"flex",alignItems:"center",gap:12}}>
        <div style={{width:32,height:32,background:T.green,borderRadius:8,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 2L13 5v6L8 14 3 11V5L8 2z" stroke="#fff" strokeWidth="1.5" fill="none"/><circle cx="8" cy="8" r="2" fill="#fff"/></svg>
        </div>
        <div style={{display:"flex",alignItems:"baseline",gap:8}}>
          <span style={{fontSize:15,fontWeight:700,color:T.ink,letterSpacing:"-0.02em"}}>{orgName}</span>
          <span style={{fontSize:10,color:T.ink3,letterSpacing:"0.06em",textTransform:"uppercase"}}>Steward</span>
        </div>
      </div>
      <div style={{display:"flex",gap:8,alignItems:"center"}}>
        <button onClick={()=>setShowChat(true)} style={{background:T.green,border:"none",borderRadius:10,padding:"7px 16px",color:"#fff",fontSize:12,fontWeight:700,cursor:"pointer",display:"flex",alignItems:"center",gap:7}}>
          ✦ Ask AI
        </button>
        <div className="app-avatar" style={{width:30,height:30,borderRadius:8,background:auth?.user?.role==="admin"?T.green+"18":T.bg2,border:`1px solid ${auth?.user?.role==="admin"?T.green+"40":T.bg3}`,display:"flex",alignItems:"center",justifyContent:"center"}}>
          <span style={{fontSize:12,fontWeight:700,color:auth?.user?.role==="admin"?T.greenDk:T.ink3}}>{(auth?.user?.name||"U")[0].toUpperCase()}</span>
        </div>
        <button onClick={logout} className="app-signout" style={{background:"transparent",border:"1px solid "+T.bg3,borderRadius:8,padding:"6px 12px",color:T.ink3,fontSize:12,cursor:"pointer"}}>
          Sign out
        </button>
      </div>
    </div>

    {/* Tab bar */}
    <div className="app-tabbar" style={{display:"flex",padding:"0 20px",borderBottom:"1px solid "+T.bg3,overflowX:"auto",flexShrink:0,background:T.bg}}>
      {TABS.map(t=>{
        const active=tab===t.id;
        return <button key={t.id} onClick={()=>setTab(t.id)} style={{background:"transparent",border:"none",borderBottom:`2px solid ${active?T.greenDk:"transparent"}`,padding:"12px 18px",color:active?T.greenDk:T.ink3,fontSize:13,fontWeight:active?700:500,cursor:"pointer",display:"flex",alignItems:"center",gap:6,whiteSpace:"nowrap",transition:"color 0.15s,border-color 0.15s",flexShrink:0,marginBottom:-1}}>
          {t.label}
          {t.earlyAccess&&<span style={{fontSize:9,fontWeight:700,letterSpacing:"0.04em",background:T.greenDk+"18",color:T.greenDk,border:`1px solid ${T.greenDk}30`,borderRadius:99,padding:"1px 6px",lineHeight:"14px"}}>Early Access</span>}
          {t.id==="tasks"&&tasksDue>0&&<span style={{background:"#ef4444",color:"#fff",fontSize:9,fontWeight:800,borderRadius:99,padding:"1px 5px",lineHeight:"14px"}}>{tasksDue}</span>}
        </button>;
      })}
    </div>

    <div className="app-content" style={{flex:1,padding:"28px 24px",maxWidth:1400,width:"100%",margin:"0 auto",boxSizing:"border-box"}}>
      {tab==="dashboard"&&<Dashboard data={data} setData={setData} onNavigate={setTab}/>}
      {tab==="donors"&&<Donors data={data} setData={setData}/>}
      {tab==="grants"&&<Grants data={data} setData={setData}/>}
      {tab==="communications"&&<Communications data={data}/>}
      {tab==="volunteers"&&<Volunteers data={data}/>}
      {tab==="board"&&<Board data={data}/>}
      {tab==="finance"&&<Finance data={data}/>}
      {tab==="tasks"&&<Tasks data={data} setData={setData}/>}
      {tab==="settings"&&<Settings auth={auth} logout={logout}/>}
    </div>
    {showChat&&<AIChat data={data} onClose={()=>setShowChat(false)}/>}
    {stripeToast&&<div style={{position:"fixed",bottom:24,right:24,zIndex:9999,background:T.greenDk,color:"#fff",borderRadius:14,padding:"14px 20px",fontSize:13,fontWeight:600,boxShadow:"0 8px 32px rgba(26,107,74,0.35)",display:"flex",alignItems:"center",gap:10,maxWidth:340}}>
      <span style={{fontSize:18}}>💳</span>
      <div>
        <div style={{fontWeight:700,marginBottom:2}}>Stripe connected!</div>
        <div style={{fontWeight:400,opacity:0.85}}>You can now accept online donations.</div>
      </div>
      <button onClick={()=>setStripeToast(false)} style={{marginLeft:"auto",background:"rgba(255,255,255,0.2)",border:"none",borderRadius:6,color:"#fff",cursor:"pointer",padding:"2px 8px",fontSize:13,fontWeight:700}}>✕</button>
    </div>}

    {/* More drawer — mobile only */}
    {moreOpen&&<div className="mobile-more-overlay" onClick={()=>setMoreOpen(false)}>
      <div className="mobile-more-drawer slide-up" onClick={e=>e.stopPropagation()}>
        <div className="mobile-more-handle"/>
        {MORE_TABS.map(t=>{
          const active=tab===t.id;
          return(
            <button key={t.id} onClick={()=>{setTab(t.id);setMoreOpen(false);}} className={`mobile-more-row${active?" active":""}`}>
              <span className="mob-icon">{t.icon}</span>
              <span style={{flex:1}}>{t.label}</span>
              {t.earlyAccess&&<span style={{fontSize:9,fontWeight:700,letterSpacing:"0.04em",background:T.greenDk+"18",color:T.greenDk,border:`1px solid ${T.greenDk}30`,borderRadius:99,padding:"2px 7px"}}>Early Access</span>}
              {t.id==="tasks"&&tasksDue>0&&<span style={{background:"#ef4444",color:"#fff",fontSize:10,fontWeight:800,borderRadius:99,padding:"1px 6px"}}>{tasksDue}</span>}
            </button>
          );
        })}
        <div style={{borderTop:"1px solid "+T.bg3,margin:"4px 0"}}/>
        <button className="mobile-more-signout" onClick={()=>{logout();setMoreOpen(false);}}>
          <span className="mob-icon" style={{fontSize:18,width:28,textAlign:"center"}}>↩</span>
          Sign out
        </button>
      </div>
    </div>}

    {/* Bottom nav bar — mobile only, always in DOM */}
    <div className="mobile-bottom-bar">
      {BOTTOM_TABS.map(t=>(
        <button key={t.id} onClick={()=>{setTab(t.id);setMoreOpen(false);}} className={`mobile-bottom-tab${tab===t.id?" active":""}`}>
          <span className="mob-icon">{t.icon}</span>
          {t.label}
        </button>
      ))}
      <button onClick={()=>setMoreOpen(v=>!v)} className={`mobile-bottom-tab${MORE_TABS.some(t=>t.id===tab)||moreOpen?" active":""}`}>
        <span className="mob-icon">⋯</span>
        More
      </button>
    </div>
  </div>;
}

// ── Root ───────────────────────────────────────────────────────────────────
export default function App() {
  if (typeof window !== 'undefined') {
    console.log('APP LOADED', localStorage.getItem('npe_token'));
  }
  return <AppShell />;
}
