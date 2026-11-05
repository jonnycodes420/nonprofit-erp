import { T, fmtFull } from "../shared";
import { countLabel, plural } from "../../../../shared/countWords.js";
import { cp1252RowNames } from "./reader";
import { SHAPE_CHOICE } from "./fields";
import { shapeLabel } from "../../../../shared/importShape";

export function ImportDetection({ aggregateCollapse, effectiveShape, parseReport, parsed, setShapeOverride, shapeDetail, shapeOverride }) {
  return (
        <>
          {/* BUILD-79 Part 1.2/1.3/1.4 — report chrome is SHOWN, never imported,
              never counted. Everything above the detected header, every repeated
              header / page line / TOTAL / end marker by line number, and any
              windows-1252 repair. */}
          {parseReport && (parseReport.chromeAbove?.length > 0 || parseReport.chromeRows?.length > 0 || parseReport.cp1252Lines?.length > 0) && (
            <div style={{background:T.bg,border:`1px solid ${T.bg3}`,borderRadius:10,padding:"11px 14px",marginBottom:10,fontSize:12.5,color:T.ink,lineHeight:1.6}}>
              <div style={{fontSize:10,fontWeight:700,color:T.ink3,marginBottom:4}}>This looks like a report export, here's what we set aside</div>
              {parseReport.chromeAbove?.length > 0 && (
                <div>We skipped {countLabel(parseReport.chromeAbove.length, "line")} above your column headers (found on line {parseReport.headerLine?.line}){": "}
                  {parseReport.chromeAbove.map(c => c.text ? `“${c.text}”` : "(blank)").join(", ")}.</div>
              )}
              {parseReport.chromeRows?.length > 0 && (
                <div>Not imported, not counted: {parseReport.chromeRows.map(c => {
                  const label = c.kind === "repeated_header" ? "repeated header" : c.kind === "page_marker" ? "page marker"
                    : c.kind === "total_row" ? "the report's own TOTAL row" : c.kind === "subtotal_row" ? "subtotal"
                    : c.kind === "end_marker" ? "end-of-report marker" : c.kind === "currency_only" ? "a bare total figure" : c.kind;
                  return `${label} (line ${c.line})`;
                }).join(" · ")}.</div>
              )}
              {parseReport.totalRow && (
                <div>Your file's own total row says <strong>{fmtFull(parseReport.totalRow.amount)}</strong> we'll reconcile against it after the import.</div>
              )}
              {parseReport.cp1252Lines?.length > 0 && (() => {
                const affected = cp1252RowNames(parseReport, parsed);
                return <div>{affected.length || parseReport.cp1252Lines.length} {plural((affected.length||parseReport.cp1252Lines.length), "name")} contained Windows-1252 characters and were converted{affected.length ? `: ${affected.map(n=>`“${n}”`).join(" · ")}` : ""}.</div>;
              })()}
              {/* BUILD-80 Part 3 — the source system double-encoded some
                  characters ("æ\u009D\u008E" was 李); each reversal is a
                  byte-exact repair, counted and shown, never silent. */}
              {parseReport.mojibakeRepaired > 0 && (
                <div>{countLabel(parseReport.mojibakeRepaired, "character sequence")} arrived double-encoded from the source system and {parseReport.mojibakeRepaired===1?"was":"were"} repaired ({parseReport.mojibakeRepairs.slice(0,5).map(r=>r.sequence).join(" · ")}).</div>
              )}
            </div>
          )}

          {/* Detection banner + override — BUILD-79 Part 2: the decision shows
              its evidence, and with too little evidence it becomes a QUESTION. */}
          <div style={{background:effectiveShape==="unknown"?T.terra100:T.gold100,border:`1px solid ${effectiveShape==="unknown"?T.terra200:T.gold300}`,borderRadius:10,padding:"11px 14px",marginBottom:14,display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,flexWrap:"wrap"}}>
            {/* FIX-10 E — "WE DETECTED" AND "NOT ENOUGH EVIDENCE" ARE NEVER IN
                ONE SENTENCE. Overriding an undetectable file kept the detector's
                reason beside the new shape, so the banner read "We detected:
                individual gifts (only 1 column recognised, not enough evidence
                to pick a shape)": one sentence claiming a finding and admitting
                it had none. There are three states, not two.
                  · she chose it   → "You chose: …", and no detector reason at all
                  · nothing found  → "We can't tell: …", with the reason
                  · found          → "We detected: …", with the reason */}
            <div style={{fontSize:12.5,color:T.ink,lineHeight:1.5}} data-testid="shape-banner"
                 data-shape-source={shapeOverride?"chosen":effectiveShape==="unknown"?"unknown":"detected"}>
              {shapeOverride ? (<>
                <span style={{fontWeight:700}}>You chose:</span>{" "}
                {SHAPE_CHOICE[effectiveShape]||shapeLabel(effectiveShape)}.
              </>) : (<>
                <span style={{fontWeight:700}}>{effectiveShape==="unknown"?"We can't tell:":"We detected:"}</span>{" "}
                {shapeLabel(effectiveShape)}.
                {shapeDetail?.reason && <span style={{color:T.ink3}}> ({shapeDetail.reason})</span>}
              </>)}
            </div>
            <select value={effectiveShape} onChange={e=>setShapeOverride(e.target.value)}
              style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:7,padding:"5px 8px",color:T.ink,fontSize:12,outline:"none",cursor:"pointer"}}>
              {effectiveShape==="unknown" && <option value="unknown">Choose the file's shape</option>}
              <option value="aggregate">One row per donor (totals)</option>
              <option value="transaction">One row per gift</option>
              <option value="wide">Year columns</option>
            </select>
          </div>

          {/* BUILD-79 Part 2.2 — totals mode REFUSES a per-gift file. */}
          {aggregateCollapse?.refuse && (
            <div style={{background:T.terra100,border:`1px solid ${T.terra200}`,borderRadius:10,padding:"11px 14px",marginBottom:14,fontSize:12.5,color:T.terra700,lineHeight:1.6}}>
              <strong>{aggregateCollapse.collapsed.toLocaleString()} of {aggregateCollapse.keyedRows.toLocaleString()} rows collapse onto a donor already in this file.</strong>{" "}
              One row per donor would silently merge them, this file looks like one row per <em>gift</em>. Import as totals is disabled.
              <button onClick={()=>setShapeOverride("transaction")}
                style={{display:"block",marginTop:8,background:T.green600,border:"none",borderRadius:8,padding:"8px 14px",color:T.white,fontSize:12.5,fontWeight:700,cursor:"pointer"}}>
                Treat as individual gifts →
              </button>
            </div>
          )}
        </>
  );
}
