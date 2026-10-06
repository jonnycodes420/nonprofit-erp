import { useState, useEffect } from "react";
import { apiFetch, adaptGrant } from "../api";
import { errorMessage } from "../lib/domainError";
import { useAuth } from "../main";
import { DeadlinesView, GrantDeadlinesPanel } from "./GrantDeadlines";
import { GrantDocuments } from "./GrantDocuments";
import { T, activeMark, fmt, fmtFull, daysUntil, SC, askClaude, Spin, Pill, Card, SectionLabel, AIBtn, AIPanel, PageTitle, EmptyState, TouchpointTimeline, interactive, Modal } from "./shared";
import { askConfirm } from "./ConfirmDialog";
import { RecordLink, useUrlWriter } from "./RecordLink";
import { tabHref, rowClick } from "../lib/appUrls";
import { GRANT_STATUSES, statusLabel, normalizeStatus } from "../../../shared/grantShape";
import { offerUndo } from "./EditHistory";
import GrantBoard from "./GrantBoard";
import GrantFunders from "./GrantFunders";
import { GrantChecklist, GrantAwardPlan } from "./GrantWork";
import GrantLibrary from "./GrantLibrary";
import { GrantReportsPanel } from "./GrantReports";
import GrantOverview from "./GrantOverview";
import GrantEmailPath from "./GrantEmailPath";

// ── Grant Log Modal ────────────────────────────────────────────────────────
function GrantLogModal({grant,onSave,onClose}){
  const[type,setType]=useState("call");
  const[date,setDate]=useState(new Date().toISOString().split("T")[0]);
  const[note,setNote]=useState("");
  const[loading,setLoading]=useState(false);
  const inp={width:"100%",boxSizing:"border-box",background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"10px 12px",color:T.ink,fontSize:13,outline:"none",fontFamily:"inherit"};
  const TYPES=[["call","Call"],["email","Email"],["meeting","Meeting"],["site_visit","Site Visit"],["other","Other"]];
  const save=async()=>{
    if(!note.trim())return;setLoading(true);
    try{
      const r=await apiFetch(`/grants/${grant.id}/interactions`,{method:"POST",body:JSON.stringify({type,note,date})});
      onSave(r);
    }catch(e){console.error(e);}
    setLoading(false);
  };
  return(
    <Modal onClose={onClose} width={460} zIndex={300} padding={24}
      ariaLabel="Log touchpoint" dialogStyle={{border:"1px solid "+T.bg3}}>
      <div>
        <div style={{fontSize:16,fontWeight:800,color:T.ink,marginBottom:2}}>Log Touchpoint</div>
        <div style={{fontSize:12,color:T.ink3,marginBottom:16}}>{grant.funder} — {grant.program}</div>
        <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:14}}>
          {TYPES.map(([v,l])=><button key={v} aria-pressed={type===v} onClick={()=>setType(v)} style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:7,padding:"5px 12px",color:T.ink3,fontSize:12,fontWeight:600,cursor:"pointer",...activeMark(type===v,"bottom")}}>{l}</button>)}
        </div>
        <div style={{marginBottom:12}}>
          <div style={{fontSize:11,fontWeight:700,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:5}}>Date</div>
          <input type="date" value={date} onChange={e=>setDate(e.target.value)} style={inp}/>
        </div>
        <div style={{marginBottom:20}}>
          <div style={{fontSize:11,fontWeight:700,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:5}}>Notes</div>
          <textarea value={note} onChange={e=>setNote(e.target.value)} rows={4} placeholder="What happened? Key takeaways, next steps…" style={{...inp,resize:"vertical",lineHeight:1.55}}/>
        </div>
        <div style={{display:"flex",gap:8}}>
          <button onClick={save} disabled={loading||!note.trim()} style={{flex:1,background:note.trim()?T.gold500:T.bg2,border:"none",borderRadius:10,padding:"12px",color:note.trim()?T.ink:T.ink3,fontSize:14,fontWeight:700,cursor:note.trim()?"pointer":"not-allowed"}}>{loading?"Saving…":"Save Touchpoint"}</button>
          <button onClick={onClose} style={{background:T.bg,border:"none",borderRadius:10,padding:"12px 16px",color:T.ink3,fontSize:13,cursor:"pointer"}}>Cancel</button>
        </div>
      </div>
    </Modal>
  );
}

// ── Grant Profile ──────────────────────────────────────────────────────────
function GrantProfile({grant,onClose,onUpdate,onDelete,isAdmin,org,isReadOnly=false,onOpenFunder}){
  const[aiMap,setAiMap]=useState({});const[loadingKey,setLoadingKey]=useState(null);
  const[notes,setNotes]=useState(grant.notes||"");const[savingNotes,setSavingNotes]=useState(false);
  const[editing,setEditing]=useState(false);
  const[ef,setEf]=useState({
    funder:grant.funder,program:grant.program,amount:grant.amount,received:grant.received||0,
    status:normalizeStatus(grant.status)||grant.status,deadline:grant.deadline||"",reportDue:grant.reportDue||"",officer:grant.officer||"",
    description:grant.description||"",requirements:grant.requirements||"",
    campaignId:grant.campaignId||"",
  });
  const[interactions,setInteractions]=useState([]);
  // Goal'd fundraising campaigns for the optional "counts toward" link — an
  // awarded grant's amount can attribute to a campaign (attribution FIX).
  const[fundCampaigns,setFundCampaigns]=useState([]);
  useEffect(()=>{apiFetch("/fundraising/campaigns").then(r=>setFundCampaigns(Array.isArray(r)?r:[])).catch(()=>{});},[]);
  const[logOpen,setLogOpen]=useState(false);

  useEffect(()=>{
    apiFetch(`/grants/${grant.id}`).then(r=>{
      setInteractions(r.interactions||[]);
    }).catch(()=>{});
  },[grant.id]);

  const pct=grant.amount>0?Math.round((grant.received||0)/grant.amount*100):0;
  const days=daysUntil(grant.deadline);
  // A deadline only carries urgency while the grant is still being pursued —
  // an awarded/active/closed grant's application deadline has passed by
  // definition, so "Overdue" there is noise, not information (BUILD-33).
  const actionable=GRANT_ACTIONABLE.has(grant.status);
  const reportDays=grant.reportDue?daysUntil(grant.reportDue):null;
  const statuses=GRANT_STATUSES.map(x=>x.key);
  const curStatus=normalizeStatus(grant.status)||grant.status;

  const getAI=async(type)=>{
    const key=`${grant.id}_${type}`;setLoadingKey(key);setAiMap(p=>({...p,[key]:""}));
    const sys=`You are an expert nonprofit grant writer and strategist. Specific, tactical. Max 250 words.`;
    const prompts={
      analyze:`Analyze grant fit for ${grant.funder} / ${grant.program}.\nAsk: ${fmtFull(grant.amount)} | Status: ${grant.status} | Deadline: ${grant.deadline}\nDescription: ${grant.description||"not set"}\nRequirements: ${grant.requirements||"not set"}\nHistory: ${(grant.history||[]).join(", ")||"none"}\nOrg: ${org?.name} — ${org?.mission}\n\nProvide:\n**Fit Score:** X/10 with 1-sentence reason\n**Key Requirements:** top 3 things the funder wants\n**Recommended Next Steps:** 3 specific actions with timing\n**Risk Flags:** anything that could disqualify us`,
      strategy:`Grant strategy for ${grant.funder} / ${grant.program}.\nAmount: ${fmtFull(grant.amount)} | Status: ${grant.status} | Deadline: ${grant.deadline}\nOfficer: ${grant.officer}\nNotes: ${grant.notes}\nHistory: ${(grant.history||[]).join(", ")}\nOrg: ${org?.name} — ${org?.mission}\n\nProvide: key narrative angle, what funder cares about, red flags, 3 specific things to include.`,
      loi:`Write a compelling Letter of Inquiry for ${grant.funder}.\nProgram: ${grant.program} | Ask: ${fmtFull(grant.amount)}\nOrg: ${org?.name} — ${org?.mission}\n\nWrite a 3-paragraph LOI: hook, program fit, ask.`,
      report:`Grant report outline for ${grant.funder}.\nProgram: ${grant.program} | Amount: ${fmtFull(grant.amount)} | Due: ${grant.reportDue}\nNotes: ${grant.notes}\nOrg mission: ${org?.mission}\n\nProvide: section headers, 3 key metrics to feature, narrative arc, what to emphasize.`,
    };
    await askClaude(sys,prompts[type],chunk=>setAiMap(p=>({...p,[key]:chunk})));
    setLoadingKey(null);
  };

  // GRANTS-1: a stage move is PATCH /grants/:id/stage, the board's own route, with Undo.
  const changeStatus=async(status)=>{
    const g=grant;
    try{
      const r=await apiFetch(`/grants/${g.id}/stage`,{method:"PATCH",body:JSON.stringify({status})});
      onUpdate({...g,status:r.status});
      const renewal=r.renewal&&r.renewal.renewalGrantId?r.renewal:null;
      offerUndo({message:[r.sentence,r.renewal&&r.renewal.sentence].filter(Boolean).join(" "),undoAction:async()=>{
        if(renewal)await apiFetch(`/grants/${g.id}/renewal/undo`,{method:"POST",body:"{}"}).catch(()=>{});
        const x=await apiFetch(`/grants/${g.id}/stage`,{method:"PATCH",body:JSON.stringify({status:r.previous.status,awardedAt:r.previous.awardedAt,declineReason:r.previous.declineReason,planRenewal:false})});
        onUpdate({...g,status:x.status});return x;
      }},"stage");
    }catch(e){
      if(e&&(e.error==="decline_reason"||e.code==="decline_reason")){alert("Move it to Declined from the pipeline board, where Steward asks why they declined.");return;}
      alert((e&&e.sentence)||errorMessage(e,"That grant did not move."));
    }
  };

  const saveNotes=async()=>{
    setSavingNotes(true);const g=grant;
    await apiFetch(`/grants/${g.id}`,{method:"PUT",body:JSON.stringify({funder:g.funder,program:g.program,amount:g.amount,received:g.received||0,status:g.status,deadline:g.deadline||"",reportDue:g.reportDue||"",officer:g.officer,notes,description:g.description||"",requirements:g.requirements||""})});
    onUpdate({...g,notes});setSavingNotes(false);
  };

  const saveEdit=async()=>{
    const adoptTxnId=await resolveAwardAdoption(grant.id,grant.status,ef.status);
    const raw=await apiFetch(`/grants/${grant.id}`,{method:"PUT",body:JSON.stringify({funder:ef.funder,program:ef.program,amount:Number(ef.amount)||0,received:Number(ef.received)||0,status:ef.status,deadline:ef.deadline||"",reportDue:ef.reportDue||"",officer:ef.officer,notes:grant.notes,description:ef.description||"",requirements:ef.requirements||"",campaignId:ef.campaignId||"",adoptTxnId})});
    const adapted={id:raw.id,funder:raw.funder,program:raw.program||"",amount:raw.amount||0,received:raw.received||0,status:raw.status,deadline:raw.deadline||"",reportDue:raw.report_due||null,officer:raw.officer||"",notes:raw.notes||"",description:raw.description||"",requirements:raw.requirements||"",campaignId:raw.campaign_id||null,history:Array.isArray(raw.history)?raw.history:JSON.parse(raw.history||"[]")};
    onUpdate(adapted);setEditing(false);
  };

  const handleLogged=(interaction)=>{
    setInteractions(prev=>[interaction,...prev]);
    setLogOpen(false);
  };

  const inp={width:"100%",boxSizing:"border-box",background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"9px 12px",color:T.ink,fontSize:13,outline:"none"};
  const ta={...inp,resize:"vertical",lineHeight:1.5};

  return(
    <div className="fade-in fullscreen-takeover" style={{position:"fixed",top:52,left:0,right:0,bottom:0,background:T.bg,zIndex:200,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      {logOpen&&<GrantLogModal grant={grant} onSave={handleLogged} onClose={()=>setLogOpen(false)}/>}

      <div style={{background:T.white,borderBottom:"1px solid "+T.bg3,padding:"10px 24px",display:"flex",alignItems:"center",gap:12,flexShrink:0}}>
        <button onClick={onClose} style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"7px 14px",color:T.ink3,fontSize:13,cursor:"pointer",whiteSpace:"nowrap"}}>← Back</button>
        <div style={{flex:1,minWidth:0}}>
          <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
            <span style={{fontSize:16,fontWeight:800,color:T.ink,letterSpacing:"-0.01em"}}>{grant.funder}</span>
            <Pill label={statusLabel(grant.status)||grant.status} color={SC[curStatus]||SC[grant.status]}/>
          </div>
          <div style={{fontSize:11,color:T.ink3,marginTop:2}}>{grant.program} · {fmtFull(grant.amount)} ask</div>
        </div>
        <div style={{display:"flex",gap:6,flexShrink:0}}>
          {grant.funderId&&onOpenFunder&&<button onClick={()=>onOpenFunder(grant.funderId)} data-testid="grant-open-funder" style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"7px 14px",color:T.ink,fontSize:13,cursor:"pointer"}}>Funder</button>}
          <button onClick={()=>setEditing(true)} style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"7px 14px",color:T.ink3,fontSize:13,cursor:"pointer"}}>Edit</button>
          {isAdmin&&<button onClick={()=>onDelete(grant.id)} style={{background:"transparent",border:"1px solid "+T.terracotta,borderRadius:8,padding:"7px 14px",color:T.terracotta,fontSize:13,cursor:"pointer"}}>Delete</button>}
        </div>
      </div>

      {editing&&<div style={{position:"absolute",inset:0,background:"rgba(15,15,15,0.45)",zIndex:10,display:"flex",alignItems:"center",justifyContent:"center"}} onClick={()=>setEditing(false)}>
        <div onClick={e=>e.stopPropagation()} style={{background:T.white,borderRadius:16,padding:24,width:520,maxWidth:"92vw",maxHeight:"88vh",overflowY:"auto",display:"flex",flexDirection:"column",gap:12}}>
          <div style={{fontSize:15,fontWeight:700,color:T.ink}}>Edit Grant</div>
          {[["funder","Funder"],["program","Program"],["officer","Program Officer"]].map(([k,l])=>(
            <div key={k}>
              <div style={{fontSize:11,color:T.ink3,marginBottom:4}}>{l}</div>
              <input value={ef[k]} onChange={e=>setEf(p=>({...p,[k]:e.target.value}))} style={inp}/>
            </div>
          ))}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
            {[["amount","Ask Amount ($)"],["received","Received ($)"]].map(([k,l])=>(
              <div key={k}><div style={{fontSize:11,color:T.ink3,marginBottom:4}}>{l}</div>
              <input type="number" value={ef[k]} onChange={e=>setEf(p=>({...p,[k]:e.target.value}))} style={inp}/></div>
            ))}
            {[["deadline","Deadline"],["reportDue","Report Due"]].map(([k,l])=>(
              <div key={k}><div style={{fontSize:11,color:T.ink3,marginBottom:4}}>{l}</div>
              <input type="date" value={ef[k]||""} onChange={e=>setEf(p=>({...p,[k]:e.target.value}))} style={inp}/></div>
            ))}
          </div>
          <div>
            <div style={{fontSize:11,color:T.ink3,marginBottom:4}}>Status</div>
            <select value={ef.status} onChange={e=>setEf(p=>({...p,status:e.target.value}))} style={{...inp,cursor:"pointer"}}>
              {statuses.map(s=><option key={s} value={s}>{statusLabel(s)}</option>)}
            </select>
          </div>
          {fundCampaigns.length>0&&<div>
            <div style={{fontSize:11,color:T.ink3,marginBottom:4}}>Counts toward campaign (optional)</div>
            <select value={ef.campaignId} onChange={e=>setEf(p=>({...p,campaignId:e.target.value}))} style={{...inp,cursor:"pointer"}}>
              <option value="">No campaign — general operating</option>
              {fundCampaigns.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <div style={{fontSize:11,color:T.ink3,marginTop:4,lineHeight:1.5}}>
              Once this grant is marked Awarded, its amount counts toward the campaign's raised total. If the foundation's money is also logged as a gift on their donor record, attribute only ONE of the two — never both.
            </div>
          </div>}
          <div>
            <div style={{fontSize:11,color:T.ink3,marginBottom:4}}>Grant Description</div>
            <textarea value={ef.description} onChange={e=>setEf(p=>({...p,description:e.target.value}))} rows={3} placeholder="What does this grant fund? What is the funder's focus area?" style={{...ta,boxSizing:"border-box"}}/>
          </div>
          <div>
            <div style={{fontSize:11,color:T.ink3,marginBottom:4}}>Requirements & Eligibility</div>
            <textarea value={ef.requirements} onChange={e=>setEf(p=>({...p,requirements:e.target.value}))} rows={3} placeholder="Key eligibility criteria, required attachments, page limits…" style={{...ta,boxSizing:"border-box"}}/>
          </div>
          <div style={{display:"flex",gap:8,marginTop:4}}>
            <button onClick={saveEdit} style={{background:T.gold500,border:"none",borderRadius:8,padding:"9px 16px",color:T.ink,fontSize:13,fontWeight:600,cursor:"pointer"}}>Save Changes</button>
            <button onClick={()=>setEditing(false)} style={{background:T.bg,border:"none",borderRadius:8,padding:"9px 16px",color:T.ink3,fontSize:13,cursor:"pointer"}}>Cancel</button>
          </div>
        </div>
      </div>}

      <div className="grant-profile-body" style={{flex:1,display:"grid",gridTemplateColumns:"58fr 42fr",overflow:"hidden"}}>
        {/* LEFT */}
        <div style={{overflowY:"auto",padding:"22px 20px 24px 24px",borderRight:"1px solid "+T.bg3,display:"flex",flexDirection:"column",gap:18}}>
          <div className="grant-stat-grid" style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10}}>
            {[
              ["Amount Requested",fmtFull(grant.amount),T.ink],
              ["Amount Awarded",fmtFull(grant.received||0),T.greenMid],
              ["% Funded",pct+"%",pct>75?T.greenMid:pct>40?T.gold600:T.ink3],
              ["Days to Deadline",grant.deadline?(actionable?(days<0?"Overdue":days+"d"):"Passed"):"—",actionable&&days<14?T.terracotta:actionable&&days<30?T.gold600:T.ink],
            ].map(([l,v,c])=>(
              <div key={l} style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:12,padding:"12px 14px"}}>
                <div style={{fontSize:9,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.1em",color:T.ink3,marginBottom:4}}>{l}</div>
                <div style={{fontSize:20,fontWeight:800,color:c,fontFamily:"'DM Serif Display',serif",lineHeight:1.1}}>{v}</div>
              </div>
            ))}
          </div>

          {grant.amount>0&&<div style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:12,padding:"14px 16px"}}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}>
              <div style={{fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.1em",color:T.ink3}}>Funding Progress</div>
              <div style={{fontSize:11,color:T.ink3}}>{fmtFull(grant.received||0)} of {fmtFull(grant.amount)}</div>
            </div>
            <div style={{height:8,background:T.bg3,borderRadius:99}}>
              <div style={{height:"100%",width:`${Math.min(pct,100)}%`,background:T.greenMid,borderRadius:99,transition:"width 0.4s"}}/>
            </div>
          </div>}

          <div className="grant-2col" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            <div style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:12,padding:"12px 14px"}}>
              <div style={{fontSize:9,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.1em",color:T.ink3,marginBottom:4}}>Application Deadline</div>
              <div style={{fontSize:14,fontWeight:600,color:actionable&&days<14?T.terracotta:actionable&&days<30?T.gold600:T.ink}}>{grant.deadline?new Date(grant.deadline).toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric"}):"—"}</div>
            </div>
            <div style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:12,padding:"12px 14px"}}>
              <div style={{fontSize:9,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.1em",color:T.ink3,marginBottom:4}}>Program Officer</div>
              <div style={{fontSize:14,fontWeight:600,color:T.ink}}>{grant.officer||"—"}</div>
            </div>
            {grant.reportDue&&<div style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:12,padding:"12px 14px"}}>
              <div style={{fontSize:9,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.1em",color:T.ink3,marginBottom:4}}>Report Due</div>
              <div style={{fontSize:14,fontWeight:600,color:reportDays!==null&&reportDays<14?T.terracotta:reportDays!==null&&reportDays<30?T.gold600:T.ink}}>{new Date(grant.reportDue).toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric"})}</div>
            </div>}
          </div>

          {grant.description&&<div>
            <div style={{fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.1em",color:T.ink3,marginBottom:8}}>Description</div>
            <div style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:10,padding:"14px 16px",fontSize:13,color:T.ink2,lineHeight:1.65}}>{grant.description}</div>
          </div>}

          {grant.requirements&&<div>
            <div style={{fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.1em",color:T.ink3,marginBottom:8}}>Requirements & Eligibility</div>
            <div style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:10,padding:"14px 16px",fontSize:13,color:T.ink2,lineHeight:1.65,whiteSpace:"pre-wrap"}}>{grant.requirements}</div>
          </div>}

          {/* BUILD-100 Part 7 — the deadlines Steward watches, and the grant's documents. */}
          <GrantDeadlinesPanel grantId={grant.id} isReadOnly={isReadOnly}/>
          <GrantChecklist grantId={grant.id} isReadOnly={isReadOnly}/>
          <GrantAwardPlan grantId={grant.id} isReadOnly={isReadOnly}/>
          <GrantReportsPanel grantId={grant.id} funderId={grant.funderId} isReadOnly={isReadOnly}/>
          <GrantDocuments grantId={grant.id} isReadOnly={isReadOnly}/>

          {grant.history&&grant.history.length>0&&<div>
            <div style={{fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.1em",color:T.ink3,marginBottom:8}}>Prior Awards</div>
            <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
              {grant.history.map((h,i)=><Pill key={i} label={h} color={T.greenMid}/>)}
            </div>
          </div>}
        </div>

        {/* RIGHT */}
        <div style={{overflowY:"auto",padding:"22px 24px 24px 20px",display:"flex",flexDirection:"column",gap:18,background:T.white,borderLeft:"1px solid "+T.bg2}}>
          <div>
            <div style={{fontSize:10,fontWeight:800,textTransform:"uppercase",letterSpacing:"0.1em",color:T.ink3,marginBottom:8}}>Move Stage</div>
            <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
              {statuses.map(s=>(
                <button key={s} onClick={()=>changeStatus(s)} disabled={isReadOnly||s==="declined"&&curStatus!=="declined"}
                  title={s==="declined"?"Move it to Declined from the board, where Steward asks why.":undefined}
                  aria-pressed={curStatus===s} style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"6px 12px",color:T.ink3,fontSize:12,fontWeight:600,cursor:"pointer",...activeMark(curStatus===s,"bottom")}}>
                  {statusLabel(s)}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div style={{fontSize:10,fontWeight:800,textTransform:"uppercase",letterSpacing:"0.1em",color:T.ink3,marginBottom:8}}>Grant Strategy</div>
            <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:12}}>
              <AIBtn onClick={()=>getAI("analyze")} loading={loadingKey===`${grant.id}_analyze`} label="✦ Analyze Grant Fit" small/>
              {grant.status!=="closed"&&<AIBtn onClick={()=>getAI("strategy")} loading={loadingKey===`${grant.id}_strategy`} label="✦ Strategy" small/>}
              {["pending","prospecting"].includes(grant.status)&&<AIBtn onClick={()=>getAI("loi")} loading={loadingKey===`${grant.id}_loi`} label="✦ Draft LOI" small/>}
              {grant.reportDue&&grant.status==="active"&&<AIBtn onClick={()=>getAI("report")} loading={loadingKey===`${grant.id}_report`} label="✦ Report Outline" small/>}
            </div>
            {["analyze","strategy","loi","report"].map(t=>aiMap[`${grant.id}_${t}`]?<AIPanel key={t} text={aiMap[`${grant.id}_${t}`]} onClose={()=>setAiMap(p=>({...p,[`${grant.id}_${t}`]:""}))}/>:null)}
          </div>

          <div>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
              <div style={{fontSize:10,fontWeight:800,textTransform:"uppercase",letterSpacing:"0.1em",color:T.ink3}}>Notes</div>
              {notes!==grant.notes&&<button onClick={saveNotes} disabled={savingNotes} style={{background:T.gold500,border:"none",borderRadius:7,padding:"4px 10px",color:T.ink,fontSize:11,fontWeight:700,cursor:"pointer"}}>{savingNotes?"Saving…":"Save"}</button>}
            </div>
            <textarea value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Add notes about this grant…" style={{width:"100%",boxSizing:"border-box",background:T.white,border:"1px solid "+T.bg3,borderRadius:10,padding:"10px 12px",color:T.ink,fontSize:13,lineHeight:1.6,outline:"none",resize:"vertical",minHeight:90}}/>
          </div>

          <div>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
              <div style={{fontSize:10,fontWeight:800,textTransform:"uppercase",letterSpacing:"0.1em",color:T.ink3}}>Activity Timeline</div>
              <button onClick={()=>setLogOpen(true)} style={{background:T.gold500,border:"none",borderRadius:7,padding:"5px 12px",color:T.ink,fontSize:11,fontWeight:700,cursor:"pointer"}}>+ Log</button>
            </div>
            <div style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:12,
                         padding:interactions?.length?"14px 16px 2px":"4px 16px",
                         maxHeight:420,overflowY:"auto"}}>
              <TouchpointTimeline interactions={interactions}/>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Statuses still being pursued — the only ones where a deadline carries
// urgency. Awarded/active/closed grants' application deadlines have passed by
// definition, so they never show "Overdue" (the BUILD-33 honest-overdue rule).
const GRANT_ACTIONABLE = new Set(["prospecting","researching","loi","invited","applied","submitted","draft","pending"]);

// Finance entity-routing FIX (2026-08-04) — award-side double-count guard.
// Marking a grant Awarded auto-stamps the ledger (BUILD-09); if the same money
// was ALREADY logged as a manual money-in, that would book it twice. Before an
// award transition, ask the server for a recent matching manual transaction
// and offer to LINK it (the existing row becomes the award's single ledger
// booking via PUT adoptTxnId) instead of double-booking. Returns the txn id to
// adopt, or "" to book separately. Every award-transition path (profile status
// change, edit-form save, kanban drop) calls this.
async function resolveAwardAdoption(grantId, prevStatus, nextStatus) {
  if (nextStatus !== "awarded" || prevStatus === "awarded") return "";
  try {
    const r = await apiFetch(`/grants/${grantId}/manual-match`);
    const m = r?.matches?.[0];
    if (!m) return "";
    const link = window.confirm(
      `A ${fmtFull(m.amount)} manual transaction${m.vendor_donor ? ` from "${m.vendor_donor}"` : ""} (${m.date}) is already in the ledger.\n\n` +
      "Link it to this award so the money books once, not twice?\n\n" +
      "OK — link the existing entry (recommended)\nCancel — book the award as a separate ledger entry"
    );
    return link ? m.id : "";
  } catch { return ""; }
}

// Deadline chip for a grant card/row: null when it shouldn't render.
const deadlineMeta = g => {
  if (!g.deadline || !GRANT_ACTIONABLE.has(g.status)) return null;
  const days = Math.round((new Date(g.deadline) - new Date()) / 86400000);
  if (days < 0) return { label: "Overdue", color: T.terracotta };
  if (days === 0) return { label: "Due today", color: T.terracotta };
  return { label: `${days}d`, color: days < 30 ? T.gold600 : T.ink3 };
};

// ── Grants ─────────────────────────────────────────────────────────────────
export function Grants({data,setData,isReadOnly=false,initialGrantId,initialSection,onIntentConsumed}) {
  const {auth}=useAuth();
  const isAdmin=auth?.user?.role==="admin";
  const SUBTABS=[["pipeline","Pipeline"],["funders","Funders"],["deadlines","Deadlines"],["library","Library"],["reports","Reports"],["findgrants","Find grants"]];
  const [subTab,setSubTab]=useState(SUBTABS.some(([k])=>k===initialSection)?initialSection:"pipeline");
  const [openFunderId,setOpenFunderId]=useState("");
  const [boardKey,setBoardKey]=useState(0);
  const [openMiss,setOpenMiss]=useState("");
  const [selected,setSelectedRaw]=useState(()=>initialGrantId?data.grants.find(g=>g.id===initialGrantId)||null:null);
  // FIX-14 Part 5: a grant is /app/grants?grant=<id> and a section is
  // ?gsection=. Opening or closing a grant is a step (pushed); switching the
  // section replaces the entry.
  const goUrl=useUrlWriter();
  const sectionHref=st=>tabHref("grants",st&&st!=="pipeline"?{grantsSection:st}:undefined);
  const setSelected=g=>{setSelectedRaw(g);goUrl(g?tabHref("grants",{grantId:g.id}):sectionHref(subTab));};
  // A grant made since the page loaded (a planned renewal, a new ask) is read fresh.
  const openGrant=async id=>{
    let g=data.grants.find(x=>x.id===id);
    if(!g){
      try{const all=await apiFetch("/grants");const list=(Array.isArray(all)?all:all.grants||[]).map(adaptGrant);setData(prev=>({...prev,grants:list}));g=list.find(x=>x.id===id);}catch{/* said below */}
    }
    if(g){setOpenMiss("");setSelected(g);} else setOpenMiss("That grant could not be found. It may have been deleted.");
  };
  const openFunder=id=>{setSelectedRaw(null);setOpenFunderId(id);setSubTab("funders");goUrl(sectionHref("funders"));};
  useEffect(()=>{
    if(selected||!/^\/app\/grants\/?$/.test(window.location.pathname))return;
    const q=new URLSearchParams(window.location.search);
    if(q.get("grant"))return;
    if((q.get("gsection")||"pipeline")!==subTab)goUrl(sectionHref(subTab),true);
  },[subTab]);  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(()=>{
    if(initialGrantId&&onIntentConsumed)onIntentConsumed();
  },[]);
  const [prospectAI,setProspectAI]=useState(""); const [prospectLoading,setProspectLoading]=useState(false);
  const [showAdd,setShowAdd]=useState(false);
  const [newGrant,setNewGrant]=useState({funder:"",program:"",amount:"",status:"researching",deadline:"",officer:""});
  const [addLoading,setAddLoading]=useState(false);

  const addGrant=async()=>{
    if(!newGrant.funder.trim())return;
    setAddLoading(true);
    try{
      const raw=await apiFetch("/grants",{method:"POST",body:JSON.stringify({
        funder:newGrant.funder.trim(),program:newGrant.program.trim(),
        amount:parseFloat(newGrant.amount)||0,status:newGrant.status,
        deadline:newGrant.deadline||"",officer:newGrant.officer.trim(),
      })});
      const adapted={id:raw.id,funder:raw.funder,program:raw.program||"",amount:raw.amount||0,
        received:raw.received||0,status:raw.status,deadline:raw.deadline||"",
        reportDue:raw.report_due||null,officer:raw.officer||"",notes:raw.notes||"",
        description:raw.description||"",requirements:raw.requirements||"",
        history:Array.isArray(raw.history)?raw.history:JSON.parse(raw.history||"[]")};
      setData(prev=>({...prev,grants:[adapted,...prev.grants]}));
      setNewGrant({funder:"",program:"",amount:"",status:"researching",deadline:"",officer:""});
      setShowAdd(false);setBoardKey(k=>k+1);
      offerUndo({message:`Added ${adapted.funder}.`,undoAction:async()=>{const x=await apiFetch(`/grants/${adapted.id}`,{method:"DELETE"});setData(prev=>({...prev,grants:prev.grants.filter(g=>g.id!==adapted.id)}));setBoardKey(k=>k+1);return x||{};}},"grant");
    }catch(e){console.error(e);}
    setAddLoading(false);
  };

  const findProspects=async()=>{
    setProspectLoading(true); setProspectAI("");
    await askClaude(
      `You are a nonprofit grant research expert. Be specific. Max 200 words.`,
      `Suggest 4 new grant prospects for this org.\nOrg: ${data.org.name}\nMission: ${data.org.mission}\nPrograms: ${data.org.programs.join(", ")}\nCurrent funders: ${data.grants.map(g=>g.funder).join(", ")}\nLocation: New York City\n\nFor each prospect give: funder name, program name, estimated range, why it fits, and one specific alignment point.`,
      chunk=>setProspectAI(chunk)
    );
    setProspectLoading(false);
  };

  const onUpdate=(updated)=>{
    setData(prev=>({...prev,grants:prev.grants.map(g=>g.id===updated.id?updated:g)}));
    setSelected(updated);
  };
  // FIX-12 (HELP-1 list): delete removed a grant at once. The row is really
  // deleted (not a soft delete), so it asks first and says so.
  const onDelete=async(id)=>{
    const g=(data.grants||[]).find(x=>x.id===id);
    if(!(await askConfirm({title:`Delete the ${g&&g.funder?g.funder+" ":""}grant?`,body:"It is removed for good, with its deadlines and notes. This can't be undone.",yes:"Delete grant",danger:true})))return;
    try{ await apiFetch(`/grants/${id}`,{method:"DELETE"}); }
    catch(e){ alert(errorMessage(e,"That grant could not be deleted.")); return; }
    setData(prev=>({...prev,grants:prev.grants.filter(g=>g.id!==id)}));
    setSelected(null);
  };

  return <div style={{display:"flex",flexDirection:"column",gap:16}}>
    {selected ? (
    <GrantProfile grant={selected} onClose={()=>{setSelected(null);setBoardKey(k=>k+1);}} onUpdate={onUpdate} onDelete={onDelete} isAdmin={isAdmin} org={data.org} isReadOnly={isReadOnly} onOpenFunder={openFunder}/>
    ) : (<>
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,flexWrap:"wrap"}}>
      <PageTitle main="Grant" accent={{findgrants:"discovery.",deadlines:"deadlines.",funders:"funders.",library:"library.",reports:"reports."}[subTab]||"pipeline."}/>
      <div style={{display:"flex",gap:2,background:T.bg2,borderRadius:10,padding:3,overflowX:"auto",maxWidth:"100%"}}>
        {SUBTABS.map(([id,label])=>(
          <button key={id} role="tab" aria-selected={subTab===id} onClick={()=>setSubTab(id)} style={{background:"transparent",color:T.ink3,border:"none",borderRadius:"8px 8px 0 0",padding:"6px 16px",fontSize:12,fontWeight:600,cursor:"pointer",transition:"all 0.15s",display:"flex",alignItems:"center",gap:5,...activeMark(subTab===id,"bottom")}}>
            {id==="findgrants"&&<span style={{fontSize:10}}>✦</span>}{label}
          </button>
        ))}
      </div>
    </div>
    {subTab==="findgrants"&&<FindGrants data={data}/>}
    {subTab==="funders"&&<GrantFunders isReadOnly={isReadOnly} onOpenGrant={openGrant} openFunderId={openFunderId}/>}
    {subTab==="library"&&<GrantLibrary isReadOnly={isReadOnly}/>}
    {subTab==="reports"&&<GrantOverview onOpenGrant={openGrant}/>}
    {subTab==="deadlines"&&<>{openMiss&&<div role="status" style={{fontSize:13,color:T.ink3}}>{openMiss}</div>}<DeadlinesView isReadOnly={isReadOnly} isAdmin={isAdmin} onOpenGrant={openGrant}/></>}
    {subTab==="pipeline"&&<>
    <GrantEmailPath/>
    {showAdd&&(()=>{
      const inp={background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"9px 12px",color:T.ink,fontSize:13,outline:"none",width:"100%",boxSizing:"border-box"};
      return <Card style={{display:"flex",flexDirection:"column",gap:12}}>
        <div style={{fontSize:14,fontWeight:700,color:T.ink}}>New grant</div>
        <div className="grant-add-form-grid" style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(200px,1fr))",gap:10}}>
          {[["funder","Funder *","text","e.g. Meridian Foundation"],["program","Program","text","e.g. After-school sailing"],["amount","Ask ($)","number","50000"],["officer","Program officer","text",""]].map(([k,l,t,ph])=>(
            <div key={k} style={{display:"flex",flexDirection:"column",gap:4}}>
              <label style={{fontSize:11,fontWeight:700,color:T.ink3}}>{l}</label>
              <input type={t} value={newGrant[k]} onChange={e=>setNewGrant(p=>({...p,[k]:e.target.value}))} placeholder={ph} style={inp}/>
            </div>
          ))}
          <div style={{display:"flex",flexDirection:"column",gap:4}}>
            <label style={{fontSize:11,fontWeight:700,color:T.ink3}}>Stage</label>
            <select value={newGrant.status} onChange={e=>setNewGrant(p=>({...p,status:e.target.value}))} style={{...inp,cursor:"pointer"}}>
              {GRANT_STATUSES.filter(x=>x.kind==="open").map(x=><option key={x.key} value={x.key}>{x.label}</option>)}
            </select>
          </div>
        </div>
        <div style={{display:"flex",gap:8}}>
          <button onClick={addGrant} disabled={addLoading||!newGrant.funder.trim()} style={{background:T.greenDk,border:"none",borderRadius:8,padding:"9px 18px",color:T.white,fontSize:13,fontWeight:700,cursor:newGrant.funder.trim()?"pointer":"not-allowed",opacity:newGrant.funder.trim()?1:0.5}}>{addLoading?"Saving…":"Save grant"}</button>
          <button onClick={()=>setShowAdd(false)} style={{background:T.bg,border:"none",borderRadius:8,padding:"9px 14px",color:T.ink3,fontSize:13,cursor:"pointer"}}>Cancel</button>
        </div>
      </Card>;
    })()}
    <GrantBoard onOpenGrant={openGrant} onAdd={()=>setShowAdd(true)} isReadOnly={isReadOnly} refreshKey={boardKey}/>
    </>}
    </>)}
  </div>;
}

// ── Find Grants ────────────────────────────────────────────────────────────
export function FindGrants({data}) {
  const [results,setResults]=useState(""); const [loading,setLoading]=useState(false);
  const [ran,setRan]=useState(false);

  const ytdRev=data.financials.revenue.reduce((s,r)=>s+r.individual+r.grants+r.events+r.other,0);
  const budgetLabel=ytdRev>1000000?"$1M+":ytdRev>500000?"$500K–$1M":ytdRev>100000?"$100K–$500K":"Under $100K";
  const activeGrants=data.grants.filter(g=>g.status==="active").map(g=>g.funder).join(", ")||"none yet";

  const find = async () => {
    setLoading(true); setResults(""); setRan(true);
    const sys=`You are a nonprofit grants strategist with deep knowledge of US foundations, government programs, and corporate giving. Be specific with real funder names and programs that actually exist.`;
    const msg=`Find 10 grants this nonprofit is likely eligible for, ranked by alignment.

Organization: ${data.org.name}
Mission: ${data.org.mission}
Annual budget: ${budgetLabel}
Current funders: ${activeGrants}
Board: ${data.board.map(b=>b.employer).filter(Boolean).join(", ")||"various"}

For each grant, provide:
**[Rank]. [Funder Name] — [Program Name]**
Typical award: $[X]–$[Y]
Alignment score: [X]/10
Why you qualify: [2 sentences specific to this org]
Next step: [concrete action]

Focus on grants under $200K that match this org's size and mission. Include a mix of: private foundations, corporate foundations, and government programs. Be specific — name real programs.`;

    await askClaude(sys, msg, chunk=>setResults(chunk));
    setLoading(false);
  };

  return <div style={{display:"flex",flexDirection:"column",gap:16}}>
    <PageTitle main="Find" accent="new grants."/>
    <Card>
      <SectionLabel>Your Organization Profile</SectionLabel>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:16}}>
        <div><div style={{fontSize:11,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:4}}>Mission</div>
          <div style={{fontSize:13,color:T.ink,lineHeight:1.5}}>{data.org.mission||"—"}</div></div>
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          <div><div style={{fontSize:11,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:2}}>Annual Budget</div>
            <div style={{fontSize:13,color:T.ink}}>{budgetLabel}</div></div>
          <div><div style={{fontSize:11,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:2}}>Current Funders</div>
            <div style={{fontSize:13,color:T.ink}}>{activeGrants}</div></div>
        </div>
      </div>
      <button onClick={find} disabled={loading} style={{background:loading?T.bg2:T.gold500,border:"none",borderRadius:12,padding:"13px 22px",color:loading?T.ink3:T.ink,fontSize:14,fontWeight:700,cursor:loading?"not-allowed":"pointer",display:"flex",alignItems:"center",gap:8,opacity:loading?0.7:1}}>
        {loading?<><Spin/>Scanning grant landscape…</>:"✦ Find Matching Grants"}
      </button>
    </Card>

    {(loading||results)&&<Card style={{background:T.gold50,border:"1px solid "+T.bg2,borderLeft:"3px solid "+T.gold500}}>
      <div style={{fontSize:11,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color:T.gold700,marginBottom:14}}>✦ Grant Matches — Ranked by Alignment</div>
      {loading&&!results&&<div style={{display:"flex",alignItems:"center",gap:10,color:T.ink3,fontSize:13}}><Spin dark/>Analyzing your org and searching grant landscape…</div>}
      {results&&<div style={{fontSize:13,color:T.ink,lineHeight:1.85,whiteSpace:"pre-wrap"}}>{results}</div>}
    </Card>}

    {ran&&!loading&&!results&&<div style={{fontSize:13,color:T.ink3,textAlign:"center",padding:20}}>No results yet — try again.</div>}
  </div>;
}
