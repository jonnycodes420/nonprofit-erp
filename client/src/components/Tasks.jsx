import { useState } from "react";
import { T, SC, askClaude, daysUntil, Pill, Card, AIBtn, AIPanel, EmptyState, PageTitle } from "./shared";

export function Tasks({data,setData,isReadOnly}) {
  const [showAdd,setShowAdd]=useState(false);
  const [newTask,setNewTask]=useState({title:"",due:"",priority:"medium",type:"donor"});
  const [prioAI,setPrioAI]=useState(""); const [prioLoading,setPrioLoading]=useState(false);

  const toggle=id=>setData(prev=>({...prev,tasks:prev.tasks.map(t=>t.id===id?{...t,done:!t.done}:t)}));
  const addTask=()=>{
    if(!newTask.title) return;
    setData(prev=>({...prev,tasks:[...prev.tasks,{...newTask,id:Date.now(),done:false}]}));
    setShowAdd(false); setNewTask({title:"",due:"",priority:"medium",type:"donor"});
  };
  const prioritize=async()=>{
    setPrioLoading(true); setPrioAI("");
    await askClaude(`You are a nonprofit development officer. Tactical. Max 180 words.`,
      `Prioritize these tasks for this week. For each, explain the specific reason and urgency.\n\n${data.tasks.filter(t=>!t.done).map(t=>`[${t.priority}] ${t.title} — due ${t.due}`).join("\n")}\n\nContext: ${data.org.name}, active grant deadlines, lapsed donors needing attention, Q2 board packet due soon.`,
      chunk=>setPrioAI(chunk));
    setPrioLoading(false);
  };

  const pending=data.tasks.filter(t=>!t.done).sort((a,b)=>({high:0,medium:1,low:2}[a.priority]-{high:0,medium:1,low:2}[b.priority]));
  const done=data.tasks.filter(t=>t.done);

  return <div style={{display:"flex",flexDirection:"column",gap:12}}>
    <PageTitle main="Open" accent="tasks."/>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8}}>
      <div style={{display:"flex",gap:8}}>
        <AIBtn onClick={prioritize} loading={prioLoading} label="✦ Prioritize"/>
        <button onClick={()=>setShowAdd(true)} disabled={isReadOnly} title={isReadOnly?"Reactivate your subscription to make changes.":undefined} style={{background:"#10b981",border:"none",borderRadius:10,padding:"9px 14px",color:"#fff",fontSize:13,fontWeight:600,cursor:isReadOnly?"not-allowed":"pointer",opacity:isReadOnly?0.45:1}}>+ Add</button>
      </div>
      <div style={{fontSize:12,color:T.ink3}}>{pending.length} open · {done.length} done</div>
    </div>
    {(prioLoading||prioAI)&&<AIPanel text={prioAI} onClose={()=>setPrioAI("")}/>}
    {showAdd&&<Card style={{flexDirection:"column",display:"flex",gap:10}}>
      <input value={newTask.title} onChange={e=>setNewTask(p=>({...p,title:e.target.value}))} placeholder="Task title" style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"9px 12px",color:T.ink,fontSize:13,outline:"none"}}/>
      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
        <input type="date" value={newTask.due} onChange={e=>setNewTask(p=>({...p,due:e.target.value}))} style={{flex:1,background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"9px 12px",color:T.ink3,fontSize:13,outline:"none"}}/>
        {[["priority",["high","medium","low"]],["type",["donor","grant","board","volunteer","finance"]]].map(([k,opts])=>
          <select key={k} value={newTask[k]} onChange={e=>setNewTask(p=>({...p,[k]:e.target.value}))} style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"9px 10px",color:T.ink3,fontSize:13,outline:"none"}}>
            {opts.map(o=><option key={o} value={o}>{o}</option>)}
          </select>)}
      </div>
      <div style={{display:"flex",gap:8}}>
        <button onClick={addTask} style={{background:"#10b981",border:"none",borderRadius:8,padding:"8px 14px",color:"#fff",fontSize:13,fontWeight:600,cursor:"pointer"}}>Save</button>
        <button onClick={()=>setShowAdd(false)} style={{background:T.bg,border:"none",borderRadius:8,padding:"8px 14px",color:T.ink3,fontSize:13,cursor:"pointer"}}>Cancel</button>
      </div>
    </Card>}
    {pending.length===0&&!prioAI&&<EmptyState icon="◻" title="All tasks complete" message="Nothing pending. Add a new task to stay organized."/>}
    {pending.map(t=>{
      const overdue=t.due&&daysUntil(t.due)<0;
      return <div key={t.id} onClick={()=>toggle(t.id)} style={{background:T.white,border:`1px solid ${overdue?"#ef444430":T.bg2}`,borderRadius:12,padding:"12px 16px",cursor:"pointer",display:"flex",alignItems:"center",gap:12,transition:"border-color 0.15s"}}>
        <div style={{width:20,height:20,borderRadius:6,border:`2px solid ${SC[t.priority]}`,flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",transition:"background 0.12s"}}/>
        <div style={{flex:1}}>
          <div style={{fontSize:13,color:T.ink,fontWeight:500,lineHeight:1.35}}>{t.title}</div>
          {t.due&&<div style={{fontSize:11,color:overdue?"#ef4444":"#6b7280",marginTop:2,fontWeight:overdue?700:400}}>
            {overdue?`Overdue — was due `:"Due "}{new Date(t.due).toLocaleDateString("en-US",{month:"short",day:"numeric"})}
          </div>}
        </div>
        <div style={{display:"flex",gap:5,flexShrink:0}}><Pill label={t.priority} color={SC[t.priority]}/><Pill label={t.type} color="#4b5563"/></div>
      </div>;
    })}
    {done.length>0&&<>
      <div style={{fontSize:10,fontWeight:700,color:T.bg2,textTransform:"uppercase",letterSpacing:"0.1em",marginTop:8,paddingTop:8,borderTop:"1px solid #0e1624"}}>Completed · {done.length}</div>
      {done.map(t=><div key={t.id} onClick={()=>toggle(t.id)} style={{background:T.white,border:"1px solid #0e1624",borderRadius:12,padding:"10px 16px",cursor:"pointer",display:"flex",alignItems:"center",gap:12,opacity:0.4}}>
        <div style={{width:20,height:20,borderRadius:6,background:"#10b981",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center"}}><span style={{fontSize:10,color:"#fff",fontWeight:700}}>✓</span></div>
        <div style={{fontSize:13,color:T.ink3,textDecoration:"line-through",flex:1}}>{t.title}</div>
      </div>)}
    </>}
  </div>;
}
