// components/settings/TouchTypesCard.jsx · TOUCH-1. YOUR OWN KINDS OF TOUCH.
//
// "Log a touch" offers Call, Handwritten note, Email, Visit, Meeting, Gift
// sent, Event invite, Text and Other. An admin adds the org's own here
// ("Birthday card", "Board tour"), and they show as chips beside the others.
// Taking one off keeps every touch already logged as it, in its words.
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../../api";
import { T, SectionLabel } from "../shared";
import { errorMessage } from "../../lib/domainError";

export function TouchTypesCard({ isAdmin, isReadOnly }) {
  const [d, setD] = useState(null);
  const [label, setLabel] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const load = useCallback(() => apiFetch("/touch-types").then(setD).catch(e => setErr(errorMessage(e, "The kinds did not load."))), []);
  useEffect(() => { load(); }, [load]);
  const can = isAdmin && !isReadOnly;
  const add = async () => {
    if (!label.trim()) return;
    setErr(""); setMsg("");
    try { const r = await apiFetch("/touch-types", { method: "POST", body: JSON.stringify({ label }) }); setLabel(""); setMsg(`Added ${r.label}.`); load(); }
    catch (e) { setErr((e && e.sentence) || errorMessage(e, "That kind was not added.")); }
  };
  const remove = async c => {
    setErr(""); setMsg("");
    try { const r = await apiFetch(`/touch-types/${encodeURIComponent(c.id)}`, { method: "DELETE" }); setMsg(r.sentence); load(); }
    catch (e) { setErr((e && e.sentence) || errorMessage(e, "That kind was not taken off.")); }
  };
  const pill = { display: "inline-flex", alignItems: "center", gap: 6, background: T.white, border: "1px solid " + T.bg3, borderRadius: 99, padding: "4px 10px", fontSize: 12, color: T.ink };
  return (
    <div data-testid="settings-touch-types" style={{ background: T.bgCard, border: "1px solid " + T.bg3, borderRadius: 16, padding: "24px 28px", marginBottom: 16 }}>
      <SectionLabel>Kinds of touch</SectionLabel>
      <div style={{ fontSize: 12.5, color: T.ink3, margin: "10px 0 12px", lineHeight: 1.6 }}>
        What "Log a touch" offers when someone records what they did. Add your own; they show beside these.
      </div>
      {d && <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
        {d.kinds.map(k => <span key={k.key} style={{ ...pill, color: T.ink3 }}>{k.label}</span>)}
        {d.custom.map(c => <span key={c.id} style={pill} data-testid="touch-type-custom">{c.label}
          {can && <button type="button" aria-label={`Take ${c.label} off`} onClick={() => remove(c)} style={{ background: "none", border: "none", padding: 0, color: T.ink3, cursor: "pointer", fontSize: 14 }}>×</button>}</span>)}
      </div>}
      {can ? (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input value={label} onChange={e => setLabel(e.target.value)} maxLength={40} aria-label="A kind of touch" placeholder="Birthday card"
            onKeyDown={e => { if (e.key === "Enter") add(); }}
            style={{ padding: "8px 10px", border: "1px solid " + T.bg3, borderRadius: 8, fontSize: 13, background: T.white, color: T.ink, minWidth: 200 }} />
          <button type="button" onClick={add} disabled={!label.trim()} data-testid="touch-type-add"
            style={{ background: T.greenDk, border: "none", borderRadius: 8, padding: "8px 14px", color: T.white, fontSize: 13, fontWeight: 700, cursor: "pointer", opacity: label.trim() ? 1 : 0.5 }}>Add</button>
        </div>
      ) : <div style={{ fontSize: 12, color: T.ink3 }}>An admin can add your organization's own kinds.</div>}
      {msg && <div style={{ fontSize: 12, color: T.greenDk, marginTop: 8 }}>{msg}</div>}
      {err && <div role="alert" style={{ fontSize: 12, color: T.gold700, marginTop: 8 }}>{err}</div>}
    </div>
  );
}
