import { useState, useEffect } from "react";
import { T, fmt, fmtFull, askClaude, Card, AIBtn, AIPanel, MetricCard, SectionLabel, PageTitle } from "./shared";
import { apiFetch } from "../api";
import { useAuth } from "../main";

export function AnnualFund({data}) {
  const {auth}=useAuth(); const isAdmin=auth?.user?.role==="admin";
  const currentYear=new Date().getFullYear();
  const [year,setYear]=useState(currentYear); const [fund,setFund]=useState(null); const [loading,setLoading]=useState(true);
  const [editGoal,setEditGoal]=useState(false); const [goalInput,setGoalInput]=useState("");
  const [aiText,setAiText]=useState(""); const [aiLoading,setAiLoading]=useState(false);

  const load=async(y=year)=>{setLoading(true);try{setFund(await apiFetch(`/annual-fund?year=${y}`));}catch{}setLoading(false);};
  useEffect(()=>{load();},[]);

  const saveGoal=async()=>{
    try{await apiFetch("/annual-fund/goal",{method:"POST",body:JSON.stringify({year,goal:parseInt(goalInput)||0})});
      await load();setEditGoal(false);}
    catch(e){alert(e.message);}
  };

  const getForecast=async()=>{
    setAiLoading(true);setAiText("");
    await askClaude(`You are a nonprofit development strategist. Data-driven, actionable. Max 250 words.`,
      `Annual fund forecast and strategy for ${data.org.name}.\n\nYear: ${year}\nGoal: ${fund?.goal?fmtFull(fund.goal):"not set"}\nRaised so far: ${fmtFull(fund?.totalRaised||0)}\nGoal progress: ${fund?.goalPct||0}%\nProjected year-end: ${fmtFull(fund?.projectedTotal||0)}\nDonors this year: ${fund?.donors?.total||0} (${fund?.donors?.acquired||0} new, ${fund?.donors?.retained||0} retained)\nRetention rate: ${fund?.donors?.retentionRate||0}%\nAvg gift: ${fmtFull(fund?.avgGift||0)}\nRecovered lapsed donors: ${fund?.recovered||0}\nMonthly: ${(fund?.monthly||[]).map(m=>`${m.month}: ${fmt(m.raised)}`).join(", ")}\n\nProvide:\n1. Forecast — will we hit goal? What's the gap?\n2. Top 2-3 strategies to close any gap before year-end\n3. What the retention rate signals\n4. One bold move to consider`,
      chunk=>setAiText(chunk));
    setAiLoading(false);
  };

  const maxMonth=Math.max(...(fund?.monthly||[{raised:1}]).map(m=>m.raised),1);

  return <div style={{display:"flex",flexDirection:"column",gap:16}}>
    <PageTitle main="Annual" accent="fund."/>
    <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
      <div style={{display:"flex",gap:6}}>
        {[currentYear-1,currentYear].map(y2=><button key={y2} onClick={()=>{setYear(y2);load(y2);}}
          style={{background:year===y2?"#10b981":"transparent",border:year===y2?"none":"1px solid #374151",borderRadius:8,padding:"7px 14px",color:year===y2?"#fff":T.ink3,fontSize:12,fontWeight:year===y2?700:400,cursor:"pointer"}}>{y2}</button>)}
      </div>
      <AIBtn onClick={getForecast} loading={aiLoading} label="✦ AI Forecast" small/>
      {isAdmin&&<button onClick={()=>{setEditGoal(!editGoal);setGoalInput(fund?.goal?.toString()||"");}}
        style={{background:"transparent",border:"1px solid "+T.bg3,borderRadius:8,padding:"7px 12px",color:T.ink3,fontSize:12,cursor:"pointer"}}>⚙ Set Goal</button>}
    </div>

    {editGoal&&isAdmin&&<Card style={{display:"flex",gap:10,alignItems:"flex-end"}}>
      <div style={{display:"flex",flexDirection:"column",gap:4,flex:1}}>
        <label style={{fontSize:11,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.06em"}}>Annual Fund Goal {year}</label>
        <input type="number" value={goalInput} onChange={e=>setGoalInput(e.target.value)} placeholder="250000"
          style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"9px 12px",color:T.ink,fontSize:13,outline:"none"}}/>
      </div>
      <button onClick={saveGoal} style={{background:"#10b981",border:"none",borderRadius:8,padding:"10px 16px",color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer"}}>Save</button>
      <button onClick={()=>setEditGoal(false)} style={{background:T.bg,border:"none",borderRadius:8,padding:"10px 12px",color:T.ink3,fontSize:13,cursor:"pointer"}}>Cancel</button>
    </Card>}

    {(aiLoading||aiText)&&<AIPanel text={aiText} onClose={()=>setAiText("")}/>}

    {loading?<div style={{color:T.ink3,fontSize:13,textAlign:"center",padding:60}}>Loading annual fund data…</div>:!fund?null:<>
      <Card>
        <div style={{display:"flex",alignItems:"center",gap:20,flexWrap:"wrap"}}>
          <div style={{flex:1}}>
            <div style={{fontSize:11,fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",color:T.ink3,marginBottom:8}}>{year} Annual Fund</div>
            <div style={{fontSize:38,fontWeight:800,color:T.ink,fontFamily:"'DM Serif Display',serif",lineHeight:1}}>{fmt(fund.totalRaised)}</div>
            {fund.goal>0&&<div style={{fontSize:13,color:T.ink3,marginTop:4}}>of {fmtFull(fund.goal)} goal · {fund.goalPct}% raised</div>}
            {fund.projectedTotal>0&&year===currentYear&&fund.projectedTotal!==fund.totalRaised&&
              <div style={{fontSize:12,color:"#8b5cf6",marginTop:4}}>Projected year-end: {fmt(fund.projectedTotal)}</div>}
          </div>
          {fund.goal>0&&<div style={{flexShrink:0}}>
            <svg width="88" height="88" viewBox="0 0 88 88">
              <circle cx="44" cy="44" r="36" fill="none" stroke="#e8e4db" strokeWidth="9"/>
              <circle cx="44" cy="44" r="36" fill="none" stroke="#10b981" strokeWidth="9"
                strokeDasharray={`${Math.min(fund.goalPct,100)*2.262} 226.2`}
                strokeDashoffset="56.6" strokeLinecap="round" transform="rotate(-90 44 44)"/>
              <text x="44" y="50" textAnchor="middle" fill={T.ink} fontSize="15" fontWeight="800" fontFamily="sans-serif">{fund.goalPct}%</text>
            </svg>
          </div>}
        </div>
        {fund.goal>0&&<div style={{marginTop:14,height:6,background:T.bg3,borderRadius:99}}>
          <div style={{height:"100%",width:`${Math.min(fund.goalPct,100)}%`,background:fund.goalPct>=100?"#10b981":fund.goalPct>=60?"#f59e0b":"#ef4444",borderRadius:99,transition:"width 0.5s"}}/>
        </div>}
      </Card>

      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:10}}>
        <MetricCard label="Total Gifts" value={fund.giftCount} sub={`avg ${fmt(fund.avgGift)}`} color="#10b981"/>
        <MetricCard label="Total Donors" value={fund.donors.total} sub={`${fund.donors.acquired} new · ${fund.donors.retained} renewed`} color="#3b82f6"/>
        <MetricCard label="Retention Rate" value={`${fund.donors.retentionRate}%`} sub="vs prior year" color={fund.donors.retentionRate>=70?"#10b981":fund.donors.retentionRate>=50?"#f59e0b":"#ef4444"}/>
        <MetricCard label="Avg Gift" value={fmt(fund.avgGift)} color="#8b5cf6"/>
        {fund.recovered>0&&<MetricCard label="Lapsed Recovered" value={fund.recovered} sub="gave again this year" color="#f59e0b"/>}
        {fund.projectedTotal>0&&year===currentYear&&<MetricCard label="Year-End Proj." value={fmt(fund.projectedTotal)} sub="at current pace" color="#6b7280"/>}
      </div>

      <Card>
        <SectionLabel>Monthly Revenue — {year}</SectionLabel>
        <div style={{display:"flex",alignItems:"flex-end",gap:4,height:140}}>
          {fund.monthly.map(m=>{
            const h=maxMonth>0?Math.round(m.raised/maxMonth*120):0;
            return <div key={m.month} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:4}}>
              <div style={{fontSize:9,color:T.ink3}}>{m.raised>0?fmt(m.raised):""}</div>
              <div style={{width:"100%",height:h,background:m.raised>0?"linear-gradient(180deg,#10b981,#059669)":T.bg2,borderRadius:"4px 4px 0 0",minHeight:3}}/>
              <div style={{fontSize:9,color:T.ink3}}>{m.month.slice(0,3)}</div>
            </div>;
          })}
        </div>
      </Card>

      <Card>
        <SectionLabel>Donor Acquisition vs Retention</SectionLabel>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:14}}>
          <div>
            <div style={{fontSize:28,fontWeight:800,color:"#3b82f6",fontFamily:"'DM Serif Display',serif"}}>{fund.donors.acquired}</div>
            <div style={{fontSize:12,color:T.ink3,marginTop:2}}>New donors</div>
            <div style={{fontSize:11,color:T.ink3,marginTop:6,lineHeight:1.5}}>First-time givers who didn't donate in {year-1}.</div>
          </div>
          <div>
            <div style={{fontSize:28,fontWeight:800,color:"#10b981",fontFamily:"'DM Serif Display',serif"}}>{fund.donors.retained}</div>
            <div style={{fontSize:12,color:T.ink3,marginTop:2}}>Renewed donors</div>
            <div style={{fontSize:11,color:T.ink3,marginTop:6,lineHeight:1.5}}>Gave in both {year-1} and {year}. Rate: {fund.donors.retentionRate}%</div>
          </div>
        </div>
        <div style={{height:6,background:T.bg3,borderRadius:99,display:"flex",overflow:"hidden"}}>
          <div style={{width:`${fund.donors.total>0?Math.round(fund.donors.retained/fund.donors.total*100):0}%`,background:"#10b981"}}/>
          <div style={{flex:1,background:"#3b82f6"}}/>
        </div>
        <div style={{display:"flex",gap:12,marginTop:8}}>
          <div style={{display:"flex",alignItems:"center",gap:4,fontSize:11,color:T.ink3}}><div style={{width:10,height:10,background:"#10b981",borderRadius:2}}/>Retained</div>
          <div style={{display:"flex",alignItems:"center",gap:4,fontSize:11,color:T.ink3}}><div style={{width:10,height:10,background:"#3b82f6",borderRadius:2}}/>New</div>
        </div>
      </Card>
    </>}
  </div>;
}
