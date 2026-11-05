// SPLIT-2: moved VERBATIM from DonorProfile.jsx (its lines 61-279): the profile's
// state and handlers for this part, as a hook the profile calls in the same place,
// so every hook runs in the same order. Nothing it does changed.
// Tests read it through readSource("client/src/components/DonorProfile.jsx").
import { useState, useRef, useEffect, useCallback } from "react";
import { apiFetch, API, getToken } from "../../api";
import { useBeforeMeeting } from "../BeforeYourMeeting";
import { useScores } from "../ScoreWhy";
import { useCanMajorGifts } from "../../lib/majorGifts";
import { usePublicFiling } from "../RoomToGive";
import { useDonorStatus, useDonorGone } from "../ProfileStatus";
import { useMailbox } from "../InboxConnect";
import { useDonorProposals } from "../MajorGifts";
import { OPEN_PROPOSAL_KEYS } from "./profileShared";
import { errorMessage, rethrowProgrammerError } from "../../lib/domainError";
import { offerUndo } from "../EditHistory";
import { usePeoplePicker } from "../../lib/people";
import { T } from "../shared";

export function useProfileRecord({ donor, onSelectRelatedDonor, onClose, onInteractionAdded, initialOpenConversation, initialOpenCompose, initialOpenBrief, getAI }) {
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
  return { gifts, setGifts, giftLoading, setGiftLoading, giftReadErr, setGiftReadErr, giftReadSeq, localInts, setLocalInts, figs, setFigs, rel, setToldNonce, before, scores, canMajorGifts, publicFiling, setPublicFiling, filingLookupOpen, setFilingLookupOpen, prospectBriefOpen, setProspectBriefOpen, status, logMeeting, setLogMeeting, eraseOpen, setEraseOpen, stepEdit, setStepEdit, stepBusy, setStepBusy, pgOpen, setPgOpen, suggestOpen, setSuggestOpen, briefOpen, setBriefOpen, inboxConnected, eraseWord, setEraseWord, eraseBusy, eraseMsg, setEraseMsg, exportPersonData, erasePerson, loadRel, loadRailRef, sequences, dpThread, dpItems, convoOpen, setConvoOpen, editingInt, setEditingInt, planOpen, setPlanOpen, dpItemsLoaded, openProposals, proposalsKnown, propData, reloadProps, loadDpThread, relationships, relLoading, relPickerOpen, setRelPickerOpen, relSearch, setRelSearch, relType, setRelType, relSaving, relErr, setRelErr, linkDonor, unlinkDonor, retypeRelationship, relPickerResults, cfData, setCfData, cfEditing, setCfEditing, cfEditVal, setCfEditVal, cfSaved, setCfSaved, cfShowAll, setCfShowAll, cfError, setCfError, giftCfDefs, giftCfEditStr, donorEvents, localScore, localTier, localConf, localRationale, scoreLoading, recalcScore, showReassign, setShowReassign, reassignId, setReassignId, reassignLoading, setReassignLoading, draftCopied, copyDraftEmail };
}
