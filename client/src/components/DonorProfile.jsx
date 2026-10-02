// DonorProfile.jsx — one person's record: the profile and the modals it opens.
//
// FIX-1 split: moved VERBATIM out of Donors.jsx. Nothing in it changed.
// Tests read it through readSource("client/src/components/Donors.jsx").
import { useState, useEffect, useRef, useContext, useMemo } from "react";
import { ScoreCard, useScores, SuggestedAskLine } from "./ScoreWhy";
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
import { InboxNudge, useMailbox } from "./InboxConnect";
import { RecordLink } from "./RecordLink";
import { householdHref } from "../lib/appUrls";
import { MeetingCard, RelationshipRail, AfterMeetingForm, ConversationChips, conversationTitle } from "./MeetingPanels";
import { ProfileTimeline } from "./ProfileTimeline";
import { AttachFileField, uploadAttachment } from "./ProfileTimelineParts";
import { T, activeMark, fmtFull, daysDiff, SC, STAGES, STAGE_ACTION, TIER_COLOR, donorScore, moveUrgency, Spin, Pill, AIBtn, AIPanel, GivingHistoryChart, GivingByYearChart, TpField, TpYesNo, TouchpointTimeline, LockedFeature, PlanPending, goToPricing, DriftBadge, Modal, firstNameOf, PersonMark, PhotoContext } from "./shared";
import { PLAN_UNKNOWN, planKnown } from "../lib/entitlement";
import { ProposalsPanel, PlanPanel, BriefPanel } from "./MajorGifts";
import { PROPOSAL_STAGES } from "../../../shared/proposalShape.js";
import { LogConversationModal, ThreadDismissMenu, PutItOnMyCalendar } from "./LogConversation";
import { ItemMenu, EditedMarker, useUndo, HistoryList } from "./EditHistory";
import { PlanFollowUpModal } from "./PlanFollowUp";
import { DESIGNATION_OPTS } from "./donorShared";
import { displayDate, displayDateShort } from "../../../shared/displayDate";
import { orgTodayCivil, orgTodayPlus, civilDaysAgo } from "../lib/orgToday";   // FIX-14 Part 1 — the org's today, never the UTC day
import MetricBreakdownPanel from "./MetricBreakdownPanel";
import { Figure } from "./Figure";
import { WhyPanel } from "./WhyAnswer";
import { useDonorStatus, StatusTags, ClosenessLine, ProfileGlance } from "./ProfileStatus";
// FIX-2 finding 11 — Lapsed is a stage, not a destructive confirm: on this
// profile it is drawn in brass (deep brass on a light ground), never terracotta.
const stageTone=(s,onDark)=>s&&s.id==="lapsed"?(onDark?T.gold:T.gold700):s&&s.color;

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

// FIX-11 Part 1 — WHAT A GIFT READS AS ON THE TIMELINE, in one place.
//
// "$100,000.00 · General Operating · ACH · not yet thanked". The money, where
// it is designated, how it arrived and whether it has been acknowledged: the
// four things somebody scrolling a record wants from a gift line, each from
// the gift row itself rather than from text somebody typed into a note.
//
// Both timeline modes call this, because when the Activity Log and the
// Stewardship Timeline each formatted the same gift their own way, the same
// gift read as two different events.
const giftFundName = g => (g && g.fund_name) || "";
const giftTimelineLine = (g, fundName) => {
  if (!g) return "";
  const parts = [fmtFull(g.amount)];
  if (fundName) parts.push(fundName);
  // "Needs you" is the sentinel a gift carries when nobody said how the money
  // arrived (server.js GIFT_METHOD_UNKNOWN). It is a prompt, not a payment
  // method, and reading "$100,000 · General Operating · Needs you" mid-sentence
  // says the money came in by something called Needs you.
  if (g.payment_method && !/^(unknown|needs you)$/i.test(g.payment_method)) parts.push(g.payment_method);
  // A gift that HAS been thanked says nothing: the absence is the news.
  if (!g.acknowledgement_sent) parts.push("not yet thanked");
  return parts.join(" · ");
};

// ── Follow-up Task Modal ───────────────────────────────────────────────────
function FollowUpTaskModal({donor,onSave,onClose}){
  // BUILD-88a A.2 — the box no longer opens on "Follow up: <name>". The donor's
  // name is already on the screen, and a list where every row starts with the
  // same two words is a list nobody can scan. It opens EMPTY, with the step the
  // box is asking for as its placeholder; the server refuses a "Follow up:"
  // prefix too, so a saved shortcut cannot put it back.
  const[title,setTitle]=useState("");
  const[due,setDue]=useState(()=>orgTodayPlus(7));
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
                <button key={p} onClick={()=>setPriority(p)} style={{flex:1,background:priority===p?SC[p]:T.bg,border:`1px solid ${priority===p?SC[p]:T.bg3}`,borderRadius:8,padding:"8px",color:priority===p?T.white:T.ink3,fontSize:12,fontWeight:600,cursor:"pointer",textTransform:"capitalize"}}>{p}</button>
              ))}
            </div>
          </div>
        </div>
        <div style={{display:"flex",gap:8,marginTop:20}}>
          <button onClick={save} disabled={loading||!title.trim()} style={{flex:1,background:title.trim()?T.greenDk:T.bg2,border:"none",borderRadius:10,padding:"12px",color:T.white,fontSize:14,fontWeight:700,cursor:title.trim()?"pointer":"not-allowed"}}>{loading?"Creating…":"Create Task"}</button>
          <button onClick={onClose} style={{background:T.bg,border:"none",borderRadius:10,padding:"12px 16px",color:T.ink3,fontSize:13,cursor:"pointer"}}>Skip</button>
        </div>
      </div>
    </Modal>
  );
}

// ── Log Touchpoint Modal ───────────────────────────────────────────────────
// FIX-11 Part 1 — "+ LOG → GIFT" MAKES A REAL GIFT, ONCE.
//
// What it used to do, and what Jonathan hit on 30 September with a $100,000
// gift on the Creo record: this modal posted the typed fields as a key:value
// blob to /donors/:id/interactions, AND posted a gift whose `notes` was that
// same blob. recordGift writes one LINKED timeline entry of its own (server.js
// Rule 2), so the record ended up with two entries, identical text, same day
// — and the Amount, Designation and Payment Method the person typed were prose
// in a note rather than a fund and a method on the gift, so the money reached
// no total, no receipt, no bookkeeper export and no audit row.
//
// So the gift type collects no money here at all. It hands off to the gift form
// on the Giving tab, which is the same form "Record a gift" opens: one gift
// path, a real fund, a real payment method, an acknowledgement flag, and the
// one timeline entry recordGift already writes.
function LogTouchpointModal({donor,onSave,onClose,onRecordGift,editing=null}){
  const[type,setType]=useState("call");
  const[date,setDate]=useState(orgTodayCivil());
  const[loading,setLoading]=useState(false);
  const[kt1,setKt1]=useState("");const[kt2,setKt2]=useState("");const[kt3,setKt3]=useState("");
  const[history,setHistory]=useState("");const[spouse,setSpouse]=useState("");const[nextStep,setNextStep]=useState("");
  const[answered,setAnswered]=useState("yes");const[duration,setDuration]=useState("");const[objections,setObjections]=useState("");
  const[attendees,setAttendees]=useState("");const[location,setLocation]=useState("");
  const[sentiment,setSentiment]=useState("Positive");const[asksMade,setAsksMade]=useState("");
  const[subject,setSubject]=useState("");const[summary,setSummary]=useState("");const[responded,setResponded]=useState("no");
  const[eventName,setEventName]=useState("");const[attended,setAttended]=useState("yes");const[observations,setObservations]=useState("");
  const[otherNotes,setOtherNotes]=useState("");
  const[orgEvents,setOrgEvents]=useState([]);
  const[file,setFile]=useState(null);   // PARITY-1 Part B: an optional file, attached once the entry exists
  // FIX-14 Part 2 — EDIT OPENS THE SAME FORM, FILLED IN. The note this form
  // wrote is "Label: value" lines, so they are read back into the fields they
  // came from. A note that is not in that shape (a one-line conversation, a
  // calendar meeting, a stewardship touch) is edited as the plain note it is.
  const[plain,setPlain]=useState(null);
  const editMeta=editing?(()=>{try{return typeof editing.metadata==="string"?JSON.parse(editing.metadata||"{}"):(editing.metadata||{});}catch{return {};}})():{};
  const fromCalendar=!!editMeta.calendar_event_id;
  useEffect(()=>{
    if(!editing)return;
    setDate(String(editing.date||"").slice(0,10));
    const SET={"Answered":setAnswered,"Duration":setDuration,"Key Takeaway 1":setKt1,"Key Takeaway 2":setKt2,"Key Takeaway 3":setKt3,
      "Objections / Concerns":setObjections,"Donor History":setHistory,"Spouse / Partner":setSpouse,"Next Step":setNextStep,
      "Attendees":setAttendees,"Location":setLocation,"Donor Sentiment":setSentiment,"Asks Made":setAsksMade,"Subject":setSubject,
      "Summary":setSummary,"Response Received":setResponded,"Event":setEventName,"Donor Attended":setAttended,
      "Observations":setObservations,"Notes":setOtherNotes};
    const lines=String(editing.note||"").split("\n");
    const known=lines.filter(l=>{const i=l.indexOf(": ");return i>0&&SET[l.slice(0,i)];});
    if(fromCalendar||!["call","meeting","email","event","other"].includes(editing.type)||known.length!==lines.filter(l=>l.trim()).length){
      setType(editing.type);setPlain(String(editing.note||""));return;
    }
    setType(editing.type);
    for(const l of known){const i=l.indexOf(": ");SET[l.slice(0,i)](l.slice(i+2));}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);
  // The Event type offers the org's events by name. The fund, account and
  // campaign reads that used to be here went with the gift fields: the gift
  // form asks for those, and asking twice in two places is how one of them
  // ends up being the one nobody fills in.
  useEffect(()=>{
    apiFetch("/events").then(evts=>setOrgEvents(Array.isArray(evts)?evts.slice(0,20):[])).catch(()=>{});
  },[]);

  const TYPES=[["call","Call"],["meeting","Meeting"],["email","Email"],["event","Event"],["gift","Gift"],["other","Other"]];
  // The gift form is the only place a gift is typed, so this type collects
  // nothing and saves nothing: it opens that form, on this date.
  const handOffToGiftForm=()=>{ if(onRecordGift)onRecordGift({date}); onClose&&onClose(); };

  const buildNote=()=>{
    if(plain!==null)return plain;
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
      // Nothing to build. A gift is recorded on the gift form, which is what
      // makes it count in totals, receipts and the bookkeeper export instead
      // of being prose on a note.
      return "";
    }else{
      add("Notes",otherNotes);add("Donor History",history);add("Spouse / Partner",spouse);add("Next Step",nextStep);
    }
    return L.join("\n");
  };

  const save=async()=>{
    if(type==="gift")return handOffToGiftForm();
    const note=buildNote();if(!note.trim())return;
    // A double-tapped Save must not make two entries: `loading` is set before
    // the await and the button is disabled on it, so the second tap has
    // nothing left to do.
    if(loading)return;
    setLoading(true);
    if(editing){
      try{
        const body={note,type:plain!==null?editing.type:type};
        if(!fromCalendar)body.date=date;
        const row=await apiFetch(`/interactions/${editing.id}`,{method:"PUT",body:JSON.stringify(body)});
        onSave(row);
      }catch(e){alert(errorMessage(e,"That edit did not save."));}
      setLoading(false);
      return;
    }
    try{
      const saveType=type==="meeting"?"meeting":type;
      // FIX-14 Part 1 — the template's own fields travel with the note, so the
      // timeline titles a meeting by its place and reads its next step
      // without re-parsing prose.
      const metadata=type==="meeting"&&location.trim()?{location:location.trim()}:undefined;
      const saved=await apiFetch(`/donors/${donor.id}/interactions`,{method:"POST",body:JSON.stringify({type:saveType,note,date,...(metadata?{metadata}:{})})});
      if(file&&saved&&saved.id){try{await uploadAttachment(saved.id,file);}catch(e){alert("The entry is saved. The file did not attach: "+errorMessage(e,"try Attach a file on the entry."));}}
      onSave({id:saved&&saved.id,type:saveType,note,date,amount:0,metadata:metadata||null});
    }catch(e){console.error(e);}
    setLoading(false);
  };

  const inp={width:"100%",background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"10px 12px",color:T.ink,fontSize:13,outline:"none",fontFamily:"inherit",boxSizing:"border-box"};
  const ta={...inp,resize:"vertical",lineHeight:1.55};
  const canSave=buildNote().trim().length>0;

  return(
    <Modal onClose={onClose} width={520} zIndex={300} padding={24}
      ariaLabel="Log touchpoint" dialogStyle={{border:"1px solid "+T.bg3}}>
      <div>
        <div style={{fontSize:16,fontWeight:800,color:T.ink,marginBottom:2}}>{editing?"Edit this entry":"Log Touchpoint"}</div>
        <div style={{fontSize:12,color:T.ink3,marginBottom:16}}>{donor.name}</div>
        <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:16}}>
          {(editing?TYPES.filter(([v])=>v!=="gift"&&(!fromCalendar&&plain===null||v===type)):TYPES).map(([v,l])=><button key={v} aria-pressed={type===v} onClick={()=>setType(v)} style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:7,padding:"5px 13px",color:T.ink3,fontSize:12,fontWeight:600,cursor:"pointer",...activeMark(type===v,"bottom")}}>{l}</button>)}
        </div>
        <div style={{marginBottom:16}}><span style={{fontSize:11,fontWeight:700,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:5,display:"block"}}>Date</span><input type="date" value={date} onChange={e=>setDate(e.target.value)} disabled={fromCalendar} style={inp}/>
          {fromCalendar&&<div style={{fontSize:12,color:T.ink3,marginTop:6}}>The time and place come from your calendar. <a href={`https://${editMeta.provider==="google"?"calendar.google.com/calendar/r/day/":"outlook.office.com/calendar/view/day/"}${String(editing.date||"").slice(0,10).replace(/-/g,"/")}`} target="_blank" rel="noreferrer" style={{color:T.greenDk,fontWeight:700}}>Change it in your calendar</a>.</div>}</div>
        <div style={{display:"flex",flexDirection:"column",gap:14,marginBottom:20}}>
          {plain!==null&&<TpField label="Note"><textarea value={plain} onChange={e=>setPlain(e.target.value)} rows={6} style={ta}/></TpField>}
          {plain===null&&type==="call"&&<>
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
          {plain===null&&type==="meeting"&&<>
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
          {plain===null&&type==="email"&&<>
            <TpField label="Subject"><input value={subject} onChange={e=>setSubject(e.target.value)} style={inp}/></TpField>
            <TpField label="Summary"><textarea value={summary} onChange={e=>setSummary(e.target.value)} rows={4} style={ta}/></TpField>
            <TpField label="Response Received?"><TpYesNo val={responded} set={setResponded}/></TpField>
            <TpField label="Donor History & Background"><textarea value={history} onChange={e=>setHistory(e.target.value)} placeholder="Context for this outreach…" rows={3} style={ta}/></TpField>
            <TpField label="Next Steps"><textarea value={nextStep} onChange={e=>setNextStep(e.target.value)} placeholder="Specific actions planned…" rows={3} style={ta}/></TpField>
          </>}
          {plain===null&&type==="event"&&<>
            <TpField label="Event">
              {orgEvents.length>0?(
                <select value={eventName} onChange={e=>setEventName(e.target.value)} style={{...inp,cursor:"pointer"}}>
                  <option value="">Select an event, or type one below</option>
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
          {type==="gift"&&<div style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:10,padding:"14px 16px"}}>
            <div style={{fontSize:13,fontWeight:700,color:T.ink,marginBottom:6}}>A gift is recorded on the gift form</div>
            <div style={{fontSize:12,color:T.ink3,lineHeight:1.6,marginBottom:12}}>
              That form asks for the fund, the payment method and whether it has been thanked, so the
              gift counts in giving totals, earns a receipt, reaches the bookkeeper export and appears
              in the audit log. Typing the amount here would leave a note and no gift.
            </div>
            <button onClick={handOffToGiftForm}
              style={{background:T.greenDk,border:"none",borderRadius:9,padding:"10px 16px",color:T.white,fontSize:13,fontWeight:700,cursor:"pointer"}}>
              Open the gift form
            </button>
          </div>}
          {plain===null&&type==="other"&&<>
            <TpField label="Notes"><textarea value={otherNotes} onChange={e=>setOtherNotes(e.target.value)} rows={5} style={ta}/></TpField>
            <TpField label="Donor History & Background"><textarea value={history} onChange={e=>setHistory(e.target.value)} placeholder="Past relationship, context…" rows={3} style={ta}/></TpField>
            <TpField label="Spouse / Partner"><input value={spouse} onChange={e=>setSpouse(e.target.value)} placeholder="Name and relevant details" style={inp}/></TpField>
            <TpField label="Next Steps"><textarea value={nextStep} onChange={e=>setNextStep(e.target.value)} placeholder="Specific actions planned…" rows={3} style={ta}/></TpField>
          </>}
        </div>
        {!editing&&type!=="gift"&&<AttachFileField file={file} setFile={setFile} labelStyle={{fontSize:11,fontWeight:700,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:5,display:"block"}}/>}
        <div style={{display:"flex",gap:8}}>
          {type!=="gift"&&<button onClick={save} disabled={loading||!canSave} style={{flex:1,background:canSave?T.greenDk:T.bg2,border:"none",borderRadius:10,padding:"12px",color:T.white,fontSize:14,fontWeight:700,cursor:canSave?"pointer":"not-allowed"}}>{loading?"Saving…":editing?"Save changes":"Save Touchpoint"}</button>}
          <button onClick={onClose} style={{flex:type==="gift"?1:undefined,background:T.bg,border:"none",borderRadius:10,padding:"12px 16px",color:T.ink3,fontSize:13,cursor:"pointer"}}>Cancel</button>
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
    <Modal onClose={onClose} width={480} zIndex={400} backdrop={T.ink+"cc"} blur={false} padding={28}
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
                  style={{background:form.stage===s.id?stageTone(s)+"22":T.bg,border:`1px solid ${form.stage===s.id?stageTone(s):T.bg3}`,borderRadius:7,padding:"5px 11px",color:form.stage===s.id?stageTone(s):T.ink3,fontSize:12,fontWeight:600,cursor:"pointer"}}>
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
          {err&&<div style={{color:T.terracotta,fontSize:12}}>{err}</div>}
          <div style={{display:"flex",gap:8,marginTop:4}}>
            <button onClick={save} disabled={loading} style={{flex:1,background:loading?T.bg2:T.greenDk,border:"none",borderRadius:10,padding:"11px",color:T.white,fontSize:14,fontWeight:700,cursor:loading?"not-allowed":"pointer"}}>
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
        name:`Gift request: ${donor.name}`,subject:emailSubject,body:emailBody,segment:seg,status:"draft"
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
            {err&&<div style={{color:T.terra700,fontSize:13,background:T.terra100,border:"1px solid "+T.terra200,borderRadius:8,padding:"10px 12px",marginBottom:14}}>{err}</div>}
            {url&&!loading&&(
              <>
                {/* Labeled link pattern — never a raw URL as visible text */}
                <div style={{display:"flex",gap:10,marginBottom:12}}>
                  <a href={url} target="_blank" rel="noreferrer"
                    style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",background:T.bg,border:"1px solid "+T.bg3,borderRadius:10,padding:"11px",color:T.ink2,fontSize:13,fontWeight:700,textDecoration:"none"}}>
                    Open link ↗
                  </a>
                  <button onClick={copyLink} style={{flex:1,background:copied?T.greenDk:T.bg,border:"1px solid "+(copied?T.greenDk:T.bg3),borderRadius:10,padding:"11px",color:copied?T.white:T.ink2,fontSize:13,fontWeight:700,cursor:"pointer",transition:"all 0.15s"}}>
                    {copied?"✓ Copied!":"Copy Link"}
                  </button>
                </div>
                {donor.email&&<button onClick={()=>setShowEmail(true)} style={{width:"100%",background:T.greenDk,border:"none",borderRadius:10,padding:"11px",color:T.white,fontSize:13,fontWeight:700,cursor:"pointer"}}>
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
                {/* FIX-15 Part 3: the route QUEUES the send (it goes out in the
                    background), so at this moment nothing is known about delivery. */}
                <div style={{fontSize:15,fontWeight:700,color:T.ink,marginBottom:6}}>Queued to send</div>
                <div style={{fontSize:13,color:T.ink3,marginBottom:20}}>Your message to {donor.name} is on its way out. Communications shows whether it was delivered.</div>
                <button onClick={onClose} style={{background:T.greenDk,border:"none",borderRadius:10,padding:"11px 24px",color:T.white,fontSize:13,fontWeight:700,cursor:"pointer"}}>Done</button>
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
                {sendErr&&<div style={{color:T.terra700,fontSize:13,background:T.terra100,border:"1px solid "+T.terra200,borderRadius:8,padding:"8px 12px",marginBottom:12}}>{sendErr}</div>}
                <div style={{display:"flex",gap:8}}>
                  <button onClick={sendEmail} disabled={sending} style={{flex:1,background:sending?T.bg3:T.greenDk,border:"none",borderRadius:10,padding:"11px",color:T.white,fontSize:13,fontWeight:700,cursor:sending?"not-allowed":"pointer"}}>
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

// ── FIX-1 D — what this person IS, as a row of chips under the name ────────
// One person, one record, even when they are two things (BUILD-94 Part 2).
// Each chip is ONE write through PUT /people/:id/roles. A role that is on is a
// STATE (cream, emerald hairline) — never a second action colour. Adding
// Volunteer puts them on the Volunteers roster that moment, on this record.
//
// DONOR IS SET BY GIVING. While gifts are on file the Donor chip cannot come
// off, and it says why — the SERVER's sentence (GET /people/:id), and the
// server refuses the removal too, so the chip and the rule cannot disagree.
const ROLE_CHIPS=PERSON_TYPES.filter(t=>t.key!=="other");
function RoleLine({donor,isReadOnly}){
  const [types,setTypes]=useState(donor.personTypes||["donor"]);
  const [lock,setLock]=useState({locked:false,reason:null});
  // FIX-8 Part B.2 — the year the roles line says "since". It comes from the
  // same /people/:id read the roles already do, because the ADAPTED donor
  // object does not carry first_gift_date (the adaptDonor field-name trap
  // BUILD-89 hit): reading donor.firstGiftDate here returned undefined and the
  // line silently read "Donor" with no year.
  const [firstGiftYear,setFirstGiftYear]=useState(null);
  const [busy,setBusy]=useState(null);
  const [note,setNote]=useState("");
  useEffect(()=>{setTypes(donor.personTypes||["donor"]);},[donor.id,JSON.stringify(donor.personTypes||[])]);
  useEffect(()=>{
    let gone=false;
    apiFetch(`/people/${donor.id}`).then(r=>{
      if(gone||!r)return;
      if(Array.isArray(r.person_types))setTypes(r.person_types);
      setLock({locked:!!r.donorLocked,reason:r.donorLockedReason||null});
      const y=String(r.first_gift_date||"").slice(0,4);
      if(/^\d{4}$/.test(y))setFirstGiftYear(y);
    }).catch(()=>{});
    return()=>{gone=true;};
  },[donor.id]);
  const toggle=async(k)=>{
    if(isReadOnly||busy)return;
    const on=!types.includes(k);
    if(k==="donor"&&!on&&lock.locked){setNote(lock.reason);return;}
    setBusy(k);setNote("");
    try{
      const r=await apiFetch(`/people/${donor.id}/roles`,{method:"PUT",body:JSON.stringify({role:k,on})});
      if(r&&Array.isArray(r.person_types)){
        setTypes(r.person_types);
        setLock({locked:!!r.donorLocked,reason:r.donorLockedReason||null});
      }
    }catch(e){setNote(errorMessage(e,"Could not change this person's role"));}
    setBusy(null);
  };
  // ── FIX-8 Part B.2 · ONE QUIET LINE, AND A "+" ──────────────────────────
  // "Donor since 2021 · Volunteer" is what this person IS. The roles they do
  // not have are not facts about them, so they are not drawn as chips beside
  // the ones they do have; they live behind the "+", which is where somebody
  // goes to change something rather than to read something.
  // The toggles themselves are unchanged: the same PUT /people/:id/roles, the
  // same lock on removing "donor" from somebody who has given.
  const [openAdd,setOpenAdd]=useState(false);
  const have=ROLE_CHIPS.filter(c=>types.includes(c.key));
  const missing=ROLE_CHIPS.filter(c=>!types.includes(c.key));
  const sinceYear=firstGiftYear;
  const roleWords=have.map(c=>
    c.key==="donor"&&sinceYear?`Donor since ${sinceYear}`:c.label).join(" · ");
  return (
    <div data-testid="role-line" style={{display:"flex",alignItems:"center",gap:7,flexWrap:"wrap",marginTop:5,position:"relative"}}>
      {roleWords&&<span style={{fontSize:12.5,color:T.ink3,lineHeight:1.4}}>{roleWords}</span>}
      {!isReadOnly&&missing.length>0&&(
        <button type="button" data-testid="role-add" aria-haspopup="menu" aria-expanded={openAdd}
          aria-label="Add a role" title="Add a role" onClick={()=>setOpenAdd(o=>!o)}
          style={{width:20,height:20,borderRadius:99,border:"1px solid "+T.bg3,background:T.white,
            color:T.ink3,fontSize:13,lineHeight:1,cursor:"pointer",display:"grid",placeItems:"center",
            fontFamily:"inherit",padding:0}}>+</button>)}
      {openAdd&&(
        <div role="menu" data-testid="role-add-menu" style={{position:"absolute",top:"calc(100% + 6px)",left:0,zIndex:60,
          background:T.white,border:"1px solid "+T.bg3,borderRadius:10,boxShadow:"0 12px 32px rgba(15,26,18,0.18)",
          minWidth:190,padding:6}}>
          {missing.map(c=>(
            <button key={c.key} type="button" role="menuitem" data-testid={"role-add-"+c.key}
              disabled={busy===c.key} onClick={()=>{setOpenAdd(false);toggle(c.key);}}
              style={{display:"block",width:"100%",textAlign:"left",background:"none",border:"none",borderRadius:6,
                padding:"8px 10px",color:T.ink,fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
              {c.label}
            </button>))}
        </div>)}
      {note&&<span style={{fontSize:11.5,color:T.gold700,lineHeight:1.4}}>{note}</span>}
    </div>
  );
}
// The four figures on the profile, in the order they are read: what they
// have given, the last of it, how long since anybody spoke to them, and what
// is being asked for now. One list, so the tiles, their definitions and their
// sources cannot drift apart.
const PROFILE_FIGURES = [
  { key: "lifetime", label: "Lifetime",     kind: "money", def: censusById("profile.lifetime").sentence },
  { key: "lastGift", label: "Last gift",    kind: "money", def: censusById("profile.lastGift").sentence },
  // INT-BUILD-1 — the header reads Lifetime, Last gift, Last met, Last email
  // (docs/int-build-1/Profile.html). The open ask moved into the meeting
  // brief, and Last contact is the two of these together.
  { key: "lastMet",   label: "Last met",   kind: "count", suffix: " days", def: censusById("profile.lastMet").sentence },
  { key: "lastEmail", label: "Last email", kind: "count", suffix: " days", def: censusById("profile.lastEmail").sentence },
];

// The four things Steward can draft on a record, in the order the rail
// offers them. One list, so the buttons and the panels can never disagree.
const SUGGEST_KINDS = ["nextmove", "outreach", "email", "callscript"];

// The proposal stages, by their own labels, so the next-step row can name one
// without retyping the list shared/proposalShape.js already owns.
const PROPOSAL_STAGE_LABEL = Object.fromEntries(PROPOSAL_STAGES.map(s => [s.key, s.label]));

// ── THE RAIL'S PALETTE (PROFILE-1) ─────────────────────────────────────────
// Ink ground, light text. Nothing new enters the four colours: the ground is
// T.ink, panels are the existing elevated ink, hairlines are the existing
// on-dark border token, and the two greys are CREAM AT REDUCED OPACITY
// (T.sage400/600) — the design system's own answer for secondary text on ink,
// because warm grey scores about 2.0:1 there and would rightly be refused.
const RAIL = {
  bg:    T.ink,          // the rail's ground — must differ from the column's
  panel: T.bgElevated,   // a card inside the rail
  line:  T.green650,     // hairline / input edge on dark
  text:  T.inkInverse,   // primary text on ink
  dim:   T.sage400,      // secondary text on ink
};

// One shape for every rail section: a hairline above it, an uppercase title,
// an optional action beside the title, and an optional fold. A folded section
// says how much is inside ON ITS LABEL, so folding never hides a count.
function RailSection({ title, actionNode, children, fold=false, foldOpenLabel="Hide", foldShutLabel="Show", testid, first=false }) {
  const [open,setOpen]=useState(!fold);
  const btn={background:"none",border:"none",padding:0,color:RAIL.dim,fontSize:12,fontWeight:600,letterSpacing:0,textTransform:"none",cursor:"pointer",fontFamily:"inherit"};
  return (
    <section data-testid={testid} data-rail-section={fold?(open?"open":"folded"):"plain"}
      style={{borderTop:first?"none":"1px solid "+RAIL.line,padding:first?"0 0 16px":"16px 0"}}>
      <h4 style={{margin:"0 0 10px",fontSize:10.5,fontWeight:800,letterSpacing:"0.14em",textTransform:"uppercase",color:RAIL.dim,display:"flex",justifyContent:"space-between",alignItems:"center",gap:8}}>
        <span>{title}</span>
        {fold
          ? <button onClick={()=>setOpen(o=>!o)} aria-expanded={open} style={btn}>{open?foldOpenLabel:foldShutLabel}</button>
          : (actionNode || null)}
      </h4>
      {open&&children}
    </section>
  );
}


function DonorProfile({donor,onClose,onStageChange,onLogTouchpoint,aiMap,aiErr={},loadingKey,getAI,isAdmin,onEdit,onDelete,tasks=[],onTaskToggle,onAddTask,orgName="",orgTeam=[],onReassign,onCfSaved,onInteractionAdded,isReadOnly=false,allDonors=[],onSelectRelatedDonor,onNavigate,initialOpenConversation=false,initialAddGift=null,org=null}){
  const [gifts,setGifts]=useState([]);
  const [giftLoading,setGiftLoading]=useState(true);
  const [localInts,setLocalInts]=useState(null); // loaded lazily from GET /donors/:id
  // FIX-14 Part 1 — the header's figures, refreshed from the same read after a
  // conversation is logged. They were the values from when the record opened,
  // so "Last met" still said "Not met yet" beside a meeting just logged.
  const [figs,setFigs]=useState(null);
  // INT-BUILD-1 — meetings, threads, rhythm and this year, in one read.
  const [rel,setRel]=useState(null);
  // ENGAGE-1 — the two scores and the suggested ask, one read.
  const scores=useScores(donor.id);
  // PARITY-1 — tags, closeness, at a glance, highlights and the next action, one read.
  const status=useDonorStatus(donor.id, figs);
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
  const loadRel=()=>apiFetch(`/donors/${donor.id}/relationship`).then(setRel).catch(()=>setRel(null));
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
  // FIX-14 Part 2 — the entry being edited (opens the form it was made with),
  // and the ten-second Undo after a delete.
  const [editingInt,setEditingInt]=useState(null);
  const [undoToast,offerUndo]=useUndo();
  const [planOpen,setPlanOpen]=useState(false);   // BUILD-85 — plan forward on this donor
  // BUILD-88a A.2 — EVERY OPEN ITEM FOR THIS DONOR, ranked by the one ranking.
  // The profile showed the thread and nothing else, so a task created by
  // "+ Add task", a pipeline move or a workflow recipe was an open promise to
  // this person that their own record did not mention.
  // HOTFIX-1 — the open work is loaded before the next move is asked for, so
  // "what do I do next" can never answer with nothing while a follow-up or a
  // proposal sits open on the same screen.
  const [dpItemsLoaded,setDpItemsLoaded]=useState(false);
  const [openProposals,setOpenProposals]=useState([]);
  const loadDpThread=()=>apiFetch(`/threads?donorId=${donor.id}`).then(r=>{
    setDpItems(Array.isArray(r.list)?r.list:[]);
    setDpThread((r.list||[]).find(x=>x.kind!=="task")||null);
  }).catch(()=>{}).finally(()=>setDpItemsLoaded(true));
  useEffect(()=>{setDpItemsLoaded(false);setOpenProposals([]);loadDpThread();
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
    try{const r=await apiFetch(`/donor-relationships/${relId}`,{method:"DELETE"});loadRelationships();offerUndo(r,"relationship",loadRelationships);}
    catch(e){alert(errorMessage(e,"The relationship could not be removed."));}
  };
  // FIX-14 Part 3 — a relationship's kind is edited in place.
  const retypeRelationship=async(relId,relationshipType)=>{
    try{await apiFetch(`/donor-relationships/${relId}`,{method:"PUT",body:JSON.stringify({relationshipType})});loadRelationships();}
    catch(e){alert(errorMessage(e,"The relationship could not be changed."));}
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
  const [dpTab,setDpTab]=useState(initialAddGift?"gifts":"overview");
  const [whyStopOpen,setWhyStopOpen]=useState(false);
  const [dpMoreOpen,setDpMoreOpen]=useState(false); // BUILD-41: mobile overflow menu (Impact Summary / Edit)

  // Full gift data for Gifts & Pledges tab
  const [giftsFull,setGiftsFull]=useState([]);
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
  const [pledges,setPledges]=useState([]);
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
  const refreshSoftCredit=()=>apiFetch(`/donors/${donor.id}/soft-credit`).then(sc=>{
    setSoftCredit(sc);
    if(sc&&sc.householdId)apiFetch(`/households/${sc.householdId}`).then(setHousehold).catch(()=>setHousehold(null));
    else setHousehold(null);
  }).catch(()=>{setSoftCredit(null);setHousehold(null);});
  // Pipeline: moves history + ask/gift opportunities (BUILD-15, Team plan)
  const [moves,setMoves]=useState([]);
  const [opps,setOpps]=useState([]);
  // The plan starts UNKNOWN, never "core": a plan that has not loaded is not a
  // plan without the feature (FIX-3 finding 9, client/src/lib/entitlement.js).
  const [planTier,setPlanTier]=useState(PLAN_UNKNOWN);
  const [planFailed,setPlanFailed]=useState(false);
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
    setPlanFailed(false);
    apiFetch("/portfolio/officers").then(r=>setPlanTier(r?.tier||PLAN_UNKNOWN)).catch(()=>setPlanFailed(true));
  },[donor.id]);
  const isTeam=planTier==="team";
  // Donor-profile Core/Team split (FIX): the CRM core stays fully available to
  // Core; only the major-gifts LAYER (moves & asks, move-stage, wealth score,
  // suggested actions, sequences, reassign) is Team. `lockMajor` reuses the ONE
  // shared LockedFeature wrapper (same treatment as the Pipeline tab / BUILD-20)
  // — Core sees the real panel with its own data behind frosted glass + an
  // "Unlock with Team" CTA; writes stay server-gated (requirePlan('team')→403).
  // A plain function (not a `<Component>`) so Team never remounts the subtree.
  // While the plan is unknown it draws the pending state, never the lock.
  const lockMajor=(children,opts={})=>isTeam?children:(!planKnown(planTier)?<PlanPending failed={planFailed}/>:
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
      let r=null;
      if(remaining.length<2)r=await apiFetch(`/households/${household.id}`,{method:"DELETE"});
      else await apiFetch(`/households/${household.id}`,{method:"PUT",body:JSON.stringify({memberIds:remaining})});
      setHousehold(null);refreshSoftCredit();
      if(r)offerUndo(r,"household",refreshSoftCredit);
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
    setDpTab("gifts");
    setAddGiftOpen(true);
    if(initialAddGift.date)setAddGiftForm(f=>({...f,date:initialAddGift.date}));
  },[initialAddGift]);

  const loadGiftsFull=()=>{
    apiFetch(`/donors/${donor.id}`).then(raw=>{
      const g=(raw.gifts||[]).map(g=>({
        id:g.id,amount:parseFloat(g.amount)||0,date:g.date||g.created_at?.split("T")[0],
        type:g.type||"cash",campaign:g.campaign||"",notes:g.notes||"",
        fund_id:g.fund_id||"",fund_name:g.fund_name||"",payment_method:g.payment_method||"",
        acknowledgement_sent:!!g.acknowledgement_sent,
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
    }).catch(()=>setGiftLoading(false));
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
  // The list is only needed when they are NOT in one, so it is fetched then.
  useEffect(()=>{
    let live=true;
    if(!donor?.id||journey?.status==="active")return undefined;
    apiFetch("/journeys").then(d=>{ if(live)setJourneyList(d?.journeys||[]); }).catch(()=>{ if(live)setJourneyList([]); });
    const ex=journey&&journey.status==="done"?`?exclude=${encodeURIComponent(journey.templateId||"")}`:"";
    apiFetch(`/donors/${donor.id}/journey-suggestion${ex}`).then(d=>{ if(live)setJourneySuggest(d?.suggestion||null); }).catch(()=>{ if(live)setJourneySuggest(null); });
    return ()=>{live=false;};
  },[donor?.id,journey?.status]);
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
    // FIX-14 Part 2 — a receipt is a document the donor already holds. Editing
    // the amount does not change it, so the person editing is told first.
    const rcpt=receiptForGift(giftId);
    const was=giftsFull.find(g=>g.id===giftId);
    if(rcpt&&was&&giftEditForm.amount!==undefined&&Number(giftEditForm.amount)!==Number(was.amount)
      &&!window.confirm(`A receipt already went out for this gift${rcpt.receipt_number?` (${rcpt.receipt_number})`:""}, for ${fmtFull(Number(rcpt.amount||was.amount))}. Changing the amount here does not change that receipt; void it and issue a new one from Tax receipts if it needs correcting. Save the new amount?`))return;
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
      setAddGiftForm({amount:"",date:orgTodayCivil(),type:"cash",payment_method:"",notes:"",fund_id:"",acknowledgement_sent:false,pledgeId:""});
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
    if(!confirm("Delete this pledge? You can undo it for ten seconds."))return;
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
  useEffect(()=>{
    const h=typeof window!=="undefined"?window.location.hash:"";
    if(!/^#gift-/.test(h)||!giftsFull.length)return undefined;
    const el=document.getElementById(h.slice(1));
    if(!el){ if(dpTab==="overview"&&giftsFull.some(g=>"gift-"+g.id===h.slice(1)))setDpTab("gifts"); return undefined; }
    if(el.dataset.marked)return undefined;
    el.dataset.marked="1";
    el.scrollIntoView({block:"center",behavior:"smooth"});
    el.style.outline="3px solid "+T.gold;el.style.outlineOffset="2px";
    const t=setTimeout(()=>{el.style.outline="";el.style.outlineOffset="";},4000);
    return ()=>clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[giftsFull,dpTab,rel]);
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
              {/* FIX-8 Part B.1 — ONE THING TO READ FIRST. The name was 16px
                  and sat in a row with the stage, the email, four safety
                  flags and a drift badge, so nothing in the header was the
                  first thing. It is display type now; the email moved to the
                  rail's contact block, where somebody looks when they are
                  about to call. */}
              <span className="dph-name" style={{fontSize:26,fontWeight:400,color:T.ink,letterSpacing:"-0.01em",
                fontFamily:"'DM Serif Display',Georgia,serif",lineHeight:1.12}}>{donor.name}</span>
              {/* FIX-2 finding 11 — Lapsed is a stage, not a destructive confirm, so
                  it is brass (the overdue colour), never terracotta. */}
              <span style={{fontSize:10,fontWeight:700,padding:"3px 9px",borderRadius:99,background:stage.id==="lapsed"?T.gold100:stage.color+"22",color:stageTone(stage)}}>{stage.label}</span>
              <DriftBadge drift={donor.drift}/>
              {/* BUILD-58 Part 2 — safety flags, visible where staff decide to reach out */}
              {donor.deceased&&<span title="No mail of any kind is sent to this donor" style={{fontSize:10,fontWeight:800,padding:"3px 9px",borderRadius:99,background:T.terra100,color:T.terra700,border:`1px solid ${T.terra200}`}}>Deceased</span>}
              {!donor.deceased&&donor.doNotContact&&<span title="Excluded from campaigns, sequences, and workflow emails" style={{fontSize:10,fontWeight:800,padding:"3px 9px",borderRadius:99,background:T.gold100,color:T.gold700,border:`1px solid ${T.gold300}`}}>Do not contact</span>}
              {!donor.deceased&&!donor.doNotContact&&donor.doNotSolicit&&<span title="No asks. Excluded from the drift list, re-engage, suggested outreach and ask automations. Stewardship thank-yous continue." style={{fontSize:10,fontWeight:800,padding:"3px 9px",borderRadius:99,background:T.gold100,color:T.gold700,border:`1px solid ${T.gold300}`}}>Do not solicit</span>}
              {donor.importedSustainer&&<span title={`Sustainer history from import, with no payment authorization here yet${donor.importedSustainerAmount?` (was $${donor.importedSustainerAmount}/mo)`:""}. Send a reconnect link from Fundraising → Recurring.`} style={{fontSize:10,fontWeight:800,padding:"3px 9px",borderRadius:99,background:T.green100,color:T.greenDk,border:`1px solid ${T.green200}`}}>Sustainer · not reconnected</span>}
            </div>
            {/* FIX-8 Part B.2 — the roles are ONE QUIET LINE, and the two
                add-actions live in a "+" beside it. Three chips put two verbs
                ("+ Volunteer", "+ Staff and board") where the reader expects
                facts, so the header said what this person IS and what you
                could do to them in the same breath, in the same shape. */}
            <RoleLine donor={donor} isReadOnly={isReadOnly}/>
            {/* PARITY-1 — the giving level, lifecycle and Retained, each
                opening its donors, and the closeness word with its facts. */}
            <StatusTags status={status}/>
            <ClosenessLine status={status}/>
            {/* PROFILE-1 — ONE LIFETIME NUMBER ON THIS SCREEN. This line used
                to read donors.total_giving while the tile below it now reads
                the gifts themselves (figureSources donor-lifetime), and on the
                fixture record those two disagreed by $60,000 four inches
                apart. The rule is that when two surfaces show the same number
                it is computed once, so this line reads the figure the tile
                reads, and falls back to the column only before the figures
                have loaded. */}
            {/* FIX-8 Part B.3 — the "$167,916 lifetime · 4 gifts" line is
                gone. The Lifetime card four inches below says the same number
                from the same computation, and PROFILE-1 already had to fix
                these two disagreeing by $60,000. One number, one place. */}
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
        {/* PROFILE-1 — THREE BUTTONS AND A MENU, AT EVERY WIDTH. The header
            carried five actions across the top of the record, which is four
            more than anybody presses in a row; at 390 the overflow already
            existed and at 1440 it did not, so the same screen taught two
            different habits. Now: Log a conversation (the one emerald), Plan
            a follow-up when there is no open thread, and More — a real
            BUTTON with a menu, never a link, because it does something on
            this page rather than going somewhere. Everything that was in the
            row is in the menu, so nothing was dropped. */}
        <div className="dph-actions" style={{display:"flex",gap:6,flexShrink:0,alignItems:"center",position:"relative"}}>
          {/* BUILD-88a A.4 — ONE EMERALD PRIMARY. The header carried two filled
              buttons in two different colours (a brass "Log a conversation" and
              an emerald "Request Gift"), so nothing on it was the obvious thing
              to press. Emerald means "this is the button" and exactly one thing
              may mean that; the rest are outlines. */}
          <button onClick={()=>setConvoOpen(true)} disabled={isReadOnly} className="dph-primary" data-testid="dp-primary" style={{background:T.greenDk,border:"none",borderRadius:9,padding:"9px 14px",color:T.white,fontSize:13,fontWeight:800,cursor:isReadOnly?"not-allowed":"pointer",opacity:isReadOnly?0.5:1}}>
            Log a conversation
          </button>
          {/* BUILD-85 — plan forward. Offered only when there is NO open thread,
              because one open step per donor is the model and a second button
              that can only 409 is a button that teaches people to distrust
              buttons. */}
          {!dpThread&&<button onClick={()=>setPlanOpen(true)} disabled={isReadOnly} data-testid="dp-plan-followup"
            style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:9,padding:"9px 14px",color:T.ink,fontSize:13,fontWeight:700,cursor:isReadOnly?"not-allowed":"pointer",opacity:isReadOnly?0.5:1}}>
            Plan a follow-up
          </button>}
          {/* SHELVED — voice capture works but unproven adoption assumption, revisit later.
              Code intact, re-enable by uncommenting.
          <button onClick={()=>setShowVoiceMemo(true)} style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"7px 14px",color:T.ink3,fontSize:13,cursor:"pointer"}}>
            Voice memo
          </button>
          */}
          <button onClick={()=>setDpMoreOpen(o=>!o)} data-testid="dp-more" aria-haspopup="menu" aria-expanded={dpMoreOpen}
            style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:9,padding:"9px 14px",color:T.ink,fontSize:13,fontWeight:700,cursor:"pointer"}}>More ▾</button>
          {dpMoreOpen&&(
            <div className="dph-more-menu" role="menu" data-testid="dp-more-menu" style={{position:"absolute",top:"calc(100% + 6px)",right:0,zIndex:60,background:T.white,border:"1px solid "+T.bg3,borderRadius:10,boxShadow:"0 12px 32px rgba(15,26,18,0.18)",minWidth:210,overflow:"hidden",padding:6}}>
              {[["Request a gift",()=>setShowGiftModal(true),false],
                // FIX-14 Part 3 — the quick actions, Suggested and Brief me live here now.
                ...(isTeam?[["Draft the next move",()=>{setSuggestOpen(true);getAI(donor,"nextmove",openForNextMove);},false],
                  ["Draft outreach",()=>{setSuggestOpen(true);getAI(donor,"outreach");},false],
                  ["Draft an email",()=>{setSuggestOpen(true);getAI(donor,"email");},false],
                  ["Call script",()=>{setSuggestOpen(true);getAI(donor,"callscript");},false]]:[]),
                [`Suggested${SUGGEST_KINDS.filter(t=>aiMap[`${donor.id}_${t}`]||aiErr[`${donor.id}_${t}`]).length?` (${SUGGEST_KINDS.filter(t=>aiMap[`${donor.id}_${t}`]||aiErr[`${donor.id}_${t}`]).length})`:""}`,()=>setSuggestOpen(true),false],
                ["Brief me",()=>setBriefOpen(true),false],
                // WHY-1 — only for a lapsed donor: the facts on their record
                // before they stopped, and the one touch that fits.
                ...(donor.stage==="lapsed"?[["Why did they stop?",()=>setWhyStopOpen(true),false,"dp-why-stop"]]:[]),
                ...(onAddTask?[["Add a task",onAddTask,isReadOnly]]:[]),
                [impactPdfLoading?"Generating…":"Impact summary",downloadImpactSummary,impactPdfLoading],
                /* MEMBERS-2 — the one page this person has: their membership,
                   their tickets, their shifts and their giving. Staff send the
                   link; they never see the token it carries, because somebody
                   who could read it could open somebody else's page. */
                ["Send their page link",sendYourPageLink,isReadOnly||!donor.email],
                ["Edit record",onEdit,false],
                // TRUST-2 — a person's own data, in one file, when they ask.
                ...(isAdmin?[["Export this person's data",exportPersonData,false]]:[]),
                // FIX-14 Part 3 — Erase and Delete, at the bottom of More, never on the page.
                ...(isAdmin&&!isReadOnly?[["Erase this person",()=>{setEraseOpen(true);setEraseMsg("");setEraseWord("");},false,"dp-erase",true]]:[]),
                ...(isAdmin?[["Delete donor",()=>onDelete(donor.id),false,"dp-delete",!(!isReadOnly)]]:[])].map(([label,fn,disabled,tid,sep])=>(
                <button key={label} role="menuitem" disabled={disabled} data-testid={tid} onClick={()=>{setDpMoreOpen(false);fn();}}
                  style={{display:"block",width:"100%",textAlign:"left",background:"none",border:"none",borderTop:sep?"1px solid "+T.bg3:"none",marginTop:sep?4:0,borderRadius:sep?0:6,padding:"9px 10px",color:T.ink,fontSize:13.5,fontWeight:600,cursor:disabled?"not-allowed":"pointer",opacity:disabled?0.6:1,fontFamily:"inherit"}}>{label}</button>
              ))}
            </div>
          )}
          {whyStopOpen&&<WhyPanel payload={{key:"stopped",donor:donor.id}} isReadOnly={isReadOnly} onClose={()=>setWhyStopOpen(false)}/>}
          {yourPageMsg&&<div role="status" data-testid="dp-your-page-msg" style={{position:"absolute",top:"calc(100% + 6px)",right:0,zIndex:61,background:T.white,border:"1px solid "+T.bg3,borderRadius:10,padding:"9px 12px",fontSize:12.5,color:T.ink,maxWidth:320,boxShadow:"0 12px 32px rgba(15,26,18,0.18)"}}>{yourPageMsg}</div>}
          {editingInt&&(()=>{let m={};try{m=typeof editingInt.metadata==="string"?JSON.parse(editingInt.metadata||"{}"):(editingInt.metadata||{});}catch{m={};}
            return m.via==="thread_log"
              ?<LogConversationModal donor={{id:donor.id,name:donor.name}} org={org} editing={editingInt} onSaved={onIntEdited} onClose={()=>setEditingInt(null)}/>
              :<LogTouchpointModal donor={donor} editing={editingInt} onSave={onIntEdited} onClose={()=>setEditingInt(null)}/>;})()}
          {undoToast}
          {convoOpen&&<LogConversationModal donor={{id:donor.id,name:donor.name}} thread={dpThread} org={org} onNavigate={onNavigate}
            onSaved={r=>{loadDpThread();if(onInteractionAdded)onInteractionAdded();setLocalInts(prev=>prev?[{id:r.interactionId,type:r.touch==="gift"?"gift":r.touch.startsWith("call")?"call":r.touch==="email"?"email":r.touch==="note_only"?"note":r.touch==="ask"?"ask":"meeting",note:r.line,date:r.date,metadata:r.place?{location:r.place}:null},...prev]:prev);
              // FIX-14 Part 1 — every count on the record re-reads the one
              // source: the header's figures, the rail, the rhythm, the timeline.
              loadRel();loadGiftsFull();}}
            onClose={()=>setConvoOpen(false)}/>}
          {suggestOpen&&<Modal onClose={()=>setSuggestOpen(false)} width={640} title="Suggested">
            <div data-testid="dp-suggested" style={{display:"flex",flexDirection:"column",gap:12}}>
              {!SUGGEST_KINDS.some(t=>aiMap[`${donor.id}_${t}`]||aiErr[`${donor.id}_${t}`])&&<div style={{fontSize:13,color:T.ink3}}>{loadingKey&&String(loadingKey).startsWith(donor.id+"_")?<Spin/>:"Nothing drafted yet. Pick a draft from More."}</div>}
              {/* ── SUGGESTED ────────────────────────────────────────────
                  What Steward drafted, beside the step it is about. Every
                  line came through the HOTFIX-1 checker: a sentence naming
                  somebody, stating a number or making a claim the record does
                  not carry is dropped SILENTLY (the count goes to the
                  console), timing that is already behind today is refused,
                  and when nothing survives this renders nothing at all. */}
              {SUGGEST_KINDS.map(t=>aiMap[`${donor.id}_${t}`]?(
                <div key={t} data-testid={`dp-suggested-${t}`}>
                  <AIPanel text={aiMap[`${donor.id}_${t}`]} onClose={()=>{}}/>
                  <div style={{fontSize:12,color:T.ink3,marginTop:6}}>
                    From <button onClick={()=>setDpTab("activity")} style={{background:"none",border:"none",padding:0,color:T.greenDk,fontWeight:700,textDecoration:"underline dotted",cursor:"pointer",fontFamily:"inherit",fontSize:12}}>this record</button>
                    {t==="email"&&aiMap[`${donor.id}_email`]?<> · <button onClick={()=>copyDraftEmail(aiMap[`${donor.id}_email`])} data-testid="dp-copy-draft" style={{background:"none",border:"none",padding:0,color:T.greenDk,fontWeight:700,textDecoration:"underline dotted",cursor:"pointer",fontFamily:"inherit",fontSize:12}}>{draftCopied?"Copied ✓":"Copy the draft"}</button></>:null}
                  </div>
                </div>
              ):null)}

              {/* FIX-10 D — WHEN DRAFTING DID NOT COME BACK. The failure used
                  to be written into aiMap and rendered as though Steward had
                  suggested it, carrying the HTTP status ("Stream failed: 503")
                  into a panel headed "Suggested". It is its own row now, in the
                  Agent room's voice, with the one control that helps. */}
              {SUGGEST_KINDS.map(t=>aiErr[`${donor.id}_${t}`]?(
                <div key={t+"-err"} data-testid={`dp-suggested-error-${t}`}
                  style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap",
                    background:T.gold50,border:"1px solid "+T.bg2,borderLeft:"3px solid "+T.gold500,
                    borderRadius:14,padding:"12px 16px",marginTop:12}}>
                  <span style={{fontSize:13,color:T.ink,lineHeight:1.6,flex:"1 1 240px"}}>
                    {aiErr[`${donor.id}_${t}`]}
                  </span>
                  <button data-testid={`dp-suggested-retry-${t}`}
                    onClick={()=>getAI(donor,t,t==="nextmove"?openForNextMove:undefined)}
                    disabled={loadingKey===`${donor.id}_${t}`}
                    style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:8,
                      padding:"6px 13px",fontSize:12.5,fontWeight:700,color:T.ink,
                      cursor:loadingKey===`${donor.id}_${t}`?"wait":"pointer",fontFamily:"inherit"}}>
                    {loadingKey===`${donor.id}_${t}`?"Trying…":"Try again"}
                  </button>
                </div>
              ):null)}
            </div>
          </Modal>}
          {briefOpen&&<Modal onClose={()=>setBriefOpen(false)} width={640} title="Brief me">
            <div>{lockMajor(<BriefPanel donorId={donor.id} donorName={donor.name} isReadOnly={isReadOnly} canWrite={isTeam}/>,{minHeight:120})}</div>
          </Modal>}
          {planOpen&&<PlanFollowUpModal donor={{id:donor.id,name:donor.name}}
            onSaved={()=>loadDpThread()} onClose={()=>setPlanOpen(false)}/>}
        </div>
      </div>

      <div className="donor-profile-body" style={{flex:1,display:"grid",gridTemplateColumns:"minmax(0,1.25fr) minmax(0,0.75fr)",overflow:"hidden"}}>
        {/* LEFT — the main column. HOTFIX-1: its ground is named here rather
            than inherited, because the rail beside it is defined as being on a
            CONTRASTING ground and a contrast between two inherited values is
            not a contrast anybody can check. See docs/decisions/design-system.md. */}
        <div data-testid="dp-main-column" style={{overflowY:"auto",background:T.bg,borderRight:"1px solid "+T.bg3,display:"flex",flexDirection:"column"}}>
          {/* Tab Nav */}
          {/* ── THE FOUR FIGURES (PROFILE-1) ────────────────────────────
              Lifetime, Last gift, Last contact, Open ask — the four numbers an
              officer opens this record to check, above the tabs because they
              are true of the person and not of whichever tab is showing.

              Each one is a <Figure> with a SOURCE, so clicking it opens the
              rows behind it and those rows foot to the cent (the "every number
              opens" rule; figureSources.js holds the four donor-scoped
              sources, and the server hands over the value and the source
              together so the two can never be computed twice). The `?` beside
              the label is the census definition, unchanged and still keyboard
              reachable — the definition and the drill-through are different
              affordances and each keeps its own. */}
          {(figs||donor.figures)&&(
            <div className="donor-stat-grid" data-testid="dp-figures" style={{display:"grid",gridTemplateColumns:"repeat(4,minmax(0,1fr))",gap:10,padding:"18px 20px 4px 24px",flexShrink:0}}>
              {PROFILE_FIGURES.map(({key,label,kind,suffix,def})=>{
                const f=(figs||donor.figures)[key];
                if(!f)return null;
                return (
                  <div key={key} style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:12,padding:"12px 14px"}}>
                    <div style={{fontSize:9,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.1em",color:T.ink3,marginBottom:4}}>
                      {label}
                      {/* BUILD-100 — the definition travels with the number, on
                          the dashboards' hover convention: reachable by keyboard,
                          because a tooltip nobody can tab to is a definition that
                          does not exist for half the people who need it. */}
                      <span tabIndex={0} title={def} aria-label={def} data-testid={"dp-tile-def-"+label}
                        style={{marginLeft:5,fontSize:9,fontWeight:700,color:T.ink3,border:"1px solid "+T.bg3,
                                borderRadius:99,width:13,height:13,display:"inline-flex",alignItems:"center",
                                justifyContent:"center",cursor:"help",verticalAlign:"middle"}}>?</span>
                    </div>
                    {/* A BLANK IS SAID, NOT GUESSED (the design system's own
                        rule). An inline <Figure> draws an em dash when it has
                        no value, which on this row read as "we are not going
                        to tell you"; the short sentence says what will appear
                        there and when. There is nothing to open, so there is
                        no button either. */}
                    {/* BUILD-100 — the overdue colour stays on Last contact.
                        The DAYS are the server's figure now, but whether they
                        are late is still moveUrgency's judgment against this
                        donor's stage, and it is brass when they are (never
                        terracotta: overdue is late, not dangerous). The
                        inline Figure inherits its colour, so it is set here. */}
                    <div style={{fontSize:20,fontWeight:800,fontFamily:"'DM Serif Display',serif",lineHeight:1.1,
                                 color:T.ink}}>
                      {f.value===null||f.value===undefined
                        ?<span data-figure={"profile."+key} data-figure-key={"profile."+key} data-blank=""
                          /* FIX-8 Part B.4 — an absence is a SENTENCE, so it is
                             set in the body face. It was already quiet at
                             12.5px, but it inherited the display serif from
                             the figure above it, which is the face this app
                             uses for numbers and headings. */
                          style={{fontSize:12.5,fontWeight:400,color:T.ink3,lineHeight:1.45,
                            fontFamily:"'DM Sans',system-ui,sans-serif"}}>{f.blankShort||f.blank}</span>
                        :<Figure value={f.value} kind={kind} suffix={suffix&&Number(f.value)===1?suffix.replace(/s$/,""):(suffix||"")} label={label} definition={def}
                          source={f.source} blank={f.blank} blankShort={f.blankShort}
                          figureKey={"profile."+key} variant="inline"/>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* PARITY-1 — AT A GLANCE is one block: the four tiles above, then
              first, largest and average gift, the highlights and the next
              action with its suggested ask. Lifetime and Last gift are the
              tiles above, never repeated here. */}
          <ProfileGlance status={status}/>
          <div style={{padding:"10px 20px 4px 24px",flexShrink:0}}>
          {/* FIX-15 Part 4 — no gifts: one line with its add button, like the
              other empty sections (FIX-14 Part 3), instead of an empty chart. */}
          {!giftLoading&&!(giftsFull.length||gifts.length)
          ?<div data-testid="dp-giving-by-year" data-empty="1" style={{padding:"4px 2px",display:"flex",alignItems:"center",gap:8}}>
            <span style={{fontSize:10,fontWeight:800,textTransform:"uppercase",letterSpacing:"0.1em",color:T.ink3}}>Giving by year</span>
            <span style={{fontSize:12,color:T.ink3,fontStyle:"italic"}}>No gifts yet</span>
            {!isReadOnly&&<button data-testid="dp-giving-by-year-add" onClick={()=>{setDpTab("gifts");setAddGiftOpen(true);}}
              style={{marginLeft:"auto",background:"transparent",border:"1px solid "+T.bg3,borderRadius:7,padding:"3px 9px",color:T.greenDk,fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>+ Add a gift</button>}
          </div>
          :<div data-testid="dp-giving-by-year" style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:14,padding:"16px 18px"}}>
            <div style={{fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.1em",color:T.ink3,marginBottom:12}}>Giving by year</div>
            {giftLoading
              ?<div style={{height:80,display:"flex",alignItems:"center",justifyContent:"center",color:T.ink3,fontSize:12}}><Spin/></div>
              :<GivingByYearChart gifts={giftsFull.length?giftsFull:gifts} onOpenYear={y=>setYearDrill(y)}/>}
            <div style={{fontSize:11.5,color:T.ink3,marginTop:8,lineHeight:1.5}}>
              Every gift recorded against this record, added by the calendar year it was given in. A bar opens the gifts behind it.
            </div>
          </div>}
          </div>

          {/* FIX-8 Part A.1 — the profile's own tab strip wraps rather than
              scrolls, for the same reason the section strip does: it
              overflowed by a rounding pixel and drew a bar. `.dp-tabs` keeps
              its phone scroll in the media block. */}
          <div className="dp-tabs" style={{display:"flex",flexWrap:"wrap",background:T.white,borderBottom:"1px solid "+T.bg3,flexShrink:0}}>
            {[["overview","Overview"],["gifts","Gifts & Pledges"],["funds","Funds"],["related","Related"],["materials","Materials"],["activity","Activity"]].map(([id,label])=>(
              <button key={id} role="tab" aria-selected={dpTab===id} onClick={()=>setDpTab(id)} style={{background:"none",border:"none",padding:"11px 16px",color:T.ink3,fontSize:13,fontWeight:400,cursor:"pointer",whiteSpace:"nowrap",flexShrink:0,...activeMark(dpTab===id,"bottom")}}>
                {label}
                {id==="gifts"&&giftsFull.length>0&&<span style={{marginLeft:5,background:T.bg2,borderRadius:99,padding:"1px 6px",fontSize:10,fontWeight:700,color:T.ink3}}>{giftsFull.length}</span>}
                {id==="related"&&relationships.length>0&&<span style={{marginLeft:5,background:T.bg2,borderRadius:99,padding:"1px 6px",fontSize:10,fontWeight:700,color:T.ink3}}>{relationships.length}</span>}
                {id==="materials"&&materials.length>0&&<span style={{marginLeft:5,background:T.bg2,borderRadius:99,padding:"1px 6px",fontSize:10,fontWeight:700,color:T.ink3}}>{materials.length}</span>}
              </button>
            ))}
          </div>

          {/* Overview tab */}
          {dpTab==="overview"&&<div style={{padding:"22px 20px 24px 24px",display:"flex",flexDirection:"column",gap:18}}>
            {/* INT-BUILD-1 Part 3 — the next meeting with its brief, then one
                timeline of every email thread, meeting and gift. */}
            {rel?.nextMeeting&&<MeetingCard meeting={rel.nextMeeting} donor={donor} onReload={loadRel}/>}
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
            {rel&&<ProfileTimeline canWrite={!isReadOnly} inboxConnected={inboxConnected} onConnect={onNavigate?()=>onNavigate("settings",{section:"connections",focus:"inbox"}):null} rel={rel} donor={donor} gifts={giftsFull} interactions={localInts??donor.interactions??[]} onLog={m=>setLogMeeting(m)} renderActions={intActions} onChanged={()=>{loadRel();loadGiftsFull();loadDpThread();onInteractionAdded&&onInteractionAdded();}}/>}
            {logMeeting&&<Modal onClose={()=>setLogMeeting(null)} width={560} title="">
              <AfterMeetingForm meeting={{...logMeeting,people:[{id:donor.id,name:donor.name}]}} onDone={()=>{setLogMeeting(null);loadRel();loadGiftsFull();onInteractionAdded&&onInteractionAdded();}}/>
            </Modal>}
            {/* FIX-14 Part 3 — ONE OF EVERYTHING. One timeline (above), then the
                ask, the giving, the household, planned giving, membership and
                sequences, in that order. The next step lives once, in the rail;
                drafting, Suggested, Brief me, Erase and Delete are under More. */}
            {/* ── THE ASK ── the stage, the open ask and its history, in one place. */}
            {lockMajor(<ProposalsPanel donorId={donor.id} donorName={donor.name} isReadOnly={isReadOnly} canWrite={isTeam} onOpenProposals={setOpenProposals}
              title="The ask" addLabel="+ New ask" testid="dp-the-ask"
              after={<div style={{marginTop:12}}>
              {/* Pipeline: Moves & Asks (BUILD-15, Team plan). Core sees the real
                  panel behind glass + an Unlock-with-Team CTA (lockMajor). */}
              {lockMajor(
                <div style={{borderTop:"1px solid "+T.bg3,paddingTop:10}}>
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:7}}>
                    <div style={{fontSize:10,fontWeight:800,textTransform:"uppercase",letterSpacing:"0.1em",color:T.ink3}}>Moves and pipeline asks</div>
                    <div style={{display:"flex",gap:6}}>
                      {isTeam&&!isReadOnly&&<button onClick={addToPipeline} disabled={pipelineAdded} style={{background:pipelineAdded?"transparent":T.gold500,border:pipelineAdded?"1px solid "+T.bg3:"none",borderRadius:99,padding:"3px 10px",fontSize:11,fontWeight:700,color:pipelineAdded?T.ink3:T.ink,cursor:pipelineAdded?"default":"pointer"}}>{pipelineAdded?"✓ In pipeline":"+ Add to pipeline"}</button>}
                      {isTeam&&!isReadOnly&&<button onClick={()=>setAskOpen(v=>!v)} style={{background:"transparent",border:"1px solid "+T.bg3,borderRadius:99,padding:"3px 10px",fontSize:11,fontWeight:700,color:T.gold600,cursor:"pointer"}}>{askOpen?"Cancel":"+ Pipeline ask"}</button>}
                    </div>
                  </div>
                  {askOpen&&(
                    <div style={{display:"flex",gap:6,marginBottom:8,flexWrap:"wrap"}}>
                      <input value={askName} onChange={e=>setAskName(e.target.value)} placeholder="What's the ask? (optional)" style={{flex:"1 1 140px",border:"1px solid "+T.bg3,borderRadius:8,padding:"6px 9px",fontSize:12}}/>
                      <input value={askAmt} onChange={e=>setAskAmt(e.target.value)} placeholder="$ target" style={{width:100,border:"1px solid "+T.bg3,borderRadius:8,padding:"6px 9px",fontSize:12}}/>
                      <button onClick={addAsk} style={{background:T.greenDk,border:"none",borderRadius:8,padding:"6px 14px",fontSize:12,fontWeight:700,color:T.white,cursor:"pointer"}}>Save</button>
                    </div>
                  )}
                  {opps.length>0&&(
                    <div style={{display:"flex",flexDirection:"column",gap:5,marginBottom:moves.length?10:0}}>
                      {opps.map(o=>(
                        <div key={o.id} style={{display:"flex",alignItems:"center",gap:8,fontSize:12,padding:"6px 8px",borderRadius:8,background:o.status==="open"?T.gold500+"14":T.bg2}}>
                          <span style={{fontWeight:700,color:T.ink}}>{o.name}</span>
                          <span style={{color:T.gold600,fontWeight:800}}>{fmtFull(o.target_amount)} ask</span>
                          {o.status==="won"&&<span style={{color:T.greenDk,fontWeight:700}}>→ {fmtFull(o.gift_amount||0)} gift</span>}
                          {o.status==="lost"&&<span style={{color:T.terracotta,fontWeight:700}}>lost</span>}
                          <span style={{marginLeft:"auto",display:"flex",gap:6}}>
                            {o.status==="open"&&isTeam&&!isReadOnly&&<>
                              <button onClick={()=>closeAsk(o,"won")} style={{background:T.greenDk,border:"none",borderRadius:6,padding:"2px 9px",fontSize:11,fontWeight:700,color:T.white,cursor:"pointer"}}>Won</button>
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
                          <div><span style={{fontWeight:700,color:T.ink}}>{cap(m.from_stage)} → {cap(m.to_stage)}</span> <span style={{color:T.ink3}}>· {m.officer_name||"no officer"} · {new Date(m.created_at).toLocaleDateString("en-US",{month:"short",day:"numeric"})}</span></div>
                          {m.description&&<div style={{color:T.ink3,fontSize:11}}>{m.description}</div>}
                        </div>
                      ))}
                    </div>
                  )}
                  {isTeam&&moves.length===0&&opps.length===0&&<div style={{fontSize:11,color:T.ink3}}>No moves logged yet. Move this donor on the Pipeline board.</div>}
                </div>,
                {title:"Track asks & moves",blurb:"Log every ask against the gift it closes and keep this donor's full move history. Part of the Team major-gifts toolkit.",minHeight:170}
              )}
              </div>}>
          {/* The stage, and the smart moves that argue for changing it. Both
              are the major-gifts layer, so a Core org sees the one frosted
              preview — and, until the plan is KNOWN, the pending state and
              never a lock (FIX-3 finding 9, kept by HOTFIX-1). */}
          {isTeam&&<div data-testid="dp-move-stage" style={{marginBottom:12}}>
            <div style={{fontSize:11.5,fontWeight:700,color:T.ink3,marginBottom:7}}>Stage</div>
            <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
              {STAGES.map(s=>{
                const on=(donor.stage||"cultivate")===s.id;
                return <button key={s.id} onClick={()=>onStageChange(donor.id,s.id)} aria-pressed={on}
                  style={{background:on?T.greenDk:T.bg,border:"1px solid "+(on?T.greenDk:T.bg3),borderRadius:8,padding:"6px 11px",color:on?T.white:T.ink,fontSize:12,fontWeight:on?700:500,cursor:"pointer"}}>
                  {s.label}
                </button>;
              })}
            </div>
            <div style={{marginTop:9,fontSize:11.5,color:T.ink3,lineHeight:1.55}}>
              {STAGE_ACTION[donor.stage||"cultivate"]}
            </div>
            {(() => {
              // Smart-move suggestions (BUILD-22) — surfaced, never auto-applied.
              // Lapsed is set automatically elsewhere; these are the judgment
              // moves the officer owns, offered one-click. They sit WITH the
              // stage now, because that is the only thing they are about.
              const shown=moveSuggestions.filter(s=>!dismissedSug.includes(s.signal));
              if(!shown.length) return null;
              return <div style={{marginTop:12,display:"flex",flexDirection:"column",gap:8}}>
                {shown.map(s=>(
                  <div key={s.signal} style={{background:T.bg,borderLeft:"3px solid "+T.gold500,borderRadius:8,padding:"10px 12px"}}>
                    <div style={{fontSize:12,color:T.ink,lineHeight:1.5,marginBottom:8}}>{s.reason}</div>
                    <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                      {s.toStage&&!isReadOnly&&(
                        <button onClick={()=>acceptSuggestion(s)} style={{background:T.gold500,border:"none",borderRadius:7,padding:"5px 12px",color:T.ink,fontSize:11,fontWeight:800,cursor:"pointer",fontFamily:"inherit"}}>
                          Accept → {STAGES.find(st=>st.id===s.toStage)?.label||s.toStage}
                        </button>
                      )}
                      <button onClick={()=>dismissSuggestion(s)} style={{background:"transparent",border:"1px solid "+T.bg3,borderRadius:7,padding:"5px 12px",color:T.ink3,fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>Dismiss</button>
                    </div>
                  </div>
                ))}
              </div>;
            })()}
          </div>}
            {/* ENGAGE-1 §3 — the suggested ask, from their own gifts only. */}
            {scores&&scores.suggestedAsk&&<SuggestedAskLine ask={scores.suggestedAsk} style={{margin:"0 0 10px"}}/>}
            </ProposalsPanel>)}

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
            {/* BUILD-57 §2c — the lifetime figure and the itemized gift list
                legitimately differ when history arrived as an imported TOTAL
                (aggregate import writes total_giving/gift_count with no gift
                rows — the documented reason Top Donors' lifetime scope reads
                the column). Unlabeled, the two numbers read as a bug on a
                demo screen; so the gap explains itself, always. */}
            {!giftLoading&&donor.total-giftsFull.reduce((s,g)=>s+g.amount,0)>0.5&&(
              <div className="dp-unitemized-note" style={{fontSize:11.5,color:T.ink3,lineHeight:1.5,margin:"-8px 2px 0"}}>
                Lifetime includes <strong style={{color:T.ink2}}>{fmtFull(donor.total-giftsFull.reduce((s,g)=>s+g.amount,0))}</strong> recorded
                as an imported total: giving that predates Steward and was never itemized as individual gifts.
              </div>
            )}

            {/* PROFILE-1 — the cultivation plan and "Brief me" moved to the
                rail, with the rest of how-we-manage-them. The reading column
                keeps what she came to read. */}

            {/* PARITY-1 — Giving by year moved up into the at-a-glance block. */}
            {yearDrill&&(
              <MetricBreakdownPanel open onClose={()=>setYearDrill(null)}
                title={`Giving in ${yearDrill}`}
                explanation={`Every gift ${donor.name} gave between 1 January and 31 December ${yearDrill}, as it is recorded on this record.`}
                source={{key:"gifts",params:{donor:donor.id,from:`${yearDrill}-01-01`,to:`${yearDrill}-12-31`}}}/>
            )}

            {/* Household and relationships (BUILD-14; FIX-14 Part 3: one line when there is none) */}
            <div data-testid="dp-household" style={household?{background:T.white,border:"1px solid "+T.bg3,borderRadius:12,padding:"14px 16px",display:"flex",flexDirection:"column",gap:12}:{padding:"4px 2px",display:"flex",flexDirection:"column",gap:8}}>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <span style={{fontSize:10,fontWeight:800,textTransform:"uppercase",letterSpacing:"0.1em",color:T.ink3}}>Household and relationships</span>
                {household
                  ?<RecordLink to={householdHref(household.id)} data-record-link="household" style={{fontSize:12,color:T.ink,fontWeight:700,textDecoration:"underline dotted"}}>{household.name}</RecordLink>
                  :<span style={{fontSize:12,color:T.ink3,fontStyle:"italic"}}>Not in a household</span>}
                {household&&<EditedMarker item={household}/>}
                {household&&!isReadOnly&&<button data-testid="dp-household-rename" onClick={async()=>{
                    const name=window.prompt("Household name",household.name||"");
                    if(!name||!name.trim()||name.trim()===household.name)return;
                    try{await apiFetch(`/households/${household.id}`,{method:"PUT",body:JSON.stringify({name:name.trim()})});refreshSoftCredit();}
                    catch(e){alert(errorMessage(e,"The household could not be renamed."));}}}
                  style={{background:"none",border:"none",padding:0,color:T.ink3,fontSize:11,fontWeight:600,textDecoration:"underline",cursor:"pointer",fontFamily:"inherit"}}>Rename</button>}
                {household
                  ?!isReadOnly&&<button onClick={removeFromHousehold} style={{marginLeft:"auto",background:"transparent",border:"1px solid "+T.bg3,borderRadius:7,padding:"3px 9px",color:T.terracotta,fontSize:11,fontWeight:700,cursor:"pointer"}}>Remove</button>
                  :!isReadOnly&&<button onClick={()=>setHhModalOpen(true)} style={{marginLeft:"auto",background:"transparent",border:"1px solid "+T.bg3,borderRadius:7,padding:"3px 9px",color:T.greenMid,fontSize:11,fontWeight:700,cursor:"pointer"}}>+ Group into household</button>}
              </div>
              {household&&(
                <>
                  <div style={{display:"flex",gap:18,flexWrap:"wrap"}}>
                    <div><div style={{fontSize:10,color:T.ink3,textTransform:"uppercase",letterSpacing:".05em"}}>Hard credit</div><div style={{fontSize:16,fontWeight:800,color:T.ink}}>{fmtFull(softCredit?.hardCredit||0)}</div></div>
                    <div><div style={{fontSize:10,color:T.ink3,textTransform:"uppercase",letterSpacing:".05em"}}>Soft credit</div><div style={{fontSize:16,fontWeight:800,color:T.gold600}}>{fmtFull(softCredit?.softCredit||0)}</div></div>
                    <div style={{borderLeft:"1px solid "+T.bg3,paddingLeft:18}}><div style={{fontSize:10,color:T.ink3,textTransform:"uppercase",letterSpacing:".05em"}}>Household combined</div><div style={{fontSize:16,fontWeight:800,color:T.ink}}>{fmtFull(household.combined_giving)}</div></div>
                  </div>
                  <div style={{display:"flex",flexDirection:"column",gap:5}}>
                    {household.members.map(m=>(
                      <div key={m.id} onClick={()=>m.id!==donor.id&&onSelectRelatedDonor&&onSelectRelatedDonor(m.id)} style={{display:"flex",alignItems:"center",gap:8,fontSize:12,padding:"6px 8px",borderRadius:8,background:m.id===donor.id?T.greenDk+"10":"transparent",cursor:m.id!==donor.id?"pointer":"default"}}>
                        {/* BUILD-94 Part 1 — a household is the one place a
                            row names several people at once; faces are what
                            tell them apart at a glance. */}
                        <PersonMark id={m.id} name={m.name} size={22}/>
                        <span style={{fontWeight:m.id===donor.id?800:600,color:T.ink}}>{m.name}</span>
                        {m.is_primary&&<span style={{background:T.gold500,color:T.ink,borderRadius:99,padding:"1px 7px",fontSize:9,fontWeight:800,textTransform:"uppercase"}}>Primary</span>}
                        <span style={{marginLeft:"auto",color:T.ink3}}>{fmtFull(m.total_giving)}</span>
                      </div>
                    ))}
                  </div>
                  <div style={{fontSize:11,color:T.ink3}}>Combined view only: each gift's hard credit stays with the donor who gave it.</div>
                </>
              )}
              {hhModalOpen&&(
                <Modal onClose={()=>setHhModalOpen(false)} width={440} zIndex={1000}
                  backdrop="rgba(15,26,18,0.5)" blur={false} padding={20}
                  ariaLabel="Group into a household" dialogStyle={{background:T.bg,borderRadius:16,maxHeight:"80vh"}}>
                  <div style={{display:"flex",flexDirection:"column",gap:12}}>
                    <div style={{fontFamily:"'DM Serif Display',Georgia,serif",fontSize:19,color:T.ink}}>Group {donor.name} into a household</div>
                    <div style={{fontSize:12,color:T.ink3}}>Pick the spouse/partner(s) to combine with. {donor.name} becomes the primary. Hard credit stays with each donor; only the relationship view combines.</div>
                    <input value={hhSearch} onChange={e=>setHhSearch(e.target.value)} placeholder="Search donors…" style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:9,padding:"9px 12px",fontSize:13,color:T.ink,outline:"none"}}/>
                    <div style={{overflowY:"auto",display:"flex",flexDirection:"column",gap:4,flex:1}}>
                      {allDonors.filter(x=>x.id!==donor.id&&!x.householdId&&(!hhSearch.trim()||(x.name+(x.email||"")).toLowerCase().includes(hhSearch.toLowerCase()))).slice(0,40).map(x=>{
                        const picked=hhPick.has(x.id);
                        return(
                          <label key={x.id} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 10px",borderRadius:9,background:picked?T.greenDk+"12":T.white,border:"1px solid "+(picked?T.greenDk+"55":T.bg3),cursor:"pointer"}}>
                            <input type="checkbox" checked={picked} onChange={()=>{const n=new Set(hhPick);n.has(x.id)?n.delete(x.id):n.add(x.id);setHhPick(n);}} style={{accentColor:T.greenDk}}/>
                            <span style={{fontSize:13,fontWeight:600,color:T.ink}}>{x.name}</span>
                            <span style={{marginLeft:"auto",fontSize:11,color:T.ink3}}>{fmtFull(x.total||0)}</span>
                          </label>
                        );
                      })}
                    </div>
                    <div style={{display:"flex",justifyContent:"flex-end",gap:8}}>
                      <button onClick={()=>{setHhModalOpen(false);setHhPick(new Set());}} style={{background:"transparent",border:"1px solid "+T.bg3,borderRadius:9,padding:"9px 16px",fontSize:13,fontWeight:700,color:T.ink3,cursor:"pointer"}}>Cancel</button>
                      <button onClick={createHousehold} disabled={hhPick.size===0} style={{background:hhPick.size?T.greenDk:T.bg3,color:T.white,border:"none",borderRadius:9,padding:"9px 18px",fontSize:13,fontWeight:700,cursor:hhPick.size?"pointer":"not-allowed"}}>Create household</button>
                    </div>
                  </div>
                </Modal>
              )}
            </div>
            {householdTotal!=null&&(
              <div style={{background:T.gold+"12",border:"1px solid "+T.gold+"40",borderRadius:12,padding:"10px 14px",fontSize:12,color:T.ink,cursor:"pointer"}} onClick={()=>setDpTab("related")}>
                <strong>{fmtFull(donor.total)}</strong> individually · <strong style={{color:T.gold700}}>{fmtFull(householdTotal)}</strong> household total. <span style={{color:T.greenDk,fontWeight:700}}>See who's linked →</span>
              </div>
            )}

            {/* BUILD-98 Part 1 — soft credit on OTHER people's gifts. Hard
                credit is their own money and stays the headline; "with soft
                credit" is a second figure, labelled, with the gifts it comes
                from listed so the number can be checked. */}
            {softCredit?.giftSoftCredits?.length>0&&(
              <div data-testid="soft-credit-panel" style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:12,padding:"14px 16px",display:"flex",flexDirection:"column",gap:10}}>
                <span style={{fontSize:10,fontWeight:800,textTransform:"uppercase",letterSpacing:"0.1em",color:T.ink3}}>Soft credit</span>
                <div style={{display:"flex",gap:18,flexWrap:"wrap"}}>
                  {[["Their own giving",softCredit.hardCredit,T.ink,censusById("profile.creditHard")],
                    ["With soft credit",softCredit.hardPlusGiftSoft,T.gold600,censusById("profile.creditWithSoft")]].map(([l,v,c,e])=>(
                    <div key={l} data-testid={e.testid} title={e.sentence} aria-label={e.sentence} tabIndex={0}>
                      <div style={{fontSize:10,color:T.ink3,textTransform:"uppercase",letterSpacing:".05em"}}>{l}</div>
                      <div style={{fontSize:16,fontWeight:800,color:c}}>{fmtFull(v||0)}</div>
                    </div>))}
                </div>
                {/* FIX-7 Part 1 — what they RAISED, said the way a fundraiser
                    would say it. A soft credit is not a gift from this person:
                    it leaves their lifetime total, their last gift, their
                    drift and their LYBUNT standing exactly where they were. */}
                {softCredit.raisedFor?.length>0&&(
                  <div data-testid="raised-for" style={{display:"flex",flexDirection:"column",gap:3}}>
                    {softCredit.raisedFor.map(rf=>(
                      <div key={rf.pageId} style={{fontSize:13,color:T.ink,fontWeight:700}}>
                        Raised {fmtFull((rf.amountCents||0)/100)} for {rf.pageTitle}
                        <span style={{fontWeight:400,color:T.ink3}}> · {rf.giftCount} {rf.giftCount===1?"gift":"gifts"}</span>
                      </div>))}
                    <div style={{fontSize:11.5,color:T.ink3,lineHeight:1.5}}>{softCredit.raisedForSentence}</div>
                  </div>)}
                                <div style={{display:"flex",flexDirection:"column",gap:4}}>
                  {softCredit.giftSoftCredits.slice(0,8).map(sc=>(
                    <div key={sc.id} style={{display:"flex",gap:8,fontSize:12,color:T.ink}}>
                      <span style={{fontWeight:700}}>{sc.giverName}</span>
                      <span style={{color:T.ink3}}>{displayDate(sc.date)}</span>
                      <span style={{marginLeft:"auto"}}>{fmtFull(sc.amount)}</span>
                    </div>))}
                </div>
              </div>
            )}

            {/* FIX-14 Part 3 — planned giving is its own line, one line until something is marked. */}
            {(()=>{const anyOn=DESIGNATION_OPTS.some(([k])=>hasDesignation(k));const open=anyOn||pgOpen;return(
              <div data-testid="dp-planned-giving" style={open?{background:T.white,border:"1px solid "+T.bg3,borderRadius:12,padding:"14px 16px"}:{padding:"4px 2px",display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
                <div style={{fontSize:10,fontWeight:800,textTransform:"uppercase",letterSpacing:"0.1em",color:T.ink3,marginBottom:open?7:0}}>Planned giving</div>
                {!open&&<span style={{fontSize:12,color:T.ink3,fontStyle:"italic"}}>Nothing noted</span>}
                {!open&&!isReadOnly&&<button onClick={()=>setPgOpen(true)} style={{marginLeft:"auto",background:"transparent",border:"1px solid "+T.bg3,borderRadius:7,padding:"3px 9px",color:T.greenMid,fontSize:11,fontWeight:700,cursor:"pointer"}}>+ Note planned giving</button>}
                {open&&<div style={{display:"flex",gap:7,flexWrap:"wrap"}}>
                  {DESIGNATION_OPTS.map(([k,label])=>{const on=hasDesignation(k);return(
                    <button key={k} onClick={()=>!isReadOnly&&toggleDesignation(k)} disabled={isReadOnly} title={isReadOnly?"Reactivate your subscription to make changes.":undefined}
                      aria-pressed={on} data-designation={k} data-on={on?"1":"0"}
                      style={{background:"transparent",color:T.ink3,border:"1px solid "+T.bg3,borderRadius:7,padding:"4px 11px",fontSize:11,fontWeight:700,cursor:isReadOnly?"not-allowed":"pointer",...activeMark(on,"bottom")}}>
                      {on?"✓ ":""}{label}
                    </button>
                  );})}
                </div>}
              </div>);})()}
            {/* BUILD-98 (switch) Part 5 — hours, on the person. */}
            <MembershipPanel donor={donor} isReadOnly={isReadOnly}/>

                    {/* Folded by default: the things she opens when she needs them, and
              not before. Each one says how much is inside on its own label,
              so folding never hides a count. */}
          {isTeam&&sequences.length>0&&(
            <div data-testid="dp-sequences" style={{padding:"4px 2px",display:"flex",flexDirection:"column",gap:8}}>
              <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}><span style={{fontSize:10,fontWeight:800,textTransform:"uppercase",letterSpacing:"0.1em",color:T.ink3}}>Sequences</span>
              </div>
              {seqToast&&<div style={{background:T.bg,borderLeft:"3px solid "+T.green500,borderRadius:8,padding:"8px 12px",fontSize:12,color:T.ink,fontWeight:600,marginBottom:8}}>{seqToast}</div>}
              <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
                {!seqOpen?<button onClick={()=>{setSeqOpen(true);setSeqId("");}} style={{background:"transparent",border:"1px dashed "+T.bg3,borderRadius:8,padding:"6px 12px",fontSize:12,color:T.ink,cursor:"pointer"}}>+ Enroll in sequence</button>
                :<>
                  <select value={seqId} onChange={e=>setSeqId(e.target.value)} style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"6px 10px",color:T.ink,fontSize:12,outline:"none",cursor:"pointer",flex:1}}>
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
                  }} style={{background:seqId?T.greenDk:T.bg3,border:"none",borderRadius:8,padding:"6px 12px",color:seqId?T.white:T.ink3,fontSize:12,fontWeight:700,cursor:seqId?"pointer":"not-allowed"}}>
                    {seqLoading?"…":"Enroll"}
                  </button>
                  <button onClick={()=>{setSeqOpen(false);setSeqId("");}} style={{background:"transparent",border:"none",padding:"6px 8px",color:T.ink3,fontSize:12,cursor:"pointer"}}>✕</button>
                </>}
              </div>
            </div>
          )}


            {/* BUILD-98 (switch) Part 5 — hours, on the person. */}
            <VolunteerPanel donor={donor} isReadOnly={isReadOnly}/>
            {/* Matching-gift flag — from a curated static list (matchingGifts.js
                on the backend), not a live vendor feed; source/last-verified
                is surfaced on hover so this reads as informed, not magic. */}
            {donor.matchingGift&&(
              <div title={`${donor.matchingGift.sourceNote} List curated ${donor.matchingGift.lastVerified}.`}
                style={{background:T.greenDk+"12",border:"1px solid "+T.greenDk+"40",borderRadius:12,padding:"10px 14px",fontSize:12,color:T.ink,display:"flex",alignItems:"flex-start",gap:8}}>
                <div>
                  <div><strong>{donor.matchingGift.companyName}</strong> matches employee gifts {donor.matchingGift.ratio}. Ask {donor.name.split(" ")[0]} to submit a match request.</div>
                  <div style={{fontSize:10,color:T.ink3,marginTop:2}}>Curated list, not a live feed. Verify current terms before outreach.</div>
                </div>
              </div>
            )}

            {/* BUILD-100 Part 7 — A FUNDER IS AN ORGANISATION ON FILE, so its
                type, its EIN, its grants and every document signed with it
                live on its own record rather than a second one. */}
            {donor.kind==="organisation"&&<FunderPanel donorId={donor.id} isReadOnly={isReadOnly} isTeam={isTeam}
              onOpenGrant={onNavigate?(id=>onNavigate("grants",{grantId:id})):undefined}/>}

            {donor.tags?.length>0&&<div style={{display:"flex",gap:5,flexWrap:"wrap"}}>{donor.tags.map(t=><Pill key={t} label={t}/>)}</div>}
            {donor.notes&&<div style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:10,padding:"12px 14px",fontSize:13,color:T.ink3,lineHeight:1.6}}>{donor.notes}</div>}

            {isAdmin&&eraseOpen&&(<Modal onClose={()=>setEraseOpen(false)} width={520} title="Erase this person">
              <div data-testid="dp-erase-confirm" style={{fontSize:13.5,color:T.ink,lineHeight:1.55}}>
                <strong>Erase {donor.name}?</strong> Their name, contact details, notes, tags, photo and every logged email, meeting and conversation are removed for good. Their gifts stay as anonymous gifts, so your books, the receipts already issued and every total still match to the cent. If they asked not to be emailed, their address stays on your do-not-email list so they are never mailed again. This cannot be undone.
                <div style={{display:"flex",gap:8,marginTop:10,flexWrap:"wrap",alignItems:"center"}}>
                  <input value={eraseWord} onChange={e=>setEraseWord(e.target.value)} placeholder="Type ERASE" aria-label="Type ERASE to confirm"
                    style={{border:"1px solid "+T.bg3,borderRadius:8,padding:"8px 10px",fontSize:13,fontFamily:"inherit",width:140}}/>
                  <button disabled={eraseWord!=="ERASE"||eraseBusy} onClick={erasePerson}
                    style={{background:eraseWord==="ERASE"?T.terracotta:T.bg3,border:"none",borderRadius:8,padding:"9px 16px",color:T.white,fontSize:13,fontWeight:700,cursor:eraseWord==="ERASE"?"pointer":"not-allowed"}}>{eraseBusy?"Erasing…":"Erase for good"}</button>
                  <button onClick={()=>setEraseOpen(false)} style={{background:"none",border:"none",color:T.ink3,fontSize:13,cursor:"pointer"}}>Cancel</button>
                </div>
                {eraseMsg&&<div role="status" style={{marginTop:8}}>{eraseMsg}</div>}
              </div>
            </Modal>)}
          </div>}

          {/* Gifts & Pledges tab */}
          {dpTab==="gifts"&&<div style={{padding:"20px 20px 24px 24px",display:"flex",flexDirection:"column",gap:18}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
              <div>
                <div style={{fontSize:14,fontWeight:800,color:T.ink}}>Gift History</div>
                <div style={{fontSize:12,color:T.ink3,marginTop:2}}>
                  Total: <strong style={{color:T.greenDk}}>{fmtFull(giftsFull.reduce((s,g)=>s+g.amount,0))}</strong> · {giftsFull.length} gifts
                  {donor.total-giftsFull.reduce((s,g)=>s+g.amount,0)>0.5&&(
                    <span className="dp-unitemized-note"> · lifetime {fmtFull(donor.total)} includes {fmtFull(donor.total-giftsFull.reduce((s,g)=>s+g.amount,0))} of imported history not itemized below</span>
                  )}
                </div>
              </div>
              <div style={{display:"flex",gap:8,alignItems:"center"}}>
                <button onClick={exportGiftsCSV} style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"6px 12px",color:T.ink3,fontSize:12,cursor:"pointer"}}>↓ CSV</button>
                {receiptsEnabled&&(
                  <button onClick={()=>setShowYearEnd(v=>!v)} disabled={isReadOnly} aria-pressed={showYearEnd} title={isReadOnly?"Reactivate your subscription to make changes.":undefined}
                    style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"6px 12px",color:T.ink3,fontSize:12,fontWeight:600,cursor:isReadOnly?"not-allowed":"pointer",opacity:isReadOnly?0.45:1,...activeMark(showYearEnd,"bottom")}}>
                    Year-end statement
                  </button>
                )}
                <button onClick={()=>setAddGiftOpen(v=>!v)} disabled={isReadOnly} title={isReadOnly?"Reactivate your subscription to make changes.":undefined} style={{background:T.greenDk,border:"none",borderRadius:8,padding:"7px 12px",color:T.white,fontSize:12,fontWeight:700,cursor:isReadOnly?"not-allowed":"pointer",opacity:isReadOnly?0.45:1}}>+ Add Gift</button>
              </div>
            </div>

            {!receiptsEnabled&&isAdmin&&(
              <div style={{background:T.gold100,border:"1px solid "+T.gold300,borderRadius:10,padding:"10px 14px",fontSize:12,color:T.gold700}}>
                Tax receipts aren't set up yet. Add your organization's legal info in Settings to send IRS-compliant receipts for gifts of $250+.
              </div>
            )}

            {showYearEnd&&receiptsEnabled&&(
              <div style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:12,padding:"16px"}}>
                <div style={{fontSize:12,fontWeight:700,color:T.ink,marginBottom:10}}>Year-End Giving Statement</div>
                <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
                  <span style={{fontSize:11,color:T.ink3}}>Tax year</span>
                  <input type="number" value={yearEndYear} onChange={e=>setYearEndYear(e.target.value)} style={{width:100,background:T.bg,border:"1px solid "+T.bg3,borderRadius:6,padding:"6px 8px",color:T.ink,fontSize:12,outline:"none"}}/>
                  <button onClick={sendYearEndStatement} disabled={yearEndBusy} style={{background:T.greenDk,border:"none",borderRadius:6,padding:"7px 12px",color:T.white,fontSize:12,fontWeight:700,cursor:yearEndBusy?"not-allowed":"pointer"}}>
                    {yearEndBusy?"Generating…":"Generate & email"}
                  </button>
                  <button onClick={()=>setShowYearEnd(false)} style={{background:T.bg,border:"none",borderRadius:6,padding:"7px 10px",color:T.ink3,fontSize:12,cursor:"pointer"}}>Cancel</button>
                </div>
                {yearEndErr&&<div style={{fontSize:11,color:T.terra700,marginTop:8}}>{yearEndErr}</div>}
                <div style={{fontSize:11,color:T.ink3,marginTop:8,lineHeight:1.5}}>Consolidates every {yearEndYear} gift into one statement, emailed to the donor and superseding any prior statement for that year.</div>
              </div>
            )}

            {/* Recurring gift health — failed-payment recovery status */}
            {recurringSub&&(()=>{
              const RS_META={
                active:      {label:"Active",         color:T.greenDk},
                past_due:    {label:"Payment failed",  color:T.terracotta},
                recovering:  {label:"Recovering",      color:T.gold500},
                recovered:   {label:"Card fixed",      color:T.greenDk},
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
                      style={{background:meta.color,border:"none",borderRadius:8,padding:"6px 12px",color:T.white,fontSize:12,fontWeight:700,cursor:(isReadOnly||recurResendBusy||recurResendSent)?"not-allowed":"pointer",opacity:(isReadOnly||recurResendBusy||recurResendSent)?0.5:1,whiteSpace:"nowrap"}}>
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
                <option value="">Campaign: not attributed</option>
                {campaigns.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <div style={{fontSize:11,color:T.ink3,marginBottom:8,lineHeight:1.4}}>Which goal this counts toward. It updates that campaign's thermometer live.</div></>}
              {pledges.filter(p=>p.status==="open").length>0&&(
                <select value={addGiftForm.pledgeId} onChange={e=>setAddGiftForm(p=>({...p,pledgeId:e.target.value}))} style={{width:"100%",background:T.bg,border:"1px solid "+T.terracotta+"50",borderRadius:8,padding:"8px 10px",color:T.ink,fontSize:13,outline:"none",boxSizing:"border-box",marginBottom:8}}>
                  <option value="">Not fulfilling a pledge</option>
                  {pledges.filter(p=>p.status==="open").map(p=>(
                    <option key={p.id} value={p.id}>Fulfills {fmtFull(p.amount)} pledge due {displayDate(p.due_date)}</option>
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
                  <input type="checkbox" checked={addGiftForm.acknowledgement_sent} onChange={e=>setAddGiftForm(p=>({...p,acknowledgement_sent:e.target.checked}))} style={{accentColor:T.greenDk}}/>
                  Acknowledgement sent
                </label>
              </div>
              <div style={{display:"flex",gap:8}}>
                <button onClick={addGift} disabled={giftSaving} style={{background:T.greenDk,border:"none",borderRadius:8,padding:"8px 16px",color:T.white,fontSize:13,fontWeight:700,cursor:"pointer"}}>Save</button>
                <button onClick={()=>setAddGiftOpen(false)} style={{background:T.bg,border:"none",borderRadius:8,padding:"8px 14px",color:T.ink3,fontSize:13,cursor:"pointer"}}>Cancel</button>
              </div>
            </div>}

            <div style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:12,overflow:"hidden"}}>
              {giftLoading?<div style={{padding:24,textAlign:"center",color:T.ink3,fontSize:12}}><Spin/></div>:giftsFull.length===0?(
                <div style={{display:"flex",flexDirection:"column",alignItems:"center",padding:"40px 24px",textAlign:"center",gap:0}}>
                  <div style={{marginBottom:16,color:T.greenDk,opacity:0.7}}>
                    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
                    </svg>
                  </div>
                  <div style={{fontFamily:"'DM Serif Display',Georgia,serif",fontSize:20,fontWeight:400,color:T.ink,letterSpacing:"-0.01em",marginBottom:8}}>No gifts recorded yet.</div>
                  <div style={{fontSize:13,color:T.ink3,maxWidth:260,lineHeight:1.65,marginBottom:20}}>Log your first gift to start tracking acknowledgments and giving history.</div>
                  <button onClick={()=>setAddGiftOpen(true)} disabled={isReadOnly} title={isReadOnly?"Reactivate your subscription to make changes.":undefined}
                    style={{background:T.greenDk,color:T.white,border:"none",borderRadius:10,padding:"10px 22px",fontSize:13,fontWeight:600,cursor:isReadOnly?"not-allowed":"pointer",opacity:isReadOnly?0.45:1,fontFamily:"'DM Sans',system-ui,sans-serif"}}>
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
                      <tr key={g.id} id={`gift-${g.id}`} style={{borderBottom:"1px solid "+T.bg3}}>
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
                                <input type="checkbox" checked={!!giftEditForm.acknowledgement_sent} onChange={e=>setGiftEditForm(p=>({...p,acknowledgement_sent:e.target.checked}))} style={{accentColor:T.greenDk}}/>
                                Ack
                              </label>
                              <button onClick={()=>saveGiftEdit(g.id)} disabled={giftSaving} style={{background:T.greenDk,border:"none",borderRadius:6,padding:"5px 10px",color:T.white,fontSize:11,fontWeight:700,cursor:"pointer"}}>Save</button>
                              <button onClick={()=>setGiftEditId(null)} style={{background:T.bg,border:"none",borderRadius:6,padding:"5px 10px",color:T.ink3,fontSize:11,cursor:"pointer"}}>Cancel</button>
                            </div>
                          </td>
                        ):(
                          <>
                            <td style={{padding:"9px 12px",color:T.ink3,whiteSpace:"nowrap"}}>{displayDate(g.date)}</td>
                            <td style={{padding:"9px 12px",fontWeight:700,color:T.greenDk,whiteSpace:"nowrap"}}>{fmtFull(g.amount)}</td>
                            <td style={{padding:"9px 12px",color:T.ink3,textTransform:"capitalize"}}>{g.type||"cash"}</td>
                            <td style={{padding:"9px 12px",color:T.ink3}}>{g.payment_method||"Not recorded"}</td>
                            <td style={{padding:"9px 12px",textAlign:"center"}}>{g.acknowledgement_sent?<span style={{color:T.greenDk,fontSize:13}}>✓</span>:<span style={{color:T.ink3,fontSize:12}}>Not yet</span>}</td>
                            <td style={{padding:"9px 12px",whiteSpace:"nowrap"}}>
                              {(()=>{
                                const r=receiptForGift(g.id);
                                // FIX-15 Part 3: a tick means EMAILED. A receipt the provider refused is
                                // issued (it has a number and a PDF) but not sent, and says so in brass.
                                if(r) return <button onClick={()=>downloadReceiptPdf(r.id,`receipt-${r.receipt_number}.pdf`)} title={r.sent_at?undefined:"Issued, but the email did not go. Download the PDF to send it yourself."} style={{background:"none",border:"none",color:r.sent_at?T.greenDk:T.gold700,fontSize:11,fontWeight:700,cursor:"pointer",padding:"2px 4px"}}>{r.sent_at?`Receipt ✓ #${r.receipt_number}`:`Receipt #${r.receipt_number}, not emailed`}</button>;
                                if(!receiptsEnabled) return <span style={{color:T.ink3,fontSize:12}}>Off</span>;
                                const busy=receiptBusyId===g.id;
                                return <button onClick={()=>sendReceipt(g.id)} disabled={busy||isReadOnly} title={isReadOnly?"Reactivate your subscription to make changes.":""} style={{background:"none",border:"1px solid "+T.bg3,borderRadius:6,color:isReadOnly?T.ink3:T.greenDk,fontSize:11,fontWeight:600,cursor:isReadOnly?"not-allowed":"pointer",padding:"3px 8px",opacity:busy?0.6:1}}>{busy?"Sending…":"Send receipt"}</button>;
                              })()}
                            </td>
                            <td style={{padding:"9px 12px",color:T.ink3,maxWidth:180,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}
                              title={[g.notes,...giftCfDefs.map(d=>{const v=(g.custom_fields||{})[d.key];return (v!==null&&v!==undefined&&v!=="")?`${d.label}: ${renderCustomValue(d,v)}`:null;}).filter(Boolean)].filter(Boolean).join(" · ")}>
                              {[g.notes,...giftCfDefs.map(d=>{const v=(g.custom_fields||{})[d.key];return (v!==null&&v!==undefined&&v!=="")?`${d.label}: ${renderCustomValue(d,v)}`:null;}).filter(Boolean)].filter(Boolean).join(" · ")}</td>
                            <td style={{padding:"9px 12px",whiteSpace:"nowrap"}}>
                              <button onClick={()=>{setGiftEditId(g.id);setGiftEditForm({amount:g.amount,date:g.date,type:g.type,payment_method:g.payment_method||"",notes:g.notes||"",fund_id:g.fund_id||"",acknowledgement_sent:g.acknowledgement_sent,customFields:Object.fromEntries(giftCfDefs.map(d=>[d.key,giftCfEditStr(d,(g.custom_fields||{})[d.key])]))});}} style={{background:"none",border:"none",color:T.ink3,fontSize:12,cursor:"pointer",padding:"2px 6px"}}>Edit</button>
                              <button onClick={()=>deleteGift(g.id)} style={{background:"none",border:"none",color:T.terracotta,fontSize:12,cursor:"pointer",padding:"2px 6px"}}>Delete</button>
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
                    <option value="">No campaign (general pledge)</option>
                    {campaigns.map(c=><option key={c.id} value={c.id}>Counts toward: {c.name}</option>)}
                  </select>
                )}
                <input value={pledgeForm.notes} onChange={e=>setPledgeForm(p=>({...p,notes:e.target.value}))} placeholder="Notes (optional)" style={{width:"100%",background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"7px 10px",color:T.ink,fontSize:12,outline:"none",boxSizing:"border-box",marginBottom:8}}/>
                <div style={{display:"flex",gap:8}}>
                  <button onClick={addPledge} disabled={pledgeSaving} style={{background:T.terracotta,border:"none",borderRadius:8,padding:"7px 14px",color:T.white,fontSize:12,fontWeight:700,cursor:"pointer"}}>Save</button>
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
                            {isOverdue&&<span style={{fontSize:10,fontWeight:800,color:T.gold700}}>{daysOver}d overdue · reminder {Math.min(pl.reminder_step+1,4)}/4 sent</span>}
                          </div>
                          <div style={{fontSize:11,color:T.ink3,marginTop:2}}>Due {displayDate(pl.due_date)}{pl.campaign_id?(()=>{const c=campaigns.find(x=>x.id===pl.campaign_id);return c?` · counts toward ${c.name}`:"";})():""}</div>
                          {pl.notes&&<div style={{fontSize:12,color:T.ink3,marginTop:3,lineHeight:1.4}}>{pl.notes}</div>}
                          {pledgeEdit&&pledgeEdit.id===pl.id&&<div data-testid="pledge-edit" style={{display:"flex",gap:6,flexWrap:"wrap",marginTop:8}}>
                            <input aria-label="Amount" value={pledgeEdit.amount} onChange={e=>setPledgeEdit({...pledgeEdit,amount:e.target.value})} style={{width:100,border:"1px solid "+T.bg3,borderRadius:7,padding:"6px 8px",fontSize:12}}/>
                            <input aria-label="Due" type="date" value={pledgeEdit.dueDate} onChange={e=>setPledgeEdit({...pledgeEdit,dueDate:e.target.value})} style={{border:"1px solid "+T.bg3,borderRadius:7,padding:"5px 8px",fontSize:12}}/>
                            <input aria-label="Note" value={pledgeEdit.notes} onChange={e=>setPledgeEdit({...pledgeEdit,notes:e.target.value})} placeholder="Note" style={{flex:"1 1 140px",border:"1px solid "+T.bg3,borderRadius:7,padding:"6px 8px",fontSize:12}}/>
                            <button onClick={savePledgeEdit} style={{background:T.greenDk,border:"none",borderRadius:7,padding:"6px 12px",color:T.white,fontSize:12,fontWeight:700,cursor:"pointer"}}>Save</button>
                            <button onClick={()=>setPledgeEdit(null)} style={{background:"none",border:"none",color:T.ink3,fontSize:12,cursor:"pointer"}}>Cancel</button>
                          </div>}
                        </div>
                        <div style={{display:"flex",gap:6,alignItems:"center",flexShrink:0}}>
                          {pl.status==="open"&&<>
                            {isOverdue&&<button onClick={()=>resendPledgeReminder(pl.id)} disabled={isReadOnly||pledgeResendBusyId===pl.id||pledgeResentIds.has(pl.id)}
                              style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:6,padding:"5px 9px",color:T.ink2,fontSize:11,fontWeight:600,cursor:(isReadOnly||pledgeResendBusyId===pl.id||pledgeResentIds.has(pl.id))?"not-allowed":"pointer",opacity:(isReadOnly||pledgeResendBusyId===pl.id||pledgeResentIds.has(pl.id))?0.5:1}}>
                              {pledgeResentIds.has(pl.id)?"Sent ✓":pledgeResendBusyId===pl.id?"Sending…":"Resend reminder"}
                            </button>}
                            <button onClick={()=>setPledgeStatus(pl.id,"fulfilled")} disabled={isReadOnly} style={{background:T.green100,border:"1px solid "+T.greenDk,borderRadius:6,padding:"5px 9px",color:T.greenDk,fontSize:11,fontWeight:600,cursor:isReadOnly?"not-allowed":"pointer"}}>Mark Fulfilled</button>
                            <button onClick={()=>setPledgeStatus(pl.id,"written_off")} disabled={isReadOnly} style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:6,padding:"5px 9px",color:T.ink3,fontSize:11,fontWeight:600,cursor:isReadOnly?"not-allowed":"pointer"}}>Write Off</button>
                          </>}
                          <EditedMarker item={pl}/>
                          {!isReadOnly&&<button onClick={()=>setPledgeEdit({id:pl.id,amount:String(pl.amount),dueDate:String(pl.due_date||"").slice(0,10),notes:pl.notes||""})} style={{background:"none",border:"1px solid "+T.bg3,borderRadius:6,padding:"5px 9px",color:T.ink2,fontSize:11,fontWeight:600,cursor:"pointer"}}>Edit</button>}
                          <button onClick={()=>deletePledge(pl.id)} aria-label="Delete this pledge" style={{background:"none",border:"none",color:T.terracotta,fontSize:14,cursor:"pointer",flexShrink:0,padding:"2px 4px"}}>×</button>
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
                      <button onClick={()=>deletePlannedGift(pg.id)} style={{background:"none",border:"none",color:T.terracotta,fontSize:12,cursor:"pointer",flexShrink:0,padding:"2px 4px"}}>×</button>
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
                              <div style={{fontSize:14,fontWeight:800,color:T.ink}}>{fmtFull(f.total)}</div>
                              <div style={{fontSize:10,color:T.ink3}}>{f.pct}% of lifetime</div>
                            </div>
                          </div>
                          <div style={{background:T.bg3,borderRadius:99,height:6,overflow:"hidden",marginBottom:6}}>
                            <div style={{height:"100%",background:T.greenDk,borderRadius:99,width:`${Math.round(f.total/maxFund*100)}%`,transition:"width 0.4s"}}/>
                          </div>
                          <div style={{fontSize:11,color:T.ink3}}>{f.giftCount} gift{f.giftCount!==1?"s":""} · Last: {displayDate(f.lastDate)}</div>
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
                        <div style={{flex:1,background:T.greenDk}}/>
                      </div>
                      <div style={{display:"flex",gap:16,fontSize:12}}>
                        <div style={{display:"flex",alignItems:"center",gap:5}}><span style={{width:10,height:10,borderRadius:2,background:T.gold500,display:"inline-block"}}/>Restricted: {fmtFull(restrictedTotal)} ({rPct}%)</div>
                        <div style={{display:"flex",alignItems:"center",gap:5}}><span style={{width:10,height:10,borderRadius:2,background:T.greenDk,display:"inline-block"}}/>Unrestricted: {fmtFull(unrestrictedTotal)} ({uPct}%)</div>
                      </div>
                    </>);
                  })():<div style={{fontSize:12,color:T.ink3,fontStyle:"italic"}}>No giving data yet</div>}
                </div>

                {affinity.length>0&&(
                  <div style={{background:T.gold500+"10",border:"1px solid "+T.gold500+"40",borderRadius:12,padding:"14px 16px"}}>
                    <div style={{fontSize:12,fontWeight:700,color:T.gold500,marginBottom:8}}>Suggested Asks</div>
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
                <div style={{fontSize:13,color:T.ink}}><strong>{fmtFull(donor.total)}</strong> individually · <strong style={{color:T.gold700}}>{fmtFull(householdTotal)}</strong> household total</div>
              </div>
            )}

            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
              <div style={{fontSize:14,fontWeight:800,color:T.ink}}>Linked Donors</div>
              {!isReadOnly&&<button onClick={()=>{setRelPickerOpen(v=>!v);setRelErr("");}} style={{background:T.greenDk,border:"none",borderRadius:7,padding:"6px 12px",color:T.white,fontSize:12,fontWeight:700,cursor:"pointer"}}>+ Link to another donor</button>}
            </div>

            {relPickerOpen&&(
              <div style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:10,padding:12,display:"flex",flexDirection:"column",gap:8}}>
                <div style={{display:"flex",gap:8}}>
                  {DONOR_RELATIONSHIP_LABELS.map(([v,l])=>(
                    <button key={v} aria-pressed={relType===v} onClick={()=>setRelType(v)} style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:7,padding:"5px 10px",color:T.ink3,fontSize:11,fontWeight:600,cursor:"pointer",...activeMark(relType===v,"bottom")}}>{l}</button>
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
                {relErr&&<div style={{color:T.terracotta,fontSize:12}}>{relErr}</div>}
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
                        {isReadOnly?<Pill label={DONOR_RELATIONSHIP_LABELS.find(([v])=>v===r.relationshipType)?.[1]||r.relationshipType}/>
                          :<select aria-label="Relationship" value={r.relationshipType} onChange={e=>retypeRelationship(r.id,e.target.value)} style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:7,padding:"4px 8px",fontSize:11,color:T.ink}}>
                            {DONOR_RELATIONSHIP_LABELS.map(([v,l])=><option key={v} value={v}>{l}</option>)}
                          </select>}
                        {!isReadOnly&&<button onClick={()=>unlinkDonor(r.id)} style={{background:"transparent",border:"1px solid "+T.terracotta+"55",borderRadius:7,padding:"4px 9px",color:T.terracotta,fontSize:11,cursor:"pointer"}}>Remove</button>}
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
              label={matUploading?"Uploading…":"Drop a file here, or browse: proposals, letters, research (any file type)"}
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
                      <button onClick={()=>deleteMaterial(m.id)} style={{background:"none",border:"1px solid "+T.terracotta+"30",borderRadius:7,padding:"5px 10px",color:T.terracotta,fontSize:11,cursor:"pointer"}}>Delete</button>
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
              {[["log","Activity Log"],["timeline","Stewardship Timeline"],["history","History"]].map(([m,l])=>(
                <button key={m} onClick={()=>setActMode(m)} style={{background:actMode===m?T.white:"transparent",border:"none",padding:"8px 16px",color:actMode===m?T.ink:T.ink3,fontSize:12,fontWeight:actMode===m?700:400,cursor:"pointer"}}>
                  {l}
                </button>
              ))}
            </div>
            {/* INT-BUILD-1 Part 0 — one quiet line until the viewer connects. */}
            <InboxNudge firstName={firstNameOf(donor.name)} onNavigate={onNavigate}/>

            {/* FIX-11 Part 1 — ONE sentence for a gift on the timeline, in one
                place, so the Activity Log and the Stewardship Timeline cannot
                disagree about the same gift. What Jonathan saw instead was the
                raw form ("Amount: 100,000 Designation: General Operating
                Payment Method: ACH Acknowledgement Sent: no"), twice. */}
            {actMode==="log"&&<>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:8}}>
                <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                  {["all","call","meeting","email","gift","event","stewardship","note"].map(t=>(
                    <button key={t} aria-pressed={actFilter===t} onClick={()=>setActFilter(t)} style={{background:"transparent",border:"1px solid "+T.bg3,borderRadius:7,padding:"4px 10px",color:T.ink3,fontSize:11,cursor:"pointer",fontWeight:400,textTransform:"capitalize",...activeMark(actFilter===t,"bottom")}}>
                      {t}
                    </button>
                  ))}
                </div>
                <div style={{display:"flex",gap:6}}>
                  <button onClick={()=>setStwOpen(v=>!v)} style={{background:T.bg2,border:"1px solid "+T.bg3,borderRadius:8,padding:"7px 12px",color:T.ink,fontSize:12,fontWeight:700,cursor:"pointer"}}>Log Stewardship</button>
                  <button onClick={onLogTouchpoint} style={{background:T.greenDk,border:"none",borderRadius:8,padding:"7px 12px",color:T.white,fontSize:12,fontWeight:700,cursor:"pointer"}}>+ Log Touchpoint</button>
                </div>
              </div>
              {stwOpen&&<div style={{background:T.white,border:"1px solid "+T.greenDk+"30",borderRadius:12,padding:"14px 16px"}}>
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
                  <button onClick={saveStewardship} disabled={stwSaving} style={{background:T.greenDk,border:"none",borderRadius:8,padding:"7px 14px",color:T.white,fontSize:12,fontWeight:700,cursor:"pointer"}}>Save</button>
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
                        <span style={{fontSize:11,color:T.ink3}}>{displayDate(i.date)}</span>
                        {/* BUILD-88a A.4 — a colleague is a FIRST NAME. "by Admin User"
                            is the software talking to itself. */}
                        {i.logged_by_name&&<span style={{fontSize:10,color:T.ink3,fontStyle:"italic"}}>by {firstNameOf(i.logged_by_name)}</span>}
                        <EditedMarker item={i}/>
                      </div>
                      {linkedGift&&<div style={{fontSize:12,color:T.ink,marginTop:3,fontWeight:700}}>{giftTimelineLine(linkedGift,giftFundName(linkedGift))}</div>}
                      {(()=>{const txt=linkedGift?stripGiftAmountPrefix(i.note):i.note;
                        return txt?<div style={{fontSize:12,color:T.ink,marginTop:3,lineHeight:1.5,whiteSpace:"pre-wrap"}}>{txt}</div>:null;})()}
                    </div>
                    {i.id&&!isReadOnly&&<ItemMenu label={(i.type||"entry").replace(/_/g," ")}
                      onEdit={i.gift_id||i.type==="gift"?null:()=>setEditingInt(i)} onDelete={()=>deleteInteraction(i)}/>}
                  </div>);
                })}
                {(localInts??donor.interactions??[]).filter(i=>actFilter==="all"||i.type===actFilter).length===0&&<div style={{fontSize:12,color:T.ink3,fontStyle:"italic",textAlign:"center",padding:16}}>No activity logged yet</div>}
              </div>
            </>}

            {/* FIX-14 Part 2 — everything that happened to this record, from
                the audit log, newest first, each a plain sentence. */}
            {actMode==="history"&&<HistoryList donorId={donor.id}/>}

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
                  desc:`${giftTimelineLine(g,giftFundName(g))}${m==="First gift"?" · the relationship began":""}`,
                  color:T.gold500,big:!!m});
              }
              if(firstGiftDate){
                // FIX-14 Part 1 — civil arithmetic on the date's own text, compared
                // with the org's today (this round-tripped through UTC).
                const fg=String(firstGiftDate).slice(0,10);
                const annStr=/^\d{4}-\d{2}-\d{2}$/.test(fg)?(Number(fg.slice(0,4))+1)+fg.slice(4):"";
                if(annStr&&annStr<=orgTodayCivil())milestones.push({date:annStr,icon:"✦",label:"1-year anniversary",desc:"One year as a donor",color:T.gold500,big:true});
              }
              let cumulative=0;
              sortedGiftsForTimeline.forEach(g=>{
                const prev=cumulative;cumulative+=g.amount;
                const crossed=[10000,25000,50000,100000,250000].filter(t=>prev<t&&cumulative>=t);
                crossed.forEach(t=>milestones.push({date:g.date,icon:"✦",label:`$${(t/1000)}k milestone`,desc:`Lifetime giving crossed $${(t/1000)}k`,color:T.gold500,big:true}));
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
                      return `${giftTimelineLine(g,giftFundName(g))}${t?` · ${t}`:""}`;})():(i.note||""),
                    color:{call:T.green500,meeting:T.greenMid,email:T.greenDk,gift:T.gold600,event:T.gold500,stewardship:T.green,stage_change:T.green500,planned_gift:T.gold700}[i.type]||T.ink3,
                    big:!!m,
                    loggedBy:i.logged_by_name,
                  };
                }),
                ...milestones,
              ].sort((a,b)=>new Date(b.date)-new Date(a.date));

              if(events.length===0)return<div style={{fontSize:12,color:T.ink3,fontStyle:"italic",textAlign:"center",padding:24}}>No timeline events yet. Log touchpoints and gifts to build the relationship arc.</div>;

              return(<div style={{position:"relative",paddingLeft:28}}>
                <div style={{position:"absolute",left:10,top:0,bottom:0,width:2,background:"linear-gradient(to bottom, "+T.greenDk+", "+T.gold500+"44)"}}/>
                {events.map((ev,i)=>(
                  <div key={i} style={{position:"relative",marginBottom:ev.big?20:14}}>
                    <div style={{position:"absolute",left:-28,width:ev.big?20:16,height:ev.big?20:16,borderRadius:"50%",background:ev.color,display:"flex",alignItems:"center",justifyContent:"center",fontSize:ev.big?11:9,border:`2px solid ${T.white}`,boxShadow:`0 0 0 2px ${ev.color}44`,top:0,flexShrink:0,zIndex:1}}>
                      {ev.icon}
                    </div>
                    <div style={{background:ev.big?T.gold500+"08":T.white,border:`1px solid ${ev.big?T.gold500+"40":T.bg3}`,borderRadius:10,padding:ev.big?"12px 14px":"9px 13px",marginLeft:4}}>
                      <div style={{display:"flex",alignItems:"baseline",gap:8,flexWrap:"wrap"}}>
                        <span style={{fontSize:12,fontWeight:ev.big?800:700,color:ev.color,textTransform:"capitalize"}}>{ev.label}</span>
                        <span style={{fontSize:11,color:T.ink3}}>{displayDate(ev.date)}</span>
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
        <div data-testid="dp-right-rail" style={{overflowY:"auto",padding:"24px 22px 48px",display:"flex",flexDirection:"column",background:RAIL.bg,color:RAIL.text,borderLeft:"1px solid "+RAIL.bg}}>
          {/* INT-BUILD-1 Part 3, FIX-14 Part 3 — the ONE next step (with Edit and
              Delete), then Rhythm: past touches and planned steps on one strip,
              and the journey chosen or changed in the same panel. */}
          {(()=>{
            const nextNode=<div data-testid="dp-next" style={{display:"flex",flexDirection:"column",gap:10}}>
              <div style={{fontSize:12,letterSpacing:"0.12em",textTransform:"uppercase",color:T.gold}}>Next step</div>
              {dpItems.length>0?(
                <div data-testid="dp-open-items" style={{background:T.white,border:"1px solid "+T.bg3,borderLeft:"4px solid "+(dpItems.some(x=>x.overdue)?T.gold500:T.greenDk),borderRadius:10,padding:"16px 18px",display:"flex",flexDirection:"column",gap:14}}>
                  {dpThread?.snoozedUntil&&<div style={{fontSize:11,color:T.ink3}}>Set aside until {displayDateShort(dpThread.snoozedUntil,new Date())}</div>}
                  {dpItems.map(it=>(
                    <div key={it.id} data-open-item={it.kind} style={{display:"flex",alignItems:"center",gap:16,flexWrap:"wrap"}}>
                      <div style={{flex:"1 1 240px",minWidth:0}}>
                        <div style={{fontSize:16,fontWeight:700,color:T.ink,marginBottom:4}}>{it.nextStep.label}</div>
                        {it.suggestedAsk&&<SuggestedAskLine ask={it.suggestedAsk} style={{marginBottom:4}}/>}
                        <div style={{fontSize:13,color:T.ink3,lineHeight:1.5}}>
                          {it.lastTouch?.line?<>&ldquo;{it.lastTouch.line}&rdquo;</>:it.lastTouch?.kind==="gift"&&it.lastTouch.amount!=null?<>{fmtFull(it.lastTouch.amount)} received</>:it.rank?.why||null}
                          {it.lastTouch?.date&&it.kind!=="task"?<> · {displayDateShort(it.lastTouch.date,new Date())}</>:null}
                          {it.lastTouch?.actor?<> · {firstNameOf(it.lastTouch.actor)}</>:null}
                          {" · "}{it.daysOpen>=1?`day ${it.daysOpen}`:"opened today"}
                          {" "}
                          <span style={{fontWeight:700,color:it.overdue?T.gold700:T.greenDk}}>
                            {it.overdue?"Overdue":"Due"} {displayDateShort(it.nextStep.due,new Date())}
                          </span>
                        </div>
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
                          <ThreadDismissMenu thread={it} onDone={loadDpThread}/>
                          {/* FIX-14 Part 3 — the one next step is edited and deleted here. */}
                          {it.kind==="thread"&&!isReadOnly&&<span style={{display:"inline-flex",gap:10,alignItems:"center",width:"100%"}}>
                            <EditedMarker item={it}/>
                            <button type="button" data-testid="dp-step-edit-btn" onClick={()=>setStepEdit({id:it.id,label:it.nextStep.label||"",due:String(it.nextStep.due||"").slice(0,10)})} style={{background:"none",border:"none",padding:0,color:T.ink3,fontSize:12.5,fontWeight:600,textDecoration:"underline",cursor:"pointer",fontFamily:"inherit"}}>Edit</button>
                            <button type="button" data-testid="dp-step-delete" onClick={()=>{if(window.confirm("Delete this next step? You can undo it for ten seconds."))deleteStep(it);}} style={{background:"none",border:"none",padding:0,color:T.ink3,fontSize:12.5,fontWeight:600,textDecoration:"underline",cursor:"pointer",fontFamily:"inherit"}}>Delete</button>
                          </span>}
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
                    Nothing is open for {firstNameOf(donor.name)||donor.name}. Plan a follow-up and it appears here, with the day you promised it.
                  </div>
                </div>
              )}
              {/* ENGAGE-1 — how close they are, and how much they give. Inside
                  the Next step panel: no new layout. */}
              <ScoreCard donorId={donor.id} scores={scores}/>
            </div>;
            // WHY-1 Part 7 — JOURNEY, NOT RHYTHM. The twelve-month touch
            // strip is gone from the profile (the timeline is where touch
            // history lives); this panel is the plan for the next touches.
            const rhythmNode=<div data-testid="dp-rail-journey-panel" style={{display:"flex",flexDirection:"column",gap:12}}>
              <div style={{fontSize:12,letterSpacing:"0.12em",textTransform:"uppercase",color:T.sage400}}>Journey</div>
          {/* ── THREAD-2b 5 · THEIR JOURNEY (Direction A) ──────────────
              "Step 3 of 7 · Impact report · due Jan 3" and a small
              done / today / upcoming timeline, exactly as the direction
              showed it. Brass when it is late — late is late, not dangerous,
              and red is only ever a destructive confirm. */}
          {journey&&journey.status==="active"&&(()=>{
            const steps=journey.steps||[];
            const cur=steps.find(x=>x.status==="open")||steps.find(x=>x.status==="pending");
            const doneCount=steps.filter(x=>x.status==="done"||x.status==="skipped").length;
            const pos=cur?cur.seq:steps.length;
            const late=cur&&cur.dueDate&&String(cur.dueDate).slice(0,10)<orgTodayCivil();
            return <div data-testid="dp-rail-journey">
              {/* FIX-4 2 — THE CHIP. It names the journey and it OPENS it,
                  because the next question after "which journey is she in"
                  is always "and what is in that journey" — and the answer
                  used to be four clicks away in Settings. */}
              <button data-testid="dp-journey-chip" type="button"
                onClick={()=>onNavigate&&onNavigate("journeys",{journeyId:journey.templateId||undefined})}
                title={`Open ${journey.templateName}`}
                style={{display:"inline-flex",alignItems:"center",gap:7,background:RAIL.panel,
                  border:"1px solid "+RAIL.line,borderRadius:99,padding:"5px 12px",marginBottom:9,
                  color:RAIL.text,fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit",maxWidth:"100%"}}>
                <span style={{width:6,height:6,borderRadius:"50%",background:T.greenMid,flexShrink:0}}/>
                <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{journey.templateName}</span>
                <span aria-hidden="true" style={{color:RAIL.dim}}>→</span>
              </button>
              <div style={{background:RAIL.panel,borderRadius:10,padding:"11px 12px"}}>
                <div data-testid="dp-journey-position" style={{fontSize:10.5,fontWeight:700,letterSpacing:"0.07em",textTransform:"uppercase",color:RAIL.dim}}>
                  Step {pos} of {steps.length}
                </div>
                <div style={{fontSize:14.5,fontWeight:700,color:T.white,marginTop:3}}>{cur?cur.label:"Finished"}</div>
                {cur&&cur.dueDate&&(
                  <div data-testid="dp-journey-due" style={{fontSize:12.5,fontWeight:600,marginTop:2,color:late?T.gold500:RAIL.dim}}>
                    due {new Date(cur.dueDate+"T12:00:00Z").toLocaleDateString("en-US",{month:"short",day:"numeric",timeZone:"UTC"})}
                  </div>
                )}
                {/* the progress bar: steps done or skipped, of all of them */}
                <div data-testid="dp-journey-progress" role="img" aria-label={`${doneCount} of ${steps.length} steps done`}
                  style={{height:5,borderRadius:99,background:RAIL.line,marginTop:9,overflow:"hidden"}}>
                  <div style={{width:`${steps.length?Math.round(100*doneCount/steps.length):0}%`,height:"100%",background:T.greenMid}}/>
                </div>
                {cur&&(
                  <div style={{display:"flex",gap:7,marginTop:12}}>
                    <button data-testid="dp-journey-done" disabled={journeyBusy}
                      onClick={()=>{setDoneFor(cur.id);setDoneNote("");}}
                      style={{background:T.greenDk,border:"none",borderRadius:8,padding:"8px 13px",color:T.white,fontSize:12.5,fontWeight:700,cursor:"pointer"}}>
                      Mark done
                    </button>
                    <button data-testid="dp-journey-skip" disabled={journeyBusy}
                      onClick={()=>{setSkipFor(cur.id);setSkipWhy("");}}
                      style={{background:"none",border:"1px solid "+RAIL.line,borderRadius:8,padding:"8px 13px",color:RAIL.text,fontSize:12.5,fontWeight:600,cursor:"pointer"}}>
                      Skip
                    </button>
                  </div>
                )}
              </div>
              {/* the next two steps, faded: what is coming after this one */}
              {cur&&steps.filter(x=>x.seq>cur.seq&&x.status==="pending").slice(0,2).map(x=>(
                <div key={x.id} data-testid="dp-journey-next" style={{display:"flex",justifyContent:"space-between",gap:8,padding:"6px 12px 0",opacity:0.55,fontSize:12.5,color:RAIL.text}}>
                  <span style={{minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{x.label}</span>
                  {x.dueDate&&<span style={{flexShrink:0,color:RAIL.dim}}>{new Date(x.dueDate+"T12:00:00Z").toLocaleDateString("en-US",{month:"short",day:"numeric",timeZone:"UTC"})}</span>}
                </div>
              ))}
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,marginTop:9}}>
                <div style={{fontSize:11.5,color:RAIL.dim,lineHeight:1.5}}>{journey.templateName} · started {journey.appliedOn}</div>
                {!isReadOnly&&<span style={{position:"relative",flexShrink:0}}>
                  <button type="button" data-testid="dp-journey-more" aria-haspopup="menu" aria-expanded={journeyMenu} aria-label="Journey options"
                    onClick={()=>setJourneyMenu(o=>!o)}
                    style={{background:"none",border:"1px solid "+RAIL.line,borderRadius:7,padding:"2px 9px",color:RAIL.text,fontSize:14,lineHeight:1.2,cursor:"pointer",fontFamily:"inherit"}}>…</button>
                  {journeyMenu&&<div role="menu" style={{position:"absolute",right:0,top:"calc(100% + 4px)",zIndex:30,background:T.white,border:"1px solid "+T.bg3,borderRadius:9,padding:4,minWidth:170,boxShadow:"0 10px 26px rgba(15,26,18,0.25)"}}>
                    {[["Change journey","change","dp-journey-change"],["Stop","stop","dp-journey-stop"]].map(([label,kind,tid])=>(
                      <button key={kind} role="menuitem" type="button" data-testid={tid} onClick={()=>{setJourneyMenu(false);setStopAsk(kind);}}
                        style={{display:"block",width:"100%",textAlign:"left",background:"none",border:"none",borderRadius:6,padding:"8px 10px",color:T.ink,fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>{label}</button>
                    ))}
                  </div>}
                </span>}
              </div>
              {/* Stopping asks once, here, not in a browser dialog. Change
                  journey is the same stop, then the picker. */}
              {stopAsk&&(
                <div data-testid="dp-journey-stop-ask" style={{marginTop:10,background:RAIL.bg,border:"1px solid "+RAIL.line,borderRadius:10,padding:"11px 12px"}}>
                  <div style={{fontSize:12.5,color:RAIL.text,lineHeight:1.5}}>
                    Stop {journey.templateName} for {firstNameOf(donor.name)||donor.name}? The steps already done stay on the record.
                  </div>
                  <div style={{display:"flex",gap:7,marginTop:9}}>
                    <button type="button" data-testid="dp-journey-stop-confirm" disabled={journeyBusy} onClick={async()=>{
                        setJourneyBusy(true);
                        try{await apiFetch(`/plans/${journey.id}/stop`,{method:"POST",body:JSON.stringify({})});setJourney(null);setStopAsk(null);}
                        catch(e){setAddErr(errorMessage(e,"The journey could not be stopped."));}
                        setJourneyBusy(false);}}
                      style={{background:T.greenDk,border:"none",borderRadius:8,padding:"7px 13px",color:T.white,fontSize:12.5,fontWeight:700,cursor:"pointer"}}>
                      {stopAsk==="change"?"Stop it and choose another":"Stop it"}
                    </button>
                    <button type="button" onClick={()=>setStopAsk(null)} style={{background:"none",border:"none",color:RAIL.dim,fontSize:12.5,cursor:"pointer"}}>Keep it</button>
                  </div>
                </div>
              )}

              {/* MARK DONE ASKS FOR ONE LINE. It is not paperwork: the line
                  becomes a real conversation on the record, which is what
                  makes Last contact true afterwards. */}
              {doneFor&&(
                <div style={{marginTop:10,background:RAIL.bg,border:"1px solid "+RAIL.line,borderRadius:10,padding:"11px 12px"}}>
                  <div style={{fontSize:12,color:RAIL.dim,marginBottom:7}}>What happened? One line.</div>
                  <input data-testid="dp-journey-done-note" autoFocus value={doneNote} onChange={e=>setDoneNote(e.target.value)}
                    placeholder="Called her, she was delighted."
                    style={{width:"100%",background:RAIL.panel,border:"1px solid "+RAIL.line,borderRadius:8,padding:"8px 10px",color:RAIL.text,fontSize:12.5,outline:"none"}}/>
                  <div style={{display:"flex",gap:7,marginTop:9}}>
                    <button disabled={!doneNote.trim()||journeyBusy} data-testid="dp-journey-done-save"
                      onClick={async()=>{
                        setJourneyBusy(true);
                        try{
                          const r=await apiFetch(`/plan-steps/${doneFor}/done`,{method:"POST",body:JSON.stringify({note:doneNote.trim()})});
                          setJourney(r.plan||null); setDoneFor(null); setDoneNote("");
                          if(onInteractionAdded)onInteractionAdded();
                        }catch(e){ window.alert(e?.message||"Could not save that."); }
                        setJourneyBusy(false);
                      }}
                      style={{background:doneNote.trim()?T.greenDk:RAIL.line,border:"none",borderRadius:8,padding:"7px 13px",
                              color:doneNote.trim()?T.white:RAIL.dim,fontSize:12.5,fontWeight:700,cursor:doneNote.trim()?"pointer":"not-allowed"}}>
                      Save and open the next
                    </button>
                    <button onClick={()=>setDoneFor(null)} style={{background:"none",border:"none",color:RAIL.dim,fontSize:12.5,cursor:"pointer"}}>Cancel</button>
                  </div>
                </div>
              )}

              {/* SKIP ASKS WHY IN ONE TAP. Four reasons cover almost every
                  case; "something else" is there for the rest. */}
              {skipFor&&(
                <div style={{marginTop:10,background:RAIL.bg,border:"1px solid "+RAIL.line,borderRadius:10,padding:"11px 12px"}}>
                  <div style={{fontSize:12,color:RAIL.dim,marginBottom:8}}>Why are you skipping it?</div>
                  <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                    {["Already done another way","Not right for this person","No time","They asked us not to"].map(r=>(
                      <button key={r} data-testid="dp-journey-skip-reason" disabled={journeyBusy}
                        onClick={async()=>{
                          setJourneyBusy(true);
                          try{
                            const out=await apiFetch(`/plan-steps/${skipFor}/skip`,{method:"POST",body:JSON.stringify({reason:r})});
                            setJourney(out.plan||null); setSkipFor(null);
                            if(onInteractionAdded)onInteractionAdded();
                          }catch(e){ window.alert(e?.message||"Could not skip that."); }
                          setJourneyBusy(false);
                        }}
                        style={{background:RAIL.panel,border:"1px solid "+RAIL.line,borderRadius:99,padding:"6px 11px",
                                color:RAIL.text,fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>{r}</button>
                    ))}
                  </div>
                  <input value={skipWhy} onChange={e=>setSkipWhy(e.target.value)} placeholder="Something else…"
                    style={{width:"100%",marginTop:8,background:RAIL.panel,border:"1px solid "+RAIL.line,borderRadius:8,padding:"7px 10px",color:RAIL.text,fontSize:12.5,outline:"none"}}/>
                  <div style={{display:"flex",gap:7,marginTop:8}}>
                    <button disabled={!skipWhy.trim()||journeyBusy}
                      onClick={async()=>{
                        setJourneyBusy(true);
                        try{
                          const out=await apiFetch(`/plan-steps/${skipFor}/skip`,{method:"POST",body:JSON.stringify({reason:skipWhy.trim()})});
                          setJourney(out.plan||null); setSkipFor(null); setSkipWhy("");
                          if(onInteractionAdded)onInteractionAdded();
                        }catch(e){ window.alert(e?.message||"Could not skip that."); }
                        setJourneyBusy(false);
                      }}
                      style={{background:skipWhy.trim()?T.greenDk:RAIL.line,border:"none",borderRadius:8,padding:"7px 13px",
                              color:skipWhy.trim()?T.white:RAIL.dim,fontSize:12.5,fontWeight:700,cursor:skipWhy.trim()?"pointer":"not-allowed"}}>Skip it</button>
                    <button onClick={()=>setSkipFor(null)} style={{background:"none",border:"none",color:RAIL.dim,fontSize:12.5,cursor:"pointer"}}>Cancel</button>
                  </div>
                </div>
              )}
            </div>;
          })()}

          {/* ── FIX-4 2 · ADD TO A JOURNEY ─────────────────────────────
              Offered only when they are in none, because one active plan
              per person is the model. WHY-1 Part 7: a short pitch, the
              journey Steward suggests for this person (from simple facts:
              monthly, lapsed, first year, major prospect, recently met) with
              its first three steps, the picker as the panel's one action,
              and a quiet link to every journey. */}
          {journey&&journey.status==="done"&&(()=>{
            const ends=(journey.steps||[]).map(x=>x.closedAt).filter(Boolean).sort();
            const on=ends.length?String(ends[ends.length-1]).slice(0,10):journey.appliedOn;
            return <div data-testid="dp-journey-finished" style={{fontSize:13,color:RAIL.text,lineHeight:1.5}}>
              Finished {journey.templateName} on {new Date(String(on).slice(0,10)+"T12:00:00Z").toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric",timeZone:"UTC"})}.
            </div>;
          })()}
          {!isReadOnly&&!(journey&&journey.status==="active")&&Array.isArray(journeyList)&&(
            <div data-testid="dp-rail-add-journey">
              <div data-testid="dp-journey-pitch" style={{fontSize:12.5,color:RAIL.dim,lineHeight:1.55,marginBottom:10}}>
                Plan the next few touches so this donor never drifts. Steward puts each step on your Thread the day it's due. Nothing is sent.
              </div>
              {journeySuggest&&(
                <div data-testid="dp-journey-suggest" style={{background:RAIL.panel,border:"1px solid "+RAIL.line,borderRadius:10,padding:"11px 12px",marginBottom:10}}>
                  <div style={{fontSize:10.5,fontWeight:700,letterSpacing:"0.07em",textTransform:"uppercase",color:RAIL.dim}}>Suggested</div>
                  <div style={{fontSize:14.5,fontWeight:700,color:T.white,marginTop:3}}>{journeySuggest.name}</div>
                  <div style={{fontSize:12,color:RAIL.dim,marginTop:2,lineHeight:1.45}}>{journeySuggest.why}</div>
                  <div style={{marginTop:8,display:"flex",flexDirection:"column",gap:4}}>
                    {journeySuggest.steps.map((x,i)=>(
                      <div key={i} style={{display:"flex",gap:8,fontSize:12.5,color:RAIL.text}}>
                        <span style={{flexShrink:0,minWidth:54,color:RAIL.dim}}>{x.when}</span><span>{x.label}</span>
                      </div>
                    ))}
                  </div>
                  <button type="button" data-testid="dp-journey-suggest-start" disabled={journeyBusy}
                    onClick={async()=>{
                      setJourneyBusy(true); setAddErr("");
                      try{
                        await apiFetch(`/journeys/${journeySuggest.journeyId}/apply`,{method:"POST",body:JSON.stringify({donorIds:[donor.id]})});
                        const r=await apiFetch(`/donors/${donor.id}/plan`);
                        setJourney(r.plan||null);
                        if(onInteractionAdded)onInteractionAdded();
                      }catch(e){ setAddErr(errorMessage(e,"Steward could not start that journey.")); }
                      setJourneyBusy(false);
                    }}
                    style={{marginTop:10,background:T.greenDk,border:"none",borderRadius:8,padding:"8px 13px",color:T.white,fontSize:12.5,fontWeight:700,cursor:journeyBusy?"wait":"pointer"}}>
                    {journeyBusy?"Starting…":"Start this journey"}
                  </button>
                </div>
              )}
              {journeyList.length===0?(
                <div style={{fontSize:12.5,color:RAIL.dim,lineHeight:1.55}}>
                  There are no journeys yet.{" "}
                  <button type="button" data-testid="dp-journey-setup"
                    onClick={()=>onNavigate&&onNavigate("journeys")}
                    style={{background:"none",border:"none",padding:0,color:T.white,fontWeight:700,textDecoration:"underline",cursor:"pointer",fontFamily:"inherit",fontSize:"inherit"}}>
                    Set one up
                  </button>{" "}and it takes ten minutes.
                </div>
              ):(
                <>
                  <select data-testid="dp-journey-pick" aria-label="Start a journey" value={addPick} onChange={e=>pickJourney(e.target.value)}
                    style={{width:"100%",background:T.greenDk,border:"none",borderRadius:8,appearance:"none",WebkitAppearance:"none",
                            padding:"9px 30px 9px 12px",color:T.white,fontSize:13,fontWeight:700,outline:"none",fontFamily:"inherit",cursor:"pointer",
                            backgroundImage:"linear-gradient(45deg, transparent 50%, #FFFFFF 50%), linear-gradient(135deg, #FFFFFF 50%, transparent 50%)",
                            backgroundPosition:"calc(100% - 16px) 55%, calc(100% - 11px) 55%",backgroundSize:"5px 5px, 5px 5px",backgroundRepeat:"no-repeat"}}>
                    <option value="">Start a journey</option>
                    {journeyList.map(j=><option key={j.id} value={j.id}>{j.name}</option>)}
                  </select>
                  {addPreview&&(
                    <div data-testid="dp-journey-preview"
                      style={{marginTop:9,background:RAIL.panel,border:"1px solid "+RAIL.line,borderRadius:10,padding:"11px 12px"}}>
                      <div style={{fontSize:10.5,fontWeight:700,letterSpacing:"0.07em",textTransform:"uppercase",color:RAIL.dim}}>
                        First step
                      </div>
                      <div style={{fontSize:14,fontWeight:700,color:T.white,marginTop:3}}>
                        {addPreview.firstStep?addPreview.firstStep.label:"No steps yet"}
                      </div>
                      {addPreview.firstStep&&addPreview.firstStep.dueDate&&(
                        <div data-testid="dp-journey-preview-due" style={{fontSize:12.5,fontWeight:600,color:RAIL.dim,marginTop:2}}>
                          due {new Date(addPreview.firstStep.dueDate+"T12:00:00Z").toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric",timeZone:"UTC"})}
                        </div>
                      )}
                      <div style={{fontSize:11.5,color:RAIL.dim,marginTop:7,lineHeight:1.5}}>{addPreview.touches}</div>
                      {addPreview.alreadyIn&&(
                        <div style={{fontSize:11.5,color:T.gold500,marginTop:7,lineHeight:1.5}}>
                          They are already working through &ldquo;{addPreview.alreadyIn}&rdquo;. Finish or stop that one first.
                        </div>
                      )}
                      <button data-testid="dp-journey-add-confirm" type="button"
                        disabled={journeyBusy||!addPreview.firstStep||!!addPreview.alreadyIn}
                        onClick={confirmAddToJourney}
                        style={{marginTop:10,background:(addPreview.firstStep&&!addPreview.alreadyIn)?T.greenDk:RAIL.line,
                          border:"none",borderRadius:8,padding:"8px 13px",
                          color:(addPreview.firstStep&&!addPreview.alreadyIn)?T.white:RAIL.dim,
                          fontSize:12.5,fontWeight:700,
                          cursor:(addPreview.firstStep&&!addPreview.alreadyIn&&!journeyBusy)?"pointer":"not-allowed"}}>
                        {journeyBusy?"Adding…":`Put ${firstNameOf(donor.name)} in it`}
                      </button>
                    </div>
                  )}
                  {addErr&&<div role="status" data-testid="dp-journey-add-error"
                    style={{fontSize:11.5,color:T.gold500,marginTop:8,lineHeight:1.45}}>{addErr}</div>}
                  <button type="button" data-testid="dp-journey-all" onClick={()=>onNavigate&&onNavigate("journeys")}
                    style={{marginTop:9,background:"none",border:"none",padding:0,color:RAIL.dim,fontSize:12,textDecoration:"underline",cursor:"pointer",fontFamily:"inherit"}}>
                    See all journeys or build your own
                  </button>
                </>
              )}
            </div>
          )}

            </div>;
            return rel?<RelationshipRail rel={rel} donor={donor} onReload={loadRel} nextSlot={nextNode} rhythmSlot={rhythmNode} inboxConnected={inboxConnected}/>
              :<div style={{display:"flex",flexDirection:"column",gap:30,paddingBottom:24}}>{nextNode}{rhythmNode}</div>;
          })()}

          {/* FIX-8 Part B.1 — CONTACT MOVES TO THE TOP OF THE RAIL. The
              email lived in the header's name row, competing with the name
              for the first read, while this section, which already held the
              email, the phone, the named contact and an honest empty state,
              sat below the stage picker and the quick actions. Nothing here
              is new: the section is the one that already existed, moved to
              where somebody looks when they are about to pick up the phone. */}
          <RailSection title="Contact" testid="dp-rail-contact" first>
            <dl style={{display:"grid",gridTemplateColumns:"104px 1fr",gap:"7px 10px",fontSize:12.5,margin:0}}>
              {contactPerson&&<><dt style={{color:RAIL.dim}}>Contact</dt><dd style={{margin:0,overflowWrap:"anywhere"}}>{contactPerson}</dd></>}
              {donor.email&&<><dt style={{color:RAIL.dim}}>Email</dt><dd style={{margin:0,overflowWrap:"anywhere"}}>{donor.email}</dd></>}
              {donor.phone&&<><dt style={{color:RAIL.dim}}>Phone</dt><dd style={{margin:0}}>{donor.phone}</dd></>}
              {donor.stripeSubscriptionStatus==="active"&&<><dt style={{color:RAIL.dim}}>Recurring</dt><dd style={{margin:0}}>Active {donor.stripeSubscriptionId?"subscription":"recurring gift"}</dd></>}
              {!donor.email&&!donor.phone&&!contactPerson&&<><dt style={{color:RAIL.dim}}>Nothing yet</dt><dd style={{margin:0,color:RAIL.dim}}>Add an email or a phone number with Edit, and it shows here.</dd></>}
            </dl>
          </RailSection>

          <RailSection title="Relationship owner" testid="dp-rail-owner"
            actionNode={isAdmin&&isTeam&&<button onClick={()=>setShowReassign(v=>!v)}
              style={{background:"none",border:"none",padding:0,color:RAIL.dim,fontSize:12,fontWeight:600,letterSpacing:0,textTransform:"none",cursor:"pointer",fontFamily:"inherit"}}>{showReassign?"Cancel":"Reassign"}</button>}>
            <div style={{background:RAIL.panel,borderRadius:10,padding:"10px 12px"}}>
              <div style={{display:"flex",alignItems:"center",gap:10}}>
                <div style={{width:32,height:32,borderRadius:"50%",background:RAIL.line,display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,fontWeight:800,color:RAIL.text,flexShrink:0}}>{(donor.assignedToName||"?")[0]}</div>
                {/* BUILD-88a A.4 — a colleague is a FIRST NAME here too. */}
                <div style={{flex:1,fontSize:13,fontWeight:700,color:T.white}}>{firstNameOf(donor.assignedToName)||"Unassigned"}</div>
              </div>
              {showReassign&&isAdmin&&isTeam&&<div style={{marginTop:10,display:"flex",flexDirection:"column",gap:8}}>
                <select value={reassignId} onChange={e=>setReassignId(e.target.value)} style={{width:"100%",background:RAIL.bg,border:"1px solid "+RAIL.line,borderRadius:8,padding:"8px 10px",color:RAIL.text,fontSize:12,outline:"none",cursor:"pointer"}}>
                  <option value="">Select team member…</option>
                  {orgTeam.map(u=><option key={u.id} value={u.id}>{u.name} ({u.role})</option>)}
                </select>
                <button onClick={handleReassign} disabled={reassignLoading||!reassignId} style={{background:reassignId?T.greenDk:RAIL.line,border:"none",borderRadius:8,padding:"8px",color:reassignId?T.white:RAIL.dim,fontSize:12,fontWeight:700,cursor:reassignId?"pointer":"not-allowed"}}>
                  {reassignLoading?"Saving…":"Confirm reassignment"}
                </button>
              </div>}
            </div>
          </RailSection>

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
            const inputStyle={flex:1,background:RAIL.panel,border:"1px solid "+RAIL.line,borderRadius:8,padding:"5px 8px",fontSize:12,color:RAIL.text,outline:"none"};
            return <RailSection title="Custom fields" testid="dp-rail-custom-fields" fold
              foldOpenLabel="Hide" foldShutLabel={`Show ${withValues.length||cfData.length}`}>
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {shown.map(f=>(
                <div key={f.key} style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8}}>
                  <div style={{fontSize:12,color:RAIL.dim,fontWeight:600,minWidth:90,flexShrink:0}}>{f.label}</div>
                  {cfEditing===f.key?(
                    <div style={{display:"flex",gap:6,flex:1}}>
                      {f.type==="checkbox"?(
                        <select value={cfEditVal} onChange={e=>setCfEditVal(e.target.value)} style={inputStyle}>
                          <option value="">Not set</option>
                          <option value="yes">Yes</option>
                          <option value="no">No</option>
                        </select>
                      ):f.type==="select"?(
                        <select value={cfEditVal} onChange={e=>setCfEditVal(e.target.value)} style={inputStyle}>
                          <option value="">Not set</option>
                          {(f.options||[]).map(o=><option key={o} value={o}>{o}</option>)}
                        </select>
                      ):f.type==="multi_select"?(
                        <div style={{flex:1,display:"flex",flexWrap:"wrap",gap:5,background:RAIL.panel,border:"1px solid "+RAIL.line,borderRadius:8,padding:"5px 8px"}}>
                          {(f.options||[]).map(o=>{
                            const cur=cfEditVal?cfEditVal.split("; ").filter(Boolean):[];
                            const on=cur.includes(o);
                            return <button key={o} onClick={()=>{
                              const next=on?cur.filter(x=>x!==o):[...cur,o];
                              setCfEditVal(next.join("; "));
                            }} aria-pressed={on} style={{background:on?T.greenDk:"transparent",border:"1px solid "+(on?T.greenDk:RAIL.line),borderRadius:7,padding:"2px 8px",fontSize:11,color:on?T.white:RAIL.dim,cursor:"pointer"}}>{o}</button>;
                          })}
                        </div>
                      ):f.type==="long_text"?(
                        <textarea value={cfEditVal} onChange={e=>setCfEditVal(e.target.value)} rows={3}
                          style={{...inputStyle,resize:"vertical"}} autoFocus/>
                      ):(
                        <input value={cfEditVal} onChange={e=>setCfEditVal(e.target.value)}
                          type={f.type==="date"?"date":"text"}
                          inputMode={f.type==="number"||f.type==="money"?"decimal":undefined}
                          style={inputStyle}
                          onKeyDown={e=>{
                            if(e.key==="Enter"){saveCf(f);}
                            else if(e.key==="Escape"){setCfEditing(null);setCfError("");}
                          }}
                          autoFocus
                        />
                      )}
                      <button onClick={()=>saveCf(f)} style={{background:T.greenDk,border:"none",borderRadius:8,padding:"5px 10px",color:T.white,fontSize:11,fontWeight:700,cursor:"pointer"}}>Save</button>
                      <button onClick={()=>{setCfEditing(null);setCfError("");}} style={{background:"transparent",border:"none",padding:"5px 8px",color:RAIL.dim,fontSize:12,cursor:"pointer"}}>✕</button>
                    </div>
                  ):(
                    <div style={{display:"flex",alignItems:"center",gap:6,flex:1,justifyContent:"flex-end"}}>
                      <span style={{fontSize:12,color:(f.value!==null&&f.value!==undefined&&f.value!=="")?RAIL.text:RAIL.dim,fontStyle:(f.value!==null&&f.value!==undefined&&f.value!=="")?"normal":"italic",textAlign:"right",overflowWrap:"anywhere"}}>
                        {cfSaved===f.key?"Saved ✓":(renderCustomValue(f,f.value)||"Not set")}
                      </span>
                      <button onClick={()=>{setCfEditing(f.key);setCfEditVal(editStr(f));setCfError("");}}
                        style={{background:"transparent",border:"1px solid "+RAIL.line,borderRadius:6,padding:"3px 8px",fontSize:10,color:RAIL.text,cursor:"pointer"}}>Edit</button>
                    </div>
                  )}
                </div>
              ))}
              {cfError&&<div style={{fontSize:11.5,color:T.gold300}}>{cfError}</div>}
              {hidden>0&&(
                <button onClick={()=>setCfShowAll(v=>!v)} style={{background:"none",border:"none",padding:0,fontSize:11,fontWeight:600,color:RAIL.dim,cursor:"pointer",textAlign:"left"}}>
                  {cfShowAll?"Hide empty fields":`Show all ${cfData.length} fields (${hidden} empty)`}
                </button>
              )}
            </div>
            </RailSection>;
          })()}

          {/* BUILD-99 Part 3 — the cultivation plan. It moved off the reading
              column and into the rail with the rest of how-we-manage-them, and
              it is folded because most days she does not open it. */}
          <RailSection title="Cultivation plan" testid="dp-rail-plan" fold foldOpenLabel="Hide" foldShutLabel="Show">
            <div>{lockMajor(<PlanPanel donorId={donor.id} isReadOnly={isReadOnly} canWrite={isTeam}/>,{minHeight:120})}</div>
          </RailSection>

          {donorEvents.length>0&&(
            <RailSection title="Events" testid="dp-rail-events" fold foldOpenLabel="Hide" foldShutLabel={`Show ${donorEvents.length}`}>
              <div style={{display:"flex",flexDirection:"column",gap:6}}>
                {donorEvents.slice(0,5).map(e=>{
                  // e.date may be bare YYYY-MM-DD OR a full ISO timestamp (the
                  // sample seed writes timestamps) — blindly appending T12:00:00
                  // to the latter produced "Invalid Date" on the profile card.
                  const _raw=e.date?String(e.date):"";
                  const _iso=_raw.match(/^\d{4}-\d{2}-\d{2}/);
                  const d=_iso?displayDate(_iso[0]):"";
                  return(
                    <div key={e.id} style={{background:RAIL.panel,borderRadius:8,padding:"8px 10px",display:"flex",alignItems:"center",gap:8}}>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontSize:12,fontWeight:600,color:RAIL.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{e.name}</div>
                        <div style={{fontSize:10.5,color:RAIL.dim}}>{d}</div>
                      </div>
                      <span style={{border:"1px solid "+RAIL.line,color:RAIL.dim,borderRadius:99,padding:"2px 8px",fontSize:9.5,fontWeight:700,flexShrink:0,textTransform:"capitalize"}}>{(e.attendee_status||"invited").replace("_"," ")}</span>
                    </div>
                  );
                })}
              </div>
            </RailSection>
          )}

          {/* BUILD-88a A.4 — THE WEALTH SCORE IS HIDDEN UNTIL IT CAN SAY WHAT
              IT IS (WEALTH_SCORE_DEFINITION + WEALTH_SCORE_SOURCE). Kept here,
              folded, so turning it back on is still one line. */}
          {WEALTH_SCORE_DEFINITION&&WEALTH_SCORE_SOURCE&&(
            <RailSection title="Proven capacity" testid="dp-wealth-score" fold foldOpenLabel="Hide" foldShutLabel="Show">
              <div style={{background:RAIL.panel,borderRadius:10,padding:"14px"}}>
                {localScore!==null?(
                  <>
                    <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:12}}>
                      <div style={{textAlign:"center",border:"1px solid "+RAIL.line,borderRadius:10,padding:"10px 14px",minWidth:56,flexShrink:0}}>
                        <div style={{fontSize:26,fontWeight:800,color:T.white,lineHeight:1,fontFamily:"'DM Serif Display',serif"}}>{localScore}</div>
                        <div style={{fontSize:9,color:RAIL.dim,fontWeight:600,marginTop:2}}>/ 10</div>
                      </div>
                      <div>
                        <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:5}}>
                          <span style={{border:"1px solid "+RAIL.line,color:RAIL.text,borderRadius:99,padding:"3px 10px",fontSize:11,fontWeight:800,letterSpacing:"0.04em"}}>{localTier}</span>
                        </div>
                        <div style={{fontSize:10,color:RAIL.dim,fontWeight:600}}>{localConf} confidence</div>
                      </div>
                    </div>
                    {localRationale&&<p style={{fontSize:12,color:RAIL.dim,lineHeight:1.6,margin:"0 0 12px 0",borderLeft:"2px solid "+RAIL.line,paddingLeft:10}}>{localRationale}</p>}
                    <button onClick={recalcScore} disabled={scoreLoading} style={{background:"transparent",border:"1px solid "+RAIL.line,borderRadius:8,padding:"6px",color:RAIL.text,fontSize:11,fontWeight:600,cursor:"pointer",width:"100%",textAlign:"center"}}>{scoreLoading?"Calculating…":"↻ Recalculate"}</button>
                  </>
                ):(
                  <div style={{textAlign:"center",padding:"4px 0"}}>
                    <div style={{fontSize:12,color:RAIL.dim,marginBottom:10}}>No score yet</div>
                    <button onClick={recalcScore} disabled={scoreLoading} style={{background:"transparent",border:"1px solid "+RAIL.line,borderRadius:8,padding:"7px 15px",color:RAIL.text,fontSize:12,fontWeight:600,cursor:"pointer"}}>{scoreLoading?"Calculating…":"Calculate score"}</button>
                  </div>
                )}
                <div style={{fontSize:10.5,color:RAIL.dim,marginTop:10,lineHeight:1.5}}>{WEALTH_SCORE_DEFINITION} Source: {WEALTH_SCORE_SOURCE}.</div>
              </div>
            </RailSection>
          )}

        </div>
      </div>
    </div>
  );
}
const cap=s=>s?String(s).charAt(0).toUpperCase()+String(s).slice(1):"Not set";

export { DonorProfile, EditDonorModal, FollowUpTaskModal, LogTouchpointModal };
