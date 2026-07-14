import { useState, useEffect } from "react";
import QRCode from "qrcode";
import { T, Pill, SectionLabel, PageTitle } from "./shared";
import { apiFetch, API, getToken } from "../api";
import UpgradeModal from "./UpgradeModal";

// Billing status badge styling, keyed by orgs.subscription_status.
// "cancelled" (2 l's) is included alongside "canceled" (1 l) because old
// rows may have been written with either spelling (see server.js).
const BILLING_STATUS_META = {
  active:        { label:"Active",        bg:"#e8f5ef", color:"#1a6b4a", border:"#10b981" },
  trialing:      { label:"Trialing",      bg:"#1a2e1f", color:"#8fa896", border:"#2d4a35" },
  past_due:      { label:"Past Due",      bg:"#fef2f2", color:"#dc2626", border:"#fecaca" },
  trial_expired: { label:"Trial Expired", bg:"#fef2f2", color:"#dc2626", border:"#fecaca" },
  canceled:      { label:"Canceled",      bg:"#1a2e1f", color:"#8fa896", border:"#2d4a35" },
  cancelled:     { label:"Canceled",      bg:"#1a2e1f", color:"#8fa896", border:"#2d4a35" },
};

// One QR/embed mechanism, parameterized by URL — used for both the org-wide
// donation page and each individual Giving Page's own shareable link, rather
// than a second QR/embed system. Module-level (not defined inside Settings)
// so it doesn't remount and lose its own qrDataUrl state on every parent
// re-render (see CLAUDE.md "Key patterns" re: TpField/TpYesNo).
function QrCodeBlock({url,filenameBase}){
  const [qrDataUrl,setQrDataUrl]=useState("");
  const [qrLoading,setQrLoading]=useState(false);

  async function generateQR(){
    if(!url)return;
    setQrLoading(true);
    try{
      const dataUrl=await QRCode.toDataURL(url,{width:300,margin:2,color:{dark:"#0f1a12",light:"#faf8f4"}});
      setQrDataUrl(dataUrl);
    }catch(e){console.error(e);}
    setQrLoading(false);
  }
  function downloadQR(){
    if(!qrDataUrl)return;
    const a=document.createElement("a");
    a.href=qrDataUrl;
    a.download=`${filenameBase}-donation-qr.png`;
    a.click();
  }
  function printQR(){
    if(!qrDataUrl)return;
    const w=window.open("","_blank","width=600,height=700");
    w.document.write(`<!DOCTYPE html><html><head><title>Donation QR</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:#fff;font-family:'DM Sans',system-ui,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;padding:40px}
  img{width:280px;height:280px}
  p{font-size:16px;color:#6b6b6b;text-align:center;margin-top:16px}
  @media print{@page{margin:0.5in}body{padding:20px}}
</style></head><body>
<img src="${qrDataUrl}"/>
<p>Scan to give</p>
<script>window.onload=()=>{setTimeout(()=>{window.print();},400)}<\/script>
</body></html>`);
    w.document.close();
  }

  return(
    <div style={{display:"flex",gap:10,flexWrap:"wrap",alignItems:"flex-start"}}>
      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
        {!qrDataUrl?(
          <button onClick={generateQR} disabled={qrLoading}
            style={{background:T.green,border:"none",borderRadius:8,padding:"9px 18px",color:"#fff",fontSize:13,fontWeight:700,cursor:qrLoading?"not-allowed":"pointer",opacity:qrLoading?0.7:1}}>
            {qrLoading?"Generating…":"Generate QR Code"}
          </button>
        ):(
          <>
            <button onClick={downloadQR}
              style={{background:T.greenDk,border:"none",borderRadius:8,padding:"9px 18px",color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer"}}>
              ↓ Download PNG
            </button>
            <button onClick={printQR}
              style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"9px 18px",color:T.ink,fontSize:13,fontWeight:600,cursor:"pointer"}}>
              🖨 Print
            </button>
            <button onClick={()=>setQrDataUrl("")}
              style={{background:"transparent",border:"1px solid "+T.bg3,borderRadius:8,padding:"9px 14px",color:T.ink3,fontSize:13,cursor:"pointer"}}>
              Regenerate
            </button>
          </>
        )}
      </div>
      {qrDataUrl&&<img src={qrDataUrl} alt="Donation QR Code" style={{width:120,height:120,borderRadius:8,border:"1px solid "+T.bg3,flexShrink:0}}/>}
    </div>
  );
}

function EmbedCodeBlock({url}){
  const [embedCopied,setEmbedCopied]=useState(false);
  const embedCode = url ? `<iframe src="${url}" width="100%" height="600" frameborder="0"></iframe>` : "";
  function copyEmbed(){
    navigator.clipboard.writeText(embedCode).then(()=>{setEmbedCopied(true);setTimeout(()=>setEmbedCopied(false),2500);});
  }
  return(
    <div style={{position:"relative"}}>
      <pre style={{background:"#0f172a",color:"#a5f3c0",borderRadius:10,padding:"14px 16px",fontSize:12,lineHeight:1.7,overflowX:"auto",margin:0,fontFamily:"'Fira Code',monospace,monospace",whiteSpace:"pre-wrap",wordBreak:"break-all"}}>
        {embedCode}
      </pre>
      <button onClick={copyEmbed}
        style={{position:"absolute",top:10,right:10,background:embedCopied?"#10b98130":"rgba(255,255,255,0.12)",border:"1px solid rgba(255,255,255,0.2)",borderRadius:6,padding:"4px 10px",color:embedCopied?"#a5f3c0":"#e2e8f0",fontSize:11,fontWeight:700,cursor:"pointer",transition:"all 0.15s"}}>
        {embedCopied?"✓ Copied!":"Copy Code"}
      </button>
    </div>
  );
}

function slugifyPreview(s){
  return (s||"").toLowerCase().trim().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,60);
}

const GP_STATUS_META={
  active:   {label:"Active",   bg:"#e8f5ef", color:"#1a6b4a", border:"#10b981"},
  archived: {label:"Archived", bg:"#f3f0eb", color:"#6b6b6b", border:"#d4cfc6"},
};

// Own top-level manager component (module scope, like QrCodeBlock/
// EmbedCodeBlock above) — a titled, storied, goal-tracked donation page
// distinct from the org-wide /give/:orgSlug page, sharing that same QR/embed
// mechanism per-page rather than a second system. See CLAUDE.md "Giving
// Pages" — NOT the `campaigns` (email campaign) table/concept.
function GivingPagesManager({orgSlug,isAdmin,isReadOnly}){
  const [pages,setPages]=useState([]);
  const [funds,setFunds]=useState([]);
  const [loaded,setLoaded]=useState(false);
  const [showAdd,setShowAdd]=useState(false);
  const [editing,setEditing]=useState(null);
  const [form,setForm]=useState({title:"",goalAmount:"",story:"",imageUrl:"",fundId:"",slug:"",status:"active"});
  const [slugTouched,setSlugTouched]=useState(false);
  const [saving,setSaving]=useState(false);
  const [shareOpenId,setShareOpenId]=useState(null);

  useEffect(()=>{
    apiFetch("/giving-pages").then(r=>{setPages(r||[]);setLoaded(true);}).catch(()=>setLoaded(true));
    apiFetch("/finance/funds").then(r=>setFunds(r||[])).catch(()=>{});
  },[]);

  function openAdd(){
    setEditing(null);
    setForm({title:"",goalAmount:"",story:"",imageUrl:"",fundId:"",slug:"",status:"active"});
    setSlugTouched(false);
    setShowAdd(true);
  }
  function openEdit(p){
    setEditing(p);
    setForm({title:p.title,goalAmount:p.goal_amount!=null?String(p.goal_amount):"",story:p.story||"",imageUrl:p.image_url||"",fundId:p.fund_id||"",slug:p.slug,status:p.status});
    setSlugTouched(true);
    setShowAdd(true);
  }
  function closeModal(){
    setShowAdd(false);setEditing(null);
    setForm({title:"",goalAmount:"",story:"",imageUrl:"",fundId:"",slug:"",status:"active"});
    setSlugTouched(false);
  }

  async function save(){
    if(!form.title.trim())return;
    setSaving(true);
    try{
      const body={title:form.title,goalAmount:form.goalAmount,story:form.story,imageUrl:form.imageUrl,fundId:form.fundId,slug:form.slug,status:form.status};
      if(editing){
        const updated=await apiFetch(`/giving-pages/${editing.id}`,{method:"PUT",body:JSON.stringify(body)});
        setPages(prev=>prev.map(p=>p.id===editing.id?updated:p));
      }else{
        const created=await apiFetch("/giving-pages",{method:"POST",body:JSON.stringify(body)});
        setPages(prev=>[created,...prev]);
      }
      closeModal();
    }catch(e){alert(e.message||"Failed to save giving page");}
    setSaving(false);
  }

  async function toggleArchive(p){
    const nextStatus=p.status==="active"?"archived":"active";
    try{
      const updated=await apiFetch(`/giving-pages/${p.id}`,{method:"PUT",body:JSON.stringify({status:nextStatus})});
      setPages(prev=>prev.map(x=>x.id===p.id?updated:x));
    }catch(e){alert(e.message||"Failed to update giving page");}
  }

  const inp={width:"100%",boxSizing:"border-box",border:"1px solid "+T.bg3,borderRadius:10,padding:"10px 12px",fontSize:14,color:T.ink,background:T.bg,outline:"none",marginBottom:14,fontFamily:"inherit"};

  return(
    <div style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:16,padding:"24px 28px"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
        <SectionLabel>Giving Pages</SectionLabel>
        {isAdmin&&<button onClick={openAdd} disabled={isReadOnly||!orgSlug} title={isReadOnly?"Reactivate your subscription to make changes.":(!orgSlug?"Set up your organization first.":undefined)}
          style={{background:T.green,border:"none",borderRadius:8,padding:"7px 14px",color:"#fff",fontSize:12,fontWeight:700,cursor:(isReadOnly||!orgSlug)?"not-allowed":"pointer",opacity:(isReadOnly||!orgSlug)?0.45:1}}>
          + New Giving Page
        </button>}
      </div>
      <div style={{fontSize:13,color:T.ink3,marginBottom:pages.length?14:0,lineHeight:1.6}}>
        {pages.length===0
          ?"Build a titled, storied donation page for a specific campaign, gala, or appeal — with its own goal and progress bar, separate from your main donation page."
          :"Each page has its own shareable link, goal, and progress — computed live from actual gifts, never a manually-set number."}
      </div>
      {!loaded&&<div style={{fontSize:13,color:T.ink3}}>Loading…</div>}

      {pages.map((p,i)=>{
        const raised=parseFloat(p.raised_amount)||0;
        const goal=p.goal_amount!=null?parseFloat(p.goal_amount):null;
        const pct=goal>0?Math.min(100,Math.round((raised/goal)*100)):null;
        const url=orgSlug?`${window.location.origin}/give/${orgSlug}/${p.slug}`:"";
        const meta=GP_STATUS_META[p.status]||GP_STATUS_META.active;
        const shareOpen=shareOpenId===p.id;
        return(
          <div key={p.id} style={{padding:"14px 0",borderBottom:i<pages.length-1||shareOpen?"1px solid "+T.bg3:"none"}}>
            <div style={{display:"flex",alignItems:"center",gap:12}}>
              <div style={{flex:1,minWidth:0}}>
                <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                  <span style={{fontSize:14,fontWeight:700,color:T.ink}}>{p.title}</span>
                  <span style={{fontSize:10,fontWeight:700,padding:"2px 8px",borderRadius:99,background:meta.bg,color:meta.color,border:"1px solid "+meta.border}}>{meta.label}</span>
                  {p.fund_name&&<span style={{fontSize:11,color:T.ink3}}>→ {p.fund_name}</span>}
                </div>
                <div style={{fontSize:12,color:T.ink3,marginTop:4}}>
                  {fmtDollars(raised)}{goal?` of ${fmtDollars(goal)} raised`:" raised"}{pct!=null?` — ${pct}%`:""}
                </div>
                {goal>0&&(
                  <div style={{background:T.bg,borderRadius:99,height:6,overflow:"hidden",marginTop:6,maxWidth:320}}>
                    <div style={{height:"100%",width:`${pct}%`,background:T.greenDk,borderRadius:99}}/>
                  </div>
                )}
              </div>
              <div style={{display:"flex",gap:6,flexShrink:0}}>
                <button onClick={()=>setShareOpenId(shareOpen?null:p.id)}
                  style={{background:shareOpen?T.greenDk:T.bg,border:"1px solid "+(shareOpen?T.greenDk:T.bg3),borderRadius:6,padding:"5px 10px",fontSize:11,fontWeight:600,color:shareOpen?"#fff":T.ink2,cursor:"pointer"}}>
                  Share {shareOpen?"▲":"▼"}
                </button>
                {isAdmin&&<>
                  <button onClick={()=>openEdit(p)} style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:6,padding:"5px 10px",fontSize:11,fontWeight:600,color:T.ink2,cursor:"pointer"}}>Edit</button>
                  <button onClick={()=>toggleArchive(p)} disabled={isReadOnly}
                    style={{background:p.status==="active"?"#fef2f2":"#e8f5ef",border:"1px solid "+(p.status==="active"?"#fecaca":"#10b981"),borderRadius:6,padding:"5px 10px",fontSize:11,fontWeight:600,color:p.status==="active"?"#dc2626":"#1a6b4a",cursor:isReadOnly?"not-allowed":"pointer",opacity:isReadOnly?0.6:1}}>
                    {p.status==="active"?"Archive":"Reactivate"}
                  </button>
                </>}
              </div>
            </div>
            {shareOpen&&(
              <div style={{marginTop:14,background:T.bg,border:"1px solid "+T.bg3,borderRadius:12,padding:"16px 18px",display:"flex",flexDirection:"column",gap:14}}>
                <div style={{background:T.white,borderRadius:10,padding:"10px 14px",fontFamily:"monospace",fontSize:12,color:T.ink2,wordBreak:"break-all",border:"1px solid "+T.bg3}}>
                  {url}
                </div>
                <QrCodeBlock url={url} filenameBase={slugifyPreview(p.title)||"giving-page"}/>
                <div>
                  <div style={{fontSize:11,fontWeight:700,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:8}}>Embed Code</div>
                  <EmbedCodeBlock url={url}/>
                </div>
              </div>
            )}
          </div>
        );
      })}

      {showAdd&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.45)",zIndex:500,display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={e=>{if(e.target===e.currentTarget)closeModal();}}>
          <div style={{background:T.white,borderRadius:20,padding:"32px 28px",width:480,maxWidth:"calc(100vw - 32px)",maxHeight:"calc(100vh - 32px)",overflowY:"auto",boxShadow:"0 8px 40px rgba(0,0,0,0.16)"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
              <div style={{fontSize:17,fontWeight:700,color:T.ink}}>{editing?"Edit giving page":"New giving page"}</div>
              <button onClick={closeModal} style={{background:"none",border:"none",fontSize:20,cursor:"pointer",color:T.ink3,lineHeight:1}}>×</button>
            </div>

            <div style={{fontSize:12,fontWeight:600,color:T.ink3,marginBottom:4}}>Title</div>
            <input value={form.title}
              onChange={e=>{
                const title=e.target.value;
                setForm(f=>({...f,title,slug:slugTouched?f.slug:slugifyPreview(title)}));
              }}
              placeholder="e.g. Annual Gala 2026"
              style={inp}
            />

            <div style={{fontSize:12,fontWeight:600,color:T.ink3,marginBottom:4}}>URL slug</div>
            <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:14}}>
              <span style={{fontSize:12,color:T.ink3,whiteSpace:"nowrap"}}>/give/{orgSlug}/</span>
              <input value={form.slug}
                onChange={e=>{setSlugTouched(true);setForm(f=>({...f,slug:slugifyPreview(e.target.value)}));}}
                placeholder="annual-gala-2026"
                style={{...inp,marginBottom:0}}
              />
            </div>

            <div style={{fontSize:12,fontWeight:600,color:T.ink3,marginBottom:4}}>Goal amount ($, optional)</div>
            <input type="number" value={form.goalAmount} onChange={e=>setForm(f=>({...f,goalAmount:e.target.value}))}
              placeholder="e.g. 25000" style={inp}
            />

            <div style={{fontSize:12,fontWeight:600,color:T.ink3,marginBottom:4}}>Story</div>
            <textarea value={form.story} onChange={e=>setForm(f=>({...f,story:e.target.value}))}
              placeholder="Tell donors what this campaign is for and why it matters."
              rows={4}
              style={{...inp,resize:"vertical"}}
            />

            <div style={{fontSize:12,fontWeight:600,color:T.ink3,marginBottom:4}}>Image URL (optional)</div>
            <input value={form.imageUrl} onChange={e=>setForm(f=>({...f,imageUrl:e.target.value}))}
              placeholder="https://…" style={inp}
            />

            <div style={{fontSize:12,fontWeight:600,color:T.ink3,marginBottom:4}}>Designate to a fund (optional)</div>
            <select value={form.fundId} onChange={e=>setForm(f=>({...f,fundId:e.target.value}))} style={{...inp,cursor:"pointer"}}>
              <option value="">Where it's needed most</option>
              {funds.map(f=><option key={f.id} value={f.id}>{f.name}{f.restricted?" (Restricted)":""}</option>)}
            </select>

            {editing&&(
              <label style={{display:"flex",alignItems:"center",gap:8,fontSize:13,color:T.ink,cursor:"pointer",marginBottom:20,marginTop:-4}}>
                <input type="checkbox" checked={form.status==="archived"} onChange={e=>setForm(f=>({...f,status:e.target.checked?"archived":"active"}))} style={{width:16,height:16,cursor:"pointer"}}/>
                Archived (hidden from the public link)
              </label>
            )}

            <div style={{display:"flex",gap:10,marginTop:6}}>
              <button onClick={closeModal} style={{flex:1,background:T.bg,border:"1px solid "+T.bg3,borderRadius:10,padding:"10px",color:T.ink2,fontSize:13,fontWeight:600,cursor:"pointer"}}>Cancel</button>
              <button onClick={save} disabled={saving||!form.title.trim()}
                style={{flex:2,background:T.green,border:"none",borderRadius:10,padding:"10px",color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer",opacity:(saving||!form.title.trim())?0.7:1}}>
                {saving?"Saving…":editing?"Save changes":"Create giving page"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function fmtDollars(n){
  return "$"+Math.round(n||0).toLocaleString();
}

export function Settings({auth,logout}) {
  const orgName=auth?.org?.name||"Your Organization";
  const userName=auth?.user?.name||"User";
  const userEmail=auth?.user?.email||"";
  const userRole=auth?.user?.role||"staff";
  const isAdmin=userRole==="admin";

  const [team,setTeam]=useState([]);
  const [showInvite,setShowInvite]=useState(false);
  const [invEmail,setInvEmail]=useState("");
  const [invRole,setInvRole]=useState("staff");
  const [inviting,setInviting]=useState(false);
  const [inviteResult,setInviteResult]=useState(null);
  const [invErr,setInvErr]=useState("");
  const [copied,setCopied]=useState(false);

  const [stripe,setStripe]=useState(null);
  const [stripeLoading,setStripeLoading]=useState(false);

  const [orgSlug,setOrgSlug]=useState(auth?.org?.org_slug||"");

  const [customFields,setCustomFields]=useState([]);
  const [showAddField,setShowAddField]=useState(false);
  const [editingField,setEditingField]=useState(null);
  const [cfForm,setCfForm]=useState({label:"",fieldType:"text",options:[],required:false});
  const [cfOptInput,setCfOptInput]=useState("");
  const [cfSaving,setCfSaving]=useState(false);

  const [impactMetrics,setImpactMetrics]=useState([]);
  const [showAddMetric,setShowAddMetric]=useState(false);
  const [editingMetric,setEditingMetric]=useState(null);
  const [imForm,setImForm]=useState({name:"",dollarThreshold:"",outcomeTemplate:""});
  const [imSaving,setImSaving]=useState(false);

  const [billing,setBilling]=useState(null);
  const [portalLoading,setPortalLoading]=useState(false);
  const [upgradeModal,setUpgradeModal]=useState(null);
  const isReadOnly=billing?.accessState==="read_only";

  const [gmailStatus,setGmailStatus]=useState(null);
  const [gmailSyncing,setGmailSyncing]=useState(false);
  const [gmailToast,setGmailToast]=useState("");

  const [sampleStatus,setSampleStatus]=useState(null);
  const [sampleLoading,setSampleLoading]=useState(false);
  const [sampleClearing,setSampleClearing]=useState(false);
  const [exporting,setExporting]=useState(false);

  useEffect(()=>{
    apiFetch("/org/team").then(setTeam).catch(()=>{});
    apiFetch("/stripe/status").then(setStripe).catch(()=>{});
    apiFetch("/billing/status").then(setBilling).catch(()=>{});
    if(!auth?.org?.org_slug){
      apiFetch("/org").then(r=>{ if(r.org_slug) setOrgSlug(r.org_slug); }).catch(()=>{});
    }
    apiFetch("/custom-fields").then(setCustomFields).catch(()=>{});
    apiFetch("/impact-metrics").then(setImpactMetrics).catch(()=>{});
    apiFetch("/gmail/status").then(setGmailStatus).catch(()=>{});
    apiFetch("/org/sample-data-status").then(setSampleStatus).catch(()=>{});

    const params=new URLSearchParams(window.location.search);
    if(params.get("gmailConnected")==="true"){
      setGmailToast("Gmail connected! Syncing donor emails now…");
      setTimeout(()=>setGmailToast(""),4000);
      window.history.replaceState({},"",window.location.pathname);
      apiFetch("/gmail/status").then(setGmailStatus).catch(()=>{});
    }
    if(params.get("gmailError")){
      setGmailToast("Gmail connection failed. Please try again.");
      setTimeout(()=>setGmailToast(""),4000);
      window.history.replaceState({},"",window.location.pathname);
    }
  },[]);

  async function connectGmail(){
    try{
      const r=await apiFetch("/gmail/auth-url",{method:"POST"});
      window.location.href=r.url;
    }catch(e){ alert(e.message||"Failed to start Gmail connect"); }
  }

  async function disconnectGmail(){
    if(!window.confirm("Disconnect Gmail? Synced interactions will remain."))return;
    await apiFetch("/gmail/disconnect",{method:"DELETE"}).catch(()=>{});
    setGmailStatus({connected:false});
  }

  async function syncGmailNow(){
    setGmailSyncing(true);
    try{
      await apiFetch("/gmail/sync",{method:"POST"});
      setGmailToast("Sync started — new emails will appear shortly.");
      setTimeout(()=>setGmailToast(""),3500);
      setTimeout(()=>apiFetch("/gmail/status").then(setGmailStatus).catch(()=>{}),3000);
    }catch(e){ alert(e.message||"Sync failed"); }
    setGmailSyncing(false);
  }

  function fmtSynced(ts){
    if(!ts)return"Never synced";
    const mins=Math.floor((Date.now()-new Date(ts))/60000);
    if(mins<1)return"Just now";
    if(mins<60)return`${mins}m ago`;
    const hrs=Math.floor(mins/60);
    if(hrs<24)return`${hrs}h ago`;
    return new Date(ts).toLocaleDateString("en-US",{month:"short",day:"numeric"});
  }

  async function openBillingPortal(){
    setPortalLoading(true);
    try{
      const r=await apiFetch("/billing/create-portal",{method:"POST"});
      window.location.href=r.url;
    }catch(e){ alert(e.message||"Could not open billing portal"); setPortalLoading(false); }
  }

  const donationUrl = orgSlug ? `${window.location.origin}/give/${orgSlug}` : "";

  async function loadSampleData(){
    setSampleLoading(true);
    try{
      await apiFetch("/org/load-sample-data",{method:"POST"});
      const s=await apiFetch("/org/sample-data-status");
      setSampleStatus(s);
      window.location.reload();
    }catch(e){ alert(e.message||"Failed to load sample data"); setSampleLoading(false); }
  }

  async function clearSampleData(){
    if(!window.confirm("Remove all sample data? This cannot be undone."))return;
    setSampleClearing(true);
    try{
      await apiFetch("/org/clear-sample-data",{method:"POST"});
      setSampleStatus({hasSampleData:false,sampleDonorCount:0});
      window.location.reload();
    }catch(e){ alert(e.message||"Failed to clear sample data"); setSampleClearing(false); }
  }

  async function exportData(){
    setExporting(true);
    try{
      const r=await fetch(`${API}/org/export`,{headers:{Authorization:`Bearer ${getToken()}`}});
      if(!r.ok){const e=await r.json().catch(()=>({}));throw new Error(e.error||"Export failed");}
      const blob=await r.blob();
      const url=URL.createObjectURL(blob);
      const a=document.createElement("a");
      a.href=url; a.download=`steward-export.json`;
      document.body.appendChild(a); a.click();
      document.body.removeChild(a); URL.revokeObjectURL(url);
    }catch(e){alert(e.message||"Export failed");}
    setExporting(false);
  }

  async function connectStripe(){
    setStripeLoading(true);
    try{
      const r=await apiFetch("/stripe/connect",{method:"POST"});
      window.location.href=r.url;
    }catch(e){
      alert(e.message||"Failed to start Stripe connect");
      setStripeLoading(false);
    }
  }

  async function sendInvite(){
    if(!invEmail.trim()){setInvErr("Email required");return;}
    setInviting(true);setInvErr("");
    try{
      const r=await apiFetch("/auth/invite",{method:"POST",body:JSON.stringify({email:invEmail.trim(),role:invRole})});
      setInviteResult({link:r.inviteLink,emailSent:r.emailSent});
    }catch(e){
      if(e.error==="seat_limit"){
        closeInvite();
        setUpgradeModal({reason:e.error,current:e.current,limit:e.limit,plan:e.plan});
      } else {
        setInvErr(e.message||"Failed to send invite");
      }
    }finally{setInviting(false);}
  }

  function openAddField(){
    setEditingField(null);
    setCfForm({label:"",fieldType:"text",options:[],required:false});
    setCfOptInput("");
    setShowAddField(true);
  }

  function openEditField(f){
    setEditingField(f);
    setCfForm({label:f.label,fieldType:f.field_type,options:Array.isArray(f.options)?f.options:[],required:!!f.required});
    setCfOptInput("");
    setShowAddField(true);
  }

  function closeCfModal(){
    setShowAddField(false);setEditingField(null);
    setCfForm({label:"",fieldType:"text",options:[],required:false});
    setCfOptInput("");
  }

  function addCfOption(){
    const v=cfOptInput.trim();
    if(!v)return;
    setCfForm(f=>({...f,options:[...f.options,v]}));
    setCfOptInput("");
  }

  function removeCfOption(i){
    setCfForm(f=>({...f,options:f.options.filter((_,j)=>j!==i)}));
  }

  async function saveCfField(){
    if(!cfForm.label.trim()){return;}
    setCfSaving(true);
    try{
      if(editingField){
        const updated=await apiFetch(`/custom-fields/${editingField.id}`,{method:"PUT",body:JSON.stringify({label:cfForm.label,fieldType:cfForm.fieldType,options:cfForm.options,required:cfForm.required})});
        setCustomFields(prev=>prev.map(f=>f.id===editingField.id?updated:f));
      }else{
        const created=await apiFetch("/custom-fields",{method:"POST",body:JSON.stringify({label:cfForm.label,fieldType:cfForm.fieldType,options:cfForm.options,required:cfForm.required})});
        setCustomFields(prev=>[...prev,created]);
      }
      closeCfModal();
    }catch(e){alert(e.message||"Failed to save field");}
    setCfSaving(false);
  }

  async function deleteCfField(id){
    if(!window.confirm("Delete this custom field? All saved values will be permanently removed."))return;
    await apiFetch(`/custom-fields/${id}`,{method:"DELETE"}).catch(()=>{});
    setCustomFields(prev=>prev.filter(f=>f.id!==id));
  }

  const CF_TYPE_LABELS={text:"Text",number:"Number",date:"Date",dropdown:"Dropdown",checkbox:"Yes/No"};

  function openAddMetric(){
    setEditingMetric(null);
    setImForm({name:"",dollarThreshold:"",outcomeTemplate:""});
    setShowAddMetric(true);
  }

  function openEditMetric(m){
    setEditingMetric(m);
    setImForm({name:m.name,dollarThreshold:String(m.dollar_threshold),outcomeTemplate:m.outcome_template});
    setShowAddMetric(true);
  }

  function closeImModal(){
    setShowAddMetric(false);setEditingMetric(null);
    setImForm({name:"",dollarThreshold:"",outcomeTemplate:""});
  }

  async function saveImMetric(){
    if(!imForm.name.trim()||!imForm.dollarThreshold||!imForm.outcomeTemplate.trim())return;
    setImSaving(true);
    try{
      if(editingMetric){
        const updated=await apiFetch(`/impact-metrics/${editingMetric.id}`,{method:"PUT",body:JSON.stringify({name:imForm.name,dollarThreshold:imForm.dollarThreshold,outcomeTemplate:imForm.outcomeTemplate,active:true})});
        setImpactMetrics(prev=>prev.map(m=>m.id===editingMetric.id?updated:m));
      }else{
        const created=await apiFetch("/impact-metrics",{method:"POST",body:JSON.stringify({name:imForm.name,dollarThreshold:imForm.dollarThreshold,outcomeTemplate:imForm.outcomeTemplate})});
        setImpactMetrics(prev=>[...prev,created]);
      }
      closeImModal();
    }catch(e){alert(e.message||"Failed to save impact metric");}
    setImSaving(false);
  }

  async function deleteImMetric(id){
    if(!window.confirm("Delete this impact metric? Donors won't reference it in future milestone emails."))return;
    await apiFetch(`/impact-metrics/${id}`,{method:"DELETE"}).catch(()=>{});
    setImpactMetrics(prev=>prev.filter(m=>m.id!==id));
  }

  function closeInvite(){
    setShowInvite(false);setInvEmail("");setInvRole("staff");
    setInviting(false);setInviteResult(null);setInvErr("");setCopied(false);
  }

  function copyLink(){
    if(!inviteResult?.link)return;
    navigator.clipboard.writeText(inviteResult.link).then(()=>{setCopied(true);setTimeout(()=>setCopied(false),2000);});
  }

  const SecHead=({label})=>(
    <div style={{display:"flex",alignItems:"center",gap:10,margin:"4px 0 -8px"}}>
      <div style={{fontSize:10,fontWeight:800,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.12em",whiteSpace:"nowrap"}}>{label}</div>
      <div style={{flex:1,height:1,background:T.bg3}}/>
    </div>
  );

  return(
    <div style={{display:"flex",flexDirection:"column",gap:20}}>
      <PageTitle main="Workspace" accent="settings."/>

      {/* ── Organization ──────────────────────────────────────────────────── */}
      <SecHead label="Organization"/>
      <div style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:16,padding:"24px 28px"}}>
        <SectionLabel>Your Account</SectionLabel>
        <div style={{display:"flex",alignItems:"center",gap:16,marginBottom:20}}>
          <div style={{width:52,height:52,borderRadius:"50%",background:T.greenDk+"18",border:"2px solid "+T.greenDk+"40",display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,fontWeight:700,color:T.greenDk,flexShrink:0}}>
            {(userName[0]||"U").toUpperCase()}
          </div>
          <div>
            <div style={{fontSize:18,fontWeight:700,color:T.ink,letterSpacing:"-0.01em"}}>{userName}</div>
            <div style={{fontSize:13,color:T.ink3,marginTop:2}}>{userEmail}</div>
            <div style={{marginTop:6}}><Pill label={userRole} color={userRole==="admin"?T.greenDk:"#6b7280"}/></div>
          </div>
        </div>
        <div style={{background:T.bg,borderRadius:10,padding:"14px 16px"}}>
          <div style={{fontSize:11,fontWeight:700,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:6}}>Organization</div>
          <div style={{fontSize:15,fontWeight:700,color:T.ink}}>{orgName}</div>
          {auth?.org?.mission&&<div style={{fontSize:12,color:T.ink3,marginTop:4,lineHeight:1.5}}>{auth.org.mission}</div>}
        </div>
      </div>

      {/* ── Team ──────────────────────────────────────────────────────────── */}
      <SecHead label="Team"/>
      <div style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:16,padding:"24px 28px"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
          <SectionLabel>Team Members</SectionLabel>
          {isAdmin&&<button onClick={()=>setShowInvite(true)} style={{background:T.green,border:"none",borderRadius:8,padding:"7px 14px",color:"#fff",fontSize:12,fontWeight:700,cursor:"pointer"}}>+ Invite Staff</button>}
        </div>
        {billing&&!billing.isTrial&&billing.limits?.seats!==999999999&&billing.usage?.seats>=billing.limits?.seats&&(
          <div style={{background:"#faf9f6",border:"1px solid #d4cfc6",borderRadius:10,padding:"10px 14px",marginBottom:14,fontSize:12,color:"#4a5e4f",display:"flex",alignItems:"center",justifyContent:"space-between",gap:12}}>
            <span>You're using all {billing.limits.seats} seat{billing.limits.seats!==1?"s":""}.</span>
            <a href="/pricing" style={{color:"#1a6b4a",fontWeight:700,textDecoration:"none",whiteSpace:"nowrap"}}>Upgrade your plan →</a>
          </div>
        )}
        {team.map((m,i)=>(
          <div key={m.id} style={{display:"flex",alignItems:"center",gap:12,padding:"12px 0",borderBottom:i<team.length-1?"1px solid "+T.bg3:"none"}}>
            <div style={{width:36,height:36,borderRadius:"50%",background:T.greenDk+"18",display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,fontWeight:700,color:T.greenDk,flexShrink:0}}>
              {(m.name?.[0]||"U").toUpperCase()}
            </div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:13,fontWeight:600,color:T.ink}}>{m.name}{m.id===auth?.user?.id&&<span style={{fontSize:11,color:T.ink3,marginLeft:6}}>(you)</span>}</div>
              <div style={{fontSize:11,color:T.ink3,marginTop:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{m.email}</div>
            </div>
            <Pill label={m.role} color={m.role==="admin"?T.greenDk:"#6b7280"}/>
          </div>
        ))}
        {team.length===0&&<div style={{fontSize:13,color:T.ink3}}>Loading…</div>}
      </div>

      {/* ── Integrations ──────────────────────────────────────────────────── */}
      <SecHead label="Integrations"/>
      <div style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:16,padding:"24px 28px"}}>
        <SectionLabel>Payments</SectionLabel>
        {stripe?.connected?(
          <div style={{display:"flex",alignItems:"center",gap:14,flexWrap:"wrap"}}>
            <div style={{display:"flex",alignItems:"center",gap:8,background:"#f0fdf4",border:"1px solid #bbf7d0",borderRadius:10,padding:"10px 16px"}}>
              <span style={{fontSize:16}}>💳</span>
              <div>
                <div style={{fontSize:13,fontWeight:700,color:"#166534"}}>Stripe Connected</div>
                <div style={{fontSize:11,color:"#15803d",marginTop:1}}>Account: {stripe.accountId}</div>
              </div>
            </div>
            <div style={{fontSize:12,color:T.ink3}}>Connected {stripe.connectedAt?new Date(stripe.connectedAt).toLocaleDateString():""}</div>
          </div>
        ):(
          <div style={{display:"flex",alignItems:"center",gap:16,flexWrap:"wrap"}}>
            <div style={{flex:1,minWidth:200}}>
              <div style={{fontSize:13,color:T.ink2,marginBottom:4}}>Set up Stripe to accept online donations directly from your donors. Steward creates a Stripe Express account linked to your organization — you'll be guided through a short onboarding on Stripe's site.</div>
              <div style={{fontSize:11,color:T.ink3,marginTop:4}}>Steward never touches your money — donors pay directly to your Stripe account.</div>
            </div>
            {isAdmin&&<button onClick={connectStripe} disabled={stripeLoading}
              style={{background:T.green,border:"none",borderRadius:10,padding:"10px 20px",color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer",opacity:stripeLoading?0.7:1,flexShrink:0}}>
              {stripeLoading?"Setting up…":"Set up Stripe →"}
            </button>}
          </div>
        )}
      </div>

      {orgSlug&&<div style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:16,padding:"24px 28px"}}>
        <SectionLabel>Donation QR Code</SectionLabel>
        <div style={{fontSize:13,color:T.ink3,marginBottom:14,lineHeight:1.6}}>
          Print this QR code and put it in your bulletin, on a sign, or anywhere donors can scan it to give.
        </div>
        <div style={{background:T.bg,borderRadius:10,padding:"10px 14px",fontFamily:"monospace",fontSize:12,color:T.ink2,wordBreak:"break-all",marginBottom:14,border:"1px solid "+T.bg3}}>
          {donationUrl}
        </div>
        <QrCodeBlock url={donationUrl} filenameBase={orgName.toLowerCase().replace(/[^a-z0-9]+/g,"-")}/>
      </div>}

      {orgSlug&&<div style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:16,padding:"24px 28px"}}>
        <SectionLabel>Embed Donation Form</SectionLabel>
        <div style={{fontSize:13,color:T.ink3,marginBottom:14,lineHeight:1.6}}>
          Paste this anywhere on your website to let donors give without leaving your site.
        </div>
        <div style={{marginBottom:10}}>
          <EmbedCodeBlock url={donationUrl}/>
        </div>
        <div style={{fontSize:11,color:T.ink3,marginBottom:16}}>Width and height are customizable. Use <code style={{background:T.bg3,padding:"1px 5px",borderRadius:4}}>height="700"</code> for the full form without scrolling.</div>
        <div style={{fontSize:11,fontWeight:700,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:8}}>Live Preview</div>
        <div style={{border:"1px solid "+T.bg3,borderRadius:10,overflow:"hidden",background:T.bg}}>
          <iframe
            src={donationUrl}
            width="100%"
            height="560"
            frameBorder="0"
            title="Donation form preview"
            style={{display:"block"}}
          />
        </div>
      </div>}

      {/* ── Giving Pages ──────────────────────────────────────────────────── */}
      <SecHead label="Giving Pages"/>
      <GivingPagesManager orgSlug={orgSlug} isAdmin={isAdmin} isReadOnly={isReadOnly}/>


      <div style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:16,padding:"24px 28px"}}>
        <SectionLabel>Gmail</SectionLabel>
        <div style={{fontSize:13,color:T.ink3,marginBottom:16,lineHeight:1.5}}>Sync donor emails automatically to your interaction timeline.</div>
        <div style={{display:"flex",alignItems:"center",gap:16,padding:"16px",background:T.bg,borderRadius:12,border:"1px solid "+T.bg3,flexWrap:"wrap"}}>
          <div style={{width:40,height:40,borderRadius:10,background:"#fff",border:"1px solid "+T.bg3,display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,flexShrink:0}}>
            📧
          </div>
          <div style={{flex:1,minWidth:180}}>
            <div style={{fontSize:14,fontWeight:700,color:T.ink,marginBottom:2}}>Gmail</div>
            <div style={{fontSize:12,color:T.ink3,lineHeight:1.5}}>
              {gmailStatus?.disconnected
                ? "Connection lost — please reconnect."
                : gmailStatus?.connected
                  ? `Connected as ${gmailStatus.email}`
                  : "Sync donor emails automatically to your timeline."}
            </div>
            {gmailStatus?.connected&&(
              <div style={{fontSize:11,color:T.ink3,marginTop:3}}>Synced {fmtSynced(gmailStatus.lastSyncedAt)}</div>
            )}
          </div>
          <div style={{display:"flex",gap:8,alignItems:"center",flexShrink:0,flexWrap:"wrap"}}>
            {gmailStatus?.connected ? (
              <>
                <div style={{display:"flex",alignItems:"center",gap:5,background:"#f0fdf4",border:"1px solid #bbf7d0",borderRadius:8,padding:"5px 10px"}}>
                  <div style={{width:7,height:7,borderRadius:"50%",background:"#16a34a"}}/>
                  <span style={{fontSize:12,fontWeight:600,color:"#166534"}}>Connected</span>
                </div>
                <button onClick={syncGmailNow} disabled={gmailSyncing}
                  style={{background:T.green,border:"none",borderRadius:8,padding:"7px 14px",color:"#fff",fontSize:12,fontWeight:700,cursor:gmailSyncing?"not-allowed":"pointer",opacity:gmailSyncing?0.7:1}}>
                  {gmailSyncing?"Syncing…":"Sync now"}
                </button>
                <button onClick={disconnectGmail}
                  style={{background:"transparent",border:"none",fontSize:12,color:"#dc2626",cursor:"pointer",fontWeight:500,padding:"7px 4px"}}>
                  Disconnect
                </button>
              </>
            ) : gmailStatus?.disconnected ? (
              <button onClick={connectGmail}
                style={{background:T.green,border:"none",borderRadius:8,padding:"8px 16px",color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer"}}>
                Reconnect Gmail →
              </button>
            ) : (
              <button onClick={connectGmail}
                style={{background:"transparent",border:"1px solid "+T.greenDk,borderRadius:8,padding:"8px 16px",color:T.greenDk,fontSize:13,fontWeight:700,cursor:"pointer"}}>
                Connect Gmail →
              </button>
            )}
          </div>
        </div>
        {gmailToast&&(
          <div style={{marginTop:12,background:"#f0fdf4",border:"1px solid #bbf7d0",borderRadius:8,padding:"10px 14px",fontSize:13,color:"#166534",fontWeight:600}}>
            ✓ {gmailToast}
          </div>
        )}
      </div>

      {/* ── Customization ─────────────────────────────────────────────────── */}
      <SecHead label="Customization"/>
      <div style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:16,padding:"24px 28px"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
          <SectionLabel>Custom Fields</SectionLabel>
          {isAdmin&&<button onClick={openAddField} disabled={isReadOnly} title={isReadOnly?"Reactivate your subscription to make changes.":undefined} style={{background:T.green,border:"none",borderRadius:8,padding:"7px 14px",color:"#fff",fontSize:12,fontWeight:700,cursor:isReadOnly?"not-allowed":"pointer",opacity:isReadOnly?0.45:1}}>+ Add Field</button>}
        </div>
        <div style={{fontSize:13,color:T.ink3,marginBottom:customFields.length?14:0,lineHeight:1.6}}>
          {customFields.length===0?"No custom fields yet. Add fields to capture extra donor data specific to your organization.":""}
        </div>
        {customFields.map((f,i)=>(
          <div key={f.id}
            style={{display:"flex",alignItems:"center",gap:12,padding:"11px 0 11px 10px",borderBottom:i<customFields.length-1?"1px solid "+T.bg3:"none",borderLeft:"3px solid "+T.bg3,transition:"border-color 0.15s",marginLeft:-10}}
            onMouseEnter={e=>e.currentTarget.style.borderLeftColor=T.greenDk}
            onMouseLeave={e=>e.currentTarget.style.borderLeftColor=T.bg3}>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:13,fontWeight:600,color:T.ink}}>{f.label}{f.required&&<span style={{marginLeft:5,fontSize:10,color:T.ink3,fontWeight:400}}>required</span>}</div>
              <div style={{fontSize:11,color:T.ink3,marginTop:2}}>{CF_TYPE_LABELS[f.field_type]||f.field_type}{f.field_type==="dropdown"&&f.options?.length?` — ${f.options.join(", ")}`:""}
              </div>
            </div>
            {isAdmin&&<div style={{display:"flex",gap:6,flexShrink:0}}>
              <button onClick={()=>openEditField(f)} style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:6,padding:"5px 10px",fontSize:11,fontWeight:600,color:T.ink2,cursor:"pointer"}}>Edit</button>
              <button onClick={()=>deleteCfField(f.id)} style={{background:"#fef2f2",border:"1px solid #fecaca",borderRadius:6,padding:"5px 10px",fontSize:11,fontWeight:600,color:"#dc2626",cursor:"pointer"}}>Delete</button>
            </div>}
          </div>
        ))}
      </div>

      {/* ── Impact Metrics ────────────────────────────────────────────────── */}
      <div style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:16,padding:"24px 28px"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
          <SectionLabel>Impact Metrics</SectionLabel>
          {isAdmin&&<button onClick={openAddMetric} disabled={isReadOnly} title={isReadOnly?"Reactivate your subscription to make changes.":undefined} style={{background:T.green,border:"none",borderRadius:8,padding:"7px 14px",color:"#fff",fontSize:12,fontWeight:700,cursor:isReadOnly?"not-allowed":"pointer",opacity:isReadOnly?0.45:1}}>+ Add Metric</button>}
        </div>
        <div style={{fontSize:13,color:T.ink3,marginBottom:impactMetrics.length?14:0,lineHeight:1.6}}>
          {impactMetrics.length===0?"No impact metrics yet. Add giving thresholds that translate a donor's cumulative gifts into concrete outcomes for milestone emails.":"Cumulative giving thresholds used to translate a donor's total giving into concrete outcomes in milestone emails."}
        </div>
        {impactMetrics.map((m,i)=>(
          <div key={m.id}
            style={{display:"flex",alignItems:"center",gap:12,padding:"11px 0 11px 10px",borderBottom:i<impactMetrics.length-1?"1px solid "+T.bg3:"none",borderLeft:"3px solid "+T.bg3,transition:"border-color 0.15s",marginLeft:-10}}
            onMouseEnter={e=>e.currentTarget.style.borderLeftColor=T.greenDk}
            onMouseLeave={e=>e.currentTarget.style.borderLeftColor=T.bg3}>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:13,fontWeight:600,color:T.ink}}>{m.name}{m.active===false&&<span style={{marginLeft:5,fontSize:10,color:T.ink3,fontWeight:400}}>inactive</span>}</div>
              <div style={{fontSize:11,color:T.ink3,marginTop:2}}>${Number(m.dollar_threshold).toLocaleString()} — {m.outcome_template}</div>
            </div>
            {isAdmin&&<div style={{display:"flex",gap:6,flexShrink:0}}>
              <button onClick={()=>openEditMetric(m)} style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:6,padding:"5px 10px",fontSize:11,fontWeight:600,color:T.ink2,cursor:"pointer"}}>Edit</button>
              <button onClick={()=>deleteImMetric(m.id)} style={{background:"#fef2f2",border:"1px solid #fecaca",borderRadius:6,padding:"5px 10px",fontSize:11,fontWeight:600,color:"#dc2626",cursor:"pointer"}}>Delete</button>
            </div>}
          </div>
        ))}
      </div>

      {/* ── Your Data ─────────────────────────────────────────────────────── */}
      <SecHead label="Your Data"/>
      <div style={{background:T.white,border:"1px solid "+T.bg3,borderLeft:"3px solid #c9a84c",borderRadius:16,padding:"24px 28px"}}>
        <SectionLabel>Export your data</SectionLabel>
        <div style={{fontSize:15,fontWeight:700,color:T.ink,marginBottom:6}}>Your data belongs to you.</div>
        <div style={{fontSize:13,color:T.ink3,marginBottom:6,lineHeight:1.6,maxWidth:520}}>
          Download everything in Steward — donors, gifts, grants, finances, and more — as a structured JSON file.
        </div>
        <div style={{fontSize:12,color:T.ink3,marginBottom:18}}>Exports all your data as a structured file you can open, import, or archive.</div>
        <button onClick={exportData} disabled={exporting}
          style={{background:"#c9a84c",color:"#fff",border:"none",borderRadius:8,padding:"10px 22px",fontSize:13,fontWeight:700,cursor:exporting?"not-allowed":"pointer",opacity:exporting?0.7:1}}>
          {exporting?"Building export…":"Export all data"}
        </button>
      </div>

      {sampleStatus&&(
        <div style={{background:T.white,border:"1px solid "+T.bg3,borderLeft:"3px solid #c9a84c",borderRadius:16,padding:"20px 24px"}}>
          <SectionLabel>Demo Data</SectionLabel>
          <div style={{fontSize:13,color:T.ink3,marginBottom:14,lineHeight:1.6}}>
            Instantly populate this workspace with a realistic sample dataset — 25 donors across every stage, gifts, grants, events, campaigns, and tasks — so you can explore every feature without entering real data first.
          </div>
          {sampleStatus.hasSampleData?(
            <div style={{display:"flex",alignItems:"center",gap:14,flexWrap:"wrap"}}>
              <span style={{fontSize:13,color:T.ink3,background:T.bg,borderRadius:8,padding:"6px 12px"}}>{sampleStatus.sampleDonorCount} sample donors loaded</span>
              <button onClick={clearSampleData} disabled={sampleClearing}
                style={{background:"#fee2e2",color:"#dc2626",border:"1px solid #fca5a5",borderRadius:8,padding:"8px 16px",fontSize:13,fontWeight:600,cursor:sampleClearing?"not-allowed":"pointer",opacity:sampleClearing?0.7:1}}>
                {sampleClearing?"Clearing…":"Clear sample data"}
              </button>
            </div>
          ):(
            <button onClick={loadSampleData} disabled={sampleLoading}
              style={{background:"#c9a84c",color:"#fff",border:"none",borderRadius:8,padding:"10px 20px",fontSize:13,fontWeight:700,cursor:sampleLoading?"not-allowed":"pointer",opacity:sampleLoading?0.7:1}}>
              {sampleLoading?"Loading sample data…":"Load sample data"}
            </button>
          )}
        </div>
      )}

      {/* ── Account ───────────────────────────────────────────────────────── */}
      <SecHead label="Account"/>
      <div style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:16,padding:"24px 28px"}}>
        <SectionLabel>Billing</SectionLabel>
        {billing ? (
          <div style={{display:"flex",flexDirection:"column",gap:16}}>
            <div style={{display:"flex",gap:24,flexWrap:"wrap"}}>
              <div>
                <div style={{fontSize:11,fontWeight:700,letterSpacing:"0.07em",textTransform:"uppercase",color:T.ink3,marginBottom:4}}>Current Plan</div>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <span style={{fontSize:15,fontWeight:700,color:T.ink,textTransform:"capitalize"}}>{billing.plan||"Trial"}</span>
                  {(()=>{const m=BILLING_STATUS_META[billing.subscriptionStatus]||BILLING_STATUS_META.trialing; return (
                  <span style={{fontSize:11,fontWeight:700,padding:"2px 8px",borderRadius:99,background:m.bg,color:m.color,border:"1px solid "+m.border}}>
                    {m.label}
                  </span>
                  );})()}
                </div>
              </div>
              {billing.subscriptionStatus==="trialing"&&billing.trialEndsAt&&(
                <div>
                  <div style={{fontSize:11,fontWeight:700,letterSpacing:"0.07em",textTransform:"uppercase",color:T.ink3,marginBottom:4}}>Trial Ends</div>
                  <div style={{fontSize:14,fontWeight:600,color:billing.trialDaysLeft<=7?"#ef4444":T.ink}}>
                    {new Date(billing.trialEndsAt).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})}
                    {billing.trialDaysLeft!=null&&<span style={{fontSize:12,color:T.ink3,fontWeight:400,marginLeft:6}}>({billing.trialDaysLeft} days left)</span>}
                  </div>
                </div>
              )}
            </div>
            <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
              <button onClick={openBillingPortal} disabled={portalLoading} style={{background:"#0f1a12",border:"none",borderRadius:8,padding:"9px 18px",color:"#f0ede6",fontSize:13,fontWeight:600,cursor:portalLoading?"not-allowed":"pointer",opacity:portalLoading?0.7:1}}>
                {portalLoading?"Opening…":"Manage billing →"}
              </button>
              {(billing.plan==="trial"||billing.plan==="seed")&&(
                <a href="/pricing" style={{display:"inline-block",background:"#1a6b4a",border:"none",borderRadius:8,padding:"9px 18px",color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer",textDecoration:"none"}}>
                  Upgrade plan →
                </a>
              )}
            </div>
          </div>
        ) : (
          <div style={{fontSize:13,color:T.ink3}}>Loading billing information…</div>
        )}
      </div>

      <div style={{background:"#1a0a0a",border:"1px solid #3d1515",borderRadius:16,padding:"24px 28px"}}>
        <SectionLabel>Account Actions</SectionLabel>
        <button onClick={logout} style={{background:"#2d0a0a",border:"1px solid #3d1515",borderRadius:8,padding:"9px 18px",color:"#f87171",fontSize:13,fontWeight:600,cursor:"pointer"}}>
          Sign out of Steward
        </button>
        <div style={{marginTop:20,display:"flex",gap:20}}>
          <a href="/terms" target="_blank" rel="noopener noreferrer" style={{fontSize:12,color:T.ink3,textDecoration:"none",borderBottom:"1px solid "+T.bg3}}>Terms of Service</a>
          <a href="/privacy" target="_blank" rel="noopener noreferrer" style={{fontSize:12,color:T.ink3,textDecoration:"none",borderBottom:"1px solid "+T.bg3}}>Privacy Policy</a>
        </div>
      </div>

      {showAddField&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.45)",zIndex:500,display:"flex",alignItems:"center",justifyContent:"center"}} onClick={e=>{if(e.target===e.currentTarget)closeCfModal();}}>
          <div style={{background:T.white,borderRadius:20,padding:"32px 28px",width:440,maxWidth:"calc(100vw - 32px)",boxShadow:"0 8px 40px rgba(0,0,0,0.16)"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
              <div style={{fontSize:17,fontWeight:700,color:T.ink}}>{editingField?"Edit field":"Add custom field"}</div>
              <button onClick={closeCfModal} style={{background:"none",border:"none",fontSize:20,cursor:"pointer",color:T.ink3,lineHeight:1}}>×</button>
            </div>
            <div style={{fontSize:12,fontWeight:600,color:T.ink3,marginBottom:4}}>Field label</div>
            <input value={cfForm.label} onChange={e=>setCfForm(f=>({...f,label:e.target.value}))}
              placeholder="e.g. Board Connection, Peer-to-Peer Interest"
              style={{width:"100%",boxSizing:"border-box",border:"1px solid "+T.bg3,borderRadius:10,padding:"10px 12px",fontSize:14,color:T.ink,background:T.bg,outline:"none",marginBottom:14}}
            />
            <div style={{fontSize:12,fontWeight:600,color:T.ink3,marginBottom:4}}>Field type</div>
            <select value={cfForm.fieldType} onChange={e=>setCfForm(f=>({...f,fieldType:e.target.value}))}
              style={{width:"100%",boxSizing:"border-box",border:"1px solid "+T.bg3,borderRadius:10,padding:"10px 12px",fontSize:14,color:T.ink,background:T.bg,outline:"none",marginBottom:14}}>
              <option value="text">Text</option>
              <option value="number">Number</option>
              <option value="date">Date</option>
              <option value="dropdown">Dropdown</option>
              <option value="checkbox">Yes/No (Checkbox)</option>
            </select>
            {cfForm.fieldType==="dropdown"&&(
              <div style={{marginBottom:14}}>
                <div style={{fontSize:12,fontWeight:600,color:T.ink3,marginBottom:6}}>Options</div>
                <div style={{display:"flex",gap:8,marginBottom:8}}>
                  <input value={cfOptInput} onChange={e=>setCfOptInput(e.target.value)}
                    placeholder="Add option…"
                    onKeyDown={e=>e.key==="Enter"&&(e.preventDefault(),addCfOption())}
                    style={{flex:1,border:"1px solid "+T.bg3,borderRadius:8,padding:"8px 12px",fontSize:13,color:T.ink,background:T.bg,outline:"none"}}
                  />
                  <button onClick={addCfOption} style={{background:T.green,border:"none",borderRadius:8,padding:"8px 14px",color:"#fff",fontSize:12,fontWeight:700,cursor:"pointer"}}>Add</button>
                </div>
                <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                  {cfForm.options.map((o,i)=>(
                    <div key={i} style={{display:"flex",alignItems:"center",gap:4,background:T.bg2,border:"1px solid "+T.bg3,borderRadius:20,padding:"3px 10px 3px 10px",fontSize:12,color:T.ink}}>
                      {o}
                      <span onClick={()=>removeCfOption(i)} style={{cursor:"pointer",marginLeft:4,color:T.ink3,fontSize:14,lineHeight:1}}>×</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <label style={{display:"flex",alignItems:"center",gap:8,fontSize:13,color:T.ink,cursor:"pointer",marginBottom:20}}>
              <input type="checkbox" checked={!!cfForm.required} onChange={e=>setCfForm(f=>({...f,required:e.target.checked}))} style={{width:16,height:16,cursor:"pointer"}}/>
              Required field
            </label>
            <div style={{display:"flex",gap:10}}>
              <button onClick={closeCfModal} style={{flex:1,background:T.bg,border:"1px solid "+T.bg3,borderRadius:10,padding:"10px",color:T.ink2,fontSize:13,fontWeight:600,cursor:"pointer"}}>Cancel</button>
              <button onClick={saveCfField} disabled={cfSaving||!cfForm.label.trim()} style={{flex:2,background:T.green,border:"none",borderRadius:10,padding:"10px",color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer",opacity:(cfSaving||!cfForm.label.trim())?0.7:1}}>
                {cfSaving?"Saving…":editingField?"Save changes":"Add field"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showAddMetric&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.45)",zIndex:500,display:"flex",alignItems:"center",justifyContent:"center"}} onClick={e=>{if(e.target===e.currentTarget)closeImModal();}}>
          <div style={{background:T.white,borderRadius:20,padding:"32px 28px",width:440,maxWidth:"calc(100vw - 32px)",boxShadow:"0 8px 40px rgba(0,0,0,0.16)"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
              <div style={{fontSize:17,fontWeight:700,color:T.ink}}>{editingMetric?"Edit impact metric":"Add impact metric"}</div>
              <button onClick={closeImModal} style={{background:"none",border:"none",fontSize:20,cursor:"pointer",color:T.ink3,lineHeight:1}}>×</button>
            </div>
            <div style={{fontSize:12,fontWeight:600,color:T.ink3,marginBottom:4}}>Metric name</div>
            <input value={imForm.name} onChange={e=>setImForm(f=>({...f,name:e.target.value}))}
              placeholder="e.g. Full-Year Scholarship"
              style={{width:"100%",boxSizing:"border-box",border:"1px solid "+T.bg3,borderRadius:10,padding:"10px 12px",fontSize:14,color:T.ink,background:T.bg,outline:"none",marginBottom:14}}
            />
            <div style={{fontSize:12,fontWeight:600,color:T.ink3,marginBottom:4}}>Cumulative giving threshold ($)</div>
            <input type="number" value={imForm.dollarThreshold} onChange={e=>setImForm(f=>({...f,dollarThreshold:e.target.value}))}
              placeholder="e.g. 2500"
              style={{width:"100%",boxSizing:"border-box",border:"1px solid "+T.bg3,borderRadius:10,padding:"10px 12px",fontSize:14,color:T.ink,background:T.bg,outline:"none",marginBottom:14}}
            />
            <div style={{fontSize:12,fontWeight:600,color:T.ink3,marginBottom:4}}>Outcome template</div>
            <textarea value={imForm.outcomeTemplate} onChange={e=>setImForm(f=>({...f,outcomeTemplate:e.target.value}))}
              placeholder="e.g. Your ${amount} has covered {n} full-year arts program scholarships"
              rows={3}
              style={{width:"100%",boxSizing:"border-box",border:"1px solid "+T.bg3,borderRadius:10,padding:"10px 12px",fontSize:14,color:T.ink,background:T.bg,outline:"none",marginBottom:6,fontFamily:"inherit",resize:"vertical"}}
            />
            <div style={{fontSize:11,color:T.ink3,marginBottom:20,lineHeight:1.5}}>
              Use <code>{"{amount}"}</code> for the donor's cumulative giving and <code>{"{n}"}</code> for how many times this threshold has been covered. Used to draft warm, specific milestone emails — not shown to donors verbatim.
            </div>
            <div style={{display:"flex",gap:10}}>
              <button onClick={closeImModal} style={{flex:1,background:T.bg,border:"1px solid "+T.bg3,borderRadius:10,padding:"10px",color:T.ink2,fontSize:13,fontWeight:600,cursor:"pointer"}}>Cancel</button>
              <button onClick={saveImMetric} disabled={imSaving||!imForm.name.trim()||!imForm.dollarThreshold||!imForm.outcomeTemplate.trim()} style={{flex:2,background:T.green,border:"none",borderRadius:10,padding:"10px",color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer",opacity:(imSaving||!imForm.name.trim()||!imForm.dollarThreshold||!imForm.outcomeTemplate.trim())?0.7:1}}>
                {imSaving?"Saving…":editingMetric?"Save changes":"Add metric"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showInvite&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.45)",zIndex:500,display:"flex",alignItems:"center",justifyContent:"center"}} onClick={e=>{if(e.target===e.currentTarget)closeInvite();}}>
          <div style={{background:T.white,borderRadius:20,padding:"32px 28px",width:420,maxWidth:"calc(100vw - 32px)",boxShadow:"0 8px 40px rgba(0,0,0,0.16)"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
              <div style={{fontSize:17,fontWeight:700,color:T.ink}}>Invite a team member</div>
              <button onClick={closeInvite} style={{background:"none",border:"none",fontSize:20,cursor:"pointer",color:T.ink3,lineHeight:1}}>×</button>
            </div>

            {!inviteResult?(
              <>
                <div style={{fontSize:12,fontWeight:600,color:T.ink3,marginBottom:4}}>Email address</div>
                <input value={invEmail} onChange={e=>setInvEmail(e.target.value)}
                  placeholder="staff@yourorg.org"
                  style={{width:"100%",boxSizing:"border-box",border:"1px solid "+T.bg3,borderRadius:10,padding:"10px 12px",fontSize:14,color:T.ink,background:T.bg,outline:"none",marginBottom:12}}
                  onKeyDown={e=>e.key==="Enter"&&sendInvite()}
                />
                <div style={{fontSize:12,fontWeight:600,color:T.ink3,marginBottom:4}}>Role</div>
                <select value={invRole} onChange={e=>setInvRole(e.target.value)}
                  style={{width:"100%",boxSizing:"border-box",border:"1px solid "+T.bg3,borderRadius:10,padding:"10px 12px",fontSize:14,color:T.ink,background:T.bg,outline:"none",marginBottom:16}}>
                  <option value="staff">Staff — can view and edit data</option>
                  <option value="admin">Admin — full access including settings</option>
                </select>
                {invErr&&<div style={{marginBottom:12,fontSize:13,color:"#dc2626",background:"#fef2f2",border:"1px solid #fecaca",borderRadius:8,padding:"8px 12px"}}>{invErr}</div>}
                <div style={{display:"flex",gap:10}}>
                  <button onClick={closeInvite} style={{flex:1,background:T.bg,border:"1px solid "+T.bg3,borderRadius:10,padding:"10px",color:T.ink2,fontSize:13,fontWeight:600,cursor:"pointer"}}>Cancel</button>
                  <button onClick={sendInvite} disabled={inviting} style={{flex:2,background:T.green,border:"none",borderRadius:10,padding:"10px",color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer",opacity:inviting?0.7:1}}>
                    {inviting?"Generating invite…":"Generate invite link"}
                  </button>
                </div>
              </>
            ):(
              <>
                <div style={{background:"#f0fdf4",border:"1px solid #bbf7d0",borderRadius:12,padding:"14px 16px",marginBottom:16}}>
                  <div style={{fontSize:13,fontWeight:700,color:"#166534",marginBottom:4}}>
                    {inviteResult.emailSent?"Invite sent! You can also share the link below:":"Share this invite link:"}
                  </div>
                  <div style={{fontSize:12,color:"#15803d",wordBreak:"break-all",lineHeight:1.5}}>{inviteResult.link}</div>
                </div>
                {!inviteResult.emailSent&&<div style={{fontSize:12,color:T.ink3,marginBottom:14,lineHeight:1.5}}>
                  SMTP not configured — copy and share this link directly. It expires in 7 days.
                </div>}
                <div style={{display:"flex",gap:10}}>
                  <button onClick={copyLink} style={{flex:1,background:copied?T.green:T.bg,border:"1px solid "+(copied?T.green:T.bg3),borderRadius:10,padding:"10px",color:copied?"#fff":T.ink2,fontSize:13,fontWeight:600,cursor:"pointer",transition:"all 0.15s"}}>
                    {copied?"Copied!":"Copy link"}
                  </button>
                  <button onClick={closeInvite} style={{flex:1,background:T.green,border:"none",borderRadius:10,padding:"10px",color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer"}}>Done</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
      {upgradeModal&&<UpgradeModal open={true} onClose={()=>setUpgradeModal(null)} reason={upgradeModal.reason} current={upgradeModal.current} limit={upgradeModal.limit} plan={upgradeModal.plan}/>}
    </div>
  );
}
