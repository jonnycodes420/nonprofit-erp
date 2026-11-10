import { useState, useEffect, useMemo, useRef } from "react";
import { HomeMailLine } from "./MailTypes";   // SEND-GATE-2
import { apiFetch, adaptDonor, prefetch, takeParked } from "../api";
import { usePeopleById, peopleCounts } from "../lib/people";
import { useAuth } from "../main";
import { T, fmtFull, daysUntil, daysDiff, GoldMoment } from "./shared";
import { orgTodayPlus, orgTimezone } from "../lib/orgToday";
import { HOME_FIRST_READS, RAIL_READS, HOME_SCOPED_FIRST, homeScopeReads, initialScope } from "../lib/homeReads";   // HARDEN-2, PERF-2
import { isBirthdayOn, MONTHS as BIRTH_MONTHS } from "../../../shared/birthday.js";
import { mergeLayout, sectionMeta, isDefaultLayout, moveToTop } from "../lib/homeLayout";
// BUILD-86 C.2 — the NOTE. shared/homeNote.js replaces the Part A sentence,
// which read like a log line ("Chen is at day 7.").
import { rowFigure } from "../../../shared/threadFigures";
import { paceOf } from "../../../shared/pace";
import { makeT } from "../../../shared/vocabulary";
import { greetingForHour, hourIn } from "../lib/greeting";

import { errorMessage, rethrowProgrammerError } from "../lib/domainError";
import { useStewardTold } from "../lib/stewardTold";
import { useChanged } from "../lib/changes";   // STALE-1
import { MorningBrief } from "./MorningBrief";   // PERF-2: not the meeting forms
import { MailboxBanner } from "./MailboxBanner";   // PERF-2: not the inbox panels
import { displayDateShort } from "../../../shared/displayDate";
import { CallsToMake } from "./CallsToMake";
import * as FL from "./home/HomeFirstLook";   // SCREENS-1: Home's first look
import * as HL from "./home/HomeLater";   // SCREENS-1: the rest of Home, imported with it
import { PORTFOLIO_BREAKDOWNS, ImpactLine } from "./home/homeParts";
import { openTellSteward } from "./TellStewardOpen";   // AGENT-5: one input, Atlas over the page
import { SetupFirstCard, SetupRailCard, setupStage } from "./HomeSetup";   // HOME-4
import GettingSetUp, { useOnboarding } from "./onboarding/GettingSetUp";   // ONBOARD-2
import { HomeRailSkeleton, TodayCard, ToConfirmLine, useRailReads, HomeRailColumn, OwnersCard } from "./HomeRail";   // HOME-4, PROFILE-2
import { plural } from "../../../shared/countWords";
import { HOME_GRID_CSS } from "./home/homeGrid";   // HOME-6
import { useMovesGate, deckKnownEmpty } from "../lib/movesGate";   // FEEL-1; MOPUP-3

// ── Dashboard / Home ─────────────────────────────────────────────────────────
export function Dashboard({data,setData,onNavigate,isReadOnly=false,surface="home"}) {
  // SCALE-2: Home's first reads in one request. Asked during the first
  // render, before any effect (a child's effects run before this component's),
  // so every apiFetch below for one of these paths is handed the bundle's
  // answer. The list is exactly what Home and its panels read when it opens.
  useState(()=>{ if(surface==="home"){ prefetch(["/insights?view=deck"]); prefetch(RAIL_READS); prefetch([...HOME_FIRST_READS,...HOME_SCOPED_FIRST]); } return null; });   // HOME-4: the deck and the rail first, side by side
  const {auth}=useAuth();
  const isAdmin=auth?.user?.role==="admin";
  // BUILD-89 — which of the rail's two states is showing. `today` is the
  // resting state; a click pushes a list or one donor over it. Declared up
  // here with the other state because the THREAD ROWS read it to mark which
  // one is open in the rail, and they are built long before the rail is.
  const [railView,setRailView]=useState({kind:"today"});
  const todayStr=new Date().toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric"});
  // BUILD-89 — the header's one line. "Thursday, September 17" — the day, set
  // in serif, with the greeting small above it.
  const todayLongStr=new Date().toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric"});
  // BUILD-86 Part B — HER WORDS. One reader, from the org's stored vocabulary;
  // with nothing stored it returns today's strings, so this is a no-op for an
  // org that never answered the five questions.
  const t=useMemo(()=>makeT(data.org?.vocabulary),[data.org?.vocabulary]);
  // BUILD-86 Part B — the five questions, ONCE, after her file is in. Gated on
  // there being donors, because asking an empty org what it calls its people
  // is asking before there is anything to call. Skipping stamps the same
  // field, so it is offered once and never nags.
  const [wordsOpen,setWordsOpen]=useState(false);
  const [wordsDone,setWordsDone]=useState(false);
  // CLEAN-1: one quiet Thread item when the last import left more than ten
  // possible duplicates. It opens Donors, Data health; it changes nothing.
  const [dhNotice,setDhNotice]=useState(null);
  const [gsNotice,setGsNotice]=useState(null);   // PARITY-4 Part 2
  const [jsNotice,setJsNotice]=useState(null);   // AUTO-1: what Steward sends on its own next morning
  useEffect(()=>{
    if(surface!=="home")return;
    apiFetch("/data-health/notice").then(r=>setDhNotice(r.notice||null)).catch(()=>setDhNotice(null));
    apiFetch("/gift-starts/notice").then(r=>setGsNotice(r.notice||null)).catch(()=>setGsNotice(null));
    apiFetch("/journey-sends/notice").then(r=>setJsNotice(r.notice||null)).catch(()=>setJsNotice(null));
  },[surface]);
  // IT ASKS, IT DOES NOT WALL. The brief puts the five questions in the import
  // moment; this build does not touch the receipt, so Home offers them instead.
  // A MODAL here would be a wall in front of every existing org's Home on its
  // next login, and in front of anyone who just wanted to see their queue. One
  // quiet line, her choice, and it goes when she answers OR declines.
  // SCALE-2: "there are donors" is a server count, read only when the offer
  // could show at all, instead of the length of a whole-org list.
  const wordsMayOffer=surface==="home"&&isAdmin&&!wordsDone&&!!data.org&&!data.org.vocabularySetAt;
  const [peopleTotal,setPeopleTotal]=useState(null);
  useEffect(()=>{
    if(!wordsMayOffer||peopleTotal!=null)return;
    peopleCounts().then(c=>setPeopleTotal(c?.total||0)).catch(()=>{});
  },[wordsMayOffer,peopleTotal]);
  const wordsOffer=wordsMayOffer&&peopleTotal>0;

  // BUILD-57 — the dashboard area is two tabs: Today (the existing section
  // stack) and Recurring (EXCEPTIONS only — counts + a path into the
  // Fundraising → Recurring Giving page, never a second roster).
  // BUILD-77 Part 7 — the four recurring counts, for the ONE cross-link line
  // (the tab itself moved to Fundraising → Recurring Giving).
  const [recurringAttention,setRecurringAttention]=useState(0);
  // BUILD-81 §3.1 — the failed-card count leads the line when non-zero:
  // "3 cards stopped this month." A stopped card is money already moving
  // that quietly stopped; the rest of the exceptions ride behind it.
  const [recurringFailed,setRecurringFailed]=useState(0);
  // HOME-CALM — the stopped cards THEMSELVES, because on Home each one is a
  // row that names her. The route already returned donorName and lastFailedAt
  // for every one of them; only the count was being kept.
  const [failedCardList,setFailedCardList]=useState([]);
  useEffect(()=>{
    apiFetch("/recurring/exceptions").then(d=>{
      const c=d?.counts||{};
      setRecurringFailed(c.failedCards||0);
      setFailedCardList(Array.isArray(d?.failedCards)?d.failedCards:[]);
      setRecurringAttention((c.failedCards||0)+(c.aboutToLapse||0)+(c.pendingProposals||0)+(c.anniversaries||0));
    }).catch(()=>{});
  },[]);
  // LIVE-1 — the newest readout of the last seven days ("Your September
  // import: 4 lapsed donors came back"), one row on the Thread. A failure is
  // silence: a readout that will not load must never break the morning screen.
  const [latestReadout,setLatestReadout]=useState(null);
  useEffect(()=>{apiFetch("/readouts/latest").then(d=>setLatestReadout(d?.readout||null)).catch(()=>{});},[]);
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

  const [stageCounts,setStageCounts]=useState({counts:[],placed:[],suggested:[],anyPlaced:true});
  const [stewardMetrics,setStewardMetrics]=useState(null);
  const [recurringHealth,setRecurringHealth]=useState(null);
  // BUILD-88b B.3 — the thank-you queue.
  const [thankYous,setThankYous]=useState(null);
  const [tyOpen,setTyOpen]=useState(null);
  const [tyShowAll,setTyShowAll]=useState(false);
  const [tyCopied,setTyCopied]=useState(null);
  const [tyErr,setTyErr]=useState("");
  const loadThankYous=()=>apiFetch("/thank-yous").then(setThankYous).catch(()=>{});
  // Opening a draft is RECORDED, because "Mark all as sent" depends on it.
  const tyOpenDraft=(d)=>{
    setTyOpen(d.id); setTyErr("");
    if(!d.opened)apiFetch(`/thank-yous/${d.id}/opened`,{method:"POST"}).then(loadThankYous).catch(()=>{});
  };
  const tyCopy=async(d)=>{
    try{ await navigator.clipboard.writeText(d.body); setTyCopied(d.id); setTimeout(()=>setTyCopied(null),2500); }
    catch(e){ rethrowProgrammerError(e); setTyErr("Your browser would not let Steward reach the clipboard. Select the draft and copy it."); }
  };
  const tyAct=async(id,what)=>{
    setTyErr("");
    try{ await apiFetch(`/thank-yous/${id}/${what}`,{method:"POST"}); setTyOpen(null); await loadThankYous(); if(loadThreads)loadThreads(); }
    catch(e){ setTyErr(errorMessage(e,"That could not be saved.")); }
  };
  const tyMarkAll=async()=>{
    setTyErr("");
    try{ await apiFetch("/thank-yous/mark-all-sent",{method:"POST"}); await loadThankYous(); }
    catch(e){ setTyErr(errorMessage(e,"Those could not be marked sent.")); }
  };
  const [impact,setImpact]=useState(null);
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
  // FIX-10 Part A — the way IN to the medium ones. "See all" used to send
  // ?all=1, which only lifts the cap on the high-confidence list: on a file
  // with five medium drifters and no high ones there was no UI path to them
  // at all. includeMedium=1 is that path, and it is the ONLY fetch either
  // entry point uses, so the expanded list and the quiet line agree.
  const openEarlySigns=()=>{
    apiFetch(`/drift?all=1&includeMedium=1${driftQs(driftSort)?"&"+driftQs(driftSort):""}`).then(r=>{
      setDriftAllData(r);
      // React has to paint the rows before the section can be scrolled to.
      requestAnimationFrame(()=>document.getElementById("dash-drifting")?.scrollIntoView({behavior:"smooth",block:"start"}));
    }).catch(()=>{});
  };
  // FIX (2026-09-09) item 3 — the step this row is about to open is EDITABLE
  // FROM THE ROW, before it is saved. It used to be derived server-side and
  // never shown: a proposal nobody can see is a proposal nobody can correct.
  // ENGAGE-1 — the Drift list can be put in engagement order (closest first).
  const [driftSort,setDriftSort]=useState("");
  // HOME-TIDY: Home shows the first five drifting donors; the rest open in place.
  // HOME-COLLAPSE: the Thread shows five rows, the rest open in place; the
  // Thread and Drift lists each fold away, remembered in this browser only.
  const [threadExpanded,setThreadExpanded]=useState(false);
  const [homeFold,setHomeFold]=useState(()=>{try{return JSON.parse(localStorage.getItem("steward_home_fold")||"{}")||{};}catch{return {};}});
  const toggleFold=k=>setHomeFold(f=>{const n={...f,[k]:!f[k]};try{localStorage.setItem("steward_home_fold",JSON.stringify(n));}catch{/* kept for this visit only */}return n;});
  // HOME-TIDY 2: where the header goes depends on the width (one copy only).
  const foldBtn=HL.foldBtn({ homeFold, toggleFold });
  const [homeWide,setHomeWide]=useState(()=>typeof window==="undefined"||!window.matchMedia||window.matchMedia("(min-width:1100px)").matches);
  // FEEL-1: under the moves deck, a wide Home waits for the deck's size (lib/movesGate.js).
  // MOPUP-3: a phone holds what sits under the deck too, when the deck is known to be empty (lib/movesGate.js).
  const [phoneHold]=useState(()=>!homeWide&&deckKnownEmpty());
  const [movesSettled,onMovesSettled]=useMovesGate(homeWide||phoneHold);
  useEffect(()=>{
    if(typeof window==="undefined"||!window.matchMedia)return;
    const mq=window.matchMedia("(min-width:1100px)"); const on=()=>setHomeWide(mq.matches);
    mq.addEventListener?mq.addEventListener("change",on):mq.addListener(on);
    return()=>{mq.removeEventListener?mq.removeEventListener("change",on):mq.removeListener(on);};
  },[]);
  const driftQs=s=>s==="engagement"?"sort=engagement":"";
  const loadDrift=(s=driftSort)=>apiFetch(`/drift${driftQs(s)?"?"+driftQs(s):""}`).then(r=>{setDriftData(r);setDriftAllData(null);}).catch(()=>{});

  // BUILD-96 Part 2 — SAMPLE DATA, SAID ON THE SCREEN SHE READS.
  //
  // The banner at the top of every tab already says "53 sample donors are
  // loaded", and that is the compliance sentence: they are invented, they are
  // counted in nothing, Steward will not mail them.
  //
  // This is a different sentence for a different person. An org handed over
  // already provisioned — Allie's — is one where the invented people are not
  // something she loaded and has to clear; they are what was there when she
  // first signed in, under her own organisation's name. She does not need to
  // be told the numbers are fake twice. She needs to be told her real ones are
  // coming, and from whom.
  //
  // It reads the same route the banner and the clear both read, so the line
  // and the rows cannot disagree, and it disappears the moment they are gone.
  const [sampleStatus,setSampleStatus]=useState(null);
  useEffect(()=>{apiFetch("/org/sample-data-status").then(setSampleStatus).catch(()=>{});},[]);
  // TRANS-1 Part 5 — THE FIRST MORNING. The moment the first import commits,
  // Home is her own donors, and one line above them says so. The sentence is
  // built on the server (shared/movePlan.js) from what the move has actually
  // brought, so Home cannot claim "this is your file" before there is one.
  const [moveLine,setMoveLine]=useState(null);
  useEffect(()=>{apiFetch("/move").then(r=>setMoveLine((r&&r.move&&r.move.homeLine)||null)).catch(()=>{});},[]);

  // ── BUILD-81 — THE THREAD, the first section of the work column ──────────
  const [threadsData,setThreadsData]=useState(null);
  const [convoFor,setConvoFor]=useState(null); // {donor:{id,name}, thread} → the log-one-line modal
  // BUILD-85 — the queue is SCOPED and CAPPED. `mine` is the default because a
  // list that is everyone's is no one's; the server downgrades `all` for a
  // non-admin, so this param is a convenience, never the gate.
  const [threadScope,setThreadScope]=useState("mine");
  const [threadHealth,setThreadHealth]=useState(null);
  // BUILD-94 Part 3 — the sequence lines, server-built so Home and the
  // Communications list cannot say different things about the same sequence.
  const [seqLines,setSeqLines]=useState([]);
  useEffect(()=>{apiFetch("/sequences/home").then(r=>setSeqLines((r&&r.sequences)||[])).catch(()=>setSeqLines([]));},[]);
  // ── BUILD-97 Part 3 — THE AGENT ──────────────────────────────────────────
  // The daily line, and whatever she is telling it to do. Failures are silent
  // by design: the agent being unavailable must never blank her Home screen.
  const [agentDaily,setAgentDaily]=useState(null);
  // HOME-2 · what leads Home today for the person signed in (GET /home/lead):
  // the lead cards, the rail's order, and whether Why and What have anything
  // to say. Failures are silent: Home keeps its frame without it.
  // PERF-3: the boot has parked it, so Home draws with it from the first frame
  // (Ask's suggestions under the box came a frame later and pushed Home down).
  const [homeDay,setHomeDay]=useState(()=>surface==="home"?takeParked("/home/lead")||null:null);
  const homeDayIn=useRef(homeDay!=null);
  const loadHomeDay=()=>apiFetch("/home/lead").then(setHomeDay).catch(()=>setHomeDay(null));
  useEffect(()=>{if(surface!=="home")return;if(homeDayIn.current){homeDayIn.current=false;return;}loadHomeDay();},[surface]);
  const homeRail=(homeDay&&Array.isArray(homeDay.rail))?homeDay.rail:["thankClock","mailbox","meetings","firstThing","tiles"];
  const railAt=k=>{const i=homeRail.indexOf(k);return i<0?99:i;};
  const thankClockLow=railAt("thankClock")>railAt("tiles");
  // The meeting in the lead is drawn there in full; the rail lists it, not twice.
  const leadMeetingId=null;   // HOME-3: no lead card, so the rail shows every meeting
  const [agentText,setAgentText]=useState("");
  const loadAgentDaily=()=>apiFetch("/agent/daily-line")
    .then(setAgentDaily).catch(()=>setAgentDaily(null));
  useEffect(()=>{loadAgentDaily();},[]);
  // FIX-1 §A — Home keeps ONE LINE. The plan, the run and the confirm live in
  // Agent now, so her words are carried there and planned on arrival: one
  // place where a plan is read, run and undone, not two that can disagree.
  function agentAsk(){
    const text=agentText.trim();
    if(!text)return;
    openTellSteward(null,{text,send:true});   // AGENT-5: Atlas, over Home
  }
  const [planFor,setPlanFor]=useState(null);      // {donor} → the plan-a-follow-up modal
// TASKS-2 — Home's "Due today" is the Tasks Today count, from the one server
  // rule (GET /tasks/counts), and reloads whenever the Thread does.
  const [taskCounts,setTaskCounts]=useState(null);
  const loadTaskCounts=()=>apiFetch("/tasks/counts?scope=mine").then(setTaskCounts).catch(()=>setTaskCounts(c=>c||{failed:true}));
  // HOME-4: no mount effect of its own; loadThreads (on mount) asks for the counts once.
  const loadThreads=(sc=threadScope)=>{loadTaskCounts();return apiFetch(`/threads?scope=${sc}`).then(r=>setThreadsData(r)).catch(()=>setThreadsData(d=>d||{failed:true,bands:[],list:[]}));};
  // HOME-6: "40 follow-ups" opens all 40, not the Thread's first page of 12.
  const [railOpenAll,setRailOpenAll]=useState(null);
  useEffect(()=>{
    if(railView.kind!=="list"||railView.key!=="open"){setRailOpenAll(null);return;}
    let alive=true;
    apiFetch(`/threads?scope=${threadScope}&cap=200`).then(r=>{if(alive)setRailOpenAll(r&&r.list||null);}).catch(()=>{});
    return ()=>{alive=false;};
  },[railView.kind,railView.key,threadScope]);
  useEffect(()=>{apiFetch("/threads/health").then(setThreadHealth).catch(()=>{});},[]);
  useStewardTold(()=>{loadThreads();});   // VOICE-4: the Thread re-reads when Tell Steward acts

  // ── BUILD-35: activation checklist state ──────────────────────────────────
  const setupOrgId=(()=>{try{return JSON.parse(localStorage.getItem("npe_org")||"{}").id||"org";}catch{return "org";}})();
  // SHIFT-2: on Home the rail's bundle has usually parked the checklist by the
  // time Home draws; taken here, a new org's setup card (above Your moves) is
  // in the first frame. When it was not in, see setupWhere below.
  const [setupParked]=useState(()=>surface==="home"?takeParked("/org/setup-status"):undefined);
  const setupCelebrateFor=s=>{let seen=false,fired=false;try{seen=!!localStorage.getItem(`steward_setup_seen_${setupOrgId}`);fired=!!localStorage.getItem(`steward_gold_setup_complete_${setupOrgId}`);}catch{/* private mode */}return !!(s&&s.complete&&seen&&!fired);};
  const [setupStatus,setSetupStatus]=useState(()=>setupParked===undefined?null:setupParked);
  // Whether THIS load is the completion moment. Decided ONCE at fetch time —
  // GoldMoment stamps its once-ever localStorage flag on mount, so a render
  // gate that re-read the flag would kill the banner on the very next
  // re-render (it did, in the live drive).
  const [setupCelebrate,setSetupCelebrate]=useState(()=>setupParked!==undefined&&setupCelebrateFor(setupParked));
  // HOME-3: on Home the checklist is one line under the deck until she opens it.
  const [setupLoaded,setSetupLoaded]=useState(setupParked!==undefined);   // HOME-4: the rail waits for it
  useEffect(()=>{
    (setupParked!==undefined?Promise.resolve(setupParked):apiFetch("/org/setup-status")).then(s=>{
      const celebrate=setupCelebrateFor(s);
      // Remember this org was ever seen INCOMPLETE — it gates the completion
      // GoldMoment, so an org that was already fully set up before the card
      // existed never gets congratulated for it (don't nag, don't flatter).
      if(s&&!s.complete){try{localStorage.setItem(`steward_setup_seen_${setupOrgId}`,"1");}catch{/* private mode */}}
      if(celebrate)setSetupCelebrate(true);
      setSetupStatus(s);
    }).catch(()=>{}).finally(()=>setSetupLoaded(true)); // offline/error → no card, Home unaffected
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
    setLayoutLiveMsg(`${sectionMeta(id)?.label||id} moved to top, position ${vis.findIndex(r=>r.id===id)+1} of ${vis.length}`);
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
      setLayoutError(errorMessage(e, "Couldn't save your Home layout, your changes were undone."));
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
      .catch(()=>setRetentionBreakdown({retentionRate:null,retained:0,prevYearCount:0,nonRetainedCount:0,rows:[]}))
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
      setScope(prev=>prev!==undefined?prev:initialScope(r));
    }).catch(()=>{setMyStats(null);setScope(prev=>prev!==undefined?prev:initialScope(null));});
    apiFetch("/donors/stage-counts").then(r=>setStageCounts(r&&r.counts?r:{counts:Array.isArray(r)?r:[],placed:[],suggested:[],anyPlaced:true})).catch(()=>{});
    apiFetch("/recurring/health").then(r=>setRecurringHealth(r)).catch(()=>setRecurringHealth(h=>h||{failed:true,atRisk:[]}));
    apiFetch("/impact").then(r=>setImpact(r)).catch(()=>{});
    apiFetch("/fundraising/overview").then(r=>setFundOverview(r||null)).catch(()=>setFundOverview(null));
    loadGoal();
    loadDrift();
    loadThreads();
  },[]);
  // STALE-1: a gift, pledge or payment made anywhere moves Home's money figures,
  // and a task or a conversation moves the Thread and its counts; each is read
  // again behind the screen, and nothing else is (lib/changes.js).
  useChanged(["gift","pledge","totals"],()=>{
    apiFetch("/dashboard/my-stats").then(r=>setMyStats(r||null)).catch(()=>{});
    apiFetch("/fundraising/overview").then(r=>setFundOverview(r||null)).catch(()=>{});
    loadGoal();
    if(surface==="home")loadHomeDay();
  });
  useChanged(["task","note"],c=>{if(c.source!=="told")loadThreads();});
  // COMMS-1: a draft dismissed or restored anywhere moves "N drafts are waiting for you" and the thank-yous at once.
  useChanged(["draft"],()=>{loadAgentDaily();loadThankYous();});

  // Queue + hero metrics are re-fetched whenever scope changes (including
  // the initial "mine"/"all" decision above) — one shared scope, not three
  // independently-toggled views that could disagree.
  useEffect(()=>{
    if(scope===undefined)return;
    // SCALE-2: the second wave, once the scope is known: one request.
    if(surface==="home") prefetch(homeScopeReads(scope));
    setQueueLoading(true);
    apiFetch(`/dashboard/today?scope=${scope}`).then(r=>setQueueItems(r||[])).catch(()=>{}).finally(()=>setQueueLoading(false));
    apiFetch(`/metrics/stewardship-summary?scope=${scope}`).then(r=>setStewardMetrics(r)).catch(()=>{});
    apiFetch(`/dashboard/home?scope=${scope}`).then(r=>setHomeData(r)).catch(()=>{});
    loadThankYous();

    // Breakdown data is fetched eagerly here (not lazily on click) so the
    // hero cards can show the top few donors driving each number inline —
    // "who" should never require a click just to discover. The full
    // MetricBreakdownPanel (opened via openDebtBreakdown/openRetentionBreakdown)
    // still reuses this same cached data for "see everything."
    // HOME-4: the two breakdowns feed the board's hero cards; on Home they
    // are read when a panel opens (openDebtBreakdown / openRetentionBreakdown),
    // never on arrival over a phone's network.
    setDebtBreakdown(null);
    setRetentionBreakdown(null);
    if(surface==="home")return;
    setDebtBreakdownLoading(true);
    apiFetch(`/dashboard/stewardship-debt/breakdown?scope=${scope}`)
      .then(r=>setDebtBreakdown(r))
      .catch(()=>setDebtBreakdown({total:0,count:0,rows:[]}))
      .finally(()=>setDebtBreakdownLoading(false));

    setRetentionBreakdownLoading(true);
    apiFetch(`/dashboard/retention/breakdown?scope=${scope}`)
      .then(r=>setRetentionBreakdown(r))
      .catch(()=>setRetentionBreakdown({retentionRate:null,retained:0,prevYearCount:0,nonRetainedCount:0,rows:[]}))
      .finally(()=>setRetentionBreakdownLoading(false));
  },[scope]);

  // Guards against a pre-existing /dashboard/today quirk (task rows aren't
  // filtered by donor deleted_at) — if the donor isn't in the live donor
  // list anymore, don't show a queue row nothing can act on.
  // SCALE-2: "still in the live list" is asked of the server for just these
  // ids. Until it answers the queue shows nothing, as it did while loading;
  // if the read fails (null) nobody is hidden for it.
  // The server marks each row onFile (GET /dashboard/today); the by-id
  // lookup is only for an answer that does not carry the mark.
  const queueMarked=queueItems.every(i=>typeof i.onFile==="boolean");
  const [queuePeople,queuePeopleReady]=usePeopleById(queueMarked?[]:queueItems.map(i=>i.donorId));
  const queueLive=item=>queueMarked?item.onFile:(!!item.donorId&&(queuePeople===null||!!queuePeople[item.donorId]));
  // D-1 (BUILD-45): an attention item with no resolvable donor (an orphaned
  // task) is never rendered as a dead link — its row main falls back to a
  // <span>. Surface the count in dev only so orphans don't hide silently.
  const orphanQueueCount=!queuePeopleReady?0:queueItems.filter(i=>!queueLive(i)).length;
  useEffect(()=>{
    if(import.meta.env.DEV&&orphanQueueCount>0)
      console.log(`[dashboard] Needs-attention: ${orphanQueueCount} item(s) with no resolvable donor (rendered non-navigable).`);
  },[orphanQueueCount]);

  const nextGrant=[...data.grants]
    .filter(g=>g.status!=="closed"&&g.deadline&&daysUntil(g.deadline)>=-7)
    .sort((a,b)=>new Date(a.deadline)-new Date(b.deadline))[0]||null;

  // Resending doesn't resolve the failure (only the donor updating their
  // card, or Stripe's own retry, does that) — so unlike the other queue
  // actions, the row stays put; we just confirm the send.


  const openSetGoal=()=>{
    setGoalForm({label:"",goalAmount:"",goalType:"total_raised",periodStart:orgTodayPlus(0),periodEnd:orgTodayPlus(90)});
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
    }catch(e){alert(errorMessage(e, "Could not save goal"));}
    setSavingGoal(false);
  };


  // BUILD-89 — declared HERE, above every style that reads it. It sat twenty
  // lines below sHdrPad and the whole screen rendered its error boundary:
  // "Cannot access 'onPanel' before initialization". Same class as BUILD-84's
  // TDZ, and the same lesson — a const is only in scope AFTER its line.
  const onPanel=surface==="home";
  const sHdr={display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:16,marginBottom:0};
  // BUILD-88d — 16px below a section header, and the hairline under it is the
  // card's own. Spread AFTER cPad at every header.
  const sHdrPad=onPanel?{paddingBottom:16}:{paddingBottom:16,borderBottom:"1px solid "+T.bg2};
  const sTitle={fontSize:10,fontWeight:700,color:T.ink3};
  // BUILD-87 F.3.2 — A SECTION TITLE IS A PLAIN SERIF WORD WITH THE BRASS
  // UNDERLINE the page titles already use ("Your fundraising."). The ProductMark
  // pills are gone from Home: a badge introduces a product to someone who has
  // not met it, and she opens this screen every morning. The pill is still the
  // right thing on the landing page, which is where it stays.
  // BUILD-88d — 18px, and the brass underline stays. A section title at 21px
  // competed with the headline; at 18 it labels the card it sits in.
  // HOME-CALM — THE BRASS UNDERLINE IS DECORATION, AND IT IS THE LOUDEST
  // thing on a screen somebody opens at 7:40: a gold rule under every section
  // heading, drawing the eye to the NAME of a list rather than to anything in
  // it. It comes off Home. The Dashboard is the board's screen, read once a
  // month by somebody who wants the sections marked off, and keeps it.
  const sSerif={fontFamily:"'DM Serif Display',Georgia,serif",fontSize:18,fontWeight:400,letterSpacing:"-0.01em",color:T.ink,lineHeight:1.25,
                ...(surface==="home"?{}:{borderBottom:"3px solid "+T.gold500,paddingBottom:2})};
  const sLink={background:"transparent",border:"none",padding:0,color:T.greenDk,fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit"};   // SWEEP-1: the page's type, not the system's
  // BUILD-88d — the hairline is bg2 (#e8e4db), the radius is 12, and nothing
  // on this page casts a shadow. bg3 (#d4cfc6) drew a card's edge harder than
  // its own contents.
  // BUILD-89 — INSIDE THE PANEL, A CARD HAS NO EDGE OF ITS OWN. The panel is
  // the surface; a block is separated from the one above it by air and a rule
  // (.home-block). The board keeps real cards — it is a grid of numbers.
  const cardWrap=onPanel
    ?{background:"transparent",border:"none",borderRadius:0}
    :{background:T.white,border:"1px solid "+T.bg2,borderRadius:12,overflow:"hidden"};
  // BUILD-87 F.3.6 — 32px of horizontal padding on every card, and the row
  // padding matches it so a list's left edge lines up with its own header.
  // Vertical stays tighter than 32 on rows: a 32px gap above and below each
  // name would turn a twelve-row queue into a scroll.
  // BUILD-88d — 24px of padding, on both axes. 32 was a desktop measure that
  // left a two-column card 24px narrower than it needed to be on each side.
  const cPad=onPanel?{padding:0}:{padding:24};
  // A row is 64px tall: 10px of air above and below two lines of type.
  const inp={width:"100%",boxSizing:"border-box",background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"9px 12px",color:T.ink,fontSize:13,outline:"none",marginBottom:10};


  const Sparkline=HL.Sparkline();

  // The "who" behind a hero number — a clickable name+detail pill that goes
  // straight to that donor's profile, so a metric never requires a click
  // just to find out who it's about (see CLAUDE.md "name the vague anxiety
  // as a number" — this is the follow-through half of that pattern).
  // BUILD-98 — a chip that names a person carries that person's face. `id` is
  // optional so a caller with only a name still renders (initials), rather
  // than the chip disappearing because a payload forgot to include an id.
  // FIX-13 Part 6 — with an id the chip is a real link to the donor.
  const DonorChip=HL.DonorChip();
  const MoreChip=HL.MoreChip();
  // Goal banner's right-hand column — real supporting stats (pace, days
  // left, recent activity) genuinely filling that width, not decoration.
  // Hero chips are drillable (attribution FIX, per the standing rule: every
  // aggregate drills into its source, and the destination must show the same
  // number the chip claimed). onClick routes through the ONE shared
  // interactive() treatment (dark variant — hover/cursor/focus ring/keyboard);
  // a chip with no destination (e.g. Time Left) stays visibly static.
  const GoalStat=HL.GoalStat();

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
  const StatIcon=HL.StatIcon({ STAT_PATHS });

  // BUILD-83 Part 3.5 — the funnel shows PLACED donors; with nobody placed it
  // shows the suggestion and says so.
  const countsByStage=Object.fromEntries((stageCounts.counts||[]).map(s=>[s.stage,s]));

  // Above sector average reads positive (green); below reads as needing
  // attention (gold-tinted brown) — visually honest, not falsely encouraging,
  // while staying inside the brand palette (see CLAUDE.md's "name the vague
  // anxiety as a number" pattern).
  const retentionCurrent=stewardMetrics?.retentionRate?.current;
  // BUILD-80 Part 9 — the sector comparison is gone (BUILD-73's ban): the
  // tile reports the rate, the window and the denominator, nothing else.
  // "Too early to measure" (QA_FRESH_ORG R2): a day-one org isn't 0% retained,
  // it just has nothing to measure yet — either no prior-year giving to compare
  // against (current==null), or prior-year history exists but no gift has been
  // logged in the current year at all (0% with thisYearCount===0). Neither is
  // a verdict on the org, so neither gets the below-sector-average framing.
  const retentionTooEarly=retentionCurrent==null||(retentionCurrent===0&&stewardMetrics?.retentionRate?.thisYearCount===0);
  // BUILD-76 follow-up — THE CONFIDENCE FLOOR (server-decided, RETENTION_FLOOR
  // in server.js): a rate on too few prior-year donors or too little history
  // reads "not enough history yet" and drops the sector comparison entirely.
  // "100% · 57pt above the sector average" on 16 donors is arithmetically
  // true and reads as fake — and then everything else on the screen does too.
  const retentionThin=!retentionTooEarly&&!!stewardMetrics?.retentionRate?.thinData;
  const retentionColor=T.ink;

  // Goal banner: greeting is real (time-of-day + the logged-in user's own
  // `name` field from the DB — not a role label or placeholder; an empty
  // firstName just omits the ", Name" suffix rather than substituting
  // something generic. (This note used to say the demo account's stored name
  // was literally "Admin User"; since BUILD-86 C.3 it is a real name, and
  // BUILD-87 F.3.7 made the seed correct the org that already existed.)
  // Pace is real math (% of the period elapsed vs. %
  // of the goal reached — not a fabricated "on track" claim), and the
  // driver hint is real trailing-7-day gift activity from the backend
  // (goal.recentAmount/recentDonorCount), never invented copy.
  const firstName=auth?.user?.name?.split(" ")[0]||"";
  // Greeting windows are the single source of truth in ../lib/greeting.js
  // (BUILD-36 B3). POLISH-8: the ORG's hour, not the browser's, and the night
  // (10 PM–5 AM) is just "Hi" (HomeFirstLook says "Hi Mike", no comma).
  const greeting=greetingForHour(hourIn(orgTimezone()));
  let paceLabel=null,paceColor="rgba(240,237,230,0.7)",paceSub=null,daysLeftInPeriod=null;
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
      // FIX-7 Part 5 — the SAME function the campaign thermometer uses
      // (shared/pace.js). This block used to carry its own 8-point band and
      // its own wording, so Home and Fundraising could describe one number
      // two ways. The sub-line is now the reason, not a restatement.
      const p=paceOf({raised:goal.currentAmount,goal:goal.goalAmount,
                      start:goal.periodStart,end:goal.periodEnd,
                      today:orgTodayPlus(0)});
      if(!p){paceLabel=null;paceSub=null;}
      else{
        paceLabel=p.label;
        paceSub=p.sentence;
        paceColor=p.state==="ahead"?T.gold:p.state==="behind"?T.terracotta:"rgba(240,237,230,0.7)";
      }
    }
  }
  // Trivially small vs. the goal (under 1%) reads as discouraging stated
  // baldly ("$1 raised") — lead with the human count instead in that case,
  // never fabricate a rounder/better number.

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
  // FIX-7 Part 5 — the four states shared/pace.js actually returns, in its
  // words. "Ahead" is no longer invented here; it is one of the three.
  const paceText=s=>s==="met"?"Goal met":s==="ahead"?"Ahead":s==="on_track"?"On pace":s==="behind"?"Behind":"In progress";
  const catPaceColor=s=>s==="behind"?T.terracotta:s==="met"?T.gold:"rgba(240,237,230,0.7)";
  // Exceeded-goal display rule: a beaten goal reads as a win, not a misleading
  // flat "100%". The big number shows the TRUE (uncapped) percent; the sub line
  // names the overage. The thermometer bar still uses the capped percent (a bar
  // can't be more than full). Only strictly-over goals get the "over" treatment.
  const goalHeadSub=HL.goalHeadSub();

  // BUILD-32 Part 3 — two LIVE figures for the hero's right-hand stack, added as
  // information (not decoration): this week's giving (a true Monday-based week
  // from /fundraising/overview) and money at risk (BUILD-73 Part 3, from
  // /impact). Both real, both move week to week — replacing the static "Active
  // Goals" count, which never changed week to week.
  const tw=fundOverview?.thisWeek||{raised:0,giftCount:0};
  // "This week" lands on Giving Summary filtered to the chip's EXACT
  // Monday-based week (tw.start/tw.end from the server) — same predicate both
  // sides, so the destination total equals the chip's number.
  const twStat={label:"This week",value:fmtFull(tw.raised||0),sub:`${tw.giftCount||0} ${plural((tw.giftCount||0), "gift")} logged`,
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
  const reengStat=HL.reengStat({ atRiskAmt, driftData, impact, openEarlySigns, quietCount, setReengBreakdownOpen });

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
    const deltaTxt=delta>0?`up ${fmtFull(delta)} on the same days last year`:delta<0?`down ${fmtFull(Math.abs(delta))} on the same days last year`:"level with the same days last year";
    return {period,many,g0,raised,goalAmt,pct,rawPct,overAmt,heroPace,heroPaceCol,deltaTxt};
  })():null;
  const {period={},many,g0,raised,goalAmt,pct,rawPct,overAmt,heroPace,heroPaceCol,deltaTxt}=heroCtx||{};

  const heroSection=HL.heroSection({ GoalStat, daysLeftInPeriod, deltaTxt, fgRollup, fundOverview, g0, goal, goalAmt, goalHeadSub, heroCtx, heroPace, heroPaceCol, isAdmin, isReadOnly, many, onNavigate, openEditGoal, openSetGoal, overAmt, paceLabel, paceSub, pct, period, raised, rawPct, reengStat, twStat });

  /* Top-level goal breakdown — umbrella (children nested) + standalone.
     Card count matches the header's top-level count; children live inside
     their umbrella, not as flat peers (display-consistency FIX). BUILD-34:
     its own orderable/hideable section, split from the hero banner. */

      /* Scope toggle — controls the queue below AND the Retention Rate /
          Stewardship Debt cards together (one shared scope, not per-card
          toggles that could disagree). Hidden until my-stats resolves the
          initial default, so it never flashes the wrong state. BUILD-32 Part 4:
          also hidden unless 2+ officers have assigned donors — otherwise "My
          donors" and "Whole org" are the same list (a single-value picker). */
  const scopeToggle=HL.scopeToggle({ homeData, scope, setScope });

      /* ── Command center (BUILD-16 Part 1) ──────────────────────────────
          The four headers a fundraiser opens the app to see: Portfolio [Team],
          Tasks [Core], Need to Do [Core], Pipeline [Team]. Plan-graceful — a
          Core org sees Tasks + Need-to-do only (the goal banner above is its
          giving snapshot); Team adds Portfolio + Pipeline. First-touch-delay
          and stewardship-debt are demoted to the small "Signals" chips below —
          never headline cards. */
  // BUILD-86 C.2 — `commandCenterSection` DELETED. It was retired from the
  // section registry in BUILD-83 (four tiles whose contents lived in the cards
  // below and contradicted them) and has rendered nowhere since; it survived as
  // sixty lines of code holding the last references to the tasks queue, one of
  // which scrolled to an element this build removed. Dead code that still
  // points at a deleted thing is how a screen breaks two builds from now.

  // BUILD-83 Part 3.4 — an unassigned org reads "no one assigned to you yet",
  // never "0 donors · $0 lifetime giving" the screen after importing 25,034.
  const myPortfolioSection=HL.myPortfolioSection({ StatIcon, hoveredStat, myStats, onNavigate, openPortfolioBreakdown, portfolioOpen, setHoveredStat, setPortfolioOpen });

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
  const retentionSection=HL.retentionSection({ DonorChip, MoreChip, Sparkline, driftData, firstTouchOpen, heroIsDrift, myStats, onNavigate, openDebtBreakdown, openRetentionBreakdown, retentionBreakdown, retentionBreakdownLoading, retentionColor, retentionCurrent, retentionThin, retentionTooEarly, setFirstTouchOpen, stewardMetrics });

  // The two-column queue/briefing + funnel/grant/recurring grid — one section.
  // ── BUILD-81 — THE THREAD, first. A thread is a donor plus an open next
  // step: the last touch, the next step with its due date, days open, who
  // owns it. This is the day view's follow-up spine with its name on screen.
  // Needs Your Attention FOLDS IN below the thread rows (a gift not yet
  // thanked is a thread whose next step is "thank"; a move due is a thread);
  // Drift stays its own section — Drift finds them, the Thread keeps them.
  const threadList=threadsData?.list||[];
  const threadStat=threadsData?.stat;
  const TOUCH_WORD={call:"Call",meeting:"Meeting",email:"Email",gift:"Gift",other:"Note",stewardship:"Stewardship",note:"Note",event:"Event"};
  // BUILD-87 F.3.3 — ONE CLAUSE INSTEAD OF FOUR FACTS. The row said
  // "Meeting · 2026-09-09 · She asked for the import report · Admin User",
  // which is a database record read aloud. It says "She asked for the import
  // report a week ago." now, and the touch type, the exact date and the person
  // move to hover — they are the answer to a question she has not asked yet.
  // Presentation only: every value here is already on the row.
  const threadClause=HL.threadClause({ TOUCH_WORD });
  // BUILD-85 — a row now carries its REASON. shared/threadRank.js decided the
  // order; this prints the sentence that order was built from, so the queue can
  // always answer "why this one first?" without the reader guessing. The score
  // itself never reaches the screen — an unsourced number on a row reads as
  // invented precision, and this product does not do that.
  // BUILD-86 C.1 — OVERDUE IS BRASS, NOT RED. Red is reserved for a
  // destructive confirm; a late follow-up is emphasis, not danger, and a
  // screen that shouts in red every morning stops being read.
  const BAND_STYLE={overdue:{label:"Overdue",color:T.gold700},today:{label:"Today",color:T.gold600},ahead:{label:"Coming up",color:T.ink3}};
  // FIX-8 Part E — Home shows the first thing and folds the rest. This is the
  // fold's state, and it is per visit rather than remembered: the point of the
  // screen is that it opens calm every morning.
  //
  // THE TDZ RULE, PAID FOR A FOURTH TIME. This sat two hundred lines below,
  // beside the crossover's fetch, and `homeCalm` reads it — which is a blank
  // Home and "Cannot access 'ys' before initialization" in a minified bundle,
  // not a lint error. A const is declared above every line that reads it.
  const [threadAllOpen,setThreadAllOpen]=useState(false);
  // FIX-34 — one row per donor; "2 more for Christopher" opens the rest IN the row.
  const [moreOpen,setMoreOpen]=useState(null);
  // FIX-34 — Done on a TASK row (a meeting's prep, "How did it go?") finishes
  // that task only, with Undo, and the row moves to the donor's next step. A
  // thread row, or a task that needs an outcome (422), logs the conversation.
  const finishRow=HL.finishRow({ loadThreads, setConvoFor });

  // ── HOME-CALM · WHAT THE LIST SHOWS ON HOME ───────────────────────────
  // First thing takes threadList[0] and says it properly, so the rest of the
  // list starts at [1]. Everything overdue and everything due today is a ROW;
  // next week folds to one line, because the list she opens Home for has to
  // be ON the screen and next week is not this morning's work.
  //
  // The band headers come off here too. They label three blocks in a list of
  // six, and every row already carries its own age on the right; OVERDUE 4
  // above four rows each saying how late it is, is the count line again in
  // another typeface. The Dashboard keeps them: on the board the bands ARE
  // the shape of the answer.
  const homeCalm = surface==="home" && !threadAllOpen;
  // TASKS-2 — the first row is ALSO a Thread row. First thing says it in a
  // sentence; the Thread is the list, and a list missing its first item read
  // as empty to the director whose one conversation was that item.
  // A step logged today also shows, even when its day is next week: she
  // just wrote it, and a Thread that hides what she just wrote reads as lost.
  // Newest first among what she logged today, then threadRank's own order.
  // SCREENS-1: declared above the Thread's rows, which pass it to their late render functions.
  const openRailDonor=(donorId,threadId)=>setRailView({kind:"donor",donorId,threadId});
  // HOME-6: a name on Home opens that person's profile.
  const openProfile=id=>onNavigate&&onNavigate("donors",{selectDonorId:id});
  const rowSource = homeCalm
    ? [...threadList.filter(t=>t.daysOpen===0),...threadList.filter(t=>t.daysOpen!==0&&t.band!=="ahead")]
    : threadList;
  const threadRows=[];
  const homeRows=[];                       // {age, el} — so a stopped card can be placed by age
  let lastBand=null;
  rowSource.forEach((t,i)=>{
    if(!homeCalm&&t.band!==lastBand){
      lastBand=t.band;
      const b=BAND_STYLE[t.band]||BAND_STYLE.ahead;
      threadRows.push(
        // The 3px transparent left border is the row's brass/emerald marker,
        // reserved: without it a band header starts three pixels to the left of
        // every name it labels, which is exactly visible and exactly wrong.
        // BUILD-89 — A BAND IS A WHISPER, NOT A WALL. These were filled cream
        // bars running the width of the card, and they chopped one list into
        // three blocks you had to re-read. The label is a quiet line on the
        // same white; the list underneath reads as one list.
        // The label lines up with the row's own content edge: the row's anchor
        // pads 13px past its 3px marker, so the band does too, or the word
        // OVERDUE starts thirteen pixels left of every face it labels. (A JSX
        // comment here is inside a function CALL, not inside JSX.)
        <li key={"band-"+t.band} className="attn-band" style={{padding:"22px 0 8px 13px",borderLeft:"3px solid transparent"}}>
          <span style={{fontSize:11,fontWeight:700,color:b.color}}>{b.label}</span>
          <span style={{fontSize:11,color:T.ink3,marginLeft:8}}>{(threadsData?.bands||[]).find(x=>x.key===t.band)?.count||0}</span>
        </li>);
    }
    // HOME-CALM — a home row remembers how old it is, so a stopped card can
    // be placed among these by age rather than dropped at one end.
    (homeCalm?(el=>homeRows.push({age:t.overdue?rowFigure(t):-1,el})):(el=>threadRows.push(el)))(
    // ── FIX (2026-09-18) — THE THREAD ROW TAKES DRIFT'S SHAPE ──────────────
    // Drift sat directly under this list looking twice as good, and the
    // difference was not colour: a Drift row gives you a face, a whole
    // sentence that WRAPS, one fact on the right with its label under it, and
    // buttons big enough to mean something. The Thread row gave you a name, a
    // clause cut off mid-word with an ellipsis, and then said "overdue" TWICE
    // — once beside the step and again underneath it.
    //
    // So: the same anatomy, in the Thread's own words. The step moved into the
    // sentence ("Next: send the proposal"), which is where a person would say
    // it, and the right-hand fact is the only thing a queue is really sorted
    // by — how late this is.
    //
    // BUILD-86 C.2 — the `attn-*` hooks stay. BUILD-45 D-1 proved a row's left
    // region must be a real <a href="/donors/:id"> with the action button as a
    // SIBLING, never nested (keyboard and new-tab both break otherwise).
    HL.threadRow({ TOUCH_WORD, finishRow, i, isReadOnly, loadThreads, moreOpen, onNavigate, openRailDonor, railView, rowSource, setMoreOpen, surface, t, threadClause }));
  });

  // ── HOME-CALM · THE STOPPED CARD IS A ROW ─────────────────────────────
  // It used to be an alert box above everything, naming nobody and carrying
  // a count: "1 card stopped this month." A stopped card is money that was
  // already moving and quietly stopped, which makes it the most actionable
  // thing on the screen — so it says who, and what to do, and it takes its
  // place in the list by age like every other row.
  //
  // It is NOT a thread: there is no thread id, no "Done", no snooze. Logging
  // a conversation is not what fixes a declined card; sending her a link is.
  // So it borrows the row's SHAPE and none of its controls, and the one
  // action opens Recurring where that link is sent.
  if(homeCalm&&failedCardList.length){
    failedCardList.forEach(f=>{
      // The day it stopped: the last failure if there was more than one,
      // otherwise the first. If the row carries neither, the age is UNKNOWN
      // and the row says "stopped" with no figure — it does not print a day
      // count it cannot source.
      const failedOn=f.lastFailedAt||f.firstFailedAt||null;
      const age=failedOn?daysDiff(failedOn):-1;
      const el=(
        HL.threadStoppedRow({ age, f, failedOn, onNavigate, openRailDonor }));
      // By age, among the rows that have one. A card stopped nine days ago
      // sits between the twelve-day row and the eight-day row, which is the
      // only ordering that lets one list be read straight down.
      const at=homeRows.findIndex(r=>r.age>=0&&r.age<age);
      if(at<0)homeRows.push({age,el});else homeRows.splice(at,0,{age,el});
    });
  }

  // ── LIVE-1 · WHAT THE LAST IMPORT TOLD US IS A ROW ─────────────────────
  // Like the stopped card, it is NOT a thread: no Done, no snooze. It borrows
  // the row's shape, says the readout's headline, and its one action opens
  // What changed, where every line has its rows and its own action. Newest
  // news, so it leads the list.
  if(homeCalm&&latestReadout){
    const ro=latestReadout;
    homeRows.unshift({age:-1,el:(
      HL.threadReadoutRow({ ro }))});
  }

  // The thank queue items fold into the thread rows themselves once a gift
  // opens its thread — a donor with an open thread never shows a second
  // "thank" line below.

  // BUILD-83 Part 3.1 — THE THREAD, with Needs Your Attention folded in, is
  // the first thing on Home after the greeting and the setup card.
  // VOL-1 — the volunteers who have never been asked. Read once, here, from
  // the same route the Volunteers hub reads, so Home and that screen cannot
  // disagree about the number or the sentence. A failure is silence: a
  // crossover that will not load must never break the morning screen.
  const [crossover,setCrossover]=useState(null);
  useEffect(()=>{
    if(surface!=="home")return undefined;
    let live=true;
    apiFetch("/volunteer-hub/crossover").then(r=>{ if(live)setCrossover(r); }).catch(()=>{});
    return ()=>{live=false;};
  },[surface]);

  // HOME-CALM — the crossover's Home rendering, defined once here and placed
  // at the foot of the panel. Silent when there is nothing to say.
  const homeCrossoverCard = HL.homeCrossoverCard({ crossover, onNavigate, surface });

  const threadSection=(
      HL.threadSection({ cPad, cardWrap, crossover, dhNotice, foldBtn, gsNotice, homeCalm, homeData, homeFold, homeRows, isReadOnly, jsNotice, loadThreads, moveLine, onNavigate, onPanel, sHdr, sHdrPad, sLink, sSerif, sampleStatus, setDhNotice, setGsNotice, setPlanFor, setThreadAllOpen, setThreadExpanded, setThreadScope, surface, threadAllOpen, threadExpanded, threadList, threadRows, threadScope, threadStat, threadsData })
  );

  // ── BUILD-83 Part 5.3 — YOUR MONTHLY DONORS, between the Thread and Drift.
  // The closer from the Sept-6 positioning, and it was not on Home at all: the
  // org's own file says how many monthly donors it has and how many stopped,
  // and that is a fact Stripe never needed to confirm.
  const monthlySection=HL.monthlySection({ cPad, cardWrap, onNavigate, recurringHealth, sHdr, sHdrPad, sLink, sSerif, t });

  // ── BUILD-88b B.3 — THE THANK-YOU QUEUE ──────────────────────────────────
  // "Six thank-yous ready." Steward wrote them; she sends them. Three actions
  // and no fourth: Copy, Mark sent, Skip. A draft must be OPENED before "Mark
  // all as sent" is offered, because a bulk action over letters nobody read is
  // what turns a thank-you queue into a lie.
  // FIX-3 A (finding 2) — ONE ROW PER DRAFT, AND A BUTTON. "One thank-you
  // ready" read as broken: an indented grey explainer with a rule that did not
  // line up, a name, "$1", an underlined "Read the draft" link and a large gap.
  // Each draft is now one row (the person, the amount, the gift's date, then a
  // real button, never an underlined link); the explainer is one quiet line
  // under the heading, on the heading's own left edge; and the footer renders
  // only when it has something in it, so a single row has nothing under it.
  const TY_WORDS=["no","one","two","three","four","five","six","seven","eight","nine"];
  const tyFooter=!!thankYous&&(thankYous.drafts.length>6||thankYous.allOpened||!!tyErr);
  const thankYouSection=HL.thankYouSection({ TY_WORDS, cPad, cardWrap, onNavigate, onPanel, sHdr, sHdrPad, sLink, sSerif, setTyOpen, setTyShowAll, thankYous, tyAct, tyCopied, tyCopy, tyErr, tyFooter, tyMarkAll, tyOpen, tyOpenDraft, tyShowAll });

  // BUILD-83 Part 3.1 — Drift is its own section, third, after the monthly donors.

  // BUILD-94 Part 3 — one line per sequence, and nothing more. A sequence is
  // supposed to run without her; Home's whole job here is to prove it is
  // running, and to say so immediately when an email could not be sent.
  // ── BUILD-97 Part 3 — "TELL STEWARD WHAT TO DO" ──────────────────────────
  // FIX-3 A (findings 3 and 4) — ONE LINE, NOT A SECOND ASK. The Agent is where
  // a plan is read, run and undone (FIX-1 §A); Home had kept a full ask of its
  // own (a title, "Nothing happens until you say so", a pale button). It is now
  // the daily line, when there is something true to say, over one input and
  // one emerald Go button. The button is always there and disabled until there
  // is text; Enter submits; the words are carried into Agent and asked on
  // arrival (agentAsk → onNavigate("agent",{agentText,autoAsk:true})).
  const agentEmpty=!agentText.trim();
  const agentSection=(
    HL.agentSection({ agentAsk, agentDaily, agentEmpty, agentText, cardWrap, sLink, setAgentText })
  );

  const sequencesSection=HL.sequencesSection({ cPad, cardWrap, onNavigate, sHdr, sHdrPad, sLink, sTitle, seqLines });

  // BUILD-83 Part 3.1/3.4 — retention and the pipeline funnel, ONE demoted card
  // at the bottom of Home. The funnel labels itself a SUGGESTION until a human
  // has placed anybody (Part 3.5).
  // BUILD-86 — MOVED OFF HOME. "67% led straight to the next step" is a
  // performance measure of her, over thirty days: true, worth having, and the
  // only one of the Thread card's three numbers she cannot act on before her
  // first coffee. That makes it board-shaped. Home keeps the two counts that
  // LABEL the named rows beneath them; this one goes where numbers go.
  const threadHealthLine=HL.threadHealthLine({ cPad, cardWrap, sHdr, sHdrPad, sTitle, threadHealth });

  const retentionPipelineSection=(
      HL.retentionPipelineSection({ cPad, cardWrap, countsByStage, driftData, nextGrant, onNavigate, recurringHealth, retentionSection, sHdr, sHdrPad, sLink, sTitle })
  );

      /* Honest impact line (FIX) — quiet ROI stat, attributable amounts only.
          Sits at the foot of the home column, small and on-palette. */
  // Nothing-to-say guard mirrored from ImpactLine's own early return, so the
  // section reads as absent (not an empty edit-mode shell) when silent.
  // ── BUILD-88d — THE TODAY RAIL ─────────────────────────────────────────────
  // Three numbers, stacked, on the right at 1440 and above the cards below
  // 1100. Every one of them is a count this page already carried buried in a
  // card header ("12 open · 3 overdue"), which is where a number goes to be
  // skipped. Each tile is the link to its own list.
  const railFailedRows=(recurringHealth?.atRisk||[]).filter(r=>{
    if(!r.first_failed_at)return false;
    return (Date.now()-new Date(r.first_failed_at).getTime())<=7*86400000;
  });
  const railFailedThisWeek=railFailedRows.length;
  // FIX-27 Part 3: a figure still loading is a skeleton, never a 0. null
  // means "not read yet"; a read that failed is a dash, not a zero either.
  const railDueToday=!taskCounts?null:taskCounts.failed?"Not set":(taskCounts.today||0);
  // A jump to a card on this page when the card is here, and the tab that owns
  // BUILD-89 — a tile no longer scrolls the page to a card; it opens the list
  // in the rail beside you (see THE RAIL HAS TWO STATES below).
  // ── BUILD-89 — THE RAIL HAS TWO STATES ─────────────────────────────────────
  // Today by default: three numbers, each a row you can press. Press one — or
  // any row in the Thread — and the rail switches to DETAIL over the same
  // space, with a way back. Two states, never an empty one: a tab strip would
  // sit there showing three zeros on a quiet morning, which is exactly what
  // makes a product look dead in a demo.
  // SCALE-2: the one person the rail opens, read by id when it opens.
  const [railPeople]=usePeopleById(railView.kind==="donor"?[railView.donorId]:[]);
  const donorById=railPeople||{};
  // SCALE-2: birthdays near today from the server (routes/donorLookups.js),
  // then the same week rule below, so the list is what it was.
  const [birthdayPeople,setBirthdayPeople]=useState([]);
  useEffect(()=>{
    if(surface!=="home")return;
    let live=true;
    apiFetch("/donors/birthdays-near").then(rows=>{if(live)setBirthdayPeople((Array.isArray(rows)?rows:[]).map(adaptDonor));}).catch(()=>{});
    return()=>{live=false;};
  },[surface]);
  // FIX-22: BIRTHDAYS THIS WEEK. today and the six days after it, each a
  // civil date in the organisation's timezone (orgToday.js), matched against
  // the month and day on the record (a Feb 29 birthday falls on Feb 28 in a
  // common year, shared/birthday.js). Read from the donors already loaded, so
  // it costs no query. None, and the rail shows nothing for it.
  const birthdaysThisWeek=useMemo(()=>{
    const days=[0,1,2,3,4,5,6].map(n=>orgTodayPlus(n)).filter(Boolean);
    const out=[];
    for(const d of birthdayPeople){
      const b=d.birthday;
      if(!b||!b.month||!b.day||d.deceased)continue;
      const at=days.findIndex(c=>isBirthdayOn(Number(b.month),Number(b.day),c));
      if(at>=0)out.push({id:d.id,name:d.name,at,label:at===0?"today":`${BIRTH_MONTHS[b.month-1].slice(0,3)} ${b.day}`});
    }
    return out.sort((x,y)=>x.at-y.at||String(x.name).localeCompare(String(y.name)));
  },[birthdayPeople]);
  const railRow=HL.railRow();
  const railBack=HL.railBack({ setRailView });
  // HOME-4 — the rail's reads (the calls, the goal, To confirm, the email
  // line) and the ones Home already makes for it (follow-ups, tasks due, cards
  // failed, setup). The rail draws once all of them have settled. Each Today
  // line keeps BUILD-92 B3's definition, on its title.
  const railReads=useRailReads();
  const railReady=railReads.ready&&setupLoaded&&threadsData!=null&&taskCounts!=null&&recurringHealth!=null;
  // SHIFT-2: the setup card above Your moves is drawn only when the checklist
  // was in at Home's first frame (setupParked). Read after it, the card goes to
  // the rail for this visit (the rail draws only once the checklist is in), so
  // its arrival never pushes the deck down; the next visit puts it back on top.
  const setupStageNow=surface==="home"?setupStage(setupStatus):null;
  const [onb,,reloadOnb]=useOnboarding(surface==="home");   // ONBOARD-2: an org in onboarding sees "Getting set up" in place of the old checklist
  const setupWhere=onb&&onb.tracked?null:setupStageNow==="first"&&setupParked===undefined?"rail":setupStageNow;
  const railListFor=(key)=>{
    if(key==="birthdays") return {
      title:"Birthdays this week",
      rows:birthdaysThisWeek.map(r=>({id:r.id,label:r.name,meta:r.label,onOpen:()=>openProfile(r.id)})),
      empty:"No birthdays this week.",
    };
    if(key==="failed") return {
      title:"Cards that failed this week",
      rows:(recurringHealth?.atRisk||[]).filter(r=>r.first_failed_at&&(Date.now()-new Date(r.first_failed_at).getTime())<=7*86400000)
        .map(r=>({id:r.donor_id,label:r.donor_name,meta:fmtFull(parseFloat(r.amount)||0),onOpen:()=>openProfile(r.donor_id)})),
      empty:"No card has failed this week.",
    };
    const list=key==="today"?threadList.filter(x=>x.band==="today"):(railOpenAll||threadList);
    return {
      title:key==="today"?"Due today":`People with a next step · ${(threadStat?.open??list.length).toLocaleString("en-US")}`,
      loading:key==="open"&&!railOpenAll&&(threadStat?.open||0)>list.length,
      // BUILD-86's rule: never "day 0". A thread planned this morning against
      // a date already past is genuinely overdue and genuinely zero days old,
      // so the meta says how LATE it is, or the day it is due.
      rows:list.map(x=>({id:x.id,label:x.donorName,
        meta:x.overdue?`${rowFigure(x)>(x.overdueDays||0)?"waiting":"overdue"} ${rowFigure(x)}d`:(x.band==="today"?"today":displayDateShort(x.nextStep?.due,new Date())),
        onOpen:()=>openProfile(x.donorId)})),
      empty:key==="today"?"Nothing is due today.":"Nothing is waiting.",
    };
  };
  const railBody=(()=>{
    if(railView.kind==="list"){
      const L=railListFor(railView.key);
      return (
        <div>
          {HL.railListView({ L, railBack, railRow, sSerif })}
        </div>
      );
    }
    if(railView.kind==="donor"){
      const d=donorById[railView.donorId];
      const th=threadList.find(x=>x.id===railView.threadId)||threadList.find(x=>x.donorId===railView.donorId);
      const name=d?.name||th?.donorName||"This donor";
      // adaptDonor (api.js) renames these: total / lastGift / lastAmount.
      // Reading total_giving off an ADAPTED donor gave every record in the rail
      // "Lifetime giving $0" — found by looking at it, not by a test.
      const lifetime=d?(parseFloat(d.total)||0):null;
      return (
        HL.railDonorView({ d, isReadOnly, lifetime, name, onNavigate, railBack, railView, setConvoFor, th })
      );
    }
    // HOME-4 — THE RAIL, CALM. Setup (mid-way), Today as one card with no
    // zeros, the calls (three, then See all), To confirm in one line, the
    // automatic email line, then the day's meetings. Nothing draws until every
    // read the rail needs is back (they all left with Home's first reads, see
    // lib/homeReads.js RAIL_READS); placeholders in this shape hold its place.
    if(!railReady) return <HomeRailSkeleton/>;
    const todayItems=[
      {key:"followups",n:threadsData&&!threadsData.failed?(threadStat?.open||0):null,one:"person with a next step",many:"people with a next step",   // SENDS-1, TRUTH-4: its own name, never read as the Tasks badge
       definition:"Every person with a next step planned and not yet done, whenever it is due. Not the same as the Tasks badge, which counts your tasks due today or overdue, with or without a person.",onOpen:()=>setRailView({kind:"list",key:"open"})},
      {key:"due",n:typeof railDueToday==="number"?railDueToday:null,one:"due today",many:"due today",
       definition:"Your tasks and next steps due today, in your organization's timezone. The same count as Tasks, Today.",onOpen:()=>onNavigate&&onNavigate("tasks",{scope:"mine",view:"today"})},
      {key:"failed",n:recurringHealth&&!recurringHealth.failed?railFailedThisWeek:null,one:"card failed",many:"cards failed",
       definition:"A recurring card that declined in the last seven days and has not gone through since.",onOpen:()=>setRailView({kind:"list",key:"failed"})},
      {key:"birthdays",n:birthdaysThisWeek.length,one:"birthday this week",many:"birthdays this week",
       definition:"People on file whose birthday is today or in the six days after it.",onOpen:()=>setRailView({kind:"list",key:"birthdays"})},
    ];
    return (
      <div data-testid="home-rail" data-ready="1" style={{display:"flex",flexDirection:"column",gap:12}}>
        {setupWhere==="rail"&&<SetupRailCard status={setupStatus} onNavigate={onNavigate} isAdmin={isAdmin} onSetCardState={setSetupCardState}/>}
        <TodayCard items={todayItems}/>
        {isAdmin&&!isReadOnly&&<OwnersCard owners={railReads.owners} onNavigate={onNavigate}/>}
        <CallsToMake limit={3} isAdmin={isAdmin} isReadOnly={isReadOnly} preload={railReads} onOpenPerson={id=>onNavigate("donors",{selectDonorId:id})}/>
        {!editMode&&<>
          <ToConfirmLine clock={railReads.clock} onNavigate={onNavigate}/>
          <MailboxBanner onNavigate={onNavigate}/>
          {/* SEND-GATE-2's line, where the approved HOME-3 mockup draws it: the foot of the rail. */}
          <HomeMailLine onNavigate={onNavigate}/>
          <div data-testid="home-rail-meetings"><MorningBrief compact skipMeetingId={leadMeetingId} onOpenPerson={id=>onNavigate("donors",{selectDonorId:id})}/></div>
        </>}
      </div>
    );
  })();
  // HOME-4: the rail column stretches beside the work; what is in it stays in view (sticky) on a wide screen.
  const todayRail=<HomeRailColumn>{railBody}</HomeRailColumn>;

  const impactVisible=!!impact&&((impact.atRiskAmount||0)>0||(impact.recoveredAmount||0)>0||(impact.reengagedAmount||0)>0||(impact.watchingRecurringCount||0)>0||(impact.onlineGivingProcessed||0)>0);
  const impactSection=impactVisible?<ImpactLine impact={impact}/>:null;


  // FIX-3 A (finding 1) — THE SECTION STACK, SPLIT IN TWO. Home's panel is a
  // two-column TOP (the work beside the Today rail) over a full-width LOWER half.
  // The rail is three numbers tall; beside Drift's institutional list, the
  // thank-you queue and the entry it was a tall blank column. Everything up to
  // and including the Thread sits beside the rail (the rail's detail state opens
  // from a Thread row, so the two stay side by side); every section after the
  // Thread runs the full width of the panel below it. The board is not split.
  // Computed here, above the return, so both halves can be placed in the shell.
  const sectionStack=HL.sectionStack({ agentSection, cPad, cardWrap, dragSectionId, editMode, heroSection, impactSection, isAdmin, layout, layoutLiveMsg, monthlySection, moveSection, moveSectionToTop, myPortfolioSection, onNavigate, onSectionDragEnd, onSectionDragOver, onSectionDragStart, onSectionDrop, recurringHealth, retentionPipelineSection, sHdr, sHdrPad, sLink, sTitle, saveEdit, scopeToggle, sequencesSection, setSectionVisible, setSetupCardState, setupCelebrate, setupStatus, surface, t, thankYouSection, threadHealthLine, threadSection });

  // NB: no `fade-in` on the dash-root below. `.fade-in`'s final keyframe retains
  // `transform: translateY(0)` (animation-fill-mode:both), which would make
  // dash-root the containing block for every position:fixed descendant —
  // dropping the set-goal modal (and any drill-down not portalled to body) at
  // the vertical middle of the whole tall page, below the fold (BUILD-22 Part 2).
  // HOME-4 — SET UP STEWARD, WHERE A NEW ORG CAN SEE IT (HomeSetup.jsx). A
  // new org gets the whole card here, under Ask and above Your moves; mid-way
  // it is the rail's first card; done or dismissed, it is gone (Settings keeps
  // it). The completion moment shows once, here.
  const setupFirst=(()=>{
    if(surface==="home"&&onb&&onb.tracked)return <GettingSetUp data={onb} onNavigate={onNavigate} onHome onReload={reloadOnb}/>;
    if(surface!=="home"||!setupStatus)return null;
    // SHIFT-2: the completion moment, too, only when it can be in the first frame.
    if(setupStatus.complete)return setupCelebrate&&setupParked!==undefined?<GoldMoment moment="setup_complete" title="Steward is set up."
      line="Donors in, giving connected, automations watching. Everything it linked to lives in Settings."/>:null;
    return setupWhere==="first"?<SetupFirstCard status={setupStatus} onNavigate={onNavigate} isAdmin={isAdmin} onSetCardState={setSetupCardState}/>:null;
  })();
  const setupDonors=(setupStatus?.items||[]).find(i=>i.key==="donors");
  const noDonorsYet=!!setupDonors&&!(setupDonors.count>0);
  // FEEL-1: only while the deck is drawn (Home, not editing) and has not settled,
  // and only on a wide screen: on a phone, holding the rail cost 150 ms of its
  // 3.58 s budget (perf-app), so a phone draws as before.
  const holdUnderDeck=surface==="home"&&!editMode&&!movesSettled;
  const homeHead=FL.homeHead({ onMovesSettled, agentDaily, cancelEdit, data, editMode, enterEdit, firstName, greeting, homeDay, isReadOnly, layout, loadThreads, noDonorsYet, onNavigate, resetLayout, sampleStatus, saveEdit, setupFirst, surface, threadScope, todayLongStr, todayStr });
  return(
    <div className="dash-root dash-bleed" style={{background:surface==="home"?T.ground:T.bgDeep,margin:"-20px -24px -28px -24px",padding:"20px 24px 28px 24px",display:"flex",flexDirection:"column",gap:16,minHeight:"calc(100vh - 92px)"}}>
      {/* BUILD-87 F.3.1 — ONE CONTENT COLUMN. Home was as wide as the window,
          which on a 27" monitor stretched a four-section morning screen across
          1800px and made every card look like a table. 1100px is the column.
          The breakdown panels and the three modals sit OUTSIDE it, and the
          set-goal modal inside it is fine either way: a max-width ancestor does
          not constrain a position:fixed child, only a TRANSFORMED one does —
          which is the BUILD-22 trap the dash-root comment above guards against,
          and the reason nothing here gets a `fade-in`. The board keeps the full
          width: it is a grid of numbers, not a page of prose. */}
      <div className="dash-col" style={{width:"100%",maxWidth:surface==="home"?1320:"none",margin:"0 auto",display:"flex",flexDirection:"column",gap:16}}>

      {/* ── BUILD-89 — ONE PANEL, NOT A STACK OF TILES ────────────────────
          Home was eight floating cards on a cream field, and eight edges is
          what made it read as a dashboard rather than a page. There is ONE
          white panel now: the work on the left, the rail on the right, a
          single hairline between them. Everything inside the panel is a
          block separated by air and a rule — no card carries its own border,
          because the panel already drew it. */}
      {/* HOME-3 — nothing renders above the greeting: the moves deck sits
          under Ask, inside the header (homeHead). */}
      <div className={surface==="home"?"home-shell":""}>
      {surface==="home"&&<style>{HOME_GRID_CSS}</style>}{/* HOME-6: Home's one grid (home/homeGrid.js) */}
      {surface==="home"&&!homeWide&&<div className="home-head-narrow">{homeHead}</div>}
      <div className={surface==="home"?"home-shell-top":""} style={holdUnderDeck&&phoneHold?{display:"none"}:undefined}>{/* MOPUP-3: held whole under an empty deck on a phone */}
      <div className={surface==="home"?"home-shell-main":""}>

      {/* HOME-TIDY 2 — the header (greeting, day, Ask). On a wide screen it
          heads the work column; on a phone it renders above the stacked
          panel instead, so Ask is under the greeting there too. */}
      {surface!=="home"?homeHead:homeWide?<div className="home-head-wide">{homeHead}</div>:null}
      {/* BUILD-77 Part 7 — the Recurring tab left the home screen (it lives
          under Fundraising → Recurring Giving). Home keeps one tab and no
          tab bar; when any recurring count is non-zero, ONE line below links
          across. Recurring is a place you go, not a thing you scan every
          morning.

          HOME-CALM — AND ON HOME IT IS NOT A LINE ABOVE THE WORK EITHER. A
          stopped card is money that was already moving and quietly stopped:
          that is the most actionable thing on the screen, and it was being
          said as an alert with a COUNT in it, above everything, naming
          nobody. It is a Thread row now — it names her, it says what to do,
          and it takes its place in the list by age like every other row. The
          Dashboard keeps the line, because the board is reading totals. */}
      {HL.boardRecurringLine({ onNavigate, recurringAttention, recurringFailed, surface })}

      {(()=>{
      const cardsBlock=HL.cardsBlock({ goal, goalForm, goalModalMode, inp, layoutError, recurringHealth, saveGoal, savingGoal, sectionStack, setGoalForm, setShowSetGoal, showSetGoal });
      // BUILD-89 — the shell owns the two columns now (see ONE PANEL above),
      // so the stack renders straight into it.
      return holdUnderDeck?null:cardsBlock;
      })()}
      </div>{/* /home-shell-main */}
      {surface==="home"&&todayRail}
      </div>{/* /home-shell-top */}
      {/* FIX-3 A (finding 1) — the lower half runs the full width of the
          panel, below the Thread and the rail (see sectionStack). */}
      {!holdUnderDeck&&HL.homeLower({ editMode, homeCrossoverCard, sectionStack, setWordsDone, setWordsOpen, surface, wordsOffer })}
      </div>{/* /home-shell */}
      </div>{/* /dash-col */}

      {HL.homeOverlays({ closePortfolioBreakdown, convoFor, data, debtBreakdown, debtBreakdownLoading, debtBreakdownOpen, goToDonorFromBreakdown, goToDonorFromPortfolio, impact, loadDrift, loadThreads, onNavigate, planFor, portfolioBreakdown, reengBreakdownOpen, retentionBreakdown, retentionBreakdownLoading, retentionBreakdownOpen, setConvoFor, setData, setDebtBreakdownOpen, setPlanFor, setReengBreakdownOpen, setRetentionBreakdownOpen, setWordsDone, setWordsOpen, wordsOpen })}
    </div>
  );
}
