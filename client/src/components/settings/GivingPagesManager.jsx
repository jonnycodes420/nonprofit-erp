import { T, SectionLabel, activeMark, Modal } from "../shared";
import { useState, useEffect } from "react";
import { apiFetch } from "../../api";
import { errorMessage } from "../../lib/domainError";
import { offerUndo } from "../EditHistory";
import { removeOne } from "../RemoveMenu";
import { MailTypeSwitches } from "../MailTypes";
import { editPageHref } from "../../lib/appUrls";
import { QrCodeBlock, EmbedCodeBlock } from "../ShareBlocks";
import { fmtDollars } from "./TaxReceiptsManager";

// QrCodeBlock/EmbedCodeBlock now live in ./ShareBlocks (factored out so
// non-Settings pages, e.g. the public peer-fundraiser manage page, can
// reuse them without importing this whole admin component tree).

export function slugifyPreview(s){
  return (s||"").toLowerCase().trim().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,60);
}

// VOL-PAGE-1 — the three volunteer page templates (keys match the server's starters).
export const VOL_TEMPLATES=[
  ["one_day","A one-day event","a single day with shifts and a sign-up"],
  ["ongoing","Ongoing roles","your regular roles, each with its shifts"],
  ["group_day","A group service day","churches, schools and companies bring a team"],
];
export const GP_STATUS_META={
  active:   {label:"Active",   bg:T.green100, color:T.greenDk, border:T.greenDk},
  archived: {label:"Archived", bg:T.bg2, color:T.ink3, border:T.bg3},
};

// A shareable URL renders as labeled actions — open + copy — never bare
// monospace text (the URL travels via the clipboard). One implementation for
// every share surface in Settings (giving-page share panel, donation QR card).
export function UrlLinkButtons({url,openLabel="Open page ↗"}){
  const [copied,setCopied]=useState(false);
  const copy=async()=>{
    try{await navigator.clipboard.writeText(url);setCopied(true);setTimeout(()=>setCopied(false),2000);}
    catch{/* clipboard blocked — the Open link still carries the URL */}
  };
  const base={borderRadius:8,padding:"7px 14px",fontSize:12,fontWeight:700,cursor:"pointer"};
  return(
    <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
      <a href={url} target="_blank" rel="noreferrer" style={{...base,display:"inline-block",background:T.gold500,border:"none",color:T.ink,textDecoration:"none"}}>{openLabel}</a>
      <button onClick={copy} style={{...base,background:T.bg2,border:"1px solid "+T.bg3,color:T.ink}}>{copied?"Copied ✓":"Copy link"}</button>
    </div>
  );
}

// Own top-level manager component (module scope, like QrCodeBlock/
// EmbedCodeBlock above) — a titled, storied, goal-tracked donation page
// distinct from the org-wide /give/:orgSlug page, sharing that same QR/embed
// mechanism per-page rather than a second system. See CLAUDE.md "Giving
// Pages" — NOT the `campaigns` (email campaign) table/concept.
// ── BUILD-102 (Steward Give) Part 6 — THE FUNNEL ───────────────────────────
// Five figures, each with its definition on a hover, from the server's own
// registry rather than a copy (the BUILD-86 C.3 rule). And the honest line
// underneath: Steward counts how many times the form was opened and finished, and
// records nothing about who.
export function FormFunnelBlock({pageId}){
  const [d,setD]=useState(null);
  const [days,setDays]=useState(90);
  useEffect(()=>{
    let alive=true;
    apiFetch(`/giving-pages/${pageId}/funnel?days=${days}`).then(r=>{if(alive)setD(r);}).catch(()=>{});
    return()=>{alive=false;};
  },[pageId,days]);
  if(!d) return null;
  const f=d.funnel||{};
  const fig=[
    ["views",f.views],
    ["starts",f.starts],
    ["completions",f.completions],
    ["completionRate",f.completionRate==null?"Not set":f.completionRate+"%"],
    ["averageGift",f.averageGiftCents==null?"Not set":"$"+Math.round(f.averageGiftCents/100).toLocaleString()],
  ];
  const label=k=>((d.metrics||[]).find(m=>m.key===k)||{}).label||k;
  return(
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:8}}>
        <div style={{fontSize:11,fontWeight:700,color:T.ink3}}>
          How this form is doing
        </div>
        <select value={days} onChange={e=>setDays(Number(e.target.value))}
          style={{fontSize:11,border:"1px solid "+T.bg3,borderRadius:6,padding:"3px 6px",background:T.white,color:T.ink2}}>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
          <option value={365}>Last year</option>
        </select>
      </div>
      <div className="funnel-figures" style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(104px,1fr))",gap:10}}>
        {fig.map(([k,v])=>(
          <div key={k} title={(d.definitions||{})[k]||""}
            style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:8,padding:"10px 12px"}}>
            <div style={{fontSize:20,fontWeight:700,color:T.ink}}>{v==null?"Not set":v}</div>
            <div style={{fontSize:11,color:T.ink3,marginTop:2}}>{label(k)}</div>
          </div>
        ))}
      </div>
      {d.note?<div style={{fontSize:12,color:T.ink3,marginTop:8,lineHeight:1.6}}>{d.note}</div>:null}
      {d.abTest?(
        <div className="funnel-ab" style={{marginTop:12,background:T.white,border:"1px solid "+T.bg3,borderRadius:8,padding:"12px 14px"}}>
          <div style={{fontSize:12,fontWeight:700,marginBottom:6}}>A test is running on this form</div>
          <div style={{fontSize:13,color:T.ink2,lineHeight:1.6}}>{d.abTest.verdict.sentence}</div>
          <div style={{fontSize:12,color:T.ink3,marginTop:6}}>
            A: {d.abTest.a.views} views, {d.abTest.a.completions} gifts ·
            {" "}B: {d.abTest.bFunnel.views} views, {d.abTest.bFunnel.completions} gifts
          </div>
        </div>
      ):null}
      <div style={{fontSize:12,color:T.ink3,marginTop:10,lineHeight:1.6}}>{d.privacyNote}</div>
    </div>
  );
}

// ── BUILD-102 (Steward Give) Part 4 — THE FORM ON HER OWN WEBSITE ──────────
// Two snippets and a live preview. Both snippets come from the SERVER
// (`GET /giving-pages/:id/embed`) rather than being assembled here: the script
// URL, the form id and the iframe fallback would otherwise be three pieces of
// copy in two files, and the BUILD-95 registry lesson is that nothing keeps
// three copies in step.
//
// The PREVIEW is the real embedded page in a real iframe, because "it renders on
// my site" is the only question this screen exists to answer.
export function FormEmbedBlock({pageId,status}){
  const [snip,setSnip]=useState(null);
  const [copied,setCopied]=useState("");
  useEffect(()=>{
    let alive=true;
    apiFetch(`/giving-pages/${pageId}/embed`).then(r=>{if(alive)setSnip(r);}).catch(()=>{});
    return()=>{alive=false;};
  },[pageId]);
  const copy=(text,which)=>{
    navigator.clipboard?.writeText(text).then(()=>{setCopied(which);setTimeout(()=>setCopied(""),1600);}).catch(()=>{});
  };
  if(!snip) return null;
  const box={width:"100%",fontFamily:"ui-monospace,SFMono-Regular,Menlo,monospace",fontSize:11,
    background:T.white,border:"1px solid "+T.bg3,borderRadius:8,padding:"10px 12px",resize:"vertical",color:T.ink2};
  const btn={background:T.bg,border:"1px solid "+T.bg3,borderRadius:6,padding:"5px 10px",
    fontSize:11,fontWeight:600,color:T.ink2,cursor:"pointer"};
  return(
    <div>
      <div style={{fontSize:11,fontWeight:700,color:T.ink3,marginBottom:8}}>
        Put the donation form on your own website
      </div>
      <div style={{fontSize:12,color:T.ink3,lineHeight:1.6,marginBottom:10}}>{snip.note}</div>
      <div style={{marginBottom:10}}>
        <div style={{fontSize:12,fontWeight:600,marginBottom:4}}>One line, anywhere on your page</div>
        <textarea className="embed-script-snippet" readOnly rows={2} value={snip.script} style={box}
          onClick={e=>e.target.select()}/>
        <button style={{...btn,marginTop:6}} onClick={()=>copy(snip.script,"script")}>
          {copied==="script"?"Copied":"Copy"}
        </button>
      </div>
      <details style={{marginBottom:10}}>
        <summary style={{fontSize:12,fontWeight:600,cursor:"pointer"}}>
          If your site will not allow a script tag
        </summary>
        <div style={{fontSize:12,color:T.ink3,lineHeight:1.6,margin:"6px 0 6px"}}>
          This works everywhere, but it cannot resize itself, change the height if the
          form is cut off or floating in space.
        </div>
        <textarea className="embed-iframe-snippet" readOnly rows={2} value={snip.iframe} style={box}
          onClick={e=>e.target.select()}/>
        <button style={{...btn,marginTop:6}} onClick={()=>copy(snip.iframe,"iframe")}>
          {copied==="iframe"?"Copied":"Copy"}
        </button>
      </details>
      <div>
        <div style={{fontSize:12,fontWeight:600,marginBottom:6}}>
          What a visitor sees{status!=="active"?" this form is archived, so it shows a closed line":""}
        </div>
        <iframe className="embed-live-preview" src={snip.previewUrl} title="Donation form preview"
          style={{width:"100%",maxWidth:480,height:560,border:"1px solid "+T.bg3,borderRadius:10,background:T.white}}/>
      </div>
    </div>
  );
}

// ── PARITY-1 E — THE FORM'S OPTIONS ──────────────────────────────────────────
// The switches a donation form carries, read and saved through the ONE form
// config route (GET/PUT /giving-pages/:id/form), so the validator that checks
// them is the same one the server uses. Saving any of these gives the page the
// three-step form, and the line under the switches says so.
export const FORM_OPTION_ROWS=[
  ["showTribute","Let donors dedicate a gift","An in honor of / in memory of choice beside the amount."],
  ["showEmployerMatch","Ask where the donor works","For employers who match their staff's giving."],
  ["exitNudge","Remind a donor who starts to leave","Once per visit, on a computer, a short note with the amount they chose and a Finish my gift button."],
];
export function FormOptionsBlock({pageId,isReadOnly}){
  const [cfg,setCfg]=useState(null);
  const [busy,setBusy]=useState("");
  const [msg,setMsg]=useState("");
  useEffect(()=>{
    let alive=true;
    apiFetch(`/giving-pages/${pageId}/form`).then(r=>{if(alive&&r&&r.config)setCfg(r.config);}).catch(()=>{});
    return()=>{alive=false;};
  },[pageId]);
  async function flip(key){
    if(!cfg||isReadOnly)return;
    const next={...cfg,[key]:!cfg[key]};
    setBusy(key);setMsg("");
    try{
      await apiFetch(`/giving-pages/${pageId}/form`,{method:"PUT",body:JSON.stringify({config:next})});
      setCfg(next);
    }catch(e){setMsg(errorMessage(e,"That setting did not save."));}
    setBusy("");
  }
  if(!cfg)return null;
  return(
    <div className="form-options">
      <div style={{fontSize:11,fontWeight:700,color:T.ink3,marginBottom:8}}>
        Form options
      </div>
      {FORM_OPTION_ROWS.map(([key,label,help])=>(
        <label key={key} style={{display:"flex",gap:10,alignItems:"flex-start",marginBottom:8,cursor:isReadOnly?"not-allowed":"pointer"}}>
          <input type="checkbox" data-option={key} checked={cfg[key]===true} disabled={isReadOnly||busy===key}
            onChange={()=>flip(key)} style={{width:16,height:16,marginTop:2,cursor:"inherit"}}/>
          <span>
            <span style={{display:"block",fontSize:13,fontWeight:600,color:T.ink}}>{label}</span>
            <span style={{display:"block",fontSize:12,color:T.ink3,lineHeight:1.5}}>{help}</span>
          </span>
        </label>
      ))}
      <div style={{fontSize:12,color:T.ink3,lineHeight:1.6}}>
        {msg||"Saving an option gives this page the three-step form: the gift, about you, then payment."}
      </div>
    </div>
  );
}

export function GivingPagesManager({orgSlug,isAdmin,isReadOnly}){
  const [pages,setPages]=useState([]);
  const [funds,setFunds]=useState([]);
  // Goal'd campaigns (the ones with thermometers) — the "gifts through this
  // page count toward" selector. Same source as the gift forms' selector.
  const [campaigns,setCampaigns]=useState([]);
  const [loaded,setLoaded]=useState(false);
  const [showAdd,setShowAdd]=useState(false);
  const [editing,setEditing]=useState(null);
  const [form,setForm]=useState({title:"",goalAmount:"",story:"",imageUrl:"",fundId:"",slug:"",status:"active",campaignId:""});
  const [slugTouched,setSlugTouched]=useState(false);
  const [saving,setSaving]=useState(false);
  const [shareOpenId,setShareOpenId]=useState(null);
  // VOL-PAGE-1 — a volunteer page lives in this same list, built in the same
  // editor on the same brand. It starts from one of three templates.
  const [volNew,setVolNew]=useState(null);   // null | {title, template}
  const [volLink,setVolLink]=useState(null); // VOL-PAGE-1: null | {id, title, slug}, a volunteer page's own title and link

  // Peer-to-peer fundraisers nested under each page — lazily fetched on
  // first expand and cached per page id, same "don't refetch what's already
  // open" pattern as portfolioBreakdown in Dashboard.jsx. Anyone can spin up
  // a public page under an org's name here, so this list is the admin
  // safety valve: archive/take down a fundraiser immediately.
  const [fundraisersOpenId,setFundraisersOpenId]=useState(null);
  const [fundraisersByPage,setFundraisersByPage]=useState({});

  useEffect(()=>{
    apiFetch("/giving-pages").then(r=>{setPages(r||[]);setLoaded(true);}).catch(()=>setLoaded(true));
    apiFetch("/finance/funds").then(r=>setFunds(r||[])).catch(()=>{});
    apiFetch("/fundraising/campaigns").then(r=>setCampaigns(Array.isArray(r)?r:[])).catch(()=>{});
  },[]);

  function toggleFundraisers(p){
    const next=fundraisersOpenId===p.id?null:p.id;
    setFundraisersOpenId(next);
    if(next&&!fundraisersByPage[p.id]){
      apiFetch(`/giving-pages/${p.id}/fundraisers`)
        .then(r=>setFundraisersByPage(prev=>({...prev,[p.id]:r||[]})))
        .catch(()=>setFundraisersByPage(prev=>({...prev,[p.id]:[]})));
    }
  }

  async function toggleFundraiserArchive(pageId,f){
    const nextStatus=f.status==="active"?"archived":"active";
    try{
      const updated=await apiFetch(`/peer-fundraisers/${f.id}`,{method:"PUT",body:JSON.stringify({status:nextStatus})});
      setFundraisersByPage(prev=>({...prev,[pageId]:(prev[pageId]||[]).map(x=>x.id===f.id?updated:x)}));
    }catch(e){alert(errorMessage(e, "Failed to update fundraiser"));}
  }

  function openAdd(){
    setEditing(null);
    setForm({title:"",goalAmount:"",story:"",imageUrl:"",fundId:"",slug:"",status:"active",campaignId:""});
    setSlugTouched(false);
    setShowAdd(true);
  }
  function openEdit(p){
    setEditing(p);
    setForm({title:p.title,goalAmount:p.goal_amount!=null?String(p.goal_amount):"",story:p.story||"",imageUrl:p.image_url||"",fundId:p.fund_id||"",slug:p.slug,status:p.status,campaignId:p.campaign_id||""});
    setSlugTouched(true);
    setShowAdd(true);
  }
  function closeModal(){
    setShowAdd(false);setEditing(null);
    setForm({title:"",goalAmount:"",story:"",imageUrl:"",fundId:"",slug:"",status:"active",campaignId:""});
    setSlugTouched(false);
  }

  async function save(){
    if(!form.title.trim())return;
    setSaving(true);
    try{
      const body={title:form.title,goalAmount:form.goalAmount,story:form.story,imageUrl:form.imageUrl,fundId:form.fundId,slug:form.slug,status:form.status,campaignId:form.campaignId};
      if(editing){
        const updated=await apiFetch(`/giving-pages/${editing.id}`,{method:"PUT",body:JSON.stringify(body)});
        setPages(prev=>prev.map(p=>p.id===editing.id?updated:p));
      }else{
        const created=await apiFetch("/giving-pages",{method:"POST",body:JSON.stringify(body)});
        setPages(prev=>[created,...prev]);
      }
      closeModal();
    }catch(e){alert(errorMessage(e, "Failed to save giving page"));}
    setSaving(false);
  }

  async function toggleArchive(p){
    const nextStatus=p.status==="active"?"archived":"active";
    try{
      const updated=await apiFetch(`/giving-pages/${p.id}`,{method:"PUT",body:JSON.stringify({status:nextStatus})});
      setPages(prev=>prev.map(x=>x.id===p.id?updated:x));
      // VOL-PAGE-1: unpublishing a volunteer page is one click, so it is one
      // click to take back, through the shared Undo toast.
      if(p.page_kind==="volunteer"){
        offerUndo({undoAction:async()=>{
          const back=await apiFetch(`/giving-pages/${p.id}`,{method:"PUT",body:JSON.stringify({status:p.status})});
          setPages(prev=>prev.map(x=>x.id===p.id?back:x));
          return back;
        },message:nextStatus==="archived"?`Unpublished ${p.title}.`:`Published ${p.title} again.`},nextStatus==="archived"?"Unpublished":"Published");
      }
    }catch(e){alert(errorMessage(e, "Failed to update giving page"));}
  }

  // VOL-PAGE-1: a volunteer page's title and custom link, through the same
  // PUT as a giving page (which touches the slug only when it is sent), with
  // the shared Undo putting both back.
  async function saveVolLink(p){
    if(!volLink||!volLink.title.trim())return;
    setSaving(true);
    try{
      const updated=await apiFetch(`/giving-pages/${p.id}`,{method:"PUT",body:JSON.stringify({title:volLink.title.trim(),slug:volLink.slug.trim()||volLink.title.trim()})});
      setPages(prev=>prev.map(x=>x.id===p.id?{...x,...updated,public_url:p.public_url?p.public_url.replace(/[^/]+$/,updated.slug):p.public_url}:x));
      setVolLink(null);
      offerUndo({undoAction:async()=>{
        const back=await apiFetch(`/giving-pages/${p.id}`,{method:"PUT",body:JSON.stringify({title:p.title,slug:p.slug})});
        setPages(prev=>prev.map(x=>x.id===p.id?{...x,...back,public_url:p.public_url}:x));
        return back;
      },message:`The link is now /${updated.slug}.`},"Saved");
    }catch(e){alert(errorMessage(e, "Could not save the title and link"));}
    setSaving(false);
  }

  async function createVolunteerPage(){
    if(!volNew||!volNew.title.trim())return;
    setSaving(true);
    try{
      const created=await apiFetch("/giving-pages",{method:"POST",body:JSON.stringify({title:volNew.title.trim(),page_kind:"volunteer",template:volNew.template})});
      setPages(prev=>[created,...prev]);
      setVolNew(null);
      offerUndo({undoAction:async()=>{
        await apiFetch(`/giving-pages/${created.id}`,{method:"DELETE"});
        setPages(prev=>prev.filter(x=>x.id!==created.id));
        return {ok:true};
      },message:`Made ${created.title}. Build it, then publish.`},"Volunteer page made");
    }catch(e){alert(errorMessage(e, "Could not make the volunteer page"));}
    setSaving(false);
  }

  // FIX-41: the one Remove. A page with gifts, fundraisers or sign-ups is
  // archived, never deleted; one with none is deleted; Undo either way.
  function deletePage(p){
    const reload=()=>apiFetch("/giving-pages").then(r=>setPages(r||[])).catch(()=>{});
    return removeOne({kind:p.page_kind==="volunteer"?"volunteer_page":"giving_page",id:p.id,onDone:()=>{if(shareOpenId===p.id)setShareOpenId(null);reload();}});
  }

  const inp={width:"100%",boxSizing:"border-box",border:"1px solid "+T.bg3,borderRadius:10,padding:"10px 12px",fontSize:14,color:T.ink,background:T.bg,outline:"none",marginBottom:14,fontFamily:"inherit"};

  return(
    <div style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:16,padding:"24px 28px"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
        <SectionLabel>Giving Pages</SectionLabel>
        {isAdmin&&<button onClick={openAdd} disabled={isReadOnly||!orgSlug} title={isReadOnly?"Reactivate your subscription to make changes.":(!orgSlug?"Set up your organization first.":undefined)}
          style={{background:T.green,border:"none",borderRadius:8,padding:"7px 14px",color:T.white,fontSize:12,fontWeight:700,cursor:(isReadOnly||!orgSlug)?"not-allowed":"pointer",opacity:(isReadOnly||!orgSlug)?0.45:1}}>
          + New Giving Page
        </button>}
      </div>
      <div style={{marginTop:-10,marginBottom:12}}><MailTypeSwitches keys={["gift_receipt"]} from="giving_pages"/></div>
      {isAdmin&&(volNew?(
        <div data-testid="new-volunteer-page" style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:12,padding:"14px 16px",marginBottom:14}}>
          <div style={{fontSize:13,fontWeight:700,color:T.ink,marginBottom:8}}>A new volunteer page</div>
          <input style={{width:"100%",boxSizing:"border-box",border:"1px solid "+T.bg3,borderRadius:10,padding:"10px 12px",fontSize:14,marginBottom:10,fontFamily:"inherit"}}
            value={volNew.title} placeholder="Volunteer with us" onChange={e=>setVolNew({...volNew,title:e.target.value})} aria-label="Page title"/>
          <div style={{fontSize:12,fontWeight:700,color:T.ink3,marginBottom:6}}>Start from</div>
          {VOL_TEMPLATES.map(([k,label,hint])=>(
            <label key={k} style={{display:"flex",gap:8,alignItems:"flex-start",fontSize:13,padding:"5px 0",cursor:"pointer"}}>
              <input type="radio" name="vol-template" checked={volNew.template===k} onChange={()=>setVolNew({...volNew,template:k})} style={{marginTop:3}}/>
              <span><strong>{label}</strong><span style={{color:T.ink3}}> · {hint}</span></span>
            </label>
          ))}
          <div style={{display:"flex",gap:8,marginTop:10}}>
            <button onClick={createVolunteerPage} disabled={saving||!volNew.title.trim()} style={{background:T.green,border:"none",borderRadius:8,padding:"7px 14px",color:T.white,fontSize:12,fontWeight:700,cursor:"pointer",opacity:saving||!volNew.title.trim()?0.5:1}}>Make the page</button>
            <button onClick={()=>setVolNew(null)} style={{background:"none",border:"1px solid "+T.bg3,borderRadius:8,padding:"7px 14px",fontSize:12,fontWeight:600,color:T.ink2,cursor:"pointer"}}>Cancel</button>
          </div>
        </div>
      ):(
        <button onClick={()=>setVolNew({title:"Volunteer with us",template:"ongoing"})} disabled={isReadOnly||!orgSlug}
          style={{background:"none",border:"1px solid "+T.green,borderRadius:8,padding:"6px 12px",color:T.green,fontSize:12,fontWeight:700,cursor:(isReadOnly||!orgSlug)?"not-allowed":"pointer",marginBottom:14,opacity:(isReadOnly||!orgSlug)?0.45:1}}>
          + New volunteer page
        </button>
      ))}
      <div style={{fontSize:13,color:T.ink3,marginBottom:pages.length?14:0,lineHeight:1.6}}>
        {pages.length===0
          ?"Build a titled, storied donation page for a specific campaign, gala, or appeal, with its own goal and progress bar, separate from your main donation page."
          :"Each page has its own shareable link, goal, and progress, computed live from actual gifts, never a manually-set number."}
      </div>
      {!loaded&&<div style={{fontSize:13,color:T.ink3}}>Loading…</div>}

      {pages.map((p,i)=>{
        // One goal concept: a page linked to a campaign tracks toward THAT
        // campaign — its progress line/bar shows the campaign's live figures,
        // not a second page-local goal system. An unlinked page keeps its own.
        const isVol=p.page_kind==="volunteer";
        const linked=!!p.campaign_id;
        const raised=linked?(parseFloat(p.campaign_raised)||0):(parseFloat(p.raised_amount)||0);
        const goal=linked?(p.campaign_goal!=null?parseFloat(p.campaign_goal):null):(p.goal_amount!=null?parseFloat(p.goal_amount):null);
        const pct=goal>0?Math.min(100,Math.round((raised/goal)*100)):null;
        const url=isVol?(p.public_url?`${window.location.origin}${p.public_url}`:""):(orgSlug?`${window.location.origin}/give/${orgSlug}/${p.slug}`:"");
        const meta=GP_STATUS_META[p.status]||GP_STATUS_META.active;
        const shareOpen=shareOpenId===p.id;
        const fundraisersOpen=fundraisersOpenId===p.id;
        return(
          <div key={p.id} style={{padding:"14px 0",borderBottom:i<pages.length-1||shareOpen||fundraisersOpen?"1px solid "+T.bg3:"none"}}>
            <div style={{display:"flex",alignItems:"center",gap:12}}>
              <div style={{flex:1,minWidth:0}}>
                <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                  <span style={{fontSize:14,fontWeight:700,color:T.ink}}>{p.title}</span>
                  <span style={{fontSize:10,fontWeight:700,padding:"2px 8px",borderRadius:99,background:meta.bg,color:meta.color,border:"1px solid "+meta.border}}>{isVol?(p.status==="active"?(p.published_at?"Published":"Not published yet"):"Unpublished"):meta.label}</span>
                  {isVol&&<span data-testid="volunteer-page-label" style={{fontSize:10,fontWeight:700,padding:"2px 8px",borderRadius:99,background:T.bg,color:T.ink2,border:"1px solid "+T.bg3}}>Volunteer page</span>}
                  {p.fund_name&&<span style={{fontSize:11,color:T.ink3}}>→ {p.fund_name}</span>}
                  {p.campaign_name&&<span style={{fontSize:10,fontWeight:700,padding:"2px 8px",borderRadius:99,background:T.gold100,color:T.gold700,border:"1px solid "+T.gold300}}>Counts toward {p.campaign_name}</span>}
                </div>
                {isVol?(
                  <div style={{fontSize:12,color:T.ink3,marginTop:4}}>
                    {Number(p.vol_signups||0)} sign-ups · {Number(p.vol_shifts_filled||0)} shifts filled · {Number(p.vol_views||0)} views
                  </div>
                ):(
                <div style={{fontSize:12,color:T.ink3,marginTop:4}}>
                  {fmtDollars(raised)}{goal?` of ${fmtDollars(goal)} raised`:" raised"}{pct!=null?` · ${pct}%`:""}
                </div>
                )}
                {!isVol&&goal>0&&(
                  <div style={{background:T.bg,borderRadius:99,height:6,overflow:"hidden",marginTop:6,maxWidth:320}}>
                    <div style={{height:"100%",width:`${pct}%`,background:T.greenDk,borderRadius:99}}/>
                  </div>
                )}
              </div>
              <div style={{display:"flex",gap:6,flexShrink:0}}>
                <button onClick={()=>setShareOpenId(shareOpen?null:p.id)} aria-pressed={shareOpen}
                  style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:6,padding:"5px 10px",fontSize:11,fontWeight:600,color:T.ink2,cursor:"pointer",...activeMark(shareOpen,"bottom")}}>
                  Share {shareOpen?"▲":"▼"}
                </button>
                {!isVol&&<button onClick={()=>toggleFundraisers(p)} aria-pressed={fundraisersOpen}
                  style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:6,padding:"5px 10px",fontSize:11,fontWeight:600,color:T.ink2,cursor:"pointer",...activeMark(fundraisersOpen,"bottom")}}>
                  Fundraisers{fundraisersByPage[p.id]?` (${fundraisersByPage[p.id].length})`:""} {fundraisersOpen?"▲":"▼"}
                </button>}
                {isAdmin&&<>
                  {!isVol&&<button onClick={()=>openEdit(p)} style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:6,padding:"5px 10px",fontSize:11,fontWeight:600,color:T.ink2,cursor:"pointer"}}>Edit</button>}
                  {isVol&&<button data-testid="volunteer-page-link" onClick={()=>setVolLink(volLink&&volLink.id===p.id?null:{id:p.id,title:p.title,slug:p.slug})} disabled={isReadOnly} style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:6,padding:"5px 10px",fontSize:11,fontWeight:600,color:T.ink2,cursor:"pointer"}}>Title and link</button>}
                  <a data-testid="edit-in-editor" href={editPageHref(`page=${encodeURIComponent(p.id)}`)} style={{background:T.gold500,border:"none",borderRadius:6,padding:"5px 10px",fontSize:11,fontWeight:700,color:T.ink,cursor:"pointer",textDecoration:"none"}}>Edit in editor</a>
                  <button onClick={()=>toggleArchive(p)} disabled={isReadOnly}
                    style={{background:p.status==="active"?T.terra100:T.green100,border:"1px solid "+(p.status==="active"?T.terra200:T.greenDk),borderRadius:6,padding:"5px 10px",fontSize:11,fontWeight:600,color:p.status==="active"?T.terra700:T.greenDk,cursor:isReadOnly?"not-allowed":"pointer",opacity:isReadOnly?0.6:1}}>
                    {isVol?(p.status==="active"?"Unpublish":"Publish again"):(p.status==="active"?"Archive":"Reactivate")}
                  </button>
                  <button onClick={()=>deletePage(p)} data-testid="page-remove" data-kind={p.page_kind==="volunteer"?"volunteer_page":"giving_page"}
                    style={{background:"transparent",border:"1px solid "+T.bg3,borderRadius:6,padding:"5px 10px",fontSize:11,fontWeight:600,color:T.ink2,cursor:"pointer"}}>
                    Remove
                  </button>
                </>}
              </div>
            </div>
            {isVol&&volLink&&volLink.id===p.id&&(
              <div style={{marginTop:14,background:T.bg,border:"1px solid "+T.bg3,borderRadius:12,padding:"16px 18px",display:"flex",flexWrap:"wrap",gap:12,alignItems:"flex-end"}}>
                <label style={{display:"flex",flexDirection:"column",gap:4,fontSize:12,fontWeight:600,color:T.ink2,flex:"1 1 220px"}}>Title
                  <input value={volLink.title} onChange={e=>setVolLink({...volLink,title:e.target.value})} style={{padding:"8px 10px",border:"1px solid "+T.bg3,borderRadius:6,fontSize:14}}/>
                </label>
                <label style={{display:"flex",flexDirection:"column",gap:4,fontSize:12,fontWeight:600,color:T.ink2,flex:"1 1 220px"}}>Link: /volunteer-page/{orgSlug}/
                  <input value={volLink.slug} onChange={e=>setVolLink({...volLink,slug:e.target.value})} style={{padding:"8px 10px",border:"1px solid "+T.bg3,borderRadius:6,fontSize:14}}/>
                </label>
                <button onClick={()=>saveVolLink(p)} disabled={saving||isReadOnly} style={{background:T.green,color:T.bgCard,border:"none",borderRadius:6,padding:"9px 14px",fontSize:13,fontWeight:700,cursor:"pointer"}}>Save</button>
              </div>
            )}
            {shareOpen&&(
              <div style={{marginTop:14,background:T.bg,border:"1px solid "+T.bg3,borderRadius:12,padding:"16px 18px",display:"flex",flexDirection:"column",gap:14}}>
                <UrlLinkButtons url={url}/>
                <QrCodeBlock url={url} filenameBase={slugifyPreview(p.title)||"giving-page"}/>
                <div>
                  <div style={{fontSize:11,fontWeight:700,color:T.ink3,marginBottom:8}}>Embed Code</div>
                  <EmbedCodeBlock url={isVol&&url?url+"?embed=1":url}/>
                </div>
                {/* BUILD-102 Part 4 — the DONATION FORM on her own website, which
                    is a different thing from embedding the whole page: one line,
                    a self-sizing frame, and no card field anywhere on her site.
                    The snippets are generated by the SERVER so the script URL, the
                    id and the fallback cannot drift apart in three places of copy. */}
                {!isVol&&isAdmin&&<FormOptionsBlock pageId={p.id} isReadOnly={isReadOnly}/>}
                {!isVol&&<FormEmbedBlock pageId={p.id} status={p.status}/>}
                {/* BUILD-102 Part 6 — the funnel, with every figure's definition
                    on its own hover, and a sentence where a winner would be if it
                    were callable. */}
                {!isVol&&<FormFunnelBlock pageId={p.id}/>}
              </div>
            )}
            {fundraisersOpen&&(()=>{
              const list=fundraisersByPage[p.id];
              return(
                <div style={{marginTop:14,background:T.bg,border:"1px solid "+T.bg3,borderRadius:12,padding:"16px 18px"}}>
                  <div style={{fontSize:12,color:T.ink3,marginBottom:list===undefined||list.length?12:0,lineHeight:1.6}}>
                    {list===undefined
                      ?"Loading…"
                      :list.length===0
                        ?"Nobody has started a personal fundraiser under this page yet. Anyone can, once you've shared the link above, this list is your safety valve to take one down if needed."
                        :"Anyone can start a public page under your org's name from the link above, archive one immediately if it needs to come down."}
                  </div>
                  {list&&list.length>0&&list.map((f,fi)=>{
                    const fRaised=parseFloat(f.raised_amount)||0;
                    const fGoal=f.personal_goal_amount!=null?parseFloat(f.personal_goal_amount):null;
                    const fMeta=GP_STATUS_META[f.status]||GP_STATUS_META.active;
                    const fUrl=orgSlug?`${window.location.origin}/give/${orgSlug}/${p.slug}/${f.slug}`:"";
                    return(
                      <div key={f.id} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 0",borderTop:fi>0?"1px solid "+T.bg3:"none"}}>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                            <span style={{fontSize:13,fontWeight:700,color:T.ink}}>{f.name}</span>
                            <span style={{fontSize:9,fontWeight:700,padding:"1px 7px",borderRadius:99,background:fMeta.bg,color:fMeta.color,border:"1px solid "+fMeta.border}}>{fMeta.label}</span>
                          </div>
                          <div style={{fontSize:11,color:T.ink3,marginTop:2}}>
                            {fmtDollars(fRaised)}{fGoal?` of ${fmtDollars(fGoal)} raised`:" raised"} · <a href={fUrl} target="_blank" rel="noreferrer" style={{color:T.greenDk}}>{fUrl.replace(/^https?:\/\//,"")}</a>
                          </div>
                        </div>
                        {isAdmin&&(
                          <button onClick={()=>toggleFundraiserArchive(p.id,f)} disabled={isReadOnly}
                            style={{flexShrink:0,background:f.status==="active"?T.terra100:T.green100,border:"1px solid "+(f.status==="active"?T.terra200:T.greenDk),borderRadius:6,padding:"5px 10px",fontSize:11,fontWeight:600,color:f.status==="active"?T.terra700:T.greenDk,cursor:isReadOnly?"not-allowed":"pointer",opacity:isReadOnly?0.6:1}}>
                            {f.status==="active"?"Archive":"Reactivate"}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>
        );
      })}

      {showAdd&&(
        <Modal onClose={closeModal} width={480} zIndex={500} backdrop="rgba(0,0,0,0.45)" blur={false}
          padding="32px 28px" ariaLabel={editing?"Edit giving page":"New giving page"}
          dialogStyle={{borderRadius:20}}>
          <div>
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

            <div style={{fontSize:12,fontWeight:600,color:T.ink3,marginBottom:4}}>Gifts through this page count toward (optional)</div>
            <select value={form.campaignId} onChange={e=>setForm(f=>({...f,campaignId:e.target.value}))} style={{...inp,marginBottom:4,cursor:"pointer"}}>
              <option value="">No campaign, a general page</option>
              {campaigns.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <div style={{fontSize:11,color:T.ink3,marginBottom:14,lineHeight:1.5}}>
              Online gifts through this page attribute to the chosen campaign automatically, its thermometer moves with no manual step, and this page tracks the campaign's goal instead of keeping a separate one.
            </div>

            {editing&&(
              <label style={{display:"flex",alignItems:"center",gap:8,fontSize:13,color:T.ink,cursor:"pointer",marginBottom:20,marginTop:-4}}>
                <input type="checkbox" checked={form.status==="archived"} onChange={e=>setForm(f=>({...f,status:e.target.checked?"archived":"active"}))} style={{width:16,height:16,cursor:"pointer"}}/>
                Archived (hidden from the public link)
              </label>
            )}

            <div style={{display:"flex",gap:10,marginTop:6}}>
              <button onClick={closeModal} style={{flex:1,background:T.bg,border:"1px solid "+T.bg3,borderRadius:10,padding:"10px",color:T.ink2,fontSize:13,fontWeight:600,cursor:"pointer"}}>Cancel</button>
              <button onClick={save} disabled={saving||!form.title.trim()}
                style={{flex:2,background:T.green,border:"none",borderRadius:10,padding:"10px",color:T.white,fontSize:13,fontWeight:700,cursor:"pointer",opacity:(saving||!form.title.trim())?0.7:1}}>
                {saving?"Saving…":editing?"Save changes":"Create giving page"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
