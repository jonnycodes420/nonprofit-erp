// email-builder/useBuilderWorkspace.jsx · BUILDER-1. ONE EMAIL BUILDER, TWO OWNERS.
//
// What a template (EmailEditor) and a campaign (CampaignEditor) share: the
// blocks with undo, the server's preview drawn as it is typed, the selection,
// the left and right panes, the path line, the field rule (item 1), the
// keyboard (Cmd/Ctrl-Z, Shift-Cmd/Ctrl-Z, Escape) and the pickers. Each owner
// keeps its own saves, its email's own settings and its top-bar actions.
//
// THE PREVIEW is the server's render of what is on screen. While she types in
// it, it is not drawn again (that would take her caret away); it is drawn when
// she leaves the words, or when anything else changes.
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { apiFetch } from "../../api";
import { T, Spin } from "../shared";
import MediaPicker from "../MediaPicker";
import StockPhotoPicker from "../StockPhotoPicker";
import { DeviceFrame, builderQuiet } from "../StewardEditor";
import { EmailFrame, insertChip } from "./EmailFrame";
import { useEmailBuilder, stripKeys } from "./useEmailBuilder";
import { LeftPane, RightPane, blockName, fieldName } from "./Panes";

const isTextTarget = el => !!el && (el.tagName === "TEXTAREA" || el.isContentEditable || (el.tagName === "INPUT" && !/^(range|checkbox|radio|button|submit|color)$/i.test(el.type || "")));
const PART = { header: "Header", footer: "Footer" };
// Undo and Redo, as a curved arrow (a glyph draws differently on every machine).
const Arrow = ({ redo }) => (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" style={{ transform: redo ? "scaleX(-1)" : "none" }}>
    <path d="M5.5 3.5 2.5 6.5l3 3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M3 6.5h6.5a4 4 0 0 1 0 8H7" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);

// initialBlocks, blockTypes, mergeFields: as the server gives them.
// meta: { get(), set(m) } for undo over the email's own settings.
// fetchPreview(blocks): the owner's preview call, resolving to the server's answer.
// previewDeps: what else redraws it (device, dark, the person previewed...).
// metaAppend(which, token): puts a field at the end of the subject or the preview line.
export function useBuilderWorkspace({ initialBlocks, blockTypes, mergeFields, readOnly, meta, metaAppend, fetchPreview, previewDeps = [], onOpenBrand, frameTestid = "email-preview-frame", narrow }) {
  const allowed = useMemo(() => blockTypes.map(t => t.key), [blockTypes]);
  const labels = useMemo(() => Object.fromEntries(blockTypes.map(t => [t.key, blockName(t.key, { [t.key]: t.label })])), [blockTypes]);
  const typing = useRef(false);
  const stale = useRef(false);
  const [rev, setRev] = useState(0);
  const force = useCallback(() => { typing.current = false; stale.current = false; setRev(r => r + 1); }, []);
  const b = useEmailBuilder(initialBlocks, { meta, allowed, onChanged: o => { if (o && o.travel) force(); } });
  const [preview, setPreview] = useState({ html: "", problems: [], loading: true, as: null, subject: "" });
  const [leftTab, setLeftTab] = useState("elements");
  const [rightTab, setRightTab] = useState("edit");
  const [picker, setPicker] = useState(null);
  const [toast, setToast] = useState(null);
  const [events, setEvents] = useState([]);
  const [pages, setPages] = useState([]);
  const [sheet, setSheet] = useState(null);
  const frameRef = useRef(null);
  const caret = useRef(null);
  const lastInput = useRef(null);   // "subject" | "preheader" | "frame"
  const fetcher = useRef(fetchPreview);
  fetcher.current = fetchPreview;

  const say = useCallback(msg => { setToast({ msg, n: Date.now() }); }, []);
  useEffect(() => { if (!toast) return undefined; const t = setTimeout(() => setToast(null), 3200); return () => clearTimeout(t); }, [toast]);
  useEffect(() => {
    apiFetch("/events").then(r => setEvents(Array.isArray(r) ? r.filter(e => !e.archived_at) : [])).catch(() => setEvents([]));   // FLOWS-9: archived is offered nowhere
    apiFetch("/giving-pages").then(r => setPages(Array.isArray(r) ? r : [])).catch(() => setPages([]));
  }, []);

  const redraw = useCallback(() => {
    if (typing.current) { stale.current = true; return; }
    setRev(r => r + 1);
  }, []);
  useEffect(() => { redraw(); }, [b.blocks.length, redraw, ...previewDeps]);   // eslint-disable-line react-hooks/exhaustive-deps
  const seq = useRef(0);
  useEffect(() => {
    const n = ++seq.current;
    const t = setTimeout(() => {
      fetcher.current(stripKeys(b.latest.current))
        .then(r => { if (n === seq.current) setPreview({ ...r, html: r.html || "", problems: r.problems || [], loading: false }); })
        .catch(e => { if (n === seq.current) setPreview(p => ({ ...p, loading: false, problems: [(e && (e.sentence || e.message)) || "The preview could not be drawn."] })); });
    }, 300);
    return () => clearTimeout(t);
  }, [rev]);   // eslint-disable-line react-hooks/exhaustive-deps

  const keyAt = i => (b.latest.current[i] ? b.latest.current[i]._k : null);
  const select = i => {
    const k = i == null ? null : keyAt(i);
    if (k !== b.selKey) setRightTab("edit");
    b.setSelKey(k);
    if (i != null) lastInput.current = "frame";
  };
  const on = {
    commit: (path, value) => { lastInput.current = "frame"; b.commit(path, value); },
    focusChange: f => { typing.current = f; if (!f) setTimeout(() => { if (!typing.current && stale.current) { stale.current = false; setRev(r => r + 1); } }, 120); },
    caret: c => { caret.current = c; lastInput.current = "frame"; },
    select,
    action: (what, i) => { const k = keyAt(i); if (k) { b.act(what, k); force(); } },
    undo: () => b.undo(),
    redo: () => b.redo(),
  };
  // The cream around the email, or Escape anywhere: no selection, the email's own settings.
  const clear = useCallback(() => b.setSelKey(null), [b]);
  useEffect(() => {
    const onKey = e => {
      if (e.defaultPrevented) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && (e.key === "z" || e.key === "Z" || e.key === "y" || e.key === "Y") && !isTextTarget(e.target) && !document.querySelector('[role="dialog"]')) {
        e.preventDefault();
        if (e.shiftKey || e.key === "y" || e.key === "Y") b.redo(); else b.undo();
        return;
      }
      if (e.key === "Escape" && !isTextTarget(e.target) && !document.querySelector('[role="dialog"]')) clear();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [b, clear]);

  // ITEM 1 · A FIELD ALWAYS LANDS SOMEWHERE. Where she is typing in the
  // selected text (or any text, with nothing selected), at the caret; else at
  // the end of the selected text block, else of the first text block. A toast
  // says where. The subject and the preview line take it when one was the
  // last place she typed.
  const insertField = (f, metaAppend) => {
    const name = fieldName(f.label || f.token);
    if ((lastInput.current === "subject" || lastInput.current === "preheader") && metaAppend) {
      metaAppend(lastInput.current, f.token);
      say(`${name} added to the end of the ${lastInput.current === "subject" ? "subject" : "preview line"}.`);
      redraw();
      return "meta";
    }
    const c = caret.current;
    const live = c && c.el && c.el.isConnected;
    const caretBlock = live ? (() => { const tr = c.el.closest && c.el.closest("tr[data-st-block]"); return tr ? keyAt(Number(tr.getAttribute("data-st-block"))) : null; })() : null;
    if (live && (b.selKey == null || caretBlock === b.selKey) && insertChip(c, f.token.replace(/[{}\s]/g, ""), name)) {
      if (caretBlock) b.setSelKey(caretBlock);
      typing.current = false;
      setTimeout(() => setRev(r => r + 1), 50);
      say(`${name} added where you were typing.`);
      return "caret";
    }
    const r = b.appendField(f.token);
    if (!r) { say("There is no text in this email to put a field in. Add a Text element first."); return null; }
    caret.current = null;
    force();
    say(`${name} added at the end of ${r.where === "selected" ? "the selected text" : "the letter"}.`);
    return r.where;
  };

  const sel = b.selected != null ? b.blocks[b.selected] : null;
  const fieldLabel = useMemo(() => { const m = Object.fromEntries((mergeFields || []).map(f => [f.token.replace(/[{}\s]/g, ""), fieldName(f.label)])); return k => m[k] || k; }, [mergeFields]);
  const setOne = (patch, tag) => { const err = b.setBlock(sel._k, patch, tag && `set:${sel._k}:${tag}`); if (err) say(err); else redraw(); return err; };
  const setStyleOne = (patch, tag) => { const err = b.setStyle(sel._k, patch, tag && `style:${sel._k}:${tag}`); if (err) say(err); else redraw(); return err; };
  const settingsProps = sel ? {
    set: setOne, setStyle: setStyleOne, events, pages, brand: preview.brand || {}, fieldLabel, onOpenBrand,
    pick: (kind, onPick) => setPicker({ kind, onPick }), onFieldsTab: () => { setLeftTab("fields"); if (narrow) setSheet({ side: "left", n: Date.now() }); },
  } : null;

  const add = async (def, opts) => {
    const r = await b.insert(def, opts);
    if (r && r.error) { say(r.error); return; }
    force();
    setRightTab("edit");
    if (narrow) setSheet({ side: null, n: Date.now() });
    // Scrolled to once the redraw lands (the frame keeps its place otherwise).
    setTimeout(() => {
      let doc = null;
      try { doc = frameRef.current && frameRef.current.contentDocument; } catch { doc = null; }
      const box = doc && doc.querySelector("[data-testid=email-block-selected]");
      if (box && box.style.display !== "none" && box.scrollIntoView) box.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 900);
    say(`${blockName(def.key)} added ${opts && opts.list ? "(a list) " : ""}under the ${b.selKey ? "selected part" : "last part"}. Click it to change it.`);
  };

  const left = (
    <LeftPane tab={leftTab} onTab={setLeftTab} blockTypes={blockTypes} onAdd={add} fields={(mergeFields || []).map(f => ({ token: f.token, label: f.label }))}
      fieldInfo={preview.fieldInfo} asName={preview.as && preview.as.name} readOnly={readOnly}
      onField={f => { const r = insertField(f, metaAppend); if (narrow && r) setSheet({ side: null, n: Date.now() }); }} />
  );
  const right = emailSettings => (
    <RightPane html={preview.html} selectedIndex={b.selected} frameRef={frameRef} sel={sel} tab={rightTab} onTab={setRightTab} labels={labels}
      settingsProps={settingsProps} emailSettings={emailSettings} readOnly={readOnly} />
  );
  const crumb = (
    <>
      <span>Email</span>
      {sel && <><span aria-hidden="true">›</span><span>{PART[sel.type] || "Body"}</span><span aria-hidden="true">›</span><b data-testid="editor-crumb-current" style={{ color: T.ink }}>{sel.locked ? "Tax lines" : labels[sel.type] || sel.type}</b></>}
      {!sel && <span style={{ color: T.ink3 }}>· nothing selected</span>}
      {preview.loading && <span style={{ marginLeft: 6 }}><Spin /></span>}
      <span style={{ flex: 1 }} />
      {narrow && sel && <button type="button" style={{ ...builderQuiet(false), padding: "3px 10px", fontSize: 12 }} onClick={() => setSheet({ side: "right", n: Date.now() })}>Settings</button>}
    </>
  );
  const tools = !readOnly && (
    <div role="group" aria-label="Undo and redo" style={{ display: "inline-flex", gap: 4 }}>
      <button type="button" data-testid="editor-undo" aria-label="Undo" title="Undo (Cmd or Ctrl + Z)" disabled={!b.canUndo} onClick={() => b.undo()}
        style={{ ...builderQuiet(false), padding: "5px 9px", lineHeight: 0, opacity: b.canUndo ? 1 : 0.45, cursor: b.canUndo ? "pointer" : "not-allowed" }}><Arrow /></button>
      <button type="button" data-testid="editor-redo" aria-label="Redo" title="Redo (Shift + Cmd or Ctrl + Z)" disabled={!b.canRedo} onClick={() => b.redo()}
        style={{ ...builderQuiet(false), padding: "5px 9px", lineHeight: 0, opacity: b.canRedo ? 1 : 0.45, cursor: b.canRedo ? "pointer" : "not-allowed" }}><Arrow redo /></button>
    </div>
  );
  const canvas = (device, above = null, override = null) => (
    <div onClick={e => { if (e.target === e.currentTarget) clear(); }} style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, minWidth: 0 }}>
      {above}
      <div onClick={e => { if (e.target === e.currentTarget) clear(); }} style={{ flex: 1, display: "flex", minHeight: 0, padding: device === "phone" || narrow ? 0 : "18px 18px 0" }}>
        <DeviceFrame device={device} narrow={narrow} testid="email-frame-wrap">
          {override || <EmailFrame html={preview.html} device={device} selected={b.selected} on={on} frameRef={frameRef} labels={labels} testid={frameTestid} readOnly={readOnly} />}
        </DeviceFrame>
      </div>
    </div>
  );
  const overlays = (
    <>
      {picker && (picker.kind === "photo"
        ? <StockPhotoPicker onClose={() => setPicker(null)} onPick={p => { picker.onPick({ url: p.url, alt: p.alt }); setPicker(null); }} />
        : <MediaPicker kind={picker.kind} onClose={() => setPicker(null)} onPick={item => { picker.onPick(item); setPicker(null); }} />)}
      {toast && <div role="status" data-testid="builder-toast" key={toast.n} style={{ position: "fixed", bottom: 22, left: "50%", transform: "translateX(-50%)", zIndex: 600, background: T.ink, color: T.white,
        padding: "10px 16px", borderRadius: 10, fontSize: 13.5, maxWidth: "min(90vw, 520px)", boxShadow: "0 8px 30px rgba(15,26,18,0.25)" }}>{toast.msg}</div>}
    </>
  );
  const workspace = {
    b, preview, setPreview, redraw, force, frameRef, typing, lastInput, labels, sel, say, left, right, crumb, tools, canvas, overlays, clear, insertField,
    sheet, setLeftTab,
  };
  return workspace;
}
