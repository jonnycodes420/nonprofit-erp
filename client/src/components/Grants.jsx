import { useState, useEffect } from "react";
import { apiFetch } from "../api";
import { useAuth } from "../main";
import { T, fmt, fmtFull, daysUntil, SC, askClaude, Spin, Pill, Card, SectionLabel, AIBtn, AIPanel, PageTitle, EmptyState, TouchpointTimeline } from "./shared";

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
    <div style={{position:"fixed",inset:0,background:"#000000cc",backdropFilter:"blur(4px)",zIndex:300,display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
      <div className="fade-in" style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:18,width:"100%",maxWidth:460,padding:24,boxShadow:"0 4px 32px rgba(15,15,15,0.12)"}}>
        <div style={{fontSize:16,fontWeight:800,color:T.ink,marginBottom:2}}>Log Touchpoint</div>
        <div style={{fontSize:12,color:T.ink3,marginBottom:16}}>{grant.funder} — {grant.program}</div>
        <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:14}}>
          {TYPES.map(([v,l])=><button key={v} onClick={()=>setType(v)} style={{background:type===v?"#10b981":T.bg2,border:`1px solid ${type===v?"#10b981":T.bg3}`,borderRadius:7,padding:"5px 12px",color:type===v?"#fff":T.ink3,fontSize:12,fontWeight:600,cursor:"pointer"}}>{l}</button>)}
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
          <button onClick={save} disabled={loading||!note.trim()} style={{flex:1,background:note.trim()?"#10b981":T.bg2,border:"none",borderRadius:10,padding:"12px",color:"#fff",fontSize:14,fontWeight:700,cursor:note.trim()?"pointer":"not-allowed"}}>{loading?"Saving…":"Save Touchpoint"}</button>
          <button onClick={onClose} style={{background:T.bg,border:"none",borderRadius:10,padding:"12px 16px",color:T.ink3,fontSize:13,cursor:"pointer"}}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ── Grant Profile ──────────────────────────────────────────────────────────
function GrantProfile({grant,onClose,onUpdate,onDelete,isAdmin,org}){
  const[aiMap,setAiMap]=useState({});const[loadingKey,setLoadingKey]=useState(null);
  const[notes,setNotes]=useState(grant.notes||"");const[savingNotes,setSavingNotes]=useState(false);
  const[editing,setEditing]=useState(false);
  const[ef,setEf]=useState({
    funder:grant.funder,program:grant.program,amount:grant.amount,received:grant.received||0,
    status:grant.status,deadline:grant.deadline||"",reportDue:grant.reportDue||"",officer:grant.officer||"",
    description:grant.description||"",requirements:grant.requirements||"",
  });
  const[interactions,setInteractions]=useState([]);
  const[logOpen,setLogOpen]=useState(false);

  useEffect(()=>{
    apiFetch(`/grants/${grant.id}`).then(r=>{
      setInteractions(r.interactions||[]);
    }).catch(()=>{});
  },[grant.id]);

  const pct=grant.amount>0?Math.round((grant.received||0)/grant.amount*100):0;
  const days=daysUntil(grant.deadline);
  const reportDays=grant.reportDue?daysUntil(grant.reportDue):null;
  const statuses=["prospecting","pending","active","closed"];

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

  const changeStatus=async(status)=>{
    const g=grant;
    await apiFetch(`/grants/${g.id}`,{method:"PUT",body:JSON.stringify({funder:g.funder,program:g.program,amount:g.amount,received:g.received||0,status,deadline:g.deadline||"",reportDue:g.reportDue||"",officer:g.officer,notes:g.notes,description:g.description||"",requirements:g.requirements||""})});
    onUpdate({...g,status});
  };

  const saveNotes=async()=>{
    setSavingNotes(true);const g=grant;
    await apiFetch(`/grants/${g.id}`,{method:"PUT",body:JSON.stringify({funder:g.funder,program:g.program,amount:g.amount,received:g.received||0,status:g.status,deadline:g.deadline||"",reportDue:g.reportDue||"",officer:g.officer,notes,description:g.description||"",requirements:g.requirements||""})});
    onUpdate({...g,notes});setSavingNotes(false);
  };

  const saveEdit=async()=>{
    const raw=await apiFetch(`/grants/${grant.id}`,{method:"PUT",body:JSON.stringify({funder:ef.funder,program:ef.program,amount:Number(ef.amount)||0,received:Number(ef.received)||0,status:ef.status,deadline:ef.deadline||"",reportDue:ef.reportDue||"",officer:ef.officer,notes:grant.notes,description:ef.description||"",requirements:ef.requirements||""})});
    const adapted={id:raw.id,funder:raw.funder,program:raw.program||"",amount:raw.amount||0,received:raw.received||0,status:raw.status,deadline:raw.deadline||"",reportDue:raw.report_due||null,officer:raw.officer||"",notes:raw.notes||"",description:raw.description||"",requirements:raw.requirements||"",history:Array.isArray(raw.history)?raw.history:JSON.parse(raw.history||"[]")};
    onUpdate(adapted);setEditing(false);
  };

  const handleLogged=(interaction)=>{
    setInteractions(prev=>[interaction,...prev]);
    setLogOpen(false);
  };

  const inp={width:"100%",boxSizing:"border-box",background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"9px 12px",color:T.ink,fontSize:13,outline:"none"};
  const ta={...inp,resize:"vertical",lineHeight:1.5};

  return(
    <div className="fade-in" style={{position:"fixed",inset:0,background:T.bg,zIndex:200,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      {logOpen&&<GrantLogModal grant={grant} onSave={handleLogged} onClose={()=>setLogOpen(false)}/>}

      <div style={{background:T.white,borderBottom:"1px solid "+T.bg3,padding:"10px 24px",display:"flex",alignItems:"center",gap:12,flexShrink:0}}>
        <button onClick={onClose} style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"7px 14px",color:T.ink3,fontSize:13,cursor:"pointer",whiteSpace:"nowrap"}}>← Back</button>
        <div style={{flex:1,minWidth:0}}>
          <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
            <span style={{fontSize:16,fontWeight:800,color:T.ink,letterSpacing:"-0.01em"}}>{grant.funder}</span>
            <Pill label={grant.status} color={SC[grant.status]}/>
          </div>
          <div style={{fontSize:11,color:T.ink3,marginTop:2}}>{grant.program} · {fmtFull(grant.amount)} ask</div>
        </div>
        <div style={{display:"flex",gap:6,flexShrink:0}}>
          <button onClick={()=>setEditing(true)} style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"7px 14px",color:T.ink3,fontSize:13,cursor:"pointer"}}>Edit</button>
          {isAdmin&&<button onClick={()=>onDelete(grant.id)} style={{background:"transparent",border:"1px solid #ef444455",borderRadius:8,padding:"7px 14px",color:"#ef4444",fontSize:13,cursor:"pointer"}}>Delete</button>}
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
              {statuses.map(s=><option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <div style={{fontSize:11,color:T.ink3,marginBottom:4}}>Grant Description</div>
            <textarea value={ef.description} onChange={e=>setEf(p=>({...p,description:e.target.value}))} rows={3} placeholder="What does this grant fund? What is the funder's focus area?" style={{...ta,boxSizing:"border-box"}}/>
          </div>
          <div>
            <div style={{fontSize:11,color:T.ink3,marginBottom:4}}>Requirements & Eligibility</div>
            <textarea value={ef.requirements} onChange={e=>setEf(p=>({...p,requirements:e.target.value}))} rows={3} placeholder="Key eligibility criteria, required attachments, page limits…" style={{...ta,boxSizing:"border-box"}}/>
          </div>
          <div style={{display:"flex",gap:8,marginTop:4}}>
            <button onClick={saveEdit} style={{background:"#10b981",border:"none",borderRadius:8,padding:"9px 16px",color:"#fff",fontSize:13,fontWeight:600,cursor:"pointer"}}>Save Changes</button>
            <button onClick={()=>setEditing(false)} style={{background:T.bg,border:"none",borderRadius:8,padding:"9px 16px",color:T.ink3,fontSize:13,cursor:"pointer"}}>Cancel</button>
          </div>
        </div>
      </div>}

      <div style={{flex:1,display:"grid",gridTemplateColumns:"65fr 35fr",overflow:"hidden"}}>
        {/* LEFT */}
        <div style={{overflowY:"auto",padding:"22px 20px 24px 24px",borderRight:"1px solid "+T.bg3,display:"flex",flexDirection:"column",gap:18}}>
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10}}>
            {[
              ["Amount Requested",fmtFull(grant.amount),T.ink],
              ["Amount Awarded",fmtFull(grant.received||0),"#1a6b4a"],
              ["% Funded",pct+"%",pct>75?"#1a6b4a":pct>40?"#f59e0b":"#6b7280"],
              ["Days to Deadline",grant.deadline?(days<0?"Overdue":days+"d"):"—",days<0?"#ef4444":days<14?"#ef4444":days<30?"#f59e0b":T.ink],
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
              <div style={{height:"100%",width:`${Math.min(pct,100)}%`,background:"#1a6b4a",borderRadius:99,transition:"width 0.4s"}}/>
            </div>
          </div>}

          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            <div style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:12,padding:"12px 14px"}}>
              <div style={{fontSize:9,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.1em",color:T.ink3,marginBottom:4}}>Application Deadline</div>
              <div style={{fontSize:14,fontWeight:600,color:days<14?"#ef4444":days<30?"#f59e0b":T.ink}}>{grant.deadline?new Date(grant.deadline).toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric"}):"—"}</div>
            </div>
            <div style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:12,padding:"12px 14px"}}>
              <div style={{fontSize:9,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.1em",color:T.ink3,marginBottom:4}}>Program Officer</div>
              <div style={{fontSize:14,fontWeight:600,color:T.ink}}>{grant.officer||"—"}</div>
            </div>
            {grant.reportDue&&<div style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:12,padding:"12px 14px"}}>
              <div style={{fontSize:9,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.1em",color:T.ink3,marginBottom:4}}>Report Due</div>
              <div style={{fontSize:14,fontWeight:600,color:reportDays!==null&&reportDays<14?"#ef4444":reportDays!==null&&reportDays<30?"#f59e0b":T.ink}}>{new Date(grant.reportDue).toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric"})}</div>
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

          <div>
            <div style={{fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.1em",color:T.ink3,marginBottom:8}}>Attachments</div>
            <div style={{background:T.white,border:"1px dashed "+T.bg3,borderRadius:10,padding:"16px",textAlign:"center"}}>
              <div style={{fontSize:12,color:T.ink3}}>No attachments yet</div>
              <div style={{fontSize:11,color:T.ink3,marginTop:4,opacity:0.7}}>File uploads coming soon</div>
            </div>
          </div>

          {grant.history&&grant.history.length>0&&<div>
            <div style={{fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.1em",color:T.ink3,marginBottom:8}}>Prior Awards</div>
            <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
              {grant.history.map((h,i)=><Pill key={i} label={h} color="#1a6b4a"/>)}
            </div>
          </div>}
        </div>

        {/* RIGHT */}
        <div style={{overflowY:"auto",padding:"22px 24px 24px 20px",display:"flex",flexDirection:"column",gap:18}}>
          <div>
            <div style={{fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.1em",color:T.ink3,marginBottom:8}}>Move Stage</div>
            <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
              {statuses.map(s=>(
                <button key={s} onClick={()=>changeStatus(s)}
                  style={{background:grant.status===s?SC[s]+"22":T.bg,border:`1px solid ${grant.status===s?SC[s]:T.bg3}`,borderRadius:8,padding:"6px 12px",color:grant.status===s?SC[s]:T.ink3,fontSize:12,fontWeight:600,cursor:"pointer",textTransform:"capitalize"}}>
                  {s}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div style={{fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.1em",color:T.ink3,marginBottom:8}}>AI Analysis</div>
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
              <div style={{fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.1em",color:T.ink3}}>Notes</div>
              {notes!==grant.notes&&<button onClick={saveNotes} disabled={savingNotes} style={{background:"#10b981",border:"none",borderRadius:7,padding:"4px 10px",color:"#fff",fontSize:11,fontWeight:700,cursor:"pointer"}}>{savingNotes?"Saving…":"Save"}</button>}
            </div>
            <textarea value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Add notes about this grant…" style={{width:"100%",boxSizing:"border-box",background:T.white,border:"1px solid "+T.bg3,borderRadius:10,padding:"10px 12px",color:T.ink,fontSize:13,lineHeight:1.6,outline:"none",resize:"vertical",minHeight:90}}/>
          </div>

          <div>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
              <div style={{fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.1em",color:T.ink3}}>Activity Timeline</div>
              <button onClick={()=>setLogOpen(true)} style={{background:"#10b981",border:"none",borderRadius:7,padding:"5px 12px",color:"#fff",fontSize:11,fontWeight:700,cursor:"pointer"}}>+ Log</button>
            </div>
            <TouchpointTimeline interactions={interactions}/>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Grants ─────────────────────────────────────────────────────────────────
export function Grants({data,setData}) {
  const {auth}=useAuth();
  const isAdmin=auth?.user?.role==="admin";
  const [subTab,setSubTab]=useState("pipeline");
  const [selected,setSelected]=useState(null);
  const [prospectAI,setProspectAI]=useState(""); const [prospectLoading,setProspectLoading]=useState(false);
  const [showAdd,setShowAdd]=useState(false);
  const [newGrant,setNewGrant]=useState({funder:"",program:"",amount:"",status:"prospecting",deadline:"",officer:""});
  const [addLoading,setAddLoading]=useState(false);
  const pipeline=["prospecting","pending","active","closed"];
  const totals=pipeline.reduce((a,s)=>{a[s]=data.grants.filter(g=>g.status===s).reduce((sum,g)=>sum+g.amount,0);return a;},{});

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
      setNewGrant({funder:"",program:"",amount:"",status:"prospecting",deadline:"",officer:""});
      setShowAdd(false);
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
  const onDelete=async(id)=>{
    await apiFetch(`/grants/${id}`,{method:"DELETE"});
    setData(prev=>({...prev,grants:prev.grants.filter(g=>g.id!==id)}));
    setSelected(null);
  };

  return <div style={{display:"flex",flexDirection:"column",gap:16}}>
    {selected&&<GrantProfile grant={selected} onClose={()=>setSelected(null)} onUpdate={onUpdate} onDelete={onDelete} isAdmin={isAdmin} org={data.org}/>}
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,flexWrap:"wrap"}}>
      <PageTitle main="Grant" accent={subTab==="findgrants"?"discovery.":"pipeline."}/>
      <div style={{display:"flex",gap:2,background:T.bg2,borderRadius:10,padding:3}}>
        {[["pipeline","Pipeline"],["findgrants","Find Grants"]].map(([id,label])=>(
          <button key={id} onClick={()=>setSubTab(id)} style={{background:subTab===id?T.greenDk:"transparent",color:subTab===id?"#fff":T.ink3,border:"none",borderRadius:8,padding:"6px 16px",fontSize:12,fontWeight:600,cursor:"pointer",transition:"all 0.15s",display:"flex",alignItems:"center",gap:5}}>
            {id==="findgrants"&&<span style={{fontSize:10}}>✦</span>}{label}
          </button>
        ))}
      </div>
    </div>
    {subTab==="findgrants"&&<FindGrants data={data}/>}
    {subTab==="pipeline"&&<>
    <div style={{display:"flex",gap:10,flexWrap:"wrap",alignItems:"center"}}>
      <AIBtn onClick={findProspects} loading={prospectLoading} label="✦ AI Prospect Research"/>
      <button onClick={()=>setShowAdd(v=>!v)} style={{background:T.greenDk,border:"none",borderRadius:10,padding:"10px 16px",color:"#fff",fontSize:13,fontWeight:600,cursor:"pointer",marginLeft:"auto",boxShadow:"0 2px 8px rgba(26,107,74,0.2)"}}>+ Add Grant</button>
    </div>
    {(prospectLoading||prospectAI)&&<AIPanel text={prospectAI} onClose={()=>setProspectAI("")}/>}

    {showAdd&&(()=>{
      const inp={background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"9px 12px",color:T.ink,fontSize:13,outline:"none",width:"100%",boxSizing:"border-box"};
      return <Card style={{display:"flex",flexDirection:"column",gap:12}}>
        <div style={{fontSize:14,fontWeight:700,color:T.ink}}>New Grant</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          {[["funder","Funder *","text","e.g. Rockefeller Foundation"],["program","Program / Grant Name","text","e.g. Arts Education Initiative"],["amount","Ask Amount ($)","number","50000"],["officer","Program Officer","text","e.g. Angela Wu"]].map(([k,l,t,ph])=>(
            <div key={k} style={{display:"flex",flexDirection:"column",gap:4}}>
              <label style={{fontSize:11,fontWeight:700,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.06em"}}>{l}</label>
              <input type={t} value={newGrant[k]} onChange={e=>setNewGrant(p=>({...p,[k]:e.target.value}))} placeholder={ph} style={inp}/>
            </div>
          ))}
          <div style={{display:"flex",flexDirection:"column",gap:4}}>
            <label style={{fontSize:11,fontWeight:700,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.06em"}}>Status</label>
            <select value={newGrant.status} onChange={e=>setNewGrant(p=>({...p,status:e.target.value}))} style={{...inp,cursor:"pointer"}}>
              {pipeline.map(s=><option key={s} value={s} style={{textTransform:"capitalize"}}>{s}</option>)}
            </select>
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:4}}>
            <label style={{fontSize:11,fontWeight:700,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.06em"}}>Deadline</label>
            <input type="date" value={newGrant.deadline} onChange={e=>setNewGrant(p=>({...p,deadline:e.target.value}))} style={inp}/>
          </div>
        </div>
        <div style={{display:"flex",gap:8}}>
          <button onClick={addGrant} disabled={addLoading||!newGrant.funder.trim()} style={{background:newGrant.funder.trim()?"#10b981":T.bg2,border:"none",borderRadius:8,padding:"9px 18px",color:"#fff",fontSize:13,fontWeight:600,cursor:newGrant.funder.trim()?"pointer":"not-allowed"}}>{addLoading?"Saving…":"Save Grant"}</button>
          <button onClick={()=>setShowAdd(false)} style={{background:T.bg,border:"none",borderRadius:8,padding:"9px 14px",color:T.ink3,fontSize:13,cursor:"pointer"}}>Cancel</button>
        </div>
      </Card>;
    })()}

    <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8}}>
      {pipeline.map(s=><div key={s} style={{background:T.white,border:`1px solid ${SC[s]}25`,borderRadius:12,padding:"14px 16px",borderTop:`3px solid ${SC[s]}`}}>
        <div style={{fontSize:10,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color:SC[s],marginBottom:8}}>{s}</div>
        <div style={{fontSize:22,fontWeight:800,color:T.ink,fontFamily:"'DM Serif Display',serif",lineHeight:1}}>{fmt(totals[s])}</div>
        <div style={{fontSize:11,color:T.ink3,marginTop:4}}>{data.grants.filter(g=>g.status===s).length} grant{data.grants.filter(g=>g.status===s).length!==1?"s":""}</div>
      </div>)}
    </div>

    {data.grants.length===0&&<EmptyState icon="◉" title="No grants yet" message="Start tracking your grant portfolio — add one manually or use Find Grants to discover new funders." action="+ Add your first grant" onAction={()=>setShowAdd(true)}/>}
    {data.grants.map(g=>{
      const pct=g.amount>0?Math.round((g.received||0)/g.amount*100):0;
      const days=daysUntil(g.deadline);
      return <Card key={g.id} accent={SC[g.status]} onClick={()=>setSelected(g)} style={{cursor:"pointer"}}>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <div style={{flex:1}}>
            <div style={{fontSize:15,fontWeight:700,color:T.ink}}>{g.funder}</div>
            <div style={{fontSize:12,color:T.ink3,marginTop:2}}>{g.program}</div>
            {g.history&&g.history.length>0&&<div style={{fontSize:11,color:T.ink3,marginTop:2}}>History: {g.history.join(" · ")}</div>}
          </div>
          <div style={{textAlign:"right"}}>
            <div style={{fontSize:16,fontWeight:800,color:T.ink}}>{fmt(g.amount)}</div>
            {g.status==="active"&&<div style={{fontSize:11,color:T.ink3}}>{pct}% received</div>}
            {g.deadline&&days<=60&&<div style={{fontSize:11,color:days<14?"#ef4444":"#f59e0b",marginTop:2,fontWeight:600}}>{days<0?"Overdue":days+"d left"}</div>}
          </div>
          <Pill label={g.status} color={SC[g.status]}/>
        </div>
        {g.status==="active"&&<div style={{marginTop:10,height:4,background:T.bg3,borderRadius:99}}><div style={{height:"100%",width:`${pct}%`,background:"#1a6b4a",borderRadius:99}}/></div>}
      </Card>;
    })}
    </>}
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
      <button onClick={find} disabled={loading} style={{background:loading?T.bg2:"linear-gradient(135deg,#8b5cf6,#3b82f6)",border:"none",borderRadius:12,padding:"13px 22px",color:"#fff",fontSize:14,fontWeight:700,cursor:loading?"not-allowed":"pointer",display:"flex",alignItems:"center",gap:8,opacity:loading?0.7:1}}>
        {loading?<><Spin/>Scanning grant landscape…</>:"✦ Find Matching Grants"}
      </button>
    </Card>

    {(loading||results)&&<Card style={{background:"linear-gradient(135deg,#0f0c29,#0f172a)",border:"1px solid #1a6b4a44"}}>
      <div style={{fontSize:11,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color:"#8b5cf6",marginBottom:14}}>✦ Grant Matches — Ranked by Alignment</div>
      {loading&&!results&&<div style={{display:"flex",alignItems:"center",gap:10,color:T.ink3,fontSize:13}}><Spin/>Analyzing your org and searching grant landscape…</div>}
      {results&&<div style={{fontSize:13,color:T.ink2,lineHeight:1.85,whiteSpace:"pre-wrap"}}>{results}</div>}
    </Card>}

    {ran&&!loading&&!results&&<div style={{fontSize:13,color:T.ink3,textAlign:"center",padding:20}}>No results yet — try again.</div>}
  </div>;
}
