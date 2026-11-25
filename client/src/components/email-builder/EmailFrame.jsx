// email-builder/EmailFrame.jsx · EDITOR-1, BUILDER-1. THE EMAIL, WHERE IT IS WRITTEN.
//
// The server's editable render (shared/emailBlocks.js renderEmail({editable}))
// in a frame that runs no script of its own (sandbox without allow-scripts);
// the editor wires it from outside. The words are typed where they show, and
// a field is a chip kept as its field, so "Dear {{first_name}}" never becomes
// "Dear Margaret" in the template.
//
// BUILDER-1: a click on a block SELECTS it: an emerald outline, its name tag
// top left and its handles top right (up, down, duplicate, remove; remove is
// not offered on a locked block such as a receipt's tax lines). A click on the
// cream around the email, or Escape, clears the selection. A block hidden on
// phones or on desktop is still drawn here, dimmed and named, so it can be
// found and clicked. Cmd/Ctrl-Z and Shift-Cmd/Ctrl-Z in the frame are the
// editor's undo and redo, not the browser's.
import { useEffect, useRef } from "react";
import { T } from "../shared";

// The frame's own look while editing, in Steward's tokens; the email inside
// stays the org's.
const FRAME_CSS = `
[data-st-edit]{outline:none;border-radius:3px;cursor:text;transition:box-shadow .12s;min-width:12px;display:inline-block}
[data-st-rich]{display:block}
[data-st-edit]:hover{box-shadow:0 0 0 1px ${T.green200}}
[data-st-edit]:focus{box-shadow:0 0 0 2px ${T.green100}}
[data-st-edit]:empty:before{content:attr(data-ph);color:${T.ink3};opacity:.75}
tr[data-st-block]{cursor:pointer}
tr[data-st-hide]>td{opacity:.5}
.st-chip{cursor:default}
.st-box{position:absolute;z-index:19;pointer-events:none;display:none;border-radius:2px}
.st-box.hover{border:1.5px solid ${T.green200}}
.st-box.sel{border:1.5px solid ${T.green};z-index:20}
.st-name{position:absolute;top:-12px;left:10px;background:${T.green};color:${T.white};border-radius:5px;font:700 11px/18px 'DM Sans',Helvetica,Arial,sans-serif;padding:0 7px;white-space:nowrap}
.st-bar{position:absolute;top:-12px;right:10px;display:flex;gap:4px;pointer-events:auto;font-family:'DM Sans',Helvetica,Arial,sans-serif}
.st-bar button{background:${T.green};color:${T.white};border:none;border-radius:5px;height:20px;min-width:22px;font-size:11px;font-weight:700;cursor:pointer;padding:0 6px;line-height:20px}
.st-bar button:hover{background:${T.ink}}
`;

// ── Reading the words back out of the preview ─────────────────────────────
// A chip is its field, a line break is "\n", anything else is its text.
export function inlineText(node) {
  let out = "";
  node.childNodes.forEach(n => {
    if (n.nodeType === 3) out += n.nodeValue;
    else if (n.nodeType === 1) {
      const tok = n.getAttribute && n.getAttribute("data-st-token");
      const keep = n.getAttribute && n.getAttribute("data-st-keep");   // SENDS-1: a never-giver's sentence reads back as written
      if (keep != null) out += keep;
      else if (tok) out += `{{${tok}}}`;
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
export function richBlocks(el) {
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
const HIDDEN_NAME = { phone: "hidden on phones", desktop: "hidden on desktop" };

// html: the server's editable render. selected: the selected block's index or
// null. on (read live): commit(path, value), select(i | null), action(act, i),
// focusChange(bool), caret(c), undo(), redo().
export function EmailFrame({ html, device, selected, on, frameRef, labels = {}, testid = "email-preview-frame", readOnly = false }) {
  const scrollY = useRef(0);
  const live = useRef(on);
  live.current = on;
  const sel = useRef(selected);
  sel.current = selected;
  const draw = useRef(() => {});   // re-places the outline, the tag and the handles

  const load = () => {
    const f = frameRef.current;
    let doc = null;
    try { doc = f && f.contentDocument; } catch { doc = null; }
    if (!doc || !doc.body) return;
    const st = doc.createElement("style");
    st.textContent = FRAME_CSS;
    doc.head && doc.head.appendChild(st);
    if (!readOnly) doc.querySelectorAll("[data-st-edit]").forEach(el => {
      const rich = el.hasAttribute("data-st-rich");
      const path = el.getAttribute("data-st-edit");
      el.setAttribute("contenteditable", "true");
      el.setAttribute("spellcheck", "true");
      el.setAttribute("role", "textbox");
      if (!rich) el.setAttribute("data-ph", PLACEHOLDER[path.split(".").pop()] || "Type here");
      const commit = () => live.current.commit(path, rich ? richBlocks(el) : inlineText(el).replace(/\s+$/, ""));
      el.addEventListener("input", () => { commit(); draw.current(); });
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
      const s = doc.getSelection && doc.getSelection();
      if (!s || !s.rangeCount) return;
      const r = s.getRangeAt(0);
      const host = r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentElement;
      const ed = host && host.closest && host.closest("[data-st-edit]");
      if (ed) live.current.caret({ doc, el: ed, range: r.cloneRange() });
    });
    // Undo and redo are the editor's, everywhere in the frame.
    doc.addEventListener("keydown", e => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && (e.key === "z" || e.key === "Z")) { e.preventDefault(); if (e.shiftKey) live.current.redo(); else live.current.undo(); return; }
      if (mod && (e.key === "y" || e.key === "Y")) { e.preventDefault(); live.current.redo(); return; }
      if (e.key === "Escape") { const a = doc.activeElement; if (a && a.blur) a.blur(); live.current.select(null); }
    });

    // The outline for the pointer and the one for the selection, each a box
    // laid over the block's rows. Only the selection carries the tag and handles.
    const box = cls => { const b = doc.createElement("div"); b.className = "st-box " + cls; doc.body.appendChild(b); return b; };
    const hover = box("hover");
    const selBox = box("sel");
    selBox.setAttribute("data-testid", "email-block-selected");
    const tag = doc.createElement("span"); tag.className = "st-name"; selBox.appendChild(tag);
    const bar = doc.createElement("div"); bar.className = "st-bar"; bar.setAttribute("data-testid", "email-block-handles"); selBox.appendChild(bar);
    const acts = readOnly ? [] : [["up", "↑", "Move up"], ["down", "↓", "Move down"], ["duplicate", "⧉", "Duplicate block"], ["remove", "✕", "Remove block"]].map(([act, text, aria]) => {
      const b = doc.createElement("button"); b.type = "button"; b.textContent = text; b.title = aria; b.setAttribute("data-act", act); b.setAttribute("aria-label", aria); bar.appendChild(b); return b;
    });
    const rectOf = i => {
      const rows = [...doc.querySelectorAll(`tr[data-st-block="${i}"]`)];
      if (!rows.length) return null;
      const rs = rows.map(r => r.getBoundingClientRect());
      const sy = doc.defaultView ? doc.defaultView.scrollY : 0;
      const sx = doc.defaultView ? doc.defaultView.scrollX : 0;
      return { rows, top: Math.min(...rs.map(r => r.top)) + sy, bottom: Math.max(...rs.map(r => r.bottom)) + sy, left: Math.min(...rs.map(r => r.left)) + sx, right: Math.max(...rs.map(r => r.right)) + sx };
    };
    const put = (b, r) => {
      if (!r) { b.style.display = "none"; return; }
      Object.assign(b.style, { display: "block", top: r.top + "px", left: r.left + "px", width: (r.right - r.left) + "px", height: (r.bottom - r.top) + "px" });
    };
    let hovered = null;
    draw.current = () => {
      const i = sel.current;
      const r = i == null ? null : rectOf(i);
      put(selBox, r);
      if (r) {
        const first = r.rows[0];
        const locked = first.getAttribute("data-st-locked") === "1";
        const type = first.getAttribute("data-st-type") || "";
        const hid = first.getAttribute("data-st-hide");
        tag.textContent = (locked ? "Tax lines · required" : (labels[type] || type)) + (hid ? ` · ${HIDDEN_NAME[hid] || ""}` : "");
        selBox.setAttribute("data-st-for", String(i));
        acts.forEach(b => { b.style.display = locked && (b.getAttribute("data-act") === "remove" || b.getAttribute("data-act") === "duplicate") ? "none" : ""; });
      }
      put(hover, hovered != null && hovered !== i ? rectOf(hovered) : null);
    };
    doc.addEventListener("mouseover", e => {
      const tr = e.target && e.target.closest && e.target.closest("tr[data-st-block]");
      const n = tr ? Number(tr.getAttribute("data-st-block")) : null;
      if (n !== hovered) { hovered = n; draw.current(); }
    });
    doc.addEventListener("mouseleave", () => { hovered = null; draw.current(); });
    bar.addEventListener("click", e => {
      const b = e.target.closest && e.target.closest("button[data-act]");
      if (!b || sel.current == null) return;
      e.preventDefault(); e.stopPropagation();
      live.current.action(b.getAttribute("data-act"), sel.current);
    });
    doc.addEventListener("click", e => {
      const a = e.target.closest && e.target.closest("a");
      if (a) e.preventDefault();
      if (e.target.closest && e.target.closest(".st-bar")) return;
      const tr = e.target.closest && e.target.closest("tr[data-st-block]");
      live.current.select(tr ? Number(tr.getAttribute("data-st-block")) : null);
    });
    if (doc.defaultView) {
      doc.defaultView.addEventListener("resize", () => draw.current());
      if (scrollY.current) doc.defaultView.scrollTo(0, scrollY.current);
    }
    // Pictures load after the frame does; the outline follows them.
    doc.querySelectorAll("img").forEach(im => { if (!im.complete) im.addEventListener("load", () => draw.current()); });
    draw.current();
  };
  // Keep the reader's place across a redraw.
  useEffect(() => {
    const f = frameRef.current;
    let w = null;
    try { w = f && f.contentWindow; } catch { w = null; }
    if (w) scrollY.current = w.scrollY || 0;
  }, [html, frameRef]);
  // The selection, marked without a redraw.
  useEffect(() => { draw.current(); }, [selected]);
  return (
    <iframe ref={frameRef} title="The email" data-testid={testid} sandbox="allow-same-origin" srcDoc={html} onLoad={load}
      style={{ display: "block", margin: "0 auto", width: device === "phone" ? "100%" : 640, maxWidth: "100%", height: "100%", minHeight: 520, border: 0, background: "transparent", flex: 1 }} />
  );
}

// Insert a field where the caret was, as a chip, and leave the caret after it
// so a second field follows the first. False when there is no live caret.
export function insertChip(caret, token, label) {
  if (!caret || !caret.doc || !caret.el || !caret.el.isConnected) return false;
  const { doc, el, range } = caret;
  if (!el.contains(range.startContainer)) return false;
  const chip = doc.createElement("span");
  chip.className = "st-chip"; chip.setAttribute("data-st-token", token); chip.setAttribute("contenteditable", "false");
  chip.setAttribute("style", `background:${T.green100};color:${T.green};border-radius:4px;padding:0 3px;`);
  chip.textContent = label;
  const after = doc.createTextNode(" ");
  try {
    range.deleteContents();
    range.insertNode(chip);
    chip.after(after);
    const r = doc.createRange();
    r.setStart(after, 1); r.collapse(true);
    const s = doc.getSelection && doc.getSelection();
    if (s) { s.removeAllRanges(); s.addRange(r); }
    caret.range = r.cloneRange();
  } catch { return false; }
  el.dispatchEvent(new doc.defaultView.Event("input"));
  return true;
}
