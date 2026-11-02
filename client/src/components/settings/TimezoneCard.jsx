import { useState, useRef, useEffect } from "react";
import { apiFetch } from "../../api";
import { errorMessage } from "../../lib/domainError";
import { T, SectionLabel } from "../shared";

// BUILD-72 Part 4 — the organization's timezone. Not a display preference:
// EVERY date boundary in the product is computed in this zone. Before it
// existed, a task due today started reading "1 day overdue" at 8pm Eastern
// because the server compared it against a UTC calendar date.
export function TimezoneCard({orgId,isAdmin,isReadOnly,focused}){
  const [tz,setTz]=useState(null);          // null = loading
  // FIX (2026-09-10) — the next-step form REFUSES a time until this is a
  // human's choice, and it links straight here. A deep link that exists to fix
  // one setting has to land on that setting, so the card scrolls itself into
  // view and rings once. (BUILD-84's timed reminder; see NEEDS-JONATHAN.md.)
  const cardRef=useRef(null);
  const [ring,setRing]=useState(false);
  useEffect(()=>{
    if(!focused||!cardRef.current)return;
    cardRef.current.scrollIntoView({behavior:"smooth",block:"center"});
    setRing(true);
    const t=setTimeout(()=>setRing(false),2400);
    return ()=>clearTimeout(t);
  },[focused]);
  const [saving,setSaving]=useState(false);
  const [err,setErr]=useState("");
  const [savedAt,setSavedAt]=useState(0);
  // FIX-27 Part 9: the zone shown before anybody chose one is Steward's
  // default, and choosing that same zone has to count as a choice.
  const [confirmed,setConfirmed]=useState(true);
  useEffect(()=>{
    apiFetch("/org").then(o=>{setTz(o.timezone||"America/New_York");setConfirmed(!!o.timezone_confirmed_at);}).catch(()=>setTz("America/New_York"));
  },[]);
  // The zones a US nonprofit actually sits in, plus the ones our tests pin.
  // Any valid IANA zone is accepted by the API; this list is the common path.
  const ZONES=[
    ["America/New_York","Eastern"],["America/Chicago","Central"],
    ["America/Denver","Mountain"],["America/Phoenix","Arizona (no DST)"],
    ["America/Los_Angeles","Pacific"],["America/Anchorage","Alaska"],
    ["Pacific/Honolulu","Hawaii"],["America/Puerto_Rico","Puerto Rico"],
  ];
  async function save(next){
    if(saving||(next===tz&&confirmed))return;
    const prev=tz; setSaving(true); setTz(next); setErr("");
    try{
      await apiFetch(`/orgs/${orgId}`,{method:"PATCH",body:JSON.stringify({timezone:next})});
      setSavedAt(Date.now()); setConfirmed(true);
    }catch(e){ setTz(prev); setErr(errorMessage(e, "Could not save the timezone.")); }
    setSaving(false);
  }
  const today=(()=>{ try{ return tz? new Intl.DateTimeFormat("en-US",{timeZone:tz,weekday:"long",month:"long",day:"numeric"}).format(new Date()):""; }catch{ return ""; } })();
  return(
    <div ref={cardRef} id="settings-timezone"
      style={{background:T.white,border:"1px solid "+(ring?T.green600:T.bg3),borderRadius:16,padding:"24px 28px",marginBottom:20,
              boxShadow:ring?`0 0 0 3px ${T.green600}33`:"none",transition:"box-shadow 0.4s, border-color 0.4s"}}>
      <SectionLabel>Time Zone</SectionLabel>
      <div style={{fontSize:13,color:T.ink3,lineHeight:1.6,marginTop:6,marginBottom:14}}>
        Every date in Steward is calculated in your organization&rsquo;s time zone, what counts as
        &ldquo;this week&rdquo;, when a task becomes overdue, when a next step you gave a <em>time</em> emails you,
        and where a gift falls in your fiscal year.
        A gift you enter on Sunday evening belongs to that Sunday.
      </div>
      <div style={{display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
        <select
          value={tz||"America/New_York"}
          disabled={!isAdmin||isReadOnly||saving||tz===null}
          onChange={e=>save(e.target.value)}
          style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"10px 12px",
                  color:T.ink,fontSize:13,fontFamily:"inherit",minWidth:260,
                  cursor:(!isAdmin||isReadOnly)?"not-allowed":"pointer"}}>
          {ZONES.map(([z,label])=><option key={z} value={z}>{label} · {z}</option>)}
          {tz&&!ZONES.some(([z])=>z===tz)&&<option value={tz}>{tz}</option>}
        </select>
        {today&&<span style={{fontSize:12,color:T.ink3}}>Today here is <strong style={{color:T.ink}}>{today}</strong></span>}
        {!confirmed&&isAdmin&&!isReadOnly&&tz&&<button type="button" data-testid="tz-confirm" disabled={saving} onClick={()=>save(tz)}
          style={{background:T.greenDk,color:T.white,border:"none",borderRadius:8,padding:"9px 14px",fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>This is right</button>}
        {savedAt>0&&<span style={{fontSize:12,color:T.green||T.greenDk}}>Saved</span>}
      </div>
      {err&&<div style={{fontSize:12,color:T.terracotta,marginTop:8}}>{err}</div>}
      {!isAdmin&&<div style={{fontSize:12,color:T.ink3,marginTop:8}}>Only an admin can change this.</div>}
      {!confirmed&&<div data-testid="tz-unconfirmed" style={{fontSize:12,color:T.ink3,marginTop:8}}>Nobody has chosen this yet; it is Steward&rsquo;s default. Sequences and timed reminders wait until somebody here does.</div>}
    </div>
  );
}
