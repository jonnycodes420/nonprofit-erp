import { useState, useRef } from "react";
import { apiFetch } from "../api";
import { T } from "./shared";

// ── CSV helpers (mirrors Donors.jsx, kept local to avoid coupling) ──────────
const CSV_FIELDS = [
  {key:"name",   labels:["name","full name","donor name","contact"]},
  {key:"email",  labels:["email","email address","e-mail"]},
  {key:"phone",  labels:["phone","phone number","mobile","cell"]},
  {key:"total",  labels:["total","total giving","lifetime","lifetime giving","total donated"]},
  {key:"lastAmount",labels:["last gift","last amount","last donation","recent gift"]},
  {key:"lastGift",  labels:["last gift date","date","last donation date","most recent date"]},
  {key:"gifts",  labels:["gifts","gift count","# gifts","number of gifts","donations"]},
  {key:"status", labels:["status","donor status","type"]},
  {key:"notes",  labels:["notes","note","comments"]},
];
function guessField(header) {
  const h = header.toLowerCase().trim();
  for (const f of CSV_FIELDS) {
    if (f.labels.some(l => h === l || h.includes(l))) return f.key;
  }
  return "";
}
function inferStage(total, lastGiftStr) {
  const amount = parseFloat(String(total||"0").replace(/[$,]/g,"")) || 0;
  const d = lastGiftStr ? new Date(lastGiftStr) : null;
  const days = d && !isNaN(d) ? Math.floor((Date.now()-d)/86400000) : Infinity;
  if (!amount && days===Infinity) return "prospect";
  if (days>365) return "lapsed";
  if (days<90 && amount>0) return "steward";
  if (amount>0) return "cultivate";
  return "prospect";
}
function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length<2) return {headers:[],rows:[]};
  const headers = lines[0].split(",").map(h=>h.replace(/^"|"$/g,"").trim());
  const rows = lines.slice(1).map(line=>{
    const vals=[]; let cur=""; let inQ=false;
    for (const ch of line) {
      if (ch==='"'){inQ=!inQ;continue;}
      if (ch===","&&!inQ){vals.push(cur.trim());cur="";continue;}
      cur+=ch;
    }
    vals.push(cur.trim());
    return Object.fromEntries(headers.map((h,i)=>[h,vals[i]||""]));
  });
  return {headers,rows};
}

// ── Preset sequences ────────────────────────────────────────────────────────
const PRESET_SEQUENCES = [
  {
    id:"new_donor",
    name:"New Donor Welcome",
    trigger:"new_donor",
    icon:"✦",
    desc:"Automatically greet every new donor with a 3-email welcome series.",
    steps:[
      {step_order:1,delay_days:0,subject:"Welcome to {{org_name}} — thank you!",
       body:"Dear {{donor_name}},\n\nThank you so much for your gift to {{org_name}}. Your support means everything to us and directly funds our work.\n\nWe're grateful to have you as part of our community.\n\nWith gratitude,\n{{org_name}} Team"},
      {step_order:2,delay_days:7,subject:"See the impact of your gift",
       body:"Dear {{donor_name}},\n\nA week ago you made a gift that is already making a difference. Here's a quick look at what your support is funding...\n\nThank you for being part of our mission.\n\n{{org_name}} Team"},
      {step_order:3,delay_days:30,subject:"One month in — thank you for staying connected",
       body:"Dear {{donor_name}},\n\nIt's been a month since your first gift to {{org_name}}, and we wanted to check in.\n\nYour generosity continues to fuel our work. We hope you'll consider a second gift when the time is right.\n\n{{org_name}} Team"},
    ]
  },
  {
    id:"lapsed_re",
    name:"Lapsed Re-engagement",
    trigger:"lapsed_90",
    icon:"◎",
    desc:"Win back donors who haven't given in 90+ days with a personal 2-email sequence.",
    steps:[
      {step_order:1,delay_days:0,subject:"We miss you — and we want to reconnect",
       body:"Dear {{donor_name}},\n\nIt's been a while since we've been in touch, and we wanted to reach out personally.\n\nYour past support made a real difference to {{org_name}}. We'd love to share what's happened since your last gift and how you can make an impact again.\n\n{{org_name}} Team"},
      {step_order:2,delay_days:14,subject:"One last note — your past gift still matters",
       body:"Dear {{donor_name}},\n\nWe know you're busy, so this is our final outreach for now.\n\nIf you've been thinking about re-engaging with {{org_name}}, there's never been a better moment. Your previous gift showed how much you care — we hope you'll join us again.\n\n{{org_name}} Team"},
    ]
  },
  {
    id:"major_steward",
    name:"Major Donor Stewardship",
    trigger:"stage_change",
    trigger_stage:"steward",
    icon:"◆",
    desc:"High-touch stewardship for donors who reach the Steward stage.",
    steps:[
      {step_order:1,delay_days:0,subject:"A personal note of gratitude",
       body:"Dear {{donor_name}},\n\nI wanted to reach out personally to express my deep gratitude for your continued commitment to {{org_name}}.\n\nDonors like you are the reason we can sustain our mission year after year. I'd love to schedule a call to share what we've been working on.\n\nWith deep appreciation,\n{{org_name}} Leadership"},
      {step_order:2,delay_days:60,subject:"An update from {{org_name}}",
       body:"Dear {{donor_name}},\n\nI wanted to share a brief update on the work your generosity is making possible.\n\nWe've been proud of the progress this quarter, and it wouldn't be possible without supporters like you.\n\nLooking forward to staying in touch,\n{{org_name}} Team"},
    ]
  },
];

// ── Step config ─────────────────────────────────────────────────────────────
const STEPS = [
  {title:"Welcome to Steward",     desc:"Let's get your organization set up in a few quick steps."},
  {title:"Your Organization",      desc:"Fill in the details that power your AI briefings and donor outreach."},
  {title:"Import Your Donors",     desc:"Bring in your existing donor list — or start fresh."},
  {title:"Set Up a Welcome Series",desc:"Pick a pre-built sequence and we'll activate it instantly."},
  {title:"You're Ready",           desc:"Your workspace is live. Here's what to do first."},
];

// ── Input style ─────────────────────────────────────────────────────────────
const INP = {width:"100%",background:"#f8f6f0",border:"1px solid #e8e4da",borderRadius:10,padding:"11px 14px",fontSize:14,color:"#0f1a12",outline:"none",boxSizing:"border-box",fontFamily:"'DM Sans',system-ui,sans-serif"};
const LBL = {display:"block",fontSize:12,fontWeight:700,color:"#6b7c72",letterSpacing:"0.06em",textTransform:"uppercase",marginBottom:6};

// ── Step 0 — Welcome ────────────────────────────────────────────────────────
function StepWelcome({onNext,onSkip}) {
  const features=[
    {icon:"♦",title:"Donor Pipeline",body:"Move relationships through every stage — from prospect to loyal steward."},
    {icon:"◉",title:"Grant Tracker",body:"Deadlines, LOIs, and AI strategy briefs so you never miss a cycle."},
    {icon:"◑",title:"Email Sequences",body:"Automated, personalized outreach that runs without lifting a finger."},
    {icon:"◇",title:"Finance Module",body:"P&L, fund accounting, and budgets built for nonprofits."},
  ];
  return (
    <div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,marginBottom:32}}>
        {features.map(f=>(
          <div key={f.icon} style={{background:"#f8f6f0",border:"1px solid #e8e4da",borderRadius:14,padding:"18px 20px"}}>
            <div style={{fontSize:20,color:"#1a6b4a",marginBottom:8}}>{f.icon}</div>
            <div style={{fontSize:14,fontWeight:700,color:"#0f1a12",marginBottom:4}}>{f.title}</div>
            <div style={{fontSize:13,color:"#6b7c72",lineHeight:1.5}}>{f.body}</div>
          </div>
        ))}
      </div>
      <button onClick={onNext} style={{width:"100%",background:"#1a6b4a",border:"none",borderRadius:12,padding:"14px 24px",color:"#fff",fontSize:15,fontWeight:700,cursor:"pointer",marginBottom:12}}>
        Let's get started →
      </button>
      <button onClick={onSkip} style={{width:"100%",background:"transparent",border:"1px solid #e8e4da",borderRadius:12,padding:"13px 24px",color:"#6b7c72",fontSize:14,fontWeight:500,cursor:"pointer"}}>
        I'll explore on my own
      </button>
    </div>
  );
}

// ── Step 1 — Org Profile ────────────────────────────────────────────────────
function StepOrgProfile({org,onNext,saving}) {
  const [form,setForm]=useState({
    mission:org?.mission||"",
    focusArea:org?.focus_area||"",
    annualBudget:org?.annual_budget||"",
    foundedYear:org?.founded_year||"",
    website:org?.website||"",
  });
  const set=k=>e=>setForm(p=>({...p,[k]:e.target.value}));
  const FOCUS=[
    "Arts & Culture","Basic Needs & Food Security","Children & Youth","Civil Rights & Advocacy",
    "Community Development","Education","Environment","Health & Wellness","Housing","Human Services",
    "International Aid","Religion & Faith","Workforce Development","Other",
  ];
  return (
    <form onSubmit={e=>{e.preventDefault();onNext(form);}}>
      <div style={{display:"grid",gap:16,marginBottom:28}}>
        <div>
          <label style={LBL}>Mission Statement</label>
          <textarea value={form.mission} onChange={set("mission")} rows={3}
            placeholder="Describe your organization's mission in one or two sentences…"
            style={{...INP,resize:"vertical",minHeight:72,lineHeight:1.5}}/>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
          <div>
            <label style={LBL}>Focus Area</label>
            <select value={form.focusArea} onChange={set("focusArea")} style={{...INP,appearance:"none",backgroundImage:"url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236b7c72' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E\")",backgroundRepeat:"no-repeat",backgroundPosition:"right 12px center",paddingRight:36}}>
              <option value="">Select one…</option>
              {FOCUS.map(f=><option key={f} value={f}>{f}</option>)}
            </select>
          </div>
          <div>
            <label style={LBL}>Annual Budget</label>
            <select value={form.annualBudget} onChange={set("annualBudget")} style={{...INP,appearance:"none",backgroundImage:"url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236b7c72' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E\")",backgroundRepeat:"no-repeat",backgroundPosition:"right 12px center",paddingRight:36}}>
              <option value="">Select range…</option>
              {["Under $250K","$250K–$500K","$500K–$1M","$1M–$5M","$5M–$10M","Over $10M"].map(r=><option key={r} value={r}>{r}</option>)}
            </select>
          </div>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
          <div>
            <label style={LBL}>Founded Year</label>
            <input type="number" value={form.foundedYear} onChange={set("foundedYear")} placeholder="e.g. 2008" min={1800} max={new Date().getFullYear()} style={INP}/>
          </div>
          <div>
            <label style={LBL}>Website</label>
            <input type="url" value={form.website} onChange={set("website")} placeholder="https://yourorg.org" style={INP}/>
          </div>
        </div>
      </div>
      <button type="submit" disabled={saving} style={{width:"100%",background:saving?"#6b7c72":"#1a6b4a",border:"none",borderRadius:12,padding:"14px 24px",color:"#fff",fontSize:15,fontWeight:700,cursor:saving?"not-allowed":"pointer"}}>
        {saving?"Saving…":"Save & Continue →"}
      </button>
    </form>
  );
}

// ── Step 2 — Import Donors ──────────────────────────────────────────────────
function StepImportDonors({onNext,onSkip}) {
  const [csvText,setCsvText]=useState("");
  const [parsed,setParsed]=useState(null);
  const [mapping,setMapping]=useState({});
  const [loading,setLoading]=useState(false);
  const [done,setDone]=useState(false);
  const [count,setCount]=useState(0);
  const fileRef=useRef();

  function handleFile(e) {
    const file=e.target.files[0];
    if(!file) return;
    const reader=new FileReader();
    reader.onload=ev=>{
      const text=ev.target.result;
      setCsvText(text);
      const p=parseCSV(text);
      const auto={};
      p.headers.forEach(h=>{const g=guessField(h);if(g)auto[h]=g;});
      setMapping(auto);
      setParsed(p);
    };
    reader.readAsText(file);
  }

  function buildDonors() {
    return parsed.rows.map(row=>{
      const d={};
      Object.entries(mapping).forEach(([h,f])=>{
        if(f&&CSV_FIELDS.some(cf=>cf.key===f)) d[f]=row[h]||"";
      });
      if(!d.name) return null;
      if(!d.stage) d.stage=inferStage(d.total,d.lastGift);
      return d;
    }).filter(Boolean);
  }

  async function doImport() {
    setLoading(true);
    try {
      const donors=buildDonors();
      await apiFetch("/donors/import",{method:"POST",body:JSON.stringify({donors})});
      setCount(donors.length);
      setDone(true);
    } catch(e) { alert("Import failed: "+e.message); }
    setLoading(false);
  }

  if(done) return (
    <div style={{textAlign:"center",padding:"20px 0"}}>
      <div style={{fontSize:48,marginBottom:12}}>✓</div>
      <div style={{fontSize:18,fontWeight:700,color:"#0f1a12",marginBottom:8}}>{count} donors imported</div>
      <div style={{fontSize:14,color:"#6b7c72",marginBottom:28}}>Your donor list is ready to go.</div>
      <button onClick={onNext} style={{width:"100%",background:"#1a6b4a",border:"none",borderRadius:12,padding:"14px 24px",color:"#fff",fontSize:15,fontWeight:700,cursor:"pointer"}}>
        Continue →
      </button>
    </div>
  );

  return (
    <div>
      {!parsed ? (
        <div>
          <div
            onClick={()=>fileRef.current.click()}
            style={{border:"2px dashed #c9d5c9",borderRadius:14,padding:"36px 24px",textAlign:"center",cursor:"pointer",marginBottom:20,background:"#f8f6f0",transition:"border-color 0.15s"}}
            onMouseEnter={e=>e.currentTarget.style.borderColor="#1a6b4a"}
            onMouseLeave={e=>e.currentTarget.style.borderColor="#c9d5c9"}
          >
            <div style={{fontSize:28,marginBottom:8,color:"#1a6b4a"}}>↑</div>
            <div style={{fontSize:14,fontWeight:600,color:"#0f1a12",marginBottom:4}}>Upload a CSV file</div>
            <div style={{fontSize:12,color:"#6b7c72"}}>Name, email, phone, giving history — we'll map the columns automatically.</div>
          </div>
          <input ref={fileRef} type="file" accept=".csv" onChange={handleFile} style={{display:"none"}}/>
          <button onClick={onSkip} style={{width:"100%",background:"transparent",border:"1px solid #e8e4da",borderRadius:12,padding:"13px 24px",color:"#6b7c72",fontSize:14,fontWeight:500,cursor:"pointer"}}>
            Skip for now — I'll add donors manually
          </button>
        </div>
      ) : (
        <div>
          <div style={{fontSize:13,color:"#6b7c72",marginBottom:16}}>Mapped <strong style={{color:"#0f1a12"}}>{parsed.headers.length}</strong> columns from <strong style={{color:"#0f1a12"}}>{parsed.rows.length}</strong> rows. Adjust if needed:</div>
          <div style={{maxHeight:220,overflowY:"auto",marginBottom:20,display:"grid",gap:8}}>
            {parsed.headers.map(h=>(
              <div key={h} style={{display:"flex",alignItems:"center",gap:12}}>
                <div style={{flex:1,fontSize:13,color:"#0f1a12",fontWeight:500,background:"#f8f6f0",border:"1px solid #e8e4da",borderRadius:8,padding:"8px 12px"}}>{h}</div>
                <div style={{fontSize:12,color:"#6b7c72"}}>→</div>
                <select
                  value={mapping[h]||""}
                  onChange={e=>{const v=e.target.value;setMapping(p=>({...p,[h]:v}));}}
                  style={{flex:1,background:"#f8f6f0",border:"1px solid #e8e4da",borderRadius:8,padding:"8px 12px",fontSize:13,color:"#0f1a12",outline:"none"}}
                >
                  <option value="">Skip</option>
                  {CSV_FIELDS.map(f=><option key={f.key} value={f.key}>{f.key}</option>)}
                </select>
              </div>
            ))}
          </div>
          <button onClick={doImport} disabled={loading} style={{width:"100%",background:loading?"#6b7c72":"#1a6b4a",border:"none",borderRadius:12,padding:"14px 24px",color:"#fff",fontSize:15,fontWeight:700,cursor:loading?"not-allowed":"pointer",marginBottom:10}}>
            {loading?"Importing…":`Import ${buildDonors().length} donors →`}
          </button>
          <button onClick={()=>{setParsed(null);setMapping({});setCsvText("");}} style={{width:"100%",background:"transparent",border:"1px solid #e8e4da",borderRadius:12,padding:"11px 24px",color:"#6b7c72",fontSize:13,cursor:"pointer"}}>
            Choose a different file
          </button>
        </div>
      )}
    </div>
  );
}

// ── Step 3 — First Sequence ─────────────────────────────────────────────────
function StepFirstSequence({onNext,onSkip}) {
  const [selected,setSelected]=useState(null);
  const [loading,setLoading]=useState(false);
  const [done,setDone]=useState(false);

  async function activate() {
    if(!selected) return;
    setLoading(true);
    try {
      const preset=PRESET_SEQUENCES.find(p=>p.id===selected);
      await apiFetch("/sequences",{method:"POST",body:JSON.stringify({
        name:preset.name,
        trigger:preset.trigger,
        triggerStage:preset.trigger_stage||null,
        steps:preset.steps.map(s=>({delayDays:s.delay_days,subject:s.subject,body:s.body})),
      })});
      setDone(true);
    } catch(e) { alert("Failed to activate: "+e.message); }
    setLoading(false);
  }

  if(done) {
    const preset=PRESET_SEQUENCES.find(p=>p.id===selected);
    return (
      <div style={{textAlign:"center",padding:"20px 0"}}>
        <div style={{fontSize:48,marginBottom:12}}>✓</div>
        <div style={{fontSize:18,fontWeight:700,color:"#0f1a12",marginBottom:8}}>"{preset.name}" is live</div>
        <div style={{fontSize:14,color:"#6b7c72",marginBottom:28}}>The sequence is active and will enroll donors automatically.</div>
        <button onClick={onNext} style={{width:"100%",background:"#1a6b4a",border:"none",borderRadius:12,padding:"14px 24px",color:"#fff",fontSize:15,fontWeight:700,cursor:"pointer"}}>
          Continue →
        </button>
      </div>
    );
  }

  return (
    <div>
      <div style={{display:"grid",gap:12,marginBottom:24}}>
        {PRESET_SEQUENCES.map(p=>(
          <div
            key={p.id}
            onClick={()=>setSelected(p.id)}
            style={{border:`2px solid ${selected===p.id?"#1a6b4a":"#e8e4da"}`,borderRadius:14,padding:"16px 20px",cursor:"pointer",background:selected===p.id?"#f0f8f4":"#f8f6f0",transition:"all 0.15s"}}
          >
            <div style={{display:"flex",alignItems:"center",gap:12}}>
              <div style={{width:36,height:36,background:selected===p.id?"#1a6b4a":"#e8e4da",borderRadius:10,display:"flex",alignItems:"center",justifyContent:"center",color:selected===p.id?"#fff":"#6b7c72",fontSize:16,flexShrink:0,transition:"all 0.15s"}}>{p.icon}</div>
              <div>
                <div style={{fontSize:14,fontWeight:700,color:"#0f1a12",marginBottom:2}}>{p.name}</div>
                <div style={{fontSize:12,color:"#6b7c72",lineHeight:1.4}}>{p.desc}</div>
              </div>
              <div style={{marginLeft:"auto",width:18,height:18,borderRadius:"50%",border:`2px solid ${selected===p.id?"#1a6b4a":"#c9d5c9"}`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                {selected===p.id&&<div style={{width:9,height:9,borderRadius:"50%",background:"#1a6b4a"}}/>}
              </div>
            </div>
          </div>
        ))}
      </div>
      <button onClick={activate} disabled={!selected||loading} style={{width:"100%",background:!selected||loading?"#c9d5c9":"#1a6b4a",border:"none",borderRadius:12,padding:"14px 24px",color:"#fff",fontSize:15,fontWeight:700,cursor:!selected||loading?"not-allowed":"pointer",marginBottom:10}}>
        {loading?"Activating…":"Activate sequence →"}
      </button>
      <button onClick={onSkip} style={{width:"100%",background:"transparent",border:"1px solid #e8e4da",borderRadius:12,padding:"13px 24px",color:"#6b7c72",fontSize:14,fontWeight:500,cursor:"pointer"}}>
        Skip — I'll set up sequences later
      </button>
    </div>
  );
}

// ── Step 4 — You're Ready ────────────────────────────────────────────────────
function StepReady({org,donorsImported,sequenceActivated,onDone}) {
  const moves=[
    {icon:"♦",title:"Add your first donor",body:"Head to the Donors tab and add a contact or import a CSV.",tab:"donors"},
    {icon:"◉",title:"Log a grant opportunity",body:"Track a grant you're pursuing and let AI draft your strategy.",tab:"grants"},
    {icon:"✦",title:"Ask the AI assistant",body:"Click 'Ask AI' anytime — get a briefing, draft emails, or prioritize tasks.",tab:null},
  ];
  return (
    <div>
      <div style={{textAlign:"center",marginBottom:28}}>
        <div style={{width:64,height:64,background:"#f0f8f4",border:"2px solid #10b981",borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 12px",fontSize:28,color:"#10b981"}}>✓</div>
        <div style={{fontSize:17,fontWeight:700,color:"#0f1a12",marginBottom:6}}>
          {org?.name||"Your workspace"} is ready
        </div>
        {(donorsImported||sequenceActivated)&&(
          <div style={{fontSize:13,color:"#6b7c72"}}>
            {donorsImported&&sequenceActivated?"Donors imported · Sequence active":donorsImported?"Donors imported":"Sequence active"}
          </div>
        )}
      </div>
      <div style={{display:"grid",gap:12,marginBottom:28}}>
        {moves.map(m=>(
          <div key={m.icon} style={{display:"flex",alignItems:"flex-start",gap:14,background:"#f8f6f0",border:"1px solid #e8e4da",borderRadius:14,padding:"14px 18px"}}>
            <div style={{width:32,height:32,background:"#e8f5ef",borderRadius:9,display:"flex",alignItems:"center",justifyContent:"center",color:"#1a6b4a",fontSize:15,flexShrink:0}}>{m.icon}</div>
            <div>
              <div style={{fontSize:14,fontWeight:700,color:"#0f1a12",marginBottom:3}}>{m.title}</div>
              <div style={{fontSize:13,color:"#6b7c72",lineHeight:1.45}}>{m.body}</div>
            </div>
          </div>
        ))}
      </div>
      <button onClick={onDone} style={{width:"100%",background:"#1a6b4a",border:"none",borderRadius:12,padding:"14px 24px",color:"#fff",fontSize:15,fontWeight:700,cursor:"pointer"}}>
        Go to my dashboard →
      </button>
    </div>
  );
}

// ── Wizard shell ─────────────────────────────────────────────────────────────
export function OnboardingWizard({org,onDone}) {
  const [step,setStep]=useState(0);
  const [saving,setSaving]=useState(false);
  const [donorsImported,setDonorsImported]=useState(false);
  const [sequenceActivated,setSequenceActivated]=useState(false);
  const [liveOrg,setLiveOrg]=useState(org);

  const ENCOURAGEMENTS=[
    "Every great organization starts here.",
    "Your mission deserves the right tools.",
    "Your donors will thank you.",
    "Automation means more time for mission.",
    "You're ready to steward relationships at scale.",
  ];

  async function handleOrgProfile(form) {
    setSaving(true);
    try {
      const updated=await apiFetch("/orgs/"+liveOrg.id,{method:"PATCH",body:JSON.stringify(form)});
      setLiveOrg(updated);
      setStep(2);
    } catch(e) { alert("Could not save: "+e.message); }
    setSaving(false);
  }

  function dismiss() {
    localStorage.setItem("steward_onboarded_"+liveOrg.id,"1");
    onDone();
  }

  return (
    <div style={{position:"fixed",inset:0,zIndex:9000,background:"#0f1a12",display:"flex",overflow:"hidden"}}>
      <style>{`@keyframes wiz-check{0%{stroke-dashoffset:60}to{stroke-dashoffset:0}}`}</style>

      {/* Left panel */}
      <div style={{width:"40%",minWidth:280,maxWidth:420,display:"flex",flexDirection:"column",padding:"48px 40px",flexShrink:0}}>
        {/* Wordmark */}
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:"auto"}}>
          <div style={{width:32,height:32,background:"#1a6b4a",borderRadius:9,display:"flex",alignItems:"center",justifyContent:"center"}}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 2L13 5v6L8 14 3 11V5L8 2z" stroke="#f0ede6" strokeWidth="1.5" fill="none"/><circle cx="8" cy="8" r="2" fill="#f0ede6"/></svg>
          </div>
          <span style={{fontSize:16,fontWeight:700,color:"#f0ede6",letterSpacing:"-0.02em",fontFamily:"'DM Serif Display',Georgia,serif"}}>Steward</span>
        </div>

        {/* Step content */}
        <div style={{marginBottom:48}}>
          <div style={{fontSize:28,fontWeight:400,color:"#f0ede6",fontFamily:"'DM Serif Display',Georgia,serif",lineHeight:1.25,marginBottom:12}}>
            {STEPS[step].title}
          </div>
          <div style={{fontSize:14,color:"#8fa896",lineHeight:1.6,marginBottom:24}}>
            {STEPS[step].desc}
          </div>
          <div style={{fontSize:13,fontStyle:"italic",color:"#c9a84c",lineHeight:1.5}}>
            {ENCOURAGEMENTS[step]}
          </div>
        </div>

        {/* Step dots */}
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          {STEPS.map((_,i)=>(
            <div key={i} style={{
              width:i===step?24:8,height:8,borderRadius:99,
              background:i<step?"#c9a84c":i===step?"#10b981":"#2d4a35",
              transition:"all 0.25s",
            }}/>
          ))}
        </div>
      </div>

      {/* Right panel */}
      <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",padding:"40px 40px 40px 0",overflow:"auto"}}>
        <div style={{width:"100%",maxWidth:520,background:"#fff",borderRadius:20,padding:"36px 40px",boxShadow:"0 24px 64px rgba(0,0,0,0.25)"}}>
          {step===0&&<StepWelcome onNext={()=>setStep(1)} onSkip={dismiss}/>}
          {step===1&&<StepOrgProfile org={liveOrg} onNext={handleOrgProfile} saving={saving}/>}
          {step===2&&<StepImportDonors
            onNext={()=>{setDonorsImported(true);setStep(3);}}
            onSkip={()=>setStep(3)}
          />}
          {step===3&&<StepFirstSequence
            onNext={()=>{setSequenceActivated(true);setStep(4);}}
            onSkip={()=>setStep(4)}
          />}
          {step===4&&<StepReady
            org={liveOrg}
            donorsImported={donorsImported}
            sequenceActivated={sequenceActivated}
            onDone={dismiss}
          />}
        </div>
      </div>
    </div>
  );
}
