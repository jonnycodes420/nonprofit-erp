import { useState, useEffect } from "react";
import { apiFetch } from "../../api";
import { T, SectionLabel } from "../shared";
import { errorMessage } from "../../lib/domainError";
import Uploader, { IMAGE_ACCEPT, IMAGE_ACCEPT_LABEL, IMAGE_MAX_BYTES } from "../Uploader";
import { resolveAssetUrl } from "../../lib/assetUrl";
import { PortalBannerCrop, PORTAL_IMPACT_PHOTO_RATIO } from "../PortalBanner";
import { countLabel } from "../../../../shared/countWords.js";
import { displayDate } from "../../../../shared/displayDate";
import { askConfirm } from "../ConfirmDialog";
import { displayOrgDate } from "../../lib/orgDay";

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
  const lbl={fontSize:11,fontWeight:700,color:T.ink3,marginBottom:6};
  async function save(){
    if(disabled||busy||!form?.title?.trim())return;
    setBusy(true);setErr("");
    try{
      const body=JSON.stringify({title:form.title,body:form.body||"",photos:form.photos||[],
        photoCrops:form.photoCrops||[],targets:form.targets||[],orgWide:form.orgWide===true});
      if(form.id)await apiFetch(`/impact-updates/${form.id}`,{method:"PUT",body});
      else await apiFetch("/impact-updates",{method:"POST",body});
      setForm(null);load();
    }catch(e){setErr(errorMessage(e, "Could not save."));}
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
        food bank fund sees food bank updates, that's the whole feature.
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
            {(form.photos||[]).length>0&&<div style={{fontSize:11,color:T.ink3,marginTop:6}}>Tap a photo to crop it, this preview is exactly what donors see.</div>}
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
      {rows.length===0&&!form&&<div style={{fontSize:13,color:T.ink3}}>No impact updates yet, the first one you publish shows up in your donors' portals.</div>}
      {rows.map(u=>(
        <div key={u.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 0",borderBottom:"1px solid "+T.bg2}}>
          <div>
            <div style={{fontSize:14,fontWeight:700,color:T.ink}}>{u.title}</div>
            <div style={{fontSize:12,color:T.ink3}}>
              {u.org_wide?"Org-wide":countLabel(Array.isArray(u.targets)?u.targets.length:0,"target")} · {displayOrgDate(u.created_at)}
            </div>
          </div>
          {isAdmin&&<div style={{display:"flex",gap:8}}>
            <button onClick={()=>{setCropIdx(null);setForm({id:u.id,title:u.title,body:u.body||"",photos:Array.isArray(u.photos)?u.photos:[],photoCrops:Array.isArray(u.photo_crops)?u.photo_crops:[],targets:Array.isArray(u.targets)?u.targets:[],orgWide:u.org_wide===true});}}
              style={{background:"none",border:"1px solid "+T.bg3,borderRadius:8,padding:"5px 12px",fontSize:12,cursor:"pointer",color:T.ink}}>Edit</button>
            <button onClick={async()=>{if(await askConfirm({title:"Delete this impact update?",body:"Donors stop seeing it, and its photos are removed. This cannot be undone.",yes:"Delete update",danger:true})){await apiFetch(`/impact-updates/${u.id}`,{method:"DELETE"});load();}}}
              style={{background:"none",border:"1px solid "+T.terra200,borderRadius:8,padding:"5px 12px",fontSize:12,cursor:"pointer",color:T.terra700}}>Delete</button>
          </div>}
        </div>
      ))}
    </div>
  );
}
