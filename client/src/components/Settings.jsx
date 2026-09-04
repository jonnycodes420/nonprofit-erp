import { useState, useEffect } from "react";
import { T, Pill, SectionLabel, PageTitle, SectionTabs, fmt, quietPhrase } from "./shared";
import { QrCodeBlock, EmbedCodeBlock } from "./ShareBlocks";
import { resolveAssetUrl } from "../lib/assetUrl";
import { apiFetch, API, getToken, billingErrorMessage } from "../api";
import UpgradeModal from "./UpgradeModal";
import Uploader, { IMAGE_ACCEPT, IMAGE_ACCEPT_LABEL, IMAGE_MAX_BYTES } from "./Uploader";
import { useDirtyGuard, confirmIfDirty } from "../lib/dirtyGuard";
import { PortalBannerCrop, PORTAL_IMPACT_PHOTO_RATIO } from "./PortalBanner";

// Billing status badge styling, keyed by orgs.subscription_status.
// "cancelled" (2 l's) is included alongside "canceled" (1 l) because old
// rows may have been written with either spelling (see server.js).
const BILLING_STATUS_META = {
  active:        { label:"Active",        bg:"#edf3ee", color:"#1a6b4a", border:"#10b981" },
  trialing:      { label:"Trialing",      bg:"#1a2e1f", color:"#8fa896", border:"#2d4a35" },
  past_due:      { label:"Past Due",      bg:"#f6e3dd", color:"#8a3a24", border:"#eac6b8" },
  trial_expired: { label:"Trial Expired", bg:"#f6e3dd", color:"#8a3a24", border:"#eac6b8" },
  canceled:      { label:"Canceled",      bg:"#1a2e1f", color:"#8fa896", border:"#2d4a35" },
  cancelled:     { label:"Canceled",      bg:"#1a2e1f", color:"#8fa896", border:"#2d4a35" },
};

// QrCodeBlock/EmbedCodeBlock now live in ./ShareBlocks (factored out so
// non-Settings pages, e.g. the public peer-fundraiser manage page, can
// reuse them without importing this whole admin component tree).

function slugifyPreview(s){
  return (s||"").toLowerCase().trim().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,60);
}

const GP_STATUS_META={
  active:   {label:"Active",   bg:"#edf3ee", color:"#1a6b4a", border:"#10b981"},
  archived: {label:"Archived", bg:"#f3f0eb", color:"#6b6b6b", border:"#d4cfc6"},
};

// A shareable URL renders as labeled actions — open + copy — never bare
// monospace text (the URL travels via the clipboard). One implementation for
// every share surface in Settings (giving-page share panel, donation QR card).
function UrlLinkButtons({url,openLabel="Open page ↗"}){
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
function GivingPagesManager({orgSlug,isAdmin,isReadOnly}){
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
    }catch(e){alert(e.message||"Failed to update fundraiser");}
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

  async function deletePage(p){
    if(!window.confirm(`Delete "${p.title}"? This removes the page and its shareable link permanently — gifts already given through it are not deleted. This cannot be undone.`))return;
    try{
      await apiFetch(`/giving-pages/${p.id}`,{method:"DELETE"});
      setPages(prev=>prev.filter(x=>x.id!==p.id));
      if(shareOpenId===p.id)setShareOpenId(null);
    }catch(e){alert(e.message||"Failed to delete giving page");}
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
        // One goal concept: a page linked to a campaign tracks toward THAT
        // campaign — its progress line/bar shows the campaign's live figures,
        // not a second page-local goal system. An unlinked page keeps its own.
        const linked=!!p.campaign_id;
        const raised=linked?(parseFloat(p.campaign_raised)||0):(parseFloat(p.raised_amount)||0);
        const goal=linked?(p.campaign_goal!=null?parseFloat(p.campaign_goal):null):(p.goal_amount!=null?parseFloat(p.goal_amount):null);
        const pct=goal>0?Math.min(100,Math.round((raised/goal)*100)):null;
        const url=orgSlug?`${window.location.origin}/give/${orgSlug}/${p.slug}`:"";
        const meta=GP_STATUS_META[p.status]||GP_STATUS_META.active;
        const shareOpen=shareOpenId===p.id;
        const fundraisersOpen=fundraisersOpenId===p.id;
        return(
          <div key={p.id} style={{padding:"14px 0",borderBottom:i<pages.length-1||shareOpen||fundraisersOpen?"1px solid "+T.bg3:"none"}}>
            <div style={{display:"flex",alignItems:"center",gap:12}}>
              <div style={{flex:1,minWidth:0}}>
                <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                  <span style={{fontSize:14,fontWeight:700,color:T.ink}}>{p.title}</span>
                  <span style={{fontSize:10,fontWeight:700,padding:"2px 8px",borderRadius:99,background:meta.bg,color:meta.color,border:"1px solid "+meta.border}}>{meta.label}</span>
                  {p.fund_name&&<span style={{fontSize:11,color:T.ink3}}>→ {p.fund_name}</span>}
                  {p.campaign_name&&<span style={{fontSize:10,fontWeight:700,padding:"2px 8px",borderRadius:99,background:T.gold100,color:T.gold700,border:"1px solid "+T.gold300}}>Counts toward {p.campaign_name}</span>}
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
                <button onClick={()=>toggleFundraisers(p)}
                  style={{background:fundraisersOpen?T.greenDk:T.bg,border:"1px solid "+(fundraisersOpen?T.greenDk:T.bg3),borderRadius:6,padding:"5px 10px",fontSize:11,fontWeight:600,color:fundraisersOpen?"#fff":T.ink2,cursor:"pointer"}}>
                  Fundraisers{fundraisersByPage[p.id]?` (${fundraisersByPage[p.id].length})`:""} {fundraisersOpen?"▲":"▼"}
                </button>
                {isAdmin&&<>
                  <button onClick={()=>openEdit(p)} style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:6,padding:"5px 10px",fontSize:11,fontWeight:600,color:T.ink2,cursor:"pointer"}}>Edit</button>
                  <button onClick={()=>toggleArchive(p)} disabled={isReadOnly}
                    style={{background:p.status==="active"?"#f6e3dd":"#edf3ee",border:"1px solid "+(p.status==="active"?"#eac6b8":"#10b981"),borderRadius:6,padding:"5px 10px",fontSize:11,fontWeight:600,color:p.status==="active"?"#8a3a24":"#1a6b4a",cursor:isReadOnly?"not-allowed":"pointer",opacity:isReadOnly?0.6:1}}>
                    {p.status==="active"?"Archive":"Reactivate"}
                  </button>
                  <button onClick={()=>deletePage(p)}
                    style={{background:"transparent",border:"1px solid #eac6b8",borderRadius:6,padding:"5px 10px",fontSize:11,fontWeight:600,color:"#8a3a24",cursor:"pointer"}}>
                    Delete
                  </button>
                </>}
              </div>
            </div>
            {shareOpen&&(
              <div style={{marginTop:14,background:T.bg,border:"1px solid "+T.bg3,borderRadius:12,padding:"16px 18px",display:"flex",flexDirection:"column",gap:14}}>
                <UrlLinkButtons url={url}/>
                <QrCodeBlock url={url} filenameBase={slugifyPreview(p.title)||"giving-page"}/>
                <div>
                  <div style={{fontSize:11,fontWeight:700,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:8}}>Embed Code</div>
                  <EmbedCodeBlock url={url}/>
                </div>
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
                        ?"Nobody has started a personal fundraiser under this page yet. Anyone can, once you've shared the link above — this list is your safety valve to take one down if needed."
                        :"Anyone can start a public page under your org's name from the link above — archive one immediately if it needs to come down."}
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
                            style={{flexShrink:0,background:f.status==="active"?"#f6e3dd":"#edf3ee",border:"1px solid "+(f.status==="active"?"#eac6b8":"#10b981"),borderRadius:6,padding:"5px 10px",fontSize:11,fontWeight:600,color:f.status==="active"?"#8a3a24":"#1a6b4a",cursor:isReadOnly?"not-allowed":"pointer",opacity:isReadOnly?0.6:1}}>
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

            <div style={{fontSize:12,fontWeight:600,color:T.ink3,marginBottom:4}}>Gifts through this page count toward (optional)</div>
            <select value={form.campaignId} onChange={e=>setForm(f=>({...f,campaignId:e.target.value}))} style={{...inp,marginBottom:4,cursor:"pointer"}}>
              <option value="">No campaign — a general page</option>
              {campaigns.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <div style={{fontSize:11,color:T.ink3,marginBottom:14,lineHeight:1.5}}>
              Online gifts through this page attribute to the chosen campaign automatically — its thermometer moves with no manual step, and this page tracks the campaign's goal instead of keeping a separate one.
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

// Donor-covers-fees org switch (BUILD-08 Phase B) — controls whether the
// public donate flow offers the optional "add a little to cover processing
// costs" checkbox (checkbox itself always defaults unchecked donor-side).
// Module scope like the other managers; saves via PATCH /orgs/:id.
// Org branding (BUILD-13 Part 2) — tasteful white-label: logo + one accent
// color. The accent is normalized server-side to an accessible range, so the
// server response is the source of truth (it may hand back a slightly deepened
// color for legibility — we show a note when it does). Applied only to accent
// moments across app/emails/receipts, never a full re-skin.
const PRESET_ACCENTS=["#1a6b4a","#0d5c3a","#b8593f","#7c3a12","#3f5c8a","#6b3f8a","#8a5a1f","#0f1a12"];
function BrandingManager({orgId,isAdmin,isReadOnly,onSaved}){
  const [logo,setLogo]=useState("");        // data URI or ""
  const [accent,setAccent]=useState("");    // hex or ""
  const [loaded,setLoaded]=useState(false);
  const [saving,setSaving]=useState(false);
  const [msg,setMsg]=useState("");
  const [err,setErr]=useState("");
  const [dirty,setDirty]=useState(false);   // BUILD-54 §6
  useDirtyGuard(dirty);
  useEffect(()=>{
    apiFetch("/org").then(o=>{setLogo(o.logo_data||"");setAccent(o.brand_accent||"");setLoaded(true);}).catch(()=>setLoaded(true));
  },[]);
  const disabled=!isAdmin||isReadOnly;
  const effAccent=accent||"#1a6b4a";
  async function save(){
    if(disabled||saving)return;
    setSaving(true);setErr("");setMsg("");
    try{
      const body={brandAccent:accent||"",logoData:logo||undefined,removeLogo:!logo};
      const res=await apiFetch("/orgs/branding",{method:"PUT",body:JSON.stringify(body)});
      setAccent(res.brand_accent||"");
      setDirty(false);
      setMsg(res.adjusted?"Saved — your color was deepened slightly so text stays readable.":"Branding saved.");
      onSaved&&onSaved();
    }catch(e){setErr(e.message||"Could not save branding.");}
    setSaving(false);
  }
  if(!loaded)return <div style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:16,padding:"24px 28px",color:T.ink3,fontSize:13}}>Loading…</div>;
  return(
    <div style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:16,padding:"24px 28px"}}>
      <SectionLabel>Brand Identity</SectionLabel>
      <div style={{fontSize:13,color:T.ink3,lineHeight:1.6,marginTop:6,marginBottom:20,maxWidth:560}}>
        Add your logo and one accent color. Steward keeps its calm layout as the frame — your color lands on the moments that matter: your dashboard welcome, primary buttons, and the header of every receipt and email your donors receive. We keep it readable automatically.
      </div>
      <div style={{display:"flex",gap:28,flexWrap:"wrap"}}>
        {/* Controls */}
        <div style={{flex:"1 1 300px",display:"flex",flexDirection:"column",gap:18}}>
          <div>
            <div style={{fontSize:11,fontWeight:700,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:8}}>Logo</div>
            <Uploader accept={IMAGE_ACCEPT} acceptLabel={IMAGE_ACCEPT_LABEL} maxBytes={IMAGE_MAX_BYTES} compact
              shape="square" preview={logo||null}
              disabled={disabled} label={logo?"Replace logo":"Drag your logo here, or browse"}
              onFile={({dataUrl})=>{setDirty(true);setLogo(dataUrl);}}
              onRemove={disabled?null:()=>{setDirty(true);setLogo("");}}/>
          </div>
          <div>
            <div style={{fontSize:11,fontWeight:700,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:8}}>Accent color</div>
            <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
              <input type="color" value={effAccent} onChange={e=>{setDirty(true);setAccent(e.target.value);}} disabled={disabled} style={{width:40,height:40,border:"1px solid "+T.bg3,borderRadius:8,background:"none",cursor:disabled?"not-allowed":"pointer",padding:2}}/>
              <input value={accent} onChange={e=>{setDirty(true);setAccent(e.target.value);}} disabled={disabled} placeholder="#1a6b4a" style={{width:110,background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"9px 12px",color:T.ink,fontSize:13,outline:"none",fontFamily:"monospace"}}/>
              {accent&&!disabled&&<button onClick={()=>setAccent("")} style={{background:"none",border:"none",color:T.ink3,fontSize:12,cursor:"pointer",textDecoration:"underline"}}>Reset to Steward gold</button>}
            </div>
            <div style={{display:"flex",gap:6,marginTop:10,flexWrap:"wrap"}}>
              {PRESET_ACCENTS.map(c=><button key={c} onClick={()=>!disabled&&setAccent(c)} title={c} style={{width:24,height:24,borderRadius:6,background:c,border:accent.toLowerCase()===c?"2px solid "+T.ink:"1px solid rgba(0,0,0,0.15)",cursor:disabled?"not-allowed":"pointer"}}/>)}
            </div>
          </div>
          {isAdmin&&<div style={{display:"flex",alignItems:"center",gap:12}}>
            <button onClick={save} disabled={disabled||saving} title={isReadOnly?"Reactivate your subscription to make changes.":undefined} style={{background:disabled?T.bg3:T.greenMid,border:"none",borderRadius:9,padding:"10px 18px",color:"#fff",fontSize:13,fontWeight:700,cursor:disabled?"not-allowed":"pointer"}}>{saving?"Saving…":"Save branding"}</button>
            {msg&&<span style={{fontSize:12,color:T.greenMid}}>{msg}</span>}
            {err&&<span style={{fontSize:12,color:T.terracotta}}>{err}</span>}
          </div>}
        </div>
        {/* Live preview */}
        <div style={{flex:"1 1 300px",minWidth:260}}>
          <div style={{fontSize:11,fontWeight:700,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:8}}>Preview</div>
          <div style={{border:"1px solid "+T.bg3,borderRadius:12,overflow:"hidden",background:T.bg}}>
            <div style={{background:effAccent,padding:"14px 18px",display:"flex",alignItems:"center",gap:10}}>
              {logo&&<img src={logo} alt="" style={{height:26,maxWidth:90,objectFit:"contain"}}/>}
              <span style={{color:"#fff",fontWeight:800,fontSize:15}}>Your Organization</span>
            </div>
            <div style={{padding:"16px 18px",display:"flex",flexDirection:"column",gap:12}}>
              <div style={{fontSize:13,color:T.ink3}}>Dear Jordan, thank you for your generous gift…</div>
              <button style={{alignSelf:"flex-start",background:effAccent,border:"none",borderRadius:8,padding:"8px 16px",color:"#fff",fontSize:12,fontWeight:700}}>Primary action</button>
              <div style={{fontSize:11,color:T.ink3}}>The dashboard welcome, receipts, and donor emails use this header.</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// BUILD-72 Part 4 — the organization's timezone. Not a display preference:
// EVERY date boundary in the product is computed in this zone. Before it
// existed, a task due today started reading "1 day overdue" at 8pm Eastern
// because the server compared it against a UTC calendar date.
function TimezoneCard({orgId,isAdmin,isReadOnly}){
  const [tz,setTz]=useState(null);          // null = loading
  const [saving,setSaving]=useState(false);
  const [err,setErr]=useState("");
  const [savedAt,setSavedAt]=useState(0);
  useEffect(()=>{
    apiFetch("/org").then(o=>setTz(o.timezone||"America/New_York")).catch(()=>setTz("America/New_York"));
  },[]);
  // The zones a US nonprofit actually sits in, plus the ones our tests pin.
  // Any valid IANA zone is accepted by the API; this list is the common path.
  const ZONES=[
    ["America/New_York","Eastern"],["America/Chicago","Central"],
    ["America/Denver","Mountain"],["America/Phoenix","Arizona (no DST)"],
    ["America/Los_Angeles","Pacific"],["America/Anchorage","Alaska"],
    ["Pacific/Honolulu","Hawaii"],["America/Puerto_Rico","Puerto Rico"],
  ];
  async function save(next){
    if(saving||next===tz)return;
    const prev=tz; setSaving(true); setTz(next); setErr("");
    try{
      await apiFetch(`/orgs/${orgId}`,{method:"PATCH",body:JSON.stringify({timezone:next})});
      setSavedAt(Date.now());
    }catch(e){ setTz(prev); setErr(e.message||"Could not save the timezone."); }
    setSaving(false);
  }
  const today=(()=>{ try{ return tz? new Intl.DateTimeFormat("en-US",{timeZone:tz,weekday:"long",month:"long",day:"numeric"}).format(new Date()):""; }catch{ return ""; } })();
  return(
    <div style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:16,padding:"24px 28px",marginBottom:20}}>
      <SectionLabel>Time Zone</SectionLabel>
      <div style={{fontSize:13,color:T.ink3,lineHeight:1.6,marginTop:6,marginBottom:14}}>
        Every date in Steward is calculated in your organization&rsquo;s time zone — what counts as
        &ldquo;this week&rdquo;, when a task becomes overdue, and where a gift falls in your fiscal year.
        A gift you enter on Sunday evening belongs to that Sunday.
      </div>
      <div style={{display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
        <select
          value={tz||"America/New_York"}
          disabled={!isAdmin||isReadOnly||saving||tz===null}
          onChange={e=>save(e.target.value)}
          style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"10px 12px",
                  color:T.ink,fontSize:13,fontFamily:"inherit",minWidth:260,
                  cursor:(!isAdmin||isReadOnly)?"not-allowed":"pointer"}}>
          {ZONES.map(([z,label])=><option key={z} value={z}>{label} — {z}</option>)}
          {tz&&!ZONES.some(([z])=>z===tz)&&<option value={tz}>{tz}</option>}
        </select>
        {today&&<span style={{fontSize:12,color:T.ink3}}>Today here is <strong style={{color:T.ink}}>{today}</strong></span>}
        {savedAt>0&&<span style={{fontSize:12,color:T.green||"#10b981"}}>Saved</span>}
      </div>
      {err&&<div style={{fontSize:12,color:T.terracotta,marginTop:8}}>{err}</div>}
      {!isAdmin&&<div style={{fontSize:12,color:T.ink3,marginTop:8}}>Only an admin can change this.</div>}
    </div>
  );
}

function CoverFeesCard({orgId,isAdmin}){
  const [enabled,setEnabled]=useState(null); // null = loading
  const [saving,setSaving]=useState(false);
  useEffect(()=>{
    apiFetch("/org").then(o=>setEnabled(o.cover_fees_enabled!==false)).catch(()=>setEnabled(true));
  },[]);
  async function toggle(){
    if(saving||enabled===null)return;
    const next=!enabled;
    setSaving(true);setEnabled(next);
    try{ await apiFetch(`/orgs/${orgId}`,{method:"PATCH",body:JSON.stringify({coverFeesEnabled:next})}); }
    catch{ setEnabled(!next); }
    setSaving(false);
  }
  return(
    <div style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:16,padding:"24px 28px",marginBottom:20}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:16,flexWrap:"wrap"}}>
        <div style={{flex:"1 1 320px"}}>
          <SectionLabel>Let Donors Cover Processing Costs</SectionLabel>
          <div style={{fontSize:13,color:T.ink3,lineHeight:1.6,marginTop:6}}>
            Offers donors an optional, unchecked-by-default checkbox at checkout to add
            the card-processing fee (2.9% + 30¢) on top of their gift, so you receive the
            full intended amount. The added amount is part of their donation and appears
            on their receipt as part of the total.
          </div>
        </div>
        {isAdmin&&(
          <button onClick={toggle} disabled={enabled===null||saving}
            style={{background:enabled?T.greenDk:T.bg3,border:"none",borderRadius:99,width:46,height:26,position:"relative",cursor:"pointer",flexShrink:0,transition:"background 0.15s",opacity:enabled===null?0.5:1}}
            aria-label={enabled?"Disable donor-covers-fees":"Enable donor-covers-fees"}>
            <span style={{position:"absolute",top:3,left:enabled?23:3,width:20,height:20,background:"#fff",borderRadius:"50%",transition:"left 0.15s",boxShadow:"0 1px 3px rgba(0,0,0,0.25)"}}/>
          </button>
        )}
      </div>
    </div>
  );
}

function fmtDollars(n){
  return "$"+Math.round(n||0).toLocaleString();
}

// Tax Receipting settings — its own module-scope component (like
// GivingPagesManager above) rather than inlined in Settings' body, since
// it carries meaningfully more state (legal fields form + enable gate +
// preview + a separate year-end dry-run/generate flow) than the simple
// list-of-items pattern Custom Fields/Impact Metrics use. See CLAUDE.md
// "Tax receipting" — US-only v1, cash gifts only, receipts auto-send for
// online gifts once enabled, offline gifts are one click from DonorProfile.
function TaxReceiptsManager({orgId,isAdmin,isReadOnly}){
  const [form,setForm]=useState({legalName:"",ein:"",receiptAddress:"",receiptSignatureName:"",receiptSignatureTitle:"",receiptCustomMessage:"",receiptsEnabled:false});
  const [loaded,setLoaded]=useState(false);
  const [saving,setSaving]=useState(false);
  const [saveErr,setSaveErr]=useState("");
  const [saveMsg,setSaveMsg]=useState("");
  const [previewLoading,setPreviewLoading]=useState(false);

  const [yearEndYear,setYearEndYear]=useState(String(new Date().getFullYear()-1));
  const [dryRunResult,setDryRunResult]=useState(null);
  const [dryRunLoading,setDryRunLoading]=useState(false);
  const [runLoading,setRunLoading]=useState(false);
  const [runResult,setRunResult]=useState(null);
  const [runErr,setRunErr]=useState("");

  useEffect(()=>{
    apiFetch("/org").then(o=>{
      setForm({
        legalName:o.legal_name||"", ein:o.ein||"", receiptAddress:o.receipt_address||"",
        receiptSignatureName:o.receipt_signature_name||"", receiptSignatureTitle:o.receipt_signature_title||"",
        receiptCustomMessage:o.receipt_custom_message||"", receiptsEnabled:!!o.receipts_enabled,
      });
      setLoaded(true);
    }).catch(()=>setLoaded(true));
  },[]);

  const canEnable=form.legalName.trim()&&form.ein.trim()&&form.receiptAddress.trim();

  async function save(overrideEnabled){
    setSaving(true); setSaveErr(""); setSaveMsg("");
    const nextEnabled=overrideEnabled!==undefined?overrideEnabled:form.receiptsEnabled;
    try{
      const updated=await apiFetch(`/orgs/${orgId}`,{method:"PATCH",body:JSON.stringify({
        legalName:form.legalName, ein:form.ein, receiptAddress:form.receiptAddress,
        receiptSignatureName:form.receiptSignatureName, receiptSignatureTitle:form.receiptSignatureTitle,
        receiptCustomMessage:form.receiptCustomMessage, receiptsEnabled:nextEnabled,
      })});
      setForm({
        legalName:updated.legal_name||"", ein:updated.ein||"", receiptAddress:updated.receipt_address||"",
        receiptSignatureName:updated.receipt_signature_name||"", receiptSignatureTitle:updated.receipt_signature_title||"",
        receiptCustomMessage:updated.receipt_custom_message||"", receiptsEnabled:!!updated.receipts_enabled,
      });
      setSaveMsg("Saved.");
      setTimeout(()=>setSaveMsg(""),3000);
    }catch(e){ setSaveErr(e.message||"Failed to save."); }
    setSaving(false);
  }

  async function downloadPreview(){
    setPreviewLoading(true);
    try{
      const resp=await fetch(`${API}/receipts/preview`,{headers:{Authorization:`Bearer ${getToken()}`}});
      if(!resp.ok)throw new Error("Could not generate preview");
      const blob=await resp.blob();
      const url=URL.createObjectURL(blob);
      window.open(url,"_blank");
      setTimeout(()=>URL.revokeObjectURL(url),10000);
    }catch(e){ alert(e.message||"Could not generate preview"); }
    setPreviewLoading(false);
  }

  async function runDryRun(){
    setDryRunLoading(true); setDryRunResult(null); setRunResult(null); setRunErr("");
    try{
      const r=await apiFetch("/receipts/year-end-run",{method:"POST",body:JSON.stringify({year:parseInt(yearEndYear,10),dryRun:true})});
      setDryRunResult(r);
    }catch(e){ setRunErr(e.message||"Dry run failed."); }
    setDryRunLoading(false);
  }

  async function generateAndSend(){
    if(!window.confirm(`Generate and email year-end statements to every donor with a ${yearEndYear} gift? This sends real emails.`))return;
    setRunLoading(true); setRunErr("");
    try{
      const r=await apiFetch("/receipts/year-end-run",{method:"POST",body:JSON.stringify({year:parseInt(yearEndYear,10),dryRun:false})});
      setRunResult(r);
      setDryRunResult(null);
    }catch(e){ setRunErr(e.message||"Year-end run failed."); }
    setRunLoading(false);
  }

  const inp={width:"100%",boxSizing:"border-box",border:"1px solid "+T.bg3,borderRadius:10,padding:"9px 12px",fontSize:13,color:T.ink,background:T.bg,outline:"none",marginBottom:12,fontFamily:"inherit"};
  const lbl={fontSize:11,fontWeight:700,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:4};

  if(!loaded) return <div style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:16,padding:"24px 28px",fontSize:13,color:T.ink3}}>Loading…</div>;

  return(
    <div style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:16,padding:"24px 28px",display:"flex",flexDirection:"column",gap:24}}>
      <div>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
          <SectionLabel>Tax Receipts</SectionLabel>
          <span style={{fontSize:10,fontWeight:700,padding:"3px 9px",borderRadius:99,background:form.receiptsEnabled?"#edf3ee":"#f3f0eb",color:form.receiptsEnabled?"#1a6b4a":"#6b6b6b",border:"1px solid "+(form.receiptsEnabled?"#10b981":"#d4cfc6")}}>
            {form.receiptsEnabled?"Enabled":"Not enabled"}
          </span>
        </div>
        <div style={{fontSize:13,color:T.ink3,marginBottom:16,lineHeight:1.6}}>
          US donors need a written acknowledgment for any single gift of $250+ to claim the deduction (IRC §170(f)(8)). Fill in your organization's legal details below, then online gifts get an automatic, branded receipt — offline gifts are one click from a donor's Gifts &amp; Pledges tab.
        </div>

        <div style={lbl}>Legal name</div>
        <input value={form.legalName} onChange={e=>setForm(f=>({...f,legalName:e.target.value}))} placeholder="e.g. CREO Arts, Inc." style={inp} disabled={!isAdmin||isReadOnly}/>

        <div style={lbl}>EIN</div>
        <input value={form.ein} onChange={e=>setForm(f=>({...f,ein:e.target.value}))} placeholder="XX-XXXXXXX" style={inp} disabled={!isAdmin||isReadOnly}/>

        <div style={lbl}>Receipt address</div>
        <textarea value={form.receiptAddress} onChange={e=>setForm(f=>({...f,receiptAddress:e.target.value}))} placeholder={"123 Main St\nAnytown, ST 00000"} rows={2} style={{...inp,resize:"vertical"}} disabled={!isAdmin||isReadOnly}/>

        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
          <div>
            <div style={lbl}>Signature name (optional)</div>
            <input value={form.receiptSignatureName} onChange={e=>setForm(f=>({...f,receiptSignatureName:e.target.value}))} placeholder="e.g. Jordan Lee" style={inp} disabled={!isAdmin||isReadOnly}/>
          </div>
          <div>
            <div style={lbl}>Signature title (optional)</div>
            <input value={form.receiptSignatureTitle} onChange={e=>setForm(f=>({...f,receiptSignatureTitle:e.target.value}))} placeholder="e.g. Executive Director" style={inp} disabled={!isAdmin||isReadOnly}/>
          </div>
        </div>

        <div style={lbl}>Custom message (optional)</div>
        <textarea value={form.receiptCustomMessage} onChange={e=>setForm(f=>({...f,receiptCustomMessage:e.target.value}))} placeholder="A warm line or two for {{donor_name}}, added to every receipt." rows={3} style={{...inp,resize:"vertical",marginBottom:6}} disabled={!isAdmin||isReadOnly}/>

        {!canEnable&&<div style={{fontSize:12,color:"#8a6d1f",background:"#f6eccf",borderRadius:8,padding:"8px 12px",marginBottom:12}}>Legal name, EIN, and receipt address are all required before receipts can be enabled.</div>}

        {saveErr&&<div style={{fontSize:12,color:"#8a3a24",background:"#f6e3dd",borderRadius:8,padding:"8px 12px",marginBottom:12}}>{saveErr}</div>}

        {isAdmin&&(
          <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
            <button onClick={()=>save()} disabled={saving||isReadOnly} title={isReadOnly?"Reactivate your subscription to make changes.":undefined}
              style={{background:T.greenDk,border:"none",borderRadius:8,padding:"9px 16px",color:"#fff",fontSize:12,fontWeight:700,cursor:(saving||isReadOnly)?"not-allowed":"pointer",opacity:(saving||isReadOnly)?0.6:1}}>
              {saving?"Saving…":"Save settings"}
            </button>
            <button onClick={()=>save(!form.receiptsEnabled)} disabled={saving||isReadOnly||(!form.receiptsEnabled&&!canEnable)}
              title={isReadOnly?"Reactivate your subscription to make changes.":(!form.receiptsEnabled&&!canEnable)?"Fill in legal name, EIN, and receipt address first.":undefined}
              style={{background:form.receiptsEnabled?"#f6e3dd":T.green,border:"1px solid "+(form.receiptsEnabled?"#eac6b8":T.green),borderRadius:8,padding:"9px 16px",color:form.receiptsEnabled?"#8a3a24":"#fff",fontSize:12,fontWeight:700,cursor:(saving||isReadOnly||(!form.receiptsEnabled&&!canEnable))?"not-allowed":"pointer",opacity:(saving||isReadOnly||(!form.receiptsEnabled&&!canEnable))?0.6:1}}>
              {form.receiptsEnabled?"Disable receipts":"Enable receipts"}
            </button>
            <button onClick={downloadPreview} disabled={previewLoading} style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"9px 16px",color:T.ink2,fontSize:12,fontWeight:600,cursor:previewLoading?"not-allowed":"pointer"}}>
              {previewLoading?"Generating…":"Preview receipt"}
            </button>
            {saveMsg&&<span style={{fontSize:12,color:"#1a6b4a",fontWeight:600}}>✓ {saveMsg}</span>}
          </div>
        )}
      </div>

      {isAdmin&&(
        <div style={{borderTop:"1px solid "+T.bg3,paddingTop:20}}>
          <SectionLabel>Year-End Giving Statements</SectionLabel>
          <div style={{fontSize:12,color:T.ink3,marginBottom:12,lineHeight:1.6}}>
            Generate a consolidated statement for every donor with a gift in the selected tax year. No automatic January run — trigger this deliberately each year.
          </div>
          <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap",marginBottom:12}}>
            <span style={{fontSize:11,fontWeight:700,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.06em"}}>Tax year</span>
            <input type="number" value={yearEndYear} onChange={e=>{setYearEndYear(e.target.value);setDryRunResult(null);setRunResult(null);}} style={{...inp,width:110,marginBottom:0}} disabled={!form.receiptsEnabled}/>
            <button onClick={runDryRun} disabled={dryRunLoading||!form.receiptsEnabled} style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"8px 14px",color:T.ink2,fontSize:12,fontWeight:600,cursor:(dryRunLoading||!form.receiptsEnabled)?"not-allowed":"pointer"}}>
              {dryRunLoading?"Checking…":"Dry run"}
            </button>
          </div>
          {!form.receiptsEnabled&&<div style={{fontSize:12,color:T.ink3}}>Enable tax receipts above first.</div>}
          {runErr&&<div style={{fontSize:12,color:"#8a3a24",background:"#f6e3dd",borderRadius:8,padding:"8px 12px",marginBottom:10}}>{runErr}</div>}
          {dryRunResult&&(
            <div style={{background:T.bg,borderRadius:10,padding:"12px 16px",marginBottom:12,fontSize:13,color:T.ink}}>
              <strong>{dryRunResult.donorCount}</strong> donor{dryRunResult.donorCount===1?"":"s"} · <strong>{dryRunResult.giftCount}</strong> gift{dryRunResult.giftCount===1?"":"s"} in {yearEndYear}
              {dryRunResult.missingEmailCount>0&&<span style={{color:"#8a6d1f"}}> · {dryRunResult.missingEmailCount} donor{dryRunResult.missingEmailCount===1?" has":"s have"} no email on file (statement generated but not sent)</span>}
              <div style={{marginTop:10}}>
                <button onClick={generateAndSend} disabled={runLoading} style={{background:T.greenDk,border:"none",borderRadius:8,padding:"9px 16px",color:"#fff",fontSize:12,fontWeight:700,cursor:runLoading?"not-allowed":"pointer"}}>
                  {runLoading?"Generating & sending…":"Generate & send"}
                </button>
              </div>
            </div>
          )}
          {runResult&&(
            <div style={{background:"#edf3ee",border:"1px solid #10b981",borderRadius:10,padding:"12px 16px",fontSize:13,color:"#1a6b4a"}}>
              ✓ Generated <strong>{runResult.generated}</strong> statement{runResult.generated===1?"":"s"}, emailed <strong>{runResult.emailed}</strong>{runResult.skipped>0?`, skipped ${runResult.skipped}`:""}.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Section tabs — one per former SecHead group. ids are stable and
// deep-linkable via navigateTo("settings",{section:id}) (App.jsx
// settingsIntent → initialSection prop), e.g. Communications' CAN-SPAM
// prompt lands directly on "receipts".

// ── BUILD-55 — the old PortalManager form (and its PortalThemePreview) is
// GONE, deliberately: everything appearance/content-editable moved into the
// in-portal editor's Design mode (client/src/pages/PortalEditor.jsx — edit
// what you see, where you see it). The status/listing switches it also
// carried (enabled, network_listed, directory card) live on the CRM's Donor
// Portal tab (DonorPortalHub.jsx). Every field has exactly ONE home — do not
// rebuild a second editing surface here.

// ── BUILD-49 entry point (e) — "put it on your website" snippet ─────────────
// A link and a button an org can paste into its own site, pointing donors at
// their giving account with from=<slug> (the cosmetic theming fragment — no
// donor data rides the URL). Shown only while the org is network-listed.
export function PortalWebsiteSnippet({ps}){
  const [copied,setCopied]=useState("");
  // Derive the canonical site base from the server-built portal_url so the
  // snippet always carries the same host the server links carry.
  const base=(ps.portal_url||"").replace(/\/portal\/.*$/,"")||"https://www.stewardapp.dev";
  const givingUrl=`${base}/giving#from=${ps.org_slug}`;
  const orgName=ps.display_name||"our organization";
  const linkHtml=`<a href="${givingUrl}">See your giving with ${orgName} — receipts, recurring gifts, and history</a>`;
  const buttonHtml=`<a href="${givingUrl}" style="display:inline-block;background:#0f1a12;color:#f0ede6;padding:10px 22px;border-radius:8px;font-family:sans-serif;font-size:14px;font-weight:600;text-decoration:none;">Your giving account</a>`;
  const copy=async(label,text)=>{
    try{await navigator.clipboard.writeText(text);setCopied(label);setTimeout(()=>setCopied(""),2000);}
    catch{/* clipboard blocked — the text is selectable below */}
  };
  const pre={fontFamily:"monospace",fontSize:11.5,background:T.white,border:"1px solid "+T.bg3,borderRadius:8,padding:"10px 12px",whiteSpace:"pre-wrap",wordBreak:"break-all",color:T.ink,margin:"6px 0 8px"};
  const copyBtn=(label,text)=>(
    <button onClick={()=>copy(label,text)} style={{background:T.bg2,border:"1px solid "+T.bg3,borderRadius:7,padding:"5px 12px",fontSize:12,fontWeight:600,color:T.ink,cursor:"pointer"}}>
      {copied===label?"Copied ✓":"Copy"}
    </button>
  );
  return(
    <div style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:10,padding:"14px 16px",marginBottom:16}}>
      <div style={{fontSize:12,fontWeight:700,color:T.ink,marginBottom:4}}>Put it on your website</div>
      <div style={{fontSize:12,color:T.ink3,lineHeight:1.5,marginBottom:10,maxWidth:560}}>
        Give your donors a way to reach their giving account from your own site — history, receipts,
        and recurring gifts. The link carries your organization's name so the sign-up page greets
        them with it; it never carries any donor information.
      </div>
      <div style={lblCopy}>Text link</div>
      <div style={pre}>{linkHtml}</div>
      {copyBtn("link",linkHtml)}
      <div style={{...lblCopy,marginTop:14}}>Button</div>
      <div style={pre}>{buttonHtml}</div>
      {copyBtn("button",buttonHtml)}
      <div style={{...lblCopy,marginTop:14}}>Preview</div>
      <div style={{background:T.white,border:"1px dashed "+T.bg3,borderRadius:8,padding:"14px 16px",margin:"6px 0 2px"}}>
        <div style={{marginBottom:10}}>
          <a href={givingUrl} target="_blank" rel="noreferrer" style={{color:T.greenDk,fontSize:13}}>See your giving with {orgName} — receipts, recurring gifts, and history</a>
        </div>
        <a href={givingUrl} target="_blank" rel="noreferrer" style={{display:"inline-block",background:T.ink,color:T.bg,padding:"10px 22px",borderRadius:8,fontSize:14,fontWeight:600,textDecoration:"none"}}>Your giving account</a>
      </div>
      <div style={{fontSize:12,color:T.ink3,marginTop:10,display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
        <span>Your donor portal (this organization only):</span>
        <a href={ps.portal_url} target="_blank" rel="noreferrer" style={{display:"inline-block",background:T.bg2,border:"1px solid "+T.bg3,borderRadius:8,padding:"7px 14px",color:T.ink,fontSize:12,fontWeight:700,textDecoration:"none"}}>Open donor portal ↗</a>
      </div>
    </div>
  );
}
const lblCopy={fontSize:11,fontWeight:700,color:"#6b6b64",textTransform:"uppercase",letterSpacing:"0.07em"};

// The snippet renders in the Donor Portal hub now (a share/links artifact);
// this gate keeps the enabled+listed+slug rule in ONE place (pinned by
// tests/donor-front-door.test.js — unlisted orgs' donors never see any
// giving-account entry point, including on the org's own site).
export function PortalWebsiteSnippetCard({ps}){
  if(!ps)return null;
  return <>{ps.enabled===true&&ps.network_listed===true&&ps.org_slug&&<PortalWebsiteSnippet ps={ps}/>}</>;
}

// Impact Updates (§6.1) — what donors see in "What your giving made possible".
// Attached to funds/campaigns; matching is deterministic on gift attribution.
export function ImpactUpdatesManager({isAdmin,isReadOnly}){
  const [rows,setRows]=useState([]);
  const [funds,setFunds]=useState([]);
  const [camps,setCamps]=useState([]);
  const [form,setForm]=useState(null); // null | {id?,title,body,photos,photoCrops,targets,orgWide}
  const [cropIdx,setCropIdx]=useState(null); // which photo's crop is open (BUILD-65 Part 3)
  const [busy,setBusy]=useState(false);
  const [err,setErr]=useState("");
  const disabled=!isAdmin||isReadOnly;
  const load=()=>{
    apiFetch("/impact-updates").then(setRows).catch(()=>{});
    apiFetch("/finance/funds").then(f=>setFunds(Array.isArray(f)?f:[])).catch(()=>{});
    apiFetch("/fundraising/campaigns").then(c=>setCamps(Array.isArray(c)?c:[])).catch(()=>{});
  };
  useEffect(()=>{load();},[]);
  const inp={width:"100%",boxSizing:"border-box",background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"9px 12px",color:T.ink,fontSize:13,outline:"none",fontFamily:"inherit"};
  const lbl={fontSize:11,fontWeight:700,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:6};
  async function save(){
    if(disabled||busy||!form?.title?.trim())return;
    setBusy(true);setErr("");
    try{
      const body=JSON.stringify({title:form.title,body:form.body||"",photos:form.photos||[],
        photoCrops:form.photoCrops||[],targets:form.targets||[],orgWide:form.orgWide===true});
      if(form.id)await apiFetch(`/impact-updates/${form.id}`,{method:"PUT",body});
      else await apiFetch("/impact-updates",{method:"POST",body});
      setForm(null);load();
    }catch(e){setErr(e.message||"Could not save.");}
    setBusy(false);
  }
  const toggleTarget=(kind,id)=>setForm(fm=>{
    const targets=fm.targets||[];
    const has=targets.some(t=>t.kind===kind&&t.id===id);
    return {...fm,targets:has?targets.filter(t=>!(t.kind===kind&&t.id===id)):[...targets,{kind,id}]};
  });
  return(
    <div style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:16,padding:"24px 28px",marginTop:18}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <SectionLabel>Impact Updates</SectionLabel>
        {isAdmin&&!form&&<button onClick={()=>{setCropIdx(null);setForm({title:"",body:"",photos:[],photoCrops:[],targets:[],orgWide:false});}} disabled={disabled}
          style={{background:disabled?T.bg3:T.gold500,border:"none",borderRadius:9,padding:"8px 16px",color:T.ink,fontSize:13,fontWeight:700,cursor:disabled?"not-allowed":"pointer"}}>+ New update</button>}
      </div>
      <div style={{fontSize:13,color:T.ink3,lineHeight:1.6,marginTop:6,marginBottom:14,maxWidth:600}}>
        Short updates donors see in their portal. Attach one to a fund or campaign and it shows to donors
        who gave there in the last two years; org-wide updates show to everyone. A donor who gave to the
        food bank fund sees food bank updates — that's the whole feature.
      </div>
      {form&&(
        <div style={{border:"1px solid "+T.bg3,borderRadius:12,padding:16,marginBottom:16}}>
          <div style={lbl}>Title</div>
          <input style={inp} value={form.title} onChange={e=>setForm(f=>({...f,title:e.target.value}))} placeholder="Food bank served 400 families this spring"/>
          <div style={{...lbl,marginTop:12}}>Story</div>
          <textarea style={{...inp,minHeight:90,resize:"vertical",lineHeight:1.6}} value={form.body} onChange={e=>setForm(f=>({...f,body:e.target.value}))}/>
          <div style={{...lbl,marginTop:12}}>Photos</div>
          <div style={{maxWidth:400,marginTop:2}}>
            {/* Multi-photo site: the photos array is not a single preview, so the
                thumbnail strip renders as children and the zone stays the drop target.
                BUILD-65 Part 3 — each photo carries an aligned non-destructive crop;
                adding/removing a photo keeps photoCrops index-aligned. */}
            <Uploader accept={IMAGE_ACCEPT} acceptLabel={IMAGE_ACCEPT_LABEL} maxBytes={IMAGE_MAX_BYTES} compact multiple
              label="Drag photos here, or browse"
              hint={"Up to 4 photos · "+IMAGE_ACCEPT_LABEL}
              disabled={(form.photos||[]).length>=4}
              onFile={({dataUrl})=>setForm(fm=>({...fm,photos:[...(fm.photos||[]),dataUrl].slice(0,4),photoCrops:[...(fm.photoCrops||[]),null].slice(0,4)}))}>
              {(form.photos||[]).length>0&&(
                <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap",marginTop:8}}>
                  {(form.photos||[]).map((p,i)=>(
                    <div key={i} style={{position:"relative"}}>
                      <img src={resolveAssetUrl(p)} alt="" style={{height:56,borderRadius:8,cursor:"pointer",outline:cropIdx===i?("2px solid "+T.gold500):"none"}}
                        title="Crop this photo" onClick={()=>setCropIdx(ci=>ci===i?null:i)}/>
                      <button onClick={()=>{setForm(f=>({...f,photos:f.photos.filter((_,j)=>j!==i),photoCrops:(f.photoCrops||[]).filter((_,j)=>j!==i)}));setCropIdx(null);}}
                        style={{position:"absolute",top:-6,right:-6,background:T.ink,color:T.bg,border:"none",borderRadius:"50%",width:18,height:18,fontSize:10,cursor:"pointer",lineHeight:1}}>✕</button>
                    </div>
                  ))}
                </div>
              )}
            </Uploader>
            {(form.photos||[]).length>0&&<div style={{fontSize:11,color:T.ink3,marginTop:6}}>Tap a photo to crop it — this preview is exactly what donors see.</div>}
          </div>
          {/* The crop editor for the selected photo — same PortalBannerCrop the
              banner uses, at the impact ratio, so preview == render. */}
          {cropIdx!=null && (form.photos||[])[cropIdx] && (
            <div style={{maxWidth:420,marginTop:10}}>
              <PortalBannerCrop
                url={String((form.photos||[])[cropIdx]).startsWith("data:")?(form.photos||[])[cropIdx]:resolveAssetUrl((form.photos||[])[cropIdx])}
                crop={(form.photoCrops||[])[cropIdx]||null}
                ratio={PORTAL_IMPACT_PHOTO_RATIO}
                onChange={(c)=>setForm(f=>{const pc=[...(f.photoCrops||[])];while(pc.length<f.photos.length)pc.push(null);pc[cropIdx]=c;return {...f,photoCrops:pc};})} />
            </div>
          )}
          <div style={{...lbl,marginTop:12}}>Shows to donors who gave to</div>
          <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
            {funds.map(f=>(
              <button key={f.id} onClick={()=>toggleTarget("fund",f.id)}
                style={{border:"1px solid "+((form.targets||[]).some(t=>t.id===f.id)?T.greenDk:T.bg3),background:(form.targets||[]).some(t=>t.id===f.id)?T.green100:T.bg,borderRadius:20,padding:"5px 12px",fontSize:12,cursor:"pointer"}}>{f.name}</button>
            ))}
            {camps.map(c=>(
              <button key={c.id} onClick={()=>toggleTarget("campaign",c.id)}
                style={{border:"1px solid "+((form.targets||[]).some(t=>t.id===c.id)?T.greenDk:T.bg3),background:(form.targets||[]).some(t=>t.id===c.id)?T.green100:T.bg,borderRadius:20,padding:"5px 12px",fontSize:12,cursor:"pointer"}}>{c.name}</button>
            ))}
          </div>
          <label style={{display:"flex",alignItems:"center",gap:8,fontSize:13,color:T.ink3,marginTop:10}}>
            <input type="checkbox" checked={form.orgWide===true} onChange={e=>setForm(f=>({...f,orgWide:e.target.checked}))}/>
            Also show org-wide (every portal donor)
          </label>
          <div style={{display:"flex",gap:8,marginTop:14}}>
            <button onClick={save} disabled={busy||!form.title.trim()}
              style={{background:T.gold500,border:"none",borderRadius:9,padding:"9px 16px",color:T.ink,fontSize:13,fontWeight:700,cursor:"pointer"}}>{busy?"Saving…":form.id?"Save changes":"Publish update"}</button>
            <button onClick={()=>setForm(null)} style={{background:"none",border:"1px solid "+T.bg3,borderRadius:9,padding:"9px 16px",fontSize:13,cursor:"pointer",color:T.ink}}>Cancel</button>
          </div>
        </div>
      )}
      {rows.length===0&&!form&&<div style={{fontSize:13,color:T.ink3}}>No impact updates yet — the first one you publish shows up in your donors' portals.</div>}
      {rows.map(u=>(
        <div key={u.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 0",borderBottom:"1px solid "+T.bg2}}>
          <div>
            <div style={{fontSize:14,fontWeight:700,color:T.ink}}>{u.title}</div>
            <div style={{fontSize:12,color:T.ink3}}>
              {u.org_wide?"Org-wide":`${(Array.isArray(u.targets)?u.targets.length:0)} target${(Array.isArray(u.targets)?u.targets.length:0)===1?"":"s"}`} · {String(u.created_at).slice(0,10)}
            </div>
          </div>
          {isAdmin&&<div style={{display:"flex",gap:8}}>
            <button onClick={()=>{setCropIdx(null);setForm({id:u.id,title:u.title,body:u.body||"",photos:Array.isArray(u.photos)?u.photos:[],photoCrops:Array.isArray(u.photo_crops)?u.photo_crops:[],targets:Array.isArray(u.targets)?u.targets:[],orgWide:u.org_wide===true});}}
              style={{background:"none",border:"1px solid "+T.bg3,borderRadius:8,padding:"5px 12px",fontSize:12,cursor:"pointer",color:T.ink}}>Edit</button>
            <button onClick={async()=>{if(confirm("Delete this impact update?")){await apiFetch(`/impact-updates/${u.id}`,{method:"DELETE"});load();}}}
              style={{background:"none",border:"1px solid "+T.terra200,borderRadius:8,padding:"5px 12px",fontSize:12,cursor:"pointer",color:T.terra700}}>Delete</button>
          </div>}
        </div>
      ))}
    </div>
  );
}

const SETTINGS_TABS=[
  {id:"org",label:"Organization"},
  {id:"team",label:"Team"},
  {id:"integrations",label:"Integrations"},
  {id:"giving",label:"Giving Pages"},
  {id:"customization",label:"Customization"},
  {id:"portal",label:"Donor Portal"},
  {id:"receipts",label:"Tax Receipts"},
  {id:"data",label:"Your Data"},
  {id:"account",label:"Account"},
];

export function Settings({auth,logout,initialSection,onNavigate}) {
  const [section,setSection]=useState(SETTINGS_TABS.some(t=>t.id===initialSection)?initialSection:"org");
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

  // BUILD-78 — one list per entity; archive/restore, never delete; type
  // immutable after creation (the modal says so instead of hiding it).
  const [customFields,setCustomFields]=useState({donor:[],gift:[]});
  const [cfEntity,setCfEntity]=useState("donor");
  const [cfShowArchived,setCfShowArchived]=useState(false);
  const [showAddField,setShowAddField]=useState(false);
  const [editingField,setEditingField]=useState(null);
  const [cfForm,setCfForm]=useState({label:"",type:"text",options:[]});
  const [cfOptInput,setCfOptInput]=useState("");
  const [cfSaving,setCfSaving]=useState(false);
  async function reloadCf(entity){
    try{
      const rows=await apiFetch(`/custom-fields?entity=${entity}&includeArchived=1`);
      setCustomFields(prev=>({...prev,[entity]:Array.isArray(rows)?rows:[]}));
    }catch{/* section renders empty */}
  }

  const [impactMetrics,setImpactMetrics]=useState([]);
  const [showAddMetric,setShowAddMetric]=useState(false);
  const [editingMetric,setEditingMetric]=useState(null);
  const [imForm,setImForm]=useState({name:"",dollarThreshold:"",outcomeTemplate:""});
  const [imSaving,setImSaving]=useState(false);

  const [billing,setBilling]=useState(null);
  const [impact,setImpact]=useState(null);
  const [impactOpen,setImpactOpen]=useState(false);
  const [portalLoading,setPortalLoading]=useState(false);

  // BUILD-36 A4 — per-user email notification toggles (default on).
  const [notifyPrefs,setNotifyPrefs]=useState(null);
  const [notifySaving,setNotifySaving]=useState("");
  async function toggleNotifyPref(key){
    if(!notifyPrefs) return;
    const next={...notifyPrefs,[key]:!notifyPrefs[key]};
    setNotifyPrefs(next); setNotifySaving(key);
    try{ const r=await apiFetch("/me/notification-prefs",{method:"PUT",body:JSON.stringify({[key]:next[key]})}); if(r?.notifications) setNotifyPrefs(r.notifications); }
    catch{ setNotifyPrefs(notifyPrefs); } // rollback
    finally{ setNotifySaving(""); }
  }
  const [portalError,setPortalError]=useState("");
  const [portalUrl,setPortalUrl]=useState("");   // fallback link when the pop-up is blocked
  const [upgradeModal,setUpgradeModal]=useState(null);
  const isReadOnly=billing?.accessState==="read_only";

  const [gmailStatus,setGmailStatus]=useState(null);
  const [gmailSyncing,setGmailSyncing]=useState(false);
  const [gmailToast,setGmailToast]=useState("");

  const [sampleStatus,setSampleStatus]=useState(null);
  const [sampleLoading,setSampleLoading]=useState(false);
  const [sampleClearing,setSampleClearing]=useState(false);
  const [exporting,setExporting]=useState(false);
  const [exportingCsv,setExportingCsv]=useState(false);

  useEffect(()=>{
    apiFetch("/org/team").then(setTeam).catch(()=>{});
    apiFetch("/stripe/status").then(setStripe).catch(()=>{});
    apiFetch("/billing/status").then(setBilling).catch(()=>{});
    apiFetch("/me").then(r=>{ if(r?.notifications) setNotifyPrefs(r.notifications); }).catch(()=>{});
    apiFetch("/impact").then(setImpact).catch(()=>{});
    if(!auth?.org?.org_slug){
      apiFetch("/org").then(r=>{ if(r.org_slug) setOrgSlug(r.org_slug); }).catch(()=>{});
    }
    reloadCf("donor");reloadCf("gift");
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
    // Open the portal in a NEW TAB so Settings stays put, and ALWAYS reset the
    // loading state (the old same-tab redirect left the button stuck on
    // "Opening…" whenever the nav didn't happen). Pop-up-blocked and error cases
    // surface a clear message + a direct fallback link / retry (BUILD-31 Part 1).
    setPortalLoading(true); setPortalError(""); setPortalUrl("");
    try{
      const r=await apiFetch("/billing/create-portal",{method:"POST"});
      const w=window.open(r.url,"_blank","noopener,noreferrer");
      if(!w){ setPortalUrl(r.url); setPortalError("Your browser blocked the pop-up. Allow pop-ups for this site, or open the portal directly:"); }
    }catch(e){ setPortalError(billingErrorMessage(e, "Couldn't open the billing portal. Please try again.")); }
    finally{ setPortalLoading(false); }
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

  async function exportCsv(){
    setExportingCsv(true);
    try{
      const r=await fetch(`${API}/org/export/csv`,{headers:{Authorization:`Bearer ${getToken()}`}});
      if(!r.ok){const e=await r.json().catch(()=>({}));throw new Error(e.error||"Export failed");}
      const blob=await r.blob();
      const url=URL.createObjectURL(blob);
      const a=document.createElement("a");
      a.href=url; a.download=`steward-export-${new Date().toISOString().split("T")[0]}.zip`;
      document.body.appendChild(a); a.click();
      document.body.removeChild(a); URL.revokeObjectURL(url);
    }catch(e){alert(e.message||"Export failed");}
    setExportingCsv(false);
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
    setCfForm({label:"",type:"text",options:[]});
    setCfOptInput("");
    setShowAddField(true);
  }

  function openEditField(f){
    setEditingField(f);
    setCfForm({label:f.label,type:f.type,options:Array.isArray(f.options)?f.options:[]});
    setCfOptInput("");
    setShowAddField(true);
  }

  function closeCfModal(){
    setShowAddField(false);setEditingField(null);
    setCfForm({label:"",type:"text",options:[]});
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
        await apiFetch(`/custom-fields/${editingField.id}`,{method:"PUT",body:JSON.stringify({label:cfForm.label,options:cfForm.options})});
      }else{
        await apiFetch("/custom-fields",{method:"POST",body:JSON.stringify({entity:cfEntity,label:cfForm.label,type:cfForm.type,options:cfForm.options})});
      }
      await reloadCf(cfEntity);
      closeCfModal();
    }catch(e){alert(e.message||"Failed to save field");}
    setCfSaving(false);
  }

  // Archive hides a field from the record, the mapper and the export, and
  // destroys nothing; restore brings every value back. There is no delete.
  async function archiveCfField(f){
    try{await apiFetch(`/custom-fields/${f.id}/archive`,{method:"POST"});await reloadCf(f.entity);}
    catch(e){alert(e.message||"Failed to archive field");}
  }
  async function restoreCfField(f){
    try{await apiFetch(`/custom-fields/${f.id}/restore`,{method:"POST"});await reloadCf(f.entity);}
    catch(e){alert(e.message||"Failed to restore field");}
  }
  async function moveCfField(f,dir){
    const live=customFields[f.entity].filter(x=>!x.archivedAt);
    const i=live.findIndex(x=>x.id===f.id);
    const j=i+dir;
    if(i<0||j<0||j>=live.length)return;
    const ids=live.map(x=>x.id);
    [ids[i],ids[j]]=[ids[j],ids[i]];
    try{await apiFetch("/custom-fields/reorder",{method:"PUT",body:JSON.stringify({entity:f.entity,ids})});await reloadCf(f.entity);}
    catch(e){alert(e.message||"Failed to reorder");}
  }

  const CF_TYPE_LABELS={text:"Text",long_text:"Long text",number:"Number",money:"Money",date:"Date",select:"Select",multi_select:"Multi-select",checkbox:"Yes/No"};

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

  return(
    <div style={{display:"flex",flexDirection:"column",gap:20}}>
      <PageTitle main="Workspace" accent="settings."/>
      {/* Value-first landing (BUILD-31 Part 2.1): the first thing an org sees is
          what Steward has done for them, not a near-empty Organization card.
          Honest numbers only — forward-looking copy when there's nothing yet. */}
      {impact&&(()=>{
        // BUILD-73 Part 3 — this banner leads with MONEY AT RISK, not with
        // anything Steward claims to have done. The value math describes the
        // size of the problem; it never describes Steward's results. Same
        // vocabulary as the Home hero and the landing page, on purpose.
        const atRisk=impact.atRiskAmount||0;
        const quiet=impact.quietDonorCount||0;
        const watching=impact.watchingRecurringCount||0;
        const clauses=[];
        if(atRisk>0&&quiet>0)clauses.push(<><strong style={{color:T.ink}}>{fmt(atRisk)}</strong> at risk across <strong style={{color:T.ink}}>{quiet.toLocaleString()}</strong> quiet donor{quiet===1?"":"s"}</>);
        let msg;
        if(clauses.length){
          msg=<>{clauses.map((c,i)=><span key={i}>{i>0?(i===clauses.length-1?" and ":", "):""}{c}</span>)} — no gift in over {quietPhrase(impact.quietSinceDays)}. <strong style={{color:T.ink}}>No platform fee and no donor tip</strong>; gifts settle in your own Stripe.</>;
        }else if(watching>0){
          msg=<>Steward is watching <strong style={{color:T.ink}}>{watching}</strong> recurring gift{watching===1?"":"s"} for failed cards — <strong style={{color:T.ink}}>no platform fee, no donor tip</strong>; gifts settle in your own Stripe.</>;
        }else{
          msg=<><strong style={{color:T.ink}}>No platform fee, no donor tip</strong> — your gifts settle in your own Stripe. Your at-risk giving appears here as donors go quiet.</>;
        }
        return (
          <div style={{background:T.white,border:"1px solid "+T.bg3,borderLeft:"3px solid "+T.gold500,borderRadius:12,padding:"12px 16px",display:"flex",alignItems:"center",gap:10}}>
            <span aria-hidden style={{color:T.gold500,fontSize:14,lineHeight:1}}>◈</span>
            <span style={{flex:1,fontSize:13,color:T.ink2,lineHeight:1.5}}>{msg}</span>
          </div>
        );
      })()}
      <SectionTabs className="settings-tabbar" style={{marginBottom:-2}} tabs={SETTINGS_TABS} active={section} onSelect={id=>{if(confirmIfDirty())setSection(id);}}/>

      {/* ── Organization ──────────────────────────────────────────────────── */}
      {section==="org"&&<div style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:16,padding:"24px 28px"}}>
        <SectionLabel>Your Account</SectionLabel>
        <div style={{display:"flex",alignItems:"center",gap:16,marginBottom:20}}>
          <div style={{width:52,height:52,borderRadius:"50%",background:T.greenDk+"18",border:"2px solid "+T.greenDk+"40",display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,fontWeight:700,color:T.greenDk,flexShrink:0}}>
            {(userName[0]||"U").toUpperCase()}
          </div>
          <div>
            <div style={{fontSize:18,fontWeight:700,color:T.ink,letterSpacing:"-0.01em"}}>{userName}</div>
            <div style={{fontSize:13,color:T.ink3,marginTop:2}}>{userEmail}</div>
            <div style={{marginTop:6}}><Pill label={userRole} color={userRole==="admin"?T.greenDk:"#6b6560"}/></div>
          </div>
        </div>
        <div style={{background:T.bg,borderRadius:10,padding:"14px 16px"}}>
          <div style={{fontSize:11,fontWeight:700,color:T.ink3,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:6}}>Organization</div>
          <div style={{fontSize:15,fontWeight:700,color:T.ink}}>{orgName}</div>
          {auth?.org?.mission&&<div style={{fontSize:12,color:T.ink3,marginTop:4,lineHeight:1.5}}>{auth.org.mission}</div>}
        </div>
      </div>}

      {/* ── Branding — merged into the Organization tab (BUILD-31 Part 2.4) ── */}
      {section==="org"&&<div style={{marginTop:16}}><BrandingManager orgId={auth?.org?.id} isAdmin={isAdmin} isReadOnly={isReadOnly}/></div>}

      {/* ── Team ──────────────────────────────────────────────────────────── */}
      {section==="team"&&<div style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:16,padding:"24px 28px"}}>
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
            <Pill label={m.role} color={m.role==="admin"?T.greenDk:"#6b6560"}/>
            {auth?.user?.role==="admin"&&m.id!==auth?.user?.id&&(
              /* BUILD-75 C.3 — soft-detach: revokes their sessions, frees their
                 seat, unassigns their portfolio; everything they authored keeps
                 their name. Quiet terracotta outline per the destructive-action
                 convention. */
              <button onClick={async()=>{
                if(!window.confirm(`Remove ${m.name||m.email} from the organization? Their sign-in stops working immediately; everything they logged keeps their name. Their assigned donors return to the Directory unassigned.`))return;
                try{
                  await apiFetch(`/users/${m.id}`,{method:"DELETE"});
                  setTeam(t=>t.filter(x=>x.id!==m.id));
                }catch(e){ alert(e.message||"Couldn't remove this person"); }
              }} style={{fontSize:12,padding:"5px 12px",borderRadius:8,border:"1px solid "+T.terra200,background:"transparent",color:T.terra700,cursor:"pointer",flexShrink:0}}>
                Remove
              </button>
            )}
          </div>
        ))}
        {team.length===0&&<div style={{fontSize:13,color:T.ink3}}>Loading…</div>}
      </div>}

      {/* ── Integrations ──────────────────────────────────────────────────── */}
      {section==="integrations"&&<>
      <div style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:16,padding:"24px 28px"}}>
        <SectionLabel>Payments</SectionLabel>
        {stripe?.connected?(
          <div style={{display:"flex",alignItems:"center",gap:14,flexWrap:"wrap"}}>
            <div style={{display:"flex",alignItems:"center",gap:8,background:"#edf3ee",border:"1px solid #dce7df",borderRadius:10,padding:"10px 16px"}}>
              <div>
                <div style={{fontSize:13,fontWeight:700,color:"#0d5c3a"}}>Stripe Connected</div>
                <div style={{fontSize:11,color:"#0d5c3a",marginTop:1}}>Account: {stripe.accountId}</div>
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
        <div style={{marginBottom:14}}>
          <UrlLinkButtons url={donationUrl}/>
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

      <div style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:16,padding:"24px 28px"}}>
        <SectionLabel>Gmail</SectionLabel>
        <div style={{fontSize:13,color:T.ink3,marginBottom:16,lineHeight:1.5}}>Sync donor emails automatically to your interaction timeline.</div>
        <div style={{display:"flex",alignItems:"center",gap:16,padding:"16px",background:T.bg,borderRadius:12,border:"1px solid "+T.bg3,flexWrap:"wrap"}}>
          <div style={{width:40,height:40,borderRadius:10,background:"#fff",border:"1px solid "+T.bg3,display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,flexShrink:0}}>
            @
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
                <div style={{display:"flex",alignItems:"center",gap:5,background:"#edf3ee",border:"1px solid #dce7df",borderRadius:8,padding:"5px 10px"}}>
                  <div style={{width:7,height:7,borderRadius:"50%",background:"#1e6b45"}}/>
                  <span style={{fontSize:12,fontWeight:600,color:"#0d5c3a"}}>Connected</span>
                </div>
                <button onClick={syncGmailNow} disabled={gmailSyncing}
                  style={{background:T.green,border:"none",borderRadius:8,padding:"7px 14px",color:"#fff",fontSize:12,fontWeight:700,cursor:gmailSyncing?"not-allowed":"pointer",opacity:gmailSyncing?0.7:1}}>
                  {gmailSyncing?"Syncing…":"Sync now"}
                </button>
                <button onClick={disconnectGmail}
                  style={{background:"transparent",border:"none",fontSize:12,color:"#8a3a24",cursor:"pointer",fontWeight:500,padding:"7px 4px"}}>
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
          <div style={{marginTop:12,background:"#edf3ee",border:"1px solid #dce7df",borderRadius:8,padding:"10px 14px",fontSize:13,color:"#0d5c3a",fontWeight:600}}>
            ✓ {gmailToast}
          </div>
        )}
      </div>
      </>}

      {/* ── Giving Pages ──────────────────────────────────────────────────── */}
      {section==="giving"&&<>
        <TimezoneCard orgId={auth?.org?.id} isAdmin={isAdmin} isReadOnly={isReadOnly}/>
        <CoverFeesCard orgId={auth?.org?.id} isAdmin={isAdmin}/>
        <GivingPagesManager orgSlug={orgSlug} isAdmin={isAdmin} isReadOnly={isReadOnly}/>
      </>}

      {/* ── Donor Portal — moved to its own top-level section (BUILD-54 §3).
          One home only: this tab is a pointer, never a second editor. */}
      {section==="portal"&&(
        <div style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:16,padding:"24px 28px"}}>
          <SectionLabel>Donor Portal</SectionLabel>
          <div style={{fontSize:13,color:T.ink3,lineHeight:1.6,marginTop:6,marginBottom:16,maxWidth:560}}>
            The Donor Portal has its own home now — portal status, theme, impact updates, and
            engagement all live under <strong style={{color:T.ink2}}>Donor Portal</strong> in the left navigation.
          </div>
          <button onClick={()=>onNavigate&&onNavigate("portal")}
            style={{background:T.gold500,border:"none",borderRadius:9,padding:"10px 18px",color:T.ink,fontSize:13,fontWeight:700,cursor:"pointer"}}>
            Open Donor Portal →
          </button>
        </div>
      )}

      {/* ── Customization ─────────────────────────────────────────────────── */}
      {section==="customization"&&<>
      <div style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:16,padding:"24px 28px"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
          <SectionLabel>Custom Fields</SectionLabel>
          {isAdmin&&<button onClick={openAddField} disabled={isReadOnly} title={isReadOnly?"Reactivate your subscription to make changes.":undefined} style={{background:T.green,border:"none",borderRadius:8,padding:"7px 14px",color:"#fff",fontSize:12,fontWeight:700,cursor:isReadOnly?"not-allowed":"pointer",opacity:isReadOnly?0.45:1}}>+ Add Field</button>}
        </div>
        {/* Purpose + example + payoff (BUILD-31 Part 3): make the value obvious. */}
        <div style={{fontSize:12.5,color:T.ink3,marginBottom:14,lineHeight:1.6,background:T.bg,border:"1px solid "+T.bg3,borderRadius:10,padding:"10px 12px"}}>
          Extra data specific to your org — e.g. <strong style={{color:T.ink2}}>Board Connection</strong>, <strong style={{color:T.ink2}}>Matching Employer</strong>, or a gift's <strong style={{color:T.ink2}}>Appeal Code</strong>. Fields show on <strong style={{color:T.ink2}}>each record</strong>, can be filled by <strong style={{color:T.ink2}}>imports</strong>, and each is a column in your <strong style={{color:T.ink2}}>CSV export</strong>.
        </div>
        <div style={{display:"flex",gap:6,marginBottom:12}}>
          {["donor","gift"].map(en=>(
            <button key={en} onClick={()=>setCfEntity(en)}
              style={{background:cfEntity===en?T.green:T.bg,border:"1px solid "+(cfEntity===en?T.green:T.bg3),borderRadius:8,padding:"6px 14px",fontSize:12,fontWeight:700,color:cfEntity===en?"#fff":T.ink2,cursor:"pointer"}}>
              {en==="donor"?"Donor fields":"Gift fields"}
            </button>
          ))}
        </div>
        {(()=>{
          const live=customFields[cfEntity].filter(f=>!f.archivedAt);
          const archived=customFields[cfEntity].filter(f=>!!f.archivedAt);
          return <>
            {live.length===0&&<div style={{fontSize:12.5,color:T.ink3,padding:"8px 0"}}>No {cfEntity} fields yet.{isAdmin?" Add your first above.":""}</div>}
            {live.map((f,i)=>(
              <div key={f.id}
                style={{display:"flex",alignItems:"center",gap:12,padding:"11px 0 11px 10px",borderBottom:i<live.length-1?"1px solid "+T.bg3:"none",borderLeft:"3px solid "+T.bg3,transition:"border-color 0.15s",marginLeft:-10}}
                onMouseEnter={e=>e.currentTarget.style.borderLeftColor=T.greenDk}
                onMouseLeave={e=>e.currentTarget.style.borderLeftColor=T.bg3}>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:13,fontWeight:600,color:T.ink}}>{f.label}</div>
                  <div style={{fontSize:11,color:T.ink3,marginTop:2}}>{CF_TYPE_LABELS[f.type]||f.type}{(f.type==="select"||f.type==="multi_select")&&f.options?.length?` — ${f.options.slice(0,8).join(", ")}${f.options.length>8?` (+${f.options.length-8} more)`:""}`:""}
                    {f.createdSource&&f.createdSource!=="legacy-migration"?` · created during ${f.createdSource}${f.createdByName?` by ${f.createdByName}`:""}`:""}
                  </div>
                </div>
                {isAdmin&&<div style={{display:"flex",gap:6,flexShrink:0}}>
                  <button onClick={()=>moveCfField(f,-1)} disabled={i===0} style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:6,padding:"5px 8px",fontSize:11,color:T.ink2,cursor:i===0?"default":"pointer",opacity:i===0?0.4:1}}>↑</button>
                  <button onClick={()=>moveCfField(f,1)} disabled={i===live.length-1} style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:6,padding:"5px 8px",fontSize:11,color:T.ink2,cursor:i===live.length-1?"default":"pointer",opacity:i===live.length-1?0.4:1}}>↓</button>
                  <button onClick={()=>openEditField(f)} style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:6,padding:"5px 10px",fontSize:11,fontWeight:600,color:T.ink2,cursor:"pointer"}}>Edit</button>
                  <button onClick={()=>archiveCfField(f)} style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:6,padding:"5px 10px",fontSize:11,fontWeight:600,color:T.ink2,cursor:"pointer"}}
                    title="Hides this field from records, imports and exports. Every saved value is kept and comes back if you restore the field.">Archive</button>
                </div>}
              </div>
            ))}
            {archived.length>0&&(
              <div style={{marginTop:14}}>
                <button onClick={()=>setCfShowArchived(v=>!v)} style={{background:"none",border:"none",padding:0,fontSize:12,fontWeight:600,color:T.ink3,cursor:"pointer"}}>
                  {cfShowArchived?"▾":"▸"} Archived ({archived.length})
                </button>
                {cfShowArchived&&archived.map(f=>(
                  <div key={f.id} style={{display:"flex",alignItems:"center",gap:12,padding:"9px 0 9px 10px",marginLeft:-10,borderLeft:"3px solid "+T.bg3,opacity:0.7}}>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:13,fontWeight:600,color:T.ink2}}>{f.label}</div>
                      <div style={{fontSize:11,color:T.ink3,marginTop:2}}>{CF_TYPE_LABELS[f.type]||f.type} · archived — values kept</div>
                    </div>
                    {isAdmin&&<button onClick={()=>restoreCfField(f)} style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:6,padding:"5px 10px",fontSize:11,fontWeight:600,color:T.ink2,cursor:"pointer",flexShrink:0}}>Restore</button>}
                  </div>
                ))}
              </div>
            )}
          </>;
        })()}
      </div>

      {/* ── Impact Metrics ────────────────────────────────────────────────── */}
      <div style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:16,padding:"24px 28px"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
          <SectionLabel>Impact Metrics</SectionLabel>
          {isAdmin&&<button onClick={openAddMetric} disabled={isReadOnly} title={isReadOnly?"Reactivate your subscription to make changes.":undefined} style={{background:T.green,border:"none",borderRadius:8,padding:"7px 14px",color:"#fff",fontSize:12,fontWeight:700,cursor:isReadOnly?"not-allowed":"pointer",opacity:isReadOnly?0.45:1}}>+ Add Metric</button>}
        </div>
        {/* Purpose + example + payoff (BUILD-31 Part 3): make the value obvious. */}
        <div style={{fontSize:12.5,color:T.ink3,marginBottom:14,lineHeight:1.6,background:T.bg,border:"1px solid "+T.bg3,borderRadius:10,padding:"10px 12px"}}>
          Turn a donor's cumulative giving into a concrete outcome — e.g. <strong style={{color:T.ink2}}>"$100 = 40 meals served"</strong> or <strong style={{color:T.ink2}}>"$250 = a week of after-school tutoring"</strong>. These appear in <strong style={{color:T.ink2}}>milestone thank-you emails</strong> and each donor's <strong style={{color:T.ink2}}>Impact Summary PDF</strong>, so a major donor sees exactly what their giving funded.{impactMetrics.length===0?" Add your first below.":""}
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
              <button onClick={()=>deleteImMetric(m.id)} style={{background:"#f6e3dd",border:"1px solid #eac6b8",borderRadius:6,padding:"5px 10px",fontSize:11,fontWeight:600,color:"#8a3a24",cursor:"pointer"}}>Delete</button>
            </div>}
          </div>
        ))}
      </div>
      </>}

      {/* ── Tax Receipts ──────────────────────────────────────────────────── */}
      {section==="receipts"&&<TaxReceiptsManager orgId={auth?.org?.id} isAdmin={isAdmin} isReadOnly={isReadOnly}/>}

      {/* ── Your Data ─────────────────────────────────────────────────────── */}
      {section==="data"&&<>
      <div style={{background:T.white,border:"1px solid "+T.bg3,borderLeft:"3px solid #c9a84c",borderRadius:16,padding:"24px 28px"}}>
        <SectionLabel>Export your data</SectionLabel>
        <div style={{fontSize:15,fontWeight:700,color:T.ink,marginBottom:6}}>Your data is yours.</div>
        <div style={{fontSize:13,color:T.ink3,marginBottom:6,lineHeight:1.6,maxWidth:520}}>
          Export everything as CSV anytime — including if you cancel. One zip of spreadsheet-ready files: donors (with your custom fields), gifts, interactions, grants, pledges, recurring gifts, giving pages, receipts, and more.
        </div>
        <div style={{fontSize:12,color:T.ink3,marginBottom:18}}>{isAdmin?"CSV opens anywhere; JSON is the machine-readable copy of the same data.":"The full CSV export is available to your organization's admins. You can still download the JSON export below."}</div>
        <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
          {isAdmin&&<button onClick={exportCsv} disabled={exportingCsv}
            style={{background:"#c9a84c",color:"#fff",border:"none",borderRadius:8,padding:"10px 22px",fontSize:13,fontWeight:700,cursor:exportingCsv?"not-allowed":"pointer",opacity:exportingCsv?0.7:1}}>
            {exportingCsv?"Building export…":"Export all data (CSV)"}
          </button>}
          <button onClick={exportData} disabled={exporting}
            style={{background:"transparent",color:T.ink,border:"1px solid "+T.bg3,borderRadius:8,padding:"10px 22px",fontSize:13,fontWeight:700,cursor:exporting?"not-allowed":"pointer",opacity:exporting?0.7:1}}>
            {exporting?"Building export…":"Export as JSON"}
          </button>
        </div>
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
                style={{background:"#f6e3dd",color:"#8a3a24",border:"1px solid #eac6b8",borderRadius:8,padding:"8px 16px",fontSize:13,fontWeight:600,cursor:sampleClearing?"not-allowed":"pointer",opacity:sampleClearing?0.7:1}}>
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
      </>}

      {/* ── Account ───────────────────────────────────────────────────────── */}
      {section==="account"&&<>
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
                  <div style={{fontSize:14,fontWeight:600,color:billing.trialDaysLeft<=7?"#b8593f":T.ink}}>
                    {new Date(billing.trialEndsAt).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})}
                    {billing.trialDaysLeft!=null&&<span style={{fontSize:12,color:T.ink3,fontWeight:400,marginLeft:6}}>({billing.trialDaysLeft} days left)</span>}
                  </div>
                </div>
              )}
            </div>
            {/* ROI / impact line. BUILD-73 Part 3: it leads with what is AT RISK
                in the org's own file, next to what the plan costs — the size of
                the problem, never a claim about what Steward achieved. Click for
                the provenance breakdown + the assumption on the one estimate. */}
            {impact&&(impact.atRiskAmount>0||impact.recoveredAmount>0||impact.reengagedAmount>0||impact.watchingRecurringCount>0||impact.onlineGivingProcessed>0)&&(()=>{
              const retried=impact.recoveredAmount||0, cost=impact.planMonthlyCost, watching=impact.watchingRecurringCount||0, online=impact.onlineGivingProcessed||0;
              const returned=impact.reengagedAmount||0, returnedDonors=impact.reengagedDonorCount||0;
              const atRisk=impact.atRiskAmount||0, quiet=impact.quietDonorCount||0;
              const head=(atRisk>0&&quiet>0)
                ? <><strong style={{color:T.ink}}>{fmt(atRisk)}</strong> at risk across <strong style={{color:T.ink}}>{quiet.toLocaleString()}</strong> quiet donor{quiet===1?"":"s"}{cost!=null&&<> · your plan is <strong style={{color:T.ink}}>${cost}/mo</strong></>}. No platform fee, no donor tip.</>
                : watching>0
                  ? <>Steward is watching <strong style={{color:T.ink}}>{watching}</strong> recurring donor{watching===1?"":"s"} for failed cards — money most orgs lose silently{cost!=null&&<>, on a <strong style={{color:T.ink}}>${cost}/mo</strong> plan</>}. No platform fee, no donor tip.</>
                  : <>No platform fee, no donor tip — <strong style={{color:T.green600}}>$0</strong> to Steward on every gift{cost!=null&&<>, on a <strong style={{color:T.ink}}>${cost}/mo</strong> plan</>}.</>;
              const brow=(label,value,note)=>(
                <div style={{display:"flex",alignItems:"baseline",justifyContent:"space-between",gap:12,padding:"7px 0",borderTop:"1px solid "+T.bg3}}>
                  <div style={{flex:1}}>
                    <div style={{fontSize:12.5,fontWeight:700,color:T.ink}}>{label}</div>
                    <div style={{fontSize:11.5,color:T.ink3,lineHeight:1.45,marginTop:1}}>{note}</div>
                  </div>
                  <div style={{fontSize:14,fontWeight:800,color:T.ink,whiteSpace:"nowrap"}}>{value}</div>
                </div>
              );
              return (
                <div style={{border:"1px solid "+T.bg3,borderLeft:"3px solid "+T.gold500,borderRadius:12,overflow:"hidden",background:T.white}}>
                  <div role="button" tabIndex={0} onClick={()=>setImpactOpen(o=>!o)} onKeyDown={e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();setImpactOpen(o=>!o);}}}
                    style={{display:"flex",alignItems:"center",gap:10,padding:"11px 16px",cursor:"pointer"}}>
                    <span aria-hidden style={{color:T.gold500,fontSize:14,lineHeight:1}}>◈</span>
                    <span style={{flex:1,fontSize:13,color:T.ink2,lineHeight:1.5}}>{head}</span>
                    <span style={{fontSize:11,fontWeight:700,color:T.green600,whiteSpace:"nowrap"}}>{impactOpen?"Hide":"Details"}</span>
                  </div>
                  {impactOpen&&(
                    <div style={{padding:"2px 16px 12px",background:T.green100}}>
                      {atRisk>0&&brow("At risk right now",fmt(atRisk),
                        `Lifetime giving of ${quiet.toLocaleString()} donor${quiet===1?"":"s"} with no gift in over ${quietPhrase(impact.quietSinceDays)} — drifting, not yet lapsed. Your file's own history: the size of the problem, measured, not anything Steward did.`)}
                      {retried>0&&brow("Failed cards, retried automatically",fmt(retried),
                        `${impact.recoveredCount} gift${impact.recoveredCount===1?"":"s"} whose card failed and which the dunning workflow retried. Tracked per gift, attributable to a retry Steward actually ran.`)}
                      {returned>0&&brow("Gifts after a year-long gap",fmt(returned),
                        `${fmt(returned)} from ${returnedDonors} donor${returnedDonors===1?"":"s"} who gave again after a 365-day gap. A fact about your file's history, counted separately from the failed-card retries.`)}
                      {brow("Platform fees you paid Steward","$0",
                        "Donations run on your own Stripe — no platform fee, no donor tip. (Stripe's standard card fee still applies, and goes to Stripe, not to us.)")}
                      {online>0&&brow(
                        <>What you'd likely have paid elsewhere <span style={{fontSize:10,fontWeight:700,color:T.gold600,textTransform:"uppercase",letterSpacing:"0.05em"}}>· estimate</span></>,
                        "~"+fmt(impact.estimatedFeesElsewhere),
                        `Estimate — assumes ~${impact.feeAssumptionPct}% in platform/processing fees a typical platform charges, on the ${fmt(online)} in online giving you processed through Steward.`)}
                    </div>
                  )}
                </div>
              );
            })()}
            {(()=>{
              // ONE canonical destination — Stripe's Customer Portal — never two
              // identically-acting buttons (BUILD-31 Part 1). The portal itself
              // handles plan change, payment method, invoices, and cancel, so a
              // single "Manage billing" is enough. Expectation-setting copy sits
              // ABOVE the action. A manual-grant plan (no Stripe subscription)
              // would open an EMPTY portal → we explain that in-app instead.
              const isSubscriber=["core","team","growth","impact","founding"].includes(billing.plan);
              const hasSub=!!billing.hasSubscription;
              const isUpgradable=billing.plan==="trial"||billing.plan==="seed";
              const planLabel={core:"Core",team:"Team",growth:"Team",impact:"Team",founding:"Core"}[billing.plan]||billing.plan;
              return (
              <div style={{display:"flex",flexDirection:"column",gap:10}}>
                <div style={{fontSize:12.5,color:T.ink3,lineHeight:1.5}}>
                  {isSubscriber&&hasSub
                    ? "Change your plan, update your payment method, download invoices, or cancel — all in Stripe's secure billing portal. Opens in a new tab; plan changes are prorated automatically."
                    : isSubscriber&&!hasSub
                      ? <>You're on <strong style={{color:T.ink}}>{planLabel}</strong> via a manual grant from Steward — there's <strong style={{color:T.ink}}>no active subscription</strong> to manage, and nothing to pay. To move to self-serve billing, choose a plan.</>
                      : "Start a subscription any time — opens Stripe's secure checkout."}
                </div>
                <div style={{display:"flex",gap:10,flexWrap:"wrap",alignItems:"center"}}>
                  {isSubscriber&&hasSub&&(
                    <button onClick={openBillingPortal} disabled={portalLoading} style={{background:T.greenMid,border:"none",borderRadius:8,padding:"9px 18px",color:"#fff",fontSize:13,fontWeight:700,cursor:portalLoading?"wait":"pointer",opacity:portalLoading?0.7:1}}>
                      {portalLoading?"Opening…":"Manage billing →"}
                    </button>
                  )}
                  {(isUpgradable||(isSubscriber&&!hasSub))&&(
                    <a href="/pricing" style={{display:"inline-block",background:T.greenMid,border:"none",borderRadius:8,padding:"9px 18px",color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer",textDecoration:"none"}}>
                      Choose a plan →
                    </a>
                  )}
                </div>
                {portalError&&(
                  <div role="alert" style={{fontSize:12.5,color:T.terracotta,lineHeight:1.5}}>
                    {portalError}{" "}
                    {portalUrl
                      ? <a href={portalUrl} target="_blank" rel="noopener noreferrer" style={{color:T.greenDk,fontWeight:700,textDecoration:"underline"}}>Open billing portal →</a>
                      : <button onClick={openBillingPortal} style={{background:"none",border:"none",padding:0,color:T.greenDk,fontWeight:700,cursor:"pointer",textDecoration:"underline",fontSize:12.5}}>Try again</button>}
                  </div>
                )}
              </div>
              );})()}
          </div>
        ) : (
          <div style={{fontSize:13,color:T.ink3}}>Loading billing information…</div>
        )}
      </div>

      {/* Email notifications (BUILD-36 A4) — per-user toggles, default on. An
          officer hears about their donors and tasks without logging in, and can
          turn any stream off here. */}
      <div style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:16,padding:"24px 28px",marginBottom:20}}>
        <SectionLabel>Email notifications</SectionLabel>
        <div style={{fontSize:12.5,color:T.ink3,marginTop:-4,marginBottom:14}}>Email me about:</div>
        {[
          {key:"portfolioGifts",label:"Gifts to my donors",hint:"A gift lands for a donor you own — or anywhere in your org."},
          {key:"taskAssignments",label:"Task assignments",hint:"Someone assigns you a task (or an automation does)."},
          {key:"dailyTasks",label:"Daily task reminder",hint:"A morning summary of tasks due today and overdue."},
        ].map(row=>(
          <label key={row.key} style={{display:"flex",alignItems:"flex-start",gap:12,padding:"10px 0",borderTop:"1px solid "+T.bg2,cursor:notifyPrefs?"pointer":"default"}}>
            <input type="checkbox" disabled={!notifyPrefs||notifySaving===row.key}
              checked={notifyPrefs?!!notifyPrefs[row.key]:true}
              onChange={()=>toggleNotifyPref(row.key)}
              style={{width:16,height:16,marginTop:2,cursor:notifyPrefs?"pointer":"default",accentColor:T.greenMid}}/>
            <div>
              <div style={{fontSize:14,fontWeight:600,color:T.ink}}>{row.label}</div>
              <div style={{fontSize:12,color:T.ink3,marginTop:1}}>{row.hint}</div>
            </div>
          </label>
        ))}
      </div>

      {/* On-brand Account panel (BUILD-31 Part 2.3): plain white/cream section,
          ink label, sign-out as a QUIET terracotta outline (destructive-but-not-
          alarming) — not a near-black block with alarm-red text that read as an
          error state. Terms/Privacy are ordinary links. */}
      <div style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:16,padding:"24px 28px"}}>
        <SectionLabel>Account</SectionLabel>
        <button onClick={logout} style={{background:"none",border:"1px solid "+T.terracotta,borderRadius:8,padding:"9px 18px",color:T.terracotta,fontSize:13,fontWeight:600,cursor:"pointer"}}>
          Sign out
        </button>
        <div style={{marginTop:20,display:"flex",gap:20}}>
          <a href="/terms" target="_blank" rel="noopener noreferrer" style={{fontSize:12,color:T.ink3,textDecoration:"none",borderBottom:"1px solid "+T.bg3}}>Terms of Service</a>
          <a href="/privacy" target="_blank" rel="noopener noreferrer" style={{fontSize:12,color:T.ink3,textDecoration:"none",borderBottom:"1px solid "+T.bg3}}>Privacy Policy</a>
        </div>
      </div>
      </>}

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
            <select value={cfForm.type} onChange={e=>setCfForm(f=>({...f,type:e.target.value}))} disabled={!!editingField}
              style={{width:"100%",boxSizing:"border-box",border:"1px solid "+T.bg3,borderRadius:10,padding:"10px 12px",fontSize:14,color:T.ink,background:T.bg,outline:"none",marginBottom:editingField?4:14,opacity:editingField?0.6:1}}>
              <option value="text">Text</option>
              <option value="long_text">Long text (up to 2,000 characters)</option>
              <option value="number">Number</option>
              <option value="money">Money</option>
              <option value="date">Date</option>
              <option value="select">Select (one choice)</option>
              <option value="multi_select">Multi-select</option>
              <option value="checkbox">Yes/No (Checkbox)</option>
            </select>
            {editingField&&<div style={{fontSize:11.5,color:T.ink3,marginBottom:14,lineHeight:1.5}}>
              A field's type can't change after creation — changing it would silently rewrite every saved value. Archive this field and add a new one instead.
            </div>}
            {(cfForm.type==="select"||cfForm.type==="multi_select")&&(
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
            <div style={{display:"flex",gap:10,marginTop:6}}>
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
                {invErr&&<div style={{marginBottom:12,fontSize:13,color:"#8a3a24",background:"#f6e3dd",border:"1px solid #eac6b8",borderRadius:8,padding:"8px 12px"}}>{invErr}</div>}
                <div style={{display:"flex",gap:10}}>
                  <button onClick={closeInvite} style={{flex:1,background:T.bg,border:"1px solid "+T.bg3,borderRadius:10,padding:"10px",color:T.ink2,fontSize:13,fontWeight:600,cursor:"pointer"}}>Cancel</button>
                  <button onClick={sendInvite} disabled={inviting} style={{flex:2,background:T.green,border:"none",borderRadius:10,padding:"10px",color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer",opacity:inviting?0.7:1}}>
                    {inviting?"Generating invite…":"Generate invite link"}
                  </button>
                </div>
              </>
            ):(
              <>
                <div style={{background:"#edf3ee",border:"1px solid #dce7df",borderRadius:12,padding:"14px 16px",marginBottom:16}}>
                  <div style={{fontSize:13,fontWeight:700,color:"#0d5c3a",marginBottom:4}}>
                    {inviteResult.emailSent?"Invite sent! You can also share the link below:":"Share this invite link:"}
                  </div>
                  <div style={{fontSize:12,color:"#0d5c3a",wordBreak:"break-all",lineHeight:1.5}}>{inviteResult.link}</div>
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
