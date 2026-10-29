// components/SupportAccessCard.jsx · FIX-57. Settings → Security: whether
// Steward support may open this account. On by default; off ends any support
// session that is open now, and the super-admin console says "Support access
// is off". The server decides (routes/supportAccess.js); this shows and asks.
import { useEffect, useState } from "react";
import { T } from "./shared";
import { apiFetch } from "../api";
import { errorMessage } from "../lib/domainError";

const card = { background: T.white, border: "1px solid " + T.bg3, borderRadius: 16, padding: "20px 24px", marginBottom: 14 };
const primary = { background: T.green, color: T.white, border: "none", borderRadius: 9, padding: "8px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" };
const quiet = { background: T.white, color: T.ink, border: "1px solid " + T.ink, borderRadius: 9, padding: "7px 12px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" };
const when = iso => { try { return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); } catch { return ""; } };

export default function SupportAccessCard() {
  const [d, setD] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => { apiFetch("/support-access").then(setD).catch(() => setD(null)); }, []);
  if (!d) return null;
  async function set(on) {
    setBusy(true); setErr("");
    try { setD(await apiFetch("/support-access", { method: "PUT", body: JSON.stringify({ on }) })); }
    catch (e) { setErr(errorMessage(e, "That did not save.")); }
    setBusy(false);
  }
  return (
    <div data-testid="support-access-card" style={card}>
      <div style={{ fontSize: 15, fontWeight: 700, color: T.ink, marginBottom: 4 }}>{d.label}</div>
      <div style={{ fontSize: 13, color: T.ink, lineHeight: 1.55, marginBottom: 10 }}>{d.description}</div>
      {d.lastVisit && <div style={{ fontSize: 12.5, color: T.ink3, marginBottom: 10 }}>Last visit: {d.lastVisit.by}, {when(d.lastVisit.at)}. Every visit is in your Audit log.</div>}
      <button type="button" data-testid="support-access-toggle" disabled={busy} onClick={() => set(!d.on)} style={d.on ? quiet : primary}>
        {d.on ? "Turn support access off" : "Turn support access on"}
      </button>
      {err && <div style={{ fontSize: 12.5, color: T.ink, marginTop: 8 }}>{err}</div>}
    </div>
  );
}
