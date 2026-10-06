// MediaLibrary.jsx · EMAIL-1. THE MEDIA LIBRARY SCREEN.
//
// Every photo and video the org can put on a giving page or in an email: add,
// rename, describe, take out. Every change offers Undo (the shared toast),
// which puts the previous words back or brings a removed item back. A photo
// always has words that describe it; the server refuses one without.
import { useState } from "react";
import { apiFetch } from "../api";
import { T, activeMark } from "./shared";
import { offerUndo } from "./EditHistory";
import {
  useMediaList, matchesSearch, offerAddUndo, mediaError, AddPhotoForm, AddVideoForm, MediaThumb,
  mediaInp, mediaQuietBtn, mediaPrimaryBtn,
} from "./MediaPicker";

const post = (path, body) => apiFetch(path, { method: "POST", body: JSON.stringify(body || {}) });
const put = (path, body) => apiFetch(path, { method: "PUT", body: JSON.stringify(body || {}) });
const TABS = [["photo", "Photos"], ["video", "Videos"]];

function MediaCard({ item, onSaved, onRemoved }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(item.title);
  const [alt, setAlt] = useState(item.alt);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const isPhoto = item.kind === "photo";
  const save = async () => {
    setBusy(true); setErr("");
    try {
      const r = await put(`/media/${item.id}`, isPhoto ? { title, alt } : { title });
      setEditing(false);
      onSaved(r.item);
      const was = r.previous || { title: item.title, alt: item.alt };
      offerUndo({ message: `Saved "${r.item.title}".`, undoAction: async () => {
        const x = await put(`/media/${item.id}`, isPhoto ? { title: was.title, alt: was.alt } : { title: was.title });
        onSaved(x.item); setTitle(x.item.title); setAlt(x.item.alt);
        return x;
      } }, item.kind);
    } catch (e) { setErr(mediaError(e, "That could not be saved.")); }
    setBusy(false);
  };
  const remove = async () => {
    setErr("");
    try {
      await post(`/media/${item.id}/remove`);
      onRemoved(item.id);
      offerUndo({ message: `Took "${item.title}" out of the library. Pages and emails that already use it keep it.`,
        undoAction: async () => post(`/media/${item.id}/restore`) }, item.kind, () => onSaved(item, true));
    } catch (e) { setErr(mediaError(e, "That could not be removed.")); }
  };
  return (
    <div data-testid="media-card" style={{ background: T.white, border: "1px solid " + T.bg2, borderRadius: 12, padding: 10, minWidth: 0, display: "flex", flexDirection: "column" }}>
      <MediaThumb item={item} height={140} />
      {!editing ? (
        <>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: T.ink, marginTop: 8, overflowWrap: "anywhere" }}>{item.title || "Untitled"}</div>
          {isPhoto && <div style={{ fontSize: 12, color: T.ink3, marginTop: 2, lineHeight: 1.45, overflowWrap: "anywhere" }}>{item.alt}</div>}
          {!isPhoto && <div style={{ fontSize: 12, color: T.ink3, marginTop: 2 }}>{item.provider === "vimeo" ? "Vimeo" : "YouTube"}</div>}
          {isPhoto && item.width && <div style={{ fontSize: 11.5, color: T.ink3, marginTop: 2 }}>{item.width} × {item.height} px</div>}
          <div style={{ display: "flex", gap: 6, marginTop: "auto", paddingTop: 10, flexWrap: "wrap" }}>
            <button type="button" style={{ ...mediaQuietBtn, minHeight: 34, padding: "5px 12px", fontSize: 12 }} onClick={() => { setTitle(item.title); setAlt(item.alt); setEditing(true); }}>Edit</button>
            <button type="button" style={{ ...mediaQuietBtn, minHeight: 34, padding: "5px 12px", fontSize: 12, borderColor: T.bg3 }} onClick={remove}>Remove</button>
          </div>
        </>
      ) : (
        <div style={{ marginTop: 8 }}>
          <input style={mediaInp} value={title} onChange={e => setTitle(e.target.value)} maxLength={200} aria-label="Title" placeholder="Title" />
          {isPhoto && <textarea style={{ ...mediaInp, marginTop: 6, resize: "vertical" }} rows={2} value={alt} maxLength={300}
            onChange={e => setAlt(e.target.value)} aria-label="Describe the photo" placeholder="Describe the photo (required)" />}
          <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
            <button type="button" style={{ ...mediaQuietBtn, minHeight: 34, padding: "5px 12px", fontSize: 12, background: T.ink, color: T.white }} disabled={busy} onClick={save}>{busy ? "Saving…" : "Save"}</button>
            <button type="button" style={{ ...mediaQuietBtn, minHeight: 34, padding: "5px 12px", fontSize: 12, borderColor: T.bg3 }} onClick={() => { setEditing(false); setErr(""); }}>Cancel</button>
          </div>
        </div>
      )}
      {err && <div role="alert" style={{ fontSize: 12, color: T.ink, marginTop: 6, lineHeight: 1.45 }}>{err}</div>}
    </div>
  );
}

export default function MediaLibrary() {
  const [kind, setKind] = useState("photo");
  const [list, reload, setList] = useMediaList(kind);
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  const [note, setNote] = useState("");
  const isVideo = kind === "video";
  const shown = list.items.filter(i => matchesSearch(i, q));
  const upsert = (item, front) => setList(s => {
    const rest = s.items.filter(i => i.id !== item.id);
    if (front || !s.items.some(i => i.id === item.id)) return { ...s, items: [item, ...rest] };
    return { ...s, items: s.items.map(i => (i.id === item.id ? item : i)) };
  });
  const onAdded = (r) => {
    setAdding(false);
    setNote(r.sentence || "");
    if (r.item) upsert(r.item, true);
    offerAddUndo(r, () => { setNote(""); reload(); });
  };
  return (
    <div data-testid="media-library" style={{ maxWidth: 1100 }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 6 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: "'DM Serif Display',Georgia,serif", fontSize: 24, color: T.ink }}>Media library</div>
          <div style={{ fontSize: 13, color: T.ink3, marginTop: 4, lineHeight: 1.5 }}>The photos and videos your giving pages and your emails use. Photos are kept as JPEGs so every inbox shows them.</div>
        </div>
        {!adding && <button type="button" style={mediaPrimaryBtn} onClick={() => setAdding(true)}>{isVideo ? "Add a video" : "Add a photo"}</button>}
      </div>
      <div role="tablist" aria-label="Kind" style={{ display: "flex", gap: 4, borderBottom: "1px solid " + T.bg2, width: "fit-content", maxWidth: "100%", margin: "12px 0 14px" }}>
        {TABS.map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={kind === k}
            onClick={() => { setKind(k); setAdding(false); setNote(""); }}
            style={{ background: "none", border: "none", padding: "8px 14px", fontSize: 13, fontWeight: 600, color: T.ink3, cursor: "pointer", minHeight: 40, fontFamily: "inherit", ...activeMark(kind === k, "bottom") }}>
            {label}
          </button>
        ))}
      </div>
      {adding && (isVideo
        ? <AddVideoForm onAdded={onAdded} onCancel={() => setAdding(false)} />
        : <AddPhotoForm onAdded={onAdded} onCancel={() => setAdding(false)} />)}
      {note && <div style={{ fontSize: 13, color: T.ink, marginBottom: 10, lineHeight: 1.5 }}>{note}</div>}
      <input style={{ ...mediaInp, maxWidth: 360, marginBottom: 14 }} value={q} onChange={e => setQ(e.target.value)}
        placeholder={isVideo ? "Search your videos" : "Search your photos"} aria-label="Search the library" />
      {list.err && <div role="alert" style={{ fontSize: 13, color: T.ink }}>{list.err}</div>}
      {list.loading && <div style={{ fontSize: 13, color: T.ink3 }}>Loading…</div>}
      {!list.loading && !list.err && !shown.length && (
        <div style={{ fontSize: 13, color: T.ink3, lineHeight: 1.5 }}>
          {list.items.length ? "Nothing in the library matches that search." : (isVideo ? "No videos yet. Add one from a YouTube or Vimeo link." : "No photos yet. Add one, and it is ready for every page and email.")}
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 14 }}>
        {shown.map(item => (
          <MediaCard key={item.id} item={item}
            onSaved={(it, back) => (back ? reload() : upsert(it))}
            onRemoved={id => setList(s => ({ ...s, items: s.items.filter(i => i.id !== id) }))} />
        ))}
      </div>
    </div>
  );
}
