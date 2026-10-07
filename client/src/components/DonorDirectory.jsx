// DonorDirectory.jsx — the list: the directory, re-engage, the team view and the filter bar.
//
// FIX-1 split: moved VERBATIM out of Donors.jsx. Nothing in it changed.
// Tests read it through readSource("client/src/components/Donors.jsx").
import { useState, useEffect } from "react";
import { EXPLANATION as ENGAGEMENT_EXPLANATION, bandFor } from "../../../shared/engagementWeights.js";
import { apiFetch, API, getToken } from "../api";
import { errorMessage } from "../lib/domainError";
import { censusById } from "../../../shared/numberCensus.js";
import { T, activeMark, fmtFull, daysDiff, askClaude, STAGES, donorScore, AIBtn, AIPanel, EmptyState, DriftBadge, Modal, PersonMark } from "./shared";
import { PlanFollowUpModal } from "./PlanFollowUp";
import { AddToGroup, SaveAsGroup } from "./Groups";
import { DonorLink } from "./RecordLink";
import { donorHref, rowClick } from "../lib/appUrls";
import { PLAN_UNKNOWN, planLocks } from "../lib/entitlement";
import { DESIGNATION_OPTS, PATTERN_META, TIER_META } from "./donorShared";
import { useCanMajorGifts, ROOM_LABEL } from "../lib/majorGifts";
import { ScreeningFileModal, ScreeningImportModal } from "./RoomToGive";
import { offerUndo } from "./EditHistory";

// FIX-2 C — a stage is a word on a cream chip, not a green badge: emerald is
// the one action on the screen. Lapsed alone keeps a colour, and it is brass.
const stageChip=s=>s&&s.id==="lapsed"?{background:T.gold100,color:T.gold700}:{background:T.bg2,color:T.ink};
// ── BUILD-88a A.4 — A NUMBER NOBODY CAN DEFINE IS NOT SHOWN ───────────────
// The wealth score rendered a figure out of 10, a capacity tier and a
// confidence word, with nothing on the screen saying how any of them is arrived
// at or what they were computed from. BUILD-86 C.3's rule — "a number a board
// cannot define is a number it should not be shown" — applies to the officer's
// own screen too, and harder: this is the number they use to decide how much to
// ask a person for. Both of these must carry a real string before the panel
// renders again: the DEFINITION (what the number means, in a sentence a
// fundraiser would accept) and the SOURCE (where its inputs come from, named).
// The panel's code is intact; turning it back on is these two lines.
// ── BUILD-100 — THE SCORE SAYS WHAT IT IS ─────────────────────────────────
// It was labelled "Score / 99" and read, reasonably, as a wealth or capacity
// figure. It is neither. Every input is the org's OWN giving history — amount,
// recency, frequency — so a retired teacher giving $50 a month for ten years
// outscores a millionaire who gave once, which is correct and is the opposite
// of what "score" implies next to a person's name.
//
// "Giving strength" is what it actually measures, and the definition travels
// with it on the same hover convention the dashboards use (BUILD-86 C.3: a
// number nobody can define is a number nobody should be shown).
//
// 99 is a CLAMP, not a denominator. The components top out at 100 and are
// clamped to 5..99; it is not a percentage and it is not normalised against
// anybody else, so two orgs' 77s are not comparable.
// BUILD-97 Part 2 — the label and the sentence come from the CENSUS, which is
// the one place a number on screen is allowed to be defined. They were two
// local constants here and the column headers used a THIRD spelling (a bare
// string literal), so the definition BUILD-100 wrote reached exactly one tile
// — the one this build then took off the screen.
const GIVING_STRENGTH_LABEL = "Giving strength";
const ROOM_HEAD = "Room to give";   // PROSPECT-1
// ENGAGE-1 — the stored engagement score and its band.
const ENGAGEMENT_LABEL = "Engagement";
// FIX-10 F — THE SOURCE STRING WAS ALREADY RIGHT; THE CSS WAS SHOUTING IT.
// The walk read "GIVING STRENGTH?" off this screen and a grep for it found
// nothing, because `textTransform:"uppercase"` on the header cell is what
// turned "Giving strength" into a shout (the same trap BUILD-82 hit: innerText
// applies text-transform). Both header rows read in sentence case now, so the
// column heading on the screen is the words in the code.
// The trailing "?" is `ColDef`, the control that opens the number's definition,
// and it stays: every number has a sentence.
const HEAD = { fontSize: 10.5, fontWeight: 800, letterSpacing: ".01em" };
const GIVING_STRENGTH_DEF = censusById("list.givingStrength").sentence;

// The keyboard-reachable definition mark, used by every column header that
// carries a number somebody could misread. Same affordance BUILD-100 built for
// the profile tile: a tooltip nobody can tab to is a definition that does not
// exist for half the people who need it.
function ColDef({ text, testid, dark }) {
  return (
    <span tabIndex={0} title={text} aria-label={text} data-testid={testid}
      style={{ marginLeft: 5, fontSize: 9, fontWeight: 700,
               color: dark ? "rgba(240,237,230,0.7)" : T.ink3,
               border: `1px solid ${dark ? "rgba(240,237,230,0.35)" : T.bg3}`,
               borderRadius: 99, width: 13, height: 13, display: "inline-flex",
               alignItems: "center", justifyContent: "center", cursor: "help",
               verticalAlign: "middle" }}>?</span>
  );
}

// ── Re-engage View ─────────────────────────────────────────────────────────
function ReEngageView({donors,org,onLogTouchpoint,onSelectDonor}){
  // BUILD-77 Part 1f — a re-engage list is an ASK surface: the no-ask family
  // (deceased / do-not-contact / do-not-solicit) never appears here, and an
  // unlinked imported sustainer belongs to the recurring reconnect list —
  // their card stopped, they did not choose to leave.
  const askable=d=>!d.deceased&&!d.doNotContact&&!d.doNotSolicit&&!d.importedSustainer;
  const lapsed=[...donors].filter(d=>askable(d)&&(d.stage==="lapsed"||(d.lastGift&&daysDiff(d.lastGift)>365))).sort((a,b)=>b.total-a.total);
  const totalValue=lapsed.reduce((s,d)=>s+d.total,0);
  // BUILD-79 Part 4 — averaged over donors with a REAL date only; a donor
  // with no dates contributes nothing rather than a today-anchored zero.
  const lapsedDated=lapsed.filter(d=>d.lastGift||d.lastTouchpoint);
  const avgDays=lapsedDated.length
    ?Math.round(lapsedDated.reduce((s,d)=>s+daysDiff(d.lastGift||d.lastTouchpoint),0)/lapsedDated.length)
    :0;
  const[aiText,setAiText]=useState("");
  const[aiLoading,setAiLoading]=useState(false);

  const getStrategy=async()=>{
    setAiLoading(true);setAiText("");
    await askClaude(
      `You are a nonprofit major gifts officer. Be specific and tactical. Max 250 words.`,
      `Re-engagement strategy for ${org?.name||"this organization"}.\n\nLapsed donors: ${lapsed.length} total, ${fmtFull(totalValue)} combined lifetime value, avg ${avgDays} days lapsed.\n\nTop lapsed donors:\n${lapsed.slice(0,8).map(d=>`- ${d.name}: ${fmtFull(d.total)} lifetime, last gift ${d.lastGift||"unknown"} (${fmtFull(d.lastAmount)})${(d.lastGift||d.lastTouchpoint)?`, ${daysDiff(d.lastGift||d.lastTouchpoint)}d lapsed`:", no dates on file"}`).join("\n")}\n\nProvide:\n1. Top 3 highest-priority donors to call this week and why\n2. Best re-engagement message angle for this portfolio\n3. One creative re-engagement tactic for the full group`,
      chunk=>setAiText(chunk)
    );
    setAiLoading(false);
  };

  if(!lapsed.length)return<EmptyState title="No lapsed donors" message="All your donors are active, great work!"/>;

  const fmtGiftDate=s=>{
    if(!s)return null;
    const dt=new Date(s);
    return isNaN(dt)?null:dt.toLocaleDateString("en-US",{month:"short",year:"numeric"});
  };

  const cols=["Donor","Lifetime giving","Last gift","Days lapsed",GIVING_STRENGTH_LABEL,""];
  const colWidths="2fr 130px 130px 120px 80px 130px";

  return(
    <div style={{display:"flex",flexDirection:"column",gap:12}}>
      <div style={{display:"flex",gap:10,flexWrap:"wrap",alignItems:"center"}}>
        {[
          ["Lapsed donors",lapsed.length,T.ink],
          ["Total lapsed value",fmtFull(totalValue),T.ink],
          ["Avg days lapsed",`${avgDays}d`,T.terracotta],
        ].map(([label,val,color])=>(
          <div key={label} style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:12,padding:"10px 18px",display:"flex",flexDirection:"column",gap:2}}>
            <div style={{fontSize:10,fontWeight:700,color:T.ink3,textTransform:"uppercase",letterSpacing:".06em"}}>{label}</div>
            <div style={{fontSize:20,fontWeight:800,color,fontFamily:"'DM Serif Display',serif"}}>{val}</div>
          </div>
        ))}
        <div style={{marginLeft:"auto"}}>
          <AIBtn onClick={getStrategy} loading={aiLoading} label="✦ Re-engage Plan"/>
        </div>
      </div>
      {(aiLoading||aiText)&&<AIPanel text={aiText} onClose={()=>setAiText("")}/>}
      <div style={{background:T.white,borderRadius:14,overflow:"hidden",border:"1px solid "+T.bg3}}>
        <div className="reEngage-header" style={{display:"grid",gridTemplateColumns:colWidths,gap:0,padding:"10px 18px",background:T.greenDk,borderBottom:"1px solid "+T.bg3}}>
          <div className="re-col-name" style={{...HEAD,color:T.white}}>Donor</div>
          <div className="re-col-lifetime" style={{...HEAD,color:T.white,textAlign:"right"}}>Lifetime giving</div>
          <div className="re-col-lastgift" style={{...HEAD,color:T.white,textAlign:"right"}}>Last gift</div>
          <div className="re-col-days" style={{...HEAD,color:T.white,textAlign:"right"}}>Days lapsed</div>
          <div className="re-col-score" style={{...HEAD,color:T.white,textAlign:"right"}}>
            {GIVING_STRENGTH_LABEL}<ColDef text={GIVING_STRENGTH_DEF} testid="re-def-giving-strength" dark/>
          </div>
          <div className="re-col-actions" style={{...HEAD,color:T.white,textAlign:"right"}}></div>
        </div>
        {lapsed.map((d,idx)=>{
          const days=(d.lastGift||d.lastTouchpoint)?daysDiff(d.lastGift||d.lastTouchpoint):null;
          const sc=donorScore(d);
          const scColor=sc>70?T.greenDk:sc>45?T.gold600:T.terracotta;
          const rowBg=days>730?T.terracotta+"09":days>365?T.gold600+"09":T.gold600+"09";
          const rowBorderColor=days>730?T.terracotta+"25":days>365?T.gold600+"25":T.gold600+"25";
          const daysColor=days>730?T.terracotta:days>365?T.gold600:T.gold700;
          const urgencyLabel=days>730?"Critical":days>365?"At Risk":"Watch";
          const giftDate=fmtGiftDate(d.lastGift);
          return(
            <div key={d.id} className="reEngage-row" style={{display:"grid",gridTemplateColumns:colWidths,gap:0,padding:"13px 18px",background:rowBg,borderBottom:idx<lapsed.length-1?`1px solid ${rowBorderColor}`:"none",alignItems:"center"}}>
              <div className="re-col-name">
                <div style={{fontSize:13,fontWeight:700,color:T.ink,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}><DonorLink id={d.id} onOpen={()=>onSelectDonor(d)}>{d.name}</DonorLink></div>
                {d.email&&<div style={{fontSize:11,color:T.ink3,marginTop:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{d.email}</div>}
              </div>
              <div className="re-col-lifetime" style={{textAlign:"right",fontSize:13,fontWeight:700,color:T.ink}}>{fmtFull(d.total)}</div>
              <div className="re-col-lastgift" style={{textAlign:"right"}}>
                {giftDate
                  ?<><div style={{fontSize:13,color:T.ink,fontWeight:600}}>{giftDate}</div><div style={{fontSize:11,color:T.ink3,marginTop:1}}>{d.lastAmount>0?fmtFull(d.lastAmount):""}</div></>
                  :<div style={{fontSize:11,color:T.ink3}}>no gift on file</div>
                }
              </div>
              <div className="re-col-days" style={{textAlign:"right"}}>
                {days!=null?<>
                  <div style={{fontSize:13,fontWeight:700,color:daysColor}}>{days}d</div>
                  <div style={{fontSize:10,color:daysColor,fontWeight:700,marginTop:2,textTransform:"uppercase",letterSpacing:".04em"}}>{urgencyLabel}</div>
                </>:<div style={{fontSize:11,color:T.ink3}}>no dates on file</div>}
              </div>
              <div className="re-col-score" style={{textAlign:"right"}}>
                {sc!=null
                  ?<span style={{fontSize:13,fontWeight:800,color:scColor,background:scColor+"18",borderRadius:7,padding:"3px 9px",display:"inline-block"}}>{sc}</span>
                  :<span title="no gifts on file" style={{color:T.ink3,fontSize:11}}>Not set</span>}
              </div>
              <div className="re-col-actions" style={{display:"flex",gap:6,justifyContent:"flex-end"}}>
                <button onClick={e=>{e.stopPropagation();onLogTouchpoint(d);}} style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:7,padding:"4px 10px",color:T.ink3,fontSize:11,fontWeight:600,cursor:"pointer"}}>+ Log</button>
                <DonorLink id={d.id} onOpen={()=>onSelectDonor(d)} style={{background:T.bg2,border:"1px solid "+T.bg3,borderRadius:7,padding:"4px 10px",color:T.ink,fontSize:11,fontWeight:600,cursor:"pointer"}}>View →</DonorLink>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Assign Modal ───────────────────────────────────────────────────────────
function AssignModal({donor,orgTeam,onSave,onClose}){
  const[selectedId,setSelectedId]=useState(donor.assignedTo||"");
  const[loading,setLoading]=useState(false);
  const inp={width:"100%",background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"9px 12px",color:T.ink,fontSize:13,outline:"none",fontFamily:"inherit",boxSizing:"border-box",cursor:"pointer"};
  const save=async()=>{
    if(!selectedId)return;
    const member=orgTeam.find(u=>u.id===selectedId);
    if(!member)return;
    setLoading(true);
    try{
      await apiFetch(`/donors/${donor.id}/assign`,{method:"PATCH",body:JSON.stringify({assignedTo:member.id,assignedToName:member.name})});
      onSave(donor.id,member.id,member.name);
    }catch(e){console.error(e);}
    setLoading(false);
    onClose();
  };
  return(
    <Modal onClose={onClose} width={360} zIndex={500} blur={false} padding={24}
      ariaLabel="Assign relationship owner" dialogStyle={{border:"1px solid "+T.bg3}}>
      <div>
        <div style={{fontSize:16,fontWeight:800,color:T.ink,marginBottom:4}}>Assign Relationship Owner</div>
        <div style={{fontSize:12,color:T.ink3,marginBottom:16}}>{donor.name}</div>
        <select value={selectedId} onChange={e=>setSelectedId(e.target.value)} style={{...inp,marginBottom:16}}>
          <option value="">Unassigned</option>
          {orgTeam.map(u=><option key={u.id} value={u.id}>{u.name} ({u.role})</option>)}
        </select>
        <div style={{display:"flex",gap:8}}>
          <button onClick={save} disabled={loading||!selectedId} style={{flex:1,background:selectedId?T.greenDk:T.bg2,border:"none",borderRadius:10,padding:"11px",color:T.white,fontSize:13,fontWeight:700,cursor:selectedId?"pointer":"not-allowed"}}>
            {loading?"Saving…":"Assign"}
          </button>
          <button onClick={onClose} style={{background:T.bg,border:"none",borderRadius:10,padding:"11px 14px",color:T.ink3,fontSize:13,cursor:"pointer"}}>Cancel</button>
        </div>
      </div>
    </Modal>
  );
}
function DirectoryView({statusFilter="",setStatusFilter,donors,loading,serverTotal,page,pageSize,onPage,clientFilterCount,exportParams,totalDonors,orgTeam,isAdmin,onSelectDonor,onAssign,stageFilter,setStageFilter,assigneeFilter,setAssigneeFilter,designationFilter,setDesignationFilter,officers=[],officerColorMap={},portfolioMeta={tier:PLAN_UNKNOWN,single_user:true},pendingInvites=[],onOfficersChanged,onLoadSampleData,sampleLoading,hasSampleData,onAddDonor,onBulkDone,isReadOnly=false,sortBy="",setSortBy,household="",clearHousehold}){
  // WIRE-1: the server-side filters on screen, as a Group rule, offered once
  // a filter beyond "donors" is set. The sort is not a filter.
  const groupRules=(()=>{const r={};Object.entries(exportParams||{}).forEach(([k,v])=>{if(v&&k!=="sort")r[k]=String(v);});return Object.keys(r).length>1?r:null;})();
  const [selIds,setSelIds]=useState(new Set());
  const [selectMode,setSelectMode]=useState(false); // BUILD-41: mobile rows show checkboxes only in explicit Select mode
  const [stageDrop,setStageDrop]=useState(false);
  const [planSel,setPlanSel]=useState(null);   // BUILD-85 — the selection being planned
  const [assignDrop,setAssignDrop]=useState(false);
  const [delModal,setDelModal]=useState(false);
  const [busy,setBusy]=useState(false);
  const [toast,setToast]=useState("");
  const [exporting,setExporting]=useState(false);
  // PROSPECT-1 — Room to give as a column, the screening file and the
  // screening results. Admins and the major gifts permission only; the
  // routes refuse anyone else.
  const canMajorGifts=useCanMajorGifts();
  const [room,setRoom]=useState(null);           // {[donorId]:{word,label,rank}}
  // FIX-22: the server sorts by Room to give (?sort=room_to_give), across
  // the whole list, so page two continues page one.
  const roomSort=sortBy==="room_to_give";
  const [screenFor,setScreenFor]=useState(null); // {donorIds} for the file preview
  const [screenImport,setScreenImport]=useState(false);
  const [includeScreening,setIncludeScreening]=useState(false);
  const loadRoom=()=>apiFetch("/prospects/room-to-give").then(r=>setRoom((r&&r.donors)||{})).catch(()=>setRoom({}));
  useEffect(()=>{if(canMajorGifts)loadRoom();},[canMajorGifts]);
  // Persisted across the session, not just this mount — a compact preference
  // shouldn't reset every time you navigate away from Directory and back.
  const [density,setDensity]=useState(()=>localStorage.getItem("steward_dir_density")||"comfortable");
  useEffect(()=>{localStorage.setItem("steward_dir_density",density);},[density]);
  const compact=density==="compact";

  // Stage/owner already applied server-side; the rows arrive filtered.
  const filtered=donors;
  const totalPages=Math.max(1,Math.ceil(serverTotal/pageSize));
  // BUILD-94 Part 2 — is every row on this page a donor? A legacy row with
  // nothing stored is one (the same rule the server predicate holds).
  const donorsOnlyPage=donors.every(d=>{
    const t=d.personTypes||d.person_types;
    return !Array.isArray(t)||!t.length||t.includes("donor");
  });

  // Exports EVERY row matching the server query (search/stage/owner), not
  // just this page — client-only advanced/custom-field filters are NOT
  // reflected (they only narrow the loaded page; see note pill below).
  async function exportCsv(){
    setExporting(true);
    try{
      const qs=new URLSearchParams();
      Object.entries(exportParams||{}).forEach(([k,v])=>{if(v)qs.set(k,v);});
      // PROSPECT-1 — never in the default file; an admin adds it on purpose.
      if(isAdmin&&includeScreening)qs.set("includeScreening","1");
      const res=await fetch(`${API}/donors/export/csv?${qs.toString()}`,{headers:{Authorization:`Bearer ${getToken()}`}});
      if(!res.ok){
        // BUILD-79 Part 7.4 — "Export failed: Export failed" was an error whose
        // message was its own name. Carry the server's actual reason.
        // FIX-10 D — the STATUS CODE is not part of that reason. It goes to the
        // console; what she reads is the server's own sentence, or a plain one.
        const body=await res.json().catch(()=>({}));
        console.error(`[export] /donors/export/csv answered ${res.status}`);
        throw new Error(body.message||body.error||"the file could not be built");
      }
      const blob=await res.blob();
      const url=URL.createObjectURL(blob);
      const a=document.createElement("a");
      a.href=url;a.download=`donors-${new Date().toISOString().split("T")[0]}.csv`;
      document.body.appendChild(a);a.click();document.body.removeChild(a);URL.revokeObjectURL(url);
    }catch(e){flash("The export did not finish: "+(errorMessage(e, "the file could not be built"))+".");}
    setExporting(false);
  }

  const selFiltered=filtered.filter(d=>selIds.has(d.id));
  const roomOf=id=>(room&&room[id])||null;
  const shownRows=filtered;
  const allChecked=filtered.length>0&&filtered.every(d=>selIds.has(d.id));
  const someChecked=!allChecked&&filtered.some(d=>selIds.has(d.id));

  function toggleAll(){
    if(allChecked){const n=new Set(selIds);filtered.forEach(d=>n.delete(d.id));setSelIds(n);}
    else{const n=new Set(selIds);filtered.forEach(d=>n.add(d.id));setSelIds(n);}
  }
  function toggleOne(id,e){
    e.stopPropagation();
    const n=new Set(selIds);n.has(id)?n.delete(id):n.add(id);setSelIds(n);
  }
  function flash(msg){setToast(msg);setTimeout(()=>setToast(""),3500);}

  async function bulkStage(stage){
    const ids=selFiltered.map(d=>d.id);
    setBusy(true);
    try{
      const r=await apiFetch("/donors/bulk-stage",{method:"PATCH",body:JSON.stringify({ids,stage})});
      flash(`${r.updated} donor${r.updated!==1?"s":""} moved to ${STAGES.find(s=>s.id===stage)?.label||stage}`);
      setSelIds(new Set());if(onBulkDone)onBulkDone();
    }catch(e){flash("Error: "+e.message);}
    setBusy(false);setStageDrop(false);
  }

  async function bulkAssign(userId,name){
    const ids=selFiltered.map(d=>d.id);
    setBusy(true);
    try{
      const r=await apiFetch("/donors/bulk-assign",{method:"PATCH",body:JSON.stringify({ids,assignedTo:userId})});
      flash(`${r.updated} donor${r.updated!==1?"s":""} assigned to ${name}${r.pending?" (held until they accept)":""}`);
      setSelIds(new Set());if(onBulkDone)onBulkDone();
    }catch(e){flash("Error: "+e.message);}
    setBusy(false);setAssignDrop(false);
  }

  // The deliberate act that puts prospects on the working Pipeline board.
  async function bulkAddPipeline(){
    const ids=selFiltered.map(d=>d.id);
    setBusy(true);
    try{
      const r=await apiFetch("/pipeline/add",{method:"POST",body:JSON.stringify({ids})});
      flash(`${r.added} added to your pipeline`);
      setSelIds(new Set());if(onBulkDone)onBulkDone();
    }catch(e){flash("Error: "+e.message);}
    setBusy(false);
  }

  async function bulkDelete(){
    const ids=selFiltered.map(d=>d.id);
    setBusy(true);
    try{
      const r=await apiFetch("/donors/bulk-delete",{method:"POST",body:JSON.stringify({ids})});
      setSelIds(new Set());setDelModal(false);if(onBulkDone)onBulkDone();
      // WIRE-1: the shared Undo toast brings the whole batch back, one trash row each.
      const undoIds=Array.isArray(r.undoIds)?r.undoIds:[];
      const n=r.deleted;
      if(undoIds.length){
        offerUndo({ undoSeconds:r.undoSeconds, message:`Moved ${n} ${n===1?"person":"people"} to trash.`, undoAction: async()=>{
          for(let i=0;i<undoIds.length;i+=10) await Promise.all(undoIds.slice(i,i+10).map(id=>apiFetch(`/deleted-records/${id}/restore`,{method:"POST"})));
          if(onBulkDone)onBulkDone();
          return { restored: undoIds.length };
        } }, "people");
      } else flash(`${n} donor${n!==1?"s":""} moved to trash`);
    }catch(e){flash(e&&e.error==="active_plan"?e.sentence:"Error: "+e.message);}
    setBusy(false);
  }

  async function saveOfficerColor(userId,color){
    try{ await apiFetch(`/portfolio/officers/${userId}/color`,{method:"PUT",body:JSON.stringify({color})}); onOfficersChanged&&onOfficersChanged(); }
    catch(e){ flash("Could not save color: "+(errorMessage(e, "error"))); }
  }
  const teamPortfolios=portfolioMeta.tier==="team";
  const showPortfolios=officers.length>1; // single-user shop: no color clutter at all

  const filterSel={background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"7px 10px",color:T.ink,fontSize:12,outline:"none",cursor:"pointer"};
  const colGrid="36px minmax(0,2fr) minmax(0,1fr) minmax(0,1fr) 120px 110px 88px 60px"+(canMajorGifts?" 104px":"")+(isAdmin?" 80px":"");
  const dropItem={display:"block",width:"100%",textAlign:"left",background:"none",border:"none",padding:"9px 14px",fontSize:13,color:T.ink,cursor:"pointer",borderBottom:"1px solid "+T.bg2,fontFamily:"'DM Sans',system-ui,sans-serif"};

  if(totalDonors===0&&!hasSampleData){
    return(
      <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"60px 20px",gap:0,textAlign:"center"}}>
        <div style={{marginBottom:18,color:T.greenDk,opacity:0.7}}>
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
            <circle cx="9" cy="7" r="4"/>
            <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
            <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
          </svg>
        </div>
        <div style={{fontFamily:"'DM Serif Display',Georgia,serif",fontSize:22,fontWeight:400,color:T.ink,letterSpacing:"-0.01em",marginBottom:10}}>No donors yet.</div>
        <div style={{fontSize:14,color:T.ink3,maxWidth:300,lineHeight:1.65,marginBottom:24}}>Everyone who believes in your work belongs here, with one story each. Bring in a spreadsheet from Import above, or add one name to begin.</div>
        <div style={{display:"flex",gap:10,flexWrap:"wrap",justifyContent:"center"}}>
          {onAddDonor&&<button onClick={onAddDonor} style={{background:T.greenDk,color:T.white,border:"none",borderRadius:12,padding:"12px 24px",fontSize:14,fontWeight:600,cursor:"pointer",fontFamily:"'DM Sans',system-ui,sans-serif"}}>Add a donor →</button>}
          {onLoadSampleData&&<button onClick={onLoadSampleData} disabled={sampleLoading} style={{background:"transparent",color:T.ink,border:"1.5px solid "+T.ink,borderRadius:12,padding:"12px 24px",fontSize:14,fontWeight:600,cursor:sampleLoading?"not-allowed":"pointer",opacity:sampleLoading?0.7:1,fontFamily:"'DM Sans',system-ui,sans-serif"}}>{sampleLoading?"Loading…":"Explore with sample data"}</button>}
        </div>
      </div>
    );
  }

  return(
    <div style={{display:"flex",flexDirection:"column",gap:10}}>

      {/* Toast */}
      {toast&&<div style={{background:T.ink,color:T.inkInverse,borderRadius:10,padding:"10px 16px",fontSize:13,fontWeight:600,textAlign:"center"}}>{toast}</div>}

      {/* Filters */}
      <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
        {/* PARITY-1 — the tags and the closeness word, as filters. The same
            rules a Group uses (donorStatus.js). */}
        {setStatusFilter&&<select data-testid="dir-status-filter" aria-label="Tag or closeness" value={statusFilter} onChange={e=>setStatusFilter(e.target.value)} style={filterSel}>
          <option value="">Any tag</option>
          <optgroup label="Giving level">{[["general","General"],["mid","Mid"],["major","Major"]].map(([k,l])=><option key={k} value={"level:"+k}>{l}</option>)}</optgroup>
          <optgroup label="Lifecycle">{[["new","New"],["current","Current"],["recaptured","Recaptured"],["lapsed","Lapsed"]].map(([k,l])=><option key={k} value={"lifecycle:"+k}>{l}</option>)}<option value="retained:1">Retained</option></optgroup>
          <optgroup label="Closeness">{[["close","Close"],["warm","Warm"],["on_track","On track"],["cooling","Cooling"],["new","New"]].map(([k,l])=><option key={k} value={"closeness:"+k}>{l}</option>)}</optgroup>
          <optgroup label="Giving"><option value="given:never">Has never given</option></optgroup>
        </select>}
        <select value={stageFilter} onChange={e=>setStageFilter(e.target.value)} style={filterSel}>
          <option value="">All stages</option>
          {STAGES.map(s=><option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <select value={assigneeFilter} onChange={e=>setAssigneeFilter(e.target.value)} style={filterSel}>
          <option value="">All owners</option>
          {orgTeam.map(u=><option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        <select value={designationFilter||""} onChange={e=>setDesignationFilter&&setDesignationFilter(e.target.value)} style={filterSel} title="Filter by planned-giving / estate designation">
          <option value="">All designations</option>
          {DESIGNATION_OPTS.map(([v,l])=><option key={v} value={v}>{l}</option>)}
        </select>
        {/* FIX-14 Part 5: the order lives in the URL (?sort=), and the server
            sorts, so page two continues page one. */}
        {setSortBy&&<select value={sortBy||""} onChange={e=>setSortBy(e.target.value)} style={filterSel} data-testid="dir-sort" aria-label="Sort donors" title="The order of the list">
          <option value="">Sort: total given</option>
          <option value="last_gift_date">Sort: last gift</option>
          <option value="name">Sort: name</option>
          <option value="engagement">Sort: engagement</option>
          <option value="generosity">Sort: generosity</option>
          {canMajorGifts&&<option value="room_to_give">Sort: room to give</option>}
        </select>}
        {household&&<span data-testid="dir-household" style={{fontSize:12,color:T.ink,fontWeight:700,background:T.bg,border:"1px solid "+T.bg3,borderRadius:99,padding:"3px 10px",display:"inline-flex",gap:8,alignItems:"center"}}>
          One household
          {clearHousehold&&<button onClick={clearHousehold} style={{background:"none",border:"none",padding:0,color:T.greenDk,fontWeight:700,fontSize:12,cursor:"pointer"}}>Show everyone</button>}
        </span>}
        {/* BUILD-94 Part 2 — this list holds volunteers, staff and board now.
            It reads "donors" ONLY while every row on it is one: an org that
            has never imported a non-donor sees exactly what it saw before
            (the BUILD-86 rule — the no-op path is byte-identical), and the
            moment there is a volunteer on the page the word is "people",
            because a count of 40 that says "donors" is a lie about 28 of them. */}
        <span style={{fontSize:12,color:T.ink3}}>
          {donorsOnlyPage
            ? `${serverTotal} donor${serverTotal!==1?"s":""}`
            : `${serverTotal} ${serverTotal!==1?"people":"person"}`}
        </span>
        {clientFilterCount>0&&<span title="Advanced and custom-field filters apply within the loaded page only, server-side filtering for these is not available yet."
          style={{fontSize:11,color:T.terracotta,fontWeight:700,background:T.terracotta+"14",border:"1px solid "+T.terracotta+"40",borderRadius:99,padding:"3px 10px"}}>
          filtering current page
        </span>}
        <div style={{flex:1}}/>
        {/* WIRE-1: the list's own filters, saved as a group by rule. Only the
            filters the server runs go in; a filter on this page only does not. */}
        {!isReadOnly&&groupRules&&<SaveAsGroup name={`Donor list ${new Date().toISOString().slice(0,10)}`} rules={groupRules}
          label="Save these filters as a group" testid="directory-save-group"/>}
        <button onClick={()=>{setSelectMode(m=>{if(m)setSelIds(new Set());return !m;});}} className="dir-select-toggle" aria-pressed={selectMode}
          style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"7px 14px",color:T.ink,fontSize:12,fontWeight:700,cursor:"pointer",minHeight:40,alignItems:"center",...activeMark(selectMode,"bottom")}}>
          {selectMode?"Done":"Select"}
        </button>
        <button onClick={exportCsv} disabled={exporting||serverTotal===0} title="Download every donor matching the search/stage/owner filters as a CSV"
          style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"7px 12px",color:serverTotal===0?T.ink3:T.ink,fontSize:12,fontWeight:600,cursor:exporting||serverTotal===0?"not-allowed":"pointer"}}>
          {exporting?"Exporting…":"Export CSV"}
        </button>
        {isAdmin&&canMajorGifts&&<label data-testid="dir-export-screening" title="Adds the screening provider, the date screened, the capacity range and the real estate range" style={{display:"inline-flex",alignItems:"center",gap:5,fontSize:11.5,color:T.ink3,cursor:"pointer"}}>
          <input type="checkbox" checked={includeScreening} onChange={e=>setIncludeScreening(e.target.checked)} style={{accentColor:T.greenDk}}/>
          Include screening results (adds provider, date, capacity range and real estate range)
        </label>}
        {canMajorGifts&&<button data-testid="dir-screening-group" onClick={()=>setScreenFor({donorIds:[]})}
          title="A saved group, in the layout screening providers take"
          style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"7px 12px",color:T.ink,fontSize:12,fontWeight:600,cursor:"pointer"}}>
          Prepare a screening file
        </button>}
        {canMajorGifts&&!isReadOnly&&<button data-testid="dir-screening-import" onClick={()=>setScreenImport(true)}
          style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"7px 12px",color:T.ink,fontSize:12,fontWeight:600,cursor:"pointer"}}>
          Bring in screening results
        </button>}
        <div style={{display:"flex",background:T.bg,borderRadius:99,padding:2,border:"1px solid "+T.bg3}}>
          {[["comfortable","Comfortable"],["compact","Compact"]].map(([v,l])=>(
            <button key={v} onClick={()=>setDensity(v)} title={l+" row spacing"}
              style={{background:density===v?T.white:"transparent",border:"none",borderRadius:99,padding:"5px 12px",fontSize:11,fontWeight:700,color:density===v?T.ink:T.ink3,cursor:"pointer",boxShadow:density===v?T.shadow:"none",transition:"background 0.12s"}}>
              {l}
            </button>
          ))}
        </div>
      </div>

      {/* Officer portfolios (BUILD-14) — color legend + rollups. Team plan
          gets color assignment; Core sees a lock hint; a 1-person shop sees
          nothing (graceful, no empty "assign" clutter). */}
      {showPortfolios&&(
        <div style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:12,padding:"11px 14px",display:"flex",flexWrap:"wrap",alignItems:"center",gap:14}}>
          <span style={{fontSize:10,fontWeight:800,color:T.ink3,textTransform:"uppercase",letterSpacing:".06em"}}>Officer portfolios</span>
          {/* Chip row shows only officers who actually hold donors — an officer
              with 0 assigned donors is noise here. They remain in Settings → Team
              and in every owner/assign dropdown (those read a different list). */}
          {officers.filter(o=>Number(o.portfolio_count)>0).map(o=>{
            const col=o.portfolio_color;
            return(
              <div key={o.id} style={{display:"flex",alignItems:"center",gap:7}}>
                <label style={{position:"relative",display:"inline-flex",cursor:teamPortfolios&&isAdmin?"pointer":"default"}} title={teamPortfolios&&isAdmin?"Set portfolio color":undefined}>
                  <span style={{width:14,height:14,borderRadius:"50%",background:col||T.bg3,border:"1px solid "+(col?col+"88":T.bg3),display:"inline-block"}}/>
                  {teamPortfolios&&isAdmin&&<input type="color" value={col||T.greenDk} onChange={e=>saveOfficerColor(o.id,e.target.value)} style={{position:"absolute",inset:0,opacity:0,width:14,height:14,cursor:"pointer"}}/>}
                </label>
                <span style={{fontSize:12,color:T.ink,fontWeight:600}}>{o.name}</span>
                <span style={{fontSize:11,color:T.ink3}}>{o.portfolio_count} · {fmtFull(o.portfolio_giving)}</span>
              </div>
            );
          })}
          {planLocks(portfolioMeta.tier)&&<span style={{fontSize:11,color:T.ink3,fontStyle:"italic"}}>Color-code portfolios on the Team plan</span>}
        </div>
      )}

      {/* Bulk action bar — shown when ≥1 rows selected */}
      {selIds.size>0&&(
        <div style={{background:T.ink,borderRadius:12,padding:"10px 14px",display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
          <span style={{fontSize:13,fontWeight:700,color:T.inkInverse,whiteSpace:"nowrap"}}>{selFiltered.length} selected</span>
          <button onClick={()=>setSelIds(new Set())} style={{background:"none",border:"none",color:T.ink3,fontSize:12,cursor:"pointer",padding:0,textDecoration:"underline",whiteSpace:"nowrap"}}>Clear</button>
          <div style={{flex:1,minWidth:8}}/>

          {/* BUILD-85 — PLAN A FOLLOW-UP for the selection. "Call these twenty
              lapsed donors this month" had nowhere to live before this; it
              lived in Tasks, which is what kept two follow-up systems running
              at once. Core-available on purpose: planning who to call is the
              CRM's own job, not a major-gifts capability. */}
          {!isReadOnly&&<button onClick={()=>setPlanSel(selFiltered)} disabled={busy}
            style={{background:"transparent",border:"1px solid "+T.gold500,borderRadius:8,padding:"7px 12px",color:T.gold500,fontSize:12,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap",opacity:busy?0.6:1}}>
            Plan a follow-up
          </button>}

          {/* PROSPECT-1 — the ticked people, in the layout screening providers take. */}
          {canMajorGifts&&<button data-testid="dir-screening-file" onClick={()=>setScreenFor({donorIds:selFiltered.map(d=>d.id)})} disabled={busy}
            style={{background:"transparent",border:"1px solid "+T.gold500,borderRadius:8,padding:"7px 12px",color:T.gold500,fontSize:12,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap",opacity:busy?0.6:1}}>
            Prepare a screening file
          </button>}

          {/* PARITY-1 Part D — put the ticked people in a group kept by hand. */}
          {!isReadOnly&&<AddToGroup donorIds={selFiltered.map(d=>d.id)}/>}

          {/* Add to pipeline — the deliberate act that puts prospects on the board (Team). */}
          {teamPortfolios&&<button onClick={bulkAddPipeline} disabled={busy}
            style={{background:T.gold500,border:"none",borderRadius:8,padding:"7px 12px",color:T.ink,fontSize:12,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap",opacity:busy?0.6:1}}>
            + Add to pipeline
          </button>}

          {/* Move to stage — managed stage changes are Team (major-gifts). */}
          {teamPortfolios&&<div style={{position:"relative"}}>
            <button onClick={()=>{setStageDrop(v=>!v);setAssignDrop(false);}} disabled={busy}
              style={{background:T.greenDk,border:"none",borderRadius:8,padding:"7px 12px",color:T.white,fontSize:12,fontWeight:600,cursor:"pointer",whiteSpace:"nowrap",opacity:busy?0.6:1}}>
              Move to stage ▾
            </button>
            {stageDrop&&(
              <div style={{position:"absolute",top:"calc(100% + 6px)",left:0,background:T.bg,border:"1px solid "+T.bg3,borderRadius:12,boxShadow:"0 8px 28px rgba(0,0,0,0.15)",zIndex:500,minWidth:148,overflow:"hidden"}}>
                {STAGES.map(s=>(
                  <button key={s.id} onClick={()=>bulkStage(s.id)} style={dropItem}
                    onMouseEnter={e=>e.target.style.background=T.bg2} onMouseLeave={e=>e.target.style.background="none"}>
                    {s.label}
                  </button>
                ))}
              </div>
            )}
          </div>}

          {/* Assign owner (admin only) — relationship-owner assignment is Team,
              and admin-only by design (BUILD-31 pipeline role scoping: cross-
              officer ownership is the oversight Team sells; staff never see this
              control). An officer may be active OR a pending invite — the latter
              is HELD until they accept (BUILD-36 B2), same as import owner-routing. */}
          {isAdmin&&teamPortfolios&&(orgTeam.length>0||pendingInvites.length>0)&&(
            <div style={{position:"relative"}}>
              <button onClick={()=>{setAssignDrop(v=>!v);setStageDrop(false);}} disabled={busy}
                style={{background:T.greenDk,border:"none",borderRadius:8,padding:"7px 12px",color:T.white,fontSize:12,fontWeight:600,cursor:"pointer",whiteSpace:"nowrap",opacity:busy?0.6:1}}>
                Assign owner ▾
              </button>
              {assignDrop&&(
                <div style={{position:"absolute",top:"calc(100% + 6px)",right:0,background:T.bg,border:"1px solid "+T.bg3,borderRadius:12,boxShadow:"0 8px 28px rgba(0,0,0,0.15)",zIndex:500,minWidth:180,overflow:"hidden",maxHeight:320,overflowY:"auto"}}>
                  {orgTeam.map(u=>(
                    <button key={u.id} onClick={()=>bulkAssign(u.id,u.name)} style={dropItem}
                      onMouseEnter={e=>e.target.style.background=T.bg2} onMouseLeave={e=>e.target.style.background="none"}>
                      {u.name}
                    </button>
                  ))}
                  {pendingInvites.map(u=>(
                    <button key={u.id} onClick={()=>bulkAssign(u.id,u.name)} style={{...dropItem,color:T.gold700}}
                      onMouseEnter={e=>e.target.style.background=T.bg2} onMouseLeave={e=>e.target.style.background="none"}>
                      {u.name} invited
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Delete (admin only) */}
          {isAdmin&&(
            <button onClick={()=>setDelModal(true)} disabled={busy}
              style={{background:T.terracotta,border:"none",borderRadius:8,padding:"7px 12px",color:T.white,fontSize:12,fontWeight:600,cursor:"pointer",whiteSpace:"nowrap",opacity:busy?0.6:1}}>
              Delete
            </button>
          )}
        </div>
      )}

      {/* BUILD-85 — the selection being planned. On success the selection is
          cleared: the twenty you just planned are no longer the twenty you are
          about to act on, and leaving them checked invites a second plan. */}
      {screenFor&&<ScreeningFileModal who={screenFor} onClose={()=>setScreenFor(null)}/>}
      {screenImport&&<ScreeningImportModal onClose={()=>setScreenImport(false)} onDone={()=>loadRoom()}/>}
      {planSel&&<PlanFollowUpModal donors={planSel}
        onSaved={()=>{setSelIds(new Set());}} onClose={()=>setPlanSel(null)}/>}

      {/* Donor table */}
      {loading
        ?<div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:10,padding:"48px 0",color:T.ink3,fontSize:13}}>
          <span style={{display:"inline-block",width:14,height:14,border:"2px solid "+T.bg3,borderTopColor:T.green,borderRadius:"50%",animation:"sp 0.7s linear infinite"}}/>Loading donors…
        </div>
        :filtered.length===0
        ?<EmptyState title="No donors found" message="Try adjusting your filters or search term."/>
        :<div style={{background:T.white,borderRadius:14,overflow:"hidden",border:"1px solid "+T.bg3}}>
          {/* Header — light treatment (not a solid green fill) so Directory
              reads as its own surface instead of blurring into the Kanban
              stage headers and Home hero banner, which are both solid dark
              green. Green identity stays via text color + underline accent. */}
          <div className="dir-header-row" style={{display:"grid",gridTemplateColumns:colGrid,gap:0,padding:"10px 18px",background:T.ground,borderBottom:"2px solid "+T.bg3,alignItems:"center"}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"center"}}>
              <input type="checkbox" checked={allChecked} ref={el=>{if(el)el.indeterminate=someChecked;}} onChange={toggleAll}
                style={{width:15,height:15,cursor:"pointer",accentColor:T.greenDk}}/>
            </div>
            {["Donor","Stage","Owner","Lifetime","Last gift",ENGAGEMENT_LABEL,GIVING_STRENGTH_LABEL,...(canMajorGifts?[ROOM_HEAD]:[]),...(isAdmin?[""]:[])]
              .map((h,i)=>h===ROOM_HEAD?(
                <button key={i} type="button" data-testid="dir-room-sort" aria-pressed={roomSort} onClick={()=>setSortBy&&setSortBy(roomSort?"":"room_to_give")}
                  title={roomSort?"Back to the list's own order":"Strong first, then Some, then Not yet known"}
                  style={{...HEAD,color:roomSort?T.greenDk:T.ink3,textAlign:"right",background:"none",border:"none",padding:0,cursor:"pointer",fontFamily:"inherit",textDecoration:roomSort?"underline":"none"}}>
                  Room to give{roomSort?" ↓":""}
                </button>
              ):(
                <div key={i} className={h==="Stage"?"dir-col-stage":h==="Owner"?"dir-col-owner":h===""?"dir-col-assign":""}
                  style={{...HEAD,color:T.ink3,textAlign:i>=3?"right":"left"}}>
                  {h}
                  {h===GIVING_STRENGTH_LABEL&&<ColDef text={GIVING_STRENGTH_DEF} testid="dir-def-giving-strength"/>}
                  {h===ENGAGEMENT_LABEL&&<ColDef text={ENGAGEMENT_EXPLANATION.engagement} testid="dir-def-engagement"/>}
                </div>
              ))}
          </div>
          {/* Rows */}
          {shownRows.map((d,idx)=>{
            const stage=STAGES.find(s=>s.id===(d.stage||"cultivate"))||STAGES[2];
            const sc=donorScore(d);const scColor=sc>70?T.greenDk:sc>45?T.gold600:T.terracotta;
            const isLast=idx===filtered.length-1;
            const checked=selIds.has(d.id);
            const rowBg=checked?T.green100:idx%2===0?T.white:T.ground;
            return[
              <div key={d.id} className="dir-donor-row" onClick={rowClick(donorHref(d.id),()=>onSelectDonor(d))}
                style={{display:"grid",gridTemplateColumns:colGrid,gap:0,padding:compact?"4px 18px":"11px 18px",background:rowBg,borderBottom:isLast?"none":"1px solid "+T.bg3,cursor:"pointer",alignItems:"center",transition:"background 0.1s, padding 0.12s"}}
                onMouseEnter={e=>e.currentTarget.style.background=checked?T.green100:T.bg}
                onMouseLeave={e=>e.currentTarget.style.background=rowBg}>
                <div onClick={e=>toggleOne(d.id,e)} style={{display:"flex",alignItems:"center",justifyContent:"center",padding:"4px"}}>
                  <input type="checkbox" checked={checked} onChange={e=>{e.stopPropagation();toggleOne(d.id,e);}}
                    style={{width:15,height:15,cursor:"pointer",accentColor:T.greenDk}} onClick={e=>e.stopPropagation()}/>
                </div>
                <div style={{display:"flex",alignItems:"center",gap:8,minWidth:0}}>
                  {/* BUILD-98 — her face, on the list she reads every day.
                      The photo was on the profile and nowhere else, which is
                      the one place she already knows who she is looking at.
                      The stage tint survives as the initials fallback. */}
                  <PersonMark id={d.id} name={d.name} kind={d.kind} size={compact?22:32}
                    tint={T.bg2} tintFg={T.ink}
                    style={{transition:"width 0.12s,height 0.12s"}}/>
                  <div style={{minWidth:0}}>
                    <div style={{fontSize:compact?12:13,fontWeight:700,color:T.ink,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",display:"flex",alignItems:"center",gap:6}}>
                      <DonorLink id={d.id} onOpen={()=>onSelectDonor(d)} style={{overflow:"hidden",textOverflow:"ellipsis"}}>{d.name}</DonorLink>
                      <DriftBadge drift={d.drift}/>
                    </div>
                    {!compact&&d.email&&<div style={{fontSize:11,color:T.ink3,marginTop:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{d.email}</div>}
                    <span className="dir-stage-mobile" style={{...stageChip(stage),borderRadius:99,padding:"2px 7px",fontSize:10,fontWeight:800,letterSpacing:"0.04em",textTransform:"uppercase",marginTop:3}}>{stage.label}</span>
                  </div>
                </div>
                <div className="dir-col-stage">
                  <span style={{...stageChip(stage),borderRadius:99,padding:compact?"2px 8px":"4px 10px",fontSize:10,fontWeight:800,letterSpacing:"0.04em",textTransform:"uppercase"}}>{stage.label}</span>
                </div>
                <div className="dir-col-owner" style={{display:"flex",alignItems:"center",gap:5,minWidth:0}}>
                  {(()=>{
                    // A donor assigned to an invited-but-not-yet-accepted officer
                    // shows their name with a "· pending" tag — clearly held, not
                    // lost, not silently unassigned. Resolves on acceptance.
                    const pending = !d.assignedTo && d.pendingAssigneeName;
                    const label = d.assignedToName || d.pendingAssigneeName || "";
                    const oc=officerColorMap[d.assignedTo];
                    return(<>
                      <div title={label||"Unassigned"} style={{width:22,height:22,borderRadius:"50%",background:pending?(T.gold500+"33"):(oc?oc:T.bg2),display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:800,color:pending?T.gold600:(oc?T.white:T.ink3),flexShrink:0,boxShadow:oc&&!pending?"0 0 0 2px "+oc+"33":"none"}}>{(label||"?")[0]}</div>
                      <span style={{fontSize:12,color:T.ink,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{label||"Not set"}{pending&&<span style={{color:T.gold600,fontWeight:600}}> · pending</span>}</span>
                    </>);
                  })()}
                </div>
                <div style={{textAlign:"right",fontSize:13,fontWeight:700,color:T.ink}}>{fmtFull(d.total)}</div>
                <div style={{textAlign:"right"}}>
                  {d.lastGift
                    ?<><div style={{fontSize:12,color:T.ink}}>{new Date(d.lastGift).toLocaleDateString("en-US",{month:"short",year:"numeric"})}</div>{!compact&&<div style={{fontSize:11,color:T.ink3}}>{d.lastAmount>0?fmtFull(d.lastAmount):""}</div>}</>
                    :<div style={{fontSize:11,color:T.ink3}}>no gift on file</div>}
                </div>
                <div data-testid="dir-engagement" style={{textAlign:"right",fontSize:12}}>
                  {d.engagement!=null
                    ?<><span style={{fontWeight:800,color:T.ink}}>{d.engagement}</span> <span data-testid="dir-closeness" style={{color:d.engagementBand==="close"?T.greenDk:d.engagementBand==="distant"&&d.closeness!=="on_track"?T.gold700:T.ink3}}>{d.closeness?(d.closeness==="on_track"?"On track":d.closeness.charAt(0).toUpperCase()+d.closeness.slice(1)):(bandFor(d.engagement)||{}).label}</span></>
                    :<span title="not worked out yet" style={{color:T.ink3,fontSize:11}}>Not set</span>}
                </div>
                <div style={{textAlign:"right"}}>
                  {sc!=null
                    ?<span style={{background:scColor+"18",color:scColor,borderRadius:7,padding:"3px 8px",fontSize:12,fontWeight:800}}>{sc}</span>
                    :<span title="no gifts on file" style={{color:T.ink3,fontSize:11}}>Not set</span>}
                </div>
                {canMajorGifts&&<div data-testid="dir-room" data-room-word={(roomOf(d.id)||{}).word||""} style={{textAlign:"right",fontSize:12,fontWeight:700,color:T.ink}}>
                  {room?((roomOf(d.id)||{}).label||ROOM_LABEL.unknown):""}
                </div>}
                {isAdmin&&<div className="dir-col-assign dir-assign-cell" style={{textAlign:"right"}}>
                  {/* Reassigning the owner is Team (server 403s for Core). */}
                  {teamPortfolios&&<button onClick={e=>{e.stopPropagation();onAssign(d);}} className="dir-assign-btn" style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:7,padding:"4px 10px",color:T.ink3,fontSize:11,fontWeight:600,cursor:"pointer"}}>Assign</button>}
                </div>}
              </div>,
              /* BUILD-41: the phone row (shown <768px; the grid row above is
                 hidden there). Full name at 17px that WRAPS — a donor list
                 where no name is readable is not usable — inline stage chip,
                 muted meta line, score badge centered right. Tapping opens
                 the donor; in Select mode tapping toggles selection. */
              <div key={d.id+"-m"} className="dir-row-mobile"
                onClick={e=>selectMode?toggleOne(d.id,e):rowClick(donorHref(d.id),()=>onSelectDonor(d))(e)}
                style={{display:"none",alignItems:"center",gap:12,padding:"13px 14px",background:checked?T.green100:idx%2===0?T.white:T.ground,borderBottom:isLast?"none":"1px solid "+T.bg3,cursor:"pointer",minHeight:64}}>
                {selectMode&&<input type="checkbox" checked={checked} onChange={e=>{e.stopPropagation();toggleOne(d.id,e);}} onClick={e=>e.stopPropagation()}
                  style={{width:20,height:20,cursor:"pointer",accentColor:T.greenDk,flexShrink:0}}/>}
                <PersonMark id={d.id} name={d.name} kind={d.kind} size={34}
                  tint={T.bg2} tintFg={T.ink}/>
                <div style={{flex:1,minWidth:0}}>
                  <div className="dir-m-name" style={{fontSize:17,fontWeight:700,color:T.ink,lineHeight:1.25,overflowWrap:"anywhere"}}>
                    <DonorLink id={d.id} onOpen={e=>selectMode?toggleOne(d.id,e):onSelectDonor(d)}>{d.name}</DonorLink>
                    <span style={{...stageChip(stage),borderRadius:99,padding:"2px 8px",fontSize:9.5,fontWeight:800,letterSpacing:"0.04em",textTransform:"uppercase",marginLeft:8,verticalAlign:"2px",whiteSpace:"nowrap"}}>{stage.label}</span>
                    <DriftBadge drift={d.drift} style={{marginLeft:6,verticalAlign:"2px"}}/>
                  </div>
                  <div style={{fontSize:14,color:T.ink3,marginTop:3}}>
                    {fmtFull(d.total)}
                    {d.lastGift?<>{" · "}{d.lastAmount>0?fmtFull(d.lastAmount)+" ":""}{new Date(d.lastGift).toLocaleDateString("en-US",{month:"short",year:"numeric"})}</>:" · no gifts yet"}
                  </div>
                </div>
                {sc!=null
                  ?<span style={{background:scColor+"18",color:scColor,borderRadius:8,padding:"5px 10px",fontSize:13,fontWeight:800,flexShrink:0}}>{sc}</span>
                  :<span title="no gifts on file" style={{color:T.ink3,fontSize:11,flexShrink:0}}>Not set</span>}
              </div>
            ];
          })}
        </div>
      }

      {/* Pagination — 50/page server-side */}
      {!loading&&totalPages>1&&(
        <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:14,padding:"6px 0"}}>
          <button onClick={()=>onPage(page-1)} disabled={page===0}
            style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"7px 14px",color:page===0?T.ink3:T.ink,fontSize:12,fontWeight:700,cursor:page===0?"not-allowed":"pointer",opacity:page===0?0.5:1}}>
            ← Prev
          </button>
          <span style={{fontSize:12,color:T.ink3,fontWeight:600}}>Page {page+1} of {totalPages}</span>
          <button onClick={()=>onPage(page+1)} disabled={page>=totalPages-1}
            style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"7px 14px",color:page>=totalPages-1?T.ink3:T.ink,fontSize:12,fontWeight:700,cursor:page>=totalPages-1?"not-allowed":"pointer",opacity:page>=totalPages-1?0.5:1}}>
            Next →
          </button>
        </div>
      )}

      {/* Delete confirmation modal — never auto-confirm */}
      {delModal&&(
        <Modal onClose={()=>setDelModal(false)} width={420} zIndex={900}
          backdrop="rgba(15,26,18,0.72)" blur={false} padding="36px 32px"
          ariaLabel="Delete donors" dialogStyle={{background:T.bg,borderRadius:20}}>
          <div>
            <div style={{fontSize:24,fontWeight:400,color:T.ink,fontFamily:"'DM Serif Display',Georgia,serif",letterSpacing:"-0.02em",marginBottom:12,lineHeight:1.2}}>
              Delete {selFiltered.length} donor{selFiltered.length!==1?"s":""}?
            </div>
            <div style={{fontSize:14,color:T.ink3,lineHeight:1.65,marginBottom:28}}>
              This removes {selFiltered.length} donor{selFiltered.length!==1?"s":""} and their gift history from your active lists. Steward keeps the records, so support can bring them back if this was a mistake. There is no trash screen to restore them from yourself.
            </div>
            <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
              <button onClick={()=>setDelModal(false)}
                style={{flex:1,background:"transparent",border:"1px solid "+T.bg3,borderRadius:10,padding:"11px 16px",color:T.ink3,fontSize:13,fontWeight:600,cursor:"pointer",minWidth:100}}>
                Cancel
              </button>
              <button onClick={bulkDelete} disabled={busy}
                style={{flex:1,background:T.terracotta,border:"none",borderRadius:10,padding:"11px 16px",color:T.white,fontSize:13,fontWeight:700,cursor:busy?"not-allowed":"pointer",opacity:busy?0.7:1,minWidth:100}}>
                {busy?"Deleting…":`Delete ${selFiltered.length} donor${selFiltered.length!==1?"s":""}`}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Team View ──────────────────────────────────────────────────────────────
function TeamView({donors,orgTeam,onSelectDonor}){
  if(!orgTeam.length)return<EmptyState icon="◆" title="No team members yet" message="Invite team members from Settings to assign and track donor ownership."/>;
  return(
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))",gap:12}}>
      {orgTeam.map(member=>{
        const md=donors.filter(d=>d.assignedTo===member.id).sort((a,b)=>b.total-a.total);
        const tv=md.reduce((s,d)=>s+d.total,0);
        return(
          <div key={member.id} style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:14,padding:16}}>
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12,paddingBottom:10,borderBottom:"1px solid "+T.bg3}}>
              <div style={{width:36,height:36,borderRadius:"50%",background:T.bg2,display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,fontWeight:800,color:T.ink,flexShrink:0}}>{member.name[0]}</div>
              <div>
                <div style={{fontSize:14,fontWeight:700,color:T.ink}}>{member.name}</div>
                <div style={{fontSize:11,color:T.ink3,marginTop:1}}>{md.length} donor{md.length!==1?"s":""} · {fmtFull(tv)}</div>
              </div>
            </div>
            {md.length===0
              ?<div style={{fontSize:12,color:T.ink3,fontStyle:"italic",padding:"4px 0 8px"}}>No assigned donors yet</div>
              :md.slice(0,10).map((d,i)=>{
                const stage=STAGES.find(s=>s.id===(d.stage||"cultivate"))||STAGES[2];
                return(
                  <div key={d.id} onClick={rowClick(donorHref(d.id),()=>onSelectDonor(d))} style={{display:"flex",alignItems:"center",gap:8,padding:"9px 0",borderBottom:i<Math.min(md.length,10)-1?"1px solid "+T.bg3:"none",cursor:"pointer"}}>
                    <PersonMark id={d.id} name={d.name} kind={d.kind} size={28}
                      tint={T.bg2} tintFg={T.ink}/>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:13,fontWeight:600,color:T.ink,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}><DonorLink id={d.id} onOpen={()=>onSelectDonor(d)}>{d.name}</DonorLink></div>
                      <div style={{fontSize:11,color:T.ink3,marginTop:1}}>{stage.label} · {fmtFull(d.total)}</div>
                    </div>
                  </div>
                );
              })
            }
            {md.length>10&&<div style={{fontSize:11,color:T.ink3,textAlign:"center",paddingTop:10,fontStyle:"italic"}}>+{md.length-10} more donors</div>}
          </div>
        );
      })}
    </div>
  );
}

function FilterBar({filters,onChange,customFields,cfFilters,onCfChange}){
  const set=(key,val)=>onChange({...filters,[key]:val});
  const tog=(key,val)=>{const arr=filters[key];set(key,arr.includes(val)?arr.filter(v=>v!==val):[...arr,val]);};
  const inp={background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"7px 10px",color:T.ink,fontSize:12,outline:"none",boxSizing:"border-box"};
  const row={display:"flex",gap:12,flexWrap:"wrap",alignItems:"center"};
  const lbl={fontSize:11,fontWeight:700,color:T.ink3,textTransform:"uppercase",letterSpacing:".06em",whiteSpace:"nowrap",minWidth:90};
  function setCf(fieldId,val){onCfChange({...cfFilters,[fieldId]:val});}
  function togCfOption(fieldId,opt){const cur=cfFilters[fieldId]||[];onCfChange({...cfFilters,[fieldId]:cur.includes(opt)?cur.filter(v=>v!==opt):[...cur,opt]});}
  return(
    <div className="filter-bar" style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:12,padding:"16px 18px",display:"flex",flexDirection:"column",gap:12}}>
      <div className="filter-bar-row" style={row}>
        <span style={lbl} title={"Grouped by the largest and most consistent giving this donor has actually done, from your own records only. No external wealth screening."}>Proven capacity</span>
        <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
          {TIER_META.map(t=>{const a=filters.tiers.includes(t.id);return(
            <button key={t.id} onClick={()=>tog("tiers",t.id)} style={{background:a?t.color+"22":T.bg,border:`1px solid ${a?t.color:T.bg3}`,borderRadius:7,padding:"4px 12px",color:a?t.color:T.ink3,fontSize:12,fontWeight:a?700:400,cursor:"pointer"}}>{t.label}</button>
          );})}
        </div>
      </div>
      <div className="filter-bar-row" style={row}>
        <span style={lbl}>Stage</span>
        <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
          {STAGES.map(s=>{const a=filters.stages.includes(s.id);return(
            <button key={s.id} aria-pressed={a} onClick={()=>tog("stages",s.id)} style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:7,padding:"4px 12px",color:T.ink3,fontSize:12,fontWeight:400,cursor:"pointer",...activeMark(a,"bottom")}}>{s.label}</button>
          );})}
        </div>
      </div>
      <div className="filter-bar-row" style={row}>
        <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
          <span style={lbl}>Giving Pattern</span>
          <select value={filters.pattern} onChange={e=>set("pattern",e.target.value)} style={{...inp,cursor:"pointer",minWidth:190}}>
            <option value="">Any</option>
            {PATTERN_META.map(p=><option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:6}}>
          <span style={lbl}>Geography</span>
          <input value={filters.geo} onChange={e=>set("geo",e.target.value)} placeholder="Search notes & tags…" style={{...inp,minWidth:160}}/>
        </div>
      </div>
      <div className="filter-bar-row" style={row}>
        <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
          <span style={lbl}>Last Gift</span>
          <input type="date" value={filters.giftFrom} onChange={e=>set("giftFrom",e.target.value)} style={inp}/>
          <span style={{fontSize:11,color:T.ink3}}>→</span>
          <input type="date" value={filters.giftTo} onChange={e=>set("giftTo",e.target.value)} style={inp}/>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
          <span style={lbl}>Lifetime Giving</span>
          <input type="number" value={filters.totalMin} onChange={e=>set("totalMin",e.target.value)} placeholder="$min" style={{...inp,width:80}}/>
          <span style={{fontSize:11,color:T.ink3}}>→</span>
          <input type="number" value={filters.totalMax} onChange={e=>set("totalMax",e.target.value)} placeholder="any" style={{...inp,width:80}}/>
        </div>
      </div>
      {customFields&&customFields.length>0&&(
        <div style={{borderTop:"1px solid "+T.bg3,paddingTop:12,display:"flex",flexDirection:"column",gap:10}}>
          <span style={{fontSize:11,fontWeight:700,color:T.ink3,textTransform:"uppercase",letterSpacing:".06em"}}>Custom Fields</span>
          {customFields.map(f=>{
            if(f.type==="select"||f.type==="multi_select"){
              const sel=cfFilters[f.id]||[];
              return(
                <div key={f.id} className="filter-bar-row" style={row}>
                  <span style={lbl}>{f.label}</span>
                  <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
                    {(f.options||[]).map(opt=>{const a=sel.includes(opt);return(
                      <button key={opt} aria-pressed={a} onClick={()=>togCfOption(f.id,opt)} style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:7,padding:"4px 12px",color:T.ink3,fontSize:12,fontWeight:400,cursor:"pointer",...activeMark(a,"bottom")}}>{opt}</button>
                    );})}
                  </div>
                </div>
              );
            }
            if(f.type==="checkbox"){
              const val=cfFilters[f.id]||"";
              return(
                <div key={f.id} className="filter-bar-row" style={row}>
                  <span style={lbl}>{f.label}</span>
                  <div style={{display:"flex",gap:5}}>
                    {["","Yes","No"].map((opt,i)=>{const a=val===opt;return(
                      <button key={i} aria-pressed={a} onClick={()=>setCf(f.id,opt)} style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:7,padding:"4px 12px",color:T.ink3,fontSize:12,fontWeight:400,cursor:"pointer",...activeMark(a,"bottom")}}>{opt||"Any"}</button>
                    );})}
                  </div>
                </div>
              );
            }
            if(f.type==="date"){
              const val=cfFilters[f.id]||{from:"",to:""};
              return(
                <div key={f.id} className="filter-bar-row" style={row}>
                  <span style={lbl}>{f.label}</span>
                  <input type="date" value={val.from||""} onChange={e=>setCf(f.id,{...val,from:e.target.value})} style={inp}/>
                  <span style={{fontSize:11,color:T.ink3}}>→</span>
                  <input type="date" value={val.to||""} onChange={e=>setCf(f.id,{...val,to:e.target.value})} style={inp}/>
                </div>
              );
            }
            const val=cfFilters[f.id]||"";
            return(
              <div key={f.id} className="filter-bar-row" style={row}>
                <span style={lbl}>{f.label}</span>
                <input value={val} onChange={e=>setCf(f.id,e.target.value)} type={f.type==="number"||f.type==="money"?"number":"text"} placeholder={f.type==="number"||f.type==="money"?"Any value":"Search…"} style={{...inp,minWidth:160}}/>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export { AssignModal, DirectoryView, FilterBar, ReEngageView, TeamView };
