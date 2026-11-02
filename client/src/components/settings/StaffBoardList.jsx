import { useState, useEffect } from "react";
import { apiFetch } from "../../api";
import { errorMessage } from "../../lib/domainError";
import { T, SectionLabel } from "../shared";

// ── FIX-1 D — STAFF AND BOARD, under Organization ─────────────────────────
// They are people on the one list (a person record with the Staff and board
// role), not sign-ins: the Team section is who can log in; this is who serves.
// The list is GET /people?role=staff_board — the same predicate Donors and the
// Volunteers roster use, so a board member who gives is on both, once.
export function StaffBoardList({onNavigate}){
  const [people,setPeople]=useState(null);
  const [err,setErr]=useState("");
  useEffect(()=>{
    let gone=false;
    apiFetch("/people?role=staff_board")
      .then(r=>{if(!gone)setPeople(r.people||[]);})
      .catch(e=>{if(!gone){setErr(errorMessage(e,"Could not load staff and board"));setPeople([]);}});
    return()=>{gone=true;};
  },[]);
  return (
    <div data-testid="staff-board" style={{marginTop:16,background:T.white,border:"1px solid "+T.bg3,borderRadius:16,padding:"24px 28px"}}>
      <SectionLabel>Staff and board</SectionLabel>
      <div style={{fontSize:12.5,color:T.ink3,marginBottom:12,lineHeight:1.5}}>
        {people===null?"Loading…"
          :err?err
          :people.length===0?"Nobody yet. Open a person and tap the Staff and board chip under their name."
          :`${people.length} ${people.length===1?"person carries":"people carry"} the Staff and board role.`}
      </div>
      {people&&people.length>0&&(
        <ul style={{listStyle:"none",margin:0,padding:0}}>
          {people.map(p=>(
            <li key={p.id} style={{display:"flex",alignItems:"center",gap:10,padding:"9px 0",borderTop:"1px solid "+T.bg3,flexWrap:"wrap"}}>
              <button type="button" onClick={()=>onNavigate&&onNavigate("donors",{selectDonorId:p.id})}
                style={{background:"none",border:"none",padding:0,font:"inherit",fontSize:14,fontWeight:700,color:T.ink,cursor:onNavigate?"pointer":"default",textAlign:"left"}}>
                {p.name}
              </button>
              <span style={{fontSize:12,color:T.ink3}}>{(p.labels||[]).join(" · ")}</span>
              {p.email&&<span style={{fontSize:12,color:T.ink3,marginLeft:"auto"}}>{p.email}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
