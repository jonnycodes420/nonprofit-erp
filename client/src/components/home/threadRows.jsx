import { T, PersonMark, firstNameOf, fmtFull, daysDiff } from "../shared";
import { openReadout } from "./ReadoutPanel";   // HOME-6: a readout row opens its readout
import { displayDateShort } from "../../../../shared/displayDate";
import { rowClick } from "../../lib/appUrls";
import { DonorLink } from "../RecordLink";
import { displayName } from "../../../../shared/displayName.js";
import { RefLink, Linked } from "../Linked";
import { agoPhrase } from "../../../../shared/homeNote";
import { countLabel, plural } from "../../../../shared/countWords";
import { stepInSentence, ORG_NAME_RE } from "../../../../shared/stepCase.js";
import { SuggestedAskLine } from "../ScoreWhy";
import { rowFigure } from "../../../../shared/threadFigures";
import { PutItOnMyCalendar, ThreadDismissMenu } from "../ThreadMenus";
import { apiFetch } from "../../api";
import { offerUndo } from "../EditHistory";

export function threadReadoutRow({ ro }) {
  return (
      <li key={"readout-"+ro.id} className="attn-row" data-testid="home-readout-row"
        style={{display:"flex",alignItems:"stretch",borderBottom:"1px solid "+T.bg2,borderLeft:"3px solid "+T.greenDk}}>
        <a href="/app" className="attn-row-main"
          style={{flex:1,minWidth:0,display:"flex",alignItems:"flex-start",gap:14,padding:"14px 16px 14px 13px",textDecoration:"none",color:"inherit"}}
          onClick={e=>{if(e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;e.preventDefault();openReadout(ro.id,ro.title);}}>
          <div style={{flex:1,minWidth:0}}>
            {/* Not attn-donor-name: a readout is not a person, and that class
                is how the smoke walk finds the names that must open a profile. */}
            <div className="attn-readout-title" style={{fontSize:15,fontWeight:700,color:T.ink}}>{ro.title}</div>
            <div className="attn-clause" style={{marginTop:3,fontSize:13.5,lineHeight:1.5,color:T.ink2}}>
              {ro.lines.filter(l=>l.kind!=="data_problems").slice(0,2).map(l=>l.sentence).join(", ")}{". "}
              <span style={{color:T.ink,fontWeight:600}}>Next: see who, and what to do about each.</span>
            </div>
          </div>
          <div className="attn-row-next" style={{textAlign:"right",whiteSpace:"nowrap",paddingTop:2,flexShrink:0,minWidth:78}}>
            <div style={{fontSize:14,fontWeight:800,fontFamily:"'DM Serif Display',serif",color:T.ink}}>{displayDateShort(ro.forDate,new Date())}</div>
            <div style={{fontSize:10,fontWeight:700,color:T.ink3,marginTop:1}}>readout</div>
          </div>
        </a>
        <div className="attn-row-actions" style={{display:"flex",gap:8,flexShrink:0,alignItems:"center",padding:"8px 16px 8px 8px"}}>
          <button className="attn-row-action" data-testid="home-readout-open" onClick={()=>openReadout(ro.id,ro.title)}
            style={{background:T.white,border:"1.5px solid "+T.ink,borderRadius:8,padding:"7px 14px",color:T.ink,fontSize:12,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap"}}>See who</button>
        </div>
      </li>
  );
}

export function threadStoppedRow({ age, f, failedOn, onNavigate, openRailDonor }) {
  return (
        <li key={"stopped-"+f.subId} className="attn-row"
          style={{display:"flex",alignItems:"stretch",borderBottom:"1px solid "+T.bg2,
                  borderLeft:"3px solid "+T.gold500}}>
          {/* THREAD-2: the name and the monthly gift are links (the row's own
              <a> could hold neither), and the row still opens the rail. */}
          <div className="attn-row-main"
            style={{flex:1,minWidth:0,display:"flex",alignItems:"flex-start",gap:14,
                    padding:"14px 16px 14px 13px",color:"inherit",cursor:"pointer"}}
            onClick={rowClick(`/donors/${f.donorId}`,()=>openRailDonor(f.donorId))}>
            <PersonMark id={f.donorId} name={f.donorName} size={38}/>
            <div style={{flex:1,minWidth:0}}>
              <div className="attn-donor-name" style={{fontSize:15,fontWeight:700,color:T.ink}}>
                <DonorLink id={f.donorId} onOpen={()=>onNavigate("donors",{selectDonorId:f.donorId})}>{displayName(f.donorName)}</DonorLink>
              </div>
              <div className="attn-clause" style={{marginTop:3,fontSize:13.5,lineHeight:1.5,color:T.ink2}}>
                <RefLink refItem={{kind:"plan",id:f.subId,donorId:f.donorId}}>{f.amount?`Their $${f.amount.toLocaleString()} ${f.interval==="year"?"yearly":"monthly"} gift`:"Their recurring gift"}</RefLink>{" stopped"}
                {`${failedOn?` ${agoPhrase(age)}`:""} when the card was declined. `}
                <span style={{color:T.gold700,fontWeight:600}}>Next: send them a link to update it.</span>
              </div>
            </div>
            <div className="attn-row-next" style={{textAlign:"right",whiteSpace:"nowrap",paddingTop:2,flexShrink:0,minWidth:78}}>
              <div style={{fontSize:14,fontWeight:800,fontFamily:"'DM Serif Display',serif",color:T.gold700}}>
                {age>=1?`${countLabel(age, "day")}`:age===0?"Today":""}
              </div>
              <div style={{fontSize:10,fontWeight:700,color:T.ink3,marginTop:1}}>
                stopped
              </div>
            </div>
          </div>
          <div className="attn-row-actions" style={{display:"flex",gap:8,flexShrink:0,alignItems:"center",padding:"8px 16px 8px 8px"}}>
            <button className="attn-row-action" data-testid="home-stopped-card"
              onClick={()=>onNavigate("fundraising",{frSection:"recurring"})}
              style={{background:T.white,border:"1.5px solid "+T.ink,borderRadius:8,padding:"7px 14px",
                      color:T.ink,fontSize:12,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap"}}>Send the link</button>
          </div>
        </li>
  );
}

export function threadRow({ TOUCH_WORD, finishRow, i, isReadOnly, loadThreads, moreOpen, onNavigate, openRailDonor, railView, rowSource, setMoreOpen, surface, t, threadClause }) {
  return (
    <li key={t.id} className="attn-row"
      data-railsel={railView.kind==="donor"&&railView.donorId===t.donorId?"1":undefined}
      style={{display:"flex",alignItems:"stretch",borderBottom:i<rowSource.length-1?"1px solid "+T.bg2:"none",
              borderLeft:"3px solid "+(t.overdue?T.gold500:T.greenDk)}}>
      {/* BUILD-89 — a plain click opens the donor in the RAIL, beside the list,
          instead of throwing the whole screen away and landing on a profile. It
          is still a real anchor to /donors/:id, so cmd-click and middle-click
          still open the record in a new tab (BUILD-45 D-1 is the reason that
          anchor exists and it is not being undone). A comment may not sit
          between an element's attributes. */}
      {/* THREAD-2: EVERY NAME IS A LINK. The row held one <a> around the
          whole sentence, and an anchor cannot hold another, so nothing it
          named could open. The NAME is the real /donors/:id anchor now (the
          D-1 keyboard and new-tab promise, kept), the row still opens the
          rail on a plain click (rowClick), and what opened the thread, the
          step and anything the words name are their own links. */}
      <div className="attn-row-main"
        style={{flex:1,minWidth:0,display:"flex",alignItems:"flex-start",gap:14,padding:"14px 16px 14px 13px",color:"inherit",cursor:"pointer"}}
        onClick={rowClick(`/donors/${t.donorId}`,()=>{if(surface==="home")openRailDonor(t.donorId,t.id);else onNavigate("donors",{selectDonorId:t.donorId});})}>
        {/* BUILD-94 Part 1 — the face, and now literally so when the org has
            one. The mark used to be a first letter tinted brass-when-late; the
            row's own left edge already carries that signal, and a mark that
            changes colour by status is not the same mark everywhere. */}
        <PersonMark id={t.donorId} name={t.donorName} size={38}/>
        <div style={{flex:1,minWidth:0}}>
          <div className="attn-donor-name" style={{fontSize:15,fontWeight:700,color:T.ink}}>
            {/* HOME-6: the name opens the profile (the rest of the row still opens the rail beside the list). */}
            <DonorLink id={t.donorId} data-testid="thread-name" onOpen={()=>onNavigate("donors",{selectDonorId:t.donorId})}>{displayName(t.donorName)}</DonorLink>
          </div>
          {/* ONE SENTENCE, AND IT WRAPS. The clause and the step were two
              columns saying one thing between them; a person says it in a
              breath, so the row does too. */}
          <div className="attn-clause" style={{marginTop:3,fontSize:13.5,lineHeight:1.5,color:T.ink2}}>
            {t.lastTouch?.ref?<RefLink refItem={t.lastTouch.ref}>{threadClause(t).replace(/\.$/,"")}</RefLink>:<Linked text={threadClause(t).replace(/\.$/,"")} refs={t.refs}/>}{". "}
            <span style={{color:t.overdue?T.gold700:T.ink,fontWeight:600}}>Next: {t.stepRef
              ?<RefLink refItem={t.stepRef} data-testid="thread-step-link">{stepInSentence(t.nextStep.label,[t.donorName])}</RefLink>
              :<Linked text={stepInSentence(t.nextStep.label,[t.donorName])} refs={t.refs}/>}{/[.?!]$/.test(String(t.nextStep.label||"").trim())?"":"."}</span>
            {t.journey&&<span style={{color:T.ink3,fontSize:12.5}}>{" "}From the <RefLink refItem={t.journey}/> journey.</span>}
            {t.moreSteps?.length>0&&<>{" "}<span role="button" tabIndex={0} data-testid="thread-steps-more" aria-expanded={moreOpen===t.donorId}
              onClick={e=>{e.preventDefault();e.stopPropagation();setMoreOpen(o=>o===t.donorId?null:t.donorId);}}
              onKeyDown={e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();e.stopPropagation();setMoreOpen(o=>o===t.donorId?null:t.donorId);}}}
              style={{color:T.greenDk,fontWeight:700,textDecoration:"underline",cursor:"pointer"}}>{t.moreSteps.length} more for {ORG_NAME_RE.test(String(t.donorName||""))?t.donorName:(firstNameOf(t.donorName)||t.donorName)}</span></>}
          </div>
          {moreOpen===t.donorId&&t.moreSteps?.length>0&&(
            <ul data-testid="thread-steps-more-list" style={{listStyle:"none",margin:"4px 0 0",padding:0,fontSize:12.5,color:T.ink2,lineHeight:1.6}}>
              {t.moreSteps.map(m=><li key={m.id}>{m.stepRef?<RefLink refItem={m.stepRef}>{m.label}</RefLink>:m.label}{m.due?` · ${displayDateShort(String(m.due).slice(0,10),new Date())}`:""}</li>)}
            </ul>)}
          {/* ENGAGE-1 §3 — when the step is an ask, the amount and its math. */}
          {t.suggestedAsk&&<SuggestedAskLine ask={t.suggestedAsk} style={{marginTop:3,fontSize:12.5}}/>}
          {/* BUILD-85 — the row still answers "why this one first?", and F.3.3's
              record still arrives on hover. Both live under the sentence now
              rather than competing with it on the right. */}
          {/* BUILD-85's reason, MINUS the one the right-hand fact already
              states. "Overdue 14 days" on the right and "Overdue 14 days"
              underneath is the same duplication this row was rebuilt to end —
              the same class as BUILD-85's own `supersedes` rule. */}
          {t.rank?.why&&!/^(Overdue |\d+ days? late)/i.test(t.rank.why)&&(
            <div style={{fontSize:12,color:t.overdue?T.gold700:T.ink3,marginTop:3,fontWeight:500}}>{t.rank.why}</div>
          )}
          <div className="attn-meta" style={{marginTop:3,fontSize:11,color:T.ink3}}>
            {TOUCH_WORD[t.lastTouch?.type]||(t.lastTouch?.kind==="none"?"Planned":"Logged")}
            {(t.lastTouch?.date||t.openedOn)?` · ${displayDateShort(t.lastTouch?.date||t.openedOn,new Date())}`:""}
            {/* Who logged it, then who owns it — and one name when they are
                the same person, which in a one-officer shop they always are.
                "Mike · Mike" is the software talking to itself. */}
            {[firstNameOf(t.lastTouch?.actor),firstNameOf(t.owner?.name)]
              .filter((n,i,a)=>n&&a.indexOf(n)===i).map(n=>` · ${n}`).join("")}
            {/* A deferred step says so, and says what it was first promised
                for. Moving the due date without saying you moved it would be
                the product quietly editing somebody's commitment. */}
            {t.nextStep.originalDue?` · moved from ${displayDateShort(t.nextStep.originalDue,new Date())}`:""}
          </div>
        </div>
        {/* ONE FACT ON THE RIGHT, with its label under it — Drift puts the
            money there; a queue's fact is how late it is. It is not repeated
            in the sentence any more. */}
        <div className="attn-row-next" style={{textAlign:"right",whiteSpace:"nowrap",paddingTop:2,flexShrink:0,minWidth:78}}>
          <div style={{fontSize:14,fontWeight:800,fontFamily:"'DM Serif Display',serif",color:t.overdue?T.gold700:T.ink}}>
            {/* FIX-1 §9 — the badge, the header's "oldest" and the Home
                sentence read ONE figure (shared/threadFigures.js). When the
                row has been open longer than it has been late, the figure is
                how long it has waited, and the label says so. */}
            {t.overdue?`${rowFigure(t)} ${plural(rowFigure(t), "day")}`:(t.band==="today"?"Today":displayDateShort(t.nextStep.due,new Date()))}
          </div>
          <div style={{fontSize:10,fontWeight:700,color:T.ink3,marginTop:1}}>
            {t.overdue?(rowFigure(t)>(t.overdueDays||0)?"waiting":"overdue"):(t.band==="today"?"due":"due on")}
          </div>
        </div>
      </div>
      <div className="attn-row-actions" style={{display:"flex",gap:8,flexShrink:0,alignItems:"center",padding:"8px 16px 8px 8px"}}>
        <button className="attn-row-action" onClick={()=>finishRow(t)} disabled={isReadOnly}
          data-testid="thread-row-done" title={isReadOnly?"Reactivate your subscription to make changes.":"Marks this step done"}
          style={{background:T.white,border:"1.5px solid "+T.ink,borderRadius:8,padding:"7px 14px",color:T.ink,fontSize:12,fontWeight:700,cursor:isReadOnly?"not-allowed":"pointer",whiteSpace:"nowrap",opacity:isReadOnly?0.45:1}}>Mark done</button>
        {!isReadOnly&&t.kind!=="task"&&finishRow.logCall&&<button type="button" data-testid="thread-row-log" onClick={()=>finishRow.logCall(t)}
          style={{background:"none",border:"none",padding:"4px 2px",color:T.ink3,fontSize:11.5,textDecoration:"underline",textUnderlineOffset:2,cursor:"pointer",whiteSpace:"nowrap",fontFamily:"inherit"}}>Log a call too</button>}
        {/* BUILD-94 Part 5 — a next step is an appointment somebody has to
            keep, and hers lives in Outlook. Three links and a file; nothing
            syncs, and the menu says so. */}
        <PutItOnMyCalendar threadId={t.id}/>
        <ThreadDismissMenu thread={t} onDone={()=>loadThreads()}/>
      </div>
    </li>
  );
}

export function threadClause({ TOUCH_WORD }) {
  const threadClause=t=>{
    const lt=t.lastTouch||{};
    const base=lt.line
      ?String(lt.line).trim().replace(/[.\s]+$/,"")
      :lt.kind==="gift"&&lt.amount!=null?`${fmtFull(lt.amount)} received`
      :lt.kind==="none"?"Planned"
      :(TOUCH_WORD[lt.type]||"Logged");
    const on=lt.date||t.openedOn;
    return on?`${base} ${agoPhrase(daysDiff(on))}.`:`${base}.`;
  };
  return threadClause;
}

export function finishRow({ loadThreads, setConvoFor }) {
  const finishRow=async t=>{
    const convo=()=>setConvoFor({donor:{id:t.donorId,name:t.donorName},thread:t});
    // FLOWS-1 item 12: Done marks the step done (it opened Log a call every
    // time); logging a call is the optional link beside it.
    if(t.kind!=="task"||!t.doneRoute){
      try{
        await apiFetch(`/threads/${encodeURIComponent(t.id)}/done`,{method:"POST",body:JSON.stringify({})});
        loadThreads();
        offerUndo({message:`Done: ${t.nextStep.label}`,undoAction:async()=>{const r=await apiFetch(`/threads/${encodeURIComponent(t.id)}/done`,{method:"POST",body:JSON.stringify({done:false})});loadThreads();return r;}},t.nextStep.label);
      }catch(e){ console.warn("[thread done]",(e&&e.sentence)||(e&&e.message)); loadThreads(); }
      return;
    }
    try{
      await apiFetch(t.doneRoute,{method:"POST",body:JSON.stringify({done:true})});
      loadThreads();
      offerUndo({message:`Done: ${t.nextStep.label}`,undoAction:async()=>{const r=await apiFetch(t.doneRoute,{method:"POST",body:JSON.stringify({done:false})});loadThreads();return r;}},t.nextStep.label);
    }catch(e){ if(e&&e.error==="needs_outcome") convo(); }
  };
  finishRow.logCall=t=>setConvoFor({donor:{id:t.donorId,name:t.donorName},thread:t});
  return finishRow;
}
