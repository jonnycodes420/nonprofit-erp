// SPLIT-2: moved VERBATIM from DonorProfile.jsx (its lines 929-1141): the profile's
// state and handlers for this part, as a hook the profile calls in the same place,
// so every hook runs in the same order. Nothing it does changed.
// Tests read it through readSource("client/src/components/DonorProfile.jsx").
import { apiFetch, API, getToken } from "../../api";
import { offerUndo } from "../EditHistory";
import { useState, useEffect, useMemo } from "react";
import { useProfileRefresh } from "../../lib/profileRefresh";
import { renderCustomValue } from "../../../../shared/customFieldShape";
import { errorMessage } from "../../lib/domainError";
import { T, fmtFull, firstNameOf } from "../shared";
import { displayDateShort } from "../../../../shared/displayDate";
import { orgTodayPlus } from "../../lib/orgToday";
import { displayName } from "../../../../shared/displayName.js";
import { statusTagItems } from "../ProfileStatus";

export function useProfileFiles({ loadMaterials, donor, onInteractionAdded, setToldNonce, loadRel, reloadProps, loadDpThread, loadGiftsFull, giftCfDefs, giftsFull, stepEdit, setStepEdit, setStepBusy, localInts, rel, dpTab, setDpTab, pledges, actMode, recurringSub, dpItems, openProposals, aiMap, getAI, dpItemsLoaded, gifts, giftLoading, giftReadErr, figs, status, railData }) {

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
  return { viewMaterial, deleteMaterial, impactPdfLoading, videoThanksOpen, setVideoThanksOpen, volOpen, setVolOpen, makeVolOpen, setMakeVolOpen, setMadeVol, isVolunteer, yourPageMsg, sendYourPageLink, downloadImpactSummary, exportGiftsCSV, saveStep, deleteStep, openForNextMove, yearDrill, setYearDrill, snoozing, snoozeErr, snoozeThread, contactPerson, headName, callName, noGifts, headTags, aboutStatusTags };
}
