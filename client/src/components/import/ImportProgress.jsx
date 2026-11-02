import { useState, useEffect } from "react";
import { apiFetch } from "../../api";
import { T } from "../shared";
import { RecordLink } from "../RecordLink";
import { tabHref } from "../../lib/appUrls";

// FIX-37 · the recent-gift work runs behind the screen; this follows it.
export function ImportProgress({ runId, onDone }) {
  const [p, setP] = useState(null);
  useEffect(() => {
    if (!runId) return;
    let live = true, timer = null;
    const tick = () => apiFetch(`/imports/${runId}/progress`).then(r => {
      if (!live) return;
      setP(r);
      if (r && r.status === "running") timer = setTimeout(tick, 1200);
      else if (r && onDone) onDone(r);
    }).catch(() => { if (live) timer = setTimeout(tick, 3000); });
    tick();
    return () => { live = false; clearTimeout(timer); };
  }, [runId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!p || p.status !== "running") return null;
  return <div data-testid="import-progress" style={{textAlign:"left",fontSize:13,color:T.ink2,margin:"0 0 14px"}}>
    {p.sentence}. You can close this; the work carries on and the readout appears on Home when it is done.
  </div>;
}

// LIVE-1 · WHAT THIS FILE TOLD US, on the result screen: the readout's
// headline and the way to What changed, where each line has its rows.
export function ImportReadout({ readout }) {
  if (!readout || !readout.headline) return null;
  return (
    <div data-testid="import-readout" style={{textAlign:"left",border:"1px solid "+T.bg2,borderLeft:"3px solid "+T.greenDk,borderRadius:10,padding:"10px 14px",margin:"0 0 14px",fontSize:13.5,color:T.ink,lineHeight:1.6}}>
      <div style={{fontSize:10,fontWeight:800,color:T.ink3,marginBottom:2}}>What this told us</div>
      {readout.headline}.{" "}
      <RecordLink to={tabHref("agent", { agentView: "changed" })} style={{color:T.greenDk,fontWeight:700,textDecoration:"underline"}}>See who, and what to do</RecordLink>
    </div>
  );
}
