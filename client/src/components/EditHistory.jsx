// FIX-14 Part 2 — EDIT EVERYTHING, AND SAY SO.
//
// Three small pieces every logged item on a profile shares, so a meeting, a
// call, a next step and a task behave the same way:
//   · ItemMenu      Edit and Delete, in one quiet menu on the card.
//   · EditedMarker  "Edited" with who and when; tapping it shows the previous
//                   versions, read from the audit log (the only copy of an old
//                   value once an edit is saved).
//   · useUndo       Delete happens at once, then offers Undo for ten seconds.
//                   The server moved the row aside rather than destroying it,
//                   so Undo puts back exactly what was there. (FIX-22: no
//                   browser confirm in front of a delete that can be undone.)
//   (askConfirm in ConfirmDialog.jsx is the in-app confirm, for the few
//   deletes that cannot be undone or that move money. Never window.confirm.)
// And HistoryList, the person's own audit rows on their profile.
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { apiFetch } from "../api";
import { T, firstNameOf } from "./shared";
import { errorMessage } from "../lib/domainError";

const linkBtn = { background: "none", border: "none", padding: 0, font: "inherit", cursor: "pointer" };

// When, in the organisation's zone, with the zone named.
export function fmtInZone(iso, tz) {
  if (!iso) return "";
  const d = new Date(iso);
  const o = { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" };
  try { return d.toLocaleString("en-US", tz ? { ...o, timeZone: tz } : o); }
  catch { return d.toLocaleString("en-US", o); }
}

export function ItemMenu({ onEdit, onDelete, label = "entry", disabled = false }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  if (disabled || (!onEdit && !onDelete)) return null;
  const item = { ...linkBtn, display: "block", width: "100%", textAlign: "left", padding: "8px 14px", fontSize: 13, color: T.ink };
  return (
    <div ref={ref} style={{ position: "relative", flexShrink: 0 }} onClick={e => e.stopPropagation()}>
      <button type="button" aria-label={`Edit or delete this ${label}`} aria-haspopup="menu" aria-expanded={open}
        data-testid="item-menu" onClick={() => setOpen(o => !o)}
        style={{ ...linkBtn, color: T.ink3, fontSize: 16, lineHeight: 1, padding: "2px 6px", borderRadius: 6 }}>⋯</button>
      {open && (
        <div role="menu" style={{ position: "absolute", right: 0, top: "100%", zIndex: 20, background: T.white, border: "1px solid " + T.bg3, borderRadius: 10, minWidth: 120, boxShadow: "0 6px 18px rgba(15,26,18,0.12)", overflow: "hidden" }}>
          {onEdit && <button type="button" role="menuitem" style={item} onClick={() => { setOpen(false); onEdit(); }}>Edit</button>}
          {onDelete && <button type="button" role="menuitem" style={item}
            onClick={() => { setOpen(false); onDelete(); }}>Delete</button>}
        </div>
      )}
    </div>
  );
}

// "Edited", with who and when. Tapping it opens the previous versions.
export function EditedMarker({ item }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState(null);
  const [tz, setTz] = useState(null);
  if (!item || !item.edited_at || !item.id) return null;
  const who = firstNameOf(item.edited_by_name) || "someone";
  const toggle = e => {
    e.stopPropagation();
    if (!open && rows === null) {
      apiFetch(`/records/${encodeURIComponent(item.id)}/history`)
        .then(r => { setRows(r.rows || []); setTz(r.timezone || null); })
        .catch(() => setRows([]));
    }
    setOpen(o => !o);
  };
  const show = v => v === null || v === undefined || v === "" ? "nothing" : typeof v === "object" ? JSON.stringify(v) : String(v);
  return (
    <span style={{ position: "relative" }} onClick={e => e.stopPropagation()}>
      <button type="button" onClick={toggle} aria-expanded={open} data-testid="edited-marker"
        title={`Edited by ${who}, ${fmtInZone(item.edited_at)}`}
        style={{ ...linkBtn, fontSize: 11, color: T.ink3, textDecoration: "underline dotted" }}>
        Edited by {who}
      </button>
      {open && (
        <div style={{ position: "absolute", right: 0, top: "100%", zIndex: 20, marginTop: 4, width: 320, maxWidth: "80vw", background: T.white, border: "1px solid " + T.bg3, borderRadius: 10, padding: "10px 14px", boxShadow: "0 6px 18px rgba(15,26,18,0.12)", cursor: "default" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: T.ink3, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }}>Previous versions</div>
          {rows === null && <div style={{ fontSize: 12, color: T.ink3 }}>Loading…</div>}
          {rows && rows.length === 0 && <div style={{ fontSize: 12, color: T.ink3 }}>No earlier versions are on record.</div>}
          {rows && rows.filter(r => r.action === "updated" && r.before).map(r => (
            <div key={r.id} style={{ borderTop: "1px solid " + T.bg2, padding: "8px 0", fontSize: 12, lineHeight: 1.5, color: T.ink }}>
              <div style={{ color: T.ink3 }}>{fmtInZone(r.created_at, tz)} · {r.user_name || "System"}</div>
              {Object.keys(r.before).map(k => (
                <div key={k}><span style={{ color: T.ink3 }}>{k.replace(/_/g, " ")} was </span><span style={{ whiteSpace: "pre-wrap" }}>{show(r.before[k])}</span></div>
              ))}
            </div>
          ))}
        </div>
      )}
    </span>
  );
}

// Delete, then Undo for ten seconds. Returns [toast, offer]. `offer` takes
// the server's delete response and what to do once it is back.
// FIX-25: the ten seconds count only while someone could be reading it. The
// clock stops while the pointer or focus is on the toast, and while the tab is
// in the background, so Undo is never gone before the person looks for it.
export function useUndo() {
  const [state, setState] = useState(null);   // { undoId, label, onRestored, left, held }
  useEffect(() => {
    if (!state) return undefined;
    if (state.left <= 0) { setState(null); return undefined; }
    const t = setTimeout(() => setState(s => (!s ? s : s.held || (typeof document !== "undefined" && document.hidden) ? { ...s } : { ...s, left: s.left - 1 })), 1000);
    return () => clearTimeout(t);
  }, [state]);
  const hold = held => setState(s => (s ? { ...s, held } : s));
  // CAL-1: the same toast undoes a CHANGE, not only a delete. A screen that
  // moved something passes { undoAction, message }: undoAction puts the old
  // values back through the item's own route (an audited write like any).
  const offer = (resp, label, onRestored) => {
    if (!resp || !(resp.undoId || typeof resp.undoAction === "function")) return;
    setState({ undoId: resp.undoId || null, action: resp.undoAction || null, message: resp.message || null, label, onRestored, left: resp.undoSeconds || 10, err: "" });
  };
  const undo = async () => {
    const s = state; if (!s) return;
    try {
      const r = s.action ? await s.action() : await apiFetch(`/deleted-records/${s.undoId}/restore`, { method: "POST" });
      setState(null);
      s.onRestored && s.onRestored(r);
    } catch (e) { setState({ ...s, err: errorMessage(e, "It could not be put back.") }); }
  };
  return [<UndoToastView key="undo" state={state} onUndo={undo} onHold={hold} />, offer];
}

function UndoToastView({ state, onUndo, onHold }) {
  if (!state) return null;
  return (
    <div role="status" data-testid="undo-toast"
      onMouseEnter={() => onHold(true)} onMouseLeave={() => onHold(false)} onFocus={() => onHold(true)} onBlur={() => onHold(false)}
      style={{ position: "fixed", left: "50%", bottom: 24, transform: "translateX(-50%)", zIndex: 400, background: T.ink, color: T.white, borderRadius: 12, padding: "12px 18px", display: "flex", gap: 14, alignItems: "center", fontSize: 13, boxShadow: "0 8px 24px rgba(15,26,18,0.25)", maxWidth: "calc(100vw - 32px)" }}>
      <span>{state.err || state.message || `Deleted the ${state.label}.`}</span>
      <button type="button" onClick={onUndo} style={{ ...linkBtn, color: T.gold, fontWeight: 800 }}>Undo ({state.left})</button>
    </div>
  );
}

// FIX-22: THE SAME TOAST, FROM ANYWHERE. A screen calls offerUndo(resp, label,
// onRestored) after its DELETE; the host mounts itself on first use, so the
// screen renders nothing for it. FIX-25: every delete uses this one host. A
// toast drawn inside the screen that deleted went with that screen whenever it
// re-rendered away, and a transformed ancestor can trap a fixed toast; one
// host on document.body has neither problem.
let undoHostOffer = null;
let undoHostMounted = false;
const undoWaiting = [];
function UndoHost() {
  const [toast, offer] = useUndo();
  useEffect(() => {
    undoHostOffer = offer;
    while (undoWaiting.length) offer(...undoWaiting.shift());
  });
  return toast;
}
export function offerUndo(resp, label, onRestored) {
  if (!resp || !(resp.undoId || typeof resp.undoAction === "function")) return;
  if (undoHostOffer) { undoHostOffer(resp, label, onRestored); return; }
  undoWaiting.push([resp, label, onRestored]);
  if (!undoHostMounted && typeof document !== "undefined") {
    undoHostMounted = true;
    const el = document.createElement("div");
    el.setAttribute("data-undo-host", "");
    document.body.appendChild(el);
    createRoot(el).render(<UndoHost />);
  }
}

// ONE PERSON'S HISTORY: every audit row about them, newest first, each a
// plain sentence, in the organisation's zone with the zone named.
export function HistoryList({ donorId }) {
  const [state, setState] = useState({ loading: true, rows: [], tz: null, err: "" });
  const [open, setOpen] = useState(null);
  useEffect(() => {
    let alive = true;
    apiFetch(`/donors/${encodeURIComponent(donorId)}/history`)
      .then(r => { if (alive) setState({ loading: false, rows: r.rows || [], tz: r.timezone || null, err: "" }); })
      .catch(e => { if (alive) setState({ loading: false, rows: [], tz: null, err: errorMessage(e, "Could not load the history.") }); });
    return () => { alive = false; };
  }, [donorId]);
  if (state.loading) return <div style={{ fontSize: 12, color: T.ink3, padding: 16 }}>Loading…</div>;
  if (state.err) return <div style={{ fontSize: 12, color: T.ink, padding: 16 }}>{state.err}</div>;
  if (!state.rows.length) return <div style={{ fontSize: 12, color: T.ink3, padding: 16 }}>Nothing has been changed on this record yet. Every change from here on shows up here.</div>;
  const show = v => v === null || v === undefined || v === "" ? "not set" : typeof v === "object" ? JSON.stringify(v) : String(v);
  return (
    <div data-testid="dp-history" style={{ display: "flex", flexDirection: "column", gap: 0, background: T.white, border: "1px solid " + T.bg3, borderRadius: 10 }}>
      {state.rows.map((r, i) => {
        const moved = r.before && r.after && r.action === "updated";
        return (
          <div key={r.id} style={{ borderTop: i ? "1px solid " + T.bg3 : "none", padding: "10px 14px" }}>
            <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
              <span style={{ fontSize: 13, color: T.ink, flex: "1 1 240px" }}>{r.description}</span>
              <span style={{ fontSize: 11.5, color: T.ink3 }}>{r.user_name || "System"} · {fmtInZone(r.created_at, state.tz)}</span>
              {moved && <button type="button" onClick={() => setOpen(open === r.id ? null : r.id)}
                style={{ ...linkBtn, fontSize: 11.5, color: T.greenDk, fontWeight: 700 }}>{open === r.id ? "Hide" : "What changed"}</button>}
            </div>
            {open === r.id && moved && (
              <div style={{ marginTop: 6, fontSize: 12, lineHeight: 1.5 }}>
                {Object.keys({ ...r.before, ...r.after }).map(k => (
                  <div key={k}><span style={{ color: T.ink3 }}>{k.replace(/_/g, " ")}: </span>{show(r.before[k])} <span style={{ color: T.ink3 }}>became</span> {show(r.after[k])}</div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
