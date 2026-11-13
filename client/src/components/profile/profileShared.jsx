// components/profile/profileShared.jsx (PROFILE-3): the small pieces several parts of
// the profile share (tabs, labels, the roles line, Coming up), moved verbatim from DonorProfile.jsx.
import { useEffect, useState } from "react";
import { apiFetch } from "../../api";
import { errorMessage } from "../../lib/domainError";
import { Pill, T, fmtFull } from "../shared";
import { civilDays } from "../../../../shared/firstThing.js";
import { orgTodayCivil } from "../../lib/orgToday";
import { countLabel, plural } from "../../../../shared/countWords.js";
import { ProfileGroups } from "../Groups";
import { statusTagItems } from "../ProfileStatus";
import { PERSON_TYPES } from "../../../../shared/personType.js";
import { censusById } from "../../../../shared/numberCensus.js";
import { PROPOSAL_STAGES } from "../../../../shared/proposalShape.js";
import { RailSection } from "../ProfileRail";
import { displayDateShort } from "../../../../shared/displayDate";
import { displayOrgDateShort } from "../../lib/orgDay";
import { shownTags, shownNote } from "../../lib/internalLabels";
import DateInput from "../inputs/LazyDateInput";   // POLISH-6: the one date box, loaded when first shown
import { relationshipTypeLabel } from "../../lib/relationshipOptions";   // FLOWS-10 item 7

// IMPORT-4 · A GIFT WITH NO DATE. An import that gave no day keeps the gift
// undated: it counts in Lifetime and its event, never in This year. "Set date"
// gives it a day in one click (the same PUT /gifts/:id as Edit).
function UndatedGiftDate({ giftId, readOnly, onSaved }) {
  const [open, setOpen] = useState(false);
  const [day, setDay] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const save = async () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) { setErr("Pick a day."); return; }
    setBusy(true); setErr("");
    try { await apiFetch(`/gifts/${giftId}`, { method: "PUT", body: JSON.stringify({ date: day }) }); setOpen(false); onSaved && onSaved(); }
    catch (e) { setErr(errorMessage(e, "That date was refused.")); }
    setBusy(false);
  };
  return (
    <span data-testid="dp-gift-undated" style={{ display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
      <span title="This gift came in with no date. It counts in Lifetime and the average, and in no figure for a span of time, because its year is not known."
        style={{ background: T.gold50, color: T.gold700, border: "1px solid " + T.gold300, borderRadius: 99, padding: "1px 8px", fontSize: 11, fontWeight: 700 }}>No date</span>
      {!readOnly && !open && <button data-testid="dp-gift-set-date" onClick={() => setOpen(true)}
        style={{ background: "none", border: "none", color: T.greenDk, fontSize: 11, fontWeight: 700, cursor: "pointer", padding: 0 }}>Set date</button>}
      {open && <>
        <DateInput value={day} onChange={e => setDay(e.target.value)} aria-label="Gift date"
          style={{ background: T.bg, border: "1px solid " + T.bg3, borderRadius: 6, padding: "3px 6px", fontSize: 12, color: T.ink }} />
        <button onClick={save} disabled={busy} style={{ background: T.greenDk, color: T.white, border: "none", borderRadius: 6, padding: "4px 8px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>{busy ? "Saving" : "Save"}</button>
        <button onClick={() => { setOpen(false); setErr(""); }} style={{ background: "none", border: "none", color: T.ink3, fontSize: 11, cursor: "pointer" }}>Cancel</button>
      </>}
      {err && <span style={{ color: T.gold700, fontSize: 11 }}>{err}</span>}
    </span>
  );
}
// SECURE-2 item 3: an imported email or phone that is not a real one is kept,
// and the rail says "Check this email" in brass, with the reason on hover.
function ContactFlag({ flags, field }) {
  const f = (flags || []).find(x => x.field === field);
  if (!f) return null;
  return <span data-testid={"contact-flag-" + field} title={f.sentence}
    style={{ display: "inline-block", marginLeft: 6, background: T.gold50, color: T.gold700, border: "1px solid " + T.gold300, borderRadius: 99, padding: "0 7px", fontSize: 10.5, fontWeight: 700 }}>{f.label}</span>;
}
// FIX-2 finding 11 — Lapsed is a stage, not a destructive confirm: on this
// profile it is drawn in brass (deep brass on a light ground), never terracotta.
const stageTone=(s,onDark)=>s&&s.id==="lapsed"?(onDark?T.gold:T.gold700):s&&s.color;
// POLISH-2: how late a step is, said one way ("2 days late"), against the org's today.
const lateWords=due=>{const n=civilDays(String(due||"").slice(0,10),orgTodayCivil());return n>0?`${countLabel(n, "day")} late`:"Due today";};

const WEALTH_SCORE_DEFINITION = null;
const WEALTH_SCORE_SOURCE = null;

// Donor-to-donor relationship types (server.js's DONOR_RELATIONSHIP_TYPES) —
// spouse/household pool into the profile's combined household total; family
// and employer_match are relationship context only. Manual linking only, no
// auto-detection in this pass.
const DONOR_RELATIONSHIP_LABELS = [
  ["spouse","Spouse"],
  ["partner","Partner"],   // PEOPLE-1: reciprocal, pools like a spouse
  ["household","Household"],
  ["family","Family"],
  ["employer_match","Employer Match"],
  // POLISH-4 — a person to an organization; one giving unit for the lapse rule.
  ["owner","Owns · Gives through"],
  ["works_at","Works at"],
];
// MENU-1 — the type list as THIS record reads it, so the picker says "Gives
// through" on a person and "Owned by" on a business. The stored type is the
// same either way (owner, works_at; the server stores the person first).
const isOrgRecord = d => !!d && (["organisation", "organization"].includes(String(d.kind || "").toLowerCase())
  || (Array.isArray(d.person_types) && d.person_types.includes("organization")));
const SIDED_TYPE_LABELS = {
  person: { owner: "Gives through (a business they own)", works_at: "Works at (an organization)" },
  organization: { owner: "Owned by (a person)", works_at: "Employs (a person)" },
};
const relationshipLabelsFor = donor => {
  const side = SIDED_TYPE_LABELS[isOrgRecord(donor) ? "organization" : "person"];
  return DONOR_RELATIONSHIP_LABELS.map(([v, l]) => [v, side[v] || l]);
};
// POLISH-4 — a link as this record reads it. A person-to-organization link
// reads from its own side: "Gives through Corman Excavating" on the person,
// "Owner: Pat Corman" on the business.
const SIDED = {
  owner: { person: n => `Gives through ${n}`, organization: n => `Owner: ${n}` },
  works_at: { person: n => `Works at ${n}`, organization: n => `Works here: ${n}` },
};
// TRUTH-5 (W-1109-Finance-37X): a person-to-organization link reads what went
// THROUGH it (soft credit on the organization's gifts), never anyone's lifetime.
const throughWords = r => (r.throughCents > 0 ? `${fmtFull(r.throughCents / 100)} given through ${r.side === "organization" ? "here" : "it"}` : "nothing soft-credited through it yet");
// CONNECT-1 — how a person came in, read from this record's end of the link
// (the server stores the newcomer first and says `direction`). In the picker
// each type is offered from both ends; a pick is the type plus this record's end.
const CONNECT_PICKS = [
  ["introduced_by", "Introduced by…", "introduced_by", "newcomer"],
  ["introduced", "Introduced…", "introduced_by", "connector"],
  ["guest_of", "Guest of…", "guest_of", "newcomer"],
  ["brought_guest", "Brought as a guest…", "guest_of", "connector"],
];
const connectPick = v => { const p = CONNECT_PICKS.find(([k]) => k === v); return p ? { relationshipType: p[2], side: p[3] } : null; };
const CONNECT_LINE = {
  introduced_by: { newcomer: r => `Introduced by ${r.relatedDonorName}`, connector: r => `Introduced ${r.relatedDonorName}` },
  guest_of: { newcomer: r => `Guest of ${r.relatedDonorName}${r.eventName ? ` at ${r.eventName}` : ""}`,
    connector: r => `Brought ${r.relatedDonorName} as a guest${r.eventName ? ` to ${r.eventName}` : ""}` },
};
const relationshipLine = r => {
  const how = CONNECT_LINE[r.relationshipType] && CONNECT_LINE[r.relationshipType][r.direction];
  if (how) return how(r);
  const sided = SIDED[r.relationshipType] && SIDED[r.relationshipType][r.side];
  if (sided) return sided(r.relatedDonorName);
  return `${r.relatedDonorName} · ${relationshipTypeLabel(DONOR_RELATIONSHIP_LABELS, r.relationshipType)}`;   // FLOWS-10 item 7: "Program officer", never "program_officer"
};

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
  // FUNDRAISING-2: a gift for an event says the event, ahead of its fund.
  if (g.event_name) parts.push(g.event_name);
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

// ── FIX-1 D — what this person IS, as a row of chips under the name ────────
// One person, one record, even when they are two things (BUILD-94 Part 2).
// Each chip is ONE write through PUT /people/:id/roles. A role that is on is a
// STATE (cream, emerald hairline) — never a second action colour. Adding
// Volunteer puts them on the Volunteers roster that moment, on this record.
//
// DONOR IS SET BY GIVING. While gifts are on file the Donor chip cannot come
// off, and it says why — the SERVER's sentence (GET /people/:id), and the
// server refuses the removal too, so the chip and the rule cannot disagree.
// POLISH-3 · TAGS AND GROUPS ON ONE LINE. The giving level, lifecycle and
// Retained (each opening its donors), the record's own tags, then the groups,
// as one row of chips; past the first few the rest fold into "+3", which opens
// them in place. "+ Group" stays at the end of the line.
const HEADER_CHIP_LIMIT=4;
function HeaderChips({status,donor,isReadOnly}){
  const [all,setAll]=useState(false);
  const narrow=typeof window!=="undefined"&&window.innerWidth<600;
  const limit=narrow?3:HEADER_CHIP_LIMIT;
  return <ProfileGroups donorId={donor.id} isReadOnly={isReadOnly}>{(groupChips,addCtl)=>{
    const st=statusTagItems(status).map(el=>({kind:"status",el}));
    const rec=shownTags(donor.tags).map(t=>({kind:"record",el:<Pill key={"t:"+t} label={t}/>}));
    const items=[...st,...rec,...groupChips.map(el=>({kind:"group",el}))];
    const shown=all?items:items.slice(0,limit);
    const more=items.length-shown.length;
    const of=k=>shown.filter(x=>x.kind===k).map(x=>x.el);
    if(!items.length&&!addCtl)return null;
    return (
      <div data-testid="dp-header-tags" style={{display:"flex",alignItems:"center",gap:6,flexWrap:all||narrow?"wrap":"nowrap",marginTop:6,minWidth:0}}>
        {of("status").length>0&&<span data-testid="dp-status-tags" style={{display:"contents"}}>{of("status")}</span>}
        {of("record").length>0&&<span data-testid="dp-record-tags" style={{display:"contents"}}>{of("record")}</span>}
        {of("group")}
        {more>0&&<button type="button" data-testid="dp-tags-more" onClick={()=>setAll(true)} aria-label={`Show ${countLabel(more, "more tag")} and ${plural(more, "group")}`}
          style={{fontSize:11.5,fontWeight:700,padding:"2px 9px",borderRadius:99,border:"1px solid "+T.bg3,background:T.white,color:T.ink2,cursor:"pointer",fontFamily:"inherit",whiteSpace:"nowrap"}}>+{more}</button>}
        {all&&items.length>limit&&<button type="button" data-testid="dp-tags-fewer" onClick={()=>setAll(false)}
          style={{fontSize:11.5,fontWeight:600,padding:0,border:"none",background:"none",color:T.ink3,cursor:"pointer",textDecoration:"underline",fontFamily:"inherit"}}>Fewer</button>}
        {addCtl}
      </div>
    );
  }}</ProfileGroups>;
}
const ROLE_CHIPS=PERSON_TYPES.filter(t=>t.key!=="other");
function RoleLine({donor,isReadOnly,birthday="",noGifts=false}){
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
      else if(Number(r.gift_count)>0)setFirstGiftYear("unknown");   // IMPORT-4: every gift on file is undated
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
  // PROFILE-3: somebody with no gift is not called a Donor on their own record.
  const roleWords=have.filter(c=>!(noGifts&&c.key==="donor")).map(c=>
    c.key==="donor"&&sinceYear?(sinceYear==="unknown"?"Donor since: unknown":`Donor since ${sinceYear}`):c.label).join(" · ");
  return (
    <div data-testid="role-line" style={{display:"flex",alignItems:"center",gap:7,flexWrap:"wrap",marginTop:5,position:"relative"}}>
      {roleWords&&<span style={{fontSize:12.5,color:T.ink3,lineHeight:1.4}}>{roleWords}</span>}
      {/* PROFILE-1 (header): the birthday is on the same line as "Donor since". */}
      {birthday&&<span data-testid="dp-header-birthday" style={{fontSize:12.5,color:T.ink3,lineHeight:1.4}}>{roleWords?"· ":""}Birthday {birthday}</span>}
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
const OPEN_PROPOSAL_KEYS = PROPOSAL_STAGES.filter(s => s.kind === "open").map(s => s.key);

// PROFILE-1 (header) — THE TAB ROW. One row under the header replaces the old
// six tabs AND the "Everything with" chips: Conversations, Emails, Tasks,
// Notes and Files are the old chips' filtered timelines. Materials folded into
// Files; the old Activity tab's log is the timeline itself (Lately and the
// kind tabs), and its History moved to Files.
// PROFILE-2: seven tabs that never wrap. Giving holds gifts and pledges, the
// ask, Funds and Asks & pipeline; Related is the rail's Household and related.
const PROFILE_TABS = [
  ["activity", "Activity"], ["giving", "Giving"], ["conversations", "Conversations"], ["emails", "Emails"],
  ["tasks", "Tasks"], ["notes", "Notes"], ["files", "Files"],
];
// Which timeline kind each list tab shows, and the other kinds it offers.
const TAB_KIND = { conversations: "conversation", emails: "email", tasks: "task", notes: "note", files: "file" };
const TAB_SUBCHIPS = { conversations: ["conversation", "stage", "activity", "service"] };
// The stage bar on the ask card, in the order a relationship moves.
const STAGE_BAR = ["prospect", "qualify", "cultivate", "solicit", "steward", "lapsed"];


// PROFILE-2 · the rail's Groups: the groups this person is in, as small
// chips, with Add to a group. Hidden when there are none and nothing to add.
function RailGroups({donorId,isReadOnly}){
  return <ProfileGroups donorId={donorId} isReadOnly={isReadOnly}>{(groupChips,addCtl)=>{
    // PROFILE-3: the section is drawn when they are in a group; "Add to a group" is in About until then.
    if(!groupChips.length)return null;
    return <RailSection title="Groups" testid="dp-rail-groups">
      <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}>{groupChips}{addCtl}</div>
    </RailSection>;
  }}</ProfileGroups>;
}

// PROFILE-2 · COMING UP, in the main column: the open tasks (each with Mark
// done) and the meetings ahead. Hidden when there is nothing.
function ComingUpMain({tasks=[],meetings=[],onTaskToggle,isReadOnly,onAddTask}){
  const open=(tasks||[]).filter(t=>!(Number(t.done)===1||t.done===true)).sort((a,b)=>String(a.due||"9999").localeCompare(String(b.due||"9999")));
  const ahead=(meetings||[]).slice(0,3);
  if(!open.length&&!ahead.length)return null;
  const today=orgTodayCivil();
  return <section data-testid="dp-coming-up" style={{display:"flex",flexDirection:"column",gap:8}}>
    <h2 style={{margin:0,fontSize:11,fontWeight:700,color:T.ink3}}>Coming up</h2>
    {ahead.map(m=><div key={"m:"+m.id} data-testid="dp-coming-meeting" style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:12,padding:"12px 16px",display:"flex",justifyContent:"space-between",gap:12,alignItems:"center"}}>
      <span style={{fontSize:14,fontWeight:600,color:T.ink}}>{m.title||"Meeting"}</span>
      <span style={{fontSize:13,color:T.ink3,whiteSpace:"nowrap"}}>{displayOrgDateShort(m.date||m.startsAt||"",today)}</span>
    </div>)}
    {open.slice(0,5).map(t=><div key={"t:"+t.id} data-testid="dp-coming-task" style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:12,padding:"10px 16px",display:"flex",justifyContent:"space-between",gap:12,alignItems:"center"}}>
      <span style={{minWidth:0}}><span style={{fontSize:14,fontWeight:600,color:T.ink}}>{t.title||t.text||"A task"}</span>
        {t.due&&<span style={{fontSize:13,color:String(t.due).slice(0,10)<today?T.gold700:T.ink3,marginLeft:8}}>{String(t.due).slice(0,10)<today?"Overdue, ":"Due "}{displayDateShort(String(t.due).slice(0,10),today)}</span>}</span>
      {!isReadOnly&&onTaskToggle&&<button type="button" data-testid="dp-task-done" onClick={()=>onTaskToggle(t)} style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:8,padding:"7px 12px",fontSize:12.5,fontWeight:700,color:T.ink,cursor:"pointer",whiteSpace:"nowrap",minHeight:36}}>Mark done</button>}
    </div>)}
  </section>;
}
const cap=s=>s?String(s).charAt(0).toUpperCase()+String(s).slice(1):"Not set";

export { UndatedGiftDate, ContactFlag, stageTone, lateWords, WEALTH_SCORE_DEFINITION, WEALTH_SCORE_SOURCE, DONOR_RELATIONSHIP_LABELS, relationshipLabelsFor, relationshipLine, CONNECT_PICKS, connectPick, throughWords, stripGiftAmountPrefix, giftFundName, giftTimelineLine, HEADER_CHIP_LIMIT, HeaderChips, ROLE_CHIPS, RoleLine, PROFILE_FIGURES, SUGGEST_KINDS, PROPOSAL_STAGE_LABEL, OPEN_PROPOSAL_KEYS, PROFILE_TABS, TAB_KIND, TAB_SUBCHIPS, STAGE_BAR, RailGroups, ComingUpMain, cap };
