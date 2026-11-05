import { useState, useEffect } from "react";
import { apiFetch } from "../../api";
import { errorMessage } from "../../lib/domainError";
import { T, SectionLabel } from "../shared";
import { displayDate } from "../../../../shared/displayDate";
import { displayOrgDate } from "../../lib/orgDay";

// IMPORT-5: the answers she gave about a file's columns, saved against its
// headers so the next export from the same system asks nothing. Each column's
// answer can be changed here, and a saved mapping deleted.
export function SavedMappings({isReadOnly}){
  const [data,setData]=useState(null);
  const [err,setErr]=useState("");
  const [msg,setMsg]=useState("");
  const load=()=>apiFetch("/import-mappings").then(r=>setData(r)).catch(e=>{setData({mappings:[],roles:[]});setErr(errorMessage(e,"Could not load your saved mappings."));});
  useEffect(()=>{load();},[]);  // eslint-disable-line react-hooks/exhaustive-deps
  const setRole=async(m,key,role)=>{
    setErr("");setMsg("");
    try{ await apiFetch("/import-mappings/"+m.id,{method:"PATCH",body:JSON.stringify({columns:{[key]:role}})}); setMsg("Saved."); load(); }
    catch(e){ setErr(errorMessage(e,"That change was not saved.")); }
  };
  const remove=async(m)=>{
    setErr("");setMsg("");
    try{ await apiFetch("/import-mappings/"+m.id,{method:"DELETE"}); setMsg("Deleted. The next file with these columns will ask again."); load(); }
    catch(e){ setErr(errorMessage(e,"That mapping was not deleted.")); }
  };
  if(!data||!data.mappings.length)return null;
  return (
    <div data-testid="saved-mappings" style={{background:T.bgCard,border:"1px solid "+T.bg3,borderRadius:16,padding:"24px 28px"}}>
      <SectionLabel>Saved mappings</SectionLabel>
      <div style={{fontSize:13,color:T.ink3,marginBottom:12,lineHeight:1.6,maxWidth:560}}>
        Your answers about a file's columns. A file with the same columns reads with them and asks nothing.
      </div>
      {err&&<div role="alert" style={{fontSize:12.5,color:T.ink,marginBottom:8}}>{err}</div>}
      {msg&&<div role="status" style={{fontSize:12.5,color:T.ink,marginBottom:8}}>{msg}</div>}
      {data.mappings.map(m=>(
        <div key={m.id} data-testid="saved-mapping" style={{borderTop:"1px solid "+T.bg3,padding:"12px 0"}}>
          <div style={{fontSize:13,color:T.ink,fontWeight:700}}>{m.sentence}</div>
          <div style={{fontSize:11.5,color:T.ink3,marginTop:2}}>Saved {displayOrgDate(m.savedAt||"")}{m.by?` by ${m.by}`:""}</div>
          {m.columns.map(c=>(
            <div key={c.key} style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap",marginTop:6,fontSize:13}}>
              <span style={{minWidth:140,color:T.ink}}>{c.header}</span>
              <select aria-label={`What ${c.header} is`} disabled={isReadOnly} value={c.role} onChange={e=>setRole(m,c.key,e.target.value)}
                style={{padding:"4px 6px",border:"1px solid "+T.bg3,borderRadius:8,fontFamily:"inherit",fontSize:12.5}}>
                {(data.roles||[]).map(r=><option key={r.key} value={r.key}>{r.label}</option>)}
              </select>
            </div>
          ))}
          {!isReadOnly&&<button type="button" data-testid="saved-mapping-delete" onClick={()=>remove(m)}
            style={{background:"none",border:"none",padding:0,marginTop:8,font:"inherit",fontSize:12,color:T.greenDk,textDecoration:"underline",cursor:"pointer"}}>Delete this mapping</button>}
        </div>
      ))}
    </div>
  );
}
