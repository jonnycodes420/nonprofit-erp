import { useRef, useState, useEffect } from "react";
import { apiFetch } from "../../api";
import { errorMessage } from "../../lib/domainError";
import { T, SectionLabel } from "../shared";

// ── REPORTS-3 · WHO GETS THE BOARD PACK ────────────────────────────────────
// The organisation's OWN staff and board addresses. It is the only list a
// scheduled board pack is ever sent to, and the server refuses an address
// that is on file as a donor — "your staff and board, never a donor" is the
// rule this list exists under, and a typo would otherwise mail a major donor
// the organisation's retention figures.
//
// The schedule itself is not here: it belongs with the pack, in Reports. This
// card is the addresses, and it links there.
export function BoardPackRecipientsCard({orgId,isAdmin,isReadOnly,focused,onNavigate}){
  const cardRef=useRef(null);
  const [ring,setRing]=useState(false);
  useEffect(()=>{
    if(!focused||!cardRef.current)return;
    cardRef.current.scrollIntoView({behavior:"smooth",block:"center"});
    setRing(true);
    const t=setTimeout(()=>setRing(false),2400);
    return ()=>clearTimeout(t);
  },[focused]);
  const [list,setList]=useState(null);     // null = loading
  const [adding,setAdding]=useState("");
  const [saving,setSaving]=useState(false);
  const [err,setErr]=useState("");
  const [savedAt,setSavedAt]=useState(0);
  useEffect(()=>{
    apiFetch("/org").then(o=>{
      const v=o?.board_pack_emails??o?.boardPackEmails;
      setList(Array.isArray(v)?v.map(String):[]);
    }).catch(()=>setList([]));
  },[]);
  async function save(next){
    const prev=list; setSaving(true); setErr("");
    try{
      await apiFetch(`/orgs/${orgId}`,{method:"PATCH",body:JSON.stringify({boardPackEmails:next})});
      setList(next); setSavedAt(Date.now()); setAdding("");
    }catch(e){ setList(prev); setErr(errorMessage(e, "That address would not save.")); }
    setSaving(false);
  }
  const add=()=>{ const a=adding.trim(); if(a) save([...(list||[]),a]); };
  const drop=i=>save((list||[]).filter((_,x)=>x!==i));
  const locked=!isAdmin||isReadOnly||saving||list===null;
  return(
    <div ref={cardRef} id="settings-board-pack" data-testid="settings-board-pack"
      style={{background:T.white,border:"1px solid "+(ring?T.green600:T.bg3),borderRadius:16,padding:"24px 28px",marginBottom:20,
              boxShadow:ring?`0 0 0 3px ${T.green600}33`:"none",transition:"box-shadow 0.4s, border-color 0.4s"}}>
      <SectionLabel>Who gets the board pack</SectionLabel>
      <div style={{fontSize:13,color:T.ink3,lineHeight:1.6,marginTop:6,marginBottom:14}}>
        The staff and board addresses Steward emails your board pack to. It goes to these people and nobody else,
        and never to a donor. You set when it goes out in Reports, under Board pack.
      </div>
      {list!==null&&list.length===0&&<div style={{fontSize:13,color:T.ink3,marginBottom:12}}>Nobody is listed yet.</div>}
      {(list||[]).map((a,i)=>(
        <div key={a+i} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 0",
                               borderTop:i===0?"none":"1px solid "+T.bg2}}>
          <span style={{fontSize:13,color:T.ink,flex:1,minWidth:0,overflowWrap:"anywhere"}}>{a}</span>
          <button type="button" onClick={()=>drop(i)} disabled={locked}
            style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:8,padding:"5px 11px",
                    color:T.ink,fontSize:12,fontWeight:700,cursor:locked?"not-allowed":"pointer"}}>Remove</button>
        </div>
      ))}
      <div style={{display:"flex",gap:10,flexWrap:"wrap",alignItems:"center",marginTop:14}}>
        <input type="email" aria-label="Add a staff or board address" placeholder="name@example.org" value={adding}
          onChange={e=>setAdding(e.target.value)} disabled={locked}
          onKeyDown={e=>{ if(e.key==="Enter"){ e.preventDefault(); add(); } }}
          style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"10px 12px",
                  color:T.ink,fontSize:13,fontFamily:"inherit",flex:"1 1 240px",maxWidth:320}}/>
        <button type="button" onClick={add} disabled={locked||!adding.trim()}
          style={{background:T.greenDk,border:"1.5px solid "+T.greenDk,borderRadius:10,padding:"9px 18px",
                  color:T.white,fontSize:12.5,fontWeight:700,cursor:locked||!adding.trim()?"not-allowed":"pointer",
                  opacity:locked||!adding.trim()?0.6:1}}>Add</button>
        {savedAt>0&&<span style={{fontSize:12,color:T.greenDk}}>Saved</span>}
        <button type="button" onClick={()=>onNavigate&&onNavigate("reports",{report:"board-pack"})}
          style={{background:"none",border:"none",padding:0,color:T.greenDk,fontSize:12.5,fontWeight:700,
                  cursor:"pointer",textDecoration:"underline"}}>Open the board pack</button>
      </div>
      {err&&<div style={{fontSize:12,color:T.terracotta,marginTop:8}}>{err}</div>}
      {!isAdmin&&<div style={{fontSize:12,color:T.ink3,marginTop:8}}>Only an admin can change this.</div>}
    </div>
  );
}
