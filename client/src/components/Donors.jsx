import { useState, useEffect, useRef, useMemo, useContext, Component } from "react";
import { FunderPanel } from "./FunderPanel";
import { GrantImport } from "./GrantImport";
import Papa from "papaparse";
import { VolunteerPanel, HoursImportModal } from "./VolunteerPanel";
import { MembershipPanel } from "./Memberships";
import * as HOURS_PRESETS_MOD from "../../../shared/volunteerHours.js";
import { apiFetch, API, getToken, adaptDonor } from "../api";
import { rethrowProgrammerError, errorMessage, isProgrammerError } from "../lib/domainError";
import { useAuth } from "../main";
import UpgradeModal from "./UpgradeModal";
import Uploader from "./Uploader";
import { bestCampaignMatch } from "../lib/campaignMatch";
import { dueBadge } from "../lib/taskDue";
import { PERSON_TYPES } from "../../../shared/personType.js";
import { detectMailchimpAudience, typeSuggestionForTags, rowIsUnsubscribed, fileStatusFromName } from "../../../shared/mailchimpPreset.js";
import { detectNpsp, npspMapping, npspOrganizationName, NPSP_PRESET, NPSP_OBJECT_OPPORTUNITY } from "../../../shared/npspPreset.js";
import { detectMigrationPreset, migrationMapping, MIGRATION_PRESETS } from "../../../shared/migrationPresets.js";
import { membershipColumns, detectMembershipPreset, buildMembershipRows, MEMBERSHIP_FIELDS, MEMBERSHIP_FIELD_LABELS, MEMBERSHIP_PRESETS } from "../../../shared/membershipImport.js";
import { censusById } from "../../../shared/numberCensus.js";
import { guardSuggestion, droppedLine, plainText } from "../../../shared/suggestionGuard.js";
import { renderCustomValue, coerceCustomValue, parseBoolValue, parseExclusionValue, buildMapperPlan, buildColumnLedger, summarizeColumnLedger, countPhysicalColumns, proposalEvidenceText, proposeCustomField, generateFieldKey, CF_TYPES } from "../../../shared/customFieldShape";
import { T, fmt, fmtFull, daysDiff, SC, askClaude, STAGES, STAGE_ACTION, TIER_COLOR, donorScore, moveUrgency, Spin, Pill, Card, AIBtn, AIPanel, PageTitle, EmptyState, GivingHistoryChart, TpField, TpYesNo, TouchpointTimeline, LockedFeature, goToPricing, DriftBadge, Modal, firstNameOf, PersonMark, PhotoContext } from "./shared";
import { ProposalsPanel, PlanPanel, BriefPanel } from "./MajorGifts";
import { LogConversationModal, ThreadDismissMenu, PutItOnMyCalendar } from "./LogConversation";
// SHELVED — voice capture works but unproven adoption assumption, revisit
// later. Code intact, re-enable by uncommenting (see showVoiceMemo state,
// profile button, and modal render below, and add `VoiceMemoModal` back to
// the import above).
import { DonorMap } from "./DonorMap";
import { detectImportShape, groupTransactions, shapeLabel, YEAR_HDR_PAT, detectWorkbookRoles, pickMatchKey, linkGiftsToDonors, detectOwnerColumn, matchOwnersToUsers, applyOwnerAssignment, groupOwnerMatches, normalizeName, normalizeDate, normalizeMoney, normalizeEmail, detectFlagColumns, parseBoolFlag, classifyColumns, decodeSpreadsheetBytes, decodeSpreadsheetBytesDetailed, analyzeCsvText, analyzeSheetRows, assessAggregateCollapse, scanAmountShapedColumns, headerMatchesLabel, eitherContainsTokenRun, containsTokenRun, tokenizeText, normalizeHeader, localCivilToday, resolveDonorIdentity, NAMEABILITY_REASON, stageAssignmentBasis, validateMappingChoice, columnTypeEvidence, buildGiftItemsFromLedger, buildTransactionRows, buildProposalRows, detectNoteMarkers, autoDetectTxMapping, inferDateConvention, extractWorkbookFromSheetJS, analyzeWorkbookSheet, classifyWorkbookSheets } from "../../../shared/importShape";
import { WorkbookImport } from "./WorkbookImport";
import { ColumnTargetSelect } from "./ColumnTargetSelect";
import { PlanFollowUpModal } from "./PlanFollowUp";
import { AssignModal, DirectoryView, FilterBar, ReEngageView, TeamView } from "./DonorDirectory";
import { DonorImport, GiftHistoryImport, MergeDuplicatesModal, parseFileToSheets } from "./DonorImport";
import { DonorProfile, EditDonorModal, FollowUpTaskModal, LogTouchpointModal } from "./DonorProfile";
import { PATTERN_META, TIER_META } from "./donorShared";
export { DonorImport } from "./DonorImport";

class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error("DonorProfile error:", error, info); }
  render() {
    if (this.state.error) {
      return (
        <div style={{padding:"32px 24px",textAlign:"center",color:"#b8593f",fontSize:14}}>
          <div style={{fontWeight:700,marginBottom:8}}>Something went wrong loading this profile.</div>
          <div style={{color:"#5a554f",marginBottom:16}}>{this.state.error?.message}</div>
          <button onClick={()=>this.setState({error:null})} style={{background:"#0d5c3a",border:"none",borderRadius:8,padding:"8px 18px",color:"#fff",fontSize:13,fontWeight:600,cursor:"pointer"}}>Try again</button>
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
  const lapsedCount=data.donors.filter(d=>!d.deceased&&!d.doNotContact&&!d.doNotSolicit&&!d.importedSustainer&&(d.stage==="lapsed"||(d.lastGift&&daysDiff(d.lastGift)>365))).length;   // BUILD-77 — the badge matches the (gated) list
  const[view,setView]=useState(initialView||"directory");
  const[search,setSearch]=useState("");
  const[selected,setSelected]=useState(()=>initialSelectDonorId?data.donors.find(d=>d.id===initialSelectDonorId)||null:null);
  const[logTarget,setLogTarget]=useState(()=>initialLogDonorId?data.donors.find(d=>d.id===initialLogDonorId)||null:null);
  // BUILD-81 — the "Log a conversation" picker (directory toolbar) + target.
  const[convoPickerOpen,setConvoPickerOpen]=useState(false);
  const[convoTarget,setConvoTarget]=useState(null);
  const[convoSearch,setConvoSearch]=useState("");
  const[editTarget,setEditTarget]=useState(null);
  const[followUpTarget,setFollowUpTarget]=useState(null);
  const[aiMap,setAiMap]=useState({});const[loadingKey,setLoadingKey]=useState(null);
  const[callList,setCallList]=useState("");const[callLoading,setCallLoading]=useState(false);
  const[showAdd,setShowAdd]=useState(false);const[showImport,setShowImport]=useState(false);const[showGiftImport,setShowGiftImport]=useState(false);const[showCombinedImport,setShowCombinedImport]=useState(false);const[showMerge,setShowMerge]=useState(false);const[toolsOpen,setToolsOpen]=useState(false);const[showHours,setShowHours]=useState(false);const[showGrantImport,setShowGrantImport]=useState(false);
  const[upgradeModal,setUpgradeModal]=useState(null);
  const[newDonor,setNewDonor]=useState({name:"",email:"",phone:"",lastAmount:"",stage:"prospect"});
  const[filtersOpen,setFiltersOpen]=useState(false);
  const[filters,setFilters]=useState({tiers:[],stages:[],pattern:"",geo:"",giftFrom:"",giftTo:"",totalMin:"",totalMax:""});
  const[orgTeam,setOrgTeam]=useState([]);
  const[customFields,setCustomFields]=useState([]);
  const[cfValues,setCfValues]=useState({});
  const[cfFilters,setCfFilters]=useState({});
  const[dirStage,setDirStage]=useState(initialStageFilter||"");
  const[dirAssignee,setDirAssignee]=useState("");
  const[dirDesignation,setDirDesignation]=useState("");   // BUILD-14 planned-giving/estate segment
  const[officers,setOfficers]=useState([]);               // BUILD-14 officer portfolios + color
  const[portfolioMeta,setPortfolioMeta]=useState({tier:"core",single_user:true});
  const[pendingInvites,setPendingInvites]=useState([]); // [{id:"invite:<id>",name,email,pending}] — bulk assign-owner to a not-yet-accepted officer (B2)
  const[assignTarget,setAssignTarget]=useState(null);
  const[sampleStatus,setSampleStatus]=useState(null);
  const[sampleLoading,setSampleLoading]=useState(false);
  // Server-paginated directory (BUILD-06 Phase A): the Directory view fetches
  // its own 50-row pages with search/stage/owner pushed to query params;
  // data.donors (now /donors/summaries) keeps feeding the whole-org views
  // (pipeline/team/re-engage/map) and everything else.
  const DIR_PAGE_SIZE=50;
  const[dirPage,setDirPage]=useState(0);
  const[dirRows,setDirRows]=useState(null); // null = loading
  const[dirTotal,setDirTotal]=useState(0);
  const[dirSearch,setDirSearch]=useState(search);
  const[dirReloadKey,setDirReloadKey]=useState(0);
  useEffect(()=>{const t=setTimeout(()=>setDirSearch(search),300);return()=>clearTimeout(t);},[search]);
  useEffect(()=>{setDirPage(0);},[dirSearch,dirStage,dirAssignee,dirDesignation]);
  useEffect(()=>{
    if(view!=="directory")return;
    let cancelled=false;
    (async()=>{
      try{
        const qs=new URLSearchParams({limit:String(DIR_PAGE_SIZE),offset:String(dirPage*DIR_PAGE_SIZE)});
        if(dirSearch.trim())qs.set("search",dirSearch.trim());
        if(dirStage)qs.set("stage",dirStage);
        if(dirAssignee)qs.set("assignedTo",dirAssignee);
        if(dirDesignation)qs.set("designation",dirDesignation);
        const r=await apiFetch(`/donors?${qs.toString()}`);
        if(cancelled)return;
        setDirRows((r.donors||[]).map(adaptDonor));
        setDirTotal(r.total||0);
      }catch(e){console.error(e);if(!cancelled)setDirRows([]);}
    })();
    return()=>{cancelled=true;};
  },[view,dirPage,dirSearch,dirStage,dirAssignee,dirDesignation,dirReloadKey]);
  // Officer color map — assigned_to → hex; used for portfolio color-coding.
  const officerColorMap=useMemo(()=>Object.fromEntries(officers.filter(o=>o.portfolio_color).map(o=>[o.id,o.portfolio_color])),[officers]);

  useEffect(()=>{
    if((initialView||initialLogDonorId||initialStageFilter||initialSelectDonorId||initialOpenImport)&&onIntentConsumed)onIntentConsumed();
    // The setup checklist's "Import your donors" deep link lands with the
    // one-file magical import (Import + History) already open — the exact
    // spot, not the tab root.
    if(initialOpenImport&&!isReadOnly)setShowCombinedImport(true);
    // A deep-linked selection starts from a summary row — upgrade it to the
    // full record (selectDonor is defined below; safe to call from here).
    if(initialSelectDonorId){
      const d=data.donors.find(x=>x.id===initialSelectDonorId);
      if(d)selectDonor(d);
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
    if(filters.pattern==="lapsed"&&!(d.stage==="lapsed"||(d.lastGift&&daysDiff(d.lastGift)>365)))return false;
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

  const filtered=data.donors
    .filter(d=>!search||(d.name+d.email).toLowerCase().includes(search.toLowerCase()))
    .filter(matchesAdvanced)
    .filter(matchesCf);
  const dirPageRows=(dirRows||[]).filter(matchesAdvanced).filter(matchesCf);

  const loadOfficers=()=>apiFetch("/portfolio/officers").then(r=>{setOfficers(r.officers||[]);setPortfolioMeta({tier:r.tier||"core",single_user:!!r.single_user});setPendingInvites((r.invites||[]).map(i=>({id:"invite:"+i.id,name:i.name,email:i.email,pending:true})));}).catch(()=>{});
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
    setData(prev=>({...prev,donors:prev.donors.map(d=>d.id===donorId?{...d,assignedTo:assignedToId,assignedToName}:d)}));
    patchDirRows(donorId,{assignedTo:assignedToId,assignedToName});
    if(selected?.id===donorId)setSelected(prev=>({...prev,assignedTo:assignedToId,assignedToName}));
  };

  const moveToStage=async(donorId,stage)=>{
    setData(prev=>({...prev,donors:prev.donors.map(d=>d.id===donorId?{...d,stage}:d)}));
    patchDirRows(donorId,{stage});
    if(selected?.id===donorId)setSelected(prev=>({...prev,stage}));
    try{await apiFetch(`/donors/${donorId}/stage`,{method:"PATCH",body:JSON.stringify({stage})});}
    catch(e){console.error(e);}
  };

  const handleLogged=(donor,interaction)=>{
    const updated={...donor,lastTouchpoint:interaction.date,interactions:[interaction,...(donor.interactions||[])]};
    setData(prev=>({...prev,donors:prev.donors.map(d=>d.id===donor.id?updated:d)}));
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

  const getAI=async(donor,type)=>{
    const key=`${donor.id}_${type}`;setLoadingKey(key);setAiMap(p=>({...p,[key]:""}));
    const stage=STAGES.find(s=>s.id===(donor.stage||"cultivate"))||STAGES[2];
    const urg=moveUrgency(donor);
    const sys=`You are an expert major gifts officer. Be specific, strategic, brief. Max 200 words. Use ONLY the facts given below: never name a person, number, program or outcome that is not in them. Plain sentences, no markdown, no headings, no bullet points.`;
    let threadCtx="";
    if(type==="email"||type==="outreach"){
      try{
        const thread=await apiFetch(`/gmail/thread/${donor.id}`);
        if(thread.length>0){
          threadCtx=`\n\nRecent email history with this donor:\n${thread.map(t=>`[${t.created_at.split("T")[0]}] ${t.direction==="outbound"?"You":donor.name}: "${t.subject}" — ${t.note.slice(0,200)}`).join("\n")}`;
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
      nextmove:`Donor: ${donor.name} | Stage: ${stage.label} | Days since contact: ${urg.days} | Total: ${fmtFull(donor.total)} (${donor.gifts} gifts) | Last: ${fmtFull(donor.lastAmount)} on ${donor.lastGift}\nNotes: ${donor.notes||"none"}\nOrg: ${data.org.name} — ${data.org.mission}\nRecent touchpoints: ${donor.interactions?.slice(0,3).map(i=>`${i.date}: ${i.type} - ${i.note}`).join("; ")||"none"}\n\nIn four short plain sentences: the move to make, when to make it, what to say, and what it is for.`,
      outreach:`Write an outreach strategy for ${donor.name} (${stage.label} stage).\nTotal: ${fmtFull(donor.total)}, last gift ${fmtFull(donor.lastAmount)} ${urg.days}d ago.\nNotes: ${donor.notes}\nOrg: ${data.org.mission}${threadCtx}\n\nBest channel, talking points, suggested ask amount, personal hook.`,
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
      await askClaude(sys,prompts[type],chunk=>{full=chunk;});
      const record={
        donor:{id:donor.id,name:donor.name,email:donor.email,contact_name:donor.contactName||donor.contact_name,
               total:donor.total,gifts:donor.gifts,lastAmount:donor.lastAmount,lastGift:donor.lastGift},
        orgName:[data.org?.name,data.org?.mission].filter(Boolean).join(" "),
        names:[stage.label,...(donor.tags||[])],
        rows:[{id:"contact",count:urg.days},
              ...(donor.interactions||[]).slice(0,20).map((i,n)=>({id:i.id||("int"+n),amount:i.amount,date:i.date,label:i.note,type:i.type}))],
      };
      const g=guardSuggestion(full,record);
      const kept=g.kept.map(k=>plainText(k.text)).join(" ");
      const out=[kept||"Steward had nothing it could say from this record.",droppedLine(g.dropped)].filter(Boolean).join("\n\n");
      setAiMap(p=>({...p,[key]:out}));
    }
    catch(e){setAiMap(p=>({...p,[key]:errorMessage(e,"No suggestion is available right now.")}));}
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
    try{
      const donors=await apiFetch("/donors/summaries");
      setData(prev=>({...prev,donors:donors.map(adaptDonor)}));
      setDirReloadKey(k=>k+1); // refresh the Directory's server page too
    }catch(e){console.error(e);}
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
    }catch(e){console.error(e);}
  };

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
    setData(prev=>({...prev,donors:prev.donors.map(d=>d.id===raw.id?adapted:d)}));
    setDirRows(prev=>prev?prev.map(d=>d.id===raw.id?adapted:d):prev);
    if(selected?.id===raw.id)setSelected(adapted);
    setEditTarget(null);
  };

  const deleteDonor=async(id)=>{
    if(!window.confirm("Delete this donor? This cannot be undone."))return;
    try{
      await apiFetch(`/donors/${id}`,{method:"DELETE"});
      setData(prev=>({...prev,donors:prev.donors.filter(d=>d.id!==id)}));
      setDirRows(prev=>prev?prev.filter(d=>d.id!==id):prev);
      setDirTotal(t=>Math.max(0,t-1));
      setSelected(null);
    }catch(e){console.error(e);}
  };

  const generateCallList=async()=>{
    setCallLoading(true);setCallList("");
    await askClaude(`You are a chief development officer. Be tactical. Max 200 words.`,
      `Prioritized call list for this week:\n${data.donors.map(d=>`${d.name} [${d.stage||"cultivate"}]: ${daysDiff(d.lastTouchpoint||d.lastGift)}d since contact, ${fmtFull(d.lastAmount)} last gift, score ${donorScore(d)??"none (no gifts on file)"}, notes: ${d.notes}`).join("\n")}`,
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
    setData(prev=>({...prev,donors:[...prev.donors,temp]}));
    setShowAdd(false);setNewDonor({name:"",email:"",phone:"",lastAmount:"",stage:"prospect"});setNewDonorAssignee("");
    try{await apiFetch("/donors",{method:"POST",body:JSON.stringify({...newDonor,stage:newDonor.stage,assignedTo:assignTo,assignedToName:assignToName})});await reloadDonors();}
    catch(e){
      if(e.error==="record_limit"){
        setData(prev=>({...prev,donors:prev.donors.filter(d=>d.id!==temp.id)}));
        setUpgradeModal({reason:e.error,current:e.current,limit:e.limit,plan:e.plan});
      } else { console.error(e); }
    }
  };

  return(
    <div style={{display:"flex",flexDirection:"column",gap:8}}>
      <PageTitle main="Your" accent="donors."/>
      {assignTarget&&<AssignModal donor={assignTarget} orgTeam={orgTeam} onSave={handleAssign} onClose={()=>setAssignTarget(null)}/>}
      {showImport&&<DonorImport org={data.org} onOpenHome={onNavigate?()=>onNavigate("dashboard"):null} onClose={()=>setShowImport(false)} onImported={()=>{reloadDonors();setShowImport(false);}}/>}
      {showGiftImport&&<GiftHistoryImport donors={data.donors} org={data.org} onOpenHome={onNavigate?()=>onNavigate("dashboard"):null} onClose={()=>setShowGiftImport(false)} onImported={()=>{reloadDonors();setShowGiftImport(false);}}/>}
      {showMerge&&<MergeDuplicatesModal onClose={()=>setShowMerge(false)} onMerged={reloadDonors} isReadOnly={isReadOnly}/>}
      {showGrantImport&&<GrantImport onClose={()=>setShowGrantImport(false)} parseFile={parseFileToSheets} onDone={reloadDonors}/>}
      {showHours&&<HoursImportModal onClose={()=>setShowHours(false)} onDone={reloadDonors} Modal={Modal} Papa={Papa} presets={HOURS_PRESETS_MOD}/>}
      {/* BUILD-58 Part 2 — the RECOMMENDED "Import + History" entry now opens the
          MAGICAL import (DonorImport withHistory: shape detection + the
          "Import both" two-sheet CTA). The legacy CombinedImport, whose
          multi-sheet picker forced ONE sheet, is retired — a pilot following
          the recommended path gets the good path. */}
      {showCombinedImport&&<DonorImport withHistory org={data.org} onOpenHome={onNavigate?()=>onNavigate("dashboard"):null} onClose={()=>setShowCombinedImport(false)} onImported={()=>{reloadDonors();setShowCombinedImport(false);}}/>}
      {upgradeModal&&<UpgradeModal open={true} onClose={()=>setUpgradeModal(null)} reason={upgradeModal.reason} current={upgradeModal.current} limit={upgradeModal.limit} plan={upgradeModal.plan}/>}
      {logTarget&&<LogTouchpointModal donor={logTarget} onSave={int=>handleLogged(logTarget,int)} onClose={()=>setLogTarget(null)}/>}
      {convoPickerOpen&&(
        <Modal onClose={()=>setConvoPickerOpen(false)} width={420} zIndex={300} align="top" padding={0}
          ariaLabel="Log a conversation" dialogStyle={{borderRadius:16,border:"1px solid "+T.bg3,maxHeight:"70vh"}}>
          <div style={{display:"flex",flexDirection:"column",overflow:"hidden",maxHeight:"100%"}}>
            <div style={{padding:"16px 18px 10px"}}>
              <div style={{fontSize:15,fontWeight:800,color:T.ink,marginBottom:8}}>Who did you talk to?</div>
              <input autoFocus value={convoSearch} onChange={e=>setConvoSearch(e.target.value)} placeholder="Search donors…"
                style={{width:"100%",background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"9px 12px",color:T.ink,fontSize:13,outline:"none",boxSizing:"border-box"}}/>
            </div>
            <div style={{overflowY:"auto",padding:"0 8px 10px"}}>
              {data.donors.filter(d=>!convoSearch.trim()||(d.name||"").toLowerCase().includes(convoSearch.toLowerCase())||(d.email||"").toLowerCase().includes(convoSearch.toLowerCase())).slice(0,30).map(d=>(
                <button key={d.id} onClick={()=>{setConvoPickerOpen(false);setConvoSearch("");setConvoTarget(d);}}
                  style={{display:"block",width:"100%",textAlign:"left",background:"none",border:"none",borderRadius:8,padding:"9px 10px",cursor:"pointer"}} className="click-card">
                  <span style={{fontSize:13,fontWeight:700,color:T.ink}}>{d.name}</span>
                  {d.email&&<span style={{fontSize:11.5,color:T.ink3,marginLeft:8}}>{d.email}</span>}
                </button>
              ))}
              {data.donors.length===0&&<div style={{fontSize:12.5,color:T.ink3,padding:"6px 10px 12px"}}>No donors yet. Import your donors first, then log the first call.</div>}
            </div>
          </div>
        </Modal>
      )}
      {convoTarget&&<LogConversationModal donor={{id:convoTarget.id,name:convoTarget.name}} org={data.org} onNavigate={onNavigate}
        onSaved={()=>{reloadDonors&&reloadDonors();}} onClose={()=>setConvoTarget(null)}/>}
      {followUpTarget&&<FollowUpTaskModal donor={followUpTarget} onClose={()=>setFollowUpTarget(null)} onSave={task=>{setData(prev=>({...prev,tasks:[task,...prev.tasks]}));setFollowUpTarget(null);}}/>}
      {editTarget&&<EditDonorModal donor={editTarget} onSave={handleEditSaved} onClose={()=>setEditTarget(null)}/>}
      {selected ? (
      <ErrorBoundary key={selected.id}><DonorProfile donor={selected} onClose={()=>setSelected(null)}
        onStageChange={moveToStage} onLogTouchpoint={()=>{setLogTarget(selected);}}
        aiMap={aiMap} loadingKey={loadingKey} getAI={getAI}
        isAdmin={isAdmin} onEdit={()=>setEditTarget(selected)} onDelete={deleteDonor}
        tasks={data.tasks.filter(t=>t.donorId===selected.id)} onTaskToggle={toggleTask} onAddTask={()=>setFollowUpTarget(selected)}
        orgName={data.org?.name||""} org={data.org} orgTeam={orgTeam} onReassign={handleAssign} onCfSaved={reloadCfValues} onInteractionAdded={reloadDonors}
        onNavigate={onNavigate}
        initialOpenConversation={!!initialOpenConversation&&selected.id===initialSelectDonorId}
        isReadOnly={isReadOnly} allDonors={data.donors} onSelectRelatedDonor={id=>{const d=data.donors.find(x=>x.id===id);if(d)selectDonor(d);}}/></ErrorBoundary>
      ) : (<>

      <div className="donors-toolbar" style={{display:"flex",gap:10,flexWrap:"wrap",alignItems:"center"}}>
        <input className="donors-search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search donors…" style={{flex:1,minWidth:160,background:T.bg,border:"1px solid "+T.bg3,borderRadius:10,padding:"10px 14px",color:T.ink,fontSize:13,outline:"none"}}/>
        <div className="donors-view-toggle" style={{display:"flex",background:T.bg,border:"1px solid "+T.bg3,borderRadius:10,overflow:"hidden"}}>
          {[["directory","Directory"],...(isAdmin?[["team","Team"]]:[]),["reengage","Re-engage"],["map","Map"]].map(([v,l])=>(
            <button key={v} onClick={()=>setView(v)} style={{background:view===v?T.bg2:"transparent",border:"none",padding:"9px 14px",color:view===v?T.ink:"#5a554f",fontSize:13,fontWeight:view===v?700:400,cursor:"pointer",display:"flex",alignItems:"center",gap:5}}>
              {l}
              {v==="reengage"&&lapsedCount>0&&<span style={{background:"#0d5c3a",color:"#fff",borderRadius:99,padding:"1px 6px",fontSize:10,fontWeight:800,lineHeight:1.4}}>{lapsedCount}</span>}
            </button>
          ))}
        </div>
        <AIBtn onClick={generateCallList} loading={callLoading} label="✦ Call List"/>
        {/* BUILD-81 Part 5 — logging a conversation is the primary act (it IS
            creating the follow-up); above the fold at 1440 and 390. */}
        <button onClick={()=>setConvoPickerOpen(true)} disabled={isReadOnly} title={isReadOnly?"Reactivate your subscription to make changes.":undefined} style={{background:T.gold500,border:"none",borderRadius:10,padding:"10px 14px",color:T.ink,fontSize:13,fontWeight:800,cursor:isReadOnly?"not-allowed":"pointer",opacity:isReadOnly?0.45:1}}>Log a conversation</button>
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
                {label:"Import + History",hint:"One file in, donors + full gift history out",badge:"Recommended",act:()=>setShowCombinedImport(true)},
                {label:"Import donors only",hint:"A contact list with no gift rows",act:()=>setShowImport(true)},
                {label:"Add giving history",hint:"Attach a gift export to donors already here",act:()=>setShowGiftImport(true)},
                {divider:true},
                {label:"Import volunteer hours",hint:"A Wranglr or VolunteerHub hours export",act:()=>setShowHours(true)},
                {label:"Import grants",hint:"A grants spreadsheet from another system, or your own",act:()=>setShowGrantImport(true)},
                {label:"Merge duplicates",hint:"Fold repeated records into one",act:()=>setShowMerge(true)},
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

      {(()=>{
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
              {count>0&&<span style={{background:T.greenDk,color:"#fff",borderRadius:99,padding:"0 6px",fontSize:10,fontWeight:800,lineHeight:"16px"}}>{count}</span>}
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
          {STAGES.map(s=><button key={s.id} onClick={()=>setNewDonor(p=>({...p,stage:s.id}))} style={{background:newDonor.stage===s.id?s.color+"22":T.bg,border:`1px solid ${newDonor.stage===s.id?s.color:T.bg3}`,borderRadius:7,padding:"5px 11px",color:newDonor.stage===s.id?s.color:T.ink3,fontSize:12,fontWeight:600,cursor:"pointer"}}>{s.label}</button>)}
        </div>
        {[["name","Full Name"],["email","Email"],["phone","Phone"],["lastAmount","Gift Amount ($)"]].map(([k,pl])=>(
          <input key={k} value={newDonor[k]} onChange={e=>setNewDonor(p=>({...p,[k]:e.target.value}))} placeholder={pl} style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"9px 12px",color:T.ink,fontSize:13,outline:"none"}}/>
        ))}
        {isAdmin&&orgTeam.length>1&&<select value={newDonorAssignee} onChange={e=>setNewDonorAssignee(e.target.value)} style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"9px 12px",color:T.ink,fontSize:13,outline:"none",cursor:"pointer"}}>
          <option value="">Assign to me ({userName})</option>
          {orgTeam.filter(u=>u.id!==userId).map(u=><option key={u.id} value={u.id}>Assign to {u.name}</option>)}
        </select>}
        <div style={{display:"flex",gap:8}}>
          <button onClick={addDonor} style={{background:"#0d5c3a",border:"none",borderRadius:8,padding:"9px 16px",color:"#fff",fontSize:13,fontWeight:600,cursor:"pointer"}}>Save</button>
          <button onClick={()=>setShowAdd(false)} style={{background:T.bg,border:"none",borderRadius:8,padding:"9px 14px",color:T.ink3,fontSize:13,cursor:"pointer"}}>Cancel</button>
        </div>
      </Card>}

      {view==="directory"&&<DirectoryView donors={dirPageRows} loading={dirRows===null} serverTotal={dirTotal} page={dirPage} pageSize={DIR_PAGE_SIZE} onPage={setDirPage} clientFilterCount={advFilterCount+cfFilterCount} exportParams={{search:dirSearch.trim(),stage:dirStage,assignedTo:dirAssignee,designation:dirDesignation}} totalDonors={data.donors.length} orgTeam={orgTeam} isAdmin={isAdmin} onSelectDonor={selectDonor} onAssign={d=>setAssignTarget(d)} stageFilter={dirStage} setStageFilter={setDirStage} assigneeFilter={dirAssignee} setAssigneeFilter={setDirAssignee} designationFilter={dirDesignation} setDesignationFilter={setDirDesignation} officers={officers} officerColorMap={officerColorMap} portfolioMeta={portfolioMeta} pendingInvites={pendingInvites} onOfficersChanged={loadOfficers} onLoadSampleData={loadSampleData} sampleLoading={sampleLoading} hasSampleData={sampleStatus?.hasSampleData} onAddDonor={()=>setShowAdd(true)} onBulkDone={reloadDonors} isReadOnly={isReadOnly}/>}

      {view==="team"&&isAdmin&&<TeamView donors={filtered} orgTeam={orgTeam} onSelectDonor={selectDonor}/>}

      {view==="reengage"&&<ReEngageView donors={filtered} org={data.org} onLogTouchpoint={d=>setLogTarget(d)} onSelectDonor={selectDonor}/>}
      {view==="map"&&<DonorMap donors={filtered} userId={userId} onSelectDonor={selectDonor} apiFetch={apiFetch}/>}
      </>)}
    </div>
  );
}
