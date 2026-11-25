// email-builder/useEmailBuilder.js · BUILDER-1. THE BLOCKS, THE SELECTION, UNDO.
//
// One list of blocks that the frame (typing), the Elements tab (adding), the
// handles (moving, duplicating, removing) and the right pane (settings and
// style) all change, through `change`, so every change is one undo step back
// to the last save. Typing in one place, or dragging one slider, is one step.
// The selection is a block's key, so it follows the block when it moves.
//
// A setting change goes through validateEmailBlocks (shared/emailBlocks.js)
// before it reaches the email: what the server would refuse never shows.
import { useState, useRef, useCallback } from "react";
import { validateEmailBlocks } from "../../../../shared/emailBlocks.js";
import { stockPhotoForBlock } from "../StewardEditor";
import { setAtPath } from "./EmailFrame";

let keySeq = 0;
const newKey = () => `k${++keySeq}`;
export const withKeys = blocks => (blocks || []).map(b => ({ ...b, _k: newKey() }));
export const stripKeys = blocks => blocks.map(b => { const c = { ...b }; delete c._k; return c; });
const clone = v => JSON.parse(JSON.stringify(v));
const COALESCE_MS = 1200;

// What a text field may be put into: an open text block (not a receipt's tax
// lines, not one shown as its first-gift version).
export const takesText = b => !!b && b.type === "richtext" && !b.locked;

// The List element is a text block that starts as a list.
export const LIST_DEFAULTS = { blocks: [{ type: "ul", items: ["The first thing", "The second thing"] }] };

// initial: the saved blocks. meta: { get(), set(m) } for the email's own
// settings that undo covers too (name, subject, preview line), or null.
// allowed: the email's block types (typesForSurface("email")).
export function useEmailBuilder(initial, { meta = null, allowed = [], onChanged } = {}) {
  const [blocks, setBlocksRaw] = useState(() => withKeys(initial));
  const [selKey, setSelKey] = useState(null);
  const selRef = useRef(null);
  selRef.current = selKey;
  const [ver, setVer] = useState(0);   // re-renders Undo / Redo when the stacks change
  const latest = useRef(blocks);
  latest.current = blocks;
  const metaRef = useRef(meta);
  metaRef.current = meta;
  const hist = useRef({ past: [], future: [], tag: null, at: 0 });
  const changed = useRef(onChanged);
  changed.current = onChanged;

  const snap = () => ({ blocks: latest.current, meta: metaRef.current ? metaRef.current.get() : null });
  const push = tag => {
    const h = hist.current, now = Date.now();
    if (!(tag && tag === h.tag && now - h.at < COALESCE_MS)) { h.past.push(snap()); if (h.past.length > 200) h.past.shift(); }
    h.tag = tag; h.at = now; h.future = [];
    setVer(v => v + 1);
  };
  // Every change to the blocks: one undo step (or joined to the last, by tag).
  const change = useCallback((updater, tag = null) => {
    push(tag);
    setBlocksRaw(bs => { const n = typeof updater === "function" ? updater(bs) : updater; latest.current = n; return n; });
    if (changed.current) changed.current();
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  // The email's own settings (subject and the like), on the same stack.
  const changeMeta = useCallback((apply, tag = null) => { push(tag); apply(); }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  // Replaced wholesale, NOT a step: opening, saving, a draft thrown away.
  const reset = useCallback((list, { keepSelection = false } = {}) => {
    const at = latest.current.findIndex(b => b._k === selRef.current);
    const n = withKeys(list);
    latest.current = n;
    setBlocksRaw(n);
    hist.current = { past: [], future: [], tag: null, at: 0 };
    setSelKey(keepSelection && at >= 0 && n[at] ? n[at]._k : null);
    setVer(v => v + 1);
  }, []);
  // After a save the stack starts again: undo goes back to the last save.
  const markSaved = useCallback(() => { hist.current = { past: [], future: [], tag: null, at: 0 }; setVer(v => v + 1); }, []);
  const travel = (from, to) => {
    const h = hist.current;
    if (!h[from].length) return false;
    h[to].push(snap());
    const s = h[from].pop();
    h.tag = null;
    latest.current = s.blocks;
    setBlocksRaw(s.blocks);
    if (s.meta && metaRef.current) metaRef.current.set(s.meta);
    setVer(v => v + 1);
    if (changed.current) changed.current({ travel: true });
    return true;
  };
  const undo = useCallback(() => travel("past", "future"), []);   // eslint-disable-line react-hooks/exhaustive-deps
  const redo = useCallback(() => travel("future", "past"), []);   // eslint-disable-line react-hooks/exhaustive-deps

  const indexOf = k => latest.current.findIndex(b => b._k === k);
  const selected = selKey == null ? null : (() => { const i = blocks.findIndex(b => b._k === selKey); return i < 0 ? null : i; })();
  const selectIndex = i => setSelKey(i == null || !latest.current[i] ? null : latest.current[i]._k);

  // Typing in the frame: the words at a path, one step per place typed in.
  const commit = (path, value) => {
    const i = Number(String(path).split(".")[0]);
    const k = latest.current[i] && latest.current[i]._k;
    // A blur commits the same words again: no change, no undo step.
    if (k && JSON.stringify(setAtPath(latest.current, path, value)[i]) === JSON.stringify(latest.current[i])) return;
    change(bs => setAtPath(bs, path, value), "type:" + k + ":" + path.split(".").slice(1).join("."));
  };

  // A setting or a style on one block, checked by the validator first.
  // Returns null when it took, or the sentence that says why it did not.
  const setBlock = (key, patch, tag = null) => {
    const i = indexOf(key);
    if (i < 0) return "That block is gone.";
    const cur = latest.current[i];
    const next = { ...cur, ...(typeof patch === "function" ? patch(cur) : patch) };
    for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
    if (next.style) { for (const k of Object.keys(next.style)) if (next.style[k] === undefined || next.style[k] === null) delete next.style[k]; if (!Object.keys(next.style).length) delete next.style; }
    const probe = { ...next }; delete probe._k;
    const v = validateEmailBlocks([probe], allowed);
    if (!v.ok) return v.error.replace(/^Block 1: /, "");
    change(bs => bs.map(b => (b._k === key ? next : b)), tag || "set:" + key + ":" + Object.keys(typeof patch === "function" ? {} : patch).join(","));
    return null;
  };
  const setStyle = (key, patch, tag) => setBlock(key, b => ({ style: { ...(b.style || {}), ...patch } }), tag || "style:" + key + ":" + Object.keys(patch).join(","));

  // The handles: up, down, duplicate, remove. A locked block and the footer
  // are never removed or copied; they may move.
  const act = (what, key) => {
    const i = indexOf(key);
    if (i < 0) return;
    const b = latest.current[i];
    if (what === "up" || what === "down") {
      const j = i + (what === "up" ? -1 : 1);
      if (j < 0 || j >= latest.current.length) return;
      change(bs => { const n = [...bs]; [n[i], n[j]] = [n[j], n[i]]; return n; });
    }
    if (what === "remove") {
      if (b.locked || b.type === "footer") return;
      change(bs => bs.filter(x => x._k !== key));
      if (selKey === key) setSelKey(null);
    }
    if (what === "duplicate") {
      if (b.locked || b.type === "footer") return;
      const copy = { ...clone(b), _k: newKey() };
      change(bs => { const n = [...bs]; n.splice(i + 1, 0, copy); return n; });
      setSelKey(copy._k);
    }
  };

  // Elements: a new block under the selected one (or at the end, above the
  // footer), selected. Returns its key.
  const insert = async (def, { list = false } = {}) => {
    const fresh = { type: def.key, ...clone(list ? LIST_DEFAULTS : def.defaults || {}), _k: newKey() };
    if (["hero", "image"].includes(def.key)) { const p = await stockPhotoForBlock(); if (p) { fresh.image = p.src; fresh.alt = p.alt; } }
    if (def.key === "photos2") { const p = await stockPhotoForBlock(); if (p) fresh.images = [{ src: p.src, alt: p.alt }, { src: p.src, alt: p.alt }]; }
    const probe = { ...fresh }; delete probe._k;
    const v = validateEmailBlocks([probe], allowed);
    if (!v.ok) return { error: v.error.replace(/^Block 1: /, "") };
    const after = selKey;
    change(bs => {
      const foot = bs.findIndex(b => b.type === "footer");
      const end = foot >= 0 ? foot : bs.length;
      const j = after != null ? bs.findIndex(b => b._k === after) : -1;
      const at = j >= 0 ? Math.min(j + 1, end) : end;
      const n = [...bs]; n.splice(at, 0, fresh); return n;
    });
    setSelKey(fresh._k);
    return fresh._k;
  };

  // ITEM 1 · A FIELD ALWAYS LANDS SOMEWHERE. With no live caret in the chosen
  // text, it goes at the end of the selected text block, else of the first
  // text block, as {{token}} in the words themselves. Returns where it went,
  // { key, where: "selected" | "first" }, or null when there is no text block.
  const appendField = token => {
    const bs = latest.current;
    const sel = selKey != null ? bs.find(b => b._k === selKey) : null;
    const target = takesText(sel) ? sel : bs.find(takesText);
    if (!target) return null;
    const paras = Array.isArray(target.blocks) && target.blocks.length ? clone(target.blocks) : [{ type: "p", text: "" }];
    let k = paras.length - 1;
    while (k > 0 && paras[k].type === "h2") k--;
    const p = paras[k];
    if (p.type === "ul") { const items = p.items && p.items.length ? p.items : [""]; items[items.length - 1] = String(items[items.length - 1]).replace(/\s*$/, items[items.length - 1] ? " " : "") + token; p.items = items; }
    else p.text = String(p.text || "").replace(/\s*$/, p.text ? " " : "") + token;
    change(list => list.map(b => (b._k === target._k ? { ...b, blocks: paras } : b)), null);
    setSelKey(target._k);
    return { key: target._k, where: target === sel ? "selected" : "first" };
  };

  return {
    blocks, latest, selected, selKey, setSelKey, selectIndex, change, changeMeta, reset, markSaved, undo, redo,
    canUndo: hist.current.past.length > 0, canRedo: hist.current.future.length > 0, ver,
    commit, setBlock, setStyle, act, insert, appendField,
  };
}
