// BrandPanel.jsx · EMAIL-1. THE ORG'S ONE BRAND, EDITED IN PLACE.
//
// The logo, the colours and the type pairing live once, on portal_settings,
// and are read at render time by the giving pages, the portal and every email.
// This panel edits them through the EXISTING PUT /portal-settings (partial
// fields only), so there is one write path and one place the colours are
// checked for readability (normalizeAccent on the server). Every save offers
// Undo, which sends the previous values back through the same route; the
// previous logo goes back by its stored path.
// Props: { onChanged(settings) }
import { useState, useEffect } from "react";
import { apiFetch } from "../api";
import { T } from "./shared";
import { offerUndo } from "./EditHistory";
import { errorMessage } from "../lib/domainError";
import { resolveAssetUrl } from "../lib/assetUrl";
import { TYPE_PAIRINGS } from "../lib/portalTheme";
import Uploader, { IMAGE_ACCEPT, IMAGE_ACCEPT_LABEL } from "./Uploader";

const LOGO_MAX_BYTES = 15 * 1024 * 1024;
const COLOR_FIELDS = [
  ["primary_color", "primaryColor", "Main colour", "The band across the top of your pages and emails."],
  ["accent_color", "accentColor", "Accent colour", "Small touches: rules and highlights."],
  ["button_color", "buttonColor", "Button colour", "Left empty, buttons use your main colour."],
];
const inp = { boxSizing: "border-box", border: "1px solid " + T.bg3, borderRadius: 8, padding: "8px 10px", fontSize: 13, color: T.ink, background: T.white, fontFamily: "inherit" };
const lbl = { fontSize: 11, fontWeight: 700, color: T.ink3, textTransform: "uppercase", letterSpacing: "0.06em", margin: "14px 0 4px" };
const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const put = body => apiFetch("/portal-settings", { method: "PUT", body: JSON.stringify(body) });

// The body for PUT /portal-settings from snake_case values. The logo is sent
// as a data URI (a new upload), a /portal-assets path (put a previous one
// back) or "" (no logo).
function bodyFor(vals) {
  const b = {};
  for (const [col, key] of COLOR_FIELDS) if (col in vals) b[key] = vals[col] || "";
  if ("type_pairing" in vals) b.typePairing = vals.type_pairing || "";
  if ("logo" in vals) b.logoData = vals.logo || "";
  return b;
}

export default function BrandPanel({ onChanged }) {
  const [ps, setPs] = useState(null);
  const [draft, setDraft] = useState({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    apiFetch("/portal-settings").then(setPs).catch(e => setErr(errorMessage(e, "Your brand could not be loaded.")));
  }, []);

  if (!ps) return <div style={{ fontSize: 13, color: err ? T.ink : T.ink3 }}>{err || "Loading…"}</div>;

  const val = col => (col in draft ? draft[col] : (ps[col] || ""));
  const set = (col, v) => setDraft(d => ({ ...d, [col]: v }));
  const changed = Object.keys(draft).filter(k => (k === "logo" ? draft.logo !== (ps.logo_url || "") : (draft[k] || "") !== (ps[k] || "")));
  const badColor = COLOR_FIELDS.some(([col]) => col in draft && draft[col] && !HEX_RE.test(draft[col]));

  const apply = async (vals, previous, message) => {
    const r = await put(bodyFor(vals));
    setPs(r); setDraft({});
    setNote(r.adjusted && r.message ? r.message : "");
    onChanged && onChanged(r);
    if (previous) {
      offerUndo({ message, undoAction: async () => {
        const back = await put(bodyFor(previous));
        setPs(back); setDraft({}); setNote("");
        onChanged && onChanged(back);
        return back;
      } }, "brand");
    }
    return r;
  };

  const save = async () => {
    if (!changed.length || badColor) return;
    setBusy(true); setErr("");
    const vals = {}, previous = {};
    for (const k of changed) {
      vals[k] = draft[k];
      previous[k] = k === "logo" ? (ps.logo_url || "") : (ps[k] || "");
    }
    try { await apply(vals, previous, "Saved your brand. Your giving pages and emails use it now."); }
    catch (e) { setErr(errorMessage(e, "Your brand could not be saved.")); }
    setBusy(false);
  };

  const logoSrc = "logo" in draft ? (draft.logo ? resolveAssetUrl(draft.logo) : null) : resolveAssetUrl(ps.logo_url);
  const primary = val("primary_color") || T.greenDk;

  return (
    <div data-testid="brand-panel" style={{ background: T.white, border: "1px solid " + T.bg2, borderRadius: 12, padding: "16px 18px", maxWidth: 560 }}>
      <div style={{ fontFamily: "'DM Serif Display',Georgia,serif", fontSize: 20, color: T.ink }}>Your brand</div>
      <div style={{ fontSize: 13, color: T.ink, marginTop: 4, lineHeight: 1.5 }}>Your giving pages and your emails use this brand.</div>

      <div style={lbl}>Logo</div>
      <Uploader accept={IMAGE_ACCEPT} acceptLabel={IMAGE_ACCEPT_LABEL} maxBytes={LOGO_MAX_BYTES} compact shape="square"
        hint="PNG, JPEG, GIF, WebP or SVG. A PNG with a clear background looks best on your colour."
        preview={logoSrc || null} label={logoSrc ? "Replace logo" : "Drag your logo here, or browse"}
        onFile={({ dataUrl }) => set("logo", dataUrl)}
        onRemove={() => set("logo", "")} />

      {COLOR_FIELDS.map(([col, , label, hint]) => (
        <div key={col}>
          <div style={lbl}>{label}</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <input type="color" aria-label={label + " picker"} value={HEX_RE.test(val(col)) ? val(col) : (col === "button_color" ? primary : T.greenDk)}
              onChange={e => set(col, e.target.value)}
              style={{ width: 40, height: 38, border: "1px solid " + T.bg3, borderRadius: 8, background: T.white, padding: 2, cursor: "pointer" }} />
            <input style={{ ...inp, width: 120, fontFamily: "monospace" }} value={val(col)} aria-label={label}
              placeholder={col === "button_color" ? "main colour" : "#rrggbb"} onChange={e => set(col, e.target.value.trim())} />
            {col === "button_color" && val(col) && (
              <button type="button" onClick={() => set(col, "")} style={{ background: "none", border: "none", color: T.ink3, fontSize: 12, cursor: "pointer", textDecoration: "underline", minHeight: 38 }}>Use the main colour</button>
            )}
          </div>
          <div style={{ fontSize: 11.5, color: T.ink3, marginTop: 3, lineHeight: 1.4 }}>{hint}</div>
        </div>
      ))}

      <div style={lbl}>Type</div>
      <select style={{ ...inp, width: "100%", maxWidth: 340 }} value={val("type_pairing") || "dm"} aria-label="Type pairing"
        onChange={e => set("type_pairing", e.target.value)}>
        {Object.entries(TYPE_PAIRINGS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
      </select>

      {badColor && <div role="alert" style={{ fontSize: 12.5, color: T.ink, marginTop: 10 }}>A colour is written as # followed by six letters or numbers.</div>}
      {note && <div style={{ fontSize: 12.5, color: T.ink, marginTop: 10, lineHeight: 1.5 }}>{note}</div>}
      {err && <div role="alert" style={{ fontSize: 12.5, color: T.ink, marginTop: 10, lineHeight: 1.5 }}>{err}</div>}
      <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
        <button type="button" disabled={busy || !changed.length || badColor} onClick={save}
          style={{ background: T.greenDk, color: T.white, border: "none", borderRadius: 8, padding: "8px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer", minHeight: 38, fontFamily: "inherit", opacity: busy || !changed.length || badColor ? 0.55 : 1 }}>
          {busy ? "Saving…" : "Save brand"}
        </button>
        {changed.length > 0 && !busy && (
          <button type="button" onClick={() => { setDraft({}); setErr(""); }}
            style={{ background: T.white, color: T.ink, border: "1px solid " + T.ink, borderRadius: 8, padding: "7px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer", minHeight: 38, fontFamily: "inherit" }}>
            Discard changes
          </button>
        )}
      </div>
    </div>
  );
}
