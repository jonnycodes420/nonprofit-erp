// GRANTS-1 · THE GRANT LIBRARY.
//
// The pieces an organisation writes once and reuses in every application and
// report: the mission, the history, each program description, the budget, the
// board list, bios, the audit. Every save is a new version and the old one is
// kept, so "which version went to which funder" always has an answer
// (routes/grantLibrary.js). Every write offers the shared Undo.

import { useState, useEffect } from "react";
import { apiFetch } from "../api";
import { T } from "./shared";
import { errorMessage } from "../lib/domainError";
import { offerUndo } from "./EditHistory";

const inp = { border: "1px solid " + T.bg3, borderRadius: 8, padding: "7px 10px", fontSize: 13, color: T.ink, background: T.white, boxSizing: "border-box", fontFamily: "inherit" };
const quietBtn = { background: T.white, border: "1px solid " + T.bg3, borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 700, color: T.ink, cursor: "pointer", minHeight: 36, fontFamily: "inherit" };
const primaryBtn = { background: T.greenDk, border: "none", borderRadius: 8, padding: "7px 14px", fontSize: 12, fontWeight: 700, color: T.white, cursor: "pointer", minHeight: 36, fontFamily: "inherit" };
const card = { background: T.white, border: "1px solid " + T.bg3, borderRadius: 12, padding: "12px 14px" };
const eyebrow = { fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: T.ink3 };
const dateLabel = iso => { const d = new Date(iso); return isNaN(d) ? "" : d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }); };
const post = (path, body) => apiFetch(path, { method: "POST", body: JSON.stringify(body || {}) });
const put = (path, body) => apiFetch(path, { method: "PUT", body: JSON.stringify(body || {}) });

function PieceEditor({ kinds, initial, onSave, onCancel, busy }) {
  const [kind, setKind] = useState(initial.kind);
  const [title, setTitle] = useState(initial.title || "");
  const [body, setBody] = useState(initial.body || "");
  return (
    <div data-testid="library-editor" style={{ display: "grid", gap: 8, marginTop: 8 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <select aria-label="Kind" value={kind} onChange={e => setKind(e.target.value)} style={inp}>
          {kinds.map(k => <option key={k.key} value={k.key}>{k.label}</option>)}
        </select>
        <input aria-label="Title" placeholder="Title" value={title} onChange={e => setTitle(e.target.value)} style={{ ...inp, flex: "1 1 220px" }} />
      </div>
      <textarea aria-label="Text" value={body} onChange={e => setBody(e.target.value)} rows={8} style={{ ...inp, width: "100%", lineHeight: 1.5 }} />
      <div style={{ display: "flex", gap: 8 }}>
        <button style={primaryBtn} disabled={busy} onClick={() => onSave({ kind, title, body })}>{busy ? "Saving…" : "Save"}</button>
        <button style={quietBtn} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function Versions({ pieceId, onUse, isReadOnly }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    let alive = true;
    apiFetch(`/grant-library/${pieceId}/versions`).then(d => { if (alive) setData(d); })
      .catch(e => { if (alive) setErr(errorMessage(e, "The versions could not be loaded.")); });
    return () => { alive = false; };
  }, [pieceId]);
  if (err) return <div style={{ fontSize: 12, color: T.ink3 }}>{err}</div>;
  if (!data) return <div style={{ fontSize: 12, color: T.ink3 }}>Loading…</div>;
  return (
    <div data-testid="library-versions" style={{ marginTop: 8, borderTop: "1px solid " + T.bg2 }}>
      {data.versions.map(v => (
        <div key={v.id} style={{ padding: "8px 0", borderBottom: "1px solid " + T.bg2, fontSize: 12 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <strong style={{ color: T.ink }}>Version {v.version}</strong>
            <span style={{ color: T.ink3 }}>{dateLabel(v.createdAt)}{v.createdByName ? ` · ${v.createdByName}` : ""}</span>
            {!isReadOnly && v.version !== data.piece.version && (
              <button style={{ ...quietBtn, minHeight: 28, padding: "3px 10px" }} onClick={() => onUse(v)}>Use this version again</button>)}
          </div>
          {v.sentTo.length > 0 && (
            <div style={{ color: T.ink3, marginTop: 2 }}>
              Went to {v.sentTo.map(s => `${s.funderName || s.sentToName || "a funder"} on ${s.sentOn}`).join("; ")}
            </div>)}
          <div style={{ whiteSpace: "pre-wrap", color: T.ink2, marginTop: 4, maxHeight: 120, overflow: "auto" }}>{v.body}</div>
        </div>))}
    </div>
  );
}

export default function GrantLibrary({ isReadOnly = false }) {
  const [data, setData] = useState(null);
  const [msg, setMsg] = useState("");
  const [adding, setAdding] = useState(null);     // kind key
  const [editing, setEditing] = useState(null);   // piece id
  const [history, setHistory] = useState(null);   // piece id
  const [showArchived, setShowArchived] = useState(false);
  const [busy, setBusy] = useState(false);
  const load = () => apiFetch("/grant-library?archived=1").then(setData)
    .catch(e => { setData({ pieces: [], kinds: [] }); setMsg(errorMessage(e, "The library could not be loaded.")); });
  useEffect(() => { load(); }, []);

  const add = async v => {
    setBusy(true); setMsg("");
    try {
      const r = await post("/grant-library", v);
      setAdding(null); await load();
      offerUndo({ message: `Added ${r.piece.title}.`, undoAction: async () => { const x = await post(`/grant-library/${r.piece.id}/archive`); load(); return x; } }, "library piece");
    } catch (e) { setMsg(errorMessage(e, "That piece did not save.")); }
    finally { setBusy(false); }
  };
  const save = async (p, v) => {
    setBusy(true); setMsg("");
    try {
      const r = await put(`/grant-library/${p.id}`, v);
      setEditing(null); await load();
      if (r.unchanged) { setMsg("Nothing changed."); return; }
      const was = r.previous;
      offerUndo({ message: `Saved version ${r.piece.version} of ${r.piece.title}.`,
        undoAction: async () => { const x = await put(`/grant-library/${p.id}`, { kind: was.kind, title: was.title, body: was.body }); load(); return x; } }, "library piece");
    } catch (e) { setMsg(errorMessage(e, "That piece did not save.")); }
    finally { setBusy(false); }
  };
  const archive = async p => {
    setMsg("");
    try {
      await post(`/grant-library/${p.id}/archive`); await load();
      offerUndo({ message: `Archived ${p.title}.`, undoAction: async () => { const x = await post(`/grant-library/${p.id}/restore`); load(); return x; } }, "library piece");
    } catch (e) { setMsg(errorMessage(e, "That piece was not archived.")); }
  };
  const restore = async p => {
    setMsg("");
    try {
      await post(`/grant-library/${p.id}/restore`); await load();
      offerUndo({ message: `Restored ${p.title}.`, undoAction: async () => { const x = await post(`/grant-library/${p.id}/archive`); load(); return x; } }, "library piece");
    } catch (e) { setMsg(errorMessage(e, "That piece was not restored.")); }
  };

  if (!data) return <div style={{ fontSize: 13, color: T.ink3, padding: 16 }}>Loading…</div>;
  const live = data.pieces.filter(p => !p.archived);
  const archived = data.pieces.filter(p => p.archived);
  return (
    <div data-testid="grant-library" style={{ display: "grid", gap: 12 }}>
      <div>
        <div style={{ fontSize: 18, fontWeight: 700, color: T.ink }}>Library</div>
        <div style={{ fontSize: 13, color: T.ink3 }}>
          {live.length ? "Write each piece once and reuse it in every application and report. Every save keeps the version before it, so you can see which version went to which funder."
            : "Nothing here yet. Add your mission, your history and a description of each program once, and reuse them in every application and report."}
        </div>
      </div>
      {msg && <div role="status" style={{ fontSize: 12, color: T.ink3 }}>{msg}</div>}
      {data.kinds.map(k => {
        const pieces = live.filter(p => p.kind === k.key);
        return (
          <div key={k.key} style={card} data-testid={`library-kind-${k.key}`}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ ...eyebrow, flex: 1 }}>{k.label}</div>
              {!isReadOnly && (k.many || !pieces.length) && adding !== k.key && (
                <button style={quietBtn} onClick={() => { setAdding(k.key); setEditing(null); }}>Add</button>)}
            </div>
            {!pieces.length && adding !== k.key && <div style={{ fontSize: 13, color: T.ink3, marginTop: 4 }}>None yet.</div>}
            {pieces.map(p => (
              <div key={p.id} data-testid="library-piece" style={{ borderTop: "1px solid " + T.bg2, padding: "10px 0" }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <div style={{ flex: "1 1 200px", minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: T.ink }}>{p.title}</div>
                    <div style={{ fontSize: 12, color: T.ink3 }}>Version {p.version} · saved {dateLabel(p.updatedAt)}</div>
                  </div>
                  <button style={quietBtn} onClick={() => setHistory(h => (h === p.id ? null : p.id))}>{history === p.id ? "Hide versions" : "Versions"}</button>
                  {!isReadOnly && <button style={quietBtn} onClick={() => { setEditing(p.id); setAdding(null); }}>Edit</button>}
                  {!isReadOnly && <button style={quietBtn} onClick={() => archive(p)}>Archive</button>}
                </div>
                {editing === p.id
                  ? <PieceEditor kinds={data.kinds} initial={p} busy={busy} onSave={v => save(p, v)} onCancel={() => setEditing(null)} />
                  : <div style={{ fontSize: 13, color: T.ink2, whiteSpace: "pre-wrap", marginTop: 6, maxHeight: 96, overflow: "hidden" }}>{p.body || "(empty)"}</div>}
                {history === p.id && <Versions key={p.version} pieceId={p.id} isReadOnly={isReadOnly} onUse={v => save(p, { title: v.title, body: v.body })} />}
              </div>))}
            {adding === k.key && <PieceEditor kinds={data.kinds} initial={{ kind: k.key, title: k.label, body: "" }} busy={busy} onSave={add} onCancel={() => setAdding(null)} />}
          </div>
        );
      })}
      {archived.length > 0 && (
        <div style={card}>
          <button style={{ ...quietBtn, border: "none", padding: 0 }} onClick={() => setShowArchived(s => !s)}>
            {showArchived ? "Hide" : "Show"} {archived.length} archived {archived.length === 1 ? "piece" : "pieces"}
          </button>
          {showArchived && archived.map(p => (
            <div key={p.id} style={{ display: "flex", gap: 8, alignItems: "center", borderTop: "1px solid " + T.bg2, padding: "8px 0" }}>
              <div style={{ flex: 1, fontSize: 13, color: T.ink }}>{p.title} <span style={{ color: T.ink3 }}>· {p.kindLabel} · version {p.version}</span></div>
              {!isReadOnly && <button style={quietBtn} onClick={() => restore(p)}>Restore</button>}
            </div>))}
        </div>)}
    </div>
  );
}

export { GrantLibrary };
