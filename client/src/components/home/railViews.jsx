import { T, stageName, fmtFull, daysDiff, interactive } from "../shared";
import { agoPhrase } from "../../../../shared/homeNote";
import { displayDateShort } from "../../../../shared/displayDate";
import { DonorLink } from "../RecordLink";

export function railDonorView({ d, isReadOnly, lifetime, name, onNavigate, railBack, railView, setConvoFor, th }) {
  return (
        <div data-testid="rail-donor">
          {railBack("Today")}
          <div style={{fontFamily:"'DM Serif Display',Georgia,serif",fontSize:22,lineHeight:1.2,color:T.ink,marginBottom:2}}>{name}</div>
          <div style={{fontSize:12.5,color:T.ink3,marginBottom:18}}>
            {d?.stage?stageName(d.stage):"On file"}{d?.email?` \u00b7 ${d.email}`:""}
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:12,paddingBottom:18,marginBottom:18,borderBottom:"1px solid "+T.bg2}}>
            {!!lifetime&&(
              <div style={{display:"flex",justifyContent:"space-between",gap:10,fontSize:13.5}}>
                <span style={{color:T.ink3}}>Lifetime giving</span><span style={{fontWeight:600,color:T.ink}}>{fmtFull(lifetime)}</span>
              </div>
            )}
            {d?.lastGift&&(
              <div style={{display:"flex",justifyContent:"space-between",gap:10,fontSize:13.5}}>
                <span style={{color:T.ink3}}>Last gift</span>
                <span style={{fontWeight:600,color:T.ink}}>{fmtFull(d.lastAmount||0)} {agoPhrase(daysDiff(d.lastGift))}</span>
              </div>
            )}
            {!lifetime&&!d?.lastGift&&(
              <div style={{fontSize:13.5,color:T.ink3,lineHeight:1.5}}>No gift on file yet.</div>
            )}
          </div>
          {th&&(
            <div style={{marginBottom:18}}>
              <div style={{fontSize:11,color:T.ink3,marginBottom:6}}>Next step</div>
              <div style={{fontSize:14,fontWeight:600,color:th.overdue?T.gold700:T.ink,lineHeight:1.4}}>
                {th.nextStep.label}{th.overdue?" \u00b7 overdue":` \u00b7 due ${displayDateShort(th.nextStep.due,new Date())}`}
              </div>
              {th.rank?.why&&<div style={{marginTop:6,fontSize:12.5,color:T.ink3,lineHeight:1.5}}>{th.rank.why}</div>}
            </div>
          )}
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            {th&&(
              <button onClick={()=>setConvoFor({donor:{id:th.donorId,name:th.donorName},thread:th})} disabled={isReadOnly}
                style={{background:T.greenDk,border:"none",borderRadius:8,padding:"10px 14px",color:T.white,fontSize:13,fontWeight:700,cursor:isReadOnly?"not-allowed":"pointer",opacity:isReadOnly?0.45:1}}>
                Log a touch
              </button>
            )}
            <DonorLink id={railView.donorId} onOpen={()=>onNavigate("donors",{selectDonorId:railView.donorId})}
              style={{background:"transparent",border:"1px solid "+T.bg2,borderRadius:8,padding:"10px 14px",color:T.ink,fontSize:13,fontWeight:600,cursor:"pointer"}}>
              Open the record
            </DonorLink>
          </div>
        </div>
  );
}

export function railListView({ L, railBack, railRow, sSerif }) {
  return (
        <>
          {railBack("Today")}
          <span style={{...sSerif,display:"inline-block",marginBottom:16}}>{L.title}</span>
          {/* HOME-6: the list is everyone its count counts; each name opens the profile. */}
          {L.rows.length===0
            ?<div style={{fontSize:13.5,color:T.ink3,lineHeight:1.5}}>{L.empty}</div>
            :<div data-testid="rail-list" data-rows={L.rows.length}>{L.rows.map(r=>railRow(r.id,r.label,r.meta,r.onOpen))}</div>}
          {L.loading&&<div style={{marginTop:10,fontSize:12,color:T.ink3}}>Reading the rest…</div>}
        </>
  );
}

export function railRow() {
  const railRow=(key,label,meta,onOpen)=>(
    <div key={key} {...interactive(onOpen,{label})}
      className="home-rail-row"
      style={{display:"flex",alignItems:"baseline",gap:10,padding:"10px 12px",borderRadius:8,margin:"0 -12px"}}>
      <span style={{flex:1,minWidth:0,fontSize:14,fontWeight:500,color:T.ink,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{label}</span>
      {meta&&<span style={{flexShrink:0,fontSize:12,color:T.ink3}}>{meta}</span>}
    </div>
  );
  return railRow;
}

export function railBack({ setRailView }) {
  const railBack=(label)=>(
    <button onClick={()=>setRailView({kind:"today"})}
      style={{background:"transparent",border:"none",padding:0,margin:"0 0 14px",color:T.greenDk,fontSize:12.5,fontWeight:700,cursor:"pointer",display:"flex",alignItems:"center",gap:6}}>
      <span aria-hidden>{"\u2190"}</span>{label}
    </button>
  );
  return railBack;
}
