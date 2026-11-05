// components/profile/GivingTab.jsx (PROFILE-3): part of the donor profile, cut from DonorProfile.jsx.
import { GivingByYearChart, STAGES, STAGE_ACTION, Spin, T, activeMark, daysDiff, firstNameOf, fmtFull } from "../shared";
import { Figure } from "../Figure";
import { PROPOSAL_STAGE_LABEL, UndatedGiftDate, cap } from "./profileShared";
import { displayDate, displayDateShort } from "../../../../shared/displayDate";
import { Highlights, NextLine } from "../ProfileStatus";
import { SuggestedAskLine } from "../ScoreWhy";
import { ProposalQuickActions, ProposalsPanel } from "../MajorGifts";
import { AskButtons } from "../AskRail";
import { DESIGNATION_OPTS } from "../donorShared";
import { RecordLink } from "../RecordLink";
import { householdHref } from "../../lib/appUrls";
import { MembershipPanel } from "../Memberships";
import { apiFetch } from "../../api";
import { errorMessage } from "../../lib/domainError";
import { VolunteerPanel } from "../VolunteerPanel";
import { FunderPanel } from "../FunderPanel";
import { ReceiptCell, YearEndPanel } from "./ReceiptsAndStatements";
import { ProfileMoreNumbers } from "../ProfileHeaderFigures";
import MetricBreakdownPanel from "../MetricBreakdownPanel";
import { censusById } from "../../../../shared/numberCensus.js";
import { openCheckSnap } from "../CheckSnap";
import { countLabel } from "../../../../shared/countWords.js";
import { PeopleDatalist } from "../PeopleDatalist";
import { renderCustomValue } from "../../../../shared/customFieldShape";
import { MailTypeSwitches } from "../MailTypes";
import { pledgeMoneyWords } from "../../../../shared/pledgeWords.js";
import { EditedMarker } from "../EditHistory";
import { stepAgainstProposals } from "../../../../shared/nextStepAgree.js";

function GivingTab({rc,acceptSuggestion,addAsk,addGift,addGiftForm,addGiftOpen,addPgOpen,addPlannedGift,addPledge,addPledgeOpen,addToPipeline,askAmt,askName,askOpen,campaigns,closeAsk,deleteGift,deletePlannedGift,deletePledge,dismissSuggestion,dismissedSug,donor,downloadReceiptPdf,dpItems,dpTab,exportGiftsCSV,figs,fundAffinity,fundLoading,giftCfDefs,giftCfEditStr,giftCountReal,giftEditForm,giftEditId,giftErr,giftLoading,giftMoreOpen,giftPeopleQ,giftReadErr,giftSaving,gifts,giftsFull,hasDesignation,household,isAdmin,isReadOnly,isTeam,loadGiftsFull,lockMajor,moveSuggestions,moves,onNavigate,onStageChange,openProposals,opps,pgForm,pgOpen,pgSaving,pipelineAdded,plannedGifts,pledgeEdit,pledgeForm,pledgeResendBusyId,pledgeResentIds,pledgeSaving,pledges,propData,proposalsKnown,receiptBusyId,receiptForGift,receiptsEnabled,recurResendBusy,recurResendSent,recurringSub,refundRows,reloadProps,resendPledgeReminder,resendRecurringLink,saveGiftEdit,savePledgeEdit,sc,scores,sendReceipt,sendYearEndStatement,seqId,seqLoading,seqOpen,seqToast,sequences,setAddGiftForm,setAddGiftOpen,setAddPgOpen,setAddPledgeOpen,setAskAmt,setAskName,setAskOpen,setDpTab,setGiftEditForm,setGiftEditId,setGiftLoading,setGiftMoreOpen,setHhModalOpen,setPgForm,setPgOpen,setPledgeEdit,setPledgeForm,setPledgeStatus,setRelatedOpen,setSeqId,setSeqLoading,setSeqOpen,setSeqToast,setShowYearEnd,setYearDrill,setYearEndYear,showYearEnd,softCredit,status,toggleDesignation,yearDrill,yearEndBusy,yearEndErr,yearEndYear}){
  return <>
          {/* ── PROFILE-2 · GIVING: the ask, then gifts and pledges, Funds, and
              Asks & pipeline, one tab. */}
          {dpTab==="giving"&&<div className="dp2-cream" data-testid="dp-tab-giving-ask" style={{padding:"24px var(--dp-gutter,40px) 0",display:"flex",flexDirection:"column",gap:16}}>
            {/* THE ASK — one card: the stage bar, the open ask, the suggested
                next ask with Why?, Mark won and Update. Everything else the old
                section held is on the Asks & pipeline tab. */}
            {(()=>{
              const cur=openProposals[0]||null;
              const curStage=donor.stage||"cultivate";
              return <section data-testid="dp-ask-card" style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:14,padding:"16px 18px",display:"flex",flexDirection:"column",gap:12}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",gap:12}}>
                  <div style={{fontSize:10,fontWeight:800,color:T.ink3}}>The ask</div>
                  <button type="button" data-testid="dp-ask-open-tab" onClick={()=>setDpTab("giving")} style={{background:"none",border:"none",padding:0,color:T.greenDk,fontSize:12.5,fontWeight:700,textDecoration:"underline",cursor:"pointer",fontFamily:"inherit"}}>Open Asks &amp; pipeline</button>
                </div>
                <div role="radiogroup" aria-label="Stage" data-testid="dp-stage-bar" style={{display:"grid",gridTemplateColumns:`repeat(${STAGES.length},minmax(0,1fr))`,gap:3}}>
                  {STAGES.map(st=>{
                    const on=curStage===st.id;
                    return <button key={st.id} type="button" role="radio" aria-checked={on} data-stage={st.id} disabled={isReadOnly||!isTeam}
                      onClick={()=>{ if(!on) onStageChange(donor.id,st.id); }}
                      style={{background:on?T.greenDk:T.bg,color:on?T.white:T.ink3,border:"1px solid "+(on?T.greenDk:T.bg3),borderRadius:6,padding:"7px 4px",fontSize:11.5,fontWeight:on?700:500,cursor:isReadOnly?"not-allowed":"pointer",fontFamily:"inherit",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{st.label}</button>;
                  })}
                </div>
                {cur?<div data-testid="dp-ask-open" style={{fontSize:13.5,color:T.ink,lineHeight:1.5}}>
                  <strong><Figure variant="cell" kind="money" value={Number(cur.askAmount)||0} label="The open ask" source={{key:"donor-open-ask",params:{donor:donor.id}}}/></strong>{cur.purpose?<> for {cur.purpose}</>:null}
                  <span style={{color:T.ink3}}> · {PROPOSAL_STAGE_LABEL[cur.stage]||cur.stage}{cur.createdAt?`, opened ${displayDateShort(String(cur.createdAt).slice(0,10),new Date())}`:""}</span>
                  {openProposals.length>1&&<span style={{color:T.ink3}}> · and {openProposals.length-1} more</span>}
                </div>:<div data-testid="dp-ask-none" style={{fontSize:13,color:T.ink3}}>No open ask.</div>}
                <NextLine status={status}/>
                {scores&&scores.suggestedAsk&&!(status&&status.next&&status.next.ask)&&<SuggestedAskLine ask={scores.suggestedAsk} style={{margin:0}}/>}
                {cur&&<ProposalQuickActions proposal={cur} data={propData} reload={reloadProps} donorId={donor.id} donorName={donor.name} isReadOnly={isReadOnly||!isTeam}/>}
              </section>;
            })()}
            <Highlights status={status}/>
            {/* ASK-3: Why and What, scoped to this person (moved from above the tabs). */}
            <div data-testid="dp-ask">
              <AskButtons scope={{donor:{id:donor.id,name:donor.name}}} isReadOnly={isReadOnly} testid="donor-ask"/>
            </div>
            {/* ABOUT — one card, two by two: Household, Planned giving,
                Membership and Sequence, each with its value and one link. */}
            {(()=>{
              const cell={minWidth:0,display:"flex",flexDirection:"column",gap:6,padding:"12px 14px"};
              const head={fontSize:10,fontWeight:800,color:T.ink3};
              const link={background:"none",border:"none",padding:0,color:T.greenDk,fontSize:12.5,fontWeight:700,textDecoration:"underline",cursor:"pointer",fontFamily:"inherit",alignSelf:"flex-start"};
              const anyPg=DESIGNATION_OPTS.some(([k])=>hasDesignation(k));
              return <section data-testid="dp-about" style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:14,overflow:"hidden"}}>
                <div style={{padding:"12px 14px 0",fontSize:10,fontWeight:800,color:T.ink3}}>{String(donor.name||"").trim()?`About ${firstNameOf(donor.name)||donor.name}`:"About"}</div>
                <div className="dp-about-grid" style={{display:"grid",gridTemplateColumns:"repeat(2,minmax(0,1fr))"}}>
                  <div data-testid="dp-household" style={cell}>
                    <span style={head}>Household</span>
                    {household
                      ?<RecordLink to={householdHref(household.id)} data-record-link="household" style={{fontSize:13,color:T.ink,fontWeight:700,textDecoration:"underline dotted"}}>{household.name}</RecordLink>
                      :<span style={{fontSize:13,color:T.ink3}}>Not in a household</span>}
                    {household
                      ?<button type="button" data-testid="dp-household-see" style={link} onClick={()=>setRelatedOpen(true)}>See who's in it</button>
                      :!isReadOnly&&<button type="button" data-testid="dp-household-add" style={link} onClick={()=>setHhModalOpen(true)}>Add</button>}
                  </div>
                  <div data-testid="dp-planned-giving" style={{...cell,borderLeft:"1px solid "+T.bg3}}>
                    <span style={head}>Planned giving</span>
                    <span style={{fontSize:13,color:anyPg?T.ink:T.ink3}}>{anyPg?DESIGNATION_OPTS.filter(([k])=>hasDesignation(k)).map(([,l])=>l).join(", "):"Nothing noted"}</span>
                    {!isReadOnly&&!pgOpen&&<button type="button" data-testid="dp-planned-giving-add" style={link} onClick={()=>setPgOpen(true)}>{anyPg?"Change":"Add"}</button>}
                    {pgOpen&&<div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                      {DESIGNATION_OPTS.map(([k,label])=>{const on=hasDesignation(k);return(
                        <button key={k} onClick={()=>!isReadOnly&&toggleDesignation(k)} disabled={isReadOnly}
                          aria-pressed={on} data-designation={k} data-on={on?"1":"0"}
                          style={{background:"transparent",color:T.ink3,border:"1px solid "+T.bg3,borderRadius:7,padding:"4px 10px",fontSize:11,fontWeight:700,cursor:isReadOnly?"not-allowed":"pointer",...activeMark(on,"bottom")}}>
                          {on?"✓ ":""}{label}
                        </button>);})}
                      <button type="button" style={link} onClick={()=>setPgOpen(false)}>Done</button>
                    </div>}
                  </div>
                  <div data-testid="dp-membership-cell" style={{...cell,borderTop:"1px solid "+T.bg3}}>
                    <span style={head}>Membership</span>
                    <MembershipPanel donor={donor} isReadOnly={isReadOnly} bare/>
                  </div>
                  <div data-testid="dp-sequences" style={{...cell,borderTop:"1px solid "+T.bg3,borderLeft:"1px solid "+T.bg3}}>
                    <span style={head}>Sequence</span>
                    {seqToast?<span style={{fontSize:13,color:T.ink}}>{seqToast}</span>:<span style={{fontSize:13,color:T.ink3}}>{sequences.length?"Not enrolled from here yet":"No sequences running"}</span>}
                    {isTeam&&!isReadOnly&&sequences.length>0&&!seqOpen&&<button type="button" data-testid="dp-sequence-enroll" style={link} onClick={()=>{setSeqOpen(true);setSeqId("");}}>Enroll</button>}
                    {seqOpen&&<div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}>
                      <select aria-label="Sequence" value={seqId} onChange={e=>setSeqId(e.target.value)} style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"6px 10px",color:T.ink,fontSize:12,outline:"none",cursor:"pointer",flex:1,minWidth:0}}>
                        <option value="">Select sequence…</option>
                        {sequences.map(sq=><option key={sq.id} value={sq.id}>{sq.name}</option>)}
                      </select>
                      <button disabled={!seqId||seqLoading} onClick={async()=>{
                        if(!seqId)return;setSeqLoading(true);
                        try{
                          await apiFetch(`/sequences/${seqId}/enroll`,{method:"POST",body:JSON.stringify({donorId:donor.id})});
                          const seqName=sequences.find(sq=>sq.id===seqId)?.name||"sequence";
                          setSeqToast(`Enrolled in "${seqName}"`);
                          setSeqOpen(false);setSeqId("");
                        }catch(e){alert(errorMessage(e, "Could not enroll"));}
                        setSeqLoading(false);
                      }} style={{background:seqId?T.greenDk:T.bg3,border:"none",borderRadius:8,padding:"6px 12px",color:seqId?T.white:T.ink3,fontSize:12,fontWeight:700,cursor:seqId?"pointer":"not-allowed"}}>
                        {seqLoading?"…":"Enroll"}
                      </button>
                      <button onClick={()=>{setSeqOpen(false);setSeqId("");}} aria-label="Cancel" style={{background:"transparent",border:"none",padding:"6px 8px",color:T.ink3,fontSize:12,cursor:"pointer"}}>✕</button>
                    </div>}
                  </div>
                </div>
              </section>;
            })()}
            <VolunteerPanel donor={donor} isReadOnly={isReadOnly}/>
            {/* Matching-gift flag — from a curated static list (matchingGifts.js
                on the backend), not a live vendor feed; source/last-verified
                is surfaced on hover so this reads as informed, not magic. */}
            {donor.matchingGift&&(
              <div title={`${donor.matchingGift.sourceNote} List curated ${donor.matchingGift.lastVerified}.`}
                style={{background:T.greenDk+"12",border:"1px solid "+T.greenDk+"40",borderRadius:12,padding:"10px 14px",fontSize:12,color:T.ink,display:"flex",alignItems:"flex-start",gap:8}}>
                <div>
                  <div><strong>{donor.matchingGift.companyName}</strong> matches employee gifts {donor.matchingGift.ratio}. Ask {donor.name.split(" ")[0]} to submit a match request.</div>
                  <div style={{fontSize:10,color:T.ink3,marginTop:2}}>Curated list, not a live feed. Verify current terms before outreach.</div>
                </div>
              </div>
            )}

            {/* BUILD-100 Part 7 — A FUNDER IS AN ORGANISATION ON FILE, so its
                type, its EIN, its grants and every document signed with it
                live on its own record rather than a second one. */}
            {donor.kind==="organisation"&&<FunderPanel donorId={donor.id} isReadOnly={isReadOnly} isTeam={isTeam}
              onOpenGrant={onNavigate?(id=>onNavigate("grants",{grantId:id})):undefined}/>}

          </div>}


          {/* Gifts & Pledges tab */}
          {dpTab==="giving"&&<div className="dp3-gutter" style={{padding:"24px var(--dp-gutter,40px)",display:"flex",flexDirection:"column",gap:16}}>
            {/* POLISH-3 — the numbers that left the header head the Gifts tab:
                Average, First / Largest, Last met and Last email. */}
            {(figs||donor.figures)&&<ProfileMoreNumbers figures={figs||donor.figures} glance={status&&status.glance}/>}
            {/* PROFILE-1 (header) — Giving by year heads the Gifts tab. */}
          <div>
          {/* FIX-15 Part 4 — no gifts: one line with its add button, like the
              other empty sections (FIX-14 Part 3), instead of an empty chart. */}
          {!giftLoading&&!giftReadErr&&!(giftsFull.length||gifts.length)
          ?<div data-testid="dp-giving-by-year" data-empty="1" style={{padding:"4px 2px",display:"flex",alignItems:"center",gap:8}}>
            <span style={{fontSize:10,fontWeight:800,color:T.ink3}}>Giving by year</span>
            <span style={{fontSize:12,color:T.ink3,fontStyle:"italic"}}>No gifts yet</span>
            {!isReadOnly&&<button data-testid="dp-giving-by-year-add" onClick={()=>setAddGiftOpen(true)}
              style={{marginLeft:"auto",background:"transparent",border:"1px solid "+T.bg3,borderRadius:7,padding:"3px 9px",color:T.greenDk,fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>+ Add a gift</button>}
          </div>
          :<div data-testid="dp-giving-by-year" style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:14,padding:"16px 18px"}}>
            <div style={{fontSize:10,fontWeight:700,color:T.ink3,marginBottom:12}}>Giving by year</div>
            {giftLoading
              ?<div style={{height:80,display:"flex",alignItems:"center",justifyContent:"center",color:T.ink3,fontSize:12}}><Spin/></div>
              :<GivingByYearChart gifts={giftsFull.length?giftsFull:gifts} onOpenYear={y=>setYearDrill(y)}/>}
            <div style={{fontSize:11.5,color:T.ink3,marginTop:8,lineHeight:1.5}}>
              Every gift recorded against this record, added by the calendar year it was given in. A bar opens the gifts behind it.
            </div>
          </div>}
          </div>

            {yearDrill&&(
              <MetricBreakdownPanel open onClose={()=>setYearDrill(null)}
                title={`Giving in ${yearDrill}`}
                explanation={`Every gift ${donor.name} gave between 1 January and 31 December ${yearDrill}, as it is recorded on this record.`}
                source={{key:"gifts",params:{donor:donor.id,from:`${yearDrill}-01-01`,to:`${yearDrill}-12-31`}}}/>
            )}

            {/* BUILD-98 Part 1 — soft credit on OTHER people's gifts. Hard
                credit is their own money and stays the headline; "with soft
                credit" is a second figure, labelled, with the gifts it comes
                from listed so the number can be checked. */}
            {softCredit?.giftSoftCredits?.length>0&&(
              <div data-testid="soft-credit-panel" style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:12,padding:"14px 16px",display:"flex",flexDirection:"column",gap:10}}>
                <span style={{fontSize:10,fontWeight:800,color:T.ink3}}>Soft credit</span>
                <div style={{display:"flex",gap:18,flexWrap:"wrap"}}>
                  {[["Their own giving",softCredit.ownGiving??softCredit.hardCredit,T.ink,censusById("profile.creditHard")],
                    ["With soft credit",softCredit.hardPlusGiftSoft,T.gold600,censusById("profile.creditWithSoft")]].map(([l,v,c,e])=>(
                    <div key={l} data-testid={e.testid} title={e.sentence} aria-label={e.sentence} tabIndex={0}>
                      <div style={{fontSize:10,color:T.ink3}}>{l}</div>
                      <div style={{fontSize:16,fontWeight:800,color:c}}>{fmtFull(v||0)}</div>
                    </div>))}
                </div>
                {/* FIX-7 Part 1 — what they RAISED, said the way a fundraiser
                    would say it. A soft credit is not a gift from this person:
                    it leaves their lifetime total, their last gift, their
                    drift and their LYBUNT standing exactly where they were. */}
                {softCredit.raisedFor?.length>0&&(
                  <div data-testid="raised-for" style={{display:"flex",flexDirection:"column",gap:3}}>
                    {softCredit.raisedFor.map(rf=>(
                      <div key={rf.pageId} style={{fontSize:13,color:T.ink,fontWeight:700}}>
                        Raised {fmtFull((rf.amountCents||0)/100)} for {rf.pageTitle}
                        <span style={{fontWeight:400,color:T.ink3}}> · {rf.giftCount} {rf.giftCount===1?"gift":"gifts"}</span>
                      </div>))}
                    <div style={{fontSize:11.5,color:T.ink3,lineHeight:1.5}}>{softCredit.raisedForSentence}</div>
                  </div>)}
                                <div style={{display:"flex",flexDirection:"column",gap:4}}>
                  {softCredit.giftSoftCredits.slice(0,8).map(sc=>(
                    <div key={sc.id} style={{display:"flex",gap:8,fontSize:12,color:T.ink}}>
                      <span style={{fontWeight:700}}>{sc.giverName}</span>
                      <span style={{color:T.ink3}}>{displayDate(sc.date)}</span>
                      <span style={{marginLeft:"auto"}}>{fmtFull(sc.amount)}</span>
                    </div>))}
                </div>
              </div>
            )}

            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
              <div>
                <div style={{fontSize:14,fontWeight:800,color:T.ink}}>Gift History</div>
                <div style={{fontSize:12,color:T.ink3,marginTop:2}}>
                  Total: <strong style={{color:T.greenDk}}>{fmtFull(giftsFull.reduce((s,g)=>s+g.amount,0))}</strong> · {giftCountReal} {giftCountReal===1?"gift":"gifts"}
                  {refundRows.length>0&&<span> · {refundRows.length===1?"a refund":`${refundRows.length} refunds`} of {fmtFull(-refundRows.reduce((s,g)=>s+g.amount,0))} taken off</span>}
                  {/* NUMBERS-2: the imported total is its own figure, with its source and the last day it covers. */}
                  {figs&&figs.imported&&(
                    <span className="dp-unitemized-note"> · lifetime {fmtFull(figs.lifetime&&figs.lifetime.value!=null?figs.lifetime.value:donor.total)} {figs.imported.words.replace(/^Includes/,"includes")}, from {figs.imported.source}; gifts below dated on or before then are inside it</span>
                  )}
                </div>
              </div>
              <div style={{display:"flex",gap:8,alignItems:"center"}}>
                <button onClick={exportGiftsCSV} style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"6px 12px",color:T.ink3,fontSize:12,cursor:"pointer"}}>↓ CSV</button>
                {receiptsEnabled&&(
                  <button onClick={()=>setShowYearEnd(v=>!v)} disabled={isReadOnly} aria-pressed={showYearEnd} title={isReadOnly?"Reactivate your subscription to make changes.":undefined}
                    style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"6px 12px",color:T.ink3,fontSize:12,fontWeight:600,cursor:isReadOnly?"not-allowed":"pointer",opacity:isReadOnly?0.45:1,...activeMark(showYearEnd,"bottom")}}>
                    Year-end statement
                  </button>
                )}
                {!isReadOnly&&<button type="button" data-testid="dp-snap-check" onClick={()=>openCheckSnap({donor:{id:donor.id,name:donor.name},camera:true})} style={{background:T.white,border:"1px solid "+T.ink,borderRadius:8,padding:"6px 12px",color:T.ink,fontSize:12,fontWeight:700,cursor:"pointer"}}>Snap a check</button>}
                <button onClick={()=>setAddGiftOpen(v=>!v)} disabled={isReadOnly} title={isReadOnly?"Reactivate your subscription to make changes.":undefined} style={{background:T.greenDk,border:"none",borderRadius:8,padding:"7px 12px",color:T.white,fontSize:12,fontWeight:700,cursor:isReadOnly?"not-allowed":"pointer",opacity:isReadOnly?0.45:1}}>+ Add Gift</button>
              </div>
            </div>

            {!receiptsEnabled&&isAdmin&&(
              <div style={{background:T.gold100,border:"1px solid "+T.gold300,borderRadius:10,padding:"10px 14px",fontSize:12,color:T.gold700}}>
                Tax receipts aren't set up yet. Add your organization's legal info in Settings to send IRS-compliant receipts for gifts of $250+.
              </div>
            )}

            {showYearEnd&&receiptsEnabled&&<YearEndPanel rc={rc} donor={donor} isReadOnly={isReadOnly}/>}

            {/* Recurring gift health — failed-payment recovery status */}
            {recurringSub&&(()=>{
              const RS_META={
                active:      {label:"Active",         color:T.greenDk},
                past_due:    {label:"Payment failed",  color:T.terracotta},
                recovering:  {label:"Recovering",      color:T.gold500},
                recovered:   {label:"Card fixed",      color:T.greenDk},
                canceled:    {label:"Canceled",        color:T.ink3},
              };
              const meta=RS_META[recurringSub.status]||{label:recurringSub.status,color:T.ink3};
              const atRisk=["past_due","recovering"].includes(recurringSub.status);
              return(
                <div id={`plan-${recurringSub.id}`} style={{background:T.white,border:"1px solid "+meta.color+"30",borderLeft:"3px solid "+meta.color,borderRadius:10,padding:"10px 14px",display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,flexWrap:"wrap"}}>
                  <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                    <span style={{background:meta.color+"15",color:meta.color,border:"1px solid "+meta.color+"40",borderRadius:99,padding:"3px 10px",fontSize:11,fontWeight:800}}>{meta.label}</span>
                    <span style={{fontSize:12,color:T.ink3}}>
                      Recurring gift{recurringSub.amount!=null?` · ${fmtFull(recurringSub.amount)}/${recurringSub.interval==="year"?"yr":"mo"}`:""}
                      {atRisk&&recurringSub.failure_count>0&&` · ${countLabel(recurringSub.failure_count, "failed attempt")}`}
                    </span>
                  </div>
                  {atRisk&&(
                    <button onClick={resendRecurringLink} disabled={isReadOnly||recurResendBusy||recurResendSent}
                      title={isReadOnly?"Reactivate your subscription to make changes.":undefined}
                      style={{background:meta.color,border:"none",borderRadius:8,padding:"6px 12px",color:T.white,fontSize:12,fontWeight:700,cursor:(isReadOnly||recurResendBusy||recurResendSent)?"not-allowed":"pointer",opacity:(isReadOnly||recurResendBusy||recurResendSent)?0.5:1,whiteSpace:"nowrap"}}>
                      {recurResendSent?"Sent ✓":recurResendBusy?"Sending…":"Send card-update link"}
                    </button>
                  )}
                </div>
              );
            })()}

            {addGiftOpen&&<div data-testid="dp-add-gift-form" style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:12,padding:"16px"}}>
              <div style={{fontSize:12,fontWeight:700,color:T.ink,marginBottom:12}}>New Gift</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
                <input value={addGiftForm.amount} onChange={e=>setAddGiftForm(p=>({...p,amount:e.target.value}))} placeholder="Amount ($)" type="number" style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"8px 10px",color:T.ink,fontSize:13,outline:"none"}}/>
                <input value={addGiftForm.date} onChange={e=>setAddGiftForm(p=>({...p,date:e.target.value}))} type="date" style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"8px 10px",color:T.ink,fontSize:13,outline:"none"}}/>
                <select value={addGiftForm.type} onChange={e=>setAddGiftForm(p=>({...p,type:e.target.value}))} style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"8px 10px",color:T.ink,fontSize:13,outline:"none"}}>
                  {["cash","check","credit_card","stock","in_kind","matching","other"].map(t=><option key={t}>{t}</option>)}
                </select>
                <input value={addGiftForm.payment_method} onChange={e=>setAddGiftForm(p=>({...p,payment_method:e.target.value}))} placeholder="Payment method" style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"8px 10px",color:T.ink,fontSize:13,outline:"none"}}/>
              </div>
              <input value={addGiftForm.notes} onChange={e=>setAddGiftForm(p=>({...p,notes:e.target.value}))} placeholder="Notes" style={{width:"100%",background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"8px 10px",color:T.ink,fontSize:13,outline:"none",boxSizing:"border-box",marginBottom:8}}/>
              {campaigns.length>0&&<><select value={addGiftForm.campaign_id||""} onChange={e=>setAddGiftForm(p=>({...p,campaign_id:e.target.value}))} style={{width:"100%",background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"8px 10px",color:T.ink,fontSize:13,outline:"none",boxSizing:"border-box",marginBottom:2}}>
                <option value="">Campaign: not attributed</option>
                {/* NUMBERS-1 · a gift counts toward a campaign only inside its
                    dates, so a campaign the gift's date falls outside is shown
                    and cannot be chosen (the server refuses it too). */}
                {campaigns.map(c=>{const d=String(addGiftForm.date||"").slice(0,10),s=c.startDate?String(c.startDate).slice(0,10):null,e=c.endDate?String(c.endDate).slice(0,10):null;
                  const out=(s&&d<s)||(e&&d>e);
                  return <option key={c.id} value={c.id} disabled={!!out}>{c.name}{out?(s&&d<s?` (starts ${displayDate(s)})`:` (ended ${displayDate(e)})`):""}</option>;})}
              </select>
              <div style={{fontSize:11,color:T.ink3,marginBottom:8,lineHeight:1.4}}>Which goal this counts toward. It updates that campaign's thermometer live.</div></>}
              {pledges.filter(p=>p.status==="open").length>0&&(
                <select value={addGiftForm.pledgeId} onChange={e=>setAddGiftForm(p=>({...p,pledgeId:e.target.value}))} style={{width:"100%",background:T.bg,border:"1px solid "+T.terracotta+"50",borderRadius:8,padding:"8px 10px",color:T.ink,fontSize:13,outline:"none",boxSizing:"border-box",marginBottom:8}}>
                  <option value="">Not fulfilling a pledge</option>
                  {pledges.filter(p=>p.status==="open").map(p=>(
                    <option key={p.id} value={p.id}>Fulfills {fmtFull(p.amount)} pledge due {displayDate(p.due_date)}</option>
                  ))}
                </select>
              )}
              {/* BUILD-98 Part 1 — soft credit, tribute, matching gift. Closed by
                  default: most gifts are none of these, and three blank rows on
                  every gift is how a form starts to feel like paperwork. */}
              <PeopleDatalist id="gift-people" text={giftPeopleQ}/>
              <button type="button" onClick={()=>setGiftMoreOpen(o=>!o)} data-testid="gift-more-toggle"
                style={{background:"transparent",border:"none",padding:"2px 0",color:T.greenDk,fontSize:12,fontWeight:700,cursor:"pointer",marginBottom:8}}>
                {giftMoreOpen?"Hide soft credit, tribute and match":"Soft credit, tribute or matching gift"}
              </button>
              {giftMoreOpen&&(()=>{const inp={background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"8px 10px",color:T.ink,fontSize:13,outline:"none",boxSizing:"border-box",width:"100%"};return(
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:10}}>
                  <input list="gift-people" value={addGiftForm.scName||""} onChange={e=>setAddGiftForm(p=>({...p,scName:e.target.value}))} placeholder="Soft credit to (a person on file)" style={inp} data-testid="gift-sc-name"/>
                  <input value={addGiftForm.scAmount||""} onChange={e=>setAddGiftForm(p=>({...p,scAmount:e.target.value}))} placeholder="Soft credit amount (blank = whole gift)" type="number" style={inp}/>
                  <select value={addGiftForm.tribType||""} onChange={e=>setAddGiftForm(p=>({...p,tribType:e.target.value}))} style={inp} data-testid="gift-trib-type">
                    <option value="">Not a tribute gift</option><option value="honor">In honor of</option><option value="memory">In memory of</option>
                  </select>
                  <input list="gift-people" value={addGiftForm.tribName||""} onChange={e=>setAddGiftForm(p=>({...p,tribName:e.target.value}))} placeholder="Who it honors" style={inp} data-testid="gift-trib-name"/>
                  <input value={addGiftForm.tribNotify||""} onChange={e=>setAddGiftForm(p=>({...p,tribNotify:e.target.value}))} placeholder="Tell (e.g. the Lee family)" style={inp}/>
                  <input value={addGiftForm.tribNotifyEmail||""} onChange={e=>setAddGiftForm(p=>({...p,tribNotifyEmail:e.target.value}))} placeholder="Their email or leave blank" style={inp}/>
                  <input list="gift-people" value={addGiftForm.matchEmployer||""} onChange={e=>setAddGiftForm(p=>({...p,matchEmployer:e.target.value}))} placeholder="Employer that will match it" style={inp}/>
                  <input value={addGiftForm.matchAmount||""} onChange={e=>setAddGiftForm(p=>({...p,matchAmount:e.target.value}))} placeholder="Expected match (blank = same amount)" type="number" style={inp}/>
                </div>);})()}
              {giftErr&&<div role="alert" style={{fontSize:12,color:T.terracotta,marginBottom:8}}>{giftErr}</div>}
              <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:12}}>
                <label style={{display:"flex",alignItems:"center",gap:6,fontSize:12,color:T.ink,cursor:"pointer"}}>
                  <input type="checkbox" checked={addGiftForm.acknowledgement_sent} onChange={e=>setAddGiftForm(p=>({...p,acknowledgement_sent:e.target.checked}))} style={{accentColor:T.greenDk}}/>
                  Acknowledgement sent
                </label>
              </div>
              <div style={{display:"flex",gap:8}}>
                <button onClick={addGift} disabled={giftSaving} style={{background:T.greenDk,border:"none",borderRadius:8,padding:"8px 16px",color:T.white,fontSize:13,fontWeight:700,cursor:"pointer"}}>Save</button>
                <button onClick={()=>setAddGiftOpen(false)} style={{background:T.bg,border:"none",borderRadius:8,padding:"8px 14px",color:T.ink3,fontSize:13,cursor:"pointer"}}>Cancel</button>
              </div>
            </div>}

            <div style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:12,overflow:"hidden"}}>
              {giftLoading?<div style={{padding:24,textAlign:"center",color:T.ink3,fontSize:12}}><Spin/></div>:giftReadErr?(
                <div data-testid="dp-gifts-error" style={{padding:"28px 24px",textAlign:"center",fontSize:13,color:T.ink2,lineHeight:1.6}}>
                  Steward could not load the gifts on this record.{" "}
                  <button type="button" onClick={()=>{setGiftLoading(true);loadGiftsFull();}} style={{background:"none",border:"none",padding:0,color:T.greenDk,fontWeight:600,textDecoration:"underline",cursor:"pointer",fontFamily:"inherit",fontSize:13}}>Try again</button>
                </div>
              ):giftsFull.length===0?(
                <div style={{display:"flex",flexDirection:"column",alignItems:"center",padding:"40px 24px",textAlign:"center",gap:0}}>
                  <div style={{marginBottom:16,color:T.greenDk,opacity:0.7}}>
                    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
                    </svg>
                  </div>
                  <div style={{fontFamily:"'DM Serif Display',Georgia,serif",fontSize:20,fontWeight:400,color:T.ink,letterSpacing:"-0.01em",marginBottom:8}}>No gifts recorded yet.</div>
                  <div style={{fontSize:13,color:T.ink3,maxWidth:260,lineHeight:1.65,marginBottom:20}}>Log your first gift to start tracking acknowledgments and giving history.</div>
                  <button onClick={()=>setAddGiftOpen(true)} disabled={isReadOnly} title={isReadOnly?"Reactivate your subscription to make changes.":undefined}
                    style={{background:T.greenDk,color:T.white,border:"none",borderRadius:10,padding:"10px 22px",fontSize:13,fontWeight:600,cursor:isReadOnly?"not-allowed":"pointer",opacity:isReadOnly?0.45:1,fontFamily:"'DM Sans',system-ui,sans-serif"}}>
                    Record a gift →
                  </button>
                </div>
              ):(
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                  <thead>
                    <tr style={{background:T.bg2}}>
                      {["Date","Amount","Type","Method","Ack","Receipt","Note",""].map(h=><th key={h} style={{padding:"8px 12px",textAlign:"left",fontWeight:700,color:T.ink3,fontSize:10,borderBottom:"1px solid "+T.bg3}}>{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {[...giftsFull].sort((a,b)=>new Date(b.date)-new Date(a.date)).map(g=>(
                      <tr key={g.id} id={`gift-${g.id}`} style={{borderBottom:"1px solid "+T.bg3}}>
                        {giftEditId===g.id?(
                          <td colSpan={8} style={{padding:"10px 12px"}}>
                            <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}>
                              <input value={giftEditForm.amount} onChange={e=>setGiftEditForm(p=>({...p,amount:e.target.value}))} placeholder="Amount" type="number" style={{width:80,background:T.bg,border:"1px solid "+T.bg3,borderRadius:6,padding:"5px 8px",color:T.ink,fontSize:12,outline:"none"}}/>
                              <input value={giftEditForm.date} onChange={e=>setGiftEditForm(p=>({...p,date:e.target.value}))} type="date" style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:6,padding:"5px 8px",color:T.ink,fontSize:12,outline:"none"}}/>
                              <select value={giftEditForm.type} onChange={e=>setGiftEditForm(p=>({...p,type:e.target.value}))} style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:6,padding:"5px 8px",color:T.ink,fontSize:12,outline:"none"}}>
                                {["cash","check","credit_card","stock","in_kind","matching","other"].map(t=><option key={t}>{t}</option>)}
                              </select>
                              <input value={giftEditForm.payment_method} onChange={e=>setGiftEditForm(p=>({...p,payment_method:e.target.value}))} placeholder="Method" style={{width:100,background:T.bg,border:"1px solid "+T.bg3,borderRadius:6,padding:"5px 8px",color:T.ink,fontSize:12,outline:"none"}}/>
                              <input value={giftEditForm.notes} onChange={e=>setGiftEditForm(p=>({...p,notes:e.target.value}))} placeholder="Notes" style={{flex:1,minWidth:80,background:T.bg,border:"1px solid "+T.bg3,borderRadius:6,padding:"5px 8px",color:T.ink,fontSize:12,outline:"none"}}/>
                              {giftCfDefs.map(d=>(
                                d.type==="select"?(
                                  <select key={d.key} value={giftEditForm.customFields?.[d.key]||""} onChange={e=>setGiftEditForm(p=>({...p,customFields:{...p.customFields,[d.key]:e.target.value}}))}
                                    title={d.label} style={{width:110,background:T.bg,border:"1px solid "+T.bg3,borderRadius:6,padding:"5px 8px",color:T.ink,fontSize:12,outline:"none"}}>
                                    <option value="">{d.label}…</option>
                                    {(d.options||[]).map(o=><option key={o} value={o}>{o}</option>)}
                                  </select>
                                ):(
                                  <input key={d.key} value={giftEditForm.customFields?.[d.key]||""} onChange={e=>setGiftEditForm(p=>({...p,customFields:{...p.customFields,[d.key]:e.target.value}}))}
                                    placeholder={d.label} title={d.label} style={{width:110,background:T.bg,border:"1px solid "+T.bg3,borderRadius:6,padding:"5px 8px",color:T.ink,fontSize:12,outline:"none"}}/>
                                )
                              ))}
                              <label style={{display:"flex",alignItems:"center",gap:4,fontSize:11,color:T.ink,cursor:"pointer",flexShrink:0}}>
                                <input type="checkbox" checked={!!giftEditForm.acknowledgement_sent} onChange={e=>setGiftEditForm(p=>({...p,acknowledgement_sent:e.target.checked}))} style={{accentColor:T.greenDk}}/>
                                Ack
                              </label>
                              <button onClick={()=>saveGiftEdit(g.id)} disabled={giftSaving} style={{background:T.greenDk,border:"none",borderRadius:6,padding:"5px 10px",color:T.white,fontSize:11,fontWeight:700,cursor:"pointer"}}>Save</button>
                              <button onClick={()=>setGiftEditId(null)} style={{background:T.bg,border:"none",borderRadius:6,padding:"5px 10px",color:T.ink3,fontSize:11,cursor:"pointer"}}>Cancel</button>
                            </div>
                          </td>
                        ):(
                          <>
                            <td style={{padding:"9px 12px",color:T.ink3,whiteSpace:"nowrap"}}>{g.date?displayDate(g.date):<UndatedGiftDate giftId={g.id} readOnly={isReadOnly} onSaved={loadGiftsFull}/>}</td>
                            <td style={{padding:"9px 12px",fontWeight:700,color:T.greenDk,whiteSpace:"nowrap"}}>{fmtFull(g.amount)}
                              {/* FUNDRAISING-2: a gift for an event names it. */}
                              {g.event_name&&<div data-testid="dp-gift-event" style={{fontSize:11,fontWeight:400,color:T.ink3}}>{g.event_name}</div>}
                              {(g.softCreditTo||[]).length>0&&<div data-testid="dp-gift-softcredit" style={{fontSize:11,fontWeight:400,color:T.ink3}}>Soft credit to {g.softCreditTo.map(x=>x.name).join(", ")} (recognition, not in their Lifetime)</div>}
                              {g.fee>0&&g.amount>0&&<div data-testid="dp-gift-fee-net" style={{fontSize:11,fontWeight:400,color:T.ink3}}>Fee {fmtFull(g.fee)}, net {fmtFull(Math.round((g.amount-g.fee)*100)/100)}</div>}</td>
                            <td style={{padding:"9px 12px",color:T.ink3,textTransform:"capitalize"}}>{g.type||"cash"}</td>
                            <td style={{padding:"9px 12px",color:T.ink3}}>{g.payment_method||"Not recorded"}</td>
                            <td style={{padding:"9px 12px",textAlign:"center"}}>{g.acknowledgement_sent?<span style={{color:T.greenDk,fontSize:13}}>✓</span>:<span style={{color:T.ink3,fontSize:12}}>Not yet</span>}</td>
                            <td style={{padding:"9px 12px",whiteSpace:"nowrap"}}>
                              <ReceiptCell g={g} rc={rc} isReadOnly={isReadOnly}/>
                            </td>
                            <td style={{padding:"9px 12px",color:T.ink3,maxWidth:180,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}
                              title={[g.notes,...giftCfDefs.map(d=>{const v=(g.custom_fields||{})[d.key];return (v!==null&&v!==undefined&&v!=="")?`${d.label}: ${renderCustomValue(d,v)}`:null;}).filter(Boolean)].filter(Boolean).join(" · ")}>
                              {[g.notes,...giftCfDefs.map(d=>{const v=(g.custom_fields||{})[d.key];return (v!==null&&v!==undefined&&v!=="")?`${d.label}: ${renderCustomValue(d,v)}`:null;}).filter(Boolean)].filter(Boolean).join(" · ")}</td>
                            <td style={{padding:"9px 12px",whiteSpace:"nowrap"}}>
                              <button onClick={()=>{setGiftEditId(g.id);setGiftEditForm({amount:g.amount,date:g.date,type:g.type,payment_method:g.payment_method||"",notes:g.notes||"",fund_id:g.fund_id||"",acknowledgement_sent:g.acknowledgement_sent,customFields:Object.fromEntries(giftCfDefs.map(d=>[d.key,giftCfEditStr(d,(g.custom_fields||{})[d.key])]))});}} style={{background:"none",border:"none",color:T.ink3,fontSize:12,cursor:"pointer",padding:"2px 6px"}}>Edit</button>
                              <button onClick={()=>deleteGift(g.id)} style={{background:"none",border:"none",color:T.terracotta,fontSize:12,cursor:"pointer",padding:"2px 6px"}}>Delete</button>
                            </td>
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Pledges — a promise to give $X by a future date. Past-due
                unfulfilled pledges get reminders on the same cadence as the
                recurring-gift dunning system (see processPledgeReminders in
                server.js). Distinct from both Gift History above (money
                already received) and Planned Giving below (bequests/trusts,
                no due date). */}
            <div>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
                <div style={{fontSize:12,fontWeight:700,color:T.ink}}>Pledges</div>
                <button onClick={()=>setAddPledgeOpen(v=>!v)} disabled={isReadOnly} title={isReadOnly?"Reactivate your subscription to make changes.":undefined} style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"5px 10px",color:T.ink3,fontSize:11,cursor:isReadOnly?"not-allowed":"pointer",opacity:isReadOnly?0.5:1}}>+ Add Pledge</button>
              </div>
              <div style={{marginTop:-6,marginBottom:8}}><MailTypeSwitches keys={["pledge_reminder"]} from="pledges"/></div>
              {addPledgeOpen&&<div style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:10,padding:"14px",marginBottom:10}}>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
                  <input value={pledgeForm.amount} onChange={e=>setPledgeForm(p=>({...p,amount:e.target.value}))} placeholder="Pledged amount ($)" type="number" style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"7px 10px",color:T.ink,fontSize:12,outline:"none"}}/>
                  <input value={pledgeForm.dueDate} onChange={e=>setPledgeForm(p=>({...p,dueDate:e.target.value}))} type="date" style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"7px 10px",color:T.ink,fontSize:12,outline:"none"}}/>
                </div>
                {/* Attribution FIX — a pledge attributes at pledge time (capital
                    campaigns are mostly pledges). Payments against it inherit the
                    campaign; the campaign shows this as "pledged" until paid. */}
                {campaigns.length>0&&(
                  <select value={pledgeForm.campaignId} onChange={e=>setPledgeForm(p=>({...p,campaignId:e.target.value}))}
                    style={{width:"100%",boxSizing:"border-box",background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"7px 10px",color:T.ink,fontSize:12,outline:"none",marginBottom:8,cursor:"pointer"}}>
                    <option value="">No campaign (general pledge)</option>
                    {campaigns.map(c=><option key={c.id} value={c.id}>Counts toward: {c.name}</option>)}
                  </select>
                )}
                <input value={pledgeForm.notes} onChange={e=>setPledgeForm(p=>({...p,notes:e.target.value}))} placeholder="Notes (optional)" style={{width:"100%",background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"7px 10px",color:T.ink,fontSize:12,outline:"none",boxSizing:"border-box",marginBottom:8}}/>
                <div style={{display:"flex",gap:8}}>
                  <button onClick={addPledge} disabled={pledgeSaving} style={{background:T.terracotta,border:"none",borderRadius:8,padding:"7px 14px",color:T.white,fontSize:12,fontWeight:700,cursor:"pointer"}}>Save</button>
                  <button onClick={()=>setAddPledgeOpen(false)} style={{background:T.bg,border:"none",borderRadius:8,padding:"7px 12px",color:T.ink3,fontSize:12,cursor:"pointer"}}>Cancel</button>
                </div>
              </div>}
              {pledges.length===0?<div style={{fontSize:12,color:T.ink3,fontStyle:"italic"}}>No pledges on file</div>:(
                <div style={{display:"flex",flexDirection:"column",gap:6}}>
                  {pledges.map(pl=>{
                    const PL_META={open:{label:"Open",color:T.green500},fulfilled:{label:"Fulfilled",color:T.greenMid},written_off:{label:"Written off",color:T.ink3}};
                    const meta=PL_META[pl.status]||PL_META.open;
                    const isOverdue=pl.status==="open"&&pl.first_overdue_at;
                    const daysOver=isOverdue?daysDiff(pl.due_date):null;
                    return(
                      <div key={pl.id} id={`pledge-${pl.id}`} style={{background:T.white,border:`1px solid ${isOverdue?T.terracotta+"40":T.bg3}`,borderLeft:`3px solid ${isOverdue?T.terracotta:meta.color}`,borderRadius:10,padding:"10px 14px",display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:10,flexWrap:"wrap"}}>
                        <div>
                          <div style={{display:"flex",alignItems:"center",gap:7,flexWrap:"wrap"}}>
                            <span style={{fontSize:14,fontWeight:800,color:T.ink}}>{fmtFull(pl.amount)}</span>
                            {/* FIX-55: a pledge over years says this year's installments and what is open in all */}
                            {pl.status==="open"&&pl.years>1&&<span data-testid="pledge-money" style={{fontSize:12,color:T.ink2,fontWeight:600}}>{pledgeMoneyWords({dueThisYearCents:Math.round((pl.dueThisYear||0)*100),openCents:Math.round((pl.balance||0)*100),years:pl.years},c=>fmtFull(c/100))}</span>}
                            <span style={{background:meta.color+"15",color:meta.color,border:"1px solid "+meta.color+"40",borderRadius:99,padding:"2px 8px",fontSize:10,fontWeight:800}}>{meta.label}</span>
                            {isOverdue&&<span style={{fontSize:10,fontWeight:800,color:T.gold700}}>{daysOver}d overdue · reminder {Math.min(pl.reminder_step+1,4)}/4 sent</span>}
                          </div>
                          <div style={{fontSize:11,color:T.ink3,marginTop:2}}>Due {displayDate(pl.due_date)}{pl.campaign_id?(()=>{const c=campaigns.find(x=>x.id===pl.campaign_id);return c?` · counts toward ${c.name}`:"";})():""}</div>
                          {pl.notes&&<div style={{fontSize:12,color:T.ink3,marginTop:3,lineHeight:1.4}}>{pl.notes}</div>}
                          {pledgeEdit&&pledgeEdit.id===pl.id&&<div data-testid="pledge-edit" style={{display:"flex",gap:6,flexWrap:"wrap",marginTop:8}}>
                            <input aria-label="Amount" value={pledgeEdit.amount} onChange={e=>setPledgeEdit({...pledgeEdit,amount:e.target.value})} style={{width:100,border:"1px solid "+T.bg3,borderRadius:7,padding:"6px 8px",fontSize:12}}/>
                            <input aria-label="Due" type="date" value={pledgeEdit.dueDate} onChange={e=>setPledgeEdit({...pledgeEdit,dueDate:e.target.value})} style={{border:"1px solid "+T.bg3,borderRadius:7,padding:"5px 8px",fontSize:12}}/>
                            <input aria-label="Note" value={pledgeEdit.notes} onChange={e=>setPledgeEdit({...pledgeEdit,notes:e.target.value})} placeholder="Note" style={{flex:"1 1 140px",border:"1px solid "+T.bg3,borderRadius:7,padding:"6px 8px",fontSize:12}}/>
                            <button onClick={savePledgeEdit} style={{background:T.greenDk,border:"none",borderRadius:7,padding:"6px 12px",color:T.white,fontSize:12,fontWeight:700,cursor:"pointer"}}>Save</button>
                            <button onClick={()=>setPledgeEdit(null)} style={{background:"none",border:"none",color:T.ink3,fontSize:12,cursor:"pointer"}}>Cancel</button>
                          </div>}
                        </div>
                        <div style={{display:"flex",gap:6,alignItems:"center",flexShrink:0}}>
                          {pl.status==="open"&&<>
                            {isOverdue&&<button onClick={()=>resendPledgeReminder(pl.id)} disabled={isReadOnly||pledgeResendBusyId===pl.id||pledgeResentIds.has(pl.id)}
                              style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:6,padding:"5px 9px",color:T.ink2,fontSize:11,fontWeight:600,cursor:(isReadOnly||pledgeResendBusyId===pl.id||pledgeResentIds.has(pl.id))?"not-allowed":"pointer",opacity:(isReadOnly||pledgeResendBusyId===pl.id||pledgeResentIds.has(pl.id))?0.5:1}}>
                              {pledgeResentIds.has(pl.id)?"Sent ✓":pledgeResendBusyId===pl.id?"Sending…":"Resend reminder"}
                            </button>}
                            <button onClick={()=>setPledgeStatus(pl.id,"fulfilled")} disabled={isReadOnly} style={{background:T.green100,border:"1px solid "+T.greenDk,borderRadius:6,padding:"5px 9px",color:T.greenDk,fontSize:11,fontWeight:600,cursor:isReadOnly?"not-allowed":"pointer"}}>Mark Fulfilled</button>
                            <button onClick={()=>setPledgeStatus(pl.id,"written_off")} disabled={isReadOnly} style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:6,padding:"5px 9px",color:T.ink3,fontSize:11,fontWeight:600,cursor:isReadOnly?"not-allowed":"pointer"}}>Write Off</button>
                          </>}
                          <EditedMarker item={pl}/>
                          {!isReadOnly&&<button onClick={()=>setPledgeEdit({id:pl.id,amount:String(pl.amount),dueDate:String(pl.due_date||"").slice(0,10),notes:pl.notes||""})} style={{background:"none",border:"1px solid "+T.bg3,borderRadius:6,padding:"5px 9px",color:T.ink2,fontSize:11,fontWeight:600,cursor:"pointer"}}>Edit</button>}
                          <button onClick={()=>deletePledge(pl.id)} aria-label="Delete this pledge" style={{background:"none",border:"none",color:T.terracotta,fontSize:14,cursor:"pointer",flexShrink:0,padding:"2px 4px"}}>×</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Planned Giving */}
            <div>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
                <div style={{fontSize:12,fontWeight:700,color:T.ink,display:"flex",alignItems:"center",gap:7}}>
                  Planned Giving
                  {donor.plannedGiving&&<span style={{background:T.green100,color:T.greenDk,border:"1px solid "+T.green200,borderRadius:99,padding:"2px 8px",fontSize:10,fontWeight:700}}>Indicated</span>}
                </div>
                <button onClick={()=>setAddPgOpen(v=>!v)} style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"5px 10px",color:T.ink3,fontSize:11,cursor:"pointer"}}>+ Add</button>
              </div>
              {addPgOpen&&<div style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:10,padding:"14px",marginBottom:10}}>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
                  <select value={pgForm.type} onChange={e=>setPgForm(p=>({...p,type:e.target.value}))} style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"7px 10px",color:T.ink,fontSize:12,outline:"none"}}>
                    {["bequest","charitable_remainder_trust","charitable_lead_trust","annuity","ira_beneficiary","life_insurance","real_estate","other"].map(t=><option key={t} value={t}>{t.replace(/_/g," ")}</option>)}
                  </select>
                  <input value={pgForm.estimated_value} onChange={e=>setPgForm(p=>({...p,estimated_value:e.target.value}))} placeholder="Estimated value ($)" type="number" style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"7px 10px",color:T.ink,fontSize:12,outline:"none"}}/>
                  <input value={pgForm.date_indicated} onChange={e=>setPgForm(p=>({...p,date_indicated:e.target.value}))} type="date" placeholder="Date indicated" style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"7px 10px",color:T.ink,fontSize:12,outline:"none"}}/>
                  <input value={pgForm.notes} onChange={e=>setPgForm(p=>({...p,notes:e.target.value}))} placeholder="Notes" style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"7px 10px",color:T.ink,fontSize:12,outline:"none"}}/>
                </div>
                <div style={{display:"flex",gap:8}}>
                  <button onClick={addPlannedGift} disabled={pgSaving} style={{background:T.gold500,border:"none",borderRadius:8,padding:"7px 14px",color:T.ink,fontSize:12,fontWeight:700,cursor:"pointer"}}>Save</button>
                  <button onClick={()=>setAddPgOpen(false)} style={{background:T.bg,border:"none",borderRadius:8,padding:"7px 12px",color:T.ink3,fontSize:12,cursor:"pointer"}}>Cancel</button>
                </div>
              </div>}
              {plannedGifts.length===0?<div style={{fontSize:12,color:T.ink3,fontStyle:"italic"}}>No planned giving on file</div>:(
                <div style={{display:"flex",flexDirection:"column",gap:6}}>
                  {plannedGifts.map(pg=>(
                    <div key={pg.id} style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:10,padding:"10px 14px",display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:10}}>
                      <div>
                        <div style={{fontSize:13,fontWeight:700,color:T.greenDk,textTransform:"capitalize"}}>{(pg.type||"").replace(/_/g," ")}</div>
                        {pg.estimated_value&&<div style={{fontSize:12,color:T.ink3,marginTop:2}}>Est. {fmtFull(pg.estimated_value)}</div>}
                        {pg.date_indicated&&<div style={{fontSize:11,color:T.ink3,marginTop:1}}>Indicated {pg.date_indicated}</div>}
                        {pg.notes&&<div style={{fontSize:12,color:T.ink3,marginTop:3,lineHeight:1.4}}>{pg.notes}</div>}
                      </div>
                      <button onClick={()=>deletePlannedGift(pg.id)} style={{background:"none",border:"none",color:T.terracotta,fontSize:12,cursor:"pointer",flexShrink:0,padding:"2px 4px"}}>×</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>}

          {/* Materials tab */}
          {/* Funds tab */}
          {dpTab==="giving"&&<div className="dp3-gutter" style={{padding:"0 var(--dp-gutter,40px) 24px",display:"flex",flexDirection:"column",gap:16}}>
            {fundLoading&&<div style={{textAlign:"center",color:T.ink3,fontSize:12,padding:24}}><Spin/></div>}
            {!fundLoading&&fundAffinity&&(()=>{
              const {affinity,unrestrictedTotal,restrictedTotal,totalGiving,activeFunds}=fundAffinity;
              const maxFund=affinity.length>0?affinity[0].total:1;
              return(<>
                <div>
                  <div style={{fontSize:14,fontWeight:800,color:T.ink,marginBottom:14}}>What they support</div>
                  {affinity.length===0
                    ?<div style={{fontSize:13,color:T.ink3,fontStyle:"italic"}}>No fund-attributed gifts yet. Assign funds when logging gifts.</div>
                    :<div style={{display:"flex",flexDirection:"column",gap:10}}>
                      {affinity.map(f=>(
                        <div key={f.fundId} style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:12,padding:"14px 16px"}}>
                          <div style={{display:"flex",alignItems:"baseline",justifyContent:"space-between",marginBottom:6}}>
                            <div>
                              <span style={{fontSize:13,fontWeight:700,color:T.ink}}>{f.fundName}</span>
                              {f.restricted&&<span style={{marginLeft:6,fontSize:10,fontWeight:700,color:T.gold700,background:T.gold100,borderRadius:99,padding:"2px 7px"}}>Restricted</span>}
                            </div>
                            <div style={{textAlign:"right"}}>
                              <div style={{fontSize:14,fontWeight:800,color:T.ink}}>{fmtFull(f.total)}</div>
                              <div style={{fontSize:10,color:T.ink3}}>{f.pct}% of lifetime</div>
                            </div>
                          </div>
                          <div style={{background:T.bg3,borderRadius:99,height:6,overflow:"hidden",marginBottom:6}}>
                            <div style={{height:"100%",background:T.greenDk,borderRadius:99,width:`${Math.round(f.total/maxFund*100)}%`,transition:"width 0.4s"}}/>
                          </div>
                          <div style={{fontSize:11,color:T.ink3}}>{countLabel(f.giftCount, "gift")} · Last: {displayDate(f.lastDate)}</div>
                        </div>
                      ))}
                    </div>
                  }
                </div>

                <div style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:12,padding:"14px 16px"}}>
                  <div style={{fontSize:12,fontWeight:700,color:T.ink,marginBottom:10}}>Restricted vs Unrestricted</div>
                  {totalGiving>0?(()=>{
                    const rPct=Math.round(restrictedTotal/totalGiving*100);
                    const uPct=100-rPct;
                    return(<>
                      <div style={{height:10,borderRadius:99,overflow:"hidden",display:"flex",marginBottom:8}}>
                        <div style={{width:`${rPct}%`,background:T.gold500,transition:"width 0.4s"}}/>
                        <div style={{flex:1,background:T.greenDk}}/>
                      </div>
                      <div style={{display:"flex",gap:16,fontSize:12}}>
                        <div style={{display:"flex",alignItems:"center",gap:5}}><span style={{width:10,height:10,borderRadius:2,background:T.gold500,display:"inline-block"}}/>Restricted: {fmtFull(restrictedTotal)} ({rPct}%)</div>
                        <div style={{display:"flex",alignItems:"center",gap:5}}><span style={{width:10,height:10,borderRadius:2,background:T.greenDk,display:"inline-block"}}/>Unrestricted: {fmtFull(unrestrictedTotal)} ({uPct}%)</div>
                      </div>
                    </>);
                  })():<div style={{fontSize:12,color:T.ink3,fontStyle:"italic"}}>No giving data yet</div>}
                </div>

                {affinity.length>0&&(
                  <div style={{background:T.gold500+"10",border:"1px solid "+T.gold500+"40",borderRadius:12,padding:"14px 16px"}}>
                    <div style={{fontSize:12,fontWeight:700,color:T.gold500,marginBottom:8}}>Suggested Asks</div>
                    {affinity.slice(0,2).map(f=>(
                      <div key={f.fundId} style={{fontSize:12,color:T.ink,marginBottom:4}}>
                        This donor has given {fmtFull(f.total)} to <strong>{f.fundName}</strong>. Consider them for {f.fundName} campaign appeals.
                      </div>
                    ))}
                    {activeFunds.filter(f=>!affinity.find(a=>a.fundId===f.id)).length>0&&(
                      <div style={{fontSize:12,color:T.ink3,marginTop:8}}>
                        Not yet engaged with: {activeFunds.filter(f=>!affinity.find(a=>a.fundId===f.id)).map(f=>f.name).slice(0,3).join(", ")}
                      </div>
                    )}
                  </div>
                )}
              </>);
            })()}
            {!fundLoading&&!fundAffinity&&<div style={{fontSize:13,color:T.ink3,fontStyle:"italic",textAlign:"center",padding:24}}>Could not load fund data.</div>}
          </div>}

          {/* ── ASKS & PIPELINE (PROFILE-1 header) — everything the old "The
              ask" section held that the Overview's card does not: every
              proposal row, moves and pipeline asks, New ask, the weighted line. */}
          {dpTab==="giving"&&<div className="dp3-gutter" style={{padding:"24px var(--dp-gutter,40px)",display:"flex",flexDirection:"column",gap:16}}>
            {lockMajor(<ProposalsPanel donorId={donor.id} donorName={donor.name} isReadOnly={isReadOnly} canWrite={isTeam} data={propData||null} reload={reloadProps}
              title="Asks & pipeline" addLabel="+ New ask" testid="dp-the-ask"
              after={<div style={{marginTop:12}}>
              {/* Pipeline: Moves & Asks (BUILD-15). Every plan has it (FIX-32). */}
              {lockMajor(
                <div style={{borderTop:"1px solid "+T.bg3,paddingTop:10}}>
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:7}}>
                    <div style={{fontSize:10,fontWeight:800,color:T.ink3}}>Moves and pipeline asks</div>
                    <div style={{display:"flex",gap:6}}>
                      {isTeam&&!isReadOnly&&<button onClick={addToPipeline} disabled={pipelineAdded} style={{background:pipelineAdded?"transparent":T.gold500,border:pipelineAdded?"1px solid "+T.bg3:"none",borderRadius:99,padding:"3px 10px",fontSize:11,fontWeight:700,color:pipelineAdded?T.ink3:T.ink,cursor:pipelineAdded?"default":"pointer"}}>{pipelineAdded?"✓ In pipeline":"+ Add to pipeline"}</button>}
                      {isTeam&&!isReadOnly&&<button onClick={()=>setAskOpen(v=>!v)} style={{background:"transparent",border:"1px solid "+T.bg3,borderRadius:99,padding:"3px 10px",fontSize:11,fontWeight:700,color:T.gold600,cursor:"pointer"}}>{askOpen?"Cancel":"+ Pipeline ask"}</button>}
                    </div>
                  </div>
                  {askOpen&&(
                    <div style={{display:"flex",gap:6,marginBottom:8,flexWrap:"wrap"}}>
                      <input value={askName} onChange={e=>setAskName(e.target.value)} placeholder="What's the ask? (optional)" style={{flex:"1 1 140px",border:"1px solid "+T.bg3,borderRadius:8,padding:"6px 9px",fontSize:12}}/>
                      <input value={askAmt} onChange={e=>setAskAmt(e.target.value)} placeholder="$ target" style={{width:100,border:"1px solid "+T.bg3,borderRadius:8,padding:"6px 9px",fontSize:12}}/>
                      <button onClick={addAsk} style={{background:T.greenDk,border:"none",borderRadius:8,padding:"6px 14px",fontSize:12,fontWeight:700,color:T.white,cursor:"pointer"}}>Save</button>
                    </div>
                  )}
                  {opps.length>0&&(
                    <div style={{display:"flex",flexDirection:"column",gap:5,marginBottom:moves.length?10:0}}>
                      {opps.map(o=>(
                        <div key={o.id} style={{display:"flex",alignItems:"center",gap:8,fontSize:12,padding:"6px 8px",borderRadius:8,background:o.status==="open"?T.gold500+"14":T.bg2}}>
                          <span style={{fontWeight:700,color:T.ink}}>{o.name}</span>
                          <span style={{color:T.gold600,fontWeight:800}}>{fmtFull(o.target_amount)} ask</span>
                          {o.status==="won"&&<span style={{color:T.greenDk,fontWeight:700}}>→ {fmtFull(o.gift_amount||0)} gift</span>}
                          {o.status==="lost"&&<span style={{color:T.terracotta,fontWeight:700}}>lost</span>}
                          <span style={{marginLeft:"auto",display:"flex",gap:6}}>
                            {o.status==="open"&&isTeam&&!isReadOnly&&<>
                              <button onClick={()=>closeAsk(o,"won")} style={{background:T.greenDk,border:"none",borderRadius:6,padding:"2px 9px",fontSize:11,fontWeight:700,color:T.white,cursor:"pointer"}}>Won</button>
                              <button onClick={()=>closeAsk(o,"lost")} style={{background:"transparent",border:"1px solid "+T.bg3,borderRadius:6,padding:"2px 9px",fontSize:11,fontWeight:700,color:T.ink3,cursor:"pointer"}}>Lost</button>
                            </>}
                            {o.status!=="open"&&<span style={{fontSize:10,color:T.ink3}}>{o.status}</span>}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                  {moves.length>0&&(
                    <div style={{display:"flex",flexDirection:"column",gap:4}}>
                      {moves.slice(0,6).map(m=>(
                        <div key={m.id} style={{fontSize:12,color:T.ink2,paddingLeft:10,borderLeft:"2px solid "+T.bg3}}>
                          <div><span style={{fontWeight:700,color:T.ink}}>{cap(m.from_stage)} → {cap(m.to_stage)}</span> <span style={{color:T.ink3}}>· {m.officer_name||"no officer"} · {new Date(m.created_at).toLocaleDateString("en-US",{month:"short",day:"numeric"})}</span></div>
                          {m.description&&<div style={{color:T.ink3,fontSize:11}}>{m.description}</div>}
                        </div>
                      ))}
                    </div>
                  )}
                  {isTeam&&moves.length===0&&opps.length===0&&<div style={{fontSize:11,color:T.ink3}}>No moves logged yet. Move this donor on the Pipeline board.</div>}
                </div>
              )}
              </div>}>
          {/* The stage, and the smart moves that argue for changing it. Both
              are the major-gifts layer, which every plan includes (FIX-32). */}
          {isTeam&&<div data-testid="dp-move-stage" style={{marginBottom:12}}>
            <div style={{marginTop:9,fontSize:11.5,color:T.ink3,lineHeight:1.55}} data-testid="dp-ask-suggest">
              {/* FIX-24 2c: The Ask says the same next step as the rail; the
                  stage's general advice only when there is no open step. */}
              {dpItems.length>0&&dpItems[0].nextStep?.label
                ?`Next step: ${proposalsKnown?stepAgainstProposals(dpItems[0].nextStep.label,openProposals.length).label:dpItems[0].nextStep.label}.`
                :STAGE_ACTION[donor.stage||"cultivate"]}
            </div>
            {(() => {
              // Smart-move suggestions (BUILD-22) — surfaced, never auto-applied.
              // Lapsed is set automatically elsewhere; these are the judgment
              // moves the officer owns, offered one-click. They sit WITH the
              // stage now, because that is the only thing they are about.
              const shown=moveSuggestions.filter(s=>!dismissedSug.includes(s.signal));
              if(!shown.length) return null;
              return <div style={{marginTop:12,display:"flex",flexDirection:"column",gap:8}}>
                {shown.map(s=>(
                  <div key={s.signal} style={{background:T.bg,borderLeft:"3px solid "+T.gold500,borderRadius:8,padding:"10px 12px"}}>
                    <div style={{fontSize:12,color:T.ink,lineHeight:1.5,marginBottom:8}}>{s.reason}</div>
                    <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                      {s.toStage&&!isReadOnly&&(
                        <button onClick={()=>acceptSuggestion(s)} style={{background:T.gold500,border:"none",borderRadius:7,padding:"5px 12px",color:T.ink,fontSize:11,fontWeight:800,cursor:"pointer",fontFamily:"inherit"}}>
                          Accept → {STAGES.find(st=>st.id===s.toStage)?.label||s.toStage}
                        </button>
                      )}
                      <button onClick={()=>dismissSuggestion(s)} style={{background:"transparent",border:"1px solid "+T.bg3,borderRadius:7,padding:"5px 12px",color:T.ink3,fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>Dismiss</button>
                    </div>
                  </div>
                ))}
              </div>;
            })()}
          </div>}
            {/* ENGAGE-1 §3 — the suggested ask, from their own gifts only. */}
            {scores&&scores.suggestedAsk&&<SuggestedAskLine ask={scores.suggestedAsk} style={{margin:"0 0 10px"}}/>}
            </ProposalsPanel>)}

          </div>}
  </>;
}

export { GivingTab };
