// SecurityPanel.jsx — SEC-1. Settings → Security.
//
// What a development director needs to tell her board: our donor data needs a
// password and a code, the owner can make that the rule, and anyone can see
// every browser signed in to their account and end it.
//
//   · Two-factor: an authenticator app (QR and key) or a code by email, ten
//     recovery codes shown once, new codes on demand, off only with a code
//   · The rule (owner): require two-factor for everyone on the team
//   · The team (owner): who has it, reset a teammate's, sign one out everywhere
//   · Sessions: browser, system, last active, the first three parts of the
//     address, "this browser", sign out one or everywhere else
//   · Change your password: every other session ends
//   · Download everything (BUILD-98), unchanged
import { useState, useEffect } from "react";
import { apiFetch, API, getToken } from "../api";
import { T, SectionLabel } from "./shared";
import { errorMessage } from "../lib/domainError";

const card = { background: T.white, border: "1px solid " + T.bg3, borderRadius: 16, padding: "24px 28px", marginTop: 16 };
const btn = { background: T.white, border: "1px solid " + T.bg3, borderRadius: 8, padding: "8px 14px", fontSize: 13, fontWeight: 700, color: T.ink, cursor: "pointer", fontFamily: "inherit" };
const primary = { ...btn, background: T.greenDk, borderColor: T.greenDk, color: T.white };
const inp = { background: T.white, border: "1px solid " + T.bg3, borderRadius: 8, padding: "8px 10px", fontSize: 14, color: T.ink, width: 140, fontFamily: "inherit" };
const small = { fontSize: 13, color: T.ink3, lineHeight: 1.55 };
const ago = ts => {
  const m = Math.floor((Date.now() - new Date(ts)) / 60000);
  if (m < 2) return "active now";
  if (m < 60) return `active ${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `active ${h} hour${h === 1 ? "" : "s"} ago`;
  return "active " + new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });
};
const saveToken = t => { if (t) localStorage.setItem("npe_token", t); };

export function RecoveryCodes({ codes, sentence }) {
  if (!codes || !codes.length) return null;
  const text = codes.join("\n");
  const download = () => {
    const url = URL.createObjectURL(new Blob([`Steward recovery codes\nEach works once.\n\n${text}\n`], { type: "text/plain" }));
    const a = document.createElement("a"); a.href = url; a.download = "steward-recovery-codes.txt";
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  };
  return (
    <div data-testid="recovery-codes" style={{ background: T.bg, border: "1px solid " + T.bg3, borderRadius: 12, padding: "14px 16px", marginTop: 10 }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: T.ink, marginBottom: 6 }}>Your recovery codes</div>
      <div style={small}>{sentence}</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 6, margin: "10px 0", fontFamily: "ui-monospace,Menlo,monospace", fontSize: 15, color: T.ink }}>
        {codes.map(c => <span key={c}>{c}</span>)}
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" onClick={() => navigator.clipboard?.writeText(text)} style={btn}>Copy</button>
        <button type="button" onClick={download} style={btn}>Download</button>
      </div>
    </div>
  );
}

export function SecurityPanel({ isAdmin }) {
  const [st, setSt] = useState(null);
  const [setup, setSetup] = useState(null);
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [sessions, setSessions] = useState(null);
  const [team, setTeam] = useState(null);
  const [pw, setPw] = useState({ current: "", next: "" });
  const load = () => {
    apiFetch("/me/mfa").then(setSt).catch(e => setMsg(errorMessage(e, "Could not read your sign-in settings.")));
    apiFetch("/me/sessions").then(r => setSessions(r)).catch(() => setSessions({ sessions: [] }));
    if (isAdmin) apiFetch("/org/team").then(r => setTeam(Array.isArray(r) ? r : [])).catch(() => setTeam([]));
  };
  useEffect(() => { load(); }, []);
  const act = async (fn, fallback) => { setMsg(""); setBusy(true); try { await fn(); } catch (e) { setMsg(e?.message && e.message !== "Request failed" ? e.message : errorMessage(e, fallback)); } setBusy(false); };

  const start = method => act(async () => { setSetup(await apiFetch("/me/mfa/setup", { method: "POST", body: JSON.stringify({ method }) })); setCode(""); setCodes(null); }, "Could not start setup.");
  const finish = () => act(async () => {
    const r = await apiFetch("/me/mfa/enable", { method: "POST", body: JSON.stringify({ code, method: setup.method }) });
    saveToken(r.token); setSetup(null); setCode(""); setCodes({ list: r.recoveryCodes, sentence: r.recoverySentence });
    setMsg("Two-factor is on."); load();
  }, "That code did not match.");
  const emailMe = () => act(async () => { const r = await apiFetch("/me/mfa/email-code", { method: "POST", body: "{}" }); setMsg(r.sentence); }, "Could not send a code.");
  const off = () => act(async () => {
    await apiFetch("/me/mfa/disable", { method: "POST", body: JSON.stringify({ code }) });
    setCode(""); setCodes(null); setMsg("Two-factor is off."); load();
  }, "That code did not match.");
  const newCodes = () => act(async () => {
    const r = await apiFetch("/me/mfa/recovery-codes", { method: "POST", body: JSON.stringify({ code }) });
    setCode(""); setCodes({ list: r.recoveryCodes, sentence: r.recoverySentence }); load();
  }, "That code did not match.");
  const setRule = (key, want) => act(async () => { await apiFetch("/org/security", { method: "PUT", body: JSON.stringify({ [key]: want }) }); load(); }, "Could not change that.");
  const signOut = id => act(async () => { await apiFetch(`/me/sessions/${id}/sign-out`, { method: "POST", body: "{}" }); load(); }, "Could not sign that session out.");
  const signOutOthers = () => act(async () => {
    const r = await apiFetch("/me/sessions/sign-out-others", { method: "POST", body: "{}" });
    saveToken(r.token); setMsg(`Signed out of ${r.ended} other ${r.ended === 1 ? "session" : "sessions"}.`); load();
  }, "Could not sign out the other sessions.");
  const resetMate = u => { if (window.confirm(`Reset two-factor for ${u.name || u.email}? They set it up again at their next sign-in, every session they have ends now, and they get an email saying you did it.`))
    act(async () => { const r = await apiFetch(`/org/users/${u.id}/mfa/reset`, { method: "POST", body: "{}" }); setMsg(r.sentence); load(); }, "Could not reset that."); };
  const kickMate = u => { if (window.confirm(`Sign ${u.name || u.email} out of every browser?`))
    act(async () => { const r = await apiFetch(`/org/users/${u.id}/sign-out-everywhere`, { method: "POST", body: "{}" }); setMsg(r.sentence); }, "Could not sign them out."); };
  const changePw = e => { e.preventDefault(); act(async () => {
    const r = await apiFetch("/me/password", { method: "POST", body: JSON.stringify(pw) });
    saveToken(r.token); setPw({ current: "", next: "" }); setMsg(r.sentence); load();
  }, "Your password did not change."); };
  const downloadAll = () => act(async () => {
    const r = await fetch(`${API}/org/export/full`, { headers: { Authorization: `Bearer ${getToken()}` } });
    if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || "Export failed"); }
    const blob = await r.blob(), url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url; a.download = `steward-everything-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  }, "Export failed");

  const codeBox = (label, go, goLabel) => (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
      <input value={code} onChange={e => setCode(e.target.value)} inputMode="text" autoComplete="one-time-code" placeholder="123456" aria-label={label} style={inp} />
      <button type="button" onClick={go} disabled={busy || !code} style={btn}>{goLabel}</button>
      {st?.method === "email" && <button type="button" onClick={emailMe} disabled={busy} style={{ ...btn, border: "none", textDecoration: "underline" }}>Email me a code</button>}
    </div>
  );

  return (
    <div data-testid="security-panel">
      <div style={card}>
        <SectionLabel>Two-factor sign-in</SectionLabel>
        {st?.demo && <div data-testid="security-demo" style={{ ...small, color: T.ink, background: T.bg, borderLeft: "3px solid " + T.gold, borderRadius: 8, padding: "10px 12px", marginBottom: 10 }}>{st.demoSentence}</div>}
        <div style={{ fontSize: 14, color: T.ink, marginBottom: 8 }}>
          Two-factor is <strong>{st ? (st.enabled ? "on" : "off") : "…"}</strong> for you
          {st?.enabled ? `, with ${st.method === "email" ? "a code by email" : "an authenticator app"}. ${st.recoveryCodesLeft} recovery code${st.recoveryCodesLeft === 1 ? "" : "s"} left.` : "."}
          {st?.orgRequires ? " Your organisation requires it for everyone." : st?.orgRequiresForAdmins ? " Your organisation requires it for administrators." : ""}
        </div>
        {st && !st.enabled && !setup && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" onClick={() => start("totp")} disabled={busy || st.demo} style={{ ...primary, opacity: st.demo ? 0.5 : 1 }}>Use an authenticator app</button>
            <button type="button" onClick={() => start("email")} disabled={busy || st.demo} style={{ ...btn, opacity: st.demo ? 0.5 : 1 }}>Use a code by email</button>
          </div>
        )}
        {setup && <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 6 }}>
          <div style={small}>{setup.sentence}</div>
          {setup.qr && <img src={setup.qr} alt="QR code for your authenticator app" width={180} height={180} style={{ border: "1px solid " + T.bg3, borderRadius: 8 }}/>}
          {setup.secret && <div style={small}>Or type this key: <code style={{ fontSize: 14, wordBreak: "break-all", color: T.ink }}>{setup.secret}</code></div>}
          <div style={{ display: "flex", gap: 8 }}>
            <input value={code} onChange={e => setCode(e.target.value)} inputMode="numeric" placeholder="123456" aria-label="Six-digit code" style={inp} />
            <button type="button" onClick={finish} disabled={busy || !code} style={primary}>Turn it on</button>
            <button type="button" onClick={() => setSetup(null)} style={{ ...btn, border: "none" }}>Cancel</button>
          </div>
        </div>}
        {codes && <RecoveryCodes codes={codes.list} sentence={codes.sentence}/>}
        {st && st.enabled && !codes && <>
          <div style={{ ...small, marginTop: 10 }}>To make new recovery codes{st.mustKeep ? "" : ", or to turn two-factor off"}, enter a current code.</div>
          {codeBox("A current code", newCodes, "Make new recovery codes")}
          {!st.mustKeep && <button type="button" onClick={off} disabled={busy || !code} style={{ ...btn, marginTop: 8 }}>Turn two-factor off</button>}
          {st.mustKeep && <div style={{ ...small, marginTop: 6 }}>It stays on: {st.orgRequires || st.orgRequiresForAdmins ? "your organisation requires it." : "super-admin accounts always use it."}</div>}
        </>}
        {isAdmin && st && !st.demo && <div style={{ marginTop: 16, borderTop: "1px solid " + T.bg2, paddingTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
          <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 14, color: T.ink }}>
            <input type="checkbox" data-testid="require-mfa" checked={!!st.orgRequires} disabled={busy} onChange={e => setRule("requireMfa", e.target.checked)} />
            Require two-factor for everyone on the team
          </label>
          <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 14, color: T.ink }}>
            <input type="checkbox" data-testid="require-admin-mfa" checked={!!st.orgRequiresForAdmins} disabled={busy} onChange={e => setRule("requireAdminMfa", e.target.checked)} />
            Require two-factor for admins
          </label>
          <div style={small}>Anyone without it is sent to set it up at their next sign-in, and sees nothing else until they have. Turn it on for yourself first.</div>
        </div>}
      </div>

      {isAdmin && !st?.demo && team && team.length > 1 && <div style={card}>
        <SectionLabel>Your team</SectionLabel>
        {team.map(u => (
          <div key={u.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "9px 0", borderTop: "1px solid " + T.bg2, flexWrap: "wrap" }}>
            <span style={{ fontSize: 14, color: T.ink }}><strong>{u.name || u.email}</strong> <span style={{ color: T.ink3 }}>· two-factor {u.mfa_enabled ? "on" : u.mfa_must_setup ? "reset, waiting for setup" : "off"}</span></span>
            <span style={{ display: "flex", gap: 6 }}>
              {u.mfa_enabled && <button type="button" onClick={() => resetMate(u)} disabled={busy} style={btn}>Reset two-factor</button>}
              <button type="button" onClick={() => kickMate(u)} disabled={busy} style={btn}>Sign out everywhere</button>
            </span>
          </div>
        ))}
      </div>}

      <div style={card}>
        <SectionLabel>Where you're signed in</SectionLabel>
        {sessions?.sentence && <div style={{ ...small, marginBottom: 8 }}>{sessions.sentence}</div>}
        {(sessions?.sessions || []).map(s => (
          <div key={s.id} data-testid="session-row" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "9px 0", borderTop: "1px solid " + T.bg2, flexWrap: "wrap" }}>
            <span style={{ fontSize: 14, color: T.ink }}>
              <strong>{s.browser} on {s.os}</strong>{s.thisBrowser ? " · this browser" : ""}
              <span style={{ color: T.ink3 }}> · {ago(s.lastActiveAt)}{s.ipPrefix ? ` · ${s.ipPrefix}` : ""}</span>
            </span>
            {!s.thisBrowser && !st?.demo && <button type="button" onClick={() => signOut(s.id)} disabled={busy} style={btn}>Sign out</button>}
          </div>
        ))}
        {!st?.demo && (sessions?.sessions || []).length > 1 && <button type="button" onClick={signOutOthers} disabled={busy} style={{ ...btn, marginTop: 10 }}>Sign out everywhere else</button>}
      </div>

      {!st?.demo && <form onSubmit={changePw} style={card}>
        <SectionLabel>Change your password</SectionLabel>
        <div style={{ ...small, marginBottom: 8 }}>Every other browser signed in to your account is signed out. This one stays.</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input type="password" autoComplete="current-password" placeholder="Current password" aria-label="Current password" value={pw.current} onChange={e => setPw(p => ({ ...p, current: e.target.value }))} style={{ ...inp, width: 200 }}/>
          <input type="password" autoComplete="new-password" placeholder="New password (8 or more)" aria-label="New password" value={pw.next} onChange={e => setPw(p => ({ ...p, next: e.target.value }))} style={{ ...inp, width: 220 }}/>
          <button type="submit" disabled={busy || !pw.current || pw.next.length < 8} style={btn}>Change password</button>
        </div>
      </form>}

      {isAdmin && <div style={card}>
        <SectionLabel>Your data</SectionLabel>
        <div style={{ ...small, marginBottom: 8 }}>
          Everything Steward holds for your organisation, every table, in one file. Passwords and sign-in secrets are left out.
        </div>
        <button type="button" onClick={downloadAll} disabled={busy} style={btn}>Download everything</button>
      </div>}
      {msg && <div role="status" style={{ fontSize: 13, color: T.ink, marginTop: 10 }}>{msg}</div>}
    </div>
  );
}
