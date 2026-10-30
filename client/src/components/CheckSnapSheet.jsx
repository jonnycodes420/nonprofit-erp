// CheckSnapSheet.jsx · SWEEP-6 (PERF-1): the Add a check window, split out of
// CheckSnap.jsx so the app shell carries only the opener and the page-wide
// drop; this, CaptureCard and SnapChecks load the first time a check is opened.
import { useEffect, useRef, useState } from "react";
import { Camera } from "lucide-react";
import { Modal, T } from "./shared";
import { apiFetch } from "../api";
import { errorMessage } from "../lib/domainError";
import { prepareCaptureFile, uploadCaptureFiles } from "./SnapChecks";
import { CaptureCard } from "./CaptureCard";
import { OPEN_EVENT, CAPTURE_CHANGED, isPhone, isCheckFile } from "./CheckSnap";

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

export default function CheckSnapSheet({ donor, initialFiles, onClose, onOpenThanks, isReadOnly }) {
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

