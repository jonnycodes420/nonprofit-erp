// components/profile/ProfileTabsRow.jsx (PROFILE-4) · THE TAB ROW, WHICH STICKS WITH THE NAME.
//
// Moved out of DonorProfile.jsx so the shell stays at its SPLIT-2 size. The
// tabs, their order and their counts are PROFILE-1/2/3's, unchanged. PROFILE-4:
// only this row is sticky in the middle column; a zero-height sentinel above it
// tells useStuckTabs when the header has scrolled away, and then the row shows
// the small face and the name at its left and a light shadow.
// PROFILE-4b: stuck, the other tabs' counts step aside and the gaps close so every tab stays
// in view; when room is still short the name ends in "…" (whole name on hover)
// before any tab is pushed out of sight.
import { T, PersonMark } from "../shared";
import { profileTabsFor, TAB_KIND } from "./profileShared";

export function ProfileTabsRow({ stuckTabs, donor, photoUrl, headName, isVolunteer, dpTab, setDpTab, giftLoading, giftReadErr, giftCountReal, pledges, tlCounts, fileTally, tlSearch, setTlSearch, tlSearchOpen, setTlSearchOpen }) {
  return <>
    <div ref={stuckTabs.sentinelRef} aria-hidden="true" data-testid="dp-tabs-sentinel" style={{height:0}}/>
    {/* PROFILE-4 · THE TABS STICK, WITH THE NAME: once the header has scrolled
        away, the tab row sits at the top of the middle column with the
        small face and the name at its left and a light shadow. */}
    <div className={"dp3-pin dp4-pin"+(stuckTabs.stuck?" dp4-stuck":"")} data-testid="dp-pin" data-stuck={stuckTabs.stuck?"1":"0"} style={{position:"sticky",top:0,zIndex:6,background:T.white,borderBottom:"1px solid "+T.bg3,boxShadow:stuckTabs.stuck?"0 6px 16px rgba(15,26,18,0.08)":"none",transition:"box-shadow .2s"}}>
    <div className="dp-tabs-row" style={{display:"flex",alignItems:"stretch",columnGap:0,background:T.white,padding:"0 var(--dp-gutter,40px)"}}>
    {stuckTabs.stuck&&<div data-testid="dp-stuck-name" title={headName} style={{display:"flex",alignItems:"center",gap:8,marginRight:18,flex:"0 10000 auto",minWidth:26,maxWidth:220,fontWeight:700,fontSize:14,color:T.ink}}>
      <PersonMark id={donor.id} name={donor.name} kind={donor.kind} url={photoUrl} size={26}/>
      <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{headName}</span>
    </div>}
    <div className="dp-tabs" role="tablist" aria-label="Profile" data-testid="dp-tabs" style={{display:"flex",flexWrap:"nowrap",overflowX:"auto",flex:"1 1 auto",minWidth:0,scrollbarWidth:"none",gap:stuckTabs.stuck?18:24}}>
      {profileTabsFor(isVolunteer).map(([id,label])=>{
        // PROFILE-2: Giving counts gifts AND pledges (a $50,000 pledge read "Gifts & pledges 0").
        const n=id==="giving"?(giftLoading||giftReadErr?null:giftCountReal+pledges.length)
          :id==="conversations"?(tlCounts.conversation||0):id==="emails"?(tlCounts.email||0):id==="tasks"?(tlCounts.task||0)
          :id==="notes"?(tlCounts.note||0):id==="files"?(fileTally.known?fileTally.uploaded:null):null;   // STALE-2: the one file tally
        return <button key={id} role="tab" data-tab={id} aria-selected={dpTab===id} onClick={()=>setDpTab(id)} style={{background:"none",border:"none",borderBottom:"2px solid "+(dpTab===id?T.greenDk:"transparent"),padding:"12px 0 10px",color:dpTab===id?T.ink:T.ink3,fontSize:13.5,fontWeight:dpTab===id?700:500,cursor:"pointer",whiteSpace:"nowrap",flexShrink:0,fontFamily:"inherit",minHeight:44,display:"inline-flex",alignItems:"center"}}>
          {label}
          {/* PROFILE-3: a count only when there is something to count; never "0".
              PROFILE-4b: stuck, only the open tab keeps its count, so the name and all
              eight tabs fit at 1440. */}
          {n>0&&(!stuckTabs.stuck||dpTab===id)&&<span data-tab-count={id} style={{marginLeft:6,background:T.bg2,borderRadius:99,padding:"1px 7px",fontSize:10.5,fontWeight:700,color:T.ink3}}>{n}</span>}
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
    </div>{/* /dp4-pin */}
  </>;
}
