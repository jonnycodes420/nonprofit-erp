import { useState, useEffect } from "react";
import { apiFetch } from "../../api";
import { errorMessage } from "../../lib/domainError";
import { countLabel } from "../../../../shared/countWords.js";
import { Modal, T, Spin } from "../shared";

// ── Merge duplicates (BUILD-08 Phase C) ────────────────────────────────────
// Staff-level data-hygiene tool: GET /donors/duplicates lists candidate
// groups (same email; same/near name), the officer picks which record to
// keep, and POST /donors/merge folds each other record into it — children
// reassigned, blanks filled, secondary soft-deleted with a merge note.
export function MergeDuplicatesModal({onClose,onMerged,isReadOnly}){
  const[groups,setGroups]=useState(null); // null = loading
  const[open,setOpen]=useState(null);     // group index expanded
  const[primaryId,setPrimaryId]=useState(null);
  const[busy,setBusy]=useState(false);
  const[done,setDone]=useState("");
  const[err,setErr]=useState("");

  const load=()=>{
    setGroups(null);setOpen(null);setPrimaryId(null);setErr("");
    apiFetch("/donors/duplicates").then(r=>setGroups(r.groups||[])).catch(e=>{setGroups([]);setErr(errorMessage(e, "Could not check for duplicates."));});
  };
  useEffect(load,[]);

  async function doMerge(group){
    if(!primaryId||busy)return;
    const others=group.donors.filter(d=>d.id!==primaryId);
    const keep=group.donors.find(d=>d.id===primaryId);
    if(!window.confirm(`Merge ${countLabel(others.length, "record")} into "${keep.name}"? Their gifts, notes, and history move to the kept record; the duplicate${others.length!==1?"s go":" goes"} to trash.`))return;
    setBusy(true);setErr("");
    try{
      for(const o of others){
        await apiFetch("/donors/merge",{method:"POST",body:JSON.stringify({primaryId,secondaryId:o.id})});
      }
      setDone(`Merged ${countLabel(others.length, "duplicate")} into ${keep.name}.`);
      onMerged();
      load();
    }catch(e){setErr(errorMessage(e, "Merge failed."));}
    setBusy(false);
  }

  const fmtMoney=n=>"$"+(parseFloat(n)||0).toLocaleString();
  const ROWS=[
    ["Email",d=>d.email||"Not set"],["Phone",d=>d.phone||"Not set"],
    ["Total giving",d=>fmtMoney(d.total_giving)],["Gifts",d=>d.gift_count||0],
    ["Last gift",d=>d.last_gift_date||"Not set"],["Stage",d=>d.stage||"Not set"],
    // FLOWS-1 item 10: the same address fields as the profile's merge compare (it showed no street)
    ["Street",d=>d.address||"Not set"],["Apt",d=>d.address2||"Not set"],["City",d=>d.city||"Not set"],["State",d=>d.state||"Not set"],["ZIP",d=>d.zip||"Not set"],
    ["Added",d=>(d.created_at||"").split("T")[0]||"Not set"],
  ];

  return(
    <Modal className="commit-screen" onClose={onClose} width={760} zIndex={300} backdrop="rgba(15,26,18,0.72)" blur={false}
      padding={28} ariaLabel={"Merge duplicates"} dialogStyle={{borderRadius:20,border:"1px solid "+T.bg3}}>
      <div>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:6}}>
          <div>
            <div style={{fontSize:18,fontWeight:800,color:T.ink}}>Merge Duplicates</div>
            <div style={{fontSize:13,color:T.ink3,marginTop:2}}>Same email, or names close enough to be the same person, pick the record to keep.</div>
          </div>
          <button onClick={onClose} style={{background:T.bg3,border:"none",borderRadius:8,padding:"6px 12px",color:T.ink3,cursor:"pointer",fontSize:13,flexShrink:0}}>✕ Close</button>
        </div>

        {done&&<div style={{background:T.green100,border:"1px solid "+T.green200,borderRadius:10,padding:"10px 14px",fontSize:13,color:T.greenDk,fontWeight:600,margin:"10px 0"}}>✓ {done}</div>}
        {err&&<div style={{background:T.terra100,border:"1px solid "+T.terra200,borderRadius:10,padding:"10px 14px",fontSize:13,color:T.terra700,margin:"10px 0"}}>{err}</div>}

        {groups===null&&<div style={{display:"flex",alignItems:"center",gap:8,color:T.ink3,fontSize:13,padding:"24px 0"}}><Spin/>Checking your donor list…</div>}

        {groups&&groups.length===0&&!err&&(
          <div style={{textAlign:"center",padding:"36px 0",color:T.ink3}}>
            <div style={{fontSize:26,marginBottom:10,opacity:0.35}}>✓</div>
            <div style={{fontSize:14,fontWeight:600,color:T.ink2,marginBottom:4}}>Your donor list looks clean.</div>
            <div style={{fontSize:13}}>No shared emails, no near-identical names, nothing that needs merging today.</div>
          </div>
        )}

        {groups&&groups.map((g,gi)=>{
          const isOpen=open===gi;
          return(
            <div key={gi} style={{border:"1px solid "+T.bg3,borderRadius:12,marginTop:12,overflow:"hidden"}}>
              <button onClick={()=>{setOpen(isOpen?null:gi);setPrimaryId(null);}}
                style={{width:"100%",background:isOpen?T.bg:T.white,border:"none",padding:"12px 16px",display:"flex",justifyContent:"space-between",alignItems:"center",cursor:"pointer",gap:10}}>
                <span style={{fontSize:13,fontWeight:700,color:T.ink,textAlign:"left"}}>
                  <span style={{display:"inline-block",background:g.tier==="email"?T.bg2:T.gold100,color:T.ink,borderRadius:6,padding:"2px 8px",fontSize:10,fontWeight:800,marginRight:8,verticalAlign:"middle"}}>{g.tier==="email"?"SAME EMAIL":"SIMILAR NAME"}</span>
                  {g.donors.map(d=>d.name).join("  ·  ")}
                </span>
                <span style={{fontSize:12,color:T.ink3,flexShrink:0}}>{isOpen?"▲":"▼"}</span>
              </button>
              {isOpen&&(
                <div style={{padding:"14px 16px",borderTop:"1px solid "+T.bg3}}>
                  <div style={{overflowX:"auto"}}>
                    <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
                      <thead><tr>
                        <td style={{padding:"6px 10px"}}/>
                        {g.donors.map(d=>(
                          <td key={d.id} style={{padding:"6px 10px",verticalAlign:"top"}}>
                            <label style={{display:"flex",alignItems:"center",gap:7,cursor:"pointer",fontWeight:800,color:T.ink,whiteSpace:"nowrap"}}>
                              <input type="radio" name={"mergeprimary"+gi} checked={primaryId===d.id} onChange={()=>setPrimaryId(d.id)} style={{accentColor:T.greenDk}}/>
                              {d.name}
                            </label>
                            <div style={{fontSize:10,color:T.ink3,marginLeft:22,marginTop:1}}>{primaryId===d.id?"keeping this record":"keep this one?"}</div>
                          </td>
                        ))}
                      </tr></thead>
                      <tbody>
                        {ROWS.map(([label,fn])=>(
                          <tr key={label} style={{borderTop:"1px solid "+T.bg2}}>
                            <td style={{padding:"6px 10px",color:T.ink3,fontWeight:600,whiteSpace:"nowrap"}}>{label}</td>
                            {g.donors.map(d=>{
                              const v=fn(d);
                              return <td key={d.id} style={{padding:"6px 10px",color:T.ink2}}>{v}</td>;
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div style={{display:"flex",justifyContent:"flex-end",alignItems:"center",gap:10,marginTop:12}}>
                    <span style={{fontSize:12,color:T.ink3}}>Nothing is lost, gifts, notes, and history all move to the kept record.</span>
                    <button type="button" data-commit onClick={()=>doMerge(g)} disabled={!primaryId||busy||isReadOnly}
                      title={isReadOnly?"Reactivate your subscription to make changes.":undefined}
                      style={{background:(!primaryId||busy||isReadOnly)?T.bg3:T.greenDk,border:"none",borderRadius:10,padding:"9px 18px",color:(!primaryId||busy||isReadOnly)?T.ink3:T.white,fontSize:13,fontWeight:700,cursor:(!primaryId||busy||isReadOnly)?"not-allowed":"pointer"}}>
                      {busy?"Merging…":"Merge into kept record"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Modal>
  );
}
