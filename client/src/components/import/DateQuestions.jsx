import { T, activeMark } from "../shared";
import { displayDate } from "../../../../shared/displayDate";

export function YearDatesQuestion({ effectiveShape, onConventionChange, setYearCols, yearCols, yearConvention }) {
  return (
<>
{/* Wide: year → gift-date convention */}
              {effectiveShape === "wide" && yearCols.length > 0 && (
                <div style={{marginTop:10,background:T.bg,borderRadius:10,padding:"10px 14px"}}>
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10}}>
                    <div style={{fontSize:11,fontWeight:700,color:T.ink3}}>Gift date per year column</div>
                    <select value={yearConvention} onChange={e=>onConventionChange(e.target.value)}
                      style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:6,padding:"4px 8px",color:T.ink,fontSize:11,outline:"none"}}>
                      <option value="dec31">End of year (Dec 31)</option>
                      <option value="first">Start of year (Jan 1)</option>
                    </select>
                  </div>
                  <div style={{display:"flex",gap:6,flexWrap:"wrap",marginTop:8}}>
                    {yearCols.map((yc,i)=>(
                      <span key={yc.col} onClick={()=>setYearCols(cols=>cols.map((c,j)=>j===i?{...c,enabled:!c.enabled}:c))}
                        style={{fontSize:11,fontWeight:600,padding:"3px 10px",borderRadius:7,cursor:"pointer",background:"transparent",color:T.ink3,border:"1px solid "+T.bg3,...activeMark(yc.enabled,"bottom")}}>
                        {yc.col} {yc.enabled?`→ ${displayDate(yc.date)||yc.date}`:"(off)"}
                      </span>
                    ))}
                  </div>
                </div>
              )}
</>
  );
}

export function MixedDatesQuestion({ dateConvEvidence, dateConventionChoice, setDateConventionChoice }) {
  return (
<>
{dateConvEvidence?.convention === "mixed" && (
                <div style={{background:T.gold100,border:`1px solid ${T.gold500}55`,borderRadius:8,padding:"10px 12px",marginTop:8,fontSize:12,color:T.ink,lineHeight:1.6}}>
                  <div style={{fontWeight:700,marginBottom:4}}>This date column mixes conventions, we won't guess.</div>
                  <div style={{color:T.ink2}}>
                    {dateConvEvidence.dayFirstEvidence.toLocaleString()} dates only work day-first (e.g. {dateConvEvidence.dayFirstExamples.join(", ")}) and {dateConvEvidence.monthFirstEvidence.toLocaleString()} only work month-first (e.g. {dateConvEvidence.monthFirstExamples.join(", ")}). Choose which to apply; impossible dates under your choice will be refused with their line numbers.
                  </div>
                  <div style={{display:"flex",gap:8,marginTop:8}}>
                    {[["dmy","Day / Month / Year"],["mdy","Month / Day / Year"]].map(([v,l])=>(
                      <button key={v} aria-pressed={dateConventionChoice===v} onClick={()=>setDateConventionChoice(v)}
                        style={{background:"transparent",border:"1px solid "+T.bg3,borderRadius:7,padding:"6px 12px",color:T.ink,fontSize:12,fontWeight:700,cursor:"pointer",...activeMark(dateConventionChoice===v,"bottom")}}>{l}</button>
                    ))}
                  </div>
                </div>
              )}
</>
  );
}

export function DateFormatNote({ dateConvEvidence }) {
  return (
<>
{/* BUILD-80 Part 2.2 — the date column has a convention, decided
                  at the column level and SAID here before the write. */}
              {dateConvEvidence && dateConvEvidence.slashCells > 0 && dateConvEvidence.convention === "dmy" && (
                <div style={{background:T.bg2,border:`1px solid ${T.bg3}`,borderRadius:8,padding:"8px 12px",marginTop:8,fontSize:12,color:T.ink,lineHeight:1.5}}>
                  {dateConvEvidence.slashCells.toLocaleString()} dates use <strong>day/month/year</strong>. {dateConvEvidence.dayFirstEvidence.toLocaleString()} would have been impossible the other way (e.g. {dateConvEvidence.dayFirstExamples.join(", ")}), every slash date in this column will be read day-first.
                </div>
              )}
              {dateConvEvidence && dateConvEvidence.slashCells > 0 && (dateConvEvidence.convention === "mdy" || dateConvEvidence.convention === "default-mdy") && (
                <div style={{fontSize:11,color:T.ink3,marginTop:8}}>
                  {dateConvEvidence.convention === "mdy"
                    ? `${dateConvEvidence.slashCells.toLocaleString()} dates use month/day/year, ${dateConvEvidence.monthFirstEvidence.toLocaleString()} would have been impossible the other way.`
                    : `${dateConvEvidence.slashCells.toLocaleString()} slash dates are all ambiguous, read as US month/day/year by default.`}
                </div>
              )}
</>
  );
}
