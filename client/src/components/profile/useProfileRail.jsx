// SPLIT-2: moved VERBATIM from DonorProfile.jsx (its lines 1145-1273): the profile's
// state and handlers for this part, as a hook the profile calls in the same place,
// so every hook runs in the same order. Nothing it does changed.
// Tests read it through readSource("client/src/components/DonorProfile.jsx").
import { RAIL_LABEL, RailSection } from "../ProfileRail";
import { T, fmtFull, firstNameOf } from "../shared";
import { displayDateShort } from "../../../../shared/displayDate";
import { PROPOSAL_STAGE_LABEL, lateWords } from "./profileShared";
import { stepAgainstProposals } from "../../../../shared/nextStepAgree.js";
import { MEETING_ACTION } from "../MeetingPanels";
import { SuggestedAskLine } from "../ScoreWhy";
import { PutItOnMyCalendar, ThreadDismissMenu } from "../LogConversation";
import { EditedMarker } from "../EditHistory";
import OpenPledgeBanner from "../OpenPledgeBanner";
import { ProfileNextMove } from "../Insights";
import DateInput from "../inputs/DateInput";   // POLISH-6: the one date box

export function useProfileRail({ donor, isReadOnly, rel, setLogMeeting, stepEdit, setStepEdit, stepBusy, dpThread, dpItems, setConvoOpen, setPlanOpen, openProposals, proposalsKnown, loadDpThread, saveStep, deleteStep, snoozing, snoozeErr, snoozeThread, callName, setDpTab, pledges, setAddGiftForm, setAddGiftOpen, tasks, gifts, giftLoading, giftReadErr, giftsFull, tlCounts, getAI, org, setSuggestOpen, isTeam, openForNextMove }) {

  // ── PROFILE-2 Part 3 · three nodes that move on a phone: the next move and
  // the rail's Next step and Open pledge sit above the tabs at 390.
  const railNextNode=<div data-testid="dp-next" style={{display:"flex",flexDirection:"column",gap:10}}>
              <h4 style={RAIL_LABEL}>Next step</h4>
              {dpItems.length>0?(
                <div data-testid="dp-open-items" style={{background:T.white,border:"1px solid "+T.bg3,borderLeft:"4px solid "+(dpItems.some(x=>x.overdue)?T.gold500:T.greenDk),borderRadius:10,padding:"16px 18px",display:"flex",flexDirection:"column",gap:14}}>
                  {dpThread?.snoozedUntil&&<div style={{fontSize:11,color:T.ink3}}>Set aside until {displayDateShort(dpThread.snoozedUntil,new Date())}</div>}
                  {dpItems.map(it=>(
                    <div key={it.id} data-open-item={it.kind} style={{display:"flex",alignItems:"center",gap:16,flexWrap:"wrap"}}>
                      <div style={{flex:"1 1 240px",minWidth:0}}>
                        {(()=>{
                          // FIX-24 2c: with no proposal open, the step is to write it.
                          const ag=proposalsKnown?stepAgainstProposals(it.nextStep.label,openProposals.length):{label:it.nextStep.label,changed:false};
                          return <>
                            <div style={{fontSize:16,fontWeight:700,color:T.ink,marginBottom:4}}>{ag.label}</div>
                            {ag.changed&&<div data-testid="dp-step-agree" style={{fontSize:12.5,color:T.ink3,lineHeight:1.5,marginBottom:4}}>{ag.why}</div>}
                          </>;
                        })()}
                        {it.suggestedAsk&&<SuggestedAskLine ask={it.suggestedAsk} style={{marginBottom:4}}/>}
                        <div style={{fontSize:13,color:T.ink3,lineHeight:1.5}}>
                          {/* POLISH-2: lateness is said once. A late step reads "2 days
                              late", not that plus "day 4" plus "Overdue Oct 10". */}
                          {it.lastTouch?.line?<>&ldquo;{it.lastTouch.line}&rdquo;</>:it.lastTouch?.kind==="gift"&&it.lastTouch.amount!=null?<>{fmtFull(it.lastTouch.amount)} received</>:(it.overdue&&/^(Overdue |\d+ days? late)/i.test(it.rank?.why||"")?null:it.rank?.why||null)}
                          {it.lastTouch?.date&&it.kind!=="task"?<> · {displayDateShort(it.lastTouch.date,new Date())}</>:null}
                          {it.lastTouch?.actor?<> · {firstNameOf(it.lastTouch.actor)}</>:null}
                          {it.overdue?null:<>{" · "}{it.daysOpen>=1?`day ${it.daysOpen}`:"opened today"}</>}
                          {" "}
                          <span style={{fontWeight:700,color:it.overdue?T.gold700:T.greenDk}}>
                            {it.overdue?lateWords(it.nextStep.due):<>Due {displayDateShort(it.nextStep.due,new Date())}</>}
                          </span>
                        </div>
                        {/* FIX-33 · a booked meeting IS the next step, with its two moves;
                            its prep and after tasks open the brief and the note. */}
                        {(()=>{
                          const ev=it.calendarEventId;
                          if(!ev||isReadOnly)return null;
                          const fire=action=>window.dispatchEvent(new CustomEvent(MEETING_ACTION,{detail:{action,eventId:ev}}));
                          const findMeeting=()=>[...(rel?.upcoming||[]),...(rel?.past||[])].find(m=>m.id===ev);
                          const link={background:T.white,border:"1px solid "+T.ink,borderRadius:8,padding:"6px 12px",color:T.ink,fontSize:12.5,fontWeight:700,cursor:"pointer",fontFamily:"inherit"};
                          return <div data-testid="dp-meeting-step-actions" style={{display:"flex",gap:8,marginTop:8,flexWrap:"wrap"}}>
                            {it.nextStep.type==="meeting"&&<><button type="button" data-testid="dp-meeting-prep" onClick={()=>fire("prep")} style={link}>Prep</button>
                              <button type="button" data-testid="dp-meeting-reschedule" onClick={()=>fire("reschedule")} style={link}>Reschedule</button></>}
                            {it.nextStep.type==="meeting_prep"&&<button type="button" onClick={()=>fire("prep")} style={link}>Open the brief</button>}
                            {it.nextStep.type==="meeting_after"&&<button type="button" data-testid="dp-meeting-howdid" onClick={()=>{const m=findMeeting();if(m)setLogMeeting(m);}} style={link}>How did it go?</button>}
                          </div>;
                        })()}
                        {stepEdit&&stepEdit.id===it.id&&(
                          <div data-testid="dp-step-edit" style={{display:"flex",gap:6,flexWrap:"wrap",marginTop:8}}>
                            <input aria-label="Next step" value={stepEdit.label} onChange={e=>setStepEdit({...stepEdit,label:e.target.value})} style={{flex:"1 1 160px",border:"1px solid "+T.bg3,borderRadius:8,padding:"7px 9px",fontSize:13,fontFamily:"inherit"}}/>
                            <DateInput aria-label="Due" value={stepEdit.due} onChange={e=>setStepEdit({...stepEdit,due:e.target.value})} style={{border:"1px solid "+T.bg3,borderRadius:8,padding:"6px 8px",fontSize:13,fontFamily:"inherit"}}/>
                            <button onClick={saveStep} disabled={stepBusy||!stepEdit.label.trim()} style={{background:T.greenDk,border:"none",borderRadius:8,padding:"7px 12px",color:T.white,fontSize:12.5,fontWeight:700,cursor:"pointer"}}>{stepBusy?"Saving…":"Save"}</button>
                            <button onClick={()=>setStepEdit(null)} style={{background:"none",border:"none",color:T.ink3,fontSize:12.5,cursor:"pointer"}}>Cancel</button>
                          </div>
                        )}
                      </div>
                      {it.kind!=="task"&&(
                        <div style={{display:"flex",gap:6,alignItems:"center",flexShrink:0}}>
                          {/* PROFILE-1 follow-up — an INK OUTLINE, not a second
                              emerald. The mockup drew this filled, and the
                              standing rule it did not account for is that
                              emerald is the ONE action colour and exactly one
                              control on a screen may mean "this is the
                              button" (BUILD-86 C.1). The header's Log a
                              conversation is that control. Caught by
                              tests/fix2-c-cream §2c, which had been skipping
                              in CI for want of a browser. */}
                          <button onClick={()=>setConvoOpen(true)} disabled={isReadOnly} data-testid="dp-mark-done"
                            style={{background:T.white,border:"1.5px solid "+T.ink,borderRadius:9,padding:"9px 14px",color:T.ink,fontSize:13,fontWeight:700,cursor:isReadOnly?"not-allowed":"pointer",opacity:isReadOnly?0.5:1}}>Mark done</button>
                          <button onClick={()=>snoozeThread(it)} disabled={isReadOnly||snoozing===it.id} data-testid="dp-snooze"
                            style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:9,padding:"9px 14px",color:T.ink,fontSize:13,fontWeight:700,cursor:isReadOnly?"not-allowed":"pointer",opacity:isReadOnly?0.5:1}}>{snoozing===it.id?"Snoozing…":"Snooze"}</button>
                          {/* BUILD-94 Part 5 — the same three outputs as the
                              Home row, from the same builder. */}
                          {it.kind==="thread"&&<PutItOnMyCalendar threadId={it.id} compact/>}
                          {/* FIX-14 Part 3 — the one next step is edited and deleted here.
                              POLISH-3 — in the "…" menu, with who edited it, not as a
                              row of underlined words beside the buttons. */}
                          <ThreadDismissMenu thread={it} onDone={loadDpThread}
                            extra={it.kind==="thread"&&!isReadOnly?[
                              {label:"Edit the step",testid:"dp-step-edit-btn",onClick:()=>setStepEdit({id:it.id,label:it.nextStep.label||"",due:String(it.nextStep.due||"").slice(0,10)})},
                              {label:"Delete the step",testid:"dp-step-delete",onClick:()=>deleteStep(it)},
                            ]:null}
                            footer={it.kind==="thread"&&it.edited_at?<EditedMarker item={it}/>:null}/>
                        </div>
                      )}
                    </div>
                  ))}
                  {snoozeErr&&<div style={{fontSize:12,color:T.terra700}}>{snoozeErr}</div>}
                </div>
              ):openProposals.length>0?(
                /* HOTFIX-1's RULE, AND THE REASON IT IS A RULE. A donor can
                   have no thread and no task and still have an ask in flight,
                   and the first draft of this very section answered "nothing
                   is open" on exactly that record — with the proposal sitting
                   four inches below it. An open proposal IS the next step, so
                   it is named here, with what it asks for and when an answer
                   is expected. (tests/profile1-screen §6 is the guard.) */
                <div data-testid="dp-open-items" data-open-item="proposal" style={{background:T.white,border:"1px solid "+T.bg3,borderLeft:"4px solid "+T.greenDk,borderRadius:10,padding:"16px 18px",display:"flex",gap:16,alignItems:"center",flexWrap:"wrap"}}>
                  <div style={{flex:"1 1 240px",minWidth:0}}>
                    <div style={{fontSize:16,fontWeight:700,color:T.ink,marginBottom:4}}>{openProposals[0].purpose||"An open ask"}</div>
                    <div style={{fontSize:13,color:T.ink3,lineHeight:1.5}}>
                      {openProposals[0].askAmount!=null?<>{fmtFull(openProposals[0].askAmount)} · </>:null}
                      {PROPOSAL_STAGE_LABEL[openProposals[0].stage]||openProposals[0].stage}
                      {openProposals[0].expectedClose?<> · <span style={{fontWeight:700,color:T.greenDk}}>An answer is expected {displayDateShort(openProposals[0].expectedClose,new Date())}</span></>:null}
                      {openProposals.length>1?<> · and {openProposals.length-1} more open {openProposals.length-1===1?"ask":"asks"}</>:null}
                    </div>
                  </div>
                </div>
              ):(
                <div data-testid="dp-next-empty" style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:10,padding:"16px 18px",display:"flex",gap:14,alignItems:"center",flexWrap:"wrap"}}>
                  <div style={{flex:"1 1 240px",fontSize:13.5,color:T.ink3,lineHeight:1.6}}>
                    {/* FIX-57: a sentence that needs a name waits for it ("Nothing is open for ." while the record loaded) */}
                    {String(donor.name||"").trim()?`Nothing is open for ${callName}.`
                      :<span data-testid="dp-name-wait" aria-label="Loading" style={{display:"inline-block",width:"min(320px,80%)",height:12,borderRadius:6,background:T.bg2,verticalAlign:"middle"}}/>}
                  </div>
                  {!isReadOnly&&<button type="button" data-testid="dp-next-plan" onClick={()=>setPlanOpen(true)} style={{background:T.greenDk,color:T.white,border:"none",borderRadius:9,padding:"9px 14px",fontSize:13,fontWeight:700,cursor:"pointer",minHeight:40}}>Plan a follow-up</button>}
                </div>
              )}
            </div>;
  const railPledgeNode=pledges.some(p=>p.status==="open"&&Number(p.balance)>0)?<RailSection title="Open pledge" testid="dp-rail-pledge"><div style={{margin:"-2px -4px"}}>
          <OpenPledgeBanner pledges={pledges} donorName={donor.name} donorId={donor.id} isReadOnly={isReadOnly}
            onRecordPayment={(pl,next)=>{setDpTab("giving");setAddGiftOpen(true);
              // PROFILE-3: "gifts" stopped being a tab in PROFILE-2, so this blanked the main column. Giving, with the form in view.
              setTimeout(()=>{const f=document.querySelector("[data-testid=dp-add-gift-form]");if(f&&f.scrollIntoView)f.scrollIntoView({block:"center"});},150);setAddGiftForm(f=>({...f,pledgeId:pl.id,amount:String(next?next.amount:pl.balance)}));}}/>
        </div></RailSection>:null;
  // PROFILE-3 · NOTHING LOGGED YET: no gift, pledge, conversation, email, note,
  // task, file or meeting. The main column is one quiet start card, and the
  // "Nothing due" line and the empty timeline are not drawn.
  const nothingLogged=!!rel&&!giftLoading&&!giftReadErr&&gifts.length===0&&giftsFull.length===0&&pledges.length===0
    &&Object.values(tlCounts).every(n=>!n)&&!(tasks||[]).length&&!(rel.upcoming||[]).length&&!rel.nextMeeting;
  const nextMoveNode=<div className="dp2-nextmove"><ProfileNextMove donorId={donor.id} firstName={callName} isReadOnly={isReadOnly||!isTeam} quietNone={nothingLogged}
              aiOn={!!(org&&org.capabilities&&org.capabilities.ai)&&isTeam} onDraft={()=>{setSuggestOpen(true);getAI(donor,"nextmove",openForNextMove);}}/></div>;
  return { railNextNode, railPledgeNode, nothingLogged, nextMoveNode };
}
