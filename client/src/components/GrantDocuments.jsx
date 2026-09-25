// BUILD-100 (grants) Part 7 — DOCUMENTS ON THE GRANT.
//
// Replaces the "File uploads coming soon" placeholder in GrantProfile. The
// server decides everything that matters — the type list (grantDocs.DOC_TYPES,
// sent with the read), the version number, whether the bytes are what they say
// — and mints a signed link per read that lives thirty minutes, so this never
// stores a URL and never guesses a type. `/grant-documents/*` is proxied in
// vercel.json (a bare-path image/link a browser fetches with no auth header —
// the BUILD-95 photo class; pinned by tests/email-links.test.js §4b).

import { useState, useEffect, useRef } from "react";
import { apiFetch } from "../api";
import { T } from "./shared";
import { errorMessage } from "../lib/domainError";

const ACCEPT = ".pdf,.doc,.docx,.jpg,.jpeg,.png,.webp,.txt";
const MAX_BYTES = 20 * 1024 * 1024;
const sizeLabel = b => !b ? "" : b >= 1024 * 1024 ? (b / 1024 / 1024).toFixed(1) + " MB" : Math.max(1, Math.round(b / 1024)) + " KB";
const dateLabel = iso => { const d = new Date(iso); return isNaN(d) ? "" : d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }); };
const inp = { border: "1px solid " + T.bg3, borderRadius: 8, padding: "7px 10px", fontSize: 13, color: T.ink, background: T.white, boxSizing: "border-box" };
const quietBtn = { background: T.white, border: "1px solid " + T.bg3, borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 700, color: T.ink, cursor: "pointer", minHeight: 36 };
const primaryBtn = { background: T.greenDk, border: "none", borderRadius: 8, padding: "7px 14px", fontSize: 12, fontWeight: 700, color: T.white, cursor: "pointer", minHeight: 36 };

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error("That file could not be read."));
    r.readAsDataURL(file);
  });
}

export function DocumentRow({ d, onDelete, isReadOnly, showGrant = false }) {
  return (
    <div data-testid="grant-document" style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderTop: "1px solid " + T.bg3, flexWrap: "wrap" }}>
      <div style={{ flex: "1 1 200px", minWidth: 0 }}>
        <a href={d.url} target="_blank" rel="noopener noreferrer"
          style={{ fontSize: 14, fontWeight: 600, color: T.greenDk, overflowWrap: "anywhere" }}>{d.fileName}</a>
        <div style={{ fontSize: 12, color: T.ink3 }}>
          {d.docTypeLabel}{d.version > 1 ? ` · version ${d.version}` : ""}
          {showGrant && d.program ? ` · ${d.program}` : ""}
          {` · ${dateLabel(d.uploadedAt)}`}{d.uploadedByName ? ` · ${d.uploadedByName}` : ""}{d.bytes ? ` · ${sizeLabel(d.bytes)}` : ""}
        </div>
        {d.notes && <div style={{ fontSize: 12, color: T.ink3 }}>{d.notes}</div>}
      </div>
      {!isReadOnly && onDelete && <button style={quietBtn} onClick={() => onDelete(d)}>Remove</button>}
    </div>
  );
}

export function GrantDocuments({ grantId, isReadOnly }) {
  const [data, setData] = useState(null);
  const [docType, setDocType] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [confirm, setConfirm] = useState(null);
  const fileRef = useRef(null);
  const load = () => apiFetch(`/grants/${grantId}/documents`).then(d => { setData(d); setDocType(t => t || d.docTypes?.[0]?.key || ""); })
    .catch(e => { setData({ documents: [], docTypes: [] }); setMsg(errorMessage(e, "The documents could not be loaded.")); });
  useEffect(() => { load(); }, [grantId]);

  const upload = async file => {
    if (!file) return;
    setMsg("");
    if (file.size > MAX_BYTES) { setMsg(`That file is ${sizeLabel(file.size)}. The limit is 20 MB.`); return; }
    setBusy(true);
    try {
      const dataUrl = await readAsDataUrl(file);
      await apiFetch(`/grants/${grantId}/documents`, { method: "POST", body: JSON.stringify({ docType, file: dataUrl, fileName: file.name, notes }) });
      setNotes(""); await load(); setMsg("Saved.");
    } catch (e) { setMsg(errorMessage(e, "That file did not save.")); }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = ""; }
  };
  const remove = async d => {
    setMsg("");
    try { await apiFetch(`/grants/documents/${d.id}`, { method: "DELETE" }); setConfirm(null); load(); }
    catch (e) { setMsg(errorMessage(e, "That document was not removed.")); }
  };
  if (!data) return null;
  return (
    <div data-testid="grant-documents" style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 12, padding: "12px 14px" }}>
      <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: T.ink3, marginBottom: 4 }}>Documents</div>
      {data.sentence && <div style={{ fontSize: 13, color: T.ink3, marginBottom: 4 }}>{data.sentence}</div>}
      {data.documents.map(d => (
        <div key={d.id}>
          <DocumentRow d={d} isReadOnly={isReadOnly} onDelete={setConfirm} />
          {confirm && confirm.id === d.id && (
            <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12, color: T.ink2, paddingBottom: 8, flexWrap: "wrap" }}>
              Remove {d.fileName} from this grant? It can be recovered for ninety days.
              <button style={{ ...quietBtn, borderColor: T.terracotta, color: T.terracotta }} onClick={() => remove(d)}>Remove</button>
              <button style={quietBtn} onClick={() => setConfirm(null)}>Keep it</button>
            </div>)}
        </div>))}
      {!isReadOnly && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 10 }}>
          <select value={docType} onChange={e => setDocType(e.target.value)} style={inp} data-testid="doc-type">
            {(data.docTypes || []).map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
          <input placeholder="Notes (optional)" value={notes} onChange={e => setNotes(e.target.value)} style={{ ...inp, flex: "1 1 140px" }} />
          <input ref={fileRef} type="file" accept={ACCEPT} style={{ display: "none" }} data-testid="doc-file" onChange={e => upload(e.target.files?.[0])} />
          <button style={primaryBtn} disabled={busy} onClick={() => fileRef.current?.click()}>{busy ? "Saving…" : "Attach a file"}</button>
        </div>)}
      <div style={{ fontSize: 11, color: T.ink3, marginTop: 6 }}>PDF, Word, images or plain text, up to 20 MB.</div>
      {msg && <div role="status" style={{ fontSize: 12, color: T.ink3, marginTop: 6 }}>{msg}</div>}
    </div>
  );
}
