// components/SupportBanner.jsx · FIX-57. YOU ARE IN SOMEONE ELSE'S ACCOUNT.
//
// Shown on every page of a support session, brass ground and ink text, so it
// can never be mistaken for the org's own screen. It says whether changes are
// allowed; allowing them takes a second confirm, here, and the server refuses
// every change until then (requireAuth). Ending the session puts the
// super-admin's own session back.
import { useEffect, useState } from "react";
import { apiFetch } from "../api";
import { leaveSupport } from "../lib/supportSession";
import { T } from "./shared";

const INK = T.ink, BRASS = T.gold, WHITE = "#FFFFFF";
const BTN = { background: "transparent", border: "1.5px solid " + INK, borderRadius: 8, color: INK, fontSize: 12.5,
  fontWeight: 700, cursor: "pointer", padding: "5px 12px", whiteSpace: "nowrap", fontFamily: "inherit" };

export default function SupportBanner({ support: initial, orgName }) {
  const [support, setSupport] = useState(initial);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // The server's word on this session, not the copy saved at sign-in.
  useEffect(() => {
    apiFetch("/me").then(r => { if (r && r.support) setSupport(s => ({ ...s, ...r.support })); }).catch(() => {});
  }, []);

  async function allow() {
    setBusy(true); setErr("");
    try {
      const r = await apiFetch("/support-session/allow-changes", { method: "POST", body: JSON.stringify({ confirm: true }) });
      setSupport(s => ({ ...s, ...(r.support || {}), writable: true }));
      try {
        const u = JSON.parse(localStorage.getItem("npe_user") || "{}");
        localStorage.setItem("npe_user", JSON.stringify({ ...u, support: { ...(u.support || {}), writable: true } }));
      } catch { /* the banner state is enough */ }
      setAsking(false);
    } catch (e) { setErr(e.message || "Could not allow changes."); }
    setBusy(false);
  }

  async function end() {
    setBusy(true);
    try { await apiFetch("/support-session/end", { method: "POST", body: "{}" }); } catch { /* ending is best effort */ }
    if (!leaveSupport()) {
      localStorage.removeItem("npe_token"); localStorage.removeItem("npe_user"); localStorage.removeItem("npe_org");
      window.location.href = "/login";
    }
  }

  const name = (support && support.name) || "Steward support";
  const org = (support && support.orgName) || orgName || "this organization";
  const writable = !!(support && support.writable);

  return (
    <div role="status" data-testid="support-banner" data-writable={writable ? "1" : "0"}
      style={{ background: BRASS, color: INK, borderBottom: "2px solid " + INK, padding: "10px 24px",
               display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", fontSize: 13.5, lineHeight: 1.45 }}>
      <span style={{ flex: "1 1 260px", minWidth: 0 }}>
        <strong>{name}</strong> is viewing <strong>{org}</strong>.{" "}
        {writable
          ? "Changes are on. Each change is logged in their Activity as Steward support."
          : "Read-only: nothing you do here changes their account. This visit is in their Activity."}
      </span>
      {err && <span style={{ flexBasis: "100%", fontWeight: 600 }}>{err}</span>}
      {!writable && !asking && (
        <button type="button" data-testid="support-allow" onClick={() => setAsking(true)} disabled={busy} style={BTN}>Allow changes</button>
      )}
      {!writable && asking && (
        <span style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", flexBasis: "100%" }}>
          <span style={{ fontWeight: 600 }}>Allow changes in {org}? Each change is logged in their Activity as {name}.</span>
          <button type="button" data-testid="support-allow-confirm" onClick={allow} disabled={busy}
            style={{ ...BTN, background: INK, color: WHITE }}>Yes, allow changes</button>
          <button type="button" onClick={() => setAsking(false)} disabled={busy} style={BTN}>Cancel</button>
        </span>
      )}
      <button type="button" data-testid="support-end" onClick={end} disabled={busy} style={{ ...BTN, background: INK, color: WHITE }}>
        End support session
      </button>
    </div>
  );
}
