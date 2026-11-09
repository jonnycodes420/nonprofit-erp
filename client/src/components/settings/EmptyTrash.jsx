import { useState, useEffect } from "react";
import { apiFetch } from "../../api";
import { errorMessage } from "../../lib/domainError";
import { T, SectionLabel } from "../shared";
import { TrashList } from "./TrashList";

// FIX-55 · EMPTY TRASH. People deleted from this org stay matchable (an import
// asks about them) until the trash is emptied. The count comes first, then a
// second confirm; after it they are gone for good and never match an import.
export function EmptyTrash({isAdmin,isReadOnly}){
  const [days,setDays]=useState("90");
  const [check,setCheck]=useState(null);   // {count, sentence} for the days chosen
  const [sure,setSure]=useState(false);
  const [busy,setBusy]=useState(false);
  const [done,setDone]=useState("");
  const [err,setErr]=useState("");
  const [seen,setSeen]=useState(0);   // INTEGRITY-2: a Restore above recounts what Empty trash would delete
  const qs=d=>d==="all"?"":`?olderThanDays=${encodeURIComponent(d)}`;
  useEffect(()=>{
    if(!isAdmin) return undefined;
    let live=true; setCheck(null); setSure(false);
    apiFetch("/donors/purge-trash/preview"+qs(days)).then(r=>{if(live)setCheck(r);}).catch(e=>{if(live)setErr(errorMessage(e,"Could not count the trash."));});
    return ()=>{live=false;};
  },[days,isAdmin,done,seen]);
  const empty=async()=>{
    setBusy(true); setErr("");
    try{ const r=await apiFetch("/donors/purge-trash",{method:"POST",body:JSON.stringify({confirm:"empty",olderThanDays:days==="all"?null:Number(days)})}); setDone(r.sentence||"Done."); setSure(false); setSeen(k=>k+1); }
    catch(e){ setErr(e?.body?.sentence||errorMessage(e,"The trash was not emptied.")); }
    setBusy(false);
  };
  const btnS=(danger)=>({background:danger?T.terra700:T.white,color:danger?T.white:T.ink,border:danger?"none":"1px solid "+T.bg3,borderRadius:8,padding:"8px 14px",fontSize:13,fontWeight:700,cursor:"pointer"});
  return (
    <div data-testid="empty-trash" style={{background:T.bgCard,border:"1px solid "+T.bg3,borderRadius:16,padding:"20px 28px"}}>
      <SectionLabel>Trash</SectionLabel>
      {/* INTEGRITY-2: the list you can restore from comes first; Empty trash is below it and asks first */}
      <TrashList isAdmin={isAdmin} isReadOnly={isReadOnly} onChanged={()=>setSeen(k=>k+1)}/>
      <div style={{fontSize:13,color:T.ink3,lineHeight:1.6,marginBottom:10}}>
        People you delete stay in the trash, so an import can ask whether someone in a file is the person you deleted. Emptying the trash deletes them for good: they never match an import again. The audit log keeps that a delete happened, not who.
      </div>
      {!isAdmin ? <div style={{fontSize:13,color:T.ink3}}>An admin can empty the trash.</div> : (
        <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
          <label style={{fontSize:13,display:"flex",gap:6,alignItems:"center"}}>Deleted
            <select data-testid="empty-trash-days" value={days} onChange={e=>{setDays(e.target.value);setDone("");}} style={{padding:"6px 8px",border:"1px solid "+T.bg3,borderRadius:8,fontFamily:"inherit"}}>
              <option value="30">more than 30 days ago</option><option value="90">more than 90 days ago</option><option value="365">more than a year ago</option><option value="all">at any time (all of them)</option>
            </select>
          </label>
          <span data-testid="empty-trash-count" style={{fontSize:13,flex:"1 1 240px"}}>{check?check.sentence:"Counting…"}</span>
          {!sure
            ? <button type="button" data-testid="empty-trash-go" disabled={isReadOnly||!check||!check.count} style={{...btnS(false),opacity:isReadOnly||!check||!check.count?0.45:1}} onClick={()=>setSure(true)}>Empty trash</button>
            : <span style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                <button type="button" data-commit data-testid="empty-trash-confirm" disabled={busy} style={btnS(true)} onClick={empty}>{busy?"Deleting…":`Delete ${check.count.toLocaleString("en-US")} for good`}</button>
                <button type="button" style={btnS(false)} onClick={()=>setSure(false)}>Keep them</button>
              </span>}
        </div>
      )}
      {done&&<div role="status" data-testid="empty-trash-done" style={{fontSize:13,marginTop:8,color:T.ink}}>{done}</div>}
      {err&&<div role="alert" style={{fontSize:13,marginTop:8,color:T.ink}}>{err}</div>}
    </div>
  );
}
