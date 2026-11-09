import { T } from "../shared";
import { AskHero } from "../AskRail";
import { openTellSteward } from "../TellStewardOpen";
import { Suspense } from "react";
import { MOVES_WAIT, HomeMoves } from "./homeParts";

export function homeHead({ onMovesSettled, agentDaily, cancelEdit, data, editMode, enterEdit, firstName, greeting, homeDay, isReadOnly, layout, loadThreads, noDonorsYet, onNavigate, resetLayout, sampleStatus, saveEdit, setupFirst, surface, threadScope, todayLongStr, todayStr }) {
  return (
      <>
      {/* Greeting lives on the page's own cream background, between the nav
          and the goal card — not inside the dark card, where it read as a
          stray line of card copy rather than a page-level welcome.
          BUILD-13: when the org has set branding, the greeting leads with the
          org's logo + name in their accent — the "this is OUR system" payoff
          the moment they finish onboarding. Falls back to the plain greeting. */}
      {/* BUILD-87 F.3.1 — THE HEADER IS A GREETING AND A SENTENCE, IN THAT
          ORDER OF SIZE. It used to be the other way round: the org name at 16px
          bold sat above the note, so the biggest thing on her morning screen was
          the name of the place she already works. The org mark and the greeting
          are now ONE small line (the BUILD-13 "this is OUR system" payoff is
          kept, just demoted), and the note is the headline. */}
      {/* HOME-6 — ONE LEFT EDGE. The logo, the org's name and the greeting
          are one row, with Edit in its fixed slot at the right of the same
          row; the date sits directly under them, starting where the logo
          does. (The logo used to stand beside a column of its own, so the
          name and the date started 33 px right of it.) */}
      <div className="home-head" style={{display:"flex",flexDirection:"column",padding:0}}>
        <div style={{display:"flex",alignItems:"center",gap:10,minWidth:0,minHeight:22}}>
        {data.org?.logo&&<img src={data.org.logo} alt={data.org.name} style={{height:22,maxWidth:100,objectFit:"contain",borderRadius:4,flexShrink:0}}/>}
        <div style={{flex:1,minWidth:0}}>
          {/* BUILD-88d — ONE GREETING LINE, 14px, warm grey. The org's name
              keeps its place and loses its accent: on this line the brand
              colour was a third colour competing with the headline under it,
              and the org mark beside it already says whose system this is. */}
          {/* SHIFT-1 — ONE LINE, ALWAYS. This row wrapped (flexWrap) when the
              org's name and the greeting outgrew the column, and on a phone the
              column narrows when the Edit button arrives a beat after first
              paint: the row went 19 → 46 px and the date and everything under it
              dropped 27 px. "Good morning" is wider than "Good evening", so it
              happened only in the morning. Now the row never wraps: the org's
              name gives way with an ellipsis, the greeting and her name never do. */}
          <div data-testid="home-greeting" style={{display:"flex",alignItems:"baseline",gap:8,flexWrap:"nowrap",minWidth:0,whiteSpace:"nowrap",fontSize:14,lineHeight:1.35,minHeight:"1.35em",color:T.ink3}}>
            {data.org?.name&&<span title={data.org.name} style={{fontWeight:600,letterSpacing:"-0.01em",minWidth:0,flex:"0 1 auto",overflow:"hidden",textOverflow:"ellipsis"}}>{data.org.name}</span>}
            <span data-testid="home-greeting-line" style={{fontWeight:400,flexShrink:0}}>{greeting}</span>
          </div>
        </div>
        {/* BUILD-34 edit affordance — a quiet on-palette text button by the
            greeting, not a floating pencil. Done saves optimistically
            (rollback on error); Esc cancels; Reset restores the default. */}
        {/* SHIFT-1 — the Edit slot is there from the first paint, hidden until
            her layout has loaded, so its arrival never narrows the column
            beside it (that narrowing is what wrapped the greeting and the date). */}
        {(
          <div aria-hidden={layout===undefined||undefined} style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:16,flexShrink:0,marginTop:1,visibility:layout===undefined?"hidden":undefined}}>
            {editMode?(
              <>
                <button onClick={resetLayout} style={{background:"transparent",border:"none",padding:0,color:T.ink3,fontSize:12,fontWeight:700,cursor:"pointer"}}>Reset to default</button>
                <button onClick={cancelEdit} style={{background:"transparent",border:"none",padding:0,color:T.ink3,fontSize:12,fontWeight:700,cursor:"pointer"}}>Cancel</button>
                <button onClick={saveEdit} style={{background:"transparent",border:"none",padding:0,color:T.greenDk,fontSize:12,fontWeight:800,cursor:"pointer"}}>Done</button>
              </>
            ):(
              <button onClick={enterEdit} aria-label="Edit Home layout, reorder or hide sections"
                disabled={layout===undefined}
                style={{background:"transparent",border:"none",padding:0,color:T.greenDk,fontSize:12,fontWeight:700,cursor:"pointer"}}>Edit</button>
            )}
          </div>
        )}
        </div>
          {/* ── BUILD-89 — THE HEADER IS WARM ─────────────────────────────
              The morning sentence used to be a 34px serif headline, so the
              first thing anybody read after logging in was what they had not
              done: "Six people are waiting on you; Chen has been waiting two
              months." That is an accusation before coffee. The sentence is not
              deleted — it moved INTO the Thread's own header, where it is a
              summary of the list under it rather than a verdict on the person
              reading it. You get to the pressure when you go looking for it.
              The header is the greeting and the day. */}
          {/* SHIFT-2 — THE DAY NEVER RE-WRAPS. The serif is font-display
              optional (public/fonts/app-fonts.css), so a cold first load keeps
              the sized Georgia fallback and nothing swaps under her. Balanced,
              so "2" is never alone on the second line. */}
          {surface==="home"&&!editMode&&(
            <h1 className="home-day" style={{fontFamily:"'DM Serif Display',Georgia,serif",textWrap:"balance",fontSize:44,fontWeight:400,lineHeight:1.08,letterSpacing:"-0.02em",color:T.ink,margin:"6px 0 0"}}>
              {todayLongStr}
            </h1>
          )}
          {/* HOME-5 — no pace sentence. Home's header is the org, the greeting
              and the date. The comparison with last year lives on Fundraising
              and the Board, one click away; Home doesn't open with a gap. */}
          {/* The board screen says what it is and as of when, and nothing else
              about itself. */}
          {surface==="board"&&!editMode&&(
            <div style={{fontSize:12.5,color:T.ink3,marginTop:4}}>
              As of {todayStr}. Numbers a board can read.
            </div>
          )}
      </div>

      {/* HOME-TIDY 2 — THE CALL TO ACTION, UNDER THE GREETING. One box to ask
          a question or tell Steward what to do (the Agent's input moved here),
          over the two doors, Why and What, each saying what it is. */}
      {surface==="home"&&!editMode&&(
        <div style={{padding:0}}>
          {/* HOME-3 — the old "For you today" card and the Why and What doors
              are gone: pace is the sentence above, the moves are the deck below. */}
          <AskHero isReadOnly={isReadOnly} onStepTaken={()=>loadThreads(threadScope)} day={homeDay} doors={false}
            agent={{available:true,line:agentDaily&&agentDaily.line,
              onSend:t=>openTellSteward(null,{text:t,send:true}),
              onOpen:()=>openTellSteward(null)}}/>
        </div>
      )}
      {surface==="home"&&!editMode&&(
        <div style={{padding:0,marginTop:6}}>
          {setupFirst&&<div style={{marginBottom:18}}>{setupFirst}</div>}
          <Suspense fallback={MOVES_WAIT}><HomeMoves onNavigate={onNavigate} isReadOnly={isReadOnly} noDonors={noDonorsYet} importAbove={!!setupFirst} onSettled={onMovesSettled}
            sample={sampleStatus&&!sampleStatus.hasSampleData&&!isReadOnly} drift={()=>onNavigate&&onNavigate("donors",{view:"drift"})}/></Suspense>
        </div>
      )}
      </>
  );
}
