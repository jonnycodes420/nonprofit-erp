import { Modal, T } from "../shared";
import { ImportProgress, ImportReadout } from "./ImportProgress";
import { plural, countLabel } from "../../../../shared/countWords.js";
import { IMPORT_REASON_LABELS } from "./reader";
import { apiFetch } from "../../api";
import { errorMessage } from "../../lib/domainError";
import { displayDate } from "../../../../shared/displayDate";
import { anyFieldLabel } from "./fields";

export function ImportDone({ flaggedPage, hasBatchErrors, onClose, onImported, result, setErr, setFlaggedPage, setResult, setUndoBusy, undoBusy }) {
  return (
<Modal className="commit-screen" onClose={onClose} width={700} zIndex={300} backdrop="rgba(15,26,18,0.72)" blur={false}
        padding={28} ariaLabel={"Import result"} dialogStyle={{borderRadius:20,border:"1px solid "+T.bg3}}>
        <div style={{textAlign:"center"}}>
          {/* BUILD-79 Part 3.3 — the check mark is EARNED: amount + date
              mapped, non-zero dollars, both axes balanced. Anything less is
              amber and names what is missing. */}
          <div style={{fontSize:36,marginBottom:12,color:hasBatchErrors?T.terracotta:(result.summaryHealth&&!result.summaryHealth.greenEarned)?T.gold600:T.ink}}>
            {hasBatchErrors?"✕":(result.summaryHealth&&!result.summaryHealth.greenEarned)?"◑":"✓"}
          </div>
          <div style={{fontFamily:"'DM Serif Display',Georgia,serif",fontSize:22,fontWeight:400,color:T.ink,marginBottom:12,letterSpacing:"-0.01em"}}>
            {hasBatchErrors ? "Import finished with errors." : (result.summaryHealth&&!result.summaryHealth.greenEarned) ? "Imported, with gaps you should read." : "Import complete."}
          </div>
          {result.working&&!result.readout&&(
            <ImportProgress runId={result.runId} onDone={r=>setResult(x=>(x?{...x,working:false,readout:r.readout||x.readout}:x))}/>
          )}
          <ImportReadout readout={result.readout}/>
          {result.summaryHealth && !result.summaryHealth.greenEarned && result.summaryHealth.missing.length > 0 && (
            <div style={{textAlign:"left",background:T.gold100,border:`1px solid ${T.gold300}`,borderRadius:10,padding:"10px 14px",marginBottom:12,fontSize:12.5,color:T.ink,lineHeight:1.7}}>
              <div style={{fontSize:10,fontWeight:800,color:T.gold700,marginBottom:4}}>What's missing before this counts as fully accounted for</div>
              {result.summaryHealth.missing.map((m,i)=><div key={i}>· {m}</div>)}
            </div>
          )}
          <div style={{fontSize:14,color:T.ink3,marginBottom:hasBatchErrors?12:28,lineHeight:1.8}}>
            <strong style={{color:T.ink}}>{result.created}</strong> donors added
            {result.giftsInserted > 0 && <> · <strong>{result.giftsInserted}</strong> gifts attached</>}
            {result.duplicatesInFile > 0 && <> · <strong>{result.duplicatesInFile}</strong> duplicate {plural(result.duplicatesInFile, "row")} within this file collapsed</>}
            {result.duplicatesOnFile > 0 && <> · <strong>{result.duplicatesOnFile}</strong> matched {plural(result.duplicatesOnFile, "record")} already in Steward</>}
            {result.duplicates > 0 && !result.duplicatesInFile && !result.duplicatesOnFile && <> · <strong>{result.duplicates}</strong> duplicates skipped</>}
            {result.twinCandidates > 0 && <> · <strong>{result.twinCandidates}</strong> same-day/same-amount twins imported (reviewable)</>}
            {result.newDonors > 0 && <> · <strong>{result.newDonors}</strong> created from unmatched gifts</>}
            {result.warned > 0    && <> · <strong>{result.warned}</strong> imported with warnings</>}
            {result.skipped > 0   && <> · <strong>{result.skipped.toLocaleString()}</strong> {result.refusedRows?.length ? "refused with line-numbered reasons" : "skipped (no name, email, or organization)"}</>}
          </div>
          {/* BUILD-101 Part 6 — the memberships, and every row held, by line. */}
          {result.memberships?.rows > 0 && (
            <div data-testid="import-memberships" style={{textAlign:"left",fontSize:13,color:T.ink,lineHeight:1.7,marginBottom:16}}>
              <strong>{result.memberships.written}</strong> {plural(result.memberships.written, "membership")} imported as history (no payments posted)
              {result.memberships.skippedDuplicate > 0 && <> · <strong>{result.memberships.skippedDuplicate}</strong> already on file</>}
              {result.memberships.held.length > 0 && <> · <strong>{result.memberships.held.length}</strong> held for you:</>}
              {result.memberships.held.slice(0, 20).map((h, i) => (
                <div key={i} style={{color:T.ink3}}>{h.line ? `Line ${h.line}` : "A row"}{h.name ? ` (${h.name})` : ""}: {h.why}</div>))}
              {result.memberships.held.length > 20 && <div style={{color:T.ink3}}>and {result.memberships.held.length - 20} more.</div>}
            </div>)}
          {/* BUILD-72 Part 1 — THE RECONCILIATION, on the user's screen.
              rows_in_file = created + skipped + errored, and the same for
              dollars. The user sees the arithmetic, not a reassurance that it
              worked. If it does not balance the server has already refused the
              import (409) and nothing was written — this panel only ever
              renders a balanced file or the shape of what went where. */}
          {result.reconciliation && result.reconciliation.rows.inFile > 0 && (() => {
            const R = result.reconciliation;
            const money = n => "$" + Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
            const line = (label, rows, dollars, tone) => (
              <div style={{display:"flex",justifyContent:"space-between",gap:12,color:tone||T.ink2}}>
                <span>{label}</span>
                <span style={{fontVariantNumeric:"tabular-nums"}}>{rows.toLocaleString()} · {money(dollars)}</span>
              </div>
            );
            return <div style={{textAlign:"left",background:T.bg2,border:`1px solid ${T.bg3}`,borderRadius:10,padding:"12px 16px",marginBottom:16,fontSize:12,lineHeight:1.8}}>
              <div style={{fontSize:10,fontWeight:800,color:(result.summaryHealth&&!result.summaryHealth.greenEarned)?T.gold700:T.ink3,marginBottom:6}}>
                {(result.summaryHealth&&!result.summaryHealth.greenEarned) ? "The arithmetic, read the gaps above before trusting it" : "Every row and every dollar accounted for"}
              </div>
              <div style={{display:"flex",justifyContent:"space-between",gap:12,color:T.ink}}>
                <span>In your file</span>
                <span style={{fontVariantNumeric:"tabular-nums"}}>
                  {/* BUILD-84 P0-1 — "no amount-shaped column found" was false
                      whenever currency columns existed and none was MAPPED, which
                      is the common case for a file that carries no gifts. */}
                  {R.rows.inFile.toLocaleString()} · {R.dollars.inFile == null
                    ? ((R.dollars.currencyColumns || []).length ? "unknown, no column is mapped as the gift amount" : "unknown, no column in this file reads as currency")
                    : money(R.dollars.inFile)}
                </span>
              </div>
              {R.dollars.scanColumn && R.dollars.inFile != null && (
                <div style={{paddingLeft:12,color:T.ink3,fontSize:11}}>dollars scanned independently from your “{R.dollars.scanColumn}” column, not from the mapping</div>
              )}
              {/* BUILD-80 Part 1.2 — the number-format conventions the parser
                  actually applied, shown so a $2,000 gift can never silently
                  become $200,000 again without this line saying why. */}
              {result.amountConventions?.commaDecimal > 0 && (
                <div style={{paddingLeft:12,color:T.ink3,fontSize:11}}>{countLabel(result.amountConventions.commaDecimal, "amount")} used a comma decimal (European format) and {result.amountConventions.commaDecimal===1?"was":"were"} read as such</div>
              )}
              {result.dateConvention?.applied === "dmy" && (
                <div style={{paddingLeft:12,color:T.ink3,fontSize:11}}>{result.dateConvention.slashCells.toLocaleString()} dates use day/month/year, {result.dateConvention.dayFirstEvidence.toLocaleString()} would have been impossible the other way</div>
              )}
              {result.amountConventions?.spaceThousands > 0 && (
                <div style={{paddingLeft:12,color:T.ink3,fontSize:11}}>{countLabel(result.amountConventions.spaceThousands, "amount")} used a space between thousands and {result.amountConventions.spaceThousands===1?"was":"were"} read as such</div>
              )}
              <div style={{height:1,background:T.bg3,margin:"6px 0"}} />
              {line("Imported", R.rows.created, R.dollars.created)}
              {R.rows.skipped > 0 && line("Skipped", R.rows.skipped, R.dollars.skipped)}
              {Object.entries(R.skippedReasons || {}).map(([reason, v]) =>
                <div key={reason} style={{paddingLeft:12,color:T.ink3,fontSize:11}}>
                  {IMPORT_REASON_LABELS[reason] || reason.replace(/_/g," ")}: {v.rows.toLocaleString()} · {money(v.dollars)}
                </div>)}
              {R.rows.errored > 0 && line("Errored", R.rows.errored, R.dollars.errored, T.terracotta)}
              {Object.entries(R.erroredReasons || {}).map(([reason, v]) =>
                <div key={reason} style={{paddingLeft:12,color:T.terracotta,fontSize:11}}>
                  {IMPORT_REASON_LABELS[reason] || reason.replace(/_/g," ")}: {v.rows.toLocaleString()} · {money(v.dollars)}
                </div>)}
              <div style={{height:1,background:T.bg3,margin:"6px 0"}} />
              <div style={{display:"flex",justifyContent:"space-between",gap:12,fontWeight:700,
                           color: R.balanced ? T.ink : T.terracotta}}>
                <span>{R.balanced ? "Balanced" : "DOES NOT BALANCE"}</span>
                <span style={{fontVariantNumeric:"tabular-nums"}}>
                  {(R.rows.created + R.rows.skipped + R.rows.errored).toLocaleString()} · {money(R.dollars.created + R.dollars.skipped + R.dollars.errored)}
                </span>
              </div>
              {/* BUILD-77 Part 3b — if an org cannot get back what Steward
                  refused, Steward ate it. Exactly the skipped+errored rows,
                  with line number and reason, as a CSV. */}
              {result.refusedRows?.length > 0 && (
                <div style={{marginTop:8,paddingTop:8,borderTop:`1px solid ${T.bg3}`}}>
                  <button onClick={()=>{
                    const esc=v=>{const t=String(v??"");return /[",\n]/.test(t)?'"'+t.replace(/"/g,'""')+'"':t;};
                    const rawHeaders=Object.keys(result.refusedRows[0].raw||{});
                    const lines=[["Line","Disposition","Reason",...rawHeaders].map(esc).join(",")];
                    for(const r of result.refusedRows) lines.push([r.line,r.disposition,r.reason||"",...rawHeaders.map(h=>r.raw?.[h]??"")].map(esc).join(","));
                    const blob=new Blob([lines.join("\n")],{type:"text/csv"});
                    const a=document.createElement("a");a.href=URL.createObjectURL(blob);
                    a.download="not-imported-rows.csv";a.click();URL.revokeObjectURL(a.href);
                  }} style={{background:"transparent",border:"none",padding:0,color:T.greenDk,fontSize:12,fontWeight:700,cursor:"pointer"}}>
                    {(()=>{
                      // BUILD-80 Part 10 — the download keeps EVERYTHING that
                      // isn't a gift row, but the label separates true
                      // refusals from rows routed to their own surfaces.
                      const refusedN = result.refusedRows.filter(r2=>r2.disposition==="errored"||["no_amount","zero_amount"].includes(r2.reason)).length;
                      const routedN = result.refusedRows.length - refusedN;
                      return <>↓ Download the {result.refusedRows.length} rows that are not gift rows ({refusedN} refused · {routedN} routed to pledge/soft-credit/in-kind surfaces), line numbers + reasons</>;
                    })()}
                  </button>
                </div>
              )}
              {result.fileTotalRow && (
                <div style={{marginTop:8,paddingTop:8,borderTop:`1px solid ${T.bg3}`,color:T.ink2}}>
                  <div style={{fontWeight:700,color:T.ink}}>Your file's own total row (line {result.fileTotalRow.line}) says {money(result.fileTotalRow.stated)}.</div>
                  <div>Steward imported {money(result.fileTotalRow.imported)} · difference {money(Math.abs(result.fileTotalRow.difference))}{result.fileTotalRow.difference < 0 ? " (Steward imported MORE than the report's total)" : ""}</div>
                  {/* BUILD-80 Part 1.5 — when Steward imported MORE than the
                      report's own total, skipped and errored rows cannot be
                      the reason (refusing rows only ever lowers the import).
                      The line says what it can't explain instead of
                      manufacturing a cause. */}
                  {result.fileTotalRow.difference < 0 && (
                    <div style={{color:T.terracotta,fontSize:11}}>
                      We cannot explain importing more than the report's own total, that usually means an amount was misread
                      (a European decimal, a shifted column) or the report's total excludes rows we counted. Check the largest
                      gifts below before trusting these numbers.
                    </div>
                  )}
                  {result.fileTotalRow.difference > 0 && (
                    <div style={{color:T.ink3,fontSize:11}}>
                      of which: skipped rows {money(result.fileTotalRow.explained.skipped)} · errored rows {money(result.fileTotalRow.explained.errored)}
                      {Math.abs(result.fileTotalRow.difference) - result.fileTotalRow.explained.skipped - result.fileTotalRow.explained.errored > 0.005 &&
                        <> · the rest is how the report itself counted (its total may exclude soft credits, pledges or duplicates, compare before trusting either number)</>}
                    </div>
                  )}
                </div>
              )}
              {result.warnedRows?.length > 0 && (
                <div style={{marginTop:8,paddingTop:8,borderTop:`1px solid ${T.bg3}`}}>
                  <button onClick={()=>{
                    const esc=v=>{const t=String(v??"");return /[",\n]/.test(t)?'"'+t.replace(/"/g,'""')+'"':t;};
                    const rawHeaders=Object.keys(result.warnedRows[0].raw||{});
                    const lines=[["Line","Warnings",...rawHeaders].map(esc).join(",")];
                    for(const r of result.warnedRows) lines.push([r.line,(r.reasons||[]).join(" | "),...rawHeaders.map(h=>r.raw?.[h]??"")].map(esc).join(","));
                    const blob=new Blob([lines.join("\n")],{type:"text/csv"});
                    const a=document.createElement("a");a.href=URL.createObjectURL(blob);
                    a.download="imported-with-warnings.csv";a.click();URL.revokeObjectURL(a.href);
                  }} style={{background:"transparent",border:"none",padding:0,color:T.gold700,fontSize:12,fontWeight:700,cursor:"pointer"}}>
                    ↓ Download the {result.warnedRows.length} rows imported with warnings (line numbers + reasons)
                  </button>
                </div>
              )}
              {result.matchesExistingCount > 0 && (
                <div style={{marginTop:8,paddingTop:8,borderTop:`1px solid ${T.bg3}`,color:T.ink2}}>
                  <strong style={{color:T.ink}}>{result.matchesExistingCount}</strong>{" "}
                  {result.matchesExistingCount === 1 ? "gift matches one" : "gifts match ones"} already on file
                  (same donor, date and amount). {result.matchesExistingCount === 1 ? "It was" : "They were"} imported, review and delete any that are genuine duplicates.
                </div>
              )}
              {/* BUILD-73 Part 2 — this used to read "Amounts are stored in whole
                  dollars; $X of cents was rounded off." It is no longer true:
                  the money seam (money.js) stores what the file said, to the
                  cent. BUILD-72 P3-4 asked that a future cents fix come to this
                  line and change it deliberately — this is that change.
                  roundingAdjustment is still reported by the API and is now
                  always 0; if it ever isn't, a rounding path has come back and
                  the user should be told, so the surfacing stays. */}
              {Math.abs(result.roundingAdjustment || 0) >= 0.005 && (
                <div style={{marginTop:6,color:T.terra700,fontSize:11}}>
                  {money(Math.abs(result.roundingAdjustment))} of cents could not be stored, please report this.
                </div>
              )}
            </div>;
          })()}
          {/* BUILD-80 Part 8 — stale Frequency flags: the pattern wins, and
              the flag is SHOWN rather than silently overridden. */}
          {result.frequencyConflicts?.length > 0 && (
            <div style={{textAlign:"left",background:T.bg2,border:`1px solid ${T.bg3}`,borderRadius:10,padding:"12px 16px",marginBottom:16,fontSize:12,lineHeight:1.7}}>
              <div style={{fontSize:10,fontWeight:800,color:T.ink3,marginBottom:6}}>
                Frequency flags the gifts contradict
              </div>
              {result.frequencyConflicts.slice(0,10).map((c,i)=>(
                <div key={i} style={{color:T.ink2}}><strong style={{color:T.ink}}>{c.name}</strong>: {c.message}. The pattern wins; no monthly expectations were set.</div>
              ))}
            </div>
          )}
          {/* BUILD-80 Part 6.2 — every merge the importer made, reviewable and
              reversible: the surviving record, the folded variants, the
              reason. Undo splits them back with their gifts. */}
          {(result.mergeRows?.length > 0 || result.identity?.mergeReview?.length > 0) && (() => {
            const merges = result.mergeRows?.length ? result.mergeRows : (result.identity.mergeReview || []).map(m => ({ ...m, id: null }));
            return <div style={{textAlign:"left",background:T.bg2,border:`1px solid ${T.bg3}`,borderRadius:10,padding:"12px 16px",marginBottom:16,fontSize:12,lineHeight:1.7}}>
              <div style={{fontSize:10,fontWeight:800,color:T.ink3,marginBottom:6}}>
                Rows we merged into one donor, review these
              </div>
              {merges.slice(0,25).map((m,i)=>(
                <div key={i} style={{display:"flex",justifyContent:"space-between",gap:10,alignItems:"baseline"}}>
                  <span style={{minWidth:0,color:T.ink2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                    <strong style={{color:T.ink}}>{m.surviving}</strong>
                    {" ← "}{m.folded.map(f=>`${f.label} (${f.via})`).join(" · ")}
                  </span>
                  {m.id && (
                    <button onClick={async()=>{
                      try { await apiFetch(`/import-merges/${m.id}/undo`, { method:"POST", body: JSON.stringify({}) });
                        setResult(r=>({ ...r, mergeRows: r.mergeRows.map(x=>x.id===m.id?{...x, undone:true}:x) }));
                      } catch(e){ alert(errorMessage(e, "Undo failed")); }
                    }} disabled={m.undone}
                      style={{background:"transparent",border:`1px solid ${T.bg3}`,borderRadius:6,padding:"2px 8px",color:m.undone?T.ink3:T.ink,fontSize:11,cursor:m.undone?"default":"pointer",flexShrink:0}}>
                      {m.undone ? "Split back" : "Undo"}
                    </button>
                  )}
                </div>
              ))}
              {merges.length > 25 && <div style={{color:T.ink3}}>+{merges.length-25} more merges recorded, every one is undoable.</div>}
              {result.identity?.householdCandidates?.length > 0 && (
                <div style={{marginTop:6,paddingTop:6,borderTop:`1px solid ${T.bg3}`,color:T.ink3,fontSize:11}}>
                  {countLabel(result.identity.householdCandidates.length, "email")} sit behind more than one person (e.g. {result.identity.householdCandidates[0].names.join(" + ")}), kept as separate people, household candidates for you to join.
                </div>
              )}
              {result.identity?.conflictedIds?.length > 0 && (
                <div style={{marginTop:4,color:T.ink3,fontSize:11}}>
                  {result.identity.conflictedIds.length} donor {plural(result.identity.conflictedIds.length, "ID")} shared by different people (legacy merge damage), never merged on, both sides flagged.
                </div>
              )}
            </div>;
          })()}
          {/* BUILD-80 Part 5.2 — the rows that are NOT gifts, each on its own
              line with rows and dollars, outside net cash. */}
          {result.semantics?.tally && (() => {
            const t = result.semantics.tally;
            const money = n => "$" + Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
            const rows = [
              ["Soft credits", t.softCredits, "a link to the real gift, no money on the credited person"],
              ["Pledge commitments", t.pledges, "on the donor's record, never in totals"],
              ["Future pledge installments", t.pledgeScheduled, "the schedule, money that hasn't arrived yet"],
              ["In-kind gifts", t.inKind, "recorded at fair market value, never cash"],
              ["Corporate matching gifts", t.matching, "counted as cash on the CORPORATION; the person gets the relationship"],
              ["Anonymous gifts", t.anonymous, "one holding record, different people, never a cadence, never on a list"],
            ].filter(([, v]) => v && v.rows > 0);
            if (!rows.length) return null;
            return <div style={{textAlign:"left",background:T.bg2,border:`1px solid ${T.bg3}`,borderRadius:10,padding:"12px 16px",marginBottom:16,fontSize:12,lineHeight:1.8}}>
              <div style={{fontSize:10,fontWeight:800,color:T.ink3,marginBottom:6}}>
                Rows that are not gifts, tracked on their own surfaces
              </div>
              {rows.map(([label, v, hint]) => (
                <div key={label}>
                  <div style={{display:"flex",justifyContent:"space-between",gap:12,color:T.ink}}>
                    <span>{label}</span>
                    <span style={{fontVariantNumeric:"tabular-nums"}}>{v.rows.toLocaleString()} · {money(v.dollars)}</span>
                  </div>
                  <div style={{paddingLeft:12,color:T.ink3,fontSize:11}}>{hint}</div>
                </div>
              ))}
              {result.semanticsApplied && (
                <div style={{marginTop:6,paddingTop:6,borderTop:`1px solid ${T.bg3}`,color:T.ink3,fontSize:11}}>
                  Recorded: {countLabel(result.semanticsApplied.pledges, "pledge")} · {result.semanticsApplied.inKind} in-kind · {countLabel(result.semanticsApplied.links, "relationship link")}{result.semanticsApplied.personsCreated ? ` · ${result.semanticsApplied.personsCreated} people created from links` : ""}{result.semanticsApplied.twinsFlagged ? ` · ${result.semanticsApplied.twinsFlagged} possible duplicates flagged for review` : ""}
                </div>
              )}
              {result.semanticsError && (
                <div style={{marginTop:6,color:T.terracotta,fontSize:11}}>These rows could not be recorded: {result.semanticsError}</div>
              )}
              {result.semantics.reviewTwins?.length > 0 && (
                <div style={{marginTop:4,color:T.ink3,fontSize:11}}>{result.semantics.reviewTwins.length} rows say "migrated from legacy ID … may duplicate", imported and flagged for a human, never decided by the machine.</div>
              )}
            </div>;
          })()}
          {/* BUILD-80 Part 1.4 — THE LARGEST GIFTS, before anything trusts
              them. A number that is 10% of the file in one row is a parse
              error until a human says otherwise; a $200,000 row next to
              $2,500 rows is a question a human answers in one second. */}
          {result.largestGifts?.length > 0 && (
            <div style={{textAlign:"left",background:T.bg2,border:`1px solid ${T.bg3}`,borderRadius:10,padding:"12px 16px",marginBottom:16,fontSize:12,lineHeight:1.8}}>
              <div style={{fontSize:10,fontWeight:800,color:T.ink3,marginBottom:6}}>
                The five largest gifts we imported, check these first
              </div>
              {result.largestGifts.map((g,i)=>(
                <div key={i} style={{display:"flex",justifyContent:"space-between",gap:10,color:T.ink2}}>
                  <span style={{minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                    <strong style={{color:T.ink}}>{g.name}</strong>{g.date ? ` · ${displayDate(g.date)||g.date}` : ""}
                  </span>
                  <span style={{color:T.ink,flexShrink:0,fontVariantNumeric:"tabular-nums"}}>
                    {"$" + Number(g.dollars).toLocaleString(undefined,{maximumFractionDigits:2})}<span style={{color:T.ink3}}> · line {g.line}</span>
                  </span>
                </div>
              ))}
              <div style={{marginTop:4,color:T.ink3,fontSize:11}}>If one of these is far larger than the others, open the row before it leads a thank-you queue or sets a goal.</div>
            </div>
          )}
          {/* BUILD-77 Part 1c — WE FLAGGED THESE. Every row where a free-text
              safety marker was detected, with the matched phrase, so a human
              confirms now rather than discovering after an ask goes out. */}
          {result.flaggedRows?.length > 0 && (() => {
            // BUILD-88a A.7 — ONE LINE PER DONOR, WITH A COUNT. This list is
            // built from FILE ROWS, and a donor with forty gifts and one
            // "deceased" note in their notes column filled forty lines of it
            // with the same sentence. It is a list of PEOPLE to confirm, so it
            // collapses onto the person: their flags, the phrase we matched,
            // the line it first appeared on, and how many rows said it. Paged
            // at fifty, because a page of names nobody can finish reading is
            // the same failure a second time.
            const byDonor = [];
            const seen = new Map();
            for (const f of result.flaggedRows) {
              const key = String(f.name || "").toLowerCase();
              if (!seen.has(key)) { seen.set(key, { ...f, rows: 0 }); byDonor.push(seen.get(key)); }
              const e = seen.get(key);
              e.rows++;
              e.flags = { deceased: e.flags.deceased||f.flags.deceased, doNotSolicit: e.flags.doNotSolicit||f.flags.doNotSolicit,
                          doNotContact: e.flags.doNotContact||f.flags.doNotContact, doNotMail: e.flags.doNotMail||f.flags.doNotMail,
                          doNotEmail: e.flags.doNotEmail||f.flags.doNotEmail };
            }
            const shown = byDonor.slice(0, flaggedPage * 50);
            return <div style={{textAlign:"left",background:T.gold100,border:`1px solid ${T.gold500}55`,borderRadius:10,padding:"12px 16px",marginBottom:16,fontSize:12,lineHeight:1.7}}>
              <div style={{fontSize:10,fontWeight:800,color:T.gold600,marginBottom:6}}>
                We flagged these, {byDonor.length.toLocaleString()} {byDonor.length===1?"person":"people"} from the notes column, please confirm
              </div>
              {shown.map((f,i)=>(
                <div key={i} data-flagged-donor={f.name} style={{display:"flex",justifyContent:"space-between",gap:10,color:T.ink2}}>
                  <span style={{minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                    <strong style={{color:T.ink}}>{f.name}</strong>{": "}
                    {[f.flags.deceased&&"deceased",f.flags.doNotSolicit&&"do-not-solicit",f.flags.doNotContact&&"do-not-contact",f.flags.doNotMail&&"do-not-mail",f.flags.doNotEmail&&"do-not-email"].filter(Boolean).join(", ")}
                    {f.rows>1 && <span style={{color:T.ink3}}>{` (${f.rows.toLocaleString()} rows)`}</span>}
                  </span>
                  <span style={{color:T.ink3,flexShrink:0}}>line {f.line} · "{String(f.matched[0]||"").slice(0,32)}"</span>
                </div>
              ))}
              {byDonor.length > shown.length && (
                <button onClick={()=>setFlaggedPage(p2=>p2+1)}
                  style={{background:"none",border:"none",padding:0,marginTop:6,color:T.greenDk,fontSize:12,fontWeight:600,cursor:"pointer",textDecoration:"underline"}}>
                  Show {Math.min(50, byDonor.length - shown.length).toLocaleString()} more of {byDonor.length.toLocaleString()} every one is on the donor's record with its flag set
                </button>
              )}
            </div>;
          })()}
          {/* BUILD-80 Part 4.3 — the CONFLICTS, shown: most restrictive won,
              and the human is told which homes disagreed before an ask can
              go out on a column's say-so. */}
          {result.exclusionConflicts?.length > 0 && (
            <div style={{textAlign:"left",background:T.gold100,border:`1px solid ${T.gold500}55`,borderRadius:10,padding:"12px 16px",marginBottom:16,fontSize:12,lineHeight:1.7}}>
              <div style={{fontSize:10,fontWeight:800,color:T.gold600,marginBottom:6}}>
                Columns that disagree, we kept the most restrictive
              </div>
              {result.exclusionConflicts.slice(0,20).map((c,i)=>(
                <div key={i} style={{color:T.ink2}}>
                  <strong style={{color:T.ink}}>{c.name}</strong>: {c.message}
                </div>
              ))}
              {result.exclusionConflicts.length > 20 && <div style={{color:T.ink3}}>+{result.exclusionConflicts.length-20} more, each set on the donor's record.</div>}
            </div>
          )}
          {/* BUILD-78 Part 3.3 — the COLUMN axis of the invariant. Left side
              from the physical header parse at parse entry; right side summed
              independently from the disposition ledger. The server refused
              the write if they disagreed, so what renders here balanced. */}
          {result.columnAxis && (() => {
            const CA = result.columnAxis; const c = CA.summary.counts;
            const custom = c["custom-existing"] + c["custom-new"];
            const parts = [
              [c.core, "mapped"],
              [custom, `stored as custom${c["custom-new"] ? ` (${c["custom-new"]} new)` : ""}`],
              [c.flag, "flagged"],
              [c.discarded, "discarded"],
              [c.refused, "refused"],
            ].filter(([n]) => n > 0);
            return <div style={{textAlign:"left",background:T.bg2,border:`1px solid ${T.bg3}`,borderRadius:10,padding:"12px 16px",marginBottom:16,fontSize:12,lineHeight:1.8}}>
              <div style={{fontSize:10,fontWeight:800,color:T.ink3,marginBottom:6}}>Every column accounted for</div>
              <div style={{display:"flex",justifyContent:"space-between",gap:12,color:T.ink}}>
                <span>Columns in your file</span>
                <span style={{fontVariantNumeric:"tabular-nums"}}>{CA.inFile}</span>
              </div>
              <div style={{height:1,background:T.bg3,margin:"6px 0"}} />
              {parts.map(([n, label]) => (
                <div key={label} style={{display:"flex",justifyContent:"space-between",gap:12,color:T.ink2}}>
                  <span>{label[0].toUpperCase()+label.slice(1)}</span>
                  <span style={{fontVariantNumeric:"tabular-nums"}}>{n}</span>
                </div>
              ))}
              <div style={{height:1,background:T.bg3,margin:"6px 0"}} />
              <div style={{display:"flex",justifyContent:"space-between",gap:12,fontWeight:700,color:CA.summary.balanced?T.ink:T.terracotta}}>
                <span>{CA.summary.balanced?"Balanced":"DOES NOT BALANCE"}</span>
                <span style={{fontVariantNumeric:"tabular-nums"}}>{CA.summary.accounted}</span>
              </div>
              <div style={{marginTop:8,paddingTop:8,borderTop:`1px solid ${T.bg3}`,color:T.ink3,fontSize:11,lineHeight:1.6}}>
                {CA.ledger.map(e => {
                  const what = e.disposition === "core" ? `→ ${e.role}`
                    : e.disposition === "custom-new" ? `→ new custom field "${e.label}"`
                    : e.disposition === "custom-existing" ? "→ existing custom field"
                    : e.disposition === "flag" ? `→ ${String(e.flag||"").replace(/([A-Z])/g," $1").toLowerCase()} flag`
                    : e.disposition === "discarded" ? "discarded (acknowledged)"
                    : `not importable, ${e.reason || "refused"}`;
                  return <div key={e.index}>{String(e.header).trim() || `(column ${e.index+1}, no header)`} {what}</div>;
                })}
              </div>
            </div>;
          })()}
          {/* BUILD-58 Part 2 — nothing in the file vanishes silently: every
              column is mapped, deliberately ignored, or called out as
              unrecognized; every skipped ROW has a stated reason. */}
          {!result.columnAxis && (result.columnReport || result.columnReports) && (() => {
            const sections = result.columnReports
              ? [["Donor sheet", result.columnReports.donorSheet], ["Gift sheet", result.columnReports.giftSheet]]
              : [["Your file", result.columnReport]];
            const rr = result.rowReport;
            const rowNotes = rr ? [
              rr.negativeRows > 0 && `${countLabel(rr.negativeRows, "negative-amount row")} not imported (refunds/adjustments, Steward has no negative-gift model)`,
              rr.unparsableAmountRows > 0 && `${countLabel(rr.unparsableAmountRows, "row")} with unreadable amounts not imported`,
              rr.zeroAmountRows > 0 && `${countLabel(rr.zeroAmountRows, "zero-amount row")} not imported`,
            ].filter(Boolean) : [];
            return <div style={{textAlign:"left",background:T.bg2,border:`1px solid ${T.bg3}`,borderRadius:10,padding:"12px 16px",marginBottom:24,fontSize:12,lineHeight:1.7}}>
              <div style={{fontSize:10,fontWeight:800,color:T.ink3,marginBottom:6}}>Every column accounted for</div>
              {sections.map(([label, c]) => c && <div key={label} style={{marginBottom:6}}>
                <strong style={{color:T.ink}}>{label}:</strong>{" "}
                <span style={{color:T.ink2}}>{c.mapped.map(m => `${m.header} → ${anyFieldLabel(m.field)}`).join(" · ") || "no columns mapped"}</span>
                {c.ignored.length > 0 && <div style={{color:T.ink3}}>Not imported (by design): {c.ignored.join(" · ")}</div>}
                {c.unrecognized.length > 0 && <div style={{color:T.terracotta,fontWeight:600}}>Not imported, unrecognized: {c.unrecognized.join(" · ")}</div>}
              </div>)}
              {rowNotes.length > 0 && <div style={{borderTop:`1px solid ${T.bg3}`,paddingTop:6,marginTop:6,color:T.ink2}}>{rowNotes.map((n,i) => <div key={i}>{n}</div>)}</div>}
            </div>;
          })()}
          {hasBatchErrors && (
            <div style={{background:T.terra100,border:"1px solid "+T.terra200,borderRadius:10,padding:"10px 14px",marginBottom:24,textAlign:"left",fontSize:12,color:T.terra700}}>
              <strong>Batch errors, some rows may not have been inserted:</strong>
              {result.batchErrors.map((e,i) => <div key={i} style={{marginTop:4}}>Rows {e.rows}: {e.error}</div>)}
            </div>
          )}
          {/* LIVE-1 — a one-row-per-gift file undoes as one: its gifts, the
              people it created, the thank-you drafts and journeys it started,
              and its readout. */}
          {result.shape==="transaction"&&result.runId&&(result.undoSentence
            ?<div data-testid="import-undone" style={{fontSize:13,color:T.ink2,marginBottom:14}}>{result.undoSentence}</div>
            :<button type="button" data-commit data-testid="import-undo" disabled={undoBusy} onClick={async()=>{setUndoBusy(true);try{const r=await apiFetch(`/imports/${result.runId}/reverse`,{method:"POST",body:"{}"});setResult(x=>({...x,undoSentence:r.sentence||"Undone."}));}catch(e){setErr(errorMessage(e,"The undo did not finish. Nothing was changed."));}setUndoBusy(false);}}
                style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:10,padding:"12px 18px",color:T.ink,fontSize:14,fontWeight:700,cursor:"pointer",marginRight:8}}>Undo this import</button>)}
          {/* IMPORT-2: the people are in; what was written about them comes next. */}
          <button data-testid="import-bring-notes" onClick={()=>{onImported&&onImported();setTimeout(()=>window.dispatchEvent(new Event("steward:history-import")),0);}} style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:10,padding:"12px 18px",color:T.ink,fontSize:14,fontWeight:700,cursor:"pointer",marginRight:8}}>Bring your notes and history</button>
          <button onClick={onImported} style={{background:T.greenDk,border:"none",borderRadius:10,padding:"12px 28px",color:T.white,fontSize:14,fontWeight:700,cursor:"pointer"}}>Done</button>
        </div>
      </Modal>
  );
}
