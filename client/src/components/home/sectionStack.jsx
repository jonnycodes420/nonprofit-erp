import { GoldMoment, T, PersonMark, fmtFull } from "../shared";
import { SetupChecklist } from "../HomeSetup";
import { capitalize } from "../../../../shared/vocabulary";
import { countLabel } from "../../../../shared/countWords";
import { DonorLink } from "../RecordLink";
import { surfaceOf, sectionMeta, moveToTop } from "../../lib/homeLayout";
import { SCOPED_SECTION_IDS, REDUCED_MOTION } from "./homeParts";
import { Fragment } from "react";

export function sectionStack({ agentSection, cPad, cardWrap, dragSectionId, editMode, heroSection, impactSection, isAdmin, layout, layoutLiveMsg, monthlySection, moveSection, moveSectionToTop, myPortfolioSection, onNavigate, onSectionDragEnd, onSectionDragOver, onSectionDragStart, onSectionDrop, recurringHealth, retentionPipelineSection, sHdr, sHdrPad, sLink, sTitle, saveEdit, scopeToggle, sequencesSection, setSectionVisible, setSetupCardState, setupCelebrate, setupStatus, surface, t, thankYouSection, threadHealthLine, threadSection }) {
  return (
  layout!==undefined?(()=>{
        // BUILD-35: the setup card renders only while the org is genuinely
        // un-activated (and not explicitly hidden). On the completion
        // TRANSITION — complete now, but previously seen incomplete — it
        // renders one GoldMoment (self-gated once-per-org), then nothing,
        // forever. An always-been-complete org never sees any of it.
        const setupSection=(()=>{
          if(!setupStatus)return null;
          if(setupStatus.cardState==="hidden")return null;
          if(setupStatus.complete){
            if(!setupCelebrate)return null;
            return <GoldMoment moment="setup_complete" title="Steward is set up."
              line="Donors in, giving connected, automations watching. This card retires itself, everything it linked to lives in Settings."/>;
          }
          return <SetupChecklist status={setupStatus} onNavigate={onNavigate} isAdmin={isAdmin} onSetCardState={setSetupCardState}/>;
        })();
        // ── BUILD-86 — THE FAILING MONTHLY GIFTS, WITH NAMES ────────────
        // These were a COUNT inside the retention/pipeline card, next to a
        // retention rate and a funnel. A failing gift is the most actionable
        // thing on this screen and the least like a board metric, so it is its
        // own row group beside the other two lists of people. Every row is a
        // person, an amount, how long it has been failing, and one action.
        const atRisk=recurringHealth?.atRisk||[];
        const recurringSection=atRisk.length>0?(
          <div id="dash-recurring" style={{...cardWrap,scrollMarginTop:64}}>
            <div className="dash-cpad" style={{...cPad,...sHdrPad,...sHdr}}>
              <span style={sTitle}>{capitalize(t("monthly_giver",2))} that need you</span>
              <button onClick={()=>onNavigate("fundraising",{frSection:"recurring"})} style={sLink}>Open Recurring Giving →</button>
            </div>
            <ul style={{listStyle:"none",margin:0,padding:0}}>
              {atRisk.map((r,i)=>{
                const days=r.first_failed_at?Math.max(0,Math.floor((Date.now()-new Date(r.first_failed_at).getTime())/86400000)):null;
                return(
                  <li key={r.id} style={{display:"flex",alignItems:"center",gap:12,padding:"12px 20px",borderLeft:"3px solid "+T.gold500,
                                         borderBottom:i<atRisk.length-1?"1px solid "+T.bg3:"none"}}>
                    <PersonMark id={r.donor_id} name={r.donor_name} size={34}/>
                    <a href={`/donors/${r.donor_id}`} style={{flex:1,minWidth:0,textDecoration:"none",color:"inherit"}}
                      onClick={e=>{if(e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;e.preventDefault();onNavigate("donors",{selectDonorId:r.donor_id});}}>
                      <div style={{fontSize:13,fontWeight:700,color:T.ink}}>{r.donor_name}</div>
                      <div style={{fontSize:11.5,color:T.gold700,marginTop:3,fontWeight:600}}>
                        {fmtFull(parseFloat(r.amount)||0)} {r.interval==="year"?"a year":"a month"} stopped
                        {days!=null?` · failing ${countLabel(days, "day")}`:""}
                      </div>
                    </a>
                    <DonorLink id={r.donor_id} onOpen={()=>onNavigate("donors",{selectDonorId:r.donor_id})}
                      style={{background:T.greenDk,border:"none",borderRadius:7,padding:"7px 12px",color:T.white,fontSize:12,fontWeight:700,cursor:"pointer",flexShrink:0}}>
                      Open
                    </DonorLink>
                  </li>);
              })}
            </ul>
          </div>
        ):null;

        const sections={hero:heroSection,setup:surface==="home"?null:setupSection,thread:threadSection,monthly:monthlySection,recurring:recurringSection,thankYous:thankYouSection,sequences:sequencesSection,agent:surface==="home"?null:agentSection,retentionPipeline:<>{retentionPipelineSection}{threadHealthLine}</>,myPortfolio:myPortfolioSection,impact:impactSection};
        // BUILD-86 — ONE layout, TWO surfaces. The saved order and visibility
        // stay a single per-user list (so BUILD-34's merge rule, its
        // stale-config guarantee and move-to-top all keep working untouched);
        // the surface is a filter over it at render time.
        const rendered=layout.filter(r=>r.visible&&sections[r.id]!=null&&surfaceOf(r.id)===surface);
        const firstScopedId=rendered.find(r=>SCOPED_SECTION_IDS.includes(r.id))?.id;
        const hiddenRows=layout.filter(r=>!r.visible&&surfaceOf(r.id)===surface);
        const renderRow=(row,idx)=>{
            const content=sections[row.id];
            const toggle=!editMode&&row.id===firstScopedId?scopeToggle:null;
            if(!editMode)return <Fragment key={row.id}>{toggle}<div className="home-block">{content}</div></Fragment>;
            const meta=sectionMeta(row.id);
            const dragging=dragSectionId===row.id;
            return(
              <div key={row.id} draggable
                onDragStart={e=>onSectionDragStart(e,row.id)}
                onDragEnd={onSectionDragEnd}
                onDragOver={e=>onSectionDragOver(e,row.id)}
                onDrop={onSectionDrop}
                style={{position:"relative",borderRadius:16,cursor:"grab",
                  outline:`1.5px dashed ${dragging?T.gold:T.bg3}`,outlineOffset:4,
                  boxShadow:dragging?T.shadowLg:"none",
                  transform:dragging&&!REDUCED_MOTION?"translateY(-2px)":"none",
                  transition:REDUCED_MOTION?"none":"box-shadow .15s ease,transform .15s ease"}}>
                <div style={{opacity:0.55,pointerEvents:"none"}} aria-hidden>{content}</div>
                <div style={{position:"absolute",top:8,right:8,display:"flex",gap:6,zIndex:5}}>
                  <button
                    onKeyDown={e=>{
                      if(e.key==="ArrowUp"){e.preventDefault();moveSection(row.id,-1);}
                      else if(e.key==="ArrowDown"){e.preventDefault();moveSection(row.id,1);}
                      else if(e.key==="Enter"){e.preventDefault();saveEdit();}
                    }}
                    aria-label={`Reorder ${meta?.label||row.id} position ${idx+1} of ${rendered.length}. Arrow keys move it, Enter saves.`}
                    title="Drag, or focus and use arrow keys, to reorder"
                    style={{display:"flex",alignItems:"center",gap:6,background:T.white,border:"1px solid "+T.bg3,borderRadius:8,padding:"5px 10px",fontSize:12,fontWeight:700,color:T.ink2,cursor:"grab",boxShadow:T.shadow}}>
                    <span aria-hidden="true">{"⠿"}</span>{meta?.label||row.id}
                  </button>
                  {moveToTop(layout,row.id)!==layout&&(
                    <button onClick={()=>moveSectionToTop(row.id)}
                      aria-label={`Move ${meta?.label||row.id} to the top`}
                      title="Send this section to the top"
                      style={{display:"flex",alignItems:"center",gap:4,background:T.white,border:"1px solid "+T.bg3,borderRadius:8,padding:"5px 10px",fontSize:12,fontWeight:700,color:T.greenDk,cursor:"pointer",boxShadow:T.shadow}}>
                      <span aria-hidden="true">↑</span>Top
                    </button>
                  )}
                  {meta?.hideable===false?(
                    <span title="Home always shows the fundraising hero" style={{display:"flex",alignItems:"center",background:T.white,border:"1px solid "+T.bg3,borderRadius:8,padding:"5px 10px",fontSize:11,fontWeight:700,color:T.ink3,boxShadow:T.shadow}}>Always shown</span>
                  ):(
                    <button onClick={()=>setSectionVisible(row.id,false)}
                      aria-label={`Hide ${meta?.label||row.id}`}
                      style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:8,padding:"5px 10px",fontSize:12,fontWeight:700,color:T.terracotta,cursor:"pointer",boxShadow:T.shadow}}>Hide</button>
                  )}
                </div>
              </div>
            );
        };
        const threadAt=rendered.findIndex(r=>r.id==="thread");
        const splitAt=surface!=="home"?rendered.length:threadAt>=0?threadAt+1:Math.min(1,rendered.length);
        const topRows=rendered.slice(0,splitAt),lowerRows=rendered.slice(splitAt);
        const tail=(<>
          {editMode&&(
            <span role="status" aria-live="polite" style={{position:"absolute",width:1,height:1,padding:0,margin:-1,overflow:"hidden",clip:"rect(0 0 0 0)",whiteSpace:"nowrap",border:0}}>{layoutLiveMsg}</span>
          )}
          {editMode&&hiddenRows.length>0&&(
            <div style={{background:T.bg,border:"1.5px dashed "+T.bg3,borderRadius:14,padding:"12px 16px"}}>
              <div style={{fontSize:10,fontWeight:800,color:T.ink3,marginBottom:8}}>Hidden, not shown on your Home</div>
              <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
                {hiddenRows.map(r=>{
                  const m=sectionMeta(r.id);
                  return(
                    <button key={r.id} onClick={()=>setSectionVisible(r.id,true)}
                      aria-label={`Show ${m?.label||r.id} again`}
                      style={{display:"inline-flex",alignItems:"baseline",gap:7,background:T.white,border:"1px solid "+T.bg3,borderRadius:99,padding:"6px 12px",fontSize:12,fontWeight:700,color:T.ink2,cursor:"pointer"}}>
                      {m?.label||r.id}<span style={{color:T.greenDk}}>Show</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </>);
        return{
          // INT-BUILD-1 Parts 4 and 5 — today's meetings with their briefs, and
          // "how did it go" for a meeting that just ended. Not a layout row:
          // it only exists on a day there is something on a connected calendar.
          top:<>{topRows.map((row,i)=>renderRow(row,i))}{lowerRows.length?null:tail}</>,
          lower:lowerRows.length?<>{lowerRows.map((row,i)=>renderRow(row,splitAt+i))}{tail}</>:null,
        };
  })():null
  );
}
