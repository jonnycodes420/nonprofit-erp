import { useState, useEffect } from "react";
import { useLocation, useNavigate, useNavigationType } from "react-router-dom";
import { tabHref, parseAppUrl } from "./lib/appUrls";
import { RecordLink } from "./components/RecordLink";
import { apiFetch, adaptData, API, getToken, billingErrorMessage, leavingForLogin } from "./api";
import { HelpPanel } from "./components/HelpPanel";
import { useAuth } from "./main";
import { T, activeMark, GlobalStyles, LockGlyph, ErrorBoundary, goToPricing, PhotoContext, FirstRunWelcome } from "./components/shared";
// SHELVED — voice capture works but unproven adoption assumption, revisit later.
// Code intact, re-enable by uncommenting (see showVoiceMemo state, header
// button, and modal render below, and the matching import above:
// `VoiceMemoModal` from "./components/shared").
import { Dashboard } from "./components/Dashboard";
import { Donors } from "./components/Donors";
import { Grants } from "./components/Grants";
import { Communications } from "./components/Communications";
import { Reports } from "./components/Reports";
import { VolunteersHub } from "./components/VolunteersHub";
import { Board } from "./components/Board";
import { Finance } from "./components/Finance";
import { Fundraising } from "./components/Fundraising";
import { Tasks } from "./components/Tasks";
import { Agent } from "./components/Agent";
import { Settings } from "./components/Settings";
import JourneyBuilder from "./components/JourneyBuilder";
import GroupsPage from "./components/Groups";
import { DonorPortalHub } from "./components/DonorPortalHub";
import { confirmIfDirty } from "./lib/dirtyGuard";
import { Events } from "./components/Events";
import PlanPicker from "./components/PlanPicker";
import { TopBar } from "./components/TopBar";
import { errorMessage } from "./lib/domainError";
import { PLAN_UNKNOWN } from "./lib/entitlement";
import { TABS, BOTTOM_TABS, TEAM_GATED, CORE_HIDDEN_TABS, PORTAL_TIER_TABS, CRM_HIDDEN_TABS } from "./lib/tabRegistry";
// NAV-1 — the rail is GROUPS now, and the groups live in one JSX-free module
// beside the registry. PRIMARY_NAV / MORE_NAV / NAV_MORE_KEY are gone with the
// "More" fold they described.
import { navLayout, flattenNav, moveNavItem, reorderWithin, setNavVisible } from "./lib/navGroups";
import { NavIcon, NAV_ICON_SIZE } from "./components/NavIcon";
import { CustomizeNav } from "./components/CustomizeNav";
// The tier rule, as a module-level function rather than a value computed
// halfway down the component: `navigateTo` is declared above it and needs it,
// and a `const` read from a closure that could run first is a TDZ crash
// waiting for the right click. (BUILD-88a A.3 introduced exactly that and the
// A.4 browser suite caught it on the next run.) A billing that has not loaded
// is PLAN_UNKNOWN: not Core (no lock may flash before the plan loads) and not
// Team either (FIX-3 finding 9, client/src/lib/entitlement.js).
function planTierOf(billing){
  if(!billing)return PLAN_UNKNOWN;
  if(billing.planTier)return billing.planTier;
  const p=billing.plan;
  if(p==="team"||p==="growth"||p==="impact")return "team";
  if(billing.subscriptionStatus==="trialing")return "team";
  return "core";
}
// Written once: the same due-count badge now rides a nav item AND the "More"
// group that can be holding it. Two copies would be two hex literals, and the
// palette census ratchets DOWN.
// GTM-1b 5 — the two widths the rail has. Named once so the sidebar, the
// main column's margin and the collapse button cannot disagree by a pixel.
const SIDEBAR_W = 240, SIDEBAR_W_COLLAPSED = 64;

const DUE_BADGE={background:T.terracotta,color:T.white,fontSize:9,fontWeight:800,borderRadius:99,padding:"1px 6px",lineHeight:"14px"};

// ── App Shell ──────────────────────────────────────────────────────────────
function AppShell() {
  const { auth, logout } = useAuth();
  const [tab,setTab]=useState("dashboard");
  // FIX-13 Part 6 — the tab lives in the URL (lib/appUrls.js), so every page
  // opens in its own browser tab and Back/Forward walk the app.
  const location=useLocation();
  const navType=useNavigationType();
  const routerNavigate=useNavigate();

  // ── GTM-1b 5 · THE SIDEBAR FOLDS ────────────────────────────────────────
  // 240px of nav is a lot of a 1280 laptop to spend on where you already are.
  // Collapsed it keeps the icons — a rail, not a disappearance, so the shape
  // of the product stays on screen and nothing has to be remembered.
  //
  // REMEMBERED PER USER, not per browser: the key carries the user id, so two
  // people sharing a laptop do not fight over it. localStorage rather than a
  // column because it is a per-viewer convenience — losing it costs one click
  // and it never needs to reach another device or be read back by anything.
  // Every read and write is wrapped: a private window throws on access, and a
  // sidebar is not worth a white screen.
  // GTM-1b 1 — the over-band notice, read once on mount. The count itself is
  // taken after an import (the thing that changes it), so this is a cheap
  // read of what was already decided, not a scan.
  const [donorBand,setDonorBand]=useState(null);
  useEffect(()=>{
    let live=true;
    apiFetch("/billing/donor-band").then(d=>{ if(live)setDonorBand(d); }).catch(()=>{});
    return ()=>{live=false;};
  },[]);
  async function dismissBandNotice(){
    setDonorBand(d=>d?{...d,notice:{...d.notice,dismissedAt:new Date().toISOString()}}:d);
    try { await apiFetch("/billing/donor-band/dismiss",{method:"POST"}); } catch { /* the banner is already hidden */ }
  }

  // THREAD-2b 2 — the onboarding journey step was skipped. ONE card, until
  // it is done or dismissed. It re-checks whether a journey now exists, so
  // setting one up anywhere else makes the card disappear on the next load
  // rather than lingering as a lie.
  const [journeySkipped,setJourneySkipped]=useState(false);
  useEffect(()=>{
    let live=true;
    let flag=null;
    try{ flag=localStorage.getItem("npe_journey_skipped"); }catch{ /* private window */ }
    if(flag!=="1")return undefined;
    apiFetch("/journeys").then(d=>{
      if(!live)return;
      const any=(d.journeys||[]).some(j=>j.enabled);
      if(any){ try{localStorage.removeItem("npe_journey_skipped");}catch{/* private window */} setJourneySkipped(false); }
      else setJourneySkipped(true);
    }).catch(()=>{});
    return ()=>{live=false;};
  },[]);

  const sidebarKey = "npe_sidebar_collapsed_" + (auth?.user?.id || "anon");
  const [sidebarCollapsed,setSidebarCollapsed]=useState(()=>{
    try { return localStorage.getItem(sidebarKey) === "1"; } catch { return false; }
  });
  const toggleSidebar=()=>setSidebarCollapsed(v=>{
    const next=!v;
    try { localStorage.setItem(sidebarKey, next ? "1" : "0"); } catch { /* private window */ }
    return next;
  });
  // Cmd+\ (Ctrl+\ elsewhere) — the shortcut every tool with a panel uses.
  // Ignored while a field has focus so it cannot fire mid-typing.
  useEffect(()=>{
    const onKey=e=>{
      if(e.key!=="\\"||!(e.metaKey||e.ctrlKey))return;
      const t=e.target;
      if(t&&(t.tagName==="INPUT"||t.tagName==="TEXTAREA"||t.isContentEditable))return;
      e.preventDefault(); toggleSidebar();
    };
    window.addEventListener("keydown",onKey);
    return ()=>window.removeEventListener("keydown",onKey);
  });
  const [data,setData]=useState(null);
  const [loading,setLoading]=useState(true);
  const [loadErr,setLoadErr]=useState("");
  // FIX-22 — a rate limit is not an outage: the screen says so, and when.
  const [loadLimited,setLoadLimited]=useState(false);
  const [stripeToast,setStripeToast]=useState(false);
  const [subscribedToast,setSubscribedToast]=useState(false);
  const [moreOpen,setMoreOpen]=useState(false);
  // NAV-1 §4 — the person's own rail. `navSaved` is what the server holds
  // ([{id,visible}] or null for "never customized"); `navGroups` is that
  // merged with the canonical groups, which is what both the sidebar and the
  // Customize dialog read. A failure to load is silent and means the default
  // rail — nobody's navigation is blocked by a preference that would not fetch.
  const [navSaved,setNavSaved]=useState(null);
  const [navCustomizeOpen,setNavCustomizeOpen]=useState(false);
  const [navError,setNavError]=useState("");
  useEffect(()=>{
    if(!getToken())return;
    // null means "never customized", which is also what a failure means: the
    // default rail, never a blank one. The rail is not held back until this
    // lands — a nav that is not there yet is worse than one that settles.
    apiFetch("/me/nav-layout")
      .then(r=>setNavSaved(Array.isArray(r?.layout)?r.layout:null))
      .catch(()=>{});
  },[]);

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
  // TRUST-2 — an open incident on /status shows as one thin line under the bar.
  const [incident,setIncident]=useState(null);
  const [mobileHelp,setMobileHelp]=useState(false);   // HELP-1
  useEffect(()=>{ apiFetch("/status/summary").then(d=>{ const o=(d.incidents||[]).find(i=>!i.resolved_at); setIncident(o||null); }).catch(()=>{}); },[]);
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
  // FIX-1 §A — Agent opens on a view, and Home's one-line entry carries her words in.
  const [agentIntent,setAgentIntent]=useState(null);
  const [pipelineIntent,setPipelineIntent]=useState(null);
  // Attribution FIX — the Home hero chips deep-link into Reports (This FY →
  // Giving Summary current FY; This week → Giving Summary custom week range),
  // so Reports is now intent-carrying too (same remount-on-intent pattern).
  const [reportsIntent,setReportsIntent]=useState(null);
  // BUILD-57 — Home's Recurring tab deep-links to Fundraising → Recurring
  // Giving (opts key `frSection`, distinct from Settings' `section`).
  const [fundraisingIntent,setFundraisingIntent]=useState(null);
  const [journeysIntent,setJourneysIntent]=useState(null);
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
  const navigateTo=(t,opts,how)=>{
    // FIX-1 §A — Workflows moved into Agent, and so did Settings → Steward's
    // activity (the thirty-day undo list). Every old way in lands there.
    if(t==="workflows"){t="agent";opts={...(opts||{}),agentView:"workflows"};}
    // NAV-1 §2 — THE DASHBOARDS FOLDED INTO REPORTS, so every way in still
    // lands on the dashboard it named: navigateTo("board") from an older card,
    // a bookmark on /dashboards, a link in an email. The `board` id is kept as
    // a synonym rather than chased through the product.
    if(t==="board"){t="reports";opts={...(opts||{}),report:"dash:"+((opts&&opts.dashKey)||"board")};}
    if(t==="settings"&&opts?.section==="agent"){t="agent";opts={...opts,section:null,agentView:"guardrails"};}
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
    setAgentIntent(t==="agent"&&(opts?.agentView||opts?.agentText)?{view:opts.agentView||null,text:opts.agentText||"",autoAsk:!!opts.autoAsk}:null);
    // FIX-4 2 — the profile's journey chip lands on the journey it names,
    // open, rather than on a list somebody then has to find it in.
    setJourneysIntent(t==="journeys"&&opts?.journeyId?{journeyId:opts.journeyId}:null);
    const hasOpts=!!opts&&Object.keys(opts).some(k=>opts[k]!=null);
    if(hasOpts||how?.fromUrl)setNavNonce(n=>n+1);
    setTab(t);
    // FIX-13 Part 6 — and the address bar follows. A URL change that came
    // FROM the address bar (a link, Back) is not pushed again, and a click
    // on the tab already open keeps the URL of what is on screen.
    if(!how?.fromUrl&&(hasOpts||t!==tab)){
      const href=tabHref(t,opts);
      if(href!==window.location.pathname+window.location.search)routerNavigate(href,{state:{internal:true}});
    }
  };

  // FIX-13 Part 6 — read the URL on load, on Back/Forward, and when a plain
  // <Link> anywhere in the app changes it. Pushes the app made itself are
  // marked `internal` and already on screen.
  useEffect(()=>{
    if(location.state?.internal&&navType!=="POP")return;
    const r=parseAppUrl(location.pathname,location.search,location.hash);
    if(!r)return;
    navigateTo(r.tab,r.opts,{fromUrl:true});
    if(r.legacy){
      const canon=r.tab==="pipeline"?tabHref("fundraising",{frSection:"pipeline"}):tabHref(r.tab,r.opts);
      routerNavigate(canon,{replace:true,state:{internal:true}});
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[location.key]);


  useEffect(()=>{
    // FIX-13 Part 6 — /donors/:id, ?report=, ?fr= and ?tab=settings are read
    // by the URL reader above (lib/appUrls.js parseAppUrl), with every tab.
    const params=new URLSearchParams(window.location.search);
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
      // NAV-1 (a defect the §4 walk found) — A VOLUNTEER COORDINATOR COULD NOT
      // SIGN IN AT ALL. Four of these seven reads are refused for that role by
      // the VOL-1 allowlist, correctly and by design — and one rejection threw
      // here, so the whole shell rendered "Failed to connect" with the
      // coordinator's own refusal sentence under it. The role has a rail, a hub
      // and a roster, and no way to reach any of them.
      //
      // `coordinator_scope` is the same KIND of answer as `portal_tier`: the
      // server saying "not for you", not the server failing. It gets the same
      // treatment — an empty fallback — and the surfaces that need those reads
      // are already off this role's rail.
      const val=(r,fallback)=>{
        if(r.status==="fulfilled")return r.value;
        if(portalTier||r.reason?.error==="portal_tier")return fallback;
        if(r.reason?.error==="coordinator_scope")return fallback;
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
    } catch(e) { setLoadErr(e.message); setLoadLimited(e?.status===429); }
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

  // AN OUTAGE IS NOT THE SAME THING AS A SIGN-OUT, and this branch comes
  // FIRST because it used to lose the race. A 401 clears the session and
  // starts the navigation to /login, and the throw that follows landed in
  // loadData's catch and painted "Failed to connect" over a redirect that was
  // already on its way. Somebody whose session had been revoked was told the
  // server was down, and given a Retry button that could never work.
  if(leavingForLogin()) return <div style={{...BASE,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:12}}>
    <GlobalStyles/>
    <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=DM+Serif+Display&display=swap" rel="stylesheet"/>
    <div style={{fontFamily:"'DM Serif Display',Georgia,serif",fontSize:24,fontWeight:400,color:T.ink,letterSpacing:"-0.02em",opacity:0.85}}>Steward</div>
    <div style={{fontSize:13,color:T.ink3}}>Taking you to the login page.</div>
  </div>;

  if(loadErr||!data) return <div style={{...BASE,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:12}}>
    <GlobalStyles/>
    <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=DM+Serif+Display&display=swap" rel="stylesheet"/>
    <div style={{fontFamily:"'DM Serif Display',Georgia,serif",fontSize:24,fontWeight:400,color:T.ink,letterSpacing:"-0.02em",opacity:0.85}}>Steward</div>
    <div style={{fontSize:15,fontWeight:700,color:T.terracotta}}>{loadLimited?"One moment":"Failed to connect"}</div>
    <div style={{fontSize:13,color:T.ink3,maxWidth:300,textAlign:"center"}}>{loadErr||"Could not load your workspace. Check your connection and try again."}</div>
    <button onClick={()=>window.location.reload()} style={{marginTop:4,background:T.green,border:"none",borderRadius:10,padding:"9px 20px",color:T.white,fontSize:13,fontWeight:700,cursor:"pointer"}}>Retry</button>
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
  // (core/seed/founding/lapsed) = Core. While billing is unknown the tier is
  // PLAN_UNKNOWN, which is neither, so no lock flashes before the plan loads.
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
  // ── NAV-1 — THE RAIL, GROUPED ─────────────────────────────────────────────
  // One list of groups drives three surfaces: the sidebar at 1440, the
  // collapsed rail, and the phone's More drawer. They used to be three
  // separate lists in the registry (PRIMARY_NAV, MORE_NAV, MORE_TABS), which
  // is how the phone came to teach a different product from the desktop twice
  // (FIX-9 Part E, BUILD-87 F.3.5). Now a group added here reaches all three.
  //
  // A portal-tier org's ENTIRE product is the portal tab, so it keeps its own
  // three-item rail and is never offered a Customize dialog about groups it
  // does not have.
  const navRole=auth?.user?.role||null;
  // The canonical layout, every item in it, before the org's plan has a say.
  // Every SAVE is written against this one, so a preference about an item this
  // plan happens to hide is kept rather than quietly dropped.
  const navFull=navLayout(navSaved,{role:navRole});
  const navGroups=(isPortalTier
    ?[{id:"start",label:null,bottom:false,items:[{id:"dashboard",visible:true},{id:"donors",visible:true},{id:"portal",visible:true}]},
      {id:"bottom",label:null,bottom:true,items:[{id:"settings",visible:true}]}]
    :navFull)
    // Visibility is the PERSON's choice; tabAllowed is the org's plan and tier.
    // Both have to say yes, and the plan has the last word.
    .map(g=>({...g,items:g.items.filter(i=>tabAllowed(i.id))}));
  const navVisible=navGroups.map(g=>({...g,items:g.items.filter(i=>i.visible)}));
  const navLabelOf=id=>(TABS.find(t=>t.id===id)||{}).label||id;
  const saveNav=next=>{
    const flat=flattenNav(next);
    setNavSaved(flat);
    setNavError("");
    apiFetch("/me/nav-layout",{method:"PUT",body:JSON.stringify({layout:flat})})
      .catch(()=>setNavError("That didn't save. Your sidebar will go back to how it was when you reload."));
  };
  // The Customize dialog edits the MERGED layout and lists exactly what this
  // org HAS: offering to show "Donor Portal" to a CRM org whose plan hides it
  // is offering a tab that is not there. A hidden-by-plan item keeps whatever
  // the saved layout says about it, untouched, so it comes back as it was if
  // the plan changes.
  const navEdit=navGroups;
  const resetNav=()=>{
    setNavSaved(null);
    setNavError("");
    apiFetch("/me/nav-layout",{method:"DELETE"})
      .catch(()=>setNavError("That didn't reset. Your sidebar will go back to how it was when you reload."));
  };
  const bottomTabs=isPortalTier
    ?[BOTTOM_TABS.find(t=>t.id==="donors"),TABS.find(t=>t.id==="portal"),BOTTOM_TABS.find(t=>t.id==="settings")].filter(Boolean)
    :BOTTOM_TABS;
  // The phone's More drawer is every VISIBLE nav item that is not already one
  // of the four bottom slots, in the rail's own groups and the rail's own order.
  const bottomIds=new Set(bottomTabs.map(t=>t.id));
  const moreGroups=navVisible
    .map(g=>({...g,items:g.items.filter(i=>!bottomIds.has(i.id))}))
    .filter(g=>g.items.length>0);
  const moreTabs=moreGroups.flatMap(g=>g.items);
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
  // Settings item. FIX-2 C — the active item is the shared light treatment
  // (activeMark): cream's shade on the ink rail, ink text, 700, a 3px emerald
  // rule on its left edge. It was an elevated dark-green block with a brass
  // bar, and with the ink rail around it the green read as the whole app.
  const sideBtn=(active)=>({
    display:"flex",alignItems:"center",gap:10,width:"100%",textAlign:"left",
    position:"relative",   // GTM-1b 5 — the collapsed rail's due dot anchors here
    background:"transparent",
    border:"none",
    borderRadius:"0 10px 10px 0",padding:"8px 12px 8px 16px",
    color:T.sage400,fontSize:14,fontWeight:500,
    cursor:"pointer",transition:"color 0.15s,background 0.15s",boxSizing:"border-box",
    ...activeMark(active,"left")
  });

  // NAV-1 — ONE nav button, used by the grouped rail and by the pinned pair at
  // the bottom. Settings used to be a second hand-written copy of this button
  // with its own hard-coded glyph, which is how it kept a 14px ⚙ while every
  // other item moved to a 20px icon in GTM-1b.
  const navById=Object.fromEntries(TABS.map(t=>[t.id,t]));
  const navItem=(t)=>{
    const active=tab===t.id;
    const locked=TEAM_GATED.has(t.id)&&isCoreTier;
    // GTM-1b 5 — collapsed, the item is its icon and its title attribute.
    // `aria-label` carries the name so a screen reader still hears "Donors".
    // FIX-13 Part 6 — a real link to the tab, so it opens in a new browser tab.
    return <RecordLink key={t.id} to={tabHref(t.id)} className="side-nav-btn" data-nav-id={t.id} aria-current={active?"page":undefined}
      aria-label={sidebarCollapsed?t.label:undefined} title={sidebarCollapsed?t.label:undefined}
      onOpen={()=>navigateTo(t.id)} style={{...sideBtn(active),...(sidebarCollapsed?{justifyContent:"center",padding:"8px 0",borderRadius:0}:null)}}>
      {/* NAV-1 §3 — the literal icon, one size and one stroke width
          everywhere, in the colour the button already decided. */}
      {/* FIX-11 Part 6 — the box is NAV_ICON_SIZE, not a literal, so the span
          and the glyph cannot disagree about how wide an icon is. */}
      <span style={{width:NAV_ICON_SIZE,display:"flex",alignItems:"center",justifyContent:"center",color:active?T.ink:T.sage600,flexShrink:0}}><NavIcon id={t.id}/></span>
      {!sidebarCollapsed&&t.label}
      {!sidebarCollapsed&&locked&&<span title="Team plan" style={{marginLeft:"auto",display:"flex",alignItems:"center",color:"rgba(240,237,230,0.55)"}}><LockGlyph size={11} color="rgba(240,237,230,0.55)"/></span>}
      {!sidebarCollapsed&&t.earlyAccess&&<span style={{fontSize:9,fontWeight:700,letterSpacing:"0.04em",background:T.bgElevated,color:"rgba(240,237,230,0.7)",border:"1px solid "+T.green650,borderRadius:99,padding:"1px 6px",lineHeight:"14px"}}>Early Access</span>}
      {t.id==="tasks"&&tasksDue>0&&(sidebarCollapsed
        ? <span aria-label={`${tasksDue} due`} style={{position:"absolute",top:4,right:10,width:7,height:7,borderRadius:"50%",background:T.terracotta}}/>
        : <span style={{...DUE_BADGE,marginLeft:locked?6:"auto"}}>{tasksDue}</span>)}
    </RecordLink>;
  };

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
  const orgAccent=data.org?.brandAccent||T.gold500;
  const orgAccentFg=data.org?.brandAccentFg||T.ink;
  return <PhotoContext.Provider value={photoCtx}>
    {welcome&&<FirstRunWelcome firstName={welcome.firstName} orgName={welcome.orgName}
      mission={welcome.mission} motif={welcome.motif} words={welcome.words||[]}
      line={welcome.line} nextStep={welcome.nextStep} logo={welcome.logo} funds={welcome.funds||[]}
      onDone={dismissWelcome}/>}
    <div className="app-root" style={{...BASE,background:tab==="dashboard"?T.ground:T.bg,color:T.ink,display:"flex",flexDirection:"column","--org-accent":orgAccent,"--org-accent-fg":orgAccentFg,
      /* FIX-6 item 6 — the sidebar's CURRENT width, published so a full-screen
         takeover can start where the content starts instead of at x=0. The
         donor profile is a fixed z-200 layer and the sidebar is z-120, so a
         takeover with left:0 painted over the ENTIRE nav: every item was
         visible through the transparent gutter and none of them could be
         clicked. Keyboard still worked, which is why it read as an Agent-item
         problem rather than a dead nav. */
      "--sidebar-w":(sidebarCollapsed?SIDEBAR_W_COLLAPSED:SIDEBAR_W)+"px"}}>
    <GlobalStyles/>
    <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=DM+Serif+Display&display=swap" rel="stylesheet"/>

    {/* Global top bar — full-width, fixed, spans the whole viewport ABOVE the
        sidebar (BUILD-10). Carries the wordmark, search, help menu, user chip
        + sign-out. Desktop only (GlobalStyles hides it ≤768px; mobile keeps
        the .app-header inside app-main below). zIndex sits above the z-200
        full-screen takeovers so the bar stays visible over them. */}
    <TopBar auth={auth} logout={logout} onNavigate={navigateTo} screen={tab==="settings"&&settingsIntent?.section?`settings:${settingsIntent.section}`:tab}/>

    {/* Sidebar — desktop only (hidden ≤768px; mobile keeps bottom bar + More
        drawer). Starts BENEATH the 52px bar (top:52); pure nav now — wordmark
        moved into the bar's left edge, user chip/sign-out live in the bar. */}
    <div className="app-sidebar" data-collapsed={sidebarCollapsed?"1":"0"}
      style={{position:"fixed",left:0,top:52,bottom:0,width:sidebarCollapsed?SIDEBAR_W_COLLAPSED:SIDEBAR_W,background:T.ink,borderRight:"1px solid "+T.bgElevated,display:"flex",flexDirection:"column",zIndex:120,boxSizing:"border-box",transition:"width 0.16s ease"}}>
      <div id="app-sidebar-nav" style={{flex:1,overflowY:"auto",padding:"12px 10px 14px 0",display:"flex",flexDirection:"column",gap:2}}>
        {(()=>{
          // NAV-1 §1 — GROUPS, NOT A FOLD. Five short lists with a small
          // uppercase label over each; nothing is behind a disclosure any more,
          // so Tasks and Communications — both used daily — are on the rail
          // where they always should have been. §5: collapsed to 64px a group
          // label would truncate to "RELATION…", so each label becomes a thin
          // divider and the items stay visible as icons.
          return navVisible.filter(g=>!g.bottom).map(g=>{
            const items=g.items.map(i=>navById[i.id]).filter(Boolean);
            if(items.length===0)return null;
            return <div key={g.id} data-nav-group={g.id}>
              {g.label&&(sidebarCollapsed
                ? <div aria-hidden="true" style={{height:1,background:T.bgElevated,margin:"9px 10px 9px 0"}}/>
                : <div style={{color:T.sage600,fontSize:9.5,fontWeight:800,letterSpacing:"0.11em",textTransform:"uppercase",padding:"12px 12px 4px 16px"}}>{g.label}</div>)}
              {items.map(navItem)}
            </div>;
          });
        })()}
      </div>
      {/* Pure nav below here — the user chip/sign-out moved to the top bar (BUILD-08) */}
      <div style={{borderTop:"1px solid "+T.bgElevated,padding:"10px 10px 12px 0",flexShrink:0}}>
        {/* NAV-1 §1 — AGENT AND SETTINGS, SEPARATED. Neither is a room where
            the work happens: one is the thing that drafts, the other is where
            you change how the product behaves. They sit under the rail's own
            rule rather than at the end of MONEY. */}
        <div data-nav-group="bottom">
          {navVisible.filter(g=>g.bottom).flatMap(g=>g.items).map(i=>navById[i.id]).filter(Boolean).map(navItem)}
        </div>
        {/* NAV-1 §4 — the way in to the person's own rail. A small link, not a
            nav item: it opens a dialog, it does not go anywhere. A portal-tier
            org has a three-item product and no groups to arrange, so it is not
            offered one. */}
        {!isPortalTier&&!sidebarCollapsed&&<button data-testid="nav-customize" onClick={()=>setNavCustomizeOpen(true)}
          style={{...sideBtn(false),fontSize:11.5,color:T.sage600,padding:"6px 12px 6px 16px"}}>
          <span style={{width:20,flexShrink:0}}/>
          Customize
        </button>}
        {/* GTM-1b 5 — THE PANEL BUTTON. Last in the rail, below Settings,
            where every tool with a collapsible panel puts it. It says what it
            does and what the shortcut is, so the shortcut is discoverable
            from the button rather than from a changelog. */}
        <button data-testid="sidebar-toggle" onClick={toggleSidebar}
          aria-expanded={!sidebarCollapsed} aria-controls="app-sidebar-nav"
          aria-label={sidebarCollapsed?"Expand the sidebar":"Collapse the sidebar"}
          title={(sidebarCollapsed?"Expand":"Collapse")+" sidebar  (⌘\\)"}
          style={{...sideBtn(false),...(sidebarCollapsed?{justifyContent:"center",padding:"8px 0",borderRadius:0}:null)}}>
          <span aria-hidden="true" style={{fontSize:14,width:18,textAlign:"center",color:T.sage600,flexShrink:0,display:"inline-flex",alignItems:"center",justifyContent:"center"}}>
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
              <rect x="0.75" y="1.75" width="12.5" height="10.5" rx="2" stroke="currentColor" strokeWidth="1.3"/>
              <line x1={sidebarCollapsed?"5.1":"5.1"} y1="1.75" x2={sidebarCollapsed?"5.1":"5.1"} y2="12.25" stroke="currentColor" strokeWidth="1.3"/>
            </svg>
          </span>
          {!sidebarCollapsed&&<>Collapse<span style={{marginLeft:"auto",fontSize:11,color:T.sage600,letterSpacing:"0.02em"}}>⌘\</span></>}
        </button>
      </div>
    </div>

    {navCustomizeOpen&&<CustomizeNav groups={navEdit} labelOf={navLabelOf} error={navError}
      onMove={(groupId,id,delta)=>{
        const shown=moveNavItem(navEdit,groupId,id,delta).find(g=>g.id===groupId);
        saveNav(reorderWithin(navFull,groupId,shown.items.map(i=>i.id)));
      }}
      onToggle={(id,visible)=>saveNav(setNavVisible(navFull,id,visible))}
      onReset={resetNav} onClose={()=>setNavCustomizeOpen(false)}/>}

    {/* Main column — right of the sidebar (marginLeft) and below the fixed bar
        (marginTop) on desktop; both offsets reset to 0 ≤768px in GlobalStyles. */}
    <div className="app-main" style={{marginLeft:sidebarCollapsed?SIDEBAR_W_COLLAPSED:SIDEBAR_W,transition:"margin-left 0.16s ease",marginTop:52,display:"flex",flexDirection:"column",flex:1,minWidth:0}}>

    {/* Header — mobile only (display:none here; GlobalStyles' 768px block restores it) */}
    <div className="app-header" style={{borderBottom:"1px solid "+T.bgElevated,padding:"0 24px",display:"none",alignItems:"center",justifyContent:"space-between",background:T.ink,position:"sticky",top:0,zIndex:100,height:52,width:"100%",boxSizing:"border-box"}}>
      <div style={{display:"flex",alignItems:"center",gap:12}}>
        <span style={{fontSize:20,fontWeight:400,color:T.inkInverse,fontFamily:"'DM Serif Display',Georgia,serif",letterSpacing:"-0.02em"}}>Steward</span>
      </div>
      <div style={{display:"flex",gap:8,alignItems:"center"}}>
        {/* SHELVED — voice capture works but unproven adoption assumption, revisit later.
            Code intact, re-enable by uncommenting.
        <button onClick={()=>setShowVoiceMemo(true)} title="Record a voice memo" style={{background:"#1a2e1f",border:"1px solid #2d4a35",borderRadius:10,padding:"7px 12px",color:"#c9a84c",fontSize:12,fontWeight:700,cursor:"pointer",display:"flex",alignItems:"center",gap:6}}>
          Voice memo
        </button>
        */}
        <div className="app-avatar" style={{width:30,height:30,borderRadius:8,background:T.bg2,display:"flex",alignItems:"center",justifyContent:"center"}}>
          <span style={{fontSize:12,fontWeight:700,color:T.ink}}>{(auth?.user?.name||"U")[0].toUpperCase()}</span>
        </div>
        <button onClick={logout} className="app-signout" style={{background:"transparent",border:"1px solid "+T.green650,borderRadius:8,padding:"6px 12px",color:"rgba(240,237,230,0.7)",fontSize:12,cursor:"pointer"}}>
          Sign out
        </button>
      </div>
    </div>

    {/* The demo/sample banner sits ABOVE the billing states deliberately: a
        billing problem is about this organisation's account, and "none of this
        is real" is about every number underneath it. It is NOT dismissible. */}
    {incident&&<div data-testid="incident-line" role="status" style={{background:T.ink,color:T.inkInverse,borderBottom:"1px solid "+T.bgElevated,padding:"6px 24px",fontSize:12.5,display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
      <span aria-hidden style={{width:7,height:7,borderRadius:99,background:T.gold}}/>
      <span>We are working on something: {incident.title}.</span>
      <a href="/status" target="_blank" rel="noreferrer" style={{color:T.inkInverse,textDecoration:"underline"}}>See status</a>
    </div>}
    {(data.org?.isDemoOrg||sampleStatus?.hasSampleData)&&(
      <div data-testid="demo-data-banner" role="status" style={{background:T.gold700,borderBottom:"1px solid "+T.gold600,padding:"9px 24px",display:"flex",alignItems:"center",gap:12,fontSize:13,color:T.gold100,flexWrap:"wrap"}}>
        <span style={{flex:1,minWidth:240}}>
          {data.org?.isDemoOrg?(
            <><strong style={{color:T.gold50}}>This is a demonstration organisation.</strong>{" "}
              Everything in it is invented, and Steward will not send email to anyone here: not a
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
    {/* ── THREAD-2b 2 · ONE CALM CARD, IF THE JOURNEY STEP WAS SKIPPED ──
        Not a banner and not a nag: it sits once, says what it is for, and
        goes away for good when it is done or dismissed. Cream on ink's
        shade rather than brass — nothing is wrong, there is simply a thing
        worth ten minutes. */}
    {journeySkipped&&(
      <div data-testid="journey-nudge" style={{background:T.bg2,borderBottom:"1px solid "+T.bg3,padding:"9px 24px",display:"flex",alignItems:"center",gap:12,fontSize:13,color:T.ink,flexWrap:"wrap"}}>
        <span style={{flex:1,minWidth:240}}>
          <strong>You have not said how you look after a new donor yet.</strong>{" "}
          Pick one of five, adjust it, and Steward reminds you step by step. Ten minutes, and nothing is ever sent without you.
        </span>
        <button onClick={()=>navigateTo("settings",{section:"journeys"})}
          style={{background:T.greenDk,border:"none",borderRadius:8,color:T.white,fontSize:12,fontWeight:700,cursor:"pointer",padding:"5px 13px",whiteSpace:"nowrap"}}>
          Set up a journey →
        </button>
        <button data-testid="journey-nudge-dismiss"
          onClick={()=>{ setJourneySkipped(false); try{localStorage.setItem("npe_journey_skipped","dismissed");}catch{/* private window */} }}
          style={{background:"none",border:"1px solid "+T.bg3,borderRadius:8,color:T.ink3,fontSize:12,fontWeight:700,cursor:"pointer",padding:"5px 13px",whiteSpace:"nowrap"}}>
          Not now
        </button>
      </div>
    )}
    {/* ── GTM-1b 1 · YOU HAVE GROWN PAST YOUR BAND ──────────────────────
        Brass, not red: this is not a failure and nothing is wrong. It is
        news, with a date attached, and the date is at least thirty days out.
        It says plainly that nothing has changed — the single most important
        sentence on it, because the natural reading of a billing banner is
        that you have already been charged. */}
    {donorBand?.notice&&!donorBand.notice.dismissedAt&&(
      <div data-testid="band-notice" style={{background:T.gold700,borderBottom:"1px solid "+T.gold600,padding:"9px 24px",display:"flex",alignItems:"center",gap:12,fontSize:13,color:T.gold100,flexWrap:"wrap"}}>
        <span style={{flex:1,minWidth:240}}>
          <strong style={{color:T.gold50}}>You have {Number(donorBand.notice.count||0).toLocaleString()} active donors</strong>
          {" — more than your current plan's band. "}
          {donorBand.notice.nextMonthlyUsd
            ? <>The next plan, {donorBand.notice.nextBandName||donorBand.notice.nextBandLabel} ({String(donorBand.notice.nextBandLabel||"").toLowerCase()}), is ${donorBand.notice.nextMonthlyUsd} a month. </>
            : <>{donorBand.notice.nextBandName||donorBand.notice.nextBandLabel} ({String(donorBand.notice.nextBandLabel||"").toLowerCase()}) is a conversation rather than a price. </>}
          <strong style={{color:T.gold50}}>Nothing has changed</strong>
          {donorBand.notice.effectiveAt
            ? <>, and nothing will before {new Date(donorBand.notice.effectiveAt).toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric"})}.</>
            : <>.</>}
        </span>
        <button onClick={()=>navigateTo("settings",{section:"billing"})}
          style={{background:T.gold500,border:"none",borderRadius:8,color:T.ink,fontSize:12,fontWeight:700,cursor:"pointer",padding:"4px 12px",whiteSpace:"nowrap"}}>
          See the numbers →
        </button>
        <button data-testid="band-notice-dismiss" onClick={dismissBandNotice}
          style={{background:"none",border:"1px solid "+T.gold100,borderRadius:8,color:T.gold100,fontSize:12,fontWeight:700,cursor:"pointer",padding:"4px 12px",whiteSpace:"nowrap"}}>
          Got it
        </button>
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
            <span><strong style={{color:T.inkInverse}}>{billing.trialDaysLeft} days</strong> until your first charge{billing.monthlyUsd?` of $${billing.monthlyUsd}`:""} —</span>
            <button onClick={()=>navigateTo("settings",{section:"account"})} style={{background:"none",border:"none",color:billing.trialDaysLeft<=3?T.gold50:T.gold500,fontSize:13,fontWeight:700,cursor:"pointer",padding:0,textDecoration:"underline"}}>See billing →</button>
          </>
        : <>
            <span><strong style={{color:T.inkInverse}}>{billing.trialDaysLeft} days</strong> left in your trial —</span>
            <button onClick={goToPricing} style={{background:"none",border:"none",color:billing.trialDaysLeft<=3?T.gold50:T.gold500,fontSize:13,fontWeight:700,cursor:"pointer",padding:0,textDecoration:"underline"}}>Choose a plan →</button>
          </>}
      <button onClick={()=>setBannerDismissed(true)} style={{marginLeft:"auto",background:"transparent",border:"none",color:T.sage600,cursor:"pointer",fontSize:16,padding:"0 4px",lineHeight:1}}>✕</button>
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
    <div className="app-content" style={{flex:1,padding:tab==="dashboard"?"20px 24px 28px 24px":"20px 32px 28px 32px",maxWidth:tab==="dashboard"?1200:"none",width:"100%",margin:"0 auto",boxSizing:"border-box"}}>
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
      {tab==="donors"&&<Donors key={navNonce} data={data} setData={setData} isReadOnly={isReadOnly} onNavigate={navigateTo} initialView={donorsIntent?.view} initialLogDonorId={donorsIntent?.logDonorId} initialStageFilter={donorsIntent?.stageFilter} initialSelectDonorId={donorsIntent?.selectDonorId} initialOpenImport={donorsIntent?.openImport} initialOpenConversation={donorsIntent?.openConversation} onIntentConsumed={()=>setDonorsIntent(null)}/>}
      {tab==="grants"&&<Grants key={navNonce} data={data} setData={setData} isReadOnly={isReadOnly} initialGrantId={grantsIntent?.grantId} initialSection={grantsIntent?.section} onIntentConsumed={()=>setGrantsIntent(null)}/>}
      {tab==="communications"&&<Communications key={navNonce} data={data} isReadOnly={isReadOnly} initialNav={commsInitialNav} highlightDraftId={commsHighlightDraftId} onInitialNavConsumed={()=>{setCommsInitialNav(null);setCommsHighlightDraftId(null);}} onNavigate={navigateTo}/>}
      {tab==="reports"&&<Reports key={navNonce} appData={data} onNavigate={navigateTo} initialReport={reportsIntent?.report} initialParams={reportsIntent} initialSavedReport={reportsIntent?.savedReport}/>}
      {tab==="fundraising"&&<Fundraising key={navNonce} data={data} isReadOnly={isReadOnly} isAdmin={auth?.user?.role==="admin"} onNavigate={navigateTo} initialSection={fundraisingIntent?.section} initialScope={pipelineIntent?.scope} isCoreTier={isCoreTier}/>}
      {/* FIX-4 2 — the builder, in its own room. The SAME component Settings
          renders, with the page header every other screen has around it; the
          Settings section is untouched, so both doors open the same thing. */}
      {tab==="journeys"&&(
        <div>
          <h1 style={{fontFamily:"'DM Serif Display',Georgia,serif",fontWeight:400,fontSize:32,margin:"0 0 6px",color:T.ink}}>Journeys</h1>
          <p style={{fontSize:14,color:T.ink3,lineHeight:1.6,margin:"0 0 20px",maxWidth:680}}>
            How you look after somebody, written down once and then remembered for you.
          </p>
          <JourneyBuilder key={navNonce} isAdmin={auth?.user?.role==="admin"} isReadOnly={isReadOnly} initialJourneyId={journeysIntent?.journeyId}/>
        </div>
      )}
      {/* PARITY-1 Part D — Groups, under Relationships. */}
      {tab==="groups"&&<GroupsPage key={navNonce} isReadOnly={isReadOnly} onNavigate={navigateTo}/>}
      {tab==="events"&&<Events key={navNonce} data={data} isReadOnly={isReadOnly}/>}
      {/* FIX-1 C — the volunteer coordinator's hub, over person_types and
          volunteer_shifts. The old Volunteers.jsx (its own table) is not
          revived: the file stays, unimported, like Events and Board. */}
      {tab==="volunteers"&&<VolunteersHub key={navNonce} isReadOnly={isReadOnly} onNavigate={navigateTo} role={auth?.user?.role}/>}
      {/* BUILD-86 C.3 — BOARD MANAGEMENT IS REMOVED. It was deprioritised out of
          the nav in 2026-07-12 but its render stayed, keyed on the tab id
          `board` — which C.3 reused for Dashboards, so BOTH drew on the same
          screen and a board-members module appeared beneath the board packet.
          Removed for the reason the spec gives: a board member is a donor with
          a flag, and a board packet is a PDF export, not a module. Board.jsx,
          its routes and its table are untouched, like Events and Volunteers. */}
      {tab==="finance"&&<Finance key={navNonce} data={data} setData={setData} isReadOnly={isReadOnly} onNavigate={navigateTo}/>}
      {tab==="tasks"&&<Tasks key={navNonce} data={data} setData={setData} isReadOnly={isReadOnly} onNavigate={navigateTo} initialScope={tasksIntent?.scope}/>}
      {tab==="agent"&&<Agent key={navNonce} data={data} isReadOnly={isReadOnly} onNavigate={navigateTo} initialView={agentIntent?.view} initialText={agentIntent?.text} autoAsk={agentIntent?.autoAsk}/>}
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
    {stripeToast&&<div style={{position:"fixed",bottom:24,right:24,zIndex:9999,background:T.greenDk,color:T.white,borderRadius:14,padding:"14px 20px",fontSize:13,fontWeight:600,boxShadow:"0 8px 32px rgba(26,107,74,0.35)",display:"flex",alignItems:"center",gap:10,maxWidth:340}}>
      <div>
        <div style={{fontWeight:700,marginBottom:2}}>Stripe connected!</div>
        <div style={{fontWeight:400,opacity:0.85}}>You can now accept online donations.</div>
      </div>
      <button onClick={()=>setStripeToast(false)} style={{marginLeft:"auto",background:"rgba(255,255,255,0.2)",border:"none",borderRadius:6,color:T.white,cursor:"pointer",padding:"2px 8px",fontSize:13,fontWeight:700}}>✕</button>
    </div>}
    {subscribedToast&&<div style={{position:"fixed",bottom:24,right:24,zIndex:9999,background:T.greenDk,color:T.white,borderRadius:14,padding:"14px 20px",fontSize:13,fontWeight:600,boxShadow:"0 8px 32px rgba(26,107,74,0.35)",display:"flex",alignItems:"center",gap:10,maxWidth:340}}>
      <div>
        <div style={{fontWeight:700,marginBottom:2}}>Payment received — thank you!</div>
        <div style={{fontWeight:400,opacity:0.85}}>Finishing up… your new plan will be active in a moment.</div>
      </div>
      <button onClick={()=>setSubscribedToast(false)} style={{marginLeft:"auto",background:"rgba(255,255,255,0.2)",border:"none",borderRadius:6,color:T.white,cursor:"pointer",padding:"2px 8px",fontSize:13,fontWeight:700}}>✕</button>
    </div>}

    {/* More drawer — mobile only */}
    {moreOpen&&<div className="mobile-more-overlay" onClick={()=>setMoreOpen(false)}>
      <div className="mobile-more-drawer slide-up" onClick={e=>e.stopPropagation()}>
        <div className="mobile-more-handle"/>
        {/* NAV-1 §1/§6 — THE PHONE MENU IS THE RAIL'S GROUPS, IN THE RAIL'S
            ORDER, and it reads from the same merged layout: an item somebody
            hid on their laptop is hidden on their phone too. It used to be a
            third hand-kept list (MORE_TABS), which is how the phone twice came
            to teach a different product from the desktop. */}
        {moreGroups.map(g=><div key={g.id} data-nav-group={g.id}
          /* The pinned pair has no heading on the rail either; on the phone it
             gets the rail's own separator so Settings does not read as the
             last thing under MONEY. */
          style={g.bottom?{borderTop:"1px solid "+T.bg3,marginTop:6,paddingTop:4}:undefined}>
          {g.label&&<div style={{fontSize:9.5,fontWeight:800,letterSpacing:"0.11em",textTransform:"uppercase",color:T.ink3,padding:"10px 16px 4px"}}>{g.label}</div>}
          {g.items.map(i=>navById[i.id]).filter(Boolean).map(t=>{
            const active=tab===t.id;
            return(
              <RecordLink key={t.id} to={tabHref(t.id)} data-nav-id={t.id} onOpen={()=>{navigateTo(t.id);setMoreOpen(false);}} className={`mobile-more-row${active?" active":""}`}>
                <span className="mob-icon" style={{display:"inline-flex",alignItems:"center",justifyContent:"center"}}><NavIcon id={t.id} size={18}/></span>
                <span style={{flex:1}}>{t.label}</span>
                {t.earlyAccess&&<span style={{fontSize:9,fontWeight:700,letterSpacing:"0.04em",background:T.bgElevated,color:"rgba(240,237,230,0.7)",border:"1px solid "+T.green650,borderRadius:99,padding:"2px 7px"}}>Early Access</span>}
                {t.id==="tasks"&&tasksDue>0&&<span style={{background:T.terracotta,color:T.white,fontSize:10,fontWeight:800,borderRadius:99,padding:"1px 6px"}}>{tasksDue}</span>}
              </RecordLink>
            );
          })}
        </div>)}
        <div style={{borderTop:"1px solid "+T.bg3,margin:"4px 0"}}/>
        {/* HELP-1 — help for this screen, on the phone (the bar's "?" is desktop). */}
        <button data-testid="mobile-help" onClick={()=>{setMobileHelp(true);setMoreOpen(false);}} className="mobile-more-row">
          <span className="mob-icon" style={{fontSize:16,width:28,textAlign:"center"}}>?</span>
          <span style={{flex:1}}>Help</span>
        </button>
        {/* INT-BUILD-1 Part 0 — the profile menu's inbox item, on the phone. */}
        <button data-testid="mobile-connect-inbox" onClick={()=>{navigateTo("settings",{section:"connections",focus:"inbox"});setMoreOpen(false);}} className="mobile-more-row">
          <span className="mob-icon" style={{fontSize:16,width:28,textAlign:"center"}}>@</span>
          <span style={{flex:1}}>Connect your inbox</span>
        </button>
        <button className="mobile-more-signout" onClick={()=>{logout();setMoreOpen(false);}}>
          <span className="mob-icon" style={{fontSize:18,width:28,textAlign:"center"}}>↩</span>
          Sign out
        </button>
      </div>
    </div>}

    {mobileHelp&&<HelpPanel screen={tab} onClose={()=>setMobileHelp(false)}/>}
    {/* Install prompt — mobile browsers only */}
    {showInstallPrompt&&deferredPrompt&&<div style={{position:"fixed",bottom:"calc(60px + env(safe-area-inset-bottom,0px))",left:0,right:0,zIndex:145,background:T.ink,borderTop:"1px solid "+T.bgElevated,padding:"10px 16px",display:"flex",alignItems:"center",gap:12,boxShadow:"0 -4px 20px rgba(0,0,0,0.3)"}}>
      <span style={{flex:1,fontSize:13,color:T.inkInverse,fontWeight:500}}>Add Steward to your home screen</span>
      <button onClick={async()=>{deferredPrompt.prompt();setShowInstallPrompt(false);}} style={{background:T.greenDk,border:"none",borderRadius:8,padding:"6px 14px",color:T.white,fontSize:12,fontWeight:700,cursor:"pointer",flexShrink:0}}>Add</button>
      <button onClick={()=>{setShowInstallPrompt(false);localStorage.setItem('installDismissed','true');}} style={{background:"transparent",border:"none",color:"rgba(240,237,230,0.7)",fontSize:18,cursor:"pointer",padding:"0 4px",lineHeight:1,flexShrink:0}}>×</button>
    </div>}

    {/* Bottom nav bar — mobile only, always in DOM */}
    <div className="mobile-bottom-bar">
      {bottomTabs.map(t=>(
        <RecordLink key={t.id} to={tabHref(t.id)} data-nav-id={t.id} onOpen={()=>{navigateTo(t.id);setMoreOpen(false);}} className={`mobile-bottom-tab${tab===t.id?" active":""}`}>
          <span className="mob-icon" style={{display:"inline-flex",alignItems:"center",justifyContent:"center"}}><NavIcon id={t.id} size={19}/></span>
          {t.label}
        </RecordLink>
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
