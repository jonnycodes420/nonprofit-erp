// components/profile/RailCards.jsx (PROFILE-3): part of the donor profile, cut from DonorProfile.jsx.
import { AutoEmailCard, ComingUpCard, ConnectedCard, RAIL, RailSection, RecurringCard, ThankYousCard, VolunteeringCard } from "../ProfileRail";
import { displayDate } from "../../../../shared/displayDate";
import { RailGroups } from "./profileShared";
import { RelationshipRail } from "../MeetingPanels";

function RailPersonCards({nothingLogged,R,donor,donorEvents,inboxConnected,isReadOnly,loadRel,onNavigate,rel}){
  return <>
          {donorEvents.length>0&&(
            <RailSection title="Events" testid="dp-rail-events" fold foldOpenLabel="Hide" foldShutLabel={`Show ${donorEvents.length}`}>
              <div style={{display:"flex",flexDirection:"column",gap:6}}>
                {donorEvents.slice(0,5).map(e=>{
                  // e.date may be bare YYYY-MM-DD OR a full ISO timestamp (the
                  // sample seed writes timestamps) — blindly appending T12:00:00
                  // to the latter produced "Invalid Date" on the profile card.
                  const _raw=e.date?String(e.date):"";
                  const _iso=_raw.match(/^\d{4}-\d{2}-\d{2}/);
                  const d=_iso?displayDate(_iso[0]):"";
                  return(
                    <div key={e.id} style={{background:RAIL.panel,borderRadius:8,padding:"8px 10px",display:"flex",alignItems:"center",gap:8}}>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontSize:12,fontWeight:600,color:RAIL.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{e.name}</div>
                        <div style={{fontSize:10.5,color:RAIL.dim}}>{d}</div>
                      </div>
                      <span style={{border:"1px solid "+RAIL.line,color:RAIL.dim,borderRadius:99,padding:"2px 8px",fontSize:9.5,fontWeight:700,flexShrink:0,textTransform:"capitalize"}}>{(e.attendee_status||"invited").replace("_"," ")}</span>
                    </div>
                  );
                })}
              </div>
            </RailSection>
          )}
              {/* PROFILE-2 · 8 GROUPS, as small chips, with Add to a group. */}
              <RailGroups donorId={donor.id} isReadOnly={isReadOnly}/>
              <RecurringCard recurring={R.recurring}/>
              <ThankYousCard thankYous={R.thankYous} source={R.thankYousSource} donorId={donor.id}/>
              <ComingUpCard items={R.comingUp} onNavigate={onNavigate}/>
              {rel&&!nothingLogged&&<RelationshipRail rel={rel} donor={donor} onReload={loadRel} inboxConnected={inboxConnected} yearOnly/>}
          {/* SEND-GATE-1: the person's automatic-email switch and what it held. */}
          {donor&&donor.id&&<AutoEmailCard donorId={donor.id} email={donor.email} isReadOnly={isReadOnly} quietWhenDefault={nothingLogged}/>}
              <VolunteeringCard volunteering={R.volunteering}/>
              <ConnectedCard connected={R.connected}/>
  </>;
}

export { RailPersonCards };
