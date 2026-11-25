// email-builder/frameDnD.js · BUILDER-2B items 1 and 5. DRAG, DROP AND THE "+" IN THE EMAIL.
//
// Attached to the email frame's document by EmailFrame once it loads (the
// frame runs no script of its own; this is the editor's, from outside).
//
//   · A tile dragged from Elements or Blocks (the browser's own drag), or a
//     block moved by its ⠿ grip (press, move, release: pointer events), shows
//     an emerald drop line between two blocks, where it will land. Dropping hands { payload, at } to the editor, which makes the
//     change as ONE undo step (useEmailBuilder insert / insertBlocks / moveTo).
//   · Hovering near the line between two blocks shows a "+" there; clicking it
//     opens the Elements and Blocks list right there (`plus(at, rect)`).
//
// `at` is a place in the top-level list: the block now at that index is the
// one it lands before (the list's length: the end). The footer is always last,
// so nothing lands below it; the header, when it is first, keeps its place too.
// Places are read from the rows the server marks (tr[data-st-block="n"]); a Box's
// own rows ("3.children.0") are inside its block, so they are never a place.
import { T } from "../shared";

export const DRAG_TYPE = "application/x-steward-email-block";
export const DND_CSS = `
.st-drop{position:absolute;z-index:30;height:0;border-top:3px solid ${T.green};pointer-events:none;display:none;border-radius:2px}
.st-drop:before,.st-drop:after{content:"";position:absolute;top:-6px;width:9px;height:9px;border-radius:50%;background:${T.green}}
.st-drop:before{left:-5px}.st-drop:after{right:-5px}
.st-plus{position:absolute;z-index:31;display:none;width:24px;height:24px;margin:-12px 0 0 -12px;border-radius:50%;border:0;background:${T.green};color:${T.white};
  font:700 17px/24px 'DM Sans',Helvetica,Arial,sans-serif;text-align:center;cursor:pointer;padding:0;box-shadow:0 2px 8px rgba(15,26,18,.25)}
.st-plus:hover{background:${T.ink}}
.st-bar .st-grip{display:inline-block;background:${T.green};color:${T.white};border-radius:5px;height:20px;min-width:22px;font-size:11px;font-weight:700;line-height:20px;text-align:center;padding:0 6px;cursor:grab;user-select:none}
.st-bar .st-grip:hover{background:${T.ink}}
`;

// The top-level blocks' boxes, in order: [{ index, top, bottom, left, right, type }].
export function blockBoxes(doc) {
  const sy = doc.defaultView ? doc.defaultView.scrollY : 0, sx = doc.defaultView ? doc.defaultView.scrollX : 0;
  const by = new Map();
  doc.querySelectorAll("tr[data-st-block]").forEach(tr => {
    const id = tr.getAttribute("data-st-block");
    if (!/^\d+$/.test(id)) return;
    const r = tr.getBoundingClientRect();
    const i = Number(id);
    const b = by.get(i) || { index: i, top: Infinity, bottom: -Infinity, left: Infinity, right: -Infinity, type: tr.getAttribute("data-st-type") || "" };
    b.top = Math.min(b.top, r.top + sy); b.bottom = Math.max(b.bottom, r.bottom + sy);
    b.left = Math.min(b.left, r.left + sx); b.right = Math.max(b.right, r.right + sx);
    by.set(i, b);
  });
  return [...by.values()].sort((a, b) => a.index - b.index);
}

// The place nearest a page y, and where its line is drawn. A place above a
// leading header or below the footer is never offered.
export function placeAt(boxes, y) {
  if (!boxes.length) return null;
  const first = boxes[0].type === "header" ? 1 : 0;
  const lastBox = boxes[boxes.length - 1];
  const last = lastBox.type === "footer" ? boxes.length - 1 : boxes.length;
  let at = last;
  for (let k = first; k < boxes.length; k++) { if (y < (boxes[k].top + boxes[k].bottom) / 2) { at = k; break; } }
  at = Math.max(first, Math.min(at, last));
  const lineY = at < boxes.length ? boxes[at].top : lastBox.bottom;
  const ref = boxes[Math.min(at, boxes.length - 1)];
  return { at: boxes[at] ? boxes[at].index : lastBox.index + 1, y: lineY, left: ref.left, right: ref.right };
}

const readPayload = dt => {
  try { const s = dt && dt.getData(DRAG_TYPE); return s ? JSON.parse(s) : null; } catch { return null; }
};
const carries = dt => !!dt && [...(dt.types || [])].includes(DRAG_TYPE);

// live.current: { drop(payload, at), plus(at, rect) }. readOnly: nothing attaches.
// Returns gripMove(grip, indexNow), which makes the ⠿ grip move the selected block.
export function attachDnD(doc, live, { readOnly = false } = {}) {
  if (readOnly || !doc || !doc.body) return { gripMove: () => {} };
  const st = doc.createElement("style");
  st.textContent = DND_CSS;
  (doc.head || doc.body).appendChild(st);
  const line = doc.createElement("div"); line.className = "st-drop"; line.setAttribute("data-testid", "email-drop-line"); doc.body.appendChild(line);
  const plus = doc.createElement("button"); plus.type = "button"; plus.className = "st-plus"; plus.textContent = "+";
  plus.setAttribute("data-testid", "email-plus"); plus.setAttribute("aria-label", "Add something here"); plus.title = "Add something here";
  doc.body.appendChild(plus);
  const pageY = e => e.clientY + (doc.defaultView ? doc.defaultView.scrollY : 0);
  const show = (el, p) => {
    if (!p) { el.style.display = "none"; return; }
    if (el === line) Object.assign(el.style, { display: "block", top: p.y + "px", left: (p.left + 8) + "px", width: Math.max(20, p.right - p.left - 16) + "px" });
    else Object.assign(el.style, { display: "block", top: p.y + "px", left: ((p.left + p.right) / 2) + "px" });
  };
  let dragging = false, plusAt = null;

  doc.addEventListener("dragover", e => {
    if (!carries(e.dataTransfer)) return;
    e.preventDefault();
    try { e.dataTransfer.dropEffect = [...e.dataTransfer.types].includes(DRAG_TYPE) && e.dataTransfer.effectAllowed === "move" ? "move" : "copy"; } catch { /* read-only in some browsers */ }
    dragging = true;
    show(plus, null);
    show(line, placeAt(blockBoxes(doc), pageY(e)));
  });
  doc.addEventListener("dragleave", e => { if (!e.relatedTarget) show(line, null); });
  doc.addEventListener("drop", e => {
    const payload = readPayload(e.dataTransfer);
    show(line, null); dragging = false;
    if (!payload) return;
    e.preventDefault();
    const p = placeAt(blockBoxes(doc), pageY(e));
    if (p) live.current.drop(payload, p.at);
  });
  doc.addEventListener("dragend", () => { show(line, null); dragging = false; });

  // The "+" sits on the line between two blocks while the pointer is near it.
  doc.addEventListener("mousemove", e => {
    if (dragging || e.target === plus) return;
    const boxes = blockBoxes(doc);
    const p = placeAt(boxes, pageY(e));
    const near = p && Math.abs(pageY(e) - p.y) < 12 && e.clientX + (doc.defaultView ? doc.defaultView.scrollX : 0) > p.left && e.clientX < p.right;
    plusAt = near ? p : null;
    show(plus, plusAt);
  });
  doc.addEventListener("mouseleave", () => { plusAt = null; show(plus, null); });
  plus.addEventListener("mousedown", e => e.preventDefault());
  plus.addEventListener("click", e => {
    e.preventDefault(); e.stopPropagation();
    if (!plusAt) return;
    const r = plus.getBoundingClientRect();
    live.current.plus(plusAt.at, { top: r.top, left: r.left, bottom: r.bottom, right: r.right });
  });

  // The ⠿ grip: press, move, release. Pointer events, not the browser's own
  // drag, so a block moves the same with a mouse or a trackpad inside the frame.
  function gripMove(grip, indexNow) {
    grip.addEventListener("pointerdown", e => {
      if (e.button !== 0) return;
      const index = indexNow();
      if (index == null) return;
      e.preventDefault(); e.stopPropagation();
      try { grip.setPointerCapture(e.pointerId); } catch { /* old browser */ }
      dragging = true; show(plus, null);
      let moved = false, last = null;
      const onMove = ev => {
        moved = true;
        last = placeAt(blockBoxes(doc), pageY(ev));
        show(line, last);
      };
      const onUp = ev => {
        grip.removeEventListener("pointermove", onMove);
        grip.removeEventListener("pointerup", onUp);
        grip.removeEventListener("pointercancel", onCancel);
        show(line, null); dragging = false;
        if (moved) { const p = placeAt(blockBoxes(doc), pageY(ev)) || last; if (p) live.current.drop({ move: index }, p.at); }
      };
      const onCancel = () => { grip.removeEventListener("pointermove", onMove); grip.removeEventListener("pointerup", onUp); show(line, null); dragging = false; };
      grip.addEventListener("pointermove", onMove);
      grip.addEventListener("pointerup", onUp);
      grip.addEventListener("pointercancel", onCancel);
    });
  }
  return { gripMove };
}
