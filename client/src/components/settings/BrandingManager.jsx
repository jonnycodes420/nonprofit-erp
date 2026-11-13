import { T, SectionLabel } from "../shared";
import { useState, useEffect } from "react";
import { useDirtyGuard } from "../../lib/dirtyGuard";
import { apiFetch } from "../../api";
import { errorMessage } from "../../lib/domainError";
import Uploader, { IMAGE_ACCEPT, IMAGE_ACCEPT_LABEL, IMAGE_MAX_BYTES } from "../Uploader";

// Donor-covers-fees org switch (BUILD-08 Phase B) — controls whether the
// public donate flow offers the optional "add a little to cover processing
// costs" checkbox (checkbox itself always defaults unchecked donor-side).
// Module scope like the other managers; saves via PATCH /orgs/:id.
// Org branding (BUILD-13 Part 2) — tasteful white-label: logo + one accent
// color. The accent is normalized server-side to an accessible range, so the
// server response is the source of truth (it may hand back a slightly deepened
// color for legibility — we show a note when it does). Applied only to accent
// moments across app/emails/receipts, never a full re-skin.
export const PRESET_ACCENTS=[T.greenDk,T.terracotta,T.accentRust,T.accentSlate,T.accentPlum,T.accentOchre,T.ink];
export function BrandingManager({orgId,isAdmin,isReadOnly,onSaved}){
  const [logo,setLogo]=useState("");        // data URI or ""
  const [orgName,setOrgName]=useState("");   // POLISH-7: the saved org name, for the preview
  const [accent,setAccent]=useState("");    // hex or ""
  const [loaded,setLoaded]=useState(false);
  const [saving,setSaving]=useState(false);
  const [msg,setMsg]=useState("");
  const [err,setErr]=useState("");
  const [dirty,setDirty]=useState(false);   // BUILD-54 §6
  const [logoChanged,setLogoChanged]=useState(false);   // LIST-3
  useDirtyGuard(dirty);
  useEffect(()=>{
    // POLISH-7 (W-1108-Atlas-14X): the preview reads the saved name and logo.
    apiFetch("/org").then(o=>{setLogo(o.logo_data||o.logo_url||"");setOrgName(o.name||"");setAccent(o.brand_accent||"");setLoaded(true);}).catch(()=>setLoaded(true));
  },[]);
  const disabled=!isAdmin||isReadOnly;
  const effAccent=accent||T.greenDk;
  async function save(){
    if(disabled||saving)return;
    setSaving(true);setErr("");setMsg("");
    try{
      // LIST-3: the logo goes only when she changed it; saving a colour never removes one.
      const body={brandAccent:accent||"",...(logoChanged?(logo?{logoData:logo}:{removeLogo:true}):{})};
      const res=await apiFetch("/orgs/branding",{method:"PUT",body:JSON.stringify(body)});
      setAccent(res.brand_accent||"");if(res.name)setOrgName(res.name);if(res.logo_data!==undefined)setLogo(res.logo_data||"");
      setDirty(false);setLogoChanged(false);
      setMsg(res.adjusted?"Saved, your color was deepened slightly so text stays readable.":"Branding saved.");
      onSaved&&onSaved();
    }catch(e){setErr(errorMessage(e, "Could not save branding."));}
    setSaving(false);
  }
  // FLOWS-10 item 13 (Area 5 Explore 2): a logo upload saves itself. It showed in Settings after
  // upload and was gone after leaving and reloading, because only Save branding sent it.
  async function saveLogo(dataUrl){
    if(disabled)return;
    setLogo(dataUrl);setErr("");setMsg("Saving the logo…");
    try{
      const res=await apiFetch("/orgs/branding",{method:"PUT",body:JSON.stringify(dataUrl?{logoData:dataUrl}:{removeLogo:true})});
      if(res.logo_data!==undefined)setLogo(res.logo_data||"");if(res.name)setOrgName(res.name);
      setLogoChanged(false);setMsg(dataUrl?"Logo saved.":"Logo removed.");onSaved&&onSaved();
    }catch(e){setLogoChanged(true);setDirty(true);setMsg("");setErr(errorMessage(e,"The logo was not saved. Save branding to try again."));}
  }
  if(!loaded)return <div style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:16,padding:"24px 28px",color:T.ink3,fontSize:13}}>Loading…</div>;
  return(
    <div style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:16,padding:"24px 28px"}}>
      <SectionLabel>Brand Identity</SectionLabel>
      <div style={{fontSize:13,color:T.ink3,lineHeight:1.6,marginTop:6,marginBottom:20,maxWidth:560}}>
        Add your logo and one accent color. Steward keeps its calm layout as the frame, your color lands on the moments that matter: your dashboard welcome, primary buttons, and the header of every receipt and email your donors receive. We keep it readable automatically.
      </div>
      <div style={{display:"flex",gap:28,flexWrap:"wrap"}}>
        {/* Controls */}
        <div style={{flex:"1 1 300px",display:"flex",flexDirection:"column",gap:18}}>
          <div>
            <div style={{fontSize:11,fontWeight:700,color:T.ink3,marginBottom:8}}>Logo</div>
            <Uploader accept={IMAGE_ACCEPT} acceptLabel={IMAGE_ACCEPT_LABEL} maxBytes={IMAGE_MAX_BYTES} compact
              shape="square" preview={logo||null}
              disabled={disabled} label={logo?"Replace logo":"Drag your logo here, or browse"}
              onFile={({dataUrl})=>saveLogo(dataUrl)}
              onRemove={disabled?null:()=>saveLogo("")}/>
          </div>
          <div>
            <div style={{fontSize:11,fontWeight:700,color:T.ink3,marginBottom:8}}>Accent color</div>
            <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
              <input type="color" value={effAccent} onChange={e=>{setDirty(true);setAccent(e.target.value);}} disabled={disabled} style={{width:40,height:40,border:"1px solid "+T.bg3,borderRadius:8,background:"none",cursor:disabled?"not-allowed":"pointer",padding:2}}/>
              <input value={accent} onChange={e=>{setDirty(true);setAccent(e.target.value);}} disabled={disabled} placeholder={T.greenDk} style={{width:110,background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"9px 12px",color:T.ink,fontSize:13,outline:"none",fontFamily:"monospace"}}/>
              {accent&&!disabled&&<button onClick={()=>setAccent("")} style={{background:"none",border:"none",color:T.ink3,fontSize:12,cursor:"pointer",textDecoration:"underline"}}>Reset to Steward gold</button>}
            </div>
            <div style={{display:"flex",gap:6,marginTop:10,flexWrap:"wrap"}}>
              {PRESET_ACCENTS.map(c=><button key={c} data-swatch="" onClick={()=>!disabled&&setAccent(c)} title={c} style={{width:24,height:24,borderRadius:6,background:c,border:accent.toLowerCase()===c?"2px solid "+T.ink:"1px solid rgba(0,0,0,0.15)",cursor:disabled?"not-allowed":"pointer"}}/>)}
            </div>
          </div>
          {isAdmin&&<div style={{display:"flex",alignItems:"center",gap:12}}>
            <button onClick={save} disabled={disabled||saving} title={isReadOnly?"Reactivate your subscription to make changes.":undefined} style={{background:disabled?T.bg3:T.greenMid,border:"none",borderRadius:9,padding:"10px 18px",color:T.white,fontSize:13,fontWeight:700,cursor:disabled?"not-allowed":"pointer"}}>{saving?"Saving…":"Save branding"}</button>
            {msg&&<span style={{fontSize:12,color:T.greenMid}}>{msg}</span>}
            {err&&<span style={{fontSize:12,color:T.terracotta}}>{err}</span>}
          </div>}
        </div>
        {/* Live preview */}
        <div style={{flex:"1 1 300px",minWidth:260}}>
          <div style={{fontSize:11,fontWeight:700,color:T.ink3,marginBottom:8}}>Preview</div>
          <div style={{border:"1px solid "+T.bg3,borderRadius:12,overflow:"hidden",background:T.bg}}>
            <div style={{background:effAccent,padding:"14px 18px",display:"flex",alignItems:"center",gap:10}}>
              {logo&&<img data-testid="brand-preview-logo" src={logo} alt="" style={{height:26,maxWidth:90,objectFit:"contain"}}/>}
              <span data-testid="brand-preview-name" style={{color:T.white,fontWeight:800,fontSize:15}}>{orgName||"Your organization"}</span>
            </div>
            <div style={{padding:"16px 18px",display:"flex",flexDirection:"column",gap:12}}>
              <div style={{fontSize:13,color:T.ink3}}>Dear Jordan, thank you for your generous gift…</div>
              <button data-swatch="" style={{alignSelf:"flex-start",background:effAccent,border:"none",borderRadius:8,padding:"8px 16px",color:T.white,fontSize:12,fontWeight:700}}>Primary action</button>
              <div style={{fontSize:11,color:T.ink3}}>The dashboard welcome, receipts, and donor emails use this header.</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
