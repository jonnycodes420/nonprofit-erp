// BUILD-98 (switch) Part 8 — two-step sign-in and "download everything",
// in Settings → Account.
//
// Two-step sign-in is per person. The org rule ("administrators must use
// it") is an admin's switch, and the server refuses it to an admin who has
// not turned two-step on for themselves — nobody locks themselves out.
import { useState, useEffect } from "react";
import { apiFetch, API, getToken } from "../api";
import { T, SectionLabel } from "./shared";
import { errorMessage } from "../lib/domainError";

const btn = { background: T.white, border: "1px solid " + T.bg3, borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 700, color: T.ink, cursor: "pointer" };
const inp = { background: T.bg, border: "1px solid " + T.bg3, borderRadius: 8, padding: "7px 9px", fontSize: 13, color: T.ink, width: 110 };

export function SecurityPanel({ isAdmin }) {
  const [st, setSt] = useState(null);
  const [setup, setSetup] = useState(null);
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const load = () => apiFetch("/me/mfa").then(setSt).catch(e => setMsg(errorMessage(e, "Could not read your sign-in settings.")));
  useEffect(() => { load(); }, []);
  const act = async (fn, fallback) => { setMsg(""); setBusy(true); try { await fn(); } catch (e) { setMsg(errorMessage(e, fallback)); } setBusy(false); };

  const start = () => act(async () => { setSetup(await apiFetch("/me/mfa/setup", { method: "POST" })); setCode(""); }, "Could not start setup.");
  const finish = () => act(async () => {
    const r = await apiFetch("/me/mfa/enable", { method: "POST", body: JSON.stringify({ code }) });
    if (r.token) localStorage.setItem("npe_token", r.token);
    setSetup(null); setCode(""); setMsg("Two-step sign-in is on."); load();
  }, "That code did not match.");
  const off = () => act(async () => {
    await apiFetch("/me/mfa/disable", { method: "POST", body: JSON.stringify({ code }) });
    setCode(""); setMsg("Two-step sign-in is off."); load();
  }, "That code did not match.");
  const setRule = want => act(async () => {
    await apiFetch("/org/security", { method: "PUT", body: JSON.stringify({ requireAdminMfa: want }) }); load();
  }, "Could not change that.");
  const downloadAll = () => act(async () => {
    const r = await fetch(`${API}/org/export/full`, { headers: { Authorization: `Bearer ${getToken()}` } });
    if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || "Export failed"); }
    const blob = await r.blob(), url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url; a.download = `steward-everything-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  }, "Export failed");

  return (
    <div data-testid="security-panel" style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 16, padding: "24px 28px", marginTop: 16 }}>
      <SectionLabel>Sign-in and your data</SectionLabel>
      <div style={{ fontSize: 13, color: T.ink, marginBottom: 8 }}>
        Two-step sign-in is <strong>{st ? (st.enabled ? "on" : "off") : "…"}</strong> for you.
        {st && st.orgRequiresForAdmins ? " Your organisation requires it for administrators." : ""}
      </div>
      {st && !st.enabled && !setup && <button onClick={start} disabled={busy} style={btn}>Turn on two-step sign-in</button>}
      {setup && <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 6 }}>
        <div style={{ fontSize: 13, color: T.ink3 }}>{setup.sentence}</div>
        <code style={{ fontSize: 13, wordBreak: "break-all", color: T.ink }}>{setup.secret}</code>
        <div style={{ display: "flex", gap: 8 }}>
          <input value={code} onChange={e => setCode(e.target.value)} inputMode="numeric" placeholder="123456" aria-label="Six-digit code" style={inp} />
          <button onClick={finish} disabled={busy || !code} style={btn}>Finish</button>
        </div>
      </div>}
      {st && st.enabled && <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6 }}>
        <input value={code} onChange={e => setCode(e.target.value)} inputMode="numeric" placeholder="123456" aria-label="Six-digit code to turn it off" style={inp} />
        <button onClick={off} disabled={busy || !code} style={btn}>Turn off</button>
      </div>}
      {isAdmin && st && <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, color: T.ink, marginTop: 12 }}>
        <input type="checkbox" checked={!!st.orgRequiresForAdmins} disabled={busy} onChange={e => setRule(e.target.checked)} />
        Require two-step sign-in for every administrator
      </label>}
      {isAdmin && <div style={{ marginTop: 16, borderTop: "1px solid " + T.bg2, paddingTop: 12 }}>
        <div style={{ fontSize: 13, color: T.ink3, marginBottom: 8 }}>
          Everything Steward holds for your organisation, every table, in one file. Passwords and sign-in secrets are left out.
        </div>
        <button onClick={downloadAll} disabled={busy} style={btn}>Download everything</button>
      </div>}
      {msg && <div role="status" style={{ fontSize: 12, color: T.ink3, marginTop: 8 }}>{msg}</div>}
    </div>
  );
}
