import { useState } from "react";
import { T, askClaude, daysDiff, Pill, Card, AIBtn, AIPanel, MetricCard, EmptyState, PageTitle } from "./shared";

export function Volunteers({data}) {
  const [convPlan,setConvPlan]=useState(""); const [convLoading,setConvLoading]=useState(false);
  const [boardAI,setBoardAI]=useState(""); const [boardLoading,setBoardLoading]=useState(false);

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

  return <div style={{display:"flex",flexDirection:"column",gap:14}}>
    <PageTitle main="Your" accent="volunteers."/>
    <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12}}>
      <MetricCard label="Total Volunteers" value={data.volunteers.length} sub={`${data.volunteers.reduce((s,v)=>s+v.hours,0)} total hours`} color="#8b5cf6"/>
      <MetricCard label="High Convert Potential" value={data.volunteers.filter(v=>v.convertPotential==="high").length} sub="ready to cultivate" color="#f59e0b"/>
      <MetricCard label="Converted" value={data.volunteers.filter(v=>v.convertPotential==="converted").length} sub="volunteer → donor" color="#10b981"/>
    </div>
    <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
      <AIBtn onClick={getConvPlan} loading={convLoading} label="✦ Volunteer-to-Donor Conversion Plan"/>
      <AIBtn onClick={getBoardCandidates} loading={boardLoading} label="✦ Identify Board Candidates"/>
    </div>
    {(convLoading||convPlan)&&<AIPanel text={convPlan} onClose={()=>setConvPlan("")}/>}
    {(boardLoading||boardAI)&&<AIPanel text={boardAI} onClose={()=>setBoardAI("")}/>}
    {data.volunteers.length===0&&<EmptyState icon="◎" title="No volunteers yet" message="Add volunteers to track hours, skills, and conversion potential."/>}
    {data.volunteers.map(v=>{
      const cc=v.convertPotential==="high"?"#f59e0b":v.convertPotential==="converted"?"#10b981":"#6b7280";
      return <Card key={v.id}>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <div style={{width:42,height:42,borderRadius:"50%",background:cc+"33",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,fontWeight:800,color:cc,flexShrink:0}}>{v.name[0]}</div>
          <div style={{flex:1}}>
            <div style={{fontSize:15,fontWeight:700,color:T.ink}}>{v.name}</div>
            <div style={{fontSize:12,color:T.ink3,marginTop:1}}>{v.employer} · {v.email}</div>
            <div style={{display:"flex",gap:4,marginTop:5,flexWrap:"wrap"}}>{v.skills.map(s=><Pill key={s} label={s} color="#8b5cf6"/>)}</div>
          </div>
          <div style={{textAlign:"right",flexShrink:0}}>
            <div style={{fontSize:20,fontWeight:800,color:cc,fontFamily:"'DM Serif Display',serif"}}>{v.hours}h</div>
            <div style={{fontSize:11,color:T.ink3,marginTop:1}}>{daysDiff(v.lastActive)}d ago</div>
            <div style={{marginTop:4}}><Pill label={v.convertPotential==="converted"?"donor":`${v.convertPotential} potential`} color={cc}/></div>
          </div>
        </div>
        {v.notes&&<div style={{marginTop:12,background:T.bg,borderRadius:8,padding:"9px 12px",fontSize:12,color:T.ink3,lineHeight:1.5}}>{v.notes}</div>}
      </Card>;
    })}
  </div>;
}
