// DonorProfile.jsx — one person's record: the profile and the modals it opens.
//
// FIX-1 split: moved VERBATIM out of Donors.jsx. Nothing in it changed.
// Tests read it through readSource("client/src/components/Donors.jsx").
import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useScores, SuggestedAskLine } from "./ScoreWhy";
import { usePublicFiling, PublicFilingLookupModal, ProspectBriefModal } from "./RoomToGive";
import { useCanMajorGifts } from "../lib/majorGifts";
import { VolunteerPanel, AddVolunteerModal } from "./VolunteerPanel";
import { apiFetch, API, getToken } from "../api";
import { useReceipts } from "./profile/ReceiptsAndStatements";
import { usePeoplePicker, peopleNamed } from "../lib/people";
import { rethrowProgrammerError, errorMessage } from "../lib/domainError";
import { stepAgainstProposals } from "../../../shared/nextStepAgree.js";   // FIX-24 2c
import { renderCustomValue } from "../../../shared/customFieldShape";
import { useMailbox } from "./InboxConnect";
import { MeetingCard, AfterMeetingForm, ConversationChips, conversationTitle, MEETING_ACTION } from "./MeetingPanels";
import { ProfileTimeline, useTimelineExtras } from "./ProfileTimeline";
import { AtlasNote } from "./AtlasNote";   // AGENT-5
import { atlasName } from "../lib/atlas";
import { buildTimelineItems, timelineCounts } from "./MeetingPanels";
import { ProfileNumbers } from "./profile/ProfileNumbers";
import { ProfileNextMove } from "./Insights";   // INSIGHTS-1, PROFILE-2
import { RAIL, RAIL_LABEL, RailSection } from "./ProfileRail";
import { T, fmtFull, STAGES, donorScore, moveUrgency, Spin, AIPanel, Modal, firstNameOf } from "./shared";
import { BriefPanel, useDonorProposals } from "./MajorGifts";
import { LogConversationModal, ThreadDismissMenu, PutItOnMyCalendar } from "./LogConversation";
import { ItemMenu, EditedMarker, offerUndo } from "./EditHistory";
import { askConfirm } from "./ConfirmDialog";
import { PlanFollowUpModal } from "./PlanFollowUp";
import { useIsPhone } from "../lib/stickyRail";
import { useFrameHeight } from "./profile/columns";
import { StartCard } from "./profile/StartCard";
import { displayDateShort } from "../../../shared/displayDate";
import { displayName } from "../../../shared/displayName.js";
import { orgTodayCivil, orgTodayPlus, civilDaysAgo } from "../lib/orgToday";   // FIX-14 Part 1 — the org's today, never the UTC day
import OpenPledgeBanner from "./OpenPledgeBanner";   // IMPORT-5: the open pledge up front
import { savePledgeSchedule } from "./gifts/PledgeSchedule";   // GIFTS-1
import { WhyPanel } from "./WhyAnswer";
import { useDonorStatus, useDonorGone, statusTagItems } from "./ProfileStatus";
import VideoThanksModal from "./VideoThanksModal";   // PARITY-1 Part F
import { MicGlyph, openTellSteward } from "./TellStewardOpen";   // VOICE-1
import BeforeYourMeeting, { useBeforeMeeting } from "./BeforeYourMeeting";   // VOICE-3
import { told } from "../lib/stewardTold"; import { useProfileRefresh } from "../lib/profileRefresh";   // COUNTS-1
import { ComingUpMain, OPEN_PROPOSAL_KEYS, PROFILE_TABS, PROPOSAL_STAGE_LABEL, SUGGEST_KINDS, TAB_KIND, lateWords } from "./profile/profileShared";
import { EditDonorModal, FollowUpTaskModal, GiftLinkModal, LogTouchpointModal } from "./profile/modals";
import { DonorPhotoControl } from "./profile/ProfilePhoto";
import { RailFacts } from "./profile/RailFacts";
import { RailPersonCards } from "./profile/RailCards";
import { RailAboutSections } from "./profile/RailAbout";
import { RailJourneys } from "./profile/RailJourneys";
import { ProfileDialogs } from "./profile/ProfileDialogs";
import { ListTabs } from "./profile/ListTabs";
import { RelatedModal } from "./profile/RelatedModal";
import { MergeWithModal } from "./profile/MergeWith";
import { GivingTab } from "./profile/GivingTab";
import { ProfileHeader } from "./profile/ProfileHeader";
import { displayOrgDateShort } from "../lib/orgDay";
// SPLIT-2: the profile's state and handlers live in these hooks, called below in order.
import { useProfileRecord } from "./profile/useProfileRecord";
import { useProfileActions } from "./profile/useProfileActions";
import { useProfilePipeline } from "./profile/useProfilePipeline";
import { useProfileGiving } from "./profile/useProfileGiving";
import { useProfileFiles } from "./profile/useProfileFiles";
import { useProfileRail } from "./profile/useProfileRail";

function DonorProfile({donor,onClose,onStageChange,onLogTouchpoint,aiMap,aiErr={},loadingKey,getAI,isAdmin,onEdit,onDelete,tasks=[],onTaskToggle,onAddTask,orgName="",orgTeam=[],onReassign,onCfSaved,onInteractionAdded,onRecordChanged,isReadOnly=false,onSelectRelatedDonor,onNavigate,initialOpenConversation=false,initialOpenCompose=false,initialOpenBrief=false,initialAddGift=null,org=null}){
  const { gifts, setGifts, giftLoading, setGiftLoading, giftReadErr, setGiftReadErr, giftReadSeq, localInts, setLocalInts, figs, setFigs, rel, setToldNonce, before, scores, canMajorGifts, publicFiling, setPublicFiling, filingLookupOpen, setFilingLookupOpen, prospectBriefOpen, setProspectBriefOpen, status, logMeeting, setLogMeeting, eraseOpen, setEraseOpen, stepEdit, setStepEdit, stepBusy, setStepBusy, pgOpen, setPgOpen, suggestOpen, setSuggestOpen, briefOpen, setBriefOpen, inboxConnected, eraseWord, setEraseWord, eraseBusy, eraseMsg, setEraseMsg, exportPersonData, erasePerson, loadRel, loadRailRef, sequences, dpThread, dpItems, convoOpen, setConvoOpen, editingInt, setEditingInt, planOpen, setPlanOpen, dpItemsLoaded, openProposals, proposalsKnown, propData, reloadProps, loadDpThread, relationships, relLoading, relPickerOpen, setRelPickerOpen, relSearch, setRelSearch, relType, setRelType, relSaving, relErr, setRelErr, linkDonor, unlinkDonor, retypeRelationship, relPickerResults, cfData, setCfData, cfEditing, setCfEditing, cfEditVal, setCfEditVal, cfSaved, setCfSaved, cfShowAll, setCfShowAll, cfError, setCfError, giftCfDefs, giftCfEditStr, donorEvents, localScore, localTier, localConf, localRationale, scoreLoading, recalcScore, showReassign, setShowReassign, reassignId, setReassignId, reassignLoading, setReassignLoading, draftCopied, copyDraftEmail } = useProfileRecord({ donor, onSelectRelatedDonor, onClose, onInteractionAdded, initialOpenConversation, initialOpenCompose, initialOpenBrief, getAI });
  const { handleReassign, showGiftModal, setShowGiftModal, seqOpen, setSeqOpen, seqId, setSeqId, seqLoading, setSeqLoading, seqToast, setSeqToast, dpTab, setDpTab, relatedOpen, setRelatedOpen, mergeOpen, setMergeOpen, mergeKeptRef, tlSearch, setTlSearch, tlSearchOpen, setTlSearchOpen, whyStopOpen, setWhyStopOpen, railRef, noteOpen, setNoteOpen, frameRef, isPhone, dpMoreOpen, setDpMoreOpen, pledges, setPledges, giftsFull, setGiftsFull, giftCountReal, refundRows, tlExtras, tlCounts, railData, railErr, giftEditId, setGiftEditId, giftEditForm, setGiftEditForm, addGiftForm, setAddGiftForm, giftErr, setGiftErr, giftMoreOpen, setGiftMoreOpen, addGiftIdemRef, addPledgeIdemRef, addGiftOpen, setAddGiftOpen, giftSaving, setGiftSaving, plannedGifts, setPlannedGifts, pgForm, setPgForm, addPgOpen, setAddPgOpen, pgSaving, setPgSaving, pledgeForm, setPledgeForm, addPledgeOpen, setAddPledgeOpen, pledgeSaving, setPledgeSaving, pledgeResendBusyId, setPledgeResendBusyId, pledgeResentIds, setPledgeResentIds, fundAffinity, setFundAffinity, fundLoading, setFundLoading, materials, setMaterials, matLoading, setMatLoading, matNote, setMatNote, matUploading, setMatUploading, actMode, stwOpen, setStwOpen, stwForm, setStwForm, stwSaving, setStwSaving, campaigns, setCampaigns, photoUrl, setPhotoUrl, recurringSub, recurResendBusy, recurResendSent, resendRecurringLink, household, setHousehold, softCredit, designations, setDesignations, hhModalOpen, setHhModalOpen, hhPick, setHhPick, hhSearch, setHhSearch, hhPeople, giftPeopleQ, refreshSoftCredit, moves, opps, askOpen, setAskOpen, askName, setAskName, askAmt, setAskAmt, moveSuggestions, dismissedSug, refreshPipeline, acceptSuggestion, dismissSuggestion, addAsk, closeAsk } = useProfileActions({ donor, orgTeam, onReassign, setShowReassign, reassignId, setReassignLoading, initialAddGift, localInts, rel, loadRailRef, onStageChange });
  const { isTeam, lockMajor, pipelineAdded, addToPipeline, hasDesignation, toggleDesignation, createHousehold, removeFromHousehold, rc, receiptsEnabled, receiptBusyId, receiptForGift, sendReceipt, downloadReceiptPdf, showYearEnd, setShowYearEnd, yearEndYear, setYearEndYear, yearEndBusy, yearEndErr, sendYearEndStatement, loadGiftsFull, loadPlannedGifts, loadPledges, loadMaterials, loadFundAffinity, intActions, onIntEdited, saveStewardship, sc, journey, setJourney, journeyBusy, setJourneyBusy, doneFor, setDoneFor, doneNote, setDoneNote, skipFor, setSkipFor, skipWhy, setSkipWhy, journeyList, setJourneyList, addPick, setAddPick, addPreview, setAddPreview, addErr, setAddErr, journeySuggest, setJourneySuggest, journeyMenu, setJourneyMenu, stopAsk, setStopAsk, allJourneys, touchGap } = useProfilePipeline({ donor, setDesignations, refreshSoftCredit, refreshPipeline, designations, setHousehold, setHhModalOpen, hhPick, setHhPick, setHhSearch, household, gifts, initialAddGift, setDpTab, setAddGiftForm, setAddGiftOpen, setGifts, setGiftLoading, setGiftReadErr, giftReadSeq, setLocalInts, setFigs, setGiftsFull, loadRel, setPlannedGifts, setPledges, setMaterials, setMatLoading, setFundAffinity, setFundLoading, localInts, isReadOnly, setEditingInt, onInteractionAdded, setStwOpen, stwForm, setStwForm, setStwSaving });
  const { pickJourney, confirmAddToJourney, saveGiftEdit, deleteGift, addGift, addPledge, setPledgeStatus, deletePledge, pledgeEdit, setPledgeEdit, savePledgeEdit, resendPledgeReminder, addPlannedGift, deletePlannedGift, uploadMaterial } = useProfileGiving({ donor, journey, setJourneyList, setJourneySuggest, setAddPick, setAddPreview, setAddErr, onInteractionAdded, setJourney, journeyBusy, setJourneyBusy, addPick, setGiftLoading, loadGiftsFull, loadPlannedGifts, loadPledges, dpTab, fundAffinity, loadMaterials, loadFundAffinity, setCampaigns, giftCfDefs, giftsFull, setGiftEditId, giftEditForm, setGiftSaving, receiptForGift, addGiftForm, setAddGiftForm, setGiftErr, addGiftIdemRef, setAddGiftOpen, refreshSoftCredit, addPledgeIdemRef, pledgeForm, setPledgeForm, setAddPledgeOpen, setPledgeSaving, setPledgeResendBusyId, setPledgeResentIds, pgForm, setPgForm, setAddPgOpen, setPgSaving, matNote, setMatNote, setMatUploading });
  const { viewMaterial, deleteMaterial, impactPdfLoading, videoThanksOpen, setVideoThanksOpen, volOpen, setVolOpen, makeVolOpen, setMakeVolOpen, setMadeVol, isVolunteer, yourPageMsg, sendYourPageLink, downloadImpactSummary, exportGiftsCSV, saveStep, deleteStep, openForNextMove, yearDrill, setYearDrill, snoozing, snoozeErr, snoozeThread, contactPerson, headName, callName, noGifts, headTags, aboutStatusTags } = useProfileFiles({ loadMaterials, donor, onInteractionAdded, setToldNonce, loadRel, reloadProps, loadDpThread, loadGiftsFull, giftCfDefs, giftsFull, stepEdit, setStepEdit, setStepBusy, localInts, rel, dpTab, setDpTab, pledges, actMode, recurringSub, dpItems, openProposals, aiMap, getAI, dpItemsLoaded, gifts, giftLoading, giftReadErr, figs, status, railData });
  const { railNextNode, railPledgeNode, nothingLogged, nextMoveNode } = useProfileRail({ donor, isReadOnly, rel, setLogMeeting, stepEdit, setStepEdit, stepBusy, dpThread, dpItems, setConvoOpen, setPlanOpen, openProposals, proposalsKnown, loadDpThread, saveStep, deleteStep, snoozing, snoozeErr, snoozeThread, callName, setDpTab, pledges, setAddGiftForm, setAddGiftOpen, tasks, gifts, giftLoading, giftReadErr, giftsFull, tlCounts, getAI, org, setSuggestOpen, isTeam, openForNextMove });

  return(
    <div className="fade-in page-takeover dp3-frame" data-testid="donor-profile" ref={frameRef} style={{position:"relative",background:T.bg,display:"flex",flexDirection:"column"}}>
      {/* PROFILE-2 Part 1: the profile is the page, not a fixed panel over it.
          HOTFIX-1 made it position:fixed with overflow:hidden, and once
          INSIGHTS-1 and IMPORT-5 grew the header to 540px nothing over it
          scrolled at all; the window scrolls now, and only the rail sticks. */}
      {showGiftModal&&<GiftLinkModal donor={donor} orgName={orgName} onClose={()=>setShowGiftModal(false)}/>}
      {/* SHELVED — voice capture works but unproven adoption assumption, revisit later.
          Code intact, re-enable by uncommenting.
      {showVoiceMemo&&<VoiceMemoModal donor={donor} onClose={()=>setShowVoiceMemo(false)} onSaved={()=>{setShowVoiceMemo(false);if(onInteractionAdded)onInteractionAdded();}}/>}
      */}
      <div className="donor-profile-body dp2-body" data-rail-ground={RAIL.bg} style={{flex:1,display:"grid",gridTemplateColumns:"minmax(0,1fr) var(--rail-w,360px)",backgroundImage:`linear-gradient(to right, ${T.bg} calc(100% - var(--rail-w,360px)), ${RAIL.bg} calc(100% - var(--rail-w,360px)))`}}>
        {/* LEFT — the main column. HOTFIX-1: its ground is named here rather
            than inherited, because the rail beside it is defined as being on a
            CONTRASTING ground and a contrast between two inherited values is
            not a contrast anybody can check. See docs/decisions/design-system.md. */}
        <div data-testid="dp-main-column" className="dp3-main" tabIndex={isPhone?undefined:0} aria-label={isPhone?undefined:"Record"} style={{background:T.bg,minWidth:0,display:"flex",flexDirection:"column"}}>
          {/* PROFILE-2 · THE WHITE BAND: the header, the four numbers, then the tabs
              as its bottom edge. It sits in the main column, so the rail beside it
              runs from the top of the profile. */}
          {/* PROFILE-3 · THE PIN: the header band, the numbers and the tabs stay at the
              top of the main column while the timeline scrolls under them. */}
          <div className="dp3-pin" data-testid="dp-pin" style={{position:"sticky",top:0,zIndex:6,background:T.white,borderBottom:"1px solid "+T.bg3}}>
          <div data-testid="dp-band" className="dp3-band" style={{background:T.white,padding:"0 var(--dp-gutter,40px)"}}>
      {/* POLISH-1 — ONE HEADER, PHOTO OR NOT. Back is its own small line;
            below it the mark (photo or initials, one size) sits top-aligned with
            the name, and everything about the person is one column beside it.
            Centred rows let the mark and Back float to the middle of a column
            whose height changed with the person, so a photo moved the name. */}
        {/* PROFILE-2 · THE HEADER, TWO ROWS. Row one: the face (72px), the name in
            the display serif, and the actions on the right (Log a call is the one
            emerald). Row two: the top tag under the face and the second under the
            name: at most two tags here, the rest are in About on the rail. The
            roles line, closeness, drift and recurring sentences moved to the rail
            (About and Engagement), so the header is the person and what to do. */}
        <ProfileHeader {...{onRecordChanged,setMergeOpen,setRelatedOpen,setRelPickerOpen,aiErr,aiMap,briefOpen,canMajorGifts,convoOpen,copyDraftEmail,donor,downloadImpactSummary,dpMoreOpen,dpThread,draftCopied,editingInt,exportPersonData,filingLookupOpen,getAI,headName,headTags,impactPdfLoading,isAdmin,isReadOnly,isTeam,isVolunteer,loadDpThread,loadGiftsFull,loadRel,loadingKey,lockMajor,makeVolOpen,noteOpen,onAddTask,onClose,onDelete,onEdit,onIntEdited,onInteractionAdded,onNavigate,openForNextMove,org,photoUrl,planOpen,prospectBriefOpen,sendYourPageLink,setBriefOpen,setConvoOpen,setDpMoreOpen,setDpTab,setEditingInt,setEraseMsg,setEraseOpen,setEraseWord,setFilingLookupOpen,setLocalInts,setMadeVol,setMakeVolOpen,setNoteOpen,setPhotoUrl,setPlanOpen,setProspectBriefOpen,setPublicFiling,setShowGiftModal,setSuggestOpen,setVideoThanksOpen,setVolOpen,setWhyStopOpen,suggestOpen,videoThanksOpen,volOpen,whyStopOpen,yourPageMsg,setAddPledgeOpen}}/>
        {(figs||donor.figures)&&<ProfileNumbers figures={figs||donor.figures}/>}
          </div>
          {/* ── PROFILE-1 (header) · ONE ROW OF TABS ──────────────────────
              Directly under the header, left-aligned. It replaces the old six
              tabs and the "Everything with" chips; it scrolls sideways at 390
              (and only it does). Each count is the length of the list it
              opens. */}
          {isPhone&&<div className="dp2-phone-top" data-testid="dp-phone-top" style={{display:"flex",flexDirection:"column",gap:14,padding:"16px 16px 18px",background:T.bg}}>
            {nextMoveNode}
            <div style={{background:RAIL.bg,color:RAIL.text,borderRadius:14,padding:"16px 16px 4px"}}>{railNextNode}{railPledgeNode}</div>
          </div>}
          <div className="dp-tabs-row" style={{display:"flex",alignItems:"stretch",background:T.white,padding:"0 var(--dp-gutter,40px)"}}>
          <div className="dp-tabs" role="tablist" aria-label="Profile" data-testid="dp-tabs" style={{display:"flex",flexWrap:"nowrap",overflowX:"auto",flex:1,minWidth:0,scrollbarWidth:"none",gap:24}}>
            {PROFILE_TABS.map(([id,label])=>{
              // PROFILE-2: Giving counts gifts AND pledges (a $50,000 pledge read "Gifts & pledges 0").
              const n=id==="giving"?(giftLoading||giftReadErr?null:giftCountReal+pledges.length)
                :id==="conversations"?(tlCounts.conversation||0):id==="emails"?(tlCounts.email||0):id==="tasks"?(tlCounts.task||0)
                :id==="notes"?(tlCounts.note||0):id==="files"?(tlCounts.file||0):null;
              return <button key={id} role="tab" data-tab={id} aria-selected={dpTab===id} onClick={()=>setDpTab(id)} style={{background:"none",border:"none",borderBottom:"2px solid "+(dpTab===id?T.greenDk:"transparent"),padding:"12px 0 10px",color:dpTab===id?T.ink:T.ink3,fontSize:13.5,fontWeight:dpTab===id?700:500,cursor:"pointer",whiteSpace:"nowrap",flexShrink:0,fontFamily:"inherit",minHeight:44,display:"inline-flex",alignItems:"center"}}>
                {label}
                {/* PROFILE-3: a count only when there is something to count; never "0". */}
                {n>0&&<span data-tab-count={id} style={{marginLeft:6,background:T.bg2,borderRadius:99,padding:"1px 7px",fontSize:10.5,fontWeight:700,color:T.ink3}}>{n}</span>}
              </button>;
            })}
          </div>
          {/* PROFILE-2: search the timeline, live. */}
          <div style={{display:"flex",alignItems:"center",gap:6,flexShrink:0,paddingLeft:8}}>
            {tlSearchOpen&&<input autoFocus value={tlSearch} onChange={e=>{setTlSearch(e.target.value);if(!TAB_KIND[dpTab]&&dpTab!=="activity")setDpTab("activity");}} placeholder="Search this record" aria-label="Search this record" data-testid="dp-tl-search"
              onKeyDown={e=>{if(e.key==="Escape"){setTlSearch("");setTlSearchOpen(false);}}} style={{width:180,padding:"7px 10px",fontSize:13,borderRadius:8}}/>}
            <button type="button" data-testid="dp-tl-search-btn" aria-label={tlSearchOpen?"Close search":"Search this record"} onClick={()=>{if(tlSearchOpen){setTlSearch("");setTlSearchOpen(false);}else setTlSearchOpen(true);}}
              style={{background:"none",border:"none",cursor:"pointer",padding:8,minWidth:40,minHeight:40,color:T.ink3,fontSize:17,lineHeight:1}}>{tlSearchOpen?"×":<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>}</button>
          </div>
          </div>
          </div>{/* /dp3-pin */}

          {/* ── OVERVIEW (PROFILE-1 header) ──────────────────────────────
              Top to bottom: the next meeting, How did it go?, Lately, the ask,
              Highlights, then About. Everything else that lived here has a
              tab of its own now (docs/profile-1/inventory.md says where). */}
          {/* ── PROFILE-2 · ACTIVITY: the next move, Coming up, then everything
              that happened, by month. The other tabs filter the same timeline. */}
          {dpTab==="activity"&&<div className="dp2-cream" data-testid="dp-tab-activity" style={{padding:"24px var(--dp-gutter,40px) 40px",display:"flex",flexDirection:"column",gap:16}}>
            {nothingLogged&&<StartCard name={callName} isReadOnly={isReadOnly} onCall={()=>setConvoOpen(true)} onNote={()=>setNoteOpen(true)} onGift={()=>{setDpTab("giving");setAddGiftOpen(true);}}/>}
            {!isPhone&&nextMoveNode}
            <ComingUpMain tasks={tasks} meetings={(rel&&rel.upcoming)||[]} onTaskToggle={onTaskToggle} isReadOnly={isReadOnly} onAddTask={onAddTask}/>
            {rel?.nextMeeting&&<MeetingCard meeting={rel.nextMeeting} donor={donor} before={before&&before.meeting.id===rel.nextMeeting.id?before:null} onReload={()=>{loadRel();loadDpThread();}}/>}
            {/* VOICE-3 · a meeting logged ahead by hand has no calendar card, so the brief stands alone. */}
            {before&&!(rel?.nextMeeting&&before.meeting.id===rel.nextMeeting.id)&&<BeforeYourMeeting data={before}/>}
            {/* FIX-33 · once the meeting time has passed, the profile asks. */}
            {(()=>{
              const due=(rel?.past||[]).find(m=>!m.loggedAt&&m.startsAt&&Date.now()-new Date(m.endsAt||m.startsAt).getTime()<7*864e5);
              if(!due||isReadOnly)return null;
              return <section data-testid="dp-how-did-it-go" style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:12,padding:"14px 18px",display:"flex",gap:12,alignItems:"center",flexWrap:"wrap",justifyContent:"space-between"}}>
                <div style={{fontSize:14,fontWeight:700,color:T.ink}}>How did it go? {due.title}, {displayOrgDateShort(due.date||due.startsAt,new Date())}</div>
                <button type="button" onClick={()=>setLogMeeting(due)} style={{background:T.white,border:"1.5px solid "+T.ink,borderRadius:9,padding:"8px 14px",color:T.ink,fontSize:13,fontWeight:700,cursor:"pointer"}}>Write it down</button>
              </section>;
            })()}
            {/* FIX-14 Part 1 — what Steward heard in the newest conversation
                logged by hand: a next step with its date, the spouse named,
                a planned gift mentioned. Each is a chip; nothing changes until
                a person presses one. */}
            {(()=>{
              const ints=localInts??donor.interactions??[];
              const handLogged=ints.filter(i=>{
                if(!["meeting","call","note","ask","email"].includes(i.type)||!String(i.note||"").trim())return false;
                let m={};try{m=typeof i.metadata==="string"?JSON.parse(i.metadata||"{}"):(i.metadata||{});}catch{}
                if(m.provider||m.message_id||m.gmail_message_id||m.calendar_event_id||m.via==="inbound_email")return false;
                const ago=civilDaysAgo(String(i.date||"").slice(0,10));
                return ago!=null&&ago<=30&&ago>=-90;
              }).sort((a,b)=>String(b.date).localeCompare(String(a.date))||String(b.created_at||"").localeCompare(String(a.created_at||"")));
              const last=handLogged[0];
              if(!last||!last.id||isReadOnly)return null;
              return <section data-testid="dp-heard" style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:12,padding:"14px 18px",display:"flex",flexDirection:"column",gap:6}}>
                <div style={{fontSize:13,fontWeight:700,color:T.ink}}>From your note: {conversationTitle(last)}, {displayDateShort(last.date,orgTodayCivil())}</div>
                <ConversationChips interactionId={last.id} onChanged={()=>{loadRel();loadGiftsFull();loadDpThread();refreshSoftCredit();
                  apiFetch(`/donors/${donor.id}/designations`).then(d=>setDesignations(Array.isArray(d)?d:[])).catch(()=>{});
                  onInteractionAdded&&onInteractionAdded();}}/>
              </section>;
            })()}
            {/* LATELY — the last three things that happened, of any kind, each
                opening its record; "See everything" opens Conversations. */}
            {/* AGENT-5: what Atlas did for this person, in order, with Undo. */}
            <AtlasNote place="person" id={donor.id} onNavigate={onNavigate}/>
            {rel&&!nothingLogged&&<ProfileTimeline byMonth noChips search={tlSearch} heading="Everything, by month" extras={tlExtras} canWrite={!isReadOnly} inboxConnected={inboxConnected} rel={rel} donor={donor} gifts={giftsFull} pledges={pledges} interactions={localInts??donor.interactions??[]} onLog={m=>setLogMeeting(m)} renderActions={intActions} onChanged={()=>{loadRel();loadGiftsFull();loadDpThread();onInteractionAdded&&onInteractionAdded();}}/>}
            {logMeeting&&<Modal onClose={()=>setLogMeeting(null)} width={560} title="">
              <AfterMeetingForm meeting={{...logMeeting,people:[{id:donor.id,name:donor.name}]}} onDone={()=>{setLogMeeting(null);loadRel();loadGiftsFull();loadDpThread();onInteractionAdded&&onInteractionAdded();}}/>
            </Modal>}
          </div>}

          <GivingTab {...{rc,acceptSuggestion,addAsk,addGift,addGiftForm,addGiftOpen,addPgOpen,addPlannedGift,addPledge,addPledgeOpen,addToPipeline,askAmt,askName,askOpen,campaigns,closeAsk,deleteGift,deletePlannedGift,deletePledge,dismissSuggestion,dismissedSug,donor,downloadReceiptPdf,dpItems,dpTab,exportGiftsCSV,figs,fundAffinity,fundLoading,giftCfDefs,giftCfEditStr,giftCountReal,giftEditForm,giftEditId,giftErr,giftLoading,giftMoreOpen,giftPeopleQ,giftReadErr,giftSaving,gifts,giftsFull,hasDesignation,household,isAdmin,isReadOnly,isTeam,loadGiftsFull,lockMajor,moveSuggestions,moves,onNavigate,onStageChange,openProposals,opps,pgForm,pgOpen,pgSaving,pipelineAdded,plannedGifts,pledgeEdit,pledgeForm,pledgeResendBusyId,pledgeResentIds,pledgeSaving,pledges,propData,proposalsKnown,receiptBusyId,receiptForGift,receiptsEnabled,recurResendBusy,recurResendSent,recurringSub,refundRows,reloadProps,resendPledgeReminder,resendRecurringLink,saveGiftEdit,savePledgeEdit,sc,scores,sendReceipt,sendYearEndStatement,seqId,seqLoading,seqOpen,seqToast,sequences,setAddGiftForm,setAddGiftOpen,setAddPgOpen,setAddPledgeOpen,setAskAmt,setAskName,setAskOpen,setDpTab,setGiftEditForm,setGiftEditId,setGiftLoading,setGiftMoreOpen,setHhModalOpen,setPgForm,setPgOpen,setPledgeEdit,setPledgeForm,setPledgeStatus,setRelatedOpen,setSeqId,setSeqLoading,setSeqOpen,setSeqToast,setShowYearEnd,setYearDrill,setYearEndYear,showYearEnd,softCredit,status,toggleDesignation,yearDrill,yearEndBusy,yearEndErr,yearEndYear}}/>

          {mergeOpen&&<MergeWithModal donor={donor} onMerged={id=>{mergeKeptRef.current=id;}}
            onClose={()=>{setMergeOpen(false);const k=mergeKeptRef.current;mergeKeptRef.current=null;if(k&&onSelectRelatedDonor)onSelectRelatedDonor(k);}}/>}
          <RelatedModal {...{donor,household,isReadOnly,linkDonor,onSelectRelatedDonor,refreshSoftCredit,relErr,relLoading,relPickerOpen,relPickerResults,relSaving,relSearch,relType,relatedOpen,relationships,removeFromHousehold,retypeRelationship,setHhModalOpen,setRelErr,setRelPickerOpen,setRelSearch,setRelType,setRelatedOpen,softCredit,unlinkDonor}}/>

          <ListTabs {...{deleteMaterial,donor,dpTab,giftsFull,inboxConnected,intActions,isReadOnly,loadDpThread,loadGiftsFull,loadRel,localInts,matLoading,matUploading,materials,onInteractionAdded,onLogTouchpoint,onNavigate,rel,saveStewardship,setLogMeeting,setStwForm,setStwOpen,stwForm,stwOpen,stwSaving,tlExtras,tlSearch,uploadMaterial,viewMaterial}}/>
          <ProfileDialogs {...{createHousehold,donor,eraseBusy,eraseMsg,eraseOpen,erasePerson,eraseWord,hhModalOpen,hhPeople,hhPick,hhSearch,isAdmin,setEraseOpen,setEraseWord,setHhModalOpen,setHhPick,setHhSearch}}/>
        </div>

        {/* ── THE RAIL (PROFILE-1) ────────────────────────────────────────
            Ink, with light text, framing the cream main column the way the
            sidebar frames it on the left. The rail is never removed and its
            ground always contrasts with the column (CLAUDE.md's never-crossed
            list, pinned by tests/hotfix1-profile.test.js at 1440).

            What lives here is what is true of the person all the time — who
            owns them, where they are, how to reach them, and the tools —
            which is why it can sit outside whichever tab is open. Emerald is
            still the one action colour (the active stage); brass is still
            emphasis (the quick actions). Nothing new enters the palette: the
            rail's greys are cream at reduced opacity (T.sage400/600), which
            is the design system's own answer for secondary text on ink. */}
        <div data-testid="dp-right-rail" ref={railRef} className="dp-rail-sticky dp3-rail" tabIndex={isPhone?undefined:0} aria-label={isPhone?undefined:"About this person"} style={{minHeight:"calc(100vh - 52px)",boxSizing:"border-box",padding:"24px 22px 48px",display:"flex",flexDirection:"column",background:RAIL.bg,color:RAIL.text,borderLeft:"1px solid "+RAIL.bg}}>
          {/* INT-BUILD-1 Part 3, FIX-14 Part 3 — the ONE next step (with Edit and
              Delete), then Rhythm: past touches and planned steps on one strip,
              and the journey chosen or changed in the same panel. */}
          {(()=>{
            // WHY-1 Part 7 — JOURNEY, NOT RHYTHM. The twelve-month touch
            // strip is gone from the profile (the timeline is where touch
            // history lives); this panel is the plan for the next touches.
            const rhythmNode=<div data-testid="dp-rail-journey-panel" style={{display:"flex",flexDirection:"column",gap:12}}>
              <RailJourneys {...{addErr,addPick,addPreview,allJourneys,confirmAddToJourney,doneFor,doneNote,donor,isReadOnly,journey,journeyBusy,journeyList,journeyMenu,journeySuggest,onInteractionAdded,onNavigate,pickJourney,setAddErr,setDoneFor,setDoneNote,setJourney,setJourneyBusy,setJourneyMenu,setSkipFor,setSkipWhy,setStopAsk,skipFor,skipWhy,stopAsk,touchGap}}/>

            </div>;
            // PROFILE-1 (header) — THE RAIL'S ORDER. Next step and the scores;
            // Giving rhythm, Recurring, Thank-yous, Coming up; This year and
            // Book a visit; Contact; Relationship owner; Journey;
            // Volunteering; Connected. Then the folded cards as before.
            const R=railData||{};
            return <>
              {!isPhone&&<div style={{paddingBottom:16}}>{railNextNode}</div>}
              {railErr&&<div data-testid="dp-rail-error" style={{fontSize:12.5,color:RAIL.dim,padding:"8px 0"}}>Some of this person's facts could not be loaded just now.</div>}
        {!isPhone&&railPledgeNode}
              <RailSection title="Journeys" testid="dp-rail-journeys">{rhythmNode}</RailSection>
              <RailAboutSections {...{setRelPickerOpen,R,aboutStatusTags,canMajorGifts,contactPerson,donor,handleReassign,household,isAdmin,isReadOnly,isTeam,onSelectRelatedDonor,orgTeam,publicFiling,railData,reassignId,reassignLoading,relationships,scores,setConvoOpen,setReassignId,setRelatedOpen,setShowReassign,showReassign,status,onEdit,noGifts,nothingLogged}}/>
          <RailPersonCards {...{R,donor,donorEvents,inboxConnected,isReadOnly,loadRel,onNavigate,rel,nothingLogged}}/>


            </>;
          })()}

          <RailFacts {...{nothingLogged,cfData,cfEditVal,cfEditing,cfError,cfSaved,cfShowAll,donor,isReadOnly,isTeam,localConf,localRationale,localScore,localTier,lockMajor,onCfSaved,recalcScore,scoreLoading,setCfData,setCfEditVal,setCfEditing,setCfError,setCfSaved,setCfShowAll}}/>

        </div>
      </div>
    </div>
  );
}

export { DonorProfile, EditDonorModal, FollowUpTaskModal, LogTouchpointModal };
