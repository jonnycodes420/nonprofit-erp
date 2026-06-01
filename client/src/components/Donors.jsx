import { useState, useEffect } from "react";
import { apiFetch } from "../api";
import { useAuth } from "../main";
import { T, fmt, fmtFull, daysDiff, SC, askClaude, STAGES, STAGE_ACTION, TIER_COLOR, donorScore, moveUrgency, Spin, Pill, Card, AIBtn, AIPanel, PageTitle, EmptyState, GivingHistoryChart, TpField, TpYesNo, TouchpointTimeline } from "./shared";

// ── CSV Import helpers ─────────────────────────────────────────────────────
const CSV_FIELDS = [
  {key:"name",labels:["name","full name","donor name","contact"]},
  {key:"email",labels:["email","email address","e-mail"]},
  {key:"phone",labels:["phone","phone number","mobile","cell"]},
  {key:"total",labels:["total","total giving","lifetime","lifetime giving","total donated"]},
  {key:"lastAmount",labels:["last gift","last amount","last donation","recent gift"]},
  {key:"lastGift",labels:["last gift date","date","last donation date","most recent date"]},
  {key:"gifts",labels:["gifts","gift count","# gifts","number of gifts","donations"]},
  {key:"status",labels:["status","donor status","type"]},
  {key:"notes",labels:["notes","note","comments"]},
];

function guessField(header) {
  const h = header.toLowerCase().trim();
  for (const f of CSV_FIELDS) {
    if (f.labels.some(l => h === l || h.includes(l))) return f.key;
  }
  return "";
}

function inferStage(total, lastGiftStr) {
  const amount = parseFloat(String(total || "0").replace(/[$,]/g, "")) || 0;
  const d = lastGiftStr ? new Date(lastGiftStr) : null;
  const days = d && !isNaN(d) ? Math.floor((Date.now() - d) / 86400000) : Infinity;
  if (!amount && days === Infinity) return "prospect";
  if (days > 365) return "lapsed";
  if (days < 90 && amount > 0) return "steward";
  if (amount > 0) return "cultivate";
  return "prospect";
}

const STAGE_COLORS = {prospect:T.ink3,qualify:"#3b82f6",cultivate:"#8b5cf6",solicit:"#f59e0b",steward:"#1a6b4a",lapsed:"#ef4444"};

function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return { headers: [], rows: [] };
  const headers = lines[0].split(",").map(h => h.replace(/^"|"$/g, "").trim());
  const rows = lines.slice(1).map(line => {
    const vals = []; let cur = ""; let inQ = false;
    for (const ch of line) {
      if (ch === '"') { inQ = !inQ; continue; }
      if (ch === "," && !inQ) { vals.push(cur.trim()); cur = ""; continue; }
      cur += ch;
    }
    vals.push(cur.trim());
    return Object.fromEntries(headers.map((h, i) => [h, vals[i] || ""]));
  });
  return { headers, rows };
}

function DonorImport({ onClose, onImported }) {
  const [csvText, setCsvText] = useState("");
  const [parsed, setParsed] = useState(null);
  const [mapping, setMapping] = useState({});
  const [loading, setLoading] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState("");

  const handleFile = (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => setCsvText(ev.target.result);
    reader.readAsText(file);
  };

  const doParse = () => {
    const { headers, rows } = parseCSV(csvText);
    if (!rows.length) { setErr("No rows found. Check CSV format."); return; }
    const auto = {};
    headers.forEach(h => { const g = guessField(h); if (g) auto[h] = g; });
    setMapping(auto); setParsed({ headers, rows }); setErr("");
  };

  const doAiMap = async () => {
    if (!parsed) return;
    setAiLoading(true);
    try {
      const sample = parsed.rows[0] || {};
      const res = await apiFetch("/ai/column-map", { method:"POST", body:JSON.stringify({ headers:parsed.headers, sample }) });
      if (res.mapping) {
        const merged = { ...mapping };
        Object.entries(res.mapping).forEach(([h, f]) => {
          if (f && CSV_FIELDS.some(cf => cf.key === f)) merged[h] = f;
        });
        setMapping(merged);
      }
    } catch { /* keep existing mapping */ }
    setAiLoading(false);
  };

  const buildDonors = () => parsed.rows.map(row => {
    const d = {};
    Object.entries(mapping).forEach(([h, field]) => { if (field) d[field] = row[h]; });
    if (d.total) d.total = parseFloat(String(d.total).replace(/[$,]/g, "")) || 0;
    if (d.lastAmount) {
      const s = String(d.lastAmount);
      d.lastAmount = /^\d{4}[-\/]\d{2}/.test(s) ? 0 : parseFloat(s.replace(/[$,]/g,"")) || 0;
    }
    if (d.gifts) d.gifts = parseInt(d.gifts) || 1;
    if (!d.stage) d.stage = inferStage(d.total, d.lastGift);
    return d;
  }).filter(d => d.name);

  const doImport = async () => {
    setLoading(true); setErr("");
    try {
      const res = await apiFetch("/donors/import", { method:"POST", body:JSON.stringify({ donors:buildDonors() }) });
      setResult(res.inserted); onImported();
    } catch (e) { setErr(e.message); }
    setLoading(false);
  };

  const overlay = { position:"fixed",inset:0,background:"#000c",zIndex:300,display:"flex",alignItems:"center",justifyContent:"center",padding:20 };
  const modal = { background:T.white,border:"1px solid "+T.bg3,borderRadius:20,width:"100%",maxWidth:700,maxHeight:"88vh",overflowY:"auto",padding:28,boxSizing:"border-box" };
  const inp = { width:"100%",background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"9px 12px",color:T.ink,fontSize:13,outline:"none",fontFamily:"inherit",boxSizing:"border-box" };

  if (result !== null) return (
    <div style={overlay} className="modal-sheet-overlay"><div style={{...modal,textAlign:"center"}} className="modal-sheet-inner">
      <div style={{fontSize:40,marginBottom:12}}>✓</div>
      <div style={{fontSize:22,fontWeight:800,color:T.ink,marginBottom:8}}>{result} donor{result!==1?"s":""} imported</div>
      <div style={{fontSize:14,color:T.ink3,marginBottom:24}}>Stages were auto-assigned based on gift history.</div>
      <button onClick={onClose} style={{background:"#10b981",border:"none",borderRadius:10,padding:"12px 28px",color:"#fff",fontSize:14,fontWeight:700,cursor:"pointer"}}>Done</button>
    </div></div>
  );

  return (
    <div style={overlay} className="modal-sheet-overlay">
      <div style={modal} className="modal-sheet-inner">
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
          <div>
            <div style={{fontSize:18,fontWeight:800,color:T.ink}}>Import Donors</div>
            <div style={{fontSize:13,color:T.ink3,marginTop:2}}>AI maps columns · stages auto-assigned from gift history</div>
          </div>
          <button onClick={onClose} style={{background:T.bg3,border:"none",borderRadius:8,padding:"6px 12px",color:T.ink3,cursor:"pointer",fontSize:13}}>✕ Close</button>
        </div>

        {!parsed && (<>
          <div style={{marginBottom:12}}>
            <div style={{fontSize:11,fontWeight:700,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:6}}>Upload CSV file</div>
            <input type="file" accept=".csv" onChange={handleFile} style={{fontSize:13,color:T.ink3}}/>
          </div>
          <div style={{fontSize:11,fontWeight:700,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:6}}>Or paste CSV text</div>
          <textarea value={csvText} onChange={e=>setCsvText(e.target.value)} rows={7} placeholder={"Name,Email,Total Giving,Last Gift Date\nJane Smith,jane@example.com,5000,2024-11-01"} style={{...inp,resize:"vertical",lineHeight:1.5,marginBottom:12}}/>
          {err&&<div style={{color:"#f87171",fontSize:12,marginBottom:10}}>{err}</div>}
          <button onClick={doParse} disabled={!csvText.trim()} style={{background:csvText.trim()?"linear-gradient(135deg,#10b981,#3b82f6)":T.bg2,border:"none",borderRadius:10,padding:"11px 20px",color:"#fff",fontSize:14,fontWeight:700,cursor:csvText.trim()?"pointer":"not-allowed",opacity:csvText.trim()?1:0.5}}>
            Parse CSV →
          </button>
        </>)}

        {parsed && (<>
          <div style={{marginBottom:16}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
              <div style={{fontSize:13,fontWeight:700,color:T.ink}}>Map Columns</div>
              <button onClick={doAiMap} disabled={aiLoading} style={{background:aiLoading?"#1a2235":"linear-gradient(135deg,#1a6b4a,#2563eb)",border:"none",borderRadius:8,padding:"6px 14px",color:"#fff",fontSize:12,fontWeight:700,cursor:aiLoading?"not-allowed":"pointer",display:"flex",alignItems:"center",gap:6,opacity:aiLoading?0.7:1}}>
                {aiLoading?<><Spin/>Mapping…</>:<>✦ AI Map</>}
              </button>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
              {parsed.headers.map(h=>(
                <div key={h} style={{display:"flex",alignItems:"center",gap:8,background:mapping[h]?T.bg:"transparent",borderRadius:7,padding:"5px 8px",border:`1px solid ${mapping[h]?T.bg3:"transparent"}`}}>
                  <span style={{fontSize:12,color:mapping[h]?T.ink:T.ink3,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{h}</span>
                  <select value={mapping[h]||""} onChange={e=>setMapping(p=>({...p,[h]:e.target.value}))}
                    style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:6,padding:"4px 8px",color:T.ink,fontSize:11,outline:"none",flexShrink:0}}>
                    <option value="">— skip —</option>
                    {CSV_FIELDS.map(f=><option key={f.key} value={f.key}>{f.key}</option>)}
                  </select>
                </div>
              ))}
            </div>
          </div>

          {(() => {
            const donors = buildDonors();
            const stageCounts = {};
            donors.forEach(d => { stageCounts[d.stage] = (stageCounts[d.stage]||0)+1; });
            return Object.keys(stageCounts).length > 0 && (
              <div style={{background:T.bg,borderRadius:10,padding:"12px 14px",marginBottom:16}}>
                <div style={{fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.1em",color:T.ink3,marginBottom:8}}>Smart Stage Assignment Preview</div>
                <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                  {Object.entries(stageCounts).map(([s,n])=>(
                    <span key={s} style={{fontSize:12,fontWeight:600,padding:"3px 10px",borderRadius:99,background:(STAGE_COLORS[s]||T.ink3)+"22",color:STAGE_COLORS[s]||T.ink3,border:`1px solid ${(STAGE_COLORS[s]||T.ink3)}30`}}>
                      {s} × {n}
                    </span>
                  ))}
                </div>
                <div style={{fontSize:11,color:T.ink3,marginTop:8}}>Based on last gift date + amount. Override any stage after import by dragging in the Kanban.</div>
              </div>
            );
          })()}

          <div style={{marginBottom:16}}>
            <div style={{fontSize:11,fontWeight:600,color:T.ink3,marginBottom:8}}>{parsed.rows.length} rows · showing first 5</div>
            <div style={{overflowX:"auto",border:"1px solid "+T.bg3,borderRadius:8}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                <thead><tr style={{background:T.bg}}>
                  {parsed.headers.filter(h=>mapping[h]).map(h=><th key={h} style={{padding:"6px 10px",textAlign:"left",color:T.ink3,fontWeight:600,borderBottom:"1px solid "+T.bg3}}>{mapping[h]}</th>)}
                  <th style={{padding:"6px 10px",textAlign:"left",color:T.ink3,fontWeight:600,borderBottom:"1px solid "+T.bg3}}>stage</th>
                </tr></thead>
                <tbody>{parsed.rows.slice(0,5).map((row,i)=>{
                  const d={};Object.entries(mapping).forEach(([h,f])=>{if(f)d[f]=row[h];});
                  const st=inferStage(d.total,d.lastGift);
                  return(
                    <tr key={i} style={{borderBottom:"1px solid "+T.bg2}}>
                      {parsed.headers.filter(h=>mapping[h]).map(h=><td key={h} style={{padding:"6px 10px",color:T.ink}}>{row[h]}</td>)}
                      <td style={{padding:"6px 10px"}}>
                        <span style={{fontSize:11,fontWeight:600,padding:"2px 8px",borderRadius:99,background:(STAGE_COLORS[st]||T.ink3)+"22",color:STAGE_COLORS[st]||T.ink3}}>{st}</span>
                      </td>
                    </tr>
                  );
                })}</tbody>
              </table>
            </div>
          </div>

          {err&&<div style={{color:"#f87171",fontSize:12,marginBottom:10}}>{err}</div>}
          <div style={{display:"flex",gap:10}}>
            <button onClick={()=>setParsed(null)} style={{background:"transparent",border:"1px solid "+T.bg3,borderRadius:10,padding:"11px 18px",color:T.ink3,fontSize:13,cursor:"pointer"}}>← Back</button>
            <button onClick={doImport} disabled={loading} style={{flex:1,background:loading?T.bg2:"linear-gradient(135deg,#10b981,#3b82f6)",border:"none",borderRadius:10,padding:"11px 20px",color:"#fff",fontSize:14,fontWeight:700,cursor:loading?"not-allowed":"pointer",opacity:loading?0.7:1}}>
              {loading?"Importing…":`Import ${buildDonors().length} Donors →`}
            </button>
          </div>
        </>)}
      </div>
    </div>
  );
}

// ── Follow-up Task Modal ───────────────────────────────────────────────────
function FollowUpTaskModal({donor,onSave,onClose}){
  const due7=new Date();due7.setDate(due7.getDate()+7);
  const[title,setTitle]=useState(`Follow up: ${donor.name}`);
  const[due,setDue]=useState(due7.toISOString().split("T")[0]);
  const[priority,setPriority]=useState("medium");
  const[loading,setLoading]=useState(false);
  const inp={width:"100%",background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"10px 12px",color:T.ink,fontSize:13,outline:"none",fontFamily:"inherit",boxSizing:"border-box"};
  const save=async()=>{
    if(!title.trim())return;setLoading(true);
    try{
      const raw=await apiFetch("/tasks",{method:"POST",body:JSON.stringify({title,due,priority,type:"donor",donorId:donor.id})});
      onSave({id:raw.id,title:raw.title,due:raw.due||"",priority:raw.priority,type:raw.type,done:!!raw.done,donorId:donor.id});
    }catch(e){console.error(e);}
    setLoading(false);
  };
  return(
    <div className="modal-sheet-overlay" style={{position:"fixed",inset:0,background:"#000000cc",backdropFilter:"blur(4px)",zIndex:400,display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
      <div className="fade-in modal-sheet-inner" style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:18,width:"100%",maxWidth:420,padding:24,boxShadow:"0 4px 32px rgba(15,15,15,0.12)"}}>
        <div style={{fontSize:16,fontWeight:800,color:T.ink,marginBottom:2}}>Create Follow-up Task</div>
        <div style={{fontSize:12,color:T.ink3,marginBottom:20}}>For {donor.name}</div>
        <div style={{display:"flex",flexDirection:"column",gap:12}}>
          <div>
            <div style={{fontSize:11,fontWeight:700,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:5}}>Task Title</div>
            <input value={title} onChange={e=>setTitle(e.target.value)} style={inp}/>
          </div>
          <div>
            <div style={{fontSize:11,fontWeight:700,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:5}}>Due Date</div>
            <input type="date" value={due} onChange={e=>setDue(e.target.value)} style={inp}/>
          </div>
          <div>
            <div style={{fontSize:11,fontWeight:700,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:8}}>Priority</div>
            <div style={{display:"flex",gap:6}}>
              {["high","medium","low"].map(p=>(
                <button key={p} onClick={()=>setPriority(p)} style={{flex:1,background:priority===p?SC[p]:T.bg,border:`1px solid ${priority===p?SC[p]:T.bg3}`,borderRadius:8,padding:"8px",color:priority===p?"#fff":T.ink3,fontSize:12,fontWeight:600,cursor:"pointer",textTransform:"capitalize"}}>{p}</button>
              ))}
            </div>
          </div>
        </div>
        <div style={{display:"flex",gap:8,marginTop:20}}>
          <button onClick={save} disabled={loading||!title.trim()} style={{flex:1,background:title.trim()?"#10b981":T.bg2,border:"none",borderRadius:10,padding:"12px",color:"#fff",fontSize:14,fontWeight:700,cursor:title.trim()?"pointer":"not-allowed"}}>{loading?"Creating…":"Create Task"}</button>
          <button onClick={onClose} style={{background:T.bg,border:"none",borderRadius:10,padding:"12px 16px",color:T.ink3,fontSize:13,cursor:"pointer"}}>Skip</button>
        </div>
      </div>
    </div>
  );
}

// ── Log Touchpoint Modal ───────────────────────────────────────────────────
function LogTouchpointModal({donor,onSave,onClose}){
  const[type,setType]=useState("call");
  const[date,setDate]=useState(new Date().toISOString().split("T")[0]);
  const[loading,setLoading]=useState(false);
  const[kt1,setKt1]=useState("");const[kt2,setKt2]=useState("");const[kt3,setKt3]=useState("");
  const[history,setHistory]=useState("");const[spouse,setSpouse]=useState("");const[nextStep,setNextStep]=useState("");
  const[answered,setAnswered]=useState("yes");const[duration,setDuration]=useState("");const[objections,setObjections]=useState("");
  const[attendees,setAttendees]=useState("");const[location,setLocation]=useState("");
  const[sentiment,setSentiment]=useState("Positive");const[asksMade,setAsksMade]=useState("");
  const[subject,setSubject]=useState("");const[summary,setSummary]=useState("");const[responded,setResponded]=useState("no");
  const[eventName,setEventName]=useState("");const[attended,setAttended]=useState("yes");const[observations,setObservations]=useState("");
  const[amount,setAmount]=useState("");const[designation,setDesignation]=useState("");
  const[payMethod,setPayMethod]=useState("");const[ackSent,setAckSent]=useState("no");
  const[otherNotes,setOtherNotes]=useState("");
  const[finFunds,setFinFunds]=useState([]);const[finFundId,setFinFundId]=useState("");const[finAcctId,setFinAcctId]=useState("");
  useEffect(()=>{
    Promise.all([apiFetch("/finance/funds"),apiFetch("/finance/accounts")]).then(([fds,accts])=>{
      setFinFunds(fds);
      const def=fds.find(f=>!f.restricted)||fds[0];if(def)setFinFundId(def.id);
      const ca=accts.find(a=>a.type==="revenue"&&(a.code==="4010"||a.name.toLowerCase().includes("contribution")))||accts.find(a=>a.type==="revenue");
      if(ca)setFinAcctId(ca.id);
    }).catch(()=>{});
  },[]);

  const TYPES=[["call","Call"],["meeting","Meeting"],["email","Email"],["event","Event"],["gift","Gift/Pledge"],["other","Other"]];

  const buildNote=()=>{
    const L=[];
    const add=(k,v)=>{if(v&&String(v).trim())L.push(`${k}: ${v.trim()}`);};
    if(type==="call"){
      L.push(`Answered: ${answered}`);
      add("Duration",duration);add("Key Takeaway 1",kt1);add("Key Takeaway 2",kt2);add("Key Takeaway 3",kt3);
      add("Objections / Concerns",objections);add("Donor History",history);add("Spouse / Partner",spouse);add("Next Step",nextStep);
    }else if(type==="meeting"){
      add("Attendees",attendees);add("Location",location);
      add("Key Takeaway 1",kt1);add("Key Takeaway 2",kt2);add("Key Takeaway 3",kt3);
      L.push(`Donor Sentiment: ${sentiment}`);
      add("Spouse / Partner",spouse);add("Donor History",history);add("Asks Made",asksMade);add("Next Step",nextStep);
    }else if(type==="email"){
      add("Subject",subject);add("Summary",summary);
      L.push(`Response Received: ${responded}`);
      add("Donor History",history);add("Next Step",nextStep);
    }else if(type==="event"){
      add("Event",eventName);L.push(`Donor Attended: ${attended}`);
      add("Observations",observations);add("Donor History",history);add("Next Step",nextStep);
    }else if(type==="gift"){
      add("Amount",amount);add("Designation",designation);
      add("Payment Method",payMethod);L.push(`Acknowledgement Sent: ${ackSent}`);add("Next Step",nextStep);
    }else{
      add("Notes",otherNotes);add("Donor History",history);add("Spouse / Partner",spouse);add("Next Step",nextStep);
    }
    return L.join("\n");
  };

  const save=async()=>{
    const note=buildNote();if(!note.trim())return;setLoading(true);
    try{
      const saveType=type==="gift"?"gift":type==="meeting"?"meeting":type;
      await apiFetch(`/donors/${donor.id}/interactions`,{method:"POST",body:JSON.stringify({type:saveType,note,date})});
      const giftAmt=type==="gift"?(parseFloat(String(amount).replace(/[$,]/g,""))||0):0;
      if(type==="gift"&&giftAmt>0){
        await apiFetch(`/donors/${donor.id}/gifts`,{method:"POST",body:JSON.stringify({amount:giftAmt,date,notes:note})});
        if(finAcctId){
          try{
            await apiFetch("/finance/transactions",{method:"POST",body:JSON.stringify({
              date,description:`Gift from ${donor.name}`,vendorDonor:donor.name,
              amount:giftAmt,type:"income",accountId:finAcctId,fundId:finFundId||"",notes:note,
            })});
          }catch(e){console.error("Finance sync:",e);}
        }
      }
      onSave({type:saveType,note,date,amount:giftAmt});
    }catch(e){console.error(e);}
    setLoading(false);
  };

  const inp={width:"100%",background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"10px 12px",color:T.ink,fontSize:13,outline:"none",fontFamily:"inherit",boxSizing:"border-box"};
  const ta={...inp,resize:"vertical",lineHeight:1.55};
  const canSave=buildNote().trim().length>0;

  return(
    <div className="modal-sheet-overlay" style={{position:"fixed",inset:0,background:"#000000cc",backdropFilter:"blur(4px)",zIndex:300,display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
      <div className="fade-in modal-sheet-inner" style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:18,width:"100%",maxWidth:520,maxHeight:"92vh",overflowY:"auto",padding:24,boxShadow:"0 4px 32px rgba(15,15,15,0.12)"}}>
        <div style={{fontSize:16,fontWeight:800,color:T.ink,marginBottom:2}}>Log Touchpoint</div>
        <div style={{fontSize:12,color:T.ink3,marginBottom:16}}>{donor.name}</div>
        <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:16}}>
          {TYPES.map(([v,l])=><button key={v} onClick={()=>setType(v)} style={{background:type===v?"#10b981":T.bg2,border:`1px solid ${type===v?"#10b981":T.bg3}`,borderRadius:7,padding:"5px 13px",color:type===v?"#fff":T.ink3,fontSize:12,fontWeight:600,cursor:"pointer"}}>{l}</button>)}
        </div>
        <div style={{marginBottom:16}}><span style={{fontSize:11,fontWeight:700,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:5,display:"block"}}>Date</span><input type="date" value={date} onChange={e=>setDate(e.target.value)} style={inp}/></div>
        <div style={{display:"flex",flexDirection:"column",gap:14,marginBottom:20}}>
          {type==="call"&&<>
            <TpField label="Answered?"><TpYesNo val={answered} set={setAnswered}/></TpField>
            <TpField label="Duration"><input value={duration} onChange={e=>setDuration(e.target.value)} placeholder="e.g. 20 min" style={inp}/></TpField>
            <TpField label="Key Takeaway 1"><textarea value={kt1} onChange={e=>setKt1(e.target.value)} rows={2} style={ta}/></TpField>
            <TpField label="Key Takeaway 2"><textarea value={kt2} onChange={e=>setKt2(e.target.value)} rows={2} style={ta}/></TpField>
            <TpField label="Key Takeaway 3"><textarea value={kt3} onChange={e=>setKt3(e.target.value)} rows={2} style={ta}/></TpField>
            <TpField label="Objections / Concerns"><textarea value={objections} onChange={e=>setObjections(e.target.value)} rows={2} style={ta}/></TpField>
            <TpField label="Donor History & Background"><textarea value={history} onChange={e=>setHistory(e.target.value)} placeholder="Past relationship, giving context, background…" rows={3} style={ta}/></TpField>
            <TpField label="Spouse / Partner"><input value={spouse} onChange={e=>setSpouse(e.target.value)} placeholder="Name and relevant details" style={inp}/></TpField>
            <TpField label="Next Steps"><textarea value={nextStep} onChange={e=>setNextStep(e.target.value)} placeholder="Specific actions planned…" rows={3} style={ta}/></TpField>
          </>}
          {type==="meeting"&&<>
            <TpField label="Attendees"><input value={attendees} onChange={e=>setAttendees(e.target.value)} placeholder="Names of everyone present" style={inp}/></TpField>
            <TpField label="Location"><input value={location} onChange={e=>setLocation(e.target.value)} style={inp}/></TpField>
            <TpField label="Key Takeaway 1"><textarea value={kt1} onChange={e=>setKt1(e.target.value)} rows={2} style={ta}/></TpField>
            <TpField label="Key Takeaway 2"><textarea value={kt2} onChange={e=>setKt2(e.target.value)} rows={2} style={ta}/></TpField>
            <TpField label="Key Takeaway 3"><textarea value={kt3} onChange={e=>setKt3(e.target.value)} rows={2} style={ta}/></TpField>
            <TpField label="Donor Sentiment">
              <select value={sentiment} onChange={e=>setSentiment(e.target.value)} style={{...inp,cursor:"pointer"}}>
                {["Enthusiastic","Positive","Neutral","Hesitant"].map(s=><option key={s}>{s}</option>)}
              </select>
            </TpField>
            <TpField label="Spouse / Partner"><input value={spouse} onChange={e=>setSpouse(e.target.value)} placeholder="Name and relevant details" style={inp}/></TpField>
            <TpField label="Donor History & Background"><textarea value={history} onChange={e=>setHistory(e.target.value)} placeholder="Past relationship, context…" rows={3} style={ta}/></TpField>
            <TpField label="Asks Made"><textarea value={asksMade} onChange={e=>setAsksMade(e.target.value)} rows={2} style={ta}/></TpField>
            <TpField label="Next Steps"><textarea value={nextStep} onChange={e=>setNextStep(e.target.value)} placeholder="Specific actions planned…" rows={3} style={ta}/></TpField>
          </>}
          {type==="email"&&<>
            <TpField label="Subject"><input value={subject} onChange={e=>setSubject(e.target.value)} style={inp}/></TpField>
            <TpField label="Summary"><textarea value={summary} onChange={e=>setSummary(e.target.value)} rows={4} style={ta}/></TpField>
            <TpField label="Response Received?"><TpYesNo val={responded} set={setResponded}/></TpField>
            <TpField label="Donor History & Background"><textarea value={history} onChange={e=>setHistory(e.target.value)} placeholder="Context for this outreach…" rows={3} style={ta}/></TpField>
            <TpField label="Next Steps"><textarea value={nextStep} onChange={e=>setNextStep(e.target.value)} placeholder="Specific actions planned…" rows={3} style={ta}/></TpField>
          </>}
          {type==="event"&&<>
            <TpField label="Event Name"><input value={eventName} onChange={e=>setEventName(e.target.value)} style={inp}/></TpField>
            <TpField label="Donor Attended?"><TpYesNo val={attended} set={setAttended}/></TpField>
            <TpField label="Interactions & Observations"><textarea value={observations} onChange={e=>setObservations(e.target.value)} rows={4} style={ta}/></TpField>
            <TpField label="Donor History & Background"><textarea value={history} onChange={e=>setHistory(e.target.value)} rows={3} style={ta}/></TpField>
            <TpField label="Next Steps"><textarea value={nextStep} onChange={e=>setNextStep(e.target.value)} placeholder="Specific actions planned…" rows={3} style={ta}/></TpField>
          </>}
          {type==="gift"&&<>
            <TpField label="Amount"><input type="text" value={amount} onChange={e=>setAmount(e.target.value)} placeholder="e.g. 5,000" style={inp}/></TpField>
            <TpField label="Designation"><input value={designation} onChange={e=>setDesignation(e.target.value)} placeholder="e.g. General Operating, Arts Education…" style={inp}/></TpField>
            <TpField label="Payment Method"><input value={payMethod} onChange={e=>setPayMethod(e.target.value)} placeholder="Check, ACH, Credit Card, Stock…" style={inp}/></TpField>
            <TpField label="Acknowledgement Sent?"><TpYesNo val={ackSent} set={setAckSent}/></TpField>
            {finFunds.length>0&&<TpField label="Finance Fund">
              <select value={finFundId} onChange={e=>setFinFundId(e.target.value)} style={{...inp,cursor:"pointer"}}>
                <option value="">— no fund —</option>
                {finFunds.map(f=><option key={f.id} value={f.id}>{f.name}{f.restricted?" (Restricted)":""}</option>)}
              </select>
            </TpField>}
            <TpField label="Next Steps"><textarea value={nextStep} onChange={e=>setNextStep(e.target.value)} placeholder="Specific actions planned…" rows={3} style={ta}/></TpField>
          </>}
          {type==="other"&&<>
            <TpField label="Notes"><textarea value={otherNotes} onChange={e=>setOtherNotes(e.target.value)} rows={5} style={ta}/></TpField>
            <TpField label="Donor History & Background"><textarea value={history} onChange={e=>setHistory(e.target.value)} placeholder="Past relationship, context…" rows={3} style={ta}/></TpField>
            <TpField label="Spouse / Partner"><input value={spouse} onChange={e=>setSpouse(e.target.value)} placeholder="Name and relevant details" style={inp}/></TpField>
            <TpField label="Next Steps"><textarea value={nextStep} onChange={e=>setNextStep(e.target.value)} placeholder="Specific actions planned…" rows={3} style={ta}/></TpField>
          </>}
        </div>
        <div style={{display:"flex",gap:8}}>
          <button onClick={save} disabled={loading||!canSave} style={{flex:1,background:canSave?"#10b981":T.bg2,border:"none",borderRadius:10,padding:"12px",color:"#fff",fontSize:14,fontWeight:700,cursor:canSave?"pointer":"not-allowed"}}>{loading?"Saving…":"Save Touchpoint"}</button>
          <button onClick={onClose} style={{background:T.bg,border:"none",borderRadius:10,padding:"12px 16px",color:T.ink3,fontSize:13,cursor:"pointer"}}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ── Edit Donor Modal ───────────────────────────────────────────────────────
function EditDonorModal({donor,onSave,onClose}){
  const inp={width:"100%",background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"9px 12px",color:T.ink,fontSize:13,outline:"none",fontFamily:"inherit",boxSizing:"border-box"};
  const[form,setForm]=useState({
    name:donor.name||"",email:donor.email||"",phone:donor.phone||"",
    notes:donor.notes||"",tags:(donor.tags||[]).join(", "),
    stage:donor.stage||"cultivate",status:donor.status||"new",
  });
  const[loading,setLoading]=useState(false);
  const[err,setErr]=useState("");
  const set=k=>e=>setForm(p=>({...p,[k]:e.target.value}));

  const save=async()=>{
    if(!form.name.trim()){setErr("Name is required");return;}
    setLoading(true);setErr("");
    try{
      const tags=form.tags.split(",").map(t=>t.trim()).filter(Boolean);
      const res=await apiFetch(`/donors/${donor.id}`,{method:"PUT",body:JSON.stringify({...form,tags})});
      onSave(res);
    }catch(e){setErr(e.message||"Failed to save");}
    setLoading(false);
  };

  return(
    <div className="modal-sheet-overlay" style={{position:"fixed",inset:0,background:"#000c",zIndex:400,display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
      <div className="modal-sheet-inner" style={{background:"#ffffff",border:"1px solid "+T.bg3,borderRadius:20,width:"100%",maxWidth:480,padding:28,boxSizing:"border-box",overflowY:"auto"}}>
        <div style={{fontSize:18,fontWeight:800,color:T.ink,marginBottom:4}}>Edit Donor Profile</div>
        <div style={{fontSize:12,color:T.ink3,marginBottom:20}}>{donor.name}</div>
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          {[["name","Full Name","text"],["email","Email","email"],["phone","Phone","tel"]].map(([k,pl,t])=>(
            <input key={k} type={t} value={form[k]} onChange={set(k)} placeholder={pl} style={inp}/>
          ))}
          <div>
            <div style={{fontSize:11,fontWeight:700,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:8}}>Stage</div>
            <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
              {STAGES.map(s=>(
                <button key={s.id} onClick={()=>setForm(p=>({...p,stage:s.id}))}
                  style={{background:form.stage===s.id?s.color+"22":T.bg,border:`1px solid ${form.stage===s.id?s.color:T.bg3}`,borderRadius:7,padding:"5px 11px",color:form.stage===s.id?s.color:T.ink3,fontSize:12,fontWeight:600,cursor:"pointer"}}>
                  {s.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div style={{fontSize:11,fontWeight:700,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:6}}>Tags <span style={{fontSize:10,fontWeight:400,textTransform:"none"}}>(comma-separated)</span></div>
            <input value={form.tags} onChange={set("tags")} placeholder="e.g. board-adjacent, recurring, arts" style={inp}/>
          </div>
          <div>
            <div style={{fontSize:11,fontWeight:700,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:6}}>Notes</div>
            <textarea value={form.notes} onChange={set("notes")} rows={3} style={{...inp,resize:"vertical",lineHeight:1.5}}/>
          </div>
          {err&&<div style={{color:"#f87171",fontSize:12}}>{err}</div>}
          <div style={{display:"flex",gap:8,marginTop:4}}>
            <button onClick={save} disabled={loading} style={{flex:1,background:loading?T.bg2:"#10b981",border:"none",borderRadius:10,padding:"11px",color:"#fff",fontSize:14,fontWeight:700,cursor:loading?"not-allowed":"pointer"}}>
              {loading?"Saving…":"Save Changes"}
            </button>
            <button onClick={onClose} style={{background:T.bg,border:"none",borderRadius:10,padding:"11px 14px",color:T.ink3,fontSize:13,cursor:"pointer"}}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Gift Link Modal ────────────────────────────────────────────────────────
function GiftLinkModal({donor,orgName,onClose}){
  const[url,setUrl]=useState("");
  const[loading,setLoading]=useState(true);
  const[err,setErr]=useState("");
  const[copied,setCopied]=useState(false);
  const[showEmail,setShowEmail]=useState(false);
  const[emailSubject,setEmailSubject]=useState(`A quick way to give to ${orgName}`);
  const[emailBody,setEmailBody]=useState(
    `<p>Hi ${donor.name.split(" ")[0]},</p>\n<p>Thank you so much for your continued support of ${orgName}. Your generosity makes our work possible.</p>\n<p>If you'd like to make a gift online, we've made it simple:</p>\n<p><a href="PAYMENT_LINK">Give now →</a></p>\n<p>It only takes a moment, and every gift goes directly to our programs. Thank you for everything you do for our mission.</p>\n<p>With gratitude,<br>The ${orgName} Team</p>`
  );
  const[sending,setSending]=useState(false);
  const[sent,setSent]=useState(false);
  const[sendErr,setSendErr]=useState("");

  useEffect(()=>{
    apiFetch("/stripe/donation-page",{method:"POST",body:JSON.stringify({donorName:donor.name,donorEmail:donor.email})})
      .then(r=>{setUrl(r.url);setEmailBody(b=>b.replace("PAYMENT_LINK",r.url));})
      .catch(e=>setErr(e.message||"Could not create payment link"))
      .finally(()=>setLoading(false));
  },[]);

  const copyLink=()=>{
    if(!url)return;
    navigator.clipboard.writeText(url).then(()=>{setCopied(true);setTimeout(()=>setCopied(false),2500);});
  };

  const sendEmail=async()=>{
    if(!donor.email){setSendErr("This donor has no email address.");return;}
    setSending(true);setSendErr("");
    try{
      const seg={mode:"manual",donorIds:[donor.id]};
      const created=await apiFetch("/campaigns",{method:"POST",body:JSON.stringify({
        name:`Gift request — ${donor.name}`,subject:emailSubject,body:emailBody,segment:seg,status:"draft"
      })});
      await apiFetch(`/campaigns/${created.id}/send`,{method:"POST"});
      setSent(true);
    }catch(e){setSendErr(e.message||"Failed to send email");}
    setSending(false);
  };

  const inp={width:"100%",boxSizing:"border-box",background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"9px 12px",color:T.ink,fontSize:13,outline:"none",fontFamily:"inherit"};

  return(
    <div style={{position:"fixed",inset:0,background:"#000000cc",zIndex:500,display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
      <div style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:18,width:"100%",maxWidth:480,padding:24,boxShadow:"0 8px 40px rgba(0,0,0,0.18)"}}>
        {!showEmail?(
          <>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
              <div>
                <div style={{fontSize:16,fontWeight:800,color:T.ink}}>Request Gift</div>
                <div style={{fontSize:12,color:T.ink3,marginTop:2}}>For {donor.name}</div>
              </div>
              <button onClick={onClose} style={{background:"none",border:"none",fontSize:20,cursor:"pointer",color:T.ink3}}>×</button>
            </div>
            {loading&&<div style={{padding:"24px 0",textAlign:"center",color:T.ink3,fontSize:13}}>Generating payment link…</div>}
            {err&&<div style={{color:"#dc2626",fontSize:13,background:"#fef2f2",border:"1px solid #fecaca",borderRadius:8,padding:"10px 12px",marginBottom:14}}>{err}</div>}
            {url&&!loading&&(
              <>
                <div style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:10,padding:"10px 14px",fontSize:12,color:T.ink3,wordBreak:"break-all",lineHeight:1.5,marginBottom:16}}>{url}</div>
                <div style={{display:"flex",gap:10}}>
                  <button onClick={copyLink} style={{flex:1,background:copied?T.greenDk:T.bg,border:"1px solid "+(copied?T.greenDk:T.bg3),borderRadius:10,padding:"11px",color:copied?"#fff":T.ink2,fontSize:13,fontWeight:700,cursor:"pointer",transition:"all 0.15s"}}>
                    {copied?"✓ Copied!":"Copy Link"}
                  </button>
                  {donor.email&&<button onClick={()=>setShowEmail(true)} style={{flex:1,background:T.greenDk,border:"none",borderRadius:10,padding:"11px",color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer"}}>
                    ✉ Send via Email
                  </button>}
                </div>
              </>
            )}
          </>
        ):(
          <>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
              <div>
                <div style={{fontSize:16,fontWeight:800,color:T.ink}}>Send via Email</div>
                <div style={{fontSize:12,color:T.ink3,marginTop:2}}>To: {donor.email}</div>
              </div>
              <button onClick={()=>setShowEmail(false)} style={{background:"none",border:"none",fontSize:13,cursor:"pointer",color:T.ink3}}>← Back</button>
            </div>
            {sent?(
              <div style={{textAlign:"center",padding:"20px 0"}}>
                <div style={{fontSize:28,marginBottom:10}}>✓</div>
                <div style={{fontSize:15,fontWeight:700,color:T.ink,marginBottom:6}}>Email sent!</div>
                <div style={{fontSize:13,color:T.ink3,marginBottom:20}}>Your message to {donor.name} has been sent.</div>
                <button onClick={onClose} style={{background:T.greenDk,border:"none",borderRadius:10,padding:"11px 24px",color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer"}}>Done</button>
              </div>
            ):(
              <>
                <div style={{display:"flex",flexDirection:"column",gap:12,marginBottom:16}}>
                  <div>
                    <div style={{fontSize:11,fontWeight:700,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:5}}>Subject</div>
                    <input value={emailSubject} onChange={e=>setEmailSubject(e.target.value)} style={inp}/>
                  </div>
                  <div>
                    <div style={{fontSize:11,fontWeight:700,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:5}}>Message</div>
                    <textarea value={emailBody} onChange={e=>setEmailBody(e.target.value)} rows={8}
                      style={{...inp,resize:"vertical",lineHeight:1.55,fontSize:12}}/>
                  </div>
                </div>
                {sendErr&&<div style={{color:"#dc2626",fontSize:13,background:"#fef2f2",border:"1px solid #fecaca",borderRadius:8,padding:"8px 12px",marginBottom:12}}>{sendErr}</div>}
                <div style={{display:"flex",gap:8}}>
                  <button onClick={sendEmail} disabled={sending} style={{flex:1,background:sending?T.bg3:T.greenDk,border:"none",borderRadius:10,padding:"11px",color:"#fff",fontSize:13,fontWeight:700,cursor:sending?"not-allowed":"pointer"}}>
                    {sending?"Sending…":"Send Email"}
                  </button>
                  <button onClick={()=>setShowEmail(false)} style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:10,padding:"11px 14px",color:T.ink3,fontSize:13,cursor:"pointer"}}>Cancel</button>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── Donor Profile ──────────────────────────────────────────────────────────
function DonorProfile({donor,onClose,onStageChange,onLogTouchpoint,aiMap,loadingKey,getAI,isAdmin,onEdit,onDelete,tasks=[],onTaskToggle,orgName="",orgTeam=[],onReassign,onCfSaved}){
  const [gifts,setGifts]=useState([]);
  const [giftLoading,setGiftLoading]=useState(true);
  const [sequences,setSequences]=useState([]);
  useEffect(()=>{apiFetch("/sequences").then(rows=>setSequences(Array.isArray(rows)?rows.filter(s=>s.status==="active"):[])).catch(()=>{});},[]);

  const [cfData,setCfData]=useState([]);
  const [cfEditing,setCfEditing]=useState(null);
  const [cfEditVal,setCfEditVal]=useState("");
  const [cfSaved,setCfSaved]=useState(null);
  useEffect(()=>{apiFetch(`/donors/${donor.id}/custom-fields`).then(rows=>setCfData(Array.isArray(rows)?rows:[])).catch(()=>{});},[donor.id]);
  const [localScore,setLocalScore]=useState(donor.wealthScore??null);
  const [localTier,setLocalTier]=useState(donor.capacityTier??null);
  const [localConf,setLocalConf]=useState(donor.scoreConfidence??null);
  const [localRationale,setLocalRationale]=useState(donor.scoreRationale??null);
  const [scoreLoading,setScoreLoading]=useState(false);

  const wsc=localScore===null?T.ink3:localScore<=3?"#6b7280":localScore<=5?"#3b82f6":localScore<=7?"#1a6b4a":localScore<=9?"#8b5cf6":"#f59e0b";

  const recalcScore=async()=>{
    setScoreLoading(true);
    try{
      const r=await apiFetch(`/donors/${donor.id}/score`,{method:"POST"});
      setLocalScore(r.wealthScore);setLocalTier(r.capacityTier);
      setLocalConf(r.scoreConfidence);setLocalRationale(r.scoreRationale);
    }catch(e){console.error(e);}
    setScoreLoading(false);
  };

  const [showReassign,setShowReassign]=useState(false);
  const [reassignId,setReassignId]=useState(donor.assignedTo||"");
  const [reassignLoading,setReassignLoading]=useState(false);

  const handleReassign=async()=>{
    const member=orgTeam.find(u=>u.id===reassignId);
    if(!member)return;
    setReassignLoading(true);
    try{
      const prevOwner=donor.assignedToName||"nobody";
      await apiFetch(`/donors/${donor.id}/assign`,{method:"PATCH",body:JSON.stringify({assignedTo:member.id,assignedToName:member.name})});
      await apiFetch(`/donors/${donor.id}/interactions`,{method:"POST",body:JSON.stringify({
        type:"other",note:`Reassigned from ${prevOwner} to ${member.name}`,
        date:new Date().toISOString().split("T")[0]
      })});
      if(onReassign)onReassign(donor.id,member.id,member.name);
      setShowReassign(false);
    }catch(e){console.error(e);}
    setReassignLoading(false);
  };

  const [showGiftModal,setShowGiftModal]=useState(false);
  const [seqOpen,setSeqOpen]=useState(false);
  const [seqId,setSeqId]=useState("");
  const [seqLoading,setSeqLoading]=useState(false);
  const [seqToast,setSeqToast]=useState("");

  const stage=STAGES.find(s=>s.id===(donor.stage||"cultivate"))||STAGES[2];
  const sc=donorScore(donor);const scoreColor=sc>70?"#1a6b4a":sc>45?"#f59e0b":"#ef4444";
  const urg=moveUrgency(donor);

  const interactionCount=donor.interactions?.length||0;
  useEffect(()=>{
    setGiftLoading(true);
    apiFetch(`/donors/${donor.id}`).then(raw=>{
      setGifts((raw.gifts||[]).map(g=>({amount:g.amount||0,date:g.date||g.created_at?.split("T")[0]})));
    }).catch(()=>{}).finally(()=>setGiftLoading(false));
  },[donor.id,interactionCount]);

  useEffect(()=>{
    if(!aiMap[`${donor.id}_nextmove`])getAI(donor,"nextmove");
  },[donor.id]);

  const sortedGifts=[...gifts].sort((a,b)=>new Date(b.date)-new Date(a.date));
  const lastGiftDisplay=giftLoading?"…":sortedGifts.length>0?fmtFull(sortedGifts[0].amount):fmtFull(donor.lastAmount);

  return(
    <div className="fade-in" style={{position:"fixed",inset:0,background:T.bg,zIndex:200,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      {showGiftModal&&<GiftLinkModal donor={donor} orgName={orgName} onClose={()=>setShowGiftModal(false)}/>}
      <div className="donor-profile-header" style={{background:T.white,borderBottom:"1px solid "+T.bg3,padding:"10px 24px",display:"flex",alignItems:"center",gap:12,flexShrink:0}}>
        <button onClick={onClose} style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"7px 14px",color:T.ink3,fontSize:13,cursor:"pointer",whiteSpace:"nowrap"}}>← Back</button>
        <div style={{width:34,height:34,borderRadius:"50%",background:stage.color+"33",display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,fontWeight:800,color:stage.color,flexShrink:0}}>{donor.name[0]}</div>
        <div style={{flex:1,minWidth:0}}>
          <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
            <span style={{fontSize:16,fontWeight:800,color:T.ink,letterSpacing:"-0.01em"}}>{donor.name}</span>
            <span style={{fontSize:10,fontWeight:700,padding:"3px 9px",borderRadius:99,background:stage.color+"22",color:stage.color}}>{stage.label}</span>
            <span style={{fontSize:11,color:T.ink3}}>{donor.email}</span>
          </div>
          <div style={{fontSize:11,color:T.ink3,marginTop:2}}>{fmtFull(donor.total)} lifetime · {donor.gifts} gifts</div>
        </div>
        <div style={{display:"flex",gap:6,flexShrink:0,alignItems:"center"}}>
          <button onClick={()=>setShowGiftModal(true)} style={{background:T.green,border:"none",borderRadius:8,padding:"7px 14px",color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer"}}>
            💳 Request Gift
          </button>
          <button onClick={onEdit} style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"7px 14px",color:T.ink3,fontSize:13,cursor:"pointer"}}>Edit</button>
          {isAdmin&&<button onClick={()=>onDelete(donor.id)} style={{background:"transparent",border:"1px solid #ef444455",borderRadius:8,padding:"7px 14px",color:"#ef4444",fontSize:13,cursor:"pointer"}}>Delete</button>}
        </div>
      </div>

      <div className="donor-profile-body" style={{flex:1,display:"grid",gridTemplateColumns:"minmax(0,1.25fr) minmax(0,0.75fr)",overflow:"hidden"}}>
        {/* LEFT */}
        <div style={{overflowY:"auto",padding:"22px 20px 24px 24px",borderRight:"1px solid "+T.bg3,display:"flex",flexDirection:"column",gap:18}}>
          <div className="donor-stat-grid" style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10}}>
            {[["Lifetime",fmtFull(donor.total),T.ink],["Last Gift",lastGiftDisplay,"#1a6b4a"],["Contact",`${urg.days}d ago`,urg.urgencyColor],["Score",`${sc}/99`,scoreColor]].map(([l,v,c])=>(
              <div key={l} style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:12,padding:"12px 14px"}}>
                <div style={{fontSize:9,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.1em",color:T.ink3,marginBottom:4}}>{l}</div>
                <div style={{fontSize:20,fontWeight:800,color:c,fontFamily:"'DM Serif Display',serif",lineHeight:1.1}}>{v}</div>
              </div>
            ))}
          </div>

          <div style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:14,padding:"16px 18px"}}>
            <div style={{fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.1em",color:T.ink3,marginBottom:12}}>Giving History</div>
            {giftLoading?<div style={{height:80,display:"flex",alignItems:"center",justifyContent:"center",color:T.ink3,fontSize:12}}><Spin/></div>:<GivingHistoryChart gifts={gifts}/>}
          </div>

          {donor.tags?.length>0&&<div style={{display:"flex",gap:5,flexWrap:"wrap"}}>{donor.tags.map(t=><Pill key={t} label={t}/>)}</div>}
          {donor.notes&&<div style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:10,padding:"12px 14px",fontSize:13,color:T.ink3,lineHeight:1.6}}>{donor.notes}</div>}

          <div>
            <div style={{fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.1em",color:T.ink3,marginBottom:8}}>
              Follow-up Tasks
              {tasks.filter(t=>!t.done).length>0&&<span style={{marginLeft:6,background:"#1a6b4a",color:"#fff",borderRadius:99,padding:"1px 6px",fontSize:9,fontWeight:800}}>{tasks.filter(t=>!t.done).length}</span>}
            </div>
            {tasks.length===0
              ?<div style={{fontSize:12,color:T.ink3,fontStyle:"italic"}}>No tasks yet — create one after logging a touchpoint.</div>
              :<div style={{display:"flex",flexDirection:"column",gap:6}}>
                {[...tasks].sort((a,b)=>a.done-b.done||(a.due||"").localeCompare(b.due||"")).map(t=>{
                  const overdue=t.due&&!t.done&&daysDiff(t.due)<0;
                  return <div key={t.id} onClick={()=>onTaskToggle(t)} style={{background:T.white,border:`1px solid ${t.done?"#1a6b4a30":overdue?"#ef444430":T.bg3}`,borderRadius:10,padding:"10px 14px",cursor:"pointer",display:"flex",alignItems:"center",gap:10}}>
                    <div style={{width:18,height:18,borderRadius:5,border:`2px solid ${t.done?"#1a6b4a":SC[t.priority]}`,background:t.done?"#1a6b4a":"transparent",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center"}}>
                      {t.done&&<span style={{color:"#fff",fontSize:10,lineHeight:1}}>✓</span>}
                    </div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:12,fontWeight:500,color:t.done?T.ink3:T.ink,textDecoration:t.done?"line-through":"none",lineHeight:1.3}}>{t.title}</div>
                      {t.due&&<div style={{fontSize:11,color:overdue?"#ef4444":T.ink3,marginTop:2,fontWeight:overdue?700:400}}>
                        {overdue?"Overdue — was ":""}{new Date(t.due).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})}
                      </div>}
                    </div>
                    <Pill label={t.priority} color={SC[t.priority]}/>
                  </div>;
                })}
              </div>
            }
          </div>

          <div>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
              <div style={{fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.1em",color:T.ink3}}>Touchpoint Timeline</div>
              <button onClick={onLogTouchpoint} style={{background:"#10b981",border:"none",borderRadius:7,padding:"5px 12px",color:"#fff",fontSize:11,fontWeight:700,cursor:"pointer"}}>+ Log</button>
            </div>
            <TouchpointTimeline interactions={donor.interactions}/>
          </div>
        </div>

        {/* RIGHT */}
        <div style={{overflowY:"auto",padding:"22px 24px 24px 20px",display:"flex",flexDirection:"column",gap:18,background:"#0f1a12"}}>
          {donor.stripeSubscriptionStatus==="active"&&(
            <div style={{background:"#10b98110",border:"1px solid #10b98130",borderRadius:12,padding:"12px 14px",display:"flex",alignItems:"center",gap:8}}>
              <span style={{fontSize:16}}>🔁</span>
              <div>
                <div style={{fontSize:12,fontWeight:700,color:"#1a6b4a"}}>Recurring Donor</div>
                <div style={{fontSize:11,color:"#15803d",marginTop:1}}>Active {donor.stripeSubscriptionId?"subscription":"recurring gift"}</div>
              </div>
            </div>
          )}
          <div>
            <div style={{fontSize:10,fontWeight:800,textTransform:"uppercase",letterSpacing:"0.12em",color:"#8fa896",marginBottom:8}}>Relationship Owner</div>
            <div style={{background:"#1a2e1f",border:"1px solid #2d4a35",borderRadius:12,padding:"12px 14px"}}>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <div style={{width:28,height:28,borderRadius:"50%",background:T.greenDk+"44",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:800,color:"#10b981",flexShrink:0}}>{(donor.assignedToName||"?")[0]}</div>
                <div style={{flex:1,fontSize:13,fontWeight:600,color:"#f0ede6"}}>{donor.assignedToName||"Unassigned"}</div>
                {isAdmin&&<button onClick={()=>setShowReassign(v=>!v)} style={{background:"#0f1a12",border:"1px solid #2d4a35",borderRadius:7,padding:"3px 10px",color:"#8fa896",fontSize:11,cursor:"pointer"}}>{showReassign?"Cancel":"Reassign"}</button>}
              </div>
              {showReassign&&isAdmin&&<div style={{marginTop:10,display:"flex",flexDirection:"column",gap:8}}>
                <select value={reassignId} onChange={e=>setReassignId(e.target.value)} style={{width:"100%",background:"#0f1a12",border:"1px solid #2d4a35",borderRadius:8,padding:"8px 10px",color:"#f0ede6",fontSize:12,outline:"none",cursor:"pointer"}}>
                  <option value="">Select team member…</option>
                  {orgTeam.map(u=><option key={u.id} value={u.id}>{u.name} ({u.role})</option>)}
                </select>
                <button onClick={handleReassign} disabled={reassignLoading||!reassignId} style={{background:reassignId?T.greenDk:"#1a2e1f",border:"none",borderRadius:8,padding:"8px",color:"#f0ede6",fontSize:12,fontWeight:600,cursor:reassignId?"pointer":"not-allowed"}}>
                  {reassignLoading?"Saving…":"Confirm Reassignment"}
                </button>
              </div>}
            </div>
          </div>

          {sequences.length>0&&<div>
            <div style={{fontSize:10,fontWeight:800,textTransform:"uppercase",letterSpacing:"0.12em",color:"#8fa896",marginBottom:8}}>Sequences</div>
            {seqToast&&<div style={{background:"#0d5c3a22",border:"1px solid #10b981",borderRadius:8,padding:"8px 12px",fontSize:12,color:"#10b981",fontWeight:600,marginBottom:8}}>{seqToast}</div>}
            <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
              {!seqOpen?<button onClick={()=>{setSeqOpen(true);setSeqId("");}} style={{background:"#1a2e1f",border:"1px solid #2d4a35",borderRadius:8,padding:"6px 12px",fontSize:12,color:"#10b981",cursor:"pointer"}}>+ Enroll in sequence</button>
              :<>
                <select value={seqId} onChange={e=>setSeqId(e.target.value)} style={{background:"#0f1a12",border:"1px solid #2d4a35",borderRadius:8,padding:"6px 10px",color:"#f0ede6",fontSize:12,outline:"none",cursor:"pointer",flex:1}}>
                  <option value="">Select sequence…</option>
                  {sequences.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                <button disabled={!seqId||seqLoading} onClick={async()=>{
                  if(!seqId)return;setSeqLoading(true);
                  try{
                    await apiFetch(`/sequences/${seqId}/enroll`,{method:"POST",body:JSON.stringify({donorId:donor.id})});
                    const seqName=sequences.find(s=>s.id===seqId)?.name||"sequence";
                    setSeqToast(`Enrolled in "${seqName}"`);setTimeout(()=>setSeqToast(""),3500);
                    setSeqOpen(false);setSeqId("");
                  }catch(e){alert(e.message||"Could not enroll");}
                  setSeqLoading(false);
                }} style={{background:seqId?T.greenDk:"#1a2e1f",border:"none",borderRadius:8,padding:"6px 12px",color:"#f0ede6",fontSize:12,fontWeight:600,cursor:seqId?"pointer":"not-allowed"}}>
                  {seqLoading?"…":"Enroll"}
                </button>
                <button onClick={()=>{setSeqOpen(false);setSeqId("");}} style={{background:"transparent",border:"none",padding:"6px 8px",color:"#8fa896",fontSize:12,cursor:"pointer"}}>✕</button>
              </>}
            </div>
          </div>}

          {cfData.length>0&&<div>
            <div style={{fontSize:10,fontWeight:800,textTransform:"uppercase",letterSpacing:"0.12em",color:"#8fa896",marginBottom:8}}>Custom Fields</div>
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {cfData.map(f=>(
                <div key={f.fieldId} style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8}}>
                  <div style={{fontSize:12,color:"#8fa896",fontWeight:600,minWidth:90,flexShrink:0}}>{f.label}{f.required&&<span style={{color:"#f87171",marginLeft:2}}>*</span>}</div>
                  {cfEditing===f.fieldId?(
                    <div style={{display:"flex",gap:6,flex:1}}>
                      {f.fieldType==="checkbox"?(
                        <select value={cfEditVal} onChange={e=>setCfEditVal(e.target.value)}
                          style={{flex:1,background:"#0f1a12",border:"1px solid #2d4a35",borderRadius:8,padding:"5px 8px",fontSize:12,color:"#f0ede6",outline:"none"}}>
                          <option value="">—</option>
                          <option value="Yes">Yes</option>
                          <option value="No">No</option>
                        </select>
                      ):f.fieldType==="dropdown"?(
                        <select value={cfEditVal} onChange={e=>setCfEditVal(e.target.value)}
                          style={{flex:1,background:"#0f1a12",border:"1px solid #2d4a35",borderRadius:8,padding:"5px 8px",fontSize:12,color:"#f0ede6",outline:"none"}}>
                          <option value="">—</option>
                          {(f.options||[]).map(o=><option key={o} value={o}>{o}</option>)}
                        </select>
                      ):(
                        <input value={cfEditVal} onChange={e=>setCfEditVal(e.target.value)}
                          type={f.fieldType==="number"?"number":f.fieldType==="date"?"date":"text"}
                          style={{flex:1,background:"#0f1a12",border:"1px solid #2d4a35",borderRadius:8,padding:"5px 8px",fontSize:12,color:"#f0ede6",outline:"none"}}
                          onKeyDown={async e=>{
                            if(e.key==="Enter"){
                              await apiFetch(`/donors/${donor.id}/custom-fields`,{method:"POST",body:JSON.stringify({fieldId:f.fieldId,value:cfEditVal})});
                              setCfData(prev=>prev.map(x=>x.fieldId===f.fieldId?{...x,value:cfEditVal}:x));
                              setCfSaved(f.fieldId);setTimeout(()=>setCfSaved(null),2000);
                              setCfEditing(null);onCfSaved?.();
                            }else if(e.key==="Escape"){setCfEditing(null);}
                          }}
                          autoFocus
                        />
                      )}
                      <button onClick={async()=>{
                        await apiFetch(`/donors/${donor.id}/custom-fields`,{method:"POST",body:JSON.stringify({fieldId:f.fieldId,value:cfEditVal})});
                        setCfData(prev=>prev.map(x=>x.fieldId===f.fieldId?{...x,value:cfEditVal}:x));
                        setCfSaved(f.fieldId);setTimeout(()=>setCfSaved(null),2000);
                        setCfEditing(null);onCfSaved?.();
                      }} style={{background:T.greenDk,border:"none",borderRadius:8,padding:"5px 10px",color:"#f0ede6",fontSize:11,fontWeight:700,cursor:"pointer"}}>Save</button>
                      <button onClick={()=>setCfEditing(null)} style={{background:"transparent",border:"none",padding:"5px 8px",color:"#8fa896",fontSize:12,cursor:"pointer"}}>✕</button>
                    </div>
                  ):(
                    <div style={{display:"flex",alignItems:"center",gap:6,flex:1,justifyContent:"flex-end"}}>
                      <span style={{fontSize:12,color:f.value?"#f0ede6":"#8fa896",fontStyle:f.value?"normal":"italic"}}>
                        {cfSaved===f.fieldId?"Saved ✓":f.value||"—"}
                      </span>
                      <button onClick={()=>{setCfEditing(f.fieldId);setCfEditVal(f.value||"");}}
                        style={{background:"#1a2e1f",border:"1px solid #2d4a35",borderRadius:6,padding:"3px 8px",fontSize:10,color:"#10b981",cursor:"pointer"}}>Edit</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>}

          <div>
            <div style={{fontSize:10,fontWeight:800,textTransform:"uppercase",letterSpacing:"0.12em",color:"#8fa896",marginBottom:8}}>Move Stage</div>
            <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
              {STAGES.map(s=>(
                <button key={s.id} onClick={()=>onStageChange(donor.id,s.id)}
                  style={{background:(donor.stage||"cultivate")===s.id?s.color+"28":"#1a2e1f",border:`1px solid ${(donor.stage||"cultivate")===s.id?s.color:"#2d4a35"}`,borderRadius:8,padding:"6px 12px",color:(donor.stage||"cultivate")===s.id?s.color:"#8fa896",fontSize:12,fontWeight:600,cursor:"pointer"}}>
                  {s.label}
                </button>
              ))}
            </div>
            <div style={{marginTop:8,fontSize:11,color:"#8fa896",lineHeight:1.5,borderLeft:`2px solid ${stage.color}`,paddingLeft:8}}>
              {STAGE_ACTION[donor.stage||"cultivate"]}
            </div>
          </div>

          <div>
            <div style={{fontSize:10,fontWeight:800,textTransform:"uppercase",letterSpacing:"0.12em",color:"#8fa896",marginBottom:8}}>Wealth Score</div>
            <div style={{background:"#1a2e1f",border:"1px solid #2d4a35",borderRadius:14,padding:"16px"}}>
              {localScore!==null?(
                <>
                  <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:12}}>
                    <div style={{textAlign:"center",background:wsc+"22",border:`2px solid ${wsc}`,borderRadius:12,padding:"10px 14px",minWidth:56,flexShrink:0}}>
                      <div style={{fontSize:26,fontWeight:800,color:wsc,lineHeight:1,fontFamily:"'DM Serif Display',serif"}}>{localScore}</div>
                      <div style={{fontSize:9,color:"#8fa896",fontWeight:600,marginTop:2}}>/ 10</div>
                    </div>
                    <div>
                      <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:5}}>
                        <span style={{background:(TIER_COLOR[localTier]||"#8fa896")+"33",color:TIER_COLOR[localTier]||"#8fa896",borderRadius:99,padding:"3px 10px",fontSize:11,fontWeight:800,letterSpacing:"0.04em"}}>{localTier}</span>
                      </div>
                      <div style={{fontSize:10,color:"#8fa896",fontWeight:600}}>{localConf} confidence</div>
                    </div>
                  </div>
                  {localRationale&&<p style={{fontSize:12,color:"#8fa896",lineHeight:1.6,margin:"0 0 12px 0",fontStyle:"italic",borderLeft:"2px solid #2d4a35",paddingLeft:10}}>{localRationale}</p>}
                  <button onClick={recalcScore} disabled={scoreLoading} style={{background:"#0f1a12",border:"1px solid #2d4a35",borderRadius:8,padding:"6px",color:"#10b981",fontSize:11,fontWeight:600,cursor:"pointer",width:"100%",textAlign:"center"}}>{scoreLoading?"Calculating…":"↻ Recalculate"}</button>
                </>
              ):(
                <div style={{textAlign:"center",padding:"4px 0"}}>
                  <div style={{fontSize:12,color:"#8fa896",marginBottom:10}}>No score yet</div>
                  <button onClick={recalcScore} disabled={scoreLoading} style={{background:T.green,border:"none",borderRadius:8,padding:"8px 16px",color:"#fff",fontSize:12,fontWeight:600,cursor:"pointer"}}>{scoreLoading?"Calculating…":"Calculate Score"}</button>
                </div>
              )}
            </div>
          </div>

          <div>
            <div style={{fontSize:10,fontWeight:800,textTransform:"uppercase",letterSpacing:"0.12em",color:"#8fa896",marginBottom:8}}>AI Intelligence</div>
            <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:12}}>
              <AIBtn onClick={()=>getAI(donor,"nextmove")} loading={loadingKey===`${donor.id}_nextmove`} label="✦ Next Move" small/>
              <AIBtn onClick={()=>getAI(donor,"outreach")} loading={loadingKey===`${donor.id}_outreach`} label="✦ Outreach" small/>
              <AIBtn onClick={()=>getAI(donor,"email")} loading={loadingKey===`${donor.id}_email`} label="✦ Draft Email" small/>
              <AIBtn onClick={()=>getAI(donor,"callscript")} loading={loadingKey===`${donor.id}_callscript`} label="✦ Call Script" small/>
            </div>
            {["nextmove","outreach","email","callscript"].map(t=>aiMap[`${donor.id}_${t}`]?<AIPanel key={t} text={aiMap[`${donor.id}_${t}`]} onClose={()=>{}}/>:null)}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Donor Kanban ───────────────────────────────────────────────────────────
function DonorKanban({donors,onStageChange,onLogTouchpoint,onSelectDonor}){
  const[draggingId,setDraggingId]=useState(null);
  const[dragOver,setDragOver]=useState(null);
  const byStage=sid=>donors.filter(d=>(d.stage||"cultivate")===sid).sort((a,b)=>b.total-a.total);
  return(
    <div className="donor-kanban-wrap" style={{display:"grid",gridTemplateColumns:"repeat(6,1fr)",gap:8,minHeight:"calc(100vh - 260px)",alignItems:"flex-start",width:"100%"}}>
      {STAGES.map(stage=>{
        const cols=byStage(stage.id);
        const total=cols.reduce((s,d)=>s+d.total,0);
        const isOver=dragOver===stage.id;
        return(
          <div key={stage.id} className="kanban-col" style={{display:"flex",flexDirection:"column",gap:6}}
            onDragOver={e=>{e.preventDefault();setDragOver(stage.id);}}
            onDragLeave={e=>{if(!e.currentTarget.contains(e.relatedTarget))setDragOver(null);}}
            onDrop={e=>{e.preventDefault();const id=e.dataTransfer.getData("donorId");if(id)onStageChange(id,stage.id);setDragOver(null);}}>
            <div style={{
              background:"#0f1a12",
              border:`1px solid ${isOver?stage.color+"50":"#1a2e1f"}`,
              borderLeft:`3px solid ${stage.color}`,
              borderRadius:10,padding:"10px 12px 9px",
              transition:"background 0.12s,border-color 0.12s",
            }}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:4}}>
                <span style={{fontSize:9,fontWeight:800,color:"#8fa896",letterSpacing:"0.1em",textTransform:"uppercase"}}>{stage.label}</span>
                <span style={{background:stage.color+"28",color:stage.color,fontSize:10,fontWeight:800,borderRadius:99,padding:"1px 7px",border:`1px solid ${stage.color}40`,lineHeight:"16px"}}>{cols.length}</span>
              </div>
              <div style={{fontSize:13,fontWeight:700,color:total>0?"#f0ede6":"#8fa896",fontFamily:"'DM Serif Display',serif",letterSpacing:"-0.01em"}}>
                {total>0?fmt(total):"$0"}
              </div>
            </div>
            <div style={{
              display:"flex",flexDirection:"column",gap:6,flex:1,
              borderRadius:10,
              border:isOver?`2px dashed ${stage.color+"45"}`
                    :cols.length===0?`1px dashed ${T.bg3}`
                    :"1px dashed transparent",
              background:isOver?stage.color+"05":"transparent",
              padding:isOver?3:0,
              transition:"border-color 0.12s,background 0.12s",
              minHeight:cols.length===0?60:0,
            }}>
              {cols.map(d=>{
                const urg=moveUrgency(d);
                const sc=donorScore(d);
                const thisIsDragging=draggingId===d.id;
                const urgBg={critical:"#ef444407",due:"#f59e0b05",ok:"transparent"}[urg.level];
                const urgBorder={critical:"#ef444428",due:"#f59e0b28",ok:T.bg2}[urg.level];
                const scColor=sc>70?"#1a6b4a":sc>45?"#f59e0b":"#ef4444";
                return(
                  <div key={d.id} draggable
                    onDragStart={e=>{e.dataTransfer.setData("donorId",d.id);setDraggingId(d.id);}}
                    onDragEnd={()=>{setDraggingId(null);setDragOver(null);}}
                    style={{
                      border:`1px solid ${thisIsDragging?"transparent":urgBorder}`,
                      borderLeft:`3px solid ${stage.color}`,
                      borderRadius:10,padding:"13px 12px 10px",
                      cursor:"grab",opacity:thisIsDragging?0.2:1,
                      transition:"opacity 0.12s,box-shadow 0.12s,transform 0.12s",
                      userSelect:"none",
                      background:thisIsDragging?"transparent":T.white,
                      boxShadow:thisIsDragging?"none":"0 1px 3px rgba(10,10,10,0.07)",
                    }}>
                    <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:6,marginBottom:5}}>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontSize:13,fontWeight:700,color:T.ink,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",letterSpacing:"-0.01em"}}>{d.name}</div>
                        <div style={{fontSize:12,color:T.greenDk,marginTop:2,fontWeight:700}}>{fmt(d.total)}</div>
                      </div>
                      <div style={{background:scColor+"15",border:`1px solid ${scColor}30`,borderRadius:6,padding:"4px 7px",flexShrink:0,textAlign:"center",minWidth:30}}>
                        <div style={{fontSize:13,fontWeight:800,color:scColor,lineHeight:"1"}}>{sc}</div>
                      </div>
                    </div>
                    <div style={{display:"flex",alignItems:"center",gap:5,marginBottom:8}}>
                      <div style={{width:6,height:6,borderRadius:"50%",background:urg.urgencyColor,flexShrink:0}}/>
                      <span style={{fontSize:10,color:urg.contactTextColor,fontWeight:600}}>{urg.days}d since contact</span>
                    </div>
                    <div style={{display:"flex",gap:4}}>
                      <button onClick={e=>{e.stopPropagation();onLogTouchpoint(d);}}
                        style={{flex:1,background:T.bg,border:"1px solid "+T.bg3,borderRadius:6,padding:"4px 0",color:T.ink3,fontSize:11,fontWeight:600,cursor:"pointer"}}>
                        + Log
                      </button>
                      <button onClick={e=>{e.stopPropagation();onSelectDonor(d);}}
                        style={{flex:1,background:T.bg,border:"1px solid "+T.bg3,borderRadius:6,padding:"4px 0",color:T.ink3,fontSize:11,fontWeight:600,cursor:"pointer"}}>
                        View →
                      </button>
                    </div>
                  </div>
                );
              })}
              {isOver&&cols.length===0&&(
                <div style={{padding:"20px 8px",textAlign:"center",color:stage.color,fontSize:11,fontWeight:600,opacity:0.75}}>Drop here</div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Re-engage View ─────────────────────────────────────────────────────────
function ReEngageView({donors,org,onLogTouchpoint,onSelectDonor}){
  const lapsed=[...donors].filter(d=>d.stage==="lapsed"||(d.lastGift&&daysDiff(d.lastGift)>365)).sort((a,b)=>b.total-a.total);
  const totalValue=lapsed.reduce((s,d)=>s+d.total,0);
  const avgDays=lapsed.length
    ?Math.round(lapsed.reduce((s,d)=>s+daysDiff(d.lastGift||d.lastTouchpoint||new Date().toISOString()),0)/lapsed.length)
    :0;
  const[aiText,setAiText]=useState("");
  const[aiLoading,setAiLoading]=useState(false);

  const getStrategy=async()=>{
    setAiLoading(true);setAiText("");
    await askClaude(
      `You are a nonprofit major gifts officer. Be specific and tactical. Max 250 words.`,
      `Re-engagement strategy for ${org?.name||"this organization"}.\n\nLapsed donors: ${lapsed.length} total, ${fmtFull(totalValue)} combined lifetime value, avg ${avgDays} days lapsed.\n\nTop lapsed donors:\n${lapsed.slice(0,8).map(d=>`- ${d.name}: ${fmtFull(d.total)} lifetime, last gift ${d.lastGift||"unknown"} (${fmtFull(d.lastAmount)}), ${daysDiff(d.lastGift||d.lastTouchpoint||new Date().toISOString())}d lapsed`).join("\n")}\n\nProvide:\n1. Top 3 highest-priority donors to call this week and why\n2. Best re-engagement message angle for this portfolio\n3. One creative re-engagement tactic for the full group`,
      chunk=>setAiText(chunk)
    );
    setAiLoading(false);
  };

  if(!lapsed.length)return<EmptyState icon="♦" title="No lapsed donors" message="All your donors are active — great work!"/>;

  const fmtGiftDate=s=>{
    if(!s)return null;
    const dt=new Date(s);
    return isNaN(dt)?null:dt.toLocaleDateString("en-US",{month:"short",year:"numeric"});
  };

  const cols=["Donor","Lifetime Giving","Last Gift","Days Lapsed","Score",""];
  const colWidths="2fr 130px 130px 120px 80px 130px";

  return(
    <div style={{display:"flex",flexDirection:"column",gap:12}}>
      <div style={{display:"flex",gap:10,flexWrap:"wrap",alignItems:"center"}}>
        {[
          ["Lapsed donors",lapsed.length,T.ink],
          ["Total lapsed value",fmtFull(totalValue),T.ink],
          ["Avg days lapsed",`${avgDays}d`,"#ef4444"],
        ].map(([label,val,color])=>(
          <div key={label} style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:12,padding:"10px 18px",display:"flex",flexDirection:"column",gap:2}}>
            <div style={{fontSize:10,fontWeight:700,color:T.ink3,textTransform:"uppercase",letterSpacing:".06em"}}>{label}</div>
            <div style={{fontSize:20,fontWeight:800,color,fontFamily:"'DM Serif Display',serif"}}>{val}</div>
          </div>
        ))}
        <div style={{marginLeft:"auto"}}>
          <AIBtn onClick={getStrategy} loading={aiLoading} label="✦ Re-engage Plan"/>
        </div>
      </div>
      {(aiLoading||aiText)&&<AIPanel text={aiText} onClose={()=>setAiText("")}/>}
      <div style={{background:T.white,borderRadius:14,overflow:"hidden",border:"1px solid "+T.bg3}}>
        <div className="reEngage-header" style={{display:"grid",gridTemplateColumns:colWidths,gap:0,padding:"10px 18px",background:"#1a6b4a",borderBottom:"1px solid "+T.bg3}}>
          <div className="re-col-name" style={{fontSize:10,fontWeight:700,color:"#fff",textTransform:"uppercase",letterSpacing:".06em"}}>Donor</div>
          <div className="re-col-lifetime" style={{fontSize:10,fontWeight:700,color:"#fff",textTransform:"uppercase",letterSpacing:".06em",textAlign:"right"}}>Lifetime Giving</div>
          <div className="re-col-lastgift" style={{fontSize:10,fontWeight:700,color:"#fff",textTransform:"uppercase",letterSpacing:".06em",textAlign:"right"}}>Last Gift</div>
          <div className="re-col-days" style={{fontSize:10,fontWeight:700,color:"#fff",textTransform:"uppercase",letterSpacing:".06em",textAlign:"right"}}>Days Lapsed</div>
          <div className="re-col-score" style={{fontSize:10,fontWeight:700,color:"#fff",textTransform:"uppercase",letterSpacing:".06em",textAlign:"right"}}>Score</div>
          <div className="re-col-actions" style={{fontSize:10,fontWeight:700,color:"#fff",textTransform:"uppercase",letterSpacing:".06em",textAlign:"right"}}></div>
        </div>
        {lapsed.map((d,idx)=>{
          const days=daysDiff(d.lastGift||d.lastTouchpoint||new Date().toISOString());
          const sc=donorScore(d);
          const scColor=sc>70?"#1a6b4a":sc>45?"#f59e0b":"#ef4444";
          const rowBg=days>730?"#ef444409":days>365?"#f59e0b09":"#eab30809";
          const rowBorderColor=days>730?"#ef444425":days>365?"#f59e0b25":"#eab30825";
          const daysColor=days>730?"#ef4444":days>365?"#f59e0b":"#ca8a04";
          const urgencyLabel=days>730?"Critical":days>365?"At Risk":"Watch";
          const giftDate=fmtGiftDate(d.lastGift);
          return(
            <div key={d.id} className="reEngage-row" style={{display:"grid",gridTemplateColumns:colWidths,gap:0,padding:"13px 18px",background:rowBg,borderBottom:idx<lapsed.length-1?`1px solid ${rowBorderColor}`:"none",alignItems:"center"}}>
              <div className="re-col-name">
                <div style={{fontSize:13,fontWeight:700,color:T.ink,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{d.name}</div>
                {d.email&&<div style={{fontSize:11,color:T.ink3,marginTop:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{d.email}</div>}
              </div>
              <div className="re-col-lifetime" style={{textAlign:"right",fontSize:13,fontWeight:700,color:T.ink}}>{fmtFull(d.total)}</div>
              <div className="re-col-lastgift" style={{textAlign:"right"}}>
                {giftDate
                  ?<><div style={{fontSize:13,color:T.ink,fontWeight:600}}>{giftDate}</div><div style={{fontSize:11,color:T.ink3,marginTop:1}}>{d.lastAmount>0?fmtFull(d.lastAmount):""}</div></>
                  :<div style={{fontSize:13,color:T.ink3}}>—</div>
                }
              </div>
              <div className="re-col-days" style={{textAlign:"right"}}>
                <div style={{fontSize:13,fontWeight:700,color:daysColor}}>{days}d</div>
                <div style={{fontSize:10,color:daysColor,fontWeight:700,marginTop:2,textTransform:"uppercase",letterSpacing:".04em"}}>{urgencyLabel}</div>
              </div>
              <div className="re-col-score" style={{textAlign:"right"}}>
                <span style={{fontSize:13,fontWeight:800,color:scColor,background:scColor+"18",borderRadius:7,padding:"3px 9px",display:"inline-block"}}>{sc}</span>
              </div>
              <div className="re-col-actions" style={{display:"flex",gap:6,justifyContent:"flex-end"}}>
                <button onClick={e=>{e.stopPropagation();onLogTouchpoint(d);}} style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:7,padding:"4px 10px",color:T.ink3,fontSize:11,fontWeight:600,cursor:"pointer"}}>+ Log</button>
                <button onClick={()=>onSelectDonor(d)} style={{background:"#1a6b4a14",border:"1px solid #1a6b4a40",borderRadius:7,padding:"4px 10px",color:"#1a6b4a",fontSize:11,fontWeight:600,cursor:"pointer"}}>View →</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Assign Modal ───────────────────────────────────────────────────────────
function AssignModal({donor,orgTeam,onSave,onClose}){
  const[selectedId,setSelectedId]=useState(donor.assignedTo||"");
  const[loading,setLoading]=useState(false);
  const inp={width:"100%",background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"9px 12px",color:T.ink,fontSize:13,outline:"none",fontFamily:"inherit",boxSizing:"border-box",cursor:"pointer"};
  const save=async()=>{
    if(!selectedId)return;
    const member=orgTeam.find(u=>u.id===selectedId);
    if(!member)return;
    setLoading(true);
    try{
      await apiFetch(`/donors/${donor.id}/assign`,{method:"PATCH",body:JSON.stringify({assignedTo:member.id,assignedToName:member.name})});
      onSave(donor.id,member.id,member.name);
    }catch(e){console.error(e);}
    setLoading(false);
    onClose();
  };
  return(
    <div style={{position:"fixed",inset:0,background:"#000000cc",zIndex:500,display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
      <div style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:18,width:"100%",maxWidth:360,padding:24,boxShadow:"0 4px 32px rgba(15,15,15,0.12)"}}>
        <div style={{fontSize:16,fontWeight:800,color:T.ink,marginBottom:4}}>Assign Relationship Owner</div>
        <div style={{fontSize:12,color:T.ink3,marginBottom:16}}>{donor.name}</div>
        <select value={selectedId} onChange={e=>setSelectedId(e.target.value)} style={{...inp,marginBottom:16}}>
          <option value="">— unassigned —</option>
          {orgTeam.map(u=><option key={u.id} value={u.id}>{u.name} ({u.role})</option>)}
        </select>
        <div style={{display:"flex",gap:8}}>
          <button onClick={save} disabled={loading||!selectedId} style={{flex:1,background:selectedId?"#1a6b4a":T.bg2,border:"none",borderRadius:10,padding:"11px",color:"#fff",fontSize:13,fontWeight:700,cursor:selectedId?"pointer":"not-allowed"}}>
            {loading?"Saving…":"Assign"}
          </button>
          <button onClick={onClose} style={{background:T.bg,border:"none",borderRadius:10,padding:"11px 14px",color:T.ink3,fontSize:13,cursor:"pointer"}}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ── Directory View ─────────────────────────────────────────────────────────
function DirectoryView({donors,orgTeam,isAdmin,onSelectDonor,onAssign,stageFilter,setStageFilter,assigneeFilter,setAssigneeFilter}){
  const filtered=donors
    .filter(d=>!stageFilter||d.stage===stageFilter)
    .filter(d=>!assigneeFilter||d.assignedTo===assigneeFilter);
  const sel={background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"7px 10px",color:T.ink,fontSize:12,outline:"none",cursor:"pointer"};
  const cols=["Donor","Stage","Owner","Lifetime","Last Gift","Score",...(isAdmin?[""]:[])]
  const colGrid="minmax(0,2fr) minmax(0,1fr) minmax(0,1fr) 120px 110px 60px"+(isAdmin?" 80px":"");
  return(
    <div style={{display:"flex",flexDirection:"column",gap:10}}>
      <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
        <select value={stageFilter} onChange={e=>setStageFilter(e.target.value)} style={sel}>
          <option value="">All stages</option>
          {STAGES.map(s=><option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <select value={assigneeFilter} onChange={e=>setAssigneeFilter(e.target.value)} style={sel}>
          <option value="">All owners</option>
          {orgTeam.map(u=><option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        <span style={{fontSize:12,color:T.ink3}}>{filtered.length} donor{filtered.length!==1?"s":""}</span>
      </div>
      {filtered.length===0
        ?<EmptyState icon="♦" title="No donors found" message="Try adjusting your filters or search term."/>
        :<div style={{background:T.white,borderRadius:14,overflow:"hidden",border:"1px solid "+T.bg3}}>
          <div style={{display:"grid",gridTemplateColumns:colGrid,gap:0,padding:"10px 18px",background:"#1a6b4a"}}>
            {cols.map((h,i)=>(
              <div key={i} style={{fontSize:10,fontWeight:700,color:"#fff",textTransform:"uppercase",letterSpacing:".06em",textAlign:i>=3?"right":"left"}}>{h}</div>
            ))}
          </div>
          {filtered.map((d,idx)=>{
            const stage=STAGES.find(s=>s.id===(d.stage||"cultivate"))||STAGES[2];
            const sc=donorScore(d);const scColor=sc>70?"#1a6b4a":sc>45?"#f59e0b":"#ef4444";
            const isLast=idx===filtered.length-1;
            return(
              <div key={d.id} onClick={()=>onSelectDonor(d)}
                style={{display:"grid",gridTemplateColumns:colGrid,gap:0,padding:"11px 18px",background:idx%2===0?T.white:"#faf9f6",borderBottom:isLast?"none":"1px solid "+T.bg3,cursor:"pointer",alignItems:"center",transition:"background 0.12s"}}
                onMouseEnter={e=>e.currentTarget.style.background=T.bg}
                onMouseLeave={e=>e.currentTarget.style.background=idx%2===0?T.white:"#faf9f6"}>
                <div style={{display:"flex",alignItems:"center",gap:8,minWidth:0}}>
                  <div style={{width:32,height:32,borderRadius:"50%",background:stage.color+"22",display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:800,color:stage.color,flexShrink:0}}>{d.name[0]}</div>
                  <div style={{minWidth:0}}>
                    <div style={{fontSize:13,fontWeight:700,color:T.ink,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{d.name}</div>
                    {d.email&&<div style={{fontSize:11,color:T.ink3,marginTop:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{d.email}</div>}
                  </div>
                </div>
                <div>
                  <span style={{background:stage.color+"22",color:stage.color,borderRadius:99,padding:"4px 10px",fontSize:10,fontWeight:800,letterSpacing:"0.04em",textTransform:"uppercase"}}>{stage.label}</span>
                </div>
                <div style={{display:"flex",alignItems:"center",gap:5,minWidth:0}}>
                  <div style={{width:22,height:22,borderRadius:"50%",background:"#1a6b4a22",display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:800,color:"#1a6b4a",flexShrink:0}}>{(d.assignedToName||"?")[0]}</div>
                  <span style={{fontSize:12,color:T.ink,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{d.assignedToName||"—"}</span>
                </div>
                <div style={{textAlign:"right",fontSize:13,fontWeight:700,color:T.ink}}>{fmtFull(d.total)}</div>
                <div style={{textAlign:"right"}}>
                  {d.lastGift
                    ?<><div style={{fontSize:12,color:T.ink}}>{new Date(d.lastGift).toLocaleDateString("en-US",{month:"short",year:"numeric"})}</div><div style={{fontSize:11,color:T.ink3}}>{d.lastAmount>0?fmtFull(d.lastAmount):""}</div></>
                    :<div style={{fontSize:12,color:T.ink3}}>—</div>}
                </div>
                <div style={{textAlign:"right"}}>
                  <span style={{background:scColor+"18",color:scColor,borderRadius:7,padding:"3px 8px",fontSize:12,fontWeight:800}}>{sc}</span>
                </div>
                {isAdmin&&<div style={{textAlign:"right"}}>
                  <button onClick={e=>{e.stopPropagation();onAssign(d);}} style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:7,padding:"4px 10px",color:T.ink3,fontSize:11,fontWeight:600,cursor:"pointer"}}>Assign</button>
                </div>}
              </div>
            );
          })}
        </div>
      }
    </div>
  );
}

// ── Team View ──────────────────────────────────────────────────────────────
function TeamView({donors,orgTeam,onSelectDonor}){
  if(!orgTeam.length)return<EmptyState icon="◆" title="No team members yet" message="Invite team members from Settings to assign and track donor ownership."/>;
  return(
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))",gap:12}}>
      {orgTeam.map(member=>{
        const md=donors.filter(d=>d.assignedTo===member.id).sort((a,b)=>b.total-a.total);
        const tv=md.reduce((s,d)=>s+d.total,0);
        return(
          <div key={member.id} style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:14,padding:16}}>
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12,paddingBottom:10,borderBottom:"1px solid "+T.bg3}}>
              <div style={{width:36,height:36,borderRadius:"50%",background:"#1a6b4a22",display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,fontWeight:800,color:"#1a6b4a",flexShrink:0}}>{member.name[0]}</div>
              <div>
                <div style={{fontSize:14,fontWeight:700,color:T.ink}}>{member.name}</div>
                <div style={{fontSize:11,color:T.ink3,marginTop:1}}>{md.length} donor{md.length!==1?"s":""} · {fmtFull(tv)}</div>
              </div>
            </div>
            {md.length===0
              ?<div style={{fontSize:12,color:T.ink3,fontStyle:"italic",padding:"4px 0 8px"}}>No assigned donors yet</div>
              :md.slice(0,10).map((d,i)=>{
                const stage=STAGES.find(s=>s.id===(d.stage||"cultivate"))||STAGES[2];
                return(
                  <div key={d.id} onClick={()=>onSelectDonor(d)} style={{display:"flex",alignItems:"center",gap:8,padding:"9px 0",borderBottom:i<Math.min(md.length,10)-1?"1px solid "+T.bg3:"none",cursor:"pointer"}}>
                    <div style={{width:28,height:28,borderRadius:"50%",background:stage.color+"22",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:800,color:stage.color,flexShrink:0}}>{d.name[0]}</div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:13,fontWeight:600,color:T.ink,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{d.name}</div>
                      <div style={{fontSize:11,color:T.ink3,marginTop:1}}>{stage.label} · {fmtFull(d.total)}</div>
                    </div>
                  </div>
                );
              })
            }
            {md.length>10&&<div style={{fontSize:11,color:T.ink3,textAlign:"center",paddingTop:10,fontStyle:"italic"}}>+{md.length-10} more donors</div>}
          </div>
        );
      })}
    </div>
  );
}

// ── Donor Segmentation ─────────────────────────────────────────────────────
const TIER_META=[
  {id:"micro",    label:"Micro",     color:"#6b7280"},
  {id:"small",    label:"Small",     color:"#3b82f6"},
  {id:"mid",      label:"Mid",       color:"#8b5cf6"},
  {id:"major",    label:"Major",     color:"#f59e0b"},
  {id:"principal",label:"Principal", color:"#1a6b4a"},
];
const PATTERN_META=[
  {id:"one-time", label:"One-time"},
  {id:"recurring",label:"Recurring (2+ gifts)"},
  {id:"major",    label:"Major gift (>$10k)"},
  {id:"lapsed",   label:"Lapsed (>365d)"},
];

function FilterBar({filters,onChange,customFields,cfFilters,onCfChange}){
  const set=(key,val)=>onChange({...filters,[key]:val});
  const tog=(key,val)=>{const arr=filters[key];set(key,arr.includes(val)?arr.filter(v=>v!==val):[...arr,val]);};
  const inp={background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"7px 10px",color:T.ink,fontSize:12,outline:"none",boxSizing:"border-box"};
  const row={display:"flex",gap:12,flexWrap:"wrap",alignItems:"center"};
  const lbl={fontSize:11,fontWeight:700,color:T.ink3,textTransform:"uppercase",letterSpacing:".06em",whiteSpace:"nowrap",minWidth:90};
  function setCf(fieldId,val){onCfChange({...cfFilters,[fieldId]:val});}
  function togCfOption(fieldId,opt){const cur=cfFilters[fieldId]||[];onCfChange({...cfFilters,[fieldId]:cur.includes(opt)?cur.filter(v=>v!==opt):[...cur,opt]});}
  return(
    <div className="filter-bar" style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:12,padding:"16px 18px",display:"flex",flexDirection:"column",gap:12}}>
      <div className="filter-bar-row" style={row}>
        <span style={lbl}>Capacity Tier</span>
        <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
          {TIER_META.map(t=>{const a=filters.tiers.includes(t.id);return(
            <button key={t.id} onClick={()=>tog("tiers",t.id)} style={{background:a?t.color+"22":T.bg,border:`1px solid ${a?t.color:T.bg3}`,borderRadius:7,padding:"4px 12px",color:a?t.color:T.ink3,fontSize:12,fontWeight:a?700:400,cursor:"pointer"}}>{t.label}</button>
          );})}
        </div>
      </div>
      <div className="filter-bar-row" style={row}>
        <span style={lbl}>Stage</span>
        <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
          {STAGES.map(s=>{const a=filters.stages.includes(s.id);return(
            <button key={s.id} onClick={()=>tog("stages",s.id)} style={{background:a?s.color+"22":T.bg,border:`1px solid ${a?s.color:T.bg3}`,borderRadius:7,padding:"4px 12px",color:a?s.color:T.ink3,fontSize:12,fontWeight:a?700:400,cursor:"pointer"}}>{s.label}</button>
          );})}
        </div>
      </div>
      <div className="filter-bar-row" style={row}>
        <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
          <span style={lbl}>Giving Pattern</span>
          <select value={filters.pattern} onChange={e=>set("pattern",e.target.value)} style={{...inp,cursor:"pointer",minWidth:190}}>
            <option value="">Any</option>
            {PATTERN_META.map(p=><option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:6}}>
          <span style={lbl}>Geography</span>
          <input value={filters.geo} onChange={e=>set("geo",e.target.value)} placeholder="Search notes & tags…" style={{...inp,minWidth:160}}/>
        </div>
      </div>
      <div className="filter-bar-row" style={row}>
        <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
          <span style={lbl}>Last Gift</span>
          <input type="date" value={filters.giftFrom} onChange={e=>set("giftFrom",e.target.value)} style={inp}/>
          <span style={{fontSize:11,color:T.ink3}}>→</span>
          <input type="date" value={filters.giftTo} onChange={e=>set("giftTo",e.target.value)} style={inp}/>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
          <span style={lbl}>Lifetime Giving</span>
          <input type="number" value={filters.totalMin} onChange={e=>set("totalMin",e.target.value)} placeholder="$min" style={{...inp,width:80}}/>
          <span style={{fontSize:11,color:T.ink3}}>→</span>
          <input type="number" value={filters.totalMax} onChange={e=>set("totalMax",e.target.value)} placeholder="any" style={{...inp,width:80}}/>
        </div>
      </div>
      {customFields&&customFields.length>0&&(
        <div style={{borderTop:"1px solid "+T.bg3,paddingTop:12,display:"flex",flexDirection:"column",gap:10}}>
          <span style={{fontSize:11,fontWeight:700,color:T.ink3,textTransform:"uppercase",letterSpacing:".06em"}}>Custom Fields</span>
          {customFields.map(f=>{
            if(f.field_type==="dropdown"){
              const sel=cfFilters[f.id]||[];
              return(
                <div key={f.id} className="filter-bar-row" style={row}>
                  <span style={lbl}>{f.label}</span>
                  <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
                    {(f.options||[]).map(opt=>{const a=sel.includes(opt);return(
                      <button key={opt} onClick={()=>togCfOption(f.id,opt)} style={{background:a?T.greenDk+"22":T.bg,border:`1px solid ${a?T.greenDk:T.bg3}`,borderRadius:7,padding:"4px 12px",color:a?T.greenDk:T.ink3,fontSize:12,fontWeight:a?700:400,cursor:"pointer"}}>{opt}</button>
                    );})}
                  </div>
                </div>
              );
            }
            if(f.field_type==="checkbox"){
              const val=cfFilters[f.id]||"";
              return(
                <div key={f.id} className="filter-bar-row" style={row}>
                  <span style={lbl}>{f.label}</span>
                  <div style={{display:"flex",gap:5}}>
                    {["","Yes","No"].map((opt,i)=>{const a=val===opt;return(
                      <button key={i} onClick={()=>setCf(f.id,opt)} style={{background:a?T.greenDk+"22":T.bg,border:`1px solid ${a?T.greenDk:T.bg3}`,borderRadius:7,padding:"4px 12px",color:a?T.greenDk:T.ink3,fontSize:12,fontWeight:a?700:400,cursor:"pointer"}}>{opt||"Any"}</button>
                    );})}
                  </div>
                </div>
              );
            }
            if(f.field_type==="date"){
              const val=cfFilters[f.id]||{from:"",to:""};
              return(
                <div key={f.id} className="filter-bar-row" style={row}>
                  <span style={lbl}>{f.label}</span>
                  <input type="date" value={val.from||""} onChange={e=>setCf(f.id,{...val,from:e.target.value})} style={inp}/>
                  <span style={{fontSize:11,color:T.ink3}}>→</span>
                  <input type="date" value={val.to||""} onChange={e=>setCf(f.id,{...val,to:e.target.value})} style={inp}/>
                </div>
              );
            }
            const val=cfFilters[f.id]||"";
            return(
              <div key={f.id} className="filter-bar-row" style={row}>
                <span style={lbl}>{f.label}</span>
                <input value={val} onChange={e=>setCf(f.id,e.target.value)} type={f.field_type==="number"?"number":"text"} placeholder={f.field_type==="number"?"Any value":"Search…"} style={{...inp,minWidth:160}}/>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Donors ─────────────────────────────────────────────────────────────────
export function Donors({data,setData}){
  const{auth}=useAuth();
  const isAdmin=auth?.user?.role==="admin";
  const userId=auth?.user?.id||"";
  const userName=auth?.user?.name||auth?.user?.email||"";
  const lapsedCount=data.donors.filter(d=>d.stage==="lapsed"||(d.lastGift&&daysDiff(d.lastGift)>365)).length;
  const[view,setView]=useState("directory");
  const[search,setSearch]=useState("");
  const[selected,setSelected]=useState(null);
  const[logTarget,setLogTarget]=useState(null);
  const[editTarget,setEditTarget]=useState(null);
  const[followUpTarget,setFollowUpTarget]=useState(null);
  const[aiMap,setAiMap]=useState({});const[loadingKey,setLoadingKey]=useState(null);
  const[callList,setCallList]=useState("");const[callLoading,setCallLoading]=useState(false);
  const[showAdd,setShowAdd]=useState(false);const[showImport,setShowImport]=useState(false);
  const[newDonor,setNewDonor]=useState({name:"",email:"",phone:"",lastAmount:"",stage:"prospect"});
  const[filtersOpen,setFiltersOpen]=useState(false);
  const[filters,setFilters]=useState({tiers:[],stages:[],pattern:"",geo:"",giftFrom:"",giftTo:"",totalMin:"",totalMax:""});
  const[orgTeam,setOrgTeam]=useState([]);
  const[customFields,setCustomFields]=useState([]);
  const[cfValues,setCfValues]=useState({});
  const[cfFilters,setCfFilters]=useState({});
  const[dirStage,setDirStage]=useState("");
  const[dirAssignee,setDirAssignee]=useState("");
  const[assignTarget,setAssignTarget]=useState(null);

  const filtered=data.donors
    .filter(d=>!search||(d.name+d.email).toLowerCase().includes(search.toLowerCase()))
    .filter(d=>{
      if(filters.tiers.length&&!filters.tiers.includes((d.capacityTier||"").toLowerCase()))return false;
      if(filters.stages.length&&!filters.stages.includes(d.stage||"cultivate"))return false;
      if(filters.pattern==="one-time"&&d.gifts!==1)return false;
      if(filters.pattern==="recurring"&&d.gifts<2)return false;
      if(filters.pattern==="major"&&d.lastAmount<10000)return false;
      if(filters.pattern==="lapsed"&&!(d.stage==="lapsed"||(d.lastGift&&daysDiff(d.lastGift)>365)))return false;
      if(filters.geo.trim()&&!`${d.notes||""} ${(d.tags||[]).join(" ")}`.toLowerCase().includes(filters.geo.toLowerCase()))return false;
      if(filters.giftFrom&&d.lastGift&&d.lastGift<filters.giftFrom)return false;
      if(filters.giftTo&&d.lastGift&&d.lastGift>filters.giftTo)return false;
      if(filters.totalMin!==""&&!isNaN(parseFloat(filters.totalMin))&&d.total<parseFloat(filters.totalMin))return false;
      if(filters.totalMax!==""&&!isNaN(parseFloat(filters.totalMax))&&d.total>parseFloat(filters.totalMax))return false;
      return true;
    })
    .filter(d=>{
      for(const [fieldId,fval] of Object.entries(cfFilters)){
        if(!fval||fval==="")continue;
        if(Array.isArray(fval)&&fval.length===0)continue;
        if(typeof fval==="object"&&!Array.isArray(fval)&&!fval.from&&!fval.to)continue;
        const f=customFields.find(x=>x.id===fieldId);
        if(!f)continue;
        const dv=(cfValues[d.id]?.[fieldId]||"").toLowerCase();
        if(f.field_type==="dropdown"){
          if(fval.length===0)continue;
          if(!fval.some(opt=>dv===opt.toLowerCase()))return false;
        }else if(f.field_type==="checkbox"){
          if(fval&&dv!==fval.toLowerCase())return false;
        }else if(f.field_type==="date"){
          if(fval.from&&dv<fval.from)return false;
          if(fval.to&&dv>fval.to)return false;
        }else{
          if(!dv.includes(fval.toLowerCase()))return false;
        }
      }
      return true;
    });

  useEffect(()=>{
    apiFetch("/org/team").then(setOrgTeam).catch(()=>{});
    apiFetch("/custom-fields").then(rows=>setCustomFields(Array.isArray(rows)?rows:[])).catch(()=>{});
    apiFetch("/donors/custom-field-values/all").then(rows=>{
      if(!Array.isArray(rows))return;
      const map={};
      rows.forEach(r=>{if(!map[r.donorId])map[r.donorId]={};map[r.donorId][r.fieldId]=r.value;});
      setCfValues(map);
    }).catch(()=>{});
  },[]);

  const handleAssign=(donorId,assignedToId,assignedToName)=>{
    setData(prev=>({...prev,donors:prev.donors.map(d=>d.id===donorId?{...d,assignedTo:assignedToId,assignedToName}:d)}));
    if(selected?.id===donorId)setSelected(prev=>({...prev,assignedTo:assignedToId,assignedToName}));
  };

  const moveToStage=async(donorId,stage)=>{
    setData(prev=>({...prev,donors:prev.donors.map(d=>d.id===donorId?{...d,stage}:d)}));
    if(selected?.id===donorId)setSelected(prev=>({...prev,stage}));
    try{await apiFetch(`/donors/${donorId}/stage`,{method:"PATCH",body:JSON.stringify({stage})});}
    catch(e){console.error(e);}
  };

  const handleLogged=(donor,interaction)=>{
    const updated={...donor,lastTouchpoint:interaction.date,interactions:[interaction,...(donor.interactions||[])]};
    setData(prev=>({...prev,donors:prev.donors.map(d=>d.id===donor.id?updated:d)}));
    if(selected?.id===donor.id)setSelected(updated);
    setLogTarget(null);
    setFollowUpTarget(donor);
    if(interaction.type==="gift"&&interaction.amount>0)reloadDonors();
  };

  const toggleTask=async(task)=>{
    const updated={...task,done:!task.done};
    setData(prev=>({...prev,tasks:prev.tasks.map(t=>t.id===task.id?updated:t)}));
    try{await apiFetch(`/tasks/${task.id}`,{method:"PUT",body:JSON.stringify({title:task.title,due:task.due||"",priority:task.priority,type:task.type,done:updated.done})});}
    catch(e){console.error(e);}
  };

  const getAI=async(donor,type)=>{
    const key=`${donor.id}_${type}`;setLoadingKey(key);setAiMap(p=>({...p,[key]:""}));
    const stage=STAGES.find(s=>s.id===(donor.stage||"cultivate"))||STAGES[2];
    const urg=moveUrgency(donor);
    const sys=`You are an expert major gifts officer. Be specific, strategic, brief. Max 200 words. Reference actual donor data.`;
    const prompts={
      nextmove:`Donor: ${donor.name} | Stage: ${stage.label} | Days since contact: ${urg.days} | Total: ${fmtFull(donor.total)} (${donor.gifts} gifts) | Last: ${fmtFull(donor.lastAmount)} on ${donor.lastGift}\nNotes: ${donor.notes||"none"}\nOrg: ${data.org.name} — ${data.org.mission}\nRecent touchpoints: ${donor.interactions?.slice(0,3).map(i=>`${i.date}: ${i.type} - ${i.note}`).join("; ")||"none"}\n\nProvide:\n**Urgency Score:** X/10\n**Recommended Move:** [exact action]\n**Timing:** [when]\n**What to say:** [2-3 sentences]\n**Goal:** [what you're trying to achieve]`,
      outreach:`Write an outreach strategy for ${donor.name} (${stage.label} stage).\nTotal: ${fmtFull(donor.total)}, last gift ${fmtFull(donor.lastAmount)} ${urg.days}d ago.\nNotes: ${donor.notes}\nOrg: ${data.org.mission}\n\nBest channel, talking points, suggested ask amount, personal hook.`,
      email:`Write a personalized email to ${donor.name} (${stage.label} stage).\nLast gift: ${fmtFull(donor.lastAmount)} on ${donor.lastGift}. Notes: ${donor.notes}\nOrg: ${data.org.name}.\n\nWarm, specific, 150 words max.`,
      callscript:`Phone call script for ${donor.name} (${stage.label}).\nContext: ${donor.notes}\nLast gift: ${fmtFull(donor.lastAmount)}\n\nOpening, 2 listening questions, impact hook, soft ask.`,
    };
    await askClaude(sys,prompts[type],chunk=>setAiMap(p=>({...p,[key]:chunk})));
    setLoadingKey(null);
  };

  const reloadCfValues=async()=>{
    try{
      const rows=await apiFetch("/donors/custom-field-values/all");
      if(!Array.isArray(rows))return;
      const map={};
      rows.forEach(r=>{if(!map[r.donorId])map[r.donorId]={};map[r.donorId][r.fieldId]=r.value;});
      setCfValues(map);
    }catch(e){console.error(e);}
  };

  const reloadDonors=async()=>{
    try{
      const donors=await apiFetch("/donors");
      setData(prev=>({...prev,donors:donors.map(d=>{
        const ints=(d.interactions||[]).map(i=>({date:i.date||i.created_at?.split("T")[0],type:i.type,note:i.note||""}));
        const lastTouchpoint=ints.length>0?ints.slice().sort((a,b)=>new Date(b.date)-new Date(a.date))[0].date:null;
        return{id:d.id,name:d.name,email:d.email||"",phone:d.phone||"",total:d.total_giving||0,
          lastGift:d.last_gift_date||"",lastAmount:d.last_gift_amount||0,gifts:d.gift_count||0,
          status:d.status,stage:d.stage||"cultivate",lastTouchpoint,
          tags:Array.isArray(d.tags)?d.tags:JSON.parse(d.tags||"[]"),notes:d.notes||"",interactions:ints};
      })}));
    }catch(e){console.error(e);}
  };

  const handleEditSaved=(raw)=>{
    const adapted={
      id:raw.id,name:raw.name,email:raw.email||"",phone:raw.phone||"",
      total:raw.total_giving||0,lastGift:raw.last_gift_date||"",
      lastAmount:raw.last_gift_amount||0,gifts:raw.gift_count||0,
      status:raw.status,stage:raw.stage||"cultivate",
      tags:Array.isArray(raw.tags)?raw.tags:JSON.parse(raw.tags||"[]"),
      notes:raw.notes||"",
      interactions:selected?.id===raw.id?(selected.interactions||[]):[],
      lastTouchpoint:selected?.id===raw.id?selected.lastTouchpoint:null,
    };
    setData(prev=>({...prev,donors:prev.donors.map(d=>d.id===raw.id?adapted:d)}));
    if(selected?.id===raw.id)setSelected(adapted);
    setEditTarget(null);
  };

  const deleteDonor=async(id)=>{
    if(!window.confirm("Delete this donor? This cannot be undone."))return;
    try{
      await apiFetch(`/donors/${id}`,{method:"DELETE"});
      setData(prev=>({...prev,donors:prev.donors.filter(d=>d.id!==id)}));
      setSelected(null);
    }catch(e){console.error(e);}
  };

  const generateCallList=async()=>{
    setCallLoading(true);setCallList("");
    await askClaude(`You are a chief development officer. Be tactical. Max 200 words.`,
      `Prioritized call list for this week:\n${data.donors.map(d=>`${d.name} [${d.stage||"cultivate"}]: ${daysDiff(d.lastTouchpoint||d.lastGift)}d since contact, ${fmtFull(d.lastAmount)} last gift, score ${donorScore(d)}, notes: ${d.notes}`).join("\n")}`,
      chunk=>setCallList(chunk));
    setCallLoading(false);
  };

  const[newDonorAssignee,setNewDonorAssignee]=useState("");

  const addDonor=async()=>{
    if(!newDonor.name)return;
    const assignTo=newDonorAssignee||userId;
    const assignToName=newDonorAssignee?(orgTeam.find(u=>u.id===newDonorAssignee)?.name||""):userName;
    const temp={id:"tmp_"+Date.now(),name:newDonor.name,email:newDonor.email,phone:newDonor.phone,
      total:parseInt(newDonor.lastAmount)||0,lastGift:new Date().toISOString().split("T")[0],
      lastAmount:parseInt(newDonor.lastAmount)||0,gifts:newDonor.lastAmount?1:0,
      status:"new",stage:newDonor.stage,tags:[],notes:"",interactions:[],lastTouchpoint:null,
      assignedTo:assignTo,assignedToName:assignToName};
    setData(prev=>({...prev,donors:[...prev.donors,temp]}));
    setShowAdd(false);setNewDonor({name:"",email:"",phone:"",lastAmount:"",stage:"prospect"});setNewDonorAssignee("");
    try{await apiFetch("/donors",{method:"POST",body:JSON.stringify({...newDonor,stage:newDonor.stage,assignedTo:assignTo,assignedToName:assignToName})});await reloadDonors();}
    catch(e){console.error(e);}
  };

  return(
    <div style={{display:"flex",flexDirection:"column",gap:8}}>
      <PageTitle main="Your" accent="donors."/>
      {assignTarget&&<AssignModal donor={assignTarget} orgTeam={orgTeam} onSave={handleAssign} onClose={()=>setAssignTarget(null)}/>}
      {showImport&&<DonorImport onClose={()=>setShowImport(false)} onImported={()=>{reloadDonors();setShowImport(false);}}/>}
      {logTarget&&<LogTouchpointModal donor={logTarget} onSave={int=>handleLogged(logTarget,int)} onClose={()=>setLogTarget(null)}/>}
      {followUpTarget&&<FollowUpTaskModal donor={followUpTarget} onClose={()=>setFollowUpTarget(null)} onSave={task=>{setData(prev=>({...prev,tasks:[task,...prev.tasks]}));setFollowUpTarget(null);}}/>}
      {editTarget&&<EditDonorModal donor={editTarget} onSave={handleEditSaved} onClose={()=>setEditTarget(null)}/>}
      {selected&&<DonorProfile donor={selected} onClose={()=>setSelected(null)}
        onStageChange={moveToStage} onLogTouchpoint={()=>{setLogTarget(selected);}}
        aiMap={aiMap} loadingKey={loadingKey} getAI={getAI}
        isAdmin={isAdmin} onEdit={()=>setEditTarget(selected)} onDelete={deleteDonor}
        tasks={data.tasks.filter(t=>t.donorId===selected.id)} onTaskToggle={toggleTask}
        orgName={data.org?.name||""} orgTeam={orgTeam} onReassign={handleAssign} onCfSaved={reloadCfValues}/>}

      <div className="donors-toolbar" style={{display:"flex",gap:10,flexWrap:"wrap",alignItems:"center"}}>
        <input className="donors-search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search donors…" style={{flex:1,minWidth:160,background:T.bg,border:"1px solid "+T.bg3,borderRadius:10,padding:"10px 14px",color:T.ink,fontSize:13,outline:"none"}}/>
        <div className="donors-view-toggle" style={{display:"flex",background:T.bg,border:"1px solid "+T.bg3,borderRadius:10,overflow:"hidden"}}>
          {[["directory","Directory"],["pipeline","My Pipeline"],...(isAdmin?[["team","Team"]]:[]),["reengage","Re-engage"]].map(([v,l])=>(
            <button key={v} onClick={()=>setView(v)} style={{background:view===v?T.bg2:"transparent",border:"none",padding:"9px 14px",color:view===v?T.ink:"#6b7280",fontSize:13,fontWeight:view===v?700:400,cursor:"pointer",display:"flex",alignItems:"center",gap:5}}>
              {l}
              {v==="reengage"&&lapsedCount>0&&<span style={{background:"#1a6b4a",color:"#fff",borderRadius:99,padding:"1px 6px",fontSize:10,fontWeight:800,lineHeight:1.4}}>{lapsedCount}</span>}
            </button>
          ))}
        </div>
        <AIBtn onClick={generateCallList} loading={callLoading} label="✦ Call List"/>
        <button onClick={()=>setShowAdd(!showAdd)} style={{background:"#10b981",border:"none",borderRadius:10,padding:"10px 14px",color:"#fff",fontSize:13,fontWeight:600,cursor:"pointer"}}>+ Add</button>
        <button onClick={()=>setShowImport(true)} style={{background:T.bg3,border:"1px solid "+T.bg3,borderRadius:10,padding:"10px 14px",color:T.ink3,fontSize:13,cursor:"pointer"}}>↑ Import</button>
      </div>

      {(()=>{
        const cfActiveCount=Object.entries(cfFilters).filter(([,v])=>{if(!v||v==="")return false;if(Array.isArray(v))return v.length>0;if(typeof v==="object")return v.from||v.to;return true;}).length;
        const count=filters.tiers.length+filters.stages.length+(filters.pattern?1:0)+(filters.geo.trim()?1:0)+((filters.giftFrom||filters.giftTo)?1:0)+((filters.totalMin||filters.totalMax)?1:0)+cfActiveCount;
        const pills=[];
        filters.tiers.forEach(t=>{const m=TIER_META.find(x=>x.id===t);pills.push({id:"t"+t,label:`Tier: ${m?.label||t}`,rm:()=>setFilters(f=>({...f,tiers:f.tiers.filter(v=>v!==t)}))});});
        filters.stages.forEach(s=>{const m=STAGES.find(x=>x.id===s);pills.push({id:"s"+s,label:`Stage: ${m?.label||s}`,rm:()=>setFilters(f=>({...f,stages:f.stages.filter(v=>v!==s)}))});});
        if(filters.pattern){const m=PATTERN_META.find(p=>p.id===filters.pattern);pills.push({id:"pat",label:`Pattern: ${m?.label||filters.pattern}`,rm:()=>setFilters(f=>({...f,pattern:""}))});}
        if(filters.geo.trim())pills.push({id:"geo",label:`Geo: "${filters.geo}"`,rm:()=>setFilters(f=>({...f,geo:""}))});
        if(filters.giftFrom||filters.giftTo)pills.push({id:"gift",label:`Last gift: ${filters.giftFrom||"any"} → ${filters.giftTo||"any"}`,rm:()=>setFilters(f=>({...f,giftFrom:"",giftTo:""}))});
        if(filters.totalMin||filters.totalMax)pills.push({id:"total",label:`Giving: ${filters.totalMin?"$"+filters.totalMin:"$0"} → ${filters.totalMax?"$"+filters.totalMax:"any"}`,rm:()=>setFilters(f=>({...f,totalMin:"",totalMax:""}))});
        Object.entries(cfFilters).forEach(([fieldId,fval])=>{
          if(!fval||fval==="")return;
          if(Array.isArray(fval)&&fval.length===0)return;
          if(typeof fval==="object"&&!Array.isArray(fval)&&!fval.from&&!fval.to)return;
          const f=customFields.find(x=>x.id===fieldId);
          if(!f)return;
          let label=`${f.label}: `;
          if(Array.isArray(fval))label+=fval.join(", ");
          else if(typeof fval==="object")label+=`${fval.from||"any"} → ${fval.to||"any"}`;
          else label+=fval;
          pills.push({id:"cf_"+fieldId,label,rm:()=>setCfFilters(p=>({...p,[fieldId]:f.field_type==="dropdown"?[]:f.field_type==="date"?{from:"",to:""}:""}))});
        });
        const clearAll=()=>{setFilters({tiers:[],stages:[],pattern:"",geo:"",giftFrom:"",giftTo:"",totalMin:"",totalMax:""});setCfFilters({});};
        return<>
          <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
            <button onClick={()=>setFiltersOpen(v=>!v)} style={{background:filtersOpen||count>0?T.bg2:T.bg,border:"1px solid "+(count>0?T.greenDk:T.bg3),borderRadius:9,padding:"7px 12px",color:count>0?T.greenDk:T.ink3,fontSize:12,fontWeight:count>0?700:400,cursor:"pointer",display:"flex",alignItems:"center",gap:6}}>
              ⊞ Filters
              {count>0&&<span style={{background:T.greenDk,color:"#fff",borderRadius:99,padding:"0 6px",fontSize:10,fontWeight:800,lineHeight:"16px"}}>{count}</span>}
            </button>
            {pills.map(p=>(
              <span key={p.id} style={{background:T.bg2,border:"1px solid "+T.bg3,borderRadius:99,padding:"4px 10px",fontSize:12,color:T.ink2,display:"inline-flex",alignItems:"center",gap:5}}>
                {p.label}
                <button onClick={p.rm} style={{background:"none",border:"none",cursor:"pointer",color:T.ink3,fontSize:13,lineHeight:1,padding:0,marginLeft:2}}>×</button>
              </span>
            ))}
            {count>0&&<button onClick={clearAll} style={{background:"none",border:"none",color:T.ink3,fontSize:12,cursor:"pointer",textDecoration:"underline",padding:0}}>Clear all</button>}
          </div>
          {filtersOpen&&<FilterBar filters={filters} onChange={setFilters} customFields={customFields} cfFilters={cfFilters} onCfChange={setCfFilters}/>}
        </>;
      })()}

      {(callLoading||callList)&&<AIPanel text={callList} onClose={()=>setCallList("")}/>}

      {showAdd&&<Card style={{gap:10,display:"flex",flexDirection:"column"}}>
        <div style={{fontSize:14,fontWeight:700,color:T.ink}}>New Donor</div>
        <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
          {STAGES.map(s=><button key={s.id} onClick={()=>setNewDonor(p=>({...p,stage:s.id}))} style={{background:newDonor.stage===s.id?s.color+"22":T.bg,border:`1px solid ${newDonor.stage===s.id?s.color:T.bg3}`,borderRadius:7,padding:"5px 11px",color:newDonor.stage===s.id?s.color:T.ink3,fontSize:12,fontWeight:600,cursor:"pointer"}}>{s.label}</button>)}
        </div>
        {[["name","Full Name"],["email","Email"],["phone","Phone"],["lastAmount","Gift Amount ($)"]].map(([k,pl])=>(
          <input key={k} value={newDonor[k]} onChange={e=>setNewDonor(p=>({...p,[k]:e.target.value}))} placeholder={pl} style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"9px 12px",color:T.ink,fontSize:13,outline:"none"}}/>
        ))}
        {isAdmin&&orgTeam.length>1&&<select value={newDonorAssignee} onChange={e=>setNewDonorAssignee(e.target.value)} style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"9px 12px",color:T.ink,fontSize:13,outline:"none",cursor:"pointer"}}>
          <option value="">Assign to me ({userName})</option>
          {orgTeam.filter(u=>u.id!==userId).map(u=><option key={u.id} value={u.id}>Assign to {u.name}</option>)}
        </select>}
        <div style={{display:"flex",gap:8}}>
          <button onClick={addDonor} style={{background:"#10b981",border:"none",borderRadius:8,padding:"9px 16px",color:"#fff",fontSize:13,fontWeight:600,cursor:"pointer"}}>Save</button>
          <button onClick={()=>setShowAdd(false)} style={{background:T.bg,border:"none",borderRadius:8,padding:"9px 14px",color:T.ink3,fontSize:13,cursor:"pointer"}}>Cancel</button>
        </div>
      </Card>}

      {view==="directory"&&<DirectoryView donors={filtered} orgTeam={orgTeam} isAdmin={isAdmin} onSelectDonor={d=>setSelected(d)} onAssign={d=>setAssignTarget(d)} stageFilter={dirStage} setStageFilter={setDirStage} assigneeFilter={dirAssignee} setAssigneeFilter={setDirAssignee}/>}

      {view==="pipeline"&&(()=>{
        const myDonors=filtered.filter(d=>d.assignedTo===userId);
        const myTotal=myDonors.reduce((s,d)=>s+d.total,0);
        return<>
          <div style={{display:"flex",gap:10,flexWrap:"wrap",alignItems:"center",padding:"4px 0"}}>
            <div style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:10,padding:"10px 16px",display:"flex",gap:16}}>
              <div><div style={{fontSize:9,fontWeight:700,color:T.ink3,textTransform:"uppercase",letterSpacing:".06em"}}>Assigned to me</div><div style={{fontSize:18,fontWeight:800,color:T.ink,fontFamily:"'DM Serif Display',serif"}}>{myDonors.length}</div></div>
              <div><div style={{fontSize:9,fontWeight:700,color:T.ink3,textTransform:"uppercase",letterSpacing:".06em"}}>Portfolio value</div><div style={{fontSize:18,fontWeight:800,color:"#1a6b4a",fontFamily:"'DM Serif Display',serif"}}>{fmtFull(myTotal)}</div></div>
            </div>
          </div>
          {myDonors.length===0
            ?<EmptyState icon="♦" title="No donors in your pipeline" message="Donors assigned to you will appear here as a Kanban board."/>
            :<DonorKanban donors={myDonors} onStageChange={moveToStage} onLogTouchpoint={d=>setLogTarget(d)} onSelectDonor={d=>setSelected(d)}/>}
        </>;
      })()}

      {view==="team"&&isAdmin&&<TeamView donors={filtered} orgTeam={orgTeam} onSelectDonor={d=>setSelected(d)}/>}

      {view==="reengage"&&<ReEngageView donors={filtered} org={data.org} onLogTouchpoint={d=>setLogTarget(d)} onSelectDonor={d=>setSelected(d)}/>}
    </div>
  );
}
