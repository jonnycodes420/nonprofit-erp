import { useState, useEffect, Fragment } from "react";
import { apiFetch } from "../api";
import { useAuth } from "../main";
import { T, fmt, fmtFull, quietPhrase, daysUntil, daysDiff, askClaude, buildContext, Spin, AIBtn, GoldMoment, interactive, SectionTabs } from "./shared";
import { DashboardRecurring } from "./RecurringGiving";
import { mergeLayout, sectionMeta, isDefaultLayout, moveToTop } from "../lib/homeLayout";
import { greetingForHour } from "../lib/greeting";
import FunnelChart from "./FunnelChart";
import MetricBreakdownPanel from "./MetricBreakdownPanel";

// BUILD-34 — customizable Home. Sections render from a per-user ordered
// [{id,visible}] config (client/src/lib/homeLayout.js is the canonical list +
// merge rule; GET/PUT /me/home-layout is the server-side per-user store).
// Edit mode is reorder + show/hide of WHOLE sections only — deliberately not a
// widget grid. The 150ms drag lift is the only motion, off under
// prefers-reduced-motion.
const REDUCED_MOTION = typeof window !== "undefined" && window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
// The shared scope toggle renders above the FIRST visible section that reads
// it, wherever the user put that section.
const SCOPED_SECTION_IDS = ["commandCenter", "retention", "work"];

// One config-driven panel serves all 5 drillable My Portfolio stats below
// (Portfolio itself isn't here — it navigates straight to the existing "My
// Pipeline" Kanban view instead, per the donor-list-not-a-breakdown request)
// rather than five near-identical state+fetch+JSX blocks.
const PORTFOLIO_BREAKDOWNS = {
  visits: { endpoint: "/dashboard/my-stats/visits/breakdown", title: "Visits YTD", explanation: "Meetings you've logged this fiscal year, most recent first." },
  moves: { endpoint: "/dashboard/my-stats/moves/breakdown", title: "Moves Made", explanation: "Every meaningful contact you've logged this fiscal year — calls, meetings, emails, and stewardship touches (visits are the meeting subset of this list)." },
  gifts: { endpoint: "/dashboard/my-stats/gifts/breakdown", title: "Gifts YTD", explanation: "Gifts received this fiscal year from donors assigned to you, largest first." },
  pipeline: { endpoint: "/dashboard/my-stats/pipeline/breakdown", title: "Pipeline", explanation: "Your assigned donors still in an active stage, ranked by lifetime giving." },
  lapsed: { endpoint: "/dashboard/my-stats/lapsed/breakdown", title: "Lapsed", explanation: "Donors assigned to you who've lapsed, ranked by lifetime giving." },
};

// The impact line. BUILD-73 Part 3 rewrote what it LEADS with, and the reason
// is positioning, not data.
//
// It used to open "Steward has recovered $X in failed-card gifts and re-engaged
// $Y from N lapsed donors." On a demo org with a decade of history that renders
// as "$2M re-engaged from 610 lapsed donors" — and nobody reads that as a
// description of the organization's own past. It reads as money STEWARD brought
// in, on the first screen a prospect sees, which is invented social proof. If
// a prospect later works out the number is synthetic, everything else said in
// that meeting becomes suspect.
//
// THE RULE, now stated where it is easy to find: the value math describes the
// SIZE OF THE PROBLEM, never Steward's results. So the lead figure is money AT
// RISK — the lifetime giving of donors who have gone quiet — which is a fact
// about the org's own file and claims nothing. Same vocabulary as the landing
// page, on purpose: one language across the demo and the marketing.
//
// Pinned by tests/reserved-recovered.test.js, which fails the build on the
// whole outcome-claim family ("recovered", "re-engaged", "recaptured",
// "won back", "brought back"), not on one exact string.
function ImpactLine({ impact }) {
  const [open, setOpen] = useState(false);
  if (!impact) return null;
  const atRisk = impact.atRiskAmount || 0;
  const quiet = impact.quietDonorCount || 0;
  const retried = impact.recoveredAmount || 0;
  const returned = impact.reengagedAmount || 0;
  const returnedDonors = impact.reengagedDonorCount || 0;
  const watching = impact.watchingRecurringCount || 0;
  const online = impact.onlineGivingProcessed || 0;
  const hasRetried = retried > 0;
  const hasAtRisk = atRisk > 0 && quiet > 0;
  // Nothing to say yet → stay silent rather than manufacture a line.
  if (!hasAtRisk && !hasRetried && returned <= 0 && watching <= 0 && online <= 0) return null;

  const head = hasAtRisk
    ? <><strong style={{ color: T.ink }}>{fmt(atRisk)}</strong> at risk across <strong style={{ color: T.ink }}>{quiet.toLocaleString()}</strong> quiet donor{quiet === 1 ? "" : "s"} — no gift in over {quietPhrase(impact.quietSinceDays)}. No platform fee, no donor tip.</>
    : watching > 0
      ? <>Steward is watching <strong style={{ color: T.ink }}>{watching}</strong> recurring donor{watching === 1 ? "" : "s"} for failed cards — no platform fee, no donor tip, gifts settle in your own Stripe.</>
      : <>No platform fee, no donor tip — <strong style={{ color: T.green600 }}>$0</strong> to Steward on every gift, settled in your own Stripe.</>;

  const row = (label, value, note) => (
    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, padding: "7px 0", borderTop: "1px solid " + T.bg3 }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: T.ink }}>{label}</div>
        <div style={{ fontSize: 11.5, color: T.ink3, lineHeight: 1.45, marginTop: 1 }}>{note}</div>
      </div>
      <div style={{ fontSize: 14, fontWeight: 800, color: T.ink, whiteSpace: "nowrap", fontFamily: "'DM Serif Display',serif" }}>{value}</div>
    </div>
  );

  return (
    <div style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 14, overflow: "hidden" }}>
      <div {...interactive(() => setOpen(o => !o), { label: "Show what Steward has done for you" })}
        style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 18px" }}>
        <span aria-hidden style={{ color: T.gold500, fontSize: 14, lineHeight: 1 }}>◈</span>
        <span style={{ flex: 1, fontSize: 13, color: T.ink2, lineHeight: 1.5 }}>{head}</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: T.green600, whiteSpace: "nowrap" }}>{open ? "Hide" : "Details"}</span>
      </div>
      {open && (
        <div style={{ padding: "2px 18px 14px", background: T.green100 }}>
          {hasAtRisk && row(
            "At risk right now",
            fmt(atRisk),
            `Lifetime giving of ${quiet.toLocaleString()} donor${quiet === 1 ? "" : "s"} with no gift in over ${quietPhrase(impact.quietSinceDays)} — drifting, but not yet lapsed. This is your file's own history, not anything Steward did: it is the size of the problem, measured.`
          )}
          {hasRetried && row(
            "Failed cards, retried automatically",
            fmt(retried),
            `${impact.recoveredCount} gift${impact.recoveredCount === 1 ? "" : "s"} whose card failed and which the dunning workflow retried. Tracked per gift, 100% attributable to a retry Steward actually ran.`
          )}
          {returned > 0 && row(
            "Gifts after a year-long gap",
            fmt(returned),
            `${fmt(returned)} from ${returnedDonors} donor${returnedDonors === 1 ? "" : "s"} who gave again after a 365-day gap. A fact about your file's history — counted separately from the failed-card retries, never merged into them.`
          )}
          {row(
            "Platform fees you paid Steward",
            "$0",
            "You process donations on your own Stripe — no platform fee, no donor tip. (Stripe's standard card fee still applies, and goes to Stripe, not to us.)"
          )}
          {online > 0 && row(
            <>What you'd likely have paid elsewhere <span style={{ fontSize: 10, fontWeight: 700, color: T.gold600, textTransform: "uppercase", letterSpacing: "0.05em" }}>· estimate</span></>,
            "~" + fmt(impact.estimatedFeesElsewhere),
            `Estimate — assumes ~${impact.feeAssumptionPct}% in platform/processing fees a typical platform charges, on the ${fmt(online)} in online giving you processed through Steward.`
          )}
        </div>
      )}
    </div>
  );
}

// ── BUILD-35: "Set up Steward" activation checklist ──────────────────────────
// Each row's done-state comes computed live from GET /org/setup-status — never
// stored per-step — so an item checks itself off however the underlying thing
// became true (wizard, Settings, a teammate). The server owns the computation;
// this map owns the words and the EXACT deep link per item (a specific screen,
// never a tab root). The `team` key only arrives on Team tier (plan-graceful:
// hidden on Core, not shown-and-locked).
const SETUP_ITEM_META = {
  donors:     { label: "Import your donors",             why: "Steward can only watch donors it knows about",                                cta: "Import",  nav: ["donors", { openImport: true }] },
  stripe:     { label: "Connect Stripe",                 why: "unlocks online giving and failed-card recovery — no platform fee, no donor tip", cta: "Connect", nav: ["settings", { section: "giving" }] },
  address:    { label: "Add your mailing address",       why: "goes in every email footer (CAN-SPAM) and clears the reminder banner",         cta: "Add",     nav: ["settings", { section: "receipts" }] },
  givingPage: { label: "Publish a giving page",          why: "a shareable page your donors can give through today",                          cta: "Publish", nav: ["settings", { section: "giving" }] },
  workflow:   { label: "Turn on your first automation",  why: "automations are how Steward watches your donors while you work",               cta: "Turn on", nav: ["workflows", undefined] },
  team:       { label: "Invite your team",               why: "portfolios and pipelines start when your gift officers are in",                cta: "Invite",  nav: ["settings", { section: "team" }] },
};

function SetupChecklist({ status, onNavigate, isAdmin, onSetCardState }) {
  const { items, doneCount, totalCount, cardState } = status;

  if (cardState === "collapsed") {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <button onClick={() => onSetCardState(null)}
          aria-label={`Finish setting up Steward — ${doneCount} of ${totalCount} done`}
          style={{ display: "inline-flex", alignItems: "center", gap: 8, background: T.white, border: "1px solid " + T.bg3, borderRadius: 99, padding: "7px 14px", fontSize: 12.5, fontWeight: 700, color: T.ink2, cursor: "pointer" }}>
          <span aria-hidden style={{ color: T.gold500 }}>◈</span>
          Finish setup · {doneCount}/{totalCount}
        </button>
        {isAdmin && (
          <button onClick={() => onSetCardState("hidden")} aria-label="Don't show the setup checklist again"
            title="Don't show this again"
            style={{ background: "none", border: "none", color: T.ink3, fontSize: 15, cursor: "pointer", padding: 4, lineHeight: 1 }}>×</button>
        )}
      </div>
    );
  }

  return (
    <div style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 14, padding: "16px 18px" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 4 }}>
        <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: T.ink3 }}>Set up Steward</div>
        <div style={{ fontSize: 12, fontWeight: 700, color: T.ink2 }}>{doneCount} of {totalCount}</div>
        <div style={{ flex: 1 }} />
        {isAdmin && (
          <button onClick={() => onSetCardState("collapsed")}
            style={{ background: "none", border: "none", color: T.ink3, fontSize: 12, fontWeight: 600, cursor: "pointer", textDecoration: "underline", padding: 2 }}>
            I'll finish later
          </button>
        )}
      </div>
      {/* solid gold fill — bar LENGTH carries the meaning (no gradients) */}
      <div aria-hidden style={{ height: 4, borderRadius: 2, background: T.bg3, overflow: "hidden", marginBottom: 10 }}>
        <div style={{ height: "100%", width: `${totalCount ? Math.round((doneCount / totalCount) * 100) : 0}%`, background: T.gold500, borderRadius: 2 }} />
      </div>
      {items.map(item => {
        const meta = SETUP_ITEM_META[item.key];
        if (!meta) return null;
        if (item.done) {
          return (
            <div key={item.key} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 2px", borderTop: "1px solid " + T.bg2 }}>
              <span aria-hidden style={{ width: 20, height: 20, borderRadius: "50%", background: T.green600, color: T.white, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, flexShrink: 0 }}>✓</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: T.ink3 }}>{meta.label}</span>
            </div>
          );
        }
        return (
          <div key={item.key} {...interactive(() => onNavigate(meta.nav[0], meta.nav[1]), { label: `${meta.label} — ${meta.why}` })}
            style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 2px", borderTop: "1px solid " + T.bg2, borderRadius: 8 }}>
            <span aria-hidden style={{ width: 20, height: 20, borderRadius: "50%", border: "1.5px solid " + T.bg3, flexShrink: 0 }} />
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: T.ink }}>{meta.label}</span>
              <span style={{ display: "block", fontSize: 11.5, color: T.ink3, lineHeight: 1.45 }}>{meta.why}</span>
            </span>
            <span style={{ fontSize: 12, fontWeight: 700, color: T.green600, whiteSpace: "nowrap" }}>{meta.cta} →</span>
          </div>
        );
      })}
    </div>
  );
}

// ── Dashboard / Home ─────────────────────────────────────────────────────────
export function Dashboard({data,setData,onNavigate,isReadOnly=false}) {
  const {auth}=useAuth();
  const isAdmin=auth?.user?.role==="admin";
  const todayStr=new Date().toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric"});

  // BUILD-57 — the dashboard area is two tabs: Today (the existing section
  // stack) and Recurring (EXCEPTIONS only — counts + a path into the
  // Fundraising → Recurring Giving page, never a second roster).
  const [dashTab,setDashTab]=useState("today");
  const [briefing,setBriefing]=useState("");
  const [briefLoading,setBriefLoading]=useState(false);
  const [briefOpen,setBriefOpen]=useState(false);
  const [myStats,setMyStats]=useState(null);
  // My Portfolio is the daily driver — it leads the Home and opens expanded by
  // default (BUILD-19 Home tweak). The collapse toggle is kept for anyone who
  // wants it; only the initial state flipped to open.
  const [portfolioOpen,setPortfolioOpen]=useState(true);

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
  // BUILD-21 Part 1 — the typed/roll-up goal model (BUILD-16) now leads the Home
  // hero, reusing the SAME source the Fundraising Overview reads
  // (/fundraising/overview → {rollup, goals, period}). undefined = loading.
  // When the org has ≥1 active goal'd campaign this supersedes the single
  // fundraising_goals banner below; with none, we fall back to that banner
  // (today's behavior — don't regress).
  const [fundOverview,setFundOverview]=useState(undefined);
  const [showSetGoal,setShowSetGoal]=useState(false);
  const [goalModalMode,setGoalModalMode]=useState("create"); // "create" | "edit"
  const [goalForm,setGoalForm]=useState({label:"",goalAmount:"",goalType:"total_raised",periodStart:"",periodEnd:""});
  const [savingGoal,setSavingGoal]=useState(false);

  const [stageCounts,setStageCounts]=useState([]);
  const [stewardMetrics,setStewardMetrics]=useState(null);
  const [recurringHealth,setRecurringHealth]=useState(null);
  const [impact,setImpact]=useState(null);
  const [resentIds,setResentIds]=useState(()=>new Set());
  // BUILD-16 Part 1 — the Home command center's four headers (Portfolio/Tasks/
  // Need-to-do/Pipeline), plan-graceful (Core hides the Team headers).
  const [homeData,setHomeData]=useState(null);
  const [firstTouchOpen,setFirstTouchOpen]=useState(false);

  // ── BUILD-76 Part 2 — the Drifting surface ────────────────────────────────
  // Org-wide (the headline is the landing page's sentence about the whole
  // file), computed on read server-side — refetched after any done-action so
  // the list, the badge counts and the headline can never be stale together.
  const [driftData,setDriftData]=useState(null);      // capped list (the day view)
  const [driftAllData,setDriftAllData]=useState(null); // see-all expansion, fetched on demand
  const [driftLineFor,setDriftLineFor]=useState(null); // donorId with the one-line input open
  const [driftLine,setDriftLine]=useState("");
  const [driftBusy,setDriftBusy]=useState(false);
  const loadDrift=()=>apiFetch("/drift").then(r=>{setDriftData(r);setDriftAllData(null);}).catch(()=>{});

  // ── BUILD-35: activation checklist state ──────────────────────────────────
  const setupOrgId=(()=>{try{return JSON.parse(localStorage.getItem("npe_org")||"{}").id||"org";}catch{return "org";}})();
  const [setupStatus,setSetupStatus]=useState(null);
  // Whether THIS load is the completion moment. Decided ONCE at fetch time —
  // GoldMoment stamps its once-ever localStorage flag on mount, so a render
  // gate that re-read the flag would kill the banner on the very next
  // re-render (it did, in the live drive).
  const [setupCelebrate,setSetupCelebrate]=useState(false);
  useEffect(()=>{
    apiFetch("/org/setup-status").then(s=>{
      let seen=false,fired=false;
      try{seen=!!localStorage.getItem(`steward_setup_seen_${setupOrgId}`);fired=!!localStorage.getItem(`steward_gold_setup_complete_${setupOrgId}`);}catch{/* private mode */}
      // Remember this org was ever seen INCOMPLETE — it gates the completion
      // GoldMoment, so an org that was already fully set up before the card
      // existed never gets congratulated for it (don't nag, don't flatter).
      if(s&&!s.complete){try{localStorage.setItem(`steward_setup_seen_${setupOrgId}`,"1");}catch{/* private mode */}}
      if(s&&s.complete&&seen&&!fired)setSetupCelebrate(true);
      setSetupStatus(s);
    }).catch(()=>{}); // offline/error → no card, Home unaffected
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);
  const setSetupCardState=async(state)=>{
    setSetupStatus(s=>s?{...s,cardState:state}:s); // optimistic
    try{await apiFetch("/org/setup-card",{method:"PUT",body:JSON.stringify({state})});}catch{/* keep optimistic view; recomputed next load */}
  };

  // ── BUILD-34: per-user section layout + edit mode ─────────────────────────
  const [layout,setLayout]=useState(undefined);       // undefined = loading; then the MERGED [{id,visible}]
  const [editMode,setEditMode]=useState(false);
  const [preEditLayout,setPreEditLayout]=useState(null); // rollback target for Esc / a failed save
  const [dragSectionId,setDragSectionId]=useState(null);
  const [layoutError,setLayoutError]=useState("");

  useEffect(()=>{
    apiFetch("/me/home-layout")
      .then(r=>setLayout(mergeLayout(r?.layout)))
      .catch(()=>setLayout(mergeLayout(null))); // offline/error → default order, still usable
  },[]);

  const moveSection=(id,delta)=>setLayout(l=>{
    const i=l.findIndex(r=>r.id===id), j=i+delta;
    if(i<0||j<0||j>=l.length)return l;
    const n=[...l]; const [row]=n.splice(i,1); n.splice(j,0,row); return n;
  });
  const setSectionVisible=(id,visible)=>setLayout(l=>l.map(r=>
    r.id===id?{...r,visible:sectionMeta(id)?.hideable===false?true:visible}:r));
  // "Move to top" (edit mode): one click sends the section to the top of the
  // stack, respecting the hero rail (top = under the hero while the hero is
  // first — see moveToTop in ../lib/homeLayout). The aria-live message tells a
  // screen-reader user where the section landed.
  const [layoutLiveMsg,setLayoutLiveMsg]=useState("");
  const moveSectionToTop=id=>{
    const next=moveToTop(layout,id);
    if(next===layout)return;
    setLayout(next);
    const vis=next.filter(r=>r.visible);
    setLayoutLiveMsg(`${sectionMeta(id)?.label||id} moved to top — position ${vis.findIndex(r=>r.id===id)+1} of ${vis.length}`);
  };

  const enterEdit=()=>{setPreEditLayout(layout);setEditMode(true);};
  const cancelEdit=()=>{if(preEditLayout)setLayout(preEditLayout);setEditMode(false);setDragSectionId(null);};
  const resetLayout=()=>setLayout(mergeLayout(null));
  const saveEdit=async()=>{
    // Optimistic: the new order is already on screen — exit edit mode now,
    // roll back to the pre-edit layout only if the server rejects the save.
    const prev=preEditLayout, next=layout;
    setEditMode(false);setDragSectionId(null);
    try{
      // Saving the canonical default clears the row (NULL) instead of freezing
      // today's default order into it — future default changes then apply.
      if(isDefaultLayout(next))await apiFetch("/me/home-layout",{method:"DELETE"});
      else await apiFetch("/me/home-layout",{method:"PUT",body:JSON.stringify({layout:next})});
    }catch(e){
      if(prev)setLayout(prev);
      setLayoutError(e.message||"Couldn't save your Home layout — your changes were undone.");
      setTimeout(()=>setLayoutError(""),6000);
    }
  };

  // Esc cancels edit mode (same key contract as the pipeline's drop prompt).
  useEffect(()=>{
    if(!editMode)return;
    const onKey=e=>{if(e.key==="Escape")cancelEdit();};
    window.addEventListener("keydown",onKey);
    return()=>window.removeEventListener("keydown",onKey);
  });

  // Drag-to-reorder (native HTML5, same machinery as the pipeline board).
  // Midpoint rule: the dragged section slots before/after the hovered one
  // depending on which half of it the cursor is in — stable, no thrash.
  const onSectionDragStart=(e,id)=>{
    setDragSectionId(id);
    try{e.dataTransfer.effectAllowed="move";e.dataTransfer.setData("text/plain",id);}catch{/* older browsers */}
  };
  const onSectionDragEnd=()=>setDragSectionId(null);
  const onSectionDragOver=(e,overId)=>{
    if(!dragSectionId||dragSectionId===overId)return;
    e.preventDefault();
    const rect=e.currentTarget.getBoundingClientRect();
    const after=e.clientY>rect.top+rect.height/2;
    setLayout(l=>{
      const from=l.findIndex(r=>r.id===dragSectionId);
      let to=l.findIndex(r=>r.id===overId);
      if(from<0||to<0)return l;
      if(after)to+=1;
      if(to>from)to-=1;
      if(to===from)return l;
      const n=[...l]; const [row]=n.splice(from,1); n.splice(to,0,row); return n;
    });
  };
  const onSectionDrop=e=>{e.preventDefault();setDragSectionId(null);};

  const [debtBreakdownOpen,setDebtBreakdownOpen]=useState(false);
  // At-risk hero chip drill-down (attribution FIX) — reads impact.atRiskDonors.
  const [reengBreakdownOpen,setReengBreakdownOpen]=useState(false);
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

  // My Portfolio stat drill-downs — one piece of state driving whichever of
  // the 5 PORTFOLIO_BREAKDOWNS panels is open, cached per key so re-opening
  // the same stat doesn't re-fetch.
  const [portfolioBreakdown,setPortfolioBreakdown]=useState({key:null,open:false,data:null,loading:false});
  const [hoveredStat,setHoveredStat]=useState(null);

  const openPortfolioBreakdown=key=>{
    setPortfolioBreakdown(prev=>{
      if(prev.key===key)return{...prev,open:true};
      return{key,open:true,data:null,loading:true};
    });
    if(portfolioBreakdown.key===key&&portfolioBreakdown.data)return;
    const cfg=PORTFOLIO_BREAKDOWNS[key];
    apiFetch(cfg.endpoint)
      .then(r=>setPortfolioBreakdown(prev=>prev.key===key?{...prev,data:r,loading:false}:prev))
      .catch(()=>setPortfolioBreakdown(prev=>prev.key===key?{...prev,data:{count:0,rows:[]},loading:false}:prev));
  };
  const closePortfolioBreakdown=()=>setPortfolioBreakdown(prev=>({...prev,open:false}));
  const goToDonorFromPortfolio=row=>{
    closePortfolioBreakdown();
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
    apiFetch("/impact").then(r=>setImpact(r)).catch(()=>{});
    apiFetch("/fundraising/overview").then(r=>setFundOverview(r||null)).catch(()=>setFundOverview(null));
    loadGoal();
    loadDrift();
  },[]);

  // Queue + hero metrics are re-fetched whenever scope changes (including
  // the initial "mine"/"all" decision above) — one shared scope, not three
  // independently-toggled views that could disagree.
  useEffect(()=>{
    if(scope===undefined)return;
    setQueueLoading(true);
    apiFetch(`/dashboard/today?scope=${scope}`).then(r=>setQueueItems(r||[])).catch(()=>{}).finally(()=>setQueueLoading(false));
    apiFetch(`/metrics/stewardship-summary?scope=${scope}`).then(r=>setStewardMetrics(r)).catch(()=>{});
    apiFetch(`/dashboard/home?scope=${scope}`).then(r=>setHomeData(r)).catch(()=>{});

    // Breakdown data is fetched eagerly here (not lazily on click) so the
    // hero cards can show the top few donors driving each number inline —
    // "who" should never require a click just to discover. The full
    // MetricBreakdownPanel (opened via openDebtBreakdown/openRetentionBreakdown)
    // still reuses this same cached data for "see everything."
    setDebtBreakdown(null);
    setDebtBreakdownLoading(true);
    apiFetch(`/dashboard/stewardship-debt/breakdown?scope=${scope}`)
      .then(r=>setDebtBreakdown(r))
      .catch(()=>setDebtBreakdown({total:0,count:0,rows:[]}))
      .finally(()=>setDebtBreakdownLoading(false));

    setRetentionBreakdown(null);
    setRetentionBreakdownLoading(true);
    apiFetch(`/dashboard/retention/breakdown?scope=${scope}`)
      .then(r=>setRetentionBreakdown(r))
      .catch(()=>setRetentionBreakdown({retentionRate:null,sectorAverage:43,retained:0,prevYearCount:0,nonRetainedCount:0,rows:[]}))
      .finally(()=>setRetentionBreakdownLoading(false));
  },[scope]);

  // Guards against a pre-existing /dashboard/today quirk (task rows aren't
  // filtered by donor deleted_at) — if the donor isn't in the live donor
  // list anymore, don't show a queue row nothing can act on.
  const visibleQueue=queueItems
    .filter(item=>data.donors.some(d=>d.id===item.donorId))
    .slice(0,6);
  const milestoneCount=queueItems.filter(i=>i.action==="milestone").length;
  // D-1 (BUILD-45): an attention item with no resolvable donor (an orphaned
  // task) is never rendered as a dead link — its row main falls back to a
  // <span>. Surface the count in dev only so orphans don't hide silently.
  const orphanQueueCount=queueItems.filter(i=>!i.donorId||!data.donors.some(d=>d.id===i.donorId)).length;
  useEffect(()=>{
    if(import.meta.env.DEV&&orphanQueueCount>0)
      console.log(`[dashboard] Needs-attention: ${orphanQueueCount} item(s) with no resolvable donor (rendered non-navigable).`);
  },[orphanQueueCount]);

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
    if(item.action==="matching_gift")return onNavigate("donors",{selectDonorId:item.donorId});
    if(item.taskId)return completeTask(item);
    return onNavigate("donors",{logDonorId:item.donorId});
  };

  const actionLabel=(item)=>{
    if(item.action==="note")return busyDonorId===item.donorId?"Saving…":"Mark sent ✓";
    if(item.action==="milestone")return "Review draft →";
    if(item.action==="lapsed")return "Re-engage →";
    if(item.action==="recurring")return resentIds.has(item.donorId)?"Sent ✓":(busyDonorId===item.donorId?"Sending…":"Resend update link");
    if(item.action==="matching_gift")return "View donor →";
    if(item.taskId)return busyDonorId===item.donorId?"Saving…":"Mark done ✓";
    if(item.action==="thank")return "Log thank-you →";
    if(item.action==="email")return "Log email →";
    return "Log call →";
  };

  const ROW_COLOR={note:T.greenMid,milestone:T.gold,lapsed:T.terracotta,thank:T.green,email:T.greenDk,recurring:T.terracotta,matching_gift:T.green};
  const rowColor=(item)=>item.taskId?T.ink:(ROW_COLOR[item.action]||T.greenMid);

  const openSetGoal=()=>{
    const today=new Date();
    const in90=new Date(today);in90.setDate(in90.getDate()+90);
    setGoalForm({label:"",goalAmount:"",goalType:"total_raised",periodStart:today.toISOString().split("T")[0],periodEnd:in90.toISOString().split("T")[0]});
    setGoalModalMode("create");
    setShowSetGoal(true);
  };

  // Editing reuses the same POST /goals create flow — there's no PUT /goals
  // endpoint because there doesn't need to be: GET /goals/active always
  // returns the most-recently-created row whose period contains today, so
  // submitting a new overlapping goal here supersedes the current one
  // (see CLAUDE.md "fundraising_goals" — this is the documented, real
  // source of truth, not a second place goals live).
  const openEditGoal=()=>{
    if(!goal)return;
    setGoalForm({label:goal.label,goalAmount:String(goal.goalAmount),goalType:goal.goalType,periodStart:goal.periodStart,periodEnd:goal.periodEnd});
    setGoalModalMode("edit");
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

  // The "who" behind a hero number — a clickable name+detail pill that goes
  // straight to that donor's profile, so a metric never requires a click
  // just to find out who it's about (see CLAUDE.md "name the vague anxiety
  // as a number" — this is the follow-through half of that pattern).
  const DonorChip=({name,detail,onClick})=>(
    <button onClick={onClick} style={{display:"flex",alignItems:"baseline",gap:5,background:T.bg,border:"1px solid "+T.bg3,borderRadius:99,padding:"4px 10px",cursor:"pointer",fontSize:11,maxWidth:170}}>
      <span style={{fontWeight:700,color:T.ink,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{name}</span>
      {detail&&<span style={{color:T.ink3,whiteSpace:"nowrap",flexShrink:0}}>{detail}</span>}
    </button>
  );
  const MoreChip=({count,onClick})=>(
    <button onClick={onClick} style={{background:"transparent",border:"1px dashed "+T.bg3,borderRadius:99,padding:"4px 10px",cursor:"pointer",fontSize:11,fontWeight:700,color:T.greenDk,whiteSpace:"nowrap"}}>
      +{count} more →
    </button>
  );
  // Goal banner's right-hand column — real supporting stats (pace, days
  // left, recent activity) genuinely filling that width, not decoration.
  // Hero chips are drillable (attribution FIX, per the standing rule: every
  // aggregate drills into its source, and the destination must show the same
  // number the chip claimed). onClick routes through the ONE shared
  // interactive() treatment (dark variant — hover/cursor/focus ring/keyboard);
  // a chip with no destination (e.g. Time Left) stays visibly static.
  const GoalStat=({label,value,valueColor,sub,onClick})=>(
    <div {...interactive(onClick,{label:onClick?`Open ${label}`:undefined,dark:true})}
      style={{background:"rgba(255,255,255,0.04)",border:"1px solid #1a2e1f",borderRadius:10,padding:"8px 12px"}}>
      <div style={{fontSize:9,fontWeight:800,letterSpacing:"0.08em",textTransform:"uppercase",color:"#8fa896",marginBottom:3}}>{label}</div>
      <div style={{fontSize:14,fontWeight:700,color:valueColor||"#f0ede6",lineHeight:1.25}}>{value}</div>
      {sub&&<div style={{fontSize:11,color:"#8fa896",marginTop:2}}>{sub}</div>}
    </div>
  );

  // My Portfolio tile icons — a real path per stat (not a generic dot) so the
  // row reads as a designed panel rather than six plain numbers in a line.
  // No sparklines here: none of these six stats has a metric_snapshots
  // history (only stewardship_debt/first_touch_delay/recovery_rate do), and
  // this pattern deliberately never fabricates a trend where none exists.
  const STAT_PATHS={
    portfolio:<><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></>,
    visits:<><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/><path d="m9 16 2 2 4-4"/></>,
    moves:<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>,
    gifts:<><rect x="3" y="8" width="18" height="13" rx="1"/><path d="M12 8v13M3 12h18M12 8c-1.5-3-5-4-5-1.5S9.5 8 12 8s4.5-1 4.5-2.5S13.5 5 12 8Z"/></>,
    pipeline:<><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></>,
    lapsed:<><path d="M12 9v4M12 17h.01"/><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L14.71 3.86a2 2 0 0 0-3.42 0Z"/></>,
  };
  const StatIcon=({name,color})=>(
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{STAT_PATHS[name]}</svg>
  );

  const countsByStage=Object.fromEntries(stageCounts.map(s=>[s.stage,s]));

  // Above sector average reads positive (green); below reads as needing
  // attention (gold-tinted brown) — visually honest, not falsely encouraging,
  // while staying inside the brand palette (see CLAUDE.md's "name the vague
  // anxiety as a number" pattern).
  const retentionCurrent=stewardMetrics?.retentionRate?.current;
  const retentionSector=stewardMetrics?.retentionRate?.sectorAverage??43;
  // "Too early to measure" (QA_FRESH_ORG R2): a day-one org isn't 0% retained,
  // it just has nothing to measure yet — either no prior-year giving to compare
  // against (current==null), or prior-year history exists but no gift has been
  // logged in the current year at all (0% with thisYearCount===0). Neither is
  // a verdict on the org, so neither gets the below-sector-average framing.
  const retentionTooEarly=retentionCurrent==null||(retentionCurrent===0&&stewardMetrics?.retentionRate?.thisYearCount===0);
  const retentionColor=retentionTooEarly?T.ink:retentionCurrent>=retentionSector?T.greenMid:T.terracotta;

  // Goal banner: greeting is real (time-of-day + the logged-in user's own
  // `name` field from the DB — not a role label or placeholder; an empty
  // firstName just omits the ", Name" suffix rather than substituting
  // something generic. "Good evening, Admin" for the demo account is real
  // data — the seeded demo user's stored name is literally "Admin User" —
  // not a fallback bug). Pace is real math (% of the period elapsed vs. %
  // of the goal reached — not a fabricated "on track" claim), and the
  // driver hint is real trailing-7-day gift activity from the backend
  // (goal.recentAmount/recentDonorCount), never invented copy.
  const firstName=auth?.user?.name?.split(" ")[0]||"";
  // Greeting windows are the single source of truth in ../lib/greeting.js
  // (evening 5 PM–4 AM · morning 4 AM–noon · afternoon noon–5 PM) — a bare
  // `hour<12` used to say "Good morning" at 12:23 AM (BUILD-36 B3).
  const greeting=greetingForHour(new Date().getHours());
  let paceLabel=null,paceColor="#8fa896",paceSub=null,daysLeftInPeriod=null;
  if(goal){
    const periodStartDate=new Date(goal.periodStart+"T00:00:00");
    const periodEndDate=new Date(goal.periodEnd+"T00:00:00");
    const totalDays=Math.max(1,Math.round((periodEndDate-periodStartDate)/86400000));
    const elapsedDays=Math.min(totalDays,Math.max(0,Math.round((new Date()-periodStartDate)/86400000)));
    daysLeftInPeriod=Math.max(0,daysUntil(goal.periodEnd));
    if(elapsedDays<2){
      paceLabel="Just getting started";
      paceSub="too early in the period to gauge pace";
    }else{
      const expectedPercent=Math.round((elapsedDays/totalDays)*100);
      const paceDeltaPts=goal.percent-expectedPercent;
      if(paceDeltaPts>=8){paceLabel="Ahead of pace";paceColor=T.gold;paceSub=`${paceDeltaPts}pt ahead of schedule`;}
      else if(paceDeltaPts<=-8){paceLabel="Behind pace";paceColor=T.terracotta;paceSub=`${Math.abs(paceDeltaPts)}pt behind schedule`;}
      else{paceLabel="On pace";paceColor="#8fa896";paceSub=Math.abs(paceDeltaPts)>=1?`within ${Math.abs(paceDeltaPts)}pt of schedule`:"right on schedule";}
    }
  }
  // Trivially small vs. the goal (under 1%) reads as discouraging stated
  // baldly ("$1 raised") — lead with the human count instead in that case,
  // never fabricate a rounder/better number.
  const goalDriverHint=(()=>{
    if(!goal||!(goal.recentAmount>0))return null;
    const donorWord=`${goal.recentDonorCount} donor${goal.recentDonorCount!==1?"s":""}`;
    const isTrivial=goal.goalAmount>0&&(goal.recentAmount/goal.goalAmount)<0.01;
    if(isTrivial){
      return goal.goalType==="lapsed_recovery"?`${donorWord} came back this week`:`${donorWord} gave this week`;
    }
    // B3, tightened by BUILD-73 Part 3 — this figure is incoming giving toward
    // the win-back goal, NOT money any Steward workflow brought in, so it reads
    // "came in". The outcome-claim family is banned outright now, not merely
    // reserved; see tests/reserved-recovered.test.js.
    return `${fmtFull(goal.recentAmount)} came in from ${donorWord} this week`;
  })();

  // ── BUILD-21 Part 1 — typed/roll-up goal hero (reuses BUILD-16's model) ──
  // Active TOP-LEVEL goals only (a child's raised is already inside its parent's
  // roll-up — never double-count). The org roll-up header comes straight from
  // the same /fundraising/overview the Fundraising tab uses; nothing recomputed.
  const fgGoals=fundOverview?.goals||[];
  const fgRollup=fundOverview?.rollup||null;
  const activeTop=fgGoals.filter(g=>g.isTopLevel&&g.lifecycle!=="ended");
  const hasCampaignGoals=!!(fgRollup&&fgRollup.activeGoalCount>=1&&activeTop.length);
  // Category colors are LOCKED (task/BUILD-12): Annual=gold, Capital=green,
  // Project=terracotta — all T tokens, no raw hex.
  const CAT_META={annual:{label:"Annual",color:T.gold},capital:{label:"Capital",color:T.greenMid},project:{label:"Project",color:T.terracotta}};
  const catMeta=c=>CAT_META[c]||CAT_META.project;
  // Faithful to computeFundraisingPace's states — no invented "ahead".
  const paceText=s=>s==="met"?"Goal met":s==="on_track"?"On pace":s==="behind"?"Behind pace":"In progress";
  const catPaceColor=s=>s==="behind"?T.terracotta:s==="met"?T.gold:"#8fa896";
  // Exceeded-goal display rule: a beaten goal reads as a win, not a misleading
  // flat "100%". The big number shows the TRUE (uncapped) percent; the sub line
  // names the overage. The thermometer bar still uses the capped percent (a bar
  // can't be more than full). Only strictly-over goals get the "over" treatment.
  const goalHeadSub=(rawPct,over)=>rawPct>100?(over>0?`Goal met · ${fmtFull(over)} over`:"Goal met · exceeded"):"of goal reached";

  // BUILD-32 Part 3 — two LIVE figures for the hero's right-hand stack, added as
  // information (not decoration): this week's giving (a true Monday-based week
  // from /fundraising/overview) and money at risk (BUILD-73 Part 3, from
  // /impact). Both real, both move week to week — replacing the static "Active
  // Goals" count, which never changed week to week.
  const tw=fundOverview?.thisWeek||{raised:0,giftCount:0};
  // "This week" lands on Giving Summary filtered to the chip's EXACT
  // Monday-based week (tw.start/tw.end from the server) — same predicate both
  // sides, so the destination total equals the chip's number.
  const twStat={label:"This week",value:fmtFull(tw.raised||0),sub:`${tw.giftCount||0} gift${(tw.giftCount||0)===1?"":"s"} logged`,
    onClick:tw.start&&tw.end?()=>onNavigate("reports",{report:"giving-summary",from:tw.start,to:tw.end}):undefined};
  // BUILD-73 Part 3 — THE DEMO'S FIRST SCREEN. This chip used to read
  // "Re-engaged · $2M · 610 lapsed donors came back", which is a results claim
  // in everything but grammar: on the first screen a prospect sees, it reads as
  // money Steward brought in. It is now AT RISK — the lifetime giving of donors
  // who have gone quiet — which is the same file, described honestly, and the
  // same words the landing page uses.
  const atRiskAmt=impact?.atRiskAmount||0, quietCount=impact?.quietDonorCount||0;
  // "At risk" drills into the donors BEHIND the number (impact.atRiskDonors) via
  // the standard MetricBreakdownPanel — the panel shows the same amount + donor
  // count the chip claimed, each row linking to the donor profile.
  // BUILD-76 follow-up: never an em dash. "AT RISK —" is the worst possible
  // answer to the product's headline capability — a healthy file and a
  // broken import read identically. Words, always.
  const reengStat=atRiskAmt>0
    ? {label:"At risk",value:fmtFull(atRiskAmt),valueColor:T.gold,sub:`${quietCount.toLocaleString()} quiet donor${quietCount===1?"":"s"} · no gift in over ${quietPhrase(impact?.quietSinceDays)}`,onClick:()=>setReengBreakdownOpen(true)}
    : driftData&&driftData.counts.driftingHigh>0
      // Edge: a short-cadence drifter can exist before anyone crosses the
      // 180-day quiet line — never claim "no donors drifting" over them.
      ? {label:"At risk",value:fmtFull(driftData.atRiskAmount),valueColor:T.gold,sub:`${driftData.counts.driftingHigh} donor${driftData.counts.driftingHigh===1?"":"s"} past their own pattern`,onClick:()=>document.getElementById("dash-drifting")?.scrollIntoView({behavior:"smooth",block:"start"})}
      : {label:"At risk",value:"No donors drifting",sub:driftData?`${driftData.evaluated.toLocaleString()} giving pattern${driftData.evaluated===1?"":"s"} checked`:"checking giving patterns",onClick:()=>setReengBreakdownOpen(true)};

      /* Goal banner — restructured into a real two-column layout so its
          footprint matches its content across the card's full width,
          instead of stacking everything into a narrow left column and
          leaving the right two-thirds empty. Left: the percent-to-goal,
          the one number this card exists to show, still large and
          isolated. Right: 3 real supporting stats (pace, days left in the
          period, recent activity) genuinely filling that width — not
          decoration, and never fabricated. */
      /* BUILD-21 Part 1 — the typed/roll-up hero leads when the org runs goal'd
          campaigns; otherwise fall back to the single-goal banner (unchanged).
          Graceful: loading → skeleton; 0 goals → banner; 1 → that goal leads,
          no empty roll-up; many → roll-up header + typed breakdown. */
  // ── BUILD-34: hero context, hoisted from the old inline IIFE so the banner
  // and the per-goal breakdown grid can be two separately orderable sections.
  // Values are IDENTICAL to before — active TOP-LEVEL goals only, never
  // double-counted (see the BUILD-21 notes above).
  const heroCtx=hasCampaignGoals?(()=>{
    const period=fundOverview.period||{};
    const many=fgRollup.activeGoalCount>=2;
    const g0=activeTop[0];
    const raised=many?fgRollup.totalRaised:g0.rolledRaised;
    const goalAmt=many?fgRollup.totalGoal:g0.goalAmount;
    const pct=(many?fgRollup.percent:g0.rolledPercent)||0;
    // Uncapped truth for the headline number + overage (BUILD-21 exceeded-goal rule).
    const rawPct=(many?fgRollup.rawPercent:g0.rolledRawPercent)??pct;
    const overAmt=(many?fgRollup.over:g0.rolledOver)||0;
    const behindCount=activeTop.filter(g=>g.rolledPaceState==="behind").length;
    const heroPace=many?(behindCount>0?`${behindCount} behind pace`:"On pace"):paceText(g0.rolledPaceState);
    const heroPaceCol=many?(behindCount>0?T.terracotta:T.gold):catPaceColor(g0.rolledPaceState);
    const delta=period.delta||0;
    const deltaTxt=delta>0?`up ${fmtFull(delta)} vs last`:delta<0?`down ${fmtFull(Math.abs(delta))} vs last`:"level vs last";
    return {period,many,g0,raised,goalAmt,pct,rawPct,overAmt,heroPace,heroPaceCol,deltaTxt};
  })():null;
  const {period={},many,g0,raised,goalAmt,pct,rawPct,overAmt,heroPace,heroPaceCol,deltaTxt}=heroCtx||{};

  const heroSection=fundOverview===undefined?(
        <div className="dash-goal-banner" style={{background:`linear-gradient(135deg,${T.green950},${T.green800})`,border:"1px solid #1a2e1f",borderRadius:16,padding:"16px 22px",color:"#8fa896",fontSize:13,display:"flex",alignItems:"center",gap:8}}><Spin/>Loading goals…</div>
      ):heroCtx?(<>
          <div className="dash-goal-banner" style={{background:`linear-gradient(135deg,${T.green950},${T.green800})`,border:"1px solid #1a2e1f",borderRadius:16,padding:"16px 22px",color:"#f0ede6"}}>
            <div className="dash-goal-cols" style={{display:"flex",gap:32,flexWrap:"wrap"}}>
              {/* LEFT — the roll-up (or the single goal) */}
              <div style={{flex:"2 1 300px",minWidth:260}}>
                <div style={{fontSize:10,fontWeight:800,letterSpacing:"0.12em",textTransform:"uppercase",color:"#8fa896",marginBottom:4}}>{many?"Fundraising — All Active Goals":"Fundraising Goal"}</div>
                <div style={{fontSize:15,fontWeight:600,color:"#c9c2b4",marginBottom:10,maxWidth:440,display:"flex",alignItems:"center",gap:8}}>
                  <span>{many?`${fgRollup.activeGoalCount} goals toward ${fmtFull(goalAmt)}`:g0.name}</span>
                  {isAdmin&&(
                    <button onClick={e=>{e.stopPropagation();onNavigate("fundraising");}} title="Edit goals in Fundraising"
                      style={{background:"transparent",border:"none",padding:3,margin:0,cursor:"pointer",color:"#8fa896",display:"inline-flex",alignItems:"center",flexShrink:0}}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
                    </button>
                  )}
                </div>
                <div style={{display:"flex",alignItems:"baseline",gap:10,marginBottom:8}}>
                  <div style={{fontSize:44,fontWeight:400,fontFamily:"'DM Serif Display',Georgia,serif",color:T.gold,lineHeight:1}}>{rawPct}%</div>
                  <div style={{fontSize:13,fontWeight:600,color:rawPct>100?T.gold:"#8fa896"}}>{goalHeadSub(rawPct,overAmt)}</div>
                </div>
                <div style={{background:"#0a120c",borderRadius:99,height:9,overflow:"hidden",marginBottom:8}}>
                  <div style={{height:"100%",width:`${pct}%`,background:T.gold500,borderRadius:99,transition:"width 0.6s ease"}}/>
                </div>
                <div style={{fontSize:13,color:"#c9c2b4"}}><strong style={{fontSize:15,color:T.gold,fontFamily:"'DM Serif Display',serif",fontWeight:400}}>{fmtFull(raised)}</strong> of {fmtFull(goalAmt)}{many?` · ${fgRollup.activeGoalCount} active goals`:""}</div>
              </div>
              {/* RIGHT — real supporting stats. Pace + the FY comparison are kept;
                  this-week giving + money at risk are the two live
                  BUILD-32 figures (both move week to week). "Active Goals" (a
                  static count) was dropped — density here must be information. */}
              <div style={{flex:"1 1 260px",minWidth:230,display:"grid",gridTemplateColumns:"1fr 1fr",gap:"8px 18px",alignContent:"start"}}>
                <GoalStat label="Pace" value={heroPace} valueColor={heroPaceCol} sub={many?"across active goals":"vs the period elapsed"} onClick={()=>onNavigate("fundraising")}/>
                <GoalStat label={`This ${fundOverview.periodLabel||"period"}`} value={fmtFull(period.raised||0)} sub={deltaTxt} onClick={()=>onNavigate("reports",{report:"giving-summary",preset:"thisFY",yearMode:"fiscal"})}/>
                <GoalStat {...twStat}/>
                <GoalStat {...reengStat}/>
              </div>
            </div>
          </div>
        </>
      ):(
      <div className="dash-goal-banner" style={{background:`linear-gradient(135deg,${T.green950},${T.green800})`,border:"1px solid #1a2e1f",borderRadius:16,padding:"16px 22px",color:"#f0ede6"}}>
        {goal===undefined?(
          <div style={{display:"flex",alignItems:"center",gap:8,color:"#8fa896",fontSize:13}}><Spin/>Loading goal…</div>
        ):goal?(
          <>
            <div className="dash-goal-cols" style={{display:"flex",gap:32,flexWrap:"wrap"}}>
              {/* LEFT — primary */}
              <div style={{flex:"2 1 300px",minWidth:260}}>
                <div style={{fontSize:10,fontWeight:800,letterSpacing:"0.12em",textTransform:"uppercase",color:"#8fa896",marginBottom:4}}>Fundraising Goal</div>
                <div style={{fontSize:15,fontWeight:600,color:"#c9c2b4",marginBottom:10,maxWidth:420,display:"flex",alignItems:"center",gap:8}}>
                  <span>{goal.label}</span>
                  {isAdmin&&(
                    <button onClick={openEditGoal} disabled={isReadOnly} title={isReadOnly?"Reactivate your subscription to make changes.":"Edit goal"}
                      style={{background:"transparent",border:"none",padding:3,margin:0,cursor:isReadOnly?"not-allowed":"pointer",color:"#8fa896",opacity:isReadOnly?0.4:1,display:"inline-flex",alignItems:"center",flexShrink:0}}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
                    </button>
                  )}
                </div>

                <div style={{display:"flex",alignItems:"baseline",gap:10,marginBottom:8}}>
                  <div style={{fontSize:44,fontWeight:400,fontFamily:"'DM Serif Display',Georgia,serif",color:T.gold,lineHeight:1}}>{goal.rawPercent??goal.percent}%</div>
                  <div style={{fontSize:13,fontWeight:600,color:(goal.rawPercent??goal.percent)>100?T.gold:"#8fa896"}}>{goalHeadSub(goal.rawPercent??goal.percent,goal.over||0)}</div>
                </div>
                <div style={{background:"#0a120c",borderRadius:99,height:9,overflow:"hidden",marginBottom:8}}>
                  <div style={{height:"100%",width:`${goal.percent}%`,background:T.gold500,borderRadius:99,transition:"width 0.6s ease"}}/>
                </div>
                <div style={{fontSize:13,color:"#c9c2b4"}}><strong style={{fontSize:15,color:T.gold,fontFamily:"'DM Serif Display',serif",fontWeight:400}}>{fmtFull(goal.currentAmount)}</strong> of {fmtFull(goal.goalAmount)}</div>
              </div>

              {/* RIGHT — supporting stats. Pace + Time Left kept; this-week giving
                  + money at risk (BUILD-73 Part 3) are the two live added figures,
                  replacing the vaguer "recent momentum" text line. */}
              <div style={{flex:"1 1 260px",minWidth:230,display:"grid",gridTemplateColumns:"1fr 1fr",gap:"8px 18px",alignContent:"start"}}>
                <GoalStat label="Pace" value={paceLabel} valueColor={paceLabel==="Ahead of pace"?T.gold:paceLabel==="Behind pace"?T.terracotta:"#f0ede6"} sub={paceSub} onClick={()=>onNavigate("fundraising")}/>
                <GoalStat label="Time Left" value={daysLeftInPeriod!=null?`${daysLeftInPeriod} day${daysLeftInPeriod!==1?"s":""}`:"—"} sub="left to reach this goal"/>
                <GoalStat {...twStat}/>
                <GoalStat {...reengStat}/>
              </div>
            </div>
          </>
        ):(
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:12}}>
            <div>
              <div style={{fontSize:15,fontWeight:600,color:"#f0ede6",marginBottom:2}}>No goal set for this period.</div>
              <div style={{fontSize:12,color:"#8fa896"}}>Set a fundraising target to track progress here.</div>
            </div>
            {isAdmin&&<button onClick={openSetGoal} style={{background:T.gold,border:"none",borderRadius:10,padding:"9px 18px",color:T.ink,fontSize:13,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap"}}>Set a goal →</button>}
          </div>
        )}
      </div>
      );

  /* Top-level goal breakdown — umbrella (children nested) + standalone.
     Card count matches the header's top-level count; children live inside
     their umbrella, not as flat peers (display-consistency FIX). BUILD-34:
     its own orderable/hideable section, split from the hero banner. */
  const goalCardsSection=heroCtx&&(activeTop.length>=2||activeTop.some(g=>g.isOverarching))?(
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
                      ?<span style={{alignSelf:"flex-start",fontSize:9,fontWeight:800,letterSpacing:".08em",textTransform:"uppercase",color:T.ink2,background:T.bg2,padding:"3px 8px",borderRadius:99}}>Overarching</span>
                      :<span style={{alignSelf:"flex-start",fontSize:9,fontWeight:800,letterSpacing:".08em",textTransform:"uppercase",color:m.color,background:m.color+"1e",padding:"3px 8px",borderRadius:99}}>{m.label}</span>}
                    <span style={{fontSize:13.5,fontWeight:700,color:T.ink,lineHeight:1.25,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{g.name}</span>
                    <span style={{fontSize:12,color:T.ink3}}><b style={{color:T.ink,fontSize:14}}>{fmtFull(g.rolledRaised)}</b> of {fmtFull(g.goalAmount)}</span>
                    <div style={{background:T.bg2,borderRadius:99,height:7,overflow:"hidden"}}>
                      <div style={{height:"100%",width:`${gp}%`,background:over?T.gold:m.color,borderRadius:99,transition:"width 0.5s ease"}}/>
                    </div>
                    <span style={{fontSize:11,fontWeight:700,color:catPaceColor(g.rolledPaceState)}}>{paceText(g.rolledPaceState)}{g.rolledOver>0?` · ${fmtFull(g.rolledOver)} over`:""}</span>
                    {over&&(
                      <div style={{borderTop:"1px solid "+T.bg2,marginTop:2,paddingTop:7,display:"flex",flexDirection:"column",gap:5}}>
                        <span style={{fontSize:10,fontWeight:800,letterSpacing:".06em",textTransform:"uppercase",color:T.ink3}}>Rolls up {g.childCount} goal{g.childCount===1?"":"s"}</span>
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
  ):null;

      /* Scope toggle — controls the queue below AND the Retention Rate /
          Stewardship Debt cards together (one shared scope, not per-card
          toggles that could disagree). Hidden until my-stats resolves the
          initial default, so it never flashes the wrong state. BUILD-32 Part 4:
          also hidden unless 2+ officers have assigned donors — otherwise "My
          donors" and "Whole org" are the same list (a single-value picker). */
  const scopeToggle=scope!==undefined&&homeData?.multiOfficer?(
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
      ):null;

      /* ── Command center (BUILD-16 Part 1) ──────────────────────────────
          The four headers a fundraiser opens the app to see: Portfolio [Team],
          Tasks [Core], Need to Do [Core], Pipeline [Team]. Plan-graceful — a
          Core org sees Tasks + Need-to-do only (the goal banner above is its
          giving snapshot); Team adds Portfolio + Pipeline. First-touch-delay
          and stewardship-debt are demoted to the small "Signals" chips below —
          never headline cards. */
  const commandCenterSection=homeData?(()=>{
        const isTeam=homeData.tier==="team";
        const t=homeData.tasks||{overdue:0,today:0,upcoming:0,total:0};
        const needCount=visibleQueue.length;
        const scrollToQueue=()=>{document.getElementById("dash-needtodo")?.scrollIntoView({behavior:"smooth",block:"start"});};
        const cards=[];
        if(isTeam&&homeData.portfolio){
          const pc=homeData.portfolio;
          cards.push({key:"portfolio",label:"Portfolio",accent:pc.color||T.greenDk,value:pc.count,unit:"donors",
            sub:`${fmt(pc.value)} lifetime giving`,onClick:()=>onNavigate("pipeline",{scope:"mine"}),aria:"View your portfolio"});
        }
        cards.push({key:"tasks",label:"Tasks",accent:t.overdue>0?T.terracotta:T.gold,value:t.total,unit:t.total===1?"open task":"open tasks",
          sub:(<span>{t.overdue>0&&<b style={{color:T.terracotta}}>{t.overdue} overdue</b>}{t.overdue>0&&(t.today>0||t.upcoming>0)?" · ":""}{t.today>0&&<b style={{color:T.gold600}}>{t.today} today</b>}{t.today>0&&t.upcoming>0?" · ":""}{t.upcoming>0&&<span style={{color:T.greenMid}}>{t.upcoming} upcoming</span>}{t.total===0&&"All clear"}</span>),
          onClick:()=>onNavigate("tasks",{scope}),aria:"View tasks"});
        cards.push({key:"needtodo",label:"Need to Do",accent:needCount>0?T.terracotta:T.greenMid,value:needCount,unit:needCount===1?"needs you":"need you",
          sub:needCount>0?"gifts to thank, moves due, receipts & more":"you're all caught up",onClick:scrollToQueue,aria:"Jump to what needs your attention"});
        if(isTeam&&homeData.pipeline){
          const pl=homeData.pipeline;
          cards.push({key:"pipeline",label:"Pipeline",accent:T.greenDk,value:pl.total,unit:pl.total===1?"prospect":"prospects",
            sub:pl.forecastOpen>0?`${fmt(pl.forecastOpen)} in open asks`:`${fmt(pl.value)} lifetime`,onClick:()=>onNavigate("pipeline",{scope}),aria:"View pipeline board"});
        }
        // De-templated (BUILD-31 Part 5.2): no per-stat boxes / colored left
        // borders / shadows — the four stats read as TYPOGRAPHY separated by
        // whitespace, the accent carried by the NUMBER, not a decorative border.
        // Still clickable + keyboard-accessible via interactive() (hover wash +
        // gold focus ring). Hierarchy comes from type weight + space, not boxes.
        return(
          <div className="dash-cmd-grid" style={{display:"grid",gridTemplateColumns:`repeat(${cards.length},minmax(0,1fr))`,gap:6,margin:"2px 0"}}>
            {cards.map(c=>(
              <div key={c.key} {...interactive(c.onClick,{label:c.aria})}
                style={{padding:"10px 14px",borderRadius:10,display:"flex",flexDirection:"column",gap:3,minWidth:0}}>
                <span style={{fontSize:10,fontWeight:800,letterSpacing:"0.1em",textTransform:"uppercase",color:T.ink3}}>{c.label}</span>
                <span style={{display:"flex",alignItems:"baseline",gap:6}}>
                  <span style={{fontSize:32,fontWeight:800,fontFamily:"'DM Serif Display',serif",color:c.accent,lineHeight:1}}>{c.value}</span>
                  <span style={{fontSize:11,color:T.ink3}}>{c.unit}</span>
                </span>
                <span style={{fontSize:11.5,color:T.ink3,lineHeight:1.4,minHeight:16}}>{c.sub}</span>
              </div>
            ))}
          </div>
        );
      })():null;

  const myPortfolioSection=myStats?(
        // De-emphasized wrapper (BUILD-31 Part 5.3): no colored left-accent box —
        // the "MY PORTFOLIO" heading + spacing define the group. A neutral hairline
        // only, so it reads as a quiet section, not a decorated template card.
        <div style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:14,overflow:"hidden"}}>
          <button onClick={()=>setPortfolioOpen(v=>!v)} style={{width:"100%",background:"none",border:"none",padding:"10px 16px",display:"flex",alignItems:"center",justifyContent:"space-between",cursor:"pointer",color:T.ink}}>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <span style={{fontSize:9,fontWeight:800,letterSpacing:"0.1em",textTransform:"uppercase",color:T.greenDk,background:T.greenDk+"10",padding:"3px 8px",borderRadius:99}}>MY PORTFOLIO</span>
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
                      <span style={{fontSize:9,fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",color:m.warn?T.terracotta:T.greenDk}}>{m.label}</span>
                    </div>
                    <div style={{fontSize:20,fontWeight:800,color:m.warn?T.terracotta:T.ink,fontFamily:"'DM Serif Display',serif",lineHeight:1}}>{m.value}</div>
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
      ):null;

      /* Donor Retention Rate — the Home dashboard's primary hero metric.
          This is the number fundraisers already benchmark against (unlike
          Stewardship Debt's invented composite score, see the demoted strip
          below) — the nonprofit sector average line already lived in the
          onboarding drip email before this. */
  // BUILD-76 §2.2 — the lead stat is DOLLARS AT RISK FROM DRIFT, the same
  // sentence the landing page makes with the org's own file. Retention (the
  // pre-76 hero) is kept, demoted to the block below; the clever composites
  // stay demoted further as chips. At $0 drift the card keeps Retention as
  // hero — an honest zero is not a headline.
  const heroIsDrift=!!(driftData&&driftData.atRiskAmount>0&&driftData.counts.driftingHigh>0);
  const retentionSection=stewardMetrics?(
        <div style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:16,padding:"20px 24px",display:"flex",flexDirection:"column",gap:16}}>
          {heroIsDrift&&(
            <div onClick={()=>document.getElementById("dash-drifting")?.scrollIntoView({behavior:"smooth",block:"start"})}
              className="card-click" style={{cursor:"pointer",borderRadius:12,margin:-4,padding:4}}>
              <div style={{fontSize:10,fontWeight:800,letterSpacing:"0.1em",textTransform:"uppercase",color:T.ink3,marginBottom:6}}>At Risk From Drift</div>
              <div style={{display:"flex",alignItems:"baseline",gap:10,flexWrap:"wrap"}}>
                <div style={{fontSize:32,fontWeight:800,fontFamily:"'DM Serif Display',serif",color:T.ink,lineHeight:1}}>{fmtFull(driftData.atRiskAmount)}</div>
                <span style={{fontSize:13,fontWeight:700,color:T.gold600}}>{driftData.counts.driftingHigh} donor{driftData.counts.driftingHigh===1?"":"s"} drifting</span>
              </div>
              <div style={{fontSize:13,fontWeight:600,color:T.ink2,marginTop:6,lineHeight:1.4,maxWidth:400}}>
                Giving from donors quietly past their own pattern — each is on the Drifting list below, with the reason, while a call still works.
              </div>
            </div>
          )}
          {/* Donor Retention Rate — the pre-BUILD-76 hero metric, kept and
              demoted below the drift headline (it remains the number
              fundraisers benchmark against; the sector-average line already
              lived in the onboarding drip email). */}
          <div style={heroIsDrift?{borderTop:"1px solid "+T.bg3,paddingTop:14}:undefined}>
            <div onClick={openRetentionBreakdown} className="card-click" style={{display:"flex",flexWrap:"wrap",gap:20,alignItems:"center",cursor:"pointer",borderRadius:12,margin:-4,padding:4}}>
              <div style={{flex:"1 1 220px",minWidth:0}}>
                <div style={{fontSize:10,fontWeight:800,letterSpacing:"0.1em",textTransform:"uppercase",color:T.ink3,marginBottom:6}}>Donor Retention Rate</div>
                <div style={{display:"flex",alignItems:"baseline",gap:10,flexWrap:"wrap"}}>
                  <div style={{fontSize:heroIsDrift?22:32,fontWeight:800,fontFamily:"'DM Serif Display',serif",color:retentionColor,lineHeight:1}}>
                    {retentionTooEarly?"—":`${retentionCurrent}%`}
                  </div>
                  {!retentionTooEarly&&stewardMetrics.retentionRate.deltaVsTrendStart!=null&&(
                    <span style={{fontSize:13,fontWeight:700,color:stewardMetrics.retentionRate.deltaVsTrendStart===0?T.ink3:stewardMetrics.retentionRate.deltaVsTrendStart>0?"#1a6b4a":T.terracotta}}>
                      {stewardMetrics.retentionRate.deltaVsTrendStart===0
                        ?"No change vs 3 weeks ago"
                        :`${stewardMetrics.retentionRate.deltaVsTrendStart>0?"↑":"↓"} ${Math.abs(stewardMetrics.retentionRate.deltaVsTrendStart)}pt vs 3 weeks ago`}
                    </span>
                  )}
                </div>
                {/* Context line carries more of the weight here than the
                    numeral above it — a sentence about what the number means
                    for donor relationships, not a bare "vs. X%" field label. */}
                <div style={{fontSize:13,fontWeight:600,color:T.ink2,marginTop:6,lineHeight:1.4,maxWidth:360}}>
                  {/* A brand-new org gets an expectant "too early" line, never
                      the below-sector-average verdict (QA_FRESH_ORG R2) —
                      mirrors First-Touch Delay's day-one handling below. */}
                  {retentionTooEarly
                    ?!myStats?.orgHasGiftHistory
                      ?`Too early to measure — import your donors to start tracking. The typical nonprofit retains ${retentionSector}% of its donors year over year.`
                      :stewardMetrics.retentionRate.prevYearCount>0
                        ?`Too early to measure — as this year's gifts land, you'll see how many of last year's ${stewardMetrics.retentionRate.prevYearCount} donor${stewardMetrics.retentionRate.prevYearCount===1?"":"s"} stick with you.`
                        :`Too early to measure — you'll see this once there's a prior year of giving to compare against. The typical nonprofit retains ${retentionSector}%.`
                    :retentionCurrent>=retentionSector
                      ?`Donors are sticking with you — ${retentionCurrent-retentionSector}pt above the ${retentionSector}% nonprofit sector average.`
                      :`${retentionSector-retentionCurrent}pt below the ${retentionSector}% sector average — worth a closer look at who isn't renewing.`}
                </div>
              </div>
              {stewardMetrics.retentionRate.trend.length>=2&&(
                <Sparkline trend={stewardMetrics.retentionRate.trend} color={retentionColor} width={120} height={36}/>
              )}
            </div>
            {/* Who this number is actually about — top donors who gave last
                year but haven't renewed, right where the rate is, not one
                click away behind a generic link. */}
            {(retentionBreakdownLoading&&!retentionBreakdown)?(
              <div style={{fontSize:11,color:T.ink3,marginTop:10}}>Loading who's not renewing…</div>
            ):retentionBreakdown?.rows?.length>0&&(
              <div style={{display:"flex",flexWrap:"wrap",gap:6,marginTop:10}}>
                {retentionBreakdown.rows.slice(0,3).map(r=>(
                  <DonorChip key={r.donorId} name={r.donorName} detail={fmtFull(r.lastGiftAmount)} onClick={()=>onNavigate("donors",{selectDonorId:r.donorId})}/>
                ))}
                {retentionBreakdown.nonRetainedCount>3&&(
                  <MoreChip count={retentionBreakdown.nonRetainedCount-3} onClick={openRetentionBreakdown}/>
                )}
              </div>
            )}
          </div>

          {/* Signals (BUILD-16 Part 1) — First-Touch Delay and Stewardship
              Debt are demoted from headline sections to small clickable chips.
              They're clever composite metrics, not what a fundraiser opens the
              app to see (that's the command center above) — so they sit here as
              secondary signals that expand into their detail on click. */}
          <div style={{borderTop:"1px solid "+T.bg3,paddingTop:14,display:"flex",gap:8,flexWrap:"wrap"}}>
            <button onClick={()=>setFirstTouchOpen(v=>!v)}
              aria-expanded={firstTouchOpen} aria-label="First-touch delay detail"
              style={{display:"flex",alignItems:"baseline",gap:7,background:firstTouchOpen?T.bg2:T.bg,border:"1px solid "+T.bg3,borderRadius:99,padding:"7px 14px",cursor:"pointer"}}>
              <span style={{fontSize:11,fontWeight:700,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.05em"}}>First-touch delay</span>
              <span style={{fontSize:15,fontWeight:800,fontFamily:"'DM Serif Display',serif",color:T.ink}}>{stewardMetrics.firstTouchDelay.current!=null?`${stewardMetrics.firstTouchDelay.current}d`:"—"}</span>
              <span style={{fontSize:11,color:T.ink3}}>{firstTouchOpen?"▲":"▼"}</span>
            </button>
            <button onClick={openDebtBreakdown}
              aria-label="Stewardship debt detail"
              style={{display:"flex",alignItems:"baseline",gap:7,background:T.bg,border:"1px solid "+T.bg3,borderRadius:99,padding:"7px 14px",cursor:"pointer"}}>
              <span style={{fontSize:11,fontWeight:700,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.05em"}}>Stewardship debt</span>
              <span style={{fontSize:15,fontWeight:800,fontFamily:"'DM Serif Display',serif",color:T.ink}}>{stewardMetrics.stewardshipDebt.current.toLocaleString()}</span>
              {stewardMetrics.stewardshipDebt.deltaVsTrendStart!=null&&stewardMetrics.stewardshipDebt.deltaVsTrendStart!==0&&(
                <span style={{fontSize:11,fontWeight:700,color:stewardMetrics.stewardshipDebt.deltaVsTrendStart>0?T.terracotta:"#1a6b4a"}}>
                  {stewardMetrics.stewardshipDebt.deltaVsTrendStart>0?"↑":"↓"}{Math.abs(stewardMetrics.stewardshipDebt.deltaVsTrendStart).toLocaleString()}
                </span>
              )}
              <span style={{fontSize:11,color:T.greenDk,fontWeight:700}}>→</span>
            </button>
          </div>

          {/* First-touch delay — expands inline to its real detail: the average
              plus the newest donor(s) still waiting on a first personal touch. */}
          {firstTouchOpen&&(
            <div style={{borderTop:"1px dashed "+T.bg3,paddingTop:14}}>
              <div style={{fontSize:13,fontWeight:600,color:T.ink2,lineHeight:1.4,maxWidth:420}}>
                {stewardMetrics.firstTouchDelay.current==null && myStats?.orgHasGiftHistory && !myStats?.orgHasInteractions
                  ? "No outreach logged yet — that's normal right after import. Log your first call from a donor's profile to start tracking this."
                  : <>New donors wait <b>{stewardMetrics.firstTouchDelay.current!=null?`${stewardMetrics.firstTouchDelay.current} days`:"—"}</b> on average before hearing from you personally{stewardMetrics.firstTouchDelay.sampleSize?` — based on ${stewardMetrics.firstTouchDelay.sampleSize} donors`:""}.</>}
              </div>
              {stewardMetrics.firstTouchDelay.newestUntouched?.length>0&&(
                <div style={{display:"flex",flexWrap:"wrap",alignItems:"center",gap:6,marginTop:10}}>
                  {stewardMetrics.firstTouchDelay.newestUntouched.map(d=>(
                    <DonorChip key={d.donorId} name={d.donorName} detail={`waiting ${daysDiff(d.firstGiftDate)}d`} onClick={()=>onNavigate("donors",{selectDonorId:d.donorId})}/>
                  ))}
                  {stewardMetrics.firstTouchDelay.untouchedCount>stewardMetrics.firstTouchDelay.newestUntouched.length&&(
                    <span style={{fontSize:11,color:T.ink3}}>+{stewardMetrics.firstTouchDelay.untouchedCount-stewardMetrics.firstTouchDelay.newestUntouched.length} more waiting</span>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      ):null;

  // ── BUILD-76 Part 2 — the Drifting section, first in the work column ──────
  // The one thing the product is named for, above Needs Your Attention (not
  // beside it). Renders only when someone is actually drifting — a featured
  // section proudly reading zero is the mistake the old lapsed row made.
  // Each row: name · the reason in the donor's own pattern · the money.
  // "Done" opens ONE inline line (Part 4 — the log is a byproduct of clearing
  // the item, never a form); Skip is one keypress and is recorded as skipped.
  const driftRows=driftAllData?driftAllData.list:(driftData?.list||[]);
  const submitDriftDone=async(donorId,note)=>{
    if(driftBusy)return;
    setDriftBusy(true);
    try{
      await apiFetch(`/drift/${donorId}/done`,{method:"POST",body:JSON.stringify({note:note||""})});
      setDriftLineFor(null);setDriftLine("");
      await loadDrift();
    }catch{/* leave the row; nothing was recorded */}
    finally{setDriftBusy(false);}
  };
  // BUILD-76 follow-up: the section RENDERS EVEN AT ZERO, with an empty
  // state that shows its work — how many patterns were checked and who was
  // excluded and why. An absent section reads as a broken feature; a bare
  // zero is indistinguishable from a silently failed import. Both defects,
  // regardless of the data.
  const driftEmptyState=(()=>{
    if(!driftData)return null;
    const ex=driftData.excluded||{};
    const exParts=[
      ex.singleGift>0&&`${ex.singleGift.toLocaleString()} single-gift (no pattern yet)`,
      ex.activeRecurring>0&&`${ex.activeRecurring.toLocaleString()} on active recurring`,
      ex.deceased>0&&`${ex.deceased.toLocaleString()} deceased`,
      ex.doNotSolicit>0&&`${ex.doNotSolicit.toLocaleString()} do-not-solicit`,
      ex.openPledge>0&&`${ex.openPledge.toLocaleString()} on an open pledge`,
    ].filter(Boolean);
    if(driftData.evaluated===0)return{
      head:"No donors to evaluate yet.",
      body:"Steward watches every donor's own giving pattern here. Once donors and their gift history are in, anyone quietly past their pattern surfaces on this list — if you just imported and this still reads zero donors, the import didn't land.",
    };
    if(driftData.counts.driftingHigh>0&&driftRows.length===0)return{
      head:"Everyone drifting has been contacted.",
      body:`All ${driftData.counts.driftingHigh} drifting donor${driftData.counts.driftingHigh===1?"":"s"} had outreach logged in the last 30 days — they stay off this list while the conversation is fresh, and come back if no gift follows.`,
    };
    return{
      head:"No donors drifting.",
      body:`Checked ${driftData.evaluated.toLocaleString()} donor${driftData.evaluated===1?"":"s"}: `
        +`${(driftData.onPattern||0).toLocaleString()} giving on their own pattern`
        +(driftData.counts.lapsed>0?`, ${driftData.counts.lapsed.toLocaleString()} already lapsed`:"")
        +(exParts.length?`, and ${exParts.join(", ")} excluded from drift`:"")
        +". A gap in anyone's own rhythm will surface here.",
    };
  })();
  const driftSection=driftData?(
      <div id="dash-drifting" style={{...cardWrap,borderColor:driftRows.length>0?T.gold500+"55":T.bg3,scrollMarginTop:64}}>
        <div className="dash-cpad" style={{...cPad,borderBottom:"1px solid "+T.bg3,...sHdr}}>
          <span style={{display:"flex",alignItems:"center",gap:8}}>
            <span aria-hidden style={{color:T.gold500,fontSize:13,lineHeight:1}}>◉</span>
            <span style={sTitle}>Drifting</span>
            <span style={{fontSize:11.5,color:T.ink3}}>
              {driftData.counts.driftingHigh>0
                ?`${fmtFull(driftData.atRiskAmount)} at risk · ${driftData.counts.driftingHigh} donor${driftData.counts.driftingHigh===1?"":"s"} past their own pattern`
                :"watching every donor's own giving pattern"}
            </span>
          </span>
          {driftData.total>driftData.list.length&&!driftAllData&&(
            <button onClick={()=>apiFetch("/drift?all=1").then(r=>setDriftAllData(r)).catch(()=>{})} style={sLink}>
              See all {driftData.total} →
            </button>
          )}
          {driftAllData&&(
            <button onClick={()=>setDriftAllData(null)} style={sLink}>Show top {driftData.cap}</button>
          )}
        </div>
        {driftRows.length===0&&driftEmptyState&&(
          <div data-testid="drift-empty-state" style={{padding:"18px 20px"}}>
            <div style={{fontSize:13,fontWeight:700,color:T.ink}}>{driftEmptyState.head}</div>
            <div style={{fontSize:12,color:T.ink3,marginTop:5,lineHeight:1.55,maxWidth:560}}>{driftEmptyState.body}</div>
          </div>
        )}
        {driftRows.length>0&&(
        <ul className="attn-list" style={{listStyle:"none",margin:0,padding:0}}>
          {driftRows.map((r,i)=>{
            const lineOpen=driftLineFor===r.donorId;
            return(
              <li key={r.donorId} style={{borderBottom:i<driftRows.length-1?"1px solid "+T.bg3:"none",borderLeft:"3px solid "+T.gold500}}>
                <div style={{display:"flex",alignItems:"stretch"}}>
                  <a className="attn-row-main" href={`/donors/${r.donorId}`}
                    style={{flex:1,minWidth:0,display:"flex",alignItems:"flex-start",gap:14,padding:"13px 20px",textDecoration:"none",color:"inherit"}}
                    onClick={e=>{if(e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;e.preventDefault();onNavigate("donors",{selectDonorId:r.donorId});}}>
                    <div style={{width:38,height:38,borderRadius:"50%",background:T.gold100,display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,fontWeight:800,color:T.gold600,flexShrink:0}}>
                      {(r.donorName||"?")[0]}
                    </div>
                    <div style={{flex:1,minWidth:0}}>
                      <div className="attn-donor-name" style={{fontSize:13,fontWeight:700,color:T.ink}}>{r.donorName}</div>
                      <div style={{fontSize:12,color:T.ink2,marginTop:2,lineHeight:1.45}}>{r.reason}</div>
                    </div>
                    <div style={{fontSize:13.5,fontWeight:800,fontFamily:"'DM Serif Display',serif",color:T.ink,whiteSpace:"nowrap",paddingTop:2}}>{fmtFull(r.valueAtRisk)}</div>
                  </a>
                  {!lineOpen&&(
                    <div style={{display:"flex",alignItems:"center",padding:"8px 20px 8px 8px",flexShrink:0}}>
                      <button onClick={()=>{setDriftLineFor(r.donorId);setDriftLine("");}} disabled={isReadOnly}
                        title={isReadOnly?"Reactivate your subscription to make changes.":"Reached out? Mark it done"}
                        className="attn-row-action" style={{background:T.gold500,border:"none",borderRadius:8,padding:"8px 14px",color:T.ink,fontSize:12,fontWeight:700,cursor:isReadOnly?"not-allowed":"pointer",whiteSpace:"nowrap",opacity:isReadOnly?0.45:1}}>
                        Done
                      </button>
                    </div>
                  )}
                </div>
                {lineOpen&&(
                  <div style={{display:"flex",gap:8,alignItems:"center",padding:"0 20px 13px 72px"}}>
                    <input autoFocus value={driftLine} onChange={e=>setDriftLine(e.target.value)}
                      onKeyDown={e=>{if(e.key==="Enter")submitDriftDone(r.donorId,driftLine);if(e.key==="Escape")submitDriftDone(r.donorId,"");}}
                      placeholder="One line — what happened? (Enter saves · Esc skips)"
                      style={{flex:1,border:"1px solid "+T.bg3,borderRadius:8,padding:"8px 12px",fontSize:12.5,color:T.ink,background:T.bg,outline:"none"}}/>
                    <button onClick={()=>submitDriftDone(r.donorId,driftLine)} disabled={driftBusy}
                      style={{background:T.greenDk,border:"none",borderRadius:8,padding:"8px 14px",color:"#fff",fontSize:12,fontWeight:700,cursor:driftBusy?"wait":"pointer"}}>Save</button>
                    <button onClick={()=>submitDriftDone(r.donorId,"")} disabled={driftBusy}
                      style={{background:"transparent",border:"none",padding:"8px 4px",color:T.ink3,fontSize:12,fontWeight:700,cursor:driftBusy?"wait":"pointer"}}>Skip</button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        )}
      </div>
  ):null;

  // The two-column queue/briefing + funnel/grant/recurring grid — one section.
  const workSection=(
      <div className="dash-main-grid" style={{display:"grid",gridTemplateColumns:"minmax(0,1fr) 320px",gap:16,alignItems:"start"}}>
        {/* LEFT: the queue is the hero (the "Need to Do" command card scrolls here) */}
        <div style={{display:"flex",flexDirection:"column",gap:14}}>
          {driftSection}
          <div id="dash-needtodo" style={{...cardWrap,scrollMarginTop:64}}>
            <div className="dash-cpad" style={{...cPad,borderBottom:"1px solid "+T.bg3,...sHdr}}>
              <span style={{display:"flex",alignItems:"center",gap:8}}>
                <span style={sTitle}>Needs Your Attention</span>
                {scope==="mine"&&<span style={{fontSize:9,fontWeight:800,letterSpacing:"0.06em",textTransform:"uppercase",color:T.greenDk,background:T.greenDk+"10",padding:"2px 7px",borderRadius:99}}>Mine</span>}
              </span>
              {!queueLoading&&<span style={{fontSize:11,color:T.ink3}}>{visibleQueue.length} {visibleQueue.length===1?"item":"items"}</span>}
            </div>
            {queueLoading&&<div style={{...cPad}}><Spin/></div>}
            {!queueLoading&&visibleQueue.length===0&&<MiniEmpty icon="✓" text="You're all caught up — nothing needs attention right now."/>}
            {/* D-1 (BUILD-45): each row's left region is a REAL <a href="/donors/:id">
                (cmd/middle-click open the donor in a new tab), NOT an onClick div.
                The action button is a SIBLING of the anchor — never nested — so
                keyboard traversal and open-in-new-tab both work. Orphaned rows
                (no resolvable donor) render the main as a <span>, never a dead link. */}
            {!queueLoading&&visibleQueue.length>0&&(
              <ul className="attn-list" style={{listStyle:"none",margin:0,padding:0}}>
                {visibleQueue.map((item,i)=>{
                  const color=rowColor(item);
                  const busy=busyDonorId===item.donorId;
                  const href=item.donorId?`/donors/${item.donorId}`:null;
                  const mainInner=(
                    <>
                      <div style={{width:38,height:38,borderRadius:"50%",background:color+"22",display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,fontWeight:800,color,flexShrink:0}}>
                        {(item.donorName||"?")[0]}
                      </div>
                      <div style={{flex:1,minWidth:0}}>
                        <div className="attn-donor-name" style={{fontSize:13,fontWeight:700,color:T.ink}}>{item.donorName}</div>
                        {item.action==="note"&&Array.isArray(item.talkingPoints)?(
                          <ul style={{margin:"4px 0 0",padding:"0 0 0 16px",fontSize:12,color:T.ink3,lineHeight:1.5}}>
                            {item.talkingPoints.map((p,pi)=><li key={pi} style={{marginBottom:2}}>{p}</li>)}
                          </ul>
                        ):(
                          <div style={{fontSize:12,color:T.ink3,marginTop:2,lineHeight:1.4}}>{item.reason}</div>
                        )}
                      </div>
                    </>
                  );
                  const mainStyle={flex:1,minWidth:0,display:"flex",alignItems:"flex-start",gap:14,padding:"14px 20px",textDecoration:"none",color:"inherit"};
                  return(
                    <li key={item.donorId+"_"+item.action} className="attn-row" style={{
                      display:"flex",alignItems:"stretch",
                      borderBottom:i<visibleQueue.length-1?"1px solid "+T.bg3:"none",
                      borderLeft:"3px solid "+color,
                    }}>
                      {href?(
                        <a className="attn-row-main" href={href} style={mainStyle}
                          onClick={e=>{ if(e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return; e.preventDefault(); onNavigate("donors",{selectDonorId:item.donorId}); }}>
                          {mainInner}
                        </a>
                      ):(
                        <span className="attn-row-main" style={mainStyle}>{mainInner}</span>
                      )}
                      <div style={{display:"flex",alignItems:"center",padding:"8px 20px 8px 8px",flexShrink:0}}>
                        <button onClick={e=>{e.stopPropagation();handleQueueAction(item);}} disabled={busy||(item.taskId&&isReadOnly)}
                          title={item.taskId&&isReadOnly?"Reactivate your subscription to make changes.":undefined}
                          className="attn-row-action dash-queue-action" style={{
                            background:color,border:"none",borderRadius:8,padding:"8px 14px",color:"#fff",fontSize:12,fontWeight:700,
                            cursor:(busy||(item.taskId&&isReadOnly))?"not-allowed":"pointer",whiteSpace:"nowrap",
                            opacity:(busy||(item.taskId&&isReadOnly))?0.45:1,
                          }}>{actionLabel(item)}</button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
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
              <FunnelChart counts={countsByStage} onStageClick={s=>onNavigate("donors",{stageFilter:s})}
                drift={driftData&&driftData.counts.driftingHigh>0?{
                  count:driftData.counts.driftingHigh,
                  amount:driftData.atRiskAmount,
                  onClick:()=>document.getElementById("dash-drifting")?.scrollIntoView({behavior:"smooth",block:"start"}),
                }:null}/>
            </div>
          </div>

          <div onClick={nextGrant?()=>onNavigate("grants",{grantId:nextGrant.id}):undefined} className={nextGrant?"card-click":""} style={{...cardWrap,cursor:nextGrant?"pointer":"default"}}>
            <div className="dash-cpad" style={{...cPad,borderBottom:"1px solid "+T.bg3}}>
              <span style={sTitle}>Next Grant Deadline</span>
            </div>
            {!nextGrant&&<div style={{...cPad,fontSize:13,color:T.ink3,fontStyle:"italic"}}>No upcoming deadlines.</div>}
            {nextGrant&&(()=>{
              const d=daysUntil(nextGrant.deadline);
              const urgColor=d<14?T.terracotta:T.greenMid;
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
            <div style={{...cardWrap,borderColor:recurringHealth.atRiskCount>0?T.terracotta+"30":T.bg3}}>
              <div className="dash-cpad" style={{...cPad,borderBottom:"1px solid "+T.bg3}}>
                <span style={sTitle}>Recurring Gifts</span>
              </div>
              <div style={{padding:"14px 20px"}}>
                {recurringHealth.atRiskCount>0?(
                  <>
                    <div style={{fontSize:20,fontWeight:800,fontFamily:"'DM Serif Display',serif",color:T.terracotta,lineHeight:1}}>
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
  );

      /* Honest impact line (FIX) — quiet ROI stat, attributable amounts only.
          Sits at the foot of the home column, small and on-palette. */
  // Nothing-to-say guard mirrored from ImpactLine's own early return, so the
  // section reads as absent (not an empty edit-mode shell) when silent.
  const impactVisible=!!impact&&((impact.atRiskAmount||0)>0||(impact.recoveredAmount||0)>0||(impact.reengagedAmount||0)>0||(impact.watchingRecurringCount||0)>0||(impact.onlineGivingProcessed||0)>0);
  const impactSection=impactVisible?<ImpactLine impact={impact}/>:null;


  // NB: no `fade-in` on the dash-root below. `.fade-in`'s final keyframe retains
  // `transform: translateY(0)` (animation-fill-mode:both), which would make
  // dash-root the containing block for every position:fixed descendant —
  // dropping the set-goal modal (and any drill-down not portalled to body) at
  // the vertical middle of the whole tall page, below the fold (BUILD-22 Part 2).
  return(
    <div className="dash-root dash-bleed" style={{background:T.bgDeep,margin:"-20px -24px -28px -24px",padding:"20px 24px 28px 24px",display:"flex",flexDirection:"column",gap:16,minHeight:"calc(100vh - 92px)"}}>

      {/* Greeting lives on the page's own cream background, between the nav
          and the goal card — not inside the dark card, where it read as a
          stray line of card copy rather than a page-level welcome.
          BUILD-13: when the org has set branding, the greeting leads with the
          org's logo + name in their accent — the "this is OUR system" payoff
          the moment they finish onboarding. Falls back to the plain greeting. */}
      <div style={{display:"flex",alignItems:"center",gap:11,padding:"0 2px"}}>
        {data.org?.logo&&<img src={data.org.logo} alt={data.org.name} style={{height:34,maxWidth:120,objectFit:"contain",borderRadius:6}}/>}
        <div>
          {data.org?.name&&<div style={{fontSize:16,fontWeight:800,color:data.org?.brandAccent||T.ink,lineHeight:1.15,letterSpacing:"-0.01em"}}>{data.org.name}</div>}
          <div style={{fontSize:data.org?.name?12.5:15,fontWeight:data.org?.name?500:700,color:T.ink3}}>{greeting}{firstName?`, ${firstName}`:""}</div>
        </div>
        {/* BUILD-34 edit affordance — a quiet on-palette text button by the
            greeting, not a floating pencil. Done saves optimistically
            (rollback on error); Esc cancels; Reset restores the default. */}
        {layout!==undefined&&(
          <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:16,flexShrink:0}}>
            {editMode?(
              <>
                <button onClick={resetLayout} style={{background:"transparent",border:"none",padding:0,color:T.ink3,fontSize:12,fontWeight:700,cursor:"pointer"}}>Reset to default</button>
                <button onClick={cancelEdit} style={{background:"transparent",border:"none",padding:0,color:T.ink3,fontSize:12,fontWeight:700,cursor:"pointer"}}>Cancel</button>
                <button onClick={saveEdit} style={{background:"transparent",border:"none",padding:0,color:T.greenDk,fontSize:12,fontWeight:800,cursor:"pointer"}}>Done</button>
              </>
            ):(
              <button onClick={enterEdit} aria-label="Edit Home layout — reorder or hide sections"
                style={{background:"transparent",border:"none",padding:0,color:T.greenDk,fontSize:12,fontWeight:700,cursor:"pointer"}}>Edit</button>
            )}
          </div>
        )}
      </div>

      {/* BUILD-57 — Today / Recurring tabs. Recurring is the exceptions view:
          who needs a human this morning, and one button into the full
          Fundraising → Recurring Giving page. */}
      <SectionTabs tabs={[{id:"today",label:"Today"},{id:"recurring",label:"Recurring"}]}
        active={dashTab} onSelect={setDashTab} className="dash-tabbar"/>

      {dashTab==="recurring"&&<DashboardRecurring onNavigate={onNavigate}/>}

      {dashTab==="today"&&(<>
      {/* One-time gold moments (BUILD-08 Phase D) — the product's only
          celebration pattern, each fires once per org (localStorage-keyed
          inside GoldMoment). Goal completion keys on the goal id, so a NEW
          goal reaching 100% next quarter gets its own single moment. */}
      {goal&&goal.percent>=100&&(
        <GoldMoment moment={`goal100_${goal.id||goal.periodEnd||"current"}`}
          title={`You did it — ${goal.label}.`}
          line={`${fmtFull(goal.currentAmount)} raised against ${fmtFull(goal.goalAmount)}. Worth a minute of feeling good before the next one.`}/>
      )}
      {recurringHealth&&recurringHealth.recoveredThisMonth>0&&(
        <GoldMoment moment="first_recovery"
          title="A failed card was fixed."
          line="The gift resumed — money that, at most organizations, would have quietly disappeared. Steward will keep watching."/>
      )}

      {/* ── The section stack (BUILD-34) ─────────────────────────────────
          Renders from the per-user ordered [{id,visible}] config (see
          ../lib/homeLayout.js for the canonical list + stale-config merge).
          Sections with no data render nothing and aren't offered in edit
          mode; explicitly hidden ones collect in the tray below. Edit-mode
          chrome is absolutely positioned (outline + floating pill) so
          entering/leaving edit mode causes zero layout shift. */}
      {layout!==undefined&&(()=>{
        // BUILD-35: the setup card renders only while the org is genuinely
        // un-activated (and not explicitly hidden). On the completion
        // TRANSITION — complete now, but previously seen incomplete — it
        // renders one GoldMoment (self-gated once-per-org), then nothing,
        // forever. An always-been-complete org never sees any of it.
        const setupSection=(()=>{
          if(!setupStatus)return null;
          if(setupStatus.cardState==="hidden")return null;
          if(setupStatus.complete){
            if(!setupCelebrate)return null;
            return <GoldMoment moment="setup_complete" title="Steward is set up."
              line="Donors in, giving connected, automations watching. This card retires itself — everything it linked to lives in Settings."/>;
          }
          return <SetupChecklist status={setupStatus} onNavigate={onNavigate} isAdmin={isAdmin} onSetCardState={setSetupCardState}/>;
        })();
        const sections={hero:heroSection,setup:setupSection,goalCards:goalCardsSection,commandCenter:commandCenterSection,myPortfolio:myPortfolioSection,retention:retentionSection,work:workSection,impact:impactSection};
        const rendered=layout.filter(r=>r.visible&&sections[r.id]!=null);
        const firstScopedId=rendered.find(r=>SCOPED_SECTION_IDS.includes(r.id))?.id;
        const hiddenRows=layout.filter(r=>!r.visible);
        return(<>
          {rendered.map((row,idx)=>{
            const content=sections[row.id];
            const toggle=!editMode&&row.id===firstScopedId?scopeToggle:null;
            if(!editMode)return <Fragment key={row.id}>{toggle}{content}</Fragment>;
            const meta=sectionMeta(row.id);
            const dragging=dragSectionId===row.id;
            return(
              <div key={row.id} draggable
                onDragStart={e=>onSectionDragStart(e,row.id)}
                onDragEnd={onSectionDragEnd}
                onDragOver={e=>onSectionDragOver(e,row.id)}
                onDrop={onSectionDrop}
                style={{position:"relative",borderRadius:16,cursor:"grab",
                  outline:`1.5px dashed ${dragging?T.gold:T.bg3}`,outlineOffset:4,
                  boxShadow:dragging?T.shadowLg:"none",
                  transform:dragging&&!REDUCED_MOTION?"translateY(-2px)":"none",
                  transition:REDUCED_MOTION?"none":"box-shadow .15s ease,transform .15s ease"}}>
                <div style={{opacity:0.55,pointerEvents:"none"}} aria-hidden>{content}</div>
                <div style={{position:"absolute",top:8,right:8,display:"flex",gap:6,zIndex:5}}>
                  <button
                    onKeyDown={e=>{
                      if(e.key==="ArrowUp"){e.preventDefault();moveSection(row.id,-1);}
                      else if(e.key==="ArrowDown"){e.preventDefault();moveSection(row.id,1);}
                      else if(e.key==="Enter"){e.preventDefault();saveEdit();}
                    }}
                    aria-label={`Reorder ${meta?.label||row.id} — position ${idx+1} of ${rendered.length}. Arrow keys move it, Enter saves.`}
                    title="Drag, or focus and use arrow keys, to reorder"
                    style={{display:"flex",alignItems:"center",gap:6,background:T.white,border:"1px solid "+T.bg3,borderRadius:8,padding:"5px 10px",fontSize:12,fontWeight:700,color:T.ink2,cursor:"grab",boxShadow:T.shadow}}>
                    <span aria-hidden="true">{"⠿"}</span>{meta?.label||row.id}
                  </button>
                  {moveToTop(layout,row.id)!==layout&&(
                    <button onClick={()=>moveSectionToTop(row.id)}
                      aria-label={`Move ${meta?.label||row.id} to the top`}
                      title="Send this section to the top"
                      style={{display:"flex",alignItems:"center",gap:4,background:T.white,border:"1px solid "+T.bg3,borderRadius:8,padding:"5px 10px",fontSize:12,fontWeight:700,color:T.greenDk,cursor:"pointer",boxShadow:T.shadow}}>
                      <span aria-hidden="true">↑</span>Top
                    </button>
                  )}
                  {meta?.hideable===false?(
                    <span title="Home always shows the fundraising hero" style={{display:"flex",alignItems:"center",background:T.white,border:"1px solid "+T.bg3,borderRadius:8,padding:"5px 10px",fontSize:11,fontWeight:700,color:T.ink3,boxShadow:T.shadow}}>Always shown</span>
                  ):(
                    <button onClick={()=>setSectionVisible(row.id,false)}
                      aria-label={`Hide ${meta?.label||row.id}`}
                      style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:8,padding:"5px 10px",fontSize:12,fontWeight:700,color:T.terracotta,cursor:"pointer",boxShadow:T.shadow}}>Hide</button>
                  )}
                </div>
              </div>
            );
          })}
          {editMode&&(
            <span role="status" aria-live="polite" style={{position:"absolute",width:1,height:1,padding:0,margin:-1,overflow:"hidden",clip:"rect(0 0 0 0)",whiteSpace:"nowrap",border:0}}>{layoutLiveMsg}</span>
          )}
          {editMode&&hiddenRows.length>0&&(
            <div style={{background:T.bg,border:"1.5px dashed "+T.bg3,borderRadius:14,padding:"12px 16px"}}>
              <div style={{fontSize:10,fontWeight:800,letterSpacing:"0.1em",textTransform:"uppercase",color:T.ink3,marginBottom:8}}>Hidden — not shown on your Home</div>
              <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
                {hiddenRows.map(r=>{
                  const m=sectionMeta(r.id);
                  return(
                    <button key={r.id} onClick={()=>setSectionVisible(r.id,true)}
                      aria-label={`Show ${m?.label||r.id} again`}
                      style={{display:"inline-flex",alignItems:"baseline",gap:7,background:T.white,border:"1px solid "+T.bg3,borderRadius:99,padding:"6px 12px",fontSize:12,fontWeight:700,color:T.ink2,cursor:"pointer"}}>
                      {m?.label||r.id}<span style={{color:T.greenDk}}>Show</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </>);
      })()}
      {layoutError&&<div role="alert" style={{position:"fixed",bottom:20,left:"50%",transform:"translateX(-50%)",background:T.terracotta,color:"#fff",padding:"10px 16px",borderRadius:8,fontSize:13,fontWeight:600,zIndex:500,boxShadow:T.shadowLg,maxWidth:"90vw"}}>{layoutError}</div>}

      {/* Set-goal modal */}
      {showSetGoal&&(
        <div style={{position:"fixed",inset:0,background:"#0f1a12cc",backdropFilter:"blur(4px)",zIndex:300,display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
          <div className="fade-in" style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:18,width:"100%",maxWidth:420,padding:24,boxShadow:"0 4px 32px rgba(15,15,15,0.12)"}}>
            <div style={{fontSize:16,fontWeight:800,color:T.ink,marginBottom:16}}>{goalModalMode==="edit"?"Edit fundraising goal":"Set a fundraising goal"}</div>
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
              <button onClick={saveGoal} disabled={savingGoal||!goalForm.label.trim()||!goalForm.goalAmount} style={{flex:1,background:(savingGoal||!goalForm.label.trim()||!goalForm.goalAmount)?T.bg2:T.gold,border:"none",borderRadius:10,padding:"11px",color:T.ink,fontSize:14,fontWeight:700,cursor:(savingGoal||!goalForm.label.trim()||!goalForm.goalAmount)?"not-allowed":"pointer"}}>
                {savingGoal?"Saving…":goalModalMode==="edit"?"Save changes":"Set goal"}
              </button>
              <button onClick={()=>setShowSetGoal(false)} style={{background:T.bg,border:"none",borderRadius:10,padding:"11px 14px",color:T.ink3,fontSize:13,cursor:"pointer"}}>Cancel</button>
            </div>
          </div>
        </div>
      )}
      </>)}

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

      <MetricBreakdownPanel
        open={reengBreakdownOpen}
        onClose={()=>setReengBreakdownOpen(false)}
        title="Money at risk"
        explanation={`The lifetime giving of donors with no gift in over ${quietPhrase(impact?.quietSinceDays)} — the same going-quiet threshold the pipeline's move suggestions use. These donors are drifting, not yet lapsed, which is exactly when there is still something to do about it. This is your file's own history, not anything Steward did: it is the size of the problem, measured.`}
        loading={false}
        total={impact?.atRiskAmount!=null?fmtFull(impact.atRiskAmount):"—"}
        totalLabel="At risk"
        totalCount={impact?.quietDonorCount}
        rows={(impact?.atRiskDonors||[]).map(r=>({
          donorId:r.id,
          donorName:r.name,
          detail:r.lastGiftDate?`Last gave ${new Date(r.lastGiftDate).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})}`:"No gift date on file",
          value:fmtFull(r.amount),
        }))}
        onSelectDonor={goToDonorFromBreakdown}
      />

      <MetricBreakdownPanel
        open={portfolioBreakdown.open}
        onClose={closePortfolioBreakdown}
        title={PORTFOLIO_BREAKDOWNS[portfolioBreakdown.key]?.title||""}
        explanation={PORTFOLIO_BREAKDOWNS[portfolioBreakdown.key]?.explanation}
        loading={portfolioBreakdown.loading}
        total={portfolioBreakdown.data?.total!=null?"$"+portfolioBreakdown.data.total.toLocaleString():undefined}
        totalLabel="Total"
        totalCount={portfolioBreakdown.data?.count}
        rows={portfolioBreakdown.data?.rows||[]}
        onSelectDonor={goToDonorFromPortfolio}
      />
    </div>
  );
}
