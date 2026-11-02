import { useState, useEffect } from "react";
import { apiFetch } from "../../api";
import { T, SectionLabel } from "../shared";

export function CoverFeesCard({orgId,isAdmin}){
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
            the card-processing fee on top of their gift, so you receive the full intended
            amount. The added amount is part of their donation and appears on their receipt
            as part of the total. The rate it adds is the one in the card below.
          </div>
        </div>
        {isAdmin&&(
          <button onClick={toggle} disabled={enabled===null||saving}
            style={{background:enabled?T.ink:T.bg3,border:"none",borderRadius:99,width:46,height:26,position:"relative",cursor:"pointer",flexShrink:0,transition:"background 0.15s",opacity:enabled===null?0.5:1}}
            aria-label={enabled?"Disable donor-covers-fees":"Enable donor-covers-fees"}>
            <span style={{position:"absolute",top:3,left:enabled?23:3,width:20,height:20,background:T.white,borderRadius:"50%",transition:"left 0.15s",boxShadow:"0 1px 3px rgba(0,0,0,0.25)"}}/>
          </button>
        )}
      </div>
    </div>
  );
}
