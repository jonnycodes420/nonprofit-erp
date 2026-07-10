import { useState } from "react";
import { T, askClaude, daysDiff, Pill, Card, AIBtn, AIPanel, MetricCard, EmptyState, PageTitle } from "./shared";
import { apiFetch } from "../api";

export function Volunteers({data, setData, isReadOnly}) {
  const [convPlan,setConvPlan]=useState(""); const [convLoading,setConvLoading]=useState(false);
  const [boardAI,setBoardAI]=useState(""); const [boardLoading,setBoardLoading]=useState(false);
  const [showAdd,setShowAdd]=useState(false);
  const [form,setForm]=useState({name:"",email:"",skills:"",convertPotential:"medium",employer:"",notes:""});
  const [saving,setSaving]=useState(false);

  const getConvPlan=async()=>{
    setConvLoading(true); setConvPlan("");
    await askClaude(`You are a nonprofit development strategist. Specific, tactical. Max 200 words.`,
      `Donor conversion plan for high-potential volunteers.\n\n${data.volunteers.filter(v=>v.convertPotential==="high").map(v=>`${v.name}: ${v.hours}h, skills: ${v.skills.join(",")}, employer: ${v.employer}, notes: ${v.notes}`).join("\n")}\n\nOrg: ${data.org.name} — ${data.org.mission}\n\nFor each: first ask amount, best moment, personal connection point, suggested language.`,
      chunk=>setConvPlan(chunk));
    setConvLoading(false);
  };
  const getBoardCandidates=async()=>{
    setBoardLoading(true); setBoardAI("");
    await askClaude(`You are a nonprofit governance expert. Max 150 words.`,
      `Identify board candidates from these volunteers and explain why.\n\n${data.volunteers.map(v=>`${v.name}: ${v.hours}h, employer: ${v.employer}, skills: ${v.skills.join(",")}, potential: ${v.convertPotential}, notes: ${v.notes}`).join("\n")}\n\nCurrent board: ${data.board.map(b=>`${b.name} (${b.employer}, ${b.role})`).join(", ")}\n\nIdentify gaps in skills/diversity the board needs and which volunteers could fill them.`,
      chunk=>setBoardAI(chunk));
    setBoardLoading(false);
  };

  async function addVolunteer(){
    if(!form.name.trim())return;
    setSaving(true);
    try{
      const skillsArr=form.skills.split(",").map(s=>s.trim()).filter(Boolean);
      const raw=await apiFetch("/volunteers",{method:"POST",body:JSON.stringify({
        name:form.name.trim(),email:form.email.trim(),skills:skillsArr,
        convertPotential:form.convertPotential,employer:form.employer.trim(),notes:form.notes.trim(),
      })});
      const adapted={
        id:raw.id, name:raw.name, email:raw.email||"", hours:raw.hours||0,
        skills:Array.isArray(raw.skills)?raw.skills:JSON.parse(raw.skills||"[]"),
        lastActive:raw.last_active||"", donorId:raw.donor_id||null,
        convertPotential:raw.convert_potential||"medium",
        employer:raw.employer||"", notes:raw.notes||"",
      };
      setData(prev=>({...prev,volunteers:[...prev.volunteers,adapted]}));
      setForm({name:"",email:"",skills:"",convertPotential:"medium",employer:"",notes:""});
      setShowAdd(false);
    }catch(e){alert(e.message||"Failed to add volunteer");}
    setSaving(false);
  }

  const inp={background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"9px 12px",color:T.ink,fontSize:13,outline:"none",width:"100%",boxSizing:"border-box"};

  return <div style={{display:"flex",flexDirection:"column",gap:14}}>
    <PageTitle main="Your" accent="volunteers."/>
    <div className="vol-metric-grid" style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12}}>
      <MetricCard label="Total Volunteers" value={data.volunteers.length} sub={`${data.volunteers.reduce((s,v)=>s+v.hours,0)} total hours`} color="#8b5cf6"/>
      <MetricCard label="High Convert Potential" value={data.volunteers.filter(v=>v.convertPotential==="high").length} sub="ready to cultivate" color="#f59e0b"/>
      <MetricCard label="Converted" value={data.volunteers.filter(v=>v.convertPotential==="converted").length} sub="volunteer → donor" color="#1a6b4a"/>
    </div>
    <div style={{display:"flex",gap:10,flexWrap:"wrap",alignItems:"center"}}>
      <AIBtn onClick={getConvPlan} loading={convLoading} label="✦ Volunteer-to-Donor Conversion Plan"/>
      <AIBtn onClick={getBoardCandidates} loading={boardLoading} label="✦ Identify Board Candidates"/>
      <button onClick={()=>setShowAdd(v=>!v)} disabled={isReadOnly} title={isReadOnly?"Reactivate your subscription to make changes.":undefined}
        style={{marginLeft:"auto",background:"#1a6b4a",color:"#fff",border:"none",borderRadius:8,padding:"8px 16px",fontSize:13,fontWeight:700,cursor:isReadOnly?"not-allowed":"pointer",opacity:isReadOnly?0.45:1}}>
        + Add Volunteer
      </button>
    </div>
    {(convLoading||convPlan)&&<AIPanel text={convPlan} onClose={()=>setConvPlan("")}/>}
    {(boardLoading||boardAI)&&<AIPanel text={boardAI} onClose={()=>setBoardAI("")}/>}
    {showAdd&&<Card>
      <div style={{fontSize:14,fontWeight:700,color:T.ink,marginBottom:14}}>New Volunteer</div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
        <input placeholder="Full name *" value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} style={inp}/>
        <input placeholder="Email" type="email" value={form.email} onChange={e=>setForm(f=>({...f,email:e.target.value}))} style={inp}/>
        <input placeholder="Skills (comma-separated)" value={form.skills} onChange={e=>setForm(f=>({...f,skills:e.target.value}))} style={inp}/>
        <input placeholder="Employer / Organization" value={form.employer} onChange={e=>setForm(f=>({...f,employer:e.target.value}))} style={inp}/>
        <select value={form.convertPotential} onChange={e=>setForm(f=>({...f,convertPotential:e.target.value}))} style={{...inp,cursor:"pointer"}}>
          <option value="low">Low conversion potential</option>
          <option value="medium">Medium conversion potential</option>
          <option value="high">High conversion potential</option>
          <option value="converted">Already a donor</option>
        </select>
      </div>
      <textarea placeholder="Notes (optional)" value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} rows={2} style={{...inp,marginTop:10,resize:"vertical"}}/>
      <div style={{display:"flex",gap:8,marginTop:12}}>
        <button onClick={addVolunteer} disabled={saving||!form.name.trim()}
          style={{background:"#1a6b4a",color:"#fff",border:"none",borderRadius:8,padding:"9px 18px",fontSize:13,fontWeight:700,cursor:saving?"not-allowed":"pointer",opacity:saving?0.7:1}}>
          {saving?"Saving…":"Save Volunteer"}
        </button>
        <button onClick={()=>setShowAdd(false)}
          style={{background:"transparent",color:T.ink3,border:"1px solid "+T.bg3,borderRadius:8,padding:"9px 14px",fontSize:13,cursor:"pointer"}}>
          Cancel
        </button>
      </div>
    </Card>}
    {data.volunteers.length===0&&!showAdd&&<EmptyState icon="◎" title="No volunteers yet" message="Add volunteers to track hours, skills, and conversion potential."/>}
    {data.volunteers.map(v=>{
      const cc=v.convertPotential==="high"?"#f59e0b":v.convertPotential==="converted"?"#1a6b4a":"#6b7280";
      return <Card key={v.id}>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <div style={{width:42,height:42,borderRadius:"50%",background:cc+"33",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,fontWeight:800,color:cc,flexShrink:0}}>{v.name[0]}</div>
          <div style={{flex:1}}>
            <div style={{fontSize:15,fontWeight:700,color:T.ink}}>{v.name}</div>
            <div style={{fontSize:12,color:T.ink3,marginTop:1}}>{v.employer}{v.employer&&v.email?" · ":""}{v.email}</div>
            <div style={{display:"flex",gap:4,marginTop:5,flexWrap:"wrap"}}>{v.skills.map(s=><Pill key={s} label={s} color="#8b5cf6"/>)}</div>
          </div>
          <div style={{textAlign:"right",flexShrink:0}}>
            <div style={{fontSize:20,fontWeight:800,color:cc,fontFamily:"'DM Serif Display',serif"}}>{v.hours}h</div>
            {v.lastActive&&<div style={{fontSize:11,color:T.ink3,marginTop:1}}>{daysDiff(v.lastActive)}d ago</div>}
            <div style={{marginTop:4}}><Pill label={v.convertPotential==="converted"?"donor":`${v.convertPotential} potential`} color={cc}/></div>
          </div>
        </div>
        {v.notes&&<div style={{marginTop:12,background:T.bg,borderRadius:8,padding:"9px 12px",fontSize:12,color:T.ink3,lineHeight:1.5}}>{v.notes}</div>}
      </Card>;
    })}
  </div>;
}
