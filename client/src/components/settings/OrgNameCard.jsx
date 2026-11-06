// client/src/components/settings/OrgNameCard.jsx · FLOWS-2 item 5.
// Settings → Organization: the organization's name, and an admin can change it.
// Before this the name here was text only. The one screen that had a name
// field was /welcome's "org basics" step, reached from Open setup → "Set it up
// yourself": for an org that has finished onboarding, WelcomePage draws its
// fields on the first render and its effect then sends you to /dashboard, so
// the field rendered once and vanished. The name is edited here now, and saved
// through PATCH /orgs/:id (the route /welcome uses); the app's own copy of the
// org is read again (refreshOrg), so the top bar and every page say the new name.
import { useEffect, useState } from "react";
import { apiFetch } from "../../api";
import { errorMessage } from "../../lib/domainError";
import { T } from "../shared";

export function OrgNameCard({ org, isAdmin, isReadOnly, onSaved }) {
  const [name, setName] = useState(org && org.name || "");
  const [shown, setShown] = useState(org && org.name || "Your organization");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  // The name as the server has it, not the copy this browser kept at sign-in.
  useEffect(() => {
    let live = true;
    apiFetch("/org").then(o => { if (live && o && o.name) { setShown(o.name); setName(n => (editing ? n : o.name)); } }).catch(() => {});
    return () => { live = false; };
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  const save = async () => {
    const next = name.trim();
    if (!next) { setMsg("Type the organization's name."); return; }
    setBusy(true); setMsg("");
    try {
      await apiFetch(`/orgs/${org.id}`, { method: "PATCH", body: JSON.stringify({ name: next }) });
      setShown(next); setEditing(false); setMsg("Saved. Steward uses the new name everywhere.");
      if (onSaved) onSaved();
    } catch (e) { setMsg(errorMessage(e, "The name didn't save. Try again.")); }
    setBusy(false);
  };
  const field = { width: "100%", maxWidth: 420, background: T.white, border: "1px solid " + T.bg3, borderRadius: 8, padding: "8px 10px", fontSize: 14, color: T.ink, fontFamily: "inherit" };
  const btn = primary => ({ background: primary ? T.greenDk : "transparent", color: primary ? T.white : T.ink2, border: primary ? "none" : "1px solid " + T.bg3,
    borderRadius: 8, padding: "7px 14px", fontSize: 12.5, fontWeight: 700, cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1 });
  return (
    <div data-testid="settings-org-name">
      <div style={{ fontSize: 11, fontWeight: 700, color: T.ink3, marginBottom: 6 }}>Organization</div>
      {editing ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 12, color: T.ink2 }}>Organization name</span>
            <input data-testid="settings-org-name-input" value={name} onChange={e => setName(e.target.value)} maxLength={200} autoFocus style={field}
              onKeyDown={e => { if (e.key === "Enter") save(); if (e.key === "Escape") setEditing(false); }} />
          </label>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" data-testid="settings-org-name-save" style={btn(true)} disabled={busy} onClick={save}>{busy ? "Saving…" : "Save"}</button>
            <button type="button" style={btn(false)} disabled={busy} onClick={() => { setEditing(false); setName(shown); setMsg(""); }}>Cancel</button>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
          <div data-testid="settings-org-name-text" style={{ fontSize: 15, fontWeight: 700, color: T.ink }}>{shown}</div>
          {isAdmin && !isReadOnly && <button type="button" data-testid="settings-org-name-edit" onClick={() => { setEditing(true); setMsg(""); }}
            style={{ background: "none", border: "none", padding: 0, color: T.greenDk, fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>Edit name</button>}
        </div>
      )}
      {msg && <div role="status" style={{ fontSize: 12.5, color: T.ink3, marginTop: 6 }}>{msg}</div>}
    </div>
  );
}

export default OrgNameCard;
