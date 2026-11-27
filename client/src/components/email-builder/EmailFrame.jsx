// email-builder/EmailFrame.jsx · EDITOR-1, BUILDER-1. THE EMAIL, WHERE IT IS WRITTEN.
//
// The server's editable render (shared/emailBlocks.js renderEmail({editable}))
// in a frame that runs no script of its own (its page's policy is script-src
// 'none'; the sandbox allows scripts only so Safari runs the editor's listeners,
// POLISH-15, frameDoc.js);
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
import { attachDnD } from "./frameDnD";   // BUILDER-2B: drag, drop and the "+"
import { FRAME_SANDBOX, framedHtml } from "./frameDoc";   // POLISH-15: the frame answers in Safari too

// BUILDER-2B: a row inside a Box is marked "3.children.0"; a click on it
// selects its Box (block 3), the block the editor holds.
const topIndex = tr => { const v = tr && tr.getAttribute("data-st-block"); return v == null ? null : Number(String(v).split(".")[0]); };
const typingIn = doc => { const a = doc.activeElement; return !!(a && a.closest && a.closest("[data-st-edit]")); };
// In text of several paragraphs, Alt (Option) with an arrow moves the caret a
// paragraph; anywhere else it moves the selected block.
const inParagraphs = doc => { const a = doc.activeElement; return !!(a && a.closest && a.closest("[data-st-rich]")); };

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
.st-bar{position:absolute;display:flex;gap:4px;pointer-events:auto;font-family:'DM Sans',Helvetica,Arial,sans-serif}
.st-bar.out{flex-direction:column;top:0;left:calc(100% + 8px)}
.st-bar.in{top:4px;right:4px}
.st-bar button{background:${T.green};color:${T.white};border:none;border-radius:5px;height:20px;min-width:22px;font-size:11px;font-weight:700;cursor:pointer;padding:0 6px;line-height:20px}
.st-bar button:hover{background:${T.ink}}
.st-box.other{display:block;border:2px solid var(--c);z-index:18}
.st-box.other .st-who{position:absolute;top:-11px;right:10px;background:var(--c);color:${T.white};border-radius:5px;font:700 11px/18px 'DM Sans',Helvetica,Arial,sans-serif;padding:0 7px;white-space:nowrap}
[data-st-held]{cursor:not-allowed}
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
// focusChange(bool), caret(c), undo(), redo(); BUILDER-2B: drop(payload, at),
// plus(at, rect), copy(event), paste(event).
// BUILDER-3: others = [{ index, color, name, holds }] the people with this email open: an outline
// in each one's colour on the block they have selected; a block one of them holds (is typing in)
// can't be typed in here until they move on (server/mail/emailTogether.js).
export function EmailFrame({ html, device, selected, on, frameRef, labels = {}, testid = "email-preview-frame", readOnly = false, others = null }) {
  const scrollY = useRef(0);
  const live = useRef(on);
  live.current = on;
  const sel = useRef(selected);
  sel.current = selected;
  const draw = useRef(() => {});   // re-places the outline, the tag and the handles
  const oth = useRef(others || []);
  oth.current = others || [];
  const docRef = useRef(null);
  // A block someone else holds: its words can't be typed in here (the save keeps theirs anyway).
  const markHeld = () => {
    const doc = docRef.current;
    if (!doc || readOnly) return;
    const held = new Map(oth.current.filter(o => o.holds && o.index != null).map(o => [o.index, o]));
    doc.querySelectorAll("[data-st-edit]").forEach(el => {
      const i = Number(String(el.getAttribute("data-st-edit")).split(".")[0]);
      const o = held.get(i);
      if (o) { el.setAttribute("contenteditable", "false"); el.setAttribute("data-st-held", "1"); el.title = `${o.name} is editing this`; if (doc.activeElement === el) el.blur(); }
      else if (el.hasAttribute("data-st-held")) { el.setAttribute("contenteditable", "true"); el.removeAttribute("data-st-held"); el.removeAttribute("title"); }
    });
  };

  const load = () => {
    const f = frameRef.current;
    let doc = null;
    try { doc = f && f.contentDocument; } catch { doc = null; }
    if (!doc || !doc.body) return;
    docRef.current = doc;
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
      // BUILDER-2B: Alt+Up / Alt+Down moves the selected block (not inside paragraphs of text).
      if (e.altKey && !mod && (e.key === "ArrowUp" || e.key === "ArrowDown") && sel.current != null && !inParagraphs(doc) && !readOnly) {
        e.preventDefault(); const a = doc.activeElement; if (a && a.blur && typingIn(doc)) a.blur();
        live.current.action(e.key === "ArrowUp" ? "up" : "down", sel.current); return;
      }
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
    const acts = readOnly ? [] : [["drag", "⠿", "Hold and move to place it (or Alt + Up and Down)"], ["up", "↑", "Move up"], ["down", "↓", "Move down"], ["duplicate", "⧉", "Duplicate block"], ["remove", "✕", "Remove block"]].map(([act, text, aria]) => {
      // The ⠿ grip is a span: a button can't be dragged in every browser.
      const b = doc.createElement(act === "drag" ? "span" : "button");
      if (act === "drag") { b.setAttribute("role", "button"); b.className = "st-grip"; } else b.type = "button";
      b.textContent = text; b.title = aria; b.setAttribute("data-act", act); b.setAttribute("aria-label", aria); bar.appendChild(b); return b;
    });
    // BUILDER-2B: drag a tile or a block in, the drop line, the "+", copy and paste.
    const dnd = attachDnD(doc, live, { readOnly });
    const grip = acts.find(b => b.getAttribute("data-act") === "drag");
    if (grip) { grip.style.touchAction = "none"; dnd.gripMove(grip, () => sel.current); }
    if (!readOnly) {
      doc.addEventListener("copy", e => { if (!typingIn(doc) && sel.current != null) live.current.copy(e); });
      doc.addEventListener("paste", e => { if (!typingIn(doc)) live.current.paste(e); });
    }
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
    let otherBoxes = [];
    draw.current = () => {
      otherBoxes.forEach(x => x.remove());
      otherBoxes = oth.current.filter(o => o.index != null).map(o => {
        const r = rectOf(o.index);
        if (!r) return null;
        const ob = doc.createElement("div"); ob.className = "st-box other"; ob.style.setProperty("--c", o.color);
        ob.setAttribute("data-testid", "email-block-other"); ob.setAttribute("data-st-for", String(o.index)); ob.setAttribute("data-color", o.color);
        const who = doc.createElement("span"); who.className = "st-who"; who.textContent = o.holds ? `${o.name} is editing` : o.name; ob.appendChild(who);
        doc.body.appendChild(ob); put(ob, r); return ob;
      }).filter(Boolean);
      const i = sel.current;
      const r = i == null ? null : rectOf(i);
      put(selBox, r);
      if (r) {
        const first = r.rows[0];
        const locked = first.getAttribute("data-st-locked") === "1";
        const type = first.getAttribute("data-st-type") || "";
        const hid = first.getAttribute("data-st-hide");
        // BUILDER-2B: the handles sit in the margin beside the email, over no
        // block, so a click on any other block always reaches it (they used to
        // sit above the block, over the one before it, and a click there pressed
        // Duplicate). With no room beside it (a phone), inside its own corner.
        const room = (doc.documentElement.clientWidth || 0) + (doc.defaultView ? doc.defaultView.scrollX : 0) - r.right;
        bar.className = "st-bar " + (room >= 34 ? "out" : "in");
        tag.textContent = (locked ? "Tax lines · required" : (labels[type] || type)) + (hid ? ` · ${HIDDEN_NAME[hid] || ""}` : "");
        selBox.setAttribute("data-st-for", String(i));
        acts.forEach(b => { const a = b.getAttribute("data-act"); b.style.display = (locked && (a === "remove" || a === "duplicate")) || ((type === "footer" || (type === "header" && i === 0)) && a === "drag") ? "none" : ""; });   // POLISH-15: the header at the top stays there, so it has no grip
      }
      put(hover, hovered != null && hovered !== i ? rectOf(hovered) : null);
    };
    doc.addEventListener("mouseover", e => {
      const tr = e.target && e.target.closest && e.target.closest("tr[data-st-block]");
      const n = tr ? topIndex(tr) : null;
      if (n !== hovered) { hovered = n; draw.current(); }
    });
    doc.addEventListener("mouseleave", () => { hovered = null; draw.current(); });
    bar.addEventListener("click", e => {
      const b = e.target.closest && e.target.closest("button[data-act]");
      if (!b || sel.current == null || b.getAttribute("data-act") === "drag") return;
      e.preventDefault(); e.stopPropagation();
      live.current.action(b.getAttribute("data-act"), sel.current);
    });
    doc.addEventListener("click", e => {
      const a = e.target.closest && e.target.closest("a");
      if (a) e.preventDefault();
      // A click on the handles' own space (not a handle) is a click on what is under it.
      let target = e.target;
      if (target.closest && target.closest(".st-bar")) {
        if (target.closest("button, [data-act]")) return;
        const under = doc.elementsFromPoint ? doc.elementsFromPoint(e.clientX, e.clientY).find(el => !el.closest(".st-box, .st-bar, .st-plus, .st-drop")) : null;
        if (!under) return;
        target = under;
      }
      const tr = target.closest && target.closest("tr[data-st-block]");
      live.current.select(tr ? topIndex(tr) : null);
    });
    if (doc.defaultView) {
      doc.defaultView.addEventListener("resize", () => draw.current());
      if (scrollY.current) doc.defaultView.scrollTo(0, scrollY.current);
    }
    // Pictures load after the frame does; the outline follows them.
    doc.querySelectorAll("img").forEach(im => { if (!im.complete) im.addEventListener("load", () => draw.current()); });
    draw.current();
    markHeld();
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
  useEffect(() => { draw.current(); markHeld(); }, [others]);   // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <iframe ref={frameRef} title="The email" data-testid={testid} sandbox={FRAME_SANDBOX} srcDoc={framedHtml(html)} onLoad={load}
      style={{ colorScheme: "light", display: "block", margin: "0 auto", width: device === "phone" ? "100%" : 700, maxWidth: "100%", height: "100%", minHeight: 520, border: 0, background: "transparent", flex: 1 }} />
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
