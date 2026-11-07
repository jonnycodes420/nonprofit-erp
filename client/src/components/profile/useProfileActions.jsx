// SPLIT-2: moved VERBATIM from DonorProfile.jsx (its lines 281-495): the profile's
// state and handlers for this part, as a hook the profile calls in the same place,
// so every hook runs in the same order. Nothing it does changed.
// Tests read it through readSource("client/src/components/DonorProfile.jsx").
import { profileFileTally } from "../../lib/profileFiles";
import { apiFetch } from "../../api";
import { orgTodayCivil } from "../../lib/orgToday";
import { useState, useRef, useEffect, useMemo } from "react";
import { useIsPhone } from "../../lib/stickyRail";
import { useFrameHeight } from "./columns";
import { useTimelineExtras } from "../ProfileTimeline";
import { timelineCounts, buildTimelineItems } from "../MeetingPanels";
import { errorMessage } from "../../lib/domainError";
import { usePeoplePicker } from "../../lib/people";
import { fmtFull } from "../shared";

export function useProfileActions({ donor, orgTeam, onReassign, setShowReassign, reassignId, setReassignLoading, initialAddGift, localInts, rel, loadRailRef, onStageChange }) {

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
  const [matLoading,setMatLoading]=useState(true);   // STALE-2: unknown until the first read, never "Files · 0" before it
  // STALE-2 (W-1107-Donors-31): the tab's count, the heading and the list are this one tally (lib/profileFiles.js).
  const fileTally=useMemo(()=>profileFileTally({materials,materialsKnown:!matLoading,attachments:tlExtras.attachments,rel}),[materials,matLoading,tlExtras.attachments,rel]);
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
  return { handleReassign, showGiftModal, setShowGiftModal, seqOpen, setSeqOpen, seqId, setSeqId, seqLoading, setSeqLoading, seqToast, setSeqToast, dpTab, setDpTab, relatedOpen, setRelatedOpen, mergeOpen, setMergeOpen, mergeKeptRef, tlSearch, setTlSearch, tlSearchOpen, setTlSearchOpen, whyStopOpen, setWhyStopOpen, railRef, noteOpen, setNoteOpen, frameRef, isPhone, dpMoreOpen, setDpMoreOpen, pledges, setPledges, giftsFull, setGiftsFull, giftCountReal, refundRows, tlExtras, tlCounts, railData, railErr, giftEditId, setGiftEditId, giftEditForm, setGiftEditForm, addGiftForm, setAddGiftForm, giftErr, setGiftErr, giftMoreOpen, setGiftMoreOpen, addGiftIdemRef, addPledgeIdemRef, addGiftOpen, setAddGiftOpen, giftSaving, setGiftSaving, plannedGifts, setPlannedGifts, pgForm, setPgForm, addPgOpen, setAddPgOpen, pgSaving, setPgSaving, pledgeForm, setPledgeForm, addPledgeOpen, setAddPledgeOpen, pledgeSaving, setPledgeSaving, pledgeResendBusyId, setPledgeResendBusyId, pledgeResentIds, setPledgeResentIds, fundAffinity, setFundAffinity, fundLoading, setFundLoading, materials, setMaterials, matLoading, setMatLoading, matNote, setMatNote, matUploading, setMatUploading, actMode, stwOpen, setStwOpen, stwForm, setStwForm, stwSaving, setStwSaving, campaigns, setCampaigns, photoUrl, setPhotoUrl, recurringSub, recurResendBusy, recurResendSent, resendRecurringLink, household, setHousehold, fileTally, softCredit, designations, setDesignations, hhModalOpen, setHhModalOpen, hhPick, setHhPick, hhSearch, setHhSearch, hhPeople, giftPeopleQ, refreshSoftCredit, moves, opps, askOpen, setAskOpen, askName, setAskName, askAmt, setAskAmt, moveSuggestions, dismissedSug, refreshPipeline, acceptSuggestion, dismissSuggestion, addAsk, closeAsk };
}
