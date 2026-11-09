// components/profile/RelatedModal.jsx (PROFILE-3): part of the donor profile, cut from DonorProfile.jsx.
import { Modal, PersonMark, Pill, Spin, T, activeMark, fmtFull } from "../shared";
import { RecordLink } from "../RecordLink";
import { householdHref } from "../../lib/appUrls";
import { EditedMarker } from "../EditHistory";
import { apiFetch } from "../../api";
import { errorMessage } from "../../lib/domainError";
import { Figure } from "../Figure";
import { relationshipLabelsFor, throughWords } from "./profileShared";
import { linkedPeople } from "../../lib/linkedPeople";

function RelatedModal({donor,household,isReadOnly,linkDonor,onSelectRelatedDonor,refreshSoftCredit,relErr,relLoading,relPickerOpen,relPickerResults,relPickerPending,relSaving,relSearch,relType,relatedOpen,relationships,removeFromHousehold,retypeRelationship,setHhModalOpen,setRelErr,setRelPickerOpen,setRelSearch,setRelType,setRelatedOpen,softCredit,unlinkDonor}){
  // MENU-1 — the types as this record reads them ("Gives through" on a person, "Owned by" on a business).
  const DONOR_RELATIONSHIP_LABELS=relationshipLabelsFor(donor);
  const linked=linkedPeople({household,relationships,donorId:donor.id});   // STALE-2: the rail's list
  return <>
          {/* Related tab — manual household/spouse/family/employer_match
              links. No auto-detection (matching last name, address, etc.) —
              a real fast-follow idea, not built here. */}
          {relatedOpen&&<Modal onClose={()=>{setRelatedOpen(false);setRelPickerOpen(false);}} width={720} title="Household and related">
          <div data-testid="dp-related" style={{display:"flex",flexDirection:"column",gap:16}}>
            {/* PROFILE-1 (header) — the household, in full, moved here from the Overview. */}
            {/* Household and relationships (BUILD-14; FIX-14 Part 3: one line when there is none) */}
            <div data-testid="dp-household" style={household?{background:T.white,border:"1px solid "+T.bg3,borderRadius:12,padding:"14px 16px",display:"flex",flexDirection:"column",gap:12}:{padding:"4px 2px",display:"flex",flexDirection:"column",gap:8}}>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <span style={{fontSize:10,fontWeight:800,color:T.ink3}}>Household and relationships</span>
                {household
                  ?<RecordLink to={householdHref(household.id)} data-record-link="household" style={{fontSize:12,color:T.ink,fontWeight:700,textDecoration:"underline dotted"}}>{household.name}</RecordLink>
                  :<span style={{fontSize:12,color:T.ink3,fontStyle:"italic"}}>Not in a household</span>}
                {household&&<EditedMarker item={household}/>}
                {household&&!isReadOnly&&<button data-testid="dp-household-rename" onClick={async()=>{
                    const name=window.prompt("Household name",household.name||"");
                    if(!name||!name.trim()||name.trim()===household.name)return;
                    try{await apiFetch(`/households/${household.id}`,{method:"PUT",body:JSON.stringify({name:name.trim()})});refreshSoftCredit();}
                    catch(e){alert(errorMessage(e,"The household could not be renamed."));}}}
                  style={{background:"none",border:"none",padding:0,color:T.ink3,fontSize:11,fontWeight:600,textDecoration:"underline",cursor:"pointer",fontFamily:"inherit"}}>Rename</button>}
                {household
                  ?!isReadOnly&&<button onClick={removeFromHousehold} style={{marginLeft:"auto",background:"transparent",border:"1px solid "+T.bg3,borderRadius:7,padding:"3px 9px",color:T.terracotta,fontSize:11,fontWeight:700,cursor:"pointer"}}>Remove</button>
                  :!isReadOnly&&<button onClick={()=>setHhModalOpen(true)} style={{marginLeft:"auto",background:"transparent",border:"1px solid "+T.bg3,borderRadius:7,padding:"3px 9px",color:T.greenMid,fontSize:11,fontWeight:700,cursor:"pointer"}}>+ Group into household</button>}
              </div>
              {household&&(
                <>
                  <div style={{display:"flex",gap:18,flexWrap:"wrap"}}>
                    <div><div style={{fontSize:10,color:T.ink3}}>Hard credit</div><div style={{fontSize:16,fontWeight:800,color:T.ink}}>{softCredit?.householdSources?<Figure variant="inline" kind="money" value={softCredit.hardCredit||0} label="Hard credit" definition="This person's own lifetime giving: the gifts credited to them." source={softCredit.householdSources.hardCredit}/>:fmtFull(softCredit?.hardCredit||0)}</div></div>
                    <div><div style={{fontSize:10,color:T.ink3}}>Soft credit</div><div style={{fontSize:16,fontWeight:800,color:T.gold600}}>{softCredit?.householdSources?<Figure variant="inline" kind="money" value={softCredit.softCredit||0} label="Soft credit" definition="The lifetime giving of everyone else in this household, credited to this person through the household." source={softCredit.householdSources.softCredit}/>:fmtFull(softCredit?.softCredit||0)}</div></div>
                    <div style={{borderLeft:"1px solid "+T.bg3,paddingLeft:18}}><div style={{fontSize:10,color:T.ink3}}>Household combined</div><div style={{fontSize:16,fontWeight:800,color:T.ink}}>{household.combined_source?<Figure variant="inline" kind="money" value={household.combined_giving} label="Household combined" definition="Each person in this household, with their lifetime giving. Someone who was deleted is not counted." source={household.combined_source}/>:fmtFull(household.combined_giving)}</div></div>
                  </div>
                  <div style={{display:"flex",flexDirection:"column",gap:5}}>
                    {household.members.map(m=>(
                      <div key={m.id} onClick={()=>m.id!==donor.id&&onSelectRelatedDonor&&onSelectRelatedDonor(m.id)} style={{display:"flex",alignItems:"center",gap:8,fontSize:12,padding:"6px 8px",borderRadius:8,background:m.id===donor.id?T.greenDk+"10":"transparent",cursor:m.id!==donor.id?"pointer":"default"}}>
                        {/* BUILD-94 Part 1 — a household is the one place a
                            row names several people at once; faces are what
                            tell them apart at a glance. */}
                        <PersonMark id={m.id} name={m.name} size={22}/>
                        <span style={{fontWeight:m.id===donor.id?800:600,color:T.ink}}>{m.name}</span>
                        {m.is_primary&&<span style={{background:T.gold500,color:T.ink,borderRadius:99,padding:"1px 7px",fontSize:9,fontWeight:800}}>Primary</span>}
                        <span style={{marginLeft:"auto",color:T.ink3}} onClick={e=>e.stopPropagation()}>{m.source?<Figure variant="cell" kind="money" value={m.total_giving} label={`${m.name}: lifetime giving`} source={m.source}/>:fmtFull(m.total_giving)}</span>
                      </div>
                    ))}
                  </div>
                  <div style={{fontSize:11,color:T.ink3}}>Combined view only: each gift's hard credit stays with the donor who gave it.</div>
                </>
              )}
            </div>
            {/* FIX-49 decision 8: one household grouping. The "Household Giving" banner
                summed spouse links, a second grouping; the household panel above is the one. */}

            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
              <div style={{fontSize:14,fontWeight:800,color:T.ink}}>Linked people</div>
              {!isReadOnly&&<button data-testid="dp-rel-link" onClick={()=>{setRelPickerOpen(true);setRelErr("");setTimeout(()=>{const el=document.querySelector('[data-testid="dp-rel-search"]');if(el){el.focus();el.scrollIntoView&&el.scrollIntoView({block:"nearest"});}},0);}} style={{background:T.greenDk,border:"none",borderRadius:7,padding:"6px 12px",color:T.white,fontSize:12,fontWeight:700,cursor:"pointer"}}>+ Link someone</button>}
            </div>
            {/* POLISH-4 — "Link someone" opens here. POLISH-8 (W-1109-Donors-49X): the picker sits under
                the button that opens it, and the button only opens it (it used to toggle, so with the
                picker already open from About it closed it, and above a tall household it opened out of sight). */}
            {relPickerOpen&&(
              <div data-testid="dp-rel-picker" style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:10,padding:12,display:"flex",flexDirection:"column",gap:8}}>
                <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                  {DONOR_RELATIONSHIP_LABELS.map(([v,l])=>(
                    <button key={v} data-testid={`dp-rel-type-${v}`} aria-pressed={relType===v} onClick={()=>setRelType(v)} style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:7,padding:"5px 10px",color:T.ink3,fontSize:11,fontWeight:600,cursor:"pointer",...activeMark(relType===v,"bottom")}}>{l}</button>
                  ))}
                </div>
                <input autoFocus data-testid="dp-rel-search" value={relSearch} onChange={e=>setRelSearch(e.target.value)} placeholder="Search people and organizations by name…" style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:8,padding:"8px 12px",color:T.ink,fontSize:13,outline:"none"}}/>
                {relSearch.trim()&&(
                  <div style={{display:"flex",flexDirection:"column",gap:4,maxHeight:180,overflowY:"auto"}}>
                    {relPickerResults.length===0
                      ?<div style={{fontSize:12,color:T.ink3,fontStyle:"italic",padding:"6px 4px"}}>{relPickerPending?"Searching…":"No matching donors."}</div>
                      :relPickerResults.map(d=>(
                        <button key={d.id} disabled={relSaving} onClick={()=>linkDonor(d.id)} style={{display:"flex",justifyContent:"space-between",alignItems:"center",background:T.white,border:"1px solid "+T.bg3,borderRadius:8,padding:"7px 10px",cursor:relSaving?"not-allowed":"pointer",textAlign:"left"}}>
                          <span style={{fontSize:12,fontWeight:600,color:T.ink}}>{d.name}</span>
                          <span style={{fontSize:11,color:T.ink3}}>{fmtFull(d.total)} →</span>
                        </button>
                      ))}
                  </div>
                )}
                {relErr&&<div style={{color:T.terracotta,fontSize:12}}>{relErr}</div>}
              </div>
            )}


            {/* STALE-2: the people the rail lists (lib/linkedPeople.js): the household's
                other members, then each relationship row. It said "Nobody linked
                yet" beside a household of three. */}
            {relLoading?<div style={{padding:20,textAlign:"center"}}><Spin/></div>
              :linked.length===0
                ?<div data-testid="dp-linked-people" style={{fontSize:13,color:T.ink3,fontStyle:"italic",textAlign:"center",padding:24}}>Nobody linked yet.</div>
                :<div data-testid="dp-linked-people" style={{display:"flex",flexDirection:"column",gap:8}}>
                  {linked.filter(x=>x.via==="household").map(({member:m})=>(
                    <div key={"hh:"+m.id} data-testid="dp-linked-household" style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,background:T.white,border:"1px solid "+T.bg3,borderRadius:10,padding:"11px 14px"}}>
                      <div onClick={()=>onSelectRelatedDonor&&onSelectRelatedDonor(m.id)} style={{cursor:onSelectRelatedDonor?"pointer":"default",minWidth:0}}>
                        <div style={{fontSize:13,fontWeight:700,color:T.ink}}>{m.name} →</div>
                        <div style={{fontSize:11,color:T.ink3,marginTop:2}}>{fmtFull(m.total_giving)} lifetime</div>
                      </div>
                      <span style={{fontSize:11,color:T.ink3,flexShrink:0}}>In the household</span>
                    </div>
                  ))}
                  {linked.filter(x=>x.via==="relationship").map(({rel:r})=>(
                    <div key={r.id} style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,background:T.white,border:"1px solid "+T.bg3,borderRadius:10,padding:"11px 14px"}}>
                      <div onClick={()=>onSelectRelatedDonor&&onSelectRelatedDonor(r.relatedDonorId)} style={{cursor:onSelectRelatedDonor?"pointer":"default",minWidth:0}}>
                        <div style={{fontSize:13,fontWeight:700,color:T.ink}}>{r.relatedDonorName} →</div>
                        <div style={{fontSize:11,color:T.ink3,marginTop:2}}>{r.side?throughWords(r):`${fmtFull(r.relatedDonorTotalGiving)} lifetime`}</div>
                      </div>
                      <div style={{display:"flex",alignItems:"center",gap:8,flexShrink:0}}>
                        {isReadOnly?<Pill label={DONOR_RELATIONSHIP_LABELS.find(([v])=>v===r.relationshipType)?.[1]||r.relationshipType}/>
                          :<select aria-label="Relationship" value={r.relationshipType} onChange={e=>retypeRelationship(r.id,e.target.value)} style={{background:T.bg,border:"1px solid "+T.bg3,borderRadius:7,padding:"4px 8px",fontSize:11,color:T.ink}}>
                            {DONOR_RELATIONSHIP_LABELS.map(([v,l])=><option key={v} value={v}>{l}</option>)}
                          </select>}
                        {!isReadOnly&&<button onClick={()=>unlinkDonor(r.id)} style={{background:"transparent",border:"1px solid "+T.terracotta+"55",borderRadius:7,padding:"4px 9px",color:T.terracotta,fontSize:11,cursor:"pointer"}}>Remove</button>}
                      </div>
                    </div>
                  ))}
                </div>
            }
          </div></Modal>}
  </>;
}

export { RelatedModal };
