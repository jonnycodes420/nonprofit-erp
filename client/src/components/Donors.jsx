import { NoRecentMeetingPanel, WarmNotAskedPanel } from "./MovesPanels";
import PopulationCount from "./PopulationCount";   // DEFINE-1: the Re-engage count says which population it is
import { viewMatches } from "../lib/viewEdited";   // FLOWS-20
import { useListFilters, anyFilterOn } from "../lib/listFilters";
import { givingStrengthOf } from "../../../shared/givingStrength.js";   // LIST-6 item 1   // LIST-6: one filter object, read from the address
import { useProfileReads, openProfileReads } from "../lib/profileReads";   // LOAD-1
import { useState, useEffect, useMemo, useRef, Component, lazy, Suspense } from "react";
import { GrantImport } from "./GrantImport";
import HistoryImport from "./HistoryImport";
import { SheetDropTarget } from "./SheetDropTarget";   // PERF-4: the reader itself loads when a window opens (below)
import Papa from "papaparse";
import { HoursImportModal } from "./VolunteerPanel";
import * as HOURS_PRESETS_MOD from "../../../shared/volunteerHours.js";
import { apiFetch, adaptDonor } from "../api";
import { allPeople, forgetAllPeople, peopleById, peopleCounts, useLeaveSignal } from "../lib/people";
import { errorMessage } from "../lib/domainError";
import { emailHint } from "../../../shared/contactCheck.js";
import { useAuth } from "../main";
import UpgradeModal from "./UpgradeModal";
import { LogTouchPicker } from "./donors/LogTouchPicker";   // EDIT-2: one person, or many
import { T, activeMark, fmtFull, daysDiff, askClaude, STAGES, contactGap, Card, AIBtn, AIPanel, PageTitle, Modal, Spin } from "./shared";
import { offerUndo } from "./EditHistory";
import { useStewardTold } from "../lib/stewardTold";
import { ADDS_PEOPLE } from "../lib/changes";   // QUICKADD-1: the writes that add people
import { useLive } from "../lib/liveRead";   // FRESH-2: every list and count re-reads from one place
import RecordGiftDialog from "./gifts/RecordGiftDialog";   // QUICKADD-1: Record a gift, with + New person
import { LogConversationModal } from "./LogConversation";
import { guardSuggestion, dropLog, plainText } from "../../../shared/suggestionGuard.js";
import { composeNextMove } from "../../../shared/nextMove.js";
// SHELVED — voice capture works but unproven adoption assumption, revisit
// later. Code intact, re-enable by uncommenting (see showVoiceMemo state,
// profile button, and modal render below, and add `VoiceMemoModal` back to
// the import above).
import { DonorMap } from "./DonorMap";
import { DataHealth } from "./DataHealth";
import { DriftList } from "./DriftList";   // HOME-4: Drift opens here from Home's chip
import { AssignModal, DirectoryView, ReEngageView, TeamView } from "./DonorDirectory";
import { directoryFilterCount, useDirectoryIds, FilteredChip } from "./donors/ReEngageFilter";   // FLOWS-4
import { ReengageChange } from "./donors/ReengageChange";   // FLOWS-19 item 5
import { tabCountWords } from "../lib/tabCount";   // FLOWS-6
import { ScreeningFileModal, ScreeningImportModal } from "./RoomToGive";
import { useCanMajorGifts } from "../lib/majorGifts";
import { FALLBACK_SETUP, PAGE_SIZES, cleanColumns } from "./DonorColumns";
import { EMPTY_WHERE, whereParam } from "./DonorFilters";
// PERF-4: from their own modules, not through DonorImport.jsx, whose import screens
// (and the spreadsheet reader they open) then stay off Donors' first look.
import { MergeDuplicatesModal } from "./import/MergeDuplicatesModal";
import { DeletePersonConfirm } from "./profile/DeletePersonConfirm";
import { DonorProfile, EditDonorModal, FollowUpTaskModal, LogTouchpointModal } from "./DonorProfile";
import { PLAN_UNKNOWN } from "../lib/entitlement";
import { useNavigate } from "react-router-dom";
import { donorHref, donorsListHref, donorsListState } from "../lib/appUrls";
import { retryImport } from "../lib/lazyRetry";
import { isAbort } from "../lib/leaving";   // FLAKE-3
import { reopenAfterUpdate, REOPENING_WORDS } from "../lib/chunkReload";   // FRESH-1 item 2

// PERF-4: the spreadsheet reader (113 KB) and the old-reports wizard are their
// own chunks, loaded when one of their windows opens, so the Donors list and a
// profile no longer download them first. Same names and props as before; the
// window draws a frame later on its first open, and nothing else changes.
const SpreadsheetImportCode = lazy(() => retryImport(() => import("./SpreadsheetImport")));
const OldReportsImportCode = lazy(() => retryImport(() => import("./OldReportsImport")));
function SpreadsheetImport(props) { return <Suspense fallback={null}><SpreadsheetImportCode {...props}/></Suspense>; }
function OldReportsImport(props) { return <Suspense fallback={null}><OldReportsImportCode {...props}/></Suspense>; }
// The grant import's file reader, loaded when a file is picked (it reads the file asynchronously anyway).
const parseFileToSheets = (...a) => import("./import/reader").then(m => m.parseFileToSheets(...a));

class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error, reopening: reopenAfterUpdate(error) }; }   // FRESH-1 item 2
  componentDidCatch(error, info) { if (!this.state.reopening) console.error("DonorProfile error:", error, info); }
  render() {
    if (this.state.error&&this.state.reopening) return <div role="status" style={{padding:"32px 24px",textAlign:"center",color:T.ink,fontSize:14,fontWeight:600}}>{REOPENING_WORDS}</div>;
    if (this.state.error) {
      return (
        <div style={{padding:"32px 24px",textAlign:"center",color:T.terracotta,fontSize:14}}>
          <div style={{fontWeight:700,marginBottom:8}}>Something went wrong loading this profile.</div>
          <div style={{color:T.ink3,marginBottom:16}}>{this.state.error?.message}</div>
          <button onClick={()=>this.setState({error:null})} style={{background:T.greenDk,border:"none",borderRadius:8,padding:"8px 18px",color:T.white,fontSize:13,fontWeight:600,cursor:"pointer"}}>Try again</button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── Donors ─────────────────────────────────────────────────────────────────
export function Donors({data,setData,isReadOnly=false,onNavigate,initialView,initialLogDonorId,initialStageFilter,initialSelectDonorId,initialOpenImport,initialOpenConversation,initialOpenCompose,initialOpenBrief,onIntentConsumed}){
  const{auth}=useAuth();
  const isAdmin=auth?.user?.role==="admin";
  // FIX-58: the screening tools, under Import & tools. PROSPECT-1's rule holds:
  // admins and the major gifts permission only (the routes refuse anyone else).
  const canMajorGifts=useCanMajorGifts();
  const [screenFor,setScreenFor]=useState(null);
  const [screenImport,setScreenImport]=useState(false);
  const [includeScreening,setIncludeScreening]=useState(false);
  const userId=auth?.user?.id||"";
  const userName=auth?.user?.name||auth?.user?.email||"";
  // FIX-13 Part 6 — the list's search, filters and view live in the URL
  // (/donors?q=&stage=&owner=&nomeeting=1…), read once here on mount and
  // written back below, so a filtered list opens the same in a new tab.
  const[urlList]=useState(()=>window.location.pathname.replace(/\/+$/,"")==="/donors"?donorsListState(window.location.search):{});
  const routerNavigate=useNavigate();
  // LIST-6 item 2: THE FILTERS ARE ONE OBJECT, AND THE ADDRESS HOLDS IT (lib/listFilters.js). Each
  // name below is read from it on every render; each setter replaces the address; Clear filters
  // empties all of it. The names are kept so the views below read as before.
  const listFilters=useListFilters();
  const LF=listFilters.f;
  const setLF=listFilters.set;
  const dirStage=LF.stage, dirAssignee=LF.owner, dirDesignation=LF.designation, dirHousehold=LF.household;
  const dirPeople=LF.people, dirImport=LF.fromImport, dirAtlas=LF.fromAtlas, dirStatus=LF.status, activeViewId=LF.savedView;   // SENDS-3: dirAtlas, one Atlas answer's people
  const dirWhere=useMemo(()=>{try{const w=LF.where?JSON.parse(LF.where):null;return w&&Array.isArray(w.conditions)?{join:w.join==="or"?"or":"and",conditions:w.conditions}:EMPTY_WHERE;}catch{return EMPTY_WHERE;}},[LF.where]);
  const setDirStage=v=>setLF({stage:v}), setDirAssignee=v=>setLF({owner:v}), setDirDesignation=v=>setLF({designation:v});
  const setDirHousehold=v=>setLF({household:v}), setDirPeople=v=>setLF({people:v}), setDirStatus=v=>setLF({status:v});
  const setDirWhere=w=>setLF({where:whereParam(w)});
  const clearFilters=()=>listFilters.clear();   // the one clear: Owner, stage, tag, chips, search, everything
  // SCALE-2: THE SHELL NO LONGER HOLDS EVERY DONOR. The whole-org list is
  // loaded here only when a view that draws the whole org opens (Team,
  // Re-engage, the map) or the call list is asked for; everything else asks
  // the server (lib/people.js). `orgPeople` is null until then.
  const[orgPeople,setOrgPeople]=useState(null);
  const leaveSignal=useLeaveSignal();   // COMMS-SPEED-1: a whole-org read stops when Donors closes
  const patchPeople=fn=>{forgetAllPeople();setOrgPeople(prev=>prev?fn(prev):prev);};
  // BUILD-77: the badge matches the (gated) list. SCALE-2: counted by the
  // server with the same rule (routes/donorLookups.js /donors/counts).
  const[peopleCount,setPeopleCount]=useState(null);
  const loadPeopleCount=()=>peopleCounts().then(setPeopleCount).catch(()=>{});
  useEffect(()=>{loadPeopleCount();},[]);
  const lapsedCount=peopleCount?.reengage||0;
  const[view,setView]=useState(initialView||urlList.view||"directory");
  // FIX-55 item 6: the Map tab shows only when an address lookup provider is
  // set up on the server (GET /org capabilities.geocoding). Without one the map
  // could only ever be empty, so it is hidden, and a link to it opens Directory.
  const mapOn=!!data?.org?.capabilities?.geocoding;
  useEffect(()=>{if(view==="map"&&data?.org&&!mapOn)setView("directory");},[view,mapOn,data?.org]);
  const[search,setSearch]=useState(LF.search);   // the box as she types; the filter is LF.search (below)
  const[selected,setSelected]=useState(()=>initialSelectDonorId?{id:initialSelectDonorId}:null);
  // LIST-2: the profile now mounts once its record has arrived, after the
  // intent that opened it (a draft, a conversation, the brief) is consumed, so
  // the intent is kept here from the first render.
  const[openIntent]=useState(()=>({id:initialSelectDonorId,conversation:!!initialOpenConversation,compose:!!initialOpenCompose,brief:!!initialOpenBrief}));
  const selectedRef=useRef(null);   // LIST-2: the profile's retry reads who is open now
  selectedRef.current=selected;
  useProfileReads(selected?.id);   // LOAD-1: the profile's reads in two requests (lib/profileReads.js)
  const[logTarget,setLogTarget]=useState(null);
  useEffect(()=>{
    if(!initialLogDonorId)return;
    peopleById([initialLogDonorId]).then(m=>{if(m[initialLogDonorId])setLogTarget(m[initialLogDonorId]);}).catch(()=>{});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);
  // FIX-11 Part 1 — "+ Log → Gift" hands the person to the real gift form on
  // the donor's profile rather than collecting an amount in the touchpoint
  // modal, which produced a note and no gift. Cleared once the profile has
  // opened on it, so re-selecting the donor later does not reopen the form.
  const[giftHandoff,setGiftHandoff]=useState(null);
  // BUILD-81 — the "Log a conversation" picker (directory toolbar) + target.
  const[convoPickerOpen,setConvoPickerOpen]=useState(false);
  const[convoTarget,setConvoTarget]=useState(null);
  // SCALE-2: the picker's people, name or email, from the server as she types.
  const[editTarget,setEditTarget]=useState(null);
  // THREAD-3: a delete refused because the person has a live monthly plan.
  const[planBlock,setPlanBlock]=useState(null);   // { id, sentence }
  const[followUpTarget,setFollowUpTarget]=useState(null);
  const[aiMap,setAiMap]=useState({});const[loadingKey,setLoadingKey]=useState(null);
  // FIX-10 D — A FAILURE IS NOT A SUGGESTION. A failed stream used to be
  // written into `aiMap`, so the Suggested panel rendered "Stream failed: 503"
  // as if Steward had drafted it, with no way to try again. Failures live in
  // their own map, keyed the same way, and the panel offers a retry.
  const[aiErr,setAiErr]=useState({});
  const[callList,setCallList]=useState("");const[callLoading,setCallLoading]=useState(false);
  const[showAdd,setShowAdd]=useState(false);const[showImport,setShowImport]=useState(false);const[showGiftImport,setShowGiftImport]=useState(false);const[showCombinedImport,setShowCombinedImport]=useState(false);const[showMerge,setShowMerge]=useState(false);const[toolsOpen,setToolsOpen]=useState(false);const[showHours,setShowHours]=useState(false);const[showGrantImport,setShowGrantImport]=useState(false);const[showOldReports,setShowOldReports]=useState(false);const[showHistory,setShowHistory]=useState(false);const[showSheetImport,setShowSheetImport]=useState(false);const[droppedFile,setDroppedFile]=useState(null);
  const[upgradeModal,setUpgradeModal]=useState(null);
  const[addMore,setAddMore]=useState(false);   // FLOWS-11: the before-Steward total sits behind More
  const[newDonor,setNewDonor]=useState({name:"",email:"",phone:"",address:"",address2:"",city:"",state:"",zip:"",lastAmount:"",stage:"prospect"});
  const[orgTeam,setOrgTeam]=useState([]);
  // LIST-6: a link that opens the list on a stage (Home, the Pipeline) sets it in the address.
  useEffect(()=>{if(initialStageFilter&&initialStageFilter!==LF.stage)setLF({stage:initialStageFilter});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);
  // FIX-14 Part 5: the order (?sort=name|last_gift_date|total_giving, the
  // server's DONOR_SORTS; the list is paged server-side, so the server sorts)
  // and a household (?household=<id>, the list narrowed to its members).
  const[dirSort,setDirSort]=useState(urlList.sort||"");
  // IMPORT-6 · EVERYONE · DONORS · CONTACTS. "" lets the server choose (Donors
  // once the org has a donor, Everyone before); dirPeopleShown is what it chose.
  const[dirPeopleShown,setDirPeopleShown]=useState("");
  const[roleCounts,setRoleCounts]=useState(null);
  // the people one import brought in (dirImport, from the address above)
  useEffect(()=>{const go=e=>{const d=(e&&e.detail)||{};setView("directory");setLF({...(d.people?{people:d.people}:{}),fromImport:d.fromImport||""});};window.addEventListener("steward:directory",go);return()=>window.removeEventListener("steward:directory",go);},[]);
  const[noMeetingOpen,setNoMeetingOpen]=useState(!!urlList.noMeeting);
  const[warmOpen,setWarmOpen]=useState(!!urlList.warmUnasked);
  const[nmFilter,setNmFilter]=useState({owner:urlList.nmOwner||"",min:urlList.nmMin||""});   // INT-BUILD-1 Part 6
  const[officers,setOfficers]=useState([]);               // BUILD-14 officer portfolios + color
  const[portfolioMeta,setPortfolioMeta]=useState({tier:PLAN_UNKNOWN,single_user:true}); // unknown until it loads, never "core" (FIX-3 finding 9)
  const[pendingInvites,setPendingInvites]=useState([]); // [{id:"invite:<id>",name,email,pending}] — bulk assign-owner to a not-yet-accepted officer (B2)
  const[assignTarget,setAssignTarget]=useState(null);
  const[sampleStatus,setSampleStatus]=useState(null);
  const[sampleLoading,setSampleLoading]=useState(false);
  // Server-paginated directory (BUILD-06 Phase A): the Directory view fetches
  // its own 50-row pages with search/stage/owner pushed to query params;
  // orgPeople (SCALE-2: loaded when one opens) feeds the whole-org views
  // (pipeline/team/re-engage/map) and everything else.
  // LIST-1: her columns, her page size, her saved views and the filter she
  // is building, from GET /donors/list-setup. The rows wait for the layout so
  // the first page asks for the right columns at the right size.
  const[listSetup,setListSetup]=useState(null);
  const svApplied=useRef("");   // LIST-6: the saved view already applied from the address
  const[layout,setLayout]=useState(null);
  const layoutRef=useRef(null);
  layoutRef.current=layout;
  // LIST-2: the chips and the sort's direction come back from the address.
  const[dirDir,setDirDir]=useState(urlList.dir==="asc"||urlList.dir==="desc"?urlList.dir:"");
  const[filterError,setFilterError]=useState("");
  const DIR_PAGE_SIZE=layout&&PAGE_SIZES.includes(Number(layout.pageSize))?Number(layout.pageSize):50;
  const dirCols=layout?layout.columns.join(","):"";
  const layoutReady=!!layout;
  const dirUnitsOn=!!(layout&&layout.householdsTogether);   // HOUSEHOLD-1: "Show households together", hers
  const[dirUnits,setDirUnits]=useState(null);   // HOUSEHOLD-1: { units, unitCounts, unitSentence }
  const dirWhereStr=whereParam(dirWhere);
  const[dirPage,setDirPage]=useState(0);
  const[dirRows,setDirRows]=useState(null); // null = loading
  const[dirTotal,setDirTotal]=useState(0);
  // LIST-6: the search the list runs is the address's (LF.search); the box writes it after a pause.
  const dirSearch=LF.search;
  const pushedSearch=useRef(null);
  // FIX-45: the search the rows on screen answer. Until the server answers the
  // words in the box, the rows already loaded narrow as she types (below).
  const[dirRowsFor,setDirRowsFor]=useState(null);
  const[dirReloadKey,setDirReloadKey]=useState(0);
  // LIST-2: the query the rows on screen answer, and the one asked for. Until
  // they match, the list says it is updating, so old rows never pass for the
  // answer to a new filter.
  const[dirWant,setDirWant]=useState("");
  const[dirGot,setDirGot]=useState("");
  useEffect(()=>{const t=setTimeout(()=>{const w=search.trim();if(w!==LF.search){pushedSearch.current=w;setLF({search:w});}},300);return()=>clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[search]);
  // The address changed the search (Clear filters, a view, Back): the box follows. Not an echo of her own typing.
  useEffect(()=>{if(LF.search===pushedSearch.current)return;pushedSearch.current=null;if(LF.search!==search.trim())setSearch(LF.search);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[LF.search]);
  // IMPORT-2: "Bring in your notes" from a profile or the donor import's last screen.
  useEffect(()=>{const open=()=>setShowHistory(true);window.addEventListener("steward:history-import",open);return()=>window.removeEventListener("steward:history-import",open);},[]);
  // PARITY-1 — one tag or closeness filter, "level:major", "closeness:warm".
  useEffect(()=>{setDirPage(0);},[dirSearch,dirStage,dirAssignee,dirDesignation,dirSort,dirHousehold,dirStatus,dirWhereStr,dirDir,DIR_PAGE_SIZE,dirPeople,dirImport,dirAtlas,dirUnitsOn]);
  useEffect(()=>{
    if(view!=="directory"||listSetup)return;
    let live=true;
    apiFetch("/donors/list-setup").then(s=>{
      if(!live)return;
      const st={...FALLBACK_SETUP,...s};
      const l={...FALLBACK_SETUP.layout,...(s&&s.layout||{})};
      setListSetup(st);
      setLayout({...l,widths:l.widths||{},columns:cleanColumns(l.columns||st.defaultColumns,st.fields)});
    }).catch(e=>{
      console.warn("[list-setup]",e&&e.message);
      if(live){setListSetup(FALLBACK_SETUP);setLayout(FALLBACK_SETUP.layout);}
    });
    return()=>{live=false;};
  },[view,listSetup]);
  useEffect(()=>{
    if(view!=="directory"||!layoutReady)return;
    let cancelled=false;
    (async()=>{
      try{
        const qs=new URLSearchParams({limit:String(DIR_PAGE_SIZE),offset:String(dirPage*DIR_PAGE_SIZE)});
        // FIX-1 D — Donors shows donors. Volunteers have their own roster,
        // staff and board sit under Settings, and search still finds anyone.
        // IMPORT-6: the switch picks Everyone, Donors or Contacts, each counted.
        const roleQ=dirPeople==="donors"?"donor":dirPeople==="contacts"?"contact":dirPeople==="everyone"?"":"auto";
        if(roleQ)qs.set("role",roleQ);
        qs.set("roleCounts","1");
        if(dirImport)qs.set("fromImport",dirImport);
        if(dirAtlas)qs.set("fromAtlas",dirAtlas);
        if(dirSearch.trim())qs.set("search",dirSearch.trim());
        if(dirStage)qs.set("stage",dirStage);
        if(dirAssignee)qs.set("assignedTo",dirAssignee);
        if(dirDesignation)qs.set("designation",dirDesignation);
        if(dirSort)qs.set("sort",dirSort);
        if(dirHousehold)qs.set("household",dirHousehold);
        if(dirStatus){const [k,v]=dirStatus.split(":");qs.set(k,v);}
        if(dirDir)qs.set("dir",dirDir);
        if(dirCols)qs.set("cols",dirCols);
        if(dirWhereStr)qs.set("where",dirWhereStr);
        if(dirUnitsOn)qs.set("households","1");
        const want=qs.toString();
        setDirWant(want);
        const r=await apiFetch(`/donors?${want}`);
        if(cancelled)return;
        setDirGot(want);
        setFilterError("");
        setDirRows((r.donors||[]).map(adaptDonor));
        setDirUnits(r.units?{units:r.units,unitCounts:r.unitCounts,unitSentence:r.unitSentence}:null);
        setDirTotal(r.total||0);
        setRoleCounts(r.roleCounts||null);
        setDirPeopleShown(r.role||dirPeople||"donors");
        setDirRowsFor(dirSearch.trim());
      }catch(e){
        if(cancelled||isAbort(e))return;   // FLAKE-3: the page was left mid-read; nobody to tell
        setDirWant("");   // LIST-2: an answer came back, even if it was a refusal: no longer updating
        // LIST-1: a filter the server cannot run says why, in its own sentence.
        if(e&&e.status===400&&(e.error==="bad_filter"||e.sentence)){setFilterError(e.sentence||"That filter could not be run.");setDirRows([]);setDirTotal(0);return;}
        // LIST-2: the count line is the count of the rows shown, so a list that
        // did not load says so instead of keeping the last total.
        console.error(e);setDirRows([]);setDirTotal(0);setFilterError("The list didn't load. Change a filter or reload to try again.");
      }
    })();
    return()=>{cancelled=true;};
  },[view,layoutReady,dirUnitsOn,DIR_PAGE_SIZE,dirCols,dirWhereStr,dirDir,dirPage,dirSearch,dirStage,dirAssignee,dirDesignation,dirSort,dirHousehold,dirStatus,dirReloadKey,dirPeople,dirImport,dirAtlas]);
  // LIST-1: the layout, saved for her (PUT), reset (DELETE), or set as the
  // org's starting layout (admins). Views are a name for columns + filters.
  const persistLayout=async next=>{
    const full={...(layoutRef.current||FALLBACK_SETUP.layout),...next};
    setLayout(full);
    const r=await apiFetch("/donors/list-layout",{method:"PUT",body:JSON.stringify({columns:full.columns,widths:full.widths||{},pageSize:full.pageSize,householdsTogether:full.householdsTogether===true})});
    if(r&&r.layout)setLayout(l=>({...l,...r.layout,columns:cleanColumns(r.layout.columns||full.columns,(listSetup||FALLBACK_SETUP).fields)}));
    return r&&r.layout;
  };
  const resetLayout=async()=>{
    const r=await apiFetch("/donors/list-layout",{method:"DELETE"});
    if(r&&r.layout)setLayout({...r.layout,widths:r.layout.widths||{},columns:cleanColumns(r.layout.columns,(listSetup||FALLBACK_SETUP).fields)});
    return r&&r.layout;
  };
  const saveOrgLayout=async columns=>{
    const cur=layoutRef.current||FALLBACK_SETUP.layout;
    return apiFetch("/donors/list-layout/org",{method:"PUT",body:JSON.stringify({columns,widths:cur.widths||{},pageSize:cur.pageSize})});
  };
  // FLOWS-2: a view holds the list's own filters (Tag, Stage, Owner…), not only the condition filter.
  const viewBody=name=>{
    const cur=layoutRef.current||FALLBACK_SETUP.layout;
    const chips={search:LF.search,stage:dirStage,owner:dirAssignee,designation:dirDesignation,status:dirStatus,household:dirHousehold,people:dirPeople};
    return JSON.stringify({name,columns:cur.columns,widths:cur.widths||{},filters:dirWhere,pageSize:cur.pageSize,sort:dirSort,sortDir:dirDir,chips});
  };
  const keepView=v=>{if(v){setListSetup(s=>({...s,views:[...((s&&s.views)||[]).filter(x=>x.id!==v.id),{mine:true,...v}]}));setLF({savedView:v.id});}return v;};
  const saveView=async name=>{
    const r=await apiFetch("/donors/list-views",{method:"POST",body:viewBody(name)});
    return keepView(r&&r.view);
  };
  // LIST-6 item 4: Update keeps the view's id and name and takes the list as it stands.
  const updateView=async v=>{
    const r=await apiFetch(`/donors/list-views/${encodeURIComponent(v.id)}`,{method:"PUT",body:viewBody(v.name)});
    return keepView(r&&r.view);
  };
  const pickView=v=>{
    if(!v){setLF({savedView:""});return;}
    svApplied.current=v.id;
    const cur=layoutRef.current||FALLBACK_SETUP.layout;
    persistLayout({columns:cleanColumns(v.columns||cur.columns,(listSetup||FALLBACK_SETUP).fields),widths:v.widths||cur.widths||{},pageSize:v.pageSize||cur.pageSize}).catch(e=>console.warn("[list-layout]",e&&e.message));
    // LIST-3: and the sort it was saved with (none saved: the list's own order).
    setDirSort(v.sort||"");setDirDir(v.sort?(v.sortDir||""):"");
    // FLOWS-2: every filter it was saved with; one it was saved without is cleared. LIST-6: in one write.
    const c=v.chips||{};
    const w=v.filters&&Array.isArray(v.filters.conditions)?{join:v.filters.join==="or"?"or":"and",conditions:v.filters.conditions}:EMPTY_WHERE;
    setLF({savedView:v.id,where:whereParam(w),search:c.search||"",stage:c.stage||"",owner:c.owner||"",designation:c.designation||"",
      status:c.status||"",household:c.household||"",people:c.people||"",fromImport:"",fromAtlas:""});
  };
  // LIST-6 item 4: back on the list with a view in the address (?sv=) and no filter beside it, the
  // view is applied, once its list of views has arrived. With filters beside it, those are the list
  // (the view reads "(edited)"), so nothing she changed is thrown away.
  useEffect(()=>{
    if(!listSetup||!activeViewId||svApplied.current===activeViewId)return;
    svApplied.current=activeViewId;
    const v=(listSetup.views||[]).find(x=>x.id===activeViewId);
    if(!v){setLF({savedView:""});return;}
    if(!anyFilterOn(LF)&&!dirSort)pickView(v);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[listSetup,activeViewId]);
  // FLOWS-20: the list moved off the view it was opened with (a filter, a chip or the sort changed).
  const activeView=((listSetup&&listSetup.views)||[]).find(v=>v.id===activeViewId)||null;
  const viewEdited=!!activeView&&!viewMatches(activeView,{where:dirWhere,sort:dirSort,sortDir:dirDir,chips:{search:LF.search,stage:dirStage,owner:dirAssignee,designation:dirDesignation,status:dirStatus,household:dirHousehold,people:dirPeople}});
  const deleteView=async v=>{
    try{await apiFetch(`/donors/list-views/${encodeURIComponent(v.id)}`,{method:"DELETE"});
      setListSetup(s=>({...s,views:((s&&s.views)||[]).filter(x=>x.id!==v.id)}));setLF({savedView:""});}
    // POLISH-11 item 4: a delete the server refuses says why beside the menu, never nothing.
    catch(e){console.warn("[list-views]",e&&e.message);throw e;}
  };
  // Officer color map — assigned_to → hex; used for portfolio color-coding.
  const officerColorMap=useMemo(()=>Object.fromEntries(officers.filter(o=>o.portfolio_color).map(o=>[o.id,o.portfolio_color])),[officers]);

  useEffect(()=>{
    if((initialView||initialLogDonorId||initialStageFilter||initialSelectDonorId||initialOpenImport)&&onIntentConsumed)onIntentConsumed();
    // The setup checklist's "Import your donors" deep link lands with the
    // one-file magical import (Import + History) already open — the exact
    // spot, not the tab root.
    if(initialOpenImport&&!isReadOnly)setShowSheetImport(true);
    // A deep-linked selection starts from a summary row — upgrade it to the
    // full record (selectDonor is defined below; safe to call from here).
    if(initialSelectDonorId){
      // FIX-13 Part 6 — a deep link to someone outside the summaries (a
      // non-donor person, a fresh tab) still opens: the full record loads.
      selectDonor({id:initialSelectDonorId});
    }
  },[]);


  const wholeOrgView=view==="team"||view==="reengage"||view==="map";
  useEffect(()=>{
    if(!wholeOrgView||orgPeople)return;
    let live=true;
    // FIX-46: read fresh each time Donors opens, as the profile is. Held for
    // the whole session, a gift logged anywhere else (To confirm, Stripe, an
    // import) left Re-engage showing "$0, no gift on file" beside a profile
    // that said $1,500. Team, Re-engage and the map share this one read.
    // COMMS-SPEED-1: and stopped when the view or the page is left (lib/pages.js).
    const ctl=new AbortController();
    allPeople({force:true,signal:ctl.signal}).then(rows=>{if(live)setOrgPeople(rows);}).catch(e=>{if(!isAbort(e))console.error(e);});
    return()=>{live=false;ctl.abort();};
  },[wholeOrgView,orgPeople]);
  // LIST-6 item 5: TEAM, RE-ENGAGE AND THE MAP READ THE LIST'S OWN FILTER. FLOWS-4 sent Re-engage's
  // to the server; the other two filtered the whole-org list in the browser with a second filter
  // bar (notes over rows that carry no notes, custom fields over a second whole-org read). Now all
  // three ask GET /donors/ids with the same filter object the Directory sends, search included, and
  // draw only those people. One engine: the counts, the rows and the export agree.
  const reFilterN=directoryFilterCount({search:LF.search,stage:dirStage,owner:dirAssignee,designation:dirDesignation,household:dirHousehold,status:dirStatus,fromImport:dirImport,where:dirWhere});
  const reIds=useDirectoryIds({role:"",search:LF.search,stage:dirStage,assignedTo:dirAssignee,designation:dirDesignation,household:dirHousehold,fromImport:dirImport,where:dirWhereStr,...(dirStatus?{[dirStatus.split(":")[0]]:dirStatus.split(":")[1]}:{})},wholeOrgView&&reFilterN>0);
  const clearDirFilters=clearFilters;
  const reWaiting=reFilterN>0&&!reIds;
  const filtered=reFilterN>0?(reIds?(orgPeople||[]).filter(d=>reIds.has(d.id)):[]):(orgPeople||[]);
  // FLOWS-6 (W-1109-Donors-18X): the tab's count follows the list's filters (lib/tabCount.js).
  const listFilterOn=reFilterN>0;
  const reShown=listFilterOn&&orgPeople&&wholeOrgView&&!reWaiting?filtered.filter(d=>d.reengage).length:null;
  const reCountWords=tabCountWords(lapsedCount,reShown,listFilterOn);
  // FIX-45: search filters as you type. The server's answer comes after a
  // 300ms pause and a round trip, and on a slow day nothing on screen moved
  // until then, which read as "it only filters on Enter". So while the answer
  // for the words in the box is still coming, the loaded rows narrow by name
  // and email at once; the server's rows replace them when they land.
  const searchTerm=search.trim().toLowerCase();
  const searchPending=dirRows!==null&&dirRowsFor!==null&&search.trim()!==dirRowsFor;
  // LIST-1: the Directory's filters run on the server now (where=), across
  // every page; the old page-only filters belong to the whole-org views.
  const dirPageRows=(dirRows||[])
    .filter(d=>!searchPending||!searchTerm||((d.name||"")+" "+(d.email||"")).toLowerCase().includes(searchTerm));

  const loadOfficers=()=>apiFetch("/portfolio/officers").then(r=>{setOfficers(r.officers||[]);setPortfolioMeta({tier:r.tier||PLAN_UNKNOWN,single_user:!!r.single_user,file:r.file||null});setPendingInvites((r.invites||[]).map(i=>({id:"invite:"+i.id,name:i.name,email:i.email,pending:true})));}).catch(()=>{});
  useEffect(()=>{
    apiFetch("/org/sample-data-status").then(setSampleStatus).catch(()=>{});
    apiFetch("/org/team").then(setOrgTeam).catch(()=>{});
    loadOfficers();
  },[]);

  const loadSampleData=async()=>{
    setSampleLoading(true);
    try{
      await apiFetch("/org/load-sample-data",{method:"POST"});
      window.location.reload();
    }catch(e){ alert(errorMessage(e, "Failed to load sample data")); setSampleLoading(false); }
  };

  const patchDirRows=(donorId,patch)=>setDirRows(prev=>prev?prev.map(d=>d.id===donorId?{...d,...patch}:d):prev);

  const handleAssign=(donorId,assignedToId,assignedToName)=>{
    patchPeople(list=>list.map(d=>d.id===donorId?{...d,assignedTo:assignedToId,assignedToName}:d));
    patchDirRows(donorId,{assignedTo:assignedToId,assignedToName});
    if(selected?.id===donorId)setSelected(prev=>({...prev,assignedTo:assignedToId,assignedToName}));
  };

  const moveToStage=async(donorId,stage)=>{
    patchPeople(list=>list.map(d=>d.id===donorId?{...d,stage}:d));
    patchDirRows(donorId,{stage});
    if(selected?.id===donorId)setSelected(prev=>({...prev,stage}));
    try{await apiFetch(`/donors/${donorId}/stage`,{method:"PATCH",body:JSON.stringify({stage})});}
    catch(e){console.error(e);}
  };

  const handleLogged=(donor,interaction)=>{
    const updated={...donor,lastTouchpoint:interaction.date,interactions:[interaction,...(donor.interactions||[])]};
    patchPeople(list=>list.map(d=>d.id===donor.id?updated:d));
    patchDirRows(donor.id,{lastTouchpoint:interaction.date});
    if(selected?.id===donor.id)setSelected(updated);
    setLogTarget(null);
    setFollowUpTarget(donor);
    if(interaction.type==="gift"&&interaction.amount>0)reloadDonors();
  };

  // FLOWS-17: the profile ticks a task itself (lib/completeTask.js); this page's PUT, with no
  // Undo and no next repeat, is gone.

  // HOTFIX-1 — the civil day the suggestion is written on, read from the
  // machine's local calendar parts (never toISOString, which has already
  // turned over after 8pm Eastern). The validator refuses timing that is
  // already behind this day.
  const localToday=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;};

  // `openItems` is what the profile already loaded: the open threads, tasks
  // and proposals for this person, most urgent first. It is passed in so the
  // next move can NAME the open step instead of answering with nothing.
  const getAI=async(donor,type,openItems=[])=>{
    const key=`${donor.id}_${type}`;setLoadingKey(key);setAiMap(p=>({...p,[key]:""}));
    const stage=STAGES.find(s=>s.id===(donor.stage||"cultivate"))||STAGES[2];
    // GTM-1a 0 — ONE reading of "when did anyone last speak to them?".
    // `moveUrgency` answers "is this donor late for their stage?" and falls
    // back to the last gift date to do it; that is a colour, not a figure.
    // The Last contact TILE reads the server's donor-contact-gap figure, and
    // the suggestion must read the same one or the two contradict each other
    // on one screen. shared.jsx contactGap() is that single reading.
    const gap=contactGap(donor);
    const sys=`You are an expert major gifts officer. Be specific, strategic, brief. Max 200 words. Use ONLY the facts given below: never name a person, number, program or outcome that is not in them. Plain sentences, no markdown, no headings, no bullet points.`;
    let threadCtx="";
    if(type==="email"||type==="outreach"){
      try{
        const thread=await apiFetch(`/gmail/thread/${donor.id}`);
        if(thread.length>0){
          threadCtx=`\n\nRecent email history with this donor:\n${thread.map(t=>`[${t.created_at.split("T")[0]}] ${t.direction==="outbound"?"You":donor.name}: "${t.subject}", ${t.note.slice(0,200)}`).join("\n")}`;
        }
      }catch(e){}
    }
    const prompts={
      // BUILD-100 — NO "Urgency Score: X/10". It used to ask the model for one
      // and print it. Nothing computed it, nothing defined it, and asking twice
      // gave two numbers — the only figure on this screen that could not answer
      // "how is this arrived at?". The real urgency is moveUrgency(): days since
      // last contact against that stage's own thresholds, and it is on the
      // Contact tile beside this panel already. The model is asked for the move,
      // the timing and the words, which is what it is good for.
      nextmove:`Donor: ${donor.name} | Stage: ${stage.label} | Last logged conversation: ${gap.phrase} | Total: ${fmtFull(donor.total)} (${donor.gifts} gifts) | Last: ${fmtFull(donor.lastAmount)} on ${donor.lastGift}\nNotes: ${donor.notes||"none"}\nOrg: ${data.org.name}, ${data.org.mission}\nRecent touchpoints: ${donor.interactions?.slice(0,3).map(i=>`${i.date}: ${i.type} - ${i.note}`).join("; ")||"none"}\n\nReply with JSON only, in this shape: {"when": "...", "say": "...", "for": "..."}. Each value is ONE short plain sentence she could say out loud, using only the facts above: "when" says when and how to reach out, "say" says what to tell them, "for" says what the gift would be for. Start each with a verb or with "It", never with a label.`,
      outreach:`Write an outreach strategy for ${donor.name} (${stage.label} stage).\nTotal: ${fmtFull(donor.total)}, last gift ${fmtFull(donor.lastAmount)} on ${donor.lastGift||"no date on record"}.\nLast logged conversation: ${gap.phrase}.\nNotes: ${donor.notes}\nOrg: ${data.org.mission}${threadCtx}\n\nBest channel, talking points, suggested ask amount, personal hook.`,
      email:`Write a personalized email to ${donor.name} (${stage.label} stage).\nLast gift: ${fmtFull(donor.lastAmount)} on ${donor.lastGift}. Notes: ${donor.notes}\nOrg: ${data.org.name}.${threadCtx}\n\nWarm, specific, 150 words max.`,
      callscript:`Phone call script for ${donor.name} (${stage.label}).\nContext: ${donor.notes}\nLast gift: ${fmtFull(donor.lastAmount)}\n\nOpening, 2 listening questions, impact hook, soft ask.`,
    };
    // A failed stream is said in the panel and the spinner stops. It used to
    // throw out of an async handler: an unhandled rejection on every profile
    // open (this fires on mount) and a spinner that never ended.
    // FIX-1 §A — A SUGGESTION MAY ONLY SAY WHAT THE RECORD SAYS. The walk's
    // panel told her to "reach out to Angela Wu" and quoted "68% participant
    // retention", none of it on the record, in raw **markdown**. The stream is
    // held until it ends, then every sentence goes through the validator
    // (shared/suggestionGuard.js): a line naming a person, a number or a claim
    // the record does not carry is left out and COUNTED, and markdown is
    // stripped. A prompt that says "use only the data" is a request; this is
    // the rule.
    let full="";
    try{
      setAiErr(p=>{const n={...p};delete n[key];return n;});
      await askClaude(sys,prompts[type],chunk=>{full=chunk;});
      const record={
        donor:{id:donor.id,name:donor.name,email:donor.email,contact_name:donor.contactName||donor.contact_name,notes:donor.notes,
               total:donor.total,gifts:donor.gifts,lastAmount:donor.lastAmount,lastGift:donor.lastGift},
        orgName:[data.org?.name,data.org?.mission].filter(Boolean).join(" "),
        names:[stage.label,...(donor.tags||[])],
        today:localToday(),
        openItems:Array.isArray(openItems)?openItems:[],
        // GTM-1a 0 — the contact row is the TILE's figure, and when nobody
        // has logged a conversation there is no row at all. It used to be
        // moveUrgency's fallback-to-the-last-gift number, which both fed the
        // prompt and told the validator that number was allowed in the
        // output — so "over four months since the last conversation" passed
        // the guard on a record whose own tile said "Never contacted."
        rows:[...(gap.days===null?[]:[{id:"contact",count:gap.days}]),
              ...(donor.interactions||[]).slice(0,20).map((i,n)=>({id:i.id||("int"+n),amount:i.amount,date:i.date,label:i.note,type:i.type}))],
      };
      // FIX-3 finding 11 — the next move is three fields, and composeNextMove
      // (shared/nextMove.js) turns them into three plain sentences, each
      // through the same validator. Every other kind stays prose.
      // HOTFIX-1 — a refused line is DROPPED SILENTLY and logged. The panel
      // shows what survived; when nothing survives it shows nothing at all,
      // rather than a sentence about Steward's own plumbing.
      let out;
      if(type==="nextmove"){
        const c=composeNextMove(full,record);
        if(c.log)console.info(c.log);
        out=c.text;
      } else {
        const g=guardSuggestion(full,record);
        if(g.dropped)console.info(dropLog(g.dropped,g.reasons));
        out=g.kept.map(k=>plainText(k.text)).join(" ");
      }
      setAiMap(p=>({...p,[key]:out}));
    }
    catch(e){
      // The status code and the real cause are already in the console
      // (api.js). What she reads is one sentence and a button.
      console.warn("[suggest] %s failed: %s",String(key),errorMessage(e,"no reason given"));
      setAiErr(p=>({...p,[key]:"Suggestions aren't available right now."}));
    }
    finally{setLoadingKey(null);}
  };

  // LIST-6: custom fields are filtered on the server now, so a saved value only re-reads the list's page.
  const reloadCfValues=()=>setDirReloadKey(k=>k+1);

  const reloadDonors=async()=>{
    // Reuse the shared single-donor adapter (see api.js's adaptDonor comment)
    // — this hand-duplicated mapping previously dropped assignedTo/
    // assignedToName (and wealth score, city/state/zip, employer, etc.) from
    // local state on every refresh, which is especially costly here since
    // reloadDonors() is the general post-action refresh (import, gift log,
    // custom field save…), not a rare path.
    // SCALE-2: the whole-org list reloads only if a whole-org view has it.
    forgetAllPeople();
    loadPeopleCount();
    setDirReloadKey(k=>k+1); // refresh the Directory's server page too
    try{
      if(orgPeople)setOrgPeople(await allPeople({signal:leaveSignal()}));
    }catch(e){if(!isAbort(e))console.error(e);}
  };

  // HOME-3 item 4: an import finished (or anything Tell Steward did): the
  // count, the directory and the whole-org list re-read, so "No donors yet"
  // never outlives the file that filled the page.
  useStewardTold(()=>{reloadDonors();});
  // STALE-1: and a write anywhere that adds, removes or merges people (not every
  // write to one person's record: their profile re-reads itself).
  // SCALE-6 item 3 (W-1112-Volunteers-01X): the portfolio totals (each owner's people and
  // dollars) re-read after a gift, a delete, an owner change or the worker's after-change.
  useLive("donors.officers",["gift","person","totals"],c=>{
    loadOfficers();
    // And the people a write named (a gift recorded from here, a profile or Home), re-read
    // by id into the whole-org list Team sums and Kanban groups, without reading the org again.
    const named=c&&c.ids&&c.ids.person?[...c.ids.person]:[];
    if(!orgPeople||!named.length||named.length>200)return;
    peopleById(named).then(fresh=>{if(Object.keys(fresh).length)setOrgPeople(list=>Array.isArray(list)?list.map(d=>fresh[d.id]?{...d,...fresh[d.id]}:d):list);}).catch(()=>{});
  });
  useLive("donors.list",["person","import"],c=>{if(c.source==="told")return;if(c.kinds.has("import")||c.source==="worker"||c.method==="DELETE"||ADDS_PEOPLE.test(c.path||"")||/^\/donors\/bulk|^\/removals|merge|^\/trash|^\/households?\b/.test(c.path||""))reloadDonors();});

  // FRESH-2 item 5: the open record itself (the Notes summary line, "Fresh has given $100 in all",
  // and every effect keyed on it) re-reads when a change reaches this person; the profile's own
  // panels re-read themselves, this is the record they were handed.
  useLive("profile.record",["gift","person","note","totals"],()=>{
    const id=selectedRef.current?.id;
    if(!id||!selectedRef.current.fullRecord)return;
    apiFetch(`/donors/${id}`).then(full=>setSelected(prev=>prev?.id===id?{...adaptDonor(full),fullRecord:true,lastTouchpoint:prev.lastTouchpoint??null,interactions:prev.interactions||[]}:prev)).catch(()=>{});
  },{ids:{person:selected?.id}});

  // SCALE-2: open someone only if they are still on file (the old list's
  // .find()), asked of the server by id; otherwise run `orElse`.
  const openIfOnFile=async(id,orElse)=>{
    let d=null;
    try{d=(await peopleById([id]))[id]||null;}catch(e){console.error(e);}
    if(d)selectDonor(d);else if(orElse)orElse();
  };
  // Selecting a donor from any view hands DonorProfile a summary row first
  // (instant render), then swaps in the full record — notes, score rationale,
  // Stripe ids — from GET /donors/:id (the summaries list deliberately omits
  // the heavy columns; see BUILD-06 Phase A).
  const selectDonor=async(d,attempt=0)=>{
    if(!d){setSelected(null);return;}
    if(attempt===0){setSelected(d);openProfileReads(d.id);}   // PROFILE-SPEED-1: the record rides in the first screen's one request
    try{
      const full=await apiFetch(`/donors/${d.id}`);
      setSelected(prev=>prev?.id===d.id?{
        ...adaptDonor(full),fullRecord:true,
        lastTouchpoint:prev.lastTouchpoint??null,
        interactions:prev.interactions||[],
      }:prev);
    }catch(e){
      // THREAD-2 · a link to somebody this person can't see (another org's
      // record, or one removed) says so, and shows nothing of it.
      // LIST-2: a person who isn't on file says so, in words.
      if(e&&e.status===404){setSelected(prev=>prev?.id===d.id?{id:d.id,notFound:true}:prev);return;}
      if(e&&e.status===403){setSelected(prev=>prev?.id===d.id?{id:d.id,noAccess:true}:prev);return;}
      console.error(e);
      // FIX-45 1.5: a failed read recovers by itself (two more tries, still
      // "Loading this person…"); only then does it offer Try again.
      if(attempt<2){setTimeout(()=>{const cur=selectedRef.current;if(cur?.id===d.id&&!cur.fullRecord)selectDonor(d,attempt+1);},800*(attempt+1));return;}
      setSelected(prev=>prev?.id===d.id&&!prev.name?{id:d.id,loadFailed:true}:prev);
    }
  };

  // FIX-13 Part 6 — the address bar follows the list and the open profile.
  // Opening or closing a profile is a step Back undoes; a filter or a
  // keystroke in search replaces the entry rather than piling up history.
  useEffect(()=>{
    // LIST-6: the filters are LF, the address's own (or, under a profile, the list's last), so this
    // writes back only what the address does not already hold: the tab, the panels and the sort.
    const href=selected?.id?donorHref(selected.id):donorsListHref({...LF,view,noMeeting:noMeetingOpen,warmUnasked:warmOpen,nmOwner:noMeetingOpen?nmFilter.owner:"",nmMin:noMeetingOpen?nmFilter.min:"",sort:dirSort,dir:dirDir});
    const here=window.location.pathname+window.location.search;
    if(href===here)return;
    const step=selected?.id?!here.startsWith(donorHref(selected.id)):here.startsWith("/donors/");
    routerNavigate(href,{replace:!step,state:{internal:true}});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[selected?.id,view,LF,noMeetingOpen,warmOpen,nmFilter.owner,nmFilter.min,dirSort,dirDir]);

  const handleEditSaved=(raw)=>{
    // Reuse the same single-donor adapter adaptData() uses for the initial
    // load — a hand-duplicated shorter field list here previously dropped
    // assignedTo/assignedToName (and wealth score, city/state/zip, etc.)
    // from local state after every edit, even though the database itself
    // was untouched (see api.js's adaptDonor comment).
    const adapted={
      ...adaptDonor(raw),fullRecord:true,
      interactions:selected?.id===raw.id?(selected.interactions||[]):[],
      lastTouchpoint:selected?.id===raw.id?selected.lastTouchpoint:null,
    };
    patchPeople(list=>list.map(d=>d.id===raw.id?adapted:d));
    setDirRows(prev=>prev?prev.map(d=>d.id===raw.id?{...adapted,room:adapted.room||d.room}:d):prev);   // FIX-33: an edit's reply carries no Room to give
    if(selected?.id===raw.id)setSelected(adapted);
    setEditTarget(null);
  };

  // INTEGRITY-2 (W-1108-Finance-50X): Delete asks first, naming what goes with them.
  const [deleteAsk,setDeleteAsk]=useState(null);
  const deleteDonor=id=>setDeleteAsk({id,name:(selected&&selected.id===id&&selected.name)||"this person"});
  const deleteDonorNow=async(id,opts={})=>{
    // FIX-12 (HELP-1 list): delete is a soft delete, so "cannot be undone" was untrue.
    // FIX-22: Undo brings it back for a minute; Restore in Settings, Trash for 30 days.
    setDeleteAsk(null);
    try{
      const r=await apiFetch(`/donors/${id}${opts.voidReceipts?"?voidReceipts=1":""}`,{method:"DELETE"});   // TRASH-1: her yes to "Void them?"
      offerUndo(r,"donor",back=>{setDirReloadKey(k=>k+1);const rec=back&&back.record;if(rec)patchPeople(list=>list.some(d=>d.id===rec.id)?list:[...list,adaptDonor(rec)]);loadPeopleCount();});
      patchPeople(list=>list.filter(d=>d.id!==id));loadPeopleCount();
      setDirRows(prev=>prev?prev.filter(d=>d.id!==id):prev);
      setDirTotal(t=>Math.max(0,t-1));
      setSelected(null);
    }catch(e){
      if(e&&e.error==="active_plan"){setPlanBlock({id,sentence:e.sentence});return;}
      console.error(e);
    }
  };
  // THREAD-3: archive keeps the plan running and takes them off the lists.
  const archiveDonor=async(id)=>{
    try{
      const r=await apiFetch(`/donors/${id}/archive`,{method:"POST",body:"{}"});
      setPlanBlock(null);
      patchPeople(list=>list.filter(d=>d.id!==id));loadPeopleCount();
      setDirRows(prev=>prev?prev.filter(d=>d.id!==id):prev);
      setDirTotal(t=>Math.max(0,t-1));
      setSelected(null);
      offerUndo({message:r.sentence,undoAction:async()=>{const x=await apiFetch(`/donors/${id}/unarchive`,{method:"POST",body:"{}"});setDirReloadKey(k=>k+1);return x;}},"person");
    }catch(e){setPlanBlock(b=>b&&{...b,err:errorMessage(e,"That did not save.")});}
  };

  const generateCallList=async()=>{
    setCallLoading(true);setCallList("");
    const everyone=orgPeople||await allPeople({signal:leaveSignal()}).catch(e=>isAbort(e)?null:[]);   // SCALE-2: loaded for this, not on sign-in
    if(!everyone){setCallLoading(false);return;}   // COMMS-SPEED-1: Donors was left before the list came
    await askClaude(`You are a chief development officer. Be tactical. Max 200 words.`,
      `Prioritized call list for this week:\n${everyone.map(d=>`${d.name} [${d.stage||"cultivate"}]: ${daysDiff(d.lastTouchpoint||d.lastGift)}d since contact, ${fmtFull(d.lastAmount)} last gift, giving strength ${givingStrengthOf(d)??"none (no gifts on file)"}, notes: ${d.notes}`).join("\n")}`,
      chunk=>setCallList(chunk));
    setCallLoading(false);
  };

  const[newDonorAssignee,setNewDonorAssignee]=useState("");
  const[addErr,setAddErr]=useState("");   // SECURE-2: the server's sentence when it refuses a new person
  const[addWarn,setAddWarn]=useState("");   // INTEGRITY-1: an email already on someone else, said on save
  // QUICKADD-1: "Added Maria Lopez. Open" after Save and add another; Record a gift from Donors.
  const[addToast,setAddToast]=useState(null);
  const[recordGiftOpen,setRecordGiftOpen]=useState(false);

  // QUICKADD-1 (a beta customer, 10 Nov): Save never leaves anyone where they were with
  // nothing happening. "open" lands on the new profile; "gift" lands there with
  // Record a gift open (the profile's own gift form, the person filled in);
  // "another" keeps the form, emptied, with "Added Maria Lopez. Open".
  const addDonor=async(then="open")=>{
    if(!newDonor.name)return;
    const assignTo=newDonorAssignee||userId;
    const assignToName=newDonorAssignee?(orgTeam.find(u=>u.id===newDonorAssignee)?.name||""):userName;
    // BUILD-80 Part 10 — a typed last amount NEVER stamps a last-gift date
    // of today (the same class BUILD-79 Part 4 killed on the import paths):
    // the amount tells us what they gave, not when. No date means no date.
    const temp={id:"tmp_"+Date.now(),name:newDonor.name,email:newDonor.email,phone:newDonor.phone,
      total:parseInt(newDonor.lastAmount)||0,lastGift:null,
      lastAmount:0,gifts:0,   // FLOWS-11: a total from before Steward is not a gift
      status:"new",stage:newDonor.stage,tags:[],notes:"",interactions:[],lastTouchpoint:null,
      assignedTo:assignTo,assignedToName:assignToName};
    // SECURE-2: the form stays open until the server takes it, so a refusal
    // (an email that is not one, a name too long) is read, not lost.
    setAddErr("");
    try{
      const made=await apiFetch("/donors",{method:"POST",body:JSON.stringify({...newDonor,stage:newDonor.stage,assignedTo:assignTo,assignedToName:assignToName})});
      setAddWarn(made&&made.warning?made.warning.sentence:"");
      patchPeople(list=>[...list,temp]);
      setNewDonor({name:"",email:"",phone:"",address:"",address2:"",city:"",state:"",zip:"",lastAmount:"",stage:"prospect"});setNewDonorAssignee("");setAddMore(false);
      if(then==="another"){setAddToast(made&&made.id?{id:made.id,name:made.name}:null);await reloadDonors();return;}
      setShowAdd(false);setAddToast(null);
      if(made&&made.id){
        if(then==="gift")setGiftHandoff({donorId:made.id,carry:true});
        selectDonor(adaptDonor(made));
      }
      reloadDonors();
    }
    catch(e){
      if(e.error==="record_limit"){
        setShowAdd(false);
        setUpgradeModal({reason:e.error,current:e.current,limit:e.limit,plan:e.plan});
      } else setAddErr(errorMessage(e, "Steward could not save this person."));
    }
  };

  return(
    <SheetDropTarget disabled={isReadOnly} onFile={f=>setDroppedFile(f)} style={{display:"flex",flexDirection:"column",gap:8}}>
      {/* PROFILE-2 Part 1: an open profile is the whole page; the list's title and chips sat above it once the profile stopped being a fixed panel. */}
      {/* NUMBERS-5: the heading names the people the Directory shows (IMPORT-6's walk read "Your donors." over Everyone) */}
      {!selected&&(view==="directory"&&(dirPeopleShown||dirPeople)==="everyone"?<PageTitle main="" accent="Everyone."/>
        :view==="directory"&&(dirPeopleShown||dirPeople)==="contacts"?<PageTitle main="Your" accent="contacts."/>
        :<PageTitle main="Your" accent="donors."/>)}
      {/* FIX-55: a spreadsheet dropped anywhere on Donors opens the one reader with it */}
      {droppedFile&&<SpreadsheetImport key={droppedFile.name+droppedFile.lastModified} file={droppedFile} onClose={()=>setDroppedFile(null)} onImported={()=>{reloadDonors();setDroppedFile(null);}}/>}
      {/* INT-BUILD-1 Part 6 — moves management: who has not been met. */}
      {!selected&&<div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
        <button type="button" data-testid="filter-no-meeting" aria-pressed={noMeetingOpen} onClick={()=>setNoMeetingOpen(o=>!o)}
          style={{background:noMeetingOpen?T.ink:T.white,color:noMeetingOpen?T.inkInverse:T.ink,border:"1px solid "+(noMeetingOpen?T.ink:T.bg3),borderRadius:99,padding:"6px 14px",fontSize:13,fontWeight:600,cursor:"pointer"}}>No meeting in 90 days</button>
        {/* ENGAGE-1 — the people closest to giving more who have not been asked. */}
        <button type="button" data-testid="filter-warm-not-asked" aria-pressed={warmOpen} onClick={()=>setWarmOpen(o=>!o)}
          style={{background:warmOpen?T.ink:T.white,color:warmOpen?T.inkInverse:T.ink,border:"1px solid "+(warmOpen?T.ink:T.bg3),borderRadius:99,padding:"6px 14px",fontSize:13,fontWeight:600,cursor:"pointer"}}>Warm but not asked this year</button>
      </div>}
      {!selected&&warmOpen&&<WarmNotAskedPanel officers={officers} onSelectDonor={id=>selectDonor({id})} onClose={()=>setWarmOpen(false)}/>}
      {!selected&&noMeetingOpen&&<NoRecentMeetingPanel officers={officers} onSelectDonor={id=>selectDonor({id})} onClose={()=>setNoMeetingOpen(false)}
        initialOwner={nmFilter.owner} initialMin={nmFilter.min} onFilterChange={setNmFilter}/>}
      {assignTarget&&<AssignModal donor={assignTarget} orgTeam={orgTeam} onSave={handleAssign} onClose={()=>setAssignTarget(null)}/>}
      {showImport&&<SpreadsheetImport onClose={()=>setShowImport(false)} onImported={()=>{reloadDonors();setShowImport(false);}}/>}
      {showGiftImport&&<SpreadsheetImport onClose={()=>setShowGiftImport(false)} onImported={()=>{reloadDonors();setShowGiftImport(false);}}/>}
      {screenFor&&<ScreeningFileModal who={screenFor} onClose={()=>setScreenFor(null)}/>}
      {screenImport&&<ScreeningImportModal onClose={()=>setScreenImport(false)} onDone={()=>reloadDonors()}/>}
      {showMerge&&<MergeDuplicatesModal onClose={()=>setShowMerge(false)} onMerged={reloadDonors} isReadOnly={isReadOnly}/>}
      {showGrantImport&&<GrantImport onClose={()=>setShowGrantImport(false)} parseFile={parseFileToSheets} onDone={reloadDonors}/>}
      {/* REPORTS-5: the second door to the one old-reports wizard. */}
      {showOldReports&&<OldReportsImport onClose={()=>setShowOldReports(false)}/>}
      {/* IMPORT-2: notes and history. Also opened from a profile's "No history
          yet" and from the donor import's last screen, by one window event. */}
      {showHistory&&<HistoryImport onClose={()=>setShowHistory(false)} onDone={reloadDonors}/>}
      {showSheetImport&&<SpreadsheetImport onClose={()=>setShowSheetImport(false)} onImported={()=>{reloadDonors();setShowSheetImport(false);}}/>}
      {showHours&&<HoursImportModal onClose={()=>setShowHours(false)} onDone={reloadDonors} Modal={Modal} Papa={Papa} presets={HOURS_PRESETS_MOD}/>}
      {/* HARDEN-1: every door that opened the old mapper (Import + History,
          Import donors only, Add giving history, Home's and onboarding's
          openImport) opens the one reader, SpreadsheetImport. */}
      {showCombinedImport&&<SpreadsheetImport onClose={()=>setShowCombinedImport(false)} onImported={()=>{reloadDonors();setShowCombinedImport(false);}}/>}
      {upgradeModal&&<UpgradeModal open={true} onClose={()=>setUpgradeModal(null)} reason={upgradeModal.reason} current={upgradeModal.current} limit={upgradeModal.limit} plan={upgradeModal.plan}/>}
      {logTarget&&<LogTouchpointModal donor={logTarget} onSave={int=>handleLogged(logTarget,int)}
        onRecordGift={opts=>{const d=logTarget;setLogTarget(null);selectDonor(d);setGiftHandoff({donorId:d.id,date:opts&&opts.date});}}
        onClose={()=>setLogTarget(null)}/>}
      {convoPickerOpen&&<LogTouchPicker noPeople={!!(peopleCount&&peopleCount.total===0)} onClose={()=>setConvoPickerOpen(false)}
        onPickOne={d=>{setConvoPickerOpen(false);setConvoTarget(d);}} onBatchDone={()=>{reloadDonors&&reloadDonors();}}/>}
      {convoTarget&&<LogConversationModal donor={{id:convoTarget.id,name:convoTarget.name}} org={data.org} onNavigate={onNavigate}
        onSaved={()=>{reloadDonors&&reloadDonors();}} onClose={()=>setConvoTarget(null)}/>}
      {followUpTarget&&<FollowUpTaskModal donor={followUpTarget} onClose={()=>setFollowUpTarget(null)} onSave={task=>{setData(prev=>({...prev,tasks:[task,...prev.tasks]}));setFollowUpTarget(null);}}/>}
      {/* FIX-56: the form is the full record, never the summary or the bare id a
          profile opens with. It opens again when the full record lands, and Save
          waits for it, so an early Edit can't save blanks over what is on file. */}
      {editTarget&&(d=>d&&<EditDonorModal key={d.id+(d.fullRecord?":full":":part")} donor={d} onSave={handleEditSaved} onClose={()=>setEditTarget(null)}/>)(selected?.id===editTarget.id?selected:editTarget)}
      {deleteAsk&&<DeletePersonConfirm person={deleteAsk} onClose={()=>setDeleteAsk(null)} onConfirm={opts=>deleteDonorNow(deleteAsk.id,opts)}/>}
      {planBlock&&<Modal onClose={()=>setPlanBlock(null)} width={420} ariaLabel="This person has a monthly plan">
        <div data-testid="delete-plan-block" style={{display:"flex",flexDirection:"column",gap:12}}>
          <div style={{fontSize:16,fontWeight:800,color:T.ink}}>Not deleted</div>
          <div data-testid="delete-plan-sentence" style={{fontSize:14,color:T.ink,lineHeight:1.5}}>{planBlock.sentence}</div>
          <div style={{fontSize:12.5,color:T.ink3,lineHeight:1.45}}>Steward never cancels a plan for you. Archiving takes them off your lists and their gifts keep arriving.</div>
          {planBlock.err&&<div role="alert" style={{fontSize:13}}>{planBlock.err}</div>}
          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
            <button type="button" data-testid="delete-plan-archive" onClick={()=>archiveDonor(planBlock.id)} style={{background:T.greenDk,color:T.white,border:"none",borderRadius:8,padding:"9px 16px",fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>Archive instead</button>
            <button type="button" onClick={()=>setPlanBlock(null)} style={{background:T.bg2,color:T.ink,border:"none",borderRadius:8,padding:"9px 16px",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>Keep them</button>
          </div>
        </div>
      </Modal>}
      {selected&&addWarn&&<div data-testid="add-email-warning" role="status" style={{background:T.bg2,border:"1px solid "+T.gold600,borderRadius:8,padding:"8px 12px",fontSize:12.5,color:T.ink,margin:"0 0 10px",display:"flex",gap:10,alignItems:"center"}}><span style={{flex:1}}>{addWarn}</span><button type="button" onClick={()=>setAddWarn("")} style={{background:"none",border:"none",color:T.greenDk,fontWeight:700,cursor:"pointer"}}>OK</button></div>}
      {recordGiftOpen&&<RecordGiftDialog testid="record-gift" carry onClose={()=>setRecordGiftOpen(false)}/>}
      {selected?.noAccess ? (
        <div data-testid="no-access" style={{padding:"40px 24px",textAlign:"center",color:T.ink,fontSize:15}}>
          <div style={{fontWeight:700,marginBottom:6}}>You don't have access to this.</div>
          <button onClick={()=>setSelected(null)} style={{background:T.white,border:"1px solid "+T.ink,borderRadius:8,padding:"7px 14px",fontWeight:700,cursor:"pointer",fontFamily:"inherit",color:T.ink}}>Back to people</button>
        </div>
      ) : selected?.notFound ? (
        <div data-testid="person-not-found" style={{padding:"40px 24px",textAlign:"center",color:T.ink,fontSize:15}}>
          <div style={{fontWeight:700,marginBottom:6}}>We couldn't find this person.</div>
          <div style={{fontSize:13,color:T.ink3,marginBottom:12}}>They may have been merged into another record or deleted.</div>
          <button onClick={()=>setSelected(null)} style={{background:T.white,border:"1px solid "+T.ink,borderRadius:8,padding:"7px 14px",fontWeight:700,cursor:"pointer",fontFamily:"inherit",color:T.ink}}>Back to people</button>
        </div>
      ) : selected?.loadFailed ? (
        <div data-testid="person-load-failed" role="alert" style={{padding:"40px 24px",textAlign:"center",color:T.ink,fontSize:15}}>
          <div style={{fontWeight:700,marginBottom:6}}>This person's record didn't load.</div>
          <button onClick={()=>selectDonor({id:selected.id})} style={{background:T.greenDk,border:"none",borderRadius:8,padding:"7px 14px",fontWeight:700,cursor:"pointer",fontFamily:"inherit",color:T.white}}>Try again</button>
        </div>
      ) : selected && !selected.name && !selected.fullRecord ? (
        // LIST-2: opened by id (Cmd+K, a link, Atlas): nothing is drawn from a
        // record that hasn't arrived, so no "Add a photo for undefined".
        <div data-testid="person-loading" role="status" aria-live="polite" style={{padding:"40px 24px",textAlign:"center",color:T.ink3,fontSize:14}}>Loading this person…</div>
      ) : selected ? (
      <ErrorBoundary key={selected.id+(selected.deceased?":in-memory":"")}><DonorProfile donor={selected} onRecordChanged={()=>{selectDonor(selected,1);apiFetch("/tasks").then(t=>{if(Array.isArray(t))setData(prev=>({...prev,tasks:t}));}).catch(()=>{});}} onClose={()=>{setSelected(null);setGiftHandoff(null);}}
        onStageChange={moveToStage} onLogTouchpoint={()=>{setLogTarget(selected);}}
        aiMap={aiMap} aiErr={aiErr} loadingKey={loadingKey} getAI={getAI}
        isAdmin={isAdmin} onEdit={()=>setEditTarget(selected)} onDelete={deleteDonor}
        tasks={data.tasks.filter(t=>t.donorId===selected.id)} onAddTask={()=>setFollowUpTarget(selected)}
        orgName={data.org?.name||""} org={data.org} orgTeam={orgTeam} onReassign={handleAssign} onCfSaved={reloadCfValues} onInteractionAdded={reloadDonors}
        onNavigate={onNavigate}
        initialOpenConversation={openIntent.conversation&&selected.id===openIntent.id}
        initialOpenCompose={openIntent.compose&&selected.id===openIntent.id}
        initialOpenBrief={openIntent.brief&&selected.id===openIntent.id}
        initialAddGift={giftHandoff&&giftHandoff.donorId===selected.id?giftHandoff:null}
        isReadOnly={isReadOnly} onSelectRelatedDonor={openIfOnFile}/></ErrorBoundary>
      ) : (<>

      <div className="donors-toolbar" style={{display:"flex",gap:10,flexWrap:"wrap",alignItems:"center"}}>
        <input className="donors-search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search name, email, phone or household" aria-label="Search people by name, email, phone, household or linked organization" title="Finds a name, email, phone, household or linked organization. For words in notes or tags, use + Add filter, then Notes or tags." style={{flex:1,minWidth:160,background:T.bg,border:"1px solid "+T.bg3,borderRadius:10,padding:"10px 14px",color:T.ink,fontSize:13,outline:"none"}}/>
        <div className="donors-view-toggle" style={{display:"flex",background:T.bg,border:"1px solid "+T.bg3,borderRadius:10,overflow:"hidden"}}>
          {[["directory","Directory"],...(isAdmin?[["team","Team"]]:[]),["reengage","Re-engage"],...(mapOn?[["map","Map"]]:[]),["health","Data health"]].map(([v,l])=>(
            <button key={v} onClick={()=>setView(v)} style={{background:view===v?T.bg2:"transparent",border:"none",padding:"9px 14px",color:view===v?T.ink:T.ink3,fontSize:13,fontWeight:view===v?700:400,cursor:"pointer",display:"flex",alignItems:"center",gap:5,whiteSpace:"nowrap",flexShrink:0}}>
              {l}
              {v==="reengage"&&reCountWords&&<span data-testid="reengage-count" data-population="reengage" title={listFilterOn?"Lapsed people in the list below, of everyone lapsed":undefined} style={{background:T.greenDk,color:T.white,borderRadius:99,padding:"1px 6px",fontSize:10,fontWeight:800,lineHeight:1.4}}>{reCountWords}</span>}
            </button>
          ))}
        </div>
        {data?.org?.capabilities?.ai&&<AIBtn onClick={generateCallList} loading={callLoading} label="✦ Call List"/>}
        {/* BUILD-81 Part 5 — logging a conversation is the primary act (it IS
            creating the follow-up); above the fold at 1440 and 390. */}
        <button onClick={()=>setConvoPickerOpen(true)} disabled={isReadOnly} title={isReadOnly?"Reactivate your subscription to make changes.":undefined} style={{background:T.gold500,border:"none",borderRadius:10,padding:"10px 14px",color:T.ink,fontSize:13,fontWeight:800,cursor:isReadOnly?"not-allowed":"pointer",opacity:isReadOnly?0.45:1}}>Log a touch</button>
        <button onClick={()=>setShowAdd(!showAdd)} disabled={isReadOnly} title={isReadOnly?"Reactivate your subscription to make changes.":undefined} style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:10,padding:"10px 14px",color:T.ink2,fontSize:13,fontWeight:700,cursor:isReadOnly?"not-allowed":"pointer",opacity:isReadOnly?0.45:1}}>+ Add</button>
        <button onClick={()=>setRecordGiftOpen(true)} disabled={isReadOnly} data-testid="donors-record-gift" title={isReadOnly?"Reactivate your subscription to make changes.":"Record a gift, from someone on file or a new person"} style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:10,padding:"10px 14px",color:T.ink2,fontSize:13,fontWeight:700,cursor:isReadOnly?"not-allowed":"pointer",opacity:isReadOnly?0.45:1}}>Record a gift</button>
        {/* BUILD-33 Part 3 — ONE "Import & tools" menu instead of four sibling
            buttons. "Import + History" is the recommended default (the magical
            one-file path); the others are labeled as the specific cases they
            serve. Every path stays reachable. */}
        <div style={{position:"relative"}}>
          <button onClick={()=>setToolsOpen(v=>!v)} aria-haspopup="menu" aria-expanded={toolsOpen} style={{background:toolsOpen?T.bg2:T.bg,border:"1px solid "+T.bg3,borderRadius:10,padding:"10px 14px",color:T.ink2,fontSize:13,fontWeight:600,cursor:"pointer",display:"flex",alignItems:"center",gap:6}}>↑ Import &amp; tools <span style={{fontSize:10,color:T.ink3}}>▾</span></button>
          {toolsOpen&&<>
            <div onClick={()=>setToolsOpen(false)} style={{position:"fixed",inset:0,zIndex:180}}/>
            <div role="menu" style={{position:"absolute",right:0,top:"calc(100% + 6px)",zIndex:181,background:T.white,border:"1px solid "+T.bg3,borderRadius:12,boxShadow:T.shadowMd,minWidth:280,padding:6,display:"flex",flexDirection:"column"}}>
              {[
                // HARDEN-1: one reader for every people or gifts file. The old
                // "Import Donors" mapper called 656 contacts "656 donors", showed
                // no matching and balanced only gift rows; its doors are gone.
                {label:"Import a spreadsheet",hint:"Donors, gifts, contacts or an event night's sheet: Steward reads it, matches the people already here, and asks only what it can't tell",badge:"Recommended",act:()=>setShowSheetImport(true)},
                {label:"Bring your notes and history",hint:"Notes, calls, meetings, open tasks and letters from your old system",act:()=>setShowHistory(true)},
                {divider:true},
                {label:"Import volunteer hours",hint:"A Wranglr or VolunteerHub hours export",act:()=>setShowHours(true)},
                {label:"Import grants",hint:"A grants spreadsheet from another system, or your own",act:()=>setShowGrantImport(true)},
                {label:"Import old reports",hint:"Reports from the system you used before, kept under Reports",act:()=>setShowOldReports(true)},
                {label:"Data health",hint:"Duplicates, addresses, moves and emails to tidy",act:()=>setView("health")},
                // FIX-58: screening lives here, not on the toolbar.
                ...(canMajorGifts?[{divider:true},
                  {label:"Prepare a screening file",hint:"A saved group, in the layout screening providers take",testid:"dir-screening-group",act:()=>setScreenFor({donorIds:[]})},
                  ...(!isReadOnly?[{label:"Bring in screening results",hint:"A screening provider's file of capacity and real estate ranges",testid:"dir-screening-import",act:()=>setScreenImport(true)}]:[]),
                  ...(isAdmin?[{check:true,label:"Include screening results in Export CSV",hint:"Adds provider, date, capacity range and real estate range",testid:"dir-export-screening"}]:[]),
                ]:[]),
              ].map((it,i)=>it.divider?<div key={i} style={{height:1,background:T.bg3,margin:"4px 8px"}}/>:it.check?(
                <label key={i} data-testid={it.testid} className="click-card" style={{borderRadius:8,padding:"9px 10px",cursor:"pointer",display:"flex",gap:8,alignItems:"flex-start"}}>
                  <input type="checkbox" checked={includeScreening} onChange={e=>setIncludeScreening(e.target.checked)} style={{accentColor:T.greenDk,marginTop:2}}/>
                  <span><span style={{fontSize:13,fontWeight:700,color:T.ink,display:"block"}}>{it.label}</span><span style={{fontSize:11.5,color:T.ink3}}>{it.hint}</span></span>
                </label>
              ):(
                <button key={i} role="menuitem" data-testid={it.testid} onClick={()=>{setToolsOpen(false);it.act();}} className="click-card" style={{background:"none",border:"none",borderRadius:8,padding:"9px 10px",textAlign:"left",cursor:"pointer",display:"block",width:"100%"}}>
                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                    <span style={{fontSize:13,fontWeight:700,color:T.ink}}>{it.label}</span>
                    {it.badge&&<span style={{background:T.gold100,color:T.gold700,border:"1px solid "+T.gold300,borderRadius:99,padding:"1px 8px",fontSize:10,fontWeight:800}}>{it.badge}</span>}
                  </div>
                  <div style={{fontSize:11.5,color:T.ink3,marginTop:2}}>{it.hint}</div>
                </button>
              ))}
            </div>
          </>}
        </div>
      </div>

      {/* LIST-6 item 5: the whole-org views have no filter bar of their own; they read the list's (above). */}
      {wholeOrgView&&view!=="reengage"&&<FilteredChip count={reFilterN} onClear={clearFilters}/>}

      {(callLoading||callList)&&<AIPanel text={callList} onClose={()=>setCallList("")}/>}

      {showAdd&&<Card style={{gap:10,display:"flex",flexDirection:"column"}}>
        <div style={{fontSize:14,fontWeight:700,color:T.ink}}>New Donor</div>
        {addToast&&<div data-testid="add-toast" role="status" style={{display:"flex",alignItems:"center",gap:10,background:T.gold50,border:"1px solid "+T.gold300,borderRadius:8,padding:"7px 10px",fontSize:12.5,color:T.ink}}>
          <span style={{flex:1}}>Added {addToast.name}. <button type="button" data-testid="add-toast-open" onClick={()=>{const t=addToast;setAddToast(null);setShowAdd(false);selectDonor({id:t.id,name:t.name});}} style={{background:"none",border:"none",padding:0,color:T.greenDk,fontWeight:700,cursor:"pointer",textDecoration:"underline",fontSize:12.5}}>Open</button></span>
          <button type="button" aria-label="Dismiss" onClick={()=>setAddToast(null)} style={{background:"none",border:"none",padding:0,color:T.ink3,cursor:"pointer",fontSize:14}}>×</button></div>}
        <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
          {STAGES.map(s=><button key={s.id} aria-pressed={newDonor.stage===s.id} onClick={()=>setNewDonor(p=>({...p,stage:s.id}))} style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:7,padding:"5px 11px",color:T.ink3,fontSize:12,fontWeight:600,cursor:"pointer",...activeMark(newDonor.stage===s.id,"bottom")}}>{s.label}</button>)}
        </div>
        {/* ADDRESS-1: each field has a visible label, and the mailing address is asked for here too. */}
        {[[["name","Full name"]],[["email","Email"]],[["phone","Phone"]],[["address","Street address"]],[["address2","Apt, suite (optional)"]],[["city","City",2],["state","State",1],["zip","ZIP",1]],...(addMore?[[["lastAmount","Giving before Steward (a total from your old system, not a gift)"]]]:[])].map(row=>(
          <div key={row[0][0]} style={{display:"flex",gap:8,flexWrap:"wrap"}}>{row.map(([k,lb,fl])=>(
            <label key={k} style={{display:"flex",flexDirection:"column",gap:5,flex:fl?`${fl} 1 ${fl*60}px`:"1 1 100%",minWidth:0}}>
              <span style={{fontSize:11,fontWeight:700,color:T.ink3}}>{lb}</span>
              <input value={newDonor[k]} autoComplete="off" data-testid={"add-"+k} onChange={e=>setNewDonor(p=>({...p,[k]:e.target.value}))} style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"9px 12px",color:T.ink,fontSize:13,outline:"none",minWidth:0}}/>
            </label>))}</div>
        ))}
        {/* FLOWS-11 (W-1114-Finance-26X): no bare "Gift amount". A gift is recorded on the profile's own gift
            form (Save and record a gift, through recordGift); this box is only an old system's total, behind More. */}
        {!addMore?<button type="button" data-testid="add-more" onClick={()=>setAddMore(true)} style={{alignSelf:"flex-start",background:"none",border:"none",padding:0,color:T.greenDk,fontWeight:600,fontSize:12.5,cursor:"pointer",textDecoration:"underline"}}>More</button>
          :<div data-testid="add-before-steward-note" style={{fontSize:12,color:T.ink3,lineHeight:1.5}}>It shows in Lifetime as "includes $… from before Steward" and is never counted as a gift. To record a gift, use Save and record a gift.</div>}
        {emailHint(newDonor.email)&&<div data-testid="add-email-hint" style={{fontSize:12,color:T.gold700}}>{emailHint(newDonor.email)}</div>}
        {addErr&&<div data-testid="add-donor-error" role="alert" style={{fontSize:12.5,color:T.ink,background:T.gold50,border:"1px solid "+T.gold300,borderRadius:8,padding:"7px 10px"}}>{addErr}</div>}
        {isAdmin&&orgTeam.length>1&&<select value={newDonorAssignee} onChange={e=>setNewDonorAssignee(e.target.value)} style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"9px 12px",color:T.ink,fontSize:13,outline:"none",cursor:"pointer"}}>
          <option value="">Assign to me ({userName})</option>
          {orgTeam.filter(u=>u.id!==userId).map(u=><option key={u.id} value={u.id}>Assign to {u.name}</option>)}
        </select>}
        <div style={{display:"flex",gap:8}}>
          <button onClick={()=>addDonor("open")} data-testid="add-save" style={{background:T.greenDk,border:"none",borderRadius:8,padding:"9px 16px",color:T.white,fontSize:13,fontWeight:600,cursor:"pointer"}}>Save</button>
          <button onClick={()=>addDonor("gift")} data-testid="add-save-gift" style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:8,padding:"9px 14px",color:T.ink,fontSize:13,fontWeight:600,cursor:"pointer"}}>Save and record a gift</button>
          <button onClick={()=>addDonor("another")} data-testid="add-save-another" style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:8,padding:"9px 14px",color:T.ink,fontSize:13,fontWeight:600,cursor:"pointer"}}>Save and add another</button>
          <button onClick={()=>{setShowAdd(false);setAddToast(null);}} style={{background:T.bg,border:"none",borderRadius:8,padding:"9px 14px",color:T.ink3,fontSize:13,cursor:"pointer"}}>Cancel</button>
        </div>
      </Card>}

      {addWarn&&<div data-testid="add-email-warning" role="status" style={{background:T.bg2,border:"1px solid "+T.gold600,borderRadius:8,padding:"8px 12px",fontSize:12.5,color:T.ink,margin:"0 0 10px",display:"flex",gap:10,alignItems:"center"}}><span style={{flex:1}}>{addWarn}</span><button type="button" onClick={()=>setAddWarn("")} style={{background:"none",border:"none",color:T.greenDk,fontWeight:700,cursor:"pointer"}}>OK</button></div>}
      {view==="directory"&&<DirectoryView donors={dirPageRows} loading={dirRows===null||(searchPending&&dirPageRows.length===0)} serverTotal={dirUnitsOn&&dirUnits?dirUnits.unitCounts.units:dirTotal} units={dirUnitsOn&&dirUnits?dirUnits:null} householdsTogether={dirUnitsOn} setHouseholdsTogether={on=>persistLayout({householdsTogether:on}).catch(e=>console.warn("[list-layout]",e&&e.message))} updating={!!dirWant&&dirWant!==dirGot&&dirRows!==null} page={dirPage} pageSize={DIR_PAGE_SIZE} onPage={setDirPage} clientFilterCount={0} peopleView={dirPeopleShown||dirPeople||"donors"} setPeopleView={setDirPeople} roleCounts={roleCounts} fromImport={dirImport} clearFromImport={()=>setLF({fromImport:""})} fromAtlas={dirAtlas} clearFromAtlas={()=>setLF({fromAtlas:""})}
        anyFilter={!!(dirSearch.trim()||dirStage||dirAssignee||dirDesignation||dirHousehold||dirStatus||dirWhereStr||dirImport||dirAtlas)}
        exportParams={{role:(dirPeopleShown||dirPeople)==="contacts"?"contact":(dirPeopleShown||dirPeople)==="everyone"?"":"donor",...(dirImport?{fromImport:dirImport}:{}),...(dirAtlas?{fromAtlas:dirAtlas}:{}),search:dirSearch.trim(),stage:dirStage,assignedTo:dirAssignee,designation:dirDesignation,sort:dirSort,household:dirHousehold,...(dirWhereStr?{where:dirWhereStr}:{}),...(dirStatus?{[dirStatus.split(":")[0]]:dirStatus.split(":")[1]}:{})}} statusFilter={dirStatus} setStatusFilter={setDirStatus} sortBy={dirSort} setSortBy={v=>{setDirSort(v);setDirDir("");}} sortDir={dirDir} setSort={(k,d)=>{setDirSort(k);setDirDir(d);}} household={dirHousehold} clearHousehold={()=>setDirHousehold("")} totalDonors={peopleCount?peopleCount.total:undefined} orgTeam={orgTeam} isAdmin={isAdmin} onSelectDonor={selectDonor} onAssign={d=>setAssignTarget(d)} stageFilter={dirStage} setStageFilter={setDirStage} assigneeFilter={dirAssignee} setAssigneeFilter={setDirAssignee} designationFilter={dirDesignation} setDesignationFilter={setDirDesignation} officers={officers} officerColorMap={officerColorMap} portfolioMeta={portfolioMeta} pendingInvites={pendingInvites} onOfficersChanged={loadOfficers} onLoadSampleData={loadSampleData} sampleLoading={sampleLoading} hasSampleData={sampleStatus?.hasSampleData} onAddDonor={()=>setShowAdd(true)} onBulkDone={reloadDonors} isReadOnly={isReadOnly} listSetup={listSetup} layout={layout} setLayoutLocal={setLayout} persistLayout={persistLayout} resetLayout={resetLayout} saveOrgLayout={saveOrgLayout} where={dirWhere} setWhere={w=>{setDirWhere(w);}} filterError={filterError} views={(listSetup&&listSetup.views)||[]} activeViewId={activeViewId} viewEdited={viewEdited} onPickView={pickView} onSaveView={saveView} onUpdateView={updateView} onClearFilters={clearFilters} onDeleteView={deleteView} onPageSize={n=>persistLayout({pageSize:n}).catch(e=>console.warn("[list-layout]",e&&e.message))} includeScreening={includeScreening}/>}

      {wholeOrgView&&!orgPeople&&<div style={{display:"flex",justifyContent:"center",padding:"40px 0"}}><Spin/></div>}
      {wholeOrgView&&view!=="reengage"&&orgPeople&&reWaiting&&<div style={{fontSize:13,color:T.ink3,padding:"8px 0"}}>Applying the list's filters…</div>}
      {view==="team"&&isAdmin&&orgPeople&&!reWaiting&&<TeamView donors={filtered} orgTeam={orgTeam} onSelectDonor={selectDonor} onOpenDirectory={()=>setView("directory")}/>}

      {view==="reengage"&&orgPeople&&<>{peopleCount&&<PopulationCount id="reengage" count={lapsedCount} testId="reengage-population" style={{margin:"4px 0 10px"}}/>}<FilteredChip count={reFilterN} onClear={clearDirFilters}/><ReengageChange hidden={reFilterN>0} onSelectDonor={selectDonor}/>{reWaiting?<div style={{fontSize:13,color:T.ink3,padding:"8px 0"}}>Applying the list's filters…</div>:<ReEngageView donors={filtered} unfiltered={reFilterN>0?orgPeople:null} onClearFilters={clearDirFilters} org={data.org} onLogTouchpoint={d=>setLogTarget(d)} onSelectDonor={selectDonor}/>}</>}
      {view==="map"&&mapOn&&orgPeople&&!reWaiting&&<DonorMap donors={filtered} userId={userId} onSelectDonor={selectDonor} apiFetch={apiFetch}/>}
      {view==="drift"&&<DriftList onSelectDonor={selectDonor} onBack={()=>setView("directory")}/>}
      {view==="health"&&<DataHealth isReadOnly={isReadOnly} onOpenDonor={id=>openIfOnFile(id,()=>reloadDonors&&reloadDonors())}/>}
      </>)}
    </SheetDropTarget>
  );
}
