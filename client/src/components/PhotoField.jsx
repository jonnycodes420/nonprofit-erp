// FIX-41 Part 2 · THE ONE PICTURE CONTROL. Every slot that takes a picture
// (an auction item's photos, a page's cover, a ticket type, a sponsorship or
// membership level, a volunteer role) uses this, built on the shared
// Uploader so drag-and-drop, browse, paste and the reject messages are the
// same everywhere.
//
//   · Empty: a soft placeholder right where the picture goes, "Add a photo"
//     ("Add a cover photo" for a page), never a blank.
//   · Filled: the picture in its real crop. Click it to set the focal point,
//     so a phone's narrower crop keeps the subject. Replace and Remove.
//   · One optional field for the words a screen reader says, defaulted to
//     the item's name.
//
// The file is made small in the browser (lib/imageResize.js), then sent once
// to POST /pictures/upload, which converts HEIC, resizes and compresses again
// and hands back a stored path. The slot then saves { url, alt, fx, fy }.
import { useRef, useState } from "react";
import { apiFetch } from "../api";
import { T } from "./shared";
import Uploader from "./Uploader";
import { readPicture, pictureSrc, focusOf } from "./Picture";
import { shrinkImage } from "../lib/imageResize";
import { errorMessage } from "../lib/domainError";

export const PHOTO_ACCEPT = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", ".heic", ".heif", ".jpg", ".jpeg", ".png", ".webp"];
export const PHOTO_ACCEPT_LABEL = "JPG, PNG, WEBP or HEIC, up to 15 MB";
export const PHOTO_MAX_BYTES = 15 * 1024 * 1024;
const RATIO = { cover: "16 / 9", photo: "4 / 3", small: "1 / 1" };
const linkBtn = { background: T.white, border: "1px solid " + T.bg3, borderRadius: 8, padding: "5px 10px", fontSize: 12, fontWeight: 700, color: T.ink, cursor: "pointer", fontFamily: "inherit" };

// Upload one file; resolves to a stored path.
export async function uploadPicture(file) {
  const image = await shrinkImage(file);
  if (!image) throw new Error("That file could not be read. Try another photo.");
  const r = await apiFetch("/pictures/upload", { method: "POST", body: JSON.stringify({ image }) });
  return r.url;
}

// The picture itself, clickable for the focal point.
function FocalImage({ pic, ratio, onFocus, disabled, testid }) {
  const pick = e => {
    if (disabled || !onFocus) return;
    const r = e.currentTarget.getBoundingClientRect();
    onFocus(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)));
  };
  return (
    <div data-testid={testid} onClick={pick} title={disabled ? "" : "Click the part of the photo that must always show"}
      style={{ position: "relative", width: "100%", aspectRatio: ratio, overflow: "hidden", borderRadius: 10, background: T.bg, cursor: disabled ? "default" : "crosshair" }}>
      <img src={pictureSrc(pic, 1280)} alt={pic.alt || ""}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", objectPosition: focusOf(pic), display: "block" }} />
      {!disabled && <span aria-hidden="true" style={{ position: "absolute", left: `calc(${pic.fx * 100}% - 9px)`, top: `calc(${pic.fy * 100}% - 9px)`, width: 14, height: 14, borderRadius: "50%", border: "2px solid " + T.white, boxShadow: "0 0 0 2px " + T.ink, pointerEvents: "none" }} />}
    </div>
  );
}

export default function PhotoField({ value, onChange, name = "", variant = "photo", label, disabled = false, testid = "photo-field", hint = "", noAlt = false }) {
  const pic = readPicture(value);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const replaceRef = useRef(null);
  const ratio = RATIO[variant] || RATIO.photo;
  const emptyLabel = label || (variant === "cover" ? "Add a cover photo" : "Add a photo");

  const take = async file => {
    setBusy(true); setErr("");
    try {
      const url = await uploadPicture(file);
      onChange({ url, alt: (pic && pic.alt) || name || "", fx: 0.5, fy: 0.5 });
    } catch (e) { setErr(errorMessage(e, "That photo did not upload. Try another.")); }
    finally { setBusy(false); }
  };

  if (!pic) {
    return (
      <div data-testid={testid} data-empty="true" style={{ width: "100%", maxWidth: variant === "small" ? 160 : "none" }}>
        <div style={{ position: "relative", width: "100%", aspectRatio: variant === "small" ? ratio : "auto", background: T.bg, borderRadius: 10 }}>
          <Uploader accept={PHOTO_ACCEPT} acceptLabel={PHOTO_ACCEPT_LABEL} maxBytes={PHOTO_MAX_BYTES} readAs="none"
            compact={variant === "small"} busy={busy} disabled={disabled} label={emptyLabel}
            hint={hint || PHOTO_ACCEPT_LABEL} onFile={({ file }) => take(file)} />
        </div>
        {err && <div role="alert" style={{ fontSize: 12, color: T.ink, marginTop: 4 }}>{err}</div>}
      </div>
    );
  }

  return (
    <div data-testid={testid} data-empty="false" style={{ display: "flex", flexDirection: "column", gap: 6, width: "100%", maxWidth: variant === "small" ? 160 : "none" }}>
      <FocalImage pic={pic} ratio={ratio} disabled={disabled || busy} testid={testid + "-image"}
        onFocus={(fx, fy) => onChange({ ...pic, fx: Math.round(fx * 1000) / 1000, fy: Math.round(fy * 1000) / 1000 })} />
      {!disabled && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <button type="button" style={linkBtn} disabled={busy} onClick={() => replaceRef.current && replaceRef.current.click()}>{busy ? "Working…" : "Replace"}</button>
          <button type="button" style={linkBtn} disabled={busy} onClick={() => onChange(null)}>Remove</button>
          {variant !== "small" && <span style={{ fontSize: 11.5, color: T.ink3 }}>Click the photo to choose what always shows on a phone.</span>}
          <input ref={replaceRef} type="file" accept={PHOTO_ACCEPT.join(",")} hidden
            onChange={e => { const f = e.target.files && e.target.files[0]; e.target.value = ""; if (f) take(f); }} />
        </div>
      )}
      {!disabled && !noAlt && (
        <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 11.5, color: T.ink3, fontWeight: 600 }}>
          Describe the photo (optional)
          <input value={pic.alt} placeholder={name || "What the photo shows"} onChange={e => onChange({ ...pic, alt: e.target.value })}
            style={{ border: "1px solid " + T.bg3, borderRadius: 8, padding: "6px 8px", fontSize: 12.5, fontFamily: "inherit", color: T.ink, background: T.white, minWidth: 0 }} />
        </label>
      )}
      {err && <div role="alert" style={{ fontSize: 12, color: T.ink }}>{err}</div>}
    </div>
  );
}

// Up to `max` photos; the first is the main one. Drag a thumbnail to reorder.
export function PhotoList({ value, onChange, name = "", max = 5, disabled = false, testid = "photo-list" }) {
  const list = (Array.isArray(value) ? value : []).map(readPicture).filter(Boolean);
  const [drag, setDrag] = useState(null);
  const [sel, setSel] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const cur = list[Math.min(sel, list.length - 1)] || null;
  const move = (from, to) => {
    if (from === to || from == null) return;
    const next = list.slice(); const [x] = next.splice(from, 1); next.splice(to, 0, x);
    onChange(next); setSel(to);
  };
  const add = async files => {
    setBusy(true); setErr("");
    try {
      const next = list.slice();
      for (const f of files) {
        if (next.length >= max) break;
        next.push({ url: await uploadPicture(f), alt: name || "", fx: 0.5, fy: 0.5 });
      }
      onChange(next);
    } catch (e) { setErr(errorMessage(e, "That photo did not upload. Try another.")); }
    finally { setBusy(false); }
  };
  return (
    <div data-testid={testid} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {cur
        ? <PhotoField value={cur} name={name} variant="photo" disabled={disabled} testid={testid + "-main"}
            onChange={p => { const next = list.slice(); if (p) next[list.indexOf(cur)] = p; else next.splice(list.indexOf(cur), 1); onChange(next); if (!p) setSel(0); }} />
        : null}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        {list.map((p, i) => (
          <button type="button" key={p.url + i} draggable={!disabled} data-testid={testid + "-thumb"}
            onDragStart={() => setDrag(i)} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); move(drag, i); setDrag(null); }}
            onClick={() => setSel(i)} aria-label={`Photo ${i + 1}${i === 0 ? ", the main one" : ""}. Drag to reorder.`}
            style={{ position: "relative", width: 64, height: 64, padding: 0, borderRadius: 8, overflow: "hidden", cursor: disabled ? "default" : "grab",
              border: i === sel ? "2px solid " + T.greenDk : "1px solid " + T.bg3, background: T.bg }}>
            <img src={pictureSrc(p, 160)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: focusOf(p), display: "block" }} />
            {i === 0 && <span style={{ position: "absolute", left: 3, bottom: 3, fontSize: 9.5, fontWeight: 800, background: T.ink, color: T.white, borderRadius: 4, padding: "1px 4px" }}>Main</span>}
          </button>
        ))}
        {!disabled && list.length > 1 && <span style={{ fontSize: 11.5, color: T.ink3 }}>Drag to reorder. The first is the main photo.</span>}
      </div>
      {!disabled && list.length < max && (
        <div style={{ background: T.bg, borderRadius: 10 }}>
          <Uploader accept={PHOTO_ACCEPT} acceptLabel={PHOTO_ACCEPT_LABEL} maxBytes={PHOTO_MAX_BYTES} readAs="none" compact={list.length > 0}
            busy={busy} label={list.length ? `Add another photo (${list.length} of ${max})` : "Add a photo"} hint={`Up to ${max}. ${PHOTO_ACCEPT_LABEL}`}
            onFile={({ file }) => add([file])} />
        </div>
      )}
      {err && <div role="alert" style={{ fontSize: 12, color: T.ink }}>{err}</div>}
    </div>
  );
}
