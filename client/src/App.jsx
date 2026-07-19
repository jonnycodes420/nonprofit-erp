import { useState, useEffect } from "react";
import { apiFetch, adaptData, API, getToken } from "./api";
import { useAuth } from "./main";
import { T, GlobalStyles, LockGlyph, ErrorBoundary } from "./components/shared";
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
import { Fundraising } from "./components/Fundraising";
import { Tasks } from "./components/Tasks";
import { Workflows } from "./components/Workflows";
import { Pipeline } from "./components/Pipeline";
import { Settings } from "./components/Settings";
import { Events } from "./components/Events";
import PlanPicker from "./components/PlanPicker";
import { TopBar } from "./components/TopBar";

// ── Tabs ───────────────────────────────────────────────────────────────────
const TABS=[
  {id:"dashboard",label:"Home",icon:"◈"},
  {id:"donors",label:"Donors",icon:"♦"},
  {id:"pipeline",label:"Pipeline",icon:"◫"},
  {id:"fundraising",label:"Fundraising",icon:"↗"},
  {id:"grants",label:"Grants",icon:"◉"},
  {id:"communications",label:"Communications",icon:"◑"},
  {id:"tasks",label:"Tasks",icon:"◻"},
  {id:"workflows",label:"Workflows",icon:"◧"},
  {id:"reports",label:"Reports",icon:"▤"},
  {id:"finance",label:"Finance",icon:"◇"},
  {id:"settings",label:"Settings",icon:"⚙"},
  // DEPRIORITIZED — pivoting to donor dashboard focus, code kept intact, re-enable by uncommenting
  // {id:"events",label:"Events",icon:"◎"},
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
  {id:"pipeline",label:"Pipeline",icon:"◫"},
  {id:"fundraising",label:"Fundraising",icon:"↗"},
  {id:"communications",label:"Communications",icon:"◑"},
  {id:"tasks",label:"Tasks",icon:"◻"},
  {id:"workflows",label:"Workflows",icon:"◧"},
  {id:"reports",label:"Reports",icon:"▤"},
  {id:"finance",label:"Finance",icon:"◇"},
  // DEPRIORITIZED — pivoting to donor dashboard focus, code kept intact, re-enable by uncommenting
  // {id:"events",label:"Events",icon:"◎"},
  // {id:"volunteers",label:"Volunteers",icon:"◎",earlyAccess:true},
  // {id:"board",label:"Board",icon:"◆",earlyAccess:true},
];

// Desktop sidebar grouping (BUILD-20 Part 3) — Home stays ungrouped at top,
// Settings pinned at bottom; the rest read as labeled sections. Pipeline stays
// a TOP-LEVEL item within People (NOT nested under Donors). Team-gated items
// (see TEAM_GATED) show a lock indicator for Core users but stay visible.
const NAV_GROUPS=[
  {label:"People",      ids:["donors","pipeline","tasks"]},
  {label:"Fundraising", ids:["fundraising","grants","communications","workflows"]},
  {label:"Insight",     ids:["reports","finance"]},
];
const TEAM_GATED=new Set(["pipeline"]);

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
  const [settingsIntent,setSettingsIntent]=useState(null);
  // SHELVED — voice capture works but unproven adoption assumption, revisit
  // later. Code intact, re-enable by uncommenting.
  // const [showVoiceMemo,setShowVoiceMemo]=useState(false);

  // Intent-carrying components (Donors/Grants/Communications/Settings)
  // consume their initial* props on mount only, so navigating WITH an intent
  // bumps navNonce — used as their React key — to force a remount even when
  // the target tab is already active (e.g. top-bar search for a grant while
  // on the Grants tab). Plain nav (no opts) never remounts.
  const [navNonce,setNavNonce]=useState(0);
  const navigateTo=(t,opts)=>{
    setCommsInitialNav(opts?.subtab||null);
    setCommsHighlightDraftId(opts?.highlightDraftId||null);
    setDonorsIntent(opts?.view||opts?.logDonorId||opts?.stageFilter||opts?.selectDonorId?{view:opts.view,logDonorId:opts.logDonorId,stageFilter:opts.stageFilter,selectDonorId:opts.selectDonorId}:null);
    setGrantsIntent(opts?.grantId?{grantId:opts.grantId}:null);
    setSettingsIntent(opts?.section?{section:opts.section}:null);
    if(opts&&Object.keys(opts).some(k=>opts[k]!=null))setNavNonce(n=>n+1);
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
        // Lightweight whole-org list (no notes/score_rationale) — the full
        // GET /donors payload was the last known scaling cliff (21.7MB at
        // 25k donors). Anything needing the heavy fields (DonorProfile)
        // fetches GET /donors/:id on demand.
        apiFetch("/donors/summaries"),
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

  // Badge = tasks needing attention now: open + overdue-or-due-today.
  const _todayISO=new Date().toISOString().slice(0,10);
  const tasksDue=data.tasks.filter(t=>!t.done&&t.due&&Math.floor((new Date(t.due)-new Date(_todayISO))/86400000)<=0).length;
  const orgName=auth?.org?.name||data.org?.name||"Steward";

  const accessState=billing?.accessState||"full";
  const isReadOnly=accessState==="read_only";
  const subStatus=billing?.subscriptionStatus;
  // Client-side plan tier (mirrors server orgPlanTier): Team = growth/impact OR
  // a live trial; everything else (seed/lapsed) = Core. Drives the sidebar lock
  // indicator on Team-gated items. Defaults to team while billing is unknown so
  // we never flash a lock before the plan loads.
  const planTier=(()=>{ if(!billing)return "team"; const p=billing.plan; if(p==="growth"||p==="impact")return "team"; if(subStatus==="trialing")return "team"; return "core"; })();
  const isCoreTier=planTier==="core";
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

  // Sidebar nav button — one style for the main items and the pinned
  // Settings item. Active = gold left accent + elevated dark green, matching
  // the goal-card/dark-surface language (five-color palette only).
  const sideBtn=(active)=>({
    display:"flex",alignItems:"center",gap:10,width:"100%",textAlign:"left",
    background:active?"#1a2e1f":"transparent",
    border:"none",borderLeft:`3px solid ${active?"var(--org-accent,#c9a84c)":"transparent"}`,
    borderRadius:"0 10px 10px 0",padding:"10px 12px 10px 13px",
    color:active?"#f0ede6":"#8fa896",fontSize:13,fontWeight:active?700:500,
    cursor:"pointer",transition:"color 0.15s,background 0.15s",boxSizing:"border-box"
  });

  // Home paints its content on T.bgDeep via Dashboard's "dash-bleed"
  // negative margins — with a centered max-width column that bleed stops at
  // the column edge, leaving lighter T.bg gutters (the background seam
  // BUILD-06 Phase E fixes). Matching the shell background to the tab makes
  // the page one continuous surface at any viewport width.
  // BUILD-13: the org's brand accent (already normalized to an accessible
  // range server-side) is exposed as a CSS var layered OVER the BUILD-12
  // palette — applied only on accent moments (sidebar active bar/icon, the
  // Dashboard greeting). Falls back to Steward gold when unset, so an org
  // that never sets branding is visually identical to before.
  const orgAccent=data.org?.brandAccent||"#c9a84c";
  const orgAccentFg=data.org?.brandAccentFg||"#0f1a12";
  return <div className="app-root" style={{...BASE,background:tab==="dashboard"?T.bgDeep:T.bg,color:T.ink,display:"flex",flexDirection:"column","--org-accent":orgAccent,"--org-accent-fg":orgAccentFg}}>
    <GlobalStyles/>
    <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=DM+Serif+Display&display=swap" rel="stylesheet"/>

    {/* Global top bar — full-width, fixed, spans the whole viewport ABOVE the
        sidebar (BUILD-10). Carries the wordmark, search, help menu, user chip
        + sign-out. Desktop only (GlobalStyles hides it ≤768px; mobile keeps
        the .app-header inside app-main below). zIndex sits above the z-200
        full-screen takeovers so the bar stays visible over them. */}
    <TopBar auth={auth} logout={logout} onNavigate={navigateTo}/>

    {/* Sidebar — desktop only (hidden ≤768px; mobile keeps bottom bar + More
        drawer). Starts BENEATH the 52px bar (top:52); pure nav now — wordmark
        moved into the bar's left edge, user chip/sign-out live in the bar. */}
    <div className="app-sidebar" style={{position:"fixed",left:0,top:52,bottom:0,width:220,background:"#0f1a12",borderRight:"1px solid #1a2e1f",display:"flex",flexDirection:"column",zIndex:120,boxSizing:"border-box"}}>
      <div style={{flex:1,overflowY:"auto",padding:"12px 10px 14px 0",display:"flex",flexDirection:"column",gap:2}}>
        {(()=>{
          const byId=Object.fromEntries(TABS.map(t=>[t.id,t]));
          const navItem=(t)=>{
            const active=tab===t.id;
            const locked=TEAM_GATED.has(t.id)&&isCoreTier;
            return <button key={t.id} className="side-nav-btn" onClick={()=>navigateTo(t.id)} style={sideBtn(active)}>
              <span style={{fontSize:14,width:18,textAlign:"center",color:active?"var(--org-accent,#c9a84c)":"#6b8f7a",flexShrink:0}}>{t.icon}</span>
              {t.label}
              {locked&&<span title="Team plan" style={{marginLeft:"auto",display:"flex",alignItems:"center",color:"#6b8f7a"}}><LockGlyph size={11} color="#6b8f7a"/></span>}
              {t.earlyAccess&&<span style={{fontSize:9,fontWeight:700,letterSpacing:"0.04em",background:"#1a2e1f",color:"#8fa896",border:"1px solid #2d4a35",borderRadius:99,padding:"1px 6px",lineHeight:"14px"}}>Early Access</span>}
              {t.id==="tasks"&&tasksDue>0&&<span style={{marginLeft:locked?6:"auto",background:"#b8593f",color:"#fff",fontSize:9,fontWeight:800,borderRadius:99,padding:"1px 6px",lineHeight:"14px"}}>{tasksDue}</span>}
            </button>;
          };
          const home=byId["dashboard"];
          return <>
            {home&&navItem(home)}
            {NAV_GROUPS.map(g=>(
              <div key={g.label} style={{marginTop:12}}>
                <div style={{fontSize:9.5,fontWeight:800,letterSpacing:"0.11em",textTransform:"uppercase",color:"#5a7566",padding:"0 12px 4px 13px"}}>{g.label}</div>
                {g.ids.map(id=>byId[id]).filter(Boolean).map(navItem)}
              </div>
            ))}
          </>;
        })()}
      </div>
      {/* Pure nav below here — the user chip/sign-out moved to the top bar (BUILD-08) */}
      <div style={{borderTop:"1px solid #1a2e1f",padding:"10px 10px 12px 0",flexShrink:0}}>
        <button className="side-nav-btn" onClick={()=>navigateTo("settings")} style={sideBtn(tab==="settings")}>
          <span style={{fontSize:14,width:18,textAlign:"center",color:tab==="settings"?"var(--org-accent,#c9a84c)":"#6b8f7a",flexShrink:0}}>⚙</span>
          Settings
        </button>
      </div>
    </div>

    {/* Main column — right of the sidebar (marginLeft) and below the fixed bar
        (marginTop) on desktop; both offsets reset to 0 ≤768px in GlobalStyles. */}
    <div className="app-main" style={{marginLeft:220,marginTop:52,display:"flex",flexDirection:"column",flex:1,minWidth:0}}>

    {/* Header — mobile only (display:none here; GlobalStyles' 768px block restores it) */}
    <div className="app-header" style={{borderBottom:"1px solid #1a2e1f",padding:"0 24px",display:"none",alignItems:"center",justifyContent:"space-between",background:"#0f1a12",position:"sticky",top:0,zIndex:100,height:52,width:"100%",boxSizing:"border-box"}}>
      <div style={{display:"flex",alignItems:"center",gap:12}}>
        <span style={{fontSize:20,fontWeight:400,color:"#f0ede6",fontFamily:"'DM Serif Display',Georgia,serif",letterSpacing:"-0.02em"}}>Steward</span>
      </div>
      <div style={{display:"flex",gap:8,alignItems:"center"}}>
        {/* SHELVED — voice capture works but unproven adoption assumption, revisit later.
            Code intact, re-enable by uncommenting.
        <button onClick={()=>setShowVoiceMemo(true)} title="Record a voice memo" style={{background:"#1a2e1f",border:"1px solid #2d4a35",borderRadius:10,padding:"7px 12px",color:"#c9a84c",fontSize:12,fontWeight:700,cursor:"pointer",display:"flex",alignItems:"center",gap:6}}>
          Voice memo
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

    {showReadOnlyBanner&&<div style={{background:"#7f1d1d",borderBottom:"1px solid #991b1b",padding:"9px 24px",display:"flex",alignItems:"center",gap:12,fontSize:13,color:"#fca5a5",flexWrap:"wrap"}}>
      <span style={{flex:1,minWidth:200}}><strong style={{color:"#fef2f2"}}>Your account is read-only.</strong> {subStatus==="trial_expired"?"Your free trial has ended.":"Your subscription has ended."} Export your data or reactivate to continue.</span>
      <button onClick={exportDataFromBanner} disabled={exportingBanner} style={{background:"none",border:"1px solid #fca5a5",borderRadius:8,color:"#fca5a5",fontSize:12,fontWeight:700,cursor:exportingBanner?"not-allowed":"pointer",padding:"4px 12px",whiteSpace:"nowrap",opacity:exportingBanner?0.7:1}}>{exportingBanner?"Exporting…":"Export data →"}</button>
      <button onClick={()=>setShowPlanPicker(true)} style={{background:"#fef2f2",border:"none",borderRadius:8,color:"#7f1d1d",fontSize:12,fontWeight:700,cursor:"pointer",padding:"4px 12px",whiteSpace:"nowrap"}}>Reactivate →</button>
    </div>}
    {!showReadOnlyBanner&&showWarningBanner&&subStatus==="past_due"&&<div style={{background:"#451a03",borderBottom:"1px solid #92400e",padding:"9px 24px",display:"flex",alignItems:"center",gap:12,fontSize:13,color:"#fbbf24",flexWrap:"wrap"}}>
      <span style={{flex:1,minWidth:200}}><strong style={{color:"#fef3c7"}}>Your last payment didn't go through.</strong> Update your payment method to keep Steward active.</span>
      <button onClick={openPortal} style={{background:"#f59e0b",border:"none",borderRadius:8,color:"#fff",fontSize:12,fontWeight:700,cursor:"pointer",padding:"4px 12px",whiteSpace:"nowrap"}}>Update payment →</button>
    </div>}
    {!showReadOnlyBanner&&showWarningBanner&&(subStatus==="canceled"||subStatus==="cancelled")&&<div style={{background:"#451a03",borderBottom:"1px solid #92400e",padding:"9px 24px",display:"flex",alignItems:"center",gap:12,fontSize:13,color:"#fbbf24",flexWrap:"wrap"}}>
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

    {/* Per-tab width strategy (BUILD-06 Phase E): Home stays a readable
        centered column (~1200px) — it's a reading page. Workspace tabs
        (Donors, Grants, Communications, Reports, Settings + the hidden
        legacy tabs) go fluid full-width with 32px side padding so 1920px+
        displays get working room instead of dead gutters. Mobile is
        untouched — GlobalStyles' 768px rules override this with !important. */}
    <div className="app-content" style={{flex:1,padding:tab==="dashboard"?"20px 24px 28px 24px":"20px 32px 28px 32px",maxWidth:tab==="dashboard"?1200:"none",width:"100%",margin:"0 auto",boxSizing:"border-box"}}>
      {/* Per-surface crash insurance (BUILD-21 Part 2): a render error in one tab
          shows a graceful fallback in the content area — the sidebar/top bar stay
          usable and switching tabs (resetKey=tab) recovers — instead of a black
          screen. The shell itself is wrapped app-level in the App export below. */}
    <ErrorBoundary label={tab} resetKey={tab} onHome={()=>setTab("dashboard")}>
      {tab==="dashboard"&&<Dashboard data={data} setData={setData} onNavigate={navigateTo} isReadOnly={isReadOnly}/>}
      {tab==="donors"&&<Donors key={navNonce} data={data} setData={setData} isReadOnly={isReadOnly} onNavigate={navigateTo} initialView={donorsIntent?.view} initialLogDonorId={donorsIntent?.logDonorId} initialStageFilter={donorsIntent?.stageFilter} initialSelectDonorId={donorsIntent?.selectDonorId} onIntentConsumed={()=>setDonorsIntent(null)}/>}
      {tab==="grants"&&<Grants key={navNonce} data={data} setData={setData} isReadOnly={isReadOnly} initialGrantId={grantsIntent?.grantId} onIntentConsumed={()=>setGrantsIntent(null)}/>}
      {tab==="communications"&&<Communications key={navNonce} data={data} isReadOnly={isReadOnly} initialNav={commsInitialNav} highlightDraftId={commsHighlightDraftId} onInitialNavConsumed={()=>{setCommsInitialNav(null);setCommsHighlightDraftId(null);}} onNavigate={navigateTo}/>}
      {tab==="reports"&&<Reports onNavigate={navigateTo}/>}
      {tab==="pipeline"&&<Pipeline key={navNonce} isReadOnly={isReadOnly} onNavigate={navigateTo}/>}
      {tab==="fundraising"&&<Fundraising data={data} isReadOnly={isReadOnly} onNavigate={navigateTo}/>}
      {tab==="events"&&<Events data={data} isReadOnly={isReadOnly}/>}
      {tab==="volunteers"&&<Volunteers data={data} setData={setData} isReadOnly={isReadOnly}/>}
      {tab==="board"&&<Board data={data} setData={setData} isReadOnly={isReadOnly}/>}
      {tab==="finance"&&<Finance data={data} isReadOnly={isReadOnly} onNavigate={navigateTo}/>}
      {tab==="tasks"&&<Tasks data={data} setData={setData} isReadOnly={isReadOnly} onNavigate={navigateTo}/>}
      {tab==="workflows"&&<Workflows isReadOnly={isReadOnly} onNavigate={navigateTo}/>}
      {tab==="settings"&&<Settings key={navNonce} auth={auth} logout={logout} initialSection={settingsIntent?.section}/>}
    </ErrorBoundary>
    </div>
    </div>{/* /app-main */}
    <PlanPicker open={showPlanPicker} onClose={()=>setShowPlanPicker(false)}/>
    {/* SHELVED — voice capture works but unproven adoption assumption, revisit later.
        Code intact, re-enable by uncommenting.
    {showVoiceMemo&&<VoiceMemoModal donors={data.donors} onClose={()=>setShowVoiceMemo(false)} onSaved={()=>loadData()}/>}
    */}
    {stripeToast&&<div style={{position:"fixed",bottom:24,right:24,zIndex:9999,background:T.greenDk,color:"#fff",borderRadius:14,padding:"14px 20px",fontSize:13,fontWeight:600,boxShadow:"0 8px 32px rgba(26,107,74,0.35)",display:"flex",alignItems:"center",gap:10,maxWidth:340}}>
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
  // App-level crash insurance (BUILD-21 Part 2): catches a throw anywhere in the
  // shell (TopBar, sidebar, data adapt) that a per-tab boundary wouldn't cover,
  // so nothing can black-screen the whole authenticated app.
  return <ErrorBoundary label="the app"><AppShell /></ErrorBoundary>;
}
