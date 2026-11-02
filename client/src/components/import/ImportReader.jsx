import { T } from "../shared";
import Uploader from "../Uploader";
import { countLabel } from "../../../../shared/countWords.js";
import { STAGE_COLORS } from "../donorShared";

export function ImportReader({ applyParsed, bothMode, bothPayload, bothStagePreview, csvText, doImportBoth, doParse, err, handleFile, inp, loading, matchKey, moveAsked, moveLabel, moveSource, ownerRoutingUI, parsed, progress, setBothMode, setCsvText, setErr, setMatchKey, setMoveAsked, setSrcFile, setXlsxSheets, startImportBoth, workbook, workbookRoles, xlsxSheets }) {
  return (
      <>
        {/* ── Step 1a: Upload / Paste ── */}
        {!parsed && !xlsxSheets && !workbook && moveAsked && (<>
          <div style={{marginBottom:14}}>
            <div style={{fontSize:11,fontWeight:700,color:T.ink3,marginBottom:6}}>Upload file</div>
            <Uploader accept={[".csv",".tsv",".xlsx",".xls"]} acceptLabel=".csv, .tsv, .xlsx, .xls" compact readAs="none"
              label="Choose your spreadsheet, or drag it here"
              fileMeta={null}
              onFile={({file})=>{setSrcFile(file);handleFile({target:{files:[file]}});}}/>
            <div style={{fontSize:11,color:T.ink3,marginTop:5}}>A donor list or a gift export. We read your file and build your donors and their giving history. .csv, .tsv, .xlsx, .xls.</div>
            {moveSource && (
              <div data-testid="move-source-line" style={{fontSize:11.5,color:T.ink3,marginTop:6}}>
                Set up for your export from <strong style={{color:T.ink2}}>{moveLabel || moveSource}</strong>.{" "}
                <button onClick={()=>setMoveAsked(false)}
                  style={{background:"none",border:"none",color:T.greenDk,fontSize:11.5,
                          textDecoration:"underline",cursor:"pointer",padding:0}}>Change</button>
              </div>
            )}
          </div>
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14}}>
            <div style={{flex:1,height:1,background:T.bg3}}/><span style={{fontSize:12,color:T.ink3}}>or paste CSV text</span><div style={{flex:1,height:1,background:T.bg3}}/>
          </div>
          <textarea value={csvText} onChange={e=>setCsvText(e.target.value)} rows={6}
            placeholder={"Name,Email,Total Giving,Last Gift Date\nJane Smith,jane@example.com,5000,2024-11-01"}
            style={{...inp,resize:"vertical",lineHeight:1.5,marginBottom:12}}/>
          {err && <div style={{color:T.terracotta,fontSize:12,marginBottom:10}}>{err}</div>}
          <button onClick={doParse} disabled={!csvText.trim()}
            style={{background:csvText.trim()?T.green600:T.bg2,border:"none",borderRadius:10,padding:"11px 20px",color:T.white,fontSize:14,fontWeight:700,cursor:csvText.trim()?"pointer":"not-allowed",opacity:csvText.trim()?1:0.5}}>
            Parse →
          </button>
        </>)}

        {/* ── Step 1b: Multi-sheet picker (xlsx with 2+ data sheets) ── */}
        {!parsed && xlsxSheets && !bothMode && (<>
          <div style={{fontSize:14,fontWeight:700,color:T.ink,marginBottom:4}}>This workbook has {xlsxSheets.length} sheets with data.</div>
          <div style={{fontSize:13,color:T.ink3,marginBottom:16}}>Pick the sheet to import. You can import the others separately afterward.</div>

          {/* Primary CTA — a Donors + Gift History workbook: import both, linked */}
          {workbookRoles?.isBoth && (
            <div style={{background:`linear-gradient(180deg, ${T.green100}, ${T.white})`,border:`1.5px solid ${T.green600}`,borderRadius:12,padding:"14px 16px",marginBottom:16}}>
              <div style={{fontSize:10,fontWeight:700,color:T.green600,marginBottom:4}}>Donors + gift history detected</div>
              <div style={{fontSize:13.5,color:T.ink,lineHeight:1.5,marginBottom:10}}>
                <strong>{workbookRoles.donorSheet.name}</strong> ({workbookRoles.donorSheet.rowCount.toLocaleString()} donors) and{" "}
                <strong>{workbookRoles.giftSheet.name}</strong> ({workbookRoles.giftSheet.rowCount.toLocaleString()} gifts), we can link the gifts to their donors in one pass.
              </div>
              <button onClick={startImportBoth}
                style={{width:"100%",background:T.green600,border:"none",borderRadius:10,padding:"12px 20px",color:T.white,fontSize:14,fontWeight:700,cursor:"pointer"}}>
                Import both, donors + their gift history →
              </button>
            </div>
          )}

          {workbookRoles?.isBoth && (
            <div style={{fontSize:11,fontWeight:700,color:T.ink3,marginBottom:8}}>Or import one sheet at a time</div>
          )}
          <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:16}}>
            {xlsxSheets.map((s,i) => (
              <div key={s.name} style={{display:"flex",alignItems:"center",justifyContent:"space-between",background:T.bg,border:"1px solid "+T.bg3,borderRadius:10,padding:"12px 16px"}}>
                <div>
                  <div style={{fontSize:14,fontWeight:600,color:T.ink}}>{s.name}</div>
                  <div style={{fontSize:12,color:T.ink3,marginTop:2}}>{s.rowCount.toLocaleString()} rows · {s.headers.filter(Boolean).length} columns</div>
                </div>
                <button onClick={()=>applyParsed(s.headers,s.rows,s.physical,s.report)}
                  style={{background:T.greenDk,border:"none",borderRadius:8,padding:"8px 16px",color:T.white,fontSize:13,fontWeight:700,cursor:"pointer"}}>
                  {i===0?"Use this ←":"Select"}
                </button>
              </div>
            ))}
          </div>
          <button onClick={()=>setXlsxSheets(null)} style={{background:"transparent",border:"1px solid "+T.bg3,borderRadius:10,padding:"9px 16px",color:T.ink3,fontSize:13,cursor:"pointer"}}>← Back</button>
        </>)}

        {/* ── Import-both preview: two linked sheets, match column, counts ── */}
        {bothMode && bothPayload && (<>
          <div style={{background:T.gold100,border:`1px solid ${T.gold300}`,borderRadius:10,padding:"11px 14px",marginBottom:14}}>
            <div style={{fontSize:12.5,color:T.ink,lineHeight:1.5}}>
              <span style={{fontWeight:700}}>Importing both sheets:</span> donors from <strong>{bothMode.donorSheet.name}</strong>, giving history from <strong>{bothMode.giftSheet.name}</strong> each gift attached to its donor.
            </div>
          </div>

          {/* Match column selector — which shared field links a gift to its donor */}
          <div style={{marginBottom:14}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,flexWrap:"wrap"}}>
              <div style={{fontSize:13,fontWeight:700,color:T.ink}}>Link gifts to donors by</div>
              <select value={matchKey} onChange={e=>setMatchKey(e.target.value)}
                style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:7,padding:"5px 10px",color:T.ink,fontSize:12,outline:"none",cursor:"pointer"}}>
                {(bothMode.matchInfo.available.length ? bothMode.matchInfo.available : ["name"]).map(k => (
                  <option key={k} value={k}>{k === "email" ? "Email" : k === "donorId" ? "Donor ID column" : "Donor name"}</option>
                ))}
              </select>
            </div>
            <div style={{fontSize:11,color:T.ink3,marginTop:6}}>
              Matched on{" "}
              <strong>{matchKey === "email" ? (bothMode.matchInfo.giftEmailCol || "email") : matchKey === "donorId" ? (bothMode.matchInfo.giftIdCol || "donor id") : (bothMode.matchInfo.giftNameCol || "name")}</strong>.
              {" "}Unmatched gifts become new donor records, never dropped.
            </div>
          </div>

          {/* Counts */}
          <div style={{background:T.bg,borderRadius:10,padding:"12px 14px",marginBottom:12}}>
            <div style={{fontSize:13,fontWeight:700,color:T.ink,lineHeight:1.7}}>
              <span style={{color:T.green600}}>{(bothPayload.matchedGifts + bothPayload.unmatchedGifts).toLocaleString()}</span> gifts →{" "}
              <span style={{color:T.green600}}>{bothPayload.donors.length.toLocaleString()}</span> donors
              {bothPayload.unmatchedGifts > 0 && <> · <span style={{color:T.gold600}}>{bothPayload.unmatchedGifts.toLocaleString()}</span> unmatched → {countLabel(bothPayload.newDonors, "new donor")}</>}
              {bothPayload.donorWarned > 0 && <> · <span style={{color:T.gold600}}>{bothPayload.donorWarned.toLocaleString()}</span> warnings</>}
              {bothPayload.skippedGifts > 0 && <> · <span style={{color:T.ink3}}>{bothPayload.skippedGifts.toLocaleString()}</span> gift rows skipped (no amount / no donor)</>}
            </div>
          </div>

          {/* Smart stage preview over the real linked history */}
          {Object.keys(bothStagePreview).length > 0 && (
            <div style={{background:T.bg,borderRadius:10,padding:"10px 14px",marginBottom:12}}>
              <div style={{fontSize:10,fontWeight:700,color:T.ink3,marginBottom:6}}>Smart Stage Assignment Preview</div>
              <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                {Object.entries(bothStagePreview).map(([s,n]) => (
                  <span key={s} style={{fontSize:12,fontWeight:600,padding:"3px 10px",borderRadius:99,background:(STAGE_COLORS[s]||T.ink3)+"22",color:STAGE_COLORS[s]||T.ink3,border:`1px solid ${(STAGE_COLORS[s]||T.ink3)}30`}}>
                    {s} × {n}
                  </span>
                ))}
              </div>
              <div style={{fontSize:11,color:T.ink3,marginTop:6}}>Based on the linked giving history. Override after import by dragging in the Kanban.</div>
            </div>
          )}

          {/* Officer routing (Team) — owner column on the donor sheet → teammates */}
          {ownerRoutingUI()}

          {/* Progress bar — see A.7: only while the import is running. */}
          {progress && loading && (
            <div style={{marginBottom:12}}>
              <div style={{fontSize:12,color:T.ink,fontWeight:600,marginBottom:6}}>Importing {progress.done.toLocaleString()} of {progress.total.toLocaleString()}…</div>
              <div style={{height:8,background:T.bg3,borderRadius:99,overflow:"hidden"}}>
                <div style={{height:"100%",width:`${progress.total?Math.round(progress.done/progress.total*100):0}%`,background:T.green600,transition:"width 0.2s"}}/>
              </div>
            </div>
          )}

          {err && <div style={{color:T.terracotta,fontSize:12,marginBottom:10}}>{err}</div>}
          <div style={{display:"flex",gap:10}}>
            <button onClick={()=>{setBothMode(null);setErr("");}} disabled={loading}
              style={{background:"transparent",border:"1px solid "+T.bg3,borderRadius:10,padding:"11px 18px",color:T.ink3,fontSize:13,cursor:loading?"not-allowed":"pointer",opacity:loading?0.5:1}}>← Back</button>
            <button onClick={doImportBoth} disabled={loading||bothPayload.donors.length===0}
              style={{flex:1,background:loading||bothPayload.donors.length===0?T.bg2:T.green600,border:"none",borderRadius:10,padding:"11px 20px",color:T.white,fontSize:14,fontWeight:700,cursor:loading||bothPayload.donors.length===0?"not-allowed":"pointer",opacity:loading||bothPayload.donors.length===0?0.6:1}}>
              {loading?"Importing…":`Import ${bothPayload.donors.length.toLocaleString()} donors + ${(bothPayload.matchedGifts+bothPayload.unmatchedGifts).toLocaleString()} gifts →`}
            </button>
          </div>
        </>)}
      </>
  );
}
