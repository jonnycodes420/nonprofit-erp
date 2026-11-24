// SignatureField.jsx · LETTERS-1 item 2. "Can I send you a picture of my
// signature so that can get uploaded?... my signature is in a blue pen."
//
// A photo or scan of a signature (PNG or JPEG). The paper is made clear in the
// browser: every pixel close to the paper's own colour (read off the picture's
// corners) becomes transparent, the ink keeps its colour, and the picture is
// cropped to the ink. It is shown on a small letter, above the typed name,
// the way it prints. scope "org" is Settings → Tax receipts (the receipt
// signer); scope "mine" is the person's own.
import { useState, useEffect } from "react";
import { apiFetch } from "../../api";
import { T } from "../shared";
import { errorMessage } from "../../lib/domainError";

const quiet = { background: "transparent", color: T.ink, border: `1px solid ${T.bg3}`, borderRadius: 8, padding: "7px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer" };
const MAX_W = 600;

// The picture with its paper taken out, as a PNG data URL.
export function clearPaper(img) {
  const k = Math.min(1, MAX_W / img.naturalWidth);
  const w = Math.max(1, Math.round(img.naturalWidth * k)), h = Math.max(1, Math.round(img.naturalHeight * k));
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const g = c.getContext("2d"); g.drawImage(img, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h), p = d.data;
  // The paper's colour: the brightest of the four corners.
  const corner = (x, y) => { const i = (y * w + x) * 4; return [p[i], p[i + 1], p[i + 2]]; };
  const paper = [corner(0, 0), corner(w - 1, 0), corner(0, h - 1), corner(w - 1, h - 1)].sort((a, b) => (b[0] + b[1] + b[2]) - (a[0] + a[1] + a[2]))[0];
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const dist = Math.abs(p[i] - paper[0]) + Math.abs(p[i + 1] - paper[1]) + Math.abs(p[i + 2] - paper[2]);
    if (p[i + 3] < 20 || dist < 60) { p[i + 3] = 0; continue; }
    if (dist < 120) p[i + 3] = Math.round(p[i + 3] * (dist - 60) / 60);   // a soft edge, not a jagged one
    if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  if (maxX < 0) return null;
  g.putImageData(d, 0, 0);
  const pad = 4, cw = Math.min(w, maxX - minX + 1 + pad * 2), ch = Math.min(h, maxY - minY + 1 + pad * 2);
  const out = document.createElement("canvas"); out.width = cw; out.height = ch;
  out.getContext("2d").drawImage(c, Math.max(0, minX - pad), Math.max(0, minY - pad), cw, ch, 0, 0, cw, ch);
  return out.toDataURL("image/png");
}

export default function SignatureField({ scope = "mine", isReadOnly = false, signerName = "" }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  useEffect(() => { apiFetch("/letters/signatures").then(setData).catch(() => setData({ org: {}, mine: {} })); }, []);
  const mine = scope === "mine";
  const current = data ? (mine ? data.mine.image : data.org.image) : null;
  const name = mine ? (data && data.mine.name) : (signerName || (data && data.org.signerName));
  const save = async image => {
    setBusy(true); setMsg("");
    try {
      await apiFetch(`/letters/signatures/${mine ? "mine" : "org"}`, { method: "PUT", body: JSON.stringify({ image }) });
      setData(d => ({ ...d, [mine ? "mine" : "org"]: { ...(d ? d[mine ? "mine" : "org"] : {}), image } }));
      setMsg(image ? "Saved. Letters print it above the name, in its own color." : "Removed.");
    } catch (e) { setMsg(errorMessage(e, "The signature could not be saved.")); }
    setBusy(false);
  };
  const choose = f => {
    if (!f) return;
    if (!/^image\/(png|jpeg)$/.test(f.type)) { setMsg("Choose a PNG or JPEG picture of the signature."); return; }
    const url = URL.createObjectURL(f);
    const img = new Image();
    img.onload = () => { const out = clearPaper(img); URL.revokeObjectURL(url); if (!out) setMsg("No ink was found in that picture. Try a photo on plain white paper."); else save(out); };
    img.onerror = () => { URL.revokeObjectURL(url); setMsg("That picture could not be read."); };
    img.src = url;
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }} data-testid={`signature-${scope}`}>
      <p style={{ fontSize: 13, color: T.ink3, margin: 0, lineHeight: 1.5 }}>
        {mine ? "Your signature prints above your name on the letters you print when no receipt signer is set." : "The receipt signer's signature prints above their name on every printed letter."}
      </p>
      {data && data.rule && <p style={{ fontSize: 13, color: T.ink3, margin: 0, lineHeight: 1.5 }} data-testid={`signature-${scope}-rule`}>{data.rule}</p>}
      {/* A corner of a letter, the way it prints. */}
      <div style={{ background: T.white, border: `1px solid ${T.bg2}`, borderRadius: 6, padding: "14px 18px", maxWidth: 360, fontFamily: "Georgia, serif", fontSize: 13, color: T.ink }}>
        <div>With gratitude,</div>
        <div style={{ height: 54, display: "flex", alignItems: "flex-end" }}>
          {current ? <img src={current} alt="Signature" style={{ maxHeight: 50, maxWidth: 170 }} data-testid={`signature-${scope}-image`} /> : <span style={{ fontSize: 12, color: T.ink3, fontFamily: "inherit" }}>No signature picture yet</span>}
        </div>
        <div>{name || "Your name"}</div>
      </div>
      {!isReadOnly && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <label style={{ ...quiet, display: "inline-flex" }}>
            {busy ? "Saving…" : current ? "Upload a new picture" : "Upload a picture of the signature"}
            <input type="file" accept="image/png,image/jpeg" onChange={e => choose(e.target.files && e.target.files[0])} style={{ display: "none" }} data-testid={`signature-${scope}-file`} />
          </label>
          {current && <button type="button" style={quiet} onClick={() => save(null)} disabled={busy}>Remove</button>}
        </div>)}
      {msg && <div role="status" style={{ fontSize: 13, color: T.ink }}>{msg}</div>}
    </div>
  );
}
