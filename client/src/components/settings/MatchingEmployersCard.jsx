import { useState, useEffect } from "react";
import { apiFetch } from "../../api";
import { T, SectionLabel } from "../shared";

// ── GIVE-2 §8 · THE EMPLOYERS THIS ORGANISATION KNOWS MATCH ────────────────
// Typed by staff, with each company's own form link, shown to a donor on the
// page their gift just landed on. There is no vendor behind this and no lookup
// service: a small nonprofit's matching money comes from a handful of large
// local employers it already knows by name, and a donor who works at one needs
// the link rather than a database.
export function MatchingEmployersCard({isAdmin,isReadOnly}){
  const [rows,setRows]=useState(null);
  const [form,setForm]=useState({name:"",formUrl:"",ratio:"1:1"});
  const [busy,setBusy]=useState(false);
  const [err,setErr]=useState("");
  const [definition,setDefinition]=useState("");

  async function load(){
    try{
      const d=await apiFetch("/matching-employers");
      setRows(d.employers||[]); setDefinition(d.definition||"");
    }catch{ setRows([]); }
  }
  useEffect(()=>{load();},[]);

  async function add(){
    if(busy||!form.name.trim())return;
    setBusy(true);setErr("");
    try{
      await apiFetch("/matching-employers",{method:"POST",body:JSON.stringify({
        name:form.name.trim(), formUrl:form.formUrl.trim()||undefined, ratio:form.ratio.trim()||undefined,
      })});
      setForm({name:"",formUrl:"",ratio:"1:1"});
      await load();
    }catch(e){ setErr(e?.message||"That did not save."); }
    setBusy(false);
  }
  async function remove(id){
    if(busy)return;
    setBusy(true);setErr("");
    try{ await apiFetch(`/matching-employers/${id}`,{method:"DELETE"}); await load(); }
    catch(e){ setErr(e?.message||"That did not delete."); }
    setBusy(false);
  }

  const inp={background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"9px 11px",
             color:T.ink,fontSize:13,fontFamily:"inherit"};

  return(
    <div style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:16,padding:"24px 28px",marginBottom:20}}>
      <SectionLabel>Employers Who Match Gifts</SectionLabel>
      <div style={{fontSize:13,color:T.ink3,lineHeight:1.6,marginTop:6,marginBottom:14}}>
        {definition||"Employers you know match gifts, with their own form link. Shown to a donor after they give."}
      </div>
      {rows===null?(
        <div style={{fontSize:13,color:T.ink3}}>Loading…</div>
      ):rows.length===0?(
        <div className="me-empty" style={{fontSize:13,color:T.ink3,lineHeight:1.6,marginBottom:14}}>
          Nothing here yet, and nothing is shown to a donor until there is. Add the two or three
          large employers you have already received a match from.
        </div>
      ):(
        <ul className="me-list" style={{margin:"0 0 14px",padding:0,listStyle:"none"}}>
          {rows.map(r=>(
            <li key={r.id} style={{display:"flex",gap:10,alignItems:"baseline",padding:"8px 0",borderTop:"1px solid "+T.bg2}}>
              <span style={{flex:1}}>
                <span style={{fontSize:13,fontWeight:600,color:T.ink}}>{r.name}</span>
                {r.ratio&&<span style={{fontSize:12,color:T.ink3}}> &middot; matches {r.ratio}</span>}
                {r.form_url
                  ?<a href={r.form_url} target="_blank" rel="noopener noreferrer"
                      style={{display:"block",fontSize:12,color:T.greenDk,wordBreak:"break-all"}}>{r.form_url}</a>
                  :<span style={{display:"block",fontSize:12,color:T.gold}}>No form link, so a donor gets the name only.</span>}
              </span>
              {isAdmin&&!isReadOnly&&(
                <button onClick={()=>remove(r.id)} disabled={busy}
                  style={{background:"none",border:"none",padding:0,color:T.ink3,fontSize:12,
                          textDecoration:"underline",cursor:busy?"default":"pointer"}}>Remove</button>
              )}
            </li>
          ))}
        </ul>
      )}
      {isAdmin&&!isReadOnly&&(
        <div style={{display:"flex",gap:10,flexWrap:"wrap",alignItems:"center",borderTop:"1px solid "+T.bg2,paddingTop:14}}>
          <input className="me-name" placeholder="Employer" value={form.name}
            onChange={e=>setForm({...form,name:e.target.value})} style={{...inp,minWidth:180}}/>
          <input className="me-url" placeholder="https://their-matching-form" value={form.formUrl}
            onChange={e=>setForm({...form,formUrl:e.target.value})} style={{...inp,minWidth:240,flex:1}}/>
          <input className="me-ratio" placeholder="1:1" value={form.ratio}
            onChange={e=>setForm({...form,ratio:e.target.value})} style={{...inp,width:70}}/>
          <button onClick={add} disabled={busy||!form.name.trim()}
            style={{background:T.greenDk||T.ink,color:T.white,border:"none",borderRadius:8,
                    padding:"9px 16px",fontSize:13,fontWeight:700,
                    cursor:(busy||!form.name.trim())?"default":"pointer",opacity:form.name.trim()?1:0.5}}>
            Add
          </button>
        </div>
      )}
      {err&&<div style={{fontSize:12,color:T.gold,marginTop:8}}>{err}</div>}
      <div style={{fontSize:12,color:T.ink3,lineHeight:1.6,marginTop:12}}>
        Steward does not buy a matching-gift database, so nothing here is guessed: it is the
        list you type. A donor also sees the employer they named on their own record, and
        Steward opens an expected matching gift when it recognizes one.
      </div>
    </div>
  );
}
