import { useState, useEffect } from "react";
import { T, fmt, fmtFull, askClaude, Pill, Card, AIBtn, AIPanel, MetricCard, EmptyState, PageTitle, Spin } from "./shared";
import { apiFetch, API, getToken } from "../api";

export function Board({data, setData}) {
  const [subTab, setSubTab] = useState("members");
  const [boardBrief,setBoardBrief]=useState(""); const [briefLoading,setBriefLoading]=useState(false);
  const [boardEmail,setBoardEmail]=useState(""); const [emailLoading,setEmailLoading]=useState(false);
  const [reports, setReports] = useState([]);
  const [reportsLoading, setReportsLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState("");
  const [showAdd,setShowAdd]=useState(false);
  const [form,setForm]=useState({name:"",role:"Member",employer:"",committees:"",term:"",givingLevel:""});
  const [saving,setSaving]=useState(false);

  const totalGiving=data.board.reduce((s,b)=>s+parseInt(b.givingLevel.replace(/[$,]/g,"")),0);
  const avgAttendance=data.board.length ? Math.round(data.board.reduce((s,b)=>s+b.attendance,0)/data.board.length) : 0;

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

  async function addMember(){
    if(!form.name.trim())return;
    setSaving(true);
    try{
      const committeeArr=form.committees.split(",").map(s=>s.trim()).filter(Boolean);
      const raw=await apiFetch("/board",{method:"POST",body:JSON.stringify({
        name:form.name.trim(),role:form.role||"Member",employer:form.employer.trim(),
        term:form.term.trim(),givingLevel:form.givingLevel.trim()||"$0",
        committees:committeeArr,attendance:100,
      })});
      const adapted={
        id:raw.id, name:raw.name, role:raw.role||"Member",
        employer:raw.employer||"", term:raw.term||"",
        givingLevel:raw.giving_level||"$0",
        committees:Array.isArray(raw.committees)?raw.committees:JSON.parse(raw.committees||"[]"),
        attendance:raw.attendance??100,
      };
      setData(prev=>({...prev,board:[...prev.board,adapted]}));
      setForm({name:"",role:"Member",employer:"",committees:"",term:"",givingLevel:""});
      setShowAdd(false);
    }catch(e){alert(e.message||"Failed to add board member");}
    setSaving(false);
  }

  const inp={background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"9px 12px",color:T.ink,fontSize:13,outline:"none",width:"100%",boxSizing:"border-box"};

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
      <MetricCard label="Board Giving" value={fmt(totalGiving)} sub="100% board participation" color="#1a6b4a"/>
      <MetricCard label="Committees" value={[...new Set(data.board.flatMap(b=>b.committees))].length} sub="active committees" color="#1a6b4a"/>
    </div>

    <div style={{display:"flex",gap:8}}>
      {["members","reports"].map(t=><button key={t} style={tabStyle(subTab===t)} onClick={()=>setSubTab(t)}>{t==="members"?"Board Members":"Reports"}</button>)}
    </div>

    {subTab==="members" && <>
      <div style={{display:"flex",gap:10,flexWrap:"wrap",alignItems:"center"}}>
        <AIBtn onClick={generateBrief} loading={briefLoading} label="✦ Generate Q2 Board Report"/>
        <AIBtn onClick={draftEmail} loading={emailLoading} label="✦ Draft Board Ask Email"/>
        <button onClick={()=>setShowAdd(v=>!v)}
          style={{marginLeft:"auto",background:"#1a6b4a",color:"#fff",border:"none",borderRadius:8,padding:"8px 16px",fontSize:13,fontWeight:700,cursor:"pointer"}}>
          + Add Board Member
        </button>
      </div>
      {(briefLoading||boardBrief)&&<AIPanel text={boardBrief} onClose={()=>setBoardBrief("")}/>}
      {(emailLoading||boardEmail)&&<AIPanel text={boardEmail} onClose={()=>setBoardEmail("")}/>}
      {showAdd&&<Card>
        <div style={{fontSize:14,fontWeight:700,color:T.ink,marginBottom:14}}>New Board Member</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          <input placeholder="Full name *" value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} style={inp}/>
          <select value={form.role} onChange={e=>setForm(f=>({...f,role:e.target.value}))} style={{...inp,cursor:"pointer"}}>
            <option value="Member">Member</option>
            <option value="Chair">Chair</option>
            <option value="Vice Chair">Vice Chair</option>
            <option value="Treasurer">Treasurer</option>
            <option value="Secretary">Secretary</option>
          </select>
          <input placeholder="Employer / Organization" value={form.employer} onChange={e=>setForm(f=>({...f,employer:e.target.value}))} style={inp}/>
          <input placeholder="Giving level (e.g. $10,000+)" value={form.givingLevel} onChange={e=>setForm(f=>({...f,givingLevel:e.target.value}))} style={inp}/>
          <input placeholder="Committees (comma-separated)" value={form.committees} onChange={e=>setForm(f=>({...f,committees:e.target.value}))} style={inp}/>
          <input placeholder="Term (e.g. 2024–2027)" value={form.term} onChange={e=>setForm(f=>({...f,term:e.target.value}))} style={inp}/>
        </div>
        <div style={{display:"flex",gap:8,marginTop:12}}>
          <button onClick={addMember} disabled={saving||!form.name.trim()}
            style={{background:"#1a6b4a",color:"#fff",border:"none",borderRadius:8,padding:"9px 18px",fontSize:13,fontWeight:700,cursor:saving?"not-allowed":"pointer",opacity:saving?0.7:1}}>
            {saving?"Saving…":"Save Board Member"}
          </button>
          <button onClick={()=>setShowAdd(false)}
            style={{background:"transparent",color:T.ink3,border:"1px solid "+T.bg3,borderRadius:8,padding:"9px 14px",fontSize:13,cursor:"pointer"}}>
            Cancel
          </button>
        </div>
      </Card>}
      {data.board.length===0&&!showAdd&&<EmptyState icon="◆" title="No board members yet" message="Track your board's giving, attendance, committees, and terms."/>}
      {data.board.map(b=>{
        const attColor=b.attendance>=90?"#1a6b4a":b.attendance>=75?"#f59e0b":"#ef4444";
        return <Card key={b.id}>
          <div style={{display:"flex",alignItems:"center",gap:12}}>
            <div style={{width:42,height:42,borderRadius:"50%",background:"#1a6b4a22",display:"flex",alignItems:"center",justifyContent:"center",fontSize:15,fontWeight:800,color:"#1a6b4a",flexShrink:0}}>{b.name[0]}</div>
            <div style={{flex:1}}>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <div style={{fontSize:15,fontWeight:700,color:T.ink}}>{b.name}</div>
                <Pill label={b.role} color="#1a6b4a"/>
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
