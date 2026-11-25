// email-builder/StyleSettings.jsx · BUILDER-1. THE STYLE TAB.
//
// How the selected block sits in the email: alignment, width (images also
// height, the shape kept), padding as one value or each side, space above and
// below, a thin border in a brand colour with rounded corners, the ground
// (white, cream or the brand band), and hidden on phones or on desktop.
// Only what shared/emailBlockStyle.js STYLE_CAPS says this type's render
// draws is offered, so nothing here is something an inbox can't show.
import { useEffect, useState } from "react";
import { T } from "../shared";
import { capsOf, LIMITS, EMAIL_INNER } from "../../../../shared/emailBlockStyle.js";
import { Sec, Row, Slider, Segmented, Switch, Swatches, paneBtn, paneNote, paneInput } from "./controls";
import { ALIGN_OPTIONS } from "./BlockSettings";

const SIDES = ["Top", "Right", "Bottom", "Left"];
// The type's own padding when it sets none (renderEmail's defaults), so the
// slider starts where the email already is.
const PAD_DEFAULT = { richtext: [12, 32, 4, 32], image: [12, 32, 12, 32], photos2: [12, 32, 12, 32], stats: [16, 32, 16, 32], quote: [16, 32, 16, 32],
  button: [12, 32, 20, 32], event: [12, 32, 12, 32], givingpage: [12, 32, 12, 32], giftsummary: [12, 32, 12, 32], signature: [8, 32, 24, 32] };

// The photo's own shape, read once, so a height typed keeps it.
function useRatio(src) {
  const [ratio, setRatio] = useState(null);
  useEffect(() => {
    if (!src) { setRatio(null); return; }
    const im = new Image();
    im.onload = () => setRatio(im.naturalWidth && im.naturalHeight ? im.naturalHeight / im.naturalWidth : null);
    im.src = src;
  }, [src]);
  return ratio;
}

export function StyleSettings({ b, setStyle, brand = {} }) {
  const caps = new Set(capsOf(b.type));
  const st = b.style || {};
  const [separate, setSeparate] = useState(() => !!(st.pad && new Set(st.pad).size > 1));
  const ratio = useRatio(b.type === "image" ? b.image : null);
  if (b.locked) return <Sec><div style={paneNote}>The tax lines are drawn the same on every receipt, so their style can't change.</div></Sec>;
  if (!caps.size) return <Sec><div style={paneNote}>This part of the email is drawn the same on every email, so it has no style to set.</div></Sec>;
  const pad = st.pad || PAD_DEFAULT[b.type] || [16, 32, 16, 32];
  const width = st.width || EMAIL_INNER;
  const bgOpts = [{ id: "white", hex: T.white, label: "White" }, { id: "cream", hex: T.bg, label: "Cream" }, brand.band && { id: "band", hex: brand.band, label: "Your brand band" }].filter(Boolean);
  const borderOpts = [{ id: "hair", hex: T.bg2, label: "Light gray" }, brand.band && { id: "band", hex: brand.band, label: "Your main color" }, brand.accent && { id: "accent", hex: brand.accent, label: "Your accent color" }].filter(Boolean);
  return (
    <div data-testid="block-style">
      {caps.has("align") && (
        <Sec title="Alignment"><Segmented options={ALIGN_OPTIONS} value={st.align || (b.type === "button" ? "center" : "left")} label="Alignment" testid="style-align"
          onChange={v => setStyle({ align: v })} /></Sec>)}
      {caps.has("width") && (
        <Sec title="Size" right={st.width ? <button type="button" style={{ ...paneBtn, padding: "2px 8px", fontSize: 11.5 }} onClick={() => setStyle({ width: undefined })}>Full width</button> : null}>
          <Row label="Width"><Slider value={width} min={LIMITS.width[0]} max={LIMITS.width[1]} label="Width" testid="style-width" onChange={v => setStyle({ width: v == null || v >= EMAIL_INNER ? undefined : v })} /></Row>
          {b.type === "image" && ratio && (
            <Row label="Height"><Slider value={Math.round(width * ratio)} min={Math.max(20, Math.round(LIMITS.width[0] * ratio))} max={Math.round(EMAIL_INNER * ratio)} label="Height" testid="style-height"
              onChange={h => { const w = h == null ? null : Math.round(h / ratio); setStyle({ width: w == null || w >= EMAIL_INNER ? undefined : Math.max(LIMITS.width[0], w) }); }} /></Row>)}
          {b.type === "image" && <div style={{ ...paneNote, marginTop: 4 }}>The photo keeps its shape: change either and the other follows.</div>}
        </Sec>)}
      {caps.has("pad") && (
        <Sec title="Padding" right={<label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12, color: T.ink }}>Separate sides <Switch on={separate} label="Separate sides" testid="style-pad-separate" onChange={setSeparate} /></label>}>
          {separate
            ? <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {SIDES.map((s, k) => (
                  <label key={s} style={{ fontSize: 12, color: T.ink3 }}>{s}
                    <input type="number" min={LIMITS.pad[0]} max={LIMITS.pad[1]} value={pad[k]} data-testid={"style-pad-" + s.toLowerCase()} style={{ ...paneInput, marginTop: 3 }}
                      onChange={e => { const n = Math.min(LIMITS.pad[1], Math.max(0, Number(e.target.value) || 0)); const p = [...pad]; p[k] = n; setStyle({ pad: p }, "pad" + k); }} />
                  </label>))}
              </div>
            : <Row label="All sides"><Slider value={Math.max(...pad)} min={LIMITS.pad[0]} max={LIMITS.pad[1]} label="Padding" testid="style-pad" onChange={v => setStyle({ pad: v == null ? undefined : [v, v, v, v] })} /></Row>}
          {st.pad && <button type="button" style={{ ...paneBtn, marginTop: 8, padding: "3px 10px", fontSize: 12 }} onClick={() => setStyle({ pad: undefined })}>Back to the usual</button>}
        </Sec>)}
      {(caps.has("mt") || caps.has("mb")) && (
        <Sec title="Margin">
          <Row label="Above"><Slider value={st.mt || 0} min={LIMITS.margin[0]} max={LIMITS.margin[1]} label="Space above" testid="style-mt" onChange={v => setStyle({ mt: v || undefined })} /></Row>
          <Row label="Below"><Slider value={st.mb || 0} min={LIMITS.margin[0]} max={LIMITS.margin[1]} label="Space below" testid="style-mb" onChange={v => setStyle({ mb: v || undefined })} /></Row>
        </Sec>)}
      {caps.has("border") && (
        <Sec title="Border">
          <Row label="Line"><Segmented options={[{ id: "none", label: "None" }, { id: "thin", label: "Thin" }]} value={st.border || "none"} label="Border" testid="style-border"
            onChange={v => setStyle(v === "thin" ? { border: "thin", borderColor: st.borderColor || "hair" } : { border: undefined, borderColor: undefined })} /></Row>
          {st.border && <Row label="Color"><Swatches options={borderOpts} value={st.borderColor || "hair"} label="Border color" testid="style-border-color" onChange={v => setStyle({ borderColor: v })} /></Row>}
          <Row label="Rounded corners"><Slider value={st.radius || 0} min={LIMITS.radius[0]} max={LIMITS.radius[1]} label="Rounded corners" testid="style-radius" onChange={v => setStyle({ radius: v || undefined })} /></Row>
        </Sec>)}
      {caps.has("bg") && (
        <Sec title="Background"><Swatches options={bgOpts} value={st.bg || "white"} label="Background" testid="style-bg" onChange={v => setStyle({ bg: v === "white" ? undefined : v })} />
          {st.bg === "band" && <div style={{ ...paneNote, marginTop: 6 }}>Words on the band take its own text color.</div>}</Sec>)}
      {caps.has("hide") && (
        <Sec title="Show on">
          <Segmented options={[{ id: "all", label: "Everywhere" }, { id: "desktop", label: "Phones only", title: "Hidden on desktop" }, { id: "phone", label: "Desktop only", title: "Hidden on phones" }]}
            value={st.hide || "all"} label="Where it shows" testid="style-hide" full onChange={v => setStyle({ hide: v === "all" ? undefined : v })} />
          {st.hide && <div style={{ ...paneNote, marginTop: 6 }}>{st.hide === "phone" ? "Hidden on phones." : "Hidden on desktop. Some desktop inboxes ignore this and show it anyway."} The editor still shows it, dimmed, so you can find it.</div>}
        </Sec>)}
      {b.style && <Sec><button type="button" style={paneBtn} data-testid="style-reset" onClick={() => setStyle({ align: undefined, width: undefined, pad: undefined, mt: undefined, mb: undefined, border: undefined, borderColor: undefined, radius: undefined, bg: undefined, hide: undefined }, "reset")}>Reset the style</button></Sec>}
    </div>
  );
}
