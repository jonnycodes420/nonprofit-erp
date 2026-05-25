import { useState } from "react";
import { T, fmt, fmtFull, askClaude, Pill, Card, AIBtn, AIPanel, MetricCard, EmptyState, PageTitle } from "./shared";

export function Board({data}) {
  const [boardBrief,setBoardBrief]=useState(""); const [briefLoading,setBriefLoading]=useState(false);
  const [boardEmail,setBoardEmail]=useState(""); const [emailLoading,setEmailLoading]=useState(false);
  const totalGiving=data.board.reduce((s,b)=>s+parseInt(b.givingLevel.replace(/[$,]/g,"")),0);
  const avgAttendance=Math.round(data.board.reduce((s,b)=>s+b.attendance,0)/data.board.length);

  const generateBrief=async()=>{
    setBriefLoading(true); setBoardBrief("");
    const rev=data.financials.revenue; const exp=data.financials.expenses;
    const ytdRev=rev.reduce((s,r)=>s+r.individual+r.grants+r.events+r.other,0);
    const ytdExp=exp.reduce((s,e)=>s+e.programs+e.admin+e.fundraising,0);
    await askClaude(`You are a nonprofit ED writing a board report. Professional, concise, specific. Max 250 words.`,
      `Generate a Q2 board briefing for ${data.org.name}.\n\nFinancials: YTD Revenue ${fmtFull(ytdRev)}, Expenses ${fmtFull(ytdExp)}, Net ${fmtFull(ytdRev-ytdExp)}\nFund balances: ${data.financials.funds.map(f=>`${f.name}: ${fmtFull(f.balance)}`).join(", ")}\nActive grants: ${data.grants.filter(g=>g.status==="active").map(g=>`${g.funder} ${fmtFull(g.amount)}`).join(", ")}\nGrant pipeline: ${data.grants.filter(g=>["pending","prospecting"].includes(g.status)).map(g=>`${g.funder} ${fmtFull(g.amount)} [${g.status}]`).join(", ")}\nDonor highlights: ${data.donors.filter(d=>d.status==="major").map(d=>`${d.name} ${fmtFull(d.total)}`).join(", ")}\nOpen tasks: ${data.tasks.filter(t=>!t.done&&t.priority==="high").map(t=>t.title).join("; ")}\n\nFormat: Financial Snapshot, Development Highlights, Grant Update, Action Items for Board`,
      chunk=>setBoardBrief(chunk));
    setBriefLoading(false);
  };

  const draftEmail=async()=>{
    setEmailLoading(true); setBoardEmail("");
    await askClaude(`You are an executive director. Professional, warm, brief. Max 200 words.`,
      `Draft a board member engagement email asking for introductions to potential donors.\nOrg: ${data.org.name} — ${data.org.mission}\nBoard giving: ${fmtFull(totalGiving)} total\n\nAsk board members to make 2-3 introductions to people in their network who care about arts education and youth development in NYC. Include a specific example of program impact.`,
      chunk=>setBoardEmail(chunk));
    setEmailLoading(false);
  };

  return <div style={{display:"flex",flexDirection:"column",gap:16}}>
    <PageTitle main="Board" accent="management."/>
    <div className="board-metric-grid" style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12}}>
      <MetricCard label="Board Members" value={data.board.length} sub={`${avgAttendance}% avg attendance`} color="#3b82f6"/>
      <MetricCard label="Board Giving" value={fmt(totalGiving)} sub="100% board participation" color="#1a6b4a"/>
      <MetricCard label="Committees" value={[...new Set(data.board.flatMap(b=>b.committees))].length} sub="active committees" color="#8b5cf6"/>
    </div>
    <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
      <AIBtn onClick={generateBrief} loading={briefLoading} label="✦ Generate Q2 Board Report"/>
      <AIBtn onClick={draftEmail} loading={emailLoading} label="✦ Draft Board Ask Email"/>
    </div>
    {(briefLoading||boardBrief)&&<AIPanel text={boardBrief} onClose={()=>setBoardBrief("")}/>}
    {(emailLoading||boardEmail)&&<AIPanel text={boardEmail} onClose={()=>setBoardEmail("")}/>}
    {data.board.length===0&&<EmptyState icon="◆" title="No board members yet" message="Track your board's giving, attendance, committees, and terms."/>}
    {data.board.map(b=>{
      const attColor=b.attendance>=90?"#1a6b4a":b.attendance>=75?"#f59e0b":"#ef4444";
      return <Card key={b.id}>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <div style={{width:42,height:42,borderRadius:"50%",background:"#3b82f633",display:"flex",alignItems:"center",justifyContent:"center",fontSize:15,fontWeight:800,color:"#3b82f6",flexShrink:0}}>{b.name[0]}</div>
          <div style={{flex:1}}>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <div style={{fontSize:15,fontWeight:700,color:T.ink}}>{b.name}</div>
              <Pill label={b.role} color="#3b82f6"/>
            </div>
            <div style={{fontSize:12,color:T.ink3,marginTop:1}}>{b.employer}</div>
            <div style={{display:"flex",gap:4,marginTop:5,flexWrap:"wrap"}}>{b.committees.map(c=><Pill key={c} label={c} color="#6b7280"/>)}</div>
          </div>
          <div style={{textAlign:"right",flexShrink:0}}>
            <div style={{fontSize:15,fontWeight:800,color:"#1a6b4a"}}>{b.givingLevel}</div>
            <div style={{fontSize:11,color:attColor,marginTop:3,fontWeight:600}}>{b.attendance}% attendance</div>
            <div style={{fontSize:11,color:T.ink3,marginTop:1}}>Term: {b.term}</div>
          </div>
        </div>
      </Card>;
    })}
  </div>;
}
