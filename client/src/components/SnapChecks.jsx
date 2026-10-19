// CAPTURE-1 · SNAP CHECKS. A phone opens the camera for one check at a time,
// the checks wait in a tray, a deposit slip can be added last, and one press
// sends them to be read. Nothing is recorded here: every check becomes a card
// in "To confirm", and money is only ever logged by a person's tap there.
//
// Images are shrunk in the browser before they leave it (long edge 2000px,
// JPEG), which keeps a phone photo well under the 10 MB cap and turns a format
// the browser can decode but the server will not store into one it will.
import { useRef, useState } from "react";
import { T } from "./shared";
import { apiFetch } from "../api";
import { errorMessage } from "../lib/domainError";

export const CAPTURE_MAX_BYTES = 10 * 1024 * 1024;
export const CAPTURE_MAX_LABEL = "10 MB";
const LONG_EDGE = 2000;

const readDataUrl = file => new Promise(resolve => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = () => resolve(null);
  r.readAsDataURL(file);
});

const dataUrlBytes = dataUrl => {
  const b64 = String(dataUrl || "").split(",")[1] || "";
  return Math.floor(b64.length * 3 / 4);
};

// One file to { name, dataUrl } ready for POST /capture/upload, or { error }.
export async function prepareCaptureFile(file) {
  const name = file.name || "photo.jpg";
  const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(name);
  if (isPdf) {
    if (file.size > CAPTURE_MAX_BYTES) return { error: `"${name}" is larger than ${CAPTURE_MAX_LABEL}.` };
    const dataUrl = await readDataUrl(file);
    return dataUrl ? { name, dataUrl, isPdf: true } : { error: `Could not read "${name}".` };
  }
  const raw = await readDataUrl(file);
  if (!raw) return { error: `Could not read "${name}".` };
  const shrunk = await new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, LONG_EDGE / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
      const w = Math.max(1, Math.round(img.naturalWidth * scale)), h = Math.max(1, Math.round(img.naturalHeight * scale));
      try {
        const c = document.createElement("canvas");
        c.width = w; c.height = h;
        c.getContext("2d").drawImage(img, 0, 0, w, h);
        resolve(c.toDataURL("image/jpeg", 0.85));
      } catch { resolve(null); }
    };
    img.onerror = () => resolve(null);
    img.src = raw;
  });
  const dataUrl = shrunk || raw;
  if (dataUrlBytes(dataUrl) > CAPTURE_MAX_BYTES) return { error: `"${name}" is larger than ${CAPTURE_MAX_LABEL}.` };
  return { name: shrunk ? name.replace(/\.[a-z0-9]+$/i, "") + ".jpg" : name, dataUrl };
}

// The server takes at most 40 MB a request, so files go up to eight at a
// time (a slip rides with the last group) and later groups carry the batchId
// the first one returned, so one deposit stays one batch.
export const CAPTURE_PER_REQUEST = 8;
export async function uploadCaptureFiles(files, { batch = false, slip = null } = {}) {
  const groups = [];
  for (let i = 0; i < files.length; i += CAPTURE_PER_REQUEST) groups.push(files.slice(i, i + CAPTURE_PER_REQUEST));
  if (!groups.length && slip) groups.push([]);
  const out = { cards: [], batch: null, refused: [] };
  let batchId = null;
  for (let g = 0; g < groups.length; g++) {
    const last = g === groups.length - 1;
    const send = last && slip ? [...groups[g], slip] : groups[g];
    const body = { files: send.map(f => ({ name: f.name, dataUrl: f.dataUrl })), batch, slipIndex: last && slip ? groups[g].length : null };
    if (batchId) body.batchId = batchId;
    const r = await apiFetch("/capture/upload", { method: "POST", body: JSON.stringify(body) });
    out.cards.push(...((r && r.cards) || []));
    out.refused.push(...((r && r.refused) || []));
    if (r && r.batch) { out.batch = r.batch; batchId = batchId || r.batch.id; }
  }
  return out;
}

const btnBase = { borderRadius: 10, padding: "10px 16px", fontSize: 13.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" };
const primary = { ...btnBase, background: T.green, color: T.white, border: "none" };
const secondary = { ...btnBase, background: T.white, color: T.ink, border: "1px solid " + T.bg3 };

export function SnapChecks({ isReadOnly, onRead }) {
  const camRef = useRef(null);
  const slipRef = useRef(null);
  const [checks, setChecks] = useState([]);    // [{ name, dataUrl }]
  const [slip, setSlip] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const take = async (fileList, asSlip) => {
    setErr("");
    for (const f of Array.from(fileList || [])) {
      const p = await prepareCaptureFile(f);
      if (p.error) { setErr(p.error); continue; }
      if (asSlip) setSlip(p); else setChecks(cs => [...cs, p]);
    }
  };

  const send = async () => {
    if (!checks.length) return;
    setBusy(true); setErr("");
    try {
      const r = await uploadCaptureFiles(checks, { batch: true, slip });
      setChecks([]); setSlip(null);
      onRead && onRead(r);
    } catch (e) { setErr(errorMessage(e, "The checks could not be sent. They are still here; try again.")); }
    setBusy(false);
  };

  const n = checks.length;
  return (
    <div data-testid="capture-snap" style={{ background: T.white, border: "1px solid " + T.bg2, borderRadius: 14, padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: T.ink }}>Snap checks</div>
        <div style={{ fontSize: 12.5, color: T.ink3, lineHeight: 1.5 }}>
          One check per photo, front side, flat and in good light. Add the deposit slip last if you have one. Nothing is logged until you confirm each card.
        </div>
      </div>
      <input ref={camRef} type="file" accept="image/*" capture="environment" style={{ display: "none" }} data-testid="capture-snap-input"
        onChange={e => { take(e.target.files, false); e.target.value = ""; }} />
      <input ref={slipRef} type="file" accept="image/*" capture="environment" style={{ display: "none" }} data-testid="capture-slip-input"
        onChange={e => { take(e.target.files, true); e.target.value = ""; }} />
      {(n > 0 || slip) && (
        <div data-testid="capture-tray" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {checks.map((c, i) => (
            <div key={i} style={{ position: "relative", width: 96, height: 44, borderRadius: 6, overflow: "hidden", border: "1px solid " + T.bg3, background: T.bg }}>
              <img src={c.dataUrl} alt={`Check ${i + 1}`} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              <button type="button" aria-label={`Remove check ${i + 1}`} onClick={() => setChecks(cs => cs.filter((_, j) => j !== i))}
                style={{ position: "absolute", top: 2, right: 2, width: 20, height: 20, borderRadius: 99, border: "none", background: T.ink, color: T.white, fontSize: 12, lineHeight: "20px", padding: 0, cursor: "pointer" }}>×</button>
            </div>
          ))}
          {slip && (
            <div style={{ position: "relative", width: 96, height: 44, borderRadius: 6, overflow: "hidden", border: "2px solid " + T.gold, background: T.bg }}>
              <img src={slip.dataUrl} alt="Deposit slip" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              <span style={{ position: "absolute", left: 0, bottom: 0, background: T.gold, color: T.ink, fontSize: 9.5, fontWeight: 800, padding: "1px 5px" }}>SLIP</span>
            </div>
          )}
        </div>
      )}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" data-testid="capture-snap-one" disabled={isReadOnly || busy} onClick={() => camRef.current && camRef.current.click()}
          style={n ? secondary : primary}>{n ? "Snap another check" : "Snap a check"}</button>
        {n > 0 && !slip && (
          <button type="button" data-testid="capture-snap-slip" disabled={isReadOnly || busy} onClick={() => slipRef.current && slipRef.current.click()} style={secondary}>
            Add the deposit slip
          </button>
        )}
        {n > 0 && (
          <button type="button" data-testid="capture-snap-send" disabled={isReadOnly || busy} onClick={send} style={{ ...primary, opacity: busy ? 0.6 : 1 }}>
            {busy ? "Reading…" : `Read ${n === 1 ? "this check" : `these ${n} checks`}`}
          </button>
        )}
      </div>
      {err && <div style={{ fontSize: 12.5, color: T.ink, borderLeft: "3px solid " + T.gold, paddingLeft: 8 }}>{err}</div>}
    </div>
  );
}
