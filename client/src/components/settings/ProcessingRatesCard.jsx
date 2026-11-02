import { useState, useEffect } from "react";
import { apiFetch } from "../../api";
import { T, SectionLabel } from "../shared";

// ── GIVE-2 §2 and §5 · WHAT A DONOR IS OFFERED, AND WHAT IT COSTS ──────────
// Two facts an organisation cannot see anywhere else, in one card beside the
// cover-the-fee switch they both bear on:
//
//   WHICH METHODS APPEAR. Steward no longer pins Checkout to cards, so a donor
//   is offered whatever the org's own Stripe account accepts. That is a report
//   of their Stripe settings, not a Steward setting, and the card says so
//   rather than offering switches that would not do anything.
//
//   WHAT THE PROCESSOR TAKES. The number the cover-the-fee box asks a donor to
//   add. It was Stripe's published card rate hard-coded in three files, which
//   is wrong in the expensive direction for an org on Stripe's nonprofit rate
//   and for every bank transfer.
export function ProcessingRatesCard({orgId,isAdmin,isReadOnly}){
  const [data,setData]=useState(null);
  const [cardPct,setCardPct]=useState("");
  const [cardFlat,setCardFlat]=useState("");
  const [achPct,setAchPct]=useState("");
  const [achFlat,setAchFlat]=useState("");
  const [achCap,setAchCap]=useState("");
  const [saving,setSaving]=useState(false);
  const [err,setErr]=useState("");
  const [savedAt,setSavedAt]=useState(0);

  function fill(d){
    setData(d);
    const c=d?.rates?.card||{}, a=d?.rates?.ach||{};
    setCardPct(String(Math.round((Number(c.pct)||0)*1e4)/100));
    setCardFlat(String(Math.round(Number(c.flatCents)||0)));
    setAchPct(String(Math.round((Number(a.pct)||0)*1e4)/100));
    setAchFlat(String(Math.round(Number(a.flatCents)||0)));
    setAchCap(a.capCents==null?"":String(Math.round(Number(a.capCents))));
  }
  useEffect(()=>{
    apiFetch("/give-settings/payment-methods").then(fill).catch(()=>setData({connected:false,methods:[]}));
  },[]);

  async function save(){
    if(saving)return;
    setSaving(true);setErr("");
    try{
      // THE PERCENTAGE IS TYPED AS A PERCENTAGE. `pctDisplay` is the server's
      // own name for that, so the conversion to a fraction happens in ONE
      // place (`shared/processingRates.js`) rather than here and there.
      await apiFetch(`/orgs/${orgId}`,{method:"PATCH",body:JSON.stringify({processingRates:{
        card:{pctDisplay:Number(cardPct),flatCents:Math.round(Number(cardFlat)||0)},
        ach:{pctDisplay:Number(achPct),flatCents:Math.round(Number(achFlat)||0),
             capCents:achCap===""?null:Math.round(Number(achCap))},
      }})});
      const fresh=await apiFetch("/give-settings/payment-methods");
      fill(fresh);
      setSavedAt(Date.now());
    }catch(e){ setErr(e?.message||"That did not save."); }
    setSaving(false);
  }
  async function reset(){
    if(saving)return;
    setSaving(true);setErr("");
    try{
      await apiFetch(`/orgs/${orgId}`,{method:"PATCH",body:JSON.stringify({processingRates:{card:null,ach:null}})});
      const fresh=await apiFetch("/give-settings/payment-methods");
      fill(fresh);
      setSavedAt(Date.now());
    }catch(e){ setErr(e?.message||"That did not save."); }
    setSaving(false);
  }

  const num={background:T.bg,border:"1px solid "+T.bg3,borderRadius:8,padding:"8px 10px",
             color:T.ink,fontSize:13,fontFamily:"inherit",width:86};
  const lbl={fontSize:12,color:T.ink3,display:"block",marginBottom:4};

  return(
    <div style={{background:T.white,border:"1px solid "+T.bg3,borderRadius:16,padding:"24px 28px",marginBottom:20}}>
      <SectionLabel>How Donors Can Pay, And What It Costs</SectionLabel>
      <div style={{fontSize:13,color:T.ink3,lineHeight:1.6,marginTop:6,marginBottom:16}}>
        {data?.definition||"What a donor is offered on your donation form, and the rate the cover-the-fee box asks them to add."}
      </div>

      {/* WHAT WILL APPEAR. A report, not a set of switches. */}
      {data&&data.asked?(
        <ul className="pm-list" style={{margin:"0 0 14px",padding:0,listStyle:"none"}}>
          {data.methods.map(m=>(
            <li key={m.key} style={{display:"flex",gap:10,alignItems:"flex-start",padding:"7px 0",borderTop:"1px solid "+T.bg2}}>
              <span style={{fontSize:12,fontWeight:700,color:m.active?(T.greenDk||T.ink):T.gold,
                            minWidth:66,paddingTop:1}}>
                {m.active?"On":"Not on"}
              </span>
              <span style={{flex:1}}>
                <span style={{fontSize:13,fontWeight:600,color:T.ink}}>{m.label}</span>
                <span style={{display:"block",fontSize:12,color:T.ink3,lineHeight:1.5}}>{m.note}</span>
              </span>
            </li>
          ))}
          {(data.notOffered||[]).map(m=>(
            <li key={m.key} style={{display:"flex",gap:10,alignItems:"flex-start",padding:"7px 0",borderTop:"1px solid "+T.bg2}}>
              <span style={{fontSize:12,fontWeight:700,color:T.ink3,minWidth:66,paddingTop:1}}>Never</span>
              <span style={{flex:1}}>
                <span style={{fontSize:13,fontWeight:600,color:T.ink}}>{m.label}</span>
                <span style={{display:"block",fontSize:12,color:T.ink3,lineHeight:1.5}}>{m.why}</span>
              </span>
            </li>
          ))}
        </ul>
      ):(
        <div className="pm-unasked" style={{fontSize:13,color:T.ink3,lineHeight:1.6,marginBottom:14}}>
          {data?.message||"Reading your Stripe settings…"}
        </div>
      )}
      {data?.howToChange&&(
        <div style={{fontSize:12,color:T.ink3,lineHeight:1.6,marginBottom:18}}>{data.howToChange}</div>
      )}

      {/* THE RATE. Typed as a percentage, because that is how Stripe prints it. */}
      <div style={{borderTop:"1px solid "+T.bg2,paddingTop:16}}>
        <div style={{fontSize:13,fontWeight:700,color:T.ink,marginBottom:4}}>Your processing rate</div>
        <div style={{fontSize:12,color:T.ink3,lineHeight:1.6,marginBottom:12}}>
          {data?.coverFeeDefinition||""} Leave these alone unless Stripe has approved you for a different rate.
        </div>
        <div style={{display:"flex",gap:18,flexWrap:"wrap",alignItems:"flex-end"}}>
          <div>
            <label style={lbl}>Card percent</label>
            <input className="rate-card-pct" value={cardPct} disabled={!isAdmin||isReadOnly||saving}
              onChange={e=>setCardPct(e.target.value.replace(/[^0-9.]/g,""))} style={num} inputMode="decimal"/>
          </div>
          <div>
            <label style={lbl}>Card flat (cents)</label>
            <input className="rate-card-flat" value={cardFlat} disabled={!isAdmin||isReadOnly||saving}
              onChange={e=>setCardFlat(e.target.value.replace(/[^0-9]/g,""))} style={num} inputMode="numeric"/>
          </div>
          <div>
            <label style={lbl}>Bank percent</label>
            <input className="rate-ach-pct" value={achPct} disabled={!isAdmin||isReadOnly||saving}
              onChange={e=>setAchPct(e.target.value.replace(/[^0-9.]/g,""))} style={num} inputMode="decimal"/>
          </div>
          <div>
            <label style={lbl}>Bank cap (cents)</label>
            <input className="rate-ach-cap" value={achCap} disabled={!isAdmin||isReadOnly||saving}
              onChange={e=>setAchCap(e.target.value.replace(/[^0-9]/g,""))} style={num} inputMode="numeric"/>
          </div>
        </div>
        {data?.rates&&(
          <div className="rate-sentences" style={{fontSize:12,color:T.ink3,marginTop:10,lineHeight:1.6}}>
            Card: {data.rates.card.sentence}. Bank transfer: {data.rates.ach.sentence}.
          </div>
        )}
        {isAdmin&&!isReadOnly&&(
          <div style={{display:"flex",gap:10,alignItems:"center",marginTop:12,flexWrap:"wrap"}}>
            <button onClick={save} disabled={saving}
              style={{background:T.greenDk||T.ink,color:T.white,border:"none",borderRadius:8,
                      padding:"9px 16px",fontSize:13,fontWeight:700,cursor:saving?"default":"pointer"}}>
              {saving?"Saving…":"Save the rate"}
            </button>
            <button onClick={reset} disabled={saving}
              style={{background:"none",border:"none",padding:0,color:T.ink3,fontSize:12,
                      textDecoration:"underline",cursor:saving?"default":"pointer"}}>
              Use Stripe&rsquo;s published rate
            </button>
            {savedAt>0&&<span style={{fontSize:12,color:T.greenDk||T.green}}>Saved</span>}
          </div>
        )}
        {err&&<div style={{fontSize:12,color:T.gold,marginTop:8}}>{err}</div>}
        {!isAdmin&&<div style={{fontSize:12,color:T.ink3,marginTop:8}}>Only an admin can change this.</div>}
      </div>
    </div>
  );
}
