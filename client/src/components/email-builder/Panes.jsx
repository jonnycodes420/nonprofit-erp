// email-builder/Panes.jsx · BUILDER-1. THE LEFT PANE AND THE RIGHT PANE.
//
// Left:  Elements (a tile for every block an email may hold), Blocks (saved
//        sections: BUILDER-2), Fields (every personal field with what it
//        holds for the person previewed).
// Right: the whole email, small, then the selected block's Edit and Style,
//        or, with nothing selected, the email's own settings.
import { T } from "../shared";
import { PaneTabs, Sec, paneNote, paneLabel } from "./controls";
import { Thumbnail } from "./Thumbnail";
import { BlockSettings } from "./BlockSettings";
import { StyleSettings } from "./StyleSettings";
import { DRAG_TYPE } from "./frameDnD";
import { BlocksTab } from "./BlocksTab";   // BUILDER-2B
import { SaveAsBlock } from "./SaveAsBlock";   // BUILDER-2B

// The tiles, in the order the mockup reads, each named as a person would.
// `list` is the List tile: a text block that starts as a list.
const TILE = {
  richtext: { name: "Text", ic: "T" }, image: { name: "Image", ic: "▣" }, button: { name: "Button", ic: "▭" }, divider: { name: "Divider", ic: "―" },
  signature: { name: "Signature", ic: "✎" }, giftsummary: { name: "Gift summary", ic: "$" }, event: { name: "Event", ic: "◷" }, givingpage: { name: "Giving page", ic: "♡" },
  video: { name: "Video", ic: "▶" }, stats: { name: "Stats", ic: "#" }, quote: { name: "Quote", ic: "❝" }, list: { name: "List", ic: "☰" },
  hero: { name: "Hero", ic: "▤" }, photos2: { name: "Two photos", ic: "▥" }, header: { name: "Logo", ic: "◎" },
  // BUILDER-2B: the full builder's blocks (shared/emailMoreBlocks.js).
  columns: { name: "Columns", ic: "▥" }, box: { name: "Box", ic: "▢" }, social: { name: "Social", ic: "◍" }, code: { name: "Code", ic: "</>" },
};
const ORDER = ["richtext", "image", "button", "divider", "columns", "signature", "giftsummary", "social", "box", "event", "givingpage", "video", "stats", "quote", "list", "hero", "photos2", "header", "code"];
// BUILDER-2B: the tiles a person may add, in that order, for both the
// Elements tab and the floating "+": [{ k, def, name, list }].
export function tilesFor(blockTypes, role) {
  const defs = Object.fromEntries(blockTypes.filter(t => !t.roles || t.roles.includes(role)).map(t => [t.key, t]));
  return ORDER.filter(k => k === "list" ? !!defs.richtext : !!defs[k]).map(k => ({ k, def: k === "list" ? defs.richtext : defs[k], name: TILE[k].name, ic: TILE[k].ic, list: k === "list" }));
}
// "Their last gift" reads "Last gift" in a list of fields.
export const fieldName = label => { const s = String(label || "").replace(/^Their /, ""); return s.charAt(0).toUpperCase() + s.slice(1); };
export const blockName = (type, labels = {}) => (TILE[type] ? TILE[type].name : labels[type] || type);
// Each pane keeps its top (tabs, the thumbnail) in place and scrolls the rest.
const SCROLL = { flex: 1, minHeight: 0, overflowY: "auto", overscrollBehavior: "contain", paddingBottom: 40 };
export { DRAG_TYPE };   // BUILDER-2B: the frame (frameDnD.js) drops what this carries

// BUILDER-2B: role is the signed-in person's; a block the registry keeps for
// some roles (Code: admins) is offered only to them. onUseBlock(payload) adds
// a saved or ready-made block; blocksRefresh reloads the Blocks tab.
export function LeftPane({ tab, onTab, blockTypes, onAdd, fields, fieldInfo, asName, onField, readOnly, role = null, onUseBlock, blocksRefresh = 0, say }) {
  const tiles = tilesFor(blockTypes, role);
  const info = Object.fromEntries((fieldInfo || []).map(f => [f.key, f]));
  const who = asName ? String(asName).split(/\s+/)[0] : "this person";
  return (
    <>
      <PaneTabs testid="builder-left-tabs" on={tab} onPick={onTab} tabs={[{ id: "elements", label: "Elements" }, { id: "blocks", label: "Blocks" }, { id: "fields", label: "Fields" }]} />
      <div style={SCROLL}>
      {tab === "elements" && (
        <div data-testid="builder-elements" style={{ padding: 14 }}>
          <div style={{ ...paneNote, marginBottom: 10 }}>Click one to add it under the selected part of the email.</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 9 }}>
            {tiles.map(({ k, def }) => {
              return (
                <button key={k} type="button" draggable={!readOnly} disabled={readOnly} data-testid={"element-" + k} data-block-type={def.key} title={def.hint}
                  onDragStart={e => { try { e.dataTransfer.setData(DRAG_TYPE, JSON.stringify({ type: def.key, list: k === "list" })); e.dataTransfer.effectAllowed = "copy"; } catch { /* older browser */ } }}
                  onClick={() => onAdd(def, { list: k === "list" })}
                  style={{ border: "1px solid " + T.bg2, borderRadius: 10, padding: "13px 4px 9px", textAlign: "center", fontSize: 11, fontWeight: 700, letterSpacing: ".04em",
                    textTransform: "uppercase", background: T.white, color: T.ink, cursor: readOnly ? "not-allowed" : "grab", fontFamily: "inherit" }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = T.green; e.currentTarget.style.color = T.green; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = T.bg2; e.currentTarget.style.color = T.ink; }}>
                  <span aria-hidden="true" style={{ display: "block", fontSize: 19, fontWeight: 400, textTransform: "none", marginBottom: 5, letterSpacing: 0 }}>{TILE[k].ic}</span>{TILE[k].name}
                </button>
              );
            })}
          </div>
        </div>
      )}
      {tab === "blocks" && <BlocksTab onUse={onUseBlock} readOnly={readOnly} refresh={blocksRefresh} say={say} />}
      {tab === "fields" && (
        <div data-testid="builder-fields" style={{ padding: 14 }}>
          <div style={{ ...paneNote, marginBottom: 8 }}>Click one to add it where you were typing, or at the end of the selected text. Each shows what it holds for {who}.</div>
          {fields.map(f => {
            const key = f.token.replace(/[{}\s]/g, "");
            const i = info[key];
            const val = i ? String(i.value || "").trim() : null;
            return (
              <button key={f.token} type="button" disabled={readOnly} data-testid={"field-" + key} onMouseDown={e => e.preventDefault()} onClick={() => onField(f)}
                style={{ display: "flex", justifyContent: "space-between", gap: 8, width: "100%", border: "1px dashed " + T.green, color: T.green, borderRadius: 8, padding: "7px 10px",
                  margin: "0 0 6px", fontSize: 13, fontWeight: 600, cursor: readOnly ? "not-allowed" : "pointer", background: T.white, fontFamily: "inherit", textAlign: "left" }}>
                <span>{fieldName(f.label)}</span>
                <span data-testid={"field-value-" + key} style={{ fontWeight: 400, color: T.ink3, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 120 }}>
                  {i == null ? "…" : val ? val : i.fallback ? `empty, reads “${i.fallback}”` : `empty for ${who}`}
                </span>
              </button>
            );
          })}
          <div style={{ ...paneLabel, marginTop: 14 }}>Something else?</div>
          <div style={{ ...paneNote, marginTop: 4 }}>Steward fills only these. Anything else typed in {"{{ }}"} is listed under Checks and never sent as brackets.</div>
        </div>
      )}
      </div>
    </>
  );
}

// sel: the selected block or null. tab: "edit" | "style". emailSettings: the
// email's own settings, shown when nothing is selected.
export function RightPane({ html, selectedIndex, frameRef, sel, tab, onTab, labels, settingsProps, emailSettings, readOnly }) {
  return (
    <>
      <Thumbnail html={html} selected={selectedIndex} frameRef={frameRef} />
      <div style={SCROLL} key={sel ? "b" + sel._k : "email"}>
      {sel ? (
        <div data-testid="rail-block" data-block-type={sel.type} style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
          <div style={{ padding: "11px 16px 0", fontSize: 13, fontWeight: 700, color: T.ink }}>{sel.locked ? "Tax lines" : blockName(sel.type, labels)}</div>
          <PaneTabs testid="builder-right-tabs" on={tab} onPick={onTab} tabs={[{ id: "edit", label: "Edit" }, { id: "style", label: "Style" }]} />
          <fieldset disabled={readOnly} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
            {tab === "edit" ? <BlockSettings b={sel} {...settingsProps} /> : <StyleSettings b={sel} setStyle={settingsProps.setStyle} brand={settingsProps.brand} />}
          </fieldset>
          {!readOnly && settingsProps.saveBlock && !sel.locked && sel.type !== "header" && sel.type !== "footer" && (
            <SaveAsBlock key={sel._k} {...settingsProps.saveBlock} defaultName={blockName(sel.type, labels)} />)}
        </div>
      ) : (
        <div data-testid="builder-email-settings">
          <div style={{ padding: "11px 16px 2px", fontSize: 13, fontWeight: 700, color: T.ink }}>This email</div>
          <div style={{ padding: "0 16px 6px", ...paneNote }}>Click any part of the email to change it.</div>
          {emailSettings}
        </div>
      )}
      </div>
    </>
  );
}

// The email's background (kept on its footer block, shared/emailBlockStyle.js).
export function PageBackground({ value, brand, onChange, disabled }) {
  const opts = [{ id: "cream", hex: T.bg, label: "Cream" }, { id: "white", hex: T.white, label: "White" }, brand && brand.band && { id: "band", hex: brand.band, label: "Your brand band" }].filter(Boolean);
  return (
    <Sec title="Background" testid="email-background">
      <fieldset disabled={disabled} style={{ border: 0, margin: 0, padding: 0 }}>
        <div style={{ display: "flex", gap: 7 }}>
          {opts.map(o => (
            <button key={o.id} type="button" role="radio" aria-checked={(value || "cream") === o.id} aria-label={o.label} title={o.label} data-testid={"email-background-" + o.id} onClick={() => onChange(o.id)}
              style={{ width: 24, height: 24, borderRadius: "50%", background: o.hex, cursor: "pointer", padding: 0, border: "2px solid " + T.white, boxShadow: `0 0 0 ${(value || "cream") === o.id ? 2 : 1}px ${(value || "cream") === o.id ? T.green : T.bg3}` }} />
          ))}
        </div>
      </fieldset>
      <div style={{ ...paneNote, marginTop: 6 }}>Behind the email, around its white page.</div>
    </Sec>
  );
}
