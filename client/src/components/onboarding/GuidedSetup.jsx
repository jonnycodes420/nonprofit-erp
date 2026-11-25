// ONBOARD-4 item 4, reshaped by ONBOARD-5 · HOME'S "FINISH SETTING UP".
// The setup itself is its own full page now (/onboard/setup, pages/setup/
// SetupPage.jsx): ten steps, one calm page at a time, its last page being
// ONBOARD-3's first people worth a call. Home shows one card of it until she
// presses "Go to Home" on the last page: how many are done, the connections she
// skipped (each still not connected), and the way back in. Read from
// GET /onboarding/guided (server/onboard/guided.js); nothing here ticks a step.
import { useEffect, useState } from "react";
import { apiFetch } from "../../api";
import { T } from "../shared";

const SERIF = "'DM Serif Display',Georgia,serif";

export default function GuidedSetup() {
  const [d, setD] = useState(null);
  useEffect(() => { apiFetch("/onboarding/guided").then(setD).catch(() => setD({ show: false })); }, []);
  if (!d || !d.show) return null;
  const here = (d.steps || []).find(s => s.id === d.current);
  return <section data-testid="guided-setup" aria-label="Finish setting up"
    style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 16, padding: "18px 20px", display: "flex", flexDirection: "column", gap: 10 }}>
    <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
      <h2 style={{ margin: 0, fontFamily: SERIF, fontSize: 24, fontWeight: 400, color: T.ink, flex: "1 1 240px" }}>
        Finish setting up <span data-testid="guided-count" style={{ color: T.ink3, fontSize: 18 }}>· {d.doneCount} of {d.total}</span></h2>
      <a href={`/onboard/setup${here ? `?step=${here.id}` : ""}`} data-testid="guided-continue"
        style={{ background: T.greenDk, color: T.white, borderRadius: 10, padding: "10px 16px", fontSize: 14, fontWeight: 700, textDecoration: "none", minHeight: 40, display: "inline-flex", alignItems: "center" }}>
        {d.doneCount || d.skippedCount ? "Continue setup" : "Start setup"}{here ? `: ${here.title}` : ""} →</a>
    </div>
    <div role="progressbar" aria-valuemin={0} aria-valuemax={d.total} aria-valuenow={d.doneCount} aria-label="Setup steps done" style={{ display: "flex", gap: 4 }}>
      {(d.steps || []).map(s => <span key={s.id} data-step={s.id} data-done={s.done ? "1" : "0"} style={{ flex: 1, height: 4, borderRadius: 2, background: s.done ? T.ink : T.bg3 }} />)}
    </div>
    {d.notConnected && d.notConnected.length ? <p data-testid="guided-not-connected" style={{ margin: 0, fontSize: 13.5, color: T.ink2 }}>
      Not connected yet: {d.notConnected.map((c, i) => <span key={c.id}>{i ? ", " : ""}<a href={`/onboard/setup?step=${c.id}`} data-not-connected={c.id} style={{ color: T.greenDk, fontWeight: 700 }}>{c.title}</a></span>)}. You skipped {d.notConnected.length === 1 ? "it" : "them"} for now.
    </p> : <p style={{ margin: 0, fontSize: 13, color: T.ink3 }}>{d.sentence}</p>}
  </section>;
}
