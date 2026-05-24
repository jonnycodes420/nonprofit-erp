import { useState } from "react";
import { T, fmt, fmtFull, askClaude, Card, AIBtn, AIPanel, MetricCard, EmptyState, SectionLabel, PageTitle } from "./shared";

export function Finance({data}) {
  const [forecastAI,setForecastAI]=useState(""); const [forecastLoading,setForecastLoading]=useState(false);
  const [riskAI,setRiskAI]=useState(""); const [riskLoading,setRiskLoading]=useState(false);
  const rev=data.financials.revenue; const exp=data.financials.expenses;
  const ytdRev=rev.reduce((s,r)=>s+r.individual+r.grants+r.events+r.other,0);
  const ytdExp=exp.reduce((s,e)=>s+e.programs+e.admin+e.fundraising,0);
  const programRatio=Math.round(exp.reduce((s,e)=>s+e.programs,0)/ytdExp*100);
  const maxBar=Math.max(...rev.map(r=>r.individual+r.grants+r.events+r.other),...exp.map(e=>e.programs+e.admin+e.fundraising));

  const getForecast=async()=>{
    setForecastLoading(true); setForecastAI("");
    await askClaude(`You are a nonprofit CFO. Specific, data-driven. Max 200 words.`,
      `Generate a 6-month revenue forecast and key financial risks.\n\nYTD Revenue: ${fmtFull(ytdRev)} | YTD Expenses: ${fmtFull(ytdExp)} | Net: ${fmtFull(ytdRev-ytdExp)}\nMonthly revenue trend: ${rev.map(r=>`${r.month}: ${fmtFull(r.individual+r.grants+r.events+r.other)}`).join(", ")}\nActive grants: ${data.grants.filter(g=>g.status==="active").map(g=>`${g.funder} ${fmtFull(g.amount)} ends ${g.deadline}`).join(", ")}\nPipeline: ${data.grants.filter(g=>["pending","prospecting"].includes(g.status)).map(g=>`${g.funder} ${fmtFull(g.amount)}`).join(", ")}\nFund balances: ${data.financials.funds.map(f=>`${f.name}: ${fmtFull(f.balance)}`).join(", ")}\nProgram ratio: ${programRatio}%\n\nProvide: Q3-Q4 revenue projection, 3 financial risks, 2 opportunities.`,
      chunk=>setForecastAI(chunk));
    setForecastLoading(false);
  };
  const getRisks=async()=>{
    setRiskLoading(true); setRiskAI("");
    await askClaude(`You are a nonprofit financial auditor. Direct, specific. Max 150 words.`,
      `Identify financial risks for this org.\nYTD Net: ${fmtFull(ytdRev-ytdExp)}\nRestricted funds: ${data.financials.funds.filter(f=>f.restricted).map(f=>`${f.name}: ${fmtFull(f.balance)}`).join(", ")}\nGrant concentration: ${data.grants.filter(g=>g.status==="active").map(g=>`${g.funder}: ${fmtFull(g.amount)}`).join(", ")}\nLapsed donors: ${data.donors.filter(d=>d.status==="lapsed").length}\nProgram expense ratio: ${programRatio}%\n\nList top 3 risks with severity and mitigation recommendation.`,
      chunk=>setRiskAI(chunk));
    setRiskLoading(false);
  };

  return <div style={{display:"flex",flexDirection:"column",gap:16}}>
    <PageTitle main="Financial" accent="overview."/>
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:12}}>
      <MetricCard label="YTD Revenue" value={fmt(ytdRev)} color="#10b981"/>
      <MetricCard label="YTD Expenses" value={fmt(ytdExp)} color="#ef4444"/>
      <MetricCard label="Net Position" value={fmt(ytdRev-ytdExp)} color={ytdRev>ytdExp?"#10b981":"#ef4444"}/>
      <MetricCard label="Program Ratio" value={`${programRatio}%`} sub="IRS recommends 65%+" color={programRatio>=65?"#10b981":"#f59e0b"}/>
    </div>
    <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
      <AIBtn onClick={getForecast} loading={forecastLoading} label="✦ 6-Month Forecast"/>
      <AIBtn onClick={getRisks} loading={riskLoading} label="✦ Risk Analysis"/>
    </div>
    {(forecastLoading||forecastAI)&&<AIPanel text={forecastAI} onClose={()=>setForecastAI("")}/>}
    {(riskLoading||riskAI)&&<AIPanel text={riskAI} onClose={()=>setRiskAI("")}/>}

    <Card>
      <SectionLabel>Monthly Breakdown</SectionLabel>
      {rev.length===0&&<EmptyState icon="◇" title="No financial data" message="Add monthly financial data to see trends."/>}
      {rev.map((r,i)=>{
        const rv=r.individual+r.grants+r.events+r.other;
        const ex=exp[i].programs+exp[i].admin+exp[i].fundraising;
        const net=rv-ex;
        return <div key={r.month} style={{marginBottom:14,paddingBottom:14,borderBottom:"1px solid #0e1624"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
            <span style={{fontSize:13,fontWeight:700,color:T.ink}}>{r.month}</span>
            <div style={{display:"flex",gap:16,alignItems:"center"}}>
              <span style={{fontSize:11,color:"#10b981"}}>↑ {fmtFull(rv)}</span>
              <span style={{fontSize:11,color:"#ef4444"}}>↓ {fmtFull(ex)}</span>
              <span style={{fontSize:12,fontWeight:700,color:net>=0?"#10b981":"#ef4444"}}>{net>=0?"+":""}{fmtFull(net)}</span>
            </div>
          </div>
          <div style={{height:5,background:T.bg2,borderRadius:99,overflow:"hidden",marginBottom:3}}>
            <div style={{height:"100%",width:`${maxBar>0?(rv/maxBar)*100:0}%`,background:"linear-gradient(90deg,#10b981,#3b82f6)",borderRadius:99}}/>
          </div>
          <div style={{height:4,background:T.bg2,borderRadius:99,overflow:"hidden"}}>
            <div style={{height:"100%",width:`${maxBar>0?(ex/maxBar)*100:0}%`,background:"linear-gradient(90deg,#ef444488,#dc2626)",borderRadius:99,opacity:0.7}}/>
          </div>
          {rv>0&&<div style={{display:"flex",gap:3,marginTop:4}}>
            {[["individual",r.individual,"#10b981"],["grants",r.grants,"#3b82f6"],["events",r.events,"#8b5cf6"],["other",r.other,"#6b7280"]].filter(([,v])=>v>0).map(([k,v,c])=>
              <div key={k} style={{flex:v/rv,height:3,background:c,borderRadius:99,opacity:0.6}} title={`${k}: ${fmtFull(v)}`}/>
            )}
          </div>}
        </div>;
      })}
      <div style={{display:"flex",gap:14,marginTop:4,flexWrap:"wrap"}}>
        {[["#10b981","Individual"],["#3b82f6","Grants"],["#8b5cf6","Events"],["#6b7280","Other"]].map(([c,l])=>
          <div key={l} style={{display:"flex",alignItems:"center",gap:5}}><div style={{width:8,height:8,borderRadius:2,background:c}}/><span style={{fontSize:11,color:T.ink3}}>{l}</span></div>
        )}
      </div>
    </Card>

    <Card>
      <SectionLabel>Fund Balances</SectionLabel>
      {data.financials.funds.map((f,i)=><div key={f.name} style={{display:"flex",alignItems:"center",gap:12,padding:"11px 0",borderBottom:i<data.financials.funds.length-1?"1px solid #0e1624":""}}>
        <div style={{width:10,height:10,borderRadius:"50%",background:"#10b981",flexShrink:0,boxShadow:"0 0 8px #10b98160"}}/>
        <div style={{flex:1}}>
          <div style={{fontSize:13,fontWeight:600,color:T.ink}}>{f.name}</div>
          <div style={{fontSize:10,color:f.restricted?"#10b981":"#6b7280",fontWeight:600,textTransform:"uppercase",letterSpacing:"0.06em",marginTop:1}}>{f.restricted?"Restricted":"Unrestricted"}</div>
        </div>
        <div style={{fontSize:18,fontWeight:800,color:T.ink,fontFamily:"'DM Serif Display',serif"}}>{fmt(f.balance)}</div>
      </div>)}
    </Card>
  </div>;
}
