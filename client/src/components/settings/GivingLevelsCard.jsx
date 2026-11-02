import { useState, useEffect } from "react";
import { apiFetch } from "../../api";
import { T, SectionLabel } from "../shared";

// PARITY-1 — GIVING LEVELS. The two cut points between General, Mid and Major,
// on what a person gave in the last 12 months. The tags under every donor's
// name, the list filters, Groups and the dashboard's chart all read these.
export function GivingLevelsCard({isAdmin,isReadOnly}){
  const [lv,setLv]=useState(null);
  const [mid,setMid]=useState("");
  const [major,setMajor]=useState("");
  const [msg,setMsg]=useState(null);
  const [saving,setSaving]=useState(false);
  useEffect(()=>{
    apiFetch("/settings/giving-levels").then(r=>{setLv(r);setMid(String(r.midCents/100));setMajor(String(r.majorCents/100));}).catch(()=>setLv(false));
  },[]);
  async function save(){
    setSaving(true);setMsg(null);
    try{ const r=await apiFetch("/settings/giving-levels",{method:"PUT",body:JSON.stringify({mid,major})}); setLv(r); setMsg("Saved. Every donor's tag uses these now."); }
    catch(e){ setMsg(e?.message||"Those did not save."); }
    setSaving(false);
  }
  if(lv===null||lv===false)return null;
  const field={border:"1px solid "+T.bg3,borderRadius:8,padding:"7px 10px",fontSize:14,width:120,fontFamily:"inherit"};
  return(
    <div data-testid="settings-giving-levels" style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:16,padding:"24px 28px",marginBottom:20}}>
      <SectionLabel>Giving levels</SectionLabel>
      <div style={{fontSize:13,color:T.ink3,lineHeight:1.6,marginTop:6}}>{lv.sentence}</div>
      <div style={{display:"flex",gap:16,flexWrap:"wrap",alignItems:"flex-end",marginTop:14}}>
        <label style={{fontSize:12,color:T.ink3,display:"grid",gap:4}}>Mid starts at ($)
          <input aria-label="Mid starts at" style={field} value={mid} onChange={e=>setMid(e.target.value)} disabled={!isAdmin||isReadOnly} inputMode="decimal"/></label>
        <label style={{fontSize:12,color:T.ink3,display:"grid",gap:4}}>Major starts at ($)
          <input aria-label="Major starts at" style={field} value={major} onChange={e=>setMajor(e.target.value)} disabled={!isAdmin||isReadOnly} inputMode="decimal"/></label>
        {isAdmin&&!isReadOnly&&<button onClick={save} disabled={saving}
          style={{background:T.greenDk,color:T.white,border:"none",borderRadius:8,padding:"8px 16px",fontWeight:700,fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>{saving?"Saving":"Save"}</button>}
      </div>
      {msg&&<div style={{fontSize:12.5,color:T.ink3,marginTop:8}}>{msg}</div>}
    </div>
  );
}
