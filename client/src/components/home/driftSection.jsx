import { countLabel, countWords } from "../../../../shared/countWords";
import { driftCounts, earlySignsPhrase, EARLY_SIGNS_HEADING, driftSinceYesterday, EARLY_SIGNS_MEANING } from "../../../../shared/driftWords";
import { T, fmtFull, PersonMark } from "../shared";
import { apiFetch } from "../../api";
import { OneLineEmpty } from "./homeParts";
import { Fragment } from "react";
import { displayName } from "../../../../shared/displayName.js";
import { NEXT_STEP_LABEL_MAX, sanitizeStepLabel, nextStepTypeForLabel } from "../../../../shared/threadShape";
import { DonorLink } from "../RecordLink";
import DateInput from "../inputs/LazyDateInput";   // POLISH-6: the one date box, loaded when shown (Home's first look stays in budget)

export function driftEmptyState({ driftData, driftHighRows, driftRows }) {
  return (
  (()=>{
    if(!driftData)return null;
    const ex=driftData.excluded||{};
    const exParts=[
      ex.singleGift>0&&`${ex.singleGift.toLocaleString()} single-gift (no pattern yet)`,
      ex.activeRecurring>0&&`${ex.activeRecurring.toLocaleString()} on active recurring`,
      ex.unlinkedSustainer>0&&`${countLabel(ex.unlinkedSustainer,"sustainer")} not yet reconnected`,
      ex.deceased>0&&`${ex.deceased.toLocaleString()} deceased`,
      ex.doNotSolicit>0&&`${ex.doNotSolicit.toLocaleString()} do-not-solicit`,
      ex.doNotContact>0&&`${ex.doNotContact.toLocaleString()} do-not-contact`,
      ex.pledgeCadence>0&&`${ex.pledgeCadence.toLocaleString()} on pledge schedules`,
    ].filter(Boolean);
    if(driftData.evaluated>0&&(driftData.giftedDonorCount??0)===0)return{
      head:"No giving history on file yet, so nothing to check.",
      body:`${countLabel(driftData.evaluated, "donor")} are on file with zero gifts between them, a giving pattern needs gifts. If your import should have carried giving history, re-run it with the gift columns mapped; drift starts watching the moment real gifts exist.`,
    };
    if(driftData.evaluated===0)return{
      head:"No donors to evaluate yet.",
      body:"Steward watches every donor's own giving pattern here. Once donors and their gift history are in, anyone quietly past their pattern surfaces on this list, if you just imported and this still reads zero donors, the import didn't land.",
    };
    if(driftData.counts.driftingHigh>0&&driftRows.length===0)return{
      head:"Everyone drifting has been contacted.",
      body:`All ${countWords(driftData.counts.driftingHigh,"drifting donor")} had outreach logged in the last 30 days, they stay off this list while the conversation is fresh, and come back if no gift follows.`,
    };
    // FIX-10 Part A — THE SENTENCE A CUSTOMER BELIEVED. This read "No donors
    // drifting." on a file with five donors drifting at medium confidence.
    // No surface says that while anyone is drifting at any confidence.
    const med=driftCounts(driftData).medium;
    if(med>0&&driftHighRows.length===0)return{
      head:`${earlySignsPhrase(med)}, and no confirmed drift.`,
      body:`${med===1?"One donor is":`${med.toLocaleString()} donors are`} a little past their own giving rhythm, `
        +`not far enough past it to be sure: they are listed under ${EARLY_SIGNS_HEADING}, and they are not counted in the money at risk above. `
        +`Checked ${countLabel(driftData.giftedDonorCount??driftData.evaluated,"donor")} with giving history`
        +(driftData.counts.lapsed>0?`, ${driftData.counts.lapsed.toLocaleString()} already lapsed`:"")
        +(exParts.length?`, and ${exParts.join(", ")} excluded from drift`:"")
        +".",
    };
    return{
      head:"No donors drifting.",
      body:`Checked ${countLabel(driftData.giftedDonorCount??driftData.evaluated,"donor")} with giving history: `
        +`${(driftData.onPattern||0).toLocaleString()} giving on their own pattern`
        +(driftData.counts.lapsed>0?`, ${driftData.counts.lapsed.toLocaleString()} already lapsed`:"")
        +(exParts.length?`, and ${exParts.join(", ")} excluded from drift`:"")
        +". A gap in anyone's own rhythm will surface here.",
    };
  })()
  );
}

export function driftSection({ cPad, cardWrap, driftAllData, driftBusy, driftData, driftEarlyStart, driftEmptyState, driftExpanded, driftHighRows, driftLine, driftLineFor, driftQs, driftRows, driftRowsAll, driftSort, driftStep, driftStepDirty, foldBtn, homeFold, isReadOnly, loadDrift, onNavigate, onPanel, openDriftLine, openEarlySigns, proposeDriftStep, sHdr, sHdrPad, sLink, sSerif, setDriftAllData, setDriftExpanded, setDriftLine, setDriftLineFor, setDriftSort, setDriftStep, setDriftStepDirty, submitDriftDone, surface }) {
  return (
  driftData?(
      <div id="dash-drifting" style={{...cardWrap,scrollMarginTop:64}}>
        <div className="dash-cpad" style={{...cPad,...sHdrPad,...sHdr}}>
          <span style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
            <span style={sSerif}>Drift</span>
            {surface==="home"&&foldBtn("drift","the Drift list")}
            <span style={{fontSize:11.5,color:T.ink3}}>
              {driftData.counts.driftingHigh>0
                ?`${fmtFull(driftData.atRiskAmount)} at risk, the sum of what these donors usually give · ${countLabel(driftData.counts.driftingHigh, "donor")} past their own pattern`
                :"watching every donor's own giving pattern"}
              {driftData.importCaveat && <span style={{color:T.gold700}}> · {driftData.importCaveat}</span>}
              {/* POLISH-1 Part 6: when the count moved overnight with nothing
                  new, the line says who crossed and who left. */}
              {driftSinceYesterday(driftData.sinceYesterday) && <span data-testid="drift-since-yesterday"> · {driftSinceYesterday(driftData.sinceYesterday)}</span>}
            </span>
          </span>
          <select aria-label="Order the drift list" data-testid="drift-sort" value={driftSort}
            onChange={e=>{const v=e.target.value;setDriftSort(v);if(driftAllData){apiFetch(`/drift?all=1&includeMedium=1${driftQs(v)?"&"+driftQs(v):""}`).then(setDriftAllData).catch(()=>{});}else loadDrift(v);}}
            style={{marginLeft:"auto",marginRight:10,border:"1px solid "+T.bg3,borderRadius:8,padding:"4px 8px",fontSize:12,background:T.white,color:T.ink,fontFamily:"inherit"}}>
            <option value="">Most at risk first</option>
            <option value="engagement">Closest first</option>
          </select>
          {(driftData.total>driftData.list.length||driftCounts(driftData).medium>0)&&!driftAllData&&(
            <button onClick={openEarlySigns} style={sLink}>
              See all {driftCounts(driftData).total} →
            </button>
          )}
          {driftAllData&&(
            <button onClick={()=>setDriftAllData(null)} style={sLink}>Show top {driftData.cap}</button>
          )}
        </div>
        {/* FIX-10 Part A — one quiet line, under the high-confidence card.
            Home is allowed to lead with the confirmed drifters; it is not
            allowed to leave the early ones with no door. */}
        {!homeFold.drift&&driftCounts(driftData).medium>0&&!driftAllData&&driftHighRows.length>0&&(
          <div className="dash-cpad" style={{...cPad,paddingTop:10,paddingBottom:10,borderTop:"1px solid "+T.bg3,fontSize:12,color:T.ink3}}>
            {`${earlySignsPhrase(driftCounts(driftData).medium)}, ${EARLY_SIGNS_MEANING}. `}
            <button onClick={openEarlySigns} style={{...sLink,padding:0}}>Open</button>
          </div>
        )}
        {driftRows.length===0&&driftEmptyState&&(
          <OneLineEmpty flush={onPanel} testId="drift-empty-state" line={driftEmptyState.head} detail={driftEmptyState.body}/>
        )}
        {driftRows.length>0&&!(surface==="home"&&homeFold.drift)&&(
        <ul className="attn-list" style={{listStyle:"none",margin:0,padding:0}}>
          {driftRows.map((r,i)=>{
            const lineOpen=driftLineFor===r.donorId;
            return(
              <Fragment key={r.donorId}>
              {/* FIX-10 Part A — the group heading, and the sentence that says
                  what an early sign is. It appears once, above the first
                  medium row, never when there are none. */}
              {i===driftEarlyStart&&(
                <li style={{borderTop:"1px solid "+T.bg3,padding:"11px 20px",background:T.bg2}}>
                  <span style={{fontSize:11,fontWeight:800,color:T.ink3}}>{EARLY_SIGNS_HEADING}</span>
                  {" "}
                  <span style={{fontSize:11.5,color:T.ink3,marginLeft:8}}>{EARLY_SIGNS_MEANING}</span>
                </li>
              )}
              <li style={{borderBottom:i<driftRows.length-1?"1px solid "+T.bg3:"none",borderLeft:"3px solid "+T.gold500}}>
                <div style={{display:"flex",alignItems:"stretch"}}>
                  <a className="attn-row-main" href={`/donors/${r.donorId}`}
                    style={{flex:1,minWidth:0,display:"flex",alignItems:"flex-start",gap:14,padding:"13px 20px",textDecoration:"none",color:"inherit"}}
                    onClick={e=>{if(e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;e.preventDefault();onNavigate("donors",{selectDonorId:r.donorId});}}>
                    <PersonMark id={r.donorId} name={r.donorName} size={38}/>
                    <div style={{flex:1,minWidth:0}}>
                      <div className="attn-donor-name" style={{fontSize:13,fontWeight:700,color:T.ink}}>{displayName(r.donorName)}</div>
                      <div style={{fontSize:12,color:T.ink2,marginTop:2,lineHeight:1.45}}>{r.reason}</div>
                      {/* ENGAGE-1 — engagement on the row; an early sign says when they have gone quiet too. */}
                      {r.engagement!=null&&<div style={{fontSize:11.5,color:r.earlySign?T.gold700:T.ink3,marginTop:2}}>{r.earlySign||`Engagement ${r.engagement}`}</div>}
                      {r.meetingSet&&<div data-testid="drift-meeting-set" style={{fontSize:11.5,color:T.greenDk,fontWeight:700,marginTop:2}}>{r.meetingSet}</div>}
                    </div>
                    {/* BUILD-83 Part 4 — the figure is the donor's USUAL gift, the
                        amount their own sentence names, and it carries its label.
                        Baker Community Foundation shows $2,500, not the one
                        $25,000 it gave once. */}
                    <div style={{textAlign:"right",whiteSpace:"nowrap",paddingTop:2}}>
                      <div style={{fontSize:13.5,fontWeight:800,fontFamily:"'DM Serif Display',serif",color:T.ink}}>{fmtFull(r.usualGift||0)}</div>
                      {/* FIX-10 Part A — the headline sums high confidence only,
                          so a medium row may not label its dollars "at risk":
                          that money is not in the number above it. It says
                          what the figure actually is. */}
                      <div style={{fontSize:10,fontWeight:700,color:T.ink3,marginTop:1}}>{r.confidence==="medium"?"usually gives":"at risk"}</div>
                    </div>
                  </a>
                  {!lineOpen&&(
                    <div style={{display:"flex",alignItems:"center",padding:"8px 20px 8px 8px",flexShrink:0}}>
                      {/* BUILD-83 Part 4 — "Log the call" opens the Thread's log
                          step for this donor: nothing on this list ends without a
                          record. Dismiss is secondary and writes its reason. */}
                      <button onClick={()=>onNavigate("donors",{selectDonorId:r.donorId,openConversation:true})} disabled={isReadOnly}
                        title={isReadOnly?"Reactivate your subscription to make changes.":"Log the call and the next step comes back"}
                        className="attn-row-action" style={{background:"transparent",border:"1px solid "+T.greenDk,borderRadius:8,padding:"7px 12px",color:T.greenDk,fontSize:12,fontWeight:700,cursor:isReadOnly?"not-allowed":"pointer",whiteSpace:"nowrap",opacity:isReadOnly?0.45:1}}>
                        Log the call
                      </button>
                      <button onClick={()=>openDriftLine(r.donorId)} disabled={isReadOnly}
                        title="Say in one line why they are fine. They leave this list for 30 days, the line goes on their record, and they come back if they stay quiet."
                        style={{background:"transparent",border:"none",padding:"7px 4px",marginLeft:6,color:T.ink3,fontSize:12,fontWeight:600,cursor:isReadOnly?"not-allowed":"pointer",whiteSpace:"nowrap",opacity:isReadOnly?0.45:1}}>
                        They're fine, hide this
                      </button>
                    </div>
                  )}
                </div>
                {lineOpen&&(
                  <div style={{padding:"0 20px 13px 72px"}}>
                  <div style={{display:"flex",gap:8,alignItems:"center"}}>
                    <input autoFocus value={driftLine} onChange={e=>{setDriftLine(e.target.value);proposeDriftStep(e.target.value);}}
                      onKeyDown={e=>{if(e.key==="Enter"&&driftLine.trim())submitDriftDone(r.donorId,driftLine);if(e.key==="Escape")setDriftLineFor(null);}}
                      placeholder="Why are they fine? One line. They leave this list for 30 days (Enter saves, Esc cancels)"
                      style={{flex:1,border:"1px solid "+T.bg3,borderRadius:8,padding:"8px 12px",fontSize:12.5,color:T.ink,background:T.bg,outline:"none"}}/>
                    <button onClick={()=>submitDriftDone(r.donorId,driftLine)} disabled={driftBusy||!driftLine.trim()}
                      title={!driftLine.trim()?"A reason is what makes this a record instead of a disappearance":""}
                      style={{background:T.greenDk,border:"none",borderRadius:8,padding:"8px 14px",color:T.white,fontSize:12,fontWeight:700,cursor:(driftBusy||!driftLine.trim())?"not-allowed":"pointer",opacity:driftLine.trim()?1:0.45}}>Save</button>
                    <button onClick={()=>setDriftLineFor(null)} disabled={driftBusy}
                      style={{background:"transparent",border:"none",padding:"8px 4px",color:T.ink3,fontSize:12,fontWeight:700,cursor:driftBusy?"wait":"pointer"}}>Cancel</button>
                  </div>
                  {/* The step this line is about to open — an input, not a
                      preview: one click into it and it is yours. Clearing it
                      saves the line with no next step at all. */}
                  {driftStep&&(
                    <div style={{display:"flex",gap:8,alignItems:"center",marginTop:8}}>
                      <span style={{fontSize:11,fontWeight:700,color:T.ink3,whiteSpace:"nowrap"}}>Next step</span>
                      <input className="drift-step-input" value={driftStep.label} maxLength={NEXT_STEP_LABEL_MAX}
                        onChange={e=>{setDriftStepDirty(true);setDriftStep(st=>({...st,label:e.target.value}));}}
                        aria-label="Next step" placeholder="Leave blank for no next step"
                        style={{flex:"1 1 180px",minWidth:0,border:"1px solid "+T.bg3,borderRadius:8,padding:"6px 10px",fontSize:12.5,color:T.ink,background:T.bg,outline:"none"}}/>
                      <DateInput className="drift-step-due" value={driftStep.due||""}
                        onChange={e=>{setDriftStepDirty(true);setDriftStep(st=>({...st,due:e.target.value}));}}
                        aria-label="Next step due date"
                        style={{flex:"0 0 auto",border:"1px solid "+T.bg3,borderRadius:8,padding:"6px 10px",fontSize:12,color:T.ink,background:T.bg,outline:"none"}}/>
                    </div>
                  )}
                  {driftStep?.source&&!driftStepDirty&&(
                    <div style={{fontSize:11,color:T.ink3,marginTop:4}}>
                      {driftStep.source.why}{driftStep.source.matched?<span style={{fontStyle:"italic"}}>{", \u201c"+driftStep.source.matched+"\u201d"}</span>:null}
                    </div>
                  )}
                  </div>
                )}
              </li>
              </Fragment>
            );
          })}
        </ul>
        )}
        {surface==="home"&&!homeFold.drift&&!driftAllData&&driftRowsAll.length>5&&(
          <div className="dash-cpad" style={{...cPad,paddingTop:10,paddingBottom:12,borderTop:"1px solid "+T.bg3}}>
            <button data-testid="drift-more" onClick={()=>setDriftExpanded(v=>!v)} style={{...sLink,padding:0}}>
              {driftExpanded?"Show the first five":`Show the other ${driftRowsAll.length-5}`}
            </button>
          </div>
        )}
        {/* BUILD-80 Part 7 — INSTITUTIONAL GIVING: a foundation's grant cycle
            is not a person's giving cadence. Their own list, grant-cycle
            language, and never a Re-engage button. */}
        {driftData.institutional?.length > 0 && (
          <div style={{...cPad,...(onPanel?{marginTop:12,paddingTop:14}:{}),borderTop:"1px solid "+T.bg3}}>
            <div style={{fontSize:12,fontWeight:800,color:T.ink3,marginBottom:6}}>
              Institutional giving: foundations, donor-advised funds, churches and businesses
            </div>
            {driftData.institutional.slice(0,8).map(inst=>(
              <div key={inst.donorId} style={{display:"flex",justifyContent:"space-between",gap:10,fontSize:12.5,color:T.ink2,padding:"3px 0"}}>
                <DonorLink id={inst.donorId} onOpen={()=>onNavigate("donors",{selectDonorId:inst.donorId})} data-testid="institution-link"
                  style={{minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",color:T.gold700,fontWeight:600,textDecoration:"underline",
                    textDecorationColor:"rgba(138,109,31,0.4)",textUnderlineOffset:3,background:"none",border:"none",padding:0,font:"inherit",cursor:"pointer",textAlign:"left"}}>{inst.name}</DonorLink>
                <span style={{flexShrink:0,fontVariantNumeric:"tabular-nums",color:T.ink3}}>
                  {/* FIX-1 — the server's word (a grant only from a foundation or DAF) and the date as it reads */}
                  {fmtFull(inst.totalGiving)}{inst.lastGiftLabel?` · ${inst.lastWord||"last gift"} ${inst.lastGiftLabel}`:""}
                </span>
              </div>
            ))}
            <div style={{fontSize:11,color:T.ink3,marginTop:4}}>Organizations give on their own calendars (a foundation's grant cycle, a church's budget year), so review these when planning, not as lapsed donors.</div>
          </div>
        )}
      </div>
  ):null
  );
}

export function submitDriftDone({ driftBusy, driftStep, loadDrift, setDriftBusy, setDriftLine, setDriftLineFor, setDriftStep, setDriftStepDirty }) {
  const submitDriftDone=async(donorId,note)=>{
    if(driftBusy)return;
    setDriftBusy(true);
    try{
      const label=sanitizeStepLabel(driftStep&&driftStep.label);
      const nextStep=label?{type:nextStepTypeForLabel(label),label,due:driftStep.due,source:driftStep.source?.from||null}:{skipped:true};
      await apiFetch(`/drift/${donorId}/done`,{method:"POST",body:JSON.stringify({note:note||"",nextStep})});
      setDriftLineFor(null);setDriftLine("");setDriftStep(null);setDriftStepDirty(false);
      await loadDrift();
    }catch{/* leave the row; nothing was recorded */}
    finally{setDriftBusy(false);}
  };
  return submitDriftDone;
}
