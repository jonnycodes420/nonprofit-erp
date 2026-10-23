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
import { useEffect, useRef, useState } from "react";
import { Camera } from "lucide-react";
import { Modal, T } from "./shared";
import { apiFetch } from "../api";
import { errorMessage } from "../lib/domainError";
import { prepareCaptureFile, uploadCaptureFiles } from "./SnapChecks";
import { CaptureCard } from "./CaptureCard";

const OPEN_EVENT = "steward:check-snap";
const CAPTURE_CHANGED = "steward:capture-changed";
const DROP_TYPES = ["image/png", "image/jpeg", "image/webp", "application/pdf"];
const DROP_NAMES = /\.(png|jpe?g|webp|pdf)$/i;
const CARD_CSS = `
.capture-card-grid { display: grid; grid-template-columns: minmax(0, 5fr) minmax(0, 6fr); gap: 18px; align-items: start; }
.capture-doc-img { max-height: 420px; }
.capture-doc-frame { height: 420px; }
@media (max-width: 720px) {
  .capture-card-grid { grid-template-columns: minmax(0, 1fr); gap: 12px; }
  .capture-doc-img { max-height: 36vh; }
  .capture-doc-frame { height: 36vh; }
}
`;

export const isPhone = () => {
  try { return window.matchMedia("(max-width: 720px)").matches || window.matchMedia("(pointer: coarse)").matches; } catch { return false; }
};
const isCheckFile = f => !!f && (DROP_TYPES.includes(f.type) || (!f.type && DROP_NAMES.test(f.name || "")));
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

// A person started from a profile: that person leads the card, with the
// reading's own match kept as the other choice.
function preferDonor(card, donor) {
  if (!donor || !donor.id || card.stakes !== "money") return card;
  const d = card.donor || { state: "new", choices: [], prefill: {} };
  if (d.state === "matched" && d.selectedId === donor.id) return card;
  const others = (d.choices || []).filter(c => c.id !== donor.id);
  return { ...card, donor: { ...d, state: "matched", selectedId: donor.id,
    choices: [{ id: donor.id, name: donor.name, why: "you started from their profile" }, ...others] } };
}

function CheckSnapSheet({ donor, initialFiles, onClose, onOpenThanks, isReadOnly }) {
  const camRef = useRef(null);
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [cards, setCards] = useState([]);
  const [refused, setRefused] = useState([]);
  const [funds, setFunds] = useState([]);
  const started = useRef(false);

  useEffect(() => { apiFetch("/finance/funds").then(f => setFunds(Array.isArray(f) ? f : [])).catch(() => setFunds([])); }, []);

  const read = async list => {
    const files = Array.from(list || []).filter(isCheckFile);
    if (!files.length) { setErr("That isn't a photo or a PDF Steward can read. Use a JPG, PNG, WEBP or PDF."); return; }
    setBusy(true); setErr("");
    try {
      const prepared = [];
      for (const f of files.slice(0, 12)) {
        const p = await prepareCaptureFile(f);
        if (p.error) setErr(p.error); else prepared.push(p);
      }
      if (prepared.length) {
        const r = await uploadCaptureFiles(prepared, { batch: prepared.length > 1 });
        setCards(cs => [...cs, ...(r.cards || []).map(c => preferDonor(c, donor))]);
        setRefused(r.refused || []);
        try { window.dispatchEvent(new Event(CAPTURE_CHANGED)); } catch { /* no window */ }
      }
    } catch (e) { setErr(errorMessage(e, "The check could not be sent. Try again.")); }
    setBusy(false);
  };

  useEffect(() => {
    if (started.current || !initialFiles || !initialFiles.length) return;
    started.current = true;
    read(initialFiles);
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  // A second drop while the window is open joins it.
  useEffect(() => {
    const on = e => { if (e.detail && e.detail.files && e.detail.files.length) read(e.detail.files); };
    window.addEventListener(OPEN_EVENT + ":more", on);
    return () => window.removeEventListener(OPEN_EVENT + ":more", on);
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  const btn = primary => ({ background: primary ? T.green : T.white, color: primary ? T.white : T.ink, border: primary ? "none" : "1px solid " + T.bg3,
    borderRadius: 10, padding: "11px 16px", fontSize: 14, fontWeight: 700, cursor: busy ? "default" : "pointer", fontFamily: "inherit", opacity: busy ? 0.6 : 1 });

  return (
    <Modal onClose={onClose} title={donor ? `Add a check from ${donor.name}` : "Add a check"} width={cards.length ? 900 : 520} align={isPhone() ? "top" : "center"} ariaLabel="Add a check">
      <style>{CARD_CSS}</style>
      <div data-testid="check-snap-sheet" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <input ref={camRef} type="file" accept="image/*" capture="environment" style={{ display: "none" }} data-testid="check-snap-camera"
          onChange={e => { read(e.target.files); e.target.value = ""; }} />
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,application/pdf,.pdf" multiple style={{ display: "none" }} data-testid="check-snap-file"
          onChange={e => { read(e.target.files); e.target.value = ""; }} />
        {!cards.length && (
          <>
            <div style={{ fontSize: 13.5, color: T.ink2, lineHeight: 1.5 }}>
              Photograph the front of the check, flat and in good light, or choose a photo or a scanned PDF. You can also drop one onto any page. Nothing is logged until you confirm it.
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button type="button" data-testid="check-snap-take" disabled={busy || isReadOnly} onClick={() => camRef.current && camRef.current.click()} style={btn(true)}>Take a photo</button>
              <button type="button" data-testid="check-snap-choose" disabled={busy || isReadOnly} onClick={() => fileRef.current && fileRef.current.click()} style={btn(false)}>Choose a photo or PDF</button>
            </div>
          </>
        )}
        {busy && <div role="status" data-testid="check-snap-reading" style={{ fontSize: 13.5, color: T.ink }}>Reading the check…</div>}
        {err && <div role="alert" style={{ fontSize: 12.5, color: T.ink, borderLeft: "3px solid " + T.gold, paddingLeft: 8 }}>{err}</div>}
        {refused.map((f, i) => <div key={i} style={{ fontSize: 12.5, color: T.ink, borderLeft: "3px solid " + T.gold, paddingLeft: 8 }}><strong>{f.name}</strong>: {f.sentence}</div>)}
        {cards.map(c => (
          <CaptureCard key={c.id} card={c} funds={funds} isReadOnly={isReadOnly}
            onOpenThanks={onOpenThanks ? id => { onClose(); onOpenThanks(id); } : null}
            onChanged={() => { try { window.dispatchEvent(new Event(CAPTURE_CHANGED)); } catch { /* no window */ } }} />
        ))}
        {cards.length > 0 && !busy && (
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button type="button" data-testid="check-snap-another" disabled={isReadOnly} onClick={() => camRef.current && camRef.current.click()} style={btn(false)}>Snap another check</button>
          </div>
        )}
      </div>
    </Modal>
  );
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
        <CheckSnapSheet key={open.n} donor={open.donor} initialFiles={open.files} isReadOnly={isReadOnly} onClose={() => setOpen(null)}
          onOpenThanks={onNavigate ? id => onNavigate("communications", { subtab: "milestones", highlightDraftId: id }) : null} />
      )}
    </>
  );
}
