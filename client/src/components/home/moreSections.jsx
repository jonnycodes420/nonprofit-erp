import { T, PersonMark, fmtFull, interactive } from "../shared";
import { DonorLink } from "../RecordLink";
import { displayName } from "../../../../shared/displayName.js";
import { displayDateShort } from "../../../../shared/displayDate";
import { openTellSteward } from "../TellStewardOpen";
import { atlasName } from "../../lib/atlas";

export function monthlySection({ cPad, cardWrap, onNavigate, recurringHealth, sHdr, sHdrPad, sLink, sSerif, t }) {
  return (
  (recurringHealth&&(recurringHealth.fromFile||0)>0)?(
    <div style={{...cardWrap}}>
      <div className="dash-cpad" style={{...cPad,...sHdrPad,...sHdr}}>
        <span style={sSerif}>Your {t("monthly_giver",2)}</span>
        <button onClick={()=>onNavigate("fundraising",{frSection:"recurring"})} style={sLink}>Open Recurring Giving →</button>
      </div>
      <div style={{padding:"14px 20px",display:"flex",alignItems:"baseline",gap:18,flexWrap:"wrap"}}>
        <div style={{fontSize:13.5,color:T.ink,lineHeight:1.6}}>
          <strong style={{fontSize:22,fontFamily:"'DM Serif Display',serif"}}>{(recurringHealth.fromFile||0).toLocaleString()}</strong> in your file
          {" · "}<strong>{(recurringHealth.givingFromFile||0).toLocaleString()}</strong> giving
          {(recurringHealth.stoppedFromFile||0)>0&&<> · <strong style={{color:T.terracotta}}>{recurringHealth.stoppedFromFile.toLocaleString()}</strong> stopped</>}
        </div>
        {(recurringHealth.stoppedFromFile||0)>0&&(
          <button onClick={()=>onNavigate("fundraising",{frSection:"recurring"})}
            style={{background:T.gold500,border:"none",borderRadius:9,padding:"9px 16px",color:T.ink,fontSize:13,fontWeight:700,cursor:"pointer"}}>
            Send reconnect links →
          </button>
        )}
      </div>
      {(recurringHealth.stoppedWithoutEmail||0)>0&&(
        <div style={{padding:"0 20px 12px",fontSize:11.5,color:T.ink3}}>{recurringHealth.stoppedWithoutEmail} have no email on file and can't be sent a link.</div>
      )}
    </div>
  ):null
  );
}

export function thankYouSection({ TY_WORDS, cPad, cardWrap, onNavigate, onPanel, sHdr, sHdrPad, sLink, sSerif, setTyOpen, setTyShowAll, thankYous, tyAct, tyCopied, tyCopy, tyErr, tyFooter, tyMarkAll, tyOpen, tyOpenDraft, tyShowAll }) {
  return (
  (thankYous&&thankYous.count>0)?(
    <div style={{...cardWrap}} data-testid="thank-you-queue">
      <div className="dash-cpad" style={{...cPad,...sHdrPad,...sHdr}}>
        <div style={{minWidth:0,display:"flex",flexDirection:"column",alignItems:"flex-start",gap:8}}>
          <span style={sSerif}>{thankYous.headline}</span>
          {thankYous.voice&&!thankYous.voice.ready&&(
            <div data-testid="ty-voice-line" style={{fontSize:12,lineHeight:1.5,color:T.ink3}}>
              Plain for now. Paste {TY_WORDS[thankYous.voice.needs]||thankYous.voice.needs} of your own thank-yous and Steward will write like you.
            </div>
          )}
        </div>
        {thankYous.voice&&!thankYous.voice.ready&&(
          <button data-testid="ty-voice-link" /* FIX-55: the voice screen itself */ onClick={()=>onNavigate("settings",{section:"account",focus:"voice"})} style={{...sLink,whiteSpace:"nowrap"}}>Teach Steward your voice →</button>
        )}
      </div>
      <div style={{display:"flex",flexDirection:"column"}}>
        {thankYous.drafts.slice(0,tyShowAll?thankYous.drafts.length:6).map(d=>(
          <div key={d.id} data-thank-you={d.id} style={{padding:onPanel?"12px 0":"12px 24px",borderTop:"1px solid "+T.bg2}}>
            <div style={{display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
              <PersonMark id={d.donorId} name={d.donorName} size={30}/>
              <div style={{flex:"1 1 180px",minWidth:0,display:"flex",alignItems:"baseline",gap:10,flexWrap:"wrap"}}>
                <DonorLink id={d.donorId} onOpen={()=>onNavigate("donors",{selectDonorId:d.donorId})}
                  style={{background:"none",border:"none",padding:0,font:"inherit",fontSize:14,fontWeight:700,color:T.ink,cursor:"pointer",textAlign:"left"}}>{displayName(d.donorName)}</DonorLink>
                <span style={{fontSize:13,color:T.ink2,fontVariantNumeric:"tabular-nums"}}>{fmtFull(d.amount)}{d.fundName?` · ${d.fundName}`:""}</span>
                {d.giftDate&&<span style={{fontSize:12.5,color:T.ink3}}>{displayDateShort(d.giftDate,new Date())}</span>}
                {d.opened&&<span style={{fontSize:11.5,color:T.ink3}}>opened</span>}
              </div>
              <button onClick={()=>tyOpen===d.id?setTyOpen(null):tyOpenDraft(d)} data-testid="ty-open" aria-expanded={tyOpen===d.id}
                style={{flexShrink:0,background:T.white,border:"1px solid "+T.ink,borderRadius:8,padding:"7px 14px",color:T.ink,fontSize:12.5,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap"}}>
                {tyOpen===d.id?"Close":"Read the draft"}
              </button>
            </div>
            {tyOpen===d.id&&(
              <div style={{marginTop:10}}>
                <textarea readOnly value={d.body} aria-label={`Thank-you for ${d.donorName}`}
                  style={{width:"100%",minHeight:130,background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"10px 12px",color:T.ink,fontSize:13,lineHeight:1.55,fontFamily:"inherit",resize:"vertical",boxSizing:"border-box"}}/>
                <div style={{display:"flex",gap:8,marginTop:8,flexWrap:"wrap"}}>
                  <button onClick={()=>tyCopy(d)} data-testid="ty-copy"
                    style={{background:T.greenDk,border:"none",borderRadius:8,padding:"7px 14px",color:T.white,fontSize:12.5,fontWeight:700,cursor:"pointer"}}>{tyCopied===d.id?"Copied ✓":"Copy"}</button>
                  <button onClick={()=>tyAct(d.id,"sent")} data-testid="ty-sent"
                    style={{background:"transparent",border:"1px solid "+T.ink,borderRadius:8,padding:"7px 14px",color:T.ink,fontSize:12.5,fontWeight:700,cursor:"pointer"}}>Mark sent</button>
                  <button onClick={()=>tyAct(d.id,"skip")} data-testid="ty-skip"
                    style={{background:"transparent",border:"1px solid "+T.bg3,borderRadius:8,padding:"7px 14px",color:T.ink3,fontSize:12.5,cursor:"pointer"}}>Skip</button>
                  <span style={{fontSize:11.5,color:T.ink3,alignSelf:"center"}}>Steward does not send this. It goes from your own mail.</span>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
      {tyFooter&&(
      <div style={{padding:onPanel?"10px 0 0":"10px 24px 14px",display:"flex",gap:12,alignItems:"center",flexWrap:"wrap"}}>
        {thankYous.drafts.length>6&&(
          <button onClick={()=>setTyShowAll(v=>!v)} style={sLink}>{tyShowAll?"Show fewer":`and ${thankYous.drafts.length-6} more`}</button>
        )}
        {thankYous.allOpened&&(
          <button onClick={tyMarkAll} data-testid="ty-mark-all"
            style={{background:"transparent",border:"1px solid "+T.bg3,borderRadius:8,padding:"6px 12px",color:T.ink3,fontSize:12,fontWeight:600,cursor:"pointer"}}>Mark all as sent</button>
        )}
        {tyErr&&<span role="alert" style={{fontSize:12,color:T.terracotta}}>{tyErr}</span>}
      </div>
      )}
    </div>
  ):null
  );
}

export function agentSection({ agentAsk, agentDaily, agentEmpty, agentText, cardWrap, sLink, setAgentText }) {
  return (
    <div style={{...cardWrap}} data-testid="agent-box">
      <div style={{display:"flex",flexDirection:"column",gap:10}}>
        {/* BUILD-96 Part 3 — A GATED ORG GETS A SENTENCE, NOT AN INPUT.
            The agent sends this organisation's rows and vocabulary to
            Anthropic, and there are two reasons it may not: no key is
            configured on Steward's side, or this org turned it off. Either
            way she gets the reason instead, and nothing to type into. */}
        {agentDaily&&agentDaily.available===false?(
          <div style={{display:"flex",gap:12,alignItems:"baseline",flexWrap:"wrap"}}>
            <span data-testid="agent-unavailable" style={{fontSize:13,lineHeight:1.55,color:T.ink3}}>
              {agentDaily.message||"Not enabled for this organization yet."}
            </span>
            <button onClick={()=>openTellSteward(null)} style={sLink}>Open {atlasName()} →</button>
          </div>
        ):(<>
        {agentDaily&&agentDaily.line&&(
          <div data-testid="agent-daily-line"
            {...interactive(()=>openTellSteward(null),{label:agentDaily.line+" Open "+atlasName()+"."})}
            style={{alignSelf:"flex-start",fontSize:13.5,lineHeight:1.5,color:T.ink,borderRadius:6}}>
            {agentDaily.line}
          </div>
        )}
        <form onSubmit={e=>{e.preventDefault();agentAsk();}} style={{display:"flex",gap:8,alignItems:"center"}}>
          <input data-testid="agent-input" value={agentText} onChange={e=>setAgentText(e.target.value)}
            aria-label={`Tell ${atlasName()} what to do. Enter asks ${atlasName()}.`}
            placeholder={`Tell ${atlasName()} what to do…`}
            style={{flex:"1 1 auto",minWidth:0,boxSizing:"border-box",border:"1px solid "+T.bg3,borderRadius:10,background:T.white,
                    padding:"10px 12px",fontSize:14,fontFamily:"inherit",color:T.ink}}/>
          <button data-testid="agent-ask" type="submit" disabled={agentEmpty} aria-label={`Go. ${atlasName()} does it here.`}
            style={{flexShrink:0,background:T.greenDk,border:"1px solid "+T.greenDk,borderRadius:10,padding:"10px 20px",color:T.white,
                    fontSize:14,fontWeight:700,cursor:agentEmpty?"not-allowed":"pointer"}}>
            Go
          </button>
        </form>
        </>)}
      </div>
    </div>
  );
}

export function sequencesSection({ cPad, cardWrap, onNavigate, sHdr, sHdrPad, sLink, sTitle, seqLines }) {
  return (
  (seqLines&&seqLines.length)?(
    <div style={{...cardWrap}}>
      <div className="dash-cpad" style={{...cPad,...sHdrPad,...sHdr}}>
        <span style={sTitle}>Sequences</span>
        <button onClick={()=>onNavigate("communications",{subtab:"sequences"})} style={sLink}>Open →</button>
      </div>
      <div style={{padding:"10px 20px 14px",display:"flex",flexDirection:"column",gap:8}}>
        {seqLines.map(s=>(
          <div key={s.id} data-testid="home-sequence-line"
            style={{fontSize:13.5,lineHeight:1.55,color:s.failedCount>0?T.gold700:T.ink}}>
            {s.line}
            {s.status!=="active"&&<span style={{color:T.ink3}}> · off</span>}
          </div>
        ))}
      </div>
    </div>
  ):null
  );
}
