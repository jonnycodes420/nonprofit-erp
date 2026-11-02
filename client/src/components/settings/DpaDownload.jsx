import { useState, useEffect } from "react";
import { API } from "../../api";
import { T, SectionLabel } from "../shared";

// TRUST-2 — appears only when /legal/dpa says the agreement is published.
export function DpaDownload(){
  const [pub,setPub]=useState(false);
  useEffect(()=>{ fetch(`${API}/legal/dpa`).then(r=>r.json()).then(d=>setPub(!!d.published)).catch(()=>{}); },[]);
  if(!pub)return null;
  const get=async()=>{
    const r=await fetch(`${API}/legal/dpa.pdf`); if(!r.ok)return;
    const url=URL.createObjectURL(await r.blob()),a=document.createElement("a");
    a.href=url;a.download="steward-data-processing-agreement.pdf";document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);
  };
  return <div style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:16,padding:"24px 28px"}}>
    <SectionLabel>Data processing agreement</SectionLabel>
    <div style={{fontSize:13,color:T.ink3,marginBottom:10}}>The terms under which Steward processes your organization's data, and the list of subprocessors.</div>
    <button onClick={get} style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:8,padding:"8px 14px",fontSize:13,fontWeight:700,color:T.ink,cursor:"pointer"}}>Download the DPA</button>
  </div>;
}
