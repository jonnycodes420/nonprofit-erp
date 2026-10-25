// AtlasSettings.jsx · AGENT-5. SETTINGS > ATLAS: WHAT ATLAS WILL AND WON'T DO.
//
// The Agent page's Guardrails, in plain words: the rules every tool Atlas
// uses is held to (the six old personas' limits, now one list), whether the
// org's AI reading is on, and one switch that pauses Atlas for everyone.
import { useEffect, useState } from "react";
import { apiFetch } from "../api";
import { T } from "./shared";
import { useAtlasName } from "../lib/atlas";
import { errorMessage } from "../lib/domainError";

export function AtlasSettings({ isReadOnly, isAdmin, onNavigate }) {
  const name = useAtlasName();
  const [status, setStatus] = useState(null);
  const [paused, setPaused] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const load = () => {
    apiFetch("/atlas/status").then(setStatus).catch(() => setStatus(null));
    apiFetch("/agent/instructions").then(r => setPaused(!!(r && r.pausedAll))).catch(() => setPaused(null));
  };
  useEffect(() => { load(); }, []);
  const toggle = async () => {
    setBusy(true); setErr("");
    try { await apiFetch(paused ? "/agent/resume-all" : "/agent/pause-all", { method: "POST", body: "{}" }); load(); }
    catch (e) { setErr(errorMessage(e, "That didn't save.")); }
    setBusy(false);
  };
  const card = { background: T.white, border: "1px solid " + T.bg3, borderRadius: 16, padding: "20px 26px", marginBottom: 14 };
  const label = { fontSize: 11, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: T.ink3, marginBottom: 10 };
  return (
    <div data-testid="settings-atlas">
      <div style={{ ...card, display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap", borderLeft: "4px solid " + (paused ? "#C9A84C" : T.greenDk) }}>
        <div style={{ flex: "1 1 260px" }}>
          <div style={{ fontFamily: "'DM Serif Display',Georgia,serif", fontSize: 22, color: T.ink, marginBottom: 4 }}>{paused ? `${name} is paused.` : `${name} is on.`}</div>
          <div style={{ fontSize: 13.5, color: T.ink3, lineHeight: 1.55 }}>
            {paused ? `${name} does nothing for anyone here until you turn it back on.`
              : `${name} logs, adds to journeys and groups, sets reminders and drafts emails when you ask, each with Undo. Money and sending wait for your tap.`}
          </div>
          {status && status.ai === "off" && <div data-testid="settings-atlas-ai-off" style={{ fontSize: 13, color: T.ink, marginTop: 8, lineHeight: 1.5 }}>{status.aiOffLine}{" "}
            {onNavigate && <button type="button" onClick={() => onNavigate("settings", { section: "data" })} style={{ background: "none", border: "none", padding: 0, color: T.greenDk, fontWeight: 700, cursor: "pointer", fontSize: 13 }}>The AI switch is in Your Data.</button>}</div>}
        </div>
        {isAdmin && paused !== null && <button type="button" data-testid="settings-atlas-pause" disabled={isReadOnly || busy} onClick={toggle}
          style={{ background: paused ? T.greenDk : T.white, color: paused ? T.white : T.ink, border: "1px solid " + (paused ? T.greenDk : T.ink), borderRadius: 9, padding: "10px 18px", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
          {paused ? `Turn ${name} back on` : `Pause ${name}`}</button>}
      </div>
      {err && <div role="alert" style={{ ...card, fontSize: 13.5 }}>{err}</div>}
      <div style={card}>
        <div style={label}>What {name} will never do</div>
        {((status && status.rules) || []).map(r => (
          <div key={r.key} data-testid="settings-atlas-rule" style={{ fontSize: 14, color: T.ink, lineHeight: 1.5, padding: "8px 0", borderTop: "1px solid " + T.bg2 }}>{r.line}</div>))}
      </div>
    </div>
  );
}
