// email-builder/MoreSettings.jsx · BUILDER-2B items 2 and 5. THE EDIT TAB FOR COLUMNS, BOX, SOCIAL AND CODE.
//
// The blocks BUILDER-2A built underneath (shared/emailMoreBlocks.js), wired
// into BUILDER-1's right pane. Words in a column or a box are typed in the
// email itself, like any text; these settings are the rest. Every change goes
// through set(), which the validator checks first (useEmailBuilder.setBlock).
import { useEffect, useState } from "react";
import { apiFetch } from "../../api";
import { T } from "../shared";
import { SOCIAL_NETWORKS, SOCIAL_SIZES, MAX_COLUMN_ITEMS } from "../../../../shared/emailMoreBlocks.js";
import { Sec, Row, Segmented, Switch, Slider, paneInput, paneBtn, paneNote } from "./controls";
import { PhotoChoice } from "./BlockSettings";

const ITEM_NEW = { text: () => ({ type: "text", heading: "", text: "Write something in your own words." }), image: () => ({ type: "image", image: null, alt: "" }),
  button: () => ({ type: "button", action: "readmore", label: "Read more", url: "" }) };
const ITEM_NAME = { text: "Text", image: "Photo", button: "Button" };
const BOX_NEW = { richtext: () => ({ type: "richtext", blocks: [{ type: "p", text: "Write something in your own words." }] }), image: () => ({ type: "image", image: null, alt: "", caption: "" }),
  button: () => ({ type: "button", action: "give", label: "Give today", url: "" }), divider: () => ({ type: "divider" }), columns: () => ({ type: "columns", count: 2, stack: true, gap: 16, valign: "top",
    columns: [{ items: [ITEM_NEW.text()] }, { items: [ITEM_NEW.text()] }] }) };
const BOX_NAME = { richtext: "Text", image: "Image", button: "Button", divider: "Divider", columns: "Columns", quote: "Quote", stats: "Stats", signature: "Signature", social: "Social", code: "Code", giftsummary: "Gift summary", video: "Video", hero: "Hero", photos2: "Two photos", event: "Event", givingpage: "Giving page" };
const swap = (list, i, j) => { const n = [...list]; [n[i], n[j]] = [n[j], n[i]]; return n; };

function ColumnsSettings({ b, set, pick }) {
  const cols = (b.columns || []).slice(0, b.count === 3 ? 3 : 2);
  const setCols = (next, tag) => set({ columns: next }, tag);
  const setItem = (c, k, patch, tag) => setCols(cols.map((col, ci) => ci !== c ? col : { items: col.items.map((it, ki) => (ki === k ? { ...it, ...patch } : it)) }), tag);
  const count = n => {
    const next = cols.slice(0, n);
    while (next.length < n) next.push({ items: [ITEM_NEW.text()] });
    set({ count: n, columns: next });
  };
  return <>
    <Sec title="Columns" testid="block-columns">
      <Row label="How many"><Segmented options={[{ id: 2, label: "2" }, { id: 3, label: "3" }]} value={b.count === 3 ? 3 : 2} label="How many columns" testid="block-columns-count" onChange={count} /></Row>
      <Row label="Stack on phones"><Switch on={b.stack !== false} label="Stack on phones" testid="block-columns-stack" onChange={on => set({ stack: on })} /></Row>
      <Row label="Gap"><Slider value={b.gap == null ? 16 : b.gap} min={0} max={40} label="Gap between columns" testid="block-columns-gap" onChange={v => set({ gap: v == null ? 16 : v }, "gap")} /></Row>
      <Row label="Line up"><Segmented options={[{ id: "top", label: "Top" }, { id: "middle", label: "Middle" }, { id: "bottom", label: "Bottom" }]} value={b.valign || "top"} label="Vertical alignment" testid="block-columns-valign" onChange={v => set({ valign: v })} /></Row>
      <div style={{ ...paneNote, marginTop: 6 }}>On a phone each column becomes a row, left to right, unless stacking is off.</div>
    </Sec>
    {cols.map((col, c) => (
      <Sec key={c} title={`Column ${c + 1}`} testid={"block-column-" + (c + 1)}>
        {(col.items || []).map((it, k) => (
          <div key={k} style={{ borderLeft: "2px solid " + T.bg2, paddingLeft: 8, marginBottom: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
              <span style={{ flex: 1, fontSize: 12.5, fontWeight: 700, color: T.ink }}>{ITEM_NAME[it.type]}</span>
              {k > 0 && <button type="button" style={{ ...paneBtn, padding: "1px 7px" }} aria-label="Move up" onClick={() => setCols(cols.map((x, ci) => ci !== c ? x : { items: swap(x.items, k, k - 1) }))}>↑</button>}
              <button type="button" style={{ ...paneBtn, padding: "1px 7px" }} aria-label={`Remove this ${ITEM_NAME[it.type].toLowerCase()}`} onClick={() => setCols(cols.map((x, ci) => ci !== c ? x : { items: x.items.filter((_, ki) => ki !== k) }))}>✕</button>
            </div>
            {it.type === "text" && <div style={paneNote}>Type its heading and words in the email.</div>}
            {it.type === "image" && <>
              <PhotoChoice value={it.image} alt={it.alt} pick={pick} onChange={({ src, alt }) => setItem(c, k, { image: src, alt }, `img${c}${k}`)} />
              <input style={{ ...paneInput, marginTop: 6 }} value={it.alt || ""} placeholder="Words for screen readers (required)" aria-label="Words for screen readers"
                onChange={e => setItem(c, k, { alt: e.target.value }, `alt${c}${k}`)} />
              <input style={{ ...paneInput, marginTop: 6 }} value={it.href || ""} placeholder="Link it (optional): https://" aria-label="Where the photo goes"
                onChange={e => setItem(c, k, { href: e.target.value || undefined }, `href${c}${k}`)} />
            </>}
            {it.type === "button" && <>
              <input style={paneInput} value={it.label || ""} aria-label="Button words" onChange={e => setItem(c, k, { label: e.target.value }, `lbl${c}${k}`)} />
              <input style={{ ...paneInput, marginTop: 6 }} value={it.url || ""} placeholder="https:// (required)" aria-label="Where the button goes" onChange={e => setItem(c, k, { url: e.target.value }, `url${c}${k}`)} />
            </>}
          </div>
        ))}
        {(col.items || []).length < MAX_COLUMN_ITEMS && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {Object.keys(ITEM_NEW).map(t => <button key={t} type="button" style={{ ...paneBtn, padding: "3px 9px", fontSize: 12 }} data-testid={`column-${c + 1}-add-${t}`}
              onClick={() => setCols(cols.map((x, ci) => ci !== c ? x : { items: [...(x.items || []), ITEM_NEW[t]()] }))}>+ {ITEM_NAME[t]}</button>)}
          </div>)}
      </Sec>
    ))}
  </>;
}

function BoxSettings({ b, set }) {
  const kids = b.children || [];
  const setKids = next => set({ children: next });
  return <Sec title="Inside the box" testid="block-box">
    {kids.length === 0 && <div style={paneNote}>Nothing inside yet.</div>}
    {kids.map((c, k) => (
      <div key={k} style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 0", fontSize: 13, color: T.ink }}>
        <span style={{ flex: 1 }}>{BOX_NAME[c.type] || c.type}</span>
        {k > 0 && <button type="button" style={{ ...paneBtn, padding: "1px 7px" }} aria-label="Move up" onClick={() => setKids(swap(kids, k, k - 1))}>↑</button>}
        {k < kids.length - 1 && <button type="button" style={{ ...paneBtn, padding: "1px 7px" }} aria-label="Move down" onClick={() => setKids(swap(kids, k, k + 1))}>↓</button>}
        <button type="button" style={{ ...paneBtn, padding: "1px 7px" }} aria-label={`Remove the ${(BOX_NAME[c.type] || c.type).toLowerCase()}`} onClick={() => setKids(kids.filter((_, j) => j !== k))}>✕</button>
      </div>
    ))}
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
      {Object.keys(BOX_NEW).map(t => <button key={t} type="button" style={{ ...paneBtn, padding: "3px 9px", fontSize: 12 }} data-testid={"box-add-" + t} onClick={() => setKids([...kids, BOX_NEW[t]()])}>+ {BOX_NAME[t]}</button>)}
    </div>
    <div style={{ ...paneNote, marginTop: 8 }}>Type the words inside it in the email. Its ground, border, corners and padding are in Style. A box can't hold another box.</div>
  </Sec>;
}

function SocialSettings({ b, set, onOpenBrand }) {
  const [links, setLinks] = useState(null);
  useEffect(() => { apiFetch("/portal-settings").then(r => setLinks((r && r.social_links) || {})).catch(() => setLinks({})); }, []);
  const have = SOCIAL_NETWORKS.filter(n => links && links[n.key]);
  const on = k => !Array.isArray(b.networks) || b.networks.includes(k);
  const toggle = k => { const cur = Array.isArray(b.networks) ? b.networks : have.map(n => n.key); set({ networks: cur.includes(k) ? cur.filter(x => x !== k) : [...cur, k] }); };
  return <>
    <Sec title="Social" testid="block-social">
      {links == null ? <div style={paneNote}>Reading your links…</div>
        : have.length === 0
          ? <div style={paneNote} data-testid="block-social-none">No social links in Brand yet. Add them there and they show here, in every email that has this block.</div>
          : have.map(n => <Row key={n.key} label={n.key === "website" ? "Website" : n.label}><Switch on={on(n.key)} label={`Show ${n.label}`} testid={"block-social-" + n.key} onChange={() => toggle(n.key)} /></Row>)}
      {onOpenBrand && <button type="button" style={{ ...paneBtn, marginTop: 8 }} onClick={onOpenBrand}>{have.length ? "Change links in Brand" : "Add links in Brand"}</button>}
    </Sec>
    <Sec>
      <Row label="Size"><Segmented options={SOCIAL_SIZES.map(s => ({ id: s, label: { 24: "Small", 32: "Medium", 40: "Large" }[s] }))} value={b.size || 32} label="Icon size" testid="block-social-size" onChange={v => set({ size: v })} /></Row>
      <Row label="Icons"><Segmented options={[{ id: "dark", label: "Dark" }, { id: "light", label: "Light" }]} value={b.color === "light" ? "light" : "dark"} label="Icon color" testid="block-social-color" onChange={v => set({ color: v })} /></Row>
      <div style={{ ...paneNote, marginTop: 4 }}>Light icons suit a block on your brand band (Style, Background). Each icon carries words for screen readers, like "{"Your organization"} on Instagram".</div>
    </Sec>
  </>;
}

function CodeSettings({ b, set, role }) {
  if (role !== "admin") return <Sec title="Code"><div style={paneNote}>Only an admin can change a code block. You can move it or remove it.</div></Sec>;
  return <Sec title="Your HTML" testid="block-code">
    <textarea style={{ ...paneInput, minHeight: 180, fontFamily: "ui-monospace,Menlo,monospace", fontSize: 12, resize: "vertical" }} value={b.html || ""} data-testid="block-code-html"
      aria-label="Your HTML" spellCheck={false} onChange={e => set({ html: e.target.value }, "html")} />
    <div style={{ ...paneNote, marginTop: 6 }}>Tables, inline styles, links, photos with words for screen readers, and plain text tags. Anything else is taken out and listed under Checks, and the email won't send until the code needs nothing taken out.</div>
  </Sec>;
}

export function MoreSettings({ b, set, pick, onOpenBrand, role }) {
  switch (b.type) {
    case "columns": return <ColumnsSettings b={b} set={set} pick={pick} />;
    case "box": return <BoxSettings b={b} set={set} />;
    case "social": return <SocialSettings b={b} set={set} onOpenBrand={onOpenBrand} />;
    case "code": return <CodeSettings b={b} set={set} role={role} />;
    default: return null;
  }
}
