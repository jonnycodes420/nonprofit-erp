import { NoRecentMeetingPanel, WarmNotAskedPanel } from "./MovesPanels";
import { useState, useEffect, useMemo, useRef, Component } from "react";
import { GrantImport } from "./GrantImport";
import OldReportsImport from "./OldReportsImport";
import HistoryImport from "./HistoryImport";
import SpreadsheetImport, { SheetDropTarget } from "./SpreadsheetImport";
import Papa from "papaparse";
import { HoursImportModal } from "./VolunteerPanel";
import * as HOURS_PRESETS_MOD from "../../../shared/volunteerHours.js";
import { apiFetch, adaptDonor } from "../api";
import { allPeople, forgetAllPeople, peopleById, peopleCounts, usePeoplePicker } from "../lib/people";
import { errorMessage } from "../lib/domainError";
import { useAuth } from "../main";
import UpgradeModal from "./UpgradeModal";
import { T, activeMark, fmtFull, daysDiff, askClaude, STAGES, donorScore, contactGap, Card, AIBtn, AIPanel, PageTitle, Modal, Spin } from "./shared";
import { offerUndo } from "./EditHistory";
import { LogConversationModal } from "./LogConversation";
import { guardSuggestion, dropLog, plainText } from "../../../shared/suggestionGuard.js";
import { composeNextMove } from "../../../shared/nextMove.js";
// SHELVED — voice capture works but unproven adoption assumption, revisit
// later. Code intact, re-enable by uncommenting (see showVoiceMemo state,
// profile button, and modal render below, and add `VoiceMemoModal` back to
// the import above).
import { DonorMap } from "./DonorMap";
import { DataHealth } from "./DataHealth";
import { AssignModal, DirectoryView, FilterBar, ReEngageView, TeamView } from "./DonorDirectory";
import { FALLBACK_SETUP, PAGE_SIZES, cleanColumns } from "./DonorColumns";
import { EMPTY_WHERE, whereParam } from "./DonorFilters";
import { MergeDuplicatesModal, parseFileToSheets } from "./DonorImport";
import { DonorProfile, EditDonorModal, FollowUpTaskModal, LogTouchpointModal } from "./DonorProfile";
import { PATTERN_META, TIER_META } from "./donorShared";
import { PLAN_UNKNOWN } from "../lib/entitlement";
// FIX-49: the one lapse rule, on the org's own calendar.
import lapseRuleMod from "../../../lapseRule.js";
import { orgTodayCivil } from "../lib/orgToday";
const { isLapsed } = lapseRuleMod;
import { useNavigate } from "react-router-dom";
import { donorHref, donorsListHref, donorsListState } from "../lib/appUrls";
export { DonorImport } from "./DonorImport";

class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error("DonorProfile error:", error, info); }
  render() {
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
export function Donors({data,setData,isReadOnly=false,onNavigate,initialView,initialLogDonorId,initialStageFilter,initialSelectDonorId,initialOpenImport,initialOpenConversation,onIntentConsumed}){
  const{auth}=useAuth();
  const isAdmin=auth?.user?.role==="admin";
  const userId=auth?.user?.id||"";
  const userName=auth?.user?.name||auth?.user?.email||"";
  // FIX-13 Part 6 — the list's search, filters and view live in the URL
  // (/donors?q=&stage=&owner=&nomeeting=1…), read once here on mount and
  // written back below, so a filtered list opens the same in a new tab.
  const[urlList]=useState(()=>window.location.pathname.replace(/\/+$/,"")==="/donors"?donorsListState(window.location.search):{});
  const routerNavigate=useNavigate();
  // SCALE-2: THE SHELL NO LONGER HOLDS EVERY DONOR. The whole-org list is
  // loaded here only when a view that draws the whole org opens (Team,
  // Re-engage, the map) or the call list is asked for; everything else asks
  // the server (lib/people.js). `orgPeople` is null until then.
  const[orgPeople,setOrgPeople]=useState(null);
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
  const[search,setSearch]=useState(urlList.search||"");
  const[selected,setSelected]=useState(()=>initialSelectDonorId?{id:initialSelectDonorId}:null);
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
  const[convoSearch,setConvoSearch]=useState("");
  // SCALE-2: the picker's people, name or email, from the server as she types.
  const[convoPeople]=usePeoplePicker(convoSearch,{match:"either",limit:30,emptyToo:true,enabled:convoPickerOpen});
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
  const[newDonor,setNewDonor]=useState({name:"",email:"",phone:"",lastAmount:"",stage:"prospect"});
  const[filtersOpen,setFiltersOpen]=useState(false);
  const[filters,setFilters]=useState({tiers:[],stages:[],pattern:"",geo:"",giftFrom:"",giftTo:"",totalMin:"",totalMax:""});
  const[orgTeam,setOrgTeam]=useState([]);
  const[customFields,setCustomFields]=useState([]);
  const[cfValues,setCfValues]=useState({});
  const[cfFilters,setCfFilters]=useState({});
  const[dirStage,setDirStage]=useState(initialStageFilter||urlList.stage||"");
  const[dirAssignee,setDirAssignee]=useState(urlList.owner||"");
  const[dirDesignation,setDirDesignation]=useState(urlList.designation||"");
  // FIX-14 Part 5: the order (?sort=name|last_gift_date|total_giving, the
  // server's DONOR_SORTS; the list is paged server-side, so the server sorts)
  // and a household (?household=<id>, the list narrowed to its members).
  const[dirSort,setDirSort]=useState(urlList.sort||"");
  const[dirHousehold,setDirHousehold]=useState(urlList.household||"");   // BUILD-14 planned-giving/estate segment
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
  const[layout,setLayout]=useState(null);
  const layoutRef=useRef(null);
  layoutRef.current=layout;
  const[dirWhere,setDirWhere]=useState(EMPTY_WHERE);
  const[dirDir,setDirDir]=useState("");
  const[filterError,setFilterError]=useState("");
  const[activeViewId,setActiveViewId]=useState("");
  const DIR_PAGE_SIZE=layout&&PAGE_SIZES.includes(Number(layout.pageSize))?Number(layout.pageSize):50;
  const dirCols=layout?layout.columns.join(","):"";
  const layoutReady=!!layout;
  const dirWhereStr=whereParam(dirWhere);
  const[dirPage,setDirPage]=useState(0);
  const[dirRows,setDirRows]=useState(null); // null = loading
  const[dirTotal,setDirTotal]=useState(0);
  const[dirSearch,setDirSearch]=useState(search);
  // FIX-45: the search the rows on screen answer. Until the server answers the
  // words in the box, the rows already loaded narrow as she types (below).
  const[dirRowsFor,setDirRowsFor]=useState(null);
  const[dirReloadKey,setDirReloadKey]=useState(0);
  useEffect(()=>{const t=setTimeout(()=>setDirSearch(search),300);return()=>clearTimeout(t);},[search]);
  // IMPORT-2: "Bring in your notes" from a profile or the donor import's last screen.
  useEffect(()=>{const open=()=>setShowHistory(true);window.addEventListener("steward:history-import",open);return()=>window.removeEventListener("steward:history-import",open);},[]);
  // PARITY-1 — one tag or closeness filter, "level:major", "closeness:warm".
  const[dirStatus,setDirStatus]=useState("");
  useEffect(()=>{setDirPage(0);},[dirSearch,dirStage,dirAssignee,dirDesignation,dirSort,dirHousehold,dirStatus,dirWhereStr,dirDir,DIR_PAGE_SIZE]);
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
        qs.set("role","donor");
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
        const r=await apiFetch(`/donors?${qs.toString()}`);
        if(cancelled)return;
        setFilterError("");
        setDirRows((r.donors||[]).map(adaptDonor));
        setDirTotal(r.total||0);
        setDirRowsFor(dirSearch.trim());
      }catch(e){
        if(cancelled)return;
        // LIST-1: a filter the server cannot run says why, in its own sentence.
        if(e&&e.status===400&&(e.error==="bad_filter"||e.sentence)){setFilterError(e.sentence||"That filter could not be run.");setDirRows([]);setDirTotal(0);return;}
        console.error(e);setDirRows([]);
      }
    })();
    return()=>{cancelled=true;};
  },[view,layoutReady,DIR_PAGE_SIZE,dirCols,dirWhereStr,dirDir,dirPage,dirSearch,dirStage,dirAssignee,dirDesignation,dirSort,dirHousehold,dirStatus,dirReloadKey]);
  // LIST-1: the layout, saved for her (PUT), reset (DELETE), or set as the
  // org's starting layout (admins). Views are a name for columns + filters.
  const persistLayout=async next=>{
    const full={...(layoutRef.current||FALLBACK_SETUP.layout),...next};
    setLayout(full);
    const r=await apiFetch("/donors/list-layout",{method:"PUT",body:JSON.stringify({columns:full.columns,widths:full.widths||{},pageSize:full.pageSize})});
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
  const saveView=async name=>{
    const cur=layoutRef.current||FALLBACK_SETUP.layout;
    const r=await apiFetch("/donors/list-views",{method:"POST",body:JSON.stringify({name,columns:cur.columns,widths:cur.widths||{},filters:dirWhere,pageSize:cur.pageSize})});
    const v=r&&r.view;
    if(v){setListSetup(s=>({...s,views:[...((s&&s.views)||[]).filter(x=>x.id!==v.id),{mine:true,...v}]}));setActiveViewId(v.id);}
    return v;
  };
  const pickView=v=>{
    if(!v){setActiveViewId("");return;}
    setActiveViewId(v.id);
    const cur=layoutRef.current||FALLBACK_SETUP.layout;
    persistLayout({columns:cleanColumns(v.columns||cur.columns,(listSetup||FALLBACK_SETUP).fields),widths:v.widths||cur.widths||{},pageSize:v.pageSize||cur.pageSize}).catch(e=>console.warn("[list-layout]",e&&e.message));
    setDirWhere(v.filters&&Array.isArray(v.filters.conditions)?{join:v.filters.join==="or"?"or":"and",conditions:v.filters.conditions}:EMPTY_WHERE);
  };
  const deleteView=async v=>{
    try{await apiFetch(`/donors/list-views/${encodeURIComponent(v.id)}`,{method:"DELETE"});
      setListSetup(s=>({...s,views:((s&&s.views)||[]).filter(x=>x.id!==v.id)}));setActiveViewId("");}
    catch(e){console.warn("[list-views]",e&&e.message);}
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

  // Advanced + custom-field filters as shared predicates: applied to the
  // whole summaries list for pipeline/team/re-engage/map, and within the
  // loaded page for the server-paginated Directory (the documented
  // BUILD-06 compromise — full server-side custom-field querying is out of
  // scope; DirectoryView shows a "filtering current page" note instead).
  const matchesAdvanced=d=>{
    if(filters.tiers.length&&!filters.tiers.includes((d.capacityTier||"").toLowerCase()))return false;
    if(filters.stages.length&&!filters.stages.includes(d.stage||"cultivate"))return false;
    if(filters.pattern==="one-time"&&d.gifts!==1)return false;
    if(filters.pattern==="recurring"&&d.gifts<2)return false;
    if(filters.pattern==="major"&&d.lastAmount<10000)return false;
    if(filters.pattern==="lapsed"&&!(d.stage==="lapsed"||isLapsed(d.lastGift,orgTodayCivil())))return false;
    if(filters.geo.trim()&&!`${d.notes||""} ${(d.tags||[]).join(" ")}`.toLowerCase().includes(filters.geo.toLowerCase()))return false;
    if(filters.giftFrom&&d.lastGift&&d.lastGift<filters.giftFrom)return false;
    if(filters.giftTo&&d.lastGift&&d.lastGift>filters.giftTo)return false;
    if(filters.totalMin!==""&&!isNaN(parseFloat(filters.totalMin))&&d.total<parseFloat(filters.totalMin))return false;
    if(filters.totalMax!==""&&!isNaN(parseFloat(filters.totalMax))&&d.total>parseFloat(filters.totalMax))return false;
    return true;
  };
  const matchesCf=d=>{
    for(const [fieldId,fval] of Object.entries(cfFilters)){
      if(!fval||fval==="")continue;
      if(Array.isArray(fval)&&fval.length===0)continue;
      if(typeof fval==="object"&&!Array.isArray(fval)&&!fval.from&&!fval.to)continue;
      const f=customFields.find(x=>x.id===fieldId);
      if(!f)continue;
      // BUILD-78: values are typed and keyed by the immutable field KEY.
      const raw=cfValues[d.id]?.[f.key];
      if(f.type==="select"){
        if(fval.length===0)continue;
        if(!fval.some(opt=>String(raw??"").toLowerCase()===opt.toLowerCase()))return false;
      }else if(f.type==="multi_select"){
        if(fval.length===0)continue;
        const have=Array.isArray(raw)?raw.map(v=>String(v).toLowerCase()):[String(raw??"").toLowerCase()];
        if(!fval.some(opt=>have.includes(opt.toLowerCase())))return false;
      }else if(f.type==="checkbox"){
        if(fval==="Yes"&&raw!==true)return false;
        if(fval==="No"&&raw!==false)return false;
      }else if(f.type==="date"){
        const dv=String(raw??"");
        if(fval.from&&(!dv||dv<fval.from))return false;
        if(fval.to&&(!dv||dv>fval.to))return false;
      }else{
        const dv=(f.type==="money"&&Number.isInteger(raw)?(raw/100).toFixed(2):String(raw??"")).toLowerCase();
        if(!dv.includes(String(fval).toLowerCase()))return false;
      }
    }
    return true;
  };
  const advFilterCount=filters.tiers.length+filters.stages.length+(filters.pattern?1:0)+(filters.geo.trim()?1:0)+((filters.giftFrom||filters.giftTo)?1:0)+((filters.totalMin||filters.totalMax)?1:0);
  const cfFilterCount=Object.entries(cfFilters).filter(([,v])=>{if(!v||v==="")return false;if(Array.isArray(v))return v.length>0;if(typeof v==="object")return v.from||v.to;return true;}).length;

  const wholeOrgView=view==="team"||view==="reengage"||view==="map";
  useEffect(()=>{
    if(!wholeOrgView||orgPeople)return;
    let live=true;
    // FIX-46: read fresh each time Donors opens, as the profile is. Held for
    // the whole session, a gift logged anywhere else (To confirm, Stripe, an
    // import) left Re-engage showing "$0, no gift on file" beside a profile
    // that said $1,500. Team, Re-engage and the map share this one read.
    allPeople({force:true}).then(rows=>{if(live)setOrgPeople(rows);}).catch(e=>console.error(e));
    return()=>{live=false;};
  },[wholeOrgView,orgPeople]);
  const filtered=(orgPeople||[])
    .filter(d=>!search||(d.name+d.email).toLowerCase().includes(search.toLowerCase()))
    .filter(matchesAdvanced)
    .filter(matchesCf);
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

  const loadOfficers=()=>apiFetch("/portfolio/officers").then(r=>{setOfficers(r.officers||[]);setPortfolioMeta({tier:r.tier||PLAN_UNKNOWN,single_user:!!r.single_user});setPendingInvites((r.invites||[]).map(i=>({id:"invite:"+i.id,name:i.name,email:i.email,pending:true})));}).catch(()=>{});
  useEffect(()=>{
    apiFetch("/org/sample-data-status").then(setSampleStatus).catch(()=>{});
    apiFetch("/org/team").then(setOrgTeam).catch(()=>{});
    loadOfficers();
    apiFetch("/custom-fields?entity=donor").then(rows=>setCustomFields(Array.isArray(rows)?rows:[])).catch(()=>{});
    apiFetch("/donors/custom-field-values/all").then(rows=>{
      if(!Array.isArray(rows))return;
      const map={};
      rows.forEach(r=>{map[r.donorId]=r.values||{};});
      setCfValues(map);
    }).catch(()=>{});
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

  const toggleTask=async(task)=>{
    const updated={...task,done:!task.done};
    setData(prev=>({...prev,tasks:prev.tasks.map(t=>t.id===task.id?updated:t)}));
    try{await apiFetch(`/tasks/${task.id}`,{method:"PUT",body:JSON.stringify({title:task.title,due:task.due||"",priority:task.priority,type:task.type,done:updated.done})});}
    catch(e){console.error(e);}
  };

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

  const reloadCfValues=async()=>{
    try{
      const rows=await apiFetch("/donors/custom-field-values/all");
      if(!Array.isArray(rows))return;
      const map={};
      rows.forEach(r=>{map[r.donorId]=r.values||{};});
      setCfValues(map);
    }catch(e){console.error(e);}
  };

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
      if(orgPeople)setOrgPeople(await allPeople());
    }catch(e){console.error(e);}
  };

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
  const selectDonor=async(d)=>{
    if(!d){setSelected(null);return;}
    setSelected(d);
    try{
      const full=await apiFetch(`/donors/${d.id}`);
      setSelected(prev=>prev?.id===d.id?{
        ...adaptDonor(full),
        lastTouchpoint:prev.lastTouchpoint??null,
        interactions:prev.interactions||[],
      }:prev);
    }catch(e){
      // THREAD-2 · a link to somebody this person can't see (another org's
      // record, or one removed) says so, and shows nothing of it.
      if(e&&(e.status===404||e.status===403)){setSelected(prev=>prev?.id===d.id?{id:d.id,noAccess:true}:prev);return;}
      console.error(e);
    }
  };

  // FIX-13 Part 6 — the address bar follows the list and the open profile.
  // Opening or closing a profile is a step Back undoes; a filter or a
  // keystroke in search replaces the entry rather than piling up history.
  useEffect(()=>{
    const href=selected?.id?donorHref(selected.id):donorsListHref({view,search,stage:dirStage,owner:dirAssignee,designation:dirDesignation,noMeeting:noMeetingOpen,warmUnasked:warmOpen,nmOwner:noMeetingOpen?nmFilter.owner:"",nmMin:noMeetingOpen?nmFilter.min:"",sort:dirSort,household:dirHousehold});
    const here=window.location.pathname+window.location.search;
    if(href===here)return;
    const step=selected?.id?!here.startsWith(donorHref(selected.id)):here.startsWith("/donors/");
    routerNavigate(href,{replace:!step,state:{internal:true}});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[selected?.id,view,search,dirStage,dirAssignee,dirDesignation,noMeetingOpen,warmOpen,nmFilter.owner,nmFilter.min,dirSort,dirHousehold]);

  const handleEditSaved=(raw)=>{
    // Reuse the same single-donor adapter adaptData() uses for the initial
    // load — a hand-duplicated shorter field list here previously dropped
    // assignedTo/assignedToName (and wealth score, city/state/zip, etc.)
    // from local state after every edit, even though the database itself
    // was untouched (see api.js's adaptDonor comment).
    const adapted={
      ...adaptDonor(raw),
      interactions:selected?.id===raw.id?(selected.interactions||[]):[],
      lastTouchpoint:selected?.id===raw.id?selected.lastTouchpoint:null,
    };
    patchPeople(list=>list.map(d=>d.id===raw.id?adapted:d));
    setDirRows(prev=>prev?prev.map(d=>d.id===raw.id?{...adapted,room:adapted.room||d.room}:d):prev);   // FIX-33: an edit's reply carries no Room to give
    if(selected?.id===raw.id)setSelected(adapted);
    setEditTarget(null);
  };

  const deleteDonor=async(id)=>{
    // FIX-12 (HELP-1 list): delete is a soft delete, so "cannot be undone" was untrue.
    // FIX-22: no confirm. It goes at once and Undo brings it back for ten
    // seconds; to remove someone for good, Erase on their profile still asks.
    try{
      const r=await apiFetch(`/donors/${id}`,{method:"DELETE"});
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
    const everyone=orgPeople||await allPeople().catch(()=>[]);   // SCALE-2: loaded for this, not on sign-in
    await askClaude(`You are a chief development officer. Be tactical. Max 200 words.`,
      `Prioritized call list for this week:\n${everyone.map(d=>`${d.name} [${d.stage||"cultivate"}]: ${daysDiff(d.lastTouchpoint||d.lastGift)}d since contact, ${fmtFull(d.lastAmount)} last gift, score ${donorScore(d)??"none (no gifts on file)"}, notes: ${d.notes}`).join("\n")}`,
      chunk=>setCallList(chunk));
    setCallLoading(false);
  };

  const[newDonorAssignee,setNewDonorAssignee]=useState("");

  const addDonor=async()=>{
    if(!newDonor.name)return;
    const assignTo=newDonorAssignee||userId;
    const assignToName=newDonorAssignee?(orgTeam.find(u=>u.id===newDonorAssignee)?.name||""):userName;
    // BUILD-80 Part 10 — a typed last amount NEVER stamps a last-gift date
    // of today (the same class BUILD-79 Part 4 killed on the import paths):
    // the amount tells us what they gave, not when. No date means no date.
    const temp={id:"tmp_"+Date.now(),name:newDonor.name,email:newDonor.email,phone:newDonor.phone,
      total:parseInt(newDonor.lastAmount)||0,lastGift:null,
      lastAmount:parseInt(newDonor.lastAmount)||0,gifts:newDonor.lastAmount?1:0,
      status:"new",stage:newDonor.stage,tags:[],notes:"",interactions:[],lastTouchpoint:null,
      assignedTo:assignTo,assignedToName:assignToName};
    patchPeople(list=>[...list,temp]);
    setShowAdd(false);setNewDonor({name:"",email:"",phone:"",lastAmount:"",stage:"prospect"});setNewDonorAssignee("");
    try{await apiFetch("/donors",{method:"POST",body:JSON.stringify({...newDonor,stage:newDonor.stage,assignedTo:assignTo,assignedToName:assignToName})});await reloadDonors();}
    catch(e){
      if(e.error==="record_limit"){
        patchPeople(list=>list.filter(d=>d.id!==temp.id));
        setUpgradeModal({reason:e.error,current:e.current,limit:e.limit,plan:e.plan});
      } else { console.error(e); }
    }
  };

  return(
    <SheetDropTarget disabled={isReadOnly} onFile={f=>setDroppedFile(f)} style={{display:"flex",flexDirection:"column",gap:8}}>
      <PageTitle main="Your" accent="donors."/>
      {/* FIX-55: a spreadsheet dropped anywhere on Donors opens the one reader with it */}
      {droppedFile&&<SpreadsheetImport key={droppedFile.name+droppedFile.lastModified} file={droppedFile} onClose={()=>setDroppedFile(null)} onImported={()=>{reloadDonors();setDroppedFile(null);}}/>}
      {/* INT-BUILD-1 Part 6 — moves management: who has not been met. */}
      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
        <button type="button" data-testid="filter-no-meeting" aria-pressed={noMeetingOpen} onClick={()=>setNoMeetingOpen(o=>!o)}
          style={{background:noMeetingOpen?T.ink:T.white,color:noMeetingOpen?T.inkInverse:T.ink,border:"1px solid "+(noMeetingOpen?T.ink:T.bg3),borderRadius:99,padding:"6px 14px",fontSize:13,fontWeight:600,cursor:"pointer"}}>No meeting in 90 days</button>
        {/* ENGAGE-1 — the people closest to giving more who have not been asked. */}
        <button type="button" data-testid="filter-warm-not-asked" aria-pressed={warmOpen} onClick={()=>setWarmOpen(o=>!o)}
          style={{background:warmOpen?T.ink:T.white,color:warmOpen?T.inkInverse:T.ink,border:"1px solid "+(warmOpen?T.ink:T.bg3),borderRadius:99,padding:"6px 14px",fontSize:13,fontWeight:600,cursor:"pointer"}}>Warm but not asked this year</button>
      </div>
      {warmOpen&&<WarmNotAskedPanel officers={officers} onSelectDonor={id=>selectDonor({id})} onClose={()=>setWarmOpen(false)}/>}
      {noMeetingOpen&&<NoRecentMeetingPanel officers={officers} onSelectDonor={id=>selectDonor({id})} onClose={()=>setNoMeetingOpen(false)}
        initialOwner={nmFilter.owner} initialMin={nmFilter.min} onFilterChange={setNmFilter}/>}
      {assignTarget&&<AssignModal donor={assignTarget} orgTeam={orgTeam} onSave={handleAssign} onClose={()=>setAssignTarget(null)}/>}
      {showImport&&<SpreadsheetImport onClose={()=>setShowImport(false)} onImported={()=>{reloadDonors();setShowImport(false);}}/>}
      {showGiftImport&&<SpreadsheetImport onClose={()=>setShowGiftImport(false)} onImported={()=>{reloadDonors();setShowGiftImport(false);}}/>}
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
      {convoPickerOpen&&(
        <Modal onClose={()=>setConvoPickerOpen(false)} width={420} zIndex={300} align="top" padding={0}
          ariaLabel="Log a call" dialogStyle={{borderRadius:16,border:"1px solid "+T.bg3,maxHeight:"70vh"}}>
          <div style={{display:"flex",flexDirection:"column",overflow:"hidden",maxHeight:"100%"}}>
            <div style={{padding:"16px 18px 10px"}}>
              <div style={{fontSize:15,fontWeight:800,color:T.ink,marginBottom:8}}>Who did you talk to?</div>
              <input autoFocus value={convoSearch} onChange={e=>setConvoSearch(e.target.value)} placeholder="Search donors…"
                style={{width:"100%",background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"9px 12px",color:T.ink,fontSize:13,outline:"none",boxSizing:"border-box"}}/>
            </div>
            <div style={{overflowY:"auto",padding:"0 8px 10px"}}>
              {convoPeople.map(d=>(
                <button key={d.id} onClick={()=>{setConvoPickerOpen(false);setConvoSearch("");setConvoTarget(d);}}
                  style={{display:"block",width:"100%",textAlign:"left",background:"none",border:"none",borderRadius:8,padding:"9px 10px",cursor:"pointer"}} className="click-card">
                  <span style={{fontSize:13,fontWeight:700,color:T.ink}}>{d.name}</span>
                  {d.email&&<span style={{fontSize:11.5,color:T.ink3,marginLeft:8}}>{d.email}</span>}
                </button>
              ))}
              {peopleCount&&peopleCount.total===0&&<div style={{fontSize:12.5,color:T.ink3,padding:"6px 10px 12px"}}>No donors yet. Import your donors first, then log the first call.</div>}
            </div>
          </div>
        </Modal>
      )}
      {convoTarget&&<LogConversationModal donor={{id:convoTarget.id,name:convoTarget.name}} org={data.org} onNavigate={onNavigate}
        onSaved={()=>{reloadDonors&&reloadDonors();}} onClose={()=>setConvoTarget(null)}/>}
      {followUpTarget&&<FollowUpTaskModal donor={followUpTarget} onClose={()=>setFollowUpTarget(null)} onSave={task=>{setData(prev=>({...prev,tasks:[task,...prev.tasks]}));setFollowUpTarget(null);}}/>}
      {editTarget&&<EditDonorModal donor={editTarget} onSave={handleEditSaved} onClose={()=>setEditTarget(null)}/>}
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
      {selected?.noAccess ? (
        <div data-testid="no-access" style={{padding:"40px 24px",textAlign:"center",color:T.ink,fontSize:15}}>
          <div style={{fontWeight:700,marginBottom:6}}>You don't have access to this.</div>
          <button onClick={()=>setSelected(null)} style={{background:T.white,border:"1px solid "+T.ink,borderRadius:8,padding:"7px 14px",fontWeight:700,cursor:"pointer",fontFamily:"inherit",color:T.ink}}>Back to people</button>
        </div>
      ) : selected ? (
      <ErrorBoundary key={selected.id}><DonorProfile donor={selected} onClose={()=>{setSelected(null);setGiftHandoff(null);}}
        onStageChange={moveToStage} onLogTouchpoint={()=>{setLogTarget(selected);}}
        aiMap={aiMap} aiErr={aiErr} loadingKey={loadingKey} getAI={getAI}
        isAdmin={isAdmin} onEdit={()=>setEditTarget(selected)} onDelete={deleteDonor}
        tasks={data.tasks.filter(t=>t.donorId===selected.id)} onTaskToggle={toggleTask} onAddTask={()=>setFollowUpTarget(selected)}
        orgName={data.org?.name||""} org={data.org} orgTeam={orgTeam} onReassign={handleAssign} onCfSaved={reloadCfValues} onInteractionAdded={reloadDonors}
        onNavigate={onNavigate}
        initialOpenConversation={!!initialOpenConversation&&selected.id===initialSelectDonorId}
        initialAddGift={giftHandoff&&giftHandoff.donorId===selected.id?giftHandoff:null}
        isReadOnly={isReadOnly} onSelectRelatedDonor={openIfOnFile}/></ErrorBoundary>
      ) : (<>

      <div className="donors-toolbar" style={{display:"flex",gap:10,flexWrap:"wrap",alignItems:"center"}}>
        <input className="donors-search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search donors…" style={{flex:1,minWidth:160,background:T.bg,border:"1px solid "+T.bg3,borderRadius:10,padding:"10px 14px",color:T.ink,fontSize:13,outline:"none"}}/>
        <div className="donors-view-toggle" style={{display:"flex",background:T.bg,border:"1px solid "+T.bg3,borderRadius:10,overflow:"hidden"}}>
          {[["directory","Directory"],...(isAdmin?[["team","Team"]]:[]),["reengage","Re-engage"],...(mapOn?[["map","Map"]]:[]),["health","Data health"]].map(([v,l])=>(
            <button key={v} onClick={()=>setView(v)} style={{background:view===v?T.bg2:"transparent",border:"none",padding:"9px 14px",color:view===v?T.ink:T.ink3,fontSize:13,fontWeight:view===v?700:400,cursor:"pointer",display:"flex",alignItems:"center",gap:5}}>
              {l}
              {v==="reengage"&&lapsedCount>0&&<span style={{background:T.greenDk,color:T.white,borderRadius:99,padding:"1px 6px",fontSize:10,fontWeight:800,lineHeight:1.4}}>{lapsedCount}</span>}
            </button>
          ))}
        </div>
        {data?.org?.capabilities?.ai&&<AIBtn onClick={generateCallList} loading={callLoading} label="✦ Call List"/>}
        {/* BUILD-81 Part 5 — logging a conversation is the primary act (it IS
            creating the follow-up); above the fold at 1440 and 390. */}
        <button onClick={()=>setConvoPickerOpen(true)} disabled={isReadOnly} title={isReadOnly?"Reactivate your subscription to make changes.":undefined} style={{background:T.gold500,border:"none",borderRadius:10,padding:"10px 14px",color:T.ink,fontSize:13,fontWeight:800,cursor:isReadOnly?"not-allowed":"pointer",opacity:isReadOnly?0.45:1}}>Log a call</button>
        <button onClick={()=>setShowAdd(!showAdd)} disabled={isReadOnly} title={isReadOnly?"Reactivate your subscription to make changes.":undefined} style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:10,padding:"10px 14px",color:T.ink2,fontSize:13,fontWeight:700,cursor:isReadOnly?"not-allowed":"pointer",opacity:isReadOnly?0.45:1}}>+ Add</button>
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
              ].map((it,i)=>it.divider?<div key={i} style={{height:1,background:T.bg3,margin:"4px 8px"}}/>:(
                <button key={i} role="menuitem" onClick={()=>{setToolsOpen(false);it.act();}} className="click-card" style={{background:"none",border:"none",borderRadius:8,padding:"9px 10px",textAlign:"left",cursor:"pointer",display:"block",width:"100%"}}>
                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                    <span style={{fontSize:13,fontWeight:700,color:T.ink}}>{it.label}</span>
                    {it.badge&&<span style={{background:T.gold100,color:T.gold700,border:"1px solid "+T.gold300,borderRadius:99,padding:"1px 8px",fontSize:10,fontWeight:800,letterSpacing:"0.04em",textTransform:"uppercase"}}>{it.badge}</span>}
                  </div>
                  <div style={{fontSize:11.5,color:T.ink3,marginTop:2}}>{it.hint}</div>
                </button>
              ))}
            </div>
          </>}
        </div>
      </div>

      {view!=="directory"&&(()=>{
        const count=advFilterCount+cfFilterCount;
        const pills=[];
        filters.tiers.forEach(t=>{const m=TIER_META.find(x=>x.id===t);pills.push({id:"t"+t,label:`Tier: ${m?.label||t}`,rm:()=>setFilters(f=>({...f,tiers:f.tiers.filter(v=>v!==t)}))});});
        filters.stages.forEach(s=>{const m=STAGES.find(x=>x.id===s);pills.push({id:"s"+s,label:`Stage: ${m?.label||s}`,rm:()=>setFilters(f=>({...f,stages:f.stages.filter(v=>v!==s)}))});});
        if(filters.pattern){const m=PATTERN_META.find(p=>p.id===filters.pattern);pills.push({id:"pat",label:`Pattern: ${m?.label||filters.pattern}`,rm:()=>setFilters(f=>({...f,pattern:""}))});}
        if(filters.geo.trim())pills.push({id:"geo",label:`Geo: "${filters.geo}"`,rm:()=>setFilters(f=>({...f,geo:""}))});
        if(filters.giftFrom||filters.giftTo)pills.push({id:"gift",label:`Last gift: ${filters.giftFrom||"any"} → ${filters.giftTo||"any"}`,rm:()=>setFilters(f=>({...f,giftFrom:"",giftTo:""}))});
        if(filters.totalMin||filters.totalMax)pills.push({id:"total",label:`Giving: ${filters.totalMin?"$"+filters.totalMin:"$0"} → ${filters.totalMax?"$"+filters.totalMax:"any"}`,rm:()=>setFilters(f=>({...f,totalMin:"",totalMax:""}))});
        Object.entries(cfFilters).forEach(([fieldId,fval])=>{
          if(!fval||fval==="")return;
          if(Array.isArray(fval)&&fval.length===0)return;
          if(typeof fval==="object"&&!Array.isArray(fval)&&!fval.from&&!fval.to)return;
          const f=customFields.find(x=>x.id===fieldId);
          if(!f)return;
          let label=`${f.label}: `;
          if(Array.isArray(fval))label+=fval.join(", ");
          else if(typeof fval==="object")label+=`${fval.from||"any"} → ${fval.to||"any"}`;
          else label+=fval;
          pills.push({id:"cf_"+fieldId,label,rm:()=>setCfFilters(p=>({...p,[fieldId]:(f.type==="select"||f.type==="multi_select")?[]:f.type==="date"?{from:"",to:""}:""}))});
        });
        const clearAll=()=>{setFilters({tiers:[],stages:[],pattern:"",geo:"",giftFrom:"",giftTo:"",totalMin:"",totalMax:""});setCfFilters({});};
        return<>
          <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
            <button onClick={()=>setFiltersOpen(v=>!v)} style={{background:filtersOpen||count>0?T.bg2:T.bg,border:"1px solid "+(count>0?T.greenDk:T.bg3),borderRadius:9,padding:"7px 12px",color:count>0?T.greenDk:T.ink3,fontSize:12,fontWeight:count>0?700:400,cursor:"pointer",display:"flex",alignItems:"center",gap:6}}>
              ⊞ Filters
              {count>0&&<span style={{background:T.greenDk,color:T.white,borderRadius:99,padding:"0 6px",fontSize:10,fontWeight:800,lineHeight:"16px"}}>{count}</span>}
            </button>
            {pills.map(p=>(
              <span key={p.id} style={{background:T.bg2,border:"1px solid "+T.bg3,borderRadius:99,padding:"4px 10px",fontSize:12,color:T.ink2,display:"inline-flex",alignItems:"center",gap:5}}>
                {p.label}
                <button onClick={p.rm} style={{background:"none",border:"none",cursor:"pointer",color:T.ink3,fontSize:13,lineHeight:1,padding:0,marginLeft:2}}>×</button>
              </span>
            ))}
            {count>0&&<button onClick={clearAll} style={{background:"none",border:"none",color:T.ink3,fontSize:12,cursor:"pointer",textDecoration:"underline",padding:0}}>Clear all</button>}
          </div>
          {filtersOpen&&<FilterBar filters={filters} onChange={setFilters} customFields={customFields} cfFilters={cfFilters} onCfChange={setCfFilters}/>}
        </>;
      })()}

      {(callLoading||callList)&&<AIPanel text={callList} onClose={()=>setCallList("")}/>}

      {showAdd&&<Card style={{gap:10,display:"flex",flexDirection:"column"}}>
        <div style={{fontSize:14,fontWeight:700,color:T.ink}}>New Donor</div>
        <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
          {STAGES.map(s=><button key={s.id} aria-pressed={newDonor.stage===s.id} onClick={()=>setNewDonor(p=>({...p,stage:s.id}))} style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:7,padding:"5px 11px",color:T.ink3,fontSize:12,fontWeight:600,cursor:"pointer",...activeMark(newDonor.stage===s.id,"bottom")}}>{s.label}</button>)}
        </div>
        {[["name","Full Name"],["email","Email"],["phone","Phone"],["lastAmount","Gift Amount ($)"]].map(([k,pl])=>(
          <input key={k} value={newDonor[k]} onChange={e=>setNewDonor(p=>({...p,[k]:e.target.value}))} placeholder={pl} style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"9px 12px",color:T.ink,fontSize:13,outline:"none"}}/>
        ))}
        {isAdmin&&orgTeam.length>1&&<select value={newDonorAssignee} onChange={e=>setNewDonorAssignee(e.target.value)} style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"9px 12px",color:T.ink,fontSize:13,outline:"none",cursor:"pointer"}}>
          <option value="">Assign to me ({userName})</option>
          {orgTeam.filter(u=>u.id!==userId).map(u=><option key={u.id} value={u.id}>Assign to {u.name}</option>)}
        </select>}
        <div style={{display:"flex",gap:8}}>
          <button onClick={addDonor} style={{background:T.greenDk,border:"none",borderRadius:8,padding:"9px 16px",color:T.white,fontSize:13,fontWeight:600,cursor:"pointer"}}>Save</button>
          <button onClick={()=>setShowAdd(false)} style={{background:T.bg,border:"none",borderRadius:8,padding:"9px 14px",color:T.ink3,fontSize:13,cursor:"pointer"}}>Cancel</button>
        </div>
      </Card>}

      {view==="directory"&&<DirectoryView donors={dirPageRows} loading={dirRows===null||(searchPending&&dirPageRows.length===0)} serverTotal={dirTotal} page={dirPage} pageSize={DIR_PAGE_SIZE} onPage={setDirPage} clientFilterCount={0} exportParams={{role:"donor",search:dirSearch.trim(),stage:dirStage,assignedTo:dirAssignee,designation:dirDesignation,sort:dirSort,household:dirHousehold,...(dirWhereStr?{where:dirWhereStr}:{}),...(dirStatus?{[dirStatus.split(":")[0]]:dirStatus.split(":")[1]}:{})}} statusFilter={dirStatus} setStatusFilter={setDirStatus} sortBy={dirSort} setSortBy={v=>{setDirSort(v);setDirDir("");}} sortDir={dirDir} setSort={(k,d)=>{setDirSort(k);setDirDir(d);}} household={dirHousehold} clearHousehold={()=>setDirHousehold("")} totalDonors={peopleCount?peopleCount.total:undefined} orgTeam={orgTeam} isAdmin={isAdmin} onSelectDonor={selectDonor} onAssign={d=>setAssignTarget(d)} stageFilter={dirStage} setStageFilter={setDirStage} assigneeFilter={dirAssignee} setAssigneeFilter={setDirAssignee} designationFilter={dirDesignation} setDesignationFilter={setDirDesignation} officers={officers} officerColorMap={officerColorMap} portfolioMeta={portfolioMeta} pendingInvites={pendingInvites} onOfficersChanged={loadOfficers} onLoadSampleData={loadSampleData} sampleLoading={sampleLoading} hasSampleData={sampleStatus?.hasSampleData} onAddDonor={()=>setShowAdd(true)} onBulkDone={reloadDonors} isReadOnly={isReadOnly} listSetup={listSetup} layout={layout} setLayoutLocal={setLayout} persistLayout={persistLayout} resetLayout={resetLayout} saveOrgLayout={saveOrgLayout} where={dirWhere} setWhere={w=>{setDirWhere(w);}} filterError={filterError} views={(listSetup&&listSetup.views)||[]} activeViewId={activeViewId} onPickView={pickView} onSaveView={saveView} onDeleteView={deleteView} onPageSize={n=>persistLayout({pageSize:n}).catch(e=>console.warn("[list-layout]",e&&e.message))}/>}

      {wholeOrgView&&!orgPeople&&<div style={{display:"flex",justifyContent:"center",padding:"40px 0"}}><Spin/></div>}
      {view==="team"&&isAdmin&&orgPeople&&<TeamView donors={filtered} orgTeam={orgTeam} onSelectDonor={selectDonor}/>}

      {view==="reengage"&&orgPeople&&<ReEngageView donors={filtered} org={data.org} onLogTouchpoint={d=>setLogTarget(d)} onSelectDonor={selectDonor}/>}
      {view==="map"&&mapOn&&orgPeople&&<DonorMap donors={filtered} userId={userId} onSelectDonor={selectDonor} apiFetch={apiFetch}/>}
      {view==="health"&&<DataHealth isReadOnly={isReadOnly} onOpenDonor={id=>openIfOnFile(id,()=>reloadDonors&&reloadDonors())}/>}
      </>)}
    </SheetDropTarget>
  );
}
