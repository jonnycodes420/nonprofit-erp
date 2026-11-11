// components/profile/ProfileHeader.jsx (PROFILE-3): part of the donor profile, cut from DonorProfile.jsx.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
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
import { MarkDeceasedModal, UndoDeceasedModal, DeceasedBanner } from "./DeceasedDialog";   // PEOPLE-1
import { CallScriptModal, ImpactSummaryModal, ExportDoneModal, openJourneyPicker, downloadPersonData } from "./MoreActions";   // ATLAS-3, ATLAS-4

// MENU-1 — More's menu. Its max height is the room between the button and the
// screen's edge (or the phone's tab bar), less 12 px, and it scrolls inside; with more room above than
// below it opens upward. From 900 px wide: Reach out and Plan on the left,
// Know them and Their record on the right. Arrow keys walk the items in reading
// order (left column, then right); Esc closes and hands focus back to More.
const MENU_MARGIN=12, MENU_GAP=6;
function MoreMenu({groups,onPick,onClose}){
  const ref=useRef(null);
  const [pos,setPos]=useState({up:false,maxHeight:320,wide:false,left:null});
  useLayoutEffect(()=>{
    const place=()=>{
      const btn=document.getElementById("dp-more-btn");
      if(!btn)return;
      const r=btn.getBoundingClientRect(), vw=window.innerWidth;
      // On a phone the bottom tab bar covers the last strip of the screen; the menu stops above it.
      const bar=document.querySelector(".mobile-bottom-bar");
      const vh=bar&&getComputedStyle(bar).display!=="none"?Math.min(window.innerHeight,bar.getBoundingClientRect().top):window.innerHeight;
      const below=vh-r.bottom-MENU_GAP-MENU_MARGIN, above=r.top-MENU_GAP-MENU_MARGIN;
      const up=above>below, wide=vw>=900;
      // Narrow: under More (which wraps to the row's left), kept 16 px inside the screen.
      let left=null;
      const row=btn.offsetParent;
      if(!wide&&row&&ref.current){
        const rr=row.getBoundingClientRect(), w=ref.current.offsetWidth;
        left=Math.max(16-rr.left,Math.min(r.left-rr.left,vw-16-w-rr.left));
      }
      setPos({up,maxHeight:Math.max(120,Math.floor(up?above:below)),wide,left});
    };
    place();
    window.addEventListener("resize",place);
    window.addEventListener("scroll",place,true);
    return ()=>{window.removeEventListener("resize",place);window.removeEventListener("scroll",place,true);};
  },[]);
  useEffect(()=>{const first=ref.current&&ref.current.querySelector("[role=menuitem]:not([disabled])");if(first)first.focus({preventScroll:true});},[]);
  const onKeyDown=e=>{
    const items=[...ref.current.querySelectorAll("[role=menuitem]:not([disabled])")];
    const i=items.indexOf(document.activeElement);
    const go=n=>{e.preventDefault();const el=items[(n+items.length)%items.length];if(el){el.focus();el.scrollIntoView({block:"nearest"});}};
    if(e.key==="ArrowDown")go(i+1);
    else if(e.key==="ArrowUp")go(i<0?items.length-1:i-1);
    else if(e.key==="Home")go(0);
    else if(e.key==="End")go(items.length-1);
    else if(e.key==="Escape"){e.preventDefault();onClose();const b=document.getElementById("dp-more-btn");if(b)b.focus();}
  };
  const left=groups.filter(g=>g[0]==="reach"||g[0]==="plan"), right=groups.filter(g=>g[0]==="know"||g[0]==="record");
  const cols=pos.wide&&left.length&&right.length?[left,right]:[groups];
  const group=([key,title,items])=>(
    <div key={key} role="group" aria-labelledby={`dp-more-h-${key}`} data-testid={`dp-more-group-${key}`} style={{marginBottom:6}}>
      <div id={`dp-more-h-${key}`} data-testid="dp-more-heading" style={{fontSize:11,fontWeight:700,color:T.ink3,padding:"8px 10px 4px",letterSpacing:"0.02em"}}>{title}</div>
      {items.map(([label,fn,disabled,tid,sep])=>(
        <div key={label}>
          {sep&&<div role="separator" style={{borderTop:"1px solid "+T.bg3,margin:"6px 4px"}}/>}
          <button role="menuitem" type="button" disabled={disabled} data-testid={tid} onClick={()=>onPick(fn)}
            style={{display:"block",width:"100%",textAlign:"left",background:"none",border:"none",borderRadius:6,padding:"8px 10px",color:T.ink,fontSize:13.5,fontWeight:600,cursor:disabled?"not-allowed":"pointer",opacity:disabled?0.6:1,fontFamily:"inherit"}}>{label}</button>
        </div>
      ))}
    </div>
  );
  return (
    <div ref={ref} className="dph-more-menu" role="menu" aria-label="More" data-testid="dp-more-menu" data-opens={pos.up?"up":"down"} onKeyDown={onKeyDown}
      style={{position:"absolute",...(pos.up?{bottom:`calc(100% + ${MENU_GAP}px)`}:{top:`calc(100% + ${MENU_GAP}px)`}),...(pos.left!=null?{left:pos.left,right:"auto"}:{right:0}),zIndex:250,background:T.white,border:"1px solid "+T.bg3,borderRadius:10,boxShadow:"0 12px 32px rgba(15,26,18,0.18)",
        minWidth:220,width:cols.length>1?480:"auto",maxWidth:"calc(100vw - 32px)",boxSizing:"border-box",maxHeight:pos.maxHeight,overflowY:"auto",overscrollBehavior:"contain",padding:6,
        display:"grid",gridTemplateColumns:cols.length>1?"1fr 1fr":"1fr",columnGap:8,alignItems:"start"}}>
      {cols.map((c,i)=><div key={i}>{c.map(group)}</div>)}
    </div>
  );
}

function ProfileHeader({onRecordChanged,setMergeOpen,setRelatedOpen,setRelPickerOpen,aiErr,aiMap,briefOpen,canMajorGifts,convoOpen,copyDraftEmail,donor,downloadImpactSummary,dpMoreOpen,dpThread,draftCopied,editingInt,exportPersonData,filingLookupOpen,getAI,headName,headTags,impactPdfLoading,isAdmin,isReadOnly,isTeam,isVolunteer,loadDpThread,loadGiftsFull,loadRel,loadingKey,lockMajor,makeVolOpen,noteOpen,onAddTask,onClose,onDelete,onEdit,onIntEdited,onInteractionAdded,onNavigate,openForNextMove,org,photoUrl,planOpen,prospectBriefOpen,sendYourPageLink,setBriefOpen,setConvoOpen,setDpMoreOpen,setDpTab,setEditingInt,setEraseMsg,setEraseOpen,setEraseWord,setFilingLookupOpen,setLocalInts,setMadeVol,setMakeVolOpen,setNoteOpen,setPhotoUrl,setPlanOpen,setProspectBriefOpen,setPublicFiling,setShowGiftModal,setSuggestOpen,setVideoThanksOpen,setVolOpen,setWhyStopOpen,suggestOpen,videoThanksOpen,volOpen,whyStopOpen,yourPageMsg,setAddPledgeOpen}){
  const [deceasedOpen,setDeceasedOpen]=useState(null);   // PEOPLE-1: "mark" or "undo"
  const [moreOpen,setMoreOpen]=useState(null);   // ATLAS-3: "call" or "impact"
  const [exported,setExported]=useState(null);   // ATLAS-4: what the export downloaded, said on screen
  const exportData=async()=>{ try{ setExported(await downloadPersonData(donor)); }catch(e){ setExported({error:e?.message||"The export did not download. Try again."}); } };
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
          <DeceasedBanner donor={donor}/>
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
              Log a touch
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
            <button onClick={()=>openTellSteward(donor)} disabled={isReadOnly} data-testid="dp-tell-steward" className="dph-act dph-atlas" aria-label={`Tell ${atlasName()} about ${donor.name || "this person"}`} title={atlasName()}
              style={{background:T.white,border:"1px solid "+T.greenDk,borderRadius:9,padding:"0 14px",minHeight:40,boxSizing:"border-box",color:T.greenDk,fontSize:13,fontWeight:700,cursor:isReadOnly?"not-allowed":"pointer",opacity:isReadOnly?0.5:1,display:"inline-flex",alignItems:"center",gap:7,whiteSpace:"nowrap"}}>
              <MicGlyph size={15}/><span className="dph-act-label">{atlasName()}</span>
            </button>
            {/* SHELVED — voice capture works but unproven adoption assumption, revisit later.
                Code intact, re-enable by uncommenting.
            <button onClick={()=>setShowVoiceMemo(true)} style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"7px 14px",color:T.ink3,fontSize:13,cursor:"pointer"}}>
              Voice memo
            </button>
            */}
            <button onClick={()=>setDpMoreOpen(o=>!o)} data-testid="dp-more" id="dp-more-btn" aria-haspopup="menu" aria-expanded={dpMoreOpen}
              style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:9,padding:"0 14px",minHeight:40,boxSizing:"border-box",color:T.ink,fontSize:13,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap"}}>More ▾</button>
            {dpMoreOpen&&(()=>{
              /* MENU-1 — THE MENU, GROUPED, AND ON THE SCREEN. It was about
                 eighteen items in one column, absolutely placed with no max
                 height, so on a 13" laptop Merge with…, Edit record, Export and
                 Delete sat below the bottom of the screen with no way to scroll
                 to them. Now four groups (two columns from 900 px), a max height
                 measured from the button, and its own scroll. Every capability
                 and permission condition is the one it had; "Add a task" left
                 because the Task button beside More is drawn on the same
                 condition, and "Plan a follow-up" leaves only while the Next
                 step's own button is on the screen. */
              const sugN=SUGGEST_KINDS.filter(t=>aiMap[`${donor.id}_${t}`]||aiErr[`${donor.id}_${t}`]).length;
              const planOnScreen=typeof document!=="undefined"&&!!document.querySelector("[data-testid=dp-next-plan]");
              const groups=[
                ["reach","Reach out",[
                  // FIX-55 item 6: a payment link needs card payments set up.
                  // GIFTS-2: it is a payment link, so it says so ("Request a gift"
                  // read as a pledge, Muse 6 Nov); a pledge is its own item.
                  ...(org?.capabilities?.stripe?[["Send a payment link",()=>setShowGiftModal(true),false,"dp-payment-link"]]:[]),
                  ...(setAddPledgeOpen?[["Record a pledge",()=>{setDpTab("giving");setAddPledgeOpen(true);},isReadOnly,"dp-record-pledge"]]:[]),
                  // FIX-14 Part 3 — the quick drafts live here.
                  // ATLAS-3: an email is a draft for this person (Atlas writes it, she reviews and sends); a call script is a script.
                  ...(isTeam?[["Draft an email",()=>openTellSteward(donor,{text:`Draft an email to ${donor.name}`,send:true}),isReadOnly||!donor.email,"dp-draft-email"],
                    ["Draft outreach",()=>{setSuggestOpen(true);getAI(donor,"outreach");},false],
                    ["Call script",()=>setMoreOpen("call"),!!donor.deceased||!!donor.doNotContact,"dp-call-script"]]:[]),
                  /* MEMBERS-2 — staff send the link; they never see the token it carries. */
                  ["Send their page link",sendYourPageLink,isReadOnly||!donor.email],
                  // PARITY-1 Part F: a short video from her; saving drafts the email, she sends it.
                  ["Record a video thank-you",()=>setVideoThanksOpen(true),isReadOnly||!donor.email||!!donor.deceased||!!donor.doNotContact,"dp-video-thanks"],
                ]],
                ["plan","Plan",[
                  // ATLAS-4 — the rail's own journey picker, brought to her.
                  ["Add to a journey",()=>openJourneyPicker(onNavigate),isReadOnly,"dp-add-journey"],
                  // BUILD-85 — only when there is no open thread, and only when the Next step's button is not already showing.
                  ...(!dpThread&&!planOnScreen?[["Plan a follow-up",()=>setPlanOpen(true),isReadOnly,"dp-plan-followup"]]:[]),
                  ...(isTeam?[["Draft the next move",()=>{setSuggestOpen(true);getAI(donor,"nextmove",openForNextMove);},false]]:[]),
                  [`Suggested${sugN?` (${sugN})`:""}`,()=>setSuggestOpen(true),false],
                  // WHY-1 — only for a lapsed donor.
                  ...(donor.stage==="lapsed"?[["Why did they stop?",()=>setWhyStopOpen(true),false,"dp-why-stop"]]:[]),
                ]],
                ["know","Know them",[
                  // FIX-55 item 6: Brief me needs AI.
                  ...(org?.capabilities?.ai?[["Brief me",()=>setBriefOpen(true),false]]:[]),
                  // PROSPECT-1 — a one-page prospect brief, saved to their files.
                  ...(canMajorGifts?[["Write a prospect brief",()=>setProspectBriefOpen(true),isReadOnly,"dp-prospect-brief"]]:[]),
                  ...(canMajorGifts&&donor.kind==="organisation"?[["Look up public filing",()=>setFilingLookupOpen(true),isReadOnly,"dp-filing-lookup"]]:[]),
                  ["Impact summary",()=>setMoreOpen("impact"),false,"dp-impact-summary"],
                ]],
                ["record","Their record",[
                  ["Edit record",onEdit,false],
                  // MENU-1 — the same picker as About's "Link someone" (POLISH-4's Owns · Gives through).
                  ...(setRelatedOpen?[["Link to a person or business",()=>{setRelatedOpen(true);setRelPickerOpen&&setRelPickerOpen(true);},isReadOnly,"dp-link-someone"]]:[]),
                  // PARITY-3 Part 1, FIX-24 Part 1: the volunteer record, or the form that makes them one.
                  isVolunteer?["Volunteer record",()=>setVolOpen(true),false,"dp-volunteering"]
                    :["Make a volunteer",()=>setMakeVolOpen(true),isReadOnly,"dp-make-volunteer"],
                  // POLISH-4 — two records she knows are one person, merged by hand.
                  ...(setMergeOpen?[["Merge with…",()=>setMergeOpen(true),isReadOnly,"dp-merge-with"]]:[]),
                  // PEOPLE-1 — marked with care, and undone from the same place.
                  ...(donor.kind==="organisation"?[]:[donor.deceased?["Undo: they're not deceased",()=>setDeceasedOpen("undo"),isReadOnly,"dp-not-deceased"]:["Mark as deceased",()=>setDeceasedOpen("mark"),isReadOnly,"dp-mark-deceased"]]),
                  // TRUST-2 — a person's own data, in one file, when they ask.
                  ...(isAdmin?[["Export this person's data",exportData,false,"dp-export-data"]]:[]),
                  // FIX-14 Part 3 — Erase and Delete, at the bottom of More, under a rule, never on the page.
                  ...(isAdmin&&!isReadOnly?[["Erase this person",()=>{setEraseOpen(true);setEraseMsg("");setEraseWord("");},false,"dp-erase",true]]:[]),
                  ...(isAdmin?[["Delete donor",()=>onDelete(donor.id),false,"dp-delete",isReadOnly]]:[]),
                ]],
              ].filter(g=>g[2].length);
              return <MoreMenu groups={groups} onPick={fn=>{setDpMoreOpen(false);fn();}} onClose={()=>setDpMoreOpen(false)}/>;
            })()}
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
            {moreOpen==="call"&&<CallScriptModal donor={donor} onClose={()=>setMoreOpen(null)}/>}
            {exported&&<ExportDoneModal donor={donor} result={exported} onClose={()=>setExported(null)}/>}
            {moreOpen==="impact"&&<ImpactSummaryModal donor={donor} onClose={()=>setMoreOpen(null)} onDownload={downloadImpactSummary} downloading={impactPdfLoading}/>}
            {briefOpen&&<Modal onClose={()=>setBriefOpen(false)} width={640} title="Brief me">
              <div>{lockMajor(<BriefPanel donorId={donor.id} donorName={donor.name} isReadOnly={isReadOnly} canWrite={isTeam}/>,{minHeight:120})}</div>
            </Modal>}
            {deceasedOpen==="mark"&&<MarkDeceasedModal donor={donor} onClose={()=>setDeceasedOpen(null)} onDone={()=>{loadDpThread();loadRel();if(onInteractionAdded)onInteractionAdded();}} onClosed={onRecordChanged}/>}
            {deceasedOpen==="undo"&&<UndoDeceasedModal donor={donor} onClose={()=>setDeceasedOpen(null)} onDone={()=>{loadDpThread();loadRel();if(onInteractionAdded)onInteractionAdded();}} onClosed={onRecordChanged}/>}
            {planOpen&&<PlanFollowUpModal donor={{id:donor.id,name:donor.name}}
              onSaved={()=>loadDpThread()} onClose={()=>setPlanOpen(false)}/>}
          </div>
      </div>
  </>;
}

export { ProfileHeader };
