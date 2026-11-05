import { T, Spin } from "../shared";
import { DateFormatNote, MixedDatesQuestion, YearDatesQuestion } from "./DateQuestions";
import { detectMembershipPreset, MEMBERSHIP_PRESETS } from "../../../../shared/membershipImport.js";
import { MIGRATION_PRESETS } from "../../../../shared/migrationPresets.js";
import { NPSP_OBJECT_OPPORTUNITY, NPSP_PRESET } from "../../../../shared/npspPreset.js";
import { countLabel } from "../../../../shared/countWords.js";
import { plainFieldLabel, CSV_STANDARD_FIELDS } from "./fields";
import { ColumnTargetSelect } from "../ColumnTargetSelect";
import { proposeCustomField } from "../../../../shared/customFieldShape";
import { validateMappingChoice } from "../../../../shared/importShape";
import { apiFetch } from "../../api";

export function ImportMapping({ TX_ROLES, aiLoading, cfDefs, dateConvEvidence, dateConventionChoice, doAiMap, donorCfChoices, donorHeaders, effectiveShape, headersUnrecognized, mapRefusal, mapping, mcApplyTagTypes, mcDetect, mcFileStatus, mig, npsp, npspIs, onConventionChange, parsed, payload, setCfDefs, setDateConventionChoice, setDonorCfChoices, setMapRefusal, setMapping, setMcApplyTagTypes, setMcFileStatus, setTxMap, setYearCols, srcFile, takenDonorTargets, txMap, yearCols, yearConvention }) {
  return (
        <>
          {/* Column mapper — aggregate/wide use the donor-field grid; transaction uses gift roles */}
          {effectiveShape === "transaction" ? (
            <div style={{marginBottom:14}}>
              <div style={{fontSize:13,fontWeight:700,color:T.ink,marginBottom:10}}>
                Map gift columns <span style={{fontSize:11,color:T.ink3,fontWeight:400}}>({parsed.headers.length} columns · {parsed.rows.length.toLocaleString()} rows)</span>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
                {TX_ROLES.map(([role,label]) => (
                  <div key={role} style={{display:"flex",alignItems:"center",gap:6,background:txMap[role]?T.bg:"transparent",borderRadius:7,padding:"5px 8px",border:`1px solid ${txMap[role]?T.bg3:"transparent"}`}}>
                    <span style={{fontSize:12,color:txMap[role]?T.ink:T.ink3,flex:1,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{label}</span>
                    <select value={txMap[role]||""} onChange={e=>setTxMap(p=>({...p,[role]:e.target.value}))}
                      style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:6,padding:"4px 6px",color:T.ink,fontSize:11,outline:"none",flexShrink:0,maxWidth:150}}>
                      <option value="">None</option>
                      {parsed.headers.map(h=><option key={h} value={h}>{h||"(blank)"}</option>)}
                    </select>
                  </div>
                ))}
              </div>
              <div style={{fontSize:11,color:T.ink3,marginTop:8}}>Rows are grouped by donor (email, else name); each row becomes one gift.</div>
              <DateFormatNote dateConvEvidence={dateConvEvidence}/>
              {/* BUILD-80 Part 5 — unrecognised gift types, shown before the
                  write with count and examples. */}
              {payload?.semantics?.unrecognizedTypes?.length > 0 && (
                <div style={{background:T.bg2,border:`1px solid ${T.bg3}`,borderRadius:8,padding:"8px 12px",marginTop:8,fontSize:12,color:T.ink,lineHeight:1.5}}>
                  <strong>Gift types we don't recognize:</strong>{" "}
                  {payload.semantics.unrecognizedTypes.map(u => `“${u.type}” (${u.count}${u.examples?.[0] ? `, e.g. line ${u.examples[0].line}` : ""})`).join(" · ")}
                  {": "}these rows import as ordinary gifts with the type kept as written.
                </div>
              )}
              <MixedDatesQuestion dateConvEvidence={dateConvEvidence} dateConventionChoice={dateConventionChoice} setDateConventionChoice={setDateConventionChoice}/>
            </div>
          ) : (
            <div style={{marginBottom:14}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
                <div style={{fontSize:13,fontWeight:700,color:T.ink}}>
                  Map columns <span style={{fontSize:11,color:T.ink3,fontWeight:400}}>({donorHeaders.length} donor columns{effectiveShape==="wide"?` · ${yearCols.length} year columns`:""} · {parsed.rows.length.toLocaleString()} rows)</span>
                </div>
                <button onClick={doAiMap} disabled={aiLoading}
                  style={{background:aiLoading?T.green800:(headersUnrecognized?T.bg2:T.green600),border:headersUnrecognized?`1px solid ${T.gold500}`:"none",borderRadius:8,padding:"6px 14px",color:headersUnrecognized?T.gold700:T.white,fontSize:12,fontWeight:700,cursor:aiLoading?"not-allowed":"pointer",display:"flex",alignItems:"center",gap:6,opacity:aiLoading?0.7:1}}>
                  {aiLoading?<><Spin/>Mapping…</>:headersUnrecognized?<>✦ Guess from contents</>:<>✦ Auto-map</>}
                </button>
              </div>
              {headersUnrecognized && (
                <div style={{background:T.gold100,border:`1px solid ${T.gold300}`,borderRadius:8,padding:"8px 12px",marginBottom:8,fontSize:12,color:T.ink,lineHeight:1.5}}>
                  Most of these column headers aren't ones Steward recognizes, one-click mapping is off. “Guess from contents” reads the values instead, and every guess still has to pass its type check. Review each column before importing.
                </div>
              )}
              {/* BUILD-101 Part 6 — a membership file, and whose. */}
              {(() => {
                const mk = parsed?.headers ? detectMembershipPreset(parsed.headers) : null;
                if (!mk) return null;
                const pz = MEMBERSHIP_PRESETS[mk];
                return (
                  <div data-testid="membership-preset" style={{background:T.green100,border:`1px solid ${T.green200||T.bg3}`,borderRadius:10,padding:"10px 13px",marginBottom:8,fontSize:12.5,color:T.ink,lineHeight:1.55}}>
                    <div style={{fontWeight:800,marginBottom:5}}>This file carries memberships{mk==="plain"?"":` (${pz.label})`}.</div>
                    <div style={{color:T.ink2}}>
                      Each level is matched to your own levels; a level you do not have is held and listed by line, never created.
                      These are imported as history: no payment is posted, and a date already past opens no renewal.
                      {pz.confidence==="documented-not-walked"?` Mapped from ${pz.label}'s documented export, not yet from a real file, check the columns below.`:""}
                      {pz.note?` ${pz.note}`:""}
                    </div>
                  </div>);
              })()}
              {/* BUILD-98 (switch) Part 7 — another CRM's gift export. */}
              {mig && (
                <div data-testid="migration-preset" style={{background:T.green100,border:`1px solid ${T.green200||T.bg3}`,borderRadius:10,padding:"10px 13px",marginBottom:8,fontSize:12.5,color:T.ink,lineHeight:1.55}}>
                  <div style={{fontWeight:800,marginBottom:5}}>This looks like a {mig.label} gift export.</div>
                  <div style={{color:T.ink2,marginBottom:6}}>
                    The columns are mapped from {mig.label}'s documented export; check them below before you import.
                    {mig.txMap.stage?" A refunded or failed payment is set aside and listed, never counted.":""}
                  </div>
                  <details data-testid="migration-checklist">
                    <summary style={{cursor:"pointer",color:T.ink3,fontSize:12}}>Moving from {mig.label}: what to run, and what does not come across</summary>
                    <ol style={{margin:"6px 0 4px 0",paddingLeft:18,color:T.ink2}}>
                      {MIGRATION_PRESETS[mig.key].checklist.map((c,i)=><li key={i} style={{marginBottom:3}}>{c}</li>)}
                    </ol>
                    <div style={{color:T.ink2}}>Does not come across: {MIGRATION_PRESETS[mig.key].loses.join("; ")}.</div>
                  </details>
                  {mig.ignored.length>0 && (
                    <div style={{color:T.ink3,fontSize:12,marginTop:4}}>
                      Set aside: {mig.ignored.map(ig=>`${ig.header} (${ig.reason})`).join("; ")}.
                    </div>
                  )}
                </div>
              )}
              {/* BUILD-97 Part 1 — this file looks like a Salesforce NPSP export. */}
              {npspIs && (
                <div data-testid="npsp-preset" style={{background:T.green100,border:`1px solid ${T.green200||T.bg3}`,borderRadius:10,padding:"10px 13px",marginBottom:8,fontSize:12.5,color:T.ink,lineHeight:1.55}}>
                  <div style={{fontWeight:800,marginBottom:5}}>
                    This looks like a Salesforce export{npsp.object===NPSP_OBJECT_OPPORTUNITY?" the gift report":" the contact report"}.
                  </div>
                  <div style={{marginBottom:npsp.warnings.length||npsp.ignored.length?8:0,color:T.ink2}}>
                    The columns are mapped{". "}
                    {npsp.object===NPSP_OBJECT_OPPORTUNITY
                      ? NPSP_PRESET.cashRule
                      : "An account named like a household is a PERSON; only an organization account becomes an organization."}
                  </div>
                  {/* A refusal Steward understood and could not use is said out
                      loud, with both column names in it. Silence here is how
                      somebody who asked to be left alone gets emailed. */}
                  {npsp.warnings.map((w,i)=>(
                    <div key={i} data-testid="npsp-warning" style={{background:T.gold100,border:`1px solid ${T.gold300}`,borderRadius:8,padding:"7px 10px",marginBottom:6,color:T.ink}}>
                      {w.sentence}
                    </div>
                  ))}
                  {npsp.ignored.length>0 && (
                    <details data-testid="npsp-ignored">
                      <summary style={{cursor:"pointer",color:T.ink3,fontSize:12}}>
                        {countLabel(npsp.ignored.length, "column")} read and set aside
                      </summary>
                      <ul style={{margin:"6px 0 0 0",paddingLeft:18,color:T.ink2}}>
                        {npsp.ignored.map(ig=>(
                          <li key={ig.header} style={{marginBottom:3}}>
                            <strong>{ig.header}</strong>: {ig.reason}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>
              )}
              {/* BUILD-94 Part 2 — this file looks like a Mailchimp audience. */}
              {mcDetect.isMailchimp && (
                <div data-testid="mailchimp-preset" style={{background:T.green100,border:`1px solid ${T.green200||T.bg3}`,borderRadius:10,padding:"10px 13px",marginBottom:8,fontSize:12.5,color:T.ink,lineHeight:1.55}}>
                  <div style={{fontWeight:800,marginBottom:5}}>This looks like a Mailchimp audience export.</div>
                  <div style={{marginBottom:8,color:T.ink2}}>
                    The columns are mapped. Everyone on it comes in as <strong>Other</strong> a Mailchimp
                    contact is not a donor, and nothing they do here touches a giving total until they give.
                  </div>
                  <label style={{display:"flex",alignItems:"flex-start",gap:8,marginBottom:6,cursor:"pointer"}}>
                    <input type="checkbox" data-testid="mc-unsub-file"
                      checked={mcFileStatus==="unsubscribed"}
                      onChange={e=>setMcFileStatus(e.target.checked?"unsubscribed":"subscribed")}
                      style={{accentColor:T.greenDk,marginTop:2}}/>
                    <span>
                      <strong>This is the unsubscribed file.</strong> Mailchimp exports one file per status, everyone in this one comes in unreachable, and no campaign or sequence will ever mail them.
                    </span>
                  </label>
                  {mcDetect.hasTags && (
                    <label style={{display:"flex",alignItems:"flex-start",gap:8,cursor:"pointer"}}>
                      <input type="checkbox" data-testid="mc-tag-types" checked={mcApplyTagTypes}
                        onChange={e=>setMcApplyTagTypes(e.target.checked)}
                        style={{accentColor:T.greenDk,marginTop:2}}/>
                      <span>
                        <strong>Use the Tags column to set volunteers and board.</strong> A tag that is exactly
                        “Volunteer” or “Board” types that person; every other tag is left as a tag.
                      </span>
                    </label>
                  )}
                </div>
              )}
              {mapRefusal && (
                <div style={{background:T.terra100,border:`1px solid ${T.terra200}`,borderRadius:8,padding:"8px 12px",marginBottom:8,fontSize:12,color:T.terra700,lineHeight:1.5}}>
                  <strong>“{mapRefusal.header}” can't map to {plainFieldLabel(mapRefusal.field)}:</strong> {mapRefusal.summary}
                </div>
              )}
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
                {donorHeaders.map(h => (
                  <div key={h} style={{display:"flex",alignItems:"center",gap:6,background:mapping[h]?T.bg:"transparent",borderRadius:7,padding:"5px 8px",border:`1px solid ${mapping[h]?T.bg3:"transparent"}`}}>
                    <span style={{fontSize:12,color:mapping[h]?T.ink:T.ink3,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",minWidth:0}} title={h||"(blank)"}>{h||"(blank)"}</span>
                    {/* FIX (2026-09-09) — the ONE column-target dropdown: standard
                        fields, the org's existing custom fields, and a new one
                        created right here. This screen used to show a flat list
                        of 17 internal keys and no way to make a home for a column
                        it didn't recognise. */}
                    <ColumnTargetSelect
                      testId={`donor-map-${h}`}
                      header={h} entity="donor" compact
                      standardFields={CSV_STANDARD_FIELDS}
                      cfDefs={cfDefs}
                      proposal={proposeCustomField(h, parsed.rows.map(r=>r[h]))}
                      value={mapping[h] ? `std:${mapping[h]}` : (donorCfChoices[h] ? `cf:${donorCfChoices[h].fieldId}` : "ignore")}
                      takenStd={takenDonorTargets(h)}
                      onChange={v=>{
                        if (v.startsWith("std:")) {
                          const field=v.slice(4);
                          // BUILD-79 Part 5 — a column that fails its own type
                          // check cannot be mapped to that type, by anyone.
                          const chk=validateMappingChoice(parsed.headers,parsed.rows,h,field);
                          if(!chk.ok){setMapRefusal({header:h,field,summary:chk.summary});return;}
                          setMapRefusal(null);
                          setDonorCfChoices(p=>{const n={...p};delete n[h];return n;});
                          setMapping(p=>({...p,[h]:field}));
                        } else if (v.startsWith("cf:")) {
                          const def=[...cfDefs.donor,...cfDefs.gift].find(d=>d.id===v.slice(3));
                          setMapRefusal(null);
                          setMapping(p=>{const n={...p};delete n[h];return n;});
                          if(def) setDonorCfChoices(p=>({...p,[h]:{fieldId:def.id,key:def.key,entity:def.entity,label:def.label}}));
                        } else {
                          setMapRefusal(null);
                          setMapping(p=>{const n={...p};delete n[h];return n;});
                          setDonorCfChoices(p=>{const n={...p};delete n[h];return n;});
                        }
                      }}
                      onCreateField={async d=>{
                        const created=await apiFetch("/custom-fields",{method:"POST",body:JSON.stringify({
                          entity:d.entity,label:d.label,type:d.type,options:d.options||[],
                          source:`import of ${srcFile?.name||"pasted data"}`})});
                        setCfDefs(p=>({...p,[created.entity]:[...p[created.entity],created]}));
                        setMapping(p=>{const n={...p};delete n[h];return n;});
                        setDonorCfChoices(p=>({...p,[h]:{fieldId:created.id,key:created.key,entity:created.entity,label:created.label}}));
                        return created;
                      }}
                    />
                  </div>
                ))}
              </div>

              <YearDatesQuestion effectiveShape={effectiveShape} onConventionChange={onConventionChange} setYearCols={setYearCols} yearCols={yearCols} yearConvention={yearConvention}/>
            </div>
          )}
        </>
  );
}
