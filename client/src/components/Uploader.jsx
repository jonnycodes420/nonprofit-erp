// BUILD-54 §6 — THE one shared drag-and-drop uploader, used everywhere the
// product accepts a file (theme logo/header, impact photos, campaign hero,
// donor CSV/XLSX import, donor materials). Rules it exists to enforce:
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
// The component hands each accepted file to onFile as { file, dataUrl } (or
// file-only when readAs="none", e.g. CSV import keeps its own parser) and
// leaves preview rendering to the caller via children — call sites already
// have their own thumbnail / banner-crop / row-count treatments.
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
  compact = false,
  label = "Drop a file here, or browse",
  children = null,        // caller-rendered preview / current-value UI
}) {
  const inputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState("");
  const [reading, setReading] = useState(false);

  const fail = (msg) => setError(msg);

  async function handleFiles(fileList) {
    if (disabled) return;
    setError("");
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

  return (
    <div>
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
        style={{
          border: `2px dashed ${active ? T.gold500 : T.bg3}`,
          background: active ? T.gold100 : T.bg,
          borderRadius: 10,
          padding: compact ? "10px 14px" : "18px 16px",
          textAlign: "center",
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.6 : 1,
          outline: "none",
          transition: "border-color 120ms, background 120ms",
        }}
        className="uploader-zone"
      >
        <div style={{ fontSize: 13, fontWeight: 600, color: T.ink }}>
          {busy || reading ? "Working…" : label}
        </div>
        {!compact && (
          <div style={{ fontSize: 11, color: T.ink3, marginTop: 4 }}>
            Drag &amp; drop, click to browse{accept.some(a => String(a).startsWith("image")) ? ", or paste an image" : ""}
            {acceptLabel ? ` · ${acceptLabel}` : ""}
          </div>
        )}
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
      {error && <div style={{ marginTop: 6, fontSize: 12, color: T.terra700 }}>{error}</div>}
      {children}
    </div>
  );
}

// Shared client-side mirrors of the server's image rules (UI convenience
// only — the server re-validates every byte; see storeImpactPhotos /
// storeCampaignHero / the portal-settings PUT).
export const IMAGE_ACCEPT = ["image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml"];
export const IMAGE_ACCEPT_LABEL = "PNG, JPEG, GIF, WebP, or SVG under 350KB";
export const IMAGE_MAX_BYTES = 350 * 1024;
