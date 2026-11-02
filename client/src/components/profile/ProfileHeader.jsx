// components/profile/ProfileHeader.jsx (PROFILE-3): part of the donor profile, cut from DonorProfile.jsx.
import { AIPanel, Modal, Spin, T } from "../shared";
import { DonorPhotoControl } from "./ProfilePhoto";
import { ACT, ActIcon, ContactLine } from "./headerParts";
import { MicGlyph, openTellSteward } from "../TellStewardOpen";
import { atlasName } from "../../lib/atlas";
import { SUGGEST_KINDS } from "./profileShared";
import { AddVolunteerModal, VolunteerPanel } from "../VolunteerPanel";
import VideoThanksModal from "../VideoThanksModal";
import { ProspectBriefModal, PublicFilingLookupModal } from "../RoomToGive";
import { WhyPanel } from "../WhyAnswer";
import { LogConversationModal } from "../LogConversation";
import { LogTouchpointModal } from "./modals";
import { BriefPanel } from "../MajorGifts";
import { PlanFollowUpModal } from "../PlanFollowUp";

function ProfileHeader({aiErr,aiMap,briefOpen,canMajorGifts,convoOpen,copyDraftEmail,donor,downloadImpactSummary,dpMoreOpen,dpThread,draftCopied,editingInt,exportPersonData,filingLookupOpen,getAI,headName,headTags,impactPdfLoading,isAdmin,isReadOnly,isTeam,isVolunteer,loadDpThread,loadGiftsFull,loadRel,loadingKey,lockMajor,makeVolOpen,noteOpen,onAddTask,onClose,onDelete,onEdit,onIntEdited,onInteractionAdded,onNavigate,openForNextMove,org,photoUrl,planOpen,prospectBriefOpen,sendYourPageLink,setBriefOpen,setConvoOpen,setDpMoreOpen,setDpTab,setEditingInt,setEraseMsg,setEraseOpen,setEraseWord,setFilingLookupOpen,setLocalInts,setMadeVol,setMakeVolOpen,setNoteOpen,setPhotoUrl,setPlanOpen,setProspectBriefOpen,setPublicFiling,setShowGiftModal,setSuggestOpen,setVideoThanksOpen,setVolOpen,setWhyStopOpen,suggestOpen,videoThanksOpen,volOpen,whyStopOpen,yourPageMsg}){
  return <>
        <div className="donor-profile-header dp2-head dp3-head" data-testid="dp-head" style={{padding:"16px 0 0",display:"grid",gridTemplateColumns:"72px minmax(0,1fr) auto",columnGap:20,rowGap:0,alignItems:"start"}}>
          <div className="dph-backrow" style={{gridColumn:"1 / -1",gridRow:1,marginBottom:16}}>
            <button onClick={onClose} className="dph-back" aria-label="Back to donors" style={{background:"none",border:"none",padding:"6px 0",color:T.ink3,fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit",minHeight:32}}>← Donors</button>
          </div>
          <div className="dph-avatar" data-testid="dp-avatar" style={{gridColumn:1,gridRow:"2 / span 3",alignSelf:"start"}}>
            <DonorPhotoControl donor={donor} isReadOnly={isReadOnly} photoUrl={photoUrl} onChanged={setPhotoUrl} size={72}/>
          </div>
          <div className="dph-identity" data-testid="dp-identity" style={{gridColumn:2,gridRow:2,minWidth:0,alignSelf:"center",minHeight:44,display:"flex",alignItems:"center"}}>   {/* PROFILE-3: the name's row is the actions' row */}
            <h1 className="dph-name" data-testid="dp-name" data-plain-on-purpose="the page is this person" style={{margin:0,fontSize:38,fontWeight:400,color:T.ink,letterSpacing:"-0.015em",
              fontFamily:"'DM Serif Display',Georgia,serif",lineHeight:1.08,overflowWrap:"break-word"}}>{headName||"\u00a0"}</h1>
          </div>
          {/* PROFILE-3: the name, the tags and the contact line start on one edge. */}
          {headTags.length>0&&<div className="dph-tags" data-testid="dp-head-tags" style={{gridColumn:"2 / -1",gridRow:3,display:"flex",gap:8,flexWrap:"wrap",alignItems:"center",marginTop:8}}>
            {headTags[0]&&<div className="dph-tag1" data-testid="dp-head-tag-1" style={{whiteSpace:"nowrap"}}>{headTags[0]}</div>}
            {headTags[1]&&<div className="dph-tag2" data-testid="dp-head-tag-2" style={{whiteSpace:"nowrap"}}>{headTags[1]}</div>}
          </div>}
          <ContactLine donor={donor} isReadOnly={isReadOnly} onAdd={onEdit}/>
          {/* PROFILE-1 — THREE BUTTONS AND A MENU, AT EVERY WIDTH. The header
              carried five actions across the top of the record, which is four
              more than anybody presses in a row; at 390 the overflow already
              existed and at 1440 it did not, so the same screen taught two
              different habits. Now: Log a conversation (the one emerald), Plan
              a follow-up when there is no open thread, and More — a real
              BUTTON with a menu, never a link, because it does something on
              this page rather than going somewhere. Everything that was in the
              row is in the menu, so nothing was dropped. */}
          <div className="dph-actions" data-testid="dp-actions" style={{gridColumn:3,gridRow:2,alignSelf:"center",display:"flex",gap:8,flexShrink:0,alignItems:"center",position:"relative",flexWrap:"nowrap",justifyContent:"flex-end"}}>
            {/* BUILD-88a A.4 — ONE EMERALD PRIMARY. The header carried two filled
                buttons in two different colours (a brass "Log a conversation" and
                an emerald "Request Gift"), so nothing on it was the obvious thing
                to press. Emerald means "this is the button" and exactly one thing
                may mean that; the rest are outlines. */}
            <button onClick={()=>setConvoOpen(true)} disabled={isReadOnly} className="dph-primary" data-testid="dp-primary" style={{whiteSpace:"nowrap",minHeight:40,boxSizing:"border-box",background:T.greenDk,border:"none",borderRadius:9,padding:"0 16px",color:T.white,fontSize:13,fontWeight:800,cursor:isReadOnly?"not-allowed":"pointer",opacity:isReadOnly?0.5:1}}>
              Log a call
            </button>
            {/* BUILD-85 — plan forward. Offered only when there is NO open thread,
                because one open step per donor is the model and a second button
                that can only 409 is a button that teaches people to distrust
                buttons. */}
            {/* PROFILE-2 — Note, Email and Task beside Log a call. Email opens her own
              mail program to their address (Steward sends nothing); it is not
              offered when there is no address, or Deceased or Do not contact is set. */}
          <button type="button" onClick={()=>setNoteOpen(true)} disabled={isReadOnly} data-testid="dp-note" className="dph-act" aria-label="Add a note" title="Add a note" style={ACT}><ActIcon kind="note"/><span className="dph-act-label">Note</span></button>
          {donor.email&&!donor.deceased&&!donor.doNotContact&&<a href={`mailto:${donor.email}`} data-testid="dp-email" className="dph-act" aria-label="Email them" title="Email them" style={ACT}><ActIcon kind="mail"/><span className="dph-act-label">Email</span></a>}
          {onAddTask&&<button type="button" onClick={onAddTask} disabled={isReadOnly} data-testid="dp-task" className="dph-act" aria-label="Add a task" title="Add a task" style={ACT}><ActIcon kind="task"/><span className="dph-act-label">Task</span></button>}
            {/* VOICE-1 — Tell Steward about this person: the memo is about them by default. */}
            <button onClick={()=>openTellSteward(donor)} disabled={isReadOnly} data-testid="dp-tell-steward" className="dph-act dph-atlas" aria-label={`Tell ${atlasName()} about ${donor.name}`} title={atlasName()}
              style={{background:T.white,border:"1px solid "+T.greenDk,borderRadius:9,padding:"0 14px",minHeight:40,boxSizing:"border-box",color:T.greenDk,fontSize:13,fontWeight:700,cursor:isReadOnly?"not-allowed":"pointer",opacity:isReadOnly?0.5:1,display:"inline-flex",alignItems:"center",gap:7,whiteSpace:"nowrap"}}>
              <MicGlyph size={15}/><span className="dph-act-label">{atlasName()}</span>
            </button>
            {/* SHELVED — voice capture works but unproven adoption assumption, revisit later.
                Code intact, re-enable by uncommenting.
            <button onClick={()=>setShowVoiceMemo(true)} style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"7px 14px",color:T.ink3,fontSize:13,cursor:"pointer"}}>
              Voice memo
            </button>
            */}
            <button onClick={()=>setDpMoreOpen(o=>!o)} data-testid="dp-more" aria-haspopup="menu" aria-expanded={dpMoreOpen}
              style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:9,padding:"0 14px",minHeight:40,boxSizing:"border-box",color:T.ink,fontSize:13,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap"}}>More ▾</button>
            {dpMoreOpen&&(
              <div className="dph-more-menu" role="menu" data-testid="dp-more-menu" style={{position:"absolute",top:"calc(100% + 6px)",right:0,zIndex:60,background:T.white,border:"1px solid "+T.bg3,borderRadius:10,boxShadow:"0 12px 32px rgba(15,26,18,0.18)",minWidth:210,overflow:"hidden",padding:6}}>
                {/* FIX-55 item 6: Request a gift needs card payments set up and
                    Brief me needs AI; each is hidden when its service is not on,
                    where they answered "Stripe not configured" / "brief_unavailable". */}
                {[...(!dpThread?[["Plan a follow-up",()=>setPlanOpen(true),isReadOnly,"dp-plan-followup"]]:[]),
                ...(org?.capabilities?.stripe?[["Request a gift",()=>setShowGiftModal(true),false]]:[]),
                  // FIX-14 Part 3 — the quick actions, Suggested and Brief me live here now.
                  ...(isTeam?[["Draft the next move",()=>{setSuggestOpen(true);getAI(donor,"nextmove",openForNextMove);},false],
                    ["Draft outreach",()=>{setSuggestOpen(true);getAI(donor,"outreach");},false],
                    ["Draft an email",()=>{setSuggestOpen(true);getAI(donor,"email");},false],
                    ["Call script",()=>{setSuggestOpen(true);getAI(donor,"callscript");},false]]:[]),
                  [`Suggested${SUGGEST_KINDS.filter(t=>aiMap[`${donor.id}_${t}`]||aiErr[`${donor.id}_${t}`]).length?` (${SUGGEST_KINDS.filter(t=>aiMap[`${donor.id}_${t}`]||aiErr[`${donor.id}_${t}`]).length})`:""}`,()=>setSuggestOpen(true),false],
                  ...(org?.capabilities?.ai?[["Brief me",()=>setBriefOpen(true),false]]:[]),
                  // PROSPECT-1 — a one-page prospect brief from the record, the
                  // screening results and the public filing; saved to their files.
                  ...(canMajorGifts?[["Write a prospect brief",()=>setProspectBriefOpen(true),isReadOnly,"dp-prospect-brief"]]:[]),
                  ...(canMajorGifts&&donor.kind==="organisation"?[["Look up public filing",()=>setFilingLookupOpen(true),isReadOnly,"dp-filing-lookup"]]:[]),
                  // PARITY-1 Part F: a short video from her; saving drafts the email, she sends it.
                  ["Record a video thank-you",()=>setVideoThanksOpen(true),isReadOnly||!donor.email||!!donor.deceased||!!donor.doNotContact,"dp-video-thanks"],
                  // PARITY-3 Part 1, FIX-24 Part 1: the volunteer record; for
                  // somebody who is not a volunteer yet, the form that makes them one.
                  isVolunteer?["Volunteer record",()=>setVolOpen(true),false,"dp-volunteering"]
                    :["Make a volunteer",()=>setMakeVolOpen(true),isReadOnly,"dp-make-volunteer"],
                  // WHY-1 — only for a lapsed donor: the facts on their record
                  // before they stopped, and the one touch that fits.
                  ...(donor.stage==="lapsed"?[["Why did they stop?",()=>setWhyStopOpen(true),false,"dp-why-stop"]]:[]),
                  ...(onAddTask?[["Add a task",onAddTask,isReadOnly]]:[]),
                  [impactPdfLoading?"Generating…":"Impact summary",downloadImpactSummary,impactPdfLoading],
                  /* MEMBERS-2 — the one page this person has: their membership,
                     their tickets, their shifts and their giving. Staff send the
                     link; they never see the token it carries, because somebody
                     who could read it could open somebody else's page. */
                  ["Send their page link",sendYourPageLink,isReadOnly||!donor.email],
                  ["Edit record",onEdit,false],
                  // TRUST-2 — a person's own data, in one file, when they ask.
                  ...(isAdmin?[["Export this person's data",exportPersonData,false]]:[]),
                  // FIX-14 Part 3 — Erase and Delete, at the bottom of More, never on the page.
                  ...(isAdmin&&!isReadOnly?[["Erase this person",()=>{setEraseOpen(true);setEraseMsg("");setEraseWord("");},false,"dp-erase",true]]:[]),
                  ...(isAdmin?[["Delete donor",()=>onDelete(donor.id),false,"dp-delete",!(!isReadOnly)]]:[])].map(([label,fn,disabled,tid,sep])=>(
                  <button key={label} role="menuitem" disabled={disabled} data-testid={tid} onClick={()=>{setDpMoreOpen(false);fn();}}
                    style={{display:"block",width:"100%",textAlign:"left",background:"none",border:"none",borderTop:sep?"1px solid "+T.bg3:"none",marginTop:sep?4:0,borderRadius:sep?0:6,padding:"9px 10px",color:T.ink,fontSize:13.5,fontWeight:600,cursor:disabled?"not-allowed":"pointer",opacity:disabled?0.6:1,fontFamily:"inherit"}}>{label}</button>
                ))}
              </div>
            )}
            {volOpen&&<Modal onClose={()=>setVolOpen(false)} width={760} ariaLabel={`Volunteering, ${donor.name}`}><VolunteerPanel donor={donor} isReadOnly={isReadOnly} always/></Modal>}
            {makeVolOpen&&<AddVolunteerModal person={{id:donor.id,name:donor.name,email:donor.email,phone:donor.phone}} onClose={()=>setMakeVolOpen(false)} onDone={()=>{setMadeVol(true);if(onInteractionAdded)onInteractionAdded();}}/>}
            {videoThanksOpen&&<VideoThanksModal donor={{id:donor.id,name:donor.name}} onClose={()=>setVideoThanksOpen(false)} onSaved={()=>{if(onInteractionAdded)onInteractionAdded();}}/>}
            {prospectBriefOpen&&<ProspectBriefModal donorId={donor.id} name={donor.name} onClose={()=>setProspectBriefOpen(false)} onSaved={()=>{if(onInteractionAdded)onInteractionAdded();}}/>}
            {filingLookupOpen&&<PublicFilingLookupModal donorId={donor.id} onClose={()=>setFilingLookupOpen(false)} onLoaded={r=>setPublicFiling(r)}/>}
            {whyStopOpen&&<WhyPanel payload={{key:"stopped",donor:donor.id}} isReadOnly={isReadOnly} onClose={()=>setWhyStopOpen(false)}/>}
            {yourPageMsg&&<div role="status" data-testid="dp-your-page-msg" style={{position:"absolute",top:"calc(100% + 6px)",right:0,zIndex:61,background:T.white,border:"1px solid "+T.bg3,borderRadius:10,padding:"9px 12px",fontSize:12.5,color:T.ink,maxWidth:320,boxShadow:"0 12px 32px rgba(15,26,18,0.18)"}}>{yourPageMsg}</div>}
            {editingInt&&(()=>{let m={};try{m=typeof editingInt.metadata==="string"?JSON.parse(editingInt.metadata||"{}"):(editingInt.metadata||{});}catch{m={};}
              return m.via==="thread_log"
                ?<LogConversationModal donor={{id:donor.id,name:donor.name}} org={org} editing={editingInt} onSaved={onIntEdited} onClose={()=>setEditingInt(null)}/>
                :<LogTouchpointModal donor={donor} editing={editingInt} onSave={onIntEdited} onClose={()=>setEditingInt(null)}/>;})()}
            {noteOpen&&<LogConversationModal donor={{id:donor.id,name:donor.name}} org={org} onNavigate={onNavigate} initialTouch="note_only"
            onSaved={()=>{loadDpThread();loadRel();loadGiftsFull();if(onInteractionAdded)onInteractionAdded();}} onClose={()=>setNoteOpen(false)}/>}
          {convoOpen&&<LogConversationModal donor={{id:donor.id,name:donor.name}} thread={dpThread} org={org} onNavigate={onNavigate}
              onSaved={r=>{loadDpThread();if(onInteractionAdded)onInteractionAdded();setLocalInts(prev=>prev?[{id:r.interactionId,type:r.touch==="gift"?"gift":r.touch.startsWith("call")?"call":r.touch==="email"?"email":r.touch==="note_only"?"note":r.touch==="ask"?"ask":"meeting",note:r.line,date:r.date,metadata:r.place?{location:r.place}:null},...prev]:prev);
                // FIX-14 Part 1 — every count on the record re-reads the one
                // source: the header's figures, the rail, the rhythm, the timeline.
                loadRel();loadGiftsFull();}}
              onClose={()=>setConvoOpen(false)}/>}
            {suggestOpen&&<Modal onClose={()=>setSuggestOpen(false)} width={640} title="Suggested">
              <div data-testid="dp-suggested" style={{display:"flex",flexDirection:"column",gap:12}}>
                {!SUGGEST_KINDS.some(t=>aiMap[`${donor.id}_${t}`]||aiErr[`${donor.id}_${t}`])&&<div style={{fontSize:13,color:T.ink3}}>{loadingKey&&String(loadingKey).startsWith(donor.id+"_")?<Spin/>:"Nothing drafted yet. Pick a draft from More."}</div>}
                {/* ── SUGGESTED ────────────────────────────────────────────
                    What Steward drafted, beside the step it is about. Every
                    line came through the HOTFIX-1 checker: a sentence naming
                    somebody, stating a number or making a claim the record does
                    not carry is dropped SILENTLY (the count goes to the
                    console), timing that is already behind today is refused,
                    and when nothing survives this renders nothing at all. */}
                {SUGGEST_KINDS.map(t=>aiMap[`${donor.id}_${t}`]?(
                  <div key={t} data-testid={`dp-suggested-${t}`}>
                    <AIPanel text={aiMap[`${donor.id}_${t}`]} onClose={()=>{}}/>
                    <div style={{fontSize:12,color:T.ink3,marginTop:6}}>
                      From <button onClick={()=>{setSuggestOpen(false);setDpTab("conversations");}} style={{background:"none",border:"none",padding:0,color:T.greenDk,fontWeight:700,textDecoration:"underline dotted",cursor:"pointer",fontFamily:"inherit",fontSize:12}}>this record</button>
                      {t==="email"&&aiMap[`${donor.id}_email`]?<> · <button onClick={()=>copyDraftEmail(aiMap[`${donor.id}_email`])} data-testid="dp-copy-draft" style={{background:"none",border:"none",padding:0,color:T.greenDk,fontWeight:700,textDecoration:"underline dotted",cursor:"pointer",fontFamily:"inherit",fontSize:12}}>{draftCopied?"Copied ✓":"Copy the draft"}</button></>:null}
                    </div>
                  </div>
                ):null)}

                {/* FIX-10 D — WHEN DRAFTING DID NOT COME BACK. The failure used
                    to be written into aiMap and rendered as though Steward had
                    suggested it, carrying the HTTP status ("Stream failed: 503")
                    into a panel headed "Suggested". It is its own row now, in the
                    Agent room's voice, with the one control that helps. */}
                {SUGGEST_KINDS.map(t=>aiErr[`${donor.id}_${t}`]?(
                  <div key={t+"-err"} data-testid={`dp-suggested-error-${t}`}
                    style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap",
                      background:T.gold50,border:"1px solid "+T.bg2,borderLeft:"3px solid "+T.gold500,
                      borderRadius:14,padding:"12px 16px",marginTop:12}}>
                    <span style={{fontSize:13,color:T.ink,lineHeight:1.6,flex:"1 1 240px"}}>
                      {aiErr[`${donor.id}_${t}`]}
                    </span>
                    <button data-testid={`dp-suggested-retry-${t}`}
                      onClick={()=>getAI(donor,t,t==="nextmove"?openForNextMove:undefined)}
                      disabled={loadingKey===`${donor.id}_${t}`}
                      style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:8,
                        padding:"6px 13px",fontSize:12.5,fontWeight:700,color:T.ink,
                        cursor:loadingKey===`${donor.id}_${t}`?"wait":"pointer",fontFamily:"inherit"}}>
                      {loadingKey===`${donor.id}_${t}`?"Trying…":"Try again"}
                    </button>
                  </div>
                ):null)}
              </div>
            </Modal>}
            {briefOpen&&<Modal onClose={()=>setBriefOpen(false)} width={640} title="Brief me">
              <div>{lockMajor(<BriefPanel donorId={donor.id} donorName={donor.name} isReadOnly={isReadOnly} canWrite={isTeam}/>,{minHeight:120})}</div>
            </Modal>}
            {planOpen&&<PlanFollowUpModal donor={{id:donor.id,name:donor.name}}
              onSaved={()=>loadDpThread()} onClose={()=>setPlanOpen(false)}/>}
          </div>
      </div>
  </>;
}

export { ProfileHeader };
