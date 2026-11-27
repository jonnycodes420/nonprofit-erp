// SPLIT-2: moved VERBATIM from DonorProfile.jsx (its lines 714-927): the profile's
// state and handlers for this part, as a hook the profile calls in the same place,
// so every hook runs in the same order. Nothing it does changed.
// Tests read it through readSource("client/src/components/DonorProfile.jsx").
import { useEffect, useState } from "react";
import { apiFetch } from "../../api";
import { track } from "../../lib/analyticsDoor";   // ANALYTICS-1
import { errorMessage } from "../../lib/domainError";
import { askConfirm } from "../ConfirmDialog";
import { fmtFull } from "../shared";
import { told } from "../../lib/stewardTold";
import { useChanged } from "../../lib/changes";
import { giftBody, extrasBody, unpickedProblem, emptyGiftForm } from "../../lib/giftForm";   // GIFTS-3: one body for create and edit
import { orgTodayCivil } from "../../lib/orgToday";
import { fundLinesProblem } from "../gifts/FundField";   // GIFTS-2: a gift split across funds
import { rememberGift } from "../../lib/stickyGift";   // QUICKADD-1: "Same as last" for the next gift
import { offerUndo } from "../EditHistory";
import { savePledgeSchedule } from "../gifts/PledgeSchedule";
import { giftDeleteDialog } from "../../lib/giftDeleteWords";
import { giftAmountProblem } from "../../lib/amountCheck";   // INPUT-1
import { isFarOutside, askFarOutside } from "../../lib/farOutside";   // IMPORT-11
import { confirmGiftDate } from "../../lib/giftDateCheck";   // INPUT-1: Jan 1, 1900 asks first   // THANKS-1 item 5: one delete dialog

export function useProfileGiving({ givingOpen, setFigs, setGiftsFull, donor, journey, setJourneyList, setJourneySuggest, setAddPick, setAddPreview, setAddErr, onInteractionAdded, setJourney, journeyBusy, setJourneyBusy, addPick, setGiftLoading, loadGiftsFull, loadPlannedGifts, loadPledges, dpTab, fundAffinity, loadMaterials, loadFundAffinity, setCampaigns, giftCfDefs, giftsFull, setGiftEditId, giftEditForm, setGiftSaving, receiptForGift, addGiftForm, setAddGiftForm, setGiftErr, addGiftIdemRef, setAddGiftOpen, refreshSoftCredit, addPledgeIdemRef, pledgeForm, setPledgeForm, setAddPledgeOpen, setPledgeSaving, setPledgeResendBusyId, setPledgeResentIds, pgForm, setPgForm, setAddPgOpen, setPgSaving, matNote, setMatNote, setMatUploading }) {
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
    if(givingOpen)loadPlannedGifts();   // PROFILE-SPEED-1: only once Giving has been opened
    loadPledges();
  },[donor.id,interactionCount]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(()=>{if(givingOpen)loadPlannedGifts();},[givingOpen]);   // eslint-disable-line react-hooks/exhaustive-deps

  // STALE-2: the uploads are read when the record opens, not when Files is
  // clicked: the tab's count is the one file tally (lib/profileFiles.js).
  useEffect(()=>{loadMaterials();},[donor.id]);
  useEffect(()=>{
    if(dpTab==="files")loadMaterials(true);
    if(dpTab==="giving"&&(!fundAffinity||fundAffinity.donorId!==donor.id))loadFundAffinity();   // PLEDGES-2: this person's, not the last one's
  },[dpTab,donor.id]);
  // PLEDGES-2: a payment, a write-off or a delete made anywhere re-reads the
  // pledges (the Giving tab and the rail read the same answer) and the support panel.
  useChanged(["gift","pledge"],()=>{loadPledges();if(fundAffinity&&fundAffinity.donorId===donor.id)loadFundAffinity();});

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

  // GIFTS-3 item 1: the edit sends the one gift body (lib/giftForm.js), the
  // same one New gift sends, and its soft credit, tribute and match when changed.
  const saveGiftEdit=async(giftId,setErr=()=>{})=>{
    setErr("");
    const unpicked=unpickedProblem(giftEditForm);
    if(unpicked){setErr(unpicked);return;}
    const fundProblem=fundLinesProblem(giftEditForm.amount,giftEditForm.fund);
    if(fundProblem){setErr(fundProblem);return;}
    if(giftEditForm.date!==undefined&&!(await confirmGiftDate(askConfirm,giftEditForm.date)))return;   // INPUT-1
    // FIX-14 Part 2 — a receipt is a document the donor already holds. Editing
    // the amount does not change it, so the person editing is told first.
    const rcpt=receiptForGift(giftId);
    const was=giftsFull.find(g=>g.id===giftId);
    if(rcpt&&was&&giftEditForm.amount!==undefined&&Number(giftEditForm.amount)!==Number(was.amount)
      &&!(await askConfirm({title:"A receipt already went out",body:`A receipt already went out for this gift${rcpt.receipt_number?` (${rcpt.receipt_number})`:""}, for ${fmtFull(Number(rcpt.amount||was.amount))}. Changing the amount here does not change that receipt; void it and issue a new one from Tax receipts if it needs correcting. Save the new amount?`,yes:"Change the amount"})))return;
    if(giftAmountProblem(giftEditForm.amount)){setErr(giftAmountProblem(giftEditForm.amount));return;}   // IMPORT-11: over the cap, said first
    setGiftSaving(true);
    try{
      const put=confirmFarOutside=>apiFetch(`/gifts/${giftId}`,{method:"PUT",body:JSON.stringify({...giftBody(giftEditForm,{editing:true}),confirmFarOutside})});
      let saved;
      try{saved=await put(undefined);}
      catch(e){if(!isFarOutside(e))throw e;if(!(await askFarOutside(askConfirm,e))){setGiftSaving(false);return;}saved=await put(true);}   // IMPORT-11
      // POLISH-9: the screen she edited answers from the save itself, at once
      if(saved&&saved.figures&&setFigs)setFigs(saved.figures);
      if(saved&&saved.id&&setGiftsFull)setGiftsFull(gs=>gs.map(x=>x.id===saved.id?{...x,amount:parseFloat(saved.amount)||0,date:saved.date||x.date}:x));
      const ex=extrasBody(giftEditForm),was2=giftEditForm.extrasWas?extrasBody(giftEditForm.extrasWas):{};
      if(JSON.stringify(ex)!==JSON.stringify(was2)){
        // A soft credit taken off is sent as an empty set; a tribute or match stays until changed.
        await apiFetch(`/gifts/${giftId}/extras`,{method:"PUT",body:JSON.stringify({softCredits:ex.softCredits||[],...(ex.tribute?{tribute:ex.tribute}:{}),...(ex.match&&!was2.match?{match:ex.match}:{})})});
      }
      if(giftEditForm.customFields&&giftCfDefs.length){
        // through the ONE seam — a refused value names its reason
        await apiFetch(`/gifts/${giftId}/custom-fields`,{method:"PUT",body:JSON.stringify({values:giftEditForm.customFields})});
      }
      told({donorId:donor.id,gift:true});loadPledges();refreshSoftCredit();   // LEDGER-1: header, rail, thank-you and pledges all re-read
      loadGiftsFull();
      setGiftEditId(null);
    }catch(e){setErr(e?.errors?.[0]?.error||errorMessage(e, "That value was refused"));}
    setGiftSaving(false);
  };

  // THANKS-1 item 5: ONE dialog. What is in the way (an active receipt, sent or not; a refund) is
  // read first, and the one question says what will happen to each (lib/giftDeleteWords.js).
  const deleteGift=async(giftId)=>{
    // LAG-1 (W-1107-Finance-04X): a refusal is said on the page, never in a browser alert.
    const say=(e,why)=>askConfirm({title:"The gift was not deleted",body:errorMessage(e,why),yes:"OK",no:"Close"});
    const del=(pair=false)=>apiFetch(`/gifts/${giftId}${pair?"?withRefunds=1":""}`,{method:"DELETE"}).then(()=>{told({donorId:donor.id,gift:true});loadPledges();});   // LEDGER-1: the rail and its thank-you too
    const receipts=await apiFetch(`/donors/${encodeURIComponent(donor.id)}/receipts`).then(rs=>(Array.isArray(rs)?rs:[]).filter(r=>r.gift_id===giftId&&r.type==="gift"&&!r.voided_at)).catch(()=>[]);
    const refunds=(giftsFull||[]).filter(x=>(x.refund_of||x.refundOf)===giftId).length;   // FLOWS-14: a refunded gift goes only with its refund
    if(!(await askConfirm({...giftDeleteDialog({receipts,refunds}),danger:true})))return;
    const voidAll=async ids=>{for(const id of ids)await apiFetch(`/receipts/${encodeURIComponent(id)}/void`,{method:"POST",body:JSON.stringify({reason:"Voided to delete the gift."})});};
    try{
      if(receipts.length)await voidAll(receipts.map(r=>r.id));
      await del(refunds>0);
    }catch(e){
      // The server is the guard: a receipt or refund that appeared since the dialog is asked about once more, in the same words.
      if(e?.error==="has_refunds"||(e?.error==="receipt_active"&&Array.isArray(e.receiptIds))){
        const again=e.error==="has_refunds"?giftDeleteDialog({refunds:e.refunds||1,pairButton:e.pairButton})
          :giftDeleteDialog({receipts:e.receiptIds.map(()=>({receipt_number:e.receiptNumber,sent:e.receiptSent===true})).slice(0,1),refunds});
        if(!(await askConfirm({...again,title:"Something changed since you asked",danger:true})))return;
        try{if(e.error==="receipt_active")await voidAll(e.receiptIds);await del(e.error==="has_refunds"||refunds>0);}
        catch(e2){say(e2,"The gift is still here.");}
        return;
      }
      say(e,receipts.length?"The receipt was not voided, so the gift is still here.":"The gift could not be deleted.");
    }
  };

  // GIFTS-3 item 2: a person on the form (soft credit, tribute, matching
  // employer) is a record she picked from the matches, never a name guessed at
  // Save; text typed and not picked stops the save with a sentence.
  const addGift=async()=>{
    const f=addGiftForm;
    if(giftAmountProblem(f.amount)){setGiftErr(giftAmountProblem(f.amount));return;}   // INPUT-1: said, never flipped
    if(!String(f.amount||"").trim()||isNaN(Number(String(f.amount).replace(/[$,]/g,"")))){setGiftErr("Type the amount.");return;}
    const unpicked=unpickedProblem(f);
    if(unpicked){setGiftErr(unpicked);return;}
    const fundProblem=fundLinesProblem(f.amount,f.fund);
    if(fundProblem){setGiftErr(fundProblem);return;}
    if(!(await confirmGiftDate(askConfirm,f.date)))return;   // INPUT-1: "Change it" leaves the form as it is
    setGiftErr("");
    setGiftSaving(true);
    if(!addGiftIdemRef.current)addGiftIdemRef.current=crypto.randomUUID();
    // PLEDGES-2: a payment above what is left on the pledge asks first (the server's question, in its words).
    let farOk;   // IMPORT-11: her "Record it" to a gift far outside the pattern
    const post=overBalance=>apiFetch(`/donors/${donor.id}/gifts`,{method:"POST",body:JSON.stringify({
        ...giftBody(f),...extrasBody(f),overBalance,confirmFarOutside:farOk,
        pledgeId:f.pledgeId||undefined,idempotencyKey:addGiftIdemRef.current,
      })});
    try{
      let r;
      try{r=await post(undefined);}
      catch(e0){
        let e=e0;
        if(isFarOutside(e)){
          if(!(await askFarOutside(askConfirm,e))){setGiftSaving(false);return;}
          farOk=true;
          try{r=await post(undefined);e=null;}catch(e1){e=e1;}
        }
        if(e){
          if(!(e.code==="over_balance"||(e.body&&e.body.code==="over_balance")))throw e;
          const q=e.body||e,fm=v=>fmtFull(Number(v)||0);
          const pick=await askConfirm({title:"This is more than is left on the pledge",body:q.sentence,
            yes:`Record ${fm(q.extra)} as an extra gift`,...((q.choices||[]).includes("reduce")?{alt:`Reduce to ${fm(q.balance)}`}:{}),no:"Go back"});
          if(!pick){setGiftSaving(false);return;}
          r=await post(pick==="alt"?"reduce":"extra_gift");
        }
      }
      addGiftIdemRef.current=null;
      track("gift_recorded",{via:"profile",pledge:!!f.pledgeId});
      const gid=r&&r.gift&&r.gift.id;
      if(gid&&f.customFields&&giftCfDefs.length&&Object.values(f.customFields).some(v=>v!==""&&v!=null))
        await apiFetch(`/gifts/${gid}/custom-fields`,{method:"PUT",body:JSON.stringify({values:f.customFields})}).catch(()=>{});
      rememberGift({date:f.date,method:f.payment_method,fund:f.fund,campaign:f.campaign,appeal:f.appeal,page:f.page});
      setAddGiftOpen(false);
      // VOICE-4: every tile re-reads, not only the ones the gift read carries
      // (Average and Largest come from the status read, which waited on figs).
      told({donorId:donor.id,gift:true});
      setAddGiftForm(emptyGiftForm());
      loadGiftsFull();refreshSoftCredit();
      if(f.pledgeId)loadPledges();
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

  // PLEDGES-2 · A WRITE-OFF IS A MONEY ACTION (W-1107-Finance-30X): a confirm
  // that states the amount, then an Undo toast. The server writes the audit row.
  const setPledgeStatus=async(id,status,pl)=>{
    try{
      let body={status};
      if(status==="written_off"){
        const bal=fmtFull(Number(pl&&pl.balance)||0);
        if(!(await askConfirm({title:`Write off ${bal}?`,body:`${bal} is still owed on this pledge. Writing it off stops the reminders and takes it off what is pledged. You can undo it.`,yes:`Write off ${bal}`,danger:true})))return;
        body={status,confirmed:true};
      }
      await apiFetch(`/pledges/${id}`,{method:"PUT",body:JSON.stringify(body)});
      told({donorId:donor.id,pledge:true});loadPledges();
      if(status==="written_off")offerUndo({undoAction:async()=>{await apiFetch(`/pledges/${id}`,{method:"PUT",body:JSON.stringify({status:"open"})});told({donorId:donor.id,pledge:true});loadPledges();},message:`Wrote off ${fmtFull(Number(pl&&pl.balance)||0)}.`},"write-off",loadPledges);   // POLISH-7 W-1108-Finance-48X: the toast says what happened
    }catch(e){alert(errorMessage(e, "Could not update pledge"));}
  };

  // NUMBERS-10 item 6 (W-1127-Finance-03): a pledge that can't be deleted (payments applied) says why
  // BEFORE any confirm, from the list's own `deleteRefusal`; a refusal from the server is said the same
  // way, in the app, never a browser alert. A confirm is only ever shown for a delete that will happen.
  const pledgeStays=(body)=>askConfirm({title:"This pledge stays on the record",body,yes:false,no:"Close"});
  const deletePledge=async(id,pl)=>{
    if(pl&&pl.deleteRefusal){await pledgeStays(pl.deleteRefusal);return;}
    if(!(await askConfirm({title:"Delete this pledge?",body:"It comes off this person's record, with its schedule and its line on the timeline. You can undo it.",yes:"Delete pledge",danger:true})))return;
    try{
      const r=await apiFetch(`/pledges/${id}`,{method:"DELETE"});
      told({donorId:donor.id,pledge:true});loadPledges();
      offerUndo(r,"pledge",loadPledges);
    }catch(e){loadPledges();await pledgeStays(errorMessage(e,"The pledge could not be deleted."));}
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
      loadMaterials(true);
    }catch(e){window.alert(errorMessage(e,"That file did not save."));}
    setMatUploading(false);
  };
  return { pickJourney, confirmAddToJourney, saveGiftEdit, deleteGift, addGift, addPledge, setPledgeStatus, deletePledge, pledgeEdit, setPledgeEdit, savePledgeEdit, resendPledgeReminder, addPlannedGift, deletePlannedGift, uploadMaterial };
}
