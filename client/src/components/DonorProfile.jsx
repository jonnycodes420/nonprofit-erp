// DonorProfile.jsx — one person's record: the profile and the modals it opens.
//
// FIX-1 split: moved VERBATIM out of Donors.jsx. Nothing in it changed.
// Tests read it through readSource("client/src/components/Donors.jsx").
import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useScores, SuggestedAskLine } from "./ScoreWhy";
import { usePublicFiling, PublicFilingLookupModal, ProspectBriefModal } from "./RoomToGive";
import { useCanMajorGifts } from "../lib/majorGifts";
import { VolunteerPanel, AddVolunteerModal } from "./VolunteerPanel";
import { apiFetch, API, getToken } from "../api";
import { useReceipts } from "./profile/ReceiptsAndStatements";
import { usePeoplePicker, peopleNamed } from "../lib/people";
import { rethrowProgrammerError, errorMessage } from "../lib/domainError";
import { stepAgainstProposals } from "../../../shared/nextStepAgree.js";   // FIX-24 2c
import { renderCustomValue } from "../../../shared/customFieldShape";
import { useMailbox } from "./InboxConnect";
import { MeetingCard, AfterMeetingForm, ConversationChips, conversationTitle, MEETING_ACTION } from "./MeetingPanels";
import { ProfileTimeline, useTimelineExtras } from "./ProfileTimeline";
import { AtlasNote } from "./AtlasNote";   // AGENT-5
import { atlasName } from "../lib/atlas";
import { buildTimelineItems, timelineCounts } from "./MeetingPanels";
import { ProfileNumbers } from "./profile/ProfileNumbers";
import { ProfileNextMove } from "./Insights";   // INSIGHTS-1, PROFILE-2
import { RAIL, RAIL_LABEL, RailSection } from "./ProfileRail";
import { T, fmtFull, STAGES, donorScore, moveUrgency, Spin, AIPanel, Modal, firstNameOf } from "./shared";
import { BriefPanel, useDonorProposals } from "./MajorGifts";
import { LogConversationModal, ThreadDismissMenu, PutItOnMyCalendar } from "./LogConversation";
import { ItemMenu, EditedMarker, offerUndo } from "./EditHistory";
import { askConfirm } from "./ConfirmDialog";
import { PlanFollowUpModal } from "./PlanFollowUp";
import { useIsPhone } from "../lib/stickyRail";
import { useFrameHeight } from "./profile/columns";
import { StartCard } from "./profile/StartCard";
import { displayDateShort } from "../../../shared/displayDate";
import { displayName } from "../../../shared/displayName.js";
import { orgTodayCivil, orgTodayPlus, civilDaysAgo } from "../lib/orgToday";   // FIX-14 Part 1 — the org's today, never the UTC day
import OpenPledgeBanner from "./OpenPledgeBanner";   // IMPORT-5: the open pledge up front
import { savePledgeSchedule } from "./gifts/PledgeSchedule";   // GIFTS-1
import { WhyPanel } from "./WhyAnswer";
import { useDonorStatus, useDonorGone, statusTagItems } from "./ProfileStatus";
import VideoThanksModal from "./VideoThanksModal";   // PARITY-1 Part F
import { MicGlyph, openTellSteward } from "./TellStewardOpen";   // VOICE-1
import BeforeYourMeeting, { useBeforeMeeting } from "./BeforeYourMeeting";   // VOICE-3
import { told } from "../lib/stewardTold"; import { useProfileRefresh } from "../lib/profileRefresh";   // COUNTS-1
import { ComingUpMain, OPEN_PROPOSAL_KEYS, PROFILE_TABS, PROPOSAL_STAGE_LABEL, SUGGEST_KINDS, TAB_KIND, lateWords } from "./profile/profileShared";
import { EditDonorModal, FollowUpTaskModal, GiftLinkModal, LogTouchpointModal } from "./profile/modals";
import { DonorPhotoControl } from "./profile/ProfilePhoto";
import { RailFacts } from "./profile/RailFacts";
import { RailPersonCards } from "./profile/RailCards";
import { RailAboutSections } from "./profile/RailAbout";
import { RailJourneys } from "./profile/RailJourneys";
import { ProfileDialogs } from "./profile/ProfileDialogs";
import { ListTabs } from "./profile/ListTabs";
import { RelatedModal } from "./profile/RelatedModal";
import { MergeWithModal } from "./profile/MergeWith";
import { GivingTab } from "./profile/GivingTab";
import { ProfileHeader } from "./profile/ProfileHeader";

function DonorProfile({donor,onClose,onStageChange,onLogTouchpoint,aiMap,aiErr={},loadingKey,getAI,isAdmin,onEdit,onDelete,tasks=[],onTaskToggle,onAddTask,orgName="",orgTeam=[],onReassign,onCfSaved,onInteractionAdded,onRecordChanged,isReadOnly=false,onSelectRelatedDonor,onNavigate,initialOpenConversation=false,initialOpenCompose=false,initialOpenBrief=false,initialAddGift=null,org=null}){
  const [gifts,setGifts]=useState([]);
  const [giftLoading,setGiftLoading]=useState(true);
  // FIX-45 1.5: the record's one read (GET /donors/:id) carries the gifts and
  // the header's figures. It used to start last, behind ~27 other reads, and a
  // failed attempt ended "loading" with nothing in it, so the tab said
  // "Gifts & pledges 0" and the header had no figures until a reload. It now
  // starts first (the warm-up below shares the request with loadGiftsFull),
  // retries, ignores a reply for a record no longer open, and a count or an
  // empty state shows only once the read has answered.
  const [giftReadErr,setGiftReadErr]=useState(false);
  const giftReadSeq=useRef(0);
  useEffect(()=>{ apiFetch(`/donors/${donor.id}`).catch(()=>{}); },[donor.id]);
  const [localInts,setLocalInts]=useState(null); // loaded lazily from GET /donors/:id
  // FIX-14 Part 1 — the header's figures, refreshed from the same read after a
  // conversation is logged. They were the values from when the record opened,
  // so "Last met" still said "Not met yet" beside a meeting just logged.
  const [figs,setFigs]=useState(null);
  // INT-BUILD-1 — meetings, threads, rhythm and this year, in one read.
  const [rel,setRel]=useState(null);
  // VOICE-4: bumped by anything Tell Steward or the gift form changes, so the
  // status (Average, Largest), the meeting card and the rail re-read at once.
  const [toldNonce,setToldNonce]=useState(0);
  const before=useBeforeMeeting(donor?.id, toldNonce);   // VOICE-3: a meeting with them today or tomorrow
  // ENGAGE-1 — the two scores and the suggested ask, one read.
  const scores=useScores(donor.id);
  // PROSPECT-1 — Room to give, the screening results, an organization's
  // public filing and the prospect brief: admins and the major gifts
  // permission only. The filing read is the cache; a lookup is a POST.
  const canMajorGifts=useCanMajorGifts();
  const [publicFiling,setPublicFiling]=usePublicFiling(donor.id, canMajorGifts&&donor.kind==="organisation");
  const [filingLookupOpen,setFilingLookupOpen]=useState(false);
  const [prospectBriefOpen,setProspectBriefOpen]=useState(false);
  // PARITY-1 — tags, closeness, at a glance, highlights and the next action, one read.
  const [stepNonce,setStepNonce]=useState(0);
  const status=useDonorStatus(donor.id, figs, `${stepNonce}:${toldNonce}`);
  // FLOWS-1: merged away while open, so the kept record is shown (the status poll stops itself)
  useDonorGone(donor.id, g=>{if(g.gone==="merged"&&g.keptId&&g.keptId!==donor.id&&onSelectRelatedDonor)onSelectRelatedDonor(g.keptId);});
  const [logMeeting,setLogMeeting]=useState(null);
  // TRUST-2 — export and erase.
  const [eraseOpen,setEraseOpen]=useState(false);
  // FIX-14 Part 3 — the one next step's edit, planned giving's add line, and
  // the two panels that moved under More (Suggested, Brief me).
  const [stepEdit,setStepEdit]=useState(null);
  const [stepBusy,setStepBusy]=useState(false);
  const [pgOpen,setPgOpen]=useState(false);
  const [suggestOpen,setSuggestOpen]=useState(false);
  const [briefOpen,setBriefOpen]=useState(false);
  const [mailbox]=useMailbox();
  const inboxConnected=!mailbox||mailbox.failed||!!mailbox.connected;
  const [eraseWord,setEraseWord]=useState("");
  const [eraseBusy,setEraseBusy]=useState(false);
  const [eraseMsg,setEraseMsg]=useState("");
  const exportPersonData=async()=>{
    try{
      const r=await fetch(`${API}/donors/${donor.id}/export-data`,{headers:{Authorization:`Bearer ${getToken()}`}});
      if(!r.ok)throw new Error("export failed");
      const url=URL.createObjectURL(await r.blob()),a=document.createElement("a");
      a.href=url;a.download=`${(donor.name||"person").replace(/[^a-z0-9]+/gi,"-").toLowerCase()}-data.json`;
      document.body.appendChild(a);a.click();document.body.removeChild(a);URL.revokeObjectURL(url);
    }catch{ window.alert("The export did not download. Try again."); }
  };
  const erasePerson=async()=>{
    setEraseBusy(true);setEraseMsg("");
    try{ const r=await apiFetch(`/donors/${donor.id}/erase`,{method:"POST",body:JSON.stringify({confirm:"ERASE"})}); setEraseMsg(r.sentence); onInteractionAdded&&onInteractionAdded(); setTimeout(()=>onClose&&onClose(),1800); }
    catch(e){ setEraseMsg(e?.message||"The erasure did not run. Nothing was changed."); }
    setEraseBusy(false);
  };
  // PROFILE-1 (header): whatever re-reads the relationship re-reads the rail.
  const loadRel=()=>{ if(typeof loadRailRef.current==="function")loadRailRef.current(); return apiFetch(`/donors/${donor.id}/relationship`).then(setRel).catch(()=>setRel(null)); };
  const loadRailRef=useRef(null);
  useEffect(()=>{ setRel(null); loadRel(); },[donor.id]);
  const [sequences,setSequences]=useState([]);
  useEffect(()=>{apiFetch("/sequences").then(rows=>setSequences(Array.isArray(rows)?rows.filter(s=>s.status==="active"):[])).catch(()=>{});},[]);
  // ── BUILD-81 — the donor's THREAD, shown at the top of the record. One
  // open thread per donor: the last touch, the next step, days open. "Log a
  // conversation" is the primary action; the next-step prompt rides the same
  // flow and a skip is recorded as skipped.
  const [dpThread,setDpThread]=useState(null);
  const [dpItems,setDpItems]=useState([]);
  const [convoOpen,setConvoOpen]=useState(initialOpenConversation);
  // FIX-60: Home's "Draft" opens the draft (More › Draft an email), and its
  // "Build a visit briefing" opens Brief me, once the record has loaded.
  // The intent is read at mount: Donors clears it before the record arrives.
  const intent=useRef(initialOpenCompose?"compose":initialOpenBrief?"brief":null);
  if(!intent.current&&(initialOpenCompose||initialOpenBrief))intent.current=initialOpenCompose?"compose":"brief";
  useEffect(()=>{
    if(!intent.current||intent.current==="done"||!donor||!donor.name)return;
    if(intent.current==="compose"&&getAI){setSuggestOpen(true);getAI(donor,"email");}
    else if(intent.current==="brief")setBriefOpen(true);
    intent.current="done";
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[initialOpenCompose,initialOpenBrief,donor&&donor.name]);
  // FIX-14 Part 2 — the entry being edited (opens the form it was made with),
  // and the ten-second Undo after a delete.
  const [editingInt,setEditingInt]=useState(null);
  const [planOpen,setPlanOpen]=useState(false);   // BUILD-85 — plan forward on this donor
  // BUILD-88a A.2 — EVERY OPEN ITEM FOR THIS DONOR, ranked by the one ranking.
  // The profile showed the thread and nothing else, so a task created by
  // "+ Add task", a pipeline move or a workflow recipe was an open promise to
  // this person that their own record did not mention.
  // HOTFIX-1 — the open work is loaded before the next move is asked for, so
  // "what do I do next" can never answer with nothing while a follow-up or a
  // proposal sits open on the same screen.
  const [dpItemsLoaded,setDpItemsLoaded]=useState(false);
  const [openProposals,setOpenProposalsRaw]=useState([]);
  // FIX-24 2c: whether The Ask has read the proposals yet; until it has, the
  // next step is shown as typed.
  const [proposalsKnown,setProposalsKnown]=useState(false);
  const setOpenProposals=useCallback(ps=>{setOpenProposalsRaw(ps);setProposalsKnown(true);},[]);
  // PROFILE-1 (header) — the proposals are read once, here, and handed to the
  // ask card and to the Asks & pipeline tab, so the rail's next step knows
  // about an open ask whichever tab is showing.
  const [propData,reloadProps]=useDonorProposals(donor.id);
  useEffect(()=>{ if(propData)setOpenProposals(propData.proposals.filter(p=>OPEN_PROPOSAL_KEYS.includes(p.stage))); },[propData,setOpenProposals]);
  const loadDpThread=(initial)=>apiFetch(`/threads?donorId=${donor.id}`).then(r=>{
    if(initial!==true)setStepNonce(n=>n+1);   // FIX-27 Part 5: after a save, the summary reads the same step
    setDpItems(Array.isArray(r.list)?r.list:[]);
    setDpThread((r.list||[]).find(x=>x.kind!=="task")||null);
  }).catch(()=>{}).finally(()=>setDpItemsLoaded(true));
  useEffect(()=>{setDpItemsLoaded(false);setOpenProposalsRaw([]);setProposalsKnown(false);loadDpThread(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[donor.id]);

  // Related donors (household/spouse/family/employer_match) — manual
  // linking only, see server.js's donor_relationships routes.
  const [relationships,setRelationships]=useState([]);
  const [relLoading,setRelLoading]=useState(true);
  const [relPickerOpen,setRelPickerOpen]=useState(false);
  const [relSearch,setRelSearch]=useState("");
  // POLISH-4: an organization's first link is to its owner or a person who works there, not a spouse.
  const [relType,setRelType]=useState(()=>/^organi[sz]ation$/i.test(String(donor.kind||""))||(donor.personTypes||[]).includes("organization")?"owner":"spouse");
  const [relSaving,setRelSaving]=useState(false);
  const [relErr,setRelErr]=useState("");
  const loadRelationships=()=>{
    setRelLoading(true);
    apiFetch(`/donors/${donor.id}/relationships`)
      .then(r=>{setRelationships(r.relationships||[]);})
      .catch(()=>{setRelationships([]);})
      .finally(()=>setRelLoading(false));
  };
  useEffect(()=>{loadRelationships();},[donor.id]);

  const linkDonor=async(relatedDonorId)=>{
    setRelSaving(true);setRelErr("");
    try{
      await apiFetch(`/donors/${donor.id}/relationships`,{method:"POST",body:JSON.stringify({relatedDonorId,relationshipType:relType})});
      setRelPickerOpen(false);setRelSearch("");
      loadRelationships();
    }catch(e){setRelErr(errorMessage(e, "Could not link donor"));}
    setRelSaving(false);
  };
  const unlinkDonor=async(relId)=>{
    try{const r=await apiFetch(`/donor-relationships/${relId}`,{method:"DELETE"});loadRelationships();offerUndo(r,"relationship",loadRelationships);}
    catch(e){alert(errorMessage(e,"The relationship could not be removed."));}
  };
  // FIX-14 Part 3 — a relationship's kind is edited in place.
  const retypeRelationship=async(relId,relationshipType)=>{
    try{await apiFetch(`/donor-relationships/${relId}`,{method:"PUT",body:JSON.stringify({relationshipType})});loadRelationships();}
    catch(e){alert(errorMessage(e,"The relationship could not be changed."));}
  };
  const linkedIds=new Set(relationships.map(r=>r.relatedDonorId));
  // SCALE-2: asked of the server as she types (lib/people.js), enough rows
  // that eight remain after this person and the people already linked.
  const [relPicked]=usePeoplePicker(relSearch,{match:"name",limit:9+linkedIds.size});
  const relPickerResults=relSearch.trim()
    ?relPicked.filter(d=>d.id!==donor.id&&!linkedIds.has(d.id)).slice(0,8)
    :[];

  const [cfData,setCfData]=useState([]);
  const [cfEditing,setCfEditing]=useState(null);
  const [cfEditVal,setCfEditVal]=useState("");
  const [cfSaved,setCfSaved]=useState(null);
  const [cfShowAll,setCfShowAll]=useState(false);
  const [cfError,setCfError]=useState("");
  useEffect(()=>{apiFetch(`/donors/${donor.id}/custom-fields`).then(rows=>setCfData(Array.isArray(rows)?rows:[])).catch(()=>{});},[donor.id]);
  // BUILD-78 5.2 — gift-entity fields surface on each gift row and edit
  // through the same seam as everything else.
  const [giftCfDefs,setGiftCfDefs]=useState([]);
  useEffect(()=>{apiFetch("/custom-fields?entity=gift").then(rows=>setGiftCfDefs(Array.isArray(rows)?rows:[])).catch(()=>{});},[]);
  const giftCfEditStr=(def,v)=>{
    if(v===null||v===undefined)return "";
    if(def.type==="money")return Number.isInteger(v)?(v/100).toFixed(2):String(v);
    if(def.type==="checkbox")return v===true?"yes":v===false?"no":String(v);
    if(def.type==="multi_select")return Array.isArray(v)?v.join("; "):String(v);
    return String(v);
  };
  const [donorEvents,setDonorEvents]=useState([]);
  useEffect(()=>{apiFetch(`/donors/${donor.id}/events`).then(rows=>setDonorEvents(Array.isArray(rows)?rows:[])).catch(()=>{});},[donor.id]);
  const [localScore,setLocalScore]=useState(donor.wealthScore??null);
  const [localTier,setLocalTier]=useState(donor.capacityTier??null);
  const [localConf,setLocalConf]=useState(donor.scoreConfidence??null);
  const [localRationale,setLocalRationale]=useState(donor.scoreRationale??null);
  const [scoreLoading,setScoreLoading]=useState(false);

  const wsc=localScore===null?T.ink3:localScore<=3?T.ink3:localScore<=5?T.green500:localScore<=7?T.greenMid:localScore<=9?T.greenDk:T.gold600;

  const recalcScore=async()=>{
    setScoreLoading(true);
    try{
      const r=await apiFetch(`/donors/${donor.id}/score`,{method:"POST"});
      setLocalScore(r.wealthScore);setLocalTier(r.capacityTier);
      setLocalConf(r.scoreConfidence);setLocalRationale(r.scoreRationale);
    }catch(e){console.error(e);}
    setScoreLoading(false);
  };

  const [showReassign,setShowReassign]=useState(false);
  const [reassignId,setReassignId]=useState(donor.assignedTo||"");
  const [reassignLoading,setReassignLoading]=useState(false);

  // A.4 — the draft is copied, never sent from here.
  const [draftCopied,setDraftCopied]=useState(false);
  const copyDraftEmail=async(text)=>{
    try{ await navigator.clipboard.writeText(String(text||"")); setDraftCopied(true); setTimeout(()=>setDraftCopied(false),2500); }
    catch(e){ rethrowProgrammerError(e); alert("Your browser would not let Steward reach the clipboard. Select the draft above and copy it."); }
  };
  useEffect(()=>{
    // A.4 — the Gmail probe went with the send panel it was for.
  },[]);

  const handleReassign=async()=>{
    const member=orgTeam.find(u=>u.id===reassignId);
    if(!member)return;
    setReassignLoading(true);
    try{
      const prevOwner=donor.assignedToName||"nobody";
      await apiFetch(`/donors/${donor.id}/assign`,{method:"PATCH",body:JSON.stringify({assignedTo:member.id,assignedToName:member.name})});
      await apiFetch(`/donors/${donor.id}/interactions`,{method:"POST",body:JSON.stringify({
        type:"other",note:`Reassigned from ${prevOwner} to ${member.name}`,
        date:orgTodayCivil()
      })});
      if(onReassign)onReassign(donor.id,member.id,member.name);
      setShowReassign(false);
    }catch(e){console.error(e);}
    setReassignLoading(false);
  };

  // BUILD-88a A.4 — `sendEmail` and `draftWithAI` lived here and are gone with
  // the panel they drove. The profile does not send. "Draft Email" (the AI
  // button above) still writes one, and A.4's rule is where it goes next: the
  // clipboard, then her own mail client, where she reads it as the donor will.
  const [showGiftModal,setShowGiftModal]=useState(false);
  const [seqOpen,setSeqOpen]=useState(false);
  const [seqId,setSeqId]=useState("");
  const [seqLoading,setSeqLoading]=useState(false);
  const [seqToast,setSeqToast]=useState("");

  // Tabs
  // FIX-11 Part 1 — "+ Log → Gift" lands HERE, on the gift form, with the date
  // the person chose. Opening on the Gifts tab with the panel already open is
  // what makes the hand-off one step rather than two.
  const [dpTab,setDpTab]=useState(initialAddGift?"giving":"activity");
  const [relatedOpen,setRelatedOpen]=useState(false);   // PROFILE-2: Related opens from the rail
  // POLISH-4 — More → Merge with…; the kept record opens when she closes it.
  const [mergeOpen,setMergeOpen]=useState(false);
  const mergeKeptRef=useRef(null);
  const [tlSearch,setTlSearch]=useState("");   // PROFILE-2: the tabs' search
  const [tlSearchOpen,setTlSearchOpen]=useState(false);
  const [whyStopOpen,setWhyStopOpen]=useState(false);
  const railRef=useRef(null);   // PROFILE-2 Part 1
  const [noteOpen,setNoteOpen]=useState(false);   // PROFILE-2: the header's Note
  const frameRef=useRef(null);   // PROFILE-3: the columns scroll on their own
  const isPhone=useIsPhone();   // PROFILE-2 Part 3
  useFrameHeight(frameRef,!isPhone);
  // The window is the profile's scroller now: a profile opened from far down the list starts at its top.
  useEffect(()=>{if(typeof window!=="undefined")window.scrollTo(0,0);},[donor.id]);
  const [dpMoreOpen,setDpMoreOpen]=useState(false); // BUILD-41: mobile overflow menu (Impact Summary / Edit)
  // PROFILE-2: More closes on a click outside it or Escape (it sits over the tabs now).
  useEffect(()=>{
    if(!dpMoreOpen)return undefined;
    const out=e=>{if(!(e.target.closest&&e.target.closest("[data-testid=dp-more-menu],[data-testid=dp-more]")))setDpMoreOpen(false);};
    const esc=e=>{if(e.key==="Escape")setDpMoreOpen(false);};
    document.addEventListener("mousedown",out);document.addEventListener("keydown",esc);
    return ()=>{document.removeEventListener("mousedown",out);document.removeEventListener("keydown",esc);};
  },[dpMoreOpen]);

  // PROFILE-3: the pledges, read by the timeline (tlCounts) and the Giving tab.
  const [pledges,setPledges]=useState([]);
  // Full gift data for Gifts & Pledges tab
  const [giftsFull,setGiftsFull]=useState([]);
  // POLISH-1 — a refund is a row with a negative amount, not a gift: it comes
  // off the total and never adds to the count, the same rule as the glance.
  const giftCountReal=giftsFull.filter(g=>g.amount>0).length;
  const refundRows=giftsFull.filter(g=>g.amount<0);
  // PROFILE-1 (header) — the timeline's rows, built once: the tab row's
  // counts and every list tab read this one list, with the tasks, files and
  // shifts read once beside it.
  const tlExtras=useTimelineExtras(donor.id, localInts??donor.interactions);
  const tlCounts=useMemo(()=>timelineCounts(buildTimelineItems({rel,gifts:giftsFull,pledges,interactions:localInts??donor.interactions??[],...tlExtras})),
    [rel,giftsFull,pledges,localInts,donor.interactions,tlExtras.tasks,tlExtras.attachments,tlExtras.service]);
  // PROFILE-1 (header) — the rail's facts in one read (GET /donors/:id/rail).
  // A card whose fact is missing is not drawn; a failed read draws one line.
  const [railData,setRailData]=useState(null);
  const [railErr,setRailErr]=useState(false);
  const loadRail=()=>apiFetch(`/donors/${donor.id}/rail`).then(r=>{setRailData(r||null);setRailErr(false);}).catch(()=>setRailErr(true));
  loadRailRef.current=loadRail;
  useEffect(()=>{setRailData(null);loadRail();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[donor.id,donor.interactions?.length||0]);
  const addrKey=[donor.address,donor.address2,donor.city,donor.state,donor.zip].map(x=>x||"").join("|"),addrSeen=useRef(addrKey);useEffect(()=>{if(addrSeen.current!==addrKey){addrSeen.current=addrKey;loadRail();}},[addrKey]);// eslint-disable-line react-hooks/exhaustive-deps -- ADDRESS-1: an address edit re-reads the rail (Contact), no refresh
  const [giftEditId,setGiftEditId]=useState(null);
  const [giftEditForm,setGiftEditForm]=useState({});
  const [addGiftForm,setAddGiftForm]=useState({amount:"",date:(initialAddGift&&initialAddGift.date)||orgTodayCivil(),type:"cash",payment_method:"",notes:"",fund_id:"",acknowledgement_sent:false,pledgeId:""});
  const [giftErr,setGiftErr]=useState("");
  const [giftMoreOpen,setGiftMoreOpen]=useState(false);
  // BUILD-45 §1.1 F-3 — idempotency key minted lazily per submit attempt and
  // cleared only on SUCCESS: a double-tap (or retry after a network error)
  // replays the same key and the server records exactly one gift.
  const addGiftIdemRef=useRef(null);
  const addPledgeIdemRef=useRef(null);   // BUILD-72 Part 2 — pledge double-tap guard
  const [addGiftOpen,setAddGiftOpen]=useState(!!initialAddGift);
  const [giftSaving,setGiftSaving]=useState(false);

  // Planned gifts
  const [plannedGifts,setPlannedGifts]=useState([]);
  const [pgForm,setPgForm]=useState({type:"bequest",estimated_value:"",date_indicated:"",notes:""});
  const [addPgOpen,setAddPgOpen]=useState(false);
  const [pgSaving,setPgSaving]=useState(false);

  // Pledges — a promise to give $X by a future date, distinct from both
  // gifts (money already received) and planned gifts (bequests/trusts, no
  // due date). Past-due unfulfilled pledges get reminders on the same
  // cadence as the recurring-gift dunning system (see processPledgeReminders
  // in server.js).
  // (PROFILE-3: pledges is declared above tlCounts, which puts them on the timeline)
  const [pledgeForm,setPledgeForm]=useState({amount:"",dueDate:orgTodayCivil(),notes:"",campaignId:""});
  const [addPledgeOpen,setAddPledgeOpen]=useState(false);
  const [pledgeSaving,setPledgeSaving]=useState(false);
  const [pledgeResendBusyId,setPledgeResendBusyId]=useState(null);
  const [pledgeResentIds,setPledgeResentIds]=useState(()=>new Set());

  // Fund affinity
  const [fundAffinity,setFundAffinity]=useState(null);
  const [fundLoading,setFundLoading]=useState(false);

  // Materials
  const [materials,setMaterials]=useState([]);
  const [matLoading,setMatLoading]=useState(false);
  const [matDragging,setMatDragging]=useState(false);
  const [matNote,setMatNote]=useState("");
  const [matUploading,setMatUploading]=useState(false);
  const fileInputRef=useRef(null);

  // Activity tab
  const [actFilter,setActFilter]=useState("all");
  const [actMode,setActMode]=useState("log");

  // Stewardship log form
  const [stwOpen,setStwOpen]=useState(false);
  const [stwForm,setStwForm]=useState({type:"thank_you",detail:"",date:orgTodayCivil(),note:""});
  const [stwSaving,setStwSaving]=useState(false);

  // Campaigns for gift attribution
  const [campaigns,setCampaigns]=useState([]);

  // BUILD-94 Part 1 — the signed URL for this record's photograph. The profile
  // signs its own rather than reading the org-wide map, so a record is never
  // the one whose face went missing because a list hit its cap.
  const [photoUrl,setPhotoUrl]=useState(donor.photoUrl||null);
  useEffect(()=>{setPhotoUrl(donor.photoUrl||null);},[donor.id,donor.photoUrl]);

  // Recurring gift recovery — health record (past_due/recovering/etc.), if any
  const [recurringSub,setRecurringSub]=useState(null);
  const [recurResendBusy,setRecurResendBusy]=useState(false);
  const [recurResendSent,setRecurResendSent]=useState(false);
  useEffect(()=>{
    apiFetch(`/donors/${donor.id}/recurring-subscription`).then(r=>setRecurringSub(r||null)).catch(()=>setRecurringSub(null));
  },[donor.id]);
  const resendRecurringLink=async()=>{
    setRecurResendBusy(true);
    try{
      await apiFetch(`/recurring/${donor.id}/resend`,{method:"POST"});
      setRecurResendSent(true);
    }catch(e){alert(errorMessage(e, "Could not resend the update link"));}
    setRecurResendBusy(false);
  };

  // Households / soft credit / designations (BUILD-14)
  const [household,setHousehold]=useState(null);
  const [softCredit,setSoftCredit]=useState(null);
  const [designations,setDesignations]=useState([]);
  const [hhModalOpen,setHhModalOpen]=useState(false);
  const [hhPick,setHhPick]=useState(new Set());
  const [hhSearch,setHhSearch]=useState("");
  // SCALE-2: the household picker's people from the server, name and email
  // run together as before; one extra row covers this person being in it.
  const [hhPeople]=usePeoplePicker(hhSearch,{match:"concat",limit:41,emptyToo:true,enabled:hhModalOpen});
  // SCALE-2: the gift form's people list follows whichever name field she
  // typed in last (soft credit, tribute or employer).
  const [giftPeopleQ,setGiftPeopleQ]=useState("");
  useEffect(()=>{setGiftPeopleQ(addGiftForm.scName||"");},[addGiftForm.scName]);
  useEffect(()=>{setGiftPeopleQ(addGiftForm.tribName||"");},[addGiftForm.tribName]);
  useEffect(()=>{setGiftPeopleQ(addGiftForm.matchEmployer||"");},[addGiftForm.matchEmployer]);
  const refreshSoftCredit=()=>apiFetch(`/donors/${donor.id}/soft-credit`).then(sc=>{
    setSoftCredit(sc);
    if(sc&&sc.householdId)apiFetch(`/households/${sc.householdId}`).then(setHousehold).catch(()=>setHousehold(null));
    else setHousehold(null);
  }).catch(()=>{setSoftCredit(null);setHousehold(null);});
  // Pipeline: moves history + ask/gift opportunities (BUILD-15, Team plan)
  const [moves,setMoves]=useState([]);
  const [opps,setOpps]=useState([]);
  const [askOpen,setAskOpen]=useState(false);
  const [askName,setAskName]=useState("");const [askAmt,setAskAmt]=useState("");
  // Smart-move suggestions (BUILD-22): surfaced, never auto-applied. `dismissed`
  // is per-session local; accept applies via the move route (logged on Team) or
  // the Core-safe stage PATCH.
  const [moveSuggestions,setMoveSuggestions]=useState([]);
  const [dismissedSug,setDismissedSug]=useState([]);
  const refreshPipeline=()=>{
    apiFetch(`/donors/${donor.id}/moves`).then(m=>setMoves(Array.isArray(m)?m:[])).catch(()=>setMoves([]));
    apiFetch(`/donors/${donor.id}/opportunities`).then(o=>setOpps(Array.isArray(o)?o:[])).catch(()=>setOpps([]));
    apiFetch(`/donors/${donor.id}/move-suggestions`).then(r=>setMoveSuggestions(r?.suggestions||[])).catch(()=>setMoveSuggestions([]));
  };
  const acceptSuggestion=async(sug)=>{
    setDismissedSug(s=>[...s,sug.signal]);
    if(!sug.toStage) return; // advisory-only signal (e.g. "going quiet")
    {
      // Logs a move (from original stage → toStage) with the signal as its
      // description.
      try{ await apiFetch(`/pipeline/${donor.id}/move`,{method:"POST",body:JSON.stringify({toStage:sug.toStage,description:`Accepted suggestion: ${sug.reason}`})}); }catch(_){}
    }
    onStageChange&&onStageChange(donor.id,sug.toStage); // parent UI + Core-safe stage PATCH
    refreshPipeline();
  };
  const dismissSuggestion=sug=>setDismissedSug(s=>[...s,sug.signal]);
  const addAsk=async()=>{
    const amt=parseFloat(askAmt);if(!(amt>0)){alert("Enter a positive target ask amount.");return;}
    try{await apiFetch(`/donors/${donor.id}/opportunities`,{method:"POST",body:JSON.stringify({name:askName.trim()||"Ask",targetAmount:amt})});
      setAskOpen(false);setAskName("");setAskAmt("");refreshPipeline();}catch(e){alert(errorMessage(e, "Could not add ask"));}
  };
  const closeAsk=async(o,status)=>{
    const body={status};
    if(status==="won"){const amt=prompt(`Actual gift amount closed (asked ${fmtFull(o.target_amount)}):`,o.target_amount);if(amt==null)return;body.giftAmount=parseFloat(amt)||0;}
    try{await apiFetch(`/opportunities/${o.id}`,{method:"PUT",body:JSON.stringify(body)});refreshPipeline();}catch(e){alert(errorMessage(e, "Could not update ask"));}
  };
  useEffect(()=>{
    refreshSoftCredit();refreshPipeline();
    apiFetch(`/donors/${donor.id}/designations`).then(d=>setDesignations(Array.isArray(d)?d:[])).catch(()=>setDesignations([]));
  },[donor.id]);
  // FIX-32: one plan, everything included. The major-gifts layer (moves and
  // asks, move stage, wealth score, suggested actions, sequences, reassign)
  // used to sit behind upgrade glass for a lower tier; there is no
  // Core any more, so it is always the real panel.
  const isTeam=true;
  const lockMajor=children=>children;
  // Add this donor to the working Pipeline board (deliberate act; idempotent).
  const [pipelineAdded,setPipelineAdded]=useState(false);
  const addToPipeline=async()=>{
    try{ await apiFetch("/pipeline/add",{method:"POST",body:JSON.stringify({ids:[donor.id]})}); setPipelineAdded(true); }
    catch(e){ alert(errorMessage(e, "Could not add to pipeline")); }
  };
  const hasDesignation=k=>designations.some(d=>d.kind===k);
  const toggleDesignation=async(kind)=>{
    try{
      if(hasDesignation(kind))await apiFetch(`/donors/${donor.id}/designations/${kind}`,{method:"DELETE"});
      else await apiFetch(`/donors/${donor.id}/designations`,{method:"POST",body:JSON.stringify({kind})});
      const d=await apiFetch(`/donors/${donor.id}/designations`);setDesignations(Array.isArray(d)?d:[]);
    }catch(e){alert(errorMessage(e, "Could not update designation"));}
  };
  const createHousehold=async()=>{
    const ids=[...hhPick];if(!ids.length)return;
    try{
      const hh=await apiFetch("/households",{method:"POST",body:JSON.stringify({memberIds:[donor.id,...ids],primaryDonorId:donor.id})});
      setHousehold(hh);setHhModalOpen(false);setHhPick(new Set());setHhSearch("");refreshSoftCredit();
    }catch(e){alert(errorMessage(e, "Could not create household"));}
  };
  const removeFromHousehold=async()=>{
    if(!household)return;
    const remaining=household.members.filter(m=>m.id!==donor.id).map(m=>m.id);
    try{
      let r=null;
      if(remaining.length<2)r=await apiFetch(`/households/${household.id}`,{method:"DELETE"});
      else await apiFetch(`/households/${household.id}`,{method:"PUT",body:JSON.stringify({memberIds:remaining})});
      setHousehold(null);refreshSoftCredit();
      if(r)offerUndo(r,"household",refreshSoftCredit);
    }catch(e){alert(errorMessage(e, "Could not update household"));}
  };

  // Tax receipts and the year-end statement: made, shown, then Download or Email (FLOWS-1, profile/ReceiptsAndStatements.jsx)
  const rc=useReceipts(donor,gifts);
  const {receiptsEnabled,receiptBusyId,receiptForGift,sendReceipt,downloadReceiptPdf,showYearEnd,setShowYearEnd,yearEndYear,setYearEndYear,yearEndBusy,yearEndErr,sendYearEndStatement}=rc;

  // FIX-11 Part 1 — "+ LOG → GIFT" WHEN THIS PROFILE IS ALREADY OPEN.
  //
  // The initial state below opens the gift form when the profile MOUNTS on the
  // hand-off. But the commonest route to "+ Log" is the profile's own button,
  // and the donor is then already selected: React keys this component by donor
  // id, so nothing remounts, the initialiser never runs again, and the button
  // did nothing at all. Found by the browser walk; no test of the modal in
  // isolation could have seen it.
  useEffect(()=>{
    if(!initialAddGift)return;
    setDpTab("giving");
    setAddGiftOpen(true);
    if(initialAddGift.date)setAddGiftForm(f=>({...f,date:initialAddGift.date}));
  },[initialAddGift]);

  const loadGiftsFull=()=>{
    const seq=++giftReadSeq.current;
    const id=donor.id;
    const attempt=n=>apiFetch(`/donors/${id}`).catch(e=>{
      if(n>=2||seq!==giftReadSeq.current)throw e;
      return new Promise(r=>setTimeout(r,600*(n+1))).then(()=>attempt(n+1));
    });
    attempt(0).then(raw=>{
      if(seq!==giftReadSeq.current)return;
      setGiftReadErr(false);
      const g=(raw.gifts||[]).map(g=>({
        id:g.id,amount:parseFloat(g.amount)||0,date:g.date||null,   // IMPORT-4: no date is "No date", never the day it was entered
        type:g.type||"cash",campaign:g.campaign||"",notes:g.notes||"",
        fund_id:g.fund_id||"",fund_name:g.fund_name||"",event_name:g.event_name||"",payment_method:g.payment_method||"",
        acknowledgement_sent:!!g.acknowledgement_sent,
        // FIX-49: the gift is the full amount paid; the processor's fee and the
        // net (what Finance reconciles to the bank) show beside it.
        fee:parseFloat(g.processor_fee_amount)||0,softCreditTo:Array.isArray(g.soft_credit_to)?g.soft_credit_to:[],   // LEDGER-1: "Soft credit to …"
      }));
      setGiftsFull(g);
      setGifts(g.map(x=>({amount:x.amount,date:x.date})));
      setGiftLoading(false);
      if(raw.figures)setFigs(raw.figures);
      // Capture full interactions from the profile fetch so the timeline works
      // without the list endpoint needing to embed them.
      if(raw.interactions) setLocalInts(raw.interactions.map(i=>({
        ...i, date:i.date||i.created_at?.split("T")[0], note:i.note||"",
      })));
    }).catch(()=>{ if(seq!==giftReadSeq.current)return; setGiftReadErr(true); setGiftLoading(false); });
  };

  // FIX-14 Part 1 — a touchpoint logged from the list's form lands on this
  // record as a new interaction; the rail, the rhythm and the header re-read
  // the one source then too, not only when the record is reopened.
  const touchSeen=useRef(null);
  const touchKey=`${donor.lastTouchpoint||""}|${(donor.interactions||[]).length}`;
  useEffect(()=>{
    if(touchSeen.current===null){touchSeen.current=touchKey;return;}
    if(touchSeen.current===touchKey)return;
    touchSeen.current=touchKey;loadRel();loadGiftsFull();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[touchKey]);

  const loadPlannedGifts=()=>{
    apiFetch(`/donors/${donor.id}/planned-gifts`).then(rows=>setPlannedGifts(Array.isArray(rows)?rows:[])).catch(()=>{});
  };

  const loadPledges=()=>{
    apiFetch(`/donors/${donor.id}/pledges`).then(rows=>setPledges(Array.isArray(rows)?rows:[])).catch(()=>{});
  };

  const loadMaterials=()=>{
    setMatLoading(true);
    apiFetch(`/donors/${donor.id}/materials`).then(rows=>setMaterials(Array.isArray(rows)?rows:[])).catch(()=>{}).finally(()=>setMatLoading(false));
  };

  const loadFundAffinity=()=>{
    setFundLoading(true);
    apiFetch(`/donors/${donor.id}/fund-affinity`).then(r=>setFundAffinity(r||null)).catch(()=>{}).finally(()=>setFundLoading(false));
  };

  // Optimistic delete: drop the entry locally right away; on failure, refetch
  // the profile (restores the row) and surface the error.
  const deleteInteraction=async(int)=>{
    const prev=localInts??donor.interactions??[];
    setLocalInts(prev.filter(x=>x.id!==int.id));
    try{
      const r=await apiFetch(`/interactions/${int.id}`,{method:"DELETE"});
      offerUndo(r,(int.type||"entry").replace(/_/g," "),()=>{loadGiftsFull();loadRel&&loadRel();});
    }catch(e){
      loadGiftsFull();
      alert("Could not delete this entry: "+(errorMessage(e, "unknown error")));
    }
  };
  // The card's menu: Edit (not for a gift's entry; a gift is changed on the
  // gift) and Delete, which asks once and then offers Undo.
  const intActions=int=>isReadOnly||!int||!int.id?null:(
    <span style={{display:"inline-flex",alignItems:"center",gap:6}}>
      <EditedMarker item={int}/>
      <ItemMenu label={(int.type||"entry").replace(/_/g," ")}
        onEdit={int.gift_id||int.type==="gift"?null:()=>setEditingInt(int)}
        onDelete={()=>deleteInteraction(int)}/>
    </span>
  );
  const onIntEdited=row=>{
    if(row&&row.id)setLocalInts(prev=>(prev??donor.interactions??[]).map(x=>x.id===row.id?{...x,...row}:x));
    setEditingInt(null);
    loadRel&&loadRel();
  };

  const saveStewardship=async()=>{
    if(!stwForm.type)return;
    setStwSaving(true);
    try{
      await apiFetch(`/donors/${donor.id}/interactions`,{method:"POST",body:JSON.stringify({
        type:"stewardship",
        note:`${stwForm.type.replace(/_/g," ")}${stwForm.detail?": "+stwForm.detail:""}${stwForm.note?"\n"+stwForm.note:""}`,
        date:stwForm.date,
        metadata:{stewardship_type:stwForm.type,detail:stwForm.detail},
      })});
      setStwOpen(false);
      setStwForm({type:"thank_you",detail:"",date:orgTodayCivil(),note:""});
      if(onInteractionAdded)onInteractionAdded();
    }catch(e){console.error(e);}
    setStwSaving(false);
  };

  const stage=STAGES.find(s=>s.id===(donor.stage||"cultivate"))||STAGES[2];
  const sc=donorScore(donor);const scoreColor=sc>70?T.greenDk:sc>45?T.gold600:T.terracotta;
  const urg=moveUrgency(donor);

  // ── THREAD-2b 5 · WHERE THEY ARE IN THEIR JOURNEY ──────────────────────
  // Direction A puts this in the RIGHT RAIL, with the rest of what is true
  // of the relationship; the main column stays about the person and their
  // money. The four figures, the ink rail itself and everything else about
  // the approved profile are untouched — this is one new section IN the rail,
  // which is exactly what the standing rule allows ("a redesign may move what
  // is IN the rail; it may not delete the rail").
  const [journey,setJourney]=useState(null);
  const [journeyBusy,setJourneyBusy]=useState(false);
  const [doneFor,setDoneFor]=useState(null);     // step id awaiting its one line
  const [doneNote,setDoneNote]=useState("");
  const [skipFor,setSkipFor]=useState(null);     // step id awaiting its why
  const [skipWhy,setSkipWhy]=useState("");
  // ── FIX-4 2 · NO HUNTING ──────────────────────────────────────────────
  // Whether somebody is in a journey was on this record already; getting
  // them INTO one was not, and the only door was Settings → Journeys →
  // Apply to everyone who qualifies, which is a different question entirely.
  // So: the journey they are in is a chip that opens it, and when they are
  // in none, the rail offers the list, shows the first step and its real
  // date, and asks once.
  const [journeyList,setJourneyList]=useState(null);   // the org's journeys
  const [addPick,setAddPick]=useState("");             // the one being considered
  const [addPreview,setAddPreview]=useState(null);     // its first step, for this person
  const [addErr,setAddErr]=useState("");
  // WHY-1 Part 7 — the suggested journey, the "..." menu, and the inline stop.
  const [journeySuggest,setJourneySuggest]=useState(null);
  const [journeyMenu,setJourneyMenu]=useState(false);
  const [stopAsk,setStopAsk]=useState(null);   // "stop" | "change" | null
  useEffect(()=>{
    let live=true;
    if(!donor?.id)return undefined;
    apiFetch(`/donors/${donor.id}/plan`).then(r=>{ if(live)setJourney(r.plan||null); }).catch(()=>{});
    return ()=>{live=false;};
  },[donor?.id]);
  // JOURNEYS-3 — every journey they are in, with the next step from each.
  // Re-read whenever the one in the card changes (a step done, a stop, an add).
  const [allJourneys,setAllJourneys]=useState([]);
  const [touchGap,setTouchGap]=useState(7);
  useEffect(()=>{
    let live=true;
    if(!donor?.id)return undefined;
    apiFetch(`/donors/${donor.id}/journeys`).then(r=>{ if(live){ setAllJourneys(r?.journeys||[]); setTouchGap(r?.touchGapDays||7); } }).catch(()=>{ if(live)setAllJourneys([]); });
    return ()=>{live=false;};
  },[donor?.id,journey]);
  // The list: a person can be in several journeys, so it is always offered.
  useEffect(()=>{
    let live=true;
    if(!donor?.id)return undefined;
    apiFetch("/journeys").then(d=>{ if(live)setJourneyList(d?.journeys||[]); }).catch(()=>{ if(live)setJourneyList([]); });
    const ex=journey&&journey.status==="done"?`?exclude=${encodeURIComponent(journey.templateId||"")}`:"";
    apiFetch(`/donors/${donor.id}/journey-suggestion${ex}`).then(d=>{ if(live)setJourneySuggest(d?.suggestion||null); }).catch(()=>{ if(live)setJourneySuggest(null); });
    return ()=>{live=false;};
  },[donor?.id,journey?.status]);   // eslint-disable-line react-hooks/exhaustive-deps
  // Picking one asks the server what it would actually do to THIS person on
  // THIS day. Never computed in the browser: the dates are the org's civil
  // dates and the browser does not know the org's timezone.
  async function pickJourney(id){
    setAddPick(id); setAddPreview(null); setAddErr("");
    if(!id)return;
    try{ setAddPreview(await apiFetch(`/donors/${donor.id}/journey-preview?journeyId=${encodeURIComponent(id)}`)); }
    catch(e){ setAddErr(errorMessage(e,"Steward could not work out what that journey would do.")); }
  }
  async function confirmAddToJourney(){
    if(!addPick||journeyBusy)return;
    setJourneyBusy(true); setAddErr("");
    try{
      await apiFetch(`/journeys/${addPick}/apply`,{method:"POST",body:JSON.stringify({donorIds:[donor.id]})});
      const r=await apiFetch(`/donors/${donor.id}/plan`);
      setJourney(r.plan||null); setAddPick(""); setAddPreview(null);
      if(onInteractionAdded)onInteractionAdded();
    }catch(e){ setAddErr(errorMessage(e,"Steward could not put them in that journey.")); }
    setJourneyBusy(false);
  }


  const interactionCount=donor.interactions?.length||0;
  useEffect(()=>{
    setGiftLoading(true);
    loadGiftsFull();
    loadPlannedGifts();
    loadPledges();
  },[donor.id,interactionCount]);

  useEffect(()=>{
    if(dpTab==="files")loadMaterials();
    if(dpTab==="giving"&&!fundAffinity)loadFundAffinity();
  },[dpTab,donor.id]);

  useEffect(()=>{
    // BUILD-32 — attribute gifts to goal'd fundraising campaigns (the ones with
    // thermometers), not pure email blasts, so a picked campaign actually moves
    // a goal. Falls back to the email-campaign list if fundraising has none yet.
    apiFetch("/fundraising/campaigns").then(r=>{
      const camps=Array.isArray(r)?r:[];
      if(camps.length)setCampaigns(camps);
      else apiFetch("/campaigns").then(r2=>setCampaigns(Array.isArray(r2)?r2:[])).catch(()=>{});
    }).catch(()=>apiFetch("/campaigns").then(r2=>setCampaigns(Array.isArray(r2)?r2:[])).catch(()=>{}));
  },[]);

  const saveGiftEdit=async(giftId)=>{
    // FIX-14 Part 2 — a receipt is a document the donor already holds. Editing
    // the amount does not change it, so the person editing is told first.
    const rcpt=receiptForGift(giftId);
    const was=giftsFull.find(g=>g.id===giftId);
    if(rcpt&&was&&giftEditForm.amount!==undefined&&Number(giftEditForm.amount)!==Number(was.amount)
      &&!(await askConfirm({title:"A receipt already went out",body:`A receipt already went out for this gift${rcpt.receipt_number?` (${rcpt.receipt_number})`:""}, for ${fmtFull(Number(rcpt.amount||was.amount))}. Changing the amount here does not change that receipt; void it and issue a new one from Tax receipts if it needs correcting. Save the new amount?`,yes:"Change the amount"})))return;
    setGiftSaving(true);
    try{
      const {customFields,...core}=giftEditForm;
      await apiFetch(`/gifts/${giftId}`,{method:"PUT",body:JSON.stringify(core)});
      if(customFields&&giftCfDefs.length){
        // through the ONE seam — a refused value names its reason
        await apiFetch(`/gifts/${giftId}/custom-fields`,{method:"PUT",body:JSON.stringify({values:customFields})});
      }
      told({donorId:donor.id,gift:true});loadPledges();   // LEDGER-1: header, rail, thank-you and pledges all re-read
      setGiftEditId(null);
    }catch(e){alert(e?.errors?.[0]?.error||errorMessage(e, "That value was refused"));}
    setGiftSaving(false);
  };

  const deleteGift=async(giftId)=>{
    if(!(await askConfirm({title:"Delete this gift?",body:"It comes off this person's giving and your totals now. A receipt already sent is not taken back.",yes:"Delete gift",danger:true})))return;
    try{
      await apiFetch(`/gifts/${giftId}`,{method:"DELETE"});
      told({donorId:donor.id,gift:true});loadPledges();   // LEDGER-1: the rail and its thank-you too
    }catch(e){console.error(e);}
  };

  // BUILD-98 Part 1 — a person named on the form is one of THIS org's
  // records, found by exact name. A name that is not on file is said out
  // loud rather than guessed at (an honouree is the exception: a memorial is
  // often for somebody who never gave, so their name alone is enough).
  // SCALE-2: asked of the server (exact name, both sides trimmed), not a whole-org list.
  const findByName=async nm=>{const n=String(nm||"").trim().toLowerCase();if(!n)return null;const hits=await peopleNamed(n,2,{trimStored:true});return hits.length===1?hits[0]:null;};
  const giftExtrasBody=async()=>{
    const f=addGiftForm,out={};
    if(f.scName){const p=await findByName(f.scName);if(!p)throw new Error(`${f.scName} is not in your records. Add them first, then credit them.`);
      out.softCredits=[{donorId:p.id,role:"recommender",...(f.scAmount?{amount:Number(f.scAmount)}:{})}];}
    if(f.tribType&&f.tribName){const h=await findByName(f.tribName);
      out.tribute={type:f.tribType,donorId:h?h.id:null,name:f.tribName,notifyName:f.tribNotify||null,notifyEmail:f.tribNotifyEmail||null};}
    if(f.matchEmployer){const e=await findByName(f.matchEmployer);if(!e)throw new Error(`${f.matchEmployer} is not in your records. Add the employer first.`);
      out.match={employerId:e.id,...(f.matchAmount?{amount:Number(f.matchAmount)}:{})};}
    return out;
  };
  const addGift=async()=>{
    if(!addGiftForm.amount||isNaN(Number(addGiftForm.amount)))return;
    let extras;
    try{extras=await giftExtrasBody();}catch(e){setGiftErr(e.message);return;}
    setGiftErr("");
    setGiftSaving(true);
    if(!addGiftIdemRef.current)addGiftIdemRef.current=crypto.randomUUID();
    try{
      await apiFetch(`/donors/${donor.id}/gifts`,{method:"POST",body:JSON.stringify({
        ...extras,
        amount:Number(addGiftForm.amount),date:addGiftForm.date,type:addGiftForm.type,
        campaignId:addGiftForm.campaign_id||undefined,notes:addGiftForm.notes,
        fund_id:addGiftForm.fund_id,payment_method:addGiftForm.payment_method,
        acknowledgement_sent:addGiftForm.acknowledgement_sent,
        pledgeId:addGiftForm.pledgeId||undefined,eventId:addGiftForm.eventId||undefined,
        idempotencyKey:addGiftIdemRef.current,
      })});
      addGiftIdemRef.current=null;
      setAddGiftOpen(false);
      // VOICE-4: every tile re-reads, not only the ones the gift read carries
      // (Average and Largest come from the status read, which waited on figs).
      told({donorId:donor.id,gift:true});
      setAddGiftForm({amount:"",date:orgTodayCivil(),type:"cash",payment_method:"",notes:"",fund_id:"",acknowledgement_sent:false,pledgeId:""});
      loadGiftsFull();refreshSoftCredit();
      if(addGiftForm.pledgeId)loadPledges();
    }catch(e){setGiftErr(errorMessage(e,"The gift could not be saved."));}
    setGiftSaving(false);
  };

  const addPledge=async()=>{
    if(!pledgeForm.amount||isNaN(Number(pledgeForm.amount))||!pledgeForm.dueDate)return;
    setPledgeSaving(true);
    // BUILD-72 Part 2 — one key per pledge, minted on first submit and cleared
    // only on success, so a double-tap replays it and the server returns the
    // original row. Mirrors addGift exactly.
    if(!addPledgeIdemRef.current)addPledgeIdemRef.current=crypto.randomUUID();
    try{
      await apiFetch(`/donors/${donor.id}/pledges`,{method:"POST",body:JSON.stringify({...pledgeForm,idempotencyKey:addPledgeIdemRef.current})});
      addPledgeIdemRef.current=null;
      setAddPledgeOpen(false);
      setPledgeForm({amount:"",dueDate:orgTodayCivil(),notes:"",campaignId:""});
      loadPledges();
    }catch(e){alert(errorMessage(e, "Could not save pledge"));}
    setPledgeSaving(false);
  };

  const setPledgeStatus=async(id,status)=>{
    try{
      await apiFetch(`/pledges/${id}`,{method:"PUT",body:JSON.stringify({status})});
      loadPledges();
    }catch(e){alert(errorMessage(e, "Could not update pledge"));}
  };

  const deletePledge=async(id)=>{
        try{
      const r=await apiFetch(`/pledges/${id}`,{method:"DELETE"});
      loadPledges();
      offerUndo(r,"pledge",loadPledges);
    }catch(e){alert(errorMessage(e,"The pledge could not be deleted."));}
  };
  // FIX-14 Part 3 — a pledge is edited in place: amount, due date, note.
  const [pledgeEdit,setPledgeEdit]=useState(null);
  const savePledgeEdit=async()=>{
    if(!pledgeEdit)return;
    try{
      await apiFetch(`/pledges/${pledgeEdit.id}`,{method:"PUT",body:JSON.stringify({amount:Number(pledgeEdit.amount),dueDate:pledgeEdit.dueDate,notes:pledgeEdit.notes})});
      if(pledgeEdit.sched)await savePledgeSchedule(pledgeEdit.id,pledgeEdit.sched);   // GIFTS-1: the schedule, its payments kept
      setPledgeEdit(null);loadPledges();
    }catch(e){alert(errorMessage(e,"The pledge could not be saved."));}
  };

  const resendPledgeReminder=async(id)=>{
    setPledgeResendBusyId(id);
    try{
      await apiFetch(`/pledges/${id}/resend`,{method:"POST"});
      setPledgeResentIds(prev=>new Set(prev).add(id));
    }catch(e){alert(errorMessage(e, "Could not resend the reminder"));}
    setPledgeResendBusyId(null);
  };

  const addPlannedGift=async()=>{
    if(!pgForm.type)return;
    setPgSaving(true);
    try{
      await apiFetch(`/donors/${donor.id}/planned-gifts`,{method:"POST",body:JSON.stringify(pgForm)});
      setAddPgOpen(false);
      setPgForm({type:"bequest",estimated_value:"",date_indicated:"",notes:""});
      loadPlannedGifts();
    }catch(e){console.error(e);}
    setPgSaving(false);
  };

  const deletePlannedGift=async(id)=>{
    try{
      const r=await apiFetch(`/planned-gifts/${id}`,{method:"DELETE"});
      loadPlannedGifts();
      offerUndo(r,"planned gift",loadPlannedGifts);
    }catch(e){console.error(e);}
  };

  const uploadMaterial=async(file)=>{
    setMatUploading(true);
    try{
      let file_data=null,file_url=null;
      // FLOWS-1: read as a data URL (spreading a file's bytes into one call overflowed past ~100 KB, and nothing saved)
      if(file.size<1024*1024)file_data=await new Promise((ok,no)=>{const r=new FileReader();r.onload=()=>ok(String(r.result||"").replace(/^data:[^,]*,/,""));r.onerror=()=>no(new Error("That file could not be read."));r.readAsDataURL(file);});
      await apiFetch(`/donors/${donor.id}/materials`,{method:"POST",body:JSON.stringify({
        file_name:file.name,file_type:file.type||"application/octet-stream",
        file_data,file_url,notes:matNote,
      })});
      setMatNote("");
      loadMaterials();
    }catch(e){window.alert(errorMessage(e,"That file did not save."));}
    setMatUploading(false);
  };

  const viewMaterial=(m)=>{
    if(m.file_data){
      const byteCharacters=atob(m.file_data);
      const byteNumbers=new Array(byteCharacters.length).fill(0).map((_,i)=>byteCharacters.charCodeAt(i));
      const byteArray=new Uint8Array(byteNumbers);
      const blob=new Blob([byteArray],{type:m.file_type||"application/octet-stream"});
      const url=URL.createObjectURL(blob);
      window.open(url,"_blank");
    }else if(m.file_url){
      window.open(m.file_url,"_blank");
    }
  };

  const deleteMaterial=async(id)=>{
    try{
      const r=await apiFetch(`/materials/${id}`,{method:"DELETE"});
      loadMaterials();
      offerUndo(r,"file",loadMaterials);
    }catch(e){console.error(e);}
  };

  const [impactPdfLoading,setImpactPdfLoading]=useState(false);
  // PARITY-1 Part F: record a video thank-you; saving drafts the email.
  const [videoThanksOpen,setVideoThanksOpen]=useState(false);
  const [volOpen,setVolOpen]=useState(false);   // PARITY-3 Part 1: Volunteering, under More
  // FIX-24 Part 1: "Make a volunteer" for somebody who is not one; once they
  // are, the same item reads "Volunteer record" and opens it.
  const [makeVolOpen,setMakeVolOpen]=useState(false);
  const [madeVol,setMadeVol]=useState(false);
  useEffect(()=>{setMadeVol(false);setMakeVolOpen(false);},[donor.id]);
  const isVolunteer=madeVol||(donor.personTypes||[]).includes("volunteer");
  // SHELVED — voice capture works but unproven adoption assumption, revisit
  // later. Code intact, re-enable by uncommenting.
  // const [showVoiceMemo,setShowVoiceMemo]=useState(false);
  // VOICE-1 — a memo filed from the sheet shows on this profile at once.
  // VOICE-4: and everything on it re-reads: the figures and gifts, Average
  // and Largest, the rail's step, the meeting card, the asks.
  useProfileRefresh(donor.id,e=>{   // COUNTS-1: and after any write to this person, its tasks, notes or files
    setToldNonce(n=>n+1); loadGiftsFull(); loadRel(); loadDpThread(); if(reloadProps&&!e.fromWrite)reloadProps();   // proposals reload through their own forms
    if(onInteractionAdded&&!e.fromWrite)onInteractionAdded();
  });
  // MEMBERS-2 — one click sends this person the link to their own page. The
  // email goes out through the normal path and the token never comes back to
  // this screen: a staff member who could read it could open the page.
  const [yourPageMsg,setYourPageMsg]=useState("");
  const sendYourPageLink=async()=>{
    setYourPageMsg("");
    try{
      const r=await apiFetch(`/donors/${donor.id}/your-page-link`,{method:"POST"});
      setYourPageMsg(r.message||"Sent.");
    }catch(e){setYourPageMsg(e?.data?.message||"That link could not be sent.");}
    setTimeout(()=>setYourPageMsg(""),9000);
  };

  const downloadImpactSummary=async()=>{
    setImpactPdfLoading(true);
    try{
      const resp=await fetch(`${API}/donors/${donor.id}/impact-summary/pdf`,{headers:{Authorization:`Bearer ${getToken()}`}});
      if(!resp.ok)throw new Error("Could not generate impact summary");
      const blob=await resp.blob();
      const url=URL.createObjectURL(blob);
      const a=document.createElement("a");
      a.href=url;a.download=`${donor.name}-impact-summary.pdf`;
      document.body.appendChild(a);a.click();
      document.body.removeChild(a);URL.revokeObjectURL(url);
    }catch(e){console.error(e);}
    setImpactPdfLoading(false);
  };

  const exportGiftsCSV=()=>{
    const rows=[["Date","Amount","Type","Payment Method","Fund","Ack Sent","Notes",...giftCfDefs.map(d=>d.label)],...giftsFull.map(g=>[g.date,g.amount,g.type,g.payment_method,g.fund_id,g.acknowledgement_sent?"Yes":"No",g.notes,...giftCfDefs.map(d=>renderCustomValue(d,(g.custom_fields||{})[d.key]))])];
    const csv=rows.map(r=>r.map(v=>`"${(v||"").toString().replace(/"/g,'""')}"`).join(",")).join("\n");
    const blob=new Blob([csv],{type:"text/csv"});
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a");a.href=url;a.download=`${donor.name}-gifts.csv`;a.click();
  };

  // HOTFIX-1 — the open threads, tasks and proposals this screen already
  // holds, shaped for shared/nextMove.js: a label and a date that is already
  // a person's date, most urgent first (the list arrives due-date ascending).
  // FIX-14 Part 3 — the next step's Edit (PUT /threads/:id) and Delete, which
  // moves it to deleted_records and offers the same Undo as a conversation.
  const saveStep=async()=>{
    if(!stepEdit)return;
    setStepBusy(true);
    try{
      await apiFetch(`/threads/${stepEdit.id}`,{method:"PUT",body:JSON.stringify({label:stepEdit.label.trim(),...(stepEdit.due?{due:stepEdit.due}:{})})});
      setStepEdit(null);loadDpThread();loadRel&&loadRel();
    }catch(e){alert(errorMessage(e,"The next step could not be saved."));}
    setStepBusy(false);
  };
  const deleteStep=async it=>{
    try{
      const r=await apiFetch(`/threads/${it.id}`,{method:"DELETE"});
      loadDpThread();loadRel&&loadRel();
      offerUndo(r,"next step",()=>{loadDpThread();loadRel&&loadRel();});
    }catch(e){alert(errorMessage(e,"The next step could not be deleted."));}
  };
  // FIX-14 Part 3 (from Part 5) — /donors/<id>#gift-<gid> scrolls to that gift
  // and marks it; a gift older than the timeline's first page opens Gifts.
  // SEARCH-2: the same for a pledge (#pledge-), a monthly plan (#plan-) and a
  // timeline entry (#item-: a note, an email, a logged meeting), and #gifts
  // opens the Gifts tab. Each names the tab its row lives on; the tab opens
  // first, then the row is found, scrolled to and marked.
  useEffect(()=>{
    const h=typeof window!=="undefined"?decodeURIComponent(window.location.hash.slice(1)):"";
    const m=h.match(/^(gift|pledge|plan|item)-(.+)$/);
    if(!m&&h!=="gifts")return undefined;
    // PROFILE-1 (header): a timeline entry lives on the tab of its kind.
    const itemType=m&&m[1]==="item"?String(((localInts??donor.interactions??[]).find(i=>i.id===m[2])||{}).type||""):"";
    const wantTab=m&&m[1]==="item"?(itemType==="note"?"notes":itemType==="email"?"emails":"conversations"):"giving";
    if(m&&m[1]==="gift"&&!giftsFull.length)return undefined;
    const el=m?document.getElementById(h):null;
    if(!el){
      if(dpTab!==wantTab&&(dpTab==="activity"||h==="gifts"))setDpTab(wantTab);
      return undefined;
    }
    if(el.dataset.marked)return undefined;
    el.dataset.marked="1";
    el.scrollIntoView({block:"center",behavior:"smooth"});
    el.style.outline="3px solid "+T.gold;el.style.outlineOffset="2px";
    const t=setTimeout(()=>{el.style.outline="";el.style.outlineOffset="";},4000);
    return ()=>clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[giftsFull,dpTab,rel,pledges,recurringSub,actMode,localInts]);
  const openForNextMove=useMemo(()=>{
    const today=new Date();
    const steps=dpItems.map(it=>({
      kind:it.kind,
      label:(it.nextStep&&it.nextStep.label)||"",
      dueLabel:it.nextStep&&it.nextStep.due?displayDateShort(it.nextStep.due,today):"",
      overdue:!!it.overdue,
    }));
    const props=openProposals.map(p=>({
      kind:"proposal",
      label:p.purpose||"",
      dueLabel:p.expectedClose?displayDateShort(p.expectedClose,today):"",
      overdue:false,
    }));
    return [...steps,...props].filter(x=>x.label);
  },[dpItems,openProposals]);

  useEffect(()=>{
    if(!dpItemsLoaded)return;
    if(aiMap[`${donor.id}_nextmove`]===undefined)getAI(donor,"nextmove",openForNextMove);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[donor.id,dpItemsLoaded]);

  // PROFILE-1 — a bar on "Giving by year" opens that year's gifts through
  // the SAME seam every other number on the product opens through: the
  // `gifts` source, filtered to this donor and that calendar year, so the
  // rows and the bar cannot drift apart and the drawer foots to the cent.
  const [yearDrill,setYearDrill]=useState(null);

  // PROFILE-1 — SNOOZE, as one verb on the row. It is the thread's own
  // "revisit" (the thread stays open and resurfaces on the date), moved
  // seven days out; the ⋯ menu still offers a date she picks and the other
  // two reasons, which CLOSE the thread. The date is civil and local, never
  // toISOString, which has already turned over after 8pm Eastern.
  const [snoozing,setSnoozing]=useState(null);
  const [snoozeErr,setSnoozeErr]=useState("");
  const snoozeThread=async it=>{
    if(snoozing)return;
    setSnoozing(it.id);setSnoozeErr("");
    const on=orgTodayPlus(7);   // FIX-14 Part 1 — the org's calendar, not the browser's
    try{
      await apiFetch(`/threads/${it.id}/dismiss`,{method:"POST",body:JSON.stringify({reason:"revisit",revisitOn:on})});
      loadDpThread();
    }catch(e){setSnoozeErr(errorMessage(e,"Could not snooze that step."));}
    setSnoozing(null);
  };

  // PROFILE-1 — the named human at an organisation, however the record spells
  // the field (the adaptDonor camel/snake trap).
  const contactPerson=donor.contactName||donor.contact_name||"";

  const sortedGifts=[...gifts].sort((a,b)=>new Date(b.date)-new Date(a.date));
  const lastGiftDisplay=giftLoading||giftReadErr?"…":sortedGifts.length>0?fmtFull(sortedGifts[0].amount):fmtFull(donor.lastAmount);

  // ── PROFILE-2 · THE HEADER'S NAME AND ITS TWO TAGS ─────────────────────
  // One tag set on the profile: donorStatus's (level, lifecycle, retained,
  // lapsing), each opening its people. The ladder's own rung chips are not
  // drawn here any more; they were a second opinion that read "Major, New"
  // beside "Major, Steady". The header shows two: a safety flag first when
  // there is one, then the level, then Lapsing, Monthly (a monthly plan that
  // is charging) or the lifecycle. Everything else is in About.
  const isOrgRec=["org","organization","organisation"].includes(donor.kind);
  const headName=displayName(donor.name,{isOrg:isOrgRec});
  // An organisation is called by its whole name ("Nothing is open for Darlie" was a foundation).
  const callName=isOrgRec?headName:(firstNameOf(donor.name)||donor.name);
  // PROFILE-3: a person with no gifts carries no giving tag (Donor, New, a level):
  // every donorStatus tag is about giving. NUMBERS-4's tag rule will say this on the server.
  const lifeFig=(figs||donor.figures||{}).lifetime;
  const noGifts=!giftLoading&&!giftReadErr&&gifts.length===0&&giftsFull.length===0&&!(lifeFig&&lifeFig.value);
  const stTags=noGifts?[]:((status&&status.tags)||[]);
  const headStatusEls=statusTagItems({tags:stTags.map(t=>t.kind==="level"?{...t,label:t.key==="mid"?"Mid-level donor":`${t.label} donor`}:t)});
  const tagEl=k=>{const i=stTags.findIndex(t=>t.key===k);return i>=0?headStatusEls[i]:null;};
  const levelKey=(stTags.find(t=>t.kind==="level")||{}).key;
  const lifeKey=(stTags.find(t=>t.kind==="lifecycle")||{}).key;
  const monthlyOn=!!(railData&&railData.recurring&&railData.recurring.interval==="month"&&railData.recurring.nextCharge);
  const flagEl=(donor.deceased||donor.doNotContact||donor.doNotSolicit)?<span data-testid="dp-head-flag" style={{display:"contents"}}><>{donor.deceased&&<span title="No mail of any kind is sent to this donor" style={{fontSize:10,fontWeight:800,padding:"3px 9px",borderRadius:99,background:T.terra100,color:T.terra700,border:`1px solid ${T.terra200}`}}>Deceased</span>}
                {!donor.deceased&&donor.doNotContact&&<span title="Excluded from campaigns, sequences, and workflow emails" style={{fontSize:10,fontWeight:800,padding:"3px 9px",borderRadius:99,background:T.gold100,color:T.gold700,border:`1px solid ${T.gold300}`}}>Do not contact</span>}
                {!donor.deceased&&!donor.doNotContact&&donor.doNotSolicit&&<span title="No asks. Excluded from the drift list, re-engage, suggested outreach and ask automations. Stewardship thank-yous continue." style={{fontSize:10,fontWeight:800,padding:"3px 9px",borderRadius:99,background:T.gold100,color:T.gold700,border:`1px solid ${T.gold300}`}}>Do not solicit</span>}</></span>:null;
  const secondKey=donor.deceased?null:stTags.some(t=>t.key==="lapsing")?"lapsing":monthlyOn?"monthly":lifeKey;   // PEOPLE-1: no Lapsing or Current for someone who has died
  const headTagList=[flagEl?{key:"flag",el:flagEl}:null,levelKey?{key:levelKey,el:tagEl(levelKey)}:null,
    secondKey==="monthly"?{key:"monthly",el:<span key="monthly" data-testid="dp-tag-monthly" style={{fontSize:10.5,fontWeight:700,padding:"3px 10px",borderRadius:99,background:T.white,color:T.greenDk,border:"1px solid "+T.green200,whiteSpace:"nowrap"}}>Monthly</span>}
      :secondKey?{key:secondKey,el:tagEl(secondKey)}:null].filter(x=>x&&x.el).slice(0,2);
  const headTags=headTagList.map(x=>x.el);
  const headTagKeys=new Set(headTagList.map(x=>x.key));
  // and never two that read against each other: Current beside Lapsing, or
  // Retained beside New, says the second one only.
  const hasTag=k=>stTags.some(t=>t.key===k);
  const aboutStatusTags={tags:stTags.filter(t=>!headTagKeys.has(t.key)&&!(donor.deceased&&["lapsed","lapsing","current","at_risk"].includes(t.key))&&!(t.key==="current"&&hasTag("lapsing"))&&!(t.key==="retained"&&hasTag("new")))};

  // ── PROFILE-2 Part 3 · three nodes that move on a phone: the next move and
  // the rail's Next step and Open pledge sit above the tabs at 390.
  const railNextNode=<div data-testid="dp-next" style={{display:"flex",flexDirection:"column",gap:10}}>
              <h4 style={RAIL_LABEL}>Next step</h4>
              {dpItems.length>0?(
                <div data-testid="dp-open-items" style={{background:T.white,border:"1px solid "+T.bg3,borderLeft:"4px solid "+(dpItems.some(x=>x.overdue)?T.gold500:T.greenDk),borderRadius:10,padding:"16px 18px",display:"flex",flexDirection:"column",gap:14}}>
                  {dpThread?.snoozedUntil&&<div style={{fontSize:11,color:T.ink3}}>Set aside until {displayDateShort(dpThread.snoozedUntil,new Date())}</div>}
                  {dpItems.map(it=>(
                    <div key={it.id} data-open-item={it.kind} style={{display:"flex",alignItems:"center",gap:16,flexWrap:"wrap"}}>
                      <div style={{flex:"1 1 240px",minWidth:0}}>
                        {(()=>{
                          // FIX-24 2c: with no proposal open, the step is to write it.
                          const ag=proposalsKnown?stepAgainstProposals(it.nextStep.label,openProposals.length):{label:it.nextStep.label,changed:false};
                          return <>
                            <div style={{fontSize:16,fontWeight:700,color:T.ink,marginBottom:4}}>{ag.label}</div>
                            {ag.changed&&<div data-testid="dp-step-agree" style={{fontSize:12.5,color:T.ink3,lineHeight:1.5,marginBottom:4}}>{ag.why}</div>}
                          </>;
                        })()}
                        {it.suggestedAsk&&<SuggestedAskLine ask={it.suggestedAsk} style={{marginBottom:4}}/>}
                        <div style={{fontSize:13,color:T.ink3,lineHeight:1.5}}>
                          {/* POLISH-2: lateness is said once. A late step reads "2 days
                              late", not that plus "day 4" plus "Overdue Oct 10". */}
                          {it.lastTouch?.line?<>&ldquo;{it.lastTouch.line}&rdquo;</>:it.lastTouch?.kind==="gift"&&it.lastTouch.amount!=null?<>{fmtFull(it.lastTouch.amount)} received</>:(it.overdue&&/^(Overdue |\d+ days? late)/i.test(it.rank?.why||"")?null:it.rank?.why||null)}
                          {it.lastTouch?.date&&it.kind!=="task"?<> · {displayDateShort(it.lastTouch.date,new Date())}</>:null}
                          {it.lastTouch?.actor?<> · {firstNameOf(it.lastTouch.actor)}</>:null}
                          {it.overdue?null:<>{" · "}{it.daysOpen>=1?`day ${it.daysOpen}`:"opened today"}</>}
                          {" "}
                          <span style={{fontWeight:700,color:it.overdue?T.gold700:T.greenDk}}>
                            {it.overdue?lateWords(it.nextStep.due):<>Due {displayDateShort(it.nextStep.due,new Date())}</>}
                          </span>
                        </div>
                        {/* FIX-33 · a booked meeting IS the next step, with its two moves;
                            its prep and after tasks open the brief and the note. */}
                        {(()=>{
                          const ev=it.calendarEventId;
                          if(!ev||isReadOnly)return null;
                          const fire=action=>window.dispatchEvent(new CustomEvent(MEETING_ACTION,{detail:{action,eventId:ev}}));
                          const findMeeting=()=>[...(rel?.upcoming||[]),...(rel?.past||[])].find(m=>m.id===ev);
                          const link={background:T.white,border:"1px solid "+T.ink,borderRadius:8,padding:"6px 12px",color:T.ink,fontSize:12.5,fontWeight:700,cursor:"pointer",fontFamily:"inherit"};
                          return <div data-testid="dp-meeting-step-actions" style={{display:"flex",gap:8,marginTop:8,flexWrap:"wrap"}}>
                            {it.nextStep.type==="meeting"&&<><button type="button" data-testid="dp-meeting-prep" onClick={()=>fire("prep")} style={link}>Prep</button>
                              <button type="button" data-testid="dp-meeting-reschedule" onClick={()=>fire("reschedule")} style={link}>Reschedule</button></>}
                            {it.nextStep.type==="meeting_prep"&&<button type="button" onClick={()=>fire("prep")} style={link}>Open the brief</button>}
                            {it.nextStep.type==="meeting_after"&&<button type="button" data-testid="dp-meeting-howdid" onClick={()=>{const m=findMeeting();if(m)setLogMeeting(m);}} style={link}>How did it go?</button>}
                          </div>;
                        })()}
                        {stepEdit&&stepEdit.id===it.id&&(
                          <div data-testid="dp-step-edit" style={{display:"flex",gap:6,flexWrap:"wrap",marginTop:8}}>
                            <input aria-label="Next step" value={stepEdit.label} onChange={e=>setStepEdit({...stepEdit,label:e.target.value})} style={{flex:"1 1 160px",border:"1px solid "+T.bg3,borderRadius:8,padding:"7px 9px",fontSize:13,fontFamily:"inherit"}}/>
                            <input aria-label="Due" type="date" value={stepEdit.due} onChange={e=>setStepEdit({...stepEdit,due:e.target.value})} style={{border:"1px solid "+T.bg3,borderRadius:8,padding:"6px 8px",fontSize:13,fontFamily:"inherit"}}/>
                            <button onClick={saveStep} disabled={stepBusy||!stepEdit.label.trim()} style={{background:T.greenDk,border:"none",borderRadius:8,padding:"7px 12px",color:T.white,fontSize:12.5,fontWeight:700,cursor:"pointer"}}>{stepBusy?"Saving…":"Save"}</button>
                            <button onClick={()=>setStepEdit(null)} style={{background:"none",border:"none",color:T.ink3,fontSize:12.5,cursor:"pointer"}}>Cancel</button>
                          </div>
                        )}
                      </div>
                      {it.kind!=="task"&&(
                        <div style={{display:"flex",gap:6,alignItems:"center",flexShrink:0}}>
                          {/* PROFILE-1 follow-up — an INK OUTLINE, not a second
                              emerald. The mockup drew this filled, and the
                              standing rule it did not account for is that
                              emerald is the ONE action colour and exactly one
                              control on a screen may mean "this is the
                              button" (BUILD-86 C.1). The header's Log a
                              conversation is that control. Caught by
                              tests/fix2-c-cream §2c, which had been skipping
                              in CI for want of a browser. */}
                          <button onClick={()=>setConvoOpen(true)} disabled={isReadOnly} data-testid="dp-mark-done"
                            style={{background:T.white,border:"1.5px solid "+T.ink,borderRadius:9,padding:"9px 14px",color:T.ink,fontSize:13,fontWeight:700,cursor:isReadOnly?"not-allowed":"pointer",opacity:isReadOnly?0.5:1}}>Mark done</button>
                          <button onClick={()=>snoozeThread(it)} disabled={isReadOnly||snoozing===it.id} data-testid="dp-snooze"
                            style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:9,padding:"9px 14px",color:T.ink,fontSize:13,fontWeight:700,cursor:isReadOnly?"not-allowed":"pointer",opacity:isReadOnly?0.5:1}}>{snoozing===it.id?"Snoozing…":"Snooze"}</button>
                          {/* BUILD-94 Part 5 — the same three outputs as the
                              Home row, from the same builder. */}
                          {it.kind==="thread"&&<PutItOnMyCalendar threadId={it.id} compact/>}
                          {/* FIX-14 Part 3 — the one next step is edited and deleted here.
                              POLISH-3 — in the "…" menu, with who edited it, not as a
                              row of underlined words beside the buttons. */}
                          <ThreadDismissMenu thread={it} onDone={loadDpThread}
                            extra={it.kind==="thread"&&!isReadOnly?[
                              {label:"Edit the step",testid:"dp-step-edit-btn",onClick:()=>setStepEdit({id:it.id,label:it.nextStep.label||"",due:String(it.nextStep.due||"").slice(0,10)})},
                              {label:"Delete the step",testid:"dp-step-delete",onClick:()=>deleteStep(it)},
                            ]:null}
                            footer={it.kind==="thread"&&it.edited_at?<EditedMarker item={it}/>:null}/>
                        </div>
                      )}
                    </div>
                  ))}
                  {snoozeErr&&<div style={{fontSize:12,color:T.terra700}}>{snoozeErr}</div>}
                </div>
              ):openProposals.length>0?(
                /* HOTFIX-1's RULE, AND THE REASON IT IS A RULE. A donor can
                   have no thread and no task and still have an ask in flight,
                   and the first draft of this very section answered "nothing
                   is open" on exactly that record — with the proposal sitting
                   four inches below it. An open proposal IS the next step, so
                   it is named here, with what it asks for and when an answer
                   is expected. (tests/profile1-screen §6 is the guard.) */
                <div data-testid="dp-open-items" data-open-item="proposal" style={{background:T.white,border:"1px solid "+T.bg3,borderLeft:"4px solid "+T.greenDk,borderRadius:10,padding:"16px 18px",display:"flex",gap:16,alignItems:"center",flexWrap:"wrap"}}>
                  <div style={{flex:"1 1 240px",minWidth:0}}>
                    <div style={{fontSize:16,fontWeight:700,color:T.ink,marginBottom:4}}>{openProposals[0].purpose||"An open ask"}</div>
                    <div style={{fontSize:13,color:T.ink3,lineHeight:1.5}}>
                      {openProposals[0].askAmount!=null?<>{fmtFull(openProposals[0].askAmount)} · </>:null}
                      {PROPOSAL_STAGE_LABEL[openProposals[0].stage]||openProposals[0].stage}
                      {openProposals[0].expectedClose?<> · <span style={{fontWeight:700,color:T.greenDk}}>An answer is expected {displayDateShort(openProposals[0].expectedClose,new Date())}</span></>:null}
                      {openProposals.length>1?<> · and {openProposals.length-1} more open {openProposals.length-1===1?"ask":"asks"}</>:null}
                    </div>
                  </div>
                </div>
              ):(
                <div data-testid="dp-next-empty" style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:10,padding:"16px 18px",display:"flex",gap:14,alignItems:"center",flexWrap:"wrap"}}>
                  <div style={{flex:"1 1 240px",fontSize:13.5,color:T.ink3,lineHeight:1.6}}>
                    {/* FIX-57: a sentence that needs a name waits for it ("Nothing is open for ." while the record loaded) */}
                    {String(donor.name||"").trim()?<>Nothing is open for {callName}.</>
                      :<span data-testid="dp-name-wait" aria-label="Loading" style={{display:"inline-block",width:"min(320px,80%)",height:12,borderRadius:6,background:T.bg2,verticalAlign:"middle"}}/>}
                  </div>
                  {!isReadOnly&&<button type="button" data-testid="dp-next-plan" onClick={()=>setPlanOpen(true)} style={{background:T.greenDk,color:T.white,border:"none",borderRadius:9,padding:"9px 14px",fontSize:13,fontWeight:700,cursor:"pointer",minHeight:40}}>Plan a follow-up</button>}
                </div>
              )}
            </div>;
  const railPledgeNode=pledges.some(p=>p.status==="open"&&Number(p.balance)>0)?<RailSection title="Open pledge" testid="dp-rail-pledge"><div style={{margin:"-2px -4px"}}>
          <OpenPledgeBanner pledges={pledges} donorName={donor.name} donorId={donor.id} isReadOnly={isReadOnly}
            onRecordPayment={(pl,next)=>{setDpTab("giving");setAddGiftOpen(true);
              // PROFILE-3: "gifts" stopped being a tab in PROFILE-2, so this blanked the main column. Giving, with the form in view.
              setTimeout(()=>{const f=document.querySelector("[data-testid=dp-add-gift-form]");if(f&&f.scrollIntoView)f.scrollIntoView({block:"center"});},150);setAddGiftForm(f=>({...f,pledgeId:pl.id,amount:String(next?next.amount:pl.balance)}));}}/>
        </div></RailSection>:null;
  // PROFILE-3 · NOTHING LOGGED YET: no gift, pledge, conversation, email, note,
  // task, file or meeting. The main column is one quiet start card, and the
  // "Nothing due" line and the empty timeline are not drawn.
  const nothingLogged=!!rel&&!giftLoading&&!giftReadErr&&gifts.length===0&&giftsFull.length===0&&pledges.length===0
    &&Object.values(tlCounts).every(n=>!n)&&!(tasks||[]).length&&!(rel.upcoming||[]).length&&!rel.nextMeeting;
  const nextMoveNode=<div className="dp2-nextmove"><ProfileNextMove donorId={donor.id} firstName={callName} isReadOnly={isReadOnly||!isTeam} quietNone={nothingLogged}
              aiOn={!!(org&&org.capabilities&&org.capabilities.ai)&&isTeam} onDraft={()=>{setSuggestOpen(true);getAI(donor,"nextmove",openForNextMove);}}/></div>;

  return(
    <div className="fade-in page-takeover dp3-frame" data-testid="donor-profile" ref={frameRef} style={{position:"relative",background:T.bg,display:"flex",flexDirection:"column"}}>
      {/* PROFILE-2 Part 1: the profile is the page, not a fixed panel over it.
          HOTFIX-1 made it position:fixed with overflow:hidden, and once
          INSIGHTS-1 and IMPORT-5 grew the header to 540px nothing over it
          scrolled at all; the window scrolls now, and only the rail sticks. */}
      {showGiftModal&&<GiftLinkModal donor={donor} orgName={orgName} onClose={()=>setShowGiftModal(false)}/>}
      {/* SHELVED — voice capture works but unproven adoption assumption, revisit later.
          Code intact, re-enable by uncommenting.
      {showVoiceMemo&&<VoiceMemoModal donor={donor} onClose={()=>setShowVoiceMemo(false)} onSaved={()=>{setShowVoiceMemo(false);if(onInteractionAdded)onInteractionAdded();}}/>}
      */}
      <div className="donor-profile-body dp2-body" data-rail-ground={RAIL.bg} style={{flex:1,display:"grid",gridTemplateColumns:"minmax(0,1fr) var(--rail-w,360px)",backgroundImage:`linear-gradient(to right, ${T.bg} calc(100% - var(--rail-w,360px)), ${RAIL.bg} calc(100% - var(--rail-w,360px)))`}}>
        {/* LEFT — the main column. HOTFIX-1: its ground is named here rather
            than inherited, because the rail beside it is defined as being on a
            CONTRASTING ground and a contrast between two inherited values is
            not a contrast anybody can check. See docs/decisions/design-system.md. */}
        <div data-testid="dp-main-column" className="dp3-main" tabIndex={isPhone?undefined:0} aria-label={isPhone?undefined:"Record"} style={{background:T.bg,minWidth:0,display:"flex",flexDirection:"column"}}>
          {/* PROFILE-2 · THE WHITE BAND: the header, the four numbers, then the tabs
              as its bottom edge. It sits in the main column, so the rail beside it
              runs from the top of the profile. */}
          {/* PROFILE-3 · THE PIN: the header band, the numbers and the tabs stay at the
              top of the main column while the timeline scrolls under them. */}
          <div className="dp3-pin" data-testid="dp-pin" style={{position:"sticky",top:0,zIndex:6,background:T.white,borderBottom:"1px solid "+T.bg3}}>
          <div data-testid="dp-band" className="dp3-band" style={{background:T.white,padding:"0 var(--dp-gutter,40px)"}}>
      {/* POLISH-1 — ONE HEADER, PHOTO OR NOT. Back is its own small line;
            below it the mark (photo or initials, one size) sits top-aligned with
            the name, and everything about the person is one column beside it.
            Centred rows let the mark and Back float to the middle of a column
            whose height changed with the person, so a photo moved the name. */}
        {/* PROFILE-2 · THE HEADER, TWO ROWS. Row one: the face (72px), the name in
            the display serif, and the actions on the right (Log a call is the one
            emerald). Row two: the top tag under the face and the second under the
            name: at most two tags here, the rest are in About on the rail. The
            roles line, closeness, drift and recurring sentences moved to the rail
            (About and Engagement), so the header is the person and what to do. */}
        <ProfileHeader {...{onRecordChanged,setMergeOpen,setRelatedOpen,setRelPickerOpen,aiErr,aiMap,briefOpen,canMajorGifts,convoOpen,copyDraftEmail,donor,downloadImpactSummary,dpMoreOpen,dpThread,draftCopied,editingInt,exportPersonData,filingLookupOpen,getAI,headName,headTags,impactPdfLoading,isAdmin,isReadOnly,isTeam,isVolunteer,loadDpThread,loadGiftsFull,loadRel,loadingKey,lockMajor,makeVolOpen,noteOpen,onAddTask,onClose,onDelete,onEdit,onIntEdited,onInteractionAdded,onNavigate,openForNextMove,org,photoUrl,planOpen,prospectBriefOpen,sendYourPageLink,setBriefOpen,setConvoOpen,setDpMoreOpen,setDpTab,setEditingInt,setEraseMsg,setEraseOpen,setEraseWord,setFilingLookupOpen,setLocalInts,setMadeVol,setMakeVolOpen,setNoteOpen,setPhotoUrl,setPlanOpen,setProspectBriefOpen,setPublicFiling,setShowGiftModal,setSuggestOpen,setVideoThanksOpen,setVolOpen,setWhyStopOpen,suggestOpen,videoThanksOpen,volOpen,whyStopOpen,yourPageMsg}}/>
        {(figs||donor.figures)&&<ProfileNumbers figures={figs||donor.figures}/>}
          </div>
          {/* ── PROFILE-1 (header) · ONE ROW OF TABS ──────────────────────
              Directly under the header, left-aligned. It replaces the old six
              tabs and the "Everything with" chips; it scrolls sideways at 390
              (and only it does). Each count is the length of the list it
              opens. */}
          {isPhone&&<div className="dp2-phone-top" data-testid="dp-phone-top" style={{display:"flex",flexDirection:"column",gap:14,padding:"16px 16px 18px",background:T.bg}}>
            {nextMoveNode}
            <div style={{background:RAIL.bg,color:RAIL.text,borderRadius:14,padding:"16px 16px 4px"}}>{railNextNode}{railPledgeNode}</div>
          </div>}
          <div className="dp-tabs-row" style={{display:"flex",alignItems:"stretch",background:T.white,padding:"0 var(--dp-gutter,40px)"}}>
          <div className="dp-tabs" role="tablist" aria-label="Profile" data-testid="dp-tabs" style={{display:"flex",flexWrap:"nowrap",overflowX:"auto",flex:1,minWidth:0,scrollbarWidth:"none",gap:24}}>
            {PROFILE_TABS.map(([id,label])=>{
              // PROFILE-2: Giving counts gifts AND pledges (a $50,000 pledge read "Gifts & pledges 0").
              const n=id==="giving"?(giftLoading||giftReadErr?null:giftCountReal+pledges.length)
                :id==="conversations"?(tlCounts.conversation||0):id==="emails"?(tlCounts.email||0):id==="tasks"?(tlCounts.task||0)
                :id==="notes"?(tlCounts.note||0):id==="files"?(tlCounts.file||0):null;
              return <button key={id} role="tab" data-tab={id} aria-selected={dpTab===id} onClick={()=>setDpTab(id)} style={{background:"none",border:"none",borderBottom:"2px solid "+(dpTab===id?T.greenDk:"transparent"),padding:"12px 0 10px",color:dpTab===id?T.ink:T.ink3,fontSize:13.5,fontWeight:dpTab===id?700:500,cursor:"pointer",whiteSpace:"nowrap",flexShrink:0,fontFamily:"inherit",minHeight:44,display:"inline-flex",alignItems:"center"}}>
                {label}
                {/* PROFILE-3: a count only when there is something to count; never "0". */}
                {n>0&&<span data-tab-count={id} style={{marginLeft:6,background:T.bg2,borderRadius:99,padding:"1px 7px",fontSize:10.5,fontWeight:700,color:T.ink3}}>{n}</span>}
              </button>;
            })}
          </div>
          {/* PROFILE-2: search the timeline, live. */}
          <div style={{display:"flex",alignItems:"center",gap:6,flexShrink:0,paddingLeft:8}}>
            {tlSearchOpen&&<input autoFocus value={tlSearch} onChange={e=>{setTlSearch(e.target.value);if(!TAB_KIND[dpTab]&&dpTab!=="activity")setDpTab("activity");}} placeholder="Search this record" aria-label="Search this record" data-testid="dp-tl-search"
              onKeyDown={e=>{if(e.key==="Escape"){setTlSearch("");setTlSearchOpen(false);}}} style={{width:180,padding:"7px 10px",fontSize:13,borderRadius:8}}/>}
            <button type="button" data-testid="dp-tl-search-btn" aria-label={tlSearchOpen?"Close search":"Search this record"} onClick={()=>{if(tlSearchOpen){setTlSearch("");setTlSearchOpen(false);}else setTlSearchOpen(true);}}
              style={{background:"none",border:"none",cursor:"pointer",padding:8,minWidth:40,minHeight:40,color:T.ink3,fontSize:17,lineHeight:1}}>{tlSearchOpen?"×":<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>}</button>
          </div>
          </div>
          </div>{/* /dp3-pin */}

          {/* ── OVERVIEW (PROFILE-1 header) ──────────────────────────────
              Top to bottom: the next meeting, How did it go?, Lately, the ask,
              Highlights, then About. Everything else that lived here has a
              tab of its own now (docs/profile-1/inventory.md says where). */}
          {/* ── PROFILE-2 · ACTIVITY: the next move, Coming up, then everything
              that happened, by month. The other tabs filter the same timeline. */}
          {dpTab==="activity"&&<div className="dp2-cream" data-testid="dp-tab-activity" style={{padding:"24px var(--dp-gutter,40px) 40px",display:"flex",flexDirection:"column",gap:16}}>
            {nothingLogged&&<StartCard name={callName} isReadOnly={isReadOnly} onCall={()=>setConvoOpen(true)} onNote={()=>setNoteOpen(true)} onGift={()=>{setDpTab("giving");setAddGiftOpen(true);}}/>}
            {!isPhone&&nextMoveNode}
            <ComingUpMain tasks={tasks} meetings={(rel&&rel.upcoming)||[]} onTaskToggle={onTaskToggle} isReadOnly={isReadOnly} onAddTask={onAddTask}/>
            {rel?.nextMeeting&&<MeetingCard meeting={rel.nextMeeting} donor={donor} before={before&&before.meeting.id===rel.nextMeeting.id?before:null} onReload={()=>{loadRel();loadDpThread();}}/>}
            {/* VOICE-3 · a meeting logged ahead by hand has no calendar card, so the brief stands alone. */}
            {before&&!(rel?.nextMeeting&&before.meeting.id===rel.nextMeeting.id)&&<BeforeYourMeeting data={before}/>}
            {/* FIX-33 · once the meeting time has passed, the profile asks. */}
            {(()=>{
              const due=(rel?.past||[]).find(m=>!m.loggedAt&&m.startsAt&&Date.now()-new Date(m.endsAt||m.startsAt).getTime()<7*864e5);
              if(!due||isReadOnly)return null;
              return <section data-testid="dp-how-did-it-go" style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:12,padding:"14px 18px",display:"flex",gap:12,alignItems:"center",flexWrap:"wrap",justifyContent:"space-between"}}>
                <div style={{fontSize:14,fontWeight:700,color:T.ink}}>How did it go? {due.title}, {displayDateShort(String(due.date||due.startsAt).slice(0,10),new Date())}</div>
                <button type="button" onClick={()=>setLogMeeting(due)} style={{background:T.white,border:"1.5px solid "+T.ink,borderRadius:9,padding:"8px 14px",color:T.ink,fontSize:13,fontWeight:700,cursor:"pointer"}}>Write it down</button>
              </section>;
            })()}
            {/* FIX-14 Part 1 — what Steward heard in the newest conversation
                logged by hand: a next step with its date, the spouse named,
                a planned gift mentioned. Each is a chip; nothing changes until
                a person presses one. */}
            {(()=>{
              const ints=localInts??donor.interactions??[];
              const handLogged=ints.filter(i=>{
                if(!["meeting","call","note","ask","email"].includes(i.type)||!String(i.note||"").trim())return false;
                let m={};try{m=typeof i.metadata==="string"?JSON.parse(i.metadata||"{}"):(i.metadata||{});}catch{}
                if(m.provider||m.message_id||m.gmail_message_id||m.calendar_event_id||m.via==="inbound_email")return false;
                const ago=civilDaysAgo(String(i.date||"").slice(0,10));
                return ago!=null&&ago<=30&&ago>=-90;
              }).sort((a,b)=>String(b.date).localeCompare(String(a.date))||String(b.created_at||"").localeCompare(String(a.created_at||"")));
              const last=handLogged[0];
              if(!last||!last.id||isReadOnly)return null;
              return <section data-testid="dp-heard" style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:12,padding:"14px 18px",display:"flex",flexDirection:"column",gap:6}}>
                <div style={{fontSize:13,fontWeight:700,color:T.ink}}>From your note: {conversationTitle(last)}, {displayDateShort(last.date,orgTodayCivil())}</div>
                <ConversationChips interactionId={last.id} onChanged={()=>{loadRel();loadGiftsFull();loadDpThread();refreshSoftCredit();
                  apiFetch(`/donors/${donor.id}/designations`).then(d=>setDesignations(Array.isArray(d)?d:[])).catch(()=>{});
                  onInteractionAdded&&onInteractionAdded();}}/>
              </section>;
            })()}
            {/* LATELY — the last three things that happened, of any kind, each
                opening its record; "See everything" opens Conversations. */}
            {/* AGENT-5: what Atlas did for this person, in order, with Undo. */}
            <AtlasNote place="person" id={donor.id} onNavigate={onNavigate}/>
            {rel&&!nothingLogged&&<ProfileTimeline byMonth noChips search={tlSearch} heading="Everything, by month" extras={tlExtras} canWrite={!isReadOnly} inboxConnected={inboxConnected} rel={rel} donor={donor} gifts={giftsFull} pledges={pledges} interactions={localInts??donor.interactions??[]} onLog={m=>setLogMeeting(m)} renderActions={intActions} onChanged={()=>{loadRel();loadGiftsFull();loadDpThread();onInteractionAdded&&onInteractionAdded();}}/>}
            {logMeeting&&<Modal onClose={()=>setLogMeeting(null)} width={560} title="">
              <AfterMeetingForm meeting={{...logMeeting,people:[{id:donor.id,name:donor.name}]}} onDone={()=>{setLogMeeting(null);loadRel();loadGiftsFull();loadDpThread();onInteractionAdded&&onInteractionAdded();}}/>
            </Modal>}
          </div>}

          <GivingTab {...{rc,acceptSuggestion,addAsk,addGift,addGiftForm,addGiftOpen,addPgOpen,addPlannedGift,addPledge,addPledgeOpen,addToPipeline,askAmt,askName,askOpen,campaigns,closeAsk,deleteGift,deletePlannedGift,deletePledge,dismissSuggestion,dismissedSug,donor,downloadReceiptPdf,dpItems,dpTab,exportGiftsCSV,figs,fundAffinity,fundLoading,giftCfDefs,giftCfEditStr,giftCountReal,giftEditForm,giftEditId,giftErr,giftLoading,giftMoreOpen,giftPeopleQ,giftReadErr,giftSaving,gifts,giftsFull,hasDesignation,household,isAdmin,isReadOnly,isTeam,loadGiftsFull,lockMajor,moveSuggestions,moves,onNavigate,onStageChange,openProposals,opps,pgForm,pgOpen,pgSaving,pipelineAdded,plannedGifts,pledgeEdit,pledgeForm,pledgeResendBusyId,pledgeResentIds,pledgeSaving,pledges,propData,proposalsKnown,receiptBusyId,receiptForGift,receiptsEnabled,recurResendBusy,recurResendSent,recurringSub,refundRows,reloadProps,resendPledgeReminder,resendRecurringLink,saveGiftEdit,savePledgeEdit,sc,scores,sendReceipt,sendYearEndStatement,seqId,seqLoading,seqOpen,seqToast,sequences,setAddGiftForm,setAddGiftOpen,setAddPgOpen,setAddPledgeOpen,setAskAmt,setAskName,setAskOpen,setDpTab,setGiftEditForm,setGiftEditId,setGiftLoading,setGiftMoreOpen,setHhModalOpen,setPgForm,setPgOpen,setPledgeEdit,setPledgeForm,setPledgeStatus,setRelatedOpen,setSeqId,setSeqLoading,setSeqOpen,setSeqToast,setShowYearEnd,setYearDrill,setYearEndYear,showYearEnd,softCredit,status,toggleDesignation,yearDrill,yearEndBusy,yearEndErr,yearEndYear}}/>

          {mergeOpen&&<MergeWithModal donor={donor} onMerged={id=>{mergeKeptRef.current=id;}}
            onClose={()=>{setMergeOpen(false);const k=mergeKeptRef.current;mergeKeptRef.current=null;if(k&&onSelectRelatedDonor)onSelectRelatedDonor(k);}}/>}
          <RelatedModal {...{donor,household,isReadOnly,linkDonor,onSelectRelatedDonor,refreshSoftCredit,relErr,relLoading,relPickerOpen,relPickerResults,relSaving,relSearch,relType,relatedOpen,relationships,removeFromHousehold,retypeRelationship,setHhModalOpen,setRelErr,setRelPickerOpen,setRelSearch,setRelType,setRelatedOpen,softCredit,unlinkDonor}}/>

          <ListTabs {...{deleteMaterial,donor,dpTab,giftsFull,inboxConnected,intActions,isReadOnly,loadDpThread,loadGiftsFull,loadRel,localInts,matLoading,matUploading,materials,onInteractionAdded,onLogTouchpoint,onNavigate,rel,saveStewardship,setLogMeeting,setStwForm,setStwOpen,stwForm,stwOpen,stwSaving,tlExtras,tlSearch,uploadMaterial,viewMaterial}}/>
          <ProfileDialogs {...{createHousehold,donor,eraseBusy,eraseMsg,eraseOpen,erasePerson,eraseWord,hhModalOpen,hhPeople,hhPick,hhSearch,isAdmin,setEraseOpen,setEraseWord,setHhModalOpen,setHhPick,setHhSearch}}/>
        </div>

        {/* ── THE RAIL (PROFILE-1) ────────────────────────────────────────
            Ink, with light text, framing the cream main column the way the
            sidebar frames it on the left. The rail is never removed and its
            ground always contrasts with the column (CLAUDE.md's never-crossed
            list, pinned by tests/hotfix1-profile.test.js at 1440).

            What lives here is what is true of the person all the time — who
            owns them, where they are, how to reach them, and the tools —
            which is why it can sit outside whichever tab is open. Emerald is
            still the one action colour (the active stage); brass is still
            emphasis (the quick actions). Nothing new enters the palette: the
            rail's greys are cream at reduced opacity (T.sage400/600), which
            is the design system's own answer for secondary text on ink. */}
        <div data-testid="dp-right-rail" ref={railRef} className="dp-rail-sticky dp3-rail" tabIndex={isPhone?undefined:0} aria-label={isPhone?undefined:"About this person"} style={{minHeight:"calc(100vh - 52px)",boxSizing:"border-box",padding:"24px 22px 48px",display:"flex",flexDirection:"column",background:RAIL.bg,color:RAIL.text,borderLeft:"1px solid "+RAIL.bg}}>
          {/* INT-BUILD-1 Part 3, FIX-14 Part 3 — the ONE next step (with Edit and
              Delete), then Rhythm: past touches and planned steps on one strip,
              and the journey chosen or changed in the same panel. */}
          {(()=>{
            // WHY-1 Part 7 — JOURNEY, NOT RHYTHM. The twelve-month touch
            // strip is gone from the profile (the timeline is where touch
            // history lives); this panel is the plan for the next touches.
            const rhythmNode=<div data-testid="dp-rail-journey-panel" style={{display:"flex",flexDirection:"column",gap:12}}>
              <RailJourneys {...{addErr,addPick,addPreview,allJourneys,confirmAddToJourney,doneFor,doneNote,donor,isReadOnly,journey,journeyBusy,journeyList,journeyMenu,journeySuggest,onInteractionAdded,onNavigate,pickJourney,setAddErr,setDoneFor,setDoneNote,setJourney,setJourneyBusy,setJourneyMenu,setSkipFor,setSkipWhy,setStopAsk,skipFor,skipWhy,stopAsk,touchGap}}/>

            </div>;
            // PROFILE-1 (header) — THE RAIL'S ORDER. Next step and the scores;
            // Giving rhythm, Recurring, Thank-yous, Coming up; This year and
            // Book a visit; Contact; Relationship owner; Journey;
            // Volunteering; Connected. Then the folded cards as before.
            const R=railData||{};
            return <>
              {!isPhone&&<div style={{paddingBottom:16}}>{railNextNode}</div>}
              {railErr&&<div data-testid="dp-rail-error" style={{fontSize:12.5,color:RAIL.dim,padding:"8px 0"}}>Some of this person's facts could not be loaded just now.</div>}
        {!isPhone&&railPledgeNode}
              <RailSection title="Journeys" testid="dp-rail-journeys">{rhythmNode}</RailSection>
              <RailAboutSections {...{setRelPickerOpen,R,aboutStatusTags,canMajorGifts,contactPerson,donor,handleReassign,household,isAdmin,isReadOnly,isTeam,onSelectRelatedDonor,orgTeam,publicFiling,railData,reassignId,reassignLoading,relationships,scores,setConvoOpen,setReassignId,setRelatedOpen,setShowReassign,showReassign,status,onEdit,noGifts,nothingLogged}}/>
          <RailPersonCards {...{R,donor,donorEvents,inboxConnected,isReadOnly,loadRel,onNavigate,rel,nothingLogged}}/>


            </>;
          })()}

          <RailFacts {...{nothingLogged,cfData,cfEditVal,cfEditing,cfError,cfSaved,cfShowAll,donor,isReadOnly,isTeam,localConf,localRationale,localScore,localTier,lockMajor,onCfSaved,recalcScore,scoreLoading,setCfData,setCfEditVal,setCfEditing,setCfError,setCfSaved,setCfShowAll}}/>

        </div>
      </div>
    </div>
  );
}

export { DonorProfile, EditDonorModal, FollowUpTaskModal, LogTouchpointModal };
