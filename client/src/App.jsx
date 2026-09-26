import { useState, useEffect } from "react";
import { apiFetch, adaptData, API, getToken, billingErrorMessage } from "./api";
import { useAuth } from "./main";
import { T, GlobalStyles, LockGlyph, ErrorBoundary, goToPricing, PhotoContext, FirstRunWelcome } from "./components/shared";
// SHELVED — voice capture works but unproven adoption assumption, revisit later.
// Code intact, re-enable by uncommenting (see showVoiceMemo state, header
// button, and modal render below, and the matching import above:
// `VoiceMemoModal` from "./components/shared").
import { Dashboard } from "./components/Dashboard";
import { Dashboards } from "./components/Dashboards";
import { Donors } from "./components/Donors";
import { Grants } from "./components/Grants";
import { Communications } from "./components/Communications";
import { Reports } from "./components/Reports";
import { VolunteersHub } from "./components/VolunteersHub";
import { Board } from "./components/Board";
import { Finance } from "./components/Finance";
import { Fundraising } from "./components/Fundraising";
import { Tasks } from "./components/Tasks";
import { Workflows } from "./components/Workflows";
import { Settings } from "./components/Settings";
import { DonorPortalHub } from "./components/DonorPortalHub";
import { confirmIfDirty } from "./lib/dirtyGuard";
import { Events } from "./components/Events";
import PlanPicker from "./components/PlanPicker";
import { TopBar } from "./components/TopBar";
import { errorMessage } from "./lib/domainError";
import { TABS, BOTTOM_TABS, MORE_TABS, PRIMARY_NAV, MORE_NAV, NAV_MORE_KEY, TEAM_GATED, CORE_HIDDEN_TABS, PORTAL_TIER_TABS, CRM_HIDDEN_TABS } from "./lib/tabRegistry";
// The tier rule, as a module-level function rather than a value computed
// halfway down the component: `navigateTo` is declared above it and needs it,
// and a `const` read from a closure that could run first is a TDZ crash
// waiting for the right click. (BUILD-88a A.3 introduced exactly that and the
// A.4 browser suite caught it on the next run.) Defaults to team while billing
// is unknown, so no lock ever flashes before the plan loads.
function planTierOf(billing){
  if(!billing)return "team";
  if(billing.planTier)return billing.planTier;
  const p=billing.plan;
  if(p==="team"||p==="growth"||p==="impact")return "team";
  if(billing.subscriptionStatus==="trialing")return "team";
  return "core";
}
// Written once: the same due-count badge now rides a nav item AND the "More"
// group that can be holding it. Two copies would be two hex literals, and the
// palette census ratchets DOWN.
const DUE_BADGE={background:"#b8593f",color:"#fff",fontSize:9,fontWeight:800,borderRadius:99,padding:"1px 6px",lineHeight:"14px"};

// ── App Shell ──────────────────────────────────────────────────────────────
function AppShell() {
  const { auth, logout } = useAuth();
  const [tab,setTab]=useState("dashboard");
  const [data,setData]=useState(null);
  const [loading,setLoading]=useState(true);
  const [loadErr,setLoadErr]=useState("");
  const [stripeToast,setStripeToast]=useState(false);
  const [subscribedToast,setSubscribedToast]=useState(false);
  const [moreOpen,setMoreOpen]=useState(false);
  // BUILD-87 F.3.5 — the "More" group remembers whether it is open, per
  // browser. It also opens ITSELF whenever the current tab lives inside it:
  // the nav must always be able to show you where you are standing.
  const [navMoreOpen,setNavMoreOpen]=useState(()=>{try{return localStorage.getItem(NAV_MORE_KEY)==="1";}catch{return false;}});
  useEffect(()=>{if(MORE_NAV.includes(tab))setNavMoreOpen(true);},[tab]);

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
  // BUILD-94 Part 1 — the org's { donorId: signedPhotoUrl } map, fetched once
  // per session. Every row surface in the product reads it through
  // PhotoContext, so a face appears beside a name without seven separate
  // payloads each having to remember to carry one. Only donors who HAVE a
  // photo are in it (an org with four faces ships four entries), and a failure
  // is silent by design: no photo map means initials, never a broken screen.
  const [photoMap,setPhotoMap]=useState({});
  const loadPhotos=()=>apiFetch("/people/photos")
    .then(r=>setPhotoMap((r&&r.photos)||{}))
    .catch(()=>setPhotoMap({}));
  useEffect(()=>{ if(getToken()) loadPhotos(); },[]);
  const photoCtx={photos:photoMap,refresh:loadPhotos};

  // BUILD-94 FIRST RUN — the greeting an organisation gets ONCE. The server
  // decides whether to show it (it holds `welcomed_at`); localStorage is only
  // a same-session guard so a re-render cannot greet twice before the stamp
  // lands. A failure here is silent: nobody's first day is blocked by a
  // greeting that could not load.
  // -- INCIDENT 2026-09-22 / BUILD-97 Part 0 -- DEMONSTRATION DATA SAYS SO,
  // ON EVERY SCREEN, IN THE PRODUCT ITSELF.
  //
  // On 22 September a production organisation dunned invented people at real
  // mailboxes for twelve days. Two gates were built that night and both work:
  // `donorMailDecision` refuses an `is_sample` donor, and `orgMaySendEmail`
  // refuses a whole org marked `is_demo_org`. Neither of them is VISIBLE. An
  // org full of fiction looked exactly like an org full of customers, which is
  // how 25,034 invented donors sat in production for twelve days without
  // anyone noticing what they were.
  //
  // A BANNER, NOT A HOME SECTION. A section can be hidden (BUILD-34 lets a
  // user hide any hideable section) and is only on one tab; "the numbers you
  // are reading are invented" has to be true on the screen you are reading
  // them on. It rides the same banner stack as the billing states, above
  // everything, on every tab.
  //
  // TWO STATES, BECAUSE THE TWO GATES ARE DIFFERENT GUARANTEES:
  //   - `isDemoOrg` -> the ORG-level gate. Nothing leaves at all.
  //   - sample rows in an org that is NOT flagged -> the DONOR-level gate.
  //     Those people get no mail; everyone else in the org still does.
  // Saying the first sentence when only the second is true would be a promise
  // the product cannot keep.
  const [sampleStatus,setSampleStatus]=useState(null);
  const loadSampleStatus=()=>apiFetch("/org/sample-data-status")
    .then(setSampleStatus).catch(()=>setSampleStatus(null));
  useEffect(()=>{ if(getToken()) loadSampleStatus(); },[]);
  const [clearingSample,setClearingSample]=useState(false);
  async function clearSampleFromBanner(){
    if(clearingSample)return;
    setClearingSample(true);
    try{
      await apiFetch("/org/clear-sample-data",{method:"POST"});
      setSampleStatus({hasSampleData:false,sampleDonorCount:0});
      // The donor lists on screen still hold the rows that were just deleted.
      // Reload rather than leave a screen describing people who no longer
      // exist -- the clear action is rare and a full reload is the honest
      // cheapest correct answer.
      window.location.reload();
    }catch(e){ setClearingSample(false); }
  }

  const [welcome,setWelcome]=useState(null);
  useEffect(()=>{
    if(!getToken())return;
    apiFetch("/org/welcome")
      .then(w=>{ if(w&&w.show) setWelcome(w); })
      .catch(()=>{});
  },[]);
  const dismissWelcome=()=>{
    setWelcome(null);
    apiFetch("/org/welcome/seen",{method:"POST",body:"{}"}).catch(()=>{});
  };
  // BUILD-30: the Home Tasks/Pipeline cards pass their scope so the destination
  // opens on the SAME scope — the count you clicked lands on exactly that view.
  const [tasksIntent,setTasksIntent]=useState(null);
  const [pipelineIntent,setPipelineIntent]=useState(null);
  // Attribution FIX — the Home hero chips deep-link into Reports (This FY →
  // Giving Summary current FY; This week → Giving Summary custom week range),
  // so Reports is now intent-carrying too (same remount-on-intent pattern).
  const [reportsIntent,setReportsIntent]=useState(null);
  // BUILD-57 — Home's Recurring tab deep-links to Fundraising → Recurring
  // Giving (opts key `frSection`, distinct from Settings' `section`).
  const [fundraisingIntent,setFundraisingIntent]=useState(null);
  // BUILD-58 W-2 — the portal-tier org's network-application status (pending/
  // approved/held/…) surfaces as a quiet banner instead of a dead end.
  const [networkApp,setNetworkApp]=useState(null);
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
    // BUILD-58 W-2 — a portal-tier org has no CRM surfaces; any deep link to
    // one lands on the portal hub instead of a locked/broken view.
    if(data?.org?.plan==="portal"&&!PORTAL_TIER_TABS.has(t))t="portal";
    // …and the mirror of it: a CRM org cannot navigate to a tab hidden from
    // the CRM, however it got asked to (a stale deep link, an older card).
    else if(data?.org?.plan!=="portal"&&CRM_HIDDEN_TABS.has(t))t="dashboard";
    // BUILD-88a A.3 — and the same mirror for a tab this PLAN does not have: a
    // deep link to Finance from a Core org lands on Home, never on a screen
    // whose nav entry it cannot see.
    if(planTierOf(billing)==="core"&&CORE_HIDDEN_TABS.has(t))t="dashboard";
    // FIX-1 §B — the Pipeline is no longer a tab: it folded into Fundraising →
    // Major gifts. Every navigateTo("pipeline") (Home's portfolio card, an older
    // link) lands on that part, carrying its scope.
    if(t==="pipeline"){t="fundraising";opts={...(opts||{}),frSection:"pipeline"};}
    if(t!==tab&&!confirmIfDirty())return;   // BUILD-54 §6 — unsaved-state guard
    setCommsInitialNav(opts?.subtab||null);
    setCommsHighlightDraftId(opts?.highlightDraftId||null);
    setDonorsIntent(opts?.view||opts?.logDonorId||opts?.stageFilter||opts?.selectDonorId||opts?.openImport||opts?.openConversation?{view:opts.view,logDonorId:opts.logDonorId,stageFilter:opts.stageFilter,selectDonorId:opts.selectDonorId,openImport:opts.openImport,openConversation:opts.openConversation}:null);
    setGrantsIntent(opts?.grantId||opts?.grantsSection?{grantId:opts.grantId,section:opts.grantsSection}:null);
    // FIX (2026-09-10) — `focus` names ONE card inside the section, so a deep
    // link that exists to fix a specific setting lands ON it instead of at the
    // top of a tab with the card three scrolls down. Refusing an action and
    // then making the user hunt for the fix is half a fix.
    setSettingsIntent(opts?.section?{section:opts.section,focus:opts.focus||null}:null);
    setTasksIntent(opts?.scope&&t==="tasks"?{scope:opts.scope}:null);
    setPipelineIntent(opts?.scope&&opts?.frSection==="pipeline"?{scope:opts.scope}:null);
    setReportsIntent((opts?.report||opts?.savedReport)&&t==="reports"?{report:opts.report,savedReport:opts.savedReport,preset:opts.preset,from:opts.from,to:opts.to,yearMode:opts.yearMode}:null);
    setFundraisingIntent(opts?.frSection&&t==="fundraising"?{section:opts.frSection}:null);
    if(opts&&Object.keys(opts).some(k=>opts[k]!=null))setNavNonce(n=>n+1);
    setTab(t);
  };


  useEffect(()=>{
    // D-1 (BUILD-45): a fresh load / cmd-click / open-in-new-tab on
    // /donors/:id lands here — open that donor's profile, then normalize the
    // URL back to /dashboard (the app doesn't otherwise sync tab↔URL).
    const donorMatch=window.location.pathname.match(/^\/donors\/([^/]+)\/?$/);
    if(donorMatch){
      // BUILD-81 — the nudge email's links land here with ?conversation=1:
      // a GET that changes nothing, opening the log-one-line flow after a
      // real page load (Done/Skip happen there, as POSTs).
      const wantsConversation=new URLSearchParams(window.location.search).get("conversation")==="1";
      navigateTo("donors",{selectDonorId:decodeURIComponent(donorMatch[1]),openConversation:wantsConversation});
      window.history.replaceState({},"","/dashboard");
    }
    const params=new URLSearchParams(window.location.search);
    // BUILD-98 (switch) Part 3 — the weekly report email's one link. A GET
    // that opens the report and changes nothing.
    if(params.get("report")){
      navigateTo("reports",{savedReport:params.get("report")});
      window.history.replaceState({},"","/dashboard");
    }
    // FIX-1 §B — /dashboard?fr=<id> opens Fundraising on that section or part.
    // Any old sub-tab id works, and `pipeline` goes through navigateTo("pipeline")
    // exactly as the old sidebar item did. A GET that changes nothing.
    if(params.get("fr")){
      if(params.get("fr")==="pipeline")navigateTo("pipeline");
      else navigateTo("fundraising",{frSection:params.get("fr")});
      window.history.replaceState({},"","/dashboard");
    }
    if(params.get("stripe_connected")==="true"){
      setStripeToast(true);
      window.history.replaceState({},"","/dashboard");
      setTimeout(()=>setStripeToast(false),6000);
    }
    // Returned from a successful platform-subscription checkout (BUILD-24 →
    // this FIX). The org's tier flips via the billing webhook, which may not
    // have landed yet — so we just acknowledge ("finishing up…") and refetch
    // /billing/status a couple times so the new plan (and unlocked panels)
    // appear once the webhook processes.
    if(params.get("subscribed")==="true"){
      setSubscribedToast(true);
      window.history.replaceState({},"","/dashboard");
      const refetch=()=>apiFetch("/billing/status").then(setBilling).catch(()=>{});
      refetch(); setTimeout(refetch,4000); setTimeout(refetch,10000);
      setTimeout(()=>setSubscribedToast(false),9000);
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
      // BUILD-58 W-2 — allSettled, not all-or-nothing: a Portal-plan org's
      // CRM routes answer 403 portal_tier BY DESIGN, and that must never
      // render as a "Failed to connect" outage on a new customer's first
      // login. /org failing is still fatal; for everything else a portal_tier
      // 403 (or any failure on a portal-tier org) falls back to empty data.
      const results = await Promise.allSettled([
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
      const [orgR,donorsR,grantsR,volunteersR,tasksR,boardR,financialsR]=results;
      if(orgR.status==="rejected")throw orgR.reason;
      const org=orgR.value;
      const portalTier=org?.plan==="portal";
      const val=(r,fallback)=>{
        if(r.status==="fulfilled")return r.value;
        if(portalTier||r.reason?.error==="portal_tier")return fallback;
        throw r.reason;
      };
      const adapted=adaptData({
        org,
        donors:val(donorsR,[]),
        grants:val(grantsR,[]),
        volunteers:val(volunteersR,[]),
        tasks:val(tasksR,[]),
        board:val(boardR,[]),
        financials:val(financialsR,{months:[],funds:[]}),
      });
      setData(adapted);
      if(portalTier){
        // Land on the tier's own surface (the Donor Portal hub), and surface
        // the network-application status while it's under review.
        setTab(t=>t==="dashboard"?"portal":t);
        apiFetch("/network/application").then(setNetworkApp).catch(()=>{});
      }
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
    {/* Splash mark = the OG badge: Emerald badge + Cream serif S (was the retired
        off-brand green #0d5c3a badge with a white S). Spinner accent = Emerald. */}
    <div style={{width:40,height:40,background:T.greenDk,borderRadius:14,display:"flex",alignItems:"center",justifyContent:"center"}}>
      <span style={{fontFamily:"'DM Serif Display',Georgia,serif",fontSize:24,fontWeight:400,color:T.inkInverse,lineHeight:1}}>S</span>
    </div>
    <div style={{display:"flex",alignItems:"center",gap:10,color:T.ink3,fontSize:13}}><span style={{display:"inline-block",width:14,height:14,border:"2px solid "+T.bg3,borderTopColor:T.greenDk,borderRadius:"50%",animation:"sp 0.7s linear infinite"}}/>Loading your workspace…</div>
  </div>;

  if(loadErr||!data) return <div style={{...BASE,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:12}}>
    <GlobalStyles/>
    <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=DM+Serif+Display&display=swap" rel="stylesheet"/>
    <div style={{fontFamily:"'DM Serif Display',Georgia,serif",fontSize:24,fontWeight:400,color:T.ink,letterSpacing:"-0.02em",opacity:0.85}}>Steward</div>
    <div style={{fontSize:15,fontWeight:700,color:T.terracotta}}>Failed to connect</div>
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
  // Plan tier drives the sidebar lock indicator on Team-gated items. Prefer the
  // server's authoritative planTier (BUILD-24); fall back to the local mirror of
  // orgPlanTier: Team = team/growth/impact OR a live trial; everything else
  // (core/seed/founding/lapsed) = Core. Defaults to team while billing is
  // unknown so we never flash a lock before the plan loads.
  const planTier=planTierOf(billing);
  const isCoreTier=planTier==="core";
  // BUILD-58 W-2 — the portal-tier shell. Derived from /org (synchronous with
  // the data load, no billing-fetch flash). tabAllowed filters every nav
  // surface; navigateTo routes a disallowed target back to the portal hub.
  const isPortalTier=data.org?.plan==="portal";
  // A portal-tier org sees ONLY its own surfaces; every other org sees the CRM
  // minus whatever is hidden from it.
  const tabAllowed=id=>isPortalTier?PORTAL_TIER_TABS.has(id)
    :(isCoreTier&&CORE_HIDDEN_TABS.has(id))?false
    :!CRM_HIDDEN_TABS.has(id);
  const bottomTabs=isPortalTier
    ?[BOTTOM_TABS.find(t=>t.id==="donors"),MORE_TABS.find(t=>t.id==="portal"),BOTTOM_TABS.find(t=>t.id==="settings")].filter(Boolean)
    :BOTTOM_TABS;
  const moreTabs=MORE_TABS.filter(t=>tabAllowed(t.id));
  const showTrialBanner=!bannerDismissed&&subStatus==="trialing"&&billing?.trialDaysLeft<=14;
  const showWarningBanner=accessState==="warning";
  const showReadOnlyBanner=isReadOnly;

  async function openPortal(){
    try{
      const r=await apiFetch("/billing/create-portal",{method:"POST"});
      window.location.href=r.url;
    }catch(e){ alert(billingErrorMessage(e, "Couldn't open billing right now. Please try again.")); }
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
    }catch(e){ alert(errorMessage(e, "Export failed")); }
    setExportingBanner(false);
  }

  // Sidebar nav button — one style for the main items and the pinned
  // Settings item. Active = gold left accent + elevated dark green, matching
  // the goal-card/dark-surface language (five-color palette only).
  const sideBtn=(active)=>({
    display:"flex",alignItems:"center",gap:10,width:"100%",textAlign:"left",
    background:active?"#1a2e1f":"transparent",
    border:"none",borderLeft:`3px solid ${active?"var(--org-accent,#c9a84c)":"transparent"}`,
    borderRadius:"0 10px 10px 0",padding:"8px 12px 8px 13px",
    color:active?"#f0ede6":"rgba(240,237,230,0.7)",fontSize:14,fontWeight:active?700:500,
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
  return <PhotoContext.Provider value={photoCtx}>
    {welcome&&<FirstRunWelcome firstName={welcome.firstName} orgName={welcome.orgName}
      mission={welcome.mission} motif={welcome.motif} words={welcome.words||[]}
      onDone={dismissWelcome}/>}
    <div className="app-root" style={{...BASE,background:tab==="dashboard"?T.ground:tab==="board"?T.bgDeep:T.bg,color:T.ink,display:"flex",flexDirection:"column","--org-accent":orgAccent,"--org-accent-fg":orgAccentFg}}>
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
    <div className="app-sidebar" style={{position:"fixed",left:0,top:52,bottom:0,width:240,background:"#0f1a12",borderRight:"1px solid #1a2e1f",display:"flex",flexDirection:"column",zIndex:120,boxSizing:"border-box"}}>
      <div style={{flex:1,overflowY:"auto",padding:"12px 10px 14px 0",display:"flex",flexDirection:"column",gap:2}}>
        {(()=>{
          const byId=Object.fromEntries(TABS.map(t=>[t.id,t]));
          const navItem=(t)=>{
            const active=tab===t.id;
            const locked=TEAM_GATED.has(t.id)&&isCoreTier;
            return <button key={t.id} className="side-nav-btn" onClick={()=>navigateTo(t.id)} style={sideBtn(active)}>
              <span style={{fontSize:14,width:18,textAlign:"center",color:active?"var(--org-accent,#c9a84c)":"rgba(240,237,230,0.55)",flexShrink:0}}>{t.icon}</span>
              {t.label}
              {locked&&<span title="Team plan" style={{marginLeft:"auto",display:"flex",alignItems:"center",color:"rgba(240,237,230,0.55)"}}><LockGlyph size={11} color="rgba(240,237,230,0.55)"/></span>}
              {t.earlyAccess&&<span style={{fontSize:9,fontWeight:700,letterSpacing:"0.04em",background:"#1a2e1f",color:"rgba(240,237,230,0.7)",border:"1px solid #2d4a35",borderRadius:99,padding:"1px 6px",lineHeight:"14px"}}>Early Access</span>}
              {t.id==="tasks"&&tasksDue>0&&<span style={{...DUE_BADGE,marginLeft:locked?6:"auto"}}>{tasksDue}</span>}
            </button>;
          };
          // A portal-tier org's ENTIRE product is the portal tab — it is never
          // folded away behind a disclosure. Everything else follows the split.
          const primaryIds=(isPortalTier?["dashboard","donors","portal"]:PRIMARY_NAV).filter(tabAllowed);
          const moreIds=MORE_NAV.filter(tabAllowed).filter(id=>!primaryIds.includes(id));
          const moreTasksDue=moreIds.includes("tasks")?tasksDue:0;
          return <>
            {/* BUILD-86 — Dashboards sits directly under Home: it is the one
                click the brief promises when somebody asks for a number. */}
            {primaryIds.map(id=>byId[id]).filter(Boolean).map(navItem)}
            {moreIds.length>0&&(
              <div style={{marginTop:12}}>
                <button onClick={()=>setNavMoreOpen(o=>{try{localStorage.setItem(NAV_MORE_KEY,o?"0":"1");}catch{/* private mode */}return !o;})}
                  aria-expanded={navMoreOpen} aria-controls="side-nav-more"
                  className="side-nav-btn" style={{...sideBtn(false),color:"#5a7566",fontSize:9.5,fontWeight:800,letterSpacing:"0.11em",textTransform:"uppercase",padding:"6px 12px 6px 13px"}}>
                  <span aria-hidden style={{fontSize:9,width:18,textAlign:"center",flexShrink:0,display:"inline-block",transform:navMoreOpen?"rotate(90deg)":"none",transition:"transform 0.15s"}}>▸</span>
                  More
                  {/* A count that vanishes when its tab folds away is worse
                      than no count — it moves to the group that holds it. */}
                  {!navMoreOpen&&moreTasksDue>0&&<span style={{...DUE_BADGE,marginLeft:"auto"}}>{moreTasksDue}</span>}
                </button>
                {navMoreOpen&&<div id="side-nav-more">{moreIds.map(id=>byId[id]).filter(Boolean).map(navItem)}</div>}
              </div>
            )}
          </>;
        })()}
      </div>
      {/* Pure nav below here — the user chip/sign-out moved to the top bar (BUILD-08) */}
      <div style={{borderTop:"1px solid #1a2e1f",padding:"10px 10px 12px 0",flexShrink:0}}>
        <button className="side-nav-btn" onClick={()=>navigateTo("settings")} style={sideBtn(tab==="settings")}>
          <span style={{fontSize:14,width:18,textAlign:"center",color:tab==="settings"?"var(--org-accent,#c9a84c)":"rgba(240,237,230,0.55)",flexShrink:0}}>⚙</span>
          Settings
        </button>
      </div>
    </div>

    {/* Main column — right of the sidebar (marginLeft) and below the fixed bar
        (marginTop) on desktop; both offsets reset to 0 ≤768px in GlobalStyles. */}
    <div className="app-main" style={{marginLeft:240,marginTop:52,display:"flex",flexDirection:"column",flex:1,minWidth:0}}>

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
        <button onClick={logout} className="app-signout" style={{background:"transparent",border:"1px solid #2d4a35",borderRadius:8,padding:"6px 12px",color:"rgba(240,237,230,0.7)",fontSize:12,cursor:"pointer"}}>
          Sign out
        </button>
      </div>
    </div>

    {/* The demo/sample banner sits ABOVE the billing states deliberately: a
        billing problem is about this organisation's account, and "none of this
        is real" is about every number underneath it. It is NOT dismissible. */}
    {(data.org?.isDemoOrg||sampleStatus?.hasSampleData)&&(
      <div data-testid="demo-data-banner" role="status" style={{background:T.gold700,borderBottom:"1px solid "+T.gold600,padding:"9px 24px",display:"flex",alignItems:"center",gap:12,fontSize:13,color:T.gold100,flexWrap:"wrap"}}>
        <span style={{flex:1,minWidth:240}}>
          {data.org?.isDemoOrg?(
            <><strong style={{color:T.gold50}}>This is a demonstration organisation.</strong>{" "}
              Everything in it is invented, and Steward will not send email to anyone here — not a
              receipt, not a reminder, not a campaign.</>
          ):(
            <><strong style={{color:T.gold50}}>
              {sampleStatus.sampleDonorCount} sample {sampleStatus.sampleDonorCount===1?"donor is":"donors are"} loaded.</strong>{" "}
              They are invented, they are counted in nothing you report, and Steward will not email
              them. Everyone else in this organisation still receives mail as normal.</>
          )}
        </span>
        {sampleStatus?.hasSampleData&&(
          <button data-testid="demo-banner-clear" onClick={clearSampleFromBanner} disabled={clearingSample}
            style={{background:T.gold500,border:"none",borderRadius:8,color:T.ink,fontSize:12,fontWeight:700,cursor:clearingSample?"not-allowed":"pointer",padding:"4px 12px",whiteSpace:"nowrap",opacity:clearingSample?0.7:1}}>
            {clearingSample?"Clearing…":"Clear the sample data"}
          </button>
        )}
        {!sampleStatus?.hasSampleData&&(
          <button onClick={()=>navigateTo("settings",{section:"data"})}
            style={{background:"none",border:"1px solid "+T.gold100,borderRadius:8,color:T.gold100,fontSize:12,fontWeight:700,cursor:"pointer",padding:"4px 12px",whiteSpace:"nowrap"}}>
            Your data →
          </button>
        )}
      </div>
    )}
    {showReadOnlyBanner&&<div style={{background:T.terra700,borderBottom:"1px solid "+T.terracotta,padding:"9px 24px",display:"flex",alignItems:"center",gap:12,fontSize:13,color:T.terra200,flexWrap:"wrap"}}>
      <span style={{flex:1,minWidth:200}}><strong style={{color:T.terra100}}>Your account is read-only.</strong> {subStatus==="trial_expired"?"Your free trial has ended.":"Your subscription has ended."} Export your data or reactivate to continue.</span>
      <button onClick={exportDataFromBanner} disabled={exportingBanner} style={{background:"none",border:"1px solid "+T.terra200,borderRadius:8,color:T.terra200,fontSize:12,fontWeight:700,cursor:exportingBanner?"not-allowed":"pointer",padding:"4px 12px",whiteSpace:"nowrap",opacity:exportingBanner?0.7:1}}>{exportingBanner?"Exporting…":"Export data →"}</button>
      <button onClick={()=>setShowPlanPicker(true)} style={{background:T.terra100,border:"none",borderRadius:8,color:T.terra700,fontSize:12,fontWeight:700,cursor:"pointer",padding:"4px 12px",whiteSpace:"nowrap"}}>Reactivate →</button>
    </div>}
    {!showReadOnlyBanner&&showWarningBanner&&subStatus==="past_due"&&<div style={{background:T.gold700,borderBottom:"1px solid "+T.gold600,padding:"9px 24px",display:"flex",alignItems:"center",gap:12,fontSize:13,color:T.gold100,flexWrap:"wrap"}}>
      <span style={{flex:1,minWidth:200}}><strong style={{color:T.gold50}}>Your last payment didn't go through.</strong> Update your payment method to keep Steward active.</span>
      <button onClick={openPortal} style={{background:T.gold500,border:"none",borderRadius:8,color:T.ink,fontSize:12,fontWeight:700,cursor:"pointer",padding:"4px 12px",whiteSpace:"nowrap"}}>Update payment →</button>
    </div>}
    {!showReadOnlyBanner&&showWarningBanner&&(subStatus==="canceled"||subStatus==="cancelled")&&<div style={{background:T.gold700,borderBottom:"1px solid "+T.gold600,padding:"9px 24px",display:"flex",alignItems:"center",gap:12,fontSize:13,color:T.gold100,flexWrap:"wrap"}}>
      <span style={{flex:1,minWidth:200}}><strong style={{color:T.gold50}}>Your subscription is canceled.</strong> You have until {billing?.graceUntil?new Date(billing.graceUntil).toLocaleDateString("en-US",{month:"short",day:"numeric"}):"soon"} to export your data or reactivate.</span>
      <button onClick={exportDataFromBanner} disabled={exportingBanner} style={{background:"none",border:"1px solid "+T.gold100,borderRadius:8,color:T.gold100,fontSize:12,fontWeight:700,cursor:exportingBanner?"not-allowed":"pointer",padding:"4px 12px",whiteSpace:"nowrap",opacity:exportingBanner?0.7:1}}>{exportingBanner?"Exporting…":"Export data"}</button>
      <button onClick={()=>setShowPlanPicker(true)} style={{background:T.gold500,border:"none",borderRadius:8,color:T.ink,fontSize:12,fontWeight:700,cursor:"pointer",padding:"4px 12px",whiteSpace:"nowrap"}}>Reactivate →</button>
    </div>}
    {showTrialBanner&&<div style={{background:billing.trialDaysLeft<=3?T.gold700:T.bgElevated,borderBottom:`1px solid ${billing.trialDaysLeft<=3?T.gold600:T.greenDk}`,padding:"9px 24px",display:"flex",alignItems:"center",gap:12,fontSize:13,color:billing.trialDaysLeft<=3?T.gold100:T.sage400}}>
      <span>⏳</span>
      {/* BUILD-90 — AN ORG IN TRIAL HAS USUALLY ALREADY DECIDED. It signed
          through a close link, a plan was chosen in the room and a card is on
          file, so "Upgrade now" was a call to action with nothing behind it.
          When there is a first charge date, the banner STATES it and points at
          the screen that carries the date and the cancel button. An org with
          no plan and no card — a legacy trial — still gets the old prompt,
          because for it choosing a plan really is the next thing. */}
      {billing.firstChargeAt
        ? <>
            <span><strong style={{color:"#f0ede6"}}>{billing.trialDaysLeft} days</strong> until your first charge{billing.monthlyUsd?` of $${billing.monthlyUsd}`:""} —</span>
            <button onClick={()=>navigateTo("settings",{section:"account"})} style={{background:"none",border:"none",color:billing.trialDaysLeft<=3?T.gold50:T.gold500,fontSize:13,fontWeight:700,cursor:"pointer",padding:0,textDecoration:"underline"}}>See billing →</button>
          </>
        : <>
            <span><strong style={{color:"#f0ede6"}}>{billing.trialDaysLeft} days</strong> left in your trial —</span>
            <button onClick={goToPricing} style={{background:"none",border:"none",color:billing.trialDaysLeft<=3?T.gold50:T.gold500,fontSize:13,fontWeight:700,cursor:"pointer",padding:0,textDecoration:"underline"}}>Choose a plan →</button>
          </>}
      <button onClick={()=>setBannerDismissed(true)} style={{marginLeft:"auto",background:"transparent",border:"none",color:"#3d5245",cursor:"pointer",fontSize:16,padding:"0 4px",lineHeight:1}}>✕</button>
    </div>}

    {/* BUILD-58 W-2 — portal-tier application status: a quiet, honest line,
        never an error screen. Approved renders nothing. */}
    {isPortalTier&&networkApp&&networkApp.status!=="approved"&&<div style={{background:T.gold100,borderBottom:"1px solid "+T.gold300,padding:"10px 24px",display:"flex",alignItems:"center",gap:10,fontSize:13,color:T.ink}}>
      <span style={{fontWeight:800,color:T.gold700,letterSpacing:"0.04em",textTransform:"uppercase",fontSize:11}}>
        {networkApp.status==="pending"?"Application under review":networkApp.status==="held"?"Application on hold":networkApp.status==="dispute"?"EIN under review":"Application not approved"}
      </span>
      <span style={{color:T.ink2}}>
        {networkApp.status==="pending"&&"We verify your EIN and Stripe setup, then a human approves your listing. Meanwhile you can import donors, record gifts, and design your portal — it stays private until approval."}
        {networkApp.status==="held"&&"A reviewer needs more information — check your email, or reply to jonathan@stewardapp.dev."}
        {networkApp.status==="dispute"&&"Your EIN is already claimed by another Steward organization — a human is reviewing both applications."}
        {networkApp.status==="rejected"&&"Your application wasn't approved. If you think that's wrong, write to jonathan@stewardapp.dev."}
      </span>
    </div>}

    {/* Per-tab width strategy (BUILD-06 Phase E): Home stays a readable
        centered column (~1200px) — it's a reading page. Workspace tabs
        (Donors, Grants, Communications, Reports, Settings + the hidden
        legacy tabs) go fluid full-width with 32px side padding so 1920px+
        displays get working room instead of dead gutters. Mobile is
        untouched — GlobalStyles' 768px rules override this with !important. */}
    <div className="app-content" style={{flex:1,padding:(tab==="dashboard"||tab==="board")?"20px 24px 28px 24px":"20px 32px 28px 32px",maxWidth:(tab==="dashboard"||tab==="board")?1200:"none",width:"100%",margin:"0 auto",boxSizing:"border-box"}}>
      {/* Per-surface crash insurance (BUILD-21 Part 2): a render error in one tab
          shows a graceful fallback in the content area — the sidebar/top bar stay
          usable and switching tabs (resetKey=tab) recovers — instead of a black
          screen. The shell itself is wrapped app-level in the App export below. */}
    <ErrorBoundary label={tab} resetKey={tab} onHome={()=>setTab("dashboard")}>
      {tab==="dashboard"&&<Dashboard data={data} setData={setData} onNavigate={navigateTo} isReadOnly={isReadOnly} surface="home"/>}
      {/* BUILD-86 — the same component, the other surface. One Dashboard, one
          layout, one set of sections; `surface` decides which of them render.
          A second component would have been two places to keep a section. */}
      {/* BUILD-86 C.3 — the board surface is FOUR DASHBOARDS now, each one
          question, each number carrying its own definition. The old single
          board screen's sections are gone with it: Board management (board
          members are donors with a flag, and a board packet is a PDF export,
          not a module), the "no platform fee" banner (marketing does not live
          inside the product), and stewardship debt and first-touch delay
          (0.6 — the first became "Gifts not yet thanked" with a definition and
          a start date, on People; the second measured the IMPORT DATE, not the
          donor, and is removed). */}
      {tab==="board"&&<Dashboards data={data} onNavigate={navigateTo}/>}
      {tab==="donors"&&<Donors key={navNonce} data={data} setData={setData} isReadOnly={isReadOnly} onNavigate={navigateTo} initialView={donorsIntent?.view} initialLogDonorId={donorsIntent?.logDonorId} initialStageFilter={donorsIntent?.stageFilter} initialSelectDonorId={donorsIntent?.selectDonorId} initialOpenImport={donorsIntent?.openImport} initialOpenConversation={donorsIntent?.openConversation} onIntentConsumed={()=>setDonorsIntent(null)}/>}
      {tab==="grants"&&<Grants key={navNonce} data={data} setData={setData} isReadOnly={isReadOnly} initialGrantId={grantsIntent?.grantId} initialSection={grantsIntent?.section} onIntentConsumed={()=>setGrantsIntent(null)}/>}
      {tab==="communications"&&<Communications key={navNonce} data={data} isReadOnly={isReadOnly} initialNav={commsInitialNav} highlightDraftId={commsHighlightDraftId} onInitialNavConsumed={()=>{setCommsInitialNav(null);setCommsHighlightDraftId(null);}} onNavigate={navigateTo}/>}
      {tab==="reports"&&<Reports key={navNonce} onNavigate={navigateTo} initialReport={reportsIntent?.report} initialParams={reportsIntent} initialSavedReport={reportsIntent?.savedReport}/>}
      {tab==="fundraising"&&<Fundraising key={navNonce} data={data} isReadOnly={isReadOnly} onNavigate={navigateTo} initialSection={fundraisingIntent?.section} initialScope={pipelineIntent?.scope} isCoreTier={isCoreTier}/>}
      {tab==="events"&&<Events data={data} isReadOnly={isReadOnly}/>}
      {/* FIX-1 C — the volunteer coordinator's hub, over person_types and
          volunteer_shifts. The old Volunteers.jsx (its own table) is not
          revived: the file stays, unimported, like Events and Board. */}
      {tab==="volunteers"&&<VolunteersHub key={navNonce} isReadOnly={isReadOnly} onNavigate={navigateTo}/>}
      {/* BUILD-86 C.3 — BOARD MANAGEMENT IS REMOVED. It was deprioritised out of
          the nav in 2026-07-12 but its render stayed, keyed on the tab id
          `board` — which C.3 reused for Dashboards, so BOTH drew on the same
          screen and a board-members module appeared beneath the board packet.
          Removed for the reason the spec gives: a board member is a donor with
          a flag, and a board packet is a PDF export, not a module. Board.jsx,
          its routes and its table are untouched, like Events and Volunteers. */}
      {tab==="finance"&&<Finance data={data} setData={setData} isReadOnly={isReadOnly} onNavigate={navigateTo}/>}
      {tab==="tasks"&&<Tasks key={navNonce} data={data} setData={setData} isReadOnly={isReadOnly} onNavigate={navigateTo} initialScope={tasksIntent?.scope}/>}
      {tab==="workflows"&&<Workflows isReadOnly={isReadOnly} onNavigate={navigateTo}/>}
      {tab==="portal"&&<DonorPortalHub auth={auth} isReadOnly={isReadOnly} onNavigate={navigateTo}/>}
      {tab==="settings"&&<Settings key={navNonce} auth={auth} logout={logout} initialSection={settingsIntent?.section} initialFocus={settingsIntent?.focus} onNavigate={navigateTo}/>}
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
    {subscribedToast&&<div style={{position:"fixed",bottom:24,right:24,zIndex:9999,background:T.greenDk,color:"#fff",borderRadius:14,padding:"14px 20px",fontSize:13,fontWeight:600,boxShadow:"0 8px 32px rgba(26,107,74,0.35)",display:"flex",alignItems:"center",gap:10,maxWidth:340}}>
      <div>
        <div style={{fontWeight:700,marginBottom:2}}>Payment received — thank you!</div>
        <div style={{fontWeight:400,opacity:0.85}}>Finishing up… your new plan will be active in a moment.</div>
      </div>
      <button onClick={()=>setSubscribedToast(false)} style={{marginLeft:"auto",background:"rgba(255,255,255,0.2)",border:"none",borderRadius:6,color:"#fff",cursor:"pointer",padding:"2px 8px",fontSize:13,fontWeight:700}}>✕</button>
    </div>}

    {/* More drawer — mobile only */}
    {moreOpen&&<div className="mobile-more-overlay" onClick={()=>setMoreOpen(false)}>
      <div className="mobile-more-drawer slide-up" onClick={e=>e.stopPropagation()}>
        <div className="mobile-more-handle"/>
        {moreTabs.map(t=>{
          const active=tab===t.id;
          return(
            <button key={t.id} onClick={()=>{setTab(t.id);setMoreOpen(false);}} className={`mobile-more-row${active?" active":""}`}>
              <span className="mob-icon">{t.icon}</span>
              <span style={{flex:1}}>{t.label}</span>
              {t.earlyAccess&&<span style={{fontSize:9,fontWeight:700,letterSpacing:"0.04em",background:"#1a2e1f",color:"rgba(240,237,230,0.7)",border:"1px solid #2d4a35",borderRadius:99,padding:"2px 7px"}}>Early Access</span>}
              {t.id==="tasks"&&tasksDue>0&&<span style={{background:T.terracotta,color:"#fff",fontSize:10,fontWeight:800,borderRadius:99,padding:"1px 6px"}}>{tasksDue}</span>}
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
      <button onClick={async()=>{deferredPrompt.prompt();setShowInstallPrompt(false);}} style={{background:"#0d5c3a",border:"none",borderRadius:8,padding:"6px 14px",color:"#fff",fontSize:12,fontWeight:700,cursor:"pointer",flexShrink:0}}>Add</button>
      <button onClick={()=>{setShowInstallPrompt(false);localStorage.setItem('installDismissed','true');}} style={{background:"transparent",border:"none",color:"rgba(240,237,230,0.7)",fontSize:18,cursor:"pointer",padding:"0 4px",lineHeight:1,flexShrink:0}}>×</button>
    </div>}

    {/* Bottom nav bar — mobile only, always in DOM */}
    <div className="mobile-bottom-bar">
      {bottomTabs.map(t=>(
        <button key={t.id} onClick={()=>{setTab(t.id);setMoreOpen(false);}} className={`mobile-bottom-tab${tab===t.id?" active":""}`}>
          <span className="mob-icon">{t.icon}</span>
          {t.label}
        </button>
      ))}
      <button onClick={()=>setMoreOpen(v=>!v)} className={`mobile-bottom-tab${moreTabs.some(t=>t.id===tab)||moreOpen?" active":""}`}>
        <span className="mob-icon">⋯</span>
        More
      </button>
    </div>
  </div></PhotoContext.Provider>;
}

// ── Root ───────────────────────────────────────────────────────────────────
export default function App() {
  // App-level crash insurance (BUILD-21 Part 2): catches a throw anywhere in the
  // shell (TopBar, sidebar, data adapt) that a per-tab boundary wouldn't cover,
  // so nothing can black-screen the whole authenticated app.
  return <ErrorBoundary label="the app"><AppShell /></ErrorBoundary>;
}
