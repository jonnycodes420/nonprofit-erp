import { T, fmtFull, daysDiff, daysUntil, fmt } from "../shared";
import { countLabel, plural } from "../../../../shared/countWords";
import { Figure } from "../Figure";
import FunnelChart from "../FunnelChart";

export function retentionSection({ DonorChip, MoreChip, Sparkline, driftData, firstTouchOpen, heroIsDrift, myStats, onNavigate, openDebtBreakdown, openRetentionBreakdown, retentionBreakdown, retentionBreakdownLoading, retentionColor, retentionCurrent, retentionThin, retentionTooEarly, setFirstTouchOpen, stewardMetrics }) {
  return (
      stewardMetrics?(
        <div style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:16,padding:"20px 24px",display:"flex",flexDirection:"column",gap:16}}>
          {heroIsDrift&&(
            <div onClick={()=>document.getElementById("dash-drifting")?.scrollIntoView({behavior:"smooth",block:"start"})}
              className="card-click" style={{cursor:"pointer",borderRadius:12,margin:-4,padding:4}}>
              <div style={{fontSize:10,fontWeight:800,color:T.ink3,marginBottom:6}}>At Risk From Drift</div>
              <div style={{display:"flex",alignItems:"baseline",gap:10,flexWrap:"wrap"}}>
                <div style={{fontSize:32,fontWeight:800,fontFamily:"'DM Serif Display',serif",color:T.ink,lineHeight:1}}>{fmtFull(driftData.atRiskAmount)}</div>
                <span style={{fontSize:13,fontWeight:700,color:T.gold600}}>{countLabel(driftData.counts.driftingHigh,"donor")} drifting</span>
              </div>
              <div style={{fontSize:13,fontWeight:600,color:T.ink2,marginTop:6,lineHeight:1.4,maxWidth:430}}>
                {/* BUILD-77 Part 4 — ONE headline, the other two figures
                    reconciled into it as subsets, in plain language. The
                    widest "at risk" pool (lifetime giving of everyone quiet
                    past {quietPhrase}) is the outer number; drifting is the
                    high-confidence, still-reachable subset; lapsed is the
                    window-closed subset — never three competing figures. */}
                {false
                  ?null
                  :<>Giving from donors quietly past their own pattern. Each is on the Drifting list below, with the reason, while a call still works.</>}
              </div>
            </div>
          )}
          {/* Donor Retention Rate — the pre-BUILD-76 hero metric, kept and
              demoted below the drift headline (it remains the number
              fundraisers benchmark against; the sector-average line already
              lived in the onboarding drip email). */}
          <div style={heroIsDrift?{borderTop:"1px solid "+T.bg3,paddingTop:14}:undefined}>
            <div onClick={openRetentionBreakdown} className="card-click" style={{display:"flex",flexWrap:"wrap",gap:20,alignItems:"center",cursor:"pointer",borderRadius:12,margin:-4,padding:4}}>
              <div style={{flex:"1 1 220px",minWidth:0}}>
                <div style={{fontSize:10,fontWeight:800,color:T.ink3,marginBottom:6}}>Donor Retention Rate</div>
                <div style={{display:"flex",alignItems:"baseline",gap:10,flexWrap:"wrap"}}>
                  <div style={{fontSize:retentionThin?17:heroIsDrift?22:32,fontWeight:800,fontFamily:"'DM Serif Display',serif",color:retentionColor,lineHeight:1.2}}>
                    {retentionTooEarly?"Not set":retentionThin?"Not enough history yet":`${retentionCurrent}%`}
                  </div>
                  {!retentionTooEarly&&!retentionThin&&stewardMetrics.retentionRate.deltaVsTrendStart!=null&&(
                    <span style={{fontSize:13,fontWeight:700,color:stewardMetrics.retentionRate.deltaVsTrendStart===0?T.ink3:stewardMetrics.retentionRate.deltaVsTrendStart>0?T.greenDk:T.terracotta}}>
                      {stewardMetrics.retentionRate.deltaVsTrendStart===0
                        ?"No change vs 3 weeks ago"
                        :`${stewardMetrics.retentionRate.deltaVsTrendStart>0?"↑":"↓"} ${Math.abs(stewardMetrics.retentionRate.deltaVsTrendStart)}pt vs 3 weeks ago`}
                    </span>
                  )}
                </div>
                {/* Context line carries more of the weight here than the
                    numeral above it — a sentence about what the number means
                    for donor relationships, not a bare "vs. X%" field label. */}
                {/* IMPORT-4: retention leaves out gifts with no date, and says so; the count opens them. */}
                {stewardMetrics.undated&&stewardMetrics.undated.count>0&&(
                  <div data-testid="home-retention-undated" onClick={e=>e.stopPropagation()} style={{fontSize:12,color:T.ink3,marginTop:4}}>
                    <Figure variant="inline" kind="count" value={stewardMetrics.undated.count} suffix={stewardMetrics.undated.count===1?" gift":" gifts"} label="Gifts with no date"
                      definition="Gifts that came in with no date. They count in Lifetime and their event or campaign, and in no figure for a span of time, retention included, because their year is not known."
                      source={stewardMetrics.undated.source} figureKey="home.undated"/> with no date not counted
                  </div>
                )}
                <div style={{fontSize:13,fontWeight:600,color:T.ink2,marginTop:6,lineHeight:1.4,maxWidth:360}}>
                  {/* A brand-new org gets an expectant "too early" line, never
                      the below-sector-average verdict (QA_FRESH_ORG R2) —
                      mirrors First-Touch Delay's day-one handling below. */}
                  {retentionThin
                    ?`A real rate needs about ${stewardMetrics.retentionRate.floor?.minPriorYearDonors??20} donors from last year and ${Math.round((stewardMetrics.retentionRate.floor?.minHistoryDays??548)/30.44)} months of history, this file has ${countLabel(stewardMetrics.retentionRate.prevYearCount, "prior-year donor")} and ${Math.max(1,Math.round((stewardMetrics.retentionRate.historyDays||0)/30.44))} ${plural(Math.round((stewardMetrics.retentionRate.historyDays||0)/30.44), "month")} so far. The number will appear when it can mean something.`
                    :retentionTooEarly
                    ?!myStats?.orgHasGiftHistory
                      ?`Too early to measure, import your donors to start tracking.`
                      :stewardMetrics.retentionRate.prevYearCount>0
                        ?`Too early to measure, as this year's gifts land, you'll see how many of last year's ${countLabel(stewardMetrics.retentionRate.prevYearCount, "donor")} stick with you.`
                        :`Too early to measure, you'll see this once there's a prior year of giving to compare against.`
                    :(()=>{
                      // BUILD-77 Part 4 — STATE THE WINDOW AND DENOMINATOR, and
                      // remove the congratulation. Steward reports numbers; it
                      // does not tell an organisation it is doing well four
                      // minutes after meeting them. What the rate means is a
                      // fact ("N of M last-year donors gave again"), not a verdict.
                      const rr=stewardMetrics.retentionRate;
                      // NUMBERS-2: the org's own fiscal years, by the names the server gives them.
                      const py=rr.prevYearLabel||null, cy=rr.yearLabel||null;   // POLISH-7: the server's labels (fiscalPeriod.js), never one built here
                      const denom=rr.prevYearCount||0, kept=rr.retained||0;
                      const window=py&&cy?`${py} → ${cy}`:"year over year";
                      const same=rr.sameDatesLastYear&&rr.sameDatesLastYear.current!=null?` At this point last year it was ${rr.sameDatesLastYear.current}%.`:"";
                      return `${kept.toLocaleString()} of ${countLabel(denom, "donor")} who gave in ${py||"the prior year"} gave again (${window}).${same}${stewardMetrics?.importCaveat?` (${stewardMetrics.importCaveat})`:""}`;
                    })()}
                </div>
              </div>
              {!retentionThin&&stewardMetrics.retentionRate.trend.length>=2&&(
                <Sparkline trend={stewardMetrics.retentionRate.trend} color={retentionColor} width={120} height={36}/>
              )}
            </div>
            {/* Who this number is actually about — top donors who gave last
                year but haven't renewed, right where the rate is, not one
                click away behind a generic link. */}
            {(retentionBreakdownLoading&&!retentionBreakdown)?(
              <div style={{fontSize:11,color:T.ink3,marginTop:10}}>Loading who's not renewing…</div>
            ):retentionBreakdown?.rows?.length>0&&(
              <div style={{display:"flex",flexWrap:"wrap",gap:6,marginTop:10}}>
                {retentionBreakdown.rows.slice(0,3).map(r=>(
                  <DonorChip key={r.donorId} id={r.donorId} name={r.donorName} detail={fmtFull(r.lastGiftAmount)} onClick={()=>onNavigate("donors",{selectDonorId:r.donorId})}/>
                ))}
                {retentionBreakdown.nonRetainedCount>3&&(
                  <MoreChip count={retentionBreakdown.nonRetainedCount-3} onClick={openRetentionBreakdown}/>
                )}
              </div>
            )}
          </div>

          {/* Signals (BUILD-16 Part 1) — First-Touch Delay and Stewardship
              Debt are demoted from headline sections to small clickable chips.
              They're clever composite metrics, not what a fundraiser opens the
              app to see (that's the command center above) — so they sit here as
              secondary signals that expand into their detail on click. */}
          <div style={{borderTop:"1px solid "+T.bg3,paddingTop:14,display:"flex",gap:8,flexWrap:"wrap"}}>
            <button onClick={()=>setFirstTouchOpen(v=>!v)}
              aria-expanded={firstTouchOpen} aria-label="First-touch delay detail"
              style={{display:"flex",alignItems:"baseline",gap:7,background:firstTouchOpen?T.bg2:T.bg,border:"1px solid "+T.bg3,borderRadius:99,padding:"7px 14px",cursor:"pointer"}}>
              <span style={{fontSize:11,fontWeight:700,color:T.ink3}}>First-touch delay</span>
              <span style={{fontSize:15,fontWeight:800,fontFamily:"'DM Serif Display',serif",color:T.ink}}>{stewardMetrics.firstTouchDelay.current!=null?`${stewardMetrics.firstTouchDelay.current}d`:"Not set"}</span>
              <span style={{fontSize:11,color:T.ink3}}>{firstTouchOpen?"▲":"▼"}</span>
            </button>
            <button onClick={openDebtBreakdown}
              aria-label="Stewardship debt detail"
              style={{display:"flex",alignItems:"baseline",gap:7,background:T.bg,border:"1px solid "+T.bg3,borderRadius:99,padding:"7px 14px",cursor:"pointer"}}>
              <span style={{fontSize:11,fontWeight:700,color:T.ink3}}>Stewardship debt</span>
              <span style={{fontSize:15,fontWeight:800,fontFamily:"'DM Serif Display',serif",color:T.ink}}>{stewardMetrics.stewardshipDebt.current.toLocaleString()}</span>
              {stewardMetrics.stewardshipDebt.deltaVsTrendStart!=null&&stewardMetrics.stewardshipDebt.deltaVsTrendStart!==0&&(
                <span style={{fontSize:11,fontWeight:700,color:stewardMetrics.stewardshipDebt.deltaVsTrendStart>0?T.terracotta:T.greenDk}}>
                  {stewardMetrics.stewardshipDebt.deltaVsTrendStart>0?"↑":"↓"}{Math.abs(stewardMetrics.stewardshipDebt.deltaVsTrendStart).toLocaleString()}
                </span>
              )}
              <span style={{fontSize:11,color:T.greenDk,fontWeight:700}}>→</span>
            </button>
          </div>

          {/* First-touch delay — expands inline to its real detail: the average
              plus the newest donor(s) still waiting on a first personal touch. */}
          {firstTouchOpen&&(
            <div style={{borderTop:"1px dashed "+T.bg3,paddingTop:14}}>
              <div style={{fontSize:13,fontWeight:600,color:T.ink2,lineHeight:1.4,maxWidth:420}}>
                {stewardMetrics.firstTouchDelay.current==null && myStats?.orgHasGiftHistory && !myStats?.orgHasInteractions
                  ? "No outreach logged yet, that's normal right after import. Log your first call from a donor's profile to start tracking this."
                  : <>New donors wait <b>{stewardMetrics.firstTouchDelay.current!=null?`${stewardMetrics.firstTouchDelay.current} days`:"Not set"}</b> on average before hearing from you personally{stewardMetrics.firstTouchDelay.sampleSize?` based on ${stewardMetrics.firstTouchDelay.sampleSize} donors`:""}.</>}
              </div>
              {stewardMetrics.firstTouchDelay.newestUntouched?.length>0&&(
                <div style={{display:"flex",flexWrap:"wrap",alignItems:"center",gap:6,marginTop:10}}>
                  {stewardMetrics.firstTouchDelay.newestUntouched.map(d=>(
                    <DonorChip key={d.donorId} id={d.donorId} name={d.donorName} detail={`waiting ${daysDiff(d.firstGiftDate)}d`} onClick={()=>onNavigate("donors",{selectDonorId:d.donorId})}/>
                  ))}
                  {stewardMetrics.firstTouchDelay.untouchedCount>stewardMetrics.firstTouchDelay.newestUntouched.length&&(
                    <span style={{fontSize:11,color:T.ink3}}>+{stewardMetrics.firstTouchDelay.untouchedCount-stewardMetrics.firstTouchDelay.newestUntouched.length} more waiting</span>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      ):null
  );
}

export function retentionPipelineSection({ cPad, cardWrap, countsByStage, driftData, nextGrant, onNavigate, recurringHealth, retentionSection, sHdr, sHdrPad, sLink, sTitle }) {
  return (
      <div className="dash-main-grid" style={{display:"grid",gridTemplateColumns:"minmax(0,1fr) 320px",gap:16,alignItems:"start"}}>
        <div style={{display:"flex",flexDirection:"column",gap:14}}>
          {retentionSection}
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:14}}>
          <div style={{...cardWrap}}>
            <div className="dash-cpad" style={{...cPad,...sHdrPad,...sHdr}}>
              <span style={sTitle}>Pipeline Funnel</span>
              <button onClick={()=>onNavigate("donors")} style={sLink}>View all →</button>
            </div>
            <div style={{padding:"16px 20px"}}>
              <FunnelChart counts={countsByStage} onStageClick={s=>onNavigate("donors",{stageFilter:s})}
                drift={driftData&&driftData.counts.driftingHigh>0?{
                  count:driftData.counts.driftingHigh,
                  amount:driftData.atRiskAmount,
                  onClick:()=>document.getElementById("dash-drifting")?.scrollIntoView({behavior:"smooth",block:"start"}),
                }:null}/>
            </div>
          </div>

          <div onClick={nextGrant?()=>onNavigate("grants",{grantId:nextGrant.id}):undefined} className={nextGrant?"card-click":""} style={{...cardWrap,cursor:nextGrant?"pointer":"default"}}>
            <div className="dash-cpad" style={{...cPad,borderBottom:"1px solid "+T.bg3}}>
              <span style={sTitle}>Next Grant Deadline</span>
            </div>
            {!nextGrant&&<div style={{...cPad,fontSize:13,color:T.ink3,fontStyle:"italic"}}>No upcoming deadlines.</div>}
            {nextGrant&&(()=>{
              const d=daysUntil(nextGrant.deadline);
              const urgColor=d<14?T.terracotta:T.greenMid;
              return(
                <div style={{padding:"14px 20px"}}>
                  <div style={{fontSize:13,fontWeight:700,color:T.ink,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{nextGrant.funder}</div>
                  <div style={{fontSize:11,color:T.ink3,marginTop:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{nextGrant.program}</div>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:10}}>
                    <span style={{background:urgColor+"15",border:"1px solid "+urgColor+"30",borderRadius:8,padding:"4px 10px",fontSize:12,fontWeight:800,color:urgColor}}>{d<0?"past due":d+"d"}</span>
                    <span style={{fontSize:14,fontWeight:800,color:T.ink}}>{fmt(nextGrant.amount)}</span>
                  </div>
                </div>
              );
            })()}
          </div>

          {/* Recurring gift recovery — revenue-at-risk, not buried in a report */}
          {recurringHealth&&recurringHealth.activeCount>0&&(
            <div style={{...cardWrap,borderColor:recurringHealth.atRiskCount>0?T.terracotta+"30":T.bg3}}>
              <div className="dash-cpad" style={{...cPad,borderBottom:"1px solid "+T.bg3}}>
                <span style={sTitle}>Recurring Gifts</span>
              </div>
              <div style={{padding:"14px 20px"}}>
                {recurringHealth.atRiskCount>0?(
                  <>
                    <div style={{fontSize:20,fontWeight:800,fontFamily:"'DM Serif Display',serif",color:T.terracotta,lineHeight:1}}>
                      {fmt(recurringHealth.mrrAtRisk)}<span style={{fontSize:12,fontWeight:600,color:T.ink3}}>/mo at risk</span>
                    </div>
                    <div style={{fontSize:12,color:T.ink3,marginTop:4}}>
                      {countLabel(recurringHealth.atRiskCount, "donor")} with a failed card
                      {recurringHealth.recoveryRate!=null&&` · ${recurringHealth.recoveryRate}% recovery rate`}
                    </div>
                  </>
                ):(
                  <div style={{fontSize:13,color:T.ink3}}>
                    All {countLabel(recurringHealth.activeCount, "recurring gift")} are current
                    {recurringHealth.recoveryRate!=null&&` · ${recurringHealth.recoveryRate}% recovery rate`}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
  );
}
