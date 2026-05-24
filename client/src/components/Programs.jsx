import { useState, useEffect } from "react";
import { T, fmt, fmtFull, askClaude, Pill, Card, AIBtn, AIPanel, SectionLabel, PageTitle } from "./shared";
import { apiFetch } from "../api";
import { useAuth } from "../main";

export function Programs({data}) {
  const {auth}=useAuth(); const isAdmin=auth?.user?.role==="admin";
  const [programs,setPrograms]=useState([]); const [loading,setLoading]=useState(true);
  const [selected,setSelected]=useState(null); const [showAdd,setShowAdd]=useState(false);
  const [aiMap,setAiMap]=useState({}); const [aiLoading,setAiLoading]=useState(null);
  const [form,setForm]=useState({name:"",description:"",budget:"",spent:"",staff:"",participantCount:"",startDate:"",endDate:"",status:"active",outcomes:""});
  const [linkGrant,setLinkGrant]=useState({programId:null,grantId:"",allocated:""});

  const load=async()=>{try{setPrograms(await apiFetch("/programs"));}catch{}setLoading(false);};
  useEffect(()=>{load();},[]);

  const save=async()=>{
    const body={name:form.name,description:form.description,budget:parseInt(form.budget)||0,spent:parseInt(form.spent)||0,
      staff:JSON.stringify(form.staff.split(",").map(s=>s.trim()).filter(Boolean)),participantCount:parseInt(form.participantCount)||0,
      startDate:form.startDate,endDate:form.endDate,status:form.status,outcomes:form.outcomes,metrics:{}};
    try{await apiFetch("/programs",{method:"POST",body:JSON.stringify(body)});await load();setShowAdd(false);
      setForm({name:"",description:"",budget:"",spent:"",staff:"",participantCount:"",startDate:"",endDate:"",status:"active",outcomes:""});}
    catch(e){alert(e.message);}
  };

  const addGrantLink=async(programId)=>{
    try{await apiFetch(`/programs/${programId}/grants`,{method:"POST",body:JSON.stringify({grantId:linkGrant.grantId,allocated:parseInt(linkGrant.allocated)||0})});
      await load();setLinkGrant({programId:null,grantId:"",allocated:""});}
    catch(e){alert(e.message);}
  };

  const removeGrantLink=async(programId,grantId)=>{
    try{await apiFetch(`/programs/${programId}/grants/${grantId}`,{method:"DELETE"});await load();}
    catch(e){alert(e.message);}
  };

  const getAI=async(p,type)=>{
    const key=`${p.id}_${type}`;setAiLoading(key);setAiMap(m=>({...m,[key]:""}));
    const staff=Array.isArray(p.staff)?p.staff:JSON.parse(p.staff||"[]");
    const metrics=typeof p.metrics==="string"?JSON.parse(p.metrics||"{}"):p.metrics||{};
    const sys=`You are a nonprofit program evaluation expert. Impact-focused, specific. Max 250 words.`;
    const prompt=type==="impact"
      ?`Write an impact narrative for a grant report.\n\nProgram: ${p.name}\nDesc: ${p.description}\nBudget: ${fmtFull(p.budget)} | Spent: ${fmtFull(p.spent)} | Participants: ${p.participant_count}\nStaff: ${staff.join(", ")}\nDates: ${p.start_date} — ${p.end_date}\nOutcomes: ${p.outcomes}\nMetrics: ${JSON.stringify(metrics)}\nOrg: ${data.org.name} — ${data.org.mission}\n\nLead with the most powerful outcome. Include specific numbers and connect to org mission.`
      :`Write a theory of change for this program.\n\nProgram: ${p.name}\nDesc: ${p.description}\nOutcomes: ${p.outcomes}\nOrg: ${data.org.name} — ${data.org.mission}\n\nFormat: Activities → Outputs → Outcomes → Long-term Impact. Be specific and measurable.`;
    await askClaude(sys,prompt,chunk=>setAiMap(m=>({...m,[key]:chunk})));
    setAiLoading(null);
  };

  const Inp=({label,k,type="text",ph=""})=>(
    <div style={{display:"flex",flexDirection:"column",gap:4}}>
      <label style={{fontSize:11,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.06em"}}>{label}</label>
      <input type={type} value={form[k]} onChange={e=>setForm(f=>({...f,[k]:e.target.value}))} placeholder={ph}
        style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"9px 12px",color:T.ink,fontSize:13,outline:"none"}}/>
    </div>
  );

  return <div style={{display:"flex",flexDirection:"column",gap:16}}>
    <PageTitle main="Your" accent="programs."/>
    <button onClick={()=>setShowAdd(!showAdd)} style={{alignSelf:"flex-start",background:"#10b981",border:"none",borderRadius:10,padding:"10px 16px",color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer"}}>+ New Program</button>

    {showAdd&&<Card style={{display:"flex",flexDirection:"column",gap:12}}>
      <SectionLabel>New Program</SectionLabel>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
        <Inp label="Program Name" k="name" ph="After-School Arts"/>
        <div style={{display:"flex",flexDirection:"column",gap:4}}>
          <label style={{fontSize:11,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.06em"}}>Status</label>
          <select value={form.status} onChange={e=>setForm(f=>({...f,status:e.target.value}))} style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"9px 12px",color:T.ink,fontSize:13}}>
            {["active","planning","completed","paused"].map(s=><option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <Inp label="Budget ($)" k="budget" type="number" ph="85000"/>
        <Inp label="Spent ($)" k="spent" type="number" ph="52000"/>
        <Inp label="Participants" k="participantCount" type="number" ph="120"/>
        <Inp label="Staff (comma-separated)" k="staff" ph="Carlos Mendez, Sophie Laurent"/>
        <Inp label="Start Date" k="startDate" type="date"/>
        <Inp label="End Date" k="endDate" type="date"/>
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:4}}>
        <label style={{fontSize:11,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.06em"}}>Description</label>
        <textarea value={form.description} onChange={e=>setForm(f=>({...f,description:e.target.value}))} rows={2}
          style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"9px 12px",color:T.ink,fontSize:13,outline:"none",resize:"vertical",fontFamily:"inherit"}}/>
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:4}}>
        <label style={{fontSize:11,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.06em"}}>Outcomes</label>
        <textarea value={form.outcomes} onChange={e=>setForm(f=>({...f,outcomes:e.target.value}))} rows={2}
          style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"9px 12px",color:T.ink,fontSize:13,outline:"none",resize:"vertical",fontFamily:"inherit"}}/>
      </div>
      <div style={{display:"flex",gap:8}}>
        <button onClick={save} style={{background:"#10b981",border:"none",borderRadius:8,padding:"9px 16px",color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer"}}>Save Program</button>
        <button onClick={()=>setShowAdd(false)} style={{background:T.bg,border:"none",borderRadius:8,padding:"9px 14px",color:T.ink3,fontSize:13,cursor:"pointer"}}>Cancel</button>
      </div>
    </Card>}

    {loading?<div style={{color:T.ink3,fontSize:13,textAlign:"center",padding:40}}>Loading programs…</div>:
      programs.length===0?<Card><div style={{color:T.ink3,fontSize:13,textAlign:"center",padding:20}}>No programs yet. Add your first program above.</div></Card>:
      programs.map(p=>{
        const isOpen=selected?.id===p.id;
        const staff=Array.isArray(p.staff)?p.staff:JSON.parse(p.staff||"[]");
        const metrics=typeof p.metrics==="string"?JSON.parse(p.metrics||"{}"):p.metrics||{};
        const grants=p.grants||[];
        const pct=p.budget>0?Math.round(p.spent/p.budget*100):0;
        const totalAllocated=grants.reduce((s,g)=>s+g.allocated,0);
        const statusColor={active:"#1a6b4a",planning:"#3b82f6",completed:"#6b7280",paused:"#f59e0b"}[p.status]||"#6b7280";
        return <Card key={p.id} selected={isOpen} accent={statusColor} onClick={()=>setSelected(isOpen?null:p)}>
          <div style={{display:"flex",alignItems:"flex-start",gap:14}}>
            <div style={{flex:1}}>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
                <div style={{fontSize:15,fontWeight:700,color:T.ink}}>{p.name}</div>
                <Pill label={p.status} color={statusColor}/>
              </div>
              <div style={{fontSize:12,color:T.ink3,lineHeight:1.5}}>{p.description?.slice(0,100)}{p.description?.length>100?"…":""}</div>
            </div>
            <div style={{textAlign:"right",flexShrink:0}}>
              <div style={{fontSize:14,fontWeight:700,color:T.ink}}>{fmt(p.budget)}</div>
              <div style={{fontSize:11,color:pct>90?"#ef4444":"#6b7280"}}>{pct}% spent</div>
            </div>
          </div>
          <div style={{marginTop:10,height:4,background:T.bg3,borderRadius:99}}>
            <div style={{height:"100%",width:`${Math.min(pct,100)}%`,background:pct>90?"#ef4444":pct>70?"#f59e0b":"#1a6b4a",borderRadius:99}}/>
          </div>
          <div style={{display:"flex",gap:16,marginTop:10}}>
            <span style={{fontSize:11,color:T.ink3}}>{p.participant_count} participants</span>
            {staff.length>0&&<span style={{fontSize:11,color:T.ink3}}>Staff: {staff.join(", ")}</span>}
            {grants.length>0&&<span style={{fontSize:11,color:"#8b5cf6"}}>{fmt(totalAllocated)} grant-funded</span>}
          </div>
          {isOpen&&<div style={{marginTop:14,paddingTop:14,borderTop:"1px solid "+T.bg3}}>
            {p.outcomes&&<div style={{marginBottom:12}}>
              <div style={{fontSize:10,fontWeight:700,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:6}}>Outcomes</div>
              <div style={{fontSize:13,color:T.ink3,lineHeight:1.65}}>{p.outcomes}</div>
            </div>}
            {Object.keys(metrics).length>0&&<div style={{marginBottom:12}}>
              <div style={{fontSize:10,fontWeight:700,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:6}}>Metrics</div>
              <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
                {Object.entries(metrics).map(([k,v])=><div key={k} style={{background:T.bg3,borderRadius:8,padding:"6px 10px"}}>
                  <div style={{fontSize:10,color:T.ink3}}>{k.replace(/_/g," ")}</div>
                  <div style={{fontSize:13,color:T.ink,fontWeight:600}}>{String(v)}</div>
                </div>)}
              </div>
            </div>}
            <div style={{marginBottom:12}}>
              <div style={{fontSize:10,fontWeight:700,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:6}}>Grant Funding</div>
              {grants.map(g=><div key={g.grant_id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"6px 0",borderBottom:"1px solid "+T.bg2,fontSize:12}}>
                <span style={{color:T.ink}}>{g.funder} — {g.program_name}</span>
                <div style={{display:"flex",gap:8,alignItems:"center"}}>
                  <span style={{color:"#8b5cf6",fontWeight:600}}>{fmt(g.allocated)}</span>
                  {isAdmin&&<button onClick={e=>{e.stopPropagation();removeGrantLink(p.id,g.grant_id);}} style={{background:"transparent",border:"none",color:"#ef4444",cursor:"pointer",fontSize:14,lineHeight:1}}>×</button>}
                </div>
              </div>)}
              {isAdmin&&linkGrant.programId!==p.id&&<button onClick={e=>{e.stopPropagation();setLinkGrant({programId:p.id,grantId:"",allocated:""});}}
                style={{marginTop:8,background:"transparent",border:"1px dashed "+T.bg3,borderRadius:8,padding:"6px 12px",color:T.ink3,fontSize:12,cursor:"pointer"}}>+ Link Grant</button>}
              {isAdmin&&linkGrant.programId===p.id&&<div style={{display:"flex",gap:8,marginTop:8,alignItems:"flex-end"}} onClick={e=>e.stopPropagation()}>
                <select value={linkGrant.grantId} onChange={e=>setLinkGrant(l=>({...l,grantId:e.target.value}))}
                  style={{flex:1,background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"8px 10px",color:T.ink,fontSize:12}}>
                  <option value="">Select grant…</option>
                  {data.grants.map(g=><option key={g.id} value={g.id}>{g.funder} — {g.program}</option>)}
                </select>
                <input type="number" placeholder="Allocated $" value={linkGrant.allocated} onChange={e=>setLinkGrant(l=>({...l,allocated:e.target.value}))}
                  style={{width:110,background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"8px 10px",color:T.ink,fontSize:12,outline:"none"}}/>
                <button onClick={()=>addGrantLink(p.id)} style={{background:"#8b5cf6",border:"none",borderRadius:8,padding:"8px 12px",color:"#fff",fontSize:12,fontWeight:700,cursor:"pointer"}}>Link</button>
                <button onClick={e=>{e.stopPropagation();setLinkGrant({programId:null,grantId:"",allocated:""});}} style={{background:T.bg,border:"none",borderRadius:8,padding:"8px 10px",color:T.ink3,fontSize:12,cursor:"pointer"}}>✕</button>
              </div>}
            </div>
            <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
              <AIBtn onClick={e=>{e.stopPropagation();getAI(p,"impact");}} loading={aiLoading===`${p.id}_impact`} label="✦ Impact Report" small/>
              <AIBtn onClick={e=>{e.stopPropagation();getAI(p,"toc");}} loading={aiLoading===`${p.id}_toc`} label="✦ Theory of Change" small/>
            </div>
            {["impact","toc"].map(t=>aiMap[`${p.id}_${t}`]?<AIPanel key={t} text={aiMap[`${p.id}_${t}`]} onClose={()=>setAiMap(m=>({...m,[`${p.id}_${t}`]:""}))}/>:null)}
          </div>}
        </Card>;
      })}
  </div>;
}
