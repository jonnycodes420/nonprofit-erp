// BUILD-98 (switch) Part 6 — API keys, for Zapier and anything else that
// reads Steward on the org's behalf.
//
// A key is shown ONCE, in the answer to the press that made it; Steward keeps
// only a fingerprint. Keys are read-only. Revoking keeps the row, so the list
// still says who made a key and when it was last used.
import { useState, useEffect } from "react";
import { apiFetch } from "../api";
import { T, SectionLabel } from "./shared";
import { errorMessage } from "../lib/domainError";

const day = v => (v ? new Date(v).toLocaleDateString() : null);

export function ApiKeysPanel({ isReadOnly }) {
  const [keys, setKeys] = useState(null);
  const [name, setName] = useState("");
  const [fresh, setFresh] = useState(null);
  const [msg, setMsg] = useState("");
  const load = () => apiFetch("/api-keys").then(r => setKeys(r.keys || [])).catch(e => setMsg(errorMessage(e, "Could not load your keys.")));
  useEffect(() => { load(); }, []);
  const make = async () => {
    setMsg("");
    try { const r = await apiFetch("/api-keys", { method: "POST", body: JSON.stringify({ name }) }); setFresh(r); setName(""); load(); }
    catch (e) { setMsg(errorMessage(e, "Could not make that key.")); }
  };
  const revoke = async id => {
    setMsg("");
    try { await apiFetch(`/api-keys/${id}`, { method: "DELETE" }); load(); }
    catch (e) { setMsg(errorMessage(e, "Could not revoke that key.")); }
  };
  const copy = async () => { try { await navigator.clipboard.writeText(fresh.key); setMsg("Key copied."); } catch (e) { setMsg(errorMessage(e, "Copy it by hand; the browser would not.")); } };
  const btn = { background: T.white, border: "1px solid " + T.bg3, borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 700, color: T.ink, cursor: "pointer" };
  return (
    <div data-testid="api-keys" style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 16, padding: "24px 28px" }}>
      <SectionLabel>API keys</SectionLabel>
      <p style={{ fontSize: 13, color: T.ink3, margin: "0 0 12px" }}>
        For Zapier or your own tools. A key can read your people and gifts and cannot change anything.
      </p>
      {!isReadOnly && <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="What it's for, e.g. Zapier"
          style={{ background: T.bg, border: "1px solid " + T.bg3, borderRadius: 8, padding: "7px 9px", fontSize: 13, color: T.ink, minWidth: 220 }} />
        <button onClick={make} disabled={!name.trim()} style={{ ...btn, background: T.greenDk, color: T.white, border: "none" }}>Make a key</button>
      </div>}
      {fresh && <div role="status" data-testid="api-key-fresh" style={{ background: T.bg, border: "1px solid " + T.gold500, borderRadius: 10, padding: "12px 14px", marginBottom: 12 }}>
        <div style={{ fontSize: 13, color: T.ink, marginBottom: 6 }}>{fresh.sentence}</div>
        <code style={{ fontSize: 12, wordBreak: "break-all", color: T.ink }}>{fresh.key}</code>
        <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
          <button onClick={copy} style={btn}>Copy</button>
          <button onClick={() => setFresh(null)} style={btn}>Done</button>
        </div>
      </div>}
      {keys && !keys.length && <div style={{ fontSize: 13, color: T.ink3 }}>No keys yet.</div>}
      {keys && keys.map(k => (
        <div key={k.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderTop: "1px solid " + T.bg2, fontSize: 13, color: T.ink }}>
          <span style={{ fontWeight: 700 }}>{k.name}</span>
          <code style={{ fontSize: 12, color: T.ink3 }}>{k.prefix}…</code>
          <span style={{ fontSize: 12, color: T.ink3 }}>
            {k.revokedAt ? `revoked ${day(k.revokedAt)}` : k.lastUsedAt ? `last used ${day(k.lastUsedAt)}` : "never used"}
            {k.createdBy ? ` · made by ${k.createdBy}` : ""}
          </span>
          {!k.revokedAt && <button onClick={() => revoke(k.id)} style={{ ...btn, marginLeft: "auto" }}>Revoke</button>}
        </div>))}
      {msg && <div role="status" style={{ fontSize: 12, color: T.ink3, marginTop: 8 }}>{msg}</div>}
    </div>
  );
}
