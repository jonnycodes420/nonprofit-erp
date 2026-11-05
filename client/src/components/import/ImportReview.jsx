import { T } from "../shared";
import { STAGE_COLORS } from "../donorShared";
import { proposalEvidenceText, CF_TYPES } from "../../../../shared/customFieldShape";
import { countLabel } from "../../../../shared/countWords.js";
import { ColumnTargetSelect } from "../ColumnTargetSelect";
import { txRoleLabel } from "./fields";
import { apiFetch } from "../../api";
import { ThanksQuestion } from "./ThanksQuestion";

export function ImportReview({ cfDecisions, cfDefs, cfUndecided, donorCount, effectiveShape, emailsToCheck, err, giftCount, isTeam, loading, mapperPlan, payload, progress, setCfDecisions, setCfDefs, setThanks, setTxMap, setValueAnswers, shapeMemory, srcFile, stageBasis, stagePreview, thanks, txMap, tyPreview, valueAnswers, valueQuestions }) {
  return (
        <>
          {/* Validation summary */}
          <div style={{background:T.bg,borderRadius:10,padding:"12px 14px",marginBottom:12}}>
            <div style={{fontSize:13,fontWeight:700,color:T.ink}}>
              {donorCount>0
                ? <>{" "}<span style={{color:T.green600}}>{donorCount.toLocaleString()}</span>{" donors ready"}
                    {giftCount>0&&<>{" · "}<span style={{color:T.green600}}>{giftCount.toLocaleString()}</span>{" gifts"}</>}
                    {payload.warnedCount>0&&<>{" · "}<span style={{color:T.gold600}}>{payload.warnedCount}</span>{" with warnings"}</>}
                    {(()=>{
                      if (effectiveShape !== "transaction") return payload.skippedCount>0&&<>{" · "}<span style={{color:T.ink3}}>{payload.skippedCount.toLocaleString()}</span>{" skipped (no name, email, or organization)"}</>;
                      // BUILD-80 Part 10 — the refusal line shows DOLLARS, not
                      // only rows, before the write — and routed semantic rows
                      // (soft credits, pledges, in-kind) are not "refused".
                      const disp = payload.dispositions || [];
                      const refused = disp.filter(d=>d.disposition==="errored"||(d.disposition==="skipped"&&["no_amount","zero_amount"].includes(d.reason)));
                      const refusedDollars = refused.reduce((s2,d)=>s2+(d.dollars||0),0);
                      const routed = disp.filter(d=>d.disposition==="skipped"&&!["no_amount","zero_amount"].includes(d.reason)).length;
                      return <>
                        {refused.length>0&&<>{" · "}<span style={{color:T.terracotta}}>{refused.length.toLocaleString()}</span>{" rows will be refused ("}<span style={{color:T.terracotta}}>{"$"+refusedDollars.toLocaleString(undefined,{maximumFractionDigits:2})}</span>{"), each with its line and reason"}</>}
                        {routed>0&&<>{" · "}<span style={{color:T.ink3}}>{routed.toLocaleString()}</span>{" rows route to their own surfaces (soft credits, pledges, in-kind)"}</>}
                      </>;
                    })()}</>
                : payload.error
                  ? <span style={{color:T.terracotta}}>Steward could not read this file, {payload.error}. Nothing has been imported, and this is not a problem with your spreadsheet.</span>
                  : <span style={{color:T.ink3}}>No rows ready, map at least one column to <em>name</em>, <em>email</em>, or <em>organization</em>.</span>}
            </div>
          </div>

          {emailsToCheck && (
            <div data-testid="import-check-emails" style={{background:T.gold50,border:"1px solid "+T.gold300,borderRadius:10,padding:"10px 14px",marginBottom:12,fontSize:13,color:T.ink,lineHeight:1.5}}>
              <strong>Check {emailsToCheck.n === 1 ? "this email" : `these ${emailsToCheck.n.toLocaleString("en-US")} emails`}.</strong>{" "}
              {emailsToCheck.n === 1 ? "It does" : "They do"} not look like a working address (for example {emailsToCheck.example}{emailsToCheck.hint ? `; ${emailsToCheck.hint}` : ""}). Steward imports {emailsToCheck.n === 1 ? "it" : "them"} as {emailsToCheck.n === 1 ? "it is" : "they are"}, and the profile says "Check this email" until someone fixes it.
            </div>
          )}

          {/* Smart stage assignment preview — BUILD-88a A.7: behind the Team
              flag, with the officer routing above it. A stage is a position in
              a pipeline somebody moves people through, and a Core org has no
              pipeline and no Kanban to override it in; showing the split there
              is a promise about a screen they do not have. */}
          {isTeam && Object.keys(stagePreview).length>0 && (
            <div style={{background:T.bg,borderRadius:10,padding:"10px 14px",marginBottom:12}}>
              <div style={{fontSize:10,fontWeight:700,color:T.ink3,marginBottom:6}}>{stageBasis.hasGivingData ? "Smart Stage Assignment Preview" : "Starting stage"}</div>
              <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                {Object.entries(stagePreview).map(([s,n])=>(
                  <span key={s} style={{fontSize:12,fontWeight:600,padding:"3px 10px",borderRadius:99,background:(STAGE_COLORS[s]||T.ink3)+"22",color:STAGE_COLORS[s]||T.ink3,border:`1px solid ${(STAGE_COLORS[s]||T.ink3)}30`}}>
                    {s} × {n}
                  </span>
                ))}
              </div>
              {/* BUILD-84 P0-3 — the sentence is DERIVED from the declared basis
                  fields, never written by hand. A basis that cannot be read back
                  off the mapping is not claimed. */}
              <div style={{fontSize:11,color:T.ink3,marginTop:6}}>{stageBasis.sentence}{stageBasis.hasGivingData ? " Override after import by dragging in the Kanban." : ""}</div>
            </div>
          )}

          {/* Progress bar during a chunked import. BUILD-88a A.7 — it renders
              only while the import is RUNNING, and the mapper below is made
              non-interactive for the same span: "Importing 0 of 2,500…" above a
              live dropdown invites a change that can no longer reach the write. */}
          {progress && loading && (
            <div style={{marginBottom:12}}>
              <div style={{fontSize:12,color:T.ink,fontWeight:600,marginBottom:6}}>Importing {progress.done.toLocaleString()} of {progress.total.toLocaleString()}…</div>
              <div style={{height:8,background:T.bg3,borderRadius:99,overflow:"hidden"}}>
                <div style={{height:"100%",width:`${progress.total?Math.round(progress.done/progress.total*100):0}%`,background:T.green600,transition:"width 0.2s"}}/>
              </div>
            </div>
          )}

          {/* BUILD-78 Parts 2+4 — every column gets a decision BEFORE the
              write. Exclusion-shaped columns route to the flag family and are
              never offered as custom destinations; unmapped columns PROPOSE a
              custom field with the guess's evidence, and nothing is created
              without an explicit accept. */}
          {mapperPlan && (() => {
            const FLAG_LABEL = { deceased:"deceased", deceasedDate:"deceased date", doNotSolicit:"do-not-solicit", doNotContact:"do-not-contact", doNotMail:"do-not-mail", doNotEmail:"do-not-email" };
            const flagCols = mapperPlan.columns.filter(c=>c.status==="flag");
            const existingCols = mapperPlan.columns.filter(c=>c.status==="custom-existing");
            const proposedCols = mapperPlan.columns.filter(c=>c.status==="custom-proposed");
            const refusedCols = mapperPlan.columns.filter(c=>c.status==="refused");
            const setDecision = (idx, d) => setCfDecisions(p=>({ ...p, [idx]: d }));
            const clearDecision = idx => setCfDecisions(p=>{ const n={...p}; delete n[idx]; return n; });
            const openRoles = Object.entries(txMap).filter(([,h])=>!h).map(([role])=>role);
            if (!flagCols.length && !existingCols.length && !proposedCols.length && !refusedCols.length) return null;
            // A.7 — once the write is under way the decisions are made. The
            // mapper stops taking input rather than accepting edits that
            // silently do not apply.
            return <div aria-disabled={loading?"true":undefined} data-mapper-editable={loading?"0":"1"}
              style={{textAlign:"left",marginBottom:12,...(loading?{pointerEvents:"none",opacity:0.55}:null)}}>
              {flagCols.length>0 && (
                <div style={{background:T.gold100,border:`1px solid ${T.gold500}55`,borderRadius:10,padding:"10px 14px",marginBottom:10,fontSize:12,lineHeight:1.6}}>
                  <div style={{fontSize:10,fontWeight:800,color:T.gold600,marginBottom:4}}>These columns set safety flags</div>
                  {flagCols.map(c=>{
                    const discarded = cfDecisions[c.index]?.action==="discard";
                    return <div key={c.index} style={{marginBottom:6}}>
                      <strong style={{color:T.ink}}>{String(c.header).trim()}</strong>{" looks like "}<strong>{FLAG_LABEL[c.flag]||c.flag}</strong>{" state, it will set the flag, never a custom field. "}
                      {c.matchedValues?.length>0 && <span style={{color:T.ink3}}>Values we matched: {c.matchedValues.join(", ")} ({c.matchedCount} of {c.nonblankCount}).</span>}
                      <div>
                        <label style={{display:"inline-flex",alignItems:"center",gap:6,cursor:"pointer",color:T.ink2}}>
                          <input type="checkbox" checked={!discarded} onChange={e=>e.target.checked?clearDecision(c.index):setDecision(c.index,{action:"discard"})}/>
                          Set these flags{discarded?" (currently OFF, this column will be dropped, acknowledged)":""}
                        </label>
                      </div>
                    </div>;
                  })}
                </div>
              )}
              {(existingCols.length>0||proposedCols.length>0) && (
                <div style={{background:T.bg,border:`1px solid ${T.bg3}`,borderRadius:10,padding:"10px 14px",marginBottom:10,fontSize:12,lineHeight:1.6}}>
                  <div style={{fontSize:10,fontWeight:800,color:T.ink3,marginBottom:6}}>
                    Columns without a standard home{cfUndecided>0?`, ${cfUndecided} still need${cfUndecided===1?"s":""} a decision`:""}
                  </div>
                  {existingCols.map(c=>{
                    const discarded = cfDecisions[c.index]?.action==="discard";
                    return <div key={c.index} style={{marginBottom:6,color:T.ink2}}>
                      <strong style={{color:T.ink}}>{String(c.header).trim()}</strong>{" → your existing "}{c.entity}{" field "}<strong>{c.def.label}</strong>
                      {c.via==="saved-mapping"?" (remembered from your last import)":""}{". "}
                      <button onClick={()=>discarded?clearDecision(c.index):setDecision(c.index,{action:"discard"})}
                        style={{background:"none",border:"none",padding:0,color:discarded?T.greenDk:T.ink3,fontSize:12,cursor:"pointer",textDecoration:"underline"}}>
                        {discarded?"Un-discard":"Discard instead"}
                      </button>
                    </div>;
                  })}
                  {proposedCols.map(c=>{
                    const d = cfDecisions[c.index]||{};
                    const type = d.type||c.proposal.type;
                    const entity = d.entity||c.entity;
                    const label = d.label!==undefined?d.label:c.proposal.label;
                    const failed = (type===c.proposal.type?c.proposal.evidence.failed:null);
                    const decided = d.action==="accept"||d.action==="discard"||d.action==="core";
                    // FIX-10 E — a column the VENDOR TILE already decided. One
                    // line, the preset's own reason, and one click to take it
                    // back. It does not get the proposal card, because nobody
                    // needs to be asked twice about `donor_id`.
                    if (d.viaPreset) return (
                      <div key={c.index} data-cf-col={String(c.header).trim()} data-cf-decided="1"
                        data-cf-via-preset={d.viaPreset}
                        style={{borderTop:`1px solid ${T.bg3}`,paddingTop:8,marginTop:8,color:T.ink2}}>
                        <strong style={{color:T.ink}}>{String(c.header).trim()}</strong>
                        {" → "}<strong>Set aside, from your {d.viaPreset} preset</strong>{". "}
                        <button onClick={()=>clearDecision(c.index)}
                          style={{background:"none",border:"none",padding:0,color:T.greenDk,fontSize:12,cursor:"pointer",textDecoration:"underline"}}>
                          Change
                        </button>
                        {d.presetReason && <div style={{color:T.ink3,fontSize:11.5,marginTop:2,lineHeight:1.5}}>{d.presetReason}</div>}
                      </div>);
                    return <div key={c.index} data-cf-col={String(c.header).trim()} data-cf-decided={decided?"1":"0"} style={{borderTop:`1px solid ${T.bg3}`,paddingTop:8,marginTop:8}}>
                      <div style={{marginBottom:4}}>
                        <strong style={{color:T.ink}}>{String(c.header).trim()}</strong>
                        {" → "}<strong style={{color:T.greenDk}}>{({text:"Text",long_text:"Long text",number:"Number",money:"Money",date:"Date",select:"Select",multi_select:"Multi-select",checkbox:"Yes/No"})[type]||type}</strong>
                        {" ("}{entity}{" field). "}
                        <span style={{color:T.ink3}}>{proposalEvidenceText(c.proposal.type, c.proposal.evidence)}</span>
                        {failed>0 && d.action==="accept" && <span style={{color:T.terracotta}}>{" "}{countLabel(failed, "row")} will be refused with line numbers.</span>}
                      </div>
                      {/* FIX (2026-09-09) — the ONE column-target dropdown, on this
                          card too. The rival "…or map to a standard field" select
                          below it is gone: one control answers "what does this
                          column become?", on every screen that asks. */}
                      <div style={{marginBottom:6}}>
                        <ColumnTargetSelect
                          testId={`tx-map-${String(c.header).trim()}`}
                          header={c.header} entity={entity} compact
                          standardFields={openRoles.map(r=>({key:r,label:txRoleLabel(r)}))
                            .concat(d.action==="core"&&d.role?[{key:d.role,label:txRoleLabel(d.role)}]:[])
                            .filter((f,i,arr)=>arr.findIndex(x=>x.key===f.key)===i)}
                          cfDefs={cfDefs}
                          proposal={c.proposal}
                          value={d.action==="core"&&d.role?`std:${d.role}`
                            : d.action==="existing"&&d.fieldId?`cf:${d.fieldId}`
                            : d.action==="accept"?"ignore":"ignore"}
                          onChange={v=>{
                            if(v.startsWith("std:")){const role=v.slice(4);setDecision(c.index,{action:"core",role});setTxMap(m=>({...m,[role]:c.field}));}
                            else if(v.startsWith("cf:")){const def=[...cfDefs.donor,...cfDefs.gift].find(x=>x.id===v.slice(3));if(def)setDecision(c.index,{action:"existing",fieldId:def.id,entity:def.entity});}
                            else setDecision(c.index,{action:"discard"});
                          }}
                          onCreateField={async draft=>{
                            const created=await apiFetch("/custom-fields",{method:"POST",body:JSON.stringify({
                              entity:draft.entity,label:draft.label,type:draft.type,options:draft.options||[],
                              source:`import of ${srcFile?.name||"pasted data"}`})});
                            setCfDefs(p=>({...p,[created.entity]:[...p[created.entity],created]}));
                            setDecision(c.index,{action:"existing",fieldId:created.id,entity:created.entity});
                            return created;
                          }}
                        />
                      </div>
                      <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}>
                        {d.action!=="accept"&&d.action!=="discard"&&(
                          <button onClick={()=>setDecision(c.index,{...d,action:"accept"})}
                            style={{background:T.green600,border:"none",borderRadius:7,padding:"4px 12px",color:T.white,fontSize:12,fontWeight:700,cursor:"pointer"}}>Store it</button>
                        )}
                        {d.action==="accept"&&<span style={{color:T.greenDk,fontWeight:700}}>Will be stored ✓</span>}
                        {d.action==="discard"&&<span style={{color:T.ink3,fontWeight:600}}>Discarded (acknowledged)</span>}
                        {/* BUILD-88a A.7 — ONE DROPDOWN PER COLUMN answers "what
                            does this column become?" (the ColumnTargetSelect
                            above). Type, entity and label are the SHAPE of a new
                            custom field, so they appear only once the answer is
                            "a new custom field" — beside a column already headed
                            for a standard field or the bin they were three more
                            controls competing with the one that decides. */}
                        {d.action==="accept"&&(<>
                        <select value={type} onChange={e=>setDecision(c.index,{...d,type:e.target.value})}
                          style={{background:T.white,border:`1px solid ${T.bg3}`,borderRadius:7,padding:"3px 6px",fontSize:11,color:T.ink2}}>
                          {CF_TYPES.map(t=><option key={t} value={t}>{({text:"Text",long_text:"Long text",number:"Number",money:"Money",date:"Date",select:"Select",multi_select:"Multi-select",checkbox:"Yes/No"})[t]}</option>)}
                        </select>
                        <select value={entity} onChange={e=>setDecision(c.index,{...d,entity:e.target.value})}
                          style={{background:T.white,border:`1px solid ${T.bg3}`,borderRadius:7,padding:"3px 6px",fontSize:11,color:T.ink2}}>
                          <option value="donor">on the donor</option>
                          <option value="gift">on the gift</option>
                        </select>
                        <input value={label} onChange={e=>setDecision(c.index,{...d,label:e.target.value})}
                          style={{background:T.white,border:`1px solid ${T.bg3}`,borderRadius:7,padding:"3px 8px",fontSize:11,color:T.ink,width:140}}/>
                        </>)}
                        {/* the rival standard-field select lived here — see the
                            ColumnTargetSelect above, which is the one control */}
                        {d.action!=="discard"&&(
                          <button onClick={()=>setDecision(c.index,{action:"discard"})}
                            style={{background:"none",border:"none",padding:0,color:T.ink3,fontSize:12,cursor:"pointer",textDecoration:"underline"}}>Discard</button>
                        )}
                        {d.action==="discard"&&(
                          <button onClick={()=>clearDecision(c.index)}
                            style={{background:"none",border:"none",padding:0,color:T.greenDk,fontSize:12,cursor:"pointer",textDecoration:"underline"}}>Un-discard</button>
                        )}
                      </div>
                    </div>;
                  })}
                </div>
              )}
              {refusedCols.length>0 && (
                <div style={{fontSize:11.5,color:T.ink3,marginBottom:4}}>
                  {refusedCols.map(c=><div key={c.index}>Column {c.index+1}: not importable, {c.reason}.</div>)}
                </div>
              )}
            </div>;
          })()}
          {/* LIVE-1 · files map themselves, values she explained once, and how
              many thank-yous this file will draft, all before anyone saves. */}
          {shapeMemory&&(
            <div data-testid="import-shape-memory" style={{background:T.bg,border:"1px solid "+T.bg2,borderRadius:10,padding:"10px 14px",marginBottom:10,fontSize:12.5,color:T.ink,lineHeight:1.6}}>
              <strong>This file mapped itself.</strong> {shapeMemory.why}
              {shapeMemory.newHeaders.length>0
                ?<> New {shapeMemory.newHeaders.length===1?"column":"columns"} to decide: <strong>{shapeMemory.newHeaders.join(", ")}</strong>.</>
                :" Nothing new to decide."}
            </div>
          )}
          {valueQuestions.length>0&&(
            <div data-testid="import-value-answers" style={{border:"1px solid "+T.bg2,borderRadius:10,padding:"10px 14px",marginBottom:10,fontSize:12.5,color:T.ink}}>
              <div style={{fontWeight:700,marginBottom:4}}>What do these values mean?</div>
              <div style={{color:T.ink3,marginBottom:6}}>Say once and every later file reads them the same way. Leave a box empty to keep the value as it is.</div>
              {(()=>{
                const one=q=>{const k=q.field+"|"+q.raw;return(
                  <label key={k} style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap",padding:"3px 0"}}>
                    <span style={{minWidth:120}}>{q.field==="fund"?"Fund":"Payment method"} “{q.raw}” <span style={{color:T.ink3}}>({q.n})</span></span>
                    <span style={{color:T.ink3}}>means</span>
                    <input value={valueAnswers[k]??q.saved} placeholder={q.raw} maxLength={120}
                      onChange={e=>setValueAnswers(v=>({...v,[k]:e.target.value}))}
                      style={{flex:"1 1 140px",minWidth:0,border:"1px solid "+T.bg3,borderRadius:6,padding:"4px 8px",fontSize:12.5,fontFamily:"inherit"}}/>
                  </label>);};
                const methods=valueQuestions.filter(q=>q.field==="paymentMethod"), funds=valueQuestions.filter(q=>q.field==="fund");
                return <>{methods.map(one)}
                  {funds.length>0&&<details style={{marginTop:methods.length?6:0}}>
                    <summary style={{cursor:"pointer",color:T.ink2}}>Fund names in this file ({funds.length}). Open to say one is another (“Gala 25” is the Gala fund).</summary>
                    {funds.map(one)}
                  </details>}</>;
              })()}
            </div>
          )}
          {tyPreview&&(tyPreview.ask
            ?<ThanksQuestion preview={tyPreview} answer={thanks} onChange={setThanks}/>
            :<div data-testid="import-thankyou-preview" style={{fontSize:12.5,color:T.ink2,marginBottom:10,lineHeight:1.55}}>{tyPreview.sentence}</div>)}
          {err&&<div style={{color:T.terracotta,fontSize:12,marginBottom:10}}>{err}</div>}
        </>
  );
}
