// BUILD-54 §6 — THE one shared drag-and-drop uploader, used everywhere the
// product accepts a file (theme logo/header, portal logo/header, widget
// images, impact photos, campaign hero, donor CSV/XLSX import, donor
// materials). Rules it exists to enforce:
//   - Drop zone with hover/active states PLUS click-to-browse — never
//     drag-only. The whole zone is a real keyboard target (Enter/Space opens
//     the browser) and drag simply doesn't exist on phones, so browse and
//     paste are first-class, not fallbacks.
//   - Paste-from-clipboard for images; multi-file where the field allows.
//   - Reject-on-drop feedback that MIRRORS the server rules (type/size, and
//     an optional caller-supplied dimension check) so users learn the
//     constraints before a round trip. HARD RULE: these client checks are UI
//     convenience ONLY — every file still goes through identical server-side
//     validation; no client check is authoritative.
//   - The component renders ALL SIX STATES ITSELF (redesign, 2026-08-15):
//     empty drop target · filled (the image/file IS the control, Replace /
//     Remove on hover, always visible on touch) · drag-over (calm gold
//     shift) · uploading (inline bar ON the tile) · error (inline, replaces
//     the hint line — never a floating red sentence beside the control).
//     Callers pass the current value via `preview` (image) or `fileMeta`
//     (non-image file tile) instead of rendering their own sibling preview.
// The component hands each accepted file to onFile as { file, dataUrl } (or
// file-only when readAs="none", e.g. CSV import keeps its own parser).
// `children` still render below the tile for extra chrome (multi-photo
// thumbnail strips at gallery/impact sites).
import { useRef, useState } from "react";
import { T } from "./shared";

const EXT_RE = /\.([A-Za-z0-9]+)$/;

function fileMatchesAccept(file, accept) {
  if (!accept || !accept.length) return true;
  const name = (file.name || "").toLowerCase();
  const ext = (EXT_RE.exec(name) || [])[1];
  return accept.some(a => {
    const s = a.toLowerCase();
    if (s.startsWith(".")) return ext === s.slice(1);
    if (s.endsWith("/*")) return (file.type || "").startsWith(s.slice(0, -1));
    return (file.type || "") === s;
  });
}

// Human-readable size for the file tile (CSV imports etc.).
export function humanFileSize(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

// Middle-truncate a file name so the extension survives.
function truncateMiddle(s, max = 38) {
  const str = String(s || "");
  if (str.length <= max) return str;
  const keep = Math.floor((max - 1) / 2);
  return str.slice(0, keep) + "…" + str.slice(str.length - keep);
}

// Crop shapes for the filled image state — the image renders in its ACTUAL
// crop shape so what the org sees is what donors get.
//   banner → wide header ratio (~1200/300)   wide → 16/9 hero/widget ratio
//   square → logo tile (~96–140px)           auto → natural-ish box
const SHAPE_RATIO = { banner: "1200 / 300", wide: "16 / 9" };

// Local CSS (kept IN the component, not GlobalStyles, so the uploader works
// unchanged on white-label surfaces like the portal editor). Class family:
// uploader-zone / uploader-tile / uploader-actions / uploader-bar-indet.
const UPLOADER_CSS = `
.uploader-zone { transition: border-color 120ms, background-color 120ms; }
.uploader-tile .uploader-actions { opacity: 0; transition: opacity 120ms; }
.uploader-tile:hover .uploader-actions,
.uploader-tile:focus-within .uploader-actions { opacity: 1; }
@media (hover: none) {
  .uploader-tile .uploader-actions { opacity: 1; }
}
@keyframes uploader-indet {
  0% { left: -40%; }
  100% { left: 100%; }
}
.uploader-bar-indet { animation: uploader-indet 1.2s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) {
  .uploader-bar-indet { animation: none; left: 0; right: 0; width: auto; opacity: 0.5; }
}
`;

export default function Uploader({
  accept = [],            // [".csv", "image/*", "image/png", …]
  acceptLabel = "",       // human wording for the reject message ("PNG, JPEG, …")
  maxBytes = null,
  multiple = false,
  readAs = "dataUrl",     // "dataUrl" | "none"
  validate = null,        // async ({ file, dataUrl }) => error string | null
  onFile,                 // ({ file, dataUrl }) per accepted file
  disabled = false,
  busy = false,           // caller-driven upload-in-progress state
  progress = null,        // optional 0..1 for a determinate inline bar; busy alone = indeterminate
  compact = false,
  label = "Drag an image here, or browse",
  preview = null,         // current image value (URL or data URI) → FILLED state
  shape = "auto",         // "banner" | "wide" | "square" | "auto" — the crop the image renders in
  onRemove = null,        // when provided, the filled state offers Remove; caller clears its value
  hint = "",              // constraint line override (defaults to acceptLabel / max size)
  fileMeta = null,        // { name, size, detail } for non-image files → file tile FILLED state
  children = null,        // extra chrome below (e.g. multi-photo thumbnail strips)
}) {
  const inputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState("");
  const [reading, setReading] = useState(false);

  const fail = (msg) => setError(msg);

  async function handleFiles(fileList) {
    if (disabled) return;
    setError(""); // error clears on the next attempt
    const files = Array.from(fileList || []).slice(0, multiple ? 20 : 1);
    if (!files.length) return;
    setReading(true);
    for (const file of files) {
      if (!fileMatchesAccept(file, accept)) {
        fail(`That file type isn't accepted here${acceptLabel ? ` — use ${acceptLabel}` : ""}.`);
        continue;
      }
      if (maxBytes && file.size > maxBytes) {
        fail(`"${file.name}" is too large — keep it under ${Math.round(maxBytes / 1024)}KB.`);
        continue;
      }
      let dataUrl = null;
      if (readAs === "dataUrl") {
        dataUrl = await new Promise((resolve) => {
          const r = new FileReader();
          r.onload = () => resolve(r.result);
          r.onerror = () => resolve(null);
          r.readAsDataURL(file);
        });
        if (!dataUrl) { fail(`Couldn't read "${file.name}" — try again.`); continue; }
      }
      if (validate) {
        const msg = await validate({ file, dataUrl });
        if (msg) { fail(msg); continue; }
      }
      onFile({ file, dataUrl });
    }
    setReading(false);
  }

  const openBrowse = () => { if (!disabled && inputRef.current) inputRef.current.click(); };
  const active = dragOver && !disabled;
  const working = busy || reading;
  const showBar = working || typeof progress === "number";
  const filled = !!(preview || fileMeta);

  // Constraint line: hint override, else acceptLabel, else a max-size note.
  // The ERROR REPLACES this line (inline, on the tile, in the error color).
  const hintText = hint
    || acceptLabel
    || (maxBytes ? `Under ${Math.round(maxBytes / 1024)}KB` : "");

  const removeBtn = onRemove && !disabled && (
    <button
      type="button"
      aria-label="Remove"
      onClick={e => { e.stopPropagation(); setError(""); onRemove(); }}
      style={actBtnStyle}
    >Remove</button>
  );
  const replaceBtn = !disabled && (
    <button
      type="button"
      aria-label="Replace"
      onClick={e => { e.stopPropagation(); openBrowse(); }}
      style={actBtnStyle}
    >Replace</button>
  );

  // ── The inline progress bar — rides the tile's bottom edge, never a
  // separate spinner elsewhere. Determinate when `progress` is a number,
  // else a subtle indeterminate sweep (static under reduced motion).
  const bar = showBar && (
    <div aria-hidden="true" style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 3, background: T.bg2, overflow: "hidden" }}>
      {typeof progress === "number"
        ? <div style={{ height: "100%", width: `${Math.max(0, Math.min(1, progress)) * 100}%`, background: T.gold500, transition: "width 200ms" }} />
        : <div className="uploader-bar-indet" style={{ position: "absolute", top: 0, bottom: 0, width: "40%", background: T.gold500 }} />}
    </div>
  );

  // ── Zone contents per state ──
  let contents;
  if (fileMeta) {
    // FILLED, non-image: a file tile — glyph, name (middle-truncated),
    // human size + detail ("312 rows · transaction ledger"). Still a drop
    // target; Replace/Remove ride the same hover/touch affordance.
    contents = (
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: compact ? "10px 12px" : "14px 16px", textAlign: "left" }}>
        <div aria-hidden="true" style={{ fontSize: 22, color: T.ink3, flexShrink: 0, lineHeight: 1 }}>▤</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: T.ink, whiteSpace: "nowrap", overflow: "hidden" }}>
            {truncateMiddle(fileMeta.name)}
          </div>
          <div style={{ fontSize: 11, color: error ? T.terra700 : T.ink3, marginTop: 2 }}>
            {error || [humanFileSize(fileMeta.size), fileMeta.detail].filter(Boolean).join(" · ")}
          </div>
        </div>
        <div className="uploader-actions" style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          {replaceBtn}
          {removeBtn}
        </div>
      </div>
    );
  } else if (preview) {
    // FILLED, image: the image IS the control, at meaningful size in its
    // actual crop shape. Replace/Remove appear on hover/focus-within and are
    // always visible on touch (see the @media (hover: none) rule).
    const imgStyle = shape === "square"
      ? { display: "block", width: "100%", aspectRatio: "1 / 1", objectFit: "cover" }
      : SHAPE_RATIO[shape]
        ? { display: "block", width: "100%", aspectRatio: SHAPE_RATIO[shape], objectFit: "cover" }
        : { display: "block", width: "100%", maxHeight: 200, objectFit: "cover" };
    contents = (
      <div style={{ position: "relative" }}>
        <img src={preview} alt="" style={imgStyle} />
        <div className="uploader-actions" style={{ position: "absolute", top: 8, right: 8, display: "flex", gap: 6 }}>
          {replaceBtn}
          {removeBtn}
        </div>
        {working && (
          <div style={{ position: "absolute", inset: 0, background: T.ink + "66", display: "flex", alignItems: "center", justifyContent: "center", color: T.bg, fontSize: 12, fontWeight: 700 }}>
            Working…
          </div>
        )}
        {/* Inline error strip — replaces the hint, inside the tile */}
        {error && (
          <div style={{ fontSize: 12, color: T.terra700, background: T.bg, padding: "6px 10px", lineHeight: 1.45 }}>{error}</div>
        )}
      </div>
    );
  } else {
    // EMPTY: a real drop target — dashed hairline, generous padding, a short
    // instruction, and the constraint stated quietly beneath. Never a lone
    // "Replace" button. The error replaces the constraint line inline.
    contents = (
      <div style={{ padding: compact ? "12px 14px" : "24px 18px", textAlign: "center" }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: T.ink }}>
          {working ? "Working…" : label}
        </div>
        {(error || hintText) && (
          <div style={{ fontSize: compact ? 11 : 12, color: error ? T.terra700 : T.ink3, marginTop: 4, lineHeight: 1.5 }}>
            {error || hintText}
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <style>{UPLOADER_CSS}</style>
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-label={label}
        aria-disabled={disabled}
        onClick={openBrowse}
        onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openBrowse(); } }}
        onDragOver={e => { e.preventDefault(); if (!disabled) setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer?.files); }}
        onPaste={e => {
          const items = Array.from(e.clipboardData?.files || []);
          if (items.length) { e.preventDefault(); handleFiles(items); }
        }}
        className={"uploader-zone" + (filled ? " uploader-tile" : "")}
        style={{
          position: "relative",
          overflow: "hidden",
          border: filled
            ? `1px solid ${active ? T.gold500 : T.bg3}`
            : `1.5px dashed ${active ? T.gold500 : T.bg3}`,
          background: active && !filled ? T.gold100 : T.bg,
          borderRadius: 10,
          maxWidth: preview && shape === "square" ? 140 : undefined,
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.6 : 1,
          outline: "none",
        }}
      >
        {contents}
        {/* DRAG-OVER on a filled tile: the same calm gold wash, no motion */}
        {active && filled && (
          <div aria-hidden="true" style={{ position: "absolute", inset: 0, background: T.gold100, opacity: 0.55, pointerEvents: "none" }} />
        )}
        {bar}
        <input
          ref={inputRef}
          type="file"
          accept={accept.join(",")}
          multiple={multiple}
          disabled={disabled}
          style={{ display: "none" }}
          onChange={e => { handleFiles(e.target.files); e.target.value = ""; }}
        />
      </div>
      {children}
    </div>
  );
}

// Quiet control-bar buttons on the filled tile (ink scrim + cream text —
// legible over any image; T tokens only).
const actBtnStyle = {
  background: T.ink + "cc",
  color: T.bg,
  border: "none",
  borderRadius: 7,
  padding: "4px 10px",
  fontSize: 11,
  fontWeight: 700,
  cursor: "pointer",
  lineHeight: 1.4,
};

// Shared client-side mirrors of the server's image rules (UI convenience
// only — the server re-validates every byte; see storeImpactPhotos /
// storeCampaignHero / the portal-settings PUT).
export const IMAGE_ACCEPT = ["image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml"];
export const IMAGE_ACCEPT_LABEL = "PNG, JPEG, GIF, WebP, or SVG under 350KB";
export const IMAGE_MAX_BYTES = 350 * 1024;
