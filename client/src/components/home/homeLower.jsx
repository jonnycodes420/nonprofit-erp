import { Breakdown, PORTFOLIO_BREAKDOWNS, LogConversationModal, YourWords, PlanFollowUpModal } from "./homeParts";
import { fmtFull, quietPhrase, T, GoldMoment, Modal, activeMark, interactive } from "../shared";
import { fmtDayLong } from "../../lib/taskDue";
import { Suspense } from "react";
import { apiFetch } from "../../api";
import { plural } from "../../../../shared/countWords";

export function homeOverlays({ closePortfolioBreakdown, convoFor, data, debtBreakdown, debtBreakdownLoading, debtBreakdownOpen, goToDonorFromBreakdown, goToDonorFromPortfolio, impact, loadDrift, loadThreads, onNavigate, planFor, portfolioBreakdown, reengBreakdownOpen, retentionBreakdown, retentionBreakdownLoading, retentionBreakdownOpen, setConvoFor, setData, setDebtBreakdownOpen, setPlanFor, setReengBreakdownOpen, setRetentionBreakdownOpen, setWordsDone, setWordsOpen, wordsOpen }) {
  return (
    <>
        <Breakdown
        open={debtBreakdownOpen}
        onClose={()=>setDebtBreakdownOpen(false)}
        title="Stewardship Debt"
        explanation="Donors weighted by how long it's been since a real conversation, multiplied by how much they've given. The list below is ranked by who's contributing most to that number right now."
        loading={debtBreakdownLoading}
        total={debtBreakdown?.total?.toLocaleString()}
        totalLabel="Debt score"
        totalCount={debtBreakdown?.count}
        rows={(debtBreakdown?.rows||[]).map(r=>({
          donorId:r.donorId,
          donorName:r.donorName,
          detail:`${fmtFull(r.totalGiving)} total · ${r.daysSinceContact}d since contact`,
          value:r.contribution.toLocaleString(),
          percentOfTotal:r.percentOfTotal,
        }))}
        onSelectDonor={goToDonorFromBreakdown}
      />

      <Breakdown
        open={retentionBreakdownOpen}
        onClose={()=>setRetentionBreakdownOpen(false)}
        title="Donor Retention Rate"
        explanation={`Donors who gave in ${retentionBreakdown?.prevYear??"the prior year"} but haven't given again in ${retentionBreakdown?.year??"the current year"} the specific list dragging the rate down, not just the percentage.`}
        loading={retentionBreakdownLoading}
        total={retentionBreakdown?.thinData?"Not enough history yet":retentionBreakdown?.retentionRate!=null?`${retentionBreakdown.retentionRate}%`:"Not set"}
        totalLabel="Retention rate"
        totalCount={retentionBreakdown?.nonRetainedCount}
        rows={(retentionBreakdown?.rows||[]).map(r=>({
          donorId:r.donorId,
          donorName:r.donorName,
          detail:r.lastGiftDate?`Last gave ${fmtDayLong(r.lastGiftDate)}`:"No gift date on file",
          value:fmtFull(r.lastGiftAmount),
        }))}
        onSelectDonor={goToDonorFromBreakdown}
      />

      <Breakdown
        open={reengBreakdownOpen}
        onClose={()=>setReengBreakdownOpen(false)}
        title="Money at risk"
        explanation={`The lifetime giving of donors with no gift in over ${quietPhrase(impact?.quietSinceDays)}: lapsing or lapsed, the one lapse rule the pipeline's move suggestions and Communications use. Lapsing is the moment there is still the most to do about it. This is your file's own history, not anything Steward did: it is the size of the problem, measured.`}
        loading={false}
        total={impact?.atRiskAmount!=null?fmtFull(impact.atRiskAmount):"Not set"}
        totalLabel="At risk"
        totalCount={impact?.quietDonorCount}
        rows={(impact?.atRiskDonors||[]).map(r=>({
          donorId:r.id,
          donorName:r.name,
          detail:r.lastGiftDate?`Last gave ${fmtDayLong(r.lastGiftDate)}`:"No gift date on file",
          value:fmtFull(r.amount),
        }))}
        onSelectDonor={goToDonorFromBreakdown}
      />

      <Breakdown
        open={portfolioBreakdown.open}
        onClose={closePortfolioBreakdown}
        title={PORTFOLIO_BREAKDOWNS[portfolioBreakdown.key]?.title||""}
        explanation={PORTFOLIO_BREAKDOWNS[portfolioBreakdown.key]?.explanation}
        loading={portfolioBreakdown.loading}
        total={portfolioBreakdown.data?.total!=null?"$"+portfolioBreakdown.data.total.toLocaleString():undefined}
        totalLabel="Total"
        totalCount={portfolioBreakdown.data?.count}
        rows={portfolioBreakdown.data?.rows||[]}
        onSelectDonor={goToDonorFromPortfolio}
      />

      {convoFor&&<Suspense fallback={null}><LogConversationModal donor={convoFor.donor} thread={convoFor.thread} org={data.org} onNavigate={onNavigate}
        onSaved={()=>{loadThreads();loadDrift();}} onClose={()=>setConvoFor(null)}/></Suspense>}
      {wordsOpen&&<Suspense fallback={null}><YourWords mode="first-run" onClose={()=>setWordsOpen(false)}
        onDone={()=>{setWordsOpen(false);setWordsDone(true);if(setData)setData(d=>({...d,org:{...d.org,vocabularySetAt:new Date().toISOString()}}));}}/></Suspense>}
      {planFor&&<Suspense fallback={null}><PlanFollowUpModal donor={planFor.donor}
        onSaved={()=>{loadThreads();}} onClose={()=>setPlanFor(null)}/></Suspense>}
    </>
  );
}

export function homeLower({ editMode, homeCrossoverCard, sectionStack, setWordsDone, setWordsOpen, surface, wordsOffer }) {
  return (
    <>
      {surface==="home"&&(sectionStack?.lower||homeCrossoverCard||(wordsOffer&&!editMode))&&(
      <div className="home-shell-lower">
      {sectionStack?.lower}
      {/* HOME-CALM — THE VOLUNTEER IDEA, LAST AND PLAIN. Same words, same
          number, same route; no green bar, and below the work rather than
          in front of it. It is the last thing she reads, which is where an
          idea belongs on a morning screen. */}
      {homeCrossoverCard}
      {/* BUILD-89 — BUILD-86 Part B's one line, once, at the FOOT of the
          panel. It used to sit between the day and the first card, so the
          second thing anybody read on their own Home was Steward asking a
          question about itself. */}
          {wordsOffer&&!editMode&&(
            <div style={{marginTop:8,fontSize:12.5,color:T.ink3,display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
              <span>Steward calls them donors. What do you call them?</span>
              <button onClick={()=>setWordsOpen(true)}
                style={{background:"transparent",border:"1px solid "+T.ink,borderRadius:7,padding:"3px 10px",color:T.ink,fontSize:11.5,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
                Set your words
              </button>
              <button onClick={()=>{setWordsDone(true);apiFetch("/org/vocabulary",{method:"PUT",body:JSON.stringify({skip:true})}).catch(()=>{});}}
                style={{background:"transparent",border:"1px solid "+T.bg3,borderRadius:7,padding:"3px 10px",color:T.ink3,fontSize:11.5,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
                Keep Steward's words
              </button>
            </div>
          )}
      </div>
      )}
    </>
  );
}

export function cardsBlock({ goal, goalForm, goalModalMode, inp, layoutError, recurringHealth, saveGoal, savingGoal, sectionStack, setGoalForm, setShowSetGoal, showSetGoal }) {
  return (
      <>
      {/* One-time gold moments (BUILD-08 Phase D) — the product's only
          celebration pattern, each fires once per org (localStorage-keyed
          inside GoldMoment). Goal completion keys on the goal id, so a NEW
          goal reaching 100% next quarter gets its own single moment. */}
      {goal&&goal.percent>=100&&(
        <GoldMoment moment={`goal100_${goal.id||goal.periodEnd||"current"}`}
          title={`You did it, ${goal.label}.`}
          line={`${fmtFull(goal.currentAmount)} raised against ${fmtFull(goal.goalAmount)}. Worth a minute of feeling good before the next one.`}/>
      )}
      {recurringHealth&&recurringHealth.recoveredThisMonth>0&&(
        <GoldMoment moment="first_recovery"
          title="A failed card was fixed."
          line="The gift resumed, money that, at most organizations, would have quietly disappeared. Steward will keep watching."/>
      )}

      {/* ── The section stack (BUILD-34) ─────────────────────────────────
          Renders from the per-user ordered [{id,visible}] config (see
          ../lib/homeLayout.js for the canonical list + stale-config merge).
          Sections with no data render nothing and aren't offered in edit
          mode; explicitly hidden ones collect in the tray below. Edit-mode
          chrome is absolutely positioned (outline + floating pill) so
          entering/leaving edit mode causes zero layout shift. */}
      {sectionStack&&sectionStack.top}
      {layoutError&&<div role="alert" style={{position:"fixed",bottom:20,left:"50%",transform:"translateX(-50%)",background:T.terracotta,color:T.white,padding:"10px 16px",borderRadius:8,fontSize:13,fontWeight:600,zIndex:500,boxShadow:T.shadowLg,maxWidth:"90vw"}}>{layoutError}</div>}

      {/* Set-goal modal */}
      {showSetGoal&&(
        <Modal onClose={()=>setShowSetGoal(false)} width={420} zIndex={300} padding={24}
          ariaLabel={goalModalMode==="edit"?"Edit fundraising goal":"Set a fundraising goal"}
          dialogStyle={{border:"1px solid "+T.bg3}}>
          <div>
            <div style={{fontSize:16,fontWeight:800,color:T.ink,marginBottom:16}}>{goalModalMode==="edit"?"Edit fundraising goal":"Set a fundraising goal"}</div>
            <div style={{fontSize:11,fontWeight:700,color:T.ink3,marginBottom:4}}>Label</div>
            <input value={goalForm.label} onChange={e=>setGoalForm(f=>({...f,label:e.target.value}))} placeholder="e.g. Win back $50,000 in lapsed giving" style={inp}/>
            <div style={{fontSize:11,fontWeight:700,color:T.ink3,marginBottom:4}}>Target amount ($)</div>
            <input type="number" value={goalForm.goalAmount} onChange={e=>setGoalForm(f=>({...f,goalAmount:e.target.value}))} placeholder="25000" style={inp}/>
            <div style={{fontSize:11,fontWeight:700,color:T.ink3,marginBottom:4}}>Goal type</div>
            <div style={{display:"flex",gap:6,marginBottom:10}}>
              {[["total_raised","Total raised"],["lapsed_recovery","Lapsed recovery"]].map(([v,l])=>(
                <button key={v} aria-pressed={goalForm.goalType===v} onClick={()=>setGoalForm(f=>({...f,goalType:v}))} style={{flex:1,background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"8px",color:T.ink3,fontSize:12,fontWeight:600,cursor:"pointer",...activeMark(goalForm.goalType===v,"bottom")}}>{l}</button>
              ))}
            </div>
            <div style={{display:"flex",gap:8,marginBottom:10}}>
              <div style={{flex:1}}>
                <div style={{fontSize:11,fontWeight:700,color:T.ink3,marginBottom:4}}>Period start</div>
                <input type="date" value={goalForm.periodStart} onChange={e=>setGoalForm(f=>({...f,periodStart:e.target.value}))} style={{...inp,marginBottom:0}}/>
              </div>
              <div style={{flex:1}}>
                <div style={{fontSize:11,fontWeight:700,color:T.ink3,marginBottom:4}}>Period end</div>
                <input type="date" value={goalForm.periodEnd} onChange={e=>setGoalForm(f=>({...f,periodEnd:e.target.value}))} style={{...inp,marginBottom:0}}/>
              </div>
            </div>
            <div style={{display:"flex",gap:8,marginTop:6}}>
              <button onClick={saveGoal} disabled={savingGoal||!goalForm.label.trim()||!goalForm.goalAmount} style={{flex:1,background:(savingGoal||!goalForm.label.trim()||!goalForm.goalAmount)?T.bg2:T.gold,border:"none",borderRadius:10,padding:"11px",color:T.ink,fontSize:14,fontWeight:700,cursor:(savingGoal||!goalForm.label.trim()||!goalForm.goalAmount)?"not-allowed":"pointer"}}>
                {savingGoal?"Saving…":goalModalMode==="edit"?"Save changes":"Set goal"}
              </button>
              <button onClick={()=>setShowSetGoal(false)} style={{background:T.bg,border:"none",borderRadius:10,padding:"11px 14px",color:T.ink3,fontSize:13,cursor:"pointer"}}>Cancel</button>
            </div>
          </div>
        </Modal>
      )}
      </>
  );
}

export function boardRecurringLine({ onNavigate, recurringAttention, recurringFailed, surface }) {
  return (
    <>
      {surface!=="home"&&recurringAttention>0&&(
        <div {...interactive(()=>onNavigate("fundraising",{frSection:"recurring"}),{label:"Open recurring giving"})}
          style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:12,padding:"10px 16px",display:"flex",alignItems:"center",gap:10}}>
          <span aria-hidden style={{color:T.terracotta,fontSize:13,lineHeight:1}}>◑</span>
          <span style={{flex:1,fontSize:13,color:T.ink2}}>
            {recurringFailed>0
              ?<><strong style={{color:T.ink}}>{recurringFailed}</strong> {plural(recurringFailed, "card")} stopped this month.{recurringAttention>recurringFailed?<> {recurringAttention-recurringFailed} more recurring {plural(recurringAttention-recurringFailed, "item")} need{recurringAttention-recurringFailed===1?"s":""} a person.</>:null}</>
              :<><strong style={{color:T.ink}}>{recurringAttention}</strong> recurring {plural(recurringAttention, "item")} need{recurringAttention===1?"s":""} a person: expiring cards or waiting proposals.</>}
          </span>
          <span style={{fontSize:12,fontWeight:700,color:T.greenDk,whiteSpace:"nowrap"}}>Open Recurring →</span>
        </div>
      )}
    </>
  );
}
