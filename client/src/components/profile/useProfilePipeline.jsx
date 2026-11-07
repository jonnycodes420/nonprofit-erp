// SPLIT-2: moved VERBATIM from DonorProfile.jsx (its lines 496-712): the profile's
// state and handlers for this part, as a hook the profile calls in the same place,
// so every hook runs in the same order. Nothing it does changed.
// Tests read it through readSource("client/src/components/DonorProfile.jsx").
import { useEffect, useState, useRef } from "react";
import { apiFetch } from "../../api";
import { errorMessage } from "../../lib/domainError";
import { offerUndo, EditedMarker, ItemMenu } from "../EditHistory";
import { useReceipts } from "./ReceiptsAndStatements";
import { orgTodayCivil } from "../../lib/orgToday";
import { STAGES, donorScore, T, moveUrgency } from "../shared";

export function useProfilePipeline({ donor, setDesignations, refreshSoftCredit, refreshPipeline, designations, setHousehold, setHhModalOpen, hhPick, setHhPick, setHhSearch, household, gifts, initialAddGift, setDpTab, setAddGiftForm, setAddGiftOpen, setGifts, setGiftLoading, setGiftReadErr, giftReadSeq, setLocalInts, setFigs, setGiftsFull, loadRel, setPlannedGifts, setPledges, setMaterials, setMatLoading, setFundAffinity, setFundLoading, localInts, isReadOnly, setEditingInt, onInteractionAdded, setStwOpen, stwForm, setStwForm, setStwSaving }) {
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
        fund_lines:Array.isArray(g.fund_lines)?g.fund_lines:[],event_id:g.event_id||"",   // GIFTS-2: a split gift's lines; the edit keeps its event
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

  const loadMaterials=(quiet)=>{
    if(quiet!==true)setMatLoading(true);   // STALE-2: a re-read after a change keeps the list up
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
  return { isTeam, lockMajor, pipelineAdded, addToPipeline, hasDesignation, toggleDesignation, createHousehold, removeFromHousehold, rc, receiptsEnabled, receiptBusyId, receiptForGift, sendReceipt, downloadReceiptPdf, showYearEnd, setShowYearEnd, yearEndYear, setYearEndYear, yearEndBusy, yearEndErr, sendYearEndStatement, loadGiftsFull, loadPlannedGifts, loadPledges, loadMaterials, loadFundAffinity, intActions, onIntEdited, saveStewardship, sc, journey, setJourney, journeyBusy, setJourneyBusy, doneFor, setDoneFor, doneNote, setDoneNote, skipFor, setSkipFor, skipWhy, setSkipWhy, journeyList, setJourneyList, addPick, setAddPick, addPreview, setAddPreview, addErr, setAddErr, journeySuggest, setJourneySuggest, journeyMenu, setJourneyMenu, stopAsk, setStopAsk, allJourneys, touchGap };
}
