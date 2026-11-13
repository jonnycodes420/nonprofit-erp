// components/profile/RailJourneys.jsx (PROFILE-3): part of the donor profile, cut from DonorProfile.jsx.
import { T, firstNameOf } from "../shared";
import { orgTodayCivil } from "../../lib/orgToday";
import { RAIL } from "../ProfileRail";
import { displayDate } from "../../../../shared/displayDate";
import { apiFetch } from "../../api";
import { errorMessage } from "../../lib/domainError";
import { journeyPickRows } from "../../lib/journeyPick";   // SENDS-1: every journey, greyed with why

import { offerUndo } from "../EditHistory";   // FLOWS-10 item 4
function RailJourneys({addErr,addPick,addPreview,allJourneys,confirmAddToJourney,doneFor,doneNote,donor,isReadOnly,journey,journeyBusy,journeyList,journeyMenu,journeySuggest,onInteractionAdded,onNavigate,pickJourney,setAddErr,setDoneFor,setDoneNote,setJourney,setJourneyBusy,setJourneyMenu,setSkipFor,setSkipWhy,setStopAsk,skipFor,skipWhy,stopAsk,touchGap}){
  return <>
          {/* ── THREAD-2b 5 · THEIR JOURNEY (Direction A) ──────────────
              "Step 3 of 7 · Impact report · due Jan 3" and a small
              done / today / upcoming timeline, exactly as the direction
              showed it. Brass when it is late — late is late, not dangerous,
              and red is only ever a destructive confirm. */}
          {journey&&journey.status==="active"&&(()=>{
            const steps=journey.steps||[];
            const cur=steps.find(x=>x.status==="open")||steps.find(x=>x.status==="pending");
            const doneCount=steps.filter(x=>x.status==="done"||x.status==="skipped").length;
            const pos=cur?cur.seq:steps.length;
            const late=cur&&cur.dueDate&&String(cur.dueDate).slice(0,10)<orgTodayCivil();
            return <div data-testid="dp-rail-journey">
              {/* FIX-4 2 — THE CHIP. It names the journey and it OPENS it,
                  because the next question after "which journey is she in"
                  is always "and what is in that journey" — and the answer
                  used to be four clicks away in Settings. */}
              <button data-testid="dp-journey-chip" type="button"
                onClick={()=>onNavigate&&onNavigate("journeys",{journeyId:journey.templateId||undefined})}
                title={`Open ${journey.templateName}`}
                style={{display:"inline-flex",alignItems:"center",gap:7,background:RAIL.panel,
                  border:"1px solid "+RAIL.line,borderRadius:99,padding:"5px 12px",marginBottom:9,
                  color:RAIL.text,fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit",maxWidth:"100%"}}>
                <span style={{width:6,height:6,borderRadius:"50%",background:T.greenMid,flexShrink:0}}/>
                <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{journey.templateName}</span>
                <span aria-hidden="true" style={{color:RAIL.dim}}>→</span>
              </button>
              <div style={{background:RAIL.panel,borderRadius:10,padding:"11px 12px"}}>
                <div data-testid="dp-journey-position" style={{fontSize:10.5,fontWeight:700,color:RAIL.dim}}>
                  Step {pos} of {steps.length}
                </div>
                <div style={{fontSize:14.5,fontWeight:700,color:RAIL.strong,marginTop:3}}>{cur?cur.label:"Finished"}</div>
                {cur&&cur.dueDate&&(
                  <div data-testid="dp-journey-due" style={{fontSize:12.5,fontWeight:600,marginTop:2,color:late?T.gold500:RAIL.dim}}>
                    due {new Date(cur.dueDate+"T12:00:00Z").toLocaleDateString("en-US",{month:"short",day:"numeric",timeZone:"UTC"})}
                  </div>
                )}
                {/* the progress bar: steps done or skipped, of all of them */}
                <div data-testid="dp-journey-progress" role="img" aria-label={`${doneCount} of ${steps.length} steps done`}
                  style={{height:5,borderRadius:99,background:RAIL.line,marginTop:9,overflow:"hidden"}}>
                  <div style={{width:`${steps.length?Math.round(100*doneCount/steps.length):0}%`,height:"100%",background:T.greenMid}}/>
                </div>
                {cur&&(
                  <div style={{display:"flex",gap:7,marginTop:12}}>
                    <button data-testid="dp-journey-done" disabled={journeyBusy}
                      onClick={()=>{setDoneFor(cur.id);setDoneNote("");}}
                      style={{background:T.greenDk,border:"none",borderRadius:8,padding:"8px 13px",color:T.white,fontSize:12.5,fontWeight:700,cursor:"pointer"}}>
                      Mark done
                    </button>
                    <button data-testid="dp-journey-skip" disabled={journeyBusy}
                      onClick={()=>{setSkipFor(cur.id);setSkipWhy("");}}
                      style={{background:"none",border:"1px solid "+RAIL.line,borderRadius:8,padding:"8px 13px",color:RAIL.text,fontSize:12.5,fontWeight:600,cursor:"pointer"}}>
                      Skip
                    </button>
                  </div>
                )}
              </div>
              {/* the next two steps, faded: what is coming after this one */}
              {cur&&steps.filter(x=>x.seq>cur.seq&&x.status==="pending").slice(0,2).map(x=>(
                <div key={x.id} data-testid="dp-journey-next" style={{display:"flex",justifyContent:"space-between",gap:8,padding:"6px 12px 0",opacity:0.55,fontSize:12.5,color:RAIL.text}}>
                  <span style={{minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{x.label}</span>
                  {x.dueDate&&<span style={{flexShrink:0,color:RAIL.dim}}>{new Date(x.dueDate+"T12:00:00Z").toLocaleDateString("en-US",{month:"short",day:"numeric",timeZone:"UTC"})}</span>}
                </div>
              ))}
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,marginTop:9}}>
                <div style={{fontSize:11.5,color:RAIL.dim,lineHeight:1.5}}>{journey.templateName} · started {displayDate(journey.appliedOn)}</div>
                {!isReadOnly&&<span style={{position:"relative",flexShrink:0}}>
                  <button type="button" data-testid="dp-journey-more" aria-haspopup="menu" aria-expanded={journeyMenu} aria-label="Journey options"
                    onClick={()=>setJourneyMenu(o=>!o)}
                    style={{background:"none",border:"1px solid "+RAIL.line,borderRadius:7,padding:"2px 9px",color:RAIL.text,fontSize:14,lineHeight:1.2,cursor:"pointer",fontFamily:"inherit"}}>…</button>
                  {journeyMenu&&<div role="menu" style={{position:"absolute",right:0,top:"calc(100% + 4px)",zIndex:30,background:T.white,border:"1px solid "+T.bg3,borderRadius:9,padding:4,minWidth:170,boxShadow:"0 10px 26px rgba(15,26,18,0.25)"}}>
                    {[["Change journey","change","dp-journey-change"],["Stop","stop","dp-journey-stop"]].map(([label,kind,tid])=>(
                      <button key={kind} role="menuitem" type="button" data-testid={tid} onClick={()=>{setJourneyMenu(false);setStopAsk(kind);}}
                        style={{display:"block",width:"100%",textAlign:"left",background:"none",border:"none",borderRadius:6,padding:"8px 10px",color:T.ink,fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>{label}</button>
                    ))}
                  </div>}
                </span>}
              </div>
              {/* Stopping asks once, here, not in a browser dialog. Change
                  journey is the same stop, then the picker. */}
              {stopAsk&&(
                <div data-testid="dp-journey-stop-ask" style={{marginTop:10,background:RAIL.bg,border:"1px solid "+RAIL.line,borderRadius:10,padding:"11px 12px"}}>
                  <div style={{fontSize:12.5,color:RAIL.text,lineHeight:1.5}}>
                    Stop {journey.templateName} for {firstNameOf(donor.name)||donor.name}? The steps already done stay on the record.
                  </div>
                  <div style={{display:"flex",gap:7,marginTop:9}}>
                    <button type="button" data-testid="dp-journey-stop-confirm" disabled={journeyBusy} onClick={async()=>{
                        setJourneyBusy(true);
                        try{const stopped=journey;const r=await apiFetch(`/plans/${stopped.id}/stop`,{method:"POST",body:JSON.stringify({})});setJourney(null);setStopAsk(null);
                          // FLOWS-10 item 4: one person's Stop has an Undo, like the batch path
                          offerUndo({message:r.sentence||"Stopped.",undoAction:async()=>{const u=await apiFetch(`/plans/${stopped.id}/stop/undo`,{method:"POST",body:JSON.stringify({})});setJourney(stopped);return u;}},stopped.templateName||"journey");}
                        catch(e){setAddErr(errorMessage(e,"The journey could not be stopped."));}
                        setJourneyBusy(false);}}
                      style={{background:T.greenDk,border:"none",borderRadius:8,padding:"7px 13px",color:T.white,fontSize:12.5,fontWeight:700,cursor:"pointer"}}>
                      {stopAsk==="change"?"Stop it and choose another":"Stop it"}
                    </button>
                    <button type="button" onClick={()=>setStopAsk(null)} style={{background:"none",border:"none",color:RAIL.dim,fontSize:12.5,cursor:"pointer"}}>Keep it</button>
                  </div>
                </div>
              )}

              {/* MARK DONE ASKS FOR ONE LINE. It is not paperwork: the line
                  becomes a real conversation on the record, which is what
                  makes Last contact true afterwards. */}
              {doneFor&&(
                <div style={{marginTop:10,background:RAIL.bg,border:"1px solid "+RAIL.line,borderRadius:10,padding:"11px 12px"}}>
                  <div style={{fontSize:12,color:RAIL.dim,marginBottom:7}}>What happened? One line.</div>
                  <input data-testid="dp-journey-done-note" autoFocus value={doneNote} onChange={e=>setDoneNote(e.target.value)}
                    placeholder="Called her, she was delighted."
                    style={{width:"100%",background:RAIL.panel,border:"1px solid "+RAIL.line,borderRadius:8,padding:"8px 10px",color:RAIL.text,fontSize:12.5,outline:"none"}}/>
                  <div style={{display:"flex",gap:7,marginTop:9}}>
                    <button disabled={!doneNote.trim()||journeyBusy} data-testid="dp-journey-done-save"
                      onClick={async()=>{
                        setJourneyBusy(true);
                        try{
                          const r=await apiFetch(`/plan-steps/${doneFor}/done`,{method:"POST",body:JSON.stringify({note:doneNote.trim()})});
                          setJourney(r.plan||null); setDoneFor(null); setDoneNote("");
                          if(onInteractionAdded)onInteractionAdded();
                        }catch(e){ window.alert(e?.message||"Could not save that."); }
                        setJourneyBusy(false);
                      }}
                      style={{background:doneNote.trim()?T.greenDk:RAIL.line,border:"none",borderRadius:8,padding:"7px 13px",
                              color:doneNote.trim()?T.white:RAIL.dim,fontSize:12.5,fontWeight:700,cursor:doneNote.trim()?"pointer":"not-allowed"}}>
                      Save and open the next
                    </button>
                    <button onClick={()=>setDoneFor(null)} style={{background:"none",border:"none",color:RAIL.dim,fontSize:12.5,cursor:"pointer"}}>Cancel</button>
                  </div>
                </div>
              )}

              {/* SKIP ASKS WHY IN ONE TAP. Four reasons cover almost every
                  case; "something else" is there for the rest. */}
              {skipFor&&(
                <div style={{marginTop:10,background:RAIL.bg,border:"1px solid "+RAIL.line,borderRadius:10,padding:"11px 12px"}}>
                  <div style={{fontSize:12,color:RAIL.dim,marginBottom:8}}>Why are you skipping it?</div>
                  <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                    {["Already done another way","Not right for this person","No time","They asked us not to"].map(r=>(
                      <button key={r} data-testid="dp-journey-skip-reason" disabled={journeyBusy}
                        onClick={async()=>{
                          setJourneyBusy(true);
                          try{
                            const out=await apiFetch(`/plan-steps/${skipFor}/skip`,{method:"POST",body:JSON.stringify({reason:r})});
                            setJourney(out.plan||null); setSkipFor(null);
                            if(onInteractionAdded)onInteractionAdded();
                          }catch(e){ window.alert(e?.message||"Could not skip that."); }
                          setJourneyBusy(false);
                        }}
                        style={{background:RAIL.panel,border:"1px solid "+RAIL.line,borderRadius:99,padding:"6px 11px",
                                color:RAIL.text,fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>{r}</button>
                    ))}
                  </div>
                  <input value={skipWhy} onChange={e=>setSkipWhy(e.target.value)} placeholder="Something else…"
                    style={{width:"100%",marginTop:8,background:RAIL.panel,border:"1px solid "+RAIL.line,borderRadius:8,padding:"7px 10px",color:RAIL.text,fontSize:12.5,outline:"none"}}/>
                  <div style={{display:"flex",gap:7,marginTop:8}}>
                    <button disabled={!skipWhy.trim()||journeyBusy}
                      onClick={async()=>{
                        setJourneyBusy(true);
                        try{
                          const out=await apiFetch(`/plan-steps/${skipFor}/skip`,{method:"POST",body:JSON.stringify({reason:skipWhy.trim()})});
                          setJourney(out.plan||null); setSkipFor(null); setSkipWhy("");
                          if(onInteractionAdded)onInteractionAdded();
                        }catch(e){ window.alert(e?.message||"Could not skip that."); }
                        setJourneyBusy(false);
                      }}
                      style={{background:skipWhy.trim()?T.greenDk:RAIL.line,border:"none",borderRadius:8,padding:"7px 13px",
                              color:skipWhy.trim()?T.white:RAIL.dim,fontSize:12.5,fontWeight:700,cursor:skipWhy.trim()?"pointer":"not-allowed"}}>Skip it</button>
                    <button onClick={()=>setSkipFor(null)} style={{background:"none",border:"none",color:RAIL.dim,fontSize:12.5,cursor:"pointer"}}>Cancel</button>
                  </div>
                </div>
              )}
            </div>;
          })()}

          {/* ── FIX-4 2 · ADD TO A JOURNEY ─────────────────────────────
              Offered only when they are in none, because one active plan
              per person is the model. WHY-1 Part 7: a short pitch, the
              journey Steward suggests for this person (from simple facts:
              monthly, lapsed, first year, major prospect, recently met) with
              its first three steps, the picker as the panel's one action,
              and a quiet link to every journey. */}
          {/* JOURNEYS-3 — every journey they are in, the next step from each,
              and why a step moved when it did. */}
          {allJourneys.length>1&&(
            <div data-testid="dp-journeys-all" style={{display:"flex",flexDirection:"column",gap:8}}>
              <div style={{fontSize:11.5,color:RAIL.dim}}>In {allJourneys.length} journeys. Their steps are at least {touchGap} days apart: a step already on the Thread keeps its day, then the higher-ranked journey goes first.</div>
              {allJourneys.map(j=>(
                <div key={j.planId} data-testid="dp-journeys-row" style={{background:RAIL.panel,border:"1px solid "+RAIL.line,borderRadius:10,padding:"9px 12px"}}>
                  <div style={{fontSize:13,fontWeight:700,color:RAIL.strong}}>{j.name}</div>
                  {j.next?(
                    <div style={{fontSize:12.5,color:RAIL.text,marginTop:2,lineHeight:1.45}}>
                      Next: {j.next.label}{j.next.dueDate?`, ${new Date(j.next.dueDate+"T12:00:00Z").toLocaleDateString("en-US",{month:"short",day:"numeric",timeZone:"UTC"})}`:""}
                      {j.next.movedReason&&<div style={{fontSize:11.5,color:RAIL.dim,marginTop:2}}>{j.next.movedReason}</div>}
                    </div>
                  ):<div style={{fontSize:12.5,color:RAIL.dim,marginTop:2}}>Every step is done.</div>}
                </div>
              ))}
            </div>
          )}
          {journey&&journey.status==="done"&&(()=>{
            const ends=(journey.steps||[]).map(x=>x.closedAt).filter(Boolean).sort();
            const on=ends.length?String(ends[ends.length-1]).slice(0,10):journey.appliedOn;
            return <div data-testid="dp-journey-finished" style={{fontSize:13,color:RAIL.text,lineHeight:1.5}}>
              Finished {journey.templateName} on {new Date(String(on).slice(0,10)+"T12:00:00Z").toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric",timeZone:"UTC"})}.
            </div>;
          })()}
          {!isReadOnly&&Array.isArray(journeyList)&&(
            <div data-testid="dp-rail-add-journey">
              {!(journey&&journey.status==="active")&&<div data-testid="dp-journey-pitch" style={{fontSize:12.5,color:RAIL.dim,lineHeight:1.55,marginBottom:10}}>
                Plan the next few touches so this donor never drifts. Steward puts each step on your Thread the day it's due. Nothing is sent.
              </div>}
              {journeySuggest&&!(journey&&journey.status==="active")&&(
                <div data-testid="dp-journey-suggest" style={{background:RAIL.panel,border:"1px solid "+RAIL.line,borderRadius:10,padding:"11px 12px",marginBottom:10}}>
                  <div style={{fontSize:10.5,fontWeight:700,color:RAIL.dim}}>Suggested</div>
                  <div style={{fontSize:14.5,fontWeight:700,color:RAIL.strong,marginTop:3}}>{journeySuggest.name}</div>
                  <div style={{fontSize:12,color:RAIL.dim,marginTop:2,lineHeight:1.45}}>{journeySuggest.why}</div>
                  <div style={{marginTop:8,display:"flex",flexDirection:"column",gap:4}}>
                    {journeySuggest.steps.map((x,i)=>(
                      <div key={i} style={{display:"flex",gap:8,fontSize:12.5,color:RAIL.text}}>
                        <span style={{flexShrink:0,minWidth:54,color:RAIL.dim}}>{x.when}</span><span>{x.label}</span>
                      </div>
                    ))}
                  </div>
                  <button type="button" data-testid="dp-journey-suggest-start" disabled={journeyBusy}
                    onClick={async()=>{
                      setJourneyBusy(true); setAddErr("");
                      try{
                        await apiFetch(`/journeys/${journeySuggest.journeyId}/apply`,{method:"POST",body:JSON.stringify({donorIds:[donor.id]})});
                        const r=await apiFetch(`/donors/${donor.id}/plan`);
                        setJourney(r.plan||null);
                        if(onInteractionAdded)onInteractionAdded();
                      }catch(e){ setAddErr(errorMessage(e,"Steward could not start that journey.")); }
                      setJourneyBusy(false);
                    }}
                    style={{marginTop:10,background:T.greenDk,border:"none",borderRadius:8,padding:"8px 13px",color:T.white,fontSize:12.5,fontWeight:700,cursor:journeyBusy?"wait":"pointer"}}>
                    {journeyBusy?"Starting…":"Start this journey"}
                  </button>
                </div>
              )}
              {journeyList.length===0?(
                <div style={{fontSize:12.5,color:RAIL.dim,lineHeight:1.55}}>
                  There are no journeys yet{". "}
                  <button type="button" data-testid="dp-journey-setup"
                    onClick={()=>onNavigate&&onNavigate("journeys")}
                    style={{background:"none",border:"none",padding:0,color:RAIL.strong,fontWeight:700,textDecoration:"underline",cursor:"pointer",fontFamily:"inherit",fontSize:"inherit"}}>
                    Set one up
                  </button>{" "}and it takes ten minutes.
                </div>
              ):(
                <>
                  <select data-testid="dp-journey-pick" aria-label="Start a journey" value={addPick} onChange={e=>pickJourney(e.target.value)}
                    style={{width:"100%",background:T.greenDk,border:"none",borderRadius:8,appearance:"none",WebkitAppearance:"none",
                            padding:"9px 30px 9px 12px",color:RAIL.strong,fontSize:13,fontWeight:700,outline:"none",fontFamily:"inherit",cursor:"pointer",
                            backgroundImage:"linear-gradient(45deg, transparent 50%, #FFFFFF 50%), linear-gradient(135deg, #FFFFFF 50%, transparent 50%)",
                            backgroundPosition:"calc(100% - 16px) 55%, calc(100% - 11px) 55%",backgroundSize:"5px 5px, 5px 5px",backgroundRepeat:"no-repeat"}}>
                    <option value="">Start a journey</option>
                    {journeyPickRows(journeyList,allJourneys).map(j=><option key={j.id} value={j.id} disabled={j.disabled} data-testid="dp-journey-option">{j.label}</option>)}
                  </select>
                  {addPreview&&(
                    <div data-testid="dp-journey-preview"
                      style={{marginTop:9,background:RAIL.panel,border:"1px solid "+RAIL.line,borderRadius:10,padding:"11px 12px"}}>
                      <div data-testid="dp-journey-preview-first" style={{fontSize:10.5,fontWeight:700,color:RAIL.dim}}>
                        {addPreview.firstStepLine||"First step"}
                      </div>
                      <div style={{fontSize:14,fontWeight:700,color:RAIL.strong,marginTop:3}}>
                        {addPreview.firstStep?addPreview.firstStep.label:"No steps yet"}
                      </div>
                      {addPreview.firstStep&&addPreview.firstStep.dueDate&&(
                        <div data-testid="dp-journey-preview-due" style={{fontSize:12.5,fontWeight:600,color:RAIL.dim,marginTop:2}}>
                          due {new Date(addPreview.firstStep.dueDate+"T12:00:00Z").toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric",timeZone:"UTC"})}
                        </div>
                      )}
                      {addPreview.anchorNote&&<div data-testid="dp-journey-preview-anchor" style={{fontSize:11.5,color:RAIL.dim,marginTop:5,lineHeight:1.5}}>{addPreview.anchorNote}</div>}
                      <div style={{fontSize:11.5,color:RAIL.dim,marginTop:7,lineHeight:1.5}}>{addPreview.touches}</div>
                      {addPreview.notActive&&(
                        <div data-testid="dp-journey-preview-off" style={{fontSize:11.5,color:T.gold500,marginTop:7,lineHeight:1.5}}>{addPreview.notActive}.</div>
                      )}
                      {addPreview.alreadyIn&&(
                        <div style={{fontSize:11.5,color:T.gold500,marginTop:7,lineHeight:1.5}}>
                          They are already working through &ldquo;{addPreview.alreadyIn}&rdquo;. Finish or stop that one first.
                        </div>
                      )}
                      <button data-testid="dp-journey-add-confirm" type="button"
                        disabled={journeyBusy||!addPreview.firstStep||!!addPreview.alreadyIn||addPreview.canStart===false}
                        onClick={confirmAddToJourney}
                        style={{marginTop:10,background:(addPreview.firstStep&&!addPreview.alreadyIn&&addPreview.canStart!==false)?T.greenDk:RAIL.line,
                          border:"none",borderRadius:8,padding:"8px 13px",
                          color:(addPreview.firstStep&&!addPreview.alreadyIn)?T.white:RAIL.dim,
                          fontSize:12.5,fontWeight:700,
                          cursor:(addPreview.firstStep&&!addPreview.alreadyIn&&!journeyBusy)?"pointer":"not-allowed"}}>
                        {journeyBusy?"Adding…":`Put ${firstNameOf(donor.name)} in it`}
                      </button>
                    </div>
                  )}
                  {addErr&&<div role="status" data-testid="dp-journey-add-error"
                    style={{fontSize:11.5,color:T.gold500,marginTop:8,lineHeight:1.45}}>{addErr}</div>}
                  <button type="button" data-testid="dp-journey-all" onClick={()=>onNavigate&&onNavigate("journeys")}
                    style={{marginTop:9,background:"none",border:"none",padding:0,color:RAIL.dim,fontSize:12,textDecoration:"underline",cursor:"pointer",fontFamily:"inherit"}}>
                    See all journeys or build your own
                  </button>
                </>
              )}
            </div>
          )}
  </>;
}

export { RailJourneys };
