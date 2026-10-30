// StewardEditor.jsx · EDITOR-1. THE ONE EDITOR FOR ANYTHING A DONOR SEES.
//
// The giving page editor (GIVE-3) made into a shell every donor-facing thing
// opens in: giving pages, event pages, every email. The same five parts, in
// the same places, whatever is being edited:
//
//   Top bar     Back, the item's name and type badge, Phone / Desktop (and
//               any extra toggle the type needs, Dark mode for email), what
//               the draft is doing ("Draft autosaves"), the quiet actions
//               (History, Revert to published, Send me a test) and ONE primary
//               action (Publish, Save, Send to 212).
//   Left rail   every setting, in sections that fold. About 320 px wide, and
//               it scrolls on its own.
//   Preview     the thing itself, which is where it is edited: text is typed
//               where it shows, a picture is clicked to replace it or set its
//               focus, a block shows its handles when the pointer is on it.
//               One preview at a time; the toggle changes its width.
//   Right rail  only when the type needs one: what it is checked against, who
//               it goes to, what is held and why.
//
// Below 900 px the rails are sheets opened from the top bar and the preview
// fills the screen. The shell owns none of the item's state: each editor
// passes its sections, its preview and its actions, and keeps its own saves.
import { useState, useEffect, useRef } from "react";
import { T } from "./shared";
import { apiFetch } from "../api";
import { readPicture, pictureSrc, focusOf } from "./Picture";
import { uploadPicture, PHOTO_ACCEPT } from "./PhotoField";

export const NARROW_AT = 900;
let stockSeq = 0;   // which of Steward's photos a new photo block takes next
const RAIL_W = 320;
const ED = {
  bar: T.ink, barFg: T.inkInverse, barLine: T.green650, quietFg: T.inkInverse,
  rail: T.ground, railLine: T.bg2, canvas: T.green950, sheetScrim: "rgba(15,26,18,0.45)",
};
const quiet = on => ({ background: on ? T.green800 : "transparent", color: ED.quietFg, border: "1px solid " + (on ? T.gold : ED.barLine),
  borderRadius: 9, padding: "6px 12px", fontSize: 12.5, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" });
const primaryBtn = disabled => ({ background: disabled ? T.green650 : T.gold, color: T.ink, border: "none", borderRadius: 9, padding: "8px 16px",
  fontSize: 13, fontWeight: 700, cursor: disabled ? "not-allowed" : "pointer", fontFamily: "inherit", whiteSpace: "nowrap", opacity: disabled ? 0.75 : 1 });

// Shared bits every rail uses, so the three editors read alike.
export const railLabel = { display: "block", fontSize: 11, fontWeight: 700, color: T.ink3, textTransform: "uppercase", letterSpacing: "0.06em", margin: "10px 0 4px" };
export const railInput = { width: "100%", boxSizing: "border-box", padding: "8px 10px", fontSize: 13, border: "1px solid " + T.bg3, borderRadius: 8, fontFamily: "inherit", color: T.ink, background: T.white };
export const railQuietBtn = { background: T.white, color: T.ink, border: "1px solid " + T.bg3, borderRadius: 8, padding: "6px 12px", fontSize: 12.5, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" };
export const railNote = { fontSize: 12, color: T.ink3, lineHeight: 1.5 };

export function useNarrow(at = NARROW_AT) {
  const [narrow, setNarrow] = useState(() => typeof window !== "undefined" && window.innerWidth < at);
  useEffect(() => {
    const on = () => setNarrow(window.innerWidth < at);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, [at]);
  return narrow;
}

// One folding section of the left rail. `focus` is a number the parent bumps
// to open this section and bring it into view (a click on the photo in the
// preview opens "Cover photo").
export function RailSection({ id, title, hint, defaultOpen = true, focus = 0, children, testid }) {
  const [open, setOpen] = useState(defaultOpen);
  const ref = useRef(null);
  useEffect(() => {
    if (!focus) return;
    setOpen(true);
    setTimeout(() => { if (ref.current) ref.current.scrollIntoView({ block: "start", behavior: "smooth" }); }, 40);
  }, [focus]);
  return (
    <section ref={ref} data-rail-section={id} data-testid={testid} style={{ borderBottom: "1px solid " + ED.railLine }}>
      <button type="button" aria-expanded={open} onClick={() => setOpen(o => !o)}
        style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", background: "none", border: "none", padding: "13px 16px",
          cursor: "pointer", fontFamily: "inherit", textAlign: "left", color: T.ink }}>
        <span style={{ flex: 1, fontSize: 13, fontWeight: 700 }}>{title}</span>
        <span aria-hidden="true" style={{ fontSize: 11, color: T.ink3, transform: open ? "rotate(180deg)" : "none", transition: "transform .15s" }}>{"▾"}</span>
      </button>
      {open && (
        <div style={{ padding: "0 16px 16px" }}>
          {hint && <div style={{ fontSize: 12, color: T.ink3, lineHeight: 1.5, marginBottom: 8 }}>{hint}</div>}
          {children}
        </div>
      )}
    </section>
  );
}

// The preview at the width a donor reads it. Phone is a 390 frame centred on
// the canvas (on a real phone it is simply the screen); desktop fills the pane.
export function DeviceFrame({ device, narrow, children, label, testid = "editor-frame" }) {
  if (device === "phone" && !narrow) {
    return (
      <div style={{ flex: 1, minWidth: 0, overflow: "auto", display: "flex" }}>
        <div style={{ margin: "auto", padding: 24 }}>
          <div style={{ background: T.ink, borderRadius: 40, padding: 10, boxShadow: "0 18px 50px rgba(0,0,0,0.45)" }}>
            <div data-testid={testid} data-device="phone" style={{ width: 390, maxWidth: "calc(100vw - 120px)", height: "min(844px, calc(100vh - 150px))",
              background: T.white, borderRadius: 30, overflow: "hidden", display: "flex", flexDirection: "column" }}>
              <div style={{ flex: 1, overflowY: "auto", minHeight: 0, display: "flex", flexDirection: "column" }}>{children}</div>
            </div>
          </div>
          {label && <div style={{ textAlign: "center", fontSize: 11, color: T.green200, marginTop: 10 }}>{label}</div>}
        </div>
      </div>
    );
  }
  return (
    <div data-testid={testid} data-device={device} style={{ flex: 1, minWidth: 0, overflowY: "auto", display: "flex", flexDirection: "column", background: T.white }}>
      {children}
    </div>
  );
}

function Sheet({ title, onClose, side = "left", children, testid }) {
  return (
    <div role="dialog" aria-label={title} data-testid={testid} style={{ position: "fixed", inset: 0, zIndex: 420, display: "flex", justifyContent: side === "left" ? "flex-start" : "flex-end", background: ED.sheetScrim }}
      onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ width: "min(100vw, 420px)", height: "100%", background: ED.rail, display: "flex", flexDirection: "column", boxShadow: "0 0 30px rgba(0,0,0,0.3)" }}>
        <div style={{ display: "flex", alignItems: "center", padding: "12px 16px", borderBottom: "1px solid " + ED.railLine }}>
          <span style={{ flex: 1, fontSize: 14, fontWeight: 700, color: T.ink }}>{title}</span>
          <button type="button" onClick={onClose} style={{ background: "none", border: "1px solid " + T.bg3, borderRadius: 8, padding: "5px 12px", fontSize: 12.5, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", color: T.ink }}>Done</button>
        </div>
        <div style={{ flex: 1, overflowY: "auto" }}>{children}</div>
      </div>
    </div>
  );
}

// back:      { href } or { onClick }, and `label` ("Back")
// toggles:   [{ id, label, on, onClick }] beside Phone / Desktop (Dark mode)
// actions:   [{ id, label, onClick, active, disabled, testid }] the quiet ones
// primary:   { label, onClick, disabled, reason, testid } the one action
// left:      the rail's sections (RailSection elements)
// right:     the right rail's contents, or null
export default function StewardEditor({
  testid = "steward-editor", kind, back, name, badge, devices = ["phone", "desktop"], device, onDevice,
  toggles = [], status, actions = [], primary, notice, left, leftTitle = "Settings", right, rightTitle = "Status",
  children, fixed = true,
}) {
  const narrow = useNarrow();
  const [sheet, setSheet] = useState(null);   // "left" | "right" | null, below 900 only
  const backEl = back && (back.href
    ? <a data-testid="editor-back" href={back.href} style={{ color: ED.barFg, textDecoration: "none", fontSize: 13, fontWeight: 600, whiteSpace: "nowrap" }}>{"← "}{back.label || "Back"}</a>
    : <button type="button" data-testid="editor-back" onClick={back.onClick} style={{ background: "none", border: "none", color: ED.barFg, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", padding: 0, whiteSpace: "nowrap" }}>{"← "}{back.label || "Back"}</button>);
  const deviceBtns = (
    <div role="group" aria-label="Preview width" style={{ display: "flex", gap: 4 }}>
      {!narrow && devices.map(d => (
        <button key={d} type="button" data-testid={"editor-device-" + d} aria-pressed={device === d} onClick={() => onDevice && onDevice(d)} style={quiet(device === d)}>
          {d === "phone" ? "Phone" : d === "desktop" ? "Desktop" : d}
        </button>
      ))}
      {toggles.map(t => (
        <button key={t.id} type="button" data-testid={"editor-toggle-" + t.id} aria-pressed={!!t.on} onClick={t.onClick} style={quiet(!!t.on)}>{t.label}</button>
      ))}
    </div>
  );
  const quietActions = actions.filter(Boolean).map(a => (
    <button key={a.id} type="button" data-testid={a.testid || "editor-" + a.id} disabled={a.disabled} onClick={a.onClick}
      style={{ ...quiet(!!a.active), opacity: a.disabled ? 0.55 : 1, cursor: a.disabled ? "not-allowed" : "pointer" }}>{a.label}</button>
  ));
  const primaryEl = primary && (
    <button type="button" data-testid={primary.testid || "editor-primary"} data-commit onClick={primary.onClick} disabled={!!primary.disabled}
      title={primary.disabled && primary.reason ? primary.reason : undefined} style={primaryBtn(!!primary.disabled)}>{primary.label}</button>
  );
  const shell = { height: fixed ? "100%" : "100vh", background: ED.canvas, fontFamily: "'DM Sans',system-ui,sans-serif", display: "flex", flexDirection: "column", color: T.ink, minHeight: 0 };
  return (
    <div data-testid={testid} data-editor-kind={kind} style={shell}>
      {/* ── Top bar ── */}
      <div data-testid="editor-topbar" style={{ display: "flex", alignItems: "center", gap: 10, padding: narrow ? "8px 12px" : "10px 16px", background: ED.bar, color: ED.barFg, flexWrap: "wrap", flexShrink: 0 }}>
        {backEl}
        <span data-testid="editor-name" style={{ fontFamily: "'DM Serif Display',Georgia,serif", fontSize: 16, minWidth: 0, maxWidth: narrow ? "52vw" : 340, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
        {badge && <span data-testid="editor-badge" style={{ fontSize: 11, fontWeight: 700, background: T.gold, color: T.ink, borderRadius: 20, padding: "3px 10px", whiteSpace: "nowrap" }}>{badge}</span>}
        {!narrow && <div style={{ marginLeft: 8 }}>{deviceBtns}</div>}
        <span data-testid="editor-status" style={{ marginLeft: "auto", fontSize: 12, color: T.green200, whiteSpace: "nowrap" }}>{status}</span>
        {!narrow && quietActions}
        {primaryEl}
        {narrow && (
          <div style={{ display: "flex", gap: 6, width: "100%", flexWrap: "wrap", alignItems: "center" }}>
            {left && <button type="button" data-testid="editor-open-settings" onClick={() => setSheet("left")} style={quiet(sheet === "left")}>{leftTitle}</button>}
            {right && <button type="button" data-testid="editor-open-status" onClick={() => setSheet("right")} style={quiet(sheet === "right")}>{rightTitle}</button>}
            {deviceBtns}
            {quietActions}
          </div>
        )}
      </div>
      {primary && primary.disabled && primary.reason && (
        <div data-testid="editor-primary-reason" style={{ background: T.gold50, color: T.ink, fontSize: 12.5, padding: "7px 16px", lineHeight: 1.45, borderBottom: "1px solid " + T.gold300 }}>{primary.reason}</div>
      )}
      {notice}

      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        {left && !narrow && (
          <aside data-testid="editor-left-rail" style={{ width: RAIL_W, flexShrink: 0, background: ED.rail, borderRight: "1px solid " + ED.railLine, overflowY: "auto", paddingBottom: 40 }}>
            {left}
          </aside>
        )}
        <main data-testid="editor-canvas" style={{ flex: 1, minWidth: 0, display: "flex", minHeight: 0 }}>{children}</main>
        {right && !narrow && (
          <aside data-testid="editor-right-rail" style={{ width: RAIL_W, flexShrink: 0, background: ED.rail, borderLeft: "1px solid " + ED.railLine, overflowY: "auto", paddingBottom: 40 }}>
            {right}
          </aside>
        )}
      </div>
      {narrow && sheet === "left" && left && <Sheet title={leftTitle} onClose={() => setSheet(null)} testid="editor-left-sheet">{left}</Sheet>}
      {narrow && sheet === "right" && right && <Sheet title={rightTitle} side="right" onClose={() => setSheet(null)} testid="editor-right-sheet">{right}</Sheet>}
    </div>
  );
}

// THE PHOTO IN THE RAIL. A thumbnail, Replace (a file of hers), Choose a
// photo (Steward's library and hers), Remove, and the words a screen reader
// says. The focus is set on the photo in the preview, where it is seen.
// value: { url, alt, fx, fy, stock } or null. `stock` says it is one of
// Steward's photos, so the section asks for one of hers.
export function RailPhoto({ value, onChange, name = "", onLibrary, testid = "rail-photo", emptyNote }) {
  const pic = readPicture(value);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const fileRef = useRef(null);
  const take = async file => {
    setBusy(true); setErr("");
    try { const url = await uploadPicture(file); onChange({ url, alt: (pic && !value.stock && pic.alt) || name || "", fx: 0.5, fy: 0.5 }); }
    catch (e) { setErr((e && e.message) || "That photo did not upload. Try another."); }
    finally { setBusy(false); }
  };
  return (
    <div data-testid={testid} data-empty={pic ? "false" : "true"} data-stock={value && value.stock ? "true" : "false"}>
      {pic ? (
        <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
          <img src={pictureSrc(pic, 320)} alt="" style={{ width: 112, aspectRatio: "16 / 9", objectFit: "cover", objectPosition: focusOf(pic), borderRadius: 8, flexShrink: 0, background: T.bg }} />
          <div style={{ minWidth: 0, fontSize: 12, color: T.ink3, lineHeight: 1.45 }}>
            {value && value.stock
              ? <span data-testid={testid + "-stock"}><b style={{ color: T.ink }}>Stock photo</b> · Replace with yours</span>
              : <span>Click the photo in the preview to choose what always shows on a phone.</span>}
          </div>
        </div>
      ) : (
        <div style={{ fontSize: 12, color: T.ink3, lineHeight: 1.5 }}>{emptyNote || "No photo. The page uses its photo-free layout."}</div>
      )}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
        <button type="button" style={railQuietBtn} disabled={busy} data-testid={testid + "-upload"} onClick={() => fileRef.current && fileRef.current.click()}>{busy ? "Uploading…" : pic ? "Replace" : "Upload"}</button>
        {onLibrary && <button type="button" style={railQuietBtn} disabled={busy} data-testid={testid + "-library"} onClick={onLibrary}>Choose a photo</button>}
        {pic && <button type="button" style={railQuietBtn} disabled={busy} data-testid={testid + "-remove"} onClick={() => onChange(null)}>Remove</button>}
        <input ref={fileRef} type="file" accept={PHOTO_ACCEPT.join(",")} hidden onChange={e => { const f = e.target.files && e.target.files[0]; e.target.value = ""; if (f) take(f); }} />
      </div>
      {pic && (
        <label style={{ ...railLabel, textTransform: "none", letterSpacing: 0, fontSize: 12 }}>Describe the photo
          <input style={{ ...railInput, marginTop: 4, fontWeight: 400 }} value={pic.alt} placeholder={name || "What the photo shows"} data-testid={testid + "-alt"}
            onChange={e => onChange({ ...value, ...pic, alt: e.target.value })} />
        </label>
      )}
      {err && <div role="alert" style={{ fontSize: 12, color: T.ink, marginTop: 4 }}>{err}</div>}
    </div>
  );
}

// THE PHOTO'S TOOLS, IN THE PREVIEW. Laid over the photo: a click sets the
// focus (what a phone's narrower crop keeps), and Replace and Remove sit in
// the corner. Used by every editor whose preview carries a photo.
export function PhotoTools({ has, focus, onFocus, onReplace, onRemove, testid = "photo-tools" }) {
  const pick = e => {
    if (!onFocus) return;
    const r = e.currentTarget.getBoundingClientRect();
    onFocus(Math.round(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * 1000) / 1000, Math.round(Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) * 1000) / 1000);
  };
  const chip = { background: T.ink, color: T.inkInverse, border: "none", borderRadius: 7, padding: "5px 10px", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "'DM Sans',system-ui,sans-serif" };
  return (
    <div data-editor-tools="photo" data-editor-only="" data-testid={testid} className="se-photo-tools" onClick={has ? pick : undefined} title={has ? "Click the part of the photo that must always show" : undefined}
      style={{ position: "absolute", inset: 0, cursor: has ? "crosshair" : "default", borderRadius: "inherit" }}>
      {has && focus && <span aria-hidden="true" style={{ position: "absolute", left: `calc(${focus.fx * 100}% - 8px)`, top: `calc(${focus.fy * 100}% - 8px)`, width: 12, height: 12, borderRadius: "50%", border: "2px solid " + T.white, boxShadow: "0 0 0 2px " + T.ink, pointerEvents: "none" }} />}
      <div style={{ position: "absolute", top: 10, right: 10, display: "flex", gap: 6 }} onClick={e => e.stopPropagation()}>
        <button type="button" style={chip} data-testid={testid + "-replace"} onClick={onReplace}>{has ? "Replace photo" : "Add a photo"}</button>
        {has && onRemove && <button type="button" style={chip} data-testid={testid + "-remove"} onClick={onRemove}>Remove</button>}
      </div>
    </div>
  );
}

// A new photo block starts with one of Steward's photos, never an empty box.
export async function stockPhotoForBlock() {
  try {
    const lib = await apiFetch("/stock-photos");
    const group = (lib.groups || []).find(g => g.key === lib.suggested) || (lib.groups || [])[0];
    // Not always the first: a second photo block should not repeat the cover.
    const list = (group && group.photos) || [];
    const first = list.length ? list[(stockSeq++ + 1 + Math.floor(Math.random() * list.length)) % list.length] : null;
    if (!first) return null;
    const used = await apiFetch(`/stock-photos/${encodeURIComponent(first.id)}/use`, { method: "POST", body: "{}" });
    return used && used.url ? { src: used.url, alt: used.alt || first.alt || "" } : null;
  } catch { return null; }
}
