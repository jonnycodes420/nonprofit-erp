// PageHistoryPanel.jsx · a page's published versions, with Restore (GIVE-EDIT-1).
// Moved out of PortalEditor.jsx by PAGES-1 so the editor stays under 1,500
// lines; unchanged. Every giving, volunteer and membership page uses it.
import { useState, useEffect, useCallback } from "react";
import { apiFetch } from "../api";
import { errorMessage } from "../lib/domainError";
import { askConfirm } from "./ConfirmDialog";

import { T } from "./shared";

const E = { ink: T.ink, bg3: T.bg3, terra: T.ink, muted: T.ink3, white: T.white, editLine: T.bg3, body: T.ink, cream: T.ground, line: T.green650 };
const btnQuiet = { background: "transparent", color: E.cream, border: "1px solid " + E.line, borderRadius: 9, padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" };

export default function HistoryPanel({ apiBase, onClose, onRestored }) {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");
  const load = useCallback(() => {
    apiFetch(apiBase + "/history").then(r => setRows(Array.isArray(r?.versions) ? r.versions : []))
      .catch(e => { setRows([]); setErr(errorMessage(e, "Could not load the history.")); });
  }, [apiBase]);
  useEffect(() => { load(); }, [load]);
  const when = d => { try { return new Date(d).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); } catch { return ""; } };
  const restore = async (v) => {
    if (!(await askConfirm({ title: `Put version ${v.number} back?`, body: "It goes live straight away, at the same link. The page as it is now stays in this list, so you can come back to it.", yes: "Restore" }))) return;
    setBusy(v.id); setErr("");
    try { await apiFetch(`${apiBase}/history/${encodeURIComponent(v.id)}/restore`, { method: "POST", body: "{}" }); await onRestored(); load(); }
    catch (e) { setErr(errorMessage(e, "Could not restore that version.")); }
    setBusy("");
  };
  return (
    <div data-testid="history-panel">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <div style={{ fontSize: 13, fontWeight: 700 }}>History</div>
        <button onClick={onClose} aria-label="Close history" style={{ background: "none", border: "none", fontSize: 13, cursor: "pointer", color: E.muted }}>Done ✕</button>
      </div>
      <div style={{ fontSize: 12, color: E.muted, lineHeight: 1.5, marginBottom: 10 }}>Every publish is kept, with who did it and when. Restore puts that version live again.</div>
      {err && <div style={{ fontSize: 12, color: E.terra, marginBottom: 8 }}>{err}</div>}
      {rows === null ? <div style={{ fontSize: 12, color: E.muted }}>Loading…</div>
        : rows.length === 0 ? <div style={{ fontSize: 12.5, color: E.muted }}>Nothing published yet. The first Publish starts the history.</div>
        : rows.map((v, i) => (
          <div key={v.id} data-testid="history-row" style={{ background: E.white, border: "1px solid " + E.editLine, borderRadius: 10, padding: "10px 12px", marginBottom: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: E.body }}>Version {v.number}{i === 0 ? " · live now" : ""}</div>
            <div style={{ fontSize: 12, color: E.muted, marginTop: 2 }}>{v.baseline ? "As it was before the first edit here" : `${v.restoredFrom ? `Restored from version ${v.restoredFrom}` : "Published"} by ${v.byName || "someone on your team"}`} · {when(v.createdAt)}</div>
            {i > 0 && <button type="button" data-testid="history-restore" disabled={!!busy} onClick={() => restore(v)}
              style={{ ...btnQuiet, color: E.ink, borderColor: E.bg3, padding: "5px 12px", fontSize: 12, marginTop: 8 }}>{busy === v.id ? "Restoring…" : "Restore"}</button>}
          </div>
        ))}
    </div>
  );
}
