import { useState, useEffect } from "react";
import { apiFetch, adaptData, API, getToken } from "./api";
import { useAuth } from "./main";
import { T, GlobalStyles } from "./components/shared";
// SHELVED — voice capture works but unproven adoption assumption, revisit later.
// Code intact, re-enable by uncommenting (see showVoiceMemo state, header
// button, and modal render below, and the matching import above:
// `VoiceMemoModal` from "./components/shared").
import { Dashboard } from "./components/Dashboard";
import { Donors } from "./components/Donors";
import { Grants } from "./components/Grants";
import { Communications } from "./components/Communications";
import { Reports } from "./components/Reports";
import { Volunteers } from "./components/Volunteers";
import { Board } from "./components/Board";
import { Finance } from "./components/Finance";
import { Tasks } from "./components/Tasks";
import { Settings } from "./components/Settings";
import { Events } from "./components/Events";
import PlanPicker from "./components/PlanPicker";

// ── Tabs ───────────────────────────────────────────────────────────────────
const TABS=[
  {id:"dashboard",label:"Home",icon:"◈"},
  {id:"donors",label:"Donors",icon:"♦"},
  {id:"grants",label:"Grants",icon:"◉"},
  {id:"communications",label:"Communications",icon:"◑"},
  {id:"reports",label:"Reports",icon:"▤"},
  {id:"settings",label:"Settings",icon:"⚙"},
  // DEPRIORITIZED — pivoting to donor dashboard focus, code kept intact, re-enable by uncommenting
  // {id:"finance",label:"Finance",icon:"◇"},
  // {id:"events",label:"Events",icon:"◎"},
  // {id:"tasks",label:"Tasks",icon:"◻"},
  // {id:"volunteers",label:"Volunteers",icon:"◎",earlyAccess:true},
  // {id:"board",label:"Board",icon:"◆",earlyAccess:true},
];
const BOTTOM_TABS=[
  {id:"dashboard",label:"Home",icon:"◉"},
  {id:"donors",label:"Donors",icon:"♦"},
  {id:"grants",label:"Grants",icon:"◉"},
  {id:"settings",label:"Settings",icon:"⚙"},
];
const MORE_TABS=[
  {id:"communications",label:"Communications",icon:"◑"},
  {id:"reports",label:"Reports",icon:"▤"},
  // DEPRIORITIZED — pivoting to donor dashboard focus, code kept intact, re-enable by uncommenting
  // {id:"events",label:"Events",icon:"◎"},
  // {id:"volunteers",label:"Volunteers",icon:"◎",earlyAccess:true},
  // {id:"board",label:"Board",icon:"◆",earlyAccess:true},
  // {id:"tasks",label:"Tasks",icon:"◻"},
];

// ── App Shell ──────────────────────────────────────────────────────────────
function AppShell() {
  const { auth, logout } = useAuth();
  const [tab,setTab]=useState("dashboard");
  const [data,setData]=useState(null);
  const [loading,setLoading]=useState(true);
  const [loadErr,setLoadErr]=useState("");
  const [stripeToast,setStripeToast]=useState(false);
  const [moreOpen,setMoreOpen]=useState(false);
  const [billing,setBilling]=useState(null);
  const [bannerDismissed,setBannerDismissed]=useState(false);
  const [exportingBanner,setExportingBanner]=useState(false);
  const [showPlanPicker,setShowPlanPicker]=useState(false);
  const [showInstallPrompt,setShowInstallPrompt]=useState(false);
  const [deferredPrompt,setDeferredPrompt]=useState(null);
  const [commsInitialNav,setCommsInitialNav]=useState(null);
  const [commsHighlightDraftId,setCommsHighlightDraftId]=useState(null);
  const [donorsIntent,setDonorsIntent]=useState(null);
  const [grantsIntent,setGrantsIntent]=useState(null);
  // SHELVED — voice capture works but unproven adoption assumption, revisit
  // later. Code intact, re-enable by uncommenting.
  // const [showVoiceMemo,setShowVoiceMemo]=useState(false);

  const navigateTo=(t,opts)=>{
    setCommsInitialNav(opts?.subtab||null);
    setCommsHighlightDraftId(opts?.highlightDraftId||null);
    setDonorsIntent(opts?.view||opts?.logDonorId||opts?.stageFilter||opts?.selectDonorId?{view:opts.view,logDonorId:opts.logDonorId,stageFilter:opts.stageFilter,selectDonorId:opts.selectDonorId}:null);
    setGrantsIntent(opts?.grantId?{grantId:opts.grantId}:null);
    setTab(t);
  };


  useEffect(()=>{
    const params=new URLSearchParams(window.location.search);
    if(params.get("stripe_connected")==="true"){
      setStripeToast(true);
      window.history.replaceState({},"","/dashboard");
      setTimeout(()=>setStripeToast(false),6000);
    }
  },[]);

  useEffect(()=>{
    if(window.matchMedia('(display-mode: standalone)').matches)return;
    if(localStorage.getItem('installDismissed'))return;
    const handler=e=>{
      e.preventDefault();
      setDeferredPrompt(e);
      setTimeout(()=>setShowInstallPrompt(true),30000);
    };
    window.addEventListener('beforeinstallprompt',handler);
    return()=>window.removeEventListener('beforeinstallprompt',handler);
  },[]);

  async function loadData() {
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
      const adapted=adaptData({org,donors,grants,volunteers,tasks,board,financials});
      setData(adapted);
      if(org?.id) localStorage.setItem("steward_onboarded_"+org.id,"1");
    } catch(e) { setLoadErr(e.message); }
    setLoading(false);
  }

  useEffect(()=>{
    loadData();
    apiFetch("/billing/status").then(setBilling).catch(()=>{});
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

  const accessState=billing?.accessState||"full";
  const isReadOnly=accessState==="read_only";
  const subStatus=billing?.subscriptionStatus;
  const showTrialBanner=!bannerDismissed&&subStatus==="trialing"&&billing?.trialDaysLeft<=14;
  const showWarningBanner=accessState==="warning";
  const showReadOnlyBanner=isReadOnly;

  async function openPortal(){
    try{
      const r=await apiFetch("/billing/create-portal",{method:"POST"});
      window.location.href=r.url;
    }catch(e){ alert(e.message); }
  }

  // Same blob-download pattern as Settings.jsx's exportData — lets a
  // read_only org actually get their data out from the banner itself,
  // instead of just switching to Settings and leaving them to find it.
  // Admins get the full CSV zip (what a departing org actually wants to
  // open); the CSV route is admin-gated, so staff fall back to JSON.
  async function exportDataFromBanner(){
    const isAdmin=auth?.user?.role==="admin";
    setExportingBanner(true);
    try{
      const path=isAdmin?"/org/export/csv":"/org/export";
      const r=await fetch(`${API}${path}`,{headers:{Authorization:`Bearer ${getToken()}`}});
      if(!r.ok){const e=await r.json().catch(()=>({}));throw new Error(e.error||"Export failed");}
      const blob=await r.blob();
      const url=URL.createObjectURL(blob);
      const a=document.createElement("a");
      a.href=url; a.download=isAdmin?`steward-export-${new Date().toISOString().split("T")[0]}.zip`:"steward-export.json";
      document.body.appendChild(a); a.click();
      document.body.removeChild(a); URL.revokeObjectURL(url);
    }catch(e){ alert(e.message||"Export failed"); }
    setExportingBanner(false);
  }

  return <div className="app-root" style={{...BASE,color:T.ink,display:"flex",flexDirection:"column"}}>
    <GlobalStyles/>
    <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=DM+Serif+Display&display=swap" rel="stylesheet"/>

    {/* Header */}
    <div className="app-header" style={{borderBottom:"1px solid #1a2e1f",padding:"0 24px",display:"flex",alignItems:"center",justifyContent:"space-between",background:"#0f1a12",position:"sticky",top:0,zIndex:100,height:52,width:"100%",boxSizing:"border-box"}}>
      <div style={{display:"flex",alignItems:"center",gap:12}}>
        <span style={{fontSize:20,fontWeight:400,color:"#f0ede6",fontFamily:"'DM Serif Display',Georgia,serif",letterSpacing:"-0.02em"}}>Steward</span>
      </div>
      <div style={{display:"flex",gap:8,alignItems:"center"}}>
        {/* SHELVED — voice capture works but unproven adoption assumption, revisit later.
            Code intact, re-enable by uncommenting.
        <button onClick={()=>setShowVoiceMemo(true)} title="Record a voice memo" style={{background:"#1a2e1f",border:"1px solid #2d4a35",borderRadius:10,padding:"7px 12px",color:"#c9a84c",fontSize:12,fontWeight:700,cursor:"pointer",display:"flex",alignItems:"center",gap:6}}>
          🎙 Voice memo
        </button>
        */}
        <div className="app-avatar" style={{width:30,height:30,borderRadius:8,background:T.greenDk,display:"flex",alignItems:"center",justifyContent:"center"}}>
          <span style={{fontSize:12,fontWeight:700,color:"#f0ede6"}}>{(auth?.user?.name||"U")[0].toUpperCase()}</span>
        </div>
        <button onClick={logout} className="app-signout" style={{background:"transparent",border:"1px solid #2d4a35",borderRadius:8,padding:"6px 12px",color:"#8fa896",fontSize:12,cursor:"pointer"}}>
          Sign out
        </button>
      </div>
    </div>

    {/* Tab bar */}
    <div className="app-tabbar" style={{display:"flex",padding:"0 20px",borderBottom:"1px solid #1a2e1f",overflow:"hidden",flexShrink:0,background:"#0f1a12",width:"100%",boxSizing:"border-box"}}>
      {TABS.filter(t=>t.id!=="settings").map(t=>{
        const active=tab===t.id;
        return <button key={t.id} onClick={()=>setTab(t.id)} style={{background:"transparent",border:"none",borderBottom:`2px solid ${active?"#c9a84c":"transparent"}`,padding:"8px 12px",color:active?"#f0ede6":"#8fa896",fontSize:13,fontWeight:active?700:400,cursor:"pointer",display:"flex",alignItems:"center",gap:6,whiteSpace:"nowrap",transition:"color 0.15s,border-color 0.15s",flexShrink:1,marginBottom:-1}}>
          {t.label}
          {t.earlyAccess&&<span style={{fontSize:9,fontWeight:700,letterSpacing:"0.04em",background:"#1a2e1f",color:"#8fa896",border:"1px solid #2d4a35",borderRadius:99,padding:"1px 6px",lineHeight:"14px"}}>Early Access</span>}
          {t.id==="tasks"&&tasksDue>0&&<span style={{background:"#ef4444",color:"#fff",fontSize:9,fontWeight:800,borderRadius:99,padding:"1px 5px",lineHeight:"14px"}}>{tasksDue}</span>}
        </button>;
      })}
      <div style={{flex:1,minWidth:8}}/>
      <div style={{width:1,background:"#2d4a35",margin:"8px 4px",flexShrink:0}}/>
      <button onClick={()=>setTab("settings")} style={{background:"transparent",border:"none",borderBottom:`2px solid ${tab==="settings"?"#c9a84c":"transparent"}`,padding:"8px 10px",color:tab==="settings"?"#f0ede6":"#6b8f7a",fontSize:12,fontWeight:tab==="settings"?600:400,cursor:"pointer",display:"flex",alignItems:"center",gap:5,whiteSpace:"nowrap",transition:"color 0.15s,border-color 0.15s",flexShrink:0,marginBottom:-1}}>
        <span style={{fontSize:13}}>⚙</span>Settings
      </button>
    </div>

    {showReadOnlyBanner&&<div style={{background:"#7f1d1d",borderBottom:"1px solid #991b1b",padding:"9px 24px",display:"flex",alignItems:"center",gap:12,fontSize:13,color:"#fca5a5",flexWrap:"wrap"}}>
      <span>🔒</span>
      <span style={{flex:1,minWidth:200}}><strong style={{color:"#fef2f2"}}>Your account is read-only.</strong> {subStatus==="trial_expired"?"Your free trial has ended.":"Your subscription has ended."} Export your data or reactivate to continue.</span>
      <button onClick={exportDataFromBanner} disabled={exportingBanner} style={{background:"none",border:"1px solid #fca5a5",borderRadius:8,color:"#fca5a5",fontSize:12,fontWeight:700,cursor:exportingBanner?"not-allowed":"pointer",padding:"4px 12px",whiteSpace:"nowrap",opacity:exportingBanner?0.7:1}}>{exportingBanner?"Exporting…":"Export data →"}</button>
      <button onClick={()=>setShowPlanPicker(true)} style={{background:"#fef2f2",border:"none",borderRadius:8,color:"#7f1d1d",fontSize:12,fontWeight:700,cursor:"pointer",padding:"4px 12px",whiteSpace:"nowrap"}}>Reactivate →</button>
    </div>}
    {!showReadOnlyBanner&&showWarningBanner&&subStatus==="past_due"&&<div style={{background:"#451a03",borderBottom:"1px solid #92400e",padding:"9px 24px",display:"flex",alignItems:"center",gap:12,fontSize:13,color:"#fbbf24",flexWrap:"wrap"}}>
      <span>⚠️</span>
      <span style={{flex:1,minWidth:200}}><strong style={{color:"#fef3c7"}}>Your last payment didn't go through.</strong> Update your payment method to keep Steward active.</span>
      <button onClick={openPortal} style={{background:"#f59e0b",border:"none",borderRadius:8,color:"#fff",fontSize:12,fontWeight:700,cursor:"pointer",padding:"4px 12px",whiteSpace:"nowrap"}}>Update payment →</button>
    </div>}
    {!showReadOnlyBanner&&showWarningBanner&&(subStatus==="canceled"||subStatus==="cancelled")&&<div style={{background:"#451a03",borderBottom:"1px solid #92400e",padding:"9px 24px",display:"flex",alignItems:"center",gap:12,fontSize:13,color:"#fbbf24",flexWrap:"wrap"}}>
      <span>⚠️</span>
      <span style={{flex:1,minWidth:200}}><strong style={{color:"#fef3c7"}}>Your subscription is canceled.</strong> You have until {billing?.graceUntil?new Date(billing.graceUntil).toLocaleDateString("en-US",{month:"short",day:"numeric"}):"soon"} to export your data or reactivate.</span>
      <button onClick={exportDataFromBanner} disabled={exportingBanner} style={{background:"none",border:"1px solid #fbbf24",borderRadius:8,color:"#fbbf24",fontSize:12,fontWeight:700,cursor:exportingBanner?"not-allowed":"pointer",padding:"4px 12px",whiteSpace:"nowrap",opacity:exportingBanner?0.7:1}}>{exportingBanner?"Exporting…":"Export data"}</button>
      <button onClick={()=>setShowPlanPicker(true)} style={{background:"#f59e0b",border:"none",borderRadius:8,color:"#fff",fontSize:12,fontWeight:700,cursor:"pointer",padding:"4px 12px",whiteSpace:"nowrap"}}>Reactivate →</button>
    </div>}
    {showTrialBanner&&<div style={{background:billing.trialDaysLeft<=3?"#451a03":"#1a2e1f",borderBottom:`1px solid ${billing.trialDaysLeft<=3?"#92400e":"#0d5c3a"}`,padding:"9px 24px",display:"flex",alignItems:"center",gap:12,fontSize:13,color:billing.trialDaysLeft<=3?"#fbbf24":"#8fa896"}}>
      <span>⏳</span>
      <span><strong style={{color:"#f0ede6"}}>{billing.trialDaysLeft} days</strong> left in your trial —</span>
      <button onClick={openPortal} style={{background:"none",border:"none",color:billing.trialDaysLeft<=3?"#f59e0b":"#c9a84c",fontSize:13,fontWeight:700,cursor:"pointer",padding:0,textDecoration:"underline"}}>{billing.trialDaysLeft<=3?"Choose a plan →":"Upgrade now →"}</button>
      <button onClick={()=>setBannerDismissed(true)} style={{marginLeft:"auto",background:"transparent",border:"none",color:"#3d5245",cursor:"pointer",fontSize:16,padding:"0 4px",lineHeight:1}}>✕</button>
    </div>}

    <div className="app-content" style={{flex:1,padding:"20px 24px 28px 24px",maxWidth:1400,width:"100%",margin:"0 auto",boxSizing:"border-box"}}>
      {tab==="dashboard"&&<Dashboard data={data} setData={setData} onNavigate={navigateTo} isReadOnly={isReadOnly}/>}
      {tab==="donors"&&<Donors data={data} setData={setData} isReadOnly={isReadOnly} initialView={donorsIntent?.view} initialLogDonorId={donorsIntent?.logDonorId} initialStageFilter={donorsIntent?.stageFilter} initialSelectDonorId={donorsIntent?.selectDonorId} onIntentConsumed={()=>setDonorsIntent(null)}/>}
      {tab==="grants"&&<Grants data={data} setData={setData} isReadOnly={isReadOnly} initialGrantId={grantsIntent?.grantId} onIntentConsumed={()=>setGrantsIntent(null)}/>}
      {tab==="communications"&&<Communications data={data} isReadOnly={isReadOnly} initialNav={commsInitialNav} highlightDraftId={commsHighlightDraftId} onInitialNavConsumed={()=>{setCommsInitialNav(null);setCommsHighlightDraftId(null);}}/>}
      {tab==="reports"&&<Reports onNavigate={navigateTo}/>}
      {tab==="events"&&<Events data={data} isReadOnly={isReadOnly}/>}
      {tab==="volunteers"&&<Volunteers data={data} setData={setData} isReadOnly={isReadOnly}/>}
      {tab==="board"&&<Board data={data} setData={setData} isReadOnly={isReadOnly}/>}
      {tab==="finance"&&<Finance data={data}/>}
      {tab==="tasks"&&<Tasks data={data} setData={setData} isReadOnly={isReadOnly}/>}
      {tab==="settings"&&<Settings auth={auth} logout={logout}/>}
    </div>
    <PlanPicker open={showPlanPicker} onClose={()=>setShowPlanPicker(false)}/>
    {/* SHELVED — voice capture works but unproven adoption assumption, revisit later.
        Code intact, re-enable by uncommenting.
    {showVoiceMemo&&<VoiceMemoModal donors={data.donors} onClose={()=>setShowVoiceMemo(false)} onSaved={()=>loadData()}/>}
    */}
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
              {t.earlyAccess&&<span style={{fontSize:9,fontWeight:700,letterSpacing:"0.04em",background:"#1a2e1f",color:"#8fa896",border:"1px solid #2d4a35",borderRadius:99,padding:"2px 7px"}}>Early Access</span>}
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

    {/* Install prompt — mobile browsers only */}
    {showInstallPrompt&&deferredPrompt&&<div style={{position:"fixed",bottom:"calc(60px + env(safe-area-inset-bottom,0px))",left:0,right:0,zIndex:145,background:"#0f1a12",borderTop:"1px solid #1a2e1f",padding:"10px 16px",display:"flex",alignItems:"center",gap:12,boxShadow:"0 -4px 20px rgba(0,0,0,0.3)"}}>
      <span style={{fontSize:18,lineHeight:1,flexShrink:0}}>📱</span>
      <span style={{flex:1,fontSize:13,color:"#f0ede6",fontWeight:500}}>Add Steward to your home screen</span>
      <button onClick={async()=>{deferredPrompt.prompt();setShowInstallPrompt(false);}} style={{background:"#10b981",border:"none",borderRadius:8,padding:"6px 14px",color:"#fff",fontSize:12,fontWeight:700,cursor:"pointer",flexShrink:0}}>Add</button>
      <button onClick={()=>{setShowInstallPrompt(false);localStorage.setItem('installDismissed','true');}} style={{background:"transparent",border:"none",color:"#8fa896",fontSize:18,cursor:"pointer",padding:"0 4px",lineHeight:1,flexShrink:0}}>×</button>
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
  return <AppShell />;
}
