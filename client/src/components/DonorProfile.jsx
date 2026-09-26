// DonorProfile.jsx — one person's record: the profile and the modals it opens.
//
// FIX-1 split: moved VERBATIM out of Donors.jsx. Nothing in it changed.
// Tests read it through readSource("client/src/components/Donors.jsx").
import { useState, useEffect, useRef, useContext } from "react";
import { FunderPanel } from "./FunderPanel";
import { VolunteerPanel } from "./VolunteerPanel";
import { MembershipPanel } from "./Memberships";
import { apiFetch, API, getToken } from "../api";
import { rethrowProgrammerError, errorMessage } from "../lib/domainError";
import Uploader from "./Uploader";
import { bestCampaignMatch } from "../lib/campaignMatch";
import { dueBadge } from "../lib/taskDue";
import { PERSON_TYPES } from "../../../shared/personType.js";
import { censusById } from "../../../shared/numberCensus.js";
import { renderCustomValue } from "../../../shared/customFieldShape";
import { T, fmtFull, daysDiff, SC, STAGES, STAGE_ACTION, TIER_COLOR, donorScore, moveUrgency, Spin, Pill, AIBtn, AIPanel, GivingHistoryChart, TpField, TpYesNo, TouchpointTimeline, LockedFeature, goToPricing, DriftBadge, Modal, firstNameOf, PersonMark, PhotoContext } from "./shared";
import { ProposalsPanel, PlanPanel, BriefPanel } from "./MajorGifts";
import { LogConversationModal, ThreadDismissMenu, PutItOnMyCalendar } from "./LogConversation";
import { PlanFollowUpModal } from "./PlanFollowUp";
import { DESIGNATION_OPTS } from "./donorShared";

const WEALTH_SCORE_DEFINITION = null;
const WEALTH_SCORE_SOURCE = null;

// Donor-to-donor relationship types (server.js's DONOR_RELATIONSHIP_TYPES) —
// spouse/household pool into the profile's combined household total; family
// and employer_match are relationship context only. Manual linking only, no
// auto-detection in this pass.
const DONOR_RELATIONSHIP_LABELS = [
  ["spouse","Spouse"],
  ["household","Household"],
  ["family","Family"],
  ["employer_match","Employer Match"],
];

// BUILD-88a A.1 — the machine-written gift sentence, which used to CARRY the
// amount ("Gift received: $5,000 (check)", "Online donation: $250 via Steward
// Giving Page"). Where a timeline row links to its gift, the money is read off
// the gift and this prefix is dropped, so the same gift is never stated twice.
// Anything a human typed after it survives.
const stripGiftAmountPrefix = note => String(note || "")
  .replace(/^(?:Gift received|Online donation):\s*\$[\d,.]+(?:\s*\([^)]*\))?(?:\s+via[^—-]*)?\s*(?:[—-]\s*)?/i, "")
  .trim();

// ── Follow-up Task Modal ───────────────────────────────────────────────────
function FollowUpTaskModal({donor,onSave,onClose}){
  const due7=new Date();due7.setDate(due7.getDate()+7);
  // BUILD-88a A.2 — the box no longer opens on "Follow up: <name>". The donor's
  // name is already on the screen, and a list where every row starts with the
  // same two words is a list nobody can scan. It opens EMPTY, with the step the
  // box is asking for as its placeholder; the server refuses a "Follow up:"
  // prefix too, so a saved shortcut cannot put it back.
  const[title,setTitle]=useState("");
  const[due,setDue]=useState(due7.toISOString().split("T")[0]);
  const[priority,setPriority]=useState("medium");
  const[loading,setLoading]=useState(false);
  const inp={width:"100%",background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"10px 12px",color:T.ink,fontSize:13,outline:"none",fontFamily:"inherit",boxSizing:"border-box"};
  const save=async()=>{
    if(!title.trim())return;setLoading(true);
    try{
      const raw=await apiFetch("/tasks",{method:"POST",body:JSON.stringify({title,due,priority,type:"donor",donorId:donor.id})});
      onSave({id:raw.id,title:raw.title,due:raw.due||"",priority:raw.priority,type:raw.type,done:!!raw.done,donorId:donor.id});
    }catch(e){console.error(e);}
    setLoading(false);
  };
  return(
    <Modal onClose={onClose} width={420} zIndex={400} padding={24}
      ariaLabel="Create follow-up task" dialogStyle={{border:"1px solid "+T.bg3}}>
      <div>
        <div style={{fontSize:16,fontWeight:800,color:T.ink,marginBottom:2}}>Create Follow-up Task</div>
        <div style={{fontSize:12,color:T.ink3,marginBottom:20}}>For {donor.name}</div>
        <div style={{display:"flex",flexDirection:"column",gap:12}}>
          <div>
            <div style={{fontSize:11,fontWeight:700,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:5}}>Task Title</div>
            <input value={title} onChange={e=>setTitle(e.target.value)} placeholder="What happens next? e.g. Send the impact report" style={inp}/>
          </div>
          <div>
            <div style={{fontSize:11,fontWeight:700,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:5}}>Due Date</div>
            <input type="date" value={due} onChange={e=>setDue(e.target.value)} style={inp}/>
          </div>
          <div>
            <div style={{fontSize:11,fontWeight:700,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:8}}>Priority</div>
            <div style={{display:"flex",gap:6}}>
              {["high","medium","low"].map(p=>(
                <button key={p} onClick={()=>setPriority(p)} style={{flex:1,background:priority===p?SC[p]:T.bg,border:`1px solid ${priority===p?SC[p]:T.bg3}`,borderRadius:8,padding:"8px",color:priority===p?"#fff":T.ink3,fontSize:12,fontWeight:600,cursor:"pointer",textTransform:"capitalize"}}>{p}</button>
              ))}
            </div>
          </div>
        </div>
        <div style={{display:"flex",gap:8,marginTop:20}}>
          <button onClick={save} disabled={loading||!title.trim()} style={{flex:1,background:title.trim()?"#0d5c3a":T.bg2,border:"none",borderRadius:10,padding:"12px",color:"#fff",fontSize:14,fontWeight:700,cursor:title.trim()?"pointer":"not-allowed"}}>{loading?"Creating…":"Create Task"}</button>
          <button onClick={onClose} style={{background:T.bg,border:"none",borderRadius:10,padding:"12px 16px",color:T.ink3,fontSize:13,cursor:"pointer"}}>Skip</button>
        </div>
      </div>
    </Modal>
  );
}

// ── Log Touchpoint Modal ───────────────────────────────────────────────────
function LogTouchpointModal({donor,onSave,onClose}){
  const[type,setType]=useState("call");
  const[date,setDate]=useState(new Date().toISOString().split("T")[0]);
  const[loading,setLoading]=useState(false);
  // BUILD-45 §1.1 F-3 — one idempotency key per modal open: a double-tapped
  // Save replays the SAME key and the server records exactly one gift.
  const giftIdemRef=useRef(crypto.randomUUID());
  const[kt1,setKt1]=useState("");const[kt2,setKt2]=useState("");const[kt3,setKt3]=useState("");
  const[history,setHistory]=useState("");const[spouse,setSpouse]=useState("");const[nextStep,setNextStep]=useState("");
  const[answered,setAnswered]=useState("yes");const[duration,setDuration]=useState("");const[objections,setObjections]=useState("");
  const[attendees,setAttendees]=useState("");const[location,setLocation]=useState("");
  const[sentiment,setSentiment]=useState("Positive");const[asksMade,setAsksMade]=useState("");
  const[subject,setSubject]=useState("");const[summary,setSummary]=useState("");const[responded,setResponded]=useState("no");
  const[eventName,setEventName]=useState("");const[attended,setAttended]=useState("yes");const[observations,setObservations]=useState("");
  const[amount,setAmount]=useState("");const[designation,setDesignation]=useState("");
  const[payMethod,setPayMethod]=useState("");const[ackSent,setAckSent]=useState("no");
  const[otherNotes,setOtherNotes]=useState("");
  const[finFunds,setFinFunds]=useState([]);const[finFundId,setFinFundId]=useState("");const[finAcctId,setFinAcctId]=useState("");
  const[orgEvents,setOrgEvents]=useState([]);
  // BUILD-32 — real campaign attribution: a Campaign selector (writes campaign_id)
  // + a "Did you mean <Campaign>?" suggestion when the typed Designation matches
  // an existing campaign name. `finCampaigns` = the org's goal'd campaigns.
  const[finCampaigns,setFinCampaigns]=useState([]);const[campaignId,setCampaignId]=useState("");
  useEffect(()=>{
    Promise.all([apiFetch("/finance/funds"),apiFetch("/finance/accounts"),apiFetch("/events"),apiFetch("/fundraising/campaigns").catch(()=>[])]).then(([fds,accts,evts,camps])=>{
      setFinFunds(fds);
      const def=fds.find(f=>!f.restricted)||fds[0];if(def)setFinFundId(def.id);
      const ca=accts.find(a=>a.type==="revenue"&&(a.code==="4010"||a.name.toLowerCase().includes("contribution")))||accts.find(a=>a.type==="revenue");
      if(ca)setFinAcctId(ca.id);
      setOrgEvents(Array.isArray(evts)?evts.slice(0,20):[]);
      setFinCampaigns(Array.isArray(camps)?camps:[]);
    }).catch(()=>{});
  },[]);
  // Only suggest when the user typed a designation, hasn't already picked a
  // campaign, and it fuzzy-matches an existing one.
  const campaignSuggestion=(!campaignId&&designation.trim())?bestCampaignMatch(designation,finCampaigns):null;

  const TYPES=[["call","Call"],["meeting","Meeting"],["email","Email"],["event","Event"],["gift","Gift/Pledge"],["other","Other"]];

  const buildNote=()=>{
    const L=[];
    const add=(k,v)=>{if(v&&String(v).trim())L.push(`${k}: ${v.trim()}`);};
    if(type==="call"){
      L.push(`Answered: ${answered}`);
      add("Duration",duration);add("Key Takeaway 1",kt1);add("Key Takeaway 2",kt2);add("Key Takeaway 3",kt3);
      add("Objections / Concerns",objections);add("Donor History",history);add("Spouse / Partner",spouse);add("Next Step",nextStep);
    }else if(type==="meeting"){
      add("Attendees",attendees);add("Location",location);
      add("Key Takeaway 1",kt1);add("Key Takeaway 2",kt2);add("Key Takeaway 3",kt3);
      L.push(`Donor Sentiment: ${sentiment}`);
      add("Spouse / Partner",spouse);add("Donor History",history);add("Asks Made",asksMade);add("Next Step",nextStep);
    }else if(type==="email"){
      add("Subject",subject);add("Summary",summary);
      L.push(`Response Received: ${responded}`);
      add("Donor History",history);add("Next Step",nextStep);
    }else if(type==="event"){
      add("Event",eventName);L.push(`Donor Attended: ${attended}`);
      add("Observations",observations);add("Donor History",history);add("Next Step",nextStep);
    }else if(type==="gift"){
      add("Amount",amount);add("Designation",designation);
      add("Payment Method",payMethod);L.push(`Acknowledgement Sent: ${ackSent}`);add("Next Step",nextStep);
    }else{
      add("Notes",otherNotes);add("Donor History",history);add("Spouse / Partner",spouse);add("Next Step",nextStep);
    }
    return L.join("\n");
  };

  const save=async()=>{
    const note=buildNote();if(!note.trim())return;setLoading(true);
    try{
      const saveType=type==="gift"?"gift":type==="meeting"?"meeting":type;
      await apiFetch(`/donors/${donor.id}/interactions`,{method:"POST",body:JSON.stringify({type:saveType,note,date})});
      const giftAmt=type==="gift"?(parseFloat(String(amount).replace(/[$,]/g,""))||0):0;
      if(type==="gift"&&giftAmt>0){
        // The gift route auto-stamps the Finance ledger exactly once (source=gift,
        // carrying the chosen fund). The old separate /finance/transactions call
        // was removed — it double-stamped the ledger (BUILD-21 Part 3).
        await apiFetch(`/donors/${donor.id}/gifts`,{method:"POST",body:JSON.stringify({amount:giftAmt,date,notes:note,fundId:finFundId||undefined,campaignId:campaignId||undefined,idempotencyKey:giftIdemRef.current})});
      }
      onSave({type:saveType,note,date,amount:giftAmt});
    }catch(e){console.error(e);}
    setLoading(false);
  };

  const inp={width:"100%",background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"10px 12px",color:T.ink,fontSize:13,outline:"none",fontFamily:"inherit",boxSizing:"border-box"};
  const ta={...inp,resize:"vertical",lineHeight:1.55};
  const fieldHint={fontSize:11,color:T.ink3,marginTop:4,lineHeight:1.4};
  const canSave=buildNote().trim().length>0;

  return(
    <Modal onClose={onClose} width={520} zIndex={300} padding={24}
      ariaLabel="Log touchpoint" dialogStyle={{border:"1px solid "+T.bg3}}>
      <div>
        <div style={{fontSize:16,fontWeight:800,color:T.ink,marginBottom:2}}>Log Touchpoint</div>
        <div style={{fontSize:12,color:T.ink3,marginBottom:16}}>{donor.name}</div>
        <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:16}}>
          {TYPES.map(([v,l])=><button key={v} onClick={()=>setType(v)} style={{background:type===v?"#0d5c3a":T.bg2,border:`1px solid ${type===v?"#0d5c3a":T.bg3}`,borderRadius:7,padding:"5px 13px",color:type===v?"#fff":T.ink3,fontSize:12,fontWeight:600,cursor:"pointer"}}>{l}</button>)}
        </div>
        <div style={{marginBottom:16}}><span style={{fontSize:11,fontWeight:700,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:5,display:"block"}}>Date</span><input type="date" value={date} onChange={e=>setDate(e.target.value)} style={inp}/></div>
        <div style={{display:"flex",flexDirection:"column",gap:14,marginBottom:20}}>
          {type==="call"&&<>
            <TpField label="Answered?"><TpYesNo val={answered} set={setAnswered}/></TpField>
            <TpField label="Duration"><input value={duration} onChange={e=>setDuration(e.target.value)} placeholder="e.g. 20 min" style={inp}/></TpField>
            <TpField label="Key Takeaway 1"><textarea value={kt1} onChange={e=>setKt1(e.target.value)} rows={2} style={ta}/></TpField>
            <TpField label="Key Takeaway 2"><textarea value={kt2} onChange={e=>setKt2(e.target.value)} rows={2} style={ta}/></TpField>
            <TpField label="Key Takeaway 3"><textarea value={kt3} onChange={e=>setKt3(e.target.value)} rows={2} style={ta}/></TpField>
            <TpField label="Objections / Concerns"><textarea value={objections} onChange={e=>setObjections(e.target.value)} rows={2} style={ta}/></TpField>
            <TpField label="Donor History & Background"><textarea value={history} onChange={e=>setHistory(e.target.value)} placeholder="Past relationship, giving context, background…" rows={3} style={ta}/></TpField>
            <TpField label="Spouse / Partner"><input value={spouse} onChange={e=>setSpouse(e.target.value)} placeholder="Name and relevant details" style={inp}/></TpField>
            <TpField label="Next Steps"><textarea value={nextStep} onChange={e=>setNextStep(e.target.value)} placeholder="Specific actions planned…" rows={3} style={ta}/></TpField>
          </>}
          {type==="meeting"&&<>
            <TpField label="Attendees"><input value={attendees} onChange={e=>setAttendees(e.target.value)} placeholder="Names of everyone present" style={inp}/></TpField>
            <TpField label="Location"><input value={location} onChange={e=>setLocation(e.target.value)} style={inp}/></TpField>
            <TpField label="Key Takeaway 1"><textarea value={kt1} onChange={e=>setKt1(e.target.value)} rows={2} style={ta}/></TpField>
            <TpField label="Key Takeaway 2"><textarea value={kt2} onChange={e=>setKt2(e.target.value)} rows={2} style={ta}/></TpField>
            <TpField label="Key Takeaway 3"><textarea value={kt3} onChange={e=>setKt3(e.target.value)} rows={2} style={ta}/></TpField>
            <TpField label="Donor Sentiment">
              <select value={sentiment} onChange={e=>setSentiment(e.target.value)} style={{...inp,cursor:"pointer"}}>
                {["Enthusiastic","Positive","Neutral","Hesitant"].map(s=><option key={s}>{s}</option>)}
              </select>
            </TpField>
            <TpField label="Spouse / Partner"><input value={spouse} onChange={e=>setSpouse(e.target.value)} placeholder="Name and relevant details" style={inp}/></TpField>
            <TpField label="Donor History & Background"><textarea value={history} onChange={e=>setHistory(e.target.value)} placeholder="Past relationship, context…" rows={3} style={ta}/></TpField>
            <TpField label="Asks Made"><textarea value={asksMade} onChange={e=>setAsksMade(e.target.value)} rows={2} style={ta}/></TpField>
            <TpField label="Next Steps"><textarea value={nextStep} onChange={e=>setNextStep(e.target.value)} placeholder="Specific actions planned…" rows={3} style={ta}/></TpField>
          </>}
          {type==="email"&&<>
            <TpField label="Subject"><input value={subject} onChange={e=>setSubject(e.target.value)} style={inp}/></TpField>
            <TpField label="Summary"><textarea value={summary} onChange={e=>setSummary(e.target.value)} rows={4} style={ta}/></TpField>
            <TpField label="Response Received?"><TpYesNo val={responded} set={setResponded}/></TpField>
            <TpField label="Donor History & Background"><textarea value={history} onChange={e=>setHistory(e.target.value)} placeholder="Context for this outreach…" rows={3} style={ta}/></TpField>
            <TpField label="Next Steps"><textarea value={nextStep} onChange={e=>setNextStep(e.target.value)} placeholder="Specific actions planned…" rows={3} style={ta}/></TpField>
          </>}
          {type==="event"&&<>
            <TpField label="Event">
              {orgEvents.length>0?(
                <select value={eventName} onChange={e=>setEventName(e.target.value)} style={{...inp,cursor:"pointer"}}>
                  <option value="">— select event or type below —</option>
                  {orgEvents.map(ev=><option key={ev.id} value={ev.name}>{ev.name}</option>)}
                </select>
              ):<input value={eventName} onChange={e=>setEventName(e.target.value)} placeholder="Event name" style={inp}/>}
            </TpField>
            {orgEvents.length>0&&<TpField label="Event Name (or override)"><input value={eventName} onChange={e=>setEventName(e.target.value)} placeholder="Custom event name" style={inp}/></TpField>}
            <TpField label="Donor Attended?"><TpYesNo val={attended} set={setAttended}/></TpField>
            <TpField label="Interactions & Observations"><textarea value={observations} onChange={e=>setObservations(e.target.value)} rows={4} style={ta}/></TpField>
            <TpField label="Donor History & Background"><textarea value={history} onChange={e=>setHistory(e.target.value)} rows={3} style={ta}/></TpField>
            <TpField label="Next Steps"><textarea value={nextStep} onChange={e=>setNextStep(e.target.value)} placeholder="Specific actions planned…" rows={3} style={ta}/></TpField>
          </>}
          {type==="gift"&&<>
            <TpField label="Amount"><input type="text" value={amount} onChange={e=>setAmount(e.target.value)} placeholder="e.g. 5,000" style={inp}/></TpField>
            <TpField label="Designation">
              <input value={designation} onChange={e=>setDesignation(e.target.value)} placeholder="e.g. General Operating, Arts Education…" style={inp}/>
              <div style={fieldHint}>What the donor said it's for (free text). To count it toward a goal, pick a Campaign below.</div>
              {campaignSuggestion&&<button type="button" onClick={()=>setCampaignId(campaignSuggestion.id)} style={{marginTop:6,background:T.gold100||"#f6eccf",border:"1px solid "+(T.gold500||"#c9a84c"),borderRadius:7,padding:"5px 10px",color:T.ink,fontSize:12,fontWeight:600,cursor:"pointer",textAlign:"left"}}>Did you mean the campaign “{campaignSuggestion.name}”? <span style={{color:T.greenDk||"#0d5c3a",fontWeight:700}}>Attribute →</span></button>}
            </TpField>
            {finCampaigns.length>0&&<TpField label="Campaign">
              <select value={campaignId} onChange={e=>setCampaignId(e.target.value)} style={{...inp,cursor:"pointer"}}>
                <option value="">— not attributed —</option>
                {finCampaigns.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <div style={fieldHint}>Which goal this counts toward — updates that campaign's thermometer live.</div>
            </TpField>}
            <TpField label="Payment Method"><input value={payMethod} onChange={e=>setPayMethod(e.target.value)} placeholder="Check, ACH, Credit Card, Stock…" style={inp}/></TpField>
            <TpField label="Acknowledgement Sent?"><TpYesNo val={ackSent} set={setAckSent}/></TpField>
            {finFunds.length>0&&<TpField label="Finance Fund">
              <select value={finFundId} onChange={e=>setFinFundId(e.target.value)} style={{...inp,cursor:"pointer"}}>
                <option value="">— no fund —</option>
                {finFunds.map(f=><option key={f.id} value={f.id}>{f.name}{f.restricted?" (Restricted)":""}</option>)}
              </select>
              <div style={fieldHint}>Which ledger fund it posts to in Finance.</div>
            </TpField>}
            <TpField label="Next Steps"><textarea value={nextStep} onChange={e=>setNextStep(e.target.value)} placeholder="Specific actions planned…" rows={3} style={ta}/></TpField>
          </>}
          {type==="other"&&<>
            <TpField label="Notes"><textarea value={otherNotes} onChange={e=>setOtherNotes(e.target.value)} rows={5} style={ta}/></TpField>
            <TpField label="Donor History & Background"><textarea value={history} onChange={e=>setHistory(e.target.value)} placeholder="Past relationship, context…" rows={3} style={ta}/></TpField>
            <TpField label="Spouse / Partner"><input value={spouse} onChange={e=>setSpouse(e.target.value)} placeholder="Name and relevant details" style={inp}/></TpField>
            <TpField label="Next Steps"><textarea value={nextStep} onChange={e=>setNextStep(e.target.value)} placeholder="Specific actions planned…" rows={3} style={ta}/></TpField>
          </>}
        </div>
        <div style={{display:"flex",gap:8}}>
          <button onClick={save} disabled={loading||!canSave} style={{flex:1,background:canSave?"#0d5c3a":T.bg2,border:"none",borderRadius:10,padding:"12px",color:"#fff",fontSize:14,fontWeight:700,cursor:canSave?"pointer":"not-allowed"}}>{loading?"Saving…":"Save Touchpoint"}</button>
          <button onClick={onClose} style={{background:T.bg,border:"none",borderRadius:10,padding:"12px 16px",color:T.ink3,fontSize:13,cursor:"pointer"}}>Cancel</button>
        </div>
      </div>
    </Modal>
  );
}

// ── Edit Donor Modal ───────────────────────────────────────────────────────
function EditDonorModal({donor,onSave,onClose}){
  const inp={width:"100%",background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"9px 12px",color:T.ink,fontSize:13,outline:"none",fontFamily:"inherit",boxSizing:"border-box"};
  const[form,setForm]=useState({
    name:donor.name||"",email:donor.email||"",phone:donor.phone||"",
    notes:donor.notes||"",tags:(donor.tags||[]).join(", "),
    stage:donor.stage||"cultivate",status:donor.status||"new",
    city:donor.city||"",state:donor.state||"",zip:donor.zip||"",
    employer:donor.employer||"",
  });
  const[loading,setLoading]=useState(false);
  const[err,setErr]=useState("");
  const set=k=>e=>setForm(p=>({...p,[k]:e.target.value}));

  const save=async()=>{
    if(!form.name.trim()){setErr("Name is required");return;}
    setLoading(true);setErr("");
    try{
      const tags=form.tags.split(",").map(t=>t.trim()).filter(Boolean);
      const res=await apiFetch(`/donors/${donor.id}`,{method:"PUT",body:JSON.stringify({...form,tags})});
      onSave(res);
    }catch(e){setErr(errorMessage(e, "Failed to save"));}
    setLoading(false);
  };

  return(
    <Modal onClose={onClose} width={480} zIndex={400} backdrop="#000c" blur={false} padding={28}
      ariaLabel="Edit donor profile" dialogStyle={{borderRadius:20,border:"1px solid "+T.bg3}}>
      <div>
        <div style={{fontSize:18,fontWeight:800,color:T.ink,marginBottom:4}}>Edit Donor Profile</div>
        <div style={{fontSize:12,color:T.ink3,marginBottom:20}}>{donor.name}</div>
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          {[["name","Full Name","text"],["email","Email","email"],["phone","Phone","tel"],["employer","Employer","text"]].map(([k,pl,t])=>(
            <input key={k} type={t} value={form[k]} onChange={set(k)} placeholder={pl} style={inp}/>
          ))}
          <div style={{display:"flex",gap:8}}>
            <input value={form.city} onChange={set("city")} placeholder="City" style={{...inp,flex:2}}/>
            <input value={form.state} onChange={set("state")} placeholder="State" style={{...inp,flex:1}}/>
            <input value={form.zip} onChange={set("zip")} placeholder="ZIP" style={{...inp,flex:1}}/>
          </div>
          <div>
            <div style={{fontSize:11,fontWeight:700,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:8}}>Stage</div>
            <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
              {STAGES.map(s=>(
                <button key={s.id} onClick={()=>setForm(p=>({...p,stage:s.id}))}
                  style={{background:form.stage===s.id?s.color+"22":T.bg,border:`1px solid ${form.stage===s.id?s.color:T.bg3}`,borderRadius:7,padding:"5px 11px",color:form.stage===s.id?s.color:T.ink3,fontSize:12,fontWeight:600,cursor:"pointer"}}>
                  {s.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div style={{fontSize:11,fontWeight:700,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:6}}>Tags <span style={{fontSize:10,fontWeight:400,textTransform:"none"}}>(comma-separated)</span></div>
            <input value={form.tags} onChange={set("tags")} placeholder="e.g. board-adjacent, recurring, arts" style={inp}/>
          </div>
          <div>
            <div style={{fontSize:11,fontWeight:700,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:6}}>Notes</div>
            <textarea value={form.notes} onChange={set("notes")} rows={3} style={{...inp,resize:"vertical",lineHeight:1.5}}/>
          </div>
          {err&&<div style={{color:"#b8593f",fontSize:12}}>{err}</div>}
          <div style={{display:"flex",gap:8,marginTop:4}}>
            <button onClick={save} disabled={loading} style={{flex:1,background:loading?T.bg2:"#0d5c3a",border:"none",borderRadius:10,padding:"11px",color:"#fff",fontSize:14,fontWeight:700,cursor:loading?"not-allowed":"pointer"}}>
              {loading?"Saving…":"Save Changes"}
            </button>
            <button onClick={onClose} style={{background:T.bg,border:"none",borderRadius:10,padding:"11px 14px",color:T.ink3,fontSize:13,cursor:"pointer"}}>Cancel</button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ── Gift Link Modal ────────────────────────────────────────────────────────
function GiftLinkModal({donor,orgName,onClose}){
  const[url,setUrl]=useState("");
  const[loading,setLoading]=useState(true);
  const[err,setErr]=useState("");
  const[copied,setCopied]=useState(false);
  const[showEmail,setShowEmail]=useState(false);
  const[emailSubject,setEmailSubject]=useState(`A quick way to give to ${orgName}`);
  const[emailBody,setEmailBody]=useState(
    `<p>Hi ${donor.name.split(" ")[0]},</p>\n<p>Thank you so much for your continued support of ${orgName}. Your generosity makes our work possible.</p>\n<p>If you'd like to make a gift online, we've made it simple:</p>\n<p><a href="PAYMENT_LINK">Give now →</a></p>\n<p>It only takes a moment, and every gift goes directly to our programs. Thank you for everything you do for our mission.</p>\n<p>With gratitude,<br>The ${orgName} Team</p>`
  );
  const[sending,setSending]=useState(false);
  const[sent,setSent]=useState(false);
  const[sendErr,setSendErr]=useState("");

  useEffect(()=>{
    apiFetch("/stripe/donation-page",{method:"POST",body:JSON.stringify({donorName:donor.name,donorEmail:donor.email})})
      .then(r=>{setUrl(r.url);setEmailBody(b=>b.replace("PAYMENT_LINK",r.url));})
      .catch(e=>setErr(errorMessage(e, "Could not create payment link")))
      .finally(()=>setLoading(false));
  },[]);

  const copyLink=()=>{
    if(!url)return;
    navigator.clipboard.writeText(url).then(()=>{setCopied(true);setTimeout(()=>setCopied(false),2500);});
  };

  const sendEmail=async()=>{
    if(!donor.email){setSendErr("This donor has no email address.");return;}
    setSending(true);setSendErr("");
    try{
      const seg={mode:"manual",donorIds:[donor.id]};
      const created=await apiFetch("/campaigns",{method:"POST",body:JSON.stringify({
        name:`Gift request — ${donor.name}`,subject:emailSubject,body:emailBody,segment:seg,status:"draft"
      })});
      await apiFetch(`/campaigns/${created.id}/send`,{method:"POST"});
      setSent(true);
    }catch(e){setSendErr(errorMessage(e, "Failed to send email"));}
    setSending(false);
  };

  const inp={width:"100%",boxSizing:"border-box",background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"9px 12px",color:T.ink,fontSize:13,outline:"none",fontFamily:"inherit"};

  return(
    <Modal onClose={onClose} width={480} zIndex={500} blur={false} padding={24}
      ariaLabel="Request a gift" dialogStyle={{border:"1px solid "+T.bg3}}>
      <div>
        {!showEmail?(
          <>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
              <div>
                <div style={{fontSize:16,fontWeight:800,color:T.ink}}>Request Gift</div>
                <div style={{fontSize:12,color:T.ink3,marginTop:2}}>For {donor.name}</div>
              </div>
              <button onClick={onClose} style={{background:"none",border:"none",fontSize:20,cursor:"pointer",color:T.ink3}}>×</button>
            </div>
            {loading&&<div style={{padding:"24px 0",textAlign:"center",color:T.ink3,fontSize:13}}>Generating payment link…</div>}
            {err&&<div style={{color:"#8a3a24",fontSize:13,background:"#f6e3dd",border:"1px solid #eac6b8",borderRadius:8,padding:"10px 12px",marginBottom:14}}>{err}</div>}
            {url&&!loading&&(
              <>
                {/* Labeled link pattern — never a raw URL as visible text */}
                <div style={{display:"flex",gap:10,marginBottom:12}}>
                  <a href={url} target="_blank" rel="noreferrer"
                    style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",background:T.bg,border:"1px solid "+T.bg3,borderRadius:10,padding:"11px",color:T.ink2,fontSize:13,fontWeight:700,textDecoration:"none"}}>
                    Open link ↗
                  </a>
                  <button onClick={copyLink} style={{flex:1,background:copied?T.greenDk:T.bg,border:"1px solid "+(copied?T.greenDk:T.bg3),borderRadius:10,padding:"11px",color:copied?"#fff":T.ink2,fontSize:13,fontWeight:700,cursor:"pointer",transition:"all 0.15s"}}>
                    {copied?"✓ Copied!":"Copy Link"}
                  </button>
                </div>
                {donor.email&&<button onClick={()=>setShowEmail(true)} style={{width:"100%",background:T.greenDk,border:"none",borderRadius:10,padding:"11px",color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer"}}>
                  ✉ Send via Email
                </button>}
              </>
            )}
          </>
        ):(
          <>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
              <div>
                <div style={{fontSize:16,fontWeight:800,color:T.ink}}>Send via Email</div>
                <div style={{fontSize:12,color:T.ink3,marginTop:2}}>To: {donor.email}</div>
              </div>
              <button onClick={()=>setShowEmail(false)} style={{background:"none",border:"none",fontSize:13,cursor:"pointer",color:T.ink3}}>← Back</button>
            </div>
            {sent?(
              <div style={{textAlign:"center",padding:"20px 0"}}>
                <div style={{fontSize:28,marginBottom:10}}>✓</div>
                <div style={{fontSize:15,fontWeight:700,color:T.ink,marginBottom:6}}>Email sent!</div>
                <div style={{fontSize:13,color:T.ink3,marginBottom:20}}>Your message to {donor.name} has been sent.</div>
                <button onClick={onClose} style={{background:T.greenDk,border:"none",borderRadius:10,padding:"11px 24px",color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer"}}>Done</button>
              </div>
            ):(
              <>
                <div style={{display:"flex",flexDirection:"column",gap:12,marginBottom:16}}>
                  <div>
                    <div style={{fontSize:11,fontWeight:700,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:5}}>Subject</div>
                    <input value={emailSubject} onChange={e=>setEmailSubject(e.target.value)} style={inp}/>
                  </div>
                  <div>
                    <div style={{fontSize:11,fontWeight:700,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:5}}>Message</div>
                    <textarea value={emailBody} onChange={e=>setEmailBody(e.target.value)} rows={8}
                      style={{...inp,resize:"vertical",lineHeight:1.55,fontSize:12}}/>
                  </div>
                </div>
                {sendErr&&<div style={{color:"#8a3a24",fontSize:13,background:"#f6e3dd",border:"1px solid #eac6b8",borderRadius:8,padding:"8px 12px",marginBottom:12}}>{sendErr}</div>}
                <div style={{display:"flex",gap:8}}>
                  <button onClick={sendEmail} disabled={sending} style={{flex:1,background:sending?T.bg3:T.greenDk,border:"none",borderRadius:10,padding:"11px",color:"#fff",fontSize:13,fontWeight:700,cursor:sending?"not-allowed":"pointer"}}>
                    {sending?"Sending…":"Send Email"}
                  </button>
                  <button onClick={()=>setShowEmail(false)} style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:10,padding:"11px 14px",color:T.ink3,fontSize:13,cursor:"pointer"}}>Cancel</button>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

// ── Donor Profile ──────────────────────────────────────────────────────────
// ── BUILD-95 — ADJUST IT BEFORE IT SETS ────────────────────────────────────
// The first version took whatever the file was and let the server centre-crop
// it. That is fine for a logo and wrong for a face: a phone photo is portrait,
// the head is rarely in the middle, and "upload and hope" is not how anybody
// has set a profile picture since about 2010.
//
// So: drag to move, pinch or scroll or drag the slider to zoom, and the circle
// is exactly what will be saved. The crop happens HERE, to a 512 square canvas,
// so what she positioned is byte-for-byte what the server stores — the server
// still cover-resizes, but on an already-square image that is a no-op rather
// than a second opinion about where the face is.
const PHOTO_CROP_PX = 512;
function PhotoAdjuster({ file, onCancel, onSet }) {
  const [img, setImg] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [off, setOff] = useState({ x: 0, y: 0 });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const drag = useRef(null);
  const BOX = 300;                       // the circle's diameter on screen

  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    const i = new Image();
    i.onload = () => {
      // Start at the smallest zoom that still FILLS the circle — never a gap.
      setImg(i); setZoom(1); setOff({ x: 0, y: 0 });
    };
    i.onerror = () => setErr("That file could not be opened as an image.");
    i.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // The scale at which the image exactly covers the circle. Everything else is
  // a multiple of this, so zoom=1 can never show background through the mask.
  const cover = img ? Math.max(BOX / img.width, BOX / img.height) : 1;
  const scale = cover * zoom;
  const dispW = img ? img.width * scale : 0;
  const dispH = img ? img.height * scale : 0;

  // Never let the image be dragged off the circle.
  const clamp = (o, s = scale) => {
    if (!img) return o;
    const maxX = Math.max(0, (img.width * s - BOX) / 2);
    const maxY = Math.max(0, (img.height * s - BOX) / 2);
    return { x: Math.max(-maxX, Math.min(maxX, o.x)), y: Math.max(-maxY, Math.min(maxY, o.y)) };
  };
  useEffect(() => { setOff(o => clamp(o)); }, [zoom, img]);

  const onDown = e => {
    const p = e.touches ? e.touches[0] : e;
    drag.current = { x: p.clientX, y: p.clientY, ox: off.x, oy: off.y };
  };
  const onMove = e => {
    if (!drag.current) return;
    if (e.cancelable) e.preventDefault();
    const p = e.touches ? e.touches[0] : e;
    setOff(clamp({ x: drag.current.ox + (p.clientX - drag.current.x), y: drag.current.oy + (p.clientY - drag.current.y) }));
  };
  const onUp = () => { drag.current = null; };
  useEffect(() => {
    window.addEventListener("mousemove", onMove); window.addEventListener("mouseup", onUp);
    window.addEventListener("touchmove", onMove, { passive: false }); window.addEventListener("touchend", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp);
      window.removeEventListener("touchmove", onMove); window.removeEventListener("touchend", onUp);
    };
  });

  const set = async () => {
    if (!img) return;
    setBusy(true); setErr("");
    try {
      // The SAME transform, at output resolution. The circle on screen is a
      // BOX-wide window onto the scaled image; the canvas is the same window
      // at PHOTO_CROP_PX, so the ratio is the only thing that changes.
      const k = PHOTO_CROP_PX / BOX;
      const c = document.createElement("canvas");
      c.width = PHOTO_CROP_PX; c.height = PHOTO_CROP_PX;
      const ctx = c.getContext("2d");
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img,
        (PHOTO_CROP_PX / 2) + (off.x - dispW / 2) * k,
        (PHOTO_CROP_PX / 2) + (off.y - dispH / 2) * k,
        dispW * k, dispH * k);
      // JPEG, not PNG: a photo as PNG is several megabytes for no benefit, and
      // the server re-encodes to WebP anyway.
      await onSet(c.toDataURL("image/jpeg", 0.92));
    } catch (e) { setErr(errorMessage(e, "Could not save that photo")); }
    setBusy(false);
  };

  return (
    <Modal onClose={busy ? () => {} : onCancel} title="Position the photo" width={380}>
      <div style={{ fontSize: 12.5, color: T.ink3, lineHeight: 1.55, marginBottom: 14 }}>
        Drag to move it. Scroll or use the slider to zoom. What you see in the circle is what is saved.
      </div>
      <div
        onMouseDown={onDown} onTouchStart={onDown}
        onWheel={e => { setZoom(z => Math.max(1, Math.min(4, z - e.deltaY * 0.0015))); }}
        style={{
          width: BOX, height: BOX, margin: "0 auto", borderRadius: "50%", overflow: "hidden",
          position: "relative", background: T.bg2, cursor: drag.current ? "grabbing" : "grab",
          touchAction: "none", border: `2px solid ${T.bg3}`,
        }}>
        {img && (
          <img src={img.src} alt="" draggable={false} data-testid="photo-adjust-image"
            style={{
              position: "absolute", left: "50%", top: "50%", width: dispW, height: dispH,
              transform: `translate(calc(-50% + ${off.x}px), calc(-50% + ${off.y}px))`,
              maxWidth: "none", userSelect: "none", pointerEvents: "none",
            }} />
        )}
      </div>
      <input type="range" min="1" max="4" step="0.01" value={zoom} aria-label="Zoom"
        data-testid="photo-adjust-zoom"
        onChange={e => setZoom(Number(e.target.value))}
        style={{ width: BOX, display: "block", margin: "16px auto 4px", accentColor: T.greenDk }} />
      {err && <div role="alert" style={{ fontSize: 12, color: T.gold700, textAlign: "center", marginBottom: 8 }}>{err}</div>}
      <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 14 }}>
        <button onClick={set} disabled={busy || !img} data-testid="photo-adjust-set"
          style={{ background: T.greenDk, border: "none", borderRadius: 10, padding: "11px 26px",
                   color: T.white, fontSize: 14, fontWeight: 800, cursor: busy ? "not-allowed" : "pointer", opacity: busy ? 0.6 : 1 }}>
          {busy ? "Saving…" : "Set photo"}
        </button>
        <button onClick={onCancel} disabled={busy}
          style={{ background: T.bg, border: `1px solid ${T.bg3}`, borderRadius: 10, padding: "11px 18px",
                   color: T.ink3, fontSize: 13, cursor: "pointer" }}>Cancel</button>
      </div>
    </Modal>
  );
}

// ── BUILD-94 Part 1 — the photo control on the profile header ──────────────
// Drop an image on the mark or click it to pick one. 10 MB, any common raster
// format; the server checks the bytes are what the file says they are, crops
// to a 512 square WebP and throws the original away. "Remove" appears on hover
// (and on focus, so it is reachable without a mouse) once there is a photo.
function DonorPhotoControl({donor,isReadOnly,photoUrl,onChanged}){
  const fileRef=useRef(null);
  const photoCtx=useContext(PhotoContext);
  const [busy,setBusy]=useState(false);
  const [dragOver,setDragOver]=useState(false);
  const [err,setErr]=useState("");
  const [hover,setHover]=useState(false);

  // BUILD-95 — a picked or dropped file opens the ADJUSTER rather than
  // uploading. Nothing reaches the server until she has said where the face
  // is. The size and type rules are still the SERVER's — the browser is not
  // where either is enforced, it is only where the framing is chosen.
  const [pending,setPending]=useState(null);
  const pick=(file)=>{
    setErr("");
    if(!file)return;
    if(!/^image\//.test(file.type||"")){setErr("That file isn't an image.");return;}
    setPending(file);
  };
  const send=async(dataUri)=>{
    setBusy(true);setErr("");
    try{
      const r=await apiFetch(`/donors/${donor.id}/photo`,{method:"POST",body:JSON.stringify({image:dataUri})});
      onChanged(r&&r.photoUrl||null);
      photoCtx.refresh&&photoCtx.refresh();
      setPending(null);
    }catch(e){setErr(errorMessage(e,"Could not save that photo"));throw e;}
    finally{setBusy(false);}
  };
  const remove=async()=>{
    setBusy(true);setErr("");
    try{
      await apiFetch(`/donors/${donor.id}/photo`,{method:"DELETE"});
      onChanged(null);
      photoCtx.refresh&&photoCtx.refresh();
    }catch(e){setErr(errorMessage(e,"Could not remove that photo"));}
    setBusy(false);
  };

  const label=photoUrl?`Change ${donor.name}'s photo`:`Add a photo for ${donor.name}`;
  return (
    <div style={{position:"relative",flexShrink:0}}
      onMouseEnter={()=>setHover(true)} onMouseLeave={()=>setHover(false)}>
      <button type="button" data-testid="donor-photo-drop" aria-label={label} title={isReadOnly?donor.name:label}
        disabled={isReadOnly||busy}
        onClick={()=>!isReadOnly&&fileRef.current&&fileRef.current.click()}
        onDragOver={e=>{if(isReadOnly)return;e.preventDefault();setDragOver(true);}}
        onDragLeave={()=>setDragOver(false)}
        onDrop={e=>{if(isReadOnly)return;e.preventDefault();setDragOver(false);pick(e.dataTransfer.files&&e.dataTransfer.files[0]);}}
        style={{padding:0,border:dragOver?`2px dashed ${T.gold500}`:"2px solid transparent",borderRadius:"50%",
          background:"none",cursor:isReadOnly?"default":"pointer",lineHeight:0,opacity:busy?0.6:1,display:"block"}}>
        <PersonMark id={donor.id} name={donor.name} kind={donor.kind} url={photoUrl} size={46}/>
      </button>
      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp" style={{display:"none"}}
        onChange={e=>{pick(e.target.files&&e.target.files[0]);e.target.value="";}}/>
      {pending&&<PhotoAdjuster file={pending} onCancel={()=>setPending(null)} onSet={send}/>}
      {photoUrl&&!isReadOnly&&(hover||busy)&&(
        <button type="button" onClick={remove} disabled={busy} data-testid="donor-photo-remove"
          aria-label={`Remove ${donor.name}'s photo`} title="Remove photo"
          style={{position:"absolute",top:-3,right:-3,width:18,height:18,borderRadius:"50%",border:`1px solid ${T.bg3}`,
            background:T.white,color:T.ink3,fontSize:11,lineHeight:"16px",padding:0,cursor:"pointer"}}>&times;</button>
      )}
      {err&&<div role="alert" style={{position:"absolute",top:40,left:0,whiteSpace:"nowrap",zIndex:5,fontSize:11,
        color:T.gold700,background:T.gold100,border:`1px solid ${T.gold300}`,borderRadius:6,padding:"3px 7px"}}>{err}</div>}
    </div>
  );
}

// ── BUILD-94 Part 2 — what this person IS, on the header ───────────────────
// A record that is only a Donor shows nothing: that is every record in the
// product until this build, and a badge that is always on is not a badge.
// Anything else says so, and clicking opens the picker — one person can be
// more than one (a volunteer who gives is both, on ONE record).
function PersonTypeChips({donor,isReadOnly}){
  const [types,setTypes]=useState(donor.personTypes||["donor"]);
  const [open,setOpen]=useState(false);
  const [busy,setBusy]=useState(false);
  useEffect(()=>{setTypes(donor.personTypes||["donor"]);},[donor.id,JSON.stringify(donor.personTypes||[])]);
  const save=async(next)=>{
    setBusy(true);
    const prev=types;
    setTypes(next);
    try{
      await apiFetch(`/donors/${donor.id}`,{method:"PUT",
        body:JSON.stringify({name:donor.name,email:donor.email,phone:donor.phone,status:donor.status,
          stage:donor.stage,tags:donor.tags,notes:donor.notes,personTypes:next})});
    }catch(e){setTypes(prev);alert(errorMessage(e,"Could not change this person's type"));}
    setBusy(false);
  };
  const toggle=(k)=>{
    const has=types.includes(k);
    const next=has?types.filter(t=>t!==k):[...types,k];
    // normalizeTypes floors an empty list at ["other"] server-side; say so here
    // rather than letting the screen and the row disagree for a moment.
    save(next.length?next:["other"]);
  };
  const shown=PERSON_TYPES.filter(t=>types.includes(t.key));
  const onlyDonor=types.length===1&&types[0]==="donor";
  return (
    <span style={{position:"relative",display:"inline-flex",alignItems:"center",gap:5}}>
      {!onlyDonor&&shown.map(t=>(
        <span key={t.key} data-testid="person-type-chip"
          style={{fontSize:10,fontWeight:800,padding:"3px 9px",borderRadius:99,
            background:T.bg2,color:T.ink2,border:`1px solid ${T.bg3}`}}>{t.label}</span>
      ))}
      {!isReadOnly&&(
        <button type="button" onClick={()=>setOpen(v=>!v)} data-testid="person-type-edit"
          aria-label="Change what this person is" title="Donor, volunteer, staff and board, other"
          style={{background:"none",border:"none",padding:"2px 4px",fontSize:11,color:T.ink3,cursor:"pointer",opacity:busy?0.5:1}}>
          {onlyDonor?"+ type":"⌄"}
        </button>
      )}
      {open&&(
        <span style={{position:"absolute",top:22,left:0,zIndex:20,background:T.white,border:`1px solid ${T.bg3}`,
          borderRadius:10,boxShadow:T.shadowMd,padding:"6px 4px",minWidth:170}}>
          {PERSON_TYPES.map(t=>(
            <label key={t.key} style={{display:"flex",alignItems:"center",gap:8,padding:"5px 10px",fontSize:12.5,color:T.ink,cursor:"pointer",whiteSpace:"nowrap"}}>
              <input type="checkbox" checked={types.includes(t.key)} disabled={busy}
                onChange={()=>toggle(t.key)} style={{accentColor:T.greenDk}}/>
              {t.label}
            </label>
          ))}
          <div style={{fontSize:10.5,color:T.ink3,padding:"4px 10px 2px",lineHeight:1.45,whiteSpace:"normal"}}>
            Someone who is not a donor stays out of giving totals, Drift, receipts and every count that reads donors.
          </div>
        </span>
      )}
    </span>
  );
}

function DonorProfile({donor,onClose,onStageChange,onLogTouchpoint,aiMap,loadingKey,getAI,isAdmin,onEdit,onDelete,tasks=[],onTaskToggle,onAddTask,orgName="",orgTeam=[],onReassign,onCfSaved,onInteractionAdded,isReadOnly=false,allDonors=[],onSelectRelatedDonor,onNavigate,initialOpenConversation=false,org=null}){
  const [gifts,setGifts]=useState([]);
  const [giftLoading,setGiftLoading]=useState(true);
  const [localInts,setLocalInts]=useState(null); // loaded lazily from GET /donors/:id
  const [sequences,setSequences]=useState([]);
  useEffect(()=>{apiFetch("/sequences").then(rows=>setSequences(Array.isArray(rows)?rows.filter(s=>s.status==="active"):[])).catch(()=>{});},[]);
  // ── BUILD-81 — the donor's THREAD, shown at the top of the record. One
  // open thread per donor: the last touch, the next step, days open. "Log a
  // conversation" is the primary action; the next-step prompt rides the same
  // flow and a skip is recorded as skipped.
  const [dpThread,setDpThread]=useState(null);
  const [dpItems,setDpItems]=useState([]);
  const [convoOpen,setConvoOpen]=useState(initialOpenConversation);
  const [planOpen,setPlanOpen]=useState(false);   // BUILD-85 — plan forward on this donor
  // BUILD-88a A.2 — EVERY OPEN ITEM FOR THIS DONOR, ranked by the one ranking.
  // The profile showed the thread and nothing else, so a task created by
  // "+ Add task", a pipeline move or a workflow recipe was an open promise to
  // this person that their own record did not mention.
  const loadDpThread=()=>apiFetch(`/threads?donorId=${donor.id}`).then(r=>{
    setDpItems(Array.isArray(r.list)?r.list:[]);
    setDpThread((r.list||[]).find(x=>x.kind!=="task")||null);
  }).catch(()=>{});
  useEffect(()=>{loadDpThread();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[donor.id]);

  // Related donors (household/spouse/family/employer_match) — manual
  // linking only, see server.js's donor_relationships routes.
  const [relationships,setRelationships]=useState([]);
  const [householdTotal,setHouseholdTotal]=useState(null);
  const [relLoading,setRelLoading]=useState(true);
  const [relPickerOpen,setRelPickerOpen]=useState(false);
  const [relSearch,setRelSearch]=useState("");
  const [relType,setRelType]=useState("spouse");
  const [relSaving,setRelSaving]=useState(false);
  const [relErr,setRelErr]=useState("");
  const loadRelationships=()=>{
    setRelLoading(true);
    apiFetch(`/donors/${donor.id}/relationships`)
      .then(r=>{setRelationships(r.relationships||[]);setHouseholdTotal(r.householdTotal??null);})
      .catch(()=>{setRelationships([]);setHouseholdTotal(null);})
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
    try{await apiFetch(`/donor-relationships/${relId}`,{method:"DELETE"});loadRelationships();}
    catch(e){console.error(e);}
  };
  const linkedIds=new Set(relationships.map(r=>r.relatedDonorId));
  const relPickerResults=relSearch.trim()
    ?allDonors.filter(d=>d.id!==donor.id&&!linkedIds.has(d.id)&&d.name.toLowerCase().includes(relSearch.trim().toLowerCase())).slice(0,8)
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
        date:new Date().toISOString().split("T")[0]
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
  const [dpTab,setDpTab]=useState("overview");
  const [dpMoreOpen,setDpMoreOpen]=useState(false); // BUILD-41: mobile overflow menu (Impact Summary / Edit)

  // Full gift data for Gifts & Pledges tab
  const [giftsFull,setGiftsFull]=useState([]);
  const [giftEditId,setGiftEditId]=useState(null);
  const [giftEditForm,setGiftEditForm]=useState({});
  const [addGiftForm,setAddGiftForm]=useState({amount:"",date:new Date().toISOString().split("T")[0],type:"cash",payment_method:"",notes:"",fund_id:"",acknowledgement_sent:false,pledgeId:""});
  const [giftErr,setGiftErr]=useState("");
  const [giftMoreOpen,setGiftMoreOpen]=useState(false);
  // BUILD-45 §1.1 F-3 — idempotency key minted lazily per submit attempt and
  // cleared only on SUCCESS: a double-tap (or retry after a network error)
  // replays the same key and the server records exactly one gift.
  const addGiftIdemRef=useRef(null);
  const addPledgeIdemRef=useRef(null);   // BUILD-72 Part 2 — pledge double-tap guard
  const [addGiftOpen,setAddGiftOpen]=useState(false);
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
  const [pledges,setPledges]=useState([]);
  const [pledgeForm,setPledgeForm]=useState({amount:"",dueDate:new Date().toISOString().split("T")[0],notes:"",campaignId:""});
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
  const [stwForm,setStwForm]=useState({type:"thank_you",detail:"",date:new Date().toISOString().split("T")[0],note:""});
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
  const refreshSoftCredit=()=>apiFetch(`/donors/${donor.id}/soft-credit`).then(sc=>{
    setSoftCredit(sc);
    if(sc&&sc.householdId)apiFetch(`/households/${sc.householdId}`).then(setHousehold).catch(()=>setHousehold(null));
    else setHousehold(null);
  }).catch(()=>{setSoftCredit(null);setHousehold(null);});
  // Pipeline: moves history + ask/gift opportunities (BUILD-15, Team plan)
  const [moves,setMoves]=useState([]);
  const [opps,setOpps]=useState([]);
  const [planTier,setPlanTier]=useState("core");
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
    if(planTier==="team"){
      // Logs a move (from original stage → toStage) with the signal as its
      // description. Core → this route 403s, so the PATCH below carries it.
      try{ await apiFetch(`/pipeline/${donor.id}/move`,{method:"POST",body:JSON.stringify({toStage:sug.toStage,description:`Accepted suggestion — ${sug.reason}`})}); }catch(_){}
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
    apiFetch("/portfolio/officers").then(r=>setPlanTier(r?.tier||"core")).catch(()=>{});
  },[donor.id]);
  const isTeam=planTier==="team";
  // Donor-profile Core/Team split (FIX): the CRM core stays fully available to
  // Core; only the major-gifts LAYER (moves & asks, move-stage, wealth score,
  // suggested actions, sequences, reassign) is Team. `lockMajor` reuses the ONE
  // shared LockedFeature wrapper (same treatment as the Pipeline tab / BUILD-20)
  // — Core sees the real panel with its own data behind frosted glass + an
  // "Unlock with Team" CTA; writes stay server-gated (requirePlan('team')→403).
  // A plain function (not a `<Component>`) so Team never remounts the subtree.
  const lockMajor=(children,opts={})=>isTeam?children:(
    <LockedFeature title={opts.title||"A Team-plan feature"} blurb={opts.blurb} minHeight={opts.minHeight||220}
      onCta={goToPricing}>{children}</LockedFeature>
  );
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
      if(remaining.length<2)await apiFetch(`/households/${household.id}`,{method:"DELETE"});
      else await apiFetch(`/households/${household.id}`,{method:"PUT",body:JSON.stringify({memberIds:remaining})});
      setHousehold(null);refreshSoftCredit();
    }catch(e){alert(errorMessage(e, "Could not update household"));}
  };

  // Tax receipts — per-gift status + whether the org has receipts enabled
  // at all (governs whether "Send receipt" is even offered, vs. a setup
  // nudge). See CLAUDE.md "Tax receipting."
  const [donorReceipts,setDonorReceipts]=useState([]);
  const [receiptsEnabled,setReceiptsEnabled]=useState(false);
  const [receiptBusyId,setReceiptBusyId]=useState(null);
  const loadDonorReceipts=()=>apiFetch(`/donors/${donor.id}/receipts`).then(r=>setDonorReceipts(r||[])).catch(()=>setDonorReceipts([]));
  useEffect(()=>{
    loadDonorReceipts();
    apiFetch("/org").then(o=>setReceiptsEnabled(!!o.receipts_enabled)).catch(()=>{});
  },[donor.id]);

  const receiptForGift=giftId=>donorReceipts.find(r=>r.gift_id===giftId&&!r.voided_at);

  const sendReceipt=async giftId=>{
    setReceiptBusyId(giftId);
    try{
      await apiFetch(`/gifts/${giftId}/receipt`,{method:"POST"});
      await loadDonorReceipts();
    }catch(e){alert(errorMessage(e, "Could not send receipt"));}
    setReceiptBusyId(null);
  };

  const downloadReceiptPdf=async(receiptId,filenameHint)=>{
    try{
      const resp=await fetch(`${API}/receipts/${receiptId}/pdf`,{headers:{Authorization:`Bearer ${getToken()}`}});
      if(!resp.ok)throw new Error("Could not download receipt");
      const blob=await resp.blob();
      const url=URL.createObjectURL(blob);
      const a=document.createElement("a");a.href=url;a.download=`${filenameHint}.pdf`;
      document.body.appendChild(a);a.click();document.body.removeChild(a);URL.revokeObjectURL(url);
    }catch(e){alert(errorMessage(e, "Could not download receipt"));}
  };

  const [showYearEnd,setShowYearEnd]=useState(false);
  const [yearEndYear,setYearEndYear]=useState(String(new Date().getFullYear()-1));
  const [yearEndBusy,setYearEndBusy]=useState(false);
  const [yearEndErr,setYearEndErr]=useState("");
  const sendYearEndStatement=async()=>{
    setYearEndBusy(true); setYearEndErr("");
    try{
      await apiFetch(`/donors/${donor.id}/year-end-statement`,{method:"POST",body:JSON.stringify({year:parseInt(yearEndYear,10),send:true})});
      await loadDonorReceipts();
      setShowYearEnd(false);
    }catch(e){setYearEndErr(errorMessage(e, "Could not generate statement"));}
    setYearEndBusy(false);
  };

  const loadGiftsFull=()=>{
    apiFetch(`/donors/${donor.id}`).then(raw=>{
      const g=(raw.gifts||[]).map(g=>({
        id:g.id,amount:parseFloat(g.amount)||0,date:g.date||g.created_at?.split("T")[0],
        type:g.type||"cash",campaign:g.campaign||"",notes:g.notes||"",
        fund_id:g.fund_id||"",payment_method:g.payment_method||"",
        acknowledgement_sent:!!g.acknowledgement_sent,
      }));
      setGiftsFull(g);
      setGifts(g.map(x=>({amount:x.amount,date:x.date})));
      setGiftLoading(false);
      // Capture full interactions from the profile fetch so the timeline works
      // without the list endpoint needing to embed them.
      if(raw.interactions) setLocalInts(raw.interactions.map(i=>({
        ...i, date:i.date||i.created_at?.split("T")[0], note:i.note||"",
      })));
    }).catch(()=>setGiftLoading(false));
  };

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
      await apiFetch(`/interactions/${int.id}`,{method:"DELETE"});
    }catch(e){
      loadGiftsFull();
      alert("Could not delete this entry: "+(errorMessage(e, "unknown error")));
    }
  };

  const saveStewardship=async()=>{
    if(!stwForm.type)return;
    setStwSaving(true);
    try{
      await apiFetch(`/donors/${donor.id}/interactions`,{method:"POST",body:JSON.stringify({
        type:"stewardship",
        note:`${stwForm.type.replace(/_/g," ")}${stwForm.detail?" — "+stwForm.detail:""}${stwForm.note?"\n"+stwForm.note:""}`,
        date:stwForm.date,
        metadata:{stewardship_type:stwForm.type,detail:stwForm.detail},
      })});
      setStwOpen(false);
      setStwForm({type:"thank_you",detail:"",date:new Date().toISOString().split("T")[0],note:""});
      if(onInteractionAdded)onInteractionAdded();
    }catch(e){console.error(e);}
    setStwSaving(false);
  };

  const stage=STAGES.find(s=>s.id===(donor.stage||"cultivate"))||STAGES[2];
  const sc=donorScore(donor);const scoreColor=sc>70?"#0d5c3a":sc>45?"#a97f22":"#b8593f";
  const urg=moveUrgency(donor);

  const interactionCount=donor.interactions?.length||0;
  useEffect(()=>{
    setGiftLoading(true);
    loadGiftsFull();
    loadPlannedGifts();
    loadPledges();
  },[donor.id,interactionCount]);

  useEffect(()=>{
    if(dpTab==="materials")loadMaterials();
    if(dpTab==="funds"&&!fundAffinity)loadFundAffinity();
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
    setGiftSaving(true);
    try{
      const {customFields,...core}=giftEditForm;
      await apiFetch(`/gifts/${giftId}`,{method:"PUT",body:JSON.stringify(core)});
      if(customFields&&giftCfDefs.length){
        // through the ONE seam — a refused value names its reason
        await apiFetch(`/gifts/${giftId}/custom-fields`,{method:"PUT",body:JSON.stringify({values:customFields})});
      }
      loadGiftsFull();
      setGiftEditId(null);
    }catch(e){alert(e?.errors?.[0]?.error||errorMessage(e, "That value was refused"));}
    setGiftSaving(false);
  };

  const deleteGift=async(giftId)=>{
    if(!confirm("Delete this gift?"))return;
    try{
      await apiFetch(`/gifts/${giftId}`,{method:"DELETE"});
      loadGiftsFull();
    }catch(e){console.error(e);}
  };

  // BUILD-98 Part 1 — a person named on the form is one of THIS org's
  // records, found by exact name. A name that is not on file is said out
  // loud rather than guessed at (an honouree is the exception: a memorial is
  // often for somebody who never gave, so their name alone is enough).
  const findByName=nm=>{const n=String(nm||"").trim().toLowerCase();if(!n)return null;const hits=allDonors.filter(d=>String(d.name||"").trim().toLowerCase()===n);return hits.length===1?hits[0]:null;};
  const giftExtrasBody=()=>{
    const f=addGiftForm,out={};
    if(f.scName){const p=findByName(f.scName);if(!p)throw new Error(`${f.scName} is not in your records. Add them first, then credit them.`);
      out.softCredits=[{donorId:p.id,role:"recommender",...(f.scAmount?{amount:Number(f.scAmount)}:{})}];}
    if(f.tribType&&f.tribName){const h=findByName(f.tribName);
      out.tribute={type:f.tribType,donorId:h?h.id:null,name:f.tribName,notifyName:f.tribNotify||null,notifyEmail:f.tribNotifyEmail||null};}
    if(f.matchEmployer){const e=findByName(f.matchEmployer);if(!e)throw new Error(`${f.matchEmployer} is not in your records. Add the employer first.`);
      out.match={employerId:e.id,...(f.matchAmount?{amount:Number(f.matchAmount)}:{})};}
    return out;
  };
  const addGift=async()=>{
    if(!addGiftForm.amount||isNaN(Number(addGiftForm.amount)))return;
    let extras;
    try{extras=giftExtrasBody();}catch(e){setGiftErr(e.message);return;}
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
        pledgeId:addGiftForm.pledgeId||undefined,
        idempotencyKey:addGiftIdemRef.current,
      })});
      addGiftIdemRef.current=null;
      setAddGiftOpen(false);
      setAddGiftForm({amount:"",date:new Date().toISOString().split("T")[0],type:"cash",payment_method:"",notes:"",fund_id:"",acknowledgement_sent:false,pledgeId:""});
      loadGiftsFull();
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
      setPledgeForm({amount:"",dueDate:new Date().toISOString().split("T")[0],notes:"",campaignId:""});
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
    if(!confirm("Delete this pledge? This cannot be undone."))return;
    try{
      await apiFetch(`/pledges/${id}`,{method:"DELETE"});
      loadPledges();
    }catch(e){console.error(e);}
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
    if(!confirm("Delete this planned gift entry?"))return;
    try{
      await apiFetch(`/planned-gifts/${id}`,{method:"DELETE"});
      loadPlannedGifts();
    }catch(e){console.error(e);}
  };

  const uploadMaterial=async(file)=>{
    setMatUploading(true);
    try{
      let file_data=null,file_url=null;
      if(file.size<1024*1024){
        const buf=await file.arrayBuffer();
        file_data=btoa(String.fromCharCode(...new Uint8Array(buf)));
      }
      await apiFetch(`/donors/${donor.id}/materials`,{method:"POST",body:JSON.stringify({
        file_name:file.name,file_type:file.type||"application/octet-stream",
        file_data,file_url,notes:matNote,
      })});
      setMatNote("");
      loadMaterials();
    }catch(e){console.error(e);}
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
    if(!confirm("Delete this file?"))return;
    try{
      await apiFetch(`/materials/${id}`,{method:"DELETE"});
      loadMaterials();
    }catch(e){console.error(e);}
  };

  const [impactPdfLoading,setImpactPdfLoading]=useState(false);
  // SHELVED — voice capture works but unproven adoption assumption, revisit
  // later. Code intact, re-enable by uncommenting.
  // const [showVoiceMemo,setShowVoiceMemo]=useState(false);
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

  useEffect(()=>{
    if(!aiMap[`${donor.id}_nextmove`])getAI(donor,"nextmove");
  },[donor.id]);

  const sortedGifts=[...gifts].sort((a,b)=>new Date(b.date)-new Date(a.date));
  const lastGiftDisplay=giftLoading?"…":sortedGifts.length>0?fmtFull(sortedGifts[0].amount):fmtFull(donor.lastAmount);

  return(
    <div className="fade-in fullscreen-takeover" style={{position:"fixed",top:52,left:0,right:0,bottom:0,background:T.bg,zIndex:200,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      {showGiftModal&&<GiftLinkModal donor={donor} orgName={orgName} onClose={()=>setShowGiftModal(false)}/>}
      {/* SHELVED — voice capture works but unproven adoption assumption, revisit later.
          Code intact, re-enable by uncommenting.
      {showVoiceMemo&&<VoiceMemoModal donor={donor} onClose={()=>setShowVoiceMemo(false)} onSaved={()=>{setShowVoiceMemo(false);if(onInteractionAdded)onInteractionAdded();}}/>}
      */}
      <div className="donor-profile-header" style={{background:T.white,borderBottom:"1px solid "+T.bg3,padding:"10px 24px",display:"flex",alignItems:"center",gap:12,flexShrink:0}}>
        <button onClick={onClose} className="dph-back" aria-label="Back to donors" style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"7px 14px",color:T.ink3,fontSize:13,cursor:"pointer",whiteSpace:"nowrap"}}>←<span className="dph-back-word"> Back</span></button>
        <div className="dph-identity" style={{display:"flex",alignItems:"center",gap:10,flex:1,minWidth:0}}>
          {/* BUILD-94 Part 1 — the face. Drop an image on it or click to pick
              one; the old mark was a stage-tinted first letter, which told you
              the stage twice (the pill beside it already says it) and told you
              nothing about the person. */}
          <DonorPhotoControl donor={donor} isReadOnly={isReadOnly} photoUrl={photoUrl} onChanged={setPhotoUrl}/>
          <div style={{minWidth:0}}>
            <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
              <span style={{fontSize:16,fontWeight:800,color:T.ink,letterSpacing:"-0.01em"}}>{donor.name}</span>
              <span style={{fontSize:10,fontWeight:700,padding:"3px 9px",borderRadius:99,background:stage.color+"22",color:stage.color}}>{stage.label}</span>
              {/* BUILD-94 Part 2 — what this person IS. A donor-only record
                  says nothing (that is every record, and a badge that is
                  always on is not a badge); a volunteer, a board member or an
                  untyped Mailchimp contact says so. */}
              <PersonTypeChips donor={donor} isReadOnly={isReadOnly}/>
              <DriftBadge drift={donor.drift}/>
              {/* BUILD-58 Part 2 — safety flags, visible where staff decide to reach out */}
              {donor.deceased&&<span title="No mail of any kind is sent to this donor" style={{fontSize:10,fontWeight:800,padding:"3px 9px",borderRadius:99,background:T.terra100,color:T.terra700,border:`1px solid ${T.terra200}`}}>Deceased</span>}
              {!donor.deceased&&donor.doNotContact&&<span title="Excluded from campaigns, sequences, and workflow emails" style={{fontSize:10,fontWeight:800,padding:"3px 9px",borderRadius:99,background:T.gold100,color:T.gold700,border:`1px solid ${T.gold300}`}}>Do not contact</span>}
              {!donor.deceased&&!donor.doNotContact&&donor.doNotSolicit&&<span title="No asks — excluded from the drift list, re-engage, suggested outreach, and ask automations. Stewardship thank-yous continue." style={{fontSize:10,fontWeight:800,padding:"3px 9px",borderRadius:99,background:T.gold100,color:T.gold700,border:`1px solid ${T.gold300}`}}>Do not solicit</span>}
              {donor.importedSustainer&&<span title={`Sustainer history from import — no payment authorization here yet${donor.importedSustainerAmount?` (was $${donor.importedSustainerAmount}/mo)`:""}. Send a reconnect link from Fundraising → Recurring.`} style={{fontSize:10,fontWeight:800,padding:"3px 9px",borderRadius:99,background:T.green100||"#edf3ee",color:T.greenDk,border:`1px solid ${T.green200||"#dce7df"}`}}>Sustainer · not reconnected</span>}
              <span style={{fontSize:11,color:T.ink3}}>{donor.email}</span>
            </div>
            <div className="dph-meta" style={{fontSize:11,color:T.ink3,marginTop:2,display:"flex",flexWrap:"wrap",gap:"0 4px"}}>
              <span style={{whiteSpace:"nowrap"}}>{fmtFull(donor.total)} lifetime</span>
              <span style={{whiteSpace:"nowrap"}}>·</span>
              <span style={{whiteSpace:"nowrap"}}>{donor.gifts} gifts</span>
            </div>
            {/* BUILD-76 — the drift reason, inline on the record (hover-only
                would hide the one sentence that explains the badge). */}
            {donor.drift&&<div style={{fontSize:11.5,color:T.gold600,fontWeight:600,marginTop:3,lineHeight:1.4}}>{donor.drift.reason}</div>}
            {/* BUILD-89S 89f — "Gives $50 monthly through PayPal" when the
                provider named it; "Looks like $50 monthly through PayPal"
                while it is still Steward's own reading of the pattern. One
                sentence, built server-side, shared with the dashboard. */}
            {donor.sourceRecurring&&(
              <div data-testid="donor-source-recurring"
                style={{fontSize:12,color:T.ink3,fontWeight:600,marginTop:3,lineHeight:1.4}}>
                {donor.sourceRecurring.phrase}
                {donor.sourceRecurring.confidence==="inferred"&&!donor.sourceRecurring.confirmed
                  ?<span style={{fontWeight:400}}> · nobody has confirmed it</span>:null}
              </div>
            )}
          </div>
        </div>
        {/* BUILD-41: Request Gift is THE action; Impact Summary/Edit collapse
            into a "⋯" overflow on phones (four buttons across 390px wrapped
            and misaligned). Delete left the top row entirely — a destructive
            action at thumb height beside Edit is a mis-tap waiting to happen;
            it now lives at the bottom of the Overview record (still behind
            the existing confirm). */}
        <div className="dph-actions" style={{display:"flex",gap:6,flexShrink:0,alignItems:"center",position:"relative"}}>
          {/* BUILD-88a A.4 — ONE EMERALD PRIMARY. The header carried two filled
              buttons in two different colours (a brass "Log a conversation" and
              an emerald "Request Gift"), so nothing on it was the obvious thing
              to press. Emerald means "this is the button" and exactly one thing
              may mean that; the rest are outlines. */}
          <button onClick={()=>setConvoOpen(true)} disabled={isReadOnly} className="dph-primary" data-testid="dp-primary" style={{background:T.greenDk,border:"none",borderRadius:8,padding:"7px 14px",color:"#fff",fontSize:13,fontWeight:800,cursor:isReadOnly?"not-allowed":"pointer",opacity:isReadOnly?0.5:1}}>
            Log a conversation
          </button>
          {/* BUILD-85 — plan forward. Offered only when there is NO open thread,
              because one open step per donor is the model and a second button
              that can only 409 is a button that teaches people to distrust
              buttons. */}
          {!dpThread&&<button onClick={()=>setPlanOpen(true)} disabled={isReadOnly} className="dph-desktop-act"
            style={{background:"transparent",border:"1px solid "+T.greenDk,borderRadius:8,padding:"7px 14px",color:T.greenDk,fontSize:13,fontWeight:700,cursor:isReadOnly?"not-allowed":"pointer",opacity:isReadOnly?0.5:1}}>
            Plan a follow-up
          </button>}
          <button onClick={()=>setShowGiftModal(true)} className="dph-desktop-act" style={{background:"transparent",border:"1px solid "+T.greenDk,borderRadius:8,padding:"7px 14px",color:T.greenDk,fontSize:13,fontWeight:700,cursor:"pointer"}}>
            Request Gift
          </button>
          {/* SHELVED — voice capture works but unproven adoption assumption, revisit later.
              Code intact, re-enable by uncommenting.
          <button onClick={()=>setShowVoiceMemo(true)} style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"7px 14px",color:T.ink3,fontSize:13,cursor:"pointer"}}>
            Voice memo
          </button>
          */}
          <button onClick={downloadImpactSummary} disabled={impactPdfLoading} className="dph-desktop-act" style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"7px 14px",color:T.ink3,fontSize:13,cursor:impactPdfLoading?"not-allowed":"pointer",opacity:impactPdfLoading?0.6:1}}>
            {impactPdfLoading?"Generating…":"↓ Impact Summary"}
          </button>
          <button onClick={onEdit} className="dph-desktop-act" style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"7px 14px",color:T.ink3,fontSize:13,cursor:"pointer"}}>Edit</button>
          <button onClick={()=>setDpMoreOpen(o=>!o)} className="dph-more" aria-label="More actions" aria-expanded={dpMoreOpen} style={{display:"none",background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,color:T.ink,fontSize:20,fontWeight:700,cursor:"pointer",lineHeight:1}}>⋯</button>
          {dpMoreOpen&&(
            <div className="dph-more-menu" style={{position:"absolute",top:"calc(100% + 6px)",right:0,zIndex:60,background:T.white,border:"1px solid "+T.bg3,borderRadius:10,boxShadow:"0 12px 32px rgba(15,26,18,0.18)",minWidth:200,overflow:"hidden"}}>
              <button onClick={()=>{setDpMoreOpen(false);downloadImpactSummary();}} disabled={impactPdfLoading} style={{display:"block",width:"100%",textAlign:"left",background:"none",border:"none",borderBottom:"1px solid "+T.bg3,padding:"13px 16px",color:T.ink,fontSize:14,fontWeight:600,cursor:"pointer"}}>
                {impactPdfLoading?"Generating…":"↓ Impact Summary"}
              </button>
              <button onClick={()=>{setDpMoreOpen(false);setShowGiftModal(true);}} style={{display:"block",width:"100%",textAlign:"left",background:"none",border:"none",borderBottom:"1px solid "+T.bg3,padding:"13px 16px",color:T.ink,fontSize:14,fontWeight:600,cursor:"pointer"}}>Request Gift</button>
              <button onClick={()=>{setDpMoreOpen(false);onEdit();}} style={{display:"block",width:"100%",textAlign:"left",background:"none",border:"none",padding:"13px 16px",color:T.ink,fontSize:14,fontWeight:600,cursor:"pointer"}}>Edit</button>
            </div>
          )}
          {convoOpen&&<LogConversationModal donor={{id:donor.id,name:donor.name}} thread={dpThread} org={org} onNavigate={onNavigate}
            onSaved={r=>{loadDpThread();if(onInteractionAdded)onInteractionAdded();setLocalInts(prev=>prev?[{id:r.interactionId,type:r.touch==="gift"?"gift":r.touch.startsWith("call")?"call":r.touch==="email"?"email":"meeting",note:r.line,date:r.date,metadata:null},...prev]:prev);}}
            onClose={()=>setConvoOpen(false)}/>}
          {planOpen&&<PlanFollowUpModal donor={{id:donor.id,name:donor.name}}
            onSaved={()=>loadDpThread()} onClose={()=>setPlanOpen(false)}/>}
        </div>
      </div>

      <div className="donor-profile-body" style={{flex:1,display:"grid",gridTemplateColumns:"minmax(0,1.25fr) minmax(0,0.75fr)",overflow:"hidden"}}>
        {/* LEFT */}
        <div style={{overflowY:"auto",borderRight:"1px solid "+T.bg3,display:"flex",flexDirection:"column"}}>
          {/* Tab Nav */}
          <div className="dp-tabs" style={{display:"flex",background:T.white,borderBottom:"1px solid "+T.bg3,flexShrink:0,overflowX:"auto"}}>
            {[["overview","Overview"],["gifts","Gifts & Pledges"],["funds","Funds"],["related","Related"],["materials","Materials"],["activity","Activity"]].map(([id,label])=>(
              <button key={id} onClick={()=>setDpTab(id)} style={{background:"none",border:"none",borderBottom:`2px solid ${dpTab===id?T.greenDk:"transparent"}`,padding:"11px 16px",color:dpTab===id?T.greenDk:T.ink3,fontSize:13,fontWeight:dpTab===id?700:400,cursor:"pointer",whiteSpace:"nowrap",flexShrink:0}}>
                {label}
                {id==="gifts"&&giftsFull.length>0&&<span style={{marginLeft:5,background:T.bg2,borderRadius:99,padding:"1px 6px",fontSize:10,fontWeight:700,color:T.ink3}}>{giftsFull.length}</span>}
                {id==="related"&&relationships.length>0&&<span style={{marginLeft:5,background:T.bg2,borderRadius:99,padding:"1px 6px",fontSize:10,fontWeight:700,color:T.ink3}}>{relationships.length}</span>}
                {id==="materials"&&materials.length>0&&<span style={{marginLeft:5,background:T.bg2,borderRadius:99,padding:"1px 6px",fontSize:10,fontWeight:700,color:T.ink3}}>{materials.length}</span>}
              </button>
            ))}
          </div>

          {/* Overview tab */}
          {dpTab==="overview"&&<div style={{padding:"22px 20px 24px 24px",display:"flex",flexDirection:"column",gap:18}}>
            {/* BUILD-81 — the donor's thread, above giving history.
                BUILD-88a A.2 — and every other open item for them, in ONE list,
                ranked by the one ranking, with the count on the label. */}
            {dpItems.length>0&&(
              <div data-testid="dp-open-items" style={{background:T.white,border:"1px solid "+(dpItems.some(x=>x.overdue)?T.terracotta+"66":T.gold500+"55"),borderRadius:14,padding:"14px 16px"}}>
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
                  <span style={{fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.1em",color:T.ink3}}>
                    {dpItems.length===1?"Open":`Open · ${dpItems.length}`}
                  </span>
                  {dpThread?.snoozedUntil&&<span style={{fontSize:10,color:T.ink3}}>· set aside until {dpThread.snoozedUntil}</span>}
                </div>
                <div style={{display:"flex",flexDirection:"column",gap:10}}>
                {dpItems.map(it=>(
                  <div key={it.id} data-open-item={it.kind} style={{display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
                    <div style={{flex:"1 1 220px",minWidth:0}}>
                      <div style={{fontSize:13.5,fontWeight:700,color:it.overdue?T.terracotta:T.ink}}>
                        {it.nextStep.label} · {it.overdue?"overdue":"due"} {String(it.nextStep.due).slice(0,10)} · day {it.daysOpen}
                      </div>
                      <div style={{fontSize:12,color:T.ink3,marginTop:3,lineHeight:1.5}}>
                        {it.lastTouch?.line?<>"{it.lastTouch.line}"</>:it.lastTouch?.kind==="gift"&&it.lastTouch.amount!=null?<>{fmtFull(it.lastTouch.amount)} received</>:it.rank?.why||null}
                        {it.lastTouch?.date&&it.kind!=="task"?<> · {String(it.lastTouch.date).slice(0,10)}</>:null}
                        {it.lastTouch?.actor?<> · {firstNameOf(it.lastTouch.actor)}</>:null}
                      </div>
                    </div>
                    {it.kind!=="task"&&(
                      <div style={{display:"flex",gap:6,alignItems:"center",flexShrink:0}}>
                        <button onClick={()=>setConvoOpen(true)} disabled={isReadOnly}
                          style={{background:T.greenDk,border:"none",borderRadius:7,padding:"7px 12px",color:"#fff",fontSize:12,fontWeight:700,cursor:isReadOnly?"not-allowed":"pointer",opacity:isReadOnly?0.5:1}}>Done</button>
                        {/* BUILD-94 Part 5 — the same three outputs as the
                            Home row, from the same builder. */}
                        {it.kind==="thread"&&<PutItOnMyCalendar threadId={it.id} compact/>}
                        <ThreadDismissMenu thread={it} onDone={loadDpThread}/>
                      </div>
                    )}
                  </div>
                ))}
                </div>
              </div>
            )}
            {/* ── BUILD-97 Part 2 — THE SCORE TILE IS OFF THIS SCREEN ─────
                BUILD-100 renamed it ("Score 77/99" → "Giving strength") and
                said plainly what it was not, and that was the right first move
                and not the last one. What it could not fix is the SHAPE: a
                number out of 99, in display type, beside one person's name, is
                read as a verdict on that person however carefully it is
                labelled — and the officer reading it is about to decide how
                much to ask them for.
                It survives as a COLUMN on the directory and the re-engage
                list, where it is a sort order across a list rather than a
                judgement on the one record somebody opened, and it carries its
                definition there (see shared/numberCensus.js). The score itself
                is untouched: `donorScore` still computes it, the lists still
                show it, and turning the tile back on is this array.
                The three that stay each carry their own sentence now, on the
                keyboard-reachable hover BUILD-100 built for the fourth. */}
            <div className="donor-stat-grid" style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10}}>
              {[["Lifetime",fmtFull(donor.total),T.ink,censusById("profile.lifetime").sentence],
                ["Last Gift",lastGiftDisplay,"#0d5c3a",censusById("profile.lastGift").sentence],
                ["Contact",`${urg.days}d ago`,urg.urgencyColor,censusById("profile.contact").sentence]].map(([l,v,c,def])=>(
                <div key={l} style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:12,padding:"12px 14px"}}>
                  <div style={{fontSize:9,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.1em",color:T.ink3,marginBottom:4}}>
                    {l}
                    {/* BUILD-100 — the definition travels with the number, on
                        the dashboards' hover convention: reachable by keyboard,
                        because a tooltip nobody can tab to is a definition that
                        does not exist for half the people who need it. */}
                    {def&&<span tabIndex={0} title={def} aria-label={def} data-testid={"dp-tile-def-"+l}
                      style={{marginLeft:5,fontSize:9,fontWeight:700,color:T.ink3,border:"1px solid "+T.bg3,
                              borderRadius:99,width:13,height:13,display:"inline-flex",alignItems:"center",
                              justifyContent:"center",cursor:"help",verticalAlign:"middle"}}>?</span>}
                  </div>
                  <div style={{fontSize:20,fontWeight:800,color:c,fontFamily:"'DM Serif Display',serif",lineHeight:1.1}}>{v}</div>
                </div>
              ))}
            </div>

            {/* BUILD-57 §2c — the lifetime figure and the itemized gift list
                legitimately differ when history arrived as an imported TOTAL
                (aggregate import writes total_giving/gift_count with no gift
                rows — the documented reason Top Donors' lifetime scope reads
                the column). Unlabeled, the two numbers read as a bug on a
                demo screen; so the gap explains itself, always. */}
            {!giftLoading&&donor.total-giftsFull.reduce((s,g)=>s+g.amount,0)>0.5&&(
              <div className="dp-unitemized-note" style={{fontSize:11.5,color:T.ink3,lineHeight:1.5,margin:"-8px 2px 0"}}>
                Lifetime includes <strong style={{color:T.ink2}}>{fmtFull(donor.total-giftsFull.reduce((s,g)=>s+g.amount,0))}</strong> recorded
                as an imported total — giving that predates Steward and was never itemized as individual gifts.
              </div>
            )}

            {householdTotal!=null&&(
              <div style={{background:T.gold+"12",border:"1px solid "+T.gold+"40",borderRadius:12,padding:"10px 14px",fontSize:12,color:T.ink,cursor:"pointer"}} onClick={()=>setDpTab("related")}>
                <strong>{fmtFull(donor.total)}</strong> individually · <strong style={{color:"#8a6d1f"}}>{fmtFull(householdTotal)}</strong> household total — <span style={{color:T.greenDk,fontWeight:700}}>see who's linked →</span>
              </div>
            )}

            {/* Matching-gift flag — from a curated static list (matchingGifts.js
                on the backend), not a live vendor feed; source/last-verified
                is surfaced on hover so this reads as informed, not magic. */}
            {donor.matchingGift&&(
              <div title={`${donor.matchingGift.sourceNote} List curated ${donor.matchingGift.lastVerified}.`}
                style={{background:"#0d5c3a12",border:"1px solid #0d5c3a40",borderRadius:12,padding:"10px 14px",fontSize:12,color:T.ink,display:"flex",alignItems:"flex-start",gap:8}}>
                <div>
                  <div><strong>{donor.matchingGift.companyName}</strong> matches employee gifts {donor.matchingGift.ratio} — ask {donor.name.split(" ")[0]} to submit a match request.</div>
                  <div style={{fontSize:10,color:T.ink3,marginTop:2}}>Curated list, not a live feed — verify current terms before outreach.</div>
                </div>
              </div>
            )}

            {/* BUILD-100 Part 7 — A FUNDER IS AN ORGANISATION ON FILE, so its
                type, its EIN, its grants and every document signed with it
                live on its own record rather than a second one. */}
            {donor.kind==="organisation"&&<FunderPanel donorId={donor.id} isReadOnly={isReadOnly} isTeam={isTeam}
              onOpenGrant={onNavigate?(id=>onNavigate("grants",{grantId:id})):undefined}/>}

            {/* BUILD-99 Part 1 — PROPOSALS SIT ABOVE GIVING HISTORY, because an
                open ask is what an officer came to this record to look at and the
                history is the evidence behind it. Team-locked for Core along with
                the rest of the major-gifts layer (the 2026-07-19 split). */}
            {lockMajor(<ProposalsPanel donorId={donor.id} donorName={donor.name} isReadOnly={isReadOnly} canWrite={isTeam}/>)}

            {/* BUILD-99 Part 3 — the cultivation plan, beside the proposals it
                is there to make possible. */}
            {lockMajor(<PlanPanel donorId={donor.id} isReadOnly={isReadOnly} canWrite={isTeam}/>)}

            {/* BUILD-99 Part 4 — "Brief me". The page she reads in the car. */}
            {lockMajor(<BriefPanel donorId={donor.id} donorName={donor.name} isReadOnly={isReadOnly} canWrite={isTeam}/>)}

            <div style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:14,padding:"16px 18px"}}>
              <div style={{fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.1em",color:T.ink3,marginBottom:12}}>Giving History</div>
              {giftLoading?<div style={{height:80,display:"flex",alignItems:"center",justifyContent:"center",color:T.ink3,fontSize:12}}><Spin/></div>:<GivingHistoryChart gifts={gifts}/>}
            </div>

            {donor.tags?.length>0&&<div style={{display:"flex",gap:5,flexWrap:"wrap"}}>{donor.tags.map(t=><Pill key={t} label={t}/>)}</div>}
            {donor.notes&&<div style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:10,padding:"12px 14px",fontSize:13,color:T.ink3,lineHeight:1.6}}>{donor.notes}</div>}

            {/* BUILD-98 Part 1 — soft credit on OTHER people's gifts. Hard
                credit is their own money and stays the headline; "with soft
                credit" is a second figure, labelled, with the gifts it comes
                from listed so the number can be checked. */}
            {softCredit?.giftSoftCredits?.length>0&&(
              <div data-testid="soft-credit-panel" style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:12,padding:"14px 16px",display:"flex",flexDirection:"column",gap:10}}>
                <span style={{fontSize:10,fontWeight:800,textTransform:"uppercase",letterSpacing:"0.1em",color:T.greenDk}}>Soft credit</span>
                <div style={{display:"flex",gap:18,flexWrap:"wrap"}}>
                  {[["Their own giving",softCredit.hardCredit,T.ink,censusById("profile.creditHard")],
                    ["With soft credit",softCredit.hardPlusGiftSoft,T.gold600,censusById("profile.creditWithSoft")]].map(([l,v,c,e])=>(
                    <div key={l} data-testid={e.testid} title={e.sentence} aria-label={e.sentence} tabIndex={0}>
                      <div style={{fontSize:10,color:T.ink3,textTransform:"uppercase",letterSpacing:".05em"}}>{l}</div>
                      <div style={{fontSize:16,fontWeight:800,color:c}}>{fmtFull(v||0)}</div>
                    </div>))}
                </div>
                                <div style={{display:"flex",flexDirection:"column",gap:4}}>
                  {softCredit.giftSoftCredits.slice(0,8).map(sc=>(
                    <div key={sc.id} style={{display:"flex",gap:8,fontSize:12,color:T.ink}}>
                      <span style={{fontWeight:700}}>{sc.giverName}</span>
                      <span style={{color:T.ink3}}>{sc.date}</span>
                      <span style={{marginLeft:"auto"}}>{fmtFull(sc.amount)}</span>
                    </div>))}
                </div>
              </div>
            )}

            {/* BUILD-98 (switch) Part 5 — hours, on the person. */}
            <VolunteerPanel donor={donor} isReadOnly={isReadOnly}/>
            <MembershipPanel donor={donor} isReadOnly={isReadOnly}/>

            {/* Household & planned giving (BUILD-14) */}
            <div style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:12,padding:"14px 16px",display:"flex",flexDirection:"column",gap:12}}>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <span style={{fontSize:10,fontWeight:800,textTransform:"uppercase",letterSpacing:"0.1em",color:"#0d5c3a"}}>Household</span>
                {household
                  ?<span style={{fontSize:12,color:T.ink,fontWeight:700}}>{household.name}</span>
                  :<span style={{fontSize:12,color:T.ink3,fontStyle:"italic"}}>Not in a household</span>}
                {household
                  ?!isReadOnly&&<button onClick={removeFromHousehold} style={{marginLeft:"auto",background:"transparent",border:"1px solid "+T.bg3,borderRadius:7,padding:"3px 9px",color:T.terracotta,fontSize:11,fontWeight:700,cursor:"pointer"}}>Remove</button>
                  :!isReadOnly&&<button onClick={()=>setHhModalOpen(true)} style={{marginLeft:"auto",background:"transparent",border:"1px solid "+T.bg3,borderRadius:7,padding:"3px 9px",color:T.greenMid,fontSize:11,fontWeight:700,cursor:"pointer"}}>+ Group into household</button>}
              </div>
              {household&&(
                <>
                  <div style={{display:"flex",gap:18,flexWrap:"wrap"}}>
                    <div><div style={{fontSize:10,color:T.ink3,textTransform:"uppercase",letterSpacing:".05em"}}>Hard credit</div><div style={{fontSize:16,fontWeight:800,color:T.ink}}>{fmtFull(softCredit?.hardCredit||0)}</div></div>
                    <div><div style={{fontSize:10,color:T.ink3,textTransform:"uppercase",letterSpacing:".05em"}}>Soft credit</div><div style={{fontSize:16,fontWeight:800,color:"#a97f22"}}>{fmtFull(softCredit?.softCredit||0)}</div></div>
                    <div style={{borderLeft:"1px solid "+T.bg3,paddingLeft:18}}><div style={{fontSize:10,color:T.ink3,textTransform:"uppercase",letterSpacing:".05em"}}>Household combined</div><div style={{fontSize:16,fontWeight:800,color:"#0d5c3a"}}>{fmtFull(household.combined_giving)}</div></div>
                  </div>
                  <div style={{display:"flex",flexDirection:"column",gap:5}}>
                    {household.members.map(m=>(
                      <div key={m.id} onClick={()=>m.id!==donor.id&&onSelectRelatedDonor&&onSelectRelatedDonor(m.id)} style={{display:"flex",alignItems:"center",gap:8,fontSize:12,padding:"6px 8px",borderRadius:8,background:m.id===donor.id?"#0d5c3a10":"transparent",cursor:m.id!==donor.id?"pointer":"default"}}>
                        {/* BUILD-94 Part 1 — a household is the one place a
                            row names several people at once; faces are what
                            tell them apart at a glance. */}
                        <PersonMark id={m.id} name={m.name} size={22}/>
                        <span style={{fontWeight:m.id===donor.id?800:600,color:T.ink}}>{m.name}</span>
                        {m.is_primary&&<span style={{background:"#c9a84c",color:"#0f1a12",borderRadius:99,padding:"1px 7px",fontSize:9,fontWeight:800,textTransform:"uppercase"}}>Primary</span>}
                        <span style={{marginLeft:"auto",color:T.ink3}}>{fmtFull(m.total_giving)}</span>
                      </div>
                    ))}
                  </div>
                  <div style={{fontSize:11,color:T.ink3}}>Combined view only — each gift's hard credit stays with the donor who gave it.</div>
                </>
              )}
              <div style={{borderTop:"1px solid "+T.bg3,paddingTop:10}}>
                <div style={{fontSize:10,fontWeight:800,textTransform:"uppercase",letterSpacing:"0.1em",color:"#0d5c3a",marginBottom:7}}>Planned giving & designations</div>
                <div style={{display:"flex",gap:7,flexWrap:"wrap"}}>
                  {DESIGNATION_OPTS.map(([k,label])=>{const on=hasDesignation(k);return(
                    <button key={k} onClick={()=>!isReadOnly&&toggleDesignation(k)} disabled={isReadOnly} title={isReadOnly?"Reactivate your subscription to make changes.":undefined}
                      aria-pressed={on} data-designation={k} data-on={on?"1":"0"}
                      style={{background:on?"#0d5c3a":"transparent",color:on?"#fff":T.ink3,border:"1px solid "+(on?"#0d5c3a":T.bg3),borderRadius:99,padding:"4px 11px",fontSize:11,fontWeight:700,cursor:isReadOnly?"not-allowed":"pointer"}}>
                      {on?"✓ ":""}{label}
                    </button>
                  );})}
                </div>
              </div>
              {/* Pipeline: Moves & Asks (BUILD-15, Team plan). Core sees the real
                  panel behind glass + an Unlock-with-Team CTA (lockMajor). */}
              {lockMajor(
                <div style={{borderTop:"1px solid "+T.bg3,paddingTop:10}}>
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:7}}>
                    <div style={{fontSize:10,fontWeight:800,textTransform:"uppercase",letterSpacing:"0.1em",color:"#0d5c3a"}}>Pipeline — moves & asks</div>
                    <div style={{display:"flex",gap:6}}>
                      {isTeam&&!isReadOnly&&<button onClick={addToPipeline} disabled={pipelineAdded} style={{background:pipelineAdded?"transparent":"#c9a84c",border:pipelineAdded?"1px solid "+T.bg3:"none",borderRadius:99,padding:"3px 10px",fontSize:11,fontWeight:700,color:pipelineAdded?T.ink3:"#0f1a12",cursor:pipelineAdded?"default":"pointer"}}>{pipelineAdded?"✓ In pipeline":"+ Add to pipeline"}</button>}
                      {isTeam&&!isReadOnly&&<button onClick={()=>setAskOpen(v=>!v)} style={{background:"transparent",border:"1px solid "+T.bg3,borderRadius:99,padding:"3px 10px",fontSize:11,fontWeight:700,color:"#a97f22",cursor:"pointer"}}>{askOpen?"Cancel":"+ Add ask"}</button>}
                    </div>
                  </div>
                  {askOpen&&(
                    <div style={{display:"flex",gap:6,marginBottom:8,flexWrap:"wrap"}}>
                      <input value={askName} onChange={e=>setAskName(e.target.value)} placeholder="What's the ask? (optional)" style={{flex:"1 1 140px",border:"1px solid "+T.bg3,borderRadius:8,padding:"6px 9px",fontSize:12}}/>
                      <input value={askAmt} onChange={e=>setAskAmt(e.target.value)} placeholder="$ target" style={{width:100,border:"1px solid "+T.bg3,borderRadius:8,padding:"6px 9px",fontSize:12}}/>
                      <button onClick={addAsk} style={{background:"#0d5c3a",border:"none",borderRadius:8,padding:"6px 14px",fontSize:12,fontWeight:700,color:"#fff",cursor:"pointer"}}>Save</button>
                    </div>
                  )}
                  {opps.length>0&&(
                    <div style={{display:"flex",flexDirection:"column",gap:5,marginBottom:moves.length?10:0}}>
                      {opps.map(o=>(
                        <div key={o.id} style={{display:"flex",alignItems:"center",gap:8,fontSize:12,padding:"6px 8px",borderRadius:8,background:o.status==="open"?"#c9a84c14":T.bg2}}>
                          <span style={{fontWeight:700,color:T.ink}}>{o.name}</span>
                          <span style={{color:"#a97f22",fontWeight:800}}>{fmtFull(o.target_amount)} ask</span>
                          {o.status==="won"&&<span style={{color:"#0d5c3a",fontWeight:700}}>→ {fmtFull(o.gift_amount||0)} gift</span>}
                          {o.status==="lost"&&<span style={{color:T.terracotta,fontWeight:700}}>lost</span>}
                          <span style={{marginLeft:"auto",display:"flex",gap:6}}>
                            {o.status==="open"&&isTeam&&!isReadOnly&&<>
                              <button onClick={()=>closeAsk(o,"won")} style={{background:"#0d5c3a",border:"none",borderRadius:6,padding:"2px 9px",fontSize:11,fontWeight:700,color:"#fff",cursor:"pointer"}}>Won</button>
                              <button onClick={()=>closeAsk(o,"lost")} style={{background:"transparent",border:"1px solid "+T.bg3,borderRadius:6,padding:"2px 9px",fontSize:11,fontWeight:700,color:T.ink3,cursor:"pointer"}}>Lost</button>
                            </>}
                            {o.status!=="open"&&<span style={{fontSize:10,color:T.ink3,textTransform:"uppercase"}}>{o.status}</span>}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                  {moves.length>0&&(
                    <div style={{display:"flex",flexDirection:"column",gap:4}}>
                      {moves.slice(0,6).map(m=>(
                        <div key={m.id} style={{fontSize:12,color:T.ink2,paddingLeft:10,borderLeft:"2px solid "+T.bg3}}>
                          <div><span style={{fontWeight:700,color:T.ink}}>{cap(m.from_stage)} → {cap(m.to_stage)}</span> <span style={{color:T.ink3}}>· {m.officer_name||"—"} · {new Date(m.created_at).toLocaleDateString("en-US",{month:"short",day:"numeric"})}</span></div>
                          {m.description&&<div style={{color:T.ink3,fontSize:11}}>{m.description}</div>}
                        </div>
                      ))}
                    </div>
                  )}
                  {isTeam&&moves.length===0&&opps.length===0&&<div style={{fontSize:11,color:T.ink3}}>No moves or asks logged yet. Move this donor on the Pipeline board, or add an ask above.</div>}
                </div>,
                {title:"Track asks & moves",blurb:"Log every ask against the gift it closes and keep this donor's full move history. Part of the Team major-gifts toolkit.",minHeight:170}
              )}
              {hhModalOpen&&(
                <Modal onClose={()=>setHhModalOpen(false)} width={440} zIndex={1000}
                  backdrop="rgba(15,26,18,0.5)" blur={false} padding={20}
                  ariaLabel="Group into a household" dialogStyle={{background:T.bg,borderRadius:16,maxHeight:"80vh"}}>
                  <div style={{display:"flex",flexDirection:"column",gap:12}}>
                    <div style={{fontFamily:"'DM Serif Display',Georgia,serif",fontSize:19,color:T.ink}}>Group {donor.name} into a household</div>
                    <div style={{fontSize:12,color:T.ink3}}>Pick the spouse/partner(s) to combine with. {donor.name} becomes the primary. Hard credit stays with each donor — only the relationship view combines.</div>
                    <input value={hhSearch} onChange={e=>setHhSearch(e.target.value)} placeholder="Search donors…" style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:9,padding:"9px 12px",fontSize:13,color:T.ink,outline:"none"}}/>
                    <div style={{overflowY:"auto",display:"flex",flexDirection:"column",gap:4,flex:1}}>
                      {allDonors.filter(x=>x.id!==donor.id&&!x.householdId&&(!hhSearch.trim()||(x.name+(x.email||"")).toLowerCase().includes(hhSearch.toLowerCase()))).slice(0,40).map(x=>{
                        const picked=hhPick.has(x.id);
                        return(
                          <label key={x.id} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 10px",borderRadius:9,background:picked?"#0d5c3a12":T.white,border:"1px solid "+(picked?"#0d5c3a55":T.bg3),cursor:"pointer"}}>
                            <input type="checkbox" checked={picked} onChange={()=>{const n=new Set(hhPick);n.has(x.id)?n.delete(x.id):n.add(x.id);setHhPick(n);}} style={{accentColor:"#0d5c3a"}}/>
                            <span style={{fontSize:13,fontWeight:600,color:T.ink}}>{x.name}</span>
                            <span style={{marginLeft:"auto",fontSize:11,color:T.ink3}}>{fmtFull(x.total||0)}</span>
                          </label>
                        );
                      })}
                    </div>
                    <div style={{display:"flex",justifyContent:"flex-end",gap:8}}>
                      <button onClick={()=>{setHhModalOpen(false);setHhPick(new Set());}} style={{background:"transparent",border:"1px solid "+T.bg3,borderRadius:9,padding:"9px 16px",fontSize:13,fontWeight:700,color:T.ink3,cursor:"pointer"}}>Cancel</button>
                      <button onClick={createHousehold} disabled={hhPick.size===0} style={{background:hhPick.size?"#0d5c3a":T.bg3,color:"#fff",border:"none",borderRadius:9,padding:"9px 18px",fontSize:13,fontWeight:700,cursor:hhPick.size?"pointer":"not-allowed"}}>Create household</button>
                    </div>
                  </div>
                </Modal>
              )}
            </div>

            <div>
              <div style={{fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.1em",color:T.ink3,marginBottom:8,display:"flex",alignItems:"center",gap:6}}>
                Follow-up Tasks
                {tasks.filter(t=>!t.done).length>0&&<span style={{background:"#0d5c3a",color:"#fff",borderRadius:99,padding:"1px 6px",fontSize:9,fontWeight:800}}>{tasks.filter(t=>!t.done).length}</span>}
                {onAddTask&&<button onClick={onAddTask} disabled={isReadOnly} title={isReadOnly?"Reactivate your subscription to make changes.":"Add a follow-up task"} style={{marginLeft:"auto",background:"transparent",border:`1px solid ${T.bg3}`,borderRadius:7,padding:"3px 9px",color:isReadOnly?T.ink3:T.greenMid,fontSize:11,fontWeight:700,cursor:isReadOnly?"not-allowed":"pointer",letterSpacing:0,textTransform:"none",opacity:isReadOnly?0.5:1}}>+ Add task</button>}
              </div>
              {tasks.length===0
                ?<div style={{fontSize:12,color:T.ink3,fontStyle:"italic"}}>No tasks yet — add a follow-up so nothing slips.</div>
                :<div style={{display:"flex",flexDirection:"column",gap:6}}>
                  {[...tasks].sort((a,b)=>a.done-b.done||(a.due||"").localeCompare(b.due||"")).map(t=>{
                    // Due-date badge: overdue ONLY when strictly before today
                    // (local/org tz, calendar dates). Future → warm grey "Due X",
                    // today → brass "Due today", past → terracotta "Overdue · was due X".
                    const badge=t.due&&!t.done?dueBadge(t.due):null;
                    const overdue=badge?.state==="overdue";
                    const badgeColor=overdue?T.terracotta:badge?.state==="today"?T.gold500:T.ink3;
                    return <div key={t.id} onClick={()=>onTaskToggle(t)} style={{background:T.white,border:`1px solid ${t.done?"#0d5c3a30":overdue?"#b8593f30":T.bg3}`,borderRadius:10,padding:"10px 14px",cursor:"pointer",display:"flex",alignItems:"center",gap:10}}>
                      <div style={{width:18,height:18,borderRadius:5,border:`2px solid ${t.done?"#0d5c3a":SC[t.priority]}`,background:t.done?"#0d5c3a":"transparent",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center"}}>
                        {t.done&&<span style={{color:"#fff",fontSize:10,lineHeight:1}}>✓</span>}
                      </div>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontSize:12,fontWeight:500,color:t.done?T.ink3:T.ink,textDecoration:t.done?"line-through":"none",lineHeight:1.3}}>{t.title}</div>
                        {badge&&<div style={{fontSize:11,color:badgeColor,marginTop:2,fontWeight:overdue?700:400}}>
                          {badge.label}
                        </div>}
                        {t.due&&t.done&&<div style={{fontSize:11,color:T.ink3,marginTop:2}}>
                          {new Date(t.due).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})}
                        </div>}
                      </div>
                      <Pill label={t.priority} color={SC[t.priority]}/>
                    </div>;
                  })}
                </div>
              }
            </div>

            <div>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
                <div style={{fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.1em",color:T.ink3}}>Touchpoint Timeline</div>
                <button onClick={onLogTouchpoint} style={{background:"#0d5c3a",border:"none",borderRadius:7,padding:"5px 12px",color:"#fff",fontSize:11,fontWeight:700,cursor:"pointer"}}>+ Log</button>
              </div>
              <TouchpointTimeline interactions={localInts??donor.interactions??[]} onDelete={deleteInteraction}/>
            </div>

            {/* BUILD-41: Delete lives at the BOTTOM of the record, not in the
                top action row (a destructive action at thumb height beside
                Edit was a mis-tap risk). Quiet terracotta outline; the confirm
                lives in the parent deleteDonor handler. */}
            {isAdmin&&(
              <div style={{marginTop:8,paddingTop:16,borderTop:"1px solid "+T.bg3,display:"flex",justifyContent:"flex-end"}}>
                <button onClick={()=>onDelete(donor.id)} style={{background:"transparent",border:"1px solid #b8593f55",borderRadius:8,padding:"9px 16px",color:"#b8593f",fontSize:13,fontWeight:600,cursor:"pointer"}}>Delete donor</button>
              </div>
            )}
          </div>}

          {/* Gifts & Pledges tab */}
          {dpTab==="gifts"&&<div style={{padding:"20px 20px 24px 24px",display:"flex",flexDirection:"column",gap:18}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
              <div>
                <div style={{fontSize:14,fontWeight:800,color:T.ink}}>Gift History</div>
                <div style={{fontSize:12,color:T.ink3,marginTop:2}}>
                  Total: <strong style={{color:"#0d5c3a"}}>{fmtFull(giftsFull.reduce((s,g)=>s+g.amount,0))}</strong> · {giftsFull.length} gifts
                  {donor.total-giftsFull.reduce((s,g)=>s+g.amount,0)>0.5&&(
                    <span className="dp-unitemized-note"> · lifetime {fmtFull(donor.total)} includes {fmtFull(donor.total-giftsFull.reduce((s,g)=>s+g.amount,0))} of imported history not itemized below</span>
                  )}
                </div>
              </div>
              <div style={{display:"flex",gap:8,alignItems:"center"}}>
                <button onClick={exportGiftsCSV} style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"6px 12px",color:T.ink3,fontSize:12,cursor:"pointer"}}>↓ CSV</button>
                {receiptsEnabled&&(
                  <button onClick={()=>setShowYearEnd(v=>!v)} disabled={isReadOnly} title={isReadOnly?"Reactivate your subscription to make changes.":undefined}
                    style={{background:showYearEnd?T.greenDk:T.bg,border:"1px solid "+(showYearEnd?T.greenDk:T.bg3),borderRadius:8,padding:"6px 12px",color:showYearEnd?"#fff":T.ink3,fontSize:12,fontWeight:600,cursor:isReadOnly?"not-allowed":"pointer",opacity:isReadOnly?0.45:1}}>
                    Year-end statement
                  </button>
                )}
                <button onClick={()=>setAddGiftOpen(v=>!v)} disabled={isReadOnly} title={isReadOnly?"Reactivate your subscription to make changes.":undefined} style={{background:"#0d5c3a",border:"none",borderRadius:8,padding:"7px 12px",color:"#fff",fontSize:12,fontWeight:700,cursor:isReadOnly?"not-allowed":"pointer",opacity:isReadOnly?0.45:1}}>+ Add Gift</button>
              </div>
            </div>

            {!receiptsEnabled&&isAdmin&&(
              <div style={{background:"#f6eccf",border:"1px solid #e7cf91",borderRadius:10,padding:"10px 14px",fontSize:12,color:"#8a6d1f"}}>
                Tax receipts aren't set up yet — add your organization's legal info in Settings to send IRS-compliant receipts for gifts of $250+.
              </div>
            )}

            {showYearEnd&&receiptsEnabled&&(
              <div style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:12,padding:"16px"}}>
                <div style={{fontSize:12,fontWeight:700,color:T.ink,marginBottom:10}}>Year-End Giving Statement</div>
                <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
                  <span style={{fontSize:11,color:T.ink3}}>Tax year</span>
                  <input type="number" value={yearEndYear} onChange={e=>setYearEndYear(e.target.value)} style={{width:100,background:T.bg,border:"1px solid "+T.bg3,borderRadius:6,padding:"6px 8px",color:T.ink,fontSize:12,outline:"none"}}/>
                  <button onClick={sendYearEndStatement} disabled={yearEndBusy} style={{background:"#0d5c3a",border:"none",borderRadius:6,padding:"7px 12px",color:"#fff",fontSize:12,fontWeight:700,cursor:yearEndBusy?"not-allowed":"pointer"}}>
                    {yearEndBusy?"Generating…":"Generate & email"}
                  </button>
                  <button onClick={()=>setShowYearEnd(false)} style={{background:T.bg,border:"none",borderRadius:6,padding:"7px 10px",color:T.ink3,fontSize:12,cursor:"pointer"}}>Cancel</button>
                </div>
                {yearEndErr&&<div style={{fontSize:11,color:"#8a3a24",marginTop:8}}>{yearEndErr}</div>}
                <div style={{fontSize:11,color:T.ink3,marginTop:8,lineHeight:1.5}}>Consolidates every {yearEndYear} gift into one statement, emailed to the donor and superseding any prior statement for that year.</div>
              </div>
            )}

            {/* Recurring gift health — failed-payment recovery status */}
            {recurringSub&&(()=>{
              const RS_META={
                active:      {label:"Active",         color:"#0d5c3a"},
                past_due:    {label:"Payment failed",  color:T.terracotta},
                recovering:  {label:"Recovering",      color:"#c9a84c"},
                recovered:   {label:"Card fixed",      color:"#0d5c3a"},
                canceled:    {label:"Canceled",        color:T.ink3},
              };
              const meta=RS_META[recurringSub.status]||{label:recurringSub.status,color:T.ink3};
              const atRisk=["past_due","recovering"].includes(recurringSub.status);
              return(
                <div style={{background:T.white,border:"1px solid "+meta.color+"30",borderLeft:"3px solid "+meta.color,borderRadius:10,padding:"10px 14px",display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,flexWrap:"wrap"}}>
                  <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                    <span style={{background:meta.color+"15",color:meta.color,border:"1px solid "+meta.color+"40",borderRadius:99,padding:"3px 10px",fontSize:11,fontWeight:800}}>{meta.label}</span>
                    <span style={{fontSize:12,color:T.ink3}}>
                      Recurring gift{recurringSub.amount!=null?` · ${fmtFull(recurringSub.amount)}/${recurringSub.interval==="year"?"yr":"mo"}`:""}
                      {atRisk&&recurringSub.failure_count>0&&` · ${recurringSub.failure_count} failed attempt${recurringSub.failure_count===1?"":"s"}`}
                    </span>
                  </div>
                  {atRisk&&(
                    <button onClick={resendRecurringLink} disabled={isReadOnly||recurResendBusy||recurResendSent}
                      title={isReadOnly?"Reactivate your subscription to make changes.":undefined}
                      style={{background:meta.color,border:"none",borderRadius:8,padding:"6px 12px",color:"#fff",fontSize:12,fontWeight:700,cursor:(isReadOnly||recurResendBusy||recurResendSent)?"not-allowed":"pointer",opacity:(isReadOnly||recurResendBusy||recurResendSent)?0.5:1,whiteSpace:"nowrap"}}>
                      {recurResendSent?"Sent ✓":recurResendBusy?"Sending…":"Send card-update link"}
                    </button>
                  )}
                </div>
              );
            })()}

            {addGiftOpen&&<div style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:12,padding:"16px"}}>
              <div style={{fontSize:12,fontWeight:700,color:T.ink,marginBottom:12}}>New Gift</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
                <input value={addGiftForm.amount} onChange={e=>setAddGiftForm(p=>({...p,amount:e.target.value}))} placeholder="Amount ($)" type="number" style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"8px 10px",color:T.ink,fontSize:13,outline:"none"}}/>
                <input value={addGiftForm.date} onChange={e=>setAddGiftForm(p=>({...p,date:e.target.value}))} type="date" style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"8px 10px",color:T.ink,fontSize:13,outline:"none"}}/>
                <select value={addGiftForm.type} onChange={e=>setAddGiftForm(p=>({...p,type:e.target.value}))} style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"8px 10px",color:T.ink,fontSize:13,outline:"none"}}>
                  {["cash","check","credit_card","stock","in_kind","matching","other"].map(t=><option key={t}>{t}</option>)}
                </select>
                <input value={addGiftForm.payment_method} onChange={e=>setAddGiftForm(p=>({...p,payment_method:e.target.value}))} placeholder="Payment method" style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"8px 10px",color:T.ink,fontSize:13,outline:"none"}}/>
              </div>
              <input value={addGiftForm.notes} onChange={e=>setAddGiftForm(p=>({...p,notes:e.target.value}))} placeholder="Notes" style={{width:"100%",background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"8px 10px",color:T.ink,fontSize:13,outline:"none",boxSizing:"border-box",marginBottom:8}}/>
              {campaigns.length>0&&<><select value={addGiftForm.campaign_id||""} onChange={e=>setAddGiftForm(p=>({...p,campaign_id:e.target.value}))} style={{width:"100%",background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"8px 10px",color:T.ink,fontSize:13,outline:"none",boxSizing:"border-box",marginBottom:2}}>
                <option value="">Campaign — not attributed</option>
                {campaigns.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <div style={{fontSize:11,color:T.ink3,marginBottom:8,lineHeight:1.4}}>Which goal this counts toward — updates that campaign's thermometer live.</div></>}
              {pledges.filter(p=>p.status==="open").length>0&&(
                <select value={addGiftForm.pledgeId} onChange={e=>setAddGiftForm(p=>({...p,pledgeId:e.target.value}))} style={{width:"100%",background:T.bg,border:"1px solid "+T.terracotta+"50",borderRadius:8,padding:"8px 10px",color:T.ink,fontSize:13,outline:"none",boxSizing:"border-box",marginBottom:8}}>
                  <option value="">Not fulfilling a pledge</option>
                  {pledges.filter(p=>p.status==="open").map(p=>(
                    <option key={p.id} value={p.id}>Fulfills {fmtFull(p.amount)} pledge due {p.due_date}</option>
                  ))}
                </select>
              )}
              {/* BUILD-98 Part 1 — soft credit, tribute, matching gift. Closed by
                  default: most gifts are none of these, and three blank rows on
                  every gift is how a form starts to feel like paperwork. */}
              <datalist id="gift-people">{allDonors.slice(0,2000).map(d=><option key={d.id} value={d.name}/>)}</datalist>
              <button type="button" onClick={()=>setGiftMoreOpen(o=>!o)} data-testid="gift-more-toggle"
                style={{background:"transparent",border:"none",padding:"2px 0",color:T.greenDk,fontSize:12,fontWeight:700,cursor:"pointer",marginBottom:8}}>
                {giftMoreOpen?"Hide soft credit, tribute and match":"Soft credit, tribute or matching gift"}
              </button>
              {giftMoreOpen&&(()=>{const inp={background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"8px 10px",color:T.ink,fontSize:13,outline:"none",boxSizing:"border-box",width:"100%"};return(
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:10}}>
                  <input list="gift-people" value={addGiftForm.scName||""} onChange={e=>setAddGiftForm(p=>({...p,scName:e.target.value}))} placeholder="Soft credit to (a person on file)" style={inp} data-testid="gift-sc-name"/>
                  <input value={addGiftForm.scAmount||""} onChange={e=>setAddGiftForm(p=>({...p,scAmount:e.target.value}))} placeholder="Soft credit amount (blank = whole gift)" type="number" style={inp}/>
                  <select value={addGiftForm.tribType||""} onChange={e=>setAddGiftForm(p=>({...p,tribType:e.target.value}))} style={inp} data-testid="gift-trib-type">
                    <option value="">Not a tribute gift</option><option value="honor">In honour of</option><option value="memory">In memory of</option>
                  </select>
                  <input list="gift-people" value={addGiftForm.tribName||""} onChange={e=>setAddGiftForm(p=>({...p,tribName:e.target.value}))} placeholder="Who it honours" style={inp} data-testid="gift-trib-name"/>
                  <input value={addGiftForm.tribNotify||""} onChange={e=>setAddGiftForm(p=>({...p,tribNotify:e.target.value}))} placeholder="Tell (e.g. the Lee family)" style={inp}/>
                  <input value={addGiftForm.tribNotifyEmail||""} onChange={e=>setAddGiftForm(p=>({...p,tribNotifyEmail:e.target.value}))} placeholder="Their email or leave blank" style={inp}/>
                  <input list="gift-people" value={addGiftForm.matchEmployer||""} onChange={e=>setAddGiftForm(p=>({...p,matchEmployer:e.target.value}))} placeholder="Employer that will match it" style={inp}/>
                  <input value={addGiftForm.matchAmount||""} onChange={e=>setAddGiftForm(p=>({...p,matchAmount:e.target.value}))} placeholder="Expected match (blank = same amount)" type="number" style={inp}/>
                </div>);})()}
              {giftErr&&<div role="alert" style={{fontSize:12,color:T.terracotta,marginBottom:8}}>{giftErr}</div>}
              <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:12}}>
                <label style={{display:"flex",alignItems:"center",gap:6,fontSize:12,color:T.ink,cursor:"pointer"}}>
                  <input type="checkbox" checked={addGiftForm.acknowledgement_sent} onChange={e=>setAddGiftForm(p=>({...p,acknowledgement_sent:e.target.checked}))} style={{accentColor:"#0d5c3a"}}/>
                  Acknowledgement sent
                </label>
              </div>
              <div style={{display:"flex",gap:8}}>
                <button onClick={addGift} disabled={giftSaving} style={{background:"#0d5c3a",border:"none",borderRadius:8,padding:"8px 16px",color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer"}}>Save</button>
                <button onClick={()=>setAddGiftOpen(false)} style={{background:T.bg,border:"none",borderRadius:8,padding:"8px 14px",color:T.ink3,fontSize:13,cursor:"pointer"}}>Cancel</button>
              </div>
            </div>}

            <div style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:12,overflow:"hidden"}}>
              {giftLoading?<div style={{padding:24,textAlign:"center",color:T.ink3,fontSize:12}}><Spin/></div>:giftsFull.length===0?(
                <div style={{display:"flex",flexDirection:"column",alignItems:"center",padding:"40px 24px",textAlign:"center",gap:0}}>
                  <div style={{marginBottom:16,color:"#0d5c3a",opacity:0.7}}>
                    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
                    </svg>
                  </div>
                  <div style={{fontFamily:"'DM Serif Display',Georgia,serif",fontSize:20,fontWeight:400,color:"#0f1a12",letterSpacing:"-0.01em",marginBottom:8}}>No gifts recorded yet.</div>
                  <div style={{fontSize:13,color:"#5a554f",maxWidth:260,lineHeight:1.65,marginBottom:20}}>Log your first gift to start tracking acknowledgments and giving history.</div>
                  <button onClick={()=>setAddGiftOpen(true)} disabled={isReadOnly} title={isReadOnly?"Reactivate your subscription to make changes.":undefined}
                    style={{background:"#0d5c3a",color:"#fff",border:"none",borderRadius:10,padding:"10px 22px",fontSize:13,fontWeight:600,cursor:isReadOnly?"not-allowed":"pointer",opacity:isReadOnly?0.45:1,fontFamily:"'DM Sans',system-ui,sans-serif"}}>
                    Record a gift →
                  </button>
                </div>
              ):(
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                  <thead>
                    <tr style={{background:T.bg2}}>
                      {["Date","Amount","Type","Method","Ack","Receipt","Note",""].map(h=><th key={h} style={{padding:"8px 12px",textAlign:"left",fontWeight:700,color:T.ink3,fontSize:10,textTransform:"uppercase",letterSpacing:"0.08em",borderBottom:"1px solid "+T.bg3}}>{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {[...giftsFull].sort((a,b)=>new Date(b.date)-new Date(a.date)).map(g=>(
                      <tr key={g.id} style={{borderBottom:"1px solid "+T.bg3}}>
                        {giftEditId===g.id?(
                          <td colSpan={8} style={{padding:"10px 12px"}}>
                            <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}>
                              <input value={giftEditForm.amount} onChange={e=>setGiftEditForm(p=>({...p,amount:e.target.value}))} placeholder="Amount" type="number" style={{width:80,background:T.bg,border:"1px solid "+T.bg3,borderRadius:6,padding:"5px 8px",color:T.ink,fontSize:12,outline:"none"}}/>
                              <input value={giftEditForm.date} onChange={e=>setGiftEditForm(p=>({...p,date:e.target.value}))} type="date" style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:6,padding:"5px 8px",color:T.ink,fontSize:12,outline:"none"}}/>
                              <select value={giftEditForm.type} onChange={e=>setGiftEditForm(p=>({...p,type:e.target.value}))} style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:6,padding:"5px 8px",color:T.ink,fontSize:12,outline:"none"}}>
                                {["cash","check","credit_card","stock","in_kind","matching","other"].map(t=><option key={t}>{t}</option>)}
                              </select>
                              <input value={giftEditForm.payment_method} onChange={e=>setGiftEditForm(p=>({...p,payment_method:e.target.value}))} placeholder="Method" style={{width:100,background:T.bg,border:"1px solid "+T.bg3,borderRadius:6,padding:"5px 8px",color:T.ink,fontSize:12,outline:"none"}}/>
                              <input value={giftEditForm.notes} onChange={e=>setGiftEditForm(p=>({...p,notes:e.target.value}))} placeholder="Notes" style={{flex:1,minWidth:80,background:T.bg,border:"1px solid "+T.bg3,borderRadius:6,padding:"5px 8px",color:T.ink,fontSize:12,outline:"none"}}/>
                              {giftCfDefs.map(d=>(
                                d.type==="select"?(
                                  <select key={d.key} value={giftEditForm.customFields?.[d.key]||""} onChange={e=>setGiftEditForm(p=>({...p,customFields:{...p.customFields,[d.key]:e.target.value}}))}
                                    title={d.label} style={{width:110,background:T.bg,border:"1px solid "+T.bg3,borderRadius:6,padding:"5px 8px",color:T.ink,fontSize:12,outline:"none"}}>
                                    <option value="">{d.label}…</option>
                                    {(d.options||[]).map(o=><option key={o} value={o}>{o}</option>)}
                                  </select>
                                ):(
                                  <input key={d.key} value={giftEditForm.customFields?.[d.key]||""} onChange={e=>setGiftEditForm(p=>({...p,customFields:{...p.customFields,[d.key]:e.target.value}}))}
                                    placeholder={d.label} title={d.label} style={{width:110,background:T.bg,border:"1px solid "+T.bg3,borderRadius:6,padding:"5px 8px",color:T.ink,fontSize:12,outline:"none"}}/>
                                )
                              ))}
                              <label style={{display:"flex",alignItems:"center",gap:4,fontSize:11,color:T.ink,cursor:"pointer",flexShrink:0}}>
                                <input type="checkbox" checked={!!giftEditForm.acknowledgement_sent} onChange={e=>setGiftEditForm(p=>({...p,acknowledgement_sent:e.target.checked}))} style={{accentColor:"#0d5c3a"}}/>
                                Ack
                              </label>
                              <button onClick={()=>saveGiftEdit(g.id)} disabled={giftSaving} style={{background:"#0d5c3a",border:"none",borderRadius:6,padding:"5px 10px",color:"#fff",fontSize:11,fontWeight:700,cursor:"pointer"}}>Save</button>
                              <button onClick={()=>setGiftEditId(null)} style={{background:T.bg,border:"none",borderRadius:6,padding:"5px 10px",color:T.ink3,fontSize:11,cursor:"pointer"}}>Cancel</button>
                            </div>
                          </td>
                        ):(
                          <>
                            <td style={{padding:"9px 12px",color:T.ink3,whiteSpace:"nowrap"}}>{g.date}</td>
                            <td style={{padding:"9px 12px",fontWeight:700,color:"#0d5c3a",whiteSpace:"nowrap"}}>{fmtFull(g.amount)}</td>
                            <td style={{padding:"9px 12px",color:T.ink3,textTransform:"capitalize"}}>{g.type||"cash"}</td>
                            <td style={{padding:"9px 12px",color:T.ink3}}>{g.payment_method||"—"}</td>
                            <td style={{padding:"9px 12px",textAlign:"center"}}>{g.acknowledgement_sent?<span style={{color:"#0d5c3a",fontSize:13}}>✓</span>:<span style={{color:T.ink3,fontSize:13}}>—</span>}</td>
                            <td style={{padding:"9px 12px",whiteSpace:"nowrap"}}>
                              {(()=>{
                                const r=receiptForGift(g.id);
                                if(r) return <button onClick={()=>downloadReceiptPdf(r.id,`receipt-${r.receipt_number}.pdf`)} style={{background:"none",border:"none",color:"#0d5c3a",fontSize:11,fontWeight:700,cursor:"pointer",padding:"2px 4px"}}>Receipt ✓ #{r.receipt_number}</button>;
                                if(!receiptsEnabled) return <span style={{color:T.ink3,fontSize:13}}>—</span>;
                                const busy=receiptBusyId===g.id;
                                return <button onClick={()=>sendReceipt(g.id)} disabled={busy||isReadOnly} title={isReadOnly?"Reactivate your subscription to make changes.":""} style={{background:"none",border:"1px solid "+T.bg3,borderRadius:6,color:isReadOnly?T.ink3:"#0d5c3a",fontSize:11,fontWeight:600,cursor:isReadOnly?"not-allowed":"pointer",padding:"3px 8px",opacity:busy?0.6:1}}>{busy?"Sending…":"Send receipt"}</button>;
                              })()}
                            </td>
                            <td style={{padding:"9px 12px",color:T.ink3,maxWidth:180,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}
                              title={[g.notes,...giftCfDefs.map(d=>{const v=(g.custom_fields||{})[d.key];return (v!==null&&v!==undefined&&v!=="")?`${d.label}: ${renderCustomValue(d,v)}`:null;}).filter(Boolean)].filter(Boolean).join(" · ")}>
                              {[g.notes,...giftCfDefs.map(d=>{const v=(g.custom_fields||{})[d.key];return (v!==null&&v!==undefined&&v!=="")?`${d.label}: ${renderCustomValue(d,v)}`:null;}).filter(Boolean)].filter(Boolean).join(" · ")}</td>
                            <td style={{padding:"9px 12px",whiteSpace:"nowrap"}}>
                              <button onClick={()=>{setGiftEditId(g.id);setGiftEditForm({amount:g.amount,date:g.date,type:g.type,payment_method:g.payment_method||"",notes:g.notes||"",fund_id:g.fund_id||"",acknowledgement_sent:g.acknowledgement_sent,customFields:Object.fromEntries(giftCfDefs.map(d=>[d.key,giftCfEditStr(d,(g.custom_fields||{})[d.key])]))});}} style={{background:"none",border:"none",color:T.ink3,fontSize:12,cursor:"pointer",padding:"2px 6px"}}>Edit</button>
                              <button onClick={()=>deleteGift(g.id)} style={{background:"none",border:"none",color:"#b8593f",fontSize:12,cursor:"pointer",padding:"2px 6px"}}>Delete</button>
                            </td>
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Pledges — a promise to give $X by a future date. Past-due
                unfulfilled pledges get reminders on the same cadence as the
                recurring-gift dunning system (see processPledgeReminders in
                server.js). Distinct from both Gift History above (money
                already received) and Planned Giving below (bequests/trusts,
                no due date). */}
            <div>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
                <div style={{fontSize:12,fontWeight:700,color:T.ink}}>Pledges</div>
                <button onClick={()=>setAddPledgeOpen(v=>!v)} disabled={isReadOnly} title={isReadOnly?"Reactivate your subscription to make changes.":undefined} style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"5px 10px",color:T.ink3,fontSize:11,cursor:isReadOnly?"not-allowed":"pointer",opacity:isReadOnly?0.5:1}}>+ Add Pledge</button>
              </div>
              {addPledgeOpen&&<div style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:10,padding:"14px",marginBottom:10}}>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
                  <input value={pledgeForm.amount} onChange={e=>setPledgeForm(p=>({...p,amount:e.target.value}))} placeholder="Pledged amount ($)" type="number" style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"7px 10px",color:T.ink,fontSize:12,outline:"none"}}/>
                  <input value={pledgeForm.dueDate} onChange={e=>setPledgeForm(p=>({...p,dueDate:e.target.value}))} type="date" style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"7px 10px",color:T.ink,fontSize:12,outline:"none"}}/>
                </div>
                {/* Attribution FIX — a pledge attributes at pledge time (capital
                    campaigns are mostly pledges). Payments against it inherit the
                    campaign; the campaign shows this as "pledged" until paid. */}
                {campaigns.length>0&&(
                  <select value={pledgeForm.campaignId} onChange={e=>setPledgeForm(p=>({...p,campaignId:e.target.value}))}
                    style={{width:"100%",boxSizing:"border-box",background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"7px 10px",color:T.ink,fontSize:12,outline:"none",marginBottom:8,cursor:"pointer"}}>
                    <option value="">No campaign — general pledge</option>
                    {campaigns.map(c=><option key={c.id} value={c.id}>Counts toward: {c.name}</option>)}
                  </select>
                )}
                <input value={pledgeForm.notes} onChange={e=>setPledgeForm(p=>({...p,notes:e.target.value}))} placeholder="Notes (optional)" style={{width:"100%",background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"7px 10px",color:T.ink,fontSize:12,outline:"none",boxSizing:"border-box",marginBottom:8}}/>
                <div style={{display:"flex",gap:8}}>
                  <button onClick={addPledge} disabled={pledgeSaving} style={{background:T.terracotta,border:"none",borderRadius:8,padding:"7px 14px",color:"#fff",fontSize:12,fontWeight:700,cursor:"pointer"}}>Save</button>
                  <button onClick={()=>setAddPledgeOpen(false)} style={{background:T.bg,border:"none",borderRadius:8,padding:"7px 12px",color:T.ink3,fontSize:12,cursor:"pointer"}}>Cancel</button>
                </div>
              </div>}
              {pledges.length===0?<div style={{fontSize:12,color:T.ink3,fontStyle:"italic"}}>No pledges on file</div>:(
                <div style={{display:"flex",flexDirection:"column",gap:6}}>
                  {pledges.map(pl=>{
                    const PL_META={open:{label:"Open",color:T.green500},fulfilled:{label:"Fulfilled",color:T.greenMid},written_off:{label:"Written off",color:T.ink3}};
                    const meta=PL_META[pl.status]||PL_META.open;
                    const isOverdue=pl.status==="open"&&pl.first_overdue_at;
                    const daysOver=isOverdue?daysDiff(pl.due_date):null;
                    return(
                      <div key={pl.id} style={{background:T.white,border:`1px solid ${isOverdue?T.terracotta+"40":T.bg3}`,borderLeft:`3px solid ${isOverdue?T.terracotta:meta.color}`,borderRadius:10,padding:"10px 14px",display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:10,flexWrap:"wrap"}}>
                        <div>
                          <div style={{display:"flex",alignItems:"center",gap:7,flexWrap:"wrap"}}>
                            <span style={{fontSize:14,fontWeight:800,color:T.ink}}>{fmtFull(pl.amount)}</span>
                            <span style={{background:meta.color+"15",color:meta.color,border:"1px solid "+meta.color+"40",borderRadius:99,padding:"2px 8px",fontSize:10,fontWeight:800}}>{meta.label}</span>
                            {isOverdue&&<span style={{fontSize:10,fontWeight:800,color:T.terracotta}}>{daysOver}d overdue · reminder {Math.min(pl.reminder_step+1,4)}/4 sent</span>}
                          </div>
                          <div style={{fontSize:11,color:T.ink3,marginTop:2}}>Due {pl.due_date}{pl.campaign_id?(()=>{const c=campaigns.find(x=>x.id===pl.campaign_id);return c?` · counts toward ${c.name}`:"";})():""}</div>
                          {pl.notes&&<div style={{fontSize:12,color:T.ink3,marginTop:3,lineHeight:1.4}}>{pl.notes}</div>}
                        </div>
                        <div style={{display:"flex",gap:6,alignItems:"center",flexShrink:0}}>
                          {pl.status==="open"&&<>
                            {isOverdue&&<button onClick={()=>resendPledgeReminder(pl.id)} disabled={isReadOnly||pledgeResendBusyId===pl.id||pledgeResentIds.has(pl.id)}
                              style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:6,padding:"5px 9px",color:T.ink2,fontSize:11,fontWeight:600,cursor:(isReadOnly||pledgeResendBusyId===pl.id||pledgeResentIds.has(pl.id))?"not-allowed":"pointer",opacity:(isReadOnly||pledgeResendBusyId===pl.id||pledgeResentIds.has(pl.id))?0.5:1}}>
                              {pledgeResentIds.has(pl.id)?"Sent ✓":pledgeResendBusyId===pl.id?"Sending…":"Resend reminder"}
                            </button>}
                            <button onClick={()=>setPledgeStatus(pl.id,"fulfilled")} disabled={isReadOnly} style={{background:"#edf3ee",border:"1px solid #0d5c3a",borderRadius:6,padding:"5px 9px",color:"#0d5c3a",fontSize:11,fontWeight:600,cursor:isReadOnly?"not-allowed":"pointer"}}>Mark Fulfilled</button>
                            <button onClick={()=>setPledgeStatus(pl.id,"written_off")} disabled={isReadOnly} style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:6,padding:"5px 9px",color:T.ink3,fontSize:11,fontWeight:600,cursor:isReadOnly?"not-allowed":"pointer"}}>Write Off</button>
                          </>}
                          <button onClick={()=>deletePledge(pl.id)} style={{background:"none",border:"none",color:"#b8593f",fontSize:14,cursor:"pointer",flexShrink:0,padding:"2px 4px"}}>×</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Planned Giving */}
            <div>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
                <div style={{fontSize:12,fontWeight:700,color:T.ink,display:"flex",alignItems:"center",gap:7}}>
                  Planned Giving
                  {donor.plannedGiving&&<span style={{background:T.green100,color:T.greenDk,border:"1px solid "+T.green200,borderRadius:99,padding:"2px 8px",fontSize:10,fontWeight:700}}>Indicated</span>}
                </div>
                <button onClick={()=>setAddPgOpen(v=>!v)} style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"5px 10px",color:T.ink3,fontSize:11,cursor:"pointer"}}>+ Add</button>
              </div>
              {addPgOpen&&<div style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:10,padding:"14px",marginBottom:10}}>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
                  <select value={pgForm.type} onChange={e=>setPgForm(p=>({...p,type:e.target.value}))} style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"7px 10px",color:T.ink,fontSize:12,outline:"none"}}>
                    {["bequest","charitable_remainder_trust","charitable_lead_trust","annuity","ira_beneficiary","life_insurance","real_estate","other"].map(t=><option key={t} value={t}>{t.replace(/_/g," ")}</option>)}
                  </select>
                  <input value={pgForm.estimated_value} onChange={e=>setPgForm(p=>({...p,estimated_value:e.target.value}))} placeholder="Estimated value ($)" type="number" style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"7px 10px",color:T.ink,fontSize:12,outline:"none"}}/>
                  <input value={pgForm.date_indicated} onChange={e=>setPgForm(p=>({...p,date_indicated:e.target.value}))} type="date" placeholder="Date indicated" style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"7px 10px",color:T.ink,fontSize:12,outline:"none"}}/>
                  <input value={pgForm.notes} onChange={e=>setPgForm(p=>({...p,notes:e.target.value}))} placeholder="Notes" style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"7px 10px",color:T.ink,fontSize:12,outline:"none"}}/>
                </div>
                <div style={{display:"flex",gap:8}}>
                  <button onClick={addPlannedGift} disabled={pgSaving} style={{background:T.gold500,border:"none",borderRadius:8,padding:"7px 14px",color:T.ink,fontSize:12,fontWeight:700,cursor:"pointer"}}>Save</button>
                  <button onClick={()=>setAddPgOpen(false)} style={{background:T.bg,border:"none",borderRadius:8,padding:"7px 12px",color:T.ink3,fontSize:12,cursor:"pointer"}}>Cancel</button>
                </div>
              </div>}
              {plannedGifts.length===0?<div style={{fontSize:12,color:T.ink3,fontStyle:"italic"}}>No planned giving on file</div>:(
                <div style={{display:"flex",flexDirection:"column",gap:6}}>
                  {plannedGifts.map(pg=>(
                    <div key={pg.id} style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:10,padding:"10px 14px",display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:10}}>
                      <div>
                        <div style={{fontSize:13,fontWeight:700,color:T.greenDk,textTransform:"capitalize"}}>{(pg.type||"").replace(/_/g," ")}</div>
                        {pg.estimated_value&&<div style={{fontSize:12,color:T.ink3,marginTop:2}}>Est. {fmtFull(pg.estimated_value)}</div>}
                        {pg.date_indicated&&<div style={{fontSize:11,color:T.ink3,marginTop:1}}>Indicated {pg.date_indicated}</div>}
                        {pg.notes&&<div style={{fontSize:12,color:T.ink3,marginTop:3,lineHeight:1.4}}>{pg.notes}</div>}
                      </div>
                      <button onClick={()=>deletePlannedGift(pg.id)} style={{background:"none",border:"none",color:"#b8593f",fontSize:12,cursor:"pointer",flexShrink:0,padding:"2px 4px"}}>×</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>}

          {/* Materials tab */}
          {/* Funds tab */}
          {dpTab==="funds"&&<div style={{padding:"20px 20px 24px 24px",display:"flex",flexDirection:"column",gap:18}}>
            {fundLoading&&<div style={{textAlign:"center",color:T.ink3,fontSize:12,padding:24}}><Spin/></div>}
            {!fundLoading&&fundAffinity&&(()=>{
              const {affinity,unrestrictedTotal,restrictedTotal,totalGiving,activeFunds}=fundAffinity;
              const maxFund=affinity.length>0?affinity[0].total:1;
              return(<>
                <div>
                  <div style={{fontSize:14,fontWeight:800,color:T.ink,marginBottom:14}}>What they support</div>
                  {affinity.length===0
                    ?<div style={{fontSize:13,color:T.ink3,fontStyle:"italic"}}>No fund-attributed gifts yet. Assign funds when logging gifts.</div>
                    :<div style={{display:"flex",flexDirection:"column",gap:10}}>
                      {affinity.map(f=>(
                        <div key={f.fundId} style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:12,padding:"14px 16px"}}>
                          <div style={{display:"flex",alignItems:"baseline",justifyContent:"space-between",marginBottom:6}}>
                            <div>
                              <span style={{fontSize:13,fontWeight:700,color:T.ink}}>{f.fundName}</span>
                              {f.restricted&&<span style={{marginLeft:6,fontSize:10,fontWeight:700,color:T.gold700,background:T.gold100,borderRadius:99,padding:"2px 7px"}}>Restricted</span>}
                            </div>
                            <div style={{textAlign:"right"}}>
                              <div style={{fontSize:14,fontWeight:800,color:"#0d5c3a"}}>{fmtFull(f.total)}</div>
                              <div style={{fontSize:10,color:T.ink3}}>{f.pct}% of lifetime</div>
                            </div>
                          </div>
                          <div style={{background:T.bg3,borderRadius:99,height:6,overflow:"hidden",marginBottom:6}}>
                            <div style={{height:"100%",background:"#0d5c3a",borderRadius:99,width:`${Math.round(f.total/maxFund*100)}%`,transition:"width 0.4s"}}/>
                          </div>
                          <div style={{fontSize:11,color:T.ink3}}>{f.giftCount} gift{f.giftCount!==1?"s":""} · Last: {f.lastDate}</div>
                        </div>
                      ))}
                    </div>
                  }
                </div>

                <div style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:12,padding:"14px 16px"}}>
                  <div style={{fontSize:12,fontWeight:700,color:T.ink,marginBottom:10}}>Restricted vs Unrestricted</div>
                  {totalGiving>0?(()=>{
                    const rPct=Math.round(restrictedTotal/totalGiving*100);
                    const uPct=100-rPct;
                    return(<>
                      <div style={{height:10,borderRadius:99,overflow:"hidden",display:"flex",marginBottom:8}}>
                        <div style={{width:`${rPct}%`,background:T.gold500,transition:"width 0.4s"}}/>
                        <div style={{flex:1,background:"#0d5c3a"}}/>
                      </div>
                      <div style={{display:"flex",gap:16,fontSize:12}}>
                        <div style={{display:"flex",alignItems:"center",gap:5}}><span style={{width:10,height:10,borderRadius:2,background:T.gold500,display:"inline-block"}}/>Restricted: {fmtFull(restrictedTotal)} ({rPct}%)</div>
                        <div style={{display:"flex",alignItems:"center",gap:5}}><span style={{width:10,height:10,borderRadius:2,background:"#0d5c3a",display:"inline-block"}}/>Unrestricted: {fmtFull(unrestrictedTotal)} ({uPct}%)</div>
                      </div>
                    </>);
                  })():<div style={{fontSize:12,color:T.ink3,fontStyle:"italic"}}>No giving data yet</div>}
                </div>

                {affinity.length>0&&(
                  <div style={{background:"#c9a84c10",border:"1px solid #c9a84c40",borderRadius:12,padding:"14px 16px"}}>
                    <div style={{fontSize:12,fontWeight:700,color:"#c9a84c",marginBottom:8}}>Suggested Asks</div>
                    {affinity.slice(0,2).map(f=>(
                      <div key={f.fundId} style={{fontSize:12,color:T.ink,marginBottom:4}}>
                        This donor has given {fmtFull(f.total)} to <strong>{f.fundName}</strong>. Consider them for {f.fundName} campaign appeals.
                      </div>
                    ))}
                    {activeFunds.filter(f=>!affinity.find(a=>a.fundId===f.id)).length>0&&(
                      <div style={{fontSize:12,color:T.ink3,marginTop:8}}>
                        Not yet engaged with: {activeFunds.filter(f=>!affinity.find(a=>a.fundId===f.id)).map(f=>f.name).slice(0,3).join(", ")}
                      </div>
                    )}
                  </div>
                )}
              </>);
            })()}
            {!fundLoading&&!fundAffinity&&<div style={{fontSize:13,color:T.ink3,fontStyle:"italic",textAlign:"center",padding:24}}>Could not load fund data.</div>}
          </div>}

          {/* Related tab — manual household/spouse/family/employer_match
              links. No auto-detection (matching last name, address, etc.) —
              a real fast-follow idea, not built here. */}
          {dpTab==="related"&&<div style={{padding:"20px 20px 24px 24px",display:"flex",flexDirection:"column",gap:16}}>
            {householdTotal!=null&&(
              <div style={{background:T.gold+"12",border:"1px solid "+T.gold+"40",borderRadius:12,padding:"12px 16px"}}>
                <div style={{fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.08em",color:T.ink3,marginBottom:4}}>Household Giving</div>
                <div style={{fontSize:13,color:T.ink}}><strong>{fmtFull(donor.total)}</strong> individually · <strong style={{color:"#8a6d1f"}}>{fmtFull(householdTotal)}</strong> household total</div>
              </div>
            )}

            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
              <div style={{fontSize:14,fontWeight:800,color:T.ink}}>Linked Donors</div>
              {!isReadOnly&&<button onClick={()=>{setRelPickerOpen(v=>!v);setRelErr("");}} style={{background:"#0d5c3a",border:"none",borderRadius:7,padding:"6px 12px",color:"#fff",fontSize:12,fontWeight:700,cursor:"pointer"}}>+ Link to another donor</button>}
            </div>

            {relPickerOpen&&(
              <div style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:10,padding:12,display:"flex",flexDirection:"column",gap:8}}>
                <div style={{display:"flex",gap:8}}>
                  {DONOR_RELATIONSHIP_LABELS.map(([v,l])=>(
                    <button key={v} onClick={()=>setRelType(v)} style={{background:relType===v?T.greenDk+"18":T.white,border:`1px solid ${relType===v?T.greenDk:T.bg3}`,borderRadius:7,padding:"5px 10px",color:relType===v?T.greenDk:T.ink3,fontSize:11,fontWeight:600,cursor:"pointer"}}>{l}</button>
                  ))}
                </div>
                <input value={relSearch} onChange={e=>setRelSearch(e.target.value)} placeholder="Search donors by name…" style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:8,padding:"8px 12px",color:T.ink,fontSize:13,outline:"none"}}/>
                {relSearch.trim()&&(
                  <div style={{display:"flex",flexDirection:"column",gap:4,maxHeight:180,overflowY:"auto"}}>
                    {relPickerResults.length===0
                      ?<div style={{fontSize:12,color:T.ink3,fontStyle:"italic",padding:"6px 4px"}}>No matching donors.</div>
                      :relPickerResults.map(d=>(
                        <button key={d.id} disabled={relSaving} onClick={()=>linkDonor(d.id)} style={{display:"flex",justifyContent:"space-between",alignItems:"center",background:T.white,border:"1px solid "+T.bg3,borderRadius:8,padding:"7px 10px",cursor:relSaving?"not-allowed":"pointer",textAlign:"left"}}>
                          <span style={{fontSize:12,fontWeight:600,color:T.ink}}>{d.name}</span>
                          <span style={{fontSize:11,color:T.ink3}}>{fmtFull(d.total)} →</span>
                        </button>
                      ))}
                  </div>
                )}
                {relErr&&<div style={{color:"#b8593f",fontSize:12}}>{relErr}</div>}
              </div>
            )}

            {relLoading?<div style={{padding:20,textAlign:"center"}}><Spin/></div>
              :relationships.length===0
                ?<div style={{fontSize:13,color:T.ink3,fontStyle:"italic",textAlign:"center",padding:24}}>No linked donors yet.</div>
                :<div style={{display:"flex",flexDirection:"column",gap:8}}>
                  {relationships.map(r=>(
                    <div key={r.id} style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,background:T.white,border:"1px solid "+T.bg3,borderRadius:10,padding:"11px 14px"}}>
                      <div onClick={()=>onSelectRelatedDonor&&onSelectRelatedDonor(r.relatedDonorId)} style={{cursor:onSelectRelatedDonor?"pointer":"default",minWidth:0}}>
                        <div style={{fontSize:13,fontWeight:700,color:T.ink}}>{r.relatedDonorName} →</div>
                        <div style={{fontSize:11,color:T.ink3,marginTop:2}}>{fmtFull(r.relatedDonorTotalGiving)} lifetime</div>
                      </div>
                      <div style={{display:"flex",alignItems:"center",gap:8,flexShrink:0}}>
                        <Pill label={DONOR_RELATIONSHIP_LABELS.find(([v])=>v===r.relationshipType)?.[1]||r.relationshipType}/>
                        {!isReadOnly&&<button onClick={()=>unlinkDonor(r.id)} style={{background:"transparent",border:"1px solid #b8593f55",borderRadius:7,padding:"4px 9px",color:"#b8593f",fontSize:11,cursor:"pointer"}}>Remove</button>}
                      </div>
                    </div>
                  ))}
                </div>
            }
          </div>}

          {dpTab==="materials"&&<div style={{padding:"20px 20px 24px 24px",display:"flex",flexDirection:"column",gap:16}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
              <div style={{fontSize:14,fontWeight:800,color:T.ink}}>Donor Materials</div>
            </div>
            <Uploader accept={[]} readAs="none" busy={matUploading}
              label={matUploading?"Uploading…":"Drop a file here, or browse — proposals, letters, research (any file type)"}
              onFile={({file})=>uploadMaterial(file)}/>
            {matLoading?<div style={{textAlign:"center",color:T.ink3,fontSize:12,padding:16}}><Spin/></div>:materials.length===0?<div style={{fontSize:12,color:T.ink3,fontStyle:"italic",textAlign:"center",padding:16}}>No materials uploaded yet</div>:(
              <div style={{display:"flex",flexDirection:"column",gap:8}}>
                {materials.map(m=>(
                  <div key={m.id} style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:10,padding:"12px 14px",display:"flex",alignItems:"center",gap:12}}>
                    <div style={{fontSize:22,flexShrink:0}}>
                      ▤
                    </div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:13,fontWeight:600,color:T.ink,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{m.file_name}</div>
                      <div style={{fontSize:11,color:T.ink3,marginTop:1}}>{m.uploaded_by&&`Uploaded by ${m.uploaded_by} · `}{new Date(m.uploaded_at).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})}</div>
                      {m.notes&&<div style={{fontSize:11,color:T.ink3,marginTop:2}}>{m.notes}</div>}
                    </div>
                    <div style={{display:"flex",gap:6,flexShrink:0}}>
                      {(m.file_data||m.file_url)&&<button onClick={()=>viewMaterial(m)} style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:7,padding:"5px 10px",color:T.ink3,fontSize:11,cursor:"pointer"}}>View</button>}
                      <button onClick={()=>deleteMaterial(m.id)} style={{background:"none",border:"1px solid #b8593f30",borderRadius:7,padding:"5px 10px",color:"#b8593f",fontSize:11,cursor:"pointer"}}>Delete</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>}

          {/* Activity tab */}
          {dpTab==="activity"&&<div style={{padding:"20px 20px 24px 24px",display:"flex",flexDirection:"column",gap:14}}>
            {/* Mode toggle */}
            <div style={{display:"flex",background:T.bg,border:"1px solid "+T.bg3,borderRadius:10,overflow:"hidden",alignSelf:"flex-start"}}>
              {[["log","Activity Log"],["timeline","Stewardship Timeline"]].map(([m,l])=>(
                <button key={m} onClick={()=>setActMode(m)} style={{background:actMode===m?T.white:"transparent",border:"none",padding:"8px 16px",color:actMode===m?T.ink:T.ink3,fontSize:12,fontWeight:actMode===m?700:400,cursor:"pointer"}}>
                  {l}
                </button>
              ))}
            </div>

            {actMode==="log"&&<>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:8}}>
                <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                  {["all","call","meeting","email","gift","event","stewardship","note"].map(t=>(
                    <button key={t} onClick={()=>setActFilter(t)} style={{background:actFilter===t?T.greenDk:"transparent",border:`1px solid ${actFilter===t?T.greenDk:T.bg3}`,borderRadius:99,padding:"4px 10px",color:actFilter===t?"#fff":T.ink3,fontSize:11,cursor:"pointer",fontWeight:actFilter===t?700:400,textTransform:"capitalize"}}>
                      {t}
                    </button>
                  ))}
                </div>
                <div style={{display:"flex",gap:6}}>
                  <button onClick={()=>setStwOpen(v=>!v)} style={{background:"#0d5c3a10",border:"1px solid #0d5c3a30",borderRadius:8,padding:"7px 12px",color:"#0d5c3a",fontSize:12,fontWeight:700,cursor:"pointer"}}>Log Stewardship</button>
                  <button onClick={onLogTouchpoint} style={{background:"#0d5c3a",border:"none",borderRadius:8,padding:"7px 12px",color:"#fff",fontSize:12,fontWeight:700,cursor:"pointer"}}>+ Log Touchpoint</button>
                </div>
              </div>
              {stwOpen&&<div style={{background:T.white,border:"1px solid #0d5c3a30",borderRadius:12,padding:"14px 16px"}}>
                <div style={{fontSize:12,fontWeight:700,color:T.ink,marginBottom:10}}>Log Stewardship Touch</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
                  <select value={stwForm.type} onChange={e=>setStwForm(p=>({...p,type:e.target.value}))} style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"7px 10px",color:T.ink,fontSize:12,outline:"none"}}>
                    {[["thank_you","Thank You Sent"],["recognition","Recognition"],["gift_sent","Gift Sent"],["impact_update","Impact Update"],["appreciation_event","Appreciation Event"],["holiday_card","Holiday Card"],["birthday","Birthday"],["other","Other"]].map(([v,l])=><option key={v} value={v}>{l}</option>)}
                  </select>
                  <input value={stwForm.date} onChange={e=>setStwForm(p=>({...p,date:e.target.value}))} type="date" style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"7px 10px",color:T.ink,fontSize:12,outline:"none"}}/>
                  <input value={stwForm.detail} onChange={e=>setStwForm(p=>({...p,detail:e.target.value}))} placeholder="What was sent/done (e.g. signed book, tote bag)" style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"7px 10px",color:T.ink,fontSize:12,outline:"none",gridColumn:"1/-1"}}/>
                  <input value={stwForm.note} onChange={e=>setStwForm(p=>({...p,note:e.target.value}))} placeholder="Optional note" style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"7px 10px",color:T.ink,fontSize:12,outline:"none",gridColumn:"1/-1"}}/>
                </div>
                <div style={{display:"flex",gap:8}}>
                  <button onClick={saveStewardship} disabled={stwSaving} style={{background:"#0d5c3a",border:"none",borderRadius:8,padding:"7px 14px",color:"#fff",fontSize:12,fontWeight:700,cursor:"pointer"}}>Save</button>
                  <button onClick={()=>setStwOpen(false)} style={{background:T.bg,border:"none",borderRadius:8,padding:"7px 12px",color:T.ink3,fontSize:12,cursor:"pointer"}}>Cancel</button>
                </div>
              </div>}
              <div style={{display:"flex",flexDirection:"column",gap:8}}>
                {(localInts??donor.interactions??[]).filter(i=>actFilter==="all"||i.type===actFilter).map(i=>{
                  const typeIcon="•";
                  // BUILD-88a A.1 — the row LINKS to its gift and holds no copy
                  // of the amount; the money is read off the gift itself.
                  const linkedGift=i.gift_id?giftsFull.find(g=>g.id===i.gift_id):null;
                  const typeColor={call:T.green500,meeting:T.greenMid,email:T.greenDk,gift:T.gold600,event:T.gold500,stewardship:T.green,stage_change:T.green500,planned_gift:T.gold700,material:T.ink3}[i.type]||T.ink3;
                  return(<div key={i.id||i.date} className="tp-row" style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:10,padding:"10px 14px",display:"flex",gap:10,alignItems:"flex-start"}}>
                    <div style={{fontSize:16,flexShrink:0,marginTop:1,color:typeColor}}>{typeIcon}</div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{display:"flex",alignItems:"baseline",gap:8,flexWrap:"wrap"}}>
                        <span style={{fontSize:11,fontWeight:700,color:typeColor,textTransform:"capitalize"}}>{(i.type||"note").replace(/_/g," ")}</span>
                        <span style={{fontSize:11,color:T.ink3}}>{i.date}</span>
                        {/* BUILD-88a A.4 — a colleague is a FIRST NAME. "by Admin User"
                            is the software talking to itself. */}
                        {i.logged_by_name&&<span style={{fontSize:10,color:T.ink3,fontStyle:"italic"}}>by {firstNameOf(i.logged_by_name)}</span>}
                      </div>
                      {linkedGift&&<div style={{fontSize:12,color:T.ink,marginTop:3,fontWeight:700}}>{fmtFull(linkedGift.amount)}{linkedGift.payment_method?` · ${linkedGift.payment_method}`:""}</div>}
                      {(()=>{const txt=linkedGift?stripGiftAmountPrefix(i.note):i.note;
                        return txt?<div style={{fontSize:12,color:T.ink,marginTop:3,lineHeight:1.5,whiteSpace:"pre-wrap"}}>{txt}</div>:null;})()}
                    </div>
                    {i.id&&<button className="tp-del-btn" title="Delete this entry" aria-label="Delete this entry"
                      onClick={()=>{if(window.confirm("Delete this timeline entry? This can't be undone."))deleteInteraction(i);}}
                      style={{background:"transparent",border:"none",cursor:"pointer",color:T.terracotta,fontSize:14,padding:"2px 4px",flexShrink:0,lineHeight:1}}>✕</button>}
                  </div>);
                })}
                {(localInts??donor.interactions??[]).filter(i=>actFilter==="all"||i.type===actFilter).length===0&&<div style={{fontSize:12,color:T.ink3,fontStyle:"italic",textAlign:"center",padding:16}}>No activity logged yet</div>}
              </div>
            </>}

            {actMode==="timeline"&&(()=>{
              const ints=localInts??donor.interactions??[];
              const sortedGiftsForTimeline=[...giftsFull].sort((a,b)=>new Date(a.date)-new Date(b.date));
              const firstGiftDate=sortedGiftsForTimeline[0]?.date;
              const largestGift=sortedGiftsForTimeline.reduce((m,g)=>g.amount>m.amount?g:m,{amount:0,date:""});
              // BUILD-88a A.1 — A GIFT APPEARS ONCE. The record used to draw
              // the same gift twice: a "First gift $5,000" milestone from the
              // gift row AND a "Gift received: $5,000" line from an interaction
              // written beside it with the amount copied into its text. That is
              // what the Renee Castillo demo record was showing. The gift row is
              // the fact; a milestone is a LABEL ON it, not a second card, and a
              // linked timeline entry renders its money from the gift.
              const giftIdsOnTimeline=new Set(ints.filter(i=>i.gift_id).map(i=>i.gift_id));
              const milestoneFor=g=>{
                if(!g||!g.id)return null;
                if(g.date===firstGiftDate&&g.id===sortedGiftsForTimeline[0]?.id)return "First gift";
                if(largestGift.amount>0&&g.id===largestGift.id&&g.date!==firstGiftDate)return "Largest gift";
                return null;
              };
              const milestones=[];
              // A gift with no timeline entry of its own (imported history, or a
              // gift logged before A.1) still earns its card — once.
              for(const g of sortedGiftsForTimeline){
                if(giftIdsOnTimeline.has(g.id))continue;
                const m=milestoneFor(g);
                milestones.push({date:g.date,icon:m?"✦":"•",label:m||"Gift",
                  desc:`${fmtFull(g.amount)}${g.payment_method?` · ${g.payment_method}`:""}${m==="First gift"?" · the relationship began":""}`,
                  color:"#c9a84c",big:!!m});
              }
              if(firstGiftDate){
                const ann=new Date(firstGiftDate);ann.setFullYear(ann.getFullYear()+1);
                const annStr=ann.toISOString().split("T")[0];
                if(new Date(annStr)<=new Date())milestones.push({date:annStr,icon:"✦",label:"1-year anniversary",desc:"One year as a donor",color:"#c9a84c",big:true});
              }
              let cumulative=0;
              sortedGiftsForTimeline.forEach(g=>{
                const prev=cumulative;cumulative+=g.amount;
                const crossed=[10000,25000,50000,100000,250000].filter(t=>prev<t&&cumulative>=t);
                crossed.forEach(t=>milestones.push({date:g.date,icon:"✦",label:`$${(t/1000)}k milestone`,desc:`Lifetime giving crossed $${(t/1000)}k`,color:"#c9a84c",big:true}));
              });

              const events=[
                ...ints.filter(i=>["call","meeting","email","gift","event","stewardship","stage_change","planned_gift","ask"].includes(i.type)).map(i=>{
                  const g=i.gift_id?sortedGiftsForTimeline.find(x=>x.id===i.gift_id):null;
                  const m=g?milestoneFor(g):null;
                  return{
                    date:i.date,
                    icon:m?"✦":"•",
                    label:m||(i.type||"note").replace(/_/g," "),
                    desc:g?(()=>{const t=stripGiftAmountPrefix(i.note);
                      return `${fmtFull(g.amount)}${g.payment_method?` · ${g.payment_method}`:""}${t?` · ${t}`:""}`;})():(i.note||""),
                    color:{call:T.green500,meeting:T.greenMid,email:T.greenDk,gift:T.gold600,event:T.gold500,stewardship:T.green,stage_change:T.green500,planned_gift:T.gold700}[i.type]||T.ink3,
                    big:!!m,
                    loggedBy:i.logged_by_name,
                  };
                }),
                ...milestones,
              ].sort((a,b)=>new Date(b.date)-new Date(a.date));

              if(events.length===0)return<div style={{fontSize:12,color:T.ink3,fontStyle:"italic",textAlign:"center",padding:24}}>No timeline events yet. Log touchpoints and gifts to build the relationship arc.</div>;

              return(<div style={{position:"relative",paddingLeft:28}}>
                <div style={{position:"absolute",left:10,top:0,bottom:0,width:2,background:"linear-gradient(to bottom, #0d5c3a, #c9a84c44)"}}/>
                {events.map((ev,i)=>(
                  <div key={i} style={{position:"relative",marginBottom:ev.big?20:14}}>
                    <div style={{position:"absolute",left:-28,width:ev.big?20:16,height:ev.big?20:16,borderRadius:"50%",background:ev.color,display:"flex",alignItems:"center",justifyContent:"center",fontSize:ev.big?11:9,border:`2px solid ${T.white}`,boxShadow:`0 0 0 2px ${ev.color}44`,top:0,flexShrink:0,zIndex:1}}>
                      {ev.icon}
                    </div>
                    <div style={{background:ev.big?"#c9a84c08":T.white,border:`1px solid ${ev.big?"#c9a84c40":T.bg3}`,borderRadius:10,padding:ev.big?"12px 14px":"9px 13px",marginLeft:4}}>
                      <div style={{display:"flex",alignItems:"baseline",gap:8,flexWrap:"wrap"}}>
                        <span style={{fontSize:12,fontWeight:ev.big?800:700,color:ev.color,textTransform:"capitalize"}}>{ev.label}</span>
                        <span style={{fontSize:11,color:T.ink3}}>{ev.date}</span>
                        {ev.loggedBy&&<span style={{fontSize:10,color:T.ink3,fontStyle:"italic"}}>by {firstNameOf(ev.loggedBy)}</span>}
                      </div>
                      {ev.desc&&<div style={{fontSize:12,color:T.ink,marginTop:2,lineHeight:1.4}}>{ev.desc}</div>}
                    </div>
                  </div>
                ))}
              </div>);
            })()}
          </div>}
        </div>

        {/* RIGHT */}
        <div style={{overflowY:"auto",padding:"22px 24px 24px 20px",display:"flex",flexDirection:"column",gap:18,background:"#0f1a12"}}>
          {donor.stripeSubscriptionStatus==="active"&&(
            <div style={{background:"#0d5c3a10",border:"1px solid #0d5c3a30",borderRadius:12,padding:"12px 14px",display:"flex",alignItems:"center",gap:8}}>
              <span style={{fontSize:16}}>↻</span>
              <div>
                <div style={{fontSize:12,fontWeight:700,color:"#0d5c3a"}}>Recurring Donor</div>
                <div style={{fontSize:11,color:"#0d5c3a",marginTop:1}}>Active {donor.stripeSubscriptionId?"subscription":"recurring gift"}</div>
              </div>
            </div>
          )}
          <div>
            <div style={{fontSize:10,fontWeight:800,textTransform:"uppercase",letterSpacing:"0.12em",color:"rgba(240,237,230,0.7)",marginBottom:8}}>Relationship Owner</div>
            <div style={{background:"#1a2e1f",border:"1px solid #2d4a35",borderRadius:12,padding:"12px 14px"}}>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <div style={{width:28,height:28,borderRadius:"50%",background:T.greenDk+"44",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:800,color:"#0d5c3a",flexShrink:0}}>{(donor.assignedToName||"?")[0]}</div>
                {/* BUILD-88a A.4 — a colleague is a FIRST NAME here too. */}
                <div style={{flex:1,fontSize:13,fontWeight:600,color:"#f0ede6"}}>{firstNameOf(donor.assignedToName)||"Unassigned"}</div>
                {/* Reassigning a relationship owner is portfolio management → Team.
                    Core sees the owner read-only; the server 403s the assign route. */}
                {isAdmin&&isTeam&&<button onClick={()=>setShowReassign(v=>!v)} style={{background:"#0f1a12",border:"1px solid #2d4a35",borderRadius:7,padding:"3px 10px",color:"rgba(240,237,230,0.7)",fontSize:11,cursor:"pointer"}}>{showReassign?"Cancel":"Reassign"}</button>}
              </div>
              {showReassign&&isAdmin&&isTeam&&<div style={{marginTop:10,display:"flex",flexDirection:"column",gap:8}}>
                <select value={reassignId} onChange={e=>setReassignId(e.target.value)} style={{width:"100%",background:"#0f1a12",border:"1px solid #2d4a35",borderRadius:8,padding:"8px 10px",color:"#f0ede6",fontSize:12,outline:"none",cursor:"pointer"}}>
                  <option value="">Select team member…</option>
                  {orgTeam.map(u=><option key={u.id} value={u.id}>{u.name} ({u.role})</option>)}
                </select>
                <button onClick={handleReassign} disabled={reassignLoading||!reassignId} style={{background:reassignId?T.greenDk:"#1a2e1f",border:"none",borderRadius:8,padding:"8px",color:"#f0ede6",fontSize:12,fontWeight:600,cursor:reassignId?"pointer":"not-allowed"}}>
                  {reassignLoading?"Saving…":"Confirm Reassignment"}
                </button>
              </div>}
            </div>
          </div>

          {/* BUILD-88a A.4 — sequences render ONLY with the Team flag. */}
          {isTeam&&sequences.length>0&&(<div data-testid="dp-sequences">
            <div style={{fontSize:10,fontWeight:800,textTransform:"uppercase",letterSpacing:"0.12em",color:"rgba(240,237,230,0.7)",marginBottom:8}}>Sequences</div>
            {seqToast&&<div style={{background:"#0d5c3a22",border:"1px solid #0d5c3a",borderRadius:8,padding:"8px 12px",fontSize:12,color:"#0d5c3a",fontWeight:600,marginBottom:8}}>{seqToast}</div>}
            <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
              {!seqOpen?<button onClick={()=>{setSeqOpen(true);setSeqId("");}} style={{background:"#1a2e1f",border:"1px solid #2d4a35",borderRadius:8,padding:"6px 12px",fontSize:12,color:"#0d5c3a",cursor:"pointer"}}>+ Enroll in sequence</button>
              :<>
                <select value={seqId} onChange={e=>setSeqId(e.target.value)} style={{background:"#0f1a12",border:"1px solid #2d4a35",borderRadius:8,padding:"6px 10px",color:"#f0ede6",fontSize:12,outline:"none",cursor:"pointer",flex:1}}>
                  <option value="">Select sequence…</option>
                  {sequences.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                <button disabled={!seqId||seqLoading} onClick={async()=>{
                  if(!seqId)return;setSeqLoading(true);
                  try{
                    await apiFetch(`/sequences/${seqId}/enroll`,{method:"POST",body:JSON.stringify({donorId:donor.id})});
                    const seqName=sequences.find(s=>s.id===seqId)?.name||"sequence";
                    setSeqToast(`Enrolled in "${seqName}"`);setTimeout(()=>setSeqToast(""),3500);
                    setSeqOpen(false);setSeqId("");
                  }catch(e){alert(errorMessage(e, "Could not enroll"));}
                  setSeqLoading(false);
                }} style={{background:seqId?T.greenDk:"#1a2e1f",border:"none",borderRadius:8,padding:"6px 12px",color:"#f0ede6",fontSize:12,fontWeight:600,cursor:seqId?"pointer":"not-allowed"}}>
                  {seqLoading?"…":"Enroll"}
                </button>
                <button onClick={()=>{setSeqOpen(false);setSeqId("");}} style={{background:"transparent",border:"none",padding:"6px 8px",color:"rgba(240,237,230,0.7)",fontSize:12,cursor:"pointer"}}>✕</button>
              </>}
            </div>
          </div>)}

          {cfData.length>0&&(()=>{
            // BUILD-78 5.1 — custom fields in position order, empty fields
            // collapsed behind a show-all; every edit goes through the same
            // validation seam as import and the API (a refused value names
            // its reason, never silently stores something else).
            const withValues=cfData.filter(f=>f.value!==null&&f.value!==undefined&&f.value!=="");
            const shown=cfShowAll?cfData:withValues;
            const hidden=cfData.length-withValues.length;
            const editStr=f=>{
              const v=f.value;
              if(v===null||v===undefined)return "";
              if(f.type==="money")return Number.isInteger(v)?(v/100).toFixed(2):String(v);
              if(f.type==="checkbox")return v===true?"yes":v===false?"no":String(v);
              if(f.type==="multi_select")return Array.isArray(v)?v.join("; "):String(v);
              return String(v);
            };
            const saveCf=async f=>{
              try{
                const r=await apiFetch(`/donors/${donor.id}/custom-fields`,{method:"PUT",body:JSON.stringify({values:{[f.key]:cfEditVal}})});
                setCfData(prev=>prev.map(x=>x.key===f.key?{...x,value:r.customFields[f.key]!==undefined?r.customFields[f.key]:null}:x));
                setCfSaved(f.key);setTimeout(()=>setCfSaved(null),2000);
                setCfEditing(null);setCfError("");onCfSaved?.();
              }catch(e){
                setCfError(e?.errors?.[0]?.error||errorMessage(e, "That value was refused"));
              }
            };
            return <div>
            <div style={{fontSize:10,fontWeight:800,textTransform:"uppercase",letterSpacing:"0.12em",color:"rgba(240,237,230,0.7)",marginBottom:8}}>Custom Fields</div>
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {shown.map(f=>(
                <div key={f.key} style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8}}>
                  <div style={{fontSize:12,color:"rgba(240,237,230,0.7)",fontWeight:600,minWidth:90,flexShrink:0}}>{f.label}</div>
                  {cfEditing===f.key?(
                    <div style={{display:"flex",gap:6,flex:1}}>
                      {f.type==="checkbox"?(
                        <select value={cfEditVal} onChange={e=>setCfEditVal(e.target.value)}
                          style={{flex:1,background:"#0f1a12",border:"1px solid #2d4a35",borderRadius:8,padding:"5px 8px",fontSize:12,color:"#f0ede6",outline:"none"}}>
                          <option value="">—</option>
                          <option value="yes">Yes</option>
                          <option value="no">No</option>
                        </select>
                      ):f.type==="select"?(
                        <select value={cfEditVal} onChange={e=>setCfEditVal(e.target.value)}
                          style={{flex:1,background:"#0f1a12",border:"1px solid #2d4a35",borderRadius:8,padding:"5px 8px",fontSize:12,color:"#f0ede6",outline:"none"}}>
                          <option value="">—</option>
                          {(f.options||[]).map(o=><option key={o} value={o}>{o}</option>)}
                        </select>
                      ):f.type==="multi_select"?(
                        <div style={{flex:1,display:"flex",flexWrap:"wrap",gap:5,background:"#0f1a12",border:"1px solid #2d4a35",borderRadius:8,padding:"5px 8px"}}>
                          {(f.options||[]).map(o=>{
                            const cur=cfEditVal?cfEditVal.split("; ").filter(Boolean):[];
                            const on=cur.includes(o);
                            return <button key={o} onClick={()=>{
                              const next=on?cur.filter(x=>x!==o):[...cur,o];
                              setCfEditVal(next.join("; "));
                            }} style={{background:on?T.greenDk:"transparent",border:"1px solid #2d4a35",borderRadius:12,padding:"2px 8px",fontSize:11,color:on?"#f0ede6":"rgba(240,237,230,0.7)",cursor:"pointer"}}>{o}</button>;
                          })}
                        </div>
                      ):f.type==="long_text"?(
                        <textarea value={cfEditVal} onChange={e=>setCfEditVal(e.target.value)} rows={3}
                          style={{flex:1,background:"#0f1a12",border:"1px solid #2d4a35",borderRadius:8,padding:"5px 8px",fontSize:12,color:"#f0ede6",outline:"none",resize:"vertical"}}
                          autoFocus/>
                      ):(
                        <input value={cfEditVal} onChange={e=>setCfEditVal(e.target.value)}
                          type={f.type==="date"?"date":"text"}
                          inputMode={f.type==="number"||f.type==="money"?"decimal":undefined}
                          style={{flex:1,background:"#0f1a12",border:"1px solid #2d4a35",borderRadius:8,padding:"5px 8px",fontSize:12,color:"#f0ede6",outline:"none"}}
                          onKeyDown={e=>{
                            if(e.key==="Enter"){saveCf(f);}
                            else if(e.key==="Escape"){setCfEditing(null);setCfError("");}
                          }}
                          autoFocus
                        />
                      )}
                      <button onClick={()=>saveCf(f)} style={{background:T.greenDk,border:"none",borderRadius:8,padding:"5px 10px",color:"#f0ede6",fontSize:11,fontWeight:700,cursor:"pointer"}}>Save</button>
                      <button onClick={()=>{setCfEditing(null);setCfError("");}} style={{background:"transparent",border:"none",padding:"5px 8px",color:"rgba(240,237,230,0.7)",fontSize:12,cursor:"pointer"}}>✕</button>
                    </div>
                  ):(
                    <div style={{display:"flex",alignItems:"center",gap:6,flex:1,justifyContent:"flex-end"}}>
                      <span style={{fontSize:12,color:(f.value!==null&&f.value!==undefined&&f.value!=="")?"#f0ede6":"rgba(240,237,230,0.7)",fontStyle:(f.value!==null&&f.value!==undefined&&f.value!=="")?"normal":"italic",textAlign:"right",overflowWrap:"anywhere"}}>
                        {cfSaved===f.key?"Saved ✓":(renderCustomValue(f,f.value)||"—")}
                      </span>
                      <button onClick={()=>{setCfEditing(f.key);setCfEditVal(editStr(f));setCfError("");}}
                        style={{background:"#1a2e1f",border:"1px solid #2d4a35",borderRadius:6,padding:"3px 8px",fontSize:10,color:"#0d5c3a",cursor:"pointer"}}>Edit</button>
                    </div>
                  )}
                </div>
              ))}
              {cfError&&<div style={{fontSize:11.5,color:"#b8593f"}}>{cfError}</div>}
              {hidden>0&&(
                <button onClick={()=>setCfShowAll(v=>!v)} style={{background:"none",border:"none",padding:0,fontSize:11,fontWeight:600,color:"rgba(240,237,230,0.7)",cursor:"pointer",textAlign:"left"}}>
                  {cfShowAll?"Hide empty fields":`Show all ${cfData.length} fields (${hidden} empty)`}
                </button>
              )}
            </div>
            </div>;
          })()}

          {donorEvents.length>0&&<div>
            <div style={{fontSize:10,fontWeight:800,textTransform:"uppercase",letterSpacing:"0.12em",color:"rgba(240,237,230,0.7)",marginBottom:8}}>Events</div>
            <div style={{display:"flex",flexDirection:"column",gap:4}}>
              {donorEvents.slice(0,5).map(e=>{
                const EVT_ICONS={gala:"•",cultivation:"•",site_visit:"•",board_meeting:"•",volunteer:"•",webinar:"•",other:"•"};
                const EVT_COLORS={gala:T.greenDk,cultivation:T.green,site_visit:T.green500,board_meeting:T.greenDk,volunteer:T.gold600,webinar:T.gold500,other:T.ink3};
                const ATT_COL={invited:T.ink3,confirmed:T.green500,attended:T.green,no_show:T.terracotta,cancelled:T.ink3};
                const icon=EVT_ICONS[e.event_type]||"•";
                const attCol=ATT_COL[e.attendee_status]||"#5a554f";
                // e.date may be bare YYYY-MM-DD OR a full ISO timestamp (the
                // sample seed writes timestamps) — blindly appending T12:00:00
                // to the latter produced "Invalid Date" on the profile card.
                const _raw=e.date?String(e.date):"";
                const _iso=_raw.match(/^\d{4}-\d{2}-\d{2}/);
                const _dt=_raw?(_iso?new Date(_iso[0]+"T12:00:00"):new Date(_raw)):null;
                const d=_dt&&!isNaN(_dt)?_dt.toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}):"";
                return(
                  <div key={e.id} style={{background:"#1a2e1f",border:"1px solid #2d4a35",borderRadius:8,padding:"8px 10px",display:"flex",alignItems:"center",gap:8}}>
                    <span style={{fontSize:14,flexShrink:0}}>{icon}</span>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:12,fontWeight:600,color:"#f0ede6",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{e.name}</div>
                      <div style={{fontSize:10,color:"rgba(240,237,230,0.7)"}}>{d}</div>
                    </div>
                    <span style={{background:attCol+"22",color:attCol,border:`1px solid ${attCol}44`,borderRadius:99,padding:"2px 8px",fontSize:9,fontWeight:700,flexShrink:0,textTransform:"capitalize"}}>{(e.attendee_status||"invited").replace("_"," ")}</span>
                  </div>
                );
              })}
            </div>
          </div>}

          {/* Major-gifts rail — Suggested Move + Move Stage + Wealth Score +
              Suggested Actions. Locked as ONE preview for Core (lockMajor): the
              real panels (with the org's own data) render behind frosted glass
              with a single Unlock-with-Team CTA; writes are server-gated. */}
          {lockMajor(<>
          {(() => {
            // Smart-move suggestions (BUILD-22) — surfaced, never auto-applied.
            // Lapsed is set automatically elsewhere; these are the judgment
            // moves the officer owns, offered one-click.
            const shown=moveSuggestions.filter(s=>!dismissedSug.includes(s.signal));
            if(!shown.length) return null;
            return (
              <div>
                <div style={{fontSize:10,fontWeight:800,textTransform:"uppercase",letterSpacing:"0.12em",color:"#c9a84c",marginBottom:8}}>Suggested Move</div>
                <div style={{display:"flex",flexDirection:"column",gap:8}}>
                  {shown.map(s=>(
                    <div key={s.signal} style={{background:"#1a2e1f",border:"1px solid #8a6d1f",borderLeft:"3px solid #c9a84c",borderRadius:10,padding:"10px 12px"}}>
                      <div style={{fontSize:12,color:"#f0ede6",lineHeight:1.5,marginBottom:8}}>{s.reason}</div>
                      <div style={{display:"flex",gap:6}}>
                        {s.toStage&&!isReadOnly&&(
                          <button onClick={()=>acceptSuggestion(s)} style={{background:"#c9a84c",border:"none",borderRadius:7,padding:"5px 12px",color:"#0f1a12",fontSize:11,fontWeight:800,cursor:"pointer",fontFamily:"inherit"}}>
                            Accept → {STAGES.find(st=>st.id===s.toStage)?.label||s.toStage}
                          </button>
                        )}
                        <button onClick={()=>dismissSuggestion(s)} style={{background:"transparent",border:"1px solid #2d4a35",borderRadius:7,padding:"5px 12px",color:"rgba(240,237,230,0.7)",fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>Dismiss</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* BUILD-88a A.4 — the Move Stage strip renders ONLY with the Team
              flag, not as a frosted preview. A stage is a position in a pipeline
              somebody moves people through; a Core org has no pipeline and no
              Kanban, and showing them the strip teaches them the product is not
              for them. */}
          {isTeam&&<div data-testid="dp-move-stage">
            <div style={{fontSize:10,fontWeight:800,textTransform:"uppercase",letterSpacing:"0.12em",color:"rgba(240,237,230,0.7)",marginBottom:8}}>Move Stage</div>
            <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
              {STAGES.map(s=>(
                <button key={s.id} onClick={()=>onStageChange(donor.id,s.id)}
                  style={{background:(donor.stage||"cultivate")===s.id?s.color+"28":"#1a2e1f",border:`1px solid ${(donor.stage||"cultivate")===s.id?s.color:"#2d4a35"}`,borderRadius:8,padding:"6px 12px",color:(donor.stage||"cultivate")===s.id?s.color:"rgba(240,237,230,0.7)",fontSize:12,fontWeight:600,cursor:"pointer"}}>
                  {s.label}
                </button>
              ))}
            </div>
            <div style={{marginTop:8,fontSize:11,color:"rgba(240,237,230,0.7)",lineHeight:1.5,borderLeft:`2px solid ${stage.color}`,paddingLeft:8}}>
              {STAGE_ACTION[donor.stage||"cultivate"]}
            </div>
          </div>}

          {/* BUILD-88a A.4 — THE WEALTH SCORE IS HIDDEN UNTIL IT CAN SAY WHAT IT
              IS. It renders a number out of 10, a tier and a confidence word,
              and nothing on the screen says how any of them are arrived at or
              what they were computed from. A number a board member — or a
              fundraiser about to decide how much to ask for — cannot define is a
              number they should not be shown; that is BUILD-86 C.3's rule, and
              it applies to the officer's own screen as much as to the board's.
              It comes back when WEALTH_SCORE_DEFINITION carries a sentence AND
              WEALTH_SCORE_SOURCE names where the inputs come from. The panel's
              code is untouched below so that is a one-line change, not a
              rebuild. */}
          {WEALTH_SCORE_DEFINITION&&WEALTH_SCORE_SOURCE&&<div data-testid="dp-wealth-score">
            <div style={{fontSize:10,fontWeight:800,textTransform:"uppercase",letterSpacing:"0.12em",color:"rgba(240,237,230,0.7)",marginBottom:8}}>Proven capacity</div>
            <div style={{background:"#1a2e1f",border:"1px solid #2d4a35",borderRadius:14,padding:"16px"}}>
              {localScore!==null?(
                <>
                  <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:12}}>
                    <div style={{textAlign:"center",background:wsc+"22",border:`2px solid ${wsc}`,borderRadius:12,padding:"10px 14px",minWidth:56,flexShrink:0}}>
                      <div style={{fontSize:26,fontWeight:800,color:wsc,lineHeight:1,fontFamily:"'DM Serif Display',serif"}}>{localScore}</div>
                      <div style={{fontSize:9,color:"rgba(240,237,230,0.7)",fontWeight:600,marginTop:2}}>/ 10</div>
                    </div>
                    <div>
                      <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:5}}>
                        <span style={{background:(TIER_COLOR[localTier]||"rgba(240,237,230,0.7)")+"33",color:TIER_COLOR[localTier]||"rgba(240,237,230,0.7)",borderRadius:99,padding:"3px 10px",fontSize:11,fontWeight:800,letterSpacing:"0.04em"}}>{localTier}</span>
                      </div>
                      <div style={{fontSize:10,color:"rgba(240,237,230,0.7)",fontWeight:600}}>{localConf} confidence</div>
                    </div>
                  </div>
                  {localRationale&&<p style={{fontSize:12,color:"rgba(240,237,230,0.7)",lineHeight:1.6,margin:"0 0 12px 0",fontStyle:"italic",borderLeft:"2px solid #2d4a35",paddingLeft:10}}>{localRationale}</p>}
                  <button onClick={recalcScore} disabled={scoreLoading} style={{background:"#0f1a12",border:"1px solid #2d4a35",borderRadius:8,padding:"6px",color:"#0d5c3a",fontSize:11,fontWeight:600,cursor:"pointer",width:"100%",textAlign:"center"}}>{scoreLoading?"Calculating…":"↻ Recalculate"}</button>
                </>
              ):(
                <div style={{textAlign:"center",padding:"4px 0"}}>
                  <div style={{fontSize:12,color:"rgba(240,237,230,0.7)",marginBottom:10}}>No score yet</div>
                  <button onClick={recalcScore} disabled={scoreLoading} style={{background:T.green,border:"none",borderRadius:8,padding:"8px 16px",color:"#fff",fontSize:12,fontWeight:600,cursor:"pointer"}}>{scoreLoading?"Calculating…":"Calculate Score"}</button>
                </div>
              )}
              <div style={{fontSize:10.5,color:"rgba(240,237,230,0.7)",marginTop:10,lineHeight:1.5}}>{WEALTH_SCORE_DEFINITION} Source: {WEALTH_SCORE_SOURCE}.</div>
            </div>
          </div>}

          <div>
            <div style={{fontSize:10,fontWeight:800,textTransform:"uppercase",letterSpacing:"0.12em",color:"rgba(240,237,230,0.7)",marginBottom:8}}>Suggested Actions</div>
            <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:12}}>
              <AIBtn onClick={()=>getAI(donor,"nextmove")} loading={loadingKey===`${donor.id}_nextmove`} label="✦ Next Move" small/>
              <AIBtn onClick={()=>getAI(donor,"outreach")} loading={loadingKey===`${donor.id}_outreach`} label="✦ Outreach" small/>
              <AIBtn onClick={()=>getAI(donor,"email")} loading={loadingKey===`${donor.id}_email`} label="✦ Draft Email" small/>
              <AIBtn onClick={()=>getAI(donor,"callscript")} loading={loadingKey===`${donor.id}_callscript`} label="✦ Call Script" small/>
              {/* BUILD-88a A.4 — SEND EMAIL IS GONE FROM THE PROFILE. Steward
                  prepares, she sends. A draft written here went out from this
                  screen without ever passing through the place she reads her
                  own mail, so a sentence she would have changed left in her
                  name. The draft goes to the clipboard and into her mail
                  client, where she can read it as the donor will. */}
              {aiMap[`${donor.id}_email`]&&(
                <button onClick={()=>copyDraftEmail(aiMap[`${donor.id}_email`])} data-testid="dp-copy-draft"
                  style={{background:"#1a2e1f",border:"1px solid #2d4a35",borderRadius:8,padding:"5px 11px",color:"#c9a84c",fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
                  {draftCopied?"Copied ✓":"Copy the draft"}
                </button>
              )}
            </div>
            {["nextmove","outreach","email","callscript"].map(t=>aiMap[`${donor.id}_${t}`]?<AIPanel key={t} text={aiMap[`${donor.id}_${t}`]} onClose={()=>{}}/>:null)}

            {/* BUILD-88a A.4 — THE SEND PANEL IS GONE FROM THE PROFILE.
                Steward prepares, she sends. A draft written and sent from here
                never passed through the place she reads her own mail, so a
                sentence she would have changed went out in her name. The draft
                is copied to the clipboard instead; Gmail's send route still
                exists for the surfaces that are genuinely about sending. */}
          </div>
          </>,{title:"Major-gift tools",blurb:"Suggested moves, stage management, capacity scoring, and outreach drafting — the Team major-gifts layer. This preview shows your own donor; unlock the tools with the Team plan.",minHeight:520})}
        </div>
      </div>
    </div>
  );
}
const cap=s=>s?String(s).charAt(0).toUpperCase()+String(s).slice(1):"—";

export { DonorProfile, EditDonorModal, FollowUpTaskModal, LogTouchpointModal };
