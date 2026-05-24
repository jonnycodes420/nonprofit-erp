import { useState, useEffect } from "react";
import { apiFetch } from "../api";
import { useAuth } from "../main";
import { T, askClaude, Spin, Pill, Card, SectionLabel, AIBtn, PageTitle } from "./shared";

export function Communications({data}) {
  const {auth}=useAuth(); const isAdmin=auth?.user?.role==="admin";
  const [campaigns,setCampaigns]=useState([]); const [loading,setLoading]=useState(true);
  const [selected,setSelected]=useState(null); const [showBuilder,setShowBuilder]=useState(false);
  const [showSmtp,setShowSmtp]=useState(false); const [sending,setSending]=useState(false);
  const [aiDraft,setAiDraft]=useState(""); const [aiLoading,setAiLoading]=useState(false);
  const [form,setForm]=useState({name:"",type:"appeal",subject:"",body:"",stages:[],statuses:[]});
  const [smtp,setSmtp]=useState({smtpHost:"",smtpPort:587,smtpUser:"",smtpPass:"",smtpFrom:""});
  const [savingSmtp,setSavingSmtp]=useState(false); const [sendResult,setSendResult]=useState(null);
  const STAGE_LIST=["prospect","qualify","cultivate","solicit","steward","lapsed"];
  const STATUSES=["major","mid","new","lapsed"];
  const TYPES=["appeal","thank-you","grant-ack","tax-receipt","newsletter"];

  const load=async()=>{try{setCampaigns(await apiFetch("/campaigns"));}catch{}setLoading(false);};
  useEffect(()=>{load();},[]);

  const save=async()=>{
    const seg=JSON.stringify({stages:form.stages,statuses:form.statuses});
    try{await apiFetch("/campaigns",{method:"POST",body:JSON.stringify({name:form.name,type:form.type,subject:form.subject,body:form.body,segment:seg})});
      await load();setShowBuilder(false);setForm({name:"",type:"appeal",subject:"",body:"",stages:[],statuses:[]});}
    catch(e){alert(e.message);}
  };

  const send=async(cmp)=>{
    if(!window.confirm(`Send "${cmp.name}" to filtered donors? This sends real emails.`))return;
    setSending(true);setSendResult(null);
    try{const r=await apiFetch(`/campaigns/${cmp.id}/send`,{method:"POST"});setSendResult(r);await load();}
    catch(e){alert(e.message);}
    setSending(false);
  };

  const draftAI=async()=>{
    setAiLoading(true);setAiDraft("");
    const seg=form.stages.length?`Segments: ${form.stages.join(", ")}`:"";
    await askClaude(`You are an expert nonprofit development writer. Warm, authentic donor communications. Max 250 words.`,
      `Write a donor email for ${data.org.name}.\nType: ${form.type}\nMission: ${data.org.mission}\n${seg}\nSubject hint: ${form.subject||"(generate one)"}\n\nUse these variables where natural: {{donor_name}}, {{gift_amount}}, {{gift_date}}, {{total_giving}}, {{org_name}}, {{year}}\n\nReturn: "Subject: ..." then blank line then the email body. Be personal and mission-driven.`,
      chunk=>setAiDraft(chunk));
    setAiLoading(false);
  };

  const applyDraft=()=>{
    const lines=aiDraft.split("\n"); const subjLine=lines.find(l=>l.startsWith("Subject:"));
    const bodyText=lines.filter(l=>!l.startsWith("Subject:")).join("\n").trim();
    setForm(f=>({...f,subject:subjLine?subjLine.replace("Subject:","").trim():f.subject,body:bodyText||f.body}));
    setAiDraft("");
  };

  const saveSmtp=async()=>{
    setSavingSmtp(true);
    try{await apiFetch("/org/smtp",{method:"PUT",body:JSON.stringify(smtp)});alert("SMTP settings saved.");}
    catch(e){alert(e.message);}
    setSavingSmtp(false);
  };

  const toggleStage=s=>setForm(f=>({...f,stages:f.stages.includes(s)?f.stages.filter(x=>x!==s):[...f.stages,s]}));
  const toggleStatus=s=>setForm(f=>({...f,statuses:f.statuses.includes(s)?f.statuses.filter(x=>x!==s):[...f.statuses,s]}));

  const Inp=({label,k,state,set,type="text",ph=""})=>(
    <div style={{display:"flex",flexDirection:"column",gap:4}}>
      <label style={{fontSize:11,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.06em"}}>{label}</label>
      <input type={type} value={state[k]} onChange={e=>set(s=>({...s,[k]:e.target.value}))} placeholder={ph}
        style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"9px 12px",color:T.ink,fontSize:13,outline:"none"}}/>
    </div>
  );

  return <div style={{display:"flex",flexDirection:"column",gap:16}}>
    <PageTitle main="Email" accent="campaigns."/>
    <div style={{display:"flex",gap:10,alignItems:"center"}}>
      <button onClick={()=>setShowBuilder(true)} style={{background:"#10b981",border:"none",borderRadius:10,padding:"10px 16px",color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer"}}>+ New Campaign</button>
      {isAdmin&&<button onClick={()=>setShowSmtp(!showSmtp)} style={{background:"transparent",border:"1px solid "+T.bg3,borderRadius:10,padding:"10px 14px",color:T.ink3,fontSize:12,cursor:"pointer"}}>⚙ SMTP Settings</button>}
    </div>

    {showSmtp&&isAdmin&&<Card>
      <SectionLabel>SMTP Settings</SectionLabel>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
        <Inp label="SMTP Host" k="smtpHost" state={smtp} set={setSmtp} ph="smtp.gmail.com"/>
        <Inp label="Port" k="smtpPort" state={smtp} set={setSmtp} type="number" ph="587"/>
        <Inp label="Username" k="smtpUser" state={smtp} set={setSmtp} ph="you@yourdomain.org"/>
        <Inp label="Password" k="smtpPass" state={smtp} set={setSmtp} type="password" ph="••••••••"/>
        <Inp label="From Address" k="smtpFrom" state={smtp} set={setSmtp} ph="CREO Arts <outreach@creoarts.org>"/>
      </div>
      <button onClick={saveSmtp} disabled={savingSmtp} style={{marginTop:12,background:"#10b981",border:"none",borderRadius:8,padding:"9px 16px",color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer"}}>Save SMTP</button>
      <div style={{marginTop:8,fontSize:11,color:T.ink3}}>Gmail: use an App Password. Resend: smtp.resend.com / port 465.</div>
    </Card>}

    {showBuilder&&<Card style={{display:"flex",flexDirection:"column",gap:12}}>
      <SectionLabel>New Campaign</SectionLabel>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
        <Inp label="Campaign Name" k="name" state={form} set={setForm} ph="Spring Appeal 2025"/>
        <div style={{display:"flex",flexDirection:"column",gap:4}}>
          <label style={{fontSize:11,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.06em"}}>Type</label>
          <select value={form.type} onChange={e=>setForm(f=>({...f,type:e.target.value}))} style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"9px 12px",color:T.ink,fontSize:13}}>
            {TYPES.map(t=><option key={t} value={t}>{t}</option>)}
          </select>
        </div>
      </div>
      <Inp label="Subject Line" k="subject" state={form} set={setForm} ph="A message from {{org_name}}"/>
      <div style={{display:"flex",flexDirection:"column",gap:4}}>
        <label style={{fontSize:11,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.06em"}}>Email Body</label>
        <textarea value={form.body} onChange={e=>setForm(f=>({...f,body:e.target.value}))} rows={8} placeholder={"Dear {{donor_name}},\n\n..."}
          style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"10px 12px",color:T.ink,fontSize:13,outline:"none",resize:"vertical",fontFamily:"inherit"}}/>
        <div style={{fontSize:10,color:T.ink3}}>Variables: {"{{donor_name}} {{gift_amount}} {{gift_date}} {{total_giving}} {{org_name}} {{year}}"}</div>
      </div>
      <div>
        <SectionLabel>Segment — Stages</SectionLabel>
        <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:8}}>
          {STAGE_LIST.map(s=><button key={s} onClick={()=>toggleStage(s)} style={{background:form.stages.includes(s)?"#10b981":T.bg2,border:"none",borderRadius:99,padding:"5px 12px",color:form.stages.includes(s)?"#fff":T.ink3,fontSize:11,cursor:"pointer",fontWeight:form.stages.includes(s)?700:400}}>{s}</button>)}
        </div>
        <SectionLabel>Segment — Status</SectionLabel>
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
          {STATUSES.map(s=><button key={s} onClick={()=>toggleStatus(s)} style={{background:form.statuses.includes(s)?"#8b5cf6":T.bg2,border:"none",borderRadius:99,padding:"5px 12px",color:form.statuses.includes(s)?"#fff":T.ink3,fontSize:11,cursor:"pointer",fontWeight:form.statuses.includes(s)?700:400}}>{s}</button>)}
        </div>
      </div>
      <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
        <AIBtn onClick={draftAI} loading={aiLoading} label="✦ AI Draft" small/>
        <button onClick={save} style={{background:"#10b981",border:"none",borderRadius:8,padding:"9px 16px",color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer"}}>Save Draft</button>
        <button onClick={()=>{setShowBuilder(false);setAiDraft("");}} style={{background:T.bg,border:"none",borderRadius:8,padding:"9px 14px",color:T.ink3,fontSize:13,cursor:"pointer"}}>Cancel</button>
      </div>
      {aiDraft&&<div style={{background:T.bg,border:"1px solid #10b98144",borderRadius:12,padding:16}}>
        <div style={{fontSize:10,fontWeight:700,color:"#8b5cf6",letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:8}}>✦ AI Draft</div>
        <div style={{fontSize:13,color:T.ink2,lineHeight:1.75,whiteSpace:"pre-wrap",marginBottom:12}}>{aiDraft}</div>
        <button onClick={applyDraft} style={{background:"#10b981",border:"none",borderRadius:8,padding:"8px 14px",color:"#fff",fontSize:12,fontWeight:700,cursor:"pointer"}}>Apply to form</button>
      </div>}
    </Card>}

    {sendResult&&<div style={{background:"#052e16",border:"1px solid #10b981",borderRadius:12,padding:"14px 18px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
      <span style={{color:"#10b981",fontWeight:700,fontSize:14}}>✓ Sent to {sendResult.sent} donors{sendResult.failed>0?` (${sendResult.failed} failed)`:""}</span>
      <button onClick={()=>setSendResult(null)} style={{background:"transparent",border:"none",color:"#10b981",cursor:"pointer",fontSize:18}}>×</button>
    </div>}

    {loading?<div style={{color:T.ink3,fontSize:13,textAlign:"center",padding:40}}>Loading campaigns…</div>:
      campaigns.length===0?<Card><div style={{color:T.ink3,fontSize:13,textAlign:"center",padding:20}}>No campaigns yet. Create your first campaign above.</div></Card>:
      campaigns.map(c=>{
        const isOpen=selected?.id===c.id;
        const openRate=c.recipient_count>0?Math.round(c.open_count/c.recipient_count*100):0;
        const seg=typeof c.segment==="string"?JSON.parse(c.segment||"{}"):c.segment||{};
        return <Card key={c.id} selected={isOpen} accent={c.status==="sent"?"#10b981":"#8b5cf6"} onClick={()=>setSelected(isOpen?null:c)}>
          <div style={{display:"flex",alignItems:"center",gap:12}}>
            <div style={{flex:1}}>
              <div style={{fontSize:15,fontWeight:700,color:T.ink}}>{c.name}</div>
              <div style={{fontSize:12,color:T.ink3,marginTop:2}}>{c.subject}</div>
            </div>
            <div style={{textAlign:"right"}}>
              {c.status==="sent"&&<div style={{fontSize:13,color:T.ink,fontWeight:600}}>{c.recipient_count} sent · {openRate}% opened</div>}
              {c.status==="draft"&&<div style={{fontSize:11,color:T.ink3}}>Draft</div>}
            </div>
            <Pill label={c.status} color={c.status==="sent"?"#10b981":"#8b5cf6"}/>
          </div>
          {c.status==="sent"&&<div style={{marginTop:8,height:3,background:T.bg3,borderRadius:99}}>
            <div style={{height:"100%",width:`${openRate}%`,background:"#10b981",borderRadius:99}}/>
          </div>}
          {isOpen&&<div style={{marginTop:14,paddingTop:14,borderTop:"1px solid "+T.bg3}}>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:14}}>
              <div><div style={{fontSize:10,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.06em"}}>Type</div><div style={{fontSize:13,color:T.ink,marginTop:3}}>{c.type}</div></div>
              <div><div style={{fontSize:10,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.06em"}}>Segment</div><div style={{fontSize:12,color:T.ink3,marginTop:3}}>{[...(seg.stages||[]),...(seg.statuses||[])].join(", ")||"All donors with email"}</div></div>
              {c.status==="sent"&&<><div><div style={{fontSize:10,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.06em"}}>Recipients</div><div style={{fontSize:13,color:T.ink,marginTop:3}}>{c.recipient_count}</div></div>
              <div><div style={{fontSize:10,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.06em"}}>Open Rate</div><div style={{fontSize:13,color:openRate>=25?"#10b981":"#f59e0b",marginTop:3}}>{openRate}%</div></div></>}
              <div style={{gridColumn:"1/-1"}}><div style={{fontSize:10,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.06em"}}>Preview</div>
                <div style={{fontSize:12,color:T.ink3,marginTop:3,lineHeight:1.5,whiteSpace:"pre-wrap"}}>{c.body?.slice(0,220)}{c.body?.length>220?"…":""}</div></div>
            </div>
            {c.status==="draft"&&isAdmin&&<button onClick={e=>{e.stopPropagation();send(c);}} disabled={sending}
              style={{background:sending?T.bg2:"#10b981",border:"none",borderRadius:8,padding:"9px 16px",color:"#fff",fontSize:13,fontWeight:700,cursor:sending?"not-allowed":"pointer"}}>
              {sending?<><Spin/>Sending…</>:"↑ Send Campaign"}
            </button>}
            {c.recipients&&c.recipients.length>0&&<div style={{marginTop:14}}>
              <div style={{fontSize:11,fontWeight:700,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:8}}>Recipients</div>
              {c.recipients.slice(0,10).map(r=><div key={r.id} style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:"1px solid "+T.bg2,fontSize:12}}>
                <span style={{color:T.ink}}>{r.donor_name||r.email}</span>
                <span style={{color:r.opened_at?"#10b981":"#6b7280"}}>{r.opened_at?"✓ opened":r.sent_at?"delivered":"pending"}</span>
              </div>)}
              {c.recipients.length>10&&<div style={{fontSize:11,color:T.ink3,marginTop:6}}>+{c.recipients.length-10} more</div>}
            </div>}
          </div>}
        </Card>;
      })}
  </div>;
}
