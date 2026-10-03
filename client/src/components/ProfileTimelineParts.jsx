// client/src/components/ProfileTimelineParts.jsx — PARITY-1 Part B.
//
// The pieces the profile's one timeline ("Everything with …", in
// MeetingPanels.jsx) uses for its filters, its list view and its files:
//
//   TIMELINE_FILTERS     All · Gifts · Conversations · Tasks · Notes · Emails ·
//                        Attachments, the leader's set, in its order
//   isMassEmail          a campaign, an appeal or a sequence step sent to many
//                        people, as against an email to this one person
//   loadTimelinePrefs /  the chosen filter, the mass-email switch and the view,
//   saveTimelinePrefs    remembered per viewer in this browser (try/catch: a
//                        private window has no storage and the page still works)
//   TimelineListView     the compact table: date, type, summary, by whom
//   AttachmentChips      the files on one entry, each a download
//   AttachButton         "Attach a file" on an existing entry
//   AttachFileField      the same, on a log form before it is saved
//   uploadAttachment     the one upload call both of those make
//
// Files are stored per org through the asset seam and opened through a
// thirty-minute signed link (interactionFiles.js). Nothing scans them for
// viruses: the host offers no scanner, and the page does not pretend.
import { useRef, useState } from "react";
import { apiFetch } from "../api";
import { T } from "./shared";
import { askConfirm } from "./ConfirmDialog";
import { errorMessage } from "../lib/domainError";
import { downloadFile } from "../lib/downloadFile";

export const FILE_MAX_BYTES = 10 * 1024 * 1024;
export const FILE_ACCEPT = ".pdf,.png,.jpg,.jpeg,.gif,.webp,.heic,.heif,.doc,.docx,.xls,.xlsx,.csv,.txt";
const PREFS_KEY = "steward.profileTimeline.v1";
export const ATTACHMENTS_CHANGED = "steward:attachments-changed";

export const TIMELINE_FILTERS = [
  ["all", "All"], ["gift", "Gifts"], ["conversation", "Conversations"], ["task", "Tasks"],
  ["note", "Notes"], ["email", "Emails"], ["file", "Attachments"],
  // PARITY-3 — a logged volunteer shift. Shown as a chip only on a record
  // that has one.
  ["service", "Volunteer service"],
];
const FILTER_KEYS = new Set(TIMELINE_FILTERS.map(f => f[0]));

export function loadTimelinePrefs() {
  const d = { filter: "all", hideMass: false, view: "cards" };
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    if (!raw) return d;
    const p = JSON.parse(raw) || {};
    return {
      filter: FILTER_KEYS.has(p.filter) ? p.filter : "all",
      hideMass: p.hideMass === true,
      view: p.view === "list" ? "list" : "cards",
    };
  } catch { return d; }
}
export function saveTimelinePrefs(p) {
  try { window.localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch { /* no storage: the choice lasts this visit */ }
}

const metaOf = i => { try { return typeof i?.metadata === "string" ? JSON.parse(i.metadata || "{}") : (i?.metadata || {}); } catch { return {}; } };

// A MASS email is one the organisation sent to many people at once: a campaign
// or appeal (server.js writes metadata.via = "campaign" after each delivery),
// the "Opened campaign" line the open-tracker writes, and a sequence step
// (created_by system:sequence, or the older "Sequence:" line). An email typed
// in, synced from an inbox or approved from the queue is one-to-one.
export function isMassEmail(i) {
  if (!i || i.type !== "email") return false;
  const m = metaOf(i);
  if (m.via === "campaign" || m.campaignId || m.campaign_id) return true;
  if (String(i.created_by || "") === "system:sequence") return true;
  const note = String(i.note || "");
  return /^Opened campaign:/.test(note) || /^Sequence:/.test(note);
}

// Which filter one logged entry answers to. A meeting, a call, a visit, an ask,
// a stewardship touch, an event: a Conversation. A note: a Note. An email: an
// Email. A gift's own entry is the gift.
export function interactionBucket(i) {
  const t = String(i?.type || "");
  if (t === "email") return "email";
  if (t === "note") return "note";
  if (t === "gift") return "gift";
  return "conversation";
}

export function fileSize(bytes) {
  const n = Number(bytes) || 0;
  if (n >= 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + " MB";
  if (n >= 1024) return Math.round(n / 1024) + " KB";
  return n + " bytes";
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ""));
    r.onerror = () => reject(new Error("That file could not be read."));
    r.readAsDataURL(file);
  });
}

// The one upload. Refuses an oversize file before sending it; the server
// checks the size, the type and the first bytes again, and its sentence wins.
export async function uploadAttachment(interactionId, file) {
  if (!interactionId || !file) throw new Error("Nothing to attach.");
  if (file.size > FILE_MAX_BYTES) {
    throw new Error(`That file is ${fileSize(file.size)}. The limit is 10 MB.`);
  }
  const dataUrl = await readAsDataUrl(file);
  const row = await apiFetch(`/interactions/${interactionId}/attachments`, {
    method: "POST", body: JSON.stringify({ file: dataUrl, fileName: file.name }),
  });
  try { window.dispatchEvent(new CustomEvent(ATTACHMENTS_CHANGED, { detail: { interactionId } })); } catch { /* old browser */ }
  return row;
}

const linkBtn = { background: "none", border: "none", padding: 0, color: T.greenDk, fontWeight: 700, fontSize: 13,
  textDecoration: "underline", cursor: "pointer", font: "inherit" };

// FIX-20 Part 0: the file is fetched with the session and saved from the
// bytes (lib/downloadFile.js); a bare link opened elsewhere is a 404.

export function AttachmentChips({ files = [], canRemove = false, onRemoved }) {
  const [busy, setBusy] = useState("");
  if (!files.length) return null;
  const remove = async (f) => {
    if (!(await askConfirm({ title: `Remove ${f.fileName}?`, body: "The file comes off this entry and is not kept. This cannot be undone.", yes: "Remove file", danger: true }))) return;
    setBusy(f.id);
    try {
      await apiFetch(`/interactions/${f.interactionId}/attachments`, { method: "DELETE", body: JSON.stringify({ attachmentId: f.id }) });
      try { window.dispatchEvent(new CustomEvent(ATTACHMENTS_CHANGED)); } catch { /* old browser */ }
      onRemoved && onRemoved(f);
    } catch (e) { window.alert(errorMessage(e, "That file was not removed.")); }
    setBusy("");
  };
  return (
    <div data-testid="tl-files" onClick={e => e.stopPropagation()} style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      {files.map(f => (
        <span key={f.id} style={{ display: "inline-flex", alignItems: "center", gap: 8, border: "1px solid " + T.bg3,
          borderRadius: 999, padding: "5px 12px", background: T.bg, fontSize: 13, maxWidth: "100%" }}>
          <a href={f.url || undefined} download={f.fileName} rel="noreferrer" title={`${f.fileName}, ${fileSize(f.bytes)}`}
            onClick={e => { e.preventDefault(); if (f.url) downloadFile(f.url, f.fileName).catch(x => window.alert(x.message)); }}
            style={{ color: T.ink, fontWeight: 600, textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 260 }}>
            {f.fileName}
          </a>
          <span style={{ color: T.ink3, whiteSpace: "nowrap" }}>{fileSize(f.bytes)}</span>
          {canRemove && <button type="button" onClick={() => remove(f)} disabled={busy === f.id} aria-label={`Remove ${f.fileName}`}
            style={{ background: "none", border: "none", padding: 0, color: T.ink3, cursor: "pointer", fontSize: 13, textDecoration: "underline" }}>
            {busy === f.id ? "Removing…" : "Remove"}</button>}
        </span>
      ))}
    </div>
  );
}

// "Attach a file" on an entry that already exists.
export function AttachButton({ interactionId, onAttached }) {
  const ref = useRef(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const pick = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true); setErr("");
    try { const row = await uploadAttachment(interactionId, file); onAttached && onAttached(row); }
    catch (x) { setErr(errorMessage(x, "That file did not attach.")); }
    setBusy(false);
  };
  return (
    <span onClick={e => e.stopPropagation()} style={{ display: "inline-flex", flexDirection: "column", gap: 4 }}>
      <input ref={ref} type="file" accept={FILE_ACCEPT} onChange={pick} style={{ display: "none" }} data-testid="tl-attach-input"/>
      <button type="button" onClick={() => ref.current && ref.current.click()} disabled={busy} data-testid="tl-attach" style={linkBtn}>
        {busy ? "Attaching…" : "Attach a file"}</button>
      {err && <span role="alert" style={{ fontSize: 12, color: T.ink }}>{err}</span>}
    </span>
  );
}

// The field on a log form: picks the file now, uploads it once the entry has
// an id. `file` and `setFile` belong to the form.
export function AttachFileField({ file, setFile, labelStyle }) {
  const ref = useRef(null);
  const [err, setErr] = useState("");
  const pick = (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!f) return;
    if (f.size > FILE_MAX_BYTES) { setErr(`That file is ${fileSize(f.size)}. The limit is 10 MB.`); return; }
    setErr(""); setFile(f);
  };
  return (
    <div data-testid="log-attach" style={{ marginBottom: 14 }}>
      <span style={labelStyle}>File (optional)</span>
      <input ref={ref} type="file" accept={FILE_ACCEPT} onChange={pick} style={{ display: "none" }}/>
      {file
        ? <span style={{ display: "inline-flex", gap: 10, alignItems: "center", fontSize: 13, color: T.ink }}>
            <span style={{ fontWeight: 600 }}>{file.name}</span><span style={{ color: T.ink3 }}>{fileSize(file.size)}</span>
            <button type="button" onClick={() => setFile(null)} style={{ ...linkBtn, color: T.ink3, fontWeight: 400 }}>Remove</button>
          </span>
        : <button type="button" onClick={() => ref.current && ref.current.click()} style={linkBtn}>Attach a file</button>}
      <div style={{ fontSize: 11, color: T.ink3, marginTop: 4, lineHeight: 1.5 }}>
        PDF, image, Word, Excel, CSV or text, up to 10 MB. Files are not virus-scanned, so attach only what you trust.
      </div>
      {err && <div role="alert" style={{ fontSize: 12, color: T.ink, marginTop: 4 }}>{err}</div>}
    </div>
  );
}

const TH = { textAlign: "left", fontSize: 12, letterSpacing: "0.08em", textTransform: "uppercase", color: T.ink3,
  fontWeight: 600, padding: "10px 12px", borderBottom: "1px solid " + T.bg3, whiteSpace: "nowrap" };
const TD = { fontSize: 14, padding: "10px 12px", borderBottom: "1px solid " + T.bg2, verticalAlign: "top" };

// The compact view: one row per item, newest first. `rows` are
// { id, date, dateLabel, type, summary, by, files }.
export function TimelineListView({ rows = [], onOpen }) {
  return (
    <div data-testid="tl-list" style={{ background: T.white, borderRadius: 16, overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 520 }}>
        <thead><tr><th style={TH}>Date</th><th style={TH}>Type</th><th style={TH}>Summary</th><th style={TH}>By</th></tr></thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.id} data-kind={r.kind} onClick={() => onOpen && onOpen(r)} style={{ cursor: onOpen ? "pointer" : "default" }}>
              <td style={{ ...TD, whiteSpace: "nowrap", color: T.ink3 }}>{r.dateLabel}</td>
              <td style={{ ...TD, whiteSpace: "nowrap" }}>{r.type}{r.mass ? <span style={{ color: T.ink3 }}> · mass</span> : null}</td>
              <td style={{ ...TD, minWidth: 0 }}>
                <div style={{ overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{r.summary}</div>
                {r.files && r.files.length > 0 && <div style={{ fontSize: 12, color: T.ink3, marginTop: 2 }}>{r.files.length === 1 ? r.files[0].fileName : `${r.files.length} files`}</div>}
              </td>
              <td style={{ ...TD, color: T.ink3, whiteSpace: "nowrap" }}>{r.by || ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
