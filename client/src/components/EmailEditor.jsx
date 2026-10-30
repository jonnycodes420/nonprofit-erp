// EmailEditor.jsx · EDITOR-1. EVERY EMAIL, IN THE ONE EDITOR.
//
// A one-person email (a thank-you, a receipt, the year-end statement, a
// welcome, Update your card), a designed email, a campaign starter and a
// campaign's own email all open in StewardEditor, the giving page editor's
// shell. The preview is where the email is written:
//
//   · The server draws the email exactly as it sends it (shared/emailBlocks.js),
//     with `editable` on: every typed field of a block is marked, and every
//     personal field is a chip filled with the person it is previewed as.
//   · The words are typed in that preview. A chip is kept as its field, so
//     "Dear {{first_name}}" never becomes "Dear Margaret" in the template.
//   · A block shows its handles when the pointer is on it: move up, move down,
//     duplicate, remove, and a "+" under it to add one there. A photo is
//     clicked to replace it. A receipt's tax lines are one locked block.
//   · "Preview as" switches the person to any real person of the org;
//     "+ Field" puts a chip where the caret is.
//
// The preview frame runs no script of its own (sandbox without allow-scripts);
// the editor wires it from outside, as POLISH-3 already did for its clicks.
// Nothing here sends to a donor: "Send me a test" goes to the person pressing it.
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { apiFetch } from "../api";
import { usePeoplePicker } from "../lib/people";
import { T, Spin } from "./shared";
import { offerUndo } from "./EditHistory";
import { askConfirm } from "./ConfirmDialog";
import { errorMessage } from "../lib/domainError";
import MediaPicker from "./MediaPicker";
import StewardEditor, { RailSection, DeviceFrame, useNarrow, railLabel, railInput, railQuietBtn, railNote, stockPhotoForBlock } from "./StewardEditor";
import StockPhotoPicker from "./StockPhotoPicker";

const say = (e, fallback) => (e && e.sentence) || errorMessage(e, fallback);
const BUTTON_ACTIONS = [
  { id: "give", label: "Give" }, { id: "rsvp", label: "RSVP" },
  { id: "volunteer", label: "Volunteer" }, { id: "readmore", label: "Read more" },
];
// FIX-56: the printed thank-yous that are also the thank-you task's email.
export const EMAILED_LETTERS = new Set(["thanks_first", "thanks_renewal", "thanks_major", "thanks_memorial"]);
const KIND_BADGE = { receipt: "Receipt", year_end: "Year-end statement", thanks_monthly: "Welcome", volunteer_thanks: "Thank-you" };
export function emailBadge(template) {
  if (!template) return "Email";
  if (template.personKind) return KIND_BADGE[template.personKind] || (/^thanks_/.test(template.personKind) ? "Thank-you" : /^volunteer_/.test(template.personKind) ? "Volunteer email" : "One-person email");
  if (/^campaign_/.test(template.starterKey || "")) return "Campaign starter";
  return "Email template";
}
const PROBLEM_BOX = { background: T.gold50, border: "1px solid " + T.gold300, borderRadius: 8, padding: "10px 12px", fontSize: 12.5, color: T.ink, lineHeight: 1.5 };

// The frame's own look while editing: chips, the dashed line on a field, the
// handles. Drawn with Steward's tokens; the email inside stays the org's.
const FRAME_CSS = `
[data-st-edit]{outline:none;border-radius:3px;cursor:text;transition:box-shadow .12s;min-width:12px;display:inline-block}
[data-st-rich]{display:block}
[data-st-edit]:hover{box-shadow:0 0 0 1px ${T.green500}}
[data-st-edit]:focus{box-shadow:0 0 0 2px ${T.green}}
[data-st-edit]:empty:before{content:attr(data-ph);color:${T.ink3};opacity:.75}
tr[data-st-block]{cursor:pointer}
tr.st-sel>td{box-shadow:inset 3px 0 0 ${T.gold}}
img{cursor:pointer}
.st-chip{cursor:default}
.st-bar{position:absolute;z-index:20;display:none;gap:4px;font-family:'DM Sans',Helvetica,Arial,sans-serif}
.st-bar button,.st-bar span{background:${T.ink};color:${T.inkInverse};border:none;border-radius:6px;height:22px;min-width:24px;font-size:11px;font-weight:700;cursor:pointer;padding:0 7px;line-height:22px}
.st-bar span{cursor:default}
.st-add{position:absolute;z-index:20;display:none;width:26px;height:26px;border-radius:50%;border:none;background:${T.green};color:${T.white};font-size:17px;line-height:26px;cursor:pointer;padding:0}
`;

// ── Reading the words back out of the preview ─────────────────────────────
// A chip is its field, a line break is "\n", anything else is its text.
function inlineText(node) {
  let out = "";
  node.childNodes.forEach(n => {
    if (n.nodeType === 3) out += n.nodeValue;
    else if (n.nodeType === 1) {
      const tok = n.getAttribute && n.getAttribute("data-st-token");
      if (tok) out += `{{${tok}}}`;
      else if (n.tagName === "BR") out += "\n";
      else {
        const t = inlineText(n);
        out += (/^(DIV|P)$/.test(n.tagName) && out && !out.endsWith("\n") ? "\n" : "") + t;
      }
    }
  });
  return out.replace(/ /g, " ").replace(/​/g, "");
}
// A text block is paragraphs, headings and lists; Enter makes the next paragraph.
function richBlocks(el) {
  const out = [];
  el.childNodes.forEach(n => {
    if (n.nodeType === 3) { const t = n.nodeValue.trim(); if (t) out.push({ type: "p", text: t }); return; }
    if (n.nodeType !== 1) return;
    if (/^H[1-6]$/.test(n.tagName)) out.push({ type: "h2", text: inlineText(n).trim() });
    else if (/^(UL|OL)$/.test(n.tagName)) out.push({ type: "ul", items: [...n.querySelectorAll("li")].map(li => inlineText(li).trim()).filter(Boolean) });
    else if (n.getAttribute && n.getAttribute("data-st-token")) out.push({ type: "p", text: `{{${n.getAttribute("data-st-token")}}}` });
    else out.push({ type: "p", text: inlineText(n).replace(/\s+$/, "") });
  });
  const kept = out.filter(b => (b.type === "ul" ? b.items.length : String(b.text || "").trim()));
  return kept.length ? kept : [{ type: "p", text: "" }];
}
// Put a value at "3.items.1.label" in a copy of the blocks.
export function setAtPath(blocks, path, value) {
  const [i, ...rest] = String(path).split(".");
  return blocks.map((b, k) => {
    if (k !== Number(i)) return b;
    const copy = JSON.parse(JSON.stringify(b));
    let o = copy;
    for (let j = 0; j < rest.length - 1; j++) { const key = /^\d+$/.test(rest[j]) ? Number(rest[j]) : rest[j]; if (o[key] == null) o[key] = /^\d+$/.test(rest[j + 1]) ? [] : {}; o = o[key]; }
    const last = rest[rest.length - 1];
    o[/^\d+$/.test(last) ? Number(last) : last] = value;
    return copy;
  });
}
const PLACEHOLDER = { heading: "A heading", sub: "A line under it", caption: "A caption (optional)", label: "Button words", text: "The words", attribution: "Who said it", name: "Your name", title: "Your title", value: "Number" };

// ── THE PREVIEW, AS THE PLACE THE EMAIL IS WRITTEN ─────────────────────────
// html: the server's editable render. on: { commit(path, value), select(i),
// action(act, i), image(i, k), focusChange(bool), caret(range) } read live.
export function EmailFrame({ html, device, selected, on, frameRef, labels = {}, testid = "email-preview-frame" }) {
  const scrollY = useRef(0);
  const live = useRef(on);
  live.current = on;
  const load = () => {
    const f = frameRef.current;
    let doc = null;
    try { doc = f && f.contentDocument; } catch { doc = null; }
    if (!doc || !doc.body) return;
    const st = doc.createElement("style");
    st.textContent = FRAME_CSS;
    doc.head && doc.head.appendChild(st);
    doc.querySelectorAll("[data-st-edit]").forEach(el => {
      const rich = el.hasAttribute("data-st-rich");
      const path = el.getAttribute("data-st-edit");
      el.setAttribute("contenteditable", "true");
      el.setAttribute("spellcheck", "true");
      el.setAttribute("role", "textbox");
      if (!rich) el.setAttribute("data-ph", PLACEHOLDER[path.split(".").pop()] || "Type here");
      const commit = () => live.current.commit(path, rich ? richBlocks(el) : inlineText(el).replace(/\s+$/, ""));
      el.addEventListener("input", commit);
      el.addEventListener("focus", () => live.current.focusChange(true));
      el.addEventListener("blur", () => { commit(); live.current.focusChange(false); });
      el.addEventListener("keydown", e => {
        if (e.key !== "Enter" || rich) return;
        e.preventDefault();
        if (e.shiftKey) doc.execCommand("insertLineBreak"); else el.blur();
      });
      el.addEventListener("paste", e => {
        e.preventDefault();
        const t = (e.clipboardData && e.clipboardData.getData("text/plain")) || "";
        doc.execCommand("insertText", false, t);
      });
    });
    doc.addEventListener("selectionchange", () => {
      const sel = doc.getSelection && doc.getSelection();
      if (!sel || !sel.rangeCount) return;
      const r = sel.getRangeAt(0);
      const host = r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentElement;
      const ed = host && host.closest && host.closest("[data-st-edit]");
      if (ed) live.current.caret({ doc, el: ed, range: r.cloneRange() });
    });
    // The handles: one bar and one "+", moved to the block under the pointer.
    const bar = doc.createElement("div"); bar.className = "st-bar"; bar.setAttribute("data-testid", "email-block-handles");
    const tag = doc.createElement("span"); bar.appendChild(tag);
    const acts = [["up", "↑", "Move up"], ["down", "↓", "Move down"], ["duplicate", "Duplicate", "Duplicate block"], ["remove", "✕", "Remove block"]].map(([act, text, aria]) => {
      const b = doc.createElement("button"); b.type = "button"; b.textContent = text; b.setAttribute("data-act", act); b.setAttribute("aria-label", aria); bar.appendChild(b); return b;
    });
    const add = doc.createElement("button"); add.type = "button"; add.className = "st-add"; add.textContent = "+"; add.setAttribute("aria-label", "Add a block here"); add.setAttribute("data-act", "add");
    doc.body.appendChild(bar); doc.body.appendChild(add);
    let cur = null;
    const place = i => {
      const rows = [...doc.querySelectorAll(`tr[data-st-block="${i}"]`)];
      if (!rows.length) return;
      const rs = rows.map(r => r.getBoundingClientRect());
      const top = Math.min(...rs.map(r => r.top)), bottom = Math.max(...rs.map(r => r.bottom));
      const left = Math.min(...rs.map(r => r.left)), right = Math.max(...rs.map(r => r.right));
      const sy = doc.defaultView ? doc.defaultView.scrollY : 0;
      const locked = rows[0].getAttribute("data-st-locked") === "1";
      const type = rows[0].getAttribute("data-st-type") || "";
      tag.textContent = locked ? "Tax lines · required" : (labels[type] || type);
      acts.forEach(b => { b.style.display = locked && b.getAttribute("data-act") !== "up" && b.getAttribute("data-act") !== "down" ? "none" : ""; });
      bar.style.display = "flex"; add.style.display = "block";
      bar.style.top = Math.max(0, top + sy - 11) + "px";
      bar.style.left = Math.max(4, right - bar.offsetWidth - 8) + "px";
      add.style.top = (bottom + sy - 13) + "px";
      add.style.left = (left + (right - left) / 2 - 13) + "px";
    };
    doc.addEventListener("mouseover", e => {
      const tr = e.target && e.target.closest && e.target.closest("tr[data-st-block]");
      if (tr) { cur = Number(tr.getAttribute("data-st-block")); place(cur); }
    });
    const act = e => {
      const b = e.target.closest && e.target.closest("button[data-act]");
      if (!b || cur == null) return;
      e.preventDefault(); e.stopPropagation();
      live.current.action(b.getAttribute("data-act"), cur);
    };
    bar.addEventListener("click", act);
    add.addEventListener("click", act);
    doc.addEventListener("click", e => {
      const a = e.target.closest && e.target.closest("a");
      if (a) e.preventDefault();
      if (e.target.closest && e.target.closest(".st-bar,.st-add")) return;
      const tr = e.target.closest && e.target.closest("tr[data-st-block]");
      if (!tr) return;
      const i = Number(tr.getAttribute("data-st-block"));
      const img = e.target.closest("img");
      if (img && !e.target.closest("[data-st-edit]")) {
        const imgs = [...doc.querySelectorAll(`tr[data-st-block="${i}"] img`)];
        live.current.image(i, Math.max(0, imgs.indexOf(img)));
        return;
      }
      live.current.select(i);
    });
    if (selected != null) doc.querySelectorAll(`tr[data-st-block="${selected}"]`).forEach(r => r.classList.add("st-sel"));
    if (doc.defaultView && scrollY.current) doc.defaultView.scrollTo(0, scrollY.current);
  };
  // Keep the reader's place across a redraw.
  useEffect(() => {
    const f = frameRef.current;
    let w = null;
    try { w = f && f.contentWindow; } catch { w = null; }
    if (w) scrollY.current = w.scrollY || 0;
  }, [html, frameRef]);
  // The picked block, marked without a redraw.
  useEffect(() => {
    let doc = null;
    try { doc = frameRef.current && frameRef.current.contentDocument; } catch { doc = null; }
    if (!doc) return;
    doc.querySelectorAll("tr.st-sel").forEach(r => r.classList.remove("st-sel"));
    if (selected != null) doc.querySelectorAll(`tr[data-st-block="${selected}"]`).forEach(r => r.classList.add("st-sel"));
  }, [selected, frameRef]);
  return (
    <iframe ref={frameRef} title="The email" data-testid={testid} sandbox="allow-same-origin" srcDoc={html} onLoad={load}
      style={{ display: "block", margin: "0 auto", width: device === "phone" ? "100%" : 640, maxWidth: "100%", height: "100%", minHeight: 520, border: 0, background: T.white, flex: 1 }} />
  );
}

// Insert a field where the caret was: a chip in the preview, or the token in
// the subject or preview line if one of those was the last place typed in.
export function insertChip(caret, token, label) {
  if (!caret || !caret.doc || !caret.el || !caret.el.isConnected) return false;
  const { doc, el, range } = caret;
  const chip = doc.createElement("span");
  chip.className = "st-chip"; chip.setAttribute("data-st-token", token); chip.setAttribute("contenteditable", "false");
  chip.setAttribute("style", `background:${T.green100};color:${T.green};border-radius:4px;padding:0 3px;`);
  chip.textContent = label;
  try {
    range.deleteContents();
    range.insertNode(chip);
    const after = doc.createTextNode(" ");
    chip.after(after);
  } catch { return false; }
  el.dispatchEvent(new doc.defaultView.Event("input"));
  return true;
}

// ── PREVIEW AS ─────────────────────────────────────────────────────────────
export function PreviewAs({ as, onPick }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [people, loading] = usePeoplePicker(q, { match: "name", limit: 8, emptyToo: true });
  return (
    <div style={{ position: "relative" }}>
      <button type="button" data-testid="preview-as" onClick={() => setOpen(o => !o)} aria-expanded={open}
        style={{ ...railQuietBtn, padding: "5px 10px" }}>Preview as {as && as.name ? as.name.split(/\s+/)[0] : "you"} {"▾"}</button>
      {open && (
        <div data-testid="preview-as-menu" style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 30, width: 280, background: T.white, border: "1px solid " + T.bg3, borderRadius: 10, boxShadow: "0 10px 30px rgba(0,0,0,.15)", padding: 8 }}>
          <input autoFocus style={railInput} placeholder="Find one of your people" value={q} onChange={e => setQ(e.target.value)} aria-label="Find a person to preview as" />
          <div style={{ maxHeight: 260, overflowY: "auto", marginTop: 6 }}>
            {loading && <div style={{ padding: 6 }}><Spin /></div>}
            {people.map(p => (
              <button key={p.id} type="button" data-testid="preview-as-person" onClick={() => { onPick(p); setOpen(false); setQ(""); }}
                style={{ display: "block", width: "100%", textAlign: "left", background: "none", border: "none", borderTop: "1px solid " + T.bg2, padding: "7px 8px", cursor: "pointer", fontFamily: "inherit", fontSize: 13, color: T.ink }}>{p.name}</button>
            ))}
            {!loading && !people.length && <div style={{ ...railNote, padding: 6 }}>Nobody by that name.</div>}
          </div>
          <button type="button" onClick={() => { onPick(null); setOpen(false); }} style={{ ...railQuietBtn, marginTop: 6, width: "100%" }}>Preview as yourself</button>
        </div>
      )}
    </div>
  );
}

export function FieldMenu({ fields, onInsert }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: "relative" }}>
      <button type="button" data-testid="field-menu" onMouseDown={e => e.preventDefault()} onClick={() => setOpen(o => !o)} aria-expanded={open}
        style={{ ...railQuietBtn, padding: "5px 10px" }}>+ Field {"▾"}</button>
      {open && (
        <div data-testid="field-menu-list" style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 30, width: 230, maxHeight: 300, overflowY: "auto", background: T.white, border: "1px solid " + T.bg3, borderRadius: 10, boxShadow: "0 10px 30px rgba(0,0,0,.15)", padding: 6 }}>
          {fields.map(f => (
            <button key={f.token} type="button" data-testid={"field-" + f.token.replace(/[{}]/g, "")} onMouseDown={e => e.preventDefault()}
              onClick={() => { onInsert(f); setOpen(false); }}
              style={{ display: "block", width: "100%", textAlign: "left", background: "none", border: "none", padding: "7px 8px", cursor: "pointer", fontFamily: "inherit", fontSize: 13, color: T.ink, borderRadius: 6 }}>{f.label}</button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── ONE BLOCK'S SETTINGS (the words are typed in the preview) ──────────────
function PhotoChoice({ value, alt, onChange, pick, what = "photo" }) {
  return (
    <div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, color: value ? T.ink : T.ink3, flex: "1 1 0", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{value ? "A photo is chosen" : `No ${what} chosen yet`}</span>
        <button type="button" style={railQuietBtn} onClick={() => pick("photo", item => onChange({ src: item.url, alt: alt || item.alt || "" }))}>{value ? "Replace" : "Choose a photo"}</button>
        {value && <button type="button" style={railQuietBtn} onClick={() => onChange({ src: null, alt })}>Remove</button>}
      </div>
      <label style={railLabel}>Describe the photo (required in email)</label>
      <input style={{ ...railInput, borderColor: value && !String(alt || "").trim() ? T.gold : T.bg3 }} value={alt || ""} onChange={e => onChange({ src: value, alt: e.target.value })} />
    </div>
  );
}
export function EmailBlockSettings({ b, set, pick, events, pages }) {
  const typed = <div style={railNote}>Type its words in the preview.</div>;
  switch (b.type) {
    case "header": return <div style={railNote}>Your logo and name, from Brand.</div>;
    case "footer": return <div style={railNote}>Your legal name, mailing address and an unsubscribe link. Always included.</div>;
    case "hero": return <>{typed}<label style={railLabel}>Photo</label><PhotoChoice value={b.image} alt={b.alt} pick={pick} onChange={({ src, alt }) => set({ image: src, alt })} /></>;
    case "richtext": return b.locked
      ? <div style={railNote} data-testid="email-locked-block">Your tax lines, from your brand kit. This email must carry them, so this block can't be removed or changed.</div>
      : <div style={railNote}>Type in the preview. Enter starts a new paragraph.</div>;
    case "image": return <>{typed}<PhotoChoice value={b.image} alt={b.alt} pick={pick} onChange={({ src, alt }) => set({ image: src, alt })} /></>;
    case "photos2": return <>{[0, 1].map(k => {
      const im = (b.images || [])[k] || { src: null, alt: "" };
      return <div key={k} style={{ marginTop: k ? 12 : 0 }}><div style={{ fontSize: 12, fontWeight: 700 }}>Photo {k + 1}</div>
        <PhotoChoice value={im.src} alt={im.alt} pick={pick} onChange={v => { const ims = [...(b.images || [{ src: null, alt: "" }, { src: null, alt: "" }])]; ims[k] = v; set({ images: ims }); }} /></div>;
    })}</>;
    case "stats": return <>
      <div style={railNote}>Your own figures only. Type each number and what it counts in the preview.</div>
      <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
        {(b.items || []).length < 3 && <button type="button" style={railQuietBtn} onClick={() => set({ items: [...(b.items || []), { value: "", label: "" }] })}>Add a stat</button>}
        {(b.items || []).length > 1 && <button type="button" style={railQuietBtn} onClick={() => set({ items: (b.items || []).slice(0, -1) })}>Remove the last</button>}
      </div></>;
    case "quote": return typed;
    case "video": return <>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, color: b.videoId ? T.ink : T.ink3, flex: 1 }}>{b.videoId ? `${b.provider === "vimeo" ? "Vimeo" : "YouTube"} video ${b.videoId}` : "No video chosen yet"}</span>
        <button type="button" style={railQuietBtn} onClick={() => pick("video", item => set({ provider: item.provider, videoId: item.videoId, thumbUrl: item.thumbUrl || undefined, caption: b.caption || item.title || "" }))}>Choose from media</button>
      </div>
      <VideoLink onParsed={ref => set(ref)} />
      <div style={{ ...railNote, marginTop: 6 }}>Inboxes cannot play video, so the email shows its picture with a play button that opens it on your own video page. Type the caption in the preview.</div></>;
    case "button": return <>
      {typed}
      <label style={railLabel}>What it does</label>
      <select style={railInput} value={b.action || "give"} onChange={e => set({ action: e.target.value })}>
        {BUTTON_ACTIONS.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}
      </select>
      <label style={railLabel}>Link {b.action === "give" || !b.action ? "(empty: your giving page)" : "(https://...)"}</label>
      <input style={railInput} value={b.url || ""} onChange={e => set({ url: e.target.value })} /></>;
    case "event": return <>
      <label style={railLabel}>Which event</label>
      <select style={railInput} value={b.eventId || ""} onChange={e => set({ eventId: e.target.value })}>
        <option value="">Choose one of your events…</option>
        {events.map(ev => <option key={ev.id} value={ev.id}>{ev.name}{ev.date ? ` · ${String(ev.date).slice(0, 10)}` : ""}</option>)}
      </select></>;
    case "givingpage": return <>
      <label style={railLabel}>Which giving page</label>
      <select style={railInput} value={b.givingPageId || ""} onChange={e => set({ givingPageId: e.target.value })}>
        <option value="">Choose one of your giving pages…</option>
        {pages.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
      </select></>;
    case "divider": return <div style={railNote}>A thin line between two parts of the email.</div>;
    case "giftsummary": return <div style={railNote}>Each person's own gift: its amount, date and fund, filled when it goes. Somebody with no gift sees nothing here. Type its heading in the preview.</div>;
    case "signature": return <>{typed}<label style={railLabel}>Photo (optional)</label>
      <PhotoChoice value={b.photo} alt={b.name} pick={pick} onChange={({ src }) => set({ photo: src })} /></>;
    default: return null;
  }
}
function VideoLink({ onParsed }) {
  const [v, setV] = useState("");
  const [bad, setBad] = useState(false);
  const parse = () => {
    const s = v.trim();
    let m = /^https?:\/\/(?:www\.|m\.)?youtube\.com\/watch\?(?:[^#]*&)?v=([A-Za-z0-9_-]{6,20})/.exec(s)
      || /^https?:\/\/youtu\.be\/([A-Za-z0-9_-]{6,20})/.exec(s)
      || /^https?:\/\/(?:www\.)?youtube(?:-nocookie)?\.com\/(?:embed|shorts)\/([A-Za-z0-9_-]{6,20})/.exec(s);
    if (m) { onParsed({ provider: "youtube", videoId: m[1], thumbUrl: undefined }); setV(""); setBad(false); return; }
    m = /^https?:\/\/(?:www\.)?vimeo\.com\/(\d{6,12})/.exec(s);
    if (m) { onParsed({ provider: "vimeo", videoId: m[1] }); setV(""); setBad(false); return; }
    setBad(true);
  };
  return (
    <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
      <input style={{ ...railInput, borderColor: bad ? T.gold : T.bg3 }} placeholder="or paste a YouTube or Vimeo link" value={v} onChange={e => { setV(e.target.value); setBad(false); }} />
      <button type="button" style={railQuietBtn} disabled={!v.trim()} onClick={parse}>Use</button>
    </div>
  );
}

// ── THE BLOCKS, AS A LIST THE FRAME AND THE RAIL BOTH CHANGE ───────────────
let keySeq = 0;
export const withKeys = blocks => (blocks || []).map(b => ({ ...b, _k: `k${++keySeq}` }));
export const stripKeys = blocks => blocks.map(b => { const c = { ...b }; delete c._k; return c; });
export function useBlockList(initial) {
  const [blocks, setBlocks] = useState(() => withKeys(initial));
  const act = useCallback(async (what, i, blockTypes, after) => {
    if (what === "up" || what === "down") setBlocks(bs => { const n = [...bs]; const j = i + (what === "up" ? -1 : 1); if (j < 0 || j >= n.length) return bs; [n[i], n[j]] = [n[j], n[i]]; return n; });
    if (what === "remove") setBlocks(bs => bs.filter((b, j) => j !== i || b.locked || b.type === "footer"));
    if (what === "duplicate") setBlocks(bs => { const b = bs[i]; if (!b || b.locked) return bs; const n = [...bs]; n.splice(i + 1, 0, { ...JSON.parse(JSON.stringify(b)), _k: `k${++keySeq}` }); return n; });
    if (what === "insert") {
      const def = blockTypes.find(b => b.key === after.type);
      if (!def) return;
      const fresh = { type: after.type, ...JSON.parse(JSON.stringify(def.defaults || {})), _k: `k${++keySeq}` };
      if (["hero", "image"].includes(after.type)) { const p = await stockPhotoForBlock(); if (p) { fresh.image = p.src; fresh.alt = p.alt; } }
      if (after.type === "photos2") { const p = await stockPhotoForBlock(); if (p) fresh.images = [{ src: p.src, alt: p.alt }, { src: p.src, alt: p.alt }]; }
      setBlocks(bs => {
        const at = i == null ? (bs.findIndex(b => b.type === "footer") >= 0 ? bs.findIndex(b => b.type === "footer") : bs.length) : Math.min(i + 1, bs.findIndex(b => b.type === "footer") >= 0 ? bs.findIndex(b => b.type === "footer") : bs.length);
        const n = [...bs]; n.splice(at, 0, fresh); return n;
      });
    }
  }, []);
  return [blocks, setBlocks, act];
}

export function BlockMenu({ blockTypes, onPick, onClose }) {
  return (
    <div data-testid="email-block-menu" style={{ position: "absolute", top: 48, left: "50%", transform: "translateX(-50%)", zIndex: 40, width: 280, maxHeight: 360, overflowY: "auto",
      background: T.white, border: "1px solid " + T.bg3, borderRadius: 10, boxShadow: "0 10px 30px rgba(0,0,0,.18)", padding: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "2px 4px 6px" }}>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: T.ink }}>Add a block</span>
        <button type="button" onClick={onClose} aria-label="Close" style={{ background: "none", border: "none", cursor: "pointer", color: T.ink3 }}>{"✕"}</button>
      </div>
      {blockTypes.filter(t => t.key !== "footer").map(t => (
        <button key={t.key} type="button" data-testid={"email-add-" + t.key} onClick={() => onPick(t.key)}
          style={{ display: "block", width: "100%", textAlign: "left", background: T.white, border: "1px solid " + T.bg2, borderRadius: 8, padding: "7px 10px", marginBottom: 4, cursor: "pointer", fontFamily: "inherit" }}>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: T.ink }}>{t.label}</span>
          <span style={{ display: "block", fontSize: 11.5, color: T.ink3 }}>{t.hint}</span>
        </button>
      ))}
    </div>
  );
}

export function BrandSummary({ onOpenBrand }) {
  const [ps, setPs] = useState(null);
  useEffect(() => { apiFetch("/portal-settings").then(setPs).catch(() => setPs({})); }, []);
  const sw = c => c ? <span title={c} style={{ display: "inline-block", width: 22, height: 22, borderRadius: 6, background: c, border: "1px solid " + T.bg3 }} /> : null;
  return (
    <div data-testid="email-brand">
      <div style={railNote}>Your logo, colors and type come from Brand, so every email and page look like yours. A change there reaches every email at once.</div>
      {ps && <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 8 }}>{sw(ps.primary_color)}{sw(ps.accent_color)}{sw(ps.button_color)}
        {(ps.logo_url || ps.logo_data) && <span style={{ fontSize: 12, color: T.ink3, marginLeft: 4 }}>Logo set</span>}</div>}
      {onOpenBrand && <button type="button" style={{ ...railQuietBtn, marginTop: 8 }} onClick={onOpenBrand}>Open Brand</button>}
    </div>
  );
}

// ── A TEMPLATE IN THE EDITOR ────────────────────────────────────────────────
// FIX-39 · A TEMPLATE IN USE CHANGES IN TWO STEPS. The editor opens on the
// waiting draft when there is one; Save keeps changes as that draft when a live
// journey reads the template (the server decides, and says what it would
// change), and Publish is what makes them the template.
const withDraft = t => (t && t.draft ? { ...t, ...t.draft } : t);
export function EmailEditor({ template, isReadOnly, blockTypes, mergeFields, onOpenDrafts, onOpenCampaigns, onOpenBrand, onQuickPrint, onBack, onSaved, backLabel = "Back to templates", title = null }) {
  const start0 = withDraft(template);
  const narrow = useNarrow();
  const [name, setName] = useState(start0.name);
  const [subject, setSubject] = useState(start0.subject || "");
  const [preheader, setPreheader] = useState(start0.preheader || "");
  const [blocks, setBlocks, act] = useBlockList(start0.blocks);
  const [saved, setSaved] = useState(start0);
  const [hasDraft, setHasDraft] = useState(!!template.hasDraft);
  const [draftBy, setDraftBy] = useState(template.draftByName || "");
  const [usage, setUsage] = useState(null);
  const [publishing, setPublishing] = useState(false);
  const [device, setDevice] = useState(narrow ? "phone" : "desktop");
  const [dark, setDark] = useState(false);
  const [as, setAs] = useState(null);
  const [preview, setPreview] = useState({ html: "", problems: [], loading: true, as: null, subject: "" });
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [picker, setPicker] = useState(null);
  const [ai, setAi] = useState(null);
  const [aiAsk, setAiAsk] = useState("");
  const [events, setEvents] = useState([]);
  const [pages, setPages] = useState([]);
  const [selected, setSelected] = useState(null);
  const [menuAt, setMenuAt] = useState(undefined);   // undefined closed · null at the end · i after block i
  const [historyOpen, setHistoryOpen] = useState(false);
  const [focusAsk, setFocusAsk] = useState({ id: "", n: 0 });
  const [rev, setRev] = useState(0);
  const frameRef = useRef(null);
  const caret = useRef(null);
  const lastInput = useRef(null);    // "subject" | "preheader" | "frame"
  const typing = useRef(false);
  const stale = useRef(false);
  const latest = useRef({ blocks, subject, preheader });
  latest.current = { blocks, subject, preheader };
  const labels = useMemo(() => Object.fromEntries(blockTypes.map(t => [t.key, t.label])), [blockTypes]);
  const ask = id => setFocusAsk(f => ({ id, n: f.n + 1 }));

  useEffect(() => { apiFetch(`/email-templates/${template.id}/usage`).then(setUsage).catch(() => setUsage(null)); }, [template.id]);
  useEffect(() => {
    apiFetch("/events").then(r => setEvents(Array.isArray(r) ? r : [])).catch(() => setEvents([]));
    apiFetch("/giving-pages").then(r => setPages(Array.isArray(r) ? r : [])).catch(() => setPages([]));
  }, []);

  const dirty = name !== saved.name || subject !== (saved.subject || "") || preheader !== (saved.preheader || "")
    || JSON.stringify(stripKeys(blocks)) !== JSON.stringify(saved.blocks || []);

  // The preview is the server's render of what is on screen. While she types
  // in it, it is not drawn again (that would take her caret away); it is
  // drawn when she leaves the words, or when anything else changes.
  const redraw = useCallback(() => {
    if (typing.current) { stale.current = true; return; }
    setRev(r => r + 1);
  }, []);
  useEffect(() => { redraw(); }, [blocks.length, device, dark, as, redraw]);
  const seq = useRef(0);
  useEffect(() => {
    const n = ++seq.current;
    const t = setTimeout(() => {
      const cur = latest.current;
      apiFetch(`/email-templates/${template.id}/preview`, { method: "POST",
        body: JSON.stringify({ blocks: stripKeys(cur.blocks), subject: cur.subject, preheader: cur.preheader, device, dark, editable: !isReadOnly, as: as ? as.id : undefined }) })
        .then(r => { if (n === seq.current) setPreview({ html: r.html, problems: r.problems || [], loading: false, as: r.as, subject: r.subject || "" }); })
        .catch(e => { if (n === seq.current) setPreview(p => ({ ...p, loading: false, problems: [say(e, "The preview could not be drawn.")] })); });
    }, 300);
    return () => clearTimeout(t);
  }, [rev, template.id]);   // eslint-disable-line react-hooks/exhaustive-deps

  const setBlock = (i, patch) => { setBlocks(bs => bs.map((b, j) => (j === i ? { ...b, ...patch } : b))); redraw(); };
  const on = {
    commit: (path, value) => { lastInput.current = "frame"; setBlocks(bs => setAtPath(bs, path, value)); },
    focusChange: f => { typing.current = f; if (!f) setTimeout(() => { if (!typing.current && stale.current !== null) { stale.current = false; setRev(r => r + 1); } }, 120); },
    caret: c => { caret.current = c; lastInput.current = "frame"; },
    select: i => { setSelected(i); ask("block"); },
    action: (what, i) => {
      if (what === "add") { setMenuAt(i); return; }
      act(what, i).then(redraw);
      if (what === "remove" && selected === i) setSelected(null);
    },
    image: (i, k) => {
      setSelected(i);
      const b = latest.current.blocks[i];
      if (!b) return;
      setPicker({ kind: "photo", onPick: item => {
        if (b.type === "photos2") { const ims = [...(b.images || [{ src: null, alt: "" }, { src: null, alt: "" }])]; ims[k] = { src: item.url, alt: (ims[k] && ims[k].alt) || item.alt || "" }; setBlock(i, { images: ims }); }
        else if (b.type === "signature") setBlock(i, { photo: item.url });
        else setBlock(i, { image: item.url, alt: b.alt || item.alt || "" });
      } });
    },
  };
  const insertField = f => {
    const tok = f.token;
    if (lastInput.current === "subject" || lastInput.current === "preheader") {
      const setter = lastInput.current === "subject" ? setSubject : setPreheader;
      setter(v => (v ? v.replace(/\s*$/, " ") : "") + tok);
      redraw(); return;
    }
    const label = (f.label || tok).replace(/^Their /, "");
    if (insertChip(caret.current, tok.replace(/[{}]/g, ""), label)) { typing.current = false; setTimeout(() => setRev(r => r + 1), 50); }
    else setNote("Click into the words in the preview first, then pick the field to put there.");
  };

  const save = async () => {
    setSaving(true); setNote("");
    const before = { name: saved.name, subject: saved.subject, preheader: saved.preheader, blocks: saved.blocks };
    try {
      const hadDraft = hasDraft;
      const r = await apiFetch(`/email-templates/${template.id}`, { method: "PUT", body: JSON.stringify({ name, subject, preheader, blocks: stripKeys(blocks) }) });
      const now = withDraft(r.template);
      setSaved(now); setBlocks(withKeys(now.blocks));
      setHasDraft(!!r.template.hasDraft); setDraftBy(r.template.draftByName || "");
      if (r.usage) setUsage(r.usage);
      offerUndo({ message: r.draft ? "Saved as a draft. Nothing that uses this template has changed." : "Saved the template.", undoAction: async () => {
        const x = r.draft && !hadDraft
          ? await apiFetch(`/email-templates/${template.id}/discard-draft`, { method: "POST", body: "{}" })
          : await apiFetch(`/email-templates/${template.id}`, { method: "PUT", body: JSON.stringify(before) });
        const back = withDraft(x.template);
        setSaved(back); setName(back.name); setSubject(back.subject || ""); setPreheader(back.preheader || ""); setBlocks(withKeys(back.blocks));
        setHasDraft(!!x.template.hasDraft); redraw();
        onSaved && onSaved();
        return x;
      } }, "template");
      onSaved && onSaved();
      redraw();
    } catch (e) { setNote(say(e, "It could not be saved.")); }
    setSaving(false);
  };
  const publish = async () => {
    if (dirty) { setNote("Save first, so what you publish is what you see."); return; }
    const what = usage && usage.live ? usage.sentence.split(". Saving")[0] + "." : "Nothing live uses this template.";
    if (!(await askConfirm({ title: "Publish these changes?", body: `${what} Publishing changes the template they read from now on. Emails already sent stay as they were.`, yes: "Publish" }))) return;
    setPublishing(true); setNote("");
    try {
      const r = await apiFetch(`/email-templates/${template.id}/publish`, { method: "POST", body: "{}" });
      setSaved(r.template); setHasDraft(false); setDraftBy("");
      if (r.usage) setUsage(r.usage);
      setNote("Published. From now on, everything that uses this template reads these words.");
      onSaved && onSaved();
    } catch (e) { setNote(say(e, "It could not be published.")); }
    setPublishing(false);
  };
  const discardDraft = async () => {
    if (!(await askConfirm({ title: "Throw away this draft?", body: "The template goes back to the words that are live now.", yes: "Discard draft" }))) return;
    try {
      const r = await apiFetch(`/email-templates/${template.id}/discard-draft`, { method: "POST", body: "{}" });
      setSaved(r.template); setName(r.template.name); setSubject(r.template.subject || ""); setPreheader(r.template.preheader || ""); setBlocks(withKeys(r.template.blocks));
      setHasDraft(false); setDraftBy(""); setNote("The draft is gone. The live template did not change."); redraw();
      onSaved && onSaved();
    } catch (e) { setNote(say(e, "The draft could not be discarded.")); }
  };
  // FIX-30 · A ONE-PERSON EMAIL is drafted for one person; Undo dismisses it. Nothing is sent.
  const [who, setWho] = useState(null);
  const [whoQ, setWhoQ] = useState("");
  const [people] = usePeoplePicker(whoQ, { match: "name", limit: 8 });
  const draftForPerson = async () => {
    setNote("");
    if (dirty) { setNote("Save first, so the draft holds the words you see."); return; }
    try {
      const r = await apiFetch(`/templates/${template.personKind}/draft`, { method: "POST", body: JSON.stringify({ donorId: who.id }) });
      offerUndo({ message: r.sentence, undoAction: () => apiFetch(`/milestone-drafts/${r.draftId}/dismiss`, { method: "POST", body: "{}" }) }, "draft");
      setNote(r.sentence);
    } catch (e) { setNote(say(e, "The draft could not be made.")); }
  };
  const startCampaign = async () => {
    setNote("");
    if (dirty) { setNote("Save first, so the campaign starts from what you see."); return; }
    try {
      const c = await apiFetch("/campaigns/from-template", { method: "POST", body: JSON.stringify({ templateId: template.id, name: saved.name }) });
      offerUndo({ message: c.sentence || `Started ${c.name} from this template.`, undoAction: () => apiFetch(`/campaigns/${c.id}`, { method: "DELETE" }) }, "campaign");
      setNote(c.sentence || `${c.name} is a draft campaign. Nothing has been sent.`);
    } catch (e) { setNote(say(e, "The campaign could not be started.")); }
  };
  const test = async () => {
    setNote("");
    if (dirty) { setNote("Save first, so the test is the email you see."); return; }
    try {
      const r = await apiFetch(`/email-templates/${template.id}/test`, { method: "POST", body: "{}" });
      setNote(r.sentence || (r.sent ? "The test is on its way to you." : "Nothing was sent."));
    } catch (e) { setNote(say(e, "The test could not be sent.")); }
  };
  const draftAi = async () => {
    if (dirty) { setNote("Save first, so the proposal starts from what you see."); return; }
    setAi({ loading: true, proposals: [], sentence: "", chosen: new Set() });
    try {
      const r = await apiFetch(`/email-templates/${template.id}/draft-ai`, { method: "POST", body: JSON.stringify({ instructions: aiAsk }) });
      const changed = (r.proposals || []).filter(p => p.proposed !== p.current);
      setAi({ loading: false, proposals: changed, sentence: r.sentence, source: r.source, chosen: new Set(changed.map(p => p.id)) });
    } catch (e) { setAi({ loading: false, proposals: [], sentence: say(e, "Drafting could not be reached."), chosen: new Set() }); }
  };
  const applyAi = () => {
    const chosen = ai.proposals.filter(p => ai.chosen.has(p.id));
    setBlocks(bs => {
      const n = bs.map(b => ({ ...b, ...(b.blocks ? { blocks: b.blocks.map(x => ({ ...x })) } : {}) }));
      for (const p of chosen) {
        const [i, field, j] = p.id.split(".");
        const b = n[Number(i)];
        if (!b) continue;
        if (field === "blocks" && b.blocks && b.blocks[Number(j)]) b.blocks[Number(j)].text = p.proposed;
        else if (field !== "blocks") b[field] = p.proposed;
      }
      return n;
    });
    setAi(null); redraw();
    setNote("The proposed words are in the email. Read them, then press Save to keep them.");
  };

  const goBack = async () => { if (!dirty || await askConfirm({ title: "Leave without saving?", body: "Your changes to this email have not been saved.", yes: "Leave" })) onBack(); };
  const problems = preview.problems || [];
  const sel = selected != null ? blocks[selected] : null;
  const at = id => (focusAsk.id === id ? focusAsk.n : 0);
  const fields = mergeFields.map(f => ({ token: f.token, label: f.label }));

  const left = <>
    {sel && (
      <RailSection key={"block-" + sel._k} id="block" testid="rail-block" title={"This block: " + (labels[sel.type] || sel.type)} focus={at("block")}>
        <EmailBlockSettings b={sel} set={patch => setBlock(selected, patch)} events={events} pages={pages} pick={(kind, onPick) => setPicker({ kind, onPick })} />
      </RailSection>
    )}
    <RailSection id="details" title="Details" testid="rail-details">
      <label style={{ ...railLabel, marginTop: 0 }} htmlFor="et-name">Name</label>
      <input id="et-name" style={railInput} value={name} disabled={isReadOnly} onChange={e => setName(e.target.value)} />
      <label style={railLabel} htmlFor="et-subject">Subject <span style={{ float: "right", color: subject.length > 60 ? T.gold700 : T.ink3, textTransform: "none", letterSpacing: 0 }} data-testid="subject-count">{subject.length}/60</span></label>
      <input id="et-subject" data-testid="email-subject" style={railInput} value={subject} disabled={isReadOnly} onFocus={() => { lastInput.current = "subject"; }} onChange={e => setSubject(e.target.value)} onBlur={redraw} />
      <label style={railLabel} htmlFor="et-pre">Preview line</label>
      <input id="et-pre" style={railInput} value={preheader} disabled={isReadOnly} placeholder="Shown after the subject in the inbox" onFocus={() => { lastInput.current = "preheader"; }} onChange={e => setPreheader(e.target.value)} onBlur={redraw} />
      <div style={{ ...railNote, marginTop: 8 }}>Type the email itself in the preview. "+ Field" puts a personal field where the caret is.</div>
    </RailSection>
    <RailSection id="blocks" title="Blocks" defaultOpen={false} hint="Point at a block in the preview for its handles. The + under a block adds one there.">
      <button type="button" style={railQuietBtn} disabled={isReadOnly} onClick={() => setMenuAt(null)}>Add a block at the end</button>
    </RailSection>
    <RailSection id="design" title="Design" defaultOpen={false}><BrandSummary onOpenBrand={onOpenBrand} /></RailSection>
  </>;

  const right = (
    <div style={{ padding: "14px 16px 30px", display: "flex", flexDirection: "column", gap: 14 }}>
      {note && <div style={PROBLEM_BOX} role="status" data-testid="email-note">{note}
        {/Drafts to review/.test(note) && onOpenDrafts && <> <button type="button" style={railQuietBtn} onClick={onOpenDrafts}>Open drafts to review</button></>}
        {/draft campaign|is a draft/.test(note) && !template.personKind && onOpenCampaigns && <> <button type="button" style={railQuietBtn} onClick={onOpenCampaigns}>Open campaigns</button></>}
      </div>}
      <div>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Who it goes to</div>
        <div style={railNote} data-testid="email-who">{template.personKind
          ? "One person at a time, as a draft you read and send. Saving here is what marks it reviewed, and every draft of this kind starts from these words."
          : "Nobody yet. It goes out only in a campaign or a journey step somebody starts, and each send is a person's."}</div>
      </div>
      {usage && (usage.live || usage.sentence) && <div style={railNote} data-testid="template-usage">{usage.sentence}</div>}
      {hasDraft && (
        <div data-testid="template-draft-state" style={railNote}>
          You are editing a draft{draftBy ? ` saved by ${draftBy}` : ""}. What uses this template still reads the published words until you publish.
          <div><button type="button" style={{ ...railQuietBtn, marginTop: 6 }} disabled={isReadOnly} onClick={discardDraft} data-testid="template-discard-draft">Discard draft</button></div>
        </div>
      )}
      <div>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Checked against</div>
        {problems.length
          ? <div style={PROBLEM_BOX} data-testid="email-problems"><div style={{ fontWeight: 700, marginBottom: 4 }}>To fix before this is sent</div>
              <ul style={{ margin: 0, paddingLeft: 18 }}>{problems.map((p, k) => <li key={k}>{p}</li>)}</ul></div>
          : <div style={railNote} data-testid="email-ready">{preview.loading ? "Checking…" : "Every photo has its words, every field is one Steward fills, and nothing is left in brackets."}</div>}
      </div>
      {template.personKind && (
        <div data-testid="email-person-draft">
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Make a draft for someone</div>
          <input style={railInput} aria-label="Find a person" placeholder={who ? who.name : "Find a person by name"} value={whoQ} onChange={e => setWhoQ(e.target.value)} />
          {people.map(p => <button key={p.id} type="button" onClick={() => { setWho(p); setWhoQ(""); }}
            style={{ display: "block", width: "100%", textAlign: "left", background: "none", border: "none", borderTop: "1px solid " + T.bg2, padding: "7px 8px", cursor: "pointer", fontFamily: "inherit", fontSize: 13 }}>{p.name}</button>)}
          <button type="button" style={{ ...railQuietBtn, marginTop: 6 }} disabled={isReadOnly || !who} onClick={draftForPerson} data-testid="email-person-draft-make">{who ? `Make a draft for ${who.name}` : "Make a draft for this person"}</button>
        </div>
      )}
      {!template.personKind && <div><button type="button" style={railQuietBtn} disabled={isReadOnly} onClick={startCampaign} data-testid="email-start-campaign">Start a campaign from this</button></div>}
      <div>
        <button type="button" style={railQuietBtn} disabled={isReadOnly} onClick={draftAi} data-testid="email-draft-ai">Draft with AI</button>
        {ai && (
          <div style={{ marginTop: 8 }} data-testid="ai-proposals">
            <input style={railInput} value={aiAsk} onChange={e => setAiAsk(e.target.value)} placeholder="Warmer, shorter, mention the spring garden..." aria-label="Anything to ask for" />
            {ai.loading ? <div style={{ padding: 8 }}><Spin /></div> : <>
              <p style={railNote}>{ai.sentence}</p>
              {ai.proposals.length === 0 && <p style={railNote}>No words to change.</p>}
              {ai.proposals.map(p => (
                <label key={p.id} style={{ display: "flex", gap: 8, padding: "6px 0", borderTop: "1px solid " + T.bg2, fontSize: 12.5, cursor: "pointer" }}>
                  <input type="checkbox" checked={ai.chosen.has(p.id)} onChange={e => setAi(a => { const c = new Set(a.chosen); if (e.target.checked) c.add(p.id); else c.delete(p.id); return { ...a, chosen: c }; })} />
                  <span><span style={{ display: "block", color: T.ink3, textDecoration: "line-through" }}>{p.current}</span><span style={{ display: "block" }}>{p.proposed}</span></span>
                </label>
              ))}
              <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                <button type="button" style={railQuietBtn} disabled={!ai.chosen.size} onClick={applyAi}>Use the ticked words</button>
                <button type="button" style={railQuietBtn} onClick={() => setAi(null)}>Keep mine</button>
              </div></>}
          </div>
        )}
      </div>
      {historyOpen && <EmailHistory templateId={template.id} onClose={() => setHistoryOpen(false)} />}
    </div>
  );

  return (
    <div data-testid="email-editor" style={{ position: "fixed", top: 52, left: 0, right: 0, bottom: 0, zIndex: 200 }} className="fullscreen-takeover">
      <StewardEditor kind="email" testid="steward-editor"
        back={{ onClick: goBack, label: backLabel }}
        name={title || name} badge={emailBadge(template)}
        device={device} onDevice={setDevice}
        toggles={[{ id: "dark", label: "Dark mode", on: dark, onClick: () => setDark(v => !v) }]}
        status={saving ? "Saving…" : dirty ? "Unsaved changes" : hasDraft ? "Draft saved, not published" : "Saved"}
        actions={[
          { id: "test", label: "Send me a test", onClick: test, disabled: isReadOnly, testid: "email-test" },
          { id: "history", label: "History", active: historyOpen, onClick: () => setHistoryOpen(o => !o), testid: "email-history" },
          onQuickPrint && template.personKind && EMAILED_LETTERS.has(template.personKind) && { id: "print", label: "Quick edit and print", onClick: onQuickPrint, testid: "quick-edit" },
        ]}
        primary={hasDraft && !dirty
          ? { label: publishing ? "Publishing…" : "Publish", onClick: publish, disabled: isReadOnly || publishing, testid: "template-publish" }
          : { label: saving ? "Saving…" : usage && usage.live ? "Save as draft" : "Save", onClick: save, disabled: isReadOnly || saving || !dirty, testid: "email-save" }}
        left={left} right={right} rightTitle="Checks">
        <DeviceFrame device={device} narrow={narrow} testid="email-frame-wrap">
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", padding: "10px 14px", borderBottom: "1px solid " + T.bg2, background: T.white, position: "relative" }}>
            <PreviewAs as={preview.as && preview.as.id ? preview.as : as} onPick={p => setAs(p)} />
            {!isReadOnly && <FieldMenu fields={fields} onInsert={insertField} />}
            {preview.loading && <Spin />}
            <div data-testid="email-subject-line" style={{ flexBasis: "100%", fontSize: 13, color: T.ink2, lineHeight: 1.4 }}><b style={{ color: T.ink }}>Subject:</b> {preview.subject || subject || "No subject yet"}</div>
            {menuAt !== undefined && <BlockMenu blockTypes={blockTypes} onClose={() => setMenuAt(undefined)}
              onPick={type => { act("insert", menuAt, blockTypes, { type }).then(redraw); setMenuAt(undefined); }} />}
          </div>
          <div style={{ flex: 1, display: "flex", minHeight: 0, background: T.bg2, padding: device === "phone" ? 0 : "12px 0" }}>
            <EmailFrame html={preview.html} device={device} selected={selected} on={on} frameRef={frameRef} labels={labels} />
          </div>
        </DeviceFrame>
      </StewardEditor>
      {picker && (picker.kind === "photo"
        ? <StockPhotoPicker onClose={() => setPicker(null)} onPick={p => { picker.onPick({ url: p.url, alt: p.alt }); setPicker(null); }} />
        : <MediaPicker kind={picker.kind} onClose={() => setPicker(null)} onPick={item => { picker.onPick(item); setPicker(null); }} />)}
    </div>
  );
}

export function EmailHistory({ templateId, url, onClose, what = "email" }) {
  const [rows, setRows] = useState(null);
  const src = url || `/email-templates/${templateId}/history`;
  useEffect(() => { apiFetch(src).then(r => setRows(r.versions || [])).catch(() => setRows([])); }, [src]);
  const when = d => { try { return new Date(d).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); } catch { return ""; } };
  return (
    <div data-testid="history-panel">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: 13, fontWeight: 700 }}>History</div>
        <button type="button" onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: T.ink3, fontSize: 12.5 }}>Done</button>
      </div>
      <div style={{ ...railNote, margin: "4px 0 8px" }}>Everything done to this {what}, with who did it and when.</div>
      {rows === null ? <Spin /> : rows.length === 0 ? <div style={railNote}>Nothing saved here yet.</div> : rows.map(v => (
        <div key={v.id} data-testid="history-row" style={{ background: T.white, border: "1px solid " + T.bg2, borderRadius: 8, padding: "8px 10px", marginBottom: 6, fontSize: 12.5 }}>
          <b>{v.what}</b> by {v.byName}<div style={{ color: T.ink3 }}>{when(v.at)}</div>
        </div>
      ))}
    </div>
  );
}

// ── AN OLDER CAMPAIGN'S WORDS, AS BLOCKS, ON OPEN ──────────────────────────
// A campaign written in the old plain editor is HTML. It opens as blocks,
// converted here when it is opened and never in the database: its paragraphs,
// headings and lists become a text block, a paragraph that is only a link
// becomes a button, a picture becomes a photo block, an inline link keeps its
// address in brackets. Nothing is saved until she saves.
export function htmlToBlocks(html, { ask = false } = {}) {
  const out = [{ type: "header" }];
  let run = [];
  const flush = () => { if (run.length) out.push({ type: "richtext", blocks: run }); run = []; };
  let doc = null;
  try { doc = new DOMParser().parseFromString(`<div id="r">${String(html || "")}</div>`, "text/html"); } catch { doc = null; }
  const root = doc && doc.getElementById("r");
  const text = n => {
    let s = "";
    n.childNodes.forEach(c => {
      if (c.nodeType === 3) s += c.nodeValue;
      else if (c.nodeType === 1) {
        if (c.tagName === "BR") s += "\n";
        else if (c.tagName === "A") { const t = text(c).trim(); const h = c.getAttribute("href") || ""; s += /^https?:\/\//.test(h) && h !== t ? `${t} (${h})` : t; }
        else s += text(c);
      }
    });
    return s.replace(/ /g, " ");
  };
  const onlyLink = n => { const kids = [...n.childNodes].filter(c => !(c.nodeType === 3 && !c.nodeValue.trim())); return kids.length === 1 && kids[0].nodeType === 1 && kids[0].tagName === "A" ? kids[0] : null; };
  const visit = n => {
    if (n.nodeType === 3) { const t = n.nodeValue.trim(); if (t) run.push({ type: "p", text: t }); return; }
    if (n.nodeType !== 1) return;
    const tag = n.tagName;
    if (tag === "IMG") { flush(); out.push({ type: "image", image: /^https:\/\//.test(n.getAttribute("src") || "") ? n.getAttribute("src") : null, alt: n.getAttribute("alt") || "", caption: "" }); return; }
    const link = tag === "A" ? n : onlyLink(n);
    if (link && /^https?:\/\//.test(link.getAttribute("href") || "")) { flush(); out.push({ type: "button", action: "readmore", label: text(link).replace(/\s*→\s*$/, "").trim() || "Read more", url: link.getAttribute("href") }); return; }
    if (/^H[1-6]$/.test(tag)) { const t = text(n).trim(); if (t) run.push({ type: "h2", text: t }); return; }
    if (tag === "UL" || tag === "OL") { const items = [...n.querySelectorAll("li")].map(li => text(li).trim()).filter(Boolean); if (items.length) run.push({ type: "ul", items }); return; }
    if (n.querySelector && n.querySelector("p,div,h1,h2,h3,ul,ol,img") && !/^P$/.test(tag)) { n.childNodes.forEach(visit); return; }
    if (n.querySelector && n.querySelector("img")) { n.childNodes.forEach(visit); return; }
    const t = text(n).replace(/\n{3,}/g, "\n\n").trim();
    if (t) run.push({ type: "p", text: t });
  };
  if (root) root.childNodes.forEach(visit);
  flush();
  if (out.length === 1) out.push({ type: "richtext", blocks: [{ type: "p", text: "" }] });
  if (ask && !out.some(b => b.type === "button")) out.push({ type: "button", action: "give", label: "Give", url: "{{give_link}}" });
  out.push({ type: "footer" });
  return out;
}
// The words of the blocks as simple HTML: the campaign's `body`, which the
// lists, the starter check and "as sent" read. The send reads the blocks.
export function blocksToHtml(blocks) {
  const e = s => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const parts = [];
  for (const b of blocks || []) {
    if (!b) continue;
    if (b.type === "hero") { if (b.heading) parts.push(`<h2>${e(b.heading)}</h2>`); if (b.sub) parts.push(`<p>${e(b.sub)}</p>`); }
    if (b.type === "richtext") for (const x of b.blocks || []) {
      if (x.type === "h2") parts.push(`<h2>${e(x.text)}</h2>`);
      else if (x.type === "ul") parts.push(`<ul>${(x.items || []).map(i => `<li>${e(i)}</li>`).join("")}</ul>`);
      else if (String(x.text || "").trim()) parts.push(`<p>${e(x.text).replace(/\n/g, "<br>")}</p>`);
    }
    if (b.type === "quote" && b.text) parts.push(`<p>&ldquo;${e(b.text)}&rdquo;${b.attribution ? ` ${e(b.attribution)}` : ""}</p>`);
    if (b.type === "signature" && b.name) parts.push(`<p>${e(b.name)}${b.title ? `<br>${e(b.title)}` : ""}</p>`);
  }
  return parts.join("");
}
