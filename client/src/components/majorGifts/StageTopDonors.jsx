// majorGifts/StageTopDonors.jsx · COMMS-3 item 4. "SET STAGES FOR YOUR TOP 40".
// Communications → Audience links here when Major donors, Prospects or Ready to ask is 0
// because no one has a major-gift stage. It lists the top 40 by Lifetime with no stage
// (GET /pipeline/stage-top, the order of Reports' Top donors, Lifetime), each with a stage to
// pick. Nothing is set until "Set these stages" (POST /pipeline/stage-top).
import { useEffect, useState } from "react";
import { apiFetch } from "../../api";
import { T, fmtFull } from "../shared";
import { errorMessage } from "../../lib/domainError";

const STAGE_LABEL = { prospect: "Prospect", qualify: "Qualify", cultivate: "Cultivate", solicit: "Solicit", steward: "Ongoing care" };
const btn = { background: T.green, border: "none", borderRadius: 9, padding: "8px 14px", fontSize: 12.5, fontWeight: 700, color: T.white, cursor: "pointer", fontFamily: "inherit" };
const quiet = { background: T.white, border: "1px solid " + T.bg3, borderRadius: 9, padding: "7px 12px", fontSize: 12.5, color: T.ink, cursor: "pointer", fontFamily: "inherit" };

export function StageTopDonors({ isReadOnly, onDone, onClose }) {
  const [d, setD] = useState(null);
  const [pick, setPick] = useState({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  useEffect(() => { apiFetch("/pipeline/stage-top").then(setD).catch(e => setMsg(errorMessage(e, "Your top donors did not load."))); }, []);
  const chosen = Object.values(pick).filter(Boolean).length;
  const save = async () => {
    setBusy(true); setMsg("");
    try { const r = await apiFetch("/pipeline/stage-top", { method: "POST", body: JSON.stringify({ stages: pick }) }); setMsg(r.sentence); setPick({}); onDone && onDone(); }
    catch (e) { setMsg((e && e.sentence) || errorMessage(e, "No stage was set.")); }
    setBusy(false);
  };
  return (
    <section data-testid="stage-top" style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 14, padding: "18px 20px", marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: T.ink }}>Set stages for your top donors</div>
        {onClose && <button type="button" style={{ ...quiet, marginLeft: "auto" }} onClick={onClose}>Close</button>}
      </div>
      {d && <p style={{ fontSize: 13, color: T.ink3, margin: "4px 0 12px", lineHeight: 1.5 }}>{d.sentence}</p>}
      {!d && !msg && <div style={{ fontSize: 13, color: T.ink3 }}>Reading your top donors…</div>}
      {d && !d.people.length && <div style={{ fontSize: 13, color: T.ink3 }}>Every one of your top donors already has a stage.</div>}
      {d && d.people.length > 0 && (
        <div style={{ border: "1px solid " + T.bg2, borderRadius: 10, maxHeight: 420, overflowY: "auto" }}>
          {d.people.map((p, i) => (
            <div key={p.id} data-testid="stage-top-row" style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 12px", borderTop: i ? "1px solid " + T.bg2 : "none", flexWrap: "wrap" }}>
              <span style={{ width: 26, color: T.ink3, fontSize: 12, fontVariantNumeric: "tabular-nums" }}>{p.rank}</span>
              <span style={{ flex: "1 1 160px", fontWeight: 600, color: T.ink, fontSize: 13.5, minWidth: 0 }}>{p.name}</span>
              <span style={{ fontSize: 13, color: T.ink2, fontVariantNumeric: "tabular-nums" }}>{fmtFull(p.lifetime)}</span>
              <select value={pick[p.id] || ""} disabled={isReadOnly} onChange={e => setPick(s => ({ ...s, [p.id]: e.target.value }))} aria-label={`Stage for ${p.name}`}
                style={{ border: "1px solid " + T.bg3, borderRadius: 8, padding: "6px 8px", fontSize: 12.5, color: T.ink, background: T.white, fontFamily: "inherit" }}>
                <option value="">No stage</option>
                {d.stages.map(s => <option key={s} value={s}>{STAGE_LABEL[s] || s}</option>)}
              </select>
            </div>
          ))}
        </div>
      )}
      {d && d.people.length > 0 && !isReadOnly && (
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 12, flexWrap: "wrap" }}>
          <button type="button" data-testid="stage-top-save" style={{ ...btn, opacity: chosen ? 1 : 0.5 }} disabled={!chosen || busy} onClick={save}>
            {busy ? "Setting…" : chosen ? `Set ${chosen} ${chosen === 1 ? "stage" : "stages"}` : "Pick a stage for someone"}</button>
          <span style={{ fontSize: 12, color: T.ink3 }}>Anyone nobody owns yet goes on your board.</span>
        </div>
      )}
      {msg && <div role="status" style={{ fontSize: 13, color: T.ink, marginTop: 10 }}>{msg}</div>}
    </section>
  );
}
