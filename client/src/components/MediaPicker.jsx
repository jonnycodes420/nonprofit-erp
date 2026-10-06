// MediaPicker.jsx · EMAIL-1. Pick a photo or a video from the org's media
// library, or add a new one. One library for giving pages and emails.
// Props: { kind: "photo" | "video", onPick(item), onClose }
//   item: { id, kind, title, alt, url, width, height, provider, videoId, thumbUrl }
//
// The add forms and the list loader are named exports so the library screen
// (MediaLibrary.jsx) uses the same ones. Every add offers Undo, which takes
// the new item back out of the library (routes/media.js).
import { useState, useEffect, useCallback } from "react";
import { apiFetch } from "../api";
import { T, Modal } from "./shared";
import { errorMessage } from "../lib/domainError";
import { offerUndo } from "./EditHistory";
import { resolveAssetUrl } from "../lib/assetUrl";
import Uploader from "./Uploader";

export const PHOTO_ACCEPT = ["image/jpeg", "image/png", "image/webp", "image/gif"];
export const PHOTO_MAX_BYTES = 15 * 1024 * 1024;
export const mediaInp = { width: "100%", boxSizing: "border-box", border: "1px solid " + T.bg3, borderRadius: 8, padding: "8px 10px", fontSize: 13, color: T.ink, background: T.white, fontFamily: "inherit" };
export const mediaQuietBtn = { background: T.white, border: "1px solid " + T.ink, borderRadius: 8, padding: "7px 14px", fontSize: 13, fontWeight: 700, color: T.ink, cursor: "pointer", minHeight: 38, fontFamily: "inherit" };
export const mediaPrimaryBtn = { background: T.greenDk, border: "none", borderRadius: 8, padding: "8px 16px", fontSize: 13, fontWeight: 700, color: T.white, cursor: "pointer", minHeight: 38, fontFamily: "inherit" };
// The picker also opens inside the page editor, which sits outside the app
// shell and its global type, so it names its own.
const PICKER_FONT = "'DM Sans', system-ui, -apple-system, sans-serif";
const lbl = { fontSize: 11, fontWeight: 700, color: T.ink3, textTransform: "uppercase", letterSpacing: "0.06em", margin: "10px 0 4px" };
const post = (path, body) => apiFetch(path, { method: "POST", body: JSON.stringify(body || {}) });

// The server says why in a sentence; show that sentence, not its code.
export const mediaError = (e, fallback) => (e && e.sentence) || errorMessage(e, fallback);

export function matchesSearch(item, q) {
  const s = String(q || "").trim().toLowerCase();
  if (!s) return true;
  return (item.title + " " + item.alt).toLowerCase().includes(s);
}

export function useMediaList(kind) {
  const [state, setState] = useState({ loading: true, items: [], err: "" });
  const load = useCallback(() => {
    apiFetch(`/media?kind=${kind}`)
      .then(r => setState({ loading: false, items: Array.isArray(r.items) ? r.items : [], err: "" }))
      .catch(e => setState({ loading: false, items: [], err: mediaError(e, "The library could not be loaded.") }));
  }, [kind]);
  useEffect(() => { setState(s => ({ ...s, loading: true })); load(); }, [load]);
  return [state, load, setState];
}

// Offer Undo for an add: it takes the item back out of the library.
export function offerAddUndo(resp, onUndone) {
  if (!resp || !resp.item || resp.existing) return;
  offerUndo({ message: resp.sentence || "Added to your library.",
    undoAction: async () => post(`/media/${resp.item.id}/remove`) }, resp.item.kind, onUndone);
}

export function AddPhotoForm({ onAdded, onCancel }) {
  const [file, setFile] = useState(null);     // { dataUrl, name }
  const [title, setTitle] = useState("");
  const [alt, setAlt] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const save = async () => {
    if (!file) { setErr("Choose a photo first."); return; }
    if (!alt.trim()) { setErr("Describe the photo in a few words. People who use a screen reader hear this, and inboxes that block images show it instead."); return; }
    setBusy(true); setErr("");
    try {
      const r = await post("/media/photos", { file: file.dataUrl, title, alt });
      onAdded(r);
    } catch (e) { setErr(mediaError(e, "The photo could not be added.")); }
    setBusy(false);
  };
  return (
    <div data-testid="media-add-photo" style={{ border: "1px solid " + T.bg2, borderRadius: 12, padding: 14, background: T.white, marginBottom: 14 }}>
      <Uploader accept={PHOTO_ACCEPT} acceptLabel="JPEG, PNG, WebP or GIF" maxBytes={PHOTO_MAX_BYTES} compact shape="wide"
        hint="JPEG, PNG, WebP or GIF, up to 15 MB. Steward keeps it as a JPEG so every inbox can show it."
        preview={file ? file.dataUrl : null} label="Drag a photo here, or browse"
        onFile={({ file: f, dataUrl }) => { setFile({ dataUrl, name: f.name }); if (!title) setTitle(String(f.name || "").replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ")); }}
        onRemove={() => setFile(null)} />
      <div style={lbl}>Describe the photo (required)</div>
      <input style={mediaInp} value={alt} onChange={e => setAlt(e.target.value)} maxLength={300}
        placeholder="Two volunteers stacking food boxes in the warehouse" aria-label="Describe the photo" />
      <div style={lbl}>Title</div>
      <input style={mediaInp} value={title} onChange={e => setTitle(e.target.value)} maxLength={200} placeholder="Warehouse, spring drive" aria-label="Title" />
      {err && <div role="alert" style={{ fontSize: 12.5, color: T.ink, marginTop: 8, lineHeight: 1.5 }}>{err}</div>}
      <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
        <button type="button" style={{ ...mediaPrimaryBtn, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={save}>{busy ? "Adding…" : "Add to library"}</button>
        {onCancel && <button type="button" style={mediaQuietBtn} onClick={onCancel}>Cancel</button>}
      </div>
    </div>
  );
}

export function AddVideoForm({ onAdded, onCancel }) {
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const save = async () => {
    setBusy(true); setErr("");
    try { onAdded(await post("/media/videos", { url, title })); }
    catch (e) { setErr(mediaError(e, "The video could not be added.")); }
    setBusy(false);
  };
  return (
    <div data-testid="media-add-video" style={{ border: "1px solid " + T.bg2, borderRadius: 12, padding: 14, background: T.white, marginBottom: 14 }}>
      <div style={{ ...lbl, marginTop: 0 }}>YouTube or Vimeo link</div>
      <input style={mediaInp} value={url} onChange={e => setUrl(e.target.value)} placeholder="https://youtu.be/…" aria-label="YouTube or Vimeo link" />
      <div style={lbl}>Title</div>
      <input style={mediaInp} value={title} onChange={e => setTitle(e.target.value)} maxLength={200} placeholder="Our year in two minutes" aria-label="Title" />
      <div style={{ fontSize: 12, color: T.ink3, marginTop: 6, lineHeight: 1.5 }}>No inbox plays video, so an email shows its picture with a play button that opens it.</div>
      {err && <div role="alert" style={{ fontSize: 12.5, color: T.ink, marginTop: 8, lineHeight: 1.5 }}>{err}</div>}
      <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
        <button type="button" style={{ ...mediaPrimaryBtn, opacity: busy || !url.trim() ? 0.6 : 1 }} disabled={busy || !url.trim()} onClick={save}>{busy ? "Adding…" : "Add to library"}</button>
        {onCancel && <button type="button" style={mediaQuietBtn} onClick={onCancel}>Cancel</button>}
      </div>
    </div>
  );
}

// One tile: the picture (or a plain panel when a video has none), the title,
// and the words that describe it.
export function MediaThumb({ item, height = 120 }) {
  const src = item.thumbUrl ? resolveAssetUrl(item.thumbUrl) : null;
  return src
    ? <img src={src} alt={item.alt || item.title || ""} loading="lazy" style={{ width: "100%", height, objectFit: "cover", display: "block", borderRadius: 8, background: T.bg2 }} />
    : <div style={{ width: "100%", height, borderRadius: 8, background: T.bg2, color: T.ink3, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, textAlign: "center", padding: 8, boxSizing: "border-box" }}>
        {item.kind === "video" ? "No picture from " + (item.provider === "vimeo" ? "Vimeo" : "YouTube") : "No picture"}
      </div>;
}

export default function MediaPicker({ kind = "photo", onPick, onClose }) {
  const isVideo = kind === "video";
  const [list, reload, setList] = useMediaList(isVideo ? "video" : "photo");
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  const [note, setNote] = useState("");
  const shown = list.items.filter(i => matchesSearch(i, q));
  const onAdded = (r) => {
    setAdding(false);
    setNote(r.sentence || "");
    if (r.item) setList(s => ({ ...s, items: [r.item, ...s.items.filter(i => i.id !== r.item.id)] }));
    offerAddUndo(r, () => { setNote(""); reload(); });
  };
  return (
    <Modal onClose={onClose} width={760} align="top" title={isVideo ? "Choose a video" : "Choose a photo"}
      dialogStyle={{ fontFamily: PICKER_FONT }}
      subtitle="From your library. Your giving pages and your emails share it.">
      <div data-testid="media-picker" style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <input style={{ ...mediaInp, flex: "1 1 220px", width: "auto" }} value={q} onChange={e => setQ(e.target.value)}
          placeholder={isVideo ? "Search your videos" : "Search your photos"} aria-label="Search the library" />
        {!adding && <button type="button" style={mediaQuietBtn} onClick={() => setAdding(true)}>{isVideo ? "Add a video" : "Add a photo"}</button>}
      </div>
      {adding && (isVideo
        ? <AddVideoForm onAdded={onAdded} onCancel={() => setAdding(false)} />
        : <AddPhotoForm onAdded={onAdded} onCancel={() => setAdding(false)} />)}
      {note && <div style={{ fontSize: 12.5, color: T.ink, marginBottom: 10, lineHeight: 1.5 }}>{note}</div>}
      {list.err && <div role="alert" style={{ fontSize: 13, color: T.ink }}>{list.err}</div>}
      {list.loading && <div style={{ fontSize: 13, color: T.ink3 }}>Loading…</div>}
      {!list.loading && !list.err && !shown.length && (
        <div style={{ fontSize: 13, color: T.ink3, lineHeight: 1.5 }}>
          {list.items.length ? "Nothing in the library matches that search." : (isVideo ? "No videos yet. Add one from a YouTube or Vimeo link." : "No photos yet. Add one, and it is ready for every page and email.")}
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 12 }}>
        {shown.map(item => (
          <button key={item.id} type="button" data-testid="media-tile" onClick={() => onPick && onPick(item)}
            aria-label={(isVideo ? "Use the video " : "Use the photo ") + (item.title || item.alt)}
            style={{ textAlign: "left", background: T.white, border: "1px solid " + T.bg2, borderRadius: 12, padding: 8, cursor: "pointer", fontFamily: "inherit", minWidth: 0 }}>
            <MediaThumb item={item} />
            <div style={{ fontSize: 13, fontWeight: 700, color: T.ink, marginTop: 6, overflowWrap: "anywhere" }}>{item.title || "Untitled"}</div>
            {item.alt && <div style={{ fontSize: 11.5, color: T.ink3, marginTop: 2, lineHeight: 1.4, overflowWrap: "anywhere" }}>{item.alt}</div>}
          </button>
        ))}
      </div>
    </Modal>
  );
}
