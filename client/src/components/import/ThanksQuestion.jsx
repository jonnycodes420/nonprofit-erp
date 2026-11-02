import { useState, useEffect } from "react";
import { apiFetch } from "../../api";
import { T } from "../shared";

// LIVE-1 · how many thank-you drafts these gifts will make, before saving.
// FIX-37: when the file would draft any, it asks whether they were thanked
// already (ThanksQuestion), and hands the preview up so the import can send
// the default when she leaves the answer alone.
export function ThankYouPreview({ dates, headers, answer, onAnswer, onPreview }) {
  const [pv, setPv] = useState(null);
  const key = (dates || []).join(",");
  useEffect(() => {
    const ds = (dates || []).filter(Boolean);
    if (!ds.length) { setPv(null); onPreview && onPreview(null); return; }
    let live = true;
    apiFetch("/imports/thank-you-preview", { method: "POST", body: JSON.stringify({ dates: ds, headers: headers || [] }) })
      .then(r => { if (live) { setPv(r); onPreview && onPreview(r); } }).catch(() => {});
    return () => { live = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!pv) return null;
  if (pv.ask && onAnswer) return <ThanksQuestion preview={pv} answer={answer} onChange={onAnswer}/>;
  return <div data-testid="gi-thankyou-preview" style={{fontSize:12.5,color:T.ink2,marginBottom:10,lineHeight:1.55}}>{pv.sentence}</div>;
}

// FIX-37 · "HAVE THE GIFTS FROM THE LAST 30 DAYS ALREADY BEEN THANKED?"
// Asked before saving whenever the file would draft thank-yous. The default
// comes from the server (importThanks.js) with the reason it was chosen.
export function ThanksQuestion({ preview, answer, onChange }) {
  if (!preview || !preview.ask) return null;
  const a = answer || preview.defaultAnswer || { mode: "all" };
  const pick = (mode) => onChange({ mode, ...(mode === "min" ? { min: a.min || 250 } : {}) });
  const opt = (mode, label, extra) => (
    <label key={mode} style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap",padding:"3px 0",cursor:"pointer"}}>
      <input type="radio" name="import-thanks" data-testid={`import-thanks-${mode}`} checked={a.mode===mode} onChange={()=>pick(mode)} style={{accentColor:T.greenDk}}/>
      <span>{label}</span>{extra}
    </label>);
  return (
    <div data-testid="import-thanks-question" style={{border:"1px solid "+T.bg2,borderRadius:10,padding:"10px 14px",marginBottom:10,fontSize:12.5,color:T.ink,lineHeight:1.55}}>
      <div style={{fontWeight:700,marginBottom:2}}>Have the gifts from the last 30 days already been thanked?</div>
      <div style={{color:T.ink3,marginBottom:6}}>
        {preview.thankYous.toLocaleString("en-US")} {preview.thankYous===1?"gift is":"gifts are"} from the last 30 days.
        {preview.defaultSentence?" "+preview.defaultSentence:""} Nothing is ever sent without you.
      </div>
      {opt("none","Yes, don't draft thank-yous")}
      {opt("all","No, draft them all")}
      {opt("min", a.mode==="min" ? "Only gifts of $" : "Only gifts of $___ or more", a.mode==="min"&&(
        <><input type="number" min="1" step="1" data-testid="import-thanks-min" value={a.min||""}
            onChange={e=>onChange({ mode:"min", min:Number(e.target.value)||0 })}
            style={{width:90,border:"1px solid "+T.bg3,borderRadius:6,padding:"3px 6px",fontSize:12.5,fontFamily:"inherit"}}/>
          <span>or more</span></>))}
    </div>
  );
}
