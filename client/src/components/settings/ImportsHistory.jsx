import { useState, useEffect } from "react";
import { apiFetch } from "../../api";
import { errorMessage } from "../../lib/domainError";
import { urlParam } from "../../lib/appUrls";
import { T, SectionLabel, Modal } from "../shared";
import { MoveReport } from "../MoveIn";
import { displayDate, displayDateTime } from "../../../../shared/displayDate";
import ImportGiftLine from "../ImportGiftLine";
import ImportUndo from "../ImportUndo";
import { fmtCount, fmtMoney } from "./importsWords";

export function ImportsHistory(){
  const [rows,setRows]=useState(null);
  const [err,setErr]=useState("");
  const [open,setOpen]=useState(null);
  const [moveReportId,setMoveReportId]=useState(null);   // TRANS-1 Part 3
  useEffect(()=>{
    apiFetch("/imports").then(r=>setRows(Array.isArray(r.imports)?r.imports:[]))
      .catch(e=>{setRows([]);setErr(errorMessage(e,"Could not load your import history."));});
  },[]);
  const openOne=async(id)=>{
    setOpen({loading:true});
    try{ const r=await apiFetch("/imports/"+id); setOpen(r.import||null); }
    catch(e){ setOpen(null); setErr(errorMessage(e,"Could not open that import.")); }
  };
  // SEARCH-2: ⌘K opens Settings on one import (?import=<id>).
  useEffect(()=>{ const id=urlParam("settings","import"); if(id)openOne(id); },[]);  // eslint-disable-line react-hooks/exhaustive-deps
  const th={fontSize:10.5,fontWeight:700,color:T.ink3,textAlign:"left",padding:"0 12px 8px 0"};
  const td={fontSize:13,color:T.ink,padding:"10px 12px 10px 0",borderTop:"1px solid "+T.bg3,verticalAlign:"top"};
  return (
    <div style={{background:T.bgCard,border:"1px solid "+T.bg3,borderRadius:16,padding:"24px 28px"}}>
      <SectionLabel>Imports</SectionLabel>
      {moveReportId&&<MoveReport importId={moveReportId} onClose={()=>setMoveReportId(null)}/>}
      <div style={{fontSize:13,color:T.ink3,marginBottom:16,lineHeight:1.6,maxWidth:560}}>
        Every file you have loaded, newest first. Open one to see the receipt exactly as it read when it committed. Undo removes everything this import added.
      </div>
      {err&&<div style={{fontSize:12.5,color:T.terra700,marginBottom:12}}>{err}</div>}
      {rows===null&&<div style={{fontSize:13,color:T.ink3}}>Loading…</div>}
      {rows&&rows.length===0&&<div data-testid="imports-empty" style={{fontSize:13,color:T.ink3}}>No imports yet. The first file you load will appear here with its name.</div>}
      {rows&&rows.length>0&&(
        <div style={{overflowX:"auto"}}>
          <table data-testid="imports-table" style={{borderCollapse:"collapse",width:"100%",minWidth:640}}>
            <thead><tr>
              <th style={th}>Name</th><th style={th}>Date</th><th style={th}>Who</th>
              <th style={{...th,textAlign:"right"}}>Rows in</th>
              <th style={{...th,textAlign:"right"}}>Gifts created</th>
              <th style={{...th,textAlign:"right"}}>Dollars in</th>
            </tr></thead>
            <tbody>
              {rows.map(r=>(
                <tr key={r.id} data-testid="imports-row">
                  <td style={td}>
                    <button onClick={()=>(r.state==="in_progress"||r.state==="failed")?null:openOne(r.id)} data-testid="imports-open"
                      style={{background:"none",border:"none",padding:0,font:"inherit",fontWeight:700,color:T.green,cursor:"pointer",textAlign:"left"}}>
                      {r.name}
                    </button>
                    {r.reconciled===false&&r.state!=="undone"&&<div style={{fontSize:11.5,color:T.terra700,marginTop:2}}>Does not reconcile, open for the finding.</div>}
                    {/* FIX-52: a spreadsheet import still being written, or one rolled back */}
                    {(r.state==="in_progress"||r.state==="failed")&&<div data-testid="imports-state" style={{fontSize:11.5,color:r.state==="failed"?T.terra700:T.greenDk,marginTop:2}}>{r.sentence}</div>}
                    {r.state==="undone"&&<div style={{fontSize:11.5,color:T.ink3,marginTop:2}}>Undone</div>}
                    {/* BUILD-88a A.7 — a run made before funds and payment
                        methods were written says so, and says what to do. */}
                    {(r.notices||[]).map((n,i)=>(
                      <div key={i} data-testid="imports-notice" style={{fontSize:11.5,color:T.ink3,marginTop:2}}>{n}</div>
                    ))}
                    {/* TRANS-1 — a named import says where the file came from,
                        and opens its Move Report where it has one. */}
                    {r.migrationSource&&(
                      <div data-testid="imports-source" style={{fontSize:11.5,color:T.ink3,marginTop:2}}>
                        From {r.migrationSource}
                      </div>
                    )}
                    {/* FIX-37: what she answered about thanking the last 30 days. */}
                    {r.thanks&&(
                      <div data-testid="imports-thanks" style={{fontSize:11.5,color:T.ink3,marginTop:2}}>{r.thanks}</div>
                    )}
                    {r.hasMoveReport&&(
                      <button onClick={()=>setMoveReportId(r.id)} data-testid="imports-move-report"
                        style={{background:"none",border:"none",padding:0,marginTop:3,font:"inherit",
                                fontSize:11.5,color:T.greenDk,textDecoration:"underline",cursor:"pointer"}}>
                        Move Report
                      </button>
                    )}
                  </td>
                  <td style={td}>{r.committedOn?displayDate(r.committedOn):""}</td>
                  <td style={td}>{r.by||"Not recorded"}</td>
                  <td style={{...td,textAlign:"right"}}>{fmtCount(r.peopleSentence?(r.peopleRowsIn??(r.donorsCreated+(r.peopleMatched||0))):r.rowsIn)}</td>
                  <td style={{...td,textAlign:"right"}}>{fmtCount(r.giftsCreated)}</td>
                  {/* FIX-58: what came in as gifts, and what is pledged: never one sum */}
                  <td data-testid="imports-dollars" style={{...td,textAlign:"right"}}>{r.dollarsInWords||fmtMoney(r.dollarsIn)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {open&&(
        <Modal onClose={()=>setOpen(null)} width={620}
               title={open.loading?"Opening…":open.name}
               subtitle={open.loading?"":`${open.sourceFilename||"a file"} · ${open.by||"unknown"}`}>
          {open.loading?<div style={{fontSize:13,color:T.ink3}}>Loading…</div>:(
            <div data-testid="import-receipt">
              <div style={{display:"flex",gap:24,flexWrap:"wrap",marginBottom:16}}>
                <div><div style={{fontSize:10.5,fontWeight:700,color:T.ink3}}>{/* FIX-55: a contacts file adds people, not donors */}People added</div><div style={{fontSize:26,fontWeight:700,color:T.ink}}>{fmtCount(open.donorsCreated)}</div></div>
                <div><div style={{fontSize:10.5,fontWeight:700,color:T.ink3}}>Gifts</div><div style={{fontSize:26,fontWeight:700,color:T.ink}}>{fmtCount(open.giftLine?open.giftLine.rows:open.giftsCreated)}</div></div>
                <div><div style={{fontSize:10.5,fontWeight:700,color:T.ink3}}>Given</div><div style={{fontSize:26,fontWeight:700,color:T.ink}}>{fmtMoney(open.dollarsGiven??open.dollarsCreated)}</div></div>
                {open.dollarsPledged>0&&<div><div style={{fontSize:10.5,fontWeight:700,color:T.ink3}}>Pledged</div><div style={{fontSize:26,fontWeight:700,color:T.ink}}>{fmtMoney(open.dollarsPledged)}</div></div>}
              </div>
              {/* FIX-58: one accounting, each part opening its rows */}
              {open.giftLine&&<ImportGiftLine line={open.giftLine} importId={open.id} style={{marginBottom:12}}/>}
              {/* HARDEN-1: a file of people is counted in people, never "0 rows in the file" */}
              {/* IMPORT-7: a spreadsheet's receipt says each sheet's rows, each count named */}
              {open.sheetRows&&open.sheetRows.sheets.length ? <div data-testid="import-receipt-balance" style={{fontSize:12.5,color:open.sheetRows.file.balanced?T.ink3:T.terra700,marginBottom:12}}>
                {open.sheetRows.sheets.map(x=><div key={x.sheet} data-testid="import-receipt-sheet">{x.sentence}</div>)}
                {open.sheetRows.file.sentence&&<div style={{fontWeight:700}}>{open.sheetRows.file.sentence}</div>}
              </div> :
              open.peopleSentence ? <div data-testid="import-receipt-balance" style={{fontSize:12.5,color:T.ink3,marginBottom:12}}>{open.peopleSentence}</div> :
              <div data-testid="import-receipt-balance" style={{fontSize:12.5,color:open.reconciled?T.ink3:T.terra700,marginBottom:12}}>
                {fmtCount(open.rowsIn)} gift rows in the file = {fmtCount(open.giftsCreated)} {open.pledgesCreated?"gifts":"written"}{open.pledgesCreated?<> + {fmtCount(open.pledgesCreated)} pledges</>:null} + {fmtCount(open.rowsSetAside)} set aside + {fmtCount(open.rowsErrored)} errored {open.reconciled?"✓":"✗"}
              </div>}
              {open.pledgesCreated>0&&(
                <div style={{fontSize:12.5,color:T.ink3,marginBottom:12}}>
                  {fmtMoney(open.dollarsIn)} in the file = {fmtMoney(open.dollarsCreated)} in gifts + {fmtMoney(open.pledgeDollarsCreated)} in pledges (every year of each pledge, so more than a total row that counts one year), plus anything set aside.
                </div>
              )}
              {(open.notices||[]).map((n,i)=>(
                <div key={`n${i}`} data-testid="import-receipt-notice" style={{fontSize:12.5,color:T.ink3,background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"8px 10px",marginBottom:8}}>{n}</div>
              ))}
              {(open.findings||[]).map((f,i)=>(
                <div key={i} data-testid="import-finding" style={{fontSize:12.5,color:T.terra700,background:T.terra100,border:"1px solid "+T.terra200,borderRadius:8,padding:"8px 10px",marginBottom:8}}>{f}</div>
              ))}
              {open.summary&&open.summary.leadSentence&&(
                <div style={{fontSize:14,color:T.ink,lineHeight:1.6,marginBottom:12}}>{open.summary.leadSentence}</div>
              )}
              <div style={{fontSize:11.5,color:T.ink3}}>Recorded {open.committedAt?displayDateTime(open.committedAt):""}. Stored at the moment it committed, this screen never recomputes it.</div>
              {/* FIX-52: every receipt that undoes as a whole offers Undo for its
                  window, whether or not it reconciles. */}
              <div style={{marginTop:14,borderTop:"1px solid "+T.bg3,paddingTop:12}}>
                {/* IMPORT-8: just undone here, Undo stays on screen: who stayed, and Remove them too */}
                {open.justUndone
                  ? <ImportUndo importId={open.id} />
                  : open.reversedAt
                  ? <div data-testid="import-receipt-undone" style={{fontSize:12.5,color:open.undoneSentence?T.ink:T.ink3,fontWeight:open.undoneSentence?700:400}}>{open.undoneSentence||`Undone ${displayDate(open.reversedAt)}.`}</div>
                  : open.canUndo
                    ? <>
                        <ImportUndo importId={open.id} onUndone={r=>{ setOpen(o=>o?{...o,reversedAt:new Date().toISOString(),canUndo:false,undoneSentence:(r&&r.sentence)||null,justUndone:!!(r&&r.stayedCount)}:o); apiFetch("/imports").then(r=>setRows(Array.isArray(r.imports)?r.imports:[])).catch(()=>{}); }}/>
                        {open.undoUntil&&<div style={{fontSize:11.5,color:T.ink3,marginTop:6}}>Undo is open until {displayDate(open.undoUntil)}.</div>}
                      </>
                    : null}
              </div>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
