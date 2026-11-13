// components/profile/modals.jsx (PROFILE-3): the profile's older dialogs, moved verbatim
// from DonorProfile.jsx (Log a touchpoint, Edit, the follow-up task, the gift link).
import { useEffect, useState } from "react";
import { orgTodayCivil, orgTodayPlus } from "../../lib/orgToday";
import { greetingLine } from "../../../../shared/greeting.js";
import { Modal, SC, STAGES, Spin, T, TpField, TpYesNo, activeMark } from "../shared";
import { apiFetch } from "../../api";
import { errorMessage } from "../../lib/domainError";
import { AttachFileField, uploadAttachment } from "../ProfileTimelineParts";
import { MONTHS as BIRTH_MONTHS } from "../../../../shared/birthday.js";
import { stageTone } from "./profileShared";
import { nextYearlyOn, recurPhrase } from "../../../../shared/taskShape.js";
import DateInput from "../inputs/LazyDateInput";   // POLISH-6: the one date box, loaded when first shown

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
  // DATES-1 · a repeat, and on a person with a birthday, the shortcut that
  // sets the day to their next birthday and keeps it there every year.
  const[recur,setRecur]=useState(null);
  const bd=donor.birthday&&donor.birthday.month&&donor.birthday.day?donor.birthday:null;
  const pickRecur=v=>{
    if(v==="birthday"&&bd){setRecur({every:"year",month:bd.month,day:bd.day,birthday:true});setDue(nextYearlyOn(bd.month,bd.day,orgTodayCivil()));return;}
    setRecur(v?JSON.parse(v):null);
  };
  const inp={width:"100%",background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"10px 12px",color:T.ink,fontSize:13,outline:"none",fontFamily:"inherit",boxSizing:"border-box"};
  const save=async()=>{
    if(!title.trim())return;setLoading(true);
    try{
      const raw=await apiFetch("/tasks",{method:"POST",body:JSON.stringify({title,due,priority,type:"donor",donorId:donor.id,recur})});
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
            <div style={{fontSize:11,fontWeight:700,color:T.ink3,marginBottom:5}}>Task Title</div>
            <input value={title} onChange={e=>setTitle(e.target.value)} placeholder="What happens next? e.g. Send the impact report" style={inp}/>
          </div>
          <div>
            <div style={{fontSize:11,fontWeight:700,color:T.ink3,marginBottom:5}}>Due Date</div>
            <DateInput value={due} onChange={e=>{setDue(e.target.value);if(recur&&recur.birthday)setRecur({every:"year"});}} style={inp}/>
          </div>
          <div>
            <div style={{fontSize:11,fontWeight:700,color:T.ink3,marginBottom:5}}>Repeats</div>
            <select data-testid="followup-repeats" value={recur?(recur.birthday?"birthday":JSON.stringify({every:recur.every})):""} onChange={e=>pickRecur(e.target.value)} style={inp}>
              <option value="">Does not repeat</option>
              <option value={JSON.stringify({every:"week"})}>Every week</option>
              <option value={JSON.stringify({every:"month"})}>Every month, same day</option>
              <option value={JSON.stringify({every:"quarter"})}>Every quarter</option>
              <option value={JSON.stringify({every:"year"})}>Every year, same date</option>
              {bd&&<option value="birthday">Every year, on their birthday</option>}
            </select>
            {recur&&recur.birthday&&<div data-testid="followup-birthday-note" style={{fontSize:12,color:T.ink3,marginTop:5}}>{recurPhrase(recur)}. The first one is due on their next birthday.</div>}
          </div>
          <div>
            <div style={{fontSize:11,fontWeight:700,color:T.ink3,marginBottom:8}}>Priority</div>
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
    apiFetch("/events").then(evts=>setOrgEvents(Array.isArray(evts)?evts.filter(e=>!e.archived_at).slice(0,20):[])).catch(()=>{});
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
        <div style={{marginBottom:16}}><span style={{fontSize:11,fontWeight:700,color:T.ink3,marginBottom:5,display:"block"}}>Date</span><DateInput value={date} onChange={e=>setDate(e.target.value)} disabled={fromCalendar} style={inp}/>
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
        {!editing&&type!=="gift"&&<AttachFileField file={file} setFile={setFile} labelStyle={{fontSize:11,fontWeight:700,color:T.ink3,marginBottom:5,display:"block"}}/>}
        <div style={{display:"flex",gap:8}}>
          {type!=="gift"&&<button onClick={save} disabled={loading||!canSave} style={{flex:1,background:canSave?T.greenDk:T.bg2,border:"none",borderRadius:10,padding:"12px",color:T.white,fontSize:14,fontWeight:700,cursor:canSave?"pointer":"not-allowed"}}>{loading?"Saving…":editing?"Save changes":"Save Touchpoint"}</button>}
          <button onClick={onClose} style={{flex:type==="gift"?1:undefined,background:T.bg,border:"none",borderRadius:10,padding:"12px 16px",color:T.ink3,fontSize:13,cursor:"pointer"}}>Cancel</button>
        </div>
      </div>
    </Modal>
  );
}

// ── Edit Donor Modal ───────────────────────────────────────────────────────
// ADDRESS-1: a field's label is a real <label> above it, never only a placeholder.
function EditField({label,children,style}){
  return <label style={{display:"flex",flexDirection:"column",gap:5,minWidth:0,...style}}>
    <span style={{fontSize:11,fontWeight:700,color:T.ink3}}>{label}</span>{children}</label>;
}
function EditDonorModal({donor,onSave,onClose}){
  const inp={width:"100%",background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"9px 12px",color:T.ink,fontSize:13,outline:"none",fontFamily:"inherit",boxSizing:"border-box"};
  const[form,setForm]=useState({
    name:donor.name||"",email:donor.email||"",phone:donor.phone||"",
    notes:donor.notes||"",tags:(donor.tags||[]).join(", "),
    stage:donor.stage||"cultivate",status:donor.status||"new",
    address:donor.address||"",address2:donor.address2||"",
    city:donor.city||"",state:donor.state||"",zip:donor.zip||"",
    employer:donor.employer||"",
    bMonth:donor.birthday?String(donor.birthday.month):"",bDay:donor.birthday?String(donor.birthday.day):"",bYear:donor.birthday&&donor.birthday.year?String(donor.birthday.year):"",
  });
  const[loading,setLoading]=useState(false);
  const[err,setErr]=useState("");
  const set=k=>e=>setForm(p=>({...p,[k]:e.target.value}));

  // FIX-56: Save waits for the full record (Donors.jsx opens this again when it lands).
  const ready=!!donor.fullRecord;
  const save=async()=>{
    if(!ready)return;
    if(!form.name.trim()){setErr("Name is required");return;}
    setLoading(true);setErr("");
    try{
      const tags=form.tags.split(",").map(t=>t.trim()).filter(Boolean);
      if((form.bMonth&&!form.bDay)||(!form.bMonth&&form.bDay)||(form.bYear&&!form.bMonth)){setErr("A birthday needs both a month and a day. The year is optional.");setLoading(false);return;}
      const{bMonth,bDay,bYear,...rest}=form;
      const birthday=bMonth&&bDay?{month:Number(bMonth),day:Number(bDay),year:bYear?Number(bYear):null}:null;
      const res=await apiFetch(`/donors/${donor.id}`,{method:"PUT",body:JSON.stringify({...rest,tags,birthday})});
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
        {!ready?<div data-testid="edit-donor-loading" style={{display:"flex",alignItems:"center",gap:10,fontSize:13,color:T.ink3,padding:"8px 0 4px"}}><Spin/>Loading their record…</div>:
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          {/* ADDRESS-1: every field has a visible label, and the street and
              apartment lines sit above City (donors.address, donors.address2). */}
          {[["name","Full name","text"],["email","Email","email"],["phone","Phone","tel"],["employer","Employer","text"]].map(([k,lb,t])=>(
            <EditField key={k} label={lb}><input type={t} autoComplete="off" value={form[k]} onChange={set(k)} style={inp} data-testid={"edit-"+k}/></EditField>
          ))}
          <EditField label="Street address"><input autoComplete="off" value={form.address} onChange={set("address")} style={inp} data-testid="edit-address"/></EditField>
          <EditField label="Apt, suite (optional)"><input autoComplete="off" value={form.address2} onChange={set("address2")} style={inp} data-testid="edit-address2"/></EditField>
          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
            <EditField label="City" style={{flex:"2 1 150px"}}><input autoComplete="off" value={form.city} onChange={set("city")} style={inp} data-testid="edit-city"/></EditField>
            <EditField label="State" style={{flex:"1 1 70px"}}><input autoComplete="off" value={form.state} onChange={set("state")} style={inp} data-testid="edit-state"/></EditField>
            <EditField label="ZIP" style={{flex:"1 1 80px"}}><input autoComplete="off" inputMode="numeric" value={form.zip} onChange={set("zip")} style={inp} data-testid="edit-zip"/></EditField>
          </div>
          {/* PARITY-3 6a — month and day; the year is optional. */}
          <div>
            <div style={{fontSize:11,fontWeight:700,color:T.ink3,marginBottom:8}}>Birthday</div>
            <div style={{display:"flex",gap:8}}>
              <select aria-label="Birthday month" data-testid="edit-birth-month" value={form.bMonth} onChange={set("bMonth")} style={{...inp,flex:2}}>
                <option value="">Month</option>
                {BIRTH_MONTHS.map((m,i)=><option key={m} value={String(i+1)}>{m}</option>)}
              </select>
              <input aria-label="Birthday day" data-testid="edit-birth-day" inputMode="numeric" value={form.bDay} onChange={set("bDay")} placeholder="Day" style={{...inp,flex:1}}/>
              <input aria-label="Birth year (optional)" inputMode="numeric" value={form.bYear} onChange={set("bYear")} placeholder="Year (optional)" style={{...inp,flex:1.4}}/>
            </div>
          </div>
          <div>
            <div style={{fontSize:11,fontWeight:700,color:T.ink3,marginBottom:8}}>Stage</div>
            <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
              {STAGES.map(s=>(
                <button key={s.id} onClick={()=>setForm(p=>({...p,stage:s.id}))}
                  style={{background:form.stage===s.id?stageTone(s)+"22":T.bg,border:`1px solid ${form.stage===s.id?stageTone(s):T.bg3}`,borderRadius:7,padding:"5px 11px",color:form.stage===s.id?stageTone(s):T.ink3,fontSize:12,fontWeight:600,cursor:"pointer"}}>
                  {s.label}
                </button>
              ))}
            </div>
          </div>
          <EditField label={<>Tags <span style={{fontSize:10,fontWeight:400}}>(comma-separated)</span></>}>
            <input value={form.tags} onChange={set("tags")} placeholder="e.g. board-adjacent, recurring, arts" style={inp}/>
          </EditField>
          <EditField label="Notes">
            <textarea value={form.notes} onChange={set("notes")} rows={3} style={{...inp,resize:"vertical",lineHeight:1.5}}/>
          </EditField>
          {err&&<div style={{color:T.terracotta,fontSize:12}}>{err}</div>}
          <div style={{display:"flex",gap:8,marginTop:4}}>
            <button onClick={save} disabled={loading||!ready} style={{flex:1,background:loading||!ready?T.bg2:T.greenDk,border:"none",borderRadius:10,padding:"11px",color:T.white,fontSize:14,fontWeight:700,cursor:loading||!ready?"not-allowed":"pointer"}}>
              {loading?"Saving…":!ready?"Loading their record…":"Save Changes"}
            </button>
            <button onClick={onClose} style={{background:T.bg,border:"none",borderRadius:10,padding:"11px 14px",color:T.ink3,fontSize:13,cursor:"pointer"}}>Cancel</button>
          </div>
        </div>}
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
    `<p>${greetingLine(donor,{word:"Hi"})}</p>\n<p>Thank you so much for your continued support of ${orgName}. Your generosity makes our work possible.</p>\n<p>If you'd like to make a gift online, we've made it simple:</p>\n<p><a href="PAYMENT_LINK">Give now →</a></p>\n<p>It only takes a moment, and every gift goes directly to our programs. Thank you for everything you do for our mission.</p>\n<p>With gratitude,<br>The ${orgName} Team</p>`
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
      ariaLabel="Send a payment link" dialogStyle={{border:"1px solid "+T.bg3}}>
      <div>
        {!showEmail?(
          <>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
              <div>
                <div style={{fontSize:16,fontWeight:800,color:T.ink}}>Send a payment link</div>
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
                    <div style={{fontSize:11,fontWeight:700,color:T.ink3,marginBottom:5}}>Subject</div>
                    <input value={emailSubject} onChange={e=>setEmailSubject(e.target.value)} style={inp}/>
                  </div>
                  <div>
                    <div style={{fontSize:11,fontWeight:700,color:T.ink3,marginBottom:5}}>Message</div>
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

export { FollowUpTaskModal, LogTouchpointModal, EditDonorModal, GiftLinkModal };
