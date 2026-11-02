import { useState, useEffect } from "react";
import { apiFetch } from "../../api";
import { errorMessage } from "../../lib/domainError";
import { T, SectionLabel } from "../shared";
import { countLabel } from "../../../../shared/countWords.js";

// ── BUILD-87 Part 3 — EMAIL LOGGING BY BCC ─────────────────────────────────
// One address, one sentence. The address is shown whether or not the surface
// is switched on, and when it is off the card SAYS SO — a copyable address for
// a mailbox nobody is listening to is the one way this feature could quietly
// lose somebody's email.
export function InboundEmailCard({isReadOnly}){
  const [state,setState]=useState(null);
  const [copied,setCopied]=useState(false);
  const [openId,setOpenId]=useState(null);
  const [q,setQ]=useState("");
  const [results,setResults]=useState([]);
  const [busy,setBusy]=useState(false);
  const load=()=>apiFetch("/settings/inbound-email").then(setState).catch(()=>setState(null));
  useEffect(()=>{load();},[]); // eslint-disable-line
  async function search(term){
    setQ(term);
    if(!term.trim()){setResults([]);return;}
    try{const r=await apiFetch(`/donors?limit=5&search=${encodeURIComponent(term.trim())}`);
      setResults(Array.isArray(r)?r:(r.donors||[]));}catch{setResults([]);}
  }
  async function assign(id,donorId){
    setBusy(true);
    try{await apiFetch("/settings/inbound-email/assign",{method:"POST",body:JSON.stringify({id,donorId})});
      setOpenId(null);setQ("");setResults([]);await load();}
    catch(e){alert(errorMessage(e,"That message could not be filed."));}
    finally{setBusy(false);}
  }
  async function discard(id){
    setBusy(true);
    try{await apiFetch("/settings/inbound-email/discard",{method:"POST",body:JSON.stringify({id})});await load();}
    catch(e){alert(errorMessage(e,"That message could not be discarded."));}
    finally{setBusy(false);}
  }
  if(!state) return null;
  const held=state.unmatched||[];
  return (
    <div style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:16,padding:"24px 28px"}}>
      <SectionLabel>Log an email by BCC</SectionLabel>
      <div style={{fontSize:13,color:T.ink3,marginBottom:14,lineHeight:1.6}}>
        BCC this on any email to a donor and it lands on their record.
      </div>
      {state.address?(
        <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap",marginBottom:12}}>
          <code style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"8px 12px",fontSize:13,color:T.ink}}>{state.address}</code>
          <button onClick={()=>{navigator.clipboard?.writeText(state.address);setCopied(true);setTimeout(()=>setCopied(false),1800);}}
            style={{background:"transparent",border:"1px solid "+T.ink,borderRadius:8,padding:"7px 14px",color:T.ink,fontSize:12,fontWeight:700,cursor:"pointer"}}>
            {copied?"Copied":"Copy"}
          </button>
        </div>
      ):(
        <div style={{fontSize:13,color:T.ink3,marginBottom:12}}>No logging address yet. Your organization needs a slug first.</div>
      )}
      {!state.enabled&&(
        <div style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:10,padding:"10px 14px",fontSize:12.5,color:T.ink2,marginBottom:12,lineHeight:1.6}}>
          Inbound logging is not switched on yet. Mail sent to this address is not being received, so nothing will reach a donor record until it is.
        </div>
      )}
      {held.length>0&&<>
        <div style={{fontSize:11,fontWeight:700,color:T.ink3,margin:"18px 0 8px"}}>Unmatched ({held.length})</div>
        {held.map(m=>(
          <div key={m.id} style={{border:"1px solid "+T.bg3,borderRadius:10,padding:"12px 14px",marginBottom:8,background:T.bg}}>
            <div style={{fontSize:13,fontWeight:700,color:T.ink}}>{m.subject}</div>
            <div style={{fontSize:11.5,color:T.ink3,marginTop:3}}>
              {m.kind==="self_test"
                ? "A test you sent to yourself. Inbound logging reached Steward."
                : m.kind==="multiple"
                  ? "More than one donor has that address."
                  : "No donor on file has that address."}
              {m.to?" · to "+m.to:""}
            </div>
            <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:10,alignItems:"center"}}>
              {!isReadOnly&&(m.candidates||[]).map(c=>(
                <button key={c.id} disabled={busy} onClick={()=>assign(m.id,c.id)}
                  style={{background:T.green,border:"none",borderRadius:8,padding:"6px 12px",color:T.white,fontSize:12,fontWeight:700,cursor:"pointer"}}>
                  File on {c.name}
                </button>
              ))}
              {!isReadOnly&&!(m.candidates||[]).length&&(
                <button disabled={busy} onClick={()=>{setOpenId(openId===m.id?null:m.id);setQ("");setResults([]);}}
                  style={{background:"transparent",border:"1px solid "+T.ink,borderRadius:8,padding:"6px 12px",color:T.ink,fontSize:12,fontWeight:700,cursor:"pointer"}}>
                  Pick a donor
                </button>
              )}
              {!isReadOnly&&<button disabled={busy} onClick={()=>discard(m.id)}
                style={{background:"transparent",border:"none",fontSize:12,color:T.terracotta,cursor:"pointer",fontWeight:600,padding:"6px 4px"}}>
                Discard
              </button>}
            </div>
            {openId===m.id&&(
              <div style={{marginTop:10}}>
                <input value={q} onChange={e=>search(e.target.value)} placeholder="Search donors by name or email"
                  style={{width:"100%",maxWidth:340,padding:"7px 10px",border:"1px solid "+T.bg3,borderRadius:8,fontSize:13,color:T.ink,background:T.white}}/>
                {results.map(d=>(
                  <button key={d.id} disabled={busy} onClick={()=>assign(m.id,d.id)}
                    style={{display:"block",marginTop:6,background:"transparent",border:"1px solid "+T.bg3,borderRadius:8,padding:"6px 10px",fontSize:12.5,color:T.ink,cursor:"pointer",textAlign:"left"}}>
                    {d.name}{d.email?" · "+d.email:""}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </>}
      {state.droppedCount>0&&(
        <div style={{fontSize:11.5,color:T.ink3,marginTop:10}}>
          {countLabel(state.droppedCount, "message")} refused: sent from an address that is not on your team.
        </div>
      )}
    </div>
  );
}
