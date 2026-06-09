import { useState, useEffect } from "react";
import { T, fmt, fmtFull, askClaude, Pill, Card, AIBtn, AIPanel, MetricCard, EmptyState, PageTitle, Spin } from "./shared";
import { apiFetch, API, getToken } from "../api";

export function Board({data}) {
  const [subTab, setSubTab] = useState("members");
  const [boardBrief,setBoardBrief]=useState(""); const [briefLoading,setBriefLoading]=useState(false);
  const [boardEmail,setBoardEmail]=useState(""); const [emailLoading,setEmailLoading]=useState(false);
  const [reports, setReports] = useState([]);
  const [reportsLoading, setReportsLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState("");

  const totalGiving=data.board.reduce((s,b)=>s+parseInt(b.givingLevel.replace(/[$,]/g,"")),0);
  const avgAttendance=data.board.length ? Math.round(data.board.reduce((s,b)=>s+b.attendance,0)/data.board.length) : 0;
  // Match board members to donor records by email
  const donorByEmail = Object.fromEntries((data.donors||[]).filter(d=>d.email).map(d=>[d.email.toLowerCase(),d]));
  const currentYear = new Date().getFullYear();
  const boardWithDonor = data.board.map(b=>({...b, donor: b.email ? donorByEmail[b.email.toLowerCase()] : null}));
  const gaveThisYear = boardWithDonor.filter(b=>b.donor&&b.donor.lastGift&&new Date(b.donor.lastGift).getFullYear()===currentYear);
  const boardParticipation = data.board.length ? Math.round((gaveThisYear.length/data.board.length)*100) : 0;

  const loadReports = async () => {
    setReportsLoading(true);
    try { const rows = await apiFetch("/reports/board"); setReports(rows); } catch(e) {}
    setReportsLoading(false);
  };

  useEffect(() => { if (subTab === "reports") loadReports(); }, [subTab]);

  const generateReport = async () => {
    setGenerating(true); setGenError("");
    try {
      const resp = await fetch(`${API}/reports/board`, {
        method: "POST",
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (!resp.ok) { const e = await resp.json().catch(() => ({})); throw new Error(e.error || "Generation failed"); }
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const now = new Date();
      a.href = url; a.download = `board-report-${now.getFullYear()}-Q${Math.ceil((now.getMonth()+1)/3)}.pdf`;
      document.body.appendChild(a); a.click();
      document.body.removeChild(a); URL.revokeObjectURL(url);
      await loadReports();
    } catch(e) { setGenError(e.message || "Could not generate report"); }
    setGenerating(false);
  };

  const downloadReport = async (id) => {
    try {
      const resp = await fetch(`${API}/reports/board/${id}/pdf`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (!resp.ok) return;
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `board-report-${id}.pdf`;
      document.body.appendChild(a); a.click();
      document.body.removeChild(a); URL.revokeObjectURL(url);
    } catch(e) {}
  };

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

  const tabStyle = (active) => ({
    padding:"7px 16px", borderRadius:8, border:`1px solid ${active ? "#1a6b4a" : T.bg3}`, cursor:"pointer", fontSize:13, fontWeight:600,
    background: active ? "#1a6b4a" : T.bg2,
    color: active ? "#fff" : T.ink3,
    transition:"background 0.15s,color 0.15s",
  });

  return <div style={{display:"flex",flexDirection:"column",gap:16}}>
    <PageTitle main="Board" accent="management."/>
    <div className="board-metric-grid" style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12}}>
      <MetricCard label="Board Members" value={data.board.length} sub={`${avgAttendance}% avg attendance`} color="#1a6b4a"/>
      <MetricCard label="Board Giving" value={fmt(totalGiving)} sub={`${boardParticipation}% board participation this year`} color={boardParticipation===100?"#1a6b4a":boardParticipation>=75?"#f59e0b":"#ef4444"}/>
      <MetricCard label="Committees" value={[...new Set(data.board.flatMap(b=>b.committees))].length} sub="active committees" color="#1a6b4a"/>
    </div>

    <div style={{display:"flex",gap:8}}>
      {["members","giving","reports"].map(t=><button key={t} style={tabStyle(subTab===t)} onClick={()=>setSubTab(t)}>{t==="members"?"Board Members":t==="giving"?"Board Giving":"Reports"}</button>)}
    </div>

    {subTab==="members" && <>
      <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
        <AIBtn onClick={generateBrief} loading={briefLoading} label="✦ Generate Q2 Board Report"/>
        <AIBtn onClick={draftEmail} loading={emailLoading} label="✦ Draft Board Ask Email"/>
      </div>
      {(briefLoading||boardBrief)&&<AIPanel text={boardBrief} onClose={()=>setBoardBrief("")}/>}
      {(emailLoading||boardEmail)&&<AIPanel text={boardEmail} onClose={()=>setBoardEmail("")}/>}
      {data.board.length===0&&<EmptyState icon="◆" title="No board members yet" message="Track your board's giving, attendance, committees, and terms."/>}
      {boardWithDonor.map(b=>{
        const attColor=b.attendance>=90?"#1a6b4a":b.attendance>=75?"#f59e0b":"#ef4444";
        const d=b.donor;
        return <Card key={b.id}>
          <div style={{display:"flex",alignItems:"center",gap:12}}>
            <div style={{width:42,height:42,borderRadius:"50%",background:"#1a6b4a22",display:"flex",alignItems:"center",justifyContent:"center",fontSize:15,fontWeight:800,color:"#1a6b4a",flexShrink:0}}>{b.name[0]}</div>
            <div style={{flex:1}}>
              <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                <div style={{fontSize:15,fontWeight:700,color:T.ink}}>{b.name}</div>
                <Pill label={b.role} color="#1a6b4a"/>
                {d&&<Pill label={d.stage} color={SC[d.stage]||"#6b7280"}/>}
              </div>
              <div style={{fontSize:12,color:T.ink3,marginTop:1}}>{b.employer}</div>
              <div style={{display:"flex",gap:4,marginTop:5,flexWrap:"wrap"}}>{b.committees.map(c=><Pill key={c} label={c} color="#6b7280"/>)}</div>
              {d&&<div style={{fontSize:11,color:"#1a6b4a",marginTop:4,display:"flex",gap:12}}>
                <span>Lifetime: <strong>{fmtFull(d.total)}</strong></span>
                {d.lastGift&&<span>Last gift: <strong>{new Date(d.lastGift).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})}</strong></span>}
              </div>}
            </div>
            <div style={{textAlign:"right",flexShrink:0}}>
              <div style={{fontSize:15,fontWeight:800,color:"#1a6b4a"}}>{b.givingLevel}</div>
              <div style={{fontSize:11,color:attColor,marginTop:3,fontWeight:600}}>{b.attendance}% attendance</div>
              <div style={{fontSize:11,color:T.ink3,marginTop:1}}>Term: {b.term}</div>
            </div>
          </div>
        </Card>;
      })}
    </>}

    {subTab==="giving" && <>
      <Card>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16,flexWrap:"wrap",gap:8}}>
          <div>
            <div style={{fontSize:15,fontWeight:700,color:T.ink}}>Board Giving Participation</div>
            <div style={{fontSize:12,color:T.ink3,marginTop:2}}>{gaveThisYear.length} of {data.board.length} board members gave in {currentYear} — <strong style={{color:boardParticipation>=80?"#1a6b4a":boardParticipation>=60?"#f59e0b":"#ef4444"}}>{boardParticipation}% participation</strong></div>
          </div>
          <div style={{fontSize:11,color:T.ink3,background:T.bg2,borderRadius:8,padding:"6px 12px"}}>Funders look for 100% board participation</div>
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:2}}>
          {boardWithDonor.map(b=>{
            const gave=b.donor&&b.donor.lastGift&&new Date(b.donor.lastGift).getFullYear()===currentYear;
            return(
              <div key={b.id} style={{display:"flex",alignItems:"center",gap:12,padding:"10px 0",borderBottom:"1px solid "+T.bg2}}>
                <span style={{width:8,height:8,borderRadius:"50%",background:gave?"#10b981":"#e5e7eb",flexShrink:0}}/>
                <div style={{flex:1}}>
                  <div style={{fontSize:13,fontWeight:600,color:T.ink}}>{b.name}</div>
                  <div style={{fontSize:11,color:T.ink3}}>{b.role}{b.employer?` · ${b.employer}`:""}</div>
                </div>
                {gave
                  ? <div style={{textAlign:"right"}}>
                      <div style={{fontSize:12,fontWeight:700,color:"#1a6b4a"}}>{fmtFull(b.donor.lastAmount)}</div>
                      <div style={{fontSize:10,color:T.ink3}}>{new Date(b.donor.lastGift).toLocaleDateString("en-US",{month:"short",day:"numeric"})}</div>
                    </div>
                  : <span style={{fontSize:11,color:"#ef4444",fontWeight:600}}>Not yet this year</span>
                }
              </div>
            );
          })}
        </div>
      </Card>
    </>}

    {subTab==="reports" && <>
      <Card>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:12}}>
          <div>
            <div style={{fontSize:15,fontWeight:700,color:T.ink}}>Board Report</div>
            <div style={{fontSize:12,color:T.ink3,marginTop:2}}>Generates a PDF with Executive Summary, Financial Snapshot, Donor Dashboard, and Grants & Operations — powered by AI.</div>
          </div>
          <button onClick={generateReport} disabled={generating} style={{display:"flex",alignItems:"center",gap:8,padding:"10px 20px",borderRadius:8,border:"none",background:"#1a6b4a",color:"#fff",fontWeight:700,fontSize:13,cursor:generating?"not-allowed":"pointer",opacity:generating?0.7:1}}>
            {generating ? <><Spin/> Generating…</> : "✦ Generate Board Report"}
          </button>
        </div>
        {genError && <div style={{marginTop:10,padding:"8px 12px",background:"#ef444420",borderRadius:6,color:"#ef4444",fontSize:12}}>{genError}</div>}
        {generating && <div style={{marginTop:12,padding:"10px 14px",background:T.bg2,borderRadius:8,fontSize:12,color:T.ink3}}>
          Pulling live data, generating AI executive summary, and building PDF… this takes about 15–20 seconds.
        </div>}
      </Card>

      {reportsLoading && <div style={{textAlign:"center",padding:32}}><Spin/></div>}

      {!reportsLoading && reports.length===0 && <EmptyState icon="◆" title="No reports yet" message="Generate your first board report to see it here."/>}

      {reports.map(r => {
        const m = r.metrics || {};
        const qLabel = `Q${r.quarter} ${r.year}`;
        const genDate = new Date(r.generated_at).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"});
        return <Card key={r.id}>
          <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:12,flexWrap:"wrap"}}>
            <div style={{flex:1}}>
              <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:6}}>
                <div style={{fontSize:16,fontWeight:800,color:T.ink}}>Board Report — {qLabel}</div>
                <Pill label="PDF" color="#1a6b4a"/>
              </div>
              <div style={{fontSize:11,color:T.ink3,marginBottom:10}}>Generated {genDate}{r.generated_by_name ? ` by ${r.generated_by_name}` : ""}</div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(120px,1fr))",gap:8}}>
                {m.ytdRevenue != null && <div style={{background:T.bg2,borderRadius:6,padding:"8px 10px"}}>
                  <div style={{fontSize:10,color:T.ink3,fontWeight:600,textTransform:"uppercase",letterSpacing:0.5}}>YTD Revenue</div>
                  <div style={{fontSize:14,fontWeight:800,color:"#1a6b4a",marginTop:2}}>{fmtFull(m.ytdRevenue)}</div>
                </div>}
                {m.ytdExpenses != null && <div style={{background:T.bg2,borderRadius:6,padding:"8px 10px"}}>
                  <div style={{fontSize:10,color:T.ink3,fontWeight:600,textTransform:"uppercase",letterSpacing:0.5}}>YTD Expenses</div>
                  <div style={{fontSize:14,fontWeight:800,color:T.ink,marginTop:2}}>{fmtFull(m.ytdExpenses)}</div>
                </div>}
                {m.totalDonors != null && <div style={{background:T.bg2,borderRadius:6,padding:"8px 10px"}}>
                  <div style={{fontSize:10,color:T.ink3,fontWeight:600,textTransform:"uppercase",letterSpacing:0.5}}>Total Donors</div>
                  <div style={{fontSize:14,fontWeight:800,color:"#1a6b4a",marginTop:2}}>{m.totalDonors.toLocaleString()}</div>
                </div>}
                {m.activeGrants != null && <div style={{background:T.bg2,borderRadius:6,padding:"8px 10px"}}>
                  <div style={{fontSize:10,color:T.ink3,fontWeight:600,textTransform:"uppercase",letterSpacing:0.5}}>Active Grants</div>
                  <div style={{fontSize:14,fontWeight:800,color:"#1a6b4a",marginTop:2}}>{m.activeGrants}</div>
                </div>}
                {m.pipelineValue != null && <div style={{background:T.bg2,borderRadius:6,padding:"8px 10px"}}>
                  <div style={{fontSize:10,color:T.ink3,fontWeight:600,textTransform:"uppercase",letterSpacing:0.5}}>Grant Pipeline</div>
                  <div style={{fontSize:14,fontWeight:800,color:"#1a6b4a",marginTop:2}}>{fmtFull(m.pipelineValue)}</div>
                </div>}
              </div>
            </div>
            <button onClick={()=>downloadReport(r.id)} style={{padding:"8px 16px",borderRadius:8,border:`1px solid ${T.bg3}`,background:"transparent",color:T.ink,fontSize:12,fontWeight:600,cursor:"pointer",whiteSpace:"nowrap",flexShrink:0}}>
              ↓ Download PDF
            </button>
          </div>
        </Card>;
      })}
    </>}
  </div>;
}
