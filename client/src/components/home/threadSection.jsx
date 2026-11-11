import { T, activeMark } from "../shared";
import { countLabel } from "../../../../shared/countWords";
import { PinsIfAny, OneLineEmpty } from "./homeParts";
import { apiFetch } from "../../api";

export function threadSection({ cPad, cardWrap, crossover, dhNotice, foldBtn, gsNotice, homeCalm, homeData, homeFold, homeRows, isReadOnly, jsNotice, loadThreads, moveLine, onNavigate, onPanel, sHdr, sHdrPad, sLink, sSerif, sampleStatus, setDhNotice, setGsNotice, setPlanFor, setThreadAllOpen, setThreadExpanded, setThreadScope, surface, threadAllOpen, threadExpanded, threadList, threadRows, threadScope, threadStat, threadsData }) {
  return (
      <div style={{display:"flex",flexDirection:"column",gap:14}}>
          {/* ── VOL-1 · THE CROSSOVER ─────────────────────────────────────
              The thing nobody else does: the people who already say yes with
              their time and have never been asked for a gift.

              HOME-CALM — IT IS NOT ABOVE THE WORK ANY MORE. VOL-1 put it
              there reasoning that a next step belongs above the Thread, and
              that was true of a next step somebody is waiting on. This one
              is an IDEA — a good one, worth having, and worth having after
              the four people who are actually waiting rather than in front
              of them, with a green bar making it the brightest thing on a
              screen opened at 7:40. On Home it renders once, plain, at the
              very bottom (see homeCrossoverCard). The Dashboard keeps it
              here, where it reads as one of the board's standing ideas. */}
          {surface!=="home"&&crossover&&crossover.nextStep&&(
            <button data-testid="home-volunteer-crossover"
              onClick={()=>onNavigate&&onNavigate("volunteers")}
              style={{textAlign:"left",background:T.white,border:"1px solid "+T.bg2,borderLeft:"3px solid "+T.greenDk,
                      borderRadius:10,padding:"11px 14px",cursor:"pointer",fontFamily:"inherit"}}>
              <div style={{fontSize:13.5,fontWeight:700,color:T.ink}}>{crossover.nextStep.label}</div>
              <div style={{fontSize:12.5,color:T.ink3,marginTop:2,lineHeight:1.5}}>{crossover.nextStep.why}</div>
            </button>
          )}
          {/* ABOVE the Thread, not inside it. The Thread is the work; this is
              a note about whose work it is, and it outranks the first row. */}
          {surface==="home"&&sampleStatus?.hasSampleData&&!(sampleStatus.realDonorCount>0)&&(
            <div data-testid="home-sample-line"
              style={{fontSize:13.5,color:T.ink2,lineHeight:1.5,padding:"0 2px"}}>
              You're looking at sample data. Your own donors arrive when Jonathan loads your file.
            </div>
          )}
          {/* TRANS-1 Part 5 — ONE line, and only while the move is running.
              Never alongside the sample-data line: they answer the same
              question and two answers is worse than either. */}
          {surface==="home"&&!(sampleStatus?.hasSampleData&&!(sampleStatus.realDonorCount>0))&&moveLine&&(
            <div data-testid="home-move-line"
              style={{fontSize:13.5,color:T.ink2,lineHeight:1.5,padding:"0 2px"}}>
              {moveLine}
            </div>
          )}
          {/* HOME-4 — on Home, the Thread draws only when it has conversations
              to show; nothing logged (or nothing waiting) is no section at all. */}
          {/* FLOWS-5 (Area 1): with nothing on the Thread there is no next step, so
              Plan a follow-up stays: snoozing the last one no longer takes it away. */}
          {surface==="home"&&threadsData&&!threadsData.failed&&threadList.length===0&&!dhNotice&&(
            <div data-testid="home-thread-empty" style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,padding:"0 2px",fontSize:13.5,color:T.ink3}}>
              <span>Nothing is waiting on the Thread.</span>
              <button data-testid="home-plan-followup" onClick={()=>setPlanFor({donor:null})} disabled={isReadOnly}
                style={{background:"transparent",border:"1px solid "+T.ink,borderRadius:7,padding:"4px 10px",color:T.ink,fontSize:11,fontWeight:700,cursor:isReadOnly?"not-allowed":"pointer",opacity:isReadOnly?0.45:1}}>
                Plan a follow-up
              </button>
            </div>
          )}
          {!(surface==="home"&&threadsData&&!threadsData.failed&&threadList.length===0&&!dhNotice)&&(
          <div id="dash-thread" style={{...cardWrap,scrollMarginTop:64}}>
            <div className="dash-cpad" style={{...cPad,...sHdrPad,...sHdr}}>
              <span style={{display:"flex",flexDirection:"column",gap:6,minWidth:0}}>
                <span style={{display:"flex",alignItems:"center",gap:10,alignSelf:"flex-start"}}>
                  <span style={sSerif}>The Thread</span>
                  {surface==="home"&&foldBtn("thread","the Thread")}
                </span>
                {/* HOME-CALM — THE MORNING SENTENCE IS GONE FROM HOME, and it
                    is gone because First thing says the same thing better. It
                    read "Four people are waiting on you; Underhill has been
                    waiting a month" forty pixels above a row that said
                    Underhill had been waiting a month. Every fact it carried
                    still has a place: the people waiting ARE the rows, the
                    stopped card is now a row of its own, and the donors who
                    have gone quiet keep their own section further down.
                    homeNote() itself is untouched — the digest email and the
                    Dashboard still use it. */}
              </span>
              <span className="thread-hdr-tools" style={{display:"flex",alignItems:"center",gap:10,flexShrink:0}}>
                {/* BUILD-85 — the scope toggle appears ONLY for an admin at a
                    shop with more than one officer (the BUILD-32 standing rule:
                    hide a picker whose options all resolve to the same view). */}
                {threadsData?.canViewAll&&threadsData?.stat?.unowned!==undefined&&homeData?.multiOfficer&&(
                  <span style={{display:"inline-flex",border:"1px solid "+T.bg3,borderRadius:99,overflow:"hidden"}}>
                    {[["mine","Mine"],["all","Everyone"]].map(([k,lbl])=>(
                      <button key={k} aria-pressed={threadScope===k} onClick={()=>{setThreadScope(k);loadThreads(k);}}
                        style={{border:"none",padding:"3px 10px",fontSize:10.5,fontWeight:700,cursor:"pointer",
                                background:"transparent",color:T.ink3,...activeMark(threadScope===k,"bottom")}}>{lbl}</button>
                    ))}
                  </span>
                )}
                {/* HOME-CALM — "10 open · 4 overdue · oldest 82 days" is a
                    tally, not a decision: the machine showing its arithmetic
                    beside a list that already shows every one of those rows
                    with its own age on the right. It stays on the Dashboard,
                    where counting IS the job. */}
                {surface!=="home"&&threadStat&&threadStat.open>0&&(
                  <span style={{fontSize:11.5,color:T.ink3}}>
                    {/* "oldest 0 days" is the same non-phrase as "day 0": a
                        queue planned this morning has no age yet, and saying
                        so in numerals is a machine counting. */}
                    {threadStat.open} open · {threadStat.overdue} overdue
                    {threadStat.oldestDays>=1?` · oldest ${countLabel(threadStat.oldestDays, "day")}`:""}
                  </span>
                )}
                <button data-testid="home-plan-followup" onClick={()=>setPlanFor({donor:null})} disabled={isReadOnly}
                  style={{background:"transparent",border:"1px solid "+T.ink,borderRadius:7,padding:"4px 10px",
                          color:T.ink,fontSize:11,fontWeight:700,cursor:isReadOnly?"not-allowed":"pointer",opacity:isReadOnly?0.45:1}}>
                  Plan a follow-up
                </button>
              </span>
            </div>
            {/* ASK-3 — Why and What, at the top of the Thread: each opens a
                rail of questions the org's own records can answer. An
                answer's step lands on this Thread. */}
            {surface==="home"&&<div className="dash-cpad" style={{...cPad,paddingTop:0,paddingBottom:8}}>
              <PinsIfAny isReadOnly={isReadOnly}/>
            </div>}
            {threadsData&&threadsData.failed&&threadList.length===0&&<OneLineEmpty flush={onPanel} testId="thread-load-failed" line="The Thread could not be loaded just now." detail="Reload the page to try again."/>}
            {threadsData&&!threadsData.failed&&threadList.length===0&&(
              threadsData.hasAny
                ?<OneLineEmpty flush={onPanel} testId="thread-empty-state" line="Nothing waiting."
                    detail={`Every conversation has its next step scheduled${threadStat?.snoozed>0?`, and ${threadStat.snoozed} are set aside to revisit later`:""}.`}/>
                :<OneLineEmpty flush={onPanel} testId="thread-empty-state" line="No conversations logged yet."
                    detail="Log your first call from a donor's record, and its next step comes back to you here on the day it's due."/>
            )}
            {/* ── FIX-8 Part E · HOME SAYS ONE THING AT A TIME ──────────────
                From the approved mockup. Ten Thread rows, each three lines and
                four controls, put 5,940 characters on the screen somebody
                opens at 7:40, and nothing on it was first. So the top row gets
                said properly, in a sentence, with the three things you can do
                to it; the rest fold to one line each and open in place.
                NOTHING IS REMOVED, and nothing is recomputed: the first row is
                threadList[0], which is shared/threadRank.js's own answer to
                "why this one first", and the fold counts are the bands the
                server already returns. On the Dashboard surface (the board
                view) the list stays as it was: this is Home's problem. */}

            {/* HOME-CALM — AND THEN THE LIST, on the screen. Part E folded it
                behind two "Show them" links, which made the one thing she
                opened Home for the one thing not on it. */}
            {surface==="home"&&dhNotice&&(
              <div data-testid="home-data-health-notice" style={{...cPad,paddingTop:10,paddingBottom:10,borderTop:"1px solid "+T.bg2,display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
                <span style={{flex:"1 1 220px",fontSize:13,color:T.ink2}}>{dhNotice.sentence}</span>
                <button onClick={()=>onNavigate&&onNavigate("donors",{view:"health"})}
                  style={{background:"none",border:"none",padding:0,color:T.greenDk,fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"inherit",textDecoration:"underline"}}>{dhNotice.step}</button>
                <button aria-label="Hide this" disabled={isReadOnly}
                  onClick={()=>apiFetch(`/data-health/notice/${dhNotice.id}/dismiss`,{method:"POST",body:"{}"}).then(()=>setDhNotice(null)).catch(()=>{})}
                  style={{background:"none",border:"none",padding:"0 4px",color:T.ink3,fontSize:15,cursor:"pointer",fontFamily:"inherit"}}>×</button>
              </div>)}
            {/* PARITY-4 Part 2: one quiet line when gifts were started on the
                org's own forms and not finished, and nobody has looked yet. */}
            {surface==="home"&&gsNotice&&(
              <div data-testid="home-unfinished-notice" style={{...cPad,paddingTop:10,paddingBottom:10,borderTop:"1px solid "+T.bg2,display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
                <span style={{flex:"1 1 220px",fontSize:13,color:T.ink2}}>{gsNotice.sentence}</span>
                <button onClick={()=>onNavigate&&onNavigate("fundraising",{frSection:"unfinished"})}
                  style={{background:"none",border:"none",padding:0,color:T.greenDk,fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"inherit",textDecoration:"underline"}}>{gsNotice.step}</button>
                <button aria-label="Hide this" disabled={isReadOnly}
                  onClick={()=>apiFetch("/gift-starts/notice/seen",{method:"POST",body:"{}"}).then(()=>setGsNotice(null)).catch(()=>{})}
                  style={{background:"none",border:"none",padding:"0 4px",color:T.ink3,fontSize:15,cursor:"pointer",fontFamily:"inherit"}}>×</button>
              </div>)}
            {/* AUTO-1: the night before, the one line saying what goes out on its own. */}
            {surface==="home"&&jsNotice&&(
              <div data-testid="home-auto-send-notice" style={{...cPad,paddingTop:10,paddingBottom:10,borderTop:"1px solid "+T.bg2,display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
                <span style={{flex:"1 1 220px",fontSize:13,color:T.ink2}}>{jsNotice.sentence}</span>
                <button onClick={()=>onNavigate&&onNavigate("journeys",{})}
                  style={{background:"none",border:"none",padding:0,color:T.greenDk,fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"inherit",textDecoration:"underline"}}>{jsNotice.step}</button>
              </div>)}
            {homeCalm&&homeRows.length>0&&!homeFold.thread&&(<>
              <ul data-testid="home-thread-list" style={{listStyle:"none",margin:0,padding:0}}>
                {(threadExpanded?homeRows:homeRows.slice(0,5)).map(r=>r.el)}
              </ul>
              {homeRows.length>5&&(
                <div style={{...cPad,paddingTop:10,paddingBottom:4}}>
                  <button data-testid="thread-more" onClick={()=>setThreadExpanded(v=>!v)} style={{...sLink,padding:0}}>
                    {threadExpanded?"Show fewer":`Show ${homeRows.length-5} more`}
                  </button>
                </div>
              )}
            </>)}
            {/* Next week is still folded, because next week is not this
                morning's work. */}
            {homeCalm&&threadList.length>0&&(()=>{
              const bands=threadsData?.bands||[];
              const ahead=(bands.find(x=>x.key==="ahead")?.count||0)-threadList.filter(t=>t.band==="ahead"&&t.daysOpen===0).length;
              if(ahead<=0)return null;
              return (
                <div style={{...cPad,paddingTop:0,paddingBottom:12}}>
                  <button data-testid="home-fold" onClick={()=>setThreadAllOpen(true)}
                    style={{textAlign:"left",background:"none",border:"none",borderTop:"1px solid "+T.bg2,
                      width:"100%",padding:"11px 0 0",fontSize:12.5,color:T.ink2,cursor:"pointer",fontFamily:"inherit"}}>
                    {ahead} {ahead===1?"is":"are"} coming up · <span style={{color:T.greenDk,fontWeight:700,textDecoration:"underline"}}>Show them</span>
                  </button>
                </div>);
            })()}
            {threadList.length>0&&!homeCalm&&(
              <ul style={{listStyle:"none",margin:0,padding:0}}>{threadRows}</ul>
            )}
            {surface==="home"&&threadAllOpen&&threadList.length>0&&(
              <div style={{...cPad,paddingBottom:12}}>
                <button data-testid="home-fold-shut" onClick={()=>setThreadAllOpen(false)}
                  style={{background:"none",border:"none",padding:0,color:T.greenDk,fontSize:12.5,fontWeight:700,
                    cursor:"pointer",fontFamily:"inherit",textDecoration:"underline"}}>Show one at a time</button>
              </div>)}
            {/* THE CAP IS THE FEATURE, and the remainder is STATED. A list you
                cannot finish is a list you stop opening; a list that hides its
                own size is worse. */}
            {threadsData?.more>0&&(
              <div style={{...cPad,paddingTop:10,paddingBottom:10,fontSize:11.5,color:T.ink3,borderTop:"1px solid "+T.bg3}}>
                and {threadsData.more} more open. The {threadList.length} above are the ones that cost the most to leave.
              </div>
            )}
          {/* BUILD-86 C.2 — "NEEDS YOUR ATTENTION" IS GONE FROM HOME.
              Home is exactly the note, the Thread, Drift and the failing
              monthly gifts. That list duplicated the queue directly above it (a
              gift not yet thanked IS a thread whose next step is thank) and
              carried a "Mark done" button, which is the tasks vocabulary this
              product deliberately left behind. The two things it showed that
              the four sections do not both have homes already, and neither
              belongs on the screen she reads at 7:40 — milestone drafts sit in
              Communications with their own count, and the un-receipted-gift
              prompt in Settings → Tax Receipts. */}
          </div>
          )}

          {/* BUILD-83 Part 3.1 — "Today's Suggested Outreach" is GONE. The
              Thread and Drift are the outreach; a button that generates a third
              list of names is noise beside two lists the product already stands
              behind. */}
      </div>
  );
}

export function threadHealthLine({ cPad, cardWrap, sHdr, sHdrPad, sTitle, threadHealth }) {
  return (
  (threadHealth&&threadHealth.continuationRate!=null)?(
    <div style={{...cardWrap}}>
      <div className="dash-cpad" style={{...cPad,...sHdrPad,...sHdr}}>
        <span style={sTitle}>Follow-up, last 30 days</span>
      </div>
      <div style={{padding:"14px 20px",fontSize:13.5,color:T.ink,lineHeight:1.6}}>
        <strong style={{fontSize:22,fontFamily:"'DM Serif Display',serif"}}>{threadHealth.continuationRate}%</strong> of the
        conversations you closed led straight to the next step
        {" · "}{threadHealth.closed} closed
        {threadHealth.medianDaysToClose!=null?` · typically ${countLabel(threadHealth.medianDaysToClose, "day")} to close`:""}
      </div>
    </div>
  ):null
  );
}

export function homeCrossoverCard({ crossover, onNavigate, surface }) {
  return (
  surface==="home"&&crossover&&crossover.nextStep ? (
    <button data-testid="home-volunteer-crossover"
      onClick={()=>onNavigate&&onNavigate("volunteers")}
      style={{textAlign:"left",width:"100%",background:T.white,border:"1px solid "+T.bg3,borderRadius:12,
              padding:"13px 16px",cursor:"pointer",fontFamily:"inherit",display:"flex",gap:12,
              alignItems:"center",flexWrap:"wrap",marginTop:8}}>
      <span style={{flex:1,minWidth:0}}>
        <span style={{display:"block",fontSize:13.5,fontWeight:700,color:T.ink}}>{crossover.nextStep.label}</span>
        <span style={{display:"block",fontSize:12.5,color:T.ink3,marginTop:2,lineHeight:1.5}}>{crossover.nextStep.why}</span>
      </span>
      <span style={{fontSize:12.5,fontWeight:700,color:T.greenDk,whiteSpace:"nowrap"}}>Open Volunteers →</span>
    </button>
  ) : null
  );
}
