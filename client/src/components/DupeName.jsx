// DupeName.jsx · POLISH-8 (W-1109-Fundraising-16X). A name that is not unique
// in its list says which one it is (shared/dupeNames.js) and offers Rename in
// place: the field opens where the name is, Enter saves, Escape cancels.
//   <DupeName row={c} rows={campaigns} path="campaigns" onRenamed={load} />
import { useState } from "react";
import { apiFetch } from "../api";
import { T } from "./shared";
import { disambiguator } from "../../../shared/dupeNames.js";

const linkBtn = { background: "none", border: "none", padding: 0, color: T.greenDk, fontSize: 11.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", textDecoration: "underline" };

export default function DupeName({ row, rows, path, onRenamed, canRename = true, opts }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(row.name || "");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const d = disambiguator(row, rows, opts);
  if (!d && !editing) return null;
  const stop = e => e.stopPropagation();
  const save = async () => {
    if (busy) return;
    setBusy(true); setErr("");
    try {
      await apiFetch(`/${path}/${encodeURIComponent(row.id)}/rename`, { method: "POST", body: JSON.stringify({ name }) });
      setEditing(false); onRenamed && onRenamed();
    } catch (e) { setErr((e && (e.sentence || e.message)) || "That name didn't save."); }
    setBusy(false);
  };
  if (editing) return (
    <span onClick={stop} style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginTop: 4 }}>
      <input autoFocus data-testid="dupe-rename-input" aria-label="New name" value={name} onChange={e => setName(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter") save(); if (e.key === "Escape") setEditing(false); }}
        style={{ fontSize: 12.5, padding: "4px 8px", border: "1px solid " + T.bg3, borderRadius: 6, fontFamily: "inherit" }} />
      <button type="button" data-testid="dupe-rename-save" onClick={save} disabled={busy} style={linkBtn}>Save</button>
      <button type="button" onClick={() => setEditing(false)} style={{ ...linkBtn, color: T.ink3 }}>Cancel</button>
      {err && <span style={{ fontSize: 11.5, color: T.ink }}>{err}</span>}
    </span>
  );
  return (
    <span data-testid="dupe-name" onClick={stop} style={{ display: "inline-flex", gap: 8, alignItems: "baseline", fontSize: 11.5, color: T.ink3, marginTop: 2 }}>
      <span data-testid="dupe-name-words">{d}</span>
      {canRename && <button type="button" data-testid="dupe-rename" onClick={() => { setName(row.name || ""); setEditing(true); }} style={linkBtn}>Rename</button>}
    </span>
  );
}
