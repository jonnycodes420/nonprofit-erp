// components/profile/RailAbout.jsx (PROFILE-3): part of the donor profile, cut from DonorProfile.jsx.
import { ContactExtras, RAIL, RailSection, RhythmCard } from "../ProfileRail";
import { RecordLink } from "../RecordLink";
import { householdHref } from "../../lib/appUrls";
import { ContactFlag, DONOR_RELATIONSHIP_LABELS, RoleLine } from "./profileShared";
import { Phone, Pill, T, firstNameOf } from "../shared";
import { birthdayLabel } from "../../../../shared/birthday.js";
import { ClosenessLine, ImportRefusalsLine, statusTagItems } from "../ProfileStatus";
import { ScoreCard } from "../ScoreWhy";
import { ProfileGroups } from "../Groups";
import { PublicFilingBlock, RoomToGiveBlock } from "../RoomToGive";

const QUIET={background:"none",border:"none",padding:0,font:"inherit",color:RAIL.dim,textDecoration:"underline",textUnderlineOffset:3,cursor:"pointer"};

function RailAboutSections({nothingLogged,noGifts,R,aboutStatusTags,canMajorGifts,contactPerson,donor,handleReassign,household,isAdmin,isReadOnly,isTeam,onSelectRelatedDonor,orgTeam,publicFiling,railData,reassignId,reassignLoading,relationships,scores,setConvoOpen,setReassignId,setRelatedOpen,setShowReassign,showReassign,status,onEdit}){
  const cx=(railData&&railData.contact)||{};
  const hasContact=!!(donor.email||donor.phone||contactPerson||cx.address||cx.preferred||cx.privacyOn||cx.isClient||(cx.flags||[]).length);
  return <>
              {/* PROFILE-2 · 4 HOUSEHOLD AND RELATED: the household and the people and
                  organisations linked to them, each opening its profile. Manage
                  opens the full Related editor (link, retype, unlink with Undo). */}
              {/* PROFILE-3: drawn only when someone is linked; "Link someone" is in About. */}
              {(household||relationships.length>0)&&<RailSection title="Household and related" testid="dp-rail-related"
                actionNode={<button type="button" data-testid="dp-rail-related-manage" onClick={()=>setRelatedOpen(true)} style={{background:"none",border:"none",padding:0,color:RAIL.dim,fontSize:12,fontWeight:600,letterSpacing:0,textTransform:"none",cursor:"pointer",fontFamily:"inherit",textDecoration:"underline"}}>{household||relationships.length?"Manage":"Add"}</button>}>
                {household&&<div style={{fontSize:13,marginBottom:6}}><RecordLink to={householdHref(household.id)} data-record-link="household" style={{color:RAIL.text,fontWeight:700,textDecoration:"underline dotted"}}>{household.name}</RecordLink></div>}
                {household&&(household.members||[]).filter(m=>m.id!==donor.id).map(m=><button key={"hh:"+m.id} type="button" onClick={()=>onSelectRelatedDonor&&onSelectRelatedDonor(m.id)} style={{display:"block",background:"none",border:"none",padding:"4px 0",color:RAIL.text,fontSize:13,cursor:"pointer",textAlign:"left",fontFamily:"inherit"}}>{m.name} <span style={{color:RAIL.dim}}>· household</span></button>)}
                {relationships.filter(r=>!(household&&(household.members||[]).some(m=>m.id===r.relatedDonorId))).map(r=><button key={r.id} type="button" data-testid="dp-rail-related-row" onClick={()=>onSelectRelatedDonor&&onSelectRelatedDonor(r.relatedDonorId)} style={{display:"block",background:"none",border:"none",padding:"4px 0",color:RAIL.text,fontSize:13,cursor:"pointer",textAlign:"left",fontFamily:"inherit"}}>{r.relatedDonorName} <span style={{color:RAIL.dim}}>· {(DONOR_RELATIONSHIP_LABELS.find(([v])=>v===r.relationshipType)||[])[1]||r.relationshipType}</span></button>)}
              </RailSection>}
              {/* PROFILE-2 · 5 ABOUT: donor since and roles, the owner, the giving
                  pattern, how to reach them, and the tags the header did not show. */}
              <RailSection title="About" testid="dp-rail-about">
                <div style={{display:"flex",flexDirection:"column",gap:6}}>
                  <RoleLine donor={donor} isReadOnly={isReadOnly} noGifts={noGifts} birthday={donor.birthday?birthdayLabel(donor.birthday.month,donor.birthday.day,donor.birthday.year):""}/>
                  {donor.sourceRecurring&&(
                <div data-testid="donor-source-recurring"
                  style={{fontSize:12,color:T.ink3,fontWeight:600,marginTop:3,lineHeight:1.4}}>
                  {donor.sourceRecurring.phrase}
                  {donor.sourceRecurring.confidence==="inferred"&&!donor.sourceRecurring.confirmed
                    ?<span style={{fontWeight:400}}> · nobody has confirmed it</span>:null}
                </div>
              )}
                  {donor.importedSustainer&&<span title={`Sustainer history from import, with no payment authorization here yet${donor.importedSustainerAmount?` (was $${donor.importedSustainerAmount}/mo)`:""}. Send a reconnect link from Fundraising → Recurring.`} style={{fontSize:10,fontWeight:800,padding:"3px 9px",borderRadius:99,background:T.green100,color:T.greenDk,border:`1px solid ${T.green200}`}}>Sustainer · not reconnected</span>}
                  {(aboutStatusTags.tags.length>0||(donor.tags||[]).length>0)&&<div data-testid="dp-about-tags" style={{display:"flex",gap:6,flexWrap:"wrap",marginTop:4}}>{statusTagItems(aboutStatusTags)}{(donor.tags||[]).map(t=><Pill key={"t:"+t} label={t}/>)}</div>}
                  {/* the giving pattern, in plain words, each fact opening its rows (was the Giving rhythm card, which could say "No pattern yet" beside it) */}
                  {status&&(status.closeness||status.meetingSet)&&!(nothingLogged&&!status.meetingSet)&&<div data-testid="dp-about-pattern"><ClosenessLine status={status}/></div>}
                  {donor.drift&&<div style={{fontSize:11.5,color:T.gold600,fontWeight:600,marginTop:3,lineHeight:1.4}}>{donor.drift.reason}</div>}
                  <ImportRefusalsLine status={status}/>
                  {/* PROFILE-3 · the quiet ways to fill an empty record: the sections they
                      would fill are not drawn while there is nothing in them. */}
                  {!isReadOnly&&(!hasContact||!(household||relationships.length))&&<div data-testid="dp-about-add" style={{display:"flex",gap:16,flexWrap:"wrap",marginTop:4,fontSize:12.5}}>
                    {!hasContact&&onEdit&&<button type="button" data-testid="dp-about-add-contact" onClick={onEdit} style={QUIET}>Add email or phone</button>}
                    {!(household||relationships.length)&&<button type="button" data-testid="dp-about-link" onClick={()=>setRelatedOpen(true)} style={QUIET}>Link someone</button>}
                  </div>}
                  {!isReadOnly&&<ProfileGroups donorId={donor.id} isReadOnly={isReadOnly}>{(chips,addCtl)=>!chips.length&&addCtl?<div data-testid="dp-about-group" style={{fontSize:12.5}}>{addCtl}</div>:null}</ProfileGroups>}
                </div>
              </RailSection>
              <RhythmCard rhythm={R.rhythm}/>
          {(donor.assignedToName||(isAdmin&&isTeam))&&<RailSection title="Relationship owner" testid="dp-rail-owner"
            actionNode={isAdmin&&isTeam&&donor.assignedToName&&<button onClick={()=>setShowReassign(v=>!v)}
              style={{background:"none",border:"none",padding:0,color:RAIL.dim,fontSize:12,fontWeight:600,letterSpacing:0,textTransform:"none",cursor:"pointer",fontFamily:"inherit"}}>{showReassign?"Cancel":(donor.assignedToName?"Reassign":"Assign")}</button>}>
            <div>
              {donor.assignedToName?<div style={{display:"flex",alignItems:"center",gap:10}}>
                <div style={{width:32,height:32,borderRadius:"50%",background:RAIL.line,display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,fontWeight:800,color:RAIL.text,flexShrink:0}}>{(donor.assignedToName||"?")[0]}</div>
                {/* BUILD-88a A.4 — a colleague is a FIRST NAME here too. */}
                <div style={{flex:1,fontSize:13,fontWeight:700,color:RAIL.strong}}>{firstNameOf(donor.assignedToName)}</div>
              </div>
              :<button type="button" data-testid="dp-owner-assign" onClick={()=>setShowReassign(v=>!v)} style={QUIET}>{showReassign?"Cancel":"Assign"}</button>}
              {showReassign&&isAdmin&&isTeam&&<div style={{marginTop:10,display:"flex",flexDirection:"column",gap:8}}>
                <select value={reassignId} onChange={e=>setReassignId(e.target.value)} style={{width:"100%",background:T.white,border:"1px solid "+RAIL.line,borderRadius:8,padding:"8px 10px",color:RAIL.text,fontSize:12,outline:"none",cursor:"pointer"}}>
                  <option value="">Select team member…</option>
                  {orgTeam.map(u=><option key={u.id} value={u.id}>{u.name} ({u.role})</option>)}
                </select>
                <button onClick={handleReassign} disabled={reassignLoading||!reassignId} style={{background:reassignId?T.greenDk:RAIL.line,border:"none",borderRadius:8,padding:"8px",color:reassignId?T.white:RAIL.dim,fontSize:12,fontWeight:700,cursor:reassignId?"pointer":"not-allowed"}}>
                  {reassignLoading?"Saving…":"Confirm reassignment"}
                </button>
              </div>}
            </div>
          </RailSection>}
          {/* FIX-8 Part B.1 — CONTACT MOVES TO THE TOP OF THE RAIL. The
              email lived in the header's name row, competing with the name
              for the first read, while this section, which already held the
              email, the phone, the named contact and an honest empty state,
              sat below the stage picker and the quick actions. Nothing here
              is new: the section is the one that already existed, moved to
              where somebody looks when they are about to pick up the phone. */}
          {hasContact&&<RailSection title="Contact" testid="dp-rail-contact">
            <dl style={{display:"grid",gridTemplateColumns:"104px 1fr",gap:"7px 10px",fontSize:12.5,margin:0}}>
              {contactPerson&&<><dt style={{color:RAIL.dim}}>Contact</dt><dd style={{margin:0,overflowWrap:"anywhere"}}>{contactPerson}</dd></>}
              {donor.email&&<><dt style={{color:RAIL.dim}}>Email</dt><dd style={{margin:0,overflowWrap:"anywhere"}}>{donor.email}<ContactFlag flags={donor.contact_flags} field="email"/></dd></>}
              {donor.phone&&<><dt style={{color:RAIL.dim}}>Phone</dt><dd style={{margin:0}}><Phone value={donor.phone} bad={donor.phone_unreachable===true} badWhy={donor.phone_unreachable_reason||undefined}/><ContactFlag flags={donor.contact_flags} field="phone"/>{donor.phone_unreachable===true&&<span style={{display:"block",fontSize:11.5,color:RAIL.dim}}>Marked wrong. Never dialed or texted from Steward.</span>}</dd></>}
              {/* PROFILE-1 (header): the birthday is under the name and in Coming
                  up; a monthly plan is the Recurring card. */}
              <ContactExtras contact={railData&&railData.contact} donorId={donor&&donor.id} isReadOnly={isReadOnly}/>
            </dl>
          </RailSection>}
              {/* PROFILE-2 · 6 ENGAGEMENT: one word and the facts behind it. */}
              {/* PROFILE-2 · 6 ENGAGEMENT: ENGAGE-1's card says the word (Warm,
                  Nothing logged yet) and the facts; Room to give sits in it. */}
              {/* PROFILE-3: with nothing logged there is no engagement to say, so the
                  card is not drawn ("Nothing logged yet" was the start card's job). */}
              {scores&&scores.noHistory
                ?null
                :<div data-testid="dp-rail-engagement" style={{paddingBottom:16}}>
              {/* ENGAGE-1 — how close they are, and how much they give. Inside
                  the Next step panel: no new layout. */}
              <ScoreCard donorId={donor.id} scores={scores} onLog={isReadOnly?null:()=>setConvoOpen(true)}>
                {canMajorGifts&&<RoomToGiveBlock donorId={donor.id} isReadOnly={isReadOnly}/>}
                {canMajorGifts&&donor.kind==="organisation"&&<PublicFilingBlock data={publicFiling}/>}
              </ScoreCard>
              </div>}
  </>;
}

export { RailAboutSections };
