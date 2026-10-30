// StockPhotoPicker.jsx · EDITOR-1. CHOOSE A PHOTO: STEWARD'S, YOURS, OR A NEW ONE.
//
// Props: { onPick(picture), onClose, title?, current? }
//   picture: { url, alt, fx, fy, stock }   url is always a /portal-assets/ path
//   current: the picture the slot holds now, so its tile reads "In use"
//
// Three tabs. Steward's photos are the ~40 bundled with Steward
// (shared/stockPhotos.js), the org's own mission group first; choosing one
// stores it as this org's asset (POST /stock-photos/:id/use) and comes back
// marked stock. Your library is the media library every page and email shares.
// Upload stores a new photo through the one picture door (POST /pictures/upload)
// and asks for the words a screen reader says. Nothing here changes a page by
// itself: the slot that opened the picker saves what it is handed.
import { useState, useEffect } from "react";
import { apiFetch, API } from "../api";
import { T, Modal } from "./shared";
import Uploader from "./Uploader";
import { useMediaList, MediaThumb, mediaInp, mediaQuietBtn, mediaPrimaryBtn, mediaError, PHOTO_ACCEPT, PHOTO_MAX_BYTES } from "./MediaPicker";

const PICKER_FONT = "'DM Sans', system-ui, -apple-system, sans-serif";
const TABS = [["stock", "Steward's photos"], ["library", "Your library"], ["upload", "Upload"]];
const grid = { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 150px), 1fr))", gap: 10 };
const tile = on => ({ textAlign: "left", background: T.white, border: "1px solid " + (on ? T.greenDk : T.bg2), borderRadius: 12, padding: 6,
  cursor: "pointer", fontFamily: "inherit", minWidth: 0, position: "relative" });
const groupHead = { fontSize: 12, fontWeight: 700, color: T.ink3, margin: "16px 0 8px" };

export default function StockPhotoPicker({ onPick, onClose, title = "Choose a photo", current = null }) {
  const [tab, setTab] = useState("stock");
  const [stock, setStock] = useState(null);     // { suggested, groups }
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");
  const [library] = useMediaList("photo");
  const [file, setFile] = useState(null);
  const [alt, setAlt] = useState("");

  useEffect(() => {
    apiFetch("/stock-photos").then(setStock).catch(e => setErr(mediaError(e, "Steward's photos could not be loaded.")));
  }, []);

  const chooseStock = async p => {
    setBusy(p.id); setErr("");
    try {
      const r = await apiFetch(`/stock-photos/${encodeURIComponent(p.id)}/use`, { method: "POST", body: "{}" });
      onPick({ url: r.url, alt: r.alt, fx: r.fx, fy: r.fy, stock: true });
    } catch (e) { setErr(mediaError(e, "That photo could not be used just now.")); }
    setBusy("");
  };
  const upload = async () => {
    if (!file) { setErr("Choose a photo first."); return; }
    if (!alt.trim()) { setErr("Describe the photo in a few words. People who use a screen reader hear this."); return; }
    setBusy("upload"); setErr("");
    try {
      const r = await apiFetch("/pictures/upload", { method: "POST", body: JSON.stringify({ image: file }) });
      onPick({ url: r.url, alt: alt.trim(), fx: 0.5, fy: 0.5, stock: false });
    } catch (e) { setErr(mediaError(e, "The photo could not be stored.")); }
    setBusy("");
  };

  return (
    <Modal onClose={onClose} width={820} align="top" title={title} dialogStyle={{ fontFamily: PICKER_FONT }}
      subtitle="Start from one of Steward's photos, or use your own.">
      <div data-testid="stock-picker" role="tablist" style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
        {TABS.map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} data-testid={"stock-tab-" + k} onClick={() => { setTab(k); setErr(""); }}
            style={{ ...mediaQuietBtn, minHeight: 34, padding: "5px 12px", borderColor: tab === k ? T.ink : T.bg3, background: tab === k ? T.bg : T.white }}>
            {label}
          </button>
        ))}
      </div>
      {err && <div role="alert" style={{ fontSize: 12.5, color: T.ink, marginBottom: 10, lineHeight: 1.5 }}>{err}</div>}

      {tab === "stock" && (!stock ? (!err && <div style={{ fontSize: 13, color: T.ink3 }}>Loading…</div>) : (
        <div data-testid="stock-groups">
          <div style={{ fontSize: 12.5, color: T.ink3, lineHeight: 1.5 }}>
            Free to use on your pages and in your emails. Your own photo will always say more, so replace it when you have one.
          </div>
          {stock.groups.map(g => (
            <section key={g.key} data-stock-group={g.key}>
              <div style={groupHead}>{g.label}{g.key === stock.suggested ? " · suggested for you" : ""}</div>
              <div style={grid}>
                {g.photos.map(p => (
                  <button key={p.id} type="button" data-testid="stock-tile" data-stock-id={p.id} disabled={!!busy} onClick={() => chooseStock(p)}
                    aria-label={"Use the photo: " + p.alt} style={{ ...tile(false), opacity: busy && busy !== p.id ? 0.6 : 1 }}>
                    <img src={API + p.thumb} alt={p.alt} loading="lazy"
                      style={{ width: "100%", aspectRatio: "3 / 2", objectFit: "cover", display: "block", borderRadius: 8, background: T.bg2 }} />
                    <div style={{ fontSize: 11.5, color: T.ink3, marginTop: 4, lineHeight: 1.35, overflowWrap: "anywhere" }}>
                      {busy === p.id ? "Adding…" : p.alt}
                    </div>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      ))}

      {tab === "library" && (
        <div data-testid="stock-library">
          {library.loading && <div style={{ fontSize: 13, color: T.ink3 }}>Loading…</div>}
          {!library.loading && !library.items.length && (
            <div style={{ fontSize: 13, color: T.ink3, lineHeight: 1.5 }}>No photos in your library yet. Upload one and it is ready for every page and email.</div>
          )}
          <div style={grid}>
            {library.items.map(item => (
              <button key={item.id} type="button" data-testid="library-tile" style={tile(current && current.url === item.url)}
                onClick={() => onPick({ url: item.url, alt: item.alt || item.title || "", fx: 0.5, fy: 0.5, stock: false })}
                aria-label={"Use the photo " + (item.title || item.alt)}>
                <MediaThumb item={item} height={100} />
                <div style={{ fontSize: 12, fontWeight: 700, color: T.ink, marginTop: 4, overflowWrap: "anywhere" }}>{item.title || "Untitled"}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {tab === "upload" && (
        <div data-testid="stock-upload" style={{ border: "1px solid " + T.bg2, borderRadius: 12, padding: 14, background: T.white }}>
          <Uploader accept={PHOTO_ACCEPT} acceptLabel="JPEG, PNG, WebP or GIF" maxBytes={PHOTO_MAX_BYTES} compact shape="wide"
            hint="JPEG, PNG, WebP or GIF, up to 15 MB." preview={file || null} label="Drag a photo here, or browse"
            onFile={({ dataUrl }) => setFile(dataUrl)} onRemove={() => setFile(null)} />
          <div style={{ fontSize: 11, fontWeight: 700, color: T.ink3, margin: "10px 0 4px" }}>Describe the photo (required)</div>
          <input style={mediaInp} value={alt} onChange={e => setAlt(e.target.value)} maxLength={200} aria-label="Describe the photo"
            placeholder="Two volunteers stacking food boxes in the warehouse" />
          <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
            <button type="button" data-testid="stock-upload-use" style={{ ...mediaPrimaryBtn, opacity: busy ? 0.6 : 1 }} disabled={!!busy} onClick={upload}>
              {busy === "upload" ? "Adding…" : "Use this photo"}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
