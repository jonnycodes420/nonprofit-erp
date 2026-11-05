// SPLIT-2: moved VERBATIM from DonorProfile.jsx (its lines 714-927): the profile's
// state and handlers for this part, as a hook the profile calls in the same place,
// so every hook runs in the same order. Nothing it does changed.
// Tests read it through readSource("client/src/components/DonorProfile.jsx").
import { useEffect, useState } from "react";
import { apiFetch } from "../../api";
import { errorMessage } from "../../lib/domainError";
import { askConfirm } from "../ConfirmDialog";
import { fmtFull } from "../shared";
import { told } from "../../lib/stewardTold";
import { peopleNamed } from "../../lib/people";
import { orgTodayCivil } from "../../lib/orgToday";
import { offerUndo } from "../EditHistory";
import { savePledgeSchedule } from "../gifts/PledgeSchedule";

export function useProfileGiving({ donor, journey, setJourneyList, setJourneySuggest, setAddPick, setAddPreview, setAddErr, onInteractionAdded, setJourney, journeyBusy, setJourneyBusy, addPick, setGiftLoading, loadGiftsFull, loadPlannedGifts, loadPledges, dpTab, fundAffinity, loadMaterials, loadFundAffinity, setCampaigns, giftCfDefs, giftsFull, setGiftEditId, giftEditForm, setGiftSaving, receiptForGift, addGiftForm, setAddGiftForm, setGiftErr, addGiftIdemRef, setAddGiftOpen, refreshSoftCredit, addPledgeIdemRef, pledgeForm, setPledgeForm, setAddPledgeOpen, setPledgeSaving, setPledgeResendBusyId, setPledgeResentIds, pgForm, setPgForm, setAddPgOpen, setPgSaving, matNote, setMatNote, setMatUploading }) {
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
  return { pickJourney, confirmAddToJourney, saveGiftEdit, deleteGift, addGift, addPledge, setPledgeStatus, deletePledge, pledgeEdit, setPledgeEdit, savePledgeEdit, resendPledgeReminder, addPlannedGift, deletePlannedGift, uploadMaterial };
}
