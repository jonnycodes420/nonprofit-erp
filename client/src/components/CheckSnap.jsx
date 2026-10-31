// CHECK-2 · A CHECK FROM ANYWHERE. One window for snapping or dropping a
// check, opened from the mic window, Home's To confirm tile, a profile's
// Giving tab, the phone's tab bar, or by dragging an image or PDF onto any
// page. It sends the file through the same POST /capture/upload as To confirm
// and shows the same CaptureCard, so a check read here is the card To confirm
// lists, and money is still only logged by the confirm tap.
//
// On a phone the camera opens straight away: openCheckSnap() clicks a camera
// input inside the tap that called it (a browser only opens a file picker
// from a person's own gesture), and the window opens with the photo.
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Camera } from "lucide-react";
import { T } from "./shared";
import { retryImport } from "../lib/lazyRetry";

export const OPEN_EVENT = "steward:check-snap";
export const CAPTURE_CHANGED = "steward:capture-changed";
// SWEEP-6 (PERF-1): the window loads on first open (CheckSnapSheet.jsx).
const CheckSnapSheet = lazy(() => retryImport(() => import("./CheckSnapSheet")));
const DROP_TYPES = ["image/png", "image/jpeg", "image/webp", "application/pdf"];
const DROP_NAMES = /\.(png|jpe?g|webp|pdf)$/i;

export const isPhone = () => {
  try { return window.matchMedia("(max-width: 720px)").matches || window.matchMedia("(pointer: coarse)").matches; } catch { return false; }
};
export const isCheckFile = f => !!f && (DROP_TYPES.includes(f.type) || (!f.type && DROP_NAMES.test(f.name || "")));
const fire = detail => { try { window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail })); } catch { /* no window */ } };

// { donor: {id,name} | null, files: File[] | null, camera: bool }
export function openCheckSnap({ donor = null, files = null, camera = false } = {}) {
  if (!files && camera && isPhone()) {
    const input = document.createElement("input");
    input.type = "file"; input.accept = "image/*"; input.setAttribute("capture", "environment");
    input.style.display = "none";
    input.addEventListener("change", () => {
      const picked = Array.from(input.files || []);
      input.remove();
      if (picked.length) fire({ donor, files: picked });
    });
    document.body.appendChild(input);
    input.click();
    return;
  }
  fire({ donor, files: files ? Array.from(files) : null });
}

// Mounted once in the app shell: the window, and the page-wide drop.
export function CheckSnapHost({ isReadOnly, onNavigate }) {
  const [open, setOpen] = useState(null);   // { donor, files, n }
  const [dragging, setDragging] = useState(false);
  const openRef = useRef(null);
  openRef.current = open;

  useEffect(() => {
    const on = e => {
      const d = e.detail || {};
      if (openRef.current && d.files && d.files.length) { window.dispatchEvent(new CustomEvent(OPEN_EVENT + ":more", { detail: d })); return; }
      setOpen({ donor: d.donor || null, files: d.files || null, n: Date.now() });
    };
    window.addEventListener(OPEN_EVENT, on);
    return () => window.removeEventListener(OPEN_EVENT, on);
  }, []);

  // A drag of files over a page with no drop zone of its own. A zone that
  // takes files (To confirm, an import, a photo) calls preventDefault first,
  // so a drag over it, and a drop on it, are left to it.
  useEffect(() => {
    if (isReadOnly) return undefined;
    let timer = null;
    const hasFiles = e => { const t = e.dataTransfer && e.dataTransfer.types; return !!t && Array.from(t).includes("Files"); };
    const over = e => {
      if (!hasFiles(e)) return;
      clearTimeout(timer);
      if (e.defaultPrevented) { setDragging(false); return; }
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      setDragging(true);
      timer = setTimeout(() => setDragging(false), 250);
    };
    const drop = e => {
      if (!hasFiles(e)) return;
      clearTimeout(timer); setDragging(false);
      if (e.defaultPrevented) return;
      e.preventDefault();
      const files = Array.from(e.dataTransfer.files || []).filter(isCheckFile);
      if (files.length) openCheckSnap({ files });
    };
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => { clearTimeout(timer); window.removeEventListener("dragover", over); window.removeEventListener("drop", drop); };
  }, [isReadOnly]);

  return (
    <>
      {dragging && (
        <div data-testid="check-drop-overlay" aria-hidden="true"
          style={{ position: "fixed", inset: 0, zIndex: 390, pointerEvents: "none", background: T.ink + "99", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: T.white, border: "2px dashed " + T.green, borderRadius: 16, padding: "28px 32px", display: "flex", alignItems: "center", gap: 14, maxWidth: 440 }}>
            <Camera size={28} color={T.green} />
            <div style={{ fontSize: 15, fontWeight: 700, color: T.ink, lineHeight: 1.4 }}>Drop a check image or PDF to read it. Nothing is logged until you confirm.</div>
          </div>
        </div>
      )}
      {open && (
        <Suspense fallback={null}><CheckSnapSheet key={open.n} donor={open.donor} initialFiles={open.files} isReadOnly={isReadOnly} onClose={() => setOpen(null)}
          onOpenThanks={onNavigate ? id => onNavigate("communications", { subtab: "milestones", highlightDraftId: id }) : null} /></Suspense>
      )}
    </>
  );
}
