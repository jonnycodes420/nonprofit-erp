// DonorDirectory.jsx — the list: the directory, re-engage, the team view and the filter bar.
//
// FIX-1 split: moved VERBATIM out of Donors.jsx. Nothing in it changed.
// Tests read it through readSource("client/src/components/Donors.jsx").
import { useState, useEffect } from "react";
import { apiFetch, API, getToken } from "../api";
import { errorMessage } from "../lib/domainError";
import { censusById } from "../../../shared/numberCensus.js";
import { T, fmtFull, daysDiff, askClaude, STAGES, donorScore, AIBtn, AIPanel, EmptyState, DriftBadge, Modal, PersonMark } from "./shared";
import { PlanFollowUpModal } from "./PlanFollowUp";
import { DESIGNATION_OPTS, PATTERN_META, TIER_META } from "./donorShared";
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

  if(!lapsed.length)return<EmptyState title="No lapsed donors" message="All your donors are active — great work!"/>;

  const fmtGiftDate=s=>{
    if(!s)return null;
    const dt=new Date(s);
    return isNaN(dt)?null:dt.toLocaleDateString("en-US",{month:"short",year:"numeric"});
  };

  const cols=["Donor","Lifetime Giving","Last Gift","Days Lapsed",GIVING_STRENGTH_LABEL,""];
  const colWidths="2fr 130px 130px 120px 80px 130px";

  return(
    <div style={{display:"flex",flexDirection:"column",gap:12}}>
      <div style={{display:"flex",gap:10,flexWrap:"wrap",alignItems:"center"}}>
        {[
          ["Lapsed donors",lapsed.length,T.ink],
          ["Total lapsed value",fmtFull(totalValue),T.ink],
          ["Avg days lapsed",`${avgDays}d`,"#b8593f"],
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
        <div className="reEngage-header" style={{display:"grid",gridTemplateColumns:colWidths,gap:0,padding:"10px 18px",background:"#0d5c3a",borderBottom:"1px solid "+T.bg3}}>
          <div className="re-col-name" style={{fontSize:10,fontWeight:700,color:"#fff",textTransform:"uppercase",letterSpacing:".06em"}}>Donor</div>
          <div className="re-col-lifetime" style={{fontSize:10,fontWeight:700,color:"#fff",textTransform:"uppercase",letterSpacing:".06em",textAlign:"right"}}>Lifetime Giving</div>
          <div className="re-col-lastgift" style={{fontSize:10,fontWeight:700,color:"#fff",textTransform:"uppercase",letterSpacing:".06em",textAlign:"right"}}>Last Gift</div>
          <div className="re-col-days" style={{fontSize:10,fontWeight:700,color:"#fff",textTransform:"uppercase",letterSpacing:".06em",textAlign:"right"}}>Days Lapsed</div>
          <div className="re-col-score" style={{fontSize:10,fontWeight:700,color:"#fff",textTransform:"uppercase",letterSpacing:".06em",textAlign:"right"}}>
            {GIVING_STRENGTH_LABEL}<ColDef text={GIVING_STRENGTH_DEF} testid="re-def-giving-strength" dark/>
          </div>
          <div className="re-col-actions" style={{fontSize:10,fontWeight:700,color:"#fff",textTransform:"uppercase",letterSpacing:".06em",textAlign:"right"}}></div>
        </div>
        {lapsed.map((d,idx)=>{
          const days=(d.lastGift||d.lastTouchpoint)?daysDiff(d.lastGift||d.lastTouchpoint):null;
          const sc=donorScore(d);
          const scColor=sc>70?"#0d5c3a":sc>45?"#a97f22":"#b8593f";
          const rowBg=days>730?"#b8593f09":days>365?"#a97f2209":"#a97f2209";
          const rowBorderColor=days>730?"#b8593f25":days>365?"#a97f2225":"#a97f2225";
          const daysColor=days>730?"#b8593f":days>365?"#a97f22":"#8a6d1f";
          const urgencyLabel=days>730?"Critical":days>365?"At Risk":"Watch";
          const giftDate=fmtGiftDate(d.lastGift);
          return(
            <div key={d.id} className="reEngage-row" style={{display:"grid",gridTemplateColumns:colWidths,gap:0,padding:"13px 18px",background:rowBg,borderBottom:idx<lapsed.length-1?`1px solid ${rowBorderColor}`:"none",alignItems:"center"}}>
              <div className="re-col-name">
                <div style={{fontSize:13,fontWeight:700,color:T.ink,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{d.name}</div>
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
                  :<span title="no gifts on file" style={{color:T.ink3,fontSize:11}}>—</span>}
              </div>
              <div className="re-col-actions" style={{display:"flex",gap:6,justifyContent:"flex-end"}}>
                <button onClick={e=>{e.stopPropagation();onLogTouchpoint(d);}} style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:7,padding:"4px 10px",color:T.ink3,fontSize:11,fontWeight:600,cursor:"pointer"}}>+ Log</button>
                <button onClick={()=>onSelectDonor(d)} style={{background:"#0d5c3a14",border:"1px solid #0d5c3a40",borderRadius:7,padding:"4px 10px",color:"#0d5c3a",fontSize:11,fontWeight:600,cursor:"pointer"}}>View →</button>
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
          <option value="">— unassigned —</option>
          {orgTeam.map(u=><option key={u.id} value={u.id}>{u.name} ({u.role})</option>)}
        </select>
        <div style={{display:"flex",gap:8}}>
          <button onClick={save} disabled={loading||!selectedId} style={{flex:1,background:selectedId?"#0d5c3a":T.bg2,border:"none",borderRadius:10,padding:"11px",color:"#fff",fontSize:13,fontWeight:700,cursor:selectedId?"pointer":"not-allowed"}}>
            {loading?"Saving…":"Assign"}
          </button>
          <button onClick={onClose} style={{background:T.bg,border:"none",borderRadius:10,padding:"11px 14px",color:T.ink3,fontSize:13,cursor:"pointer"}}>Cancel</button>
        </div>
      </div>
    </Modal>
  );
}
function DirectoryView({donors,loading,serverTotal,page,pageSize,onPage,clientFilterCount,exportParams,totalDonors,orgTeam,isAdmin,onSelectDonor,onAssign,stageFilter,setStageFilter,assigneeFilter,setAssigneeFilter,designationFilter,setDesignationFilter,officers=[],officerColorMap={},portfolioMeta={tier:"core",single_user:true},pendingInvites=[],onOfficersChanged,onLoadSampleData,sampleLoading,hasSampleData,onAddDonor,onBulkDone,isReadOnly=false}){
  const [selIds,setSelIds]=useState(new Set());
  const [selectMode,setSelectMode]=useState(false); // BUILD-41: mobile rows show checkboxes only in explicit Select mode
  const [stageDrop,setStageDrop]=useState(false);
  const [planSel,setPlanSel]=useState(null);   // BUILD-85 — the selection being planned
  const [assignDrop,setAssignDrop]=useState(false);
  const [delModal,setDelModal]=useState(false);
  const [busy,setBusy]=useState(false);
  const [toast,setToast]=useState("");
  const [exporting,setExporting]=useState(false);
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
      const res=await fetch(`${API}/donors/export/csv?${qs.toString()}`,{headers:{Authorization:`Bearer ${getToken()}`}});
      if(!res.ok){
        // BUILD-79 Part 7.4 — "Export failed: Export failed" was an error whose
        // message was its own name. Carry the server's actual reason + status.
        const body=await res.json().catch(()=>({}));
        throw new Error(`the server answered ${res.status}${body.error?` — ${body.error}`:""}${body.message?`: ${body.message}`:""}`);
      }
      const blob=await res.blob();
      const url=URL.createObjectURL(blob);
      const a=document.createElement("a");
      a.href=url;a.download=`donors-${new Date().toISOString().split("T")[0]}.csv`;
      document.body.appendChild(a);a.click();document.body.removeChild(a);URL.revokeObjectURL(url);
    }catch(e){flash("Export failed — "+(errorMessage(e, "unknown error")));}
    setExporting(false);
  }

  const selFiltered=filtered.filter(d=>selIds.has(d.id));
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
      flash(`${r.deleted} donor${r.deleted!==1?"s":""} moved to trash`);
      setSelIds(new Set());setDelModal(false);if(onBulkDone)onBulkDone();
    }catch(e){flash("Error: "+e.message);}
    setBusy(false);
  }

  async function saveOfficerColor(userId,color){
    try{ await apiFetch(`/portfolio/officers/${userId}/color`,{method:"PUT",body:JSON.stringify({color})}); onOfficersChanged&&onOfficersChanged(); }
    catch(e){ flash("Could not save color: "+(errorMessage(e, "error"))); }
  }
  const teamPortfolios=portfolioMeta.tier==="team";
  const showPortfolios=officers.length>1; // single-user shop: no color clutter at all

  const filterSel={background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"7px 10px",color:T.ink,fontSize:12,outline:"none",cursor:"pointer"};
  const colGrid="36px minmax(0,2fr) minmax(0,1fr) minmax(0,1fr) 120px 110px 60px"+(isAdmin?" 80px":"");
  const dropItem={display:"block",width:"100%",textAlign:"left",background:"none",border:"none",padding:"9px 14px",fontSize:13,color:"#0f1a12",cursor:"pointer",borderBottom:"1px solid #f3f0eb",fontFamily:"'DM Sans',system-ui,sans-serif"};

  if(totalDonors===0&&!hasSampleData){
    return(
      <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"60px 20px",gap:0,textAlign:"center"}}>
        <div style={{marginBottom:18,color:"#0d5c3a",opacity:0.7}}>
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
            <circle cx="9" cy="7" r="4"/>
            <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
            <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
          </svg>
        </div>
        <div style={{fontFamily:"'DM Serif Display',Georgia,serif",fontSize:22,fontWeight:400,color:"#0f1a12",letterSpacing:"-0.01em",marginBottom:10}}>No donors yet.</div>
        <div style={{fontSize:14,color:"#5a554f",maxWidth:300,lineHeight:1.65,marginBottom:24}}>Every relationship in Steward starts as one row — bring in a spreadsheet from Import above, or add a single name to begin.</div>
        <div style={{display:"flex",gap:10,flexWrap:"wrap",justifyContent:"center"}}>
          {onAddDonor&&<button onClick={onAddDonor} style={{background:"#0d5c3a",color:"#fff",border:"none",borderRadius:12,padding:"12px 24px",fontSize:14,fontWeight:600,cursor:"pointer",fontFamily:"'DM Sans',system-ui,sans-serif"}}>Add a donor →</button>}
          {onLoadSampleData&&<button onClick={onLoadSampleData} disabled={sampleLoading} style={{background:"transparent",color:"#0d5c3a",border:"1.5px solid #0d5c3a",borderRadius:12,padding:"12px 24px",fontSize:14,fontWeight:600,cursor:sampleLoading?"not-allowed":"pointer",opacity:sampleLoading?0.7:1,fontFamily:"'DM Sans',system-ui,sans-serif"}}>{sampleLoading?"Loading…":"Explore with sample data"}</button>}
        </div>
      </div>
    );
  }

  return(
    <div style={{display:"flex",flexDirection:"column",gap:10}}>

      {/* Toast */}
      {toast&&<div style={{background:"#0f1a12",color:"#f0ede6",borderRadius:10,padding:"10px 16px",fontSize:13,fontWeight:600,textAlign:"center"}}>{toast}</div>}

      {/* Filters */}
      <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
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
        {clientFilterCount>0&&<span title="Advanced and custom-field filters apply within the loaded page only — server-side filtering for these is not available yet."
          style={{fontSize:11,color:T.terracotta,fontWeight:700,background:"#b8593f14",border:"1px solid #b8593f40",borderRadius:99,padding:"3px 10px"}}>
          filtering current page
        </span>}
        <div style={{flex:1}}/>
        <button onClick={()=>{setSelectMode(m=>{if(m)setSelIds(new Set());return !m;});}} className="dir-select-toggle"
          style={{background:selectMode?T.ink:T.bg,border:"1px solid "+(selectMode?T.ink:T.bg3),borderRadius:8,padding:"7px 14px",color:selectMode?"#f0ede6":T.ink,fontSize:12,fontWeight:700,cursor:"pointer",minHeight:40,alignItems:"center"}}>
          {selectMode?"Done":"Select"}
        </button>
        <button onClick={exportCsv} disabled={exporting||serverTotal===0} title="Download every donor matching the search/stage/owner filters as a CSV"
          style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"7px 12px",color:serverTotal===0?T.ink3:T.ink,fontSize:12,fontWeight:600,cursor:exporting||serverTotal===0?"not-allowed":"pointer"}}>
          {exporting?"Exporting…":"Export CSV"}
        </button>
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
          <span style={{fontSize:10,fontWeight:800,color:"#0d5c3a",textTransform:"uppercase",letterSpacing:".06em"}}>Officer portfolios</span>
          {/* Chip row shows only officers who actually hold donors — an officer
              with 0 assigned donors is noise here. They remain in Settings → Team
              and in every owner/assign dropdown (those read a different list). */}
          {officers.filter(o=>Number(o.portfolio_count)>0).map(o=>{
            const col=o.portfolio_color;
            return(
              <div key={o.id} style={{display:"flex",alignItems:"center",gap:7}}>
                <label style={{position:"relative",display:"inline-flex",cursor:teamPortfolios&&isAdmin?"pointer":"default"}} title={teamPortfolios&&isAdmin?"Set portfolio color":undefined}>
                  <span style={{width:14,height:14,borderRadius:"50%",background:col||"#c9beac",border:"1px solid "+(col?col+"88":"#b7ad9b"),display:"inline-block"}}/>
                  {teamPortfolios&&isAdmin&&<input type="color" value={col||"#0d5c3a"} onChange={e=>saveOfficerColor(o.id,e.target.value)} style={{position:"absolute",inset:0,opacity:0,width:14,height:14,cursor:"pointer"}}/>}
                </label>
                <span style={{fontSize:12,color:T.ink,fontWeight:600}}>{o.name}</span>
                <span style={{fontSize:11,color:T.ink3}}>{o.portfolio_count} · {fmtFull(o.portfolio_giving)}</span>
              </div>
            );
          })}
          {!teamPortfolios&&<span style={{fontSize:11,color:T.ink3,fontStyle:"italic"}}>Color-code portfolios on the Team plan</span>}
        </div>
      )}

      {/* Bulk action bar — shown when ≥1 rows selected */}
      {selIds.size>0&&(
        <div style={{background:"#0f1a12",borderRadius:12,padding:"10px 14px",display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
          <span style={{fontSize:13,fontWeight:700,color:"#f0ede6",whiteSpace:"nowrap"}}>{selFiltered.length} selected</span>
          <button onClick={()=>setSelIds(new Set())} style={{background:"none",border:"none",color:"#a1b5a8",fontSize:12,cursor:"pointer",padding:0,textDecoration:"underline",whiteSpace:"nowrap"}}>Clear</button>
          <div style={{flex:1,minWidth:8}}/>

          {/* BUILD-85 — PLAN A FOLLOW-UP for the selection. "Call these twenty
              lapsed donors this month" had nowhere to live before this; it
              lived in Tasks, which is what kept two follow-up systems running
              at once. Core-available on purpose: planning who to call is the
              CRM's own job, not a major-gifts capability. */}
          {!isReadOnly&&<button onClick={()=>setPlanSel(selFiltered)} disabled={busy}
            style={{background:"transparent",border:"1px solid #c9a84c",borderRadius:8,padding:"7px 12px",color:"#c9a84c",fontSize:12,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap",opacity:busy?0.6:1}}>
            Plan a follow-up
          </button>}

          {/* Add to pipeline — the deliberate act that puts prospects on the board (Team). */}
          {teamPortfolios&&<button onClick={bulkAddPipeline} disabled={busy}
            style={{background:"#c9a84c",border:"none",borderRadius:8,padding:"7px 12px",color:"#0f1a12",fontSize:12,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap",opacity:busy?0.6:1}}>
            + Add to pipeline
          </button>}

          {/* Move to stage — managed stage changes are Team (major-gifts). */}
          {teamPortfolios&&<div style={{position:"relative"}}>
            <button onClick={()=>{setStageDrop(v=>!v);setAssignDrop(false);}} disabled={busy}
              style={{background:"#0d5c3a",border:"none",borderRadius:8,padding:"7px 12px",color:"#fff",fontSize:12,fontWeight:600,cursor:"pointer",whiteSpace:"nowrap",opacity:busy?0.6:1}}>
              Move to stage ▾
            </button>
            {stageDrop&&(
              <div style={{position:"absolute",top:"calc(100% + 6px)",left:0,background:"#f0ede6",border:"1px solid #d4cfc6",borderRadius:12,boxShadow:"0 8px 28px rgba(0,0,0,0.15)",zIndex:500,minWidth:148,overflow:"hidden"}}>
                {STAGES.map(s=>(
                  <button key={s.id} onClick={()=>bulkStage(s.id)} style={dropItem}
                    onMouseEnter={e=>e.target.style.background="#e8e4db"} onMouseLeave={e=>e.target.style.background="none"}>
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
                style={{background:"#0d5c3a",border:"none",borderRadius:8,padding:"7px 12px",color:"#fff",fontSize:12,fontWeight:600,cursor:"pointer",whiteSpace:"nowrap",opacity:busy?0.6:1}}>
                Assign owner ▾
              </button>
              {assignDrop&&(
                <div style={{position:"absolute",top:"calc(100% + 6px)",right:0,background:"#f0ede6",border:"1px solid #d4cfc6",borderRadius:12,boxShadow:"0 8px 28px rgba(0,0,0,0.15)",zIndex:500,minWidth:180,overflow:"hidden",maxHeight:320,overflowY:"auto"}}>
                  {orgTeam.map(u=>(
                    <button key={u.id} onClick={()=>bulkAssign(u.id,u.name)} style={dropItem}
                      onMouseEnter={e=>e.target.style.background="#e8e4db"} onMouseLeave={e=>e.target.style.background="none"}>
                      {u.name}
                    </button>
                  ))}
                  {pendingInvites.map(u=>(
                    <button key={u.id} onClick={()=>bulkAssign(u.id,u.name)} style={{...dropItem,color:"#8a6d1f"}}
                      onMouseEnter={e=>e.target.style.background="#e8e4db"} onMouseLeave={e=>e.target.style.background="none"}>
                      {u.name} — invited
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Delete (admin only) */}
          {isAdmin&&(
            <button onClick={()=>setDelModal(true)} disabled={busy}
              style={{background:"#b8593f",border:"none",borderRadius:8,padding:"7px 12px",color:"#fff",fontSize:12,fontWeight:600,cursor:"pointer",whiteSpace:"nowrap",opacity:busy?0.6:1}}>
              Delete
            </button>
          )}
        </div>
      )}

      {/* BUILD-85 — the selection being planned. On success the selection is
          cleared: the twenty you just planned are no longer the twenty you are
          about to act on, and leaving them checked invites a second plan. */}
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
          <div className="dir-header-row" style={{display:"grid",gridTemplateColumns:colGrid,gap:0,padding:"10px 18px",background:"#f6f4ee",borderBottom:"2px solid #0d5c3a",alignItems:"center"}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"center"}}>
              <input type="checkbox" checked={allChecked} ref={el=>{if(el)el.indeterminate=someChecked;}} onChange={toggleAll}
                style={{width:15,height:15,cursor:"pointer",accentColor:"#0d5c3a"}}/>
            </div>
            {["Donor","Stage","Owner","Lifetime","Last Gift",GIVING_STRENGTH_LABEL,...(isAdmin?[""]:[])]
              .map((h,i)=>(
                <div key={i} className={h==="Stage"?"dir-col-stage":h==="Owner"?"dir-col-owner":h===""?"dir-col-assign":""}
                  style={{fontSize:10,fontWeight:800,color:"#0d5c3a",textTransform:"uppercase",letterSpacing:".06em",textAlign:i>=3?"right":"left"}}>
                  {h}
                  {h===GIVING_STRENGTH_LABEL&&<ColDef text={GIVING_STRENGTH_DEF} testid="dir-def-giving-strength"/>}
                </div>
              ))}
          </div>
          {/* Rows */}
          {filtered.map((d,idx)=>{
            const stage=STAGES.find(s=>s.id===(d.stage||"cultivate"))||STAGES[2];
            const sc=donorScore(d);const scColor=sc>70?"#0d5c3a":sc>45?"#a97f22":"#b8593f";
            const isLast=idx===filtered.length-1;
            const checked=selIds.has(d.id);
            const rowBg=checked?"#edf3ee":idx%2===0?T.white:"#faf9f6";
            return[
              <div key={d.id} className="dir-donor-row" onClick={()=>onSelectDonor(d)}
                style={{display:"grid",gridTemplateColumns:colGrid,gap:0,padding:compact?"4px 18px":"11px 18px",background:rowBg,borderBottom:isLast?"none":"1px solid "+T.bg3,cursor:"pointer",alignItems:"center",transition:"background 0.1s, padding 0.12s"}}
                onMouseEnter={e=>e.currentTarget.style.background=checked?"#edf3ee":T.bg}
                onMouseLeave={e=>e.currentTarget.style.background=rowBg}>
                <div onClick={e=>toggleOne(d.id,e)} style={{display:"flex",alignItems:"center",justifyContent:"center",padding:"4px"}}>
                  <input type="checkbox" checked={checked} onChange={e=>{e.stopPropagation();toggleOne(d.id,e);}}
                    style={{width:15,height:15,cursor:"pointer",accentColor:"#0d5c3a"}} onClick={e=>e.stopPropagation()}/>
                </div>
                <div style={{display:"flex",alignItems:"center",gap:8,minWidth:0}}>
                  {/* BUILD-98 — her face, on the list she reads every day.
                      The photo was on the profile and nowhere else, which is
                      the one place she already knows who she is looking at.
                      The stage tint survives as the initials fallback. */}
                  <PersonMark id={d.id} name={d.name} kind={d.kind} size={compact?22:32}
                    tint={stage.color+"22"} tintFg={stage.color}
                    style={{transition:"width 0.12s,height 0.12s"}}/>
                  <div style={{minWidth:0}}>
                    <div style={{fontSize:compact?12:13,fontWeight:700,color:T.ink,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",display:"flex",alignItems:"center",gap:6}}>
                      <span style={{overflow:"hidden",textOverflow:"ellipsis"}}>{d.name}</span>
                      <DriftBadge drift={d.drift}/>
                    </div>
                    {!compact&&d.email&&<div style={{fontSize:11,color:T.ink3,marginTop:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{d.email}</div>}
                    <span className="dir-stage-mobile" style={{background:stage.color+"22",color:stage.color,borderRadius:99,padding:"2px 7px",fontSize:10,fontWeight:800,letterSpacing:"0.04em",textTransform:"uppercase",marginTop:3}}>{stage.label}</span>
                  </div>
                </div>
                <div className="dir-col-stage">
                  <span style={{background:stage.color+"22",color:stage.color,borderRadius:99,padding:compact?"2px 8px":"4px 10px",fontSize:10,fontWeight:800,letterSpacing:"0.04em",textTransform:"uppercase"}}>{stage.label}</span>
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
                      <div title={label||"Unassigned"} style={{width:22,height:22,borderRadius:"50%",background:pending?(T.gold500+"33"):(oc?oc:"#0d5c3a22"),display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:800,color:pending?(T.gold600||"#a97f22"):(oc?"#fff":"#0d5c3a"),flexShrink:0,boxShadow:oc&&!pending?"0 0 0 2px "+oc+"33":"none"}}>{(label||"?")[0]}</div>
                      <span style={{fontSize:12,color:T.ink,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{label||"—"}{pending&&<span style={{color:T.gold600||"#a97f22",fontWeight:600}}> · pending</span>}</span>
                    </>);
                  })()}
                </div>
                <div style={{textAlign:"right",fontSize:13,fontWeight:700,color:T.ink}}>{fmtFull(d.total)}</div>
                <div style={{textAlign:"right"}}>
                  {d.lastGift
                    ?<><div style={{fontSize:12,color:T.ink}}>{new Date(d.lastGift).toLocaleDateString("en-US",{month:"short",year:"numeric"})}</div>{!compact&&<div style={{fontSize:11,color:T.ink3}}>{d.lastAmount>0?fmtFull(d.lastAmount):""}</div>}</>
                    :<div style={{fontSize:11,color:T.ink3}}>no gift on file</div>}
                </div>
                <div style={{textAlign:"right"}}>
                  {sc!=null
                    ?<span style={{background:scColor+"18",color:scColor,borderRadius:7,padding:"3px 8px",fontSize:12,fontWeight:800}}>{sc}</span>
                    :<span title="no gifts on file" style={{color:T.ink3,fontSize:11}}>—</span>}
                </div>
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
                onClick={e=>selectMode?toggleOne(d.id,e):onSelectDonor(d)}
                style={{display:"none",alignItems:"center",gap:12,padding:"13px 14px",background:checked?"#edf3ee":idx%2===0?T.white:"#faf9f6",borderBottom:isLast?"none":"1px solid "+T.bg3,cursor:"pointer",minHeight:64}}>
                {selectMode&&<input type="checkbox" checked={checked} onChange={e=>{e.stopPropagation();toggleOne(d.id,e);}} onClick={e=>e.stopPropagation()}
                  style={{width:20,height:20,cursor:"pointer",accentColor:"#0d5c3a",flexShrink:0}}/>}
                <PersonMark id={d.id} name={d.name} kind={d.kind} size={34}
                  tint={stage.color+"22"} tintFg={stage.color}/>
                <div style={{flex:1,minWidth:0}}>
                  <div className="dir-m-name" style={{fontSize:17,fontWeight:700,color:T.ink,lineHeight:1.25,overflowWrap:"anywhere"}}>
                    {d.name}
                    <span style={{background:stage.color+"22",color:stage.color,borderRadius:99,padding:"2px 8px",fontSize:9.5,fontWeight:800,letterSpacing:"0.04em",textTransform:"uppercase",marginLeft:8,verticalAlign:"2px",whiteSpace:"nowrap"}}>{stage.label}</span>
                    <DriftBadge drift={d.drift} style={{marginLeft:6,verticalAlign:"2px"}}/>
                  </div>
                  <div style={{fontSize:14,color:T.ink3,marginTop:3}}>
                    {fmtFull(d.total)}
                    {d.lastGift?<>{" · "}{d.lastAmount>0?fmtFull(d.lastAmount)+" ":""}{new Date(d.lastGift).toLocaleDateString("en-US",{month:"short",year:"numeric"})}</>:" · no gifts yet"}
                  </div>
                </div>
                {sc!=null
                  ?<span style={{background:scColor+"18",color:scColor,borderRadius:8,padding:"5px 10px",fontSize:13,fontWeight:800,flexShrink:0}}>{sc}</span>
                  :<span title="no gifts on file" style={{color:T.ink3,fontSize:11,flexShrink:0}}>—</span>}
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
          ariaLabel="Delete donors" dialogStyle={{background:"#f0ede6",borderRadius:20}}>
          <div>
            <div style={{fontSize:24,fontWeight:400,color:"#0f1a12",fontFamily:"'DM Serif Display',Georgia,serif",letterSpacing:"-0.02em",marginBottom:12,lineHeight:1.2}}>
              Delete {selFiltered.length} donor{selFiltered.length!==1?"s":""}?
            </div>
            <div style={{fontSize:14,color:"#4a5e4f",lineHeight:1.65,marginBottom:28}}>
              This removes {selFiltered.length} donor{selFiltered.length!==1?"s":""} and their gift history from your active lists. You can restore them later from trash.
            </div>
            <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
              <button onClick={()=>setDelModal(false)}
                style={{flex:1,background:"transparent",border:"1px solid #c9c3b8",borderRadius:10,padding:"11px 16px",color:"#4a5e4f",fontSize:13,fontWeight:600,cursor:"pointer",minWidth:100}}>
                Cancel
              </button>
              <button onClick={bulkDelete} disabled={busy}
                style={{flex:1,background:"#b8593f",border:"none",borderRadius:10,padding:"11px 16px",color:"#fff",fontSize:13,fontWeight:700,cursor:busy?"not-allowed":"pointer",opacity:busy?0.7:1,minWidth:100}}>
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
              <div style={{width:36,height:36,borderRadius:"50%",background:"#0d5c3a22",display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,fontWeight:800,color:"#0d5c3a",flexShrink:0}}>{member.name[0]}</div>
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
                  <div key={d.id} onClick={()=>onSelectDonor(d)} style={{display:"flex",alignItems:"center",gap:8,padding:"9px 0",borderBottom:i<Math.min(md.length,10)-1?"1px solid "+T.bg3:"none",cursor:"pointer"}}>
                    <PersonMark id={d.id} name={d.name} kind={d.kind} size={28}
                      tint={stage.color+"22"} tintFg={stage.color}/>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:13,fontWeight:600,color:T.ink,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{d.name}</div>
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
        <span style={lbl} title={"Grouped by the largest and most consistent giving this donor has actually done \u2014 from your own records only. No external wealth screening."}>Proven capacity</span>
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
            <button key={s.id} onClick={()=>tog("stages",s.id)} style={{background:a?s.color+"22":T.bg,border:`1px solid ${a?s.color:T.bg3}`,borderRadius:7,padding:"4px 12px",color:a?s.color:T.ink3,fontSize:12,fontWeight:a?700:400,cursor:"pointer"}}>{s.label}</button>
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
                      <button key={opt} onClick={()=>togCfOption(f.id,opt)} style={{background:a?T.greenDk+"22":T.bg,border:`1px solid ${a?T.greenDk:T.bg3}`,borderRadius:7,padding:"4px 12px",color:a?T.greenDk:T.ink3,fontSize:12,fontWeight:a?700:400,cursor:"pointer"}}>{opt}</button>
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
                      <button key={i} onClick={()=>setCf(f.id,opt)} style={{background:a?T.greenDk+"22":T.bg,border:`1px solid ${a?T.greenDk:T.bg3}`,borderRadius:7,padding:"4px 12px",color:a?T.greenDk:T.ink3,fontSize:12,fontWeight:a?700:400,cursor:"pointer"}}>{opt||"Any"}</button>
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
