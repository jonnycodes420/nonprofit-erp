// email-builder/BlocksTab.jsx · BUILDER-2B items 3 and 4. THE BLOCKS TAB.
//
// The org's saved blocks (everyone in the org sees them, newest first) and
// Steward's ready-made sections, each with a small picture of itself in the
// org's brand. A click adds a COPY under the selected part of the email; a
// drag drops a copy where the drop line shows. Never a live link: the server
// hands back fresh ids (POST /email-blocks/:id/use, /email-blocks/ready/:key/use).
// A saved block is renamed here, and removed through the one Remove (kind
// saved_block), whose Undo puts it back.
import { useEffect, useState, useCallback } from "react";
import { apiFetch } from "../../api";
import { T } from "../shared";
import { removeOne } from "../RemoveMenu";
import { errorMessage } from "../../lib/domainError";
import { DRAG_TYPE } from "./frameDnD";
import { paneNote, paneLabel, paneInput, paneBtn } from "./controls";

const parts = n => `${n} ${n === 1 ? "part" : "parts"}`;

// The email the block renders to, scaled down. The frame runs no script
// (sandboxed without allow-scripts, like the editor's other frames).
function Picture({ html, name }) {
  return (
    <div aria-hidden="true" style={{ height: 96, overflow: "hidden", borderRadius: 6, background: T.bg, position: "relative", pointerEvents: "none" }}>
      {html ? <iframe title={name} srcDoc={html} sandbox="allow-same-origin" tabIndex={-1}
        style={{ width: 640, height: 420, border: 0, transform: "scale(0.36)", transformOrigin: "0 0", position: "absolute", top: -8, left: -4 }} /> : null}
    </div>
  );
}

function Card({ item, kind, onUse, readOnly, onRenamed, onRemoved, say }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(item.name);
  const payload = kind === "saved" ? { saved: item.id } : { ready: item.key };
  const rename = async () => {
    const n = name.trim();
    setEditing(false);
    if (!n || n === item.name) { setName(item.name); return; }
    try { await apiFetch(`/email-blocks/${item.id}`, { method: "PUT", body: JSON.stringify({ name: n }) }); onRenamed(); say(`Renamed to ${n}.`); }
    catch (e) { setName(item.name); say(errorMessage(e, "That name did not save.")); }
  };
  return (
    <div data-testid={kind === "saved" ? "saved-block" : "ready-block"} data-block-id={item.id || item.key}
      style={{ border: "1px solid " + T.bg2, borderRadius: 10, background: T.white, padding: 8, marginBottom: 10 }}>
      <button type="button" disabled={readOnly} draggable={!readOnly} data-testid={(kind === "saved" ? "saved-block-use-" : "ready-block-use-") + (item.id || item.key)}
        title="Click to add it under the selected part, or drag it into the email"
        onDragStart={e => { try { e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(payload)); e.dataTransfer.effectAllowed = "copy"; } catch { /* older browser */ } }}
        onClick={() => onUse(payload)}
        style={{ display: "block", width: "100%", border: 0, background: "transparent", padding: 0, cursor: readOnly ? "not-allowed" : "grab", textAlign: "left", fontFamily: "inherit" }}>
        <Picture html={item.previewHtml} name={item.name} />
      </button>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 7 }}>
        {editing
          ? <input autoFocus style={{ ...paneInput, padding: "4px 7px" }} value={name} aria-label="Block name" data-testid="saved-block-name-input"
              onChange={e => setName(e.target.value)} onBlur={rename} onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { setName(item.name); setEditing(false); } }} />
          : <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600, color: T.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>}
        <span style={{ fontSize: 11.5, color: T.ink3, whiteSpace: "nowrap" }}>{parts(item.parts)}</span>
      </div>
      {kind === "saved" && !readOnly && !editing && (
        <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
          <button type="button" style={{ ...paneBtn, padding: "3px 9px", fontSize: 12 }} data-testid="saved-block-rename" onClick={() => setEditing(true)}>Rename</button>
          <button type="button" style={{ ...paneBtn, padding: "3px 9px", fontSize: 12 }} data-testid="saved-block-delete"
            onClick={() => removeOne({ kind: "saved_block", id: item.id, oneStep: true, onDone: onRemoved, onError: say })}>Delete</button>
        </div>
      )}
      {kind === "ready" && item.hint && <div style={{ ...paneNote, fontSize: 11.5, marginTop: 3 }}>{item.hint}</div>}
    </div>
  );
}

// onUse(payload): { saved: id } | { ready: key }. refresh: bumped after a save.
export function BlocksTab({ onUse, readOnly, refresh = 0, say = () => {} }) {
  const [saved, setSaved] = useState(null);
  const [ready, setReady] = useState(null);
  const [err, setErr] = useState("");
  const load = useCallback(() => {
    apiFetch("/email-blocks").then(r => { setSaved(r.saved || []); setErr(""); }).catch(e => { setSaved([]); setErr(errorMessage(e, "Your saved blocks could not be read.")); });
  }, []);
  useEffect(() => { load(); }, [load, refresh]);
  useEffect(() => { apiFetch("/email-blocks/ready").then(r => setReady(r.ready || [])).catch(() => setReady([])); }, []);
  return (
    <div data-testid="builder-blocks" data-saved-blocks={saved ? saved.length : 0} style={{ padding: 14 }}>
      <div style={{ ...paneLabel, marginBottom: 6 }}>Saved in your organization</div>
      {saved == null ? <div style={paneNote}>Reading your saved blocks…</div>
        : saved.length === 0
          ? <div data-testid="saved-blocks-empty" style={{ ...paneNote, marginBottom: 12 }}>None yet. Select any part of an email and press Save as a block in its settings; it shows here for everyone in your organization.</div>
          : saved.map(s => <Card key={s.id} item={s} kind="saved" onUse={onUse} readOnly={readOnly} onRenamed={load} onRemoved={load} say={say} />)}
      {err && <div role="alert" style={{ ...paneNote, color: T.ink, marginBottom: 10 }}>{err}</div>}
      <div style={{ ...paneLabel, margin: "14px 0 6px" }}>Ready-made, in your brand</div>
      {ready == null ? <div style={paneNote}>Reading…</div>
        : ready.map(r => <Card key={r.key} item={r} kind="ready" onUse={onUse} readOnly={readOnly} say={say} />)}
      <div style={{ ...paneNote, marginTop: 4 }}>Each one adds a copy, with a photo from Steward's library. Change anything in [brackets] before it is sent.</div>
    </div>
  );
}
